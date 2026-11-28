-- Ski Alpen, Via Lattea: two ski routes added from the owner's GPS tracks (28 Nov 2026, scripts/ski/add_gps_pistes.py).
-- Additive only (INSERT, on conflict do nothing); the same two rows are in scripts/ski-v1.sql.
-- Floor = floor(client length / 33 m/s) in whole seconds (scripts/ski/make_sql.py client_length).
insert into public.ski_board_floors (board, min_ms, max_ms) values
  ('ski-vialattea-verbindung-pariol-cesana', 35000, null),
  ('ski-vialattea-34-vecchia', 47000, null)
on conflict (board) do nothing;
