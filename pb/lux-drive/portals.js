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

const PUSH_MAX = 0.8;          // m: the most a wall pushes the car back in one pass
const BLOCK_HOUSE = 1.0;        // m: a house this close to the box (in front, beside or behind it) takes the portal away
const BLOCK_FRONT = 5.0;        // m in front of the wall a house takes the portal away (the box would stand against its facade, QA2 N-U01)
const BLOCK_BEHIND = 3.0;       // m behind the wall a house still takes the portal away (portalBlocked)
const BLOCK_DECK_BEHIND = 6.0;  // m behind the wall a deck that low over the box still reads as lying on it (QA2 N-U01, 5242,10299)
const BLOCK_DECK_OVER = 2.5;    // m over the top of the wall a deck still takes it away
const LEVEL_BELOW = 1.5;       // m: a car this far under the mouth is on another road (a portal on a bridge end, a road under it)

/** blocked for createPortals: the wall box of a portal (its width, its recess, from its road to its top) touches a house (buildings.js collide) or a deck (decks.js overheadAt: the underside of a deck over it). */
export function portalBlocked(buildings, decks) {
  // (a huge footprint - a block of offices over its own car park, collide14 put them in the index - does not block a mouth: the ramps of Impasse Drosbach under 11862 and
  // Rue du Fort Thüngen under the tower block 4808 lead into them; their portals stand at the façade as before)
  const houseAt = (x, z) => { const h = buildings.collide(x, z, BLOCK_HOUSE); return !!h && !(buildings.isHuge && buildings.isHuge(h.id)); };
  return (p) => {
    if (!Number.isFinite(p.y)) return false;
    for (let u = -p.half - 0.3; u <= p.half + 0.3 + 1e-6; u += (2 * p.half + 0.6) / 8) {
      for (const v of [-BLOCK_FRONT, 0.1, p.depth / 2, p.depth, p.depth + BLOCK_BEHIND / 2, p.depth + BLOCK_BEHIND, p.depth + BLOCK_DECK_BEHIND]) {
        const x = p.x + p.sx * u - p.nx * v, z = p.z + p.sz * u - p.nz * v;
        if (v <= p.depth + BLOCK_BEHIND && buildings && houseAt(x, z)) return true;                                  // (behind the wall too: the house the mouth would be cut into)
        if (v >= 0 && decks && decks.overheadAt(x, z, p.y) <= p.y + p.wallTop + BLOCK_DECK_OVER) return true;   // (a slab just over the box sits on it)
      }
    }
    return false;
  };
}

