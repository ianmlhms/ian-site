/* Kart Lëtzebuerg — track index. Holds the centre-line geometry of every track (small: a few waypoints each), which is all the menu needs for
 * the previews. The heavy parts (OSM street data, landmarks, scenery code) live in tracks-<id>.js / data-<id>.js and are loaded on demand by
 * KL.ensureTrack(id) when a race on that track starts. KL.registerTrack() in those files merges into the entry defined here. */
(function () {
  'use strict';
  const KL = window.KL;
  KL.tracks = KL.tracks || {};
  const T = (id, geo, weathers, files) => { KL.tracks[id] = Object.assign({ id, theme: { weathers }, files, loaded: false }, geo); };

  T('villehaute', { hw: 9, r: 26, pts: [
    [-232, 100, { r: 34, hw: 10 }], [-120, 104, { hw: 11 }], [-62, 106, { r: 16 }], [-37, 122, { r: 12 }], [-31, 148, { r: 16 }], [-10, 164, { r: 20 }], [14, 148, { r: 16 }], [18, 122, { r: 12 }], [40, 106, { r: 16 }], [61, 104, { r: 18 }],
    [62, 56, { r: 20 }], [190, 45, { r: 34 }], [162, -24, { r: 46 }], [50, -24, { r: 30 }], [56, -78, { r: 24 }], [12, -66, { r: 30 }],
    [-100, -52, { r: 16 }], [-101, -181, { r: 24 }], [-196, -191, { r: 24 }], [-187, -38, { r: 12 }], [-232, -30, { r: 30 }], [-232, 50],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-villehaute.js', 1], ['tracks-villehaute.js', 4]]);

  T('kirchberg', { hw: 9, r: 30, wl: 2.4, wr: 2.4, pts: [
    [-430, 105], [-300, 81], [-190, 60], [-135, 49, { r: 30 }],
    [-92, 52, { r: 24, wr: 16 }], [-70, 86, { r: 26, wr: 16 }], [-80, 140, { r: 26, wr: 16 }], [-124, 174, { r: 26, wr: 12 }],
    [-185, 184, { r: 30 }], [-245, 206, { r: 30 }], [-320, 192, { r: 34 }], [-400, 170, { r: 36 }], [-470, 160, { r: 30 }],
    [-540, 158, { hw: 8, wl: 2.2, wr: 2.2 }], [-640, 181, { hw: 8, wl: 2.2, wr: 2.2 }], [-731, 202, { hw: 8, wl: 2.2, wr: 2.2 }],
    [-775, 212, { hw: 9, wl: 4, wr: 4 }], [-795, 217, { r: 34, hw: 10, wl: 5, wr: 15 }], [-822, 188, { r: 34, hw: 10, wl: 5, wr: 15 }], [-810, 150, { r: 34, hw: 10, wl: 5, wr: 15 }], [-770, 152, { hw: 9, wl: 4, wr: 4 }], [-733, 160, { hw: 8, wl: 2.2, wr: 2.2 }],
    [-640, 142, { hw: 8, wl: 2.2, wr: 2.2 }], [-511, 117, { hw: 8, wl: 2.2, wr: 2.2 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-kirchberg.js', 1], ['tracks-kirchberg.js', 1]]);

  T('grund', { hw: 7, r: 22, wl: 2.6, wr: 2.6, pts: [
    [-218, -30, { y: 0 }], [-224, 70, { y: 0 }], [-221, 118, { y: 0, r: 20 }],
    [-195, 136, { y: -1 }], [-140, 136, { y: -6, r: 16 }], [-140, 176, { y: -11, r: 16 }], [-212, 176, { y: -20, r: 16 }], [-212, 216, { y: -27, r: 16 }], [-150, 216, { y: -36 }],
    [-100, 216, { y: -38, r: 22 }], [-70, 190, { y: -38, r: 30 }], [-70, 130, { y: -38 }], [-86, 62, { y: -38, r: 18 }], [-78, -10, { y: -38, r: 20 }], [-40, -72, { y: -38, r: 26 }], [22, -98, { y: -38, r: 26 }], [76, -118, { y: -38, r: 22, wl: 30 }],
    [68, -150, { y: -38, r: 20, wl: 30 }], [30, -178, { y: -35, r: 25 }], [-30, -196, { y: -26, r: 26 }], [-92, -170, { y: -13, r: 30 }], [-150, -140, { y: -2, r: 30 }], [-208, -100, { y: 0, r: 30 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-grund.js', 1], ['tracks-grund.js', 1]]);

  T('belval', { hw: 11, r: 30, pts: [
    [150, 119, { hw: 12 }], [262, 164, { hw: 13 }], [301, 180, { hw: 13, wl: 24 }], [352, 200, { r: 34, hw: 13, wl: 24 }], [368, 142, { hw: 13, wl: 24 }], [392, 70, { hw: 12 }],
    [446, -150, { r: 40 }], [300, -197, { hw: 11 }], [200, -230, { hw: 10, wl: 20 }], [118, -250, { r: 34, hw: 10, wl: 20 }], [110, -215, { hw: 10, wl: 20 }], [90, -150, { hw: 11 }], [20, 96, { r: 28 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-belval.js', 1], ['tracks-belval.js', 1]]);

  T('geeschterschlass', { hw: 9, r: 30, wl: 2.6, wr: 2.6, pts: [[-30, 0, { y: 0, hw: 11, r: 30 }], [160, -6, { y: 0, r: 40 }], [270, 50, { y: 1, r: 60 }], [285, 150, { y: 2, r: 30 }], [222, 186, { y: 3, r: 14 }], [276, 238, { y: 3.5, r: 14 }], [270, 330, { y: 4, r: 40 }], [180, 362, { y: 5, r: 22 }], [60, 346, { y: 7, r: 30 }], [40, 262, { y: 9, r: 16 }], [-60, 232, { y: 11, r: 16 }], [-130, 170, { y: 11, r: 30 }], [-120, 90, { y: 9, r: 30 }], [-70, 30, { y: 5, r: 30 }]],
  }, ['night', 'fog', 'sunset', 'rain'], [['tracks-geeschterschlass.js', 2]]);


  /* ---- Fantasy Cup (stage 2b): Zockerland (candy), Äisbierg (ice mountain), Vulkanbierg (volcano) ---- */
  T('zockerland', { hw: 10, r: 30, wl: 2.6, wr: 2.6, pts: [
    [-80, 0, { hw: 11 }], [170, 0, { r: 50, hw: 11 }], [268, 44, { r: 40, bank: -0.09, y: 0.5, wr: 18 }], [292, 135, { r: 34, bank: -0.09, y: 2, wr: 42 }], [245, 205, { r: 30, y: 4, wr: 30 }], [165, 195, { r: 24, y: 5 }], [130, 245, { r: 26, y: 6 }],
    [45, 258, { r: 28, y: 5 }], [-50, 222, { r: 32, y: 3 }], [-62, 152, { r: 26, y: 2 }], [-140, 132, { r: 30, y: 4 }], [-215, 160, { r: 32, y: 6 }], [-290, 95, { r: 34, y: 3 }], [-262, 8, { r: 34, y: 0.5 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['tracks-zockerland.js', 1]]);

  T('aisbierg', { hw: 10, r: 28, wl: 2.8, wr: 2.8, pts: [
    [-55, 0, { y: 0, hw: 11 }], [138, -9, { y: 0.5, r: 40, hw: 11 }], [241, -74, { y: 4, r: 32 }], [278, -175, { y: 9, r: 30 }], [213, -269, { y: 14, r: 24 }], [103, -278, { y: 17, r: 20 }], [57, -213, { y: 20, r: 22 }],
    [-28, -232, { y: 23, r: 22, wl: 12 }], [-112, -305, { y: 27, r: 24, wl: 44 }], [-195, -250, { y: 25, r: 26, wl: 44 }], [-232, -158, { y: 19, r: 28 }], [-177, -94, { y: 13, r: 26 }], [-232, -39, { y: 8, r: 26 }], [-158, 26, { y: 3, r: 30 }],
  ] }, ['day', 'sunset', 'night', 'snow'], [['tracks-aisbierg.js', 1]]);

  T('vulkan', { hw: 10, r: 30, wl: 2.8, wr: 2.8, pts: [
    [189, -25, { y: 0, r: 27 }],
    [197, 82, { y: 0, r: 36 }],
    [139, 160, { y: 1, r: 27 }],
    [49, 184, { y: 1, r: 23 }],
    [-57, 176, { y: 3, r: 23 }],
    [-131, 189, { y: 6, r: 18 }],
    [-193, 131, { y: 10, r: 20 }],
    [-205, 33, { y: 14, r: 23 }],
    [-156, -25, { y: 18, r: 14, wl: 20 }],
    [-98, -8, { y: 19, r: 16, wl: 34 }],
    [-74, -74, { y: 20, r: 18, wl: 30 }],
    [-123, -139, { y: 21, r: 20 }],
    [-49, -176, { y: 20, r: 23 }],
    [49, -164, { y: 16, r: 25 }],
    [123, -123, { y: 11, r: 27 }],
    [189, -82, { y: 5, r: 32 }],
  ] }, ['day', 'sunset', 'night', 'fog'], [['tracks-vulkan.js', 1]]);

  /* registers the full definition (called by tracks-<id>.js): merged into the index entry, theme merged key by key */
  KL.registerTrack = (def) => {
    const cur = KL.tracks[def.id] || {};
    const theme = Object.assign({}, cur.theme, def.theme);
    KL.tracks[def.id] = Object.assign({}, cur, def, { theme, loaded: true });
  };

  /* load the scripts of a track once; resolves with the full definition */
  const pending = {};
  KL.ensureTrack = (id) => {
    const d = KL.tracks[id];
    if (!d) return Promise.reject(new Error('unknown track ' + id));
    if (d.loaded) return Promise.resolve(d);
    if (pending[id]) return pending[id];
    const load = (f) => new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = '/pb/kart-letzebuerg/' + f[0] + '?v=' + f[1]; s.async = false;
      s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + f[0]));
      document.head.appendChild(s);
    });
    pending[id] = d.files.reduce((p, f) => p.then(() => load(f)), Promise.resolve()).then(() => { if (!KL.tracks[id].loaded) throw new Error('track script did not register ' + id); return KL.tracks[id]; }).catch((e) => { delete pending[id]; throw e; });
    return pending[id];
  };
})();
