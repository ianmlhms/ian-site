/* Lokféierer: real-line scenery data (TS.realLine).
 *
 * The Mosel line is built from real OSM geometry (scripts/zuch/build_real_line.py).  Besides the layout tokens (real-mosel.js) it has scenery data per leg in
 * GAME coordinates (s = metres from the leg start, lat = metres to the right of the track axis): a land-class raster, river windows, road polylines, relief
 * (terrain height 220 m left / right of the line), villages and the real level crossings.  This module loads that file once (preload, async, before the track is
 * built) and resolves it for one track: leg ids -> absolute s.
 *
 *   TS.realLine.preload(routeDef)         fetches data/real/mosel-features.json when the route uses the Mosel line (def.sceneryId === 'mosel')
 *   TS.realLine.resolve(def, comp)        -> real | null.  comp.legs = [{ id, s0, s1 }] from track.js
 *   real.water        [{ s0, s1, side, off, half, name }]       absolute s
 *   real.reliefAt(s)  -> { l, r }                                terrain height relative to the track 220 m left / right
 *   real.landAt(s, lat) -> class code (see CLASS)               0 field 1 meadow 2 forest 3 vine 4 resid 5 indus 6 water 7 orchard 8 urban 9 scrub ...
 *   real.roads        [{ c, w, p: [[s, lat], ...] }]            absolute s
 *   real.places       [{ name, kind, s, lat }]
 *   real.crossingHints(index) -> { s, barrier, l, r } | null    the real crossing the index-th crossing of the track stands for
 *   real.mirror(L)    the same data for the return direction (s -> L - s, lat -> -lat) */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] real line: ';
  const DATA_URL = '/pb/train-sim/data/real/mosel-features.json?v=1';
  const CLASS = Object.freeze({ field: 0, meadow: 1, forest: 2, vine: 3, resid: 4, indus: 5, water: 6, orchard: 7, urban: 8, scrub: 9, quarry: 10, cemetery: 11, park: 12 });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let cache = null;
  let pending = null;

  async function preload(def) {
    if (!def || def.sceneryId !== 'mosel') return null;
    if (cache) return cache;
    if (!pending) {
      pending = fetch(DATA_URL, { cache: 'force-cache' })
        .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then((doc) => { cache = doc; return doc; })
        .catch((error) => { console.warn(TAG + 'scenery data failed to load, the generic landscape is used', error); pending = null; return null; });
    }
    return pending;
  }

  function resolve(def, comp) {
    if (!cache || !def || def.sceneryId !== 'mosel' || !comp.legs || !comp.legs.length) return null;
    const doc = cache;
    const legs = comp.legs.filter((l) => doc.legs[l.id]).map((l) => {
      const f = doc.legs[l.id];
      return { id: l.id, s0: l.s0, s1: l.s1, k: (l.s1 - l.s0) / f.L, f };
    });
    if (!legs.length) return null;
    const water = [];
    const roads = [];
    const places = [];
    const crossings = [];
    const rasters = [];
    const relief = [];
    legs.forEach((l) => {
      l.f.water.forEach((w) => water.push({ s0: l.s0 + w.s0 * l.k, s1: l.s0 + w.s1 * l.k, side: w.side, off: w.off, half: w.half, name: w.name, kind: w.kind }));
      l.f.roads.forEach((r) => roads.push({ c: r.c, w: r.w, n: r.n, ref: r.ref, p: r.p.map(([s, lat]) => [l.s0 + s * l.k, lat]), leg: l.id }));
      l.f.places.forEach((p) => places.push({ name: p.name, kind: p.kind, s: l.s0 + p.s * l.k, lat: p.lat }));
      l.f.crossings.forEach((c) => crossings.push({ s: l.s0 + c.s * l.k, barrier: c.barrier, l: c.l, r: c.r, leg: l.id }));
      const r = l.f.land;
      rasters.push({ s0: l.s0, s1: l.s1, ds: r.ds * l.k, n: r.n, rows: r.rows });
      relief.push({ s0: l.s0, s1: l.s1, step: l.f.relief.step * l.k, l: l.f.relief.l, r: l.f.relief.r });
    });
    water.sort((a, b) => a.s0 - b.s0);
    crossings.sort((a, b) => a.s - b.s);
    const find = (list, s) => {
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (list[mid].s0 <= s) lo = mid; else hi = mid - 1;
      }
      const e = list[lo];
      return e && s >= e.s0 - 1e-6 && s <= e.s1 + 1e-6 ? e : null;
    };
    const reliefAt = (s) => {
      const e = find(relief, s);
      if (!e) return { l: 0, r: 0 };
      const f = clamp((s - e.s0) / e.step, 0, e.l.length - 1.0001);
      const i = Math.floor(f);
      const t = f - i;
      return { l: e.l[i] + (e.l[i + 1] - e.l[i]) * t, r: e.r[i] + (e.r[i + 1] - e.r[i]) * t };
    };
    const landAt = (s, lat) => {
      const e = find(rasters, s);
      if (!e) return CLASS.field;
      const row = clamp(Math.floor((s - e.s0) / e.ds), 0, e.n - 1);
      const col = Math.floor((lat - doc.lat0) / doc.col);
      if (col < 0 || col >= doc.cols) return CLASS.field;
      return parseInt(e.rows[row][col], 16);
    };
    /* the cells of the raster: iteration helper for the chunk builder, [s0, s1) in absolute s */
    const rowsIn = (s0, s1) => {
      const out = [];
      rasters.forEach((e) => {
        if (e.s1 < s0 || e.s0 > s1) return;
        for (let i = Math.max(0, Math.floor((s0 - e.s0) / e.ds)); i < e.n; i++) {
          const a = e.s0 + i * e.ds;
          if (a >= s1) break;
          out.push({ s: a, ds: e.ds, text: e.rows[i] });
        }
      });
      return out;
    };
    const api = {
      water, roads, places, crossings, reliefAt, landAt, rowsIn, CLASS, lat0: doc.lat0, col: doc.col, cols: doc.cols,
      crossingHints: (index) => crossings[index] || null,
      mirrored: false,
    };
    api.mirror = (L) => Object.assign({}, api, {
      mirrored: true, L,
      water: water.map((w) => ({ s0: L - w.s1, s1: L - w.s0, side: -w.side, off: w.off, half: w.half, name: w.name, kind: w.kind })).sort((a, b) => a.s0 - b.s0),
      roads: roads.map((r) => Object.assign({}, r, { p: r.p.map(([s, lat]) => [L - s, -lat]) })),
      places: places.map((p) => Object.assign({}, p, { s: L - p.s, lat: -p.lat })),
      reliefAt: (s) => { const q = reliefAt(L - s); return { l: q.r, r: q.l }; },
      landAt: (s, lat) => landAt(L - s, -lat),
      rowsIn: (s0, s1) => rowsIn(L - s1, L - s0).map((r) => ({ s: L - r.s - r.ds, ds: r.ds, text: r.text.split('').reverse().join('') })).reverse(),
      crossingHints: (index) => { const c = crossings[crossings.length - 1 - index]; return c ? { s: L - c.s, barrier: c.barrier, l: c.r, r: c.l } : null; },
    });
    return Object.freeze(api);
  }

  TS.realLine = Object.freeze({ preload, resolve, CLASS });
})();
