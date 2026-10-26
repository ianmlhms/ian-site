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
})();