/** roadAt for createPortals from a road network (road-network.js): the way whose carriageway holds (x, z), or -1. */
export function portalRoadAt(network) {
  const out = { ...network.scratch };
  return (x, z) => { network.carve(x, z, out); return out.sdCar < 0 ? out.road : -1; };
}

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
 * heightAt(x, z) (optional): the ground of the carve (surface.height, never the decks: a mouth under a bridge opens at the road under it).  It
 * gives every portal its level `y` (the road at the mouth); without it the walls are as high as the sky (the old behaviour, for tools).
 * isDrawn(road) (optional): does the game draw this way for a car (road-network isDrawn: carved, or a deck)?  A portal needs a drawn road at its mouth; a
 * garage ramp that is not carved leads to none.  Without it every drivable surface way counts.
 * inPlay(x, z) (optional): is the point inside the play area?  A mouth whose outside lies beyond the play area (its motorway clipped at the border of the world) keeps its portal when a
 * drawn road ends at it from any side (the Grouft south mouth: Rue du Grünewald runs back up along the tunnel from the mouth).
 * roadAt(x, z) (optional): the index of the drawn way whose carriageway holds the point (-1: none).  A road that runs behind / over the wall (an underpass under a street) caps the
 * headwall to a parapet over that road.
 * tubeIds (optional): the ids of the tunnel ways that are drivable tubes (tunnel-tubes.js): they get no closed portal.
 * blocked(p) (optional): does the wall of portal p stand in something solid (a house, a deck)?  Then there is no portal: a mouth cut into a house front or a box under a
 * deck slab (QA2 N-U01) is worse than the road ending at the facade.
 * Returns { list, at(x, z), collide(x, z, radius, y) }.
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
export function createPortals(roads, heightAt = null, isDrawn = () => true, inPlay = null, roadAt = null, blocked = null, tubeIds = null) {
  // (a tunnel the car drives through - tunnel-tubes.js - has open mouths of its own, tunnel-view.js: no closed portal)
  const tunnels = roads.filter((r) => r.tunnel && r.info.drivable && !(tubeIds && tubeIds.has(r.id)));
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
        // the road that leads to the mouth: a way the game draws (carved) whose end is at the mouth and that leaves it outward, along the axis.  The first
        // way with an end within 7 m used to be taken: a side street ending near the mouth, a garage ramp that is not drawn, so the wall stood in the grass
        // beside the road or across nothing (QA B09).  Without such a road the car cannot get there, and a wall would stand in the open: no portal.
        let approach = null, bestGap2 = PORTAL.mouthGap * PORTAL.mouthGap, atBorder = false;
        for (const r of surface) {
          if (!isDrawn(r)) continue;
          const m = r.pts.length;
          for (let f = 0; f < 2; f++) {
            const b = f === 0 ? r.pts[0] : r.pts[m - 1], nb = f === 0 ? r.pts[1] : r.pts[m - 2];
            const g2 = dist2(mouth[0], mouth[1], b[0], b[1]);
            if (g2 > bestGap2) continue;
            const ox = nb[0] - b[0], oz = nb[1] - b[1], ol = Math.hypot(ox, oz);
            if (!(ol > 0.01) || (ox * dx + oz * dz) / ol < PORTAL.approachAlign) continue;
            approach = r; bestGap2 = g2;
          }
        }
        // (the road out of the mouth was clipped at the border of the world: any drawn road that ends at the mouth leads there)
        if (!approach && inPlay && !inPlay(mouth[0] + dx * PORTAL.borderProbe, mouth[1] + dz * PORTAL.borderProbe)) {
          let g2best = PORTAL.mouthGap * PORTAL.mouthGap;
          for (const r of surface) {
            if (!isDrawn(r)) continue;
            for (const b of endsOf(r)) { const g2 = dist2(mouth[0], mouth[1], b[0], b[1]); if (g2 <= g2best) { g2best = g2; approach = r; } }
          }
          atBorder = !!approach;
        }
        if (!approach) continue;
        const bore = Math.max(PORTAL.boreMin, road.width / 2 - PORTAL.boreInset);
        if (bore > road.width / 2 + 0.01) continue;
        list.push({
          x: mouth[0], z: mouth[1], nx: dx, nz: dz, sx: -dz, sz: dx,
          half: road.width / 2 + PORTAL.shoulder,
          bore, top: 0, depth: PORTAL.recess, width: road.width,
          name: road.name || '', road: road.id, approach: approach.id, approachName: approach.name || '', border: atBorder,
        });
      }
    }
  }

  // ---- the height of the mouth: it grows with the width of the road (a garage is lower than a motorway)
  // A headwall reaches at most PORTAL.parapet over a ROAD that runs behind it: the mouth of an underpass under a street is a parapet at the edge of that street, not a wall standing over
  // its carriageway (Rue de Luxembourg under Route de Longwy, QA B09).  The lintel thins first, then the mouth gets lower (never under PORTAL.topMin).  (The land behind the wall of a
  // tunnel under a hill is often lower than the wall - the DTM rounds the hill off at the mouth - and a real headwall stands out of its slope: only a road caps it.)
  for (const p of list) {
    p.top = Math.min(5.2, Math.max(2.7, 2.5 + p.width * 0.2));
    p.y = heightAt ? heightAt(p.x, p.z) : NaN;
    p.lintel = PORTAL.lintel;
    p.cornice = PORTAL.cornice;
    if (heightAt && roadAt) {
      // the roads behind the wall (a parapet over them is the most the wall may stand) and the roads over the wall itself (it ends flush under them, no cornice)
      let behind = -Infinity, over = Infinity;
      for (let v = 0.1; v <= PORTAL.recess + PORTAL.behindReach + 1e-6; v += v < PORTAL.recess ? 0.35 : 1.5) {
        for (let k = -2; k <= 2; k++) {
          const u = (k / 2) * p.half, x = p.x + p.sx * u - p.nx * v, z = p.z + p.sz * u - p.nz * v, r = roadAt(x, z);
          if (r < 0 || r === p.approach) continue;
          const h = heightAt(x, z);
          if (v < PORTAL.recess) over = Math.min(over, h); else behind = Math.max(behind, h);
        }
      }
      const cap = Math.min(behind > -Infinity ? behind - p.y + PORTAL.parapet : Infinity, over - p.y - PORTAL.flush);   // m above y: the highest the wall may reach (Infinity: no road behind or over it)
      if (over < Infinity) { p.cornice = 0; }
      if (cap < Infinity && p.top + p.lintel + p.cornice > cap) {
        const floor = over < Infinity ? PORTAL.topFloor : PORTAL.topMin;
        p.lintel = Math.max(PORTAL.lintelMin, cap - p.cornice - p.top);
        if (p.top + p.lintel + p.cornice > cap) p.top = Math.max(floor, cap - p.cornice - p.lintel);
      }
    }
    p.wallTop = p.top + p.lintel + p.cornice;      // m above y: the top of the headwall
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
            // (the side offset of the CROSSING, not of the segment's first point: a service lane that passes in front of the north mouth of the Rue de Luxembourg underpass and
            // crosses the line of the wall 22 m to the side took that portal away, QA B09)
            const tc = da / (da - db), cxp = ax + (bx - ax) * tc, czp = az + (bz - az) * tc;
            const lat = Math.abs((cxp - p.x) * p.sx + (czp - p.z) * p.sz);
            if (lat > p.half + 3) continue;                          // it crosses far away from the wall
            underRoad.add(p);
          }
        }
      }
    }
  }
  const mouths = list.filter((p) => !underRoad.has(p) && !(blocked && blocked(p)));

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
   * The wall of a portal as a collision: the car cannot cross the wall of the mouth.  The wall is a block: as wide as the portal, PORTAL.recess deep and
   * from under the road to its top.  A car behind it (on the hill over the tunnel) or above it (on a bridge over the mouth) is not in it: the old wall was a
   * half plane as deep as the world and as high as the sky, so a car on the land over a tunnel was pushed out through the mouth, 0.8 m per pass, and thrown
   * 50 m off the top of the portal (QA B05), and a car on a bridge over a mouth stopped at the wall below it (B10).
   * y (optional): the height of the car's body; without it (or without heightAt) every height counts.
   * Returns { nx, nz, pen } (the direction to push the car and how far) or null.
   */
  function collide(x, z, radius, y = NaN) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          if (heightAt && (y > p.y + p.wallTop || y < p.y - LEVEL_BELOW)) continue;   // over the wall or on a road under it
          const lat = (x - p.x) * p.sx + (z - p.z) * p.sz;      // the side of the mouth
          if (lat < -p.half - radius || lat > p.half + radius) continue;
          const dep = (x - p.x) * p.nx + (z - p.z) * p.nz;      // the distance in front of the wall (negative: into the tunnel)
          if (dep > radius || dep < -p.depth - radius) continue;
          // out through the nearest face of the block: the front, the back or a side
          const front = radius - dep, back = dep + p.depth + radius, side = p.half + radius - Math.abs(lat);
          if (side < front && side < back) { const s = lat > 0 ? 1 : -1; return { nx: p.sx * s, nz: p.sz * s, pen: Math.min(side, PUSH_MAX) }; }
          if (front <= back) return { nx: p.nx, nz: p.nz, pen: Math.min(front, PUSH_MAX) };
          return { nx: -p.nx, nz: -p.nz, pen: Math.min(back, PUSH_MAX) };
        }
      }
    }
    return null;
  }

  return { list: mouths, all: list, at, collide };
}
