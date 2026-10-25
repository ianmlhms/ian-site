-- MTB Mëllerdall (arcade game id 'mtb'): the daily challenge board. REVIEW AND APPLY MANUALLY; never run by the client (nor by the builder).
--
-- What needs SQL and what does not:
--   * Trail boards (mtb-<trail id>) and the overall board (mtb) need NO SQL: the arcade's generic score path (scores table, keep-best trigger) accepts any board id that starts with the
--     game id, and a trail time is stored as 10,000,000 - milliseconds (a faster time is a HIGHER score, merge_score_is_better is higher-is-better for every game id outside its short list).
--   * Game saves (game_saves, jsonb <= 8192 bytes) need NO SQL: the save is one small record (about 2-7 KB) with a monotone numeric `tb` that the existing game_saves_keep_progress trigger uses.
--   * The DAILY board needs this file: daily_scores / submit_daily_score / daily_board only know the game id 'paket-express-daily' (check constraint, function bodies, score cap 1,000,000).
--     The arcade's RPC whitelist (pixelbreak-records.js) already allows submit_daily_score and daily_board; pb/mtb/save.js dailyRpc() calls them with p_game = 'mtb-daily'.
-- Requires: paket-daily.sql and scores-numeric-v1.sql applied (daily_scores.score is double precision), lux_today(), assert_not_kart(), merge_score_is_better(text, float8, float8).
-- Score of a daily run = 10,000,000 - milliseconds (a run of 1 s .. 2 h), so the cap for mtb-daily is 10,000,000; paket-express-daily keeps its cap of 1,000,000.

begin;

-- 1) the table accepts both game ids
alter table public.daily_scores drop constraint if exists daily_scores_game_id_check;
alter table public.daily_scores add constraint daily_scores_game_id_check check (game_id in ('paket-express-daily', 'mtb-daily'));
alter table public.daily_scores drop constraint if exists daily_scores_score_check;
alter table public.daily_scores add constraint daily_scores_score_check check (
  (game_id = 'paket-express-daily' and score between 0 and 1000000) or (game_id = 'mtb-daily' and score between 0 and 10000000));

-- 2) submit: one function for both games
create or replace function public.submit_daily_score(p_game text, p_score bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  affected integer;
  cap bigint;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  cap := case p_game when 'paket-express-daily' then 1000000 when 'mtb-daily' then 10000000 else null end;
  if cap is null or p_score is null or p_score < 0 or p_score > cap then return false; end if;
  insert into public.daily_scores(day, user_id, game_id, username, score, updated_at)
  values(public.lux_today(), uid, p_game, (select username from public.profiles where id = uid), p_score, now())
  on conflict (day, user_id, game_id) do update
    set score = excluded.score, username = excluded.username, updated_at = excluded.updated_at
    where public.merge_score_is_better(p_game, excluded.score, daily_scores.score);
  get diagnostics affected = row_count;
  return affected > 0;
end $$;
revoke all on function public.submit_daily_score(text, bigint) from public, anon;
grant execute on function public.submit_daily_score(text, bigint) to authenticated;

-- 3) board: top 20 plus the caller's row
drop function if exists public.daily_board(text, date);
create function public.daily_board(p_game text, p_day date default null)
returns table(day date, game_id text, ends_at timestamptz, rank integer,
              user_id uuid, username text, score double precision, is_self boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.assert_not_kart();
  if p_game is null or p_game not in ('paket-express-daily', 'mtb-daily') then return; end if;
  return query
    with target as (select coalesce(p_day, public.lux_today()) as d),
    ranked as (
      select s.*, (row_number() over(order by s.score desc, s.updated_at, s.user_id))::integer as position
      from public.daily_scores s, target t where s.day = t.d and s.game_id = p_game
    )
    select t.d, p_game, ((t.d + 1)::timestamp at time zone 'Europe/Luxembourg'),
           r.position, r.user_id, coalesce(p.username, r.username), r.score, coalesce(r.user_id = auth.uid(), false)
    from target t
    left join ranked r on r.position <= 20 or r.user_id = auth.uid()
    left join public.profiles p on p.id = r.user_id
    order by r.position nulls last;
end $$;
revoke all on function public.daily_board(text, date) from public, anon;
grant execute on function public.daily_board(text, date) to authenticated;

commit;
