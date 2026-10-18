/* Kart Lëtzebuerg — generic scenery builders (road ribbons, kerbs, walls, frontage buildings, trees, lamps).
 * Each builder returns Batches; world.js turns them into meshes. Tracks add their own landmarks on top (scenery-*.js). */
(function () {
  'use strict';
  const KL = window.KL;
  const { clamp, lerp, rng } = KL;
  const FLOOR = 3.3, BAY = 4.4;

  /* --- strips along the track ---------------------------------------------------------------------------------------- */
  /* ptsFn(i) -> [A, B, uA, uB] where A and B are [x,y,z]; builds quads i..i+1 (counter-clockwise from above when A is left of B). */
  function strip(B, track, i0, i1, fn, vScale, colFn) {
    const N = track.N, step = track.step;
    for (let i = i0; i < i1; i++) {
      const a = fn(i % N), b = fn((i + 1) % N);
      const v0 = (i * step) / vScale, v1 = ((i + 1) * step) / vScale;
      const col = colFn ? colFn(i) : [1, 1, 1];
      B.quadUV(a[0], a[1], b[1], b[0], col, [a[2], v0], [a[3], v0], [b[3], v1], [b[2], v1]);
    }
  }
  const edgePt = (track, i, d, yo) => [track.X[i] + -track.TZ[i] * d, track.Y[i] + Math.tan(track.BANK[i]) * clamp(d, -track.HW[i], track.HW[i]) + (yo || 0), track.Z[i] + track.TX[i] * d];
  KL.edgePt = edgePt;

  KL.scenery = {
    /* the tarmac (or plaza / bridge deck) between the road edges, split in runs by zone kind */
    road(track, theme) {
      const asphalt = new KL.Batch(), cobble = new KL.Batch();
      const kindAt = (i) => { const z = track.ZONE[i]; return z >= 0 && track.zones[z].road ? track.zones[z].road : (theme.road || 'asphalt'); };
      for (let i = 0; i < track.N; i++) {
        const i2 = (i + 1) % track.N, kind = kindAt(i);
        const B = kind === 'cobble' ? cobble : asphalt;
        const f = (j) => [edgePt(track, j, -track.HW[j], 0.0), edgePt(track, j, track.HW[j], 0.0)];
        const a = f(i), b = f(i2), v0 = (i * track.step) / 8, v1 = ((i + 1) * track.step) / 8;
        const hw0 = track.HW[i], hw1 = track.HW[i2];
        const uv = kind === 'cobble' ? [[-hw0 / 4, v0 * 2], [hw0 / 4, v0 * 2], [hw1 / 4, v1 * 2], [-hw1 / 4, v1 * 2]] : [[0, v0], [1, v0], [1, v1], [0, v1]];
        const shade = kind === 'cobble' ? [1, 1, 1] : [1, 1, 1];
        B.quadUV(a[0], a[1], b[1], b[0], shade, uv[0], uv[1], uv[2], uv[3]);
      }
      return { asphalt, cobble };
    },
    /* start/finish line + pads + checker */
    decals(track, pads) {
      const B = new KL.Batch(), C = new KL.Batch();
      const p0 = track.at(0, 0), hw = p0.hw;
      for (const [s, w] of [[0, 3.2]]) {
        const a = track.at(s - w / 2, -hw), b = track.at(s - w / 2, hw), c = track.at(s + w / 2, hw), d = track.at(s + w / 2, -hw);
        C.quadUV([a.x, a.y + 0.04, a.z], [b.x, b.y + 0.04, b.z], [c.x, c.y + 0.04, c.z], [d.x, d.y + 0.04, d.z], [1, 1, 1], [0, 0], [hw / 1.6, 0], [hw / 1.6, 1], [0, 1]);
      }
      for (const p of pads || []) {
        const L = p.len, W = p.w;
        const fx = Math.sin(p.h), fz = Math.cos(p.h), rx = -fz, rz = fx;
        const P = (al, la) => [p.x + fx * al + rx * la, p.y + 0.05, p.z + fz * al + rz * la];
        B.quadUV(P(-L / 2, -W), P(-L / 2, W), P(L / 2, W), P(L / 2, -W), [1, 1, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
      }
      return { pads: B, checker: C };
    },
    /* raised pavement/verge strip between the road edge and the wall + a kerb stone + the wall itself */
    sides(track, theme) {
      const verge = new KL.Batch(), kerb = new KL.Batch(), wall = new KL.Batch();
      const H = theme.wallH != null ? theme.wallH : 1.15, KH = theme.kerbH != null ? theme.kerbH : 0.14;
      const vc = KL.col(theme.vergeColor || '#ffffff'), wc = KL.col(theme.wallColor || '#cfc6b4'), wt = KL.col(theme.wallTop || '#e3dccb');
      for (const side of [-1, 1]) {
        const lim = (i) => track.HW[i] + (side < 0 ? track.WL[i] : track.WR[i]);
        // verge (pavement), flat strip slightly above the road
        strip(verge, track, 0, track.N, (i) => {
          const inner = edgePt(track, i, side * track.HW[i], KH), outer = edgePt(track, i, side * lim(i), KH);
          const w = (lim(i) - track.HW[i]) / 3;
          const I = [inner[0], inner[1], inner[2], 0], O = [outer[0], outer[1], outer[2], w];
          return side < 0 ? [O, I] : [I, O];
        }, 3, null);
        // kerb face (vertical step up from the road to the pavement)
        strip(kerb, track, 0, track.N, (i) => {
          const lo = edgePt(track, i, side * track.HW[i], 0), hi = edgePt(track, i, side * track.HW[i], KH);
          return side < 0 ? [[hi[0], hi[1], hi[2], 0], [lo[0], lo[1], lo[2], 1]] : [[lo[0], lo[1], lo[2], 0], [hi[0], hi[1], hi[2], 1]];
        }, 2, null);
        // wall: inner face + cap
        strip(wall, track, 0, track.N, (i) => {
          const lo = edgePt(track, i, side * lim(i), KH), hi = edgePt(track, i, side * lim(i), KH + H);
          return side < 0 ? [[hi[0], hi[1], hi[2], 0], [lo[0], lo[1], lo[2], 1]] : [[lo[0], lo[1], lo[2], 0], [hi[0], hi[1], hi[2], 1]];
        }, 2, (i) => wc);
        strip(wall, track, 0, track.N, (i) => {
          const a = edgePt(track, i, side * lim(i), KH + H), b = edgePt(track, i, side * (lim(i) + 0.55), KH + H);
          return side < 0 ? [[b[0], b[1], b[2], 0], [a[0], a[1], a[2], 1]] : [[a[0], a[1], a[2], 0], [b[0], b[1], b[2], 1]];
        }, 2, (i) => wt);
      }
      return { verge, kerb, wall };
    },
  };

  /* --- buildings ------------------------------------------------------------------------------------------------------- */
  function hipRoof(B, cx, cz, w, d, yaw, y0, h, col) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = w / 2, hz = d / 2;
    const P = (lx, lz, y) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
    const long = w >= d, inset = (long ? hz : hx);
    const A = P(-hx, -hz, y0), Bq = P(hx, -hz, y0), Cq = P(hx, hz, y0), D = P(-hx, hz, y0);
    const r1 = long ? P(-hx + inset, 0, y0 + h) : P(0, -hz + inset, y0 + h), r2 = long ? P(hx - inset, 0, y0 + h) : P(0, hz - inset, y0 + h);
    const sh = (k) => KL.shade(col, k);
    if (long) {
      B.quad(A, r1, r2, Bq, sh(0.82)); B.quad(Cq, r2, r1, D, sh(1.12));
      B.tri(D, r1, A, sh(0.95)); B.tri(Bq, r2, Cq, sh(0.9));
    } else {
      B.quad(Bq, r1, r2, Cq, sh(1.0)); B.quad(D, r2, r1, A, sh(0.85));
      B.tri(A, r1, Bq, sh(0.82)); B.tri(Cq, r2, D, sh(1.12));
    }
  }
  KL.hipRoof = hipRoof;

  KL.facadeWall = function (style) {
    return function (B, p0, p1, p2, p3, len, col) {
      const fl = Math.max(1, Math.round((p1[1] - p0[1]) / FLOOR));
      const off = Math.floor(Math.random() * 4) / 4;
      for (let f = 0; f < fl; f++) {
        const t0 = f / fl, t1 = (f + 1) / fl;
        const L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const a0 = L(p0, p1, t0), a1 = L(p0, p1, t1), b0 = L(p3, p2, t0), b1 = L(p3, p2, t1);
        const row = f === 0 ? 0 : 1 + ((f * 7 + Math.floor(len)) % 3), v0 = row / 4 + 0.004, v1 = (row + 1) / 4 - 0.004;
        const ua = off, ub = off + len / (BAY * 4);
        B.quadUV(a0, a1, b1, b0, col, [ua, v0], [ua, v1], [ub, v1], [ub, v0]);
      }
    };
  };

  KL.scenery.buildings = function buildings(track, theme, rnd, quality) {
    const walls = new KL.Batch(), roofs = new KL.Batch(), extra = new KL.Batch();
    const pal = (theme.palette || ['#f1e6d0', '#e6d3b0', '#d9c3a0', '#ece0c8', '#c9b89a', '#e8cfc0', '#d7d2c4', '#bcc5cc']).map(KL.col);
    const roofPal = (theme.roofs || ['#5a6270', '#4c5360', '#8a4b3a', '#6b4b44', '#3f4654']).map(KL.col);
    const facade = KL.facadeWall(theme.facade || 'old');
    const L = track.length, front = track.def.front || {};
    let count = 0;
    // sample list for "is another road section close" checks
    const sx = track.X, sz = track.Z, N = track.N;
    for (const side of [-1, 1]) {
      const frontStr = side < 0 ? front.L : front.R;
      let s = rnd() * 6;
      while (s < L) {
        const ci = Math.floor(s / track.step) % N;
        const cell = frontStr ? frontStr[Math.floor(s / 8) % frontStr.length] : '1';
        const kAbs = Math.abs(track.K[ci]);
        const bays = Math.max(2, Math.round((kAbs > 0.03 ? 2.2 : 3.4) + rnd() * 2.2));
        const w = bays * BAY, depth = theme.depth ? theme.depth[0] + rnd() * (theme.depth[1] - theme.depth[0]) : 11 + rnd() * 7;
        if (cell === '0' || (track.ZONE[ci] >= 0 && track.zones[track.ZONE[ci]].open)) { s += 8; continue; }
        const mid = s + w / 2;
        const p = track.at(mid, 0);
        const wallD = track.HW[ci] + (side < 0 ? track.WL[ci] : track.WR[ci]) + 0.55;
        const off = wallD + depth / 2 + 0.15 + rnd() * 0.6;
        const cx = p.x + -p.tz * side * off, cz = p.z + p.tx * side * off;
        // not on top of any road section (other parts of the track, incl. the one we belong to)
        let clash = false;
        for (let j = 0; j < N; j += 1) {
          const dx = sx[j] - cx, dz = sz[j] - cz, dd = dx * dx + dz * dz;
          const need = track.HW[j] + Math.max(track.WL[j], track.WR[j]) + Math.hypot(w, depth) / 2 - 0.5;
          if (dd < need * need && Math.abs(((j - ci + N * 1.5) % N) - N / 2) < N / 2 - 12) { clash = true; break; }
        }
        if (clash) { s += 6; continue; }
        const floors = (theme.floors ? theme.floors[0] + Math.floor(rnd() * (theme.floors[1] - theme.floors[0] + 1)) : 3 + Math.floor(rnd() * 4));
        const hgt = floors * FLOOR;
        const base = pal[Math.floor(rnd() * pal.length)], tint = KL.shade(base, 0.92 + rnd() * 0.14);
        const yaw = Math.atan2(p.tx, p.tz) + 0;
        const by = p.y + (theme.baseDrop || 0);
        walls.box(cx, by - 1, cz, depth, hgt + 1, w, yaw, tint, { wall: facade, noTop: true, topCol: tint });
        // roof
        const rc = roofPal[Math.floor(rnd() * roofPal.length)];
        if (theme.flatRoofs) { roofs.box(cx, by + hgt, cz, depth + 0.3, 0.5, w + 0.3, yaw, KL.shade(rc, 0.9)); }
        else {
          hipRoof(roofs, cx, cz, depth + 0.5, w + 0.5, yaw + Math.PI / 2, by + hgt, Math.min(depth, w) * 0.34 + 1.2, rc);
          if (rnd() < 0.55) { const ox = (rnd() - 0.5) * depth * 0.4; extra.box(cx + ox * Math.cos(yaw), by + hgt + 2.2, cz - ox * Math.sin(yaw), 0.9, 2.6, 0.9, yaw, KL.shade(KL.col('#9c8b7b'), 1)); }
        }
        count++;
        s += w + (rnd() < 0.15 ? 2 + rnd() * 4 : 0.2);
      }
    }
    KL.log && KL.log('buildings', count);
    return { walls, roofs, extra };
  };

  /* --- trees and lamps --------------------------------------------------------------------------------------------------- */
  KL.scenery.tree = function (kind, rnd) {
    const B = new KL.Batch();
    const h = 3 + rnd() * 1.4;
    if (kind === 'pine') {
      B.cyl(0, 0, 0, 0.35, 0.28, 1.6, 5, KL.col('#5a3d27'));
      for (let i = 0; i < 4; i++) B.cyl(0, 1.2 + i * 1.5, 0, 2.5 - i * 0.55, 0.05, 2.6, 7, KL.mix(KL.col('#1f4d36'), KL.col('#2f7d52'), i / 4));
    } else if (kind === 'dead') {
      B.cyl(0, 0, 0, 0.3, 0.12, 4.2, 5, KL.col('#3d3029'));
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + rnd(); B.cyl(Math.cos(a) * 0.3, 2.2 + i * 0.6, Math.sin(a) * 0.3, 0.12, 0.04, 1.8, 4, KL.col('#3d3029')); }
    } else {
      B.cyl(0, 0, 0, 0.28, 0.2, h, 5, KL.col('#6b4a31'));
      const g1 = KL.col(kind === 'plane' ? '#69a64a' : '#4f9a47'), g2 = KL.col(kind === 'plane' ? '#86bf5a' : '#6bb85a');
      B.sphere(0, h + 1.1, 0, 2.2, 7, g1, { noise: 1, sy: 0.9 });
      B.sphere(0.8, h + 0.6, 0.4, 1.5, 6, g2, { noise: 1 });
      B.sphere(-0.9, h + 0.7, -0.3, 1.4, 6, g1, { noise: 1 });
    }
    return B;
  };
  KL.scenery.lamp = function () {
    const B = new KL.Batch(), H = new KL.Batch();
    B.cyl(0, 0, 0, 0.14, 0.1, 5.6, 5, KL.col('#3d4048'));
    B.box(0.55, 5.6, 0, 1.3, 0.12, 0.12, 0, KL.col('#3d4048'));
    H.box(1.1, 5.35, 0, 0.55, 0.28, 0.4, 0, KL.col('#fff2b0'));
    return { pole: B, head: H };
  };
})();
