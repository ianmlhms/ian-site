/* Lokféierer: road overbridges over the line, plan + design stage (TS.overbridges.plan).
 *
 * The real roads that cross the line on a bridge (OSM bridge / layer 1, scripts/zuch/real_line_overbridges.py) used to end 21 m from the axis on both sides.  The pipeline now
 * hands over each of them as ONE polyline `p` in game coordinates (s along the track, lat to the right, from the far end on one side to the far end on the other); this module
 * designs the structure on it, overbridges-mesh.js builds the meshes of the chunk that holds the crossing:
 *   - the deck lies OVER_CLEAR above the rail top (contact wire 5.3 m, messenger 6.4 m, mast head 6.9 m, a metre of girder), its abutments stand EDGE_CLEAR beside the outer track,
 *     so neither the catenary masts nor the loading gauge are touched and no pier stands near a rail;
 *   - in a cutting the abutments move out to the top of the slope (where the ground reaches the deck), so the span grows with the cutting;
 *   - the road climbs from the ground to the deck on an embankment with vertical wing walls next to the abutments and 1:2 grass slopes beyond; the grade is the class grade
 *     (steeper only when the claimed road is too short to reach the ground), the profile never runs below the ground (no road through a hill);
 *   - the ground itself is NOT changed (no step in terrainHeightAt, the hole scan stays valid): the embankment is a solid mesh that sits on it, the slopes end 15 cm below the ground.
 * plan(ctx): ctx = { id, length, frameAt(s), groundAt(x, z), secondLat(s), obs: [{ s, c, w, n, p }], tunnels, bridges, stations, flips: [{ s0, s1 }] }
 *   -> { obs, skipped, reserved(x, z, margin), design(ob, latCap), ownerOf(s0, s1) }
 * Everything is geometry in the base track's frame; nothing here touches THREE. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] overbridges: ';

  /* ---- vertical layout (m above the rail top) */
  const OVER_CLEAR = 8.2;           // road surface of the deck above the rail top
  const SLAB_T = 0.95;              // girder band under the road surface (slim, as on the real CFL overbridges)
  const MIN_ABOVE_GROUND = 0.25;    // the deck surface lies at least this far above the ground at its abutment
  /* ---- plan */
  const EDGE_CLEAR = 4.9;           // abutment face to the axis of the outer track
  const CUT_REACH = 22;             // abutments move out up to this far (m) when the ground rises to the deck level beside the line
  const CUT_ENTER = 1.0;            // ... as soon as the ground is within this far of the deck level
  const SAMPLE = 2.5;               // m between design samples (game metres along the polyline)
  /* ---- cross section (half widths from the road centre, m) */
  const VERGE = 1.4;                // footway + parapet on the deck, verge + guard rail on the embankment
  const WALL_T = 0.4;               // thickness of the wing walls
  const SLOPE_RUN = 2.0;            // embankment slope 1 : 2
  const WING_LEN = 7.5;             // vertical wing wall along the road behind the abutment
  const WING_TAPER = 6;             // ... then the slope grows from the wall top over this length
  const TOE_STEP = 0.9;             // search step for the toe of a slope
  const TOE_MAX = 46;
  const TOE_SINK = 0.15;            // the slope ends this far below the ground (no hairline gap)
  /* ---- grades */
  const GRADE_BY_CLASS = { motorway: 0.04, trunk: 0.045, primary: 0.05, secondary: 0.055, tertiary: 0.06, unclassified: 0.07, residential: 0.07, service: 0.09, track: 0.1 };
  const MAX_GRADE = 0.18;
  const FEASIBLE_GRADE = 0.18;      // an overbridge whose claimed road is too short to climb to the deck at this grade is not built (the road stays an ordinary ribbon, cut at the line)
  const CREST_R = 6;                // m of vertical rounding at the abutment (crest)
  const END_BLEND = 14;             // m before the claimed end over which the profile joins the ground
  const SMOOTH_PASSES = 2;
  /* ---- reservation (trees, houses keep off) */
  const RESERVE_PAD = 1.2;
  const FLIP_PAD = 25;              // not within the diamond crossing of the second track (the masts are different there)
  const TRACK_PAD = 45;             // nor within this far of a tunnel / bridge of the layout
  const STATION_PAD = 240;          // the real surroundings patch of a station (LiDAR relief with its own embankments) reaches ~220 m beyond the platform end

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

  function plan(ctx) {
    const L = ctx.length;
    const frameCache = new Map();
    const frameOf = (s) => {
      const key = Math.round(s * 4);
      let f = frameCache.get(key);
      if (!f) {
        const r = ctx.frameAt(clamp(s, 0, L));
        let tx = r.tangent.x; let tz = r.tangent.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const over = s - clamp(s, 0, L);
        f = { x: r.pos.x + over * tx, y: r.pos.y, z: r.pos.z + over * tz, tx, tz, rx: -tz, rz: tx };
        frameCache.set(key, f);
      }
      return f;
    };
    const world = (s, lat) => { const f = frameOf(s); return { x: f.x + f.rx * lat, z: f.z + f.rz * lat }; };

    const overlaps = (list, s, pad) => (list || []).some((t) => s > t.s0 - pad && s < t.s1 + pad);
    const nearPlatform = (s) => (ctx.stations || []).some((st) => s > (st.platformStart !== undefined ? st.platformStart : st.s - 100) - STATION_PAD && s < (st.platformEnd !== undefined ? st.platformEnd : st.s + 100) + STATION_PAD);
    const obs = [];
    const skipped = [];
    /* the grade the road needs on each side to climb from the ground at the end of the claimed road to the deck (two ground samples, no design): the worst side */
    const neededGrade = (raw) => {
      const D0 = frameOf(raw.s).y + OVER_CLEAR;
      // arc length of the claimed road on each side of the axis (the polyline has a vertex only where the road bends)
      const cum = [0];
      for (let i = 1; i < raw.p.length; i++) cum.push(cum[i - 1] + Math.hypot(raw.p[i][0] - raw.p[i - 1][0], raw.p[i][1] - raw.p[i - 1][1]));
      let at = cum[cum.length - 1] / 2;
      for (let i = 1; i < raw.p.length; i++) {
        const a = raw.p[i - 1][1]; const b = raw.p[i][1];
        if (a <= 0 && b > 0) { at = cum[i - 1] + (cum[i] - cum[i - 1]) * (-a / ((b - a) || 1)); break; }
      }
      let worst = 0;
      [[raw.p[0], at], [raw.p[raw.p.length - 1], cum[cum.length - 1] - at]].forEach(([end, len]) => {
        const w = world(end[0], end[1]);
        worst = Math.max(worst, (D0 - ctx.groundAt(w.x, w.z)) / Math.max(18, len - 14));
      });
      return worst;
    };
    (ctx.obs || []).forEach((raw, index) => {
      let why = overlaps(ctx.tunnels, raw.s, TRACK_PAD) ? 'tunnel' : overlaps(ctx.bridges, raw.s, TRACK_PAD) ? 'bridge' : nearPlatform(raw.s) ? 'station' : overlaps(ctx.flips, raw.s, FLIP_PAD) ? 'flip' : null;
      const need = raw.p.length >= 2 ? neededGrade(raw) : 0;
      if (!why && need > FEASIBLE_GRADE) why = 'ramp';
      if (why || raw.p.length < 2) { skipped.push({ ob: raw, why: why || 'short', need }); return; }
      obs.push({ index, s: raw.s, c: raw.c, w: raw.w, n: raw.n, p: raw.p, need, design: new Map(), box: null });
    });

    /* ---- polyline samples of one overbridge: game (s, lat) -> world, arc length, tangent */
    function sampleLine(ob) {
      const pts = [];
      let acc = 0;
      for (let i = 0; i + 1 < ob.p.length; i++) {
        const [s0, l0] = ob.p[i]; const [s1, l1] = ob.p[i + 1];
        const len = Math.hypot(s1 - s0, l1 - l0);
        const n = Math.max(1, Math.round(len / SAMPLE));
        for (let k = 0; k < n; k++) pts.push([lerp(s0, s1, k / n), lerp(l0, l1, k / n)]);
        acc += len;
      }
      pts.push(ob.p[ob.p.length - 1]);
      const out = pts.map(([s, lat]) => { const w = world(s, lat); return { s, lat, x: w.x, z: w.z, u: 0, tx: 0, tz: 0 }; });
      out.forEach((q, i) => {
        if (i) q.u = out[i - 1].u + Math.hypot(q.x - out[i - 1].x, q.z - out[i - 1].z);
        const a = out[Math.max(0, i - 1)]; const b = out[Math.min(out.length - 1, i + 1)];
        const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
        q.tx = dx / dl; q.tz = dz / dl;
      });
      return out;
    }

    /* the design of one overbridge for a lateral reach `cap` (the strip of the quality level is narrower than the claimed road on `low`) */
    function design(ob, latCap) {
      const key = Math.round(latCap);
      const hit = ob.design.get(key);
      if (hit) return hit;
      const all = sampleLine(ob);
      // clip at the lateral cap (the claimed road is longer than the low strip)
      let i0 = 0; let i1 = all.length - 1;
      while (i0 < i1 && Math.abs(all[i0].lat) > latCap) i0++;
      while (i1 > i0 && Math.abs(all[i1].lat) > latCap) i1--;
      const smp = all.slice(i0, i1 + 1);
      const hw = Math.max(2.4, ob.w / 2);
      const hc = hw + VERGE;
      const ground = ctx.groundAt;
      // crossing sample and the track at the crossing
      let ic = smp.findIndex((q) => q.lat >= 0);
      if (ic <= 0) ic = Math.max(1, Math.floor(smp.length / 2));
      const a = smp[ic - 1]; const b = smp[ic];
      const tc = -a.lat / ((b.lat - a.lat) || 1);
      const sCross = lerp(a.s, b.s, tc);
      const fc = frameOf(sCross);
      const sl = ctx.secondLat ? ctx.secondLat(sCross) : 0;
      const tang = (i) => smp[i];
      // ground along the road: centre and the maximum over the cross section (the ribbon must not sink into a side slope)
      smp.forEach((q) => {
        const nx = -q.tz; const nz = q.tx;
        q.gc = ground(q.x, q.z);
        q.gl = ground(q.x + nx * hc, q.z + nz * hc);
        q.gr = ground(q.x - nx * hc, q.z - nz * hc);
        q.gm = Math.max(q.gc, q.gl, q.gr);
      });
      // skew: the abutment face is perpendicular to the road, its corners reach hc * sin(angle) towards the track
      const skew = Math.abs(smp[ic].tx * fc.tx + smp[ic].tz * fc.tz);   // |cos| between road and track direction = |sin| of the skew
      const reachA = Math.min(0, sl) - EDGE_CLEAR - hc * skew;
      const reachB = Math.max(0, sl) + EDGE_CLEAR + hc * skew;
      const D0 = fc.y + OVER_CLEAR;
      // abutment indices: the corridor edge, moved out while the ground is lower than the deck (cutting walls)
      const latOf = (q) => q.lat;
      let iA = ic - 1; while (iA > 0 && latOf(smp[iA]) > reachA) iA--;
      let iB = ic; while (iB < smp.length - 1 && latOf(smp[iB]) < reachB) iB++;
      const cutOut = (i, dir, plane) => {
        // the first sample further out than the plane where the ground reaches the deck level; at most CUT_REACH beyond the plane
        let j = i;
        while (j + dir >= 0 && j + dir < smp.length && Math.abs(smp[j].lat - plane) < CUT_REACH && smp[j].gm < D0 - CUT_ENTER) j += dir;
        return smp[j].gm >= D0 - CUT_ENTER ? j : i;      // the ground never reaches the deck beside the line (flat country): the abutment stays at the corridor edge, the road climbs on an embankment
      };
      iA = cutOut(iA, -1, reachA);
      iB = cutOut(iB, 1, reachB);
      const D = Math.max(D0, smp[iA].gm + MIN_ABOVE_GROUND, smp[iB].gm + MIN_ABOVE_GROUND);
      const uA = smp[iA].u; const uB = smp[iB].u;
      // grade of the ramp on each side: the class grade, steeper only when the claimed road is too short to reach the ground
      const gradeClass = GRADE_BY_CLASS[ob.c] || 0.07;
      const rampLen = (ia, ib) => Math.max(18, Math.abs(smp[ib].u - smp[ia].u) - CREST_R * 2);
      const gradeA = clamp(Math.max(gradeClass, (D - smp[0].gm) / rampLen(iA, 0)), gradeClass, MAX_GRADE);
      const gradeB = clamp(Math.max(gradeClass, (D - smp[smp.length - 1].gm) / rampLen(iB, smp.length - 1)), gradeClass, MAX_GRADE);
      const crest = (t) => (t >= CREST_R ? t - CREST_R / 2 : (t * t) / (2 * CREST_R));
      const lastU = smp[smp.length - 1].u;
      smp.forEach((q) => {
        const dist = q.u < uA ? uA - q.u : q.u > uB ? q.u - uB : 0;
        const grade = q.u < uA ? gradeA : gradeB;
        const ramp = D - grade * crest(dist);
        q.deck = q.u >= uA && q.u <= uB;
        q.dist = dist;
        q.y = Math.max(q.gm + 0.04, ramp);
        // the last metres join the ground exactly (the ordinary ribbon takes over there)
        const toEnd = q.u < uA ? q.u - smp[0].u : lastU - q.u;
        if (!q.deck && toEnd < END_BLEND) q.y = lerp(q.gm + 0.04, q.y, smooth01(toEnd / END_BLEND));
      });
      // smooth the embankment part (the ground is rough, the ramp should not be); never below the ground
      for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
        const ys = smp.map((q) => q.y);
        smp.forEach((q, i) => {
          if (q.deck || q.dist < 0.5) return;
          const lo = Math.max(0, i - 2); const hi = Math.min(smp.length - 1, i + 2);
          let sum = 0; for (let k = lo; k <= hi; k++) sum += ys[k];
          q.y = Math.max(q.gm + 0.04, sum / (hi - lo + 1));
        });
      }
      // deck samples are flat at D (the ends of the deck are the abutment samples themselves)
      smp.forEach((q) => { if (q.deck) q.y = D; });
      // slopes: toe distance on both sides, wing wall length
      smp.forEach((q) => {
        const nx = -q.tz; const nz = q.tx;
        q.toe = [0, 0]; q.edgeG = [0, 0];
        [[1, 0], [-1, 1]].forEach(([sd, k]) => {
          const ex = q.x + nx * sd * (hc + WALL_T); const ez = q.z + nz * sd * (hc + WALL_T);
          const g0 = ground(ex, ez);
          q.edgeG[k] = g0;
          if (q.deck || q.y - g0 < 0.06) return;
          let d = 0;
          for (let t = TOE_STEP; t <= TOE_MAX; t += TOE_STEP) {
            d = t;
            if (q.y - t / SLOPE_RUN <= ground(ex + nx * sd * t, ez + nz * sd * t) + 0.02) break;
          }
          q.toe[k] = d * smooth01((q.dist - WING_LEN) / WING_TAPER);
        });
      });
      const rows = smp.filter((q) => q.deck || q.y - Math.min(q.gl, q.gr) > 0.06);
      const first = smp.indexOf(rows[0]); const last = smp.indexOf(rows[rows.length - 1]);
      const d = { smp, hw, hc, D, uA, uB, iA, iB, ic, sCross, railY: fc.y, sl, gradeA, gradeB, rows: [Math.max(0, first - 1), Math.min(smp.length - 1, last + 1)], latCap, reachA, reachB, wing: WING_LEN };
      ob.design.set(key, d);
      return d;
    }

    /* ---- reservation: nothing generic (trees, houses, tufts) grows on the structure, the embankment or in its slopes */
    const boxOf = (ob) => {
      if (!ob.box) {
        let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
        ob.p.forEach(([s, lat]) => { const w = world(s, lat); x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); z0 = Math.min(z0, w.z); z1 = Math.max(z1, w.z); });
        const m = 30 + Math.max(2.5, ob.w / 2) + 4;
        ob.box = { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m };
      }
      return ob.box;
    };
    function reserved(x, z, margin) {
      const m = margin || 0;
      for (let k = 0; k < obs.length; k++) {
        const ob = obs[k]; const b = boxOf(ob);
        if (x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m) continue;
        const d = design(ob, 112);
        const smp = d.smp;
        for (let i = 0; i + 1 < smp.length; i++) {
          const p = smp[i]; const q = smp[i + 1];
          const dx = q.x - p.x; const dz = q.z - p.z; const ll = dx * dx + dz * dz || 1;
          const t = clamp(((x - p.x) * dx + (z - p.z) * dz) / ll, 0, 1);
          const ex = p.x + dx * t - x; const ez = p.z + dz * t - z;
          const dist = Math.hypot(ex, ez);
          const reach = d.hc + WALL_T + Math.max(p.toe[0], p.toe[1], q.toe[0], q.toe[1]) + RESERVE_PAD + m;
          if (dist < reach) return true;
        }
      }
      return false;
    }

    const ownerOf = (s0, s1) => obs.filter((ob) => ob.s >= s0 && ob.s < s1);
    return { obs, skipped, reserved, design, ownerOf, frameOf, world, groundAt: ctx.groundAt, constants: { OVER_CLEAR, SLAB_T, VERGE, WALL_T, SLOPE_RUN, WING_LEN, TOE_SINK, EDGE_CLEAR } };
  }

  /* roads of the overbridges that could not be built (tunnel, station, diamond crossing next to them): drawn as ordinary ribbons, cut where they would run over the rails */
  const FALLBACK_CLEAR = 21;
  function fallbackRoads(skipped) {
    const out = [];
    skipped.forEach(({ ob }) => {
      [-1, 1].forEach((sd) => {
        const side = ob.p.filter((q) => sd * q[1] >= FALLBACK_CLEAR);
        if (side.length >= 2) out.push({ c: ob.c, w: ob.w, n: ob.n || '', ref: ob.r || '', f: 0, p: sd < 0 ? side : side, freeEnd: [false, false], leg: 'ob' });
      });
    });
    return out;
  }

  TS.overbridges = Object.freeze({ plan, fallbackRoads, tag: TAG });
})();
