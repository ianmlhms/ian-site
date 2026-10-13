/* Lokféierer: the real world around Luxtram T1 (TS.luxtramWorld).
 * Real geodata, all key-free and CC0: Geodata © ACT Luxembourg (geoportail.lu / data.public.lu) + OpenStreetMap (ODbL).
 *   - ground: the orthophoto (WebP tiles of 128 m, 0.33-1 m/px) draped on the LiDAR 2024 terrain model (2-4 m grid), streamed by distance along the line,
 *     blended into the formation under both tracks;  data/luxtram/{o,h}/<i>_<j>.*
 *   - buildings: the national LOD 2.2 3D buildings (real roof shapes and heights), facades from a procedural atlas, roof colour from the orthophoto;
 *     data/luxtram/b/<i>_<j>.json.  OSM footprints are only used where there is no LOD2 building.
 *   - OSM (data/luxtram-world.json, 200 m chunks of the line): roads (traffic), bridges, trees, signals, the tram bed of both tracks.
 * All geometry is merged per tile / chunk and per material.  Created by the TS.landscape.create wrapper in luxtram.js; sky, sun, weather stay procedural.
 * Landmarks: TS.luxLandmarks.build(scene, ctx) (luxtram-landmarks.js) with ctx.project / groundAt / railY; TS.luxProject(lat, lon) -> {x, z} in scene metres. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] luxtram world: ';
  const WORLD_URL = '/pb/train-sim/data/luxtram-world.json?v=2';
  const GEO_BASE = '/pb/train-sim/data/luxtram/';
  const LAT0 = 49.6055;
  const LON0 = 6.164;
  const M_LAT = 111194.93;
  const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
  const H0 = 150;      // height tile encoding (build_luxtram_geo.py)
  const HQ = 50;

  const QUALITY = {
    high: { ahead: 900, behind: 260, castShadow: true, trees: 1, lamps: true, cars: 56 },
    medium: { ahead: 650, behind: 200, castShadow: false, trees: 0.8, lamps: true, cars: 36 },
    low: { ahead: 420, behind: 150, castShadow: false, trees: 0.45, lamps: false, cars: 14 },
  };
  const FLOOR_H = 3.1;
  const BAY_W = 3.6;
  const MAX_BUILDS_PER_UPDATE = 1;
  const OSM_TREES = false;      // trees come from the LiDAR canopy now

  /* scene projection (route origin subtracted once a world exists; see create) */
  let activeOrigin = null;
  TS.luxProject = (lat, lon) => {
    const x = (lon - LON0) * M_LON;
    const z = -(lat - LAT0) * M_LAT;
    return activeOrigin ? { x: x - activeOrigin.x, z: z - activeOrigin.z } : { x, z };
  };
  TS.luxProjectLocal = (lat, lon) => ({ x: (lon - LON0) * M_LON, z: -(lat - LAT0) * M_LAT });

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash2 = (x, y) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  };
  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hexRGB = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const C = (hex) => { const k = new T.Color(hex); return [k.r, k.g, k.b]; };

  const decodeFlat = (flat) => {
    const pts = [];
    let x = 0;
    let z = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x / 10, z / 10]); }
    return pts;
  };

  /* ------------------------------------------------------------ canvas textures (cached for the session) */
  const texCache = new Map();
  function canvasTex(key, w, h, draw, opts) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = (opts && opts.linear) ? T.NoColorSpace : T.SRGBColorSpace;
    t.wrapS = t.wrapT = (opts && opts.clamp) ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  function speckle(g, w, h, n, alpha, size, seed) {
    const r = mulberry(seed || n);
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,' + alpha + ')' : 'rgba(0,0,0,' + alpha + ')';
      g.fillRect(r() * w, r() * h, size, size);
    }
  }

  const texRoof = () => canvasTex('lt-roof', 128, 128, (g, w, h) => {
    g.fillStyle = '#9a9a96'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4000, 0.08, 2, 5);
    const r = mulberry(8);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 8; x < w; x += 16) {
      const v = 120 + r() * 40; g.fillStyle = 'rgba(' + (v | 0) + ',' + ((v + 3) | 0) + ',' + ((v + 8) | 0) + ',0.22)'; g.fillRect(x + 1, y + 1, 14, 14);
    }
  });
  // road atlas: left half plain asphalt, right half with markings (u in [0,0.5] / [0.5,1])
  const texRoad = () => canvasTex('lt-road', 256, 128, (g, w, h) => {
    g.fillStyle = '#4f5256'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 6000, 0.07, 1.4, 4);
    g.fillStyle = 'rgba(236,236,226,0.9)';
    g.fillRect(w / 2 + 6, 0, 3, h); g.fillRect(w - 9, 0, 3, h);
    g.fillRect(w * 0.75 - 1.5, 0, 3, h * 0.5);
    g.fillStyle = '#4b4e52'; g.fillRect(w / 2, 0, 1, h); // seam
  });
  const texPave = () => canvasTex('lt-pave', 128, 128, (g, w, h) => {
    g.fillStyle = '#c9c6bd'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, 0.07, 2, 6);
    g.strokeStyle = 'rgba(80,76,70,0.4)'; g.lineWidth = 1;
    for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });
  const texBed = () => canvasTex('lt-bed', 128, 128, (g, w, h) => {
    g.fillStyle = '#f0f0ee'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4200, 0.09, 1.6, 15);
    g.strokeStyle = 'rgba(70,68,64,0.18)';
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  });

  /* ------------------------------------------------------------ geometry accumulator */
  class Mesher {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    get empty() { return this.p.length === 0; }
    vert(x, y, z, nx, ny, nz, u, v, col) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(col[0], col[1], col[2]);
      return this.p.length / 3 - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
    /* flat polygon fan/ear triangulation (ring = [[x,z],...] in route frame, y per vertex given by yFn) */
    mesh(material, o) {
      if (this.empty) return null;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      const m = new T.Mesh(g, material);
      m.castShadow = !!(o && o.cast);
      m.receiveShadow = !(o && o.noReceive);
      if (o && o.order !== undefined) m.renderOrder = o.order;
      return m;
    }
  }

  /* closed prism / box helper: oriented box (centre, size, yaw) */
  function addBox(m, cx, cy, cz, sx, sy, sz, yaw, col) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = sx / 2;
    const hz = sz / 2;
    const hy = sy / 2;
    const corner = (ix, iz) => [cx + (ix * hx) * c - (iz * hz) * s, cz + (ix * hx) * s + (iz * hz) * c];
    const faces = [
      [[-1, -1], [1, -1], [0, -1]], [[1, -1], [1, 1], [1, 0]], [[1, 1], [-1, 1], [0, 1]], [[-1, 1], [-1, -1], [-1, 0]],
    ];
    faces.forEach((f) => {
      const a = corner(f[0][0], f[0][1]);
      const b = corner(f[1][0], f[1][1]);
      const nx = f[2][0] * c - f[2][1] * s;
      const nz = f[2][0] * s + f[2][1] * c;
      const i0 = m.vert(a[0], cy - hy, a[1], nx, 0, nz, 0, 0, col);
      const i1 = m.vert(b[0], cy - hy, b[1], nx, 0, nz, 1, 0, col);
      const i2 = m.vert(b[0], cy + hy, b[1], nx, 0, nz, 1, 1, col);
      const i3 = m.vert(a[0], cy + hy, a[1], nx, 0, nz, 0, 1, col);
      m.quad(i0, i1, i2, i3);
    });
    const tc = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const t0 = tc.map((q, k) => m.vert(q[0], cy + hy, q[1], 0, 1, 0, k === 1 || k === 2 ? 1 : 0, k > 1 ? 1 : 0, col));
    m.quad(t0[0], t0[3], t0[2], t0[1]);
  }
  /* beam between two 3D points with square section t */
  function addBeam(m, a, b, t, col) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    const ux = dx / len; const uy = dy / len; const uz = dz / len;
    // two perpendicular vectors
    let px = -uz; let py = 0; let pz = ux;
    const pl = Math.hypot(px, pz);
    if (pl < 1e-4) { px = 1; pz = 0; } else { px /= pl; pz /= pl; }
    const qx = uy * pz - uz * py; const qy = uz * px - ux * pz; const qz = ux * py - uy * px;
    const h = t / 2;
    const ring = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const idx = ring.map((r) => [
      [a[0] + px * r[0] + qx * r[1], a[1] + py * r[0] + qy * r[1], a[2] + pz * r[0] + qz * r[1]],
      [b[0] + px * r[0] + qx * r[1], b[1] + py * r[0] + qy * r[1], b[2] + pz * r[0] + qz * r[1]],
    ]);
    for (let k = 0; k < 4; k++) {
      const r0 = idx[k];
      const r1 = idx[(k + 1) % 4];
      const nx = (ring[k][0] + ring[(k + 1) % 4][0]) * px + (ring[k][1] + ring[(k + 1) % 4][1]) * qx;
      const ny = (ring[k][0] + ring[(k + 1) % 4][0]) * py + (ring[k][1] + ring[(k + 1) % 4][1]) * qy;
      const nz = (ring[k][0] + ring[(k + 1) % 4][0]) * pz + (ring[k][1] + ring[(k + 1) % 4][1]) * qz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const i0 = m.vert(r0[0][0], r0[0][1], r0[0][2], nx / nl, ny / nl, nz / nl, 0, 0, col);
      const i1 = m.vert(r1[0][0], r1[0][1], r1[0][2], nx / nl, ny / nl, nz / nl, 1, 0, col);
      const i2 = m.vert(r1[1][0], r1[1][1], r1[1][2], nx / nl, ny / nl, nz / nl, 1, 1, col);
      const i3 = m.vert(r0[1][0], r0[1][1], r0[1][2], nx / nl, ny / nl, nz / nl, 0, 1, col);
      m.quad(i0, i1, i2, i3);
    }
  }

  /* ------------------------------------------------------------ tree templates (merged by transform) */
  function treeTemplate(kind) {
    const m = new Mesher();
    const trunk = C('#5a4636');
    const addCyl = (r0, r1, h, y0, col, seg) => {
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2;
        const a1 = ((k + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const nx = Math.cos(am); const nz = Math.sin(am);
        const i0 = m.vert(Math.cos(a0) * r0, y0, Math.sin(a0) * r0, nx, 0, nz, 0, 0, col);
        const i1 = m.vert(Math.cos(a1) * r0, y0, Math.sin(a1) * r0, nx, 0, nz, 1, 0, col);
        const i2 = m.vert(Math.cos(a1) * r1, y0 + h, Math.sin(a1) * r1, nx, 0, nz, 1, 1, col);
        const i3 = m.vert(Math.cos(a0) * r1, y0 + h, Math.sin(a0) * r1, nx, 0, nz, 0, 1, col);
        m.quad(i0, i3, i2, i1);
      }
    };
    const addBlob = (cx, cy, cz, rx, ry, rz, lo, hi) => { // icosahedron-ish blob (octahedron subdivided once)
      const geo = new T.IcosahedronGeometry(1, 1);
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const base = m.count;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const j = 0.86 + 0.28 * hash2(Math.round(x * 40) + Math.round(z * 31), Math.round(y * 37));
        const t = clamp(y * 0.5 + 0.5, 0, 1);
        const col = mix3(lo, hi, t * 0.75 + (nor.getY(i) * 0.5 + 0.5) * 0.25);
        m.vert(cx + x * rx * j, cy + y * ry * j, cz + z * rz * j, nor.getX(i), nor.getY(i), nor.getZ(i), 0, 0, col);
      }
      for (let i = 0; i < pos.count; i += 3) m.tri(base + i, base + i + 1, base + i + 2);
      geo.dispose();
    };
    if (kind === 1) { // conifer: stacked cones
      addCyl(0.14, 0.2, 1.6, 0, trunk, 5);
      const lo = C('#1c3b2a'); const hi = C('#356b48');
      for (let k = 0; k < 5; k++) {
        const r = 2.0 - k * 0.32; const h = 2.2 - k * 0.1; const y = 1.2 + k * 1.2;
        for (let sI = 0; sI < 8; sI++) {
          const a0 = (sI / 8) * Math.PI * 2; const a1 = ((sI + 1) / 8) * Math.PI * 2; const am = (a0 + a1) / 2;
          const nl = Math.hypot(h, r);
          const nx = Math.cos(am) * h / nl; const nz = Math.sin(am) * h / nl; const ny = r / nl;
          const i0 = m.vert(Math.cos(a0) * r, y, Math.sin(a0) * r, nx, ny, nz, 0, 0, mix3(lo, hi, 0.2 + k * 0.1));
          const i1 = m.vert(Math.cos(a1) * r, y, Math.sin(a1) * r, nx, ny, nz, 1, 0, mix3(lo, hi, 0.2 + k * 0.1));
          const i2 = m.vert(0, y + h, 0, nx, ny, nz, 0.5, 1, mix3(lo, hi, 0.7 + k * 0.05));
          m.tri(i0, i2, i1);
        }
      }
    } else {
      addCyl(0.2, 0.3, 3.4, 0, trunk, 6);
      const lo = C('#3a6a2c'); const hi = C('#7da63f');
      addBlob(0, 5.2, 0, 2.7, 2.3, 2.7, lo, hi);
      addBlob(1.6, 4.3, 0.6, 1.8, 1.6, 1.8, lo, hi);
      addBlob(-1.4, 4.5, -0.7, 1.9, 1.7, 1.9, lo, hi);
    }
    return m;
  }

  /* ------------------------------------------------------------ data */
  let worldData = null;
  function syncJson(url) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status + ' ' + url);
    return JSON.parse(xhr.responseText);
  }
  const NET = (TS.net = TS.net || { bytes: 0 });   // shared download counter: bytes of every data file fetched (the loading bar reads it)
  function loadWorld() { if (!worldData) worldData = syncJson(WORLD_URL); return worldData; }
  let geoIndex = null;
  let structData = null;
  function loadStructures() { if (!structData) { try { structData = syncJson(GEO_BASE + 'structures.json?v=1'); } catch (e) { structData = { over: [] }; } } return structData; }
  function loadGeoIndex() { if (!geoIndex) geoIndex = syncJson(GEO_BASE + 'index.json?v=2'); return geoIndex; }
  /* Fetches the three data files the world needs at build time asynchronously (with a byte count) so that create() finds them in memory instead of
     blocking on synchronous requests. Resolves when all are in (or failed: create() then falls back to the blocking request). */
  function prefetchData() {
    const getJson = (url) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))).then((txt) => { NET.bytes += txt.length; return JSON.parse(txt); });
    const jobs = [];
    if (!worldData) jobs.push(getJson(WORLD_URL).then((d) => { if (!worldData) worldData = d; }));
    if (!structData) jobs.push(getJson(GEO_BASE + 'structures.json?v=1').then((d) => { if (!structData) structData = d; }).catch(() => { /* optional: loadStructures() falls back */ }));
    if (!geoIndex) jobs.push(getJson(GEO_BASE + 'index.json?v=2').then((d) => { if (!geoIndex) geoIndex = d; }));
    return Promise.all(jobs).then(() => true, (e) => { console.warn(TAG + 'data prefetch failed, loading synchronously', e); return false; });
  }

  /* ------------------------------------------------------------ facade atlas for the LOD2 buildings
   * 8 columns (4 styles x 2 variants) x 2 rows (ground floor / upper floor), each cell = one bay (BAY_W m) x one floor.
   * White-ish wall so the vertex colour tints it; the second (emissive) atlas holds the windows for the night. */
  const CELL = 192;
  const ATLAS_COLS = 8;
  const ATLAS_ROWS = 2;
  function facadeAtlas() {
    const mk = (key, lit) => canvasTex(key, CELL * ATLAS_COLS, CELL * ATLAS_ROWS, (g, w, h) => {
      g.fillStyle = lit ? '#000' : '#f3f0e8'; g.fillRect(0, 0, w, h);
      for (let style = 0; style < 4; style++) {
        for (let variant = 0; variant < 2; variant++) {
          for (let row = 0; row < 2; row++) paintCell(g, (style * 2 + variant) * CELL, row * CELL, style, variant, row === 0, lit);
        }
      }
    }, { clamp: true });
    return { day: mk('lt-atlas-day', false), lit: mk('lt-atlas-lit', true) };
  }
  function paintCell(g, x, y, style, variant, ground, lit) {
    const w = CELL; const h = CELL;
    const r = mulberry(style * 17 + variant * 5 + (ground ? 99 : 3));
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    if (!lit) {
      for (let i = 0; i < 260; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; g.fillRect(x + r() * w, y + r() * h, 2, 2); }
    }
    const win = (wx, wy, ww, wh, o) => {
      const opt = o || {};
      if (lit) { g.fillStyle = r() > 0.5 ? '#ffd58a' : '#fff0c8'; g.fillRect(x + wx, y + wy, ww, wh); return; }
      if (opt.frame !== false) { g.fillStyle = opt.frameCol || '#e6e1d4'; g.fillRect(x + wx - 5, y + wy - 5, ww + 10, wh + 10); }
      const grd = g.createLinearGradient(x + wx, y + wy, x + wx + ww, y + wy + wh);
      grd.addColorStop(0, opt.c0 || '#6f8798'); grd.addColorStop(0.5, opt.c1 || '#2f4352'); grd.addColorStop(1, opt.c2 || '#1d2a35');
      g.fillStyle = grd; g.fillRect(x + wx, y + wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x + wx, y + wy + wh * 0.6); g.lineTo(x + wx + ww * 0.55, y + wy); g.lineTo(x + wx + ww, y + wy); g.lineTo(x + wx, y + wy + wh); g.fill();
      if (opt.bars !== false) { g.fillStyle = opt.frameCol || '#eceae0'; g.fillRect(x + wx + ww / 2 - 2, y + wy, 4, wh); g.fillRect(x + wx, y + wy + wh * 0.42, ww, 4); }
      if (opt.sill) { g.fillStyle = '#bdb7a8'; g.fillRect(x + wx - 9, y + wy + wh + 5, ww + 18, 7); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + wx - 9, y + wy + wh + 12, ww + 18, 3); }
      if (opt.lintel) { g.fillStyle = '#cfc9ba'; g.fillRect(x + wx - 8, y + wy - 12, ww + 16, 7); }
    };
    if (style === 0) { // plaster house / terrace
      if (ground && variant === 0) { // front door
        if (lit) { win(w * 0.34, h * 0.34, w * 0.32, h * 0.3); } else {
          g.fillStyle = '#e6e1d4'; g.fillRect(x + w * 0.3, y + h * 0.22, w * 0.4, h * 0.78);
          g.fillStyle = '#5b4332'; g.fillRect(x + w * 0.34, y + h * 0.27, w * 0.32, h * 0.73);
          g.fillStyle = '#26333d'; g.fillRect(x + w * 0.38, y + h * 0.33, w * 0.24, h * 0.22);
          g.fillStyle = '#d9b04a'; g.fillRect(x + w * 0.58, y + h * 0.64, 6, 6);
        }
      } else if (ground) { win(w * 0.24, h * 0.3, w * 0.52, h * 0.42, { sill: true, bars: variant === 1 }); }
      else if (variant === 0) win(w * 0.27, h * 0.22, w * 0.46, h * 0.56, { sill: true, lintel: true });
      else { // window with shutters
        win(w * 0.29, h * 0.24, w * 0.42, h * 0.54, { sill: true });
        if (!lit) { g.fillStyle = '#6d7f66'; g.fillRect(x + w * 0.11, y + h * 0.24, w * 0.15, h * 0.54); g.fillRect(x + w * 0.74, y + h * 0.24, w * 0.15, h * 0.54); g.fillStyle = 'rgba(0,0,0,0.2)'; for (let k = 0; k < 8; k++) { g.fillRect(x + w * 0.11, y + h * (0.27 + k * 0.065), w * 0.15, 2); g.fillRect(x + w * 0.74, y + h * (0.27 + k * 0.065), w * 0.15, 2); } }
      }
    } else if (style === 1) { // modern apartments with balconies
      if (ground) {
        if (lit) { win(w * 0.12, h * 0.16, w * 0.76, h * 0.62); } else {
          g.fillStyle = '#9aa2a6'; g.fillRect(x, y + h * 0.82, w, h * 0.18);
          win(w * 0.1, h * 0.14, w * 0.8, h * 0.66, { frame: true, frameCol: '#c9c8c2', c0: '#8aa0ab', c1: '#4b6371', c2: '#2f4350' });
        }
      } else if (variant === 0) {
        win(w * 0.12, h * 0.14, w * 0.76, h * 0.58, { frameCol: '#d6d3ca', bars: false });
        if (!lit) { g.fillStyle = '#c8c6bf'; g.fillRect(x, y + h * 0.82, w, h * 0.18); g.fillStyle = '#7b8186'; g.fillRect(x, y + h * 0.7, w, 4); for (let k = 0; k <= 10; k++) g.fillRect(x + k * (w / 10), y + h * 0.7, 3, h * 0.12); }
      } else {
        win(w * 0.3, h * 0.12, w * 0.4, h * 0.64, { frameCol: '#d6d3ca' });
        if (!lit) { g.fillStyle = '#c8c6bf'; g.fillRect(x, y + h * 0.84, w, h * 0.16); }
      }
    } else if (style === 2) { // glass curtain wall
      if (lit) { g.fillStyle = r() > 0.5 ? '#ffd58a' : '#cfe3ff'; g.fillRect(x + 4, y + (ground ? 6 : 10), w - 8, h * (ground ? 0.86 : 0.64)); } else {
        const gl = g.createLinearGradient(x, y, x + w, y + h);
        gl.addColorStop(0, '#6f8c9d'); gl.addColorStop(0.5, '#3b5767'); gl.addColorStop(1, '#4f7183');
        g.fillStyle = gl; g.fillRect(x + 3, y + (ground ? 4 : 8), w - 6, h * (ground ? 0.9 : 0.66));
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 3, y + (ground ? 4 : 8), w - 6, 5);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(x + 3, y + h * 0.7); g.lineTo(x + w * 0.5, y + 8); g.lineTo(x + w * 0.8, y + 8); g.lineTo(x + 3, y + h * 0.9); g.fill();
        g.fillStyle = '#aeb6ba'; g.fillRect(x + w / 2 - 2, y + 8, 4, h * 0.66);
        g.fillStyle = '#c9ced1'; g.fillRect(x, y + h * 0.74, w, h * 0.26);
        g.fillStyle = '#8c969b'; g.fillRect(x, y + h - 4, w, 4);
      }
    } else { // concrete / institutional ribbon
      if (ground) {
        if (lit) { win(w * 0.06, h * 0.2, w * 0.88, h * 0.5); } else {
          g.fillStyle = '#c0bfba'; g.fillRect(x, y, w, h); g.fillStyle = '#5f666b'; g.fillRect(x + w * 0.08, y + h * 0.18, w * 0.84, h * 0.58);
          g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x + w * 0.08, y + h * 0.18, w * 0.84, 6);
          g.fillStyle = '#9a9d9a'; g.fillRect(x + w / 2 - 2, y + h * 0.18, 4, h * 0.58);
        }
      } else if (variant === 0) {
        if (lit) win(w * 0.02, h * 0.24, w * 0.96, h * 0.38); else {
          g.fillStyle = '#d9d7d0'; g.fillRect(x, y + h * 0.1, w, h * 0.7);
          win(w * 0.02, h * 0.24, w * 0.96, h * 0.38, { frame: false, bars: false, c0: '#7a919d', c1: '#3a4d59', c2: '#27343d' });
          g.fillStyle = '#b6b4ac'; g.fillRect(x, y + h * 0.9, w, 3); g.fillRect(x + w - 3, y, 3, h);
        }
      } else {
        win(w * 0.34, h * 0.28, w * 0.32, h * 0.34, { frameCol: '#cfcdc5' });
        if (!lit) { g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(x + w - 3, y, 3, h); g.fillRect(x, y + h - 3, w, 3); }
      }
    }
    g.restore();
  }

  /* ------------------------------------------------------------ height tile decoding (build_luxtram_geo.py: encode_heights) */
  function decodeHeights(buf) {
    const u8 = new Uint8Array(buf);
    const n = u8[0];
    const out = new Float32Array(n * n);
    const q = new Int32Array(n * n);
    let pos = 1;
    const next = () => {
      let x = 0; let sh = 0;
      for (;;) { const b = u8[pos++]; x += (b & 0x7f) * Math.pow(2, sh); sh += 7; if (b < 0x80) break; }
      return (x % 2 === 1) ? -(x + 1) / 2 : x / 2;
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const v = next();
        let pred = 0;
        if (r === 0 && c === 0) pred = 0;
        else if (r === 0) pred = q[k - 1];
        else if (c === 0) pred = q[k - n];
        else pred = q[k - 1] + q[k - n] - q[k - n - 1];
        q[k] = pred + v;
        out[k] = q[k] / HQ + H0;
      }
    }
    return { n, h: out };
  }

  /* b/<i>_<j>.bin (build_luxtram_geo.py: pack_buildings_bin) -> [[kind, roofRGB|-1, wallRGB|0, levels, ax, az, ay, nv, V, nR, R, nW, W, B], ...] */
  function parseBuildings(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint16(0, true);
    let p = 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const kind = dv.getUint8(p); const levels = dv.getUint8(p + 1); const flags = dv.getUint8(p + 2);
      const roof = (flags & 1) ? (dv.getUint8(p + 3) << 16 | dv.getUint8(p + 4) << 8 | dv.getUint8(p + 5)) : -1;
      const wall = (flags & 2) ? (dv.getUint8(p + 6) << 16 | dv.getUint8(p + 7) << 8 | dv.getUint8(p + 8)) : 0;
      const ax = dv.getInt32(p + 9, true); const az = dv.getInt32(p + 13, true); const ay = dv.getInt32(p + 17, true);
      const nv = dv.getUint16(p + 21, true); const nR = dv.getUint16(p + 23, true); const nW = dv.getUint16(p + 25, true); const nB = dv.getUint16(p + 27, true);
      p += 29;
      const V = new Int16Array(nv * 3);
      for (let k = 0; k < nv * 3; k++) V[k] = dv.getInt16(p + k * 2, true);
      p += nv * 6;
      const R = new Uint16Array(nR * 3);
      for (let k = 0; k < nR * 3; k++) R[k] = dv.getUint16(p + k * 2, true);
      p += nR * 6;
      const W = new Uint16Array(nW * 3);
      for (let k = 0; k < nW * 3; k++) W[k] = dv.getUint16(p + k * 2, true);
      p += nW * 6;
      const B = new Uint16Array(nB);
      for (let k = 0; k < nB; k++) B[k] = dv.getUint16(p + k * 2, true);
      p += nB * 2;
      out.push([kind, roof, wall, levels, ax, az, ay, nv, V, nR, R, nW, W, B]);
    }
    return out;
  }

  /* ------------------------------------------------------------ main factory */
  function create(scene, track, options, landscape) {
    const quality = options && QUALITY[options.quality] ? options.quality : 'medium';
    const Q = QUALITY[quality];
    const data = loadWorld();
    const geo = loadGeoIndex();
    const lt = track.luxtram;
    const ox = lt.origin.x;
    const oz = lt.origin.z;
    const oy = lt.origin.y;
    const L = track.length;
    const root = new T.Group();
    root.name = 'luxtram-world';
    scene.add(root);
    const chunks = new Map();
    const roadsByChunk = new Map();
    const lampsByChunk = new Map();   // road lamp positions per chunk (test hook: debugRoadFurniture)
    let disposed = false;
    let nightK = 0;
    const firstCi = Math.max(0, Math.floor(lt.origFromAbs(lt.sStart) / data.chunk) - 1);
    const lastCi = Math.floor(lt.origFromAbs(lt.sEnd) / data.chunk) + 1;
    activeOrigin = { x: ox, z: oz };

    /* ---- shared materials */
    const atlas = facadeAtlas();
    const matWall = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, emissive: new T.Color('#ffffff'), emissiveIntensity: 0 });
    const wallUniforms = { uAtlas: { value: atlas.day }, uAtlasLit: { value: atlas.lit }, uNight: { value: 0 } };
    matWall.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, wallUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aTex;\nvarying vec4 vTex;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTex = aTex;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vTex;\nuniform sampler2D uAtlas;\nuniform sampler2D uAtlasLit;\nuniform float uNight;\n'
          + 'float lhash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
        .replace('#include <map_fragment>', [
          'vec2 bayC = vTex.xy;',
          'float bx = floor(bayC.x); float fl = floor(bayC.y);',
          'float rnd = lhash(vec2(bx, vTex.w * 91.7 + fl * 0.37));',
          'float variant = rnd < 0.68 ? 0.0 : 1.0;',
          'float rowG = fl < 0.5 ? 0.0 : 1.0;',
          'float colA = vTex.z * 2.0 + variant;',
          'vec2 cuv = vec2(fract(bayC.x), fract(bayC.y));',
          'vec2 atl = vec2((colA + cuv.x) / 8.0, (1.0 - (rowG + 1.0) * 0.5) + cuv.y * 0.5);',
          'vec2 gdx = dFdx(bayC) * vec2(0.125, 0.5); vec2 gdy = dFdy(bayC) * vec2(0.125, 0.5);',
          'vec4 facTex = textureGrad(uAtlas, atl, gdx, gdy);',
          'if (vTex.z > 8.5) { float rn = lhash(floor(vTex.xy * 6.0) + vTex.w * 17.0); facTex = vec4(vec3(0.9 + 0.1 * rn), 1.0); }',
          'diffuseColor.rgb *= facTex.rgb;',
        ].join('\n'))
        .replace('#include <emissivemap_fragment>', [
          'float lit = vTex.z > 8.5 ? 0.0 : step(lhash(vec2(bx * 1.7 + vTex.w * 13.0, fl + 4.1)), 0.42);',
          'totalEmissiveRadiance *= textureGrad(uAtlasLit, atl, gdx, gdy).rgb * lit * uNight;',
        ].join('\n'));
    };
    matWall.customProgramCacheKey = () => 'lt-wall-v1';
    const matRoof = new T.MeshLambertMaterial({ vertexColors: true, map: texRoof(), side: T.DoubleSide });
    const matBed = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texBed(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const matRoad = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texRoad(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matPave = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texPave(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const matMisc = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    const matSteel = new T.MeshStandardMaterial({ side: T.DoubleSide, vertexColors: true, roughness: 0.45, metalness: 0.7 });
    const matLeaf = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true });
    const matLampGlow = new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true });
    const mats = [matWall, matRoof, matBed, matRoad, matPave, matMisc, matSteel, matLeaf, matLampGlow];
    const treeTpl = [treeTemplate(0), treeTemplate(1)];

    /* ---- static road index of the whole line (scene metres) for the pole placement rules: TS.luxRoadMargin(x, z) = distance from (x, z) to the nearest
       carriageway edge of a ground-level road (negative = inside the carriageway).  infra.js keeps masts, boards, signals and km posts out of lanes with it. */
    const ROAD_CELL = 40;
    const roadCells = new Map();
    let roadIndexBuilt = false;
    function indexRoads() {
      if (roadIndexBuilt) return;
      roadIndexBuilt = true;
      Object.keys(data.chunks).forEach((k) => (data.chunks[k].r || []).forEach((rd) => {
        const cls = rd[0]; const flags = rd[1]; const hw = rd[3] / 20;
        if ((flags & 3) || cls > 4) return;                    // bridges / underground / service lanes
        const pts = decodeFlat(rd[4]).map(toScene);
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]; const b = pts[i + 1];
          const seg = [a[0], a[1], b[0], b[1], hw];
          const x0 = Math.floor((Math.min(a[0], b[0]) - hw) / ROAD_CELL); const x1 = Math.floor((Math.max(a[0], b[0]) + hw) / ROAD_CELL);
          const z0 = Math.floor((Math.min(a[1], b[1]) - hw) / ROAD_CELL); const z1 = Math.floor((Math.max(a[1], b[1]) + hw) / ROAD_CELL);
          for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const key = cx + ',' + cz; const l = roadCells.get(key); if (l) l.push(seg); else roadCells.set(key, [seg]); }
        }
      }));
    }
    function roadMargin(x, z) {
      indexRoads();
      const near = roadCells.get(Math.floor(x / ROAD_CELL) + ',' + Math.floor(z / ROAD_CELL));
      let best = Infinity;
      if (!near) return best;
      for (let i = 0; i < near.length; i++) {
        const g = near[i];
        const dx = g[2] - g[0]; const dz = g[3] - g[1]; const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - g[0]) * dx + (z - g[1]) * dz) / l2, 0, 1);
        const m = Math.hypot(x - (g[0] + dx * t), z - (g[1] + dz * t)) - g[4];
        if (m < best) best = m;
      }
      return best;
    }
    TS.luxRoadMargin = roadMargin;
    /* margin to every road except `own` (a runtime road record { pts, hw }): the post of a crossing stands at the kerb of its own road */
    function roadMarginExcept(x, z, own) {
      indexRoads();
      const near = roadCells.get(Math.floor(x / ROAD_CELL) + ',' + Math.floor(z / ROAD_CELL));
      let best = Infinity;
      if (!near) return best;
      for (let i = 0; i < near.length; i++) {
        const g = near[i];
        const dx = g[2] - g[0]; const dz = g[3] - g[1]; const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - g[0]) * dx + (z - g[1]) * dz) / l2, 0, 1);
        const m = Math.hypot(x - (g[0] + dx * t), z - (g[1] + dz * t)) - g[4];
        if (m < best && !segOnRoad(g, own)) best = m;
      }
      return best;
    }
    const segOnRoad = (g, rd) => rd.pts.some((p) => Math.hypot(p.x - g[0], p.z - g[1]) < 0.05) && rd.pts.some((p) => Math.hypot(p.x - g[2], p.z - g[3]) < 0.05);

    /* ---- coordinates: scene = local frame - route origin (x, z); y = absolute height - route origin height */
    const toScene = (p) => [p[0] - ox, p[1] - oz];
    const sceneRing = (flat) => decodeFlat(flat).map(toScene);
    const frame = (s) => track.frameAt(s);
    const nearest = (x, z) => track.nearest(x, z);
    const sceneToLonLat = (x, z) => ({ lat: LAT0 - (z + oz) / M_LAT, lon: LON0 + (x + ox) / M_LON });
    // small structures at a stop (OSM/LOD2 tram shelters, kiosks) are replaced by the photo-modelled stops (stations-luxtram.js)
    const STOP_CLEAR_H = 6;
    const STOP_CLEAR_LAT = 14;
    const STOP_CLEAR_PAD = 12;
    const atStop = (x, z) => {
      const n = nearest(x, z);
      if (!n || n.d > STOP_CLEAR_LAT) return false;
      return (track.stations || []).some((st) => n.s >= st.platformStart - STOP_CLEAR_PAD && n.s <= st.platformEnd + STOP_CLEAR_PAD);
    };
    const hasOpp = !!(track.opposite && track.opposite.frameAt);
    const oppLatAt = (s) => (hasOpp && track.opposite.has(s) ? track.opposite.latAt(s) : -3.45);

    /* ---- terrain: LiDAR tiles (DTM), blended into the formation under both tracks */
    const tiles = new Map();
    const tileKeys = Object.keys(geo.tiles);
    const TS_ = geo.tile;
    const tileAt = (x, z) => tiles.get(Math.floor((x + ox) / TS_) + '_' + Math.floor((z + oz) / TS_));
    function demAt(x, z) {
      const lx = x + ox; const lz = z + oz;
      const ti = Math.floor(lx / TS_); const tj = Math.floor(lz / TS_);
      const t = tiles.get(ti + '_' + tj);
      if (!t || !t.dem) return NaN;
      const u = (lx - ti * TS_) / t.step; const v = (lz - tj * TS_) / t.step;
      const n = t.dem.n;
      const iu = clamp(Math.floor(u), 0, n - 2); const iv = clamp(Math.floor(v), 0, n - 2);
      const fu = clamp(u - iu, 0, 1); const fv = clamp(v - iv, 0, 1);
      const h = t.dem.h;
      const a = h[iv * n + iu]; const b = h[iv * n + iu + 1]; const c = h[(iv + 1) * n + iu]; const d = h[(iv + 1) * n + iu + 1];
      return lerp(lerp(a, b, fu), lerp(c, d, fu), fv) - oy;
    }
    const structMask = (list, s, pad) => { let k = 0; for (let i = 0; i < list.length; i++) { const e = list[i]; k = Math.max(k, 1 - smooth(0, pad, Math.max(e.s0 - s, s - e.s1, 0))); } return k; };
    /* slots = stretches where the track runs between vertical walls: tunnel approaches ('open'), the tunnels themselves ('cover': ground closes over),
       underpasses below a deck ('deck').  Inside the walls the terrain is the formation, outside it is the raw LiDAR ground. */
    const slots = [];
    const SLOT_IN_L = 2.15; const SLOT_IN_R = 2.35;
    const slotLatL = (s) => oppLatAt(s) - SLOT_IN_L;
    function slotAt(s) {
      for (let i = 0; i < slots.length; i++) { const u = slots[i]; if (s >= u.s0 && s <= u.s1) return u; }
      return null;
    }
    function blendTrack(x, z, h) {
      const q = nearest(x, z);
      if (q.d > 40) return h;
      const formY = q.y - 0.06;
      const sl = slotAt(q.s);
      if (sl) {
        const inside = q.lat > slotLatL(q.s) - 0.05 && q.lat < SLOT_IN_R + 0.05;
        if (sl.kind === 'cover') return inside ? q.y - 2.0 : h;     // a hole under the roof cap (buildCapsFor draws the ground above the tunnel at its real height)
        if (inside && sl.kind === 'open' && ((sl.dir === 'in' && q.s > sl.s1 - 4.5) || (sl.dir === 'out' && q.s < sl.s0 + 4.5))) return formY - 2.0;   // under the portal floor strip
        return inside ? formY : h;
      }
      const sep = -oppLatAt(q.s);
      const dOut = q.lat >= 0 ? q.lat : Math.max(0, -q.lat - sep);
      let w = 1 - smooth(4.2, 12, dOut);
      w *= (1 - structMask(track.bridges, q.s, 6)) * (1 - structMask(track.tunnels, q.s, 5));
      return w > 0 ? lerp(h, formY, w) : h;
    }
    const underpasses = slots;
    function gy(x, z) {
      const h = demAt(x, z);
      if (h !== h) return track.terrainHeightAt(x, z);
      return blendTrack(x, z, h);
    }
    const railYAt = (x, z) => { const q = nearest(x, z); return q.y; };

    /* ---- tile table (scene-space rectangles, nearest line position) */
    const tileInfo = tileKeys.map((key) => {
      const [i, j] = key.split('_').map(Number);
      const cxs = (i + 0.5) * TS_ - ox; const czs = (j + 0.5) * TS_ - oz;
      const q = nearest(cxs, czs);
      return { key, i, j, meta: geo.tiles[key], s: q.s, d: q.d };
    });
    const tileByKey = new Map(tileInfo.map((t) => [t.key, t]));
    void tileByKey;

    const counted = (x) => { NET.bytes += x && x.byteLength !== undefined ? x.byteLength : x && x.size !== undefined ? x.size : 0; return x; };   // ArrayBuffer / Blob size (parsed JSON: not counted)
    const MAX_LOADS = 4;
    let loading = 0;
    function startLoad(info) {
      const key = info.key;
      const t = { key, info, state: 'loading', step: info.meta.step, dem: null, bld: null, img: null, group: null, mesh: null, stride: 0, disposed: false, built: false };
      tiles.set(key, t);
      loading++;
      const ver = geo.v || 1;
      const get = (url, kind) => fetch(GEO_BASE + url + '?v=' + ver).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return kind === 'buf' ? r.arrayBuffer() : kind === 'blob' ? r.blob() : r.json(); }).then(counted);
      const pH = get('h/' + key + '.bin', 'buf').then(decodeHeights);
      const pB = geo.bld[key] ? get('b/' + key + '.bin', 'buf').then(parseBuildings).catch(() => []) : Promise.resolve([]);
      const pO = get('o/' + key + '.webp', 'blob').then((b) => (typeof createImageBitmap === 'function' ? createImageBitmap(b) : new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(b); })));
      const pT = info.meta.trees ? get('t/' + key + '.bin', 'buf').catch(() => null) : Promise.resolve(null);
      Promise.all([pH, pB, pO.catch(() => null), pT]).then(([dem, bld, img, trees]) => {
        loading--;
        if (t.disposed) { if (img && img.close) img.close(); return; }
        t.dem = dem; t.bld = bld; t.img = img; t.trees = trees; t.state = 'ready';
      }).catch((e) => { loading--; t.state = 'failed'; console.warn(TAG + 'tile ' + key + ' failed', e); });
    }

    /* terrain mesh of one tile (stride = node skip), the orthophoto as texture, skirts hide cracks between LODs */
    function buildTerrain(t, stride) {
      const info = t.info;
      const n = t.dem.n; const m = Math.floor((n - 1) / stride) + 1;
      const step = t.step * stride;
      const x0 = info.i * TS_ - ox; const z0 = info.j * TS_ - oz;
      const px = info.meta.px; const res = info.meta.res;
      const nv = m * m;
      const pos = new Float32Array((nv + 4 * m) * 3);
      const nor = new Float32Array((nv + 4 * m) * 3);
      const uv = new Float32Array((nv + 4 * m) * 2);
      const col = new Float32Array((nv + 4 * m) * 3).fill(1);
      const edge = [];
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) {
          const k = r * m + c;
          const xl = c * step; const zl = r * step;
          const x = x0 + xl; const z = z0 + zl;
          const y = blendTrack(x, z, t.dem.h[(r * stride) * n + c * stride] - oy);
          pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
          uv[k * 2] = (xl / res + 1) / px; uv[k * 2 + 1] = (zl / res + 1) / px;
        }
      }
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) {
          const k = r * m + c;
          const ya = pos[(Math.max(0, r - 1) * m + c) * 3 + 1]; const yb = pos[(Math.min(m - 1, r + 1) * m + c) * 3 + 1];
          const yc = pos[(r * m + Math.max(0, c - 1)) * 3 + 1]; const yd = pos[(r * m + Math.min(m - 1, c + 1)) * 3 + 1];
          const dz = (Math.min(m - 1, r + 1) - Math.max(0, r - 1)) * step; const dx = (Math.min(m - 1, c + 1) - Math.max(0, c - 1)) * step;
          let nx = -(yd - yc) / dx; let nz = -(yb - ya) / dz; const ny = 1;
          const nl = Math.hypot(nx, ny, nz); nx /= nl; nz /= nl;
          nor[k * 3] = nx; nor[k * 3 + 1] = ny / nl; nor[k * 3 + 2] = nz;
          // steep faces (cut slopes, embankments) smear the orthophoto: darken / warm them
          const steep = 1 - smooth(0.5, 0.86, ny / nl);
          col[k * 3] = 1 - steep * 0.32; col[k * 3 + 1] = 1 - steep * 0.42; col[k * 3 + 2] = 1 - steep * 0.55;
        }
      }
      const idx = [];
      for (let r = 0; r < m - 1; r++) {
        for (let c = 0; c < m - 1; c++) {
          const a = r * m + c; const b = a + 1; const c2 = a + m; const d = c2 + 1;
          idx.push(a, c2, b, b, c2, d);
        }
      }
      // skirts: along the 4 edges, 3 m down
      let sk = nv;
      const skirt = (list) => {
        const base = sk;
        list.forEach((k) => { col[sk * 3] = col[k * 3]; col[sk * 3 + 1] = col[k * 3 + 1]; col[sk * 3 + 2] = col[k * 3 + 2]; pos[sk * 3] = pos[k * 3]; pos[sk * 3 + 1] = pos[k * 3 + 1] - 8; pos[sk * 3 + 2] = pos[k * 3 + 2]; nor[sk * 3 + 1] = 1; uv[sk * 2] = uv[k * 2]; uv[sk * 2 + 1] = uv[k * 2 + 1]; sk++; });
        for (let i = 0; i < list.length - 1; i++) idx.push(list[i], base + i, list[i + 1], list[i + 1], base + i, base + i + 1);
      };
      const top = []; const bot = []; const lef = []; const rig = [];
      for (let c = 0; c < m; c++) { top.push(c); bot.push((m - 1) * m + c); }
      for (let r = 0; r < m; r++) { lef.push(r * m); rig.push(r * m + m - 1); }
      skirt(top); skirt(bot); skirt(lef); skirt(rig);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(nor, 3));
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.setIndex(nv + 4 * m > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      void edge;
      return g;
    }
    const GROUND_TINT = new T.Color('#b4b4ae');   // multiplies the orthophoto: darker values turned shaded city streets black
    /* steep faces (cut slopes, embankments) smear the orthophoto: fade them to a soil / concrete tone */
    function patchGroundMaterial(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSlopeY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlopeY = normal.y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSlopeY;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n{ float steep = 1.0 - smoothstep(0.5, 0.86, vSlopeY); float l = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.45) * (0.55 + l * 0.8), steep * 0.85); }');
      };
      mat.customProgramCacheKey = () => 'lt-ground-v1';
      return mat;
    }
    function makeTileTexture(t) {
      if (!t.img) return null;
      const tex = new T.Texture(t.img);
      tex.flipY = false;
      tex.colorSpace = T.SRGBColorSpace;
      tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
      tex.anisotropy = quality === 'high' ? 8 : 4;
      tex.generateMipmaps = true;
      tex.minFilter = T.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
      return tex;
    }
    function desiredStride(t, s) {
      const d = Math.abs(t.info.s - s) - 60;
      const base = d < 380 ? 1 : d < 700 ? 2 : 4;
      return Math.min(base * (t.step === 4 ? 1 : 1), (t.dem.n - 1) / 4);
    }

    /* ---- buildings (LOD2): merged per tile, one wall mesh (facade shader) + one roof mesh */
    const PAL = {
      0: ['#e9e1d0', '#e2d5bb', '#d8c9b1', '#e6d2c0', '#d9d4c8', '#f0e9da', '#cfc4b0', '#dfd0a8', '#efe8dc', '#cdbfa5'],
      1: ['#c9ced1', '#b9c2c8', '#d5d8d8', '#aab4ba', '#c6c0b4', '#dfe3e5'],
      2: ['#d9ccb2', '#cfc3a8', '#d8d2c4', '#c7bba3', '#e2dccd'],
      3: ['#a9a69e', '#bdb9ad', '#9e9b94', '#c9c5ba'],
      4: ['#d0c4a6', '#c8bb9c', '#d9d0b8'],
      5: ['#d8d4c8', '#c5c9cc', '#e0d8c2', '#cfd3d5'],
      6: ['#d8cfbc', '#cfc5b0', '#e0dacb'],
      7: ['#c9c5bb', '#b8b6b0'],
    };
    const palC = {};
    Object.keys(PAL).forEach((k) => { palC[k] = PAL[k].map(C); });
    const ROOF_FALLBACK = ['#5b6168', '#6a5a52', '#4c525a', '#7a6a60', '#686e74'].map(C);
    const replacedBy = (x, z, pts) => { // does a hand-built landmark replace this footprint? (TS.luxLandmarks.covers: lat/lon test)
      const lm = TS.luxLandmarks;
      if (!lm || !lm.covers) return false;
      let hit = 0; let tot = 0;
      const test = (px, pz) => { const ll = sceneToLonLat(px, pz); tot++; if (lm.covers(ll.lat, ll.lon, 1.0)) hit++; };
      test(x, z);
      for (let i = 0; i < pts.length && i < 6; i++) test(pts[i][0], pts[i][1]);
      return hit * 2 >= tot;
    };
    function buildBuildings(t) {
      const list = t.bld;
      if (!list || !list.length) return null;
      const wallP = []; const wallN = []; const wallC = []; const wallT = [];
      const col = [0, 0, 0];
      list.forEach((b, bi) => {
        const [kind, roofRGB, wallRGB, levels, ax, az, ay, nv, V, nR, R, nW, W, B] = b;
        const rng = mulberry((hash2(bi * 31 + t.info.i, t.info.j * 17 + 5) * 4294967296) | 0);
        const px = new Float32Array(nv); const py = new Float32Array(nv); const pz = new Float32Array(nv);
        let cx = 0; let cz = 0; let ymin = 1e9; let ymax = -1e9;
        for (let i = 0; i < nv; i++) {
          px[i] = ax / 10 + V[i * 3] / 20 - ox; pz[i] = az / 10 + V[i * 3 + 1] / 20 - oz; py[i] = ay / 10 + V[i * 3 + 2] / 20 - oy;
          cx += px[i]; cz += pz[i]; ymin = Math.min(ymin, py[i]); ymax = Math.max(ymax, py[i]);
        }
        cx /= nv; cz /= nv;
        if (replacedBy(cx, cz, Array.from({ length: Math.min(nv, 6) }, (_, i) => [px[i], pz[i]]))) return;
        // keep clear of the tram (a few buildings stand over the right of way in OSM-less spots)
        const H = ymax - ymin;
        if (H <= STOP_CLEAR_H && atStop(cx, cz)) return;
        const bottom = new Set(B);
        const terr = new Float32Array(nv);
        B.forEach((i) => { terr[i] = gy(px[i], pz[i]); });
        // walls start at the terrain (or the LOD2 ground when that is lower), 0.3 m below
        const yWall = (i) => (bottom.has(i) ? Math.min(py[i], terr[i]) - 0.3 : py[i]);
        let style = 0;
        const tall = H > 14;
        if ((kind === 1 || kind === 6) && tall) style = rng() < 0.55 ? 2 : 3;
        else if (kind === 5 || kind === 3 || kind === 7) style = 3;
        else if (kind === 2) style = rng() < 0.5 ? 3 : 0;
        else if (kind === 4) style = 0;
        else style = H > 14 && rng() < 0.6 ? 1 : (H > 9 && rng() < 0.3 ? 1 : 0);
        const floorH = style === 2 ? 3.8 : (levels > 0 ? clamp(H / levels, 2.8, 4.2) : (style === 3 ? 3.5 : FLOOR_H));
        const palette = palC[kind] || palC[0];
        let wc = wallRGB > 0 ? [((wallRGB >> 16) & 255) / 255, ((wallRGB >> 8) & 255) / 255, (wallRGB & 255) / 255] : palette[Math.floor(rng() * palette.length)];
        if (style === 2) wc = scale3(C('#e4ebee'), 0.9 + rng() * 0.12);
        const seed = rng();
        // roof colour: the median orthophoto colour under the roof, kept in a plausible range
        let rc;
        if (roofRGB >= 0) {
          rc = [((roofRGB >> 16) & 255) / 255, ((roofRGB >> 8) & 255) / 255, (roofRGB & 255) / 255];
          const lum = (rc[0] + rc[1] + rc[2]) / 3;
          const k = clamp(lum, 0.22, 0.72) / (lum || 1);
          rc = [rc[0] * k, rc[1] * k, rc[2] * k];
        } else rc = ROOF_FALLBACK[Math.floor(rng() * ROOF_FALLBACK.length)];
        // centroid for outward normals
        const ccx = cx; const ccz = cz;
        for (let k = 0; k < nW; k++) {
          const i0 = W[k * 3]; const i1 = W[k * 3 + 1]; const i2 = W[k * 3 + 2];
          const ax_ = px[i1] - px[i0]; const ay_ = py[i1] - py[i0]; const az_ = pz[i1] - pz[i0];
          const bx_ = px[i2] - px[i0]; const by_ = py[i2] - py[i0]; const bz_ = pz[i2] - pz[i0];
          let nx = ay_ * bz_ - az_ * by_; let ny = az_ * bx_ - ax_ * bz_; let nz = ax_ * by_ - ay_ * bx_;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const mx = (px[i0] + px[i1] + px[i2]) / 3 - ccx; const mz = (pz[i0] + pz[i1] + pz[i2]) / 3 - ccz;
          if (nx * mx + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          // horizontal direction along the wall for u
          let dx = -nz; let dz = nx; const dl = Math.hypot(dx, dz);
          if (dl < 1e-3) { dx = 1; dz = 0; } else { dx /= dl; dz /= dl; }
          const shade = 0.88 + 0.12 * Math.abs(nx);
          [i0, i1, i2].forEach((i) => {
            wallP.push(px[i], yWall(i), pz[i]); wallN.push(nx, ny, nz);
            wallC.push(wc[0] * shade, wc[1] * shade, wc[2] * shade);
            wallT.push((px[i] * dx + pz[i] * dz) / BAY_W, (py[i] - ymin) / floorH, style, seed);
          });
        }
        for (let k = 0; k < nR; k++) {
          const i0 = R[k * 3]; const i1 = R[k * 3 + 1]; const i2 = R[k * 3 + 2];
          const ax_ = px[i1] - px[i0]; const ay_ = py[i1] - py[i0]; const az_ = pz[i1] - pz[i0];
          const bx_ = px[i2] - px[i0]; const by_ = py[i2] - py[i0]; const bz_ = pz[i2] - pz[i0];
          let nx = ay_ * bz_ - az_ * by_; let ny = az_ * bx_ - ax_ * bz_; let nz = ax_ * by_ - ay_ * bx_;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const flat = ny > 0.97;
          const k2 = flat ? 0.9 : 1;
          [i0, i1, i2].forEach((i) => {
            wallP.push(px[i], py[i], pz[i]); wallN.push(nx, ny, nz);
            wallC.push(rc[0] * k2, rc[1] * k2, rc[2] * k2); wallT.push(px[i] / 2.5, pz[i] / 2.5, 9, seed);
          });
        }
        void col;
      });
      if (!wallP.length) return null;
      const grp = new T.Group();
      if (wallP.length) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(wallP, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(wallN, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(wallC, 3));
        g.setAttribute('aTex', new T.Float32BufferAttribute(wallT, 4));
        g.computeBoundingSphere();
        const m = new T.Mesh(g, matWall); m.castShadow = Q.castShadow; m.receiveShadow = true; grp.add(m);
      }
      return grp;
    }

    /* ---- canopy trees from the LiDAR (t/<i>_<j>.bin: u16 x, u16 z (0.1 m from the tile corner), u8 height (0.25 m), u8 crown radius (0.05 m), u16 rgb565) */
    const matTree = new T.MeshLambertMaterial({ vertexColors: true });
    mats.push(matTree);
    const tmpM = new T.Matrix4(); const tmpQ = new T.Quaternion(); const tmpP = new T.Vector3(); const tmpS = new T.Vector3(); const tmpC = new T.Color(); const yAxis = new T.Vector3(0, 1, 0);
    function buildTileTrees(t) {
      if (!t.trees || t.trees.byteLength < 8) return null;
      const dv = new DataView(t.trees);
      const n = Math.floor(t.trees.byteLength / 8);
      const x0 = t.info.i * TS_ - ox; const z0 = t.info.j * TS_ - oz;
      const items = { dec: [], con: [] };
      for (let k = 0; k < n; k++) {
        if (Q.trees < 1 && hash2(k * 7 + t.info.i, t.info.j * 13 + 1) > Q.trees) continue;
        const lx = dv.getUint16(k * 8, true) / 10; const lz = dv.getUint16(k * 8 + 2, true) / 10;
        const h = dv.getUint8(k * 8 + 4) / 4; const r = dv.getUint8(k * 8 + 5) / 20; const c565 = dv.getUint16(k * 8 + 6, true);
        const x = x0 + lx; const z = z0 + lz;
        if (nearest(x, z).d < 4.6) continue;
        const cr = ((c565 >> 11) & 31) / 31; const cg = ((c565 >> 5) & 63) / 63; const cb = (c565 & 31) / 31;
        const lum = (cr + cg + cb) / 3;
        const con = lum < 0.26 && cg > cr * 1.05 && hash2(k, t.info.i * 5 + t.info.j) < 0.75;
        items[con ? 'con' : 'dec'].push([x, z, h, r, cr, cg, cb]);
      }
      const all = items.dec.map((e) => [0, e]).concat(items.con.map((e) => [1, e]));
      if (!all.length) return null;
      const im = new T.InstancedMesh(treeTplBoth, matTree, all.length);
      im.userData.camObstacle = true;   // the chase camera avoids parking inside a canopy
      im.userData.sharedGeo = true;
      const kinds = new Float32Array(all.length);
      all.forEach(([kind, it], k) => {
        const y = gy(it[0], it[1]) - 0.15;
        const rot = hash2(k * 3, 11) * 6.283;
        tmpQ.setFromAxisAngle(yAxis, rot);
        tmpP.set(it[0], y, it[1]);
        tmpS.set(it[3] * (0.9 + 0.2 * hash2(k, 5)), it[2], it[3] * (0.9 + 0.2 * hash2(k, 9)));
        tmpM.compose(tmpP, tmpQ, tmpS);
        im.setMatrixAt(k, tmpM);
        kinds[k] = kind;
        const lum = (it[4] + it[5] + it[6]) / 3;
        const boost = clamp(0.34 / (lum + 0.02), 0.9, 2.1);
        tmpC.setRGB(clamp(it[4] * boost * 0.85, 0.05, 0.75), clamp(it[5] * boost * 1.08, 0.08, 0.85), clamp(it[6] * boost * 0.7, 0.03, 0.6));
        im.setColorAt(k, tmpC);
      });
      im.geometry = treeTplBoth.clone();
      im.userData.sharedGeo = false;
      im.geometry.setAttribute('iKind', new T.InstancedBufferAttribute(kinds, 1));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = Q.castShadow;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      const grp = new T.Group();
      grp.add(im);
      return grp;
    }
    // unit tree templates: height 1, crown radius 1 (scaled per instance)
    function unitTree(conifer) {
      const m = new Mesher();
      const trunk = C('#5a4636');
      const seg = 5;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2; const a1 = ((k + 1) / seg) * Math.PI * 2; const am = (a0 + a1) / 2;
        const nx = Math.cos(am); const nz = Math.sin(am);
        const rr = 0.07;
        const i0 = m.vert(Math.cos(a0) * rr, 0, Math.sin(a0) * rr, nx, 0, nz, 0, 0, trunk);
        const i1 = m.vert(Math.cos(a1) * rr, 0, Math.sin(a1) * rr, nx, 0, nz, 1, 0, trunk);
        const i2 = m.vert(Math.cos(a1) * rr * 0.7, 0.45, Math.sin(a1) * rr * 0.7, nx, 0, nz, 1, 1, trunk);
        const i3 = m.vert(Math.cos(a0) * rr * 0.7, 0.45, Math.sin(a0) * rr * 0.7, nx, 0, nz, 0, 1, trunk);
        m.quad(i0, i3, i2, i1);
      }
      if (conifer) {
        const lo = C('#1c3b2a'); const hi = C('#3a7550');
        const lv = 3;
        for (let k = 0; k < lv; k++) {
          const y0 = 0.14 + k * 0.2; const y1 = y0 + 0.5 - k * 0.06; const r = 1 - k * 0.22;
          for (let s = 0; s < 7; s++) {
            const a0 = (s / 7) * Math.PI * 2; const a1 = ((s + 1) / 7) * Math.PI * 2; const am = (a0 + a1) / 2;
            const nl = Math.hypot(y1 - y0, r); const nx = Math.cos(am) * (y1 - y0) / nl; const nz = Math.sin(am) * (y1 - y0) / nl; const ny = r / nl;
            const i0 = m.vert(Math.cos(a0) * r, y0, Math.sin(a0) * r, nx, ny, nz, 0, 0, mix3(lo, hi, 0.25 + k * 0.2));
            const i1 = m.vert(Math.cos(a1) * r, y0, Math.sin(a1) * r, nx, ny, nz, 1, 0, mix3(lo, hi, 0.25 + k * 0.2));
            const i2 = m.vert(0, y1, 0, nx, ny, nz, 0.5, 1, mix3(lo, hi, 0.8));
            m.tri(i0, i2, i1);
          }
        }
      } else {
        const lo = C('#4d7a35'); const hi = C('#9bbf55');
        const geo = new T.IcosahedronGeometry(1, 1);
        const pos = geo.attributes.position; const nor = geo.attributes.normal;
        const base = m.count;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
          const j = 0.88 + 0.24 * hash2(Math.round(x * 40) + Math.round(z * 31), Math.round(y * 37));
          const tt = clamp(y * 0.5 + 0.5, 0, 1);
          m.vert(x * j, 0.62 + y * 0.38 * j, z * j, nor.getX(i), nor.getY(i), nor.getZ(i), 0, 0, mix3(lo, hi, tt * 0.8 + 0.1));
        }
        for (let i = 0; i < pos.count; i += 3) m.tri(base + i, base + i + 1, base + i + 2);
        geo.dispose();
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(m.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(m.c, 3));
      g.setIndex(m.i);
      return g;
    }
    const treeTplDec = unitTree(false);
    const treeTplCon = unitTree(true);
    // both shapes in one geometry; the instance's iKind picks which one is drawn (the other collapses to a point in the vertex shader)
    const treeTplBoth = (() => {
      const g = new T.BufferGeometry();
      const parts = [treeTplDec, treeTplCon];
      let nv = 0; parts.forEach((p) => { nv += p.attributes.position.count; });
      const P = new Float32Array(nv * 3); const N = new Float32Array(nv * 3); const Cc = new Float32Array(nv * 3); const K = new Float32Array(nv);
      const idx = [];
      let o = 0;
      parts.forEach((p, kind) => {
        const n = p.attributes.position.count;
        P.set(p.attributes.position.array, o * 3); N.set(p.attributes.normal.array, o * 3); Cc.set(p.attributes.color.array, o * 3);
        for (let i = 0; i < n; i++) K[o + i] = kind;
        const ix = p.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + o);
        o += n;
      });
      g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(N, 3)); g.setAttribute('color', new T.BufferAttribute(Cc, 3)); g.setAttribute('aKind', new T.BufferAttribute(K, 1));
      g.setIndex(idx);
      return g;
    })();
    matTree.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKind;\nattribute float iKind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(aKind - iKind) > 0.5) transformed = vec3(0.0);');
    };
    matTree.customProgramCacheKey = () => 'lt-tree-v1';

    function buildTile(t, s) {
      const group = new T.Group();
      group.name = 'lt-tile-' + t.key;
      const stride = desiredStride(t, s);
      const geom = buildTerrain(t, stride);
      const tex = makeTileTexture(t);
      const mat = new T.MeshLambertMaterial({ map: tex || null, color: tex ? GROUND_TINT : new T.Color('#6f8f48'), side: T.DoubleSide, vertexColors: true });
      const mesh = new T.Mesh(geom, mat);
      mesh.receiveShadow = false;   // the orthophoto already has real shadows; realtime ones on top turned streets black
      mesh.renderOrder = -1;
      group.add(mesh);
      t.mesh = mesh; t.tex = tex; t.mat = mat; t.stride = stride;
      try { t.bgroup = buildBuildings(t); if (t.bgroup) group.add(t.bgroup); } catch (e) { console.warn(TAG + 'buildings ' + t.key, e); }
      try { t.tgroup = buildTileTrees(t); if (t.tgroup) group.add(t.tgroup); } catch (e) { console.warn(TAG + 'trees ' + t.key, e); }
      try { buildDecksFor(t, group); } catch (e) { console.warn(TAG + 'decks ' + t.key, e); }
      try { buildCapsFor(t, group); } catch (e) { console.warn(TAG + 'caps ' + t.key, e); }
      t.group = group;
      root.add(group);
      t.built = true;
    }
    function restride(t, stride) {
      const g = buildTerrain(t, stride);
      t.mesh.geometry.dispose();
      t.mesh.geometry = g;
      t.stride = stride;
    }
    function disposeTile(t) {
      t.disposed = true;
      tiles.delete(t.key);
      if (t.group) {
        root.remove(t.group);
        t.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
      }
      if (t.tex) t.tex.dispose();
      if (t.mat) t.mat.dispose();
      if (t.capMat) t.capMat.dispose();
      if (t.img && t.img.close) { try { t.img.close(); } catch (e) { /* ignore */ } }
      t.img = null; t.dem = null; t.bld = null; t.trees = null;
    }

    /* ---- far ring: coarse terrain (20 m nodes) + 3.5 m/px orthophoto + simplified buildings, so the world has no visible edge */
    const FAR_T = geo.farTile || 640; const FAR_N = geo.farNode || 20; const FAR_PAD = 2.5;
    const FAR_R = { high: 1700, medium: 1350, low: 950 }[quality];
    const farInfo = Object.keys(geo.far || {}).map((key) => {
      const [i, j] = key.split('_').map(Number);
      return { key, i, j, cx: (i + 0.5) * FAR_T - ox, cz: (j + 0.5) * FAR_T - oz, px: geo.far[key].px };
    });
    const farTiles = new Map();
    let farLoading = 0;
    const farMat = (tex) => new T.MeshLambertMaterial({ map: tex || null, color: tex ? GROUND_TINT : new T.Color('#6f8f48'), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 });
    function startFar(info) {
      const f = { key: info.key, info, state: 'loading', group: null, disposed: false };
      farTiles.set(info.key, f);
      farLoading++;
      const ver = geo.v || 1;
      const get = (url, kind) => fetch(GEO_BASE + url + '?v=' + ver).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return kind === 'buf' ? r.arrayBuffer() : kind === 'blob' ? r.blob() : r.json(); }).then(counted);
      const pH = get('f/h_' + info.key + '.bin', 'buf').then(decodeHeights);
      const pO = get('f/o_' + info.key + '.webp', 'blob').then((b) => createImageBitmap(b)).catch(() => null);
      const pB = info.b ? get('f/b_' + info.key + '.json', 'json').catch(() => []) : Promise.resolve([]);   // only tiles that have far buildings
      Promise.all([pH, pO, pB]).then(([dem, img, bl]) => {
        farLoading--;
        if (f.disposed) { if (img && img.close) img.close(); return; }
        f.dem = dem; f.img = img; f.bl = bl; f.state = 'ready';
      }).catch((e) => { farLoading--; f.state = 'failed'; console.warn(TAG + 'far tile ' + info.key + ' failed', e); });
    }
    function buildFar(f) {
      const info = f.info; const n = f.dem.n;
      const pos = new Float32Array(n * n * 3); const uv = new Float32Array(n * n * 2); const nor = new Float32Array(n * n * 3);
      const x0 = info.i * FAR_T - ox; const z0 = info.j * FAR_T - oz;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const wx_ = x0 + c * FAR_N; const wz_ = z0 + r * FAR_N;
        const inNear = geo.tiles[Math.floor((wx_ + ox) / TS_) + '_' + Math.floor((wz_ + oz) / TS_)] !== undefined;   // the detailed tiles cover this: stay far below them
        pos[k * 3] = wx_; pos[k * 3 + 1] = f.dem.h[k] - oy - (inNear ? 14 : 1.5); pos[k * 3 + 2] = wz_;
        uv[k * 2] = (c * FAR_N + FAR_PAD) / (FAR_T + 2 * FAR_PAD); uv[k * 2 + 1] = (r * FAR_N + FAR_PAD) / (FAR_T + 2 * FAR_PAD);
      }
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const dx = pos[(r * n + Math.min(n - 1, c + 1)) * 3 + 1] - pos[(r * n + Math.max(0, c - 1)) * 3 + 1];
        const dz = pos[(Math.min(n - 1, r + 1) * n + c) * 3 + 1] - pos[(Math.max(0, r - 1) * n + c) * 3 + 1];
        const nl = Math.hypot(dx / (2 * FAR_N), 1, dz / (2 * FAR_N));
        nor[k * 3] = -dx / (2 * FAR_N) / nl; nor[k * 3 + 1] = 1 / nl; nor[k * 3 + 2] = -dz / (2 * FAR_N) / nl;
      }
      const idx = [];
      for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const a = r * n + c; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setIndex(new T.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      f.tex = null;
      if (f.img) { f.tex = new T.Texture(f.img); f.tex.flipY = false; f.tex.colorSpace = T.SRGBColorSpace; f.tex.wrapS = f.tex.wrapT = T.ClampToEdgeWrapping; f.tex.anisotropy = 2; f.tex.needsUpdate = true; }
      f.mat = farMat(f.tex);
      const grp = new T.Group();
      const mesh = new T.Mesh(g, f.mat); mesh.renderOrder = -2; grp.add(mesh);
      // simplified buildings (extruded footprints)
      if (f.bl && f.bl.length) {
        const wp = []; const wn = []; const wc = []; const rp = []; const rn = []; const rc = [];
        f.bl.forEach((b, bi) => {
          const [zmin, zmax, flat, kind] = b;
          const ring = []; for (let k = 0; k < flat.length; k += 2) ring.push([flat[k] - ox, flat[k + 1] - oz]);
          if (ring.length < 3) return;
          const y0 = zmin - oy - 0.5; const y1 = zmax - oy;
          const pal = palC[kind] || palC[0];
          const wcol = pal[(bi * 7) % pal.length]; const rcol = [0.42, 0.42, 0.42];
          const ar = signedArea(ring);
          for (let k = 0; k < ring.length; k++) {
            const p0 = ring[k]; const p1 = ring[(k + 1) % ring.length];
            const dx = p1[0] - p0[0]; const dz = p1[1] - p0[1]; const l = Math.hypot(dx, dz) || 1;
            const nx = (dz / l) * (ar < 0 ? -1 : 1); const nz = (-dx / l) * (ar < 0 ? -1 : 1);
            const sh = 0.85 + 0.15 * Math.abs(nx);
            [[p0, y0], [p1, y0], [p1, y1], [p0, y0], [p1, y1], [p0, y1]].forEach((e) => { wp.push(e[0][0], e[1], e[0][1]); wn.push(nx, 0, nz); wc.push(wcol[0] * sh, wcol[1] * sh, wcol[2] * sh); });
          }
          try {
            const tris = T.ShapeUtils.triangulateShape(ring.map((q) => new T.Vector2(q[0], q[1])), []);
            tris.forEach((tr) => tr.forEach((vi) => { rp.push(ring[vi][0], y1 + 0.02, ring[vi][1]); rn.push(0, 1, 0); rc.push(rcol[0], rcol[1], rcol[2]); }));
          } catch (e) { /* skip roof */ }
        });
        const mk = (P, N, Cc) => { const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g2.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g2.setAttribute('color', new T.Float32BufferAttribute(Cc, 3)); g2.computeBoundingSphere(); return new T.Mesh(g2, matMisc); };
        if (wp.length || rp.length) grp.add(mk(wp.concat(rp), wn.concat(rn), wc.concat(rc)));
      }
      f.group = grp; root.add(grp); f.state = 'built';
    }
    function disposeFar(f) {
      f.disposed = true; farTiles.delete(f.key);
      if (f.group) { root.remove(f.group); f.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      if (f.tex) f.tex.dispose(); if (f.mat) f.mat.dispose();
      if (f.img && f.img.close) { try { f.img.close(); } catch (e) { /* ignore */ } }
    }
    const farPos = new T.Vector3();
    function ensureFar(s, camera, all) {
      const f0 = frame(s);
      farPos.set(f0.pos.x, 0, f0.pos.z);
      const near = [];
      farInfo.forEach((info) => {
        const dx = Math.max(Math.abs(info.cx - farPos.x) - FAR_T / 2, 0); const dz = Math.max(Math.abs(info.cz - farPos.z) - FAR_T / 2, 0);
        const d = Math.hypot(dx, dz);
        if (d < FAR_R) near.push([d, info]);
      });
      near.sort((a, b) => a[0] - b[0]);
      const keep = new Set(near.map((e) => e[1].key));
      Array.from(farTiles.values()).forEach((f) => { if (!keep.has(f.key)) { const dx = Math.max(Math.abs(f.info.cx - farPos.x) - FAR_T / 2, 0); const dz = Math.max(Math.abs(f.info.cz - farPos.z) - FAR_T / 2, 0); if (Math.hypot(dx, dz) > FAR_R + 500) disposeFar(f); } });
      for (const e of near) { if (!farTiles.has(e[1].key) && (all || farLoading < 2)) startFar(e[1]); }
      let n = 0;
      for (const e of near) { const f = farTiles.get(e[1].key); if (f && f.state === 'ready' && (all || n < 1)) { buildFar(f); n++; } }
    }

    /* ---- ribbon helper along a point list ([{x,y,z}]) */
    function ribbon(m, pts, halfW, col, o) {
      const opts = o || {};
      const u0 = opts.u0 !== undefined ? opts.u0 : 0;
      const u1 = opts.u1 !== undefined ? opts.u1 : 1;
      const vs = opts.vScale || 8;
      let dist = opts.v0 || 0;
      const base = m.count;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x; let dz = b.z - a.z;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const nx = -dz; const nz = dx;
        if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        const hw = typeof halfW === 'function' ? halfW(i) : halfW;
        const yl = opts.yAt ? opts.yAt(pts[i].x - nx * hw, pts[i].z - nz * hw, pts[i], i) : pts[i].y;
        const yr = opts.yAt ? opts.yAt(pts[i].x + nx * hw, pts[i].z + nz * hw, pts[i], i) : pts[i].y;
        const lift = opts.lift || 0;
        m.vert(pts[i].x - nx * hw, yl + lift, pts[i].z - nz * hw, 0, 1, 0, u0, dist / vs, col);
        m.vert(pts[i].x + nx * hw, yr + lift, pts[i].z + nz * hw, 0, 1, 0, u1, dist / vs, col);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = base + i * 2;
        m.quad(a, a + 1, a + 3, a + 2);
      }
      return pts;
    }
    function densify(raw, maxSeg) {
      const out = [];
      for (let i = 0; i < raw.length; i++) {
        out.push({ x: raw[i][0], z: raw[i][1] });
        if (i < raw.length - 1) {
          const dx = raw[i + 1][0] - raw[i][0]; const dz = raw[i + 1][1] - raw[i][1];
          const n = Math.floor(Math.hypot(dx, dz) / maxSeg);
          for (let k = 1; k <= n; k++) out.push({ x: raw[i][0] + (dx * k) / (n + 1), z: raw[i][1] + (dz * k) / (n + 1) });
        }
      }
      return out;
    }

    /* roof helpers (OSM footprints that LOD2 does not cover) */
    function obb(ring) {
      let best = null;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]; const b = ring[(i + 1) % ring.length];
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const c = Math.cos(ang); const s = Math.sin(ang);
        let x0 = 1e9; let x1 = -1e9; let z0 = 1e9; let z1 = -1e9;
        ring.forEach((p) => { const u = p[0] * c + p[1] * s; const v = -p[0] * s + p[1] * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); });
        const area = (x1 - x0) * (z1 - z0);
        if (!best || area < best.area) best = { ang, c, s, x0, x1, z0, z1, area };
      }
      return best;
    }
    const signedArea = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const FLAT_ROOF = C('#8d8f8e');
    function addOsmBuilding(batch, b, ci, idx) {
      const ring0 = sceneRing(b[5]);
      const meta = b[0];
      const kind = meta & 7;
      const H = b[1] / 10;
      const minH = b[2] / 10;
      const ring = signedArea(ring0) > 0 ? ring0.slice().reverse() : ring0;
      for (let i = 0; i < ring.length; i++) if (nearest(ring[i][0], ring[i][1]).d < 3.4) return false;
      const cc = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      if (replacedBy(cc[0], cc[1], ring)) return false;
      if (H <= STOP_CLEAR_H && atStop(cc[0], cc[1])) return false;
      const rng = mulberry(hash2(ci * 977 + idx, 17) * 4294967296);
      let gMin = 1e9; let gSum = 0;
      ring.forEach((p) => { const g = gy(p[0], p[1]); gMin = Math.min(gMin, g); gSum += g; });
      const gAvg = gSum / ring.length;
      const base = Math.min(gMin, gAvg) - 0.5;
      const top = gAvg + H;
      const palette = palC[kind] || palC[0];
      const wallCol = b[3] ? hexRGB(b[3]) : palette[Math.floor(rng() * palette.length)];
      const area = signedArea(ring);
      const seed = rng();
      const style = kind === 1 || kind === 5 ? 3 : 0;
      let cum = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]; const q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0]; const dz = q[1] - p[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const sgn = area < 0 ? -1 : 1;
        const nx = (dz / len) * sgn; const nz = (-dx / len) * sgn;
        const u0 = cum / BAY_W; const u1 = (cum + len) / BAY_W;
        const wallBase = minH > 0 ? gAvg + minH : base;
        const vA = (wallBase - gMin) / FLOOR_H; const vB = (top - gMin) / FLOOR_H;
        const shade = 0.9 + 0.1 * Math.abs(nx);
        const cl = [wallCol[0] * shade, wallCol[1] * shade, wallCol[2] * shade];
        const W = batch.wall;
        const ids = [[p, wallBase, u0, vA], [q, wallBase, u1, vA], [q, top, u1, vB], [p, top, u0, vB]].map((e) => W.vert(e[0][0], e[1], e[0][1], nx, 0, nz, e[2], e[3], cl));
        W.quad(ids[0], ids[1], ids[2], ids[3]);
        void style; void seed;
        cum += len;
      }
      const contour = ring.map((p) => new T.Vector2(p[0], p[1]));
      let tris = null;
      try { tris = T.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = null; }
      const baseIdx = batch.roof.count;
      ring.forEach((p) => batch.roof.vert(p[0], top + 0.02, p[1], 0, 1, 0, p[0] / 3, p[1] / 3, FLAT_ROOF));
      if (tris) tris.forEach((tr) => batch.roof.tri(baseIdx + tr[0], baseIdx + tr[2], baseIdx + tr[1]));
      return true;
    }

    /* ---- tram crossings of the roads: [t0, t1] arc-length intervals of a road that lie inside the tram corridor.  `cross` = the road runs across the
       tracks (cars stop in front of it while the tram is near), `along` = it runs along the rails (no car ever drives there) */
    const corrLo = (s) => slotLatL(s) - 1.4; const corrHi = SLOT_IN_R + 1.4;
    function findCrossings(rd) {
      const step = 1.5;
      let runStart = -1; let runAlong = 0; let runS = 0; let runN = 0;
      const flush = (tEnd) => {
        if (runStart < 0) return;
        const len = tEnd - runStart;
        if (runAlong / Math.max(1, runN) > 0.5 && len > 8) rd.along.push([runStart - 1, tEnd + 1]);
        else if (len < 40) rd.cross.push({ t0: runStart - 0.8, t1: tEnd + 0.8, s: runS / Math.max(1, runN) });
        runStart = -1; runAlong = 0; runS = 0; runN = 0;
      };
      let j = 1;
      for (let tt = 0; tt <= rd.len; tt += step) {
        while (j < rd.cum.length - 1 && rd.cum[j] < tt) j++;
        const a = rd.pts[j - 1]; const b = rd.pts[j];
        const u = (tt - rd.cum[j - 1]) / (rd.cum[j] - rd.cum[j - 1] || 1);
        const x = lerp(a.x, b.x, u); const z = lerp(a.z, b.z, u);
        const q = nearest(x, z);
        if (q.d < 14 && q.lat > corrLo(q.s) && q.lat < corrHi) {
          const fr = frame(q.s);
          const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
          const along = Math.abs((dx * fr.tangent.x + dz * fr.tangent.z) / dl) > 0.8 ? 1 : 0;
          if (runStart < 0) runStart = tt;
          runAlong += along; runS += q.s; runN++;
        } else flush(tt);
      }
      flush(rd.len);
    }

    /* ---- roads: only what is not already in the orthophoto (bridges) + data for traffic */
    function buildRoads(ci, d, batch, lampOut, roadsOut) {
      d.r.forEach((rd, ri) => {
        const cls = rd[0]; const flags = rd[1]; const width = rd[3] / 10;
        if (flags & 2) return;
        const raw = decodeFlat(rd[4]).map(toScene);
        if (raw.length < 2) return;
        const pts = densify(raw, 9);
        const bridge = (flags & 1) !== 0;
        let total = 0; const cumLen = [0];
        for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cumLen.push(total); }
        let yA = 0; let yB = 0;
        if (bridge) {
          yA = gy(pts[0].x, pts[0].z); yB = gy(pts[pts.length - 1].x, pts[pts.length - 1].z);
          const q0 = nearest(pts[0].x, pts[0].z); const q1 = nearest(pts[pts.length - 1].x, pts[pts.length - 1].z);
          if (q0.d < 40 && q1.d < 40) { yA = q0.y - 0.5; yB = q1.y - 0.5; }
        }
        pts.forEach((p, i) => { p.y = bridge ? lerp(yA, yB, total ? cumLen[i] / total : 0) : 0; });
        if (!bridge && cls >= 1 && cls <= 4 && pts.length >= 2 && total > 30) {
          const rdo = { pts, cum: cumLen, len: total, hw: width / 2, oneway: (flags & 4) !== 0, cls, cross: [], along: [] };
          findCrossings(rdo);
          roadsOut.push(rdo);
        }
        if (!bridge && Q.lamps && cls >= 1 && cls <= 3) {
          let acc = 14;
          for (let i = 1; i < pts.length; i++) {
            const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
            acc += seg;
            if (acc >= 34) {
              acc = 0;
              const dl = seg || 1; const nxv = -(pts[i].z - pts[i - 1].z) / dl; const nzv = (pts[i].x - pts[i - 1].x) / dl;
              const side = (lampOut.n++ % 2) ? 1 : -1;
              const lx = pts[i].x + nxv * side * (width / 2 + 1.2); const lz = pts[i].z + nzv * side * (width / 2 + 1.2);
              if (nearest(lx, lz).d > 5.5 && roadMargin(lx, lz) > 0.4) lampOut.list.push([lx, lz, -nxv * side, -nzv * side]);   // never in another lane
            }
          }
        }
      });
    }
    function addLamp(batch, p) {
      const [x, z, ax, az] = p;
      const y = gy(x, z);
      const col = C('#464b50');
      addBeam(batch.misc, [x, y, z], [x, y + 7.2, z], 0.14, col);
      addBeam(batch.misc, [x, y + 7.2, z], [x + ax * 1.6, y + 7.35, z + az * 1.6], 0.1, col);
      addBox(batch.glowLamp, x + ax * 1.6, y + 7.25, z + az * 1.6, 0.5, 0.12, 0.28, Math.atan2(az, ax), C('#fff3d6'));
    }

    /* ---- the tram: bed of both tracks */
    const SURF_COL = [[0.3, 0.45, 0.2], [0.42, 0.42, 0.41], [0.25, 0.26, 0.28], [0.4, 0.38, 0.36]];
    function bedStrip(batch, getFrame, a, b, surf) {
      const step = 3;
      const n = Math.max(1, Math.ceil((b - a) / step));
      const grass = surf === 0;
      const col = SURF_COL[surf] || SURF_COL[1];
      const pts = [];
      for (let i = 0; i <= n; i++) { const f = getFrame(a + ((b - a) * i) / n); pts.push({ x: f.pos.x, y: f.pos.y + (grass ? -0.11 : -0.02), z: f.pos.z }); }
      ribbon(batch.bed, pts, grass ? 1.75 : 1.65, col, { vScale: 3, u0: 0, u1: 1 });
      if (grass) {
        [-1, 1].forEach((sd) => {
          const edge = pts.map((p, i) => { const q0 = pts[Math.max(0, i - 1)]; const q1 = pts[Math.min(pts.length - 1, i + 1)]; const dl = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1; return { x: p.x + (-(q1.z - q0.z) / dl) * 1.78 * sd, z: p.z + ((q1.x - q0.x) / dl) * 1.78 * sd, y: p.y - 0.06 + 0.11 }; });
          ribbon(batch.bed, edge, 0.1, [0.7, 0.7, 0.68], { vScale: 3 });
        });
      }
    }
    function buildTram(ci, sa, sb, batch) {
      lt.segs.forEach((sg) => {
        const a = Math.max(sa, sg.s0); const b = Math.min(sb, sg.s1);
        if (b - a < 0.5) return;
        bedStrip(batch, frame, a, b, sg.surf);
        if (hasOpp) {
          const oa = Math.max(a, track.opposite.from); const ob = Math.min(b, track.opposite.to);
          if (ob - oa > 0.5) bedStrip(batch, track.opposite.frameAt, oa, ob, sg.surf);
        }
      });
    }

    /* ---- structures: tunnel box + portals, underpass / tunnel-approach walls, concrete bridge decks with piers */
    const CONC = C('#b9b7b0'); const CONC_D = C('#8f8d87'); const CONC_L = C('#cfcdc6'); const TUN_WALL = C('#a8a6a0'); const TUN_CEIL = C('#c4c2bb');
    const jit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    /* vertical wall along the line at lateral offset latFn(s), from yBot(f,x,z) to yTop(f,x,z); the lit face looks towards `towards` (+1 = right) */
    function wallStrip(m, sA, sB, latFn, yBot, yTop, col, towards, o) {
      const step = (o && o.step) || 2;
      const n = Math.max(1, Math.ceil((sB - sA) / step));
      const base = m.count;
      let dist = 0; let prev = null;
      for (let i = 0; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n;
        const f = frame(s);
        const lat = latFn(s);
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        if (prev) dist += Math.hypot(x - prev[0], z - prev[1]);
        prev = [x, z];
        const yb = yBot(f, x, z); const yt = yTop(f, x, z);
        const k = 0.97 + 0.06 * hash2(i, Math.round(sA));
        const c = jit(col, k);
        m.vert(x, yb, z, f.right.x * towards, 0, f.right.z * towards, dist / 4, 0, c);
        m.vert(x, yt, z, f.right.x * towards, 0, f.right.z * towards, dist / 4, 1, c);
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; m.quad(a, a + 2, a + 3, a + 1); }
    }
    /* horizontal ribbon between two lateral offsets at height yFn(f) (normal up or down) */
    function flatStrip(m, sA, sB, lat0, lat1, yFn, col, up, o) {
      const step = (o && o.step) || 2;
      const n = Math.max(1, Math.ceil((sB - sA) / step));
      const base = m.count;
      for (let i = 0; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n;
        const f = frame(s);
        const l0 = typeof lat0 === 'function' ? lat0(s) : lat0; const l1 = typeof lat1 === 'function' ? lat1(s) : lat1;
        const y = yFn(f);
        m.vert(f.pos.x + f.right.x * l0, y, f.pos.z + f.right.z * l0, 0, up ? 1 : -1, 0, 0, i, col);
        m.vert(f.pos.x + f.right.x * l1, y, f.pos.z + f.right.z * l1, 0, up ? 1 : -1, 0, 1, i, col);
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; m.quad(a, a + 1, a + 3, a + 2); }
    }
    const rawG = (x, z) => { const h = demAt(x, z); return h !== h ? track.terrainHeightAt(x, z) : h; };
    function lightsAlong(batch, sA, sB, y, every) {
      if (!Q.lamps) return;
      for (let s = sA + every / 2; s < sB; s += every) {
        const f = frame(s);
        const lat = (slotLatL(s) + SLOT_IN_R) / 2;
        addBox(batch.glowLamp, f.pos.x + f.right.x * lat, f.pos.y + 5.62 + y, f.pos.z + f.right.z * lat, 0.35, 0.08, 1.4, Math.atan2(f.right.z, f.right.x) + Math.PI / 2, C('#fff1cf'));
      }
    }
    function buildTunnel(sl, batch) {
      const CEIL = 5.7;
      const sA = sl.s0; const sB = sl.s1;
      wallStrip(batch.misc, sA, sB, slotLatL, (f) => f.pos.y - 0.45, (f) => f.pos.y + CEIL, TUN_WALL, 1);
      wallStrip(batch.misc, sA, sB, () => SLOT_IN_R, (f) => f.pos.y - 0.45, (f) => f.pos.y + CEIL, TUN_WALL, -1);
      flatStrip(batch.misc, sA, sB, (s) => slotLatL(s) - 0.4, SLOT_IN_R + 0.4, (f) => f.pos.y + CEIL, TUN_CEIL, false);
      flatStrip(batch.misc, sA, sB, slotLatL, SLOT_IN_R, (f) => f.pos.y - 0.3, [0.5, 0.5, 0.48], true);
      // ceiling roof slab seen from above is hidden by the ground; a light strip every 10 m
      lightsAlong(batch, sA, sB, 0, 10);
      // kerb stripes along both walls (a darker plinth)
      wallStrip(batch.misc, sA, sB, (s) => slotLatL(s) + 0.02, (f) => f.pos.y - 0.45, (f) => f.pos.y + 0.55, CONC_D, 1);
      wallStrip(batch.misc, sA, sB, () => SLOT_IN_R - 0.02, (f) => f.pos.y - 0.45, (f) => f.pos.y + 0.55, CONC_D, -1);
    }
    function lightsFix() { /* lamps are placed at the tunnel ceiling by lightsAlong (y fixed per frame below) */ }
    void lightsFix;
    function buildPortal(s, outward, batch) {
      // headwall in the plane across the line at s; `outward` = +1 when the open air lies at larger s
      const f = frame(s);
      const lL = slotLatL(s) - 1.9; const lR = SLOT_IN_R + 1.9;
      const oL = slotLatL(s); const oR = SLOT_IN_R;
      const x = f.pos.x; const z = f.pos.z;
      const P = (lat, y) => [x + f.right.x * lat, y, z + f.right.z * lat];
      const nrm = [f.tangent.x * outward, 0, f.tangent.z * outward];
      const nl = Math.hypot(nrm[0], nrm[2]) || 1; nrm[0] /= nl; nrm[2] /= nl;
      const yb = f.pos.y - 0.6; const yo = f.pos.y + 5.7;
      const top = Math.max(rawG(x, z) + 0.6, f.pos.y + 7.4);
      const q = (a, b, c, d, col) => {
        const M = batch.misc;
        const i0 = M.vert(a[0], a[1], a[2], nrm[0], 0, nrm[2], 0, 0, col); const i1 = M.vert(b[0], b[1], b[2], nrm[0], 0, nrm[2], 1, 0, col);
        const i2 = M.vert(c[0], c[1], c[2], nrm[0], 0, nrm[2], 1, 1, col); const i3 = M.vert(d[0], d[1], d[2], nrm[0], 0, nrm[2], 0, 1, col);
        M.quad(i0, i1, i2, i3);
      };
      q(P(lL, yb), P(oL, yb), P(oL, top), P(lL, top), CONC);
      q(P(oR, yb), P(lR, yb), P(lR, top), P(oR, top), CONC);
      q(P(oL, yo), P(oR, yo), P(oR, top), P(oL, top), CONC);
      // light concrete frame around the opening (0.5 m wide, standing 0.12 m proud)
      const pr = (v) => [nrm[0] * 0.12, 0, nrm[2] * 0.12].map((d, i) => v[i] + d);
      q(pr(P(oL - 0.5, yb)), pr(P(oL, yb)), pr(P(oL, yo + 0.5)), pr(P(oL - 0.5, yo + 0.5)), CONC_L);
      q(pr(P(oR, yb)), pr(P(oR + 0.5, yb)), pr(P(oR + 0.5, yo + 0.5)), pr(P(oR, yo + 0.5)), CONC_L);
      q(pr(P(oL - 0.5, yo)), pr(P(oR + 0.5, yo)), pr(P(oR + 0.5, yo + 0.5)), pr(P(oL - 0.5, yo + 0.5)), CONC_L);
      // dark inside of the opening behind the frame: a recessed shadow plane
      const rec = [-nrm[0] * 3.5, 0, -nrm[2] * 3.5];
      const Pr = (lat, y) => { const p = P(lat, y); return [p[0] + rec[0], p[1], p[2] + rec[2]]; };
      void Pr;
    }
    function buildSlotWalls(sl, batch) {
      const open = sl.kind === 'open';
      const topFn = open
        ? (f, x, z, side) => Math.max(f.pos.y + 0.9, rawG(x + f.right.x * 0.7 * side, z + f.right.z * 0.7 * side) + 0.05)
        : (f, x, z) => sl.deckUnder(x, z);
      wallStrip(batch.misc, sl.s0, sl.s1, slotLatL, (f) => f.pos.y - 0.5, (f, x, z) => topFn(f, x, z, -1), CONC, 1);
      wallStrip(batch.misc, sl.s0, sl.s1, () => SLOT_IN_R, (f) => f.pos.y - 0.5, (f, x, z) => topFn(f, x, z, 1), CONC, -1);
      if (open) { // concrete floor of the portal approach (the terrain sinks under it)
        const f0 = sl.dir === 'in' ? Math.max(sl.s0, sl.s1 - 5) : sl.s0;
        const f1 = sl.dir === 'in' ? sl.s1 : Math.min(sl.s1, sl.s0 + 5);
        flatStrip(batch.misc, f0, f1 + (sl.dir === 'in' ? 0.6 : 0), slotLatL, SLOT_IN_R, (f) => f.pos.y - 0.28, [0.46, 0.46, 0.44], true, { step: 1 });
      }
      if (open) { // coping along the top of the walls
        flatStrip(batch.misc, sl.s0, sl.s1, (s) => slotLatL(s) - 0.45, (s) => slotLatL(s), (f) => { const lat = slotLatL(sl.s0); return topFn(f, f.pos.x + f.right.x * lat, f.pos.z + f.right.z * lat, -1) + 0.02; }, CONC_L, true);
        flatStrip(batch.misc, sl.s0, sl.s1, SLOT_IN_R, SLOT_IN_R + 0.45, (f) => topFn(f, f.pos.x + f.right.x * SLOT_IN_R, f.pos.z + f.right.z * SLOT_IN_R, 1) + 0.02, CONC_L, true);
      }
    }
    /* concrete box-girder deck with parapets, piers and abutments (the named Pont Rouge / Pont Adolphe leave their detail to the landmarks) */
    /* The two big named bridges carry the real road: the tram next to the carriageways, cycle / foot paths on the outer edges.  The national orthophoto
       shows the deck on the valley floor (build_luxtram_geo.py paints the valley back in), so the deck top has to be meshed here, at deck level, with the
       real lane layout.  Lateral offsets are metres to the right of the tram track, measured from the LiDAR deck footprint and the OSM carriageways:
         Pont Grande-Duchesse Charlotte  deck -23.0 .. +5.0   (tram on the north side, 2 + 2 lanes and the cycle path to the south, footway on the north edge)
         Pont Adolphe                    deck  -8.0 .. +11.5  (tram, 2-lane carriageway, footways both sides) */
    const DECK_PROFILES = {
      Charlotte: { fascia: '#a8352e', under: '#7a2420', rail: '#d9d6cf', parts: [['pave', -23.0, -19.4], ['road', -19.4, -12.3], ['road', -12.3, -5.4], ['tram', -5.4, 1.6], ['pave', 1.6, 5.0]] },
      Adolphe: { fascia: '#cdbf9f', under: '#a99978', rail: '#d8cfba', noParapet: true, parts: [['pave', -8.0, -5.6], ['tram', -5.6, 1.6], ['road', 1.6, 8.4], ['pave', 8.4, 11.5]] },
    };
    const DECK_DROP = 0.04;       // road surface just below the rail head (the tram bed ribbons sit on top of it)
    function deckStrip(m, sA, sB, lat0, lat1, col, u0, u1, vScale) {
      const n = Math.max(1, Math.ceil((sB - sA) / 3));
      const base = m.count; let dist = 0; let prev = null;
      for (let i = 0; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n;
        const f = frame(s);
        const y = f.pos.y - DECK_DROP;
        const ax = f.pos.x + f.right.x * lat0; const az = f.pos.z + f.right.z * lat0;
        if (prev) dist += Math.hypot(ax - prev[0], az - prev[1]);
        prev = [ax, az];
        m.vert(ax, y, az, 0, 1, 0, u0, dist / vScale, col);
        m.vert(f.pos.x + f.right.x * lat1, y, f.pos.z + f.right.z * lat1, 0, 1, 0, u1, dist / vScale, col);
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; m.quad(a, a + 1, a + 3, a + 2); }
    }
    function buildNamedDeck(br, batch, ca, cb) {
      const key = /Charlotte/.test(br.name || '') ? 'Charlotte' : 'Adolphe';
      const P = DECK_PROFILES[key];
      // the part of the deck inside this chunk (the deck is longer than a chunk and chunks stream in and out on their own)
      const sA = Math.max(br.s0 - 0.5, ca); const sB = Math.min(br.s1 + 0.5, cb);
      if (sB - sA < 0.5) return;
      const l0 = P.parts[0][1]; const l1 = P.parts[P.parts.length - 1][2];
      P.parts.forEach(([kind, a, b]) => {
        if (kind === 'road') deckStrip(batch.road, sA, sB, a, b, [1, 1, 1], 0.5, 1, 8);
        else if (kind === 'tram') deckStrip(batch.road, sA, sB, a, b, [1.28, 1.28, 1.3], 0, 0.5, 8);
        else deckStrip(batch.pave, sA, sB, a, b, [0.95, 0.94, 0.92], 0, 1, 4);
      });
      const fas = C(P.fascia); const und = C(P.under); const rail = C(P.rail);
      const yTop = (f) => f.pos.y - DECK_DROP;
      wallStrip(batch.misc, sA, sB, () => l0, (f) => yTop(f) - 1.35, (f) => yTop(f) + 0.12, fas, -1);
      wallStrip(batch.misc, sA, sB, () => l1, (f) => yTop(f) - 1.35, (f) => yTop(f) + 0.12, fas, 1);
      flatStrip(batch.misc, sA, sB, l0, l1, (f) => yTop(f) - 1.35, und, false, { step: 3 });
      // parapets: low wall + handrail on both outer edges (Pont Adolphe: the landmark draws its stone balustrade)
      if (!P.noParapet) [[l0 + 0.18, -1], [l1 - 0.18, 1]].forEach(([lat, sd]) => {
        wallStrip(batch.misc, sA, sB, () => lat, (f) => yTop(f) + 0.1, (f) => yTop(f) + 1.0, rail, -sd, { step: 3 });
        flatStrip(batch.misc, sA, sB, lat - 0.1, lat + 0.1, (f) => yTop(f) + 1.0, rail, true, { step: 3 });
      });
    }
    function buildBridge(br, batch) {
      const named = /Charlotte|Adolphe/.test(br.name || '');
      if (named && hasLandmarkFor(br.name)) return;
      const sA = br.s0 - 1; const sB = br.s1 + 1;
      const lL = (s) => slotLatL(s) - 0.9; const lR = SLOT_IN_R + 0.9;
      const depth = named ? 2.4 : 1.5;
      const deckCol = named ? C('#a9a69f') : CONC;
      if (!named) {
        wallStrip(batch.misc, sA, sB, lL, (f) => f.pos.y - depth, (f) => f.pos.y + 1.05, deckCol, 1);
        wallStrip(batch.misc, sA, sB, () => lR, (f) => f.pos.y - depth, (f) => f.pos.y + 1.05, deckCol, -1);
        flatStrip(batch.misc, sA, sB, lL, lR, (f) => f.pos.y - depth, CONC_D, false, { step: 3 });
        flatStrip(batch.misc, sA, sB, (s) => lL(s) - 0.25, (s) => lL(s), (f) => f.pos.y + 1.06, CONC_L, true, { step: 3 });
        flatStrip(batch.misc, sA, sB, lR, lR + 0.25, (f) => f.pos.y + 1.06, CONC_L, true, { step: 3 });
      }
      // piers / abutments to the ground
      const len = sB - sA;
      const np = Math.max(0, Math.floor(len / 30));
      const places = [];
      for (let k = 1; k <= np; k++) places.push(sA + (len * k) / (np + 1));
      places.push(sA + 0.8); places.push(sB - 0.8);
      places.forEach((s, idx) => {
        const f = frame(s);
        const lat = (slotLatL(s) + SLOT_IN_R) / 2;
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        const g = rawG(x, z);
        const hh = f.pos.y - depth - g;
        if (hh < 1.2) return;
        const abut = idx >= places.length - 2;
        const w = (lR - lL(s)) * (abut ? 1.02 : 0.7);
        addBox(batch.misc, x, g + hh / 2 - 0.05, z, abut ? 1.4 : 2.0, hh + 0.1, w, Math.atan2(f.right.z, f.right.x) + Math.PI / 2, CONC);
        if (!abut) addBox(batch.misc, x, f.pos.y - depth - 0.35, z, 2.6, 0.7, (lR - lL(s)) * 0.9, Math.atan2(f.right.z, f.right.x) + Math.PI / 2, CONC_D);
      });
      if (!named) return;
      // Pont Rouge / Pont Adolphe without the landmark models: the old steel V legs / arch ribs
      const n = Math.max(4, Math.ceil(len / 4));
      const frames = [];
      for (let i = 0; i <= n; i++) { const f = frame(sA + (len * i) / n); frames.push({ x: f.pos.x, y: f.pos.y, z: f.pos.z, rx: f.right.x, rz: f.right.z }); }
      const rouge = /Charlotte/.test(br.name || '');
      const half = rouge ? 11.5 : 9.5;
      const girder = rouge ? C('#b0261f') : C('#cdb994'); const girderDark = rouge ? C('#7f1a15') : C('#a6946f');
      const mid = frames[Math.floor(frames.length / 2)];
      if (rouge) {
        [0.3, 0.7].forEach((u) => {
          const f = frames[Math.round(u * n)];
          const gyv = rawG(f.x, f.z);
          [-1, 1].forEach((sd) => {
            const x0 = f.x + f.rx * half * 0.7 * sd; const z0 = f.z + f.rz * half * 0.7 * sd;
            [-1, 1].forEach((tilt) => { const gx = x0 + f.rz * 6 * tilt; const gz = z0 - f.rx * 6 * tilt; addBeam(batch.steel, [x0, f.y - depth, z0], [gx, gyv, gz], 1.5, girder); });
          });
          addBeam(batch.steel, [f.x - f.rx * half * 0.7, f.y - depth - 5, f.z - f.rz * half * 0.7], [f.x + f.rx * half * 0.7, f.y - depth - 5, f.z + f.rz * half * 0.7], 1.2, girderDark);
        });
      } else {
        const gyv = Math.min(rawG(mid.x, mid.z), mid.y - 12);
        const rise = (mid.y - depth) - gyv;
        [-1, 1].forEach((sd) => {
          let prev = null;
          for (let i = 0; i <= 14; i++) {
            const u = -1 + (i / 14) * 2;
            const tt = 0.5 + u * 0.5 * 0.86;
            const f = frames[Math.round(tt * n)];
            const yy = gyv + rise * Math.sqrt(Math.max(0, 1 - u * u));
            const p = [f.x + f.rx * (half - 1.5) * sd, yy, f.z + f.rz * (half - 1.5) * sd];
            if (prev) addBeam(batch.steel, prev, p, 1.6, girder);
            if (i % 2 === 0 && i > 0 && i < 14) addBeam(batch.steel, p, [p[0], f.y - depth, p[2]], 1.2, girderDark);
            prev = p;
          }
        });
      }
    }
    function hasLandmarkFor(name) {
      const lmk = TS.luxLandmarks;
      if (!lmk || !lmk.list) return false;
      try { return lmk.list().some((d) => (/Charlotte/.test(name) && /rouge|charlotte|pont-?rouge/i.test(d.key + ' ' + d.name)) || (/Adolphe/.test(name) && /adolphe/i.test(d.key + ' ' + d.name))); } catch (e) { return false; }
    }

    /* overpass decks (LiDAR flood fill) are meshed with the orthophoto of their tile so the lane markings are the real ones */
    const decks = [];
    function initStructures() {
      const sd = loadStructures();
      const toR = (so) => lt.toRoute(lt.absFromOrig(so));
      const lo = 0; const hi = L;
      track.tunnels.forEach((tn) => {
        slots.push({ s0: tn.s0, s1: tn.s1, kind: 'cover' });
      });
      // open approaches in front of / behind a tunnel (never across a platform)
      const stationsAvoid = (a, b) => track.stations.some((st) => b > st.platformStart - 3 && a < st.platformEnd + 3);
      track.tunnels.forEach((tn) => {
        [[tn.s0 - 28, tn.s0 - 0.2, 'in'], [tn.s1 + 0.2, tn.s1 + 28, 'out']].forEach(([a, b, dir]) => {
          let aa = Math.max(lo, a); let bb = Math.min(hi, b);
          track.stations.forEach((st) => { if (bb > st.platformStart - 3 && aa < st.platformEnd + 3) { if (dir === 'in') aa = Math.max(aa, st.platformEnd + 3); else bb = Math.min(bb, st.platformStart - 3); } });
          track.tunnels.forEach((o) => { if (o !== tn) { if (dir === 'in' && o.s1 > aa && o.s1 < bb) aa = o.s1 + 0.2; if (dir === 'out' && o.s0 > aa && o.s0 < bb) bb = o.s0 - 0.2; } });
          if (bb - aa > 4 && !stationsAvoid(aa, bb)) slots.push({ s0: aa, s1: bb, kind: 'open', dir });
        });
      });
      (sd.over || []).forEach((o) => {
        const d = { o, s0: toR(o.s0), s1: toR(o.s1), local: o.poly, plane: o.plane, built: false };
        decks.push(d);
        if (o.w >= 7 && d.s1 > d.s0) {
          const [a, b, c] = o.plane;
          const slot = { s0: d.s0, s1: d.s1, kind: 'deck', deckUnder: (x, z) => a * (x + ox) + b * (z + oz) + c - oy - 1.15 };
          slots.push(slot);
        }
      });
    }
    function structuresInChunk(sa, sb, batch) {
      track.tunnels.forEach((tn) => {
        const mid = (tn.s0 + tn.s1) / 2;
        if (mid >= sa && mid < sb) { buildTunnel({ s0: tn.s0, s1: tn.s1 }, batch); buildPortal(tn.s0, -1, batch); buildPortal(tn.s1, 1, batch); }
      });
      slots.forEach((sl) => { if (sl.kind !== 'cover') { const mid = (sl.s0 + sl.s1) / 2; if (mid >= sa && mid < sb) buildSlotWalls(sl, batch); } });
      track.bridges.forEach((br) => {
        const mid = (br.s0 + br.s1) / 2;
        if (mid >= sa && mid < sb) buildBridge(br, batch);
        if (/Charlotte|Adolphe/.test(br.name || '') && br.s1 > sa && br.s0 < sb) buildNamedDeck(br, batch, sa, sb);
      });
    }
    function buildDecksFor(t, group) {
      decks.forEach((d) => {
        if (d.built) return;
        const poly = d.local; const n = poly.length / 2;
        let cx = 0; let cz = 0; for (let i = 0; i < n; i++) { cx += poly[i * 2]; cz += poly[i * 2 + 1]; } cx /= n; cz /= n;
        if (Math.floor(cx / TS_) !== t.info.i || Math.floor(cz / TS_) !== t.info.j) return;
        d.built = true;
        const [a, b, c] = d.plane;
        const yTop = (xl, zl) => a * xl + b * zl + c - oy;
        const ring = []; for (let i = 0; i < n; i++) ring.push([poly[i * 2] - ox, poly[i * 2 + 1] - oz]);
        const px = t.info.meta.px; const res = t.info.meta.res;
        const x0 = t.info.i * TS_; const z0 = t.info.j * TS_;
        let tris = null;
        try { tris = T.ShapeUtils.triangulateShape(ring.map((q) => new T.Vector2(q[0], q[1])), []); } catch (e) { tris = null; }
        if (!tris) return;
        const pos = []; const uv = []; const nor = [];
        const nrm = (() => { const k = Math.hypot(a, 1, b); return [-a / k, 1 / k, -b / k]; })();
        tris.forEach((tr) => tr.forEach((vi) => {
          const xl = ring[vi][0] + ox; const zl = ring[vi][1] + oz;
          pos.push(ring[vi][0], yTop(xl, zl) + 0.04, ring[vi][1]); nor.push(nrm[0], nrm[1], nrm[2]);
          uv.push(((xl - x0) / res + 1) / px, ((zl - z0) / res + 1) / px);
        }));
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        const topMesh = new T.Mesh(g, t.mat); topMesh.renderOrder = 0; group.add(topMesh);
        // sides + underside in concrete
        const M = new Mesher();
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i]; const p1 = ring[(i + 1) % ring.length];
          const dx = p1[0] - p0[0]; const dz = p1[1] - p0[1]; const l = Math.hypot(dx, dz) || 1;
          const y0a = yTop(p0[0] + ox, p0[1] + oz); const y0b = yTop(p1[0] + ox, p1[1] + oz);
          const i0 = M.vert(p0[0], y0a + 0.04, p0[1], dz / l, 0, -dx / l, 0, 0, CONC); const i1 = M.vert(p1[0], y0b + 0.04, p1[1], dz / l, 0, -dx / l, 1, 0, CONC);
          const i2 = M.vert(p1[0], y0b - 1.15, p1[1], dz / l, 0, -dx / l, 1, 1, CONC_D); const i3 = M.vert(p0[0], y0a - 1.15, p0[1], dz / l, 0, -dx / l, 0, 1, CONC_D);
          M.quad(i0, i1, i2, i3);
        }
        const base = M.count;
        ring.forEach((q) => M.vert(q[0], yTop(q[0] + ox, q[1] + oz) - 1.15, q[1], 0, -1, 0, 0, 0, CONC_D));
        tris.forEach((tr) => M.tri(base + tr[0], base + tr[1], base + tr[2]));
        const sm = M.mesh(matMisc, {}); if (sm) group.add(sm);
        // columns at the corridor edges
        const colM = new Mesher();
        const dk = d.o; void dk;
        const sMid = (d.s0 + d.s1) / 2;
        const f = frame(sMid);
        [slotLatL(sMid) - 0.4, SLOT_IN_R + 0.4].forEach((lat) => {
          const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
          const yt = yTop(x + ox, z + oz) - 1.15;
          addBox(colM, x, (f.pos.y - 0.5 + yt) / 2, z, 0.8, yt - f.pos.y + 0.5, 0.8, 0, CONC);
        });
        const cmesh = colM.mesh(matMisc, {}); if (cmesh) group.add(cmesh);
      });
    }
    initStructures();

    /* the ground above a cut-and-cover tunnel: a cap at the real LiDAR height, textured with the orthophoto (the terrain mesh has a hole there) */
    function buildCapsFor(t, group) {
      const pos = []; const uv = []; const idx = [];
      const px = t.info.meta.px; const res = t.info.meta.res;
      const x0 = t.info.i * TS_; const z0 = t.info.j * TS_;
      slots.forEach((sl) => {
        if (sl.kind !== 'cover') return;
        const step = 3;
        const nLat = 7;
        for (let s = sl.s0; s < sl.s1; s += step) {
          const sa = s; const sb = Math.min(sl.s1, s + step);
          const fm = frame((sa + sb) / 2);
          const cxl = fm.pos.x + ox; const czl = fm.pos.z + oz;
          if (Math.floor(cxl / TS_) !== t.info.i || Math.floor(czl / TS_) !== t.info.j) continue;
          const rows = [sa, sb].map((ss) => {
            const f = frame(ss);
            const lo = slotLatL(ss) - 2.7; const hi = SLOT_IN_R + 2.7;
            const row = [];
            for (let k = 0; k < nLat; k++) {
              const lat = lo + ((hi - lo) * k) / (nLat - 1);
              const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
              let y = rawG(x, z);
              if (lat > slotLatL(ss) - 0.1 && lat < SLOT_IN_R + 0.1) y = Math.max(y, f.pos.y + 6.45);
              row.push([x, y + 0.03, z]);
            }
            return row;
          });
          const base = pos.length / 3;
          rows.forEach((row) => row.forEach((v) => { pos.push(v[0], v[1], v[2]); uv.push(((v[0] + ox - x0) / res + 1) / px, ((v[2] + oz - z0) / res + 1) / px); }));
          for (let k = 0; k < nLat - 1; k++) { const a = base + k; const b = a + 1; const c2 = a + nLat; const d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
        }
      });
      if (!pos.length) return;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.attributes.normal) for (let i = 0; i < g.attributes.normal.count; i++) if (g.attributes.normal.getY(i) < 0) g.attributes.normal.setXYZ(i, -g.attributes.normal.getX(i), -g.attributes.normal.getY(i), -g.attributes.normal.getZ(i));
      t.capMat = new T.MeshLambertMaterial({ map: t.tex || null, color: t.tex ? GROUND_TINT : new T.Color('#6f6f6a'), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new T.Mesh(g, t.capMat); mesh.renderOrder = 0;
      group.add(mesh);
    }

    /* ---- trees (OSM), signals */
    function buildTrees(ci, d, batch) {
      const rng = mulberry(ci * 7919 + 13);
      const out = batch.leaf;
      (OSM_TREES ? d.t : []).forEach((t) => {
        if (rng() > Q.trees) return;
        const x = t[0] / 10 - ox; const z = t[1] / 10 - oz;
        const q = nearest(x, z);
        if (q.d < 4.2) return;
        const y = gy(x, z) - 0.1;
        const tpl = treeTpl[t[2] === 1 ? 1 : 0];
        const sc = (t[3] > 3 ? clamp(t[3] / 9, 0.6, 1.8) : 0.75 + rng() * 0.6) * (t[2] === 1 ? 1.1 : 1);
        const rot = rng() * 6.28; const cr = Math.cos(rot); const sr = Math.sin(rot);
        const tint = 0.8 + rng() * 0.4;
        const base = out.count;
        for (let i = 0; i < tpl.count; i++) {
          const px = tpl.p[i * 3] * sc; const py = tpl.p[i * 3 + 1] * sc; const pz = tpl.p[i * 3 + 2] * sc;
          const nx = tpl.n[i * 3]; const ny = tpl.n[i * 3 + 1]; const nz = tpl.n[i * 3 + 2];
          out.vert(x + px * cr - pz * sr, y + py, z + px * sr + pz * cr, nx * cr - nz * sr, ny, nx * sr + nz * cr, 0, 0, [tpl.c[i * 3] * tint, tpl.c[i * 3 + 1] * tint, tpl.c[i * 3 + 2] * tint]);
        }
        for (let i = 0; i < tpl.i.length; i++) out.i.push(base + tpl.i[i]);
      });
      d.x.forEach((sgn) => {
        const x = sgn[0] / 10 - ox; const z = sgn[1] / 10 - oz;
        if (nearest(x, z).d < 4.5) return;
        const y = gy(x, z);
        addBeam(batch.misc, [x, y, z], [x, y + 4.6, z], 0.12, C('#3c4146'));
        addBox(batch.misc, x, y + 4.2, z, 0.34, 1.0, 0.3, 0, C('#1f2225'));
        addBox(batch.glowLamp, x, y + 4.55, z, 0.2, 0.2, 0.31, 0, C('#cc3a2a'));
      });
    }

    /* ---- chunk assembly (OSM objects, 200 m of line each) */
    const chunkTiles = new Map();
    function tilesOfChunk(ci) {
      if (chunkTiles.has(ci)) return chunkTiles.get(ci);
      const sOrigA = ci * data.chunk; const sOrigB = sOrigA + data.chunk;
      const sa = lt.toRoute(lt.absFromOrig(sOrigA)); const sb = lt.toRoute(lt.absFromOrig(sOrigB));
      const set = new Set();
      for (let s = sa; s <= sb + 1; s += 25) {
        const f = frame(s);
        const lx = f.pos.x + ox; const lz = f.pos.z + oz;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const key = Math.floor((lx + a * 70) / TS_) + '_' + Math.floor((lz + b * 70) / TS_);
          if (geo.tiles[key]) set.add(key);
        }
      }
      const arr = Array.from(set);
      chunkTiles.set(ci, arr);
      return arr;
    }
    function chunkReady(ci) {
      return tilesOfChunk(ci).every((k) => { const t = tiles.get(k); return t && (t.state === 'ready' && t.built || t.state === 'failed'); });
    }
    function buildChunk(ci) {
      const d = data.chunks[String(ci)] || { b: [], r: [], t: [], l: [], w: [], x: [], g: [] };
      const sOrigA = ci * data.chunk;
      const sOrigB = sOrigA + data.chunk;
      const sa = lt.toRoute(lt.absFromOrig(sOrigA));
      const sb = lt.toRoute(lt.absFromOrig(sOrigB));
      const group = new T.Group();
      group.name = 'lt-chunk-' + ci;
      const batch = { wall: new Mesher(), roof: new Mesher(), road: new Mesher(), pave: new Mesher(), bed: new Mesher(), misc: new Mesher(), steel: new Mesher(), leaf: new Mesher(), glowLamp: new Mesher() };
      const add = (m, mat, o) => { const mesh = m.mesh(mat, o); if (mesh) group.add(mesh); return mesh; };
      let built = 0;
      d.b.forEach((b, i) => { try { if (addOsmBuilding(batch, b, ci, i)) built++; } catch (e) { console.warn(TAG + 'building failed', e); } });
      const lampOut = { n: ci, list: [] };
      const roadsOut = [];
      buildRoads(ci, d, batch, lampOut, roadsOut);
      lampOut.list.forEach((p) => addLamp(batch, p));
      lampsByChunk.set(ci, lampOut.list);
      buildTram(ci, sa, sb, batch);
      structuresInChunk(sa, sb, batch);
      buildTrees(ci, d, batch);
      add(batch.wall, matWall, { cast: Q.castShadow });
      add(batch.roof, matRoof, { cast: Q.castShadow });
      add(batch.road, matRoad, { order: 0 });
      add(batch.pave, matPave, { order: 0 });
      add(batch.bed, matBed, { order: 1 });
      add(batch.misc, matMisc, {});
      add(batch.steel, matSteel, { cast: Q.castShadow });
      add(batch.leaf, matLeaf, { cast: Q.castShadow, noReceive: true });
      add(batch.glowLamp, matLampGlow, { noReceive: true });
      root.add(group);
      roadsByChunk.set(ci, roadsOut);
      return { ci, group, buildings: built };
    }

    /* ---- traffic: cars drive along the real roads (one instanced mesh); they stop in front of a tram crossing while the tram is near (red lights),
       queue behind each other and never stand on the tracks */
    const carGeo = (() => {
      const m = new Mesher();
      addBox(m, 0, 0.62, 0, 1.8, 0.6, 4.3, 0, [1, 1, 1]);
      addBox(m, 0, 1.15, -0.15, 1.6, 0.5, 2.2, 0, [0.35, 0.42, 0.48]);
      addBox(m, 0, 1.42, -0.15, 1.5, 0.08, 2.0, 0, [0.92, 0.92, 0.92]);
      [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]].forEach((w) => addBox(m, w[0], 0.34, w[1], 0.22, 0.68, 0.68, 0, [0.08, 0.08, 0.08]));
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(m.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(m.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(m.c, 3));
      g.setIndex(m.i);
      return g;
    })();
    const matCar = new T.MeshLambertMaterial({ vertexColors: true });
    mats.push(matCar);
    const carMesh = new T.InstancedMesh(carGeo, matCar, Math.max(1, Q.cars));
    carMesh.frustumCulled = false; carMesh.count = 0; carMesh.castShadow = false;
    root.add(carMesh);
    const CAR_COLS = ['#c9c9c9', '#1f2328', '#a42a2a', '#2c4a7a', '#e9e9e9', '#4c5a48', '#c9a23a', '#7a7f86', '#5a1f1f'].map((h) => new T.Color(h));
    const crossings = [];                      // { rd, c (cross record), x, z, red }
    const lampGeo = new T.BoxGeometry(0.34, 0.34, 0.34);
    const lampMat = new T.MeshBasicMaterial({ color: 0xffffff });
    mats.push(lampMat);
    const lampMesh = new T.InstancedMesh(lampGeo, lampMat, 160);
    lampMesh.frustumCulled = false; lampMesh.count = 0;
    root.add(lampMesh);
    const lampPostGeo = new T.CylinderGeometry(0.07, 0.07, 3.4, 5);
    const lampPostMat = new T.MeshLambertMaterial({ color: 0x3a3f44 });
    mats.push(lampPostMat);
    const lampPosts = new T.InstancedMesh(lampPostGeo, lampPostMat, 160);
    lampPosts.frustumCulled = false; lampPosts.count = 0;
    root.add(lampPosts);
    let carList = [];
    let crossPosts = [];             // traffic-signal post positions of the tram crossings (test hook)
    let carDirty = true;
    const RED = new T.Color('#ff2a18'); const GREEN = new T.Color('#33e06c');
    function rebuildCars() {
      const rng = mulberry(77);
      const list = [];
      crossings.length = 0;
      const lm = new T.Matrix4();
      let lampN = 0;
      crossPosts = [];
      roadsByChunk.forEach((roads) => roads.forEach((rd) => {
        if (rd.cross && rd.cross.length) {
          rd.cross.forEach((c) => {
            const rec = { rd, c, red: false };
            crossings.push(rec);
            // signal posts on the right of both approaches (one each side of the tram corridor)
            [c.t0 - 3.2, c.t1 + 3.2].forEach((tt0, side) => {
              if (lampN >= 160) return;
              const sgn = side === 0 ? 1 : -1;
              // the post stands at the kerb of its own road, but at a junction that spot can be another road's lane (or the other track): slide it away from the tram until it is clear
              let lx = 0; let lz = 0; let clear = false;
              for (let k = 0; k < 7 && !clear; k++) {
                const tt = tt0 + (side === 0 ? -1 : 1) * k * 2.5;
                if (tt < 0 || tt > rd.len) break;
                const p = roadPoint(rd, tt);
                const nx = -p.dz; const nz = p.dx;
                lx = p.x + nx * sgn * (rd.hw + 0.7); lz = p.z + nz * sgn * (rd.hw + 0.7);
                const nq = nearest(lx, lz);
                clear = roadMarginExcept(lx, lz, rd) > 0.35 && nq.d > 4.4 && (!hasOpp || Math.abs(nq.lat - oppLatAt(nq.s)) > 2.6);
              }
              if (!clear) return;
              const ly = rawG(lx, lz);
              crossPosts.push({ x: lx, z: lz });
              lm.makeTranslation(lx, ly + 1.7, lz); lampPosts.setMatrixAt(lampN, lm);
              rec.lamps = rec.lamps || []; rec.lamps.push([lampN, lx, ly + 3.2, lz]);
              lampN++;
            });
          });
        }
        const per = rd.cls <= 2 ? 55 : 90;
        const n = Math.floor(rd.len / per) + (rng() < (rd.len / per) % 1 ? 1 : 0);
        for (let i = 0; i < n && list.length < Q.cars; i++) {
          const dir = rd.oneway ? 1 : (rng() < 0.5 ? 1 : -1);
          let tt = rng() * rd.len;
          // never start on the rails
          if ((rd.along || []).some((a) => tt > a[0] && tt < a[1]) || (rd.cross || []).some((c) => tt > c.t0 - 1 && tt < c.t1 + 1)) tt = (tt + 25) % rd.len;
          const vmax = 7 + rng() * 6;
          list.push({ rd, t: tt, dir, vmax, cur: vmax, col: CAR_COLS[Math.floor(rng() * CAR_COLS.length)], x: 0, z: 0 });
        }
      }));
      lampPosts.count = lampN; lampPosts.instanceMatrix.needsUpdate = true;
      lampMesh.count = lampN;
      carList = list;
      carMesh.count = list.length;
      list.forEach((c, i) => carMesh.setColorAt(i, c.col));
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
      carDirty = false;
    }
    function roadPoint(rd, tt) {
      const c = clamp(tt, 0, rd.len);
      let j = 1; while (j < rd.cum.length - 1 && rd.cum[j] < c) j++;
      const a = rd.pts[j - 1]; const b = rd.pts[j];
      const seg = rd.cum[j] - rd.cum[j - 1] || 1; const u = (c - rd.cum[j - 1]) / seg;
      const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
      return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), dx: dx / dl, dz: dz / dl };
    }
    const cm = new T.Matrix4(); const cq = new T.Quaternion(); const cp = new T.Vector3(); const cs1 = new T.Vector3(1, 1, 1); const cUp = new T.Vector3(0, 1, 0);
    const lampCol = new T.Color();
    let tramS = -1e9;
    const TRAM_LEN = 46;
    function updateCars(dt) {
      if (carDirty) rebuildCars();
      // crossing state: red while the tram is within 90 m before it or still on it
      crossings.forEach((cr) => {
        const sc = cr.c.s;
        const red = tramS > sc - 90 && tramS - TRAM_LEN < sc + 14;
        if (red !== cr.red || cr.lampsDirty !== false) {
          cr.red = red; cr.lampsDirty = false;
          (cr.lamps || []).forEach((l) => { cm.makeTranslation(l[1], l[2], l[3]); lampMesh.setMatrixAt(l[0], cm); lampMesh.setColorAt(l[0], red ? RED : GREEN); });
          lampMesh.instanceMatrix.needsUpdate = true; if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
        }
      });
      for (let i = 0; i < carList.length; i++) {
        const c = carList[i]; const rd = c.rd;
        // target speed: stop at the line in front of a red crossing, keep a gap to the car ahead
        let target = c.vmax;
        for (let k = 0; k < crossings.length; k++) {
          const cr = crossings[k];
          if (cr.rd !== rd || !cr.red) continue;
          const line = c.dir > 0 ? cr.c.t0 - 3.6 : cr.c.t1 + 3.6;
          const ahead = (line - c.t) * c.dir;           // metres until the stop line
          const inside = c.t > cr.c.t0 - 2.4 && c.t < cr.c.t1 + 2.4;
          if (!inside && ahead > -0.5 && ahead < 26) target = Math.min(target, Math.max(0, ahead - 0.8) * 0.9);
        }
        for (let m2 = 0; m2 < carList.length; m2++) {
          if (m2 === i) continue;
          const o = carList[m2];
          if (o.rd !== rd || o.dir !== c.dir) continue;
          const gap = (o.t - c.t) * c.dir;
          if (gap > 0 && gap < 12) target = Math.min(target, Math.max(0, gap - 6.2) * 0.9);
        }
        // never come to rest on the rails
        const onRails = (rd.cross || []).some((q) => c.t > q.t0 && c.t < q.t1);
        if (onRails && target < 3) target = 3;
        c.cur += clamp(target - c.cur, -7 * dt, 2.5 * dt);
        if (c.cur < 0.02) c.cur = 0;
        c.t += c.dir * c.cur * dt;
        if (c.t > rd.len) c.t -= rd.len; else if (c.t < 0) c.t += rd.len;
        // roads along the rails: jump over the stretch
        const al = (rd.along || []).find((a) => c.t > a[0] && c.t < a[1]);
        if (al) c.t = c.dir > 0 ? al[1] + 0.5 : al[0] - 0.5;
        const p = roadPoint(rd, c.t);
        const lane = rd.hw * 0.45 * c.dir;
        const x = p.x + (-p.dz) * lane; const z = p.z + p.dx * lane;
        cp.set(x, gy(x, z) + 0.07, z);
        cq.setFromAxisAngle(cUp, Math.atan2(-p.dx * c.dir, -p.dz * c.dir));
        cm.compose(cp, cq, cs1);
        carMesh.setMatrixAt(i, cm);
      }
      carMesh.instanceMatrix.needsUpdate = true;
    }

    /* ---- streaming */
    let lastS = -1e9;
    function wantedChunks(s) {
      const sOrig = lt.origFromAbs(s + lt.sStart);
      const lo = Math.max(firstCi, Math.floor((sOrig - Q.behind) / data.chunk));
      const hi = Math.min(lastCi, Math.floor((sOrig + Q.ahead) / data.chunk));
      return [lo, hi];
    }
    function ensureTiles(s, all) {
      const ahead = Q.ahead; const behind = Q.behind;
      // load / keep: tiles whose nearest line position lies in the window (plus a margin for their size)
      const want = [];
      tileInfo.forEach((info) => {
        const ds = info.s - s;
        if (ds > -behind - 90 && ds < ahead + 90) want.push(info);
      });
      want.sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s));
      const wantKeys = new Set(want.map((i) => i.key));
      Array.from(tiles.values()).forEach((t) => { const ds = t.info.s - s; if (!wantKeys.has(t.key) && (ds < -behind - 260 || ds > ahead + 260)) disposeTile(t); });
      for (const info of want) {
        if (tiles.has(info.key)) continue;
        if (!all && loading >= MAX_LOADS) break;
        startLoad(info);
      }
      let n = 0;
      for (const info of want) {
        const t = tiles.get(info.key);
        if (!t || t.state !== 'ready') continue;
        if (!t.built) { if (!all && n >= 1) continue; buildTile(t, s); n++; } else {
          const ds = desiredStride(t, s);
          if (ds < t.stride && (all || n < 1)) { restride(t, ds); n++; }
        }
      }
    }
    function ensureChunks(s, all) {
      const [lo, hi] = wantedChunks(s);
      Array.from(chunks.keys()).forEach((k) => { if (k < lo - 1 || k > hi + 1) disposeChunk(k); });
      const sOrig = lt.origFromAbs(s + lt.sStart);
      const centre = Math.floor(sOrig / data.chunk);
      const list = [];
      for (let k = lo; k <= hi; k++) if (!chunks.has(k)) list.push(k);
      list.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
      let n = 0;
      for (const k of list) {
        if (!all && n >= MAX_BUILDS_PER_UPDATE) break;
        if (!all && !chunkReady(k)) continue;
        carDirty = true;
        try { chunks.set(k, buildChunk(k)); } catch (e) { console.warn(TAG + 'chunk ' + k + ' failed', e); chunks.set(k, { ci: k, group: new T.Group(), buildings: 0 }); }
        n++;
      }
    }
    function disposeChunk(k) {
      const c = chunks.get(k);
      if (!c) return;
      chunks.delete(k);
      root.remove(c.group);
      c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      roadsByChunk.delete(k); lampsByChunk.delete(k); carDirty = true;
    }

    /* ---- landmark models (luxtram-landmarks.js) */
    let lm = null;
    try {
      if (TS.luxLandmarks && TS.luxLandmarks.build) {
        lm = TS.luxLandmarks.build(scene, {
          project: (lat, lon) => TS.luxProject(lat, lon), groundAt: gy, groundY: gy, railY: railYAt, originY: oy, origin: { x: ox, z: oz },
          quality, night: () => nightK, nightK: 0, track, THREE: T,
        });
      }
    } catch (e) { console.warn(TAG + 'landmarks failed', e); }

    /* the procedural landscape still builds its generic villages / city blocks / trees in ls-chunk groups: the real world replaces them */
    let landGroup = null;
    function hideProceduralScenery() {
      if (!landGroup || !landGroup.parent) landGroup = scene.children.find((c) => c.name === 'landscape') || null;
      if (!landGroup) return;
      for (let i = 0; i < landGroup.children.length; i++) {
        const c = landGroup.children[i];
        if (c.visible && c.name && c.name.indexOf('ls-chunk') === 0) c.visible = false;
        else if (c.visible && c.isMesh && c.geometry && c.material && !c.userData.ltChecked && c.material.isMeshLambertMaterial) {
          // the huge procedural far-land / horizon-hill discs (renderOrder <= -1): the far ring replaces the land, the hills sink below the real ground
          c.userData.ltChecked = true;
          if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
          const b = c.geometry.boundingBox;
          if (b.max.x - b.min.x > 1200) { if (c.material.map) c.visible = false; else c.position.y -= 90; }
        }
      }
    }
    function update(s, camera, dt) {
      if (disposed) return;
      hideProceduralScenery();
      const sc = clamp(s, 0, L);
      tramS = sc;
      if (Q.cars) updateCars(Math.min(0.1, dt || 0.016));
      ensureTiles(sc, false);
      ensureChunks(sc, false);
      ensureFar(sc, camera, false);
      const sun = landscape && landscape.sun ? landscape.sun.intensity : 3;
      nightK = 1 - smooth(0.2, 1.4, sun);
      wallUniforms.uNight.value = nightK * 1.25;
      matWall.emissiveIntensity = 1;
      if (lm && lm.update) { try { lm.update(sc, camera); } catch (e) { console.warn(TAG + 'landmark update', e); } }
      lastS = s;
    }
    let warmS = null;   // where the opening warm-up was asked for (progress() measures that window)
    function warm(s) {
      const sc = clamp(s === undefined ? 0 : s, 0, L);
      if (warmS === null) warmS = sc;
      ensureTiles(sc, true);
      ensureChunks(sc, true);
      ensureFar(sc, null, true);
    }
    /* the detailed tiles of the window around s (same rule as ensureTiles) and the far tiles within the far radius (same rule as ensureFar) */
    function windowTiles(s) {
      return tileInfo.filter((info) => { const ds = info.s - s; return ds > -Q.behind - 90 && ds < Q.ahead + 90; });
    }
    function windowFar(s) {
      const f0 = frame(s);
      return farInfo.filter((info) => {
        const dx = Math.max(Math.abs(info.cx - f0.pos.x) - FAR_T / 2, 0); const dz = Math.max(Math.abs(info.cz - f0.pos.z) - FAR_T / 2, 0);
        return Math.hypot(dx, dz) < FAR_R;
      });
    }
    /* Real download progress of the opening warm-up: how many of the start section's tiles (detailed + far) have arrived. */
    function progress() {
      if (warmS === null) return { ready: 0, total: 0, done: false, bytes: NET.bytes };
      let ready = 0; let total = 0;
      for (const info of windowTiles(warmS)) { total++; const t = tiles.get(info.key); if (t && t.state !== 'loading') ready++; }
      for (const info of windowFar(warmS)) { total++; const f = farTiles.get(info.key); if (f && f.state !== 'loading') ready++; }
      return { ready, total, done: ready >= total, bytes: NET.bytes };
    }
    /* While driving: how many detailed tiles ahead of the tram (up to the draw distance) have not arrived yet. */
    function pendingAhead() {
      let n = 0;
      for (const info of tileInfo) {
        const ds = info.s - tramS;
        if (ds < -40 || ds > Q.ahead) continue;
        const t = tiles.get(info.key);
        if (!t || t.state === 'loading') n++;
      }
      return n;
    }
    const noop = () => {};
    function stats() {
      let tris = 0; let meshes = 0;
      root.traverse((o) => { if (o.isMesh && o.visible) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
      return { chunks: chunks.size, tiles: tiles.size, meshes, triangles: Math.round(tris), buildings: Array.from(chunks.values()).reduce((a, c) => a + c.buildings, 0) };
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      Array.from(chunks.keys()).forEach(disposeChunk);
      Array.from(tiles.values()).forEach(disposeTile);
      Array.from(farTiles.values()).forEach(disposeFar);
      if (lm && lm.dispose) { try { lm.dispose(); } catch (e) { /* ignore */ } }
      scene.remove(root);
      mats.forEach((m) => m.dispose());
      carGeo.dispose(); carMesh.dispose(); lampGeo.dispose(); lampMesh.dispose(); lampPostGeo.dispose(); lampPosts.dispose();
      treeTplDec.dispose(); treeTplCon.dispose(); treeTplBoth.dispose();
      treeTpl.length = 0;
      activeOrigin = null;
      if (TS.luxRoadMargin === roadMargin) TS.luxRoadMargin = null;
    }
    ensureTiles(0, false);
    void lastS;
    /* test hook: the road carriageways (scene metres, half width) and road lamps of the loaded chunks, to check that no pole stands in a lane */
    const debugRoadFurniture = () => ({
      roads: Array.from(roadsByChunk.values()).flat().map((r) => ({ cls: r.cls, hw: r.hw, pts: r.pts.map((p) => [p.x, p.z]) })),
      lamps: Array.from(lampsByChunk.values()).flat().map((l) => ({ x: l[0], z: l[1] })),
      posts: crossPosts.slice(),
    });
    return { debugRoadFurniture, update, setTimeOfDay: noop, setWeather: noop, warm, stats, progress, pendingAhead, dispose, root, groundAt: gy, tiles, underpasses, far: farTiles };
  }

  TS.luxtramWorld = { create, QUALITY, prefetchData };
})();
