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
const WOOD_CROWN = 0.40;            // the crown radius of a tree of the woods per metre of height (tree-view.js: girth 0.8 .. 1.25 x 0.66, halved, and the blobs stick out)
const LANE_MARGIN = 1.5;            // m: a crown stays this far from the edge of the carriageway (lanes + hard shoulder), so no crown hangs over a lane
const FOOTPATH_LINES = 3;           // road-network `lines` >= this: a footpath, a cycle way or stairs: no car drives there, the crown rule is for ways with traffic
const STREET_CROWN_SHARE = 0.5;     // the crown of an avenue tree on the pavement may reach this share of its radius over the kerb (the plane trees of the boulevards)
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
 * treeDecks: the deck network of the bridges (decks.js `touchesVolume`): no tree grows on a bridge, through its slab or with its crown over it.
 * clearings: rectangles [x0, z0, x1, z1] around the landmarks that people come to see: the generated woods leave them free (the trees hid the Coque, the Mudam and
 *   the Fort Thüngen from the roads).  The trees OSM maps one by one are baked and stay.
 */
export function treesOfBlock(bx, bz, { map, field, network, buildings, clearings = [], treeDecks = null }) {
  const rng = createRng((bx * 73856093) ^ (bz * 19349663) ^ 0x5bd1e995);
  const out = [];
  const x0 = bx * BLOCK, z0 = bz * BLOCK, step = BLOCK / CANDIDATES;
  const scratch = network.scratch;
  for (let j = 0; j < CANDIDATES; j++) {
    for (let i = 0; i < CANDIDATES; i++) {
      const x = x0 + (i + 0.5) * step + (rng() - 0.5) * 2 * JITTER;
      const z = z0 + (j + 0.5) * step + (rng() - 0.5) * 2 * JITTER;
      const roll = rng(), sizeRoll = rng(), seed = rng();
      if (clearings.some((c) => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3])) continue;
      const m = sampleWorldMap(map, x, z, world);
      // The canopy cover is the density of the wood; the city and the water carry no trees (the LiDAR sees the
      // roofs of the city as a canopy, so the class map has to overrule it).
      const chance = m.cover * (1 - m.urban) * (1 - m.water);
      if (chance <= 0 || roll > chance) continue;
      const height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN,
        m.height > 4 ? m.height * (0.85 + 0.25 * sizeRoll) : 9 + 7 * sizeRoll));
      const crown = height * WOOD_CROWN;
      network.carve(x, z, scratch);
      // the trunk keeps clear of the pavement AND the crown of the tree of the woods clears the carriageway (the motorway in the Gruenewald was a tunnel of crowns)
      if (scratch.road >= 0 && scratch.dist < Math.max(scratch.a0 + ROAD_CLEARANCE, scratch.lines < FOOTPATH_LINES ? scratch.hw + LANE_MARGIN + crown : 0)) continue;
      if (buildings.collide(x, z, BUILDING_CLEARANCE)) continue;
      const ground = field.height(x, z);
      if (treeDecks && treeDecks.touchesVolume(x, z, ground, ground + height, Math.max(crown, 2))) continue;
      // beech is the tree of the Luxembourg woods, oak the one of the old parks and the meadows
      const species = sizeRoll > 0.72 ? SPECIES.oak : SPECIES.beech;
      out.push(x, ground, z, height, species, seed);
    }
  }
  return Float32Array.from(out);
}

/** The radius of the crown of a tree OSM maps: its baked crown width per metre of height, halved (a bush is a low round blob). */
export const bakedCrownRadius = (t) => (t.kind === 2 ? 0.3 : t.girth * 0.5) * t.height;

/** A tree on the pavement of a street (mapped as a street tree, or standing within the pavement of the way) is an avenue tree: it keeps half of its crown over the kerb
 *  (the planes of the boulevards, the trees of the old town); every other tree of OSM (parks, forest edges, the motorway verge) keeps its whole crown off the lanes. */
export const isAvenueTree = (t, carve) => t.inStreet || carve.dist <= carve.a0 + 0.5;
export const wayMargin = (t, carve) => (isAvenueTree(t, carve) ? 0.5 : LANE_MARGIN);
export const crownShare = (t, carve) => (isAvenueTree(t, carve) ? STREET_CROWN_SHARE : 1);

/**
 * The trees OSM maps one by one, without the ones that stand where nothing may grow: on a bridge, through its slab, or so near a
 * carriageway that the crown hangs over a lane (the forest trees of OSM along the motorway closed the road).  The avenue trees on the pavement
 * of a street keep half of their crown over the kerb.  Returns a NEW list (the baked one stays as it is); the harness and the game use the same.
 * { network, field, treeDecks } as in treesOfBlock.
 */
export function keepWaysClear(trees, { network, field, treeDecks = null }) {
  const scratch = network.scratch;
  return trees.filter((t) => {
    const crown = bakedCrownRadius(t);
    if (t.kind !== 2) {
      network.carve(t.x, t.z, scratch);
      if (scratch.road >= 0 && scratch.lines < FOOTPATH_LINES) {
        if (scratch.dist < scratch.hw + wayMargin(t, scratch) + crown * crownShare(t, scratch)) return false;
      }
    }
    if (!treeDecks) return true;
    const ground = field.height(t.x, t.z);
    return !treeDecks.touchesVolume(t.x, t.z, ground, ground + t.height, Math.max(crown, 1.5));
  });
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
export function createTreeIndex({ map, field, network, buildings, trees = [], clearings = [], treeDecks = null }) {
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
      b = treesOfBlock(bx, bz, { map, field, network, buildings, clearings, treeDecks });
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
