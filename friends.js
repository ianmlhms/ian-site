/* Friends: add by username, list, message (DM) or invite to a game. */
import * as auth from "./auth.js?v=47";
import { attachPeopleSearch } from "./people-search.js?v=1";
import { MP_GAMES, gameInfo, gameName, isLobbyGame, joinUrl, lobbyUrl } from "./mp-games.js?v=13";

const $ = (id) => document.getElementById(id);
const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const T = (k) => (window.I18N ? window.I18N.t(k) : k);   // i18n lookup
// Page-local accessible names (kept out of i18n-dict.js so the dictionary is not bumped on ~50 pages).
const A11Y = {
  remove: { lb: "Frënd ewechhuelen", de: "Freund entfernen", en: "Remove friend" },
  cancel: { lb: "Ufro zréckzéien", de: "Anfrage zurückziehen", en: "Cancel request" },
  loadFail: { lb: "Konnt net lueden.", de: "Konnte nicht laden.", en: "Could not load." },
  retry: { lb: "Nach eng Kéier probéieren", de: "Nochmal versuchen", en: "Try again" },
  actionFail: { lb: "Dat huet net geklappt. Probéier nach eng Kéier.", de: "Das hat nicht geklappt. Versuch es nochmal.", en: "That did not work. Try again." },
};
let bootData = Promise.resolve();   // admin ids + visibility restriction, started in boot()
/** Runs one friend action; a failure is shown (and logged) instead of silently doing nothing. */
async function runAction(name, args) {
  const { error } = await sb.rpc(name, args);
  if (error) { console.error("[friends] " + name, error); alert(TA("actionFail")); }
  refresh();
}
const TA = (k) => { const e = A11Y[k]; return e[window.I18N?.lang] || e.en; };
let sb = null, inviteSubbed = false;
const ini = (n) => String(n || "?").trim().charAt(0).toUpperCase();
let adminIds = new Set();   // user_ids of app admins → pinned on top + 👑 tagged
// Per-account visibility restriction (server-driven): a restricted viewer only
// sees an allowlist of people. UX-only — RLS still protects the real data.
let restricted = false, allowUid = new Set(), allowName = new Set();
async function loadRestriction() {
  try {
    const { data: r } = await sb.rpc("is_view_restricted");
    restricted = !!r;
    if (!restricted) return;
    const { data: ids } = await sb.rpc("visible_user_ids");
    allowUid = new Set((ids || []).map(x => x.user_id));
    if (allowUid.size) {
      const { data: profs } = await sb.from("profiles").select("username").in("id", [...allowUid]);
      allowName = new Set((profs || []).map(p => String(p.username).toLowerCase()));
    }
  } catch (e) { console.warn("[friends] restriction", e); }
}
// Keep only allowed people (by user_id or username). Always keep own "is_me" rows.
function vis(list, uidKey, nameKey) {
  if (!restricted) return list || [];
  return (list || []).filter(x => {
    if (x && x.is_me) return true;
    const u = uidKey ? x[uidKey] : null, n = nameKey ? x[nameKey] : null;
    return (u && allowUid.has(u)) || (n && allowName.has(String(n).toLowerCase()));
  });
}
let classByName = new Map();   // lowercased username → school class (shown as a tag)
async function loadClasses() {
  try {
    const { data } = await sb.from("profiles").select("username, class");
    classByName = new Map((data || []).filter(p => p.class).map(p => [String(p.username).toLowerCase(), p.class]));
  } catch (e) { console.warn("[friends] classes", e); }
}
const classTag = (name) => {
  const c = classByName.get(String(name || "").toLowerCase());
  return c ? ` <span class="class-tag">${esc(c)}</span>` : "";
};

// The "invite to game" chooser: the games the old per-game invite (invite_game) knows, plus every game that has the shared lobby.
// Names, pages and join links come from the registry (mp-games.js) — adding a game there is all it takes.
const LEGACY_INVITE_IDS = ["connect4", "slf", "battleship", "color", "draw", "dots", "checkers", "dice-duel"];
// Out of the arcade since 25 Nov 2026 (nobody played them). Their pages, rooms and open invites still work, so they stay in mp-games.js;
// they are only no longer offered here.
const RETIRED_IDS = new Set(["tictactoe", "reversi", "maumau"]);
const GAMES = Object.freeze(Object.fromEntries(Object.values(MP_GAMES).filter((g) => (g.lobby || LEGACY_INVITE_IDS.includes(g.id)) && !RETIRED_IDS.has(g.id)).map((g) => [g.id, g.name])));

