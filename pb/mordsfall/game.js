/* Mordsfall — the game screen: case list, board, suspects, pencil marks, hints, win.
 * Rules engine: solver.js · words: text.js · pictures: art.js · cases: cases.js (generated, see scripts/mordsfall_gen.mjs).
 * Input model on the board (with a person selected):
 *   tap = pencil letter (the person's initial) · swipe = letters on every cell passed · hold ~0.4 s or double-tap = place the person. */
import cases from "./cases.js?v=3";
import { SCENES } from "./scenes.js?v=3";
import { FLOOR_OF } from "./rooms.js?v=3";
import { buildModel, clueHolds, hint as solverHint, murdererOf } from "./solver.js?v=3";
import { T, clueText, clueHTML, storyText, caseTitle, roomName, objName, OBJECTS, TIER_KEYS, LANGS, UI } from "./text.js?v=3";
import { bust, bustBadge, portrait, lookOf, objectSVG, objectIcon, caseThumb, FLOOR_DEFS, ROOM_TINT, FLOOR_BASE } from "./art.js?v=3";

const TEST_MODE = window.__pbTestMode === true; // owner test mode: nothing is read from or written to storage, nothing reaches a leaderboard
const SAVE_KEY = "pb_save_mordsfall";
const LANG_KEY = "site_lang";
const BASE_POINTS = [100, 200, 300, 400, 500];
const PAR_SECONDS = [150, 300, 480, 720, 1000];
const HINT_PENALTY = { deduce: 30, reveal: 60, conflict: 60 };
const WRONG_CHECK_PENALTY = 15;
const UNDO_LIMIT = 300;
const FLASH_MS = 2200;
const HOLD_MS = 400, RING_DELAY = 110, DOUBLE_TAP_MS = 320, ERASE_ALL_MS = 800, SWIPE_PX = 8;
const LM = 44, PAD = 16, CELL = 100; // label margin, frame padding, cell size in board units
const INK = "#2b2118";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sceneOf = (cs) => SCENES.find((s) => s.id === cs.scene);
const fmtTime = (sec) => { const s = Math.max(0, Math.floor(sec)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f)); return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join(""); };
const initialOf = (person) => person.name.charAt(0).toUpperCase();

/* ---------------- storage ---------------- */
const DEFAULT_SETTINGS = { grey: true, tick: true, timer: true, clearOnPlace: true, filter: "all" };
function freshSave() { return { v: 2, done: {}, wip: null, settings: { ...DEFAULT_SETTINGS }, seen: false }; }
function cleanNumber(x, min, max) { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; }
function loadSave() {
  const save = freshSave();
  if (TEST_MODE) return save;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); }
  catch (error) { console.warn("[mordsfall] saved progress is unreadable, starting fresh", error); return save; }
  if (!raw || typeof raw !== "object") return save;
  const s = raw.settings || {};
  save.settings = { grey: s.grey !== false, tick: s.tick !== false, timer: s.timer !== false, clearOnPlace: s.clearOnPlace !== false, filter: ["all", ...TIER_KEYS].includes(s.filter) ? s.filter : "all" };
  save.seen = raw.seen === true;
  if (raw.v !== 2) return save; // v1 saves belong to the old cases (the 30 cases were redrawn with multi-cell objects): keep only the settings
  const known = new Set(cases.map((c) => c.id));
  for (const [id, entry] of Object.entries(raw.done || {})) {
    if (!known.has(id) || !entry || typeof entry !== "object") continue;
    const t = cleanNumber(entry.t, 1, 86400), pts = cleanNumber(entry.pts, 0, 100000);
    if (t === null || pts === null) continue;
    save.done[id] = { t: Math.round(t), pts: Math.round(pts), n: Math.max(1, Math.round(cleanNumber(entry.n, 1, 100000) ?? 1)) };
  }
  const w = raw.wip;
  if (w && known.has(w.id) && Array.isArray(w.pos) && Array.isArray(w.marks)) {
    const cs = cases.find((c) => c.id === w.id), N = cs.n * cs.n;
    const posOk = w.pos.length === cs.people.length && w.pos.every((x) => Number.isInteger(x) && x >= -1 && x < N);
    const t = cleanNumber(w.t, 0, 86400), hints = cleanNumber(w.hints, 0, 1000);
    const markOk = (k) => { const m = typeof k === "string" && k.match(/^(-?\d+):(\d+)$/); return !!m && Number(m[1]) >= -1 && Number(m[1]) < cs.people.length && Number(m[2]) < N; };
    if (posOk && t !== null && hints !== null) save.wip = { id: w.id, pos: w.pos, marks: w.marks.filter(markOk), t, hints };
  }
  return save;
}
let save = loadSave();
function persist() {
  if (TEST_MODE) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch (error) { console.warn("[mordsfall] could not save progress", error); }
}
function readLang() {
  try { const l = localStorage.getItem(LANG_KEY); if (LANGS.includes(l)) return l; } catch (error) { console.warn("[mordsfall] could not read the language", error); }
  return "lb";
}
let lang = readLang();
const t = (key, vars) => T(key, lang, vars);

/* ---------------- game state ---------------- */
let G = null; // the open case, or null while the list is showing
function floorOfRoom(cs, id) {
  const sc = sceneOf(cs), room = sc.rooms.find((r) => r.lb === cs.rooms[id].lb);
  return (room && FLOOR_OF[room.kind]) || "planks";
}
function newGame(cs) {
  const model = buildModel(cs);
  return {
    cs, model, solution: cs.sol.map(([r, c]) => r * cs.n + c), floors: cs.rooms.map((_, i) => floorOfRoom(cs, i)),
    pos: cs.people.map(() => -1), marks: new Set(), sel: -1, notes: false, cursor: -1, hover: -1, kbd: false,
    undo: [], elapsed: 0, running: false, tick: 0, hints: 0, status: "playing",
    msg: "", msgBad: false, hint: null, flash: null, flashTimer: 0, won: null, staticKey: "", staticSVG: "",
  };
}
const personAt = (cell) => G.pos.indexOf(cell);
const placedCount = () => G.pos.filter((x) => x >= 0).length;
const clock = () => G.elapsed + (G.running ? (performance.now() - G.tick) / 1000 : 0);
function startClock() { if (G && !G.running && G.status === "playing") { G.running = true; G.tick = performance.now(); } }
function stopClock() { if (G && G.running) { G.elapsed = clock(); G.running = false; } }
const addPenalty = (sec) => { G.elapsed += sec; };

function saveWip() {
  if (TEST_MODE || !G || G.status !== "playing") return;
  save = { ...save, wip: { id: G.cs.id, pos: [...G.pos], marks: [...G.marks], t: Math.round(clock()), hints: G.hints } };
  persist();
}
function clearWip() { if (save.wip && G && save.wip.id === G.cs.id) { save = { ...save, wip: null }; persist(); } }
function snapshot() {
  G.undo.push({ pos: [...G.pos], marks: [...G.marks] });
  if (G.undo.length > UNDO_LIMIT) G.undo.shift();
}
function say(text, bad = false) { G.msg = text; G.msgBad = bad; }

/* ---------------- operations on the board ---------------- */
const markKey = (p, cell) => p + ":" + cell;
const CROSS = -1; // the "nobody can be here" mark belongs to nobody
function marksOf(cell) { const out = []; G.cs.people.forEach((_, p) => { if (G.marks.has(markKey(p, cell))) out.push(p); }); return out; }
function placePerson(p, cell) {
  if (G.model.blocked[cell]) { say(t("cannotStand", { o: objName(G.model.objAt[cell], lang) }), true); return false; }
  snapshot();
  G.pos[p] = cell;
  G.marks.delete(markKey(p, cell)); G.marks.delete(markKey(CROSS, cell));
  if (save.settings.clearOnPlace) for (const k of [...G.marks]) if (k.startsWith(p + ":")) G.marks.delete(k);
  G.hint = null; G.msg = "";
  return true;
}
function unplacePerson(p) { snapshot(); G.pos[p] = -1; G.hint = null; G.msg = ""; }
const canWrite = (cell) => !G.model.blocked[cell] && personAt(cell) < 0;
function toggleLetter(p, cell) { const k = markKey(p, cell); if (G.marks.has(k)) G.marks.delete(k); else G.marks.add(k); }
function undoOnce() {
  const last = G.undo.pop();
  if (!last) return false;
  G.pos = last.pos; G.marks = new Set(last.marks); G.hint = null; G.msg = "";
  return true;
}
function select(p) { G.sel = G.sel === p ? -1 : p; G.msg = ""; }
function eraseCell(cell) {
  if (cell < 0) return;
  const keys = [...G.marks].filter((k) => k.endsWith(":" + cell));
  if (!keys.length) return;
  snapshot(); keys.forEach((k) => G.marks.delete(k));
}
function eraseAll() { if (!G.marks.size) return; snapshot(); G.marks = new Set(); }

