-- CHAPA KAZI: let an owner read back a shop in the same step that creates it.
--
-- Found while testing sync: saving a new shop and reading it back in one request was refused,
-- because the "which shops are mine?" helper cannot yet see a shop that is still being saved.
-- Checking the owner column directly fixes that. Access is unchanged: an owner could already
-- read their own shops.

drop policy ck_businesses_read on public.ck_businesses;
create policy ck_businesses_read on public.ck_businesses for select to authenticated
  using (owner_uid = (select auth.uid()) or id in (select public.ck_my_business_ids()));
