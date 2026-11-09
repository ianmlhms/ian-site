/* Lux Drive sweep 1, the drive of one lane: the game's own car (car.js: suspension, flight over a crest, attitude) carried along the centre of a lane at a fixed speed
 * (x, z and heading set every frame as the harness does: the test is the road, not the steering), the game's own collider (car-collide.js: every part that stops
 * the car) probed at the car's body circles.  Pure: no I/O, nothing mutated outside the car it is given. */
import { createCar } from '../../../pb/lux-drive/car.js';
import { CAR } from '../../../pb/lux-drive/config.js';

export const DT = 1 / 60;
export const LIMITS = Object.freeze({
  jolt: 8,            // m/s2: vertical acceleration (second difference over +-JOLT_W frames)
  roll: 0.15,         // rad
  air: 0.1,           // s airborne
  fall: 1,            // m dropped in one flight
  hit: 0.02,          // m of penetration (the body circles are probed this much smaller: a graze is no stop, as in harness Q)
  offroad: 3,         // m of lane with the car's wheels off any carriageway
});
const JOLT_W = 3;               // frames: half window
const PROBE_EVERY = 0.5;        // m of travel between two collider probes
const HEADING_SPAN = 2.5;       // m
const PORTAL_SKIP = 10;          // m: (city21) a lane out of a closed tunnel's face starts this far out (driveLane)
const START_BRIDGE_JOIN = 3;    // m: (city21) a lane whose start lies this close to the end of a bridge way continues that bridge (startHint)
const END_CLEAR = 4;            // m: events this near an end of the way are junction / dead-end noise, not judged
const MERGE = 6;                // m: events of one kind closer than this along one run are one event

/** Offsets one polyline sideways by `off` (m, to the left as laneOffsets: x - dz * off, z + dx * off).  Inside a bend the two offset segments are joined at their
 *  crossing (miter, limited); outside a bend the lane sweeps round the vertex on an arc of radius |off| (a sharp miter point would leave the carriageway there). */
export function offsetLine(pts, off) {
  const out = [];
  const normal = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l > 1e-6 ? [-(b[1] - a[1]) / l, (b[0] - a[0]) / l, (b[0] - a[0]) / l, (b[1] - a[1]) / l] : null; };
  for (let i = 0; i < pts.length; i++) {
    const n1 = i > 0 ? normal(pts[i - 1], pts[i]) : null, n2 = i + 1 < pts.length ? normal(pts[i], pts[i + 1]) : null;
    const v = pts[i];
    if (!n1 || !n2) { const n = n1 || n2; if (n) out.push([v[0] + n[0] * off, v[1] + n[1] * off]); continue; }
    const cross = n1[2] * n2[3] - n1[3] * n2[2];                 // > 0: the path turns toward +normal
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    if (cross * off > 0) {                                        // inside the bend: the crossing of the two offset segments
      let nx = n1[0] + n2[0], nz = n1[1] + n2[1];
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const cos = Math.max(0.5, nx * n1[0] + nz * n1[1]);
      out.push([v[0] + nx * off / cos, v[1] + nz * off / cos]);
    } else {                                                      // outside: an arc from the first normal to the second
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))), steps = Math.max(1, Math.ceil(ang / (Math.PI / 12)));
      const a1 = Math.atan2(n1[1], n1[0]);
      let da = Math.atan2(n2[1], n2[0]) - a1;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      for (let k = 0; k <= steps; k++) { const a = a1 + da * k / steps; out.push([v[0] + Math.cos(a) * off, v[1] + Math.sin(a) * off]); }
    }
  }
  return out;
}

/** Drops points closer than 0.05 m to the previous one. */
function clean(pts) {
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) out.push(p); }
  return out;
}

