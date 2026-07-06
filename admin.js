/* Admin panel — moderate groups/messages AND manage registered users.
 * All privileged actions are guarded server-side by is_admin(). */
import * as auth from "./auth.js?v=4";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

let sb = null, mode = "groups", groups = [], users = [], current = null;

async function signedUrl(path) {
  try { const { data, error } = await sb.storage.from("chat-media").createSignedUrl(path, 3600); return error ? null : data.signedUrl; }
  catch { return null; }
}

/* ============================ GROUPS ============================ */
async function loadGroups() {
  const { data, error } = await sb.rpc("admin_groups");
  if (error) { $("msg").textContent = "Error: " + error.message; return; }
  groups = data || [];
  renderGroupList(groups);
}
function renderGroupList(list) {
  const ul = $("glist");
  if (!list.length) { ul.innerHTML = `<li class="empty">No groups yet.</li>`; return; }
  ul.innerHTML = list.map((g) =>
    `<li class="grow ${current && current.id === g.id ? "active" : ""}" data-id="${g.id}">
       <div class="n">${esc(g.name)}${g.is_dm ? '<span class="tag">DM</span>' : ""}</div>
       <div class="meta">#${esc(g.invite_code)} · ${g.member_count} member(s) · ${g.message_count} msg · ${fmt(g.created_at)}</div>
     </li>`).join("");
  ul.querySelectorAll(".grow").forEach((li) => (li.onclick = () => openGroup(+li.dataset.id)));
}
async function openGroup(id) {
  current = groups.find((g) => g.id === id);
  if (!current) return;
  document.querySelectorAll(".grow").forEach((li) => li.classList.toggle("active", +li.dataset.id === id));
  const [{ data: members }, { data: msgs }] = await Promise.all([
    sb.rpc("admin_members", { p_group_id: id }),
    sb.rpc("admin_messages", { p_group_id: id }),
  ]);
  const chips = (members || []).map((m) =>
    `<span class="chip">${esc(m.username)}<button class="chip-x" data-uid="${m.user_id}" title="Remove from group">&times;</button></span>`).join("") || "<span class='muted'>no members</span>";
  $("detailH").innerHTML =
    `<div class="dh-top"><b>${esc(current.name)}</b>${current.is_dm ? '<span class="tag dm">DM</span>' : ""}
       <button class="danger" id="delGroup">Delete group</button></div>
     <div class="members" id="memberBar">${chips}</div>
     <div class="addmem"><input id="addUser" placeholder="add member by username" autocomplete="off"><button id="addBtn">Add</button></div>`;
  $("delGroup").onclick = () => deleteGroup(id);
  $("addBtn").onclick = () => addMember(id);
  $("addUser").addEventListener("keydown", (e) => { if (e.key === "Enter") addMember(id); });
  $("memberBar").querySelectorAll(".chip-x").forEach((b) => (b.onclick = () => removeMember(id, b.dataset.uid)));
  const box = $("mlist");
  if (!msgs || !msgs.length) { box.innerHTML = `<div class="empty">No messages.</div>`; return; }
  box.innerHTML = "";
  msgs.forEach((m) => {
    const el = document.createElement("div");
    el.className = "am";
    el.innerHTML = `<span class="who">${esc(m.username)}</span><span class="txt">${esc(m.content || "")}</span>
      <button class="msg-del" title="Delete message">🗑</button><span class="when">${fmt(m.created_at)}</span>`;
    if (m.media_url) {
      const tag = m.media_type === "video" ? document.createElement("video") : document.createElement("img");
      tag.className = "media"; if (m.media_type === "video") tag.controls = true;
      el.querySelector(".txt").appendChild(tag);
      signedUrl(m.media_url).then((u) => { if (u) tag.src = u; });
    }
    el.querySelector(".msg-del").onclick = () => deleteMessage(m.id, id);
    box.appendChild(el);
  });
  box.scrollTop = 0;
}
async function deleteGroup(id) {
  if (!confirm("Delete this entire group/DM and ALL its messages? This cannot be undone.")) return;
  const { error } = await sb.rpc("admin_delete_group", { p_group_id: id });
  if (error) return alert(error.message);
  current = null; $("detailH").innerHTML = "Select a group to inspect"; $("mlist").innerHTML = ""; loadGroups();
}
async function deleteMessage(mid, gid) {
  const { error } = await sb.rpc("admin_delete_message", { p_message_id: mid });
  if (error) return alert(error.message);
  openGroup(gid);
}
async function removeMember(gid, uid) {
  if (!confirm("Remove this member from the group?")) return;
  const { error } = await sb.rpc("admin_remove_member", { p_group_id: gid, p_user_id: uid });
  if (error) return alert(error.message);
  await openGroup(gid); loadGroups();
}
async function addMember(gid) {
  const u = ($("addUser").value || "").trim();
  if (!u) return;
  const { error } = await sb.rpc("admin_add_member", { p_group_id: gid, p_username: u });
  if (error) return alert(error.message);
  await openGroup(gid); loadGroups();
}

