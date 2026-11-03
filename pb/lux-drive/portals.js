/* The tunnel portals of Lux Drive: the mouth of every tunnel the car cannot drive into.
 *
 * A tunnel cannot be a trench in a single valued height field: the René Konen tunnel (the Hellege-Geescht) runs 600 m
 * under the streets of Kirchberg, and digging it out would cut a canyon through the city.  The tunnels are therefore kept
 * out of the carve and out of the drivable network (roads.js), and each of them gets a portal: a concrete headwall across
 * the road with the dark mouth of the tunnel in it.  The car stops at the wall, the way it stops in front of a tunnel that
 * is closed to it.
 *
 * The portals are found in the road network itself: the tunnel ways are chained into runs (two ways that share an end
 * belong to the same tunnel), and the ends of a run that a surface road leads to are the mouths.  A tunnel that no road
 * leads to gets no portal: the car cannot get there anyway.
 *
 * Pure (no THREE): the browser, the probes and the harness read the same portals. */
import { PORTAL } from './config.js';

const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const endsOf = (road) => [road.pts[0], road.pts[road.pts.length - 1]];

/* The classes that are a real carriageway: a footpath or a track that crosses the mouth of a tunnel does not
 * take the portal away, but a street that runs over it would be blocked by the wall. */
const CARRIAGEWAY = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'service', 'road', 'busway',
]);

/**
 * The portals of the tunnels of a road network.
 * Returns { list, at(x, z), collide(x, z, radius) }.
 *
 * A portal is { x, z, nx, nz, sx, sz, half, bore, top, depth, width, name, road }:
 *   x, z   the mouth, on the centre line of the road
 *   nx, nz the axis of the mouth, pointing OUT of the tunnel (the way the car arrives)
 *   sx, sz the side of the mouth (perpendicular to the axis)
 *   half   the half width of the wall
 *   bore   the half width of the mouth of the tunnel
 *   top    the height of the mouth above the ground
 *   depth  how deep the wall goes into the tunnel
 */
