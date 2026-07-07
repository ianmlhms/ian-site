/* Messenger — group chat + DMs + media, on Supabase. Shared accounts with PixelBreak. */
import * as auth from "./auth.js?v=4";
import { registerSW, enablePush, disablePush, pushState } from "./notify.js?v=2";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = (k) => (window.I18N ? window.I18N.t(k) : k);   // i18n lookup
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const adminTag = (uid) => (adminIds.has(uid) ? ` <span class="admin-tag">👑 Admin</span>` : "");
const classTag = (uid) => (classByUid[uid] ? ` <span class="class-tag">${esc(classByUid[uid])}</span>` : "");
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
let reactMap = {};           // message_id -> [{user_id, username, emoji}]
let onlineUsers = new Set(); // usernames currently online (presence)
let adminIds = new Set();    // user_ids of app admins → shown with a 👑 tag
let avatarMap = {};          // user_id -> avatar emoji OR uploaded-photo URL (from profiles)
let classByUid = {};         // user_id -> school class (shown as a tag next to the name)
const avatarOf = (uid) => avatarMap[uid] || "👤";
// render an avatar as an <img> when it's an uploaded photo URL, else the emoji glyph
const avatarHtml = (uid) => {
  const a = avatarOf(uid);
  return /^https?:\/\//.test(a) ? `<img class="av-img" src="${esc(a)}" alt="">` : a;
};
let onlineSubbed = false;
let allChats = [];           // last loaded chats, for search filtering
let lastTypingSent = 0, typingClear = null;
let mediaRecorder = null, recChunks = [], recording = false;
const REACT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const mutedSet = () => new Set(JSON.parse(localStorage.getItem("mutedChats") || "[]"));
function toggleMute(gid) { const s = mutedSet(); s.has(gid) ? s.delete(gid) : s.add(gid); localStorage.setItem("mutedChats", JSON.stringify([...s])); }

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
  allChats = data || [];
  renderChatList(applySearch(allChats));
  if (selectId) { const g = allChats.find((x) => x.id === selectId); if (g) selectChat(g); }
}

function applySearch(chats) {
  const q = ($("searchInput")?.value || "").trim().toLowerCase();
  if (!q) return chats;
  return chats.filter((g) => (g.display + " " + (g.last_preview || "") + " " + (g.last_sender || "")).toLowerCase().includes(q));
}

function renderChatList(chats) {
  const ul = $("groupList");
  if (!chats.length) { ul.innerHTML = `<li class="empty">${($("searchInput")?.value || "").trim() ? T("msg.noMatch") : T("msg.noChats")}</li>`; return; }
  ul.innerHTML = chats.map((g) => {
    const prev = g.last_preview
      ? `<span class="gprev">${g.last_sender ? esc(g.last_sender) + ": " : ""}${esc(g.last_preview)}</span>`
      : (g.is_dm ? "" : `<span class="gcode">#${esc(g.invite_code)}</span>`);
    const online = g.is_dm && onlineUsers.has(g.display) ? '<span class="on-dot" title="online"></span>' : "";
    const muted = mutedSet().has(g.id) ? " 🔕" : "";
    return `<li class="grp ${current && current.id === g.id ? "active" : ""} ${g.unread ? "unread" : ""}" data-id="${g.id}">
       <span class="gtop"><span class="gname">${g.is_dm ? "💬 " : ""}${esc(g.display)}${online}${muted}</span>${g.unread ? '<span class="dot"></span>' : ""}</span>
       ${prev}
     </li>`;
  }).join("");
  ul.querySelectorAll(".grp").forEach((li) =>
    (li.onclick = () => { const g = allChats.find((x) => x.id === +li.dataset.id); selectChat(g); }));
}

