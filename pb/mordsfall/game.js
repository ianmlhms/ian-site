/* Mordsfall — the game screen: case list, board, suspects, hints, win.
 * Rules engine: solver.js · words: text.js · pictures: art.js · cases: cases.js (generated, see scripts/mordsfall_gen.mjs). */
import cases from "./cases.js?v=2";
import { SCENES } from "./scenes.js?v=2";
import { buildModel, clueHolds, hint as solverHint, murdererOf } from "./solver.js?v=2";
import { T, clueText, storyText, caseTitle, roomName, objName, OBJECTS, TIER_KEYS, LANGS, UI, personRef } from "./text.js?v=2";
import { avatarBadge, avatar, lookOf, objectArt, objectIcon, caseThumb } from "./art.js?v=2";

const TEST_MODE = window.__pbTestMode === true; // owner test mode: nothing is read from or written to storage, nothing reaches a leaderboard
const SAVE_KEY = "pb_save_mordsfall";
const LANG_KEY = "site_lang";
const BASE_POINTS = [100, 200, 300, 400, 500];
const PAR_SECONDS = [150, 300, 480, 720, 1000];
const HINT_PENALTY = { deduce: 30, reveal: 60, conflict: 60 };
const WRONG_CHECK_PENALTY = 15;
const UNDO_LIMIT = 300;
const FLASH_MS = 2200;
const LABEL_MARGIN = 40;
const CELL = 100;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sceneOf = (cs) => SCENES.find((s) => s.id === cs.scene);
const fmtTime = (sec) => { const s = Math.max(0, Math.floor(sec)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

/* ---------------- storage ---------------- */
function freshSave() { return { v: 1, done: {}, wip: null, settings: { grey: true, tick: true, timer: true, filter: "all" }, seen: false }; }
function cleanNumber(x, min, max) { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; }
function loadSave() {
  const save = freshSave();
  if (TEST_MODE) return save;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); }
  catch (error) { console.warn("[mordsfall] saved progress is unreadable, starting fresh", error); return save; }
  if (!raw || typeof raw !== "object") return save;
  const known = new Set(cases.map((c) => c.id));
  for (const [id, entry] of Object.entries(raw.done || {})) {
    if (!known.has(id) || !entry || typeof entry !== "object") continue;
    const t = cleanNumber(entry.t, 1, 86400), pts = cleanNumber(entry.pts, 0, 100000);
    if (t === null || pts === null) continue;
    save.done[id] = { t: Math.round(t), pts: Math.round(pts), n: Math.max(1, Math.round(cleanNumber(entry.n, 1, 100000) ?? 1)) };
  }
  const s = raw.settings || {};
  save.settings = { grey: s.grey !== false, tick: s.tick !== false, timer: s.timer !== false, filter: ["all", ...TIER_KEYS].includes(s.filter) ? s.filter : "all" };
  save.seen = raw.seen === true;
  const w = raw.wip;
  if (w && known.has(w.id) && Array.isArray(w.pos) && Array.isArray(w.marks)) {
    const cs = cases.find((c) => c.id === w.id), N = cs.n * cs.n;
    const posOk = w.pos.length === cs.people.length && w.pos.every((x) => Number.isInteger(x) && x >= -1 && x < N);
    const t = cleanNumber(w.t, 0, 86400), hints = cleanNumber(w.hints, 0, 1000);
    if (posOk && t !== null && hints !== null) save.wip = { id: w.id, pos: w.pos, marks: w.marks.filter((k) => typeof k === "string" && /^-?\d+:\d+$/.test(k)), t, hints };
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
function newGame(cs) {
  const model = buildModel(cs);
  return {
    cs, model, solution: cs.sol.map(([r, c]) => r * cs.n + c),
    pos: cs.people.map(() => -1), marks: new Set(), sel: -1, notes: false, cursor: Math.floor(cs.n / 2) * cs.n + Math.floor(cs.n / 2), kbd: false,
    undo: [], elapsed: 0, running: false, tick: 0, hints: 0, status: "playing",
    msg: "", msgBad: false, hint: null, flash: null, flashTimer: 0, drag: null, won: null,
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
function placePerson(p, cell) {
  if (G.model.blocked[cell]) { say(t("cannotStand", { o: objName(G.model.objAt[cell], lang) }), true); return false; }
  snapshot();
  G.pos[p] = cell;
  G.marks.delete(markKey(p, cell));
  G.hint = null; G.msg = "";
  return true;
}
function unplacePerson(p) { snapshot(); G.pos[p] = -1; G.hint = null; G.msg = ""; }
function toggleMark(p, cell) {
  if (G.model.blocked[cell]) return;
  snapshot();
  const k = markKey(p, cell);
  if (G.marks.has(k)) G.marks.delete(k); else G.marks.add(k);
}
function undo() {
  const last = G.undo.pop();
  if (!last) return;
  G.pos = last.pos; G.marks = new Set(last.marks); G.hint = null; G.msg = "";
}
function select(p) { G.sel = G.sel === p ? -1 : p; G.msg = ""; }

function tapCell(cell) {
  if (G.status !== "playing") return;
  startClock();
  G.cursor = cell;
  const occ = personAt(cell);
  if (G.notes) {
    if (G.sel < 0 && occ < 0) toggleMark(-1, cell);
    else if (G.sel >= 0 && occ < 0) toggleMark(G.sel, cell);
    else if (occ >= 0) select(occ);
  } else if (occ >= 0) {
    if (occ === G.sel) unplacePerson(occ); else { G.sel = occ; G.msg = ""; }
  } else if (G.sel < 0) {
    say(t("pickPerson"), false);
  } else {
    placePerson(G.sel, cell);
  }
  afterChange();
}

function afterChange() {
  saveWip();
  renderPlay();
}

/* conflicts: two people on the same row or column */
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
  G.flashTimer = setTimeout(() => { if (G) { G.flash = null; renderBoard(); } }, FLASH_MS);
}

function pointsFor(diff, seconds) {
  return Math.round(BASE_POINTS[diff] * (0.5 + 0.5 * Math.max(0, 1 - seconds / PAR_SECONDS[diff])));
}
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
    save = { ...save, done: { ...save.done, [cs.id]: entry } }; // kept in memory only so the list can show the tick
  }
  G.sel = -1; G.hint = null; G.msg = "";
  renderPlay();
  showWin();
}

/* ---------------- list view ---------------- */
function renderList() {
  const done = Object.keys(save.done).length;
  const filter = save.settings.filter;
  const shown = cases.filter((c) => filter === "all" || c.id.startsWith(filter));
  $("#listView").innerHTML = `
    <div class="mf-hero">
      <div><h2>${esc(t("title"))} 🔎</h2><p>${esc(t("subtitle"))}</p></div>
      <div class="mf-prog">${t("progress", { n: "<b>" + done + "</b>", t: cases.length, p: "<b>" + totalPoints() + "</b>" })}</div>
    </div>
    ${TEST_MODE ? `<span class="mf-vtag mf-test">${esc(t("testBadge"))}</span>` : ""}
    <div class="mf-filters" role="group" aria-label="${esc(t("cases"))}">
      ${["all", ...TIER_KEYS].map((k) => `<button type="button" class="mf-chip" data-filter="${k}" aria-pressed="${k === filter}">${esc(k === "all" ? t("filterAll") : t("tier_" + k))}</button>`).join("")}
    </div>
    <div class="mf-grid">${shown.map(cardHTML).join("")}</div>`;
}
function cardHTML(cs) {
  const d = save.done[cs.id], sc = sceneOf(cs);
  return `<button type="button" class="mf-card${d ? " solved" : ""}" data-case="${cs.id}" aria-label="${esc(caseTitle(cs, lang))}">
    ${caseThumb(cs, { size: 92 })}
    <span class="tx">
      <span class="ti">${esc(caseTitle(cs, lang))}</span>
      <span class="me"><span class="mf-tag t${cs.diff}">${esc(t("tier_" + TIER_KEYS[cs.diff]))}</span> ${cs.n}×${cs.n}<br>${sc.emoji} ${esc(sc.name[lang])}${d ? `<br>${esc(t("best"))} ${fmtTime(d.t)}` : ""}</span>
    </span>${d ? `<span class="mf-done" aria-label="${esc(t("solved"))}">✓</span>` : ""}</button>`;
}

/* ---------------- play view ---------------- */
function openCase(id) {
  const cs = cases.find((c) => c.id === id);
  if (!cs) return false;
  closeModal();
  G = newGame(cs);
  const w = save.wip;
  if (w && w.id === id && !TEST_MODE) {
    G.pos = [...w.pos]; G.marks = new Set(w.marks); G.elapsed = w.t; G.hints = w.hints;
  }
  $("#listView").hidden = true;
  $("#playView").hidden = false;
  window.scrollTo(0, 0);
  renderPlay();
  if (G.pos.every((x) => x < 0) && G.elapsed === 0) G.elapsed = 0;
  startClock();
  return true;
}
function leaveCase() {
  if (G) { stopClock(); saveWip(); clearTimeout(G.flashTimer); }
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
function drawPlay() {
  const cs = G.cs, sc = sceneOf(cs);
  const view = $("#playView");
  const allPlaced = placedCount() === cs.people.length;
  view.className = save.settings.tick ? "" : "mf-noassist";
  view.innerHTML = `
    <div class="mf-top">
      <button type="button" class="mf-back" data-act="cases">${esc(t("cases2"))}</button>
      <div class="mf-ttl">${sc.emoji} ${esc(caseTitle(cs, lang))}<small>${esc(t("tier_" + TIER_KEYS[cs.diff]))} · ${cs.n}×${cs.n} · ${esc(sc.name[lang])}</small></div>
      <div class="mf-clock" id="mfClock" ${save.settings.timer ? "" : "hidden"} role="timer" aria-label="${esc(t("time"))}">${fmtTime(clock())}</div>
    </div>
    <div class="mf-play">
      <div class="mf-boardcol">
        <div class="mf-tools">
          <button type="button" class="mf-tool" data-act="undo" ${G.undo.length ? "" : "disabled"} aria-label="${esc(t("undo"))} (U)">↶ ${esc(t("undo"))}</button>
          <button type="button" class="mf-tool" data-act="hint" aria-label="${esc(t("hint"))} (H)">💡 ${esc(t("hint"))}</button>
          <button type="button" class="mf-tool" data-act="notes" aria-pressed="${G.notes}" aria-label="${esc(t("notes"))} (N)">✕ ${esc(t("notes"))}</button>
          <button type="button" class="mf-tool${allPlaced ? " go" : ""}" data-act="check" aria-label="${esc(t("check"))} (C)">✓ ${esc(t("check"))}</button>
        </div>
        <p class="mf-msg${G.msgBad ? " bad" : ""}" role="status" aria-live="polite">${G.notes && !G.msg ? esc(t("notesOn")) : esc(G.msg)}</p>
        ${hintHTML()}
        <div class="mf-tray" role="group" aria-label="${esc(t("suspects"))}">${cs.people.map(chipHTML).join("")}</div>
        <div class="mf-selpanel">${selPanelHTML()}</div>
        <div class="mf-boardwrap" id="mfBoardWrap"></div>
        <div class="mf-below">
          <div class="mf-rooms" aria-label="${esc(t("rooms"))}">${cs.rooms.map((r, i) => `<button type="button" class="mf-roomchip" data-room="${i}"><i style="background:var(--mf-r${i % 10})"></i>${esc(r[lang])}</button>`).join("")}</div>
          ${legendHTML()}
        </div>
      </div>
      <aside class="mf-side">
        <h3>${esc(t("suspects"))}</h3>
        <div class="mf-people">${cs.people.map(personCardHTML).join("")}</div>
        <details class="mf-set">
          <summary>⚙ ${esc(t("reset"))} / …</summary>
          <label class="mf-toggle"><input type="checkbox" data-set="grey" ${save.settings.grey ? "checked" : ""}> ${esc(t("autoGrey"))}</label>
          <label class="mf-toggle"><input type="checkbox" data-set="tick" ${save.settings.tick ? "checked" : ""}> ${esc(t("assistTick"))}</label>
          <label class="mf-toggle"><input type="checkbox" data-set="timer" ${save.settings.timer ? "checked" : ""}> ${esc(t("timeShown"))}</label>
          <div class="mf-btns"><button type="button" class="mf-btn alt" data-act="reset">${esc(t("reset"))}</button></div>
        </details>
      </aside>
    </div>`;
  renderBoard();
}

function hintHTML() {
  const h = G.hint;
  if (!h) return "";
  const p = G.cs.people[h.person];
  if (h.kind === "reveal") return `<div class="mf-hintbox"><p>${esc(t("hintReveal", { name: p.name, r: h.row, c: h.col }))}</p><button type="button" data-act="placehint">${esc(t("hintPlace"))}</button></div>`;
  const lines = reasonLines(h);
  return `<div class="mf-hintbox"><p>${esc(t("hintDeduce", { name: p.name, r: h.row, c: h.col }))}</p>${lines.length ? `<p>${esc(t("hintBecause"))}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}<button type="button" data-act="placehint">${esc(t("hintPlace"))}</button></div>`;
}

function personLook(p) { return lookOf(G.cs.people[p], p); }
function chipHTML(person, p) {
  const placed = G.pos[p] >= 0, victim = p === G.cs.victim;
  return `<button type="button" class="mf-pchip${placed ? " placed" : ""}" data-p="${p}" aria-pressed="${G.sel === p}" aria-label="${esc(person.name)}${victim ? " (" + esc(t("victim")) + ")" : ""}">
    ${avatarBadge(personLook(p), { size: 36, victim })}<span class="nm">${esc(person.name)}</span>${placed ? '<span class="ck" aria-hidden="true">✓</span>' : ""}${victim ? '<span class="vi" aria-hidden="true">👼</span>' : ""}</button>`;
}
function cluesHTML(p) {
  const cs = G.cs, person = cs.people[p];
  if (!person.clues.length) return `<ul class="mf-clues"><li><span class="empty" style="color:var(--muted)">${esc(t("cluesNone"))}</span></li></ul>`;
  return `<ul class="mf-clues">${person.clues.map((cl, ci) => {
    const ok = save.settings.tick && clueHolds(G.model, cl, p, G.pos) === true;
    return `<li><button type="button" data-clue="${p}:${ci}"><span class="mf-tk${ok ? " on" : ""}" aria-hidden="true">✓</span><span>${esc(clueText(cs, cl, lang))}${ok ? `<span class="sr"> ✓</span>` : ""}</span></button></li>`;
  }).join("")}</ul>`;
}
function posLabel(p) {
  const x = G.pos[p], n = G.cs.n;
  return x < 0 ? t("notPlaced") : t("placedAt", { r: Math.floor(x / n) + 1, c: (x % n) + 1 });
}
function selPanelHTML() {
  if (G.sel < 0) return `<div class="empty" style="color:var(--muted)">${esc(t("selectedNone"))}</div>`;
  const p = G.sel, person = G.cs.people[p];
  return `<div class="hd">${avatarBadge(personLook(p), { size: 34, victim: p === G.cs.victim })}<span>${esc(person.name)}</span>${p === G.cs.victim ? `<span class="mf-vtag">${esc(t("victim"))}</span>` : ""}<span class="pos" style="font-weight:600;color:var(--muted);font-size:12.5px">${esc(posLabel(p))}</span></div>${cluesHTML(p)}`;
}
function personCardHTML(person, p) {
  const victim = p === G.cs.victim;
  return `<div class="mf-person" role="group" data-card="${p}">
    <button type="button" class="hd" data-p="${p}" style="all:unset;cursor:pointer;display:flex;gap:10px;align-items:center;font-weight:800;min-height:44px;width:100%" aria-pressed="${G.sel === p}">
      ${avatarBadge(personLook(p), { size: 40, victim })}
      <span>${esc(person.name)} ${victim ? `<span class="mf-vtag">${esc(t("victim"))}</span>` : ""}<br><span class="pos">${esc(posLabel(p))}</span></span>
    </button>${cluesHTML(p)}</div>`;
}
function legendHTML() {
  const types = [...new Set(G.cs.objects.map((o) => o[2]))];
  const blk = types.filter((x) => OBJECTS[x].block), std = types.filter((x) => !OBJECTS[x].block);
  const grp = (title, list, cls) => list.length ? `<div class="grp"><span class="gt">${esc(title)}</span>${list.map((x) => `<span class="it">${objectIcon(x, 30).replace('class="mf-icon"', `class="mf-icon ${cls}"`)}${esc(objName(x, lang))}</span>`).join("")}</div>` : "";
  return `<div class="mf-legend" aria-label="${esc(t("legend"))}">${grp(t("legendBlock"), blk, "blk")}${grp(t("legendStand"), std, "std")}</div>`;
}

/* ---------------- board drawing ---------------- */
function boardPixelWidth() { const w = $("#mfBoardWrap"); return w && w.clientWidth ? w.clientWidth : 360; }
function renderBoard() {
  const host = $("#mfBoardWrap");
  if (!host || !G) return;
  const { cs, model } = G, n = cs.n, U = CELL, LM = LABEL_MARGIN;
  const VB = n * U + LM + 10;
  const scale = boardPixelWidth() / VB;
  const room = (r, c) => model.room[r * n + c];
  const usedRows = new Set(), usedCols = new Set();
  G.pos.forEach((x) => { if (x >= 0) { usedRows.add(Math.floor(x / n)); usedCols.add(x % n); } });
  const conflicts = conflictSet();
  let s = `<svg class="mf-board" viewBox="${-LM} ${-LM} ${VB} ${VB}" role="application" aria-label="${esc(caseTitle(cs, lang))}" data-n="${n}">
    <defs><clipPath id="mfClip"><circle cx="50" cy="50" r="46"/></clipPath>
    <pattern id="mfHatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="none"/><rect width="5" height="14" fill="#000" opacity=".16"/></pattern></defs>`;
  // axis labels + north marker
  for (let k = 0; k < n; k++) {
    s += `<text class="lbl" x="${k * U + U / 2}" y="${-LM / 2 + 9}" font-size="26" text-anchor="middle">${k + 1}</text>`;
    s += `<text class="lbl" x="${-LM / 2 - 1}" y="${k * U + U / 2 + 9}" font-size="26" text-anchor="middle">${k + 1}</text>`;
  }
  // cells
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    s += `<rect x="${c * U}" y="${r * U}" width="${U}" height="${U}" fill="var(--mf-r${room(r, c) % 10})"/>`;
    if (model.blocked[i]) s += `<rect x="${c * U}" y="${r * U}" width="${U}" height="${U}" fill="url(#mfHatch)"/>`;
  }
  // objects
  for (const [r, c, type] of cs.objects) s += objectArt(type, c * U + 6, r * U + 4, U - 12);
  // rows / columns already used
  if (save.settings.grey) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if ((usedRows.has(r) || usedCols.has(c)) && G.pos.indexOf(r * n + c) < 0) s += `<rect x="${c * U}" y="${r * U}" width="${U}" height="${U}" fill="var(--mf-used)" pointer-events="none"/>`;
    }
  }
  // thin grid then thick walls
  let thin = "", walls = "";
  for (let k = 1; k < n; k++) thin += `M${k * U} 0V${n * U}M0 ${k * U}H${n * U}`;
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
    const a = r > 0 ? room(r - 1, c) : -1, b = r < n ? room(r, c) : -1;
    if (a !== b) walls += `M${c * U} ${r * U}H${(c + 1) * U}`;
  }
  for (let c = 0; c <= n; c++) for (let r = 0; r < n; r++) {
    const a = c > 0 ? room(r, c - 1) : -1, b = c < n ? room(r, c) : -1;
    if (a !== b) walls += `M${c * U} ${r * U}V${(r + 1) * U}`;
  }
  s += `<path d="${thin}" stroke="var(--mf-grid)" stroke-width="2" fill="none"/><path d="${walls}" stroke="var(--mf-wall)" stroke-width="9" stroke-linecap="square" fill="none"/>`;
  // crossed-out cells
  const selMarks = [];
  for (const k of G.marks) {
    const [p, cell] = k.split(":").map(Number);
    const x = (cell % n) * U, y = Math.floor(cell / n) * U;
    if (p === -1) s += `<path class="mark" d="M${x + 24} ${y + 24}L${x + 76} ${y + 76}M${x + 76} ${y + 24}L${x + 24} ${y + 76}" stroke="var(--muted)" stroke-width="9" stroke-linecap="round" opacity=".75" pointer-events="none"/>`;
    else if (p === G.sel && G.pos.indexOf(cell) < 0) selMarks.push([p, x, y]);
  }
  for (const [p, x, y] of selMarks) s += `<path class="mark" d="M${x + 30} ${y + 30}L${x + 70} ${y + 70}M${x + 70} ${y + 30}L${x + 30} ${y + 70}" stroke="${personLook(p).shirt}" stroke-width="10" stroke-linecap="round" opacity=".85" pointer-events="none"/>`;
  // flash highlight
  if (G.flash) for (const cell of G.flash) {
    const x = (cell % n) * U, y = Math.floor(cell / n) * U;
    s += `<rect class="pulse" x="${x + 3}" y="${y + 3}" width="${U - 6}" height="${U - 6}" rx="8" fill="var(--accent)" fill-opacity=".28" stroke="var(--accent)" stroke-width="7" pointer-events="none"/>`;
  }
  // people
  G.pos.forEach((cell, p) => {
    if (cell < 0) return;
    const x = (cell % n) * U, y = Math.floor(cell / n) * U, look = personLook(p), victim = p === cs.victim;
    const dragging = G.drag && G.drag.p === p && G.drag.active;
    s += `<g transform="translate(${x + 7} ${y + 7}) scale(.86)" ${dragging ? 'opacity=".3"' : ""} pointer-events="none">
      ${p === G.sel ? `<circle cx="50" cy="50" r="54" fill="none" stroke="var(--accent)" stroke-width="7"/>` : ""}
      <circle cx="50" cy="50" r="47" fill="var(--mf-token-bg)"/><g clip-path="url(#mfClip)">${avatar(look, victim)}</g>
      <circle cx="50" cy="50" r="46" fill="none" stroke="${conflicts.has(p) ? "var(--mf-bad)" : look.shirt}" stroke-width="${conflicts.has(p) ? 9 : 7}" ${conflicts.has(p) ? 'stroke-dasharray="14 7"' : ""}/>
    </g>`;
  });
  // room names: written along the room's widest horizontal run of cells; shrink a little, then use the short name, before ever cutting
  const best = new Map(); // room id -> {r, c, len}
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      const id = room(r, c);
      let len = 1;
      while (c + len < n && room(r, c + len) === id) len++;
      const cur = best.get(id);
      if (!cur || len > cur.len) best.set(id, { r, c, len });
      c += len;
    }
  }
  const maxFs = Math.min(30, 12.5 / scale), minFs = Math.min(30, 8.6 / scale), CHAR = 0.6;
  for (const [id, { r, c, len }] of best) {
    const avail = len * U - 12, full = roomName(cs, id, lang), short = cs.rooms[id].short?.[lang];
    let text = full, fs = Math.min(maxFs, avail / (full.length * CHAR));
    if (fs < minFs && short && short !== full) { text = short; fs = Math.min(maxFs, avail / (short.length * CHAR)); }
    if (fs < minFs) {
      fs = minFs;
      const fit = Math.max(3, Math.floor(avail / (fs * CHAR)));
      if (text.length > fit) text = text.slice(0, fit - 1) + "…";
    }
    s += `<text class="room-lbl" x="${c * U + 7}" y="${r * U + fs + 3}" font-size="${fs.toFixed(1)}" stroke-width="${(fs * 0.3).toFixed(1)}">${esc(text)}</text>`;
  }
  // keyboard cursor
  if (G.kbd) {
    const x = (G.cursor % n) * U, y = Math.floor(G.cursor / n) * U;
    s += `<rect x="${x + 4}" y="${y + 4}" width="${U - 8}" height="${U - 8}" rx="8" fill="none" stroke="var(--accent)" stroke-width="6" stroke-dasharray="16 9" pointer-events="none"/>`;
  }
  // winner reveal
  if (G.won) {
    const m = G.won.murderer, cell = G.solution[m], x = (cell % n) * U, y = Math.floor(cell / n) * U;
    s += `<rect x="${x + 2}" y="${y + 2}" width="${U - 4}" height="${U - 4}" rx="8" fill="none" stroke="var(--mf-bad)" stroke-width="8" pointer-events="none"/>`;
  }
  s += `<text class="lbl" x="${-LM + 4}" y="${-LM + 20}" font-size="20" text-anchor="start" opacity="0">${esc(t("northLabel"))}</text></svg>`;
  host.innerHTML = s;
  host.dataset.n = n;
}

