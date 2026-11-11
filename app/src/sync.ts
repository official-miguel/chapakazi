import type { Table } from 'dexie'
import { useSyncExternalStore } from 'react'
import { db, onLocalChange, runAsServer } from './db'
import { recomputeCustomers, recomputeEntries, recomputeItems } from './recompute'
import { supabase } from './supabase'

// Backup and sync.
//
// Sending ("push"): every record changed on this phone carries a flag. Flagged records are sent
// to the server and the flag is cleared.
// Receiving ("pull"): the phone asks each server table "what is new since I last asked?".
// When two phones changed the same record, the one with the later phone time wins, on the
// server and here. Histories (entry versions, stock moves) are only ever added to.

type Row = Record<string, unknown> & { id: string; dirty?: number }
type RemoteRow = { id: string; data: Record<string, unknown>; updated_at: number; synced_at: string }

type Spec = {
  local: Table<Row, string>
  remote: string
  /** History tables are only added to, never changed. */
  appendOnly: boolean
  /** Records the server creates and phones may only change (M-Pesa payments). */
  updateOnly?: boolean
  /** The phone time this record was last changed. */
  time: (row: Row) => number
  /** Extra server columns the access rules need. */
  columns: (row: Row) => Record<string, unknown>
}

const num = (value: unknown) => (typeof value === 'number' ? value : 0)
const shop = (row: Row) => ({ business_id: row.businessId })
const updatedAt = (row: Row) => num(row.updatedAt)
const table = (t: unknown) => t as Table<Row, string>

// The order matters: a shop must exist on the server before its records, and buying prices
// must arrive before sales so the server can note the cost of each sale.
const specs: Spec[] = [
  { local: table(db.people), remote: 'ck_people', appendOnly: false, time: updatedAt, columns: () => ({}) },
  { local: table(db.businesses), remote: 'ck_businesses', appendOnly: false, time: updatedAt, columns: () => ({}) },
  {
    local: table(db.memberships),
    remote: 'ck_memberships',
    appendOnly: false,
    time: updatedAt,
    columns: (r) => ({
      business_id: r.businessId,
      person_id: r.personId,
      role: r.role,
      removed_at: r.removedAt ?? null,
      invite_code: r.inviteCode ?? null,
    }),
  },
  { local: table(db.items), remote: 'ck_items', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.itemCosts), remote: 'ck_item_costs', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.customers), remote: 'ck_customers', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.voiceAliases), remote: 'ck_voice_aliases', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.suppliers), remote: 'ck_suppliers', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.mpesaLinks), remote: 'ck_mpesa_links', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.mpesaPayments), remote: 'ck_mpesa_payments', appendOnly: false, updateOnly: true, time: updatedAt, columns: shop },
  { local: table(db.supplierMoves), remote: 'ck_supplier_moves', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.entries), remote: 'ck_entries', appendOnly: false, time: updatedAt, columns: shop },
  { local: table(db.entryVersions), remote: 'ck_entry_versions', appendOnly: true, time: (r) => num(r.changedAt), columns: shop },
  { local: table(db.stockMoves), remote: 'ck_stock_moves', appendOnly: true, time: (r) => num(r.at), columns: shop },
  { local: table(db.cashCounts), remote: 'ck_cash_counts', appendOnly: true, time: (r) => num(r.at), columns: shop },
  { local: table(db.lineCosts), remote: 'ck_line_costs', appendOnly: true, time: () => 0, columns: shop },
  { local: table(db.alerts), remote: 'ck_alerts', appendOnly: true, time: (r) => num(r.seenAt) || num(r.at), columns: shop },
]

// Tables whose "what is new" position must restart when this phone gains access to another shop.
const SHOP_TABLES = specs.filter((s) => s.remote !== 'ck_people' && s.remote !== 'ck_businesses').map((s) => s.remote)

/** What is sent to the server: the record without phone-only fields. PINs never leave the phone. */
function toRemote(spec: Spec, row: Row) {
  const { dirty: _dirty, pinSalt: _salt, pinHash: _hash, ...data } = row
  return { id: row.id, data, updated_at: spec.time(row), ...spec.columns(row) }
}

function fromRemote(remote: RemoteRow, local: Row | undefined): Row {
  const row: Row = { ...remote.data, id: remote.id, dirty: 0 }
  if (local?.pinHash) {
    row.pinSalt = local.pinSalt
    row.pinHash = local.pinHash
  }
  return row
}

// ---- small saved settings -------------------------------------------------------------------

const DEVICE_PERSON_KEY = 'ck.devicePerson'
const cursorKey = (remote: string) => `ck.sync.cursor.${remote}`
const SHOPS_KEY = 'ck.sync.shops'
const claimedKey = (uid: string) => `ck.sync.claimed.${uid}`

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked: sync still works, it just re-reads more than it needs to next time.
  }
}

/** The person whose login this phone uses: the owner, or a worker who joined with a code. */
export const getDevicePerson = () => read(DEVICE_PERSON_KEY)
export const setDevicePerson = (personId: string | null) => {
  write(DEVICE_PERSON_KEY, personId)
  emit()
}

