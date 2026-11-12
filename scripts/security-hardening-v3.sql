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
-- revoke select on public.profiles from authenticated;
-- grant select (id, username, created_at, avatar, class, class_confirmed, theme, account_kind)
--   on public.profiles to authenticated;
