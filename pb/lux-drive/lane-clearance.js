/* The lanes are clear (drive12, QA3 N3-W01 / N3-W02 / N3-D01 / N3-D02): the car's body is put down on the centre of every lane of every car road, every metre, at
 * the level of that road (on its deck where it is a bridge), and asked whether anything that stops the car touches it - a retaining wall, a house, a lamp, a tree,
 * a portal, a guard rail.  The QA found a wall across both lanes of the A1 at a viaduct (wall 52) and 34 road / wall pairs with the lane centre inside a wall block.
 * Pure (no THREE): the harness (section T) and the drive tools run the same scan.
 *
 * The lanes of a way: a one-way street has max(1, lanes) lanes over its width, a two-way street max(2, lanes) (half of them each way); a lane's centre stays
 * LANE.edgeClear inside the edge of the carriageway (the car's half width: a car never drives with its wheels off the tarmac). */
import { CAR } from './config.js';
import { isCarRoad } from './road-index.js';
import { WALL_COLLIDER, aboveOnDeck } from './wall-collider.js';

export const LANE = Object.freeze({
  step: 1,                 // m between the samples along a lane
  edgeClear: 0.9,          // m: a lane's centre lies at least this far inside the edge of its carriageway (CAR half width)
  hintLift: 0.5,           // m: a way that is no bridge is probed on its ground (a deck higher than this over it is a bridge over the lane, placement.js)
});

/** A retaining wall and the lanes (scripts/luxdrive/bake_walls.mjs, harness K and T): its collision lines keep `clear` from the centre line of every lane at its level; a
 *  wall point that comes closer moves `shiftStep` at a time, up to `shiftMax`, up its ramp (or its back toward its face), else it is dropped. */
export const WALL_LANE = Object.freeze({
  clear: CAR.bodyRadius + WALL_COLLIDER.radius + 0.2,      // (+0.2: on a bend the nose and tail circles of the car leave the lane centre line by up to ~0.15 m)
  shiftStep: 0.15,
  shiftMax: 0.6,
});

/** The lateral offsets of the lane centres of a road (m, to the left of its direction; symmetric). */
export function laneOffsets(road) {
  const n = road.oneway ? Math.max(1, road.lanes || 1) : Math.max(2, road.lanes || 2);
  const lane = road.width / n, limit = Math.max(0, road.width / 2 - LANE.edgeClear);
  const out = [];
  for (let k = 0; k < n; k++) out.push(Math.max(-limit, Math.min(limit, -road.width / 2 + (k + 0.5) * lane)));
  return [...new Set(out.map((o) => Math.round(o * 100) / 100))];
}

/** The car roads the scan drives: car classes (road-index.js isCarRoad), no closed tunnel (its portal stops the car on purpose). */
export function laneRoads(roads, isOpen = () => false) {
  return roads.filter((r) => isCarRoad(r) && r.pts.length >= 2 && (!r.tunnel || isOpen(r)));
}

/**
 * Every lane sample whose car body touches something.  parts: car-collide.js parts ([name, fn]); `skip`: part names that do not count (the moving trams, the edge
 * of the area); ground: decks.js createGround (levelAt), surface: the terrain.
 * Returns { samples, hits: [{ road, name, kind, off, x, z, y, part, id, pen, end }] } - one per sample (the deepest part), `end` = the sample lies within the car's
 * length of an end of the way that no other car road continues.
 */
export function laneClearanceScan({ roads, parts, ground, surface, skip = new Set(['tram', 'area']), isOpen, only = null, follow = false }) {
  const use = parts.filter(([name]) => !skip.has(name));
  const ends = endIndex(laneRoads(roads, isOpen));
  const hits = [];
  let samples = 0;
  for (const r of laneRoads(roads, isOpen)) {
    if (only && !only(r)) continue;
    const offs = laneOffsets(r);
    const bridge = !!(r.over || r.bridge);
    const P = r.pts;
    const free = [0, P.length - 1].filter((i) => !ends.continued(r, i)).map((i) => P[i]);
    const hints = new Map();                 // follow: the level carried along each lane of a bridge way
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += LANE.step) {
        for (const off of offs) {
          const x = ax + dx * s - dz * off, z = az + dz * s + dx * off;
          const y = !bridge ? ground.levelAt(x, z, surface.height(x, z) + LANE.hintLift) : !follow ? ground.levelAt(x, z, 1e9) : ground.levelAt(x, z, hints.has(off) ? hints.get(off) + LANE.hintLift : 1e9);
          if (bridge && follow) hints.set(off, y);
          samples++;
          let best = null;
          for (const o of CAR.bodyCircles.concat(0)) {
            for (const [name, f] of use) {
              const h = f(x + dx * o, z + dz * o, CAR.bodyRadius, y);
              if (h && (!best || h.pen > best.pen)) best = { part: name, id: h.id, pen: h.pen };
            }
          }
          if (!best) continue;
          const end = free.some((q) => Math.hypot(q[0] - x, q[1] - z) <= CAR.bodyCircles[0] + CAR.bodyRadius + LANE.step);
          hits.push({ road: r.id, name: r.name || r.kind, kind: r.kind, off, x, z, y, ...best, end });
        }
      }
    }
  }
  return { samples, hits };
}

