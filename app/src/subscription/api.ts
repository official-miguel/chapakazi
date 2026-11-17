// Talking to the server about the owner's Chapa Biz plan: prices, where they stand, the price
// for a choice, and paying by M-Pesa STK Push (server function ck-pay).
//
// The last plan status is kept on the phone, so the app knows whether it is paid for even
// with no internet. The server is always the judge of prices and of what was paid.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../supabase'
import { demoApi, demoOn } from './demo'
import { planView } from './gate'
import type { Period, PlanName, PriceRow } from './pricing'

export interface PlanStatus {
  role: 'owner' | 'worker'
  active: boolean
  /** The super admin switched 'must pay' off: free, never locked. */
  exempt?: boolean
  expires_at: string
  in_trial?: boolean
  shops?: number
  plan?: PlanName
  shops_after?: number | null
  shops_change_at?: string | null
  period?: Period | null
  owned_shops?: number
  /** The period this owner has paid for most often (the plan offered first). */
  usual_period?: Period | null
  /** How many shops they paid for last time. */
  usual_shops?: number | null
  /** When the 5 free minutes for the current end date end, if this login started them. */
  grace_until?: string | null
  /** The plan chosen during the free trial (nothing paid yet), offered first when it ends. */
  chosen_period?: Period | null
  chosen_shops?: number | null
  chosen_at?: string | null
}

/** A plan chosen during the trial, kept on the phone too (works offline). */
export type PlanChoice = { period: Period; shops: number; at: number }

export interface Quote {
  ok: boolean
  error?: string
  owned?: number
  kind: 'renew' | 'add_shops'
  period: Period | null
  shops: number
  plan: PlanName
  renewal: number
  extra_now: number
  total: number
  saving_vs_daily: number
  new_expires_at: string
}

export type PayState = 'pending' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'underpaid'

export interface PayStatus {
  payment_id: string
  status: PayState
  amount: number
  receipt: string | null
  result_code: number | null
  expires_at: string | null
}

/** A reason a payment could not start, as a key the screen turns into plain words. */
export class PayError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export interface PlanApi {
  prices(): Promise<PriceRow[]>
  status(businessId: string | null): Promise<PlanStatus>
  quote(period: Period | null, shops: number): Promise<Quote>
  start(period: Period | null, shops: number, phone: string): Promise<{ payment_id: string; amount: number }>
  check(paymentId: string): Promise<PayStatus>
  /** Starts (or looks up) the 5 minutes of use after the plan has ended. */
  startGrace(businessId: string | null): Promise<{ ok: boolean; error?: string; grace_until?: string }>
  /** Remembers the plan chosen during the trial. Charges nothing. */
  choose(period: Period, shops: number): Promise<{ ok: boolean; error?: string }>
}

/** Reads the server's error code out of a failed server-function call. */
async function errorCode(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // not JSON
    }
  }
  return navigator.onLine ? 'server_error' : 'offline'
}

const serverApi: PlanApi = {
  async prices() {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.from('ck_sub_prices').select('period, days, base_kes, addon_kes')
    if (error) throw new PayError(navigator.onLine ? 'server_error' : 'offline')
    return data as PriceRow[]
  },
  async status(businessId) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.rpc('ck_sub_status', { p_business: businessId })
    if (error) throw new PayError(navigator.onLine ? 'server_error' : 'offline')
    return data as PlanStatus
  },
  async quote(period, shops) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.rpc('ck_sub_quote', { p_period: period, p_shops: shops })
    if (error) throw new PayError(navigator.onLine ? 'server_error' : 'offline')
    return data as Quote
  },
  async start(period, shops, phone) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.functions.invoke('ck-pay/start', { body: { period, shops, phone } })
    if (error) throw new PayError(await errorCode(error))
    return data
  },
  async check(paymentId) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.functions.invoke('ck-pay/status', { body: { payment_id: paymentId } })
    if (error) throw new PayError(await errorCode(error))
    return data as PayStatus
  },
  async startGrace(businessId) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.rpc('ck_sub_grace_start', { p_business: businessId })
    if (error) throw new PayError(navigator.onLine ? 'server_error' : 'offline')
    return data
  },
  async choose(period, shops) {
    if (!supabase) throw new PayError('no_account')
    const { data, error } = await supabase.rpc('ck_sub_choose', { p_period: period, p_shops: shops })
    if (error) throw new PayError(navigator.onLine ? 'server_error' : 'offline')
    return data
  },
}

