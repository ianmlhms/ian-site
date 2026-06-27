-- ===========================================================================
-- Friends activity feed. Returns recent game results for me + my accepted
-- friends, newest first. Read-only, security definer (so it can see friends'
-- rows under RLS), capped at 100. Paste into Supabase ▸ SQL Editor ▸ Run.
-- Idempotent. Depends on: game_results (rankings-setup.sql) and friendships
-- (social-games-setup.sql).
-- ===========================================================================

create or replace function public.friends_activity(p_limit int default 30)
returns table(username text, game text, result text, created_at timestamptz, is_me boolean)
language sql security definer stable set search_path = public as $$
  with circle as (
    select auth.uid() as id
    union
    select (case when f.requester = auth.uid() then f.addressee else f.requester end)
    from public.friendships f
    where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  )
  select r.username, r.game, r.result, r.created_at, (r.user_id = auth.uid()) as is_me
  from public.game_results r
  join circle c on c.id = r.user_id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;
grant execute on function public.friends_activity(int) to authenticated;
