/* Lux Drive harness, section V (collide14): the car cannot drive into a house or off a bridge (QA round 4).
 *   V1  every building, every façade (a quarter, the middle and three quarters of every wall of 3 m or more): the car's body circle at the ground 0.6 m outside it is
 *       stopped by the building (QA4 N4-C01: nine huge footprints were not in the index - the car drove into Kirchberg 1372, the tower block 4808, the Gare's platform
 *       roof 15153; N4-C02: 33 houses on carved slopes let a car in the road pit at the middle of a façade drive under their bottom)
 *   V2  a building under a deck does not stop a car on the deck over it (the footprint points under a deck whose surface is over the building's top)
 *   V3  every car deck, ten stations along it, the car steered at each edge (straight at it and at 45 degrees, 9 m/s, 2.5 s) with the game's own collider: it stays on
 *       the deck - beside the deck its wheels never come more than V_FALL under it (QA4 N4-B01: the car left the south side of the Pont Rouge at 5 of 5 stations).
 *       (A car that slides along a parapet off the END of a short deck is on its approach or bank: not judged here.)
 *   V4  no parapet touches a lane: every lane of every car road at its level (lane-clearance.js) is clear of the barriers (deck-barriers.js)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { CAR } from './config.js';
import { DECK } from './decks.js';
import { CAR_KINDS } from './harness-decks.js';
import { laneClearanceScan, groupHits } from './lane-clearance.js';
import { buildGameCollider } from './harness-drive12.js';

const V_PROBE_OUT = 0.6;       // m outside a façade: the centre of the probe circle (the car's body circle CAR.bodyRadius)
const V_MIN_EDGE = 3;          // m: the walls probed (QA4's rule)
const V_STATIONS = 10;
const V_SPEED = 9;             // m/s (QA4 edgetest)
const V_TIME = 2.5;            // s
const V_DT = 1 / 60;
const V_FALL = 1.0;            // m of flight down = the car fell off the deck
const V_MIN_WIDTH = 4;         // m: the decks of cars (harness-decks.js Q_MIN_WIDTH)
const V_ANGLES = [Math.PI / 2, Math.PI / 4];    // between the heading and the deck's axis
// the buildings the data has wholly under a deck (deck surface over the ridge): Pfaffenthal 6350 and 7233 under the Pont Rouge, 60 m below it (the other five a deck
// passes over reach up through it: they stop a car on the deck, rightly).  A floor that keeps V2 from passing on nothing.
const V2_MIN_UNDER = 2;

const pip = (p, x, z) => {
  let c = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** V1: the façade probes that are NOT stopped: [{ id, x, z, y }].  buildings: buildings.js index, groundAt: the ground the car stands on (the carve), hidden: landmark ids. */
export function facadeProbe({ data, buildings, groundAt, hidden }) {
  const free = [];
  let probes = 0;
  for (let id = 0; id < data.buildings.length; id++) {
    if (hidden.has(id)) continue;
    const p = data.buildings[id].pts, n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < V_MIN_EDGE) continue;
      for (const f of [0.25, 0.5, 0.75]) {
        const mx = ax + (bx - ax) * f, mz = az + (bz - az) * f;
        let nx = -(bz - az) / l, nz = (bx - ax) / l;                       // outward: the side that is not inside the footprint
        if (pip(p, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; if (pip(p, mx + nx * 0.3, mz + nz * 0.3)) continue; }
        const x = mx + nx * V_PROBE_OUT, z = mz + nz * V_PROBE_OUT, y = groundAt(x, z);
        probes++;
        if (!buildings.collide(x, z, CAR.bodyRadius, y)) free.push({ id, x: +x.toFixed(1), z: +z.toFixed(1), y: +y.toFixed(1) });
      }
    }
  }
  return { probes, free };
}

/** The deck top of deck d at the point of its axis nearest (x, z), the lateral distance from the axis, and whether the point lies past an end of the deck (there the car
 *  has driven off the end onto its approach or the bank: the road network's gates judge that ground, not this one). */
function onAxis(d, x, z) {
  let best = Infinity, top = d.tops[0], past = false;
  const last = d.pts.length - 2;
  for (let i = 0; i + 1 < d.pts.length; i++) {
    const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez || 1;
    const raw = ((x - ax) * ex + (z - az) * ez) / ll, t = Math.max(0, Math.min(1, raw));
    const dd = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (dd < best) { best = dd; top = d.tops[i] + (d.tops[i + 1] - d.tops[i]) * t; past = (i === 0 && raw < 0) || (i === last && raw > 1); }
  }
  return { top, side: best, past };
}

