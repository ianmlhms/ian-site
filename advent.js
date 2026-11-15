/* advent.js — Adventskalenner (ian.lu/advent.html): 24 doors, one small gift in an Arcade game behind each.
 * Backend = Supabase RPCs advent_gifts_overview / advent_gift_open (scripts/advent-gifts-v1.sql).
 * The shared auth.js client is used for every call (never a second session-managing client).
 * Gift sizes are decided on the server; server strings are rendered with textContent only. */
import * as auth from "./auth.js?v=41";
import {
  AdventError, DOOR_COUNT, clear, el, errorText, formatAmount, formatCountdown, gameInfo, gameUrl, parseServerTime,
  prefersReducedMotion, store,
} from "./advent-util.js?v=2";

const LEGACY_TOKEN_KEY = "advent_token";   // the puzzle version's guest token; no longer used
const TICK_MS = 1000;
const REFRESH_COOLDOWN_MS = 5000;
const KLEESCHEN_DAY = 6;
const CHRISTMAS_EVE = 24;
/* A fixed shuffle (a permutation of 1..24) so the doors sit like on a real calendar, the same on every load. */
const DOOR_ORDER = [14, 3, 21, 9, 17, 1, 24, 6, 12, 19, 4, 22, 8, 15, 2, 11, 20, 7, 23, 13, 5, 18, 10, 16];

