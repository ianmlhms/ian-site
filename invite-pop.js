/* invite-pop.js — game invites that reach you anywhere on ian.lu. ES module, loaded lazily (after idle) by auth.js
 * for every signed-in top-level page (never in iframes, never for kart-only accounts).
 *
 *   - ONE Realtime channel per tab (postgres_changes INSERT on game_invites, to_user = me) on the client auth.js already
 *     owns, so no second websocket. No polling. At most one my_game_invites() call to catch what arrived while no page
 *     was listening (skipped when another tab is live or a page was listening a moment ago).
 *   - Two presentations. A live game (document.documentElement.dataset.liveGame === "1") gets a slim banner on top that
 *     never takes focus, hides itself after ~8 s and opens a compact Join / Later sheet when tapped. Everywhere else a
 *     centred popup (Join / Decline / Later; Esc or the backdrop = Later). A banner nobody answered is offered once as a
 *     popup when the game ends (or on the next page that is not a live game).
 *   - Several tabs: the first visible tab to claim an invite (a Web Lock per invite) shows it, the result is shared through
 *     localStorage so the others drop it. Expired (> 12 h) and non-pending invites are ignored; who may invite whom is
 *     decided by the server (mp_invite / visible_user_ids), nothing is added here.
 *
 * The "live game" signal: dataset.liveGame = "1" while a match / race runs, "0" (or removed) otherwise. A game inside an
 * iframe posts { __ianLive: true|false } to its shell (pixelbreak.html copies that into the flag). Arcade pages under
 * /pb/ that say nothing count as live. */
import { gameInfo, gameName, joinUrl } from "./mp-games.js?v=4";

const EXPIRY_MS = 12 * 3_600_000;        // my_game_invites() only returns the last 12 h
const BANNER_MS = 8000;
const CLAIM_MS = 30_000;                 // another tab that claimed an invite this recently owns it
const CLAIM_SETTLE_MS = 80;              // + jitter: both writers re-read before one of them shows it
const GAP_MS = 20_000;                   // a page that was listening this recently makes a catch-up pointless
const CATCHUP_MIN_MS = 30_000;
const CATCHUP_MAX = 3;                   // per page load, including re-joins after a dropped connection
const SEEN = 1;                          // shown as a banner, not answered
const DONE = 2;                          // popup shown, or answered
const STATE_KEY = "invitepop:state";
const ALIVE_KEY = "invitepop:alive";
const CLAIM_KEY = "invitepop:claim:";
const LOCK_NAME = "invitepop-live";
const CLAIM_LOCK = "invitepop-claim-";
const ROOM_RE = /^[A-Za-z0-9]{4,10}$/;
const LIVE_BY_DEFAULT = /(?:^|\/)(?:pb\/[A-Za-z0-9_-]+|geometrydash|mordsfall)\.html$/;

const TEXT = Object.freeze({
  lb: { kicker: "Spillinvitatioun", body: "{name} huet dech op {game} invitéiert.", bar: "{name} invitéiert dech op {game}", tap: "Tippen fir ze äntwerten", join: "Bäitrieden", decline: "Ofleenen", later: "Méi spéit", more: "+{n} weider", sheet: "Invitatioun" },
  de: { kicker: "Spieleinladung", body: "{name} hat dich zu {game} eingeladen.", bar: "{name} lädt dich zu {game} ein", tap: "Tippen zum Antworten", join: "Beitreten", decline: "Ablehnen", later: "Später", more: "+{n} weitere", sheet: "Einladung" },
  en: { kicker: "Game invite", body: "{name} invited you to {game}.", bar: "{name} invites you to {game}", tap: "Tap to respond", join: "Join", decline: "Decline", later: "Later", more: "+{n} more", sheet: "Invitation" },
});
const tx = () => { let l = "lb"; try { const v = window.I18N?.lang || localStorage.getItem("site_lang"); if (TEXT[v]) l = v; } catch { /* storage blocked: Luxembourgish */ } return TEXT[l]; };
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

