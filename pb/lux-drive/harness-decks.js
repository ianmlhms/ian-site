/* Lux Drive harness, section Q (decks10): every carriageway deck driven end to end, the banks under deck ends, the medians, the camera (QA round 2).
 *   Q1  every car deck (the deck of a motorway .. track) is driven end to end in both directions, on its axis and in its outer lanes, with 30 m of the ways that lead onto it:
 *       no height step over Q_MAX_STEP and no airborne frame within Q_ZONE of the deck (QA2: decks 23, 87, 218, 28, 145 - steps of 0.25 .. 3 m)
 *   Q2  a car that drives along the valley UNDER a viaduct is stopped by the bank under its end, it is not popped onto the deck (QA B02 deck 23, N-B01 deck 87, deck 10)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { CAR } from './config.js';
import { laneOffsets } from './lane-clearance.js';
import { wayOf, wayEnds, laneRoute, polyDist } from './deck-lanes.js';
import { groundStart, groundEnd } from './tunnel-tubes.js';

const Q_MAX_STEP = 0.05;          // m: a step in the height of the car from one frame to the next, minus what the grade explains (the QA's steps were 0.25 .. 3 m)
const Q_ZONE = 5;                 // m: the drive is judged on the deck and this far past its ends and sides (beyond that the road network's own gates judge the road)
const Q_SPEED = 13;               // m/s (the QA drive test)
const Q_DT = 1 / 60;
const Q_LANE_INSET = 2.2;         // m: the outer lanes of a deck at least Q_LANE_DECK wide run this far inside its edges
const Q_LANE_DECK = 9;
const Q_MIN_WIDTH = 4;            // m: the decks of cars (a narrower one is a footbridge)
const Q_PUSH = 0.02;              // m: the body circles are probed this much smaller (a graze of a guard rail at the deck edge is no stop: drive12, every lane with every collider)
const Q_MAX_FAILING = 10;         // decks with a step or a flight (v48: 24 of 132, decks10: 13, surface11: 10 of 134).  A ratchet: lower it when a deck is fixed, never raise it.  The ones left are listed in PROGRESS (Surface 11)
export const CAR_KINDS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'track', 'road']);
/** The QA drive routes that started UNDER a viaduct (the car at the valley floor): [label, [[x, z, lane offset], ...]] (qa1 v122 / v128, qa2 n126). */
const UNDER_ROUTES = [
  ['under deck 23 (A1)', [[8764.9, 7181.9, 3.08], [8776.7, 7146.9, 3.08], [8786.9, 7111.8, 3.08], [8794.8, 7080.2, 3.08], [8799.3, 7058.8, 3.08], [8810.1, 7007.2, 3.08], [8816.9, 6963.3, 3.08], [8822.5, 6916.4, 3.08]]],
  ['under deck 10 (A1)', [[8207.6, 9233.1, 3.08], [8212, 9207.9, 3.08], [8220.2, 9170.2, 3.08], [8233.8, 9119.2, 3.08], [8243.6, 9084.6, 3.08], [8259, 9044, 3.08], [8278.9, 8997.4, 3.08], [8312.2, 8927.9, 3.08]]],
  ['under deck 87 (Jonction Grunewald)', [[9460.4, 5510.6, 3.08], [9444.9, 5499.1, 3.08], [9422.4, 5487, 3.08], [9395.4, 5472.8, 3.08], [9371.3, 5456.4, 3.08], [9357.6, 5444.1, 3.08]]],
];
const Q2_MAX_STEP = 0.12;         // m: pressing against the bank the car may rock a little; the pops were 0.76 .. 0.92 m

/**
 * The car carried along `pts` at Q_SPEED (its x, z and heading set every frame: the test is the ground, not the steering), its vertical its own (car.js: the four wheels, the
 * suspension, the flight over a crest).  Returns { step, stepAt, air } judged within Q_ZONE of the deck line P.
 */
