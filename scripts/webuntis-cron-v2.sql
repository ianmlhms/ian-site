-- webuntis-cron-v2.sql — start the daily homework auto-sync at the rentrée
-- Supersedes webuntis-cron-v1.sql. Same daily 04:30 UTC schedule, but the
-- http_post is guarded so it only fires on/after 2026-09-15 (start of the
-- 2026-27 school year) — no pointless syncs over the summer break. From
-- 15 Sept it runs every morning, exactly as before.
--
-- Applied 2026-08-04 via `supabase db query --linked`.
-- The real x-cron-secret is only in the live cron job / handed in chat —
-- NEVER commit it (this repo is public). Placeholder below.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'webuntis-homework-sync',
  '30 4 * * *',
  $job$select net.http_post(
    url := 'https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/webuntis-sync',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<WEBUNTIS_CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  ) where current_date >= date '2026-09-15'$job$
);

-- To lift the start-date gate later, reschedule without the WHERE clause.
-- After the October DST switch, 04:30 UTC = 05:30 local; change to '30 5 * * *' if it matters.
