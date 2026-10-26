/* Zuchsimulator Lëtzebuerg: painted styles of the real station buildings of the German Mosel stops, part b (Schweich, Wittlich, Föhren, Hetzerath, Sehlem, Salmtal, Tréier Hbf ...),
 * same format as stations-styles-lu.js (TS.stationStyles, station-building.js).  Volumes come from the RLP LoD2 model in the station patch; the colours / windows / doors were read from the
 * reference photos in ~/Library/Caches/zuch-refs/<Station>/ (Wikimedia Commons).  Door positions are patch z (ahead = negative); `face`: 'front' = towards the track, 'back' = forecourt. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.stationStyles) return;
  const reg = window.TS.stationStyles.register;

  /* SCHWEICH.  Refs: Commons "Bahnhof Schweich DB 20160826", "Schweich, ehemalige Bahngebäude 20160826", "Video-Reisezentrum - Deutsche Bahn - Schweich".  The old station building behind the
   * house platform: cream plastered walls, dark concrete-tile gable roofs, dark-grey window frames, the platform-end gable painted red (video travel centre mural); low blue-painted wing with
   * graffiti towards the platform start. */
  reg('Schweich', {
    wall: '#efe8d3', trim: '#e3dcc6', plinth: { h: 0.5, col: '#9a958a' }, band: null, roof: 'tile', roofTint: '#6d6a68', fascia: '#e7e2d2', floorH: 3.2, bayM: 3.4, stain: true,
    wallFor: (face) => (face.kind === 'end' && face.nz > 0.5 ? '#c7252c' : null),
    win: { w: 1.1, h: 1.9, kind: 'rect', frame: '#394047', reveal: '#d7d0ba', sill: true },
    doors: [{ z: 70.5, w: 1.0, h: 2.2, col: '#8f969c', glass: false, face: 'front' }],
    otherBase: { stain: true },
    others: {
      DERPLP1400003aea: { wall: '#efe8d3', roof: 'tile', roofTint: '#6d6a68', plinth: { h: 0.5, col: '#9a958a' }, floorH: 3.4, bayM: 3.6, win: { w: 1.0, h: 1.6, kind: 'rect', frame: '#394047', reveal: '#d7d0ba', sill: true } },
      DERPLP1400003aff: { wall: '#3d6a97', roof: 'tile', roofTint: '#6d6a68', plinth: { h: 0.4, col: '#6f7378' }, floorH: 3.6, bayM: 3.2, win: { w: 1.4, h: 1.5, kind: 'rect', frame: '#2c3338', reveal: '#2f5278', sill: false } },
      DERPLP1400003afg: { wall: '#3d6a97', roof: 'flat', plinth: { h: 0.4, col: '#6f7378' }, floorH: 3.6, bayM: 3.2, noWindows: true },
    },
  });
})();
