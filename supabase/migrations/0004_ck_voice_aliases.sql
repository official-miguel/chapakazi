-- CHAPA KAZI: words a shop has taught the voice feature.
--
-- When someone corrects a voice entry by hand, the app remembers what the unknown word meant
-- ("omo" = the item Washing Powder). Keeping these on the server means every phone in the shop
-- learns it once. Same shape and same rules as the other shop tables.

create table public.ck_voice_aliases (
  id          uuid primary key,
  business_id uuid not null references public.ck_businesses (id),
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_voice_aliases is
  'CHAPA KAZI app (not part of the trillionaire company app). Words a shop taught the voice feature, e.g. a nickname for an item.';

create index ck_voice_aliases_sync_idx on public.ck_voice_aliases (business_id, synced_at);

create trigger ck_stamp before insert or update on public.ck_voice_aliases
for each row execute function public.ck_stamp();

alter table public.ck_voice_aliases enable row level security;
revoke all on public.ck_voice_aliases from anon;
revoke all on public.ck_voice_aliases from authenticated;
grant select, insert, update on public.ck_voice_aliases to authenticated;

create policy ck_voice_aliases_read on public.ck_voice_aliases for select to authenticated
  using (business_id in (select public.ck_my_business_ids()));
create policy ck_voice_aliases_add on public.ck_voice_aliases for insert to authenticated
  with check (business_id in (select public.ck_my_business_ids()));
create policy ck_voice_aliases_change on public.ck_voice_aliases for update to authenticated
  using (business_id in (select public.ck_my_business_ids()))
  with check (business_id in (select public.ck_my_business_ids()));