/* ---------------- pointer input on the board ---------------- */
function cellFromPoint(clientX, clientY) {
  const svg = $("#mfBoardWrap .mf-board");
  if (!svg || !G) return -1;
  const rect = svg.getBoundingClientRect(), n = G.cs.n, VB = n * CELL + LABEL_MARGIN + 10;
  const k = rect.width / VB;
  const x = (clientX - rect.left) / k - LABEL_MARGIN, y = (clientY - rect.top) / k - LABEL_MARGIN;
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  return r >= 0 && c >= 0 && r < n && c < n ? r * n + c : -1;
}
/* Loupe for small cells (phones): while a finger rests on the grid, a magnified view of the cell under it floats above the finger. */
let loupe = null, loupeTimer = 0;
const smallCells = () => { const svg = $("#mfBoardWrap .mf-board"); return !!svg && !!G && svg.getBoundingClientRect().width / (G.cs.n * CELL + LABEL_MARGIN + 10) * CELL < 54; };
function updateLoupe(x, y) {
  const cell = cellFromPoint(x, y);
  if (cell < 0) { hideLoupe(); return; }
  const n = G.cs.n, r = Math.floor(cell / n), c = cell % n, span = CELL * 2.5;
  if (!loupe) {
    const src = $("#mfBoardWrap .mf-board");
    loupe = document.createElement("div");
    loupe.className = "mf-loupe";
    loupe.innerHTML = `<svg viewBox="0 0 ${span} ${span}" width="150" height="150" aria-hidden="true">${src.innerHTML}<rect class="hi" fill="none" stroke="var(--accent)" stroke-width="7" rx="8"/></svg><div class="cap"></div>`;
    document.body.appendChild(loupe);
  }
  const svg = loupe.querySelector("svg"), hi = loupe.querySelector(".hi");
  svg.setAttribute("viewBox", `${c * CELL + CELL / 2 - span / 2} ${r * CELL + CELL / 2 - span / 2} ${span} ${span}`);
  hi.setAttribute("x", c * CELL + 4); hi.setAttribute("y", r * CELL + 4); hi.setAttribute("width", CELL - 8); hi.setAttribute("height", CELL - 8);
  loupe.querySelector(".cap").textContent = t("placedAt", { r: r + 1, c: c + 1 });
  const left = Math.min(window.innerWidth - 158, Math.max(8, x - 79)), above = y - 200;
  loupe.style.left = left + "px";
  loupe.style.top = (above < 8 ? y + 70 : above) + "px";
}
function hideLoupe() { clearTimeout(loupeTimer); loupeTimer = 0; if (loupe) { loupe.remove(); loupe = null; } }
let press = null, ghost = null;
function endPress() { hideLoupe(); if (press) { clearTimeout(press.timer); press = null; } if (ghost) { ghost.remove(); ghost = null; } if (G) G.drag = null; }
function startDrag() {
  if (!press || press.p < 0 || !G) return;
  press.drag = true;
  G.drag = { p: press.p, active: true };
  ghost = document.createElement("div");
  ghost.className = "mf-ghost";
  ghost.innerHTML = avatarBadge(personLook(press.p), { size: 68, victim: press.p === G.cs.victim });
  document.body.appendChild(ghost);
  moveGhost(press.lastX, press.lastY);
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (error) { /* vibration is optional */ } }
  renderBoard();
}
function moveGhost(x, y) { if (ghost) { ghost.style.left = x + "px"; ghost.style.top = y + "px"; } }
function finishDrag(x, y) {
  const p = press.p, target = cellFromPoint(x, y), svg = $("#mfBoardWrap .mf-board");
  const inside = svg && (() => { const r = svg.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; })();
  endPress();
  if (target >= 0) {
    const other = personAt(target);
    if (target !== G.pos[p]) {
      if (G.model.blocked[target]) say(t("cannotStand", { o: objName(G.model.objAt[target], lang) }), true);
      else if (other >= 0) { snapshot(); const mine = G.pos[p]; G.pos[p] = target; G.pos[other] = mine; G.hint = null; G.msg = ""; }
      else placePerson(p, target);
    }
  } else if (!inside) {
    unplacePerson(p);
  }
  afterChange();
}
function bindBoard() {
  const area = $("#playView");
  area.addEventListener("pointerdown", (e) => {
    if (!G || e.button > 0 || !e.target.closest("#mfBoardWrap")) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    G.kbd = false;
    if (cell < 0) return;
    const p = G.notes ? -1 : personAt(cell);
    press = { cell, p, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, drag: false, type: e.pointerType, timer: 0 };
    if (p >= 0 && e.pointerType !== "mouse") press.timer = setTimeout(startDrag, 260);
    if (e.pointerType !== "mouse" && smallCells()) loupeTimer = setTimeout(() => { if (press && !press.moved) { press.hold = true; updateLoupe(press.lastX, press.lastY); } }, 180);
  });
  window.addEventListener("pointermove", (e) => {
    if (!press) return;
    press.lastX = e.clientX; press.lastY = e.clientY;
    if (press.hold) updateLoupe(e.clientX, e.clientY);
    const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (!press.drag && press.p >= 0 && press.type === "mouse" && dist > 7) startDrag();
    if (press.drag) moveGhost(e.clientX, e.clientY);
    else if (dist > 12 && !press.hold) { clearTimeout(press.timer); clearTimeout(loupeTimer); press.moved = true; }
  });
  window.addEventListener("pointerup", (e) => {
    if (!press) return;
    if (press.drag) { finishDrag(e.clientX, e.clientY); return; }
    const was = press;
    endPress();
    if (was.hold) { const c = cellFromPoint(e.clientX, e.clientY); if (c >= 0) tapCell(c); return; } // press-and-slide with the loupe: the cell under the finger on release
    if (!was.moved && Math.hypot(e.clientX - was.x, e.clientY - was.y) < 14) tapCell(was.cell);
  });
  window.addEventListener("blur", hideLoupe);
  window.addEventListener("pointercancel", () => { if (press && press.drag) { endPress(); renderBoard(); } else endPress(); });
  // while a piece is being dragged the page must not scroll
  window.addEventListener("touchmove", (e) => { if (press && (press.drag || press.hold)) e.preventDefault(); }, { passive: false });
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
    if (act === "cases") { leaveCase(); return; }
    if (act === "undo") { undo(); afterChange(); return; }
    if (act === "hint") { useHint(); return; }
    if (act === "notes") { G.notes = !G.notes; G.msg = ""; renderPlay(); return; }
    if (act === "check") { check(); return; }
    if (act === "reset") { if (await askConfirm(t("confirmReset"))) resetCase(); return; }
    if (act === "placehint") {
      const h = G.hint;
      if (h && placePerson(h.person, h.cell)) { G.hint = null; G.flash = null; afterChange(); }
      return;
    }
    const clueBtn = el.closest("[data-clue]");
    if (clueBtn) { const [p, ci] = clueBtn.dataset.clue.split(":").map(Number); G.sel = p; flashClue(G.cs.people[p].clues[ci], p); renderPlay(); return; }
    const roomBtn = el.closest("[data-room]");
    if (roomBtn) { flash(G.model.roomCells[Number(roomBtn.dataset.room)]); renderBoard(); return; }
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
  clearWip();
  clearTimeout(G.flashTimer);
  G = newGame(cs);
  renderPlay();
  startClock();
}

