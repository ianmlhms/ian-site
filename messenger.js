/* Messenger — group chat + DMs + media, on Supabase. Shared accounts with PixelBreak. */
import * as auth from "./auth.js";
import { registerSW, enablePush, disablePush, pushState } from "./notify.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const MAX_MEDIA = 50 * 1024 * 1024; // 50 MB
const SNIPPET = 80; // chars kept of a quoted reply

let sb = null;
let current = null;          // {id, display, is_dm, invite_code, ...}
let channel = null;          // current chat's realtime channel
let allChannel = null;       // all-my-messages channel (drives unread badges)
const seen = new Set();
let memberSubbed = false;
let replyTo = null;          // {id, user, preview} when replying, else null
let suppressClickUntil = 0;  // swallow the click that follows a gesture-reply
let currentOthers = [];      // other members' user_ids in the open chat
let readMap = {};            // user_id -> last_read_at (others, in the open chat)
let readThreshold = null;    // ms: msgs sent at/before this are read by ALL others

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
  ul.innerHTML = chats.map((g) => {
    const prev = g.last_preview
      ? `<span class="gprev">${g.last_sender ? esc(g.last_sender) + ": " : ""}${esc(g.last_preview)}</span>`
      : (g.is_dm ? "" : `<span class="gcode">#${esc(g.invite_code)}</span>`);
    return `<li class="grp ${current && current.id === g.id ? "active" : ""} ${g.unread ? "unread" : ""}" data-id="${g.id}">
       <span class="gtop"><span class="gname">${g.is_dm ? "💬 " : ""}${esc(g.display)}</span>${g.unread ? '<span class="dot"></span>' : ""}</span>
       ${prev}
     </li>`;
  }).join("");
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
  currentOthers = []; readMap = {}; readThreshold = null;
  closeMembers(); cancelReply();
  markRead(g.id);
  document.querySelectorAll(".grp").forEach((li) => {
    const on = +li.dataset.id === g.id;
    li.classList.toggle("active", on);
    if (on) li.classList.remove("unread");           // clear the badge immediately
  });
  $("chatHead").innerHTML =
    `<button class="back-btn" id="backBtn" title="Chats">‹</button>
     <b>${g.is_dm ? "💬 " : ""}${esc(g.display)}</b>
     ${g.is_dm ? "" : `<span class="invite" title="Share so others can join">code: <code>${esc(g.invite_code)}</code></span>`}
     <span class="head-actions">
       <button id="membersBtn" title="Members">👥</button>
       <button id="leaveBtn" title="Leave">🚪</button>
     </span>`;
  $("backBtn").onclick = goBackToList;
  $("membersBtn").onclick = toggleMembers;
  $("leaveBtn").onclick = leaveChat;
  $("app").classList.add("chat-open");   // mobile: show the conversation full-screen
  $("composer").style.display = "flex";
  const box = $("messages");
  box.innerHTML = `<div class="empty">Loading…</div>`;
  const { data, error } = await sb.from("messages").select("*").eq("group_id", g.id).order("created_at").limit(300);
  if (error) { box.innerHTML = `<div class="empty">Couldn't load messages.</div>`; return; }
  box.innerHTML = "";
  (data || []).forEach(appendMessage);
  if (!data || !data.length) box.innerHTML = `<div class="empty">No messages yet — say hi 👋</div>`;
  subscribe(g.id);
  loadReceipts(g.id);
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
  $("app").classList.remove("chat-open");   // mobile: back to the list
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

// Mobile: go back from a full-screen conversation to the chat list.
function goBackToList() { closeMembers(); $("app").classList.remove("chat-open"); }

async function markRead(gid) { try { await sb.rpc("mark_read", { p_group_id: gid }); } catch (e) { console.warn("[msgr] mark_read", e); } }

/* ---------- read receipts (✓ / ✓✓) ---------- */
// Load who else is in the chat + their last-read times, then paint the ticks.
async function loadReceipts(gid) {
  const me = auth.session().user.id;
  readMap = {}; readThreshold = null;
  const [{ data: mem }, { data: reads }] = await Promise.all([
    sb.from("group_members").select("user_id").eq("group_id", gid),
    sb.from("chat_reads").select("user_id,last_read_at").eq("group_id", gid),
  ]);
  currentOthers = (mem || []).map((r) => r.user_id).filter((id) => id !== me);
  (reads || []).forEach((r) => { if (r.user_id !== me) readMap[r.user_id] = r.last_read_at; });
  recomputeThreshold(); updateTicks();
}
// "Read" = every other member has a read time at/after the message → blue ✓✓.
function recomputeThreshold() {
  if (!currentOthers.length) { readThreshold = null; return; }
  let min = null;
  for (const id of currentOthers) {
    const t = readMap[id];
    if (!t) { readThreshold = null; return; }        // someone hasn't read → nothing is "read by all"
    const ts = new Date(t).getTime();
    if (min === null || ts < min) min = ts;
  }
  readThreshold = min;
}
function tickIsRead(tsIso) { return readThreshold !== null && new Date(tsIso).getTime() <= readThreshold; }
function paintTick(el) {
  const read = tickIsRead(el.dataset.ts);
  el.textContent = read ? "✓✓" : "✓";
  el.classList.toggle("read", read);
  el.title = read ? "Gelies" : "Geschéckt";
}
function updateTicks() { $("messages").querySelectorAll(".msg.mine .ticks").forEach(paintTick); }

