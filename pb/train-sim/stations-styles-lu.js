/* Zuchsimulator Lëtzebuerg: painted styles of the real station buildings of the Mosel line (TS.stationStyles, station-building.js).
 * The volumes come from the national LOD2 model in the station patch; a style says how the faces are painted (colours, windows, doors seen on the reference
 * photos in ~/Library/Caches/zuch-refs/<Station>/).  Door positions are patch z (m along the platform, ahead = negative); `face`: 'front' = the side towards the
 * track, 'back' = the forecourt side.  `others` styles buildings of the station area by OSM id (goods shed, toilet hut ...). */
(function () {
  'use strict';
  if (!window.TS || !window.TS.stationStyles) return;
  const reg = window.TS.stationStyles.register;
  const MAROON = '#7d1c2d';

  /* ROODT-SUR-SYRE (Roodt-Syr).  Refs: Commons "Betzdorf, gare CFL Roodt (101)-(122)" (Feb 2025).
   * Two-storey cream-white plastered building with grey slate hipped roofs, a gabled front with a round window, maroon window frames, grey stone plinth, a lower
   * wing to the Luxembourg end; behind the platform the long cream timber goods shed (open canopy on the platform side) and a sandstone toilet hut with dark doors. */
  reg('Roodt-Syr', {
    wall: '#ebe6d6', trim: '#d9d3bf', plinth: { h: 0.75, col: '#9a9484' }, band: '#d8d2be', roof: 'slate', floorH: 3.4, bayM: 3.1, stain: true,
    win: { w: 1.05, h: 1.6, kind: 'rect', frame: MAROON, reveal: '#dcd6c2', sill: true },
    gableWin: 'round',
    doors: [
      { z: 18.5, w: 1.1, h: 2.3, col: MAROON, face: 'front' }, { z: 15.0, w: 1.05, h: 2.3, col: MAROON, face: 'back' }, { z: 22.2, w: 1.05, h: 2.3, col: MAROON, face: 'back' },
      { z: 31.0, w: 1.1, h: 2.3, col: '#5a4a3c', face: 'back' },
    ],
    otherBase: { stain: true },
    others: {
      w231262330: { wall: '#e4dbbd', boards: true, noWindows: true, roof: 'slate', plinth: { h: 0.5, col: '#8d8776' } },                      // the timber goods shed
      'ACT_48b19d9f-e9db-4329-a7c9-5fc88b761986': { wall: '#c8a266', stone: true, noWindows: true, roof: 'tile', plinth: { h: 0.3, col: '#8a7355' }, doors: [{ z: -24.9, w: 0.95, h: 2.1, col: '#2f3438', glass: false, face: 'back' }, { z: -22.7, w: 0.95, h: 2.1, col: '#2f3438', glass: false, face: 'back' }, { z: -20.6, w: 0.95, h: 2.1, col: '#2f3438', glass: false, face: 'back' }] },   // the sandstone toilet hut
    },
  });
  /* OETRANGE.  Refs: Commons "Contern, gare CFL Oetrange (104)/(119)/(124)" (Feb 2025).  The old (disused, boarded) station building: weathered cream-yellow plaster with ochre
   * window surrounds, grey sandstone plinth, two storeys in the centre and to the Luxembourg end, a lower wing ahead with a big dark tiled hip roof (clock on its wall); the
   * boarded door left of the middle.  The little tile-roofed waiting pavilion ahead of it is drawn by the station model (stations-lu-e.js). */
  reg('Oetrange', {
    wall: '#e4dab2', trim: '#e8d690', plinth: { h: 0.55, col: '#a39a82' }, band: '#e0cf94', roof: 'slate', roofTint: '#d2cabe', floorH: 4.2, bayM: 3.4, stain: true,
    win: { w: 1.25, h: 2.0, kind: 'rect', frame: '#f0eee6', reveal: '#e6d38c', sill: true },
    doors: [
      { z: -48.6, w: 1.1, h: 2.4, col: '#8a8068', glass: false, face: 'front' }, { z: -46.0, w: 1.1, h: 2.3, col: '#4a4038', face: 'back' }, { z: -55.5, w: 1.1, h: 2.3, col: '#4a4038', face: 'back' },
    ],
    extras(api) {
      // round platform clock on the wall of the low wing (photo 104), drainpipe between wing and centre block
      api.box(4.64, 3.4, -54.2, 0.06, 0.8, 0.8, '#2b2e32');
      api.box(4.58, 3.4, -54.2, 0.06, 0.66, 0.66, '#f1eee6');
      api.box(5.5, 3.2, -50.3, 0.12, 6.0, 0.12, '#7a7e82');
    },
    others: {
      'ACT_ed7c1963-665a-440b-8c8a-5ef19a69fde4': { hidden: true },
    },
  });

  /* LËTZEBUERG GARE CENTRALE.  Refs: ~/Library/Caches/zuch-refs/Lux-Gare (Commons: Luxembourg City railway station 2022-12, Gare centrale tram stop,
   * Grande vitesse, Hall Gare centrale).  Yellow-ochre sandstone building (1907-1913), arched windows, mansard slate roofs, the clock tower with its
   * green copper spire; the real LOD2 model (667 roof faces) gives the volumes. */
  reg('Lëtzebuerg', {
    wall: '#d8c093', trim: '#c4a876', plinth: { h: 1.3, col: '#8b7d62' }, band: '#c9ae7c', roof: 'slate', roofTint: '#7d8288',
    steepRoof: { kind: 'slate', tint: '#585d63' }, copperAbove: 28, copperTint: '#5f9d8a',
    floorH: 4.4, bayM: 4.2, stain: true,
    win: { w: 1.25, h: 2.3, kind: 'rect', frame: '#efe9dc', reveal: '#b99d68', sill: true },
    gableWin: 'round',
    doors: [],
    others: { w362239328: { noWalls: true, roof: 'zinc', roofTint: '#c9d3da', noWindows: true } },   // the glass-and-steel platform canopies (LOD2 holds them as one flat roof building)
  });

  /* BETZDER (Betzdorf).  Refs: Commons "Betzdorf, gare CFL Betzdorf (101)-(105)" (Feb 2025).  No station building any more; the LOD2 hut behind the platform is the old white
   * timber waiting shelter: board-and-batten walls painted white, white-framed glazing bars, open arched bay, brown-grey tiled gable roof, brick paving in front. */
  reg('Betzder', {
    wall: '#f4f2ea', trim: '#faf8f1', plinth: { h: 0.35, col: '#c4beb0' }, roof: 'tile', roofTint: '#8d8478', floorH: 3.6, bayM: 3.8, stain: false, boards: true,
    win: { w: 1.15, h: 1.6, kind: 'rect', frame: '#fbfaf5', reveal: '#efece3', sill: false },
    doors: [{ z: -41.4, w: 2.5, h: 2.2, col: '#5d5144', glass: false, face: 'front' }],
    extras(api) {
      // the open bay of the shelter: a row of maroon seats under the arch (photo 102), grey-brown paving in front
      [-42.4, -41.7, -41.0, -40.3].forEach((z) => api.box(-7.35, 1.1, z, 0.45, 0.07, 0.5, '#6b2230'));
      api.box(-7.2, 1.4, -41.4, 0.05, 0.55, 2.4, '#6b2230');
    },
  });
  /* WECKER.  Refs: Commons "Biwer, gare CFL Wecker (103)-(115)" (2025).  Station building behind the tracks at the Luxembourg end: sandstone ashlar with yellow-ochre stone
   * surrounds and tall arched ground-floor windows, dark slate hip / gable roofs, a lower white plastered wing ahead of it; next to it a small white plastered hut with arched
   * ochre-framed windows and a slate gable roof; the red steel bike shelter beside it is drawn by the station model (stations-lu-e.js). */
  reg('Wecker', {
    wall: '#cdb98c', trim: '#dcc36a', plinth: { h: 0.6, col: '#a79a7c' }, band: '#d6c06c', roof: 'slate', floorH: 4.8, bayM: 3.4, stain: true, stone: true,
    wallFor: (face) => (face.zc < 88.5 ? '#eeebe1' : null),
    win: { w: 1.25, h: 2.4, kind: 'rect', groundKind: 'arch', frame: '#33373b', reveal: '#dcc36a', sill: true },
    doors: [{ z: 95.2, w: 1.3, h: 2.6, col: '#33373b', face: 'front' }],
    otherBase: { stain: false },
    others: {
      w1414392113: { wall: '#eeebe1', trim: '#dcc36a', roof: 'slate', plinth: { h: 0.4, col: '#c9b87a' }, floorH: 3.6, bayM: 1.8, win: { w: 0.55, h: 0.9, kind: 'arch', frame: '#33373b', reveal: '#dcc36a', sill: false } },
      w968056900: { hidden: true }, w968056901: { hidden: true }, w1414392111: { hidden: true }, w1414392112: { hidden: true },     // LOD2 placeholders (7.5 m boxes without faces): the bike shelter is in the model
    },
  });
})();
