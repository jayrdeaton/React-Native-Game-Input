# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# @tastic/input

Pure, worklet-safe input resolvers for local-multiplayer arcade games: swipe/vector-to-direction
classification, keyboard scheme mapping, drag-based aim vectors (pull/push), flick-throw velocity, and
tap detection. No React or React Native dependency in `src/` itself.

Part of the `@tastic` package ecosystem (the game-focused corner of the `@rific`/InfiniteToken fleet).
Built on [`@tastic/core`](https://github.com/jayrdeaton/react-native-game-core)'s `Vec2`; deliberately
does not depend on `@tastic/physics` or `@tastic/split-screen` (player-zone routing is out of scope
here — that's `@tastic/split-screen`'s job). Published at
https://www.npmjs.com/package/@tastic/input (`publishConfig.access: "public"`, confirmed live on the
registry).

## Commands

```bash
npm run lint         # ESLint
npm run fix           # ESLint --fix
npm test              # Jest (40 tests)
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
  index.ts      - public exports barrel
  aim.ts        - computeAimVector: drag-distance-based launch velocity (pull-and-release aim); AimResult
  direction.ts  - resolveSwipeDirection, flipDirection, isOppositeDirection, applyControlInversion, isEffectiveTurn; Direction type
  keyboard.ts   - resolveKeyDirection + KEY_SCHEMES (wasd/arrows/ijkl/numpad) + resolveSchemeDirection
                  (the numpad-aware entry point, see its own doc comment) + assignSeatScheme (two-seat
                  swap-on-conflict); DirectionKeyMap/KeyScheme types
  tap.ts        - isTap: tap-vs-drag classification by total drift distance
  throw.ts      - computeThrowVelocity: release-velocity-based launch velocity (flick throw)
  __tests__/
    aim.test.ts
    direction.test.ts
    keyboard.test.ts
    tap.test.ts
    throw.test.ts
```

Five small pure-function files, no shared internal state. `direction.ts`'s functions are annotated
`'worklet'` (Reanimated-safe — callable on the UI thread without a JS-thread hop). Only `aim.ts`,
`direction.ts`, and `throw.ts` import from `@tastic/core` (`length`, `scale`, `Vec2` — never
`useGameLoop` or the other React-dependent exports), which is what keeps this package usable without
`react` installed at the call-site.

## Public API

From `src/index.ts`:

- `AimResult`, `computeAimVector` — drag-based aim (`aim.ts`)
- `applyControlInversion`, `Direction`, `flipDirection`, `isEffectiveTurn`, `isOppositeDirection`,
  `resolveSwipeDirection` — direction resolution and turn helpers (`direction.ts`)
- `assignSeatScheme`, `DirectionKeyMap`, `KEY_SCHEMES`, `KeyScheme`, `resolveKeyDirection`,
  `resolveSchemeDirection`: keyboard mapping and seat scheme assignment (`keyboard.ts`)
- `isTap` — tap detection (`tap.ts`)
- `computeThrowVelocity` — flick-throw velocity (`throw.ts`)

Single entry point — `exports["."]` in `package.json` has no subpaths (`react-native` condition →
`src/index.ts`, `types` → `dist/index.d.ts`, `import`/`require` → `dist/index.mjs`/`dist/index.js`).

## Peer Dependencies

- `@tastic/core` `>=0.1.0` — required, internal fleet package. Floor deliberately left below the
  installed devDependency (`^0.1.5`): the only 0.1.2→0.1.5 change upstream is a bug fix inside
  `useGameLoop` (moving a ref assignment into a `useEffect`), and this package only ever imports
  `length`/`scale`/`Vec2` — never `useGameLoop` — so nothing here needs the newer floor.

`react` is a devDependency (not a peer) purely to satisfy `@tastic/core`'s built bundle: its tsup
output bundles every export — including the React-dependent hooks — into one CJS/ESM file with an
eager top-level `require('react')`, so anything that loads that bundle needs `react` present even if
it only touches the dependency-free `Vec2` math.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/react-native`), jsdom test environment, no local mocks
  (`__mocks__/` doesn't exist — nothing here touches a native or DOM API)
- 40 tests across 5 suites, one per source file (`aim`, `direction`, `keyboard`, `tap`, `throw`)
- Coverage: 100% statements/branches/functions/lines, well past the shared preset's 70% floor — no
  local `collectCoverageFrom`/`coverageThreshold` override
- No local `jest.config.cjs` overrides — `@infinitetoken/jest-config@0.2.1`'s `/react-native` preset
  now defaults `testEnvironmentOptions.customExportConditions: []` itself, so the local override this
  repo used to need (for `@tastic/core`'s `browser` export condition pointing at raw `src/index.ts`,
  which jsdom used to activate by default and send Jest to unbuilt TypeScript inside `node_modules`,
  failing `aim.test.ts`/`throw.test.ts` with "Must use import to load ES Module") was removed once the
  pin was bumped — confirmed the shared default alone is sufficient, no override needed anymore.

## Code Style

Enforced by ESLint + Prettier (`eslint.config.cjs` is a bare
`module.exports = require('@infinitetoken/eslint-config/react-native')` — no local overrides).

**Prettier config:**
- Single quotes, JSX single quotes
- No semicolons
- No trailing commas
- Print width: 1000 (effectively disabled)

**ESLint rules (warnings unless noted):**
- `simple-import-sort/imports`, `simple-import-sort/exports`
- `no-console`
- `@typescript-eslint/no-unused-vars` — `varsIgnorePattern`/`argsIgnorePattern`/`caughtErrorsIgnorePattern: '^_'`
- `@typescript-eslint/no-require-imports` — off
- `react-native/no-inline-styles`, `react-native/no-unused-styles` — apply even though `src/` has no
  React Native code, since the repo uses the `react-native` preset rather than the plainer
  `npm-package` one
- `react-native/no-raw-text` — off
- `react-hooks/rules-of-hooks` — error, not a warning (rest of the fleet's convention)
- `react-hooks/exhaustive-deps`, `react-hooks/refs`, `react-hooks/immutability`,
  `react-hooks/preserve-manual-memoization`, `react-hooks/set-state-in-effect`
- `package-json/order-properties`, `package-json/sort-collections` — on `package.json` only
- `@typescript-eslint/no-explicit-any` — on in `src/`, off in `__tests__/`/`__mocks__/` (moot here:
  nothing in `src/` currently uses `any`)

The base config's own ignore list (`dist/**`, `node_modules/**`, `lib/**`, `coverage/**`, `**/*.js`,
`**/*.mjs`, `.claude/worktrees/**`, `.yalc/**`) does **not** cover `**/*.cjs` — so `eslint.config.cjs`,
`jest.config.cjs`, and `tsup.config.cjs` are themselves linted.
