/* advent.js — Adventskalenner (ian.lu/advent.html): 24 doors, a Klassement, guest or ian.lu accounts.
 * Backend = Supabase RPCs advent_overview / advent_join / advent_door / advent_check / advent_board (scripts/advent-v1.sql).
 * The shared auth.js client is used for every call (never a second session-managing client).
 * Answers are never in the browser: the client only sends what the player entered. Server strings are rendered with textContent. */
import * as auth from "./auth.js?v=41";
import { createKind } from "./advent-kinds.js?v=1";
import {
  AdventError, DOOR_COUNT, asArray, asObject, clear, creditNode, el, errorText, formatCountdown, formatTime, isValidName,
  parseServerTime, penaltyText, prefersReducedMotion, safeUrl, store, waitText,
} from "./advent-util.js?v=1";

const TOKEN_KEY = "advent_token";
const TICK_MS = 1000;
const REFRESH_COOLDOWN_MS = 5000;
const TOAST_MS = 2600;
const THROTTLE_TICK_MS = 1000;
const PAGE_URL = "advent.html";
/* A fixed shuffle (a permutation of 1..24) so the doors sit like on a real calendar, the same on every load. */
const DOOR_ORDER = [14, 3, 21, 9, 17, 1, 24, 6, 12, 19, 4, 22, 8, 15, 2, 11, 20, 7, 23, 13, 5, 18, 10, 16];
const CONFETTI_COLORS = ["var(--xmas)", "var(--green)", "var(--ink)", "var(--muted)"];
const CONFETTI_COUNT = 28;

const state = {
  sb: null,
  token: null,          // guest token (localStorage)
  overview: null,       // normalised advent_overview
  clockOffsetMs: 0,     // server now - local now
  lastRefreshAt: 0,
  refreshing: null,
  doorDay: null,        // day shown in the door sheet
  doorPushed: false,    // did we push a history entry for ?d=
  sheetOpener: null,
};

const $ = (id) => document.getElementById(id);
const serverNow = () => Date.now() + state.clockOffsetMs;

/* ---------- API ---------- */
async function rpc(name, args = {}) {
  const { data, error } = await state.sb.rpc(name, args);
  if (error) throw new AdventError(error.message || String(error));
  return data;
}
const tokenArg = () => ({ p_token: state.token || null });

function normaliseOverview(raw) {
  const data = asObject(raw);
  const doors = asArray(data.doors).map((d) => ({
    day: Number(d?.day),
    openAtMs: parseServerTime(d?.open_at),
    open: d?.open === true,
    opened: d?.opened === true,
    solved: d?.solved === true,
    timeS: Number.isFinite(Number(d?.time_s)) ? Number(d.time_s) : null,
  })).filter((d) => Number.isInteger(d.day) && d.day >= 1 && d.day <= DOOR_COUNT);
  const me = data.me && typeof data.me === "object" && data.me.name ? { name: String(data.me.name), account: data.me.account === true } : null;
  return { nowMs: parseServerTime(data.now), me, admin: data.admin === true, doors };
}

const doorByDay = (day) => state.overview?.doors.find((d) => d.day === day) || null;

async function loadOverview() {
  const overview = normaliseOverview(await rpc("advent_overview", tokenArg()));
  if (Number.isFinite(overview.nowMs)) state.clockOffsetMs = overview.nowMs - Date.now();
  state.overview = overview;
  state.lastRefreshAt = Date.now();
  return overview;
}

/* Reload the overview; a signed-in ian.lu user with no player yet joins automatically with their username. */
function refresh() {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    try {
      let overview = await loadOverview();
      if (!overview.me && auth.session()) {
        try {
          const joined = await rpc("advent_join", { p_name: null });
          rememberToken(joined);
          overview = await loadOverview();
        } catch (error) {
          console.warn("[advent] auto-join failed", error);
          showJoinError(errorText(error));
        }
      }
      hideMessage();
    } catch (error) {
      console.warn("[advent] overview failed", error);
      showMessage("Konnt de Kalenner net lueden.", true);
    } finally {
      state.refreshing = null;
      renderAll();
    }
  })();
  return state.refreshing;
}

function rememberToken(joined) {
  const token = joined && typeof joined.token === "string" ? joined.token : "";
  if (!token) return;
  state.token = token;
  store.set(TOKEN_KEY, token);
}

