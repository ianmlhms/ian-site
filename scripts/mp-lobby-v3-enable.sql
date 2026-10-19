-- mp-lobby-v3-enable.sql (Oct 2026)
-- Batch 3 of the shared lobby:
--   * Draw & Guess, Meme Caption Party, Guess the Song now start through lobby.html (flag flip, rows exist since v1)
--   * the four arcade games with an online mode (Pong, Tank Battles, Platform Fighters, Air Hockey) join the registry, so they can
--     be invited into a lobby (mp_invite only accepts ids that exist here). They run inside the arcade shell
--     (pixelbreak.html?g=<id>); the lobby code is their relay code. The browser takes the page/arcade link from mp-games.js.
--
-- Run:  supabase db query --linked -f scripts/mp-lobby-v3-enable.sql      (idempotent, no schema change)
-- The browser reads `lobby: true` from mp-games.js, not the column, so the order of this file and the deploy does not matter;
-- until it has run, the picker's «invite» for the four arcade games answers "not allowed" (everything else works).

update public.mp_games set lobby = true where id in ('draw', 'meme', 'intro');

insert into public.mp_games (id, name, page, min_players, max_players, lobby) values
  ('pong',       'Pong',              'pb/pong.html',       2, 2, true),
  ('tank-wars',  'Tank Battles',      'pb/tank-wars.html',  2, 2, true),
  ('fighters',   'Platform Fighters', 'pb/fighters.html',   2, 2, true),
  ('air-hockey', 'Air Hockey',        'pb/air-hockey.html', 2, 2, true)
on conflict (id) do update
  set name = excluded.name, page = excluded.page,
      min_players = excluded.min_players, max_players = excluded.max_players, lobby = true;

select id, lobby from public.mp_games order by lobby desc, id;
