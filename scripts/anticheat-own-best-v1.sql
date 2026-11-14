-- =============================================
-- Anti-cheat: compare with your OWN best when you are
-- already #1 (14 Nov 2026).
-- Bug: catch_suspicious_score / catch_suspicious_weekly
-- compared a new #1 score with the best score of OTHER
-- players. A player already far ahead got banned on their
-- next normal improvement (ILikeFemboys, bus-tycoon: 1.2x
-- their own best but "4.6x the old #1"; gigidalessio,
-- cookie-clicker: 1.1x their own best but "3.8x").
-- Now: if the player's previous score already beats or ties
-- every other player, the jump is measured against that
-- previous score. The young-account rule is unchanged.
-- Replaces the versions in security-hardening-v3.sql and
-- weekly-anticheat-v1.sql. Idempotent.
-- =============================================

-- Shared decision: the reason to catch, or null.
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

-- Flag + ban + notice + Slack. Shared by both triggers.
create or replace function public.punish_suspicious(
  p_user uuid, p_game text, p_username text,
  p_score double precision, p_prev double precision,
  p_prev_user text, p_why text, p_where text)
returns void language plpgsql security definer
set search_path = public as $$
declare fid bigint; tok text; chan text;
begin
  insert into public.score_flags
    (user_id, game_id, username, score, prev_best,
     prev_user, reason)
  values (p_user, p_game, p_username, p_score, p_prev,
          p_prev_user, case when p_where = 'weekly'
            then 'weekly: ' || p_why else p_why end)
  returning id into fid;
  insert into public.leaderboard_bans (user_id, reason)
  values (p_user, format('caught %sscore #%s: %s %s (%s)',
    case when p_where = 'weekly' then 'weekly ' else '' end,
    fid, p_game, p_score, p_why))
  on conflict do nothing;
  insert into public.user_notices (user_id, title, body)
  select p_user,
    jsonb_build_object('lb', 'Haha, du hues also awer probéiert',
      'de', 'Haha, du hues also awer probéiert',
      'en', 'Haha, du hues also awer probéiert'),
    jsonb_build_object('lb', '', 'de', '', 'en', '')
  where not exists (select 1 from public.user_notices n
    where n.user_id = p_user and n.seen_at is null
      and n.title->>'lb' = 'Haha, du hues also awer probéiert');
  begin
    select decrypted_secret into tok from vault.decrypted_secrets
     where name = 'slack_bot_token';
    select decrypted_secret into chan from vault.decrypted_secrets
     where name = 'slack_claude_channel';
    if tok is not null and chan is not null then
      perform net.http_post(
        url := 'https://slack.com/api/chat.postMessage',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || tok),
        body := jsonb_build_object('channel', chan,
          'text', format(E'⚠️ Score-Fuddler %s gefaangen (#%s)\n*%s* – %s: %s\nVirdrun #1: %s mat %s\nWisou: %s\nScore net gespäichert, Kont vun de Leaderboards gebannt.',
            case when p_where = 'weekly'
              then 'am Spill vun der Woch' else 'op ian.lu' end,
            fid, coalesce(p_username, '?'), p_game, p_score,
            coalesce(p_prev_user, '?'), p_prev, p_why)));
    end if;
  exception when others then
    raise warning 'score catch alert failed: %', sqlerrm;
  end;
end $$;
revoke all on function public.punish_suspicious(
  uuid, text, text, double precision, double precision,
  text, text, text)
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
  if tg_op = 'UPDATE' then own_prev := old.score; end if;
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
  if tg_op = 'UPDATE' then own_prev := old.score; end if;
  why := public.suspicious_reason(new.game_id, new.user_id,
    new.score, own_prev, prev, others, 'weekly #1');
  if why is null then return new; end if;
  perform public.punish_suspicious(new.user_id, new.game_id,
    new.username, new.score, prev, prev_name, why, 'weekly');
  if tg_op = 'UPDATE' then return old; end if;
  return null;
end $$;

-- ---------- one-off repairs (applied 14 Nov 2026) ----------
-- The two false positives of the old rule: unban, restore the
-- score that was dropped, remove the notice and the flag.
delete from public.leaderboard_bans b using public.profiles p
 where p.id = b.user_id
   and p.username in ('ILikeFemboys', 'gigidalessio');
update public.scores s set score = greatest(s.score, 179662605422)
  from public.profiles p
 where p.id = s.user_id and p.username = 'ILikeFemboys'
   and s.game_id = 'bus-tycoon';
update public.scores s
   set score = greatest(s.score, 9815707844256620000)
  from public.profiles p
 where p.id = s.user_id and p.username = 'gigidalessio'
   and s.game_id = 'cookie-clicker';
delete from public.user_notices n using public.profiles p
 where p.id = n.user_id
   and p.username in ('ILikeFemboys', 'gigidalessio')
   and n.title->>'lb' = 'Haha, du hues also awer probéiert';
delete from public.score_flags f using public.profiles p
 where p.id = f.user_id
   and p.username in ('ILikeFemboys', 'gigidalessio');
-- ILikeFemboys' weekly Crossy Road run (181, 12 Nov), removed
-- by weekly-anticheat-v1 while the account was wrongly banned.
insert into public.weekly_scores
  (week, user_id, game_id, username, score, updated_at)
select '2026-11-09', p.id, 'crossy-road', p.username, 181,
       '2026-11-12 08:14:44.280304+00'
  from public.profiles p where p.username = 'ILikeFemboys'
on conflict (week, user_id) do nothing;
-- hermesreal (@owl.serlo.lu, 13 Nov 05:26) = the account-script
-- player behind dengens: delete it.
delete from auth.users u using public.profiles p
 where p.id = u.id and p.username = 'hermesreal'
   and u.email ilike '%@owl.serlo.lu';
