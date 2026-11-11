-- CHAPA KAZI: the super admin's Daraja (Safaricom) keys.
--
-- The Consumer Key and Consumer Secret from developer.safaricom.co.ke are saved encrypted in
-- Supabase Vault. Like the Gemini key they are write-only: the app can replace them and can see
-- whether they are set, which environment they are for and the key's last four characters, but
-- can never read them back. Only server functions will use them.

create function public.ck_admin_set_daraja_keys(p_env text, p_key text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := trim(coalesce(p_key, ''));
  v_secret text := trim(coalesce(p_secret, ''));
  v_note text;
  v_id uuid;
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_env not in ('sandbox', 'production') then
    raise exception 'Unknown environment';
  end if;
  if length(v_key) < 16 or length(v_key) > 200 or v_key ~ '\s'
     or length(v_secret) < 16 or length(v_secret) > 200 or v_secret ~ '\s' then
    raise exception 'Those do not look like Daraja keys';
  end if;

  -- The note records which environment the keys are for, and enough of the key to recognise it.
  v_note := p_env || '|' || right(v_key, 4);
  select s.id into v_id from vault.secrets s where s.name = 'ck_daraja_consumer_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'ck_daraja_consumer_key', v_note);
  else
    perform vault.update_secret(v_id, v_key, 'ck_daraja_consumer_key', v_note);
  end if;

  select s.id into v_id from vault.secrets s where s.name = 'ck_daraja_consumer_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'ck_daraja_consumer_secret', p_env);
  else
    perform vault.update_secret(v_id, v_secret, 'ck_daraja_consumer_secret', p_env);
  end if;
end $$;

create function public.ck_admin_daraja_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce(
    (select jsonb_build_object(
        'set', true,
        'env', split_part(s.description, '|', 1),
        'hint', split_part(s.description, '|', 2),
        'updated_at', s.updated_at)
     from vault.secrets s where s.name = 'ck_daraja_consumer_key'),
    jsonb_build_object('set', false));
end $$;

revoke all on function public.ck_admin_set_daraja_keys(text, text, text), public.ck_admin_daraja_status() from public, anon;
grant execute on function public.ck_admin_set_daraja_keys(text, text, text), public.ck_admin_daraja_status() to authenticated;
