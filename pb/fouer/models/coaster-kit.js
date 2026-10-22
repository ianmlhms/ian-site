/* Schueberfouer Tycoon, W4b: the track toolkit of the coaster / flume / ghost-train models (coasters.js, hall-geister.js).
 *
 *   const sp = makeSpline(controlPoints, { bank: { gain, max }, step })      closed centripetal Catmull-Rom curve, arc-length table, rotation-minimising
 *                                                                           frames (loops stay upright), banking from the horizontal turning rate
 *   sp.at(s) -> { p, t, u, r }   position / tangent / up / right at arc length s (wraps); sp.length; sp.heightAt(s); sp.curvatureAt(s)
 *   const list = sp.resample({ maxStep, maxAngle })    arc lengths for a mesh (dense on curves, sparse on straights)
 *   ribbon / box / rails / sleepers / diamonds         merged strips swept along the frames of `list`
 *   const run = makeRun(sp, cfg)                       speed profile (station dwell, lift, energy, hairpin and brake limits) -> run.sAt(t), run.period
 *   carMatrix(T, frame, lift, out)                     basis (left, up, forward) so a car model built with +z = forward sits on the track
 *
 * Pure functions of t everywhere: a model's `phaseAt(t)` is run.sAt(t) and the trains are run.sAt(t + k * period / n) apart. */
import { clamp, lerp, wrap } from './big-kit.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist = (a, b) => len(sub(a, b));
/** rotate vector v about unit axis a by angle q (Rodrigues) */
const rot = (v, a, q) => { const c = Math.cos(q); const s = Math.sin(q); const k = cross(a, v); const d = dot(a, v) * (1 - c); return [v[0] * c + k[0] * s + a[0] * d, v[1] * c + k[1] * s + a[1] * d, v[2] * c + k[2] * s + a[2] * d]; };

/* ------------------------------------------------------------------------------------------------------------------ geometry helpers for control points */
/** points of a flat arc: centre (cx, cz), radius r, from angle a0 to a1 (radians, 0 = +x, pi/2 = +z), y from y0 to y1; the end points are included */
export function arcPoints(cx, cz, r, a0, a1, y0, y1, n) {
  const k = n || Math.max(3, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 6)));
  const out = [];
  for (let i = 0; i <= k; i++) { const f = i / k; const a = lerp(a0, a1, f); out.push([cx + Math.cos(a) * r, lerp(y0, y1, f), cz + Math.sin(a) * r]); }
  return out;
}
/** a vertical loop (prolate trochoid): starts at (x0, y0, z0) heading +x (rotate with `heading`), radius r, advance p per radian, lateral drift dz over the loop */
export function loopPoints(x0, y0, z0, r, p, dz, n = 28, heading = 0) {
  const out = []; const c = Math.cos(heading); const s = Math.sin(heading);
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const lx = p * th + r * Math.sin(th); const ly = r * (1 - Math.cos(th)); const lz = dz * (i / n);
    out.push([x0 + lx * c - lz * s, y0 + ly, z0 + lx * s + lz * c]);
  }
  return out;
}
export const loopAdvance = (p) => p * Math.PI * 2;

