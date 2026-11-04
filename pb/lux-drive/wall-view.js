/* The retaining walls of Lux Drive as meshes: one mesh per 1024 m chunk (chunked-flat.js), culled by the frustum and by distance like the bridge decks.
 * What a wall is and how it is found: retaining-walls.js.  Courses of stone on a vertical face, a flat top, a coping: flat-shaded quads with a colour each,
 * lit by the same painted light as everything built (solid-material.js). */
import { wallQuads } from './retaining-walls.js';
import { createChunkedFlat } from './chunked-flat.js';

/**
 * walls: the decoded walls (retaining-walls.js decodeWalls).
 * Returns { meshes, count, triangles, update(x, z, radius) }.
 */
export function createWallView({ scene, walls, material }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-walls' });
  let triangles = 0;
  for (const wall of walls) {
    const mid = wall.pts[wall.pts.length >> 1];
    const builder = chunks.builderAt(mid.x, mid.z);            // the whole wall goes to the chunk of its middle
    for (const { q, color } of wallQuads(wall)) { builder.quad(q[0], q[1], q[2], q[3], color); triangles += 2; }
  }
  chunks.finish();
  return { meshes: chunks.meshes, count: walls.length, triangles, update: chunks.update };
}
