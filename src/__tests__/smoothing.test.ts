import { applyExponentialSmoothing, applyRadialDeadZone } from '../smoothing'

const length = (v: { x: number; y: number }) => Math.hypot(v.x, v.y)

describe('applyRadialDeadZone', () => {
  it('zeroes anything inside the dead zone, and its edge', () => {
    expect(applyRadialDeadZone({ x: 0.01, y: 0.01 }, 0.02)).toEqual({ x: 0, y: 0 })
    expect(applyRadialDeadZone({ x: 0.02, y: 0 }, 0.02)).toEqual({ x: 0, y: 0 })
    expect(applyRadialDeadZone({ x: 0, y: 0 }, 0.02)).toEqual({ x: 0, y: 0 })
  })

  it('is continuous at the edge: just outside it reads just above 0, not a jump', () => {
    const justOutside = applyRadialDeadZone({ x: 0.0201, y: 0 }, 0.02)
    expect(justOutside.x).toBeGreaterThan(0)
    expect(justOutside.x).toBeCloseTo(0.0001 / 0.98, 6)
  })

  it('rescales so a magnitude of 1 still reads 1', () => {
    expect(length(applyRadialDeadZone({ x: 1, y: 0 }, 0.2))).toBeCloseTo(1)
    expect(length(applyRadialDeadZone({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }, 0.2))).toBeCloseTo(1)
  })

  it('maps the range linearly between the edge and 1', () => {
    expect(applyRadialDeadZone({ x: 0, y: 0.6 }, 0.2).y).toBeCloseTo(0.5)
  })

  it('keeps direction (radial, not per-axis)', () => {
    const out = applyRadialDeadZone({ x: 0.3, y: 0.4 }, 0.1)
    expect(out.y / out.x).toBeCloseTo(0.4 / 0.3)
  })

  it('keeps a small diagonal whose axes are each inside the dead zone', () => {
    const out = applyRadialDeadZone({ x: 0.08, y: 0.08 }, 0.1)
    expect(length(out)).toBeGreaterThan(0)
  })

  it('passes everything through with no dead zone, and zeroes everything with a dead zone of 1 or more', () => {
    expect(applyRadialDeadZone({ x: 0.3, y: -0.1 }, 0)).toEqual({ x: 0.3, y: -0.1 })
    expect(applyRadialDeadZone({ x: 2, y: 0 }, 1)).toEqual({ x: 0, y: 0 })
  })

  it('leaves magnitudes past 1 past 1 (capping is separate)', () => {
    expect(applyRadialDeadZone({ x: 2, y: 0 }, 0.2).x).toBeGreaterThan(1)
  })
})

describe('applyExponentialSmoothing', () => {
  const zero = { x: 0, y: 0 }
  const target = { x: 1, y: -0.5 }

  it('covers 1 - 1/e of a step change in one time constant', () => {
    const out = applyExponentialSmoothing(zero, target, 60, 60)
    expect(out.x).toBeCloseTo(1 - Math.exp(-1))
    expect(out.y).toBeCloseTo(-0.5 * (1 - Math.exp(-1)))
  })

  it('converges on the target', () => {
    let value = zero
    for (let frame = 0; frame < 60; frame++) value = applyExponentialSmoothing(value, target, 16, 60)
    expect(value.x).toBeCloseTo(1, 5)
    expect(value.y).toBeCloseTo(-0.5, 5)
  })

  it('is frame-rate independent: many short steps equal one long one', () => {
    let fine = zero
    for (let step = 0; step < 12; step++) fine = applyExponentialSmoothing(fine, target, 5, 60)
    const coarse = applyExponentialSmoothing(zero, target, 60, 60)
    expect(fine.x).toBeCloseTo(coarse.x)
    expect(fine.y).toBeCloseTo(coarse.y)
  })

  it('jumps to the target with no time constant, and holds still with no elapsed time', () => {
    expect(applyExponentialSmoothing(zero, target, 16, 0)).toEqual(target)
    expect(applyExponentialSmoothing(zero, target, 0, 60)).toEqual(zero)
    expect(applyExponentialSmoothing(zero, target, -5, 60)).toEqual(zero)
  })
})