/* ------------------------------------------------------------------------------------------------------------------ spline */
export function makeSpline(ctrl, o = {}) {
  const n = ctrl.length; const step = o.step || 0.15;
  const P = (i) => ctrl[((i % n) + n) % n];
  const dense = []; const dseg = [];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const t0 = 0; const t1 = t0 + Math.sqrt(dist(p0, p1) || 1e-3); const t2 = t1 + Math.sqrt(dist(p1, p2) || 1e-3); const t3 = t2 + Math.sqrt(dist(p2, p3) || 1e-3);
    const m = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < m; k++) {
      const t = lerp(t1, t2, k / m);
      const L = (a, b, ta, tb) => mul(add(mul(a, tb - t), mul(b, t - ta)), 1 / (tb - ta));
      const A1 = L(p0, p1, t0, t1); const A2 = L(p1, p2, t1, t2); const A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2); const B2 = L(A2, A3, t1, t3);
      dense.push(L(B1, B2, t1, t2)); dseg.push(i);
    }
  }
  const N = dense.length;
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + dist(dense[i], dense[(i + 1) % N]);
  const total = cum[N];
  // tangents
  const T = dense.map((p, i) => norm(sub(dense[(i + 1) % N], dense[(i - 1 + N) % N])));
  // parallel transport of the up vector, then close the twist error
  const U = new Array(N);
  let up0 = [0, 1, 0]; if (Math.abs(dot(up0, T[0])) > 0.95) up0 = [1, 0, 0];
  U[0] = norm(sub(up0, mul(T[0], dot(up0, T[0]))));
  for (let i = 1; i < N; i++) { let u = sub(U[i - 1], mul(T[i], dot(U[i - 1], T[i]))); U[i] = norm(u); }
  const uEnd = norm(sub(U[N - 1], mul(T[0], dot(U[N - 1], T[0]))));
  const r0 = cross(T[0], U[0]);
  const twist = Math.atan2(dot(uEnd, r0), dot(uEnd, U[0]));      // how far the transported frame ends up rotated about t0 (about r0 axis sense)
  for (let i = 0; i < N; i++) U[i] = norm(rot(U[i], T[i], -twist * (cum[i] / total)));
  // a clean upright start: align the first frame so the track is level where it is flat (up.y >= 0 on average); flip the whole frame if mostly upside down
  let sumY = 0; for (let i = 0; i < N; i++) sumY += U[i][1] * (cum[i + 1] - cum[i]);
  if (sumY < 0) for (let i = 0; i < N; i++) U[i] = mul(U[i], -1);
  // banking from the horizontal turning rate (omega = d yaw / ds, right turn < 0), smoothed
  const bank = o.bank || {}; const gain = bank.gain || 0; const maxB = bank.max === undefined ? 0.8 : bank.max; const win = bank.window || 3.0;
  const roll = new Float64Array(N);
  if (gain) {
    const yaw = new Float64Array(N);
    for (let i = 0; i < N; i++) yaw[i] = Math.atan2(T[i][0], T[i][2]);
    const om = new Float64Array(N);
    const avg = total / N; const hop = Math.max(1, Math.round(1.2 / avg));
    for (let i = 0; i < N; i++) {
      let d = yaw[(i + hop) % N] - yaw[(i - hop + N) % N]; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      om[i] = d / (2 * hop * avg);
    }
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) { const flat = 1 - Math.abs(T[i][1]); raw[i] = clamp(-om[i] * gain, -maxB, maxB) * flat * flat; }
    const w = Math.max(1, Math.round(win / (total / N)));
    for (let i = 0; i < N; i++) { let a = 0; let c = 0; for (let k = -w; k <= w; k++) { const q = 1 - Math.abs(k) / (w + 1); a += raw[(i + k + N) % N] * q; c += q; } roll[i] = a / c; }
  }
  const UB = new Array(N); const R = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = cross(T[i], U[i]);
    // up tilts toward the inside of the turn: positive roll tilts up toward +right
    UB[i] = roll[i] ? norm(add(mul(U[i], Math.cos(roll[i])), mul(r, Math.sin(roll[i])))) : U[i];
    R[i] = cross(T[i], UB[i]);
  }
  // curvature (1/m) per sample
  const curv = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = T[(i - 2 + N) % N]; const c = T[(i + 2) % N]; curv[i] = len(sub(c, a)) / (4 * total / N); }
  const idxAt = (s) => {
    const q = wrap(s, total); let lo = 0; let hi = N - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= q) lo = mid; else hi = mid - 1; }
    return { i: lo, f: (q - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1) };
  };
  const spline = {
    length: total, count: N, ctrl, dense, cum,
    at(s) {
      const { i, f } = idxAt(s); const j = (i + 1) % N;
      const p = [lerp(dense[i][0], dense[j][0], f), lerp(dense[i][1], dense[j][1], f), lerp(dense[i][2], dense[j][2], f)];
      const t = norm([lerp(T[i][0], T[j][0], f), lerp(T[i][1], T[j][1], f), lerp(T[i][2], T[j][2], f)]);
      let u = [lerp(UB[i][0], UB[j][0], f), lerp(UB[i][1], UB[j][1], f), lerp(UB[i][2], UB[j][2], f)];
      u = norm(sub(u, mul(t, dot(u, t))));
      return { p, t, u, r: cross(t, u), s: wrap(s, total) };
    },
    heightAt(s) { const { i, f } = idxAt(s); return lerp(dense[i][1], dense[(i + 1) % N][1], f); },
    curvatureAt(s) { const { i } = idxAt(s); return curv[i]; },
    /** arc lengths for a mesh: a sample whenever maxStep metres or maxAngle radians (turning of the tangent) have passed; ends exactly at the length */
    resample({ maxStep = 2, maxAngle = 0.12, minStep = 0.2 } = {}) {
      const out = [0]; let last = 0; let tLast = T[0];
      for (let i = 1; i < N; i++) {
        const d = cum[i] - last; const a = Math.acos(clamp(dot(tLast, T[i]), -1, 1));
        if (d >= maxStep || (a >= maxAngle && d >= minStep)) { out.push(cum[i]); last = cum[i]; tLast = T[i]; }
      }
      if (total - last < minStep && out.length > 1) out.pop();
      out.push(total);
      return out;
    },
    frames(list) { return list.map((s) => spline.at(s)); },
    /** arc length of the dense sample nearest to point q (control-point lookups for lift / zone limits); from, to restrict the search window (arc lengths) */
    nearestS(q, from = 0, to = Infinity) { let best = 1e9; let bs = 0; for (let i = 0; i < N; i++) { if (cum[i] < from || cum[i] > to) continue; const d = dist(dense[i], q); if (d < best) { best = d; bs = cum[i]; } } return bs; },
    maxHeight() { let m = -1e9; for (const p of dense) m = Math.max(m, p[1]); return m; },
    minHeight() { let m = 1e9; for (const p of dense) m = Math.min(m, p[1]); return m; },
    /** distance from a point to the curve (dense polyline, coarse), for the "stays on the track" test */
    distanceTo(q) { let best = 1e9; for (let i = 0; i < N; i += 2) { const d = dist(dense[i], q); if (d < best) best = d; } return best; },
  };
  return spline;
}

