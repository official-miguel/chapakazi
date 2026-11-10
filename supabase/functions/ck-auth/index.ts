// CHAPA KAZI: creates logins for shop owners and workers.
//
// Why a server function: the Supabase project is shared with another app, so Chapa Kazi must not
// depend on (or change) that app's sign-up settings. Every login made here is stamped with
// app_metadata.app = "chapa_kazi". Users cannot edit that stamp, and the other app's tables
// refuse any login that carries it.
//
// Two actions, both called before the person is signed in:
//   signup { email, password }  -> a shop owner's login
//   join   { code, password }   -> a worker's login, tied to the invite code their owner gave them
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Workers have no email. Their login uses a made-up address that never receives mail.
const WORKER_DOMAIN = 'workers.chapakazi.invalid'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'bad_request' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'bad_request' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const password = typeof body.password === 'string' ? body.password : ''

  if (body.action === 'signup') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply({ error: 'bad_email' }, 400)
    if (password.length < 8 || password.length > 72) return reply({ error: 'bad_password' }, 400)

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { app: 'chapa_kazi', ck_role: 'owner' },
    })
    if (error) {
      const taken = /already|registered|exists/i.test(error.message)
      return reply({ error: taken ? 'email_taken' : 'signup_failed' }, taken ? 409 : 400)
    }
    return reply({ ok: true })
  }

  if (body.action === 'join') {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    // The phone invents a long random password; the worker never sees or types it.
    if (!/^[A-Z2-9]{6}$/.test(code) || password.length < 24 || password.length > 72) {
      return reply({ error: 'bad_request' }, 400)
    }

    const { data: membership } = await admin
      .from('ck_memberships')
      .select('id, person_id, data')
      .eq('invite_code', code)
      .is('removed_at', null)
      .maybeSingle()
    if (!membership) {
      await pause(700) // slows down guessing
      return reply({ error: 'bad_code' }, 404)
    }

    const email = `worker-${crypto.randomUUID()}@${WORKER_DOMAIN}`
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { app: 'chapa_kazi', ck_role: 'worker' },
    })
    if (createError || !created.user) return reply({ error: 'join_failed' }, 500)

    // Tie the new login to the worker's record, replacing any login from a phone they used before.
    const { data: person } = await admin.from('ck_people').select('auth_uid').eq('id', membership.person_id).single()
    const { error: linkError } = await admin
      .from('ck_people')
      .update({ auth_uid: created.user.id })
      .eq('id', membership.person_id)
    if (linkError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return reply({ error: 'join_failed' }, 500)
    }

    // The code has done its job: clear it so it cannot be used again.
    const data = { ...(membership.data as Record<string, unknown>), updatedAt: Date.now() }
    delete data.inviteCode
    await admin
      .from('ck_memberships')
      .update({ invite_code: null, data, updated_at: data.updatedAt })
      .eq('id', membership.id)

    if (person?.auth_uid) {
      const { data: old } = await admin.auth.admin.getUserById(person.auth_uid)
      if (old.user?.email?.endsWith(`@${WORKER_DOMAIN}`)) await admin.auth.admin.deleteUser(person.auth_uid)
    }

    return reply({ ok: true, email, personId: membership.person_id })
  }

  return reply({ error: 'bad_request' }, 400)
})
