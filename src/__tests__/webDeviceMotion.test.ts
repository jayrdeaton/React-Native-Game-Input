import { act, renderHook } from '@testing-library/react'
import { Platform } from 'react-native'

import { createWebDeviceMotion, type DeviceMotionMeasurementLike, useTilt } from '../tilt'

const G = 9.80665
const rad = (deg: number) => (deg * Math.PI) / 180

// jsdom has no DeviceMotionEvent; each test installs the fake it needs on the global.
const globals = globalThis as { DeviceMotionEvent?: unknown }
const originalDeviceMotionEvent = globals.DeviceMotionEvent
const originalUserAgent = navigator.userAgent

function installDeviceMotionEvent(requestPermission?: () => Promise<string>) {
  const Motion = class FakeDeviceMotionEvent {}
  if (requestPermission) Object.assign(Motion, { requestPermission })
  globals.DeviceMotionEvent = Motion
  return Motion
}

// A `devicemotion` event as a browser fires it: jsdom has no DeviceMotionEvent, so a plain Event with
// the one field the adapter reads.
function fireMotion(accelerationIncludingGravity: { x: number | null; y: number | null; z: number | null } | null) {
  const event = new Event('devicemotion')
  Object.defineProperty(event, 'accelerationIncludingGravity', { value: accelerationIncludingGravity })
  window.dispatchEvent(event)
}

// The W3C reading (Android Chrome: the reaction to gravity, flat face up reads z = +g) for a device
// held with its bottom edge dipped pitchDeg below the horizon and its right edge dipped rollDeg, screen up.
function w3cReading(pitchDeg: number, rollDeg = 0) {
  const x = Math.sin(rad(rollDeg))
  const y = Math.sin(rad(pitchDeg))
  if (x * x + y * y > 1) throw new Error(`no hold dips ${rollDeg} and pitches ${pitchDeg}`)
  return { x: -G * x, y: G * y, z: G * Math.sqrt(1 - x * x - y * y) }
}

beforeEach(() => {
  delete globals.DeviceMotionEvent
})

afterEach(() => {
  if (originalDeviceMotionEvent === undefined) delete globals.DeviceMotionEvent
  else globals.DeviceMotionEvent = originalDeviceMotionEvent
  Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true })
  Platform.OS = 'ios'
  jest.restoreAllMocks()
})

