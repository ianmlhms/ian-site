/* Friends: add by username, list, message (DM) or invite to a game. */
import * as auth from "./auth.js?v=28";
import { attachPeopleSearch } from "./people-search.js?v=1";

const $ = (id) => document.getElementById(id);
const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const T = (k) => (window.I18N ? window.I18N.t(k) : k);   // i18n lookup
// Page-local accessible names (kept out of i18n-dict.js so the dictionary is not bumped on ~50 pages).
const A11Y = {
  remove: { lb: "Frënd ewechhuelen", de: "Freund entfernen", en: "Remove friend" },
  cancel: { lb: "Ufro zréckzéien", de: "Anfrage zurückziehen", en: "Cancel request" },
};
const TA = (k) => { const e = A11Y[k]; return e[window.I18N?.lang] || e.en; };
let sb = null, inviteSubbed = false;
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

const GAMES = { connect4: "Connect 4", slf: "Stadt-Land-Fluss", battleship: "Battleship", color: "Colour Guess", draw: "Draw & Guess", reversi: "Reversi", dots: "Dots & Boxes", tictactoe: "Tic-Tac-Toe", checkers: "Checkers", maumau: "Mau-Mau Cards", "dice-duel": "Kniffel" };
const GAME_PAGES = Object.freeze(Object.fromEntries(Object.keys(GAMES).map(id => [id, id + ".html"])));
const READY = new Set(["connect4", "slf", "battleship", "color", "draw", "reversi", "dots", "tictactoe", "checkers", "maumau", "dice-duel"]);

async function refresh() {
  const [{ data: fr }, { data: rq }, { data: gi }, { data: sent }, { data: act }] = await Promise.all([
    sb.rpc("my_friends"), sb.rpc("friend_requests"), sb.rpc("my_game_invites"),
    sb.rpc("sent_requests"), sb.rpc("friends_activity", { p_limit: 30 }),
    loadClasses(),
  ]);
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
    const game = esc(GAMES[a.game] || a.game);
    const verb = VERB[a.result] ? T(VERB[a.result]) : a.result;
    return `<div class="act-row"><span class="act-emoji" aria-hidden="true">${a.result === "win" ? "🏆" : a.result === "loss" ? "❌" : "🤝"}</span>` +
      `<span class="act-text"><b>${who}</b>${a.is_me ? "" : classTag(a.username)} ${verb} <b>${game}</b></span>` +
      `<span class="act-time">${ago(a.created_at)}</span></div>`;
  }).join("");
}

function renderSent(list) {
  $("sentWrap").style.display = list.length ? "" : "none";
  $("sent").innerHTML = list.map(s => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">👤</span>${esc(s.username)}${classTag(s.username)} <span style="color:var(--muted);font-weight:400">${T("friends.pending")}</span></span>
      <button type="button" class="mini x" data-cancel="${s.user_id}" aria-label="${esc(TA("cancel") + ": " + s.username)}">${T("btn.cancel")}</button>
    </div>`).join("");
  $("sent").querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => { await sb.rpc("remove_friend", { p_other: b.dataset.cancel }); refresh(); });
}

function renderFriends(list) {
  const el = $("friends");
  if (!list.length) { el.innerHTML = `<div class="empty">${T("friends.noFriends")}</div>`; return; }
  // admins (👑) always pinned to the top; everyone else keeps username order
  const ordered = [...list.filter(f => adminIds.has(f.user_id)), ...list.filter(f => !adminIds.has(f.user_id))];
  el.innerHTML = ordered.map(f => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">👤</span>${esc(f.username)}${classTag(f.username)}${adminIds.has(f.user_id) ? ` <span class="admin-tag">👑 Admin</span>` : ""}</span>
      <a class="mini" href="call.html?peer=${encodeURIComponent(f.user_id)}&amp;name=${encodeURIComponent(f.username)}" title="${esc(T("friends.call"))}" aria-label="${esc(T("friends.call") + ": " + f.username)}"><span aria-hidden="true">📹</span></a>
      <a class="mini" href="messenger.html?dm=${encodeURIComponent(f.username)}" aria-label="${esc(T("friends.message") + ": " + f.username)}">${T("friends.message")}</a>
      <button type="button" class="mini go" data-play="${f.user_id}" data-name="${esc(f.username)}" aria-label="${esc(T("friends.play") + ": " + f.username)}">${T("friends.play")}</button>
      <button type="button" class="mini x" data-remove="${f.user_id}" title="${esc(T("grades.remove"))}" aria-label="${esc(TA("remove") + ": " + f.username)}"><span aria-hidden="true">✕</span></button>
    </div>`).join("");
  el.querySelectorAll("[data-play]").forEach(b => b.onclick = () => chooseGame(b.dataset.play, b.dataset.name));
  el.querySelectorAll("[data-remove]").forEach(b => b.onclick = async () => {
    if (!confirm(T("friends.removeConfirm"))) return;
    await sb.rpc("remove_friend", { p_other: b.dataset.remove }); refresh();
  });
}

