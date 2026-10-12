/* Lokféierer: track geometry.
 * TS.track.build(routeDef) -> Track (see CONTRACT.md) plus a few helpers:
 *   track.nearest(x, z) -> { s, d, lat, y }   closest point on the track (d = distance, lat = signed, + = right)
 *   track.nearestS(x, z) -> s
 *   track.distanceToTrack(x, z) -> metres
 *   track.formationDrop      metres the ground lies below the rail top next to the track (0.55 rail, 0.06 tram)
 *   track.water(s) -> { y, side, offset, halfWidth } | null   river running alongside (biome 'river')
 *   track.inTunnel(s), track.bridgeAt(s), track.stationAt(s)
 *   track.platformInfo(i) -> { edge, width, backEdge, height, sideSign, s0, s1, sMarker, exits:[{s, lat}] }
 *   track.corridorHalfWidth(s, side) / track.isReserved(x, z): space taken by infra (platforms, buildings, crossing roads)
 * Conventions: forward at heading 0 is -Z, +X is right. Curvature is signed, + = turning right. */
(function () {
  'use strict';
  window.TS = window.TS || {};
  const T = THREE;

  const STEP = 2; // m between precomputed samples
  const CELL = 40; // spatial hash cell
  const COARSE = 4; // samples between hashed points
  const MAX_RING = 6;
  const FORM_RAIL = 0.55;
  const FORM_TRAM = 0.06;
  const D0_BASE = 7.5; // flat formation half-width
  const D0_STATION = 26;
  const STATION_MASK_PAD = 14;
  const GRADE_SCALE = 2.4; // authored grades are scaled so the hills read in a short compressed route
  const GRADE_MAX = { rail: 0.025, hst: 0.035, tram: 0.06 };
  const SMOOTH = { rail: { curve: 60, grade: 100 }, hst: { curve: 220, grade: 260 }, tram: { curve: 9, grade: 22 } };
  const LATERAL_ACCEL = 1.3; // m/s2: curve speed v = sqrt(a * R)
  const BRAKE_LEAD = { rail: [0.8, 900], hst: [0.75, 1500], tram: [0.8, 120] };
  const RELIEF = {
    // amp = noise amplitude, valley = hills rising away from the track, width = how far to full height
    city: { amp: 1.2, valley: 2, width: 120 },
    tramcity: { amp: 0, valley: 0, width: 100 },
    suburb: { amp: 3, valley: 4, width: 140 },
    farmland: { amp: 5, valley: 6, width: 160 },
    forest: { amp: 8, valley: 16, width: 120 },
    ardennes: { amp: 16, valley: 42, width: 110 },
    vineyard: { amp: 10, valley: 30, width: 130 },
    river: { amp: 4, valley: 14, width: 140 },
    industrial: { amp: 3, valley: 3, width: 150 },
    highspeed: { amp: 6, valley: 5, width: 200 },
  };
  const RIVER_OFFSET = 95;
  const RIVER_HALF = 24;
  const RIVER_BELOW = 6;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = (t) => {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------- noise */
  function makeNoise(seed) {
    const hash = (ix, iz) => {
      let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967295;
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const value = (x, z) => {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const fx = fade(x - ix);
      const fz = fade(z - iz);
      const a = hash(ix, iz);
      const b = hash(ix + 1, iz);
      const c = hash(ix, iz + 1);
      const d = hash(ix + 1, iz + 1);
      return lerp(lerp(a, b, fx), lerp(c, d, fx), fz) * 2 - 1;
    };
    return (x, z) => value(x / 230, z / 230) * 0.62 + value(x / 90 + 17, z / 90 - 5) * 0.28 + value(x / 34 - 3, z / 34 + 9) * 0.1;
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /* ------------------------------------------------------- array tools */
  function boxBlur(src, radius) {
    if (radius < 1) return Float64Array.from(src);
    const n = src.length;
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[i];
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - radius);
      const b = Math.min(n - 1, i + radius);
      // pad the ends with the edge value so the profile keeps its magnitude
      const padA = radius - (i - a);
      const padB = radius - (b - i);
      const sum = prefix[b + 1] - prefix[a] + padA * src[0] + padB * src[n - 1];
      out[i] = sum / (2 * radius + 1);
    }
    return out;
  }

  /* ----------------------------------------------------------- compile */
  function curveLimit(radius, kind) {
    const a = kind === 'hst' ? 1.6 : kind === 'tram' ? 1.1 : LATERAL_ACCEL;
    const kmh = 3.6 * Math.sqrt(a * radius);
    return Math.max(15, Math.floor(kmh / 5) * 5);
  }

  function compileItems(def) {
    const kind = def.kind;
    const sd = def.stationDefaults;
    const lastIndex = def.layout.length - 1;
    const result = { items: [], stations: [], tunnels: [], bridges: [], crossings: [], biomes: [], limitsRaw: [], length: 0 };
    let s = 0;
    let cruise = def.cruise;
    let biome = (def.biomes && def.biomes[0]) || 'farmland';
    let stationCount = 0;
    def.layout.forEach((it, index) => {
      let len;
      if (it.t === 'station') {
        const first = stationCount === 0;
        const last = index === lastIndex;
        const before = first ? 10 : sd.approachBefore;
        const after = last ? 45 : sd.approachAfter;
        len = before + sd.platformLen + after;
        const platformStart = s + before;
        const platformEnd = platformStart + sd.platformLen;
        result.stations.push({
          id: 'st' + stationCount,
          name: it.name,
          s: platformEnd - (kind === 'tram' ? 4 : 14),
          platformStart,
          platformEnd,
          side: it.side,
          size: it.size,
          terminus: first || last,
        });
        stationCount += 1;
        if (it.biome) biome = it.biome;
        result.biomes.push({ s, biome });
        result.limitsRaw.push({ s, kmh: Math.min(cruise, sd.stationLimit), station: true });
        result.items.push({ t: 'station', s0: s, s1: s + len, kappa: 0, g: 0 });
      } else {
        len = it.len;
        if (it.limit) cruise = it.limit;
        if (it.biome) {
          biome = it.biome;
          result.biomes.push({ s, biome });
        }
        const kmh = it.t === 'c' ? Math.min(cruise, curveLimit(it.r, kind)) : cruise;
        result.limitsRaw.push({ s, kmh });
        const kappa = it.t === 'c' ? (it.dir === 'R' ? 1 : -1) / it.r : 0;
        result.items.push({ t: it.t, s0: s, s1: s + len, kappa, g: (it.g || 0) / 100 });
        if (it.tunnel) result.tunnels.push({ s0: s, s1: s + len });
        if (it.bridge) {
          result.bridges.push({ s0: s, s1: s + len, kind: it.bridge.kind, h: it.bridge.h, water: !!it.bridge.water });
        }
        if (it.crossing && it.t === 's') result.crossings.push({ s: s + len / 2 });
      }
      s += len;
    });
    result.length = s;
    if (!result.biomes.length || result.biomes[0].s > 0) result.biomes.unshift({ s: 0, biome });
    return result;
  }

  // Post limit boards earlier ahead of reductions so the driver can brake in time.
  function buildLimits(raw, kind) {
    const [decel, cap] = BRAKE_LEAD[kind];
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
      const lead = Math.min(cap, (v1 * v1 - v2 * v2) / (2 * decel), (e.s - prev.s) * 0.85);
      return { s: Math.max(prev.s + 20, e.s - lead), kmh: e.kmh };
    });
    const sorted = shifted.slice().sort((a, b) => a.s - b.s);
    sorted[0] = { s: 0, kmh: sorted[0].kmh };
    return sorted.filter((e, i) => i === 0 || (e.s - sorted[i - 1].s > 25 && e.kmh !== sorted[i - 1].kmh));
  }

  function buildSignals(stations, tunnels, bridges, kind, length) {
    if (kind === 'tram') return [];
    const blocked = (s) => tunnels.some((t) => s > t.s0 - 20 && s < t.s1 + 5) || bridges.some((b) => s > b.s0 - 20 && s < b.s1 + 5);
    const place = (s) => {
      let out = s;
      const tun = tunnels.find((t) => out > t.s0 - 20 && out < t.s1 + 5);
      if (tun) out = tun.s1 + 25;
      const br = bridges.find((b) => out > b.s0 - 20 && out < b.s1 + 5);
      if (br) out = br.s1 + 25;
      return out;
    };
    const fixed = [];
    stations.forEach((st, i) => {
      if (i > 0) fixed.push({ s: place(st.platformStart - 150), kind: 'main', role: 'home', stationIndex: i });
      if (i < stations.length - 1) fixed.push({ s: place(st.platformEnd + 25), kind: 'main', role: 'exit', stationIndex: i });
    });
    fixed.sort((a, b) => a.s - b.s);
    const all = [];
    fixed.forEach((sig, i) => {
      const prev = fixed[i - 1];
      if (prev && prev.role === 'exit' && sig.role === 'home') {
        const gap = sig.s - prev.s;
        const n = Math.floor(gap / 1800);
        for (let k = 1; k <= n; k++) {
          const s = place(prev.s + (gap * k) / (n + 1));
          if (!blocked(s) && s < sig.s - 300) all.push({ s, kind: 'main', role: 'block' });
        }
      }
      all.push(sig);
    });
    return all.filter((sig) => sig.s > 30 && sig.s < length - 30).sort((a, b) => a.s - b.s);
  }

  /* ------------------------------------------------------------- build */
  function build(def) {
    if (!def || !def.layout) throw new Error('[Lokféierer] TS.track.build: bad route definition');
    const kind = def.kind;
    const formationDrop = kind === 'tram' ? FORM_TRAM : FORM_RAIL;
    const comp = compileItems(def);
    const length = comp.length;
    const n = Math.floor(length / STEP) + 1;
    const smoothing = SMOOTH[kind] || SMOOTH.rail;
    const noise = makeNoise(hashString(def.id));

    // station mask: 1 inside a station zone, fading out (used to force straight + level + wide flat ground)
    const stationMask = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      let m = 0;
      for (const st of comp.stations) {
        const dist = Math.max(st.platformStart - STATION_MASK_PAD - s, s - st.platformEnd - STATION_MASK_PAD, 0);
        m = Math.max(m, 1 - smooth01(dist / 45));
      }
      stationMask[i] = m;
    }

    // flat zone around level crossings (terrain only; the road needs level ground)
    const crossMask = new Float64Array(n);
    comp.crossings.forEach((c) => {
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(i * STEP - c.s);
        crossMask[i] = Math.max(crossMask[i], 1 - smooth01((dist - 8) / 26));
      }
    });

    // raw curvature + grade per sample
    const kRaw = new Float64Array(n);
    const gRaw = new Float64Array(n);
    let itemIndex = 0;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (itemIndex < comp.items.length - 1 && s >= comp.items[itemIndex].s1) itemIndex++;
      kRaw[i] = comp.items[itemIndex].kappa;
      gRaw[i] = comp.items[itemIndex].g * GRADE_SCALE;
    }
    const kappaSm = boxBlur(boxBlur(kRaw, Math.round(smoothing.curve / STEP)), Math.round(smoothing.curve / STEP / 2));
    const gradeSm = boxBlur(boxBlur(gRaw, Math.round(smoothing.grade / STEP)), Math.round(smoothing.grade / STEP / 2));
    const gradeMax = GRADE_MAX[kind] || 0.025;
    const kappa = new Float64Array(n);
    const grade = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      kappa[i] = kappaSm[i] * (1 - stationMask[i]);
      grade[i] = clamp(gradeSm[i] * (1 - stationMask[i]), -gradeMax, gradeMax);
    }

    // integrate heading and position
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    const Z = new Float64Array(n);
    const TH = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const k = (kappa[i - 1] + kappa[i]) / 2;
      TH[i] = TH[i - 1] + k * STEP;
      const mid = (TH[i - 1] + TH[i]) / 2;
      X[i] = X[i - 1] + Math.sin(mid) * STEP;
      Z[i] = Z[i - 1] - Math.cos(mid) * STEP;
      Y[i] = Y[i - 1] + ((grade[i - 1] + grade[i]) / 2) * STEP;
    }

    /* ---- frames */
    function frameAt(s, out) {
      const f = out || { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(0, 1, 0), grade: 0, curvature: 0 };
      let theta;
      let g;
      let k;
      if (s <= 0) {
        theta = TH[0];
        g = grade[0];
        k = 0;
        f.pos.set(X[0] + Math.sin(theta) * s, Y[0] + g * s, Z[0] - Math.cos(theta) * s);
      } else if (s >= (n - 1) * STEP) {
        const over = s - (n - 1) * STEP;
        theta = TH[n - 1];
        g = grade[n - 1];
        k = 0;
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
    }

    const heightAtS = (s) => {
      const fi = clamp(s / STEP, 0, n - 1.0001);
      const i = Math.floor(fi);
      return lerp(Y[i], Y[i + 1], fi - i);
    };

    /* ---- stations / signals / limits */
    const stations = comp.stations;
    const limits = buildLimits(comp.limitsRaw, kind);
    const signals = buildSignals(stations, comp.tunnels, comp.bridges, kind, length);

    const bridges = comp.bridges.map((b) => {
      const mid = (b.s0 + b.s1) / 2;
      const waterY = b.water ? heightAtS(mid) - formationDrop - b.h + 1.2 : null;
      return Object.assign({}, b, { waterY });
    });

    /* ---- biome lookup */
    const biomeKeys = comp.biomes;
    function biomeAt(s) {
      let lo = 0;
      let hi = biomeKeys.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (biomeKeys[mid].s <= s) lo = mid;
        else hi = mid - 1;
      }
      return biomeKeys[lo].biome;
    }

    /* ---- relief profiles along s (smoothed) */
    const ampRaw = new Float64Array(n);
    const valRaw = new Float64Array(n);
    const widRaw = new Float64Array(n);
    const riverRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const biome = biomeAt(i * STEP);
      const r = RELIEF[biome] || RELIEF.farmland;
      ampRaw[i] = r.amp;
      valRaw[i] = r.valley;
      widRaw[i] = r.width;
      riverRaw[i] = biome === 'river' ? 1 : 0;
    }
    const blurR = Math.round(160 / STEP);
    const ampArr = boxBlur(ampRaw, blurR);
    const valArr = boxBlur(valRaw, blurR);
    const widArr = boxBlur(widRaw, blurR);
    const riverArr = boxBlur(riverRaw, Math.round(120 / STEP));

    const cover = new Float64Array(n);
    comp.tunnels.forEach((tn) => {
      const hc = Math.min(48, 16 + (tn.s1 - tn.s0) * 0.07);
      const i0 = Math.max(0, Math.floor(tn.s0 / STEP));
      const i1 = Math.min(n - 1, Math.ceil(tn.s1 / STEP));
      for (let i = i0; i <= i1; i++) {
        const s = i * STEP;
        const a = Math.min(s - tn.s0, tn.s1 - s);
        cover[i] = Math.max(cover[i], Math.max(8.5 * smooth01(a / 8), hc * smooth01(a / 90)));
      }
    });
    const depth = new Float64Array(n);
    bridges.forEach((b) => {
      const i0 = Math.max(0, Math.floor(b.s0 / STEP));
      const i1 = Math.min(n - 1, Math.ceil(b.s1 / STEP));
      for (let i = i0; i <= i1; i++) {
        const u = clamp((i * STEP - b.s0) / (b.s1 - b.s0), 0, 1);
        depth[i] = Math.max(depth[i], b.h * Math.pow(Math.sin(Math.PI * u), 0.7));
      }
    });

    /* ---- spatial hash for nearest-point queries */
    const grid = new Map();
    const cellKey = (ix, iz) => ix * 73856 + iz * 19349;
    const coarseCount = Math.floor((n - 1) / COARSE) + 1;
    for (let c = 0; c < coarseCount; c++) {
      const i = Math.min(n - 1, c * COARSE);
      const key = cellKey(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    const FAR_STRIDE = 16;

    function nearest(x, z, out) {
      const res = out || { s: 0, d: 0, lat: 0, y: 0 };
      const ix = Math.floor(x / CELL);
      const iz = Math.floor(z / CELL);
      let best = Infinity;
      let bi = -1;
      const scan = (cx, cz) => {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) return;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          const dx = X[i] - x;
          const dz = Z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      };
      for (let r = 0; r <= MAX_RING; r++) {
        if (r === 0) scan(ix, iz);
        else {
          for (let dx = -r; dx <= r; dx++) {
            scan(ix + dx, iz - r);
            scan(ix + dx, iz + r);
          }
          for (let dz = -r + 1; dz <= r - 1; dz++) {
            scan(ix - r, iz + dz);
            scan(ix + r, iz + dz);
          }
        }
        if (bi >= 0 && best <= r * CELL * (r * CELL)) break;
      }
      if (bi < 0) {
        for (let i = 0; i < n; i += FAR_STRIDE) {
          const dx = X[i] - x;
          const dz = Z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
        // refine over the far stride
        const lo = Math.max(0, bi - FAR_STRIDE);
        const hi = Math.min(n - 1, bi + FAR_STRIDE);
        for (let i = lo; i <= hi; i++) {
          const dx = X[i] - x;
          const dz = Z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      } else {
        const lo = Math.max(0, bi - COARSE - 1);
        const hi = Math.min(n - 1, bi + COARSE + 1);
        for (let i = lo; i <= hi; i++) {
          const dx = X[i] - x;
          const dz = Z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      }
      // project on the two neighbouring segments
      let bestT = 0;
      let bestSeg = bi;
      let bestD2 = Infinity;
      for (let seg = Math.max(0, bi - 1); seg <= Math.min(n - 2, bi); seg++) {
        const ax = X[seg];
        const az = Z[seg];
        const bx = X[seg + 1] - ax;
        const bz = Z[seg + 1] - az;
        const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
        const px = ax + bx * t - x;
        const pz = az + bz * t - z;
        const d2 = px * px + pz * pz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestSeg = seg;
          bestT = t;
        }
      }
      if (bestD2 === Infinity) bestD2 = best;
      const fi = Math.min(bestSeg + bestT, n - 1);
      const theta = lerp(TH[bestSeg], TH[Math.min(n - 1, bestSeg + 1)], bestT);
      const cx = lerp(X[bestSeg], X[Math.min(n - 1, bestSeg + 1)], bestT);
      const cz = lerp(Z[bestSeg], Z[Math.min(n - 1, bestSeg + 1)], bestT);
      res.s = fi * STEP;
      res.d = Math.sqrt(bestD2);
      res.lat = (x - cx) * Math.cos(theta) + (z - cz) * Math.sin(theta);
      res.y = lerp(Y[bestSeg], Y[Math.min(n - 1, bestSeg + 1)], bestT);
      res.i = fi;
      return res;
    }

    const arrAt = (arr, fi) => {
      const f = clamp(fi, 0, n - 1.0001);
      const i = Math.floor(f);
      return lerp(arr[i], arr[i + 1], f - i);
    };

    const scratch = { s: 0, d: 0, lat: 0, y: 0, i: 0 };
    const riverSide = def.riverSide || 1;

    function waterLevelAtIndex(fi) {
      return arrAt(Y, fi) - formationDrop - RIVER_BELOW;
    }

    function terrainHeightAt(x, z) {
      const q = nearest(x, z, scratch);
      const fi = q.i;
      const trackY = q.y;
      const formY = trackY - formationDrop;
      const amp = arrAt(ampArr, fi);
      const valley = arrAt(valArr, fi);
      const width = arrAt(widArr, fi);
      const cov = arrAt(cover, fi);
      const dep = arrAt(depth, fi);
      const mask = Math.max(arrAt(stationMask, fi), arrAt(crossMask, fi) * 0.8);
      const nz = noise(x, z);

      let h = formY + nz * amp;
      h += valley * smooth01(q.d / width) * (0.6 + 0.4 * (nz * 0.5 + 0.5));
      if (cov > 0.01) h += cov * (1 - smooth01(q.d / (30 + cov * 1.6)));
      if (dep > 0.01) h -= dep * (1 - smooth01((q.d - (6 + dep * 0.35)) / (dep * 1.5 + 14)));

      const river = arrAt(riverArr, fi);
      if (river > 0.02) {
        const base = waterLevelAtIndex(fi) - 2.5;
        const amount = river * (1 - smooth01((Math.abs(q.lat - riverSide * RIVER_OFFSET) - RIVER_HALF) / 55));
        if (h > base) h = lerp(h, base, amount);
      }

      const d0 = D0_BASE + (D0_STATION - D0_BASE) * mask;
      const blend = 3 + Math.abs(h - formY) * 2.2 + 18 * mask;
      let w = 1 - smooth01((q.d - d0) / blend);
      w *= 1 - smooth01(cov / 5);
      w *= 1 - smooth01(dep / 1.5);
      return h + (formY - h) * w;
    }

    function water(s) {
      const fi = clamp(s / STEP, 0, n - 1.0001);
      if (arrAt(riverArr, fi) < 0.5) return null;
      return { y: waterLevelAtIndex(fi), side: riverSide, offset: RIVER_OFFSET, halfWidth: RIVER_HALF };
    }

    // Space reserved by TS.infra (platforms, buildings, crossing roads, tram street).
    function corridorHalfWidth(s, side) {
      const base = kind === 'tram' ? 8 : 6;
      const idx = stations.findIndex((st) => s >= st.platformStart - 24 && s <= st.platformEnd + 24);
      if (idx >= 0 && !(kind === 'tram')) {
        const platformSide = stations[idx].side === 'right' ? 1 : -1;
        return side === platformSide ? (stations[idx].name === 'Lëtzebuerg' && idx === 0 ? 34 : 26) : 10;
      }
      if (idx >= 0) return 9;
      return base;
    }
    function isReserved(x, z) {
      const q = nearest(x, z, { s: 0, d: 0, lat: 0, y: 0 });
      if (q.d > 40) return false;
      const side = q.lat >= 0 ? 1 : -1;
      if (q.d < corridorHalfWidth(q.s, side)) return true;
      return comp.crossings.some((c) => Math.abs(c.s - q.s) < 5 && q.d < 26);
    }

    // Platform geometry shared by TS.infra, TS.passengers and TS.sim (local lateral metres from the track axis).
    function platformInfo(i) {
      const st = stations[i];
      if (!st) return null;
      const tram = kind === 'tram';
      const big = !tram && st.size >= 3;
      const edge = tram ? 1.5 : 1.7;
      const width = tram ? 3.0 : big ? 7.0 : 5.2;
      return {
        edge, width, backEdge: edge + width, height: tram ? 0.3 : 0.76,
        sideSign: st.side === 'right' ? 1 : -1,
        s0: st.platformStart, s1: st.platformEnd, sMarker: st.s,
        exits: [{ s: st.platformStart - 14, lat: edge + width / 2 }, { s: st.platformEnd + 14, lat: edge + width / 2 }],
      };
    }

    const inTunnel = (s) => comp.tunnels.some((t) => s >= t.s0 && s <= t.s1);
    const bridgeAt = (s) => bridges.find((b) => s >= b.s0 && s <= b.s1) || null;
    const stationAt = (s) => stations.findIndex((st) => s >= st.platformStart && s <= st.platformEnd);

    return {
      id: def.id,
      kind,
      def,
      length,
      platformLen: def.stationDefaults.platformLen,
      formationDrop,
      frameAt,
      stations,
      signals,
      limits,
      tunnels: comp.tunnels,
      bridges,
      crossings: comp.crossings,
      biomeAt,
      terrainHeightAt,
      nearest: (x, z) => Object.assign({}, nearest(x, z, { s: 0, d: 0, lat: 0, y: 0 })),
      nearestS: (x, z) => nearest(x, z, scratch).s,
      distanceToTrack: (x, z) => nearest(x, z, scratch).d,
      water,
      inTunnel,
      bridgeAt,
      stationAt,
      corridorHalfWidth,
      isReserved,
      platformInfo,
    };
  }

  window.TS.track = { build, STEP };
})();
