import { act, renderHook } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { Platform } from 'react-native'

import { INTERFACE_ORIENTATION } from '../orientation'
import { type DeviceMotionMeasurementLike, useTilt, type UseTiltOptions } from '../tilt'

const G = 9.80665
const rad = (deg: number) => (deg * Math.PI) / 180

// The reading for a device held with its bottom edge dipped pitchDeg below the horizon and its right
// edge dipped rollDeg (the two angles computeTiltAngles reads), screen up: the direction gravity pulls,
// as expo-sensors reports it natively (and iOS Safari passes through); `w3c` flips it to the reaction
// Android Chrome reports. The two edges are square to each other, so both can't be steep at once.
function reading(pitchDeg: number, rollDeg = 0, w3c = false): DeviceMotionMeasurementLike {
  const x = Math.sin(rad(rollDeg))
  const y = Math.sin(rad(pitchDeg))
  if (x * x + y * y > 1) throw new Error(`no hold dips ${rollDeg} and pitches ${pitchDeg}`)
  const z = Math.sqrt(1 - x * x - y * y)
  const sign = w3c ? -1 : 1
  return { accelerationIncludingGravity: { x: sign * G * x, y: sign * -G * y, z: sign * -G * z }, orientation: 0 }
}

function createFakeDeviceMotion() {
  const listeners = new Set<(measurement: DeviceMotionMeasurementLike) => void>()
  const removes: jest.Mock[] = []
  return {
    addListener: jest.fn((listener: (measurement: DeviceMotionMeasurementLike) => void) => {
      listeners.add(listener)
      const remove = jest.fn(() => {
        listeners.delete(listener)
      })
      removes.push(remove)
      return { remove }
    }),
    setUpdateInterval: jest.fn(),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    removes,
    listenerCount: () => listeners.size,
    emit: (measurement: DeviceMotionMeasurementLike) => {
      for (const listener of [...listeners]) listener(measurement)
    }
  }
}

type FakeDeviceMotion = ReturnType<typeof createFakeDeviceMotion>

const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
}

beforeEach(() => {
  jest.useFakeTimers()
  Platform.OS = 'ios'
})

afterEach(() => {
  jest.useRealTimers()
  setUserAgent(originalUserAgent)
})

function setup(deviceMotion: FakeDeviceMotion, overrides: Partial<UseTiltOptions> = {}) {
  const initialProps: UseTiltOptions = { deviceMotion, enabled: true, fullScaleDeg: 25, smoothingMs: 0, deadZone: 0, ...overrides }
  return renderHook((props: UseTiltOptions) => useTilt(props), { initialProps })
}

// Emits one sample, then lets `ms` of fake time pass.
function sample(deviceMotion: FakeDeviceMotion, measurement: DeviceMotionMeasurementLike, ms = 16) {
  act(() => {
    deviceMotion.emit(measurement)
    jest.advanceTimersByTime(ms)
  })
}

// Settles request()'s permission step (a resolved promise) without advancing the fake clock.
const flushMicrotasks = () => act(() => Promise.resolve())

async function requestAndActivate(deviceMotion: FakeDeviceMotion, result: { current: ReturnType<typeof useTilt> }) {
  let granted: Promise<boolean> = Promise.resolve(false)
  act(() => {
    granted = result.current.request()
  })
  await flushMicrotasks()
  sample(deviceMotion, reading(45))
  await expect(granted).resolves.toBe(true)
}

