/* Zuchsimulator Lëtzebuerg: photo-modelled stations of the Mosel line (lu-e): Oetrange, Betzder (Betzdorf), Wecker, Sandweiler-Contern, Mertert, Manternach, Wasserbëlleg, Cents-Hamm.
 * Registers into TS.realStations (stations-real.js), built with the kit of stations-lu-b.js.  The station BUILDING is the real LOD2 building of the station patch,
 * painted by stations-styles-lu.js; this module adds what stands around it (platform furniture, canopies, shelters, boards, the other tracks and platforms) at the
 * positions of the patch frame.  Registered after lu-b / lu-d, so these entries replace the older hand-made models of the same names.
 * Local frame as in lu-b: l = lateral distance from the track centre towards the platform side (negative = far side), z = along the platform (towards -z = ahead),
 * y up (platform top = H).  Patch x = sx * l. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations || !window.TS.stationKits || !window.TS.stationKits.luB) return;
  const reg = window.TS.realStations.register;
  const makeKit = window.TS.stationKits.luB;
  const GREY_POLE = '#9aa0a4';
  const MAROON = '#6a2b3a';
  /* the kit of the OPPOSITE side: l > 0 points away from the station's platform (towards the far platform), so furniture drawn there opens towards its own track */
  const mirrorKit = (api) => makeKit(Object.assign({}, api, { sx: -api.sx, pf: (l) => api.pf(-l) }));

  /* ================================================================ OETRANGE
   * Refs: ~/Library/Caches/zuch-refs/Oetrange (Commons: Contern, gare CFL Oetrange (104)-(130)).  Five-track station: the old boarded building stands behind the
   * platform of track 1 (patch x 4.7 .. 16.4, z -57.7 .. -35.3); ahead of it a small tile-roofed waiting pavilion with maroon posts; across the tracks (x -4.6, -9.2,
   * -13.7) the long island platform (x -15.1 .. -21.9, z -215 .. -10) for tracks 4 / 5 with three maroon glass-roofed shelters; yellow tubular name boards. */
  const OE = {
    pavilion: { l0: 4.2, l1: 8.8, z0: -79.8, z1: -73.7 },
    island: { edge: -15.1, width: 6.8, z0: -215, z1: -10 },
    tracks: [-4.6, -9.2, -13.7, -23.3],
    shelterZ: [-20.5, -43, -100],
  };
  reg('Oetrange', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col } = api;
      const { X, vc } = k;
      const lB = edge + W;
      // the waiting pavilion ahead of the building
      const p = OE.pavilion;
      const zc = (p.z0 + p.z1) / 2; const len = p.z1 - p.z0;
      const posts = col(MAROON);
      [[p.l0 + 0.12, p.z0 + 0.12], [p.l1 - 0.12, p.z0 + 0.12], [p.l0 + 0.12, p.z1 - 0.12], [p.l1 - 0.12, p.z1 - 0.12]].forEach(([l, z]) => vc.box(X(l), H + 1.3, z, 0.16, 2.6, 0.16, posts));
      vc.box(X(p.l1 - 0.1), H + 0.45, zc, 0.18, 0.9, len, col('#8a3a36'));
      k.glass().box(X(p.l1 - 0.1), H + 1.75, zc, 0.04, 1.7, len - 0.3, api.WHITE);
      [p.z0 + 0.1, p.z1 - 0.1].forEach((z) => { vc.box(X((p.l0 + p.l1) / 2), H + 0.45, z, p.l1 - p.l0, 0.9, 0.16, col('#8a3a36')); k.glass().box(X((p.l0 + p.l1) / 2), H + 1.75, z, p.l1 - p.l0 - 0.3, 1.7, 0.04, api.WHITE); });
      k.roof({ kind: 'hip', mat: 'tile', l0: p.l0, l1: p.l1, z0: p.z0, z1: p.z1, y: H + 2.6, rise: 1.5, ov: 0.55, hipK: 0.9 });
      k.bench(p.l1 - 0.9, zc, '#7d1f26');
      // yellow tubular name boards, info displays, blue ticket totems and lamps on the platform of track 1
      k.yellowBoard(edge + 2.0, -31, 'Oetrange');
      k.yellowBoard(edge + 2.0, -84, 'Oetrange');
      k.yellowDisplay(edge + 2.1, -39);
      k.yellowDisplay(edge + 2.1, -66);
      [-62, -27, 12, 55].forEach((z) => k.totem(edge + 1.0, z));
      [-95, -64, -30, 6, 40, 75].forEach((z) => k.lamp(edge + 1.3, z, GREY_POLE, 7.2));
      k.bench(lB - 1.0, -63, '#7d1f26');
      k.bench(lB - 1.0, -20, '#7d1f26');
      k.bin(lB - 0.8, -28, '#d9631a');
      // across the tracks: three more tracks, the island platform of tracks 4 / 5 with maroon glass-roofed shelters
      OE.tracks.forEach((l) => k.track(l, -135, 135, { pole: true }));
      const isl = OE.island;
      k.platformBox(isl.edge, isl.width, -1, isl.z0, isl.z1);
      OE.shelterZ.forEach((z) => k.glassRoofShelter(isl.edge - 5.2, z, 2.2, 7.5));
      [-30, -75, -125, -170].forEach((z) => k.lamp(isl.edge - 3.4, z, GREY_POLE, 7.2));
      [-55, -110, -150].forEach((z) => k.totem(isl.edge - 2.0, z));
      k.sign(isl.edge - 1.0, -65, '5', 'blue');
      k.sign(isl.edge - 5.8, -65, '4', 'blue');
      k.yellowBoard(isl.edge - 1.4, -32, 'Oetrange');
    },
  });
  /* ================================================================ BETZDER (Betzdorf)
   * Refs: ~/Library/Caches/zuch-refs/Betzder (Commons: Betzdorf, gare CFL Betzdorf (101)-(105)): only five photos (yellow name board, the white timber waiting
   * shelter from two sides, two platform views with trains) - the station building no longer exists.  Two tracks 4.1 m apart with a side platform outside each:
   * ours on the left (patch x -1.4 .. -4.0) with the white board-and-batten waiting shelter 7 m behind it (patch x -12 .. -6.9, z -47 .. -35.7), the far one on the
   * right (x 5.7 .. 8.7) with a ticket machine and a shelter near z -53. */
  const BE = { far: { edge: 5.7, width: 3.0, z0: -95, z1: 95 }, track: -4.1 };
  reg('Betzder', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const f = mirrorKit(api);
      const { H, W, edge, WHITE } = api;
      const lB = edge + W;
      k.yellowBoard(edge + 1.3, -12, 'Betzdorf');
      k.yellowBoard(edge + 1.3, 46, 'Betzdorf');
      k.sign(lB - 0.5, -24, 'D', 'blue');
      [-62, 20].forEach((z) => k.totem(edge + 0.9, z));
      [-84, -52, -20, 14, 48, 80].forEach((z) => k.lamp(lB - 0.4, z, GREY_POLE, 6.0));
      k.bench(lB - 0.8, -33, '#7d1f26');
      k.bin(lB - 0.7, -6, '#d9631a');
      // the far track and its side platform (patch x 5.7 .. 8.7) with the ticket machine and a glass shelter
      k.track(BE.track, -135, 135, { pole: true });
      f.platformBox(BE.far.edge, BE.far.width, 1, BE.far.z0, BE.far.z1);
      f.glassShelter(BE.far.edge + BE.far.width - 1.6, -53.5, 4.0, 1.6, '#6b7076', '#4c5258');
      f.vc.box(f.X(BE.far.edge + 2.2), H + 1.0, -82.4, 0.5, 2.0, 0.6, api.col('#b02a6e'));
      [-70, -20, 25, 70].forEach((z) => f.lamp(BE.far.edge + BE.far.width - 0.5, z, GREY_POLE, 6.0));
      [-40, 40].forEach((z) => f.totem(BE.far.edge + 0.9, z));
      f.sign(BE.far.edge + 0.9, -8, 'C', 'blue');
    },
  });
  /* ================================================================ WECKER
   * Refs: ~/Library/Caches/zuch-refs/Wecker (Commons: Biwer, gare CFL Wecker (103)-(115)).  The real platform is an ISLAND (patch x -5.8 .. -1.6, z -92.5 .. 92.5) between the
   * base track (x 0) and the second main track (x -7.5), reached by an underpass whose red glass-roofed stairs end at its Luxembourg end (z ~ 96); the station building (stone,
   * x 8 .. 17.9, z 82.6 .. 102.1) stands behind the yard track (x 8.1), with the white hut and the red bike shelter next to it.  Everything is written in PATCH x and converted
   * to the station frame with l = sx * x, so the model is right for either declared side; the island is the game's own platform when the declared side is left.
   * `isl` draws what stands on the island, facing the base track (x = -d); `islFar` faces the other main track. */
  const WE = { islandEdge: 1.6, islandWidth: 4.2, z0: -92.5, z1: 92.5, mid: 3.7, tracks: [-7.5, -11.7], yard: 8.1, underpassZ: 98 };
  const RED_STEEL = '#a8232e';
  reg('Wecker', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const isl = sx > 0 ? f : k;                     // kit whose boards / benches face the base track from the island at distance d (argument d > 0)
      const islFar = sx > 0 ? k : f;                  // faces the second main track (argument -d)
      WE.tracks.forEach((x) => k.track(sx * x, -135, 135, { pole: true }));
      if (sx < 0) k.track(sx * WE.yard, -135, 47, { pole: true });
      if (sx > 0) f.platformBox(WE.islandEdge, WE.islandWidth, 1, WE.z0, WE.z1);
      const m = WE.mid;
      // brick-paver paving looks like the photos: the platform texture of the game has the yellow lines already
      [-78, -44, -8, 28, 62].forEach((z) => isl.lamp(m, z, GREY_POLE, 6.4));
      [-60, 15, 70].forEach((z) => isl.sign(m - 0.6, z, 'A', 'blue'));
      [-62, 40].forEach((z) => isl.totem(2.4, z));
      isl.yellowBoard(2.3, -24, 'Wecker');
      isl.yellowBoard(2.3, 52, 'Wecker');
      // red steel open shelter (photo 105) at z 9
      isl.postShelter(m - 1.0, 9.1, 2.0, 7.5, RED_STEEL, RED_STEEL);
      isl.bench(5.0, -20, '#7d1f26');
      // underpass: red steel / glass gabled stair roof at the Luxembourg end of the island, stairs, orange bin, blue "VOIES 1-2" sign
      isl.glassRoofShelter(m - 1.3, WE.underpassZ, 2.6, 7);
      isl.stairOpening(m, WE.underpassZ, 6.2);
      isl.bin(m + 1.4, WE.underpassZ - 4.3, '#f08a10');
      isl.vc.box(isl.X(2.2), H + 1.0, 90.5, 0.5, 2.0, 0.6, col('#b02a6e'));
      // red steel bike shelter beside the station building (patch x 9.8 .. 12.3, z 67 .. 73): glass sides, racks
      const bz = 70; const bl = sx * 11.0;
      [[-1.1, -2.9], [1.1, -2.9], [-1.1, 2.9], [1.1, 2.9]].forEach(([dx, dz]) => k.vc.box(k.X(bl) + dx, H + 1.2, bz + dz, 0.12, 2.4, 0.12, col(RED_STEEL)));
      k.vc.box(k.X(bl), H + 2.5, bz, 2.8, 0.16, 6.4, col(RED_STEEL));
      k.glass().box(k.X(bl) - 1.1, H + 1.2, bz, 0.03, 1.9, 5.7, api.WHITE);
      [-2.2, -0.7, 0.8, 2.2].forEach((dz) => k.vc.box(k.X(bl) + 0.4, H + 0.45, bz + dz, 0.5, 0.9, 0.05, col('#8a9096')));
    },
  });
  /* ================================================================ SANDWEILER-CONTERN
   * Refs: ~/Library/Caches/zuch-refs/Sandweiler-Contern (Commons: Contern, gare CFL Sandweiler-Contern (101)-(113)).  Modern halt in a wooded cutting under the CR 234 road bridge:
   * two side platforms of grey / brown pavers (patch x 1.3 .. 5.4 and -10.2 .. -6.2) with long anthracite-clad flat-roofed service buildings at z 48 .. 106 (the LOD2 boxes, painted
   * dark grey with glazed fronts) and flat dark steel canopies over the platform, blue name boards, blue square sector signs (A / C), a dark steel bike box beside each platform. */
  const SC = { far: { edge: -6.2, width: 4.0, z0: -126, z1: 126 }, track: -4.9, z0: 48, z1: 106, wallR: 5.1, wallL: -7.3 };
  function blueNameBoard(api, k, l, z, line1, line2) {
    const key = 'scbd:' + line1 + line2;
    const { canvasTex, textQuad } = api.helpers;
    const b = api.sets.get(key, () => api.M.sign('lub:' + key, canvasTex('lub:' + key, 512, 256, (c, w, h) => {
      c.fillStyle = '#d8dce0'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#0a2fa8'; c.fillRect(10, 10, w - 20, h - 20);
      c.fillStyle = '#f4f6f8'; c.font = '600 62px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(line1, w / 2, h * 0.28); c.fillRect(w * 0.38, h * 0.5 - 3, w * 0.24, 6); c.fillText(line2, w / 2, h * 0.74);
    }, { clampU: true, clampV: true })));
    textQuad(b, [k.X(l) - api.sx * 0.05, api.H + 2.1, z], 2.6, 1.3, [-api.sx, 0, 0], [0, 0, api.sx], [0, 1, 0]);
    [-1.2, 1.2].forEach((dz) => k.vc.box(k.X(l), api.H + 1.1, z + dz, 0.08, 2.2, 0.08, api.col('#b9bec2')));
  }
  /* flat dark steel canopy from a building wall (l = lWall) out over the platform to lFront, on slim posts */
  function platformCanopy(k, api, lWall, lFront, z0, z1) {
    const { H, col } = api; const { X, vc } = k;
    vc.box(X((lWall + lFront) / 2), H + 3.3, (z0 + z1) / 2, Math.abs(lWall - lFront), 0.22, z1 - z0, col('#30353a'));
    for (let z = z0 + 2; z <= z1; z += 7) vc.box(X(lFront), H + 1.65, z, 0.12, 3.3, 0.12, col('#6a7076'));
  }
  /* the CR 234 road bridge over the cutting (patch road with bridge = 1, deck 9.2 m above the formation, skewed 30 degrees to the track): the patch renderer skips bridge ribbons */
  const SC_BRIDGE = { a: [-33.0, 43.8], b: [29.6, 6.9], yTop: 9.24, width: 9.6, deckH: 1.4, piersX: [-14, 10, 22] };
  function roadBridge(api, k) {
    const { col, FORM_Y } = api; const { vc } = k;
    const [ax, az] = SC_BRIDGE.a; const [bx, bz] = SC_BRIDGE.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len; const uz = (bz - az) / len;
    const yaw = Math.atan2(ux, uz);
    const yTop = SC_BRIDGE.yTop + FORM_Y;
    const at = (t) => [ax + (bx - ax) * t, az + (bz - az) * t];
    const [cx, cz] = at(0.5);
    const side = (off) => [cx + uz * off, cz - ux * off];
    vc.box(cx, yTop - SC_BRIDGE.deckH / 2, cz, SC_BRIDGE.width, SC_BRIDGE.deckH, len, col('#9c9a94'), yaw);
    vc.box(cx, yTop + 0.03, cz, 7.2, 0.06, len, col('#4a4c50'), yaw);
    [-1, 1].forEach((d) => {
      const [px, pz] = side(d * (SC_BRIDGE.width / 2 - 0.15));
      vc.box(px, yTop + 0.55, pz, 0.3, 1.1, len, col('#a8a6a0'), yaw);
      const [rx, rz] = side(d * (SC_BRIDGE.width / 2 + 0.05));
      vc.box(rx, yTop + 1.2, rz, 0.06, 0.1, len, col('#b0453c'), yaw);
    });
    SC_BRIDGE.piersX.forEach((x) => {
      const [px, pz] = at((x - ax) / (bx - ax));
      vc.box(px, (yTop - SC_BRIDGE.deckH - 1.5) / 2, pz, SC_BRIDGE.width - 0.8, yTop - SC_BRIDGE.deckH + 1.5, 1.4, col('#8f8d87'), yaw);
    });
  }
  reg('Sandweiler-Contern', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const f = mirrorKit(api);
      const { sx, edge, W } = api;
      const lB = edge + W;
      const toward = (x) => -x * sx;                      // argument of the mirrored kit for patch x
      roadBridge(api, k);
      // our platform
      platformCanopy(k, api, sx * SC.wallR, sx * (SC.wallR - 2.4), SC.z0, SC.z1);
      [-34, 112].forEach((z) => blueNameBoard(api, k, edge + 1.1, z, 'Sandweiler', 'Contern'));
      [-70, -8, 56, 100].forEach((z) => k.sign(edge + 0.8, z, 'A', 'blue'));
      [-48, 12, 40, 76].forEach((z) => k.totem(edge + 1.0, z));
      [-100, -64, -28, 8, 44, 80, 116].forEach((z) => k.lamp(lB - 0.6, z, '#6a2a22', 6.0));
      k.bench(lB - 1.0, -50, '#4a4f55');
      k.bin(lB - 0.7, -20, '#3b4046');
      // the second main track and the far side platform (patch x -10.2 .. -6.2) with its canopy
      k.track(sx * SC.track, -135, 135, { pole: true });
      k.platformBox(sx * SC.far.edge, SC.far.width, -sx, SC.far.z0, SC.far.z1);
      platformCanopy(f, api, toward(SC.wallL), toward(SC.wallL + 0.9), SC.z0, SC.z1);
      [-34, 112].forEach((z) => blueNameBoard(api, f, toward(-7.4), z, 'Sandweiler', 'Contern'));
      [-70, -8, 56, 100].forEach((z) => f.sign(toward(-7.2), z, 'C', 'blue'));
      [-60, 0, 30].forEach((z) => f.totem(toward(-7.6), z));
      [-100, -64, -28, 8, 44, 80, 116].forEach((z) => f.lamp(toward(-9.2), z, '#6a2a22', 6.0));
      f.bench(toward(-9.0), -50, '#4a4f55');
    },
  });

  /* ================================================================ MERTERT
   * Refs: ~/Library/Caches/zuch-refs/Mertert (Commons: Mertert, gare CFL Mertert (100)-(111)).  Two side platforms with two tracks between them.  The game's track runs next to the LEFT
   * platform (patch x -4.2 .. -1.5: asphalt, white block shelter at x -5.2 / z 24, ticket machine, blue totem, yellow name board, grey railing behind); the old station building
   * (patch x 12 .. 28, z 71 .. 83) stands behind the RIGHT platform (x 5.9 .. 10.4, 1.5 m in front of it) which has a white block hut at z 44 and red-headed mast lamps.  The CFL bike box
   * and the pedestrian underpass are down by the road at z 125 (x -18).  Declared side 'left' = the left platform: the building is on the far side of the game track. */
  const ME = { far: { edge: 5.9, width: 4.5, z0: -81, z1: 111 }, track: 4.0, bikebox: { x: -18.4, z: 124.6, y: -4.1 } };
  const ME_LAMPS_NEAR = [-77.6, 44.4, 73.5];
  const ME_LAMPS_FAR = [-122.6, -93.9, -52.8, -14.3, 23.8, 63.1, 100.6];
  const ME_WHITE_BLOCK = '#e9e7df';
  reg('Mertert', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col, FORM_Y } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);                         // far platform: argument = patch x (sx = -1 side) = distance from the game track
      const lB = edge + W;
      const toward = (x) => -x * sx;                    // patch x -> argument of the mirrored kit
      // our platform (left): block shelter, ticket machine, totem, board, clock, bin, lamps, grey railing along the back
      k.boxShelter(3.7, 24, 3.4, 1.7, ME_WHITE_BLOCK, '#a4a8ab', 3);
      k.vc.box(k.X(4.57), H + 0.95, 31, 0.5, 1.9, 0.7, col('#c2352e'));
      k.vc.box(k.X(4.57) - sx * 0.27, H + 1.3, 31, 0.03, 0.6, 0.45, col('#26303a'));
      k.totem(3.6, 34.5);
      k.yellowBoard(3.3, 38.5, 'Mertert');
      k.bin(4.63, 28.8, '#d9631a');
      k.clockPole(3.0, 26);
      ME_LAMPS_NEAR.forEach((z) => k.lamp(lB - 0.2, z, '#9aa0a4', 5.4));
      for (let z = 34; z <= 72; z += 3) k.vc.box(k.X(lB + 0.05), H + 0.5, z, 0.05, 1.0, 0.05, col('#8f969b'));
      k.vc.box(k.X(lB + 0.05), H + 0.98, 53, 0.05, 0.05, 38, col('#8f969b'));
      // second track and the far platform with the station building behind it
      k.track(sx * ME.track, -135, 135, { pole: true });
      k.platformBox(sx * ME.far.edge, ME.far.width, -1, ME.far.z0, ME.far.z1);
      f.boxShelter(toward(10.3), 44.1, 3.6, 1.8, ME_WHITE_BLOCK, '#a4a8ab', 3);
      f.bin(toward(10.5), 40.5, '#d9631a');
      ME_LAMPS_FAR.forEach((z) => f.lamp(toward(10.1), z, '#9aa0a4', 5.4));
      f.yellowBoard(toward(9.4), 4, 'Mertert');
      [-60, 60].forEach((z) => f.sign(toward(7.2), z, 'C', 'blue'));
      [-30, 85].forEach((z) => f.totem(toward(7.0), z));
      // the pedestrian underpass at z 129.5 under both tracks: concrete portals with wing walls on the road sides (x -13 / x 11.5), dark opening
      [[-13, -1], [11.5, 1]].forEach(([x, out]) => {
        const lx = k.X(sx * x); const yb = FORM_Y + ME.bikebox.y - 0.3; const cz = 129.5;
        k.vc.box(lx, yb + 3.3, cz, 0.7, 0.8, 5.2, col('#a2a29b'));
        [-1, 1].forEach((d) => {
          k.vc.box(lx, yb + 1.5, cz + d * 2.2, 0.7, 3.0, 0.8, col('#a2a29b'));
          k.vc.box(lx + sx * out * 1.6, yb + 1.1, cz + d * 3.0, 3.2, 2.2, 0.4, col('#9a9a93'));
          k.vc.box(lx + sx * out * 3.0, yb + 0.5, cz + d * 3.2, 2.6, 1.0, 0.4, col('#9a9a93'));
        });
        k.vc.box(lx - sx * out * 0.6, yb + 1.5, cz, 0.2, 3.0, 3.6, col('#101214'));
      });
      // CFL bike box by the underpass, 4 m below the track: perforated grey box with red doors
      const bx = sx * ME.bikebox.x; const by = FORM_Y + ME.bikebox.y;
      k.vc.box(k.X(bx), by + 1.25, ME.bikebox.z, 2.6, 2.5, 4.6, col('#c9cccf'));
      k.vc.box(k.X(bx) - sx * 1.32, by + 1.1, ME.bikebox.z, 0.06, 2.1, 1.8, col('#b52a2a'));
    },
  });

  /* ================================================================ MANTERNACH
   * Refs: ~/Library/Caches/zuch-refs/Manternach (Commons: Manternach, gare CFL Manternach (101)-(106), Manternach2294, ManternachBushaltestelle).  No station building any more: two side
   * platforms of tan pavers with two tracks between them (patch x 1.1 .. 4.4 next to the game track at x 0, and x -8.6 .. -5.6 next to the second track at x -4.2).  The game platform is the
   * RIGHT one (the declared side 'left' of real-mosel.js is corrected in routes.js SIDE_FIX): open red-brick shelter with a flat white roof at z -54 (photo 104), blue totems, a blue "A"
   * sign, round clocks, orange bins, the yellow-framed name board.  The village / car-park side platform has the maroon steel-and-glass shelter at z -52 and the red / grey bike box. */
  const MA = { far: { edge: -5.6, width: 3.0, z0: -90, z1: 89 }, track: -4.2, shelterZ: -53.8, bikebox: { x: -22.7, z: -45.2 } };
  const MA_MAROON = '#6a2b3a';
  reg('Manternach', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      const toward = (x) => -x * sx;
      // our platform: open red-brick shelter (back wall 0.7 m behind the platform, opens to the track), totems, sign, bins, clocks, lamps
      k.boxShelter(lB - 0.5, MA.shelterZ, 5.6, 2.4, '#a85a44', '#d6d7d4', 5);
      [-44, -66].forEach((z) => k.totem(edge + 1.4, z));
      k.sign(edge + 1.1, -47.5, 'A', 'blue');
      [-36, 28].forEach((z) => k.bin(lB - 0.7, z, '#d9631a'));
      [-30, 36].forEach((z) => k.clockPole(edge + 2.0, z));
      k.yellowBoard(lB - 0.6, 10, 'Manternach');
      k.yellowBoard(lB - 0.6, -76, 'Manternach');
      [-80, -20, 20, 60].forEach((z) => k.lamp(lB - 0.2, z, '#8d9296', 5.4));
      // the white utility hut with the blue totem, the "C" sign and the round clock at the Luxembourg end of our platform (photo 102)
      k.vc.box(k.X(lB - 0.2), H + 1.3, 58, 2.0, 2.6, 2.6, col('#dedcd6'));
      k.vc.box(k.X(lB - 0.2), H + 2.7, 58, 2.3, 0.14, 2.9, col('#8d9296'));
      k.totem(edge + 1.6, 55);
      k.sign(edge + 1.1, 61, 'C', 'blue');
      k.clockPole(edge + 1.6, 52);
      // second track and the far platform (village side)
      k.track(sx * MA.track, -135, 135, { pole: true });
      k.platformBox(sx * MA.far.edge, MA.far.width, -1, MA.far.z0, MA.far.z1);
      f.glassShelter(toward(-8.0), -52, 5.0, 2.2, MA_MAROON, '#7a2a30');
      f.bin(toward(-8.2), -57.7, '#d9631a');
      [-30, 40].forEach((z) => f.totem(toward(-6.8), z));
      f.sign(toward(-6.5), 62, 'C', 'blue');
      f.clockPole(toward(-7.0), 66);
      f.yellowBoard(toward(-8.2), -12, 'Manternach');
      [-80, -20, 25, 70].forEach((z) => f.lamp(toward(-8.6), z, '#8d9296', 5.4));
      // red / grey CFL bike box on the car park (photo 106): perforated light-grey box, red / black door side towards the platform
      const bx = sx * MA.bikebox.x;
      k.vc.box(k.X(bx), api.FORM_Y + 1.3, MA.bikebox.z, 3.4, 2.6, 3.4, col('#d4d6d8'));
      k.vc.box(k.X(bx) + sx * 1.72, api.FORM_Y + 1.1, MA.bikebox.z, 0.06, 2.1, 1.1, col('#8e2a2a'));
    },
  });

  /* ================================================================ WASSERBËLLEG (Wasserbillig)
   * Refs: ~/Library/Caches/zuch-refs/Wasserbelleg (Commons: Wasserbillig, gare CFL (101)-(136)).  Terminus-like frontier station: the long yellow-ochre station building (patch x -19 .. -1.4,
   * z -143 .. -85; the LOD2 model includes the long lean-to platform roof) stands behind the game platform (patch x -7.6 .. -1.8, left of the game track at x 0, 5.8 m wide towards the
   * Luxembourg end).  Across the second track (x 4.5) an island platform (x 7 .. 13.1, z -152 .. 123) with glass shelters; yard tracks further right (x 14.5, 19.2); the concrete water
   * tower (z 124, x 36) and the engine shed beside it come from the LOD2 model (style).  Forecourt, bus station and goods shed on the left. */
  const WB = { island: { edge: 7.0, width: 6.1, z0: -152, z1: 123 }, tracks: [4.5, 14.5, 19.2], shelters: [-67.7, -43.5, -37.6], bikebox: { x: -6.4, z: -150.8 } };
  reg('Wasserbëlleg', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      const toward = (x) => -x * sx;
      // our platform (left, x -7.6 .. -1.8): pink ticket machine at the building, totems, name boards, clocks, bins, lamps
      k.vc.box(k.X(4.8), H + 1.0, -95.5, 0.5, 2.0, 0.6, col('#b02a6e'));
      [-60, 0, 60, 110].forEach((z) => k.totem(edge + 1.4, z));
      [-70, 20, 100].forEach((z) => k.yellowBoard(lB - 0.9, z, 'Wasserbillig'));
      [-45, 40].forEach((z) => k.clockPole(edge + 2.2, z));
      [-84.6, 64.7].forEach((z) => k.bin(lB - 0.5, z, '#d9631a'));
      [-60, -20, 20, 60, 100].forEach((z) => k.lamp(lB - 0.4, z, '#9aa0a4', 5.6));
      k.sign(edge + 1.0, -30, 'A', 'blue');
      k.sign(edge + 1.0, 70, 'B', 'blue');
      // the real platform runs on under the building canopy (z -143 .. -85) while the game platform (210 m) ends at z -105 with its ramp
      k.platformBox(edge, 2.9, 1, -146, -100);
      // posts of the long LOD2 platform canopy (roof 5.4 .. 6.2 m above the formation along the building, x -4.6 .. -1.4, z -142.6 .. -92.7)
      for (let z = -139; z <= -95; z += 6) k.vc.box(k.X(1.9), api.FORM_Y + 3.0, z, 0.16, 6.0, 0.16, col('#7a8086'));
      // second track, the island platform with its glass shelters, the yard tracks
      WB.tracks.forEach((x) => k.track(sx * x, -135, 135, { pole: true }));
      k.platformBox(sx * WB.island.edge, WB.island.width, -1, WB.island.z0, WB.island.z1);
      WB.shelters.slice(0, 2).forEach((z) => f.glassShelter(toward(9.0), z, 6.0, 2.2, '#5d646b', '#4c5258'));
      [-100, -10, 40, 90].forEach((z) => f.totem(toward(8.0), z));
      [-120, -80, -20, 20, 60, 100].forEach((z) => f.lamp(toward(12.4), z, '#9aa0a4', 5.6));
      [-80, 80].forEach((z) => f.yellowBoard(toward(8.0), z, 'Wasserbillig'));
      f.sign(toward(7.8), -20, 'B', 'blue');
      f.clockPole(toward(8.6), 5);
      [-46.9, -23.4, 64.9].forEach((z) => f.bin(toward(9.6), z, '#d9631a'));
      // CFL bike box at the Trier end of the forecourt (grey perforated box, red doors)
      const bx = sx * WB.bikebox.x;
      k.vc.box(k.X(bx), api.FORM_Y + 1.3, WB.bikebox.z, 3.4, 2.6, 3.4, col('#d4d6d8'));
      k.vc.box(k.X(bx) - sx * 1.72, api.FORM_Y + 1.1, WB.bikebox.z, 0.06, 2.1, 1.1, col('#8e2a2a'));
    },
  });
})();
