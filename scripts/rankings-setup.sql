-- ===========================================================================
-- Cross-game rankings. Each signed-in player self-reports their own result when
-- a match ends; username is taken authoritatively from their profile (not the
-- client), so results are tied to real accounts. Anonymous players aren't ranked.
-- Covers win/loss games: connect4, battleship, color. (SLF is endless → skipped.)
-- Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

create table if not exists public.game_results (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  username   text not null,
  game       text not null,                       -- 'connect4' | 'battleship' | 'color'
  result     text not null check (result in ('win','loss','draw')),
  created_at timestamptz not null default now()
);
create index if not exists game_results_user_idx on public.game_results(user_id);
alter table public.game_results enable row level security;

-- Public read for the leaderboard (incl. signed-out visitors).
drop policy if exists game_results_read on public.game_results;
create policy game_results_read on public.game_results for select using (true);

-- Record my own result for a finished match. Username comes from my profile.
create or replace function public.record_match(p_game text, p_result text)
returns void language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  if p_result not in ('win','loss','draw') then return; end if;
  if auth.uid() is null then return; end if;
  select username into uname from public.profiles where id = auth.uid();
  if uname is null then return; end if;
  insert into public.game_results (user_id, username, game, result)
  values (auth.uid(), uname, p_game, p_result);
end $$;
grant execute on function public.record_match(text, text) to authenticated;

-- Leaderboard (optionally filtered to one game).
create or replace function public.game_leaderboard(p_game text default null)
returns table(username text, wins int, losses int, draws int, total int, winpct int)
language sql security definer stable set search_path = public as $$
  select r.username,
    count(*) filter (where r.result = 'win')::int,
    count(*) filter (where r.result = 'loss')::int,
    count(*) filter (where r.result = 'draw')::int,
    count(*)::int,
    round(100.0 * count(*) filter (where r.result = 'win') / nullif(count(*), 0))::int
  from public.game_results r
  where p_game is null or r.game = p_game
  group by r.user_id, r.username
  order by count(*) filter (where r.result = 'win') desc,
           round(100.0 * count(*) filter (where r.result = 'win') / nullif(count(*), 0)) desc nulls last
  limit 100;
$$;
grant execute on function public.game_leaderboard(text) to anon, authenticated;
