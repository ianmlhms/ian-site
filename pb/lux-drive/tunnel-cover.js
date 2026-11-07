/* The shallow tunnels of Lux Drive: an OSM tunnel with (almost) no land over it is an open road in the game.
 *
 * The game cannot drive through a tunnel (a single valued height field), so every tunnel ends at a portal (portals.js).
 * That is right for a tunnel under a hill (the Grouft, Cents, the René Konen tunnel under Kirchberg), but OSM also tags
 * as tunnels ways with hardly any land over them: the A1 under the Senningerberg interchange (88 m, 2-4 m of DTM over it,
 * QA B10: a concrete box across the motorway in a field), the underpasses of a car park, the road under a deck.  In the
 * LiDAR terrain there is nothing over those ways, so a portal is a wall standing in the open.  They are opened: drawn,
 * carved and driven as a normal road in a cut whose floor runs straight from mouth to mouth.
 *
 * The rule is measured, not listed: the tunnel ways are chained into runs (the way portals.js chains them), the level of the
 * road inside a run runs between the levels of the ground at its mouths, and the COVER of a point is the DTM over that
 * level.  A run is opened when
 *   - most of it (TUNNEL_OPEN.coverShare) has less than TUNNEL_OPEN.cover of land over it, and nowhere more than
 *     TUNNEL_OPEN.cutMax (no canyon is dug), and
 *   - the floor of its cut is a road a car can take: not steeper than TUNNEL_OPEN.gradeMax from mouth to mouth (the ramps between the levels of a car
 *     park, 23 % over 13 m at Kirchberg, stay tunnels: opened, their ends met the streets with a 1 m step), and
 *   - a lane of a car park (a service, pedestrian or track way) has no other tunnel within TUNNEL_OPEN.lanesNear: the lanes under the plazas of
 *     Kirchberg are a network of tunnels that ramp between levels, and opening some of them left 1.5 m pits and steps where they meet, and
 *   - it is a through way: a street meets each of its (two or more) mouths, and not a garage ramp (a short service way, road-network
 *     GARAGE_RAMP_MAX, that the game does not draw while it dives into a tunnel: opened, such a ramp became a street with a new junction on Bd Royal and
 *     moved its markings).  A stub that leads to a garage door stays a tunnel, and its portal is the door, and
 *   - no house stands over it (the passage under a building stays a tunnel: the building is solid in the game), and
 *   - no carved way crosses over it (a street over a tunnel needs its ground: the underpass of a roundabout stays one), and no other tunnel crosses
 *     it (the lanes of an underground car park on two levels: one height field cannot hold both), and
 *   - it is not stacked under a deck: most of it under a deck that lands at one of its mouths (the deck would be pinned to the opened way there, 9 m
 *     down: Bonnevoie, service 16062 under decks 53 / 64).
 * A bridge deck that crosses over it does not count: the deck rides over the cut (the A1 under deck 32).
 *
 * Pure (no THREE): loadWorldData applies it, so the browser, the harness and the bakers read the same roads. */
import { TUNNEL_OPEN, PORTAL } from './config.js';
import { GARAGE_RAMP_MAX } from './road-network.js';

/* The classes of the lanes of a car park and of the passages (see lanesNear). */
const LANE_KINDS = new Set(['service', 'pedestrian', 'track', 'living_street']);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const endsOf = (road) => [road.pts[0], road.pts[road.pts.length - 1]];

/** Is (x, z) inside the footprint pts (flat [x0, z0, x1, z1, ...], as decodeBuildings gives it)? */
export function insidePolygon(pts, x, z) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Do the segments a-b and c-d cross?  The ends of a-b do not count (a way that leads to the mouth of a tunnel is not over it). */
function segmentsCross(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t > 0.02 && t < 0.98 && u >= 0 && u <= 1;
}

/** The mouths of a run: the ends of its ways that no other way of the run shares. */
function mouthsOf(run) {
  return run.flatMap((t) => endsOf(t).filter((e) => !run.some((u) => u !== t && endsOf(u).some((b) => dist(e, b) <= PORTAL.joinTolerance))));
}

/** The runs of tunnel ways: two ways whose ends are within PORTAL.joinTolerance belong to the same tunnel. */
function tunnelRuns(tunnels) {
  const parent = tunnels.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < tunnels.length; i++) {
    for (let j = i + 1; j < tunnels.length; j++) {
      const joined = endsOf(tunnels[i]).some((a) => endsOf(tunnels[j]).some((b) => dist(a, b) <= PORTAL.joinTolerance));
      if (joined) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
    }
  }
  const runs = new Map();
  tunnels.forEach((t, i) => { const r = find(i); if (runs.has(r)) runs.get(r).push(t); else runs.set(r, [t]); });
  return [...runs.values()];
}

/**
 * The level of the road at every point of every way of a run: between the ground at the two mouths nearest along the run
 * (by the distance along the ways), linear in that distance.  Returns Map(road -> Float64Array of levels at its pts).
 */
