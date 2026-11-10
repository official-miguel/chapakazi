import { db, newId } from './db'
import type { EntryLine, Item, MoveReason } from './db'

// Items and stock. Rule: stock only ever changes by adding a StockMove, so every
// number can be explained. `item.qty` is kept equal to the sum of the item's moves.

export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Turns typed text ("2", "0.5", "1,000") into a quantity. Null if it is not a number of zero or more. */
export function parseQty(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{0,3})?$/.test(cleaned)) return null
  const qty = Number(cleaned)
  return qty <= 10_000_000 ? qty : null
}

export type StockState = 'untracked' | 'out' | 'low' | 'ok'

export function stockState(item: Item): StockState {
  if (!item.tracked) return 'untracked'
  if (item.qty <= 0) return 'out'
  if (item.lowAt !== undefined && item.qty <= item.lowAt) return 'low'
  return 'ok'
}

export const needsRestock = (item: Item) => {
  const state = stockState(item)
  return state === 'out' || state === 'low'
}

export type ItemInput = {
  name: string
  unit: string
  priceCents?: number
  lowAt?: number
  tracked: boolean
}

/** Adds one stock movement and keeps the item's running total in step. Call inside a transaction. */
async function addMove(
  item: Pick<Item, 'id' | 'businessId'>,
  qty: number,
  reason: MoveReason,
  byPersonId: string,
  at: number,
  entryId?: string,
): Promise<void> {
  const change = round3(qty)
  if (change === 0) return
  await db.stockMoves.add({ id: newId(), itemId: item.id, businessId: item.businessId, qty: change, reason, entryId, byPersonId, at })
  await db.items
    .where('id')
    .equals(item.id)
    .modify((row) => {
      row.qty = round3(row.qty + change)
      row.updatedAt = at
    })
}

export async function addItem(
  businessId: string,
  input: ItemInput,
  openingQty: number,
  costCents: number | undefined,
  byPersonId: string,
): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.transaction('rw', db.items, db.itemCosts, db.stockMoves, async () => {
    await db.items.add({ ...input, name: input.name.trim(), id, businessId, qty: 0, createdAt: now, updatedAt: now })
    if (costCents !== undefined) await db.itemCosts.put({ id, businessId, costCents, updatedAt: now })
    if (input.tracked) await addMove({ id, businessId }, openingQty, 'opening', byPersonId, now)
  })
  return id
}

/**
 * Changes an item's details. `cost` is only passed by the owner:
 * a number sets the buying price, null clears it, and leaving it out keeps it untouched.
 */
export async function updateItem(itemId: string, input: ItemInput, cost?: number | null): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.items, db.itemCosts, async () => {
    const item = await db.items.get(itemId)
    if (!item) return
    await db.items.put({ ...item, ...input, name: input.name.trim(), updatedAt: now })
    if (cost === null) await db.itemCosts.delete(itemId)
    else if (cost !== undefined) await db.itemCosts.put({ id: itemId, businessId: item.businessId, costCents: cost, updatedAt: now })
  })
}

/** Hides an item from the lists. Past sales keep it. */
export async function archiveItem(itemId: string): Promise<void> {
  await db.items.update(itemId, { archived: true, updatedAt: Date.now() })
}

/**
 * Restock adds, damage removes, and a count sets the true number on the shelf
 * (recorded as the difference, so the correction itself stays visible).
 */
export async function changeStock(
  itemId: string,
  kind: 'restock' | 'damage' | 'count',
  amount: number,
  byPersonId: string,
): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.items, db.stockMoves, async () => {
    const item = await db.items.get(itemId)
    if (!item || !item.tracked) return
    const qty = kind === 'restock' ? amount : kind === 'damage' ? -amount : amount - item.qty
    await addMove(item, qty, kind, byPersonId, now)
  })
}

/**
 * Makes stock match a sale. Works for a new sale, an edited one and a deleted one:
 * whatever the old lines took out is returned, and whatever the new lines need is taken.
 * Also remembers the buying price at this moment for any new line.
 * Must run inside a transaction that includes items, stockMoves, itemCosts and lineCosts.
 */
export async function applySaleLines(
  entry: { id: string; businessId: string },
  before: EntryLine[],
  after: EntryLine[],
  reason: MoveReason,
  byPersonId: string,
  at: number,
): Promise<void> {
  const change = new Map<string, number>()
  for (const line of before) change.set(line.itemId, (change.get(line.itemId) ?? 0) + line.qty)
  for (const line of after) change.set(line.itemId, (change.get(line.itemId) ?? 0) - line.qty)

  for (const [itemId, qty] of change) {
    const item = await db.items.get(itemId)
    if (item?.tracked) await addMove(item, qty, reason, byPersonId, at, entry.id)
  }

  for (const line of after) {
    if (await db.lineCosts.get(line.id)) continue
    const cost = await db.itemCosts.get(line.itemId)
    if (cost) {
      await db.lineCosts.add({
        id: line.id,
        entryId: entry.id,
        businessId: entry.businessId,
        itemId: line.itemId,
        unitCostCents: cost.costCents,
      })
    }
  }
}
