-- IP tier: a cosmetic 💠 IP badge shown next
-- to a user's name (Messenger, Friends,
-- Class-Chat, Profile), mirroring the ⭐ VIP
-- tag. Email-keyed like vip_users; set purely
-- in SQL — no UI to grant it.
--
-- Paste the WHOLE file into Supabase ▸ SQL
-- Editor ▸ New query ▸ Run.

-- who is IP (RLS on, no policies → only
-- SECURITY DEFINER funcs may read it)
create table if not exists public.ip_users (
  email text primary key
);
alter table public.ip_users
  enable row level security;

-- true if the CURRENT user is IP (for future
-- gating; not needed for the badge itself)
create or replace function public.is_ip()
  returns boolean
  language sql security definer stable
  set search_path = public
as 'select exists (
     select 1 from public.ip_users
     where lower(email) = lower(
       coalesce(auth.jwt() ->> ''email'','''')
     ))';
grant execute on function public.is_ip()
  to authenticated;

-- user_ids of all IPs → drives the 💠 IP tag
-- client-side (same shape as vip_user_ids)
create or replace function public.ip_user_ids()
  returns table(user_id uuid)
  language sql security definer stable
  set search_path = public
as 'select u.id from auth.users u
    where lower(u.email) in (
      select lower(email)
      from public.ip_users)';
grant execute on function public.ip_user_ids()
  to authenticated;

-- Grant IP to giulia + isabel by username:
insert into public.ip_users (email)
  select u.email from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) in
    ('giulia', 'isabel')
  on conflict do nothing;
