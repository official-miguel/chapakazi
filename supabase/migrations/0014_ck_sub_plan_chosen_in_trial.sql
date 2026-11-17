-- CHAPA KAZI (Chapa Biz): choosing a plan during the free trial, without paying.
--
-- Rule the owner of Chapa Biz chose (2026-11-17): during the free trial an owner may choose the
-- plan they want (period and shops). Choosing costs nothing and the trial carries on. When the
-- trial ends, the payment screen offers that plan first, ready to pay.
--
-- Builds on migrations 0011 and 0013. Safe to run more than once.

alter table public.ck_subscriptions
  add column if not exists chosen_period text references public.ck_sub_prices (period),
  add column if not exists chosen_shops  int check (chosen_shops between 1 and 1000),
  add column if not exists chosen_at     timestamptz;

-- For the app: remember the plan the owner chose. Charges nothing.
-- Returns {ok} or {ok: false, error: 'bad_period' | 'bad_shops' | 'fewer_than_owned'}.
create or replace function public.ck_sub_choose(p_period text, p_shops int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_owned int;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.ck_sub_prices where period = p_period) then
    return jsonb_build_object('ok', false, 'error', 'bad_period');
  end if;
  if p_shops is null or p_shops < 1 or p_shops > 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_shops');
  end if;
  v_owned := public.ck_sub_owned_shops(auth.uid());
  if p_shops < v_owned then
    return jsonb_build_object('ok', false, 'error', 'fewer_than_owned', 'owned', v_owned);
  end if;
  perform public.ck_sub_row(auth.uid());
  update public.ck_subscriptions
    set chosen_period = p_period, chosen_shops = p_shops, chosen_at = now(), updated_at = now()
    where owner_uid = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Where the plan stands: as in migration 0013, now also with the plan chosen during the trial.
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
    'chosen_period', v.chosen_period,
    'chosen_shops', v.chosen_shops,
    'chosen_at', v.chosen_at,
    'grace_until', public.ck_sub_grace_until(v.expires_at),
    'last_payment', v_last);
end $$;

revoke all on function public.ck_sub_choose(text, int) from public, anon;
grant execute on function public.ck_sub_choose(text, int) to authenticated;
