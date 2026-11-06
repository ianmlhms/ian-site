/* Lux Drive harness, section R (surface11): the carriageway is smooth over its WHOLE width, not only on its centre line.
 *   R1  ten multi-lane roads (the A1, the A4, the QA2 washboard roads) driven in EVERY lane, the outer ones too, at 13 m/s with the game's car: the vertical acceleration of the
 *       body (the QA drive test's measure: the second difference of its height over 3 frames) stays <= R1_MAX_ACC outside the junction boxes (QA2 N-D01: 152 events > 3 m/s2 on
 *       the A1 east, 45 m/s2 on Arelerstrooss; the field rippled by up to 6.7 cm at 6 m off the centre line and was smooth on it).  A junction box is gate L's: within JUNCTION.box
 *       of a place where another carved way meets the carriageway (the junction sheets shape the ground there; gate L drives them)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { createCar } from './car.js';
import { JUNCTION } from './junction-probe.js';

export const R1_SPEED = 13;            // m/s (the QA drive test)
const R1_DT = 1 / 60;
const R1_W = 3;                        // frames: the half window of the second difference (the QA drive test)
export const R1_MAX_ACC = 2.0;         // m/s2 (QA2 N-D01: 20 - 60 in the lane centre)
const R1_WINDOW = 500;                 // m of the carriageway (the chain of its ways, carriageways.js) driven either side of the QA point
const R1_END_CLEAR = 12;               // m: the first and last metres of the driven stretch (the car is set down there) are not judged
const R1_PARALLEL_COS = Math.cos(25 * Math.PI / 180);   // a way that runs beside this one at a smaller angle (the other carriageway, a service road) meets it in no junction ...
const R1_END_REACH = 40;               // m: ... unless one of its ends lies this close (a slip road that merges or leaves: its taper is the junction)
const R1_DECK_CLEAR = 8;               // m: the ends of a deck are judged by section Q
const R1_LANE_EDGE = 0.9;              // m: the car's centre stays this far inside the carriageway edge (its wheels on the tarmac, not on the kerb)
/** The roads: [label, way id, the QA point (x, z) the way is found by - the way of that id is checked to lie there]. */
export const R1_ROADS = [
  ['A1 east (QA2 N-D01)', 7816, 13764, 5849],
  ['Arelerstrooss (QA2 N-D01)', null, 3698, 8421],
  ['Bd de Kockelscheuer, Cloche d\'Or (QA2 N-D01)', null, 3812, 11903],
  ['Route de Longwy (QA1 D01)', null, 3000, 9400],
  ['Autoroute d\'Esch', 2223, 2323, 10368],
  ['Avenue J.F. Kennedy', 7559, 6991, 7419],
  ['Route d\'Echternach (3 lanes)', 7364, 10765, 1990],
  ['Rue de Neudorf', 1688, 6831, 8021],
  ['Rue de Beggen (3 lanes)', 16598, 5126, 5571],
  ['Autoroute d\'Arlon (3 lanes)', 1139, 3387, 12410],
];

/** The carved way nearest to (x, z) with at least two lanes (its chain), or null. */
function wayNear(net, roads, x, z) {
  let best = null, bd = 25;
  for (const ch of net.chains) {
    if (ch.tagged || net.overRoads.has(ch.road) || (roads[ch.road].lanes || 0) < 2) continue;
    for (let i = 0; i < ch.x.length; i++) {
      const d = Math.hypot(ch.x[i] - x, ch.z[i] - z);
      if (d < bd) { bd = d; best = ch; }
    }
  }
  return best;
}

/** The junction boxes along a carriageway line: the places where another carved way meets it (its centre line within the carriageway + JUNCTION.join of this centre line, at an angle,
 *  or a way beside it that ends there: a slip road's merge), and a test "is (x, z) within JUNCTION.box of one of them" (the box of gate L, junction-probe.js). */
