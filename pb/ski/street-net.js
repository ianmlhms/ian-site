/* The street network behind roads.js (streets round, pure: no THREE, no DOM): the OSM polylines of roads.json become one clean net of
 * line segments the street shader can paint from.
 *   joinRoads     OSM ways that meet end to end are one street (the bend at the joint is rounded, no round caps inside a street)
 *   roundRoads    corners rounded (R8d)
 *   gentleRoads   pieces steeper than MAX_GRADE are not drawn (R8c)
 *   finishEnds    every end is either JOINED to another street (its tyre ruts fade out there, the street itself does not) or a DEAD END:
 *                 over the last END_FADE m the street melts into the snow (strength 1 -> 0: narrower, no ruts, no bank). Short leftovers
 *                 that hang on nothing are dropped.
 *   houseApproaches   a narrow trodden path from a house's wall to the street next to it
 *   packSegments  Float32Array, 8 numbers a segment: ax, az, bx, bz, pack(strength, ruts) at a, the same at b, half width, street number
 *   pickSegments  the (at most SEGS) segments that decide the picture inside one lattice cell */

export const END_FADE = 15;            // m over which a dead end melts into the snow
export const BANK = 1.3;               // m beyond the edge up to which the ploughed bank is painted
export const SEGS = 4;                 // segments a lattice cell knows
export const PATH_HW = 0.9;           // half width of a trodden house approach; everything under PATH_MAX is painted as a path
export const PATH_MAX = 1.2;
export const STRIDE = 8;
const MIN_LOOSE = 34;                  // m: a street piece with two dead ends shorter than this is dropped
const JOIN_TURN = 1.05;                // rad: two ways meeting end to end at a sharper turn stay two streets (a corner with a junction)

/** roads.json -> [{ hw, pts: [[x, z], ...] }] */
export function decodeRoads(json) {
  if (!json || !Array.isArray(json.roads)) return [];
  const unit = json.unit || 0.5;
  return json.roads.map((r) => {
    const pts = [[r[1] * unit, r[2] * unit]];
    for (let i = 3; i + 1 < r.length; i += 2) { const [x, z] = pts[pts.length - 1]; pts.push([x + r[i] * unit, z + r[i + 1] * unit]); }
    return { hw: r[0] / 10, pts };
  });
}

const lengthOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Distance from (x, z) to the segment, its parameter t and the nearest point. */
export function pointSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9));
  return { d: Math.hypot(x - ax - dx * t, z - az - dz * t), t, x: ax + dx * t, z: az + dz * t };
}

/** R8c (3V QA: street pieces at 25-45 deg, a street climbing a wall at Brides): a street is drawn only where it runs gently with the
 *  ground: segments steeper than MAX_GRADE (sampled every <= 5 m) are cut out, pieces shorter than MIN_PIECE m dropped. Pure. */
export const MAX_GRADE = 0.3;          // ~17 deg
const MIN_PIECE = 8;
export function gentleRoads(roads, height) {
  const out = [];
  for (const r of roads) {
    let cur = [];
    const flush = () => { if (cur.length > 1 && lengthOf(cur) >= MIN_PIECE) out.push({ hw: r.hw, pts: cur }); cur = []; };
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 5));
      let steep = false;
      for (let i = 0; i < n && !steep; i++) {
        const x0 = ax + (bx - ax) * (i / n), z0 = az + (bz - az) * (i / n), x1 = ax + (bx - ax) * ((i + 1) / n), z1 = az + (bz - az) * ((i + 1) / n);
        steep = Math.abs(height(x1, z1) - height(x0, z0)) > MAX_GRADE * (L / n);
      }
      if (steep) { flush(); continue; }
      if (!cur.length) cur.push([ax, az]);
      cur.push([bx, bz]);
    }
    flush();
  }
  return out;
}

