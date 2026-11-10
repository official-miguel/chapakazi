import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { db } from './db'
import type { Business, Membership, Person, Role } from './db'

// Who is using the app right now, which business they are looking at, and in which role.

export type Directory = { people: Person[]; businesses: Business[]; memberships: Membership[] }

/** One thing a person is allowed to look at: a business (or all of them) in a role. */
export type View = { businessId: string | 'all'; role: Role }

/** `view` is empty right after signing in; the last view used (or the first allowed) is then picked. */
type Session = { personId: string; view?: View }

const SESSION_KEY = 'ck.session'
const lastViewKey = (personId: string) => `ck.lastView.${personId}`

/**
 * Everything this person may open.
 * - An owner (admin) of a shop can also step into the worker view of that shop.
 * - A worker sees only the shop they were added to.
 * - An owner of two or more shops also gets a combined "all businesses" view.
 */
export function viewsFor(personId: string, dir: Directory): View[] {
  const mine = dir.memberships.filter((m) => m.personId === personId && !m.removedAt)
  const adminOf = new Set(mine.filter((m) => m.role === 'admin').map((m) => m.businessId))
  const workerOf = new Set(mine.filter((m) => m.role === 'worker').map((m) => m.businessId))
  const views: View[] = []
  for (const b of dir.businesses) {
    if (adminOf.has(b.id)) {
      views.push({ businessId: b.id, role: 'admin' }, { businessId: b.id, role: 'worker' })
    } else if (workerOf.has(b.id)) {
      views.push({ businessId: b.id, role: 'worker' })
    }
  }
  if (adminOf.size > 1) views.push({ businessId: 'all', role: 'admin' })
  return views
}

const sameView = (a: View, b: View) => a.businessId === b.businessId && a.role === b.role

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(storage: Storage, key: string, value: unknown) {
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked; the session then lasts only until the page reloads.
  }
}

type SessionApi = {
  dir: Directory
  /** Null when nobody is signed in (the lock screen shows). */
  person: Person | null
  view: View | null
  /** The business being viewed, or null in the combined "all businesses" view. */
  business: Business | null
  views: View[]
  isAdmin: boolean
  /** The businesses whose data the current view shows: one shop, or all the owner's shops. */
  shops: Business[]
  /** True if the signed-in person owns this business, whatever view they are in. */
  ownsShop: (businessId: string) => boolean
  login: (personId: string) => void
  switchTo: (view: View) => void
  lock: () => void
}

const SessionContext = createContext<SessionApi | null>(null)

export function SessionProvider({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const dir = useLiveQuery<Directory>(async () => ({
    people: await db.people.toArray(),
    businesses: (await db.businesses.toArray()).sort((a, b) => a.createdAt - b.createdAt),
    memberships: await db.memberships.toArray(),
  }))

  // Kept in sessionStorage: closing the app locks it, so the next person must enter their PIN.
  const [session, setSession] = useState<Session | null>(() => readJson<Session>(sessionStorage, SESSION_KEY))

  const save = useCallback((next: Session | null) => {
    setSession(next)
    writeJson(sessionStorage, SESSION_KEY, next)
    if (next?.view) writeJson(localStorage, lastViewKey(next.personId), next.view)
  }, [])

  const api = useMemo<SessionApi | null>(() => {
    if (!dir) return null

    const person = session ? (dir.people.find((p) => p.id === session.personId) ?? null) : null
    const views = person ? viewsFor(person.id, dir) : []
    // Use the view they were on; if that is gone (or they just signed in), the one they
    // used last time; otherwise the first one they are allowed. No allowed views means locked out.
    const wanted = session && person ? (session.view ?? readJson<View>(localStorage, lastViewKey(person.id))) : null
    const view: View | null = (wanted && views.find((v) => sameView(v, wanted))) || views[0] || null

    const owned = new Set(views.filter((v) => v.role === 'admin' && v.businessId !== 'all').map((v) => v.businessId))
    const shops = !view
      ? []
      : dir.businesses.filter((b) => (view.businessId === 'all' ? owned.has(b.id) : b.id === view.businessId))

    return {
      dir,
      person: view ? person : null,
      view,
      business: view ? (dir.businesses.find((b) => b.id === view.businessId) ?? null) : null,
      views,
      isAdmin: view?.role === 'admin',
      shops,
      ownsShop: (businessId) => owned.has(businessId),
      login: (personId) => save({ personId }),
      switchTo: (next) => {
        if (person && views.some((v) => sameView(v, next))) save({ personId: person.id, view: next })
      },
      lock: () => save(null),
    }
  }, [dir, session, save])

  if (!api) return <>{loading}</>
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
