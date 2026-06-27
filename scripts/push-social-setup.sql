-- ===========================================================================
-- Extend notifications to friend requests + game invites.
--
-- 1) This SQL adds `friendships` to the realtime publication so the FOREGROUND
--    in-app toast (notify.js, on any page) fires when a request arrives.
--    `game_invites` is already in the publication (social-games-setup.sql).
--
-- 2) Closed-app PUSH is delivered by the existing `notify` Edge Function, which
--    now also handles friendships + game_invites. You must add TWO Database
--    Webhooks in the dashboard (same as the messages one):
--      Database ▸ Webhooks ▸ Create:
--        • Table: public.friendships   Events: INSERT
--        • Table: public.game_invites  Events: INSERT
--      Both → HTTP Request → POST to the `notify` Edge Function URL
--      (https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/notify),
--      with header  x-notify-secret: <your NOTIFY_SECRET>.
--    (No edge-function redeploy is needed only if you already pulled the new
--     index.ts — otherwise redeploy:  supabase functions deploy notify
--     --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk)
--
-- Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
-- ===========================================================================

-- Add friendships to realtime (no-op if already added). Wrapped so re-running
-- doesn't error if the table is already a member of the publication.
do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception
  when duplicate_object then null;   -- already in the publication
end $$;
