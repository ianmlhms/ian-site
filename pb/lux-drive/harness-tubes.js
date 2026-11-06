/* Lux Drive harness, section X (tunnels16): the tunnels the car drives through (tunnel-tubes.js).
 *   X1  the tunnels Ian asked for are open (the Rond-Point Schuman underpass, both ways; the René Konen / Hellege-Geescht tunnel), every tube has a floor no steeper than
 *       TUBE.gradeMax and every road over a tube keeps its ground over the roof
 *   X2  a car driven through every tube in every lane, both ways (13 m/s, the game's own collider with the houses, walls, trees and lamps over it), gets through without
 *       touching anything and without a jolt: vertical acceleration <= X_RIDE_MAX_A from 10 m before the first face to 10 m after the last, and flush at the faces
 *   X3  the chase camera on those drives: inside a tube it stays inside (under the ceiling, between the walls); outside it never goes below the ground
 *   X4  the closed portals are gone from every tube, and nothing stands in a tube where its shell shows (a tree, a lamp, a house in the hood of a portal)
 * Called by harness.js.  Pure Node. */
import { createCar } from './car.js';
import { createChaseCamera } from './camera.js';
import { CAR, CAMERA } from './config.js';
import { TUBE, exposedStretches, indexAt } from './tunnel-tubes.js';

const RIDE_DT = 1 / 60;
const RIDE_SPEED = 13;              // m/s (the drive tests of sections O and N)
export const X_RIDE_MAX_A = 3;       // m/s2: the worst vertical acceleration in a tube and at its faces (Ian: smooth like the deck ends)
const RUN_OUT = 30;                  // m driven before the first face and after the last
const MEASURE_IN = 3;                // m inside the faces from which the acceleration is measured (the tube; the joint with the approach is measured apart, the approach
                                     // roads are the world's: the gully of the René Konen south approach rocks a car in its outer lane before the face)
const FLUSH_MAX = 0.03;              // m: the floor at a face against the approach's ground just outside it, in every lane
/** The tunnels Ian asked about: every one of them must be a tube. */
const MUST_OPEN = [
  ['the Rond-Point Robert Schuman underpass (Bd Robert Schuman, both ways)', [481, 482]],
  ['the René Konen tunnel (Hellege-Geescht)', [2461]],
];

/** The lane centres (lat to the right of the direction of travel) of the road a car arrives on at a face: every lane of that approach (its carriageway is centred on the
 *  tube's line - the tube's line is the approach's drawn line); a car keeps its lane into the tube. */
export function laneCentres(tube, approach) {
  const n = Math.max(1, approach ? approach.lanes || 1 : tube.lanes), w = Math.min(tube.width, approach ? approach.width : tube.width), out = [];
  for (let k = 0; k < n; k++) out.push(-w / 2 + ((k + 0.5) * w) / n);
  return out;
}

/**
 * Drives one tube along the lane at side offset `lat` in direction dir (+1: from face A to face B).  ctx: { ground, surface, collide, tubes }.
 * Returns { ok, maxA, maxAt, touched, done, camBad, camWhy }.
 */
