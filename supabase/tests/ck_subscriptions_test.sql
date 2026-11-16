-- CHAPA KAZI: checks for plan pricing and payment callbacks (migration 0011).
-- Run as one block in the SQL editor. Everything is rolled back at the end; nothing is kept.
-- Any failed check stops with an error saying which one.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  q jsonb;
  s text;
  v public.ck_subscriptions;
  v_end timestamptz;
  v_pay jsonb;
  v_checkout text;
begin
  insert into auth.users (id, email, aud, role, raw_app_meta_data)
  values (v_owner, 'ck-test-' || v_owner || '@test.invalid', 'authenticated', 'authenticated',
          '{"app":"chapa_kazi"}');

  -- 1. Formula, during the trial (no extra charge for shops).
  q := public.ck_sub_quote_for(v_owner, 'monthly', 1);
  assert (q ->> 'total')::int = 1199, 'monthly 1 shop = 1199, got ' || q;
  q := public.ck_sub_quote_for(v_owner, 'weekly', 3);
  assert (q ->> 'total')::int = 299 + 2 * 179, 'weekly 3 shops, got ' || q;
  assert q ->> 'plan' = 'growth', 'plan for 3 shops';
  q := public.ck_sub_quote_for(v_owner, 'daily', 6);
  assert (q ->> 'total')::int = 49 + 5 * 29 and q ->> 'plan' = 'enterprise', 'daily 6 shops';
  q := public.ck_sub_quote_for(v_owner, 'monthly', 2);
  assert (q ->> 'saving_vs_daily')::int = 30 * 78 - 1898, 'monthly saving for 2 shops';

  -- 2. New owners start with a 14-day trial.
  select * into v from public.ck_subscriptions where owner_uid = v_owner;
  assert v.in_trial and v.expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour',
    'trial is 14 days';

  -- 3. A successful payment is credited once, however many times Safaricom repeats it.
  v_pay := public.ck_internal_sub_start(v_owner, 'monthly', 1, '254708374149', 'sandbox');
  assert (v_pay ->> 'ok')::boolean, 'start payment: ' || v_pay;
  v_checkout := 'ws_CO_test_' || v_owner;
  perform public.ck_internal_sub_sent((v_pay ->> 'payment_id')::uuid, v_checkout, 'm1', true, null);

  s := public.ck_internal_sub_finish(v_checkout, 0, 'ok', 'TST0000001', 1199, '{}');
  assert s = 'success', 'first callback succeeds, got ' || s;
  select expires_at into v_end from public.ck_subscriptions where owner_uid = v_owner;
  -- Paid during the trial: 30 days are added on top of the trial's end.
  assert v_end between now() + interval '43 days 23 hours' and now() + interval '44 days 1 hour',
    'time stacks on top of trial, got ' || v_end;

  s := public.ck_internal_sub_finish(v_checkout, 0, 'ok', 'TST0000001', 1199, '{}');
  assert s = 'success', 'repeat callback says success';
  assert (select expires_at from public.ck_subscriptions where owner_uid = v_owner) = v_end,
    'repeat callback must NOT add time again';

  -- 4. The same receipt on a different payment is never credited.
  v_pay := public.ck_internal_sub_start(v_owner, 'daily', 1, '254708374149', 'sandbox');
  perform public.ck_internal_sub_sent((v_pay ->> 'payment_id')::uuid, v_checkout || '_b', 'm2', true, null);
  s := public.ck_internal_sub_finish(v_checkout || '_b', 0, 'ok', 'TST0000001', 49, '{}');
  assert s = 'failed', 'reused receipt must fail, got ' || s;
  assert (select expires_at from public.ck_subscriptions where owner_uid = v_owner) = v_end,
    'reused receipt must not add time';

  -- 5. Cancelled and underpaid payments add no time.
  update public.ck_sub_payments set created_at = now() - interval '5 minutes' where owner_uid = v_owner;
  v_pay := public.ck_internal_sub_start(v_owner, 'daily', 1, '254708374149', 'sandbox');
  perform public.ck_internal_sub_sent((v_pay ->> 'payment_id')::uuid, v_checkout || '_c', 'm3', true, null);
  assert public.ck_internal_sub_finish(v_checkout || '_c', 1032, 'Request cancelled by user', null, null, '{}') = 'cancelled',
    'cancelled';
  v_pay := public.ck_internal_sub_start(v_owner, 'daily', 1, '254708374149', 'sandbox');
  perform public.ck_internal_sub_sent((v_pay ->> 'payment_id')::uuid, v_checkout || '_d', 'm4', true, null);
  assert public.ck_internal_sub_finish(v_checkout || '_d', 0, 'ok', 'TST0000002', 10, '{}') = 'underpaid',
    'underpaid';
  assert (select expires_at from public.ck_subscriptions where owner_uid = v_owner) = v_end,
    'cancelled/underpaid must not add time';

  -- 6. Adding a shop mid-way charges only the add-on for the days left (about 44 days of 699/30).
  q := public.ck_sub_quote_for(v_owner, null, 2);
  assert (q ->> 'kind') = 'add_shops'
     and (q ->> 'total')::int between floor(43.9 * 699 / 30) and ceil(44.1 * 699 / 30),
    'add one shop for the days left, got ' || q;

  -- 7. Unknown callbacks change nothing.
  assert public.ck_internal_sub_finish('ws_CO_nobody', 0, 'ok', 'TST0000003', 1199, '{}') = 'unknown', 'unknown';

  -- 8. A free account ("must pay" switched off) is never charged.
  update public.ck_subscriptions set exempt = true where owner_uid = v_owner;
  update public.ck_sub_payments set created_at = now() - interval '5 minutes' where owner_uid = v_owner;
  assert public.ck_internal_sub_start(v_owner, 'daily', 1, '254708374149', 'sandbox') ->> 'error' = 'exempt',
    'free account cannot be charged';

  raise notice 'All Chapa Biz subscription checks passed';
end $$;

rollback;
