-- briefing-v1.sql — Moies-Briefing push (Jul 2026)
-- Schedules pg_cron to call the `briefing` Edge
-- Function every morning. 05:00 UTC = 07:00 Luxembourg
-- in SUMMER (CEST). After the October DST switch it
-- fires 06:00 local — change '0 5 * * *' to
-- '0 6 * * *' then.
-- The secret must match:  supabase secrets set
-- BRIEFING_SECRET=...
--
-- The repo is public, so the value below is an OBVIOUS
-- placeholder — substitute the real one locally and
-- never commit it. It was a random hex string until
-- 6 Sep 2026, which no scanner (or human) could tell
-- apart from a live secret. Rotated 15 Jul 2026 after
-- the real one was committed.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job
  where jobname = 'morning-briefing';
select cron.schedule(
  'morning-briefing',
  '0 5 * * *',
  'select net.http_post(url := ''https://lvksqmgfw'
  'kfbblfsozfk.supabase.co/functions/v1/briefing'''
  ', headers := ''{"Content-Type": "application/js'
  'on", "x-briefing-secret": "REPLACE_WITH_BRIEFIN'
  'G_SECRET"}''::jsonb, body := ''{}''::jsonb)'
);
