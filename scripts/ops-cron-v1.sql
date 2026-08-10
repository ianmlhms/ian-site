-- ops-cron-v1.sql — Mac mini health check + push
-- Calls the `ops` Edge Function every 5 minutes. It
-- only writes an alert (and pushes) when a service
-- CHANGES health, so a dead service does not push
-- every five minutes.
--
-- BEFORE RUNNING: replace REPLACE_WITH_OPS_CRON_SECRET
-- below with a secret you generate yourself, e.g.
--   openssl rand -hex 24
-- and set the SAME value on the function with
--   supabase secrets set OPS_CRON_SECRET=...
-- The repo is PUBLIC — do not commit the real value.
-- The function fails closed: with OPS_CRON_SECRET
-- unset, nobody can reach the check path at all.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job
  where jobname = 'ops-service-check';
select cron.schedule(
  'ops-service-check',
  '*/5 * * * *',
  'select net.http_post(url := ''https://lvksqmgfwkfb'
  'blfsozfk.supabase.co/functions/v1/ops'', headers :'
  '= ''{"Content-Type": "application/json", "x-cron-s'
  'ecret": "REPLACE_WITH_OPS_CRON_SECRET"}''::jsonb, '
  'body := ''{"action":"check"}''::jsonb)'
);