describe('useTilt: request and status', () => {
  it('starts idle and subscribes to nothing before request(), even while enabled', () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    expect(result.current.status).toBe('idle')
    expect(deviceMotion.addListener).not.toHaveBeenCalled()
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
  })

  it('on native, skips the permission call, subscribes, and resolves true on the first finite sample', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      granted = result.current.request()
    })
    expect(result.current.status).toBe('requesting')
    await flushMicrotasks()
    expect(deviceMotion.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(deviceMotion.addListener).toHaveBeenCalledTimes(1)
    expect(deviceMotion.setUpdateInterval).toHaveBeenCalledWith(16)

    sample(deviceMotion, { accelerationIncludingGravity: { x: null, y: 0, z: -G } })
    sample(deviceMotion, { accelerationIncludingGravity: { x: NaN, y: 0, z: -G } })
    sample(deviceMotion, { accelerationIncludingGravity: null })
    expect(result.current.status).toBe('requesting')

    sample(deviceMotion, reading(45))
    await expect(granted).resolves.toBe(true)
    expect(result.current.status).toBe('active')
  })

  it('returns the same promise for a request already in flight', () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    let first: Promise<boolean> | null = null
    let second: Promise<boolean> | null = null
    act(() => {
      first = result.current.request()
      second = result.current.request()
    })
    expect(second).toBe(first)
  })

  it('on web, asks permission synchronously inside the call (the iOS Safari gesture) and never sets an interval', async () => {
    Platform.OS = 'web'
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      granted = result.current.request()
      expect(deviceMotion.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    })
    await flushMicrotasks()
    sample(deviceMotion, reading(45, 0, true))
    await expect(granted).resolves.toBe(true)
    expect(deviceMotion.setUpdateInterval).not.toHaveBeenCalled()
  })

  it('on web, a refused permission reads as denied and subscribes to nothing', async () => {
    Platform.OS = 'web'
    const deviceMotion = createFakeDeviceMotion()
    deviceMotion.requestPermissionsAsync.mockResolvedValueOnce({ granted: false })
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
    expect(result.current.status).toBe('denied')
    expect(deviceMotion.addListener).not.toHaveBeenCalled()
  })

  it('on web, a permission call that rejects or throws reads as unavailable', async () => {
    Platform.OS = 'web'
    const rejecting = createFakeDeviceMotion()
    rejecting.requestPermissionsAsync.mockRejectedValueOnce(new Error('no sensor'))
    const first = setup(rejecting)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = first.result.current.request()
    })
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
    expect(first.result.current.status).toBe('unavailable')

    const throwing = createFakeDeviceMotion()
    throwing.requestPermissionsAsync.mockImplementationOnce(() => {
      throw new Error('not a function')
    })
    const second = setup(throwing)
    act(() => {
      granted = second.result.current.request()
    })
    await expect(granted).resolves.toBe(false)
    expect(second.result.current.status).toBe('unavailable')
  })

  it('reads as unavailable when no finite sample arrives within a second of being granted', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    act(() => {
      jest.advanceTimersByTime(999)
    })
    expect(result.current.status).toBe('requesting')
    act(() => {
      jest.advanceTimersByTime(1)
    })
    await expect(granted).resolves.toBe(false)
    expect(result.current.status).toBe('unavailable')
  })

  it('reads as unavailable when the source cannot be listened to at all', async () => {
    const deviceMotion = createFakeDeviceMotion()
    // expo-sensors' web module has no addListener, so its DeviceMotion throws this on web.
    deviceMotion.addListener.mockImplementation(() => {
      throw new TypeError('this._nativeModule.addListener is not a function')
    })
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
    expect(result.current.status).toBe('unavailable')
    // The interval it set is put back.
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(100)
  })

  it("on web, reads as unavailable when addListener throws, as expo-sensors' web DeviceMotion does", async () => {
    Platform.OS = 'web'
    const deviceMotion = createFakeDeviceMotion()
    deviceMotion.addListener.mockImplementation(() => {
      throw new TypeError('this._nativeModule.addListener is not a function')
    })
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
    expect(result.current.status).toBe('unavailable')
    expect(deviceMotion.setUpdateInterval).not.toHaveBeenCalled()
  })

  it('reads as unavailable when an active source stops accepting listeners on re-enable', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    rerender({ deviceMotion, enabled: false, fullScaleDeg: 25 })
    deviceMotion.addListener.mockImplementation(() => {
      throw new Error('gone')
    })
    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25 })
    expect(result.current.status).toBe('unavailable')
  })

  it('re-confirms with the next sample when request() is called while already active', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    await requestAndActivate(deviceMotion, result)
    expect(result.current.status).toBe('active')
    expect(deviceMotion.addListener).toHaveBeenCalledTimes(1)
  })

  it('resolves false and subscribes to nothing when unmounted before the permission step settles', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, unmount } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    unmount()
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
    expect(deviceMotion.addListener).not.toHaveBeenCalled()
  })

  it('on web, ignores a permission rejection that lands after unmount', async () => {
    Platform.OS = 'web'
    const deviceMotion = createFakeDeviceMotion()
    let reject: (error: Error) => void = () => undefined
    deviceMotion.requestPermissionsAsync.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    const { result, unmount } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    unmount()
    reject(new Error('late'))
    await flushMicrotasks()
    await expect(granted).resolves.toBe(false)
  })

  it('resolves a request still in flight false on unmount', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, unmount } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    unmount()
    await expect(granted).resolves.toBe(false)
  })

  it('resolves false without asking anything once unmounted', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, unmount } = setup(deviceMotion)
    const { request } = result.current
    unmount()
    await expect(request()).resolves.toBe(false)
  })
})

