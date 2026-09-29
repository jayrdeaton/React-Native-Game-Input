import { length, scale, type Vec2 } from '@tastic/core/math'

export interface AimResult {
  velocity: Vec2
  // How far the drag traveled relative to maxDragPixels, clamped to [0, 1] — a full-strength pull
  // reaches 1 regardless of how much further the finger travels past maxDragPixels.
  power: number
}

// Turns a raw drag vector into a launch velocity, scaled by how far the drag traveled (a
// slingshot/pool-cue pull-and-release feel — power comes from *distance dragged*, not how fast the
// release was; see the sibling computeThrowVelocity for the flick-release alternative). `sign` covers
// both feels of this same mechanic with one function: 1 fires along the drag (a swipe/flick — release
// point is where you're aiming), -1 fires opposite it (a slingshot/pool-cue pull — you drag AWAY from
// where you want to shoot). Confirmed empirically (BoxHockey) that these aren't two different input
// mechanisms, just one drag gesture with a sign flip applied to the finished vector.
export function computeAimVector(drag: Vec2, maxDragPixels: number, maxSpeed: number, sign: 1 | -1 = 1): AimResult {
  const signedDrag = sign === 1 ? drag : { x: -drag.x, y: -drag.y }
  const dist = length(signedDrag)
  if (dist === 0) return { velocity: { x: 0, y: 0 }, power: 0 }
  const power = Math.min(dist / maxDragPixels, 1)
  return { velocity: scale(signedDrag, (power * maxSpeed) / dist), power }
}
