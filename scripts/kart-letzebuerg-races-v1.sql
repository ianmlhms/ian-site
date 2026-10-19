-- kart-letzebuerg-races-v1.sql (Oct 2026)
-- Logs every ONLINE race of Kart Lëtzebuerg (pb/kart-letzebuerg.html) with all its players, so the admin can later see who raced whom.
-- Only races with at least 2 human players are recorded (never solo / time trial). One row per race; each Grand Prix round is its own row.
--
--   public.kart_races              the log (RLS on, NO policies: the browser can neither read nor write it directly)
--   public.record_kart_race(p)     the only way in. anon + authenticated (guests can host too). The host client calls it ONCE at the
--                                  end of the race; a repeat call (e.g. a new host after a host migration) is harmless (race_key dedup).
--   public.admin_kart_races(n)     admin only (is_admin(), messenger-setup-v2.sql): the latest n races, newest first.
--
-- Everything the client sends is validated here (never trust the browser): track id, mode, laps 1-5, 2-8 players, strings <= 24 chars,
-- places 1..n unique, times within sane bounds, human_count = number of non-bot players and >= 2. The stored players array is rebuilt
-- from the validated fields, not copied from the request. Abuse guard: payload <= 4000 characters, max 20 rows per room and max 150 rows
-- overall per 10 minutes. user_id is whatever the host client reports for a player (the host learns it from the player's own client);
-- "reporter" is the verified auth.uid() of the caller (null for a guest host).
--
-- Run:  supabase db query --linked -f scripts/kart-letzebuerg-races-v1.sql
-- Until it has run, the game just logs a console warning after an online race (nothing else breaks).

-- 1. table
create table if not exists public.kart_races (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  room         text not null,
  race_key     text not null,
  track        text not null,
  mode         text not null,
  cup          text,
  gp_round     int,
  laps         int not null,
  weather      text not null,
  human_count  int not null,
  reporter     uuid,
  players      jsonb not null,
  constraint kart_races_room_key_uk unique (room, race_key),
  constraint kart_races_mode_ck check (mode in ('race', 'gp')),
  constraint kart_races_laps_ck check (laps between 1 and 5),
  constraint kart_races_humans_ck check (human_count between 2 and 8),
  constraint kart_races_players_ck check (jsonb_typeof(players) = 'array' and jsonb_array_length(players) between 2 and 8)
);
create index if not exists kart_races_created_idx on public.kart_races (created_at desc);

-- 2. RLS on and no policy at all = no direct access for anon / authenticated (the RPCs below are security definer)
alter table public.kart_races enable row level security;
revoke all on public.kart_races from anon, authenticated;

-- 3. tiny validation helpers (internal, not callable from the browser)
-- integer in [lo, hi] out of a jsonb number, else null
create or replace function public.kart_races_int(j jsonb, lo bigint, hi bigint)
  returns bigint
  language sql
  immutable
  set search_path = public
  as '
select case
  when j is not null and jsonb_typeof(j) = ''number''
   and (j #>> ''{}'')::numeric = trunc((j #>> ''{}'')::numeric)
   and (j #>> ''{}'')::numeric between lo and hi
  then (j #>> ''{}'')::numeric::bigint
  else null end';

-- string out of a jsonb string if it matches the pattern, else null
create or replace function public.kart_races_txt(j jsonb, pat text)
  returns text
  language sql
  immutable
  set search_path = public
  as '
select case
  when j is not null and jsonb_typeof(j) = ''string'' and (j #>> ''{}'') ~ pat
  then (j #>> ''{}'')
  else null end';

revoke execute on function public.kart_races_int(jsonb, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.kart_races_txt(jsonb, text) from public, anon, authenticated;

-- 4. record one finished online race
create or replace function public.record_kart_race(p jsonb)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  c_name constant text := ''^[^[:cntrl:]<>&"`]{1,24}$'';
  c_uuid constant text := ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'';
  v_room text;
  v_key text;
  v_track text;
  v_mode text;
  v_cup text;
  v_round int;
  v_laps int;
  v_weather text;
  v_declared int;
  v_humans int;
  v_n int;
  v_count int;
  v_pl jsonb;
  v_name text;
  v_driver text;
  v_bot boolean;
  v_uid uuid;
  v_place int;
  v_time bigint;
  v_best bigint;
  v_places int[] := ''{}'';
  v_out jsonb := ''[]'';
  v_id bigint;
begin
  if p is null or jsonb_typeof(p) <> ''object'' then
    raise exception ''bad payload'';
  end if;
  if length(p::text) > 4000 then
    raise exception ''payload too large'';
  end if;

  v_room := upper(public.kart_races_txt(p -> ''room'', ''^[A-Za-z0-9]{4,10}$''));
  v_key := public.kart_races_txt(p -> ''race_key'', ''^[A-Za-z0-9._-]{1,40}$'');
  v_track := public.kart_races_txt(p -> ''track'', ''^(villehaute|kirchberg|grund|belval|zockerland|aisbierg|vulkan|geeschterschlass)$'');
  v_mode := public.kart_races_txt(p -> ''mode'', ''^(race|gp)$'');
  v_weather := public.kart_races_txt(p -> ''weather'', ''^(day|sunset|night|rain|fog|snow)$'');
  v_laps := public.kart_races_int(p -> ''laps'', 1, 5);
  v_declared := public.kart_races_int(p -> ''human_count'', 2, 8);
  if v_room is null or v_key is null or v_track is null or v_mode is null or v_weather is null
     or v_laps is null or v_declared is null then
    raise exception ''bad race'';
  end if;

  if v_mode = ''gp'' then
    v_cup := public.kart_races_txt(p -> ''cup'', ''^[a-z0-9_]{1,24}$'');
    v_round := public.kart_races_int(p -> ''gp_round'', 1, 8);
    if v_cup is null or v_round is null then
      raise exception ''bad grand prix'';
    end if;
  else
    if jsonb_typeof(coalesce(p -> ''cup'', ''null'')) <> ''null'' or jsonb_typeof(coalesce(p -> ''gp_round'', ''null'')) <> ''null'' then
      raise exception ''bad race'';
    end if;
  end if;

  if jsonb_typeof(p -> ''players'') is distinct from ''array'' then
    raise exception ''bad players'';
  end if;
  v_n := jsonb_array_length(p -> ''players'');
  if v_n < 2 or v_n > 8 then
    raise exception ''bad player count'';
  end if;

  v_humans := 0;
  for v_pl in select e from jsonb_array_elements(p -> ''players'') e loop
    if jsonb_typeof(v_pl) <> ''object'' then
      raise exception ''bad player'';
    end if;
    v_name := public.kart_races_txt(v_pl -> ''name'', c_name);
    v_driver := public.kart_races_txt(v_pl -> ''driver'', ''^[a-z0-9_-]{1,24}$'');
    v_place := public.kart_races_int(v_pl -> ''place'', 1, v_n);
    if v_name is null or btrim(v_name) = '''' or v_driver is null or v_place is null then
      raise exception ''bad player'';
    end if;
    if jsonb_typeof(v_pl -> ''bot'') is distinct from ''boolean'' then
      raise exception ''bad player'';
    end if;
    v_bot := (v_pl ->> ''bot'')::boolean;
    if v_place = any (v_places) then
      raise exception ''duplicate place'';
    end if;
    v_places := v_places || v_place;

    v_uid := null;
    if jsonb_typeof(coalesce(v_pl -> ''user_id'', ''null'')) <> ''null'' then
      if v_bot or public.kart_races_txt(v_pl -> ''user_id'', c_uuid) is null then
        raise exception ''bad user id'';
      end if;
      v_uid := (v_pl ->> ''user_id'')::uuid;
    end if;

    v_time := null;
    if jsonb_typeof(coalesce(v_pl -> ''time_ms'', ''null'')) <> ''null'' then
      v_time := public.kart_races_int(v_pl -> ''time_ms'', 5000, 3600000);
      if v_time is null then raise exception ''bad time''; end if;
    end if;
    v_best := null;
    if jsonb_typeof(coalesce(v_pl -> ''best_lap_ms'', ''null'')) <> ''null'' then
      v_best := public.kart_races_int(v_pl -> ''best_lap_ms'', 3000, 3600000);
      if v_best is null or (v_time is not null and v_best > v_time) then raise exception ''bad lap time''; end if;
    end if;

    if not v_bot then v_humans := v_humans + 1; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      ''name'', v_name,
      ''user_id'', v_uid,
      ''guest'', (not v_bot and v_uid is null),
      ''bot'', v_bot,
      ''place'', v_place,
      ''time_ms'', v_time,
      ''best_lap_ms'', v_best,
      ''driver'', v_driver));
  end loop;

  if v_humans < 2 or v_humans <> v_declared then
    raise exception ''human count mismatch'';
  end if;

  -- abuse guard (an exact repeat of a recorded race is answered below, so check the limits first only for new races)
  if not exists (select 1 from public.kart_races where room = v_room and race_key = v_key) then
    select count(*) into v_count from public.kart_races
     where room = v_room and created_at > now() - interval ''10 minutes'';
    if v_count >= 20 then
      raise exception ''rate limited'';
    end if;
    select count(*) into v_count from public.kart_races
     where created_at > now() - interval ''10 minutes'';
    if v_count >= 150 then
      raise exception ''rate limited'';
    end if;
  end if;

  insert into public.kart_races
      (room, race_key, track, mode, cup, gp_round, laps, weather, human_count, reporter, players)
    values
      (v_room, v_key, v_track, v_mode, v_cup, v_round, v_laps, v_weather, v_humans, auth.uid(), v_out)
    on conflict (room, race_key) do nothing
    returning id into v_id;
  return v_id;
end';
revoke execute on function public.record_kart_race(jsonb) from public;
grant execute on function public.record_kart_race(jsonb) to anon, authenticated;

-- 5. admin: latest races, newest first (p_limit 1..500)
create or replace function public.admin_kart_races(p_limit int default 50)
  returns setof public.kart_races
  language plpgsql
  stable
  security definer
  set search_path = public
  as '
begin
  if not coalesce(public.is_admin(), false) then
    raise exception ''not authorized'' using errcode = ''42501'';
  end if;
  return query
    select * from public.kart_races
     order by created_at desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 500);
end';
revoke execute on function public.admin_kart_races(int) from public, anon;
grant execute on function public.admin_kart_races(int) to authenticated;
