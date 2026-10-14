import { computeThrowVelocity } from '../throw'

describe('computeThrowVelocity', () => {
  it('scales the raw velocity by the conversion factor when under maxSpeed', () => {
    const result = computeThrowVelocity({ x: 100, y: 0 }, 0.5, 1000)
    expect(result).toEqual({ x: 50, y: 0 })
  })

  it('caps the scaled velocity at maxSpeed, preserving direction', () => {
    const result = computeThrowVelocity({ x: 1000, y: 0 }, 1, 200)
    expect(result.x).toBeCloseTo(200)
  })

  it('a fast short flick and a slow long drag with the same raw velocity produce the same throw', () => {
    // computeThrowVelocity only ever sees the reported velocity, not distance/duration - this is
    // exactly what distinguishes it from computeAimVector's distance-based power.
    const result = computeThrowVelocity({ x: 300, y: 0 }, 1, 1000)
    expect(result.x).toBeCloseTo(300)
  })
})
