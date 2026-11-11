-- CHAPA KAZI: the platform admin (the person who runs Chapa Kazi, not a shop owner).
--
-- The platform admin can see who is using the app: shops, people, and how active they are.
-- By design they see ACTIVITY ONLY: no money amounts, no customer names, no items sold.
--
-- Who is an admin is decided by login id, never by email address. Chapa Kazi logins are created
-- without checking that the person owns the email, so an email could be claimed by anyone.
-- To make someone an admin, add their login id to ck_platform_admins from the Supabase dashboard.

create table public.ck_platform_admins (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
comment on table public.ck_platform_admins is
  'CHAPA KAZI app (not part of the trillionaire company app). Logins allowed to open the platform admin page. Edit only from the dashboard.';
alter table public.ck_platform_admins enable row level security;
revoke all on public.ck_platform_admins from anon, authenticated;

create function public.ck_is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ck_platform_admins a where a.auth_uid = (select auth.uid()))
$$;

-- Everything the admin page shows, in one call. "Active" means the person or shop recorded,
-- edited or deleted an entry that reached the server in the last 7 days.
create function public.ck_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  with shop_activity as (
    select v.business_id,
           count(*) filter (where v.data ->> 'version' = '1') as entries,
           max(v.synced_at) as last_at,
           count(*) filter (where v.synced_at > now() - interval '7 days') as actions_7d
    from public.ck_entry_versions v
    group by v.business_id
  ),
  person_activity as (
    select v.data ->> 'changedBy' as person_id,
           max(v.synced_at) as last_at,
           count(*) filter (where v.synced_at > now() - interval '7 days') as actions_7d
    from public.ck_entry_versions v
    group by 1
  ),
  shop_rows as (
    select b.id,
           b.data ->> 'name' as name,
           b.data ->> 'type' as type,
           b.synced_at as first_synced_at,
           u.email as owner_email,
           (select p.data ->> 'name' from public.ck_people p where p.auth_uid = b.owner_uid limit 1) as owner_name,
           (select count(*) from public.ck_memberships m
             where m.business_id = b.id and m.role = 'worker' and m.removed_at is null) as workers,
           (select count(*) from public.ck_items i where i.business_id = b.id) as items,
           (select count(*) from public.ck_customers c where c.business_id = b.id) as customers,
           coalesce(a.entries, 0) as entries,
           coalesce(a.actions_7d, 0) as actions_7d,
           a.last_at
    from public.ck_businesses b
    left join auth.users u on u.id = b.owner_uid
    left join shop_activity a on a.business_id = b.id
  ),
  people_rows as (
    select p.id,
           p.data ->> 'name' as name,
           m.role,
           b.data ->> 'name' as shop,
           m.removed_at is not null as removed,
           p.auth_uid is not null as has_login,
           -- Workers' logins use a made-up address that is not worth showing.
           case when u.email like '%@workers.chapakazi.invalid' then null else u.email end as email,
           u.last_sign_in_at,
           coalesce(pa.actions_7d, 0) as actions_7d,
           pa.last_at
    from public.ck_memberships m
    join public.ck_people p on p.id = m.person_id
    join public.ck_businesses b on b.id = m.business_id
    left join auth.users u on u.id = p.auth_uid
    left join person_activity pa on pa.person_id = p.id::text
  )
  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'shops', (select count(*) from shop_rows),
      'shops_active_7d', (select count(*) from shop_rows where last_at > now() - interval '7 days'),
      'shops_new_7d', (select count(*) from shop_rows where first_synced_at > now() - interval '7 days'),
      'people', (select count(distinct id) from people_rows where not removed),
      'people_active_7d', (select count(distinct id) from people_rows where last_at > now() - interval '7 days'),
      'logins', (select count(*) from auth.users where raw_app_meta_data ->> 'app' = 'chapa_kazi'),
      'entries', (select coalesce(sum(entries), 0) from shop_rows),
      'actions_24h', (select count(*) from public.ck_entry_versions where synced_at > now() - interval '24 hours'),
      'actions_7d', (select coalesce(sum(actions_7d), 0) from shop_rows)
    ),
    'shops', coalesce((select jsonb_agg(to_jsonb(s) order by s.last_at desc nulls last, s.name) from shop_rows s), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(p) order by p.last_at desc nulls last, p.name) from people_rows p), '[]'::jsonb),
    'gemini', coalesce(
      (select jsonb_build_object('set', true, 'hint', s.description, 'updated_at', s.updated_at)
       from vault.secrets s where s.name = 'ck_gemini_api_key'),
      jsonb_build_object('set', false))
  ) into result;

  return result;
end $$;

-- The Gemini API key for voice. It is stored encrypted in Supabase Vault and can never be read
-- back through the app: the admin page only ever learns its last four characters.
create function public.ck_admin_set_gemini_key(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cleaned text := trim(coalesce(p_key, ''));
  existing uuid;
  hint text;
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(cleaned) < 20 or length(cleaned) > 200 or cleaned ~ '\s' then
    raise exception 'That does not look like an API key';
  end if;
  hint := 'ends in ' || right(cleaned, 4);
  select s.id into existing from vault.secrets s where s.name = 'ck_gemini_api_key';
  if existing is null then
    perform vault.create_secret(cleaned, 'ck_gemini_api_key', hint);
  else
    perform vault.update_secret(existing, cleaned, 'ck_gemini_api_key', hint);
  end if;
end $$;

revoke all on function public.ck_is_platform_admin(), public.ck_admin_overview(), public.ck_admin_set_gemini_key(text) from public, anon;
grant execute on function public.ck_is_platform_admin(), public.ck_admin_overview(), public.ck_admin_set_gemini_key(text) to authenticated;
