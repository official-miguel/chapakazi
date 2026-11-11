import { db, newId } from './db'
import type { Item, Supplier, SupplierMove } from './db'
import { entriesBetween, recordEntry, startOfDay } from './ledger'
import type { Actor } from './ledger'
import { needsRestock } from './stock'

// Suppliers: who the shop buys from, what it owes them, and what to order next.
// Owners only, like buying prices.

export type SupplierInput = { name: string; phone?: string }

export async function addSupplier(businessId: string, input: SupplierInput): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.suppliers.add({
    id,
    businessId,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function updateSupplier(supplierId: string, input: SupplierInput): Promise<void> {
  await db.suppliers.update(supplierId, {
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    updatedAt: Date.now(),
  })
}

/**
 * Records goods taken on credit from a supplier (the shop now owes more), or a payment to them
 * (the shop owes less). A payment is money leaving the shop, so it can also be written into the
 * ledger as a stock expense in the same step.
 */
export async function addSupplierMove(
  supplier: Supplier,
  move: { kind: SupplierMove['kind']; amountCents: number; method?: 'cash' | 'mpesa'; note?: string },
  actor: Actor,
  alsoExpense: boolean,
): Promise<void> {
  const now = Date.now()
  await db.supplierMoves.add({
    id: newId(),
    businessId: supplier.businessId,
    supplierId: supplier.id,
    kind: move.kind,
    amountCents: move.amountCents,
    method: move.kind === 'payment' ? move.method : undefined,
    note: move.note?.trim() || undefined,
    byPersonId: actor.personId,
    at: now,
    updatedAt: now,
  })
  if (move.kind === 'payment' && alsoExpense) {
    await recordEntry(
      supplier.businessId,
      { kind: 'expense', amountCents: move.amountCents, method: move.method ?? 'cash', category: 'stock', note: supplier.name },
      actor,
    )
  }
}

/** Takes back a supplier record made by mistake. It stays in the list, struck through. */
export async function undoSupplierMove(moveId: string): Promise<void> {
  const now = Date.now()
  await db.supplierMoves.update(moveId, { undoneAt: now, updatedAt: now })
}

/** What the shop owes each supplier: goods taken on credit minus payments, ignoring undone records. */
export function owedBySupplier(moves: SupplierMove[]): Map<string, number> {
  const owed = new Map<string, number>()
  for (const m of moves) {
    if (m.undoneAt) continue
    owed.set(m.supplierId, (owed.get(m.supplierId) ?? 0) + (m.kind === 'purchase' ? m.amountCents : -m.amountCents))
  }
  return owed
}

// ---- what to order -----------------------------------------------------------------------------

/** How many days of recent sales the suggestions look at, and how many days an order should last. */
const LOOK_BACK_DAYS = 14
const COVER_DAYS = 14
/** Suggest an item when it will run out within this many days at the recent rate of sale. */
const WARN_DAYS = 7

const WHOLE_UNITS = new Set(['pcs', 'pkts', 'crates', 'bunches', 'cups'])

export type Suggestion = {
  item: Item
  /** Days until it runs out at the recent rate of sale. Null if it has not sold recently. */
  daysLeft: number | null
  /** How much to order. Null when there is nothing to base a number on. */
  orderQty: number | null
}

/**
 * Items worth reordering: those already low or finished, and those that will run out within a
 * week at the rate they sold over the last two weeks. The suggested amount covers two weeks.
 */
export async function restockSuggestions(shopIds: string[], now: number): Promise<Suggestion[]> {
  const items = (await db.items.where('businessId').anyOf(shopIds).toArray()).filter((i) => !i.archived && i.tracked)
  const from = startOfDay(now) - (LOOK_BACK_DAYS - 1) * 24 * 60 * 60 * 1000
  const entries = await entriesBetween(shopIds, from, now + 1)

  const sold = new Map<string, number>()
  for (const e of entries) {
    if (e.cancelled) continue
    for (const line of e.lines ?? []) sold.set(line.itemId, (sold.get(line.itemId) ?? 0) + line.qty)
  }

  const out: Suggestion[] = []
  for (const item of items) {
    const perDay = (sold.get(item.id) ?? 0) / LOOK_BACK_DAYS
    const left = Math.max(0, item.qty)
    const daysLeft = perDay > 0 ? left / perDay : null
    if (!needsRestock(item) && (daysLeft === null || daysLeft > WARN_DAYS)) continue

    // Enough for two weeks at the recent rate; with no recent sales, back up to twice the warning level.
    const target = perDay > 0 ? perDay * COVER_DAYS : item.lowAt !== undefined ? item.lowAt * 2 : 0
    const need = target - left
    const orderQty = need > 0 ? (WHOLE_UNITS.has(item.unit) ? Math.ceil(need) : Math.ceil(need * 2) / 2) : null
    out.push({ item, daysLeft, orderQty })
  }
  // Most urgent first: finished, then fewest days left.
  return out.sort((a, b) => (a.daysLeft ?? (a.item.qty <= 0 ? -1 : 999)) - (b.daysLeft ?? (b.item.qty <= 0 ? -1 : 999)))
}