/** The way a deck carries (the road whose line covers most of its points within 1.5 m): its kind, or null.  (harness-decks.js wayOf, with a grid of the roads.) */
function deckKinds(decks, roads) {
  const G = 64, grid = new Map(), k = (a, b) => a * 4096 + b;
  roads.forEach((r) => { for (const q of r.pts) { const kk = k(Math.floor(q[0] / G), Math.floor(q[1] / G)); const l = grid.get(kk); if (!l) grid.set(kk, new Set([r])); else l.add(r); } });
  const segDist = (p, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll)); return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t); };
  const out = new Map();
  for (const d of decks) {
    const cand = new Set();
    for (const p of d.pts) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const r of grid.get(k(Math.floor(p[0] / G) + a, Math.floor(p[1] / G) + b)) || []) cand.add(r);
    let best = null, most = 0;
    for (const r of cand) {
      let c = 0;
      for (const p of d.pts) { let m = Infinity; for (let i = 0; i + 1 < r.pts.length; i++) m = Math.min(m, segDist(p, r.pts[i], r.pts[i + 1])); if (m <= 1.5) c++; }
      if (c > most) { most = c; best = r; }
    }
    if (best && most >= d.pts.length * 0.6) out.set(d.id, best.kind);
  }
  return out;
}

/** V3: the car steered at both edges of every car deck.  Returns { decks, runs, fell: [{ deck, station, side, angle, at, drop }] }. */
export function deckEdgeScan({ ground, surface, roads, collide, only = null }) {
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o), collide });
  const st = car.state;
  const kinds = deckKinds(ground.decks, roads);
  const fell = [];
  let decks = 0, runs = 0;
  for (const d of ground.decks) {
    if (d.width < V_MIN_WIDTH || d.pts.length < 2 || !CAR_KINDS.has(kinds.get(d.id)) || (only && !only.has(d.id))) continue;
    decks++;
    const cum = [0];
    for (let i = 1; i < d.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]));
    const total = cum[cum.length - 1];
    for (let s = 0; s < V_STATIONS; s++) {
      const at = ((s + 0.5) / V_STATIONS) * total;
      let i = 0;
      while (i + 2 < d.pts.length && cum[i + 1] < at) i++;
      const f = (at - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1];
      const x0 = ax + (bx - ax) * f, z0 = az + (bz - az) * f, top0 = d.tops[i] + (d.tops[i + 1] - d.tops[i]) * f;
      const axis = Math.atan2(bz - az, bx - ax);
      for (const sd of [1, -1]) for (const ang of V_ANGLES) {
        const yaw = axis + sd * ang;                       // sd 1: toward the left edge (the normal (-dz, dx) is +90 degrees from the axis)
        ground.hint(top0 + DECK.hintLift);
        car.reset(x0, z0, yaw);
        ground.hint(st.y);
        if (Math.abs(st.y - CAR.rideHeight - top0) > 0.3) continue;      // the car is not put on this deck here (a deck over it at a joint): no run
        st.vx = Math.cos(yaw) * V_SPEED; st.vz = Math.sin(yaw) * V_SPEED; st.speed = V_SPEED;
        runs++;
        // a fall: a flight that comes down more than V_FALL (from the last grounded level), beside the deck (not past its ends: the car slid off the end of a short
        // deck onto its approach or bank - the road network's gates judge that ground); a car that rolls from the deck onto ground at its level beside it (a merging
        // deck, the bank at an abutment) and on down a slope is grounded, not falling
        let worst = 0, where = null, from = st.y;
        for (let t = 0; t < V_TIME; t += V_DT) {
          ground.hint(st.y);
          car.update(V_DT, { throttle: Math.max(0, Math.min(1, (V_SPEED - st.speed) * 0.5)), brake: 0, steer: 0, handbrake: false });
          if (st.grounded) { from = st.y; continue; }
          const a = onAxis(d, st.x, st.z), drop = from - st.y;
          if (!a.past && a.side <= d.width / 2 + 4 && drop > worst) { worst = drop; where = [st.x, st.z]; }
        }
        if (worst > V_FALL) fell.push({ deck: d.id, station: s, side: sd, angle: Math.round((ang * 180) / Math.PI), at: where.map((v) => +v.toFixed(1)), drop: +worst.toFixed(2) });
      }
    }
  }
  return { decks, runs, fell };
}

