// A pretend payment server for trying the plan screens on a laptop before the real one is
// deployed. Only in development builds (npm run dev), and only when turned on by opening the
// app with ?planDemo=1 (turn off with ?planDemo=0). It never exists in the real app.
//
// Open with ?planDemoExpire=1 to make the pretend plan run out now (to try the lock and the
// 5 minutes).
//
// Pretend phone numbers:  ending in 0 = the owner cancels;  ending in 1 = no answer (times out);
//                         anything else = paid after about 6 seconds.
import type { PayStatus, PlanApi, PlanStatus, Quote } from './api'
import { GRACE_MS } from './gate'
import { periodTotal, planName, savingVsDaily, type Period, type PriceRow } from './pricing'

const STATE_KEY = 'ck.planDemo.state'
const DAY = 86_400_000

/**
 * A practice switch, only in development builds: ?<name>=1 turns it on (remembered), ?<name>=0 off.
 * planDemo = pretend payment server for owners; adminDemo = made-up rows in Super admin.
 */
export function demoFlag(name: 'planDemo' | 'adminDemo' | 'moveDemo'): boolean {
  if (!import.meta.env.DEV) return false
  const key = 'ck.' + name
  try {
    const flag = new URLSearchParams(location.search).get(name)
    if (flag === '1') localStorage.setItem(key, '1')
    if (flag === '0') localStorage.removeItem(key)
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export const demoOn = () => demoFlag('planDemo')

const prices: PriceRow[] = [
  { period: 'daily', days: 1, base_kes: 49, addon_kes: 29 },
  { period: 'weekly', days: 7, base_kes: 299, addon_kes: 179 },
  { period: 'monthly', days: 30, base_kes: 1199, addon_kes: 699 },
]

interface State {
  shops: number
  period: Period | null
  inTrial: boolean
  expiresAt: number
  /** Periods paid for, oldest first, and the shops paid for last time. */
  paid?: Period[]
  lastShops?: number
  /** When the 5 minutes were started, by the end date they were for. */
  grace?: Record<string, number>
  /** The plan chosen during the trial. */
  chosen?: { period: Period; shops: number; at: number }
}
interface Payment {
  id: string
  at: number
  phone: string
  quote: Quote
  done?: PayStatus['status']
}

function load(): State {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // start fresh
  }
  return { shops: 1, period: null, inTrial: true, expiresAt: Date.now() + 14 * DAY }
}
const iso = (ms: number) => new Date(ms).toISOString()
const save = (s: State) => localStorage.setItem(STATE_KEY, JSON.stringify(s))
const payments = new Map<string, Payment>()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function quote(period: Period | null, shops: number): Quote {
  const s = load()
  const active = s.expiresAt > Date.now()
  const price = prices.find((p) => p.period === period)
  const renewal = price ? periodTotal(price, shops) : 0
  let extra = 0
  if (active && !s.inTrial && shops > s.shops) {
    const rate = prices.find((p) => p.period === (s.period ?? 'monthly'))!
    extra = Math.ceil(((shops - s.shops) * ((s.expiresAt - Date.now()) / DAY) * rate.addon_kes) / rate.days)
  }
  const base = { kind: period ? 'renew' : 'add_shops', period, shops, plan: planName(shops) } as const
  if (!period && extra < 1) return { ...base, ok: false, error: 'nothing_to_add', renewal: 0, extra_now: 0, total: 0, saving_vs_daily: 0, new_expires_at: '' }
  return {
    ...base,
    ok: true,
    renewal,
    extra_now: extra,
    total: renewal + extra,
    saving_vs_daily: period ? savingVsDaily(prices, period, shops) : 0,
    new_expires_at: new Date(period ? Math.max(Date.now(), s.expiresAt) + price!.days * DAY : s.expiresAt).toISOString(),
  }
}

/** The period paid for most often; on a tie, the one paid for most recently. */
function usual(paid: Period[]): Period | null {
  let best: Period | null = null
  let bestCount = 0
  for (let i = paid.length - 1; i >= 0; i--) {
    const count = paid.filter((p) => p === paid[i]).length
    if (count > bestCount) {
      best = paid[i]
      bestCount = count
    }
  }
  return best
}

export const demoApi: PlanApi = {
  async prices() {
    await wait(300)
    return prices
  },
  async status(): Promise<PlanStatus> {
    await wait(300)
    const s = load()
    return {
      role: 'owner',
      active: s.expiresAt > Date.now(),
      exempt: false,
      in_trial: s.inTrial,
      expires_at: new Date(s.expiresAt).toISOString(),
      shops: s.shops,
      plan: planName(s.shops),
      period: s.period,
      owned_shops: 1,
      usual_period: usual(s.paid ?? []),
      usual_shops: s.lastShops ?? null,
      grace_until: s.grace?.[iso(s.expiresAt)] ? iso(s.grace[iso(s.expiresAt)] + GRACE_MS) : null,
      chosen_period: s.chosen?.period ?? null,
      chosen_shops: s.chosen?.shops ?? null,
      chosen_at: s.chosen ? iso(s.chosen.at) : null,
    }
  },
  async choose(period, shops) {
    await wait(250)
    const s = load()
    s.chosen = { period, shops, at: Date.now() }
    save(s)
    return { ok: true }
  },
  async startGrace() {
    await wait(250)
    const s = load()
    if (s.expiresAt > Date.now()) return { ok: false, error: 'not_ended' }
    const key = iso(s.expiresAt)
    s.grace = { [key]: s.grace?.[key] ?? Date.now() }
    save(s)
    return { ok: true, grace_until: iso(s.grace[key] + GRACE_MS) }
  },
  async quote(period, shops) {
    await wait(250)
    return quote(period, shops)
  },
  async start(period, shops, phone) {
    await wait(800)
    const q = quote(period, shops)
    const id = crypto.randomUUID()
    payments.set(id, { id, at: Date.now(), phone, quote: q })
    return { payment_id: id, amount: q.total }
  },
  async check(id) {
    await wait(300)
    const p = payments.get(id)
    if (!p) throw new Error('not_found')
    const age = Date.now() - p.at
    if (!p.done) {
      if (p.phone.endsWith('0') && age > 4000) p.done = 'cancelled'
      else if (p.phone.endsWith('1') && age > 15000) p.done = 'timeout'
      else if (!/[01]$/.test(p.phone) && age > 6000) {
        p.done = 'success'
        const s = load()
        if (p.quote.kind === 'renew') {
          s.expiresAt = new Date(p.quote.new_expires_at).getTime()
          s.period = p.quote.period
          s.inTrial = false
          if (p.quote.period) s.paid = [...(s.paid ?? []), p.quote.period]
          s.lastShops = p.quote.shops
        }
        s.shops = p.quote.shops
        save(s)
      }
    }
    return {
      payment_id: id,
      status: p.done ?? 'pending',
      amount: p.quote.total,
      receipt: p.done === 'success' ? 'TST' + id.slice(0, 7).toUpperCase() : null,
      result_code: null,
      expires_at: p.done === 'success' ? new Date(load().expiresAt).toISOString() : null,
    }
  },
}

/** For trying the locked screen: makes the pretend plan run out now. */
export function demoExpire() {
  const s = load()
  s.expiresAt = Date.now() - 1000
  // Like the real server: an account stays "in trial" until its first payment.
  save(s)
}

// ?planDemoExpire=1 (development only, with the practice server on): the plan runs out now.
try {
  if (demoOn() && new URLSearchParams(location.search).get('planDemoExpire') === '1') demoExpire()
} catch {
  // Storage blocked: nothing to change.
}
