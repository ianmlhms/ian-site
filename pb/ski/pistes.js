/* The selectable pistes of a resort as run lines (top -> bottom, smoothed, 10 m samples from the bake): projection of the skier onto a line,
 * points along it, checkpoints, slalom gates, and which pistes continue from the bottom of another. Pure (no THREE, no DOM). */
import { PLAY, DIFF } from './config.js';

const PROJECT_SLACK = 25, PROJECT_JUMP = 0.08;      // m along the line free from the hint, then m of distance per m of jump

/** R8b: an OSM-chained line that runs out a dead end and straight back along itself (Zermatt cieloalto-cervinia: 25 m up a spur and
 *  back down; 14 such spurs in the five resorts) loses the spur: at a reversal (> ~140 deg), the points out and back that lie within
 *  SPUR_GAP m of each other for at least two samples are cut. A hairpin's legs part at once and are kept. Returns a NEW array. */
const SPUR_COS = -0.77, SPUR_GAP = 8;
export function dropSpurs(line) {
  let L = Array.from(line);
  for (let guard = 0; guard < 20; guard++) {
    const m = L.length / 2;
    let cut = null;
    for (let k = 1; k < m - 1 && !cut; k++) {
      const ax = L[2 * k] - L[2 * k - 2], az = L[2 * k + 1] - L[2 * k - 1], bx = L[2 * k + 2] - L[2 * k], bz = L[2 * k + 3] - L[2 * k + 1];
      if ((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1) > SPUR_COS) continue;
      let j = 1;
      while (k - j - 1 >= 0 && k + j + 1 < m && Math.hypot(L[2 * (k - j - 1)] - L[2 * (k + j + 1)], L[2 * (k - j - 1) + 1] - L[2 * (k + j + 1) + 1]) < SPUR_GAP) j++;
      if (j >= 2) cut = [k - j + 1, k + j - 1];
    }
    if (!cut) break;
    L = [...L.slice(0, 2 * cut[0]), ...L.slice(2 * (cut[1] + 1))];
  }
  return L;
}

