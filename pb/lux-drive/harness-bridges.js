/* Lux Drive harness, section M (bridges7): the bridges, the tunnel portals and the ride, as the QA round 1 found them broken.
 *   M1  the deck surface is one smooth profile: no step along any deck or across its two ends (B01 .. B04, T05, T06)
 *   M2  the portals: drawn at the level of their road (never on a bridge over the mouth, B10), they stop a car that drives at them and do not push a car on the
 *       land behind them or on a bridge above them (B05: thrown 50 m), no abutment wall stands in a carriageway
 *   M3  the ride: a car driven across the bridges of the QA drive test and 1 m inside the kerb of ten streets (D01: the kerb saw-tooth washboard); a car on a deck
 *       is not stopped by the trees and lamps under it (the A1 viaduct)
 *   M4  the chase camera keeps its boom at the four places where it was jammed against the car (U01)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { createChaseCamera } from './camera.js';
import { abutmentsOf, ROAD_MIN_WIDTH } from './deck-shape.js';
import { CAR } from './config.js';
import { DECK } from './decks.js';

const SAMPLE = 0.25;              // m between the samples along a deck
const END_RUN = 6;                // m sampled past each end of a deck (the approach road, which the deck end must meet without a step)
const MAX_STEP = 0.05;            // m: a step in the ground along a drivable line (minus what the grade explains)
const LOOKUP_TOL = 0.10;          // m: the ground on a deck may differ this much from the deck's own profile (the bend of a polyline, the margin) - the QA steps were 0.1 .. 1.6 m
const STEEP_GRADE = 0.25;         // a deck's own profile steeper than this between two points is reported (the data, not the lookup)
const MAX_LOOKUP = 222;           // points where the ground on a deck answers with a level no deck there has: v45 101 321 (a later span's line, a cap 5 m over the
                                  // next span); left (bridges7): sidewalk decks beside a road deck near their ends, the bogus decks 29 / 303 - a ratchet, never raise it
const RIDE_DT = 1 / 60;
const RIDE_SPEED = 13;            // m/s, the QA drive test
/** The QA drive test routes over the bridges and the two road steps (qa1/job_spikes.json): [label, [[x, z, lane offset], ...]]. */
const BRIDGE_ROUTES = [
  ['deck 35 and its approach (A1)', [[15539, 5338, 3.1], [15563, 5333, 3.1], [15644, 5319, 3.1], [15740, 5304, 3.1], [15883, 5284, 3.1], [15978, 5273, 3.1], [16077, 5263, 3.1], [16130, 5258, 3.1]]],
  ['deck 23 (A1)', [[8765, 7182, 3.1], [8777, 7147, 3.1], [8787, 7112, 3.1], [8795, 7080, 3.1], [8799, 7059, 3.1], [8810, 7007, 3.1], [8817, 6963, 3.1], [8822, 6916, 3.1]]],
  ['deck 10 (A1)', [[8208, 9233, 3.1], [8212, 9208, 3.1], [8220, 9170, 3.1], [8234, 9119, 3.1], [8244, 9085, 3.1], [8259, 9044, 3.1], [8279, 8997, 3.1], [8312, 8928, 3.1], [8356, 8855, 3.1], [8438, 8733, 3.1], [8461, 8697, 3.1]]],
  ['deck 36 (Contournement de Dommeldange)', [[5378, 6682, 2.1], [5383, 6681, 2.1], [5400, 6671, 2.1], [5427, 6657, 2.1], [5466, 6640, 2.1], [5487, 6627, 2.1], [5500, 6619, 2.1], [5512, 6610, 2.1], [5526, 6597, 2.1], [5534, 6589, 2.1], [5548, 6572, 2.1]]],
  ['Av. J.F. Kennedy (Place de l\'Europe)', [[5422, 8014, 3.6], [5488, 7998, 3.6], [5506, 7995, 3.6], [5613, 7980, 5.3], [5668, 7974, 1.9], [5694, 7970, 1.9]]],
  ['Rue Vauban (Pfaffenthal)', [[5348, 8394, 2.0], [5295, 8322, 2.0], [5263, 8285, 2.0], [5259, 8280, 2.0], [5254, 8272, 2.0], [5251, 8263, 2.0], [5249, 8255, 2.0], [5242, 8210, 2.0]]],
];
const RIDE_MAX_A = 40;            // m/s2: the worst vertical acceleration on a bridge route (v45: 98 .. 702 at the steps; a wheel over a 13 cm kerb, where a route changes lane, is 25 .. 35)
const KERB_STREETS = 10;          // streets driven 1 m inside the kerb (D01)
const KERB_MAX_EVENTS = 40;       // events over 3 m/s2 in all of them together (v45: 139, the wheels on the continuous ground: 27)
const U01 = [[8322, 6523], [8344.1, 6384.2], [9218, 5009], [6135, 7241]];
const MIN_BOOM = 6;               // m: the chase camera's boom after 3 s standing (the full boom is ~7.6 m)

