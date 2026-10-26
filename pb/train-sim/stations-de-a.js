/* Zuchsimulator Lëtzebuerg: photo-modelled German stops of the Mosel line (de-a): Igel, Tréier-Zewen, Tréier-Euren, Tréier West, Tréier-Pallien, Tréier Hafestrooss, Ehrang Ort, Quint.
 * Registers into TS.realStations (stations-real.js), built with the kit of stations-lu-b.js.  Where an old station building survives it is the real LoD2 building of the station
 * patch, painted by stations-styles-de.js; this module adds what stands around it (platform furniture, shelters, boards, the second track and platform) at the positions of the
 * patch frame.  Local frame as in lu-b: l = lateral distance from the track centre towards the platform side (negative = far side), z = along the platform (towards -z = ahead),
 * y up (platform top = H).  Patch x = sx * l.  DB furniture: white name boards with a thin grey frame, dark-blue platform number cubes, grey LED masts, glass shelters. */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations || !window.TS.stationKits || !window.TS.stationKits.luB) return;
  const reg = window.TS.realStations.register;
  const makeKit = window.TS.stationKits.luB;
  const GREY_MAST = '#8f969c';
  const DARK_FRAME = '#454c53';
  /* the kit of the OPPOSITE side (argument of the mirrored kit = patch x when the game platform is on the left) */
  const mirrorKit = (api) => makeKit(Object.assign({}, api, { sx: -api.sx, pf: (l) => api.pf(-l) }));

  /* ---- DB furniture ---- */
  /* DB station name board on two grey posts: white board, black letters, thin grey frame (faces the track) */
  function dbNameBoard(api, k, l, z, name) {
    const key = 'dbnm:' + name;
    const { canvasTex, textQuad } = api.helpers;
    const b = api.sets.get(key, () => api.M.sign('lub:' + key, canvasTex('lub:' + key, 512, 128, (c, w, h) => {
      c.fillStyle = '#9aa0a5'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f4f4f0'; c.fillRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#141517';
      let size = 74; c.font = '600 ' + size + 'px Arial';
      while (c.measureText(name).width > w - 50 && size > 26) { size -= 4; c.font = '600 ' + size + 'px Arial'; }
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, w / 2, h / 2 + 3);
    }, { clampU: true, clampV: true })));
    textQuad(b, [k.X(l) - api.sx * 0.05, api.H + 2.15, z], 2.4, 0.6, [-api.sx, 0, 0], [0, 0, api.sx], [0, 1, 0]);
    [-1.15, 1.15].forEach((dz) => k.vc.box(k.X(l), api.H + 1.1, z + dz, 0.08, 2.2, 0.08, api.col(GREY_MAST)));
  }
  /* DB passenger-information column: slim dark-grey post with a lit display */
  function dbStele(api, k, l, z) {
    const b = api.sets.get('dbstele', () => api.mat('db:stele', () => new api.T.MeshStandardMaterial({ color: 0x24303d, emissive: new api.T.Color(0x16222f), emissiveIntensity: 0.9, roughness: 0.3, vertexColors: true })));
    k.vc.box(k.X(l), api.H + 1.1, z, 0.35, 2.2, 0.35, api.col('#3d444b'));
    b.box(k.X(l) - api.sx * 0.19, api.H + 1.55, z, 0.03, 0.9, 0.3, api.WHITE);
  }
  /* DB LED mast: grey, slim, one arm over the platform */
  const dbMast = (k, l, z, h = 6.2) => k.lamp(l, z, GREY_MAST, h);

  /* ================================================================ IGEL
   * Refs: ~/Library/Caches/zuch-refs/Igel (Commons: Igel 20130704 (3 photos of the old station building), Bahnhof Igel (CFL KISS at the platform), Igel Bf 1994, "Igel during rail works
   * in July 2014", Igel BW 2011).  Two tracks (game track x 0, second track x ~4.5) with a short side platform on the LEFT of the game track (patch x -4.1 .. -1.4, z -58 .. 92) and a
   * platform on the far side (x 6.1 .. ~10, z -92 .. -25) that is part of the island towards a third track at x ~15.  The old station building (white gable houses, slate roofs, brick wing)
   * stands 20 m behind the left platform at z -116 .. -67 beside the Trierer Strasse; a blue-roofed glass waiting shelter and the ticket machine stand in front of it on the platform. */
  const IG = { far: { edge: 6.1, width: 4.2, z0: -92, z1: -25 }, track: 4.5, third: 15.0 };
  reg('Igel', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      const toward = (x) => -x * sx;
      // our platform (left): glass shelter in front of the building, DB ticket machine, name boards, number cube, info column, masts, railing along the back
      k.glassShelter(lB - 2.4, -80, 5.0, 2.0, '#6d7780', '#4e6f8f');
      k.vc.box(k.X(lB - 0.5), H + 1.0, -71.3, 0.5, 2.0, 0.6, col('#394650'));
      k.sign(edge + 0.9, -12, '1', 'blue');
      dbStele(api, k, lB - 0.7, -62);
      [-50, -22, 8, 38, 68].forEach((z) => dbMast(k, lB - 0.4, z));
      k.bench(lB - 0.7, -30, '#4a4f55');
      k.bin(lB - 0.6, -2, '#3b4046');
      // the second track, the far platform with its shelter, the third track on the far side
      k.track(sx * IG.track, -135, 135, { pole: true });
      k.platformBox(sx * IG.far.edge, IG.far.width, -1, IG.far.z0, IG.far.z1);
      f.glassShelter(toward(8.2), -74.7, 4.2, 1.8, '#6d7780', '#4e6f8f');
      f.sign(toward(6.8), -45, '2', 'blue');
      dbNameBoard(api, f, toward(6.9), -40, 'Igel');
      [-85, -58, -32].forEach((z) => dbMast(f, toward(9.6), z));
      f.bench(toward(9.6), -60, '#4a4f55');
      k.track(sx * IG.third, -135, 135, { pole: true });
    },
  });
  /* ================================================================ TRÉIER-ZEWEN (reopened Dec 2024 on the Weststrecke)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Zewen (Commons: Haltepunkt Trier-Zewen / 2, "DB AG Class 1440 EMU at Haltepunkt Trier-Zewen" 24 May 2025, Trierer Weststrecke at Zewen 2024).  No
   * station building.  Two tracks (game track x 0, second track x 4.0) cross the Hermeskeiler Strasse level crossing at z ~0; staggered low concrete platforms: Gleis 1 on the LEFT behind
   * the crossing (patch x -4.0 .. -1.0, z 23 .. 193), Gleis 2 on the right beyond it (x 6.6 .. 9.9, z -193 .. -22) with a small dark glass shelter, a display case, a red/white "2" sign and
   * grey LED masts; the crossing end of the platforms is closed by a concrete wall.  Beside the crossing: the shop at x -14 .. -5.5 (z -30 .. -11), a cream apartment block behind the far platform. */
  const ZE = { far: { edge: 6.6, width: 3.3, z0: -193, z1: -22 }, track: 4.0 };
  const MODERN = { frame: '#3b4249', roof: '#2f353b' };
  reg('Tréier-Zewen', {
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const f = mirrorKit(api);
      const lB = edge + W;
      const toward = (x) => -x * sx;
      // Gleis 1 (our platform, behind the crossing)
      k.glassShelter(lB - 2.3, 62, 4.0, 1.9, MODERN.frame, MODERN.roof);
      dbStele(api, k, lB - 0.7, 38);
      dbStele(api, k, lB - 0.7, 150);
      k.sign(edge + 0.9, 100, '1', 'blue');
      [34, 74, 114, 154].forEach((z) => dbMast(k, lB - 0.4, z));
      k.bench(lB - 0.7, 92, '#4a4f55');
      k.bin(lB - 0.6, 45, '#3b4046');
      // second track, Gleis 2 beyond the crossing with the dark glass shelter at its crossing end
      k.track(sx * ZE.track, -135, 135, { pole: true });
      k.platformBox(sx * ZE.far.edge, ZE.far.width, -1, ZE.far.z0, ZE.far.z1);
      k.vc.box(k.X(sx * 8.2), H + 0.5, -22.4, 3.3, 1.0, 0.5, col('#9c9e9b'));
      f.glassShelter(toward(8.3), -38, 3.6, 1.7, MODERN.frame, MODERN.roof);
      f.sign(toward(7.4), -26, '2', 'blue');
      dbNameBoard(api, f, toward(7.6), -90, 'Zewen');
      dbStele(api, f, toward(9.2), -60);
      [-45, -85, -125, -165].forEach((z) => dbMast(f, toward(9.4), z));
      f.bench(toward(9.4), -100, '#4a4f55');
    },
  });
})();
