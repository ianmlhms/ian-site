/* IanNet uplink viewer — photos / files / guestbook entries the IanNet boards uploaded.
 * Admin-only: ianet_items and the ianet bucket are guarded server-side by is_admin(). */
import * as auth from "./auth.js?v=27";

const BUCKET = "ianet";
const SIGNED_URL_SECONDS = 3600;
const PAGE_SIZE = 300;
const CHAT_REFRESH_MS = 5000;
const BOARD_REFRESH_MS = 15000;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;  // boards report status about every minute
const MAX_FIRMWARE_BYTES = 6 * 1024 * 1024;  // one OTA slot
const MAX_CHAT_CHARS = 300;

const $ = (id) => document.getElementById(id);
const T = (key) => (window.I18N ? window.I18N.t(key) : key);
const LOCALES = { lb: "de-LU", de: "de-LU", en: "en-GB" };
const locale = () => LOCALES[window.I18N?.lang] || "de-LU";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (row) => {
  const date = row.created_ms ? new Date(row.created_ms) : new Date(row.received_at);
  return isNaN(date) ? "—" : date.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const sizeLabel = (bytes) => !bytes ? "" : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

let sb = null;
let kind = "photo";
let refreshTimer = null;
let boards = [];
let chatDraft = "";
let renderMsg = null;

const setBusy = (el, busy) => {
  if ("disabled" in el) el.disabled = busy;
  else {
    el.classList.toggle("busy", busy);
    const input = el.querySelector("input");
    if (input) input.disabled = busy;
  }
};

const applyStaticText = () => {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T(el.dataset.t); });
};

const stateCard = (icon, text, slim = true) =>
  `<div class="ui-card state${slim ? " slim" : ""}"><div class="gate-ico" aria-hidden="true">${icon}</div><p>${esc(text)}</p></div>`;
const initial = (name) => [...String(name || "?").trim()][0]?.toUpperCase() || "?";

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
  if (!confirm(T("ianet.delConfirm"))) return;
  if (row.storage_path) {
    const { error } = await sb.storage.from(BUCKET).remove([row.storage_path]);
    if (error) console.error("ianet remove object", error);
  }
  const { error } = await sb.from("ianet_items").delete().eq("id", row.id);
  if (error) {
    console.error("ianet remove row", error);
    alert(T("ianet.delFail"));
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
  button.type = "button";
  button.title = T("ianet.del");
  button.setAttribute("aria-label", T("ianet.del"));
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
  const requested = kind;
  if (!list.childElementCount) list.innerHTML = stateCard("⏳", "…");
  const { data, error } = await sb.from("ianet_items").select("*")
    .eq("kind", requested).not("uploaded_at", "is", null)
    .order("received_at", { ascending: false }).limit(PAGE_SIZE);
  if (requested !== kind) return;
  if (error) {
    console.error("ianet load", error);
    list.innerHTML = stateCard("⚠️", T("ianet.loadErr"));
    return;
  }
  if (requested === "chat") return renderChat(list, data);
  if (!data.length) {
    list.innerHTML = stateCard("🫥", T("ianet.nothing"));
    return;
  }
  const urls = await signedUrls(data.filter((row) => row.storage_path).map((row) => row.storage_path));
  if (requested !== kind) return;
  list.innerHTML = "";
  if (requested === "photo") {
    const grid = document.createElement("div");
    grid.className = "photos";
    for (const row of data) {
      const url = urls.get(row.storage_path) || "";
      const caption = `${row.author || ""} · ${when(row)}`;
      const tile = document.createElement("div");
      tile.className = "ph";
      tile.innerHTML = `<a target="_blank" rel="noopener"><img loading="lazy"></a><div class="cap">${esc(caption)}</div>`;
      tile.querySelector("a").href = url || "#";
      const img = tile.querySelector("img");
      img.alt = caption;
      img.src = url;
      tile.append(deleteButton(row));
      grid.append(tile);
    }
    list.append(grid);
    return;
  }
  const items = document.createElement("div");
  items.className = "items";
  for (const row of data) {
    const item = document.createElement("div");
    item.className = "item";
    if (requested === "file") {
      item.innerHTML = `<span class="ic emoji" aria-hidden="true">📎</span><div class="grow"><a class="t" target="_blank" rel="noopener">${esc(row.name)}</a>`
        + `<div class="sub">${esc(row.author || "")} · ${esc(sizeLabel(row.size_bytes))} · ${esc(when(row))} · ${esc(row.board)}</div></div>`;
      item.querySelector("a").href = urls.get(row.storage_path) || "#";
    } else {
      item.innerHTML = messageHtml(row, false);
    }
    item.append(deleteButton(row));
    items.append(item);
  }
  list.append(items);
}

