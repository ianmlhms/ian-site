/* Kamera-Arcade: the menu, the camera flow and the game runner. Games live in g-*.js and only read frames from the Input (core.js). */
import { Input, CamError, sfx, drawHand, drawPose, text, pill, Synth, HINT_TEXT, DOWNLOAD_MB, MEDIAPIPE_VERSION } from "./core.js?v=1";
import balloons from "./g-balloons.js?v=1";
import rps from "./g-rps.js?v=1";
import wall from "./g-wall.js?v=1";
import jump from "./g-jump.js?v=1";
import pong from "./g-pong.js?v=1";
import draw from "./g-draw.js?v=1";

const GAMES = [balloons, rps, wall, jump, pong, draw];
const BASE_H = 720;
const params = new URLSearchParams(location.search);
const FAKE = params.get("fake") || "";                    // scripted input instead of the camera (tests, screenshots)
const SPEED = FAKE ? Math.max(0.1, Math.min(20, Number(params.get("speed")) || 1)) : 1;
const DELEGATE = params.get("delegate") === "cpu" ? "cpu" : "";
const HINT_AFTER_MS = 1800;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((kid) => node.append(kid));
  return node;
};
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (error) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (error) { console.warn("[webcam] storage write failed", error); } },
};
/* A small seeded generator for ?seed=N (reproducible test runs); otherwise Math.random. */
const seed = Number(params.get("seed"));
const rand = Number.isFinite(seed) && params.has("seed")
  ? (() => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })()
  : Math.random;

const cv = $("cv"), ctx = cv.getContext("2d"), frameEl = $("frame"), box = $("box"), overlay = $("overlay"), ovTitle = $("ovTitle"), ovBody = $("ovBody");
const state = { view: "menu", def: null, opts: {}, input: null, inst: null, env: null, W: 960, H: BASE_H, running: false, paused: false, raf: 0, last: 0, over: null, report: null, allowReport: false, hintAt: 0 };
const errors = [];

/* ---------------------------------------------------------------- best scores (own copy, only for display) */
const bestKey = (boardId) => "wc_best_" + boardId;
const readBest = (boardId) => { const v = Number(store.get(bestKey(boardId))); return Number.isFinite(v) && store.get(bestKey(boardId)) !== null ? v : null; };
function noteBest(boardId, score) {
  const prev = readBest(boardId);
  if (prev === null || score > prev) { store.set(bestKey(boardId), String(score)); return prev !== null; }
  return false;
}

/* ---------------------------------------------------------------- menu */
const NEEDS = { hands: "✋ Hänn", pose: "🧍 Ganze Kierper" };
function renderMenu() {
  const grid = $("grid"); grid.replaceChildren();
  GAMES.forEach((def) => {
    const board = def.board(defaultOpts(def));
    const best = board ? readBest(board.id) : null;
    const meta = el("div", { className: "meta" }, el("span", { className: "wc-chip", textContent: NEEDS[def.needs] }), def.noScore ? el("span", { className: "wc-chip", textContent: "2 Spiller" }) : "", best !== null ? el("span", { className: "wc-chip best", textContent: "Rekord " + best }) : "");
    const card = el("button", { className: "wc-card", type: "button", role: "listitem", id: "card-" + def.id }, el("span", { className: "ico", textContent: def.emoji }), el("span", { className: "nm", textContent: def.name }), el("span", { className: "ds", textContent: def.desc }), meta);
    card.addEventListener("click", () => openIntro(def));
    grid.append(card);
  });
  $("menuFoot").innerHTML = `Éischte Kéier gëtt eng eenzeg Eroflueden gemaach (Hänn ≈ ${DOWNLOAD_MB.hands} MB, Kierper ≈ ${DOWNLOAD_MB.pose} MB); duerno bleift d'Modell um Apparat. Op engem iPad: Safari, Landschaft oder Portrait. ` +
    `Hand- a Kierpererkennung: <a href="https://ai.google.dev/edge/mediapipe/solutions/guide" rel="noopener">MediaPipe Tasks Vision</a> ${MEDIAPIPE_VERSION} (Google, Apache-2.0) mat Hand Landmarker an Pose Landmarker (lite), lokal vun ian.lu gehost. Grafiken a Sounds si Originaler, am Code gemaach.`;
}
const defaultOpts = (def) => {
  const out = {};
  (def.options || []).forEach((o) => { const saved = store.get("wc_opt_" + def.id + "_" + o.key); out[o.key] = saved !== null && o.values.map(String).includes(saved) ? o.values.find((v) => String(v) === saved) : o.def; });
  return out;
};

