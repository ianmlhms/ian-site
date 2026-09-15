import { RULES } from "/pb/park/data.js";
import { GRID, KINDS, canPlace, place, remove, placePath, removePath, buyLand,
  footprint, inBounds } from "/pb/park/build.js";
import { tick, setTicketPrice, setRidePrice, setStaff,
  setMaintenance, maintainRide } from "/pb/park/sim.js";
import { ParkRenderer } from "/pb/park/renderer.js?v=4";
import { ParkUI } from "/pb/park/ui.js?v=2";
import { restoreSave, createPersistence } from "/pb/park/save.js?v=1";
import { createSocial } from "/pb/park/social.js?v=1";

const FIXED_STEP = RULES.stepSeconds;
const MAX_FRAME_DELTA = 0.25;
const SPEEDS = [1, 2, 4];
const COMMANDS = { ticket: setTicketPrice, price: setRidePrice, staff: setStaff,
  maintenance: setMaintenance, repair: maintainRide, remove };
let state = restoreSave(window.__pbSave);
let visitState = null;
let persistence;
let social;
let renderer;
let ui;
let tool = null;
let rotation = 0;
let tile = null;
let anchored = false;
let selectedId = null;
let speed = 1;
let paused = false;
let isWalking = false;
let accumulator = 0;
let lastTime = null;
let animationFrame = null;

function sync() {
  renderer.sync(visitState ?? state);
  renderer.select(selectedId);
  ui.update(visitState ?? state);
  updatePreview();
  persistence?.scheduleSave();
}

function accept(result, message) {
  if (visitState) return false;
  if (!result || result.ok === false) {
    ui.notify(`Command refused: ${result?.reason ?? "invalid-command"}`);
    return false;
  }
  state = tick(result, 0);
  sync();
  if (message) ui.notify(message);
  return true;
}

function command(name, ...args) {
  if (visitState) return false;
  if (!Object.hasOwn(COMMANDS, name)) return false;
  return accept(COMMANDS[name](state, ...args), "Park updated.");
}

function setTool(next) {
  if (visitState || isWalking) return;
  if (!["path", "erase-path", "land"].includes(next) && !KINDS.some(kind => kind.id === next)) return;
  tool = next;
  rotation = 0;
  tile = null;
  anchored = false;
  selectedId = null;
  renderer.select(null);
  renderer.preview(null);
  ui.setTool(tool, rotation);
}

function cancel() {
  tool = null;
  tile = null;
  anchored = false;
  selectedId = null;
  renderer.preview(null);
  renderer.select(null);
  ui.setTool(null, rotation);
}

function buildResult() {
  if (!tile) return { ok: false, reason: "choose-tile" };
  if (tool === "path") return placePath(state, tile.x, tile.y);
  if (tool === "erase-path") return removePath(state, tile.x, tile.y);
  if (tool === "land") return buyLand(state, Math.floor(tile.x / RULES.parcelSize), Math.floor(tile.y / RULES.parcelSize));
  return place(state, tool, tile.x, tile.y, rotation);
}

function updatePreview() {
  if (!tool || !tile) { renderer.preview(null); ui.showPreview(null, false); return; }
  const kind = KINDS.find(entry => entry.id === tool);
  const shape = kind ? footprint(kind, tile.x, tile.y, rotation) : { width: 1, height: 1 };
  const result = kind ? canPlace(state, tool, tile.x, tile.y, rotation) : buildResult();
  const preview = { x: tile.x, y: tile.y, width: shape.width, height: shape.height,
    entrance: shape.entrance, ok: result.ok !== false, reason: result.reason };
  if (tool === "land") {
    preview.x = Math.floor(tile.x / RULES.parcelSize) * RULES.parcelSize;
    preview.y = Math.floor(tile.y / RULES.parcelSize) * RULES.parcelSize;
    preview.width = preview.height = RULES.parcelSize;
  }
  renderer.preview(preview);
  ui.showPreview(preview, anchored);
}

function onTap(point) {
  if (visitState || isWalking) return;
  if (!point) return;
  if (tool) { tile = point; anchored = true; updatePreview(); return; }
  if (!inBounds(point.x, point.y)) { ui.notify("Choose a tile inside the park."); return; }
  const object = state.derived.objects.find(item => {
    if (!item) return false;
    const x = item.p % GRID.width;
    const y = Math.floor(item.p / GRID.width);
    const shape = footprint(KINDS[item.k], x, y, item.r);
    return point.x >= x && point.y >= y && point.x < x + shape.width && point.y < y + shape.height;
  });
  selectedId = object?.id ?? null;
  renderer.select(selectedId);
  if (object) ui.inspect(object.id);
  else ui.closePanel();
}

function confirm() {
  if (visitState || isWalking) return;
  if (!tool || !anchored || !tile) return;
  accept(buildResult(), tool === "erase-path" ? "Path removed." : tool === "land" ? "Land acquired." : "Built! Connect entrances to the gate with paths.");
}

