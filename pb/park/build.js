import { RULES, TILE, PHASE, RIDES, STALLS, FACILITIES, SCENERY, OBJECT_FIELDS, OBJECT_WIDTHS,
  GUEST_FIELDS, GUEST_WIDTHS } from "./data.js";

export const GRID = { width: RULES.gridWidth, height: RULES.gridHeight };
export const GATE = RULES.gateY * GRID.width + RULES.gateX;
export const KINDS = [
  ...RIDES.map(kind => ({ ...kind, type: "ride", need: "thrill" })),
  ...STALLS.map(kind => ({ ...kind, type: "stall" })),
  ...FACILITIES.map(kind => ({ ...kind, type: "facility" })),
  ...SCENERY.map(kind => ({ ...kind, type: "scenery" })),
];
const PARCEL_COLUMNS = GRID.width / RULES.parcelSize;
const BASE = 36;
export const refuse = reason => ({ ok: false, reason });
export const tileIndex = (x, y) => y * GRID.width + x;
export const inBounds = (x, y) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && y >= 0 && x < GRID.width && y < GRID.height;

export function pack(record, fields, widths) {
  return fields.map((field, i) => record[field].toString(BASE).padStart(widths[i], "0")).join("");
}

export function unpack(record, fields, widths) {
  let offset = 0;
  return Object.fromEntries(fields.map((field, i) => {
    const value = parseInt(record.slice(offset, offset + widths[i]), BASE);
    offset += widths[i];
    return [field, value];
  }));
}

export const packObject = object => pack(object, OBJECT_FIELDS, OBJECT_WIDTHS);
export const readObjects = saved => saved.o.map((record, id) => record === null ? null
  : { ...unpack(record, OBJECT_FIELDS, OBJECT_WIDTHS), id });
export function readGuests(saved) {
  const width = GUEST_WIDTHS.reduce((sum, value) => sum + value, 0);
  const guests = [];
  for (let offset = 0; offset < saved.v.length; offset += width) {
    guests.push(unpack(saved.v.slice(offset, offset + width), GUEST_FIELDS, GUEST_WIDTHS));
  }
  return guests;
}
export const packGuests = guests => guests.map(guest => pack(guest, GUEST_FIELDS, GUEST_WIDTHS)).join("");

export function neighbors(p) {
  const x = p % GRID.width;
  const y = Math.floor(p / GRID.width);
  return [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]]
    .filter(([nx, ny]) => inBounds(nx, ny)).map(([nx, ny]) => tileIndex(nx, ny));
}

export function isOwned(saved, x, y) {
  if (!inBounds(x, y)) return false;
  const parcel = Math.floor(y / RULES.parcelSize) * PARCEL_COLUMNS + Math.floor(x / RULES.parcelSize);
  return Boolean(saved.l & (1 << parcel));
}

export function footprint(kind, x, y, rot) {
  const [originalWidth, originalHeight] = kind.footprint;
  const [width, height] = rot % 2 ? [originalHeight, originalWidth] : kind.footprint;
  const tiles = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) tiles.push([x + dx, y + dy]);
  }
  const entries = [[0, height - 1], [0, 0], [width - 1, 0], [width - 1, height - 1]];
  const [ex, ey] = entries[rot];
  return { tiles, width, height, entrance: tileIndex(x + ex, y + ey) };
}

function distanceField(grid, starts) {
  const distances = Array(grid.length).fill(-1);
  const queue = [...starts];
  for (const p of starts) distances[p] = 0;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    for (const next of neighbors(p)) {
      if (grid[next] !== TILE.PATH || distances[next] !== -1) continue;
      distances[next] = distances[p] + 1;
      queue.push(next);
    }
  }
  return distances;
}

export function refreshNetwork(state) {
  if (!state.derived.dirty && state.derived.network) return state;
  const gate = distanceField(state.saved.g, [GATE]);
  const objects = readObjects(state.saved);
  const entrances = {};
  const fields = {};
  for (const object of objects) {
    if (!object) continue;
    const kind = KINDS[object.k];
    const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
    const access = neighbors(shape.entrance).filter(p => state.saved.g[p] === TILE.PATH && gate[p] >= 0);
    entrances[object.id] = { tile: shape.entrance, access, reachable: access.length > 0 };
    if (access.length && kind.need) fields[object.id] = distanceField(state.saved.g, access);
  }
  return { saved: state.saved, derived: { ...state.derived, dirty: false,
    network: { gate, entrances, fields }, networkRevision: (state.derived.networkRevision ?? 0) + 1 } };
}

function changed(state, saved) {
  return { saved, derived: { ...state.derived, dirty: true } };
}

