-- CHAPA KAZI: server tables and access rules.
--
-- These live inside the "trillionaire company" Supabase project but are a separate app.
-- Everything belonging to Chapa Kazi starts with "ck_" so it is easy to tell apart.
-- This file only ADDS things. It does not touch any table of the other app.
--
-- How the tables work
--   * Each row is one record from a phone. The record itself is in "data" (JSON).
--   * "updated_at" is the time on the phone when the record was last changed (milliseconds).
--     When two phones change the same record, the later phone time wins.
--   * "synced_at" is set by the server and is what phones use to ask "what is new since last time?".
--   * Nothing is ever deleted through the app.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------

create table public.ck_people (
  id          uuid primary key,
  -- The login this person signs in with. Set only by ck_claim_person() or the join function.
  auth_uid    uuid unique references auth.users (id) on delete set null,
  created_by  uuid not null default auth.uid(),
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_people is
  'CHAPA KAZI app (not part of the trillionaire company app). Shop owners and workers. PINs are never stored here.';

create table public.ck_businesses (
  id          uuid primary key,
  owner_uid   uuid not null default auth.uid() references auth.users (id),
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_businesses is
  'CHAPA KAZI app (not part of the trillionaire company app). One row per shop.';

create table public.ck_memberships (
  id          uuid primary key,
  business_id uuid not null references public.ck_businesses (id),
  person_id   uuid not null references public.ck_people (id),
  role        text not null check (role in ('admin', 'worker')),
  removed_at  bigint,
  -- One-time code a new worker types to join from their own phone.
  invite_code text,
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_memberships is
  'CHAPA KAZI app (not part of the trillionaire company app). Which person works in which shop, and as owner (admin) or worker.';

-- The rest all have the same shape: a record that belongs to one shop.
do $$
declare
  t text;
  notes constant jsonb := jsonb_build_object(
    'ck_items',          'Things a shop sells and how much is left.',
    'ck_customers',      'Customers who buy on credit, and what they owe.',
    'ck_entries',        'Ledger entries as they stand now (sales, expenses, credit, debt payments).',
    'ck_entry_versions', 'Every version of every ledger entry. Insert-only: this is the edit history.',
    'ck_stock_moves',    'Every change in stock. Insert-only.',
    'ck_alerts',         'Notes for the owner about risky edits. Only owners can read them.',
    'ck_item_costs',     'Buying prices. Only owners can read or write them.',
    'ck_line_costs',     'Buying price at the moment of each sale. Only owners can read them.'
  );
begin
  for t in select jsonb_object_keys(notes) loop
    execute format(
      'create table public.%I (
         id          uuid primary key,
         business_id uuid not null references public.ck_businesses (id),
         data        jsonb not null check (pg_column_size(data) < 65536),
         updated_at  bigint not null,
         synced_at   timestamptz not null default now()
       )', t);
    execute format('comment on table public.%I is %L', t,
      'CHAPA KAZI app (not part of the trillionaire company app). ' || (notes ->> t));
  end loop;
end $$;

-- Phones ask "what changed since X?" for the shops they belong to.
do $$
declare t text;
begin
  foreach t in array array['ck_items','ck_customers','ck_entries','ck_entry_versions','ck_stock_moves',
                           'ck_alerts','ck_item_costs','ck_line_costs','ck_memberships'] loop
    execute format('create index %I on public.%I (business_id, synced_at)', t || '_sync_idx', t);
  end loop;
end $$;
create index ck_people_sync_idx       on public.ck_people (synced_at);
create index ck_people_created_by_idx on public.ck_people (created_by);
create index ck_businesses_owner_idx  on public.ck_businesses (owner_uid);
create index ck_memberships_person_idx on public.ck_memberships (person_id);
create unique index ck_memberships_invite_idx on public.ck_memberships (invite_code) where invite_code is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. "Who am I allowed to see?" helpers
--    These run with elevated rights only to look up the caller's own shops. They return
--    nothing about anyone else.
-- ---------------------------------------------------------------------------------------------

-- Shops where the caller is the owner (admin).
create function public.ck_my_admin_business_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select b.id from public.ck_businesses b where b.owner_uid = (select auth.uid())
  union
  select m.business_id
  from public.ck_memberships m
  join public.ck_people p on p.id = m.person_id
  where p.auth_uid = (select auth.uid()) and m.role = 'admin' and m.removed_at is null
$$;

-- Shops the caller belongs to in any role. A removed worker belongs to none.
create function public.ck_my_business_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select public.ck_my_admin_business_ids()
  union
  select m.business_id
  from public.ck_memberships m
  join public.ck_people p on p.id = m.person_id
  where p.auth_uid = (select auth.uid()) and m.removed_at is null
$$;

-- People the caller may see: everyone in the caller's shops (names show on entries).
create function public.ck_visible_person_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.person_id from public.ck_memberships m
  where m.business_id in (select public.ck_my_business_ids())
$$;

-- The caller's own person record(s).
create function public.ck_my_person_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.ck_people p where p.auth_uid = (select auth.uid())
$$;

-- An owner links their login to the person record their phone just created.
-- A login can be linked to one person only, and only to a record it created itself.
create function public.ck_claim_person(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public.ck_people where auth_uid = me) then
    if exists (select 1 from public.ck_people where auth_uid = me and id = p_person) then
      return;
    end if;
    raise exception 'This login is already linked to another person';
  end if;
  update public.ck_people set auth_uid = me
  where id = p_person and created_by = me and auth_uid is null;
  if not found then
    raise exception 'This person cannot be linked to your login';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Automatic stamps and guards
-- ---------------------------------------------------------------------------------------------

-- Later phone time wins; an older change arriving late is ignored. Ownership fields cannot be
-- changed through the app. "synced_at" is always set by the server.
create function public.ck_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare via_app boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return old;
    end if;
    if tg_table_name = 'ck_people' then
      if via_app then
        new.auth_uid := old.auth_uid;
        new.created_by := old.created_by;
      end if;
    elsif tg_table_name = 'ck_businesses' then
      new.owner_uid := old.owner_uid;
    else
      new.business_id := old.business_id;
      if tg_table_name = 'ck_memberships' then
        new.person_id := old.person_id;
      end if;
    end if;
  elsif tg_table_name = 'ck_people' and via_app then
    new.auth_uid := null;
    new.created_by := (select auth.uid());
  elsif tg_table_name = 'ck_businesses' and via_app then
    new.owner_uid := (select auth.uid());
  end if;
  new.synced_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ck_people','ck_businesses','ck_memberships','ck_items','ck_customers','ck_entries',
                           'ck_entry_versions','ck_stock_moves','ck_alerts','ck_item_costs','ck_line_costs'] loop
    execute format('create trigger ck_stamp before insert or update on public.%I
                    for each row execute function public.ck_stamp()', t);
  end loop;
end $$;

-- When a sale arrives, remember the buying price of each item at that moment. This runs on the
-- server so that workers' phones never need to hold buying prices.
create function public.ck_fill_line_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ck_line_costs (id, business_id, data, updated_at)
  select (l ->> 'id')::uuid,
         new.business_id,
         jsonb_build_object('id', l ->> 'id', 'entryId', new.id, 'businessId', new.business_id,
                            'itemId', l ->> 'itemId', 'unitCostCents', (c.data ->> 'costCents')::bigint),
         new.updated_at
  from jsonb_array_elements(case when jsonb_typeof(new.data -> 'lines') = 'array' then new.data -> 'lines' else '[]'::jsonb end) l
  join public.ck_item_costs c on c.id::text = l ->> 'itemId' and c.business_id = new.business_id
  on conflict (id) do nothing;
  return null;
exception when others then
  -- A malformed line must never block the sale itself from being saved.
  return null;
end $$;

create trigger ck_fill_line_costs after insert or update on public.ck_entries
for each row execute function public.ck_fill_line_costs();

-- ---------------------------------------------------------------------------------------------
-- 4. Access rules (row level security)
-- ---------------------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['ck_people','ck_businesses','ck_memberships','ck_items','ck_customers','ck_entries',
                           'ck_entry_versions','ck_stock_moves','ck_alerts','ck_item_costs','ck_line_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Nobody who is not signed in can touch these, and the app can never delete.
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- People: yourself, people you added, and people in your shops.
create policy ck_people_read on public.ck_people for select to authenticated
  using (auth_uid = (select auth.uid()) or created_by = (select auth.uid())
         or id in (select public.ck_visible_person_ids()));
create policy ck_people_add on public.ck_people for insert to authenticated
  -- ck_stamp() forces created_by to the caller and leaves the login unlinked
  with check ((select auth.uid()) is not null);
create policy ck_people_change on public.ck_people for update to authenticated
  using (auth_uid = (select auth.uid()) or created_by = (select auth.uid()))
  with check (auth_uid = (select auth.uid()) or created_by = (select auth.uid()));

-- Shops: members can read; only the owner can add or change.
create policy ck_businesses_read on public.ck_businesses for select to authenticated
  using (id in (select public.ck_my_business_ids()));
create policy ck_businesses_add on public.ck_businesses for insert to authenticated
  -- ck_stamp() forces owner_uid to the caller
  with check ((select auth.uid()) is not null);
create policy ck_businesses_change on public.ck_businesses for update to authenticated
  using (id in (select public.ck_my_admin_business_ids()))
  with check (id in (select public.ck_my_admin_business_ids()));

-- Memberships: owners manage them. A worker can read only their own (so they learn if removed).
create policy ck_memberships_read on public.ck_memberships for select to authenticated
  using (business_id in (select public.ck_my_admin_business_ids())
         or person_id in (select public.ck_my_person_ids()));
create policy ck_memberships_add on public.ck_memberships for insert to authenticated
  with check (business_id in (select public.ck_my_admin_business_ids()));
create policy ck_memberships_change on public.ck_memberships for update to authenticated
  using (business_id in (select public.ck_my_admin_business_ids()))
  with check (business_id in (select public.ck_my_admin_business_ids()));

-- Shop records that every member of the shop can read, add and change.
do $$
declare t text;
begin
  foreach t in array array['ck_items','ck_customers','ck_entries'] loop
    execute format('create policy %I on public.%I for select to authenticated
                    using (business_id in (select public.ck_my_business_ids()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (business_id in (select public.ck_my_business_ids()))', t || '_add', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (business_id in (select public.ck_my_business_ids()))
                    with check (business_id in (select public.ck_my_business_ids()))', t || '_change', t);
  end loop;

  -- History: members can read and add. Nobody can change or remove it.
  foreach t in array array['ck_entry_versions','ck_stock_moves'] loop
    execute format('create policy %I on public.%I for select to authenticated
                    using (business_id in (select public.ck_my_business_ids()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (business_id in (select public.ck_my_business_ids()))', t || '_add', t);
  end loop;

  -- Buying prices: owners only.
  foreach t in array array['ck_item_costs','ck_line_costs'] loop
    execute format('create policy %I on public.%I for select to authenticated
                    using (business_id in (select public.ck_my_admin_business_ids()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (business_id in (select public.ck_my_admin_business_ids()))', t || '_add', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (business_id in (select public.ck_my_admin_business_ids()))
                    with check (business_id in (select public.ck_my_admin_business_ids()))', t || '_change', t);
  end loop;
end $$;

-- Alerts: any member's phone can raise one; only the owner can read or mark them seen.
create policy ck_alerts_read on public.ck_alerts for select to authenticated
  using (business_id in (select public.ck_my_admin_business_ids()));
create policy ck_alerts_add on public.ck_alerts for insert to authenticated
  with check (business_id in (select public.ck_my_business_ids()));
create policy ck_alerts_change on public.ck_alerts for update to authenticated
  using (business_id in (select public.ck_my_admin_business_ids()))
  with check (business_id in (select public.ck_my_admin_business_ids()));

-- The helper functions are for signed-in users only.
revoke all on function public.ck_my_admin_business_ids(), public.ck_my_business_ids(),
  public.ck_visible_person_ids(), public.ck_my_person_ids(), public.ck_claim_person(uuid) from public, anon;
grant execute on function public.ck_my_admin_business_ids(), public.ck_my_business_ids(),
  public.ck_visible_person_ids(), public.ck_my_person_ids(), public.ck_claim_person(uuid) to authenticated;
revoke all on function public.ck_stamp(), public.ck_fill_line_costs() from public, anon, authenticated;
