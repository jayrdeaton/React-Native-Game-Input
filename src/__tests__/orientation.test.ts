import { INTERFACE_ORIENTATION, remapTiltToScreenAxes } from '../orientation'

// A tilt toward the device's right edge, and one toward its bottom edge, in the device frame.
const towardRightEdge = { x: 1, y: 0 }
const towardBottomEdge = { x: 0, y: 1 }

function expectVec(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x)
  expect(actual.y).toBeCloseTo(y)
}

describe('INTERFACE_ORIENTATION', () => {
  it("uses the numbers of expo-screen-orientation's Orientation enum", () => {
    expect(INTERFACE_ORIENTATION).toEqual({ UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 })
  })
})

describe('remapTiltToScreenAxes', () => {
  it('leaves portrait unchanged', () => {
    expectVec(remapTiltToScreenAxes(towardRightEdge, INTERFACE_ORIENTATION.PORTRAIT_UP), 1, 0)
    expectVec(remapTiltToScreenAxes(towardBottomEdge, INTERFACE_ORIENTATION.PORTRAIT_UP), 0, 1)
  })

  it('reads UNKNOWN as portrait', () => {
    expectVec(remapTiltToScreenAxes({ x: 0.3, y: -0.4 }, INTERFACE_ORIENTATION.UNKNOWN), 0.3, -0.4)
  })

  it('turns both axes around upside down', () => {
    expectVec(remapTiltToScreenAxes(towardRightEdge, INTERFACE_ORIENTATION.PORTRAIT_DOWN), -1, 0)
    expectVec(remapTiltToScreenAxes(towardBottomEdge, INTERFACE_ORIENTATION.PORTRAIT_DOWN), 0, -1)
  })

  it('in LANDSCAPE_RIGHT (turned counter-clockwise), the bottom edge is screen right and the right edge is screen up', () => {
    expectVec(remapTiltToScreenAxes(towardBottomEdge, INTERFACE_ORIENTATION.LANDSCAPE_RIGHT), 1, 0)
    expectVec(remapTiltToScreenAxes(towardRightEdge, INTERFACE_ORIENTATION.LANDSCAPE_RIGHT), 0, -1)
  })

  it('in LANDSCAPE_LEFT (turned clockwise), the bottom edge is screen left and the right edge is screen down', () => {
    expectVec(remapTiltToScreenAxes(towardBottomEdge, INTERFACE_ORIENTATION.LANDSCAPE_LEFT), -1, 0)
    expectVec(remapTiltToScreenAxes(towardRightEdge, INTERFACE_ORIENTATION.LANDSCAPE_LEFT), 0, 1)
  })

  it("matches @tastic/core's tiltToScreenAxes(gamma, beta) table, with gamma as x and beta as y", () => {
    const gamma = 0.2
    const beta = -0.7
    expectVec(remapTiltToScreenAxes({ x: gamma, y: beta }, INTERFACE_ORIENTATION.LANDSCAPE_RIGHT), beta, -gamma)
    expectVec(remapTiltToScreenAxes({ x: gamma, y: beta }, INTERFACE_ORIENTATION.LANDSCAPE_LEFT), -beta, gamma)
    expectVec(remapTiltToScreenAxes({ x: gamma, y: beta }, INTERFACE_ORIENTATION.PORTRAIT_DOWN), -gamma, -beta)
  })

  it('never changes the magnitude', () => {
    for (const orientation of Object.values(INTERFACE_ORIENTATION)) {
      const out = remapTiltToScreenAxes({ x: 0.6, y: 0.3 }, orientation)
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(Math.hypot(0.6, 0.3))
    }
  })
})