async function refresh() {
  const results = await Promise.all([
    sb.rpc("my_friends"), sb.rpc("friend_requests"), sb.rpc("my_game_invites"),
    sb.rpc("sent_requests"), sb.rpc("friends_activity", { p_limit: 30 }),
    loadClasses(), bootData,   // admin tags + the visibility allowlist must be known before the lists are filtered
  ]);
  const [{ data: fr, error: frError }, { data: rq }, { data: gi }, { data: sent }, { data: act }] = results;
  const failed = results.slice(0, 5).map((r) => r && r.error).filter(Boolean);
  if (failed.length) console.error("[friends] could not load", failed);
  // An empty list must not look like "no friends yet" when the request simply failed (school Wi-Fi drops).
  if (frError) {
    $("friends").innerHTML = `<div class="empty">${esc(TA("loadFail"))} <button type="button" class="mini" id="friendsRetry">${esc(TA("retry"))}</button></div>`;
    $("friendsRetry").onclick = () => { $("friends").innerHTML = `<div class="empty">…</div>`; refresh(); };
    return;
  }
  const frF = vis(fr, "user_id", "username"), rqF = vis(rq, null, "username"),
        giF = vis(gi, null, "from_name"), sentF = vis(sent, null, "username"),
        actF = vis(act, null, "username");
  renderFriends(frF);
  renderRequests(rqF);
  renderInvites(giF);
  renderSent(sentF);
  renderActivity(actF);
  updateRequestsTab(rqF, giF, sentF);
}

// Requests tab: badge counts actionable items (friend requests + game invites);
// a friendly empty line shows when the whole tab (incl. sent) is empty.
function updateRequestsTab(rq, gi, sent) {
  const pending = rq.length + gi.length;
  const badge = $("badge-requests");
  if (badge) { badge.textContent = pending; badge.style.display = pending ? "" : "none"; }
  const empty = $("reqEmpty");
  if (empty) empty.style.display = (pending + sent.length) ? "none" : "";
}

const VERB = { win: "friends.verb.won", loss: "friends.verb.lost", draw: "friends.verb.drew" };
function ago(ts) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return T("time.now");
  const m = Math.floor(s / 60); if (m < 60) return m + T("time.mAgo");
  const h = Math.floor(m / 60); if (h < 24) return h + T("time.hAgo");
  const d = Math.floor(h / 24); return d === 1 ? T("time.yesterday") : d + T("time.dAgo");
}
function renderActivity(list) {
  const wrap = $("activityWrap"); if (!wrap) return;
  wrap.style.display = "";
  if (!list.length) { $("activity").innerHTML = `<div class="empty">${T("friends.noActivity")}</div>`; return; }
  $("activity").innerHTML = list.map((a) => {
    const who = a.is_me ? T("friends.you") : esc(a.username);
    const game = esc(gameName(a.game));
    const verb = VERB[a.result] ? T(VERB[a.result]) : esc(a.result);
    return `<div class="act-row"><span class="act-emoji" aria-hidden="true">${a.result === "win" ? "G" : a.result === "loss" ? "V" : "="}</span>` +
      `<span class="act-text"><b>${who}</b>${a.is_me ? "" : classTag(a.username)} ${verb} <b>${game}</b></span>` +
      `<span class="act-time">${ago(a.created_at)}</span></div>`;
  }).join("");
}

