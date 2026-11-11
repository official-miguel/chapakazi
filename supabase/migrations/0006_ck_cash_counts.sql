-- CHAPA KAZI: end-of-day cash counts.
--
-- Each row is one count of the till: what the ledger said should be there, what was counted,
-- and the gap. Like the other history tables it can only be added to. Nobody can change or
-- remove a count afterwards, so a gap cannot be quietly tidied away.

create table public.ck_cash_counts (
  id          uuid primary key,
  business_id uuid not null references public.ck_businesses (id),
  data        jsonb not null check (pg_column_size(data) < 16384),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_cash_counts is
  'CHAPA KAZI app (not part of the trillionaire company app). End-of-day till counts compared with the ledger. Insert-only.';

create index ck_cash_counts_sync_idx on public.ck_cash_counts (business_id, synced_at);

create trigger ck_stamp before insert or update on public.ck_cash_counts
for each row execute function public.ck_stamp();

alter table public.ck_cash_counts enable row level security;
revoke all on public.ck_cash_counts from anon;
revoke all on public.ck_cash_counts from authenticated;
grant select, insert on public.ck_cash_counts to authenticated;

create policy ck_cash_counts_read on public.ck_cash_counts for select to authenticated
  using (business_id in (select public.ck_my_business_ids()));
create policy ck_cash_counts_add on public.ck_cash_counts for insert to authenticated
  with check (business_id in (select public.ck_my_business_ids()));
