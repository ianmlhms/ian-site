/* The bridge decks of Lux Drive: the decks of the bake (Pont Adolphe, Pont Rouge, the A1 bridges, the viaducts and footbridges) as one mesh per chunk.
 *
 * A bridge looks like a bridge: an asphalt road surface with its lane markings (a footbridge: pale concrete), a girder along both edges, parapets, and PIERS
 * where the deck stands high over the ground.  It is never a grey plateau.  Only where the deck is within a couple of metres of the ground (the approach ramps,
 * the abutments) is the side filled down to the ground, and the fill thins into the girder as the clearance grows - a deck 8 m over flat land is a thin slab on
 * columns, not a wall of roadbed 8 m high (the grey slabs the reviewer saw across Escher Strooss, the A1 and Rue de Neudorf).
 * The car drives on the top of it (the physics reads the same heights from decks.js). */
import { DECK } from './decks.js';
import { createChunkedFlat } from './chunked-flat.js';
import { ROAD_MIN_WIDTH, LINE_WIDTH, DASH_PERIOD, DASH_LENGTH, PAINT_LIFT, PIER_SIZE, sideDepth, laneLines, piersOf } from './deck-shape.js';

const PARAPET_HEIGHT = 0.95;        // m, the height of the parapet of a road bridge
const PARAPET_WIDTH = 0.30;         // m, its thickness
const RAILING_HEIGHT = 1.05;        // m, the railing of a footbridge
const RAILING_WIDTH = 0.10;
const COLOUR_ASPHALT = [0.215, 0.218, 0.232];
const COLOUR_PATH = [0.60, 0.59, 0.56];
const COLOUR_PAINT = [0.84, 0.83, 0.76];
const COLOUR_SIDE = [0.56, 0.55, 0.52];
const COLOUR_UNDER = [0.40, 0.39, 0.37];
const COLOUR_PARAPET = [0.68, 0.67, 0.64];
const COLOUR_RAILING = [0.36, 0.38, 0.41];
const COLOUR_PIER = [0.58, 0.57, 0.54];

/**
 * decks: the decoded decks [{ id, parapet, width, pts: [[x, z]], tops: [y] }]
 * ground: the surface under the decks ({ height(x, z), roadInfoAt(x, z, out) }): the abutments reach down to it, the piers stand on it and keep out of its carriageways.
 * Returns { meshes, count, piers, update(x, z, radius) }: one mesh per chunk (chunked-flat.js), culled by the frustum and by distance.
 */
