/* Kart Lëtzebuerg — track geometry.
 * A track definition is a closed polyline of waypoints in metres (x east, z south, y up) which gets rounded by tangent-circle fillets
 * (street circuits) or a centripetal Catmull-Rom spline (free-form fantasy tracks), resampled every ~2 m and decorated with per-sample
 * data: tangent, half width, wall margins, banking, height, curvature, a racing line and a safe-speed profile for the bots.
 * Convention: heading h gives forward = (sin h, cos h); the RIGHT normal is (-tz, tx); lateral offset d > 0 means right of the centre line.
 * Nothing in here touches THREE, so tools can run it in node. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const KL = root.KL;
  const { clamp, lerp, wrapAngle } = KL;
  const STEP = 2;           // sample spacing in metres
  const GRID = 16;          // spatial hash cell size
  const SEARCH = 26;        // samples searched around the hint (+-52 m)

  KL.tracks = KL.tracks || {};
  KL.registerTrack = (def) => { KL.tracks[def.id] = def; };

  /* ---------- path construction ---------- */
  function filletPath(wps, closed, defaultR) {
    const n = wps.length, out = [], mid = new Array(n).fill(0);
    const get = (i) => wps[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
      const b = get(i);
      if (!closed && (i === 0 || i === n - 1)) { out.push({ x: b.x, z: b.z }); mid[i] = out.length - 1; continue; }
      const a = get(i - 1), c = get(i + 1);
      let d1x = b.x - a.x, d1z = b.z - a.z; const l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
      let d2x = c.x - b.x, d2z = c.z - b.z; const l2 = Math.hypot(d2x, d2z) || 1; d2x /= l2; d2z /= l2;
      const cross = d1x * d2z - d1z * d2x, dot = d1x * d2x + d1z * d2z;
      const theta = Math.atan2(Math.abs(cross), dot);          // turning angle
      if (theta < 0.02) { out.push({ x: b.x, z: b.z }); mid[i] = out.length - 1; continue; }
      const r0 = b.r != null ? b.r : defaultR;
      const half = Math.tan(theta / 2);
      let tl = Math.min(r0 * half, 0.47 * Math.min(l1, l2));
      const r = tl / half;
      const p1x = b.x - d1x * tl, p1z = b.z - d1z * tl;
      const sg = cross > 0 ? 1 : -1;                           // +1: turning towards (+z rotated) side
      // centre: p1 + normal * r, normal = rotate d1 by sg*90deg
      const nx = -d1z * sg, nz = d1x * sg;
      const cx = p1x + nx * r, cz = p1z + nz * r;
      const a0 = Math.atan2(p1z - cz, p1x - cx);
      const steps = Math.max(2, Math.ceil((r * theta) / 1.5));
      for (let k = 0; k <= steps; k++) {
        const a1 = a0 + sg * theta * (k / steps);
        out.push({ x: cx + Math.cos(a1) * r, z: cz + Math.sin(a1) * r });
        if (k === Math.floor(steps / 2)) mid[i] = out.length - 1;
      }
    }
    return { pts: out, mid };
  }

  function splinePath(wps, closed) {
    const n = wps.length, out = [], mid = [];
    const get = (i) => (closed ? wps[((i % n) + n) % n] : wps[clamp(i, 0, n - 1)]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const d = (a, b) => Math.pow(Math.hypot(a.x - b.x, a.z - b.z), 0.5) || 1e-3;
      const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      const len = Math.hypot(p2.x - p1.x, p2.z - p1.z), steps = Math.max(4, Math.ceil(len / 2));
      mid[i] = out.length;
      for (let k = 0; k < steps; k++) {
        const t = lerp(t1, t2, k / steps);
        const ev = (key) => {
          const A1 = ((t1 - t) * p0[key] + (t - t0) * p1[key]) / (t1 - t0);
          const A2 = ((t2 - t) * p1[key] + (t - t1) * p2[key]) / (t2 - t1);
          const A3 = ((t3 - t) * p2[key] + (t - t2) * p3[key]) / (t3 - t2);
          const B1 = ((t2 - t) * A1 + (t - t0) * A2) / (t2 - t0);
          const B2 = ((t3 - t) * A2 + (t - t1) * A3) / (t3 - t1);
          return ((t2 - t) * B1 + (t - t1) * B2) / (t2 - t1);
        };
        out.push({ x: ev('x'), z: ev('z') });
      }
    }
    if (!closed) { out.push({ x: wps[n - 1].x, z: wps[n - 1].z }); mid[n - 1] = out.length - 1; }
    return { pts: out, mid };
  }

  function cumulative(pts, closed) {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = closed ? c[c.length - 1] + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) : c[c.length - 1];
    return { c, total };
  }

  function movingAverage(arr, w, closed) {
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = -w; j <= w; j++) {
        let q = i + j;
        if (closed) q = ((q % n) + n) % n; else q = clamp(q, 0, n - 1);
        s += arr[q]; k++;
      }
      out[i] = s / k;
    }
    return out;
  }

  /* attribute interpolation between waypoint stations (closed loop aware) */
  function stationLookup(stations, total, closed) {
    const n = stations.length;
    return function (s) {
      let k = n - 1;
      for (let i = 0; i < n; i++) if (stations[i] > s) { k = i - 1; break; }
      let a, b, sa, sb;
      if (k < 0) { a = n - 1; b = 0; sa = stations[n - 1] - total; sb = stations[0]; }
      else if (k >= n - 1) { a = n - 1; b = closed ? 0 : n - 1; sa = stations[n - 1]; sb = closed ? stations[0] + total : stations[n - 1] + 1; }
      else { a = k; b = k + 1; sa = stations[k]; sb = stations[k + 1]; }
      const t = sb > sa ? clamp((s - sa) / (sb - sa), 0, 1) : 0;
      return { a, b, t };
    };
  }
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  KL.buildTrack = function buildTrack(def) {
    const closed = def.closed !== false;
    const defaults = { hw: def.hw || 9.5, wl: def.wl != null ? def.wl : 3, wr: def.wr != null ? def.wr : 3, y: 0, bank: 0 };
    const wps = def.pts.map((p) => {
      const o = p[2] || {};
      return { x: p[0], z: p[1], r: o.r, y: o.y != null ? o.y : defaults.y, hw: o.hw != null ? o.hw : defaults.hw, wl: o.wl != null ? o.wl : defaults.wl,
        wr: o.wr != null ? o.wr : defaults.wr, bank: o.bank != null ? o.bank : defaults.bank };
    });
    const path = def.mode === 'spline' ? splinePath(wps, closed) : filletPath(wps, closed, def.r || 28);
    const { c, total } = cumulative(path.pts, closed);
    const N = closed ? Math.max(8, Math.round(total / STEP)) : Math.round(total / STEP) + 1;
    const step = closed ? total / N : total / (N - 1);
    const stations = path.mid.map((m) => c[m]);
    // resample the polyline at uniform arc length
    const X = new Float32Array(N), Z = new Float32Array(N);
    {
      let seg = 0;
      const P = path.pts, M = P.length;
      for (let i = 0; i < N; i++) {
        const s = i * step;
        while (seg < M - 1 && c[seg + 1] <= s) seg++;
        const a = P[seg], b = P[(seg + 1) % M];
        const sl = (seg + 1 < M ? c[seg + 1] : total) - c[seg];
        const t = sl > 0 ? clamp((s - c[seg]) / sl, 0, 1) : 0;
        X[i] = lerp(a.x, b.x, t); Z[i] = lerp(a.z, b.z, t);
      }
    }
    const look = stationLookup(stations, total, closed);
    const nw = wps.length, wrapW = (i) => (closed ? ((i % nw) + nw) % nw : clamp(i, 0, nw - 1));
    let Y = new Float32Array(N), HW = new Float32Array(N), WL = new Float32Array(N), WR = new Float32Array(N), BANK = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const { a, b, t } = look(i * step);
      const g = (key, i0) => wps[wrapW(i0)][key];
      for (const [arr, key, cr] of [[Y, 'y', true], [BANK, 'bank', true], [HW, 'hw', false], [WL, 'wl', false], [WR, 'wr', false]]) {
        arr[i] = cr ? catmull(g(key, a - 1), g(key, a), g(key, b), g(key, b + 1), t) : lerp(g(key, a), g(key, b), t);
      }
    }
    Y = movingAverage(Y, 2, closed); HW = movingAverage(HW, 4, closed); WL = movingAverage(WL, 4, closed); WR = movingAverage(WR, 4, closed);
    BANK = movingAverage(BANK, 3, closed);
    // tangents / normals / heading / curvature
    const TX = new Float32Array(N), TZ = new Float32Array(N), H = new Float32Array(N), K = new Float32Array(N), S = new Float32Array(N);
    const idx = (i) => (closed ? ((i % N) + N) % N : clamp(i, 0, N - 1));
    for (let i = 0; i < N; i++) {
      const a = idx(i - 1), b = idx(i + 1);
      let dx = X[b] - X[a], dz = Z[b] - Z[a]; const l = Math.hypot(dx, dz) || 1;
      TX[i] = dx / l; TZ[i] = dz / l; H[i] = Math.atan2(TX[i], TZ[i]); S[i] = i * step;
    }
    for (let i = 0; i < N; i++) K[i] = wrapAngle(H[idx(i + 1)] - H[idx(i - 1)]) / (2 * step);
    const Ks = movingAverage(K, 2, closed);
    // zones (named ranges between waypoint indices)
    const zones = (def.zones || []).map((z) => ({ ...z, s0: stations[z.a], s1: stations[z.b] }));
    const ZONE = new Int16Array(N).fill(-1);
    zones.forEach((z, zi) => {
      for (let i = 0; i < N; i++) {
        const s = i * step;
        const inside = z.s0 <= z.s1 ? s >= z.s0 && s <= z.s1 : s >= z.s0 || s <= z.s1;
        if (inside) ZONE[i] = zi;
      }
    });
    let minY = 1e9; for (let i = 0; i < N; i++) if (Y[i] < minY) minY = Y[i];
    const track = {
      minY, id: def.id, def, closed, N, step, length: total, X, Y, Z, TX, TZ, H, K: Ks, S, HW, WL, WR, BANK, ZONE, zones, stations,
      idx, wps,
    };
    // spatial hash for global searches
    const grid = new Map();
    const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    for (let i = 0; i < N; i++) {
      const reach = Math.ceil((HW[i] + WL[i] + WR[i] + 6) / GRID);
      const cx0 = Math.floor(X[i] / GRID), cz0 = Math.floor(Z[i] / GRID);
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        const k = key(cx0 + a, cz0 + b);
        let arr = grid.get(k); if (!arr) grid.set(k, (arr = []));
        if (arr[arr.length - 1] !== i) arr.push(i);
      }
    }
    track.grid = grid; track.gridKey = key;

    /* closest point on the centre line. hint: sample index near the kart (continuity), py: current height (to keep overpasses apart) */
    track.project = function project(x, z, hint, py, out) {
      out = out || {};
      let best = -1, bestCost = 1e18;
      const test = (i, spanLimit) => {
        const i2 = idx(i + 1);
        const ax = X[i], az = Z[i], bx = X[i2], bz = Z[i2];
        const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz || 1;
        const t = clamp(((x - ax) * abx + (z - az) * abz) / l2, 0, 1);
        const cx = ax + abx * t, cz = az + abz * t, dd = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        let cost = dd;
        if (py != null) { const cy = lerp(Y[i], Y[i2], t); const dy = Math.abs(py - cy); if (dy > 3) cost += (dy - 3) * (dy - 3) * 12; }
        if (cost < bestCost) { bestCost = cost; best = i; out.f = t; }
      };
      let usedHint = false;
      if (hint != null && hint >= 0) {
        usedHint = true;
        for (let k = -SEARCH; k <= SEARCH; k++) { const i = hint + k; if (!closed && (i < 0 || i >= N - 1)) continue; test(idx(i)); }
        const wmax = HW[best] + Math.max(WL[best], WR[best]) + 14;
        if (best < 0 || bestCost > wmax * wmax) usedHint = false;
      }
      if (!usedHint) {
        best = -1; bestCost = 1e18;
        const list = grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID)));
        if (list) for (const i of list) { if (closed || i < N - 1) test(i); }
        if (best < 0) for (let i = 0; i < (closed ? N : N - 1); i++) test(i);   // far away: brute force
      }
      const i = best, i2 = idx(i + 1), t = out.f;
      const cx = lerp(X[i], X[i2], t), cz = lerp(Z[i], Z[i2], t);
      let tx = lerp(TX[i], TX[i2], t), tz = lerp(TZ[i], TZ[i2], t); const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const d = (x - cx) * -tz + (z - cz) * tx;            // signed lateral offset, right positive
      const hw = lerp(HW[i], HW[i2], t), wl = lerp(WL[i], WL[i2], t), wr = lerp(WR[i], WR[i2], t);
      const cy = lerp(Y[i], Y[i2], t), bank = lerp(BANK[i], BANK[i2], t);
      out.i = i; out.cx = cx; out.cz = cz; out.cy = cy; out.tx = tx; out.tz = tz; out.d = d; out.hw = hw; out.wl = wl; out.wr = wr;
      out.y = cy + Math.tan(bank) * clamp(d, -hw, hw);      // surface height (banking only on the tarmac)
      out.s = lerp(S[i], S[i] + step, t); out.bank = bank; out.zone = ZONE[i];
      return out;
    };
    track.at = function at(s, d, out) {            // world position at distance s along the line, lateral offset d
      out = out || {};
      const L = total;
      s = closed ? ((s % L) + L) % L : clamp(s, 0, L);
      const f = s / step, i = Math.floor(f) % N, i2 = idx(i + 1), t = f - Math.floor(f);
      let tx = lerp(TX[i], TX[i2], t), tz = lerp(TZ[i], TZ[i2], t); const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const hd = d || 0;
      out.x = lerp(X[i], X[i2], t) + -tz * hd; out.z = lerp(Z[i], Z[i2], t) + tx * hd;
      out.y = lerp(Y[i], Y[i2], t) + Math.tan(lerp(BANK[i], BANK[i2], t)) * hd;
      out.h = Math.atan2(tx, tz); out.tx = tx; out.tz = tz; out.i = i; out.hw = lerp(HW[i], HW[i2], t);
      return out;
    };
    track.startGrid = function (slot) {
      const row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1;
      const s = -(7 + row * 6.5 + (slot % 2 ? 2.5 : 0));
      const hw = HW[0];
      const p = track.at(s, side * hw * 0.38);
      return { x: p.x, y: p.y, z: p.z, yaw: p.h, s };
    };
    track.sOf = (x, z) => track.project(x, z, -1, null, {}).s;
    analyze(track);
    if (def.makeTerrain) track.terrain = def.makeTerrain(track);
    return track;
  };

  /* racing line (lateral offset per sample) and a safe speed profile for the bots */
  function analyze(track) {
    const { N, K, HW, step, closed } = track;
    const idx = track.idx;
    const kAt = (i, off) => K[idx(i + Math.round(off / step))];
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // inside at the apex, outside before and after the corner (K > 0 = left turn, left = negative d)
      const apex = -300 * K[i];
      const outside = 140 * (kAt(i, 28) * 0.6 + kAt(i, 14) * 0.4) + 110 * (kAt(i, -16) * 0.5 + kAt(i, -30) * 0.5);
      line[i] = clamp(apex + outside, -1, 1) * Math.max(0, HW[i] - 3.4);
    }
    track.line = movingAverage(line, 4, closed);
    const vTop = 33, aLat = 34, aBrake = 26, aAcc = 14;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // curvature of the actual racing line approximated by the centre-line curvature, a bit relaxed for wide corners
      const kk = Math.abs(K[i]) * (1 - clamp((HW[i] - 7) / 30, 0, 0.3));
      v[i] = Math.min(vTop, Math.sqrt(aLat / Math.max(kk, 1e-4)));
    }
    const passes = closed ? 3 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = N * 2 - 1; i >= 0; i--) { const a = idx(i), b = idx(i + 1); v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * aBrake * step)); }
      for (let i = 0; i < N * 2; i++) { const a = idx(i), b = idx(i + 1); v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * aAcc * step * 3)); }
    }
    track.vsafe = v;
  }
})();