function frame(time) {
  animationFrame = null;
  if (document.hidden) return;
  const delta = lastTime === null ? 0 : Math.min(MAX_FRAME_DELTA, Math.max(0, (time - lastTime) / 1000));
  lastTime = time;
  if (!paused && !visitState) {
    accumulator += delta * speed;
    while (accumulator >= FIXED_STEP) {
      state = tick(state, FIXED_STEP);
      accumulator -= FIXED_STEP;
      sync();
    }
  }
  renderer.render(accumulator / FIXED_STEP, paused || visitState ? 0 : delta * speed, delta);
  animationFrame = requestAnimationFrame(frame);
}

function setWalk(isActive) {
  if (isWalking === isActive || isActive && visitState) return;
  cancel();
  ui.closePanel();
  isWalking = isActive;
  renderer.setWalkMode(isActive, state);
  ui.setWalk(isActive);
  document.getElementById("parkCanvas").setAttribute("aria-label", isActive
    ? "Walk through your theme park. Use W, A, S, D or arrow keys to move and drag to look. Press Escape to exit."
    : "Your 3D theme park. Drag to pan, pinch or scroll to zoom. Tap a tile to build or inspect.");
}

function setVisit(next) {
  setWalk(false);
  cancel();
  ui.closePanel();
  visitState = next;
  accumulator = 0;
  lastTime = null;
  document.getElementById("dock").hidden = Boolean(next);
  document.getElementById("socialActions").hidden = Boolean(next);
  document.querySelector('[data-panel="help"]').hidden = Boolean(next);
  document.getElementById("parkCanvas").setAttribute("aria-label", next
    ? "Read-only park visit. Drag to pan, pinch or scroll to zoom. Use Back to my park to leave."
    : "Your 3D theme park. Drag to pan, pinch or scroll to zoom. Tap a tile to build or inspect.");
  sync();
  renderer.frameState(next ?? state);
}

function boot() {
  renderer = new ParkRenderer(document.getElementById("parkCanvas"), {
    onTap, onHover: point => {
      if (!tool || anchored || !point || tile && point.x === tile.x && point.y === tile.y) return;
      tile = point;
      updatePreview();
    },
    onExitWalk: () => setWalk(false),
  });
  ui = new ParkUI({ command, setTool, cancel, confirm,
    publish: () => social.showPublish(), gallery: () => social.showGallery(),
    rotate: () => { rotation = (rotation + 1) % 4; ui.setTool(tool, rotation); updatePreview(); },
    speed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; ui.setClock(speed, paused); },
    pause: () => { paused = !paused; ui.setClock(speed, paused); },
    walk: () => setWalk(!isWalking),
    exitWalk: () => setWalk(false),
    home: () => renderer.frameState(visitState ?? state),
  });
  persistence = createPersistence({ getState: () => state,
    onState: next => {
      setWalk(false);
      state = next;
      cancel();
      ui.closePanel();
      sync();
      renderer.frameState(state);
    }, onError: message => ui.notify(message) });
  social = createSocial({ getState: () => state, onVisit: next => setVisit(next),
    onReturn: () => setVisit(null), beforeOpen: () => { setWalk(false); cancel(); ui.closePanel(); } });
  sync();
  renderer.frameState(state);
  ui.setClock(speed, paused);
  ui.setWalk(false);
  document.getElementById("bootStatus").hidden = true;
  // Beginners only: a restored park already has paths and rides, and telling its
  // owner to "start with a path" on every load reads like the game forgot them.
  if (!window.__pbSave) ui.notify("Start with a path from the golden gate, then add a ride. Help has the basics.");
  document.documentElement.dataset.booted = "true";
  document.addEventListener("visibilitychange", () => {
    lastTime = null;
    if (document.hidden) { cancelAnimationFrame(animationFrame); animationFrame = null; }
    else if (animationFrame === null) animationFrame = requestAnimationFrame(frame);
  });
  document.getElementById("parkCanvas").addEventListener("webglcontextlost", event => {
    event.preventDefault();
    paused = true;
    ui.setClock(speed, paused);
    ui.notify("3D display interrupted. Reload to restart the park.");
  });
  if (new URLSearchParams(window.location.search).get("parkDebug") === "1") {
    window.parkDebug = Object.freeze({ snapshot: () => structuredClone(state),
      command, setTool, tap: onTap, confirm, walk: setWalk, renderer });
  }
  animationFrame = requestAnimationFrame(frame);
}

try { boot(); }
catch (error) {
  document.documentElement.dataset.bootError = String(error?.message ?? "boot-error");
  document.getElementById("bootStatus").hidden = false;
  document.getElementById("overlayText").textContent = "The park could not start. Check your connection and reload.";
  throw error;
}