function renderRequests(list) {
  $("reqWrap").style.display = list.length ? "" : "none";
  $("requests").innerHTML = list.map(r => `
    <div class="row">
      <span class="name"><span class="av" aria-hidden="true">👤</span>${esc(r.username)}${classTag(r.username)} <span style="color:var(--muted);font-weight:400">${T("friends.wantsFriend")}</span></span>
      <button type="button" class="mini go" data-accept="${r.id}" aria-label="${esc(T("friends.accept") + ": " + r.username)}">${T("friends.accept")}</button>
    </div>`).join("");
  $("requests").querySelectorAll("[data-accept]").forEach(b => b.onclick = async () => {
    await sb.rpc("accept_friend", { p_id: +b.dataset.accept }); refresh();
  });
}

function renderInvites(list) {
  $("invitesWrap").style.display = list.length ? "" : "none";
  $("invites").innerHTML = list.map(i => `
    <div class="row">
      <span class="name"><span aria-hidden="true">🎮</span> <b>${esc(i.from_name)}</b>${classTag(i.from_name)} ${T("friends.invitedYou")} <b>${esc(GAMES[i.game] || i.game)}</b></span>
      <button type="button" class="mini go" data-join="${esc(i.game)}|${esc(i.room)}|${i.id}" aria-label="${esc(T("btn.join") + ": " + (GAMES[i.game] || i.game))}">${T("btn.join")}</button>
    </div>`).join("");
  $("invites").querySelectorAll("[data-join]").forEach(b => b.onclick = async () => {
    const [game, room, id] = b.dataset.join.split("|");
    if (!Object.hasOwn(GAME_PAGES, game)) return;
    const page = GAME_PAGES[game];
    try { await sb.from("game_invites").update({ status: "accepted" }).eq("id", +id); } catch {}
    location.href = `${page}?room=${encodeURIComponent(room)}&role=guest`;
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
  m.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { m.remove(); invite(uid, b.dataset.g); });
  m.querySelector("[data-g]")?.focus();
}

async function invite(uid, game) {
  if (!Object.hasOwn(GAME_PAGES, game)) return;
  const page = GAME_PAGES[game];
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

async function showApp() {
  $("gate").style.display = "none"; $("app").style.display = "";
  $("addBtn").onclick = addFriend;
  $("addInput").addEventListener("keydown", e => { if (e.key === "Enter") addFriend(); });
  // suggest usernames while typing ("emm" → every Emma); picking one sends the request
  if (!$("addInput").dataset.people) {
    $("addInput").dataset.people = "1";
    attachPeopleSearch($("addInput"), {
      sb, onPick: () => addFriend(), emptyText: "—",
      exclude: () => new Set([auth.session()?.user?.id].filter(Boolean)),
      allow: (n) => !restricted || allowName.has(n.toLowerCase()),
    });
  }
  try { await sb.rpc("upsert_profile", { p_username: auth.username() }); } catch (e) { console.warn(e); }
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
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  try { const { data } = await sb.rpc("admin_user_ids"); adminIds = new Set((data || []).map((r) => r.user_id)); } catch (e) { console.warn(e); }
  await loadRestriction();
  auth.onAuth(() => (auth.session() ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
})();

// Re-render dynamic lists when the site language changes.
document.addEventListener("i18n:change", () => {
  if (sb && auth.session() && $("app").style.display !== "none") refresh();
});
