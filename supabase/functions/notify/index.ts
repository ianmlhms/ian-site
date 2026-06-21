// Supabase Edge Function: notify
// Fan-out Web Push for new messages. Invoked by a Database Webhook on
// public.messages INSERT. Sends a push to every group member except the sender
// who has a stored push subscription — so notifications arrive on the iPad even
// when the site is fully closed.
//
// Deploy (see scripts/PUSH-SETUP.md for the full walkthrough):
//   supabase functions deploy notify --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:konto@ian.lu NOTIFY_SECRET=...
//
// The DB webhook must send header  x-notify-secret: <NOTIFY_SECRET>.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:konto@ian.lu";
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  // Shared-secret guard (the function is deployed with --no-verify-jwt).
  if (NOTIFY_SECRET && req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const msg = payload?.record;
  if (!msg || !msg.group_id) return json({ ok: true, skipped: "no record" });

  // Chat context for a nicer title.
  const { data: group } = await admin
    .from("groups").select("name, is_dm").eq("id", msg.group_id).maybeSingle();

  // Recipients = members of the group except the sender.
  const { data: members } = await admin
    .from("group_members").select("user_id").eq("group_id", msg.group_id).neq("user_id", msg.user_id);
  const ids = (members ?? []).map((m: any) => m.user_id);
  if (!ids.length) return json({ ok: true, recipients: 0 });

  const { data: subs } = await admin
    .from("push_subscriptions").select("endpoint, subscription").in("user_id", ids);
  if (!subs || !subs.length) return json({ ok: true, recipients: ids.length, subs: 0 });

  const sender = msg.username || "Someone";
  const title = group?.is_dm ? `💬 ${sender}` : `${sender} · ${group?.name ?? "Group"}`;
  const body = (msg.content && msg.content.trim())
    ? msg.content.trim().slice(0, 140)
    : msg.media_type === "video" ? "📹 Video" : msg.media_type === "image" ? "📷 Photo" : "New message";
  const data = JSON.stringify({ title, body, group_id: msg.group_id, url: "messenger.html" });

  let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(s.subscription, data);
      sent++;
    } catch (e: any) {
      // 404/410 = subscription expired/unsubscribed → forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else {
        console.error("push failed", e?.statusCode, e?.body ?? e?.message);
      }
    }
  }));

  return json({ ok: true, recipients: ids.length, sent });
});
