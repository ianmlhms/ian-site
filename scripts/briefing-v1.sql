-- briefing-v1.sql — Moies-Briefing push (Jul 2026)
-- Schedules pg_cron to call the `briefing` Edge Function every morning.
-- 05:00 UTC = 07:00 Luxembourg in SUMMER (CEST). After the October DST
-- switch it fires 06:00 local — change '0 5 * * *' to '0 6 * * *' then.
-- The secret below must match:  supabase secrets set BRIEFING_SECRET=...
-- One statement per line; paste into the Supabase SQL editor and run.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'morning-briefing';
select cron.schedule('morning-briefing', '0 5 * * *', 'select net.http_post(url := ''https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/briefing'', headers := ''{"Content-Type": "application/json", "x-briefing-secret": "9f4c2ab81d6e37f5c0a9284b6d1e5f3a7c8b90d2e4f6a1c3"}''::jsonb, body := ''{}''::jsonb)');
