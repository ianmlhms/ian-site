/* Lokféierer: real scenery of a chunk (TS.realScenery.fill), for routes that have real-line data (track.real, see real-line.js).
 *
 * landscape.js builds every chunk of the strip beside the track.  On the Mosel line the generic random content (villages, farms, fields, woods, country
 * roads, trees) is replaced by what is really there: the land-class raster says where forest, fields, vineyards, meadows, villages, industry are, the road
 * polylines are the real roads (A1, N1, CR, village streets), and the houses stand along the streets of the real residential areas.  Everything is
 * deterministic (the chunk's seeded rng) and built with the same kits as the generic scenery (houses, trees, fields, ribbons).
 *
 * fill(c): c is the chunk context from landscape.js:
 *   k, s0, s1, rng, Q (quality), W (strip half width), track, real, place(s, lat), frame(s), rowInfo(s), groundY(info, lat, x, z, s), yawOf(frame), placeM(...),
 *   addTree(name, x, y, z, sc, r), pickSpecies(biome, r), addField(fm, r, biome, sa, sb, la, lb, forceKind), fieldMB, mbHouse, mbBlock, mbRoof, mbRoad,
 *   addGrid(mb, grid, uvFn, colorFn, lift), addHouse, addBlock, addChurch, addShed, chunkRoads, isOcc(sa, sb, la, lb), markOcc(...), inTunnel(s, m), inBridge(s, m),
 *   riverBridgeAt(s, m), nearStation(s, m), TREE_CLEAR_LAT, C(hex), pick(r, list), T (THREE), SPECIES_SCALE */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] real scenery: ';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const FOREST_DENSITY = 1 / 62;      // trees per m2 of forest at quality high (x Q.trees)
  const SCRUB_DENSITY = 1 / 150;
  const ORCHARD_SPACING = 9;
  const ROAD_SAMPLE = 6;              // m between ribbon samples
  const STEEP_CROSS = 1.7;            // m of height difference across a road ribbon above which the piece is not drawn (the strip mesh is too coarse there: it would float)
  const HOUSE_SPACING = 17;
  const HOUSE_SETBACK = 6;
  const MAX_HOUSES = 90;
  const FIELD_MAX_S = 95;             // fields longer than this are split (crop variety)
    const VILLAGE_CLASSES = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'primary']);
  const ROAD_LINE_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

  /* ------------------------------------------------------------------ cells */
  function cellsOf(c) {
    const R = c.real;
    const rows = R.rowsIn(c.s0, c.s1);
    const cells = [];
    const nCol = R.cols;
    rows.forEach((row, ri) => {
      const mid = row.s + row.ds / 2;
      if (mid < c.s0 || mid >= c.s1) return;
      const line = [];
      for (let j = 0; j < nCol; j++) {
        const l0 = R.lat0 + j * R.col;
        line.push({ s0: row.s, s1: row.s + row.ds, l0, l1: l0 + R.col, cls: parseInt(row.text[j], 16), used: false });
      }
      cells.push(line);
    });
    return cells;
  }

  /* greedy rectangles of equal class: returns [{ s0, s1, l0, l1, cls }] */
  function rectangles(cells, accept, maxRows) {
    const out = [];
    const nR = cells.length;
    const nC = nR ? cells[0].length : 0;
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nC; j++) {
        const cell = cells[i][j];
        if (cell.used || !accept(cell)) continue;
        let j1 = j;
        while (j1 + 1 < nC && !cells[i][j1 + 1].used && cells[i][j1 + 1].cls === cell.cls) j1++;
        let i1 = i;
        while (i1 + 1 < nR && i1 + 1 - i < (maxRows || 99)) {
          let ok = true;
          for (let q = j; q <= j1; q++) if (cells[i1 + 1][q].used || cells[i1 + 1][q].cls !== cell.cls) { ok = false; break; }
          if (!ok) break;
          i1++;
        }
        for (let a = i; a <= i1; a++) for (let b = j; b <= j1; b++) cells[a][b].used = true;
        out.push({ s0: cells[i][j].s0, s1: cells[i1][j].s1, l0: cells[i][j].l0, l1: cells[i][j1].l1, cls: cell.cls });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ roads */
  function densify(pts, step) {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function chunkRoadList(c) {
    const list = [];
    c.real.roads.forEach((r) => {
      const inRange = r.p.some((q) => q[0] >= c.s0 - 40 && q[0] <= c.s1 + 40);
      if (!inRange) return;
      const dense = densify(r.p, ROAD_SAMPLE);
      let run = [];
      const flush = () => { if (run.length >= 2) list.push({ c: r.c, w: r.w, n: r.n, ref: r.ref, p: run }); run = []; };
      dense.forEach((q) => {
        if (q[0] >= c.s0 - ROAD_SAMPLE && q[0] <= c.s1 + ROAD_SAMPLE) run.push(q);
        else flush();
      });
      flush();
    });
    return list;
  }

  function drawRoads(c, roads) {
    const T = c.T;
    roads.forEach((rd) => {
      const hw = rd.w / 2;
      // world samples with heights; pieces where the ground is too steep across the road are left out
      const samples = rd.p.map(([s, lat]) => {
        const f = c.frame(s);
        return { s, lat, x: f.x + f.rx * lat, z: f.z + f.rz * lat };
      });
      let piece = [];
      const pieces = [];
      samples.forEach((q, i) => {
        const a = samples[Math.max(0, i - 1)];
        const b = samples[Math.min(samples.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        const px = -dz; const pz = dx;
        const info = c.rowInfo(clamp(q.s, 0, c.track.length));
        const left = { x: q.x - px * hw, z: q.z - pz * hw };
        const right = { x: q.x + px * hw, z: q.z + pz * hw };
        left.y = c.groundY(info, q.lat - hw, left.x, left.z, q.s);
        right.y = c.groundY(info, q.lat + hw, right.x, right.z, q.s);
        const cy = c.groundY(info, q.lat, q.x, q.z, q.s);
        const bad = Math.abs(left.y - right.y) > STEEP_CROSS || q.s < -20 || q.s > c.track.length + 20;
        if (bad) { if (piece.length >= 2) pieces.push(piece); piece = []; return; }
        const hi = Math.max(left.y, right.y, cy);
        piece.push({ q, left: Object.assign(left, { y: hi }), mid: { x: q.x, z: q.z, y: hi }, right: Object.assign(right, { y: hi }) });
      });
      if (piece.length >= 2) pieces.push(piece);
      pieces.forEach((pc) => {
        let dist = 0;
        const grid = pc.map((e, i) => {
          if (i) dist += Math.hypot(e.mid.x - pc[i - 1].mid.x, e.mid.z - pc[i - 1].mid.z);
          return [Object.assign({ d: dist }, e.left), Object.assign({ d: dist }, e.mid), Object.assign({ d: dist }, e.right)];
        });
        const white = c.C('#ffffff');
        c.addGrid(c.mbRoad, grid, (p, a, b) => [b / 2, p.d / 8], () => white, 0.07);
        // chunk roads for the cars (streets with a real class only)
        if (rd.c !== 'service' && pc.length > 3) {
          const pts = pc.map((e) => ({ x: e.mid.x, y: e.mid.y + 0.1, z: e.mid.z }));
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
          c.chunkRoads.push({ pts, cum, len: cum[cum.length - 1], hw, city: rd.c === 'residential' });
        }
      });
    });
    void T;
  }

  /* world-space segments of the roads for distance queries */
  function roadSegments(c, roads) {
    const segs = [];
    roads.forEach((rd) => {
      const w = rd.p.map(([s, lat]) => { const f = c.frame(s); return [f.x + f.rx * lat, f.z + f.rz * lat]; });
      for (let i = 0; i + 1 < w.length; i++) segs.push({ ax: w[i][0], az: w[i][1], bx: w[i + 1][0], bz: w[i + 1][1], hw: rd.w / 2, cls: rd.c, s: rd.p[i][0], lat: rd.p[i][1] });
    });
    return segs;
  }
  function roadClearance(segs, x, z) {
    let best = 1e9;
    let at = null;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      const dx = g.bx - g.ax;
      const dz = g.bz - g.az;
      const t = clamp(((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) - g.hw;
      if (d < best) { best = d; at = g; }
    }
    return { d: best, seg: at };
  }

  /* ------------------------------------------------------------------ pieces */
  function treeOk(c, s, lat) {
    if (Math.abs(lat) < (c.nearStation(s, 25) ? 18 : c.TREE_CLEAR_LAT)) return false;
    if (c.inTunnel(s, 15) || c.riverBridgeAt(s, 25) && Math.abs(lat) < 110) return false;
    const info = c.rowInfo(s);
    if (info.wat && Math.abs(lat - info.wat.side * info.wat.offset) < info.wat.halfWidth + 9) return false;
    return true;
  }

  function placeForest(c, cells, segs) {
    const dens = FOREST_DENSITY * c.Q.trees;
    cells.forEach((row) => row.forEach((cell) => {
      if (cell.cls !== c.real.CLASS.forest && cell.cls !== c.real.CLASS.scrub) return;
      if (Math.abs((cell.l0 + cell.l1) / 2) > c.W - 4) return;
      const forest = cell.cls === c.real.CLASS.forest;
      const area = (cell.s1 - cell.s0) * (cell.l1 - cell.l0);
      let n = area * (forest ? dens : SCRUB_DENSITY * c.Q.trees);
      n = Math.floor(n) + (c.rng() < n % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const s = cell.s0 + c.rng() * (cell.s1 - cell.s0);
        const lat = cell.l0 + c.rng() * (cell.l1 - cell.l0);
        if (!treeOk(c, s, lat)) continue;
        const p = c.place(s, lat);
        if (segs.length && roadClearance(segs, p.x, p.z).d < 2.2) continue;
        if (c.isOcc(s - 1, s + 1, lat - 1, lat + 1)) continue;
        const name = forest ? c.pickSpecies('forest', c.rng()) : 'bush';
        const sc = c.SPECIES_SCALE[name];
        c.addTree(name, p.x, p.y - 0.15, p.z, sc[0] + (sc[1] - sc[0]) * c.rng(), c.rng);
      }
    }));
  }

  function fieldKind(c, rect, ix) {
    const K = c.real.CLASS;
    const h = Math.abs(Math.sin(rect.s0 * 12.9898 + rect.l0 * 78.233 + ix * 3.1)) * 43758.5453 % 1;
    if (rect.cls === K.vine) return 'vines';
    if (rect.cls === K.meadow || rect.cls === K.park || rect.cls === K.orchard || rect.cls === K.cemetery) return 'meadow';
    if (rect.cls === K.quarry) return 'rowsBrown';
    return h < 0.3 ? 'rowsGold' : h < 0.55 ? 'rowsGreen' : h < 0.72 ? 'rowsBrown' : h < 0.82 ? 'rowsRape' : 'meadow';
  }

  function placeFields(c, cells, segs) {
    const K = c.real.CLASS;
    const open = new Set([K.field, K.meadow, K.vine, K.orchard, K.park, K.cemetery, K.quarry]);
    const rects = rectangles(cells, (cell) => open.has(cell.cls) && Math.abs((cell.l0 + cell.l1) / 2) < c.W + 6 && Math.abs((cell.l0 + cell.l1) / 2) > 10, Math.ceil(FIELD_MAX_S / 20));
    rects.forEach((r, ix) => {
      if (r.l1 - r.l0 < 10 || r.s1 - r.s0 < 10) return;
      const la = clamp(r.l0, -c.W - 4, c.W + 4);
      const lb = clamp(r.l1, -c.W - 4, c.W + 4);
      const kind = fieldKind(c, r, ix);
      const l0 = la;
      const l1 = lb;
      if (kind === 'meadow' && r.cls === K.orchard) {
        for (let s = r.s0 + 4; s < r.s1 - 2; s += ORCHARD_SPACING) for (let l = r.l0 + 4; l < r.l1 - 2; l += ORCHARD_SPACING) {
          if (!treeOk(c, s, l)) continue;
          const p = c.place(s, l);
          c.addTree('beech', p.x, p.y - 0.15, p.z, 0.5 + c.rng() * 0.2, c.rng);
        }
      }
      if (l1 - l0 < 8) return;
      c.addField(c.fieldMB, c.rng, 'farmland', r.s0 + 1.2, r.s1 - 1.2, l0 + 0.8, l1 - 0.8, kind);
      void segs;
    });
  }

  function placeVillages(c, cells, segs, roads) {
    const K = c.real.CLASS;
    const built = new Set([K.resid, K.urban]);
    const classAt = (s, lat) => c.real.landAt(s, lat);
    let count = 0;
    const max = Math.round(MAX_HOUSES * c.Q.houses);
    const put = (s, lat, yaw, urban) => {
      if (count >= max) return false;
      const w = urban ? 13 + c.rng() * 9 : c.pick(c.rng, [8, 9, 11, 12]);
      const d = urban ? 10 + c.rng() * 5 : c.pick(c.rng, [7, 8, 9]);
      const reach = Math.hypot(w, d) / 2 + 1;
      if (Math.abs(lat) < 20 + d / 2 || c.nearStation(s, 20) && Math.abs(lat) < 40) return false;
      if (c.inTunnel(s, 30) || c.inBridge(s, 40)) return false;
      if (c.isOcc(s - reach, s + reach, lat - reach, lat + reach)) return false;
      const p = c.place(s, lat);
      if (c.onRoad(p.x, p.z, reach + 2)) return false;
      if (segs.length && roadClearance(segs, p.x, p.z).d < d / 2 + 2.4) return false;
      const info = c.rowInfo(s);
      if (info.wat && Math.abs(lat - info.wat.side * info.wat.offset) < info.wat.halfWidth + 8) return false;
      const M0 = c.placeM(p.x, p.y - 0.1, p.z, yaw);
      if (urban) c.addBlock(c.mbBlock, c.mbRoof, M0, c.rng, { w, d, floors: 3 + Math.floor(c.rng() * 4), roof: c.rng() < 0.5 ? 'mansard' : 'flat' });
      else c.addHouse(c.mbHouse, c.mbRoof, M0, c.rng, { w, d });
      c.markOcc(s - reach, s + reach, lat - reach, lat + reach);
      count++;
      return true;
    };
    // along the real streets
    roads.forEach((rd) => {
      if (!VILLAGE_CLASSES.has(rd.c) || rd.c === 'primary' && rd.w > 8) return;
      let acc = 0;
      for (let i = 0; i + 1 < rd.p.length; i++) {
        const a = rd.p[i];
        const b = rd.p[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.1) continue;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        for (let t = acc; t < len; t += HOUSE_SPACING * (0.85 + c.rng() * 0.5)) {
          const s = a[0] + ux * t;
          const lat = a[1] + uy * t;
          if (s < c.s0 || s >= c.s1) continue;
          for (const side of [-1, 1]) {
            const off = rd.w / 2 + HOUSE_SETBACK + 4.5;
            const hs = s - uy * off * side;       // normal of the street direction in (s, lat)
            const hl = lat + ux * off * side;
            const cls = classAt(hs, hl);
            if (!built.has(cls) || c.rng() < 0.12) continue;
            // yaw: the house's long side parallel to the street (street direction in the world)
            const f0 = c.frame(s); const f1 = c.frame(s + ux * 6);
            const wx = f1.x + f1.rx * (lat + uy * 6) - (f0.x + f0.rx * lat);
            const wz = f1.z + f1.rz * (lat + uy * 6) - (f0.z + f0.rz * lat);
            put(hs, hl, Math.atan2(-wz, wx), cls === K.urban);
          }
        }
        acc = (acc + len) % HOUSE_SPACING;
      }
    });
    // infill: built-up cells away from a street
    cells.forEach((row) => row.forEach((cell) => {
      if (!built.has(cell.cls) || count >= max) return;
      if (c.rng() > (cell.cls === K.urban ? 0.5 : 0.32)) return;
      const s = cell.s0 + c.rng() * (cell.s1 - cell.s0);
      const lat = cell.l0 + c.rng() * (cell.l1 - cell.l0);
      if (Math.abs(lat) > c.W - 6) return;
      const f = c.frame(s);
      put(s, lat, c.yawOf(f) + (c.rng() < 0.3 ? Math.PI / 2 : 0), cell.cls === K.urban);
    }));
    // the church of the village (once per chunk that holds a village centre)
    c.real.places.forEach((pl) => {
      if (pl.s < c.s0 || pl.s >= c.s1 || (pl.kind !== 'village' && pl.kind !== 'town')) return;
      for (let r = 0; r < 60; r += 6) for (const sg of [1, -1]) {
        const s = pl.s + sg * r * 0.8;
        const lat = pl.lat + sg * r;
        if (!built.has(classAt(s, lat)) || Math.abs(lat) < 28 || c.isOcc(s - 10, s + 10, lat - 10, lat + 10)) continue;
        const p = c.place(s, lat);
        if (c.onRoad(p.x, p.z, 12)) continue;
        c.addChurch(c.mbHouse, c.mbRoof, c.placeM(p.x, p.y - 0.1, p.z, c.yawOf(c.frame(s)) + Math.PI / 2), c.rng);
        c.markOcc(s - 10, s + 10, lat - 10, lat + 10);
        return;
      }
    });
  }

  function placeIndustry(c, cells) {
    const K = c.real.CLASS;
    const rects = rectangles(cells, (cell) => cell.cls === K.indus && Math.abs((cell.l0 + cell.l1) / 2) > 22, 6);
    rects.forEach((r) => {
      const w = r.s1 - r.s0 - 6;
      const d = r.l1 - r.l0 - 6;
      if (w < 14 || d < 12) return;
      const s = (r.s0 + r.s1) / 2;
      const lat = (r.l0 + r.l1) / 2;
      if (c.isOcc(s - w / 2, s + w / 2, lat - d / 2, lat + d / 2) || c.inTunnel(s, 40) || c.inBridge(s, 50)) return;
      const p = c.place(s, lat);
      if (c.onRoad(p.x, p.z, Math.max(w, d) / 2)) return;
      c.addShed(c.mbBlock, c.mbRoof, c.placeM(p.x, p.y - 0.1, p.z, c.yawOf(c.frame(s))), c.rng, Math.min(w, 46), Math.min(d, 30), 7 + c.rng() * 5);
      c.markOcc(s - w / 2, s + w / 2, lat - d / 2, lat + d / 2);
    });
  }

  /* trees along the roads in open country (poplar / fruit tree lines) and a tree belt beside the track */
  function placeRoadside(c, roads, segs) {
    roads.forEach((rd) => {
      if (!ROAD_LINE_CLASSES.has(rd.c)) return;
      let acc = 0;
      for (let i = 0; i + 1 < rd.p.length; i++) {
        const a = rd.p[i];
        const b = rd.p[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.1) continue;
        const ux = (b[0] - a[0]) / len;
        const uy = (b[1] - a[1]) / len;
        for (let t = acc; t < len; t += 16 + c.rng() * 8) {
          const s = a[0] + ux * t;
          const lat = a[1] + uy * t;
          if (s < c.s0 || s >= c.s1 || c.rng() > 0.55) continue;
          const side = c.rng() < 0.5 ? -1 : 1;
          const off = rd.w / 2 + 2.6;
          const ts = s - uy * off * side;
          const tl = lat + ux * off * side;
          const cls = c.real.landAt(ts, tl);
          if (cls === c.real.CLASS.resid || cls === c.real.CLASS.urban || cls === c.real.CLASS.forest || !treeOk(c, ts, tl)) continue;
          const p = c.place(ts, tl);
          if (roadClearance(segs, p.x, p.z).d < 1.6) continue;
          c.addTree(rd.c === 'motorway' ? 'bush' : c.rng() < 0.5 ? 'poplar' : 'oak', p.x, p.y - 0.15, p.z, 0.8 + c.rng() * 0.4, c.rng);
        }
        acc = (acc + len) % 16;
      }
    });
    // belt of trees and bushes beside the line in open country (depth in the cab view)
    const K = c.real.CLASS;
    for (let s = c.s0 + 4; s < c.s1; s += 7 + c.rng() * 8) {
      if (c.rng() > 0.45 * c.Q.trees + 0.12 || c.nearStation(s, 30) || c.inTunnel(s, 20) || c.inBridge(s, 30)) continue;
      const side = c.rng() < 0.5 ? -1 : 1;
      const lat = side * (c.TREE_CLEAR_LAT + 1 + c.rng() * 6);
      const cls = c.real.landAt(s, lat);
      if (cls === K.resid || cls === K.urban || cls === K.indus) continue;
      const p = c.place(s, lat);
      if (segs.length && roadClearance(segs, p.x, p.z).d < 2) continue;
      const nm = c.pickSpecies('def', c.rng());
      const sc = c.SPECIES_SCALE[nm];
      c.addTree(nm, p.x, p.y - 0.15, p.z, sc[0] + (sc[1] - sc[0]) * c.rng(), c.rng);
    }
  }

  /* ------------------------------------------------------------------ entry */
  function fill(c) {
    try {
      const cells = cellsOf(c);
      const roads = chunkRoadList(c);
      const segs = roadSegments(c, roads);
      drawRoads(c, roads);
      placeVillages(c, cells, segs, roads);
      placeIndustry(c, cells);
      placeFields(c, cells, segs);
      placeForest(c, cells, segs);
      placeRoadside(c, roads, segs);
    } catch (error) {
      console.warn(TAG + 'chunk ' + c.k + ' failed', error);
    }
  }

  TS.realScenery = Object.freeze({ fill });
})();
