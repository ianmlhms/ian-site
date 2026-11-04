/* The bridge decks of Lux Drive: the solid decks of the bake (Pont Adolphe, Pont Rouge, the A1 bridges) as one mesh.
 *
 * A deck is not a ribbon that floats over the valley: it has a top surface, a thickness under it and the parapets on the
 * sides, and it is pinned to the ground at its two ends. The car drives on the top of it (the physics reads the same
 * heights from decks.js). */
import { DECK } from './decks.js';
import { FlatBuilder } from './flat-builder.js';

const THREE = window.THREE;
const PARAPET_HEIGHT = 1.05;        // m, the height of the railing
const PARAPET_WIDTH = 0.28;         // m, the thickness of the railing
const COLOUR_DECK = [0.62, 0.61, 0.58];
const COLOUR_SIDE = [0.50, 0.49, 0.47];
const COLOUR_PARAPET = [0.68, 0.67, 0.64];

/**
 * decks: the decoded decks [{ id, parapet, width, pts: [[x, z]], tops: [y] }]
 * ground: the height of the terrain under the deck (the abutments reach down to it, so nothing floats).
 * Returns { mesh, count }.
 */
export function createDeckView({ scene, decks, material, ground }) {
  const b = new FlatBuilder();
  let count = 0;
  for (const deck of decks) {
    const n = deck.pts.length;
    if (n < 2) continue;
    const half = deck.width / 2;
    count += 1;
    // The bottom of the side of the deck.
    //
    // A deck that SPANS the land is a bridge over a valley: its side stops at its own underside and the
    // valley shows under it.  A deck that stands on the land (a road on an embankment) reaches the
    // ground: it is a solid wall of roadbed, never a slab in the air.
    const groundAt = (x, z, y) => {
      if (!ground) return y - DECK.thickness;
      const g = ground.height(x, z);
      if (!deck.spans) return Math.min(g, y);
      return Math.max(y - DECK.thickness, Math.min(g, y));
    };
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
      // the sides of the deck: they are the ABUTMENTS where the deck meets the land.  Over a valley they stop
      // under the deck, so the bridge spans the ground instead of walling it off.
      const al = groundAt(ax + sx * half, az + sz * half, ay);
      const bl = groundAt(bx + sx * half, bz + sz * half, by);
      const ar = groundAt(ax - sx * half, az - sz * half, ay);
      const br = groundAt(bx - sx * half, bz - sz * half, by);
      b.quad([ax + sx * half, ay, az + sz * half], [bx + sx * half, by, bz + sz * half],
        [bx + sx * half, bl, bz + sz * half], [ax + sx * half, al, az + sz * half], COLOUR_SIDE);
      b.quad([bx - sx * half, by, bz - sz * half], [ax - sx * half, ay, az - sz * half],
        [ax - sx * half, ar, az - sz * half], [bx - sx * half, br, bz - sz * half], COLOUR_SIDE);
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
      const al = groundAt(a[0], a[2], y), cl = groundAt(c[0], c[2], y);
      if (end === 0) b.quad(a, [a[0], al, a[2]], [c[0], cl, c[2]], c, COLOUR_SIDE);
      else b.quad(c, [c[0], cl, c[2]], [a[0], al, a[2]], a, COLOUR_SIDE);
    }
  }
  const geometry = b.build();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'luxdrive-decks';
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return { mesh, count };
}
