// CHAPA BIZ: the plan-payment server function "ck-pay", as ONE file for pasting into the
// Supabase dashboard (Edge Functions). Same code as supabase/functions/ck-pay/index.ts + daraja.ts.
// After deploying, turn OFF "Enforce JWT verification" for this function (Safaricom cannot log in).

// CHAPA KAZI (Chapa Biz): owners pay for their plan with M-Pesa STK Push.
//
//   POST .../ck-pay/start            (signed-in owner) {period, shops, phone}
//        Works out the price ON THE SERVER, saves the payment, asks Safaricom to show the
//        "enter your M-Pesa PIN" prompt on the phone. Returns {payment_id, amount}.
//   POST .../ck-pay/status           (signed-in owner) {payment_id}
//        Where that payment stands. If Safaricom's callback is late, asks Safaricom directly.
//   POST .../ck-pay/callback/<token> (Safaricom) the result of the PIN prompt.
//        Safaricom cannot sign in, so the address ends in a long secret token (Vault).
//
// verify_jwt is OFF for this function because Safaricom has no login. The start and status
// routes check the caller's login themselves.
//
// The Daraja keys, short code and passkey are in Supabase Vault (entered in Super admin),
// never in the app.
import { createClient } from 'npm:@supabase/supabase-js@2'

// ---- helpers (daraja.ts) -------------------------------------------------------------

export type Env = 'sandbox' | 'production'

export const darajaBase = (env: Env) =>
  env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'

/** Any way a Kenyan writes a mobile number, as Safaricom wants it: 2547XXXXXXXX. Null if not one. */
export function normalizePhone(input: string): string | null {
  const digits = (input ?? '').replace(/[\s\-().]/g, '').replace(/^\+/, '')
  let m = /^0([17]\d{8})$/.exec(digits)
  if (m) return '254' + m[1]
  m = /^([17]\d{8})$/.exec(digits)
  if (m) return '254' + m[1]
  m = /^254([17]\d{8})$/.exec(digits)
  if (m) return '254' + m[1]
  return null
}

/** Safaricom's timestamp, in Kenyan time: YYYYMMDDHHmmss. */
export function kenyaTimestamp(at: Date = new Date()): string {
  const k = new Date(at.getTime() + 3 * 60 * 60 * 1000) // Kenya is UTC+3 all year
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    k.getUTCFullYear() + two(k.getUTCMonth() + 1) + two(k.getUTCDate()) +
    two(k.getUTCHours()) + two(k.getUTCMinutes()) + two(k.getUTCSeconds())
  )
}

/** The STK "Password": base64 of short code + passkey + timestamp. */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(shortcode + passkey + timestamp)
}

export interface StkResult {
  checkoutRequestId: string
  merchantRequestId: string
  resultCode: number
  resultDesc: string
  receipt: string | null
  amountKes: number | null
  phone: string | null
}

/** Reads Safaricom's STK callback body. Null if it is not one. */
export function parseStkCallback(body: unknown): StkResult | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback
  if (!cb || typeof cb.CheckoutRequestID !== 'string' || cb.CheckoutRequestID === '') return null
  const code = Number(cb.ResultCode)
  if (!Number.isInteger(code)) return null

  const items = ((cb.CallbackMetadata as { Item?: unknown[] })?.Item ?? []) as { Name?: string; Value?: unknown }[]
  const item = (name: string) => items.find((i) => i?.Name === name)?.Value
  const amount = Number(item('Amount'))
  const receipt = item('MpesaReceiptNumber')
  const phone = item('PhoneNumber')

  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: typeof cb.MerchantRequestID === 'string' ? cb.MerchantRequestID : '',
    resultCode: code,
    resultDesc: typeof cb.ResultDesc === 'string' ? cb.ResultDesc.slice(0, 300) : '',
    receipt: typeof receipt === 'string' && /^[A-Z0-9]{6,20}$/.test(receipt) ? receipt : null,
    amountKes: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : null,
    phone: phone === undefined || phone === null ? null : String(phone),
  }
}

/**
 * Reads Safaricom's answer to "what happened to this STK request?".
 * Null while the customer has not answered yet (Safaricom says it is still being processed).
 */
