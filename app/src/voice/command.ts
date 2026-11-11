import type { Entry, EntryKind, PayMethod } from '../db'
import { readNumber } from './numbers'
import { CASH, CREDIT, EXPENSE, findName, MPESA, normalise, PAID_DEBT, SALE } from './understand'
import type { ShopWords } from './understand'

// Changing or deleting an entry by voice, without any AI.
//
//   "change last sale to two hundred"        "badilisha mauzo ya mwisho iwe mia mbili"
//   "change the last one to mpesa"           "futa matumizi ya mwisho"
//   "delete Mary's credit"                   "rekebisha deni ya Mary iwe soo tatu"
//
// It can change the amount and how it was paid, or delete. Anything more (items, customer)
// is done by hand in the Ledger.

export type EditDraft = {
  heard: string
  action: 'change' | 'delete'
  /** The entry to act on, or undefined if none matched. */
  entry?: Entry
  amountCents?: number
  method?: PayMethod
  sure: boolean
}

const set = (list: string) => new Set(list.split(' '))
const DELETE = set('futa delete remove ondoa')
const CHANGE = set('badilisha badili rekebisha sahihisha hariri change edit correct fix')

/**
 * Returns null if the sentence is not asking to change or delete anything.
 * `recent` is the shop's latest entries, newest first, without deleted ones.
 */
export function understandEdit(text: string, shop: ShopWords, recent: Entry[]): EditDraft | null {
  const said = normalise(text)
  const wantsDelete = said.some((w) => DELETE.has(w))
  if (!wantsDelete && !said.some((w) => CHANGE.has(w))) return null

  const taken = said.map(() => false)
  const has = (words: Set<string>) => said.some((w) => words.has(w))

  // --- which entry: narrow the recent ones by what was mentioned, then take the newest
  let candidates = recent
  const kinds: [EntryKind, boolean][] = [
    ['payment', has(PAID_DEBT)],
    ['credit', has(CREDIT) && !has(PAID_DEBT)],
    ['expense', has(EXPENSE)],
    ['sale', has(SALE)],
  ]
  const kind = kinds.find(([, mentioned]) => mentioned)?.[0]
  if (kind) candidates = candidates.filter((e) => e.kind === kind)

  for (const customer of [...shop.customers].sort((a, b) => b.name.length - a.name.length)) {
    const span = findName(said, taken, customer.name)
    if (span) {
      candidates = candidates.filter((e) => e.customerId === customer.id)
      for (let i = span[0]; i < span[1]; i++) taken[i] = true
      break
    }
  }
  for (const item of [...shop.items].sort((a, b) => b.name.length - a.name.length)) {
    const span = findName(said, taken, item.name)
    if (span) {
      candidates = candidates.filter((e) => e.lines?.some((l) => l.itemId === item.id))
      for (let i = span[0]; i < span[1]; i++) taken[i] = true
      break
    }
  }
  const entry = candidates[0]

  // --- what to change it to
  const amounts: number[] = []
  for (let i = 0; i < said.length; ) {
    const n = taken[i] ? null : readNumber(said, i)
    if (n) {
      amounts.push(n.value)
      i = n.end
    } else i++
  }
  const method: PayMethod | undefined = has(MPESA) ? 'mpesa' : has(CASH) ? 'cash' : undefined
  const amountCents = amounts.length === 1 && amounts[0] > 0 ? Math.round(amounts[0] * 100) : undefined

  if (wantsDelete) {
    return { heard: text.trim(), action: 'delete', entry, sure: entry !== undefined && amounts.length === 0 }
  }

  // Credit has no "paid by", so only its amount can be changed by voice.
  const newMethod = entry?.kind === 'credit' ? undefined : method
  const changesSomething =
    entry !== undefined &&
    ((amountCents !== undefined && amountCents !== entry.amountCents) || (newMethod !== undefined && newMethod !== entry.method))
  return {
    heard: text.trim(),
    action: 'change',
    entry,
    amountCents,
    method: newMethod,
    sure: changesSomething && amounts.length <= 1,
  }
}
