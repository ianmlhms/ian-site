/* The road index of Lux Drive: every drivable segment in a spatial hash.
 *
 * Three things need to ask "which road is near here?": the Kaart (the minimap draws only the segments around the car), the
 * full-screen map (it draws the ones in view and puts a name on them) and the tap-to-teleport (it needs the nearest point of
 * the nearest road, and the direction of the way there).  They share this one index, so the network is walked only once.
 *
 * Nothing here is mutated after the build: the segments are plain objects, the queries return fresh results. */
import { drivableRoads } from './roads.js';

const CELL = 128;                     // m, the cell of the spatial hash
const MAJOR_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const key = (cx, cz) => cx * 8192 + cz;

/** The class of a road for the map: 0 = minor, 1 = major (the main roads and the motorways). */
export const isMajorRoad = (road) => MAJOR_KINDS.has(road.kind) || road.kind === 'motorway_link' || road.kind === 'trunk_link';

/**
 * @param {Array} roads the decoded roads (roads.js)
 * @returns {{ segments, forEach, nearest, cell }}
 */
export function createRoadIndex(roads) {
  const segments = [];
  const cells = new Map();
  for (const road of drivableRoads(roads)) {
    const major = isMajorRoad(road);
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], w: road.width, major, name: road.name, road, i };
      segments.push(seg);
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const z0 = Math.floor(Math.min(a[1], b[1]) / CELL), z1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          const list = cells.get(k);
          if (list) list.push(seg); else cells.set(k, [seg]);
        }
      }
    }
  }

  /** Calls `fn(segment)` once for every segment whose cell touches the box. */
  function forEach(minX, minZ, maxX, maxZ, fn) {
    const seen = new Set();
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = cells.get(key(cx, cz));
        if (!list) continue;
        for (const s of list) {
          if (seen.has(s)) continue;
          seen.add(s);
          fn(s);
        }
      }
    }
  }

  /**
   * The nearest point of any road to (x, z) within `maxDist`.
   * Returns { road, x, z, dx, dz, dist } - the point on the centre line and the unit direction of the way there, or null.
   */
  function nearest(x, z, maxDist) {
    let best = null;
    forEach(x - maxDist, z - maxDist, x + maxDist, z + maxDist, (s) => {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const ll = ex * ex + ez * ez;
      if (ll < 1e-9) return;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / ll));
      const px = s.ax + ex * t, pz = s.az + ez * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist > maxDist || (best && dist >= best.dist)) return;
      const len = Math.sqrt(ll);
      best = { road: s.road, x: px, z: pz, dx: ex / len, dz: ez / len, dist };
    });
    return best;
  }

  return { segments, forEach, nearest, cell: CELL };
}
