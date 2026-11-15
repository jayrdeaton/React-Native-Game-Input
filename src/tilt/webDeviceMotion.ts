import type { DeviceMotionLike, DeviceMotionMeasurementLike } from './useTilt'

// The parts of the browser's DeviceMotionEvent constructor this reads. requestPermission is iOS
// Safari's (13+), missing from TypeScript's DOM types.
interface DeviceMotionEventConstructorLike {
  requestPermission?: () => Promise<string>
}

// Read at call time, never at import: React Native has no DeviceMotionEvent, and importing this on
// native must be harmless.
function deviceMotionEvent(): DeviceMotionEventConstructorLike | undefined {
  return (globalThis as { DeviceMotionEvent?: DeviceMotionEventConstructorLike }).DeviceMotionEvent
}

// A DeviceMotionLike for the web, built straight on the window's `devicemotion` event, for useTilt's
// `deviceMotion` on web (keep expo-sensors' DeviceMotion for native). expo-sensors 58's own DeviceMotion
// can't be used there: its web module has no addListener, so subscribing throws.
//
// Readings pass through raw, nulls included: useTilt's finite check drops a desktop browser's null
// events, and its TILT_AXIS_SIGNS row (ios-web or android-web) handles the signs, so nothing is flipped
// here. setUpdateInterval does nothing (the browser sets the rate). No `orientation` is reported, so
// getInterfaceOrientation is handed 0.
export function createWebDeviceMotion(): DeviceMotionLike & { isAvailableAsync: () => Promise<boolean> } {
  return {
    // iOS Safari only shows its prompt when requestPermission() is called inside the user's tap, so it
    // is the first thing this does, synchronously. Anything but 'granted' reads as not granted; a
    // rejection (iOS Safari rejects a call made outside a tap) passes through, which useTilt reports as
    // 'unavailable'. Browsers with no permission API need none.
    requestPermissionsAsync: () => {
      const Motion = deviceMotionEvent()
      if (!Motion?.requestPermission) return Promise.resolve({ granted: true })
      return Motion.requestPermission().then((state) => ({ granted: state === 'granted' }))
    },
    // Whether the browser has the API at all. Never waits for an event: before permission iOS Safari
    // sends none, and a desktop browser may send only nulls, so an event probe would answer wrong.
    isAvailableAsync: () => Promise.resolve(deviceMotionEvent() !== undefined),
    addListener: (listener) => {
      const handle = (event: DeviceMotionEvent) => {
        const reading = event.accelerationIncludingGravity
        const measurement: DeviceMotionMeasurementLike = { accelerationIncludingGravity: reading ? { x: reading.x, y: reading.y, z: reading.z } : null }
        listener(measurement)
      }
      window.addEventListener('devicemotion', handle)
      return { remove: () => window.removeEventListener('devicemotion', handle) }
    },
    setUpdateInterval: () => undefined
  }
}