function afterChange() { saveWip(); renderPlay(); }

/* two people on one row or column */
function conflictSet() {
  const bad = new Set(), n = G.cs.n;
  G.pos.forEach((x, p) => { if (x < 0) return; G.pos.forEach((y, q) => { if (q > p && y >= 0 && (Math.floor(x / n) === Math.floor(y / n) || x % n === y % n)) { bad.add(p); bad.add(q); } }); });
  return bad;
}

/* ---------------- checking, hints, winning ---------------- */
function check() {
  if (G.status !== "playing") return;
  G.hint = null;
  if (placedCount() < G.cs.people.length) { say(t("placeAll"), true); renderPlay(); return; }
  const wrong = G.pos.filter((x, p) => x !== G.solution[p]).length;
  if (wrong === 0) { win(); return; }
  addPenalty(WRONG_CHECK_PENALTY);
  say((wrong === 1 ? t("wrong1") : t("wrongN", { n: wrong })) + " (+" + WRONG_CHECK_PENALTY + " s)", true);
  saveWip();
  renderPlay();
}
function useHint() {
  if (G.status !== "playing") return;
  startClock();
  const h = solverHint(G.model, G.pos, G.solution);
  if (h.kind === "done") { say(t("hintDone")); renderPlay(); return; }
  G.hints += 1;
  addPenalty(HINT_PENALTY[h.kind]);
  const n = G.cs.n, p = h.person;
  G.sel = p;
  if (h.kind === "conflict") {
    say(t("hintWrong", { name: G.cs.people[p].name }), true);
    G.hint = null;
    flash([G.pos[p]]);
  } else {
    G.msg = "";
    G.hint = { ...h, row: Math.floor(h.cell / n) + 1, col: (h.cell % n) + 1 };
    flash([h.cell]);
  }
  saveWip();
  renderPlay();
}
function reasonLines(h) {
  const cs = G.cs, nameOf = (p) => cs.people[p].name;
  return h.reasons.map((r) => {
    if (r.rule === "own") return t("rOwn", { name: nameOf(r.owner), clue: clueText(cs, cs.people[r.owner].clues[r.clue], lang) });
    if (r.rule === "hidden") return t(r.line === "row" ? "rHiddenRow" : "rHiddenCol", { k: r.k + 1 });
    if (r.rule === "bin") return t("rBin", { name: nameOf(r.owner), clue: clueText(cs, cs.people[r.owner].clues[r.clue], lang) });
    if (r.rule === "alone" || r.rule === "victim") return t("rRoom", { name: nameOf(r.owner), clue: clueText(cs, cs.people[r.owner].clues[r.clue], lang) });
    if (r.rule === "taken") return t("rTaken", { names: r.list.map((x) => nameOf(x.by)).join(", ") });
    return "";
  }).filter(Boolean);
}
function flash(cells) {
  clearTimeout(G.flashTimer);
  G.flash = new Set(cells);
  G.flashTimer = setTimeout(() => { if (G) { G.flash = null; renderDyn(); } }, FLASH_MS);
}
function pointsFor(diff, seconds) { return Math.round(BASE_POINTS[diff] * (0.5 + 0.5 * Math.max(0, 1 - seconds / PAR_SECONDS[diff]))); }
const totalPoints = () => Object.values(save.done).reduce((a, d) => a + d.pts, 0);

function win() {
  stopClock();
  G.status = "won";
  const cs = G.cs, seconds = Math.max(1, Math.round(G.elapsed)), pts = pointsFor(cs.diff, seconds);
  const prev = save.done[cs.id];
  const newBest = !prev || seconds < prev.t;
  const improvedPts = !prev || pts > prev.pts;
  const entry = { t: prev ? Math.min(prev.t, seconds) : seconds, pts: prev ? Math.max(prev.pts, pts) : pts, n: (prev?.n || 0) + 1 };
  G.won = { seconds, pts, newBest, murderer: murdererOf(G.model, G.solution) };
  if (!TEST_MODE) {
    save = { ...save, done: { ...save.done, [cs.id]: entry }, wip: null };
    persist();
    if (improvedPts && window.Arcade) {
      try { window.Arcade.startRun(); window.Arcade.gameOver(totalPoints()); }
      catch (error) { console.warn("[mordsfall] could not report the score", error); }
    }
  } else {
    save = { ...save, done: { ...save.done, [cs.id]: entry } }; // in memory only, so the list can show the tick
  }
  G.sel = -1; G.hint = null; G.msg = "";
  renderPlay();
  showWin();
}

/* ---------------- list view ---------------- */
function renderList() {
  const done = Object.keys(save.done).length, filter = save.settings.filter;
  const shown = cases.filter((c) => filter === "all" || c.id.startsWith(filter));
  $("#listView").innerHTML = `
    <div class="mf-hero">
      <div><h2>${esc(t("title"))} <span class="lens" aria-hidden="true">🔎</span></h2><p>${esc(t("subtitle"))}</p></div>
      <div class="mf-prog">${t("progress", { n: "<b>" + done + "</b>", t: cases.length, p: "<b>" + totalPoints() + "</b>" })}</div>
    </div>
    ${TEST_MODE ? `<span class="mf-vtag mf-test">${esc(t("testBadge"))}</span>` : ""}
    <div class="mf-filters" role="group" aria-label="${esc(t("cases"))}">
      ${["all", ...TIER_KEYS].map((k) => `<button type="button" class="mf-chip" data-filter="${k}" aria-pressed="${k === filter}">${esc(k === "all" ? t("filterAll") : t("tier_" + k))}</button>`).join("")}
    </div>
    <div class="mf-grid">${shown.map(cardHTML).join("")}</div>`;
}
function cardHTML(cs) {
  const d = save.done[cs.id], sc = sceneOf(cs), num = cases.indexOf(cs) + 1;
  const floorOf = (id) => floorOfRoom(cs, id);
  return `<button type="button" class="mf-file${d ? " solved" : ""}" data-case="${cs.id}" aria-label="${esc(caseTitle(cs, lang))}">
    <span class="tab">${esc(t("caseFile"))} ${String(num).padStart(2, "0")}</span>
    <span class="pin">${caseThumb(cs, { size: 104, floorOf })}</span>
    <span class="tx">
      <span class="ti">${esc(caseTitle(cs, lang))}</span>
      <span class="me"><span class="mf-tag t${cs.diff}">${esc(t("tier_" + TIER_KEYS[cs.diff]))}</span> <span class="sz">${cs.n}×${cs.n}</span></span>
      <span class="sc">${sc.emoji} ${esc(sc.name[lang])}</span>
      ${d ? `<span class="best">⏱ ${fmtTime(d.t)} · ${d.pts} ${esc(t("points"))}</span>` : ""}
    </span>${d ? `<span class="stamp" aria-label="${esc(t("solved"))}">${esc(t("stamp"))}</span>` : ""}</button>`;
}

/* ---------------- play view ---------------- */
function openCase(id) {
  const cs = cases.find((c) => c.id === id);
  if (!cs) return false;
  closeModal();
  G = newGame(cs);
  const w = save.wip;
  if (w && w.id === id && !TEST_MODE) { G.pos = [...w.pos]; G.marks = new Set(w.marks); G.elapsed = w.t; G.hints = w.hints; }
  $("#listView").hidden = true;
  $("#playView").hidden = false;
  window.scrollTo(0, 0);
  renderPlay();
  startClock();
  return true;
}
function leaveCase() {
  if (G) { stopClock(); saveWip(); clearTimeout(G.flashTimer); }
  endPress();
  G = null;
  $("#playView").hidden = true;
  $("#listView").hidden = false;
  renderList();
  window.scrollTo(0, 0);
}