function carry(car, ground, pts, P, push = null, startLevel = null) {
  const poly = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-3) continue;
    for (let s = 0; s < l; s += 0.5) { const q = [ax + (bx - ax) * s / l, az + (bz - az) * s / l], last = poly[poly.length - 1]; if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.1) poly.push(q); }
  }
  if (poly.length < 8) return null;
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < poly.length; i++) { const l = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]); seg.push(l); total += l; }
  const st = car.state;
  let i = 0, acc = 0;
  const poseAt = (s) => {
    while (i < seg.length - 1 && acc + seg[i] < s) { acc += seg[i]; i++; }
    const f = Math.min(1, (s - acc) / (seg[i] || 1)), [ax, az] = poly[i], [bx, bz] = poly[i + 1];
    return [ax + (bx - ax) * f, az + (bz - az) * f, Math.atan2(bz - az, bx - ax)];
  };
  const [x0, z0, h0] = poseAt(0);
  // the car starts ON a deck where there is one (main.js landCar) - or on the floor of a tube's trough, where a route that leaves a deck into a tunnel starts on the way
  // back (not on the hill over its portal: tunnels19, Cents south, deck 21)
  ground.hint(startLevel ? startLevel(x0, z0) : 1e4);
  car.reset(x0, z0, h0);
  const ys = [], zone = [], grounded = [], at = [];
  for (let s = 0; s < total - 0.5; s += Q_SPEED * Q_DT) {
    const [x, z, h] = poseAt(s);
    st.x = x; st.z = z; st.heading = h; st.vx = Math.cos(h) * Q_SPEED; st.vz = Math.sin(h) * Q_SPEED; st.speed = Q_SPEED;
    ground.hint(st.y);
    car.update(Q_DT, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    ys.push(st.y); grounded.push(st.grounded); at.push([st.x, st.z]); zone.push(polyDist(P, [st.x, st.z]) <= Q_ZONE);
    // drive12: something solid touches the car's body at its level here (a house under the deck, a wall across the lane, a guard rail): the car would be stopped
    if (push && !push.at && zone[zone.length - 1]) {
      const lv = st.y - CAR.rideHeight;
      for (const o of CAR.bodyCircles) { const c = push.collide(x + Math.cos(h) * o, z + Math.sin(h) * o, CAR.bodyRadius - Q_PUSH, lv); if (c) { push.at = [x, z]; push.id = c.id; break; } }
    }
  }
  let step = 0, stepAt = null, air = 0;
  for (let k = 2; k + 1 < ys.length; k++) {
    if (!zone[k]) continue;
    const d = Math.abs((ys[k] - ys[k - 1]) - ((ys[k - 1] - ys[k - 2]) + (ys[k + 1] - ys[k])) / 2);
    if (d > step) { step = d; stepAt = at[k]; }
    if (!grounded[k]) air++;
  }
  return { step, stepAt, air };
}

/** Q1: every car deck, both directions, axis and outer lanes.  Returns { decks, runs, failing: [{ deck, kind, step, air, at }], pushed: [{ deck, off, at }] }.
 *  allLanes (drive12, QA3: the lane drives saw steps the axis run did not - Pont Adolphe 0.52 m, deck 204 0.45 m): the axis and the centre of every lane of the way the
 *  deck carries (lane-clearance.js laneOffsets).  carCollide: the car's collider (car-collide.js); a run in which it moves the car is listed in `pushed`. */
export function deckDriveScan({ ground, surface, roads, carCollide = null, allLanes = false, tubes = null }) {
  // (tubes: the tunnel network - a route that starts in the trough or the blend of a tube starts on its floor)
  const L = {};
  const startLevel = (x, z) => {
    if (tubes && tubes.locate(x, z, L) && L.s >= groundStart(L.tube) && L.s <= groundEnd(L.tube)) return L.floor + CAR.rideHeight + 0.3;
    return 1e4;
  };
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o), collide: null });          // (the carried car is not pushed: carCollide is a probe of its body at every pose)
  const ends = wayEnds(roads);
  const worst = new Map();
  const pushed = [];
  let decks = 0, runs = 0;
  for (const d of ground.decks) {
    if (d.width < Q_MIN_WIDTH || d.pts.length < 2) continue;
    const way = wayOf(d, roads);
    if (!way || !CAR_KINDS.has(way.kind)) continue;
    decks++;
    const half = d.width / 2;
    const offs = allLanes ? [...new Set([0, ...laneOffsets({ ...way, width: Math.min(way.width, d.width) })])] : d.width >= Q_LANE_DECK ? [0, half - Q_LANE_INSET, -(half - Q_LANE_INSET)] : [0];
    for (const off of offs) {
      const r = laneRoute(d, off, way, ends);
      if (r.none) continue;
      for (const pts of [r.pts, r.pts.slice().reverse()]) {
        const push = carCollide ? { at: null, collide: carCollide } : null;
        const res = carry(car, ground, pts, d.pts, push, startLevel);
        if (!res) continue;
        runs++;
        if (push && push.at) pushed.push({ deck: d.id, kind: way.kind, off, at: push.at, id: push.id });
        const w = worst.get(d.id);
        if (!w || res.step > w.step || res.air > w.air) worst.set(d.id, { deck: d.id, kind: way.kind, step: Math.max(res.step, w ? w.step : 0), air: Math.max(res.air, w ? w.air : 0), at: res.stepAt });
      }
    }
  }
  const failing = [...worst.values()].filter((w) => w.step > Q_MAX_STEP || w.air > 0).sort((a, b) => b.step - a.step);
  return { decks, runs, failing, pushed };
}

