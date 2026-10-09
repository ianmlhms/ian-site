-- Event progress + permanent badges (9 Oct 2026). First event: Halloween 2026.
--
-- Games report caught pumpkins with add_event_progress('halloween-2026', n).
-- Only counts while the event runs (24 Oct – 2 Nov, Luxembourg time), at most
-- 5 per call and one call per 5 s per player. 50 pumpkins → badge 'halloween-2026',
-- kept forever and shown on the profile and as a 🎃 tag next to the name.

create table if not exists public.event_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, event)
);
alter table public.event_progress enable row level security;
revoke all on table public.event_progress from anon, authenticated;

create table if not exists public.user_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);
alter table public.user_badges enable row level security;
revoke all on table public.user_badges from anon, authenticated;

-- Event calendar. Add a row here for future events.
create or replace function public.arcade_event(p_event text)
returns table (event text, starts_at timestamptz, ends_at timestamptz, goal int)
language sql stable as $$
  select e.event, e.starts_at, e.ends_at, e.goal
    from (values
      ('halloween-2026',
       timestamp '2026-10-24 00:00' at time zone 'Europe/Luxembourg',
       timestamp '2026-11-03 00:00' at time zone 'Europe/Luxembourg',
       50)
    ) as e(event, starts_at, ends_at, goal)
   where e.event = p_event
$$;

create or replace function public.event_status(p_event text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ev record;
  n int;
begin
  perform public.assert_not_kart();
  select * into ev from public.arcade_event(p_event);
  if ev.event is null then
    return null;
  end if;
  select count into n from public.event_progress where user_id = auth.uid() and event = p_event;
  return jsonb_build_object(
    'event', ev.event, 'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'goal', ev.goal,
    'active', now() >= ev.starts_at and now() < ev.ends_at,
    'count', coalesce(n, 0),
    'badge', exists (select 1 from public.user_badges where user_id = auth.uid() and badge = p_event));
end $$;
revoke all on function public.event_status(text) from public, anon;
grant execute on function public.event_status(text) to authenticated;

create or replace function public.add_event_progress(p_event text, p_count int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ev record;
  rec public.event_progress;
  add_n int := least(greatest(coalesce(p_count, 0), 0), 5);
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  select * into ev from public.arcade_event(p_event);
  if ev.event is null or now() < ev.starts_at or now() >= ev.ends_at or add_n = 0 then
    return public.event_status(p_event);
  end if;
  insert into public.event_progress (user_id, event, count, updated_at)
  values (uid, p_event, 0, now() - interval '1 minute')
  on conflict (user_id, event) do nothing;
  select * into rec from public.event_progress where user_id = uid and event = p_event for update;
  if rec.updated_at > now() - interval '5 seconds' then
    return public.event_status(p_event);
  end if;
  update public.event_progress set count = count + add_n, updated_at = now()
   where user_id = uid and event = p_event
  returning * into rec;
  if rec.count >= ev.goal then
    insert into public.user_badges (user_id, badge) values (uid, p_event) on conflict do nothing;
  end if;
  return public.event_status(p_event);
end $$;
revoke all on function public.add_event_progress(text, int) from public, anon;
grant execute on function public.add_event_progress(text, int) to authenticated;

-- Tags gain the player's badges.
drop function if exists public.leaderboard_tags();
create function public.leaderboard_tags()
returns table(user_id uuid, username text, class text, is_admin boolean, is_owner boolean,
              streak int, weekly_champion boolean, badges text[])
language sql stable security definer set search_path = public as $$
  select public.assert_not_kart();
  with champ as (
    select b.user_id from public.weekly_board(public.arcade_week_start() - 7) b
     where b.rank = 1 and b.user_id is not null
  )
  select p.id,
         p.username,
         nullif(btrim(p.class), ''),
         exists (select 1 from public.admin_user_ids() a where a.user_id = p.id),
         p.id = public.owner_user_id(),
         coalesce((select s.streak from public.arcade_streaks s
                    where s.user_id = p.id and s.last_day >= public.lux_today() - 1), 0),
         p.id in (select champ.user_id from champ),
         coalesce((select array_agg(ub.badge order by ub.earned_at) from public.user_badges ub
                    where ub.user_id = p.id), '{}')
  from public.profiles p
  where p.account_kind = 'full' and p.username is not null;
$$;
revoke all on function public.leaderboard_tags() from public, anon;
grant execute on function public.leaderboard_tags() to authenticated;
