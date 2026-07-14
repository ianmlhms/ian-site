-- briefing-v1.sql — Moies-Briefing push (Jul 2026)
-- Schedules pg_cron to call the `briefing` Edge
-- Function every morning. 05:00 UTC = 07:00 Luxembourg
-- in SUMMER (CEST). After the October DST switch it
-- fires 06:00 local — change '0 5 * * *' to
-- '0 6 * * *' then.
-- The secret must match:  supabase secrets set
-- BRIEFING_SECRET=...  (repo copy holds a placeholder
-- — the repo is public, never commit the real value;
-- rotated 15 Jul 2026 after the old one was committed).
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
  'on", "x-briefing-secret": "52659c4cfd31e5a0e990'
  'a62445b57427861b421d131f616c"}''::jsonb, body :'
  '= ''{}''::jsonb)'
);
