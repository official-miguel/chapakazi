import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useSyncState } from './sync'

// The platform admin: the person who runs Chapa Kazi (not a shop owner). They can see which
// shops and people use the app and how active they are. By design this shows activity only:
// no money amounts, no customer names. The server decides who is an admin and what they get.

export type ShopRow = {
  id: string
  name: string | null
  type: string | null
  owner_name: string | null
  owner_email: string | null
  workers: number
  items: number
  customers: number
  entries: number
  actions_7d: number
  last_at: string | null
  first_synced_at: string
}

export type PersonRow = {
  id: string
  name: string | null
  role: 'admin' | 'worker'
  shop: string | null
  removed: boolean
  has_login: boolean
  email: string | null
  last_sign_in_at: string | null
  actions_7d: number
  last_at: string | null
}

export type Overview = {
  generated_at: string
  totals: {
    shops: number
    shops_active_7d: number
    shops_new_7d: number
    people: number
    people_active_7d: number
    logins: number
    entries: number
    actions_24h: number
    actions_7d: number
  }
  shops: ShopRow[]
  people: PersonRow[]
  gemini: { set: boolean; hint?: string; updated_at?: string }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Active = recorded, edited or deleted an entry that reached the server in the last 7 days. */
export const isActive = (lastAt: string | null) => lastAt !== null && Date.now() - Date.parse(lastAt) < WEEK_MS

export async function loadOverview(): Promise<Overview> {
  if (!supabase) throw new Error('No server')
  const { data, error } = await supabase.rpc('ck_admin_overview')
  if (error) throw error
  return data as Overview
}

/** Saves the Gemini API key on the server. It is stored encrypted and can never be read back here. */
export async function saveGeminiKey(key: string): Promise<void> {
  if (!supabase) throw new Error('No server')
  const { error } = await supabase.rpc('ck_admin_set_gemini_key', { p_key: key })
  if (error) throw error
}

export type MpesaRequest = {
  business_id: string
  shop: string | null
  owner_email: string | null
  kind: 'till' | 'paybill'
  shortcode: string
  name: string | null
  status: 'requested' | 'in_progress' | 'active' | 'rejected'
  admin_note: string | null
  changed_at: string
}

/** Every shop's request for an M-Pesa connection, waiting ones first. */
export async function loadMpesaRequests(): Promise<MpesaRequest[]> {
  if (!supabase) throw new Error('No server')
  const { data, error } = await supabase.rpc('ck_admin_mpesa_requests')
  if (error) throw error
  return data as MpesaRequest[]
}

/** Moves a request along. The note is shown to the shop owner. */
export async function setMpesaStatus(businessId: string, status: MpesaRequest['status'], note: string): Promise<void> {
  if (!supabase) throw new Error('No server')
  const { error } = await supabase.rpc('ck_admin_set_mpesa_status', { p_business: businessId, p_status: status, p_note: note })
  if (error) throw error
}

/** Sends a pretend payment into a shop's inbox, clearly marked as a test. */
export async function sendTestPayment(businessId: string, amountCents: number): Promise<void> {
  if (!supabase) throw new Error('No server')
  const { error } = await supabase.rpc('ck_admin_send_test_payment', { p_business: businessId, p_amount_cents: amountCents, p_payer: '' })
  if (error) throw error
}

/** The two addresses to give Safaricom. They contain a secret, so treat them like a password. */
export async function loadCallbackAddresses(): Promise<{ confirm: string; validate: string }> {
  if (!supabase) throw new Error('No server')
  const { data, error } = await supabase.rpc('ck_admin_mpesa_callback_token')
  if (error) throw error
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ck-mpesa`
  return { confirm: `${base}/confirm/${data}`, validate: `${base}/validate/${data}` }
}

export type DarajaEnv = 'sandbox' | 'production'
export type DarajaStatus = { set: boolean; env?: DarajaEnv; hint?: string; updated_at?: string }

/** Whether Daraja keys are saved, for which environment, and the key's last four characters. */
export async function loadDarajaStatus(): Promise<DarajaStatus> {
  if (!supabase) throw new Error('No server')
  const { data, error } = await supabase.rpc('ck_admin_daraja_status')
  if (error) throw error
  return data as DarajaStatus
}

/** Saves the Daraja keys on the server. They are stored encrypted and can never be read back here. */
export async function saveDarajaKeys(env: DarajaEnv, key: string, secret: string): Promise<void> {
  if (!supabase) throw new Error('No server')
  const { error } = await supabase.rpc('ck_admin_set_daraja_keys', { p_env: env, p_key: key, p_secret: secret })
  if (error) throw error
}

/** True if the signed-in login is a platform admin. Asked from the server once per sign-in. */
export function usePlatformAdmin(): boolean {
  const { signedIn, email } = useSyncState()
  const [admin, setAdmin] = useState(false)

  useEffect(() => {
    let current = true
    if (!supabase || !signedIn) {
      setAdmin(false)
      return
    }
    supabase.rpc('ck_is_platform_admin').then(({ data }) => {
      if (current) setAdmin(data === true)
    })
    return () => {
      current = false
    }
  }, [signedIn, email])

  return admin
}
