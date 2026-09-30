-- ==========================================
-- 30 Sep 2026: keep the account's username
-- (auth user_metadata) equal to the profile.
-- handle_new_user suffixes a taken name
-- ("Emma" -> "Emma2") in profiles, but the
-- metadata kept "Emma", so the header and
-- games said Emma while messages said Emma2.
-- 9 of 110 accounts were affected.
-- Safe to re-run.
-- ==========================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare base text; cand text; n int := 0;
begin
  base := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1), 'user');
  cand := base;
  while exists (select 1 from public.profiles
                where lower(username) = lower(cand)) loop
    n := n + 1; cand := base || n::text;
  end loop;
  insert into public.profiles (id, username)
    values (new.id, cand)
    on conflict (id) do nothing;
  -- Write the final name back, so every page
  -- shows the same username.
  update auth.users
     set raw_user_meta_data =
       coalesce(raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object('username', cand)
   where id = new.id;
  return new;
end $$;

-- One-off repair of existing mismatches.
update auth.users u
   set raw_user_meta_data =
     coalesce(u.raw_user_meta_data, '{}'::jsonb)
     || jsonb_build_object('username', p.username)
  from public.profiles p
 where p.id = u.id
   and coalesce(u.raw_user_meta_data->>'username', '')
       <> p.username;

select count(*) as still_mismatched
  from public.profiles p
  join auth.users u on u.id = p.id
 where coalesce(u.raw_user_meta_data->>'username', '')
       <> p.username;