describe('useTilt: subscription lifecycle', () => {
  it('subscribes only while enabled, setting the interval and restoring it on teardown', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    expect(deviceMotion.listenerCount()).toBe(1)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(16)

    rerender({ deviceMotion, enabled: false, fullScaleDeg: 25 })
    expect(deviceMotion.listenerCount()).toBe(0)
    expect(deviceMotion.removes[0]).toHaveBeenCalledTimes(1)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(100)

    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25 })
    expect(deviceMotion.listenerCount()).toBe(1)
    expect(deviceMotion.addListener).toHaveBeenCalledTimes(2)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(16)
  })

  it('uses custom intervals, and resubscribes when they change', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion, { intervalMs: 20, restoreIntervalMs: 250 })
    await requestAndActivate(deviceMotion, result)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(20)

    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25, intervalMs: 10, restoreIntervalMs: 250 })
    expect(deviceMotion.setUpdateInterval.mock.calls.slice(-2)).toEqual([[250], [10]])
    expect(deviceMotion.listenerCount()).toBe(1)
  })

  it('removes the listener and restores the interval on unmount', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, unmount } = setup(deviceMotion, { restoreIntervalMs: 50 })
    await requestAndActivate(deviceMotion, result)
    unmount()
    expect(deviceMotion.listenerCount()).toBe(0)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(50)
  })

  it('listens for a request while disabled, then lets go once it has its first sample', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion, { enabled: false })
    let granted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    expect(deviceMotion.listenerCount()).toBe(1)
    sample(deviceMotion, reading(45))
    await expect(granted).resolves.toBe(true)
    expect(result.current.status).toBe('active')
    expect(deviceMotion.listenerCount()).toBe(0)
    expect(deviceMotion.setUpdateInterval).toHaveBeenLastCalledWith(100)

    // Already granted, so turning tilt on subscribes straight away.
    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25 })
    expect(deviceMotion.listenerCount()).toBe(1)
  })

  it("survives React StrictMode's mount, unmount, mount", async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = renderHook(() => useTilt({ deviceMotion, enabled: true, fullScaleDeg: 25 }), { wrapper: ({ children }) => createElement(StrictMode, null, children) })
    await requestAndActivate(deviceMotion, result)
    expect(deviceMotion.listenerCount()).toBe(1)
  })
})