function show(view) {
  state.view = view;
  $("menu").hidden = view !== "menu";
  $("play").hidden = view === "menu";
  window.Arcade?.setBoard?.(view === "menu" ? null : currentBoard());
}
const currentBoard = () => (state.def ? state.def.board(state.opts) : null);

/* ---------------------------------------------------------------- overlay panels */
function setOverlay(title, nodes, visible = true) {
  ovTitle.textContent = title;
  ovBody.replaceChildren(...nodes.filter(Boolean));
  overlay.classList.toggle("show", visible);
}
const lockNote = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "#wc-lock"); svg.append(use);
  return el("p", { className: "wc-note" }, svg, el("span", {}, el("b", { textContent: "Your video never leaves this device." }), " Nothing is uploaded, recorded or saved. D'Kamera geet aus, wann s de d'Spill verléiss."));
};
const btn = (label, onClick, cls = "arcade-btn", id = "") => { const b = el("button", { type: "button", className: cls, textContent: label, id }); b.addEventListener("click", onClick); return b; };

function openIntro(def) {
  stopLoop();
  state.def = def; state.opts = defaultOpts(def); state.inst = null; state.over = null;
  show("intro");
  buildToolbar(null);
  resizeFrame(4 / 3);
  clearCanvas();
  const opts = (def.options || []).map((o) => {
    const seg = el("div", { className: "arcade-seg", role: "group", "aria-label": o.label });
    o.values.forEach((value) => {
      const b = el("button", { type: "button", textContent: String(value), "aria-pressed": String(state.opts[o.key] === value) });
      b.addEventListener("click", () => { state.opts[o.key] = value; store.set("wc_opt_" + def.id + "_" + o.key, String(value)); seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
      seg.append(b);
    });
    return el("div", { className: "row" }, el("label", { textContent: o.label }), seg);
  });
  const why = el("p", { textContent: def.needs === "hands" ? "D'Kamera gesäit deng Hänn (21 Punkten pro Hand). Dofir brauch dëst Spill d'Kamera." : "D'Kamera gesäit däi ganze Kierper (33 Punkten). Dofir brauch dëst Spill d'Kamera." });
  const go = btn(FAKE ? "Start (Test-Input)" : "Kamera starten", () => begin(), "arcade-btn", "btnStart");
  setOverlay(def.name, [el("ul", {}, def.howto.map((line) => el("li", { textContent: line }))), el("div", { className: "wc-opts" }, opts), why, lockNote(), el("div", { className: "wc-panel-actions" }, go, btn("Menü", toMenu, "arcade-btn secondary", "btnIntroMenu"))]);
  go.focus({ preventScroll: true });
}

function showError(kind, detail) {
  const iPad = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
  const msg = {
    denied: ["D'Kamera ass blockéiert", "Ouni Kamera kënne mir keng Hand an keen Kierper gesinn. D'Bild gëtt net eropgelueden."],
    nocam: ["Keng Kamera fonnt", "Dësen Apparat huet keng (benotzbar) Kamera. Probéier et op engem Laptop oder iPad mat Frontkamera."],
    busy: ["D'Kamera ass besat", "Eng aner App oder e Tab benotzt d'Kamera. Maach déi zou a probéier et nach eng Kéier."],
    insecure: ["Kamera brauch eng sécher Verbindung", "Maach d'Säit iwwer https://ian.lu op."],
    unsupported: ["Dëse Browser ënnerstëtzt d'Kamera net", "Probéier eng méi nei Versioun vu Safari, Chrome oder Edge."],
    model: ["D'Modell konnt net gelueden ginn", "Kontrolléier d'Verbindung (ee Schouln-Netz kann ofblocken) a probéier et nach eng Kéier."],
    lost: ["D'Kamera ass ofgebrach", "Probéier et nach eng Kéier."],
  }[kind] || ["Eppes ass schif gaang", detail || ""];
  const nodes = [el("p", { textContent: msg[1] })];
  if (kind === "denied") {
    nodes.push(el("div", { className: "wc-help" }, el("b", { textContent: "Esou erlaabs de d'Kamera:" }), el("ol", {},
      el("li", { textContent: "iPad / iPhone: Astellungen › Safari › Kamera › Froen oder Erlaaben. Dann d'Säit nei lueden. (Settings › Safari › Camera › Ask/Allow.)" }),
      el("li", { textContent: "Computer: op d'Symbol lénks an der Adressleist klicken › Kamera › Erlaaben, dann d'Säit nei lueden." }))));
    if (iPad) nodes.push(el("p", { textContent: "Op der Schoul-iPad kann et sinn, dass d'Kamera vum Schoul-Profil gespaart ass." }));
  }
  nodes.push(lockNote(), el("div", { className: "wc-panel-actions" }, btn("Nach eng Kéier", () => begin(), "arcade-btn", "btnRetry"), btn("Zréck zum Menü", toMenu, "arcade-btn secondary", "btnErrMenu")));
  stopLoop();
  state.input && state.input.stop();
  setOverlay(msg[0], nodes);
  window.__wc && (window.__wc.lastError = kind);
}

function showLoading(label) {
  const bar = el("div", { className: "wc-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, el("i", { id: "loadFill" }));
  const msg = el("p", { id: "loadMsg", textContent: label });
  setOverlay(state.def.name, [msg, bar, lockNote()]);
}
const setProgress = (p) => { const fill = $("loadFill"); if (fill) { fill.style.width = Math.round(p * 100) + "%"; fill.parentElement.setAttribute("aria-valuenow", String(Math.round(p * 100))); } const msg = $("loadMsg"); if (msg) msg.textContent = p < 1 ? `Modell gëtt gelueden … ${Math.round(p * 100)} %` : "Kamera gëtt gestart …"; };

/* ---------------------------------------------------------------- camera + game start */
function getInput(need) {
  if (state.input && (state.input.need !== need)) { state.input.dispose(); state.input = null; }
  if (!state.input) state.input = new Input({ need, fake: FAKE, delegate: DELEGATE, onLost: () => { if (state.view === "play") { stopLoop(); showError("lost"); } } });
  return state.input;
}

async function begin() {
  sfx.unlock();
  const def = state.def;
  const input = getInput(def.needs);
  if (input.status !== "ready" || (!FAKE && !input.cameraOn)) {
    showLoading("Modell gëtt gelueden …");
    try { await input.start(setProgress); }
    catch (error) {
      const kind = error instanceof CamError ? error.kind : "model";
      console.warn("[webcam] start failed:", kind, error && error.message);
      showError(kind, error && error.message); return;
    }
  }
  startGame();
}

function logicalSize(aspect) { const H = BASE_H, W = Math.round(H * clampAspect(aspect)); return { W, H }; }
const clampAspect = (a) => Math.min(2, Math.max(0.5, a || 4 / 3));

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (error) { wakeLock = null; /* refused (battery saver) or unsupported: the screen may dim, nothing else */ }
}

function startGame() {
  const def = state.def, input = state.input;
  const { W, H } = logicalSize(input.aspect);
  state.W = W; state.H = H;
  resizeFrame(W / H);
  state.over = null; state.report = null;
  state.allowReport = !FAKE || window.__wcAllowReport === true;
  const board = def.board(state.opts);
  window.Arcade?.setBoard?.(board);
  window.Arcade?.startRun?.();
  const env = {
    W, H, aspect: W / H, sfx, rand, opts: { ...state.opts }, fake: FAKE,
    report(score, final) {
      state.report = { score, final: !!final, board: board && board.id };
      if (!board || !state.allowReport) return;
      if (final) window.Arcade?.gameOver?.(score); else window.Arcade?.score?.(score);
    },
    over(result) { state.over = result; finish(result); },
    toast,
  };
  state.env = env;
  state.inst = def.create(env);
  state.paused = false;
  buildToolbar(state.inst.toolbar || null);
  overlay.classList.remove("show");
  state.view = "play";
  keepAwake(true);
  startLoop();
  if (window.__wc) window.__wc.lastError = "";
}

function finish(result) {
  const board = currentBoard();
  let isBest = false, best = null;
  if (board && !result.hideScore && state.allowReport) { isBest = noteBest(board.id, result.score); best = readBest(board.id); }
  const nodes = [];
  if (!result.hideScore) nodes.push(el("span", { className: "arcade-big", id: "ovScore", textContent: String(result.score) }));
  (result.lines || []).forEach((line) => nodes.push(el("p", { textContent: line })));
  if (board && !result.hideScore && best !== null) nodes.push(el("p", { textContent: (isBest ? "Neie Rekord! " : "") + "Rekord: " + best }));
  nodes.push(el("div", { className: "wc-panel-actions" }, btn("Nach eng Kéier", restart, "arcade-btn", "btnAgain"), btn("Menü", toMenu, "arcade-btn secondary", "btnOverMenu")));
  setTimeout(() => { if (state.over === result) setOverlay(result.title, nodes); }, 650);
}

function restart() {
  if (state.view === "menu" || !state.def) return;
  if (state.view === "intro") return;
  const input = state.input;
  if (input && (input.status === "ready")) startGame(); else begin();
}

function toMenu() {
  stopLoop();
  keepAwake(false);
  if (state.input) state.input.stop();
  state.inst = null; state.over = null;
  show("menu");
  overlay.classList.remove("show");
  renderMenu();
  window.Arcade?.setBoard?.(null);
}

/* ---------------------------------------------------------------- canvas + loop */
function resizeFrame(aspect) {
  const a = clampAspect(aspect);
  const bw = box.clientWidth || 800, bh = box.clientHeight || 600;
  const pad = 8;
  let w = Math.min(bw - pad, (bh - pad) * a), h = w / a;
  if (!(w > 40)) { w = 320; h = w / a; }
  frameEl.style.width = Math.floor(w) + "px"; frameEl.style.height = Math.floor(h) + "px";
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // an iPad 9 draws a 1.5x canvas smoothly; 2x only costs frames
  const { W, H } = logicalSize(a);
  cv.width = Math.round(w * dpr); cv.height = Math.round(w / (W / H) * dpr);
  state.W = W; state.H = H;
}
function clearCanvas() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#0b0d0f"; ctx.fillRect(0, 0, cv.width, cv.height); }
window.addEventListener("resize", () => { if (state.view !== "menu") resizeFrame(state.view === "play" && state.input ? state.input.aspect : 4 / 3); });
if (window.ResizeObserver) new ResizeObserver(() => { if (state.view !== "menu") resizeFrame(state.view === "play" && state.input ? state.input.aspect : 4 / 3); }).observe(box);

function startLoop() { if (state.running) return; state.running = true; state.last = performance.now(); state.raf = requestAnimationFrame(tick); }
function stopLoop() { state.running = false; cancelAnimationFrame(state.raf); }

function tick(now) {
  if (!state.running) return;
  state.raf = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - state.last) / 1000) * SPEED;
  state.last = now;
  const input = state.input, inst = state.inst;
  if (!input || !inst) return;
  const frame = input.tick(now);
  if (!FAKE && state.view === "play" && Math.abs(input.aspect - state.W / state.H) > 0.15) { startGame(); return; }   // the device was rotated: the camera picture changed shape, start the round again at the new shape
  try {
    if (!state.paused && !state.over) inst.update(dt, frame, now);
  } catch (error) { fail("update", error); return; }
  ctx.setTransform(cv.width / state.W, 0, 0, cv.width / state.W, 0, 0);
  try {
    input.drawFeed(ctx, state.W, state.H);
    if (frame.pose) drawPose(ctx, frame.pose, state.W, state.H, { alpha: 0.55 });
    frame.hands.forEach((h) => drawHand(ctx, h, state.W, state.H, { alpha: 0.6 }));
    inst.draw(ctx);
    drawChrome(now, input, frame);
  } catch (error) { fail("draw", error); }
}

function fail(where, error) {
  console.error("[webcam] " + where + " failed", error);
  errors.push(where + ": " + (error && error.message));
  stopLoop();
  state.input && state.input.stop();
  setOverlay("Eppes ass schif gaang", [el("p", { textContent: "D'Spill huet e Feeler gemaach. Probéier et nach eng Kéier." }), el("div", { className: "wc-panel-actions" }, btn("Nach eng Kéier", () => begin(), "arcade-btn", "btnRetry"), btn("Menü", toMenu, "arcade-btn secondary", "btnErrMenu"))]);
}

/** Camera light, "nothing detected" hint, test-input badge. */
function drawChrome(now, input, frame) {
  const c = ctx, W = state.W, H = state.H, k = H / BASE_H;
  c.fillStyle = FAKE ? "#ffb84d" : "#ff5d5d"; c.beginPath(); c.arc(W - 22 * k, H - 22 * k, 6 * k, 0, Math.PI * 2); c.fill();
  text(c, FAKE ? "TEST-INPUT" : "Kamera um Apparat", W - 36 * k, H - 16 * k, { size: 14 * k, align: "right", weight: 600, color: "rgba(255,255,255,.8)", shadow: true });
  const hint = state.over ? "" : input.hint(now);
  if (hint) {
    const lines = wrap(HINT_TEXT[hint] || "", 44);
    const hgt = (lines.length * 30 + 22) * k;
    pill(c, W / 2 - 330 * k, H * 0.8 - hgt / 2, 660 * k, hgt, "rgba(20,12,4,.82)");
    lines.forEach((line, i) => text(c, line, W / 2, H * 0.8 - hgt / 2 + (34 + i * 30) * k, { size: 22 * k, align: "center", weight: 600, color: "#ffd23f", shadow: false }));
  }
}
function wrap(str, max) {
  const out = []; let line = "";
  str.split(" ").forEach((word) => { if ((line + " " + word).trim().length > max) { out.push(line); line = word; } else line = (line + " " + word).trim(); });
  if (line) out.push(line);
  return out;
}

function toast(message) {
  const t = el("div", { className: "wc-toast", role: "status", textContent: message });
  box.append(t); setTimeout(() => t.remove(), 2200);
}

/* ---------------------------------------------------------------- toolbar (game specific buttons) */
function buildToolbar(items) {
  const bar = $("toolbar"); bar.replaceChildren();
  (items || []).forEach((item) => {
    const b = el("button", { type: "button", className: "wc-tool" + (item.color ? " swatch" : "") + (item.primary ? " primary" : ""), textContent: item.label || "" });
    if (item.color) { b.append(el("i", { style: `background:${item.color}` })); b.setAttribute("aria-label", item.title || "Faarf"); b.setAttribute("aria-pressed", "false"); }
    b.addEventListener("click", () => { item.onClick(); if (item.color) bar.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String(s === b))); });
    bar.append(b);
  });
}

