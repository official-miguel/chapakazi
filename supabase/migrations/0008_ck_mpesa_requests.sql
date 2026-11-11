-- CHAPA KAZI: shops asking for an M-Pesa connection.
--
-- A shop owner sends their Till or Paybill number from the app. The super admin (the app owner)
-- sees the request, does the Safaricom side, and moves it along. One row per shop.
--
-- The status belongs to the super admin. A shop owner can send and correct their details, but
-- cannot mark their own request as connected: the guard below resets whatever status the app
-- sends. The current status is also copied into "data" so phones receive it through normal sync.

create table public.ck_mpesa_links (
  id          uuid primary key,
  business_id uuid not null unique references public.ck_businesses (id),
  status      text not null default 'requested' check (status in ('requested', 'in_progress', 'active', 'rejected')),
  admin_note  text,
  data        jsonb not null check (pg_column_size(data) < 16384 and (data ->> 'shortcode') ~ '^[0-9]{5,8}$'),
  updated_at  bigint not null,
  synced_at   timestamptz not null default now()
);
comment on table public.ck_mpesa_links is
  'CHAPA KAZI app (not part of the trillionaire company app). A shop''s request for an M-Pesa connection and its status. Status is set by the super admin only.';

create index ck_mpesa_links_sync_idx on public.ck_mpesa_links (business_id, synced_at);

create function public.ck_mpesa_guard() returns trigger
language plpgsql set search_path = '' as $$
declare via_app boolean := current_user in ('authenticated', 'anon');
begin
  if via_app then
    if tg_op = 'INSERT' then
      new.status := 'requested';
      new.admin_note := null;
    elsif (new.data ->> 'shortcode') is distinct from (old.data ->> 'shortcode')
       or (new.data ->> 'kind') is distinct from (old.data ->> 'kind') then
      -- A different number is a new request: it has to be set up again.
      new.status := 'requested';
      new.admin_note := null;
    else
      new.status := old.status;
      new.admin_note := old.admin_note;
    end if;
  end if;
  new.data := new.data || jsonb_build_object('status', new.status, 'adminNote', new.admin_note);
  return new;
end $$;

-- Runs before ck_stamp (triggers fire in name order).
create trigger ck_mpesa_guard before insert or update on public.ck_mpesa_links
for each row execute function public.ck_mpesa_guard();
create trigger ck_stamp before insert or update on public.ck_mpesa_links
for each row execute function public.ck_stamp();

alter table public.ck_mpesa_links enable row level security;
revoke all on public.ck_mpesa_links from anon;
revoke all on public.ck_mpesa_links from authenticated;
grant select, insert, update on public.ck_mpesa_links to authenticated;

-- Only the shop's owner can see or send the request. Workers cannot.
create policy ck_mpesa_links_read on public.ck_mpesa_links for select to authenticated
  using (business_id in (select public.ck_my_admin_business_ids()));
create policy ck_mpesa_links_add on public.ck_mpesa_links for insert to authenticated
  with check (business_id in (select public.ck_my_admin_business_ids()));
create policy ck_mpesa_links_change on public.ck_mpesa_links for update to authenticated
  using (business_id in (select public.ck_my_admin_business_ids()))
  with check (business_id in (select public.ck_my_admin_business_ids()));

-- Super admin: every request, with the shop and owner it belongs to.
create function public.ck_admin_mpesa_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'business_id', l.business_id,
             'shop', b.data ->> 'name',
             'owner_email', u.email,
             'kind', l.data ->> 'kind',
             'shortcode', l.data ->> 'shortcode',
             'name', l.data ->> 'name',
             'status', l.status,
             'admin_note', l.admin_note,
             'changed_at', l.synced_at)
           order by (l.status = 'requested') desc, l.synced_at desc)
    from public.ck_mpesa_links l
    join public.ck_businesses b on b.id = l.business_id
    left join auth.users u on u.id = b.owner_uid), '[]'::jsonb);
end $$;

-- Super admin: move a request along. The note is shown to the shop owner.
create function public.ck_admin_set_mpesa_status(p_business uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ck_is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('requested', 'in_progress', 'active', 'rejected') then
    raise exception 'Unknown status';
  end if;
  update public.ck_mpesa_links
  set status = p_status,
      admin_note = nullif(trim(coalesce(p_note, '')), ''),
      -- Later than anything a phone has sent, so the change is not ignored as "older".
      updated_at = greatest(updated_at + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  where business_id = p_business;
  if not found then
    raise exception 'No request for that shop';
  end if;
end $$;

revoke all on function public.ck_mpesa_guard() from public, anon, authenticated;
revoke all on function public.ck_admin_mpesa_requests(), public.ck_admin_set_mpesa_status(uuid, text, text) from public, anon;
grant execute on function public.ck_admin_mpesa_requests(), public.ck_admin_set_mpesa_status(uuid, text, text) to authenticated;