export function runCollide14Checks({ check, section, stats, data, field, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork }) {
  section('V the car cannot drive into a house or off a bridge (collide14, QA round 4)');
  const { game: carCollider } = buildGameCollider({ data, surface, ground, net, buildings, landmarks, portals, forest, playArea, maps, deckNetwork });

  // ---- V1
  const v1 = facadeProbe({ data, buildings, groundAt: (x, z) => field.height(x, z), hidden: landmarks.hiddenBuildings });
  const v1ids = [...new Set(v1.free.map((f) => f.id))];
  stats.facades = { probes: v1.probes, free: v1.free.length, buildings: v1ids.length, list: v1.free.slice(0, 8).map((f) => `${f.id} at ${f.x},${f.z}`) };
  check(`V1 every façade of every building stops a car on the ground beside it (${v1.probes} probes, 0.6 m outside, at the ground there)`, v1.free.length === 0, `${v1.free.length} free in ${v1ids.length} buildings: ${stats.facades.list.join('; ')}`);

  // ---- V2
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  let under = 0;
  const v2bad = [];
  for (let id = 0; id < data.buildings.length; id++) {
    if (landmarks.hiddenBuildings.has(id)) continue;
    const p = data.buildings[id].pts, n = p.length / 2;
    const [, topB] = buildings.levelOf(id);
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 2] / n; cz += p[i * 2 + 1] / n; }
    for (const [x, z] of [[cx, cz], ...Array.from({ length: n }, (_, i) => [(p[i * 2] + cx) / 2, (p[i * 2 + 1] + cz) / 2])]) {
      const d = deckNetwork.deckAt(x, z, 1e9, scratch);
      if (!d || scratch.top <= topB) continue;                              // (a house that reaches up through the deck stops a car on it: that is right)
      under++;
      if (buildings.collide(x, z, CAR.bodyRadius, scratch.top)) v2bad.push(`${id} under the deck at ${x.toFixed(0)},${z.toFixed(0)}`);
      break;
    }
  }
  stats.underDeck = { buildings: under, blocked: v2bad.length, list: v2bad.slice(0, 8) };
  check(`V2 a building under a deck does not stop a car on the deck over it (${under} buildings under decks)`, under >= V2_MIN_UNDER && v2bad.length === 0, v2bad.slice(0, 8).join('; '));

  // ---- V3
  const v3 = deckEdgeScan({ ground, surface, roads: data.roads, collide: carCollider.collide });
  stats.deckEdges = { decks: v3.decks, runs: v3.runs, fell: v3.fell.length, list: v3.fell.slice(0, 12).map((f) => `deck ${f.deck} st ${f.station} ${f.side > 0 ? 'L' : 'R'}${f.angle} ${f.drop} m at ${f.at.join(',')}`) };
  check(`V3 the car steered at both edges of every car deck at ${V_STATIONS} stations (${v3.runs} runs over ${v3.decks} decks) stays on the deck`, v3.decks > 100 && v3.fell.length === 0, `${v3.fell.length} runs fell: ${stats.deckEdges.list.join('; ')}`);

  // ---- V4
  const isOpen = (r) => !!(field.network.roads[r.id] && field.network.roads[r.id].openCut);
  // (each lane at the level carried along it - lane-clearance.js follow: the lower turn of a spiral ramp is not on the deck over it)
  const v4 = laneClearanceScan({ roads: data.roads, parts: carCollider.parts.filter(([nm]) => nm === 'parapet'), ground, surface, isOpen, follow: true });
  const g4 = groupHits(v4.hits);
  stats.laneParapets = { samples: v4.samples, pairs: g4.length, list: g4.slice(0, 8).map((e) => `deck ${e.id} on ${e.name} (way ${e.road}) ${e.n} x at ${e.first}`) };
  check(`V4 no parapet of a deck touches a lane (${v4.samples} lane samples, every lane of every car road at its level; ${carCollider.barriers ? carCollider.barriers.count : 0} barrier pieces)`, g4.length === 0, stats.laneParapets.list.join('; '));
}
