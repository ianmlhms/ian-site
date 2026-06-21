/* Friends: add by username, list, message (DM) or invite to a game. */
import * as auth from "./auth.js?v=3";

const $ = (id) => document.getElementById(id);
const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let sb = null, inviteSubbed = false;

const GAMES = { connect4: "Connect 4", slf: "Stadt-Land-Fluss", battleship: "Battleship" };
const READY = new Set(["connect4", "slf", "battleship"]);

async function refresh() {
  const [{ data: fr }, { data: rq }, { data: gi }, { data: sent }, { data: dir }] = await Promise.all([
    sb.rpc("my_friends"), sb.rpc("friend_requests"), sb.rpc("my_game_invites"),
    sb.rpc("sent_requests"), sb.rpc("directory"),
  ]);
  renderFriends(fr || []);
  renderRequests(rq || []);
  renderInvites(gi || []);
  renderSent(sent || []);
  renderDirectory(dir || []);
}

function renderSent(list) {
  $("sentWrap").style.display = list.length ? "" : "none";
  $("sent").innerHTML = list.map(s => `
    <div class="row">
      <span class="name"><span class="av">👤</span>${esc(s.username)} <span style="color:var(--muted);font-weight:400">— pending</span></span>
      <button class="mini x" data-cancel="${s.user_id}">Cancel</button>
    </div>`).join("");
  $("sent").querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => { await sb.rpc("remove_friend", { p_other: b.dataset.cancel }); refresh(); });
}

function renderDirectory(list) {
  const el = $("directory");
  if (!list.length) { el.innerHTML = `<div class="empty">No other users yet.</div>`; return; }
  el.innerHTML = list.map(u => {
    let btn;
    if (u.status === "friend") btn = `<span class="mini" style="opacity:.55">✓ Friend</span>`;
    else if (u.status === "sent") btn = `<span class="mini" style="opacity:.55">Requested</span>`;
    else if (u.status === "incoming") btn = `<button class="mini go" data-add="${esc(u.username)}">Accept</button>`;
    else btn = `<button class="mini go" data-add="${esc(u.username)}">+ Add</button>`;
    return `<div class="row"><span class="name"><span class="av">👤</span>${esc(u.username)}</span>${btn}</div>`;
  }).join("");
  el.querySelectorAll("[data-add]").forEach(b => b.onclick = async () => {
    try { await sb.rpc("add_friend", { p_username: b.dataset.add }); refresh(); } catch (e) { alert(e.message); }
  });
}

function renderFriends(list) {
  const el = $("friends");
  if (!list.length) { el.innerHTML = `<div class="empty">No friends yet — add someone by their username above.</div>`; return; }
  el.innerHTML = list.map(f => `
    <div class="row">
      <span class="name"><span class="av">👤</span>${esc(f.username)}</span>
      <button class="mini" data-msg="${esc(f.username)}">💬 Message</button>
      <button class="mini go" data-play="${f.user_id}" data-name="${esc(f.username)}">▶ Play</button>
      <button class="mini x" data-remove="${f.user_id}" title="Remove">✕</button>
    </div>`).join("");
  el.querySelectorAll("[data-msg]").forEach(b => b.onclick = () => location.href = "messenger.html?dm=" + encodeURIComponent(b.dataset.msg));
  el.querySelectorAll("[data-play]").forEach(b => b.onclick = () => chooseGame(b.dataset.play, b.dataset.name));
  el.querySelectorAll("[data-remove]").forEach(b => b.onclick = async () => {
    if (!confirm("Remove this friend?")) return;
    await sb.rpc("remove_friend", { p_other: b.dataset.remove }); refresh();
  });
}

function renderRequests(list) {
  $("reqWrap").style.display = list.length ? "" : "none";
  $("requests").innerHTML = list.map(r => `
    <div class="row">
      <span class="name"><span class="av">👤</span>${esc(r.username)} <span style="color:var(--muted);font-weight:400">wants to be friends</span></span>
      <button class="mini go" data-accept="${r.id}">Accept</button>
    </div>`).join("");
  $("requests").querySelectorAll("[data-accept]").forEach(b => b.onclick = async () => {
    await sb.rpc("accept_friend", { p_id: +b.dataset.accept }); refresh();
  });
}

function renderInvites(list) {
  $("invitesWrap").style.display = list.length ? "" : "none";
  $("invites").innerHTML = list.map(i => `
    <div class="row">
      <span class="name">🎮 <b>${esc(i.from_name)}</b> invited you to <b>${esc(GAMES[i.game] || i.game)}</b></span>
      <button class="mini go" data-join="${i.game}|${esc(i.room)}|${i.id}">Join</button>
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
    <h3 style="margin:0 0 12px;font-size:16px">Invite ${esc(name)} to…</h3>
    ${Object.keys(GAMES).map(g => `<button data-g="${g}" style="display:block;width:100%;margin:6px 0;padding:11px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-weight:700;cursor:pointer">${esc(GAMES[g])}</button>`).join("")}
    <button data-x style="display:block;width:100%;margin-top:8px;padding:9px;border:none;background:none;color:var(--muted);cursor:pointer">Cancel</button>
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
    msg.textContent = data === "accepted" ? "You're now friends! 🎉" : "Request sent to " + u + ".";
    $("addInput").value = ""; refresh();
  } catch (e) { msg.className = "msgline err"; msg.textContent = e.message || "Couldn't add."; }
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
  if (!auth.authConfigured) { $("gate").style.display = ""; $("gate").innerHTML = "Accounts not configured."; return; }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth(() => (auth.session() ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
})();
