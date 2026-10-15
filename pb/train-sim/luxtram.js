/* Lokféierer: Luxtram T1 (real geometry from OpenStreetMap).
 *
 * Adds the real Luxembourg tram line T1 (Findel – Héienhaff – Kirchberg – Stad – Gare – Stadion) as routes
 * `luxtram` (full line) and three sections, without touching the procedural route files:
 *   - registers the routes in TS.routes / TS.config.routeRules / routeOrder (both are frozen, so they are replaced),
 *   - wraps TS.track.build  (builds a Track-compatible object from data/luxtram-track.json),
 *   - wraps TS.infra.create (hides the generic street/bridge, catenary-free stretches have no wires),
 *   - wraps TS.landscape.create (sky/sun/weather/horizon stay procedural, the near world is TS.luxtramWorld).
 * Also here: the OPPOSITE (left-hand) track (track.opposite, from the OSM second-track ways in data/luxtram-track2.json, same sample indices as the
 * player's right-hand track), the platform side / kind of every stop (from the real OSM platform geometry), the 70 km/h cap on every limit,
 * and the vertical alignment fixes (Héienhaff trench, motorway bridge before Luxexpo) unless the data says `elevReal` (LiDAR rail levels).
 * Data: © OpenStreetMap contributors (ODbL). Rebuild with scripts/fetch_luxtram_osm.py + scripts/build_luxtram.py + scripts/build_luxtram_track2.py.
 * Must be loaded after routes.js, infra.js and landscape.js and before career.js / menu.js. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] luxtram: ';
  const TRACK_URL = '/pb/train-sim/data/luxtram-track.json?v=2';
  const TRACK2_URL = '/pb/train-sim/data/luxtram-track2.json?v=1';   // opposite track + platform sides (scripts/build_luxtram_track2.py)
  const CREDIT = '© OpenStreetMap contributors · Geodata © ACT Luxembourg (geoportail.lu)';

  const STEP = 2;                    // m between samples (same as track.js)
  const EXT_BEFORE = 90;             // straight extension before the first / after the last real point
  const EXT_AFTER = 120;
  const SMOOTH_R = 3;                // box-blur radius (1 m samples), applied three times
  const FORMATION_DROP = 0.06;
  const TRAIN_LEN = 43;              // 5 x 8.6 m: the platform is cut to it
  const PLATFORM_LEN = 48;
  const MARKER_AHEAD = TRAIN_LEN / 2; // stop marker = OSM stop position + half a train
  const APPROACH_BEFORE = 45;        // symmetrical with APPROACH_AFTER: the return direction has the same room behind its last stop
  const APPROACH_AFTER = 45;
  const BRAKE_LEAD = [0.8, 120];
  /* Limit profile: calm and readable (Ian: "speed limits change weirdly often"). */
  const MIN_ZONE = 300;              // m: shortest limit zone (Ian: no 70 km/h zone of a few dozen metres before a stop)
  const MIN_ZONE_CENTRE = 300;       // m: ... also in the city centre (Theater .. Gare Centrale): the stops are 350-900 m apart
  const CENTRE_PAD = 150;
  const CURVE_R_25 = 45;             // m: curves tighter than this are limited to 25 km/h, tighter than CURVE_R_30 to 30 km/h
  const CURVE_R_30 = 70;
  const DEFAULT_KMH = 50;            // limit where OSM has no maxspeed: the usual urban tram speed
  const MAX_NORMAL_KMH = 50;         // the line runs at 50 km/h at most (real T1: ~50 on its normal sections, commercial speed only 20-24 km/h); no 70 anywhere
  /* The fast stretch: the ~2 km segregated track through the Gréngewald forest between Héienhaff and the A1 bridge before Luxexpo, where the real T1 runs up to 70 km/h
     (Railway Gazette; press file of the Luxembourg government on the opening of the Findel extension, 2 March 2025; OSM maxspeed=70 there too).  Only OSM-60/70 track in this
     window gets it; the A1 bridge itself and everything after it (towards / into Luxexpo), Findel - Héienhaff and the whole city keep the normal 50. */
  const FOREST_STRETCH_KMH = 70;
  const FOREST_BRIDGE_PAD = 60;       // the forest limit ends this far before the A1 bridge
  /* Curve restrictions are local: from CURVE_BEFORE_M ahead of the bend to the bend's end + one tram length (the nose-based limit ends when the REAR has cleared it);
     boards of drops move ahead by the braking distance (<= LEAD_MAX_M). A gap between two curve zones shorter than GAP_MERGE_M takes the lower limit, a longer one keeps its
     own speed but at most one step above its higher neighbour (25 -> 40 -> 25, never 25 -> 70 -> 25). */
  const CURVE_BEFORE_M = 20;
  const CURVE_AFTER_M = TRAIN_LEN + 2;
  const CURVE_JOIN_M = 30;
  const GAP_MERGE_M = 120;
  const LEAD_MAX_M = 60;
  const LEAD_DECEL = 1.0;
  const GRADE_MAX = 0.07;            // the steepest real stretches of the T1 (Pfaffenthal / Héienhaff ramps) stay under 7 %
  /* Vertical profile smoothing (Ian: "the track goes up and down in many small bumps"): the LiDAR rail levels carry +-0.3 m of noise every few
     metres, which reads as grades of +-5 % that change sign every 20-40 m. A penalised fit (Whittaker smoother = discrete cubic smoothing spline)
     keeps the profile within PROFILE_DEV of the real levels but removes every wave shorter than ~PROFILE_WAVE_M. Bridge decks and tunnels
     (real structure levels) and the platforms are pinned, the grade is capped afterwards. */
  const PROFILE_WAVE_M = 260;         // m: waves shorter than this are removed (cutoff wavelength of the smoothing spline)
  const PROFILE_DEV = 0.9;            // m: the smoothed rail level stays this close to the real level (the ground meets the track bed through the formation blend)
  const PROFILE_PIN_W = 400;          // weight of structure samples (bridge decks, tunnels) in the fit
  const PROFILE_PLATFORM_PAD = 12;    // m around a platform that is kept level
  const MAX_KMH = 70;                // the real Luxtram top speed: no limit board, curve or timetable ever shows more
  const OPP_DEFAULT_LAT = -3.45;     // spacing to the opposite track where OSM has no second way (the tracks are 3.0-4.5 m apart on the line)
  const OPP_LAT_MIN = -12;
  const OPP_LAT_MAX = -2.6;
  const OPP_SEARCH = 15;             // m: search radius for the opposite track around a sample
  const OPP_GRID = 40;
  /* Vertical alignment fixes on top of the (smoothed DEM) ground profile, in the order of the line:
     the line dips under the roads at Héienhaff (OSM tunnel=yes, layer=-1) and crosses the motorway on a bridge before Luxexpo
     (OSM bridge=yes). Ramps stay below ~7 % (cosine eased: peak grade = 1.5 * height / length). */
  const TUNNEL_DEPTH = 6.2;          // rail level below the ground over a tunnel group
  const TUNNEL_GROUP_GAP = 200;      // tunnels closer than this share one trench
  const BRIDGE_RISE = 6.3;           // deck above the ground profile for a plain (unnamed, short) bridge over a motorway
  const RAMP_GRADE = 0.05;           // ramps out of the trench / onto the bridge (the ground profile adds up to ~3 % on top)
  const RISE_BRIDGE_MAX_S = 4000;    // only the bridge before Luxexpo is raised (the big named / railway bridges keep their level decks)
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
  let rawData2 = null;               // opposite track + platform sides (optional: the line still builds without it)
  let loading = null;
  let model = null;

  function prefetch() {
    if (rawData || loading) return loading;
    if (typeof fetch !== 'function') return null;
    const net = (TS.net = TS.net || { bytes: 0 });   // shared download counter (the loading bar reads it)
    const get = (url, optional) => fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((txt) => { net.bytes += txt.length; return JSON.parse(txt); })
      .catch((e) => { console.warn(TAG + 'prefetch failed ' + url, e); if (!optional) throw e; return null; });
    loading = Promise.all([get(TRACK_URL, false), get(TRACK2_URL, true)])
      .then(([d, d2]) => { rawData = d; rawData2 = d2; return d; })
      .catch(() => { loading = null; return null; });
    return loading;
  }
  /* Everything the Luxtram needs before the world can be built, fetched asynchronously so the loading screen can show real progress:
     the track data, the world data (roads, buildings index) and the landmark detail. onProgress(fraction 0..1) after each part.
     Never rejects: a part that fails is simply loaded by the blocking fallback later. */
  const PRELOAD_PARTS = [   // approximate sizes in kB: they weight the parts of the bar
    { kb: 130, run: () => (rawData ? Promise.resolve() : prefetch() || Promise.resolve()) },
    { kb: 420, run: () => (TS.luxtramWorld && TS.luxtramWorld.prefetchData ? TS.luxtramWorld.prefetchData() : Promise.resolve()) },
    { kb: 600, run: () => (TS.luxLandmarks && TS.luxLandmarks.preload ? TS.luxLandmarks.preload() : Promise.resolve()) },
  ];
  function preload(onProgress) {
    const total = PRELOAD_PARTS.reduce((a, p) => a + p.kb, 0);
    let done = 0;
    const report = () => { try { if (onProgress) onProgress(done / total); } catch (e) { /* ignore */ } };
    report();
    return Promise.all(PRELOAD_PARTS.map((p) => Promise.resolve().then(p.run).catch(() => null).then(() => { done += p.kb; report(); }))).then(() => true);
  }
  function syncGet(url) {
    try { // the route is built synchronously by the game: fall back to a blocking request if the prefetch is still running
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText);
    } catch (e) { console.warn(TAG + 'sync load failed ' + url, e); }
    return null;
  }
  function loadSync() {
    if (!rawData) rawData = syncGet(TRACK_URL);
    if (!rawData) throw new Error('Luxtram data missing');
    if (!rawData2) rawData2 = syncGet(TRACK2_URL);
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


  /* Whittaker smoother: z minimises sum w (z - y)^2 + lambda * sum (second difference of z)^2 (banded Cholesky, bandwidth 2). */
  function whittaker(y, w, lambda) {
    const n = y.length;
    const d0 = new Float64Array(n);   // diagonal
    const d1 = new Float64Array(n);   // first off-diagonal (i, i+1)
    const d2 = new Float64Array(n);   // second off-diagonal (i, i+2)
    for (let i = 0; i < n; i++) d0[i] = w[i];
    for (let i = 0; i + 2 < n; i++) {   // D^T D for the stencil (1, -2, 1) on rows i..i+2
      d0[i] += lambda; d0[i + 1] += 4 * lambda; d0[i + 2] += lambda;
      d1[i] += -2 * lambda; d1[i + 1] += -2 * lambda;
      d2[i] += lambda;
    }
    // A = L D L^T (L unit lower triangular with two sub-diagonals L1, L2)
    const L1 = new Float64Array(n);
    const L2 = new Float64Array(n);
    const D = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const l2 = i > 1 ? d2[i - 2] / D[i - 2] : 0;
      const l1 = i > 0 ? ((d1[i - 1]) - (i > 1 ? l2 * L1[i - 1] * D[i - 2] : 0)) / D[i - 1] : 0;
      D[i] = d0[i] - (i > 0 ? l1 * l1 * D[i - 1] : 0) - (i > 1 ? l2 * l2 * D[i - 2] : 0);
      L1[i] = l1;
      L2[i] = l2;
    }
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = w[i] * y[i];
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = b[i] - (i > 0 ? L1[i] * t[i - 1] : 0) - (i > 1 ? L2[i] * t[i - 2] : 0);
    for (let i = 0; i < n; i++) t[i] /= D[i];
    const z = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) z[i] = t[i] - (i + 1 < n ? L1[i + 1] * z[i + 1] : 0) - (i + 2 < n ? L2[i + 2] * z[i + 2] : 0);
    return z;
  }

  /* Smooth rail profile within +-dev of the real levels. `pin[i]` > 0 marks samples that must keep their level (weights), `flat` = [i0, i1] index ranges
     (platforms) that are laid out as one straight grade between their ends. */
  function smoothProfile(raw, pin, flat, step) {
    const n = raw.length;
    const lambda = Math.pow(PROFILE_WAVE_M / step / (2 * Math.PI), 4);
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 1 + pin[i] * PROFILE_PIN_W;
    let z = whittaker(raw, w, lambda);
    for (let iter = 0; iter < 12; iter++) {   // pull the fit back where it strays further than allowed from the real level
      let moved = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(z[i] - raw[i]) > PROFILE_DEV && !pin[i]) { w[i] *= 3; moved++; }
      }
      if (!moved) break;
      z = whittaker(raw, w, lambda);
    }
    // platforms: one straight grade across the platform (+ pad), blended back into the curve at both ends
    flat.forEach(([a, b]) => {
      const i0 = Math.max(0, a);
      const i1 = Math.min(n - 1, b);
      if (i1 - i0 < 4) return;
      const y0 = z[i0];
      const y1 = z[i1];
      const out = Float64Array.from(z);
      for (let i = i0; i <= i1; i++) out[i] = y0 + ((y1 - y0) * (i - i0)) / (i1 - i0);
      z = out;
    });
    return z;
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

    // data -> new-s structures (stop sides come from the real OSM platform geometry, scripts/build_luxtram_track2.py)
    const t2stops = rawData2 && Array.isArray(rawData2.stops) ? rawData2.stops : [];
    const stops = data.stops.map((st, i) => {
      const p2 = t2stops[i] && t2stops[i].name === (STOP_NAMES[i] || st.name) ? t2stops[i] : null;
      return {
        i, name: STOP_NAMES[i] || st.name, side: p2 ? p2.side : st.side, sMid: toNew(st.s),
        kind: p2 ? p2.kind : 'side', edge: p2 ? p2.edge : 1.5, width: p2 ? p2.width : 3, oppLat: p2 && p2.oppLat != null ? p2.oppLat : null,
      };
    });
    const segs = data.segs.map((s) => ({ s0: toNew(s[0]), s1: toNew(s[1]), speed: s[2], surf: s[3], flags: s[4], elec: s[5] }));
    segs[0].s0 = 0;
    segs[segs.length - 1].s1 = n * STEP;
    const bridges = data.bridges.map((b) => ({ s0: toNew(b.s0), s1: toNew(b.s1), name: b.name }));
    const tunnels = data.tunnels.map((b) => ({ s0: toNew(b[0]), s1: toNew(b[1]) }));

    // elevation (absolute metres) along the new path: smoothed ground profile, then the cut / rise fixes, then the grade limit
    const elevKeys = data.elev.map((e) => [toNew(e[0]), e[1]]);
    const f = pchip(elevKeys.map((e) => e[0]), elevKeys.map((e) => e[1]));
    let Yabs = new Float64Array(n);
    for (let i = 0; i < n; i++) Yabs[i] = f(i * STEP);
    let Yground;
    let fixes;
    if (data.elevReal === true) {
      // real LiDAR rail levels (DTM outside structures, deck level on bridges, linear in tunnels) + bare-earth ground: no synthetic fixes
      Yabs = boxBlur(Yabs, 2);
      const gKeys = (Array.isArray(data.ground) && data.ground.length > 1 ? data.ground : data.elev).map((e) => [toNew(e[0]), e[1]]);
      const g = pchip(gKeys.map((e) => e[0]), gKeys.map((e) => e[1]));
      Yground = new Float64Array(n);
      for (let i = 0; i < n; i++) Yground[i] = g(i * STEP);
      Yground = boxBlur(Yground, 2);
      // smooth rail profile; the ground keeps its real height above / below the rails (cut / fill), smoothed the same way
      const cutRaw = Float64Array.from(Yground, (v, i) => v - Yabs[i]);
      const pin = new Uint8Array(n);
      const pinRange = (a, b) => { for (let i = Math.max(0, Math.floor(a / STEP)); i <= Math.min(n - 1, Math.ceil(b / STEP)); i++) pin[i] = 1; };
      bridges.forEach((b) => pinRange(b.s0 - 6, b.s1 + 6));
      tunnels.forEach((tn) => pinRange(tn.s0 - 6, tn.s1 + 6));
      const smoothed = smoothProfile(Yabs, pin, [], STEP);
      Yabs = smoothed;
      Yground = Float64Array.from(Yabs, (v, i) => v + cutRaw[i]);
      const mid = (a, b) => clamp(Math.round((a + b) / 2 / STEP), 0, n - 1);
      fixes = {
        adj: new Float64Array(n),
        tunnels: tunnels.map((tn) => ({ ...tn, depth: Math.max(0, Yground[mid(tn.s0, tn.s1)] - Yabs[mid(tn.s0, tn.s1)]) })),
        bridges: bridges.map((b) => ({ ...b, rise: Math.max(0, Yabs[mid(b.s0, b.s1)] - Yground[mid(b.s0, b.s1)]) })),
      };
    } else {
      Yabs = boxBlur(boxBlur(Yabs, 6), 4);
      Yground = Float64Array.from(Yabs);
      fixes = alignmentFixes(n, stops, tunnels, bridges);
    }
    for (let i = 0; i < n; i++) Yabs[i] += fixes.adj[i];
    for (let pass = 0; pass < 30; pass++) {
      for (let i = 1; i < n; i++) { const d = Yabs[i] - Yabs[i - 1]; if (Math.abs(d) > GRADE_MAX * STEP) Yabs[i] = Yabs[i - 1] + Math.sign(d) * GRADE_MAX * STEP; }
      for (let i = n - 2; i >= 0; i--) { const d = Yabs[i] - Yabs[i + 1]; if (Math.abs(d) > GRADE_MAX * STEP) Yabs[i] = Yabs[i + 1] + Math.sign(d) * GRADE_MAX * STEP; }
    }

    // the opposite track: lateral spacing to the player's (right-hand) track at every sample
    const realFrom = 0;                              // the second track runs along the whole path, including the straight extensions at both ends
    const realTo = n * STEP;
    const opp = oppositeTrack(X, Z, TH, n, rawData2, realFrom / STEP, realTo / STEP);

    // terrain relief grid (half-metre ints) -> rows keyed by new s
    const demRows = data.dem.rows.map((row, i) => ({ s: toNew(i * data.dem.step), v: row.map((v) => v / 2) }));
    return {
      n, X, Z, TH, kappa, Yabs, Yground, stops, segs, bridges: fixes.bridges, tunnels: fixes.tunnels, demRows, demOffsets: data.dem.offsets, toNew, toOrig,
      dataLength: data.length, opp, oppRange: [realFrom, realTo],
    };
  }

  /* Tunnel dips and bridge rises (new-s units). Returns { adj[] (metres to add to the ground profile), tunnels[], bridges[] with depth / rise }. */
  function alignmentFixes(n, stops, tunnels, bridges) {
    const adj = new Float64Array(n);
    const rampLen = (h, grade) => (1.5 * h) / grade;   // cosine ease: peak grade = 1.5 * h / length
    const outTunnels = tunnels.map((tn) => ({ ...tn, depth: 0 }));
    const outBridges = bridges.map((b) => ({ ...b, rise: 0 }));
    // tunnel groups -> one trench: ramps down after the previous platform, back up behind the last portal
    const groups = [];
    tunnels.slice().sort((a, b) => a.s0 - b.s0).forEach((tn) => {
      const g = groups[groups.length - 1];
      if (g && tn.s0 - g.b < TUNNEL_GROUP_GAP) { g.b = Math.max(g.b, tn.s1); g.list.push(tn); } else groups.push({ a: tn.s0, b: tn.s1, list: [tn] });
    });
    groups.forEach((g) => {
      const D = TUNNEL_DEPTH;
      const lrUp = rampLen(D, RAMP_GRADE);
      const platEnd = stops.reduce((m, st) => { const e = st.sMid + MARKER_AHEAD + 4 + 3; return e < g.a + 1 && e > m ? e : m; }, 0);
      const sd0 = Math.max(g.a - lrUp, platEnd);
      const lrDown = Math.max(g.a - sd0, rampLen(D, 0.075));   // the ramp after the Héienhaff platform may be steeper (no room)
      const iA = Math.max(0, Math.floor(sd0 / STEP));
      const iB = Math.min(n - 1, Math.ceil((g.b + lrUp) / STEP));
      for (let i = iA; i <= iB; i++) {
        const s = i * STEP;
        const down = smooth01((s - sd0) / lrDown);
        const up = 1 - smooth01((s - g.b) / lrUp);
        adj[i] -= D * Math.min(down, up);
      }
      g.list.forEach((tn) => { const o = outTunnels.find((x) => x.s0 === tn.s0 && x.s1 === tn.s1); if (o) o.depth = D * Math.min(smooth01((tn.s1 - sd0) / lrDown), 1); });
    });
    // the plain bridge over the motorway before Luxexpo: the deck rises above the ground
    outBridges.forEach((b) => {
      if (b.name || b.s1 - b.s0 > 200 || b.s0 > RISE_BRIDGE_MAX_S) return;
      const R = BRIDGE_RISE;
      const lr = rampLen(R, RAMP_GRADE);
      const iA = Math.max(0, Math.floor((b.s0 - lr) / STEP));
      const iB = Math.min(n - 1, Math.ceil((b.s1 + lr) / STEP));
      for (let i = iA; i <= iB; i++) {
        const s = i * STEP;
        adj[i] += R * Math.min(smooth01((s - (b.s0 - lr)) / lr), 1 - smooth01((s - b.s1) / lr));
      }
      b.rise = R;
    });
    return { adj, tunnels: outTunnels, bridges: outBridges };
  }

  /* The opposite track from the OSM second track ways (data2.opp, decimetre delta coded polylines): for every sample of the player's
     smoothed centreline the signed lateral distance (negative = left) to the nearest parallel opposite way. Gaps are interpolated
     (<= 200 m) or filled with the standard spacing; the result is smoothed. src[i] = 1 where the position comes from OSM. */
  function oppositeTrack(X, Z, TH, n, data2, iFrom, iTo) {
    const lat = new Float64Array(n).fill(NaN);
    const src = new Uint8Array(n);
    if (data2 && Array.isArray(data2.opp)) {
      const segsA = [];
      data2.opp.forEach((flat) => {
        const pts = decodeFlat(flat);
        for (let k = 0; k + 1 < pts.length; k++) segsA.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]);
      });
      const grid = new Map();
      const key = (cx, cz) => cx * 73856 + cz * 19349;
      segsA.forEach((sg, idx) => {
        const len = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
        const steps = Math.max(1, Math.ceil(len / (OPP_GRID / 2)));
        for (let k = 0; k <= steps; k++) {
          const cx = Math.floor((sg[0] + (sg[2] - sg[0]) * (k / steps)) / OPP_GRID);
          const cz = Math.floor((sg[1] + (sg[3] - sg[1]) * (k / steps)) / OPP_GRID);
          const kk = key(cx, cz);
          const list = grid.get(kk);
          if (!list) grid.set(kk, [idx]); else if (list[list.length - 1] !== idx) list.push(idx);
        }
      });
      for (let i = 0; i < n; i++) {
        const th = TH[i];
        const rx = Math.cos(th);
        const rz = Math.sin(th);
        const tx = Math.sin(th);
        const tz = -Math.cos(th);
        const cx0 = Math.floor(X[i] / OPP_GRID);
        const cz0 = Math.floor(Z[i] / OPP_GRID);
        let best = Infinity;
        let bestLat = NaN;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(key(cx0 + dx, cz0 + dz));
            if (!list) continue;
            for (let k = 0; k < list.length; k++) {
              const sg = list[k] >= 0 ? segsA[list[k]] : null;
              if (!sg) continue;
              const vx = sg[2] - sg[0];
              const vz = sg[3] - sg[1];
              const l2 = vx * vx + vz * vz;
              if (l2 < 1e-6) continue;
              const ll = Math.sqrt(l2);
              if (Math.abs((vx * tx + vz * tz) / ll) < 0.82) continue;   // not running along the player's track
              const u = clamp(((X[i] - sg[0]) * vx + (Z[i] - sg[1]) * vz) / l2, 0, 1);
              const px = sg[0] + vx * u - X[i];
              const pz = sg[1] + vz * u - Z[i];
              const l = px * rx + pz * rz;
              const d = Math.hypot(px, pz);
              if (l < OPP_LAT_MIN || l > -1.4 || d > OPP_SEARCH) continue;
              if (d < best) { best = d; bestLat = l; }
            }
          }
        }
        if (Number.isFinite(bestLat)) { lat[i] = bestLat; src[i] = 1; }
      }
    }
    // fill gaps: interpolate short ones, default spacing for long ones
    let i = 0;
    while (i < n) {
      if (Number.isFinite(lat[i])) { i++; continue; }
      let j = i;
      while (j < n && !Number.isFinite(lat[j])) j++;
      const a = i > 0 ? lat[i - 1] : NaN;
      const b = j < n ? lat[j] : NaN;
      const gapM = (j - i) * STEP;
      for (let k = i; k < j; k++) {
        if (gapM <= 200 && Number.isFinite(a) && Number.isFinite(b)) lat[k] = lerp(a, b, (k - i + 1) / (j - i + 1));
        else if ((gapM <= 60 || i === 0 || j === n) && (Number.isFinite(a) || Number.isFinite(b))) lat[k] = Number.isFinite(a) ? a : b;   // short gaps and the line ends: keep the neighbour's spacing
        else lat[k] = OPP_DEFAULT_LAT;
      }
      i = j;
    }
    let sm = boxBlur(boxBlur(lat, 3), 3);
    sm = Float64Array.from(sm, (v) => clamp(v, OPP_LAT_MIN, OPP_LAT_MAX));
    return { lat: sm, src, iFrom: Math.max(0, Math.floor(iFrom)), iTo: Math.min(n - 1, Math.ceil(iTo)) };
  }
  const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

  function getModel() {
    if (!model) model = buildModel(loadSync());
    return model;
  }

  /* ------------------------------------------------------------ Track for one route */
  /* Limit zones of one direction of travel from 10 m samples: baseV[i] = the line speed (OSM maxspeed, 50 default, capped), curveV[i] = 25 / 30 / Infinity from the bend.
     Returns { limits: [{ s, kmh }] (boards), zones: [{ s0, s1, kmh, kind: 'base' | 'curve' | 'gap' | 'end' }] }.  Rules:
       1. base zones (no curve) are at least minZone long (a shorter one takes the closer neighbour's speed);
       2. every bend gets its own zone: CURVE_BEFORE_M before it .. its end + CURVE_AFTER_M (never longer);
       3. a non-curve gap between two curve zones: < GAP_MERGE_M takes the lower limit, longer keeps its speed capped to one step above the higher neighbour. */
  function buildTramLimits(baseV, curveV, totalLen, minZone) {
    const n = baseV.length;
    const v = Array.from(baseV);
    const kind = new Array(n).fill(0);                 // 0 base, 1 curve, 2 gap
    const lenOf = (r) => (r.b >= n ? totalLen - r.a * 10 : (r.b - r.a) * 10);
    const runsOf = () => { const out = []; for (let i = 0; i < n; i++) { const r = out[out.length - 1]; if (r && r.v === v[i] && r.k === kind[i]) r.b = i + 1; else out.push({ a: i, b: i + 1, v: v[i], k: kind[i] }); } return out; };
    // 1. base zones
    for (let guard = 0; guard < 3000; guard++) {
      const rs = runsOf();
      let k = -1; let best = minZone;
      rs.forEach((r, i) => { const l = lenOf(r); if (l < best) { best = l; k = i; } });
      if (k < 0 || rs.length < 2) break;
      const pv = k > 0 ? rs[k - 1].v : null; const nv = k + 1 < rs.length ? rs[k + 1].v : null;
      let to;
      if (pv === null) to = nv; else if (nv === null) to = pv; else { const dp = Math.abs(pv - rs[k].v); const dn = Math.abs(nv - rs[k].v); to = dp < dn ? pv : dn < dp ? nv : Math.min(pv, nv); }
      for (let i = rs[k].a; i < rs[k].b; i++) v[i] = to;
    }
    // 2. curve overlay: runs of equal curve limit (joined over short gaps), widened by the margins
    const overlay = new Array(n).fill(Infinity);
    const joinN = Math.round(CURVE_JOIN_M / 10);
    const curveRuns = [];
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(curveV[i])) continue;
      const last = curveRuns[curveRuns.length - 1];
      if (last && last.val === curveV[i] && i - last.b <= joinN) last.b = i; else curveRuns.push({ a: i, b: i, val: curveV[i] });
    }
    const beforeN = Math.round(CURVE_BEFORE_M / 10); const afterN = Math.round(CURVE_AFTER_M / 10);
    curveRuns.forEach((r) => { for (let i = Math.max(0, r.a - beforeN); i <= Math.min(n - 1, r.b + afterN); i++) overlay[i] = Math.min(overlay[i], r.val); });
    for (let i = 0; i < n; i++) if (overlay[i] < v[i]) { v[i] = overlay[i]; kind[i] = 1; }
    // 3. clean-up of the pieces the overlay left
    for (let guard = 0; guard < 3000; guard++) {
      const rs = runsOf();
      let changed = false;
      for (let k = 0; k < rs.length && !changed; k++) {
        const r = rs[k]; if (r.k !== 0 || lenOf(r) >= minZone) continue;
        const prev = rs[k - 1]; const next = rs[k + 1];
        if (!prev && !next) continue;
        const setTo = (to, kd) => { for (let i = r.a; i < r.b; i++) { v[i] = to; kind[i] = kd; } changed = true; };
        if (prev && next && prev.k === 1 && next.k === 1) {
          if (lenOf(r) < GAP_MERGE_M) setTo(Math.min(prev.v, next.v), 1);
          else { const cap = Math.min(r.v, r.v > Math.max(prev.v, next.v) ? (Math.max(prev.v, next.v) <= 30 ? 40 : 50) : r.v); if (cap !== r.v || r.k !== 2) setTo(cap, 2); }
        } else if (prev && next) {
          const cand = [prev, next].filter((q) => q.k !== 1);
          if (cand.length) { const q = cand.length === 1 ? cand[0] : (Math.abs(prev.v - r.v) <= Math.abs(next.v - r.v) ? prev : next); setTo(q.v, q.k); }
        } else {
          const q = prev || next;
          if (q.k !== 1) setTo(q.v, q.k);              // a short piece at the end of the line next to a curve zone stays as it is
        }
      }
      if (!changed) break;
    }
    // tiny curve pieces (the left-over of one bend's margin next to another zone) join the closer neighbour
    for (let guard = 0; guard < 3000; guard++) {
      const rs2 = runsOf(); let changed = false;
      for (let k = 0; k < rs2.length && !changed; k++) {
        const r = rs2[k]; if (r.k !== 1 || lenOf(r) >= 60) continue;
        const nb = [rs2[k - 1], rs2[k + 1]].filter(Boolean); if (!nb.length) continue;
        const q = nb.length === 1 ? nb[0] : (Math.abs(nb[0].v - r.v) <= Math.abs(nb[1].v - r.v) ? nb[0] : nb[1]);
        for (let i = r.a; i < r.b; i++) { v[i] = q.v; kind[i] = q.k; }
        changed = true;
      }
      if (!changed) break;
    }
    const rs = runsOf();
    // 4. boards: drops move ahead by the braking distance, never into the minimum of the zone before them
    const limits = []; const zones = [];
    rs.forEach((r, i) => {
      let s = r.a * 10; const prev = rs[i - 1];
      if (prev && r.v < prev.v) {
        const v1 = prev.v / 3.6; const v2 = r.v / 3.6;
        let lead = Math.min(LEAD_MAX_M, Math.max(0, (v1 * v1 - v2 * v2) / (2 * LEAD_DECEL) - (r.k === 1 ? CURVE_BEFORE_M : 0)));
        const prevStart = limits[limits.length - 1].s;
        const room = prev.k === 0 ? (s - prevStart) - minZone : (s - prevStart) * 0.5;
        lead = Math.max(0, Math.min(lead, room));
        s -= lead;
      }
      limits.push({ s: i === 0 ? 0 : s, kmh: r.v });
      zones.push({ s0: r.a * 10, s1: Math.min(totalLen, r.b * 10), kmh: r.v, kind: r.k === 1 ? 'curve' : r.k === 2 ? 'gap' : 'base' });
    });
    return { limits, zones };
  }

  function buildForward(def) {
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
    const YG = new Float64Array(n);          // ground profile (no tunnel dip / bridge rise)
    const Z = new Float64Array(n);
    const TH = new Float64Array(n);
    const kappa = new Float64Array(n);
    const grade = new Float64Array(n);
    const LAT2 = new Float64Array(n);        // lateral position of the opposite track (negative = left of the player's track)
    const SRC2 = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = m.X[i0 + i] - ox;
      Z[i] = m.Z[i0 + i] - oz;
      Y[i] = m.Yabs[i0 + i] - oy;
      YG[i] = m.Yground[i0 + i] - oy;
      TH[i] = m.TH[i0 + i];
      kappa[i] = m.kappa[i0 + i];
      LAT2[i] = m.opp.lat[i0 + i];
      SRC2[i] = m.opp.src[i0 + i];
    }
    for (let i = 0; i < n; i++) grade[i] = (Y[Math.min(n - 1, i + 1)] - Y[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * STEP);
    const length = (n - 1) * STEP;
    // opposite track samples (same indices as the player's track, so rails and wires share their sample points)
    const X2 = new Float64Array(n);
    const Z2 = new Float64Array(n);
    const TH2 = new Float64Array(n);
    const kappa2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X2[i] = X[i] + Math.cos(TH[i]) * LAT2[i];
      Z2[i] = Z[i] + Math.sin(TH[i]) * LAT2[i];
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      TH2[i] = Math.atan2(X2[b] - X2[a], -(Z2[b] - Z2[a]));
    }
    for (let i = 1; i < n; i++) { while (TH2[i] - TH2[i - 1] > Math.PI) TH2[i] -= 2 * Math.PI; while (TH2[i] - TH2[i - 1] < -Math.PI) TH2[i] += 2 * Math.PI; }
    for (let i = 1; i < n - 1; i++) kappa2[i] = (TH2[i + 1] - TH2[i - 1]) / (2 * STEP);

    /* ---- stations */
    const stations = [];
    for (let k = spec.from; k <= spec.to; k++) {
      const st = m.stops[k];
      const marker = st.sMid + MARKER_AHEAD - sStart;
      stations.push({
        id: 'st' + stations.length, name: st.name, s: marker, platformStart: marker + 4 - PLATFORM_LEN, platformEnd: marker + 4,
        side: st.side, kind: st.kind, size: CROWD[st.name] || 1, terminus: k === spec.from || k === spec.to,
        edge: st.edge, width: st.width, oppLat: st.oppLat,
      });
    }

    /* ---- attribute lookup (speed, surface, power) */
    const segAt = (sAbs) => {
      for (let i = 0; i < m.segs.length; i++) if (sAbs < m.segs[i].s1) return m.segs[i];
      return m.segs[m.segs.length - 1];
    };
    const segs = m.segs.filter((q) => q.s1 > sStart && q.s0 < sEnd).map((q) => ({ s0: Math.max(0, q.s0 - sStart), s1: Math.min(length, q.s1 - sStart), speed: q.speed, surf: q.surf, flags: q.flags, elec: q.elec }));
    const noPower = segs.filter((q) => q.elec !== 1 && !(q.flags & 2));

    /* ---- limits (rounded to multiples of 10, 25 only where really needed; no artificial stop zones: braking for a stop is the driver's job) */
    const roundLimit = (kmh) => (kmh <= 27 ? 25 : Math.min(MAX_KMH, Math.max(30, Math.round((kmh - 0.1) / 10) * 10)));
    const motorway = m.bridges.find((b) => !b.name && b.s0 < RISE_BRIDGE_MAX_S && b.s1 - b.s0 < 200) || null;
    const forest = motorway ? [m.stops[1].sMid + MARKER_AHEAD + 4, motorway.s0 - FOREST_BRIDGE_PAD] : null;   // absolute path coordinates: Héienhaff platform end .. A1 bridge
    const centre = [Math.max(0, m.stops[10].sMid - CENTRE_PAD - sStart), Math.max(0, m.stops[16].sMid + CENTRE_PAD - sStart)];
    /* per-direction samples every 10 m: the line speed and the bend limit (rev = measured in the direction of the return route) */
    const limitSamples = (rev) => {
      const baseV = []; const curveV = [];
      for (let sp = 0; sp <= length; sp += 10) {
        const s = rev ? Math.max(0, length - sp) : sp;
        const abs = s + sStart;
        const q = segAt(abs);
        // the OSM maxspeed, never above the normal line speed; OSM's 15-25 km/h marks bends / station throats / crossings: the bends come from the geometry below, so the line speed is 30 at least
        let v = Math.max(30, Math.min(MAX_NORMAL_KMH, q.speed > 0 ? q.speed : DEFAULT_KMH));
        if (forest && q.speed >= 60 && abs >= forest[0] && abs <= forest[1]) v = FOREST_STRETCH_KMH;   // the segregated forest stretch (OSM 60 / 70 inside the window)
        baseV.push(roundLimit(v));
        const ia = clamp(Math.round(s / STEP), 0, n - 1);
        let kmax = 0;   // tightest curve within +-10 m
        for (let d = -5; d <= 5; d++) kmax = Math.max(kmax, Math.abs(kappa[clamp(ia + d, 0, n - 1)]));
        curveV.push(kmax > 1 / CURVE_R_30 ? (kmax > 1 / CURVE_R_25 ? 25 : 30) : Infinity);
      }
      return { baseV, curveV };
    };
    const fwdS = limitSamples(false); const revS = limitSamples(true);
    const fwdL = buildTramLimits(fwdS.baseV, fwdS.curveV, length, MIN_ZONE);
    const revL = buildTramLimits(revS.baseV, revS.curveV, length, MIN_ZONE);
    const limits = fwdL.limits;

    /* ---- bridges / tunnels in route coordinates */
    // `rise` = deck height above the ground profile (the motorway bridge before Luxexpo), `depth` = rail level below the ground (Héienhaff tunnels);
    // the real OSM extents (tunnel=yes / bridge=yes) are s0..s1, the ramps lie outside them (see groundYAt / cutAt)
    const bridges = m.bridges.filter((b) => b.s1 > sStart && b.s0 < sEnd).map((b) => ({ s0: Math.max(0, b.s0 - sStart), s1: Math.min(length, b.s1 - sStart), kind: 'steel', h: b.rise > 0 ? b.rise + 6 : b.name ? 60 : 12, rise: b.rise, over: b.rise > 0 ? 'motorway' : '', water: false, waterY: null, name: b.name }));
    const tunnels = m.tunnels.filter((b) => b.s1 > sStart && b.s0 < sEnd).map((b) => ({ s0: Math.max(0, b.s0 - sStart), s1: Math.min(length, b.s1 - sStart), depth: b.depth }));

    /* ---- frames (the opposite track has its own x/z/heading at the same sample indices; same elevation and grade) */
    const makeFrameAt = (PX, PY, PZ, PTH, PGRADE, PKAPPA) => (s, out) => {
      const f = out || { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0), grade: 0, curvature: 0 };
      let theta;
      let g;
      let k;
      if (s <= 0) {
        theta = PTH[0]; g = PGRADE[0]; k = 0;
        f.pos.set(PX[0] + Math.sin(theta) * s, PY[0] + g * s, PZ[0] - Math.cos(theta) * s);
      } else if (s >= (n - 1) * STEP) {
        const over = s - (n - 1) * STEP;
        theta = PTH[n - 1]; g = PGRADE[n - 1]; k = 0;
        f.pos.set(PX[n - 1] + Math.sin(theta) * over, PY[n - 1] + g * over, PZ[n - 1] - Math.cos(theta) * over);
      } else {
        const fi = s / STEP;
        const i = Math.floor(fi);
        const t = fi - i;
        theta = lerp(PTH[i], PTH[i + 1], t);
        g = lerp(PGRADE[i], PGRADE[i + 1], t);
        k = lerp(PKAPPA[i], PKAPPA[i + 1], t);
        f.pos.set(lerp(PX[i], PX[i + 1], t), lerp(PY[i], PY[i + 1], t), lerp(PZ[i], PZ[i + 1], t));
      }
      const cp = 1 / Math.sqrt(1 + g * g);
      f.tangent.set(Math.sin(theta) * cp, g * cp, -Math.cos(theta) * cp);
      f.right.set(Math.cos(theta), 0, Math.sin(theta));
      f.up.set(0, 1, 0);
      f.grade = g;
      f.curvature = k;
      return f;
    };
    const frameAt = makeFrameAt(X, Y, Z, TH, grade, kappa);
    const oppFrameAt = makeFrameAt(X2, Y, Z2, TH2, grade, kappa2);
    const oppFrom = Math.max(0, m.oppRange[0] - sStart);
    const oppTo = Math.min(length, m.oppRange[1] - sStart);
    const oppLatAt = (s) => { const fi = clamp(s / STEP, 0, n - 1); const i = Math.floor(fi); return lerp(LAT2[i], LAT2[Math.min(n - 1, i + 1)], fi - i); };
    const groundYAt = (s) => { const fi = clamp(s / STEP, 0, n - 1); const i = Math.floor(fi); return lerp(YG[i], YG[Math.min(n - 1, i + 1)], fi - i); };

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
      const i0 = clamp(Math.floor(q.i), 0, n - 2);
      const u = clamp(q.i - i0, 0, 1);
      const dY = lerp(YG[i0] - Y[i0], YG[i0 + 1] - Y[i0 + 1], u);   // ground above (+) / below (-) the rails
      const formY = q.y - FORMATION_DROP;
      const bm = bridgeMask(q.s);
      let h = formY + dY + relief(q.s, q.lat);
      const cov = coverAt(q.s);
      if (cov > 0.01) h = Math.max(h, formY + cov * (1 - smooth01(Math.max(0, q.d - 4) / 30)));   // the ground closes over a tunnel
      const delta = Math.abs(dY);
      // distance outside the double-track corridor (both tracks stay level), then the trench / embankment slope
      const sep = -oppLatAt(q.s);
      const dOut = q.lat >= 0 ? q.lat : (-q.lat > sep ? -q.lat - sep : 0);
      const w = (1 - smooth01((dOut - (2.6 + 0.5 * delta)) / (7 + 1.6 * delta))) * (1 - bm) * (1 - Math.min(1, cov / 6));
      return lerp(h, formY, w);
    }

    /* ---- platforms, helpers */
    const platformInfo = (i) => {
      const st = stations[i];
      if (!st) return null;
      const edge = st.edge || 1.5;
      const width = st.width || 3.0;
      return {
        edge, width, backEdge: edge + width, height: 0.3, sideSign: st.side === 'right' ? 1 : -1, kind: st.kind || 'side',
        oppLat: st.oppLat != null ? st.oppLat : oppLatAt(st.s),
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
      // second (opposite, left-hand) track: same sample indices as the player's track; frameAt(s) returns the opposite track's frame at the same s
      opposite: {
        frameAt: oppFrameAt, latAt: oppLatAt, from: oppFrom, to: oppTo, source: SRC2, lat: LAT2, sample: STEP,
        has: (s) => s >= oppFrom && s <= oppTo,
      },
      // vertical alignment: ground profile (no tunnel dip / bridge rise) and the cut (+) / fill (-) of the rails below / above it
      groundYAt, cutAt: (s) => groundYAt(s) - frameAt(s).pos.y,
      luxtram: {
        sStart, sEnd, origin: { x: ox, y: oy, z: oz }, segs, credit: CREDIT, centre, minZone: MIN_ZONE, minZoneCentre: MIN_ZONE_CENTRE,
        zones: fwdL.zones, limitsRev: revL.limits, zonesRev: revL.zones, curveSamples: fwdS.curveV, forestStretchKmh: FOREST_STRETCH_KMH, forestWindow: forest ? [forest[0] - sStart, forest[1] - sStart] : null,
        motorwayBridge: motorway ? [motorway.s0 - sStart, motorway.s1 - sStart] : null,
        toRoute: (sAbs) => sAbs - sStart,
        absFromOrig: (sOrig) => m.toNew(sOrig),
        origFromAbs: (sAbs) => m.toOrig(sAbs),
      },
    };
  }

  /* The return direction runs on the OTHER (left-hand) track: the OSM second track becomes the player's track and the forward track the
     opposite one. Same ground, same coordinates (origin), same platforms; every platform is on the right of the travel direction. The scenery
     (landscape / TS.luxtramWorld) is always built from the forward track (`track.base`) and fed track.baseS(s). */
  function buildReversed(def) {
    const base = buildForward(def.base);
    const L = base.length;
    const o = base.opposite;
    const centre = [L - base.luxtram.centre[1], L - base.luxtram.centre[0]];
    const minLenAt = (s) => (s >= centre[0] && s <= centre[1] ? MIN_ZONE_CENTRE : MIN_ZONE);
    const rev = TS.track.reverse(base, { id: def.id, def, sides: 'right', playerFrameAt: o.frameAt, minLenAt });
    const flip = (f) => { f.tangent.negate(); f.right.negate(); f.grade = -f.grade; f.curvature = -f.curvature; return f; };
    const sepAt = (s) => -o.latAt(s);
    // platforms: the reversed player's platform is the opposite track's side platform of the forward direction (or the same island)
    rev.stations.forEach((st) => {
      const sMid = (st.platformStart + st.platformEnd) / 2;
      const fwd = base.stations[base.stations.length - 1 - rev.stations.indexOf(st)];
      const sep = Math.max(2.6, sepAt(L - sMid));
      if (fwd.kind === 'island') { st.kind = 'island'; st.width = fwd.width; st.edge = Math.max(1.25, sep - (fwd.edge + fwd.width)); }
      st.oppLat = -sep;
    });
    const basePlatform = rev.platformInfo;
    rev.platformInfo = (j) => {
      const p = basePlatform(j);
      const st = rev.stations[j];
      if (!p || !st) return p;
      return Object.assign({}, p, { edge: st.edge || p.edge, width: st.width || p.width, backEdge: (st.edge || p.edge) + (st.width || p.width), kind: st.kind || 'side', oppLat: st.oppLat, sideSign: 1,
        exits: p.exits.map((e) => ({ s: e.s, lat: (st.edge || p.edge) + (st.width || p.width) / 2 })) });
    };
    const rA = (arr) => Float64Array.from(arr).reverse();
    rev.opposite = {
      frameAt: (s, out) => flip(base.frameAt(L - s, out)),
      latAt: (s) => o.latAt(L - s),
      from: L - o.to, to: L - o.from, sample: o.sample,
      has: (s) => o.has(L - s),
      source: Uint8Array.from(o.source).reverse(), lat: rA(o.lat),
    };
    const lt = base.luxtram;
    rev.luxtram = Object.assign({}, lt, {
      reversed: true, centre, zones: lt.zonesRev, segs: lt.segs.map((q) => Object.assign({}, q, { s0: L - q.s1, s1: L - q.s0 })).sort((a, b) => a.s0 - b.s0),
      toRoute: (sAbs) => L - (sAbs - lt.sStart), motorwayBridge: lt.motorwayBridge ? [L - lt.motorwayBridge[1], L - lt.motorwayBridge[0]] : null,
    });
    rev.limits = lt.limitsRev;   // built for the return direction itself (curve margins ahead of / behind the bend in the direction of travel), not mirrored
    rev.groundYAt = (s) => base.groundYAt(L - s);
    rev.cutAt = (s) => base.cutAt(L - s);
    return rev;
  }
  function build(def) { return def && def.reverse && def.base ? buildReversed(def) : buildForward(def); }

  /* ------------------------------------------------------------ registries */
  function makeRouteDef(sec) {
    const names = STOP_NAMES.slice(sec.from, sec.to + 1);
    const def = {
      id: sec.id, kind: 'tram', region: 'Stad', cruise: 70, biomes: ['tramcity'], name: sec.name, stations: names,
      luxtram: { from: sec.from, to: sec.to }, stationDefaults: { platformLen: PLATFORM_LEN, approachBefore: APPROACH_BEFORE, approachAfter: APPROACH_AFTER },
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
    TS.routes = TS.routeDir ? TS.routeDir.makeRoutes(list) : Object.freeze({ list, get: (id) => byId[id] || null });

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
    TS.luxtram = { registered: true, sections: SECTIONS.map((s) => s.id), build, prefetch, preload, credit: CREDIT, getModel };
    prefetch();
  }

  function wrapInfra() {
    if (!TS.infra || !TS.infra.create) return;
    const base = TS.infra.create;
    TS.infra = Object.assign({}, TS.infra, {
      create(scene, track, options) {
        if (!track || !track.luxtram) return base.apply(this, arguments);
        // the generic tram street and bridge are replaced by the real thing (TS.luxtramWorld)
        // (the world draws the bridges and the tunnel / underpass structures; infra only adds rails, wires, platforms and furniture)
        const proxy = Object.create(track, { bridges: { value: [], enumerable: true }, tunnels: { value: [], enumerable: true } });
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
          progress: () => world.progress(),            // real download progress of the opening tiles (loading bar)
          pendingAhead: () => world.pendingAhead(),    // detailed tiles ahead that have not arrived yet ("Lueden" indicator)
          dispose() { world.dispose(); land.dispose(); },
          luxtramWorld: world,
          groundAt: (x, z) => (typeof world.groundAt === 'function' ? world.groundAt(x, z) : NaN),   // real DTM (chase camera clearance)
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
