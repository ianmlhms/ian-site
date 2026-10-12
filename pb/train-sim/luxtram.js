/* Lokféierer: Luxtram T1 (real geometry from OpenStreetMap).
 *
 * Adds the real Luxembourg tram line T1 (Findel – Héienhaff – Kirchberg – Stad – Gare – Stadion) as routes
 * `luxtram` (full line) and three sections, without touching the procedural route files:
 *   - registers the routes in TS.routes / TS.config.routeRules / routeOrder (both are frozen, so they are replaced),
 *   - wraps TS.track.build  (builds a Track-compatible object from data/luxtram-track.json),
 *   - wraps TS.infra.create (hides the generic street/bridge, catenary-free stretches have no wires),
 *   - wraps TS.landscape.create (sky/sun/weather/horizon stay procedural, the near world is TS.luxtramWorld).
 * Data: © OpenStreetMap contributors (ODbL). Rebuild with scripts/fetch_luxtram_osm.py + scripts/build_luxtram.py.
 * Must be loaded after routes.js, infra.js and landscape.js and before career.js / menu.js. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] luxtram: ';
  const TRACK_URL = '/pb/train-sim/data/luxtram-track.json?v=1';
  const CREDIT = '© OpenStreetMap contributors';

  const STEP = 2;                    // m between samples (same as track.js)
  const EXT_BEFORE = 90;             // straight extension before the first / after the last real point
  const EXT_AFTER = 120;
  const SMOOTH_R = 3;                // box-blur radius (1 m samples), applied three times
  const FORMATION_DROP = 0.06;
  const TRAIN_LEN = 43;              // 5 x 8.6 m: the platform is cut to it
  const PLATFORM_LEN = 48;
  const MARKER_AHEAD = TRAIN_LEN / 2; // stop marker = OSM stop position + half a train
  const APPROACH_BEFORE = 10;
  const APPROACH_AFTER = 45;
  const LATERAL_ACCEL = 1.0;         // m/s2 used for curve speed limits
  const BRAKE_LEAD = [0.8, 120];
  const STATION_LIMIT = 25;
  const GRADE_MAX = 0.07;
  const LAND_DROP = 80;              // see wrapLandscape
  const CELL = 40;
  const COARSE = 4;
  const MAX_RING = 6;

  /* The 24 stops of T1 in driving direction Findel -> Stadion (index = position in data.stops). */
  const STOP_NAMES = ['Findel-Aéroport', 'Héienhaff', 'Luxexpo', 'Alphonse Weicker', 'Nationalbibliothéik', 'Universitéit', 'Coque', 'Europaparlament',
    'Philharmonie', 'Rout Bréck', 'Theater', 'Faïencerie', 'Stäreplaz', 'Hamilius', 'Place de Metz', 'Paräisser Plaz', 'Gare Centrale',
    'Leschte Steiwer', 'Lycée Bouneweg', 'Scillas', 'Gare Howald', 'Lycée Vauban', 'Waassertuerm', 'Stadion'];
  const CROWD = { 'Findel-Aéroport': 3, 'Gare Centrale': 3, Hamilius: 3, Stadion: 3, Luxexpo: 2, Philharmonie: 2, 'Rout Bréck': 2, Stäreplaz: 2, 'Gare Howald': 2, 'Paräisser Plaz': 2, 'Lycée Bouneweg': 2 };
  const APPROX_LENGTH = { luxtram: 16.3, 'luxtram-kierchbierg': 7.7, 'luxtram-stad': 3.7, 'luxtram-sud': 5.1 };

  const SECTIONS = [
    { id: 'luxtram-kierchbierg', from: 0, to: 9, price: 10000, fareBase: 14,
      name: { lb: 'Luxtram T1: Findel – Kierchbierg', de: 'Luxtram T1: Findel – Kirchberg', en: 'Luxtram T1: Findel – Kirchberg' } },
    { id: 'luxtram-stad', from: 9, to: 16, price: 0, fareBase: 14,
      name: { lb: 'Luxtram T1: Kierchbierg – Gare', de: 'Luxtram T1: Kirchberg – Hauptbahnhof', en: 'Luxtram T1: Kirchberg – Central Station' } },
    { id: 'luxtram-sud', from: 16, to: 23, price: 14000, fareBase: 14,
      name: { lb: 'Luxtram T1: Gare – Stadion', de: 'Luxtram T1: Hauptbahnhof – Stadion', en: 'Luxtram T1: Central Station – Stadium' } },
    { id: 'luxtram', from: 0, to: 23, price: 40000, fareBase: 16, requires: ['luxtram-kierchbierg', 'luxtram-sud'],
      name: { lb: 'Luxtram T1: Findel – Stadion (ganzt Linn)', de: 'Luxtram T1: Findel – Stadion (ganze Linie)', en: 'Luxtram T1: Findel – Stadium (full line)' } },
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

  /* ------------------------------------------------------------ data loading */
  let rawData = null;
  let loading = null;
  let model = null;

  function prefetch() {
    if (rawData || loading) return loading;
    if (typeof fetch !== 'function') return null;
    loading = fetch(TRACK_URL).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { rawData = d; return d; })
      .catch((e) => { console.warn(TAG + 'prefetch failed', e); loading = null; return null; });
    return loading;
  }
  function loadSync() {
    if (rawData) return rawData;
    try { // the route is built synchronously by the game: fall back to a blocking request if the prefetch is still running
      const xhr = new XMLHttpRequest();
      xhr.open('GET', TRACK_URL, false);
      xhr.send();
      if (xhr.status >= 200 && xhr.status < 300) rawData = JSON.parse(xhr.responseText);
    } catch (e) { console.warn(TAG + 'sync load failed', e); }
    if (!rawData) throw new Error('Luxtram data missing');
    return rawData;
  }

  const decodeFlat = (flat) => {
    const pts = [];
    let x = 0;
    let z = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      x += flat[i];
      z += flat[i + 1];
      pts.push([x / 10, z / 10]);
    }
    return pts;
  };

  /* ------------------------------------------------------------ the full-line model (built once) */
  function boxBlur(arr, radius) {
    const n = arr.length;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + arr[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - radius);
      const b = Math.min(n - 1, i + radius);
      const padA = radius - (i - a);
      const padB = radius - (b - i);
      out[i] = (prefix[b + 1] - prefix[a] + padA * arr[0] + padB * arr[n - 1]) / (2 * radius + 1);
    }
    return out;
  }

  function pchip(xs, ys) {
    const n = xs.length;
    const h = [];
    const d = [];
    for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
    const m = new Array(n).fill(0);
    if (n > 2) {
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0;
        else {
          const w1 = 2 * h[i] + h[i - 1];
          const w2 = h[i] + 2 * h[i - 1];
          m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
      m[0] = d[0];
      m[n - 1] = d[n - 2];
    }
    return (x) => {
      if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
      if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
      const t = (x - xs[lo]) / h[lo];
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
    };
  }

  function buildModel(data) {
    const raw = decodeFlat(data.path);
    const first = raw[0];
    const second = raw[Math.min(raw.length - 1, 3)];
    const last = raw[raw.length - 1];
    const prev = raw[Math.max(0, raw.length - 4)];
    const dirA = norm2(first[0] - second[0], first[1] - second[1]);
    const dirB = norm2(last[0] - prev[0], last[1] - prev[1]);
    const pts = [[first[0] + dirA[0] * EXT_BEFORE, first[1] + dirA[1] * EXT_BEFORE]].concat(raw, [[last[0] + dirB[0] * EXT_AFTER, last[1] + dirB[1] * EXT_AFTER]]);

    // dense 1 m resample of the polyline, then smooth (OSM vertices have kinks)
    const dense = [];
    const rawCum = [0];
    for (let i = 1; i < pts.length; i++) rawCum.push(rawCum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let seg = 1;
    for (let s = 0; s <= rawCum[rawCum.length - 1]; s += 1) {
      while (seg < rawCum.length - 1 && rawCum[seg] < s) seg++;
      const t = (s - rawCum[seg - 1]) / Math.max(1e-6, rawCum[seg] - rawCum[seg - 1]);
      dense.push([lerp(pts[seg - 1][0], pts[seg][0], t), lerp(pts[seg - 1][1], pts[seg][1], t)]);
    }
    let dx = Float64Array.from(dense, (p) => p[0]);
    let dz = Float64Array.from(dense, (p) => p[1]);
    for (let k = 0; k < 3; k++) { dx = boxBlur(dx, SMOOTH_R); dz = boxBlur(dz, SMOOTH_R); }

    // arc-length resample at STEP
    const cum = new Float64Array(dx.length);
    for (let i = 1; i < dx.length; i++) cum[i] = cum[i - 1] + Math.hypot(dx[i] - dx[i - 1], dz[i] - dz[i - 1]);
    const n = Math.floor(cum[cum.length - 1] / STEP) + 1;
    const X = new Float64Array(n);
    const Z = new Float64Array(n);
    let j = 1;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (j < cum.length - 1 && cum[j] < s) j++;
      const t = (s - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
      X[i] = lerp(dx[j - 1], dx[j], t);
      Z[i] = lerp(dz[j - 1], dz[j], t);
    }
    const TH = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      TH[i] = Math.atan2(X[b] - X[a], -(Z[b] - Z[a]));
    }
    for (let i = 1; i < n; i++) { // unwrap
      while (TH[i] - TH[i - 1] > Math.PI) TH[i] -= 2 * Math.PI;
      while (TH[i] - TH[i - 1] < -Math.PI) TH[i] += 2 * Math.PI;
    }
    const kRaw = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) kRaw[i] = (TH[i + 1] - TH[i - 1]) / (2 * STEP);
    const kappa = boxBlur(boxBlur(kRaw, 3), 2);

    // projecting original-chain positions onto the smoothed path
    const rawPos = new Float64Array(raw.length + 1);
    for (let i = 1; i < raw.length; i++) rawPos[i] = rawPos[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    const decLen = rawPos[raw.length - 1];
    const scale = decLen / data.length;
    const rawAt = (sOrig) => {
      const s = clamp(sOrig * scale, 0, decLen);
      let k = 1;
      while (k < raw.length - 1 && rawPos[k] < s) k++;
      const t = (s - rawPos[k - 1]) / Math.max(1e-6, rawPos[k] - rawPos[k - 1]);
      return [lerp(raw[k - 1][0], raw[k][0], t), lerp(raw[k - 1][1], raw[k][1], t)];
    };
    const hintOffset = EXT_BEFORE;
    function newFromOrig(sOrig) {
      const p = rawAt(sOrig);
      const hint = Math.round((sOrig * scale + hintOffset) / STEP);
      let best = Infinity;
      let bi = clamp(hint, 0, n - 1);
      for (let i = Math.max(0, hint - 40); i <= Math.min(n - 1, hint + 40); i++) {
        const d = (X[i] - p[0]) * (X[i] - p[0]) + (Z[i] - p[1]) * (Z[i] - p[1]);
        if (d < best) { best = d; bi = i; }
      }
      return bi * STEP;
    }

    // monotone mapping table s_orig <-> s_new (every 40 m)
    const mapOrig = [];
    const mapNew = [];
    const total = Math.ceil(data.length / 40) * 40;
    for (let so = 0; so <= total; so += 40) {
      let sn = newFromOrig(Math.min(so, data.length));
      if (mapNew.length && sn <= mapNew[mapNew.length - 1]) sn = mapNew[mapNew.length - 1] + 0.5;
      mapOrig.push(Math.min(so, data.length));
      mapNew.push(sn);
    }
    const interp = (xs, ys, x) => {
      if (x <= xs[0]) return ys[0] + (x - xs[0]);
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1] + (x - xs[xs.length - 1]);
      let lo = 0;
      let hi = xs.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
      return lerp(ys[lo], ys[lo + 1], (x - xs[lo]) / (xs[lo + 1] - xs[lo]));
    };
    const toNew = (sOrig) => interp(mapOrig, mapNew, sOrig);
    const toOrig = (sNew) => interp(mapNew, mapOrig, sNew);

    // elevation (absolute metres) along the new path
    const elevKeys = data.elev.map((e) => [toNew(e[0]), e[1]]);
    const f = pchip(elevKeys.map((e) => e[0]), elevKeys.map((e) => e[1]));
    let Yabs = new Float64Array(n);
    for (let i = 0; i < n; i++) Yabs[i] = f(i * STEP);
    Yabs = boxBlur(boxBlur(Yabs, 6), 4);
    // grade limit (relaxation)
    for (let pass = 0; pass < 30; pass++) {
      for (let i = 1; i < n; i++) { const d = Yabs[i] - Yabs[i - 1]; if (Math.abs(d) > GRADE_MAX * STEP) Yabs[i] = Yabs[i - 1] + Math.sign(d) * GRADE_MAX * STEP; }
      for (let i = n - 2; i >= 0; i--) { const d = Yabs[i] - Yabs[i + 1]; if (Math.abs(d) > GRADE_MAX * STEP) Yabs[i] = Yabs[i + 1] + Math.sign(d) * GRADE_MAX * STEP; }
    }

    // data -> new-s structures
    const stops = data.stops.map((st, i) => ({ i, name: STOP_NAMES[i] || st.name, side: st.side, sMid: toNew(st.s) }));
    const segs = data.segs.map((s) => ({ s0: toNew(s[0]), s1: toNew(s[1]), speed: s[2], surf: s[3], flags: s[4], elec: s[5] }));
    segs[0].s0 = 0;
    segs[segs.length - 1].s1 = n * STEP;
    const bridges = data.bridges.map((b) => ({ s0: toNew(b.s0), s1: toNew(b.s1), name: b.name }));
    const tunnels = data.tunnels.map((b) => ({ s0: toNew(b[0]), s1: toNew(b[1]) }));

    // terrain relief grid (half-metre ints) -> rows keyed by new s
    const demRows = data.dem.rows.map((row, i) => ({ s: toNew(i * data.dem.step), v: row.map((v) => v / 2) }));
    return { n, X, Z, TH, kappa, Yabs, stops, segs, bridges, tunnels, demRows, demOffsets: data.dem.offsets, toNew, toOrig, dataLength: data.length };
  }
  const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

  function getModel() {
    if (!model) model = buildModel(loadSync());
    return model;
  }

  /* ------------------------------------------------------------ Track for one route */
  function curveLimit(radius) {
    const kmh = 3.6 * Math.sqrt(LATERAL_ACCEL * radius);
    return Math.max(15, Math.floor(kmh / 5) * 5);
  }

  function buildLimits(raw) {
    const merged = raw.reduce((acc, e) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.kmh === e.kmh) return acc;
      return acc.concat([{ s: e.s, kmh: e.kmh }]);
    }, []);
    const shifted = merged.map((e, i) => {
      const prev = merged[i - 1];
      if (!prev || e.kmh >= prev.kmh) return e;
      const v1 = prev.kmh / 3.6;
      const v2 = e.kmh / 3.6;
      const lead = Math.min(BRAKE_LEAD[1], (v1 * v1 - v2 * v2) / (2 * BRAKE_LEAD[0]), (e.s - prev.s) * 0.85);
      return { s: Math.max(prev.s + 20, e.s - lead), kmh: e.kmh };
    });
    const sorted = shifted.slice().sort((a, b) => a.s - b.s);
    sorted[0] = { s: 0, kmh: sorted[0].kmh };
    return sorted.filter((e, i) => i === 0 || (e.s - sorted[i - 1].s > 25 && e.kmh !== sorted[i - 1].kmh));
  }

  function build(def) {
    const m = getModel();
    const spec = def.luxtram;
    const stopA = m.stops[spec.from];
    const stopB = m.stops[spec.to];
    const sStart = Math.max(0, Math.floor((stopA.sMid + MARKER_AHEAD + 4 - PLATFORM_LEN - APPROACH_BEFORE) / STEP) * STEP);
    const sEnd = Math.min(m.n * STEP - 2, Math.ceil((stopB.sMid + MARKER_AHEAD + 4 + APPROACH_AFTER) / STEP) * STEP);
    const i0 = sStart / STEP;
    const i1 = sEnd / STEP;
    const n = i1 - i0 + 1;
    const ox = m.X[i0];
    const oz = m.Z[i0];
    const oy = m.Yabs[i0];
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    const Z = new Float64Array(n);
    const TH = new Float64Array(n);
    const kappa = new Float64Array(n);
    const grade = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = m.X[i0 + i] - ox;
      Z[i] = m.Z[i0 + i] - oz;
      Y[i] = m.Yabs[i0 + i] - oy;
      TH[i] = m.TH[i0 + i];
      kappa[i] = m.kappa[i0 + i];
    }
    for (let i = 0; i < n; i++) grade[i] = (Y[Math.min(n - 1, i + 1)] - Y[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * STEP);
    const length = (n - 1) * STEP;

    /* ---- stations */
    const stations = [];
    for (let k = spec.from; k <= spec.to; k++) {
      const st = m.stops[k];
      const marker = st.sMid + MARKER_AHEAD - sStart;
      stations.push({
        id: 'st' + stations.length, name: st.name, s: marker, platformStart: marker + 4 - PLATFORM_LEN, platformEnd: marker + 4,
        side: st.side, size: CROWD[st.name] || 1, terminus: k === spec.from || k === spec.to,
      });
    }

    /* ---- attribute lookup (speed, surface, power) */
    const segAt = (sAbs) => {
      for (let i = 0; i < m.segs.length; i++) if (sAbs < m.segs[i].s1) return m.segs[i];
      return m.segs[m.segs.length - 1];
    };
    const segs = m.segs.filter((q) => q.s1 > sStart && q.s0 < sEnd).map((q) => ({ s0: Math.max(0, q.s0 - sStart), s1: Math.min(length, q.s1 - sStart), speed: q.speed, surf: q.surf, flags: q.flags, elec: q.elec }));
    const noPower = segs.filter((q) => q.elec !== 1 && !(q.flags & 2));

    /* ---- limits */
    const raw = [];
    for (let s = 0; s <= length; s += 10) {
      const q = segAt(s + sStart);
      let v = q.speed > 0 ? q.speed : 40;
      if (q.surf === 0 && v === 50) v = 70; // dedicated grass track: the full 70 km/h
      const ia = clamp(Math.round(s / STEP), 0, n - 1);
      // tightest radius within +-10 m
      let kmax = 0;
      for (let d = -5; d <= 5; d++) kmax = Math.max(kmax, Math.abs(kappa[clamp(ia + d, 0, n - 1)]));
      if (kmax > 1 / 400) v = Math.min(v, curveLimit(1 / kmax));
      stations.forEach((st) => { if (s > st.platformStart - 28 && s < st.platformEnd + 14) v = Math.min(v, STATION_LIMIT); });
      raw.push({ s, kmh: Math.max(15, Math.floor(v / 5) * 5) });
    }
    const limits = buildLimits(raw);

    /* ---- bridges / tunnels in route coordinates */
    const bridges = m.bridges.filter((b) => b.s1 > sStart && b.s0 < sEnd).map((b) => ({ s0: Math.max(0, b.s0 - sStart), s1: Math.min(length, b.s1 - sStart), kind: 'steel', h: b.name ? 60 : 12, water: false, waterY: null, name: b.name }));
    const tunnels = m.tunnels.filter((b) => b.s1 > sStart && b.s0 < sEnd).map((b) => ({ s0: Math.max(0, b.s0 - sStart), s1: Math.min(length, b.s1 - sStart) }));

    /* ---- frames */
    const frameAt = (s, out) => {
      const f = out || { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0), grade: 0, curvature: 0 };
      let theta;
      let g;
      let k;
      if (s <= 0) {
        theta = TH[0]; g = grade[0]; k = 0;
        f.pos.set(X[0] + Math.sin(theta) * s, Y[0] + g * s, Z[0] - Math.cos(theta) * s);
      } else if (s >= (n - 1) * STEP) {
        const over = s - (n - 1) * STEP;
        theta = TH[n - 1]; g = grade[n - 1]; k = 0;
        f.pos.set(X[n - 1] + Math.sin(theta) * over, Y[n - 1] + g * over, Z[n - 1] - Math.cos(theta) * over);
      } else {
        const fi = s / STEP;
        const i = Math.floor(fi);
        const t = fi - i;
        theta = lerp(TH[i], TH[i + 1], t);
        g = lerp(grade[i], grade[i + 1], t);
        k = lerp(kappa[i], kappa[i + 1], t);
        f.pos.set(lerp(X[i], X[i + 1], t), lerp(Y[i], Y[i + 1], t), lerp(Z[i], Z[i + 1], t));
      }
      const cp = 1 / Math.sqrt(1 + g * g);
      f.tangent.set(Math.sin(theta) * cp, g * cp, -Math.cos(theta) * cp);
      f.right.set(Math.cos(theta), 0, Math.sin(theta));
      f.up.set(0, 1, 0);
      f.grade = g;
      f.curvature = k;
      return f;
    };

    /* ---- nearest point (spatial hash) */
    const grid = new Map();
    const cellKey = (ix, iz) => ix * 73856 + iz * 19349;
    for (let c = 0; c <= Math.floor((n - 1) / COARSE); c++) {
      const i = Math.min(n - 1, c * COARSE);
      const key = cellKey(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
      const bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    }
    function nearest(x, z, out) {
      const res = out || { s: 0, d: 0, lat: 0, y: 0, i: 0 };
      const ix = Math.floor(x / CELL);
      const iz = Math.floor(z / CELL);
      let best = Infinity;
      let bi = -1;
      const scan = (cx, cz) => {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) return;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          const ddx = X[i] - x;
          const ddz = Z[i] - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < best) { best = d2; bi = i; }
        }
      };
      for (let r = 0; r <= MAX_RING; r++) {
        if (r === 0) scan(ix, iz);
        else {
          for (let a = -r; a <= r; a++) { scan(ix + a, iz - r); scan(ix + a, iz + r); }
          for (let b = -r + 1; b <= r - 1; b++) { scan(ix - r, iz + b); scan(ix + r, iz + b); }
        }
        if (bi >= 0 && best <= r * CELL * (r * CELL)) break;
      }
      if (bi < 0) {
        for (let i = 0; i < n; i += 16) {
          const ddx = X[i] - x;
          const ddz = Z[i] - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
      const lo = Math.max(0, bi - COARSE - 1);
      const hi = Math.min(n - 1, bi + COARSE + 1);
      for (let i = lo; i <= hi; i++) {
        const ddx = X[i] - x;
        const ddz = Z[i] - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < best) { best = d2; bi = i; }
      }
      let bestT = 0;
      let bestSeg = bi;
      let bestD2 = Infinity;
      for (let sg = Math.max(0, bi - 1); sg <= Math.min(n - 2, bi); sg++) {
        const ax = X[sg];
        const az = Z[sg];
        const bx = X[sg + 1] - ax;
        const bz = Z[sg + 1] - az;
        const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
        const px = ax + bx * t - x;
        const pz = az + bz * t - z;
        const d2 = px * px + pz * pz;
        if (d2 < bestD2) { bestD2 = d2; bestSeg = sg; bestT = t; }
      }
      if (bestD2 === Infinity) bestD2 = best;
      const fi = Math.min(bestSeg + bestT, n - 1);
      const sg1 = Math.min(n - 1, bestSeg + 1);
      const theta = lerp(TH[bestSeg], TH[sg1], bestT);
      const cx = lerp(X[bestSeg], X[sg1], bestT);
      const cz = lerp(Z[bestSeg], Z[sg1], bestT);
      res.s = fi * STEP;
      res.d = Math.sqrt(bestD2);
      res.lat = (x - cx) * Math.cos(theta) + (z - cz) * Math.sin(theta);
      res.y = lerp(Y[bestSeg], Y[sg1], bestT);
      res.i = fi;
      return res;
    }
    const scratch = { s: 0, d: 0, lat: 0, y: 0, i: 0 };

    /* ---- terrain: formation under the line + real lateral relief (valleys under the bridges) */
    const demRows = m.demRows.map((r) => ({ s: r.s - sStart, v: r.v }));
    const demOff = m.demOffsets;
    const bridgeMask = (s) => {
      let k = 0;
      for (const b of bridges) k = Math.max(k, 1 - smooth01((Math.max(b.s0 - s, s - b.s1, 0)) / 14));
      return k;
    };
    const coverAt = (s) => {
      let c = 0;
      for (const tn of tunnels) {
        const a = Math.min(s - tn.s0, tn.s1 - s);
        c = Math.max(c, 7.5 * smooth01(a / 16));
      }
      return c;
    };
    function relief(s, lat) {
      let lo = 0;
      let hi = demRows.length - 1;
      if (s <= demRows[0].s) hi = lo + 1;
      else if (s >= demRows[hi].s) lo = hi - 1;
      else while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (demRows[mid].s <= s) lo = mid; else hi = mid; }
      const u = clamp((s - demRows[lo].s) / Math.max(1e-6, demRows[hi].s - demRows[lo].s), 0, 1);
      const lc = clamp(lat, demOff[0], demOff[demOff.length - 1]);
      let j = 0;
      while (j < demOff.length - 2 && demOff[j + 1] < lc) j++;
      const v = (lc - demOff[j]) / (demOff[j + 1] - demOff[j]);
      const at = (row) => lerp(row.v[j], row.v[j + 1], v);
      return lerp(at(demRows[lo]), at(demRows[hi]), u);
    }
    function terrainHeightAt(x, z) {
      const q = nearest(x, z, scratch);
      const formY = q.y - FORMATION_DROP;
      const bm = bridgeMask(q.s);
      let h = formY + relief(q.s, q.lat);
      const cov = coverAt(q.s);
      if (cov > 0.01) h += cov * (1 - smooth01(q.d / 34));
      const w = (1 - smooth01((q.d - 3.2) / 7)) * (1 - bm);
      h = lerp(h, formY, w);
      return h;
    }

    /* ---- platforms, helpers */
    const platformInfo = (i) => {
      const st = stations[i];
      if (!st) return null;
      const edge = 1.5;
      const width = 3.0;
      return {
        edge, width, backEdge: edge + width, height: 0.3, sideSign: st.side === 'right' ? 1 : -1,
        s0: st.platformStart, s1: st.platformEnd, sMarker: st.s,
        exits: [{ s: st.platformStart - 14, lat: edge + width / 2 }, { s: st.platformEnd + 14, lat: edge + width / 2 }],
      };
    };
    const inTunnel = (s) => tunnels.some((t) => s >= t.s0 && s <= t.s1);
    const bridgeAt = (s) => bridges.find((b) => s >= b.s0 && s <= b.s1) || null;
    const stationAt = (s) => stations.findIndex((st) => s >= st.platformStart && s <= st.platformEnd);
    const corridorHalfWidth = (s) => (stations.some((st) => s >= st.platformStart - 14 && s <= st.platformEnd + 14) ? 9 : 4);
    const isReserved = (x, z) => nearest(x, z, { s: 0, d: 0, lat: 0, y: 0 }).d < 4;
    const noOcs = (s) => noPower.some((q) => s >= q.s0 && s <= q.s1);

    return {
      id: def.id, kind: 'tram', def, length, platformLen: PLATFORM_LEN, formationDrop: FORMATION_DROP,
      frameAt, stations, signals: [], limits, tunnels, bridges, crossings: [],
      biomeAt: () => 'tramcity', terrainHeightAt,
      nearest: (x, z) => Object.assign({}, nearest(x, z, { s: 0, d: 0, lat: 0, y: 0, i: 0 })),
      nearestS: (x, z) => nearest(x, z, scratch).s,
      distanceToTrack: (x, z) => nearest(x, z, scratch).d,
      water: () => null, inTunnel, bridgeAt, stationAt, corridorHalfWidth, isReserved, platformInfo,
      // flags read by the small hooks in infra.js / landscape.js
      noStreet: true, ownScenery: true, noOcs,
      luxtram: {
        sStart, sEnd, origin: { x: ox, y: oy, z: oz }, segs, credit: CREDIT,
        toRoute: (sAbs) => sAbs - sStart,
        absFromOrig: (sOrig) => m.toNew(sOrig),
        origFromAbs: (sAbs) => m.toOrig(sAbs),
      },
    };
  }

  /* ------------------------------------------------------------ registries */
  function makeRouteDef(sec) {
    const names = STOP_NAMES.slice(sec.from, sec.to + 1);
    const def = {
      id: sec.id, kind: 'tram', region: 'Stad', cruise: 70, biomes: ['tramcity'], name: sec.name, stations: names,
      luxtram: { from: sec.from, to: sec.to }, stationDefaults: { platformLen: PLATFORM_LEN, approachBefore: APPROACH_BEFORE, approachAfter: APPROACH_AFTER, stationLimit: STATION_LIMIT },
      layout: [], credit: CREDIT,
    };
    Object.defineProperty(def, 'length', {
      enumerable: true,
      get() {
        if (!rawData) return APPROX_LENGTH[sec.id] * 1000;
        const a = rawData.stops[sec.from].s;
        const b = rawData.stops[sec.to].s;
        return b - a + PLATFORM_LEN + APPROACH_BEFORE + APPROACH_AFTER;
      },
    });
    return Object.freeze(def);
  }

  function register() {
    if (TS.luxtram && TS.luxtram.registered) return;
    if (!TS.routes || !TS.config || !TS.track) { console.warn(TAG + 'routes/config/track missing, not registering'); return; }
    const defs = SECTIONS.map(makeRouteDef);
    const list = TS.routes.list.filter((r) => r.id !== 'tram').concat(defs);   // the generic fictional tram line is gone: only the real Luxtram
    const byId = list.reduce((acc, r) => Object.assign(acc, { [r.id]: r }), {});
    TS.routes = Object.freeze({ list, get: (id) => byId[id] || null });

    // Tram career: sections are bought with tram money (stad is free, the full line needs the other sections first).
    const rules = {};
    SECTIONS.forEach((s) => {
      rules[s.id] = Object.freeze({ price: s.price, needs: Object.freeze(['tram']), fareBase: s.fareBase, requires: Object.freeze(s.requires || []) });
    });
    const order = TS.config.routeOrder.filter((id) => id !== 'tram').concat(SECTIONS.map((s) => s.id));
    const cleanRules = Object.assign({}, TS.config.routeRules);
    delete cleanRules.tram;
    TS.config = Object.freeze(Object.assign({}, TS.config, { routeRules: Object.freeze(Object.assign(cleanRules, rules)), routeOrder: Object.freeze(order) }));

    const baseBuild = TS.track.build;
    TS.track = Object.assign({}, TS.track, {
      build(def) { return def && def.luxtram ? build(def) : baseBuild.apply(this, arguments); },
    });

    wrapInfra();
    wrapLandscape();
    TS.luxtram = { registered: true, sections: SECTIONS.map((s) => s.id), build, prefetch, credit: CREDIT, getModel };
    prefetch();
  }

  function wrapInfra() {
    if (!TS.infra || !TS.infra.create) return;
    const base = TS.infra.create;
    TS.infra = Object.assign({}, TS.infra, {
      create(scene, track, options) {
        if (!track || !track.luxtram) return base.apply(this, arguments);
        // the generic tram street and bridge are replaced by the real thing (TS.luxtramWorld)
        const proxy = Object.create(track, { bridges: { value: [], enumerable: true } });
        return base.call(this, scene, proxy, options);
      },
    });
  }

  function wrapLandscape() {
    if (!TS.landscape || !TS.landscape.create) return;
    const base = TS.landscape.create;
    TS.landscape = Object.assign({}, TS.landscape, {
      create(scene, track, options) {
        if (!track || !track.luxtram || !TS.luxtramWorld) return base.apply(this, arguments);
        // The landscape keeps a flat 'under-ground' plane 12 m below the line at the camera: the Pfaffenthal valley is ~70 m
        // deeper, so it sees a line that is LAND_DROP lower (its own terrain strip is off: ownScenery).
        const baseFrame = track.frameAt;
        const lowered = Object.create(track, {
          frameAt: { value: (s, out) => { const f = baseFrame(s, out); f.pos.y -= LAND_DROP; return f; } },
        });
        const land = base.call(this, scene, lowered, options);
        let world = null;
        try { world = TS.luxtramWorld.create(scene, track, options, land); } catch (e) { console.warn(TAG + 'world failed', e); }
        if (!world) return land;
        if (TS.luxtram) TS.luxtram.last = world; // debug handle (stats())
        return Object.assign({}, land, {
          update(s, camera, dt) { land.update(s, camera, dt); world.update(s, camera, dt); },
          setTimeOfDay(h) { land.setTimeOfDay(h); world.setTimeOfDay(h); },
          setWeather(w, instant) { land.setWeather(w, instant); world.setWeather(w, instant); },
          warm(s) { land.warm(s); world.warm(s); },
          stats() { const a = land.stats ? land.stats() : {}; return Object.assign({}, a, { world: world.stats() }); },
          dispose() { world.dispose(); land.dispose(); },
          luxtramWorld: world,
        });
      },
    });
  }

  /* ------------------------------------------------------------ credits (ODbL) */
  function addCredits() {
    const note = (cls) => {
      const el = document.createElement('small');
      el.className = cls;
      el.textContent = CREDIT + ' (ODbL)';
      el.style.cssText = 'display:block;margin-top:4px;opacity:.7;font-size:11px;font-weight:400';
      return el;
    };
    const decorate = () => {
      document.querySelectorAll('.ts-menu__card[data-route^="luxtram"]:not([data-lt-credit])').forEach((card) => {
        card.setAttribute('data-lt-credit', '1');
        const pick = card.querySelector('.ts-menu__pick') || card;
        pick.appendChild(note('ts-lt-credit'));
      });
      const help = document.getElementById('helpBody');
      if (help && !help.querySelector('.ts-lt-credit') && !help.parentElement.querySelector('.ts-lt-credit')) {
        const p = note('ts-lt-credit');
        p.textContent = 'Luxtram T1: Kartendaten ' + CREDIT + ' (ODbL), openstreetmap.org/copyright';
        help.parentElement.appendChild(p);
      }
    };
    const start = () => {
      decorate();
      const host = document.getElementById('menuHost') || document.body;
      new MutationObserver(decorate).observe(host, { childList: true, subtree: true });
      const help = document.getElementById('helpScreen');
      if (help) new MutationObserver(decorate).observe(help, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }

  register();
  addCredits();
})();
