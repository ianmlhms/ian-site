-- kart-letzebuerg-races-v2.sql (Oct 2026)
-- Adds connection diagnostics to the per-race log of Kart Lëtzebuerg (run AFTER kart-letzebuerg-races-v1.sql; safe to run more than once).
-- Motivation: on 20 Oct 2026 an online race at school lost players "mid round" and the log could not tell who had been dropped,
-- because dropped karts are turned into bots that still finish. Every HUMAN player entry in kart_races.players may now carry:
--
--   link          'p2p' | 'relay' | 'mixed'   how this player was connected to the host during the race
--                                              (the host's own entry: 'p2p' if every client is direct, 'relay' if every client
--                                               runs through the Realtime relay, 'mixed' otherwise)
--   dropped_at_s  number 0..7200 | null        race-clock seconds at which the player was dropped for good (his kart became a bot
--                                              because his connection was lost or he left); null = never dropped
--   away_s        number 0..7200               total seconds his kart was steered by the bot because his packets stopped / the tab was hidden
--
-- All three are optional and strictly validated: they are only accepted on human entries, `link` must be present when one of the others is,
-- numbers are rounded to 1 decimal. A request without them (the old client) is accepted exactly as before, and the v1 function also
-- ignored unknown keys, so old and new clients both work before and after this file has been applied.
--
-- Run:  supabase db query --linked -f scripts/kart-letzebuerg-races-v2.sql
-- Read: select created_at, room, track, human_count, players from public.kart_races order by id desc limit 20;
--       (or the admin_kart_races RPC); e.g. players with dropped_at_s:  where players @> '[{"link":"relay"}]'

-- 3b. one more validation helper (internal): a json number in [lo, hi] rounded to 1 decimal, else null
create or replace function public.kart_races_num(j jsonb, lo numeric, hi numeric)
  returns numeric
  language sql
  immutable
  set search_path = public
  as '
select case
  when j is not null and jsonb_typeof(j) = ''number''
   and (j #>> ''{}'')::numeric between lo and hi
  then round((j #>> ''{}'')::numeric, 1)
  else null end';
revoke execute on function public.kart_races_num(jsonb, numeric, numeric) from public, anon, authenticated;

-- 4. record one finished online race (v2: + optional per-player diagnostics)
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
  v_link text;
  v_drop numeric;
  v_away numeric;
  v_ent jsonb;
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
    -- names are cleaned, not rejected (one odd guest name must not lose the whole race)
    v_name := null;
    if jsonb_typeof(v_pl -> ''name'') = ''string'' then
      v_name := left(btrim(regexp_replace(v_pl ->> ''name'', ''[[:cntrl:]<>&"`]'', '''', ''g'')), 24);
      if v_name !~ c_name then v_name := null; end if;
    end if;
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

    -- v2 diagnostics (optional, humans only)
    v_link := null; v_drop := null; v_away := null;
    if jsonb_typeof(coalesce(v_pl -> ''link'', ''null'')) <> ''null'' then
      v_link := public.kart_races_txt(v_pl -> ''link'', ''^(p2p|relay|mixed)$'');
      if v_link is null or v_bot then raise exception ''bad player''; end if;
    end if;
    if jsonb_typeof(coalesce(v_pl -> ''dropped_at_s'', ''null'')) <> ''null'' then
      v_drop := public.kart_races_num(v_pl -> ''dropped_at_s'', 0, 7200);
      if v_drop is null or v_bot or v_link is null then raise exception ''bad player''; end if;
    end if;
    if jsonb_typeof(coalesce(v_pl -> ''away_s'', ''null'')) <> ''null'' then
      v_away := public.kart_races_num(v_pl -> ''away_s'', 0, 7200);
      if v_away is null or v_bot or v_link is null then raise exception ''bad player''; end if;
    end if;

    if not v_bot then v_humans := v_humans + 1; end if;
    v_ent := jsonb_build_object(
      ''name'', v_name,
      ''user_id'', v_uid,
      ''guest'', (not v_bot and v_uid is null),
      ''bot'', v_bot,
      ''place'', v_place,
      ''time_ms'', v_time,
      ''best_lap_ms'', v_best,
      ''driver'', v_driver);
    if v_link is not null then
      v_ent := v_ent || jsonb_build_object(''link'', v_link, ''dropped_at_s'', v_drop, ''away_s'', coalesce(v_away, 0));
    end if;
    v_out := v_out || jsonb_build_array(v_ent);
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