function focusKey(el) {
  if (!el || !el.dataset) return "";
  for (const k of ["act", "p", "clue", "room", "set"]) if (el.dataset[k] !== undefined) return `[data-${k}="${el.dataset[k]}"]`;
  return "";
}
function renderPlay() {
  if (!G) return;
  const key = $("#playView").contains(document.activeElement) ? focusKey(document.activeElement) : "";
  drawPlay();
  if (key) { const again = $("#playView " + key); if (again && again.focus) again.focus({ preventScroll: true }); }
}

const ICON = {
  cross: `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><path d="M9 9 L31 31 M31 9 L9 31" stroke="currentColor" stroke-width="5.5" stroke-linecap="round"/></svg>`,
  erase: `<svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><path d="M7 26 L21 8 Q23 6 26 8 L33 14 Q35 16 33 19 L22 33 H12 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M14 18 L26 28" stroke="currentColor" stroke-width="3"/><path d="M12 33 H34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  undo: `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><path d="M13 14 H25 Q33 14 33 22 Q33 30 25 30 H14" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/><path d="M18 8 L11 14 L18 20" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hint: `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><path d="M20 6 Q30 6 30 16 Q30 22 25 26 V30 H15 V26 Q10 22 10 16 Q10 6 20 6 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M15 34 H25 M17 37 H23" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  check: `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><path d="M8 21 L17 30 L33 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  how: `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M15 16 Q15 10 21 10 Q27 10 27 15 Q27 19 22 21 Q20 22 20 25" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="20" cy="31" r="2.2" fill="currentColor"/></svg>`,
};

function toolsHTML() {
  const all = placedCount() === G.cs.people.length;
  const btn = (act, icon, label, extra = "") => `<button type="button" class="mf-tool" data-act="${act}" ${extra}><span class="ic">${icon}</span><span class="lb">${esc(label)}</span></button>`;
  return `<div class="mf-tools-main">
      ${btn("cross", ICON.cross, t("cross"), `aria-pressed="${G.notes}"`)}
      ${btn("erase", ICON.erase, t("erase"), `title="${esc(t("erase"))}"`)}
      ${btn("undo", ICON.undo, t("undo"), G.undo.length ? "" : "disabled")}
    </div>
    <div class="mf-tools-end">
      ${btn("hint", ICON.hint, t("hint"))}
      <button type="button" class="mf-tool${all ? " go" : ""}" data-act="check" aria-disabled="${!all}"><span class="ic">${ICON.check}</span><span class="lb">${esc(all ? t("check") : t("checkLocked"))}</span></button>
      ${btn("how", ICON.how, t("how"))}
    </div>`;
}

function drawPlay() {
  const cs = G.cs, sc = sceneOf(cs);
  const view = $("#playView");
  view.className = (save.settings.tick ? "" : "mf-noassist ") + (G.sel >= 0 ? "has-sel" : "");
  view.innerHTML = `
    <div class="mf-head">
      <button type="button" class="mf-back" data-act="cases">${esc(t("cases2"))}</button>
      <div class="mf-ttl">${sc.emoji} ${esc(caseTitle(cs, lang))}<small>${esc(t("tier_" + TIER_KEYS[cs.diff]))} · ${cs.n}×${cs.n} · ${esc(sc.name[lang])}</small></div>
    </div>
    <div class="mf-play">
      <aside class="mf-suspects" aria-label="${esc(t("suspects"))}"><div class="mf-cards">${cs.people.map(cardHTML2).join("")}</div></aside>
      <section class="mf-boardarea">
        <div class="mf-centertop">
          <p class="mf-msg${G.msgBad ? " bad" : ""}" role="status" aria-live="polite">${G.notes && !G.msg ? esc(t("notesOn")) : esc(G.msg)}</p>
          <div class="mf-clock" id="mfClock" ${save.settings.timer ? "" : "hidden"} role="timer" aria-label="${esc(t("time"))}">${fmtTime(clock())}</div>
        </div>
        ${hintHTML()}
        <div class="mf-tray" role="group" aria-label="${esc(t("suspects"))}">${cs.people.map(chipHTML).join("")}</div>
        <div class="mf-selpanel">${selPanelHTML()}</div>
        <div class="mf-frame"><div class="mf-boardwrap" id="mfBoardWrap"></div><div class="mf-tip" id="mfTip" hidden></div></div>
      </section>
      <section class="mf-info">
        <div class="mf-rooms" aria-label="${esc(t("rooms"))}">${cs.rooms.map((r, i) => `<button type="button" class="mf-roomchip" data-room="${i}"><i style="background:${FLOOR_BASE[G.floors[i]]}"></i>${esc(r[lang])}</button>`).join("")}</div>
        ${legendHTML()}
        <details class="mf-set">
          <summary>⚙ ${esc(t("settings"))}</summary>
          <label class="mf-toggle"><input type="checkbox" data-set="clearOnPlace" ${save.settings.clearOnPlace ? "checked" : ""}> ${esc(t("clearOnPlace"))}</label>
          <label class="mf-toggle"><input type="checkbox" data-set="grey" ${save.settings.grey ? "checked" : ""}> ${esc(t("autoGrey"))}</label>
          <label class="mf-toggle"><input type="checkbox" data-set="tick" ${save.settings.tick ? "checked" : ""}> ${esc(t("assistTick"))}</label>
          <label class="mf-toggle"><input type="checkbox" data-set="timer" ${save.settings.timer ? "checked" : ""}> ${esc(t("timeShown"))}</label>
          <div class="mf-btns"><button type="button" class="mf-btn alt" data-act="reset">${esc(t("reset"))}</button></div>
        </details>
      </section>
      <nav class="mf-tools" aria-label="${esc(t("legend"))}">${toolsHTML()}</nav>
    </div>`;
  renderBoard(true);
}

function hintHTML() {
  const h = G.hint;
  if (!h) return "";
  const p = G.cs.people[h.person];
  if (h.kind === "reveal") return `<div class="mf-hintbox"><p>${esc(t("hintReveal", { name: p.name, r: h.row, c: h.col }))}</p><button type="button" data-act="placehint">${esc(t("hintPlace"))}</button></div>`;
  const lines = reasonLines(h);
  return `<div class="mf-hintbox"><p>${esc(t("hintDeduce", { name: p.name, r: h.row, c: h.col }))}</p>${lines.length ? `<p>${esc(t("hintBecause"))}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}<button type="button" data-act="placehint">${esc(t("hintPlace"))}</button></div>`;
}
const personLook = (p) => lookOf(G.cs.people[p], p);
function chipHTML(person, p) {
  const placed = G.pos[p] >= 0, victim = p === G.cs.victim;
  return `<button type="button" class="mf-pchip${placed ? " placed" : ""}" data-p="${p}" aria-pressed="${G.sel === p}" aria-label="${esc(person.name)}${victim ? " (" + esc(t("victim")) + ")" : ""}">
    ${bustBadge(personLook(p), { size: 40, victim })}<span class="nm">${esc(person.name)}</span><b class="ini" style="color:${shade(personLook(p).color, 0.55)}">${esc(initialOf(person))}</b>${placed ? '<span class="ck" aria-hidden="true">✓</span>' : ""}</button>`;
}
function cluesListHTML(p) {
  const cs = G.cs, person = cs.people[p];
  const items = person.clues.map((cl, ci) => {
    const ok = save.settings.tick && clueHolds(G.model, cl, p, G.pos) === true;
    const lead = cl.t === "victim" ? `${esc(t("victimLead"))} ` : "";
    return `<li><button type="button" data-clue="${p}:${ci}"><span class="mf-tk${ok ? " on" : ""}" aria-hidden="true">✓</span><span>${lead}${clueHTML(cs, cl, lang)}${ok ? `<span class="sr"> ✓</span>` : ""}</span></button></li>`;
  });
  if (!items.length) return `<ul class="mf-clues"><li><span class="empty">${esc(t("cluesNone"))}</span></li></ul>`;
  return `<ul class="mf-clues">${items.join("")}</ul>`;
}
function posLabel(p) {
  const x = G.pos[p], n = G.cs.n;
  return x < 0 ? t("notPlaced") : t("placedAt", { r: Math.floor(x / n) + 1, c: (x % n) + 1 });
}
function selPanelHTML() {
  if (G.sel < 0) return `<div class="empty">${esc(t("selectedNone"))}</div>`;
  const p = G.sel, person = G.cs.people[p];
  return `<div class="hd">${bustBadge(personLook(p), { size: 36, victim: p === G.cs.victim })}<span class="nm">${esc(person.name)}</span><b class="ini" style="color:${shade(personLook(p).color, 0.55)}">${esc(initialOf(person))}</b><span class="pos">${esc(posLabel(p))}</span></div>${cluesListHTML(p)}`;
}
function cardHTML2(person, p) {
  const victim = p === G.cs.victim, placed = G.pos[p] >= 0, look = personLook(p);
  return `<div class="mf-card${G.sel === p ? " sel" : ""}${placed ? " placed" : ""}${victim ? " victim" : ""}" role="group" data-card="${p}" style="--pc:${look.color}">
    <button type="button" class="mf-portraitbtn" data-p="${p}" aria-pressed="${G.sel === p}" aria-label="${esc(person.name)}${victim ? " (" + esc(t("victim")) + ")" : ""}">
      ${portrait(look, { victim })}
      <b class="ini" style="color:${shade(look.color, 0.5)}">${esc(initialOf(person))}</b>
      ${placed ? `<span class="ck" title="${esc(posLabel(p))}">✓</span>` : ""}
    </button>
    <div class="mf-name">${esc(person.name)}</div>
    <div class="mf-cluebox">${cluesListHTML(p)}</div></div>`;
}
function legendHTML() {
  const types = [...new Set(G.cs.objects.map((o) => o[0]))];
  const blk = types.filter((x) => OBJECTS[x].block), std = types.filter((x) => !OBJECTS[x].block);
  const grp = (title, list, cls) => list.length ? `<div class="grp"><span class="gt">${esc(title)}</span>${list.map((x) => `<span class="it">${objectIcon(x, 30).replace('class="mf-icon"', `class="mf-icon ${cls}"`)}${esc(objName(x, lang))}</span>`).join("")}</div>` : "";
  return `<div class="mf-legend" aria-label="${esc(t("legend"))}">${grp(t("legendBlock"), blk, "blk")}${grp(t("legendStand"), std, "std")}</div>`;
}

/* ---------------- board drawing ---------------- */
function boardPixelWidth() { const w = $("#mfBoardWrap"); return w && w.clientWidth ? w.clientWidth : 360; }
const boardGeometry = () => { const n = G.cs.n; return { n, VBW: n * CELL + LM + PAD, left: -LM, top: -LM }; };

/* label text widths: measured with the real font (cached), in em; falls back to a safe average when no canvas is available */
let measureCtx = null;
const widthCache = new Map();
function textUnits(text) {
  if (widthCache.has(text)) return widthCache.get(text);
  let w = text.length * 0.74;
  try {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    measureCtx.font = '900 100px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    w = measureCtx.measureText(text).width / 100 * 1.04 + 0.04; // + letter-spacing and the outline
  } catch (error) { /* keep the estimate */ }
  widthCache.set(text, w);
  return w;
}
/* a two-line version of a name: split at the space that balances the lines best */
function splitTwo(name) {
  const words = name.split(" ");
  if (words.length < 2) return null;
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" "), w = Math.max(textUnits(a), textUnits(b));
    if (!best || w < best.w) best = { w, lines: [a, b] };
  }
  return best.lines;
}

