import type { Vec2 } from '@tastic/core/math'

// A radial dead zone: anything within `deadZone` of the centre reads as zero, and the rest is
// rescaled so the output starts from 0 at the dead zone's edge (no jump) and still reaches 1 at a
// magnitude of 1 (a plain subtract-and-clamp would leave the last `deadZone` of range unreachable).
// Radial rather than per-axis, so a diagonal isn't snapped onto an axis near the centre. Magnitudes
// past 1 come out past 1; cap them separately. A deadZone of 1 or more zeroes everything.
export function applyRadialDeadZone(vector: Vec2, deadZone: number): Vec2 {
  'worklet'
  const magnitude = Math.hypot(vector.x, vector.y)
  if (deadZone <= 0) return { x: vector.x, y: vector.y }
  if (deadZone >= 1 || magnitude <= deadZone) return { x: 0, y: 0 }
  const factor = (magnitude - deadZone) / (1 - deadZone) / magnitude
  return { x: vector.x * factor, y: vector.y * factor }
}

// One step of an exponential moving average toward `target`, frame-rate independent: after `dtMs`
// the remaining gap shrinks by exp(-dtMs / timeConstantMs), so the smoothing feels the same at any
// sensor rate (about 63% of a step change in one time constant, 95% in three). A time constant of 0
// or less returns `target` (no smoothing); a dt of 0 or less returns `previous` unchanged.
export function applyExponentialSmoothing(previous: Vec2, target: Vec2, dtMs: number, timeConstantMs: number): Vec2 {
  'worklet'
  const alpha = timeConstantMs <= 0 ? 1 : 1 - Math.exp(-Math.max(dtMs, 0) / timeConstantMs)
  return { x: previous.x + (target.x - previous.x) * alpha, y: previous.y + (target.y - previous.y) * alpha }
}