export function createPiste(src) {
  const line = dropSpurs(src.line);
  const n = line.length / 2;
  const x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = line[2 * i]; z[i] = line[2 * i + 1]; if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
  const length = s[n - 1];
  const halfWidth = src.hw || DIFF[src.diff].width / 2;

  /** Point and unit direction at arc length t (clamped). */
  function at(t, out = {}) {
    const tt = Math.min(length, Math.max(0, t));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= tt) lo = m; else hi = m; }
    const seg = s[hi] - s[lo] || 1;
    const k = (tt - s[lo]) / seg;
    const dx = x[hi] - x[lo], dz = z[hi] - z[lo], len = Math.hypot(dx, dz) || 1;
    out.x = x[lo] + dx * k; out.z = z[lo] + dz * k; out.dx = dx / len; out.dz = dz / len; out.s = tt;
    return out;
  }

  /** Projection of (px, pz): { s, off (m, + = right of travel), dist }. `hint` (a previous s) limits the search to +-window m (no jumping to a far bend). */
  function project(px, pz, hint = null, window = 260, out = {}) {
    let i0 = 0, i1 = n - 2;
    if (hint !== null) {
      while (i0 < n - 2 && s[i0 + 1] < hint - window) i0++;
      i1 = i0;
      while (i1 < n - 2 && s[i1] < hint + window) i1++;
    }
    let best = Infinity;
    for (let i = i0; i <= i1; i++) {
      const ax = x[i], az = z[i], dx = x[i + 1] - ax, dz = z[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      let t = ((px - ax) * dx + (pz - az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qz = az + dz * t;
      const d = Math.hypot(px - qx, pz - qz);
      // R7-C2: with a hint, stay on the stretch the skier is on: a line that loops back close to itself (OSM ways chained into a
      // hairpin or a loop: Zermatt rotenboden, Arlberg riffel / waldabfahrt ...) must not snap him 100 m back along it
      const cost = hint === null ? d : d + Math.max(0, Math.abs(s[i] + t * Math.sqrt(L2) - hint) - PROJECT_SLACK) * PROJECT_JUMP;
      if (cost < best) {
        best = cost;
        const L = Math.sqrt(L2);
        out.s = s[i] + t * L;
        out.off = ((px - ax) * -dz + (pz - az) * dx) / L;     // + = right of travel (x east, z south: right of (dx, dz) is (-dz, dx))
        out.dist = d;
      }
    }
    return out;
  }

  /** Checkpoints every PLAY.checkpointEvery m (not the first 60 m, always one 40 m before the end). */
  function checkpoints() {
    const list = [];
    for (let t = PLAY.checkpointEvery; t < length - 80; t += PLAY.checkpointEvery) list.push(t);
    list.push(Math.max(0, length - 40));
    return list;
  }

  /** Slalom gates: every PLAY.slalomGap m from 70 m after the start to 60 m before the end, alternating left / right of the line,
   *  each { s, side (-1 left, +1 right), x, z, dx, dz } with (x, z) the inner pole. Deterministic. */
  function slalomGates() {
    if (!src.slalom) return [];
    const gates = [];
    let side = 1;
    const p = {};
    for (let t = 70; t < length - 60; t += PLAY.slalomGap) {
      at(t, p);
      const off = side * Math.min(PLAY.slalomHalfWidth + 2, halfWidth * 0.35);
      gates.push({ s: t, side, x: p.x - p.dz * off, z: p.z + p.dx * off, dx: p.dx, dz: p.dz, off });
      side = -side;
    }
    return gates;
  }

  return { id: src.id, name: src.name, ref: src.ref, diff: src.diff, src, length, halfWidth, n, x, z, s, at, project, checkpoints, slalomGates, top: { x: x[0], z: z[0] }, bottom: { x: x[n - 1], z: z[n - 1] } };
}

/** R8g: a grid over the segments of some piste lines (or a stretch of one: { piste, s0, s1 }), for "how far is the nearest line from
 *  (x, z)" without scanning every line. clearance(x, z, r, skip) = min over the indexed lines within r m of (distance to the line -
 *  that piste's half width); Infinity when none is that near. Pure. */
export function createLineIndex(items, cell = 40) {
  const grid = new Map();
  const key = (i, j) => i * 65536 + j;
  for (const it of items) {
    const p = it.piste || it, s0 = it.s0 ?? 0, s1 = it.s1 ?? p.length;
    for (let i = 0; i + 1 < p.n; i++) {
      if (p.s[i + 1] < s0 || p.s[i] > s1) continue;
      // the indexed stretch: the segment clipped to [s0, s1]
      const L = p.s[i + 1] - p.s[i] || 1e-9, t0 = Math.max(0, (s0 - p.s[i]) / L), t1 = Math.min(1, (s1 - p.s[i]) / L);
      const ax = p.x[i] + (p.x[i + 1] - p.x[i]) * t0, az = p.z[i] + (p.z[i + 1] - p.z[i]) * t0;
      const bx = p.x[i] + (p.x[i + 1] - p.x[i]) * t1, bz = p.z[i] + (p.z[i + 1] - p.z[i]) * t1;
      const seg = { p, ax, az, bx, bz, hw: p.halfWidth };
      for (let gi = Math.floor(Math.min(ax, bx) / cell); gi <= Math.floor(Math.max(ax, bx) / cell); gi++) {
        for (let gj = Math.floor(Math.min(az, bz) / cell); gj <= Math.floor(Math.max(az, bz) / cell); gj++) {
          const k = key(gi, gj);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  const segDist = (q, x, z) => {
    const dx = q.bx - q.ax, dz = q.bz - q.az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - q.ax) * dx + (z - q.az) * dz) / L2));
    return Math.hypot(x - q.ax - dx * t, z - q.az - dz * t);
  };
  /** Every indexed segment within r m of (x, z) (cb(seg, dist)). */
  function near(x, z, r, cb) {
    const seen = new Set();
    for (let gi = Math.floor((x - r) / cell); gi <= Math.floor((x + r) / cell); gi++) {
      for (let gj = Math.floor((z - r) / cell); gj <= Math.floor((z + r) / cell); gj++) {
        for (const q of grid.get(key(gi, gj)) || []) {
          if (seen.has(q)) continue;
          seen.add(q);
          const d = segDist(q, x, z);
          if (d <= r) cb(q, d);
        }
      }
    }
  }
  function clearance(x, z, r = 80, skip = null) {
    let best = Infinity;
    near(x, z, r, (q, d) => { if (q.p !== skip) best = Math.min(best, d - q.hw); });
    return best;
  }
  /** The distance to the nearest indexed line (no half width). */
  function distance(x, z, r = 80) {
    let best = Infinity;
    near(x, z, r, (q, d) => { best = Math.min(best, d); });
    return best;
  }
  return { near, clearance, distance };
}

/** All pistes of a resort plus the "continues into" graph. */
export function createPisteSet(resort) {
  const list = resort.pistes.map(createPiste);
  const byId = new Map(list.map((p) => [p.id, p]));
  const tmp = {};
  /** Pistes that start near the bottom of `piste` (or whose top lies on its last third), nearest first. */
  function continuations(piste) {
    const out = [];
    for (const q of list) {
      if (q === piste) continue;
      const d = Math.hypot(q.top.x - piste.bottom.x, q.top.z - piste.bottom.z);
      if (d < PLAY.freeRideNextRadius) out.push({ piste: q, d });
      else {
        piste.project(q.top.x, q.top.z, null, 0, tmp);
        if (tmp.dist < 40 && tmp.s > piste.length * 0.66 && tmp.s < piste.length - 10) out.push({ piste: q, d: piste.length - tmp.s });
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.piste);
  }
  /** The nearest piste (and its projection) to a point, or null beyond maxDist. */
  function nearest(px, pz, maxDist = 400) {
    let best = null;
    for (const p of list) {
      if (px < Math.min(p.top.x, p.bottom.x) - 2000 || px > Math.max(p.top.x, p.bottom.x) + 2000) continue;
      const r = p.project(px, pz, null, 0, {});
      if (r.dist < maxDist && (!best || r.dist < best.proj.dist)) best = { piste: p, proj: r };
    }
    return best;
  }
  return { list, byId, continuations, nearest };
}
