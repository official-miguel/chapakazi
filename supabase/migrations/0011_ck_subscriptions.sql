-- CHAPA KAZI (Chapa Biz): paid plans, owners' subscriptions and M-Pesa STK Push payments.
--
-- How the money works:
--   price = base (first shop) + (shops - 1) x add-on, for one day, week or month.
--   Prices live in ck_sub_prices and only the super admin can change them.
--   The server always works out the price itself. A price sent by a phone is never used.
--
-- Rules the owner of Chapa Biz chose (2026-11-16):
--   * Every owner gets a 14-day free trial the first time their app asks for their plan.
--   * Paying while time is left adds the new time on top of the current end date.
--   * Adding shops while time is left: pay only the add-on for the days left; starts at once.
--   * Fewer shops: the lower number starts when the time already paid for runs out. No refunds.
--   * When time runs out the app locks for the owner and their workers until they pay.
--   * The super admin can switch "must pay" off for any owner: that owner (and their workers)
--     then uses Chapa Biz free, is never locked and is never asked to pay.
--
-- Safety:
--   * Phones can only READ their own subscription and payments. All changes go through the
--     functions below. The ck_internal_* ones are for server functions only (service role).
--   * Safaricom may send the same result more than once. A payment is credited exactly once:
--     its row is locked while it is handled, and a finished payment is never handled again.
--     The M-Pesa receipt number is also unique across all payments.

