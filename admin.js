/* Admin panel — read every group, DM, member and message. Gated by is_admin(). */
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

let sb = null, groups = [], current = null;

async function signedUrl(path) {
  try { const { data, error } = await sb.storage.from("chat-media").createSignedUrl(path, 3600); return error ? null : data.signedUrl; }
  catch { return null; }
}

async function loadGroups() {
  const { data, error } = await sb.rpc("admin_groups");
  if (error) { $("msg").textContent = "Error: " + error.message; return; }
  groups = data || [];
  renderList(groups);
}

function renderList(list) {
  const ul = $("glist");
  if (!list.length) { ul.innerHTML = `<li class="empty">No groups yet.</li>`; return; }
  ul.innerHTML = list.map((g) =>
    `<li class="grow ${current && current.id === g.id ? "active" : ""}" data-id="${g.id}">
       <div class="n">${esc(g.is_dm ? g.name : g.name)}${g.is_dm ? '<span class="tag">DM</span>' : ""}</div>
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
  current = null;
  $("detailH").innerHTML = "Select a group to inspect";
  $("mlist").innerHTML = "";
  loadGroups();
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
  $("search").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    renderList(groups.filter((g) => (g.name + " " + g.invite_code).toLowerCase().includes(q)));
  };
  loadGroups();
}

async function boot() {
  if (!auth.authConfigured) { $("msg").textContent = "Not configured."; return; }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth(() => gate());
  gate();
}
boot();
