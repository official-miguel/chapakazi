// Super admin side of Chapa Biz plans: every payment, the price table, and the STK Push
// settings (Paybill/Till and passkey). The server refuses all of this to anyone who is not a
// platform admin, whatever the app shows.
import { supabase } from '../supabase'
import type { PayState } from './api'
import { demoFlag } from './demo'
import type { Period, PriceRow } from './pricing'

export interface AdminPayment {
  id: string
  created_at: string
  kind: 'renew' | 'add_shops'
  period: Period | null
  shops: number
  amount_kes: number
  paid_amount_kes: number | null
  phone: string
  status: PayState | 'starting'
  mpesa_receipt: string | null
  result_code: number | null
  result_desc: string | null
  environment: 'sandbox' | 'production'
  expires_after: string | null
  raw_callback: unknown
  shop_names: string | null
}

export interface StkStatus {
  set: boolean
  shortcode?: string
  type?: 'paybill' | 'till'
  store?: string | null
  updated_at?: string
}

/** Opening the app with ?adminDemo=1 (development builds only) shows made-up rows here. */
export const adminDemo = () => demoFlag('adminDemo')

const need = () => {
  if (!supabase) throw new Error('No server')
  return supabase
}

export async function loadSubPayments(limit = 200): Promise<AdminPayment[]> {
  if (adminDemo()) return demoPayments
  const { data, error } = await need().rpc('ck_admin_sub_payments', { p_limit: limit })
  if (error) throw error
  return data as AdminPayment[]
}

export async function loadPrices(): Promise<PriceRow[]> {
  if (adminDemo()) return demoPrices.map((p) => ({ ...p }))
  const { data, error } = await need().from('ck_sub_prices').select('period, days, base_kes, addon_kes')
  if (error) throw error
  return data as PriceRow[]
}

export async function savePrice(period: Period, base: number, addon: number): Promise<void> {
  if (adminDemo()) {
    const row = demoPrices.find((p) => p.period === period)!
    row.base_kes = base
    row.addon_kes = addon
    return
  }
  const { error } = await need().rpc('ck_admin_set_price', { p_period: period, p_base: base, p_addon: addon })
  if (error) throw error
}

export async function loadStkStatus(): Promise<StkStatus> {
  if (adminDemo()) return demoStk
  const { data, error } = await need().rpc('ck_admin_stk_status')
  if (error) throw error
  return data as StkStatus
}

/** Saved encrypted on the server; the passkey can never be read back here. */
export async function saveStkSettings(shortcode: string, passkey: string, till: boolean, store: string): Promise<void> {
  if (adminDemo()) {
    demoStk = { set: true, shortcode, type: till ? 'till' : 'paybill', store: till ? store : null, updated_at: new Date().toISOString() }
    return
  }
  const { error } = await need().rpc('ck_admin_set_stk_settings', {
    p_shortcode: shortcode.trim(),
    p_passkey: passkey.trim(),
    p_till: till,
    p_store: store.trim(),
  })
  if (error) throw error
}

// ---- made-up rows for trying the screens ------------------------------------------------

