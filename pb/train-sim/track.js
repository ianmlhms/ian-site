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
  const D0_RAIL = 10.5; // rail: the second main track + its ballast and masts need the formation to reach 8 m on one side
  const D0_STATION = 26;
  const VALLEY_MIN_H = 4;      // bridges at least this high get a finer ground mesh around them
  const VALLEY_PAD = 90;
  const VALLEY_ROW = 5;
  const VALLEY_COL_MARGIN = 260; // the extra columns reach one chunk beyond the valley rows: the shared edge of two chunks has the same vertices on both sides (no crack where the valley wall fades)
  const VALLEY_LAT = 112;
  const VALLEY_LAT_STEP = 7;
  const PASS_LIMIT = 110; // km/h through a station the service does not stop at
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
  const REAL_RELIEF_GAIN = 1.1;   // real line: the generic valley term is scaled by (0.6 + 0.4 noise) <= 1, so the real heights are lifted a little
  const REAL_RELIEF_WIDTH = 200;  // ... and reached at this lateral distance

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth01 = (t) => {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------- noise */
  const TAIL_NOISE_BLEND = 700;       // m over which the hills of a shared tail take over from the world-position noise
  const TAIL_ANCHOR = 'Tréier Hafestrooss';   // from this station on the two services of the Mosel line have the same geometry
  const TAIL_NOISE_OFFSET = 40000;     // keeps the tail-frame noise away from the origin of the world noise
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
  /* blur of a quantity that only exists where weight > 0 (river centre line): weighted average, 0 where there is no weight */
  function weightedBlur(values, weight, radius) {
    const num = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) num[i] = values[i] * weight[i];
    const a = boxBlur(num, radius);
    const w = boxBlur(weight, radius);
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = w[i] > 1e-4 ? a[i] / w[i] : 0;
    return out;
  }

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
    const result = { items: [], stations: [], tunnels: [], bridges: [], crossings: [], biomes: [], limitsRaw: [], legs: [], length: 0 };
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
        result.legs.push({ id: 'st:' + it.name, s0: s, s1: s + len });   // real line: the station block has its own scenery record
        result.stations.push({
          id: 'st' + stationCount,
          name: it.name,
          s: platformEnd - (kind === 'tram' ? 4 : 14),
          platformStart,
          platformEnd,
          side: it.side,
          size: it.size,
          platformWidth: it.pw,
          terminus: first || last,
        });
        stationCount += 1;
        if (it.biome) biome = it.biome;
        result.biomes.push({ s, biome });
        const passing = (def.passNames || []).includes(it.name);   // an express runs through this station at line speed
        result.limitsRaw.push({ s, kmh: Math.min(cruise, passing ? PASS_LIMIT : sd.stationLimit), station: true });
        result.items.push({ t: 'station', s0: s, s1: s + len, kappa: 0, g: 0 });
      } else {
        len = it.len;
        if (it.legId) {   // real-line legs: the scenery data of data/real/mosel-features.json is keyed by the leg id
          const last = result.legs[result.legs.length - 1];
          if (last && last.id === it.legId) last.s1 = s + len;
          else result.legs.push({ id: it.legId, s0: s, s1: s + len });
        }
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
  function buildLimits(raw, kind, length) {
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
    return tidyLimits(sorted.filter((e, i) => i === 0 || (e.s - sorted[i - 1].s > 25 && e.kmh !== sorted[i - 1].kmh)), kind, length);
  }

  /* Real lines: limits in steps of 10 km/h and no zone shorter than MIN_ZONE_M (Ian: boards close together, e.g. 110 for 30 m, then 80).
     A too-short zone is merged into the neighbour with the closer speed and takes the lower of the two (never faster than before).
     The Luxtram builds its own limits (luxtram.js buildLimits, same minimum of 300 m) and passes through here again when its return direction is mirrored. */
  const MIN_ZONE_M = { rail: 400, hst: 800, tram: 300 };
  const ROUND_KMH = { rail: 10, hst: 10, tram: 5 };   // the Luxtram keeps its 25 km/h curves
  function tidyLimits(limits, kind, length) {
    const minZone = MIN_ZONE_M[kind];
    if (!minZone || !limits.length) return limits;
    const step = ROUND_KMH[kind] || 10;
    let zones = limits.map((l) => ({ s: l.s, kmh: Math.max(step === 5 ? 15 : 10, Math.floor(l.kmh / step) * step) }));
    const dedupe = (list) => list.filter((z, i) => i === 0 || z.kmh !== list[i - 1].kmh);
    zones = dedupe(zones);
    for (let guard = 0; guard < 200 && zones.length > 1; guard++) {
      // shortest zone that is not the last one (the last runs to the end of the line)
      let k = -1;
      let shortest = minZone;
      for (let i = 0; i < zones.length - 1; i++) {
        const len = zones[i + 1].s - zones[i].s;
        if (len < shortest) { shortest = len; k = i; }
      }
      if (k < 0) break;
      const prev = zones[k - 1];
      const next = zones[k + 1];
      const intoPrev = prev && (!next || Math.abs(prev.kmh - zones[k].kmh) <= Math.abs(next.kmh - zones[k].kmh));
      if (intoPrev) {
        prev.kmh = Math.min(prev.kmh, zones[k].kmh);
        zones.splice(k, 1);
      } else {
        next.s = zones[k].s;
        next.kmh = Math.min(next.kmh, zones[k].kmh);
        zones.splice(k, 1);
      }
      zones = dedupe(zones);
    }
    // the last zone runs to the end of the line: when that is shorter than the minimum it is dropped (the zone before it keeps the lower of the two speeds)
    while (Number.isFinite(length) && zones.length > 1 && length - zones[zones.length - 1].s < minZone) {
      const last = zones.pop();
      zones[zones.length - 1].kmh = Math.min(zones[zones.length - 1].kmh, last.kmh);
    }
    zones[0] = { s: 0, kmh: zones[0].kmh };
    return zones;
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

  /* ---------------------------------------------------- second main track (rail + hst)
   * Every rail line is double track: the player's track plus a second main SECOND_LAT m beside it, on the side OPPOSITE the platform of the
   * nearest station (the platform side is the outer side of the pair). Stations with platforms on different sides are joined by a FLIP: the
   * second track swings across the player's track in a smoothstep over FLIP_LEN m (a flat diamond crossing), always placed on open line
   * (never in a tunnel / on a bridge / at a level crossing / inside a station throat).  track.second = { lat(s), side(s), flips, SECOND_LAT }:
   * lat = signed lateral offset of the second track's centre (+ = right of the direction of travel). */
  const SECOND_LAT = 4.5;
  const FLIP_LEN = 160;
  const FLIP_MARGIN = 125;
  function planSecond(stations, tunnels, bridges, crossings, signals, kappa, length) {
    if (!stations.length) return null;
    const sideOf = (st) => (st.side === 'right' ? -1 : 1);
    const kmax = (a, b) => {
      let m = 0;
      for (let i = Math.max(0, Math.floor(a / STEP)); i <= Math.min(kappa.length - 1, Math.ceil(b / STEP)); i++) m = Math.max(m, Math.abs(kappa[i]));
      return m;
    };
    const flips = [];
    for (let i = 0; i + 1 < stations.length; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      if (sideOf(a) === sideOf(b)) continue;
      let lo = a.platformEnd + FLIP_MARGIN + FLIP_LEN / 2;
      let hi = b.platformStart - FLIP_MARGIN - FLIP_LEN / 2;
      if (hi < lo) { lo = hi = (a.platformEnd + b.platformStart) / 2; }
      let best = null;
      for (let c = lo; c <= hi + 0.01; c += 20) {
        const z0 = c - FLIP_LEN / 2 - 30;
        const z1 = c + FLIP_LEN / 2 + 30;
        let cost = Math.abs(c - (lo + hi) / 2) / 800 + kmax(z0, z1) * 400;
        tunnels.forEach((t) => { if (t.s1 > z0 && t.s0 < z1) cost += 1000; });
        bridges.forEach((br) => { if (br.s1 > z0 && br.s0 < z1) cost += 1000; });
        crossings.forEach((cr) => { if (cr.s > z0 - 15 && cr.s < z1 + 15) cost += 200; });
        signals.forEach((sg) => { if (sg.s > z0 && sg.s < z1) cost += 8; });
        if (!best || cost < best.cost) best = { c, cost };
      }
      flips.push({ c: best.c, s0: best.c - FLIP_LEN / 2, s1: best.c + FLIP_LEN / 2, from: sideOf(a), to: sideOf(b) });
    }
    const first = sideOf(stations[0]);
    const smooth = (t) => t * t * (3 - 2 * t);
    const latAt = (s) => {
      let side = first;
      for (let k = 0; k < flips.length; k++) {
        const f = flips[k];
        if (s <= f.s0) break;
        if (s < f.s1) return SECOND_LAT * (f.from + (f.to - f.from) * smooth((s - f.s0) / FLIP_LEN));
        side = f.to;
      }
      return SECOND_LAT * side;
    };
    return { SECOND_LAT, FLIP_LEN, flips, lat: latAt, side: (s) => (latAt(s) < 0 ? -1 : 1), length };
  }
  function mirrorSecond(base, L) {
    if (!base) return null;
    const flips = base.flips.map((f) => ({ c: L - f.c, s0: L - f.s1, s1: L - f.s0, from: -f.to, to: -f.from })).sort((a, b) => a.s0 - b.s0);
    const lat = (s) => -base.lat(L - s);
    return { SECOND_LAT: base.SECOND_LAT, FLIP_LEN: base.FLIP_LEN, flips, lat, side: (s) => (lat(s) < 0 ? -1 : 1), length: L };
  }

  /* ------------------------------------------------------------- build */
  function build(def) {
    if (def && def.reverse && def.base) return reverse(build(def.base), { id: def.id, def });
    if (!def || !def.layout) throw new Error('[Lokféierer] TS.track.build: bad route definition');
    const kind = def.kind;
    const formationDrop = kind === 'tram' ? FORM_TRAM : FORM_RAIL;
    const comp = compileItems(def);
    /* real level crossings that live inside a station patch (Munsbach: Rue de Beyren) exist whatever the authored route says (patch-crossings.js) */
    if (kind !== 'tram' && window.TS.patchCrossings) comp.crossings = window.TS.patchCrossings.merge(comp.stations, comp.crossings);
    const length = comp.length;
    const real = kind !== 'tram' && window.TS.realLine ? window.TS.realLine.resolve(def, comp) : null;   // real scenery of the Mosel line (rivers, relief, land classes, roads)
    const n = Math.floor(length / STEP) + 1;
    const smoothing = SMOOTH[kind] || SMOOTH.rail;
    const noise = makeNoise(hashString(def.sceneryId || def.id));   // routes that share a line (sceneryId) share their ground and scenery

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
    const limits = buildLimits(comp.limitsRaw, kind, length);
    const signals = buildSignals(stations, comp.tunnels, comp.bridges, kind, length);

    const bridges = comp.bridges.map((b) => {
      const mid = (b.s0 + b.s1) / 2;
      const waterY = b.water ? heightAtS(mid) - formationDrop - b.h + 1.2 : null;
      return Object.assign({}, b, { waterY });
    });

    const second = kind === 'tram' ? null : planSecond(stations, comp.tunnels, bridges, comp.crossings, signals, kappa, length);

    /* Real surroundings of stations (station-surround.js): inside the patch of a station the real LiDAR relief replaces the generic hills */
    const surroundPatches = kind !== 'tram' && window.TS.stationSurround && window.TS.stationSurround.heightPatches ? window.TS.stationSurround.heightPatches(stations, frameAt) : [];
    const applyPatches = (s, lat, h, formY) => {
      let out = h;
      for (let i = 0; i < surroundPatches.length; i++) out = surroundPatches[i].blend(s, lat, out, formY);
      return out;
    };

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
    const valLRaw = real ? new Float64Array(n) : null;     // real line: terrain height 220 m left / right of the track (DEM), replaces the generic valley
    const valRRaw = real ? new Float64Array(n) : null;
    const rivLatRaw = real ? new Float64Array(n) : null;   // real line: river centre (signed lateral offset) and half width, weighted by the river presence
    const rivHalfRaw = real ? new Float64Array(n) : null;
    for (let i = 0; i < n; i++) {
      const biome = biomeAt(i * STEP);
      const r = RELIEF[biome] || RELIEF.farmland;
      ampRaw[i] = r.amp;
      valRaw[i] = r.valley;
      widRaw[i] = r.width;
      riverRaw[i] = !real && biome === 'river' ? 1 : 0;
      if (real) {
        const rel = real.reliefAt(i * STEP);
        valLRaw[i] = rel.l * REAL_RELIEF_GAIN;
        valRRaw[i] = rel.r * REAL_RELIEF_GAIN;
        widRaw[i] = REAL_RELIEF_WIDTH;
        const w = real.water.find((x) => i * STEP >= x.s0 && i * STEP <= x.s1);
        if (w) { riverRaw[i] = 1; rivLatRaw[i] = w.side * w.off; rivHalfRaw[i] = w.half; }
      }
    }
    const blurR = Math.round(160 / STEP);
    const ampArr = boxBlur(ampRaw, blurR);
    const valArr = boxBlur(valRaw, blurR);
    const widArr = boxBlur(widRaw, blurR);
    const riverArr = boxBlur(riverRaw, Math.round(120 / STEP));
    const valLArr = real ? boxBlur(valLRaw, Math.round(100 / STEP)) : null;
    const valRArr = real ? boxBlur(valRRaw, Math.round(100 / STEP)) : null;
    // river centre / half width: blurred weighted averages (only where the river is)
    const rivLatArr = real ? weightedBlur(rivLatRaw, riverRaw, Math.round(120 / STEP)) : null;
    const rivHalfArr = real ? weightedBlur(rivHalfRaw, riverRaw, Math.round(120 / STEP)) : null;

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

    /* Services that share the tail of a real line (the Hbf branch and the Weststrecke both end on the same legs B..) must show the same hills there.  The generic hills
       are noise of the world position, and the two services reach the tail with different poses; inside the tail (blended in over TAIL_NOISE_BLEND m) the noise is
       therefore taken in the frame of the tail's first point, which is the same on both services. */
    const tailStation = real ? comp.stations.find((st) => st.name === TAIL_ANCHOR) : null;
    const tailLeg = tailStation ? { s0: tailStation.platformStart } : null;
    let tailFrame = null;
    function hillNoise(x, z, s) {
      const base = noise(x, z);
      if (!tailLeg) return base;
      const w = smooth01((s - (tailLeg.s0 - TAIL_NOISE_BLEND)) / TAIL_NOISE_BLEND);
      if (w <= 0) return base;
      if (!tailFrame) {
        const f = frameAt(tailLeg.s0);
        const hl = Math.hypot(f.tangent.x, f.tangent.z) || 1;
        tailFrame = { x: f.pos.x, z: f.pos.z, tx: f.tangent.x / hl, tz: f.tangent.z / hl };
      }
      const dx = x - tailFrame.x; const dz = z - tailFrame.z;
      const lx = dx * tailFrame.tx + dz * tailFrame.tz; const lz = -dx * tailFrame.tz + dz * tailFrame.tx;
      return lerp(base, noise(lx + TAIL_NOISE_OFFSET, lz + TAIL_NOISE_OFFSET), w);
    }

    function terrainBaseHeightAt(x, z) {
      const q = nearest(x, z, scratch);
      const fi = q.i;
      const trackY = q.y;
      const formY = trackY - formationDrop;
      const amp = arrAt(ampArr, fi);
      const valley = real ? (q.lat < 0 ? arrAt(valLArr, fi) : arrAt(valRArr, fi)) : arrAt(valArr, fi);
      const width = arrAt(widArr, fi);
      const cov = arrAt(cover, fi);
      const dep = arrAt(depth, fi);
      const mask = Math.max(arrAt(stationMask, fi), arrAt(crossMask, fi) * 0.8);
      const nz = hillNoise(x, z, q.s);

      let h = formY + nz * amp;
      h += valley * smooth01(q.d / width) * (0.6 + 0.4 * (nz * 0.5 + 0.5));
      if (surroundPatches.length) h = applyPatches(q.s, q.lat, h, formY);
      if (cov > 0.01) h += cov * (1 - smooth01(q.d / (30 + cov * 1.6)));
      // the ground over a tunnel never dips into the (double-track) tube: crown 7.5 m above the formation + 0.7 m of cover, tapering off beside the tunnel
      if (cov > 0.01 && kind !== 'tram') h = Math.max(h, formY + 8.2 * smooth01(cov / 4) * (1 - smooth01((q.d - 8) / 7)));
      if (dep > 0.01) h -= dep * (1 - smooth01((q.d - (6 + dep * 0.35)) / (dep * 1.5 + 14)));

      const river = arrAt(riverArr, fi);
      if (river > 0.02) {
        const base = waterLevelAtIndex(fi) - 2.5;
        const rLat = real ? arrAt(rivLatArr, fi) : riverSide * RIVER_OFFSET;
        const rHalf = real ? arrAt(rivHalfArr, fi) : RIVER_HALF;
        const amount = river * (1 - smooth01((Math.abs(q.lat - rLat) - rHalf) / 55));
        if (h > base) h = lerp(h, base, amount);
      }

      const d0Base = kind === 'tram' ? D0_BASE : D0_RAIL;
      const d0 = d0Base + (D0_STATION - d0Base) * mask;
      const blend = 3 + Math.abs(h - formY) * 2.2 + 18 * mask;
      let w = 1 - smooth01((q.d - d0) / blend);
      w *= 1 - smooth01(cov / 5);
      w *= 1 - smooth01(dep / 1.5);
      const out = h + (formY - h) * w;
      // inside a rail tunnel (exact s, no ramp at the portals): the ground is never lower than the crown of the double-track tube + cover, so no ground
      // wedge can poke into the first metres of the bore (the portal wall hides the step at the mouth)
      if (kind !== 'tram' && inTunnel(q.s)) return Math.max(out, formY + 8.2 * (1 - smooth01((q.d - 8) / 7)));
      return out;
    }

    function water(s) {
      const fi = clamp(s / STEP, 0, n - 1.0001);
      if (arrAt(riverArr, fi) < 0.5) return null;
      if (real) { const lat = arrAt(rivLatArr, fi); return { y: waterLevelAtIndex(fi), side: lat < 0 ? -1 : 1, offset: Math.abs(lat), halfWidth: arrAt(rivHalfArr, fi) }; }
      return { y: waterLevelAtIndex(fi), side: riverSide, offset: RIVER_OFFSET, halfWidth: RIVER_HALF };
    }

    // Space reserved by TS.infra (platforms, buildings, crossing roads, tram street).
    function corridorHalfWidth(s, side) {
      const base = kind === 'tram' ? 8 : 6;
      const idx = stations.findIndex((st) => s >= st.platformStart - 24 && s <= st.platformEnd + 24);
      // double track: the side of the second main track is wider (its centre + ballast + mast + margin)
      const secLat = second ? second.lat(s) : 0;
      const secW = !second ? 0 : Math.abs(secLat) < 3.5 ? 12 : side === (secLat < 0 ? -1 : 1) ? Math.abs(secLat) + 4.5 : 0;
      if (idx >= 0 && !(kind === 'tram')) {
        const platformSide = stations[idx].side === 'right' ? 1 : -1;
        return side === platformSide ? (stations[idx].name === 'Lëtzebuerg' && idx === 0 ? 34 : 26) : Math.max(10, secW + 2);
      }
      if (idx >= 0) return 9;
      return Math.max(base, secW);
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
      const width = st.platformWidth || (tram ? 3.0 : big ? 7.0 : 5.2);
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

    /* Roads at level crossings (crossing-roads.js): a smooth long road with cuts and fills, planned on the plain terrain, then folded into terrainHeightAt so
       the strip mesh, the far ground and every tree / house query see the same ground. */
    let roadPlan = null;
    if (kind !== 'tram' && comp.crossings.length && window.TS.crossingRoads) {
      try {
        roadPlan = window.TS.crossingRoads.plan({
          id: def.sceneryId || def.id, length, crossings: comp.crossings, frameAt, baseHeightAt: terrainBaseHeightAt, formationDrop,
          secondLat: (s) => (second ? second.lat(s) : 0), tunnels: comp.tunnels, bridges, stations, water,
          realCrossing: real ? (s) => real.crossingNear(s, 40) : null,
        });
      } catch (error) {
        console.warn('[Lokféierer] track: crossing roads failed', error);
        roadPlan = null;
      }
    }
    const terrainHeightAt = roadPlan ? (x, z) => roadPlan.adjust(x, z, terrainBaseHeightAt(x, z)) : terrainBaseHeightAt;
    const isReservedWithRoads = roadPlan ? (x, z) => isReserved(x, z) || roadPlan.reserved(x, z, 1.5) : isReserved;

    const passFixed = stations.map((st, i) => (i > 0 && i < stations.length - 1 && (def.passNames || []).includes(st.name) ? i : -1)).filter((i) => i >= 0);

    /* the valley under a bridge is steep: finer strip rows / columns there, so the drawn ground follows terrainHeightAt (trees, roads and lamps stand on that function) */
    const valleyBridges = kind === 'tram' ? [] : bridges.filter((b) => b.h >= VALLEY_MIN_H);
    const valleyRows = (s0, s1) => {
      const out = [];
      valleyBridges.forEach((b) => { for (let s = Math.ceil(Math.max(s0, b.s0 - VALLEY_PAD) / VALLEY_ROW) * VALLEY_ROW; s <= Math.min(s1, b.s1 + VALLEY_PAD); s += VALLEY_ROW) out.push(s); });
      return out;
    };
    const valleyLats = (s0, s1) => {
      const out = [];
      if (valleyBridges.some((b) => s1 > b.s0 - VALLEY_PAD - VALLEY_COL_MARGIN && s0 < b.s1 + VALLEY_PAD + VALLEY_COL_MARGIN)) for (let l = -VALLEY_LAT; l <= VALLEY_LAT; l += VALLEY_LAT_STEP) out.push(l);
      return out;
    };

    /* real river trench: narrow (Syre 7 m) and 6+ m deep, so the strip needs columns inside and beside it, else the mesh averages the trench away (0.65 m steps).
       Two neighbouring chunks must carry EXACTLY the same columns along their shared edge (else a sliver crack opens): every river stretch gets one column set
       that all the chunks touching it (plus a margin where the 120 m blur of the river has faded the trench) use. */
    const RIVER_REGION_GAP = 300;
    const RIVER_REGION_MARGIN = 280;
    const RIVER_DENSE = 1.5;
    const RIVER_MID = 3;
    const RIVER_FAR = 5.5;
    const riverRegions = [];
    if (real) {
      let cur = null;
      for (let i = 0; i < n; i += 2) {
        if (arrAt(riverArr, i) < 0.02) continue;
        const s = i * STEP; const lat = arrAt(rivLatArr, i); const half = arrAt(rivHalfArr, i);
        if (cur && s - cur.s1 < RIVER_REGION_GAP) { cur.s1 = s; cur.lo = Math.min(cur.lo, lat); cur.hi = Math.max(cur.hi, lat); cur.half = Math.max(cur.half, half); }
        else { cur = { s0: s, s1: s, lo: lat, hi: lat, half }; riverRegions.push(cur); }
      }
      riverRegions.forEach((r) => {
        const k = Math.max(1, r.half / 3.5);
        const cols = new Set();
        const add = (v) => cols.add(Math.round(v * 2) / 2);
        for (let v = r.lo - 4.5 * k; v <= r.hi + 4.5 * k + 1e-6; v += RIVER_DENSE) add(v);
        for (let v = r.lo - 11 * k; v < r.lo - 4.5 * k; v += RIVER_MID) add(v);
        for (let v = r.hi + 4.5 * k; v <= r.hi + 11 * k; v += RIVER_MID) add(v);
        for (let v = r.lo - 16 * k; v < r.lo - 11 * k; v += RIVER_FAR) add(v);
        for (let v = r.hi + 11 * k; v <= r.hi + 16 * k; v += RIVER_FAR) add(v);
        r.lats = Array.from(cols).sort((p, q) => p - q);
      });
    }
    const riverLats = (s0, s1) => {
      const out = [];
      riverRegions.forEach((r) => { if (s1 > r.s0 - RIVER_REGION_MARGIN && s0 < r.s1 + RIVER_REGION_MARGIN) out.push(...r.lats); });
      return out;
    };

    return {
      id: def.id,
      sceneryId: def.sceneryId || def.id,
      passFixed,
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
      terrainBaseHeightAt,
      crossingRoads: roadPlan,
      surroundPatches,
      /* true inside the real patch of a station (the generic scenery keeps out of it) */
      inSurround: surroundPatches.length ? (x, z) => { const q = nearest(x, z, { s: 0, d: 0, lat: 0, y: 0 }); return surroundPatches.some((p) => p.covers(q.s, q.lat)); } : () => false,
      /* extra terrain strip vertices for the chunk [s0, s1): rows (arc lengths) and lateral columns, from the crossing roads and the real station patches */
      meshHints: {
        rows: (s0, s1) => (roadPlan ? roadPlan.extraRows(s0, s1) : []).concat(...surroundPatches.map((p) => p.extraRows(s0, s1)), valleyRows(s0, s1)),
        lats: (s0, s1) => (roadPlan ? roadPlan.extraLats(s0, s1) : []),
        latsAll: (s0, s1) => [].concat(...surroundPatches.map((p) => p.extraLats(s0, s1)), valleyLats(s0, s1), riverLats(s0, s1)),
      },
      nearest: (x, z) => Object.assign({}, nearest(x, z, { s: 0, d: 0, lat: 0, y: 0 })),
      nearestS: (x, z) => nearest(x, z, scratch).s,
      distanceToTrack: (x, z) => nearest(x, z, scratch).d,
      water,
      real,                       // real scenery data (TS.realLine) of the Mosel line, or null
      inTunnel,
      bridgeAt,
      stationAt,
      corridorHalfWidth,
      isReserved: isReservedWithRoads,
      platformInfo,
      second,
    };
  }

  /* ------------------------------------------------------------- reverse direction
   * reverse(base, opts) -> Track driven the other way: s' = length - s, the same ground, so the world (landscape) is built from `track.base`
   * (the forward track) and fed baseS(s'). Stations / signals / tunnels / bridges / crossings / limits are mirrored, the platform sides flip
   * (opts.sides: 'flip' | 'right' = every platform on the right of the travel direction, e.g. the Luxtram on its OTHER track).
   * opts.playerFrameAt: frames of the track the reversed train really runs on (default: the same track backwards);
   * opts.minLenAt(s): shortest limit zone (the brake lead of a mirrored drop never shortens the zone before it below it). */
  function mirrorLimits(limits, L, kind, minLenAt) {
    const zones = limits.map((l, i) => ({ s0: l.s, s1: i + 1 < limits.length ? limits[i + 1].s : L, kmh: l.kmh }));
    const mirrored = zones.map((z) => ({ s: L - z.s1, kmh: z.kmh })).sort((a, b) => a.s - b.s);
    mirrored[0] = { s: 0, kmh: mirrored[0].kmh };
    const lead = BRAKE_LEAD[kind] || BRAKE_LEAD.rail;
    const out = [];
    mirrored.forEach((z, i) => {
      let s = z.s;
      const prev = mirrored[i - 1];
      if (prev && z.kmh < prev.kmh) {
        const v1 = prev.kmh / 3.6;
        const v2 = z.kmh / 3.6;
        const room = z.s - out[out.length - 1].s - (minLenAt ? minLenAt(z.s) : 0);
        s = z.s - Math.max(0, Math.min(lead[1], (v1 * v1 - v2 * v2) / (2 * lead[0]), minLenAt ? room : (z.s - out[out.length - 1].s) * 0.85));
      }
      out.push({ s: i === 0 ? 0 : s, kmh: z.kmh });
    });
    return tidyLimits(out.filter((e, i) => i === 0 || e.kmh !== out[i - 1].kmh), kind, L);
  }

  /* nearest point of a frame function sampled every STEP m (same contract as Track.nearest) */
  function frameNearest(frameAt, L) {
    const n = Math.floor(L / STEP) + 1;
    const X = new Float64Array(n);
    const Z = new Float64Array(n);
    const Y = new Float64Array(n);
    const TH = new Float64Array(n);
    const f = frameAt(0);
    for (let i = 0; i < n; i++) { frameAt(i * STEP, f); X[i] = f.pos.x; Z[i] = f.pos.z; Y[i] = f.pos.y; TH[i] = Math.atan2(f.tangent.x, -f.tangent.z); }
    const grid = new Map();
    const key = (ix, iz) => ix * 73856 + iz * 19349;
    for (let c = 0; c * COARSE < n; c++) {
      const i = Math.min(n - 1, c * COARSE);
      const k = key(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
      const b = grid.get(k);
      if (b) b.push(i); else grid.set(k, [i]);
    }
    return (x, z) => {
      const ix = Math.floor(x / CELL);
      const iz = Math.floor(z / CELL);
      let best = Infinity;
      let bi = -1;
      const scan = (cx, cz) => { const b = grid.get(key(cx, cz)); if (!b) return; for (const i of b) { const d2 = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d2 < best) { best = d2; bi = i; } } };
      for (let r = 0; r <= MAX_RING; r++) {
        if (r === 0) scan(ix, iz);
        else { for (let a = -r; a <= r; a++) { scan(ix + a, iz - r); scan(ix + a, iz + r); } for (let b = -r + 1; b <= r - 1; b++) { scan(ix - r, iz + b); scan(ix + r, iz + b); } }
        if (bi >= 0 && best <= (r * CELL) * (r * CELL)) break;
      }
      if (bi < 0) { for (let i = 0; i < n; i += 16) { const d2 = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d2 < best) { best = d2; bi = i; } } }
      for (let i = Math.max(0, bi - COARSE - 1); i <= Math.min(n - 1, bi + COARSE + 1); i++) { const d2 = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d2 < best) { best = d2; bi = i; } }
      let bt = 0, bs = bi, bd2 = Infinity;
      for (let sg = Math.max(0, bi - 1); sg <= Math.min(n - 2, bi); sg++) {
        const ax = X[sg], az = Z[sg], bx = X[sg + 1] - ax, bz = Z[sg + 1] - az;
        const u = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1), 0, 1);
        const px = ax + bx * u - x, pz = az + bz * u - z, d2 = px * px + pz * pz;
        if (d2 < bd2) { bd2 = d2; bs = sg; bt = u; }
      }
      const sg1 = Math.min(n - 1, bs + 1);
      const th = lerp(TH[bs], TH[sg1], bt);
      const cx = lerp(X[bs], X[sg1], bt);
      const cz = lerp(Z[bs], Z[sg1], bt);
      const fi = Math.min(bs + bt, n - 1);
      return { s: fi * STEP, d: Math.sqrt(bd2 === Infinity ? best : bd2), lat: (x - cx) * Math.cos(th) + (z - cz) * Math.sin(th), y: lerp(Y[bs], Y[sg1], bt), i: fi };
    };
  }

  function reverse(base, opts) {
    const o = opts || {};
    const L = base.length;
    const n = base.stations.length;
    const right = o.sides === 'right';
    const flipFrame = (f) => { f.tangent.negate(); f.right.negate(); f.grade = -f.grade; f.curvature = -f.curvature; return f; };
    const srcFrame = o.playerFrameAt || base.frameAt;
    const frameAt = (s, out) => flipFrame(srcFrame(L - s, out));
    const stations = base.stations.slice().reverse().map((st, j) => Object.assign({}, st, {
      id: 'st' + j, s: L - st.platformStart - (st.platformEnd - st.s), platformStart: L - st.platformEnd, platformEnd: L - st.platformStart,
      side: right ? 'right' : st.side === 'right' ? 'left' : 'right', terminus: j === 0 || j === n - 1,
    }));
    const flipRole = (r) => (r === 'home' ? 'exit' : r === 'exit' ? 'home' : r);
    const signals = base.signals.map((sg) => Object.assign({}, sg, { s: L - sg.s, role: flipRole(sg.role), stationIndex: Number.isFinite(sg.stationIndex) ? n - 1 - sg.stationIndex : sg.stationIndex })).sort((a, b) => a.s - b.s);
    const mirrorRange = (r) => Object.assign({}, r, { s0: L - r.s1, s1: L - r.s0 });
    const tunnels = base.tunnels.map(mirrorRange).sort((a, b) => a.s0 - b.s0);
    const bridges = base.bridges.map(mirrorRange).sort((a, b) => a.s0 - b.s0);
    const crossings = base.crossings.map((c) => Object.assign({}, c, { s: L - c.s })).sort((a, b) => a.s - b.s);
    const inTunnel = (s) => tunnels.some((t) => s >= t.s0 && s <= t.s1);
    const bridgeAt = (s) => bridges.find((b) => s >= b.s0 && s <= b.s1) || null;
    const stationAt = (s) => stations.findIndex((st) => s >= st.platformStart && s <= st.platformEnd);
    const nearest = o.playerFrameAt ? frameNearest(frameAt, L) : (x, z) => { const q = base.nearest(x, z); return Object.assign({}, q, { s: L - q.s, lat: -q.lat, i: q.i !== undefined ? (L - q.s) / STEP : undefined }); };
    const platformInfo = (j) => {
      const st = stations[j];
      const p = base.platformInfo(n - 1 - j);
      if (!st || !p) return null;
      return Object.assign({}, p, { sideSign: st.side === 'right' ? 1 : -1, s0: st.platformStart, s1: st.platformEnd, sMarker: st.s, exits: p.exits.map((e) => ({ s: L - e.s, lat: e.lat })) });
    };
    const out = Object.assign({}, base, {
      id: o.id || base.id, def: o.def || base.def, base, reverse: true, passFixed: (base.passFixed || []).map((i) => n - 1 - i).sort((a, b) => a - b), baseS: (s) => L - s, frameAt, stations, signals, tunnels, bridges, crossings, inTunnel, bridgeAt, stationAt,
      limits: mirrorLimits(base.limits, L, base.kind, o.minLenAt), platformInfo,
      biomeAt: (s) => base.biomeAt(L - s),
      real: base.real ? base.real.mirror(L) : null,
      nearest, nearestS: (x, z) => nearest(x, z).s, distanceToTrack: (x, z) => nearest(x, z).d,
      water: (s) => { const w = base.water ? base.water(L - s) : null; return w ? Object.assign({}, w, { side: -w.side }) : null; },
      corridorHalfWidth: (s, side) => base.corridorHalfWidth(L - s, -side),
      second: mirrorSecond(base.second, L),
    });
    if (base.noOcs) out.noOcs = (s) => base.noOcs(L - s);
    return out;
  }

  window.TS.track = { build, STEP, reverse, mirrorLimits };
})();