/* ------------------------------------------------------------------------------------------------------------------ sweeps (merged strips)
 * frames: array of { p, t, u, r }.  A point on the section is p + r * lat + u * up. */
const at = (f, lat, up) => [f.p[0] + f.r[0] * lat + f.u[0] * up, f.p[1] + f.r[1] * lat + f.u[1] * up, f.p[2] + f.r[2] * lat + f.u[2] * up];
const colOf = (c, i, a, b) => (typeof c === 'function' ? c(i, a, b) : c);

/** a flat strip between lateral offsets lat0 .. lat1 at height up, along the frames; col may be a function(i) */
export function strip(bucket, frames, lat0, lat1, up, col, up1) {
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i]; const b = frames[i + 1];
    bucket.quad(at(a, lat0, up), at(a, lat1, up1 === undefined ? up : up1), at(b, lat1, up1 === undefined ? up : up1), at(b, lat0, up), colOf(col, i));
  }
}
/** a vertical-ish wall on one side: lateral offset lat, from height y0 to y1 */
export function wall(bucket, frames, lat, y0, y1, col) {
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i]; const b = frames[i + 1];
    bucket.quad(at(a, lat, y0), at(a, lat, y1), at(b, lat, y1), at(b, lat, y0), colOf(col, i));
  }
}
/** a box girder: top, two sides and (optional) bottom.  o: w (width), h (height), y (top height above the frame point, default 0), top / side / bottom colours (or fn(i)), bottom: bool */
export function girder(bucket, frames, o) {
  const hw = o.w / 2; const y1 = o.y || 0; const y0 = y1 - o.h;
  strip(bucket, frames, -hw, hw, y1, o.top);
  wall(bucket, frames, -hw, y0, y1, o.side || o.top);
  wall(bucket, frames, hw, y0, y1, o.side || o.top);
  if (o.bottom) strip(bucket, frames, -hw, hw, y0, o.under || o.side || o.top);
}
/** two rails (thin square beams drawn as ribbons: top + outer side) at lateral +-gauge/2, width w, height h above y */
export function rails(bucket, frames, o) {
  for (const sgn of [-1, 1]) {
    const lat = sgn * o.gauge / 2;
    strip(bucket, frames, lat - o.w / 2, lat + o.w / 2, o.y + o.h, o.col);
    if (o.walls === false) continue;
    wall(bucket, frames, lat + sgn * o.w / 2, o.y, o.y + o.h, o.side || o.col);
    if (o.inner !== false) wall(bucket, frames, lat - sgn * o.w / 2, o.y, o.y + o.h, o.side || o.col);
  }
}
/** a ladder of sleepers: one cross bar every `every` frames, width w (lateral), thickness t (along the track), at height y */
export function sleepers(bucket, frames, o) {
  const every = o.every || 1; const hw = o.w / 2;
  for (let i = 0; i + 1 < frames.length; i += every) {
    const a = frames[i]; const b = frames[Math.min(i + 1, frames.length - 1)];
    const m = { p: a.p, t: a.t, u: a.u, r: a.r };
    const d = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]; const L = len(d) || 1; const k = Math.min(1, (o.t || 0.15) / L);
    const e = { p: add(a.p, mul(d, k)), t: a.t, u: a.u, r: a.r };
    bucket.quad(at(m, -hw, o.y), at(m, hw, o.y), at(e, hw, o.y), at(e, -hw, o.y), colOf(o.col, i));
    if (o.h) { bucket.quad(at(m, -hw, o.y - o.h), at(m, -hw, o.y), at(e, -hw, o.y), at(e, -hw, o.y - o.h), colOf(o.side || o.col, i)); bucket.quad(at(m, hw, o.y - o.h), at(m, hw, o.y), at(e, hw, o.y), at(e, hw, o.y - o.h), colOf(o.side || o.col, i)); }
  }
}
/** white rhombi on the two side faces of a girder (the "diamond pattern"): one per frame pair */
export function diamonds(bucket, frames, o) {
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i]; const b = frames[i + 1];
    const k = o.inset === undefined ? 0.03 : o.inset;
    for (const sgn of [-1, 1]) {
      const lat = sgn * (o.w / 2 + k);
      const ym = o.y - o.h / 2; const y1 = o.y - o.h * 0.08; const y0 = o.y - o.h * 0.92;
      const mid = { p: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2], t: a.t, u: a.u, r: a.r };
      bucket.quad(at(a, lat, ym), at(mid, lat, y1), at(b, lat, ym), at(mid, lat, y0), colOf(o.col, i));
    }
  }
}
/** white rhombi on the top face of a girder (the diamond pattern seen from above): o.w width, o.y top height, rhombus spans 70 % of the width */
export function diamondsTop(bucket, frames, o) {
  const k = o.inset === undefined ? 0.02 : o.inset; const hw = (o.w / 2) * 0.72;
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i]; const b = frames[i + 1];
    const mid = { p: [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2], t: a.t, u: a.u, r: a.r };
    bucket.quad(at(a, 0, o.y + k), at(mid, -hw, o.y + k), at(b, 0, o.y + k), at(mid, hw, o.y + k), colOf(o.col, i));
  }
}
/** a lamp ribbon along one lateral offset, split into runs of `run` frames; returns [{ s, n, k }] vertex ranges (bucket must expose its builder `b`) for the LED chase */
export function ledRuns(bucket, frames, lat, up, w, run, col) {
  const out = []; const B = bucket.b;
  for (let i = 0; i + 1 < frames.length; i += run) {
    const n0 = B.count; const e = Math.min(frames.length - 1, i + run);
    for (let j = i; j < e; j++) { const a = frames[j]; const b = frames[j + 1]; bucket.quad(at(a, lat - w / 2, up), at(a, lat + w / 2, up), at(b, lat + w / 2, up), at(b, lat - w / 2, up), col); }
    out.push({ s: n0, n: B.count - n0, k: out.length });
  }
  return out;
}