// ---- what the screens can show --------------------------------------------------------------

export type SyncState = {
  /** The signed-in email, or null if this phone has no account yet. */
  email: string | null
  signedIn: boolean
  busy: boolean
  failed: boolean
  lastOkAt: number | null
  devicePersonId: string | null
}

let state: SyncState = { email: null, signedIn: false, busy: false, failed: false, lastOkAt: null, devicePersonId: getDevicePerson() }
const listeners = new Set<() => void>()

function emit(change: Partial<SyncState> = {}) {
  state = { ...state, ...change, devicePersonId: getDevicePerson() }
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** How many records on this phone are not yet backed up. */
export async function countPending(): Promise<number> {
  const counts = await Promise.all(specs.map((s) => s.local.where('dirty').equals(1).count()))
  return counts.reduce((a, b) => a + b, 0)
}

// ---- sending --------------------------------------------------------------------------------

const PAGE = 200

async function applyRemote(spec: Spec, rows: RemoteRow[], touched: Touched): Promise<void> {
  if (rows.length === 0) return
  await runAsServer(async () => {
    for (const remote of rows) {
      const local = await spec.local.get(remote.id)
      // A newer change made on this phone and not yet sent is kept; it will be sent next.
      // History records never change, so one already here is left alone. (Alerts are the
      // exception: the owner marking one "seen" is a change that must reach their other phones.)
      const fixed = spec.appendOnly && spec.remote !== 'ck_alerts'
      const keepLocal = fixed ? local !== undefined : local?.dirty === 1 && spec.time(local) > remote.updated_at
      if (!keepLocal) await spec.local.put(fromRemote(remote, local))
      touched.note(spec.remote, (keepLocal ? local : remote.data) as Record<string, unknown>, remote.id)
    }
  })
}

async function pushTable(spec: Spec, touched: Touched): Promise<void> {
  if (!supabase) return
  for (let round = 0; round < 50; round++) {
    const rows = await spec.local.where('dirty').equals(1).limit(PAGE).toArray()
    if (rows.length === 0) return
    const payload = rows.map((r) => toRemote(spec, r))

    if (spec.updateOnly) {
      // Phones never add these records, so each change is sent as a plain "change this one".
      const lost: string[] = []
      for (const row of payload) {
        const { data, error } = await supabase
          .from(spec.remote)
          .update({ data: row.data, updated_at: row.updated_at })
          .eq('id', row.id)
          .select('id, updated_at')
        if (error) throw error
        if (data?.[0] && num(data[0].updated_at) > row.updated_at) lost.push(row.id)
      }
      // Another phone sorted the same payment later: take its version.
      if (lost.length) {
        const { data: winners } = await supabase.from(spec.remote).select('*').in('id', lost)
        await runAsServer(async () => {
          for (const id of lost) await spec.local.where('id').equals(id).modify({ dirty: 0 })
        })
        await applyRemote(spec, (winners ?? []) as RemoteRow[], touched)
      }
    } else if (spec.remote === 'ck_alerts') {
      // Workers' phones raise alerts but may not read them, so each one is sent as a plain
      // "add". If it is already on the server (code 23505) that is fine.
      for (const alert of payload) {
        const { error } = await supabase.from(spec.remote).insert(alert)
        if (error && error.code !== '23505') throw error
      }
      // "Seen" marks are an owner's change to an existing alert. A worker's phone is not allowed
      // to make this change, so a refusal here is expected and ignored.
      const seen = payload.filter((p) => (p.data as Row).seenAt)
      if (seen.length) await supabase.from(spec.remote).upsert(seen, { onConflict: 'id' })
    } else if (spec.appendOnly) {
      const { error } = await supabase.from(spec.remote).upsert(payload, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
    } else {
      const { data, error } = await supabase.from(spec.remote).upsert(payload, { onConflict: 'id' }).select('id, updated_at')
      if (error) throw error
      // If the server kept a later change from another phone, fetch it so this phone agrees.
      const sent = new Map(payload.map((p) => [p.id, p.updated_at]))
      const lost = (data ?? []).filter((d) => num(d.updated_at) > (sent.get(d.id as string) ?? 0)).map((d) => d.id as string)
      if (lost.length) {
        const { data: winners } = await supabase.from(spec.remote).select('*').in('id', lost)
        await runAsServer(async () => {
          for (const id of lost) await spec.local.where('id').equals(id).modify({ dirty: 0 })
        })
        await applyRemote(spec, (winners ?? []) as RemoteRow[], touched)
      }
    }

    // Clear the flag, unless the record changed again while it was being sent.
    await runAsServer(async () => {
      for (const sentRow of rows) {
        await spec.local
          .where('id')
          .equals(sentRow.id)
          .modify((current) => {
            if (spec.time(current) === spec.time(sentRow)) current.dirty = 0
          })
      }
    })
    if (rows.length < PAGE) return
  }
}

/** Links this phone's login to its owner's person record, once. */
async function claimDevicePerson(uid: string): Promise<void> {
  const personId = getDevicePerson()
  if (!supabase || !personId || read(claimedKey(uid))) return
  const { error } = await supabase.rpc('ck_claim_person', { p_person: personId })
  // "Already linked" is fine: a worker's login is linked by the server when they join.
  if (!error || /already linked/i.test(error.message)) write(claimedKey(uid), '1')
  else throw error
}

// ---- receiving ------------------------------------------------------------------------------

/** Remembers which totals must be worked out again after new records arrive. */
class Touched {
  entries = new Set<string>()
  items = new Set<string>()
  customers = new Set<string>()

  note(remote: string, data: Record<string, unknown>, id: string) {
    const add = (set: Set<string>, value: unknown) => {
      if (typeof value === 'string') set.add(value)
    }
    if (remote === 'ck_items') this.items.add(id)
    else if (remote === 'ck_customers') this.customers.add(id)
    else if (remote === 'ck_stock_moves') add(this.items, data.itemId)
    else if (remote === 'ck_entry_versions') add(this.entries, data.entryId)
    else if (remote === 'ck_entries') this.entries.add(id)
  }
}

async function pullTable(spec: Spec, touched: Touched): Promise<void> {
  if (!supabase) return
  const saved = read(cursorKey(spec.remote))
  // Re-read the last few seconds each time: a record saved by another phone at the same moment
  // could otherwise be missed. Reading a record twice does no harm.
  let afterTime = saved ? new Date(Date.parse(saved) - 10_000).toISOString() : null
  let afterId: string | null = null
  let newest = saved

  for (let page = 0; page < 500; page++) {
    let query = supabase.from(spec.remote).select('*').order('synced_at').order('id').limit(500)
    if (afterTime && afterId) query = query.or(`synced_at.gt."${afterTime}",and(synced_at.eq."${afterTime}",id.gt.${afterId})`)
    else if (afterTime) query = query.gte('synced_at', afterTime)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as RemoteRow[]
    await applyRemote(spec, rows, touched)
    if (rows.length === 0) break
    const last = rows[rows.length - 1]
    afterTime = last.synced_at
    afterId = last.id
    newest = last.synced_at
    if (rows.length < 500) break
  }
  write(cursorKey(spec.remote), newest)
}

/** If this phone can now see a shop it could not see before, read that shop's records from the start. */
async function restartIfShopsChanged(): Promise<void> {
  const signature = (await db.businesses.toCollection().primaryKeys()).sort().join(',')
  if (read(SHOPS_KEY) !== signature) {
    for (const remote of SHOP_TABLES) write(cursorKey(remote), null)
    write(SHOPS_KEY, signature)
  }
}

async function recomputeTouched(touched: Touched): Promise<void> {
  if (touched.entries.size + touched.items.size + touched.customers.size === 0) return
  await runAsServer(async () => {
    const noteEntry = async (id: string) => {
      const entry = await db.entries.get(id)
      if (entry?.customerId) touched.customers.add(entry.customerId)
      for (const line of entry?.lines ?? []) touched.items.add(line.itemId)
    }
    // Items and customers are affected by what an entry said before and what it says now.
    for (const id of touched.entries) await noteEntry(id)
    await recomputeEntries(touched.entries)
    for (const id of touched.entries) await noteEntry(id)
    await recomputeItems(touched.items)
    await recomputeCustomers(touched.customers)
  })
}

// ---- running --------------------------------------------------------------------------------

let running = false
let again = false

/** Sends this phone's changes, then fetches everyone else's. Safe to call at any time. */
export async function syncNow(): Promise<void> {
  if (!supabase) return
  if (running) {
    again = true
    return
  }
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  emit({ signedIn: !!user, email: user?.email ?? null })
  if (!user || !navigator.onLine) return

  running = true
  emit({ busy: true })
  let failed = false
  const touched = new Touched()
  try {
    for (const spec of specs) {
      // One table failing (say, a record this login may not change) must not block the rest.
      try {
        await pushTable(spec, touched)
        if (spec.remote === 'ck_people') await claimDevicePerson(user.id)
      } catch (error) {
        failed = true
        console.warn(`[sync] sending ${spec.remote} failed`, error)
      }
    }
    for (const spec of specs) {
      try {
        await pullTable(spec, touched)
        if (spec.remote === 'ck_memberships') await restartIfShopsChanged()
      } catch (error) {
        failed = true
        console.warn(`[sync] receiving ${spec.remote} failed`, error)
      }
    }
    await recomputeTouched(touched)
  } catch (error) {
    failed = true
    console.warn('[sync] failed', error)
  } finally {
    running = false
    emit({ busy: false, failed, lastOkAt: failed ? state.lastOkAt : Date.now() })
    if (again) {
      again = false
      void syncNow()
    }
  }
}

let started = false

/** Keeps the phone in sync: after every change, when the internet returns, and once a minute. */
export function startSync(): void {
  if (started || !supabase) return
  started = true
  let timer: number | undefined
  const soon = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void syncNow(), 2500)
  }
  onLocalChange(soon)
  window.addEventListener('online', () => void syncNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, 60_000)
  supabase.auth.onAuthStateChange((_event, session) => {
    emit({ signedIn: !!session, email: session?.user.email ?? null })
  })
  void syncNow()
}