/** Douglas-Peucker (tol m): rounding leaves runs of sub-metre segments that only fill the cells' segment lists. */
function simplify(P, tol) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = tol, at = -1;
    for (let i = a + 1; i < b; i++) { const d = pointSeg(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]).d; if (d > worst) { worst = d; at = i; } }
    if (at >= 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return P.filter((_, i) => keep[i]);
}

/** R8d (QA: street bends read angular up close): the OSM polyline's corners are rounded before the lattice is built. Chaikin corner
 *  cutting, ROUND_PASSES times, on corners turning more than ROUND_MIN_TURN rad; each cut at 25 % of the neighbouring segments, at most
 *  ROUND_MAX_CUT m from the corner (a short segment between two bends keeps its middle). Pure; the ends stay. */
const ROUND_PASSES = 3, ROUND_MIN_TURN = 0.17, ROUND_MAX_CUT = 7, ROUND_TOL = 0.06;
export function roundRoads(roads) {
  return roads.map((r) => {
    let P = r.pts;
    for (let pass = 0; pass < ROUND_PASSES && P.length > 2; pass++) {
      const out = [P[0]];
      for (let k = 1; k + 1 < P.length; k++) {
        const [ax, az] = P[k - 1], [bx, bz] = P[k], [cx, cz] = P[k + 1];
        const l0 = Math.hypot(bx - ax, bz - az), l1 = Math.hypot(cx - bx, cz - bz);
        if (l0 < 1e-3 || l1 < 1e-3) { out.push(P[k]); continue; }
        const turn = Math.acos(Math.max(-1, Math.min(1, ((bx - ax) * (cx - bx) + (bz - az) * (cz - bz)) / (l0 * l1))));
        if (turn < ROUND_MIN_TURN) { out.push(P[k]); continue; }
        const c0 = Math.min(ROUND_MAX_CUT, l0 * 0.25) / l0, c1 = Math.min(ROUND_MAX_CUT, l1 * 0.25) / l1;
        out.push([bx - (bx - ax) * c0, bz - (bz - az) * c0], [bx + (cx - bx) * c1, bz + (cz - bz) * c1]);
      }
      out.push(P[P.length - 1]);
      P = out;
    }
    return { hw: r.hw, pts: simplify(P, ROUND_TOL) };
  });
}

/** Ways that meet end to end (same width, turn < JOIN_TURN) become one polyline: at every shared end point the straightest pair first. */
export function joinRoads(roads) {
  const ends = new Map();                                    // "x,z" -> [[road, 0 | 1 (last point)], ...]
  roads.forEach((r, i) => {
    if (r.pts.length < 2) return;
    for (const e of [0, 1]) { const p = e ? r.pts[r.pts.length - 1] : r.pts[0], k = p[0] + ',' + p[1]; let a = ends.get(k); if (!a) ends.set(k, (a = [])); a.push([i, e]); }
  });
  const link = new Map();                                    // road * 2 + end -> road * 2 + end of the one that goes on there
  /** unit direction INTO the road from its end */
  const into = ([i, e]) => { const P = roads[i].pts, a = e ? P[P.length - 1] : P[0], b = e ? P[P.length - 2] : P[1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  for (const list of ends.values()) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (list[a][0] === list[b][0] || Math.abs(roads[list[a][0]].hw - roads[list[b][0]].hw) > 0.05) continue;
      const u = into(list[a]), v = into(list[b]);
      const turn = Math.acos(Math.max(-1, Math.min(1, -(u[0] * v[0] + u[1] * v[1]))));
      if (turn < JOIN_TURN) pairs.push([turn, list[a], list[b]]);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    for (const [, a, b] of pairs) {
      const ka = a[0] * 2 + a[1], kb = b[0] * 2 + b[1];
      if (link.has(ka) || link.has(kb)) continue;
      link.set(ka, kb); link.set(kb, ka);
    }
  }
  const used = new Uint8Array(roads.length), out = [];
  const walk = (i, e) => {                                    // the chain that starts at end e of road i, in order
    let pts = [], at = i, from = e;
    while (!used[at]) {
      used[at] = 1;
      const P = from ? [...roads[at].pts].reverse() : roads[at].pts;
      pts = pts.length ? [...pts, ...P.slice(1)] : [...P];
      const next = link.get(at * 2 + (from ? 0 : 1));
      if (next === undefined) break;
      at = next >> 1; from = next & 1;
    }
    out.push({ hw: roads[i].hw, pts });
  };
  roads.forEach((r, i) => { if (r.pts.length < 2 || used[i]) return; if (!link.has(i * 2)) walk(i, 0); else if (!link.has(i * 2 + 1)) walk(i, 1); });
  roads.forEach((r, i) => { if (r.pts.length >= 2 && !used[i]) walk(i, 0); });          // closed loops
  return out;
}

/** near(x, z) -> [[road, segment], ...]: every segment within `reach` m (and some more). */
const GRID = 40;
function segGrid(roads, reach) {
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  roads.forEach((r, ri) => {
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      for (let i = Math.floor((Math.min(ax, bx) - reach) / GRID); i <= Math.floor((Math.max(ax, bx) + reach) / GRID); i++) {
        for (let j = Math.floor((Math.min(az, bz) - reach) / GRID); j <= Math.floor((Math.max(az, bz) + reach) / GRID); j++) {
          const kk = key(i, j); let a = grid.get(kk); if (!a) grid.set(kk, (a = [])); a.push([ri, k]);
        }
      }
    }
  });
  return (x, z) => grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID))) || [];
}