/** like ledRuns but a vertical band on the side wall at lateral offset lat between heights y0 and y1 */
export function ledWallRuns(bucket, frames, lat, y0, y1, run, col) {
  const out = []; const B = bucket.b;
  for (let i = 0; i + 1 < frames.length; i += run) {
    const n0 = B.count; const e = Math.min(frames.length - 1, i + run);
    for (let j = i; j < e; j++) { const a = frames[j]; const b = frames[j + 1]; bucket.quad(at(a, lat, y0), at(a, lat, y1), at(b, lat, y1), at(b, lat, y0), col); }
    out.push({ s: n0, n: B.count - n0, k: out.length });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ run profile */
/** cfg: lifts [[s0, s1, v]], vStation, aAccel, aBrake, eta (energy efficiency), aLat (hairpin limit), vMax, vMin, dwell (s), g */
export function makeRun(sp, cfg) {
  const L = sp.length; const g = cfg.g || 9.81; const eta = cfg.eta === undefined ? 0.8 : cfg.eta;
  const lifts = cfg.lifts || []; const vSt = cfg.vStation || 1.4; const aA = cfg.aAccel || 1.5; const aB = cfg.aBrake || 4;
  const vMax = cfg.vMax || 24; const vMin = cfg.vMin || 1.6; const aLat = cfg.aLat || 9; const dwell = cfg.dwell === undefined ? 6 : cfg.dwell;
  const lastLiftEnd = lifts.length ? Math.max(...lifts.map((l) => l[1])) : 0; const firstLift = lifts.length ? Math.min(...lifts.map((l) => l[0])) : 0;
  const vLift0 = lifts.length ? lifts[0][2] : vSt;
  const H = cfg.crestY !== undefined ? cfg.crestY : sp.heightAt(lastLiftEnd);
  const speedAt = (s) => {
    if (cfg.vConst) return cfg.vConst;
    for (const l of lifts) if (s >= l[0] && s < l[1]) return l[2];
    let v;
    if (s < firstLift) v = Math.min(Math.sqrt(vSt * vSt + 2 * aA * s), vLift0);
    else {
      const y = sp.heightAt(s); const e = vLift0 * vLift0 + 2 * g * eta * (H - y);
      v = Math.min(Math.sqrt(Math.max(e, 0)), vMax, Math.sqrt(vSt * vSt + 2 * aB * Math.max(0, L - s)));
      const k = sp.curvatureAt(s); if (k > 1e-4) v = Math.min(v, Math.sqrt(aLat / k));
    }
    return Math.max(vMin, v);
  };
  // integrate time over arc length
  const ds = 0.25; const ts = [0]; const ss = [0]; let t = 0;
  for (let s = 0; s < L - 1e-9; s += ds) { const s1 = Math.min(L, s + ds); const v = speedAt((s + s1) / 2); t += (s1 - s) / v; ts.push(t); ss.push(s1); }
  const run = t;
  const period = run + dwell;
  const sAtRaw = (tt) => {
    const q = wrap(tt, period);
    if (q < dwell) return 0;
    const u = q - dwell; let lo = 0; let hi = ts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ts[mid] <= u) lo = mid; else hi = mid - 1; }
    const f = lo + 1 < ts.length ? (u - ts[lo]) / ((ts[lo + 1] - ts[lo]) || 1) : 0;
    return lo + 1 < ts.length ? lerp(ss[lo], ss[lo + 1], f) : L;
  };
  return {
    period, runTime: run, dwell, length: L, speedAt,
    /** arc length of a train that is `shift` seconds ahead of the clock */
    sAt: (tt, shift = 0) => sAtRaw(tt + shift),
    /** speed (m/s) of the same train */
    vAt: (tt, shift = 0) => { const q = wrap(tt + shift, period); return q < dwell ? 0 : speedAt(sAtRaw(tt + shift)); },
  };
}

