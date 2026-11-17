import { normalize, type Vec2 } from '@tastic/core/math'

import type { Direction } from './direction'

// How long rampHeldKeyTilt takes to go from rest to a full-strength direction.
export const HELD_KEY_RAMP_MS = 150

// The tilt a set of held direction keys asks for, in screen axes (+x right, +y down): a unit vector,
// so a diagonal (two keys) is as strong as one key, not 41% stronger. Opposite keys held together
// cancel on that axis, and a direction listed twice counts once. Build the set from keydown/keyup
// with resolveKeyDirection or resolveSchemeDirection; this only reads it.
export function resolveHeldKeyTilt(held: Iterable<Direction>): Vec2 {
  'worklet'
  let up = false
  let down = false
  let left = false
  let right = false
  for (const direction of held) {
    if (direction === 'up') up = true
    else if (direction === 'down') down = true
    else if (direction === 'left') left = true
    else right = true
  }
  return normalize({ x: Number(right) - Number(left), y: Number(down) - Number(up) })
}

// Moves the current key tilt toward resolveHeldKeyTilt's target at a fixed rate, so a press eases in
// like tipping a board instead of snapping, and a release eases back out the same way: 0 to a full
// direction (straight or diagonal) takes rampMs, and a reversal straight through takes twice that.
// Call it every frame with that frame's dt. A rampMs of 0 or less jumps straight to the target.
export function rampHeldKeyTilt(current: Vec2, target: Vec2, dtMs: number, rampMs: number = HELD_KEY_RAMP_MS): Vec2 {
  'worklet'
  const dx = target.x - current.x
  const dy = target.y - current.y
  const gap = Math.hypot(dx, dy)
  const maxStep = rampMs <= 0 ? Infinity : Math.max(dtMs, 0) / rampMs
  if (gap <= maxStep) return { x: target.x, y: target.y }
  return { x: current.x + (dx * maxStep) / gap, y: current.y + (dy * maxStep) / gap }
}