export function runDeckChecks({ check, section, stats, data, surface, ground, buildings, portals, playArea, tubes = null }) {
  section('Q decks driven end to end, the banks under deck ends (decks10)');

  // ---- Q1
  const scan = deckDriveScan({ ground, surface, roads: data.roads, tubes });
  stats.deckDrive = { decks: scan.decks, runs: scan.runs, failing: scan.failing.length, list: scan.failing.map((f) => `deck ${f.deck} ${f.kind} ${(f.step * 100).toFixed(0)} cm${f.air ? ` air ${f.air}` : ''} at ${f.at ? f.at.map(Math.round).join(',') : '-'}`) };
  check(`Q1 every car deck driven end to end both ways (axis and outer lanes, ${scan.runs} runs over ${scan.decks} decks): step <= ${Q_MAX_STEP * 100} cm and no flight within ${Q_ZONE} m (ratchet <= ${Q_MAX_FAILING} decks)`,
    scan.decks > 100 && scan.failing.length <= Q_MAX_FAILING, `${scan.failing.length} decks: ${stats.deckDrive.list.slice(0, 8).join('; ')}`);

  // ---- Q2: under the viaducts
  const collide = (x, z, r, y) => buildings.collide(x, z, r) || portals.collide(x, z, r, y) || ground.bankCollide(x, z, r, y) || playArea.collide(x, z, r);
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o), collide });
  const results = [];
  for (const [label, pts] of UNDER_ROUTES) {
    const poly = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, off] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += 1) poly.push([ax + dx * s - dz * off, az + dz * s + dx * off]);
    }
    const st = car.state;
    ground.hint(-1e4);                                 // the car starts on the valley floor UNDER the deck
    car.reset(poly[0][0], poly[0][1], Math.atan2(poly[3][1] - poly[0][1], poly[3][0] - poly[0][0]));
    const ys = [];
    let idx = 0, maxStep = 0, air = 0;
    for (let t = 0; t < 40 && idx < poly.length - 3; t += Q_DT) {
      const d2 = (k) => (poly[k][0] - st.x) ** 2 + (poly[k][1] - st.z) ** 2;
      while (idx < poly.length - 3 && d2(idx) >= d2(idx + 1)) idx++;
      const la = Math.min(poly.length - 1, idx + Math.round(Math.max(6, Math.abs(st.speed) * 0.7)));
      let e = Math.atan2(poly[la][1] - st.z, poly[la][0] - st.x) - st.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      ground.hint(st.y);
      car.update(Q_DT, { throttle: Math.max(0, Math.min(1, (Q_SPEED - st.speed) * 0.5)), brake: 0, steer: Math.max(-1, Math.min(1, e * 1.6)), handbrake: false });
      ys.push(st.y);
      if (!st.grounded) air++;
    }
    for (let k = 2; k + 1 < ys.length; k++) maxStep = Math.max(maxStep, Math.abs((ys[k] - ys[k - 1]) - ((ys[k - 1] - ys[k - 2]) + (ys[k + 1] - ys[k])) / 2));
    results.push({ label, maxStep, air });
  }
  stats.underDecks = results.map((r) => `${r.label}: step ${(r.maxStep * 100).toFixed(0)} cm, air ${r.air}`);
  const bad = results.filter((r) => r.maxStep > Q2_MAX_STEP || r.air > 0);
  check(`Q2 a car under a viaduct is stopped by the bank under its end (no pop onto the deck, step <= ${Q2_MAX_STEP * 100} cm, no flight)`, results.length === 3 && bad.length === 0,
    stats.underDecks.join('; '));
}
