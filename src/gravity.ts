import type { Vec2 } from '@tastic/core/math'

// A three-axis reading in the device's own frame: expo-sensors DeviceMotion's
// `accelerationIncludingGravity` (m/s^2), or a web `devicemotion` event's. Only its direction is used.
export interface GravityVector {
  x: number
  y: number
  z: number
}

// The screen's tilt in radians (see computeTiltAngles), each how far an edge dips below the horizon,
// within +-90 degrees: roll the device's right edge, pitch its bottom edge. 0/0 is lying flat, face up.
// Positive is the ways a marble on a portrait screen rolls, toward the right and down the screen.
export interface TiltAngles {
  pitch: number
  roll: number
}

// Multiplied into a raw reading, axis by axis, to turn it into the one convention computeTiltAngles
// reads: x along the device's right edge, y along its bottom edge, z out of the screen, and the
// vector pointing the way gravity pulls in x/y while z is positive lying flat face up.
export interface TiltAxisSigns {
  x: 1 | -1
  y: 1 | -1
  z: 1 | -1
}

// Where the reading comes from, since the platforms disagree on its signs (see TILT_AXIS_SIGNS).
// 'android-web' is the W3C convention, so it also covers every other non-iOS browser.
export type TiltPlatform = 'native' | 'ios-web' | 'android-web'

// Per-platform defaults, from expo-sensors' source and the W3C spec. To be confirmed on real devices
// (iOS Safari and Android Chrome above all); nothing in a simulator or jsdom can check them.
//   native: expo-sensors normalizes both platforms to the gravity direction (iOS passes CoreMotion's
//     (userAcceleration + gravity) * g through, Android sends accel - 2 * gravity), so lying flat
//     face up reads z = -9.8 and the right edge lowered reads +x. Device +y points up the screen, so
//     y flips to point down it, and z flips to read positive face up.
//   ios-web: WebKit has historically reported the same signs as native rather than the spec's.
//   android-web: expo-sensors passes the browser's event through raw, and the W3C spec reports the
//     reaction to gravity (flat face up reads z = +9.8), every axis the opposite of native, so x
//     flips back and y and z need no flip.
export const TILT_AXIS_SIGNS: Record<TiltPlatform, TiltAxisSigns> = {
  native: { x: 1, y: -1, z: -1 },
  'ios-web': { x: 1, y: -1, z: -1 },
  'android-web': { x: -1, y: 1, z: 1 }
}

// Picks the TILT_AXIS_SIGNS row. `os` is React Native's Platform.OS; on 'web', the browser's
// navigator.userAgent and navigator.maxTouchPoints tell iOS apart (iPadOS Safari reports a Mac user
// agent, so a Mac one with touch points counts as iOS). Every browser on iOS is WebKit, so Chrome and
// Firefox there read 'ios-web' too.
export function resolveTiltPlatform(os: string, userAgent = '', maxTouchPoints = 0): TiltPlatform {
  'worklet'
  if (os !== 'web') return 'native'
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios-web'
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios-web'
  return 'android-web'
}

// Turns a raw gravity reading into pitch/roll angles, `signs` being the TILT_AXIS_SIGNS row for where
// it came from: roll = atan2(x, hypot(y, z)) and pitch = atan2(y, hypot(x, z)), the right and bottom
// edges' dips (asin of gravity's share along each). Both read 0 lying flat and are continuous at every
// hold. Roll used to be atan2(x, z), an Euler roll like DeviceMotion's gamma: held upright z is near
// 0, so it swung tens of degrees on a tremor, and past vertical it jumped by 180, which turned left
// into right (PuckTastic's paddle pinned at one end on Jay's Android, 2026-11-15, from the same angle).
// Each dip is what a marble on the screen feels along that edge, so rolling about the long axis from a
// pitched hold moves roll by less than the turn: cos(pitch) of it for a small one (a 25 degree turn
// from a 45 degree hold dips the right edge 17.4 degrees), and pitch not at all.
export function computeTiltAngles(gravity: GravityVector, signs: TiltAxisSigns): TiltAngles {
  'worklet'
  const x = gravity.x * signs.x
  const y = gravity.y * signs.y
  const z = gravity.z * signs.z
  return { pitch: Math.atan2(y, Math.hypot(x, z)), roll: Math.atan2(x, Math.hypot(y, z)) }
}

// The mean of a window of angle samples, for a baseline (the hold the player calls level). A plain
// mean: both angles stay within +-90 degrees (see computeTiltAngles), so there's no +-180 seam to
// average across. null for an empty window.
export function averageTiltAngles(samples: readonly TiltAngles[]): TiltAngles | null {
  'worklet'
  if (samples.length === 0) return null
  let pitch = 0
  let roll = 0
  for (const sample of samples) {
    pitch += sample.pitch
    roll += sample.roll
  }
  return { pitch: pitch / samples.length, roll: roll / samples.length }
}

// Shortens a vector longer than `max` to that length, keeping its direction. A per-axis clamp
// instead would let a diagonal reach sqrt(2), 41% more than a straight tilt.
function capMagnitude(vector: Vec2, max: number): Vec2 {
  'worklet'
  const magnitude = Math.hypot(vector.x, vector.y)
  if (magnitude <= max) return { x: vector.x, y: vector.y }
  return { x: (vector.x * max) / magnitude, y: (vector.y * max) / magnitude }
}

// The tilt away from `baseline`, in the device frame (x toward its right edge, y toward its bottom
// edge), as a fraction of full scale with its magnitude capped at 1: (sin(roll - roll0),
// sin(pitch - pitch0)) / sin(fullScaleDeg). Taking the difference as angles rather than subtracting
// raw vectors keeps the whole range reachable from a tilted hold: in raw sin-space a 45 degree hold
// reaches only 69% of full scale toward vertical. fullScaleDeg is clamped to 90; 0 or less gives zero.
export function computeTiltVector(angles: TiltAngles, baseline: TiltAngles, fullScaleDeg: number): Vec2 {
  'worklet'
  if (!(fullScaleDeg > 0)) return { x: 0, y: 0 }
  const fullScale = Math.sin((Math.min(fullScaleDeg, 90) * Math.PI) / 180)
  const tilt = { x: Math.sin(angles.roll - baseline.roll) / fullScale, y: Math.sin(angles.pitch - baseline.pitch) / fullScale }
  return capMagnitude(tilt, 1)
}
