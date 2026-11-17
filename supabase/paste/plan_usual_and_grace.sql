-- Paste this whole file into the Supabase SQL editor and press Run (after chapa_biz_plans_and_payments.sql).
-- Same as supabase/migrations/0013_ck_sub_usual_and_grace.sql.

-- CHAPA KAZI (Chapa Biz): the plan an owner usually buys, and 5 minutes of use after a plan ends.
--
-- Rules the owner of Chapa Biz chose (2026-11-17):
--   * Every account is on a plan: the 14-day free trial (once per account, made by ck_sub_row the
--     first time the app asks) or a paid one. The app does not open until it knows which.
--   * The plan an owner buys most often is offered first. The others stay one tap away.
--   * When a plan has ended, the payment screen shows first. Below it, the person may choose to
--     use the app for 5 minutes, ONCE for each time the plan ends (that is, once per end date),
--     per login. Paying moves the end date, so the next time it ends there are 5 new minutes.
--
-- Builds on migration 0011. Safe to run more than once.

-- ---------------------------------------------------------------------------------------------
-- The 5 minutes: one row per login and end date. Written only by ck_sub_grace_start.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ck_sub_grace (
  uid        uuid        not null references auth.users (id) on delete cascade,
  -- The plan's end date these minutes were for.
  expires_at timestamptz not null,
  started_at timestamptz not null default now(),
  primary key (uid, expires_at)
);
comment on table public.ck_sub_grace is
  'CHAPA KAZI app (not part of the trillionaire company app). When a login used its 5 minutes after a Chapa Biz plan ended, once per end date.';

alter table public.ck_sub_grace enable row level security;
revoke all on public.ck_sub_grace from anon, authenticated;

-- The plan the caller's phone checks: their own (owner), or their shop owner's (worker).
-- Raises if the caller may not see that shop.
create or replace function public.ck_sub_owner_for(p_business uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_business is null then return auth.uid(); end if;
  if p_business not in (select public.ck_my_business_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select b.owner_uid into v_owner from public.ck_businesses b where b.id = p_business;
  return coalesce(v_owner, auth.uid());
end $$;

-- When the caller's 5 minutes for this end date end, or null if not started.
create or replace function public.ck_sub_grace_until(p_expires timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select g.started_at + interval '5 minutes' from public.ck_sub_grace g
  where g.uid = auth.uid() and g.expires_at = p_expires
$$;

-- For the app: start the 5 minutes (or look them up if already started for this end date).
-- Returns {ok, grace_until} or {ok: false, error: 'not_ended'} while time is still left.
create or replace function public.ck_sub_grace_start(p_business uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.ck_subscriptions;
begin
  v := public.ck_sub_row(public.ck_sub_owner_for(p_business));
  if v.exempt or v.expires_at > now() then
    return jsonb_build_object('ok', false, 'error', 'not_ended');
  end if;
  insert into public.ck_sub_grace (uid, expires_at) values (auth.uid(), v.expires_at)
  on conflict (uid, expires_at) do nothing;
  -- Older end dates are of no more use.
  delete from public.ck_sub_grace where uid = auth.uid() and expires_at < v.expires_at;
  return jsonb_build_object('ok', true, 'grace_until', public.ck_sub_grace_until(v.expires_at));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Where the plan stands, now also with the usual plan and the 5 minutes.
-- Same answer as migration 0011 otherwise.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ck_sub_status(p_business uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.ck_subscriptions;
  v_owner uuid := public.ck_sub_owner_for(p_business);
  v_last jsonb;
  v_usual text;
  v_usual_shops int;
begin
  if v_owner is distinct from auth.uid() then
    -- A worker: only whether the shop is open, never the owner's payment details.
    v := public.ck_sub_row(v_owner);
    return jsonb_build_object('role', 'worker', 'active', v.exempt or v.expires_at > now(),
                              'exempt', v.exempt, 'expires_at', v.expires_at,
                              'grace_until', public.ck_sub_grace_until(v.expires_at));
  end if;

  v := public.ck_sub_row(v_owner);
  select to_jsonb(p) - 'raw_callback' - 'owner_uid' - 'breakdown' into v_last
    from public.ck_sub_payments p
    where p.owner_uid = v_owner and p.status = 'success'
    order by p.credited_at desc limit 1;

  -- The period paid for most often; on a tie, the one paid for most recently.
  select p.period into v_usual
    from public.ck_sub_payments p
    where p.owner_uid = v_owner and p.status = 'success' and p.kind = 'renew'
    group by p.period
    order by count(*) desc, max(p.credited_at) desc
    limit 1;
  select p.shops into v_usual_shops
    from public.ck_sub_payments p
    where p.owner_uid = v_owner and p.status = 'success' and p.kind = 'renew'
    order by p.credited_at desc limit 1;

  return jsonb_build_object(
    'role', 'owner',
    'active', v.exempt or v.expires_at > now(),
    'exempt', v.exempt,
    'in_trial', v.in_trial,
    'expires_at', v.expires_at,
    'shops', v.shops,
    'plan', public.ck_sub_plan_name(v.shops),
    'shops_after', v.shops_after,
    'shops_change_at', v.shops_change_at,
    'period', v.period,
    'owned_shops', public.ck_sub_owned_shops(v_owner),
    'usual_period', v_usual,
    'usual_shops', v_usual_shops,
    'grace_until', public.ck_sub_grace_until(v.expires_at),
    'last_payment', v_last);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------
revoke all on function public.ck_sub_owner_for(uuid), public.ck_sub_grace_until(timestamptz)
  from public, anon, authenticated;
revoke all on function public.ck_sub_grace_start(uuid), public.ck_sub_status(uuid) from public, anon;
grant execute on function public.ck_sub_grace_start(uuid), public.ck_sub_status(uuid) to authenticated;
