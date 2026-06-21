/* Messenger — group chat + DMs + media, on Supabase. Shared accounts with PixelBreak. */
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const MAX_MEDIA = 50 * 1024 * 1024; // 50 MB

let sb = null;
let current = null;          // {id, display, is_dm, invite_code, ...}
let channel = null;
const seen = new Set();

/* ---------- small prompt modal ---------- */
function promptModal(title, label, okText = "OK") {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "auth-modal open";
    m.innerHTML = `<div class="auth-box">
      <button class="auth-x">&times;</button><h3>${esc(title)}</h3>
      <input id="pmInput" placeholder="${esc(label)}" style="margin-top:12px" autocomplete="off">
      <button class="auth-go" id="pmGo">${esc(okText)}</button></div>`;
    document.body.appendChild(m);
    const close = (val) => { m.remove(); resolve(val); };
    m.querySelector(".auth-x").onclick = () => close(null);
    m.addEventListener("click", (e) => { if (e.target === m) close(null); });
    const inp = m.querySelector("#pmInput");
    m.querySelector("#pmGo").onclick = () => close(inp.value.trim() || null);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") close(inp.value.trim() || null); });
    inp.focus();
  });
}

/* ---------- chat list ---------- */
async function loadChats(selectId) {
  const { data, error } = await sb.rpc("my_chats");
  if (error) { console.warn("[msgr] my_chats", error); return; }
  renderChatList(data || []);
  if (selectId) { const g = (data || []).find((x) => x.id === selectId); if (g) selectChat(g); }
}

