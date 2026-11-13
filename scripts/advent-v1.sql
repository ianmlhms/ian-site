-- =============================================
-- Advent calendar v1 (advent.html), Dec 2026.
-- 24 doors; door N opens N Dec 00:00 Europe/Luxembourg.
-- Door content AND answers live only in advent_doors,
-- which no client role can read. Content is handed out
-- by advent_door() once the door is open; answers are
-- only ever compared inside advent_check().
-- The seed with the real puzzles is NOT in this public
-- repo (OneDrive/AdventCalendar/advent-doors-seed.sql).
-- Idempotent.
-- =============================================

create table if not exists public.advent_doors(
  day int primary key check (day between 1 and 24),
  kind text not null,
  content jsonb not null default '{}'::jsonb,
  answer jsonb not null default '{}'::jsonb
);
alter table public.advent_doors enable row level security;
revoke all on public.advent_doors
  from public, anon, authenticated;
grant all on public.advent_doors to service_role;

create table if not exists public.advent_players(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  user_id uuid unique references auth.users(id)
    on delete cascade,
  token_hash text unique,
  created_at timestamptz not null default now(),
  check (user_id is not null or token_hash is not null)
);
create unique index if not exists advent_players_name_ci
  on public.advent_players (lower(name));
alter table public.advent_players enable row level security;
revoke all on public.advent_players
  from public, anon, authenticated;
grant all on public.advent_players to service_role;

create table if not exists public.advent_progress(
  player_id uuid not null
    references public.advent_players(id) on delete cascade,
  day int not null check (day between 1 and 24),
  opened_at timestamptz not null default now(),
  solved_at timestamptz,
  wrong int not null default 0,
  last_try_at timestamptz,
  primary key (player_id, day)
);
alter table public.advent_progress enable row level security;
revoke all on public.advent_progress
  from public, anon, authenticated;
grant all on public.advent_progress to service_role;

-- ---------- constants & helpers ----------

create or replace function public.advent_open_at(p_day int)
returns timestamptz language sql immutable as $$
  select make_timestamptz(2026, 12, p_day, 0, 0, 0,
                          'Europe/Luxembourg');
$$;

-- Seconds added to a solve time per wrong answer.
create or replace function public.advent_penalty_s()
returns int language sql immutable as 'select 60';

create or replace function public.advent_norm(p text)
returns text language sql immutable as $$
  select regexp_replace(
    translate(lower(coalesce(p, '')),
      'ëéèêäàâáöôóüûúîïíçß',
      'eeeeaaaaooouuuiiics'),
    '[^a-z0-9]', '', 'g');
$$;

