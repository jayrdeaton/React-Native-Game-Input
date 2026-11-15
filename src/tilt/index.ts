// `@tastic/input/tilt`: the useTilt React hook, and createWebDeviceMotion, the source to give it on web.
// Its own entry because the hook imports react and react-native (optional peers), which the root
// barrel must not load: the root stays pure, React-free and worklet-safe for headless and UI-thread
// callers.
export type { InterfaceOrientationLike } from '../orientation'
export { DEFAULT_TILT_DEAD_ZONE, DEFAULT_TILT_SMOOTHING_MS, type DeviceMotionLike, type DeviceMotionMeasurementLike, type TiltHandle, type TiltStatus, useTilt, type UseTiltOptions } from './useTilt'
export { createWebDeviceMotion } from './webDeviceMotion'