/* the parts of the board that only change with the case, the language or the screen width */
function buildStatic(scale) {
  const { cs, model } = G, n = cs.n, U = CELL;
  const room = (r, c) => model.room[r * n + c];
  let s = "";
  // floors: one path per room with its texture, one with its tint
  const roomPath = cs.rooms.map(() => "");
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) roomPath[room(r, c)] += `M${c * U} ${r * U}h${U}v${U}h${-U}z`;
  roomPath.forEach((d, id) => { s += `<path d="${d}" fill="${FLOOR_BASE[G.floors[id]]}"/><path d="${d}" fill="url(#fl-${G.floors[id]})"/><path d="${d}" fill="${ROOM_TINT[id % 10]}" opacity=".16"/>`; });
  // objects (one group per object so a press can name it)
  cs.objects.forEach(([type, cells], i) => {
    let face = null;
    if (cells.length === 1 && ["chair", "stool", "deckchair"].includes(type)) { // seats face the table / desk / counter beside them
      const [r, c] = cells[0];
      for (const [dr, dc, a] of [[1, 0, 0], [0, -1, 90], [-1, 0, 180], [0, 1, 270]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const o = model.objAt[rr * n + cc];
        if (o === "table" || o === "desk" || o === "counter") { face = a; break; }
      }
    }
    s += `<g class="obj" data-oid="${i}">${objectSVG(type, cells, i * 7 + cells[0][0] * 3 + cells[0][1], face)}</g>`;
  });
  // thin grid, then thick walls
  let thin = "", walls = "";
  for (let k = 1; k < n; k++) thin += `M${k * U} 0V${n * U}M0 ${k * U}H${n * U}`;
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) { const a = r > 0 ? room(r - 1, c) : -1, b = r < n ? room(r, c) : -1; if (a !== b) walls += `M${c * U} ${r * U}H${(c + 1) * U}`; }
  for (let c = 0; c <= n; c++) for (let r = 0; r < n; r++) { const a = c > 0 ? room(r, c - 1) : -1, b = c < n ? room(r, c) : -1; if (a !== b) walls += `M${c * U} ${r * U}V${(r + 1) * U}`; }
  s += `<path d="${thin}" stroke="${INK}" stroke-opacity=".14" stroke-width="2" fill="none"/><path d="${walls}" stroke="${INK}" stroke-width="15" stroke-linecap="square" fill="none"/><path d="${walls}" stroke="#7a6a58" stroke-width="3" stroke-linecap="square" fill="none" opacity=".55"/>`;
  s += `<rect x="-2" y="-2" width="${n * U + 4}" height="${n * U + 4}" rx="4" fill="none" stroke="${INK}" stroke-width="12"/>`;
  // room names: big bold capitals on the room's widest run of cells, sitting on the wall like a floor-plan label
  const best = new Map(); // room id -> widest horizontal run
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      const id = room(r, c);
      let len = 1;
      while (c + len < n && room(r, c + len) === id) len++;
      let objs = 0;
      for (let k = 0; k < len; k++) if (model.objAt[r * n + c + k]) objs++;
      const score = len * 100 - objs * 12 - r;
      const cur = best.get(id);
      if (!cur || score > cur.score) best.set(id, { r, c, len, score });
      c += len;
    }
  }
  const tall = new Map(); // room id -> tallest vertical run (used when a room is only one cell wide)
  for (let c = 0; c < n; c++) {
    let r = 0;
    while (r < n) {
      const id = room(r, c);
      let len = 1;
      while (r + len < n && room(r + len, c) === id) len++;
      const cur = tall.get(id);
      if (!cur || len > cur.len) tall.set(id, { r, c, len });
      r += len;
    }
  }
  const maxFs = Math.min(34, 15.5 / scale), minFs = Math.min(34, 9.4 / scale), hardMin = Math.min(34, 7.8 / scale);
  for (const [id, hrun] of best) {
    const vrun = tall.get(id), vertical = hrun.len === 1 && vrun.len >= 2;
    const { r, c, len } = vertical ? vrun : hrun;
    const avail = len * U - 24, full = roomName(cs, id, lang).toUpperCase(), short = cs.rooms[id].short?.[lang]?.toUpperCase();
    // candidates, best first: one line / two lines, full name then short name; a font size is accepted when it is not too small
    const variants = [];
    for (const name of [full, short]) if (name && !variants.some((v) => v.join(" ") === name)) { variants.push([name]); const two = splitTwo(name); if (two) variants.push(two); }
    const fitOf = (lines) => Math.min(maxFs, avail / Math.max(...lines.map((x) => textUnits(x))), lines.length > 1 ? 20 : 99);
    let pickV = null, fs = 0;
    for (const v of variants) { const f = fitOf(v); if (f >= minFs) { pickV = v; fs = f; break; } }
    if (!pickV) { // nothing fits at a comfortable size: take the variant that gets the largest letters, down to a hard floor
      let bestF = -1; for (const v of variants) { const f = fitOf(v); if (f > bestF) { bestF = f; pickV = v; } }
      fs = Math.max(hardMin, bestF);
      pickV = pickV.map((line) => { const fit = Math.floor(avail / (fs * textUnits("M") * 0.92)); return line.length > fit && fit > 2 ? line.slice(0, fit - 1) + "…" : line; });
      if (bestF >= hardMin) pickV = variants.find((v) => fitOf(v) === bestF);
    }
    if (vertical) { // a one-cell-wide room (corridor): the name runs up along the column
      const x0 = c * U + 8 + fs * 0.86, ym = r * U + (len * U) / 2;
      pickV.forEach((line, i) => { const x = x0 + i * fs * 1.02; s += `<text class="room-lbl" transform="rotate(-90 ${x.toFixed(1)} ${ym})" x="${x.toFixed(1)}" y="${ym}" font-size="${fs.toFixed(1)}" stroke-width="${(fs * 0.34).toFixed(1)}" text-anchor="middle">${esc(line)}</text>`; });
    } else {
      const x = c * U + (len * U) / 2, y0 = r * U + 8 + fs * 0.86;
      pickV.forEach((line, i) => { s += `<text class="room-lbl" x="${x}" y="${(y0 + i * fs * 1.02).toFixed(1)}" font-size="${fs.toFixed(1)}" stroke-width="${(fs * 0.34).toFixed(1)}" text-anchor="middle">${esc(line)}</text>`; });
    }
  }
  // axis numbers
  for (let k = 0; k < n; k++) {
    s += `<text class="axis" x="${k * U + U / 2}" y="${-LM / 2 + 12}" font-size="34" text-anchor="middle">${k + 1}</text>`;
    s += `<text class="axis" x="${-LM / 2 - 2}" y="${k * U + U / 2 + 12}" font-size="34" text-anchor="middle">${k + 1}</text>`;
  }
  return s;
}