function renderSent(list) {
  $("sentWrap").style.display = list.length ? "" : "none";
  $("sent").innerHTML = list.map(s => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">${esc(ini(s.username))}</span>${esc(s.username)}${classTag(s.username)} <span style="color:var(--muted);font-weight:400">${T("friends.pending")}</span></span>
      <button type="button" class="mini x" data-cancel="${s.user_id}" aria-label="${esc(TA("cancel") + ": " + s.username)}">${T("btn.cancel")}</button>
    </div>`).join("");
  $("sent").querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => runAction("remove_friend", { p_other: b.dataset.cancel }));
}

function renderFriends(list) {
  const el = $("friends");
  if (!list.length) { el.innerHTML = `<div class="empty">${T("friends.noFriends")}</div>`; return; }
  // admins (👑) always pinned to the top; everyone else keeps username order
  const ordered = [...list.filter(f => adminIds.has(f.user_id)), ...list.filter(f => !adminIds.has(f.user_id))];
  el.innerHTML = ordered.map(f => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">${esc(ini(f.username))}</span>${esc(f.username)}${classTag(f.username)}${adminIds.has(f.user_id) ? ` <span class="admin-tag">Admin</span>` : ""}</span>
      <a class="mini" href="call.html?peer=${encodeURIComponent(f.user_id)}&amp;name=${encodeURIComponent(f.username)}" title="${esc(T("friends.call"))}" aria-label="${esc(T("friends.call") + ": " + f.username)}"><span aria-hidden="true">📹</span></a>
      <a class="mini" href="messenger.html?dm=${encodeURIComponent(f.username)}" aria-label="${esc(T("friends.message") + ": " + f.username)}">${T("friends.message")}</a>
      <button type="button" class="mini go" data-play="${f.user_id}" data-name="${esc(f.username)}" aria-label="${esc(T("friends.play") + ": " + f.username)}">${T("friends.play")}</button>
      <button type="button" class="mini x" data-remove="${f.user_id}" title="${esc(T("grades.remove"))}" aria-label="${esc(TA("remove") + ": " + f.username)}"><span aria-hidden="true">×</span></button>
    </div>`).join("");
  el.querySelectorAll("[data-play]").forEach(b => b.onclick = () => chooseGame(b.dataset.play, b.dataset.name));
  el.querySelectorAll("[data-remove]").forEach(b => b.onclick = async () => {
    if (!confirm(T("friends.removeConfirm"))) return;
    await runAction("remove_friend", { p_other: b.dataset.remove });
  });
}

function renderRequests(list) {
  $("reqWrap").style.display = list.length ? "" : "none";
  $("requests").innerHTML = list.map(r => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">${esc(ini(r.username))}</span>${esc(r.username)}${classTag(r.username)} <span style="color:var(--muted);font-weight:400">${T("friends.wantsFriend")}</span></span>
      <button type="button" class="mini go" data-accept="${r.id}" aria-label="${esc(T("friends.accept") + ": " + r.username)}">${T("friends.accept")}</button>
    </div>`).join("");
  $("requests").querySelectorAll("[data-accept]").forEach(b => b.onclick = () => runAction("accept_friend", { p_id: +b.dataset.accept }));
}

function renderInvites(list) {
  $("invitesWrap").style.display = list.length ? "" : "none";
  $("invites").innerHTML = list.map(i => `
    <div class="row">
      <span class="name"><b>${esc(i.from_name)}</b>${classTag(i.from_name)} ${T("friends.invitedYou")} <b>${esc(gameName(i.game))}</b></span>
      <button type="button" class="mini go" data-join="${esc(i.game)}|${esc(i.room)}|${i.id}" aria-label="${esc(T("btn.join") + ": " + gameName(i.game))}">${T("btn.join")}</button>
    </div>`).join("");
  $("invites").querySelectorAll("[data-join]").forEach(b => b.onclick = async () => {
    const [game, room, id] = b.dataset.join.split("|");
    const url = joinUrl(game, room);   // lobby games → lobby.html?g=…&c=CODE, the rest → page?room=…&role=guest
    if (!url) return;
    // The invite is only marked as answered; joining must not depend on it.
    try {
      const { error } = await sb.from("game_invites").update({ status: "accepted" }).eq("id", +id);
      if (error) console.warn("[friends] invite not marked accepted", error);
    } catch (e) { console.warn("[friends] invite not marked accepted", e); }
    location.href = url;
  });
}

function chooseGame(uid, name) {
  const m = document.createElement("div");
  const opener = document.activeElement;
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:5000;overscroll-behavior:contain";
  m.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="gpTitle" style="background:var(--glass-solid,var(--card));border:1px solid var(--border);border-radius:14px;padding:22px;width:280px;max-height:90vh;overflow-y:auto">
    <h3 id="gpTitle" style="margin:0 0 12px;font-size:16px">${esc(name)} · ${T("friends.inviteTo")}</h3>
    ${Object.keys(GAMES).map(g => `<button data-g="${g}" style="display:block;width:100%;margin:6px 0;padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-weight:700;cursor:pointer">${esc(GAMES[g])}</button>`).join("")}
    <button data-x style="display:block;width:100%;margin-top:8px;padding:9px;border:none;background:none;color:var(--muted);cursor:pointer">${T("btn.cancel")}</button>
  </div>`;
  document.body.appendChild(m);
  const dismiss = () => { m.remove(); if (opener && opener.isConnected) opener.focus(); };
  m.addEventListener("click", e => { if (e.target === m) dismiss(); });
  m.addEventListener("keydown", e => { if (e.key === "Escape") dismiss(); });
  m.querySelector("[data-x]").onclick = dismiss;
  m.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { m.remove(); invite(uid, b.dataset.g, name); });
  m.querySelector("[data-g]")?.focus();
}