export function parseStkQuery(body: Record<string, unknown>): { resultCode: number; resultDesc: string } | null {
  if (body.ResultCode === undefined || body.ResultCode === null || body.ResultCode === '') return null
  const code = Number(body.ResultCode)
  if (!Number.isInteger(code)) return null
  return { resultCode: code, resultDesc: String(body.ResultDesc ?? '').slice(0, 300) }
}

// ---- the function (index.ts) ----------------------------------------------------------

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface DarajaConfig {
  env: Env | null
  key: string | null
  secret: string | null
  shortcode: string | null
  type: 'paybill' | 'till' | null
  store: string | null
  passkey: string | null
  token: string | null
}

async function loadConfig(): Promise<DarajaConfig | null> {
  const { data, error } = await admin.rpc('ck_internal_daraja_config')
  if (error || !data) return null
  const c = data as DarajaConfig
  if (!c.key || !c.secret || !c.shortcode || !c.passkey || !c.token) return null
  return { ...c, env: c.env === 'production' ? 'production' : 'sandbox' }
}

async function darajaToken(c: DarajaConfig): Promise<string> {
  const res = await fetch(`${darajaBase(c.env!)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + btoa(`${c.key}:${c.secret}`) },
  })
  if (!res.ok) throw new Error(`token ${res.status}`)
  const body = await res.json()
  if (!body.access_token) throw new Error('token missing')
  return body.access_token as string
}

/** For a Till, Safaricom wants the store number as the "business" and the till as the receiver. */
const payTo = (c: DarajaConfig) =>
  c.type === 'till'
    ? { business: c.store!, partyB: c.shortcode!, type: 'CustomerBuyGoodsOnline' }
    : { business: c.shortcode!, partyB: c.shortcode!, type: 'CustomerPayBillOnline' }

/** The signed-in owner, or null. Workers cannot pay; their shop's owner does. */
async function owner(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data, error } = await admin.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return null
  if (user.app_metadata?.app !== 'chapa_kazi') return null
  if ((user.email ?? '').endsWith('@workers.chapakazi.invalid')) return null
  return user.id
}

async function start(req: Request): Promise<Response> {
  const uid = await owner(req)
  if (!uid) return reply({ error: 'not_allowed' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'bad_request' }, 400) }
  const period = body.period === null ? null : String(body.period ?? '')
  const shops = Number(body.shops)
  const phone = normalizePhone(String(body.phone ?? ''))
  if (!phone) return reply({ error: 'bad_phone' }, 400)
  if (period !== null && !['daily', 'weekly', 'monthly'].includes(period)) return reply({ error: 'bad_period' }, 400)
  if (!Number.isInteger(shops)) return reply({ error: 'bad_shops' }, 400)

  const config = await loadConfig()
  if (!config) return reply({ error: 'not_set_up' }, 503)

  // The price comes from here, never from the phone.
  const { data: made, error } = await admin.rpc('ck_internal_sub_start', {
    p_owner: uid, p_period: period, p_shops: shops, p_phone: phone, p_env: config.env,
  })
  if (error) return reply({ error: 'server_error' }, 500)
  if (!made?.ok) return reply({ error: made?.error ?? 'server_error', owned: made?.owned }, 400)

  const paymentId = made.payment_id as string
  const amount = made.total as number
  try {
    const token = await darajaToken(config)
    const timestamp = kenyaTimestamp()
    const to = payTo(config)
    const res = await fetch(`${darajaBase(config.env!)}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: to.business,
        Password: stkPassword(to.business, config.passkey!, timestamp),
        Timestamp: timestamp,
        TransactionType: to.type,
        Amount: amount,
        PartyA: phone,
        PartyB: to.partyB,
        PhoneNumber: phone,
        CallBackURL: `${Deno.env.get('SUPABASE_URL')}/functions/v1/ck-pay/callback/${config.token}`,
        AccountReference: 'ChapaBiz',
        TransactionDesc: 'Chapa Biz plan',
      }),
    })
    const out = await res.json().catch(() => ({}))
    const ok = res.ok && String(out.ResponseCode) === '0' && typeof out.CheckoutRequestID === 'string'
    await admin.rpc('ck_internal_sub_sent', {
      p_payment: paymentId,
      p_checkout: ok ? out.CheckoutRequestID : '',
      p_merchant: out.MerchantRequestID ?? '',
      p_ok: ok,
      p_desc: String(out.errorMessage ?? out.ResponseDescription ?? `HTTP ${res.status}`).slice(0, 300),
    })
    if (!ok) return reply({ error: 'mpesa_refused', payment_id: paymentId }, 502)
  } catch (e) {
    await admin.rpc('ck_internal_sub_sent', {
      p_payment: paymentId, p_checkout: '', p_merchant: '', p_ok: false, p_desc: String(e).slice(0, 300),
    })
    return reply({ error: 'mpesa_unreachable', payment_id: paymentId }, 502)
  }

  return reply({ payment_id: paymentId, amount, status: 'pending', new_expires_at: made.new_expires_at })
}