describe('createWebDeviceMotion', () => {
  it('touches no window API until addListener (safe to create on native, at module scope)', async () => {
    const addEventListener = jest.spyOn(window, 'addEventListener')
    const motion = createWebDeviceMotion()
    motion.setUpdateInterval(16)
    await motion.isAvailableAsync()
    await motion.requestPermissionsAsync()
    expect(addEventListener).not.toHaveBeenCalled()
  })

  describe('requestPermissionsAsync', () => {
    it('calls DeviceMotionEvent.requestPermission synchronously, as a method, and maps granted', async () => {
      const requestPermission = jest.fn(() => Promise.resolve('granted'))
      const Motion = installDeviceMotionEvent(requestPermission)
      const result = createWebDeviceMotion().requestPermissionsAsync()
      // Already called, with nothing awaited: iOS Safari only prompts from inside the user's tap.
      expect(requestPermission).toHaveBeenCalledTimes(1)
      expect(requestPermission.mock.contexts[0]).toBe(Motion)
      await expect(result).resolves.toEqual({ granted: true })
    })

    it.each(['denied', 'default', 'prompt'])('reads %s as not granted', async (state) => {
      installDeviceMotionEvent(() => Promise.resolve(state))
      await expect(createWebDeviceMotion().requestPermissionsAsync()).resolves.toEqual({ granted: false })
    })

    it('passes a rejection through (iOS Safari rejects a call made outside a tap)', async () => {
      installDeviceMotionEvent(() => Promise.reject(new Error('NotAllowedError')))
      await expect(createWebDeviceMotion().requestPermissionsAsync()).rejects.toThrow('NotAllowedError')
    })

    it('resolves granted where there is no permission API (Android Chrome, desktop)', async () => {
      installDeviceMotionEvent()
      await expect(createWebDeviceMotion().requestPermissionsAsync()).resolves.toEqual({ granted: true })
    })

    it('resolves granted where there is no DeviceMotionEvent at all', async () => {
      await expect(createWebDeviceMotion().requestPermissionsAsync()).resolves.toEqual({ granted: true })
    })
  })

  describe('isAvailableAsync', () => {
    it('resolves whether DeviceMotionEvent exists, without waiting for an event', async () => {
      const addEventListener = jest.spyOn(window, 'addEventListener')
      await expect(createWebDeviceMotion().isAvailableAsync()).resolves.toBe(false)
      installDeviceMotionEvent()
      await expect(createWebDeviceMotion().isAvailableAsync()).resolves.toBe(true)
      expect(addEventListener).not.toHaveBeenCalled()
    })
  })

  describe('addListener', () => {
    it("hands each devicemotion event's accelerationIncludingGravity to the listener, raw", () => {
      const listener = jest.fn<void, [DeviceMotionMeasurementLike]>()
      const subscription = createWebDeviceMotion().addListener(listener)
      fireMotion({ x: -1.5, y: 6.9, z: 6.9 })
      expect(listener).toHaveBeenCalledWith({ accelerationIncludingGravity: { x: -1.5, y: 6.9, z: 6.9 } })
      subscription.remove()
    })

    it('passes null axes and a null reading through, for the hook to reject', () => {
      const listener = jest.fn<void, [DeviceMotionMeasurementLike]>()
      const subscription = createWebDeviceMotion().addListener(listener)
      fireMotion({ x: null, y: null, z: null })
      fireMotion(null)
      expect(listener.mock.calls).toEqual([[{ accelerationIncludingGravity: { x: null, y: null, z: null } }], [{ accelerationIncludingGravity: null }]])
      subscription.remove()
    })

    it('stops delivering after remove(), without touching other listeners', () => {
      const motion = createWebDeviceMotion()
      const first = jest.fn()
      const second = jest.fn()
      const firstSubscription = motion.addListener(first)
      const secondSubscription = motion.addListener(second)
      firstSubscription.remove()
      fireMotion({ x: 0, y: 0, z: G })
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
      secondSubscription.remove()
      fireMotion({ x: 0, y: 0, z: G })
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  it('treats setUpdateInterval as a no-op', () => {
    const addEventListener = jest.spyOn(window, 'addEventListener')
    expect(createWebDeviceMotion().setUpdateInterval(16)).toBeUndefined()
    expect(addEventListener).not.toHaveBeenCalled()
  })
})

describe('createWebDeviceMotion with useTilt on web', () => {
  // Created once, outside render: a new object every render would resubscribe every render.
  const webDeviceMotion = createWebDeviceMotion()

  function renderOnWeb(userAgent: string) {
    Platform.OS = 'web'
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
    return renderHook(() => useTilt({ deviceMotion: webDeviceMotion, enabled: true, fullScaleDeg: 25, smoothingMs: 0, deadZone: 0 }))
  }

  it('goes active on Android Chrome and reads a roll right as +x through the android-web sign row', async () => {
    installDeviceMotionEvent()
    const { result, unmount } = renderOnWeb('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    let granted: Promise<boolean> = Promise.resolve(false)
    act(() => {
      granted = result.current.request()
    })
    await act(() => Promise.resolve())
    act(() => fireMotion({ x: null, y: null, z: null }))
    expect(result.current.status).toBe('requesting')
    act(() => fireMotion(w3cReading(45)))
    await expect(granted).resolves.toBe(true)
    expect(result.current.status).toBe('active')

    act(() => result.current.captureBaseline())
    act(() => fireMotion(w3cReading(45, 25)))
    expect(result.current.getVector().x).toBeCloseTo(1)
    expect(result.current.getVector().y).toBeCloseTo(0)
    unmount()
  })

  it('reads a refused iOS Safari prompt as denied', async () => {
    const requestPermission = jest.fn(() => Promise.resolve('denied'))
    installDeviceMotionEvent(requestPermission)
    const { result, unmount } = renderOnWeb('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
    let granted: Promise<boolean> = Promise.resolve(true)
    act(() => {
      granted = result.current.request()
      expect(requestPermission).toHaveBeenCalledTimes(1)
    })
    await act(() => Promise.resolve())
    await expect(granted).resolves.toBe(false)
    expect(result.current.status).toBe('denied')
    unmount()
  })
})
