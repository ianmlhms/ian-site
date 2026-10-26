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
  reg('Igel', { physical: true,
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
  /* ---- the reopened Weststrecke stops (2024/25): low concrete platforms, dark glass shelters, DB info columns, grey LED masts ----
   * cfg.near  = furniture of OUR platform (game side): { shelters: [z], steles: [z], masts: [z], bench: [z], bin: [z], sign: 'label' | null, signZ }
   * cfg.far   = { track: patch x of the second track, edge, width, z0, z1, name: board text | null, ...same lists (z), shelterX: patch x of the shelter's track-side wall, mastX, steleX }
   * cfg.tracks = patch x of further visual tracks; cfg.wall: [x, z, w] concrete end wall of the far platform */
  const MODERN = { frame: '#3b4249', roof: '#2f353b' };
  function simpleStop(api, cfg) {
    const look = cfg.look || MODERN;
    const { sx, H, W, edge, col } = api;
    const k = makeKit(api);
    const f = mirrorKit(api);
    const toward = (x) => -x * sx;
    const n = cfg.near || {};
    const lB = n.l !== undefined ? n.l + 0.4 : edge + W;            // n.l: lateral line of the furniture (island platforms: the centre line)
    (n.shelters || []).forEach((z) => k.glassShelter(lB - 2.3, z, 4.0, 1.9, look.frame, look.roof));
    (n.steles || []).forEach((z) => dbStele(api, k, lB - 0.7, z));
    (n.masts || []).forEach((z) => dbMast(k, lB - 0.4, z));
    (n.bench || []).forEach((z) => k.bench(lB - 0.7, z, '#4a4f55'));
    (n.bin || []).forEach((z) => k.bin(lB - 0.6, z, '#3b4046'));
    if (n.sign) k.sign(edge + 0.9, n.signZ || 0, n.sign, 'blue');
    const fr = cfg.far;
    (cfg.tracks || []).forEach((x) => k.track(sx * x, -135, 135, { pole: true }));
    if (!fr) return;
    if (fr.track !== undefined) k.track(sx * fr.track, -135, 135, { pole: true });
    k.platformBox(sx * fr.edge, fr.width, -1, fr.z0, fr.z1);
    const out = (d) => fr.edge - sx * d;                  // patch x of a point d metres behind the far platform edge (away from the tracks)
    const sh = fr.shelterX !== undefined ? fr.shelterX : out(1.7);
    (fr.shelters || []).forEach((z) => f.glassShelter(toward(sh), z, 3.8, 1.7, look.frame, look.roof));
    (fr.steles || []).forEach((z) => dbStele(api, f, toward(out(fr.width - 0.7)), z));
    (fr.masts || []).forEach((z) => dbMast(f, toward(out(fr.width - 0.4)), z));
    (fr.bench || []).forEach((z) => f.bench(toward(out(fr.width - 0.7)), z, '#4a4f55'));
    (fr.bin || []).forEach((z) => f.bin(toward(out(fr.width - 0.6)), z, '#3b4046'));
    if (fr.sign) f.sign(toward(out(0.9)), fr.signZ || 0, fr.sign, 'blue');
    if (fr.name) dbNameBoard(api, f, toward(out(1.0)), fr.nameZ || 0, fr.name);
    if (cfg.extra) cfg.extra({ api, k, f, toward });
    if (cfg.wall) k.vc.box(k.X(sx * cfg.wall[0]), H + 0.5, cfg.wall[1], cfg.wall[2], 1.0, 0.5, col('#9c9e9b'));
  }

  /* ================================================================ TRÉIER-ZEWEN (reopened Dec 2024 on the Weststrecke)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Zewen (Commons: Haltepunkt Trier-Zewen / 2, "DB AG Class 1440 EMU at Haltepunkt Trier-Zewen" 24 May 2025, Trierer Weststrecke at Zewen 2024).  No
   * station building.  Two tracks (game track x 0, second track x 4.0) cross the Hermeskeiler Strasse level crossing at z ~0; staggered low concrete platforms: Gleis 1 on the LEFT behind
   * the crossing (patch x -4.0 .. -1.0, z 23 .. 193), Gleis 2 on the right beyond it (x 6.6 .. 9.9, z -193 .. -22) with a small dark glass shelter, a display case, a red/white "2" sign and
   * grey LED masts; the crossing end of the platforms is closed by a concrete wall.  Beside the crossing: the shop at x -14 .. -5.5 (z -30 .. -11), a cream apartment block behind the far platform. */
  reg('Tréier-Zewen', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      simpleStop(api, {
        near: { shelters: [62], steles: [38, 150], masts: [34, 74, 114, 154], bench: [92], bin: [45], sign: '1', signZ: 100 },
        far: { track: 4.0, edge: 6.6, width: 3.3, z0: -193, z1: -22, shelters: [-38], steles: [-60], masts: [-45, -85, -125, -165], bench: [-100], sign: '2', signZ: -26, name: 'Zewen', nameZ: -90 },
        wall: [8.2, -22.4, 3.3],
      });
    },
  });

  /* ================================================================ TRÉIER-EUREN (reopened Dec 2024 on the Weststrecke)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Euren (Commons: "Construction at Haltepunkt Trier-Euren station" 3 Sep 2024 looking north / south, Haltepunkt Euren 2009).  Only construction photos
   * (the finished stop has none on Commons): the same staggered pair of low concrete platforms as Zewen around a level crossing at z ~0, i.e. Gleis 1 on the LEFT behind the crossing
   * (patch x -3.8 .. -1.2, z 20 .. 191) and Gleis 2 on the right beyond it (x 5.3 .. 8.3, z -191 .. -20); second track at x 4.0.  Furniture follows the Zewen / Pallien photos (DB standard):
   * no reference photo of the finished stop. */
  reg('Tréier-Euren', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      simpleStop(api, {
        near: { shelters: [60], steles: [36, 150], masts: [34, 74, 114, 154], bench: [90], bin: [44], sign: '1', signZ: 100 },
        far: { track: 4.0, edge: 5.3, width: 3.0, z0: -191, z1: -20, shelters: [-36], steles: [-58], masts: [-44, -84, -124, -164], bench: [-100], sign: '2', signZ: -26, name: 'Euren', nameZ: -90 },
        wall: [6.8, -20.4, 3.0],
      });
    },
  });

  /* ================================================================ TRÉIER WEST (new stop since 2025, next to the old Empfangsgebäude)
   * Refs: ~/Library/Caches/zuch-refs/Trier-West (Commons: "Trier-West station, Germany, on 5 April 2025", "Trier, Baustelle des Bahnhaltepunkts Trier West 20241109", Trier-West am ehemaligen Bahnhof 2015,
   * Blick zum ehemaligen Bahnhof 2021, Trier-westbahnhof, Bhf-Trier-West; old b/w photos ignored).  Three tracks (game track x 0 at the RIGHT platform, the through track x -5.5, the left platform track
   * x -9.8) between two long side platforms of pale concrete (patch x 1.4 .. 4.2 and x -14.2 .. -11.4, z -85 .. 85) with ramps / steps at z ~17 and short glass shelters at z 15 / 32; the old two-block station
   * building (patch x 8 .. 22, z -62 .. -22, LoD2 + style) stands behind the right platform. */
  reg('Tréier West', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      simpleStop(api, {
        near: { shelters: [15, 32], steles: [-8, 52], masts: [-60, -25, 10, 45, 80], bench: [-40], bin: [-15] },
        tracks: [-5.5],
        far: { track: -9.8, edge: -11.4, width: 2.8, z0: -85, z1: 85, shelters: [15, 32], shelterX: -12.6, steles: [-8, 52], masts: [-60, -25, 10, 45, 80], bench: [-40], name: 'Trier West', nameZ: -35 },
      });
    },
  });

  /* ================================================================ TRÉIER-PALLIEN (reopened Dec 2024 on the Weststrecke, between the Mosel and the Maximinerstrasse)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Pallien (Commons: "Two CFL Class 2300 at Haltepunkt Trier-Pallien, 24 March 2025", "Construction of the Haltepunkt Trier-Pallien 31 March 2024", "Trier, Baustelle des
   * Bahnhaltepunkts Trier Pallien 20241109").  Two tracks (game track x 0, second track x 3.6) squeezed between the road on the LEFT and the river path on the right.  The game platform is the narrow
   * road-side strip (patch x -3.3 .. -1.4, white railing towards the road); the river-side platform (patch x 5.7 .. ~9.7, wider than the OSM polygon, photos show ~4 m) carries the white flat-roofed
   * shelter with ticket machine and display case, white railings.  Light-grey LED masts, DB info columns; no station building. */
  reg('Tréier-Pallien', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      simpleStop(api, {
        look: { frame: '#b9bec2', roof: '#e9ecee' },
        near: { shelters: [], steles: [-30, 60], masts: [-60, -20, 25, 65], bench: [-8], bin: [38] },
        far: { track: 3.6, edge: 5.7, width: 4.0, z0: -87, z1: 82, shelters: [18], shelterX: 7.6, steles: [-40, 30], masts: [-65, -25, 20, 60], bench: [-12], name: 'Pallien', nameZ: -10 },
      });
    },
  });

  /* ================================================================ TRÉIER HAFESTROOSS (Trier-Hafenstrasse, new stop since Feb 2025 in the freight yard area)
   * Refs: ~/Library/Caches/zuch-refs/Trier-Hafenstrasse (Commons: "The first train rolls into Haltepunkt Trier-Hafenstraße" 26 Feb 2025, "Station sign of Haltepunkt Trier-Hafenstraße", construction photos
   * 2024).  Dark-grey concrete-paver platforms with a light tactile strip, tall maroon noise-barrier walls beside the tracks, and a perforated corten-steel (rust brown) entrance hall with the lift
   * block ("Ausgang" sign) on the platform; no station building.  The patch has a wide left platform (x -9.7 .. -2.3, z -91 .. 95: island towards a track at x ~ -11.5) and a right platform (x 5.7 .. 8.2,
   * z -95 .. 89) beside a track at x ~4; the OSM yard tracks are 35 m and further to the right (Trier freight yard, from the patch).  The photos do not show which side the hall belongs to
   * (see report); it is placed on the right platform. */
  const CORTEN = '#8b4a2b';
  const NOISE_WALL = '#85403c';
  function noiseWall(k, api, x, z0, z1) {
    k.vc.box(k.X(api.sx * x), api.FORM_Y + 1.7, (z0 + z1) / 2, 0.25, 3.4, z1 - z0, api.col(NOISE_WALL));
  }
  reg('Tréier Hafestrooss', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, col } = api;
      simpleStop(api, {
        near: { shelters: [-75, -90], steles: [-50, 40], masts: [-85, -50, -15, 20, 55, 85], bench: [-30], bin: [10] },
        tracks: [-11.5],
        far: { track: 4.0, edge: 5.7, width: 2.5, z0: -95, z1: 89, shelters: [-75, -90], steles: [-50, 40], masts: [-80, -45, -10, 25, 60], bench: [-30], name: 'Hafenstraße', nameZ: 20, sign: '2', signZ: 55 },
        extra({ k, f, toward }) {
          noiseWall(k, api, -14.3, -100, 100);
          noiseWall(k, api, 12.4, -100, 100);
          // corten-steel entrance hall on the right platform: roof slab, back wall and the lift block with its "Ausgang" board
          const hx = 7.2; const hz = -18;
          k.vc.box(k.X(sx * hx), H + 3.2, hz, 2.6, 0.2, 9.0, col(CORTEN));
          k.vc.box(k.X(sx * (hx + 1.15)), H + 1.6, hz, 0.2, 3.2, 9.0, col(CORTEN));
          [-4.4, 4.4].forEach((d) => k.vc.box(k.X(sx * hx), H + 1.6, hz + d, 2.6, 3.2, 0.2, col(CORTEN)));
          k.vc.box(k.X(sx * 7.0), H + 1.6, hz + 7.6, 2.0, 3.2, 2.6, col('#a15a31'));
          k.vc.box(k.X(sx * 5.95), H + 2.7, hz + 7.6, 0.06, 0.5, 1.5, col('#1d3f8c'));
        },
      });
    },
  });

  /* ================================================================ EHRANG ORT
   * NO reference photo: Commons has no picture of the stop (only of Ehrang Bahnhof, a different station with the big red sandstone building, which is NOT at this stop; those were removed from the refs).
   * Built from the patch only: staggered side platforms like Zewen (left one behind the middle at x -8.3 .. -1.8, z 13 .. 153, with the OSM shelter + ticket machine at z ~48; right one beyond it
   * at x 6.2 .. 9.2, z -153 .. -12, shelter at z -50, widening to x 11.8 at the stair), second track x 4.0; no station building; DB standard furniture (pale concrete platforms, glass shelters,
   * LED masts, info columns). */
  reg('Ehrang Ort', { physical: true,
    canopy: false,
    furniture: false,
    build(api) {
      const { sx, H, col } = api;
      simpleStop(api, {
        look: { frame: '#5a6168', roof: '#6d747b' },
        near: { shelters: [50], steles: [30, 100], masts: [25, 60, 95, 130], bench: [75], bin: [38] },
        far: { track: 4.0, edge: 6.2, width: 3.0, z0: -153, z1: -12, shelters: [-50], steles: [-30, -100], masts: [-130, -95, -60, -25], bench: [-75], name: 'Ehrang Ort', nameZ: -85 },
        extra({ k }) { k.vc.box(k.X(sx * -7.0), H + 1.0, 46.8, 0.5, 2.0, 0.6, col('#394650')); },
      });
    },
  });

  /* ================================================================ QUINT
   * Refs: ~/Library/Caches/zuch-refs/Quint (Commons: "Trier, Haltepunkt Quint 20141101", "Haltepunkt Quint").  A small old halt in a wooded valley: ISLAND platform of grey slabs with a white edge line between the game
   * track (x 0) and the second track (x ~9.6) (patch x 1.3 .. 9.1, z -78 .. 78), tall white LED masts and blue "1 | 2" platform cubes on the centre line, a small shelter, a steel stair with railings at the end
   * of the platform up to the road; behind the slope (patch x 22 .. 35, z 22 .. 46) the derelict old station building: slate-clad gable with a dormer window, boarded windows, slate roof. */
  reg('Quint', { physical: true,
    canopy: false,
    furniture: false,
    fence: false,
    build(api) {
      const { sx, H, W, edge, col } = api;
      const k = makeKit(api);
      const lC = edge + W / 2;
      simpleStop(api, {
        look: { frame: '#cfd3d6', roof: '#e1e4e6' },
        near: { l: lC, shelters: [], steles: [-45, 30], masts: [-60, -30, 0, 30, 60], bench: [-12], bin: [14] },
        tracks: [9.6],
      });
      // blue platform cubes "1 | 2" on the centre line (photo 0) and the steel stair at the Trier end of the island
      k.sign(lC, 0, '1', 'blue');
      k.sign(lC + 0.35, 0, '2', 'blue');
      [-1.2, 1.2].forEach((d) => k.vc.box(k.X(lC + d), H + 0.5, 74, 0.06, 1.0, 5.0, col('#8d949a')));
      k.vc.box(k.X(lC), H + 0.05, 74, 2.2, 0.1, 5.0, col('#6f757a'));
    },
  });
})();