const LETTER_SLOTS = {
  1: [[50, 52]], 2: [[30, 52], [70, 52]], 3: [[28, 34], [72, 34], [50, 72]], 4: [[30, 36], [70, 36], [30, 76], [70, 76]],
};
const slots9 = [[20, 30], [50, 30], [80, 30], [20, 56], [50, 56], [80, 56], [20, 82], [50, 82], [80, 82]];
function lettersSVG(cell, x, y) {
  const ps = marksOf(cell);
  if (!ps.length) return "";
  const k = ps.length, slots = k <= 4 ? LETTER_SLOTS[k] : slots9, size = k === 1 ? 62 : k <= 4 ? 44 : 32;
  return ps.map((p, i) => {
    const [sx, sy] = slots[i];
    const color = shade(personLook(p).color, 0.62);
    return `<text class="letter${p === G.sel ? " selp" : ""}" x="${x + sx}" y="${y + sy + size * 0.36}" font-size="${size}" fill="${color}" text-anchor="middle" stroke-width="${(size * 0.16).toFixed(1)}">${esc(initialOf(G.cs.people[p]))}</text>`;
  }).join("");
}

/* the parts that change with every move: marks, tokens, highlights */
function buildDyn() {
  const { cs, model } = G, n = cs.n, U = CELL;
  const xy = (cell) => [(cell % n) * U, Math.floor(cell / n) * U];
  const usedRows = new Set(), usedCols = new Set();
  G.pos.forEach((x) => { if (x >= 0) { usedRows.add(Math.floor(x / n)); usedCols.add(x % n); } });
  const conflicts = conflictSet();
  let s = "";
  if (save.settings.grey) {
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if ((usedRows.has(r) || usedCols.has(c)) && G.pos.indexOf(r * n + c) < 0) d += `M${c * U} ${r * U}h${U}v${U}h${-U}z`;
    if (d) s += `<path d="${d}" fill="${INK}" opacity=".26" pointer-events="none"/>`;
  }
  for (let cell = 0; cell < n * n; cell++) {
    if (model.blocked[cell] || G.pos.indexOf(cell) >= 0) continue;
    const [x, y] = xy(cell);
    if (G.marks.has(markKey(CROSS, cell))) s += `<rect x="${x + 3}" y="${y + 3}" width="${U - 6}" height="${U - 6}" fill="#fff" opacity=".35"/><path d="M${x + 24} ${y + 24}L${x + 76} ${y + 76}M${x + 76} ${y + 24}L${x + 24} ${y + 76}" stroke="${INK}" stroke-width="11" stroke-linecap="round" opacity=".75"/>`;
    s += lettersSVG(cell, x, y);
  }
  if (G.flash) for (const cell of G.flash) { const [x, y] = xy(cell); s += `<rect class="pulse" x="${x + 4}" y="${y + 4}" width="${U - 8}" height="${U - 8}" rx="8" fill="#ffd54a" fill-opacity=".4" stroke="#e08a00" stroke-width="7"/>`; }
  G.pos.forEach((cell, p) => {
    if (cell < 0) return;
    const [x, y] = xy(cell), look = personLook(p), victim = p === cs.victim;
    s += `<g transform="translate(${x + 6} ${y + 6}) scale(.88)" pointer-events="none">
      ${p === G.sel ? `<rect x="-5" y="-5" width="110" height="110" rx="20" fill="#fff" opacity=".9"/><rect x="-5" y="-5" width="110" height="110" rx="20" fill="none" stroke="#e08a00" stroke-width="8"/>` : ""}
      <rect width="100" height="100" rx="16" fill="${look.color}"/><g clip-path="url(#mfTok)">${bust(look, victim)}</g>
      <rect width="100" height="100" rx="16" fill="none" stroke="${conflicts.has(p) ? "#d64545" : INK}" stroke-width="${conflicts.has(p) ? 9 : 6}" ${conflicts.has(p) ? 'stroke-dasharray="14 8"' : ""}/>
      <circle cx="82" cy="82" r="15" fill="#fff" stroke="${INK}" stroke-width="4"/><text x="82" y="92" font-size="26" text-anchor="middle" font-weight="900" fill="${shade(look.color, 0.5)}">${esc(initialOf(cs.people[p]))}</text>
    </g>`;
  });
  const showCursor = G.cursor >= 0 && (G.kbd || G.hover === G.cursor);
  if (G.hover >= 0 && G.hover !== G.cursor) { const [x, y] = xy(G.hover); s += `<rect x="${x + 3}" y="${y + 3}" width="${U - 6}" height="${U - 6}" fill="#fff" opacity=".18" stroke="#fff" stroke-width="4" pointer-events="none"/>`; }
  if (G.cursor >= 0) { const [x, y] = xy(G.cursor); s += `<rect x="${x + 5}" y="${y + 5}" width="${U - 10}" height="${U - 10}" rx="8" fill="none" stroke="#e08a00" stroke-width="${showCursor ? 7 : 5}" stroke-dasharray="16 9" pointer-events="none"/>`; }
  if (G.won) { const [x, y] = xy(G.solution[G.won.murderer]); s += `<rect x="${x + 2}" y="${y + 2}" width="${U - 4}" height="${U - 4}" rx="8" fill="none" stroke="#d64545" stroke-width="9" pointer-events="none"/>`; }
  return s;
}

function renderBoard(rebuild = false) {
  const host = $("#mfBoardWrap");
  if (!host || !G) return;
  const { n, VBW, left, top } = boardGeometry();
  const scale = boardPixelWidth() / VBW;
  const key = [G.cs.id, lang, Math.round(boardPixelWidth() / 4)].join("|");
  if (rebuild || G.staticKey !== key || !host.firstChild) {
    G.staticKey = key; G.staticSVG = buildStatic(scale);
    host.innerHTML = `<svg class="mf-board" viewBox="${left} ${top} ${VBW} ${VBW}" role="application" aria-label="${esc(caseTitle(G.cs, lang))}" data-n="${n}">
      <defs><clipPath id="mfTok"><rect width="100" height="100" rx="16"/></clipPath></defs>
      <g id="mfStatic">${G.staticSVG}</g><g id="mfDyn"></g><g id="mfRing"></g></svg>`;
  }
  renderDyn();
}
function renderDyn() {
  const dyn = $("#mfDyn");
  if (dyn && G) dyn.innerHTML = buildDyn();
}

/* ---------------- pointer input on the board ---------------- */
function boardSvg() { return $("#mfBoardWrap .mf-board"); }
function cellFromPoint(clientX, clientY) {
  const svg = boardSvg();
  if (!svg || !G) return -1;
  const rect = svg.getBoundingClientRect(), { n, VBW } = boardGeometry(), k = rect.width / VBW;
  const x = (clientX - rect.left) / k - LM, y = (clientY - rect.top) / k - LM;
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  return r >= 0 && c >= 0 && r < n && c < n ? r * n + c : -1;
}
const cellPx = () => { const svg = boardSvg(); return svg && G ? svg.getBoundingClientRect().width / boardGeometry().VBW * CELL : 100; };

