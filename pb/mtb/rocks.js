/* Sandstone placement, per 32 m block (deterministic, pure; the browser draws the result, the harness proves that every rock sits INTO the ground).
 *
 * Rocks are instanced models (rock-models.js). A rock is a closed solid: its bottom ring is flagged as "skirt" and is lowered by `sink` metres in the vertex shader, so the
 * solid always reaches below the terrain on every side (the harness checks this against the physics surface for every rock).
 *   slab      a cliff piece laid over a steep slope (or an OSM cliff line): face parallel to the slope, strata, corridor walls along the trails
 *   overhang  the same with an undercut and a cap
 *   boulder   a free rock; stones in the streams are small boulders half under the water
 * Instance record, stride 12: [x, y, z, yaw, alpha, sx, sy, sz, sink, kind, seed, topY]
 *   (x, y, z) the foot centre of the rock; the model is scaled by (sx along the contour, sy up the slope, sz depth), tilted by alpha = asin(normal.y) about its x axis
 *   (0 for a boulder) and turned by yaw about y so that its face (+z) looks along the slope normal. */
import { QUADTREE } from './config.js';
import { createRng } from './noise.js';
import { sampleWorldMap, sampleFieldCell } from './world-map.js';
import { wayFree } from './forest.js';

export const BLOCK = QUADTREE.minSize;
export const R_STRIDE = 12;
export const KIND = Object.freeze({ slabA: 0, slabB: 1, overhang: 2, boulderA: 3, boulderB: 4, stone: 5 });
const SLAB_GRID = 6;                       // slab candidates per side of a block (5.3 m)
const BOULDER_CANDIDATES = 9;
const STEEP_FULL = 0.55, STEEP_NONE = 0.83;  // normal.y: slope probability ramps from 0 (n.y 0.8, 37 degrees) to 1 (n.y 0.5, 60 degrees)
const WALL_CLEARANCE = 0.02;               // way coverage allowed under a rock footprint
const MIN_SINK = 0.7, MAX_SINK = 6;
const SINK_MARGIN = 0.6;                   // m the bottom goes below the lowest terrain under the footprint
const HEIGHT_RANGE = [3.0, 6.0];           // slab height along the slope
const WIDTH_RANGE = [4.6, 8.8];
const DEPTH = 1.8;                         // how far a slab reaches into the hill
const FACE_LIFT = 0.28;                    // the face stands this far in front of the slope (the strata recesses stay in front of the ground)
const KEEP_CLEAR = 2.5;                    // m: no rock body, log or stump within this distance of the centre line of ANY trail, path or track (whichever trails exist)
const CORRIDOR_STEP = 6;                   // m of trail between two corridor-rock checks
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const scratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
const cell = { field: 0, leaf: 0, hedge: 0, cliff: 0 };
const nrm = { x: 0, y: 1, z: 0 };

/** World position of a model-space point of a slab: the slab frame is x = along the contour, y = up the slope, z = out of the slope (the face normal). */
export function slabFrame(nx, ny, nz) {
  const hl = Math.hypot(nx, nz) || 1e-6;
  const nhx = nx / hl, nhz = nz / hl;
  return { x: [-nhz, 0, nhx], y: [-ny * nhx, hl, -ny * nhz], z: [nx, ny, nz], yaw: Math.atan2(nx, nz), alpha: Math.asin(Math.min(1, ny)), hl };
}

const along = (f, a, b, c) => [f.x[0] * a + f.y[0] * b + f.z[0] * c, f.x[1] * a + f.y[1] * b + f.z[1] * c, f.x[2] * a + f.y[2] * b + f.z[2] * c];

/** The solid's bottom ring (world positions) for the sink computation / the harness: the 4 corners and 4 edge midpoints of the y = 0 rectangle (x +-sx/2, z 0 .. -sz). */
export function slabBottomRing(r, f) {
  const out = [];
  for (const [u, w] of [[-0.5, 0], [0, 0], [0.5, 0], [0.5, -0.5], [0.5, -1], [0, -1], [-0.5, -1], [-0.5, -0.5]]) {
    const o = along(f, u * r.sx, 0, w * r.sz);
    out.push([r.x + o[0], r.y + o[1], r.z + o[2]]);
  }
  return out;
}

