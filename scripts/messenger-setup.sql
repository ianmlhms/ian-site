-- Messenger — Supabase schema for group chat (shares the same auth as PixelBreak).
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run.

create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default lower(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  bigint not null references public.groups(id) on delete cascade,
  user_id   uuid   not null references auth.users(id) on delete cascade,
  username  text   not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  group_id   bigint not null references public.groups(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  username   text   not null,
  content    text   not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_group_idx on public.messages (group_id, created_at);

-- Membership check as SECURITY DEFINER so policies that reference group_members
-- don't recurse (the function bypasses RLS because it's owned by the table owner).
create or replace function public.is_group_member(gid bigint)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$$;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.messages      enable row level security;

drop policy if exists groups_read   on public.groups;
drop policy if exists groups_insert on public.groups;
create policy groups_read   on public.groups for select using (public.is_group_member(id));
create policy groups_insert on public.groups for insert with check (auth.uid() = created_by);

drop policy if exists members_read        on public.group_members;
drop policy if exists members_self_insert on public.group_members;
create policy members_read        on public.group_members for select using (public.is_group_member(group_id));
create policy members_self_insert on public.group_members for insert with check (user_id = auth.uid());

drop policy if exists messages_read   on public.messages;
drop policy if exists messages_insert on public.messages;
create policy messages_read   on public.messages for select using (public.is_group_member(group_id));
create policy messages_insert on public.messages for insert with check (public.is_group_member(group_id) and user_id = auth.uid());

-- Create a group and add the creator as the first member, atomically.
create or replace function public.create_group(p_name text, p_username text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  insert into public.groups (name, created_by) values (p_name, auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id, username) values (g.id, auth.uid(), p_username);
  return g;
end; $$;

-- Join an existing group by its invite code.
create or replace function public.join_group(p_code text, p_username text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from public.groups where invite_code = lower(trim(p_code));
  if g.id is null then raise exception 'No group with that code'; end if;
  insert into public.group_members (group_id, user_id, username)
    values (g.id, auth.uid(), p_username)
    on conflict (group_id, user_id) do nothing;
  return g;
end; $$;

-- List the groups the current user belongs to.
create or replace function public.my_groups()
returns setof public.groups language sql security definer stable set search_path = public as $$
  select g.* from public.groups g
  join public.group_members m on m.group_id = g.id
  where m.user_id = auth.uid()
  order by g.created_at;
$$;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group(text, text)   to authenticated;
grant execute on function public.my_groups()              to authenticated;

-- Live updates for new messages.
alter publication supabase_realtime add table public.messages;