/* ---------- reply ---------- */
function snippet(m) {
  if (m.content && m.content.trim()) return m.content.trim().slice(0, SNIPPET);
  if (m.media_type === "video") return "📹 Video";
  if (m.media_type === "image") return "📷 Photo";
  return "Message";
}
function startReply(m) {
  replyTo = { id: m.id, user: m.username, preview: snippet(m) };
  $("rbUser").textContent = m.username;
  $("rbText").textContent = replyTo.preview;
  $("replyBar").classList.add("open");
  $("msgInput").focus();
}
function cancelReply() { replyTo = null; const b = $("replyBar"); if (b) b.classList.remove("open"); }

/* ---------- image lightbox ---------- */
function openLightbox(src) {
  const lb = $("lightbox");
  $("lbImg").src = src;
  lb.classList.add("open");
}
function closeLightbox() { const lb = $("lightbox"); lb.classList.remove("open"); $("lbImg").src = ""; }

/* Attach swipe-to-reply + long-press-to-reply to a rendered message. */
function attachReplyGestures(el, m) {
  const bubble = el.querySelector(".bubble");
  let startX = 0, startY = 0, dx = 0, dragging = false, lpTimer = null;
  const cue = document.createElement("span");
  cue.className = "reply-cue"; cue.textContent = "↩"; bubble.appendChild(cue);
  const reset = () => { bubble.classList.remove("swiping"); bubble.style.transform = ""; cue.style.opacity = "0"; dx = 0; dragging = false; };
  const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = true;
    lpTimer = setTimeout(() => { clearLp(); if (navigator.vibrate) navigator.vibrate(15); suppressClickUntil = Date.now() + 500; startReply(m); }, 500);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { clearLp(); return; }     // vertical scroll, ignore
    if (Math.abs(dx) > 6) clearLp();
    const mineDir = el.classList.contains("mine") ? Math.min(dx, 0) : Math.max(dx, 0);
    bubble.classList.add("swiping");
    bubble.style.transform = `translateX(${Math.max(-90, Math.min(90, mineDir))}px)`;
    cue.style.opacity = String(Math.min(1, Math.abs(mineDir) / 60));
  }, { passive: true });
  el.addEventListener("touchend", () => {
    clearLp();
    if (Math.abs(dx) > 55) { suppressClickUntil = Date.now() + 500; startReply(m); }
    reset();
  });
  el.addEventListener("touchcancel", () => { clearLp(); reset(); });
}

/* ---------- messages ---------- */
const DELETE_WINDOW = 30000; // ms a user can delete their own message

function appendMessage(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  const box = $("messages");
  const ph = box.querySelector(".empty"); if (ph) ph.remove();
  const mine = auth.session() && m.user_id === auth.session().user.id;
  const el = document.createElement("div");
  el.className = "msg" + (mine ? " mine" : "");
  el.dataset.mid = m.id;
  const body = m.content ? esc(m.content) : "";
  const replyHtml = m.reply_user
    ? `<span class="reply-quote" data-rid="${m.reply_to || ""}"><span class="rq-user">${esc(m.reply_user)}</span><span class="rq-text">${esc(m.reply_preview || "")}</span></span>`
    : "";
  el.innerHTML = `<div class="bubble"><span class="who">${esc(m.username)}</span>${replyHtml}${body}<span class="time">${fmtTime(m.created_at)}</span></div>`;
  const bubble = el.querySelector(".bubble");
  // tap a quoted reply to jump to the original
  const rq = el.querySelector(".reply-quote");
  if (rq) rq.onclick = () => {
    const t = box.querySelector(`[data-mid="${rq.dataset.rid}"]`);
    if (!t) return;
    t.scrollIntoView({ behavior: "smooth", block: "center" });
    const tb = t.querySelector(".bubble"); if (tb) { tb.style.outline = "2px solid var(--accent2)"; setTimeout(() => (tb.style.outline = ""), 1200); }
  };
  if (m.media_url) {
    const wrap = document.createElement(m.media_type === "video" ? "video" : "img");
    wrap.className = "media";
    if (m.media_type === "video") wrap.controls = true;
    else wrap.onclick = () => { if (Date.now() < suppressClickUntil) return; if (wrap.src) openLightbox(wrap.src); };   // tap photo → fullscreen
    bubble.insertBefore(wrap, el.querySelector(".time"));
    signedUrl(m.media_url).then((u) => { if (u) wrap.src = u; });
  }
  // desktop hover reply button
  const rbtn = document.createElement("button");
  rbtn.className = "reply-btn"; rbtn.title = "Reply"; rbtn.textContent = "↩";
  rbtn.onclick = (e) => { e.stopPropagation(); startReply(m); };
  bubble.appendChild(rbtn);
  attachReplyGestures(el, m);
  if (mine) {
    const tk = document.createElement("span");
    tk.className = "ticks"; tk.dataset.ts = m.created_at;
    bubble.appendChild(tk); paintTick(tk);
    const age = Date.now() - new Date(m.created_at).getTime();
    if (age < DELETE_WINDOW) {
      const del = document.createElement("button");
      del.className = "del-btn"; del.title = "Delete (within 30s)"; del.textContent = "🗑";
      del.onclick = () => deleteOwnMessage(m.id);
      el.querySelector(".bubble").appendChild(del);
      setTimeout(() => del.remove(), DELETE_WINDOW - age);
    }
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function removeMessage(id) {
  const el = $("messages").querySelector(`[data-mid="${id}"]`);
  if (el) el.remove();
  seen.delete(id);
}

async function deleteOwnMessage(id) {
  const { error } = await sb.from("messages").delete().eq("id", id);
  if (error) return alert(error.message);
  removeMessage(id); // realtime DELETE removes it for everyone else
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
      (payload) => { appendMessage(payload.new); markRead(gid); })   // chat is open → keep it read
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "messages", filter: "group_id=eq." + gid },
      (payload) => removeMessage(payload.old.id))
    .on("postgres_changes",
      { event: "*", schema: "public", table: "chat_reads", filter: "group_id=eq." + gid },
      ({ new: r }) => {                                  // someone read → refresh ticks live
        const me = auth.session()?.user?.id;
        if (r && r.user_id && r.user_id !== me) { readMap[r.user_id] = r.last_read_at; recomputeThreshold(); updateTicks(); }
      })
    .subscribe();
}

