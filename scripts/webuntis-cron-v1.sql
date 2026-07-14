-- webuntis-cron-v1.sql — daily homework auto-sync
-- Calls the webuntis-sync Edge Function each morning.
-- 04:30 UTC = 06:30 Luxembourg in SUMMER (CEST); after
-- the October DST switch it fires 05:30 local — change
-- '30 4 * * *' to '30 5 * * *' then, if it matters.
-- The secret must match:  supabase secrets set
-- WEBUNTIS_CRON_SECRET=...  (repo copy holds a
-- placeholder — real value handed in chat only).
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
  ' "x-cron-secret": "967ad067042bf76a4cb74442c486357'
  'a24cc3ac32331eec3"}''::jsonb, body := ''{}''::json'
  'b)'
);