export const planApi: PlanApi = demoOn() ? demoApi : serverApi

// ---- the plan status, remembered on the phone ---------------------------------------------

const CACHE_KEY = 'ck.plan'
const GRACE_KEY = 'ck.grace'
const CHOICE_KEY = 'ck.planChoice'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not saved; it is fetched again next time.
  }
}

type Snapshot = {
  status: PlanStatus | null
  /** The last try to ask the server failed (offline, say). */
  failed: boolean
  /** When this phone started the 5 minutes, by the end date they were for. */
  grace: Record<string, number>
  /** The plan chosen on this phone during the trial. */
  choice: PlanChoice | null
}
let snap: Snapshot = {
  status: readJson<PlanStatus>(CACHE_KEY),
  failed: false,
  grace: readJson(GRACE_KEY) ?? {},
  choice: readJson<PlanChoice>(CHOICE_KEY),
}
const listeners = new Set<() => void>()

function update(change: Partial<Snapshot>) {
  snap = { ...snap, ...change }
  if ('status' in change) writeJson(CACHE_KEY, change.status ?? null)
  if ('grace' in change) writeJson(GRACE_KEY, change.grace ?? null)
  if ('choice' in change) writeJson(CHOICE_KEY, change.choice ?? null)
  listeners.forEach((l) => l())
}

/** Asks the server where the plan stands and remembers the answer. Quietly keeps the old one if offline. */
export async function refreshPlan(businessId: string | null): Promise<PlanStatus | null> {
  try {
    const status = await planApi.status(businessId)
    update({ status, failed: false })
    return status
  } catch {
    update({ failed: true })
    return snap.status
  }
}

export function forgetPlan() {
  update({ status: null, failed: false, grace: {}, choice: null })
}

/**
 * The person chose to use the app for 5 minutes after the plan ended. Counts at once on this
 * phone (so it works offline) and is recorded by the server, which keeps it to once per end date
 * for this login even across phones.
 */
export async function beginGrace(businessId: string | null): Promise<void> {
  const endsAt = snap.status?.expires_at
  if (!endsAt || snap.grace[endsAt] !== undefined) return
  // Only one end date matters at a time, so older ones are dropped.
  update({ grace: { [endsAt]: Date.now() } })
  try {
    const result = await planApi.startGrace(businessId)
    if (result.ok && result.grace_until && snap.status?.expires_at === endsAt) {
      update({ status: { ...snap.status, grace_until: result.grace_until } })
    }
  } catch {
    // Offline: this phone's own record stands.
  }
}

/**
 * The owner chose the plan they want after the trial. Nothing is charged: it is remembered on
 * this phone at once and on the server (so their other phones know), and offered first when the
 * trial ends. Returns an error code if the server refused it (for example fewer shops than owned).
 */
export async function choosePlan(period: Period, shops: number): Promise<string | null> {
  update({ choice: { period, shops, at: Date.now() } })
  try {
    const result = await planApi.choose(period, shops)
    if (!result.ok) return result.error ?? 'other'
    void refreshPlan(null)
  } catch {
    // Offline, or the server is not updated yet: this phone's own record stands.
  }
  return null
}

/**
 * The plan as last known, kept fresh while the app is open (when `enabled`).
 * `locked` is true only when we KNOW the time has run out and the 5 minutes are not running.
 */
export function usePlan(businessId: string | null, enabled: boolean) {
  const { status, failed, grace, choice } = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snap,
  )

  const [now, setNow] = useState(() => Date.now())
  const refresh = useCallback(() => refreshPlan(businessId), [businessId])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const again = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', again)
    window.addEventListener('online', again)
    // The end time can pass while the app sits open.
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('online', again)
      window.clearInterval(tick)
    }
  }, [enabled, refresh])

  const view = planView(status, now, status ? (grace[status.expires_at] ?? null) : null)

  // Wake exactly when the plan ends or the 5 minutes run out, not up to 30 seconds late.
  const endsAt = status ? new Date(status.expires_at).getTime() : null
  const nextChange = view.inGrace ? view.graceUntil : endsAt !== null && endsAt > now ? endsAt : null
  useEffect(() => {
    if (nextChange === null || nextChange - Date.now() > 2 ** 31 - 1) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextChange - Date.now()) + 50)
    return () => window.clearTimeout(timer)
  }, [nextChange])

  return { status, failed, choice, ...view, refresh }
}