async function send(e) {
  e.preventDefault();
  const inp = $("msgInput");
  const content = inp.value.trim();
  if (!content || !current) return;
  inp.value = "";
  const u = auth.session().user;
  const row = { group_id: current.id, user_id: u.id, username: auth.username(), content };
  if (replyTo) { row.reply_to = replyTo.id; row.reply_user = replyTo.user; row.reply_preview = replyTo.preview; }
  cancelReply();
  const { data, error } = await sb.from("messages").insert(row).select().single();
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
  const row = { group_id: current.id, user_id: u.id, username: auth.username(), content: "", media_url: path, media_type: type };
  if (replyTo) { row.reply_to = replyTo.id; row.reply_user = replyTo.user; row.reply_preview = replyTo.preview; }
  cancelReply();
  const { data, error } = await sb.from("messages").insert(row).select().single();
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
  $("rbX").onclick = cancelReply;
  $("lbX").onclick = closeLightbox;
  $("lightbox").onclick = (e) => { if (e.target.id === "lightbox") closeLightbox(); };
  setupNotifyButton();
  try { await sb.rpc("upsert_profile", { p_username: auth.username() }); } catch (e) { console.warn(e); }
  try { const { data } = await sb.rpc("is_admin"); if (data) showAdminLink(); } catch {}
  loadChats();
  if (!memberSubbed) {
    memberSubbed = true;
    const uid = auth.session().user.id;
    sb.channel("mem-" + uid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_members", filter: "user_id=eq." + uid }, () => loadChats())
      .subscribe();
    // Any new message in a chat I'm not currently in → refresh unread badges + ordering.
    allChannel = sb.channel("all-msgs-" + uid)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
        ({ new: m }) => { if (m && m.user_id !== uid && (!current || m.group_id !== current.id)) loadChats(); })
      .subscribe();
  }
  const dm = new URLSearchParams(location.search).get("dm");
  if (dm) {
    try {
      const { data, error } = await sb.rpc("start_dm", { p_username: dm, p_me_username: auth.username() });
      if (!error && data) { history.replaceState({}, "", "messenger.html"); loadChats(data.id); }
    } catch (e) { console.warn(e); }
  }
}
async function setupNotifyButton() {
  const btn = $("notifyBtn");
  await registerSW();
  const render = async () => {
    const st = await pushState();
    if (st === "unsupported") { btn.style.display = "none"; return; }
    btn.style.display = "";
    if (st === "subscribed") { btn.textContent = "🔔 On"; btn.classList.add("on"); btn.title = "Notifications on — tap to turn off"; }
    else if (st === "denied") { btn.textContent = "🔕 Blocked"; btn.classList.remove("on"); btn.title = "Enable notifications in your browser/Safari settings"; }
    else { btn.textContent = "🔔 Notify"; btn.classList.remove("on"); btn.title = "Get notified of new messages"; }
  };
  btn.onclick = async () => {
    const st = await pushState();
    if (st === "subscribed") { await disablePush(); }
    else if (st === "denied") { alert("Notifications are blocked. Enable them for this site in your browser/Safari settings, then try again."); }
    else { const r = await enablePush(); if (!r.ok && r.error) alert(r.error); }
    render();
  };
  render();
}

function showAdminLink() {
  if ($("adminLink")) return;
  const a = document.createElement("a");
  a.id = "adminLink"; a.href = "admin.html"; a.textContent = "🛡 Admin"; a.className = "admin-link";
  $("acctHost").parentNode.insertBefore(a, $("acctHost"));
}

boot();
