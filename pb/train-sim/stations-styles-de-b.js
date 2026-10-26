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

  /* WITTLICH (Hbf).  Refs: Commons "Wittlich Hauptbahnhof Nord/Süd/2016 a-d", "20241015-Wittlich Hbf-01/-02", "Bahnhof Wittlich Empfangsgebäude Gleise Bahnsteige".  Two-storey 1950s station building:
   * orange plaster (repainted since 2016), dark-brown hip roof with small dormers, white window frames, big ground-floor windows, a lean-to canopy over the entrance; the low parts (eave < 4.6 m) are cream plastered single-storey wings (parcel station, waiting hall) and a small cream shed with a red door behind the platform. */
  const CREAM = '#e8e3d3';
  reg('Wittlich', {
    wall: '#dd8541', trim: '#efe9dc', plinth: { h: 0.6, col: '#b0aca1' }, band: null, roof: 'tile', roofTint: '#6b5d54', fascia: '#efe9dc', floorH: 2.8, bayM: 2.9, stain: true,
    wallFor: (face) => (face.eave < 4.6 ? CREAM : null),
    win: { w: 1.1, h: 1.6, kind: 'rect', frame: '#f6f4ee', reveal: '#cfc5ae', sill: true },
    doors: [
      { z: 2.0, w: 1.7, h: 2.4, col: '#e8e6e0', glass: true, face: 'front' }, { z: -2.5, w: 1.1, h: 2.3, col: '#6a6d70', face: 'front' },
      { z: 2.0, w: 1.7, h: 2.4, col: '#e8e6e0', glass: true, face: 'back' }, { z: 14.0, w: 1.1, h: 2.3, col: '#6a6d70', face: 'back' },
    ],
    otherBase: { stain: true },
    others: {
      w267055347: { wall: CREAM, roof: 'tile', roofTint: '#6b5d54', plinth: { h: 0.4, col: '#a6a297' }, floorH: 3.2, bayM: 4.0, win: { w: 0.9, h: 1.2, kind: 'rect', frame: '#f6f4ee', reveal: '#cfc5ae', sill: false }, doors: [{ z: 65.5, w: 1.2, h: 2.1, col: '#7b2a26', face: 'front' }] },
    },
  });
})();
