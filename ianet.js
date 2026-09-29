/* IanNet uplink viewer — photos / files / guestbook entries the IanNet boards uploaded.
 * Admin-only: ianet_items and the ianet bucket are guarded server-side by is_admin(). */
import * as auth from "./auth.js?v=18";

const BUCKET = "ianet";
const SIGNED_URL_SECONDS = 3600;
const PAGE_SIZE = 300;
const CHAT_REFRESH_MS = 5000;
const BOARD_REFRESH_MS = 15000;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;  // boards report status about every minute
const MAX_FIRMWARE_BYTES = 6 * 1024 * 1024;  // one OTA slot
const MAX_CHAT_CHARS = 300;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (row) => {
  const date = row.created_ms ? new Date(row.created_ms) : new Date(row.received_at);
  return isNaN(date) ? "—" : date.toLocaleString("de-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const sizeLabel = (bytes) => !bytes ? "" : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

let sb = null;
let kind = "photo";
let refreshTimer = null;
let boards = [];

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
  // Also remove it on the board itself, so it disappears from IanNet at school.
  const { error: commandError } = await sb.from("ianet_commands").insert({
    board: row.board, kind: "delete", payload: { item_kind: row.kind, item_id: row.id },
  });
  if (commandError) console.error("ianet delete command", commandError);
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
  clearInterval(refreshTimer);
  refreshTimer = null;
  if (kind === "board") return loadBoards();
  if (kind === "chat") {
    refreshTimer = setInterval(loadItems, CHAT_REFRESH_MS);
  }
  return loadItems();
}

async function loadItems() {
  const list = $("list");
  if (!list.childElementCount) list.innerHTML = `<div class="empty">…</div>`;
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
  if (kind === "chat") return renderChat(list, data);
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

async function loadBoardNames() {
  const { data, error } = await sb.from("ianet_status").select("board, seen_at").order("board");
  if (error) console.error("ianet boards", error);
  boards = data ?? [];
  return boards;
}

function sendBox(onSend) {
  const box = document.createElement("form");
  box.className = "send";
  box.innerHTML = `<select class="btn ghost" aria-label="Board"></select><input maxlength="${MAX_CHAT_CHARS}" placeholder="Schreif eppes…"><button class="btn">Schécken</button>`;
  const select = box.querySelector("select");
  for (const board of boards) select.append(new Option(board.board, board.board));
  if (!boards.length) select.append(new Option("ianet1", "ianet1"));
  box.onsubmit = async (event) => {
    event.preventDefault();
    const input = box.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const ok = await onSend(select.value, text);
    input.disabled = false;
    if (ok) input.value = "";
    input.focus();
  };
  return box;
}

async function renderChat(list, data) {
  if (!boards.length) await loadBoardNames();
  const keepDraft = list.querySelector(".send input")?.value ?? "";
  list.innerHTML = "";
  const box = sendBox(async (board, text) => {
    const { error } = await sb.from("ianet_commands").insert({ board, kind: "chat", payload: { name: "Ian", text } });
    if (error) {
      console.error("ianet chat send", error);
      alert("Konnt net geschéckt ginn.");
      return false;
    }
    return true;
  });
  box.querySelector("input").value = keepDraft;
  list.append(box);
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = "Kënnt op IanNet un, soubal d'Board sech mellt (e puer Sekonnen).";
  list.append(note);
  for (const row of data) {
    const item = document.createElement("div");
    item.className = "row";
    item.innerHTML = `<div class="grow"><strong>${esc(row.author || "")}</strong>`
      + `<span class="sub"> · ${esc(when(row))} · ${esc(row.board)}</span><p>${esc(row.body)}</p></div>`;
    item.append(deleteButton(row));
    list.append(item);
  }
}

async function hexSha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendCommand(board, commandKind, payload, button) {
  button.disabled = true;
  const { error } = await sb.from("ianet_commands").insert({ board, kind: commandKind, payload });
  button.disabled = false;
  if (error) {
    console.error("ianet command", commandKind, error);
    alert("Konnt net geschéckt ginn.");
    return;
  }
  loadBoards();
}

async function uploadFirmware(board, file, button) {
  if (!file.name.endsWith(".bin") || file.size <= 0 || file.size > MAX_FIRMWARE_BYTES) {
    alert("firmware.bin (max. 6 MB)");
    return;
  }
  button.disabled = true;
  try {
    const buffer = await file.arrayBuffer();
    if (new Uint8Array(buffer)[0] !== 0xE9) throw new Error("not an ESP32 image");
    const sha256 = await hexSha256(buffer);
    const path = `firmware/${Date.now()}-${sha256.slice(0, 12)}.bin`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: "application/octet-stream" });
    if (error) throw error;
    await sendCommand(board, "firmware", { path, sha256, size: file.size }, button);
  } catch (error) {
    console.error("ianet firmware", error);
    alert(`Update: ${error.message || error}`);
  } finally {
    button.disabled = false;
  }
}

async function loadBoards() {
  const list = $("list");
  refreshTimer = setInterval(loadBoards, BOARD_REFRESH_MS);
  const [{ data: status, error }, { data: commands }] = await Promise.all([
    sb.from("ianet_status").select("*").order("board"),
    sb.from("ianet_commands").select("id, board, kind, created_at, delivered_at, done_at, result")
      .order("id", { ascending: false }).limit(20),
  ]);
  if (error) {
    console.error("ianet status", error);
    list.innerHTML = `<div class="empty">Konnt net gelueden ginn.</div>`;
    return;
  }
  boards = status ?? [];
  list.innerHTML = "";
  if (!boards.length) {
    list.innerHTML = `<div class="empty">Nach keen Board gemellt.</div>`;
    return;
  }
  for (const board of boards) {
    const online = Date.now() - new Date(board.seen_at).getTime() < ONLINE_WINDOW_MS;
    const card = document.createElement("div");
    card.className = "row";
    card.style.display = "block";
    card.innerHTML = `<strong>${online ? "🟢" : "⚪️"} ${esc(board.board)}</strong>
      <div class="kv">
        <span>Gesinn</span><span>${esc(new Date(board.seen_at).toLocaleString("de-LU"))}</span>
        <span>Version</span><span>${esc(board.version || "—")}</span>
        <span>Online</span><span>${esc(board.online ?? "—")}</span>
        <span>WLAN</span><span>${board.rssi != null ? esc(board.rssi) + " dBm" : "—"}</span>
        <span>SD fräi</span><span>${board.sd_free_mb != null ? esc(board.sd_free_mb) + " MB" : "—"}</span>
        <span>Waart op Upload</span><span>${esc(board.pending ?? "—")}</span>
        ${board.last_error ? `<span>Feeler</span><span>${esc(board.last_error)}</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="restart">🔄 Neistart</button>
        <label class="btn ghost">⬆️ Firmware<input type="file" accept=".bin" hidden></label>
      </div>`;
    const restart = card.querySelector('[data-act="restart"]');
    restart.onclick = () => confirm(`${board.board} nei starten?`) && sendCommand(board.board, "restart", {}, restart);
    const picker = card.querySelector('input[type="file"]');
    picker.onchange = () => picker.files[0] && uploadFirmware(board.board, picker.files[0], picker.parentElement);
    list.append(card);
  }
  if (commands?.length) {
    const log = document.createElement("div");
    log.className = "note";
    log.innerHTML = commands.map((command) => {
      const state = command.done_at ? `✓ ${esc(command.result || "")}` : command.delivered_at ? "…" : "⏳";
      return `${esc(command.board)} · ${esc(command.kind)} · ${state}`;
    }).join("<br>");
    list.append(log);
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
