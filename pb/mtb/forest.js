/* Tree placement: deterministic, per 32 m block, from the LiDAR canopy (height, cover) and the land-cover maps. Pure (no THREE): the browser draws the
 * result, the harness checks that no tree stands on a trail. A block always gives the same trees, so nothing pops when it is built again. */
import { QUADTREE } from './config.js';
import { createRng, fbm } from './noise.js';
import { sampleWorldMap } from './world-map.js';

export const BLOCK = QUADTREE.minSize;
const CANDIDATES = 6;                    // candidate trees per side of a block (5.3 m apart before the jitter)
const JITTER = 2.3;
const HEIGHT_MIN = 5, HEIGHT_MAX = 36;
const CONIFER_NOISE_SCALE = 260;
export const SPECIES = Object.freeze({ beech: 0, spruce: 1 });
const scratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
const nrm = { x: 0, y: 1, z: 0 };

export const TRUNK_RADIUS_PER_METRE = 0.0115;      // trunk base radius = this * tree height (the model's unit trunk is 0.0115 wide)
export const STRIDE = 6;

/** Trees of block (bx, bz): Float32Array stride 6 [x, y, z, height, species, seed]. `clearance(x, z)` returns the way coverage (0..1) at a point.
 *  Always the full set: thinning for the quality level happens when drawing, so collisions never depend on the quality setting. */
export function treesOfBlock(bx, bz, { map, surface, clearance }) {
  const rng = createRng((bx * 73856093) ^ (bz * 19349663) ^ 0x5bd1e995);
  const out = [];
  const x0 = bx * BLOCK, z0 = bz * BLOCK, cell = BLOCK / CANDIDATES;
  for (let j = 0; j < CANDIDATES; j++) {
    for (let i = 0; i < CANDIDATES; i++) {
      const x = x0 + (i + 0.5) * cell + (rng() - 0.5) * 2 * JITTER, z = z0 + (j + 0.5) * cell + (rng() - 0.5) * 2 * JITTER;
      const roll = rng(), sizeRoll = rng(), seed = rng();
      const m = sampleWorldMap(map, x, z, scratch);
      let chance = m.cover * (1 - m.built) * (1 - m.water);
      if (m.grass > 0.5 && m.cover < 0.4) chance = 0.02 * m.grass;               // an orchard tree, a hedge tree in a meadow
      chance *= 1 - 0.8 * m.rock;
      if (roll > chance) continue;
      if (clearance(x, z) > 0.04) continue;                                          // the way network keeps its corridor free
      const y = surface.height(x, z);
      surface.normal(x, z, nrm);
      if (nrm.y < 0.62 && rng() < 0.8) continue;                                     // cliffs carry few trees
      const baseHeight = m.height > 4 ? m.height : 9 + sizeRoll * 5;
      const height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, baseHeight * (0.82 + sizeRoll * 0.4)));
      const conifer = fbm(x, z, CONIFER_NOISE_SCALE, 2, 9) > 0.22 + 0.2 * (1 - m.wet);
      out.push(x, y, z, height, conifer ? SPECIES.spruce : SPECIES.beech, seed);
    }
  }
  return Float32Array.from(out);
}

/** Cached tree blocks + trunk collision: the same index feeds the renderer, the bike and the camera. */
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
          const reach = r + t[i + 3] * TRUNK_RADIUS_PER_METRE;
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
  return { block, collide, blocks };
}