/** An extra point `dist` m from the start (fromStart) or the end of the polyline. */
function insertPoint(P, fromStart, dist) {
  const Q = fromStart ? P : [...P].reverse(), res = [Q[0]];
  let s = 0, done = false;
  for (let i = 1; i < Q.length; i++) {
    const d = Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]);
    if (!done && s + d >= dist - 0.3) {
      done = true;
      if (dist > s + 0.3 && s + d > dist + 0.3) { const t = (dist - s) / d; res.push([Q[i - 1][0] + (Q[i][0] - Q[i - 1][0]) * t, Q[i - 1][1] + (Q[i][1] - Q[i - 1][1]) * t]); }
    }
    s += d;
    res.push(Q[i]);
  }
  return fromStart ? res : res.reverse();
}

const TOUCH = 1.0;                     // m beyond another street's edge where an end still counts as joined
const REACH = 4.5;                     // m: ... and up to here it is led on to that street
const SAME_WAY = 0.82;                 // cos: the other street runs on in the same direction
const LOOP = 20;                       // m along the line from where a street's own end may meet it
/** The other street at one end of road ri (its current points): { gap (m beyond its edge), x, z, along } or null. */
function streetAtEnd(roads, near, ri, pts, end) {
  const n = pts.length, [x, z] = end ? pts[n - 1] : pts[0], q = end ? pts[n - 2] : pts[1];
  const L = Math.hypot(x - q[0], z - q[1]) || 1, ux = (x - q[0]) / L, uz = (z - q[1]) / L;
  let best = null;
  for (const [oi, k] of near(x, z)) {
    const P = roads[oi].pts;
    if (oi === ri && lengthOf(end ? P.slice(k + 1) : P.slice(0, k + 1)) < LOOP) continue;
    const h = pointSeg(x, z, P[k][0], P[k][1], P[k + 1][0], P[k + 1][1]);
    const gap = h.d - roads[oi].hw;
    if (best && gap >= best.gap) continue;
    const sx = P[k + 1][0] - P[k][0], sz = P[k + 1][1] - P[k][1];
    best = { gap, x: h.x, z: h.z, along: Math.abs(ux * sx + uz * sz) / (Math.hypot(sx, sz) || 1) };
  }
  return best;
}

