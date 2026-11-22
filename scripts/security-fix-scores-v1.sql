-- =============================================================
-- security-fix-scores-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-scores-v1.sql
-- Idempotent. No client change needed.
--
-- What it closes
-- 1. HIGH  Anti-cheat bypass by renaming a score row. The catch trigger
--    (zz_catch_suspicious_score) and scores_keep_best both return early
--    when the SCORE did not change, and policy "scores update own" lets a
--    player PATCH any column of his own row, also game_id:
--      POST  /rest/v1/scores  {"user_id":me,"game_id":"zz-x","score":99999999}
--            -> a board nobody else is on: fewer than 3 others, never checked
--      PATCH /rest/v1/scores?user_id=eq.me&game_id=eq.zz-x  {"game_id":"tetris"}
--            -> score unchanged: no check, no flag, no ban, straight to #1
--    (If he already has a tetris row he first renames that one away.)
--      -> game_id (and game_name) of an existing row can no longer change.
-- 2. MEDIUM  scores.game_id / game_name and game_saves.game_id are free
--    text without any limit and a player may add as many rows as he
--    wants (8 KB per save): junk boards, and a script can fill the
--    database (95 MB of 500 MB used today).
--      -> game_id must look like a game id, game_name max 80 characters,
--         at most 300 score rows and 150 save rows per player
--         (today: 74 games exist, the busiest player has 57 / 13 rows).
-- 3. MEDIUM  record_match(p_game, p_result) is callable in a loop with
--    any text: unlimited "wins" on the multiplayer win boards
--    (game_leaderboard) and unlimited rows.
--      -> game id shape, at most 6 results a minute and 300 a day.
--
-- How it could break something
-- * A game whose id does not match ^[a-z0-9][a-z0-9_-]{0,47}$ would
--   silently stop saving scores / saves. Every id in the tables today
--   matches (checked 15 Nov: 0 exceptions in scores, game_saves,
--   game_results). New games: lower case, digits, "-" and "_", <= 48.
-- * Rejected rows are skipped silently (same style as the other score
--   triggers): the request succeeds, nothing is written.
-- * record_match: more than 6 finished multiplayer rounds within one
--   minute are not counted (highest ever seen: 1 a minute, 2 a day).
-- * merge_accounts() only changes user_id / score, never game_id: fine.
--
-- NOT fixed here (by design of the site, needs Ian's decision):
-- * Idle boards (idle-empire, cookie-clicker, bus-tycoon, park) and all
--   webcam-* boards skip the 1.5x rule since today, so any account older
--   than one day can post any score up to 1e300 there.
-- * On every board a score below #1, or up to 1.5x the #1 (again and
--   again), is accepted: the games run in the browser.
-- =============================================================

-- ---------- 1 + 2. scores ----------
-- >>> scores_guard_row (scripts/ski/make_sql.py copies this block into ski-v1.sql: edit it HERE, then re-run make_sql.py)
-- Ski Alpen (ski-v1.sql, security review H2 22 Nov 2026): 1356 per-piste boards would hit the 300-row cap and silently stop every
-- game's saves. Once public.ski_board_floors exists, a ski-* row is allowed only for a board listed there and ski-* rows do not count
-- towards the 300. Before that table exists (ski-v1.sql not applied) ski-* ids are ordinary games. Safe to re-run in any order.
create or replace function public.scores_guard_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_rows constant integer := 300;
  c_max_name constant integer := 80;
  has_ski boolean := to_regclass('public.ski_board_floors') is not null;
begin
  if tg_op = 'UPDATE' then
    -- a score belongs to the game it was made in
    new.game_id := old.game_id;
    new.game_name := left(coalesce(new.game_name, old.game_name), c_max_name);
    return new;
  end if;
  if new.game_id is null
     or new.game_id !~ '^[a-z0-9][a-z0-9_-]{0,47}$' then
    return null;
  end if;
  new.game_name := left(new.game_name, c_max_name);
  -- An upsert of an existing row also passes here: only NEW boards count.
  if exists (select 1 from public.scores s
              where s.user_id = new.user_id
                and s.game_id = new.game_id) then
    return new;
  end if;
  if has_ski and new.game_id like 'ski-%' then
    if not exists (select 1 from public.ski_board_floors f where f.board = new.game_id) then
      return null;
    end if;
    return new;
  end if;
  if (select count(*) from public.scores s
       where s.user_id = new.user_id
         and (not has_ski or s.game_id not like 'ski-%')) >= c_max_rows then
    return null;
  end if;
  return new;
end $function$;

-- "aa_" so it runs before every other BEFORE trigger on scores.
drop trigger if exists aa_scores_guard_row on public.scores;
create trigger aa_scores_guard_row
  before insert or update on public.scores
  for each row execute function public.scores_guard_row();
-- <<< scores_guard_row

-- ---------- 2. game_saves ----------
create or replace function public.game_saves_guard_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_rows constant integer := 150;
begin
  if new.game_id is null
     or new.game_id !~ '^[a-z0-9][a-z0-9_-]{0,47}$' then
    return null;
  end if;
  if not exists (select 1 from public.game_saves s
                  where s.user_id = new.user_id
                    and s.game_id = new.game_id)
     and (select count(*) from public.game_saves s
           where s.user_id = new.user_id) >= c_max_rows then
    return null;
  end if;
  return new;
end $function$;

drop trigger if exists aa_game_saves_guard_row on public.game_saves;
create trigger aa_game_saves_guard_row
  before insert on public.game_saves
  for each row execute function public.game_saves_guard_row();

-- ---------- 3. record_match ----------
create or replace function public.record_match(p_game text, p_result text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_per_minute constant integer := 6;
  c_per_day constant integer := 300;
  uid uuid := auth.uid();
  uname text;
  last_minute integer;
  last_day integer;
begin
  perform public.assert_not_kart();
  if p_result is null or p_result not in ('win', 'loss', 'draw') then return; end if;
  if uid is null then return; end if;
  if p_game is null or p_game !~ '^[a-z0-9][a-z0-9_-]{0,47}$' then return; end if;
  select username into uname from public.profiles where id = uid;
  if uname is null then return; end if;
  select count(*) filter (where r.created_at > now() - interval '1 minute'),
         count(*)
    into last_minute, last_day
    from public.game_results r
   where r.user_id = uid
     and r.created_at > now() - interval '24 hours';
  if last_minute >= c_per_minute or last_day >= c_per_day then return; end if;
  insert into public.game_results (user_id, username, game, result)
  values (uid, uname, p_game, p_result);
end $function$;

-- ---------- check ----------
select c.relname as table_name, t.tgname as trigger_name
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname in ('aa_scores_guard_row', 'aa_game_saves_guard_row')
 order by 1;
