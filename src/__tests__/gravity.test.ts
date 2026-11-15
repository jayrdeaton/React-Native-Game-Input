import { averageTiltAngles, computeTiltAngles, computeTiltVector, resolveTiltPlatform, TILT_AXIS_SIGNS, type TiltAngles } from '../gravity'

const G = 9.80665
const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (radians: number) => (radians * 180) / Math.PI

// A device held with its bottom edge lowered by pitchDeg (a normal hold tips the top away from the
// floor), then rolled about its own long axis by rollDeg (right edge down), as each platform reports
// it. native and iOS Safari report the direction gravity pulls (flat face up: z = -g); the W3C spec,
// which Android Chrome follows, reports the reaction (flat face up: z = +g).
function nativeReading(pitchDeg: number, rollDeg: number) {
  const p = rad(pitchDeg)
  const r = rad(rollDeg)
  return { x: G * Math.cos(p) * Math.sin(r), y: -G * Math.sin(p), z: -G * Math.cos(p) * Math.cos(r) }
}

function w3cReading(pitchDeg: number, rollDeg: number) {
  const { x, y, z } = nativeReading(pitchDeg, rollDeg)
  return { x: -x, y: -y, z: -z }
}

const anglesOf = (pitchDeg: number, rollDeg: number): TiltAngles => computeTiltAngles(nativeReading(pitchDeg, rollDeg), TILT_AXIS_SIGNS.native)

// How far the right edge dips for nativeReading's pose: rolling about the long axis from a pitched hold
// dips it by less than the turn.
const dipOf = (pitchDeg: number, rollDeg: number) => deg(Math.asin(Math.cos(rad(pitchDeg)) * Math.sin(rad(rollDeg))))

// A hold given by how far the bottom edge dips (pitchDeg, the top raised) and how far the right edge
// dips (dipDeg), with the screen facing up (true) or tipped past vertical (false), as native reports it.
// The two edges are square to each other, so a hold where both are steep doesn't exist.
function heldReading(pitchDeg: number, dipDeg: number, faceUp = true) {
  const x = Math.sin(rad(dipDeg))
  const y = Math.sin(rad(pitchDeg))
  if (x * x + y * y > 1) throw new Error(`no hold dips ${dipDeg} and pitches ${pitchDeg}`)
  const z = (faceUp ? 1 : -1) * Math.sqrt(1 - x * x - y * y)
  return { x: G * x, y: -G * y, z: -G * z }
}

const heldAngles = (pitchDeg: number, dipDeg: number, faceUp = true): TiltAngles => computeTiltAngles(heldReading(pitchDeg, dipDeg, faceUp), TILT_AXIS_SIGNS.native)

describe('TILT_AXIS_SIGNS', () => {
  it('flips y and z on native and iOS web, and only x on Android web (the W3C convention)', () => {
    expect(TILT_AXIS_SIGNS.native).toEqual({ x: 1, y: -1, z: -1 })
    expect(TILT_AXIS_SIGNS['ios-web']).toEqual({ x: 1, y: -1, z: -1 })
    expect(TILT_AXIS_SIGNS['android-web']).toEqual({ x: -1, y: 1, z: 1 })
  })

  it.each([
    [0, 0],
    [45, 0],
    [45, 20],
    [10, -30],
    [-15, 25]
  ])('reads the same physical pose (pitch %d, roll %d) as the same angles on every platform', (pitchDeg, rollDeg) => {
    const native = computeTiltAngles(nativeReading(pitchDeg, rollDeg), TILT_AXIS_SIGNS.native)
    const ios = computeTiltAngles(nativeReading(pitchDeg, rollDeg), TILT_AXIS_SIGNS['ios-web'])
    const android = computeTiltAngles(w3cReading(pitchDeg, rollDeg), TILT_AXIS_SIGNS['android-web'])
    for (const angles of [native, ios, android]) {
      expect(deg(angles.pitch)).toBeCloseTo(pitchDeg)
      expect(deg(angles.roll)).toBeCloseTo(dipOf(pitchDeg, rollDeg))
    }
  })
})

