import { db, newId } from './db'
import type { Customer, EntryLine, MpesaPayment } from './db'

// The M-Pesa inbox: payments that arrived by themselves and still need someone to say what
// they were for. Sorting a payment links it to a ledger entry (a sale or a debt payment), or
// marks it as not the shop's business. The payment itself can never be changed.

/** Links a payment to the ledger entry that explains it. */
export async function assignPayment(paymentId: string, entryId: string, personId: string): Promise<void> {
  const now = Date.now()
  await db.mpesaPayments.update(paymentId, { status: 'assigned', entryId, assignedBy: personId, assignedAt: now, updatedAt: now })
}

/** For money that came in but is not a sale or a debt payment (a wrong number, a personal transfer). */
export async function ignorePayment(paymentId: string, personId: string): Promise<void> {
  const now = Date.now()
  await db.mpesaPayments.update(paymentId, { status: 'ignored', entryId: null, assignedBy: personId, assignedAt: now, updatedAt: now })
}

/** Puts a payment back in the inbox, for when it was sorted wrongly. */
export async function reopenPayment(paymentId: string): Promise<void> {
  await db.mpesaPayments.update(paymentId, { status: 'unassigned', entryId: null, updatedAt: Date.now() })
}

export type InboxSuggestion =
  | { kind: 'sale'; lines: EntryLine[]; times: number }
  | { kind: 'payment'; customer: Customer; times: number }

/** A sale has to have been sorted the same way this many times before it is suggested. */
const MIN_REPEATS = 2

/**
 * A guess at what a payment is for, learned from how earlier ones were sorted:
 *  - the same payer has paid off a debt before, and still owes  -> a debt payment from them
 *  - the same amount has repeatedly been the same items          -> that sale ("150 is usually bread")
 * Returns null when there is nothing solid to go on.
 */
export async function suggestFor(payment: MpesaPayment): Promise<InboxSuggestion | null> {
  const sorted = (await db.mpesaPayments.where('businessId').equals(payment.businessId).toArray()).filter(
    (p) => p.status === 'assigned' && p.entryId && p.id !== payment.id,
  )

  // Who is paying?
  if (payment.payerRef && payment.payerRef !== 'test') {
    const byCustomer = new Map<string, number>()
    for (const p of sorted.filter((x) => x.payerRef === payment.payerRef)) {
      const entry = await db.entries.get(p.entryId ?? '')
      if (entry?.kind === 'payment' && entry.customerId && !entry.cancelled) {
        byCustomer.set(entry.customerId, (byCustomer.get(entry.customerId) ?? 0) + 1)
      }
    }
    const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0]
    const customer = top ? await db.customers.get(top[0]) : undefined
    if (top && customer && customer.balanceCents > 0) return { kind: 'payment', customer, times: top[1] }
  }

  // What does this amount usually buy?
  const bySignature = new Map<string, { lines: EntryLine[]; times: number }>()
  for (const p of sorted.filter((x) => x.amountCents === payment.amountCents)) {
    const entry = await db.entries.get(p.entryId ?? '')
    if (entry?.kind !== 'sale' || entry.cancelled || !entry.lines?.length) continue
    const signature = entry.lines
      .map((l) => `${l.itemId}:${l.qty}`)
      .sort()
      .join('|')
    const seen = bySignature.get(signature) ?? { lines: entry.lines, times: 0 }
    seen.times += 1
    bySignature.set(signature, seen)
  }
  const best = [...bySignature.values()].sort((a, b) => b.times - a.times)[0]
  if (best && best.times >= MIN_REPEATS) {
    // Fresh ids, so the new sale's lines are its own.
    return { kind: 'sale', lines: best.lines.map((l) => ({ ...l, id: newId() })), times: best.times }
  }
  return null
}
