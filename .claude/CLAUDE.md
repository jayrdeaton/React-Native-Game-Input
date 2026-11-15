# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# @tastic/input

Pure, worklet-safe input resolvers for local-multiplayer arcade games: swipe/vector-to-direction
classification, keyboard scheme mapping, drag-based aim vectors (pull/push), flick-throw velocity, tap
detection, tilt math and held-key tilt. **The root entry has no React or React Native dependency**; the
one exception is the `useTilt` sensor hook, which lives in its own `./tilt` subpath (`src/tilt/`).

Why the subpath rather than a React-free package with an app-local hook: tilt is user input, so it
belongs here, and Labyrinth, PuckTastic's Paddles/Breaker and Swirlio all want the same sensor plumbing
(subscribe, interval set and restore, permission, watchdog, baseline). The hook needs React state and
`Platform.OS`, so it can't live in the root without making every headless or UI-thread caller load react
and react-native; a separate entry keeps the root pure (precedent: `@rific/feedback-press/audio`,
`@tastic/hud/skia`). Approved by Jay 2026-11-12. Keep it that way: nothing under `src/` outside
`src/tilt/` may import react or react-native.

Part of the `@tastic` package ecosystem (the game-focused corner of the `@rific`/InfiniteToken fleet).
Built on [`@tastic/core`](https://github.com/jayrdeaton/react-native-game-core)'s `Vec2`; deliberately
does not depend on `@tastic/physics` or `@tastic/split-screen` (player-zone routing is out of scope
here - that's `@tastic/split-screen`'s job). Published at
https://www.npmjs.com/package/@tastic/input (`publishConfig.access: "public"`, confirmed live on the
registry).

## Commands

```bash
npm run lint         # ESLint
npm run fix           # ESLint --fix
npm test              # Jest (166 tests)
npm run test:watch    # Jest --watchAll
npm run typecheck     # tsc --noEmit
npm run build         # tsup, outputs CJS + ESM + types to dist/
npm run build:watch   # tsup --watch
npm run verify        # lint + test + typecheck + build, in that order
```

Always run `npm run lint` before finishing any task.

## Release

```bash
npm run release:patch   # npm version patch && git push --follow-tags (or release:minor / release:major)
```

`preversion` runs `npm run verify` first. `prepublishOnly` runs `npm run build`. The `publish.yml`
workflow fires on `v*` tags and delegates to the shared reusable workflow
(`infinitetoken/Workflows/.github/workflows/npm-publish.yml@v1`) with `id-token: write` for OIDC
trusted publishing (no `NPM_TOKEN`). `ci.yml` runs on every PR and push to `main` via the shared
`npm-ci.yml` reusable workflow, which defaults to running `npm run verify`.

## Architecture

```
src/
  index.ts        - root exports barrel (pure, no React)
  aim.ts          - computeAimVector: drag-distance-based launch velocity (pull-and-release aim); AimResult
  direction.ts    - resolveSwipeDirection, flipDirection, isOppositeDirection, applyControlInversion, isEffectiveTurn; Direction type
  gravity.ts      - tilt angles from the gravity reading: TILT_AXIS_SIGNS (per-platform sign table),
                    resolveTiltPlatform, computeTiltAngles, averageTiltAngles (baseline), computeTiltVector
                    (sin of the angle difference over sin of full scale, magnitude capped);
                    GravityVector/TiltAngles/TiltAxisSigns/TiltPlatform types
  heldKeys.ts     - resolveHeldKeyTilt (held direction set to a unit vector) + rampHeldKeyTilt + HELD_KEY_RAMP_MS
  keyboard.ts     - resolveKeyDirection + KEY_SCHEMES (wasd/arrows/ijkl/numpad) + resolveSchemeDirection
                    (the numpad-aware entry point, see its own doc comment) + assignSeatScheme (two-seat
                    swap-on-conflict); DirectionKeyMap/KeyScheme types
  orientation.ts  - INTERFACE_ORIENTATION (expo-screen-orientation's enum numbers) + remapTiltToScreenAxes;
                    InterfaceOrientationLike type
  smoothing.ts    - applyRadialDeadZone (with rescale) + applyExponentialSmoothing (dt-based EMA)
  tap.ts          - isTap: tap-vs-drag classification by total drift distance
  throw.ts        - computeThrowVelocity: release-velocity-based launch velocity (flick throw)
  tilt/
    index.ts      - the ./tilt subpath's barrel
    useTilt.ts    - useTilt hook + DeviceMotionLike/DeviceMotionMeasurementLike/TiltStatus/UseTiltOptions/TiltHandle
    webDeviceMotion.ts - createWebDeviceMotion: a DeviceMotionLike on the window's devicemotion event
  __mocks__/
    react-native.ts - Platform.OS only, set per test
  __tests__/
    aim, direction, gravity, heldKeys, keyboard, orientation, smoothing, tap, throw, useTilt,
    webDeviceMotion (.test.ts)
```

