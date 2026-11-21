/* THE height function of a resort and the ground attributes (pure: no THREE, no DOM; the Node checks use the same code).
 *
 *   baseHeight(x, z)  = the far grid (40 m, box + 14 km) everywhere, blended into the 5 m height tiles where they are loaded. A loaded tile
 *                       fades into the far grid over DATA.feather m along every side whose neighbour is missing (not shipped, or still
 *                       streaming), so the function stays continuous while tiles arrive: there is never a step or a hole.
 *   relief            = wind drifts off the piste, soft rollers on it (value noise), none in villages or on frozen lakes.
 *   attrs(x, z)       = piste (0..1, analytic from the piste lines + the piste-area raster), forest, rock, built, water (class raster)
 *
 * Bicubic reads are the clamped Catmull-Rom of pb/mtb/base-field.js (smooth, never overshooting the four nodes around the point). */
import { DATA, RELIEF, LATTICE } from './config.js';
import { valueNoise } from './noise.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CELLS = DATA.tileCells;
const SIDE = CELLS + 1;

function catmull(t) {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

/* Catmull-Rom of four values, clamped to the two middle ones (no overshoot at a cliff). The clamp is applied per row and then to the
 * column, so the result is continuous across every cell edge (a clamp to the min / max of the four cell corners is NOT: it jumps by
 * metres at steep steps, which the harness caught). */
function cr(w, p0, p1, p2, p3) {
  const v = w[0] * p0 + w[1] * p1 + w[2] * p2 + w[3] * p3;
  const lo = p1 < p2 ? p1 : p2, hi = p1 < p2 ? p2 : p1;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamped Catmull-Rom sample of a grid { nx, nz, data } at fractional node coordinates (gx, gz). */
export function sampleBicubic(grid, x, z) {
  const { nx, nz, data } = grid;
  const gx = Math.min(nx - 1.0000001, Math.max(0, x));
  const gz = Math.min(nz - 1.0000001, Math.max(0, z));
  const i = Math.floor(gx), j = Math.floor(gz);
  const wx = catmull(gx - i), wz = catmull(gz - j);
  const c0 = Math.max(0, i - 1), c3 = Math.min(nx - 1, i + 2);
  const r = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const o = Math.min(nz - 1, Math.max(0, j - 1 + k)) * nx;
    r[k] = cr(wx, data[o + c0], data[o + i], data[o + i + 1], data[o + c3]);
  }
  return cr(wz, r[0], r[1], r[2], r[3]);
}

/** Piste network for the analytic mask: segments in a 100 m spatial hash. lines = [{ d, w, p:[x,z,...] }] (areas live in the raster). */
export function createPisteNet(network) {
  const CELL = 100;
  const segs = [];             // [ax, az, bx, bz, hw, diff]
  const grid = new Map();
  const key = (i, j) => i * 65536 + j;
  for (const line of network) {
    if (line.a) continue;
    const p = line.p, hw = line.w, diff = networkDiff(line.d);
    for (let k = 0; k + 3 < p.length; k += 2) {
      const s = segs.length;
      segs.push([p[k], p[k + 1], p[k + 2], p[k + 3], hw, diff]);
      const pad = hw + 12;
      const i0 = Math.floor((Math.min(p[k], p[k + 2]) - pad) / CELL), i1 = Math.floor((Math.max(p[k], p[k + 2]) + pad) / CELL);
      const j0 = Math.floor((Math.min(p[k + 1], p[k + 3]) - pad) / CELL), j1 = Math.floor((Math.max(p[k + 1], p[k + 3]) + pad) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(s); }
    }
  }
  const empty = [];
  /** out = { mask, diff, dist }: soft groomed mask (soft edge widened to `soft` m), colour of the nearest line, distance beyond its edge. */
  function query(x, z, out, soft = 5) {
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || empty;
    let best = 0, bestEdge = 1e9, diff = -1;
    for (let n = 0; n < list.length; n++) {
      const s = segs[list[n]];
      const ax = s[0], az = s[1], dx = s[2] - ax, dz = s[3] - az;
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      const edge = Math.sqrt(ex * ex + ez * ez) - s[4];
      if (edge < bestEdge) { bestEdge = edge; diff = s[5]; }
      const m = smoothstep(soft, -3, edge);
      if (m > best) best = m;
    }
    out.mask = best; out.diff = diff; out.dist = bestEdge;
    return out;
  }
  return { query, segments: segs };
}

/** Network lines store their colour as one letter: g green, b blue, r red, k black (scripts/ski/bake.py DIFF_LETTER). */
function networkDiff(letter) {
  return letter === 'g' ? 0 : letter === 'b' ? 1 : letter === 'r' ? 2 : 3;
}

/* Kickers: small natural-looking snow bumps with a lip, on the selectable blue / red / black pistes every KICK_GAP m (from 150 m after the
 * start to 160 m before the finish), centred on the piste line, narrow enough to ski round. They are part of THE height function, so the
 * picture and the physics agree; the skier takes off at the lip by itself (skier.js leaveGround). Deterministic from resort.json. */
const KICK_GAP = 320, KICK_LEN = 15, KICK_HALF_W = 4.5;
const KICK_H = { blue: 0.7, red: 0.95, black: 1.15 };
export function createKickers(pistes) {
  const list = [];
  for (const p of pistes) {
    const h = KICK_H[p.diff];
    if (!h) continue;
    const L = p.line, n = L.length / 2;
    let s = 0, next = 150;
    for (let i = 1; i < n; i++) {
      const dx = L[2 * i] - L[2 * i - 2], dz = L[2 * i + 1] - L[2 * i - 1], d = Math.hypot(dx, dz);
      if (s + d >= next && next < p.len - 160) {
        const k = (next - s) / d;
        list.push({ x: L[2 * i - 2] + dx * k, z: L[2 * i - 1] + dz * k, ux: dx / d, uz: dz / d, h });
        next += KICK_GAP;
      }
      s += d;
    }
  }
  const CELL = 64, grid = new Map();
  const key = (i, j) => i * 65536 + j;
  list.forEach((b, idx) => {
    for (let i = Math.floor((b.x - KICK_LEN) / CELL); i <= Math.floor((b.x + KICK_LEN) / CELL); i++)
      for (let j = Math.floor((b.z - KICK_LEN) / CELL); j <= Math.floor((b.z + KICK_LEN) / CELL); j++) { const kk = key(i, j); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(idx); }
  });
  const empty = [];
  /** Extra height at (x, z): rises over 70 % of the length (the run-up), drops off over the last 30 % (the lip and landing). */
  function at(x, z) {
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || empty;
    let best = 0;
    for (let n = 0; n < l.length; n++) {
      const b = list[l[n]];
      const rx = x - b.x, rz = z - b.z;
      const u = (rx * b.ux + rz * b.uz) / KICK_LEN + 0.5;        // 0 .. 1 along the fall line
      const v = (rx * -b.uz + rz * b.ux) / KICK_HALF_W;           // -1 .. 1 across
      if (u <= 0 || u >= 1 || v <= -1 || v >= 1) continue;
      const along = u < 0.7 ? smoothstep(0, 0.7, u) : 1 - smoothstep(0.7, 1, u) ;
      const across = 0.5 + 0.5 * Math.cos(Math.PI * v);
      const hh = b.h * along * across;
      if (hh > best) best = hh;
    }
    return best;
  }
  return { at, list };
}

/**
 * createField({ resort, far, classes }) -> field. Height tiles arrive later through addTile(tx, tz, grid).
 *   far     = decoded MBG1 grid (nodes at -margin + i * farStep)
 *   classes = { nx, nz, data: Uint8Array } (cells of DATA.classStep m, bit field resort.classes.bits)
 */
export function createField({ resort, far, classes, net, kickers = createKickers(resort.pistes) }) {
  const bits = resort.classes.bits;
  const margin = resort.far.margin, farStep = resort.far.step;
  const tilesX = resort.tiles.nx, tilesZ = resort.tiles.nz;
  const shipped = new Set(resort.tiles.list.map(([tx, tz]) => tx * 1000 + tz));
  const tiles = new Map();                 // tx*1000+tz -> { data: Float32Array, near: [[x0,z0,x1,z1], ...] missing-neighbour rects }
  const feather = DATA.feather;
  const tileSize = DATA.tileSize, step = DATA.nearStep;
  const pq = { mask: 0, diff: -1, dist: 1e9 };

  const farHeight = (x, z) => sampleBicubic(far, (x + margin) / farStep, (z + margin) / farStep);

  function refreshNeighbours() {
    for (const [k, t] of tiles) {
      const tx = Math.floor(k / 1000), tz = k % 1000;
      const rects = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (tiles.has((tx + dx) * 1000 + (tz + dz))) continue;
        const x0 = (tx + dx) * tileSize, z0 = (tz + dz) * tileSize;
        rects.push([x0, z0, x0 + tileSize, z0 + tileSize]);
      }
      t.near = rects;
    }
  }

  function weight(t, x, z) {
    let d = feather;
    const r = t.near;
    for (let n = 0; n < r.length; n++) {
      const q = r[n];
      const dx = Math.max(q[0] - x, 0, x - q[2]), dz = Math.max(q[1] - z, 0, z - q[3]);
      const dd = Math.sqrt(dx * dx + dz * dz);
      if (dd < d) d = dd;
    }
    return smoothstep(0, feather, d);
  }

  /** A near node by global index (5 m lattice); a missing tile answers with the far grid there. */
  function node(gi, gj) {
    let tx = Math.floor(gi / CELLS), tz = Math.floor(gj / CELLS);
    let i = gi - tx * CELLS, j = gj - tz * CELLS;
    let t = tiles.get(tx * 1000 + tz);
    if (!t && i === 0 && tx > 0) { const o = tiles.get((tx - 1) * 1000 + tz); if (o) { t = o; tx -= 1; i = CELLS; } }
    if (!t && j === 0 && tz > 0) { const o = tiles.get(tx * 1000 + tz - 1); if (o) { t = o; tz -= 1; j = CELLS; } }
    return t ? t.data[j * SIDE + i] : farHeight(gi * step, gj * step);
  }

  function nearHeight(t, tx, tz, x, z) {
    const gx = x / step, gz = z / step;
    const gi = Math.floor(gx), gj = Math.floor(gz);
    const li = gi - tx * CELLS, lj = gj - tz * CELLS;
    const wx = catmull(gx - gi), wz = catmull(gz - gj);
    const r = [0, 0, 0, 0];
    if (li >= 1 && li <= CELLS - 2 && lj >= 1 && lj <= CELLS - 2) {        // fast path: the 4 x 4 stencil lies in this tile
      const data = t.data;
      for (let k = 0; k < 4; k++) {
        const o = (lj - 1 + k) * SIDE + li - 1;
        r[k] = cr(wx, data[o], data[o + 1], data[o + 2], data[o + 3]);
      }
    } else {
      for (let k = 0; k < 4; k++) r[k] = cr(wx, node(gi - 1, gj - 1 + k), node(gi, gj - 1 + k), node(gi + 1, gj - 1 + k), node(gi + 2, gj - 1 + k));
    }
    return cr(wz, r[0], r[1], r[2], r[3]);
  }

  function baseHeight(x, z) {
    const hf = farHeight(x, z);
    const tx = Math.floor(x / tileSize), tz = Math.floor(z / tileSize);
    const t = tiles.get(tx * 1000 + tz);
    if (!t) return hf;
    const w = weight(t, x, z);
    if (w <= 0) return hf;
    const hn = nearHeight(t, tx, tz, x, z);
    return w >= 1 ? hn : hf + (hn - hf) * w;
  }

  function classBit(i, j, bit) {
    if (i < 0 || j < 0 || i >= classes.nx || j >= classes.nz) return 0;
    return (classes.data[j * classes.nx + i] & bit) ? 1 : 0;
  }
  /** Bilinear share of a class bit at (x, z). */
  function classShare(x, z, bit) {
    const gx = x / DATA.classStep - 0.5, gz = z / DATA.classStep - 0.5;
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    return (classBit(i, j, bit) * (1 - fx) + classBit(i + 1, j, bit) * fx) * (1 - fz) + (classBit(i, j + 1, bit) * (1 - fx) + classBit(i + 1, j + 1, bit) * fx) * fz;
  }

  /** Ground attributes at (x, z) into out = { piste, diff, forest, rock, built, water }; `lod` = node spacing of the caller (softer piste edge). */
  function attrs(x, z, out, lod = LATTICE) {
    net.query(x, z, pq, Math.max(5, lod));
    const area = classShare(x, z, bits.piste);
    out.piste = Math.max(pq.mask, area);
    out.diff = pq.diff;
    out.dist = area > 0.05 ? -1 : pq.dist;
    out.forest = Math.min(1, classShare(x, z, bits.forest) + 0.55 * classShare(x, z, bits.scrub));
    out.rock = Math.min(1, classShare(x, z, bits.rock) + 0.6 * classShare(x, z, bits.scree));
    out.built = classShare(x, z, bits.built);
    out.water = classShare(x, z, bits.water);
    out.glacier = classShare(x, z, bits.glacier);
    return out;
  }

  function relief(x, z, a) {
    const calm = (1 - a.built) * (1 - a.water);
    if (calm <= 0) return 0;
    const drift = (valueNoise(x / RELIEF.driftScale, z / (RELIEF.driftScale * 0.6), 3) * 2 - 1) * 0.7 + (valueNoise(x / 7.3, z / 9.1, 5) * 2 - 1) * 0.3;
    const roll = valueNoise(x / RELIEF.pisteScale, z / RELIEF.pisteScale, 9) * 2 - 1;
    return calm * ((1 - a.piste) * RELIEF.driftAmp * drift + a.piste * RELIEF.pisteAmp * roll);
  }

  const scratch = { piste: 0, diff: -1, forest: 0, rock: 0, built: 0, water: 0, glacier: 0 };
  /** Full-detail height with attributes already known (the physics lattice). */
  function heightWith(x, z, a) { return baseHeight(x, z) + relief(x, z, a) + kickers.at(x, z); }
  function height(x, z) { return heightWith(x, z, attrs(x, z, scratch)); }
  /** What a lattice of spacing `lod` shows: the relief fades out between 2.5 and 10 m spacing (it cannot be sampled coarser). */
  function heightForStep(x, z, lod, a) {
    const k = 1 - smoothstep(LATTICE, 10, lod);
    if (k <= 0) return baseHeight(x, z);
    return baseHeight(x, z) + k * (relief(x, z, a || attrs(x, z, scratch, lod)) + kickers.at(x, z));
  }

  /** A height tile arrived: returns the world rectangle whose heights changed (the tile + the feather of its neighbours). */
  function addTile(tx, tz, grid) {
    tiles.set(tx * 1000 + tz, { data: grid.data, near: [] });
    refreshNeighbours();
    const pad = feather + 2 * DATA.nearStep;
    return [tx * tileSize - pad, tz * tileSize - pad, (tx + 1) * tileSize + pad, (tz + 1) * tileSize + pad];
  }

  return {
    baseHeight, height, heightWith, kickers, heightForStep, attrs, farHeight, addTile,
    hasTile: (tx, tz) => tiles.has(tx * 1000 + tz),
    isShipped: (tx, tz) => shipped.has(tx * 1000 + tz),
    tileCount: () => tiles.size,
    width: resort.width, depth: resort.depth, tilesX, tilesZ,
  };
}
