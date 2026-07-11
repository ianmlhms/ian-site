// Supabase Edge Function: notify
// Fan-out Web Push for new activity. Invoked by Database Webhooks on INSERT into:
//   - public.messages       → "new message"      (notify other group members)
//   - public.friendships    → "friend request"   (notify the addressee)
//   - public.game_invites   → "game invite"      (notify the invitee)
// so notifications arrive on the iPad even when the site is fully closed.
//
// Deploy (see scripts/PUSH-SETUP.md for the full walkthrough):
//   supabase functions deploy notify --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:konto@ian.lu NOTIFY_SECRET=...
//
// Each DB webhook must send header  x-notify-secret: <NOTIFY_SECRET>.
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

// Pretty game names — keep in sync with friends.js GAMES.
const GAME_NAMES: Record<string, string> = {
  connect4: "Connect 4", slf: "Stadt-Land-Fluss", battleship: "Battleship",
  color: "Colour Dial", draw: "Molerei", reversi: "Reversi",
  dots: "Dots & Boxes", tictactoe: "Tic-Tac-Toe",
  checkers: "Checkers", maumau: "Mau-Mau", "dice-duel": "Kniffel",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-notify-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

async function usernameOf(id: string): Promise<string> {
  const { data } = await admin.from("profiles").select("username").eq("id", id).maybeSingle();
  return data?.username || "Someone";
}

// What to push, derived from which table fired the webhook.
type Plan = { recipients: string[]; title: string; body: string; url: string; tag: string };

async function planFor(table: string, rec: any): Promise<Plan | null> {
  if (table === "messages") {
    if (!rec?.group_id) return null;
    const { data: group } = await admin
      .from("groups").select("name, is_dm").eq("id", rec.group_id).maybeSingle();
    const { data: members } = await admin
      .from("group_members").select("user_id").eq("group_id", rec.group_id).neq("user_id", rec.user_id);
    const recipients = (members ?? []).map((m: any) => m.user_id);
    const sender = rec.username || "Someone";
    const title = group?.is_dm ? `💬 ${sender}` : `${sender} · ${group?.name ?? "Group"}`;
    const body = (rec.content && rec.content.trim())
      ? rec.content.trim().slice(0, 140)
      : rec.media_type === "video" ? "📹 Video"
      : rec.media_type === "image" ? "📷 Photo"
      : rec.media_type === "audio" ? "🎤 Voice message"
      : rec.media_type === "file" ? "📎 File"
      : "New message";
    return { recipients, title, body, url: "messenger.html", tag: "grp-" + rec.group_id };
  }

  if (table === "friendships") {
    if (rec?.status && rec.status !== "pending") return null;   // only new requests
    if (!rec?.addressee) return null;
    const name = await usernameOf(rec.requester);
    return {
      recipients: [rec.addressee],
      title: "👋 Friend request",
      body: `${name} wants to be friends`,
      url: "friends.html",
      tag: "friend-" + rec.requester,
    };
  }

  if (table === "game_invites") {
    if (rec?.status && rec.status !== "pending") return null;
    if (!rec?.to_user) return null;
    const gname = GAME_NAMES[rec.game] || rec.game;
    return {
      recipients: [rec.to_user],
      title: "🎮 Game invite",
      body: `${rec.from_name || "Someone"} invited you to ${gname}`,
      url: "friends.html",
      tag: "invite-" + rec.from_user,
    };
  }

  return null;
}

// Fan a Plan out to Web Push. Shared by the webhook path and the call path.
async function sendPlan(plan: Plan) {
  if (!plan.recipients.length) return json({ ok: true, recipients: 0 });
  const { data: subs } = await admin
    .from("push_subscriptions").select("endpoint, subscription").in("user_id", plan.recipients);
  if (!subs || !subs.length) return json({ ok: true, recipients: plan.recipients.length, subs: 0 });

  const data = JSON.stringify({ title: plan.title, body: plan.body, url: plan.url, tag: plan.tag });
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
  return json({ ok: true, recipients: plan.recipients.length, sent });
}

// Incoming-call push (FaceTime). The browser can't hold NOTIFY_SECRET, so this
// path authenticates with the *caller's own Supabase JWT* and only pushes when
// the two users are accepted friends — so nobody can spam-ring a stranger.
async function handleCallPush(req: Request, p: any) {
  const authz = req.headers.get("Authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return json({ error: "unauthenticated" }, 401);
  const { data: u, error } = await admin.auth.getUser(token);
  const caller = u?.user?.id;
  if (error || !caller) return json({ error: "invalid token" }, 401);

  const to = String(p?.to || "");
  if (!to || to === caller) return json({ ok: true, skipped: "no target" });

  // accepted friendship in either direction
  const { data: fr } = await admin
    .from("friendships").select("id").eq("status", "accepted")
    .or(`and(requester.eq.${caller},addressee.eq.${to}),and(requester.eq.${to},addressee.eq.${caller})`)
    .limit(1);
  if (!fr || !fr.length) return json({ ok: true, skipped: "not friends" });

  const name = await usernameOf(caller);
  const url = `call.html?call=${encodeURIComponent(String(p?.callId || ""))}` +
    `&peer=${encodeURIComponent(caller)}&name=${encodeURIComponent(name)}&answer=1`;
  return await sendPlan({
    recipients: [to],
    title: `📹 ${name}`,
    body: "rifft dech un…",
    url,
    tag: "call-" + caller,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // Authenticated client path for FaceTime call rings (no shared secret).
  if (payload?.type === "call") return await handleCallPush(req, payload);

  // Webhook path — shared-secret guard (deployed with --no-verify-jwt).
  // Fails closed: with NOTIFY_SECRET unset, nobody can invoke this path.
  if (!NOTIFY_SECRET || req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const table = payload?.table;
  const rec = payload?.record;
  if (!table || !rec) return json({ ok: true, skipped: "no record" });

  const plan = await planFor(table, rec);
  if (!plan) return json({ ok: true, skipped: "nothing to send for " + table });
  return await sendPlan(plan);
});
