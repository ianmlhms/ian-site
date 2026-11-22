/* Round 7-C (pure): the places a player has discovered in a resort, for the map teleport.
 *   grid      DISCOVERY.cell (100 m) cells over the resort box, one bit each; a cell counts as discovered once the skier came within
 *             DISCOVERY.reveal m of it, reached a lift station near it (DISCOVERY.station m) or rode a lift over it
 *   saved     run-length text "a,b,c,..." (base 36: alternating runs of undiscovered / discovered cells, row-major, starting with an
 *             undiscovered run): progress.disc[<resort>] locally and cloud record field `d` (cloud.js); merging two saves is a union of
 *             their runs, so it needs no grid size and never loses a cell. */
import { DISCOVERY } from '../config.js';

const RLE_RE = /^[0-9a-z]+(,[0-9a-z]+)*$/;
export const MAX_RLE = 12000;          // characters per resort (a fully explored 3 Vallées is far less: its runs are long)
export const MAX_CELLS = 1 << 20;      // security: no resort box has more 100 m cells (3 Vallées ~ 300 x 230); a run past this = a forgery

/** Runs text -> [[start, end), ...] of discovered cells. Bad text -> []. */
export function rleIntervals(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_RLE || !RLE_RE.test(text)) return [];
  const out = [];
  let i = 0, on = false;
  for (const w of text.split(',')) {
    const n = parseInt(w, 36);
    if (!Number.isFinite(n) || n < 0 || i + n > MAX_CELLS) return [];
    if (on && n > 0) out.push([i, i + n]);
    i += n; on = !on;
  }
  return out;
}
export function intervalsRle(list) {
  const runs = [];
  let i = 0;
  for (const [a, b] of list) { runs.push((a - i).toString(36), (b - a).toString(36)); i = b; }
  return runs.join(',');
}
/** Union of two runs texts (pure). */
export function mergeRle(a, b) {
  const all = [...rleIntervals(a), ...rleIntervals(b)].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return intervalsRle(out);
}

export function createDiscovery({ width, depth, cell = DISCOVERY.cell, saved = '' }) {
  const nx = Math.ceil(width / cell), nz = Math.ceil(depth / cell);
  const bits = new Uint8Array(nx * nz);
  let count = 0, dirty = false, version = 0;
  for (const [a, b] of rleIntervals(saved)) for (let i = a; i < Math.min(b, bits.length); i++) if (!bits[i]) { bits[i] = 1; count++; }
  const cellOf = (x, z) => {
    const i = Math.floor(x / cell), j = Math.floor(z / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
  };
  /** Mark every cell whose centre lies within r m of (x, z); true if anything new. */
  function reveal(x, z, r = DISCOVERY.reveal) {
    let added = 0;
    const i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r) / cell));
    const j0 = Math.max(0, Math.floor((z - r) / cell)), j1 = Math.min(nz - 1, Math.floor((z + r) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (bits[k]) continue;
        // the nearest point of the cell (so the cell the skier stands in always counts)
        const cx = Math.max(i * cell, Math.min(x, (i + 1) * cell)), cz = Math.max(j * cell, Math.min(z, (j + 1) * cell));
        if (Math.hypot(cx - x, cz - z) <= r) { bits[k] = 1; added++; }
      }
    }
    if (added) { count += added; dirty = true; version++; }
    return added > 0;
  }
  /** Mark the cells along a polyline [x0, z0, x1, z1, ...] (a lift ridden), r m to each side. */
  function revealLine(pts, r = DISCOVERY.reveal * 0.6) {
    let any = false;
    for (let k = 2; k < pts.length; k += 2) {
      const ax = pts[k - 2], az = pts[k - 1], bx = pts[k], bz = pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.5)));
      for (let t = 0; t <= n; t++) any = reveal(ax + (bx - ax) * t / n, az + (bz - az) * t / n, r) || any;
    }
    return any;
  }
  const has = (x, z) => { const k = cellOf(x, z); return k >= 0 && bits[k] === 1; };
  function encode() {
    const list = [];
    let start = -1;
    for (let k = 0; k <= bits.length; k++) {
      const on = k < bits.length && bits[k] === 1;
      if (on && start < 0) start = k;
      if (!on && start >= 0) { list.push([start, k]); start = -1; }
    }
    return intervalsRle(list);
  }
  /** Merge a saved runs text in (cloud copy): true if anything new. */
  function absorb(text) {
    let added = 0;
    for (const [a, b] of rleIntervals(text)) for (let i = a; i < Math.min(b, bits.length); i++) if (!bits[i]) { bits[i] = 1; added++; }
    if (added) { count += added; dirty = true; version++; }
    return added > 0;
  }
  return {
    nx, nz, cell, bits, reveal, revealLine, has, encode, absorb,
    get count() { return count; }, get version() { return version; },
    /** True once after a change (the caller saves then). */
    takeDirty() { const d = dirty; dirty = false; return d; },
    share: () => count / bits.length,
  };
}
