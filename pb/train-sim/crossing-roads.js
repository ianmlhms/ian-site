/* Lokféierer: roads at level crossings, plan stage (TS.crossingRoads.plan).
 *
 * A level crossing used to be a 22 m stub of asphalt with a field on both sides.  Here every crossing gets a real road: it leaves the line straight,
 * then meets a road that runs parallel to the railway (a T-junction), bends into one, or goes on as a field lane to a turning place.  The plan is pure
 * geometry in the base track's frame; three other modules use it:
 *   - track.js          wraps terrainHeightAt with plan.adjust(): the ground follows the road (smooth long profile, cuts and fills, no steps, no holes)
 *   - landscape.js      plan.extraRows / plan.extraLats add the vertices the road needs to the terrain strip, plan.reserved keeps trees and houses off it,
 *                       crossing-roads-mesh.js builds the asphalt, lines and signs of the chunk that owns the crossing
 *   - crossing-traffic.js  cars, vans, a tractor and a cyclist that wait at the barriers
 * The local frame of one crossing is (a, l): a = metres along the track from the crossing, l = metres to the right of the track axis, so a parallel
 * road is a line l = const that follows the track through curves.  Everything is deterministic (seeded by the route id and the crossing position).
 *
 * plan(ctx): ctx = { id, length, crossings: [{ s }], frameAt(s), baseHeightAt(x, z), secondLat(s), formationDrop, tunnels, bridges, stations, water(s) }
 *   -> { crossings: [{ index, s, groups... }], roads, adjust(x, z, h), reserved(x, z, margin), extraRows(s0, s1), extraLats(s0, s1), ownerOf(s) } */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] crossing roads: ';

  /* ---- road cross sections (half widths in m) */
  const HW_CROSS = 2.9;            // the road over the crossing (same as the asphalt strip in infra.js)
  const HW_PARALLEL = 2.75;
  const HW_LANE = 1.5;             // field lane (gravel)
  const SHOULDER = 0.55;           // gravel verge beside the asphalt
  const FLAT_EXTRA = 0.9;          // terrain stays level this far beyond the verge
  const SLOPE_RUN = 2.6;           // metres of embankment per metre of cut / fill
  const BLEND_MIN = 2.0;
  const BLEND_MAX = 26;
  const ROAD_LIFT = 0.05;          // the drawn road lies this far above the terrain target
  /* ---- layout */
  const SAMPLE = 3;                // m between profile samples
  const JUNCTION_MIN = 46;         // lateral distance of the parallel road
  const JUNCTION_VAR = 20;
  const RIVER_LAT_MAX = 58;        // beside a river valley the roads stay on this side of the water
  const MARGIN_TUNNEL = 130;       // roads keep this far from tunnels, viaducts and stations along the track
  const MARGIN_STATION = 170;
  const MARGIN_END = 70;
  const INFRA_RUN = 13;            // infra.js draws the road this far beyond the outer rail; the planned road starts there
  const FILLET = 7;                // radius of the T-junction corners
  const BEND_R = 26;               // radius of a road that bends into the parallel road
  const LANE_LEN = 70;             // the asphalt ends in a gravel lane of this length
  const SMOOTH_R = 5;              // blur radius of the natural height (samples)
  const MAX_GRADE = 0.055;         // steepest road profile (5.5 %)
  const START_RAMP = 40;           // m over which the profile joins the crossing level
  const INFLUENCE = 40;            // bounding box margin of a road for the terrain adjustment

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /* blur an array with edge replication (3 passes ~ gaussian) */
  function blur(arr, r) {
    let src = arr.slice();
    for (let pass = 0; pass < 3; pass++) {
      const n = src.length;
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[clamp(i + k, 0, n - 1)];
        out[i] = sum / (2 * r + 1);
      }
      src = out;
    }
    return src;
  }

  /* ----------------------------------------------------------------- plan */
  function plan(ctx) {
    const roads = [];          // every polyline of every crossing
    const crossings = [];
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
    /* (s, lat) -> world; lat positive = to the right of the base track direction (right vector = (cos, sin) of heading) */
    const world = (s, lat) => { const f = frameOf(s); return { x: f.x + f.rx * lat, z: f.z + f.rz * lat }; };

    ctx.crossings.forEach((cr, index) => {
      const crossing = cr.patch ? planPatchCrossing(ctx, cr, index, frameOf, world) : planCrossing(ctx, cr, index, frameOf, world, roads);
      if (crossing) crossings.push(crossing);
    });

    const bbox = (r) => {
      let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
      r.pts.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
      const m = INFLUENCE + r.hw;
      return { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m };
    };
    roads.forEach((r) => { r.box = bbox(r); r.grid = buildGrid(r); });

    /* ---- terrain: nearest polyline sample → blend to the road level */
    function nearestOn(r, x, z, out) {
      const cell = GRID_CELL;
      const cx = Math.floor(x / cell); const cz = Math.floor(z / cell);
      let best = Infinity; let bi = -1;
      const reach = Math.ceil((r.hw + SHOULDER + FLAT_EXTRA + BLEND_MAX) / cell);
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          const list = r.grid.get(ix * 100003 + iz);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const i = list[k]; const p = r.pts[i];
            const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (d2 < best) { best = d2; bi = i; }
          }
        }
      }
      if (bi < 0) return null;
      /* refine on the two neighbouring segments */
      let bd2 = Infinity; let by = r.pts[bi].yT; let bu = r.pts[bi].u; let bw = r.pts[bi].hw;
      for (let sg = Math.max(0, bi - 1); sg <= Math.min(r.pts.length - 2, bi); sg++) {
        const p = r.pts[sg]; const q = r.pts[sg + 1];
        const dx = q.x - p.x; const dz = q.z - p.z; const ll = dx * dx + dz * dz || 1;
        const t = clamp(((x - p.x) * dx + (z - p.z) * dz) / ll, 0, 1);
        const ex = p.x + dx * t - x; const ez = p.z + dz * t - z; const d2 = ex * ex + ez * ez;
        if (d2 < bd2) { bd2 = d2; by = lerp(p.yT, q.yT, t); bu = lerp(p.u, q.u, t); bw = lerp(p.hw, q.hw, t); }
      }
      out.d = Math.sqrt(bd2); out.y = by; out.u = bu; out.hw = bw; out.road = r;
      return out;
    }
    const probe = { d: 0, y: 0, u: 0, hw: 0, road: null };
    function adjust(x, z, h) {
      /* the nearest road (largest weight) decides: roads that overlap at a junction have the same height there, so the order does not matter */
      let bestW = 0; let bestY = 0;
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i]; const b = r.box;
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        const q = nearestOn(r, x, z, probe);
        if (!q) continue;
        const inner = q.hw + SHOULDER + FLAT_EXTRA;
        if (q.d >= inner + BLEND_MAX) continue;
        const blendLen = clamp(BLEND_MIN + Math.abs(h - q.y) * SLOPE_RUN, BLEND_MIN, BLEND_MAX);
        const w = 1 - smooth01((q.d - inner) / blendLen);
        if (w > bestW) { bestW = w; bestY = q.y; }
      }
      return bestW > 0 ? lerp(h, bestY, bestW) : h;
    }
    /* design height of the road surface at a world point close to a road (null = none within the cross section) */
    function surfaceAt(x, z, margin) {
      let best = null;
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i]; const b = r.box;
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        const q = nearestOn(r, x, z, probe);
        if (q && q.d <= q.hw + (margin || 0) && (!best || q.d < best.d)) best = { d: q.d, y: q.y + ROAD_LIFT, road: r, u: q.u };
      }
      return best;
    }
    function reserved(x, z, margin) {
      const m = margin || 0;
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i]; const b = r.box;
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        const q = nearestOn(r, x, z, probe);
        if (q && q.d < q.hw + SHOULDER + m) return true;
      }
      return false;
    }

    /* ---- extra terrain vertices for the strip mesh of the chunk [s0, s1) */
    function extraRows(s0, s1) {
      const out = [];
      crossings.forEach((c) => c.rows.forEach((s) => { if (s >= s0 - 0.5 && s <= s1 + 0.5) out.push(s); }));
      return out;
    }
    function extraLats(s0, s1) {
      const out = [];
      crossings.forEach((c) => c.lats.forEach((e) => { if (e.s1 >= s0 - 1 && e.s0 <= s1 + 1) out.push(e.lat); }));
      return out;
    }
    return { crossings, roads, adjust, surfaceAt, reserved, extraRows, extraLats, frameOf, world, ROAD_LIFT };
  }

  /* ----------------------------------------------------------------- one crossing */
  const GRID_CELL = 16;
  function buildGrid(r) {
    const grid = new Map();
    r.pts.forEach((p, i) => {
      const key = Math.floor(p.x / GRID_CELL) * 100003 + Math.floor(p.z / GRID_CELL);
      const a = grid.get(key);
      if (a) a.push(i); else grid.set(key, [i]);
    });
    return grid;
  }

  /* how far along the track (direction q = +1 / -1) from sc a road may run before it meets a tunnel, a viaduct, a station or the end of the route */
  function reach(ctx, sc, q) {
    let limit = q > 0 ? ctx.length - MARGIN_END - sc : sc - MARGIN_END;
    const consider = (a, b, margin) => {
      if (q > 0 && b > sc) limit = Math.min(limit, a - margin - sc);
      if (q < 0 && a < sc) limit = Math.min(limit, sc - (b + margin));
    };
    (ctx.tunnels || []).forEach((t) => consider(t.s0, t.s1, MARGIN_TUNNEL));
    (ctx.bridges || []).forEach((t) => consider(t.s0, t.s1, MARGIN_TUNNEL));
    (ctx.stations || []).forEach((st) => consider(st.platformStart !== undefined ? st.platformStart : st.s - 100, st.platformEnd !== undefined ? st.platformEnd : st.s + 100, MARGIN_STATION));
    return Math.max(0, limit);
  }

  function planCrossing(ctx, cr, index, frameOf, world, roadsOut) {
    const sc = cr.s;
    const rng = mulberry(hashString(String(ctx.id) + ':' + Math.round(sc)));
    const f0 = frameOf(sc);
    const X2 = ctx.secondLat ? ctx.secondLat(sc) : 0;
    const lLo = Math.min(0, X2) - INFRA_RUN;     // where infra.js's crossing road ends (flat run-out beyond the outer rail)
    const lHi = Math.max(0, X2) + INFRA_RUN;
    const wat = ctx.water ? ctx.water(sc) : null;
    const latMax = wat ? RIVER_LAT_MAX : 96;
    const formY = f0.y - ctx.formationDrop;

    const sideA = rng() < 0.5 ? -1 : 1;
    const kind = rng();
    const layout = kind < 0.42 ? 'tField' : kind < 0.78 ? 'tBend' : 'tt';
    const qBend = rng() < 0.5 ? -1 : 1;
    const J = (sd) => Math.min(latMax - 6, JUNCTION_MIN + rng() * JUNCTION_VAR - (wat ? 14 : 0)) * sd;
    const reachPlus = reach(ctx, sc, 1);
    const reachMinus = reach(ctx, sc, -1);
    const maxA = (q) => (q > 0 ? reachPlus : reachMinus);

    const polylines = [];
    const rows = [];
    const lats = [];
    const addRows = (a0, a1, step) => { const lo = Math.min(a0, a1); const hi = Math.max(a0, a1); for (let a = lo; a <= hi + 1e-6; a += Math.abs(step)) rows.push(sc + a); };
    addRows(-12, 12, 2);
    addRows(-26, -14, 4); addRows(14, 26, 4);

    /* a polyline from (a, l) control points: straight pieces are subdivided every SAMPLE m, arcs come ready from arcPoints() */
    const make = (id, kindName, hw, markings, pts, role, parent, joint) => ({ id, kind: kindName, hw, markings, ctrl: pts, index, role: role || 'cross', parent: parent || null, joint: joint || 'end' });

    const crossRoad = (sd, jl, endsAt, hw, kindName) => {
      const l0 = sd > 0 ? lHi : lLo;
      return make('x' + index + (sd > 0 ? 'r' : 'l'), kindName, hw, kindName === 'asphalt', straightLine(0, l0, 0, endsAt), 'cross');
    };
    const parallelRoad = (id, sd, j, qa, qb, hwP, withLane, kindName) => {
      /* asphalt from a = qa to a = qb along l = j; both ends optionally continue as a gravel lane of LANE_LEN m */
      const a0 = qa; const a1 = qb;
      const main = make(id, kindName || 'asphalt', hwP, !kindName, straightLine(a0, j, a1, j), 'parallel');
      const extra = [];
      if (withLane) {
        if (a0 < -1) extra.push(make(id + 'm', 'gravel', HW_LANE, false, straightLine(a0, j, a0 - LANE_LEN, j), 'tail', id, 'start'));
        if (a1 > 1) extra.push(make(id + 'p', 'gravel', HW_LANE, false, straightLine(a1, j, a1 + LANE_LEN, j), 'tail', id, 'end'));
      }
      return [main, ...extra];
    };
    function straightLine(a0, l0, a1, l1) {
      const len = Math.hypot(a1 - a0, l1 - l0);
      const n = Math.max(1, Math.ceil(len / SAMPLE));
      const out = [];
      for (let i = 0; i <= n; i++) out.push({ a: lerp(a0, a1, i / n), l: lerp(l0, l1, i / n) });
      return out;
    }

    const junctions = [];       // T junctions: { sd, l, hwCross, hwPar } → fillets in the mesh stage
    const sides = [sideA, -sideA];
    const info = { layout, sides: [] };
    sides.forEach((sd, k) => {
      const first = k === 0;
      const j = J(sd);
      const tField = layout === 'tField';
      const tBend = layout === 'tBend';
      /* side A: tField -> T junction into a parallel road, tBend -> bends into a parallel road, tt -> T junction.
         side B: tField -> straight on as a field lane, tBend -> T junction, tt -> T junction */
      let type;
      if (first) type = tBend ? 'bend' : 'T';
      else type = tField ? 'lane' : 'T';
      info.sides.push({ sd, type, j });
      if (type === 'T') {
        const hwPar = HW_PARALLEL;
        const qa = -Math.min(maxA(-1), 130 + rng() * 170);
        const qb = Math.min(maxA(1), 130 + rng() * 170);
        const cross = crossRoad(sd, j, j - sd * (hwPar + 0.05), HW_CROSS, 'asphalt');
        polylines.push(cross);
        parallelRoad('p' + index + (sd > 0 ? 'r' : 'l'), sd, j, qa, qb, hwPar, true).forEach((p) => polylines.push(p));
        junctions.push({ sd, l: j, hwCross: HW_CROSS, hwPar, aMin: qa, aMax: qb });
        lats.push({ lat: j, s0: sc + qa - LANE_LEN - 30, s1: sc + qb + LANE_LEN + 30 });
      } else if (type === 'bend') {
        const q = Math.abs(maxA(qBend)) > 150 ? qBend : -qBend;
        const run = Math.min(maxA(q), 150 + rng() * 170);
        const R = BEND_R;
        const pts = straightLine(0, sd > 0 ? lHi : lLo, 0, j - sd * R);
        /* quarter circle: centre at (q * R, j - sd * R); starts heading +sd in l, ends heading q in a */
        const arc = [];
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          const t = (i / steps) * (Math.PI / 2);
          arc.push({ a: q * R * (1 - Math.cos(t)), l: j - sd * R + sd * R * Math.sin(t) });
        }
        const tail = straightLine(q * R, j, q * (R + run), j).slice(1);
        const road = make('b' + index, 'asphalt', HW_CROSS, true, pts.concat(arc, tail), 'bend');
        polylines.push(road);
        polylines.push(make('b' + index + 'g', 'gravel', HW_LANE, false, straightLine(q * (R + run), j, q * (R + run + LANE_LEN), j), 'tail', 'b' + index, 'end'));
        addRows(0, q * (R + 4), q > 0 ? 3 : -3);
        lats.push({ lat: j, s0: sc + Math.min(0, q * (R + run + LANE_LEN)) - 30, s1: sc + Math.max(0, q * (R + run + LANE_LEN)) + 30 });
        info.sides[k].bendQ = q;
      } else {
        /* a field lane: the road meets a gravel track that runs along the line (both ways); the asphalt ends at the track */
        const hwPar = HW_LANE;
        const qa = -Math.min(maxA(-1), 110 + rng() * 120);
        const qb = Math.min(maxA(1), 110 + rng() * 120);
        polylines.push(crossRoad(sd, j, j - sd * (hwPar + 0.05), HW_CROSS, 'asphalt'));
        parallelRoad('p' + index + (sd > 0 ? 'r' : 'l'), sd, j, qa, qb, hwPar, false, 'gravel').forEach((p) => polylines.push(p));
        lats.push({ lat: j, s0: sc + qa - 30, s1: sc + qb + 30 });
        info.sides[k].type = 'T';
        info.sides[k].lane = true;
      }
    });

    /* ---- sample, project to the world, design height */
    const made = polylines.map((p) => finishPolyline(p, ctx, world, frameOf, sc));
    /* profile: the cross / bending roads first (pinned to the crossing level at the start, free end), then the parallel roads (pinned to the height the
       cross road arrives with at the junction), then the gravel tails (pinned to the end of the road they continue) */
    made.filter((r) => r.role === 'cross' || r.role === 'bend').forEach((r) => profile(r, ctx, [{ u: 0, y: formY }]));
    made.filter((r) => r.role === 'parallel').forEach((r) => {
      const cross = made.find((m) => m.role === 'cross' && m.id.slice(1) === r.id.slice(1));
      const pins = [];
      if (cross) {
        const end = cross.pts[cross.pts.length - 1];
        let bi = 0; let bd = Infinity;
        r.pts.forEach((p, i) => { const d = Math.hypot(p.x - end.x, p.z - end.z); if (d < bd) { bd = d; bi = i; } });
        pins.push({ u: r.pts[bi].u, y: end.yT });
      }
      profile(r, ctx, pins);
    });
    made.filter((r) => r.role === 'tail').forEach((r) => {
      const parent = made.find((m) => m.id === r.parent);
      const pj = parent ? (r.joint === 'start' ? parent.pts[0] : parent.pts[parent.pts.length - 1]) : null;
      profile(r, ctx, pj ? [{ u: 0, y: pj.yT }] : []);
    });
    made.forEach((r) => roadsOut.push(r));

    const spanA = Math.max(...made.flatMap((r) => r.pts.map((p) => p.a)));
    const spanB = Math.min(...made.flatMap((r) => r.pts.map((p) => p.a)));
    return {
      index, s: sc, layout, info, roads: made, junctions, rows, lats, X2, lLo, lHi, formY,
      sMin: sc + spanB, sMax: sc + spanA,
    };
  }

  /* A crossing inside a station patch (patch-crossings.js): the road is the real road of the patch, drawn by station-roads.js on the patch ground.  The plan
     only keeps what other modules need: the straight over the crossing (lLo, lHi, X2, formY), the two arms (far end -> deck end, world x / z / y) for the
     traffic, and no terrain work (the patch relief already holds the road). */
  const PATCH_ARM_LIFT = 0.18;       // the patch roads lie this far above the terrain (painted ground lift + ribbon lift of station-roads.js)
  const PATCH_ARM_LIMIT_X = 150;
  function planPatchCrossing(ctx, cr, index, frameOf, world) {
    const sc = cr.s;
    const f0 = frameOf(sc);
    const X2 = ctx.secondLat ? ctx.secondLat(sc) : 0;
    const lLo = Math.min(0, X2) - INFRA_RUN;
    const lHi = Math.max(0, X2) + INFRA_RUN;
    const formY = f0.y - ctx.formationDrop;
    const patch = cr.patch;
    const pts = patch.road;
    const at = (p) => { const w = world(patch.sMid - p.z, p.x); return { x: w.x, z: w.z, y: ctx.baseHeightAt(w.x, w.z) + PATCH_ARM_LIFT, l: p.x }; };
    const i0 = pts.findIndex((p, i) => i < pts.length - 1 && Math.min(p.x, pts[i + 1].x) <= 0 && Math.max(p.x, pts[i + 1].x) > 0);
    const arms = { 1: [], '-1': [] };
    if (i0 >= 0) {
      const dir = pts[i0 + 1].x > pts[i0].x ? 1 : -1;
      const outward = { 1: dir > 0 ? pts.slice(i0 + 1) : pts.slice(0, i0 + 1).reverse(), '-1': dir > 0 ? pts.slice(0, i0 + 1).reverse() : pts.slice(i0 + 1) };
      [1, -1].forEach((sd) => {
        const edgeL = sd > 0 ? lHi : lLo;
        const seq = outward[sd].filter((p) => sd * p.x > sd * edgeL && Math.abs(p.x) <= PATCH_ARM_LIMIT_X);
        if (!seq.length) return;
        const z0 = seq[0].z;                                                          // the straightened part: the road runs at the crossing z up to the blend
        const nearEdge = { x: edgeL, z: z0 };
        arms[sd] = [nearEdge].concat(seq).map(at).reverse();                          // far end first, deck end last
      });
    }
    /* the arms as road records for the checks and tools that walk plan.crossings[].roads (kind 'patch': drawn by station-roads.js, no terrain work) */
    const roadsOut = [1, -1].filter((sd) => arms[sd].length > 1).map((sd) => {
      const near = arms[sd].slice().reverse();                                   // deck end first
      let u = 0;
      const pts = near.map((p, i) => {
        if (i > 0) u += Math.hypot(p.x - near[i - 1].x, p.z - near[i - 1].z);
        const dx = p.x - f0.x; const dz = p.z - f0.z;
        return { x: p.x, z: p.z, yT: p.y - PATCH_ARM_LIFT, a: dx * f0.tx + dz * f0.tz, l: dx * f0.rx + dz * f0.rz, u, hw: cr.hw };
      });
      return { id: 'm' + index + (sd > 0 ? 'r' : 'l'), kind: 'patch', hw: cr.hw, markings: false, index, role: 'patch', parent: null, joint: 'end', pts, len: u, crossing: sc };
    });
    return {
      index, s: sc, layout: 'patch', patch: true, info: { layout: 'patch', sides: [{ sd: 1, type: 'patch', j: lHi }, { sd: -1, type: 'patch', j: lLo }] },
      roads: roadsOut, junctions: [], rows: [], lats: [], X2, lLo, lHi, formY, hw: cr.hw, arms, sMin: sc - 40, sMax: sc + 40,
      patchName: patch.name, roadIndex: patch.roadIndex, used: patch.used, road: patch.road,
    };
  }

  /* turn control points (a, l) into world samples with arc length, tangents and widths */
  function finishPolyline(p, ctx, world, frameOf, sc) {
    const pts = [];
    let u = 0;
    p.ctrl.forEach((c, i) => {
      const w = world(sc + c.a, c.l);
      if (i > 0) { const q = pts[pts.length - 1]; u += Math.hypot(w.x - q.x, w.z - q.z); }
      pts.push({ x: w.x, z: w.z, a: c.a, l: c.l, u, hw: p.hw, yT: 0, nat: 0 });
    });
    pts.forEach((q, i) => {
      const n = pts[Math.min(pts.length - 1, i + 1)]; const m = pts[Math.max(0, i - 1)];
      const dx = n.x - m.x; const dz = n.z - m.z; const dl = Math.hypot(dx, dz) || 1;
      q.tx = dx / dl; q.tz = dz / dl;
    });
    return { id: p.id, kind: p.kind, hw: p.hw, markings: p.markings, index: p.index, role: p.role, parent: p.parent, joint: p.joint, pts, len: u, crossing: sc };
  }

  /* design height of the terrain under the road: the natural ground smoothed over ~30 m, joined to the crossing level at the start
     and (when given) to the height of the road it ends on at the end.  The drawn road lies ROAD_LIFT above it. */
  function profile(r, ctx, pins) {
    const nat = r.pts.map((q) => ctx.baseHeightAt(q.x, q.z));
    const sm = blur(nat, SMOOTH_R);
    const nearest = (u) => { let bi = 0; let bd = Infinity; r.pts.forEach((q, i) => { const d = Math.abs(q.u - u); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const corr = pins.map((pn) => ({ u: pn.u, y: pn.y, d: pn.y - sm[nearest(pn.u)] }));
    const raw = r.pts.map((q, i) => { let y = sm[i]; corr.forEach((c) => { y += c.d * (1 - smooth01(Math.abs(q.u - c.u) / START_RAMP)); }); return y; });
    /* never steeper than MAX_GRADE from a pinned height: the profile is clamped into the cone of grades that radiates from every pin */
    r.pts.forEach((q, i) => {
      let lo = -Infinity; let hi = Infinity;
      pins.forEach((pn) => { lo = Math.max(lo, pn.y - MAX_GRADE * Math.abs(q.u - pn.u)); hi = Math.min(hi, pn.y + MAX_GRADE * Math.abs(q.u - pn.u)); });
      q.nat = nat[i];
      q.yT = pins.length ? (lo > hi ? (lo + hi) / 2 : clamp(raw[i], lo, hi)) : raw[i];
    });
  }

  TS.crossingRoads = Object.freeze({
    plan,
    HW_CROSS, HW_PARALLEL, HW_LANE, SHOULDER, ROAD_LIFT, FILLET, LANE_LEN, SAMPLE, INFRA_RUN,
    tag: TAG,
  });
})();