function runLevels(run, groundAt) {
  const tol = PORTAL.joinTolerance;
  const nodes = [];
  const nodeOf = (p) => {
    const k = nodes.findIndex((q) => dist(q, p) <= tol);
    if (k >= 0) return k;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges = run.map((road) => ({ road, a: nodeOf(road.pts[0]), b: nodeOf(road.pts[road.pts.length - 1]) }));
  const degree = nodes.map(() => 0);
  for (const e of edges) { degree[e.a]++; degree[e.b]++; }
  const mouths = nodes.map((p, k) => ({ k, level: groundAt(p[0], p[1]) })).filter((m) => degree[m.k] === 1);
  // the distance along the run from every mouth to every node (Bellman-Ford: a run has a handful of ways)
  const distFrom = mouths.map((m) => {
    const d = nodes.map(() => Infinity);
    d[m.k] = 0;
    for (let it = 0; it < nodes.length; it++) {
      for (const e of edges) {
        d[e.b] = Math.min(d[e.b], d[e.a] + e.road.length);
        d[e.a] = Math.min(d[e.a], d[e.b] + e.road.length);
      }
    }
    return d;
  });
  const out = new Map();
  for (const e of edges) {
    const pts = e.road.pts;
    const levels = new Float64Array(pts.length);
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) s += dist(pts[i - 1], pts[i]);
      const along = distFrom.map((d, m) => [Math.min(d[e.a] + s, d[e.b] + e.road.length - s), m]).sort((p, q) => p[0] - q[0]);
      if (along.length === 0) levels[i] = Math.min(groundAt(pts[0][0], pts[0][1]), groundAt(pts[pts.length - 1][0], pts[pts.length - 1][1]));   // a ring
      else if (along.length === 1 || !Number.isFinite(along[1][0])) levels[i] = mouths[along[0][1]].level;
      else {
        const [d1, m1] = along[0], [d2, m2] = along[1];
        levels[i] = mouths[m1].level + ((mouths[m2].level - mouths[m1].level) * d1) / Math.max(1e-6, d1 + d2);
      }
    }
    out.set(e.road, levels);
  }
  return out;
}

/** The cover of a run: the land over the road level every TUNNEL_OPEN.sample m, and whether a house stands over it. */
function measureRun(run, levels, groundAt, housesNear) {
  const covers = [];
  let housed = false;
  for (const road of run) {
    const pts = road.pts, lv = levels.get(road);
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const l = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d < l; d += TUNNEL_OPEN.sample) {
        const f = l > 0 ? d / l : 0;
        const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        covers.push(groundAt(x, z) - (lv[i - 1] + (lv[i] - lv[i - 1]) * f));
        if (!housed && housesNear(x, z).some((b) => insidePolygon(b.pts, x, z))) housed = true;
      }
    }
  }
  covers.sort((a, b) => a - b);
  const at = (q) => (covers.length ? covers[Math.min(covers.length - 1, Math.floor(q * covers.length))] : 0);
  return { cover: at(TUNNEL_OPEN.coverShare), coverMax: at(1), housed };
}

/** The carved ways (drivable, on the ground, not of the run) that cross over a run. */
function crossingWays(run, carved) {
  const out = [];
  for (const other of carved) {
    if (run.includes(other)) continue;
    const crosses = run.some((t) => {
      for (let i = 1; i < t.pts.length; i++) {
        for (let j = 1; j < other.pts.length; j++) if (segmentsCross(t.pts[i - 1], t.pts[i], other.pts[j - 1], other.pts[j])) return true;
      }
      return false;
    });
    if (crosses) out.push(other);
  }
  return out;
}

/** The steepest stretch of the floor of a run (rise over run between two points of a way). */
function floorGrade(run, levels) {
  let worst = 0;
  for (const road of run) {
    const pts = road.pts, lv = levels.get(road);
    let s = 0, s0 = 0, l0 = lv[0];
    for (let i = 1; i < pts.length; i++) {
      s += dist(pts[i - 1], pts[i]);
      if (s - s0 < TUNNEL_OPEN.sample && i < pts.length - 1) continue;      // (two points a few cm apart say nothing about the grade)
      if (s - s0 > 0) worst = Math.max(worst, Math.abs(lv[i] - l0) / (s - s0));
      s0 = s; l0 = lv[i];
    }
  }
  return worst;
}

/** The share of a run (every TUNNEL_OPEN.sample m) that lies under a deck (within its half width of its centre line). */
function underDeckShare(run, decks) {
  let under = 0, total = 0;
  for (const road of run) {
    const pts = road.pts;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const l = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d < l; d += TUNNEL_OPEN.sample) {
        const f = l > 0 ? d / l : 0, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
        total++;
        if (decks.some((k) => nearPolyline(k.pts, x, z, k.width / 2))) under++;
      }
    }
  }
  return total ? under / total : 0;
}