/** The ends of the car roads: continued(r, i) = another car road has a point within 1 m of the end i of way r. */
function endIndex(roads) {
  const CELL = 4, cells = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const r of roads) for (const p of r.pts) { const k = key(p[0], p[1]); const l = cells.get(k); if (l) l.push([p, r]); else cells.set(k, [[p, r]]); }
  return {
    continued(r, i) {
      const [x, z] = r.pts[i];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const [p, o] of cells.get(`${Math.floor(x / CELL) + a},${Math.floor(z / CELL) + b}`) || []) if (o !== r && Math.hypot(p[0] - x, p[1] - z) <= 1) return true;
      }
      return false;
    },
  };
}

/** The hits grouped by road and part id: [{ road, name, part, id, n, maxPen, first: [x, z], offs, end }] sorted by count. */
export function groupHits(hits) {
  const m = new Map();
  for (const h of hits) {
    const k = `${h.road}:${h.part}:${h.id}`;
    const e = m.get(k) || { road: h.road, name: h.name, kind: h.kind, part: h.part, id: h.id, n: 0, maxPen: 0, first: [Math.round(h.x), Math.round(h.z)], offs: new Set(), end: true };
    e.n++; e.maxPen = Math.max(e.maxPen, h.pen); e.offs.add(h.off); e.end = e.end && h.end;
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ ...e, offs: [...e.offs] })).sort((a, b) => b.n - a.n);
}

/* ---- the lanes as segments (the wall bake and harness T): the centre line of every lane of every car road, with its level, as short pieces in a spatial hash.  A retaining
 * wall's collision block (wall-collider.js: the face line, the back line, the ends) must keep LANE_WALL_CLEAR from every one of them that is at the wall's level - the car's
 * body circles (CAR.bodyRadius) ride on that line, the thin wall has WALL_COLLIDER.radius. */
const LANE_PIECE = 4;            // m: the longest piece of a lane (its level is linear between its ends)
const LANE_CELL = 16;            // m: the spatial hash of the pieces
const LANE_FOLLOW_STEP = 1;      // m: createLaneSegments `follow` carries the level of a bridge lane this often (a spiral ramp climbs 1 m in 4 m)

/**
 * The lane centre lines of the car roads: { near(ax, az, bx, bz, reach) -> pieces [{ ax, az, ay, bx, bz, by, road }], count }.  Each way's lanes are its offset
 * segments, the corners joined (the offset of one segment to the next), every segment run on CAR.bodyCircles[0] past both its ends (the nose of a car at a corner or
 * at the end of a dead end: a road may never end in a wall).  `within(x, z)`: only the pieces near something (the bake: near the walls).
 */