export function createDeckView({ scene, decks, material, ground }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-decks' });
  const info = { sdCar: 9 };
  const sdCarAt = (x, z) => (ground && ground.roadInfoAt ? ground.roadInfoAt(x, z, info).sdCar : 9);
  let count = 0, pierCount = 0;
  for (const deck of decks) {
    const n = deck.pts.length;
    if (n < 2) continue;
    const b = chunks.builderAt(deck.pts[n >> 1][0], deck.pts[n >> 1][1]);          // the whole deck goes to the chunk of its middle
    const half = deck.width / 2;
    const isRoad = deck.width >= ROAD_MIN_WIDTH;
    count += 1;
    // the bottom of the side of the deck: the ground where the deck is low (abutment, ramp), the girder where it is high (see sideDepth)
    const bottomAt = (x, z, y) => {
      if (!ground) return y - DECK.thickness;
      return y - sideDepth(y - ground.height(x, z));
    };
    const lines = isRoad ? laneLines(deck.width) : [];
    let s0 = 0;                                       // the arc length at the start of the segment (the dashes of the lane lines are laid on it)
    for (let i = 0; i + 1 < n; i++) {
      const [ax, az] = deck.pts[i];
      const [bx, bz] = deck.pts[i + 1];
      const ay = deck.tops[i], by = deck.tops[i + 1];
      let dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const sx = -dz, sz = dx;                      // the side of the deck (left)
      // the road surface
      b.quad([ax + sx * half, ay, az + sz * half], [bx + sx * half, by, bz + sz * half],
        [bx - sx * half, by, bz - sz * half], [ax - sx * half, ay, az - sz * half], isRoad ? COLOUR_ASPHALT : COLOUR_PATH);
      // the lane lines: strips of paint laid on the asphalt
      for (const line of lines) {
        const o = line.offset, hwl = LINE_WIDTH / 2;
        const strip = (t0, t1) => {
          const y0 = ay + (by - ay) * (t0 / len) + PAINT_LIFT, y1 = ay + (by - ay) * (t1 / len) + PAINT_LIFT;
          const p0x = ax + dx * t0, p0z = az + dz * t0, p1x = ax + dx * t1, p1z = az + dz * t1;
          b.quad([p0x + sx * (o + hwl), y0, p0z + sz * (o + hwl)], [p1x + sx * (o + hwl), y1, p1z + sz * (o + hwl)],
            [p1x + sx * (o - hwl), y1, p1z + sz * (o - hwl)], [p0x + sx * (o - hwl), y0, p0z + sz * (o - hwl)], COLOUR_PAINT);
        };
        if (!line.dashed) { strip(0, len); continue; }
        // the dashes that fall inside this segment: [k * period, k * period + dash] in arc length
        for (let k = Math.floor(s0 / DASH_PERIOD); k * DASH_PERIOD < s0 + len; k++) {
          const t0 = Math.max(0, k * DASH_PERIOD - s0), t1 = Math.min(len, k * DASH_PERIOD + DASH_LENGTH - s0);
          if (t1 - t0 > 0.05) strip(t0, t1);
        }
      }
      s0 += len;
      // the underside (the girder's soffit)
      b.quad([ax - sx * half, ay - DECK.thickness, az - sz * half], [bx - sx * half, by - DECK.thickness, bz - sz * half],
        [bx + sx * half, by - DECK.thickness, bz + sz * half], [ax + sx * half, ay - DECK.thickness, az + sz * half], COLOUR_UNDER);
      // the sides of the deck: the girder, and the abutment where the deck is low
      const al = bottomAt(ax + sx * half, az + sz * half, ay);
      const bl = bottomAt(bx + sx * half, bz + sz * half, by);
      const ar = bottomAt(ax - sx * half, az - sz * half, ay);
      const br = bottomAt(bx - sx * half, bz - sz * half, by);
      b.quad([ax + sx * half, ay, az + sz * half], [bx + sx * half, by, bz + sz * half],
        [bx + sx * half, bl, bz + sz * half], [ax + sx * half, al, az + sz * half], COLOUR_SIDE);
      b.quad([bx - sx * half, by, bz - sz * half], [ax - sx * half, ay, az - sz * half],
        [ax - sx * half, ar, az - sz * half], [bx - sx * half, br, bz - sz * half], COLOUR_SIDE);
      // the parapets (a road bridge) / the railings (a footbridge): on both sides of EVERY deck
      const ph = isRoad ? PARAPET_HEIGHT : RAILING_HEIGHT, pw = isRoad ? PARAPET_WIDTH : RAILING_WIDTH;
      const pc = isRoad ? COLOUR_PARAPET : COLOUR_RAILING;
      for (const side of [1, -1]) {
        // the parapet is a wall of thickness pw along the edge: its outer face, its inner face and the strip of its top (the top must NOT span the deck: that was a lid over the whole bridge)
        const o0 = side * half, o1 = side * (half - pw);
        const at = (x, y, z, o) => [x + sx * o, y, z + sz * o];
        b.quad(at(ax, ay + ph, az, o0), at(bx, by + ph, bz, o0), at(bx, by, bz, o0), at(ax, ay, az, o0), pc);          // the outer face
        b.quad(at(bx, by + ph, bz, o1), at(ax, ay + ph, az, o1), at(ax, ay, az, o1), at(bx, by, bz, o1), pc);          // the inner face
        b.quad(at(ax, ay + ph, az, o1), at(bx, by + ph, bz, o1), at(bx, by + ph, bz, o0), at(ax, ay + ph, az, o0), pc);   // the top of the wall
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
      const sx = -dz, sz = dx;
      const a = [x + sx * half, y, z + sz * half];
      const c = [x - sx * half, y, z - sz * half];
      const al = bottomAt(a[0], a[2], y), cl = bottomAt(c[0], c[2], y);
      if (end === 0) b.quad(a, [a[0], al, a[2]], [c[0], cl, c[2]], c, COLOUR_SIDE);
      else b.quad(c, [c[0], cl, c[2]], [a[0], al, a[2]], a, COLOUR_SIDE);
    }
    // the piers
    if (ground) {
      for (const p of piersOf(deck, ground, sdCarAt)) {
        const h = PIER_SIZE / 2, ux = p.dx * h, uz = p.dz * h, vx = -p.dz * h, vz = p.dx * h;
        const c = [[p.x - ux - vx, p.z - uz - vz], [p.x + ux - vx, p.z + uz - vz], [p.x + ux + vx, p.z + uz + vz], [p.x - ux + vx, p.z - uz + vz]];
        for (let k = 0; k < 4; k++) {
          const q = c[k], r = c[(k + 1) % 4];
          b.quad([q[0], p.top, q[1]], [r[0], p.top, r[1]], [r[0], p.bottom, r[1]], [q[0], p.bottom, q[1]], COLOUR_PIER);
        }
        pierCount += 1;
      }
    }
  }
  chunks.finish();
  return { meshes: chunks.meshes, count, piers: pierCount, update: chunks.update };
}
