import type { Direction } from './direction'

export interface DirectionKeyMap {
  up: string
  down: string
  left: string
  right: string
}

// The full set of local-multiplayer keyboard splits this package knows about. Not exhaustive — pass
// your own DirectionKeyMap to resolveKeyDirection for anything else (a custom scheme, or a 4th
// simultaneous local player). Deliberately excludes a "mouse"/"none" member: a scheme with no keys at
// all isn't a DirectionKeyMap, so a caller layering one on top of this (see resolveSchemeDirection's
// own doc) handles it before ever reaching this package, not as a member of this type.
export type KeyScheme = 'wasd' | 'arrows' | 'ijkl' | 'numpad'

// wasd/arrows/ijkl are lowercased to match resolveKeyDirection's own case-insensitive comparison
// against KeyboardEvent.key. numpad is the odd one out — see resolveSchemeDirection's own comment for
// why its values are matched against KeyboardEvent.code instead, and must be read through that
// function (or the same .code-based comparison done by hand) rather than resolveKeyDirection directly.
export const KEY_SCHEMES: Record<KeyScheme, DirectionKeyMap> = {
  wasd: { up: 'w', down: 's', left: 'a', right: 'd' },
  arrows: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' },
  ijkl: { up: 'i', down: 'k', left: 'j', right: 'l' },
  numpad: { up: 'numpad8', down: 'numpad2', left: 'numpad4', right: 'numpad6' }
}

// Maps a raw keyboard event key (e.g. from a `keydown` listener's `event.key`) to a Direction given a
// scheme, or null if the key isn't part of it. Case-insensitive, so both 'w' and 'W' (e.g. with Caps
// Lock or Shift held) resolve the same way. Produces the exact same Direction type
// resolveSwipeDirection does, so a game's turn handler doesn't need to know or care whether a
// direction came from a keypress or a swipe.
export function resolveKeyDirection(key: string, keyMap: DirectionKeyMap): Direction | null {
  const normalized = key.toLowerCase()
  if (normalized === keyMap.up) return 'up'
  if (normalized === keyMap.down) return 'down'
  if (normalized === keyMap.left) return 'left'
  if (normalized === keyMap.right) return 'right'
  return null
}

// The one entry point that knows all four KEY_SCHEMES correctly, including numpad's own quirk:
// resolveKeyDirection alone isn't enough there, because a numpad key's `.key` value flips between a
// digit ('8') and its NumLock-off meaning ('ArrowUp', etc.) depending on NumLock state, while `.code`
// stays 'Numpad8' either way — and matching by `.code` also means numpad never collides with the
// top-row digit keys, which report 'Digit8' rather than 'Numpad8'. wasd/arrows/ijkl have no such
// ambiguity and are matched by `.key` as usual. Takes just the two properties this needs (not the
// whole KeyboardEvent) so a caller can pass a plain object in tests without constructing a real event.
export function resolveSchemeDirection(event: Pick<KeyboardEvent, 'key' | 'code'>, scheme: KeyScheme): Direction | null {
  if (scheme === 'numpad') return resolveKeyDirection(event.code, KEY_SCHEMES.numpad)
  return resolveKeyDirection(event.key, KEY_SCHEMES[scheme])
}

// The seat-to-scheme pair that results from `seat` picking `scheme` in a two-seat game. Swap-on-conflict:
// picking the scheme the other seat already has hands that seat this seat's old one, so two seats never
// share keys. Without it, a keyboard layer that sends each key to the first seat whose scheme claims it
// leaves the other seat's keys dead. Generic over the scheme type so a caller can mix in schemes this
// package doesn't know about, such as a keyless 'mouse' alongside the KeyScheme members.
export function assignSeatScheme<S extends string>(current: Record<1 | 2, S>, seat: 1 | 2, scheme: S): Record<1 | 2, S> {
  const other: 1 | 2 = seat === 1 ? 2 : 1
  const otherScheme = current[other] === scheme ? current[seat] : current[other]
  return { [seat]: scheme, [other]: otherScheme } as Record<1 | 2, S>
}
