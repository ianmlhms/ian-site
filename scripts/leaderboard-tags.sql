-- Leaderboard name tags (👑 Admin + school class, like in the messenger) and the
-- owner's id for the pinned "Admin" row. Signed-in full accounts only.
create or replace function public.leaderboard_tags()
returns table(user_id uuid, username text, class text, is_admin boolean, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select public.assert_not_kart();
  select p.id,
         p.username,
         nullif(btrim(p.class), ''),
         exists (select 1 from public.admin_user_ids() a where a.user_id = p.id),
         p.id = public.owner_user_id()
  from public.profiles p
  where p.account_kind = 'full' and p.username is not null;
$$;
revoke all on function public.leaderboard_tags() from public, anon;
grant execute on function public.leaderboard_tags() to authenticated;
