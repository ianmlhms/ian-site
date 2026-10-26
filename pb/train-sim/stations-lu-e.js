/* Zuchsimulator Lëtzebuerg: photo-modelled stations of the Mosel line (lu-e): Oetrange, Betzder (Betzdorf), Wecker, Sandweiler-Contern.
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
})();
