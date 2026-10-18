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

  /* arch bridge. axis from a=[x,z] to b=[x,z]; deck at y = deckY; main arch spans [uA,uB] and springs at springY. */
  L.archBridge = (B, a, b, o) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
    const W = o.width || 18, deckY = o.deckY || 0, stone = col(o.color || '#d6c4a1'), dark = shade(stone, 0.78), light = shade(stone, 1.12);
    const P = (u, v, y) => [a[0] + tx * u + nx * v, y, a[1] + tz * u + nz * v];
    const strip = (u0, u1, v0, v1, y0, y1, c) => { // box-ish prism between two (u,v) rects (axis-aligned in bridge frame)
      const cx = a[0] + tx * (u0 + u1) / 2 + nx * (v0 + v1) / 2, cz = a[1] + tz * (u0 + u1) / 2 + nz * (v0 + v1) / 2;
      B.box(cx, y0, cz, Math.abs(v1 - v0), y1 - y0, Math.abs(u1 - u0), Math.atan2(tx, tz), c);   // local x across (n), local z along (t)
    };
    // deck slab + parapets
    strip(0, len, -W / 2, W / 2, deckY - 1.7, deckY, shade(stone, 0.95));
    for (const sd of [-1, 1]) { strip(0, len, sd * (W / 2 - 0.5), sd * (W / 2 + 0.1), deckY, deckY + 1.1, light); for (let u = 0; u <= len; u += 6) strip(u - 0.3, u + 0.3, sd * (W / 2 - 0.6), sd * (W / 2 + 0.25), deckY, deckY + 1.5, light); }
    // main arch (soffit ribbon) with open spandrels
    const u0 = o.archA, u1 = o.archB, uc = (u0 + u1) / 2, half = (u1 - u0) / 2, spring = o.springY, rise = o.rise;
    const Y = (u, t) => spring + rise * (1 - Math.pow((u - uc) / half, 2)) + t;        // t: thickness offset
    const steps = 26;
    for (const sd of [-1, 1]) {      // two ribs
      const vA = sd * (W / 2 - 0.2), vB = sd * (W / 2 - 4.2);
      for (let i = 0; i < steps; i++) {
        const ua = u0 + (2 * half * i) / steps, ub = u0 + (2 * half * (i + 1)) / steps;
        const lo0 = P(ua, vA, Y(ua, 0)), lo1 = P(ub, vA, Y(ub, 0)), hi0 = P(ua, vA, Y(ua, 3.4)), hi1 = P(ub, vA, Y(ub, 3.4));
        const lo0b = P(ua, vB, Y(ua, 0)), lo1b = P(ub, vB, Y(ub, 0)), hi0b = P(ua, vB, Y(ua, 3.4)), hi1b = P(ub, vB, Y(ub, 3.4));
        const sdc = sd > 0 ? 1 : -1;
        if (sdc > 0) { B.quad(lo0, lo1, hi1, hi0, light); B.quad(hi0, hi1, hi1b, hi0b, stone); B.quad(lo0b, lo1b, lo1, lo0, dark); }
        else { B.quad(lo1, lo0, hi0, hi1, light); B.quad(hi0b, hi1b, hi1, hi0, stone); B.quad(lo0, lo1, lo1b, lo0b, dark); }
      }
      // spandrel piers up to the deck
      for (let u = u0 + 6; u < u1 - 3; u += 7.5) { const yb = Y(u, 3.0); strip(u - 1.0, u + 1.0, Math.min(vA, vB), Math.max(vA, vB), yb, deckY - 1.7, stone); }
    }
    // soffit between the two ribs
    for (let i = 0; i < steps; i++) {
      const ua = u0 + (2 * half * i) / steps, ub = u0 + (2 * half * (i + 1)) / steps;
      B.quad(P(ua, -W / 2 + 4.2, Y(ua, 0)), P(ua, W / 2 - 4.2, Y(ua, 0)), P(ub, W / 2 - 4.2, Y(ub, 0)), P(ub, -W / 2 + 4.2, Y(ub, 0)), dark);
    }
    // approach arcades (solid piers with round-arch caps)
    for (const [ua, ub, dir] of [[0, u0, 1], [u1, len, -1]]) {
      const n = Math.max(2, Math.round((ub - ua) / 9));
      for (let i = 0; i <= n; i++) { const u = ua + ((ub - ua) * i) / n; strip(u - 1.5, u + 1.5, -W / 2, W / 2, o.groundY || -45, deckY - 1.7, stone); }
      strip(ua, ub, -W / 2, W / 2, deckY - 3.2, deckY - 1.7, shade(stone, 0.9));
    }
  };

  /* simple pumpkin / lantern / gravestone helpers for the fantasy tracks */
  L.gravestone = (B, x, y, z, yaw, c) => { B.box(x, y, z, 0.9, 1.4, 0.28, yaw, c || col('#8a8f99')); B.cyl(x, y + 1.4, z, 0.45, 0.45, 0.28, 8, c || col('#8a8f99')); };
})();
