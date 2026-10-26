/* The built places of the valley as pure data (no THREE): the Berdorf village and the Beaufort houses and castles are rectangles baked from the OSM footprints with LiDAR heights
 * (scripts/mtb/bake_buildings.py -> data/buildings.json). Shared by the game (town-model.js builds the meshes), the physics (collide: nobody rides through a house) and the harness.
 *   house = [cx, cz, hx, hz, yaw, eave, ridge, flags, seed]
 *   flags: 1 flat roof, 2 hip roof, 4 dormer, 8 outbuilding, 16 church, 32 Beaufort Renaissance castle (a wing of it), 64 Beaufort medieval ruin (a wing of it) */
export const FLAT = 1, HIP = 2, DORMER = 4, OUTBUILDING = 8, CHURCH = 16, RENAISSANCE = 32, RUIN = 64;
const CELL = 32;                 // m: spatial hash of the collision index
const SINK = 0.9;                // m: the walls reach this far below the lowest ground under the footprint (no gap on a slope)
const GROUND_PROBES = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];

/** Turns the baked rows into objects with the axis vectors and the ground heights under the footprint. surface = the physics surface. */
export function describeHouses(rows, surface) {
  return rows.map((r, i) => {
    const [cx, cz, hx, hz, yaw, eave, ridge, flags, seed] = r;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ax = c, az = s, bx = -s, bz = c;
    let gMin = 1e9, gMax = -1e9, gSum = 0;
    for (const [u, v] of GROUND_PROBES) {
      const h = surface.height(cx + ax * u * hx + bx * v * hz, cz + az * u * hx + bz * v * hz);
      gMin = Math.min(gMin, h); gMax = Math.max(gMax, h); gSum += h;
    }
    const gMean = gSum / GROUND_PROBES.length;
    return Object.freeze({ id: i, cx, cz, hx, hz, yaw, ax, az, bx, bz, eave, ridge, flags, seed: seed / 1000, gMin, gMax, gMean, base: gMin - SINK, eaveY: gMean + eave, ridgeY: gMean + ridge });
  });
}

/** The pitch of a gable or hip roof: the LiDAR ridge height above the eave, kept between 27 and 43 degrees of the half width. */
export function roofRise(h) { return Math.min(h.hz * 0.95, Math.max(h.hz * 0.55, h.ridge - h.eave)); }

/** Spatial index of the houses for the collision and the harness. Returns { houses, collide(x, z, r, y, out), insideRect(x, z, margin), distance(h, x, z, out) }. */
export function createTownIndex(houses) {
  const cells = new Map();
  houses.forEach((h, i) => {
    const reach = Math.hypot(h.hx, h.hz) + 1;
    for (let gz = Math.floor((h.cz - reach) / CELL); gz <= Math.floor((h.cz + reach) / CELL); gz++) for (let gx = Math.floor((h.cx - reach) / CELL); gx <= Math.floor((h.cx + reach) / CELL); gx++) {
      const key = gx * 100003 + gz; const list = cells.get(key); if (list) list.push(i); else cells.set(key, [i]);
    }
  });
  const list = (x, z) => cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || [];
  /** Signed distance (m) from (x, z) to the rectangle of house h (negative inside); `out` (optional) receives the outward normal. */
  function distance(h, x, z, out) {
    const dx = x - h.cx, dz = z - h.cz;
    const u = dx * h.ax + dz * h.az, v = dx * h.bx + dz * h.bz;
    const qu = Math.abs(u) - h.hx, qv = Math.abs(v) - h.hz;
    const outside = Math.hypot(Math.max(qu, 0), Math.max(qv, 0)), d = outside + Math.min(Math.max(qu, qv), 0);
    if (out) {
      let nu, nv;
      if (outside > 0) { nu = qu > 0 ? Math.sign(u) * qu : 0; nv = qv > 0 ? Math.sign(v) * qv : 0; const l = Math.hypot(nu, nv) || 1; nu /= l; nv /= l; }
      else if (qu > qv) { nu = Math.sign(u) || 1; nv = 0; } else { nu = 0; nv = Math.sign(v) || 1; }
      out.nx = h.ax * nu + h.bx * nv; out.nz = h.az * nu + h.bz * nv;
    }
    return d;
  }
  /** Deepest penetration of a circle into a house (the walls are higher than any bike: always solid) as { nx, nz, pen } or null. */
  function collide(x, z, r, y, out) {
    let best = 0;
    for (const i of list(x, z)) {
      const h = houses[i];
      if (h.flags & FLAT && h.eave < 2.6) continue;                          // a low flat shed or carport is a fence, not a wall
      const d = distance(h, x, z, null);
      if (d < r && r - d > best) { best = r - d; distance(h, x, z, out); out.pen = best; }
    }
    return best > 0 ? out : null;
  }
  function insideRect(x, z, margin = 0) { for (const i of list(x, z)) if (distance(houses[i], x, z, null) < margin) return houses[i]; return null; }
  return { houses, collide, insideRect, distance };
}