/* ============================ USERS ============================ */
async function loadUsers() {
  const { data, error } = await sb.rpc("admin_list_users");
  if (error) { $("glist").innerHTML = `<li class="empty">Error: ${esc(error.message)}</li>`; return; }
  users = data || [];
  renderUserList(users);
}
function renderUserList(list) {
  const ul = $("glist");
  if (!list.length) { ul.innerHTML = `<li class="empty">No users.</li>`; return; }
  ul.innerHTML = list.map((u) =>
    `<li class="grow ${current && current.id === u.id ? "active" : ""}" data-uid="${u.id}">
       <div class="n">${esc(u.username || "(no username)")}</div>
       <div class="meta">${esc(u.email)} · joined ${fmt(u.created_at)}${u.confirmed ? "" : " · ⚠ unconfirmed"}</div>
     </li>`).join("");
  ul.querySelectorAll(".grow").forEach((li) => (li.onclick = () => openUser(li.dataset.uid)));
}
function genPassword() {
  const cs = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => cs[b % cs.length]).join("");
}
function openUser(uid) {
  current = users.find((u) => u.id === uid);
  if (!current) return;
  document.querySelectorAll(".grow").forEach((li) => li.classList.toggle("active", li.dataset.uid === uid));
  const u = current;
  $("detailH").innerHTML =
    `<div class="dh-top"><b>${esc(u.username || "(no username)")}</b>
       <button class="danger" id="delUser">Delete user</button></div>`;
  $("mlist").innerHTML =
    `<div class="uinfo">
       <div><span class="k">Email</span><br>${esc(u.email)}</div>
       <div><span class="k">User ID</span><br><span class="muted" style="font-family:ui-monospace,monospace">${esc(u.id)}</span></div>
       <div><span class="k">Joined</span> ${fmt(u.created_at)}</div>
       <div><span class="k">Last sign-in</span> ${u.last_sign_in_at ? fmt(u.last_sign_in_at) : "never"}</div>
       <div><span class="k">Email confirmed</span> ${u.confirmed ? "yes" : "no"}</div>
     </div>
     <div class="uact">
       <h4>Reset password</h4>
       <div class="pwrow">
         <input id="newPw" value="${genPassword()}">
         <button class="pwgen" id="genPw" title="Generate new">🎲</button>
         <button id="setPw">Set</button>
       </div>
       <div class="hint">Passwords can't be viewed (they're encrypted). Set a new one here and share it — the user can change it later after signing in.</div>
       <div class="pwresult" id="pwResult"></div>
     </div>
     <div class="uact">
       <h4>FakeStake balance 🪙</h4>
       <div class="pwrow">
         <input id="casBal" type="number" min="0" step="1" placeholder="loading…">
         <button id="setCas">Set</button>
       </div>
       <div class="hint">Play-money coins in this user's FakeStake casino account. Takes effect the next time they open the casino.</div>
       <div class="pwresult" id="casResult"></div>
     </div>`;
  $("delUser").onclick = () => deleteUser(uid);
  $("genPw").onclick = () => { $("newPw").value = genPassword(); };
  $("setPw").onclick = () => setUserPassword(uid);
  $("setCas").onclick = () => setUserCasino(uid);
  // fill the current balance (profiles is readable; null = never played)
  sb.from("profiles").select("casino_balance").eq("id", uid).single().then(({ data }) => {
    const el = $("casBal"); if (el) el.value = data && data.casino_balance != null ? Number(data.casino_balance) : 0;
  });
}
async function setUserCasino(uid) {
  const v = parseFloat($("casBal").value);
  if (!Number.isFinite(v) || v < 0) return alert("Enter a non-negative number.");
  const { error } = await sb.rpc("admin_set_casino_balance", { p_user_id: uid, p_bal: v });
  if (error) return alert(error.message);
  $("casResult").innerHTML = `✓ Balance set to 🪙 ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
}
async function deleteUser(uid) {
  if (!confirm("Permanently delete this user and ALL their data (messages, scores, memberships)? This cannot be undone.")) return;
  const { error } = await sb.rpc("admin_delete_user", { p_user_id: uid });
  if (error) return alert(error.message);
  current = null; $("detailH").innerHTML = "Select a user"; $("mlist").innerHTML = ""; loadUsers();
}
async function setUserPassword(uid) {
  const pw = ($("newPw").value || "").trim();
  if (pw.length < 6) return alert("Password must be at least 6 characters.");
  const { error } = await sb.rpc("admin_set_password", { p_user_id: uid, p_password: pw });
  if (error) return alert(error.message);
  $("pwResult").innerHTML = `✓ Password set to <code>${esc(pw)}</code> — give this to the user.`;
}

/* ============================ FEEDBACK ============================ */
let feedback = [];
const KIND = { idea: "💡", bug: "🐛", other: "💬" };
async function loadFeedback() {
  const { data, error } = await sb.from("feedback").select("*").order("created_at", { ascending: false });
  if (error) { $("mlist").innerHTML = `<div class="empty">Error: ${esc(error.message)}</div>`; return; }
  feedback = data || [];
  renderFeedback(feedback);
}
function renderFeedback(list) {
  $("glist").innerHTML = `<li class="empty">${list.length} submission(s)</li>`;
  const box = $("mlist");
  if (!list.length) { box.innerHTML = `<div class="empty">No feedback yet.</div>`; return; }
  box.innerHTML = "";
  list.forEach((f) => {
    const el = document.createElement("div");
    el.className = "am";
    el.innerHTML = `<span class="who">${KIND[f.kind] || "💬"}</span>
      <span class="txt">${esc(f.message)}<br><span class="muted">${esc(f.page || "?")}${f.username ? " · " + esc(f.username) : ""}</span></span>
      <button class="msg-del" title="Delete">🗑</button><span class="when">${fmt(f.created_at)}</span>`;
    el.querySelector(".msg-del").onclick = () => deleteFeedback(f.id);
    box.appendChild(el);
  });
  box.scrollTop = 0;
}
async function deleteFeedback(id) {
  if (!confirm("Delete this feedback?")) return;
  const { error } = await sb.from("feedback").delete().eq("id", id);
  if (error) return alert(error.message);
  loadFeedback();
}

/* ============================ SHARED ============================ */
function setMode(m) {
  mode = m; current = null;
  $("tabGroups").classList.toggle("active", m === "groups");
  $("tabUsers").classList.toggle("active", m === "users");
  $("tabFeedback").classList.toggle("active", m === "feedback");
  $("search").value = "";
  $("search").placeholder = m === "groups" ? "Search groups / DMs…" : m === "users" ? "Search users…" : "Search feedback…";
  $("detailH").innerHTML = m === "groups" ? "Select a group to inspect" : m === "users" ? "Select a user" : "💬 Feedback";
  $("mlist").innerHTML = "";
  $("glist").innerHTML = "";
  if (m === "groups") loadGroups(); else if (m === "users") loadUsers(); else loadFeedback();
}

function showDenied() {
  $("panel").style.display = "none";
  $("msg").style.display = "flex";
  $("msg").innerHTML = auth.session()
    ? `<div>Not authorized.<br><span style="font-size:13px">This account isn't an admin.</span></div>`
    : `<div>Admin sign-in required.<br><button class="auth-go" id="go">Sign in</button></div>`;
  const go = $("go"); if (go) go.onclick = auth.openAuthModal;
}

async function gate() {
  if (!auth.session()) return showDenied();
  let admin = false;
  try { const { data } = await sb.rpc("is_admin"); admin = !!data; } catch {}
  if (!admin) return showDenied();
  $("msg").style.display = "none";
  $("panel").style.display = "flex";
  $("tabGroups").onclick = () => setMode("groups");
  $("tabUsers").onclick = () => setMode("users");
  $("tabFeedback").onclick = () => setMode("feedback");
  $("search").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    if (mode === "groups") renderGroupList(groups.filter((g) => (g.name + " " + g.invite_code).toLowerCase().includes(q)));
    else if (mode === "users") renderUserList(users.filter((u) => ((u.email || "") + " " + (u.username || "")).toLowerCase().includes(q)));
    else renderFeedback(feedback.filter((f) => ((f.message || "") + " " + (f.username || "") + " " + (f.page || "")).toLowerCase().includes(q)));
  };
  setMode("groups");
}

async function boot() {
  if (!auth.authConfigured) { $("msg").textContent = "Not configured."; return; }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth(() => gate());
  gate();
}
boot();