/* ---------------- keyboard ---------------- */
function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (!G || e.metaKey || e.altKey || document.querySelector(".mf-modal")) {
      if (e.key === "Escape") closeModal();
      return;
    }
    if (e.target.closest("input,textarea,select")) return;
    const n = G.cs.n, k = e.key;
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (move) {
      e.preventDefault();
      const r = Math.min(n - 1, Math.max(0, Math.floor(G.cursor / n) + move[0])), c = Math.min(n - 1, Math.max(0, (G.cursor % n) + move[1]));
      G.cursor = r * n + c; G.kbd = true; renderBoard(); return;
    }
    const digit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
    if (digit >= 0 && digit < G.cs.people.length) { G.sel = digit; G.kbd = true; startClock(); renderPlay(); return; }
    const lower = k.toLowerCase();
    if ((k === " " || k === "Enter") && !e.target.closest("button")) { e.preventDefault(); G.kbd = true; tapCell(G.cursor); return; }
    if (k === "Backspace" || k === "Delete") { const p = personAt(G.cursor); if (p >= 0) { unplacePerson(p); afterChange(); } return; }
    if (k === "Escape") { G.sel = -1; G.hint = null; renderPlay(); return; }
    if (e.ctrlKey) { if (lower === "z") { e.preventDefault(); undo(); afterChange(); } return; }
    if (lower === "n") { G.notes = !G.notes; renderPlay(); }
    else if (lower === "u") { undo(); afterChange(); }
    else if (lower === "h") useHint();
    else if (lower === "c") check();
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
  if (first) first.focus();
  return modal;
}
function askConfirm(text) {
  return new Promise((resolve) => {
    const modal = openModal(`<p>${esc(text)}</p><div class="mf-btns"><button type="button" class="mf-btn" data-v="1">${esc(t("yes"))}</button><button type="button" class="mf-btn alt" data-v="0">${esc(t("no"))}</button></div>`);
    modal.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) { closeModal(); resolve(b.dataset.v === "1"); }
      else if (e.target === modal) resolve(false);
    });
  });
}

