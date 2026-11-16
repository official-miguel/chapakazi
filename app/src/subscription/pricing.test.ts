import { describe, expect, it } from 'vitest'
import { formatKes, periodTotal, planName, savingVsDaily, type PriceRow } from './pricing'

// The prices agreed on 2026-11-16 (the real ones live in the server's ck_sub_prices table).
const prices: PriceRow[] = [
  { period: 'daily', days: 1, base_kes: 49, addon_kes: 29 },
  { period: 'weekly', days: 7, base_kes: 299, addon_kes: 179 },
  { period: 'monthly', days: 30, base_kes: 1199, addon_kes: 699 },
]
const [daily, weekly, monthly] = prices

describe('periodTotal: base + (shops - 1) x add-on', () => {
  it('one shop pays only the base', () => {
    expect(periodTotal(daily, 1)).toBe(49)
    expect(periodTotal(weekly, 1)).toBe(299)
    expect(periodTotal(monthly, 1)).toBe(1199)
  })

  it('each extra shop adds the add-on', () => {
    expect(periodTotal(daily, 2)).toBe(78)
    expect(periodTotal(weekly, 3)).toBe(299 + 2 * 179)
    expect(periodTotal(monthly, 6)).toBe(1199 + 5 * 699)
  })

  it('never charges for fewer than one shop', () => {
    expect(periodTotal(monthly, 0)).toBe(1199)
    expect(periodTotal(monthly, -3)).toBe(1199)
  })
})

describe('planName', () => {
  it.each([
    [1, 'starter'],
    [2, 'growth'],
    [3, 'growth'],
    [4, 'business'],
    [5, 'business'],
    [6, 'enterprise'],
    [40, 'enterprise'],
  ])('%i shops is %s', (shops, name) => {
    expect(planName(shops)).toBe(name)
  })
})

describe('savingVsDaily', () => {
  it('weekly for 1 shop saves 7 x 49 - 299', () => {
    expect(savingVsDaily(prices, 'weekly', 1)).toBe(44)
  })

  it('monthly for 2 shops saves 30 x 78 - 1,898', () => {
    expect(savingVsDaily(prices, 'monthly', 2)).toBe(442)
  })

  it('daily saves nothing', () => {
    expect(savingVsDaily(prices, 'daily', 3)).toBe(0)
  })
})

describe('formatKes', () => {
  it('adds thousands commas', () => {
    expect(formatKes(1199)).toBe('KES 1,199')
    expect(formatKes(49)).toBe('KES 49')
  })
})
