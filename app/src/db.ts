import Dexie from 'dexie'
import type { EntityTable } from 'dexie'

// The database that lives on the phone. Everything is saved here first,
// so the app works with no internet. Syncing to the server comes later.

export type Role = 'admin' | 'worker'

export type BusinessType = 'kiosk' | 'mboga' | 'salon' | 'hardware' | 'boutique' | 'chemist' | 'other'

export interface Person {
  id: string
  name: string
  phone?: string
  /** The PIN is never stored. Only this scrambled form of it is. */
  pinSalt?: string
  pinHash?: string
  createdAt: number
  updatedAt: number
}

export interface Business {
  id: string
  name: string
  type: BusinessType
  ownerId: string
  createdAt: number
  updatedAt: number
}

/** Says which person works in which business, and as what. */
export interface Membership {
  id: string
  personId: string
  businessId: string
  role: Role
  /** A worker uses this once, to prove the owner added them, before choosing a PIN. */
  inviteCode?: string
  /** Set when a worker is removed. The record stays so past entries keep their name. */
  removedAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * sale: goods sold and paid for.       expense: money spent.
 * credit: goods given, to be paid later (raises the customer's debt).
 * payment: a customer paying off debt (lowers it).
 */
export type EntryKind = 'sale' | 'expense' | 'credit' | 'payment'
/** 'credit' means no money changed hands yet. */
export type PayMethod = 'cash' | 'mpesa' | 'credit'
export type ExpenseCategory = 'rent' | 'transport' | 'electricity' | 'water' | 'stock' | 'wages' | 'other'

/** The parts of a ledger entry that a person can change. */
export interface EntryData {
  kind: EntryKind
  /** Whole cents, so sums never pick up rounding errors. */
  amountCents: number
  method: PayMethod
  category?: ExpenseCategory
  note?: string
  /** The items in a sale, if the seller picked any. A quick sale has none. */
  lines?: EntryLine[]
  /** A "deleted" entry is only marked cancelled. It is never erased. */
  cancelled: boolean
}

/** One item inside a sale. Name, unit and price are copied in, so later changes to the item do not rewrite the past. */
export interface EntryLine {
  id: string
  itemId: string
  name: string
  unit: string
  /** Can be a fraction for loose items, e.g. 0.5 kg. */
  qty: number
  unitPriceCents?: number
  totalCents: number
}

/** Something the shop sells. */
export interface Item {
  id: string
  businessId: string
  name: string
  /** A unit id from units.ts ("kg", "pcs"…) or the owner's own word. */
  unit: string
  priceCents?: number
  /** Warn when stock drops to this level. */
  lowAt?: number
  /** False for things that are not counted, like a haircut. */
  tracked: boolean
  /** Stock left. Always equals the sum of this item's StockMove rows. */
  qty: number
  archived?: boolean
  createdAt: number
  updatedAt: number
}

/** Buying price, kept apart from Item so it never has to be sent to a worker's phone. */
export interface ItemCost {
  /** Same as the item's id. */
  id: string
  businessId: string
  costCents: number
  updatedAt: number
}

/** The buying price at the moment of a sale, kept apart from the sale for the same reason. */
export interface LineCost {
  /** Same as the sale line's id. */
  id: string
  entryId: string
  businessId: string
  itemId: string
  unitCostCents: number
}

export type MoveReason = 'opening' | 'sale' | 'sale_edit' | 'sale_cancel' | 'restock' | 'count' | 'damage'

/** Every change in stock, in or out, so the number left can always be explained. Never changed afterwards. */
export interface StockMove {
  id: string
  itemId: string
  businessId: string
  /** Positive adds stock, negative removes it. */
  qty: number
  reason: MoveReason
  entryId?: string
  byPersonId: string
  at: number
}

/** One transaction, as it stands now. Its full past is in EntryVersion. */
export interface Entry extends EntryData {
  id: string
  businessId: string
  /** Who owes or paid, for credit and payment entries. Fixed once recorded. */
  customerId?: string
  createdBy: string
  /** Times are taken from the phone's clock at the moment of the action. */
  createdAt: number
  occurredAt: number
  updatedAt: number
  /** How many versions exist. More than 1 means it was edited. */
  versions: number
  source: 'typed' | 'voice' | 'mpesa'
}

/** A snapshot saved every time an entry is created, edited or cancelled. Never changed afterwards. */
export interface EntryVersion extends EntryData {
  id: string
  entryId: string
  businessId: string
  version: number
  changedBy: string
  changedAt: number
}

/** A quiet note for the owner about an edit worth a second look. */
export interface Alert {
  id: string
  businessId: string
  entryId: string
  /** For over_limit: fromCents is the limit and toCents is what the customer now owes. */
  kind: 'amount_lowered' | 'late_delete' | 'over_limit'
  byPersonId: string
  at: number
  fromCents?: number
  toCents?: number
  seenAt?: number
}

/** Someone who buys on credit. */
export interface Customer {
  id: string
  businessId: string
  name: string
  phone?: string
  /** Going above this only shows a warning. Credit is never blocked. */
  limitCents?: number
  /** What they owe now. Always equals their credit entries minus their payments. */
  balanceCents: number
  createdAt: number
  updatedAt: number
}

/** A word the shop taught the voice feature: "omo" means this item, "mama njeri" means this customer. */
export interface VoiceAlias {
  id: string
  businessId: string
  /** The words as spoken, lower case. */
  phrase: string
  target: 'item' | 'customer' | 'category'
  /** The item id, the customer id, or the expense category. */
  targetId: string
  updatedAt: number
}

/** One count of the till, compared with what the ledger said should be there. Never changed afterwards. */
export interface CashCount {
  id: string
  businessId: string
  /** Start of the day that was counted. */
  day: number
  /** Cash in the till at the start of the day. */
  openingCents: number
  /** What the ledger says should be there: opening + cash in - cash out. */
  expectedCents: number
  countedCents: number
  /** Counted minus expected. Negative means cash is short. */
  gapCents: number
  note?: string
  byPersonId: string
  at: number
}

/** Every saved record also carries a flag: 1 means "changed on this phone and not yet backed up". */
export type Synced<T> = T & { dirty?: number }

export const db = new Dexie('chapa-kazi') as Dexie & {
  customers: EntityTable<Synced<Customer>, 'id'>
  people: EntityTable<Synced<Person>, 'id'>
  businesses: EntityTable<Synced<Business>, 'id'>
  memberships: EntityTable<Synced<Membership>, 'id'>
  entries: EntityTable<Synced<Entry>, 'id'>
  entryVersions: EntityTable<Synced<EntryVersion>, 'id'>
  alerts: EntityTable<Synced<Alert>, 'id'>
  items: EntityTable<Synced<Item>, 'id'>
  itemCosts: EntityTable<Synced<ItemCost>, 'id'>
  lineCosts: EntityTable<Synced<LineCost>, 'id'>
  stockMoves: EntityTable<Synced<StockMove>, 'id'>
  voiceAliases: EntityTable<Synced<VoiceAlias>, 'id'>
  cashCounts: EntityTable<Synced<CashCount>, 'id'>
}

db.version(1).stores({
  people: 'id',
  businesses: 'id, ownerId',
  memberships: 'id, personId, businessId',
})

db.version(2).stores({
  entries: 'id, businessId, occurredAt',
  entryVersions: 'id, entryId',
  alerts: 'id, businessId, entryId',
})

db.version(3).stores({
  items: 'id, businessId',
  itemCosts: 'id, businessId',
  lineCosts: 'id, entryId',
  stockMoves: 'id, itemId, businessId, entryId',
})

db.version(4).stores({
  customers: 'id, businessId',
  entries: 'id, businessId, occurredAt, customerId',
})

/** A unique id that can be created offline on any phone without clashing. */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Letters and digits that are hard to confuse when read aloud or copied (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('')
}

// Version 5 adds the "not yet backed up" flag to every table, and marks everything already
// on the phone as needing backup.
db.version(5)
  .stores({
    people: 'id, dirty',
    businesses: 'id, ownerId, dirty',
    memberships: 'id, personId, businessId, dirty',
    entries: 'id, businessId, occurredAt, customerId, dirty',
    entryVersions: 'id, entryId, dirty',
    alerts: 'id, businessId, entryId, dirty',
    items: 'id, businessId, dirty',
    itemCosts: 'id, businessId, dirty',
    lineCosts: 'id, entryId, dirty',
    stockMoves: 'id, itemId, businessId, entryId, dirty',
    customers: 'id, businessId, dirty',
  })
  .upgrade(async (tx) => {
    for (const table of tx.storeNames) {
      await tx.table(table).toCollection().modify({ dirty: 1 })
    }
  })

db.version(6).stores({
  voiceAliases: 'id, businessId, dirty',
})

db.version(7).stores({
  cashCounts: 'id, businessId, dirty',
})

/** A database transaction that is applying records from the server, not a change made on this phone. */
type MaybeRemote = { fromServer?: boolean }

const changeListeners = new Set<() => void>()

/** Lets the sync engine hear about every change made on this phone. */
export function onLocalChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

// Every record saved or changed on this phone is flagged for backup automatically, so no screen
// has to remember to do it. Records arriving from the server are not flagged (see runAsServer).
for (const table of db.tables) {
  table.hook('creating', (_key, record: { dirty?: number }, tx) => {
    if ((tx as MaybeRemote).fromServer) return
    record.dirty = 1
    changeListeners.forEach((notify) => notify())
  })
  table.hook('updating', (_changes, _key, _record, tx) => {
    if ((tx as MaybeRemote).fromServer) return undefined
    changeListeners.forEach((notify) => notify())
    return { dirty: 1 }
  })
}

/** Runs database work that comes from the server, so it is not flagged for backup again. */
export function runAsServer<T>(work: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.tables, (tx) => {
    ;(tx as MaybeRemote).fromServer = true
    return work()
  })
}
