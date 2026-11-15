-- =============================================
-- Anti-cheat: idle games + upserts (15 Nov 2026).
-- Three real Cookie Clicker players were caught on 14-15 Nov
-- (gigidalessio, Benji, traktupel): their save history shows
-- steady idle growth of 2-3x a day, so a 1.5x jump between two
-- saves is normal in idle games.
-- 1. Idle games (idle-empire, cookie-clicker, bus-tycoon,
--    park) skip the 1.5x rule. The young-account rule stays.
-- 2. Games save with an upsert (insert ... on conflict do
--    update). The BEFORE INSERT trigger runs first, without
--    OLD, so "own best" was always null and a player already
--    at #1 was compared with the others (Benji). Now the
--    trigger reads the player's own stored row.
-- 3. One-off: unban the three, restore the dropped scores,
--    remove the notices and flags.
-- Replaces the versions in anticheat-own-best-v1.sql.
-- Idempotent.
-- =============================================

create or replace function public.is_idle_game(p_game text)
returns boolean language sql immutable as $$
  select p_game in ('idle-empire', 'cookie-clicker', 'bus-tycoon', 'park')
$$;

create or replace function public.suspicious_reason(
  p_game text, p_user uuid, p_score double precision,
  p_own_prev double precision, p_others_best double precision,
  p_others int, p_label text)
returns text language plpgsql stable security definer
set search_path = public as $$
declare
  c_factor constant double precision := 1.5;
  c_min_others constant int := 3;
  c_young constant interval := interval '1 day';
  lower_better boolean :=
    not public.merge_score_is_better(p_game, 2, 1);
  already_first boolean;
  base double precision;
  ratio double precision;
  acct_age interval;
  why text;
begin
  if p_others < c_min_others or p_others_best is null
     or not public.merge_score_is_better(
       p_game, p_score, p_others_best) then
    return null;   -- not a new #1
  end if;
  -- Idle games grow several times a day on their own.
  if not public.is_idle_game(p_game) then
    already_first := p_own_prev is not null
      and not public.merge_score_is_better(
        p_game, p_others_best, p_own_prev);
    base := case when already_first then p_own_prev
                 else p_others_best end;
    if base > 0 and p_score > 0 then
      ratio := case when lower_better then base / p_score
                    else p_score / base end;
      if ratio > c_factor then
        why := format('%sx %s', round(ratio::numeric, 1),
          case when already_first then 'their own best'
               else 'the old ' || p_label end);
      end if;
    end if;
  end if;
  select now() - u.created_at into acct_age
    from auth.users u where u.id = p_user;
  if acct_age < c_young then
    why := concat_ws(', ', why, 'account '
      || greatest(1, extract(epoch from acct_age)::int / 3600)
      || ' h old');
  end if;
  return why;
end $$;
revoke all on function public.suspicious_reason(
  text, uuid, double precision, double precision,
  double precision, int, text)
  from public, anon, authenticated;

-- ---------- all-time boards (scores) ----------
create or replace function public.catch_suspicious_score()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  lower_better boolean :=
    not public.merge_score_is_better(new.game_id, 2, 1);
  prev double precision; prev_name text; others int;
  own_prev double precision; why text;
begin
  if tg_op = 'UPDATE'
     and new.score is not distinct from old.score then
    return new;
  end if;
  if exists (select 1 from public.admin_user_ids() a
             where a.user_id = new.user_id) then
    return new;
  end if;
  select count(*) into others from public.scores
   where game_id = new.game_id and user_id <> new.user_id;
  select s.score, s.username into prev, prev_name
    from public.scores s
   where s.game_id = new.game_id and s.user_id <> new.user_id
   order by case when lower_better then s.score end asc,
            case when not lower_better then s.score end desc
   limit 1;
  -- An upsert reaches here as INSERT: read the stored row.
  if tg_op = 'UPDATE' then
    own_prev := old.score;
  else
    select s.score into own_prev from public.scores s
     where s.game_id = new.game_id and s.user_id = new.user_id;
  end if;
  why := public.suspicious_reason(new.game_id, new.user_id,
    new.score, own_prev, prev, others, '#1');
  if why is null then return new; end if;
  perform public.punish_suspicious(new.user_id, new.game_id,
    new.username, new.score, prev, prev_name, why, 'scores');
  if tg_op = 'UPDATE' then return old; end if;
  return null;
end $$;

-- ---------- weekly board (weekly_scores) ----------
create or replace function public.catch_suspicious_weekly()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  lower_better boolean :=
    not public.merge_score_is_better(new.game_id, 2, 1);
  prev double precision; prev_name text; others int;
  own_prev double precision; why text;
begin
  if tg_op = 'UPDATE'
     and new.score is not distinct from old.score then
    return new;
  end if;
  if exists (select 1 from public.admin_user_ids() a
             where a.user_id = new.user_id) then
    return new;
  end if;
  select count(*) into others from public.weekly_scores
   where week = new.week and game_id = new.game_id
     and user_id <> new.user_id;
  select s.score, s.username into prev, prev_name
    from public.weekly_scores s
   where s.week = new.week and s.game_id = new.game_id
     and s.user_id <> new.user_id
   order by case when lower_better then s.score end asc,
            case when not lower_better then s.score end desc
   limit 1;
  if tg_op = 'UPDATE' then
    own_prev := old.score;
  else
    select s.score into own_prev from public.weekly_scores s
     where s.week = new.week and s.user_id = new.user_id
       and s.game_id = new.game_id;
  end if;
  why := public.suspicious_reason(new.game_id, new.user_id,
    new.score, own_prev, prev, others, 'weekly #1');
  if why is null then return new; end if;
  perform public.punish_suspicious(new.user_id, new.game_id,
    new.username, new.score, prev, prev_name, why, 'weekly');
  if tg_op = 'UPDATE' then return old; end if;
  return null;
end $$;

-- ---------- one-off repairs (applied 15 Nov 2026) ----------
-- Unban FIRST: drop_banned_score blocks score updates of a
-- banned account. Then restore each dropped score (from the
-- flags/ban reasons), then remove the notices and flags.
delete from public.leaderboard_bans b using public.profiles p
 where p.id = b.user_id
   and p.username in ('gigidalessio', 'Benji', 'traktupel')
   and b.reason like 'caught score #% cookie-clicker %';
update public.scores s set score = greatest(s.score, v.sc)
  from (values ('gigidalessio', 1.89971520797608e19::float8),
               ('Benji', 2.04875405935176e19),
               ('traktupel', 1.60904820160973e19)) v(u, sc)
  join public.profiles p on p.username = v.u
 where s.user_id = p.id and s.game_id = 'cookie-clicker';
delete from public.user_notices n using public.profiles p
 where p.id = n.user_id
   and p.username in ('gigidalessio', 'Benji', 'traktupel')
   and n.created_at >= '2026-11-14'
   and n.title->>'lb' = 'Haha, du hues also awer probéiert';
delete from public.score_flags f using public.profiles p
 where p.id = f.user_id
   and p.username in ('gigidalessio', 'Benji', 'traktupel')
   and f.game_id = 'cookie-clicker'
   and f.created_at >= '2026-11-14';