function demoBeside() {
  let s = `<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const mid = r === 1 && c === 1;
    s += `<rect x="${c * 32 + 1}" y="${r * 32 + 1}" width="30" height="30" rx="4" fill="${mid ? "var(--mf-r2)" : "var(--mf-r3)"}" stroke="var(--mf-wall)" stroke-width="1.5"/>`;
  }
  s += `<g transform="translate(36 36) scale(.24)"><circle cx="50" cy="50" r="47" fill="var(--mf-token-bg)"/><g clip-path="url(#mfDemoClip)">${avatar({ skin: "#eebb93", hair: "#5a3a22", style: 0, shirt: "#2e86de" })}</g><circle cx="50" cy="50" r="46" fill="none" stroke="#2e86de" stroke-width="8"/></g>`;
  s += `<defs><clipPath id="mfDemoClip"><circle cx="50" cy="50" r="46"/></clipPath></defs>`;
  s += `<g transform="translate(1 1) scale(.3)">${objectArt("tree", 0, 0, 100)}</g></svg>`;
  return s;
}
function showRules() {
  const rules = UI.rules.map((r) => `<li>${r[lang]}</li>`).join("");
  const blk = ["table", "shelf", "tree", "barrel"], std = ["chair", "carpet", "bench", "bed", "hay"];
  const modal = openModal(`<h2>${esc(t("rulesTitle"))} 🔎</h2>
    <ol class="mf-rules">${rules}</ol>
    <div class="mf-demo"><div style="display:flex;gap:4px;flex-wrap:wrap;max-width:190px">${blk.map((x) => objectIcon(x, 34).replace('class="mf-icon"', 'class="mf-icon blk"')).join("")}</div><div class="cap">${esc(t("legendBlock"))}</div></div>
    <div class="mf-demo"><div style="display:flex;gap:4px;flex-wrap:wrap;max-width:190px">${std.map((x) => objectIcon(x, 34).replace('class="mf-icon"', 'class="mf-icon std"')).join("")}</div><div class="cap">${esc(t("legendStand"))}</div></div>
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
      <div class="big">${avatarBadge(personLook(m), { size: 132 })}<span class="lens" aria-hidden="true">🔎</span></div>
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
function tickClock() {
  if (!G) return;
  const el = $("#mfClock");
  if (el) el.textContent = fmtTime(clock());
}
function boot() {
  bindClicks(); bindBoard(); bindKeys();
  setInterval(tickClock, 500);
  document.addEventListener("visibilitychange", () => {
    if (!G) return;
    if (document.hidden) { stopClock(); saveWip(); }
    else if (!document.querySelector(".mf-modal")) startClock();
  });
  window.addEventListener("pagehide", () => { if (G) { stopClock(); saveWip(); } });
  let lastW = 0;
  new ResizeObserver(() => { const w = boardPixelWidth(); if (G && Math.abs(w - lastW) > 2) { lastW = w; renderBoard(); } }).observe(document.body);
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => { if (G) askConfirm(t("confirmReset")).then((ok) => { if (ok) resetCase(); }); else location.reload(); });
  applyLang();
  const wanted = new URLSearchParams(location.search).get("case");
  if (wanted && !openCase(wanted)) console.warn("[mordsfall] unknown case", wanted);
  else if (!wanted && save.wip && !TEST_MODE) { /* an unfinished case is offered by its card; nothing opens by itself */ }
  if (!save.seen && !TEST_MODE && !wanted) showRules();
}