/** [{ hw, pts, f: [strength per point], r: [ruts per point] }] from rounded, gentle polylines (see the head comment). */
export function finishEnds(roads, height) {
  const near = segGrid(roads, 14);
  const out = [];
  roads.forEach((r, ri) => {
    let P = r.pts;
    const ends = [0, 1].map((end) => {
      const o = streetAtEnd(roads, near, ri, r.pts, end);
      if (!o || o.gap > REACH) return 'dead';
      if (o.gap > TOUCH) {                                    // nearly there: led on to the other street, where the ground allows it
        const p = end ? r.pts[r.pts.length - 1] : r.pts[0], d = Math.hypot(o.x - p[0], o.z - p[1]);
        if (Math.abs(height(o.x, o.z) - height(p[0], p[1])) > MAX_GRADE * d) return 'dead';
        P = end ? [...P, [o.x, o.z]] : [[o.x, o.z], ...P];
      }
      return o.along > SAME_WAY ? 'on' : 'joined';            // 'on': the street goes on in another width: its ruts stay
    });
    const both = ends[0] === 'dead' && ends[1] === 'dead', len = lengthOf(P);
    if (both && len < MIN_LOOSE) return;
    const fade = Math.min(END_FADE, len * (both ? 0.4 : 0.7)), rut = Math.min(r.hw + 5, len * 0.6);
    [0, 1].forEach((end) => { if (ends[end] !== 'on') P = insertPoint(P, !end, ends[end] === 'dead' ? fade : rut); });
    const total = lengthOf(P), f = [], rr = [];
    let s = 0;
    P.forEach((p, i) => {
      if (i) s += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]);
      let fv = 1, rv = 1;
      [s, total - s].forEach((d, end) => {
        if (ends[end] === 'dead') { fv = Math.min(fv, d / fade); rv = Math.min(rv, d / fade); } else if (ends[end] === 'joined') rv = Math.min(rv, d / rut);
      });
      f.push(clamp01(fv)); rr.push(clamp01(rv));
    });
    out.push({ hw: r.hw, pts: P, f, r: rr, ends });
  });
  return out;
}

const PATH_NEAR = 1.2, PATH_FAR = 10, PATH_GRADE = 0.36, PATH_CLEAR = 0.8, SHED = 8;  // m from the wall to the street's edge; steepness; m to other houses; m2
/** boxes = look.js buildingBoxes ([x, z, cos, sin, half length, half width, top]): one trodden path per house that stands at a street,
 *  from the middle of the wall that faces it; never through another house, up a bank or across a street. */
export function houseApproaches(streets, boxes, height, boxIndex) {
  const near = segGrid(streets, PATH_FAR + 10);
  const out = [];
  for (const b of boxes) {
    if (b[4] * b[5] < SHED) continue;
    let best = null;
    for (const [u, v, nu, nv] of [[b[4], 0, 1, 0], [-b[4], 0, -1, 0], [0, b[5], 0, 1], [0, -b[5], 0, -1]]) {
      const x = b[0] + u * b[2] - v * b[3], z = b[1] + u * b[3] + v * b[2], nx = nu * b[2] - nv * b[3], nz = nu * b[3] + nv * b[2];
      for (const [ri, k] of near(x, z)) {
        const s = streets[ri], Q = s.pts, h = pointSeg(x, z, Q[k][0], Q[k][1], Q[k + 1][0], Q[k + 1][1]);
        const gap = h.d - s.hw;
        if (gap < PATH_NEAR || gap > PATH_FAR || (best && gap >= best.gap)) continue;
        if (s.f[k] < 0.9 || s.f[k + 1] < 0.9) continue;      // not onto a street that is fading out
        if (((h.x - x) * nx + (h.z - z) * nz) / h.d < 0.5) continue;
        best = { gap, d: h.d, ax: x - nx * 0.3, az: z - nz * 0.3, bx: h.x, bz: h.z };
      }
    }
    if (!best) continue;
    const { ax, az, bx, bz, d } = best;
    const n = Math.max(2, Math.ceil(d)), ignore = new Set([b]);
    let ok = true, last = height(ax, az);
    for (let i = 1; i <= n && ok; i++) {
      const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n), h = height(x, z);
      ok = Math.abs(h - last) <= PATH_GRADE * (d / n) && !(boxIndex && boxIndex.hit(x, z, PATH_CLEAR, ignore));
      last = h;
    }
    if (ok) out.push({ hw: PATH_HW, pts: [[ax, az], [bx, bz]], f: [1, 1], r: [0, 0] });
  }
  return out;
}

