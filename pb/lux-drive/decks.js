/* The bridge decks of Lux Drive: a bridge is NOT carved into the terrain (the LiDAR DTM under a bridge is the
 * ground below it), so every OSM way tagged bridge=yes becomes a solid deck - a polyline with the real deck
 * height at every point (the LiDAR DSM), pinned to the ground at its two ends.
 *
 * Pure functions, shared by the physics, the renderer and the Node harness. */
import { ROAD } from './config.js';

export const DECK = Object.freeze({
  margin: 0.8,             // m beside the deck that still counts as deck (the parapet keeps the car on it)
  thickness: 0.6,          // m of solid under the deck surface (a deck is not a floating ribbon)
  stickBelow: 0.6,         // the car counts as "on" the deck when it is at most this far below the surface
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

/** decks.bin -> [{ id, parapet, width, pts: [[x, z]], tops: [y] }] */
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
    decks.push({ id: d, parapet: (flags & 1) !== 0, width, pts, tops });
  }
  return decks;
}

/**
 * The deck network: the segments of every deck in a spatial hash, so the ground function can ask
 * "is there a deck over this point, and how high is it?".
 */
export function createDeckNetwork(decks) {
  const ax = [], az = [], bx = [], bz = [], t0 = [], t1 = [], half = [];
  for (const d of decks) {
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

  return { deckAt, count, decks };
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
    onDeck(x, z) { return !!deckNetwork && deckNetwork.count > 0 && deckNetwork.deckAt(x, z, hintY, scratch) !== null; },
    surface, decks: deckNetwork ? deckNetwork.decks : [],
  };
  return out;
}

export { ROAD };