/* ------------------------------------------------------------------------------------------------------------------ cars */
/** matrix that puts a car modelled with +z forward, +y up, origin on the track centre line, on the frame f (+x = left of travel); lift = metres above the track point */
export function carMatrix(T, f, lift, out) {
  const m = out || new T.Matrix4();
  const l = cross(f.u, f.t);   // left = up x forward
  m.set(l[0], f.u[0], f.t[0], f.p[0] + f.u[0] * lift,
        l[1], f.u[1], f.t[1], f.p[1] + f.u[1] * lift,
        l[2], f.u[2], f.t[2], f.p[2] + f.u[2] * lift,
        0, 0, 0, 1);
  return m;
}
/** the supports: [{ s, frame }] every `every` metres where the track is at least minY above the ground */
export function supportPoints(sp, every, minY, skip) {
  const out = [];
  for (let s = every / 2; s < sp.length; s += every) { const f = sp.at(s); if (f.p[1] < minY) continue; if (skip && skip(f)) continue; out.push({ s, f }); }
  return out;
}
export { sub as v3sub, add as v3add, mul as v3mul, cross as v3cross, norm as v3norm, len as v3len, dot as v3dot };

/* ------------------------------------------------------------------------------------------------------------------ the shared model wrapper */
import { finishModel } from './big-kit.js';