/** The whole net of a resort: streets (joined, rounded, gentle, ends finished) + the house approaches. */
export function buildStreets(roads, height, { boxes = null, boxIndex = null } = {}) {
  const streets = finishEnds(gentleRoads(roundRoads(joinRoads(roads)), height), height);
  return boxes ? [...streets, ...houseApproaches(streets, boxes, height, boxIndex)] : streets;
}

/** Seen from afar (the coarse lattice: 10 m cells know SEGS segments too): the streets without the paths and without the fine bends. */
const FAR_TOL = 0.5;
function farStreets(streets) {
  return streets.filter((s) => s.hw >= PATH_MAX).map((s) => {
    const full = (i) => s.f[i] > 0.99 && s.r[i] > 0.99, out = { hw: s.hw, pts: [], f: [], r: [] };
    const put = (p, i) => { out.pts.push(p); out.f.push(s.f[i]); out.r.push(s.r[i]); };
    for (let i = 0; i < s.pts.length;) {
      let j = i;
      while (j + 1 < s.pts.length && full(j) && full(j + 1)) j++;
      if (j > i + 1) { for (const p of simplify(s.pts.slice(i, j + 1), FAR_TOL)) put(p, i); } else for (let k = i; k <= j; k++) put(s.pts[k], k);
      i = j + 1;
    }
    return out;
  });
}

const packEnd = (f, r) => Math.round(f * 100) + 0.9 * r;
/** Every segment of the net: { data (STRIDE numbers each), count, far }: the segments from `far` on are the coarse copy. */
export function packSegments(streets) {
  const all = [...streets, ...farStreets(streets)], segsOf = (l) => l.reduce((n, s) => n + s.pts.length - 1, 0);
  const count = segsOf(all), data = new Float32Array(Math.max(1, count) * STRIDE);
  let o = 0;
  all.forEach((s, si) => {
    for (let k = 0; k + 1 < s.pts.length; k++) {
      data.set([s.pts[k][0], s.pts[k][1], s.pts[k + 1][0], s.pts[k + 1][1], packEnd(s.f[k], s.r[k]), packEnd(s.f[k + 1], s.r[k + 1]), s.hw, si], o);
      o += STRIDE;
    }
  });
  return { data, count, far: segsOf(streets) };
}

/** m added to the distance to the edge where a street's strength f drops (a dead end): narrower and narrower, gone at f = 0. The shader
 *  (roads.js fold) does the same. */
export const fadeGap = (f, hw) => (1 - f) * (1 - f) * (hw + BANK + 0.7);
const WIN = 100, EDGE_KEEP = 1.05, PATH_KEEP = 0.45;           // m beyond the edge up to which a lattice cell is emitted (street, path)
/** The segments for the lattice cell [x0, z0] .. + lat, from the candidates (segment numbers): for every sample point the nearest segment
 *  of each street counts, the ones that win somewhere first. Returns SEGS segment numbers (grouped by street), or null when the cell
 *  lies beyond every bank. */
