-- webuntis-cron-v1.sql — daily homework auto-sync
-- Calls the webuntis-sync Edge Function each morning.
-- 04:30 UTC = 06:30 Luxembourg in SUMMER (CEST); after
-- the October DST switch it fires 05:30 local — change
-- '30 4 * * *' to '30 5 * * *' then, if it matters.
--
-- SECURITY (11 Aug 2026): this file used to contain the
-- REAL secret, and the repo is public, so it was
-- readable by anyone on GitHub. The secret has been
-- rotated; the value below is a genuine placeholder and
-- must stay one.
--
-- To change it again:
--   openssl rand -hex 24
--   supabase secrets set WEBUNTIS_CRON_SECRET=<value>
-- then run this file with the same value substituted
-- LOCALLY (never commit it). The function fails closed,
-- so a mismatch means the sync stops — it never opens.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job
  where jobname = 'webuntis-homework-sync';
select cron.schedule(
  'webuntis-homework-sync',
  '30 4 * * *',
  'select net.http_post(url := ''https://lvksqmgfwkfb'
  'blfsozfk.supabase.co/functions/v1/webuntis-sync'','
  ' headers := ''{"Content-Type": "application/json",'
  ' "x-cron-secret": "REPLACE_WITH_WEBUNTIS_CRON_SECR'
  'ET"}''::jsonb, body := ''{}''::jsonb)'
);
