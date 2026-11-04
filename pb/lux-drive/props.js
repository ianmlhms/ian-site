/* The small solid things of the city (street lamps, catenary poles, park benches): circles in a spatial hash, so the car stops at a lamp post
 * the way it stops at a tree.  Pure maths (no THREE), the same shapes in the game and in the harness. */

const CELL = 16;                    // m, the cell of the spatial hash (the biggest prop radius + the car radius fit in one cell)

export function createPropCollider() {
  const xs = [], zs = [], rs = [];
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;

  /** Adds a circular prop at (x, z) with radius r (m). */
  function add(x, z, r) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) throw new Error(`props.add: bad prop (${x}, ${z}, r=${r})`);
    const i = xs.length;
    xs.push(x); zs.push(z); rs.push(r);
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }

  /** The push out of the prop that the circle (x, z, radius) overlaps most: { nx, nz, pen } or null. */
  function collide(x, z, radius) {
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
          best = d > 1e-4 ? { nx: ox / d, nz: oz / d, pen } : { nx: 1, nz: 0, pen };
        }
      }
    }
    return best;
  }

  return { add, collide, get count() { return xs.length; } };
}
