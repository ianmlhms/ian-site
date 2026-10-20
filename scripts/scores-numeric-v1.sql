-- Leaderboard scores as double precision (20 Oct 2026). REVIEW AND APPLY MANUALLY; never run by the client.
--
-- Why: scores.score, weekly_scores.score and daily_scores.score were bigint (max 9.22e18) and the client
-- ignored everything above 2^53 (9.007e15). Cookie Clicker and Business Empire now reach 1e25 and far beyond
-- (lifetime earnings of 1e150 exist in saves), so every board must hold any finite score up to 1e300.
--
-- double precision vs numeric:
--   * Every score is produced by JavaScript, i.e. it already IS an IEEE double. float8 stores it losslessly;
--     numeric would only add digits no client can ever send or read back.
--   * Integers are exact up to 2^53 = 9.007e15. The largest stored score today is 8.73e15 (Business Empire),
--     every other board stays below 2e6, so the bigint -> float8 conversion changes no existing value.
--     Kart Letzebuerg (1,000,000 - ms), Geometry Dash and the reaction times are small exact integers.
--   * Ordering, the keep-best trigger, row_number() and `order by -score` are plain float8 compares (fast, small
--     btree). numeric is several times slower to compare and its index is bigger.
--   * JSON transport: PostgREST writes a float8 as a normal JSON number ("1.5e+45", valid JSON) and PG17 prints the
--     shortest text that round-trips, so JavaScript reads back exactly what it sent. numeric would be returned as a
--     300-digit literal.
--   * Cheating guard: float8 accepts the strings 'NaN' and 'Infinity' (PostgREST casts JSON strings), which sort ABOVE
--     every number. The range check below refuses them (in PG, NaN > 1e300 and Infinity > 1e300).
--
-- Everything that touches these columns (found in pg_proc / pg_depend / pg_views, read-only):
--   tables      scores, weekly_scores, daily_scores         -> column type (indexes scores_game_idx and
--                                                              daily_scores_board are rebuilt by the ALTER)
--   functions   merge_score_is_better(text,bigint,bigint)   -> replaced by (text,float8,float8)
--               submit_weekly_score(text,bigint)            -> replaced by (text,float8), cap 1e15 -> 1e300
--               weekly_board(date), daily_board(text,date)  -> return type changes, so drop + create
--   triggers    scores_keep_best, reaction_score_floor      -> same bodies, re-created only to flush cached plans (step 8)
--   callers     submit_daily_score, merge_accounts          -> same bodies, resolve merge_score_is_better at run time;
--                                                              search_path re-set only to flush cached plans (step 8)
--   not touched leaderboard_tags (calls weekly_board, reads rank/user_id only), game_leaderboard*, record_match,
--               record_kart_race, record_wordle, wordle_leaderboard, admin_delete_user (win/loss tables or cascades).
--   views/policies: none reference score.
-- Rolling back is only lossless while no score is above 9.22e18.

begin;

-- 1) The comparison, in the new type. Both overloads coexist until the end, so nothing breaks half-way.
create or replace function public.merge_score_is_better(p_game text, p_new double precision, p_old double precision)
returns boolean language sql immutable as $$
  select case when p_game in ('memory', 'maze', 'reaction') then p_new < p_old else p_new > p_old end
$$;
revoke all on function public.merge_score_is_better(text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.merge_score_is_better(text, double precision, double precision) to service_role;

-- 2) The columns. Existing values are converted exactly (all are below 2^53). daily_scores keeps its
--    check (score between 0 and 1000000).
alter table public.scores        alter column score type double precision using score::double precision;
alter table public.weekly_scores alter column score type double precision using score::double precision;
alter table public.daily_scores  alter column score type double precision using score::double precision;

-- 3) Range guard: finite and within +-1e300 (NaN and Infinity compare as larger than 1e300, so they fail).
alter table public.scores        drop constraint if exists scores_score_range;
alter table public.scores        add constraint scores_score_range check (score between -1e300 and 1e300);
alter table public.weekly_scores drop constraint if exists weekly_scores_score_range;
alter table public.weekly_scores add constraint weekly_scores_score_range check (score between -1e300 and 1e300);