export function pickSegments(net, cands, x0, z0, lat) {
  const D = net.data, N = lat > 4 ? 5 : 3;
  const score = new Map();
  let minE = Infinity;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const x = x0 + (lat * a) / (N - 1), z = z0 + (lat * b) / (N - 1);
    const best = new Map();                                   // street -> [e, segment]
    let win = null;
    for (const s of cands) {
      const o = s * STRIDE, h = pointSeg(x, z, D[o], D[o + 1], D[o + 2], D[o + 3]), hw = D[o + 6];
      const f = (Math.floor(D[o + 4] + 1e-3) * (1 - h.t) + Math.floor(D[o + 5] + 1e-3) * h.t) / 100;
      const e = h.d - hw + fadeGap(f, hw);
      const old = best.get(D[o + 7]);
      if (!old || e < old[0]) best.set(D[o + 7], [e, s]);
      minE = Math.min(minE, hw < PATH_MAX ? e + EDGE_KEEP - PATH_KEEP : e);
      if (!win || e < win[0]) win = [e, s];
    }
    for (const [e, s] of best.values()) { const v = e - (s === win[1] ? WIN : 0), old = score.get(s); if (old === undefined || v < old) score.set(s, v); }
  }
  if (minE > EDGE_KEEP) return null;
  const list = [...score.entries()].sort((p, q) => p[1] - q[1]).slice(0, SEGS).map((p) => p[0]);
  list.sort((p, q) => D[p * STRIDE + 7] - D[q * STRIDE + 7]);
  while (list.length < SEGS) list.push(list[list.length - 1]);
  return list;
}

/** R8d (QA: a house roof lying across the Brides street at (8388, 926)): the OSM houses a street runs through. A house is left out when
 *  a street's middle half (its centreline grown by half its half-width, less 0.5 m) crosses its footprint for more than 2 m.
 *  rows = buildings.json rows ([x, z, w, d, angle, ...]), roads = decodeRoads(roads.json). Returns a Set of row indices. */
export function housesOnStreets(rows, roads) {
  const G = 50, grid = new Map();
  const gk = (i, j) => i * 100003 + j;
  for (const r of roads) {
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      for (let i = Math.floor(Math.min(ax, bx) / G); i <= Math.floor(Math.max(ax, bx) / G); i++) {
        for (let j = Math.floor(Math.min(az, bz) / G); j <= Math.floor(Math.max(az, bz) / G); j++) {
          const key = gk(i, j); let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push([ax, az, bx, bz, r.hw]);
        }
      }
    }
  }
  /** length of the segment p0 -> p1 inside the box |x| <= hx, |z| <= hz (Liang-Barsky) */
  const inside = (x0, z0, x1, z1, hx, hz) => {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dz = z1 - z0;
    for (const [p, q] of [[-dx, x0 + hx], [dx, hx - x0], [-dz, z0 + hz], [dz, hz - z0]]) {
      if (p === 0) { if (q < 0) return 0; continue; }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    }
    return Math.max(0, t1 - t0) * Math.hypot(dx, dz);
  };
  const out = new Set();
  rows.forEach((b, idx) => {
    const c = Math.cos(b[4]), s = Math.sin(b[4]), R = Math.hypot(b[2], b[3]) / 2 + 4;
    const seen = new Set();
    for (let i = Math.floor((b[0] - R) / G); i <= Math.floor((b[0] + R) / G); i++) {
      for (let j = Math.floor((b[1] - R) / G); j <= Math.floor((b[1] + R) / G); j++) {
        for (const g of grid.get(gk(i, j)) || []) {
          if (seen.has(g)) continue;
          seen.add(g);
          const grow = g[4] * 0.5 - 0.5;
          const hx = b[2] / 2 + grow, hz = b[3] / 2 + grow;
          if (hx <= 0 || hz <= 0) continue;
          const lx = (x, z) => (x - b[0]) * c + (z - b[1]) * s, lz = (x, z) => -(x - b[0]) * s + (z - b[1]) * c;
          if (inside(lx(g[0], g[1]), lz(g[0], g[1]), lx(g[2], g[3]), lz(g[2], g[3]), hx, hz) > 2) { out.add(idx); return; }
        }
      }
    }
  });
  return out;
}