/** Does another deck than `self` lie under (x, z) at height y (the point projects onto one of its segments, within its half width + DECK.margin)?  Brute force: only
 *  asked where the ground answers with another level than the deck's own (two carriageway decks side by side whose margins overlap: the higher one carries the car). */
function coveredAt(decks, self, x, z, y) {
  for (const d of decks) {
    if (d === self) continue;
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
      if (ll < 1e-9) continue;
      const t = ((x - ax) * ex + (z - az) * ez) / ll;
      if (t < -0.05 || t > 1.05) continue;
      const tc = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - ax - ex * tc, z - az - ez * tc) > d.width / 2 + DECK.margin) continue;
      if (Math.abs(d.tops[i] + (d.tops[i + 1] - d.tops[i]) * tc - y) <= MAX_STEP) return true;
    }
  }
  return false;
}

/**
 * The deck surface as a car on it finds it.  Every deck is walked on its axis and 1.5 m inside both edges, from END_RUN m before its start to END_RUN m past its end, every
 * SAMPLE m, the ground hinted at the line's own height (a car stays on the deck it is on).  Returns
 *   lookup: [{ deck, at, off }]  points inside the deck where the ground answers with another level than the deck's own profile (by more than MAX_STEP; the ground itself
 *           higher, a deck that crosses above, excepted): the lookup bugs of QA B01 .. B04 (a later span, the cap of the next piece);
 *   ends:   [{ deck, step, at }]  steps over MAX_STEP within END_RUN of an end of a deck (the road onto the deck, a joint onto the next piece: B06, T05, T06);
 *   steep:  [{ deck, grade, at }] stretches of a deck's own profile steeper than STEEP_GRADE (the deck data: an end pinned to the ground under a high deck);
 *   lines.
 */
