import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { freeEntries } from './freeCount'
import type { FreeEntries } from './freeCount'
import { demoOn } from './subscription/demo'
import { backupAvailable, supabase } from './supabase'
import { useSyncState } from './sync'

// A phone with no account can try Chapa Biz with up to 10 entries. After that, the person
// must create an account (or sign in, or join a shop with an invite code) to keep going.
// Every entry made on the phone counts, including cancelled ones, so cancelling one does
// not give a free entry back. An account then starts the one-time free trial.

export { FREE_ENTRY_LIMIT } from './freeCount'
export type { FreeEntries } from './freeCount'

/**
 * The free-entry count for the screens. It updates as entries are made.
 * `deciding` is true for the moment the phone is still counting or still looking whether it is
 * signed in; the app waits for that, so it never shows for a moment before locking.
 */
export function useFreeEntries(): FreeEntries & { deciding: boolean } {
  const sync = useSyncState()
  const used = useLiveQuery(() => db.entries.count())
  // The pretend payment server (development only) stands in for an account.
  const signedIn = sync.signedIn || demoOn() ? true : sync.checked ? false : null
  const deciding = backupAvailable && signedIn !== true && (used === undefined || signedIn === null)
  return { ...freeEntries(used ?? 0, signedIn, backupAvailable), deciding }
}

/** Thrown when a phone without an account tries to make an entry after its free ones. */
export class NeedsAccountError extends Error {
  constructor() {
    super('needs_account')
  }
}

/** Refuses a new entry once the free ones are used up on a phone with no account. */
export async function assertCanAddEntry(): Promise<void> {
  if (!supabase || demoOn()) return
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  if (freeEntries(await db.entries.count(), false, true).reached) throw new NeedsAccountError()
}