export function createPortals(roads) {
  const tunnels = roads.filter((r) => r.tunnel && r.info.drivable);
  const surface = roads.filter((r) => !r.tunnel && r.info.drivable);

  // ---- chain the tunnel ways into runs (two ways that share an end belong to the same tunnel)
  const parent = tunnels.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const joinTol2 = PORTAL.joinTolerance * PORTAL.joinTolerance;
  for (let i = 0; i < tunnels.length; i++) {
    for (let j = i + 1; j < tunnels.length; j++) {
      for (const a of endsOf(tunnels[i])) {
        for (const b of endsOf(tunnels[j])) {
          if (dist2(a[0], a[1], b[0], b[1]) <= joinTol2) union(i, j);
        }
      }
    }
  }
  const runs = new Map();
  for (let i = 0; i < tunnels.length; i++) {
    const root = find(i);
    if (!runs.has(root)) runs.set(root, []);
    runs.get(root).push(i);
  }

  // ---- the ends of the runs: the mouths
  const list = [];
  const approachTol2 = PORTAL.approachTolerance * PORTAL.approachTolerance;
  for (const run of runs.values()) {
    for (const i of run) {
      const road = tunnels[i];
      const pts = road.pts;
      for (let e = 0; e < 2; e++) {
        const mouth = e === 0 ? pts[0] : pts[pts.length - 1];
        // is this end shared with another way of the run?  Then it is in the middle of the tunnel.
        let shared = false;
        for (const j of run) {
          if (j === i) continue;
          for (const b of endsOf(tunnels[j])) {
            if (dist2(mouth[0], mouth[1], b[0], b[1]) <= joinTol2) { shared = true; break; }
          }
          if (shared) break;
        }
        if (shared) continue;
        // the axis of the mouth, pointing out of the tunnel
        const inner = e === 0 ? pts[1] : pts[pts.length - 2];
        let dx = mouth[0] - inner[0], dz = mouth[1] - inner[1];
        const len = Math.hypot(dx, dz);
        if (!(len > 0.01)) continue;
        dx /= len; dz /= len;
        // does a surface road lead to the mouth?  Without one the car cannot get there.
        let approach = null;
        for (const r of surface) {
          for (const b of endsOf(r)) {
            if (dist2(mouth[0], mouth[1], b[0], b[1]) <= approachTol2) { approach = r; break; }
          }
          if (approach) break;
        }
        if (!approach) continue;
        const bore = Math.max(PORTAL.boreMin, road.width / 2 - PORTAL.boreInset);
        if (bore > road.width / 2 + 0.01) continue;
        list.push({
          x: mouth[0], z: mouth[1], nx: dx, nz: dz, sx: -dz, sz: dx,
          half: road.width / 2 + PORTAL.shoulder,
          bore, top: 0, depth: PORTAL.recess, width: road.width,
          name: road.name || '', road: road.id, approach: approach.id, approachName: approach.name || '',
        });
      }
    }
  }

  // ---- the height of the mouth: it grows with the width of the road (a garage is lower than a motorway)
  for (const p of list) {
    p.top = Math.min(5.2, Math.max(2.7, 2.5 + p.width * 0.2));
  }

  // ---- a mouth under a street has no portal: there is no open mouth there, and a wall would block the street
  const CELL = PORTAL.cell;
  const key = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const mouthCells = new Map();
  for (const p of list) {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    if (!mouthCells.has(k)) mouthCells.set(k, []);
    mouthCells.get(k).push(p);
  }
  const underRoad = new Set();
  for (const r of surface) {
    if (!CARRIAGEWAY.has(r.kind)) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const ax = r.pts[i][0], az = r.pts[i][1], bx = r.pts[i + 1][0], bz = r.pts[i + 1][1];
      const cx0 = Math.floor(Math.min(ax, bx) / CELL), cx1 = Math.floor(Math.max(ax, bx) / CELL);
      const cz0 = Math.floor(Math.min(az, bz) / CELL), cz1 = Math.floor(Math.max(az, bz) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = mouthCells.get(key(cx, cz));
          if (!bucket) continue;
          for (const p of bucket) {
            if (underRoad.has(p)) continue;
            if (r.id === p.approach) continue;                       // the road that leads to the mouth
            const da = (ax - p.x) * p.nx + (az - p.z) * p.nz;        // the sides of the wall
            const db = (bx - p.x) * p.nx + (bz - p.z) * p.nz;
            if (da * db >= 0) continue;                              // the road does not cross the wall
            const lat = Math.abs((ax - p.x) * p.sx + (az - p.z) * p.sz);
            if (lat > p.half + 3) continue;                          // it crosses far away from the wall
            underRoad.add(p);
          }
        }
      }
    }
  }
  const mouths = list.filter((p) => !underRoad.has(p));

  // ---- the spatial hash of the walls
  const buckets = new Map();
  for (const p of mouths) {
    const ex = p.x + p.sx * p.half, ez = p.z + p.sz * p.half;
    const minX = Math.min(p.x, ex), maxX = Math.max(p.x, ex);
    const minZ = Math.min(p.z, ez), maxZ = Math.max(p.z, ez);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        const bucket = buckets.get(k);
        if (bucket) bucket.push(p); else buckets.set(k, [p]);
      }
    }
  }

  /** The portal nearest to (x, z) within `radius` m (or null). */
  function at(x, z, radius = 40) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null, bestD = radius * radius;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const d = dist2(x, z, p.x, p.z);
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    return best;
  }

  /**
   * The wall of a portal as a collision: the car cannot cross the wall of the mouth.
   * Returns { nx, nz, pen } (the direction to push the car and how far) or null.
   */
  function collide(x, z, radius) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const lat = (x - p.x) * p.sx + (z - p.z) * p.sz;      // the side of the mouth
          if (lat < -p.half - radius || lat > p.half + radius) continue;
          const dep = (x - p.x) * p.nx + (z - p.z) * p.nz;      // the distance in front of the wall
          if (dep > radius) continue;
          if (Math.abs(lat) > p.half) {                          // beside the wall: push the car to the side
            const s = lat > 0 ? 1 : -1;
            return { nx: p.sx * s, nz: p.sz * s, pen: Math.min(Math.abs(lat) - p.half + radius, 0.8) };
          }
          return { nx: p.nx, nz: p.nz, pen: Math.min(radius - dep, 0.8) };
        }
      }
    }
    return null;
  }

  return { list: mouths, all: list, at, collide };
}
