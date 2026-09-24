-- ==========================================
-- Hausaufgaben board fed from WebUntis
-- (24 Sep 2026). webuntis-sync upserts the
-- class's homework into class_homework,
-- keyed by untis_id. Synced rows have no
-- author (created_by null), so only admins
-- can delete them. Safe to re-run.
-- ==========================================
alter table public.class_homework
  add column if not exists untis_id bigint;

create unique index if not exists
  class_homework_untis_id_key
  on public.class_homework(untis_id);

alter table public.class_homework
  alter column created_by drop not null;