const state = {
  sb: null,
  overview: null,        // normalised advent_gifts_overview
  clockOffsetMs: 0,      // server now - local now
  lastRefreshAt: 0,
  refreshing: null,
  opening: false,        // an advent_gift_open call is running
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

const normaliseGifts = (raw) => (Array.isArray(raw) ? raw : [])
  .map((g) => ({ game: String(g?.game ?? ""), amount: Number(g?.amount) }))
  .filter((g) => g.game && Number.isFinite(g.amount));

function normaliseOverview(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const doors = (Array.isArray(data.doors) ? data.doors : []).map((d) => ({
    day: Number(d?.day),
    openAtMs: parseServerTime(d?.open_at),
    open: d?.open === true,
    opened: d?.opened === true,
    gifts: d?.gifts == null ? null : normaliseGifts(d.gifts),
    preview: d?.preview == null ? null : normaliseGifts(d.preview),
  })).filter((d) => Number.isInteger(d.day) && d.day >= 1 && d.day <= DOOR_COUNT);
  return {
    nowMs: parseServerTime(data.now),
    untilMs: parseServerTime(data.until),
    signedIn: data.signed_in === true,
    admin: data.admin === true,
    doors,
  };
}

const doorByDay = (day) => state.overview?.doors.find((d) => d.day === day) || null;

async function loadOverview() {
  const overview = normaliseOverview(await rpc("advent_gifts_overview"));
  if (Number.isFinite(overview.nowMs)) state.clockOffsetMs = overview.nowMs - Date.now();
  state.overview = overview;
  state.lastRefreshAt = Date.now();
  return overview;
}

function refresh() {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    try {
      await loadOverview();
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

/* ---------- messages ---------- */
function showMessage(text, withRetry = false) {
  const box = clear($("advMsg"));
  box.hidden = false;
  box.append(el("p", { text }));
  if (withRetry) box.append(el("button", { type: "button", class: "gt-btn ghost", text: "Nach eng Kéier", on: { click: () => { hideMessage(); refresh(); } } }));
}
function hideMessage() { $("advMsg").hidden = true; }

/* ---------- state helpers ---------- */
const isOver = () => Boolean(state.overview) && Number.isFinite(state.overview.untilMs) && serverNow() >= state.overview.untilMs;
const dayLabel = (day) => `${day}. Dez`;

/* The next door that has not opened yet (earliest open_at in the future), or null. */
function nextLockedDoor() {
  const now = serverNow();
  let next = null;
  for (const door of state.overview?.doors || []) {
    if (door.open || !Number.isFinite(door.openAtMs) || door.openAtMs <= now) continue;
    if (!next || door.openAtMs < next.openAtMs) next = door;
  }
  return next;
}

/* ---------- grid ---------- */
function giftLine(gift) {
  const info = gameInfo(gift.game);
  return `${info.emoji} +${formatAmount(gift.amount)} ${info.unit}`.trim();
}

function doorStatus(door) {
  if (door.open && door.opened) return "done";
  if (door.open) return "ready";
  return "locked";
}

function renderDoor(door) {
  const status = doorStatus(door);
  const next = status === "locked" ? nextLockedDoor() : null;
  const isNext = next?.day === door.day;
  const label = status === "locked" ? `Dier ${door.day}, nach net op` : status === "ready" ? `Dier ${door.day}, maach se op` : `Dier ${door.day}, opgemaach`;
  const children = [
    el("span", { class: "adv-num", text: String(door.day) }),
  ];
  if (door.day === KLEESCHEN_DAY) children.push(el("span", { class: "adv-tag", text: "🎅 Kleeschen" }));
  if (door.day === CHRISTMAS_EVE) children.push(el("span", { class: "adv-tag", text: "🎄 Hellegowend" }));
  if (status === "locked") {
    children.push(el("span", { class: "adv-door-state", text: dayLabel(door.day) }));
    if (isNext) children.push(el("span", { class: "adv-door-sub adv-next", data: { next: "1" } }));
    if (state.overview.admin && door.preview?.length) children.push(el("span", { class: "adv-door-sub adv-admin-preview", text: `👁 ${door.preview.map(giftLine).join(" · ")}` }));
  } else if (status === "ready") {
    children.push(el("span", { class: "adv-door-state", text: "Maach op!" }));
  } else {
    children.push(el("span", { class: "adv-door-gifts" }, (door.gifts || []).map((g) => el("span", { text: giftLine(g) }))));
  }
  return el("li", {}, el("button", {
    type: "button", class: `adv-door ${status}${door.day === KLEESCHEN_DAY ? " kleeschen" : ""}`, data: { day: door.day, status },
    aria: { label },
    on: { click: (event) => onDoorTap(door.day, event.currentTarget) },
  }, children));
}

function renderGrid() {
  const grid = clear($("advGrid"));
  const byDay = new Map((state.overview?.doors || []).map((d) => [d.day, d]));
  const placeholder = (day) => ({ day, openAtMs: NaN, open: false, opened: false, gifts: null, preview: null });
  for (const day of DOOR_ORDER) grid.append(state.overview ? renderDoor(byDay.get(day) || placeholder(day)) : renderPlaceholder(day));
  tick();
}

function renderPlaceholder(day) {
  return el("li", {}, el("button", { type: "button", class: "adv-door locked", disabled: true, data: { day, status: "locked" }, aria: { label: `Dier ${day}` } },
    el("span", { class: "adv-num", text: String(day) }), el("span", { class: "adv-door-state", text: dayLabel(day) })));
}

function renderAll() {
  $("advSignin").hidden = !state.overview || state.overview.signedIn;
  renderGrid();
}

/* ---------- countdown (header line + the next door) ---------- */
function tick() {
  const header = $("advCountdown");
  if (!state.overview) { header.textContent = ""; return; }
  const next = nextLockedDoor();
  const now = serverNow();
  if (isOver()) {
    header.textContent = "De Kalenner ass eriwwer. Merci fir mat ze maachen!";
  } else if (!next) {
    header.textContent = "All Dieren sinn op. Hues de se all opgemaach?";
  } else {
    const remaining = next.openAtMs - now;
    const anyOpen = state.overview.doors.some((d) => d.open);
    header.textContent = anyOpen
      ? `Dier ${next.day} geet op an ${formatCountdown(remaining)}.`
      : `Et geet lass an ${formatCountdown(remaining)}. Dann ass Dier 1 op.`;
    for (const node of document.querySelectorAll("#advGrid [data-next]")) node.textContent = `op an ${formatCountdown(remaining)}`;
    if (remaining <= 0 && Date.now() - state.lastRefreshAt > REFRESH_COOLDOWN_MS) refresh();
  }
}

/* ---------- sheet (gift / login prompt / locked) ---------- */
function topFocusable() { return $("advSheet").querySelector("button, a[href]"); }

function showSheet(opener, ...children) {
  const sheet = $("advSheet");
  state.sheetOpener = opener || state.sheetOpener;
  clear(sheet).append(el("div", { class: "adv-sheet-inner" },
    el("div", { class: "adv-sheet-top" },
      el("button", { type: "button", class: "adv-back", text: "‹ Zréck", on: { click: hideSheet } })),
    children));
  sheet.hidden = false;
  document.body.classList.add("adv-lock");
  topFocusable()?.focus();
}

function hideSheet() {
  const sheet = $("advSheet");
  if (sheet.hidden) return;
  sheet.hidden = true;
  clear(sheet);
  document.body.classList.remove("adv-lock");
  const opener = state.sheetOpener;
  state.sheetOpener = null;
  if (opener?.isConnected) opener.focus();
}

function doorStage(day) {
  return el("div", { class: "adv-stage", "aria-hidden": "true" },
    el("div", { class: "adv-frame" },
      el("span", { class: "adv-leaf adv-leaf-l" }),
      el("span", { class: "adv-leaf adv-leaf-r" }),
      el("span", { class: "adv-glow", text: day === KLEESCHEN_DAY ? "🎅" : "🎁" })));
}

function giftRow(gift) {
  const info = gameInfo(gift.game);
  return el("li", { class: "adv-gift", data: { game: gift.game } },
    el("p", { class: "adv-gift-text" },
      el("span", { class: "adv-gift-line", text: `🎁 +${formatAmount(gift.amount)} ${info.unit} am ${info.name}`.replace("  ", " ") })),
    el("a", { class: "gt-btn", href: gameUrl(gift.game), text: "Elo spillen" }));
}

function showGifts(day, gifts, { isNew, opener }) {
  const heading = day === KLEESCHEN_DAY ? "De Kleeschen war do! 🎅" : day === CHRISTMAS_EVE ? "Hellegowend! 🎄" : `Dier ${day}`;
  const note = day === KLEESCHEN_DAY ? "Dëst ass e méi grousse Kaddo."
    : day === CHRISTMAS_EVE ? `Haut gëtt et ${gifts.length === 1 ? "e Kaddo" : "Kaddoen"} an alle Spiller.` : "";
  showSheet(opener,
    el("p", { class: "adv-sheet-day", text: dayLabel(day) }),
    el("h2", { class: "adv-title", text: heading }),
    doorStage(day),
    note ? el("p", { class: "adv-text", text: note }) : null,
    el("ul", { class: `adv-gifts${isNew ? " fresh" : ""}`, "aria-label": "Kaddoen" }, gifts.map(giftRow)),
    el("p", { class: "adv-small", text: "Ass d'Spill oppen, kënnt de Kaddo no ongeféier enger Minutt. Soss kënnt en, wann s de d'Spill nächst Kéier opmaachs." }));
}

function showMessageSheet(opener, day, title, text, extra = null) {
  showSheet(opener,
    el("p", { class: "adv-sheet-day", text: dayLabel(day) }),
    el("h2", { class: "adv-title", text: title }),
    el("p", { class: "adv-text", text }),
    extra);
}

function showLoginPrompt(opener, day) {
  showMessageSheet(opener, day, "Mell dech un fir deng Kaddoen",
    "Fir eng Dier opzemaachen, brauchs de en ian.lu-Kont. Mell dech un oder maach e neie Kont.",
    el("button", { type: "button", class: "gt-btn", id: "advLoginBtn", text: "Aloggen / Kont maachen", on: { click: () => auth.openAuthModal() } }));
}

/* ---------- door tap ---------- */
async function onDoorTap(day, opener) {
  const door = doorByDay(day);
  if (!door || state.opening) return;
  if (!state.overview.signedIn) { showLoginPrompt(opener, day); return; }
  if (door.open && door.opened && door.gifts) { showGifts(day, door.gifts, { isNew: false, opener }); return; }
  if (!door.open) {
    if (isOver()) { showMessageSheet(opener, day, "Eriwwer", errorText({ code: "over" })); return; }
    const remaining = Number.isFinite(door.openAtMs) ? ` Si geet op an ${formatCountdown(door.openAtMs - serverNow())}.` : "";
    showMessageSheet(opener, day, "Nach net op", `Dës Dier ass nach zou, si geet den ${dayLabel(day)} um 00:00 op.${remaining}`);
    return;
  }
  await openGift(day, opener);
}

async function openGift(day, opener) {
  state.opening = true;
  opener?.setAttribute("aria-busy", "true");
  try {
    const result = await rpc("advent_gift_open", { p_day: day });
    const gifts = normaliseGifts(result?.gifts);
    if (!gifts.length) throw new AdventError("advent: empty");
    const door = doorByDay(day);
    if (door) { door.opened = true; door.gifts = gifts; }
    renderAll();
    const fresh = document.querySelector(`#advGrid .adv-door[data-day="${day}"]`);
    showGifts(day, gifts, { isNew: result?.new === true, opener: fresh || opener });
    refresh();
  } catch (error) {
    console.warn("[advent] open failed", error);
    const text = errorText(error);
    showMessageSheet(opener, day, "Oops", text,
      error?.code === "signin" ? el("button", { type: "button", class: "gt-btn", text: "Aloggen / Kont maachen", on: { click: () => auth.openAuthModal() } }) : null);
    if (error?.code) refresh();
  } finally {
    state.opening = false;
    opener?.removeAttribute("aria-busy");
  }
}

/* ---------- boot ---------- */
function bindStatic() {
  $("signInBtn").addEventListener("click", () => auth.openAuthModal());
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideSheet(); });
  setInterval(tick, TICK_MS);
}

async function boot() {
  store.remove(LEGACY_TOKEN_KEY);
  bindStatic();
  renderAll();
  if (!auth.authConfigured) { showMessage("De Kalenner ass grad net erreechbar.", true); return; }
  try {
    state.sb = await auth.client();
  } catch (error) {
    console.warn("[advent] client failed", error);
    showMessage("Konnt net mat dem Server verbannen.", true);
    return;
  }
  auth.onAuth(async () => {
    await refresh();
    if (state.overview?.signedIn && $("advLoginBtn")) hideSheet();   // logged in from the prompt: back to the calendar
  });
  await refresh();
}

boot();
