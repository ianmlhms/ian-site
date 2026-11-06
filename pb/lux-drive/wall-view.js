/* The retaining walls of Lux Drive as meshes: one mesh per 1024 m chunk (chunked-flat.js), culled by the frustum and by distance like the bridge decks.
 * What a wall is and how it is found: retaining-walls.js.  The face is one quad per stretch with smooth normals; the masonry (level courses, staggered joints,
 * a pale coping) is drawn by wall-material.js. */
import { wallQuads, drawnWalls } from './retaining-walls.js';
import { createChunkedFlat } from './chunked-flat.js';

const THREE = window.THREE;

/** A builder of quads with a normal and the wall attributes (aWall, wall-material.js) per vertex. */
class WallBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.wall = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  quad({ q, n, color, a }) {
    const base = this.count;
    for (let k = 0; k < 4; k++) {
      this.pos.push(q[k][0], q[k][1], q[k][2]);
      this.nor.push(n[k][0], n[k][1], n[k][2]);
      this.col.push(color[0], color[1], color[2]);
      this.wall.push(a[k][0], a[k][1], a[k][2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wall, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * walls: the decoded walls (retaining-walls.js decodeWalls); material: wall-material.js; groundAt(x, z): the drawn ground (the height of the footing).
 * Returns { meshes, count, triangles, update(x, z, radius) }.
 */
export function createWallView({ scene, walls, material, groundAt = null }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-walls', makeBuilder: () => new WallBuilder() });
  let triangles = 0;
  const shown = drawnWalls(walls);
  for (const wall of shown) {
    const mid = wall.pts[wall.pts.length >> 1];
    const builder = chunks.builderAt(mid.x, mid.z);            // the whole wall goes to the chunk of its middle
    for (const quad of wallQuads(wall, groundAt)) { builder.quad(quad); triangles += 2; }
  }
  chunks.finish();
  return { meshes: chunks.meshes, count: shown.length, triangles, update: chunks.update };
}
