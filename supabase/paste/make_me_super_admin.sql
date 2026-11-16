-- CHAPA BIZ: make YOUR login the Super admin.
--
-- First sign up in the Chapa Biz app (Start my business, then back it up to an account).
-- Then paste this into the Supabase SQL Editor, put your email on the line marked below,
-- and press Run.
--
-- It only adds a Chapa Biz login (never a login of the other app in this project), and only if
-- exactly ONE such login has this email. Otherwise it stops and says why, and changes nothing.

do $$
declare
  v_email text := 'PUT-YOUR-EMAIL-HERE';   -- type the email you signed up with, keep the quotes
  v_ids uuid[];
begin
  select array_agg(u.id) into v_ids
  from auth.users u
  where lower(u.email) = lower(v_email)
    and u.raw_app_meta_data ->> 'app' = 'chapa_kazi';

  if v_ids is null then
    raise exception 'No Chapa Biz login with % yet. Sign up in the app first, then run this again.', v_email;
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'More than one Chapa Biz login has %. Nothing changed; ask Claude to look.', v_email;
  end if;

  insert into public.ck_platform_admins (auth_uid, note)
  values (v_ids[1], 'Owner of Chapa Biz (' || v_email || ')')
  on conflict (auth_uid) do nothing;

  raise notice 'Done: % is now Super admin.', v_email;
end $$;

-- Check: should show one row with your email.
select a.auth_uid, u.email, a.added_at
from public.ck_platform_admins a join auth.users u on u.id = a.auth_uid;
