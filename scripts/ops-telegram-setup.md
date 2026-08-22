# Ops alerts → Telegram (one-time setup)

The `ops` Edge Function can send mini-health alerts straight to Telegram from
Supabase. This is **not** routed through the mini: every other Telegram bot you
own (DailyBriefing, PlaneSpotter, UPSTracker, BrainBot) runs *on* the mini, so
none of them can tell you the mini is dead. That is why the 20 Aug 2026 outage
went unnoticed for 41 hours.

Until the two secrets below are set, this channel is a no-op and web push
carries on alone — nothing breaks, you just do not get Telegram messages.

## 1. Get a bot token

Either reuse the DailyBriefing bot's token (it only ever *sends*, so a second
sender is safe) — but that token lives in `~/.dailybriefing/.env` **on the
mini**, so it is unreachable while the mini is down.

Otherwise make a dedicated bot from your phone, which is the faster path:

1. Telegram → **@BotFather** → `/newbot`
2. Name it something like `ian ops alerts`, username e.g. `ianopsalertbot`
3. BotFather replies with the token
4. **Send your new bot a `/start`** — a bot cannot message you until you do

## 2. Set the secrets

Run this yourself so the token never passes through a chat log:

```bash
cd ~/OneDrive\ -\ Mulheims/website
supabase secrets set \
  TELEGRAM_ALERT_BOT_TOKEN='<the token from BotFather>' \
  TELEGRAM_ALERT_CHAT_ID='<your chat id>'
```

Your chat id is the `TELEGRAM_CHAT_ID` already in `~/.dailybriefing/.env` on the
mini — the same one DailyBriefing and BrainBot send to. (Not written down here:
this repo is public.)

No redeploy is needed — the function reads the secrets on its next invocation.

## 3. Verify

Within five minutes the cron fires. Check that the function now reports the
channel as configured:

```sql
select status_code, left(content, 200) as body
from net._http_response order by created desc limit 1;
```

You want `"telegram":true` in the body. If a service is unhealthy at that
moment you should also get the message on your phone.

To force an immediate check instead of waiting, call the function with the
cron secret (`OPS_CRON_SECRET`, the value you set when running
`scripts/ops-cron-v1.sql`):

```bash
curl -s -X POST https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/ops \
  -H 'content-type: application/json' \
  -H "x-cron-secret: $OPS_CRON_SECRET" \
  -d '{"action":"check"}'
```