describe('useTilt: watchdog', () => {
  it('sets lost after 500 ms with no finite sample while active, and zeroes the vector', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeCloseTo(1)

    // Samples keep arriving: still active well past 500 ms.
    for (let i = 0; i < 40; i++) sample(deviceMotion, reading(45, 25))
    expect(result.current.status).toBe('active')

    // Only junk arrives from here on.
    sample(deviceMotion, { accelerationIncludingGravity: { x: null, y: null, z: null } }, 480)
    expect(result.current.status).toBe('active')
    act(() => {
      jest.advanceTimersByTime(20)
    })
    expect(result.current.status).toBe('lost')
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
  })

  it('stays lost until request() is called again, which brings it back to active', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    act(() => {
      jest.advanceTimersByTime(600)
    })
    expect(result.current.status).toBe('lost')
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(45, 25))
    expect(result.current.status).toBe('lost')
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })

    await requestAndActivate(deviceMotion, result)
    expect(result.current.status).toBe('active')
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeGreaterThan(0.9)
  })

  it('does not watch while disabled, and restarts the clock on re-enable', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    rerender({ deviceMotion, enabled: false, fullScaleDeg: 25 })
    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(result.current.status).toBe('active')

    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25 })
    act(() => {
      jest.advanceTimersByTime(499)
    })
    expect(result.current.status).toBe('active')
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current.status).toBe('lost')
  })
})