export function createLaneSegments({ roads, ground, surface, isOpen, within = null, follow = false }) {
  const list = laneRoads(roads, isOpen);
  const pieces = [];
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  // the level of a lane: on its ground (a way that is no bridge), else the highest deck - or with `follow` (collide14) the deck at the level carried along the lane
  // from its start, every LANE_FOLLOW_STEP, as the wheels follow it: "the highest" put the lane of the lower turn of the Buchler car park spiral (way 14883, on the
  // ground at 283 m) onto the top of deck 59 at 292 m over it, and the parapet there yielded to a lane 9 m under it (harness V3: the car fell 7 m)
  let hint = null;
  const levelOf = (r, x, z) => {
    if (!(r.over || r.bridge)) return ground.levelAt(x, z, surface.height(x, z) + LANE.hintLift);
    if (!follow) return ground.levelAt(x, z, 1e9);
    hint = ground.levelAt(x, z, hint === null ? 1e9 : hint + LANE.hintLift);
    return hint;
  };
  const add = (r, ax, az, bx, bz) => {
    const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / LANE_PIECE));
    const carried = follow && !!(r.over || r.bridge);
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n, x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
      if (carried) {
        // (the level is carried over every piece, also the ones left out: the next one starts at the level this one ends at)
        const ay = levelOf(r, x0, z0), m = Math.max(1, Math.ceil(l / n / LANE_FOLLOW_STEP));
        for (let j = 1; j < m; j++) levelOf(r, x0 + ((x1 - x0) * j) / m, z0 + ((z1 - z0) * j) / m);
        const by = levelOf(r, x1, z1);
        if (within && !within(x0, z0) && !within(x1, z1)) continue;
        push({ ax: x0, az: z0, ay, at: surface.height(x0, z0), bx: x1, bz: z1, by, bt: surface.height(x1, z1), road: r.id });
        continue;
      }
      if (within && !within(x0, z0) && !within(x1, z1)) continue;
      // (at, bt: the terrain under the ends - a lane on a deck over a wall rides over it, wall-collider.js aboveOnDeck)
      push({ ax: x0, az: z0, ay: levelOf(r, x0, z0), at: surface.height(x0, z0), bx: x1, bz: z1, by: levelOf(r, x1, z1), bt: surface.height(x1, z1), road: r.id });
    }
  };
  /** A piece into the list and the hash. */
  function push(p) {
    const i = pieces.length;
    pieces.push(p);
    for (let cx = Math.floor(Math.min(p.ax, p.bx) / LANE_CELL); cx <= Math.floor(Math.max(p.ax, p.bx) / LANE_CELL); cx++) {
      for (let cz = Math.floor(Math.min(p.az, p.bz) / LANE_CELL); cz <= Math.floor(Math.max(p.az, p.bz) / LANE_CELL); cz++) {
        const k2 = key(cx, cz), c = cells.get(k2);
        if (c) c.push(i); else cells.set(k2, [i]);
      }
    }
  }
  for (const r of list) {
    const P = r.pts;
    for (const off of laneOffsets(r)) {
      let prev = null;
      hint = null;
      for (let i = 0; i + 1 < P.length; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1], l = Math.hypot(bx - ax, bz - az);
        if (l < 0.05) continue;
        const dx = (bx - ax) / l, dz = (bz - az) / l;
        const a = [ax - dz * off, az + dx * off], b = [bx - dz * off, bz + dx * off];
        if (prev) add(r, prev[0], prev[1], a[0], a[1]);                              // the corner: from the end of the last offset segment to the start of this one
        // the segment, run on by the nose / tail circle of the car at both ends (a car at the corner, or at the end of a dead end, still points along it)
        add(r, a[0] - dx * CAR.bodyCircles[0], a[1] - dz * CAR.bodyCircles[0], b[0] + dx * CAR.bodyCircles[0], b[1] + dz * CAR.bodyCircles[0]);
        prev = b;
      }
    }
  }
  function near(ax, az, bx, bz, reach) {
    const out = [], seen = new Set();
    for (let cx = Math.floor((Math.min(ax, bx) - reach) / LANE_CELL); cx <= Math.floor((Math.max(ax, bx) + reach) / LANE_CELL); cx++) {
      for (let cz = Math.floor((Math.min(az, bz) - reach) / LANE_CELL); cz <= Math.floor((Math.max(az, bz) + reach) / LANE_CELL); cz++) {
        for (const i of cells.get(key(cx, cz)) || []) if (!seen.has(i)) { seen.add(i); out.push(pieces[i]); }
      }
    }
    return out;
  }
  return { near, count: pieces.length };
}

/** The distance between two segments in the plane, and the parameter t (0..1) on the second one at the closest approach. */
export function segmentGap(ax, az, bx, bz, cx, cz, dx, dz) {
  const pt = (px, pz, sx, sz, ex, ez) => {
    const vx = ex - sx, vz = ez - sz, ll = vx * vx + vz * vz;
    const t = ll > 1e-12 ? Math.max(0, Math.min(1, ((px - sx) * vx + (pz - sz) * vz) / ll)) : 0;
    return [Math.hypot(px - sx - vx * t, pz - sz - vz * t), t];
  };
  const cross = (ox, oz, px, pz, qx, qz) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz), d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return { d: 0, t: Math.abs(d1) / (Math.abs(d1) + Math.abs(d2)) };
  const c = [pt(cx, cz, ax, az, bx, bz), pt(dx, dz, ax, az, bx, bz)], e = [pt(ax, az, cx, cz, dx, dz), pt(bx, bz, cx, cz, dx, dz)];
  let best = { d: c[0][0], t: 0 };
  if (c[1][0] < best.d) best = { d: c[1][0], t: 1 };
  if (e[0][0] < best.d) best = { d: e[0][0], t: e[0][1] };
  if (e[1][0] < best.d) best = { d: e[1][0], t: e[1][1] };
  return best;
}

/**
 * Does the thin wall from (ax, az) to (bx, bz), solid from `bottom` to `top` (wall-collider.js), come within `clear` of a lane at its level?  `levelReach`: the wall
 * collider's (a lane more than this over the top or under the bottom is another level).  Returns the first such lane piece, or null.
 */
export function wallBlocksLane(lanes, ax, az, bx, bz, bottom, top, clear, levelReach) {
  for (const p of lanes.near(ax, az, bx, bz, clear)) {
    const g = segmentGap(p.ax, p.az, p.bx, p.bz, ax, az, bx, bz);
    if (g.d >= clear) continue;
    // the lane's level where it passes the wall: the closer end of the piece decides (pieces are <= 4 m)
    const ya = p.ay, yb = p.by;
    if (Math.min(ya, yb) > top + levelReach || Math.max(ya, yb) < bottom - levelReach) continue;
    if (aboveOnDeck(ya, p.at, top) && aboveOnDeck(yb, p.bt, top)) continue;                 // a deck over the wall (the game's collider: createWallCollider with terrainAt)
    return p;
  }
  return null;
}
