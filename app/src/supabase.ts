import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL
const key: string | undefined = import.meta.env.VITE_SUPABASE_KEY

/**
 * The connection to the server. Null if the app was built without server details,
 * in which case everything still works on the phone and the backup options are hidden.
 */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { storageKey: 'ck.auth', persistSession: true, autoRefreshToken: true } }) : null

export const backupAvailable = supabase !== null
