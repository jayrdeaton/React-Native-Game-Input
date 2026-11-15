import type { Vec2 } from '@tastic/core/math'
import { useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import { averageTiltAngles, computeTiltAngles, computeTiltVector, resolveTiltPlatform, TILT_AXIS_SIGNS, type TiltAngles, type TiltPlatform } from '../gravity'
import { INTERFACE_ORIENTATION, type InterfaceOrientationLike, remapTiltToScreenAxes } from '../orientation'
import { applyExponentialSmoothing, applyRadialDeadZone } from '../smoothing'

// One DeviceMotion sample, as much of expo-sensors' DeviceMotionMeasurement as useTilt reads. Looser
// than expo's own type (nullable values: a desktop browser can fire events with null axes), so expo's
// module and a hand-written web source both fit.
export interface DeviceMotionMeasurementLike {
  accelerationIncludingGravity?: { x?: number | null; y?: number | null; z?: number | null } | null
  // How the device is held (expo-sensors: 0, 90, 180 or -90), handed to getInterfaceOrientation.
  orientation?: number | null
}

// The part of expo-sensors' DeviceMotion module useTilt calls, mirrored here so expo-sensors isn't a
// peer: pass `DeviceMotion` from 'expo-sensors' as is on native, and createWebDeviceMotion() on web.
export interface DeviceMotionLike {
  addListener: (listener: (measurement: DeviceMotionMeasurementLike) => void) => { remove: () => void }
  setUpdateInterval: (intervalMs: number) => void
  requestPermissionsAsync: () => Promise<{ granted: boolean }>
}

export type TiltStatus = 'idle' | 'requesting' | 'active' | 'unavailable' | 'denied' | 'lost'

export interface UseTiltOptions {
  // The expo-sensors DeviceMotion module (or anything shaped like it).
  deviceMotion: DeviceMotionLike
  // Subscribed only while true (and only once request() has gone through).
  enabled: boolean
  // The tilt from the baseline that reads as full strength, in degrees (e.g. 25).
  fullScaleDeg: number
  // Radial dead zone as a fraction of full scale. Default DEFAULT_TILT_DEAD_ZONE (0.02).
  deadZone?: number
  // EMA time constant in ms. Default DEFAULT_TILT_SMOOTHING_MS (60).
  smoothingMs?: number
  // Flips both axes.
  invert?: boolean
  // Sensor interval in ms while subscribed. Default 16. Not set on web, which has no interval.
  intervalMs?: number
  // Interval set back on teardown, since the sensor's interval is global. Default 100.
  restoreIntervalMs?: number
  // The interface orientation, read on every sample. Defaults to portrait. It's handed the sample's
  // held rotation, so @tastic/core's trackInterfaceOrientation().current can be passed directly; a
  // function that ignores it works too.
  getInterfaceOrientation?: (heldRotation: number) => InterfaceOrientationLike
}

export interface TiltHandle {
  status: TiltStatus
  // Call inside a user gesture with nothing awaited before it (iOS Safari only asks for motion
  // permission from one). Resolves true once a first sample with finite x/y/z arrives.
  request: () => Promise<boolean>
  // baseline = mean of the last ~250 ms of angle samples
  captureBaseline: () => void
  // The latest smoothed, dead-zoned, capped tilt in SCREEN axes, -1..1: +x right, +y down the screen.
  // Zero before a baseline exists.
  getVector: () => Vec2
}

// The deadZone and smoothingMs a caller gets when it passes none (exported for tuning tools that show them).
export const DEFAULT_TILT_DEAD_ZONE = 0.02
export const DEFAULT_TILT_SMOOTHING_MS = 60
const DEFAULT_INTERVAL_MS = 16
const DEFAULT_RESTORE_INTERVAL_MS = 100
// captureBaseline averages the samples from this long before the latest one.
const BASELINE_WINDOW_MS = 250
// While 'active' and subscribed, this long without a finite sample sets 'lost'.
const WATCHDOG_MS = 500
// After request() is granted, this long without a first finite sample sets 'unavailable'.
const FIRST_SAMPLE_TIMEOUT_MS = 1000

const ZERO: Vec2 = { x: 0, y: 0 }

function now(): number {
  return performance.now()
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

interface Subscription {
  remove: () => void
  deviceMotion: DeviceMotionLike
  web: boolean
  platform: TiltPlatform
}

interface PendingRequest {
  promise: Promise<boolean>
  resolve: (granted: boolean) => void
  timer: ReturnType<typeof setTimeout> | null
}

// All of useTilt's sample-rate state, as plain closure variables rather than React state: samples
// arrive at about 60 Hz and nothing renders from them, so only `status` reaches React (through
// onStatus). One controller lives for the hook's whole life (useState's initializer).
function createTiltController(initialOptions: UseTiltOptions, onStatus: (status: TiltStatus) => void) {
  let options = initialOptions
  let enabled = false
  let disposed = false
  let status: TiltStatus = 'idle'
  // Whether request() has gone through, which is what lets the hook subscribe at all.
  let granted = false
  let pending: PendingRequest | null = null
  let subscription: Subscription | null = null
  // Runs only while 'active' and subscribed.
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let lastFiniteAt = 0
  let lastSampleAt: number | null = null
  let samples: { at: number; angles: TiltAngles }[] = []
  let baseline: TiltAngles | null = null
  // The smoothed tilt in the device frame; null until the first sample after (re)subscribing.
  let smoothed: Vec2 | null = null
  let output: Vec2 = ZERO

  const stopWatchdog = () => {
    if (watchdog !== null) clearTimeout(watchdog)
    watchdog = null
  }

  const setStatus = (next: TiltStatus) => {
    status = next
    if (next !== 'active') stopWatchdog()
    onStatus(next)
  }

  // Re-arms itself for whatever's left of the window instead of resetting on every sample.
  const armWatchdog = () => {
    stopWatchdog()
    const check = () => {
      const silentFor = now() - lastFiniteAt
      if (silentFor < WATCHDOG_MS) {
        watchdog = setTimeout(check, WATCHDOG_MS - silentFor)
        return
      }
      watchdog = null
      smoothed = null
      output = ZERO
      setStatus('lost')
    }
    watchdog = setTimeout(check, Math.max(0, lastFiniteAt + WATCHDOG_MS - now()))
  }

  // Only ever called with the request that's still pending.
  const settle = (entry: PendingRequest, ok: boolean, failure: TiltStatus) => {
    if (entry.timer !== null) clearTimeout(entry.timer)
    pending = null
    setStatus(ok ? 'active' : failure)
    syncSubscription()
    if (ok && subscription) armWatchdog()
    entry.resolve(ok)
  }

  const handleMeasurement = (record: Subscription, measurement: DeviceMotionMeasurementLike) => {
    if (record !== subscription) return
    const reading = measurement.accelerationIncludingGravity
    if (!reading || !isFiniteNumber(reading.x) || !isFiniteNumber(reading.y) || !isFiniteNumber(reading.z)) return

    const at = now()
    const angles = computeTiltAngles({ x: reading.x, y: reading.y, z: reading.z }, TILT_AXIS_SIGNS[record.platform])
    samples.push({ at, angles })
    while (samples[0].at < at - BASELINE_WINDOW_MS) samples.shift()
    const dtMs = lastSampleAt === null ? null : at - lastSampleAt
    lastSampleAt = at
    lastFiniteAt = at

    // Settling can drop a subscription that only existed for the request (tilt not enabled yet).
    if (pending) settle(pending, true, 'active')
    // 'lost' holds the vector at zero until request() confirms the sensor again.
    if (!baseline || record !== subscription || status === 'lost') return

    const { fullScaleDeg, deadZone = DEFAULT_TILT_DEAD_ZONE, smoothingMs = DEFAULT_TILT_SMOOTHING_MS, invert = false, getInterfaceOrientation } = options
    const tilt = computeTiltVector(angles, baseline, fullScaleDeg)
    smoothed = smoothed === null || dtMs === null ? tilt : applyExponentialSmoothing(smoothed, tilt, dtMs, smoothingMs)
    const orientation = getInterfaceOrientation ? getInterfaceOrientation(measurement.orientation ?? 0) : INTERFACE_ORIENTATION.PORTRAIT_UP
    const screen = applyRadialDeadZone(remapTiltToScreenAxes(smoothed, orientation), deadZone)
    output = invert ? { x: -screen.x, y: -screen.y } : screen
  }

  const subscribe = () => {
    const { deviceMotion, intervalMs = DEFAULT_INTERVAL_MS, restoreIntervalMs = DEFAULT_RESTORE_INTERVAL_MS } = options
    const web = Platform.OS === 'web'
    const record: Subscription = { remove: () => undefined, deviceMotion, web, platform: resolveTiltPlatform(Platform.OS, navigator.userAgent, navigator.maxTouchPoints) }
    subscription = record
    samples = []
    lastSampleAt = null
    smoothed = null
    lastFiniteAt = now()
    // expo-sensors' web module has no interval, and setUpdateInterval only warns there.
    if (!web) deviceMotion.setUpdateInterval(intervalMs)
    try {
      const listener = deviceMotion.addListener((measurement) => handleMeasurement(record, measurement))
      record.remove = () => listener.remove()
    } catch {
      // A source that can't be listened to at all (expo-sensors' DeviceMotion on web: its web module
      // has no addListener) reads as unavailable. request() reports it when it's the one subscribing.
      subscription = null
      if (!web) deviceMotion.setUpdateInterval(restoreIntervalMs)
      if (status === 'active') setStatus('unavailable')
      return
    }
    if (status === 'active') armWatchdog()
  }

  const unsubscribe = (record: Subscription) => {
    subscription = null
    stopWatchdog()
    record.remove()
    if (!record.web) record.deviceMotion.setUpdateInterval(options.restoreIntervalMs ?? DEFAULT_RESTORE_INTERVAL_MS)
    samples = []
    lastSampleAt = null
    smoothed = null
    output = ZERO
  }

  // Subscribed while request() has gone through and either `enabled` is on or a request is still
  // waiting for its first sample (so request() works even before the game turns tilt on).
  function syncSubscription() {
    const wanted = !disposed && granted && (enabled || pending !== null)
    if (wanted && !subscription) subscribe()
    else if (!wanted && subscription) unsubscribe(subscription)
  }

  const request = (): Promise<boolean> => {
    if (pending) return pending.promise
    if (disposed) return Promise.resolve(false)
    const { deviceMotion } = options
    // Only the web needs a permission: expo-sensors' native requestPermissionsAsync asks for Motion &
    // Fitness (iOS) or activity recognition (Android 10+), neither of which DeviceMotion needs, and a
    // "no" there would wrongly read as denied. On web it's the call that must run inside the gesture,
    // so it runs first, before anything else here.
    let permission: Promise<{ granted: boolean }>
    try {
      permission = Platform.OS === 'web' ? Promise.resolve(deviceMotion.requestPermissionsAsync()) : Promise.resolve({ granted: true })
    } catch {
      setStatus('unavailable')
      return Promise.resolve(false)
    }
    // Assigned synchronously by the Promise executor.
    let resolve!: (ok: boolean) => void
    const promise = new Promise<boolean>((done) => {
      resolve = done
    })
    const entry: PendingRequest = { promise, resolve, timer: null }
    pending = entry
    setStatus('requesting')
    permission.then(
      (response) => {
        if (pending !== entry) return
        granted = response.granted === true
        if (!granted) {
          settle(entry, false, 'denied')
          return
        }
        syncSubscription()
        if (!subscription) {
          settle(entry, false, 'unavailable')
          return
        }
        entry.timer = setTimeout(() => settle(entry, false, 'unavailable'), FIRST_SAMPLE_TIMEOUT_MS)
      },
      () => {
        if (pending === entry) settle(entry, false, 'unavailable')
      }
    )
    return promise
  }

  const captureBaseline = () => {
    if (samples.length === 0) return
    const cutoff = samples[samples.length - 1].at - BASELINE_WINDOW_MS
    // Never null: the window always holds at least the latest sample.
    baseline = averageTiltAngles(samples.filter((sample) => sample.at >= cutoff).map((sample) => sample.angles)) as TiltAngles
    // The player is holding the new level right now, so the tilt starts from rest.
    smoothed = ZERO
    output = ZERO
  }

  const getVector = (): Vec2 => ({ x: output.x, y: output.y })

  return {
    request,
    captureBaseline,
    getVector,
    setOptions: (next: UseTiltOptions) => {
      options = next
    },
    setEnabled: (next: boolean) => {
      enabled = next
      syncSubscription()
    },
    mount: () => {
      disposed = false
      syncSubscription()
    },
    unmount: () => {
      disposed = true
      const entry = pending
      if (entry) {
        if (entry.timer !== null) clearTimeout(entry.timer)
        pending = null
        entry.resolve(false)
      }
      syncSubscription()
    }
  }
}

// Tilt input from DeviceMotion's gravity reading: angles relative to a captured baseline, smoothed,
// dead-zoned and capped, in screen axes. Samples stay out of React; read them with getVector() from a
// game loop. `status` is the only state.
export function useTilt(options: UseTiltOptions): TiltHandle {
  const { deviceMotion, enabled, intervalMs, restoreIntervalMs } = options
  const [status, setStatus] = useState<TiltStatus>('idle')
  const [controller] = useState(() => createTiltController(options, setStatus))

  useEffect(() => {
    controller.mount()
    return () => controller.unmount()
  }, [controller])

  useEffect(() => {
    controller.setOptions(options)
  })

  // A new source or interval resubscribes, so the interval is restored on the old one and set anew.
  useEffect(() => {
    controller.setEnabled(enabled)
    return () => controller.setEnabled(false)
  }, [controller, enabled, deviceMotion, intervalMs, restoreIntervalMs])

  return useMemo(() => ({ status, request: controller.request, captureBaseline: controller.captureBaseline, getVector: controller.getVector }), [controller, status])
}
