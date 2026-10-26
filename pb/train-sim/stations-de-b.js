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
  function dbNameBoard(api, k, l, z, name) {
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
    textQuad(b, [k.X(l) - api.sx * 0.05, api.H + 2.45, z], 2.2, 0.55, [-api.sx, 0, 0], [0, 0, api.sx], [0, 1, 0]);
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
  reg('Schweich', {
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
      dbNameBoard(api, f, 3.2, -30, 'Schweich (DB)');
      dbNameBoard(api, f, 3.2, 62, 'Schweich (DB)');
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
})();
