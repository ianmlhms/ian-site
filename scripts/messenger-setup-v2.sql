-- ===========================================================================
-- Messenger v2 — member lists / leave, direct messages, media, admin panel.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- ===========================================================================

-- ---- 0) Profiles: username directory (needed to look people up for DMs) ----
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

-- Claim my profile on first login; resolves username clashes by suffixing a number.
create or replace function public.upsert_profile(p_username text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare base text := nullif(trim(p_username), ''); cand text; n int := 0; row public.profiles;
begin
  select * into row from public.profiles where id = auth.uid();
  if row.id is not null then return row; end if;
  if base is null then base := 'user'; end if;
  cand := base;
  while exists (select 1 from public.profiles where lower(username) = lower(cand)) loop
    n := n + 1; cand := base || n::text;
  end loop;
  insert into public.profiles (id, username) values (auth.uid(), cand) returning * into row;
  return row;
end; $$;
grant execute on function public.upsert_profile(text) to authenticated;

-- ---- 1) Groups: mark direct-message conversations --------------------------
alter table public.groups add column if not exists is_dm boolean not null default false;

-- ---- 2) Messages: attach media; allow empty text when media is present -----
alter table public.messages add column if not exists media_url  text;  -- storage object path
alter table public.messages add column if not exists media_type text;  -- 'image' | 'video'
do $$ declare c text; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.messages'::regclass and contype = 'c' loop
    execute format('alter table public.messages drop constraint %I', c);
  end loop;
end $$;
alter table public.messages add constraint messages_body_chk
  check (char_length(content) <= 2000 and (char_length(content) > 0 or media_url is not null));

-- ---- 3) Leave a group ------------------------------------------------------
drop policy if exists members_self_delete on public.group_members;
create policy members_self_delete on public.group_members for delete using (user_id = auth.uid());

-- ---- 4) My chats (groups + DMs) with a display name ------------------------
create or replace function public.my_chats()
returns table(id bigint, name text, invite_code text, is_dm boolean, created_at timestamptz, display text)
language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.invite_code, g.is_dm, g.created_at,
    case when g.is_dm
      then coalesce((select m2.username from public.group_members m2
                      where m2.group_id = g.id and m2.user_id <> auth.uid() limit 1), 'Direct message')
      else g.name end as display
  from public.groups g
  join public.group_members m on m.group_id = g.id
  where m.user_id = auth.uid()
  order by g.created_at;
$$;
grant execute on function public.my_chats() to authenticated;

-- ---- 5) Start (or reuse) a 1:1 DM by username ------------------------------
create or replace function public.start_dm(p_username text, p_me_username text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare target uuid; tname text; g public.groups; gid bigint;
begin
  select id, username into target, tname from public.profiles
    where lower(username) = lower(trim(p_username)) limit 1;
  if target is null then raise exception 'No user with that username'; end if;
  if target = auth.uid() then raise exception 'You cannot message yourself'; end if;
  select g2.id into gid from public.groups g2
    where g2.is_dm
      and exists (select 1 from public.group_members m where m.group_id = g2.id and m.user_id = auth.uid())
      and exists (select 1 from public.group_members m where m.group_id = g2.id and m.user_id = target)
    limit 1;
  if gid is not null then select * into g from public.groups where id = gid; return g; end if;
  insert into public.groups (name, created_by, is_dm) values ('Direct message', auth.uid(), true) returning * into g;
  insert into public.group_members (group_id, user_id, username)
    values (g.id, auth.uid(), p_me_username), (g.id, target, tname);
  return g;
end; $$;
grant execute on function public.start_dm(text, text) to authenticated;

-- ---- 6) Admin (read-everything) -------------------------------------------
create table if not exists public.app_admins (email text primary key);
insert into public.app_admins (email) values ('konto@ian.lu') on conflict do nothing;
alter table public.app_admins enable row level security;  -- no policies → only SECURITY DEFINER funcs read it

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.app_admins
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_admin() to authenticated;

create or replace function public.admin_groups()
returns table(id bigint, name text, invite_code text, is_dm boolean, created_by uuid,
              created_at timestamptz, member_count bigint, message_count bigint)
language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.invite_code, g.is_dm, g.created_by, g.created_at,
    (select count(*) from public.group_members m where m.group_id = g.id),
    (select count(*) from public.messages msg where msg.group_id = g.id)
  from public.groups g
  where public.is_admin()
  order by g.created_at desc;
$$;
grant execute on function public.admin_groups() to authenticated;

create or replace function public.admin_messages(p_group_id bigint)
returns setof public.messages language sql security definer stable set search_path = public as $$
  select * from public.messages
   where public.is_admin() and (p_group_id is null or group_id = p_group_id)
   order by created_at;
$$;
grant execute on function public.admin_messages(bigint) to authenticated;

create or replace function public.admin_members(p_group_id bigint)
returns setof public.group_members language sql security definer stable set search_path = public as $$
  select * from public.group_members
   where public.is_admin() and group_id = p_group_id order by joined_at;
$$;
grant execute on function public.admin_members(bigint) to authenticated;

-- ---- 7) Storage bucket for chat media (private; signed-in users can view) --
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false)
  on conflict (id) do nothing;
drop policy if exists "chat media upload" on storage.objects;
create policy "chat media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media');
drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-media');
