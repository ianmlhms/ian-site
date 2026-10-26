/* Zuchsimulator Lëtzebuerg: photo-modelled German stops of the Mosel line (de-b): Schweich, Wittlich, Föhren, Hetzerath, Sehlem, Salmtal (route 'trier': Tréier Hbf, Kreuz Konz, Tréier Süd).
 * Registers into TS.realStations (stations-real.js), built with the kit of stations-lu-b.js.  The station building is the real LoD2 building of the station patch (RLP open data),
 * painted by stations-styles-de-b.js; this module adds what stands around it (platform furniture, canopies, boards, underpass, the other tracks and platforms) at the positions of
 * the patch frame.  Local frame as in lu-b: l = lateral distance from the track centre towards the platform side (negative = far side), z = along the platform (towards -z = ahead),
 * y up (platform top = H).  Patch x = sx * l.  DB furniture: dark-blue name plates (white letters), blue number cubes, grey LED masts, glass shelters, grey concrete platforms. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations || !window.TS.stationKits || !window.TS.stationKits.luB) return;
  const reg = window.TS.realStations.register;
  const makeKit = window.TS.stationKits.luB;
  const GREY_MAST = '#8f969c';
  const DARK_FRAME = '#454c53';
  const DB_BLUE = '#233f7d';
  const EDGE = 1.7;                                       // platform edge distance from the track centre in the game
  /* the kit of the OPPOSITE side: positive l' points away from the track on the far side, so furniture drawn there opens towards its own track */
  const mirrorKit = (api) => makeKit(Object.assign({}, api, { sx: -api.sx, pf: (l) => api.pf(-l) }));

  /* ---- DB furniture ---- */
  /* DB station name plate on a grey pole: dark-blue plate, white letters, lighter frame (faces the track) */
  function dbNameBoard(api, k, l, z, name, far = false) {
    const s = far ? -api.sx : api.sx;
    const key = 'dbnmb:' + name;
    const { canvasTex, textQuad } = api.helpers;
    const b = api.sets.get(key, () => api.M.sign('lub:' + key, canvasTex('lub:' + key, 512, 128, (c, w, h) => {
      c.fillStyle = '#7f93b8'; c.fillRect(0, 0, w, h);
      c.fillStyle = DB_BLUE; c.fillRect(7, 7, w - 14, h - 14);
      c.fillStyle = '#f6f6f2';
      let size = 70; c.font = '600 ' + size + 'px Arial';
      while (c.measureText(name).width > w - 50 && size > 26) { size -= 4; c.font = '600 ' + size + 'px Arial'; }
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, w / 2, h / 2 + 3);
    }, { clampU: true, clampV: true })));
    textQuad(b, [k.X(l) - s * 0.05, api.H + 2.45, z], 2.2, 0.55, [-s, 0, 0], [0, 0, s], [0, 1, 0]);
    k.vc.box(k.X(l), api.H + 1.25, z, 0.1, 2.5, 0.1, api.col(GREY_MAST));
  }
  /* DB passenger-information column: slim dark-grey post with a lit display */
  function dbStele(api, k, l, z) {
    const b = api.sets.get('dbstele', () => api.mat('db:stele', () => new api.T.MeshStandardMaterial({ color: 0x24303d, emissive: new api.T.Color(0x16222f), emissiveIntensity: 0.9, roughness: 0.3, vertexColors: true })));
    k.vc.box(k.X(l), api.H + 1.1, z, 0.35, 2.2, 0.35, api.col('#3d444b'));
    b.box(k.X(l) - api.sx * 0.19, api.H + 1.55, z, 0.03, 0.9, 0.3, api.WHITE);
  }
  /* DB LED mast: grey, slim, one arm over the platform */
  const dbMast = (k, l, z, h = 6.2) => k.lamp(l, z, GREY_MAST, h);
  /* a long plain wall (noise barrier / retaining wall) along z at lateral l */
  function wall(api, k, l, z0, z1, h, hex) {
    k.vc.box(k.X(l), api.H + h / 2 - 0.3, (z0 + z1) / 2, 0.35, h, z1 - z0, api.col(hex));
  }
  /* an apron slab of one colour on the platform surface (tactile / paved strip) */
  const strip = (k, lA, lB, z0, z1, hex, key) => k.paveStrip(lA, lB, z0, z1, hex, key);

  /* ================================================================ SCHWEICH
   * Refs: ~/Library/Caches/zuch-refs/Schweich (Commons: Bahnhof Schweich DB 20160826, Video-Reisezentrum - Deutsche Bahn - Schweich, Schweich ehemalige Bahngebäude 20160826, Schweich railway
   * station, RB71 am Bahnhof Schweich, Bahnhof Schweich mit Süwex / mit Dampfzug, Bahnhof-schweich).  The game track (patch x 0) is the track of the island platform on the LEFT (x -1 .. -7.5); the
   * old station building (cream plaster, dark tiles, red video-travel-centre mural) stands behind the house platform on the RIGHT (x 5.6 .. 9.8, track at x 4.4 in between, z -72 .. 94).  The game platform
   * (declared side right) is drawn as one wide platform from the game track to the building; the island is drawn by this model. */
  const SCH = { island: { edge: EDGE, width: 5.8, z0: -94, z1: 94 }, track: 8.7, wallAt: 13.0 };
  reg('Schweich', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      // ---- the house platform (merged with the track-1 strip up to the building)
      [-48, 52].forEach((z) => dbNameBoard(api, k, 3.4, z, 'Schweich (DB)'));
      k.sign(2.4, -14, '1', 'blue');
      k.clockPole(3.2, 36);
      dbStele(api, k, lB - 1.0, 70);
      [-66, -38, -10, 18, 46, 74].forEach((z) => dbMast(k, 7.0, z));
      k.bench(lB - 0.7, -24, '#5a5f66');
      k.bench(lB - 0.7, 32, '#5a5f66');
      k.bin(lB - 0.6, -2, '#3b4046');
      k.glassShelter(lB - 2.5, 99, 5.4, 1.9, '#5c6368', '#6c7378');
      k.vc.box(k.X(lB - 0.8), H + 1.0, 80.6, 0.5, 2.0, 0.6, col('#3a4650'));       // ticket machine in front of the building
      // ---- the island platform of the game track on the far side, with its own track beyond
      k.platformBox(-SCH.island.edge, SCH.island.width, -1, SCH.island.z0, SCH.island.z1);
      dbNameBoard(api, f, 3.2, -30, 'Schweich (DB)', true);
      dbNameBoard(api, f, 3.2, 62, 'Schweich (DB)', true);
      f.sign(2.4, -10, '2', 'blue');
      f.boxShelter(3.6, 60, 4.2, 1.8, '#cfcdc6', '#8f949a', 4);
      f.glassShelter(4.4, 100, 5.2, 1.8, '#5c6368', '#6c7378');
      [-70, -42, -14, 14, 42, 70].forEach((z) => dbMast(f, 3.4, z));
      f.bench(6.2, 20, '#5a5f66');
      f.bin(6.1, -50, '#3b4046');
      k.track(-SCH.track, -135, 135, { pole: true });
      wall(api, k, -SCH.wallAt, -90, 90, 2.6, '#c9c6bd');
    },
  });

  /* flat concrete platform canopy: slab lA..lB over z0..z1 at height h above the platform, posts along the lA edge every `step` m */
  function flatCanopy(api, k, lA, lB, z0, z1, h, hex, postL) {
    const { H, col } = api;
    const zc = (z0 + z1) / 2;
    k.vc.box(k.X((lA + lB) / 2), H + h, zc, Math.abs(lB - lA), 0.28, z1 - z0, col(hex));
    k.vc.box(k.X(lA), H + h - 0.1, zc, 0.12, 0.5, z1 - z0, col('#bdbbb4'));
    for (let z = z0 + 1; z <= z1 - 0.5; z += 5.5) k.vc.box(k.X(postL), H + h / 2, z, 0.22, h, 0.22, col('#c9c7c0'));
  }

  /* DB steel-and-glass stair / lift canopy on posts (flat roof, glass side panes), l..l+wd over z0..z1 */
  function stairCanopy(api, k, l, z0, z1, wd, h = 3.4) {
    const { H, col } = api;
    const zc = (z0 + z1) / 2;
    [[l, z0], [l + wd, z0], [l, z1], [l + wd, z1]].forEach(([a, z]) => k.vc.box(k.X(a), H + h / 2, z, 0.14, h, 0.14, col('#4d555c')));
    k.vc.box(k.X(l + wd / 2), H + h + 0.08, zc, wd + 0.6, 0.16, z1 - z0 + 0.6, col('#5b6369'));
    k.glass().box(k.X(l + wd + 0.02), H + h / 2 + 0.3, zc, 0.03, h - 0.6, z1 - z0, api.WHITE);
  }
  /* old dark steel platform canopy (cantilever on one column row): roof over lA..lB, columns at lCol, slightly pitched */
  function steelCanopy(api, k, lA, lB, lCol, z0, z1, step, hex) {
    const { H, col } = api;
    const y = H + 3.9;
    const zc = (z0 + z1) / 2;
    k.vc.box(k.X((lA + lB) / 2), y + 0.25, zc, Math.abs(lB - lA), 0.22, z1 - z0, col(hex), 0, 0, api.sx * 0.05);
    k.vc.box(k.X(lCol), y + 0.1, zc, 0.5, 0.5, z1 - z0, col(hex));
    for (let z = z0 + 1.5; z <= z1 - 1; z += step) k.vc.box(k.X(lCol), H + (y - H) / 2, z, 0.34, y - H, 0.34, col('#40604d'));
  }

  /* ================================================================ WITTLICH (Wittlich Hbf)
   * Refs: ~/Library/Caches/zuch-refs/Wittlich (Commons: Wittlich Hauptbahnhof Nord / Süd / 2016 a-d, 20241015-Wittlich Hbf-01/-02, Bahnhof Wittlich Empfangsgebäude Gleise Bahnsteige, Bahnsteig Wittlich).
   * Patch frame: the game track (x 0) is track 2 and runs along the island platform on the RIGHT (x 1.4 .. 7.7, z -186 .. 108, tracks 2 / 3 with track 3 at x 9); a third platform (x 19.2 .. 25.3,
   * z -39 .. 103, tracks 4 / 5, old dark steel canopy) lies further out.  The station building (orange plaster, dark hip roof, cream single-storey wing) stands on the LEFT at x -25.7 .. -8.4,
   * z -32 .. 28 (wing to z 51) behind the house platform; track 1 (x -4.4) runs between it and the game track.  The game platform (declared side left) is drawn as one wide platform from the
   * game track to the building (it swallows track 1); the island, track 3, the far platform and its tracks are drawn by this model. */
  const WI = {
    island: { edge: EDGE, width: 6.0, z0: -120, z1: 108 },
    trackG3: 9.0, trackG4: 17.7, far: { edge: 19.2, width: 6.1, z0: -39, z1: 103 },
    houseCanopy: { lHi: 8.2, lLo: 5.4, z0: -9, z1: 13 },
  };
  reg('Wittlich', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      // ---- house platform (merged with the former track-1 strip): name plates, number cubes, masts, benches, the lean-to canopy at the entrance, lift + stair canopy
      [-70, 40, 100].forEach((z) => dbNameBoard(api, k, 3.4, z, 'Wittlich Hbf'));
      [-60, -10, 40, 90].forEach((z, i) => k.sign(2.6, z + 12, 'ABCD'[i], 'blue'));
      [-80, -52, -24, 4, 32, 60, 88].forEach((z) => dbMast(k, 4.6, z));
      k.leanCanopy({ lHi: WI.houseCanopy.lHi, lLo: WI.houseCanopy.lLo, yHi: H + 3.2, yLo: H + 2.8, z0: WI.houseCanopy.z0, z1: WI.houseCanopy.z1, timber: '#b9b9b4', topCol: '#4b5056', postCol: '#4d555c', postEvery: 7.5 });
      k.bench(lB - 0.8, -22, '#5a5f66'); k.bench(lB - 0.8, 20, '#5a5f66'); k.bench(lB - 0.8, 62, '#5a5f66');
      k.bin(lB - 0.6, -18, '#3b4046'); k.bin(lB - 0.6, 26, '#3b4046');
      k.clockPole(3.6, 18);
      k.glassShelter(lB - 2.3, 91, 5.6, 1.9, '#5c6368', '#6c7378');
      stairCanopy(api, k, 5.2, 31, 38, 3.4);
      k.stairOpening(6.9, 34.5, 6.0);
      k.vc.box(k.X(lB - 0.5), H + 1.0, 18, 0.5, 2.0, 0.6, col('#3a4650'));          // ticket machine at the entrance
      // ---- island platform of the game track: tracks 2 / 3, stair + lift canopy, glass shelters, masts, number signs
      k.platformBox(-WI.island.edge, WI.island.width, -1, WI.island.z0, WI.island.z1);
      [-60, 30, 90].forEach((z) => dbNameBoard(api, f, 3.4, z, 'Wittlich Hbf', true));
      f.sign(2.6, -30, '2', 'blue'); f.sign(5.9, -30, '3', 'blue');
      [-85, -55, -25, 5, 35, 65, 95].forEach((z) => dbMast(f, 4.0, z));
      stairCanopy(api, f, 3.6, 8, 15, 3.4);
      f.stairOpening(5.3, 11.5, 6.0);
      f.lift(6.3, 22, H + 3.4);
      f.glassShelter(5.6, 47, 5.4, 1.8, '#5c6368', '#6c7378');
      f.glassShelter(5.2, -6, 4.6, 1.8, '#5c6368', '#6c7378');
      f.bench(6.8, 70, '#5a5f66'); f.bench(6.8, -50, '#5a5f66');
      f.bin(6.6, 56, '#3b4046');
      k.track(-WI.trackG3, -135, 135, { pole: true });
      // ---- the third platform (tracks 4 / 5) with the old dark steel canopy
      k.track(-WI.trackG4, -135, 135, { pole: true });
      k.platformBox(-WI.far.edge, WI.far.width, -1, WI.far.z0, WI.far.z1);
      steelCanopy(api, k, -WI.far.edge - 1.2, -WI.far.edge - 5.4, -WI.far.edge - 5.2, -22, 62, 8, '#3d4a44');
      [-30, 10, 50, 90].forEach((z) => dbMast(f, WI.far.edge + 5.4, z, 5.4));
      dbNameBoard(api, f, WI.far.edge + 1.6, 20, 'Wittlich Hbf', true);
    },
  });

  /* ================================================================ HETZERATH
   * Refs: ~/Library/Caches/zuch-refs/Hetzerath (Commons: "Hetzerath, Bahnhofsgebäude 20260124", "Bahnhof Hetzerath, Durchfahrt des RE 1 nach Trier 20260124"; the other files of the folder are not station photos).
   * The game track (patch x 0) runs along the platform on the RIGHT (x 2.1 .. 7.3, z -105 .. 32) with the old red-sandstone station building behind it (x 7.3 .. 19.8, z -6.5 .. 28.2); a flat white
   * concrete canopy runs from the building along the platform, a concrete box shelter stands ahead of it; track 2 at x -4.2 and the platform of tracks 2 / 3 (x -6.3 .. -14.5, z -88 .. 105) with two
   * concrete box shelters lie on the LEFT. */
  const HE = { track: 4.2, far: { edge: 6.1, width: 8.0, z0: -88, z1: 105 } };
  reg('Hetzerath', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      // building side: flat concrete canopy along the building front, concrete box shelter, plates, masts, benches, ticket machine
      flatCanopy(api, k, 3.8, lB, -6.5, 12, 3.4, '#dddbd4', 4.2);
      k.boxShelter(lB - 2.6, -21, 4.4, 2.1, '#dcdad3', '#bdbbb4', 3);
      [-62, 30].forEach((z) => dbNameBoard(api, k, 3.3, z, 'Hetzerath'));
      k.sign(2.6, -38, '1', 'blue');
      [-84, -55, -32, 4, 24].forEach((z) => dbMast(k, 3.8, z));
      k.bench(lB - 0.6, -2, '#5a5f66'); k.bench(lB - 0.6, -45, '#5a5f66');
      k.bin(lB - 0.5, 8, '#3b4046');
      k.vc.box(k.X(lB - 0.5), H + 1.0, 7.8, 0.5, 2.0, 0.6, col('#3a4650'));
      // far side: track 2, the platform of tracks 2 / 3 with box shelters and plates
      k.track(-HE.track, -135, 135, { pole: true });
      k.platformBox(-HE.far.edge, HE.far.width, -1, HE.far.z0, HE.far.z1);
      [-50, 70].forEach((z) => dbNameBoard(api, f, 3.4, z, 'Hetzerath', true));
      f.sign(2.6, 10, '2', 'blue'); f.sign(5.2, 10, '3', 'blue');
      f.boxShelter(HE.far.edge - 2.0, 34, 5.0, 2.2, '#dcdad3', '#bdbbb4', 3);
      f.boxShelter(HE.far.edge - 2.0, 56, 4.4, 2.2, '#dcdad3', '#bdbbb4', 3);
      [-70, -40, -10, 20, 50, 80].forEach((z) => dbMast(f, 3.6, z));
      f.bench(HE.far.width - 0.4, 0, '#5a5f66');
    },
  });

  /* ---- a plain DB stop without a station building: two side platforms (the one next to the game track on the declared side, the opposite one across the second track), glass shelters, name
   * plates, number cubes, masts, benches.  spec = { name, nearShelters: [z], nearTicket: z, nearPlates: [z], nearMasts: [z], nearBenches: [z], far: { edge, width, z0, z1, track, shelters, plates, masts, benches } } */
  function buildDbHalt(api, spec) {
    const { H, W, col } = api;
    const k = makeKit(api);
    const f = mirrorKit(api);
    const lB = api.edge + W;
    spec.nearPlates.forEach((z) => dbNameBoard(api, k, 3.4, z, spec.name));
    k.sign(2.6, spec.nearPlates[0] + 22, '1', 'blue');
    spec.nearMasts.forEach((z) => dbMast(k, 4.0, z));
    spec.nearShelters.forEach((z) => k.glassShelter(lB - 2.4, z, 5.2, 1.9, '#5c6368', '#6c7378'));
    k.vc.box(k.X(lB - 0.9), H + 1.0, spec.nearTicket, 0.5, 2.0, 0.6, col('#3a4650'));
    spec.nearBenches.forEach((z) => k.bench(lB - 0.7, z, '#5a5f66'));
    k.bin(lB - 0.6, spec.nearTicket + 6, '#3b4046');
    const fa = spec.far;
    if (!fa) return;
    k.track(-fa.track, -135, 135, { pole: true });
    k.platformBox(-fa.edge, fa.width, -1, fa.z0, fa.z1);
    fa.plates.forEach((z) => dbNameBoard(api, f, fa.edge + 0.6, z, spec.name, true));
    f.sign(fa.edge + 0.4, fa.plates[0] + 22, '2', 'blue');
    fa.shelters.forEach((z) => f.glassShelter(fa.edge + fa.width - 2.6, z, 5.2, 1.9, '#5c6368', '#6c7378'));
    fa.masts.forEach((z) => dbMast(f, fa.edge + 1.6, z));
    fa.benches.forEach((z) => f.bench(fa.edge + fa.width - 0.8, z, '#5a5f66'));
  }

  /* ================================================================ FÖHREN (no reference photo on Commons: built from the patch, DB standard furniture)
   * Patch: the game track (x 0) runs along the platform on the LEFT (x -0.8 .. -7.7, z -96 .. 96), second track at x 3.5, platform on the RIGHT (x 5.1 .. 10.9, z -76 .. 94); the ticket machine
   * and a shelter stand on the left platform at z 37, a shelter on the right platform at z 35.  No station building (houses of the village far behind on the left). */
  reg('Föhren', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      buildDbHalt(api, {
        name: 'Föhren', nearShelters: [37], nearTicket: 31, nearPlates: [-55, 62], nearMasts: [-80, -52, -24, 4, 32, 60, 86], nearBenches: [-12, 48],
        far: { edge: 5.0, width: 5.9, z0: -76, z1: 94, track: 3.5, shelters: [35], plates: [-45, 55], masts: [-65, -38, -10, 18, 46, 74], benches: [-20] },
      });
    },
  });

  /* ================================================================ SEHLEM (no reference photo on Commons: built from the patch, DB standard furniture)
   * Patch: game track x 0, platform on the LEFT (x -2.1 .. -9.0, z -90 .. 78, shelter at z 18), second track at x 3.4, platform on the RIGHT (x 4.8 .. 11.2, z -90 .. 90, shelter at z 19). */
  reg('Sehlem', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      buildDbHalt(api, {
        name: 'Sehlem', nearShelters: [18], nearTicket: 12, nearPlates: [-50, 48], nearMasts: [-75, -48, -22, 6, 32, 58], nearBenches: [-14, 30],
        far: { edge: 4.9, width: 6.3, z0: -90, z1: 90, track: 3.4, shelters: [19], plates: [-40, 55], masts: [-70, -44, -18, 10, 36, 62, 84], benches: [-10] },
      });
    },
  });

  /* ================================================================ SALMTAL (no reference photo on Commons: built from the patch, DB standard furniture)
   * Patch: game track x 0, platform on the LEFT (x -1.6 .. -12.5, z -70 .. 69; wide at the bus stop, shelters at z 24 and 40, ticket machine z 35), second track at x 3.2, platform on the
   * RIGHT (x 5 .. 14.2, z -70 .. 70, shelter at z 29); a building spans the tracks at z 53 .. 66 (generic surroundings, unchanged). */
  reg('Salmtal', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      buildDbHalt(api, {
        name: 'Salmtal', nearShelters: [], nearTicket: 56, nearPlates: [-45, 8], nearMasts: [-60, -34, -8, 18, 50], nearBenches: [-31, 2],
        far: { edge: 4.9, width: 6.5, z0: -70, z1: 70, track: 3.2, shelters: [29], plates: [-35, 45], masts: [-55, -28, -2, 24, 52], benches: [-12] },
      });
    },
  });

  /* ================================================================ TRÉIER SÜD (Trier-Süd)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Sued (Commons: Bahnhof Trier-Süd 20130305, Blick zum Bahnhof Trier-Süd, Leoplatz 1 Bahnhof Trier-Süd, Trier-Süd station looking north / south 2016, unused platform 2016).
   * Patch: the platform (x 1.4 .. ~8, z -76 .. 76) lies on the RIGHT of the game track and has the only used track on its other side (x 9.5, drawn here); the Art-Nouveau building stands on the LEFT at the
   * Wasserbillig end behind the Leoplatz road.  The declared side (SIDE_FIX) was changed from 'left' to 'right' to match the platform that really touches the game track.  Long flat brown timber-ceilinged
   * canopy on steel posts over the middle of the platform, DB plates, masts, ticket machine and glass shelter. */
  reg('Tréier Süd', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { H, W, edge, col } = api;
      const k = makeKit(api);
      const lB = edge + W;
      flatCanopy(api, k, 2.6, lB, -34, 22, 3.5, '#6b4f3c', lB - 0.8);
      [-58, 52].forEach((z) => dbNameBoard(api, k, 3.4, z, 'Tréier Süd'));
      k.sign(2.6, -26, '1', 'blue');
      [-66, -40, 30, 56].forEach((z) => dbMast(k, 4.2, z));
      k.glassShelter(lB - 2.4, -12, 5.0, 1.9, '#5c6368', '#6c7378');
      k.vc.box(k.X(lB - 0.9), H + 1.0, -20, 0.5, 2.0, 0.6, col('#3a4650'));
      k.bench(lB - 0.7, 4, '#5a5f66'); k.bench(lB - 0.7, 38, '#5a5f66');
      k.bin(lB - 0.6, 12, '#3b4046');
      k.track(lB + 1.8, -135, 135, { pole: true });
    },
  });

  /* ================================================================ KREUZ KONZ (no usable reference photo: the Commons photos found for 'Konz' show the other Konz stations; built from the patch, DB standard furniture)
   * Patch: game track x 0, one side platform on the LEFT (x -1.2 .. -6.8, z -91 .. 64) with a shelter at z -16; the platform of the diverging Saar line curves away on the left (x -3 .. -29, z 2 .. 91;
   * not modelled, the generic surroundings show the relief).  No station building. */
  reg('Kreuz Konz', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      buildDbHalt(api, {
        name: 'Kreuz Konz', nearShelters: [-16], nearTicket: -4, nearPlates: [-60, 40], nearMasts: [-80, -50, -26, 0, 26, 52], nearBenches: [-36, 18], far: null,
      });
    },
  });
})();
