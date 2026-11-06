/* The retaining walls are SOLID for the car, from both sides.  A wall is a block of stone: the car must not climb onto it from the low side (the face), and it must not drop off
 * it from the high side (the back of the block is the edge of the high ground).  The same circle-against-segment test as the walls of the landmarks and the buildings: the face
 * line and the back line of every stretch of a wall are thin walls, and so are its two ends.  The tapered tips of a wall (a few centimetres high) are not solid.
 *
 * Pure (no THREE): the game, the probes and the harness read the same walls. */

export const WALL_COLLIDER = Object.freeze({
  radius: 0.15,           // m: the thickness of the thin walls (the car's own circle comes on top)
  minHeight: 0.5,         // m: a stretch of wall lower than this (the tapered tip) is no obstacle
  cell: 16,               // m: the spatial hash
  levelReach: 2.5,        // m: the car counts as being at the level of the wall when the ground under it is within this of the wall (a car on a bridge above the wall is not blocked by it)
});

/** The thin walls of a decoded wall list: [{ ax, az, bx, bz, top, bottom, id }]. */
export function wallSegments(walls) {
  const segs = [];
  for (const wall of walls) {
    const pts = wall.pts;
    /** A thin wall from a to b ([x, z]) between the wall points p and q (their heights decide whether it is solid). */
    const edge = (a, b, p, q) => {
      if (((p.top - p.bottom) + (q.top - q.bottom)) / 2 < WALL_COLLIDER.minHeight) return;
      segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], top: Math.max(p.top, q.top), bottom: Math.min(p.bottom, q.bottom), id: wall.id });
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      edge([p.x, p.z], [q.x, q.z], p, q);                                                                                  // the face
      edge([p.x + p.nx * p.depth, p.z + p.nz * p.depth], [q.x + q.nx * q.depth, q.z + q.nz * q.depth], p, q);              // the back of the block
    }
    for (const s of [pts[0], pts[pts.length - 1]]) edge([s.x, s.z], [s.x + s.nx * s.depth, s.z + s.nz * s.depth], s, s);   // the ends
  }
  return segs;
}

/**
 * walls: the decoded walls; groundAt(x, z): the height the car stands on there (used when the caller gives no level).
 * Returns { count, collide(x, z, radius, y) -> { nx, nz, pen, id } | null }; y: the level of the car's wheels (drive12: the car's own level, not the ground under
 * the global height hint - a probe of the lanes asks for a car at a level of its own).
 */
export function createWallCollider(walls, groundAt) {
  const segs = wallSegments(walls);
  const cells = new Map();
  const key = (cx, cz) => cx * 65536 + cz;
  segs.forEach((s, i) => {
    const x0 = Math.floor((Math.min(s.ax, s.bx) - 2) / WALL_COLLIDER.cell), x1 = Math.floor((Math.max(s.ax, s.bx) + 2) / WALL_COLLIDER.cell);
    const z0 = Math.floor((Math.min(s.az, s.bz) - 2) / WALL_COLLIDER.cell), z1 = Math.floor((Math.max(s.az, s.bz) + 2) / WALL_COLLIDER.cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const k = key(cx, cz); const l = cells.get(k); if (l) l.push(i); else cells.set(k, [i]); }
  });
  function collide(x, z, radius, y = NaN) {
    const list = cells.get(key(Math.floor(x / WALL_COLLIDER.cell), Math.floor(z / WALL_COLLIDER.cell)));
    if (!list) return null;
    let best = null, ground = null;
    for (const i of list) {
      const s = segs[i];
      const ex = s.bx - s.ax, ez = s.bz - s.az, ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - s.ax) * ex + (z - s.az) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + ex * t, qz = s.az + ez * t;
      const d = Math.hypot(x - qx, z - qz);
      const reach = radius + WALL_COLLIDER.radius;
      if (d >= reach) continue;
      const pen = reach - d;
      if (best && pen <= best.pen) continue;
      if (ground === null) ground = Number.isFinite(y) ? y : groundAt(x, z);
      if (ground > s.top + WALL_COLLIDER.levelReach || ground < s.bottom - WALL_COLLIDER.levelReach) continue;     // on a bridge above the wall / in a tunnel below it
      let nx, nz;
      if (d > 1e-4) { nx = (x - qx) / d; nz = (z - qz) / d; } else { const l = Math.sqrt(ll) || 1; nx = -ez / l; nz = ex / l; }
      best = { nx, nz, pen, id: s.id };
    }
    return best;
  }
  return { count: segs.length, collide };
}