/** Builds a track-bound ride (coaster, flume, ghost train) from a spec and returns the model Group (contract of big-kit.finishModel).
 *  spec: { id, T, K, quality, footprint, height, lodDistance, sp (spline), run (makeRun), trains: [{ cars, spacing, shift (s), lift, hide(s, k) -> bool }],
 *          buildStatic(b, near) -> handles, buildCar(b, near, trainIndex), chase(K, geo, handles, t, k), extras(near, root) -> { update(t, dt, k, s0), meshes } | null,
 *          carRadius (bounds of the cars), extra (userData assignments) }
 *  Every train follows the spline by arc length: car j of train i sits at run.sAt(t, shift_i) - j * spacing.
 *  A train with `custom(j, t, matrix, k) -> bool` is a free CPU-skinned part instead (splash droplets, smoke): it writes its own matrix, false hides it. */
export function buildTrackRide(spec) {
  const { T, K, sp, run } = spec; const wantNear = spec.quality !== 'low';
  const nearG = wantNear ? new T.Group() : null; const farG = new T.Group();
  const parts = {};
  const mats = new T.Matrix4();
  const assemble = (detail, root) => {
    const near = detail === 'near'; const out = {};
    { const b = K.builder(); out.handles = spec.buildStatic(b, near) || {}; const m = b.mesh(spec.id + '-static-' + detail); root.add(m); out.static = m;
      if (out.handles.lamps) out.lampFx = K.lampDynamic(m.geometry); }
    { const b = K.builder(); const ranges = []; const trains = spec.trains;
      trains.forEach((tr, ti) => { for (let j = 0; j < tr.cars; j++) { const v0 = b.count; spec.buildCar(b, near, ti, j); ranges.push({ r: [v0, b.count - v0], ti, j }); } });
      const m = b.mesh(spec.id + '-cars-' + detail); root.add(m); out.cars = m;
      out.dyn = K.dynamic(m.geometry, ranges.map((q) => q.r), spec.carRadius || 40, [0, (spec.height || 20) / 2, 0]); out.carIdx = ranges.map((q) => [q.ti, q.j]); }
    if (spec.extras) out.extras = spec.extras(near, root);
    return out;
  };
  if (wantNear) parts.near = assemble('near', nearG);
  parts.far = assemble('far', farG);
  const frame = (tt, ti, j) => {
    const tr = spec.trains[ti]; const s = run.sAt(tt, tr.shift) - j * tr.spacing;
    return { s, f: sp.at(s) };
  };
  const update = (p, t, dt, k) => {
    for (let q = 0; q < p.carIdx.length; q++) {
      const [ti, j] = p.carIdx[q]; const tr = spec.trains[ti];
      if (tr.custom) { if (!tr.custom(j, t, mats, k)) mats.makeScale(0, 0, 0); p.dyn.set(q, mats); continue; }
      const fr = frame(t, ti, j);
      if (tr.hide && tr.hide(fr.s, k, j, fr.f)) { mats.makeScale(0, 0, 0); } else carMatrix(T, fr.f, tr.lift || 0, mats);
      if (tr.after) tr.after(mats, fr, t, j);
      p.dyn.set(q, mats);
    }
    p.dyn.commit();
    if (p.extras && p.extras.update) p.extras.update(t, dt, k);
    if (spec.chase && p.handles.lamps && (p.chaseT === undefined || Math.abs(t - p.chaseT) > 0.05)) { p.chaseT = t; spec.chase(K, p.static.geometry, p.handles, t, k); p.lampFx.commit(); }
  };
  const group = finishModel(T, K, {
    id: spec.id, near: nearG, far: farG, footprint: spec.footprint, height: spec.height, lodDistance: spec.lodDistance || 85,
    animateNear: (t, dt, k) => update(parts.near, t, dt, k), animateFar: (t, dt, k) => update(parts.far, t, dt, k), onNight: () => {},
  });
  const ud = group.userData;
  ud.parts = parts; ud.cycle = run ? run.period : spec.cycle; ud.tier = { look: spec.look, level: spec.level, quality: spec.quality };
  if (sp && run) {
    ud.track = sp; ud.run = run;
    ud.phaseAt = (t) => { const s = run.sAt(t); const f = sp.at(s); return { s, v: run.vAt(t), p: f.p, t: f.t, y: f.p[1] }; };
    /** world-space ride-along camera for W6: eye of the first seat of train 0's lead car at time t (cars ahead of the clock by trains[0].shift) */
    ud.ridePath = (t, o = {}) => {
      const tr = spec.trains[o.train || 0]; const s = run.sAt(t, tr.shift) - (o.car || 0) * tr.spacing; const f = sp.at(s);
      group.updateMatrixWorld(true); const m = group.matrixWorld;
      const seat = o.eye || spec.eyeOffset || [0, 1.15, 0.3];
      const local = new T.Vector3(f.p[0] + f.u[0] * seat[1] + f.t[0] * seat[2], f.p[1] + f.u[1] * seat[1] + f.t[1] * seat[2], f.p[2] + f.u[2] * seat[1] + f.t[2] * seat[2]);
      const q = new T.Quaternion().setFromRotationMatrix(m);
      const world = (v) => v.clone().applyMatrix4(m);
      return { position: world(local), forward: new T.Vector3(f.t[0], f.t[1], f.t[2]).applyQuaternion(q), up: new T.Vector3(f.u[0], f.u[1], f.u[2]).applyQuaternion(q), speed: run.vAt(t, tr.shift), s, length: sp.length, period: run.period };
    };
    ud.carFrames = (t) => spec.trains.filter((tr) => !tr.custom).map((tr, ti) => Array.from({ length: tr.cars }, (_, j) => frame(t, ti, j)));
  }
  Object.assign(ud, spec.extra || {});
  return group;
}
