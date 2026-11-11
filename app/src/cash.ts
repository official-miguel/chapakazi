import { db, newId } from './db'
import type { CashCount } from './db'
import { entriesBetween, startOfDay } from './ledger'

// The end-of-day cash count: what the ledger says should be in the till, against what is
// actually there. Only cash is counted. M-Pesa money never enters the till.

export type CashExpected = {
  salesCents: number
  paymentsCents: number
  expensesCents: number
}

/**
 * Cash in and out for one shop since `from`, from the ledger.
 * `from` is the moment of the previous count, so cash already counted is not counted again;
 * with no previous count it is the start of today.
 */
export async function cashMovements(businessId: string, from: number, now: number): Promise<CashExpected> {
  const entries = await entriesBetween([businessId], from, now + 1)
  const result: CashExpected = { salesCents: 0, paymentsCents: 0, expensesCents: 0 }
  for (const e of entries) {
    if (e.cancelled || e.method !== 'cash') continue
    if (e.kind === 'sale') result.salesCents += e.amountCents
    else if (e.kind === 'payment') result.paymentsCents += e.amountCents
    else if (e.kind === 'expense') result.expensesCents += e.amountCents
  }
  return result
}

export const expectedCash = (openingCents: number, m: CashExpected) =>
  openingCents + m.salesCents + m.paymentsCents - m.expensesCents

/** Saves a count. Counts are never changed afterwards; a recount is a new record. */
export async function saveCashCount(input: Omit<CashCount, 'id' | 'day' | 'at' | 'gapCents'>): Promise<void> {
  const now = Date.now()
  await db.cashCounts.add({
    ...input,
    id: newId(),
    day: startOfDay(now),
    gapCents: input.countedCents - input.expectedCents,
    at: now,
  })
}

/** The shop's most recent counts, newest first. */
export async function recentCounts(businessIds: string[], limit = 14): Promise<CashCount[]> {
  const rows = await db.cashCounts.where('businessId').anyOf(businessIds).toArray()
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Money typed into a box, where an empty box means zero. Null if it is not an amount. */
export function parseCash(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '')
  if (cleaned === '') return 0
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}