async function newGroup() {
  const name = await promptModal(T("msg.newGroup.title"), T("msg.newGroup.label"), T("msg.newGroup.ok"));
  if (!name) return;
  const { data, error } = await sb.rpc("create_group", { p_name: name, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}
async function joinGroup() {
  const code = await promptModal(T("msg.join.title"), T("msg.join.label"), T("btn.join"));
  if (!code) return;
  const { data, error } = await sb.rpc("join_group", { p_code: code, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}
async function newDM() {
  const uname = await promptModal(T("msg.dm.title"), T("msg.dm.label"), T("msg.dm.ok"));
  if (!uname) return;
  const { data, error } = await sb.rpc("start_dm", { p_username: uname, p_me_username: auth.username() });
  if (error) return alert(error.message);
  await loadChats(data.id);
}

/* ---------- a single chat ---------- */
async function selectChat(g) {
  current = g; seen.clear();
  currentOthers = []; readMap = {}; readThreshold = null; reactMap = {}; hideTyping();
  closeMembers(); cancelReply();
  markRead(g.id);
  document.querySelectorAll(".grp").forEach((li) => {
    const on = +li.dataset.id === g.id;
    li.classList.toggle("active", on);
    if (on) li.classList.remove("unread");           // clear the badge immediately
  });
  const onlineHead = g.is_dm && onlineUsers.has(g.display) ? `<span class="on-dot"></span><span class="presence">online</span>` : "";
  $("chatHead").innerHTML =
    `<button class="back-btn" id="backBtn" title="${esc(T("msg.chats"))}">‹</button>
     <b>${g.is_dm ? "💬 " : ""}${esc(g.display)}</b><span id="headPresence">${onlineHead}</span>
     ${g.is_dm ? "" : `<span class="invite" title="${esc(T("msg.tip.join"))}">code: <code>${esc(g.invite_code)}</code></span>`}
     <span class="head-actions">
       <button id="muteBtn" title="Mute">${mutedSet().has(g.id) ? "🔕" : "🔔"}</button>
       <button id="membersBtn" title="${esc(T("msg.members"))}">👥</button>
       <button id="leaveBtn" title="Leave">🚪</button>
     </span>`;
  $("backBtn").onclick = goBackToList;
  $("muteBtn").onclick = () => { toggleMute(g.id); $("muteBtn").textContent = mutedSet().has(g.id) ? "🔕" : "🔔"; renderChatList(applySearch(allChats)); };
  $("membersBtn").onclick = toggleMembers;
  $("leaveBtn").onclick = leaveChat;
  $("app").classList.add("chat-open");   // mobile: show the conversation full-screen
  $("composer").style.display = "flex";
  const box = $("messages");
  box.innerHTML = `<div class="empty">${T("common.loading")}</div>`;
  loadAvatars();   // pick up avatar changes without a reload
  loadClasses();   // and class tags
  const { data, error } = await sb.from("messages").select("*").eq("group_id", g.id).order("created_at").limit(300);
  if (error) { box.innerHTML = `<div class="empty">${T("msg.loadErr")}</div>`; return; }
  box.innerHTML = "";
  (data || []).forEach(appendMessage);
  if (!data || !data.length) box.innerHTML = `<div class="empty">${T("msg.noMessages")}</div>`;
  subscribe(g.id);
  loadReceipts(g.id);
  loadReactions(g.id);
}

async function leaveChat() {
  if (!current) return;
  if (!confirm(T("msg.leaveConfirm").replace("{name}", current.display))) return;
  const uid = auth.session().user.id;
  const { error } = await sb.from("group_members").delete().eq("group_id", current.id).eq("user_id", uid);
  if (error) return alert(error.message);
  if (channel) { sb.removeChannel(channel); channel = null; }
  current = null;
  $("chatHead").innerHTML = T("msg.selectChat");
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
  p.innerHTML = `<div class="mp-head">${T("msg.members")} <button id="mpX">&times;</button></div><div class="mp-list">${T("common.loading")}</div>`;
  $("mpX").onclick = closeMembers;
  const { data, error } = await sb.from("group_members").select("username,user_id,joined_at").eq("group_id", current.id);
  const me = auth.session().user.id;
  p.querySelector(".mp-list").innerHTML = error || !data ? T("msg.loadFail") :
    data.map((m) => `<div class="mp-row"><span class="mp-av">${avatarHtml(m.user_id)}</span> ${esc(m.username)}${classTag(m.user_id)}${adminTag(m.user_id)}${m.user_id === me ? ` <span class='you'>${T("msg.you")}</span>` : ""}</div>`).join("");
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
  el.title = read ? T("msg.read") : T("msg.sent");
}
function updateTicks() { $("messages").querySelectorAll(".msg.mine .ticks").forEach(paintTick); }

/* ---------- reactions ---------- */
async function loadReactions(gid) {
  reactMap = {};
  const { data } = await sb.from("message_reactions").select("message_id,user_id,username,emoji").eq("group_id", gid);
  (data || []).forEach((r) => { (reactMap[r.message_id] = reactMap[r.message_id] || []).push(r); });
  $("messages").querySelectorAll(".msg").forEach((el) => renderReactions(+el.dataset.mid));
}
function renderReactions(mid) {
  const el = $("messages").querySelector(`[data-mid="${mid}"] .reacts`);
  if (!el) return;
  const me = auth.session().user.id;
  const byEmoji = {};
  (reactMap[mid] || []).forEach((r) => { (byEmoji[r.emoji] = byEmoji[r.emoji] || []).push(r); });
  el.innerHTML = Object.keys(byEmoji).map((em) => {
    const rs = byEmoji[em], mineR = rs.some((r) => r.user_id === me);
    return `<span class="react-chip ${mineR ? "mine-r" : ""}" data-em="${em}" title="${rs.map((r) => esc(r.username)).join(", ")}">${em} ${rs.length}</span>`;
  }).join("");
  el.querySelectorAll(".react-chip").forEach((c) => (c.onclick = () => toggleReaction(mid, c.dataset.em)));
}
async function toggleReaction(mid, emoji) {
  const me = auth.session().user.id;
  const list = reactMap[mid] || [];
  const had = list.some((r) => r.user_id === me && r.emoji === emoji);
  if (had) {
    reactMap[mid] = list.filter((r) => !(r.user_id === me && r.emoji === emoji));
    renderReactions(mid);
    await sb.from("message_reactions").delete().eq("message_id", mid).eq("user_id", me).eq("emoji", emoji);
  } else {
    const row = { message_id: mid, group_id: current.id, user_id: me, username: auth.username(), emoji };
    reactMap[mid] = [...list, row]; renderReactions(mid);
    await sb.from("message_reactions").insert(row);
  }
}
function onReaction(type, r) {
  if (!current || r.group_id !== current.id) return;
  if (r.user_id === auth.session().user.id) return;     // already applied locally
  const list = reactMap[r.message_id] = reactMap[r.message_id] || [];
  if (type === "INSERT") { if (!list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) list.push(r); }
  else reactMap[r.message_id] = list.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji));
  renderReactions(r.message_id);
}
function openReactPicker(mid, anchorEl) {
  closeReactPicker();
  const pop = document.createElement("div");
  pop.className = "react-pop"; pop.id = "reactPop";
  pop.innerHTML = REACT_EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join("");
  anchorEl.closest(".bubble").appendChild(pop);
  pop.querySelectorAll("button").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); toggleReaction(mid, b.dataset.e); closeReactPicker(); }));
  setTimeout(() => document.addEventListener("click", closeReactPicker, { once: true }), 0);
}
function closeReactPicker() { const p = $("reactPop"); if (p) p.remove(); }