export function driveTube(tube, dir, lat, ctx) {
  const { ground, surface, collide } = ctx;
  const iFrom = dir > 0 ? Math.max(0, Math.floor(tube.sA - RUN_OUT)) : Math.min(tube.s.length - 1, Math.ceil(tube.sB + RUN_OUT));
  const iTo = dir > 0 ? Math.min(tube.s.length - 1, Math.ceil(tube.sB + RUN_OUT)) : Math.max(0, Math.floor(tube.sA - RUN_OUT));
  const poly = [];
  for (let i = iFrom; dir > 0 ? i <= iTo : i >= iTo; i += dir) {
    const l = lat * dir;            // (the lane to the right of the direction of travel)
    poly.push([tube.x[i] - tube.tz[i] * l, tube.z[i] + tube.tx[i] * l, tube.s[i]]);
  }
  let touching = null;
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide: (x, z, r, y) => {
    const hit = collide(x, z, r, y);
    if (hit && !touching) {
      const part = ctx.parts ? ctx.parts.find(([, f]) => f(x, z, r, y)) : null;
      touching = `${part ? part[0] : 'something'} at ${Math.round(x)},${Math.round(z)}`;
    }
    return hit;
  } });
  const chase = createChaseCamera(ground, ctx.lens);
  const st = car.state;
  ground.hint(1e4);
  ground.hint(ground.height(poly[0][0], poly[0][1]) + CAR.rideHeight);
  car.reset(poly[0][0], poly[0][1], Math.atan2(poly[3][1] - poly[0][1], poly[3][0] - poly[0][0]));
  chase.snap(st);
  let idx = 0, t = 0, touched = null, camBad = 0, camWhy = '';
  const ys = [], ss = [];
  const loc = {};
  while (idx < poly.length - 4 && t < 120) {
    const d2 = (k) => (poly[k][0] - st.x) ** 2 + (poly[k][1] - st.z) ** 2;
    while (idx < poly.length - 4 && d2(idx) > d2(idx + 1)) idx++;
    const la = Math.min(poly.length - 1, idx + Math.round(Math.max(3, Math.abs(st.speed) * 0.35)));     // (a short look-ahead: the car keeps its lane in the bends)
    let e = Math.atan2(poly[la][1] - st.z, poly[la][0] - st.x) - st.heading;
    while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    ground.hint(st.y);
    car.update(RIDE_DT, { throttle: Math.max(0, Math.min(1, (RIDE_SPEED - st.speed) * 0.5)), brake: st.speed > RIDE_SPEED + 3 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, e * 1.6)), handbrake: false });
    ground.hint(st.y);
    if (t > 1 && touching && !touched) touched = touching;
    touching = null;
    // the camera: inside a tube inside it, elsewhere over the ground
    const c = chase.update(st, RIDE_DT, 0, t);
    if (t > 1.5) {
      const inTube = ctx.tubes.inside(c.x, c.z, c.y - CAMERA.bodyRadius) || ctx.tubes.inside(c.x, c.z, c.y - 2);
      const floor = ground.height(c.x, c.z);
      if (c.y < floor + CAMERA.minClearance - 0.05) { camBad++; if (!camWhy) camWhy = `below its ground at ${Math.round(c.x)},${Math.round(c.z)}`; }
      if (!inTube && c.y < surface.height(c.x, c.z) + 0.3 && !ctx.tubes.locate(c.x, c.z, loc)) { camBad++; if (!camWhy) camWhy = `below the land at ${Math.round(c.x)},${Math.round(c.z)}`; }
      if (inTube && c.y > ground.overheadAt(c.x, c.z, st.y + 0.9) + 0.01) { camBad++; if (!camWhy) camWhy = `over the ceiling at ${Math.round(c.x)},${Math.round(c.z)}`; }
    }
    t += RIDE_DT;
    ys.push(st.y);
    ss.push(ctx.tubes.locate(st.x, st.z, loc) && loc.tube === tube ? loc.s : NaN);
    if (ctx.log) ctx.log(ss[ss.length - 1] - tube.sMouthA, st, loc);
  }
  const W = 3;
  let maxA = 0, maxAt = '', jointA = 0;
  for (let i = W; i < ys.length - W; i++) {
    const s = ss[i];
    if (!(s >= tube.sA - MEASURE_IN && s <= tube.sB + MEASURE_IN)) continue;
    const a = Math.abs(ys[i + W] - 2 * ys[i] + ys[i - W]) / ((W * RIDE_DT) ** 2);
    if (s >= tube.sA + MEASURE_IN && s <= tube.sB - MEASURE_IN) { if (a > maxA) { maxA = a; maxAt = `s ${(s - tube.sMouthA).toFixed(0)}`; } } else if (a > jointA) jointA = a;
  }
  const done = idx >= poly.length - 5;
  return { ok: done && !touched && maxA <= X_RIDE_MAX_A && camBad === 0, maxA, maxAt, jointA, touched, done, camBad, camWhy, time: t };
}