function junctionBoxes(net, line, group, hw) {
  const GC = 32, key = (a, b) => a * 4096 + b, grid = new Map();
  for (const ch of net.chains) {
    if (net.overRoads.has(ch.road) || net.carriageways.groupOf[ch.road] === group) continue;
    for (let i = 1; i < ch.x.length; i++) {
      const a0 = Math.floor(Math.min(ch.x[i - 1], ch.x[i]) / GC), a1 = Math.floor(Math.max(ch.x[i - 1], ch.x[i]) / GC);
      const b0 = Math.floor(Math.min(ch.z[i - 1], ch.z[i]) / GC), b1 = Math.floor(Math.max(ch.z[i - 1], ch.z[i]) / GC);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = key(a, b); const l = grid.get(k); if (l) l.push(ch, i); else grid.set(k, [ch, i]); }
    }
  }
  const centres = [];
  for (let k = 0; k + 1 < line.x.length; k++) {
    const x = line.x[k], z = line.z[k], ul = Math.hypot(line.x[k + 1] - x, line.z[k + 1] - z) || 1, ux = (line.x[k + 1] - x) / ul, uz = (line.z[k + 1] - z) / ul;
    const cx = Math.floor(x / GC), cz = Math.floor(z / GC);
    let meets = false;
    for (let a = -1; a <= 1 && !meets; a++) for (let b = -1; b <= 1 && !meets; b++) {
      const l = grid.get(key(cx + a, cz + b));
      if (!l) continue;
      for (let q = 0; q < l.length && !meets; q += 2) {
        const o = l[q], j = l[q + 1];
        const ax = o.x[j - 1], az = o.z[j - 1], ex = o.x[j] - ax, ez = o.z[j] - az, ll = ex * ex + ez * ez;
        let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - ax - ex * t, z - az - ez * t) >= hw + JUNCTION.join) continue;
        const n = o.x.length;
        meets = Math.abs((ex * ux + ez * uz) / (Math.sqrt(ll) || 1)) < R1_PARALLEL_COS ||
          Math.hypot(o.x[0] - x, o.z[0] - z) <= R1_END_REACH || Math.hypot(o.x[n - 1] - x, o.z[n - 1] - z) <= R1_END_REACH;
      }
    }
    if (meets) centres.push([x, z]);
  }
  return (x, z) => net.protection(x, z) > 0 || centres.some(([cx, cz]) => Math.abs(cx - x) < JUNCTION.box && Math.abs(cz - z) < JUNCTION.box && Math.hypot(cx - x, cz - z) < JUNCTION.box);
}

/** The carriageway of way `ch` (its chain of ways, in order) as one line { x, z, arc } within R1_WINDOW of the point nearest (px, pz); the group of the carriageway. */
function carriagewayLine(net, ch, px, pz) {
  const group = net.carriageways.groupOf[ch.road];
  const ways = net.carriageways.chainWays.find((ws) => ws.some((w) => w.road === ch.road)) || [{ road: ch.road, rev: false }];
  const byRoad = new Map(net.chains.map((c) => [c.road, c]));
  // the run of carved ways of the chain that holds this way (a bridge way of the chain is a deck, not carved: the run ends there - section Q drives the decks)
  let x = [], z = [], found = false;
  for (const w of ways) {
    const c = byRoad.get(w.road);
    if (!c) { if (found) break; x = []; z = []; continue; }
    const n = c.x.length;
    for (let k = 0; k < n; k++) {
      const i = w.rev ? n - 1 - k : k;
      if (x.length && Math.hypot(c.x[i] - x[x.length - 1], c.z[i] - z[z.length - 1]) < 0.5) continue;
      x.push(c.x[i]); z.push(c.z[i]);
    }
    if (w.road === ch.road) found = true;
  }
  const arc = [0];
  for (let i = 1; i < x.length; i++) arc.push(arc[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]));
  let k = 0, bd = Infinity;
  for (let i = 0; i < x.length; i++) { const d = Math.hypot(x[i] - px, z[i] - pz); if (d < bd) { bd = d; k = i; } }
  const keep = [];
  for (let i = 0; i < x.length; i++) if (Math.abs(arc[i] - arc[k]) <= R1_WINDOW) keep.push(i);
  return { group, line: { x: keep.map((i) => x[i]), z: keep.map((i) => z[i]), arc: keep.map((i) => arc[i] - arc[keep[0]]) } };
}

/** The centre line of a chain offset by `off` (to the right, the carve's sign), every 0.5 m, with the distance along the way of every point. */
function laneLine(ch, off) {
  const n = ch.x.length, out = [];
  const nrm = (i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = ch.x[b] - ch.x[a], dz = ch.z[b] - ch.z[a], l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  };
  for (let i = 0; i + 1 < n; i++) {
    const [n0x, n0z] = nrm(i), [n1x, n1z] = nrm(i + 1), L = ch.arc[i + 1] - ch.arc[i];
    for (let s = 0; s < L; s += 0.5) {
      const f = s / L, nx = n0x + (n1x - n0x) * f, nz = n0z + (n1z - n0z) * f, nl = Math.hypot(nx, nz) || 1;
      out.push([ch.x[i] + (ch.x[i + 1] - ch.x[i]) * f + (nx / nl) * off, ch.z[i] + (ch.z[i + 1] - ch.z[i]) * f + (nz / nl) * off, ch.arc[i] + s]);
    }
  }
  return out;
}

/** The car carried along the polyline at R1_SPEED (x, z, heading set every frame; its vertical its own, car.js): per frame its height, place and the distance along the way. */
function carryAlong(car, ground, line) {
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) { const l = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]); seg.push(l); total += l; }
  let i = 0, acc = 0;
  const poseAt = (s) => {
    while (i < seg.length - 1 && acc + seg[i] < s) { acc += seg[i]; i++; }
    const f = Math.min(1, (s - acc) / (seg[i] || 1)), a = line[i], b = line[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0]), a[2] + (b[2] - a[2]) * f];
  };
  const st = car.state, frames = [];
  ground.hint(-1e4);                                   // the car is on the road, not on a deck over it
  const [x0, z0, h0] = poseAt(0);
  car.reset(x0, z0, h0);
  for (let s = 0; s < total - 0.5; s += R1_SPEED * R1_DT) {
    const [x, z, h, along] = poseAt(s);
    st.x = x; st.z = z; st.heading = h; st.vx = Math.cos(h) * R1_SPEED; st.vz = Math.sin(h) * R1_SPEED; st.speed = R1_SPEED;
    ground.hint(st.y);
    car.update(R1_DT, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    frames.push({ y: st.y, x: st.x, z: st.z, h, along, air: !st.grounded });
  }
  return frames;
}

