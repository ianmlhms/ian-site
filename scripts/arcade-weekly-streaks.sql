-- Game of the week + daily arcade streak (9 Oct 2026).
--
-- Game of the week: one arcade game per ISO week (Monday, Luxembourg time),
-- picked from a fixed rotation. Every run of that game is sent with
-- submit_weekly_score(); the best run per player counts. The board resets each
-- Monday; last week's winner gets a 🏆 tag next to their name for a week.
--
-- Daily streak: touch_streak() is called once per day when a signed-in player
-- opens any arcade game. Playing on consecutive days grows the streak; missing a
-- day resets it to 1. Streaks of 3+ days show as a 🔥 tag.

create or replace function public.lux_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Luxembourg')::date
$$;

create or replace function public.arcade_week_start(p_day date default null)
returns date language sql stable as $$
  select date_trunc('week', coalesce(p_day, public.lux_today()))::date
$$;

-- Rotation order. Changing it changes which game is "this week" — append only.
create or replace function public.weekly_game(p_week date default null)
returns text language sql stable as $$
  select (array[
    'tetris', 'flappy', 'crossy-road', 'doodle-jump', 'dino', 'snake',
    'tower-stack', 'pacman', '2048', 'asteroids', 'fruit-slash', 'reaction',
    'bubble-shooter', 'space-invaders'
  ])[1 + mod(((public.arcade_week_start(p_week) - date '2026-01-05') / 7)::int, 14)]
$$;

create table if not exists public.weekly_scores (
  week date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null,
  username text,
  score bigint not null,
  updated_at timestamptz not null default now(),
  primary key (week, user_id)
);
alter table public.weekly_scores enable row level security;
revoke all on table public.weekly_scores from anon, authenticated;

create or replace function public.submit_weekly_score(p_game text, p_score bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  wk date := public.arcade_week_start();
  old_score bigint;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  if p_game is distinct from public.weekly_game(wk) or p_score is null
     or p_score < 0 or p_score > 1000000000000000 then
    return false;
  end if;
  select score into old_score from public.weekly_scores where week = wk and user_id = uid for update;
  if old_score is not null and not public.merge_score_is_better(p_game, p_score, old_score) then
    return false;
  end if;
  insert into public.weekly_scores (week, user_id, game_id, username, score, updated_at)
  values (wk, uid, p_game, (select username from public.profiles where id = uid), p_score, now())
  on conflict (week, user_id) do update
    set score = excluded.score, username = excluded.username, updated_at = now();
  return true;
end $$;
revoke all on function public.submit_weekly_score(text, bigint) from public, anon;
grant execute on function public.submit_weekly_score(text, bigint) to authenticated;

-- Current week's game, its end, and the top 20.
create or replace function public.weekly_board(p_week date default null)
returns table (week date, game_id text, ends_at timestamptz, rank int, user_id uuid, username text, score bigint)
language sql stable security definer set search_path = public as $$
  select public.assert_not_kart();
  with wk as (select public.arcade_week_start(p_week) as d)
  select wk.d,
         public.weekly_game(wk.d),
         ((wk.d + 7)::timestamp at time zone 'Europe/Luxembourg'),
         (row_number() over (order by case when public.weekly_game(wk.d) in ('memory', 'maze', 'reaction')
                                           then s.score else -s.score end, s.updated_at))::int,
         s.user_id,
         coalesce(p.username, s.username),
         s.score
    from wk
    left join public.weekly_scores s on s.week = wk.d
    left join public.profiles p on p.id = s.user_id
   order by 4
   limit 20;
$$;
revoke all on function public.weekly_board(date) from public, anon;
grant execute on function public.weekly_board(date) to authenticated;

create table if not exists public.arcade_streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_day date not null,
  streak int not null default 1,
  best int not null default 1
);
alter table public.arcade_streaks enable row level security;
revoke all on table public.arcade_streaks from anon, authenticated;

-- Returns { streak, best, is_new_day }. is_new_day = first call today.
create or replace function public.touch_streak()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := public.lux_today();
  rec public.arcade_streaks;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.assert_not_kart();
  select * into rec from public.arcade_streaks where user_id = uid for update;
  if rec.user_id is null then
    insert into public.arcade_streaks (user_id, last_day) values (uid, today) returning * into rec;
    return jsonb_build_object('streak', 1, 'best', 1, 'is_new_day', true);
  end if;
  if rec.last_day = today then
    return jsonb_build_object('streak', rec.streak, 'best', rec.best, 'is_new_day', false);
  end if;
  update public.arcade_streaks
     set streak = case when rec.last_day = today - 1 then rec.streak + 1 else 1 end,
         best = greatest(rec.best, case when rec.last_day = today - 1 then rec.streak + 1 else 1 end),
         last_day = today
   where user_id = uid
  returning * into rec;
  return jsonb_build_object('streak', rec.streak, 'best', rec.best, 'is_new_day', true);
end $$;
revoke all on function public.touch_streak() from public, anon;
grant execute on function public.touch_streak() to authenticated;

-- Tags now also carry the live streak (0 when it's broken) and last week's champion.
drop function if exists public.leaderboard_tags();
create function public.leaderboard_tags()
returns table(user_id uuid, username text, class text, is_admin boolean, is_owner boolean,
              streak int, weekly_champion boolean)
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
         p.id in (select champ.user_id from champ)
  from public.profiles p
  where p.account_kind = 'full' and p.username is not null;
$$;
revoke all on function public.leaderboard_tags() from public, anon;
grant execute on function public.leaderboard_tags() to authenticated;