/** How far the bottom of a solid must be lowered so that it lies under the terrain on every side; null when that would take more than MAX_SINK (the rock stands on an edge: skip it). */
function sinkFor(ring, surface) {
  let worst = -1e9;
  for (const p of ring) worst = Math.max(worst, p[1] - surface.height(p[0], p[2]));
  const sink = Math.max(MIN_SINK, worst + SINK_MARGIN);
  return sink > MAX_SINK ? null : sink;
}

/** The rocks of block (bx, bz). ctx: { map, surface, clearance, ways (trail / path sample index), streams (stream sample index) }. */
export function rocksOfBlock(bx, bz, ctx) {
  const { map, surface, clearance } = ctx;
  const rng = createRng((bx * 2654435761) ^ (bz * 40503) ^ 0x2545f491);
  const out = [];
  const x0 = bx * BLOCK, z0 = bz * BLOCK;
  const keepClear = (x, z, r = KEEP_CLEAR) => !ctx.ridden || ctx.ridden.nearest(x, z, r + 0.01) >= r;
  const footprintFree = (cx, cz, f, w, d) => {
    for (const [u, v] of [[0, 0.3], [-0.5, 0.3], [0.5, 0.3], [-0.25, 0.3], [0.25, 0.3], [0, 0], [-0.5, 0], [0.5, 0], [-0.25, 0], [0.25, 0], [0, -0.5], [-0.5, -0.5], [0.5, -0.5], [0, -1], [-0.5, -1], [0.5, -1]]) {
      const o = along(f, u * w, 0, v * d);
      if (clearance(cx + o[0], cz + o[2]) > WALL_CLEARANCE) return false;
      if (v <= 0 && !keepClear(cx + o[0], cz + o[2])) return false;                    // (v > 0 is the open side in front of the face)
    }
    return true;
  };
  /** A slab: laid over a slope (the default: its face parallels the slope) or standing on the ground (`standing`: a free wall of a corridor, vertical). */
  const pushSlab = (px, pz, n, h, w, kind, seed, standing = false) => {
    const f = slabFrame(n.x, n.y, n.z);
    if (f.hl < 0.35) return false;                                  // not steep enough to lay a wall on
    const py = surface.height(px, pz);
    const fx = standing ? px + f.z[0] * FACE_LIFT : px - f.y[0] * h * 0.5 + f.z[0] * FACE_LIFT;
    const fy = standing ? py : py - f.y[1] * h * 0.5 + f.z[1] * FACE_LIFT;
    const fz = standing ? pz + f.z[2] * FACE_LIFT : pz - f.y[2] * h * 0.5 + f.z[2] * FACE_LIFT;
    if (!footprintFree(fx, fz, f, w, DEPTH)) return false;
    const r = { x: fx, y: fy, z: fz, sx: w, sz: DEPTH };
    const sink = sinkFor(slabBottomRing(r, f), surface);
    if (sink === null) return false;
    out.push(fx, fy, fz, f.yaw, f.alpha, w, h, DEPTH, sink, kind, seed, fy + f.y[1] * h);
    return true;
  };

  // ---- slabs on steep ground (and along the OSM cliff lines)
  const step = BLOCK / SLAB_GRID;
  for (let j = 0; j < SLAB_GRID; j++) {
    for (let i = 0; i < SLAB_GRID; i++) {
      const x = x0 + (i + 0.5) * step + (rng() - 0.5) * step * 0.8, z = z0 + (j + 0.5) * step + (rng() - 0.5) * step * 0.8;
      const roll = rng(), seed = rng(), sizeRoll = rng(), kindRoll = rng(), wRoll = rng();
      surface.normal(x, z, nrm);
      sampleFieldCell(map, x, z, cell);
      const m = sampleWorldMap(map, x, z, scratch);
      const steep = smooth(STEEP_NONE, STEEP_FULL, nrm.y);
      const hint = Math.max(cell.cliff, m.rock);
      const chance = Math.min(1, steep * (1.25 + 0.5 * hint) + (hint > 0.5 && nrm.y < 0.88 ? 0.35 * hint : 0));
      if (roll > chance) continue;
      const h = HEIGHT_RANGE[0] + (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]) * (0.3 + 0.7 * sizeRoll) * (0.7 + 0.5 * steep);
      const w = WIDTH_RANGE[0] + (WIDTH_RANGE[1] - WIDTH_RANGE[0]) * wRoll;
      pushSlab(x, z, nrm, h, w, kindRoll < 0.16 ? KIND.overhang : kindRoll < 0.58 ? KIND.slabA : KIND.slabB, seed);
    }
  }
  // ---- rock corridors: along a trail or path through rocky ground (OSM cliff lines or steep banks nearby) free-standing sandstone walls rise on both sides, with a cleft between
  if (ctx.ways) {
    for (const s of ctx.ways.samplesIn(bx, bz)) {
      if (rng() > 1 / (CORRIDOR_STEP / ctx.ways.spacing)) continue;
      let rocky = 0;
      for (const side of [-1, 1]) {
        for (const d of [3, 5, 8]) {
          sampleFieldCell(map, s.x + s.nx * side * d, s.z + s.nz * side * d, cell);
          if (cell.cliff > 0) rocky = Math.max(rocky, 1);
          surface.normal(s.x + s.nx * side * d, s.z + s.nz * side * d, nrm);
          if (nrm.y < 0.8) rocky = Math.max(rocky, 0.7);
        }
      }
      if (rocky < 0.6) continue;
      for (const side of [-1, 1]) {
        if (rng() < 0.22) continue;                                                 // a gap now and then: an opening in the wall
        const offset = 2.95 + rng() * 0.7;
        const lx = s.x + s.nx * side * offset, lz = s.z + s.nz * side * offset;
        if (lx < x0 || lx >= x0 + BLOCK || lz < z0 || lz >= z0 + BLOCK) continue;
        const face = { x: -s.nx * side, y: 0.1, z: -s.nz * side };               // the wall looks at the way (a little leaned back)
        const len = Math.hypot(face.x, face.y, face.z);
        face.x /= len; face.y /= len; face.z /= len;
        const h = 3.2 + 4.8 * (0.5 + 0.5 * Math.sin(s.x * 0.071 + s.z * 0.053 + side)) * (0.6 + 0.6 * rng());
        pushSlab(lx, lz, face, h, 4.6 + rng() * 3.4, rng() < 0.5 ? KIND.slabA : KIND.slabB, rng(), true);
      }
    }
  }
  // ---- boulders
  for (let k = 0; k < BOULDER_CANDIDATES; k++) {
    const x = x0 + rng() * BLOCK, z = z0 + rng() * BLOCK;
    const roll = rng(), seed = rng(), sizeRoll = rng(), kindRoll = rng(), yaw = rng() * 6.283;
    sampleFieldCell(map, x, z, cell);
    const m = sampleWorldMap(map, x, z, scratch);
    surface.normal(x, z, nrm);
    const chance = 0.05 + 0.5 * m.rock + 0.4 * cell.cliff + 0.45 * smooth(0.95, 0.7, nrm.y) + 0.12 * m.wet * m.cover;
    if (roll > chance || m.built > 0.1 || m.water > 0.3 || m.grass > 0.6 || clearance(x, z) > WALL_CLEARANCE) continue;
    const size = 0.7 + sizeRoll * sizeRoll * 2.4 + (sizeRoll > 0.97 ? 1.6 : 0);
    if (!wayFree(clearance, x, z, size * 0.75 + 0.4) || !keepClear(x, z, KEEP_CLEAR + size * 0.5)) continue;     // a boulder never touches the trail corridor (any trail, path or track)
    const y = surface.height(x, z);
    const ext = size * 0.6;
    const bx = size * (1.0 + (seed - 0.5) * 0.4), bz = size * (0.85 + (1 - seed) * 0.3);
    let worst = 0;
    for (let a = 0; a < 8; a++) worst = Math.max(worst, y + size * 0.1 - surface.height(x + Math.cos(a * Math.PI / 4) * Math.max(bx, bz) * 0.6, z + Math.sin(a * Math.PI / 4) * Math.max(bx, bz) * 0.6));
    void ext; void bz;
    const sink = Math.max(0.3, worst + SINK_MARGIN);
    if (sink > MAX_SINK) continue;
    out.push(x, y + size * 0.1, z, yaw, 0, size * (1.0 + (seed - 0.5) * 0.4), size * (0.7 + sizeRoll * 0.2), size * (0.85 + (1 - seed) * 0.3), sink, kindRoll < 0.5 ? KIND.boulderA : KIND.boulderB, seed, y + size * 0.8);
  }
  // ---- stones in and beside the streams
  if (ctx.streams) {
    for (const s of ctx.streams.samplesIn(bx, bz)) {
      if (rng() > 0.45) continue;
      const lat = (rng() - 0.5) * 2 * s.halfWidth * 1.15, size = 0.22 + rng() * rng() * 0.8;
      const x = s.x + s.nx * lat, z = s.z + s.nz * lat;
      if (!keepClear(x, z, 1.2)) continue;
      const y = s.water - size * 0.35;
      let worst = 0;                                                                    // the stone's foot must reach below the channel floor all around it
      for (let a = 0; a < 8; a++) worst = Math.max(worst, y - surface.height(x + Math.cos(a * Math.PI / 4) * size * 0.62, z + Math.sin(a * Math.PI / 4) * size * 0.62));
      if (worst + 0.3 > MAX_SINK) continue;
      out.push(x, y, z, rng() * 6.283, 0, size * 1.1, size * 0.75, size * 0.9, Math.max(0.4, worst + 0.3), KIND.stone, 3 + rng(), y + size * 0.7);
    }
  }
  // ---- mossy boulders on the lip of every waterfall (the water pours over and between them)
  if (ctx.falls) {
    for (const f of ctx.falls) {
      if (Math.floor(f.x / BLOCK) !== bx || Math.floor(f.z / BLOCK) !== bz) continue;
      // big dark boulders: two heavy ones on the flanks of the lip, two smaller ones that split the water into three thick streams, and stones in the plunge pool
      for (const [t0, big, inPool] of [[-0.52, 1.0, false], [0.5, 1.0, false], [-0.2, 0.55, false], [0.19, 0.5, false], [-0.34, 0.6, true], [0.3, 0.75, true], [0.0, 0.5, true]]) {
        const t = t0 + (rng() - 0.5) * 0.06, size = (inPool ? 0.9 : 1.15) * (0.6 + 0.5 * big) + rng() * 0.6 + (big >= 1 ? 0.55 : 0), lat = t * f.width;
        const along = (inPool ? -2.1 : 0) + (rng() - 0.5) * (inPool ? 1.6 : 0.8);          // along the flow (the curtain's normal)
        const x = f.x + f.nx * lat + f.fx * along, z = f.z + f.nz * lat + f.fz * along, y = (inPool ? f.bottom : f.top) - size * (big >= 1 ? 0.3 : 0.4);
        let worst = 0;
        for (let a = 0; a < 8; a++) worst = Math.max(worst, y - surface.height(x + Math.cos(a * Math.PI / 4) * size * 0.62, z + Math.sin(a * Math.PI / 4) * size * 0.62));
        if (worst + 0.35 > MAX_SINK) continue;
        out.push(x, y, z, rng() * 6.283, 0, size * (1.0 + rng() * 0.25), size * (big >= 1 ? 1.05 : 0.85), size * 1.0, Math.max(0.5, worst + 0.35), KIND.stone, 3 + rng(), y + size * 0.8);
      }
      // big mossy boulders strewn on both banks around the pool and the cascade (the real place is a chaos of dark boulders under ferns)
      for (let k = 0; k < 9; k++) {
        const side = k % 2 === 0 ? -1 : 1, size = 1.1 + rng() * rng() * 2.2 + (k < 2 ? 0.5 : 0);
        const lat = f.width / 2 + 0.7 + rng() * 2.6, along = -3.5 + rng() * 7.5;
        const x = f.x + f.nx * side * lat + f.fx * along, z = f.z + f.nz * side * lat + f.fz * along;
        if (clearance(x, z) > WALL_CLEARANCE || !keepClear(x, z, KEEP_CLEAR + size * 0.5)) continue;
        const y = surface.height(x, z) + size * 0.12;
        let worst = 0;
        for (let a = 0; a < 8; a++) worst = Math.max(worst, y - surface.height(x + Math.cos(a * Math.PI / 4) * size * 0.62, z + Math.sin(a * Math.PI / 4) * size * 0.62));
        if (worst + 0.35 > MAX_SINK) continue;
        out.push(x, y, z, rng() * 6.283, 0, size * (1.0 + rng() * 0.3), size * (0.8 + rng() * 0.3), size * 0.95, Math.max(0.5, worst + 0.35), rng() < 0.6 ? KIND.stone : (rng() < 0.5 ? KIND.boulderA : KIND.boulderB), rng() < 0.6 ? 3 + rng() : rng(), y + size * 0.8);
      }
    }
  }
  return Float32Array.from(out);
}

