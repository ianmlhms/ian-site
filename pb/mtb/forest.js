/* Tree placement: deterministic, per 32 m block, from the LiDAR canopy (height, cover), the land-cover maps and the OSM leaf type. Pure (no THREE): the browser draws
 * the result, the harness checks that no tree stands on a way. A block always gives the same trees, so nothing pops when it is built again.
 *   species: beech and oak (broadleaf, the real Mullerthal), spruce ONLY where OSM says needle forest (leaf_type) or mixed forest (some), saplings under the canopy. */
import { QUADTREE } from './config.js';
import { createRng, fbm } from './noise.js';
import { sampleWorldMap, sampleFieldCell } from './world-map.js';

export const BLOCK = QUADTREE.minSize;
const CANDIDATES = 6;                    // candidate trees per side of a block (5.3 m apart before the jitter)
const SAPLING_CANDIDATES = 5;
const JITTER = 2.3;
const HEIGHT_MIN = 5, HEIGHT_MAX = 36;
const SAPLING_HEIGHT_MIN = 1.6, SAPLING_HEIGHT_MAX = 5.5;
const OAK_NOISE_SCALE = 170;
export const SPECIES = Object.freeze({ beech: 0, spruce: 1, oak: 2, sapling: 3 });
export const LEAF = Object.freeze({ unknown: 0, broadleaved: 1, needleleaved: 2, mixed: 3 });
const spruceShare = [0.03, 0.03, 0.75, 0.3];     // by leaf type: the share of the trees that are spruces
const scratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
const cell = { field: 0, leaf: 0, hedge: 0 };
const nrm = { x: 0, y: 1, z: 0 };
const SAPLING_MARGIN = 2.4;             // m: saplings keep this far from every way (they would fill the picture next to the rider)

/** True when no way (trail, path, track, stream) is closer than `r` metres to (x, z): 8 probes on a circle plus the centre. */
export function wayFree(clearance, x, z, r) {
  if (clearance(x, z) > 0.04) return false;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (clearance(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0.04) return false; }
  return true;
}

/** Collision shape per species: trunk radius per metre of height, and the crown ellipsoid (centre height, horizontal radius, half height; all per metre of height). */
export const SHAPES = Object.freeze([
  { trunk: 0.0165, crownY: 0.74, crownR: 0.235, crownH: 0.26 },   // beech
  { trunk: 0.0105, crownY: 0.61, crownR: 0.14, crownH: 0.39 },    // spruce
  { trunk: 0.0195, crownY: 0.7, crownR: 0.34, crownH: 0.3 },       // oak
  { trunk: 0.012, crownY: 0.62, crownR: 0.3, crownH: 0.38 },      // sapling
]);
export const STRIDE = 6;
const baseHeightEstimate = (m) => Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, m.height > 4 ? m.height * 1.2 : 12));

/** Trees of block (bx, bz): Float32Array stride 6 [x, y, z, height, species, seed]. `clearance(x, z)` returns the way coverage (0..1) at a point.
 *  Always the full set: thinning for the quality level happens when drawing, so collisions never depend on the quality setting. */
export function treesOfBlock(bx, bz, { map, surface, clearance }) {
  const rng = createRng((bx * 73856093) ^ (bz * 19349663) ^ 0x5bd1e995);
  const out = [];
  const x0 = bx * BLOCK, z0 = bz * BLOCK, step = BLOCK / CANDIDATES;
  for (let j = 0; j < CANDIDATES; j++) {
    for (let i = 0; i < CANDIDATES; i++) {
      const x = x0 + (i + 0.5) * step + (rng() - 0.5) * 2 * JITTER, z = z0 + (j + 0.5) * step + (rng() - 0.5) * 2 * JITTER;
      const roll = rng(), sizeRoll = rng(), seed = rng(), speciesRoll = rng();
      const m = sampleWorldMap(map, x, z, scratch);
      let chance = m.cover * (1 - m.built) * (1 - m.water);
      if (m.grass > 0.5 && m.cover < 0.4) chance = 0.02 * m.grass;               // an orchard tree, a hedge tree in a meadow
      chance *= 1 - 0.8 * m.rock;
      if (roll > chance) continue;
      if (!wayFree(clearance, x, z, 0.3 + 0.02 * HEIGHT_MAX * (baseHeightEstimate(m) / HEIGHT_MAX))) continue;     // the way network keeps its corridor free, a thick trunk keeps a little further away
      const y = surface.height(x, z);
      surface.normal(x, z, nrm);
      if (nrm.y < 0.62 && rng() < 0.8) continue;                                     // cliffs carry few trees
      const baseHeight = m.height > 4 ? m.height : 9 + sizeRoll * 5;
      let height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, baseHeight * (0.82 + sizeRoll * 0.4)));
      if (m.grass > 0.5 && m.cover < 0.4) height = Math.min(height, 5.5 + sizeRoll * 3);       // an orchard tree, a hedge tree: small
      sampleFieldCell(map, x, z, cell);
      let species = SPECIES.beech;
      if (speciesRoll < spruceShare[cell.leaf]) species = SPECIES.spruce;
      else if (fbm(x, z, OAK_NOISE_SCALE, 2, 5) > 0.16 + 0.3 * m.wet) species = SPECIES.oak;
      out.push(x, y, z, height, species, seed);
    }
  }
  // saplings: young trees in the gaps and under the canopy (never in meadows, never on a way)
  const sstep = BLOCK / SAPLING_CANDIDATES;
  for (let j = 0; j < SAPLING_CANDIDATES; j++) {
    for (let i = 0; i < SAPLING_CANDIDATES; i++) {
      const x = x0 + (i + 0.5) * sstep + (rng() - 0.5) * sstep * 0.9, z = z0 + (j + 0.5) * sstep + (rng() - 0.5) * sstep * 0.9;
      const roll = rng(), sizeRoll = rng(), seed = rng();
      const m = sampleWorldMap(map, x, z, scratch);
      const chance = m.cover * (1 - m.built) * (1 - m.water) * (1 - m.grass) * (1 - m.rock) * 0.55;
      if (roll > chance || !wayFree(clearance, x, z, SAPLING_MARGIN)) continue;
      surface.normal(x, z, nrm);
      if (nrm.y < 0.7) continue;
      out.push(x, surface.height(x, z), z, SAPLING_HEIGHT_MIN + sizeRoll * (SAPLING_HEIGHT_MAX - SAPLING_HEIGHT_MIN), SPECIES.sapling, seed);
    }
  }
  return Float32Array.from(out);
}