function renderChatList(chats) {
  const ul = $("groupList");
  if (!chats.length) { ul.innerHTML = `<li class="empty">No chats yet.<br>Create a group, join with a code, or DM someone.</li>`; return; }
  ul.innerHTML = chats.map((g) =>
    `<li class="grp ${current && current.id === g.id ? "active" : ""}" data-id="${g.id}">
       <span class="gname">${g.is_dm ? "💬 " : ""}${esc(g.display)}</span>
       ${g.is_dm ? "" : `<span class="gcode">#${esc(g.invite_code)}</span>`}
     </li>`).join("");
  ul.querySelectorAll(".grp").forEach((li) =>
    (li.onclick = () => { const g = chats.find((x) => x.id === +li.dataset.id); selectChat(g); }));
}

async function newGroup() {
  const name = await promptModal("New group", "Group name", "Create");
  if (!name) return;
  const { data, error } = await sb.rpc("create_group", { p_name: name, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}
async function joinGroup() {
  const code = await promptModal("Join a group", "Invite code (e.g. a1b2c3)", "Join");
  if (!code) return;
  const { data, error } = await sb.rpc("join_group", { p_code: code, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}
async function newDM() {
  const uname = await promptModal("Message someone", "Their username", "Start chat");
  if (!uname) return;
  const { data, error } = await sb.rpc("start_dm", { p_username: uname, p_me_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}

/* ---------- a single chat ---------- */
async function selectChat(g) {
  current = g; seen.clear();
  closeMembers();
  document.querySelectorAll(".grp").forEach((li) => li.classList.toggle("active", +li.dataset.id === g.id));
  $("chatHead").innerHTML =
    `<b>${g.is_dm ? "💬 " : ""}${esc(g.display)}</b>
     ${g.is_dm ? "" : `<span class="invite" title="Share so others can join">code: <code>${esc(g.invite_code)}</code></span>`}
     <span class="head-actions">
       <button id="membersBtn" title="Members">👥</button>
       <button id="leaveBtn" title="Leave">🚪</button>
     </span>`;
  $("membersBtn").onclick = toggleMembers;
  $("leaveBtn").onclick = leaveChat;
  $("composer").style.display = "flex";
  const box = $("messages");
  box.innerHTML = `<div class="empty">Loading…</div>`;
  const { data, error } = await sb.from("messages").select("*").eq("group_id", g.id).order("created_at").limit(300);
  if (error) { box.innerHTML = `<div class="empty">Couldn't load messages.</div>`; return; }
  box.innerHTML = "";
  (data || []).forEach(appendMessage);
  if (!data || !data.length) box.innerHTML = `<div class="empty">No messages yet — say hi 👋</div>`;
  subscribe(g.id);
}

async function leaveChat() {
  if (!current) return;
  if (!confirm(`Leave "${current.display}"? You'll need an invite to rejoin.`)) return;
  const uid = auth.session().user.id;
  const { error } = await sb.from("group_members").delete().eq("group_id", current.id).eq("user_id", uid);
  if (error) return alert(error.message);
  if (channel) { sb.removeChannel(channel); channel = null; }
  current = null;
  $("chatHead").innerHTML = "Select a chat ←";
  $("messages").innerHTML = "";
  $("composer").style.display = "none";
  closeMembers();
  loadChats();
}

/* ---------- members panel ---------- */
async function toggleMembers() {
  const p = $("memberPanel");
  if (p.classList.contains("open")) return closeMembers();
  p.classList.add("open");
  p.innerHTML = `<div class="mp-head">Members <button id="mpX">&times;</button></div><div class="mp-list">Loading…</div>`;
  $("mpX").onclick = closeMembers;
  const { data, error } = await sb.from("group_members").select("username,user_id,joined_at").eq("group_id", current.id);
  const me = auth.session().user.id;
  p.querySelector(".mp-list").innerHTML = error || !data ? "Couldn't load." :
    data.map((m) => `<div class="mp-row">👤 ${esc(m.username)}${m.user_id === me ? " <span class='you'>(you)</span>" : ""}</div>`).join("");
}
function closeMembers() { const p = $("memberPanel"); if (p) { p.classList.remove("open"); p.innerHTML = ""; } }

/* ---------- messages ---------- */
function appendMessage(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  const box = $("messages");
  const ph = box.querySelector(".empty"); if (ph) ph.remove();
  const mine = auth.session() && m.user_id === auth.session().user.id;
  const el = document.createElement("div");
  el.className = "msg" + (mine ? " mine" : "");
  const body = m.content ? esc(m.content) : "";
  el.innerHTML = `<div class="bubble"><span class="who">${esc(m.username)}</span>${body}<span class="time">${fmtTime(m.created_at)}</span></div>`;
  if (m.media_url) {
    const wrap = document.createElement(m.media_type === "video" ? "video" : "img");
    wrap.className = "media";
    if (m.media_type === "video") wrap.controls = true;
    el.querySelector(".bubble").insertBefore(wrap, el.querySelector(".time"));
    signedUrl(m.media_url).then((u) => { if (u) wrap.src = u; });
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function signedUrl(path) {
  try {
    const { data, error } = await sb.storage.from("chat-media").createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  } catch { return null; }
}

function subscribe(gid) {
  if (channel) { sb.removeChannel(channel); channel = null; }
  channel = sb.channel("grp-" + gid)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: "group_id=eq." + gid },
      (payload) => appendMessage(payload.new))
    .subscribe();
}

async function send(e) {
  e.preventDefault();
  const inp = $("msgInput");
  const content = inp.value.trim();
  if (!content || !current) return;
  inp.value = "";
  const u = auth.session().user;
  const { data, error } = await sb.from("messages")
    .insert({ group_id: current.id, user_id: u.id, username: auth.username(), content }).select().single();
  if (error) { inp.value = content; return alert(error.message); }
  appendMessage(data);
}

async function uploadAndSend(file) {
  if (!file || !current) return;
  const type = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
  if (!type) return alert("Only images and videos can be sent.");
  if (file.size > MAX_MEDIA) return alert("File too large (max 50 MB).");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${current.id}/${crypto.randomUUID()}.${ext}`;
  const att = $("attachBtn"); att.disabled = true; att.textContent = "⏳";
  const { error: upErr } = await sb.storage.from("chat-media").upload(path, file, { contentType: file.type });
  att.disabled = false; att.textContent = "📎";
  if (upErr) return alert("Upload failed: " + upErr.message);
  const u = auth.session().user;
  const { data, error } = await sb.from("messages")
    .insert({ group_id: current.id, user_id: u.id, username: auth.username(), content: "", media_url: path, media_type: type })
    .select().single();
  if (error) return alert(error.message);
  appendMessage(data);
}

/* ---------- boot ---------- */
async function boot() {
  if (!auth.authConfigured) {
    $("gate").innerHTML = `<div class="gate-box"><h3>Messenger isn't configured yet</h3></div>`;
    $("gate").style.display = "flex"; return;
  }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth((s) => (s ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
}
function showGate() {
  current = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  $("app").style.display = "none";
  $("gate").style.display = "flex";
  $("gate").innerHTML = `<div class="gate-box">
    <h3>💬 Messenger</h3><p>Sign in to chat, create groups and DM people.<br>Same account as PixelBreak.</p>
    <button class="auth-go" id="gateBtn">Sign in / Create account</button></div>`;
  $("gateBtn").onclick = auth.openAuthModal;
}
async function showApp() {
  $("gate").style.display = "none";
  $("app").style.display = "flex";
  $("newG").onclick = newGroup;
  $("joinG").onclick = joinGroup;
  $("newDM").onclick = newDM;
  $("composer").onsubmit = send;
  $("attachBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; uploadAndSend(f); };
  try { await sb.rpc("upsert_profile", { p_username: auth.username() }); } catch (e) { console.warn(e); }
  try { const { data } = await sb.rpc("is_admin"); if (data) showAdminLink(); } catch {}
  loadChats();
}
function showAdminLink() {
  if ($("adminLink")) return;
  const a = document.createElement("a");
  a.id = "adminLink"; a.href = "admin.html"; a.textContent = "🛡 Admin"; a.className = "admin-link";
  $("acctHost").parentNode.insertBefore(a, $("acctHost"));
}

boot();
