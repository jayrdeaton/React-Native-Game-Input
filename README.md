# @tastic/input

Pure, worklet-safe input resolvers for local-multiplayer arcade games. Built on
[`@tastic/core`](https://github.com/jayrdeaton/react-native-game-core)'s `Vec2` — no React or React Native
dependency, and does not depend on [`@tastic/physics`](https://github.com/jayrdeaton/game-physics)
either (anything vector-shaped it needs comes from the dependency-free `@tastic/core/math` entry).

Player-zone routing (which physical touch/key-set belongs to which player) is deliberately out of
scope here — that's [`@tastic/split-screen`](https://github.com/jayrdeaton/react-native-split-screen)'s
concern, which already owns zone geometry.

## What it does

**Direction resolution** (`resolveSwipeDirection`, `Direction`) — classifies a translation vector into
`'up' | 'down' | 'left' | 'right'` with a dead zone, picking the dominant axis. The one resolver every
input source can route through — native touch, web pointer, and keyboard alike — so a game's turn
handler never needs to know which source a direction came from.

**Keyboard** (`KEY_SCHEMES`, `resolveKeyDirection`) — maps a raw keyboard key to the same `Direction`
type, with `wasd`/`arrows`/`ijkl` presets for local multiplayer (or bring your own `DirectionKeyMap`).

**Turn helpers** (`flipDirection`, `isOppositeDirection`, `applyControlInversion`, `isEffectiveTurn`) —
small utilities for turn-based games: apply a uniform direction transform across every input source
identically, and check whether a resolved direction would actually change anything.

**Drag aim** (`computeAimVector`) — a slingshot/pool-cue-and-flick launch mechanic: power scales with
how *far* a drag traveled. One function covers both feels a drag-and-release control can have — fire
along the drag (`sign: 1`, a swipe/flick) or opposite it (`sign: -1`, pull-and-release) — since they
turn out to be the same underlying gesture with a sign flip on the finished vector, not two different
input mechanisms.

**Flick throw** (`computeThrowVelocity`) — the release-velocity counterpart to `computeAimVector`: power
scales with how *fast* the release was (as reported by your gesture system's own velocity tracking),
not how far the drag traveled — the feel a "grab and throw" mechanic wants.

**Tap detection** (`isTap`) — tells a tap apart from the start of a drag/swipe by total drift distance.

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

## Install (local dev via yalc)

Not published to the public npm registry yet.

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