export function runTubeChecks({ check, section, stats, data, surface, ground, tubes, portals, collide, parts = null, lens, forest, buildings, lampsAt }) {
  section('X the tunnels the car drives through (tunnels16)');
  const list = tubes.tubes;
  const ids = tubes.ids;
  // ---- X1
  const missing = MUST_OPEN.filter(([, way]) => !way.every((id) => ids.has(id)));
  const steep = list.filter((t) => t.grade > TUBE.gradeMax || t.overRoad > 0.05);
  stats.tubes = list.map((t) => `${t.name} ${Math.round(t.length)} m grade ${(t.grade * 100).toFixed(1)} %`);
  stats.tubesRejected = tubes.rejected.map((r) => `${r.name} [${r.ids}] ${Math.round(r.length)} m: ${r.why}`);
  check(`X1 the Schuman underpass and the René Konen tunnel are drivable (${list.length} tubes); every floor <= ${TUBE.gradeMax * 100} % and under the roads over it`,
    missing.length === 0 && steep.length === 0, `${missing.map(([n]) => n).join(', ')} ${steep.map((t) => t.name).join(', ')}`);

  // ---- X2 / X3
  const rides = [];
  for (const tube of list) {
    for (const dir of [1, -1]) {
      for (const lat of laneCentres(tube, data.roads[dir > 0 ? tube.approachA : tube.approachB])) rides.push({ tube, dir, lat, r: driveTube(tube, dir, lat, { ground, surface, collide, parts, tubes: tubes.network, lens }) });
    }
  }
  const bad = rides.filter((q) => !q.r.done || q.r.touched || q.r.maxA > X_RIDE_MAX_A);
  const worst = rides.reduce((m, q) => Math.max(m, q.r.maxA), 0);
  const joints = rides.map((q) => [q.r.jointA, q]).sort((p, q) => q[0] - p[0]);
  stats.tubeRides = { rides: rides.length, bad: bad.length, worst: +worst.toFixed(2), worstJoint: joints.length ? `${joints[0][0].toFixed(1)} m/s2 ${joints[0][1].tube.name} ${joints[0][1].tube.ids[0]}` : '',
    jointsOver3: joints.filter((j) => j[0] > X_RIDE_MAX_A).map((j) => `${j[1].tube.name} ${j[1].tube.ids[0]} ${j[1].dir > 0 ? 'A>B' : 'B>A'} ${j[1].lat.toFixed(1)}: ${j[0].toFixed(1)}`) };
  const tell = (q) => `${q.tube.name} ${q.tube.ids[0]} ${q.dir > 0 ? 'A>B' : 'B>A'} lane ${q.lat.toFixed(1)}: ${q.r.done ? '' : 'stopped '}${q.r.touched ? `touched a ${q.r.touched} ` : ''}${q.r.maxA.toFixed(2)} m/s2 at ${q.r.maxAt}`;
  check(`X2 a car drives through every tube, every lane, both ways, without touching anything and <= ${X_RIDE_MAX_A} m/s2 in the tube (${rides.length} rides, worst ${worst.toFixed(2)})`,
    rides.length > 0 && bad.length === 0, bad.slice(0, 40).map(tell).join('; '));
  // flush: at each face, in every lane of its approach, the floor against the ground 0.3 m outside it (the car's ground there: the blend has reached the floor)
  const loc = {};
  let flushWorst = 0, flushAt = '';
  for (const tube of list) {
    for (const [sFace, out, app] of [[tube.sA, -1, tube.approachA], [tube.sB, 1, tube.approachB]]) {
      for (const lat0 of laneCentres(tube, data.roads[app])) {
        const lat = out > 0 ? lat0 : -lat0;
        const probe = (sq) => {
          const i = indexAt(tube, sq), f = Math.max(0, Math.min(1, (sq - tube.s[i]) / Math.max(1e-6, tube.s[i + 1] - tube.s[i])));
          const x = tube.x[i] + (tube.x[i + 1] - tube.x[i]) * f, z = tube.z[i] + (tube.z[i + 1] - tube.z[i]) * f;
          return [x - tube.tz[i] * lat, z + tube.tx[i] * lat];
        };
        const [xo, zo] = probe(sFace + out * 0.1), [xi, zi] = probe(sFace - out * 0.1);
        if (!tubes.network.locate(xi, zi, loc)) continue;
        const inside = loc.floor;
        ground.hint(inside + CAR.rideHeight);
        const outside = ground.contact(xo, zo);
        const d = Math.abs(inside - outside);
        if (d > flushWorst) { flushWorst = d; flushAt = `${tube.name} ${tube.ids[0]} lane ${lat.toFixed(1)} at ${Math.round(xo)},${Math.round(zo)}`; }
      }
    }
  }
  stats.tubeFlush = { worst: +flushWorst.toFixed(3), at: flushAt };
  check(`X2b every face is flush with its approach in every lane (step <= ${FLUSH_MAX} m over 0.2 m)`, flushWorst <= FLUSH_MAX, `${flushWorst.toFixed(3)} m at ${flushAt}`);
  const camBad = rides.filter((q) => q.r.camBad > 0);
  check('X3 the chase camera stays inside a tube (under its ceiling) and never goes below the ground outside it', camBad.length === 0,
    camBad.slice(0, 6).map((q) => `${q.tube.name} ${q.dir > 0 ? 'A>B' : 'B>A'}: ${q.r.camBad} frames, ${q.r.camWhy}`).join('; '));

  // ---- X4
  const closed = portals.all.filter((p) => ids.has(p.road)).length;
  const intruders = [];
  for (const tube of list) {
    for (const st of exposedStretches(tube, (x, z) => surface.height(x, z))) {
      for (let i = st.i0; i <= st.i1; i += 2) {
        for (const l of [-tube.innerHalf, 0, tube.innerHalf]) {
          const x = tube.x[i] - tube.tz[i] * l, z = tube.z[i] + tube.tx[i] * l, y = tube.floor[i] + 0.5;
          if (forest.collide(x, z, 0.6, y)) intruders.push(`tree in ${tube.name} at ${Math.round(x)},${Math.round(z)}`);
          if (buildings.collide(x, z, 0.3, y)) intruders.push(`house in ${tube.name} at ${Math.round(x)},${Math.round(z)}`);
          if (lampsAt && lampsAt(x, z, 0.8)) intruders.push(`lamp in ${tube.name} at ${Math.round(x)},${Math.round(z)}`);
        }
      }
    }
  }
  check('X4 no closed portal in a tube, and no tree, lamp or house stands where a tube\'s shell shows', closed === 0 && intruders.length === 0,
    `${closed} closed portals; ${[...new Set(intruders)].slice(0, 8).join('; ')}`);
}
