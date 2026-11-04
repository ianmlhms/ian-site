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

/* The classes a CAR may stand on after a tap on the Kaart, a reset or "I am stuck".  The data marks footways, tracks and
 * pedestrian plazas as drivable (the game is forgiving), but a car put down on a plaza or a field track looks wrong. */
const CAR_KINDS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road',
]);
const SERVICE_PENALTY_M = 6;          // m: a service lane (a car park aisle, a yard) loses against a real street this much closer

/** True for the roads a car belongs on (not footway, pedestrian, steps, path, cycleway, track, bridleway, busway, platform). */
export const isCarRoad = (road) => CAR_KINDS.has(road.kind);

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
      const seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], w: road.width, major, car: isCarRoad(road), name: road.name, road, i };
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
   * The nearest point of a road a CAR may stand on to (x, z) within `maxDist` (`{ all: true }` = every drivable way).  A
   * service lane counts SERVICE_PENALTY_M farther than it is, so a tap on a square lands on the street beside it and not on
   * the car park aisle.
   * Returns { road, x, z, dx, dz, dist } - the point on the centre line and the unit direction of the way there, or null.
   */
  function nearest(x, z, maxDist, { all = false } = {}) {
    let best = null;
    forEach(x - maxDist, z - maxDist, x + maxDist, z + maxDist, (s) => {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const ll = ex * ex + ez * ez;
      if (ll < 1e-9 || (!all && !s.car)) return;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / ll));
      const px = s.ax + ex * t, pz = s.az + ez * t;
      const dist = Math.hypot(x - px, z - pz);
      const score = dist + (!all && s.road.kind === 'service' ? SERVICE_PENALTY_M : 0);
      if (dist > maxDist || (best && score >= best.score)) return;
      const len = Math.sqrt(ll);
      best = { road: s.road, x: px, z: pz, dx: ex / len, dz: ez / len, dist, score };
    });
    return best;
  }

  return { segments, forEach, nearest, cell: CELL };
}