The root files are small pure functions with no shared internal state. `direction.ts`'s functions and
every numeric tilt function (`gravity.ts`, `orientation.ts`, `smoothing.ts`, `rampHeldKeyTilt`) are
annotated `'worklet'` (Reanimated-safe - callable on the UI thread without a JS-thread hop). The root
imports only `@tastic/core/math` (`length`, `normalize`, `scale`, `Vec2` - never the root barrel or its
React-dependent exports), which is what keeps it usable without `react` installed at the call-site.

`orientation.ts` mirrors `@tastic/core/interface-orientation`'s `tiltToScreenAxes` table on a `Vec2`
instead of importing it, because that entry imports expo-screen-orientation at module scope (an optional
peer of core that the root must not need).

## The tilt subpath

`src/tilt/useTilt.ts` keeps all sample-rate state in one closure controller (`createTiltController`,
created once through `useState`'s initializer); `status` is the only React state, and samples never
re-render. The rules it implements (from Labyrinth's plan, section 9):

- Nothing is subscribed until `request()` goes through. Then subscribed while `enabled`, or while a
  request still waits for its first sample.
- `request()` calls `deviceMotion.requestPermissionsAsync()` **on web only**, synchronously and first
  (iOS Safari's user-gesture rule), and never gates on `isAvailableAsync()`. On native it skips it:
  expo-sensors' native `requestPermissionsAsync` asks for Motion & Fitness (iOS, CMPedometer) or
  ACTIVITY_RECOGNITION (Android 10+), which DeviceMotion doesn't need, and a refusal would wrongly read as
  denied. Resolves true on the first sample with finite x/y/z; `unavailable` after 1 s without one, or
  when `addListener` throws; `denied` on a refused web prompt.
- Native only: `setUpdateInterval(intervalMs)` on subscribe, `setUpdateInterval(restoreIntervalMs)` on
  teardown (the interval is global, and core's 100 ms vs Pong's 20 ms collided). Never on web, where
  expo-sensors only warns.
- Watchdog: 500 ms without a finite sample while `active` and subscribed sets `lost` and zeroes the
  vector. `lost` stays until `request()` is called again.
- `captureBaseline()` averages the last ~250 ms of samples (relative to the latest one).
- Per sample: sign table, angles, `computeTiltVector` (capped), EMA, remap to screen axes, dead zone,
  invert. `getVector()` returns a copy.

expo-sensors 58's `DeviceMotion.addListener` throws on web (the web module has no `addListener`), so on
web a consumer injects `createWebDeviceMotion()` (`src/tilt/webDeviceMotion.ts`) instead, created once at
module scope (a new object each render would resubscribe each render). It's built on the window's
`devicemotion` event:

- `requestPermissionsAsync()` calls `DeviceMotionEvent.requestPermission()` synchronously, first, as a
  method, where it exists (iOS Safari prompts only from inside the user's tap); `'granted'` reads as
  granted, anything else as not, and a rejection passes through (useTilt: `unavailable`). No permission
  API: granted.
- `isAvailableAsync()` is just whether `DeviceMotionEvent` exists; it never waits for an event.
- `addListener` passes `accelerationIncludingGravity` through raw, nulls included, with no sign flips
  (useTilt's `ios-web`/`android-web` rows do that) and no `orientation`.
- `setUpdateInterval` is a no-op.
- Nothing reads `window` or `DeviceMotionEvent` until called, so importing or creating it on native is
  harmless (`DeviceMotionEvent` is read off `globalThis`).

## Public API

From `src/index.ts`:

- `AimResult`, `computeAimVector` - drag-based aim (`aim.ts`)
- `applyControlInversion`, `Direction`, `flipDirection`, `isEffectiveTurn`, `isOppositeDirection`,
  `resolveSwipeDirection` - direction resolution and turn helpers (`direction.ts`)
- `assignSeatScheme`, `DirectionKeyMap`, `KEY_SCHEMES`, `KeyScheme`, `resolveKeyDirection`,
  `resolveSchemeDirection`: keyboard mapping and seat scheme assignment (`keyboard.ts`)
- `isTap` - tap detection (`tap.ts`)
- `computeThrowVelocity` - flick-throw velocity (`throw.ts`)
- `averageTiltAngles`, `computeTiltAngles`, `computeTiltVector`, `GravityVector`, `resolveTiltPlatform`,
  `TILT_AXIS_SIGNS`, `TiltAngles`, `TiltAxisSigns`, `TiltPlatform` - tilt angles and baseline (`gravity.ts`)
- `HELD_KEY_RAMP_MS`, `rampHeldKeyTilt`, `resolveHeldKeyTilt` - held-key tilt (`heldKeys.ts`)
- `INTERFACE_ORIENTATION`, `InterfaceOrientationLike`, `remapTiltToScreenAxes` - screen axes (`orientation.ts`)
- `applyExponentialSmoothing`, `applyRadialDeadZone` - smoothing and dead zone (`smoothing.ts`)

From `src/tilt/index.ts` (`@tastic/input/tilt`):

- `useTilt`, `UseTiltOptions`, `TiltHandle`, `TiltStatus`, `DeviceMotionLike`,
  `DeviceMotionMeasurementLike`, plus `InterfaceOrientationLike` re-exported from the root
- `DEFAULT_TILT_DEAD_ZONE` (0.02) and `DEFAULT_TILT_SMOOTHING_MS` (60): what `useTilt` uses when
  `deadZone` / `smoothingMs` are omitted (exported 2026-11-12 so Labyrinth's dev tuning overlay shows them)
- `createWebDeviceMotion` - the web source for `useTilt` (`webDeviceMotion.ts`)

Two entry points, each with `react-native` → raw source, `types`, `import`, `require` conditions (the same
shape as `@rific/feedback-press`'s `./audio`): `.` → `src/index.ts` / `dist/index.*`, and `./tilt` →
`src/tilt/index.ts` / `dist/tilt/index.*`. `tsup.config.cjs` lists both entries.

## Peer Dependencies

- `@tastic/core` `>=0.10.0` - required, internal fleet package. 0.10.0 is the first release with the
  dependency-free `@tastic/core/math` entry, the only part of core this package imports.
- `react` `>=19.0.0` and `react-native` `>=0.76.0` - **optional**, needed only by the `./tilt` subpath
  (`useState`/`useEffect`/`useMemo`, and `Platform.OS`). The root never imports either.

expo-sensors and expo-screen-orientation are deliberately not peers: `useTilt` takes the DeviceMotion
module injected (`DeviceMotionLike` mirrors the part it calls) and an orientation getter, and
`InterfaceOrientationLike` mirrors expo-screen-orientation's enum numbers.

`react`, `react-dom`, `react-native`, `@types/react` and `@testing-library/{react,dom}` are
devDependencies for the hook's types and tests.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/react-native`), jsdom test environment
- 166 tests across 11 suites, one per source file
- `useTilt` is tested with `@testing-library/react`'s `renderHook`, Jest fake timers (which also fake
  `performance.now`, the hook's clock) and a fake `deviceMotion` that records listeners and emits
  readings built from a hold (how far the bottom and right edges dip, the angles `computeTiltAngles`
  reads; a hold where both are steep throws, since it can't exist)
- `createWebDeviceMotion` is tested against jsdom's real `window` events (a plain `Event` carrying
  `accelerationIncludingGravity`) and a fake `DeviceMotionEvent` installed on `globalThis` per test
  (jsdom has none), plus an end-to-end run through `useTilt` on web
- One local mock: `src/__mocks__/react-native.ts` (just a mutable `Platform.OS`), mapped in
  `jest.config.cjs`, since real react-native is Flow source this ts-jest-only config can't load
- `jest.config.cjs` also overrides `collectCoverageFrom` to exclude `src/tilt/index.ts` (pure re-exports,
  like the root barrel the preset already excludes)
- Coverage: 100% lines and branches; functions 98% (the one miss is the subscription record's
  placeholder `remove` before `addListener` returns)
- The preset's `testEnvironmentOptions.customExportConditions: []` keeps jsdom from resolving
  `@tastic/core`'s `browser` condition (raw `src/` TypeScript inside `node_modules`)

## Roll is the right edge's dip (2026-11-15)

`computeTiltAngles`' roll was `atan2(x, z)`, an Euler roll with the singularity of DeviceMotion's `gamma`:
held upright `z` is near 0, so it swung tens of degrees on a tremor, and past vertical it jumped by 180,
which flipped left and right against a baseline caught on the other side (PuckTastic's paddle pinned at
one end on Jay's Android, the same day, from `gamma`; `@tastic/core` gained `edgeDip` for that). Roll is
now `atan2(x, hypot(y, z))`, the right edge's dip, the same form as pitch. Released in 0.5.0, the first
release with the tilt math and the `./tilt` subpath (`useTilt`, `createWebDeviceMotion`), with the dev
dependency on `@tastic/core` raised to ^0.17.0 (the peer stays `>=0.10.0`: only `./math` is used).

- **Baseline and full scale, checked:** both angles are within +-90 now, so `averageTiltAngles` is a plain
  mean (the circular mean only existed for roll's +-180 seam, which can't be reached any more).
  `computeTiltVector`'s `sin(angle - baseline)` still reaches full scale from any hold where neither edge
  points straight down, and a baseline caught past vertical now steers the right way once the phone is
  lowered.
- **Feel change for Labyrinth:** each dip is what a marble on the screen feels along that edge, so a turn
  about the long axis from a pitched hold moves roll by about `cos(pitch)` of the turn. From a 45 degree
  hold a 25 degree turn reaches 71% of a 25 degree full scale (it took 100% before); it takes a real 25
  degree dip of the right edge. Labyrinth's `FULL_SCALE_TILT_DEG` is for Feel Gate 1 to settle.
- **Known limit, unchanged in kind:** each dip loses sensitivity as its own edge nears straight down
  (`asin` near 90). Pitch always had this held upright in portrait (tipping toward or away reads the same
  way); roll now has it only with the device's right or left edge straight down (a landscape hold of a
  portrait-only app, or an upright landscape iPad). Fixing both would mean a baseline frame (turning each
  reading by the baseline's own tilt) instead of angle differences.
- Tests: `gravity.test.ts` reads the dip from flat to 89 degrees, either side of vertical, on a tremor held
  upright, a baseline caught at vertical, a baseline caught past vertical steering both ways, and a long
  axis turn from 45 degrees as `cos(45)` of full scale (16 of its 40 fail on the old roll). The
  `useTilt`/`webDeviceMotion` tests build readings from the two dips now; the diagonal cap test moved to
  a hold that exists.

## Code Style

Enforced by ESLint + Prettier (`eslint.config.cjs` is a bare
`module.exports = require('@infinitetoken/eslint-config/react-native')` - no local overrides).

**Prettier config:**
- Single quotes, JSX single quotes
- No semicolons
- No trailing commas
- Print width: 1000 (effectively disabled)

**ESLint rules (warnings unless noted):**
- `simple-import-sort/imports`, `simple-import-sort/exports`
- `no-console`
- `@typescript-eslint/no-unused-vars` - `varsIgnorePattern`/`argsIgnorePattern`/`caughtErrorsIgnorePattern: '^_'`
- `@typescript-eslint/no-require-imports` - off
- `react-native/no-inline-styles`, `react-native/no-unused-styles` - apply even though `src/` has no
  React Native code, since the repo uses the `react-native` preset rather than the plainer
  `npm-package` one
- `react-native/no-raw-text` - off
- `react-hooks/rules-of-hooks` - error, not a warning (rest of the fleet's convention)
- `react-hooks/exhaustive-deps`, `react-hooks/refs`, `react-hooks/immutability`,
  `react-hooks/preserve-manual-memoization`, `react-hooks/set-state-in-effect`
- `package-json/order-properties`, `package-json/sort-collections` - on `package.json` only
- `@typescript-eslint/no-explicit-any` - on in `src/`, off in `__tests__/`/`__mocks__/` (moot here:
  nothing in `src/` currently uses `any`)

The base config's own ignore list (`dist/**`, `node_modules/**`, `lib/**`, `coverage/**`, `**/*.js`,
`**/*.mjs`, `.claude/worktrees/**`, `.yalc/**`) does **not** cover `**/*.cjs` - so `eslint.config.cjs`,
`jest.config.cjs`, and `tsup.config.cjs` are themselves linted.