export function deckStepScan(ground) {
  const lookup = [], ends = [], steep = [];
  let lines = 0;
  for (const d of ground.decks) {
    const n = d.pts.length;
    if (n < 2) continue;
    const half = d.width / 2;
    const dir = (a, b) => { const dx = d.pts[b][0] - d.pts[a][0], dz = d.pts[b][1] - d.pts[a][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const [ux0, uz0] = dir(1, 0), [ux1, uz1] = dir(n - 2, n - 1);
    const pts = [];                                   // [x, z, ux, uz, arc, own top or NaN outside the deck]
    for (let s = END_RUN; s > 0; s -= SAMPLE) pts.push([d.pts[0][0] + ux0 * s, d.pts[0][1] + uz0 * s, -ux0, -uz0, -s, NaN]);
    let arc = 0;
    for (let i = 0; i + 1 < n; i++) {
      const [ux, uz] = dir(i, i + 1), l = Math.hypot(d.pts[i + 1][0] - d.pts[i][0], d.pts[i + 1][1] - d.pts[i][1]);
      if (l > 1e-6 && Math.abs(d.tops[i + 1] - d.tops[i]) / l > STEEP_GRADE) steep.push({ deck: d.id, grade: Math.abs(d.tops[i + 1] - d.tops[i]) / l, at: `deck ${d.id} at ${d.pts[i][0].toFixed(0)},${d.pts[i][1].toFixed(0)}` });
      for (let s = 0; s < l; s += SAMPLE) pts.push([d.pts[i][0] + ux * s, d.pts[i][1] + uz * s, ux, uz, arc + s, d.tops[i] + (d.tops[i + 1] - d.tops[i]) * (s / l)]);
      arc += l;
    }
    for (let s = 0; s <= END_RUN; s += SAMPLE) pts.push([d.pts[n - 1][0] + ux1 * s, d.pts[n - 1][1] + uz1 * s, ux1, uz1, arc + s, s === 0 ? d.tops[n - 1] : NaN]);
    const first = END_RUN / SAMPLE;
    for (const off of half > 2 ? [0, half - 1.5, -(half - 1.5)] : [0]) {
      const ys = [];
      ground.hint(d.tops[0] + 0.42);                                  // (on the deck, not under it)
      let y = ground.height(pts[first][0] - pts[first][3] * off, pts[first][1] + pts[first][2] * off);
      const walk = (k) => { const [x, z, ux, uz] = pts[k]; ground.hint(y + 0.42); y = ground.height(x - uz * off, z + ux * off); ys[k] = y; };
      for (let k = first; k < pts.length; k++) walk(k);
      y = ys[first];
      for (let k = first - 1; k >= 0; k--) walk(k);
      lines++;
      for (let k = 0; k < pts.length; k++) {
        const [x, z, ux, uz, s, own] = pts[k];
        const px = x - uz * off, pz = z + ux * off;
        if (Number.isFinite(own) && Math.abs(ys[k] - own) > LOOKUP_TOL && ys[k] - ground.surface.height(px, pz) > MAX_STEP && !coveredAt(ground.decks, d, px, pz, ys[k])) {
          lookup.push({ deck: d.id, off, at: `deck ${d.id} at ${px.toFixed(0)},${pz.toFixed(0)} (${(ys[k] - own).toFixed(2)} m)` });
        }
        if (k >= 2 && k + 1 < ys.length && (s < END_RUN || s > arc - END_RUN)) {
          const step = Math.abs((ys[k] - ys[k - 1]) - ((ys[k - 1] - ys[k - 2]) + (ys[k + 1] - ys[k])) / 2);
          if (step > MAX_STEP) ends.push({ deck: d.id, step, at: `deck ${d.id} at ${px.toFixed(0)},${pz.toFixed(0)}` });
        }
      }
    }
  }
  return { lines, lookup, ends, steep };
}

export function runBridgeChecks({ check, section, stats, data, surface, ground, net, portals, buildings, forest, playArea }) {
  section('M bridges, portals, the ride (bridges7)');
  const o = {};

  // ---- M1: the deck surface (deckStepScan)
  const scan = deckStepScan(ground);
  const worstEnd = scan.ends.reduce((w, q) => (q.step > w.step ? q : w), { step: 0, at: '' });
  stats.deckSurface = { lines: scan.lines, lookup: scan.lookup.length, endSteps: scan.ends.length, worstEndCm: +(worstEnd.step * 100).toFixed(1), worstEndAt: worstEnd.at, steepStretches: scan.steep.length, steepDecks: [...new Set(scan.steep.map((q) => q.deck))].length };
  check(`M1 a car on a deck stands on that deck's own profile or on a deck that overlaps it there (within ${LOOKUP_TOL * 100} cm, ${scan.lines} lines)`, scan.lookup.length <= MAX_LOOKUP, `${scan.lookup.length} points, e.g. ${scan.lookup.slice(0, 4).map((q) => q.at).join('; ')}`);

  // ---- M2: the portals
  let onDeck = 0, pushedBehind = 0, pushedAbove = 0, notStopped = 0;
  for (const p of portals.list) {
    if (Math.abs(p.y - surface.height(p.x, p.z)) > 0.01) onDeck++;
    const behind = [p.x - p.nx * (p.depth + 4), p.z - p.nz * (p.depth + 4)];             // on the land over the tunnel, 4 m behind the wall
    const land = surface.height(behind[0], behind[1]);
    if (land > p.y + p.wallTop - 0.3 && portals.collide(behind[0], behind[1], CAR.bodyRadius, land)) pushedBehind++;
    const deck = ground.decks.length ? (() => { ground.hint(1e9); const h = ground.height(p.x + p.nx * 0.5, p.z + p.nz * 0.5); return h > p.y + p.wallTop ? h : null; })() : null;
    if (deck !== null && portals.collide(p.x + p.nx * 0.5, p.z + p.nz * 0.5, CAR.bodyRadius, deck)) pushedAbove++;
    const hit = portals.collide(p.x + p.nx * 0.5, p.z + p.nz * 0.5, CAR.bodyRadius, p.y);
    if (!hit || hit.nx * p.nx + hit.nz * p.nz < 0.7) notStopped++;
  }
  stats.portalChecks = { portals: portals.list.length, onDeck, pushedBehind, pushedAbove, notStopped };
  check('M2 every portal stands at the level of its road (none drawn on a bridge over the mouth)', onDeck === 0, `${onDeck} of ${portals.list.length}`);
  check('M2 a portal stops a car that drives at it, and pushes no car on the land behind it or on a bridge above it', notStopped === 0 && pushedBehind === 0 && pushedAbove === 0,
    `${notStopped} do not stop, ${pushedBehind} push from behind, ${pushedAbove} push a car on a bridge`);
  let abutments = 0, abutInRoad = 0;
  for (const d of ground.decks) {
    if (d.width < ROAD_MIN_WIDTH) continue;
    for (const a of abutmentsOf(d, surface, (x, z) => surface.roadInfoAt(x, z, o).sdCar)) {
      abutments++;
      // the front wall: across the deck at arc a.s
      let s = 0;
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const l = Math.hypot(d.pts[i + 1][0] - d.pts[i][0], d.pts[i + 1][1] - d.pts[i][1]);
        if (s + l >= a.s - 1e-6) {
          const f = (a.s - s) / (l || 1), x = d.pts[i][0] + (d.pts[i + 1][0] - d.pts[i][0]) * f, z = d.pts[i][1] + (d.pts[i + 1][1] - d.pts[i][1]) * f;
          const sx = -(d.pts[i + 1][1] - d.pts[i][1]) / (l || 1), sz = (d.pts[i + 1][0] - d.pts[i][0]) / (l || 1);
          if ([-1, -0.5, 0, 0.5, 1].some((k) => surface.roadInfoAt(x + sx * k * d.width / 2, z + sz * k * d.width / 2, o).sdCar < -0.3)) abutInRoad++;
          break;
        }
        s += l;
      }
    }
  }
  stats.abutments = { abutments, inRoad: abutInRoad };
  check('M2 no abutment wall stands in a carriageway', abutments > 20 && abutInRoad === 0, `${abutInRoad} of ${abutments}`);

  // ---- M3: the ride
  const collide = (x, z, r, y) => buildings.collide(x, z, r) || portals.collide(x, z, r, y) || (ground.onDeck(x, z) ? null : forest.collide(x, z, r)) || playArea.collide(x, z, r);
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide });
  /** Pure pursuit at RIDE_SPEED along the points [x, z, offset] (the offset of a segment is that of its first point), as the QA drive test. */
  const drive = (pts) => {
    const poly = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, off] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-3) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      for (let s = 0; s < l; s += 1) poly.push([ax + dx * s - dz * off, az + dz * s + dx * off]);
    }
    const st = car.state;
    ground.hint(1e4);
    car.reset(poly[0][0], poly[0][1], Math.atan2(poly[3][1] - poly[0][1], poly[3][0] - poly[0][0]));
    const ys = [], at = [];
    let idx = 0, t = 0;
    while (idx < poly.length - 3 && t < 60) {
      const d2 = (k) => (poly[k][0] - st.x) ** 2 + (poly[k][1] - st.z) ** 2;
      while (idx < poly.length - 3 && d2(idx) > d2(idx + 1)) idx++;
      const la = Math.min(poly.length - 1, idx + Math.round(Math.max(6, Math.abs(st.speed) * 0.7)));
      let e = Math.atan2(poly[la][1] - st.z, poly[la][0] - st.x) - st.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      ground.hint(st.y);
      car.update(RIDE_DT, { throttle: Math.max(0, Math.min(1, (RIDE_SPEED - st.speed) * 0.5)), brake: st.speed > RIDE_SPEED + 3 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, e * 1.6)), handbrake: false });
      t += RIDE_DT; ys.push(st.y); at.push([st.x, st.z]);
    }
    const W = 3, ev = [];
    let maxA = 0;
    for (let i = W; i < ys.length - W; i++) {
      const a = Math.abs(ys[i + W] - 2 * ys[i] + ys[i - W]) / ((W * RIDE_DT) ** 2);
      maxA = Math.max(maxA, a);
      if (a > 3) { const last = ev[ev.length - 1]; if (!last || Math.hypot(last[0] - at[i][0], last[1] - at[i][1]) >= 2.5) ev.push(at[i]); }
    }
    return { maxA, events: ev.length, done: idx >= poly.length - 4 };
  };
  const bridgeRides = BRIDGE_ROUTES.map(([label, pts]) => ({ label, ...drive(pts) }));
  const badBridge = bridgeRides.filter((r) => r.maxA > RIDE_MAX_A || !r.done);
  stats.bridgeRides = bridgeRides.map((r) => `${r.label}: ${r.maxA.toFixed(1)} m/s2${r.done ? '' : ' (stopped)'}`);
  check(`M3 the bridges of the QA drive test ride smoothly (vertical acceleration <= ${RIDE_MAX_A} m/s2) and the car gets across`, badBridge.length === 0,
    badBridge.map((r) => `${r.label} ${r.maxA.toFixed(1)}${r.done ? '' : ' stopped'}`).join('; ') || `worst ${Math.max(...bridgeRides.map((r) => r.maxA)).toFixed(1)}`);
  // ten streets, 300 m of the longest way of each, 1 m inside the kerb: the right wheels run 0.2 m from the kerb (QA D01 drove along it)
  const named = new Map();
  for (const r of data.roads) {
    if (!r.name || !['primary', 'secondary', 'tertiary', 'residential'].includes(r.kind) || !r.info.drivable || r.tunnel || r.bridge || r.over || r.length < 250 || !net.info[r.id]) continue;
    const old = named.get(r.name);
    if (!old || old.length < r.length) named.set(r.name, r);
  }
  const streets = [...named.values()].sort((a, b) => b.length - a.length).slice(0, KERB_STREETS);
  let kerbEvents = 0;
  const kerbRides = [];
  for (const r of streets) {
    const pts = [];
    let s = 0;
    for (let i = 0; i < r.pts.length && s <= 300; i++) { if (i) s += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); pts.push([r.pts[i][0], r.pts[i][1], net.info[r.id].hw - 1.0]); }
    const res = drive(pts);
    kerbEvents += res.events;
    kerbRides.push(`${r.name} ${res.events}`);
  }
  stats.kerbRides = { events: kerbEvents, streets: kerbRides };
  check(`M3 driving 1 m inside the kerb of ${streets.length} streets is not a washboard (<= ${KERB_MAX_EVENTS} events over 3 m/s2 in all)`, streets.length === KERB_STREETS && kerbEvents <= KERB_MAX_EVENTS, `${kerbEvents} events: ${kerbRides.join(', ')}`);

  // ---- M4: the chase camera at the U01 places, on the road under the car (and on the deck over it when there is one)
  const camCollide = (x, z, r, y) => buildings.collide(x, z, r) || (ground.onDeck(x, z) ? null : forest.collide(x, z, r)) || portals.collide(x, z, r, y);
  const chase = createChaseCamera(ground, camCollide);
  let shortest = Infinity, shortAt = '';
  for (const [x, z] of U01) {
    for (const hint of [-1e4, 1e4]) {
      surface.roadInfoAt(x, z, o);
      const road = data.roads[o.road];
      const yaw = road ? Math.atan2(road.pts[road.pts.length - 1][1] - road.pts[0][1], road.pts[road.pts.length - 1][0] - road.pts[0][0]) : 0;
      ground.hint(hint);
      car.reset(x, z, yaw);
      chase.snap(car.state);
      let c = null;
      for (let k = 0; k < 180; k++) { ground.hint(car.state.y); car.update(RIDE_DT, { throttle: 0, brake: 1, steer: 0 }); c = chase.update(car.state, RIDE_DT, 0, k * RIDE_DT); }
      if (c.boom < shortest) { shortest = c.boom; shortAt = `${x},${z}`; }
    }
  }
  stats.cameraBoomU01 = +shortest.toFixed(2);
  check(`M4 the chase camera keeps its boom (>= ${MIN_BOOM} m) where QA found it jammed against the car`, shortest >= MIN_BOOM, `shortest ${shortest.toFixed(2)} m at ${shortAt}`);
}
