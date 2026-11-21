/* The selectable pistes of a resort as run lines (top -> bottom, smoothed, 10 m samples from the bake): projection of the skier onto a line,
 * points along it, checkpoints, slalom gates, and which pistes continue from the bottom of another. Pure (no THREE, no DOM). */
import { PLAY, DIFF } from './config.js';

export function createPiste(src) {
  const n = src.line.length / 2;
  const x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = src.line[2 * i]; z[i] = src.line[2 * i + 1]; if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
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
      if (d < best) {
        best = d;
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
