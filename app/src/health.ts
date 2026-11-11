import { db } from './db'
import { entriesBetween, startOfDay } from './ledger'
import { owedBySupplier } from './suppliers'

// The business health report: a one-page picture of a shop for a bank, Sacco or lender.
//
// It reports what was recorded, over at most the last six months. Averages are worked out per
// day of records and then scaled to a month, so a shop that started three weeks ago is not
// averaged against months when it was not yet using the app. The report says how many days of
// records it rests on, so the reader can judge how much weight to give it.

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_DAYS = 30.44
const WINDOW_MONTHS = 6
/** Steadiness needs at least this many full weeks to mean anything. */
const MIN_WEEKS = 4

export type MonthRow = {
  start: number
  salesCents: number
  expensesCents: number
  /** False for the current month and for the month the records began in. */
  complete: boolean
}

export type Steadiness = 'steady' | 'fair' | 'uneven' | 'unknown'

export type HealthReport = {
  from: number
  to: number
  /** Days from the first record in the window to today. */
  daysOfRecords: number
  /** Days in that span on which at least one sale was recorded. */
  daysTraded: number
  months: MonthRow[]
  /** True when the "monthly" figures are averages. False (under 30 days of records): they are the plain totals recorded. */
  scaled: boolean
  avgMonthlySalesCents: number
  avgMonthlyExpensesCents: number
  totalSalesCents: number
  /** Share of sales given on credit, 0 to 1. */
  creditShare: number
  /** Share of money received that came by M-Pesa, 0 to 1. */
  mpesaShare: number
  /** Profit as a share of the sales it could be worked out for. Null if no buying prices. */
  margin: number | null
  /** How much of sales that margin covers, 0 to 1. */
  marginCoverage: number
  steadiness: Steadiness
  /** Full weeks the steadiness is judged on. */
  weeks: number
  owedByCustomersCents: number
  owedToSuppliersCents: number
  entries: number
  /** Entries changed after they were first recorded, and entries deleted. */
  edited: number
  deleted: number
}

function startOfMonth(time: number, offset = 0): number {
  const d = new Date(startOfDay(time))
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return d.getTime()
}

export async function healthReport(businessId: string, now: number): Promise<HealthReport> {
  const windowStart = startOfMonth(now, -(WINDOW_MONTHS - 1))
  const all = await entriesBetween([businessId], windowStart, now + 1)
  const live = all.filter((e) => !e.cancelled)
  const first = all.length > 0 ? Math.min(...all.map((e) => e.occurredAt)) : now
  const from = startOfDay(first)
  const daysOfRecords = Math.max(1, Math.round((startOfDay(now) - from) / DAY_MS) + 1)

  let sales = 0
  let credit = 0
  let expenses = 0
  let moneyIn = 0
  let mpesaIn = 0
  let profit = 0
  let costed = 0
  const tradedDays = new Set<number>()
  const byWeek = new Map<number, number>()
  const months: MonthRow[] = []
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    const start = startOfMonth(now, -i)
    if (startOfMonth(now, -i + 1) <= from) continue // before the records began
    // A month counts as complete once it has ended, unless the records began partway through it.
    months.push({ start, salesCents: 0, expensesCents: 0, complete: i > 0 && from - start < 3 * DAY_MS })
  }

  // Weeks are counted back from today in blocks of seven days, so each is a full week.
  const weekOf = (time: number) => Math.floor((startOfDay(now) + DAY_MS - time) / (7 * DAY_MS))
  const fullWeeks = Math.floor(daysOfRecords / 7)

  for (const e of live) {
    const month = [...months].reverse().find((m) => e.occurredAt >= m.start)
    if (e.kind === 'expense') {
      expenses += e.amountCents
      if (month) month.expensesCents += e.amountCents
      continue
    }
    if (e.kind === 'payment') {
      moneyIn += e.amountCents
      if (e.method === 'mpesa') mpesaIn += e.amountCents
      continue
    }
    sales += e.amountCents
    if (month) month.salesCents += e.amountCents
    tradedDays.add(startOfDay(e.occurredAt))
    const week = weekOf(e.occurredAt)
    if (week < fullWeeks) byWeek.set(week, (byWeek.get(week) ?? 0) + e.amountCents)
    if (e.kind === 'credit') credit += e.amountCents
    else {
      moneyIn += e.amountCents
      if (e.method === 'mpesa') mpesaIn += e.amountCents
    }
    for (const line of e.lines ?? []) {
      const cost = await db.lineCosts.get(line.id)
      if (cost) {
        profit += line.totalCents - Math.round(cost.unitCostCents * line.qty)
        costed += line.totalCents
      }
    }
  }

  // Steadiness: how much weekly sales move around their average (0 = identical every week).
  let steadiness: Steadiness = 'unknown'
  if (fullWeeks >= MIN_WEEKS) {
    const weekly = Array.from({ length: fullWeeks }, (_, w) => byWeek.get(w) ?? 0)
    const mean = weekly.reduce((a, b) => a + b, 0) / weekly.length
    if (mean > 0) {
      const spread = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / weekly.length) / mean
      steadiness = spread < 0.25 ? 'steady' : spread < 0.5 ? 'fair' : 'uneven'
    }
  }

  const customers = await db.customers.where('businessId').equals(businessId).toArray()
  const supplierDebts = owedBySupplier(await db.supplierMoves.where('businessId').equals(businessId).toArray())
  // With less than a month of records, scaling up would invent sales that were never recorded
  // (three days of sales would be multiplied tenfold). Then the figures are simply what was recorded.
  const scaled = daysOfRecords >= MONTH_DAYS
  const perMonth = scaled ? MONTH_DAYS / daysOfRecords : 1

  return {
    from,
    to: now,
    daysOfRecords,
    daysTraded: tradedDays.size,
    months,
    // Averages are estimates, so they are given to the nearest shilling.
    scaled,
    avgMonthlySalesCents: scaled ? Math.round((sales * perMonth) / 100) * 100 : sales,
    avgMonthlyExpensesCents: scaled ? Math.round((expenses * perMonth) / 100) * 100 : expenses,
    totalSalesCents: sales,
    creditShare: sales > 0 ? credit / sales : 0,
    mpesaShare: moneyIn > 0 ? mpesaIn / moneyIn : 0,
    margin: costed > 0 ? profit / costed : null,
    marginCoverage: sales > 0 ? Math.min(1, costed / sales) : 0,
    steadiness,
    weeks: fullWeeks,
    owedByCustomersCents: customers.reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0),
    owedToSuppliersCents: [...supplierDebts.values()].reduce((sum, v) => sum + Math.max(0, v), 0),
    entries: all.length,
    edited: all.filter((e) => e.versions > 1 && !e.cancelled).length,
    deleted: all.filter((e) => e.cancelled).length,
  }
}