function tileRefusal(state, x, y) {
  if (state.saved.c < 0) return refuse("bankrupt");
  if (!inBounds(x, y)) return refuse("out-of-bounds");
  if (!isOwned(state.saved, x, y)) return refuse("unowned");
  return null;
}

export function canPlace(state, kindId, x, y, rot = 0) {
  if (!inBounds(x, y)) return refuse("out-of-bounds");
  const kind = KINDS.find(entry => entry.id === kindId);
  if (!kind) return refuse("unknown-kind");
  if (!Number.isInteger(rot) || rot < 0 || rot > 3) return refuse("invalid-rotation");
  if (!(state.saved.u & (1 << kind.unlock))) return refuse("locked");
  if (state.saved.o.filter(Boolean).length >= RULES.maxObjects) return refuse("object-limit");
  for (const [tx, ty] of footprint(kind, x, y, rot).tiles) {
    const error = tileRefusal(state, tx, ty);
    if (error) return error;
    if (state.saved.g[tileIndex(tx, ty)] !== TILE.EMPTY) return refuse("blocked");
  }
  if (state.saved.c < kind.cost) return refuse("unaffordable");
  return { ok: true };
}

export function place(state, kindId, x, y, rot = 0) {
  const verdict = canPlace(state, kindId, x, y, rot);
  if (!verdict.ok) return verdict;
  const k = KINDS.findIndex(kind => kind.id === kindId);
  const kind = KINDS[k];
  const g = [...state.saved.g];
  for (const [tx, ty] of footprint(kind, x, y, rot).tiles) g[tileIndex(tx, ty)] = TILE.OCCUPIED;
  const o = [...state.saved.o];
  const vacant = o.indexOf(null);
  const id = vacant < 0 ? o.length : vacant;
  o[id] = packObject({ k, p: tileIndex(x, y), r: rot, h: kind.reliability ?? RULES.maxNeed, b: 0, t: 0 });
  return changed(state, { ...state.saved, g, o, c: state.saved.c - kind.cost });
}

export function remove(state, id) {
  if (!Number.isInteger(id) || !state.saved.o[id]) return refuse("unknown-object");
  const object = readObjects(state.saved)[id];
  const kind = KINDS[object.k];
  const g = [...state.saved.g];
  const shape = footprint(kind, object.p % GRID.width, Math.floor(object.p / GRID.width), object.r);
  for (const [x, y] of shape.tiles) g[tileIndex(x, y)] = TILE.EMPTY;
  const o = [...state.saved.o];
  o[id] = null;
  // Slots cannot be reused while an old guest target can still refer to them.
  const guests = packGuests(readGuests(state.saved).map(guest => guest.target === id + 1
    ? { ...guest, target: 0, phase: PHASE.WALK, wait: 0 } : guest));
  return changed(state, { ...state.saved, g, o, v: guests,
    c: Math.min(RULES.cashLimit, state.saved.c + Math.floor(kind.cost * RULES.refundFraction)) });
}

export function placePath(state, x, y) {
  const error = tileRefusal(state, x, y);
  if (error) return error;
  const p = tileIndex(x, y);
  if (state.saved.g[p] !== TILE.EMPTY) return refuse("blocked");
  if (state.saved.c < RULES.pathCost) return refuse("unaffordable");
  const g = [...state.saved.g];
  g[p] = TILE.PATH;
  return changed(state, { ...state.saved, g, c: state.saved.c - RULES.pathCost });
}

export function removePath(state, x, y) {
  if (!inBounds(x, y)) return refuse("out-of-bounds");
  const p = tileIndex(x, y);
  if (p === GATE) return refuse("gate");
  if (state.saved.g[p] !== TILE.PATH) return refuse("not-path");
  const g = [...state.saved.g];
  g[p] = TILE.EMPTY;
  return changed(state, { ...state.saved, g });
}

export function buyLand(state, parcelX, parcelY) {
  if (!Number.isInteger(parcelX) || !Number.isInteger(parcelY) || parcelX < 0 || parcelY < 0
    || parcelX >= PARCEL_COLUMNS || parcelY >= GRID.height / RULES.parcelSize) return refuse("out-of-bounds");
  const bit = 1 << (parcelY * PARCEL_COLUMNS + parcelX);
  if (state.saved.l & bit) return refuse("owned");
  const adjacent = [[parcelX - 1, parcelY], [parcelX + 1, parcelY], [parcelX, parcelY - 1], [parcelX, parcelY + 1]];
  if (!adjacent.some(([x, y]) => isOwned(state.saved, x * RULES.parcelSize, y * RULES.parcelSize))) return refuse("isolated");
  if (state.saved.c < RULES.landCost) return refuse("unaffordable");
  return { saved: { ...state.saved, l: state.saved.l | bit, c: state.saved.c - RULES.landCost },
    derived: { ...state.derived } };
}
