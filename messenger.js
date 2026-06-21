/* Messenger — real-time group chat on Supabase, shared accounts with PixelBreak. */
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };

let sb = null;
let current = null;          // current group {id,name,invite_code,...}
let channel = null;          // realtime channel
const seen = new Set();      // message ids already shown

/* ---------- tiny prompt modal ---------- */
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

/* ---------- groups ---------- */
async function loadGroups(selectId) {
  const { data, error } = await sb.rpc("my_groups");
  if (error) { console.warn("[msgr] my_groups", error); return; }
  renderGroupList(data || []);
  if (selectId) { const g = (data || []).find((x) => x.id === selectId); if (g) selectGroup(g); }
}

function renderGroupList(groups) {
  const ul = $("groupList");
  if (!groups.length) { ul.innerHTML = `<li class="empty">No groups yet.<br>Create one or join with a code.</li>`; return; }
  ul.innerHTML = groups.map((g) =>
    `<li class="grp ${current && current.id === g.id ? "active" : ""}" data-id="${g.id}">
       <span class="gname">${esc(g.name)}</span><span class="gcode">#${esc(g.invite_code)}</span>
     </li>`).join("");
  ul.querySelectorAll(".grp").forEach((li) =>
    (li.onclick = () => { const g = groups.find((x) => x.id === +li.dataset.id); selectGroup(g); }));
}

async function newGroup() {
  const name = await promptModal("New group", "Group name", "Create");
  if (!name) return;
  const { data, error } = await sb.rpc("create_group", { p_name: name, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadGroups(data.id);
}

async function joinGroup() {
  const code = await promptModal("Join a group", "Invite code (e.g. a1b2c3)", "Join");
  if (!code) return;
  const { data, error } = await sb.rpc("join_group", { p_code: code, p_username: auth.username() });
  if (error) return alert(error.message);
  await loadGroups(data.id);
}

/* ---------- messages ---------- */
async function selectGroup(g) {
  current = g;
  seen.clear();
  document.querySelectorAll(".grp").forEach((li) => li.classList.toggle("active", +li.dataset.id === g.id));
  $("chatHead").innerHTML =
    `<b>${esc(g.name)}</b><span class="invite" title="Share this code so others can join">invite code: <code>${esc(g.invite_code)}</code></span>`;
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

function appendMessage(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  const box = $("messages");
  const placeholder = box.querySelector(".empty"); if (placeholder) placeholder.remove();
  const mine = auth.session() && m.user_id === auth.session().user.id;
  const el = document.createElement("div");
  el.className = "msg" + (mine ? " mine" : "");
  el.innerHTML = `<div class="bubble"><span class="who">${esc(m.username)}</span>${esc(m.content)}<span class="time">${fmtTime(m.created_at)}</span></div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
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
    .insert({ group_id: current.id, user_id: u.id, username: auth.username(), content })
    .select().single();
  if (error) { inp.value = content; return alert(error.message); }
  appendMessage(data); // optimistic; realtime echo is de-duped by id
}

/* ---------- boot ---------- */
async function boot() {
  if (!auth.authConfigured) {
    $("gate").innerHTML = `<div class="gate-box"><h3>Messenger isn't configured yet</h3><p>Cloud accounts aren't set up.</p></div>`;
    $("gate").style.display = "flex";
    return;
  }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth((s) => { if (s) showApp(); else showGate(); });
  (auth.session() ? showApp() : showGate());
}

function showGate() {
  current = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  $("app").style.display = "none";
  $("gate").style.display = "flex";
  $("gate").innerHTML = `<div class="gate-box">
    <h3>💬 Messenger</h3><p>Sign in to chat and create groups.<br>Same account as PixelBreak.</p>
    <button class="auth-go" id="gateBtn">Sign in / Create account</button></div>`;
  $("gateBtn").onclick = auth.openAuthModal;
}

function showApp() {
  $("gate").style.display = "none";
  $("app").style.display = "flex";
  $("newG").onclick = newGroup;
  $("joinG").onclick = joinGroup;
  $("composer").onsubmit = send;
  loadGroups();
}

boot();