-- ---------------------------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------------------------
create table public.ck_sub_prices (
  period     text primary key check (period in ('daily', 'weekly', 'monthly')),
  days       int  not null check (days between 1 and 366),
  base_kes   int  not null check (base_kes between 1 and 1000000),
  addon_kes  int  not null check (addon_kes between 0 and 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
comment on table public.ck_sub_prices is
  'CHAPA KAZI app (not part of the trillionaire company app). Chapa Biz plan prices in KES: base for the first shop and the add-on for each extra shop.';

insert into public.ck_sub_prices (period, days, base_kes, addon_kes) values
  ('daily',   1,   49,  29),
  ('weekly',  7,  299, 179),
  ('monthly', 30, 1199, 699);

alter table public.ck_sub_prices enable row level security;
revoke all on public.ck_sub_prices from anon, authenticated;
grant select on public.ck_sub_prices to anon, authenticated;
create policy ck_sub_prices_read on public.ck_sub_prices for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Subscriptions: one per owner login, covering all of that owner's shops.
-- ---------------------------------------------------------------------------------------------
create table public.ck_subscriptions (
  owner_uid       uuid primary key references auth.users (id),
  shops           int  not null default 1 check (shops between 1 and 1000),
  -- A lower shop count waiting for the time already paid for to run out.
  shops_after     int  check (shops_after between 1 and 1000),
  shops_change_at timestamptz,
  -- The period last paid for. Its add-on sets the per-day price of adding a shop mid-way.
  period          text references public.ck_sub_prices (period),
  in_trial        boolean not null default true,
  -- Switched on by the super admin: this owner never pays and is never locked.
  exempt          boolean not null default false,
  exempt_by       uuid references auth.users (id),
  exempt_at       timestamptz,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((shops_after is null) = (shops_change_at is null))
);
comment on table public.ck_subscriptions is
  'CHAPA KAZI app (not part of the trillionaire company app). Each owner''s Chapa Biz plan: how many shops and until when.';

alter table public.ck_subscriptions enable row level security;
revoke all on public.ck_subscriptions from anon, authenticated;
grant select on public.ck_subscriptions to authenticated;
create policy ck_subscriptions_read on public.ck_subscriptions for select to authenticated
  using (owner_uid = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------------------------
create table public.ck_sub_payments (
  id                  uuid primary key default gen_random_uuid(),
  owner_uid           uuid not null references auth.users (id),
  -- 'renew' buys a period (and maybe extra shops now); 'add_shops' only adds shops now.
  kind                text not null check (kind in ('renew', 'add_shops')),
  period              text references public.ck_sub_prices (period),
  shops               int  not null check (shops between 1 and 1000),
  amount_kes          int  not null check (amount_kes >= 1),
  -- What the amount is made of, kept so the super admin can see how it was worked out.
  breakdown           jsonb not null default '{}'::jsonb,
  phone               text not null check (phone ~ '^2547\d{8}$|^2541\d{8}$'),
  method              text not null default 'mpesa_stk' check (method in ('mpesa_stk')),
  environment         text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  -- starting: row made, STK not yet accepted by Safaricom. pending: waiting for the PIN.
  status              text not null default 'starting'
                      check (status in ('starting', 'pending', 'success', 'failed', 'cancelled', 'timeout', 'underpaid')),
  checkout_request_id text unique,
  merchant_request_id text,
  mpesa_receipt       text unique,
  paid_amount_kes     int,
  result_code         int,
  result_desc         text,
  raw_callback        jsonb,
  expires_before      timestamptz,
  expires_after       timestamptz,
  credited_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (kind = 'add_shops' or period is not null)
);
comment on table public.ck_sub_payments is
  'CHAPA KAZI app (not part of the trillionaire company app). Payments for Chapa Biz plans (M-Pesa STK Push), with Safaricom''s raw result.';

create index ck_sub_payments_owner_idx on public.ck_sub_payments (owner_uid, created_at desc);
create index ck_sub_payments_created_idx on public.ck_sub_payments (created_at desc);

alter table public.ck_sub_payments enable row level security;
revoke all on public.ck_sub_payments from anon, authenticated;
grant select (id, kind, period, shops, amount_kes, phone, status, mpesa_receipt, result_code,
              expires_after, created_at, updated_at)
  on public.ck_sub_payments to authenticated;
create policy ck_sub_payments_read on public.ck_sub_payments for select to authenticated
  using (owner_uid = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function public.ck_sub_plan_name(p_shops int) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_shops <= 1 then 'starter'
    when p_shops <= 3 then 'growth'
    when p_shops <= 5 then 'business'
    else 'enterprise' end
$$;

-- How many shops the owner has right now (at least 1, so a new owner can still pay).
create function public.ck_sub_owned_shops(p_owner uuid) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(1, count(*)::int) from public.ck_businesses b
  where b.owner_uid = p_owner and coalesce((b.data ->> 'deleted')::boolean, false) = false
$$;

-- The owner's subscription, made with a 14-day trial the first time, and with any lower
-- shop count applied once its date has come. Locks the row so callers can change it safely.
create function public.ck_sub_row(p_owner uuid) returns public.ck_subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v public.ck_subscriptions;
begin
  insert into public.ck_subscriptions (owner_uid, shops, in_trial, expires_at)
  values (p_owner, public.ck_sub_owned_shops(p_owner), true, now() + interval '14 days')
  on conflict (owner_uid) do nothing;

  select * into v from public.ck_subscriptions where owner_uid = p_owner for update;
  if v.shops_change_at is not null and v.shops_change_at <= now() then
    update public.ck_subscriptions
      set shops = v.shops_after, shops_after = null, shops_change_at = null, updated_at = now()
      where owner_uid = p_owner
      returning * into v;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The price, worked out on the server.
--   p_period: 'daily' | 'weekly' | 'monthly' to buy time, or null to only add shops now.
--   p_shops : how many shops to pay for. Never fewer than the shops the owner has.
-- Returns {ok, error?, kind, period, shops, plan, total, renewal, extra_now, saving_vs_daily, ...}
-- ---------------------------------------------------------------------------------------------
create function public.ck_sub_quote_for(p_owner uuid, p_period text, p_shops int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v        public.ck_subscriptions;
  v_price  public.ck_sub_prices;
  v_daily  public.ck_sub_prices;
  v_rate   public.ck_sub_prices;
  v_owned  int := public.ck_sub_owned_shops(p_owner);
  v_active boolean;
  v_now_shops int;
  v_renewal int := 0;
  v_extra numeric := 0;
  v_seg1_days numeric := 0;
  v_seg2_days numeric := 0;
  v_saving int := 0;
  v_new_end timestamptz;
begin
  if p_shops is null or p_shops < 1 or p_shops > 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_shops');
  end if;
  if p_shops < v_owned then
    return jsonb_build_object('ok', false, 'error', 'fewer_than_owned', 'owned', v_owned);
  end if;

  v := public.ck_sub_row(p_owner);
  v_active := v.expires_at > now();
  v_now_shops := v.shops;

  if p_period is not null then
    select * into v_price from public.ck_sub_prices where period = p_period;
    if not found then return jsonb_build_object('ok', false, 'error', 'bad_period'); end if;
    v_renewal := v_price.base_kes + (p_shops - 1) * v_price.addon_kes;

    select * into v_daily from public.ck_sub_prices where period = 'daily';
    if found and p_period <> 'daily' then
      v_saving := greatest(0,
        (v_daily.base_kes + (p_shops - 1) * v_daily.addon_kes) * v_price.days - v_renewal);
    end if;
  end if;

  -- More shops while PAID time is left: pay the add-on, per day, for the days left.
  -- The trial covers any number of shops, so nothing extra is due during it.
  if v_active and not v.in_trial and p_shops > v_now_shops then
    select * into v_rate from public.ck_sub_prices where period = coalesce(v.period, 'monthly');
    if v.shops_change_at is not null then
      -- Time is split: until the change at the current count, after it at the lower count.
      v_seg1_days := extract(epoch from (least(v.shops_change_at, v.expires_at) - now())) / 86400;
      v_seg2_days := greatest(0, extract(epoch from (v.expires_at - v.shops_change_at)) / 86400);
      v_extra := (p_shops - v_now_shops) * v_seg1_days * v_rate.addon_kes / v_rate.days
               + greatest(0, p_shops - v.shops_after) * v_seg2_days * v_rate.addon_kes / v_rate.days;
    else
      v_seg1_days := extract(epoch from (v.expires_at - now())) / 86400;
      v_extra := (p_shops - v_now_shops) * v_seg1_days * v_rate.addon_kes / v_rate.days;
    end if;
  end if;

  if p_period is null and ceil(v_extra) < 1 then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_add');
  end if;

  v_new_end := case when p_period is null then v.expires_at
                    else greatest(now(), v.expires_at) + make_interval(days => v_price.days) end;

  return jsonb_build_object(
    'ok', true,
    'kind', case when p_period is null then 'add_shops' else 'renew' end,
    'period', p_period,
    'days', v_price.days,
    'shops', p_shops,
    'plan', public.ck_sub_plan_name(p_shops),
    'renewal', v_renewal,
    'extra_now', ceil(v_extra)::int,
    'total', v_renewal + ceil(v_extra)::int,
    'saving_vs_daily', v_saving,
    'expires_at', v.expires_at,
    'new_expires_at', v_new_end);
end $$;

-- For the app: the caller's own quote.
create function public.ck_sub_quote(p_period text, p_shops int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  return public.ck_sub_quote_for(auth.uid(), p_period, p_shops);
end $$;

-- For the app: where the owner stands. Workers ask with their shop's id and get only
-- whether the shop is open, never the owner's payment details.
create function public.ck_sub_status(p_business uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.ck_subscriptions;
  v_owner uuid := auth.uid();
  v_last jsonb;
begin
  if v_owner is null then raise exception 'Not signed in' using errcode = '42501'; end if;

  if p_business is not null then
    if p_business not in (select public.ck_my_business_ids()) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    select b.owner_uid into v_owner from public.ck_businesses b where b.id = p_business;
    if v_owner is distinct from auth.uid() then
      v := public.ck_sub_row(v_owner);
      return jsonb_build_object('role', 'worker', 'active', v.exempt or v.expires_at > now(),
                                'exempt', v.exempt, 'expires_at', v.expires_at);
    end if;
  end if;

  v := public.ck_sub_row(v_owner);
  select to_jsonb(p) - 'raw_callback' - 'owner_uid' - 'breakdown' into v_last
    from public.ck_sub_payments p
    where p.owner_uid = v_owner and p.status = 'success'
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
    'last_payment', v_last);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Server-only: start and finish a payment.
-- ---------------------------------------------------------------------------------------------

-- Makes the payment row with the server's own price. Returns {ok, payment_id, amount, ...}.
create function public.ck_internal_sub_start(p_owner uuid, p_period text, p_shops int, p_phone text, p_env text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_quote jsonb;
  v_id uuid;
begin
  -- One payment at a time per owner: a fresh unfinished one blocks a second.
  if exists (select 1 from public.ck_sub_payments
             where owner_uid = p_owner and status in ('starting', 'pending')
               and created_at > now() - interval '2 minutes') then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;

  -- A free account is never charged, even if the app asks.
  if (public.ck_sub_row(p_owner)).exempt then
    return jsonb_build_object('ok', false, 'error', 'exempt');
  end if;

  v_quote := public.ck_sub_quote_for(p_owner, p_period, p_shops);
  if not (v_quote ->> 'ok')::boolean then return v_quote; end if;

  insert into public.ck_sub_payments (owner_uid, kind, period, shops, amount_kes, breakdown, phone, environment)
  values (p_owner, v_quote ->> 'kind', p_period, p_shops, (v_quote ->> 'total')::int, v_quote, p_phone, p_env)
  returning id into v_id;

  return v_quote || jsonb_build_object('payment_id', v_id);
end $$;

-- Safaricom accepted the request and is asking for the PIN (or refused it straight away).
create function public.ck_internal_sub_sent(p_payment uuid, p_checkout text, p_merchant text, p_ok boolean, p_desc text)
returns void
language sql security definer set search_path = '' as $$
  update public.ck_sub_payments
    set status = case when p_ok then 'pending' else 'failed' end,
        checkout_request_id = nullif(p_checkout, ''),
        merchant_request_id = nullif(p_merchant, ''),
        result_desc = case when p_ok then result_desc else p_desc end,
        updated_at = now()
    where id = p_payment and status = 'starting'
$$;

-- Safaricom's answer (from the callback, or from asking Safaricom when no callback came).
-- Safe to call many times: only the first call for a payment changes anything.
-- Returns the payment's status afterwards, or 'unknown' if no such payment.
create function public.ck_internal_sub_finish(
  p_checkout text, p_result_code int, p_result_desc text,
  p_receipt text, p_paid_kes int, p_raw jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  p public.ck_sub_payments;
  v public.ck_subscriptions;
  v_days int;
  v_status text;
  v_new_end timestamptz;
  v_now_shops int;
begin
  select * into p from public.ck_sub_payments where checkout_request_id = p_checkout for update;
  if not found then return 'unknown'; end if;
  if p.status not in ('starting', 'pending') then
    -- Already handled. If it was confirmed by asking Safaricom (no receipt), and the callback
    -- arrives later with the receipt, keep the receipt. Nothing is credited again.
    if p.status = 'success' and p.mpesa_receipt is null and coalesce(p_receipt, '') <> ''
       and p_result_code = 0
       and not exists (select 1 from public.ck_sub_payments where mpesa_receipt = p_receipt) then
      update public.ck_sub_payments
        set mpesa_receipt = p_receipt, paid_amount_kes = coalesce(p_paid_kes, paid_amount_kes),
            raw_callback = p_raw, updated_at = now()
        where id = p.id;
    end if;
    return p.status;
  end if;

  v_status := case
    when p_result_code = 0 and coalesce(p_paid_kes, 0) >= p.amount_kes then 'success'
    when p_result_code = 0 then 'underpaid'
    when p_result_code = 1032 then 'cancelled'
    when p_result_code in (1037, 1019) then 'timeout'
    else 'failed' end;

  -- A receipt we have already used means this is a repeat in disguise: never credit twice.
  if v_status = 'success' and exists (
      select 1 from public.ck_sub_payments where mpesa_receipt = p_receipt and id <> p.id) then
    v_status := 'failed';
    p_result_desc := 'Receipt already used: ' || coalesce(p_result_desc, '');
    p_receipt := null;
  end if;

  if v_status = 'success' then
    v := public.ck_sub_row(p.owner_uid); -- locks the subscription
    v_now_shops := v.shops;

    if p.kind = 'renew' then
      select days into v_days from public.ck_sub_prices where period = p.period;
      -- Use the days stored with the price at the time of payment if prices changed since.
      v_days := coalesce((p.breakdown ->> 'days')::int, v_days);
      v_new_end := greatest(now(), v.expires_at) + make_interval(days => v_days);

      if v.expires_at > now() and not v.in_trial then
        -- Time is left. More shops start now (the extra was paid); fewer wait for that time to end.
        if p.shops >= v_now_shops then
          update public.ck_subscriptions set shops = p.shops, shops_after = null, shops_change_at = null
            where owner_uid = p.owner_uid;
        else
          update public.ck_subscriptions set shops_after = p.shops, shops_change_at = v.expires_at
            where owner_uid = p.owner_uid;
        end if;
      else
        update public.ck_subscriptions set shops = p.shops, shops_after = null, shops_change_at = null
          where owner_uid = p.owner_uid;
      end if;

      update public.ck_subscriptions
        set expires_at = v_new_end, period = p.period, in_trial = false, updated_at = now()
        where owner_uid = p.owner_uid;
    else
      v_new_end := v.expires_at;
      update public.ck_subscriptions
        set shops = greatest(shops, p.shops),
            shops_after = case when shops_after is null then null else greatest(shops_after, p.shops) end,
            updated_at = now()
        where owner_uid = p.owner_uid;
    end if;
  end if;

  update public.ck_sub_payments
    set status = v_status,
        result_code = p_result_code,
        result_desc = p_result_desc,
        mpesa_receipt = case when v_status in ('success', 'underpaid') then nullif(p_receipt, '') end,
        paid_amount_kes = p_paid_kes,
        raw_callback = p_raw,
        expires_before = case when v_status = 'success' then v.expires_at end,
        expires_after = case when v_status = 'success' then v_new_end end,
        credited_at = case when v_status = 'success' then now() end,
        updated_at = now()
    where id = p.id;

  return v_status;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Super admin
-- ---------------------------------------------------------------------------------------------
create function public.ck_admin_set_price(p_period text, p_base int, p_addon int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.ck_sub_prices
    set base_kes = p_base, addon_kes = p_addon, updated_at = now(), updated_by = auth.uid()
    where period = p_period;
  if not found then raise exception 'Unknown period'; end if;
end $$;

create function public.ck_admin_sub_payments(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select p.id, p.created_at, p.kind, p.period, p.shops, p.amount_kes, p.paid_amount_kes,
             p.phone, p.status, p.mpesa_receipt, p.result_code, p.result_desc, p.environment,
             p.expires_after, p.raw_callback,
             (select string_agg(b.data ->> 'name', ', ') from public.ck_businesses b
               where b.owner_uid = p.owner_uid) as shop_names
      from public.ck_sub_payments p
      order by p.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;

-- Every shop owner's account, with their plan and whether they must pay.
create function public.ck_admin_sub_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  -- Make sure every owner has a plan row (new ones start their trial when first seen).
  for v_owner in select distinct b.owner_uid from public.ck_businesses b loop
    perform public.ck_sub_row(v_owner);
  end loop;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.exempt, x.expires_at) from (
      select s.owner_uid, u.email, s.exempt, s.in_trial, s.expires_at, s.shops, s.period,
             s.expires_at > now() as active,
             (select string_agg(b.data ->> 'name', ', ' order by b.synced_at) from public.ck_businesses b
               where b.owner_uid = s.owner_uid) as shop_names,
             (select count(*) from public.ck_businesses b where b.owner_uid = s.owner_uid) as shop_count,
             (select max(p.credited_at) from public.ck_sub_payments p
               where p.owner_uid = s.owner_uid and p.status = 'success') as last_paid_at
      from public.ck_subscriptions s
      join auth.users u on u.id = s.owner_uid
      where exists (select 1 from public.ck_businesses b where b.owner_uid = s.owner_uid)) x), '[]'::jsonb);
end $$;

-- "Must pay" on or off for one owner.
create function public.ck_admin_set_exempt(p_owner uuid, p_exempt boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.ck_businesses b where b.owner_uid = p_owner) then
    raise exception 'Not a shop owner';
  end if;
  perform public.ck_sub_row(p_owner);
  update public.ck_subscriptions
    set exempt = coalesce(p_exempt, false),
        exempt_by = case when p_exempt then auth.uid() end,
        exempt_at = case when p_exempt then now() end,
        updated_at = now()
    where owner_uid = p_owner;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------
revoke all on function
  public.ck_sub_owned_shops(uuid), public.ck_sub_row(uuid), public.ck_sub_quote_for(uuid, text, int),
  public.ck_internal_sub_start(uuid, text, int, text, text),
  public.ck_internal_sub_sent(uuid, text, text, boolean, text),
  public.ck_internal_sub_finish(text, int, text, text, int, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.ck_internal_sub_start(uuid, text, int, text, text),
  public.ck_internal_sub_sent(uuid, text, text, boolean, text),
  public.ck_internal_sub_finish(text, int, text, text, int, jsonb)
  to service_role;

revoke all on function public.ck_sub_quote(text, int), public.ck_sub_status(uuid),
  public.ck_admin_set_price(text, int, int), public.ck_admin_sub_payments(int),
  public.ck_admin_sub_accounts(), public.ck_admin_set_exempt(uuid, boolean) from public, anon;
grant execute on function public.ck_sub_quote(text, int), public.ck_sub_status(uuid),
  public.ck_admin_set_price(text, int, int), public.ck_admin_sub_payments(int),
  public.ck_admin_sub_accounts(), public.ck_admin_set_exempt(uuid, boolean) to authenticated;
