// Supabase Edge Function: notify
// Fan-out Web Push for new activity. Invoked by Database Webhooks on INSERT into:
//   - public.messages       → "new message"      (notify other group members)
//   - public.friendships    → "friend request"   (notify the addressee)
//   - public.game_invites   → "game invite"      (notify the invitee)
// so notifications arrive on the iPad even when the site is fully closed.
//
// @mentions: handled inside the messages branch — a member named with
// "@username" in the text gets a distinct "… huet dech ernimmt" push and is
// excluded from the generic message push, so nobody is notified twice.
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

// Distinct @usernames in a message body (mirrors messenger.js notifyMentions).
function mentionsIn(content: string): string[] {
  const hits = content.match(/@([A-Za-z0-9_]{3,20})/g) || [];
  return [...new Set(hits.map((t) => t.slice(1).toLowerCase()))];
}

// What to push, derived from which table fired the webhook. May yield more than
// one plan (e.g. a group message → one generic push + one @mention push).
type Plan = { recipients: string[]; title: string; body: string; url: string; tag: string };

async function planFor(table: string, rec: any): Promise<Plan[]> {
  if (table === "messages") {
    if (!rec?.group_id) return [];
    const { data: group } = await admin
      .from("groups").select("name, is_dm").eq("id", rec.group_id).maybeSingle();
    const { data: members } = await admin
      .from("group_members").select("user_id").eq("group_id", rec.group_id).neq("user_id", rec.user_id);
    const recipients = (members ?? []).map((m: any) => m.user_id);
    if (!recipients.length) return [];

    const sender = rec.username || "Someone";
    const title = group?.is_dm ? `💬 ${sender}` : `${sender} · ${group?.name ?? "Group"}`;
    const body = (rec.content && rec.content.trim())
      ? rec.content.trim().slice(0, 140)
      : rec.media_type === "video" ? "📹 Video"
      : rec.media_type === "image" ? "📷 Photo"
      : rec.media_type === "audio" ? "🎤 Voice message"
      : rec.media_type === "file" ? "📎 File"
      : "New message";
    const tag = "grp-" + rec.group_id;

    // @mentions get a higher-signal push and drop out of the generic one so
    // they're not pushed twice. Only real group members can be mentioned here
    // (a mention resolves to a member's id); DMs skip this (pointless 1:1).
    const names = group?.is_dm ? [] : mentionsIn(rec.content || "");
    let mentioned: string[] = [];
    if (names.length) {
      const wanted = new Set(names);
      const { data: profs } = await admin
        .from("profiles").select("id, username").in("id", recipients);
      mentioned = (profs ?? [])
        .filter((p: any) => p.username && wanted.has(String(p.username).toLowerCase()))
        .map((p: any) => p.id);
    }
    const isMentioned = new Set(mentioned);
    const others = recipients.filter((id: string) => !isMentioned.has(id));

    const plans: Plan[] = [];
    if (others.length) plans.push({ recipients: others, title, body, url: "messenger.html", tag });
    if (mentioned.length) plans.push({
      recipients: mentioned,
      title: `💬 ${sender} huet dech ernimmt`,
      body,
      url: "messenger.html",
      tag,   // same tag → replaces (never stacks with) the group's other push
    });
    return plans;
  }

  if (table === "friendships") {
    if (rec?.status && rec.status !== "pending") return [];   // only new requests
    if (!rec?.addressee) return [];
    const name = await usernameOf(rec.requester);
    return [{
      recipients: [rec.addressee],
      title: "👋 Friend request",
      body: `${name} wants to be friends`,
      url: "friends.html",
      tag: "friend-" + rec.requester,
    }];
  }

  if (table === "game_invites") {
    if (rec?.status && rec.status !== "pending") return [];
    if (!rec?.to_user) return [];
    const gname = GAME_NAMES[rec.game] || rec.game;
    return [{
      recipients: [rec.to_user],
      title: "🎮 Game invite",
      body: `${rec.from_name || "Someone"} invited you to ${gname}`,
      url: "friends.html",
      tag: "invite-" + rec.from_user,
    }];
  }

  if (table === "class_chat") {
    // Class chat has no generic push (that would spam the whole class on every
    // line); only @mentioned classmates get one, matching the in-app alert.
    if (!rec?.class || !rec?.body) return [];
    const names = mentionsIn(rec.body);
    if (!names.length) return [];
    const wanted = new Set(names);
    const { data: mates } = await admin
      .from("profiles").select("id, username").eq("class", rec.class);
    const recipients = (mates ?? [])
      .filter((p: any) => p.id !== rec.user_id
        && p.username && wanted.has(String(p.username).toLowerCase()))
      .map((p: any) => p.id);
    if (!recipients.length) return [];
    const sender = await usernameOf(rec.user_id);
    return [{
      recipients,
      title: `💬 ${sender} huet dech ernimmt`,
      body: rec.body.trim().slice(0, 140),
      url: "classchat.html",
      tag: "class-" + rec.class,
    }];
  }

  return [];
}

// Fan a single Plan out to Web Push. Returns counts; no Response.
async function deliver(plan: Plan): Promise<{ recipients: number; sent: number }> {
  if (!plan.recipients.length) return { recipients: 0, sent: 0 };
  const { data: subs } = await admin
    .from("push_subscriptions").select("endpoint, subscription").in("user_id", plan.recipients);
  if (!subs || !subs.length) return { recipients: plan.recipients.length, sent: 0 };

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
  return { recipients: plan.recipients.length, sent };
}

// Response wrapper for the single-plan call path.
async function sendPlan(plan: Plan) {
  const r = await deliver(plan);
  return json({ ok: true, ...r });
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

  const plans = await planFor(table, rec);
  if (!plans.length) return json({ ok: true, skipped: "nothing to send for " + table });

  let recipients = 0, sent = 0;
  for (const plan of plans) {
    const r = await deliver(plan);
    recipients += r.recipients;
    sent += r.sent;
  }
  return json({ ok: true, recipients, sent });
});