/* ---------- toast + messages ---------- */
let toastTimer = 0;
function toast(text) {
  const node = $("advToast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, TOAST_MS);
}

function showMessage(text, withRetry = false) {
  const box = clear($("advMsg"));
  box.hidden = false;
  box.append(el("p", { text }));
  if (withRetry) box.append(el("button", { type: "button", class: "gt-btn ghost", text: "Nach eng Kéier", on: { click: () => { hideMessage(); refresh(); } } }));
}
function hideMessage() { $("advMsg").hidden = true; }

/* ---------- join / restore ---------- */
function showJoinError(text) {
  const node = $("joinErr");
  node.textContent = text;
  node.classList.toggle("err", Boolean(text));
}

async function joinAsGuest(event) {
  event.preventDefault();
  const name = $("joinName").value.trim();
  if (!isValidName(name)) { showJoinError(errorText({ code: "bad name" })); $("joinName").focus(); return; }
  setBusy($("joinBtn"), true);
  showJoinError("");
  try {
    rememberToken(await rpc("advent_join", { p_name: name }));
    await refresh();
    toast(`Moien, ${name}!`);
  } catch (error) {
    console.warn("[advent] join failed", error);
    showJoinError(errorText(error));
  } finally { setBusy($("joinBtn"), false); }
}

async function restoreCode(event) {
  event.preventDefault();
  const code = $("restoreInput").value.trim();
  const note = $("restoreErr");
  note.textContent = "";
  if (!code || /\s/.test(code) || code.length > 200) { note.textContent = "Code net fonnt"; return; }
  const previous = state.token;
  state.token = code;
  store.set(TOKEN_KEY, code);
  try {
    await loadOverview();
    if (state.overview.me) { renderAll(); toast(`Wëllkomm zréck, ${state.overview.me.name}!`); return; }
    throw new Error("unknown code");
  } catch (error) {
    console.warn("[advent] restore failed", error);
    state.token = previous;
    if (previous) store.set(TOKEN_KEY, previous); else store.remove(TOKEN_KEY);
    note.textContent = "Code net fonnt";
  }
}

function setBusy(button, busy) { button.disabled = busy; }

/* ---------- countdown + header ---------- */
const nextLockedDoor = () => state.overview?.doors.filter((d) => !d.open).sort((a, b) => a.day - b.day)[0] || null;

function countdownText() {
  const next = nextLockedDoor();
  if (!next) return "All Dieren sinn op.";
  if (!Number.isFinite(next.openAtMs)) return "";
  return `Dier ${next.day} geet op an ${formatCountdown(next.openAtMs - serverNow())}`;
}

function tick() {
  if (!state.overview) return;
  $("advCountdown").textContent = countdownText();
  const next = nextLockedDoor();
  const due = next && Number.isFinite(next.openAtMs) && serverNow() >= next.openAtMs;
  if (due && Date.now() - state.lastRefreshAt > REFRESH_COOLDOWN_MS) refresh();
}

function renderHeader() {
  const me = state.overview?.me;
  $("advIntro").hidden = Boolean(me);
  $("advMe").hidden = !me;
  if (!me) return;
  const solved = state.overview.doors.filter((d) => d.solved).length;
  $("advName").textContent = me.name;
  $("advAccount").hidden = !me.account;
  $("advSolved").textContent = `${solved}/${DOOR_COUNT}`;
  $("advCountdown").textContent = countdownText();
}

/* ---------- door grid ---------- */
function doorLabel(door, preview) {
  if (door.solved) return `✓ ${door.timeS != null ? formatTime(door.timeS) : ""}`.trim();
  if (door.open) return door.opened ? "Weider" : "Op";
  return preview ? "Preview" : `${door.day}. Dez`;
}

function doorAria(door, preview) {
  if (door.solved) return `Dier ${door.day}, geléist${door.timeS != null ? ` an ${formatTime(door.timeS)}` : ""}`;
  if (door.open) return `Dier ${door.day}, op`;
  return `Dier ${door.day}, zou, geet den ${door.day}. Dezember op${preview ? " (Preview)" : ""}`;
}

function renderGrid() {
  const overview = state.overview;
  const grid = clear($("advGrid"));
  const openDays = overview ? overview.doors.filter((d) => d.open).map((d) => d.day) : [];
  const today = openDays.length ? Math.max(...openDays) : null;
  const doors = DOOR_ORDER.map((day) => overview?.doors.find((d) => d.day === day) || { day, open: false, opened: false, solved: false, timeS: null });
  for (const door of doors) {
    const preview = Boolean(overview?.admin) && !door.open;
    const classes = ["adv-door", door.solved ? "solved" : door.open ? "open" : "locked", door.day === today && !door.solved ? "today" : "", preview ? "preview" : ""].filter(Boolean);
    grid.append(el("li", {}, el("button", {
      type: "button", class: classes.join(" "), data: { day: door.day }, "aria-label": doorAria(door, preview),
      on: { click: () => onDoorTap(door.day) },
    }, el("span", { class: "adv-num", text: String(door.day) }), el("span", { class: "adv-door-state", text: doorLabel(door, preview) }))));
  }
}

function onDoorTap(day) {
  const overview = state.overview;
  if (!overview) return;
  if (!overview.me) {
    toast("Maach fir d'éischt mat.");
    $("joinName").focus();
    return;
  }
  const door = doorByDay(day);
  if (!door || (!door.open && !overview.admin)) { toast(`Geet den ${day}. Dezember op`); return; }
  openDoor(day, { push: true });
}

function renderAll() {
  renderHeader();
  renderGrid();
}

/* ---------- sheets ---------- */
function showSheet(sheet) {
  state.sheetOpener = document.activeElement;
  sheet.hidden = false;
  document.body.classList.add("adv-lock");
  sheet.querySelector("[data-autofocus]")?.focus({ preventScroll: true });
  sheet.scrollTop = 0;
}

function hideSheet(sheet) {
  sheet.hidden = true;
  if ([...document.querySelectorAll(".adv-sheet")].every((s) => s.hidden)) document.body.classList.remove("adv-lock");
  state.sheetOpener?.focus?.({ preventScroll: true });
  state.sheetOpener = null;
}

const topSheet = () => [...document.querySelectorAll(".adv-sheet")].reverse().find((s) => !s.hidden) || null;

/* ---------- door view ---------- */
function doorUrl(day) { return `${PAGE_URL}?d=${day}`; }

function closeDoor() {
  if (state.doorDay == null) return;
  clearInterval(throttleTimer);
  if (state.doorPushed) { state.doorPushed = false; history.back(); return; }
  hideDoorSheet();
  history.replaceState({}, "", PAGE_URL);
}

function hideDoorSheet() {
  state.doorDay = null;
  hideSheet($("advDoor"));
}

async function openDoor(day, { push }) {
  const sheet = $("advDoor");
  state.doorDay = day;
  if (push) { history.pushState({ d: day }, "", doorUrl(day)); state.doorPushed = true; }
  setDoorBody(sheet, day, el("p", { class: "adv-small", text: "Lueden…" }));
  showSheet(sheet);
  try {
    renderDoor(day, await rpc("advent_door", { ...tokenArg(), p_day: day }));
  } catch (error) {
    console.warn("[advent] door failed", error);
    setDoorBody(sheet, day, el("p", { class: "adv-error", text: errorText(error) }));
  }
}

function setDoorBody(sheet, day, ...content) {
  clear(sheet);
  sheet.append(el("div", { class: "adv-sheet-inner" },
    el("div", { class: "adv-sheet-top" },
      el("button", { type: "button", class: "gt-back adv-back", text: "‹ Kalenner", "data-autofocus": "", on: { click: closeDoor } }),
      el("span", { class: "adv-sheet-day", text: `Dier ${day}` })),
    ...content));
}

function imageFigure(image) {
  const url = safeUrl(image?.url);
  if (!url) return null;
  return el("figure", { class: "adv-figure" }, el("img", { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }), creditNode(image));
}

function hintBlock(hint) {
  const text = String(hint || "").trim();
  if (!text) return null;
  const body = el("p", { class: "adv-hint", text, hidden: true });
  const button = el("button", { type: "button", class: "gt-btn ghost adv-hint-btn", text: "Tipp",
    on: { click: () => { body.hidden = !body.hidden; button.setAttribute("aria-expanded", String(!body.hidden)); } }, "aria-expanded": "false" });
  return el("div", { class: "adv-hint-wrap" }, button, body);
}

function renderDoor(day, data) {
  const door = asObject(data);
  const content = asObject(door.content);
  const kind = String(door.kind || content.kind || "text");
  const head = [
    door.preview ? el("span", { class: "adv-preview", text: "Preview" }) : null,
    el("h2", { class: "adv-title", text: String(content.title || `Dier ${day}`) }),
    content.intro ? el("p", { class: "adv-text", text: String(content.intro) }) : null,
  ];
  if (door.solved) {
    setDoorBody($("advDoor"), day, ...head, content.question ? el("p", { class: "adv-question", text: String(content.question) }) : null,
      solvedBlock({ timeS: door.time_s, reveal: door.reveal, celebrate: false }));
    return;
  }
  const form = buildAnswerForm(day, kind, content, door.preview === true);
  setDoorBody($("advDoor"), day, ...head,
    kind === "slider" ? null : imageFigure(content.image),
    content.question ? el("p", { class: "adv-question", text: String(content.question) }) : null,
    hintBlock(content.hint), form);
}

let throttleTimer = 0;

function buildAnswerForm(day, kind, content, preview) {
  const submit = el("button", { type: "button", class: "gt-btn adv-submit", text: "Ofginn", disabled: true });
  const feedback = el("p", { class: "adv-feedback", role: "status", "aria-live": "polite" });
  const area = el("div", { class: "adv-answer" });
  let busy = false;
  let waitingUntil = 0;
  let control = null;

  const ready = () => !busy && Date.now() >= waitingUntil && Boolean(control?.isReady());
  const sync = () => { submit.disabled = !ready(); };
  const say = (text, tone = "") => { feedback.textContent = text; feedback.className = `adv-feedback ${tone}`.trim(); };

  function startThrottle(seconds) {
    waitingUntil = Date.now() + seconds * 1000;
    clearInterval(throttleTimer);
    const update = () => {
      const left = Math.ceil((waitingUntil - Date.now()) / 1000);
      if (left <= 0) { clearInterval(throttleTimer); say(""); } else say(waitText(left), "err");
      sync();
    };
    update();
    throttleTimer = setInterval(update, THROTTLE_TICK_MS);
  }

  function shake() {
    if (prefersReducedMotion()) return;
    area.classList.remove("shake");
    void area.offsetWidth;
    area.classList.add("shake");
  }

  async function handleResult(result) {
    const res = asObject(result);
    if (res.wait_s != null && !res.correct) { startThrottle(Number(res.wait_s)); return; }
    if (res.correct && res.already) { await reloadSolved(day); return; }
    if (res.correct && res.preview) { say("Richteg! (Preview: näischt gespäichert)"); return; }
    if (res.correct) { showSolved(day, res); return; }
    if (res.preview) { say("Falsch (Preview).", "err"); shake(); return; }
    say(`Leider falsch – ${penaltyText(res.penalty_s)}`, "err");
    shake();
  }

  async function send() {
    if (!ready()) return;
    busy = true; sync();
    say("");
    try {
      await handleResult(await rpc("advent_check", { ...tokenArg(), p_day: day, p_given: control.getGiven() }));
    } catch (error) {
      console.warn("[advent] check failed", error);
      say(errorText(error), "err");
    } finally { busy = false; sync(); }
  }

  control = createKind(kind, content, { day, changed: sync, submit: send });
  submit.addEventListener("click", send);
  if (control.submitLabel) submit.textContent = control.submitLabel;
  area.append(control.node);
  sync();
  return el("div", { class: "adv-form" }, area, el("div", { class: "adv-submit-row" }, submit), feedback);
}

async function reloadSolved(day) {
  try { renderDoor(day, await rpc("advent_door", { ...tokenArg(), p_day: day })); } catch (error) {
    console.warn("[advent] reload failed", error);
    toast(errorText(error));
  }
  refresh();
}

/* Solved view: shared by "just solved" (celebrate) and "opened again" (read-only). */
function solvedBlock({ timeS, reveal, celebrate }) {
  const block = el("section", { class: "adv-solved", role: "status" },
    el("p", { class: "adv-solved-title", text: celebrate ? "Richteg! 🎉" : "✓ Geléist" }),
    timeS != null ? el("p", { class: "adv-solved-time" }, "Zäit: ", el("b", { text: formatTime(timeS) })) : null,
    reveal ? el("p", { class: "adv-text adv-reveal", text: String(reveal) }) : null,
    el("button", { type: "button", class: "gt-btn", text: "Zréck bei de Kalenner", on: { click: closeDoor } }));
  if (celebrate) confetti(block);
  return block;
}

function showSolved(day, res) {
  const sheet = $("advDoor");
  const form = sheet.querySelector(".adv-form");
  clearInterval(throttleTimer);
  const block = solvedBlock({ timeS: res.time_s, reveal: res.reveal, celebrate: true });
  if (form) form.replaceWith(block); else sheet.querySelector(".adv-sheet-inner")?.append(block);
  block.scrollIntoView?.({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  refresh();
}

function confetti(host) {
  if (prefersReducedMotion()) return;
  const layer = el("div", { class: "adv-confetti", "aria-hidden": "true" });
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    layer.append(el("span", { style: `--x:${Math.round(Math.random() * 100)}%;--d:${(Math.random() * 0.5).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--c:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}` }));
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 2600);
}

/* ---------- Klassement ---------- */
const boardState = { tab: "overall", day: null, data: null };

function openBoard() {
  const sheet = $("advBoard");
  boardState.tab = "overall";
  drawBoardShell();
  showSheet(sheet);
  loadBoard();
}

async function loadBoard() {
  const body = $("boardBody");
  body.replaceChildren(el("p", { class: "adv-small", text: "Lueden…" }));
  try {
    boardState.data = asObject(await rpc("advent_board"));
    drawBoardBody();
  } catch (error) {
    console.warn("[advent] board failed", error);
    body.replaceChildren(el("p", { class: "adv-error", text: "Klassement konnt net gelueden ginn." }));
  }
}

function openDays() {
  return (state.overview?.doors || []).filter((d) => d.open).map((d) => d.day).sort((a, b) => a - b);
}

function drawBoardShell() {
  const sheet = clear($("advBoard"));
  const tab = (id, label) => el("button", { type: "button", class: `adv-tab${boardState.tab === id ? " on" : ""}`, text: label, "aria-pressed": String(boardState.tab === id),
    on: { click: () => { boardState.tab = id; drawBoardShell(); drawBoardBody(); } } });
  sheet.append(el("div", { class: "adv-sheet-inner" },
    el("div", { class: "adv-sheet-top" },
      el("button", { type: "button", class: "gt-back adv-back", text: "‹ Zou", "data-autofocus": "", on: { click: () => hideSheet($("advBoard")) } }),
      el("span", { class: "adv-sheet-day", text: "Klassement" })),
    el("div", { class: "adv-tabs", role: "group", "aria-label": "Klassement" }, tab("overall", "Meeschte Dieren"), tab("days", "Séierst pro Dag")),
    el("div", { id: "boardBody", "aria-live": "polite" })));
}

const isMe = (row) => Boolean(state.overview?.me) && String(row?.name || "").toLowerCase() === state.overview.me.name.toLowerCase();

function nameCell(row) {
  return el("td", { class: "adv-name-cell" }, String(row?.name ?? ""), row?.account ? el("span", { class: "adv-badge", text: "ian.lu" }) : null);
}

function boardTable(headers, rows) {
  return el("div", { class: "gt-scroll" }, el("table", { class: "gt-table adv-table" },
    el("thead", {}, el("tr", {}, headers.map(([label, cls]) => el("th", { scope: "col", class: cls || "", text: label })))),
    el("tbody", {}, rows)));
}

function drawBoardBody() {
  const body = $("boardBody");
  if (!body || !boardState.data) return;
  body.replaceChildren(boardState.tab === "overall" ? overallTable() : daysView());
}

function overallTable() {
  const rows = asArray(boardState.data.overall);
  if (!rows.length) return el("p", { class: "adv-small", text: "Nach keen huet eng Dier geléist." });
  return boardTable([["#", "num"], ["Spiller"], ["Dieren", "num"], ["Zäit", "num"]], rows.map((row, i) =>
    el("tr", { class: isMe(row) ? "me" : "" }, el("td", { class: "num", text: String(i + 1) }), nameCell(row),
      el("td", { class: "num", text: String(row.doors ?? 0) }), el("td", { class: "num", text: formatTime(row.total_s) }))));
}

function daysView() {
  const days = openDays();
  if (!days.length) return el("p", { class: "adv-small", text: "Nach keng Dier ass op." });
  if (!days.includes(boardState.day)) boardState.day = days[days.length - 1];
  const picker = el("div", { class: "adv-days", role: "group", "aria-label": "Dag wielen" }, days.map((day) => el("button", {
    type: "button", class: `adv-daybtn${day === boardState.day ? " on" : ""}`, text: String(day), "aria-pressed": String(day === boardState.day),
    on: { click: () => { boardState.day = day; drawBoardBody(); } },
  })));
  const rows = asArray(asObject(boardState.data.days)[String(boardState.day)]);
  const table = rows.length
    ? boardTable([["#", "num"], ["Spiller"], ["Zäit", "num"]], rows.map((row, i) =>
      el("tr", { class: isMe(row) ? "me" : "" }, el("td", { class: "num", text: String(i + 1) }), nameCell(row), el("td", { class: "num", text: formatTime(row.time_s) }))))
    : el("p", { class: "adv-small", text: "Fir dës Dier ass nach keen am Klassement." });
  return el("div", {}, picker, table);
}

/* ---------- menu: code + share ---------- */
function openMenu() {
  const sheet = clear($("advMenu"));
  const me = state.overview?.me;
  const guestCode = me && !me.account ? state.token : null;
  const codeInput = guestCode ? el("input", { class: "gt-input adv-code", type: "text", readonly: "", value: guestCode, "aria-label": "Däin Code", on: { focus: (e) => e.target.select() } }) : null;
  sheet.append(el("div", { class: "adv-sheet-inner" },
    el("div", { class: "adv-sheet-top" },
      el("button", { type: "button", class: "gt-back adv-back", text: "‹ Zou", "data-autofocus": "", on: { click: () => hideSheet($("advMenu")) } }),
      el("span", { class: "adv-sheet-day", text: "Menü" })),
    me ? el("p", { class: "adv-text", text: me.account ? `Du spills als ${me.name} mat dengem ian.lu-Kont.` : `Du spills als ${me.name}.` }) : null,
    guestCode ? el("section", { class: "adv-menu-block" },
      el("h2", { class: "adv-h", text: "Däin Code" }),
      el("p", { class: "adv-text", text: "Mat dësem Code spills du op engem aneren Apparat weider. Gëff en kengem." }),
      el("div", { class: "gt-field" }, codeInput, el("button", { type: "button", class: "gt-btn", text: "Kopéieren", on: { click: () => copyText(guestCode, "Code kopéiert", codeInput) } }))) : null,
    el("section", { class: "adv-menu-block" },
      el("h2", { class: "adv-h", text: "Invitéier Frënn" }),
      el("button", { type: "button", class: "gt-btn", text: "Invitéier Frënn", on: { click: shareCalendar } }))));
  showSheet(sheet);
}

async function copyText(text, doneMessage, fallbackInput) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch (error) {
    console.warn("[advent] clipboard unavailable", error);
    fallbackInput?.select();
    toast("Mark den Text a kopéier en.");
  }
}

async function shareCalendar() {
  const url = new URL(PAGE_URL, location.href).href;
  const data = { title: "Adventskalenner", text: "Maach mat bei mengem Adventskalenner op ian.lu!", url };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("[advent] share failed", error);
    }
  }
  await copyText(url, "Link kopéiert");
}

