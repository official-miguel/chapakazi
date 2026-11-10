import { db, newId, newInviteCode } from './db'
import type { BusinessType } from './db'
import { hashPin } from './pin'

// The actions that create and change people, businesses and who works where.

/** First run: creates the owner and their first business together. Returns the owner's id. */
export async function createOwnerWithBusiness(input: {
  name: string
  phone: string
  pin: string
  businessName: string
  businessType: BusinessType
}): Promise<string> {
  const pin = await hashPin(input.pin)
  const now = Date.now()
  const personId = newId()
  await db.transaction('rw', db.people, db.businesses, db.memberships, async () => {
    await db.people.add({
      id: personId,
      name: input.name.trim(),
      phone: input.phone.trim() || undefined,
      ...pin,
      createdAt: now,
      updatedAt: now,
    })
    await addBusiness(personId, input.businessName, input.businessType)
  })
  return personId
}

/** Adds a business and makes this person its owner (admin). Returns the business id. */
export async function addBusiness(ownerId: string, name: string, type: BusinessType): Promise<string> {
  const now = Date.now()
  const businessId = newId()
  await db.transaction('rw', db.businesses, db.memberships, async () => {
    await db.businesses.add({ id: businessId, name: name.trim(), type, ownerId, createdAt: now, updatedAt: now })
    await db.memberships.add({
      id: newId(),
      personId: ownerId,
      businessId,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })
  })
  return businessId
}

/** Adds a worker to one business. They get an invite code and choose their own PIN later. */
export async function addWorker(businessId: string, name: string, phone: string): Promise<void> {
  const now = Date.now()
  const personId = newId()
  await db.transaction('rw', db.people, db.memberships, async () => {
    await db.people.add({
      id: personId,
      name: name.trim(),
      phone: phone.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })
    await db.memberships.add({
      id: newId(),
      personId,
      businessId,
      role: 'worker',
      inviteCode: newInviteCode(),
      createdAt: now,
      updatedAt: now,
    })
  })
}

/** Stops a worker opening the shop. Nothing is erased, so old entries keep their name. */
export async function removeWorker(membershipId: string): Promise<void> {
  const now = Date.now()
  await db.memberships.update(membershipId, { removedAt: now, updatedAt: now })
}

/** A new worker's first sign-in: checks the invite code, then saves the PIN they chose. */
export async function inviteCodeMatches(personId: string, code: string): Promise<boolean> {
  const cleaned = code.trim().toUpperCase()
  const rows = await db.memberships.where('personId').equals(personId).toArray()
  return rows.some((m) => !m.removedAt && m.inviteCode !== undefined && m.inviteCode === cleaned)
}

/** The person this phone belongs to chooses their PIN. No invite code is needed on their own phone. */
export async function setOwnPin(personId: string, pin: string): Promise<void> {
  const hashed = await hashPin(pin)
  await db.people.update(personId, { ...hashed, updatedAt: Date.now() })
}

/** Gives a worker a fresh invite code, for a new or replaced phone. Their old phone stops syncing once they join. */
export async function renewInvite(membershipId: string): Promise<void> {
  await db.memberships.update(membershipId, { inviteCode: newInviteCode(), updatedAt: Date.now() })
}

export async function setFirstPin(personId: string, code: string, pin: string): Promise<boolean> {
  if (!(await inviteCodeMatches(personId, code))) return false
  const hashed = await hashPin(pin)
  const now = Date.now()
  await db.transaction('rw', db.people, db.memberships, async () => {
    await db.people.update(personId, { ...hashed, updatedAt: now })
    // The code has done its job; clear it so it cannot be used again.
    await db.memberships
      .where('personId')
      .equals(personId)
      .modify((m) => {
        if (m.inviteCode !== undefined) {
          delete m.inviteCode
          m.updatedAt = now
        }
      })
  })
  return true
}
