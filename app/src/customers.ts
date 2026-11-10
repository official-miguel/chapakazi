import { db, newId } from './db'

// Customers who buy on credit, and the reminder messages sent to them.

export type CustomerInput = { name: string; phone?: string; limitCents?: number }

export async function addCustomer(businessId: string, input: CustomerInput): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.customers.add({
    id,
    businessId,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    limitCents: input.limitCents,
    balanceCents: 0,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function updateCustomer(customerId: string, input: CustomerInput): Promise<void> {
  await db.customers
    .where('id')
    .equals(customerId)
    .modify((c) => {
      c.name = input.name.trim()
      c.phone = input.phone?.trim() || undefined
      c.limitCents = input.limitCents
      c.updatedAt = Date.now()
    })
}

/**
 * Kenyan numbers in the form WhatsApp needs: 0712… or 712… becomes 254712….
 * Returns null if it does not look like a phone number.
 */
export function internationalPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`
  if (/^254[17]\d{8}$/.test(digits)) return digits
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

/** Opens WhatsApp with the reminder already written. The person still taps send. */
export function whatsappLink(phone: string, message: string): string | null {
  const number = internationalPhone(phone)
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null
}

/** Opens the phone's SMS app with the reminder already written. */
export function smsLink(phone: string, message: string): string | null {
  const number = internationalPhone(phone)
  return number ? `sms:+${number}?body=${encodeURIComponent(message)}` : null
}
