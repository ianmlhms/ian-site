/* Kart Lëtzebuerg — track: Esch-Belval. Wide boulevards of the former steelworks quarter: Avenue du Rock'n'Roll past the Rockhal, Avenue des
 * Hauts-Fourneaux between Haut fourneau A and B, Avenue de la Fonte past the university houses (Maison du Savoir & co), and the Porte des Sciences artery back.
 * Layout loosely after OpenStreetMap (contributors, ODbL); metres from 49.5020 N / 5.9440 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp } = KL;
  const col = KL.col, shade = KL.shade;

  /* blast furnace (Haut fourneau), after the photos: slim dark-steel lattice tower round a rust-red shaft, headframe on top, long skip incline,
   * thick rusty downcomers, a row of tall weathered hot-blast stoves, dust catcher. k = overall scale, f = frame, stoves behind (+z) */
  function furnace(B, E, f, opt) {
    const k = (opt && opt.k) || 1.5, L = KL.lm, F = L.frame(f), P = (x, y, z) => F(x * k, y * k, z * k);
    const rust = col('#7a4a34'), rustD = col('#4a3028'), steel = col('#2b2f37'), steelL = col('#454b55'), stove = col('#5d514b'), stoveD = col('#2f2824'), conc = col('#7e7a74'), glow = col('#ff9a3c');
    const box = (x, y, z, sx, sy, sz, c) => L.box(B, f, x * k, y * k, z * k, sx * k, sy * k, sz * k, 0, c);
    const cyl = (x, y, z, r0, r1, h, seg, c) => L.cyl(B, f, x * k, y * k, z * k, r0 * k, r1 * k, h * k, seg, c);
    const bar = (a, b, t, c) => L.bar(B, a, b, t * k, c);
    box(0, 0, 0, 22, 8, 22, conc); box(0, 8, 0, 24, 0.8, 24, steel);                       // casthouse
    cyl(0, 8.8, 0, 7.2, 5.4, 22, 14, rust);                                                  // shaft (belly + stack)
    cyl(0, 30.8, 0, 5.4, 3.4, 8, 14, rustD);
    cyl(0, 38.8, 0, 3.4, 3.4, 3, 10, steel);
    // lattice tower: 4 leaning legs, X-braced bays, platforms
    const legs = [[-8, 8], [8, 8], [-8, -8], [8, -8]], H = 52, taper = 0.45;
    for (const [lx, lz] of legs) bar(P(lx, 0, lz), P(lx * taper, H, lz * taper), 0.55, steel);
    const bays = 6;
    for (let i = 0; i < bays; i++) {
      const y0 = (H * i) / bays, y1 = (H * (i + 1)) / bays, t0 = 1 - (1 - taper) * (y0 / H), t1 = 1 - (1 - taper) * (y1 / H);
      for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) {
        const A = legs[a], Bq = legs[b];
        bar(P(A[0] * t0, y0, A[1] * t0), P(Bq[0] * t1, y1, Bq[1] * t1), 0.28, steelL);
        bar(P(Bq[0] * t0, y0, Bq[1] * t0), P(A[0] * t1, y1, A[1] * t1), 0.28, steelL);
        bar(P(A[0] * t1, y1, A[1] * t1), P(Bq[0] * t1, y1, Bq[1] * t1), 0.4, steel);
      }
    }
    box(0, H, 0, 8.4, 1.0, 8.4, steel);                                                      // top platform + headframe
    for (const [lx, lz] of [[-3.6, 3.6], [3.6, 3.6], [-3.6, -3.6], [3.6, -3.6]]) bar(P(lx, H, lz), P(lx * 0.8, H + 9, lz * 0.8), 0.4, steel);
    box(0, H + 9, 0, 7.6, 0.8, 7.6, steel); box(0, H + 9.8, 0, 3, 3.4, 3, steelL);
    box(0, H + 8, -9, 3, 0.8, 14, steel);                                                    // crane beam towards the stock house
    // downcomers (big rusty pipes from the top down to the dust catcher) and bustle pipe ring
    for (const sx of [-1, 1]) { bar(P(sx * 4.4, H - 4, 0), P(sx * 9.5, 38, 0), 1.9, rust); bar(P(sx * 9.5, 38, 0), P(sx * 10.2, 12, 0), 1.9, rust); }
    for (const y of [16, 26]) cyl(0, y, 0, 7.4 - y * 0.06, 7.4 - y * 0.06, 0.9, 14, rustD);
    // skip incline: truss with two rails, running down to the stock house (-z)
    const a = P(-2.8, 1, -34), b = P(-2.8, H - 3, -6), a2 = P(2.8, 1, -34), b2 = P(2.8, H - 3, -6);
    bar(a, b, 0.7, steel); bar(a2, b2, 0.7, steel);
    for (let q = 0; q <= 14; q++) { const t = q / 14, lerpA = (u, v) => u + (v - u) * t; bar([lerpA(a[0], b[0]), lerpA(a[1], b[1]), lerpA(a[2], b[2])], [lerpA(a2[0], b2[0]), lerpA(a2[1], b2[1]), lerpA(a2[2], b2[2])], 0.3, steelL); }
    for (const lz of [-30, -22, -14, -8]) { const hh = 1 + (H - 4) * ((lz + 34) / 28); bar(P(-2.8, 0, lz), P(-2.8, hh, lz), 0.45, steel); bar(P(2.8, 0, lz), P(2.8, hh, lz), 0.45, steel); }
    box(0, 0, -38, 18, 6, 10, conc);                                                         // stock house
    // hot-blast stoves: a row of tall weathered cylinders with dome tops, rings, a rust band
    for (const sx of [-18, -6, 6, 18]) {
      cyl(sx, 0, 22, 5.6, 5.6, 40, 14, stove); const d = P(sx, 40, 22); B.sphere(d[0], d[1], d[2], 5.6 * k, 10, stove, { sy: 0.5 });
      cyl(sx, 0, 22, 5.8, 5.8, 1.4, 14, rustD); cyl(sx, 20, 22, 5.75, 5.75, 0.8, 14, stoveD); cyl(sx, 33, 22, 5.75, 5.75, 0.8, 14, stoveD);
      bar(P(sx, 36, 18), P(sx * 0.15, 33, 6), 1.5, rust);
      cyl(sx, 8, 22, 5.7, 5.7, 5, 14, col('#6a4636')); cyl(sx, 26, 22, 5.7, 5.7, 4, 14, col('#4d3a32'));
    }
    bar(P(-18, 41, 22), P(18, 41, 22), 1.2, rustD);
    for (const sx of [-18, -6, 6, 18]) bar(P(sx, 0, 16.6), P(sx, 30, 16.6), 0.35, steel);
    // gas cleaning: dust catcher + scrubber
    cyl(14, 0, -9, 4.4, 4.4, 28, 12, rust); const d2 = P(14, 28, -9); B.sphere(d2[0], d2[1], d2[2], 4.4 * k, 9, rust, { sy: 0.6 });
    // glowing tap-hole windows (always lit) and top lamp
    for (const lx of [-6, -2, 2, 6]) L.box(E, f, lx * k, 4 * k, 11.1 * k, 1.6 * k, 2.4 * k, 0.3, 0, glow);
    L.box(E, f, 0, (H + 11.5) * k, 0, 0.8 * k, 1.0 * k, 0.8 * k, 0, col('#ff4a2a'));
    if (opt && opt.N) {                                                                      // night lighting: floods on the tower, orange glow on the shaft, stove base lights
      const N = opt.N, lamp = col('#ffe6b0'), warm = col('#ff8a3a');
      for (const [lx, lz] of legs) for (let y = 6; y < H; y += 11) { const q = P(lx * (1 - (1 - taper) * y / H), y, lz * (1 - (1 - taper) * y / H)); N.box(q[0], q[1], q[2], 0.9 * k, 0.9 * k, 0.9 * k, 0, lamp); }
      for (const y of [12, 20, 28]) L.cyl(N, f, 0, y * k, 0, (7.3 - y * 0.06) * k, (7.3 - y * 0.06) * k, 1.1 * k, 14, warm);
      for (const sx of [-18, -6, 6, 18]) { L.box(N, f, sx * k, 2 * k, 15.8 * k, 1.4 * k, 1.4 * k, 0.5 * k, 0, lamp); L.box(N, f, sx * k, 36 * k, 15.8 * k, 1.2 * k, 1.2 * k, 0.5 * k, 0, lamp); }
      L.box(N, f, 0, (H + 11.5) * k, 0, 1.4 * k, 1.4 * k, 1.4 * k, 0, col('#ff4a2a'));
    }
    if (opt && opt.chimney) {                                                                // brick chimney: tall, tapering, banded
      const c = opt.chimney; L.cyl(B, f, c[0], 0, c[1], 3.8, 2.1, 90, 14, col('#b3664c')); L.cyl(B, f, c[0], 70, c[1], 2.6, 2.6, 3, 14, col('#e0d8c6')); L.cyl(B, f, c[0], 90, c[1], 2.4, 2.1, 1.2, 14, steel); L.cyl(B, f, c[0], 40, c[1], 3.0, 3.0, 1.4, 14, col('#8c4c38'));
    }
  }

  KL.registerTrack({
    id: 'belval', origin: [49.5020, 5.9440],
    theme: {
      facade: 'brick', modernKinds: true, modernFacade: 'lattice', ground: 'slabs', groundTint: '#ffffff', groundCell: 12, farColor: '#8a7f74', farDrop: 0, skyline: false, lampSpacing: 30, lampBothSides: true,
      startText: 'ESCH-BELVAL', wallColor: '#8c6a58', wallTop: '#a98672', vergeColor: '#a8a29a', wallH: 1.1,
      osm: 'belval', cityRadius: 620, cityFloors: [4, 8], maxFloors: 13, flatRoofs: false, boulevardTrees: 17,
      palette: ['#b9694b', '#a85a40', '#c23a32', '#b3302b', '#8a8e96', '#d4cfc4', '#9a5640', '#d77a54', '#6e727a'],
      paletteM: ['#f0eeea', '#e4e2dd', '#f4f2ee', '#d8dbe0', '#ece7df'],
      paletteI: ['#8c5a46', '#7a4e3e', '#9a6650', '#6f4a3c'],
      roofs: ['#4a4f58', '#3d424b', '#5a4a46', '#6b4a3c', '#555b64'],
      groundMap: { x0: -480, z0: -560, size: 1400, paving: '#8d8d92', industrial: '#76706b', water: '#4f90b8', tramBed: '#85858a' },
      weathers: ['day', 'sunset', 'night', 'rain'],
    },
    noBuild: [[289, 89, 56], [302, -24, 48], [231, 44, 26], [266, 246, 78]],
    pads: [[60, 0, 10], [190, -15, 10], [238, -16, 10], [470, 0, 10], [700, 0, 10], [880, -14, 9], [916, -14, 9], [1120, 0, 10]],
    extraBoxes: [[214, -17], [896, -15]],
    decorate(S) {
      const { add, mats, track, rnd } = S, M = mats, L = KL.lm;
      const B = new KL.Batch(), E = new KL.Batch(), N = new KL.Batch();
      // Haut fourneau A (south) and B (north): the avenue runs along their east side
      furnace(B, E, { x: 289, y: 0, z: 87, yaw: -0.2 }, { chimney: [-50, 18], k: 1.5, N });
      furnace(B, E, { x: 302, y: 0, z: -25, yaw: -0.2 }, { k: 1.5, N });
      // Rockhal: red concert-hall box over a dark glass band and a grey base
      {
        const f = { x: 265, y: 0, z: 246, yaw: 0.36 };
        L.box(B, f, 0, 0, 0, 126, 8, 62, 0, col('#85888d'));
        L.box(B, f, 12, 8, 4, 98, 14, 52, 0, col('#c1272d'));
        L.box(E, f, 12, 12, -22.1, 90, 4.4, 0.4, 0, col('#2a3c52'));
        L.box(B, f, -38, 8, 0, 34, 24, 40, 0, col('#d73a3a'));
        L.box(B, f, -38, 32, 0, 36, 0.8, 42, 0, col('#4c5058'));
        L.box(B, f, 12, 22, 4, 100, 0.8, 54, 0, col('#4c5058'));
        for (let i = -5; i <= 5; i++) L.cyl(B, f, 12 + i * 8, 0, -32, 0.5, 0.5, 8, 5, col('#3d4048'));
        // raked roof over the hall, a dark ribbed facade, a canopy over the entrance and the tall fly tower behind
        L.gableX(B, f, 12, 22.8, 4, 100, 54, 5.5, col('#5a5e66'), 0.6);
        for (let i = 0; i < 24; i++) L.box(B, f, -35 + i * 4.3, 8.2, -22.35, 0.7, 13.6, 0.7, 0, col('#8f1a21'));
        L.box(B, f, 12, 10.6, -28, 46, 0.7, 11, 0, col('#2e3138'), { topCol: col('#585d66') });
        for (const cx of [-8, 12, 32]) L.cyl(B, f, cx, 0, -32.5, 0.35, 0.35, 10.6, 5, col('#2e3138'));
        L.box(B, f, 38, 22, 20, 26, 20, 26, 0, col('#2f3238')); L.box(B, f, 38, 42, 20, 27, 0.8, 27, 0, col('#4c5058'));
        L.box(E, f, 12, 17, -22.5, 40, 0.9, 0.2, 0, col('#ff3b3b'));                                     // red LED sign strip
      }
      // chimneys of the old works on the skyline (OSM man_made=chimney)
      for (const [x, z] of [[709, -33], [702, -13], [850, 29], [807, -58]]) { B.cyl(x, 0, z, 4.2, 2.6, 92, 12, col('#a05a46')); B.cyl(x, 78, z, 3.3, 3.3, 3, 12, col('#d9d2c0')); }
      add(B, M.plain); add(E, M.plainEmissive); KL.kit.nightOnly(S, N);
    },
  });
})();
