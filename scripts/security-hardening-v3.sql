-- Security hardening after Lou's external audit (12 Nov 2026).
-- Run in two steps: PART 1 any time; PART 2 only after the client that uses
-- my_profile_private() (fs.html, account-check.js) is live, or FakeStake and
-- the account check lose their own-row reads.

-- ===== PART 1 =================================================================

-- 1. Leaderboard spoofing: scores.username was free text from the client, so any
--    account could post a row named "Aidan". The name now always comes from the
--    poster's profile (rows of accounts without a profile keep theirs).
create or replace function public.scores_force_username()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select username into v from public.profiles where id = new.user_id;
  if v is not null then new.username := v; end if;
  return new;
end $$;

drop trigger if exists scores_force_username on public.scores;
create trigger scores_force_username
  before insert or update on public.scores
  for each row execute function public.scores_force_username();

-- A rename carries over to the boards right away.
create or replace function public.profiles_sync_score_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.username is distinct from old.username and new.username is not null then
    update public.scores set username = new.username where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_score_names on public.profiles;
create trigger profiles_sync_score_names
  after update of username on public.profiles
  for each row execute function public.profiles_sync_score_names();

-- 2. Own private profile fields, for the step-2 lockdown below.
create or replace function public.my_profile_private()
returns table(casino_balance numeric, can_casino boolean, account_checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.casino_balance, p.can_casino, p.account_checked_at
  from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.my_profile_private() from public, anon;
grant execute on function public.my_profile_private() to authenticated;

-- 3. The admin list is only needed for the "Admin" tag, which signed-in users see.
revoke execute on function public.admin_user_ids() from public, anon;
grant execute on function public.admin_user_ids() to authenticated;

-- ===== PART 2 (after the client deploy) =========================================
-- 4. Other accounts' casino balance, FakeStake access and account-check time
--    were readable by every signed-in user. Column grants replace the table grant.
revoke select on public.profiles from authenticated;  -- applied 12 Nov 2026
grant select (id, username, created_at, avatar, class, class_confirmed, theme, account_kind)
  on public.profiles to authenticated;

-- ===== PART 3 (12 Nov 2026): leaderboard bans =================================
-- Accounts listed here can still sign in and play, but nothing they post reaches
-- a board: inserts/updates into the score tables are silently dropped.
create table if not exists public.leaderboard_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.leaderboard_bans enable row level security;   -- no policies: server-only

create or replace function public.drop_banned_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.leaderboard_bans b where b.user_id = new.user_id) then
    return null;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['scores','weekly_scores','daily_scores','wordle_results','arcade_streaks'] loop
    execute format('drop trigger if exists drop_banned_score on public.%I', t);
    execute format('create trigger drop_banned_score before insert or update on public.%I for each row execute function public.drop_banned_score()', t);
  end loop;
end $$;

-- Lou ("dengens"): faked scores with an AI agent; account kept, boards cleared.
insert into public.leaderboard_bans (user_id, reason)
select id, 'faked scores (Lou, Hermes audit 12 Nov 2026)' from auth.users where email = 'dengens@serlo.lu'
on conflict do nothing;
delete from public.scores         where user_id in (select user_id from public.leaderboard_bans);
delete from public.weekly_scores  where user_id in (select user_id from public.leaderboard_bans);
delete from public.daily_scores   where user_id in (select user_id from public.leaderboard_bans);
delete from public.wordle_results where user_id in (select user_id from public.leaderboard_bans);
delete from public.arcade_streaks where user_id in (select user_id from public.leaderboard_bans);

-- ===== PART 4 (12 Nov 2026): catch suspicious scores =============================
-- A score is caught when it would become the new #1 of a board with at least 3
-- other players and either beats the old #1 by more than 1.5x (lower-is-better
-- games: is under old/1.5), or comes from an account younger than a day. Admins
-- are never caught. Ian's rule: a caught score is not saved (an update keeps the
-- old score), the account is banned from all leaderboards (leaderboard_bans), it
-- gets a one-time notice "Haha, du hues also awer probéiert", and Slack #claude
-- gets an alert ("Ian Bots" app; token in Supabase vault as slack_bot_token /
-- slack_claude_channel). The caught score stays in score_flags.
-- Undo a false catch: delete from leaderboard_bans where user_id = '<id>';
-- (the player then posts their score again with their next game).
create table if not exists public.score_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  username text,
  score double precision not null,
  prev_best double precision,
  prev_user text,
  reason text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
drop index if exists public.score_flags_open;
alter table public.score_flags enable row level security;
drop policy if exists score_flags_admin on public.score_flags;
create policy score_flags_admin on public.score_flags for select to authenticated using ((select public.is_admin()));