/** Do two polylines come within `r` of each other (a point of one within r of the other)? */
function polylinesNear(a, b, r) {
  return a.some(([x, z]) => nearPolyline(b, x, z, r)) || b.some(([x, z]) => nearPolyline(a, x, z, r));
}

/** Is (x, z) within `r` of the polyline pts ([[x, z], ...])? */
function nearPolyline(pts, x, z, r) {
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], ex = pts[i][0] - ax, ez = pts[i][1] - az;
    if (Math.min(ax, ax + ex) - r > x || Math.max(ax, ax + ex) + r < x || Math.min(az, az + ez) - r > z || Math.max(az, az + ez) + r < z) continue;
    const ll = ex * ex + ez * ez;
    const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
    if (Math.hypot(x - ax - ex * t, z - az - ez * t) <= r) return true;
  }
  return false;
}

/** A small grid of the house footprints near the tunnels only (the whole city is not indexed for 160 short runs). */
export function houseGrid(buildings, tunnels) {
  const CELL = 64, key = (cx, cz) => cx * 65536 + cz;
  const wanted = new Set();
  for (const t of tunnels) for (const [x, z] of t.pts) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) wanted.add(key(Math.floor(x / CELL) + a, Math.floor(z / CELL) + b));
  const cells = new Map();
  for (const b of buildings) {
    if (!b.pts || b.pts.length < 6) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < b.pts.length; i += 2) {
      minX = Math.min(minX, b.pts[i]); maxX = Math.max(maxX, b.pts[i]); minZ = Math.min(minZ, b.pts[i + 1]); maxZ = Math.max(maxZ, b.pts[i + 1]);
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        if (!wanted.has(k)) continue;
        if (cells.has(k)) cells.get(k).push(b); else cells.set(k, [b]);
      }
    }
  }
  return (x, z) => cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
}

/**
 * Opens the shallow tunnels of a road network.
 * roads: the decoded ways (roads.js); groundAt(x, z): the DTM without any road (base-field.js baseHeight); decks: the decoded decks [{ pts: [[x, z], ...] }];
 * buildings: the footprints [{ pts }] (pts flat: x0, z0, x1, z1, ...).
 * Returns { roads, opened }: a NEW array (the input is not changed) in which every way of an opened run is a copy with
 * tunnel = false, openCut = true and cutLevels (the floor of the cut at each of its pts); and the opened runs
 * [{ name, kind, ids, length, cover, coverMax }] (cover: the land over the road on TUNNEL_OPEN.coverShare of the run).
 */
export function openShallowTunnels(roads, groundAt, buildings, decks = []) {
  const tunnels = roads.filter((r) => r.tunnel && r.info.drivable && r.pts.length >= 2);
  const carved = roads.filter((r) => !r.tunnel && r.info.drivable && !r.over && !r.bridge && !((r.layer || 0) >= 1) && r.pts.length >= 2);
  const housesNear = houseGrid(buildings, tunnels);
  const realDecks = decks.filter((d) => d.pts && d.pts.length > 1);
  const deckEnds = realDecks.flatMap((d) => [d.pts[0], d.pts[d.pts.length - 1]]);
  const atDeckEnd = (p) => deckEnds.some((e) => dist(e, p) <= TUNNEL_OPEN.deckEndNear);
  const cutOf = new Map();
  const opened = [];
  for (const run of tunnelRuns(tunnels)) {
    const levels = runLevels(run, groundAt);
    const m = measureRun(run, levels, groundAt, housesNear);
    if (m.cover >= TUNNEL_OPEN.cover || m.coverMax >= TUNNEL_OPEN.cutMax || m.housed) continue;
    if (floorGrade(run, levels) > TUNNEL_OPEN.gradeMax) continue;
    const mouths = mouthsOf(run);
    const street = (r) => !(r.kind === 'service' && r.length <= GARAGE_RAMP_MAX);
    if (mouths.length < 2 || !mouths.every((m) => carved.some((r) => street(r) && endsOf(r).some((e) => dist(e, m) <= PORTAL.mouthGap)))) continue;
    if (LANE_KINDS.has(run[0].kind) && tunnels.some((t) => !run.includes(t) && run.some((r) => polylinesNear(r.pts, t.pts, TUNNEL_OPEN.lanesNear)))) continue;
    if (crossingWays(run, carved).length > 0 || crossingWays(run, tunnels).length > 0) continue;
    if (run.some((r) => endsOf(r).some(atDeckEnd)) && underDeckShare(run, realDecks) > TUNNEL_OPEN.stackedShare) continue;
    for (const road of run) cutOf.set(road, levels.get(road));
    const named = run.find((r) => r.name) || run[0];
    opened.push({
      name: named.name || named.kind, kind: named.kind, ids: run.map((r) => r.id),
      length: run.reduce((s, r) => s + r.length, 0), cover: m.cover, coverMax: m.coverMax,
    });
  }
  const out = roads.map((r) => (cutOf.has(r) ? { ...r, tunnel: false, openCut: true, cutLevels: cutOf.get(r) } : r));
  return { roads: out, opened };
}
