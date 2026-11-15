-- =============================================================
-- security-fix-briefing-secret-v1.sql  (audit 15 Nov 2026)  -- NOT APPLIED YET
--
-- What it closes
-- MEDIUM  The x-briefing-secret that the live cron job (cron.job id 4,
--   daily 05:00 UTC) sends is byte-for-byte a value that sits in the
--   PUBLIC git history: commit d8371de9 (15 Jul 2026, "replace committed
--   BRIEFING_SECRET with a placeholder") put a random-looking hex string
--   into scripts/briefing-v1.sql, and that same string is what the cron
--   job sends today. If the function's BRIEFING_SECRET is that value
--   (the job reports success; I did not call the function to prove it),
--   anybody can POST to /functions/v1/briefing and fire Ian's morning
--   push as often as they like.
--   The three other inline cron/webhook secrets (webuntis-sync, ops,
--   notify) are NOT in the git history.
--
-- The fix: a new secret that lives only in the function secrets and in
-- Vault, never again in a file or in cron.job.command.
--
--   1.  NEW=$(openssl rand -hex 24)
--       supabase secrets set BRIEFING_SECRET=$NEW --project-ref lvksqmgfwkfbblfsozfk
--   2.  In the SQL editor (not in a file, not in the repo):
--         select vault.create_secret('<the same value>', 'briefing_secret');
--       (if it exists already:  select vault.update_secret(id, '<value>')
--          from vault.secrets where name = 'briefing_secret';)
--   3.  supabase db query --linked -f scripts/security-fix-briefing-secret-v1.sql
--
-- How it could break something
-- * Only the morning briefing (one push to Ian) is involved, no player.
-- * Steps 1 and 3 on different days: that morning's briefing gets 401.
-- * Without step 2 this file stops with an error and changes nothing.
-- * If the briefing is not wanted any more, do instead:
--     select cron.unschedule(jobid) from cron.job
--      where command like '%/functions/v1/briefing%';
-- Idempotent.
-- =============================================================

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
                  where name = 'briefing_secret'
                    and char_length(decrypted_secret) >= 32) then
    raise exception 'vault secret briefing_secret is missing: do step 2 first';
  end if;
end $$;

select cron.unschedule(jobid) from cron.job
 where command like '%/functions/v1/briefing%';

select cron.schedule(
  'morning-briefing',
  '0 5 * * *',
  $cron$
  select net.http_post(
    url := 'https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/briefing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-briefing-secret', (select decrypted_secret from vault.decrypted_secrets
                             where name = 'briefing_secret')),
    body := '{}'::jsonb)
  $cron$
);

-- ---------- check: the command must not contain a secret any more ----------
select jobid, jobname, schedule, active,
       command !~ '[0-9a-f]{32,}' as no_inline_secret
  from cron.job
 where command like '%/functions/v1/briefing%';
