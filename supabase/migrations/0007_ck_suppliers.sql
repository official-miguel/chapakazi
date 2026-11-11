-- CHAPA KAZI: suppliers, and what the shop owes them.
--
-- ck_suppliers       who the shop buys from
-- ck_supplier_moves  goods taken on credit from a supplier, and payments made to them
--
-- Like buying prices, this is the owner's business: only owners can read or write these.

do $$
declare t text;
begin
  foreach t in array array['ck_suppliers', 'ck_supplier_moves'] loop
    execute format(
      'create table public.%I (
         id          uuid primary key,
         business_id uuid not null references public.ck_businesses (id),
         data        jsonb not null check (pg_column_size(data) < 16384),
         updated_at  bigint not null,
         synced_at   timestamptz not null default now()
       )', t);
    execute format('create index %I on public.%I (business_id, synced_at)', t || '_sync_idx', t);
    execute format('create trigger ck_stamp before insert or update on public.%I
                    for each row execute function public.ck_stamp()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using (business_id in (select public.ck_my_admin_business_ids()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (business_id in (select public.ck_my_admin_business_ids()))', t || '_add', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (business_id in (select public.ck_my_admin_business_ids()))
                    with check (business_id in (select public.ck_my_admin_business_ids()))', t || '_change', t);
  end loop;
end $$;

comment on table public.ck_suppliers is
  'CHAPA KAZI app (not part of the trillionaire company app). Who a shop buys stock from. Owners only.';
comment on table public.ck_supplier_moves is
  'CHAPA KAZI app (not part of the trillionaire company app). Goods taken on credit from suppliers and payments to them. Owners only.';