/* ---------- small storage helpers (private mode / blocked storage: everything still works per tab) ---------- */
const memory = new Map();
function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return memory.get(key) ?? fallback; }
}
function writeJson(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* memory copy above */ }
}
const readState = () => readJson(STATE_KEY, {});
const stateOf = (id) => readState()[id]?.s || 0;
function markState(id, level) {
  const now = Date.now();
  const next = {};
  for (const [k, v] of Object.entries(readState())) if (now - (v?.t || 0) < EXPIRY_MS + 3_600_000) next[k] = v;
  if ((next[id]?.s || 0) < level) next[id] = { s: level, t: now };
  writeJson(STATE_KEY, next);
}
const TOKEN = Math.random().toString(36).slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- module state ---------- */
let run = null;                // { uid, sb, getSession, channel, catchUps, lastCatchUp }
let queue = [];                // invites waiting for a presentation (newest first)
let current = null;            // what is on screen: { inv, close(), refresh() }
let busy = false;
let leaving = false;          // a Join is on its way to the next page: show nothing else meanwhile
let globalsBound = false;
const known = new Set();       // ids this tab has already taken in (live + catch-up overlap)

export const isLive = () => {
  const flag = document.documentElement.dataset.liveGame;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return LIVE_BY_DEFAULT.test(location.pathname);
};

/* ---------- invites ---------- */
function normalise(row) {
  if (!row || typeof row !== "object") return null;
  const id = Number(row.id);
  const created = Date.parse(row.created_at);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof row.game !== "string") return null;
  if (typeof row.room !== "string" || !ROOM_RE.test(row.room)) return null;
  if (row.status && row.status !== "pending") return null;
  return Object.freeze({ id, game: row.game, room: row.room, from: String(row.from_name || "?").slice(0, 24), createdAt: Number.isFinite(created) ? created : Date.now(), bannered: false });
}

function inSameRoom(inv) {   // the lobby / game page you are in already is that invite
  const q = new URLSearchParams(location.search);
  const here = String(q.get("c") || q.get("room") || "").toLowerCase();
  return here !== "" && here === inv.room.toLowerCase();
}

function enqueue(row, source) {
  const base = normalise(row);
  if (!base || known.has(base.id)) return;
  known.add(base.id);
  if (Date.now() - base.createdAt > EXPIRY_MS) return;
  const level = stateOf(base.id);
  if (level >= DONE || inSameRoom(base)) return;
  const inv = level === SEEN ? { ...base, bannered: true } : base;
  queue = [inv, ...queue.filter((q) => q.id !== inv.id)].sort((a, b) => b.createdAt - a.createdAt);
  if (source === "live" && document.visibilityState === "hidden") void systemNotify(inv);
  current?.refresh?.();
  void pump();
}

async function systemNotify(inv) {   // background tab, permission granted, no push subscription on this device
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg?.showNotification || await reg.pushManager?.getSubscription?.()) return;   // push already tells this device
    const t = tx(), d = describe(inv);
    await reg.showNotification(t.kicker, { body: fill(t.body, { name: d.name, game: d.game }), icon: "favicon.svg", badge: "favicon.svg", tag: "ginv-" + inv.id, data: { url: "friends.html" } });
  } catch { /* the in-page presentation is enough */ }
}

const thumbUrl = (g) => `/pb/thumbs/${g.arcade || (g.id === "kart-letzebuerg" ? g.id : "o-" + g.id)}.webp`;
function describe(inv) {
  const g = gameInfo(inv.game);
  return { name: inv.from, game: gameName(inv.game), emoji: g?.emoji || "🎮", thumb: g ? thumbUrl(g) : "" };
}
const targetUrl = (inv) => `${location.origin}/${joinUrl(inv.game, inv.room) || "friends.html"}`;

async function setStatus(inv, status) {
  try {
    const { error } = await run.sb.from("game_invites").update({ status }).eq("id", inv.id);
    if (error) throw error;
  } catch (error) { console.warn("[invites] status not saved", error); }
}

/* ---------- who shows it ----------
 * A Web Lock per invite, taken with ifAvailable and held for the life of the page: exactly one tab gets it, atomically
 * (localStorage is only eventually consistent between processes, so it cannot arbitrate a race). Without Web Locks a claim
 * in localStorage, settled after a short jittered wait, is the best effort. */
const claimed = new Set();
function takeLock(id) {
  return new Promise((resolve) => {
    navigator.locks.request(CLAIM_LOCK + id, { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      return lock ? new Promise(() => {}) : undefined;
    }).catch(() => resolve(false));
  });
}
async function claim(id) {
  if (claimed.has(id)) return true;
  let won;
  if (navigator.locks?.request) won = await takeLock(id);
  else {
    const key = CLAIM_KEY + id;
    const held = readJson(key, null);
    if (held && held.tok !== TOKEN && Date.now() - held.t < CLAIM_MS) return false;
    writeJson(key, { tok: TOKEN, t: Date.now() });
    await sleep(CLAIM_SETTLE_MS + Math.random() * 60);
    won = readJson(key, null)?.tok === TOKEN;
  }
  if (won) claimed.add(id);
  return won;
}

