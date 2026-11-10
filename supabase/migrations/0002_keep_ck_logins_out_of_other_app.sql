-- CHAPA KAZI: keep Chapa Kazi logins out of the trillionaire company app's tables.
--
-- Both apps share one pool of logins. Some of the other app's tables can be read by any
-- signed-in user. Every Chapa Kazi login carries the mark  app_metadata.app = 'chapa_kazi'
-- (set by the server when the login is created; a user cannot change it).
--
-- This adds one extra rule to each of the other app's tables: a login with that mark gets
-- nothing. It is a "restrictive" rule, which can only take access away, so the other app's
-- own users see exactly what they saw before.
--
-- Not applied to: ck_ tables (Chapa Kazi's own) and naomi_portfolio_reviews (a public website).
-- To undo: drop the policy named "ck: no Chapa Kazi logins" from each table.

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'ck\_%'
      and c.relname <> 'naomi_portfolio_reviews'
  loop
    execute format(
      'create policy "ck: no Chapa Kazi logins" on public.%I as restrictive for all to authenticated
         using      (coalesce((select auth.jwt()) -> ''app_metadata'' ->> ''app'', '''') <> ''chapa_kazi'')
         with check (coalesce((select auth.jwt()) -> ''app_metadata'' ->> ''app'', '''') <> ''chapa_kazi'')',
      t);
  end loop;
end $$;