-- 4) Weekly submit: new parameter type, the 1e15 sanity cap becomes the same 1e300 as everywhere.
drop function if exists public.submit_weekly_score(text, bigint);
create or replace function public.submit_weekly_score(p_game text, p_score double precision)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk date := public.arcade_week_start();
  old_score double precision;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  if p_game is distinct from public.weekly_game(wk) or p_score is null
     or p_score < 0 or p_score > 1e300 then
    return false;
  end if;
  select score into old_score from public.weekly_scores where week = wk and user_id = uid for update;
  if old_score is not null and not public.merge_score_is_better(p_game, p_score, old_score) then
    return false;
  end if;
  insert into public.weekly_scores (week, user_id, game_id, username, score, updated_at)
  values (wk, uid, p_game, (select username from public.profiles where id = uid), p_score, now())
  on conflict (week, user_id) do update
    set score = excluded.score, username = excluded.username, updated_at = now();
  return true;
end $$;
revoke all on function public.submit_weekly_score(text, double precision) from public, anon;
grant execute on function public.submit_weekly_score(text, double precision) to authenticated;

-- 5) Weekly board: same body, score is float8 now.
drop function if exists public.weekly_board(date);
create function public.weekly_board(p_week date default null)
returns table (week date, game_id text, ends_at timestamptz, rank int, user_id uuid, username text, score double precision)
language sql stable security definer set search_path = public as $$
  select public.assert_not_kart();
  with wk as (select public.arcade_week_start(p_week) as d)
  select wk.d,
         public.weekly_game(wk.d),
         ((wk.d + 7)::timestamp at time zone 'Europe/Luxembourg'),
         (row_number() over (order by case when public.weekly_game(wk.d) in ('memory', 'maze', 'reaction')
                                           then s.score else -s.score end, s.updated_at))::int,
         s.user_id,
         coalesce(p.username, s.username),
         s.score
    from wk
    left join public.weekly_scores s on s.week = wk.d
    left join public.profiles p on p.id = s.user_id
   order by 4
   limit 20;
$$;
revoke all on function public.weekly_board(date) from public, anon;
grant execute on function public.weekly_board(date) to authenticated;

-- 6) Daily board (Paket Express daily route): same body, score is float8 now. submit_daily_score keeps its
--    bigint parameter (the daily cap is 1,000,000 and the values are whole numbers); the assignment to the
--    float8 column is implicit.
drop function if exists public.daily_board(text, date);
create function public.daily_board(p_game text, p_day date default null)
returns table(day date, game_id text, ends_at timestamptz, rank integer,
              user_id uuid, username text, score double precision, is_self boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_game is distinct from 'paket-express-daily' then return; end if;
  return query
    with target as (select coalesce(p_day,public.lux_today()) as d),
    ranked as (
      select s.*, (row_number() over(order by s.score desc, s.updated_at, s.user_id))::integer as position
      from public.daily_scores s, target t where s.day = t.d and s.game_id = p_game
    )
    select t.d, p_game, ((t.d + 1)::timestamp at time zone 'Europe/Luxembourg'),
           r.position, r.user_id, coalesce(p.username,r.username), r.score, coalesce(r.user_id = auth.uid(),false)
    from target t
    left join ranked r on r.position <= 20 or r.user_id = auth.uid()
    left join public.profiles p on p.id = r.user_id
    order by r.position nulls last;
end $$;
revoke all on function public.daily_board(text, date) from public, anon;
grant execute on function public.daily_board(text, date) to authenticated;

-- 7) The old comparison is no longer referenced (scores_keep_best, merge_accounts, submit_* resolve at run time).
drop function if exists public.merge_score_is_better(text, bigint, bigint);

-- 8) Force every database connection to recompile the plpgsql functions that read the changed columns.
--    A connection that already ran them holds a cached plan with the old bigint parameter type and would fail with
--    "type of parameter ... does not match that when preparing the plan" until it reconnects. Any change to the
--    function's pg_proc row makes PostgreSQL recompile it on the next call: the two triggers are re-created with
--    their current bodies, merge_accounts and submit_daily_score only get their existing search_path set again.
create or replace function public.scores_keep_best()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.merge_score_is_better(new.game_id, new.score, old.score)
     and new.score is distinct from old.score then
    new.score := old.score;
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

create or replace function public.reaction_score_floor()
returns trigger language plpgsql as $$
begin
  if new.game_id = 'reaction' and new.score < 100 then
    return null;  -- skip the insert/update silently, keep the old row
  end if;
  return new;
end $$;

alter function public.merge_accounts(uuid, text) set search_path = public;
alter function public.submit_daily_score(text, bigint) set search_path = public;

commit;

notify pgrst, 'reload schema';
