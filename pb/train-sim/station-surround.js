/* Lokféierer: real surroundings of stations (TS.stationSurround): data, height patch, lifecycle.
 *
 * A "station patch" (pb/train-sim/data/stations/<key>.json, written by scripts/zuch/build_station_patch.py, format in scripts/zuch/STATION-PATCH-FORMAT.md) holds
 * the real LiDAR relief, OSM roads / water / ground classes and the LOD2 buildings and trees around one station, straightened onto the game's straight station
 * track: x = lateral distance to the right of the track, z = -(s - sMid) along it.  The game's own curvilinear coordinates (track.nearest: s, lat) are the same
 * thing, so the patch fits the track exactly and bends with it where the line curves outside the station.
 *
 *   preload(stationNames)          async, before the track is built: fetches and decodes the patches of those stations (silently skips missing ones)
 *   heightPatches(stations, frameAt)  -> [{ name, blend(s, lat, h, formY), extraRows, extraLats, covers(s, lat), ... }] used by track.js terrainHeightAt
 *   create({ root, track, quality, materials }) -> { update(s, camera), covers(x, z), dispose() }   builds / removes the meshes near the player
 * The meshes themselves (painted ground, LOD2 buildings, trees, water, details) are built by station-surround-mesh.js. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] station surround: ';
  const DATA_DIR = '/pb/train-sim/data/stations/';
  const EXT_X = 160;              // patch half width (m) and half length
  const EXT_Z = 320;
  const FADE_X = 45;              // the real relief fades into the generic one over the outer metres
  const FADE_Z = 80;
  const ROW_STEP = 5;             // terrain strip rows inside a patch
  const LAT_STEP = 5;
  const ACTIVE_RANGE = 1100;      // patches within this distance of the train are built
  const DROP_RANGE = 1700;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

  const prepared = new Map();      // station name -> prepared patch data
  let indexPromise = null;

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
    return res.json();
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* the class map PNG is 8-bit grayscale with value = class * 16; the browser decodes it through a canvas */
  function decodeClasses(spec) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const cls = new Uint8Array(c.width * c.height);
        for (let i = 0; i < cls.length; i++) cls[i] = Math.round(px[i * 4] / 16);
        resolve({ nx: c.width, nz: c.height, cls });
      };
      img.onerror = () => reject(new Error('class map did not decode'));
      img.src = 'data:image/png;base64,' + spec.png;
    });
  }
  async function prepare(raw) {
    const dm = new Int16Array(b64ToBytes(raw.dem.dm).buffer);
    const classes = await decodeClasses(raw.classes);
    const dem = { res: raw.dem.res, nx: raw.dem.nx, nz: raw.dem.nz, x0: raw.dem.x0, z0: raw.dem.z0, h: dm };
    const cm = { res: raw.classes.res, nx: classes.nx, nz: classes.nz, x0: raw.classes.x0, z0: raw.classes.z0, cls: classes.cls };
    return Object.freeze(Object.assign({}, raw, { demGrid: dem, classGrid: cm }));
  }

  /* bilinear terrain height (m, relative to the formation level) at patch coordinates */
  function demAt(g, x, z) {
    const fx = clamp((x - g.x0) / g.res, 0, g.nx - 1.001);
    const fz = clamp((z - g.z0) / g.res, 0, g.nz - 1.001);
    const ix = Math.floor(fx); const iz = Math.floor(fz); const tx = fx - ix; const tz = fz - iz;
    const h = g.h; const i = iz * g.nx + ix;
    return lerp(lerp(h[i], h[i + 1], tx), lerp(h[i + g.nx], h[i + g.nx + 1], tx), tz) * 0.1;
  }
  function classAt(g, x, z) {
    const ix = clamp(Math.floor((x - g.x0) / g.res), 0, g.nx - 1);
    const iz = clamp(Math.floor((z - g.z0) / g.res), 0, g.nz - 1);
    return g.cls[iz * g.nx + ix];
  }

  /* ---------------------------------------------------------------- preload */
  async function preload(names) {
    try {
      if (!indexPromise) indexPromise = fetchJson(DATA_DIR + 'index.json').catch((error) => { console.info(TAG + 'no station patches (' + error.message + ')'); return { stations: {} }; });
      const index = await indexPromise;
      const jobs = (names || []).filter((n) => index.stations && index.stations[n] && !prepared.has(n)).map(async (name) => {
        try {
          const raw = await fetchJson(DATA_DIR + index.stations[name] + '.json');
          prepared.set(name, await prepare(raw));
        } catch (error) {
          console.warn(TAG + 'patch of ' + name + ' failed', error);
        }
      });
      await Promise.all(jobs);
    } catch (error) {
      console.warn(TAG + 'preload failed', error);
    }
  }
  const dataFor = (name) => prepared.get(name) || null;

  /* ---------------------------------------------------------------- height patches for track.js */
  function heightPatches(stations, frameAt) {
    const out = [];
    stations.forEach((st, index) => {
      const data = prepared.get(st.name);
      if (!data) return;
      const sMid = (st.platformStart + st.platformEnd) / 2;
      const grid = data.demGrid;
      const weightOf = (lat, z) => (1 - smooth01((Math.abs(lat) - (EXT_X - FADE_X)) / FADE_X)) * (1 - smooth01((Math.abs(z) - (EXT_Z - FADE_Z)) / FADE_Z));
      out.push({
        name: st.name, index, sMid, data,
        covers: (s, lat) => Math.abs(lat) <= EXT_X && Math.abs(s - sMid) <= EXT_Z,
        weightOf,
        /* terrain height of a point at track coordinates (s, lat) relative to the local formation level */
        demAt: (s, lat) => demAt(grid, lat, -(s - sMid)),
        blend(s, lat, h, formY) {
          const z = -(s - sMid);
          const w = weightOf(lat, z);
          if (w <= 0) return h;
          return lerp(h, formY + demAt(grid, lat, z), w);
        },
        extraRows(s0, s1) {
          const out2 = [];
          const a = Math.max(s0, sMid - EXT_Z); const b = Math.min(s1, sMid + EXT_Z);
          for (let s = Math.ceil(a / ROW_STEP) * ROW_STEP; s <= b; s += ROW_STEP) out2.push(s);
          return out2;
        },
        extraLats(s0, s1) {
          if (s1 < sMid - EXT_Z || s0 > sMid + EXT_Z) return [];
          const out2 = [];
          for (let l = -EXT_X; l <= EXT_X; l += LAT_STEP) out2.push(l);
          return out2;
        },
      });
    });
    void frameAt;
    return out;
  }

  /* ---------------------------------------------------------------- lifecycle */
  function create(opts) {
    const track = opts.track;
    const patches = track.surroundPatches || [];
    if (!patches.length || !TS.stationSurroundMesh) return null;
    const built = new Map();     // patch index -> { group, dispose }
    let disposed = false;
    function update(s) {
      if (disposed) return;
      patches.forEach((p, i) => {
        const dist = Math.abs(p.sMid - s);
        if (!built.has(i) && dist < ACTIVE_RANGE) {
          try {
            const rec = TS.stationSurroundMesh.build(p, { track, quality: opts.quality, materials: opts.materials || {}, EXT_X, EXT_Z, width: opts.width });
            if (rec && rec.group) { opts.root.add(rec.group); built.set(i, rec); }
          } catch (error) {
            console.warn(TAG + 'build of ' + p.name + ' failed', error);
            built.set(i, { group: null, dispose() {} });
          }
        } else if (built.has(i) && dist > DROP_RANGE) {
          const rec = built.get(i);
          if (rec.group) opts.root.remove(rec.group);
          rec.dispose();
          built.delete(i);
        }
      });
      built.forEach((rec) => { if (rec.update) rec.update(s); });
    }
    function dispose() {
      disposed = true;
      built.forEach((rec) => { if (rec.group) opts.root.remove(rec.group); rec.dispose(); });
      built.clear();
    }
    return { update, dispose, built: () => built.size };
  }

  TS.stationSurround = Object.freeze({ preload, dataFor, heightPatches, create, demAt, classAt, EXT_X, EXT_Z, FADE_X, FADE_Z, smooth01 });
})();
