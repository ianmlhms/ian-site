/* IanNet uplink viewer — photos / files / guestbook entries the IanNet boards uploaded.
 * Admin-only: ianet_items and the ianet bucket are guarded server-side by is_admin(). */
import * as auth from "./auth.js?v=18";

const BUCKET = "ianet";
const SIGNED_URL_SECONDS = 3600;
const PAGE_SIZE = 300;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (row) => {
  const date = row.created_ms ? new Date(row.created_ms) : new Date(row.received_at);
  return isNaN(date) ? "—" : date.toLocaleString("de-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const sizeLabel = (bytes) => !bytes ? "" : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

let sb = null;
let kind = "photo";

async function signedUrls(paths) {
  if (!paths.length) return new Map();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) {
    console.error("ianet signed urls", error);
    return new Map();
  }
  return new Map(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

async function remove(row) {
  if (!confirm("Läschen?")) return;
  if (row.storage_path) {
    const { error } = await sb.storage.from(BUCKET).remove([row.storage_path]);
    if (error) console.error("ianet remove object", error);
  }
  const { error } = await sb.from("ianet_items").delete().eq("id", row.id);
  if (error) {
    console.error("ianet remove row", error);
    alert("Konnt net geläscht ginn.");
    return;
  }
  load();
}

function deleteButton(row) {
  const button = document.createElement("button");
  button.className = "del";
  button.title = "Läschen";
  button.textContent = "🗑️";
  button.onclick = (event) => { event.preventDefault(); remove(row); };
  return button;
}

async function load() {
  const list = $("list");
  list.innerHTML = `<div class="empty">…</div>`;
  const { data, error } = await sb.from("ianet_items").select("*")
    .eq("kind", kind).not("uploaded_at", "is", null)
    .order("received_at", { ascending: false }).limit(PAGE_SIZE);
  if (error) {
    console.error("ianet load", error);
    list.innerHTML = `<div class="empty">Konnt net gelueden ginn.</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = `<div class="empty">Nach näischt.</div>`;
    return;
  }
  const urls = await signedUrls(data.filter((row) => row.storage_path).map((row) => row.storage_path));
  list.innerHTML = "";
  if (kind === "photo") {
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const row of data) {
      const tile = document.createElement("a");
      tile.className = "ph";
      tile.href = urls.get(row.storage_path) || "#";
      tile.target = "_blank";
      tile.rel = "noopener";
      tile.innerHTML = `<img loading="lazy" alt=""><div class="cap">${esc(row.author || "")} · ${esc(when(row))}</div>`;
      tile.querySelector("img").src = urls.get(row.storage_path) || "";
      tile.append(deleteButton(row));
      grid.append(tile);
    }
    list.append(grid);
    return;
  }
  for (const row of data) {
    const item = document.createElement("div");
    item.className = "row";
    if (kind === "file") {
      item.innerHTML = `<span>📎</span><div class="grow"><a target="_blank" rel="noopener">${esc(row.name)}</a>`
        + `<div class="sub">${esc(row.author || "")} · ${esc(sizeLabel(row.size_bytes))} · ${esc(when(row))} · ${esc(row.board)}</div></div>`;
      item.querySelector("a").href = urls.get(row.storage_path) || "#";
    } else {
      item.innerHTML = `<div class="grow"><strong>${esc(row.author || "")}</strong>`
        + `<span class="sub"> · ${esc(when(row))}</span><p>${esc(row.body)}</p></div>`;
    }
    item.append(deleteButton(row));
    list.append(item);
  }
}

function showDenied() {
  $("panel").hidden = true;
  $("msg").style.display = "flex";
  $("msg").innerHTML = auth.session()
    ? `<div>Net erlaabt.</div>`
    : `<div>Umellen.<br><button class="auth-go" id="go">Umellen</button></div>`;
  const go = $("go");
  if (go) go.onclick = auth.openAuthModal;
}

async function gate() {
  if (!auth.session()) return showDenied();
  let admin = false;
  try {
    const { data } = await sb.rpc("is_admin");
    admin = !!data;
  } catch (error) {
    console.error("ianet is_admin", error);
  }
  if (!admin) return showDenied();
  $("msg").style.display = "none";
  $("panel").hidden = false;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((other) => other.classList.toggle("active", other === tab));
      kind = tab.dataset.kind;
      load();
    };
  });
  load();
}

async function boot() {
  if (!auth.authConfigured) {
    $("msg").textContent = "Not configured.";
    return;
  }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth(() => gate());
  gate();
}
boot();