/* ---------- queue → screen ---------- */
async function pump() {
  if (busy || leaving || current || !run || !document.body || document.visibilityState !== "visible") return;
  busy = true;
  try {
    const live = isLive();
    for (const inv of queue) {
      if (live && inv.bannered) continue;                    // answered later, as a popup, when the game is over
      queue = queue.filter((q) => q.id !== inv.id);
      if (stateOf(inv.id) >= DONE) continue;
      if (!(await claim(inv.id))) continue;                  // another tab owns it
      if (document.visibilityState !== "visible" || current) { queue = [inv, ...queue]; return; }
      present(inv, isLive());
      return;
    }
  } finally { busy = false; }
}

function present(inv, live) {
  injectCss();
  const previous = document.activeElement;
  const done = () => { current = null; void pump(); };
  if (live) {
    markState(inv.id, SEEN);
    current = showBanner(inv, previous, done);
  } else {
    markState(inv.id, DONE);
    current = showPopup(inv, previous, done);
  }
}

function restoreFocus(previous) {
  try {
    if (previous?.tagName === "IFRAME") previous.contentWindow?.focus();
    else if (previous && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
  } catch { /* focus is best effort */ }
}

function answer(inv, action, previous, close) {
  markState(inv.id, DONE);
  close();
  if (action === "later") { restoreFocus(previous); return; }
  const saved = setStatus(inv, action === "join" ? "accepted" : "declined");
  if (action === "join") {
    leaving = true;
    // leave through the same links the lobby / friends page use; wait briefly so the status reaches the server first
    void Promise.race([saved, sleep(1500)]).then(() => location.assign(targetUrl(inv)));
    return;
  }
  restoreFocus(previous);
}

/* ---------- DOM ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

function art(d, cls) {
  const box = h("span", { class: cls, "aria-hidden": "true" }, d.emoji);
  if (d.thumb) {
    const img = h("img", { src: d.thumb, alt: "", decoding: "async" });
    img.addEventListener("load", () => box.replaceChildren(img), { once: true });   // emoji until the thumbnail is really there
  }
  return box;
}

function showPopup(inv, previous, done) {
  const t = tx(), d = describe(inv);
  let ov = null;
  const close = () => { document.removeEventListener("keydown", onKey, true); ov?.remove(); ov = null; done(); };
  const later = () => answer(inv, "later", previous, close);
  const more = h("p", { class: "ip-more", "aria-live": "polite" });
  const refresh = () => { more.textContent = queue.length ? fill(t.more, { n: queue.length }) : ""; more.hidden = !queue.length; };
  const joinBtn = h("button", { type: "button", class: "ip-btn ip-primary", onclick: () => answer(inv, "join", previous, close) }, t.join);
  const declineBtn = h("button", { type: "button", class: "ip-btn", onclick: () => answer(inv, "decline", previous, close) }, t.decline);
  const laterBtn = h("button", { type: "button", class: "ip-btn ip-quiet", onclick: later }, t.later);
  const buttons = [joinBtn, declineBtn, laterBtn];
  const card = h("div", { class: "ip-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "ipTitle" },
    art(d, "ip-art"),
    h("p", { class: "ip-kicker" }, "🎮 " + t.kicker),
    h("h2", { id: "ipTitle", class: "ip-title" }, fill(t.body, { name: d.name, game: d.game })),
    more,
    h("div", { class: "ip-actions" }, ...buttons));
  ov = h("div", { class: "ip-ov", onclick: (e) => { if (e.target === ov) later(); } }, card);
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); later(); return; }
    if (e.key !== "Tab") return;
    const at = buttons.indexOf(document.activeElement);
    const next = e.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at + 1) % buttons.length;
    e.preventDefault();
    buttons[next].focus();
  }
  document.addEventListener("keydown", onKey, true);
  refresh();
  document.body.append(ov);
  joinBtn.focus();
  return { inv, close, refresh };
}

function showBanner(inv, previous, done) {
  const t = tx(), d = describe(inv);
  const text = fill(t.bar, { name: d.name, game: d.game });
  let timer = 0, root = null, sheetOpen = false;
  const stop = () => { clearTimeout(timer); timer = 0; };
  const arm = () => { stop(); if (!sheetOpen) timer = setTimeout(expire, BANNER_MS); };
  const close = () => { stop(); document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onOutside, true); root?.remove(); root = null; done(); };
  function expire() { queue = [{ ...inv, bannered: true }, ...queue.filter((q) => q.id !== inv.id)]; close(); }   // unanswered: offered again once the game is over
  const later = () => answer(inv, "later", previous, close);
  function onKey(e) { if (sheetOpen && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); later(); } }
  const bar = h("button", { type: "button", class: "ip-bar", "aria-label": `${text}. ${t.tap}`, onclick: openSheet },
    art(d, "ip-bar-art"), h("span", { class: "ip-bar-t" }, text), h("span", { class: "ip-bar-go", "aria-hidden": "true" }, "›"));
  root = h("div", { class: "ip-top", role: "status", "aria-live": "polite" }, bar);
  for (const [on, off] of [["pointerenter", "pointerleave"], ["focusin", "focusout"]]) {
    root.addEventListener(on, stop);
    root.addEventListener(off, arm);
  }
  const SHEET_MS = 20_000;                                   // a forgotten sheet must not sit on the game for ever
  const onOutside = (e) => { if (root && !root.contains(e.target)) later(); };   // a tap on the game itself = Later
  function openSheet() {
    if (sheetOpen) return;
    sheetOpen = true; stop();
    timer = setTimeout(expire, SHEET_MS);
    document.addEventListener("pointerdown", onOutside, true);
    const joinBtn = h("button", { type: "button", class: "ip-btn ip-primary", onclick: () => answer(inv, "join", previous, close) }, t.join);
    const laterBtn = h("button", { type: "button", class: "ip-btn ip-quiet", onclick: later }, t.later);
    const sheet = h("div", { class: "ip-sheet", role: "dialog", "aria-label": t.sheet },
      h("div", { class: "ip-sheet-row" }, art(d, "ip-bar-art"), h("span", { class: "ip-sheet-t" }, fill(t.body, { name: d.name, game: d.game }))),
      h("div", { class: "ip-actions" }, joinBtn, laterBtn));
    root.replaceChildren(sheet);
    document.addEventListener("keydown", onKey, true);
    joinBtn.focus();
  }
  document.body.append(root);
  arm();
  return { inv, close, refresh() {} };
}

function injectCss() {
  if (document.getElementById("invitepop-css")) return;
  const s = h("style", { id: "invitepop-css" });
  s.textContent = `
  .ip-ov{position:fixed;inset:0;z-index:100002;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:rgba(0,0,0,.55);font-family:var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);animation:ipFade .16s ease-out}
  .ip-card{width:min(400px,100%);max-height:100%;overflow:auto;border-radius:20px;padding:22px 20px 18px;text-align:center;background:var(--card-opaque,var(--card,#161625));color:var(--text,#e8e8f0);border:1px solid var(--border,rgba(255,255,255,.14));box-shadow:0 18px 50px rgba(0,0,0,.45)}
  .ip-art{display:flex;align-items:center;justify-content:center;width:112px;height:72px;margin:0 auto 12px;border-radius:14px;overflow:hidden;background:var(--card2,rgba(255,255,255,.08));font-size:36px;line-height:1}
  .ip-art img,.ip-bar-art img{width:100%;height:100%;object-fit:cover;display:block}
  .ip-kicker{margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:.02em;color:var(--accent2,#4de8ff)}
  .ip-title{margin:0 0 6px;font-size:19px;line-height:1.3;font-weight:800;overflow-wrap:anywhere}
  .ip-more{margin:0 0 4px;font-size:13px;color:var(--muted,#b8b8cc)}
  .ip-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:16px}
  .ip-btn{min-height:46px;min-width:104px;padding:0 18px;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.18));background:transparent;color:inherit;font:inherit;font-weight:750;cursor:pointer;touch-action:manipulation}
  .ip-primary{background:var(--accent,#6c5ce7);border-color:transparent;color:var(--accent-foreground,#fff)}
  .ip-quiet{border-color:transparent;color:var(--muted,#b8b8cc)}
  .ip-btn:focus-visible,.ip-bar:focus-visible{outline:3px solid var(--focus-ring,var(--accent2,#74b9ff));outline-offset:2px}
  .ip-top{position:fixed;z-index:100002;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 16px));font-family:var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);animation:ipDrop .18s ease-out}
  .ip-bar{display:flex;align-items:center;gap:10px;width:100%;min-height:42px;padding:5px 12px 5px 6px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.18));background:var(--card-opaque,var(--card,#161625));color:var(--text,#e8e8f0);font:inherit;font-size:14px;font-weight:700;text-align:left;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.4);touch-action:manipulation}
  .ip-bar-art{flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:30px;border-radius:999px;overflow:hidden;background:var(--card2,rgba(255,255,255,.08));font-size:17px;line-height:1}
  .ip-bar-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ip-bar-go{flex:none;font-size:20px;line-height:1;color:var(--muted,#b8b8cc)}
  .ip-sheet{border-radius:18px;padding:12px 14px 14px;background:var(--card-opaque,var(--card,#161625));color:var(--text,#e8e8f0);border:1px solid var(--border,rgba(255,255,255,.18));box-shadow:0 12px 32px rgba(0,0,0,.45)}
  .ip-sheet-row{display:flex;align-items:center;gap:10px}
  .ip-sheet-t{flex:1;min-width:0;font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}
  .ip-sheet .ip-actions{margin-top:10px;justify-content:flex-end}
  .ip-sheet .ip-btn{min-height:44px;min-width:92px}
  @keyframes ipFade{from{opacity:0}to{opacity:1}}
  @keyframes ipDrop{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
  @media (prefers-reduced-motion:reduce){.ip-ov,.ip-top{animation:none}}
  @media (max-width:420px){.ip-actions .ip-btn{flex:1 1 100%}.ip-sheet .ip-actions .ip-btn{flex:1 1 40%}}`;
  document.head.append(s);
}

/* ---------- wiring ---------- */
const touchAlive = () => writeJson(ALIVE_KEY, Date.now());

async function otherTabLive() {
  try {
    if (!navigator.locks?.query) return false;
    const snap = await navigator.locks.query();
    return (snap.held || []).some((l) => l.name === LOCK_NAME);
  } catch { return false; }
}
function holdLiveLock() {
  try { navigator.locks?.request(LOCK_NAME, { mode: "shared" }, () => new Promise(() => {}))?.catch?.(() => {}); } catch { /* no Web Locks: catch-up is rate limited anyway */ }
}

async function catchUp(r) {
  if (r.catchUps >= CATCHUP_MAX || Date.now() - r.lastCatchUp < CATCHUP_MIN_MS) return;
  r.catchUps += 1; r.lastCatchUp = Date.now();
  try {
    const { data, error } = await r.sb.rpc("my_game_invites");
    if (error) throw error;
    if (run === r && Array.isArray(data)) data.forEach((row) => enqueue(row, "catchup"));
  } catch (error) { console.warn("[invites] catch-up failed", error); }
}

async function connect(r) {
  if (r.channel || run !== r) return;
  const peer = await otherTabLive();
  if (run !== r || r.channel) return;
  holdLiveLock();
  const wasAway = Date.now() - Number(readJson(ALIVE_KEY, 0)) > GAP_MS;
  let first = true;
  r.channel = r.sb.channel("invites-" + r.uid)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_invites", filter: "to_user=eq." + r.uid }, ({ new: row }) => {
      if (run === r && r.getSession()?.user?.id === r.uid) enqueue(row, "live");
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED" || run !== r) return;
      touchAlive();
      if (first) { first = false; if (!peer && wasAway) void catchUp(r); }
      else void catchUp(r);                                   // re-joined after a dropped connection: we may have missed some
    });
}

