/* Lokféierer: real surroundings of stations (TS.stationSurround): data, height patch, lifecycle.
 *
 * A "station patch" (pb/train-sim/data/stations/<key>.json, written by scripts/zuch/build_station_patch.py, format in scripts/zuch/STATION-PATCH-FORMAT.md) holds
 * the real LiDAR relief, OSM roads / water / ground classes and the LOD2 buildings and trees around one station, straightened onto the game's straight station
 * track: x = lateral distance to the right of the track, z = -(s - sMid) along it.  The game's own curvilinear coordinates (track.nearest: s, lat) are the same
 * thing, so the patch fits the track exactly and bends with it where the line curves outside the station.
 *
 *   preload(stationNames)          async, before the track is built: fetches and decodes the patches of those stations (silently skips missing ones).  W2c: the patches of the
 *                                  route stations are split (scripts/zuch/split_station_patches.py): preload fetches only the small CORE (4 m relief, roads, water: what the track build
 *                                  needs, ~25 kB gzip each); the HEAVY half (class map, LOD2 buildings, trees, rails, poi) is fetched lazily by create().update() ahead of the train
 *                                  (2 at a time, nearest first) and by heavyNear() for the first station.  A heavy half that is slow or fails never blocks driving: the generic scenery
 *                                  stands there (track.inSurround is false until the patch is ready) and the crossing road of the patch is still drawn from the core.
 *   heightPatches(stations, frameAt)  -> [{ name, blend(s, lat, h, formY), extraRows, extraLats, covers(s, lat), ... }] used by track.js terrainHeightAt
 *   create({ root, track, quality, materials }) -> { update(s, camera), covers(x, z), dispose() }   builds / removes the meshes near the player
 * The meshes themselves (painted ground, LOD2 buildings, trees, water, details) are built by station-surround-mesh.js. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] station surround: ';
  const DATA_DIR = '/pb/train-sim/data/stations/';
  const DATA_VERSION = 'w4a';     // bump when the patch files change (they are fetched with force-cache)
  const EXT_X = 160;              // patch half width (m) and half length
  const EXT_Z = 320;
  const FADE_X = 45;              // the real relief fades into the generic one over the outer metres
  const FADE_Z = 80;
  const ROW_STEP = 5;             // terrain strip rows inside a patch
  const LAT_STEP = 5;
  const FADE_ROW_STEP = 2.5;      // finer rows / columns where the real relief fades into the generic one
  const FADE_LAT_STEP = 2.5;
  const ACTIVE_RANGE = 1100;      // patches within this distance of the train are built (high quality; ACTIVE_RANGE_LEAN below it: W4, the next station's patch showed up in the 260-draw budget of the cab view at the first station)
  const ACTIVE_RANGE_LEAN = 850;
  const DROP_RANGE = 1700;
  const DROP_RANGE_LEAN = 1300;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

  const prepared = new Map();      // station name -> prepared patch data
  let indexPromise = null;

  const CORE_TIMEOUT = 15000;     // ms: a core file that is not here by then is skipped (the station has no patch, the generic scenery stands there)
  const HEAVY_TIMEOUT = 25000;
  const HEAVY_AHEAD = 3000;       // m: the heavy halves of the patches up to this far ahead of the train are fetched (the chunks are built 1250 m ahead, the meshes at 1100 m)
  const HEAVY_BEHIND = 1200;      // m: ... and behind it (the meshes stay up to DROP_RANGE 1700; a patch within ACTIVE_RANGE 1100 must be loaded)
  const HEAVY_PARALLEL = 2;
  async function fetchJson(url, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url + (url.indexOf('?') < 0 ? '?v=' + DATA_VERSION : ''), ctl ? { cache: 'force-cache', signal: ctl.signal } : { cache: 'force-cache' });
      if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
      return await res.json();
    } finally { if (timer) clearTimeout(timer); }
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
  function prepareDem(raw) {
    const dm = new Int16Array(b64ToBytes(raw.dem.dm).buffer);
    return { res: raw.dem.res, nx: raw.dem.nx, nz: raw.dem.nz, x0: raw.dem.x0, z0: raw.dem.z0, h: dm };
  }
  async function prepareClasses(raw) {
    const classes = await decodeClasses(raw.classes);
    return { res: raw.classes.res, nx: classes.nx, nz: classes.nz, x0: raw.classes.x0, z0: raw.classes.z0, cls: classes.cls };
  }
  async function prepare(raw) {            // a whole patch (Mosel line)
    return Object.freeze(Object.assign({}, raw, { demGrid: prepareDem(raw), classGrid: await prepareClasses(raw) }));
  }
  function prepareCore(raw) {              // W2c split patch: the core half
    return Object.freeze(Object.assign({}, raw, { demGrid: prepareDem(raw), classGrid: null }));
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
  const heavyState = new Map();    // station name -> 'ready' | 'idle' | 'loading' | 'failed'  (a whole patch is 'ready' at once)
  const heavyJobs = new Map();     // station name -> promise of the heavy half
  const keyOf = new Map();         // patch key -> file key (split patches only)
  /* W4: a station that two routes serve on different tracks (Thionville, Metz-Ville on the metz / paris routes) has one patch per route, registered in index-routes.json as "<route>/<Station>".
     active: station name -> the patch key of the route that was preloaded last (every name-based function below goes through patchKey, so callers keep using the plain station name) */
  const active = new Map();
  const patchKey = (name) => active.get(name) || name;
  const listeners = new Set();     // fn(name, state): a heavy half is ready / failed
  const stateOf = (name) => heavyState.get(patchKey(name)) || 'failed';

  async function preload(names, routeId) {
    try {
      /* index.json (Mosel line) + index-routes.json (W2c: north, south, west, ...): the station name -> patch file maps are merged; "split": 1 = core + heavy files */
      if (!indexPromise) {
        indexPromise = Promise.all([
          fetchJson(DATA_DIR + 'index.json', CORE_TIMEOUT).catch((error) => { console.info(TAG + 'no station patches (' + error.message + ')'); return { stations: {} }; }),
          fetchJson(DATA_DIR + 'index-routes.json', CORE_TIMEOUT).catch(() => ({ stations: {} })),
        ]).then(([a, b]) => ({ stations: Object.assign({}, a.stations || {}, b.stations || {}), routes: b.stations || {}, split: !!b.split }));
      }
      const index = await indexPromise;
      const baseRoute = String(routeId || '').replace(/~r$/, '');
      (names || []).forEach((n) => { if (baseRoute && index.stations && index.stations[baseRoute + '/' + n]) active.set(n, baseRoute + '/' + n); else active.delete(n); });
      const jobs = (names || []).filter((n) => index.stations && index.stations[patchKey(n)] && !prepared.has(patchKey(n))).map(async (n) => {
        const name = patchKey(n);
        const key = index.stations[name];
        const isSplit = index.split && index.routes[name] === key;
        try {
          if (isSplit) {
            const raw = await fetchJson(DATA_DIR + key + '.c.json', CORE_TIMEOUT);
            prepared.set(name, prepareCore(raw));
            keyOf.set(name, key); heavyState.set(name, 'idle');
          } else {
            const raw = await fetchJson(DATA_DIR + key + '.json', CORE_TIMEOUT);
            prepared.set(name, await prepare(raw));
            heavyState.set(name, 'ready');
          }
        } catch (error) {
          console.warn(TAG + 'patch of ' + name + ' failed', error);
        }
      });
      await Promise.all(jobs);
    } catch (error) {
      console.warn(TAG + 'preload failed', error);
    }
  }
  /* a patch can be bound to one scenery (data.scenery): every patch is placed purely by the CURRENT track's own frame (lateral / longitudinal offsets from
   * sMid, see station-surround-mesh.js), so this is only for a patch that is genuinely wrong on another scenery, not a general lock (Lëtzebuerg's patch
   * carries no `scenery` field any more: the same real Gare Centrale is used by every route). */
  const forRoute = (data, def) => !data.scenery || !def || def.sceneryId === data.scenery;
  const dataFor = (name, def) => { const d = prepared.get(patchKey(name)); return d && forRoute(d, def) ? d : null; };

  /* the heavy half of a split patch: class map, buildings, trees, rails, poi.  Never rejects; the state tells the result. */
  function loadHeavy(name) {
    const pk = patchKey(name);
    if (heavyJobs.has(pk)) return heavyJobs.get(pk);
    const st = heavyState.get(pk);
    if (st !== 'idle') return Promise.resolve(st || 'failed');
    heavyState.set(pk, 'loading');
    const job = (async () => {
      let result = 'failed';
      try {
        const raw = await fetchJson(DATA_DIR + keyOf.get(pk) + '.h.json', HEAVY_TIMEOUT);
        const core = prepared.get(pk);
        const classGrid = await prepareClasses(raw);
        const merged = Object.assign({}, core, { buildings: raw.buildings || [], trees: raw.trees || [], rails: raw.rails || [], poi: raw.poi || [], classes: raw.classes, classGrid });
        prepared.set(pk, Object.freeze(merged));
        result = 'ready';
      } catch (error) {
        console.warn(TAG + 'scenery of ' + name + ' failed (generic scenery stays)', error);
      }
      heavyState.set(pk, result);
      listeners.forEach((fn) => { try { fn(name, result); } catch (error) { console.warn(TAG + 'listener failed', error); } });
      return result;
    })();
    heavyJobs.set(pk, job);
    return job;
  }

  /* before the first frame: the heavy halves of the patches around s (the first stations), at most maxWaitMs; whatever is not here by then streams in while the train drives */
  async function heavyNear(track, s, opts) {
    const o = opts || {};
    const near = (track.surroundPatches || []).filter((p) => p.sMid > s - 500 && p.sMid < s + (o.ahead || 1600)).sort((a, b) => a.sMid - b.sMid).slice(0, o.count || 2);
    const jobs = near.map((p) => loadHeavy(p.name));
    if (!jobs.length) return;
    await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, o.maxWaitMs || 6000))]);
  }

  /* ---------------------------------------------------------------- height patches for track.js */
  function heightPatches(stations, frameAt, def) {
    const out = [];
    stations.forEach((st, index) => {
      const data = dataFor(st.name, def || null);
      if (!data) return;
      const sMid = (st.platformStart + st.platformEnd) / 2;
      const grid = data.demGrid;
      const weightOf = (lat, z) => (1 - smooth01((Math.abs(lat) - (EXT_X - FADE_X)) / FADE_X)) * (1 - smooth01((Math.abs(z) - (EXT_Z - FADE_Z)) / FADE_Z));
      out.push({
        name: st.name, index, sMid,
        get data() { return prepared.get(patchKey(st.name)); },                 // replaced by the full patch when the heavy half arrives
        get state() { return stateOf(st.name); },
        get meshReady() { return stateOf(st.name) === 'ready'; },    // buildings / trees / ground paint are drawn, so the generic scenery keeps out of the patch
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
          // the fade zones at the two ends of the patch (real valley -> generic hills) get a finer row spacing: a steep blend between rows is not linear
          [[sMid - EXT_Z, sMid - EXT_Z + FADE_Z], [sMid + EXT_Z - FADE_Z, sMid + EXT_Z]].forEach(([f0, f1]) => {
            for (let s = Math.ceil(Math.max(a, f0) / FADE_ROW_STEP) * FADE_ROW_STEP; s <= Math.min(b, f1); s += FADE_ROW_STEP) if (s % ROW_STEP !== 0) out2.push(s);
          });
          return out2;
        },
        extraLats(s0, s1) {
          if (s1 < sMid - EXT_Z || s0 > sMid + EXT_Z) return [];
          const out2 = [];
          for (let l = -EXT_X; l <= EXT_X; l += LAT_STEP) out2.push(l);
          for (let l = -EXT_X + FADE_LAT_STEP; l < EXT_X; l += FADE_LAT_STEP) if (Math.abs(l) > EXT_X - FADE_X && l % LAT_STEP !== 0) out2.push(l);   // finer columns across the lateral fade
          return out2;
        },
      });
    });
    void frameAt;
    return out;
  }

  /* ---------------------------------------------------------------- lifecycle */
  const CREDIT = '© OpenStreetMap contributors (ODbL, openstreetmap.org/copyright) · Geodata © ACT Luxembourg (geoportail.lu, CC0)';
  /* a patch may carry its own "credit" (non Luxembourg data, e.g. GeoBasis-RLP); it is listed after the Luxembourg credit only when such a patch is on the route */
  function addCredit(patches) {
    try {
      const help = document.getElementById('helpBody');
      if (!help || !help.parentElement) return;
      const extra = [];
      (patches || []).forEach((p) => { const c = p && p.data && p.data.credit; if (c && extra.indexOf(c) < 0) extra.push(c); });
      const text = 'Stations: ' + CREDIT + (extra.length ? ' · ' + extra.join(' · ') : '');
      let p = help.parentElement.querySelector('.ts-ss-credit');
      if (!p) {
        p = document.createElement('p');
        p.className = 'ts-ss-credit';
        p.style.cssText = 'display:block;margin-top:4px;opacity:.7;font-size:11px;font-weight:400';
        help.parentElement.appendChild(p);
      }
      p.textContent = text;
    } catch (error) { /* a missing credit line must never stop the world */ }
  }
  function create(opts) {
    const track = opts.track;
    /* the patches are placed in physical world coordinates by the BASE track's frames (a reversed service drives through the same real station the other way round) */
    const phys = track.base || track;
    const flipS = !!track.reverse;
    const patches = track.surroundPatches || [];
    if (!patches.length || !TS.stationSurroundMesh) return null;
    const built = new Map();     // patch index -> { group, dispose }
    const lean = opts.quality !== 'high';
    const activeRange = lean ? ACTIVE_RANGE_LEAN : ACTIVE_RANGE;
    const dropRange = lean ? DROP_RANGE_LEAN : DROP_RANGE;
    addCredit(patches);
    let disposed = false;
    /* a heavy half arrives (or fails): the chunks around the patch were built without it (generic scenery there) and are rebuilt by landscape.js */
    const onHeavy = (name, state) => {
      if (disposed || !opts.onResolved) return;
      const p = patches.find((q) => q.name === name);
      if (p && state === 'ready') { try { opts.onResolved(p); } catch (error) { console.warn(TAG + 'chunk refresh failed', error); } }
    };
    listeners.add(onHeavy);
    function update(s) {
      if (disposed) return;
      let loading = 0;
      patches.forEach((p) => { if (p.state === 'loading') loading++; });
      /* heavy halves ahead of the train, nearest first, a few at a time */
      if (loading < HEAVY_PARALLEL) {
        patches.filter((p) => p.state === 'idle' && p.sMid - s < HEAVY_AHEAD && s - p.sMid < HEAVY_BEHIND)
          .sort((a, b) => Math.abs(a.sMid - s) - Math.abs(b.sMid - s)).slice(0, HEAVY_PARALLEL - loading).forEach((p) => { loadHeavy(p.name); });
      }
      patches.forEach((p, i) => {
        const dist = Math.abs(p.sMid - (flipS ? phys.length - s : s));
        const state = p.state;
        /* 'ready': the whole patch; 'failed': the light patch (road of a level crossing, water) on top of the generic scenery; 'idle' / 'loading': not yet */
        const wantMesh = state === 'ready' || state === 'failed';
        if (!built.has(i) && dist < activeRange && wantMesh) {
          try {
            const rec = TS.stationSurroundMesh.build(p, { track: phys, quality: opts.quality, materials: opts.materials || {}, EXT_X, EXT_Z, width: opts.width, treeField: opts.treeField || null });
            if (rec && rec.group) { opts.root.add(rec.group); built.set(i, rec); }
          } catch (error) {
            console.warn(TAG + 'build of ' + p.name + ' failed', error);
            built.set(i, { group: null, dispose() {} });
          }
        } else if (built.has(i) && dist > dropRange) {
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
      listeners.delete(onHeavy);
      built.forEach((rec) => { if (rec.group) opts.root.remove(rec.group); rec.dispose(); });
      built.clear();
    }
    return { update, dispose, built: () => built.size };
  }

  TS.stationSurround = Object.freeze({ preload, loadHeavy, heavyNear, stateOf, dataFor, heightPatches, create, demAt, classAt, EXT_X, EXT_Z, FADE_X, FADE_Z, smooth01 });
})();
