/* The trees of Lux Drive: where they stand.
 *
 * Two kinds of trees.  The ones OSM knows one by one are baked (trees.bin): the plane trees of the boulevards, the
 * trees of the parks, the old trees of the villages.  The woods are not baked: a wood is a cover, not a list of trees,
 * so it is placed here from the LiDAR canopy (the tree height and the tree cover).
 *
 * The placement of the woods is deterministic, per 32 m block, so a block always gives the same trees: nothing pops
 * when a block is built again and the harness sees the very same forest as the game.  Pure (no THREE).
 */
import { createRng } from './noise.js';
import { sampleWorldMap } from './world-map.js';

export const BLOCK = 32;            // m, the block of the tree placement
export const STRIDE = 6;            // x, y, z, height, species, seed
export const SPECIES = Object.freeze({ beech: 0, oak: 1 });

const CANDIDATES = 5;               // candidate trees per side of a block (6.4 m apart before the jitter)
const JITTER = 2.0;                 // m, how far a candidate may wander from its place
const ROAD_CLEARANCE = 2.5;         // m past the pavement: the road keeps its corridor free
const BUILDING_CLEARANCE = 2.0;     // m: a tree does not stand in a house
const HEIGHT_MIN = 7, HEIGHT_MAX = 30;
const TRUNK_RATIO = 0.017;          // the radius of the trunk per metre of height

const world = { open: 0, forest: 0, urban: 0, water: 0, cover: 0, height: 0, park: 0, farm: 0 };

/**
 * The trees of one block.
 * map: the world map (the class raster and the canopy).
 * field: the height field (the ground as the game draws it).
 * network: the road network (the roads keep their corridor free).
 * buildings: the building index (a tree does not stand in a house).
 */
export function treesOfBlock(bx, bz, { map, field, network, buildings }) {
  const rng = createRng((bx * 73856093) ^ (bz * 19349663) ^ 0x5bd1e995);
  const out = [];
  const x0 = bx * BLOCK, z0 = bz * BLOCK, step = BLOCK / CANDIDATES;
  const scratch = network.scratch;
  for (let j = 0; j < CANDIDATES; j++) {
    for (let i = 0; i < CANDIDATES; i++) {
      const x = x0 + (i + 0.5) * step + (rng() - 0.5) * 2 * JITTER;
      const z = z0 + (j + 0.5) * step + (rng() - 0.5) * 2 * JITTER;
      const roll = rng(), sizeRoll = rng(), seed = rng();
      const m = sampleWorldMap(map, x, z, world);
      // The canopy cover is the density of the wood; the city and the water carry no trees (the LiDAR sees the
      // roofs of the city as a canopy, so the class map has to overrule it).
      const chance = m.cover * (1 - m.urban) * (1 - m.water);
      if (chance <= 0 || roll > chance) continue;
      network.carve(x, z, scratch);
      if (scratch.dist < scratch.a0 + ROAD_CLEARANCE) continue;
      if (buildings.collide(x, z, BUILDING_CLEARANCE)) continue;
      const height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN,
        m.height > 4 ? m.height * (0.85 + 0.25 * sizeRoll) : 9 + 7 * sizeRoll));
      // beech is the tree of the Luxembourg woods, oak the one of the old parks and the meadows
      const species = sizeRoll > 0.72 ? SPECIES.oak : SPECIES.beech;
      out.push(x, field.height(x, z), z, height, species, seed);
    }
  }
  return Float32Array.from(out);
}

/** The radius of the trunk of a tree: the car stops at it. */
export function trunkRadius(height) {
  return height * TRUNK_RATIO;
}

/**
 * The index of the trees: the cached blocks of the woods and the baked trees of OSM.
 * trees: the baked trees [{ x, z, height, kind, girth, inStreet }].
 * Returns { block(bx, bz), collide(x, z, radius), near(x, z, radius), blocks }.
 */
export function createTreeIndex({ map, field, network, buildings, trees = [] }) {
  const blocks = new Map();
  const LIMIT = 800;                    // the number of cached blocks (the car drives through a lot of them)
  const CELL = 64;                      // m, the cell of the spatial hash of the baked trees
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;

  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }

  /** The block of the woods (built once, then cached). */
  function block(bx, bz) {
    const k = bx * 100003 + bz;
    let b = blocks.get(k);
    if (!b) {
      b = treesOfBlock(bx, bz, { map, field, network, buildings });
      blocks.set(k, b);
      if (blocks.size > LIMIT) blocks.delete(blocks.keys().next().value);
    } else {
      blocks.delete(k); blocks.set(k, b);        // the block that was used last stays in the cache
    }
    return b;
  }

  /** The baked trees whose cell is within the radius of (x, z): [index, ...]. */
  function near(x, z, radius) {
    const out = [];
    const seen = new Set();
    const cx0 = Math.floor((x - radius) / CELL), cx1 = Math.floor((x + radius) / CELL);
    const cz0 = Math.floor((z - radius) / CELL), cz1 = Math.floor((z + radius) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) if (!seen.has(i)) { seen.add(i); out.push(i); }
      }
    }
    return out;
  }

  const scratch = { nx: 0, nz: 0, pen: 0 };
  /** The push out of a trunk: { nx, nz, pen } when the circle touches a trunk, otherwise null. */
  function collide(x, z, radius) {
    let best = null;
    // the trees of the woods: only the blocks around the point
    const bx0 = Math.floor((x - radius - 1) / BLOCK), bx1 = Math.floor((x + radius + 1) / BLOCK);
    const bz0 = Math.floor((z - radius - 1) / BLOCK), bz1 = Math.floor((z + radius + 1) / BLOCK);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const t = block(bx, bz);
        for (let i = 0; i < t.length; i += STRIDE) {
          const dx = x - t[i], dz = z - t[i + 2];
          const reach = radius + trunkRadius(t[i + 3]);
          const d2 = dx * dx + dz * dz;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const pen = reach - d;
          if (!best || pen > best.pen) { best = { nx: dx / d, nz: dz / d, pen }; }
        }
      }
    }
    // the baked trees: the ones of OSM
    for (const i of near(x, z, radius + 1)) {
      const t = trees[i];
      const dx = x - t.x, dz = z - t.z;
      const reach = radius + trunkRadius(t.height);
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const pen = reach - d;
      if (!best || pen > best.pen) { best = { nx: dx / d, nz: dz / d, pen }; }
    }
    return best;
  }

  return { block, collide, near, blocks, trees, cells, cell: CELL };
}
