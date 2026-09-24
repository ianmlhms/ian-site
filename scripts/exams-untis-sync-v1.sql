-- ==========================================
-- Tester board fed from WebUntis (24 Sep 2026)
-- The webuntis-sync Edge Function (daily
-- pg_cron, 04:30 UTC) now also calls
-- getExams2017 and upserts the class's tests
-- into public.exams, keyed by untis_id.
-- Manually added tests keep untis_id null.
-- Safe to re-run.
-- ==========================================
alter table public.exams
  add column if not exists untis_id bigint;

create unique index if not exists
  exams_untis_id_key
  on public.exams(untis_id);
