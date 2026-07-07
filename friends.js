/* Friends: add by username, list, message (DM) or invite to a game. */
import * as auth from "./auth.js?v=4";

const $ = (id) => document.getElementById(id);
const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const T = (k) => (window.I18N ? window.I18N.t(k) : k);   // i18n lookup
let sb = null, inviteSubbed = false;
let adminIds = new Set();   // user_ids of app admins → pinned on top + 👑 tagged

const GAMES = { connect4: "Connect 4", slf: "Stadt-Land-Fluss", battleship: "Battleship", color: "Colour Dial", draw: "Molerei", reversi: "Reversi", dots: "Dots & Boxes", tictactoe: "Tic-Tac-Toe" };
const READY = new Set(["connect4", "slf", "battleship", "color", "draw", "reversi", "dots", "tictactoe"]);

async function refresh() {
  const [{ data: fr }, { data: rq }, { data: gi }, { data: sent }, { data: dir }, { data: act }] = await Promise.all([
    sb.rpc("my_friends"), sb.rpc("friend_requests"), sb.rpc("my_game_invites"),
    sb.rpc("sent_requests"), sb.rpc("directory"), sb.rpc("friends_activity", { p_limit: 30 }),
  ]);
  renderFriends(fr || []);
  renderRequests(rq || []);
  renderInvites(gi || []);
  renderSent(sent || []);
  renderDirectory(dir || []);
  renderActivity(act || []);
  updateRequestsTab(rq || [], gi || [], sent || []);
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
    return `<div class="act-row"><span class="act-emoji">${a.result === "win" ? "🏆" : a.result === "loss" ? "❌" : "🤝"}</span>` +
      `<span class="act-text"><b>${who}</b> ${verb} <b>${game}</b></span>` +
      `<span class="act-time">${ago(a.created_at)}</span></div>`;
  }).join("");
}

function renderSent(list) {
  $("sentWrap").style.display = list.length ? "" : "none";
  $("sent").innerHTML = list.map(s => `
    <div class="row">
      <span class="name"><span class="av">👤</span>${esc(s.username)} <span style="color:var(--muted);font-weight:400">${T("friends.pending")}</span></span>
      <button class="mini x" data-cancel="${s.user_id}">${T("btn.cancel")}</button>
    </div>`).join("");
  $("sent").querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => { await sb.rpc("remove_friend", { p_other: b.dataset.cancel }); refresh(); });
}

function renderDirectory(list) {
  const el = $("directory");
  if (!list.length) { el.innerHTML = `<div class="empty">${T("friends.noUsers")}</div>`; return; }
  el.innerHTML = list.map(u => {
    let btn;
    if (u.status === "friend") btn = `<span class="mini" style="opacity:.55">${T("friends.isFriend")}</span>`;
    else if (u.status === "sent") btn = `<span class="mini" style="opacity:.55">${T("friends.requested")}</span>`;
    else if (u.status === "incoming") btn = `<button class="mini go" data-add="${esc(u.username)}">${T("friends.accept")}</button>`;
    else btn = `<button class="mini go" data-add="${esc(u.username)}">${T("friends.addPlus")}</button>`;
    return `<div class="row"><span class="name"><span class="av">👤</span>${esc(u.username)}</span>${btn}</div>`;
  }).join("");
  el.querySelectorAll("[data-add]").forEach(b => b.onclick = async () => {
    try { await sb.rpc("add_friend", { p_username: b.dataset.add }); refresh(); } catch (e) { alert(e.message); }
  });
}

function renderFriends(list) {
  const el = $("friends");
  if (!list.length) { el.innerHTML = `<div class="empty">${T("friends.noFriends")}</div>`; return; }
  // admins (👑) always pinned to the top; everyone else keeps username order
  const ordered = [...list.filter(f => adminIds.has(f.user_id)), ...list.filter(f => !adminIds.has(f.user_id))];
  el.innerHTML = ordered.map(f => `
    <div class="row">
      <span class="name"><span class="av">👤</span>${esc(f.username)}${adminIds.has(f.user_id) ? ` <span class="admin-tag">👑 Admin</span>` : ""}</span>
      <button class="mini" data-msg="${esc(f.username)}">${T("friends.message")}</button>
      <button class="mini go" data-play="${f.user_id}" data-name="${esc(f.username)}">${T("friends.play")}</button>
      <button class="mini x" data-remove="${f.user_id}" title="${T("grades.remove")}">✕</button>
    </div>`).join("");
  el.querySelectorAll("[data-msg]").forEach(b => b.onclick = () => location.href = "messenger.html?dm=" + encodeURIComponent(b.dataset.msg));
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
      <span class="name"><span class="av">👤</span>${esc(r.username)} <span style="color:var(--muted);font-weight:400">${T("friends.wantsFriend")}</span></span>
      <button class="mini go" data-accept="${r.id}">${T("friends.accept")}</button>
    </div>`).join("");
  $("requests").querySelectorAll("[data-accept]").forEach(b => b.onclick = async () => {
    await sb.rpc("accept_friend", { p_id: +b.dataset.accept }); refresh();
  });
}

function renderInvites(list) {
  $("invitesWrap").style.display = list.length ? "" : "none";
  $("invites").innerHTML = list.map(i => `
    <div class="row">
      <span class="name">🎮 <b>${esc(i.from_name)}</b> ${T("friends.invitedYou")} <b>${esc(GAMES[i.game] || i.game)}</b></span>
      <button class="mini go" data-join="${i.game}|${esc(i.room)}|${i.id}">${T("btn.join")}</button>
    </div>`).join("");
  $("invites").querySelectorAll("[data-join]").forEach(b => b.onclick = async () => {
    const [game, room, id] = b.dataset.join.split("|");
    try { await sb.from("game_invites").update({ status: "accepted" }).eq("id", +id); } catch {}
    location.href = `${game}.html?room=${encodeURIComponent(room)}&role=guest`;
  });
}

function chooseGame(uid, name) {
  const m = document.createElement("div");
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:5000";
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;width:280px">
    <h3 style="margin:0 0 12px;font-size:16px">${esc(name)} — ${T("friends.inviteTo")}</h3>
    ${Object.keys(GAMES).map(g => `<button data-g="${g}" style="display:block;width:100%;margin:6px 0;padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-weight:700;cursor:pointer">${esc(GAMES[g])}</button>`).join("")}
    <button data-x style="display:block;width:100%;margin-top:8px;padding:9px;border:none;background:none;color:var(--muted);cursor:pointer">${T("btn.cancel")}</button>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", e => { if (e.target === m) m.remove(); });
  m.querySelector("[data-x]").onclick = () => m.remove();
  m.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { m.remove(); invite(uid, b.dataset.g); });
}

async function invite(uid, game) {
  const { data, error } = await sb.rpc("invite_game", { p_to: uid, p_game: game });
  if (error) return alert(error.message);
  location.href = `${game}.html?room=${encodeURIComponent(data.room)}&role=host`;
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
  auth.onAuth(() => (auth.session() ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
})();

// Re-render dynamic lists when the site language changes.
document.addEventListener("i18n:change", () => {
  if (sb && auth.session() && $("app").style.display !== "none") refresh();
});
