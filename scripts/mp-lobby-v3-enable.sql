-- mp-lobby-v3-enable.sql (Oct 2026)
-- Batch 3 of the shared lobby: Draw & Guess, Meme Caption Party and Guess the Song now start through lobby.html.
-- (The four arcade-iframe games - pong, tank-wars, fighters, air-hockey - are not in mp_games: they use arcade relay codes.)
--
-- Run:  supabase db query --linked -f scripts/mp-lobby-v3-enable.sql      (idempotent, no schema change)
-- The browser reads `lobby: true` from mp-games.js, not this column, so order does not matter (see mp-lobby-v2-enable.sql).

update public.mp_games set lobby = true where id in ('draw', 'meme', 'intro');

select id, lobby from public.mp_games order by lobby desc, id;
