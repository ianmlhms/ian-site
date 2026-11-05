/* The bridge decks of Lux Drive: a bridge is NOT carved into the terrain (the LiDAR DTM under a bridge is the
 * ground below it), so every OSM way tagged bridge=yes becomes a solid deck - a polyline with the real deck
 * height at every point (the LiDAR DSM), pinned to the ground at its two ends.
 *
 * Pure functions, shared by the physics, the renderer and the Node harness. */
import { ROAD } from './config.js';

export const DECK = Object.freeze({
  margin: 0.8,             // m beside the deck that still counts as deck (the parapet keeps the car on it)
  thickness: 1.0,          // m of solid under the deck surface (a deck is not a floating ribbon)
  stickBelow: 0.6,         // the car counts as "on" the deck when it is at most this far below the surface
  spanDip: 3.0,            // m: the land dips this far under the way, so the deck spans it (the bake writes the same number)
  cell: 32,                // m, the spatial hash cell
});

const DECIMETRE = 0.1;

function readVarint(bytes, state) {
  let result = 0, shift = 0;
  for (;;) {
    const b = bytes[state.pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return result;
    shift += 7;
    if (shift > 49) throw new Error('decks: varint too long');
  }
}
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

const FLAG_PARAPET = 1, FLAG_SPANS = 2, FLAG_REMOVED = 4;   // bit 2: the deck is not a bridge (it lies on a carriageway at road level): scripts/luxdrive/bake_deck_fixes.mjs

/** decks.bin -> [{ id, parapet, spans, width, pts: [[x, z]], tops: [y] }].  `id` is the index in the file; a removed deck keeps its index but is not returned. */
export function decodeDecks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const decks = [];
  for (let d = 0; d < count; d++) {
    const flags = view.getUint16(state.pos, true);
    const width = view.getUint16(state.pos + 2, true) * DECIMETRE;
    const n = view.getUint16(state.pos + 4, true);
    let x = view.getInt32(state.pos + 6, true);
    let z = view.getInt32(state.pos + 10, true);
    state.pos += 14;
    const pts = [[x * DECIMETRE, z * DECIMETRE]];
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bytes, state));
      z += unzigzag(readVarint(bytes, state));
      pts.push([x * DECIMETRE, z * DECIMETRE]);
    }
    const tops = new Float32Array(n);
    for (let i = 0; i < n; i++) { tops[i] = view.getFloat32(state.pos, true); state.pos += 4; }
    if ((flags & FLAG_REMOVED) !== 0) continue;
    decks.push({ id: d, parapet: (flags & FLAG_PARAPET) !== 0, spans: (flags & FLAG_SPANS) !== 0, width, pts, tops });
  }
  return decks;
}

const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);

/**
 * [{ id?, parapet, spans, width, pts, tops, removed? }] -> decks.bin bytes (the exact inverse of decodeDecks: positions in decimetres).  The file order is the id: a deck that is
 * dropped keeps its slot with the removed flag, so every id that a landmark refers to stays valid.
 */
export function encodeDecks(decks) {
  const bytes = [];
  const push32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); bytes.push(...b); };
  const push16 = (v) => { bytes.push(v & 255, (v >> 8) & 255); };
  const pushVar = (v) => { let r = v; while (r >= 0x80) { bytes.push((r % 0x80) | 0x80); r = Math.floor(r / 0x80); } bytes.push(r); };
  push32(decks.length);
  for (const d of decks) {
    const n = d.pts.length;
    push16((d.parapet ? FLAG_PARAPET : 0) | (d.spans ? FLAG_SPANS : 0) | (d.removed ? FLAG_REMOVED : 0));
    push16(Math.round(d.width / DECIMETRE));
    push16(n);
    let x = Math.round(d.pts[0][0] / DECIMETRE), z = Math.round(d.pts[0][1] / DECIMETRE);
    push32(x); push32(z);
    for (let i = 1; i < n; i++) {
      const nx = Math.round(d.pts[i][0] / DECIMETRE), nz = Math.round(d.pts[i][1] / DECIMETRE);
      pushVar(zigzag(nx - x)); pushVar(zigzag(nz - z));
      x = nx; z = nz;
    }
    for (let i = 0; i < n; i++) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, d.tops[i], true); bytes.push(...b); }
  }
  return Uint8Array.from(bytes);
}

/**
 * The deck network: the segments of every deck in a spatial hash, so the ground function can ask
 * "is there a deck over this point, and how high is it?".
 *
 * surface: the ground the game draws (the land with the roads carved into it).  The two ends of a deck stand
 * on it: the approach road is cut into the land, so the end of the deck has to be at the level of that road
 * and not at the level of the land above it, or the bridge hangs in the air over its own approach.
 */
