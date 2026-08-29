-- FakeStake (casino.html) access flag.
-- The page was pulled on 11 Aug 2026 after Imunify360
-- false-flagged it. Restored 30 Aug 2026, but private:
-- only accounts with can_casino = true may open it.
--
-- A profile flag is used instead of an email allowlist
-- in the page source because this repo is PUBLIC and
-- the second account belongs to a classmate. Adding
-- someone later is an update here, not a deploy.

alter table public.profiles
  add column if not exists can_casino boolean
  not null default false;

comment on column public.profiles.can_casino is
  'May open casino.html (FakeStake). Play money only.';

update public.profiles
   set can_casino = true
 where id in (
   select id from auth.users
    where email in ('konto@ian.lu', 'la5591@elaml.lu')
 );

select p.id, u.email, p.can_casino
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.can_casino;
