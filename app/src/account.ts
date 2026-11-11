import { db } from './db'
import type { WordKey } from './i18n'
import { supabase } from './supabase'
import { countPending, setDevicePerson, syncNow } from './sync'

// Accounts. An owner signs in with email and password. A worker has no email: their own phone
// is linked to the shop with the invite code the owner gave them.

export type AccountError = Extract<WordKey, `err.${string}`>

/** Thrown with the name of a message the screen can show. */
export class AccountFailure extends Error {
  readonly key: AccountError
  constructor(key: AccountError) {
    super(key)
    this.key = key
  }
}

const known: Record<string, AccountError> = {
  email_taken: 'err.email_taken',
  bad_email: 'err.bad_email',
  bad_password: 'err.bad_password',
  bad_code: 'err.bad_code',
}

/** Logins are created by the server function "ck-auth", so they are always marked as Chapa Kazi logins. */
async function callAuthFunction(body: Record<string, string>): Promise<Record<string, unknown>> {
  const url: string = import.meta.env.VITE_SUPABASE_URL
  const key: string = import.meta.env.VITE_SUPABASE_KEY
  let response: Response
  try {
    response = await fetch(`${url}/functions/v1/ck-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AccountFailure('err.network')
  }
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new AccountFailure(known[String(result.error)] ?? 'err.other')
  return result
}

async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new AccountFailure('err.other')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return
  throw new AccountFailure(error.status === 400 ? 'err.wrong_login' : 'err.network')
}

/** An owner who already has records on this phone creates an account to back them up. */
export async function createOwnerAccount(email: string, password: string, ownerPersonId: string): Promise<void> {
  await callAuthFunction({ action: 'signup', email, password })
  await signIn(email.trim().toLowerCase(), password)
  setDevicePerson(ownerPersonId)
  await syncNow()
}

/**
 * An owner signs in on a phone that has no records yet, and their shops are fetched.
 * Returns false if the account exists but has no shop yet.
 */
export async function signInOwner(email: string, password: string): Promise<boolean> {
  await signIn(email.trim().toLowerCase(), password)
  await syncNow()
  const { data } = (await supabase?.rpc('ck_my_person_ids')) ?? { data: null }
  const personId = Array.isArray(data) && typeof data[0] === 'string' ? data[0] : null
  setDevicePerson(personId)
  return personId !== null
}

/**
 * Signs this phone out of its account and returns it to the first page, as if freshly installed.
 * Everything on the phone is a copy of what is backed up, so it is cleared, but only after every
 * waiting record has been sent. If some cannot be sent (offline, say) nothing is changed and
 * 'err.signOutUnsent' is thrown, so no record is ever lost.
 */
export async function signOutAccount(): Promise<void> {
  if (!supabase) return
  await syncNow()
  if ((await countPending()) > 0) throw new AccountFailure('err.signOutUnsent')

  await supabase.auth.signOut()
  await wipePhone(false)
  // A fresh start of the app, so nothing from the last account stays in memory.
  window.location.assign('/')
}

/** Empties this phone of records and of its own notes, keeping the chosen language (and the login if asked). */
async function wipePhone(keepLogin: boolean): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()))
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ck.') && key !== 'ck.lang' && !(keepLogin && key === 'ck.auth')) localStorage.removeItem(key)
    }
    sessionStorage.clear()
  } catch {
    // Storage blocked: nothing more to clear.
  }
}

/**
 * Someone who already has an account signs in on a phone that holds other records. Those records
 * are replaced by the account's own. Nothing is touched if the email or password is wrong.
 */
export async function signInReplacingPhone(email: string, password: string): Promise<void> {
  await signIn(email.trim().toLowerCase(), password)
  await wipePhone(true)
  await signInOwner(email, password)
  window.location.assign('/')
}

/** A worker links their own phone to the shop with the owner's invite code. */
export async function joinWithCode(code: string): Promise<void> {
  // The phone invents the password; the worker never needs to know it.
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const password = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const result = await callAuthFunction({ action: 'join', code: code.trim().toUpperCase(), password })
  await signIn(String(result.email), password)
  setDevicePerson(String(result.personId))
  await syncNow()
}
