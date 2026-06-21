-- Fix: guarantee every account has a profile (so friends/lookup/requests work),
-- plus a people directory + sent-requests list. Run in Supabase ▸ SQL Editor.

-- 1) Backfill profiles for any existing users that don't have one (unique usernames).
do $$
declare u record; base text; cand text; n int;
begin
  for u in select au.id, au.email, au.raw_user_meta_data->>'username' as uname
           from auth.users au
           where not exists (select 1 from public.profiles p where p.id = au.id) loop
    base := coalesce(nullif(trim(u.uname), ''), split_part(u.email, '@', 1), 'user');
    cand := base; n := 0;
    while exists (select 1 from public.profiles where lower(username) = lower(cand)) loop
      n := n + 1; cand := base || n::text;
    end loop;
    insert into public.profiles (id, username) values (u.id, cand) on conflict (id) do nothing;
  end loop;
end $$;

-- 2) Auto-create a profile whenever a new account is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base text; cand text; n int := 0;
begin
  base := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1), 'user');
  cand := base;
  while exists (select 1 from public.profiles where lower(username) = lower(cand)) loop
    n := n + 1; cand := base || n::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, cand) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Sent (outgoing pending) requests.
create or replace function public.sent_requests()
returns table(id bigint, user_id uuid, username text) language sql security definer stable set search_path = public as $$
  select f.id, f.addressee, p.username from public.friendships f
  join public.profiles p on p.id = f.addressee
  where f.status = 'pending' and f.requester = auth.uid();
$$;
grant execute on function public.sent_requests() to authenticated;

-- 4) People directory — everyone else, with your relationship status.
create or replace function public.directory()
returns table(user_id uuid, username text, status text) language sql security definer stable set search_path = public as $$
  select p.id, p.username,
    case
      when exists (select 1 from public.friendships f where f.status='accepted'
            and ((f.requester=auth.uid() and f.addressee=p.id) or (f.requester=p.id and f.addressee=auth.uid()))) then 'friend'
      when exists (select 1 from public.friendships f where f.requester=auth.uid() and f.addressee=p.id) then 'sent'
      when exists (select 1 from public.friendships f where f.requester=p.id and f.addressee=auth.uid()) then 'incoming'
      else 'none'
    end as status
  from public.profiles p
  where p.id <> auth.uid()
  order by p.username;
$$;
grant execute on function public.directory() to authenticated;

-- 5) Realtime on group_members so new DMs/groups appear in the chat list live.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='group_members') then
    alter publication supabase_realtime add table public.group_members;
  end if;
end $$;
