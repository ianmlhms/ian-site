-- mp-lobby-v2-enable.sql (Oct 2026)
-- Marks the games that now start through the shared lobby (lobby.html) in the registry table.
--
-- Run AFTER scripts/mp-lobby-v1.sql (already applied):   supabase db query --linked -f scripts/mp-lobby-v2-enable.sql
-- Idempotent, safe to re-run. No schema change, no new function.
--
-- The browser does NOT read mp_games.lobby: which games open the lobby is decided by `lobby: true` in mp-games.js (shipped
-- with the pages). This column only documents the same fact for the database / admin views, so the pages work whether or
-- not this file has been run. Order does not matter.

update public.mp_games set lobby = true
 where id in (
   'tictactoe', 'battleship', 'reversi', 'dots', 'checkers', 'maumau', 'dice-duel',   -- 2-player GameCommon games
   'color'                                                                            -- Colour Guess (2-8 players, rounds + mode)
 );

-- check
select id, lobby from public.mp_games order by lobby desc, id;
