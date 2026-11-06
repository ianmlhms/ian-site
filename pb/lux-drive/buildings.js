/* The buildings of Lux Drive: the LOD2 footprints of the bake in a spatial index.
 *
 * The index serves two things: the collision of the car (a circle against the footprints: the car never drives through a
 * house) and, in the city milestone, the renderer (the buildings around the car).
 * Pure maths (no THREE), so the harness checks the very same shapes as the game.
 * drive12 (QA3 N3-B01): a house stops the car only at its own height - from the ground under its walls to its ridge.  The footprints of Pfaffenthal under the
 * Pont Rouge stopped the car on the deck 60 m above them. */
import { spansLevel } from './level-span.js';

const CELL = 32;                 // m, the cell of the spatial hash
const MAX_CELLS_PER_BUILDING = 64;

/** The bounding box of a footprint. */
function boundsOf(pts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** The closest point of a polygon to (x, z): { d, qx, qz } (d = the distance). */
function closestOnPolygon(pts, x, z, out) {
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const ex = bx - ax, ez = bz - az;
    const ll = ex * ex + ez * ez;
    let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t, qz = az + ez * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; out.qx = qx; out.qz = qz; }
  }
  return best;
}

/**
 * buildings: the decoded LOD2 footprints [{ id, roof, style, ridgeDir, levels, eave, ridge, pts }]
 * `hidden`: ids of the blocks a landmark replaces (they are not indexed: no invisible wall where a landmark stands).
 * `groundAt(x, z)` / `landAt(x, z)`: the ground as the game draws it and the land (building-mesh.js stands the walls on the one and measures the eave from the
 * higher of the two).  Without them a house is solid at every height.
 * Returns { count, collide(x, z, radius, y), near(x, z, radius), levelOf(id), boxes }.
 */
export function createBuildingIndex(buildings, { cell = CELL, hidden = null, groundAt = null, landAt = null } = {}) {
  const boxes = new Map();                       // id -> the bounding box
  const cells = new Map();                       // cell key -> the ids inside
  const key = (cx, cz) => cx * 100003 + cz;
  for (const b of buildings) {
    if (hidden && hidden.has(b.id)) continue;      // a landmark replaces this block: it has its own collision
    const box = boundsOf(b.pts);
    boxes.set(b.id, box);
    const cx0 = Math.floor(box.minX / cell), cx1 = Math.floor(box.maxX / cell);
    const cz0 = Math.floor(box.minZ / cell), cz1 = Math.floor(box.maxZ / cell);
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > MAX_CELLS_PER_BUILDING) continue;    // a huge building: it is not worth indexing (there is none)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list) list.push(b.id); else cells.set(k, [b.id]);
      }
    }
  }
  const scratch = { qx: 0, qz: 0 };
  const levels = new Map();                      // id -> [bottom, top], measured the first time a car comes near

  /** The height range of a house: from the lowest ground under its corners to its ridge over the ground at its middle (building-mesh.js addBuilding). */
  function levelOf(id) {
    let lv = levels.get(id);
    if (lv) return lv;
    const b = buildings[id], pts = b.pts, n = pts.length / 2;
    if (!groundAt) { lv = [-Infinity, Infinity]; levels.set(id, lv); return lv; }
    let cx = 0, cz = 0, bottom = Infinity;
    for (let i = 0; i < n; i++) { cx += pts[i * 2] / n; cz += pts[i * 2 + 1] / n; bottom = Math.min(bottom, groundAt(pts[i * 2], pts[i * 2 + 1])); }
    const foot = Math.max(groundAt(cx, cz), landAt ? landAt(cx, cz) : -Infinity);
    lv = [Math.min(bottom, foot), foot + Math.max(b.ridge, b.eave)];
    levels.set(id, lv);
    return lv;
  }

  /** The buildings whose cell is within the radius of (x, z): [id, ...]. */
  function near(x, z, radius) {
    const out = [];
    const seen = new Set();
    const cx0 = Math.floor((x - radius) / cell), cx1 = Math.floor((x + radius) / cell);
    const cz0 = Math.floor((z - radius) / cell), cz1 = Math.floor((z + radius) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const id of list) if (!seen.has(id)) { seen.add(id); out.push(id); }
      }
    }
    return out;
  }

  /** The push out of a building: { nx, nz, pen, id } when the circle touches a footprint at the car's height (y: the level of its wheels; NaN = every height), otherwise null. */
  function collide(x, z, radius, y = NaN) {
    let best = null;
    for (const id of near(x, z, radius)) {
      const b = buildings[id];
      const d = closestOnPolygon(b.pts, x, z, scratch);
      if (d >= radius) continue;
      const pen = radius - d;
      if (best && pen <= best.pen) continue;
      if (Number.isFinite(y)) { const [bottom, top] = levelOf(id); if (!spansLevel(y, bottom, top)) continue; }      // on a bridge over it, in a tunnel under it
      let nx, nz;
      if (d > 1e-4) { nx = (x - scratch.qx) / d; nz = (z - scratch.qz) / d; }
      else {
        // the centre is inside the footprint: push it out through the nearest edge
        const box = boxes.get(id);
        const cxm = (box.minX + box.maxX) / 2, czm = (box.minZ + box.maxZ) / 2;
        const dx = box.maxX - x, dz = box.maxZ - z, ddx = x - box.minX, ddz = z - box.minZ;
        const m = Math.min(dx, dz, ddx, ddz);
        if (m === dx) { nx = 1; nz = 0; } else if (m === dz) { nx = 0; nz = 1; } else if (m === ddx) { nx = -1; nz = 0; } else { nx = 0; nz = -1; }
        void cxm; void czm;
      }
      best = { nx, nz, pen, id };
    }
    return best;
  }

  return { count: buildings.length, collide, near, levelOf, boxes, buildings };
}
