import { db, newId } from './db'
import type { Entry, EntryData } from './db'
import { applySaleLines } from './stock'

// Recording, editing and cancelling ledger entries.
// Rule: nothing is ever erased. Every change adds a new version next to the old ones.

/** A lowered amount is only flagged if it happens this long after the entry (quick typo fixes are normal). */
const LOWERED_GRACE_MS = 5 * 60 * 1000
/** A deletion is "late" if the entry is older than this. */
const LATE_DELETE_MS = 60 * 60 * 1000

export type Actor = {
  personId: string
  /** Owners' own changes never raise alerts; alerts exist to tell the owner about others' edits. */
  isOwner: boolean
}

const hasItems = (kind: EntryData['kind']) => kind === 'sale' || kind === 'credit'

function clean(data: EntryData): EntryData {
  const note = data.note?.trim()
  return {
    kind: data.kind,
    amountCents: data.amountCents,
    method: data.kind === 'credit' ? 'credit' : data.method,
    category: data.kind === 'expense' ? (data.category ?? 'other') : undefined,
    note: note || undefined,
    lines: hasItems(data.kind) && data.lines?.length ? data.lines : undefined,
    cancelled: data.cancelled,
  }
}

/** How much this entry adds to what the customer owes: credit raises it, a payment lowers it. */
function debtEffect(data: EntryData): number {
  if (data.cancelled) return 0
  if (data.kind === 'credit') return data.amountCents
  if (data.kind === 'payment') return -data.amountCents
  return 0
}

/** Changes a customer's balance and returns them as they now stand. Call inside a transaction. */
async function addToBalance(customerId: string | undefined, cents: number, now: number) {
  if (!customerId) return undefined
  const customer = await db.customers.get(customerId)
  if (!customer) return undefined
  if (cents === 0) return customer
  const next = { ...customer, balanceCents: customer.balanceCents + cents, updatedAt: now }
  await db.customers.put(next)
  return next
}

/** Every table a ledger change may touch, so it all saves together or not at all. */
const ledgerTables = [
  db.entries,
  db.entryVersions,
  db.alerts,
  db.items,
  db.stockMoves,
  db.itemCosts,
  db.lineCosts,
  db.customers,
]

export async function recordEntry(
  businessId: string,
  data: Omit<EntryData, 'cancelled'>,
  actor: Actor,
  customerId?: string,
  source: Entry['source'] = 'typed',
): Promise<string> {
  const now = Date.now()
  const id = newId()
  const fields = clean({ ...data, cancelled: false })
  const needsCustomer = fields.kind === 'credit' || fields.kind === 'payment'
  if (needsCustomer && !customerId) throw new Error('A credit or payment entry needs a customer')

  await db.transaction('rw', ledgerTables, async () => {
    await applySaleLines({ id, businessId }, [], fields.lines ?? [], 'sale', actor.personId, now)
    await db.entries.add({
      ...fields,
      id,
      businessId,
      customerId: needsCustomer ? customerId : undefined,
      createdBy: actor.personId,
      createdAt: now,
      occurredAt: now,
      updatedAt: now,
      versions: 1,
      source,
    })
    await db.entryVersions.add({
      ...fields,
      id: newId(),
      entryId: id,
      businessId,
      version: 1,
      changedBy: actor.personId,
      changedAt: now,
    })

    const customer = needsCustomer ? await addToBalance(customerId, debtEffect(fields), now) : undefined
    // The limit never blocks credit. It only tells the owner when a worker went past it.
    if (
      !actor.isOwner &&
      fields.kind === 'credit' &&
      customer?.limitCents !== undefined &&
      customer.balanceCents > customer.limitCents
    ) {
      await db.alerts.add({
        id: newId(),
        businessId,
        entryId: id,
        kind: 'over_limit',
        byPersonId: actor.personId,
        at: now,
        fromCents: customer.limitCents,
        toCents: customer.balanceCents,
      })
    }
  })
  return id
}

/** Saves a new version of an entry. Used for both edits and cancelling ("deleting"). */
async function saveVersion(entryId: string, change: (current: Entry) => EntryData, actor: Actor): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', ledgerTables, async () => {
    const current = await db.entries.get(entryId)
    if (!current || current.cancelled) return
    const next = clean(change(current))
    const version = current.versions + 1

    // Put back what the old version took from stock, and take what the new one needs.
    await applySaleLines(
      current,
      current.lines ?? [],
      next.cancelled ? [] : (next.lines ?? []),
      next.cancelled ? 'sale_cancel' : 'sale_edit',
      actor.personId,
      now,
    )
    await addToBalance(current.customerId, debtEffect(next) - debtEffect(current), now)

    await db.entryVersions.add({
      ...next,
      id: newId(),
      entryId,
      businessId: current.businessId,
      version,
      changedBy: actor.personId,
      changedAt: now,
    })
    await db.entries.put({ ...current, ...next, updatedAt: now, versions: version })

    if (actor.isOwner) return
    const age = now - current.createdAt
    const alertBase = { businessId: current.businessId, entryId, byPersonId: actor.personId, at: now }
    // Lowering a sale hides money; lowering a credit shrinks what a customer owes.
    const lowerIsRisky = current.kind === 'sale' || current.kind === 'credit'
    if (next.cancelled && age > LATE_DELETE_MS) {
      await db.alerts.add({ ...alertBase, id: newId(), kind: 'late_delete', fromCents: current.amountCents })
    } else if (!next.cancelled && lowerIsRisky && next.amountCents < current.amountCents && age > LOWERED_GRACE_MS) {
      await db.alerts.add({
        ...alertBase,
        id: newId(),
        kind: 'amount_lowered',
        fromCents: current.amountCents,
        toCents: next.amountCents,
      })
    }
  })
}

export function editEntry(entryId: string, data: Omit<EntryData, 'cancelled'>, actor: Actor): Promise<void> {
  return saveVersion(entryId, () => ({ ...data, cancelled: false }), actor)
}

export function cancelEntry(entryId: string, actor: Actor): Promise<void> {
  return saveVersion(entryId, (current) => ({ ...current, cancelled: true }), actor)
}

export async function markAlertSeen(alertId: string): Promise<void> {
  await db.alerts.update(alertId, { seenAt: Date.now() })
}

/** Entries for the given shops between two times, newest first. */
export async function entriesBetween(businessIds: string[], from: number, to: number): Promise<Entry[]> {
  const ids = new Set(businessIds)
  const rows = await db.entries.where('occurredAt').between(from, to, true, false).toArray()
  return rows.filter((e) => ids.has(e.businessId)).sort((a, b) => b.occurredAt - a.occurredAt)
}

/** Money in is sales plus debt payments. Goods given on credit are not money in until they are paid. */
export function totals(entries: Entry[]): { inCents: number; outCents: number } {
  let inCents = 0
  let outCents = 0
  for (const e of entries) {
    if (e.cancelled) continue
    if (e.kind === 'sale' || e.kind === 'payment') inCents += e.amountCents
    else if (e.kind === 'expense') outCents += e.amountCents
  }
  return { inCents, outCents }
}

export function startOfDay(time: number): number {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The start of the day `days` after the given day start. Uses the calendar, so clock changes are safe. */
export function addDays(dayStart: number, days: number): number {
  const d = new Date(dayStart)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Turns what a person typed ("1,500" or "20.50") into cents. Null if it is not a usable amount. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  return cents > 0 && cents <= 100_000_000_00 ? cents : null
}
