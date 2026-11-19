-- geld-bank-cron.sql — unattended bank sync, 4x per day.
-- pg_cron runs in UTC. 05:45 / 10:45 / 15:45 / 20:45 UTC = 06:45 / 11:45 /
-- 16:45 / 21:45 Luxembourg in WINTER (CET). In summer (CEST) they fire one
-- hour later local time; that drift is fine. Banks allow about 4 unattended
-- reads per account per day, so keep exactly four runs.
--
-- Before running (never put the value in a file or in the repo):
--   1. supabase secrets set GELD_SYNC_SECRET=<value> --project-ref lvksqmgfwkfbblfsozfk
--      (already set for TRSync; reuse that SAME value)
--   2. In the SQL editor / supabase db query:
--        select vault.create_secret('<same value>', 'geld_sync_secret');
--      (if it exists already:  select vault.update_secret(id, '<value>')
--         from vault.secrets where name = 'geld_sync_secret';)
--   3. supabase db query --linked -f scripts/geld-bank-cron.sql
-- Without step 2 this file stops with an error and changes nothing.
-- Idempotent.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
                  where name = 'geld_sync_secret'
                    and char_length(decrypted_secret) >= 16) then
    raise exception 'vault secret geld_sync_secret is missing: do step 2 first';
  end if;
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job
 where jobname = 'geld-bank-sync';

-- timeout 150 s: a sync fetches several accounts and runs the categoriser
select cron.schedule(
  'geld-bank-sync',
  '45 5,10,15,20 * * *',
  $cron$
  select net.http_post(
    url := 'https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/geld',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets
                         where name = 'geld_sync_secret')),
    body := '{"action":"bank_sync"}'::jsonb,
    timeout_milliseconds := 150000)
  $cron$
);

-- check: the command must not contain a secret
select jobid, jobname, schedule, active,
       command !~ '[0-9a-f]{32,}' as no_inline_secret
  from cron.job
 where jobname = 'geld-bank-sync';