/* Test hook (used by scripts/flows/mordsfall.mjs): drives the same code paths as taps do. */
window.__mordsfall = {
  cases,
  openCase,
  state: () => G && { id: G.cs.id, status: G.status, pos: [...G.pos], solution: [...G.solution], murderer: murdererOf(G.model, G.solution), names: G.cs.people.map((x) => x.name), hints: G.hints, won: G.won },
  reset: () => resetCase(),
  blockedCell: () => G.model.blocked.findIndex((b) => b === 1),
  freeCell: () => G.model.blocked.findIndex((b, i) => !b && G.solution.indexOf(i) < 0),
  swap: (a, b) => { const t = G.pos[a]; G.pos[a] = G.pos[b]; G.pos[b] = t; renderPlay(); },
  sharesVictimRoom: () => { const m = G.model, v = G.solution[G.cs.victim]; return G.cs.people[G.solution.findIndex((x, i) => i !== G.cs.victim && m.room[x] === m.room[v])].name; },
  placeAll: (order) => { (order || G.cs.people.map((_, i) => i)).forEach((p) => { G.pos[p] = G.solution[p]; }); renderPlay(); },
  solve() { // taps every person onto the correct cell through the normal tap handlers
    G.pos.fill(-1);
    G.cs.people.forEach((_, p) => { G.sel = p; tapCell(G.solution[p]); });
    check();
  },
};
boot();
