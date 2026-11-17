-- CHAPA KAZI: checks for the usual plan, the 5 minutes after a plan ends (0013) and choosing a plan in the trial (0014).
-- Run as one block in the SQL editor, after migrations 0011-0014. Everything is rolled back at
-- the end; nothing is kept. Any failed check stops with an error saying which one.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  st jsonb;
  g jsonb;
  g2 jsonb;
  v_pay jsonb;
  n int := 0;
  v_period text;
begin
  insert into auth.users (id, email, aud, role, raw_app_meta_data)
  values (v_owner, 'ck-test-' || v_owner || '@test.invalid', 'authenticated', 'authenticated',
          '{"app":"chapa_kazi"}');
  -- Act as that login for auth.uid().
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- 1. The first check puts every account on a plan: the free trial.
  st := public.ck_sub_status(null);
  assert (st ->> 'in_trial')::boolean and (st ->> 'active')::boolean, 'new account starts in trial: ' || st;
  assert st ->> 'usual_period' is null, 'no usual plan before paying';
  assert st ->> 'grace_until' is null, 'no minutes before the plan ends';

  -- 2. The trial is once per account: asking again does not start a new one.
  update public.ck_subscriptions set expires_at = now() - interval '1 hour' where owner_uid = v_owner;
  st := public.ck_sub_status(null);
  assert not (st ->> 'active')::boolean, 'ended trial stays ended: ' || st;

  -- 3. No minutes while time is still left.
  update public.ck_subscriptions set expires_at = now() + interval '1 day' where owner_uid = v_owner;
  g := public.ck_sub_grace_start(null);
  assert not (g ->> 'ok')::boolean and g ->> 'error' = 'not_ended', 'no minutes while active: ' || g;

  -- 4. After it ends: 5 minutes, once. Asking again gives the same end, not new minutes.
  update public.ck_subscriptions set expires_at = now() - interval '1 minute' where owner_uid = v_owner;
  g := public.ck_sub_grace_start(null);
  assert (g ->> 'ok')::boolean, 'minutes start after the end: ' || g;
  assert (g ->> 'grace_until')::timestamptz between now() + interval '4 minutes 59 seconds' and now() + interval '5 minutes 1 second',
    'five minutes: ' || g;
  g2 := public.ck_sub_grace_start(null);
  assert g2 ->> 'grace_until' = g ->> 'grace_until', 'second start gives no new minutes: ' || g2;
  st := public.ck_sub_status(null);
  assert st ->> 'grace_until' = g ->> 'grace_until', 'status shows the minutes: ' || st;

  -- 5. Paying moves the end date, so the minutes of the old end date no longer apply.
  --    Pay monthly twice and weekly once (most recent): the usual plan is monthly.
  foreach v_period in array array['monthly', 'monthly', 'weekly'] loop
    n := n + 1;
    v_pay := public.ck_internal_sub_start(v_owner, v_period, 2, '254708374149', 'sandbox');
    assert (v_pay ->> 'ok')::boolean, 'start payment: ' || v_pay;
    perform public.ck_internal_sub_sent((v_pay ->> 'payment_id')::uuid, 'ws_CO_grace_' || n || v_owner, 'm', true, null);
    perform public.ck_internal_sub_finish('ws_CO_grace_' || n || v_owner, 0, 'ok', 'TSTG' || n || left(v_owner::text, 6),
                                          (v_pay ->> 'total')::int, '{}');
  end loop;
  st := public.ck_sub_status(null);
  assert st ->> 'usual_period' = 'monthly', 'paid monthly most often: ' || st;
  assert (st ->> 'usual_shops')::int = 2, 'shops paid for last time: ' || st;
  assert st ->> 'grace_until' is null, 'new end date, no minutes used yet: ' || st;

  -- 6. When that ends, there are 5 new minutes for the new end date.
  update public.ck_subscriptions set expires_at = now() - interval '1 second' where owner_uid = v_owner;
  g := public.ck_sub_grace_start(null);
  assert (g ->> 'ok')::boolean, 'new minutes for a new end date: ' || g;
  assert (select count(*) from public.ck_sub_grace where uid = v_owner) = 1, 'old end dates are cleared';

  -- 7. A free ("must pay" off) account never needs the minutes.
  update public.ck_subscriptions set exempt = true where owner_uid = v_owner;
  g := public.ck_sub_grace_start(null);
  assert not (g ->> 'ok')::boolean, 'free account: ' || g;

  -- 8. Choosing a plan (migration 0014) charges nothing and is remembered.
  g := public.ck_sub_choose('weekly', 2);
  assert (g ->> 'ok')::boolean, 'choose a plan: ' || g;
  st := public.ck_sub_status(null);
  assert st ->> 'chosen_period' = 'weekly' and (st ->> 'chosen_shops')::int = 2, 'chosen plan remembered: ' || st;
  assert (select count(*) from public.ck_sub_payments where owner_uid = v_owner) = 3, 'choosing makes no payment';
  g := public.ck_sub_choose('yearly', 1);
  assert not (g ->> 'ok')::boolean, 'unknown period refused: ' || g;

  raise notice 'All usual-plan, 5-minute and chosen-plan checks passed.';
end $$;

rollback;