/** Builds a per-block index of the way / stream samples (so a block only walks its own samples). kinds: array of way kinds to include. */
export function createSampleIndex(network, kinds, halfWidthOf = () => 0) {
  const S = network.samples;
  const blocks = new Map();
  const wayKind = (w) => network.ways[w] && network.ways[w].kind;
  const wayOfSample = new Int32Array(S.px.length);
  network.ways.forEach((info, wi) => { for (let k = 0; k < info.count; k++) wayOfSample[info.first + k] = wi; });
  for (let i = 0; i < S.px.length; i++) {
    const kind = wayKind(wayOfSample[i]);
    if (!kinds.includes(kind)) continue;
    const key = Math.floor(S.px[i] / BLOCK) * 100003 + Math.floor(S.pz[i] / BLOCK);
    const list = blocks.get(key);
    if (list) list.push(i); else blocks.set(key, [i]);
  }
  const spacing = 1.5;
  /** Distance (m) from (x, z) to the nearest sample of the indexed ways, or `reach` when none is closer (looks at the 3 x 3 blocks around the point, reach <= 32). */
  function nearest(x, z, reach = 8) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    let best = reach * reach;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = blocks.get((bx + dx) * 100003 + bz + dz);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) { const i = list[k], ddx = S.px[i] - x, ddz = S.pz[i] - z, d2 = ddx * ddx + ddz * ddz; if (d2 < best) best = d2; }
      }
    }
    return Math.sqrt(best);
  }
  return {
    spacing, nearest,
    samplesIn(bx, bz) {
      const list = blocks.get(bx * 100003 + bz) || [];
      return list.map((i) => ({ x: S.px[i], z: S.pz[i], nx: S.nx[i], nz: S.nz[i], water: S.water[i], halfWidth: halfWidthOf(wayKind(wayOfSample[i])) }));
    },
  };
}

