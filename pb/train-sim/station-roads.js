/* Lokféierer: 3D road surfaces of a station patch (TS.stationRoads.build).
 * The patch (station-surround.js) paints the OSM roads into its ground texture; this adds real geometry on top: an asphalt ribbon per road with white edge
 * lines and a dashed centre line (primary .. tertiary), kerbs where the road has pavements, and a fresh surface where the road crosses the railway.  The
 * road that crosses the line (patch-crossings.js) is the straightened one and starts at the ends of the crossing deck of infra.js, whose height it joins.
 *   const rec = TS.stationRoads.build({ data, world(x, z) -> { x, z }, groundY(wx, wz) -> y, crossing: { road, lLo, lHi, roadIndex, deckY } | null, quality })
 *   rec = { group, stats, dispose() }   // group in world coordinates */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;

  const DRIVABLE = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service'];
  const MARKED = ['primary', 'secondary', 'tertiary'];
  const KERBED = ['primary', 'secondary', 'tertiary', 'residential'];
  const SAMPLE = 3;                  // m between ribbon samples
  const ROAD_LIFT = 0.05;            // above the painted ground
  const LINE_LIFT = 0.012;
  const EDGE_LINE_OFF = 0.3;
  const LINE_HALF = 0.06;
  const DASH_ON = 3;
  const DASH_PERIOD = 9;
  const KERB_W = 0.18;
  const KERB_H = 0.1;
  const MAX_X = 150;                 // the strip of the game is narrower than the patch
  const DECK_BLEND = 12;             // m over which the road height joins the end of the crossing deck
  const MIN_HW = 1.2;
  const MAX_HW = 4.6;
  const ASPHALT = [0.1, 0.105, 0.11];            // linear colour (sRGB about #595b5e, like the painted road of the patch)
  const LINE = [0.8, 0.8, 0.76];
  const KERB = [0.42, 0.41, 0.39];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
  const hash = (x, y) => { let h = Math.imul(Math.round(x * 7) | 0, 374761393) + Math.imul(Math.round(y * 7) | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  class MB {
    constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    get empty() { return this.i.length === 0; }
    vert(x, y, z, nx, ny, nz, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); return this.count - 1; }
    tri(a, b, c) { this.i.push(a, b, c); }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
  }

  /* resample a polyline (world x / z) to SAMPLE metres with tangents, arc length */
  function sample(pts) {
    const out = [];
    let u = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(len / SAMPLE));
      for (let k = 0; k < n; k++) out.push({ x: lerp(a.x, b.x, k / n), z: lerp(a.z, b.z, k / n), u: u + (len * k) / n, px: lerp(a.px, b.px, k / n), pz: lerp(a.pz, b.pz, k / n) });
      u += len;
    }
    const l = pts[pts.length - 1];
    out.push({ x: l.x, z: l.z, u, px: l.px, pz: l.pz });
    out.forEach((p, i) => {
      const a = out[Math.max(0, i - 1)]; const b = out[Math.min(out.length - 1, i + 1)];
      const dx = b.x - a.x; const dz = b.z - a.z; const l2 = Math.hypot(dx, dz) || 1;
      p.tx = dx / l2; p.tz = dz / l2;
    });
    return out;
  }

  /* a band between two rails along the samples.  rail0 / rail1: (p) -> [x, y, z]; hint: [nx, ny, nz] or (p) -> that (the side the band faces); the winding follows the hint */
  function band(mb, pts, rail0, rail1, hint, col, skip) {
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = rail0(p); const b = rail1(p);
      const c = typeof col === 'function' ? col(p) : col;
      const cur = { a, b, ia: -1, ib: -1 };
      if (prev && !(skip && (skip(pts[i - 1]) || skip(p)))) {
        // quad prev.a, prev.b, cur.b, cur.a: normal of (prev.b - prev.a) x (cur.a - prev.a)
        const ux = prev.b[0] - prev.a[0]; const uy = prev.b[1] - prev.a[1]; const uz = prev.b[2] - prev.a[2];
        const vx = cur.a[0] - prev.a[0]; const vy = cur.a[1] - prev.a[1]; const vz = cur.a[2] - prev.a[2];
        const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
        const h = typeof hint === 'function' ? hint(p) : hint;
        const flip = nx * h[0] + ny * h[1] + nz * h[2] < 0;
        const n = Math.hypot(nx, ny, nz) || 1; const sg = flip ? -1 : 1;
        const pa = mb.vert(prev.a[0], prev.a[1], prev.a[2], sg * nx / n, sg * ny / n, sg * nz / n, prev.c);
        const pb = mb.vert(prev.b[0], prev.b[1], prev.b[2], sg * nx / n, sg * ny / n, sg * nz / n, prev.c);
        const cb = mb.vert(cur.b[0], cur.b[1], cur.b[2], sg * nx / n, sg * ny / n, sg * nz / n, c);
        const ca = mb.vert(cur.a[0], cur.a[1], cur.a[2], sg * nx / n, sg * ny / n, sg * nz / n, c);
        if (flip) { mb.tri(pa, ca, pb); mb.tri(pb, ca, cb); } else { mb.tri(pa, pb, ca); mb.tri(pb, cb, ca); }
      }
      cur.c = c; prev = cur;
    }
  }
  const UP = [0, 1, 0];
  /* flat ribbon between lateral offsets o0 and o1 (positive = right of the walking direction), `lift` above yOf(p) */
  function ribbon(mb, pts, o0, o1, yOf, lift, col, skip) {
    const at = (o) => (p) => [p.x - p.tz * o, yOf(p) + lift, p.z + p.tx * o];
    band(mb, pts, at(o0), at(o1), UP, col, skip);
  }
  /* a kerb along one side (side = -1 left, +1 right): top and the two vertical faces */
  function kerb(mb, pts, side, hw, yOf, skip) {
    const inner = side * hw; const outer = side * (hw + KERB_W);
    const at = (o, h) => (p) => [p.x - p.tz * o, yOf(p) + ROAD_LIFT + h, p.z + p.tx * o];
    band(mb, pts, at(inner, KERB_H), at(outer, KERB_H), UP, KERB, skip);
    const face = [KERB[0] * 0.8, KERB[1] * 0.8, KERB[2] * 0.8];
    band(mb, pts, at(inner, 0), at(inner, KERB_H), (p) => [-side * -p.tz, 0, -side * p.tx], face, skip);   // inner face looks at the road
    band(mb, pts, at(outer, 0), at(outer, KERB_H), (p) => [side * -p.tz, 0, side * p.tx], face, skip);
  }

  function build(o) {
    const data = o.data;
    const group = new T.Group();
    group.name = 'station-roads';
    const asphalt = new MB(); const paint = new MB(); const kerbs = new MB();
    const stats = { roads: 0, tris: 0 };
    const crossing = o.crossing || null;
    const toWorld = (p) => { const w = o.world(p.x, p.z); return { x: w.x, z: w.z, px: p.x, pz: p.z }; };
    const yGround = (p) => o.groundY(p.x, p.z);

    const emit = (pts, hw, cls, opt) => {
      if (pts.length < 2) return;
      const sm = sample(pts);
      const deck = opt && opt.deck;
      // height: the ground, joined to the deck end over DECK_BLEND m for the crossing road
      const yOf = deck ? (p) => { const t = smooth01(Math.abs(p.px - deck.edgeX) / DECK_BLEND); return lerp(deck.y - ROAD_LIFT, yGround(p), t); } : yGround;
      const wear = (p) => { const k = 0.93 + 0.14 * hash(p.x * 0.31, p.z * 0.29); return [ASPHALT[0] * k, ASPHALT[1] * k, ASPHALT[2] * k]; };
      ribbon(asphalt, sm, -hw, hw, yOf, ROAD_LIFT, wear);
      const eo = hw - EDGE_LINE_OFF;
      if (MARKED.includes(cls) && hw >= 2.6) {
        [-eo, eo].forEach((off) => ribbon(paint, sm, off - LINE_HALF, off + LINE_HALF, yOf, ROAD_LIFT + LINE_LIFT, LINE));
        // dashed centre line
        let k0 = 0;
        while (k0 < sm.length - 1) {
          const u0 = Math.floor(sm[k0].u / DASH_PERIOD) * DASH_PERIOD + (sm[k0].u % DASH_PERIOD < DASH_ON ? 0 : DASH_PERIOD);
          const seg = sm.filter((p) => p.u >= u0 && p.u <= u0 + DASH_ON);
          if (seg.length >= 2 && !(opt && opt.noCentre && opt.noCentre(seg[0]))) ribbon(paint, seg, -LINE_HALF, LINE_HALF, yOf, ROAD_LIFT + LINE_LIFT, LINE);
          const nxt = sm.findIndex((p) => p.u > u0 + DASH_PERIOD - 0.01);
          if (nxt < 0 || nxt <= k0) break;
          k0 = nxt;
        }
      }
      if (KERBED.includes(cls) && hw >= 2.2) {
        const skip = deck ? (p) => Math.abs(p.px - deck.edgeX) < deck.noKerb : null;
        kerb(kerbs, sm, -1, hw, yOf, skip); kerb(kerbs, sm, 1, hw, yOf, skip);
      }
      stats.roads++;
    };

    (data.roads || []).forEach((rd, ri) => {
      if (!DRIVABLE.includes(rd.cls) || rd.bridge) return;
      const hw = clamp((rd.w || 5) / 2, MIN_HW, MAX_HW);
      if (crossing && (crossing.used || [crossing.roadIndex]).includes(ri)) return;       // the crossing road and the ways that continue it: drawn below from the straightened course
      const pts = (rd.pts || []).filter((p) => Math.abs(p[0]) <= MAX_X).map((p) => toWorld({ x: p[0], z: p[1] }));
      emit(pts, hw, rd.cls);
    });
    if (crossing) {
      const rd = data.roads[crossing.roadIndex];
      const hw = clamp((rd.w || 5) / 2, MIN_HW, MAX_HW);
      const road = crossing.road.filter((p) => Math.abs(p.x) <= MAX_X);
      [[1, crossing.lHi], [-1, crossing.lLo]].forEach(([sd, edge]) => {
        const seq = road.filter((p) => sd * p.x > sd * edge);
        if (seq.length < 1) return;
        const start = { x: edge, z: seq[0].z };
        const pts = [start].concat(seq).map(toWorld);
        emit(pts, hw, rd.cls, { deck: { edgeX: edge, y: crossing.deckY, noKerb: 5 } });
      });
    }

    const mat = new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matPaint = new T.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const matKerb = new T.MeshLambertMaterial({ vertexColors: true });
    const add = (mb, m, cast, order) => {
      if (mb.empty) return;
      const mesh = new T.Mesh(mb.geometry(), m); mesh.receiveShadow = true; mesh.castShadow = !!cast; mesh.renderOrder = order || 0;
      group.add(mesh); stats.tris += mb.i.length / 3;
    };
    add(asphalt, mat, false, 1); add(paint, matPaint, false, 2); add(kerbs, matKerb, false, 1);
    return {
      group, stats,
      dispose() { group.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); mat.dispose(); matPaint.dispose(); matKerb.dispose(); },
    };
  }

  TS.stationRoads = Object.freeze({ build, DRIVABLE });
})();
