import { describe, expect, it } from 'vitest'
import type { PlanStatus } from './api'
import { formatCountdown, GRACE_MS, planView, usualChoice } from './gate'

const NOW = Date.parse('2026-11-17T10:00:00Z')
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const status = (over: Partial<PlanStatus> = {}): PlanStatus => ({
  role: 'owner',
  active: true,
  expires_at: iso(NOW + 3 * 86_400_000),
  in_trial: false,
  shops: 1,
  ...over,
})

describe('planView: when the app opens', () => {
  it('does not know yet when the phone has never heard from the server', () => {
    expect(planView(null, NOW)).toMatchObject({ known: false, locked: false })
  })

  it('opens while time is left, with a reminder in the last day', () => {
    expect(planView(status(), NOW)).toMatchObject({ known: true, locked: false, endsSoon: false })
    expect(planView(status({ expires_at: iso(NOW + 5 * 3_600_000) }), NOW).endsSoon).toBe(true)
  })

  it('locks once time has run out', () => {
    const v = planView(status({ expires_at: iso(NOW - 1) }), NOW)
    expect(v).toMatchObject({ ended: true, locked: true, inGrace: false, graceUsed: false })
  })

  it('never locks a free account', () => {
    expect(planView(status({ exempt: true, expires_at: iso(NOW - 86_400_000) }), NOW).locked).toBe(false)
  })

  it('opens for exactly 5 minutes after the person chooses them, then locks again', () => {
    const ended = status({ expires_at: iso(NOW - 10 * MIN) })
    const started = NOW - 2 * MIN
    expect(planView(ended, NOW, started)).toMatchObject({ locked: false, inGrace: true, graceUntil: started + GRACE_MS })
    expect(planView(ended, started + GRACE_MS - 1, started).locked).toBe(false)
    expect(planView(ended, started + GRACE_MS, started)).toMatchObject({ locked: true, inGrace: false, graceUsed: true })
  })

  it('takes the earlier start when the server and the phone disagree (no extra minutes on a second phone)', () => {
    const ended = status({ expires_at: iso(NOW - 10 * MIN), grace_until: iso(NOW + 1 * MIN) })
    expect(planView(ended, NOW, NOW).graceUntil).toBe(NOW + MIN)
    // Only the server knows (started on another phone, or the phone was cleared).
    expect(planView(ended, NOW, null)).toMatchObject({ inGrace: true, graceUntil: NOW + MIN })
  })

  it('minutes for an old end date do not count once the end date has moved', () => {
    // The phone keeps its start by end date; a new end date has none.
    const renewed = status({ expires_at: iso(NOW - MIN), grace_until: null })
    expect(planView(renewed, NOW, null)).toMatchObject({ locked: true, graceUsed: false })
  })
})

describe('usualChoice: the plan offered first', () => {
  it('is nothing before the first payment (trial only)', () => {
    expect(usualChoice(status({ in_trial: true, period: null }), 1)).toBeNull()
  })

  it('is the period paid for most, for the shops paid for last', () => {
    expect(usualChoice(status({ period: 'weekly', usual_period: 'monthly', usual_shops: 3 }), 1)).toEqual({ period: 'monthly', shops: 3 })
  })

  it('falls back to the last period paid for (older server)', () => {
    expect(usualChoice(status({ period: 'daily', shops: 2 }), 1)).toEqual({ period: 'daily', shops: 2 })
  })

  it('is never fewer shops than the owner has now', () => {
    expect(usualChoice(status({ usual_period: 'weekly', usual_shops: 1 }), 4)).toEqual({ period: 'weekly', shops: 4 })
  })
})

describe('formatCountdown', () => {
  it.each([
    [GRACE_MS, '5:00'],
    [4 * MIN + 5000, '4:05'],
    [999, '0:01'],
    [-5, '0:00'],
  ])('%i ms -> %s', (ms, text) => expect(formatCountdown(ms)).toBe(text))
})