/* tooltip with the name of the object under the pointer */
function showTip(cell) {
  const tip = $("#mfTip");
  if (!tip || !G) return;
  const type = cell >= 0 ? G.model.objAt[cell] : null;
  if (!type) { tip.hidden = true; return; }
  const svg = boardSvg(), frame = svg.parentElement.parentElement.getBoundingClientRect(), r = svg.getBoundingClientRect();
  const { n, VBW } = boardGeometry(), k = r.width / VBW;
  // the whole object's top-centre, not just the cell
  const cells = G.cs.objects[G.model.objId[cell]][1];
  const rs = cells.map((x) => x[0]), cs2 = cells.map((x) => x[1]);
  const cx = (Math.min(...cs2) + Math.max(...cs2) + 1) / 2, ty = Math.min(...rs);
  tip.textContent = objName(type, lang);
  tip.hidden = false;
  tip.style.left = r.left - frame.left + (LM + cx * CELL) * k + "px";
  tip.style.top = r.top - frame.top + (LM + ty * CELL) * k - 6 + "px";
  void n;
}
function hideTip() { const tip = $("#mfTip"); if (tip) tip.hidden = true; }

/* ring that fills while a press-and-hold is on its way to placing a person */
function showRing(cell) {
  const g = $("#mfRing");
  if (!g || !G) return;
  const n = G.cs.n, x = (cell % n) * CELL + 50, y = Math.floor(cell / n) * CELL + 50;
  g.innerHTML = `<circle class="ring" cx="${x}" cy="${y}" r="38" fill="rgba(255,255,255,.35)" stroke="#e08a00" stroke-width="10" stroke-linecap="round" transform="rotate(-90 ${x} ${y})"/>`;
}
function hideRing() { const g = $("#mfRing"); if (g) g.innerHTML = ""; }

/* loupe: only while a hold is placing someone on small cells (phones) */
let loupe = null;
function updateLoupe(x, y) {
  const cell = cellFromPoint(x, y);
  if (cell < 0) { hideLoupe(); return; }
  const n = G.cs.n, r = Math.floor(cell / n), c = cell % n, span = CELL * 2.6;
  if (!loupe) { loupe = document.createElement("div"); loupe.className = "mf-loupe"; document.body.appendChild(loupe); }
  const src = boardSvg();
  loupe.innerHTML = `<svg viewBox="${c * CELL + CELL / 2 - span / 2} ${r * CELL + CELL / 2 - span / 2} ${span} ${span}" width="150" height="150" aria-hidden="true"><defs><clipPath id="mfTok"><rect width="100" height="100" rx="16"/></clipPath></defs>${$("#mfStatic", src).innerHTML}${$("#mfDyn", src).innerHTML}<rect fill="none" stroke="#e08a00" stroke-width="8" rx="8" x="${c * CELL + 4}" y="${r * CELL + 4}" width="${CELL - 8}" height="${CELL - 8}"/></svg><div class="cap">${esc(t("placedAt", { r: r + 1, c: c + 1 }))}</div>`;
  const left = Math.min(window.innerWidth - 166, Math.max(8, x - 83)), above = y - 215;
  loupe.style.left = left + "px";
  loupe.style.top = (above < 8 ? y + 80 : above) + "px";
}
function hideLoupe() { if (loupe) { loupe.remove(); loupe = null; } }

let press = null, lastTap = null;
function endPress() {
  hideLoupe(); hideRing();
  if (press) { clearTimeout(press.ringT); clearTimeout(press.holdT); press = null; }
}
function cellsBetween(x0, y0, x1, y1) {
  const out = [], step = Math.max(4, cellPx() / 4), dist = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= k; i++) { const c = cellFromPoint(x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k); if (c >= 0 && out[out.length - 1] !== c) out.push(c); }
  return out;
}
const useLoupe = (type) => type !== "mouse" && cellPx() < 56;

function onDown(e) {
  if (!G || G.status !== "playing" || e.button > 0 || !e.target.closest("#mfBoardWrap")) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (cell < 0) return;
  startClock();
  G.cursor = cell; G.kbd = false; G.msg = G.msg && !G.msgBad ? "" : G.msg;
  press = { cell0: cell, cur: cell, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, type: e.pointerType, mode: null, ringT: 0, holdT: 0 };
  const blocked = G.model.blocked[cell];
  if (G.notes) { // ✕ mode: nobody can be here (applies to everyone); dragging paints the same state over more cells
    if (blocked) return;
    press.mode = "cross"; snapshot();
    press.crossAdd = !G.marks.has(markKey(CROSS, cell));
    setCross(cell, press.crossAdd); renderDyn();
    return;
  }
  press.ringT = setTimeout(() => {
    if (!press) return;
    if (G.model.objAt[cell] && e.pointerType !== "mouse") showTip(cell);
    if (!press.mode && G.sel >= 0 && !blocked && personAt(cell) < 0) { showRing(cell); if (useLoupe(press.type)) updateLoupe(press.lastX, press.lastY); }
  }, RING_DELAY);
  if (G.sel >= 0 && !blocked && personAt(cell) < 0) {
    press.holdT = setTimeout(() => {
      if (!press || press.mode) return;
      if (placePerson(G.sel, cell)) { press.mode = "placed"; hideRing(); renderPlay(); if (useLoupe(press.type)) updateLoupe(press.lastX, press.lastY); }
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (error) { /* vibration is optional */ } }
    }, HOLD_MS);
  }
}
function setCross(cell, on) { const k = markKey(CROSS, cell); if (on) G.marks.add(k); else G.marks.delete(k); }
function addLetter(cell) { if (canWrite(cell)) G.marks.add(markKey(G.sel, cell)); }

function onMove(e) {
  if (!G) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!press) {
    if (e.pointerType === "mouse" && !document.querySelector(".mf-modal")) {
      if (cell !== G.hover) { G.hover = cell; renderDyn(); showTip(cell); }
    }
    return;
  }
  const from = { x: press.lastX, y: press.lastY };
  press.lastX = e.clientX; press.lastY = e.clientY;
  if (press.mode === "cross") {
    for (const c of cellsBetween(from.x, from.y, e.clientX, e.clientY)) if (c !== press.cur && !G.model.blocked[c]) { setCross(c, press.crossAdd); press.cur = c; G.cursor = c; }
    renderDyn(); return;
  }
  if (press.mode === "placed") { // after the hold: slide to adjust, the person follows the finger
    if (cell >= 0 && cell !== press.cur && !G.model.blocked[cell] && personAt(cell) < 0) {
      G.pos[G.sel] = cell; press.cur = cell; G.cursor = cell; renderDyn();
    }
    if (loupe || useLoupe(press.type)) updateLoupe(e.clientX, e.clientY);
    return;
  }
  if (press.mode === "swipe") {
    for (const c of cellsBetween(from.x, from.y, e.clientX, e.clientY)) { addLetter(c); press.cur = c; G.cursor = c; }
    renderDyn(); return;
  }
  // still undecided: a drag into another cell turns the press into a swipe
  if (G.sel >= 0 && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SWIPE_PX && cell >= 0 && cell !== press.cell0) {
    clearTimeout(press.ringT); clearTimeout(press.holdT); hideRing(); hideLoupe();
    press.mode = "swipe"; snapshot();
    addLetter(press.cell0);
    for (const c of cellsBetween(press.x, press.y, e.clientX, e.clientY)) { addLetter(c); press.cur = c; G.cursor = c; }
    renderDyn();
  }
}
function onUp(e) {
  if (!press) return;
  const pr = press;
  endPress();
  if (pr.mode === "cross" || pr.mode === "swipe" || pr.mode === "placed") { if (e.type !== "pointercancel") afterChange(); else renderPlay(); return; }
  if (e.type === "pointercancel") return;
  hideTip();
  handleTap(pr.cell0);
}
/* a plain tap */
function handleTap(cell) {
  if (G.notes) { afterChange(); return; }
  const occ = personAt(cell);
  if (G.sel < 0) {
    if (occ >= 0) G.sel = occ; else say(t("pickPerson"), false);
    afterChange(); return;
  }
  if (occ === G.sel) { unplacePerson(occ); afterChange(); return; }
  if (occ >= 0) { G.sel = occ; afterChange(); return; }
  if (G.model.blocked[cell]) { say(t("cannotStand", { o: objName(G.model.objAt[cell], lang) }), true); afterChange(); return; }
  const now = performance.now();
  if (lastTap && lastTap.cell === cell && lastTap.sel === G.sel && now - lastTap.t < DOUBLE_TAP_MS) { // double tap places
    if (G.undo.length === lastTap.undoLen) undoOnce();
    lastTap = null;
    placePerson(G.sel, cell); afterChange(); return;
  }
  snapshot(); toggleLetter(G.sel, cell);
  lastTap = { cell, t: now, sel: G.sel, undoLen: G.undo.length };
  afterChange();
}

