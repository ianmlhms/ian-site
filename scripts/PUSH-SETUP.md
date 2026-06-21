# Web Push setup (iPad / desktop notifications even when the site is closed)

This wires up the `notify` Edge Function so a new message fans out a push to every
group member. The browser pieces (service worker `sw.js`, `manifest.webmanifest`,
subscribe button in Messenger, `push_subscriptions` table) are already in the repo.

> ⚠️ The **VAPID private key** and **NOTIFY_SECRET** are secrets. Never commit them
> — this repo is public. They live only as Supabase function secrets. Claude gave
> you the actual key values in chat; keep them somewhere private (password manager).

## 0. Prereqs
- Supabase CLI: `brew install supabase/tap/supabase` then `supabase login`.
- Project ref: `lvksqmgfwkfbblfsozfk`.

## 1. Run the SQL migration
Supabase ▸ SQL Editor ▸ paste & run **`scripts/messenger-setup-v4.sql`**.
(Adds reply columns, `chat_reads` + `mark_read`, the new `my_chats`, and
`push_subscriptions` + `save_push_subscription` / `delete_push_subscription`.)

## 2. Deploy the Edge Function
```sh
cd "~/OneDrive - Mulheims/website"
supabase functions deploy notify --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
```
`--no-verify-jwt` is required because the DB webhook calls it without a user JWT;
the function instead checks a shared secret header (step 3).

## 3. Set the function secrets
```sh
supabase secrets set --project-ref lvksqmgfwkfbblfsozfk \
  VAPID_PUBLIC_KEY="<public key from chat>" \
  VAPID_PRIVATE_KEY="<PRIVATE key from chat — secret>" \
  VAPID_SUBJECT="mailto:konto@ian.lu" \
  NOTIFY_SECRET="<make up a long random string — secret>"
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set them.

The **public** key is also in `pixelbreak-config.js` (`vapidPublicKey`). It must match
`VAPID_PUBLIC_KEY` exactly or subscriptions will be rejected.

## 4. Create the Database Webhook
Supabase ▸ Database ▸ **Webhooks** ▸ Create:
- **Table:** `public.messages`  **Events:** `INSERT`
- **Type:** HTTP Request, **Method:** POST
- **URL:** `https://lvksqmgfwkfbblfsozfk.functions.supabase.co/notify`
- **HTTP Headers:** add `x-notify-secret` = the same `NOTIFY_SECRET` as step 3.

(Equivalent to a `supabase_functions.http_request` trigger on insert.)

## 5. Subscribe a device
- Open **https://ian.lu/messenger.html**, sign in, tap **🔔 Notify**, allow.
- **iPad/iPhone:** iOS only delivers Web Push to a site that's been **Added to Home
  Screen**. In Safari: Share ▸ *Add to Home Screen*, open it from the icon, then tap
  🔔 Notify inside that installed app. (Requires iOS 16.4+.)

## 6. Test
Send a message from another account/device. The subscribed device should get a
system notification even with the site closed. To debug, check the function logs:
Supabase ▸ Edge Functions ▸ `notify` ▸ Logs (it returns `{recipients, sent}`).

## Notes
- Dead subscriptions (HTTP 404/410) are auto-deleted by the function.
- Foreground / in-app notifications (e.g. while playing a game) need no server —
  they come from `notify.js` (`initAmbient`) over Supabase Realtime.