/** Is the road an approach of the tube, or the way that carries on from the far end of one (within 1.5 m)? */
function approachOf(tube, road, world) {
  if (road.id === tube.approachA || road.id === tube.approachB) return true;
  const ends = [road.pts[0], road.pts[road.pts.length - 1]];
  return [tube.approachA, tube.approachB].some((id) => {
    const a = world.roadById ? world.roadById.get(id) : world.roads.find((r) => r.id === id);
    return !!a && [a.pts[0], a.pts[a.pts.length - 1]].some((p) => ends.some((e) => Math.hypot(p[0] - e[0], p[1] - e[1]) <= 1.5));
  });
}

/** Is there an end of a bridge way ('bridge') or of a CLOSED tunnel way ('closed') within START_BRIDGE_JOIN of (x, z)?  (A grid of the ends, built once per world.) */
function endsNear(world, kind, x, z) {
  if (!world._ends) {
    const grids = { bridge: new Map(), closed: new Map() }, key = (px, pz) => Math.floor(px / 16) * 65536 + Math.floor(pz / 16);
    for (const r of world.data.roads) {
      if (r.pts.length < 2) continue;
      const k = r.tunnel ? (world.isOpen && world.isOpen(r) ? null : 'closed') : r.bridge || r.over ? 'bridge' : null;
      if (!k) continue;
      for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) { const kk = key(p[0], p[1]), l = grids[k].get(kk); if (l) l.push(p); else grids[k].set(kk, [p]); }
    }
    world._ends = { grids, key };
  }
  const { grids, key } = world._ends;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of grids[kind].get(key(x + a * 16, z + b * 16)) || []) if (Math.hypot(p[0] - x, p[1] - z) <= START_BRIDGE_JOIN) return true;
  return false;
}

/** The level (the car's body, the hint) a lane starts at. */
function startHint({ road, x, z, world }) {
  const { ground, surface, tubes } = world;
  if (road.tunnel) {
    for (const t of tubes.tubes) {
      if (!t.ids.includes(road.id)) continue;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < t.x.length; i++) { const d = Math.hypot(t.x[i] - x, t.z[i] - z); if (d < bd) { bd = d; bi = i; } }
      return t.floor[bi] + CAR.rideHeight + 0.3;
    }
  }
  if (road.over || road.bridge) return 1e9;
  // (city21) a way that starts where a bridge way ends and under a deck (the landmark deck of the Pont Rouge runs on 14 m past the OSM end of the bridge over the start of
  // Av. J.F. Kennedy 2965): the car comes off the bridge onto it - it starts on the deck, not on the valley slope under it (bank hits, 700 m/s2 "jolts" at the start)
  if (world.deckNetwork && world.deckNetwork.deckAt(x, z, 1e9, {}) && endsNear(world, 'bridge', x, z)) return 1e9;
  // (an approach of a tube that starts in its trough or blend - the 26 m approach of Cents south ends at the face - starts on the tube's floor, not on the land of
  // the hill over the portal: the car fell off it and "flew" 0.6 s, tunnels19.  Only the tube's own approaches: a road OVER the tube - the Rond-Point Schuman,
  // Krautmaart over the René Konen tunnel, the Buchler bridge over the Rocade mouth - was put on the floor under it, inside the walls: the full-city sweep's
  // "tube mouth" places, 0.8 m tube hits and 2,700 m/s2 jolts at every lane)
  // (the next way on from a short approach counts too: Cents north 157 is 13 m long, 9174 starts in the trough of tube 159)
  const L = {};
  if (tubes && tubes.network && tubes.network.locate(x, z, L) && L.tube && approachOf(L.tube, road, world)) {
    const t = L.tube, g0 = t.troughA ? t.tA : t.sA - 8, g1 = t.troughB ? t.tB : t.sB + 8;
    if (L.s >= g0 && L.s <= g1) return L.floor + CAR.rideHeight + 0.3;
  }
  return ground.levelAt(x, z, surface.height(x, z) + 0.5) + CAR.rideHeight;
}

