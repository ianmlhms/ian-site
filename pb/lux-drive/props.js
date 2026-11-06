/* The small solid things of the city (street lamps, catenary poles, park benches): circles in a spatial hash, so the car stops at a lamp post
 * the way it stops at a tree.  Pure maths (no THREE), the same shapes in the game and in the harness.
 * drive12: a prop has a height range (the ground it stands on, its height): a car on a bridge over a lamp, or under the catenary pole of a tram
 * bridge, is not stopped by it.  Without a level (y undefined) every height counts, as before. */
import { spansLevel } from './level-span.js';

const CELL = 16;                    // m, the cell of the spatial hash (the biggest prop radius + the car radius fit in one cell)

export function createPropCollider() {
  const xs = [], zs = [], rs = [], ys = [], hs = [];
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;

  /** Adds a circular prop at (x, z) with radius r (m), standing on the ground at height y, `height` m tall (no y: solid at every height). */
  function add(x, z, r, y = NaN, height = Infinity) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) throw new Error(`props.add: bad prop (${x}, ${z}, r=${r})`);
    const i = xs.length;
    xs.push(x); zs.push(z); rs.push(r); ys.push(Number.isFinite(y) ? y : -Infinity); hs.push(Number.isFinite(y) ? height : Infinity);
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }

  /** The push out of the prop that the circle (x, z, radius) overlaps most: { nx, nz, pen } or null.  y: the level of the car's wheels (optional). */
  function collide(x, z, radius, y = NaN) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const ox = x - xs[i], oz = z - zs[i];
          const d = Math.hypot(ox, oz);
          const reach = rs[i] + radius;
          if (d >= reach) continue;
          const pen = reach - d;
          if (best && pen <= best.pen) continue;
          if (!spansLevel(y, ys[i], ys[i] + hs[i])) continue;           // over it on a bridge, or under it
          best = d > 1e-4 ? { nx: ox / d, nz: oz / d, pen } : { nx: 1, nz: 0, pen };
        }
      }
    }
    return best;
  }

  return { add, collide, get count() { return xs.length; } };
}
