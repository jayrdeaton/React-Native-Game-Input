# @tastic/input

Pure, worklet-safe input resolvers for local-multiplayer arcade games. Built on
[`@tastic/core`](https://github.com/jayrdeaton/react-native-game-core)'s `Vec2` - the root entry has no
React or React Native dependency, and does not depend on [`@tastic/physics`](https://github.com/jayrdeaton/game-physics)
either (anything vector-shaped it needs comes from the dependency-free `@tastic/core/math` entry). The one
React piece, the `useTilt` sensor hook, lives in its own `@tastic/input/tilt` subpath.

Player-zone routing (which physical touch/key-set belongs to which player) is deliberately out of
scope here - that's [`@tastic/split-screen`](https://github.com/jayrdeaton/react-native-split-screen)'s
concern, which already owns zone geometry.

## What it does

**Direction resolution** (`resolveSwipeDirection`, `Direction`) - classifies a translation vector into
`'up' | 'down' | 'left' | 'right'` with a dead zone, picking the dominant axis. The one resolver every
input source can route through - native touch, web pointer, and keyboard alike - so a game's turn
handler never needs to know which source a direction came from.

**Keyboard** (`KEY_SCHEMES`, `resolveKeyDirection`) - maps a raw keyboard key to the same `Direction`
type, with `wasd`/`arrows`/`ijkl` presets for local multiplayer (or bring your own `DirectionKeyMap`).

**Turn helpers** (`flipDirection`, `isOppositeDirection`, `applyControlInversion`, `isEffectiveTurn`) -
small utilities for turn-based games: apply a uniform direction transform across every input source
identically, and check whether a resolved direction would actually change anything.

**Drag aim** (`computeAimVector`) - a slingshot/pool-cue-and-flick launch mechanic: power scales with
how *far* a drag traveled. One function covers both feels a drag-and-release control can have - fire
along the drag (`sign: 1`, a swipe/flick) or opposite it (`sign: -1`, pull-and-release) - since they
turn out to be the same underlying gesture with a sign flip on the finished vector, not two different
input mechanisms.

**Flick throw** (`computeThrowVelocity`) - the release-velocity counterpart to `computeAimVector`: power
scales with how *fast* the release was (as reported by your gesture system's own velocity tracking),
not how far the drag traveled - the feel a "grab and throw" mechanic wants.

**Tap detection** (`isTap`) - tells a tap apart from the start of a drag/swipe by total drift distance.

**Tilt** (`computeTiltAngles`, `computeTiltVector`, `useTilt` and friends) - a tilt-the-board control from
the device's gravity reading: angles relative to a captured baseline, smoothed, dead-zoned and capped, in
screen axes for however the OS has turned the interface. See [Tilt](#tilt) below.

**Held keys** (`resolveHeldKeyTilt`, `rampHeldKeyTilt`) - the keyboard stand-in for tilt: a set of held
direction keys becomes a unit vector (diagonals normalized) that eases in and out over about 150 ms.

## Usage

```ts
import { assignSeatScheme, computeAimVector, KEY_SCHEMES, resolveKeyDirection, resolveSwipeDirection } from '@tastic/input'

// A swipe gesture and a keypress both resolve to the same Direction type:
const swiped = resolveSwipeDirection({ x: dragDx, y: dragDy }, 24)
const pressed = resolveKeyDirection(event.key, KEY_SCHEMES.wasd)

// A pull-to-shoot control scheme:
const { velocity, power } = computeAimVector({ x: dragDx, y: dragDy }, 120, 500, -1)

// Picking the other seat's scheme swaps them, so two seats never share keys:
const seats = assignSeatScheme({ 1: 'mouse', 2: 'wasd' }, 1, 'wasd') // { 1: 'wasd', 2: 'mouse' }
```

## Tilt

Pure math in the root entry (every function is `'worklet'`-annotated), and the sensor hook in
`@tastic/input/tilt`. The hook runs this pipeline on each DeviceMotion sample; the root functions are there
for anything that wants a piece of it (another hook, a UI-thread worklet, a test).

1. `computeTiltAngles(reading, TILT_AXIS_SIGNS[platform])`: the raw `accelerationIncludingGravity` to pitch
   and roll in radians, 0/0 lying flat: how far the bottom edge and the right edge dip below the horizon.
   roll = atan2(x, hypot(y, z)), pitch = atan2(y, hypot(x, z)), after the sign table below, both within
   +-90 degrees and continuous at every hold, upright and past vertical included. (An Euler roll,
   atan2(x, z), like DeviceMotion's `gamma`, swings wildly held upright and jumps by 180 past vertical.)
   Each is what a marble on the screen feels along that edge, so a turn about the long axis from a
   pitched hold dips the right edge less than the turn: a 25 degree turn from a 45 degree hold reads 17.4.
2. `averageTiltAngles(window)`: the baseline, the mean of a window of samples (the hook uses the last
   ~250 ms).
3. `computeTiltVector(angles, baseline, fullScaleDeg)`: `(sin(roll - roll0), sin(pitch - pitch0))` over
   `sin(fullScaleDeg)`, with its **magnitude** capped at 1 (a per-axis clamp would make diagonals 41%
   stronger). Taking the difference as angles keeps full scale reachable from a tilted hold; subtracting raw
   vectors reaches only 69% of it toward vertical from a 45 degree hold.
4. `applyExponentialSmoothing(previous, target, dtMs, timeConstantMs)`: a frame-rate independent EMA.
5. `remapTiltToScreenAxes(tilt, orientation)`: device frame (x toward the right edge, y toward the bottom
   edge) to screen axes (+x right, +y down) for the interface orientation. `INTERFACE_ORIENTATION` and
   `InterfaceOrientationLike` use the numbers of expo-screen-orientation's `Orientation` enum, so
   `@tastic/core/interface-orientation`'s tracker value passes straight in. Same table as core's
   `tiltToScreenAxes`.
6. `applyRadialDeadZone(vector, deadZone)`: zero inside the dead zone, rescaled so the edge reads 0 and a
   magnitude of 1 still reads 1.

`resolveTiltPlatform(os, userAgent, maxTouchPoints)` picks the sign-table row (`Platform.OS` and the
browser's `navigator`; iPadOS Safari's Mac user agent with touch points counts as iOS).

### Sign table

`TILT_AXIS_SIGNS` turns each platform's reading into one convention: x along the device's right edge, y
along its bottom edge, z positive lying flat face up. Defaults from expo-sensors' source and the W3C spec;
**only a real-device test confirms them** (iOS Safari and Android Chrome above all).

| Row | Covers | Flat, face up, reads | x | y | z |
|---|---|---|---|---|---|
| `native` | iOS and Android apps (expo-sensors normalizes both to the gravity direction) | z = -9.8 | +1 | -1 | -1 |
| `ios-web` | every iOS browser (all WebKit), which has historically reported native's signs | z = -9.8 | +1 | -1 | -1 |
| `android-web` | Android Chrome and any other non-iOS browser (the W3C spec reports the reaction to gravity) | z = +9.8 | -1 | +1 | +1 |

### `useTilt`

```tsx
import { createWebDeviceMotion, useTilt } from '@tastic/input/tilt'
import { DeviceMotion } from 'expo-sensors'
import { Platform } from 'react-native'

// Once, at module scope: a new source every render would resubscribe every render.
const deviceMotion = Platform.OS === 'web' ? createWebDeviceMotion() : DeviceMotion

const tilt = useTilt({ deviceMotion, enabled: tiltMode, fullScaleDeg: 25 })

// In the Start tap handler, first thing, nothing awaited before it (iOS Safari's permission gesture):
const onStart = () => {
  tilt.request().then((ok) => (ok ? startCountdown() : fallBackToDrag()))
}

// At GO, once the player has settled their grip:
tilt.captureBaseline()

// Every frame (no re-render per sample; `status` is the only state):
const { x, y } = tilt.getVector() // -1..1, +x right, +y down the screen
```

| Option | Default | |
|---|---|---|
| `deviceMotion` | | the expo-sensors `DeviceMotion` module on native, `createWebDeviceMotion()` on web; injected (expo-sensors is not a peer) |
| `enabled` | | subscribed only while true, and only once `request()` has gone through |
| `fullScaleDeg` | | the tilt from the baseline that reads as full strength |
| `deadZone` | `0.02` (`DEFAULT_TILT_DEAD_ZONE`) | radial, as a fraction of full scale |
| `smoothingMs` | `60` (`DEFAULT_TILT_SMOOTHING_MS`) | EMA time constant |
| `invert` | `false` | flips both axes |
| `intervalMs` | `16` | sensor interval while subscribed; never set on web |
| `restoreIntervalMs` | `100` | set back on teardown, since the interval is global to the sensor |
| `getInterfaceOrientation` | portrait | read on every sample, handed the sample's held rotation, so core's `trackInterfaceOrientation().current` can be passed as is |

| `status` | Meaning |
|---|---|
| `idle` | `request()` not called yet |
| `requesting` | waiting for permission (web) and then a first finite sample |
| `active` | samples are arriving |
| `unavailable` | no finite sample within 1 s of being granted, or the source can't be listened to at all |
| `denied` | the web permission prompt was refused |
| `lost` | no finite sample for 500 ms while active and subscribed; the vector reads zero. Stays until `request()` is called again |

- `request()` asks for permission **on web only** (expo-sensors' `requestPermissionsAsync`, which wraps
  iOS Safari's `DeviceMotionEvent.requestPermission`), and doesn't gate on `isAvailableAsync()` (on web
  that's a 250 ms probe that fails before permission). On native it skips the call: there it asks for
  Motion & Fitness (iOS) or activity recognition (Android 10+), neither of which DeviceMotion needs. It
  resolves true on the first sample with finite x/y/z, and works while `enabled` is false too (it listens
  just until that sample).
- `captureBaseline()` averages the last ~250 ms of samples and restarts the smoothing from rest. Without
  any samples it does nothing.
- `getVector()` returns a copy; zero before a baseline, while unsubscribed and after `lost`.
- **Web:** use `createWebDeviceMotion()`. expo-sensors 58's own `DeviceMotion.addListener` throws on web
  (its web module has no `addListener`), which `useTilt` would report as `unavailable`.

### `createWebDeviceMotion`

A `DeviceMotionLike` (plus `isAvailableAsync`) built straight on the window's `devicemotion` event. Safe
to import and create on native: nothing touches `window` until `addListener`.

- `requestPermissionsAsync()` calls `DeviceMotionEvent.requestPermission()` synchronously, as its first
  step, where it exists (iOS Safari: it only prompts from inside the user's tap), and resolves
  `{ granted: state === 'granted' }`. A rejection (iOS Safari rejects a call made outside a tap) passes
  through, which `useTilt` reports as `unavailable`. With no permission API it resolves granted.
- `isAvailableAsync()` resolves whether `DeviceMotionEvent` exists. It never waits for an event (iOS
  Safari sends none before permission).
- `addListener(listener)` hands each event's `accelerationIncludingGravity` (x, y, z) to the listener raw,
  nulls included (`useTilt` drops them), and returns `{ remove }`. Nothing is flipped: `useTilt`'s sign
  table handles each browser. No `orientation` is reported, so `getInterfaceOrientation` is handed 0.
- `setUpdateInterval()` does nothing; the browser sets the rate.

Web readings are in the device's own frame, so a page the browser has turned to landscape still needs
`getInterfaceOrientation` to say so (from `screen.orientation`, say).

### Held keys

```ts
import { rampHeldKeyTilt, resolveHeldKeyTilt } from '@tastic/input'

const target = resolveHeldKeyTilt(heldDirections) // a Set or array of Direction; unit vector, opposites cancel
keyTilt = rampHeldKeyTilt(keyTilt, target, dtMs) // 0 to full in HELD_KEY_RAMP_MS (150), release eases out too
```

## Install

```bash
npm install @tastic/input
```

For local development against an unreleased build:

```bash
cd game-input
npm run build
yalc publish

cd ../your-game
yalc add @tastic/input
npm install
```

## Peer dependencies

`@tastic/core` (>=0.10.0): required for `Vec2` and the vector helpers, imported from its dependency-free
`@tastic/core/math` entry, so none of core's app-level modules or peers are loaded.

`react` (>=19.0.0) and `react-native` (>=0.76.0): optional, needed only by `@tastic/input/tilt` (the hook,
and `Platform.OS` for its web checks). The root entry never loads either.