function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { if (run?.channel) touchAlive(); return; }
    if (run && !run.channel) void connect(run);
    void pump();
  });
  window.addEventListener("pagehide", () => { if (run?.channel) touchAlive(); });
  window.addEventListener("storage", (e) => {              // another tab showed / answered an invite: drop it here too
    if (e.key !== STATE_KEY) return;
    const state = readState();
    queue = queue.filter((q) => (state[q.id]?.s || 0) < DONE);
  });
  new MutationObserver(() => void pump()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-live-game"] });
  document.addEventListener("DOMContentLoaded", () => void pump());
}

function stop() {
  if (!run) return;
  try { run.channel && run.sb.removeChannel(run.channel); } catch { /* channel already gone */ }
  run = null; queue = []; known.clear();
  current?.close?.();
}

export function startInvitePop(sb, getSession) {
  const uid = getSession?.()?.user?.id;
  if (!uid || typeof sb?.channel !== "function") return;
  if (run?.uid === uid) return;
  stop();
  const r = { uid, sb, getSession, channel: null, catchUps: 0, lastCatchUp: 0 };
  run = r;
  bindGlobals();
  try {
    sb.auth.onAuthStateChange((_event, session) => { if (run === r && session?.user?.id !== uid) stop(); });
  } catch { /* the listener check at delivery time still guards a sign-out */ }
  if (document.visibilityState === "visible") void connect(r);
}
