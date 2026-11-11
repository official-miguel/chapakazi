import { db, newId } from '../db'
import type { EntryLine, ExpenseCategory, VoiceAlias } from '../db'
import type { VoiceDraft } from './understand'

// Learning from corrections, so the same word never needs fixing twice.
//
// When voice could not explain a word and the person then fixes the entry by hand, the fix
// shows what the word meant. That pairing is saved for the shop and synced to its other phones.
// One thing is learned per correction, and only when it is clear what the word stood for.

const MAX_WORDS = 3

export type Learned = { phrase: string; target: VoiceAlias['target']; targetId: string }

/** Works out what, if anything, a hand correction teaches. */
export function whatWasLearned(
  draft: VoiceDraft,
  saved: { lines: EntryLine[]; customerId?: string; category?: ExpenseCategory },
): Learned | null {
  const phrase = draft.unknown.join(' ').toLowerCase()
  if (!phrase || draft.unknown.length > MAX_WORDS) return null

  // An item was added by hand that voice had not found: the unknown word was that item.
  const heardItems = new Set(draft.lines.map((l) => l.item.id))
  const addedItems = saved.lines.filter((l) => !heardItems.has(l.itemId))
  if (addedItems.length === 1) return { phrase, target: 'item', targetId: addedItems[0].itemId }
  if (addedItems.length > 1) return null

  // A known customer was picked where voice heard only an unknown name.
  if (saved.customerId && !draft.customer) return { phrase, target: 'customer', targetId: saved.customerId }

  // An expense was moved out of "Other": the unknown word names that kind of expense.
  if (draft.kind === 'expense' && draft.category === 'other' && saved.category && saved.category !== 'other') {
    return { phrase, target: 'category', targetId: saved.category }
  }
  return null
}

/** Saves what was learned. Teaching the same word again replaces the earlier meaning. */
export async function remember(businessId: string, learned: Learned): Promise<void> {
  const now = Date.now()
  const existing = (await db.voiceAliases.where('businessId').equals(businessId).toArray()).find(
    (a) => a.phrase === learned.phrase,
  )
  await db.voiceAliases.put({ id: existing?.id ?? newId(), businessId, ...learned, updatedAt: now })
}
