-- =============================================
-- Ski Alpen: the Dagesfuerderung board (28 Nov 2026). ADDITIVE ONLY: a new table, two new functions, one cron job. Idempotent.
-- Run from /Users/Ian/work/ian-site:   supabase db query --linked -f scripts/ski-daily-v1.sql
--
-- Why a new table: public.daily_scores (paket-daily.sql, mtb.sql) holds score rows per (day, user, game) with a check constraint on the game id;
-- the ski board has three KINDS with different meanings, so it gets its own tiny table instead of loosening that constraint.
--
--   ski_daily_scores(day, user_id, value, kind)   unique (day, user_id): one row per player and day. Tiny on the free tier: at most one
--                                                 row per signed-in player per day, rows older than 14 days are purged by a cron job.
--   kind 'time'    value = the run in milliseconds (lower is better); a player's better run of the day replaces his row.
--   kind 'stars' / 'combo'   value = the second of the (Luxembourg) day at which the challenge was completed, taken from the SERVER clock
--                  (the client sends no value): the first to finish is first. The first completion stays.
--
-- Validation (server side, like the score boards: pb/ski/progress.js minRunMs + ski_board_floors, ski_time_floor):
--   * signed in, not a Kart account (assert_not_kart); guests never reach it (the game keeps their challenge local);
--   * the day must be today in Luxembourg (lux_today()), or yesterday during the first ten minutes after midnight (a run that ended just
--     before the turn); never a future or an old day;
--   * 'time': needs the piste's board id (p_board, a ski-<resort>-<piste> row of ski_board_floors, not a park board) and a time between that
--     board's floor (the piste length / 33 m/s: faster is impossible) and the 1 h ceiling the score boards use. The anti-cheat score catcher
--     stays off; these floors and guards stay.
--   * the table is closed to the API (RLS on, no policy, no grants): only the two security-definer functions below touch it.
-- Ski Alpen's own rows: the board's usernames come from public.profiles, like every other board.
-- =============================================

create table if not exists public.ski_daily_scores (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  value integer not null check (value between 0 and 3600000),
  kind text not null check (kind in ('time', 'stars', 'combo')),
  updated_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table public.ski_daily_scores enable row level security;
revoke all on table public.ski_daily_scores from public, anon, authenticated;
create index if not exists ski_daily_scores_board on public.ski_daily_scores (day, kind, value, updated_at);

-- ---------- submit ----------
-- p_day: the player's challenge day; p_kind: 'time' | 'stars' | 'combo'; p_value: the time in ms ('time' only); p_board: 'time' only.
-- Returns true when a row was written (a new row, or a better time).
create or replace function public.ski_daily_submit(p_day date, p_kind text, p_value integer default null, p_board text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public.lux_today();
  local_now timestamp := now() at time zone 'Europe/Luxembourg';
  floor_ms integer;
  v integer;
  affected integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_day is null or p_kind is null or p_kind not in ('time', 'stars', 'combo') then return false; end if;
  if not (p_day = today or (p_day = today - 1 and local_now::time < time '00:10')) then return false; end if;
  if p_kind = 'time' then
    if p_value is null or p_board is null or p_board !~ '^ski-[a-z0-9]+-' or p_board like '%-park' then return false; end if;
    select f.min_ms into floor_ms from public.ski_board_floors f where f.board = p_board;
    if not found or p_value < floor_ms or p_value > 3600000 then return false; end if;
    v := p_value;
  else
    v := case when p_day = today then least(86399, floor(extract(epoch from local_now::time))::integer) else 86399 end;
  end if;
  insert into public.ski_daily_scores(day, user_id, value, kind, updated_at)
  values (p_day, uid, v, p_kind, now())
  on conflict (day, user_id) do update
    set value = excluded.value, updated_at = now()
    where ski_daily_scores.kind = 'time' and excluded.kind = 'time' and excluded.value < ski_daily_scores.value;
  get diagnostics affected = row_count;
  return affected > 0;
end $$;
revoke all on function public.ski_daily_submit(date, text, integer, text) from public, anon;
grant execute on function public.ski_daily_submit(date, text, integer, text) to authenticated;

-- ---------- board ----------
-- The top 10 of a day and kind, plus the caller's row when he is outside them; `total` = how many finished that day.
create or replace function public.ski_daily_board(p_day date default null, p_kind text default 'time')
returns table(rank integer, username text, value integer, is_self boolean, total integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_kind is null or p_kind not in ('time', 'stars', 'combo') then return; end if;
  return query
    with target as (select coalesce(p_day, public.lux_today()) as d),
    ranked as (
      select s.user_id, s.value, (row_number() over (order by s.value, s.updated_at, s.user_id))::integer as position,
             (count(*) over ())::integer as n
        from public.ski_daily_scores s, target t where s.day = t.d and s.kind = p_kind
    )
    select r.position, coalesce(p.username, '?'), r.value, r.user_id = auth.uid(), r.n
      from ranked r left join public.profiles p on p.id = r.user_id
     where r.position <= 10 or r.user_id = auth.uid()
     order by r.position;
end $$;
revoke all on function public.ski_daily_board(date, text) from public, anon;
grant execute on function public.ski_daily_board(date, text) to authenticated;

-- ---------- retention: 14 days (cron.schedule with an existing name updates that job) ----------
do $$
begin
  perform cron.schedule('ski-daily-purge', '29 3 * * *',
    'delete from public.ski_daily_scores where day < public.lux_today() - 14');
exception when others then
  raise notice 'pg_cron job ski-daily-purge not scheduled: %', sqlerrm;
end $$;

-- ---------- check ----------
select (select count(*) from pg_proc where proname in ('ski_daily_submit', 'ski_daily_board')) as functions,
       (select count(*) from cron.job where jobname = 'ski-daily-purge') as purge_job;