const demoPrices: PriceRow[] = [
  { period: 'daily', days: 1, base_kes: 49, addon_kes: 29 },
  { period: 'weekly', days: 7, base_kes: 299, addon_kes: 179 },
  { period: 'monthly', days: 30, base_kes: 1199, addon_kes: 699 },
]
let demoStk: StkStatus = { set: false }
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const demoPayments: AdminPayment[] = [
  { id: 'd1', created_at: ago(1), kind: 'renew', period: 'monthly', shops: 2, amount_kes: 1898, paid_amount_kes: 1898, phone: '254708374149', status: 'success', mpesa_receipt: 'TST4K2L9QW', result_code: 0, result_desc: 'The service request is processed successfully.', environment: 'sandbox', expires_after: ago(-24 * 30), raw_callback: { Body: { stkCallback: { ResultCode: 0 } } }, shop_names: 'Mama Wanjiku Shop, Wanjiku Kiosk 2' },
  { id: 'd2', created_at: ago(3), kind: 'renew', period: 'daily', shops: 1, amount_kes: 49, paid_amount_kes: null, phone: '254712345670', status: 'cancelled', mpesa_receipt: null, result_code: 1032, result_desc: 'Request cancelled by user', environment: 'sandbox', expires_after: null, raw_callback: { Body: { stkCallback: { ResultCode: 1032 } } }, shop_names: 'Otieno Hardware' },
  { id: 'd3', created_at: ago(26), kind: 'add_shops', period: null, shops: 3, amount_kes: 1026, paid_amount_kes: 1026, phone: '254708374149', status: 'success', mpesa_receipt: 'TST8H1M3ZX', result_code: 0, result_desc: 'The service request is processed successfully.', environment: 'sandbox', expires_after: ago(-24 * 29), raw_callback: null, shop_names: 'Mama Wanjiku Shop, Wanjiku Kiosk 2, Wanjiku Kiosk 3' },
  { id: 'd4', created_at: ago(50), kind: 'renew', period: 'weekly', shops: 1, amount_kes: 299, paid_amount_kes: 200, phone: '254722000111', status: 'underpaid', mpesa_receipt: 'TST2B7N5CV', result_code: 0, result_desc: 'The service request is processed successfully.', environment: 'sandbox', expires_after: null, raw_callback: null, shop_names: 'Akinyi Salon' },
  { id: 'd5', created_at: ago(51), kind: 'renew', period: 'weekly', shops: 1, amount_kes: 299, paid_amount_kes: null, phone: '254722000111', status: 'timeout', mpesa_receipt: null, result_code: 1037, result_desc: 'DS timeout user cannot be reached', environment: 'sandbox', expires_after: null, raw_callback: null, shop_names: 'Akinyi Salon' },
]

// ---- accounts and the "must pay" switch ---------------------------------------------------

export interface AdminAccount {
  owner_uid: string
  email: string | null
  exempt: boolean
  in_trial: boolean
  active: boolean
  expires_at: string
  shops: number
  period: Period | null
  shop_names: string | null
  shop_count: number
  last_paid_at: string | null
}

/** Every shop owner's account, with their plan and whether they must pay. */
export async function loadAccounts(): Promise<AdminAccount[]> {
  if (adminDemo()) return demoAccounts.map((a) => ({ ...a }))
  const { data, error } = await need().rpc('ck_admin_sub_accounts')
  if (error) throw error
  return data as AdminAccount[]
}

/** mustPay = false makes the owner free: never locked, never asked to pay. */
export async function setMustPay(ownerUid: string, mustPay: boolean): Promise<void> {
  if (adminDemo()) {
    const a = demoAccounts.find((x) => x.owner_uid === ownerUid)
    if (a) a.exempt = !mustPay
    return
  }
  const { error } = await need().rpc('ck_admin_set_exempt', { p_owner: ownerUid, p_exempt: !mustPay })
  if (error) throw error
}

const demoAccounts: AdminAccount[] = [
  { owner_uid: 'a1', email: 'wanjiku@example.com', exempt: false, in_trial: false, active: true, expires_at: ago(-24 * 30), shops: 3, period: 'monthly', shop_names: 'Mama Wanjiku Shop, Wanjiku Kiosk 2, Wanjiku Kiosk 3', shop_count: 3, last_paid_at: ago(1) },
  { owner_uid: 'a2', email: 'otieno@example.com', exempt: false, in_trial: true, active: true, expires_at: ago(-24 * 9), shops: 1, period: null, shop_names: 'Otieno Hardware', shop_count: 1, last_paid_at: null },
  { owner_uid: 'a3', email: 'akinyi@example.com', exempt: false, in_trial: false, active: false, expires_at: ago(30), shops: 1, period: 'weekly', shop_names: 'Akinyi Salon', shop_count: 1, last_paid_at: ago(24 * 8) },
  { owner_uid: 'a4', email: 'pilot@example.com', exempt: true, in_trial: true, active: true, expires_at: ago(-24 * 2), shops: 2, period: null, shop_names: 'Pilot Duka, Pilot Duka 2', shop_count: 2, last_paid_at: null },
]
