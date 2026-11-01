/* Lokféierer: road overbridges, mesh stage (TS.overbridgesMesh.build).
 * Takes one overbridge of the plan made by overbridges.js and returns a THREE.Group (world coordinates, owned by the landscape chunk that holds the crossing):
 *   asphalt  the road over the deck and on the ramps (+ the claimed ground-following stretch up to the ordinary ribbons), white edge / centre lines on the paint layer
 *   concrete deck slab with footways and parapets, abutments, wing walls, guard rails and posts on the ramps
 *   grass    the embankment: crown with verges and the 1:2 slopes (the material and the colours of the terrain strip, so that it grows out of the ground)
 * The deck is a single span over both tracks and the masts, no pier stands inside the corridor (overbridges.js).  The group is painted, flat shaded concrete like the rest of the
 * game, not a texture of photos. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const SHARED = {};

  /* ---- deck cross section (m) */
  const FOOT_W = 1.1;               // footway between the carriageway and the railing
  const FOOT_H = 0.16;              // kerb height of the footway over the road surface
  const KERB_WALL_H = 0.34;         // concrete kerb wall at the outer edge of the footway ...
  const KERB_WALL_T = 0.3;
  const RAIL_TOP = 1.1;             // ... carries a steel railing (as on the real CFL overbridges: slim slab, light railing)
  const RAIL_TOP_T = 0.09;
  const RAIL_MID = 0.55;
  const RAIL_MID_T = 0.06;
  const POST_SPACING = 2.0;
  const CHAMFER = 0.55;             // the underside of the slab is narrower than its top
  const FASCIA = 0.38;              // vertical edge of the slab
  const ASPHALT_LIFT = 0.045;
  const SEAT_DEPTH = 1.7;           // abutment body behind the front face
  const SEAT_BELOW = 0.7;           // ... and below the lowest ground at its foot
  const WING_TOP = 0.42;            // wing wall above the road surface
  const SLAB_OVERHANG = 0.6;        // the slab rests on the abutment
  /* ---- guard rail on the ramps */
  const RAIL_OFFSET = 0.95;         // from the road edge (hw)
  const RAIL_Y0 = 0.52;
  const RAIL_Y1 = 0.78;
  const POST_STEP = 4;
  const POST_SIZE = 0.12;
  const POST_H = 0.62;
  const RAIL_MIN_FILL = 0.9;        // no rail where the road is nearly on the ground
  /* ---- markings */
  const EDGE_LINE_OFFSET = 0.3;
  const EDGE_LINE_HALF = 0.06;
  const LINE_LIFT = 0.012;
  const DASH_ON = 3;
  const DASH_PERIOD = 9;
  /* ---- colours */
  const CONC_TOP = [0.80, 0.79, 0.76];
  const CONC_SIDE = [0.72, 0.71, 0.68];
  const CONC_DARK = [0.46, 0.45, 0.43];
  const CONC_CAP = [0.86, 0.85, 0.82];
  const CONC_WING = [0.68, 0.67, 0.64];
  const STEEL = [0.62, 0.65, 0.67];
  const LINE = [0.93, 0.93, 0.9];
  const VERGE_COL = [0.55, 0.52, 0.45];
  const WHITE = [1, 1, 1];
  const SHADOW_QUALITY = new Set(['high']);      // the deck casts its shadow on the track on high only: an extra shadow-pass draw per mesh is too dear on the school iPads (medium)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* painted concrete: fine grain, a few stains and board-formwork joints; the tile is 2.5 m x 2.5 m */
  function concreteTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#d4d2cc'; g.fillRect(0, 0, 128, 128);
    const r = mulberry(7);
    for (let i = 0; i < 1400; i++) { const v = 150 + r() * 90; g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 4) + ',' + (0.12 + r() * 0.2) + ')'; g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2); }
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(60,62,58,' + (0.04 + r() * 0.05) + ')'; g.fillRect(r() * 128, 0, 3 + r() * 9, 128); }
    g.fillStyle = 'rgba(70,70,66,0.22)';
    for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 1);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  function materials() {
    if (SHARED.m) return SHARED.m;
    const base = TS.crossingRoadsMesh.materials();
    SHARED.m = { asphalt: base.asphalt, paint: base.paint, concrete: new T.MeshLambertMaterial({ vertexColors: true, map: concreteTexture() }), steel: new T.MeshLambertMaterial({ vertexColors: true }) };
    return SHARED.m;
  }

  /* ---- helpers on the shared mesh builder (crossing-roads-mesh.js MB: positions, normals, colours, uvs) */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const P = (x, y, z) => [x, y, z];
  const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  /* a quad strip between two polylines of equal length (arrays of [x, y, z]); `hint` is the direction the faces must look to */
  function strip(mb, A, B, hint, col, uvOf) {
    for (let i = 0; i + 1 < A.length; i++) {
      const uv = uvOf ? uvOf(i) : null;
      mb.quadFacing(A[i], B[i], B[i + 1], A[i + 1], hint, typeof col === 'function' ? col(i) : col, uv);
    }
  }
  const metric = (A, i) => { let d = 0; for (let k = 1; k <= i; k++) d += Math.hypot(A[k][0] - A[k - 1][0], A[k][2] - A[k - 1][2]); return d; };
  /* uv of a strip that runs along a polyline: u along the polyline, v across / up, 2.5 m per tile */
  const TILE = 2.5;
  function alongUV(A, B) {
    const cum = [0]; for (let i = 1; i < A.length; i++) cum.push(cum[i - 1] + Math.hypot(A[i][0] - A[i - 1][0], A[i][2] - A[i - 1][2]));
    return (i) => [[cum[i] / TILE, 0], [cum[i] / TILE, Math.hypot(B[i][0] - A[i][0], B[i][1] - A[i][1], B[i][2] - A[i][2]) / TILE], [cum[i + 1] / TILE, Math.hypot(B[i + 1][0] - A[i + 1][0], B[i + 1][1] - A[i + 1][1], B[i + 1][2] - A[i + 1][2]) / TILE], [cum[i + 1] / TILE, 0]];
  }
  /* oriented box: centre, direction (tx, tz) of its length axis, size (across, height, along) */
  function obox(mb, cx, cy, cz, tx, tz, across, height, along, col) {
    const nx = -tz; const nz = tx;
    const hx = across / 2; const hl = along / 2; const y0 = cy - height / 2; const y1 = cy + height / 2;
    const c = (a, l, y) => P(cx + nx * a + tx * l, y, cz + nz * a + tz * l);
    const corners = [[-hx, -hl], [hx, -hl], [hx, hl], [-hx, hl]];
    for (let i = 0; i < 4; i++) {
      const [a0, l0] = corners[i]; const [a1, l1] = corners[(i + 1) % 4];
      const mx = (a0 + a1) / 2; const ml = (l0 + l1) / 2;
      mb.quadFacing(c(a0, l0, y0), c(a1, l1, y0), c(a1, l1, y1), c(a0, l0, y1), [nx * mx + tx * ml, 0, nz * mx + tz * ml], col);
    }
    mb.quadFacing(c(-hx, -hl, y1), c(hx, -hl, y1), c(hx, hl, y1), c(-hx, hl, y1), [0, 1, 0], tint(col, 1.06));
  }

  /* ---- one overbridge, appended to the mesh builders of its chunk (every overbridge of a chunk shares the same four draw calls) */
  function buildInto(ob, plan, opts, mbs) {
    const latCap = Math.min(112, Math.max(40, (opts && opts.strip ? opts.strip : 120) - 6));
    const d = plan.design(ob, latCap);
    const { asphalt, paint, conc, grass } = mbs;
    const steelMb = conc;      // railings and posts share the concrete mesh (one draw call fewer, the texture is fine grain)
    const smp = d.smp; const hw = d.hw; const hc = d.hc; const WALL_T = plan.constants.WALL_T; const SLAB_T = plan.constants.SLAB_T;
    const SLOPE_RUN = plan.constants.SLOPE_RUN; const TOE_SINK = plan.constants.TOE_SINK;
    const groundAt = plan.groundAt;
    const nOf = (q) => [-q.tz, q.tx];
    const at = (q, off, y) => { const n = nOf(q); return P(q.x + n[0] * off, y, q.z + n[1] * off); };

    /* ---- asphalt: the whole claimed road, so the ordinary ribbons can start where it ends */
    const roadCol = (q) => { const k = 0.92 + 0.08 * Math.sin(q.u * 0.19 + q.x * 0.11) * Math.cos(q.u * 0.07 + q.z * 0.13); return [k, k, k]; };
    for (let i = 0; i + 1 < smp.length; i++) {
      const a = smp[i]; const b = smp[i + 1];
      const ya = a.y + ASPHALT_LIFT; const yb = b.y + ASPHALT_LIFT;
      asphalt.quadFacing(at(a, -hw, ya), at(a, hw, ya), at(b, hw, yb), at(b, -hw, yb), [0, 1, 0], roadCol(a), [[-hw / 4, a.u / 4], [hw / 4, a.u / 4], [hw / 4, b.u / 4], [-hw / 4, b.u / 4]]);
    }
    /* ---- markings: edge lines everywhere, a dashed or solid centre line on the wider roads */
    const wide = ob.w >= 5.6;
    if (wide) {
      const line = (off, skip) => {
        for (let i = 0; i + 1 < smp.length; i++) {
          if (skip && skip(smp[i], smp[i + 1])) continue;
          const a = smp[i]; const b = smp[i + 1];
          paint.quadFacing(at(a, off - EDGE_LINE_HALF, a.y + ASPHALT_LIFT + LINE_LIFT), at(a, off + EDGE_LINE_HALF, a.y + ASPHALT_LIFT + LINE_LIFT), at(b, off + EDGE_LINE_HALF, b.y + ASPHALT_LIFT + LINE_LIFT), at(b, off - EDGE_LINE_HALF, b.y + ASPHALT_LIFT + LINE_LIFT), [0, 1, 0], LINE);
        }
      };
      line(-(hw - EDGE_LINE_OFFSET)); line(hw - EDGE_LINE_OFFSET);
      if (ob.w >= 11) { line(-0.15); line(0.15); } else line(0, (a, b) => (a.u % DASH_PERIOD) >= DASH_ON || (b.u % DASH_PERIOD) < 0.01);
    }

    /* ---- deck: slab, footways, parapets (between the abutments, plus the seat overlap) */
    const deckIdx = []; smp.forEach((q, i) => { if (q.deck) deckIdx.push(i); });
    if (deckIdx.length >= 2) {
      const dq = deckIdx.map((i) => smp[i]);
      const mk = (off, dy) => dq.map((q) => at(q, off, q.y + dy));
      const edgeY = -FASCIA; const botY = -SLAB_T;
      const ext = (list) => {        // continue the first / last sample by SLAB_OVERHANG along the road so the slab rests on the abutments
        const f = dq[0]; const l = dq[dq.length - 1];
        const lead = { x: f.x - f.tx * SLAB_OVERHANG, z: f.z - f.tz * SLAB_OVERHANG, tx: f.tx, tz: f.tz, y: f.y, u: f.u - SLAB_OVERHANG };
        const tail = { x: l.x + l.tx * SLAB_OVERHANG, z: l.z + l.tz * SLAB_OVERHANG, tx: l.tx, tz: l.tz, y: l.y, u: l.u + SLAB_OVERHANG };
        return [lead].concat(list, [tail]);
      };
      const Q = ext(dq);
      const row = (off, dy) => Q.map((q) => at(q, off, q.y + dy));
      const L = (off, dy) => row(-off, dy); const R = (off, dy) => row(off, dy);
      const sides = [{ sd: -1, f: L }, { sd: 1, f: R }];
      const up = [0, 1, 0]; const down = [0, -1, 0];
      sides.forEach(({ sd, f }) => {
        const outward = [-Q[0].tz * sd, 0, Q[0].tx * sd];
        const inward = [-outward[0], 0, -outward[2]];
        // fascia (vertical) and chamfer (looks down and out)
        const edgeTop = f(hc, 0); const edgeMid = f(hc, edgeY); const chamf = f(hc - CHAMFER, botY);
        strip(conc, edgeMid, edgeTop, outward, CONC_SIDE, alongUV(edgeMid, edgeTop));
        strip(conc, chamf, edgeMid, [outward[0], -0.8, outward[2]], tint(CONC_DARK, 1.15), alongUV(chamf, edgeMid));
        // footway top and kerb
        const footIn = f(hw, FOOT_H); const footOut = f(hw + FOOT_W, FOOT_H);
        strip(conc, footIn, footOut, up, CONC_TOP, alongUV(footIn, footOut));
        strip(conc, f(hw, ASPHALT_LIFT), footIn, inward, CONC_SIDE);
        // kerb wall at the outer edge of the footway (concrete), the steel railing on top of it: posts, top rail, mid rail
        const kIn = f(hw + FOOT_W, FOOT_H); const kInTop = f(hw + FOOT_W, FOOT_H + KERB_WALL_H); const kOutTop = f(hw + FOOT_W + KERB_WALL_T, FOOT_H + KERB_WALL_H); const kOut = f(hw + FOOT_W + KERB_WALL_T, FOOT_H);
        strip(conc, kIn, kInTop, inward, CONC_SIDE, alongUV(kIn, kInTop));
        strip(conc, kInTop, kOutTop, up, CONC_CAP);
        strip(conc, kOut, kOutTop, outward, CONC_SIDE, alongUV(kOut, kOutTop));
        strip(conc, kOut, f(hc, FOOT_H), up, CONC_TOP);
        strip(conc, f(hc, 0), f(hc, FOOT_H), outward, CONC_SIDE);
        const railOff = hw + FOOT_W + KERB_WALL_T / 2;
        const railBase = FOOT_H + KERB_WALL_H;
        [[RAIL_TOP, RAIL_TOP_T], [RAIL_MID, RAIL_MID_T]].forEach(([h0, th]) => {
          const lo = f(railOff, railBase + h0); const hi = f(railOff, railBase + h0 + th);
          strip(steelMb, lo, hi, outward, STEEL); strip(steelMb, lo, hi, inward, STEEL);
          const cap = f(railOff + 0.03, railBase + h0 + th); const cap2 = f(railOff - 0.03, railBase + h0 + th);
          strip(steelMb, cap2, cap, up, tint(STEEL, 1.1));
        });
        let nextPost = Math.ceil((Q[0].u + 0.2) / POST_SPACING) * POST_SPACING;
        Q.forEach((q, i) => {
          if (i === 0 || q.u < nextPost) return;
          nextPost += POST_SPACING;
          const n = nOf(q);
          obox(steelMb, q.x + n[0] * sd * railOff, q.y + railBase + RAIL_TOP / 2, q.z + n[1] * sd * railOff, q.tx, q.tz, 0.07, RAIL_TOP, 0.07, tint(STEEL, 0.9));
        });
        // stone-faced end posts at the abutments (as on the old CFL bridges)
        [Q[1], Q[Q.length - 2]].forEach((q) => {
          const n = nOf(q);
          obox(conc, q.x + n[0] * sd * railOff, q.y + railBase + 0.55, q.z + n[1] * sd * railOff, q.tx, q.tz, 0.42, 1.1, 0.42, [0.62, 0.6, 0.55]);
        });
      });
      // underside of the slab between the chamfers (looks down: dark under the sun)
      { const lo = L(hc - CHAMFER, botY); const hi = R(hc - CHAMFER, botY); strip(conc, lo, hi, down, CONC_DARK, alongUV(lo, hi)); }
      // slab top under the asphalt strip (so the gap at the kerbs is closed)
      strip(conc, L(hw, 0), R(hw, 0), up, CONC_TOP);
      // closing faces of the slab ends (hidden by the abutments, but the camera under the deck must not look into the slab)
      [Q[0], Q[Q.length - 1]].forEach((q, k) => {
        const dir = k === 0 ? [-q.tx, 0, -q.tz] : [q.tx, 0, q.tz];
        conc.quadFacing(at(q, -hc, q.y), at(q, hc, q.y), at(q, hc - CHAMFER, q.y + botY), at(q, -(hc - CHAMFER), q.y + botY), dir, CONC_DARK);
      });

      /* ---- abutments: a block with the front face towards the track, its foot below the lowest ground around it */
      [{ i: d.iA, dir: -1 }, { i: d.iB, dir: 1 }].forEach(({ i, dir }) => {
        const q = smp[i];
        let low = Infinity;
        for (const off of [-hc, 0, hc]) { const n = nOf(q); low = Math.min(low, groundAt(q.x + n[0] * off, q.z + n[1] * off)); }
        const bottom = low - SEAT_BELOW;
        const top = q.y - SLAB_T;
        if (top <= bottom + 0.2) return;
        const depth = SEAT_DEPTH;
        const cx = q.x + q.tx * dir * (depth / 2); const cz = q.z + q.tz * dir * (depth / 2);
        obox(conc, cx, (top + bottom) / 2, cz, q.tx, q.tz, 2 * (hc + WALL_T), top - bottom, depth, CONC_SIDE);
      });
    }

    /* ---- embankment: crown with verges and slopes (one smooth grid per run of ramp samples), wing walls, guard rails */
    const cap = (opts && opts.groundColorAt) || (() => new T.Color('#7ba947'));
    const runs = [];
    let cur = [];
    for (let i = d.rows[0]; i <= d.rows[1]; i++) {
      if (smp[i].deck) { if (cur.length) runs.push(cur); cur = []; continue; }
      cur.push(i);
    }
    if (cur.length) runs.push(cur);
    runs.forEach((idx) => {
      if (idx.length < 2) return;
      const rowsV = idx.map((i) => {
        const q = smp[i];
        const col = (x, z, y, lat) => { const c = cap(q.s, lat, x, z, y); return [c.r, c.g, c.b]; };
        const E = hc + WALL_T;
        const vert = (off, y, color) => { const n = nOf(q); const x = q.x + n[0] * off; const z = q.z + n[1] * off; return { x, y, z, col: color || col(x, z, y, q.lat), u: x / 7, v: z / 7 }; };
        const ends = [0, 1].map((k) => {
          const sd = k === 0 ? -1 : 1;
          const toe = q.toe[k === 0 ? 1 : 0];
          const reach = E + toe;
          const x = q.x + nOf(q)[0] * sd * reach; const z = q.z + nOf(q)[1] * sd * reach;
          const yT = q.dist <= d.wing ? q.y : Math.min(q.y - toe / SLOPE_RUN, groundAt(x, z)) - TOE_SINK;     // beside the wing wall the slope has no width: the concrete wall is the face
          return vert(sd * reach, yT);
        });
        const verge = (sd, off) => vert(sd * off, q.y, tint(VERGE_COL, 0.95 + 0.1 * Math.sin(q.u * 0.31)));
        return [ends[0], vert(-E, q.y), verge(-1, hw), verge(1, hw), vert(E, q.y), ends[1]];
      });
      const base = grass.count;
      const nA = rowsV.length; const nB = rowsV[0].length;
      for (let a = 0; a < nA; a++) for (let b = 0; b < nB; b++) {
        const p = rowsV[a][b]; const pa0 = rowsV[Math.max(a - 1, 0)][b]; const pa1 = rowsV[Math.min(a + 1, nA - 1)][b]; const pb0 = rowsV[a][Math.max(b - 1, 0)]; const pb1 = rowsV[a][Math.min(b + 1, nB - 1)];
        const u = sub([pa1.x, pa1.y, pa1.z], [pa0.x, pa0.y, pa0.z]); const v = sub([pb1.x, pb1.y, pb1.z], [pb0.x, pb0.y, pb0.z]);
        let nx = v[1] * u[2] - v[2] * u[1]; let ny = v[2] * u[0] - v[0] * u[2]; let nz = v[0] * u[1] - v[1] * u[0];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        grass.vert(p.x, p.y, p.z, nx, ny, nz, p.col, p.u, p.v);
      }
      for (let a = 0; a < nA - 1; a++) for (let b = 0; b < nB - 1; b++) {
        const i0 = base + a * nB + b; const i1 = i0 + 1; const i2 = i0 + nB; const i3 = i2 + 1;
        grass.tri(i0, i1, i2); grass.tri(i1, i3, i2);
      }
    });

    /* wing walls: vertical, along the road edge from the abutment out to WING_LEN, down to the ground; and the guard rail + posts further out */
    const wingTop = WING_TOP;
    [-1, 1].forEach((sd) => {
      const k = sd < 0 ? 1 : 0;
      for (const dirSide of [-1, 1]) {
        // samples on this side of the deck within the wing length
        const seq = smp.filter((q) => !q.deck && (dirSide < 0 ? q.u < d.uA : q.u > d.uB) && q.dist <= d.wing + 2.5);
        if (seq.length < 2) continue;
        const ordered = dirSide < 0 ? seq.slice().reverse() : seq;       // from the abutment outwards
        const edgeG = (q) => q.edgeG[k];
        const topA = ordered.map((q) => at(q, sd * (hc + WALL_T), q.y + wingTop));
        const topB = ordered.map((q) => at(q, sd * hc, q.y + wingTop));
        const footA = ordered.map((q) => at(q, sd * (hc + WALL_T), Math.min(edgeG(q), q.y) - 0.3));
        const outward = [-ordered[0].tz * sd, 0, ordered[0].tx * sd];
        strip(conc, footA, topA, outward, CONC_WING, (i) => alongUV(footA, topA)(i));          // outer face
        strip(conc, topB, topA, [0, 1, 0], CONC_CAP);                                           // coping
        // inner face (seen from the road): from the crown up to the coping
        strip(conc, ordered.map((q) => at(q, sd * hc, q.y)), topB, [-outward[0], 0, -outward[2]], CONC_WING);
        // end face where the wall stops (the slope starts)
        const e = ordered[ordered.length - 1];
        conc.quadFacing(at(e, sd * hc, e.y + wingTop), at(e, sd * (hc + WALL_T), e.y + wingTop), at(e, sd * (hc + WALL_T), Math.min(edgeG(e), e.y) - 0.3), at(e, sd * hc, Math.min(edgeG(e), e.y) - 0.3), [e.tx * dirSide, 0, e.tz * dirSide], CONC_WING);
      }
    });
    // guard rails on the embankment beyond the wing walls
    {
      const sample = (list) => list.filter((q) => !q.deck && q.dist > d.wing + 1 && Math.min(q.y - q.gl, q.y - q.gr) > RAIL_MIN_FILL);
      const groups = [];
      let curG = [];
      smp.forEach((q, i) => { const ok = sample([q]).length === 1; if (ok) curG.push(q); else { if (curG.length > 1) groups.push(curG); curG = []; } if (i === smp.length - 1 && curG.length > 1) groups.push(curG); });
      groups.forEach((seq) => {
        [-1, 1].forEach((sd) => {
          const lo = seq.map((q) => at(q, sd * (hw + RAIL_OFFSET), q.y + RAIL_Y0)); const hi = seq.map((q) => at(q, sd * (hw + RAIL_OFFSET), q.y + RAIL_Y1));
          const outward = [-seq[0].tz * sd, 0, seq[0].tx * sd];
          strip(conc, lo, hi, outward, STEEL); strip(conc, lo, hi, [-outward[0], 0, -outward[2]], STEEL);
          let nextPost = Math.ceil(seq[0].u / POST_STEP) * POST_STEP;
          seq.forEach((q, i) => {
            if (i === 0 || q.u < nextPost) return;
            nextPost += POST_STEP;
            const n = nOf(q);
            obox(conc, q.x + n[0] * sd * (hw + RAIL_OFFSET + 0.08), q.y + POST_H / 2, q.z + n[1] * sd * (hw + RAIL_OFFSET + 0.08), q.tx, q.tz, POST_SIZE, POST_H, POST_SIZE, tint(STEEL, 0.85));
          });
        });
      });
    }

    // cars of the landscape drive over the bridge (landscape.js rebuildCars: pts carry the height)
    if (opts && opts.chunkRoads && ob.c !== 'track' && ob.c !== 'service') {
      const pts = smp.map((q) => ({ x: q.x, y: q.y + 0.1, z: q.z }));
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      if (pts.length > 3) opts.chunkRoads.push({ pts, cum, len: cum[cum.length - 1], hw, city: false });
    }
  }

  /* all overbridges whose crossing lies in one chunk -> one group with at most four meshes: asphalt, paint, concrete (+ steel), embankment */
  function buildMany(list, plan, opts) {
    const quality = (opts && opts.quality) || 'medium';
    const mats = materials();
    const MB = TS.crossingRoadsMesh.MB;
    const mbs = { asphalt: new MB(), paint: new MB(), conc: new MB(), grass: new MB() };
    const group = new T.Group();
    group.name = 'overbridges-' + list.map((o) => o.index).join('+');
    group.userData.road = true;
    list.forEach((ob) => {
      try { buildInto(ob, plan, opts, mbs); } catch (error) { console.warn(TS.overbridges.tag + 'overbridge ' + ob.index + ' failed', error); }
    });
    const add = (mb, mat, shadow, name) => {
      if (mb.empty) return;
      const mesh = new T.Mesh(mb.geometry(), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = !!shadow && SHADOW_QUALITY.has(quality);
      mesh.name = name;
      group.add(mesh);
    };
    add(mbs.asphalt, mats.asphalt, false, 'ob-asphalt');
    add(mbs.paint, mats.paint, false, 'ob-paint');
    add(mbs.conc, mats.concrete, true, 'ob-concrete');
    add(mbs.grass, opts.terrainMat, false, 'ob-embankment');
    return group;
  }

  TS.overbridgesMesh = Object.freeze({ buildMany });
  void metric; void lerp; void clamp; void WHITE;
})();
