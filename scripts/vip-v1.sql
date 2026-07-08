-- VIP tier: a cosmetic ⭐ VIP badge shown next to a user's name (Messenger +
-- Friends), mirroring the 👑 admin tag. Email-keyed like app_admins so it's set
-- purely in SQL — no UI to grant it.
--
-- Paste the WHOLE file into Supabase ▸ SQL Editor ▸ New query ▸ Run.

-- who is VIP (email-keyed; RLS on, no policies → only SECURITY DEFINER funcs read it)
create table if not exists public.vip_users (email text primary key);
alter table public.vip_users enable row level security;

-- seed the owner; add the others below once you have their usernames/emails
insert into public.vip_users (email) values ('konto@ian.lu') on conflict do nothing;

-- true if the CURRENT user is VIP (handy for future gating; not needed for the badge)
create or replace function public.is_vip() returns boolean
  language sql security definer stable set search_path = public
  as $func$ select exists (select 1 from public.vip_users
                           where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $func$;
grant execute on function public.is_vip() to authenticated;

-- user_ids of all VIPs → drives the ⭐ VIP tag client-side (same shape as admin_user_ids)
create or replace function public.vip_user_ids() returns table(user_id uuid)
  language sql security definer stable set search_path = public
  as $func$ select u.id from auth.users u
            where lower(u.email) in (select lower(email) from public.vip_users) $func$;
grant execute on function public.vip_user_ids() to authenticated;

-- Enable VIP for people by USERNAME (fill in the real usernames, then run just this):
-- insert into public.vip_users (email)
--   select u.email from auth.users u
--   join public.profiles p on p.id = u.id
--   where p.username in ('ben', 'julien', 'matthieu')
--   on conflict do nothing;
