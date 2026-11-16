-- CHAPA KAZI (Chapa Biz): settings for collecting plan payments by M-Pesa STK Push.
--
-- STK Push needs, besides the Consumer Key and Secret saved in 0010:
--   * the business short code (Paybill or Till) that receives the money
--     (sandbox: Safaricom's test Paybill 174379)
--   * the Lipa Na M-Pesa Online passkey Safaricom gives for that short code
--   * for a Till number only: transaction type "CustomerBuyGoodsOnline" and the store number
-- These are saved encrypted in Supabase Vault and, like the other keys, are write-only.
-- Only the server function ck-pay reads them, through ck_internal_daraja_config().

create function public.ck_vault_put(p_name text, p_value text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select s.id into v_id from vault.secrets s where s.name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, p_note);
  else
    perform vault.update_secret(v_id, p_value, p_name, p_note);
  end if;
end $$;
revoke all on function public.ck_vault_put(text, text, text) from public, anon, authenticated;

create function public.ck_admin_set_stk_settings(p_shortcode text, p_passkey text, p_till boolean, p_store text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := trim(coalesce(p_shortcode, ''));
  v_pass text := trim(coalesce(p_passkey, ''));
  v_store text := trim(coalesce(p_store, ''));
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_code !~ '^\d{5,8}$' then raise exception 'The short code should be 5 to 8 digits'; end if;
  if length(v_pass) < 20 or length(v_pass) > 200 or v_pass ~ '\s' then
    raise exception 'That does not look like a Daraja passkey';
  end if;
  if coalesce(p_till, false) and v_store !~ '^\d{5,8}$' then
    raise exception 'For a Till, also enter the store number (5 to 8 digits)';
  end if;

  perform public.ck_vault_put('ck_daraja_stk_passkey', v_pass, 'STK passkey');
  perform public.ck_vault_put('ck_daraja_stk_shortcode', v_code,
    case when coalesce(p_till, false) then 'till|' || v_store else 'paybill|' end);
end $$;

create function public.ck_admin_stk_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce(
    (select jsonb_build_object(
        'set', exists (select 1 from vault.secrets p where p.name = 'ck_daraja_stk_passkey'),
        'shortcode', s.decrypted_secret,               -- a short code is not secret
        'type', split_part(s.description, '|', 1),
        'store', nullif(split_part(s.description, '|', 2), ''),
        'updated_at', s.updated_at)
     from vault.decrypted_secrets s where s.name = 'ck_daraja_stk_shortcode'),
    jsonb_build_object('set', false));
end $$;

-- The secret part of the callback address Safaricom calls. Shared with the C2B callbacks of
-- 0009, which make it only when the super admin first shows those addresses, so make it now.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ck_mpesa_callback_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'ck_mpesa_callback_token', 'Secret part of the M-Pesa callback address');
  end if;
end $$;

-- Server only: everything ck-pay needs to talk to Safaricom.
create function public.ck_internal_daraja_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'env',       (select split_part(s.description, '|', 1) from vault.secrets s where s.name = 'ck_daraja_consumer_key'),
    'key',       (select decrypted_secret from vault.decrypted_secrets where name = 'ck_daraja_consumer_key'),
    'secret',    (select decrypted_secret from vault.decrypted_secrets where name = 'ck_daraja_consumer_secret'),
    'shortcode', (select decrypted_secret from vault.decrypted_secrets where name = 'ck_daraja_stk_shortcode'),
    'type',      (select split_part(description, '|', 1) from vault.secrets where name = 'ck_daraja_stk_shortcode'),
    'store',     (select nullif(split_part(description, '|', 2), '') from vault.secrets where name = 'ck_daraja_stk_shortcode'),
    'passkey',   (select decrypted_secret from vault.decrypted_secrets where name = 'ck_daraja_stk_passkey'),
    'token',     (select decrypted_secret from vault.decrypted_secrets where name = 'ck_mpesa_callback_token'))
$$;

-- Server only: is this the secret part of our callback address?
create function public.ck_internal_check_callback_token(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token = (select decrypted_secret from vault.decrypted_secrets
                             where name = 'ck_mpesa_callback_token'), false)
$$;

-- Server only: a payment the app asks about (only the payer's own).
create function public.ck_internal_sub_payment(p_owner uuid, p_payment uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'raw_callback' from public.ck_sub_payments p
  where p.id = p_payment and p.owner_uid = p_owner
$$;

revoke all on function public.ck_internal_daraja_config(), public.ck_internal_check_callback_token(text),
  public.ck_internal_sub_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ck_internal_daraja_config(), public.ck_internal_check_callback_token(text),
  public.ck_internal_sub_payment(uuid, uuid) to service_role;

revoke all on function public.ck_admin_set_stk_settings(text, text, boolean, text), public.ck_admin_stk_status()
  from public, anon;
grant execute on function public.ck_admin_set_stk_settings(text, text, boolean, text), public.ck_admin_stk_status()
  to authenticated;
