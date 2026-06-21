-- Friends + game invites. Paste into Supabase ▸ SQL Editor ▸ Run. Needs profiles (messenger-setup-v2.sql).

-- ---------------- Friends ----------------
create table if not exists public.friendships (
  id         bigint generated always as identity primary key,
  requester  uuid not null references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending',   -- pending | accepted
  created_at timestamptz not null default now(),
  unique (requester, addressee)
);
alter table public.friendships enable row level security;
drop policy if exists friend_see on public.friendships;
create policy friend_see on public.friendships for select using (requester = auth.uid() or addressee = auth.uid());

create or replace function public.add_friend(p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  select id into target from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
  if target is null then raise exception 'No user with that username'; end if;
  if target = auth.uid() then raise exception 'That is you'; end if;
  if exists (select 1 from public.friendships where requester = target and addressee = auth.uid()) then
    update public.friendships set status = 'accepted' where requester = target and addressee = auth.uid();
    return 'accepted';
  end if;
  insert into public.friendships (requester, addressee) values (auth.uid(), target)
    on conflict (requester, addressee) do nothing;
  return 'requested';
end; $$;
grant execute on function public.add_friend(text) to authenticated;

create or replace function public.accept_friend(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.friendships set status = 'accepted' where id = p_id and addressee = auth.uid();
$$;
grant execute on function public.accept_friend(bigint) to authenticated;

create or replace function public.remove_friend(p_other uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friendships
   where (requester = auth.uid() and addressee = p_other) or (requester = p_other and addressee = auth.uid());
$$;
grant execute on function public.remove_friend(uuid) to authenticated;

create or replace function public.my_friends()
returns table(user_id uuid, username text) language sql security definer stable set search_path = public as $$
  select (case when f.requester = auth.uid() then f.addressee else f.requester end) as user_id,
         p.username
  from public.friendships f
  join public.profiles p on p.id = (case when f.requester = auth.uid() then f.addressee else f.requester end)
  where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  order by p.username;
$$;
grant execute on function public.my_friends() to authenticated;

create or replace function public.friend_requests()
returns table(id bigint, user_id uuid, username text) language sql security definer stable set search_path = public as $$
  select f.id, f.requester, p.username from public.friendships f
  join public.profiles p on p.id = f.requester
  where f.status = 'pending' and f.addressee = auth.uid();
$$;
grant execute on function public.friend_requests() to authenticated;

-- ---------------- Game invites ----------------
create table if not exists public.game_invites (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  from_name  text not null,
  to_user    uuid not null references auth.users(id) on delete cascade,
  game       text not null,            -- 'connect4' | 'slf' | 'battleship'
  room       text not null,
  status     text not null default 'pending',  -- pending | accepted | declined
  created_at timestamptz not null default now()
);
alter table public.game_invites enable row level security;
drop policy if exists ginv_see on public.game_invites;
create policy ginv_see on public.game_invites for select using (from_user = auth.uid() or to_user = auth.uid());
drop policy if exists ginv_upd on public.game_invites;
create policy ginv_upd on public.game_invites for update using (to_user = auth.uid() or from_user = auth.uid());

create or replace function public.invite_game(p_to uuid, p_game text)
returns public.game_invites language plpgsql security definer set search_path = public as $$
declare gi public.game_invites; me text;
begin
  select username into me from public.profiles where id = auth.uid();
  insert into public.game_invites (from_user, from_name, to_user, game, room)
    values (auth.uid(), coalesce(me, '?'), p_to, p_game, lower(substr(md5(random()::text), 1, 6)))
    returning * into gi;
  return gi;
end; $$;
grant execute on function public.invite_game(uuid, text) to authenticated;

create or replace function public.my_game_invites()
returns setof public.game_invites language sql security definer stable set search_path = public as $$
  select * from public.game_invites where to_user = auth.uid() and status = 'pending' order by created_at desc;
$$;
grant execute on function public.my_game_invites() to authenticated;

alter publication supabase_realtime add table public.game_invites;
