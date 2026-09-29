import type { Vec2 } from '@tastic/core/math'

export type Direction = 'up' | 'down' | 'left' | 'right'

// Compares the magnitude of each axis of a translation vector to pick its dominant axis, then the
// sign of that axis for direction. Returns null for a drag too short to count as an intentional
// swipe (below minSwipeDistance on both axes) — the vector doesn't have to span a whole gesture
// end-to-end; feeding it per-segment deltas within one continuous touch (resetting the baseline after
// each recognized swipe) lets a player chain several turns without lifting their finger.
export function resolveSwipeDirection(translation: Vec2, minSwipeDistance: number): Direction | null {
  'worklet'
  if (Math.abs(translation.x) < minSwipeDistance && Math.abs(translation.y) < minSwipeDistance) return null
  if (Math.abs(translation.x) > Math.abs(translation.y)) {
    return translation.x > 0 ? 'right' : 'left'
  }
  return translation.y > 0 ? 'down' : 'up'
}

export function flipDirection(direction: Direction): Direction {
  'worklet'
  switch (direction) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

export function isOppositeDirection(a: Direction, b: Direction): boolean {
  'worklet'
  return flipDirection(a) === b
}

// A uniform transform every input source can run a resolved direction through identically before it
// reaches game logic — e.g. a "controls reversed" effect. Kept generic (a plain boolean flip) rather
// than baking in any specific game mechanic's name or semantics; a consuming game applies whatever
// condition should trigger the inversion.
export function applyControlInversion(direction: Direction, inverted: boolean): Direction {
  'worklet'
  return inverted ? flipDirection(direction) : direction
}

// Whether a resolved direction would actually turn something currently heading `currentDirection` —
// i.e. it isn't a no-op continuation (already heading that way) or a direct reversal into your own
// trail/self. Lets an input layer gate turn feedback (sound/haptic) on a swipe/key that will actually
// change something, rather than firing it for every recognized direction and letting downstream game
// logic silently no-op the ones that don't.
export function isEffectiveTurn(direction: Direction, currentDirection: Direction): boolean {
  'worklet'
  return direction !== currentDirection && !isOppositeDirection(direction, currentDirection)
}