/* ---------- edit ---------- */
async function editMessage(m) {
  const next = prompt(T("msg.editPrompt"), m.content || "");
  if (next === null) return;
  const t = next.trim();
  if (!t || t === (m.content || "")) return;
  m.content = t;
  const { error } = await sb.from("messages").update({ content: t, edited_at: new Date().toISOString() }).eq("id", m.id);
  if (error) return alert(error.message);
  updateMessageContent(m.id, t, true);
}
function updateMessageContent(id, content, edited) {
  const bubble = $("messages").querySelector(`[data-mid="${id}"] .bubble`);
  if (!bubble) return;
  const txt = bubble.querySelector(".msg-text"); if (txt) txt.textContent = content;
  if (edited && !bubble.querySelector(".edited")) {
    const tag = document.createElement("span"); tag.className = "edited"; tag.textContent = T("msg.edited");
    bubble.querySelector(".time").before(tag);
  }
}

/* ---------- typing indicator ---------- */
function sendTyping() {
  if (!current || !channel) return;
  const now = Date.now();
  if (now - lastTypingSent < 1500) return;
  lastTypingSent = now;
  channel.send({ type: "broadcast", event: "typing", payload: { user: auth.username() } });
}
function showTyping(user) {
  const t = $("typing"); if (!t) return;
  t.textContent = T("msg.typing").replace("{user}", user); t.classList.add("show");
  clearTimeout(typingClear); typingClear = setTimeout(hideTyping, 3000);
}
function hideTyping() { const t = $("typing"); if (t) { t.classList.remove("show"); t.textContent = ""; } clearTimeout(typingClear); }

