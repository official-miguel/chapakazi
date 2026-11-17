// The free-entry rule on its own (no database, no server), so it can be tested by itself.
// See freeLimit.ts for how the app uses it.

export const FREE_ENTRY_LIMIT = 10

export type FreeEntries = {
  /** True when the limit is in force: the app can make accounts and this phone has none. */
  applies: boolean
  used: number
  left: number
  /** The limit is in force and used up: only the "create an account" screen opens. */
  reached: boolean
}

/**
 * Where a phone stands. `signedIn` is null while the phone has not yet looked.
 * `accountsPossible` is false in an app built without a server (nowhere to make an account).
 */
export function freeEntries(used: number, signedIn: boolean | null, accountsPossible: boolean): FreeEntries {
  // Not knowing yet counts as "signed in", so an account holder never sees the screen flash.
  const applies = accountsPossible && signedIn === false
  const left = Math.max(0, FREE_ENTRY_LIMIT - used)
  return { applies, used, left, reached: applies && left === 0 }
}
