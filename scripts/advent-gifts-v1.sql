-- =============================================
-- Adventskalenner v2: gifts, not puzzles (15 Nov 2026).
-- Ian: "I didn't want puzzles, rather just small gifts in the
-- arcade games every day."
--
-- * Door N opens on N December at 00:00 Luxembourg time
--   (advent_open_at, kept from v1). Missed doors can still be
--   opened later, until 6 January 2027 23:59 (Dräikinneksdag).
-- * Each door = a gift in one of the idle games, delivered
--   through the existing live-gift pipeline (game_gifts +
--   'gift' client command, game-gifts-v1.sql / fouer-v2.sql):
--   the open game adds it within a minute, otherwise the next
--   time the game opens.
-- * Size: pct of the player's own score in that game (so it is
--   "small" for everyone, from beginners to 1e219 players), at
--   least the door's starter amount. Gifts add to the balance,
--   never to the score (the boards stay fair).
--   Normal door 3 %, Kleeschen (6 Dec) 10 %, 24 Dec 25 % in
--   all four games.
-- * Signed-in ian.lu accounts only (gifts belong to a save).
-- * Which game a door holds stays on the server until opened.
-- Drops the v1 puzzle objects (never used: 0 players, 0 doors).
-- Idempotent.
-- =============================================

-- ---------- v1 puzzle objects out ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'advent\_%'
              and p.proname not in ('advent_open_at', 'advent_gift_amount',
                'advent_gifts_overview', 'advent_gift_open') loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
drop table if exists public.advent_progress;
drop table if exists public.advent_players;
drop table if exists public.advent_doors;

-- ---------- gift plan ----------
create table if not exists public.advent_gift_days(
  day int not null check (day between 1 and 24),
  game_id text not null check (game_id in
    ('idle-empire', 'cookie-clicker', 'bus-tycoon', 'park')),
  pct double precision not null check (pct > 0 and pct <= 1),
  starter double precision not null check (starter > 0),
  primary key (day, game_id)
);

create table if not exists public.advent_gift_claims(
  user_id uuid not null references auth.users(id) on delete cascade,
  day int not null,
  game_id text not null,
  amount double precision not null,
  gift_id bigint,
  claimed_at timestamptz not null default now(),
  primary key (user_id, day, game_id)
);

