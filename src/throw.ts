import { length, scale, type Vec2 } from '@tastic/core/math'

// Turns a raw release velocity (as reported by a gesture recognizer's own velocity tracking — e.g.
// react-native-gesture-handler's Pan `velocityX`/`velocityY` at `onEnd`, typically in screen px/sec)
// into a launch velocity in game units, scaled and capped at maxSpeed. The flick/throw counterpart to
// computeAimVector's pull-and-release: power comes from *how fast* the release was, not how far the
// drag traveled, so a quick short flick throws harder than a slow long drag of the same distance —
// the feel a "grab and throw" mechanic wants, where computeAimVector's distance-based power would
// feel identical regardless of speed. `pixelsPerSecondToGameUnit` converts the gesture system's raw
// velocity units into whatever your own game's velocity is expressed in — tune it by feel, same as
// any other gesture-calibration constant.
export function computeThrowVelocity(rawVelocity: Vec2, pixelsPerSecondToGameUnit: number, maxSpeed: number): Vec2 {
  const scaled = scale(rawVelocity, pixelsPerSecondToGameUnit)
  const speed = length(scaled)
  return speed > maxSpeed ? scale(scaled, maxSpeed / speed) : scaled
}
