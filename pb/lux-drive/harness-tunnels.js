/* Lux Drive harness, section O (bridges8): the shallow tunnels that are open roads (tunnel-cover.js) and the portals that are left.
 *   O1  no portal stands across a way that is drawn as an open road (QA B10: a closed concrete box across the A1 under deck 32)
 *   O2  every portal sits on its tunnel's end at the mouth, and a drawn road leaves the mouth along its axis with its carriageway in front of the wall
 *       (QA B09: portal blocks standing in the grass beside the road)
 *   O3  a car driven along every opened tunnel way (with its approaches: 13 m/s on a road, 6 m/s in a car park lane) gets through without touching anything
 *       (the retaining walls of the cuts too, as in the game: main.js collide) and without a jolt
 *   O4  the real tunnels under hills keep their mouths (René Konen, Cents, the Grouft, Albert Bousser, Rangwee, Desserte Schuman)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { PORTAL } from './config.js';
import { createWallCollider } from './wall-collider.js';

const RIDE_DT = 1 / 60;
const RIDE_SPEED = 13;            // m/s: a road (the QA drive test)
const LANE_SPEED = 6;             // m/s: a car park lane or a passage (their corners are tight: 90 deg from a lane into the underpass)
const LANE_KINDS = new Set(['service', 'pedestrian', 'track', 'living_street']);
const RIDE_MAX_A = 40;            // m/s2: the worst vertical acceleration (the bridge rides of section N have the same limit)
const APPROACH_RUN = 25;          // m of each approach road driven before and after the way
const FRONT = 2;                  // m in front of a wall: the carriageway of the road that leads to the mouth
const ON_END = 0.5;               // m: a portal stands at the end of its tunnel way
/** The way ids of the real tunnels under hills, by name: every one of them stays a tunnel (and keeps at least one portal). */
const REAL_TUNNELS = [
  ['Hellege-Geescht (René Konen)', [2461]],
  ['Cents (A1, both bores)', [158, 159]],
  ['Grouft (A7, both bores)', [5767, 5768, 4105, 11815]],
  ['Albert Bousser', [219]],
  ['Rangwee', [1055, 16860]],
  ['Desserte Schuman', [2325]],
];

/** The shortest distance between the segments a-b and c-d (2D). */
function segDist(ax, az, bx, bz, cx, cz, dx, dz) {
  const pointSeg = (px, pz, sx, sz, ex, ez) => {
    const vx = ex - sx, vz = ez - sz, ll = vx * vx + vz * vz;
    const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((px - sx) * vx + (pz - sz) * vz) / ll)) : 0;
    return Math.hypot(px - sx - vx * t, pz - sz - vz * t);
  };
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
  if (Math.abs(den) > 1e-9) {
    const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}

/** The carved centre line of way ri ([[x, z], ...]), as the network draws it. */
function lineOf(net, ri) {
  const s = net.samples, first = s.first[ri], n = s.segs[ri] + 1;
  if (first < 0 || n < 2) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push([s.x[first + i], s.z[first + i]]);
  return out;
}

/** Up to `len` m of the line pts from its end nearest (x, z), ordered away from that end. */
function runFrom(pts, x, z, len) {
  const fwd = Math.hypot(pts[0][0] - x, pts[0][1] - z) <= Math.hypot(pts[pts.length - 1][0] - x, pts[pts.length - 1][1] - z) ? pts : [...pts].reverse();
  const out = [fwd[0]];
  let s = 0;
  for (let i = 1; i < fwd.length && s < len; i++) { s += Math.hypot(fwd[i][0] - fwd[i - 1][0], fwd[i][1] - fwd[i - 1][1]); out.push(fwd[i]); }
  return out;
}

