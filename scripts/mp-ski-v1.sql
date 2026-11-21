-- mp-ski-v1.sql (Nov 2026)
-- Ski Alpen joins the shared lobby: live races for 2-8 players on one piste (pb/ski.html inside the arcade frame, pb/ski/net/).
-- mp_invite() only accepts ids that exist in mp_games, so this row makes "Leit derbäisetzen" work; the browser takes the page,
-- the arcade id and the settings (resort, piste, weather, time, runs) from mp-games.js. No schema change, no new function:
-- the race itself runs over WebRTC between the players (Realtime only for the hand-shake), and each player's own time reaches
-- the per-piste boards through the normal score path (scripts/ski-v1.sql must be applied first: lower is better, min-time floor).
--
-- Run:  supabase db query --linked -f scripts/mp-ski-v1.sql      (idempotent)

insert into public.mp_games (id, name, page, min_players, max_players, lobby) values
  ('ski', 'Ski Alpen', 'pb/ski.html', 2, 8, true)
on conflict (id) do update
  set name = excluded.name, page = excluded.page,
      min_players = excluded.min_players, max_players = excluded.max_players, lobby = true, enabled = true;

select id, name, page, min_players, max_players, lobby, enabled from public.mp_games where id = 'ski';
