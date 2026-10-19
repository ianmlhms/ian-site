/* Kart Lëtzebuerg — track: Esch-Belval. Wide boulevards of the former steelworks quarter: Avenue du Rock'n'Roll past the Rockhal, Avenue des
 * Hauts-Fourneaux between Haut fourneau A and B, Avenue de la Fonte past the university houses (Maison du Savoir & co), and the Porte des Sciences artery back.
 * Layout loosely after OpenStreetMap (contributors, ODbL); metres from 49.5020 N / 5.9440 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp } = KL;
  const col = KL.col, shade = KL.shade;

  /* blast furnace (Haut fourneau): shaft, bell top, skip incline, three hot-blast stoves, gas pipes, scaffold. f = frame, yaw faces +z (stoves behind) */
  function furnace(B, E, f, opt) {
    const L = KL.lm, P = L.frame(f), rust = col('#6b4636'), rustD = col('#43302a'), steel = col('#3a3f48'), silver = col('#a9aeb4'), conc = col('#8a8680'), glow = col('#ff9a3c');
    L.box(B, f, 0, 0, 0, 22, 9, 22, 0, conc);                                       // casthouse
    L.box(B, f, 0, 9, 0, 24, 1, 24, 0, steel);
    L.cyl(B, f, 0, 10, 0, 7.6, 5.6, 26, 12, rust);                                  // shaft
    L.cyl(B, f, 0, 36, 0, 5.6, 3.4, 7, 12, rustD);
    L.cyl(B, f, 0, 43, 0, 3.6, 3.6, 3, 8, steel); L.cyl(B, f, 0, 46, 0, 3.6, 1.2, 3, 8, rustD);
    L.cyl(B, f, 0, 42, 0, 6.8, 6.8, 0.7, 12, steel);                                // top platform
    for (const sx of [-1, 1]) L.cyl(B, f, sx * 6.2, 10, 0, 0.9, 0.9, 33, 6, rustD); // downcomers
    for (let y = 14; y < 40; y += 8) L.cyl(B, f, 0, y, 0, 7.2 - (y - 10) * 0.07, 7.2 - (y - 10) * 0.07, 0.7, 12, steel);   // cooling rings
    // skip incline (two rails + ties) from the stock house up to the top
    const a = P(-3, 1, -30), b = P(-3, 43, -3.5), a2 = P(3, 1, -30), b2 = P(3, 43, -3.5);
    L.bar(B, a, b, 0.7, steel); L.bar(B, a2, b2, 0.7, steel);
    for (let k = 0; k <= 10; k++) { const t = k / 10; L.bar(B, [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], [lerp(a2[0], b2[0], t), lerp(a2[1], b2[1], t), lerp(a2[2], b2[2], t)], 0.35, rustD); }
    for (const [lx, lz] of [[-3, -30], [3, -30], [-3, -17], [3, -17], [-3, -8], [3, -8]]) { const g0 = P(lx, 0, lz), g1 = P(lx, 1 + 42 * ((lz + 30) / 26.5), lz); L.bar(B, g0, g1, 0.5, steel); }
    L.box(B, f, 0, 0, -34, 18, 6, 10, 0, conc);                                     // stock house
    // hot-blast stoves
    for (const sx of [-14, 0, 14]) { L.cyl(B, f, sx, 0, 20, 5.4, 5.4, 34, 12, silver); const d = P(sx, 34, 20); B.sphere(d[0], d[1], d[2], 5.4, 10, silver, { sy: 0.55 }); L.cyl(B, f, sx, 0, 20, 5.6, 5.6, 1.2, 12, rustD); }
    for (const sx of [-14, 0, 14]) L.bar(B, P(sx, 31, 17), P(sx * 0.3, 30, 4), 1.5, rust);     // hot-blast mains
    L.bar(B, P(-14, 36, 20), P(14, 36, 20), 1.1, rustD);
    L.bar(B, P(0, 30, 4), P(0, 28, 0), 2.2, rust);
    // gas cleaning: dust catcher + scrubber
    L.cyl(B, f, 13, 0, -8, 4.2, 4.2, 26, 10, rust); const d2 = P(13, 26, -8); B.sphere(d2[0], d2[1], d2[2], 4.2, 8, rust, { sy: 0.6 });
    L.bar(B, P(6, 40, 0), P(13, 27, -8), 1.2, rustD);
    // scaffold tower + ladders
    for (const [lx, lz] of [[-8.5, 9], [8.5, 9], [-8.5, -9], [8.5, -9]]) L.bar(B, P(lx, 0, lz), P(lx * 0.85, 42, lz * 0.85), 0.5, steel);
    for (let y = 8; y < 42; y += 8.5) for (const [x0, z0, x1, z1] of [[-8.5, 9, 8.5, 9], [8.5, 9, 8.5, -9], [8.5, -9, -8.5, -9], [-8.5, -9, -8.5, 9]]) L.bar(B, P(x0 * (1 - y * 0.0035), y, z0 * (1 - y * 0.0035)), P(x1 * (1 - y * 0.0035), y, z1 * (1 - y * 0.0035)), 0.4, steel);
    // glowing tap-hole windows (always lit) and top lamp
    for (const lx of [-6, -2, 2, 6]) L.box(E, f, lx, 4, 11.1, 1.6, 2.4, 0.3, 0, glow);
    L.box(E, f, 0, 47, 0, 0.8, 1.0, 0.8, 0, col('#ff4a2a'));
    if (opt && opt.chimney) {                                                       // brick chimney with a decorative band
      const c = opt.chimney; L.cyl(B, f, c[0], 0, c[1], 3.4, 2.1, 78, 14, col('#a85f48')); L.cyl(B, f, c[0], 66, c[1], 2.5, 2.5, 3, 14, col('#d9d2c0')); L.cyl(B, f, c[0], 78, c[1], 2.4, 2.1, 1.2, 14, steel);
    }
  }

  KL.registerTrack({
    id: 'belval', origin: [49.5020, 5.9440],
    theme: {
      facade: 'brick', modernKinds: true, modernFacade: 'lattice', ground: 'slabs', groundTint: '#ffffff', groundCell: 12, farColor: '#8a7f74', farDrop: 0, skyline: false, lampSpacing: 30, lampBothSides: true,
      startText: 'ESCH-BELVAL', wallColor: '#8c6a58', wallTop: '#a98672', vergeColor: '#a8a29a', wallH: 1.1,
      osm: 'belval', cityRadius: 620, cityFloors: [4, 8], maxFloors: 13, flatRoofs: false, boulevardTrees: 17,
      palette: ['#b9694b', '#a85a40', '#c7805c', '#9a5640', '#b06e52', '#c98e68', '#d9b390'],
      paletteM: ['#f0eeea', '#e4e2dd', '#f4f2ee', '#d8dbe0', '#ece7df'],
      paletteI: ['#8c5a46', '#7a4e3e', '#9a6650', '#6f4a3c'],
      roofs: ['#4a4f58', '#3d424b', '#5a4a46', '#6b4a3c', '#555b64'],
      groundMap: { x0: -480, z0: -560, size: 1400, paving: '#9a8f86', industrial: '#8e7d70', water: '#4f90b8', tramBed: '#9a8f86' },
      weathers: ['day', 'sunset', 'night', 'rain'],
    },
    noBuild: [[289, 89, 56], [302, -24, 48], [231, 44, 26], [266, 246, 78]],
    pads: [[60, 0, 10], [190, -15, 10], [238, -16, 10], [470, 0, 10], [700, 0, 10], [880, -14, 9], [916, -14, 9], [1120, 0, 10]],
    extraBoxes: [[214, -17], [896, -15]],
    decorate(S) {
      const { add, mats, track, rnd } = S, M = mats, L = KL.lm;
      const B = new KL.Batch(), E = new KL.Batch();
      // Haut fourneau A (south) and B (north): the avenue runs along their east side
      furnace(B, E, { x: 289, y: 0, z: 87, yaw: -0.2 }, { chimney: [-34, 18] });
      furnace(B, E, { x: 302, y: 0, z: -25, yaw: -0.2 });
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
      }
      // chimneys of the old works on the skyline (OSM man_made=chimney)
      for (const [x, z] of [[709, -33], [702, -13], [850, 29], [807, -58]]) { B.cyl(x, 0, z, 4.2, 2.6, 92, 12, col('#a05a46')); B.cyl(x, 78, z, 3.3, 3.3, 3, 12, col('#d9d2c0')); }
      add(B, M.plain); add(E, M.plainEmissive);
    },
  });
})();
