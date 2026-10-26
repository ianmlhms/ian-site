/* Zuchsimulator Lëtzebuerg: painted styles of the real station buildings of the German Mosel stops (TS.stationStyles, station-building.js), same format as
 * stations-styles-lu.js.  Volumes come from the RLP LoD2 model in the station patch; the colours / windows / doors were read from the reference photos in
 * ~/Library/Caches/zuch-refs/<Station>/ (Wikimedia Commons).  Door positions are patch z (ahead = negative); `face`: 'front' = towards the track, 'back' = forecourt. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.stationStyles) return;
  const reg = window.TS.stationStyles.register;
  const BRICK = '#a3664e';

  /* IGEL.  Refs: Commons "Igel, ehemaliges Empfangsgebäude des Bahnhofs 20130704", "Igel, Bahnhof mit ehemaligem Empfangsgebäude 20130704", "Igel, Blick zum ehemaligen
   * Empfangsgebäude ..." (2013).  The old station building (now private) stands behind the platform on the Trier road side: white plastered gable houses with dark slate roofs
   * (gable ends towards the track, 13 m ridge), white window frames, dark brick plinth; the low flat-roofed brick wing towards Wasserbillig-behind (z -85 .. -67) with big
   * multi-pane workshop windows. */
  reg('Igel', {
    wall: '#f8f6f0', trim: '#e9e6dc', plinth: { h: 0.7, col: '#6f4a3c' }, band: null, roof: 'slate', roofTint: '#9096a0', fascia: '#e9e6dc', floorH: 3.0, bayM: 2.9, stain: true,
    wallFor: (face) => (face.zc > -85.4 ? BRICK : null),
    win: { w: 1.0, h: 1.45, kind: 'rect', frame: '#f6f4ee', reveal: '#d9d5c8', sill: true },
    doors: [{ z: -90.0, w: 1.1, h: 2.2, col: '#5b3a2a', face: 'back' }],
    otherBase: { stain: true },
    others: {
      w401465679: { wall: BRICK, roof: 'flat', plinth: { h: 0.6, col: '#6f4a3c' }, floorH: 6.5, bayM: 3.4, win: { w: 1.9, h: 2.5, kind: 'rect', frame: '#f6f4ee', reveal: '#d9d5c8', sill: false } },   // the brick workshop wing (photo 6)
    },
    extras(api) {
      // two brick chimneys on the ridges (photos 5 / 6)
      api.box(-29.6, 14.0, -90.4, 0.9, 2.2, 0.9, '#6b4638');
      api.box(-27.0, 12.8, -100.2, 0.8, 2.0, 0.8, '#6b4638');
    },
  });
  /* TRÉIER WEST.  Refs: Commons "Trier-West, am ehemaligen Bahnhof 20150111", "Trier, Blick zum ehemaligen Bahnhof Trier West 20210701", "Trier-westbahnhof", "Bhf-Trier-West", "Trier-West station
   * 5 April 2025" (new platforms).  The former Empfangsgebäude (1920s, now private) behind the right platform: two joined hipped blocks, warm cream plaster, tall white-framed windows, high
   * dark basalt plinth, steep blue-black slate roofs with pointed dormers; the low annex at the Luxembourg end has the same plaster. */
  const WEST_BLD = { wall: '#f2ebcf', trim: '#f4f0e2', plinth: { h: 1.2, col: '#505256' }, band: null, roof: 'slate', roofTint: '#8c939e', floorH: 3.6, bayM: 2.7, stain: true,
    win: { w: 1.05, h: 2.0, kind: 'rect', frame: '#f6f3ea', reveal: '#dcd3b4', sill: true } };
  reg('Tréier West', Object.assign({}, WEST_BLD, {
    otherBase: { stain: true },
    others: { w137389334: Object.assign({}, WEST_BLD, { floorH: 3.4 }) },
  }));

  /* QUINT.  Refs: Commons "Trier, Haltepunkt Quint 20141101" (upper right), "Haltepunkt Quint".  The derelict old station building above the halt: gable end clad in grey slate with a white-framed window in the
   * dormer / gable, dark steep slate roof, ground-floor windows boarded with plywood, rubble plinth. */
  reg('Quint', {
    wall: '#8a8e93', trim: '#c9cdd0', plinth: { h: 0.9, col: '#6b6a64' }, band: null, roof: 'slate', roofTint: '#9aa0a8', floorH: 3.2, bayM: 3.0, stain: true,
    win: { w: 1.0, h: 1.4, kind: 'rect', frame: '#c2a77a', reveal: '#a98f66', sill: false },
    gableWin: 'round',
  });
})();
