-- mp-casino-v1.sql (Nov 2026)
-- Two casino games join the shared lobby: Roulette (2–8 players) and Blackjack (2–7 players at one table vs the dealer).
-- Play chips only: everybody starts each match with the same chips, nothing is bought, nothing carries over,
-- nothing reaches the leaderboards. mp_invite() only accepts ids that exist in mp_games, so these rows make
-- "Leit derbäisetzen" work for both; the browser takes page/settings from mp-games.js.
--
-- Run:  supabase db query --linked -f scripts/mp-casino-v1.sql      (idempotent, no schema change)

insert into public.mp_games (id, name, page, min_players, max_players, lobby) values
  ('roulette',  'Roulette',  'roulette.html',  2, 8, true),
  ('blackjack', 'Blackjack', 'blackjack.html', 2, 7, true)
on conflict (id) do update
  set name = excluded.name, page = excluded.page,
      min_players = excluded.min_players, max_players = excluded.max_players, lobby = true, enabled = true;

select id, name, min_players, max_players, lobby, enabled from public.mp_games where id in ('roulette', 'blackjack') order by id;