create or replace function public.advent_hash(p_token text)
returns text language sql immutable as $$
  select encode(extensions.digest(
    coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- The calling player: a signed-in ian.lu account wins,
-- otherwise the guest token. Null when not joined.
create or replace function public.advent_player_id(
  p_token text)
returns uuid language sql stable security definer
set search_path = public as $$
  select id from public.advent_players
  where (auth.uid() is not null and user_id = auth.uid())
     or (auth.uid() is null and p_token is not null
         and length(p_token) >= 32
         and token_hash = public.advent_hash(p_token))
  limit 1;
$$;

-- ---------- join ----------

-- Signed in: joins with the account's username (p_name
-- ignored). Guest: joins with p_name and gets a secret
-- token back (shown once; the client keeps it).
create or replace function public.advent_join(p_name text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(
    coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_token text;
  v_id uuid;
begin
  if v_uid is not null then
    select id, name into v_id, v_name
      from advent_players where user_id = v_uid;
    if v_id is not null then
      return jsonb_build_object('name', v_name,
        'account', true);
    end if;
    select username into v_name
      from profiles where id = v_uid;
    if coalesce(v_name, '') = '' then
      raise exception 'advent: no username';
    end if;
    if exists (select 1 from advent_players
               where lower(name) = lower(v_name)) then
      raise exception 'advent: name taken';
    end if;
    insert into advent_players(name, user_id)
      values (v_name, v_uid);
    return jsonb_build_object('name', v_name,
      'account', true);
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 20
     or v_name !~ '^[[:alnum:] ._''-]+$' then
    raise exception 'advent: bad name';
  end if;
  -- A guest may not borrow an existing ian.lu username.
  if exists (select 1 from profiles
             where lower(username) = lower(v_name))
     or exists (select 1 from advent_players
                where lower(name) = lower(v_name)) then
    raise exception 'advent: name taken';
  end if;
  if (select count(*) from advent_players) >= 500 then
    raise exception 'advent: full';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into advent_players(name, token_hash)
    values (v_name, advent_hash(v_token));
  return jsonb_build_object('name', v_name,
    'token', v_token, 'account', false);
end $$;

-- ---------- overview ----------

-- Who am I + the 24 doors (open time, my state). No
-- puzzle content here.
create or replace function public.advent_overview(
  p_token text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  v_pid uuid := advent_player_id(p_token);
  v_name text;
begin
  select name into v_name from advent_players
    where id = v_pid;
  return jsonb_build_object(
    'now', now(),
    'me', case when v_pid is null then null else
      jsonb_build_object('name', v_name,
        'account', (select user_id is not null
          from advent_players where id = v_pid)) end,
    'admin', is_admin(),
    'doors', (select jsonb_agg(jsonb_build_object(
        'day', d,
        'open_at', advent_open_at(d),
        'open', now() >= advent_open_at(d),
        'opened', pr.opened_at is not null,
        'solved', pr.solved_at is not null,
        'time_s', case when pr.solved_at is null then null
          else extract(epoch from pr.solved_at
            - pr.opened_at)::int
            + pr.wrong * advent_penalty_s() end
      ) order by d)
      from generate_series(1, 24) d
      left join advent_progress pr
        on pr.player_id = v_pid and pr.day = d));
end $$;

-- ---------- door ----------

-- Content of an open door. Starts the player's clock on
-- first open. Admins may preview locked doors (no clock).
create or replace function public.advent_door(
  p_token text, p_day int)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  v_pid uuid := advent_player_id(p_token);
  v_open boolean := now() >= advent_open_at(p_day);
  v_door advent_doors%rowtype;
  v_pr advent_progress%rowtype;
begin
  if p_day is null or p_day < 1 or p_day > 24 then
    raise exception 'advent: bad day';
  end if;
  if not v_open and not is_admin() then
    raise exception 'advent: locked';
  end if;
  select * into v_door from advent_doors where day = p_day;
  if not found then
    raise exception 'advent: not ready';
  end if;
  if v_pid is not null and v_open then
    insert into advent_progress(player_id, day)
      values (v_pid, p_day)
      on conflict do nothing;
    select * into v_pr from advent_progress
      where player_id = v_pid and day = p_day;
  end if;
  return jsonb_build_object(
    'day', p_day, 'kind', v_door.kind,
    'content', v_door.content,
    'preview', not v_open,
    'solved', v_pr.solved_at is not null,
    'wrong', coalesce(v_pr.wrong, 0),
    'time_s', case when v_pr.solved_at is null then null
      else extract(epoch from v_pr.solved_at
        - v_pr.opened_at)::int
        + v_pr.wrong * advent_penalty_s() end,
    'reveal', case when v_pr.solved_at is null then null
      else v_door.answer -> 'reveal' end);
end $$;

-- ---------- answer check ----------

-- Pure comparison of a submitted answer with a door's
-- stored answer. Never callable by clients.
create or replace function public.advent_matches(
  p_kind text, p_answer jsonb, p_given jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_lat float8; v_lon float8; v_km float8;
begin
  case p_answer ->> 'type'
  when 'text' then
    return advent_norm(p_given ->> 'text') <> ''
      and exists (
        select 1 from jsonb_array_elements_text(
          p_answer -> 'accept') a
        where advent_norm(a) = advent_norm(
          p_given ->> 'text'));
  when 'number' then
    return (p_given ->> 'n') ~ '^-?[0-9]+([.,][0-9]+)?$'
      and abs(replace(p_given ->> 'n', ',', '.')::numeric
        - (p_answer ->> 'n')::numeric)
        <= coalesce((p_answer ->> 'tol')::numeric, 0);
  when 'choice' then
    return (p_given ->> 'choice') = (p_answer ->> 'choice');
  when 'order' then
    return (p_given -> 'order') = (p_answer -> 'order');
  when 'point' then
    if jsonb_typeof(p_given -> 'lat') <> 'number'
       or jsonb_typeof(p_given -> 'lon') <> 'number' then
      return false;
    end if;
    v_lat := (p_given ->> 'lat')::float8;
    v_lon := (p_given ->> 'lon')::float8;
    -- Haversine, km.
    v_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(v_lat
        - (p_answer ->> 'lat')::float8) / 2), 2)
      + cos(radians(v_lat))
        * cos(radians((p_answer ->> 'lat')::float8))
        * power(sin(radians(v_lon
          - (p_answer ->> 'lon')::float8) / 2), 2)));
    return v_km <= (p_answer ->> 'km')::float8;
  else
    return false;
  end case;
end $$;
revoke all on function public.advent_matches(
  text, jsonb, jsonb) from public, anon, authenticated;

-- Wrong answers before the throttle kicks in, then one
-- try per throttle window.
create or replace function public.advent_check(
  p_token text, p_day int, p_given jsonb)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  c_free_tries constant int := 10;
  c_throttle constant interval := interval '20 seconds';
  v_pid uuid := advent_player_id(p_token);
  v_open boolean := now() >= advent_open_at(p_day);
  v_door advent_doors%rowtype;
  v_pr advent_progress%rowtype;
  v_ok boolean;
begin
  if p_day is null or p_day < 1 or p_day > 24 then
    raise exception 'advent: bad day';
  end if;
  if p_given is null or length(p_given::text) > 2000 then
    raise exception 'advent: bad answer';
  end if;
  select * into v_door from advent_doors where day = p_day;
  if not found then
    raise exception 'advent: not ready';
  end if;
  -- Admin preview of a locked door: check, record nothing.
  if not v_open then
    if not is_admin() then
      raise exception 'advent: locked';
    end if;
    return jsonb_build_object('correct', advent_matches(
      v_door.kind, v_door.answer, p_given),
      'preview', true);
  end if;
  if v_pid is null then
    raise exception 'advent: join first';
  end if;
  select * into v_pr from advent_progress
    where player_id = v_pid and day = p_day for update;
  if not found then
    raise exception 'advent: open the door first';
  end if;
  if v_pr.solved_at is not null then
    return jsonb_build_object('correct', true,
      'already', true);
  end if;
  if v_pr.wrong >= c_free_tries
     and v_pr.last_try_at > now() - c_throttle then
    return jsonb_build_object('correct', false,
      'wait_s', ceil(extract(epoch from
        v_pr.last_try_at + c_throttle - now()))::int);
  end if;
  v_ok := advent_matches(v_door.kind, v_door.answer,
    p_given);
  if v_ok then
    update advent_progress set solved_at = now(),
      last_try_at = now()
      where player_id = v_pid and day = p_day
      returning * into v_pr;
    return jsonb_build_object('correct', true,
      'wrong', v_pr.wrong,
      'time_s', extract(epoch from v_pr.solved_at
        - v_pr.opened_at)::int
        + v_pr.wrong * advent_penalty_s(),
      'reveal', v_door.answer -> 'reveal');
  end if;
  update advent_progress set wrong = wrong + 1,
    last_try_at = now()
    where player_id = v_pid and day = p_day
    returning * into v_pr;
  return jsonb_build_object('correct', false,
    'wrong', v_pr.wrong,
    'penalty_s', advent_penalty_s());
end $$;

-- ---------- leaderboard ----------

-- Public. Overall: most doors, then least total time.
-- Per day: fastest 10 for every open door.
create or replace function public.advent_board()
returns jsonb language sql stable security definer
set search_path = public as $$
  with solves as (
    select p.name, (p.user_id is not null) as account,
      pr.day,
      extract(epoch from pr.solved_at - pr.opened_at)::int
        + pr.wrong * advent_penalty_s() as t
    from advent_progress pr
    join advent_players p on p.id = pr.player_id
    where pr.solved_at is not null
  ), overall as (
    select name, account, count(*) as doors,
      sum(t) as total_s
    from solves group by name, account
  ), ranked as (
    select day, name, account, t,
      row_number() over (partition by day
        order by t, name) as rn
    from solves
  )
  select jsonb_build_object(
    'overall', coalesce((select jsonb_agg(
        jsonb_build_object('name', name,
          'account', account, 'doors', doors,
          'total_s', total_s)
        order by doors desc, total_s, name)
      from (select * from overall
            order by doors desc, total_s, name
            limit 100) o), '[]'::jsonb),
    'days', coalesce((select jsonb_object_agg(day, rows)
      from (select day, jsonb_agg(jsonb_build_object(
          'name', name, 'account', account, 'time_s', t)
          order by rn) as rows
        from ranked where rn <= 10 group by day) d),
      '{}'::jsonb));
$$;

-- ---------- admin ----------

create or replace function public.advent_admin_remove(
  p_name text)
returns int language plpgsql security definer
set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then
    raise exception 'advent: admin only';
  end if;
  delete from advent_players
    where lower(name) = lower(btrim(p_name));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- grants ----------

revoke all on function public.advent_player_id(text)
  from public, anon, authenticated;
grant execute on function public.advent_join(text)
  to anon, authenticated;
grant execute on function public.advent_overview(text)
  to anon, authenticated;
grant execute on function public.advent_door(text, int)
  to anon, authenticated;
grant execute on function
  public.advent_check(text, int, jsonb)
  to anon, authenticated;
grant execute on function public.advent_board()
  to anon, authenticated;
grant execute on function public.advent_admin_remove(text)
  to authenticated;