function messageHtml(row, withBoard) {
  return `<span class="ic" aria-hidden="true">${esc(initial(row.author))}</span><div class="grow"><div class="t">${esc(row.author || "")}</div>`
    + `<div class="sub">${esc(when(row))}${withBoard ? ` · ${esc(row.board)}` : ""}</div><p>${esc(row.body)}</p></div>`;
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
  box.innerHTML = `<select class="ui-input" aria-label="Board"></select><input class="ui-input" maxlength="${MAX_CHAT_CHARS}" autocomplete="off" enterkeyhint="send"><button class="ui-btn ui-btn--primary"></button>`;
  const select = box.querySelector("select");
  const input = box.querySelector("input");
  input.placeholder = T("ianet.chatPlaceholder");
  input.setAttribute("aria-label", T("ianet.chatPlaceholder").replace(/…$/, ""));
  box.querySelector("button").textContent = T("ianet.send");
  input.value = chatDraft;
  input.oninput = () => { chatDraft = input.value; };
  for (const board of boards) select.append(new Option(board.board, board.board));
  if (!boards.length) select.append(new Option("ianet1", "ianet1"));
  box.onsubmit = async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    const ok = await onSend(select.value, text);
    input.disabled = false;
    if (ok) {
      input.value = "";
      chatDraft = "";
    }
    input.focus();
  };
  return box;
}

async function renderChat(list, data) {
  if (!boards.length) await loadBoardNames();
  if (kind !== "chat") return;
  let items = list.querySelector(":scope > .items");
  if (!list.querySelector(":scope > form.send") || !items) {
    list.innerHTML = "";
    list.append(sendBox(async (board, text) => {
      const { error } = await sb.from("ianet_commands").insert({ board, kind: "chat", payload: { name: "Ian", text } });
      if (error) {
        console.error("ianet chat send", error);
        alert(T("ianet.sendFail"));
        return false;
      }
      return true;
    }));
    const note = document.createElement("div");
    note.className = "chat-note";
    note.textContent = T("ianet.chatNote");
    list.append(note);
    items = document.createElement("div");
    items.className = "items";
    list.append(items);
  }
  const rows = data.map((row) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = messageHtml(row, true);
    item.append(deleteButton(row));
    return item;
  });
  if (!rows.length) items.innerHTML = stateCard("💬", T("ianet.nothing"));
  else items.replaceChildren(...rows);
}

async function hexSha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendCommand(board, commandKind, payload, button) {
  setBusy(button, true);
  const { error } = await sb.from("ianet_commands").insert({ board, kind: commandKind, payload });
  setBusy(button, false);
  if (error) {
    console.error("ianet command", commandKind, error);
    alert(T("ianet.sendFail"));
    return;
  }
  loadBoards();
}

async function uploadFirmware(board, file, button) {
  if (!file.name.endsWith(".bin") || file.size <= 0 || file.size > MAX_FIRMWARE_BYTES) {
    alert(T("ianet.firmwareBad"));
    return;
  }
  setBusy(button, true);
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
    setBusy(button, false);
  }
}

