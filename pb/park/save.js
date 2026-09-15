import { RULES, TILE, PHASE, RIDES, UNLOCKS, MILESTONES, SAVED_FIELDS,
  OBJECT_FIELDS, OBJECT_WIDTHS, GUEST_FIELDS, GUEST_WIDTHS } from "./data.js";
import { GRID, GATE, KINDS, footprint, isOwned, unpack, packObject, packGuests } from "./build.js";
import { createState, tick } from "./sim.js";

export const SAVE_LIMIT = 7000;
const SAVE_DELAY = 1200;
const MAX_SAVE_WAIT = 5000;
const COUNTER_LIMIT = 1000000000;
const SEED_LIMIT = 4294967295;
const RECORD_BASE = 36;
const PARCEL_MASK = (1 << (GRID.width * GRID.height / RULES.parcelSize ** 2)) - 1;
const OBJECT_LENGTH = OBJECT_WIDTHS.reduce((sum, width) => sum + width, 0);
const GUEST_LENGTH = GUEST_WIDTHS.reduce((sum, width) => sum + width, 0);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;
const integer = (value, fallback, min, max) => Math.floor(number(value, fallback, min, max));
const money = (value, fallback = 0) => Math.round(number(value, fallback, -RULES.cashLimit, RULES.cashLimit) * 100) / 100;
const vector = (value, defaults, max, min = 0) => defaults.map((fallback, index) =>
  integer(Array.isArray(value) ? value[index] : undefined, fallback, min, max));

function cleanObjects(raw, saved) {
  const grid = saved.g.map((tile, p) => tile === TILE.PATH && isOwned(saved, p % GRID.width,
    Math.floor(p / GRID.width)) ? TILE.PATH : TILE.EMPTY);
  grid[GATE] = TILE.PATH;
  const objects = raw.map(record => {
    if (record === null) return null;
    if (typeof record !== "string" || record.length !== OBJECT_LENGTH || !/^[0-9a-z]+$/.test(record)) return null;
    const object = unpack(record, OBJECT_FIELDS, OBJECT_WIDTHS);
    const kind = KINDS[object.k];
    if (!kind || object.p >= grid.length || object.r > 3) return null;
    const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
    if (shape.tiles.some(([x, y]) => !isOwned(saved, x, y) || grid[y * GRID.width + x] !== TILE.EMPTY)) return null;
    for (const [x, y] of shape.tiles) grid[y * GRID.width + x] = TILE.OCCUPIED;
    return packObject({ ...object, h: integer(object.h, RULES.maxNeed, 0, kind.reliability ?? RULES.maxNeed),
      b: integer(object.b, 0, 0, RULES.repairWork), t: integer(object.t, 0, 0, kind.duration ?? RULES.serviceSeconds) });
  });
  return { ...saved, g: grid, o: objects };
}

function cleanGuests(raw, saved) {
  const guests = [];
  for (let offset = 0; offset < raw.length; offset += GUEST_LENGTH) {
    const guest = unpack(raw.slice(offset, offset + GUEST_LENGTH), GUEST_FIELDS, GUEST_WIDTHS);
    guest.p = integer(guest.p, GATE, 0, saved.g.length - 1);
    guest.target = integer(guest.target, 0, 0, saved.o.length);
    guest.phase = integer(guest.phase, PHASE.WALK, PHASE.WALK, PHASE.LEAVE);
    guest.wait = integer(guest.wait, 0, 0, RECORD_BASE ** GUEST_WIDTHS[GUEST_FIELDS.indexOf("wait")] - 1);
    guest.age = integer(guest.age, 0, 0, RECORD_BASE ** GUEST_WIDTHS[GUEST_FIELDS.indexOf("age")] - 1);
    guest.wallet = integer(guest.wallet, 0, 0, RULES.initialWallet + RULES.walletVariation);
    for (const key of ["happy", "thrill", "hunger", "thirst", "toilet", "energy", "taste"]) {
      guest[key] = integer(guest[key], 0, 0, RULES.maxNeed);
    }
    if (guest.target && !saved.o[guest.target - 1]
      || !guest.target && [PHASE.QUEUE, PHASE.USE].includes(guest.phase)) {
      guest.target = 0; guest.phase = PHASE.WALK; guest.wait = 0;
    }
    if (saved.g[guest.p] !== TILE.PATH && guest.phase !== PHASE.USE) guest.p = GATE;
    guests.push(guest);
  }
  return packGuests(guests);
}