function bindBoard() {
  document.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("blur", endPress);
  document.addEventListener("pointerleave", () => { if (G && G.hover >= 0) { G.hover = -1; renderDyn(); hideTip(); } });
  document.addEventListener("pointerover", (e) => { if (G && G.hover >= 0 && !e.target.closest("#mfBoardWrap")) { G.hover = -1; renderDyn(); hideTip(); } });
}

/* ---------------- eraser: tap = this cell's notes, hold = all notes ---------------- */
let eraser = null;
function bindEraser() {
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest('[data-act="erase"]');
    if (!btn || !G || G.status !== "playing") return;
    btn.classList.add("holding");
    eraser = { btn, done: false, timer: setTimeout(() => { eraser.done = true; btn.classList.remove("holding"); btn.classList.add("flash"); setTimeout(() => btn.classList.remove("flash"), 500); eraseAll(); afterChange(); }, ERASE_ALL_MS) };
  });
  const release = () => {
    if (!eraser) return;
    const er = eraser; eraser = null;
    clearTimeout(er.timer); er.btn.classList.remove("holding");
    if (!er.done) { eraseCell(G.cursor >= 0 ? G.cursor : -1); afterChange(); }
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", () => { if (eraser) { clearTimeout(eraser.timer); eraser.btn.classList.remove("holding"); eraser = null; } });
}

/* ---------------- click handlers (delegated) ---------------- */
function bindClicks() {
  document.addEventListener("click", async (e) => {
    const el = e.target;
    const filter = el.closest("[data-filter]");
    if (filter) { save = { ...save, settings: { ...save.settings, filter: filter.dataset.filter } }; persist(); renderList(); return; }
    const card = el.closest("[data-case]");
    if (card) { openCase(card.dataset.case); return; }
    const langBtn = el.closest("[data-lang]");
    if (langBtn) { setLang(langBtn.dataset.lang); return; }
    if (el.closest("#mfHelp")) { showRules(); return; }
    if (!G) return;
    const act = el.closest("[data-act]")?.dataset.act;
    if (act === "erase") return; // pointer handlers (tap / hold)
    if (act === "cases") { leaveCase(); return; }
    if (act === "undo") { undoOnce(); afterChange(); return; }
    if (act === "hint") { useHint(); return; }
    if (act === "cross") { G.notes = !G.notes; G.msg = ""; renderPlay(); return; }
    if (act === "check") { check(); return; }
    if (act === "how") { showRules(); return; }
    if (act === "reset") { if (await askConfirm(t("confirmReset"))) resetCase(); return; }
    if (act === "placehint") {
      const h = G.hint;
      if (h && placePerson(h.person, h.cell)) { G.hint = null; G.flash = null; afterChange(); }
      return;
    }
    const clueBtn = el.closest("[data-clue]");
    if (clueBtn) { const [p, ci] = clueBtn.dataset.clue.split(":").map(Number); G.sel = p; flashClue(G.cs.people[p].clues[ci], p); renderPlay(); return; }
    const roomBtn = el.closest("[data-room]");
    if (roomBtn) { flash(G.model.roomCells[Number(roomBtn.dataset.room)]); renderDyn(); return; }
    const chip = el.closest("[data-p]");
    if (chip && G.status === "playing") { select(Number(chip.dataset.p)); startClock(); renderPlay(); return; }
  });
  document.addEventListener("change", (e) => {
    const set = e.target.closest("[data-set]");
    if (!set || !G) return;
    save = { ...save, settings: { ...save.settings, [set.dataset.set]: set.checked } };
    persist();
    renderPlay();
  });
}
/* what a clue talks about, lit up on the board */
function flashClue(clue, p) {
  const m = G.model, cells = [];
  for (let i = 0; i < m.N; i++) {
    let hit = false;
    if (clue.t === "in" || clue.t === "notin") hit = m.room[i] === clue.room;
    else if (clue.t === "near" || clue.t === "notnear" || clue.t === "on") hit = m.objAt[i] === clue.obj;
    else if (clue.t === "row") hit = m.row[i] === clue.k;
    else if (clue.t === "col") hit = m.col[i] === clue.k;
    else if (clue.p !== undefined) hit = i === G.pos[clue.p];
    else if (clue.t === "alone" || clue.t === "victim") hit = G.pos[p] >= 0 && m.room[i] === m.room[G.pos[p]];
    if (hit) cells.push(i);
  }
  flash(cells);
}
function resetCase() {
  const cs = G.cs;
  clearWip(); clearTimeout(G.flashTimer);
  G = newGame(cs);
  renderPlay(); startClock();
}

/* ---------------- keyboard ---------------- */
function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (!G || e.altKey || document.querySelector(".mf-modal")) { if (e.key === "Escape") closeModal(); return; }
    if (e.target.closest("input,textarea,select")) return;
    const n = G.cs.n, k = e.key, lower = k.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && lower === "z") { e.preventDefault(); undoOnce(); afterChange(); return; }
    if (e.ctrlKey || e.metaKey) return;
    const target = G.hover >= 0 ? G.hover : G.cursor;
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (move) {
      e.preventDefault();
      const base = G.cursor >= 0 ? G.cursor : Math.floor(n / 2) * n + Math.floor(n / 2);
      const r = Math.min(n - 1, Math.max(0, Math.floor(base / n) + move[0])), c = Math.min(n - 1, Math.max(0, (base % n) + move[1]));
      G.cursor = r * n + c; G.hover = -1; G.kbd = true; renderDyn(); return;
    }
    if (/^[1-9]$/.test(k) && Number(k) <= G.cs.people.length) { G.sel = Number(k) - 1; G.kbd = true; startClock(); renderPlay(); return; }
    if (k === "Enter" && e.shiftKey) { check(); return; }
    if ((k === "Enter" || k === " ") && !e.target.closest("button") && target >= 0 && G.sel >= 0) {
      e.preventDefault(); G.cursor = target;
      if (personAt(target) === G.sel) unplacePerson(G.sel); else if (personAt(target) < 0) placePerson(G.sel, target);
      afterChange(); return;
    }
    if (k === "Backspace" || k === "Delete") { if (target >= 0) { eraseCell(target); const p = personAt(target); if (p >= 0 && !marksOf(target).length && false) unplacePerson(p); afterChange(); } return; }
    if (k === "Escape") { G.sel = -1; G.hint = null; renderPlay(); return; }
    if (k === "?") { useHint(); return; }
    if (lower === "x") { G.notes = !G.notes; renderPlay(); return; }
    if (/^[a-zà-ÿ]$/i.test(k)) { // a person's letter writes a pencil note on the cell under the mouse
      const p = G.cs.people.findIndex((x) => initialOf(x) === k.toUpperCase());
      if (p >= 0 && target >= 0 && canWrite(target)) { snapshot(); toggleLetter(p, target); afterChange(); }
    }
  });
}