describe('useTilt: baseline and vector', () => {
  it('stays zero until a baseline is captured', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45, 20))
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
  })

  it('does nothing when there are no samples to capture from', () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    act(() => result.current.captureBaseline())
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
  })

  it('captures the mean of the last ~250 ms of samples, ignoring older ones', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    // Settling the grip: well before the window, at 20 degrees.
    for (let i = 0; i < 20; i++) sample(deviceMotion, reading(20))
    // The last 250 ms: 44 and 46 degrees, averaging 45.
    for (let i = 0; i < 16; i++) sample(deviceMotion, reading(i % 2 === 0 ? 44 : 46))
    act(() => result.current.captureBaseline())
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })

    sample(deviceMotion, reading(45))
    expect(result.current.getVector().x).toBeCloseTo(0)
    expect(result.current.getVector().y).toBeCloseTo(0)
    sample(deviceMotion, reading(70))
    expect(result.current.getVector().y).toBeCloseTo(1)
  })

  it('reaches full scale in all four screen directions from a 45 degree hold', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())

    const cases: [number, number, number, number][] = [
      [45, 25, 1, 0],
      [45, -25, -1, 0],
      [70, 0, 0, 1],
      [20, 0, 0, -1]
    ]
    for (const [pitch, roll, x, y] of cases) {
      sample(deviceMotion, reading(pitch, roll))
      expect(result.current.getVector().x).toBeCloseTo(x)
      expect(result.current.getVector().y).toBeCloseTo(y)
    }
  })

  it('caps a diagonal at magnitude 1', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    // 20 degrees each way is 0.81 of full scale on each axis, 1.14 together.
    sample(deviceMotion, reading(65, 20))
    const { x, y } = result.current.getVector()
    expect(Math.hypot(x, y)).toBeCloseTo(1)
    expect(x).toBeCloseTo(Math.SQRT1_2)
    expect(y).toBeCloseTo(Math.SQRT1_2)
  })

  it('smooths with the default 60 ms time constant', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion, { smoothingMs: undefined })
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45), 60)
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(45, 25))
    // 60 ms since the capture-time sample: one time constant of a step to full scale.
    expect(result.current.getVector().x).toBeCloseTo(1 - Math.exp(-1), 1)
    for (let i = 0; i < 30; i++) sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeCloseTo(1, 3)
  })

  it('applies the default 0.02 dead zone', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion, { deadZone: undefined })
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    // sin(0.4 degrees) / sin(25 degrees) is about 0.0165, inside 0.02.
    sample(deviceMotion, reading(45, 0.4))
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeCloseTo(1)
  })

  it('flips both axes with invert', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion, { invert: true })
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(55, 10))
    const { x, y } = result.current.getVector()
    expect(x).toBeLessThan(0)
    expect(y).toBeLessThan(0)
  })

  it('maps to screen axes for the interface orientation, read per sample with the held rotation', async () => {
    const deviceMotion = createFakeDeviceMotion()
    let orientation: 0 | 1 | 2 | 3 | 4 = INTERFACE_ORIENTATION.PORTRAIT_UP
    const getInterfaceOrientation = jest.fn(() => orientation)
    const { result } = setup(deviceMotion, { getInterfaceOrientation })
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())

    sample(deviceMotion, { ...reading(45, 25), orientation: -90 })
    expect(getInterfaceOrientation).toHaveBeenLastCalledWith(-90)
    expect(result.current.getVector().x).toBeCloseTo(1)

    // Turned clockwise, the device's right edge points down the screen.
    orientation = INTERFACE_ORIENTATION.LANDSCAPE_LEFT
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeCloseTo(0)
    expect(result.current.getVector().y).toBeCloseTo(1)

    orientation = INTERFACE_ORIENTATION.LANDSCAPE_RIGHT
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().y).toBeCloseTo(-1)

    // A sample with no held rotation hands over 0.
    sample(deviceMotion, { accelerationIncludingGravity: reading(45).accelerationIncludingGravity })
    expect(getInterfaceOrientation).toHaveBeenLastCalledWith(0)
  })

  it('ignores a sample delivered to a listener that has already been removed', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    const staleListener = deviceMotion.addListener.mock.calls[0][0]
    rerender({ deviceMotion, enabled: false, fullScaleDeg: 25, smoothingMs: 0, deadZone: 0 })
    act(() => staleListener(reading(45, 25)))
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })
  })

  it('returns a copy, so a caller mutating it changes nothing', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(45, 10))
    const vector = result.current.getVector()
    vector.x = 99
    expect(result.current.getVector().x).toBeLessThan(1)
  })

  it('zeroes the vector when disabled, and keeps the baseline for when it comes back', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(45, 25))
    rerender({ deviceMotion, enabled: false, fullScaleDeg: 25, smoothingMs: 0, deadZone: 0 })
    expect(result.current.getVector()).toEqual({ x: 0, y: 0 })

    rerender({ deviceMotion, enabled: true, fullScaleDeg: 25, smoothingMs: 0, deadZone: 0 })
    sample(deviceMotion, reading(45, -25))
    expect(result.current.getVector().x).toBeCloseTo(-1)
  })

  it('reads full-scale changes without resubscribing', async () => {
    const deviceMotion = createFakeDeviceMotion()
    const { result, rerender } = setup(deviceMotion)
    await requestAndActivate(deviceMotion, result)
    sample(deviceMotion, reading(45))
    act(() => result.current.captureBaseline())
    rerender({ deviceMotion, enabled: true, fullScaleDeg: 50, smoothingMs: 0, deadZone: 0 })
    sample(deviceMotion, reading(45, 25))
    expect(result.current.getVector().x).toBeCloseTo(Math.sin(rad(25)) / Math.sin(rad(50)))
    expect(deviceMotion.addListener).toHaveBeenCalledTimes(1)
  })
})

describe('useTilt: web sign table', () => {
  async function rollRightOnWeb(userAgent: string, w3c: boolean) {
    Platform.OS = 'web'
    setUserAgent(userAgent)
    const deviceMotion = createFakeDeviceMotion()
    const { result } = setup(deviceMotion)
    let granted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      granted = result.current.request()
    })
    await flushMicrotasks()
    sample(deviceMotion, reading(45, 0, w3c))
    await expect(granted).resolves.toBe(true)
    act(() => result.current.captureBaseline())
    sample(deviceMotion, reading(55, 25, w3c))
    return result.current.getVector()
  }

  it("reads Android Chrome's W3C-convention events the same as native", async () => {
    const vector = await rollRightOnWeb('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', true)
    expect(vector.x).toBeGreaterThan(0.9)
    expect(vector.y).toBeGreaterThan(0)
  })

  it("reads iOS Safari's native-convention events the same as native", async () => {
    const vector = await rollRightOnWeb('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', false)
    expect(vector.x).toBeGreaterThan(0.9)
    expect(vector.y).toBeGreaterThan(0)
  })
})
