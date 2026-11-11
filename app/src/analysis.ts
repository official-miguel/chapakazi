import { db } from './db'
import { entriesBetween, startOfDay } from './ledger'
import { needsRestock } from './stock'
import { owedBySupplier } from './suppliers'

// The numbers behind the Analysis screen, worked out on the phone from the shop's own records.
//
// "Sales" means goods sold, whether paid now or taken on credit. Profit can only be worked out
// for sales where items were picked AND those items have a buying price, so it comes with a
// note of how much of the sales it covers.

export type Period = 'today' | 'week' | 'month'

/** The start and end of the period that contains `now`. Weeks start on Monday. */
export function periodRange(period: Period, now: number): [number, number] {
  const start = new Date(startOfDay(now))
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (period === 'month') start.setDate(1)
  const end = new Date(start)
  if (period === 'today') end.setDate(end.getDate() + 1)
  else if (period === 'week') end.setDate(end.getDate() + 7)
  else end.setMonth(end.getMonth() + 1)
  return [start.getTime(), end.getTime()]
}

export type Seller = { itemId: string; name: string; unit: string; qty: number; valueCents: number }

export type Analysis = {
  salesCents: number
  salesCount: number
  /** The part of sales that was given on credit. */
  creditCents: number
  /** Debt payments received. */
  paymentsCents: number
  expensesCents: number
  /** Profit on the sales whose buying price is known. Null if none is known. */
  itemProfitCents: number | null
  /** How much of the sales value that profit covers, 0 to 1. */
  profitCoverage: number
  best: Seller[]
  slowest: Seller[]
  /** Sales value for each hour of the day, 0 to 23. */
  byHour: number[]
  /** Sales value for each day of the week, Monday first. */
  byWeekday: number[]
  perShop: { id: string; salesCents: number; expensesCents: number; salesCount: number }[]
  owedCents: number
  /** What the shop owes its suppliers. */
  owedToSuppliersCents: number
  lowStock: number
}

const TOP = 5

export async function analyse(shopIds: string[], from: number, to: number): Promise<Analysis> {
  const entries = (await entriesBetween(shopIds, from, to)).filter((e) => !e.cancelled)
  const items = (await db.items.where('businessId').anyOf(shopIds).toArray()).filter((i) => !i.archived)
  const customers = await db.customers.where('businessId').anyOf(shopIds).toArray()
  const supplierDebts = owedBySupplier(await db.supplierMoves.where('businessId').anyOf(shopIds).toArray())

  const result: Analysis = {
    salesCents: 0,
    salesCount: 0,
    creditCents: 0,
    paymentsCents: 0,
    expensesCents: 0,
    itemProfitCents: null,
    profitCoverage: 0,
    best: [],
    slowest: [],
    byHour: new Array<number>(24).fill(0),
    byWeekday: new Array<number>(7).fill(0),
    perShop: shopIds.map((id) => ({ id, salesCents: 0, expensesCents: 0, salesCount: 0 })),
    owedCents: customers.reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0),
    owedToSuppliersCents: [...supplierDebts.values()].reduce((sum, v) => sum + Math.max(0, v), 0),
    lowStock: items.filter(needsRestock).length,
  }

  const sold = new Map<string, Seller>()
  let profit = 0
  let costedSales = 0

  for (const entry of entries) {
    const shop = result.perShop.find((s) => s.id === entry.businessId)
    if (entry.kind === 'expense') {
      result.expensesCents += entry.amountCents
      if (shop) shop.expensesCents += entry.amountCents
      continue
    }
    if (entry.kind === 'payment') {
      result.paymentsCents += entry.amountCents
      continue
    }

    // A sale or goods given on credit.
    result.salesCents += entry.amountCents
    result.salesCount += 1
    if (entry.kind === 'credit') result.creditCents += entry.amountCents
    if (shop) {
      shop.salesCents += entry.amountCents
      shop.salesCount += 1
    }
    const at = new Date(entry.occurredAt)
    result.byHour[at.getHours()] += entry.amountCents
    result.byWeekday[(at.getDay() + 6) % 7] += entry.amountCents

    for (const line of entry.lines ?? []) {
      const seller = sold.get(line.itemId) ?? { itemId: line.itemId, name: line.name, unit: line.unit, qty: 0, valueCents: 0 }
      seller.qty += line.qty
      seller.valueCents += line.totalCents
      sold.set(line.itemId, seller)

      const cost = await db.lineCosts.get(line.id)
      if (cost) {
        profit += line.totalCents - Math.round(cost.unitCostCents * line.qty)
        costedSales += line.totalCents
      }
    }
  }

  if (costedSales > 0) {
    result.itemProfitCents = profit
    result.profitCoverage = result.salesCents > 0 ? Math.min(1, costedSales / result.salesCents) : 0
  }

  result.best = [...sold.values()].sort((a, b) => b.valueCents - a.valueCents).slice(0, TOP)

  // Slowest: stocked items that sold least, including those that did not sell at all.
  // Only worth showing when the shop has more items than fit in the best-seller list.
  const bestIds = new Set(result.best.map((b) => b.itemId))
  const rest = items
    .filter((i) => i.tracked && !bestIds.has(i.id))
    .map((i) => sold.get(i.id) ?? { itemId: i.id, name: i.name, unit: i.unit, qty: 0, valueCents: 0 })
  result.slowest = rest.sort((a, b) => a.valueCents - b.valueCents || a.name.localeCompare(b.name)).slice(0, TOP)

  return result
}