/* ---------------- dialogs ---------------- */
function closeModal() { const host = $("#modalHost"); host.innerHTML = ""; if (G && G.status === "playing") startClock(); }
function openModal(html, { onClose } = {}) {
  stopClock();
  const host = $("#modalHost");
  host.innerHTML = `<div class="mf-modal" role="dialog" aria-modal="true"><div class="mf-box">${html}</div></div>`;
  const modal = host.firstElementChild;
  modal.addEventListener("click", (e) => { if (e.target === modal && onClose !== false) closeModal(); });
  const first = modal.querySelector("button");
  if (first) first.focus({ preventScroll: true });
  modal.querySelector(".mf-box").scrollTop = 0;
  return modal;
}
function askConfirm(text) {
  return new Promise((resolve) => {
    const modal = openModal(`<p>${esc(text)}</p><div class="mf-btns"><button type="button" class="mf-btn" data-v="1">${esc(t("yes"))}</button><button type="button" class="mf-btn alt" data-v="0">${esc(t("no"))}</button></div>`);
    modal.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) { closeModal(); resolve(b.dataset.v === "1"); } else if (e.target === modal) resolve(false);
    });
  });
}
function demoBeside() {
  const sample = { skin: "#f3c7a0", hair: "#5b3a22", style: 0, beard: 0, glasses: 0, age: 1, female: false, shirt: "#2b4c7e", outfit: 0, earring: 0, freckles: false, color: "#5aa2e0" };
  let s = `<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><defs><clipPath id="mfDemoClip"><rect width="100" height="100" rx="16"/></clipPath></defs>`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += `<rect x="${c * 32 + 1}" y="${r * 32 + 1}" width="30" height="30" rx="4" fill="${r === 1 && c === 1 ? "#cfe2ff" : "#ffe08a"}" stroke="${INK}" stroke-width="1.5"/>`;
  s += `<g transform="translate(35 35) scale(.26)"><rect width="100" height="100" rx="16" fill="${sample.color}"/><g clip-path="url(#mfDemoClip)">${bust(sample)}</g><rect width="100" height="100" rx="16" fill="none" stroke="${INK}" stroke-width="6"/></g>`;
  s += `<g transform="translate(1 1) scale(.3)">${objectSVG("tree", [[0, 0]], 1)}</g></svg>`;
  return s;
}
function showRules() {
  const rules = UI.rules.map((r) => `<li>${r[lang]}</li>`).join("");
  const blk = ["table", "car", "shelf", "barrel"], std = ["chair", "sofa", "bench", "bed", "stain"];
  const modal = openModal(`<h2>${esc(t("rulesTitle"))} 🔎</h2>
    <ol class="mf-rules">${rules}</ol>
    <div class="mf-demo"><div class="icons">${blk.map((x) => objectIcon(x, 38).replace('class="mf-icon"', 'class="mf-icon blk"')).join("")}</div><div class="cap">${esc(t("legendBlock"))}</div></div>
    <div class="mf-demo"><div class="icons">${std.map((x) => objectIcon(x, 38).replace('class="mf-icon"', 'class="mf-icon std"')).join("")}</div><div class="cap">${esc(t("legendStand"))}</div></div>
    <div class="mf-demo">${demoBeside()}<div class="cap">${esc(lang === "lb" ? "Niewendrun: déi 8 Felder ronderëm (gielen)." : lang === "de" ? "Daneben: die 8 umliegenden Felder (gelb)." : "Beside: the 8 surrounding cells (yellow).")}</div></div>
    <div class="mf-btns"><button type="button" class="mf-btn" id="mfRulesOk">${esc(t("gotIt"))}</button></div>`);
  $("#mfRulesOk", modal).addEventListener("click", () => {
    closeModal();
    if (!save.seen && !TEST_MODE) { save = { ...save, seen: true }; persist(); }
  });
}
function showWin() {
  const w = G.won, cs = G.cs, m = w.murderer, p = cs.people[m];
  const next = (() => {
    const i = cases.findIndex((c) => c.id === cs.id);
    for (let k = 1; k <= cases.length; k++) { const c = cases[(i + k) % cases.length]; if (!save.done[c.id]) return c; }
    return cases[(i + 1) % cases.length];
  })();
  const modal = openModal(`<div class="mf-win">
      <div class="big"><div class="pt" style="background:${personLook(m).color}">${portrait(personLook(m))}</div><span class="lens" aria-hidden="true">🔎</span></div>
      <h2>${esc(t("win"))}</h2>
      <p class="who">${esc(t("murdererIs", { name: p.name }))}</p>
      <p class="story">${esc(storyText(cs, lang, m))}</p>
      <div class="mf-stats"><div><b>${fmtTime(w.seconds)}</b><span>${esc(t("time"))}</span></div><div><b>${G.hints}</b><span>${esc(t("hintsUsed"))}</span></div><div><b>${w.pts}</b><span>${esc(t("points"))}</span></div></div>
      ${w.newBest ? `<p class="mf-new">${esc(t("newBest"))}</p>` : ""}
      <div class="mf-btns" style="justify-content:center">
        <button type="button" class="mf-btn" data-win="next">${esc(t("nextCase"))}</button>
        <button type="button" class="mf-btn alt" data-win="again">${esc(t("replay"))}</button>
        <button type="button" class="mf-btn alt" data-win="list">${esc(t("allCases"))}</button>
      </div></div>`, { onClose: true });
  modal.addEventListener("click", (e) => {
    const b = e.target.closest("[data-win]");
    if (!b) return;
    const what = b.dataset.win;
    if (what === "next") openCase(next.id);
    else if (what === "again") { const id = cs.id; closeModal(); G = null; openCase(id); }
    else { closeModal(); leaveCase(); }
  });
}

/* ---------------- language ---------------- */
function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch (error) { console.warn("[mordsfall] could not remember the language", error); }
  applyLang();
}
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("#mfLangs [data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  const help = $("#mfHelp");
  if (help) { help.textContent = "? " + t("how"); help.setAttribute("aria-label", t("how")); }
  if (G) renderPlay(); else renderList();
}

/* ---------------- boot ---------------- */
function tickClock() { if (!G) return; const el = $("#mfClock"); if (el) el.textContent = fmtTime(clock()); }
function boot() {
  const defs = $("#mfDefs");
  if (defs) defs.innerHTML = `<defs>${FLOOR_DEFS}</defs>`;
  bindClicks(); bindBoard(); bindKeys(); bindEraser();
  setInterval(tickClock, 500);
  document.addEventListener("visibilitychange", () => {
    if (!G) return;
    if (document.hidden) { stopClock(); saveWip(); } else if (!document.querySelector(".mf-modal")) startClock();
  });
  window.addEventListener("pagehide", () => { if (G) { stopClock(); saveWip(); } });
  let lastW = 0;
  new ResizeObserver(() => { const w = boardPixelWidth(); if (G && Math.abs(w - lastW) > 2) { lastW = w; renderBoard(); } }).observe(document.body);
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => { if (G) askConfirm(t("confirmReset")).then((ok) => { if (ok) resetCase(); }); else location.reload(); });
  applyLang();
  const wanted = new URLSearchParams(location.search).get("case");
  if (wanted && !openCase(wanted)) console.warn("[mordsfall] unknown case", wanted);
  if (!save.seen && !TEST_MODE && !wanted) showRules();
}

/* Test hook (used by scripts/flows/mordsfall.mjs): drives the same code paths as taps do. */
window.__mordsfall = {
  cases, openCase,
  state: () => G && { id: G.cs.id, status: G.status, pos: [...G.pos], solution: [...G.solution], murderer: murdererOf(G.model, G.solution), names: G.cs.people.map((x) => x.name), hints: G.hints, won: G.won, sel: G.sel, marks: [...G.marks], cursor: G.cursor, notes: G.notes },
  reset: () => resetCase(),
  blockedCell: () => G.model.blocked.findIndex((b) => b === 1),
  freeCell: () => G.model.blocked.findIndex((b, i) => !b && G.solution.indexOf(i) < 0),
  swap: (a, b) => { const x = G.pos[a]; G.pos[a] = G.pos[b]; G.pos[b] = x; renderPlay(); },
  sharesVictimRoom: () => { const m = G.model, v = G.solution[G.cs.victim]; return G.cs.people[G.solution.findIndex((x, i) => i !== G.cs.victim && m.room[x] === m.room[v])].name; },
  /* free cells in one row that nobody needs (for the swipe test): returns `count` neighbouring writable cells */
  rowCells: (count) => { const n = G.cs.n; for (let r = 0; r < n; r++) for (let c = 0; c + count <= n; c++) { const cells = Array.from({ length: count }, (_, k) => r * n + c + k); if (cells.every((x) => canWrite(x))) return cells; } return []; },
  placeAll: (order) => { (order || G.cs.people.map((_, i) => i)).forEach((p) => { G.pos[p] = G.solution[p]; }); renderPlay(); },
  solve() { // places every person on the correct cell through the normal operations, then checks
    G.pos.fill(-1); G.marks = new Set();
    G.cs.people.forEach((_, p) => { placePerson(p, G.solution[p]); });
    renderPlay(); check();
  },
};
boot();