do $$
declare t text;
begin
  foreach t in array array['advent_gift_days', 'advent_gift_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Big idle players (idle-empire reaches 1e219) need more room
-- than 1e30. admin_gift_live keeps its own 1e30 limit.
alter table public.game_gifts drop constraint if exists game_gifts_amount_check;
alter table public.game_gifts add constraint game_gifts_amount_check
  check (amount > 0 and amount <= 1e300);

-- The plan: the four games in turn, Kleeschen bigger,
-- Christmas Eve in every game. Starters ~ an early-game hour.
delete from public.advent_gift_days;
insert into public.advent_gift_days(day, game_id, pct, starter)
select d, (array['cookie-clicker', 'bus-tycoon', 'idle-empire', 'park'])[1 + (d - 1) % 4],
       case when d = 6 then 0.10 else 0.03 end,
       case (array['cookie-clicker', 'bus-tycoon', 'idle-empire', 'park'])[1 + (d - 1) % 4]
         when 'cookie-clicker' then 500 when 'bus-tycoon' then 200
         when 'idle-empire' then 5000 else 2000 end
       * case when d = 6 then 3 else 1 end
  from generate_series(1, 23) d;
insert into public.advent_gift_days(day, game_id, pct, starter)
values (24, 'cookie-clicker', 0.25, 5000), (24, 'bus-tycoon', 0.25, 2000),
       (24, 'idle-empire', 0.25, 50000), (24, 'park', 0.25, 20000);

-- ---------- helpers ----------
create or replace function public.advent_open_at(p_day int)
returns timestamptz language sql immutable as $$
  select make_timestamptz(2026, 12, p_day, 0, 0, 0, 'Europe/Luxembourg')
$$;

-- Gift size for one player + game: pct of their own score,
-- at least the starter. Whole numbers.
create or replace function public.advent_gift_amount(
  p_user uuid, p_game text, p_pct double precision,
  p_starter double precision)
returns double precision language sql stable security definer
set search_path = public as $$
  select least(1e300, greatest(p_starter, floor(p_pct * coalesce(
    (select s.score from scores s
      where s.user_id = p_user and s.game_id = p_game), 0))))
$$;
revoke all on function public.advent_gift_amount(
  uuid, text, double precision, double precision)
  from public, anon, authenticated;

-- ---------- overview (anyone; gifts only for the signed-in) ----------
-- doors[]: day, open_at, open, opened, gifts (only once opened:
-- [{game, amount}]). Admins also get preview: what each door
-- would give them today.
create or replace function public.advent_gifts_overview()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_admin boolean := uid is not null and coalesce(public.is_admin(), false);
  c_until constant timestamptz :=
    make_timestamptz(2027, 1, 7, 0, 0, 0, 'Europe/Luxembourg');
begin
  return jsonb_build_object(
    'now', now(),
    'until', c_until,
    'signed_in', uid is not null,
    'admin', v_admin,
    'doors', (
      select jsonb_agg(jsonb_build_object(
        'day', d,
        'open_at', advent_open_at(d),
        'open', now() >= advent_open_at(d) and now() < c_until,
        'opened', exists (select 1 from advent_gift_claims c
                           where c.user_id = uid and c.day = d),
        'gifts', (select jsonb_agg(jsonb_build_object(
                    'game', c.game_id, 'amount', c.amount) order by c.game_id)
                    from advent_gift_claims c
                   where c.user_id = uid and c.day = d),
        'preview', case when v_admin then (
          select jsonb_agg(jsonb_build_object('game', g.game_id,
            'amount', advent_gift_amount(uid, g.game_id, g.pct, g.starter))
            order by g.game_id)
            from advent_gift_days g where g.day = d) end
      ) order by d)
      from generate_series(1, 24) d));
end $$;
revoke all on function public.advent_gifts_overview() from public;
grant execute on function public.advent_gifts_overview() to anon, authenticated;

-- ---------- open a door ----------
-- Errors: 'advent: signin', 'advent: day', 'advent: locked',
-- 'advent: over'. Opening again returns the same gifts.
create or replace function public.advent_gift_open(p_day int)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  c_until constant timestamptz :=
    make_timestamptz(2027, 1, 7, 0, 0, 0, 'Europe/Luxembourg');
  c_gift_expires constant timestamptz :=
    make_timestamptz(2027, 1, 14, 0, 0, 0, 'Europe/Luxembourg');
  g record;
  v_amount double precision;
  v_gift bigint;
  v_new boolean := false;
begin
  if uid is null then raise exception 'advent: signin'; end if;
  if p_day is null or p_day not between 1 and 24 then
    raise exception 'advent: day';
  end if;
  if now() < advent_open_at(p_day) then raise exception 'advent: locked'; end if;
  if now() >= c_until then raise exception 'advent: over'; end if;

  for g in select * from advent_gift_days where day = p_day loop
    v_amount := advent_gift_amount(uid, g.game_id, g.pct, g.starter);
    insert into advent_gift_claims(user_id, day, game_id, amount)
    values (uid, p_day, g.game_id, v_amount)
    on conflict do nothing;
    if found then
      v_new := true;
      insert into game_gifts(user_id, game_id, amount, created_by, expires_at)
      values (uid, g.game_id, v_amount::numeric, null, c_gift_expires)
      returning id into v_gift;
      update advent_gift_claims set gift_id = v_gift
       where user_id = uid and day = p_day and game_id = g.game_id;
      insert into client_commands(created_by, target_user, action, game_id,
                                  reason, expires_at)
      values (null, uid, 'gift', g.game_id, null, now() + interval '60 minutes');
    end if;
  end loop;

  return jsonb_build_object('day', p_day, 'new', v_new,
    'gifts', (select jsonb_agg(jsonb_build_object(
                'game', c.game_id, 'amount', c.amount) order by c.game_id)
                from advent_gift_claims c
               where c.user_id = uid and c.day = p_day));
end $$;
revoke all on function public.advent_gift_open(int) from public, anon;
grant execute on function public.advent_gift_open(int) to authenticated;
