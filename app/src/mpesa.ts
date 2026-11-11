import { db, newId } from './db'
import type { MpesaLink } from './db'

// A shop asking for its Till or Paybill to be connected, so M-Pesa payments arrive by themselves.
// The shop sends the request; the super admin (the app owner) sets it up and decides the status.

export type MpesaRequestInput = { kind: MpesaLink['kind']; shortcode: string; name: string }

/** Till and Paybill numbers are 5 to 8 digits. */
export const validShortcode = (text: string) => /^[0-9]{5,8}$/.test(text.trim())

/**
 * Sends the request, or corrects one already sent. Each shop has one.
 * The status shown on the phone is whatever the server last said; a new or changed number
 * always goes back to "requested", here and on the server.
 */
export async function requestMpesa(businessId: string, input: MpesaRequestInput, personId: string): Promise<void> {
  const now = Date.now()
  const existing = await db.mpesaLinks.where('businessId').equals(businessId).first()
  const shortcode = input.shortcode.trim()
  const sameNumber = existing?.shortcode === shortcode && existing.kind === input.kind
  await db.mpesaLinks.put({
    id: existing?.id ?? newId(),
    businessId,
    kind: input.kind,
    shortcode,
    name: input.name.trim(),
    status: sameNumber && existing ? existing.status : 'requested',
    adminNote: sameNumber ? existing?.adminNote : null,
    requestedBy: existing?.requestedBy ?? personId,
    requestedAt: existing?.requestedAt ?? now,
    updatedAt: now,
  })
}
