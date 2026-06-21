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
  document.querySelectorAll(".grow").forEach((li) => li.classList.toggle("active", +li.dataset.id === id));
  const [{ data: members }, { data: msgs }] = await Promise.all([
    sb.rpc("admin_members", { p_group_id: id }),
    sb.rpc("admin_messages", { p_group_id: id }),
  ]);
  $("detailH").innerHTML =
    `<b>${esc(current.name)}</b> ${current.is_dm ? '<span class="tag" style="background:#ff6b9d;color:#fff;padding:1px 6px;border-radius:6px;font-size:10px">DM</span>' : ""}
     <div class="members">Members: ${(members || []).map((m) => esc(m.username)).join(", ") || "—"}</div>`;
  const box = $("mlist");
  if (!msgs || !msgs.length) { box.innerHTML = `<div class="empty">No messages.</div>`; return; }
  box.innerHTML = "";
  msgs.forEach((m) => {
    const el = document.createElement("div");
    el.className = "am";
    el.innerHTML = `<span class="who">${esc(m.username)}</span><span class="txt">${esc(m.content || "")}</span><span class="when">${fmt(m.created_at)}</span>`;
    if (m.media_url) {
      const tag = m.media_type === "video" ? document.createElement("video") : document.createElement("img");
      tag.className = "media"; if (m.media_type === "video") tag.controls = true;
      el.querySelector(".txt").appendChild(tag);
      signedUrl(m.media_url).then((u) => { if (u) tag.src = u; });
    }
    box.appendChild(el);
  });
  box.scrollTop = 0;
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
