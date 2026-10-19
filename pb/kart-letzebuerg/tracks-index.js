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
