/* Kart Lëtzebuerg — track: Grund & Corniche. Down the "most beautiful balcony of Europe" (Chemin de la Corniche, with its fortress wall), a hairpin descent
 * into the Alzette valley, along the Grund quay and past the Abbaye de Neumünster, over the river at Stierchen and back up the Montée de Clausen
 * beside the Bock casemates. Layout loosely after OpenStreetMap (contributors, ODbL); metres from 49.61 N / 6.137 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, L = KL.lm;
  const BOX = [-330, -300, 330, 330];
  const valley = KL.kit.valleyTerrain('grund', { box: BOX, depth: 40, a: 20, b: 84, cell: 4 });
  let TERR = (x, z) => valley(x, z);
  const ABBEY = { x: 120, z: -86, yaw: -0.5, y: -38.2, hx: 41, hz: 44, cz: -6 };

  KL.registerTrack({
    id: 'grund', origin: [49.61, 6.137],
    theme: {
      facade: 'old', ground: 'slabs', groundTint: '#ffffff', groundCell: 10, farColor: '#7d8a78', farDrop: -41, skyline: false, lampSpacing: 26, lampBothSides: false,
      startText: 'GRUND & CORNICHE', wallColor: '#c4b28e', wallTop: '#e0d2b0', vergeColor: '#b8ad98', wallH: 1.3, road: 'asphalt', fogScale: 0.95,
      osm: 'grund', cityRadius: 420, cityFloors: [3, 4], maxFloors: 6, cityFollow: true, cityMaxSlope: 8, boulevardTrees: 18,
      palette: ['#ecd9a8', '#e6c98b', '#e3b88a', '#efe0c0', '#d9a97a', '#e8c6a8', '#cdb48a', '#f0e3c8'],
      roofs: ['#4a505c', '#434955', '#58606b', '#3c424d', '#5d5560'],
      groundMap: { x0: -540, z0: -520, size: 1050, paving: '#a89f8c', water: '#4f90b8',
        paint: KL.kit.valleyPaint((x, z) => TERR(x, z), 'grund', { box: BOX, depth: 40, rock: '#8f9470', grass: '#5f9a44', grass2: '#86b85c', edge: '#b1a894', floor: '#8fa56d', blotches: 1800 }) },
      weathers: ['day', 'sunset', 'night', 'rain'],
    },
    zones: [{ a: 9, b: 17, road: 'cobble', name: 'grund' }],
    makeTerrain(track) {
      const sc = {}, L0 = track.length;
      TERR = (x, z) => {
        const base = valley(x, z), p = track.project(x, z, -1, null, sc);
        const dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + Math.max(p.wl, p.wr) + 0.9;
        const corniche = (p.s > L0 - 80 || p.s < 175) && p.d < 0;                // balcony: the valley side drops like a cliff
        const h = lerp(p.cy - 0.4, base, smooth(flat, flat + (corniche ? 5 : 26), dist));
        // the Abbey stands on a flat pad cut into the hillside (like the real Grund plain)
        const ca = Math.cos(ABBEY.yaw), sa = Math.sin(ABBEY.yaw), ax = x - ABBEY.x, az = z - ABBEY.z, lx = ax * ca - az * sa, lz = ax * sa + az * ca;
        const ex = Math.max(0, Math.abs(lx) - ABBEY.hx), ez = Math.max(0, Math.abs(lz - ABBEY.cz) - ABBEY.hz), pd = Math.hypot(ex, ez);
        return h > ABBEY.y ? lerp(ABBEY.y, h, smooth(4, 30, pd)) : h;
      };
      return TERR;
    },
    noBuild: [[118, -86, 46], [-55, -146, 42]],
    pads: [[40, 0, 10], [560, 0, 10], [760, 0, 10], [1050, 0, 10], [866, -12, 9]],
    extraBoxes: [[906, -17], [924, -19]],
    decorate(S) {
      const { add, mats, track, rnd } = S, M = mats, st = track.stations, N = track.N;
      const B = new KL.Batch(), E = new KL.Batch();
      const sand = col('#c9b68e'), sandD = col('#a8956f'), rock = col('#b5a37c'), rockD = col('#8f7f5e'), ochre = col('#e4c88a'), slate = col('#454b58'), dark = col('#2a2f38');
      const T = (x, z) => TERR(x, z);

      /* ---- the Corniche's fortress wall: a tall sandstone face under the balcony with round towers ---- */
      {
        const i0 = Math.floor((track.length - 80) / track.step), i1 = Math.floor(175 / track.step), idx = [];
        for (let i = i0; i < N; i++) idx.push(i); for (let i = 0; i <= i1; i++) idx.push(i);
        for (let k = 0; k + 1 < idx.length; k++) {
          const a = idx[k], b = idx[k + 1], la = track.HW[a] + track.WL[a] + 0.35, lb = track.HW[b] + track.WL[b] + 0.35;
          const P = (j, d, y) => [track.X[j] + -track.TZ[j] * d, y, track.Z[j] + track.TX[j] * d];
          const yb = -42, c = k % 3 === 0 ? sandD : sand;
          const top = [P(a, -la, -0.2), P(b, -lb, -0.2)], bot = [P(a, -la - 4, yb), P(b, -lb - 4, yb)];
          B.quad(bot[0], bot[1], top[1], top[0], c);
          B.quad(P(b, -lb, -0.2), P(a, -la, -0.2), P(a, -la, -1.4), P(b, -lb, -1.4), shade(sand, 1.12));
        }
        for (let s = 30; s < track.length; s += 62) {
          if (s > 175 && s < track.length - 80) continue;
          const p = track.at(s, -(track.HW[Math.floor(s / track.step)] + track.WL[Math.floor(s / track.step)] + 4));
          B.cyl(p.x, -42, p.z, 7, 6.2, 42, 12, sand); B.cyl(p.x, 0, p.z, 7.4, 7.4, 1.0, 12, sandD);
          for (let q = 0; q < 8; q++) { const an = (q / 8) * 6.283; B.box(p.x + Math.cos(an) * 6.9, 1, p.z + Math.sin(an) * 6.9, 2.6, 1.3, 1.2, -an - 1.5708, sandD); }
          for (const hh of [-14, -26]) B.box(p.x + 5, hh, p.z, 0.6, 2.4, 0.9, 0, dark);
        }
      }

      /* ---- Abbaye de Neumünster: ochre wings with slate mansards around a courtyard, slender church spire ---- */
      {
        const y0 = ABBEY.y + 0.2, f = { x: 120, y: y0, z: -86, yaw: -0.5 };
        L.box(B, f, 0, 0, 0, 74, 15, 15, 0, ochre); L.gable(B, f, 0, 15, 0, 74, 15, 7, slate, 0.5);
        L.box(B, f, -30, 0, 22, 14, 15, 30, 0, ochre); L.gableX(B, f, -30, 15, 22, 14, 30, 6, slate, 0.5);
        L.box(B, f, 30, 0, 22, 14, 15, 30, 0, ochre); L.gableX(B, f, 30, 15, 22, 14, 30, 6, slate, 0.5);
        for (let i = 0; i < 11; i++) for (const lz of [-7.6, 7.6]) for (const fl of [0, 1, 2]) L.box(B, f, -32 + i * 6.4, 1.6 + fl * 4.4, lz, 1.7, 2.6, 0.3, 0, dark);
        for (let i = 0; i < 4; i++) for (const lx of [-37.1, -22.9, 22.9, 37.1]) for (const fl of [0, 1, 2]) L.box(B, f, lx, 1.6 + fl * 4.4, 10.5 + i * 7, 0.3, 2.6, 1.7, 0, dark);
        for (let i = 0; i < 4; i++) for (const sx of [-8.1, 8.1]) L.box(B, f, sx, 3.5, -38 + i * 7.2, 0.3, 8.5, 1.8, 0, dark);
        const c = { x: 120, y: y0, z: -86, yaw: -0.5 };                                // church: nave + square tower + needle
        L.box(B, c, 0, 0, -26, 16, 17, 30, 0, shade(ochre, 0.95)); L.gable(B, c, 0, 17, -26, 16, 30, 9, slate, 0.5);
        L.box(B, c, 0, 0, -44, 9, 36, 9, 0, shade(ochre, 0.92)); L.pyramid(B, c, 0, 36, -44, 10, 26, col('#2f3541'));
        L.box(B, c, 0, 22, -44.4, 3.2, 6, 9.4, 0, dark);
      }

      /* ---- Bock promontory: layered golden sandstone cliff (jittered polygon prisms), casemate arches high on the road face, round tower, scrub ---- */
      {
        const cx0 = -55, cz0 = -146, yBase = -42, yTop = 7, n = 15, nl = 9, jit = [], hash = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
        for (let k = 0; k < n; k++) jit.push(0.82 + hash(k + 3) * 0.34);
        // radius profile by height: wide skirt, near-vertical face with a ledge, narrower summit
        const prof = [[0, 1.12], [0.12, 1.0], [0.3, 0.97], [0.46, 0.99], [0.5, 0.9], [0.68, 0.88], [0.8, 0.7], [0.9, 0.62], [1, 0.5]];
        const RX = 31, RZ = 22, ring = (L) => { const t = L / nl; let f = 1; for (let q = 0; q + 1 < prof.length; q++) if (t >= prof[q][0] && t <= prof[q + 1][0]) f = lerp(prof[q][1], prof[q + 1][1], (t - prof[q][0]) / (prof[q + 1][0] - prof[q][0])); const y = lerp(yBase, yTop, t), P = []; for (let k = 0; k < n; k++) { const an = (k / n) * 6.2832, j = jit[k] * (1 + 0.1 * Math.sin(L * 1.7 + k * 2.1)) * f; P.push([cx0 + Math.cos(an) * RX * j, y + (hash(k * 7 + L) - 0.5) * 1.6, cz0 + Math.sin(an) * RZ * j]); } return P; };
        const rings = []; for (let L = 0; L <= nl; L++) rings.push(ring(L));
        const stone = ['#c4a66e', '#a88d5c', '#947c52', '#b99c66', '#86724c'].map((c) => col(c));
        for (let L = 0; L < nl; L++) for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n, c = stone[(L + (k * 3) % 5 + (L % 2 ? 2 : 0)) % 5];
          B.quad(rings[L][k2], rings[L][k], rings[L + 1][k], rings[L + 1][k2], shade(c, 0.9 + 0.2 * hash(L * 31 + k)));
        }
        const top = rings[nl], tc = [cx0, yTop + 0.5, cz0], green = col('#6f9a48');
        for (let k = 0; k < n; k++) B.tri(top[k], top[(k + 1) % n], tc, green);
        // casemate openings and loopholes on the northern face (towards the road): dark recess, lit at night
        const edge = (th, y) => { const t = (y - yBase) / (yTop - yBase), Lf = t * nl, L0 = Math.min(nl - 1, Math.floor(Lf)), u = Lf - L0, an = th, kk = ((an / 6.2832) * n + n) % n, k0 = Math.floor(kk) % n, k1 = (k0 + 1) % n, w = kk - Math.floor(kk); const pa = (j) => [lerp(rings[L0][j][0], rings[L0 + 1][j][0], u), lerp(rings[L0][j][2], rings[L0 + 1][j][2], u)]; const A = pa(k0), Bq = pa(k1); return [lerp(A[0], Bq[0], w), lerp(A[1], Bq[1], w)]; };
        let q = 0;
        for (const [th, y, w] of [[4.45, -17, 3.4], [4.62, -17, 3.4], [4.79, -17, 3.4], [4.96, -16, 3.4], [4.55, -9, 2.6], [4.88, -9, 2.6], [5.2, -12, 3.4], [4.3, -12, 3.0], [1.35, -14, 3.6], [1.1, -9, 3.0], [1.62, -9, 3.0]]) {
          const [ex, ez] = edge(th, y), nx = Math.cos(th), nz = Math.sin(th);
          const f = { x: ex + nx * 0.2, y, z: ez + nz * 0.2, yaw: Math.atan2(nx, nz) };
          L.box(B, f, 0, -0.35, 0, w + 1.6, 0.8, 1.2, 0, col('#e4d2a2'));                 // sill
          L.box(B, f, 0, 0, 0.1, w, 3.2, 1.5, 0, dark); L.box(B, f, 0, 3.2, 0.1, w * 0.7, 0.8, 1.5, 0, dark); L.box(B, f, 0, 4.0, 0.1, w * 0.36, 0.5, 1.5, 0, dark);
          L.box(B, f, 0, 0, 0, w + 1.4, 0.45, 1.6, 0, col('#e4d2a2')); L.box(B, f, 0, 4.4, 0.05, w * 0.55, 0.5, 1.6, 0, col('#e4d2a2'));
          L.box(E, f, 0, 0.4, 0.7, w * 0.7, 2.3, 0.3, 0, col('#ffbe6a'));
          q++;
        }
        // tower on top (Bock "Dräi Tuerm" style drum with a crenellated crown)
        const tw = [cx0 + 10, yTop + 0.3, cz0 - 6], stoneG = col('#a39c8a');
        B.cyl(tw[0], tw[1], tw[2], 7.4, 6.6, 9, 14, stoneG); B.cyl(tw[0], tw[1] + 9, tw[2], 8.0, 8.0, 1.1, 14, shade(stoneG, 0.8));
        for (let c = 0; c < 11; c++) { const an = (c / 11) * 6.2832; B.box(tw[0] + Math.cos(an) * 7.6, tw[1] + 10.1, tw[2] + Math.sin(an) * 7.6, 2.6, 1.6, 1.2, -an - 1.5708, shade(stoneG, 0.9)); }
        for (let c = 0; c < 3; c++) B.box(tw[0] + 5.7, tw[1] + 4 + c * 4, tw[2], 0.8, 1.8, 0.9, 0, dark);
        // scrub and trees clinging to the ledges and the summit
        const greens = [col('#4f7f3a'), col('#5f8f43'), col('#3f6e34'), col('#7a9a4c')];
        for (let k = 0; k < 70; k++) {
          const L = 1 + Math.floor(hash(k * 5 + 1) * (nl - 1)), kk = Math.floor(hash(k * 9 + 2) * n), a = rings[L][kk], b = rings[L][(kk + 1) % n], w = hash(k * 13 + 3), inset = 0.9 + hash(k) * 0.6;
          const px = lerp(a[0], b[0], w), pz = lerp(a[2], b[2], w), py = lerp(a[1], b[1], w);
          B.sphere(lerp(px, cx0, 0.03), py + 0.4, lerp(pz, cz0, 0.03), 1.4 + hash(k * 3) * 2.2, 6, greens[k % 4], { sy: 0.75 });
        }
        for (let k = 0; k < 7; k++) { const an = hash(k * 19 + 5) * 6.2832, rr = 0.55 * hash(k * 23); const x = cx0 + Math.cos(an) * RX * rr * 0.5, z = cz0 + Math.sin(an) * RZ * rr * 0.5; B.cyl(x, yTop, z, 0.35, 0.3, 2.4, 5, col('#5a4632')); B.sphere(x, yTop + 4.2, z, 2.6, 6, greens[k % 4], { sy: 0.9 }); }
      }

      /* ---- Wenzel wall: crenellated curtain wall with round towers along the road at the foot of the Bock (retaining wall + merlons) ---- */
      {
        const s0 = 985, s1 = 1118, stone = col('#b4a88a'), stoneD = col('#8d826a'), stoneL = col('#cfc3a2');
        const P = (i, d, y) => [track.X[i] + -track.TZ[i] * d, y, track.Z[i] + track.TX[i] * d];
        const i0 = Math.floor(s0 / track.step), i1 = Math.floor(s1 / track.step);
        for (let i = i0; i < i1; i++) {
          const off = (j) => -(track.HW[j] + track.WL[j] + 0.5), a = i, b = i + 1;
          const ya = track.Y[a] - 0.3, yb = track.Y[b] - 0.3;
          B.quad(P(a, off(a) - 1.6, ya - 22), P(b, off(b) - 1.6, yb - 22), P(b, off(b), yb), P(a, off(a), ya), (i % 6 < 3) ? stone : shade(stone, 0.94));
          B.quad(P(a, off(a), ya), P(b, off(b), yb), P(b, off(b), yb + 1.1), P(a, off(a), ya + 1.1), stoneL);            // coping
          if (i % 3 === 0) { const m = P(a, off(a) - 0.4, ya + 1.1); B.box(m[0], m[1], m[2], 1.2, 1.1, 1.0, Math.atan2(track.TX[a], -track.TZ[a]) - 1.5708 + 0, stoneL); }
        }
        for (let s = s0 + 20; s < s1; s += 52) {
          const i = Math.floor(s / track.step), d = -(track.HW[i] + track.WL[i] + 3.2), p = track.at(s, d), y = track.Y[i];
          B.cyl(p.x, y - 24, p.z, 5.4, 4.6, 28.4, 12, stone); B.cyl(p.x, y + 4.4, p.z, 5.9, 5.9, 0.9, 12, stoneD);
          for (let q = 0; q < 8; q++) { const an = (q / 8) * 6.2832; B.box(p.x + Math.cos(an) * 5.5, y + 5.3, p.z + Math.sin(an) * 5.5, 2.4, 1.3, 1.1, -an - 1.5708, stoneL); }
          B.cyl(p.x, y + 5.2, p.z, 5.0, 0.3, 6, 10, col('#3d4350'));
          B.box(p.x + 3.6, y + 1, p.z, 0.7, 2.0, 0.9, 0, dark);
        }
      }
      add(B, M.plain); KL.kit.nightOnly(S, E, 0.35);
    },
  });
})();