/* ---------- voice messages ---------- */
async function toggleRecording() {
  if (recording) { stopRecording(); return; }
  if (!current) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); await sendVoice(new Blob(recChunks, { type: mediaRecorder.mimeType || "audio/webm" })); };
    mediaRecorder.start();
    recording = true; $("micBtn").classList.add("rec"); $("micBtn").textContent = "⏹";
  } catch { alert(T("msg.micErr")); }
}
function stopRecording() {
  if (mediaRecorder && recording) { recording = false; $("micBtn").classList.remove("rec"); $("micBtn").textContent = "🎤"; try { mediaRecorder.stop(); } catch {} }
}
async function sendVoice(blob) {
  if (!current || !blob.size) return;
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const path = `${current.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await sb.storage.from("chat-media").upload(path, blob, { contentType: blob.type });
  if (upErr) return alert(T("msg.uploadFail") + ": " + upErr.message);
  const u = auth.session().user;
  const { data, error } = await sb.from("messages")
    .insert({ group_id: current.id, user_id: u.id, username: auth.username(), content: "", media_url: path, media_type: "audio" }).select().single();
  if (error) return alert(error.message);
  appendMessage(data);
}

/* ---------- online presence ---------- */
function startOnlinePresence() {
  if (onlineSubbed) return; onlineSubbed = true;
  const oc = sb.channel("online", { config: { presence: { key: auth.username() } } });
  oc.on("presence", { event: "sync" }, () => {
    const st = oc.presenceState();
    onlineUsers = new Set(Object.keys(st).map((k) => (st[k][0] || {}).username).filter(Boolean));
    renderChatList(applySearch(allChats));
    refreshHeadPresence();
  }).subscribe(async (s) => { if (s === "SUBSCRIBED") await oc.track({ username: auth.username() }); });
}
function refreshHeadPresence() {
  const hp = $("headPresence"); if (!hp || !current) return;
  hp.innerHTML = current.is_dm && onlineUsers.has(current.display) ? `<span class="on-dot"></span><span class="presence">online</span>` : "";
}

/* ---------- reply ---------- */
function snippet(m) {
  if (m.content && m.content.trim()) return m.content.trim().slice(0, SNIPPET);
  if (m.media_type === "video") return T("msg.snippet.video");
  if (m.media_type === "image") return T("msg.snippet.photo");
  if (m.media_type === "file") return "📎 " + (m.content ? m.content.slice(0, SNIPPET) : T("msg.snippet.file").replace("📎 ", ""));
  return T("msg.snippet.msg");
}
/* pick an emoji for a filename's extension */
function fileIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return "📕";
  if (["doc", "docx", "odt", "rtf", "txt", "md"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)) return "📊";
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return "📽️";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["mp3", "wav", "m4a", "flac", "aac", "ogg"].includes(ext)) return "🎵";
  return "📄";
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
  const isFile = m.media_type === "file";
  const body = (m.content && !isFile) ? esc(m.content) : "";   // for files, content holds the filename, shown in the chip
  const replyHtml = m.reply_user
    ? `<span class="reply-quote" data-rid="${m.reply_to || ""}"><span class="rq-user">${esc(m.reply_user)}</span><span class="rq-text">${esc(m.reply_preview || "")}</span></span>`
    : "";
  const avHtml = mine ? "" : `<span class="av-chip" aria-hidden="true">${avatarHtml(m.user_id)}</span>`;
  el.innerHTML = `${avHtml}<div class="bubble"><span class="who">${esc(m.username)}${classTag(m.user_id)}${adminTag(m.user_id)}</span>${replyHtml}<span class="msg-text">${body}</span>${m.edited_at ? `<span class="edited">${T("msg.edited")}</span>` : ""}<span class="time">${fmtTime(m.created_at)}</span><span class="reacts"></span></div>`;
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
    if (m.media_type === "audio") {
      const au = document.createElement("audio"); au.className = "voice"; au.controls = true;
      bubble.insertBefore(au, el.querySelector(".time"));
      signedUrl(m.media_url).then((u) => { if (u) au.src = u; });
    } else if (m.media_type === "file") {
      const a = document.createElement("a");
      a.className = "filechip"; a.target = "_blank"; a.rel = "noopener";
      a.download = m.content || "file";
      a.innerHTML = `<span class="fc-ico">${fileIcon(m.content)}</span><span class="fc-name">${esc(m.content || "File")}</span><span class="fc-dl">⬇</span>`;
      bubble.insertBefore(a, el.querySelector(".time"));
      signedUrl(m.media_url).then((u) => { if (u) a.href = u; });
    } else {
      const wrap = document.createElement(m.media_type === "video" ? "video" : "img");
      wrap.className = "media";
      if (m.media_type === "video") wrap.controls = true;
      else wrap.onclick = () => { if (Date.now() < suppressClickUntil) return; if (wrap.src) openLightbox(wrap.src); };   // tap photo → fullscreen
      bubble.insertBefore(wrap, el.querySelector(".time"));
      signedUrl(m.media_url).then((u) => { if (u) wrap.src = u; });
    }
  }
  // desktop hover reply button
  const rbtn = document.createElement("button");
  rbtn.className = "reply-btn"; rbtn.title = "Reply"; rbtn.textContent = "↩";
  rbtn.onclick = (e) => { e.stopPropagation(); startReply(m); };
  bubble.appendChild(rbtn);
  // react button + picker
  const reactBtn = document.createElement("button");
  reactBtn.className = "react-btn"; reactBtn.title = "React"; reactBtn.textContent = "🙂";
  reactBtn.onclick = (e) => { e.stopPropagation(); openReactPicker(m.id, reactBtn); };
  bubble.appendChild(reactBtn);
  attachReplyGestures(el, m);
  if (mine) {
    let delRight = -8;
    if (m.content) {                                   // edit own text messages, anytime
      const ed = document.createElement("button");
      ed.className = "del-btn"; ed.title = "Edit"; ed.textContent = "✏️";
      ed.onclick = () => editMessage(m);
      bubble.appendChild(ed); delRight = 20;            // delete sits to the left of edit
    }
    const tk = document.createElement("span");
    tk.className = "ticks"; tk.dataset.ts = m.created_at;
    bubble.appendChild(tk); paintTick(tk);
    const age = Date.now() - new Date(m.created_at).getTime();
    if (age < DELETE_WINDOW) {
      const del = document.createElement("button");
      del.className = "del-btn"; del.style.right = delRight + "px"; del.title = "Delete (within 30s)"; del.textContent = "🗑";
      del.onclick = () => deleteOwnMessage(m.id);
      bubble.appendChild(del);
      setTimeout(() => del.remove(), DELETE_WINDOW - age);
    }
  }
  box.appendChild(el);
  renderReactions(m.id);
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
      { event: "UPDATE", schema: "public", table: "messages", filter: "group_id=eq." + gid },
      ({ new: m }) => { if (m) updateMessageContent(m.id, m.content, !!m.edited_at); })   // edits
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "message_reactions", filter: "group_id=eq." + gid },
      ({ new: r }) => onReaction("INSERT", r))
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "message_reactions", filter: "group_id=eq." + gid },
      ({ old: r }) => onReaction("DELETE", r))
    .on("postgres_changes",
      { event: "*", schema: "public", table: "chat_reads", filter: "group_id=eq." + gid },
      ({ new: r }) => {                                  // someone read → refresh ticks live
        const me = auth.session()?.user?.id;
        if (r && r.user_id && r.user_id !== me) { readMap[r.user_id] = r.last_read_at; recomputeThreshold(); updateTicks(); }
      })
    .on("broadcast", { event: "typing" }, ({ payload }) => { if (payload && payload.user !== auth.username()) showTyping(payload.user); })
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
  const type = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "file";
  if (file.size > MAX_MEDIA) return alert(T("msg.tooLarge"));
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${current.id}/${crypto.randomUUID()}.${ext}`;
  const att = $("attachBtn"); att.disabled = true; att.textContent = "⏳";
  const { error: upErr } = await sb.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream" });
  att.disabled = false; att.textContent = "📎";
  if (upErr) return alert(T("msg.uploadFail") + ": " + upErr.message);
  const u = auth.session().user;
  // for generic files we keep the original filename in `content` (no text body for files)
  const row = { group_id: current.id, user_id: u.id, username: auth.username(), content: type === "file" ? (file.name || "file").slice(0, 120) : "", media_url: path, media_type: type };
  if (replyTo) { row.reply_to = replyTo.id; row.reply_user = replyTo.user; row.reply_preview = replyTo.preview; }
  cancelReply();
  const { data, error } = await sb.from("messages").insert(row).select().single();
  if (error) return alert(error.message);
  appendMessage(data);
}