/**
 * Drives one lane.  line: [[x, z], ...] the lane's centre line in driving direction.  Returns { length, frames, events: [{ type, value, x, z, y, arc, part?, id?, pen? }] }.
 */
export function driveLane({ world, car, road, line, speed }) {
  const { ground, collider } = world;
  const pts = clean(line);
  if (pts.length < 2) return { length: 0, frames: 0, events: [] };
  const seg = [], cum = [0];
  for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); cum.push(cum[i] + l); }
  const total = cum[cum.length - 1];
  const st = car.state;
  const xzAt = (s) => {
    let lo = 0, hi = seg.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const f = Math.max(0, Math.min(1, (s - cum[lo]) / (seg[lo] || 1))), a = pts[lo], b = pts[lo + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  // the heading is the chord over +-HEADING_SPAN m: a real car does not turn on the spot at the vertex of a polyline (the lane of a bend would jolt on the heading alone)
  const poseAt = (s) => {
    const [x, z] = xzAt(s), a = xzAt(Math.max(0, s - HEADING_SPAN)), b = xzAt(Math.min(total, s + HEADING_SPAN));
    return [x, z, Math.atan2(b[1] - a[1], b[0] - a[0])];
  };
  // (city21) a lane out of the face of a CLOSED tunnel (Stafelter, kept closed: the world data ends inside it) starts PORTAL_SKIP m out: nobody comes out of that face, and the
  // car put at the face stood on the hill over the portal - Autoroute du Nord 17563 and link 8709 "fell" 15 m off it at their start
  const s0 = !road.tunnel && endsNear(world, 'closed', pts[0][0], pts[0][1]) && total > PORTAL_SKIP + END_CLEAR ? PORTAL_SKIP : 0;
  const [x0, z0, h0] = poseAt(s0);
  ground.hint(startHint({ road, x: x0, z: z0, world }));
  car.reset(x0, z0, h0);
  ground.hint(st.y);
  const n = Math.floor((total - s0) / (speed * DT)) + 1;
  const ys = new Float32Array(n), roll = new Float32Array(n), xs = new Float32Array(n), zs = new Float32Array(n), arc = new Float32Array(n), air = new Uint8Array(n), off = new Uint8Array(n);
  const events = [];
  let k = 0, lastProbe = -1e9, hitRun = null, airRun = null;
  const flushHit = () => { if (hitRun) { events.push({ type: 'hit', value: hitRun.pen, x: hitRun.x, z: hitRun.z, y: hitRun.y, arc: hitRun.arc, part: hitRun.part, id: hitRun.id, len: hitRun.len }); hitRun = null; } };
  for (let s = s0; k < n && s <= total; s += speed * DT, k++) {
    const [x, z, h] = poseAt(s);
    st.x = x; st.z = z; st.heading = h; st.vx = Math.cos(h) * speed; st.vz = Math.sin(h) * speed; st.speed = speed;
    ground.hint(st.y);
    car.update(DT, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    ys[k] = st.y; roll[k] = st.roll; xs[k] = st.x; zs[k] = st.z; arc[k] = s; air[k] = st.grounded ? 0 : 1; off[k] = st.onRoad ? 0 : 1;
    // flights: from the first airborne frame to the landing; the drop is measured from where it left the ground
    if (!st.grounded) { if (!airRun) airRun = { k0: k, y0: ys[Math.max(0, k - 1)], minY: st.y }; airRun.minY = Math.min(airRun.minY, st.y); }
    else if (airRun) { events.push({ type: 'air', value: (k - airRun.k0) * DT, x: xs[airRun.k0], z: zs[airRun.k0], y: airRun.y0, arc: arc[airRun.k0] }); const drop = airRun.y0 - airRun.minY; if (drop > LIMITS.fall) events.push({ type: 'fall', value: drop, x: xs[airRun.k0], z: zs[airRun.k0], y: airRun.y0, arc: arc[airRun.k0] }); airRun = null; }
    if (s - lastProbe >= PROBE_EVERY) {
      lastProbe = s;
      const cy = Math.cos(h), sy = Math.sin(h), level = st.y - CAR.rideHeight;
      let best = null;
      for (const o of CAR.bodyCircles.concat(0)) {
        const hit = collider.collide(st.x + cy * o, st.z + sy * o, CAR.bodyRadius - LIMITS.hit, level);
        if (hit && (!best || hit.pen > best.pen)) best = hit;
      }
      if (best) {
        const part = best.part || partOf(collider, st.x, st.z, level, cy, sy);
        if (part === 'area') { flushHit(); continue; }   // the edge of the play area stops the car on purpose
        if (hitRun && hitRun.id === best.id && s - hitRun.last <= PROBE_EVERY * 2.5) { hitRun.pen = Math.max(hitRun.pen, best.pen); hitRun.len = s - hitRun.arc; hitRun.last = s; }
        else { flushHit(); hitRun = { pen: best.pen, x: st.x, z: st.z, y: st.y, arc: s, last: s, len: 0, part, id: best.id }; }
      } else flushHit();
    }
  }
  flushHit();
  if (airRun) events.push({ type: 'air', value: (k - airRun.k0) * DT, x: xs[airRun.k0], z: zs[airRun.k0], y: airRun.y0, arc: arc[airRun.k0] });
  const T = JOLT_W * DT;
  let lastJolt = -1e9, lastRoll = -1e9, offStart = -1;
  for (let j = JOLT_W; j + JOLT_W < k; j++) {
    const a = Math.abs((ys[j + JOLT_W] - 2 * ys[j] + ys[j - JOLT_W]) / (T * T));
    if (a > LIMITS.jolt) {
      if (arc[j] - lastJolt > MERGE || !events.length || events[events.length - 1].type !== 'jolt') events.push({ type: 'jolt', value: a, x: xs[j], z: zs[j], y: ys[j], arc: arc[j] });
      else if (a > events[events.length - 1].value) Object.assign(events[events.length - 1], { value: a, x: xs[j], z: zs[j], y: ys[j], arc: arc[j] });
      lastJolt = arc[j];
    }
    const r = Math.abs(roll[j]);
    if (r > LIMITS.roll) {
      const last = [...events].reverse().find((e) => e.type === 'roll');
      if (arc[j] - lastRoll > MERGE || !last) events.push({ type: 'roll', value: r, x: xs[j], z: zs[j], y: ys[j], arc: arc[j] });
      else if (r > last.value) Object.assign(last, { value: r, x: xs[j], z: zs[j], y: ys[j], arc: arc[j] });
      lastRoll = arc[j];
    }
  }
  for (let j = 0; j <= k; j++) {
    if (j < k && off[j]) { if (offStart < 0) offStart = j; continue; }
    if (offStart >= 0) {
      const len = arc[j - 1] - arc[offStart];
      if (len >= LIMITS.offroad) events.push({ type: 'offroad', value: len, x: xs[offStart], z: zs[offStart], y: ys[offStart], arc: arc[offStart] });
      offStart = -1;
    }
  }
  // the ends of the way are junction / dead-end noise
  const kept = events.filter((e) => e.arc >= END_CLEAR && e.arc <= total - END_CLEAR && world.playArea.inside(e.x, e.z));   // (outside the play area the world is a coarse backdrop)
  return { length: total, frames: k, events: kept };
}

/** The name of the part that holds the hit (car-collide.js parts), when the collider did not say. */
function partOf(collider, x, z, level, cy, sy) {
  for (const [name, f] of collider.parts) {
    for (const o of CAR.bodyCircles.concat(0)) if (f(x + cy * o, z + sy * o, CAR.bodyRadius - LIMITS.hit, level)) return name;
  }
  return 'solid';
}

export const newCar = (world) => createCar({ ground: world.ground, roadInfoAt: (x, z, o) => world.surface.roadInfoAt(x, z, o), collide: null });
