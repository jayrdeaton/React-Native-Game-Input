import type { Vec2 } from '@tastic/core/math'

// The interface orientations, with the same numbers as expo-screen-orientation's `Orientation` enum,
// which is what @tastic/core/interface-orientation's trackInterfaceOrientation().current() returns.
// So that value passes straight in, without this package depending on expo-screen-orientation (or on
// core's interface-orientation entry, which imports it). UNKNOWN reads as portrait, as in core.
export const INTERFACE_ORIENTATION = {
  UNKNOWN: 0,
  PORTRAIT_UP: 1,
  PORTRAIT_DOWN: 2,
  LANDSCAPE_LEFT: 3,
  LANDSCAPE_RIGHT: 4
} as const

export type InterfaceOrientationLike = (typeof INTERFACE_ORIENTATION)[keyof typeof INTERFACE_ORIENTATION]

// Turns a tilt vector in the device frame (x toward the device's right edge, y toward its bottom
// edge, as computeTiltVector returns it) into the axes of the screen as the OS has turned it (+x
// right, +y down the screen). The same table as @tastic/core's tiltToScreenAxes, with landscape named
// for the interface: LANDSCAPE_RIGHT is the device turned counter-clockwise (its top edge pointing
// left), LANDSCAPE_LEFT clockwise. Every case is a quarter or half turn, so magnitude is unchanged.
export function remapTiltToScreenAxes(tilt: Vec2, orientation: InterfaceOrientationLike): Vec2 {
  'worklet'
  switch (orientation) {
    case 4:
      // LANDSCAPE_RIGHT: screen right is the device's bottom edge, screen down its left edge.
      return { x: tilt.y, y: -tilt.x }
    case 3:
      // LANDSCAPE_LEFT: screen right is the device's top edge, screen down its right edge.
      return { x: -tilt.y, y: tilt.x }
    case 2:
      // PORTRAIT_DOWN
      return { x: -tilt.x, y: -tilt.y }
    default:
      // PORTRAIT_UP, UNKNOWN
      return { x: tilt.x, y: tilt.y }
  }
}