function normalizeSave(input, fresh) {
  if (!isRecord(input) || input.version !== RULES.version) return null;
  if (!Array.isArray(input.g) || input.g.length !== fresh.g.length
    || !Array.isArray(input.o) || input.o.length > RULES.maxObjects
    || typeof input.v !== "string" || input.v.length > RULES.maxGuests * GUEST_LENGTH
    || input.v.length % GUEST_LENGTH || !/^[0-9a-z]*$/.test(input.v)) return null;
  const saved = { version: RULES.version,
    g: input.g.map(tile => integer(tile, TILE.EMPTY, TILE.EMPTY, TILE.OCCUPIED)),
    o: [], v: "", l: integer(input.l, fresh.l, 0, PARCEL_MASK) | RULES.initialLand,
    c: money(input.c, fresh.c), p: integer(input.p, fresh.p, 0, RULES.maxPrice),
    rp: vector(input.rp, RIDES.map(ride => ride.price), RULES.maxPrice),
    s: vector(input.s, fresh.s, RULES.maxStaff), m: typeof input.m === "boolean" ? input.m : fresh.m,
    r: integer(input.r, fresh.r, 0, SEED_LIMIT), t: integer(input.t, 0, 0, COUNTER_LIMIT),
    q: integer(input.q, 0, 0, RULES.stepSeconds * RULES.timeScale - 1),
    f: integer(input.f, 0, 0, RULES.arrivalScale - 1), a: integer(input.a, 0, 0, COUNTER_LIMIT),
    h: integer(input.h, fresh.h, 0, RULES.maxNeed), j: integer(input.j, 0, 0, RULES.maxLitter),
    u: integer(input.u, 1, 0, (1 << UNLOCKS.length) - 1) | 1,
    z: integer(input.z, 0, 0, (1 << MILESTONES.length) - 1),
    d: fresh.d.map((value, index) => money(Array.isArray(input.d) ? input.d[index] : value)) };
  const layout = cleanObjects(input.o, saved);
  return { ...layout, v: cleanGuests(input.v, layout) };
}

function decodeSave(input) {
  const fresh = createState(1);
  try {
    if (typeof input === "string") {
      if (input.length >= SAVE_LIMIT) return null;
      input = JSON.parse(input);
    }
    const saved = normalizeSave(input, fresh.saved);
    if (!saved) return null;
    // The constructor supplies stats and other defaults; the saved layout needs its own network.
    return tick({ saved, derived: { ...fresh.derived, dirty: true, network: null } }, 0);
  } catch { return null; }
}

export function restoreSave(input) {
  return decodeSave(input) ?? createState(1);
}

export function readLayout(layout) {
  return typeof layout === "string" ? decodeSave(layout) : null;
}

export function snapshot(state) {
  return Object.fromEntries(Object.keys(SAVED_FIELDS).map(key => [key,
    Array.isArray(state.saved[key]) ? [...state.saved[key]] : state.saved[key]]));
}

export function serializeSave(state) {
  const layout = JSON.stringify(snapshot(state));
  if (new TextEncoder().encode(layout).length >= SAVE_LIMIT) {
    throw new Error("Park save is too large (7 KB limit). Progress was not sent; remove some attractions and try again.");
  }
  return layout;
}

export function applySave(current, incoming) {
  const next = decodeSave(incoming);
  if (!next) return current;
  const value = next.derived.parkValue - current.derived.parkValue;
  return value > 0 || value === 0 && next.derived.day > current.derived.day ? next : current;
}

export function createPersistence({ getState, onState, onError }) {
  let timer = null;
  let deadline = null;
  let lastPayload = null;
  let lastError = null;
  const report = message => {
    if (message !== lastError) onError(message);
    lastError = message;
  };
  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(deadline);
    timer = deadline = null;
  };
  function pushSave() {
    clearTimers();
    try {
      window.score = getState().derived.parkValue;
      const layout = serializeSave(getState());
      if (layout === lastPayload) return true;
      window.parent.postMessage({ __pbSave: 1, data: JSON.parse(layout) }, "*");
      lastPayload = layout;
      lastError = null;
      return true;
    } catch (error) { report(error.message || "Could not save this park."); return false; }
  }
  function scheduleSave() {
    window.score = getState().derived.parkValue;
    clearTimeout(timer);
    timer = setTimeout(pushSave, SAVE_DELAY);
    if (deadline === null) deadline = setTimeout(pushSave, MAX_SAVE_WAIT);
  }
  function applyIncoming(incoming) {
    const current = getState();
    const next = applySave(current, incoming);
    if (next === current) return false;
    onState(next);
    scheduleSave();
    return true;
  }
  function receiveSave(event) {
    if (event.source !== window.parent || !isRecord(event.data)) return;
    if (event.data.__pbLoadSave === 1) applyIncoming(event.data.data);
  }
  window.addEventListener("message", receiveSave);
  window.addEventListener("pagehide", pushSave);
  window.score = getState().derived.parkValue;
  try { window.parent.postMessage({ __pbWantSave: 1 }, "*"); }
  catch { report("Could not request cloud progress. Your local park is still open."); }
  return { applyIncoming, pushSave, scheduleSave, destroy() {
    clearTimers();
    window.removeEventListener("message", receiveSave);
    window.removeEventListener("pagehide", pushSave);
  } };
}
