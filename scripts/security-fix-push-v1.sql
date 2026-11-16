-- =============================================================
-- security-fix-push-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-push-v1.sql
-- Idempotent. No client change needed.
--
-- What it closes
-- MEDIUM  A push subscription is whatever the browser sends:
--   save_push_subscription(p_sub) and policy push_subs_own accept any
--   "endpoint". The notify / briefing Edge Functions then POST to that
--   URL from Supabase's servers (webpush.sendNotification) whenever the
--   player gets a message:
--     rpc save_push_subscription {"p_sub":{"endpoint":"https://<any host>/x",
--                                          "keys":{...}}}
--   -> a blind server-side request to any host the attacker names
--      (SSRF), repeated for every message he sends himself from a
--      second account. A row written directly can also carry an
--      "endpoint" column that differs from subscription.endpoint, which
--      lets it delete another player's subscription when the fake
--      endpoint answers 410 (notify deletes by endpoint only).
--     -> endpoint must be https on a real browser push service and must
--        equal subscription->>'endpoint'.
--
-- How it could break something
-- * A browser whose push service is not in the list below cannot turn
--   notifications on (the save fails, notify.js logs it). The list has
--   Chrome/Edge/Brave/Opera/Samsung (FCM), Safari + iOS/iPadOS (Apple),
--   Firefox (Mozilla) and old Edge/Windows (WNS). All 100 % of today's
--   rows are fcm.googleapis.com or web.push.apple.com and pass.
-- * Existing rows are validated when the constraint is added: if one
--   does not pass, the ALTER fails and nothing changes (no data lost).
-- =============================================================

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_ck;
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_ck check (
    char_length(endpoint) <= 2000
    and endpoint = (subscription ->> 'endpoint')
    and endpoint ~ ('^https://('
      || 'fcm[.]googleapis[.]com'
      || '|android[.]googleapis[.]com'
      || '|([a-z0-9-]+[.])*push[.]apple[.]com'
      || '|updates[.]push[.]services[.]mozilla[.]com'
      || '|([a-z0-9-]+[.])*notify[.]windows[.]com'
      || ')/')
    and pg_column_size(subscription) <= 4096
  );

-- ---------- check ----------
select count(*) as subscriptions,
       count(*) filter (where endpoint like 'https://fcm.googleapis.com/%') as chrome_like,
       count(*) filter (where endpoint ~ '^https://[a-z0-9.-]*push[.]apple[.]com/') as apple
  from public.push_subscriptions;
