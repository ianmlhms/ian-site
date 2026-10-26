/* The pure (no THREE) part of the world, assembled in one place so the game and the Node harness run exactly the same code:
 * height field (terrain + carved ways + carved streams), physics surface, world maps, tree / undergrowth / rock indexes. */
import { WAY_KINDS } from './config.js';
import { createHeightField } from './heightfield.js';
import { createSurface } from './surface.js';
import { groundResolver } from './bike.js';
import { buildWorldMap } from './world-map.js';
import { createTreeIndex } from './forest.js';
import { createUndergrowthIndex } from './undergrowth.js';
import { createRockIndex, createSampleIndex } from './rocks.js';
import { attachCascades } from './landmarks.js';
import { findFalls } from './water.js';
import { placeCascade } from './cascade.js';
import { describeHouses, createTownIndex, CHURCH, RENAISSANCE, RUIN } from './town-data.js';

const CASCADE_OWN_RADIUS = 14;       // m: a fall this close to the Schiessentümpel ledge is the ledge itself (cascade.js poured its own falls)

export const RIDDEN_KINDS = Object.freeze(['trail', 'path', 'track']);

const WAY_MARGIN = 1.2;          // m: a house whose wall is closer than this to the centre line of a trail, path or track is left out (the way wins: OSM footpaths run through footprints, the Marathon through Beaufort)
const KEPT_FLAGS = CHURCH | RENAISSANCE | RUIN;

/** The houses without those that stand on a way the bike or a walker uses (the church and the castles always stay). Pure. */
export function clearOfWays(houses, network) {
  const S = network.samples;
  let rest = houses;
  for (let pass = 0; pass < 4; pass++) {                                    // (a sample can be near two overlapping houses: look again until nothing is left)
    const index = createTownIndex(rest), drop = new Set();
    for (const info of network.ways) {
      if (!RIDDEN_KINDS.includes(info.kind)) continue;
      for (let i = info.first; i < info.first + info.count; i++) { const hit = index.insideRect(S.px[i], S.pz[i], WAY_MARGIN); if (hit && !(hit.flags & KEPT_FLAGS)) drop.add(hit.id); }
    }
    if (!drop.size) break;
    rest = rest.filter((h) => !drop.has(h.id));
  }
  return rest;
}

export function buildPureWorld(data) {
  const ways = data.ways.filter((w) => !w.bridge && !w.tunnel);
  const streams = attachCascades(data.streams.filter((w) => !w.tunnel), data.falls);       // culverts are not carved; waterfalls become staircases
  const trailWays = data.trails.trails.flatMap((trail) => trail.ways);
  const field = createHeightField({ near: data.near, far: data.far, ways: [...ways, ...streams, ...trailWays] });
  const surface = createSurface(field);
  const groundAt = groundResolver(field);
  const info = { coverage: 0, way: -1, stream: 0 };
  const clearance = (x, z) => { field.height(x, z, info); return info.coverage; };
  const maps = buildWorldMap({ classes: data.classes, canopy: data.canopy, near: data.near, leaf: data.leaf, fields: data.fields, cliffs: data.cliffs });
  const ridden = createSampleIndex(field.network, RIDDEN_KINDS);        // every way a bike or a walker uses, whichever trails the game defines: rocks, logs, shrubs keep clear of it
  const trees = createTreeIndex({ map: maps, surface, clearance, ridden });
  const undergrowth = createUndergrowthIndex({ map: maps, surface, clearance, trees, ridden });
  const walkable = createSampleIndex(field.network, ['trail', 'path']);
  const brooks = createSampleIndex(field.network, ['stream', 'river', 'ditch'], (kind) => WAY_KINDS[kind].halfWidth);
  const cascade = placeCascade(field.network, surface);                  // the Schiessentümpel ledge with its parallel falls (null when the river is missing from the data)
  const allFalls = findFalls(field.network);
  const falls = cascade ? allFalls.map((f) => (Math.hypot(f.x - cascade.x, f.z - cascade.z) < CASCADE_OWN_RADIUS ? { ...f, bankOnly: true } : f)) : allFalls;      // (the boulders of the lip and the pool are the ledge model's; the strewn bank boulders stay)
  const rocks = createRockIndex({ map: maps, surface, clearance, ways: walkable, ridden, streams: brooks, falls });
  const houses = clearOfWays(describeHouses((data.buildings && data.buildings.houses) || [], surface), field.network);        // the Berdorf village, the Beaufort houses and castles (town-data.js)
  const town = createTownIndex(houses);
  return { ridden, ways, streams, trailWays, field, surface, groundAt, clearance, maps, trees, undergrowth, rocks, walkable, brooks, falls, cascade, houses, town };
}
