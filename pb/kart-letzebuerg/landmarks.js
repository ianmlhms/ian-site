/* Kart Lëtzebuerg — reusable painted landmark parts (columns, gable roofs, towers with spires, arch bridges, statues).
 * All builders take a KL.Batch and add geometry in the local frame of the landmark: x across, z along, y up; frame = {x, y, z, yaw}. */
(function () {
  'use strict';
  const KL = window.KL;
  const col = KL.col, shade = KL.shade;
  const L = (KL.lm = {});

  /* local -> world */
  L.frame = (f) => { const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0); return (lx, ly, lz) => [f.x + lx * c + lz * s, (f.y || 0) + ly, f.z - lx * s + lz * c]; };

  L.box = (B, f, lx, ly, lz, sx, sy, sz, yaw, color, o) => { const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0); B.box(f.x + lx * c + lz * s, (f.y || 0) + ly, f.z - lx * s + lz * c, sx, sy, sz, (f.yaw || 0) + (yaw || 0), color, o); };

  /* gable roof, ridge along local z, base rectangle sx*sz centred at (lx,lz), bottom at ly */
  L.gable = (B, f, lx, ly, lz, sx, sz, h, color, over) => {
    const P = L.frame(f), o = over || 0.4, hx = sx / 2 + o, hz = sz / 2 + o * 0.6;
    const A = P(lx - hx, ly, lz - hz), Bq = P(lx + hx, ly, lz - hz), C = P(lx + hx, ly, lz + hz), D = P(lx - hx, ly, lz + hz);
    const r1 = P(lx, ly + h, lz - hz), r2 = P(lx, ly + h, lz + hz);
    B.quad(Bq, r1, r2, C, shade(color, 1.0)); B.quad(D, r2, r1, A, shade(color, 0.8));
    B.tri(A, r1, Bq, shade(color, 0.9)); B.tri(C, r2, D, shade(color, 0.9));
  };
  /* gable roof with ridge along local x */
  L.gableX = (B, f, lx, ly, lz, sx, sz, h, color, over) => {
    const P = L.frame(f), o = over || 0.4, hx = sx / 2 + o * 0.6, hz = sz / 2 + o;
    const A = P(lx - hx, ly, lz - hz), Bq = P(lx + hx, ly, lz - hz), C = P(lx + hx, ly, lz + hz), D = P(lx - hx, ly, lz + hz);
    const r1 = P(lx - hx, ly + h, lz), r2 = P(lx + hx, ly + h, lz);
    B.quad(C, r2, r1, D, shade(color, 1.05)); B.quad(A, r1, r2, Bq, shade(color, 0.8));
    B.tri(D, r1, A, shade(color, 0.9)); B.tri(Bq, r2, C, shade(color, 0.9));
  };
  /* four-sided pyramid (spire) */
  L.pyramid = (B, f, lx, ly, lz, w, h, color) => {
    const P = L.frame(f), a = w / 2, apex = P(lx, ly + h, lz);
    const c = [P(lx - a, ly, lz - a), P(lx + a, ly, lz - a), P(lx + a, ly, lz + a), P(lx - a, ly, lz + a)];
    B.tri(c[0], apex, c[1], shade(color, 0.85)); B.tri(c[1], apex, c[2], shade(color, 1.0)); B.tri(c[2], apex, c[3], shade(color, 1.1)); B.tri(c[3], apex, c[0], shade(color, 0.9));
  };
  L.cyl = (B, f, lx, ly, lz, r0, r1, h, seg, color, o) => { const P = L.frame(f)(lx, ly, lz); B.cyl(P[0], P[1], P[2], r0, r1, h, seg, color, o); };
  L.sphere = (B, f, lx, ly, lz, r, seg, color, o) => { const P = L.frame(f)(lx, ly, lz); B.sphere(P[0], P[1], P[2], r, seg, color, o); };
  /* a row of columns along local x at depth lz */
  L.columns = (B, f, x0, x1, lz, n, ly, h, r, color) => { for (let i = 0; i < n; i++) { const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1); L.cyl(B, f, x, ly, lz, r, r * 0.88, h, 8, color); } };
  /* tall narrow windows on a local face: along x from x0 to x1 at depth lz, facing +z (dir=1) or -z (dir=-1) */
  L.windows = (B, f, x0, x1, lz, dir, n, ly, w, h, color) => { for (let i = 0; i < n; i++) { const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1); L.box(B, f, x, ly, lz + dir * 0.07, w, h, 0.18, 0, color, { noTop: false }); } };
  /* windows on the sides (facing +x / -x) */
  L.windowsSide = (B, f, lx, z0, z1, n, ly, w, h, color) => { for (let i = 0; i < n; i++) { const z = z0 + ((z1 - z0) * i) / Math.max(1, n - 1); L.box(B, f, lx, ly, z, 0.18, h, w, 0, color); } };

  /* statue: stone pedestal + figure (low-poly); gold flag toggles the colour */
  L.statue = (B, f, lx, lz, h, gold) => {
    const stone = col('#cfc8b8'), metal = gold ? col('#f2c230') : col('#5b6b5a');
    L.box(B, f, lx, 0, lz, 2.6, 0.5, 2.6, 0, stone); L.box(B, f, lx, 0.5, lz, 1.8, h, 1.8, 0, stone);
    L.cyl(B, f, lx, 0.5 + h, lz, 0.6, 0.35, 1.7, 7, metal); L.sphere(B, f, lx, 0.5 + h + 2.05, lz, 0.36, 7, metal);
  };

  /* Stone arch bridge in the style of the Pont Adolphe: ONE huge elliptical main arch of dressed sandstone (voussoir bands), solid
   * abutments, and above them a continuous arcade of small round arches under a cornice, balustrade and lamp posts.
   * axis from a=[x,z] to b=[x,z]; deck top at deckY; main arch spans [archA, archB] (distance along the axis), springs at springY, rises `rise`. */
  L.archBridge = (B, a, b, o) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
    const W = o.width || 18, deckY = o.deckY || 0, stone = col(o.color || '#cdb27c'), dark = shade(stone, 0.7), light = shade(stone, 1.1), pale = shade(stone, 1.18);
    const P = (u, v, y) => [a[0] + tx * u + nx * v, y, a[1] + tz * u + nz * v];
    /* quad with a guaranteed outward orientation: `h` is a vector the front side must face */
    const Q = (p0, p1, p2, p3, c, h) => {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * h[0] + cy * h[1] + cz * h[2] >= 0) B.quad(p0, p1, p2, p3, c); else B.quad(p0, p3, p2, p1, c);
    };
    const prism = (u0, u1, v0, v1, y0, y1, c) => {                       // axis-aligned box in the bridge frame
      const cx = a[0] + tx * (u0 + u1) / 2 + nx * (v0 + v1) / 2, cz = a[1] + tz * (u0 + u1) / 2 + nz * (v0 + v1) / 2;
      B.box(cx, y0, cz, Math.abs(v1 - v0), y1 - y0, Math.abs(u1 - u0), Math.atan2(tx, tz), c);
    };
    const u0 = o.archA, u1 = o.archB, uc = (u0 + u1) / 2, half = (u1 - u0) / 2, spring = o.springY, rise = o.rise, ground = o.groundY != null ? o.groundY : -45;
    const slabY = deckY - 1.8;                                          // underside of the deck slab / cornice
    const inArch = (u) => u > u0 && u < u1;
    const tN = (u) => clamp2((u - uc) / half, -1, 1);
    const yIn = (u) => spring + rise * Math.sqrt(Math.max(0, 1 - tN(u) * tN(u)));         // intrados (underside of the arch)
    const yEx = (u) => yIn(u) + 2.4 + 2.2 * Math.pow(Math.abs(tN(u)), 3);                 // extrados: ring thickens towards the springs
    function clamp2(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    const yBot = (u) => (inArch(u) ? yEx(u) : ground);                  // what the spandrel wall stands on

    // ---- the small arches of the arcade (period ~7.7 m, pier 2.3 m): floor, spring height and crown ----
    const nOp = Math.max(6, Math.round(len / 7.7)), per = len / nOp, pier = 2.3, r = (per - pier) / 2, floor = deckY - 10.2, springOp = slabY - 0.9 - r, crown = springOp + r;
    const ops = [];
    for (let i = 0; i < nOp; i++) {
      const ua = i * per + pier / 2, ub = (i + 1) * per - pier / 2;
      // keep an opening only where it clears the main arch below it by at least 2.6 m
      const lowA = Math.max(floor, yBot(ua)), lowB = Math.max(floor, yBot(ub)), low = Math.max(lowA, lowB, yBot((ua + ub) / 2));
      if (crown - low >= 2.6) ops.push({ ua, ub, uc: (ua + ub) / 2, low, lowA, lowB });
    }
    const opAt = (u) => { for (const op of ops) if (u >= op.ua && u <= op.ub) return op; return null; };
    const topOf = (op, u) => { const q = (u - op.uc) / r; return springOp + r * Math.sqrt(Math.max(0, 1 - q * q)); };

    // ---- side faces (both sides): ring of the main arch + spandrel wall with the arcade openings, cut into 1-m slices ----
    const step = 1.0, nS = Math.ceil(len / step);
    for (const sd of [-1, 1]) {
      const v = sd * W / 2, h = [nx * sd, 0, nz * sd];
      for (let i = 0; i < nS; i++) {
        const ua = i * len / nS, ub = (i + 1) * len / nS, um = (ua + ub) / 2;
        const band = (i % 2 ? 1 : 0.94);
        const ring = shade(stone, band * 1.04), wallC = shade(stone, band * 0.98 + 0.01 * ((i * 7) % 5));
        const yb0 = yBot(ua), yb1 = yBot(ub);
        const op = opAt(um);
        // main-arch ring (voussoirs) between intrados and extrados
        if (inArch(um)) Q(P(ua, v, yIn(ua)), P(ub, v, yIn(ub)), P(ub, v, yEx(ub)), P(ua, v, yEx(ua)), ring, h);
        // wall from the base up to the slab, minus the opening
        let bot0 = yb0, bot1 = yb1;
        if (op) { const f0 = Math.max(yb0, floor), f1 = Math.max(yb1, floor); const t0 = topOf(op, Math.max(ua, op.ua)), t1 = topOf(op, Math.min(ub, op.ub)); if (floor > yb0 || floor > yb1) Q(P(ua, v, yb0), P(ub, v, yb1), P(ub, v, f1), P(ua, v, f0), wallC, h); bot0 = Math.max(t0, f0); bot1 = Math.max(t1, f1); }
        if (slabY - bot0 > 0.05 || slabY - bot1 > 0.05) {
          if (Math.abs(bot0 - bot1) < 1e-6) {                       // flat bottom (abutments): dressed-stone courses, 2.4 m high, alternating tone
            const k0 = Math.floor((bot0 - ground) / 2.4);
            for (let y = ground + k0 * 2.4, kk = k0; y < slabY - 0.01; y += 2.4, kk++) {
              const ya = Math.max(y, bot0), yb = Math.min(y + 2.4, slabY);
              if (yb - ya > 0.01) Q(P(ua, v, ya), P(ub, v, ya), P(ub, v, yb), P(ua, v, yb), shade(wallC, kk % 2 ? 1.04 : 0.95), h);
            }
          } else Q(P(ua, v, bot0), P(ub, v, bot1), P(ub, v, slabY), P(ua, v, slabY), wallC, h);
        }
      }
      // cornice (projecting band), balustrade, posts and lamps
      prism(0, len, sd > 0 ? W / 2 - 0.6 : -W / 2 - 0.5, sd > 0 ? W / 2 + 0.5 : -W / 2 + 0.6, slabY, deckY - 0.2, pale);
      prism(0, len, sd * (W / 2 - 0.35) - 0.2, sd * (W / 2 - 0.35) + 0.2, deckY, deckY + 0.28, light);
      prism(0, len, sd * (W / 2 - 0.35) - 0.17, sd * (W / 2 - 0.35) + 0.17, deckY + 0.95, deckY + 1.18, light);
      for (let u = 0.5; u < len; u += 2.4) prism(u - 0.14, u + 0.14, sd * (W / 2 - 0.35) - 0.14, sd * (W / 2 - 0.35) + 0.14, deckY + 0.28, deckY + 0.95, light);
      for (let u = 5; u < len - 3; u += 14) { prism(u - 0.3, u + 0.3, sd * (W / 2 - 0.35) - 0.3, sd * (W / 2 - 0.35) + 0.3, deckY, deckY + 1.5, pale); const p = P(u, sd * (W / 2 - 0.35), deckY + 1.5); B.cyl(p[0], deckY + 1.5, p[2], 0.06, 0.06, 3.0, 5, col('#2c3038')); B.sphere(p[0], deckY + 4.7, p[2], 0.3, 6, col('#fff1c0')); }
    }

    // ---- soffit of the main arch (what you see from the valley) ----
    const nA = 48;
    for (let i = 0; i < nA; i++) {
      const ua = u0 + (2 * half * i) / nA, ub = u0 + (2 * half * (i + 1)) / nA;
      Q(P(ua, -W / 2, yIn(ua)), P(ub, -W / 2, yIn(ub)), P(ub, W / 2, yIn(ub)), P(ua, W / 2, yIn(ua)), shade(stone, 0.62 + 0.06 * (i % 2)), [0, -1, 0]);
    }
    // ---- arcade openings: floor, jambs, arched soffit (seen through the openings) ----
    for (const op of ops) {
      const lowFor = (u) => Math.max(floor, yBot(u));
      const nF = 5;
      for (let j = 0; j < nF; j++) { const ua = op.ua + ((op.ub - op.ua) * j) / nF, ub = op.ua + ((op.ub - op.ua) * (j + 1)) / nF; Q(P(ua, -W / 2, lowFor(ua)), P(ub, -W / 2, lowFor(ub)), P(ub, W / 2, lowFor(ub)), P(ua, W / 2, lowFor(ua)), shade(stone, 0.8), [0, 1, 0]); }
      for (const [uJ, dirJ] of [[op.ua, 1], [op.ub, -1]]) Q(P(uJ, -W / 2, lowFor(uJ)), P(uJ, W / 2, lowFor(uJ)), P(uJ, W / 2, springOp), P(uJ, -W / 2, springOp), shade(stone, 0.72), [tx * dirJ, 0, tz * dirJ]);
      const nC = 10;
      for (let j = 0; j < nC; j++) {
        const a0 = Math.PI * j / nC, a1 = Math.PI * (j + 1) / nC;
        const ua = op.uc - Math.cos(a0) * r, ub = op.uc - Math.cos(a1) * r, ya = springOp + Math.sin(a0) * r, yb = springOp + Math.sin(a1) * r;
        Q(P(ua, -W / 2, ya), P(ub, -W / 2, yb), P(ub, W / 2, yb), P(ua, W / 2, ya), shade(stone, 0.68), [0, -1, 0]);
      }
    }
    // ---- deck slab, abutment ends ----
    prism(0, len, -W / 2, W / 2, slabY - 0.02, deckY, shade(stone, 0.92));
    for (const [uE, dirE] of [[0, -1], [len, 1]]) Q(P(uE, -W / 2, ground), P(uE, W / 2, ground), P(uE, W / 2, slabY), P(uE, -W / 2, slabY), shade(stone, 0.85), [tx * dirE, 0, tz * dirE]);
    // buttress piers where the arch springs: slightly proud of the faces, so the abutments read as massive
    for (const uS of [u0, u1]) for (const sd of [-1, 1]) prism(uS - 3.2 * (uS === u0 ? 1 : 0) - 0.01, uS + 3.2 * (uS === u1 ? 1 : 0) + 0.01, sd * (W / 2 + 0.55) - 0.55, sd * (W / 2 + 0.55) + 0.55, spring - 2, slabY, shade(stone, 1.05));
  };

  /* square bar between two world points a, b (steel beams, pipes, ropes), t = thickness; 4 outward-facing sides + end caps */
  L.bar = (B, a, b, t, color) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz); if (len < 1e-4) return;
    const u = [dx / len, dy / len, dz / len], ref = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], nz = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const n1 = nz(cr(u, ref)), n2 = nz(cr(u, n1)), h = t / 2;
    const C = (p, s1, s2) => [p[0] + n1[0] * h * s1 + n2[0] * h * s2, p[1] + n1[1] * h * s1 + n2[1] * h * s2, p[2] + n1[2] * h * s1 + n2[2] * h * s2];
    const sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [s1, s2] = sg[i], [t1, t2] = sg[(i + 1) % 4];
      const q = [C(a, s1, s2), C(b, s1, s2), C(b, t1, t2), C(a, t1, t2)];
      const mid = [(s1 + t1) / 2, (s2 + t2) / 2], out = [n1[0] * mid[0] + n2[0] * mid[1], n1[1] * mid[0] + n2[1] * mid[1], n1[2] * mid[0] + n2[2] * mid[1]];
      const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]], nn = cr(e1, e2);
      const sh = shade(color, 0.82 + 0.1 * i);
      if (nn[0] * out[0] + nn[1] * out[1] + nn[2] * out[2] >= 0) B.quad(q[0], q[1], q[2], q[3], sh); else B.quad(q[0], q[3], q[2], q[1], sh);
    }
  };
  /* simple pumpkin / lantern / gravestone helpers for the fantasy tracks */
  L.gravestone = (B, x, y, z, yaw, c) => { B.box(x, y, z, 0.9, 1.4, 0.28, yaw, c || col('#8a8f99')); B.cyl(x, y + 1.4, z, 0.45, 0.45, 0.28, 8, c || col('#8a8f99')); };
})();