describe('resolveTiltPlatform', () => {
  it('is native off the web, whatever the user agent', () => {
    expect(resolveTiltPlatform('ios')).toBe('native')
    expect(resolveTiltPlatform('android', 'Mozilla/5.0 (iPhone)')).toBe('native')
  })

  it('reads iPhone, iPad and iPod user agents as iOS web', () => {
    expect(resolveTiltPlatform('web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('ios-web')
    expect(resolveTiltPlatform('web', 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)')).toBe('ios-web')
    expect(resolveTiltPlatform('web', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X)')).toBe('ios-web')
  })

  it('reads an iPadOS Safari "Macintosh" user agent with touch points as iOS web, but not a real Mac', () => {
    const macAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    expect(resolveTiltPlatform('web', macAgent, 5)).toBe('ios-web')
    expect(resolveTiltPlatform('web', macAgent, 0)).toBe('android-web')
    expect(resolveTiltPlatform('web', macAgent)).toBe('android-web')
  })

  it('reads Android Chrome, and any other browser, as the W3C convention', () => {
    expect(resolveTiltPlatform('web', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 5)).toBe('android-web')
    expect(resolveTiltPlatform('web')).toBe('android-web')
  })
})

describe('computeTiltAngles', () => {
  it('reads 0/0 lying flat, face up', () => {
    const angles = computeTiltAngles({ x: 0, y: 0, z: -G }, TILT_AXIS_SIGNS.native)
    expect(angles.pitch).toBeCloseTo(0)
    expect(angles.roll).toBeCloseTo(0)
  })

  it('reads a 45 degree hold as pitch 45 and roll 0', () => {
    const angles = anglesOf(45, 0)
    expect(deg(angles.pitch)).toBeCloseTo(45)
    expect(deg(angles.roll)).toBeCloseTo(0)
  })

  it('reads the right edge lowered as positive roll and the bottom edge lowered as positive pitch', () => {
    expect(computeTiltAngles({ x: G * Math.sin(rad(10)), y: 0, z: -G * Math.cos(rad(10)) }, TILT_AXIS_SIGNS.native).roll).toBeGreaterThan(0)
    expect(computeTiltAngles({ x: 0, y: -G * Math.sin(rad(10)), z: -G * Math.cos(rad(10)) }, TILT_AXIS_SIGNS.native).pitch).toBeGreaterThan(0)
  })

  it('keeps pitch fixed while rolling about the long axis from a 45 degree hold, and reads roll as the right edge dip', () => {
    for (const rollDeg of [-25, -10, 10, 25]) {
      expect(deg(anglesOf(45, rollDeg).pitch)).toBeCloseTo(45)
      expect(deg(anglesOf(45, rollDeg).roll)).toBeCloseTo(dipOf(45, rollDeg))
    }
    // A 25 degree turn from a 45 degree hold dips the right edge 17.4 degrees.
    expect(deg(anglesOf(45, 25).roll)).toBeCloseTo(17.39, 1)
  })

  it('ignores the reading magnitude', () => {
    const { x, y, z } = nativeReading(30, 12)
    const scaled = computeTiltAngles({ x: x * 3, y: y * 3, z: z * 3 }, TILT_AXIS_SIGNS.native)
    expect(deg(scaled.pitch)).toBeCloseTo(30)
    expect(deg(scaled.roll)).toBeCloseTo(dipOf(30, 12))
  })

  // Jay's Android, 2026-11-15 (PuckTastic, from DeviceMotion's gamma, the same Euler roll as the old
  // atan2(x, z)): held upright z is near 0, so the roll swung tens of degrees on a tremor, and past
  // vertical it jumped by 180.
  it.each([0, 45, 75, 85, 89])('reads the right edge dip as roll with the bottom edge lowered %d degrees', (pitchDeg) => {
    for (const dipDeg of [-0.8, 0, 0.8]) {
      const angles = heldAngles(pitchDeg, dipDeg)
      expect(deg(angles.roll)).toBeCloseTo(dipDeg, 8)
      expect(deg(angles.pitch)).toBeCloseTo(pitchDeg, 8)
    }
  })

  it('reads the same roll either side of vertical', () => {
    for (const [pitchDeg, dipDeg] of [
      [75, 8],
      [75, -8],
      [89, 0.5]
    ]) {
      expect(deg(heldAngles(pitchDeg, dipDeg, false).roll)).toBeCloseTo(dipDeg, 8)
      expect(deg(heldAngles(pitchDeg, dipDeg, false).pitch)).toBeCloseTo(pitchDeg, 8)
    }
  })

  it('moves roll only as far as the edge dips on a tremor held upright', () => {
    expect(deg(heldAngles(89, 0.6).roll - heldAngles(89, 0.2).roll)).toBeCloseTo(0.4, 8)
  })
})

describe('averageTiltAngles', () => {
  it('returns null for an empty window', () => {
    expect(averageTiltAngles([])).toBeNull()
  })

  it('averages a window of samples', () => {
    const mean = averageTiltAngles([heldAngles(40, -2), heldAngles(45, 0), heldAngles(50, 2)])
    expect(mean).not.toBeNull()
    expect(deg(mean!.pitch)).toBeCloseTo(45)
    expect(deg(mean!.roll)).toBeCloseTo(0)
  })

  it('is the plain mean of each angle', () => {
    const mean = averageTiltAngles([
      { pitch: 0.2, roll: -0.3 },
      { pitch: 0.4, roll: 0.1 }
    ])
    expect(mean!.pitch).toBeCloseTo(0.3, 12)
    expect(mean!.roll).toBeCloseTo(-0.1, 12)
  })

  it('averages a hold caught at vertical, the screen flickering either side, to its real dip', () => {
    const mean = averageTiltAngles([heldAngles(89.5, 0.3, true), heldAngles(89.5, 0.3, false), heldAngles(89.5, 0.3, true)])
    expect(deg(mean!.roll)).toBeCloseTo(0.3, 8)
    expect(deg(mean!.pitch)).toBeCloseTo(89.5, 8)
  })
})

describe('computeTiltVector', () => {
  const flat = anglesOf(0, 0)
  const length = (v: { x: number; y: number }) => Math.hypot(v.x, v.y)

  it('is zero at the baseline', () => {
    const v = computeTiltVector(anglesOf(45, 0), anglesOf(45, 0), 25)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(0)
  })

  it('is sin(delta) over sin(full scale) inside full scale', () => {
    const v = computeTiltVector(anglesOf(0, 12.5), flat, 25)
    expect(v.x).toBeCloseTo(Math.sin(rad(12.5)) / Math.sin(rad(25)))
    expect(v.y).toBeCloseTo(0)
  })

  it('reaches exactly 1 at full scale', () => {
    expect(computeTiltVector(anglesOf(0, 25), flat, 25).x).toBeCloseTo(1)
    expect(computeTiltVector(anglesOf(25, 0), flat, 25).y).toBeCloseTo(1)
  })

  it.each([
    ['toward vertical (down the screen)', 70, 0, 0, 1],
    ['toward flat (up the screen)', 20, 0, 0, -1],
    ['right', 45, 25, 1, 0],
    ['left', 45, -25, -1, 0]
  ])('reaches full scale %s from a 45 degree hold', (_name, pitchDeg, dipDeg, x, y) => {
    const v = computeTiltVector(heldAngles(pitchDeg, dipDeg), heldAngles(45, 0), 25)
    expect(v.x).toBeCloseTo(x)
    expect(v.y).toBeCloseTo(y)
  })

  it('reads a full-scale turn about the long axis from a 45 degree hold as cos(45) of full scale', () => {
    expect(computeTiltVector(anglesOf(45, 25), anglesOf(45, 0), 25).x).toBeCloseTo(Math.SQRT1_2)
  })

  it('steers the right way from a baseline caught past vertical once the phone is lowered', () => {
    const baseline = heldAngles(80, 0.5, false)
    const right = computeTiltVector(heldAngles(60, 10), baseline, 25)
    const left = computeTiltVector(heldAngles(60, -10), baseline, 25)
    expect(right.x).toBeCloseTo(Math.sin(rad(9.5)) / Math.sin(rad(25)))
    expect(left.x).toBeCloseTo(Math.sin(rad(-10.5)) / Math.sin(rad(25)))
    expect(right.y).toBeCloseTo(Math.sin(rad(-20)) / Math.sin(rad(25)))
  })

  it('steers by the real dip held upright, not a roll that magnifies it', () => {
    const v = computeTiltVector(heldAngles(75, 8, false), heldAngles(75, 0), 25)
    expect(v.x).toBeCloseTo(Math.sin(rad(8)) / Math.sin(rad(25)))
    expect(v.y).toBeCloseTo(0)
  })

  it('caps the magnitude at 1 past full scale, keeping direction', () => {
    const v = computeTiltVector(anglesOf(0, 60), flat, 25)
    expect(v.x).toBeCloseTo(1)
    expect(v.y).toBeCloseTo(0)
  })

  it('caps a full-scale diagonal at magnitude 1 rather than clamping each axis', () => {
    const baseline = { pitch: 0, roll: 0 }
    const v = computeTiltVector({ pitch: rad(25), roll: rad(25) }, baseline, 25)
    expect(length(v)).toBeCloseTo(1)
    expect(v.x).toBeCloseTo(Math.SQRT1_2)
    expect(v.y).toBeCloseTo(Math.SQRT1_2)
  })

  it('leaves a diagonal inside the unit circle uncapped', () => {
    const v = computeTiltVector({ pitch: rad(10), roll: rad(10) }, { pitch: 0, roll: 0 }, 25)
    expect(v.x).toBeCloseTo(Math.sin(rad(10)) / Math.sin(rad(25)))
    expect(length(v)).toBeLessThan(1)
  })

  it('returns zero for a full scale of 0 or less, and clamps full scale to 90 degrees', () => {
    expect(computeTiltVector(anglesOf(0, 10), flat, 0)).toEqual({ x: 0, y: 0 })
    expect(computeTiltVector(anglesOf(0, 10), flat, -5)).toEqual({ x: 0, y: 0 })
    expect(computeTiltVector(anglesOf(0, 30), flat, 120).x).toBeCloseTo(Math.sin(rad(30)))
  })
})
