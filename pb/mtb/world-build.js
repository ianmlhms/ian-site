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

export function buildPureWorld(data) {
  const ways = data.ways.filter((w) => !w.bridge && !w.tunnel);
  const streams = data.streams.filter((w) => !w.tunnel);                 // culverts are not carved
  const trailWays = data.trails.trails.flatMap((trail) => trail.ways);
  const field = createHeightField({ near: data.near, far: data.far, ways: [...ways, ...streams, ...trailWays] });
  const surface = createSurface(field);
  const groundAt = groundResolver(field);
  const info = { coverage: 0, way: -1, stream: 0 };
  const clearance = (x, z) => { field.height(x, z, info); return info.coverage; };
  const maps = buildWorldMap({ classes: data.classes, canopy: data.canopy, near: data.near, leaf: data.leaf, fields: data.fields, cliffs: data.cliffs });
  const trees = createTreeIndex({ map: maps, surface, clearance });
  const undergrowth = createUndergrowthIndex({ map: maps, surface, clearance, trees });
  const walkable = createSampleIndex(field.network, ['trail', 'path']);
  const brooks = createSampleIndex(field.network, ['stream', 'river', 'ditch'], (kind) => WAY_KINDS[kind].halfWidth);
  const rocks = createRockIndex({ map: maps, surface, clearance, ways: walkable, streams: brooks });
  return { ways, streams, trailWays, field, surface, groundAt, clearance, maps, trees, undergrowth, rocks, walkable, brooks };
}
