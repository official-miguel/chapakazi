// Plain helpers for talking to Safaricom's Daraja STK Push. No server imports, so they can be
// tested on a laptop (app: npm test).

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
