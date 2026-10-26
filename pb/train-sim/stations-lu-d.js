/* Zuchsimulator Lëtzebuerg: photo-modelled stations of the Mosel line (lu-d): Roodt-Syr, Wecker, Cents-Hamm.  Registers into TS.realStations (stations-real.js),
 * built with the kit of stations-lu-b.js.  The station BUILDING is the real LOD2 building of the station patch, painted by stations-styles-lu.js; this module adds
 * what stands around it (platform furniture, canopies, boards) at the positions of the patch frame.
 * Local frame as in lu-b: l = lateral distance from the track centre towards the platform side (negative = far side), z = along the platform (towards -z = ahead),
 * y up (platform top = H).  Patch x = sx * l. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations || !window.TS.stationKits || !window.TS.stationKits.luB) return;
  const reg = window.TS.realStations.register;
  const makeKit = window.TS.stationKits.luB;
  const RED = '#b2262e';

  /* ================================================================ ROODT (Roodt-sur-Syre)
   * Refs: ~/Library/Caches/zuch-refs/Roodt (Commons: Betzdorf, gare CFL Roodt (102)-(122)).  Platform on the left (Luxembourg-Wasserbëlleg direction), building
   * behind it at patch z 10 .. 36, goods shed z -63 .. -50, toilet hut z -26 .. -20, red CFL bike box on the forecourt, opposite side platform with a shelter. */
  reg('Roodt-Syr', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col } = api;
      const { X, vc } = k;
      const lB = edge + W;
      // the platform is wider in front of the building (real: 4.3 m): paved apron up to the building front (patch x -5.3)
      k.paveStrip(lB, 5.3, 6, 38, '#b9ad98', 'roodtApron');
      k.yellowBoard(lB - 0.9, 8, 'Roodt');
      k.yellowBoard(lB - 0.9, -60, 'Roodt');
      [-40, -12, 40, 70].forEach((z) => k.totem(edge + 1.0, z));
      [-70, -30, 0, 30, 60].forEach((z) => k.lamp(lB - 0.5, z, '#9aa0a4', 5.4));
      k.bench(lB - 0.7, 12, '#7d1f26');
      k.bench(lB - 0.7, -44, '#7d1f26');
      [-8, 40].forEach((z) => k.bin(lB - 0.6, z, '#d9631a'));
      // pink ticket machine at the building, grey poles
      vc.box(X(lB + 1.0), H + 1.0, 14.2, 0.5, 2.0, 0.6, col('#b02a6e'));
      // red bike box on the forecourt (photo 3): red steel roof and cage, white "bikebox" boards
      vc.box(X(10.5), H + 1.3, -10, 4.2, 0.12, 6.4, col(RED));
      [[-1.9, -3], [1.9, -3], [-1.9, 3], [1.9, 3]].forEach(([dx, dz]) => vc.box(X(10.5) + sx * dx * 0 + dx, H + 0.65, -10 + dz, 0.08, 1.3, 0.08, col(RED)));
      vc.box(X(10.5), H + 0.75, -10, 4.0, 1.2, 0.05, col('#f2eeee'));
      // opposite platform (real: edge 6.7 m right of the main track, 2.6 m wide) with a glass shelter and the blue "B" track sign
      k.track(-4.6, -135, 135, { pole: true });
      k.platformBox(-6.7, 2.6, -1, -95, 95);
      k.glassRoofShelter(-7.8, -20, 1.5, 6);
      k.sign(-7.0, 30, 'B', 'blue');
      [-50, 10, 55].forEach((z) => k.totem(-7.2, z));
      [-60, -15, 30, 70].forEach((z) => k.lamp(-8.6, z, '#9aa0a4', 5.4));
      k.yellowBoard(-7.4, -2, 'Roodt');
    },
  });
})();
