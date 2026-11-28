-- Ski Alpen: floors for the pistes added to LIVE resorts by scripts/ski/add_pistes.py (28 Nov 2026, missing-pistes round).
-- ADDITIVE only: new rows, nothing is updated or deleted (idempotent: on conflict do nothing).
insert into public.ski_board_floors (board, min_ms, max_ms) values
  ('ski-arlberg-fang', 37000, null),
  ('ski-arlberg-piste-angerlift', 3000, null),
  ('ski-arlberg-furka-steinmahder-zugerberg', 9000, null),
  ('ski-davos-rinerhorn-3', 11000, null),
  ('ski-davos-rinerhorn-18', 28000, null),
  ('ski-davos-gotschnaboden-klosters', 96000, null),
  ('ski-davos-schatzalp-2', 46000, null),
  ('ski-obertauern-sonnenlift-1-15e', 6000, null),
  ('ski-zermatt-baby-cretaz', 3000, null),
  ('ski-zermatt-riedweg-2a', 13000, null),
  ('ski-zermatt-howette-3', 10000, null),
  ('ski-zermatt-murmelbodmen-15b', 10000, null)
on conflict (board) do nothing;