/* ---------- boot ---------- */
async function loadAvatars() {
  // avatar column may not exist yet (migration pending) — fail quietly then
  try {
    const { data, error } = await sb.from("profiles").select("id,avatar");
    if (error) throw error;
    avatarMap = {};
    for (const p of data || []) if (p.avatar) avatarMap[p.id] = p.avatar;
  } catch (e) { console.warn("[msgr] avatars", e); }
}

// Separate from avatars so a not-yet-migrated `class` column can't break avatars.
async function loadClasses() {
  try {
    const { data, error } = await sb.from("profiles").select("id,class");
    if (error) throw error;
    classByUid = {};
    for (const p of data || []) if (p.class) classByUid[p.id] = p.class;
  } catch (e) { console.warn("[msgr] classes", e); }
}

async function boot() {
  if (!auth.authConfigured) {
    $("gate").innerHTML = `<div class="gate-box"><h3>${T("msg.h1")}</h3></div>`;
    $("gate").style.display = "flex"; return;
  }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  try { const { data } = await sb.rpc("admin_user_ids"); adminIds = new Set((data || []).map((r) => r.user_id)); } catch (e) { console.warn("[msgr] admin ids", e); }
  loadAvatars();
  loadClasses();
  auth.onAuth((s) => (s ? showApp() : showGate()));
  auth.session() ? showApp() : showGate();
}
function showGate() {
  current = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  $("app").style.display = "none";
  $("gate").style.display = "flex";
  $("gate").innerHTML = `<div class="gate-box">
    <h3>${T("msg.h1")}</h3><p>${T("msg.gateTitle")}<br>${T("msg.gateSub")}</p>
    <button class="auth-go" id="gateBtn">${T("auth.signin")}</button></div>`;
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
  $("micBtn").onclick = toggleRecording;
  $("msgInput").addEventListener("input", sendTyping);
  $("searchInput").addEventListener("input", () => renderChatList(applySearch(allChats)));
  startOnlinePresence();
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
    if (st === "subscribed") { btn.textContent = T("msg.notify.on"); btn.classList.add("on"); btn.title = T("msg.notify.onTip"); }
    else if (st === "denied") { btn.textContent = T("msg.notify.blocked"); btn.classList.remove("on"); btn.title = T("msg.notify.blockedTip"); }
    else { btn.textContent = T("msg.notify.notify"); btn.classList.remove("on"); btn.title = T("msg.notify.offTip"); }
  };
  btn.onclick = async () => {
    const st = await pushState();
    if (st === "subscribed") { await disablePush(); }
    else if (st === "denied") { alert(T("msg.notify.blockedAlert")); }
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

// Re-render dynamic chrome when the site language changes.
document.addEventListener("i18n:change", () => {
  if (!sb) return;
  if (auth.session()) { if (allChats.length) renderChatList(applySearch(allChats)); }
  else showGate();
});