drop trigger if exists flag_suspicious_score on public.scores;
drop function if exists public.flag_suspicious_score();

create or replace function public.catch_suspicious_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_factor constant double precision := 1.5;
  c_min_others constant int := 3;
  lower_better boolean := not public.merge_score_is_better(new.game_id, 2, 1);
  prev double precision; prev_name text; others int; acct_age interval; why text;
  fid bigint; tok text; chan text;
begin
  if tg_op = 'UPDATE' and new.score is not distinct from old.score then return new; end if;
  if exists (select 1 from public.admin_user_ids() a where a.user_id = new.user_id) then return new; end if;
  select count(*) into others from public.scores where game_id = new.game_id and user_id <> new.user_id;
  if others < c_min_others then return new; end if;
  select s.score, s.username into prev, prev_name from public.scores s
   where s.game_id = new.game_id and s.user_id <> new.user_id
   order by case when lower_better then s.score end asc, case when not lower_better then s.score end desc
   limit 1;
  if prev is null or not public.merge_score_is_better(new.game_id, new.score, prev) then return new; end if;   -- not the new #1

  if (not lower_better and prev > 0 and new.score > prev * c_factor)
     or (lower_better and new.score > 0 and new.score < prev / c_factor) then
    why := format('%sx the old #1', round((case when lower_better then prev / new.score else new.score / prev end)::numeric, 1));
  end if;
  select now() - u.created_at into acct_age from auth.users u where u.id = new.user_id;
  if acct_age < interval '1 day' then
    why := concat_ws(', ', why, 'account ' || greatest(1, extract(epoch from acct_age)::int / 3600) || ' h old');
  end if;
  if why is null then return new; end if;

  insert into public.score_flags (user_id, game_id, username, score, prev_best, prev_user, reason)
  values (new.user_id, new.game_id, new.username, new.score, prev, prev_name, why)
  returning id into fid;
  insert into public.leaderboard_bans (user_id, reason)
  values (new.user_id, format('caught score #%s: %s %s (%s)', fid, new.game_id, new.score, why))
  on conflict do nothing;
  insert into public.user_notices (user_id, title, body)
  select new.user_id,
         jsonb_build_object('lb', 'Haha, du hues also awer probéiert', 'de', 'Haha, du hues also awer probéiert', 'en', 'Haha, du hues also awer probéiert'),
         jsonb_build_object('lb', '', 'de', '', 'en', '')
  where not exists (select 1 from public.user_notices n where n.user_id = new.user_id and n.seen_at is null
                      and n.title->>'lb' = 'Haha, du hues also awer probéiert');

  begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'slack_bot_token';
    select decrypted_secret into chan from vault.decrypted_secrets where name = 'slack_claude_channel';
    if tok is not null and chan is not null then
      perform net.http_post(
        url := 'https://slack.com/api/chat.postMessage',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || tok),
        body := jsonb_build_object('channel', chan, 'text', format(
          E'⚠️ Score-Fuddler op ian.lu gefaangen (#%s)\n*%s* – %s: %s\nVirdrun #1: %s mat %s\nWisou: %s\nScore net gespäichert, Kont vun de Leaderboards gebannt.',
          fid, coalesce(new.username, '?'), new.game_id, new.score, coalesce(prev_name, '?'), prev, why)));
    end if;
  exception when others then
    raise warning 'score catch alert failed: %', sqlerrm;   -- never break the game's save
  end;

  if tg_op = 'UPDATE' then return old; end if;   -- keep their previous score
  return null;                                    -- drop the new row
end $$;

-- "zz_" so it runs after the other BEFORE triggers (keep_best, floors, username).
drop trigger if exists zz_catch_suspicious_score on public.scores;
create trigger zz_catch_suspicious_score
  before insert or update on public.scores
  for each row execute function public.catch_suspicious_score();

-- ===== PART 5: show the catch notice immediately ================================
-- The arcade calls this right after saving a score; only notices created in the
-- last 2 minutes come back, so older announcements never pop up mid-game.
create or replace function public.my_fresh_notices()
returns table(id uuid, title jsonb, body jsonb, cta jsonb, url text, images jsonb)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.cta, n.url, n.images
  from public.user_notices n
  where n.user_id = auth.uid() and n.seen_at is null and n.created_at > now() - interval '2 minutes'
  order by n.created_at desc
  limit 1;
$$;
revoke all on function public.my_fresh_notices() from public, anon;
grant execute on function public.my_fresh_notices() to authenticated;