export function runTunnelChecks({ check, section, stats, data, field, surface, ground, net, portals, buildings, forest, playArea }) {
  section('O shallow tunnels are open roads, the portals sit on their roads (bridges8)');
  const opened = data.openedTunnels || [];
  const openWays = opened.flatMap((o) => o.ids).map((id) => data.roads[id]);

  // ---- O1: no portal across an open way
  let across = 0;
  const acrossList = [];
  for (const p of portals.list) {
    const own = data.roads[p.road];
    const ax = p.x - p.sx * p.half, az = p.z - p.sz * p.half, bx = p.x + p.sx * p.half, bz = p.z + p.sz * p.half;
    let bad = !own || !own.tunnel;
    for (const w of openWays) {
      if (bad) break;
      for (let i = 1; i < w.pts.length && !bad; i++) {
        if (segDist(ax, az, bx, bz, w.pts[i - 1][0], w.pts[i - 1][1], w.pts[i][0], w.pts[i][1]) < w.width / 2) bad = true;
      }
    }
    if (bad) { across++; if (acrossList.length < 6) acrossList.push(`${p.name || p.road} at ${Math.round(p.x)},${Math.round(p.z)}`); }
  }
  check('O1 no tunnel portal stands across a way that is drawn as an open road', opened.length > 0 && across === 0,
    `${across} of ${portals.list.length} portals ${acrossList.join('; ')} (${opened.length} tunnels opened)`);

  // ---- O2: every portal on its road end at the mouth, a drawn road leaving it along the axis, its carriageway in front of the wall
  const info = {};
  let offEnd = 0, noRoad = 0;
  const offList = [];
  for (const p of portals.list) {
    const own = data.roads[p.road];
    const endGap = Math.min(...[own.pts[0], own.pts[own.pts.length - 1]].map((e) => Math.hypot(e[0] - p.x, e[1] - p.z)));
    if (endGap > ON_END) { offEnd++; if (offList.length < 6) offList.push(`${p.name || p.road} ${endGap.toFixed(1)} m off its end`); continue; }
    const a = data.roads[p.approach];
    const m = a.pts.length;
    const [e, nb] = Math.hypot(a.pts[0][0] - p.x, a.pts[0][1] - p.z) <= Math.hypot(a.pts[m - 1][0] - p.x, a.pts[m - 1][1] - p.z) ? [a.pts[0], a.pts[1]] : [a.pts[m - 1], a.pts[m - 2]];
    const gap = Math.hypot(e[0] - p.x, e[1] - p.z);
    const ol = Math.hypot(nb[0] - e[0], nb[1] - e[1]) || 1;
    const along = ((nb[0] - e[0]) * p.nx + (nb[1] - e[1]) * p.nz) / ol;
    field.height(p.x + p.nx * FRONT, p.z + p.nz * FRONT, info);
    const inFront = info.coverage > 0.5 && (info.road === p.approach || info.road === p.road) && Math.abs(info.lat) <= info.hw + 0.5;
    // (roads9: a mouth whose outside lies beyond the play area - its motorway clipped at the border of the world, the Grouft south mouth - is reached by a drawn road ending at it from
    // any side; in front of its wall is the world beyond the border)
    const border = p.border && playArea && !playArea.inside(p.x + p.nx * PORTAL.borderProbe, p.z + p.nz * PORTAL.borderProbe);
    if (!net.isDrawn(a.id) || gap > PORTAL.mouthGap || (!border && (along < PORTAL.approachAlign || !inFront))) {
      noRoad++;
      if (offList.length < 6) offList.push(`${p.name || p.road} at ${Math.round(p.x)},${Math.round(p.z)}: approach ${a.id} gap ${gap.toFixed(1)} cos ${along.toFixed(2)} front ${info.road}`);
    }
  }
  stats.portalPlacement = { portals: portals.list.length, offEnd, noRoad };
  check('O2 every portal sits on the end of its tunnel at the mouth, a drawn road leaves it along the axis with its carriageway in front of the wall', offEnd + noRoad === 0,
    `${offEnd} off the end, ${noRoad} without their road ${offList.join('; ')}`);

  // ---- O3: drive every opened way with its approaches
  /** What the car touches at (x, z): a house, a retaining wall, a portal, a tree or the edge of the area (null: nothing). */
  const retaining = createWallCollider(data.walls || [], (x, z) => ground.height(x, z));
  const touch = (x, z, r, y) => {
    const house = buildings.collide(x, z, r);
    if (house) return { hit: house, what: 'house' };
    const stone = retaining.collide(x, z, r);
    if (stone) return { hit: stone, what: 'retaining wall' };
    const wall = portals.collide(x, z, r, y);
    if (wall) return { hit: wall, what: 'portal' };
    const tree = ground.onDeck(x, z) ? null : forest.collide(x, z, r);
    if (tree) return { hit: tree, what: 'tree' };
    const edge = playArea.collide(x, z, r);
    return edge ? { hit: edge, what: 'edge' } : null;
  };
  let touching = null;
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide: (x, z, r, y) => {
    const t = touch(x, z, r, y);
    if (t && t.what !== 'edge') touching = `${t.what} at ${Math.round(x)},${Math.round(z)}`;     // (the edge of the area is the end of the world, not a thing on the road)
    return t ? t.hit : null;
  } });
  const ends = new Map();                       // the drawn ways by their ends (2 m cells)
  const ek = (x, z) => `${Math.round(x / 2)},${Math.round(z / 2)}`;
  for (const r of data.roads) {
    if (!net.info[r.id]) continue;
    for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const k = `${Math.round(e[0] / 2) + a},${Math.round(e[1] / 2) + b}`;
      if (ends.has(k)) ends.get(k).push(r); else ends.set(k, [r]);
    }
  }
  const approachAt = (way, e) => (ends.get(ek(e[0], e[1])) || []).find((r) => r !== way && Math.min(...[r.pts[0], r.pts[r.pts.length - 1]].map((q) => Math.hypot(q[0] - e[0], q[1] - e[1]))) <= 1);
  const rides = [];
  for (const way of openWays) {
    const line = lineOf(net, way.id);
    if (line.length < 2) { rides.push({ way, ok: false, why: 'not carved' }); continue; }
    const before = approachAt(way, line[0]), after = approachAt(way, line[line.length - 1]);
    const pre = before ? runFrom(lineOf(net, before.id), line[0][0], line[0][1], APPROACH_RUN).reverse() : [];
    const post = after ? runFrom(lineOf(net, after.id), line[line.length - 1][0], line[line.length - 1][1], APPROACH_RUN) : [];
    const poly = [];
    for (const q of [...pre, ...line, ...post]) {
      const last = poly[poly.length - 1];
      if (!last) { poly.push(q); continue; }
      const l = Math.hypot(q[0] - last[0], q[1] - last[1]);
      for (let s = 1; s <= Math.floor(l); s++) poly.push([last[0] + ((q[0] - last[0]) * s) / l, last[1] + ((q[1] - last[1]) * s) / l]);
      if (l - Math.floor(l) > 0.2) poly.push(q);
    }
    if (poly.length < 5) { rides.push({ way, ok: false, why: 'too short' }); continue; }
    const st = car.state, speed = LANE_KINDS.has(way.kind) ? LANE_SPEED : RIDE_SPEED;
    ground.hint(1e4);
    car.reset(poly[0][0], poly[0][1], Math.atan2(poly[3][1] - poly[0][1], poly[3][0] - poly[0][0]));
    touching = null;
    let touched = null, idx = 0, t = 0, maxA = 0;
    const ys = [], at = [];
    while (idx < poly.length - 3 && t < 40) {
      const d2 = (k) => (poly[k][0] - st.x) ** 2 + (poly[k][1] - st.z) ** 2;
      while (idx < poly.length - 3 && d2(idx) > d2(idx + 1)) idx++;
      const la = Math.min(poly.length - 1, idx + Math.round(Math.max(4, Math.abs(st.speed) * 0.6)));
      let e = Math.atan2(poly[la][1] - st.z, poly[la][0] - st.x) - st.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      ground.hint(st.y);
      car.update(RIDE_DT, { throttle: Math.max(0, Math.min(1, (speed - st.speed) * 0.5)), brake: st.speed > speed + 3 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, e * 1.6)), handbrake: false });
      // (the first second is the car settling onto the road from its reset)
      if (t > 1 && touching && !touched) touched = touching;
      touching = null;
      t += RIDE_DT; ys.push(st.y); at.push(`${Math.round(st.x)},${Math.round(st.z)}`);
    }
    const W = 3, skip = Math.round(1 / RIDE_DT);
    let maxAt = '';
    for (let i = Math.max(W, skip); i < ys.length - W; i++) {
      const a = Math.abs(ys[i + W] - 2 * ys[i] + ys[i - W]) / ((W * RIDE_DT) ** 2);
      if (a > maxA) { maxA = a; maxAt = at[i]; }
    }
    const done = idx >= poly.length - 4;
    rides.push({ way, maxA, ok: done && !touched && maxA <= RIDE_MAX_A, why: `${done ? '' : 'stopped '}${touched ? `touched a ${touched} ` : ''}${maxA.toFixed(1)} m/s2 at ${maxAt}` });
  }
  const badRides = rides.filter((r) => !r.ok);
  stats.openTunnelRides = { ways: rides.length, bad: badRides.length, worst: Math.max(0, ...rides.map((r) => r.maxA || 0)) };
  check(`O3 a car drives through every opened tunnel way and its approaches without touching anything (vertical acceleration <= ${RIDE_MAX_A} m/s2)`, rides.length > 0 && badRides.length === 0,
    `${badRides.length} of ${rides.length} ways ${badRides.slice(0, 6).map((r) => `${r.way.name || r.way.kind} ${r.way.id} at ${r.way.pts[0].map(Math.round)}: ${r.why}`).join('; ')}`);

  // ---- O4: the real tunnels stay tunnels with their mouths
  const lost = REAL_TUNNELS.filter(([, ids]) => ids.some((id) => !data.roads[id] || !data.roads[id].tunnel) || !portals.list.some((p) => ids.includes(p.road)));
  stats.openedTunnels = opened.map((o) => `${o.name} ${Math.round(o.length)} m cover ${o.cover.toFixed(1)}`);
  check('O4 the real tunnels under hills keep their mouths (René Konen, Cents, Grouft, Albert Bousser, Rangwee, Desserte Schuman)', lost.length === 0, lost.map(([n]) => n).join(', '));
}
