/* ============================================================================================================================================
   LUXTRAM road pits: a ramp that sinks into a cutting (the exit ramp of an underground car park beside Avenue J.F. Kennedy).
   Data: structures.json "pits" (scripts/luxtram_pits.py).  The ground around the pit is filled to the street level in the height tiles; the ground shaders cut
   the pit's footprint away (luxtram-ground.js uPit); this module builds what is in the hole - floor, two retaining walls with coping and railing, the
   portal of the covered part - and answers the height queries of the traffic (a car on the ramp stands on the floor, a car in the street beside it on the street).

   Frame of a pit: axis a (metres from the OSM way start along the ramp, unit vector u), lateral b (right of the axis, n = (-u.z, u.x)), scene coordinates.
   Street level ("lid") L(a, b) = c0 + c1 a + k b;  depth(a) = d0 - g a (>= 0);  floor top = L(a, 0) - depth(a) + ROAD_LIFT.
   ============================================================================================================================================ */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[luxPits] ';

  const WALL_STEP = 3.0;          // retaining wall panels (m): two concrete tones, like form-work lifts
  const COPING_H = 0.18;          // the coping stands this far above the street (m)
  const POST_STEP = 2.5;          // railing posts (m)
  const RAIL_MIN_DEPTH = 0.7;     // a railing only where the pit is deeper than this (m)
  const FACE_T = 0.6;             // thickness of the portal head wall (m)
  const PAD_A = 6.5;              // carriageway queries keep clear of the pit this far beyond its two ends (m)
  const KEEP = 0.8;               // street-level cars keep this far clear of the coping (lateral margin of the carriageway query beside the pit)

  function create(ctx) {
    const T = ctx.T;
    const oy = ctx.oy;
    const rows = ctx.pits || [];
    const roadLift = ctx.roadLift === undefined ? 0.05 : ctx.roadLift;
    const col = (hex) => { const k = new T.Color(hex); return [k.r, k.g, k.b]; };
    const CONC = col('#b9b7b0'); const CONC_D = col('#a3a19a'); const CONC_L = col('#cfcdc6'); const FACE = col('#aaa8a1');
    const STEEL = col('#8b9096'); const STEEL_D = col('#4d5258'); const TUN = col('#6b6a66');
    const group = new T.Group();
    group.name = 'luxtram-pits';
    ctx.root.add(group);
    const pits = [];
    const meshes = [];

    rows.forEach((r) => {
      const p = {
        id: r.id, x0: r.p0[0] - ctx.ox, z0: r.p0[1] - ctx.oz, ux: r.u[0], uz: r.u[1], nx: -r.u[1], nz: r.u[0], a0: r.a0, a1: r.a1, hw: r.hw, cop: r.cop,
        tunnel: r.tunnel, clear: r.clear, c0: r.c[0] - oy, c1: r.c[1], k: r.k, d0: r.d[0], g: r.d[1], meshes: [],
      };
      p.aLo = p.a0 - FACE_T;                               // the footprint starts at the back of the head wall (behind it the ground closes over the tunnel)
      p.depthAt = (a) => Math.max(0, p.d0 - p.g * a);
      p.lid = (a, b) => p.c0 + p.c1 * a + p.k * b;
      p.floorTop = (a) => p.lid(a, 0) - p.depthAt(a) + roadLift;
      p.pos = (a, b, y) => [p.x0 + p.ux * a + p.nx * b, y, p.z0 + p.uz * a + p.nz * b];
      p.ab = (x, z) => { const dx = x - p.x0; const dz = z - p.z0; return [dx * p.ux + dz * p.uz, dx * p.nx + dz * p.nz]; };
      pits.push(p);
      build(p);
    });

    /* ------------------------------------------------------------ geometry */
    function build(p) {
      const conc = { p: [], n: [], u: [], c: [], i: [] };      // concrete + steel + dark tunnel lining (matMisc: vertex colours)
      const vtx = (m, x, y, z, nx, ny, nz, c) => { m.p.push(x, y, z); m.n.push(nx, ny, nz); m.u.push(0, 0); m.c.push(c[0], c[1], c[2]); return m.p.length / 3 - 1; };
      /* a quad (four points in cyclic order) that faces the given normal (the winding is chosen so: a double-sided Lambert material shades a back face with a flipped normal) */
      const quad = (m, P, nrm, cols) => {
        const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]]; const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
        const cx = e1[1] * e2[2] - e1[2] * e2[1]; const cy = e1[2] * e2[0] - e1[0] * e2[2]; const cz = e1[0] * e2[1] - e1[1] * e2[0];
        const flip = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0;
        const ids = P.map((q, k) => vtx(m, q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], cols[k] || cols[0]));
        if (flip) m.i.push(ids[0], ids[3], ids[2], ids[0], ids[2], ids[1]); else m.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      };
      const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
      /* a square beam between two points (railing) */
      const beam = (m, A, B, t, c) => {
        const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]; const len = Math.hypot(d[0], d[1], d[2]); if (len < 1e-3) return;
        const u = [d[0] / len, d[1] / len, d[2] / len];
        let q = [-u[2], 0, u[0]]; const ql = Math.hypot(q[0], q[2]);
        if (ql < 1e-4) q = [1, 0, 0]; else { q[0] /= ql; q[2] /= ql; }
        const w = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]];
        const h = t / 2;
        const ring = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([s1, s2]) => [q[0] * s1 + w[0] * s2, q[1] * s1 + w[1] * s2, q[2] * s1 + w[2] * s2]);
        for (let k = 0; k < 4; k++) {
          const r0 = ring[k]; const r1 = ring[(k + 1) % 4];
          const nrm = [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2, (r0[2] + r1[2]) / 2]; const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
          quad(m, [[A[0] + r0[0], A[1] + r0[1], A[2] + r0[2]], [A[0] + r1[0], A[1] + r1[1], A[2] + r1[2]], [B[0] + r1[0], B[1] + r1[1], B[2] + r1[2]], [B[0] + r0[0], B[1] + r0[1], B[2] + r0[2]]], [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl], [c]);
        }
      };
      const hw = p.hw; const cw = p.hw + p.cop;
      // the wall tops end where the pit ends (the floor reaches the street)
      const aEnd = Math.max(p.a0 + 1, p.d0 / p.g - 0.4);
      // ---- retaining walls (a0 .. aEnd), alternating panel tone, darker towards the floor (ambient occlusion)
      [-1, 1].forEach((s) => {
        const nrm = [-s * p.nx, 0, -s * p.nz];
        for (let a = p.a0; a < aEnd - 1e-6; a += WALL_STEP) {
          const a2 = Math.min(aEnd, a + WALL_STEP);
          const tone = Math.floor((a - p.a0) / WALL_STEP) % 2 ? 0.95 : 1.0;
          const top = (aa) => p.lid(aa, s * hw);
          const bot = (aa) => p.floorTop(aa) - 0.02;
          quad(conc, [p.pos(a, s * hw, bot(a)), p.pos(a2, s * hw, bot(a2)), p.pos(a2, s * hw, top(a2)), p.pos(a, s * hw, top(a))], nrm,
            [mul(CONC_D, tone * 0.78), mul(CONC_D, tone * 0.78), mul(CONC, tone), mul(CONC, tone)]);
        }
      });
      // ---- coping: a low concrete kerb on top of each wall, stands COPING_H above the street, tapering out where the pit ends
      [-1, 1].forEach((s) => {
        const h = (aa) => COPING_H * Math.min(1, Math.max(0.2, (p.depthAt(aa) - 0.1) / 0.5));
        const aT = Math.min(p.a1 - 0.2, aEnd + 1.2);
        for (let a = p.a0; a < aT - 1e-6; a += WALL_STEP) {
          const a2 = Math.min(aT, a + WALL_STEP);
          const ya = (aa, b) => p.lid(aa, s * b) + h(aa);
          // top
          quad(conc, [p.pos(a, s * hw, ya(a, hw)), p.pos(a2, s * hw, ya(a2, hw)), p.pos(a2, s * cw, ya(a2, cw)), p.pos(a, s * cw, ya(a, cw))], [0, 1, 0], [CONC_L]);
          // outer face (towards the street) down to the street level
          quad(conc, [p.pos(a, s * cw, p.lid(a, s * cw)), p.pos(a2, s * cw, p.lid(a2, s * cw)), p.pos(a2, s * cw, ya(a2, cw)), p.pos(a, s * cw, ya(a, cw))], [s * p.nx, 0, s * p.nz], [CONC_D, CONC_D, CONC, CONC]);
        }
      });
      // ---- portal head wall: face over the opening, cap on top (the footprint starts at its back), side reveals
      {
        const aF = p.a0; const aB = p.aLo;
        const yTopF = (b) => p.lid(aF, b) + COPING_H;
        const clr = p.floorTop(aF) + p.clear;
        quad(conc, [p.pos(aF, -hw, clr), p.pos(aF, hw, clr), p.pos(aF, hw, yTopF(hw)), p.pos(aF, -hw, yTopF(-hw))], [p.ux, 0, p.uz], [mul(CONC, 0.85), mul(CONC, 0.85), CONC_L, CONC_L]);
        // cap (head wall + the two coping strips across): the whole width of the footprint
        quad(conc, [p.pos(aB, -cw, p.lid(aB, -cw) + COPING_H), p.pos(aF, -cw, p.lid(aF, -cw) + COPING_H), p.pos(aF, cw, p.lid(aF, cw) + COPING_H), p.pos(aB, cw, p.lid(aB, cw) + COPING_H)], [0, 1, 0], [CONC_L]);
        // back edge of the cap (the street is 18 cm lower behind it) and the two ends of the head wall above the opening
        quad(conc, [p.pos(aB, -cw, p.lid(aB, -cw)), p.pos(aB, cw, p.lid(aB, cw)), p.pos(aB, cw, p.lid(aB, cw) + COPING_H), p.pos(aB, -cw, p.lid(aB, -cw) + COPING_H)], [-p.ux, 0, -p.uz], [CONC_D, CONC_D, CONC, CONC]);
        // soffit of the opening and the lining of the covered part (dark, fading with the distance from the daylight)
        const aT = p.a0 - p.tunnel;
        const dark = (aa) => 0.05 + 0.5 * Math.max(0, 1 - (p.a0 - aa) / 3.8);
        [-1, 1].forEach((s) => {
          const nrm = [-s * p.nx, 0, -s * p.nz];
          quad(conc, [p.pos(aT, s * hw, p.floorTop(aT)), p.pos(aF, s * hw, p.floorTop(aF)), p.pos(aF, s * hw, p.floorTop(aF) + p.clear), p.pos(aT, s * hw, p.floorTop(aT) + p.clear)], nrm,
            [mul(TUN, dark(aT)), mul(TUN, dark(aF)), mul(TUN, dark(aF)), mul(TUN, dark(aT))]);
        });
        quad(conc, [p.pos(aT, -hw, p.floorTop(aT) + p.clear), p.pos(aF, -hw, p.floorTop(aF) + p.clear), p.pos(aF, hw, p.floorTop(aF) + p.clear), p.pos(aT, hw, p.floorTop(aT) + p.clear)], [0, -1, 0],
          [mul(TUN, dark(aT)), mul(TUN, dark(aF)), mul(TUN, dark(aF)), mul(TUN, dark(aT))]);
        // the end of the tunnel (dead black)
        quad(conc, [p.pos(aT, -hw, p.floorTop(aT)), p.pos(aT, hw, p.floorTop(aT)), p.pos(aT, hw, p.floorTop(aT) + p.clear), p.pos(aT, -hw, p.floorTop(aT) + p.clear)], [p.ux, 0, p.uz], [[0.02, 0.02, 0.02]]);
      }
      // ---- railing on top of both walls: posts every POST_STEP m, two rails, only where the pit is deep
      [-1, 1].forEach((s) => {
        const b = s * (p.hw + p.cop - 0.12);
        const top = (aa) => p.lid(aa, b) + COPING_H;
        const aR = (p.d0 - RAIL_MIN_DEPTH) / p.g;                 // the railing ends where the depth falls to RAIL_MIN_DEPTH
        const a0 = p.a0 - FACE_T + 0.1;
        for (let a = a0; a <= aR + 1e-6; a += POST_STEP) beam(conc, p.pos(a, b, top(a)), p.pos(a, b, top(a) + 1.0), 0.07, STEEL_D);
        [0.5, 0.95].forEach((h) => beam(conc, p.pos(a0, b, top(a0) + h), p.pos(aR, b, top(aR) + h), 0.05, h > 0.9 ? STEEL : STEEL_D));
      });
      // ---- mesh: matMisc (vertex colours, double sided)
      if (conc.i.length) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(conc.p, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(conc.n, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(conc.u, 2));
        g.setAttribute('color', new T.Float32BufferAttribute(conc.c, 3));
        g.setIndex(conc.p.length / 3 > 65535 ? new T.Uint32BufferAttribute(conc.i, 1) : new T.Uint16BufferAttribute(conc.i, 1));
        g.computeBoundingSphere();
        const m = new T.Mesh(g, ctx.matMisc);
        m.name = 'luxtram-pit-structure'; m.castShadow = !!ctx.castShadow; m.receiveShadow = !!ctx.castShadow;
        group.add(m); p.meshes.push(m);
      }
      // ---- floor: asphalt of the ground module (same procedural material as the street), from the end of the covered part to the street
      if (ctx.ground && ctx.ground.Acc) {
        const S = new ctx.ground.Acc();
        const aT = p.a0 - p.tunnel;
        const aU = p.a1;
        const stations = [aT, p.aLo]; for (let a = p.a0; a < aU - 1e-6; a += 4) stations.push(a); stations.push(aU);
        const bs = [-hw, 0, hw];
        const shade = (aa) => (aa < p.a0 ? 0.12 + 0.88 * Math.max(0, 1 - (p.a0 - aa) / 3.8) : 1) * 0.92;
        const base = S.count;
        // normal of the slope plane (the ramp has the same grade everywhere)
        const gr = p.c1 + p.g; const nl = Math.hypot(gr, 1);
        stations.forEach((aa) => {
          const y = p.floorTop(aa);
          bs.forEach((b) => { const q = p.pos(aa, b, y); const sh = shade(aa); S.vert(q[0], q[1], q[2], -gr * p.ux / nl, 1 / nl, -gr * p.uz / nl, ctx.ground.MAT.ASPH, sh, sh, sh * 1.02); });
        });
        for (let r = 0; r < stations.length - 1; r++) for (let c = 0; c < bs.length - 1; c++) {
          const a = base + r * bs.length + c; const b = a + 1; const c2 = a + bs.length; const d = c2 + 1;
          // wound so that the face looks up
          const P = S.p; const ux = P[c2 * 3] - P[a * 3]; const uz = P[c2 * 3 + 2] - P[a * 3 + 2]; const vx = P[b * 3] - P[a * 3]; const vz = P[b * 3 + 2] - P[a * 3 + 2];
          if (uz * vx - ux * vz >= 0) S.i.push(a, c2, b, b, c2, d); else S.i.push(a, b, c2, b, d, c2);
        }
        const fm = S.mesh(T, ctx.ground.matPitSurface, 1);
        if (fm) { fm.name = 'luxtram-pit-floor'; group.add(fm); p.meshes.push(fm); }
      }
      p.meshes.forEach((m) => meshes.push(m));
    }

    /* ------------------------------------------------------------ queries */
    const rects = pits.map((p) => {
      const lo = p.aLo; const hi = p.a1;
      return { cx: p.x0 + p.ux * (lo + hi) / 2, cz: p.z0 + p.uz * (lo + hi) / 2, ux: p.ux, uz: p.uz, hl: (hi - lo) / 2, hw: p.hw + p.cop };
    });
    function pitAt(x, z, pad, padB) {      // pad: along the axis beyond the two ends, padB: lateral beyond the coping
      for (let i = 0; i < pits.length; i++) {
        const p = pits[i];
        const ab = p.ab(x, z);
        if (ab[0] > p.aLo - (pad || 0) && ab[0] < p.a1 + (pad || 0) && Math.abs(ab[1]) < p.hw + p.cop + (padB || 0)) return { p, a: ab[0], b: ab[1] };
      }
      return null;
    }
    /* The surface a wheel at (x, z) stands on, for the traffic (roadHeightAt):
         undefined = (x, z) is not in a pit's footprint: ask the street as usual;
         a height  = the pit floor (a car on the ramp: no refY yet, or its own height within 1.2 m of the floor);
         NaN       = carriageway queries (roadOnly) from a car at street level: the pit is no asphalt there (the car steers away from it). */
    function floorAt(x, z, roadOnly, refY) {
      if (!pits.length) return undefined;
      let hit = pitAt(x, z, 0, 0);
      if (!hit) {
        // carriageway queries only: a keep-out band of KEEP m beside the coping, and PAD_A m beyond the two ends of the pit (the traffic reads the lane edges once per 12 m of
        // road: the bucket that contains the pit's first metres is measured in its middle, up to 6 m before it) - the street side only, the ramp's own axis stays asphalt
        if (!roadOnly) return undefined;
        const h2 = pitAt(x, z, PAD_A, KEEP);
        return h2 && Math.abs(h2.b) > h2.p.hw + h2.p.cop ? NaN : undefined;
      }
      const p = hit.p;
      const a = Math.min(Math.max(hit.a, p.a0 - p.tunnel), p.a1);
      const fy = p.floorTop(a);
      const ab = Math.abs(hit.b);
      if (refY === undefined || refY !== refY || Math.abs(refY - fy) < 1.2) {
        if (ab <= p.hw) return fy;
        return roadOnly ? NaN : p.lid(a, hit.b) + COPING_H;       // the coping beside the wall
      }
      return roadOnly ? NaN : undefined;      // a car in the street beside the pit: no asphalt over the pit (the lane edge, the car steers away)
    }
    /* where a road's polyline runs along a pit's axis: [t of the portal + 1 m on the road, the pit] (spawn guard: nothing is born inside the covered part), else null */
    function matchRoad(rd) {
      for (let i = 0; i < pits.length; i++) {
        const p = pits[i];
        let inside = 0;
        let tPortal = null;
        for (let j = 0; j < rd.pts.length; j++) {
          const ab = p.ab(rd.pts[j].x, rd.pts[j].z);
          if (Math.abs(ab[1]) < 1.0 && ab[0] > p.a0 - 3 && ab[0] < p.a1) inside++;
        }
        if (inside < 1) continue;
        // arc position on the road of the axis point a0 + 1
        const q = [p.x0 + p.ux * (p.a0 + 1.0), p.z0 + p.uz * (p.a0 + 1.0)];
        let best = 1e9; let bt = 0;
        for (let j = 0; j + 1 < rd.pts.length; j++) {
          const A = rd.pts[j]; const B = rd.pts[j + 1];
          const dx = B.x - A.x; const dz = B.z - A.z; const l2 = dx * dx + dz * dz || 1;
          const u = Math.max(0, Math.min(1, ((q[0] - A.x) * dx + (q[1] - A.z) * dz) / l2));
          const d = Math.hypot(A.x + dx * u - q[0], A.z + dz * u - q[1]);
          if (d < best) { best = d; bt = rd.cum[j] + Math.sqrt(l2) * u; }
        }
        if (best < 1.2) tPortal = bt;
        else if (rd.pts.length && p.ab(rd.pts[0].x, rd.pts[0].z)[0] > p.a0 + 1.0) tPortal = 0;       // the road starts above the portal: nothing to guard
        if (tPortal !== null) return { pit: p, tPortal, dirAlong: true };
      }
      return null;
    }
    /* meshes a down-ray from a car on the floor may hit (the traffic's "is a surface drawn under the car" check) */
    function surfaceMeshes(x, z, out) {
      const hit = pitAt(x, z, 1.0);
      if (hit) hit.p.meshes.forEach((m) => out.push(m));
      return out;
    }
    function dispose() {
      meshes.forEach((m) => { m.geometry.dispose(); });
      ctx.root.remove(group);
    }
    void TAG; void CONC_L;
    return { pits, rects, group, meshes, pitAt, floorAt, matchRoad, surfaceMeshes, dispose };
  }

  TS.luxPits = { create };
})();
