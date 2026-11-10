import { db } from './db'
import type { EntryData } from './db'
import { round3 } from './stock'

// After records arrive from other phones, the running totals kept on this phone are worked out
// again from the records themselves. This is what makes two phones agree even if they both
// changed things while offline. Call these inside runAsServer().

const SALE_REASONS = new Set(['sale', 'sale_edit', 'sale_cancel'])

/**
 * An entry "as it stands now" is its latest version, judged by the time on the phone that made
 * the edit (not the time it reached the server). Ties are broken by id so every phone agrees.
 */
export async function recomputeEntries(entryIds: Iterable<string>): Promise<void> {
  for (const entryId of new Set(entryIds)) {
    const entry = await db.entries.get(entryId)
    if (!entry) continue // its first record has not arrived yet; it will be redone when it does
    const versions = await db.entryVersions.where('entryId').equals(entryId).toArray()
    if (versions.length === 0) continue
    versions.sort((a, b) => a.changedAt - b.changedAt || a.id.localeCompare(b.id))
    const last = versions[versions.length - 1]
    const head: EntryData = {
      kind: last.kind,
      amountCents: last.amountCents,
      method: last.method,
      category: last.category,
      note: last.note,
      lines: last.lines,
      cancelled: last.cancelled,
    }
    await db.entries.put({ ...entry, ...head, versions: versions.length, updatedAt: Math.max(entry.updatedAt, last.changedAt) })
  }
}

/** Stock left = restocks, counts and losses, minus what the current sales say was sold. */
export async function recomputeItems(itemIds: Iterable<string>): Promise<void> {
  const ids = new Set(itemIds)
  if (ids.size === 0) return
  const businessIds = new Set<string>()
  const items = (await db.items.bulkGet([...ids])).filter((i) => i !== undefined)
  for (const item of items) businessIds.add(item.businessId)

  const sold = new Map<string, number>()
  const entries = await db.entries.where('businessId').anyOf([...businessIds]).toArray()
  for (const entry of entries) {
    if (entry.cancelled) continue
    for (const line of entry.lines ?? []) {
      if (ids.has(line.itemId)) sold.set(line.itemId, (sold.get(line.itemId) ?? 0) + line.qty)
    }
  }

  for (const item of items) {
    let qty = 0
    if (item.tracked) {
      const moves = await db.stockMoves.where('itemId').equals(item.id).toArray()
      for (const move of moves) if (!SALE_REASONS.has(move.reason)) qty += move.qty
      qty -= sold.get(item.id) ?? 0
    }
    qty = round3(qty)
    if (qty !== item.qty) await db.items.put({ ...item, qty })
  }
}

/** What a customer owes = their credit entries minus their payments, as those entries stand now. */
export async function recomputeCustomers(customerIds: Iterable<string>): Promise<void> {
  for (const customerId of new Set(customerIds)) {
    const customer = await db.customers.get(customerId)
    if (!customer) continue
    const entries = await db.entries.where('customerId').equals(customerId).toArray()
    let balanceCents = 0
    for (const e of entries) {
      if (e.cancelled) continue
      if (e.kind === 'credit') balanceCents += e.amountCents
      else if (e.kind === 'payment') balanceCents -= e.amountCents
    }
    if (balanceCents !== customer.balanceCents) await db.customers.put({ ...customer, balanceCents })
  }
}
