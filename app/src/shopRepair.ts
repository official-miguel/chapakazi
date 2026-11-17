import { db } from './db'

// Repairs records saved on this phone without a shop (an empty businessId).
//
// Some screens used to pick their shop once, when they opened. If the list of shops was empty
// at that moment (it can be, for an instant, while sync swaps in the shops), everything saved
// from that screen had no shop: it showed in no ledger, and the server refused it, which also
// held back every good record sent in the same batch. Each shop-less record is given back the
// shop it belongs to, worked out from what it is linked to; only if nothing links it to a shop
// does it go to the owner's first shop. Repaired records are then sent as usual.

/** The first hint that is a real shop on this phone, else the fallback. */
export function pickShop(hints: (string | undefined | null)[], shops: Set<string>, fallback: string | null): string | null {
  for (const hint of hints) if (hint && shops.has(hint)) return hint
  return fallback
}

type Shopful = { id: string; businessId?: string }
const shopless = <T extends Shopful>(rows: T[]) => rows.filter((r) => !r.businessId)

/** Gives every shop-less record on this phone its shop. Returns how many were repaired. */
export async function repairShoplessRecords(devicePersonId: string | null): Promise<number> {
  const businesses = (await db.businesses.toArray()).sort((a, b) => a.createdAt - b.createdAt)
  const shops = new Set(businesses.map((b) => b.id))
  if (shops.size === 0) return 0

  const memberships = (await db.memberships.toArray()).filter((m) => !m.removedAt && shops.has(m.businessId))
  const shopsOf = (personId: string | undefined) => [...new Set(memberships.filter((m) => m.personId === personId).map((m) => m.businessId))]
  // Last resort: the oldest shop this phone's owner runs, else the oldest shop on the phone.
  const ownerShops = memberships.filter((m) => m.personId === devicePersonId && m.role === 'admin').map((m) => m.businessId)
  const fallback = businesses.find((b) => ownerShops.includes(b.id))?.id ?? businesses[0].id
  // A person who works in exactly one shop made the record there.
  const soleShop = (personId: string | undefined) => {
    const theirs = shopsOf(personId)
    return theirs.length === 1 ? theirs[0] : undefined
  }

  let repaired = 0
  await db.transaction('rw', db.tables, async () => {
    const shopOf = async <T extends Shopful>(table: { get(id: string): Promise<T | undefined> }, id: string | undefined | null) =>
      id ? (await table.get(id))?.businessId : undefined
    const fix = async (table: { update(id: string, changes: object): Promise<number> }, id: string, businessId: string | null) => {
      if (!businessId) return
      repaired += await table.update(id, { businessId })
    }

    // Things that stand on their own, or hang off an item, customer or supplier.
    for (const item of shopless(await db.items.toArray())) await fix(db.items, item.id, pickShop([], shops, fallback))
    for (const cost of shopless(await db.itemCosts.toArray())) await fix(db.itemCosts, cost.id, pickShop([await shopOf(db.items, cost.id)], shops, fallback))
    for (const c of shopless(await db.customers.toArray())) await fix(db.customers, c.id, pickShop([], shops, fallback))
    for (const s of shopless(await db.suppliers.toArray())) await fix(db.suppliers, s.id, pickShop([], shops, fallback))
    for (const m of shopless(await db.supplierMoves.toArray())) {
      await fix(db.supplierMoves, m.id, pickShop([await shopOf(db.suppliers, m.supplierId), soleShop(m.byPersonId)], shops, fallback))
    }

    // Entries: from their history, their customer, their items, or who made them.
    for (const e of shopless(await db.entries.toArray())) {
      const versions = await db.entryVersions.where('entryId').equals(e.id).toArray()
      const hints = [
        ...versions.map((v) => v.businessId),
        await shopOf(db.customers, e.customerId),
        ...(await Promise.all((e.lines ?? []).map((l) => shopOf(db.items, l.itemId)))),
        soleShop(e.createdBy),
      ]
      await fix(db.entries, e.id, pickShop(hints, shops, fallback))
    }

    // Records that belong to an entry follow it.
    for (const v of shopless(await db.entryVersions.toArray())) {
      await fix(db.entryVersions, v.id, pickShop([await shopOf(db.entries, v.entryId), soleShop(v.changedBy)], shops, fallback))
    }
    for (const m of shopless(await db.stockMoves.toArray())) {
      await fix(db.stockMoves, m.id, pickShop([await shopOf(db.entries, m.entryId), await shopOf(db.items, m.itemId)], shops, fallback))
    }
    for (const c of shopless(await db.lineCosts.toArray())) {
      await fix(db.lineCosts, c.id, pickShop([await shopOf(db.entries, c.entryId), await shopOf(db.items, c.itemId)], shops, fallback))
    }
    for (const a of shopless(await db.alerts.toArray())) await fix(db.alerts, a.id, pickShop([await shopOf(db.entries, a.entryId)], shops, fallback))
    for (const c of shopless(await db.cashCounts.toArray())) await fix(db.cashCounts, c.id, pickShop([soleShop(c.byPersonId)], shops, fallback))
    for (const a of shopless(await db.voiceAliases.toArray())) await fix(db.voiceAliases, a.id, pickShop([], shops, fallback))
  })
  return repaired
}