/** Cached tree blocks + trunk and crown collision: the same index feeds the renderer, the bike and the camera. */
export function createTreeIndex({ map, surface, clearance }) {
  const blocks = new Map();
  const LIMIT = 1200;
  function block(bx, bz) {
    const key = bx * 100003 + bz;
    let b = blocks.get(key);
    if (!b) {
      b = treesOfBlock(bx, bz, { map, surface, clearance });
      blocks.set(key, b);
      if (blocks.size > LIMIT) blocks.delete(blocks.keys().next().value);
    } else { blocks.delete(key); blocks.set(key, b); }
    return b;
  }
  /** Deepest penetration of a circle (x, z, r) into a trunk: { nx, nz, pen } (unit normal pointing out of the trunk) or null. */
  function collide(x, z, r, out = { nx: 0, nz: 0, pen: 0 }) {
    const bx0 = Math.floor((x - r - 1) / BLOCK), bx1 = Math.floor((x + r + 1) / BLOCK), bz0 = Math.floor((z - r - 1) / BLOCK), bz1 = Math.floor((z + r + 1) / BLOCK);
    let best = 0;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = block(bx, bz);
        for (let i = 0; i < t.length; i += STRIDE) {
          const dx = x - t[i], dz = z - t[i + 2];
          const reach = r + t[i + 3] * SHAPES[t[i + 4]].trunk;
          const d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const pen = reach - d;
          if (pen > best) { best = pen; out.nx = dx / d; out.nz = dz / d; out.pen = pen; }
        }
      }
    }
    return best > 0 ? out : null;
  }
  /** Pushes a sphere (x, y, z, r) out of the crowns (ellipsoids): returns { dx, dy, dz } to ADD to the position, or null. Used by the camera (the bike never reaches a crown). */
  function pushOutOfCrowns(x, y, z, r, out = { dx: 0, dy: 0, dz: 0 }) {
    const reachMax = 14;
    const bx0 = Math.floor((x - reachMax) / BLOCK), bx1 = Math.floor((x + reachMax) / BLOCK), bz0 = Math.floor((z - reachMax) / BLOCK), bz1 = Math.floor((z + reachMax) / BLOCK);
    let best = 0;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = block(bx, bz);
        for (let i = 0; i < t.length; i += STRIDE) {
          const sh = SHAPES[t[i + 4]], h = t[i + 3];
          const a = h * sh.crownR + r, b = h * sh.crownH + r;
          const dx = x - t[i], dy = y - (t[i + 1] + h * sh.crownY), dz = z - t[i + 2];
          if (Math.abs(dx) > a || Math.abs(dz) > a || Math.abs(dy) > b) continue;
          const q = (dx * dx + dz * dz) / (a * a) + (dy * dy) / (b * b);
          if (q >= 1) continue;
          const s = 1 / Math.sqrt(Math.max(q, 1e-6)) - 1;           // radial projection onto the ellipsoid surface
          const pen = Math.hypot(dx * s, dy * s, dz * s);
          if (pen > best) { best = pen; out.dx = dx * s; out.dy = dy * s; out.dz = dz * s; }
        }
      }
    }
    return best > 0 ? out : null;
  }
  return { block, collide, pushOutOfCrowns, blocks };
}
