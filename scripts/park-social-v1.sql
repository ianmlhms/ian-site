-- ===========================================================================
-- Theme Park Tycoon — async social layer for the PixelBreak arcade.
-- Players opt in by publishing their park; anyone (incl. signed-out visitors)
-- can browse the gallery, and signed-in players can like a park.
--
-- Tables are written ONLY through the security-definer functions below, so the
-- username and the owner are always taken from the session, never from the
-- client. Run with: supabase db query --linked -f scripts/park-social-v1.sql
-- Idempotent.
-- ===========================================================================

-- A published park. One row per player; publishing again replaces it.
create table if not exists public.park_showcase (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  park_name  text not null,
  value      bigint not null default 0,
  guests     integer not null default 0,
  rating     integer not null default 0,
  layout     text not null,
  updated_at timestamptz not null default now()
);
create index if not exists park_showcase_value_idx
  on public.park_showcase(value desc);
alter table public.park_showcase enable row level security;

-- Public read for the gallery and the leaderboard. No write policy at all:
-- every write goes through publish_park / unpublish_park.
drop policy if exists park_showcase_read on public.park_showcase;
create policy park_showcase_read on public.park_showcase
  for select using (true);

create table if not exists public.park_likes (
  user_id      uuid not null references auth.users(id) on delete cascade,
  park_user_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, park_user_id)
);
create index if not exists park_likes_park_idx
  on public.park_likes(park_user_id);
alter table public.park_likes enable row level security;

drop policy if exists park_likes_read on public.park_likes;
create policy park_likes_read on public.park_likes
  for select using (true);

-- ---------------------------------------------------------------------------
-- Publish my park. Username comes from my profile, never from the client.
-- The layout cap mirrors the 8 KB game_saves limit -- a park that cannot be
-- saved must not be publishable either.
-- ---------------------------------------------------------------------------
create or replace function public.publish_park(
  p_name text, p_value bigint, p_guests integer,
  p_rating integer, p_layout text)
returns void language plpgsql security definer
set search_path = public as $$
declare uname text;
begin
  if auth.uid() is null then return; end if;
  if p_layout is null or length(p_layout) > 8000 then return; end if;
  select username into uname from public.profiles where id = auth.uid();
  if uname is null then return; end if;
  insert into public.park_showcase
    (user_id, username, park_name, value, guests, rating, layout, updated_at)
  values (
    auth.uid(), uname,
    left(coalesce(nullif(trim(p_name), ''), uname || '''s park'), 32),
    greatest(0, coalesce(p_value, 0)),
    greatest(0, coalesce(p_guests, 0)),
    least(1000, greatest(0, coalesce(p_rating, 0))),
    p_layout, now())
  on conflict (user_id) do update set
    username   = excluded.username,
    park_name  = excluded.park_name,
    value      = excluded.value,
    guests     = excluded.guests,
    rating     = excluded.rating,
    layout     = excluded.layout,
    updated_at = now();
end $$;
grant execute on function
  public.publish_park(text, bigint, integer, integer, text)
  to authenticated;

create or replace function public.unpublish_park()
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.park_showcase where user_id = auth.uid();
end $$;
grant execute on function public.unpublish_park() to authenticated;

-- ---------------------------------------------------------------------------
-- The gallery / leaderboard. Layout is deliberately NOT returned here -- it is
-- the big column, and the list only needs the cards.
-- ---------------------------------------------------------------------------
create or replace function public.park_gallery(
  p_sort text default 'value', p_limit integer default 24)
returns table(
  user_id uuid, username text, park_name text, value bigint,
  guests integer, rating integer, likes integer,
  liked_by_me boolean, updated_at timestamptz)
language sql security definer stable
set search_path = public as $$
  select s.user_id, s.username, s.park_name, s.value,
         s.guests, s.rating,
         (select count(*) from public.park_likes l
           where l.park_user_id = s.user_id)::int,
         exists (select 1 from public.park_likes l
           where l.park_user_id = s.user_id and l.user_id = auth.uid()),
         s.updated_at
  from public.park_showcase s
  order by
    case when p_sort = 'likes' then
      (select count(*) from public.park_likes l
        where l.park_user_id = s.user_id) end desc nulls last,
    case when p_sort = 'recent' then s.updated_at end desc nulls last,
    s.value desc
  limit least(100, greatest(1, coalesce(p_limit, 24)));
$$;
grant execute on function public.park_gallery(text, integer)
  to anon, authenticated;

-- One park's full layout, fetched only when a visitor opens it.
create or replace function public.park_layout(p_user uuid)
returns text language sql security definer stable
set search_path = public as $$
  select layout from public.park_showcase where user_id = p_user;
$$;
grant execute on function public.park_layout(uuid) to anon, authenticated;

-- Toggle my like on someone else's park.
create or replace function public.like_park(p_target uuid)
returns boolean language plpgsql security definer
set search_path = public as $$
declare liked boolean;
begin
  if auth.uid() is null or p_target is null then return false; end if;
  if p_target = auth.uid() then return false; end if;
  if not exists (select 1 from public.park_showcase
                  where user_id = p_target) then return false; end if;
  delete from public.park_likes
    where user_id = auth.uid() and park_user_id = p_target;
  if found then return false; end if;
  insert into public.park_likes (user_id, park_user_id)
    values (auth.uid(), p_target);
  return true;
end $$;
grant execute on function public.like_park(uuid) to authenticated;
