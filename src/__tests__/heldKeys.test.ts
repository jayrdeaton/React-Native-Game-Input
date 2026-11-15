import type { Direction } from '../direction'
import { HELD_KEY_RAMP_MS, rampHeldKeyTilt, resolveHeldKeyTilt } from '../heldKeys'

function expectVec(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x)
  expect(actual.y).toBeCloseTo(y)
}

describe('resolveHeldKeyTilt', () => {
  it('is zero with nothing held', () => {
    expectVec(resolveHeldKeyTilt([]), 0, 0)
  })

  it('maps each direction to a screen-axis unit vector (+y is down)', () => {
    expectVec(resolveHeldKeyTilt(['up']), 0, -1)
    expectVec(resolveHeldKeyTilt(['down']), 0, 1)
    expectVec(resolveHeldKeyTilt(['left']), -1, 0)
    expectVec(resolveHeldKeyTilt(['right']), 1, 0)
  })

  it('normalizes a diagonal to length 1', () => {
    const v = resolveHeldKeyTilt(new Set<Direction>(['up', 'right']))
    expectVec(v, Math.SQRT1_2, -Math.SQRT1_2)
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1)
  })

  it('cancels opposite keys held together', () => {
    expectVec(resolveHeldKeyTilt(['left', 'right']), 0, 0)
    expectVec(resolveHeldKeyTilt(['left', 'right', 'down']), 0, 1)
    expectVec(resolveHeldKeyTilt(['up', 'down', 'left', 'right']), 0, 0)
  })

  it('counts a direction listed twice once', () => {
    expectVec(resolveHeldKeyTilt(['right', 'right', 'down']), Math.SQRT1_2, Math.SQRT1_2)
  })
})

describe('rampHeldKeyTilt', () => {
  const rest = { x: 0, y: 0 }
  const right = { x: 1, y: 0 }

  it('defaults to a 150 ms ramp', () => {
    expect(HELD_KEY_RAMP_MS).toBe(150)
  })

  it('reaches half strength at half the ramp and full strength at the ramp', () => {
    expectVec(rampHeldKeyTilt(rest, right, 75), 0.5, 0)
    expectVec(rampHeldKeyTilt(rest, right, 150), 1, 0)
  })

  it('takes about 150 ms of 60 Hz frames to reach full, and not much less', () => {
    let value = rest
    let elapsed = 0
    while (value.x < 1) {
      value = rampHeldKeyTilt(value, right, 1000 / 60)
      elapsed += 1000 / 60
    }
    expect(elapsed).toBeCloseTo(150, 0)
    expect(rampHeldKeyTilt(rest, right, 140).x).toBeLessThan(1)
  })

  it('never overshoots the target', () => {
    expectVec(rampHeldKeyTilt(rest, right, 1000), 1, 0)
  })

  it('ramps a diagonal to full (length 1) in the same time as a straight press', () => {
    const diagonal = resolveHeldKeyTilt(['down', 'left'])
    const half = rampHeldKeyTilt(rest, diagonal, 75)
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5)
    const full = rampHeldKeyTilt(rest, diagonal, 150)
    expectVec(full, -Math.SQRT1_2, Math.SQRT1_2)
  })

  it('eases back to rest on release over the same ramp', () => {
    expectVec(rampHeldKeyTilt(right, rest, 75), 0.5, 0)
    expectVec(rampHeldKeyTilt(right, rest, 150), 0, 0)
  })

  it('takes a custom ramp time, and jumps with a ramp of 0', () => {
    expectVec(rampHeldKeyTilt(rest, right, 150, 300), 0.5, 0)
    expectVec(rampHeldKeyTilt(rest, right, 1, 0), 1, 0)
  })

  it('stays put with no elapsed time', () => {
    expectVec(rampHeldKeyTilt(rest, right, 0), 0, 0)
    expectVec(rampHeldKeyTilt(rest, right, -16), 0, 0)
  })
})
