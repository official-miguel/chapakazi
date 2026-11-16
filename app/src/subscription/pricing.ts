// Chapa Biz plan prices, as shown on the phone.
//
// The phone uses this only to SHOW prices instantly while the owner taps. The amount actually
// charged is always worked out again on the server (ck_sub_quote_for in migration 0011),
// from the same price table and with the same formula:
//
//   total = base + (shops - 1) x add-on
//
// Prices are never written here: they come from the server's ck_sub_prices table.

export type Period = 'daily' | 'weekly' | 'monthly'
export type PlanName = 'starter' | 'growth' | 'business' | 'enterprise'

export const PERIODS: Period[] = ['daily', 'weekly', 'monthly']

export interface PriceRow {
  period: Period
  days: number
  base_kes: number
  addon_kes: number
}

export function planName(shops: number): PlanName {
  if (shops <= 1) return 'starter'
  if (shops <= 3) return 'growth'
  if (shops <= 5) return 'business'
  return 'enterprise'
}

/** Price in whole KES for one period and a number of shops (at least 1). */
export function periodTotal(price: PriceRow, shops: number): number {
  const n = Math.max(1, Math.floor(shops))
  return price.base_kes + (n - 1) * price.addon_kes
}

/** How much less this period costs than paying daily for the same number of days. */
export function savingVsDaily(prices: PriceRow[], period: Period, shops: number): number {
  const price = prices.find((p) => p.period === period)
  const daily = prices.find((p) => p.period === 'daily')
  if (!price || !daily || period === 'daily') return 0
  return Math.max(0, periodTotal(daily, shops) * price.days - periodTotal(price, shops))
}

/** "KES 1,199" */
export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-US')}`
}
