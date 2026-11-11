// CHAPA KAZI: where Safaricom tells us about M-Pesa payments (Daraja "C2B" callbacks).
//
// Safaricom calls one of two addresses for every payment to a connected Till or Paybill:
//   .../ck-mpesa/validate/<token>   "may this payment go ahead?"  We always say yes: the app
//                                   must never be the reason a customer's payment fails.
//   .../ck-mpesa/confirm/<token>    "this payment happened."      We file it for the shop.
//
// Safaricom does not sign these messages and cannot log in, so this function is open to the
// internet and protects itself: the address must end in a long secret token, which is checked
// in the database. Without it nothing is stored.
import { createClient } from 'npm:@supabase/supabase-js@2'

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// What Safaricom expects to hear back.
const accepted = () => reply({ ResultCode: 0, ResultDesc: 'Accepted' })

const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')

/** "20261111143005" in Kenyan time becomes a moment in time. */
function paidAt(transTime: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(transTime)
  if (!m) return null
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
  return utc - 3 * 60 * 60 * 1000 // Kenya is 3 hours ahead of UTC
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'bad_request' }, 405)

  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const at = parts.lastIndexOf('ck-mpesa')
  const action = parts[at + 1]
  const token = parts[at + 2] ?? ''

  if (action === 'validate') return accepted()
  if (action !== 'confirm' || token.length < 32) return reply({ error: 'not_found' }, 404)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'bad_request' }, 400)
  }

  const amount = Number(text(body.TransAmount))
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: result, error } = await admin.rpc('ck_internal_record_mpesa', {
    p_token: token,
    p_shortcode: text(body.BusinessShortCode),
    p_trans_id: text(body.TransID),
    p_amount_cents: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    p_payer: [text(body.FirstName), text(body.MiddleName), text(body.LastName)].filter(Boolean).join(' '),
    p_payer_ref: text(body.MSISDN),
    p_bill_ref: text(body.BillRefNumber),
    p_paid_at: paidAt(text(body.TransTime)),
  })

  if (error) return reply({ error: 'server_error' }, 500) // Safaricom will try again
  if (result === 'bad_token') return reply({ error: 'not_found' }, 404)
  // A payment for a shop we do not know, or a malformed one, is acknowledged so Safaricom
  // stops repeating it. It is simply not stored.
  return accepted()
})