/* ---------- routing (?d=7) ---------- */
function dayFromUrl() {
  const day = Number(new URLSearchParams(location.search).get("d"));
  return Number.isInteger(day) && day >= 1 && day <= DOOR_COUNT ? day : null;
}

function routeFromUrl() {
  const day = dayFromUrl();
  if (day == null) { if (state.doorDay != null) hideDoorSheet(); return; }
  const door = doorByDay(day);
  const allowed = state.overview?.me && door && (door.open || state.overview.admin);
  if (!allowed) { history.replaceState({}, "", PAGE_URL); return; }
  if (state.doorDay !== day) openDoor(day, { push: false });
}

/* ---------- boot ---------- */
function bindStatic() {
  $("joinForm").addEventListener("submit", joinAsGuest);
  $("restoreForm").addEventListener("submit", restoreCode);
  $("restoreToggle").addEventListener("click", () => {
    const box = $("restoreBox");
    box.hidden = !box.hidden;
    $("restoreToggle").setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) $("restoreInput").focus();
  });
  $("signInBtn").addEventListener("click", () => auth.openAuthModal());
  $("advBoardBtn").addEventListener("click", openBoard);
  $("advMenuBtn").addEventListener("click", openMenu);
  window.addEventListener("popstate", () => { state.doorPushed = false; routeFromUrl(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const sheet = topSheet();
    if (!sheet) return;
    if (sheet.id === "advDoor") closeDoor(); else hideSheet(sheet);
  });
  setInterval(tick, TICK_MS);
}

async function boot() {
  state.token = store.get(TOKEN_KEY);
  bindStatic();
  renderGrid();
  if (!auth.authConfigured) { showMessage("De Kalenner ass grad net erreechbar.", true); return; }
  try {
    state.sb = await auth.client();
  } catch (error) {
    console.warn("[advent] client failed", error);
    showMessage("Konnt net mat dem Server verbannen.", true);
    return;
  }
  auth.onAuth(() => { refresh(); });
  await refresh();
  routeFromUrl();
}

boot();