async function invite(uid, game, name) {
  if (!Object.hasOwn(GAMES, game)) return;
  // Lobby games: open a lobby and invite this friend into it (lobby.html sends the invite once the lobby is up)
  if (isLobbyGame(game)) { location.href = lobbyUrl(game, "new", { invite: [{ id: uid, name }] }); return; }
  const page = gameInfo(game).page;
  const { data, error } = await sb.rpc("invite_game", { p_to: uid, p_game: game });
  if (error) return alert(error.message);
  location.href = `${page}?room=${encodeURIComponent(data.room)}&role=host`;
}

async function addFriend() {
  const u = ($("addInput").value || "").trim();
  if (!u) return;
  const msg = $("addMsg"); msg.className = "msgline"; msg.textContent = "…";
  try {
    const { data, error } = await sb.rpc("add_friend", { p_username: u });
    if (error) throw error;
    msg.className = "msgline ok";
    msg.textContent = data === "accepted" ? T("friends.nowFriends") : T("friends.requestSent") + " " + u + ".";
    $("addInput").value = ""; refresh();
  } catch (e) { msg.className = "msgline err"; msg.textContent = e.message || T("friends.cantAdd"); }
}

async function loadAdminIds() {
  try {
    const { data, error } = await sb.rpc("admin_user_ids");
    if (error) throw error;
    adminIds = new Set((data || []).map((r) => r.user_id));
  } catch (e) { console.warn("[friends] admin ids", e); }
}

async function showApp() {
  $("gate").style.display = "none"; $("app").style.display = "";
  $("addBtn").onclick = addFriend;
  // suggest usernames while typing ("emm" → every Emma); picking one sends the request
  if (!$("addInput").dataset.people) {   // showApp runs again after every sign-in: wire the input only once
    $("addInput").dataset.people = "1";
    $("addInput").addEventListener("keydown", e => { if (e.key === "Enter") addFriend(); });
    attachPeopleSearch($("addInput"), {
      sb, onPick: () => addFriend(), emptyText: "—",
      exclude: () => new Set([auth.session()?.user?.id].filter(Boolean)),
      allow: (n) => !restricted || allowName.has(n.toLowerCase()),
    });
  }
  // (upsert_profile used to be awaited here: auth.js already does it for every page, off the critical path.)
  $("friends").innerHTML = `<div class="empty">…</div>`;
  refresh();
  // live notify on new game invites — subscribe only once per page load
  if (!inviteSubbed) {
    inviteSubbed = true;
    sb.channel("ginv-" + auth.session().user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_invites", filter: "to_user=eq." + auth.session().user.id }, refresh)
      .subscribe();
  }
}
function showGate() {
  $("app").style.display = "none"; $("gate").style.display = "";
  $("gateBtn").onclick = auth.openAuthModal;
}

(async function boot() {
  if (!auth.authConfigured) { $("gate").style.display = ""; $("gate").innerHTML = T("friends.notConfigured"); return; }
  
  // A returning user sees the page frame at once instead of nothing while supabase-js and the session load.
  let markClientReady = () => {};
  const clientReady = new Promise((resolve) => { markClientReady = resolve; });
  if (auth.hasStoredSession()) {
    $("app").style.display = ""; $("friends").innerHTML = `<div class="empty">…</div>`;
    // The add button is already on screen: a tap before the client is up waits for it instead of doing nothing.
    $("addBtn").onclick = () => { clientReady.then(() => { if (auth.session()) addFriend(); }); };
  }
  sb = await auth.client();
  markClientReady();
  // Both run next to the list requests now (they used to be two extra round-trips in a row before the first list).
  bootData = Promise.all([loadAdminIds(), loadRestriction()]);
  auth.onAuth(() => (auth.session() ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
})();

// Re-render dynamic lists when the site language changes.
document.addEventListener("i18n:change", () => {
  if (sb && auth.session() && $("app").style.display !== "none") refresh();
});