// After this long with no answer, the phone is told "timed out". The payment itself stays
// open, so a late "paid" from Safaricom is still credited.
const GIVE_UP_MS = 120_000
// Give Safaricom's callback this long before asking Safaricom ourselves.
const ASK_AFTER_MS = 25_000

async function status(req: Request): Promise<Response> {
  const uid = await owner(req)
  if (!uid) return reply({ error: 'not_allowed' }, 401)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'bad_request' }, 400) }

  const read = async () =>
    (await admin.rpc('ck_internal_sub_payment', { p_owner: uid, p_payment: String(body.payment_id ?? '') })).data
  let p = await read()
  if (!p) return reply({ error: 'not_found' }, 404)

  const age = Date.now() - new Date(p.created_at).getTime()
  if (p.status === 'pending' && p.checkout_request_id && age > ASK_AFTER_MS) {
    const config = await loadConfig()
    if (config) {
      try {
        const token = await darajaToken(config)
        const timestamp = kenyaTimestamp()
        const to = payTo(config)
        const res = await fetch(`${darajaBase(config.env!)}/mpesa/stkpushquery/v1/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            BusinessShortCode: to.business,
            Password: stkPassword(to.business, config.passkey!, timestamp),
            Timestamp: timestamp,
            CheckoutRequestID: p.checkout_request_id,
          }),
        })
        const out = await res.json().catch(() => ({}))
        const answer = parseStkQuery(out)
        if (answer) {
          await admin.rpc('ck_internal_sub_finish', {
            p_checkout: p.checkout_request_id,
            p_result_code: answer.resultCode,
            p_result_desc: answer.resultDesc,
            p_receipt: null,
            // Safaricom confirmed the amount we asked for; the callback, if it comes, adds the receipt.
            p_paid_kes: answer.resultCode === 0 ? p.amount_kes : null,
            p_raw: { source: 'query', body: out },
          })
          p = await read()
        }
      } catch {
        // Could not ask Safaricom right now; the phone will ask again.
      }
    }
  }

  const shown = ['starting', 'pending'].includes(p.status) && age > GIVE_UP_MS ? 'timeout' : p.status
  return reply({
    payment_id: p.id,
    status: shown === 'starting' ? 'pending' : shown,
    amount: p.amount_kes,
    receipt: p.mpesa_receipt,
    result_code: p.result_code,
    expires_at: p.expires_after,
  })
}

async function callback(token: string, req: Request): Promise<Response> {
  const { data: good } = await admin.rpc('ck_internal_check_callback_token', { p_token: token })
  if (good !== true) return reply({ error: 'not_found' }, 404)

  let body: unknown
  try { body = await req.json() } catch { return reply({ error: 'bad_request' }, 400) }
  const r = parseStkCallback(body)
  // Something we cannot read is acknowledged, so Safaricom stops repeating it.
  if (!r) return reply({ ResultCode: 0, ResultDesc: 'Accepted' })

  const { error } = await admin.rpc('ck_internal_sub_finish', {
    p_checkout: r.checkoutRequestId,
    p_result_code: r.resultCode,
    p_result_desc: r.resultDesc,
    p_receipt: r.receipt,
    p_paid_kes: r.amountKes,
    p_raw: body,
  })
  if (error) return reply({ error: 'server_error' }, 500) // Safaricom will try again
  return reply({ ResultCode: 0, ResultDesc: 'Accepted' })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'bad_request' }, 405)

  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const at = parts.lastIndexOf('ck-pay')
  const action = parts[at + 1]

  if (action === 'start') return start(req)
  if (action === 'status') return status(req)
  if (action === 'callback' && (parts[at + 2] ?? '').length >= 32) return callback(parts[at + 2], req)
  return reply({ error: 'not_found' }, 404)
})