/** R1: every lane of the ten roads.  Returns [{ label, road, lanes, runs: [{ off, maxAcc, at, judged, events3 }] }]. */
export function laneDriveScan({ net, roads, surface, ground, list = R1_ROADS }) {
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o), collide: null });
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0, sdCar: 0, sdPave: 0, sdMajor: 0 };
  const out = [];
  for (const [label, id, px, pz] of list) {
    const ch = id !== null ? net.chains.find((c) => c.road === id) : wayNear(net, roads, px, pz);
    if (!ch) { out.push({ label, road: id, missing: true, runs: [] }); continue; }
    const r = roads[ch.road], n = Math.max(2, r.lanes || 2), hw = net.info[ch.road].hw;
    const cw = carriagewayLine(net, ch, px, pz), L = cw.line.arc[cw.line.arc.length - 1];
    const inJunction = junctionBoxes(net, cw.line, cw.group, hw);
    const lane = (2 * hw) / n;
    const offs = [];
    for (let k = 0; k < n; k++) offs.push(Math.max(-(hw - R1_LANE_EDGE), Math.min(hw - R1_LANE_EDGE, -hw + (k + 0.5) * lane)));
    const runs = [];
    for (const off of offs) {
      const frames = carryAlong(car, ground, laneLine(cw.line, off));
      let maxAcc = 0, at = null, judged = 0, events3 = 0, lastEv = -1e9;
      const T = R1_W * R1_DT;
      for (let k = R1_W; k + R1_W < frames.length; k++) {
        const f = frames[k];
        if (f.along < R1_END_CLEAR || f.along > L - R1_END_CLEAR) continue;
        if (ground.onDeck(f.x, f.z) || nearDeck(ground, f.x, f.z)) continue;
        if (inJunction(f.x, f.z)) continue;
        surface.field.height(f.x, f.z, info);                        // (the lane is on this carriageway here: a way of the chain may be narrower - a lane dropped - and the lane then leaves it)
        if (info.road < 0 || net.carriageways.groupOf[info.road] !== cw.group || Math.abs(info.lat) > info.hw - R1_LANE_EDGE) continue;
        judged++;
        const a = Math.abs((frames[k + R1_W].y - 2 * f.y + frames[k - R1_W].y) / (T * T));
        if (a > 3 && f.along - lastEv > 2.5) { events3++; lastEv = f.along; }
        if (a > maxAcc) { maxAcc = a; at = [Math.round(f.x), Math.round(f.z)]; }
      }
      runs.push({ off: +off.toFixed(2), maxAcc, at, judged, events3 });
    }
    out.push({ label, road: ch.road, lanes: n, hw, runs });
  }
  return out;
}

/** A deck end within R1_DECK_CLEAR (judged by section Q). */
function nearDeck(ground, x, z) {
  for (const d of ground.decks) {
    for (const p of [d.pts[0], d.pts[d.pts.length - 1]]) if (Math.abs(p[0] - x) < R1_DECK_CLEAR && Math.abs(p[1] - z) < R1_DECK_CLEAR && Math.hypot(p[0] - x, p[1] - z) < R1_DECK_CLEAR) return true;
  }
  return false;
}

export function runSurfaceChecks({ check, section, stats, data, net, surface, ground }) {
  section('R surface11: the carriageway smooth over its whole width');
  const res = laneDriveScan({ net, roads: data.roads, surface, ground });
  const runs = res.flatMap((r) => r.runs.map((u) => ({ ...u, label: r.label })));
  const worst = runs.reduce((w, u) => (u.maxAcc > w.maxAcc ? u : w), { maxAcc: 0 });
  stats.laneDrive = res.map((r) => `${r.label} (way ${r.road}, ${r.lanes} lanes): ${r.runs.map((u) => `${u.off} m ${u.maxAcc.toFixed(2)}`).join(' / ')}`);
  const missing = res.filter((r) => r.missing || r.runs.some((u) => u.judged < 100));
  check(`R1 ten multi-lane roads driven in every lane (${runs.length} lanes) at ${R1_SPEED} m/s: vertical acceleration <= ${R1_MAX_ACC} m/s2 outside the junction boxes`,
    missing.length === 0 && runs.length >= 20 && worst.maxAcc <= R1_MAX_ACC,
    `worst ${worst.maxAcc.toFixed(2)} m/s2 (${worst.label}, lane ${worst.off} m at ${worst.at}); ${missing.length ? `missing / short: ${missing.map((r) => r.label).join(', ')}` : 'all roads found'}`);
}