export function createDeckNetwork(decks, surface = null) {
  const list = decks.map((d) => {
    if (!surface || d.pts.length < 2) return d;
    const tops = Float32Array.from(d.tops);
    const last = d.pts.length - 1;
    tops[0] = surface.height(d.pts[0][0], d.pts[0][1]);
    tops[last] = surface.height(d.pts[last][0], d.pts[last][1]);
    return { ...d, tops };
  });
  const ax = [], az = [], bx = [], bz = [], t0 = [], t1 = [], half = [];
  for (const d of list) {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      ax.push(d.pts[i][0]); az.push(d.pts[i][1]);
      bx.push(d.pts[i + 1][0]); bz.push(d.pts[i + 1][1]);
      t0.push(d.tops[i]); t1.push(d.tops[i + 1]);
      half.push(d.width / 2);
    }
  }
  const count = ax.length;
  const AX = Float32Array.from(ax), AZ = Float32Array.from(az);
  const BX = Float32Array.from(bx), BZ = Float32Array.from(bz);
  const T0 = Float32Array.from(t0), T1 = Float32Array.from(t1);
  const HALF = Float32Array.from(half);
  const CELL = DECK.cell;
  const cellKey = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const minX = Math.min(AX[i], BX[i]), maxX = Math.max(AX[i], BX[i]);
    const minZ = Math.min(AZ[i], BZ[i]), maxZ = Math.max(AZ[i], BZ[i]);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = cellKey(cx, cz);
        const list = buckets.get(key);
        if (list) list.push(i); else buckets.set(key, [i]);
      }
    }
  }
  const cells = new Map();
  for (const [key, list] of buckets) cells.set(key, Int32Array.from(list));
  const EMPTY = new Int32Array(0);

  /** The deck over (x, z) whose surface the car can stand on (or null). out = { top, slope, ux, uz, along }. */
  function deckAt(x, z, y, out) {
    if (count === 0) return null;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          const ax0 = AX[i], az0 = AZ[i];
          const ex = BX[i] - ax0, ez = BZ[i] - az0;
          const ll = ex * ex + ez * ez;
          if (ll < 1e-9) continue;
          let t = ((x - ax0) * ex + (z - az0) * ez) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax0 + ex * t, qz = az0 + ez * t;
          const side = Math.abs((x - qx) * -ez + (z - qz) * ex) / Math.sqrt(ll);
          if (side > HALF[i] + DECK.margin) continue;
          const top = T0[i] + (T1[i] - T0[i]) * t;
          if (y < top - DECK.stickBelow) continue;              // the car is under the deck: the ground stays the ground
          if (!best || top > best.top) {
            const len = Math.sqrt(ll);
            out.top = top;
            out.slope = (T1[i] - T0[i]) / len;
            out.ux = ex / len; out.uz = ez / len;
            out.along = (x - ax0) * out.ux + (z - az0) * out.uz;
            best = out;
          }
        }
      }
    }
    return best;
  }

  /**
   * The underside of the lowest deck that lies ABOVE height `y` over (x, z) (or Infinity): the camera keeps below it when the
   * car drives under a bridge, so the lens never ends up inside or on top of a deck it is not on.
   */
  function overheadAt(x, z, y) {
    if (count === 0) return Infinity;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let lowest = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < bucket.length; q++) {
          const i = bucket[q];
          const ax0 = AX[i], az0 = AZ[i];
          const ex = BX[i] - ax0, ez = BZ[i] - az0;
          const ll = ex * ex + ez * ez;
          if (ll < 1e-9) continue;
          let t = ((x - ax0) * ex + (z - az0) * ez) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const side = Math.abs((x - (ax0 + ex * t)) * -ez + (z - (az0 + ez * t)) * ex) / Math.sqrt(ll);
          if (side > HALF[i] + DECK.margin) continue;
          const bottom = T0[i] + (T1[i] - T0[i]) * t - DECK.thickness;
          if (bottom > y && bottom < lowest) lowest = bottom;
        }
      }
    }
    return lowest;
  }

  return { deckAt, overheadAt, count, decks: list };
}

/** The ground the car, the camera and the renderer see: the terrain surface, with the bridge decks on top.
 *  `hint(y)` tells it how high the car is (a car UNDER a bridge stays under it). */
export function createGround(surface, deckNetwork) {
  let hintY = 1e9;
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  const out = {
    height(x, z) {
      const g = surface.height(x, z);
      if (!deckNetwork || deckNetwork.count === 0) return g;
      const hit = deckNetwork.deckAt(x, z, hintY, scratch);
      return hit && hit.top > g ? hit.top : g;
    },
    normal(x, z, o) {
      if (deckNetwork && deckNetwork.count > 0) {
        const g = surface.height(x, z);
        const hit = deckNetwork.deckAt(x, z, hintY, scratch);
        if (hit && hit.top > g) {                          // the deck is a plane along its axis
          const slope = hit.slope;
          const l = Math.hypot(slope, 1);
          o.x = -slope * hit.ux / l; o.y = 1 / l; o.z = -slope * hit.uz / l;
          return o;
        }
      }
      return surface.normal(x, z, o);
    },
    hint(y) { hintY = y; },
    /** The underside of the lowest deck above height y over (x, z), Infinity when the sky is free. */
    overheadAt(x, z, y) { return deckNetwork ? deckNetwork.overheadAt(x, z, y) : Infinity; },
    onDeck(x, z) { return !!deckNetwork && deckNetwork.count > 0 && deckNetwork.deckAt(x, z, hintY, scratch) !== null; },
    surface, decks: deckNetwork ? deckNetwork.decks : [],
  };
  return out;
}

export { ROAD };