/** Cached rock blocks + collision (circle footprint of each rock against a circle). */
export function createRockIndex(ctx) {
  const blocks = new Map();
  const LIMIT = 500;
  function block(bx, bz) {
    const key = bx * 100003 + bz;
    let b = blocks.get(key);
    if (!b) {
      b = rocksOfBlock(bx, bz, ctx);
      blocks.set(key, b);
      if (blocks.size > LIMIT) blocks.delete(blocks.keys().next().value);
    } else { blocks.delete(key); blocks.set(key, b); }
    return b;
  }
  /** Deepest penetration of a circle (x, z, r) into a rock whose top is above `y`: { nx, nz, pen } or null. Stones in the water and slabs count too. */
  function collide(x, z, r, y = -1e9, out = { nx: 0, nz: 0, pen: 0 }) {
    const bx0 = Math.floor((x - r - 7) / BLOCK), bx1 = Math.floor((x + r + 7) / BLOCK), bz0 = Math.floor((z - r - 7) / BLOCK), bz1 = Math.floor((z + r + 7) / BLOCK);
    let best = 0;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = block(bx, bz);
        for (let i = 0; i < t.length; i += R_STRIDE) {
          if (t[i + 11] < y) continue;
          const kind = t[i + 9];
          if (kind === KIND.stone) continue;                                                // pebbles do not stop a bike
          const slab = kind <= KIND.overhang;
          if (slab) {                                                                      // an oriented box: face + depth, as long as the slab
            const nxh = Math.sin(t[i + 3]), nzh = Math.cos(t[i + 3]);                      // horizontal direction of the face normal
            const px = x - t[i], pz = z - t[i + 2];
            const along = px * nzh - pz * nxh, front = px * nxh + pz * nzh;                // along the contour, out of the face
            if (Math.abs(along) > t[i + 5] * 0.5 + r * 0.6 || front > r || front < -(t[i + 7] * Math.cos(t[i + 4]) + t[i + 6] * Math.sin(t[i + 4]))) continue;
            const pen = r - front;
            if (pen > best) { best = pen; out.nx = nxh; out.nz = nzh; out.pen = pen; }
            continue;
          }
          const reach = r + Math.max(t[i + 5], t[i + 7]) * 0.45;
          const cx = t[i], cz = t[i + 2];
          const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2) || 1e-6, pen = reach - d;
          if (pen > best) { best = pen; out.nx = dx / d; out.nz = dz / d; out.pen = pen; }
        }
      }
    }
    return best > 0 ? out : null;
  }
  return { block, collide, blocks };
}
