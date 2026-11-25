-- Traffic log v2 (25 Nov 2026, Ian: "count real visits", "just log everything you can").
--
-- Totals only. Nothing here can be traced back to a person: no session ids, IPs,
-- user agents, regions or user ids are stored. Admin-read through RLS like v1.

-- 1. site_traffic.unique_visitors now holds real VISITS (distinct sessions); the
--    breakdowns (pages, hours, referrer hosts, browsers, systems, countries,
--    screens, bots) go into details. See scripts/fetch_visitors.py.
alter table public.site_traffic
  add column if not exists details jsonb not null default '{}'::jsonb;
grant select (details), insert (details), update (details) on public.site_traffic to traffic_writer;
comment on column public.site_traffic.unique_visitors is
  'Real visits: distinct GoatCounter sessions that day (since 25 Nov 2026, all days recomputed).';

-- 2. Signed-in players per game and day. game_id '*' = distinct accounts over all games.
create table if not exists public.game_players_daily (
  day date not null,
  game_id text not null check (length(game_id) between 1 and 80),
  players integer not null check (players >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, game_id)
);
alter table public.game_players_daily enable row level security;
revoke all on public.game_players_daily from anon, authenticated;
grant select on public.game_players_daily to authenticated;
drop policy if exists game_players_daily_admin_read on public.game_players_daily;
create policy game_players_daily_admin_read on public.game_players_daily
  for select to authenticated using (public.is_admin());
comment on table public.game_players_daily is
  'Accounts with a save or a score per game and Luxembourg day (counts only); filled by cron log-game-players.';

-- Counts the accounts whose save / score changed on p_day. A save only keeps its
-- LAST change, so yesterday's figure shrinks as people play on: greatest() keeps
-- the highest, and the job runs every 15 min plus shortly after midnight.
create or replace function public.log_game_players(p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  with activity as (
    select user_id, game_id, (updated_at at time zone 'Europe/Luxembourg')::date as day from game_saves
    union all
    select user_id, game_id, (saved_at at time zone 'Europe/Luxembourg')::date from game_save_history
    union all
    -- one board per piste / level would list hundreds of games: "ski-killy-x" counts as ski
    select user_id, case when game_id like 'ski-%' then 'ski' else game_id end,
           (updated_at at time zone 'Europe/Luxembourg')::date
      from scores
  ), counted as (
    select day, game_id, count(distinct user_id)::int as players
      from activity where day = p_day and user_id is not null and length(game_id) between 1 and 80
     group by day, game_id
    union all
    select day, '*', count(distinct user_id)::int
      from activity where day = p_day and user_id is not null group by day
  )
  insert into game_players_daily as t (day, game_id, players)
  select day, game_id, players from counted
  on conflict (day, game_id) do update
     set players = greatest(t.players, excluded.players), updated_at = now()
   where excluded.players > t.players;
$$;
revoke all on function public.log_game_players(date) from public, anon, authenticated;

select cron.schedule('log-game-players', '*/15 * * * *', $job$
  select public.log_game_players((now() at time zone 'Europe/Luxembourg')::date);
  select public.log_game_players((now() at time zone 'Europe/Luxembourg')::date - 1);
$job$);

-- Backfill: a lower bound (old days only know what the save history kept).
select public.log_game_players(d::date)
  from generate_series((now() at time zone 'Europe/Luxembourg')::date - 150,
                       (now() at time zone 'Europe/Luxembourg')::date, interval '1 day') d;
