/* Shared notifications for ian.lu.
 *  - registerSW():  registers the service worker (needed for Web Push).
 *  - enablePush():  asks permission, subscribes this device, stores it server-side.
 *  - disablePush(): unsubscribes + forgets this device.
 *  - pushState():   "unsupported" | "default" | "granted" | "denied" | "subscribed".
 *  - initAmbient(): live in-app toast + system notification for new messages on
 *                   any page (e.g. while you're playing a game). Used by
 *                   notify-ambient.js on non-messenger pages.
 * Foreground notifications use the Notification API (no server). Closed-app push
 * is delivered by the Supabase Edge Function `notify` → the service worker. */
import * as auth from "./auth.js?v=5";

const cfg = window.PB_CONFIG || {};
const swSupported = "serviceWorker" in navigator && "PushManager" in window;

// Pretty game names — keep in sync with friends.js GAMES.
const GAME_NAMES = {
  connect4: "Connect 4", slf: "Stadt-Land-Fluss", battleship: "Battleship",
  color: "Colour Dial", draw: "Molerei", reversi: "Reversi",
  dots: "Dots & Boxes", tictactoe: "Tic-Tac-Toe",
  checkers: "Checkers", maumau: "Mau-Mau", "dice-duel": "Kniffel",
};

/* ---------- service worker ---------- */
let _swReg = null;
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  if (_swReg) return _swReg;
  try { _swReg = await navigator.serviceWorker.register("sw.js"); }
  catch (e) { console.warn("[notify] SW register failed", e); _swReg = null; }
  return _swReg;
}

/* ---------- push subscribe / unsubscribe ---------- */
const urlB64ToUint8 = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export async function pushState() {
  if (!swSupported || !cfg.vapidPublicKey) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registerSW();
  if (reg) { const sub = await reg.pushManager.getSubscription(); if (sub) return "subscribed"; }
  return Notification.permission; // "default" | "granted"
}

export async function enablePush() {
  if (!swSupported) return { ok: false, error: "This browser can't do push notifications." };
  if (!cfg.vapidPublicKey) return { ok: false, error: "Push isn't configured (no VAPID key)." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Notifications were not allowed." };
  const reg = await registerSW();
  if (!reg) return { ok: false, error: "Service worker unavailable." };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(cfg.vapidPublicKey),
    });
  }
  const sb = await auth.client();
  const { error } = await sb.rpc("save_push_subscription", { p_sub: sub.toJSON() });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disablePush() {
  const reg = await registerSW();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    try { const sb = await auth.client(); await sb.rpc("delete_push_subscription", { p_endpoint: sub.endpoint }); } catch {}
    try { await sub.unsubscribe(); } catch {}
  }
  return { ok: true };
}

/* ---------- in-app toast ---------- */
function injectCss() {
  if (document.getElementById("notify-css")) return;
  const s = document.createElement("style");
  s.id = "notify-css";
  s.textContent = `
  .ntf-wrap{position:fixed;top:14px;right:14px;left:auto;display:flex;flex-direction:column;gap:8px;z-index:9000;max-width:min(340px,92vw);pointer-events:none}
  .ntf{pointer-events:auto;background:#161625;border:1px solid #2a2a4a;border-left:3px solid #ff6b9d;border-radius:12px;padding:10px 12px;color:#e8e8f0;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer;animation:ntfIn .18s ease-out}
  .ntf .ntf-t{font-weight:800;font-size:13px;margin-bottom:2px;color:#4de8ff}
  .ntf .ntf-b{font-size:13px;color:#e8e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @keyframes ntfIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`;
  document.head.appendChild(s);
}
function wrapEl() {
  let w = document.getElementById("ntf-wrap");
  if (!w) { injectCss(); w = document.createElement("div"); w.id = "ntf-wrap"; w.className = "ntf-wrap"; document.body.appendChild(w); }
  return w;
}
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function showToast(title, body, onClick) {
  const w = wrapEl();
  const el = document.createElement("div");
  el.className = "ntf";
  el.innerHTML = `<div class="ntf-t">${esc(title)}</div><div class="ntf-b">${esc(body)}</div>`;
  el.onclick = () => { el.remove(); onClick && onClick(); };
  w.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

function systemNotify(title, body, url) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    if (_swReg && _swReg.showNotification) {
      _swReg.showNotification(title, { body, icon: "favicon.svg", badge: "favicon.svg", data: { url } });
    } else {
      const n = new Notification(title, { body, icon: "favicon.svg" });
      n.onclick = () => { window.focus(); location.href = url; };
    }
  } catch {}
}

/* ---------- ambient (foreground) message notifications ---------- */
let _ambientStarted = false, _ambientLive = false;
export async function initAmbient() {
  if (_ambientStarted || !auth.authConfigured) return;
  _ambientStarted = true;
  await registerSW();
  const sb = await auth.client();
  if (!auth.session()) { auth.onAuth((s) => { if (s) startAmbient(sb); }); return; }
  startAmbient(sb);
}

function startAmbient(sb) {
  if (_ambientLive) return;   // onAuth can fire again (sign-out/in) — never stack a second subscription
  const me = auth.session()?.user?.id;
  if (!me) return;
  _ambientLive = true;
  // RLS scopes realtime to messages in groups you belong to, so no extra filter
  // is needed — we just skip your own messages.
  sb.channel("ambient-msgs")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: m }) => {
      if (!m || m.user_id === me) return;
      try { if (JSON.parse(localStorage.getItem("mutedChats") || "[]").includes(m.group_id)) return; } catch {}  // per-chat mute
      const body = m.content && m.content.trim()
        ? m.content
        : m.media_type === "video" ? "📹 Video" : m.media_type === "image" ? "📷 Photo" : "New message";
      const title = "💬 " + (m.username || "Messenger");
      const go = () => (location.href = "messenger.html");
      showToast(title, body, go);
      systemNotify(title, body, "messenger.html");
    })
    .subscribe();

  // Friend requests + game invites aimed at me (so I'm notified while I'm
  // elsewhere on the site, e.g. mid-game). Closed-app delivery is handled by
  // the `notify` Edge Function; this is the foreground complement.
  const social = () => (location.href = "friends.html");
  sb.channel("ambient-social-" + me)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "friendships", filter: "addressee=eq." + me }, async ({ new: f }) => {
      if (!f || (f.status && f.status !== "pending")) return;
      const { data: p } = await sb.from("profiles").select("username").eq("id", f.requester).maybeSingle();
      const body = (p?.username || "Someone") + " wants to be friends";
      showToast("👋 Friend request", body, social);
      systemNotify("👋 Friend request", body, "friends.html");
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_invites", filter: "to_user=eq." + me }, ({ new: gi }) => {
      if (!gi || (gi.status && gi.status !== "pending")) return;
      const body = (gi.from_name || "Someone") + " invited you to " + (GAME_NAMES[gi.game] || gi.game);
      showToast("🎮 Game invite", body, social);
      systemNotify("🎮 Game invite", body, "friends.html");
    })
    .subscribe();
}
