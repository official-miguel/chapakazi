// Talking to the server about the owner's Chapa Biz plan: prices, where they stand, the price
// for a choice, and paying by M-Pesa STK Push (server function ck-pay).
//
// The last plan status is kept on the phone, so the app knows whether it is paid for even
// with no internet. The server is always the judge of prices and of what was paid.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../supabase'
import { demoApi, demoOn } from './demo'
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
}

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
}

export const planApi: PlanApi = demoOn() ? demoApi : serverApi

// ---- the plan status, remembered on the phone ---------------------------------------------

const CACHE_KEY = 'ck.plan'
let cached: PlanStatus | null = (() => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as PlanStatus) : null
  } catch {
    return null
  }
})()
const listeners = new Set<() => void>()

function remember(status: PlanStatus | null) {
  cached = status
  try {
    if (status) localStorage.setItem(CACHE_KEY, JSON.stringify(status))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // Not saved; it is fetched again next time.
  }
  listeners.forEach((l) => l())
}

/** Asks the server where the plan stands and remembers the answer. Quietly keeps the old one if offline. */
export async function refreshPlan(businessId: string | null): Promise<PlanStatus | null> {
  try {
    const status = await planApi.status(businessId)
    remember(status)
    return status
  } catch {
    return cached
  }
}

export function forgetPlan() {
  remember(null)
}

/**
 * The plan as last known, kept fresh while the app is open.
 * `locked` is true only when we KNOW the time has run out (a phone that has never heard from
 * the server is not locked).
 */
export function usePlan(businessId: string | null, enabled: boolean) {
  const status = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => cached,
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

  const endsAt = status ? new Date(status.expires_at).getTime() : null
  const free = !!status?.exempt
  const locked = !free && endsAt !== null && endsAt <= now
  const endsSoon = !free && endsAt !== null && !locked && endsAt - now < 24 * 60 * 60 * 1000
  return { status, locked, endsSoon, refresh }
}
