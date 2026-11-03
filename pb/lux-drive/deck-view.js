/* The bridge decks of Lux Drive: the solid decks of the bake (Pont Adolphe, Pont Rouge, the A1 bridges) as one mesh.
 *
 * A deck is not a ribbon that floats over the valley: it has a top surface, a thickness under it and the parapets on the
 * sides, and it is pinned to the ground at its two ends. The car drives on the top of it (the physics reads the same
 * heights from decks.js). */
import { DECK } from './decks.js';

const THREE = window.THREE;
const PARAPET_HEIGHT = 1.05;        // m, the height of the railing
const PARAPET_WIDTH = 0.28;         // m, the thickness of the railing
const COLOUR_DECK = [0.62, 0.61, 0.58];
const COLOUR_SIDE = [0.50, 0.49, 0.47];
const COLOUR_PARAPET = [0.68, 0.67, 0.64];

/** A flat-shaded builder: positions, normals, colours and indices. */
class DeckBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** A quad with the normal from its winding. */
  quad(a, b, c, d, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = this.count;
    for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * decks: the decoded decks [{ id, parapet, width, pts: [[x, z]], tops: [y] }]
 * Returns { mesh, count }.
 */
export function createDeckView({ scene, decks, material }) {
  const b = new DeckBuilder();
  let count = 0;
  for (const deck of decks) {
    const n = deck.pts.length;
    if (n < 2) continue;
    const half = deck.width / 2;
    count += 1;
    // the direction of every segment and the side normal of the deck
    for (let i = 0; i + 1 < n; i++) {
      const [ax, az] = deck.pts[i];
      const [bx, bz] = deck.pts[i + 1];
      const ay = deck.tops[i], by = deck.tops[i + 1];
      let dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const sx = -dz, sz = dx;                      // the side of the deck (left)
      const top = 0;
      // the deck surface
      b.quad([ax + sx * half, ay + top, az + sz * half], [bx + sx * half, by + top, bz + sz * half],
        [bx - sx * half, by + top, bz - sz * half], [ax - sx * half, ay + top, az - sz * half], COLOUR_DECK);
      // the underside
      b.quad([ax - sx * half, ay - DECK.thickness, az - sz * half], [bx - sx * half, by - DECK.thickness, bz - sz * half],
        [bx + sx * half, by - DECK.thickness, bz + sz * half], [ax + sx * half, ay - DECK.thickness, az + sz * half], COLOUR_SIDE);
      // the sides of the deck (the thickness)
      b.quad([ax + sx * half, ay, az + sz * half], [bx + sx * half, by, bz + sz * half],
        [bx + sx * half, by - DECK.thickness, bz + sz * half], [ax + sx * half, ay - DECK.thickness, az + sz * half], COLOUR_SIDE);
      b.quad([bx - sx * half, by, bz - sz * half], [ax - sx * half, ay, az - sz * half],
        [ax - sx * half, ay - DECK.thickness, az - sz * half], [bx - sx * half, by - DECK.thickness, bz - sz * half], COLOUR_SIDE);
      // the parapets: a low wall on both sides
      if (deck.parapet) {
        const ph = PARAPET_HEIGHT, pw = PARAPET_WIDTH;
        for (const side of [1, -1]) {
          const ox = sx * side * (half - pw / 2), oz = sz * side * (half - pw / 2);
          b.quad([ax + ox, ay + ph, az + oz], [bx + ox, by + ph, bz + oz],
            [bx + ox, by, bz + oz], [ax + ox, ay, az + oz], COLOUR_PARAPET);
          b.quad([bx - ox, by + ph, bz - oz], [ax - ox, ay + ph, az - oz],
            [ax - ox, ay, az - oz], [bx - ox, by, bz - oz], COLOUR_PARAPET);
          b.quad([ax - ox, ay + ph, az - oz], [bx - ox, by + ph, bz - oz],
            [bx + ox, by + ph, bz + oz], [ax + ox, ay + ph, az + oz], COLOUR_PARAPET);   // the top of the wall
        }
      }
    }
    // the caps at the two ends
    for (const end of [0, n - 1]) {
      const [x, z] = deck.pts[end];
      const y = deck.tops[end];
      const prev = deck.pts[end === 0 ? 1 : n - 2];
      let dx = x - prev[0], dz = z - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const sx = -dz, sz = dx, half = deck.width / 2;
      const a = [x + sx * half, y, z + sz * half];
      const c = [x - sx * half, y, z - sz * half];
      if (end === 0) b.quad(a, [a[0], a[1] - DECK.thickness, a[2]], [c[0], c[1] - DECK.thickness, c[2]], c, COLOUR_SIDE);
      else b.quad(c, [c[0], c[1] - DECK.thickness, c[2]], [a[0], a[1] - DECK.thickness, a[2]], a, COLOUR_SIDE);
    }
  }
  const geometry = b.build();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'luxdrive-decks';
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return { mesh, count };
}
