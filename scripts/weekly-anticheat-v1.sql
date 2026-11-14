-- =============================================
-- Weekly board anti-cheat v1 (14 Nov 2026).
-- The "Spill vun der Woch" board reads weekly_scores, which
-- only had drop_banned_score: catch_suspicious_score (on
-- scores) never saw weekly runs, so a fake account put 1e300
-- and another 1,000,000 on the weekly Crossy Road board.
-- Same rule as on scores: a new weekly #1 that is >1.5x the
-- old #1, or comes from an account younger than a day, is
-- dropped, the account is banned from the boards, gets the
-- notice, and #claude gets a Slack alert.
-- Part 2 bans the 675 @example.invalid accounts (scripted
-- signups 12-13 Nov) and removes their scores.
-- Idempotent.
-- =============================================

create or replace function public.catch_suspicious_weekly()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  c_factor constant double precision := 1.5;
  c_min_others constant int := 3;
  c_young constant interval := interval '1 day';
  lower_better boolean :=
    not public.merge_score_is_better(new.game_id, 2, 1);
  prev double precision; prev_name text; others int;
  acct_age interval; why text; fid bigint; tok text; chan text;
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
  if others < c_min_others then return new; end if;
  select s.score, s.username into prev, prev_name
    from public.weekly_scores s
   where s.week = new.week and s.game_id = new.game_id
     and s.user_id <> new.user_id
   order by case when lower_better then s.score end asc,
            case when not lower_better then s.score end desc
   limit 1;
  if prev is null or not public.merge_score_is_better(
       new.game_id, new.score, prev) then
    return new;   -- not the new weekly #1
  end if;

  if (not lower_better and prev > 0
      and new.score > prev * c_factor)
     or (lower_better and new.score > 0
         and new.score < prev / c_factor) then
    why := format('%sx the old weekly #1', round((case
      when lower_better then prev / new.score
      else new.score / prev end)::numeric, 1));
  end if;
  select now() - u.created_at into acct_age
    from auth.users u where u.id = new.user_id;
  if acct_age < c_young then
    why := concat_ws(', ', why, 'account '
      || greatest(1, extract(epoch from acct_age)::int / 3600)
      || ' h old');
  end if;
  if why is null then return new; end if;

  insert into public.score_flags
    (user_id, game_id, username, score, prev_best,
     prev_user, reason)
  values (new.user_id, new.game_id, new.username, new.score,
          prev, prev_name, 'weekly: ' || why)
  returning id into fid;
  insert into public.leaderboard_bans (user_id, reason)
  values (new.user_id, format('caught weekly score #%s: %s %s (%s)',
          fid, new.game_id, new.score, why))
  on conflict do nothing;
  insert into public.user_notices (user_id, title, body)
  select new.user_id,
    jsonb_build_object('lb', 'Haha, du hues also awer probéiert',
      'de', 'Haha, du hues also awer probéiert',
      'en', 'Haha, du hues also awer probéiert'),
    jsonb_build_object('lb', '', 'de', '', 'en', '')
  where not exists (select 1 from public.user_notices n
    where n.user_id = new.user_id and n.seen_at is null
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
          'text', format(E'⚠️ Score-Fuddler am Spill vun der Woch gefaangen (#%s)\n*%s* – %s: %s\nVirdrun #1: %s mat %s\nWisou: %s\nScore net gespäichert, Kont vun de Leaderboards gebannt.',
            fid, coalesce(new.username, '?'), new.game_id,
            new.score, coalesce(prev_name, '?'), prev, why)));
    end if;
  exception when others then
    raise warning 'weekly catch alert failed: %', sqlerrm;
  end;

  if tg_op = 'UPDATE' then return old; end if;
  return null;
end $$;

drop trigger if exists zz_catch_suspicious_weekly
  on public.weekly_scores;
create trigger zz_catch_suspicious_weekly
  before insert or update on public.weekly_scores
  for each row execute function public.catch_suspicious_weekly();

-- ---------- part 2: the scripted accounts ----------

insert into public.leaderboard_bans (user_id, reason)
select u.id, 'scripted @example.invalid signup, 12-13 Nov 2026'
  from auth.users u
 where u.email like '%@example.invalid'
on conflict do nothing;

delete from public.weekly_scores s using auth.users u
 where u.id = s.user_id and u.email like '%@example.invalid';
delete from public.scores s using auth.users u
 where u.id = s.user_id and u.email like '%@example.invalid';