/* ---------------------------------------------------------------- lifecycle: the camera is never left running behind a hidden tab */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || state.view !== "play") return;
  state.paused = true; stopLoop();
  if (state.input) state.input.stop();
  setOverlay("Pause", [el("p", { textContent: "D'Kamera gouf gestoppt, well d'Säit net méi ze gesinn war." }), el("div", { className: "wc-panel-actions" }, btn("Weiderspillen", resume, "arcade-btn", "btnResume"), btn("Menü", toMenu, "arcade-btn secondary", "btnPauseMenu"))]);
});
async function resume() {
  showLoading("Kamera gëtt gestart …");
  try { await state.input.start(setProgress); } catch (error) { showError(error instanceof CamError ? error.kind : "model", error && error.message); return; }
  overlay.classList.remove("show"); state.paused = false; state.view = "play"; startLoop(); keepAwake(true);
}
window.addEventListener("pagehide", () => { if (state.input) state.input.stop(); });

$("btnMenu").addEventListener("click", toMenu);
window.Arcade?.onRestart?.(() => restart());
window.Arcade?.onMute?.((muted) => { sfx.muted = muted; });
window.addEventListener("error", (event) => errors.push("window: " + event.message));

/* ---------------------------------------------------------------- test hooks (the scripted input; also handy in the console) */
window.__wc = {
  fake: FAKE, Synth, errors, lastError: "",
  get state() { return { view: state.view, game: state.def && state.def.id, opts: state.opts, over: state.over, report: state.report, W: state.W, H: state.H, camera: !!(state.input && state.input.cameraOn), status: state.input && state.input.status }; },
  get input() { return state.input; },
  get game() { return state.inst; },
  debug() { return state.inst ? state.inst.debug() : null; },
  feed(partial) { if (state.input) state.input.feed(partial); },
  open(id) { const def = GAMES.find((g) => g.id === id); if (def) openIntro(def); },
};

renderMenu();
show("menu");
const deepLink = params.get("game");
if (deepLink && GAMES.some((g) => g.id === deepLink)) window.__wc.open(deepLink);
