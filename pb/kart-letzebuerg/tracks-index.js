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

  T('belval', { hw: 11, r: 30, pts: [
    [150, 119, { hw: 12 }], [262, 164, { hw: 13 }], [301, 180, { hw: 13, wl: 24 }], [352, 200, { r: 34, hw: 13, wl: 24 }], [368, 142, { hw: 13, wl: 24 }], [392, 70, { hw: 12 }],
    [446, -150, { r: 40 }], [300, -197, { hw: 11 }], [200, -230, { hw: 10, wl: 20 }], [118, -250, { r: 34, hw: 10, wl: 20 }], [110, -215, { hw: 10, wl: 20 }], [90, -150, { hw: 11 }], [20, 96, { r: 28 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-belval.js', 1], ['tracks-belval.js', 1]]);

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
    [-100, 216, { y: -38, r: 22 }], [-70, 190, { y: -38, r: 30 }], [-70, 130, { y: -38 }], [-86, 62, { y: -38, r: 18 }], [-78, -10, { y: -38, r: 20 }], [-40, -72, { y: -38, r: 26 }], [22, -98, { y: -38, r: 26 }], [76, -118, { y: -38, r: 22 }],
    [68, -150, { y: -38, r: 20 }], [30, -178, { y: -35, r: 25 }], [-30, -196, { y: -26, r: 26 }], [-92, -170, { y: -13, r: 30 }], [-150, -140, { y: -2, r: 30 }], [-208, -100, { y: 0, r: 30 }],
  ] }, ['day', 'sunset', 'night', 'rain'], [['data-grund.js', 1], ['tracks-grund.js', 1]]);

  T('geeschterschlass', { hw: 9, r: 30, wl: 2.6, wr: 2.6, pts: [[-30, 0, { y: 0, hw: 11, r: 30 }], [160, -6, { y: 0, r: 40 }], [270, 50, { y: 1, r: 60 }], [285, 150, { y: 2, r: 30 }], [222, 186, { y: 3, r: 14 }], [276, 238, { y: 3.5, r: 14 }], [270, 330, { y: 4, r: 40 }], [180, 362, { y: 5, r: 22 }], [60, 346, { y: 7, r: 30 }], [40, 262, { y: 9, r: 16 }], [-60, 232, { y: 11, r: 16 }], [-130, 170, { y: 11, r: 30 }], [-120, 90, { y: 9, r: 30 }], [-70, 30, { y: 5, r: 30 }]],
  }, ['night', 'fog', 'sunset', 'rain'], [['tracks-geeschterschlass.js', 2]]);

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