async function loadBoards() {
  const list = $("list");
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadBoards, BOARD_REFRESH_MS);
  const [{ data: status, error }, { data: commands }] = await Promise.all([
    sb.from("ianet_status").select("*").order("board"),
    sb.from("ianet_commands").select("id, board, kind, created_at, delivered_at, done_at, result")
      .order("id", { ascending: false }).limit(20),
  ]);
  if (kind !== "board") return;
  if (error) {
    console.error("ianet status", error);
    list.innerHTML = stateCard("⚠️", T("ianet.loadErr"));
    return;
  }
  boards = status ?? [];
  list.innerHTML = "";
  if (!boards.length) {
    list.innerHTML = stateCard("📡", T("ianet.noBoards"));
    return;
  }
  const grid = document.createElement("div");
  grid.className = "boards";
  list.append(grid);
  const cell = (label, value, extra = "") => `<div${extra ? ` class="${extra}"` : ""}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  for (const board of boards) {
    const online = Date.now() - new Date(board.seen_at).getTime() < ONLINE_WINDOW_MS;
    const card = document.createElement("article");
    card.className = "board";
    card.innerHTML = `<div class="head"><h2>${esc(board.board)}</h2><span class="status${online ? " on" : ""}">${esc(T(online ? "ianet.online" : "ianet.offline"))}</span></div>
      <dl class="kv">
        ${cell(T("ianet.kvSeen"), new Date(board.seen_at).toLocaleString(locale()), "wide")}
        ${cell(T("ianet.kvVersion"), board.version || "—")}
        ${cell(T("ianet.kvOnline"), board.online ?? "—")}
        ${cell(T("ianet.kvWifi"), board.rssi != null ? board.rssi + " dBm" : "—")}
        ${cell(T("ianet.kvSd"), board.sd_free_mb != null ? board.sd_free_mb + " MB" : "—")}
        ${cell(T("ianet.kvPending"), board.pending ?? "—", "wide")}
        ${board.last_error ? cell(T("ianet.kvError"), board.last_error, "wide err") : ""}
      </dl>
      <div class="actions">
        <button class="ui-btn ui-btn--ghost" type="button" data-act="restart"><span aria-hidden="true">🔄</span> ${esc(T("ianet.restart"))}</button>
        <label class="ui-btn ui-btn--ghost"><span aria-hidden="true">⬆️</span> ${esc(T("ianet.firmware"))}<input type="file" accept=".bin" class="sr-only"></label>
      </div>`;
    const restart = card.querySelector('[data-act="restart"]');
    restart.onclick = () => confirm(T("ianet.restartConfirm").replace("{b}", board.board)) && sendCommand(board.board, "restart", {}, restart);
    const picker = card.querySelector('input[type="file"]');
    picker.onchange = () => picker.files[0] && uploadFirmware(board.board, picker.files[0], picker.parentElement);
    grid.append(card);
  }
  if (commands?.length) {
    const log = document.createElement("section");
    log.className = "ui-card cmdlog";
    const lines = commands.map((command) => {
      const state = command.done_at ? `✓ ${esc(command.result || "")}` : command.delivered_at ? "…" : "⏳";
      return `<li><b>${esc(command.board)}</b> · ${esc(command.kind)} · ${state}</li>`;
    }).join("");
    log.innerHTML = `<h2>${esc(T("ianet.cmdLog"))}</h2><ul>${lines}</ul>`;
    list.append(log);
  }
}

function showMsg(render) {
  renderMsg = render;
  $("panel").hidden = true;
  $("msg").hidden = false;
  render();
}

function showDenied() {
  showMsg(() => {
    const signedIn = !!auth.session();
    $("msg").innerHTML = signedIn
      ? `<div class="gate-ico" aria-hidden="true">🔒</div><p>${esc(T("ianet.denied"))}</p>`
      : `<div class="gate-ico" aria-hidden="true">📡</div><p>${esc(T("ianet.signInMsg"))}</p><button class="ui-btn ui-btn--primary" type="button" id="go">${esc(T("ianet.signIn"))}</button>`;
    const go = $("go");
    if (go) go.onclick = auth.openAuthModal;
  });
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
  renderMsg = null;
  $("msg").hidden = true;
  $("panel").hidden = false;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((other) => {
        other.classList.toggle("active", other === tab);
        other.setAttribute("aria-pressed", String(other === tab));
      });
      kind = tab.dataset.kind;
      $("list").textContent = "";
      load();
    };
  });
  load();
}

async function boot() {
  applyStaticText();
  document.addEventListener("i18n:change", () => {
    applyStaticText();
    if (renderMsg) renderMsg();
    else if (!$("panel").hidden) {
      $("list").textContent = "";
      load();
    }
  });
  if (!auth.authConfigured) {
    showMsg(() => { $("msg").innerHTML = `<div class="gate-ico" aria-hidden="true">📡</div><p>${esc(T("ianet.notConfigured"))}</p>`; });
    return;
  }
  auth.mountAccountButton($("acctHost"));
  sb = await auth.client();
  auth.onAuth(() => gate());
  gate();
}
boot();
