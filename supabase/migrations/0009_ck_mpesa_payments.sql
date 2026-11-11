-- CHAPA KAZI: M-Pesa payments arriving for connected shops.
--
-- Safaricom tells our server about each payment to a connected Till or Paybill. The server
-- function "ck-mpesa" passes it to ck_internal_record_mpesa(), which files it under the right
-- shop as "unassigned". Someone in the shop then says what it was for.
--
-- Safety:
--   * Safaricom does not sign its messages, so the address it calls contains a long secret
--     token. A message without the right token is refused.
--   * Phones can never add a payment, and can only change how a payment was sorted
--     (status and the entry it was linked to). The amount, payer and M-Pesa code are fixed.
--   * The same M-Pesa code is stored once, however many times Safaricom repeats the message.

create table public.ck_mpesa_payments (
  id          uuid primary key,
  business_id uuid not null references public.ck_businesses (id),
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_mpesa_payments is
  'CHAPA KAZI app (not part of the trillionaire company app). M-Pesa payments received for a shop, waiting to be matched to a sale or a debt. Added by the server only.';

create unique index ck_mpesa_payments_trans_idx on public.ck_mpesa_payments ((data ->> 'transId'));
create index ck_mpesa_payments_sync_idx on public.ck_mpesa_payments (business_id, synced_at);

create function public.ck_mpesa_pay_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if coalesce(new.data ->> 'status', '') not in ('unassigned', 'assigned', 'ignored') then
      raise exception 'Unknown payment status';
    end if;
    -- Keep everything Safaricom sent; take only the sorting fields from the phone.
    new.data := old.data || coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(new.data)
      where key in ('status', 'entryId', 'assignedBy', 'assignedAt', 'updatedAt')), '{}'::jsonb);
  end if;
  return new;
end $$;

create trigger ck_mpesa_pay_guard before update on public.ck_mpesa_payments
for each row execute function public.ck_mpesa_pay_guard();
create trigger ck_stamp before insert or update on public.ck_mpesa_payments
for each row execute function public.ck_stamp();

alter table public.ck_mpesa_payments enable row level security;
revoke all on public.ck_mpesa_payments from anon;
revoke all on public.ck_mpesa_payments from authenticated;
grant select, update on public.ck_mpesa_payments to authenticated;

create policy ck_mpesa_payments_read on public.ck_mpesa_payments for select to authenticated
  using (business_id in (select public.ck_my_business_ids()));
create policy ck_mpesa_payments_change on public.ck_mpesa_payments for update to authenticated
  using (business_id in (select public.ck_my_business_ids()))
  with check (business_id in (select public.ck_my_business_ids()));

-- Shared by real and test payments.
create function public.ck_file_mpesa_payment(
  p_business uuid, p_trans_id text, p_amount_cents bigint, p_payer text, p_payer_ref text,
  p_bill_ref text, p_shortcode text, p_paid_at bigint, p_test boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  insert into public.ck_mpesa_payments (id, business_id, data, updated_at)
  values (v_id, p_business, jsonb_strip_nulls(jsonb_build_object(
      'id', v_id, 'businessId', p_business, 'transId', p_trans_id, 'amountCents', p_amount_cents,
      'payerName', nullif(trim(coalesce(p_payer, '')), ''), 'payerRef', nullif(p_payer_ref, ''),
      'billRef', nullif(p_bill_ref, ''), 'shortcode', p_shortcode, 'paidAt', coalesce(p_paid_at, v_now),
      'status', 'unassigned', 'updatedAt', v_now, 'test', case when p_test then true end)), v_now)
  on conflict ((data ->> 'transId')) do nothing;
end $$;

-- Called only by the server function that Safaricom talks to.
create function public.ck_internal_record_mpesa(
  p_token text, p_shortcode text, p_trans_id text, p_amount_cents bigint,
  p_payer text, p_payer_ref text, p_bill_ref text, p_paid_at bigint
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_business uuid;
begin
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'ck_mpesa_callback_token';
  if v_token is null or p_token is null or p_token <> v_token then
    return 'bad_token';
  end if;
  if coalesce(p_trans_id, '') = '' or coalesce(p_amount_cents, 0) <= 0 then
    return 'bad_payment';
  end if;
  select l.business_id into v_business from public.ck_mpesa_links l
  where l.data ->> 'shortcode' = p_shortcode and l.status = 'active' limit 1;
  if v_business is null then
    return 'unknown_shortcode';
  end if;
  perform public.ck_file_mpesa_payment(v_business, p_trans_id, p_amount_cents, p_payer, p_payer_ref, p_bill_ref, p_shortcode, p_paid_at, false);
  return 'ok';
end $$;

-- Super admin: the secret part of the address Safaricom must call. Made on first use.
create function public.ck_admin_mpesa_callback_token() returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'ck_mpesa_callback_token';
  if v_token is null then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(v_token, 'ck_mpesa_callback_token', 'Secret part of the M-Pesa callback address');
  end if;
  return v_token;
end $$;

-- Super admin: a pretend payment for a shop, to try the inbox without Safaricom. Marked as a test.
create function public.ck_admin_send_test_payment(p_business uuid, p_amount_cents bigint, p_payer text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(p_amount_cents, 0) <= 0 or p_amount_cents > 100000000 then
    raise exception 'Enter an amount';
  end if;
  if not exists (select 1 from public.ck_businesses b where b.id = p_business) then
    raise exception 'No such shop';
  end if;
  perform public.ck_file_mpesa_payment(
    p_business, 'TEST' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), p_amount_cents,
    coalesce(nullif(trim(p_payer), ''), 'Test Customer'), 'test', null, null, null, true);
end $$;

revoke all on function public.ck_mpesa_pay_guard() from public, anon, authenticated;
revoke all on function public.ck_file_mpesa_payment(uuid, text, bigint, text, text, text, text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ck_internal_record_mpesa(text, text, text, bigint, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.ck_internal_record_mpesa(text, text, text, bigint, text, text, text, bigint) to service_role;
revoke all on function public.ck_admin_mpesa_callback_token(), public.ck_admin_send_test_payment(uuid, bigint, text) from public, anon;
grant execute on function public.ck_admin_mpesa_callback_token(), public.ck_admin_send_test_payment(uuid, bigint, text) to authenticated;
