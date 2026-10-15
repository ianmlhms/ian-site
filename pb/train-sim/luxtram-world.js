/* Lokféierer: the real world around Luxtram T1 (TS.luxtramWorld).
 * Real geodata, all key-free and CC0: Geodata © ACT Luxembourg (geoportail.lu / data.public.lu) + OpenStreetMap (ODbL).
 *   - ground: the LiDAR 2024 terrain model (2-4 m grid, data/luxtram/h/), streamed by distance along the line, blended into the formation under both tracks,
 *     PAINTED (no photographs) by luxtram-ground.js: a splat shader of 8 procedural materials driven by a per-tile class map, plus real geometry on top
 *     (carriageways, sidewalks, 3D kerbs, lane markings, zebra crossings, parking bays, water, rails, bridge decks) from OSM;  data/luxtram/g/<i>_<j>.bin
 *   - buildings: the national LOD 2.2 3D buildings (real roof shapes and heights), facades + roofs from luxtram-facades.js (typology atlas, roofs from OSM tags and district, no photo);
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
  function loadGeoIndex() { if (!geoIndex) geoIndex = syncJson(GEO_BASE + 'index.json?v=4'); return geoIndex; }
  /* Fetches the three data files the world needs at build time asynchronously (with a byte count) so that create() finds them in memory instead of
     blocking on synchronous requests. Resolves when all are in (or failed: create() then falls back to the blocking request). */
  function prefetchData() {
    const getJson = (url) => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))).then((txt) => { NET.bytes += txt.length; return JSON.parse(txt); });
    const jobs = [];
    if (!worldData) jobs.push(getJson(WORLD_URL).then((d) => { if (!worldData) worldData = d; }));
    if (!structData) jobs.push(getJson(GEO_BASE + 'structures.json?v=1').then((d) => { if (!structData) structData = d; }).catch(() => { /* optional: loadStructures() falls back */ }));
    if (!geoIndex) jobs.push(getJson(GEO_BASE + 'index.json?v=4').then((d) => { if (!geoIndex) geoIndex = d; }));
    return Promise.all(jobs).then(() => true, (e) => { console.warn(TAG + 'data prefetch failed, loading synchronously', e); return false; });
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

  /* Cuttings, embankments and retaining walls in the LiDAR ground model are full of single-node spikes and folded triangles (the point cloud thins out on a
     wall and the TIN zig-zags): on steep cells the heights are despiked with a 3x3 median and rounded with a binomial blur, so a cutting is a clean slope
     (or a clean wall) instead of crumpled paper.  Flat ground, and the two outer node rings of the tile (shared with the neighbour), are not touched. */
  function regularizeDem(dem, step) {
    const n = dem.n; const h = dem.h;
    if (n < 9) return dem;
    const g = new Float32Array(n * n);
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const k = r * n + c;
        const dx = (h[k + 1] - h[k - 1]) / (2 * step); const dz = (h[k + n] - h[k - n]) / (2 * step);
        g[k] = Math.hypot(dx, dz);
      }
    }
    const STEEP = 0.8;
    // zone = steep cells and their 2-node surroundings
    const zone = new Uint8Array(n * n);
    let any = false;
    for (let r = 2; r < n - 2; r++) {
      for (let c = 2; c < n - 2; c++) {
        if (g[r * n + c] > STEEP) {
          any = true;
          for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) zone[(r + dr) * n + c + dc] = 1;
        }
      }
    }
    if (!any) return dem;
    let cur = Float32Array.from(h);
    const med = new Float32Array(9);
    for (let pass = 0; pass < 2; pass++) {          // despike: 3x3 median
      const nxt = Float32Array.from(cur);
      for (let r = 2; r < n - 2; r++) {
        for (let c = 2; c < n - 2; c++) {
          const k = r * n + c;
          if (!zone[k]) continue;
          let m = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) med[m++] = cur[k + dr * n + dc];
          med.sort();
          const md = med[4];
          if (Math.abs(cur[k] - md) > 0.15 * step) nxt[k] = md;
        }
      }
      cur = nxt;
    }
    for (let pass = 0; pass < 2; pass++) {          // round: binomial blur, weight by steepness
      const nxt = Float32Array.from(cur);
      for (let r = 2; r < n - 2; r++) {
        for (let c = 2; c < n - 2; c++) {
          const k = r * n + c;
          if (!zone[k]) continue;
          const bl = (cur[k - n - 1] + 2 * cur[k - n] + cur[k - n + 1] + 2 * cur[k - 1] + 4 * cur[k] + 2 * cur[k + 1] + cur[k + n - 1] + 2 * cur[k + n] + cur[k + n + 1]) / 16;
          const w = Math.min(1, Math.max(0.35, (g[k] - 0.4) / 1.2));
          nxt[k] = cur[k] + (bl - cur[k]) * w;
        }
      }
      cur = nxt;
    }
    return { n, h: cur };
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
    /* ---- buildings: facades + roofs live in luxtram-facades.js (TS.luxFacades): one material, merged per tile / chunk */
    const fx = TS.luxFacades.create({
      T, ox, oz, oy, quality, castShadow: Q.castShadow, get STOP_CLEAR_H() { return STOP_CLEAR_H; },
      gy: (x, z) => gy(x, z), nearest: (x, z) => nearest(x, z), replacedBy: (x, z, pts) => replacedBy(x, z, pts), atStop: (x, z) => atStop(x, z),
      sceneRing: (flat) => sceneRing(flat), localXZ: (x, z) => [x + ox, z + oz],
    });
    const matWall = fx.matWall;
    const matBed = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texBed(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const matMisc = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    const matSteel = new T.MeshStandardMaterial({ side: T.DoubleSide, vertexColors: true, roughness: 0.45, metalness: 0.7 });
    const matLeaf = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true });
    const matLampGlow = new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true });
    const mats = [matWall, matBed, matMisc, matSteel, matLeaf, matLampGlow];
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
    /* driving direction along the forward-track s that update() receives (return routes: -1).  options.reverse (set by the host when it builds the scenery
       for a reversed track) gives it from the start; otherwise it is learnt from the first metres driven. */
    let DIR = options && options.reverse ? -1 : 1;
    let dirS = null; let dirMoved = 0;
    function trackDirection(s) {
      if (dirS !== null) {
        const d = s - dirS;
        if (Math.abs(d) > 0.02) { dirMoved += d; dirS = s; if (Math.abs(dirMoved) > 3) { DIR = dirMoved > 0 ? 1 : -1; dirMoved = 0; } }
      } else dirS = s;
    }
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
    /* The ground beside a tunnel approach / tunnel box.  The LiDAR ground on either side of the real cutting is a ramp of 1-3 m (and spiky), so a wall that
       follows it, or a terrain triangle that spans the wall, shows as a tilted slab.  Instead the ground has a clean SHELF: at the wall line it is as high as the
       ground SHELF_W m further out (never lower than the clearance above the rail), and it blends into the raw ground over SHELF_W m. */
    const SHELF_W = 4.0; const SLOT_EXT = 2.6; const SLOT_TAPER = 14;
    const WALL_MAX = 2.8;      // retaining wall of an approach: at most this high above the rail; above it the ground is a graded slope (widened below)
    const slotShelf = (sl, s, side) => {      // height of the ground shelf at the wall of the slot at route position s (side -1 = left wall, +1 = right wall)
      const sc = clamp(s, sl.s0, sl.s1);
      // the raw ground beside the cutting averaged along the line: a straight, calm coping instead of the zig-zag of the LiDAR
      let sum = 0; let n = 0;
      for (let k = -2; k <= 2; k++) {
        const ss = clamp(sc + k * 4.5, sl.s0, sl.s1); const g = frame(ss);
        const lat = (side < 0 ? slotLatL(ss) : SLOT_IN_R) + side * SHELF_W;
        sum += rawG(g.pos.x + g.right.x * lat, g.pos.z + g.right.z * lat); n++;
      }
      const f = frame(sc);
      let h = Math.max(sum / n, f.pos.y + 0.9);
      if (sl.kind === 'open') h = Math.min(h, f.pos.y + WALL_MAX);
      // the free end of an approach tapers: the wall (and the ground shelf on it) sinks to 0.9 m over the last SLOT_TAPER m, like the wing walls of a real trench
      const free = sl.kind !== 'open' ? 1e9 : sl.dir === 'in' ? s - sl.s0 : sl.s1 - s;
      return lerp(f.pos.y + 0.9, h, smooth(0, SLOT_TAPER, free));
    };
    const shelfBlend = (hs, h, d) => lerp(hs, h, smooth(0, clamp(1.8 * Math.max(0, h - hs), SHELF_W, 14), d));   // ground beside the wall: the slope up to the raw ground is at most ~1:1.8
    function shelfHeight(sl, q, h) {         // ground height beside the walls of `sl` for a point at nearest-record q with raw height h; NaN when the point is not on a shelf
      const L = slotLatL(q.s);
      const side = q.lat < L ? -1 : q.lat > SLOT_IN_R ? 1 : 0;
      if (!side) return NaN;
      const d = side < 0 ? L - q.lat : q.lat - SLOT_IN_R;
      if (d >= 14) return NaN;
      return shelfBlend(slotShelf(sl, q.s, side), h, d);
    }
    function blendTrack(x, z, h) {
      const q = nearest(x, z);
      if (q.d > 40) return h;
      const formY = q.y - 0.06;
      const sl = slotAt(q.s);
      if (sl) {
        const inside = q.lat > slotLatL(q.s) - SLOT_EXT && q.lat < SLOT_IN_R + SLOT_EXT;     // the band just outside the walls sinks with the floor: no terrain slope inside the trench, the wall hides the rest
        if (sl.kind === 'cover') return inside ? q.y - 2.0 : shelfOr(sl, q, h);     // a hole under the roof cap (buildCapsFor draws the ground above the tunnel at its real height)
        if (inside && sl.kind === 'open' && ((sl.dir === 'in' && q.s > sl.s1 - 4.5) || (sl.dir === 'out' && q.s < sl.s0 + 4.5))) return formY - 2.0;   // under the portal floor strip
        return inside ? formY : shelfOr(sl, q, h);
      }
      const sep = -oppLatAt(q.s);
      const dOut = q.lat >= 0 ? q.lat : Math.max(0, -q.lat - sep);
      // the bank between the formation and the raw ground is at most ~1:1.8 (a fixed 8 m ramp made 45-60 degree faces wherever the cutting is deep)
      let w = 1 - smooth(4.2, 4.2 + clamp(1.8 * Math.abs(h - formY), 7.8, 30), dOut);
      w *= (1 - structMask(track.bridges, q.s, 6)) * (1 - structMask(track.tunnels, q.s, 5));
      return w > 0 ? lerp(h, formY, w) : h;
    }
    const coverSlots = [];       // filled by initStructures
    function nodeInTunnelBox(x, z) {
      const q = nearest(x, z);
      if (q.d > 16) return 0;
      const sl = slotAt(q.s);
      if (!sl || sl.kind === 'deck' || !(q.lat > slotLatL(q.s) - SLOT_EXT && q.lat < SLOT_IN_R + SLOT_EXT)) return 0;
      if (sl.kind === 'cover') return 2;
      return 1;
    }
    const shelfOr = (sl, q, h) => { if (sl.kind === 'deck') return h; const e = shelfHeight(sl, q, h); return e === e ? e : h; };
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
    /* ONE request queue for every world / ground / facade / tree tile file: at most FETCH_MAX in flight (a 16 km line asked for dozens at once and the browser
       answered ERR_INSUFFICIENT_RESOURCES), nearest-to-the-train first, tiles that left the window are skipped, a failed file is retried once after a pause. */
    const FETCH_MAX = 6; const FETCH_RETRY_MS = 600;
    let qFocusS = 0; let qInflight = 0; const qWait = [];
    const qCancelled = (e) => !!(e && e.cancelled);
    function qPump() {
      while (qInflight < FETCH_MAX && qWait.length) {
        let bi = 0;
        const pri = (j) => (j.info.s !== undefined ? Math.abs(j.info.s - qFocusS) : 4000);      // far-ring tiles after the near world
        for (let i = 1; i < qWait.length; i++) if (pri(qWait[i]) < pri(qWait[bi])) bi = i;
        const job = qWait.splice(bi, 1)[0];
        if (job.owner.disposed) { const e = new Error('cancelled'); e.cancelled = true; job.reject(e); continue; }
        qInflight++;
        const attempt = (n) => fetch(job.url).then((r) => { if (!r.ok) { const e = new Error('HTTP ' + r.status + ' ' + job.url); e.status = r.status; throw e; } return job.kind === 'buf' ? r.arrayBuffer() : job.kind === 'blob' ? r.blob() : r.json(); })
          .catch((e) => { if (n === 0 && !job.owner.disposed && e.status !== 404) return new Promise((res) => setTimeout(res, FETCH_RETRY_MS)).then(() => attempt(1)); throw e; });
        attempt(0).then((v) => { qInflight--; job.resolve(counted(v)); qPump(); }, (e) => { qInflight--; job.reject(e); qPump(); });
      }
    }
    const qGet = (owner, info, url, kind) => new Promise((resolve, reject) => { qWait.push({ owner, info, url, kind, resolve, reject }); qPump(); });
    let loading = 0;
    function startLoad(info) {
      const key = info.key;
      const t = { key, info, state: 'loading', step: info.meta.step, dem: null, bld: null, ground: null, group: null, mesh: null, stride: 0, disposed: false, built: false, x0: info.i * TS_ - ox, z0: info.j * TS_ - oz, coarse: info.meta.step >= 4 };
      tiles.set(key, t);
      loading++;
      const ver = geo.v || 1;
      const get = (url, kind) => qGet(t, info, GEO_BASE + url + '?v=' + ver, kind);
      const pH = get('h/' + key + '.bin', 'buf').then(decodeHeights);
      const pB = geo.bld[key] ? get('bf/' + key + '.bin', 'buf').then(fx.parseTile).catch(() => []) : Promise.resolve([]);
      const pO = get('g/' + key + '.bin', 'buf').then((b) => ground.fetchTile(b));    // painted ground: class map + AO + vector layers (luxtram-ground.js)
      const pT = info.meta.trees ? get('t/' + key + '.bin', 'buf').catch(() => null) : Promise.resolve(null);
      Promise.all([pH, pB, pO.catch((e) => { if (!qCancelled(e)) console.warn(TAG + 'ground ' + key, e); return null; }), pT]).then(([dem, bld, gnd, trees]) => {
        loading--;
        if (t.disposed) return;
        t.dem = regularizeDem(dem, info.meta.step); t.bld = bld; t.ground = gnd; t.trees = trees; t.state = 'ready';
      }).catch((e) => { loading--; t.state = 'failed'; if (!qCancelled(e) && !t.disposed) console.warn(TAG + 'tile ' + key + ' failed', e); });
    }

    /* terrain mesh of one tile (stride = node skip), painted by the splat shader (luxtram-ground.js: the ground has no uv, it works from world position),
       baked ground AO in the vertex colour, skirts hide cracks between LODs */
    function buildTerrain(t, stride) {
      const info = t.info;
      const n = t.dem.n; const m = Math.floor((n - 1) / stride) + 1;
      const step = t.step * stride;
      const x0 = info.i * TS_ - ox; const z0 = info.j * TS_ - oz;
      const nv = m * m;
      const pos = new Float32Array((nv + 4 * m) * 3);
      const nor = new Float32Array((nv + 4 * m) * 3);
      const col = new Float32Array((nv + 4 * m) * 3).fill(1);
      const edge = [];
      const inTunnelBox = new Uint8Array(nv);
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) {
          const k = r * m + c;
          const xl = c * step; const zl = r * step;
          const x = x0 + xl; const z = z0 + zl;
          const y = blendTrack(x, z, t.dem.h[(r * stride) * n + c * stride] - oy);
          pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
          if (coverSlots.length) inTunnelBox[k] = nodeInTunnelBox(x, z);
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
          const ao = ground.shadeAt(t, x0 + c * step, z0 + r * step);
          col[k * 3] = ao; col[k * 3 + 1] = ao; col[k * 3 + 2] = ao;
        }
      }
      const idx = [];
      for (let r = 0; r < m - 1; r++) {
        for (let c = 0; c < m - 1; c++) {
          const a = r * m + c; const b = a + 1; const c2 = a + m; const d = c2 + 1;
          // (cells beside a tunnel wall are NOT culled: the band outside the wall sinks with the floor, so the ramp up to the ground shelf lies behind the wall and under the ground collar)
          // a cell with a node in a tunnel box would be a tilted slab over / inside the opening: cull it, the cap / collar (buildCapsFor) closes the ground there
          // (open approaches: only the steep cells straddling the wall; the ground collar closes them)
          if (inTunnelBox[a] | inTunnelBox[b] | inTunnelBox[c2] | inTunnelBox[d]) {
            if (inTunnelBox[a] === 2 || inTunnelBox[b] === 2 || inTunnelBox[c2] === 2 || inTunnelBox[d] === 2) continue;
            const ya = pos[a * 3 + 1]; const yb = pos[b * 3 + 1]; const yc = pos[c2 * 3 + 1]; const yd = pos[d * 3 + 1];
            if (Math.max(ya, yb, yc, yd) - Math.min(ya, yb, yc, yd) > 0.8) continue;
          }
          idx.push(a, c2, b, b, c2, d);
        }
      }
      // skirts: along the 4 edges, 3 m down
      let sk = nv;
      const skirt = (list) => {
        const base = sk;
        list.forEach((k) => { col[sk * 3] = col[k * 3]; col[sk * 3 + 1] = col[k * 3 + 1]; col[sk * 3 + 2] = col[k * 3 + 2]; pos[sk * 3] = pos[k * 3]; pos[sk * 3 + 1] = pos[k * 3 + 1] - 8; pos[sk * 3 + 2] = pos[k * 3 + 2]; nor[sk * 3 + 1] = 1; sk++; });
        for (let i = 0; i < list.length - 1; i++) idx.push(list[i], base + i, list[i + 1], list[i + 1], base + i, base + i + 1);
      };
      const top = []; const bot = []; const lef = []; const rig = [];
      for (let c = 0; c < m; c++) { top.push(c); bot.push((m - 1) * m + c); }
      for (let r = 0; r < m; r++) { lef.push(r * m); rig.push(r * m + m - 1); }
      skirt(top); skirt(bot); skirt(lef); skirt(rig);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(nor, 3));
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.setIndex(nv + 4 * m > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      void edge;
      return g;
    }
    function desiredStride(t, s) {
      const d = Math.abs(t.info.s - s) - 60;
      const base = d < 380 ? 1 : d < 700 ? 2 : 4;
      return Math.min(base * (t.step === 4 ? 1 : 1), (t.dem.n - 1) / 4);
    }

    /* ---- buildings (LOD2): merged per tile, one wall mesh (facade shader) + one roof mesh */
    /* far-ring buildings: the same colour families as the facade module's typologies (luxtram-facades.js makePalettes: wall render / sandstone / glass-grey /
       concrete) and its roof colours (slate, clay tile, concrete tile, zinc, gravel), so the distant blocks match the detailed ones they fade into */
    const PAL = {
      0: ['#ebe0c6', '#e7d7b4', '#ddcba6', '#e9d5c0', '#d8d0c0', '#f0eada', '#cfc1a1', '#dac38d', '#e3d0a9', '#cbb998', '#dfc6b0', '#d9d3c6'],
      1: ['#d6d4ce', '#cbc8bf', '#d9d4c4', '#c0c4c5', '#d0c7b4', '#dfdcd3', '#bab6ac', '#c9bba1'],
      2: ['#f0eee8', '#e5e3dc', '#d6d8d8', '#ece7dd', '#caccca', '#f3f1ec', '#dedbd3'],
      3: ['#f0e7d5', '#e9ddc3', '#f1ece1', '#e3d0bc', '#dad3c1', '#f4f0e7', '#e6dec9', '#d9ccb2'],
      4: ['#d2d6d8', '#c6cbce', '#b9bec1', '#dad5c8', '#cfd2d2'],
      5: ['#cbcccd', '#b9bdbf', '#d8dada', '#abb0b2', '#d0c9b9', '#c3c9cf'],
      6: ['#d9d3c2', '#cac5b7', '#d2d1cc', '#c9bda6', '#e1ddce', '#cdc7b8'],
      7: ['#d6c9ab', '#cbbe9f', '#c0b59c'],
    };
    const ROOF_PAL = {   // by typology: [colours..] (slate for the old town / institutions, clay + concrete tile for houses, zinc / gravel / membrane for blocks)
      0: ['#626972', '#596069', '#6c737c', '#555c65', '#8b9297'], 1: ['#8b9297', '#aaa9a3', '#6c7073', '#7a7e80'], 2: ['#8b9297', '#aaa9a3', '#6c7073'],
      3: ['#8f4b36', '#7f4130', '#5e6064', '#4d5054', '#626972', '#9b563a'], 4: ['#9a9994', '#8b9297', '#6c7073'], 5: ['#aaa9a3', '#9a9994', '#8b9297', '#7a7e80'],
      6: ['#626972', '#8b9297', '#6c7073'], 7: ['#626972', '#4e8f7d', '#596069'],
    };
    const roofC = {};
    Object.keys(ROOF_PAL).forEach((k) => { roofC[k] = ROOF_PAL[k].map(C); });
    const palC = {};
    Object.keys(PAL).forEach((k) => { palC[k] = PAL[k].map(C); });
    const replacedBy = (x, z, pts) => { // does a hand-built landmark replace this footprint? (TS.luxLandmarks.covers: lat/lon test)
      const lm = TS.luxLandmarks;
      if (!lm || !lm.covers) return false;
      let hit = 0; let tot = 0;
      const test = (px, pz) => { const ll = sceneToLonLat(px, pz); tot++; if (lm.covers(ll.lat, ll.lon, 1.0)) hit++; };
      test(x, z);
      for (let i = 0; i < pts.length && i < 6; i++) test(pts[i][0], pts[i][1]);
      return hit * 2 >= tot;
    };
    function buildBuildings(t) { return fx.buildTile(t); }

    /* ---- canopy trees from the LiDAR (t/<i>_<j>.bin: u16 x, u16 z (0.1 m from the tile corner), u8 height (0.25 m), u8 crown radius (0.05 m), u16 rgb565) */
    const matTree = new T.MeshLambertMaterial({ vertexColors: true });
    mats.push(matTree);
    const tmpM = new T.Matrix4(); const tmpQ = new T.Quaternion(); const tmpP = new T.Vector3(); const tmpS = new T.Vector3(); const tmpC = new T.Color(); const yAxis = new T.Vector3(0, 1, 0);
    /* painted class map: is (x, z) (scene metres) asphalt, or within `margin` m of asphalt?  (class 0 of the 0.5 m ground map; false when the map is not loaded) */
    function onAsphalt(t, x, z, margin) {
      const cls = t.ground && t.ground.cls; if (!cls) return false;
      const N_ = ground.N; const cell = TS_ / N_; const r = Math.ceil(margin / cell);
      const cx = Math.floor((x - t.x0) / cell); const cz = Math.floor((z - t.z0) / cell);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        const ix = cx + dx; const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= N_ || iz >= N_) continue;
        if (cls[iz * N_ + ix] === 0) return true;
      }
      return false;
    }
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
        if (onAsphalt(t, x, z, 1.5)) continue;       // never on / within 1.5 m of a carriageway (a LiDAR canopy over a motorway / viaduct is not a tree)
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
      const ctrl = t.ground ? ground.weightTextures(t.ground.cls, ground.N) : null;
      const mat = ground.terrainMaterial(t.x0, t.z0, TS_, ctrl, false);
      mat.vertexColors = true;
      t.ctrl = ctrl; t.mat = mat; t.stride = stride;
      const geom = buildTerrain(t, stride);
      const mesh = new T.Mesh(geom, mat);
      mesh.receiveShadow = Q.castShadow;
      mesh.renderOrder = -1;
      group.add(mesh);
      t.mesh = mesh;
      t.group = group;
      try { t.bgroup = buildBuildings(t); if (t.bgroup) group.add(t.bgroup); } catch (e) { console.warn(TAG + 'buildings ' + t.key, e); }
      try { t.tgroup = buildTileTrees(t); if (t.tgroup) group.add(t.tgroup); } catch (e) { console.warn(TAG + 'trees ' + t.key, e); }
      try { buildDecksFor(t, group); } catch (e) { console.warn(TAG + 'decks ' + t.key, e); }
      try { buildCapsFor(t, group); } catch (e) { console.warn(TAG + 'caps ' + t.key, e); }
      root.add(group);
      t.built = true;
    }
    /* the geometry on the ground (carriageways, sidewalks, kerbs, markings, rails, water, bridge decks) is draped on the final-LOD mesh of its tile;
       one tile per frame (or all at once while warming up), separate from the terrain / building budget */
    const DECOR_R = { high: 420, medium: 340, low: 260 }[quality];     // tiles beyond this keep only the painted class map (fewer draw calls); hysteresis 1.4x
    function ensureDecor(all, s) {
      let n = 0;
      for (const t of tiles.values()) {
        if (!t.built || !t.ground) continue;
        const d = Math.abs(t.info.s - s);
        if (t.decor) { if (d > DECOR_R * 1.4 && !all) undecorate(t); continue; }
        if (t.stride !== 1 || (!all && d > DECOR_R)) continue;
        decorate(t); n++;
        if (!all && n >= 1) break;
      }
    }
    function undecorate(t) {
      const dc = t.decor;
      t.decor = null;
      if (dc && dc.group) { if (t.group) t.group.remove(dc.group); dc.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      ground.dropTile(t.key);
    }
    function decorate(t) {
      if (t.decor || !t.ground) return;
      try { t.decor = ground.decorate(t, t.group); } catch (e) { console.warn(TAG + 'ground ' + t.key, e); t.decor = { group: null }; }
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
      if (t.ctrl) t.ctrl.forEach((x) => x.dispose());
      if (t.mat) t.mat.dispose();
      if (t.capMat) t.capMat.dispose();
      ground.dropTile(t.key);
      t.ground = null; t.decor = null; t.dem = null; t.bld = null; t.trees = null;
    }

    /* ---- far ring: coarse terrain (20 m nodes) + painted class map (4 m/px) + simplified buildings, so the world has no visible edge */
    const FAR_T = geo.farTile || 640; const FAR_N = geo.farNode || 20;
    const FAR_R = { high: 1700, medium: 1350, low: 950 }[quality];
    const farInfo = Object.keys(geo.far || {}).map((key) => {
      const [i, j] = key.split('_').map(Number);
      return { key, i, j, cx: (i + 0.5) * FAR_T - ox, cz: (j + 0.5) * FAR_T - oz, px: geo.far[key].px };
    });
    const farTiles = new Map();
    let farLoading = 0;
    function startFar(info) {
      const f = { key: info.key, info, state: 'loading', group: null, disposed: false };
      farTiles.set(info.key, f);
      farLoading++;
      const ver = geo.v || 1;
      const get = (url, kind) => qGet(f, info, GEO_BASE + url + '?v=' + ver, kind);
      const pH = get('f/h_' + info.key + '.bin', 'buf').then(decodeHeights);
      const pO = get('f/c_' + info.key + '.png', 'buf').then((b) => ground.fetchFarClass(b)).catch(() => null);
      const pB = info.b ? get('f/b_' + info.key + '.json', 'json').catch(() => []) : Promise.resolve([]);   // only tiles that have far buildings
      Promise.all([pH, pO, pB]).then(([dem, cls, bl]) => {
        farLoading--;
        if (f.disposed) return;
        f.dem = dem; f.cls = cls; f.bl = bl; f.state = 'ready';
      }).catch((e) => { farLoading--; f.state = 'failed'; if (!qCancelled(e) && !f.disposed) console.warn(TAG + 'far tile ' + info.key + ' failed', e); });
    }
    function buildFar(f) {
      const info = f.info; const n = f.dem.n;
      const pos = new Float32Array(n * n * 3); const nor = new Float32Array(n * n * 3);
      const x0 = info.i * FAR_T - ox; const z0 = info.j * FAR_T - oz;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const wx_ = x0 + c * FAR_N; const wz_ = z0 + r * FAR_N;
        const inNear = geo.tiles[Math.floor((wx_ + ox) / TS_) + '_' + Math.floor((wz_ + oz) / TS_)] !== undefined;   // the detailed tiles cover this: stay far below them
        pos[k * 3] = wx_; pos[k * 3 + 1] = f.dem.h[k] - oy - (inNear ? 14 : 1.5); pos[k * 3 + 2] = wz_;
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
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3));
      g.setIndex(new T.Uint16BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      f.ctrl = f.cls ? ground.weightTextures(f.cls, 160) : null;
      f.mat = ground.farMaterial(x0, z0, FAR_T, f.ctrl);
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
          const wcol = pal[(bi * 7) % pal.length]; const rp0 = roofC[kind] || roofC[1]; const rcol = rp0[(bi * 5 + 3) % rp0.length];
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
      if (f.ctrl) f.ctrl.forEach((x) => x.dispose());
      if (f.mat) f.mat.dispose();
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
    function addOsmBuilding(batch, b, ci, idx) { return fx.addOsmBuilding(batch.bld, b, ci, idx); }

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
        if (q.d < 14 && q.lat > corrLo(q.s) && q.lat < corrHi && !track.bridgeAt(q.s) && !track.inTunnel(q.s)) {   // (a road under the tram's bridge / over its tunnel does not cross the rails)
          const fr = frame(q.s);
          const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
          const along = Math.abs((dx * fr.tangent.x + dz * fr.tangent.z) / dl) > 0.8 ? 1 : 0;
          if (runStart < 0) runStart = tt;
          runAlong += along; runS += q.s; runN++;
        } else flush(tt);
      }
      flush(rd.len);
    }

    /* ---- roads: the carriageways / sidewalks / markings are drawn by luxtram-ground.js; here: the OSM road records for traffic, crossings and road lamps */
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
        if (cls <= 4 && pts.length >= 2 && total > 30 && (!bridge || (TS.luxTraffic && TS.luxTraffic.CARS_ON_BRIDGES))) {
          const rdo = { pts, cum: cumLen, len: total, hw: width / 2, oneway: (flags & 4) !== 0, cls, cross: [], along: [], bridge };
          if (!bridge) findCrossings(rdo);      // a bridge over the tram is not a level crossing: no red lights on it
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
    const SURF_COL = [[0.3, 0.45, 0.2], [0.42, 0.42, 0.41], [0.25, 0.26, 0.28], [0.4, 0.38, 0.36], [0.74, 0.72, 0.67]];   // 4 = pale ballast gravel (Cloche d'Or: Gare Howald .. Waassertuerm, ref compare/p-landmark/cloche.jpg)
    const gravelSpan = (() => { const sts = track.stations || []; const a = sts.find((q) => q.name === 'Gare Howald'); const b = sts.find((q) => q.name === 'Waassertuerm'); return a && b ? [a.platformEnd, b.platformStart] : null; })();
    function bedStrip(batch, getFrame, a, b, surf) {
      const step = 3;
      const n = Math.max(1, Math.ceil((b - a) / step));
      const grass = surf === 0;
      const col = SURF_COL[surf] || SURF_COL[1];
      const pts = [];
      for (let i = 0; i <= n; i++) { const f = getFrame(a + ((b - a) * i) / n); pts.push({ x: f.pos.x, y: f.pos.y + (grass ? -0.11 : -0.02), z: f.pos.z }); }
      if (grass) {
        /* the grass track is the SAME painted lawn as the terrain around it (ground surface material, same colours at every distance), lying 3 cm ABOVE
           the terrain mesh: it can never z-fight with it, so there is no light/dark band that follows the camera */
        const S = batch.surf; const base = S.count;
        for (let i = 0; i < pts.length; i++) {
          const q0 = pts[Math.max(0, i - 1)]; const q1 = pts[Math.min(pts.length - 1, i + 1)];
          const dl = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1; const nx = -(q1.z - q0.z) / dl; const nz = (q1.x - q0.x) / dl;
          const y = pts[i].y + 0.08;
          S.vert(pts[i].x - nx * 1.75, y, pts[i].z - nz * 1.75, 0, 1, 0, ground.MAT.LAWN, 1, 1, 1);
          S.vert(pts[i].x + nx * 1.75, y, pts[i].z + nz * 1.75, 0, 1, 0, ground.MAT.LAWN, 1, 1, 1);
        }
        for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; S.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      } else ribbon(batch.bed, pts, 1.65, col, { vScale: 3, u0: 0, u1: 1 });
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
        const sf = sg.surf === 0 && gravelSpan && (a + b) / 2 > gravelSpan[0] && (a + b) / 2 < gravelSpan[1] ? 4 : sg.surf;
        bedStrip(batch, frame, a, b, sf);
        if (hasOpp) {
          const oa = Math.max(a, track.opposite.from); const ob = Math.min(b, track.opposite.to);
          if (ob - oa > 0.5) bedStrip(batch, track.opposite.frameAt, oa, ob, sf);
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
        const yb = yBot(f, x, z, s); const yt = yTop(f, x, z, s);
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
        const y = yFn(f, s);
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
      // (the sides above the roof slab up to the cap are built with the cap in buildCapsFor)
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
      // wall tops lie exactly on the ground shelf (slotShelf), so wall, coping and the ground collar (buildCapsFor) are one clean edge
      const topFn = open
        ? (f, x, z, side, s) => slotShelf(sl, s, side)
        : (f, x, z) => sl.deckUnder(x, z);
      if (!open) { // underpass walls under a deck (open approaches: walls + coping are built with the ground collar in buildCapsFor, from the same ground heights)
        wallStrip(batch.misc, sl.s0, sl.s1, slotLatL, (f) => f.pos.y - 0.5, (f, x, z, s) => topFn(f, x, z, -1, s), CONC, 1);
        wallStrip(batch.misc, sl.s0, sl.s1, () => SLOT_IN_R, (f) => f.pos.y - 0.5, (f, x, z, s) => topFn(f, x, z, 1, s), CONC, -1);
      }
      if (open) { // concrete floor of the portal approach (the terrain sinks under it)
        const f0 = sl.dir === 'in' ? Math.max(sl.s0, sl.s1 - 5) : sl.s0;
        const f1 = sl.dir === 'in' ? sl.s1 : Math.min(sl.s1, sl.s0 + 5);
        flatStrip(batch.misc, f0, f1 + (sl.dir === 'in' ? 1.2 : 0), slotLatL, SLOT_IN_R, (f) => f.pos.y - 0.28, [0.46, 0.46, 0.44], true, { step: 1 });
      }
    }
    /* concrete box-girder deck with parapets, piers and abutments (the named Pont Rouge / Pont Adolphe leave their detail to the landmarks) */
    /* The two big named bridges carry the real road: the tram next to the carriageways, cycle / foot paths on the outer edges.  The painted ground shows
       the valley below (no deck on the valley floor), so the deck top is meshed here, at deck level, with the real lane layout.  Lateral offsets are metres to the right of the tram track, measured from the LiDAR deck footprint and the OSM carriageways:
         Pont Grande-Duchesse Charlotte  deck -23.0 .. +5.0   (tram on the north side, 2 + 2 lanes and the cycle path to the south, footway on the north edge)
         Pont Adolphe                    deck  -8.0 .. +11.5  (tram, 2-lane carriageway, footways both sides) */
    const DECK_PROFILES = {
      Charlotte: { fascia: '#a8352e', under: '#7a2420', rail: '#d9d6cf', parts: [['pave', -23.0, -19.4], ['road', -19.4, -12.3], ['road', -12.3, -5.4], ['tram', -5.4, 1.6], ['pave', 1.6, 5.0]] },
      Adolphe: { fascia: '#cdbf9f', under: '#a99978', rail: '#d8cfba', noParapet: true, parts: [['pave', -8.0, -5.6], ['tram', -5.6, 1.6], ['road', 1.6, 8.4], ['pave', 8.4, 11.5]] },
    };
    const DECK_DROP = 0.04;       // road surface just below the rail head (the tram bed ribbons sit on top of it)
    /* named-bridge deck surfaces on the painted ground material (ground.matSurface: the same asphalt / paving / paint as the rest of the world).
       S = ground.Acc of the chunk; the strips are draped at the track's own frames (the deck follows the rail level). */
    function surfStrip(S, sA, sB, lat0, lat1, mat, col, dy, step) {
      const n = Math.max(1, Math.ceil((sB - sA) / (step || 3)));
      const base = S.count;
      for (let i = 0; i <= n; i++) {
        const s = sA + ((sB - sA) * i) / n; const f = frame(s); const y = f.pos.y - DECK_DROP + (dy || 0);
        const l0 = typeof lat0 === 'function' ? lat0(s) : lat0; const l1 = typeof lat1 === 'function' ? lat1(s) : lat1;
        S.vert(f.pos.x + f.right.x * l0, y, f.pos.z + f.right.z * l0, 0, 1, 0, mat, col[0], col[1], col[2]);
        S.vert(f.pos.x + f.right.x * l1, y, f.pos.z + f.right.z * l1, 0, 1, 0, mat, col[0], col[1], col[2]);
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; S.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const DECK_PAINT = 0.04;      // above the deck asphalt (the ground module's own paint sits 3.5 cm above its road)
    /* lane markings of a named deck: solid edge lines, a solid divider where two carriageway parts meet, dashed lane lines in the middle of every 2-lane part */
    function deckLines(S, sA, sB, P) {
      const W = [0.96, 0.96, 0.94]; const FL = ground.MAT.FLAT;
      const roads = P.parts.filter((q) => q[0] === 'road');
      if (!roads.length) return;
      const solid = (lat, w) => surfStrip(S, sA, sB, lat - w / 2, lat + w / 2, FL, W, DECK_PAINT, 6);
      const dashed = (lat) => { for (let s = Math.ceil(sA / 9) * 9; s < sB; s += 9) surfStrip(S, Math.max(sA, s), Math.min(sB, s + 4), lat - 0.075, lat + 0.075, FL, W, DECK_PAINT, 4); };
      const lo = Math.min(...roads.map((q) => q[1])); const hi = Math.max(...roads.map((q) => q[2]));
      solid(lo + 0.3, 0.15); solid(hi - 0.3, 0.15);
      for (let k = 0; k < roads.length; k++) {
        const [, a, b] = roads[k];
        if (b - a >= 5.5) dashed((a + b) / 2);
        if (k + 1 < roads.length && roads[k + 1][1] === b) { solid(b - 0.09, 0.12); solid(b + 0.09, 0.12); }
      }
    }
    function buildNamedDeck(br, batch, ca, cb) {
      const key = /Charlotte/.test(br.name || '') ? 'Charlotte' : 'Adolphe';
      const P = DECK_PROFILES[key];
      // the part of the deck inside this chunk (the deck is longer than a chunk and chunks stream in and out on their own)
      const sA = Math.max(br.s0 - 0.5, ca); const sB = Math.min(br.s1 + 0.5, cb);
      if (sB - sA < 0.5) return;
      const l0 = P.parts[0][1]; const l1 = P.parts[P.parts.length - 1][2];
      const G = ground.MAT;
      P.parts.forEach(([kind, a, b]) => {
        if (kind === 'road') surfStrip(batch.surf, sA, sB, a, b, G.ASPH, [1, 1, 1], 0, 3);
        else if (kind === 'tram') surfStrip(batch.surf, sA, sB, a, b, G.SETT, [0.92, 0.92, 0.9], 0, 3);
        else surfStrip(batch.surf, sA, sB, a, b, G.PAVE, [0.97, 0.96, 0.94], 0.02, 3);
      });
      deckLines(batch.surf, sA, sB, P);
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
      const depth = named ? 2.4 : 1.25;
      const deckCol = named ? C('#a9a69f') : CONC;
      const SLAB = 0.45; const WEB_IN = 0.8;      // the top slab is 0.45 m thick and overhangs the box girder below by 0.8 m: a visible edge beam
      if (!named) {
        // the deck top across the whole slot (the OSM road decks of the ground module cover only the carriageways; without this the underside shows between them)
        surfStrip(batch.surf, sA - 2.5, sB + 2.5, lL, () => lR, ground.MAT.PAVE, [0.86, 0.85, 0.82], -0.08, 3);   // short run-on at both ends: no strip hanging over the embankment
        // edge beams (outer faces of the slab, light concrete), then the girder webs set back under them
        wallStrip(batch.misc, sA, sB, lL, (f) => f.pos.y - SLAB, (f) => f.pos.y + 1.05, CONC_L, 1);
        wallStrip(batch.misc, sA, sB, () => lR, (f) => f.pos.y - SLAB, (f) => f.pos.y + 1.05, CONC_L, -1);
        flatStrip(batch.misc, sA, sB, lL, (s) => lL(s) + WEB_IN, (f) => f.pos.y - SLAB, CONC_D, false, { step: 3 });      // soffit of the overhang
        flatStrip(batch.misc, sA, sB, () => lR - WEB_IN, () => lR, (f) => f.pos.y - SLAB, CONC_D, false, { step: 3 });
        wallStrip(batch.misc, sA, sB, (s) => lL(s) + WEB_IN, (f) => f.pos.y - depth, (f) => f.pos.y - SLAB, deckCol, 1);
        wallStrip(batch.misc, sA, sB, () => lR - WEB_IN, (f) => f.pos.y - depth, (f) => f.pos.y - SLAB, deckCol, -1);
        flatStrip(batch.misc, sA, sB, (s) => lL(s) + WEB_IN, () => lR - WEB_IN, (f) => f.pos.y - depth, CONC_D, false, { step: 3 });
        // end caps close the box girder at both ends (no void to see into at the abutments)
        [sA, sB].forEach((se, k) => {
          const f = frame(se); const l0 = lL(se); const sg = k === 0 ? -1 : 1;
          const a = batch.misc.vert(f.pos.x + f.right.x * l0, f.pos.y - depth, f.pos.z + f.right.z * l0, f.tangent.x * sg, 0, f.tangent.z * sg, 0, 0, CONC);
          const b = batch.misc.vert(f.pos.x + f.right.x * lR, f.pos.y - depth, f.pos.z + f.right.z * lR, f.tangent.x * sg, 0, f.tangent.z * sg, 0, 0, CONC);
          const c = batch.misc.vert(f.pos.x + f.right.x * lR, f.pos.y - 0.1, f.pos.z + f.right.z * lR, f.tangent.x * sg, 0, f.tangent.z * sg, 0, 0, CONC);   // top = just under the deck surface: nothing may stand across the track
          const d = batch.misc.vert(f.pos.x + f.right.x * l0, f.pos.y - 0.1, f.pos.z + f.right.z * l0, f.tangent.x * sg, 0, f.tangent.z * sg, 0, 0, CONC);
          batch.misc.quad(a, b, c, d);
        });
        flatStrip(batch.misc, sA, sB, (s) => lL(s) - 0.25, (s) => lL(s), (f) => f.pos.y + 1.06, CONC_L, true, { step: 3 });
        flatStrip(batch.misc, sA, sB, lR, lR + 0.25, (f) => f.pos.y + 1.06, CONC_L, true, { step: 3 });
      }
      // supports: a pair of columns with a cross-head under every pier line, columns that reach the ground; abutment walls at both ends
      const len = sB - sA;
      const np = Math.max(0, Math.floor(len / 30));
      const places = [];
      for (let k = 1; k <= np; k++) places.push(sA + (len * k) / (np + 1));
      places.push(sA + 0.8); places.push(sB - 0.8);
      places.forEach((s, idx) => {
        const f = frame(s);
        const abut = idx >= places.length - 2;
        const rot = Math.atan2(f.right.z, f.right.x) + Math.PI / 2;
        const l0 = lL(s) + WEB_IN; const l1 = lR - WEB_IN; const wid = l1 - l0;
        if (abut) {
          const lat = (l0 + l1) / 2; const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
          const g = Math.min(rawG(f.pos.x + f.right.x * l0, f.pos.z + f.right.z * l0), rawG(x, z), rawG(f.pos.x + f.right.x * l1, f.pos.z + f.right.z * l1));
          const hh = f.pos.y - depth - g + 0.4;
          if (hh < 0.3) return;
          addBox(batch.misc, x, g + hh / 2 - 0.4, z, 1.0, hh + 0.4, wid * 1.02, rot, CONC);     // the abutment wall stands 0.4 m into the embankment
          return;
        }
        [l0 + 1.4, l1 - 1.4].forEach((lat) => {
          const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
          const g = rawG(x, z);
          const hh = f.pos.y - depth - g;
          if (hh < 0.6) return;
          addBox(batch.misc, x, g + hh / 2 - 0.3, z, 1.3, hh + 0.6, 1.3, rot, CONC);              // column: 0.3 m into the ground, up to the girder
        });
        addBox(batch.misc, f.pos.x + f.right.x * (l0 + l1) / 2, f.pos.y - depth - 0.3, f.pos.z + f.right.z * (l0 + l1) / 2, 1.8, 0.6, wid * 0.94, rot, CONC_D);   // cross-head
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

    /* overpass decks (LiDAR flood fill): meshed here at the fitted plane (asphalt of the ground module's surface shader); the other OSM bridges come from luxtram-ground.js */
    const decks = [];
    function initStructures() {
      const sd = loadStructures();
      const toR = (so) => lt.toRoute(lt.absFromOrig(so));
      const lo = 0; const hi = L;
      track.tunnels.forEach((tn) => {
        slots.push({ s0: tn.s0, s1: tn.s1, kind: 'cover' }); coverSlots.push(tn);
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
        // a "deck" beside / over a platform is the stop's own canopy (LiDAR sees the roof): the station module draws that, no walls and no second roof
        if (track.stations.some((st) => d.s1 > st.platformStart - 30 && d.s0 < st.platformEnd + 30)) return;
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
        let tris = null;
        try { tris = T.ShapeUtils.triangulateShape(ring.map((q) => new T.Vector2(q[0], q[1])), []); } catch (e) { tris = null; }
        if (!tris) return;
        const pos = []; const nor = [];
        const nrm = (() => { const k = Math.hypot(a, 1, b); return [-a / k, 1 / k, -b / k]; })();
        tris.forEach((tr) => tr.forEach((vi) => {
          const xl = ring[vi][0] + ox; const zl = ring[vi][1] + oz;
          pos.push(ring[vi][0], yTop(xl, zl) + 0.04, ring[vi][1]); nor.push(nrm[0], nrm[1], nrm[2]);
        }));
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('aMat', new T.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));   // material 0 = asphalt of the ground module's surface shader
        g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
        const topMesh = new T.Mesh(g, ground.matSurface); topMesh.renderOrder = 0; group.add(topMesh);   // the overpass deck: painted asphalt
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

    /* The ground that closes the terrain mesh around the tunnel structures (the terrain triangles that span a wall are culled in buildTerrain):
       - a cap above every cut-and-cover tunnel, between the two ground shelves (planar between them, never below the roof),
       - a collar COLLAR_W m wide along the outside of every wall (tunnel boxes and open approaches), following the shelf blend of blendTrack exactly.
       Painted like the tile (terrain splat material), 3 cm above the (culled) terrain. */
    const COLLAR_W = 16;
    const COLLAR_D = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6.5, 8, 10, 12, 14, COLLAR_W];
    const capY = (sl, s, lat) => { const L = slotLatL(s); const u = clamp((lat - L) / (SLOT_IN_R - L), 0, 1); return Math.max(lerp(slotShelf(sl, s, -1), slotShelf(sl, s, 1), u), frame(s).pos.y + 6.45); };
    const collarY = (sl, s, side, d, x, z) => shelfBlend(slotShelf(sl, s, side), rawG(x, z), d);
    function buildCapsFor(t, group) {
      const pos = []; const idx = [];
      const wm = new Mesher();       // concrete: approach walls with coping, tunnel box sides up to the cap
      const addStrip = (rows) => {          // rows = list of lateral rows (arrays of [x, y, z]) along the line; a quad belongs to the tile that holds its centre (the splat uv is per tile)
        const nLat = rows[0].length; const base = pos.length / 3;
        rows.forEach((row) => row.forEach((v) => { pos.push(v[0], v[1], v[2]); }));
        for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < nLat - 1; k++) {
          const a = base + r * nLat + k; const b = a + 1; const c2 = a + nLat; const d = c2 + 1;
          const cx = (rows[r][k][0] + rows[r + 1][k + 1][0]) / 2 + ox; const cz = (rows[r][k][2] + rows[r + 1][k + 1][2]) / 2 + oz;
          if (Math.floor(cx / TS_) !== t.info.i || Math.floor(cz / TS_) !== t.info.j) continue;
          // wound counter-clockwise seen from above (a double-sided material shades the BACK face with a flipped normal: a clockwise quad would render black)
          const ux = pos[c2 * 3] - pos[a * 3]; const uz = pos[c2 * 3 + 2] - pos[a * 3 + 2]; const vx = pos[b * 3] - pos[a * 3]; const vz = pos[b * 3 + 2] - pos[a * 3 + 2];
          if (uz * vx - ux * vz >= 0) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
        }
      };
      slots.forEach((sl) => {
        if (sl.kind !== 'cover' && sl.kind !== 'open') return;
        const step = 3;
        const ext = sl.kind === 'open' ? 6 : 0;      // the collar runs on 6 m past the ends of an approach: it closes the terrain cells that were cut at the ends
        for (let s = sl.s0 - ext; s < sl.s1 + ext; s += step) {
          const sa = s; const sb = Math.min(sl.s1 + ext, s + step);
          const fm = frame((sa + sb) / 2);
          if (Math.abs(fm.pos.x + ox - (t.info.i + 0.5) * TS_) > TS_ * 0.5 + 14 || Math.abs(fm.pos.z + oz - (t.info.j + 0.5) * TS_) > TS_ * 0.5 + 14) continue;
          const mk = (fn) => [sa, sb].map((ss) => { const f = frame(ss); return fn(f, ss); });
          const P = (f, lat, y) => [f.pos.x + f.right.x * lat, y, f.pos.z + f.right.z * lat];
          // left collar (outermost first), right collar
          addStrip(mk((f, ss) => { const L = slotLatL(ss); return COLLAR_D.slice().reverse().map((d) => { const x = f.pos.x + f.right.x * (L - d); const z = f.pos.z + f.right.z * (L - d); return [x, collarY(sl, ss, -1, d, x, z) + 0.03, z]; }); }));
          addStrip(mk((f, ss) => COLLAR_D.map((d) => { const lat = SLOT_IN_R + d; const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat; return [x, collarY(sl, ss, 1, d, x, z) + 0.03, z]; })));
          // walls + coping, from exactly the shelf heights the collar starts at
          const wallQuad = (side, yBot, yTop, col) => {
            const rows = [sa, sb].map((ss) => { const f = frame(ss); const lat = side < 0 ? slotLatL(ss) : SLOT_IN_R; return { x: f.pos.x + f.right.x * lat, z: f.pos.z + f.right.z * lat, yb: yBot(f, ss), yt: yTop(f, ss), nx: -f.right.x * side, nz: -f.right.z * side }; });
            const v = rows.map((r) => [wm.vert(r.x, r.yb, r.z, r.nx, 0, r.nz, 0, 0, col), wm.vert(r.x, r.yt, r.z, r.nx, 0, r.nz, 0, 1, col)]);
            wm.quad(v[0][0], v[1][0], v[1][1], v[0][1]);
          };
          const mine = sa >= sl.s0 - 1e-6 && sb <= sl.s1 + 1e-6 && Math.floor((fm.pos.x + ox) / TS_) === t.info.i && Math.floor((fm.pos.z + oz) / TS_) === t.info.j;   // walls: once, by the tile that holds the segment
          if (mine) [-1, 1].forEach((side) => {
            if (sl.kind === 'open') {
              wallQuad(side, (f) => f.pos.y - 0.5, (f, ss) => slotShelf(sl, ss, side), CONC);
              const cop = mk((f, ss) => { const L = slotLatL(ss); const l0 = side < 0 ? L - 0.45 : SLOT_IN_R; const l1 = side < 0 ? L : SLOT_IN_R + 0.45; return [P(f, l0, slotShelf(sl, ss, side) + 0.02), P(f, l1, slotShelf(sl, ss, side) + 0.02)]; });
              const b0 = wm.count; cop.forEach((row) => row.forEach((v) => wm.vert(v[0], v[1], v[2], 0, 1, 0, 0, 0, CONC_L)));
              wm.quad(b0, b0 + 1, b0 + 3, b0 + 2);
            } else wallQuad(side, (f) => f.pos.y + 5.6, (f, ss) => Math.max(f.pos.y + 5.7, capY(sl, ss, side < 0 ? slotLatL(ss) : SLOT_IN_R)), TUN_WALL);
          });
          if (sl.kind === 'cover') addStrip(mk((f, ss) => { const L = slotLatL(ss); const out = []; for (let k = 0; k <= 6; k++) { const lat = L + ((SLOT_IN_R - L) * k) / 6; out.push(P(f, lat, capY(sl, ss, lat) + 0.03)); } return out; }));
        }
      });
      { const wmesh = wm.mesh(matMisc, {}); if (wmesh) group.add(wmesh); }
      if (!pos.length) return;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.attributes.normal) for (let i = 0; i < g.attributes.normal.count; i++) if (g.attributes.normal.getY(i) < 0) g.attributes.normal.setXYZ(i, -g.attributes.normal.getX(i), -g.attributes.normal.getY(i), -g.attributes.normal.getZ(i));
      t.capMat = ground.terrainMaterial(t.x0, t.z0, TS_, t.ctrl, false);
      t.capMat.polygonOffset = true; t.capMat.polygonOffsetFactor = -2; t.capMat.polygonOffsetUnits = -2;
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
      const batch = { bld: fx.newBatch(), surf: new ground.Acc(), bed: new Mesher(), misc: new Mesher(), steel: new Mesher(), leaf: new Mesher(), glowLamp: new Mesher() };
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
      { const bm = fx.batchMesh(batch.bld); if (bm) group.add(bm); }
      { const sm = batch.surf.mesh(T, ground.matSurface, 0); if (sm) group.add(sm); }
      add(batch.bed, matBed, { order: 1 });
      add(batch.misc, matMisc, {});
      add(batch.steel, matSteel, { cast: Q.castShadow });
      add(batch.leaf, matLeaf, { cast: Q.castShadow, noReceive: true });
      add(batch.glowLamp, matLampGlow, { noReceive: true });
      root.add(group);
      roadsByChunk.set(ci, roadsOut);
      return { ci, group, buildings: built };
    }

    /* ---- height of the rendered ground (the painted-ground module drapes its geometry on it) and the shared road-height query (P-GROUND <-> P-TRAFFIC).
       meshY(t, x, z): the Y of the visible terrain mesh of tile t (same triangulation / LOD as buildTerrain: diagonal b -> c2), NaN when the tile has no mesh.
       surfY(t, x, z): the same, falling back to the LiDAR height.  roadHeightAt(x, z, onBridge): the road surface actually rendered at (x, z):
         onBridge = false: the carriageway drawn on the ground (rasterised from its own triangles; terrain mesh + ROAD_LIFT where none is drawn); NaN while the tile is not built / not yet decorated at its final LOD
         onBridge = true : the bridge deck of the OSM bridge roads (flag&1), measured from the LiDAR surface model (NaN when no deck there).
       Roads under a bridge keep working: ask with onBridge = false. */
    function meshY(t, x, z) {
      if (!t || !t.mesh || !t.dem) return NaN;
      const n = t.dem.n; const stride = t.stride; const m = Math.floor((n - 1) / stride) + 1; const step = t.step * stride;
      const u = (x - t.x0) / step; const v = (z - t.z0) / step;
      const c = clamp(Math.floor(u), 0, m - 2); const r = clamp(Math.floor(v), 0, m - 2);
      const fu = clamp(u - c, 0, 1); const fv = clamp(v - r, 0, 1);
      const P = t.mesh.geometry.attributes.position.array;
      const ya = P[(r * m + c) * 3 + 1]; const yb = P[(r * m + c + 1) * 3 + 1]; const yc = P[((r + 1) * m + c) * 3 + 1]; const yd = P[((r + 1) * m + c + 1) * 3 + 1];
      return fu + fv <= 1 ? ya + (yb - ya) * fu + (yc - ya) * fv : yd + (yc - yd) * (1 - fu) + (yb - yd) * (1 - fv);
    }
    const tileOf = (x, z) => tiles.get(Math.floor((x + ox) / TS_) + '_' + Math.floor((z + oz) / TS_));
    /* beside / above the tunnel structures the terrain mesh has a hole; the visible ground there is the cap / collar (buildCapsFor): the painted ground is draped on it */
    let coverBoxes = null;
    function coverHeight(x, z) {
      if (!coverBoxes) {
        coverBoxes = [];
        slots.forEach((sl) => {
          if (sl.kind !== 'cover' && sl.kind !== 'open') return;
          for (let s = sl.s0; s <= sl.s1 + 10; s += 10) { const f = frame(Math.min(s, sl.s1)); coverBoxes.push([f.pos.x - 26, f.pos.z - 26, f.pos.x + 26, f.pos.z + 26]); }
        });
      }
      if (!coverBoxes.length) return NaN;
      let near = false;
      for (let i = 0; i < coverBoxes.length; i++) { const b = coverBoxes[i]; if (x > b[0] && x < b[2] && z > b[1] && z < b[3]) { near = true; break; } }
      if (!near) return NaN;
      const q = nearest(x, z);
      if (!q || q.d > 24) return NaN;
      const sl = slotAt(q.s);
      if (!sl || (sl.kind !== 'cover' && sl.kind !== 'open')) return NaN;
      const L = slotLatL(q.s);
      if (q.lat > L - 0.1 && q.lat < SLOT_IN_R + 0.1) return sl.kind === 'cover' ? capY(sl, q.s, q.lat) + 0.03 : NaN;
      const side = q.lat < L ? -1 : 1; const d = side < 0 ? L - q.lat : q.lat - SLOT_IN_R;
      return d < COLLAR_W ? collarY(sl, q.s, side, d, x, z) + 0.03 : NaN;
    }
    const surfY = (t, x, z) => { const c = coverHeight(x, z); if (c === c) return c; const y = meshY(t, x, z); return y === y ? y : gy(x, z); };
    function normalAt(t, x, z) {
      if (!t || !t.mesh || !t.dem) return [0, 1, 0];
      const n = t.dem.n; const stride = t.stride; const m = Math.floor((n - 1) / stride) + 1; const step = t.step * stride;
      const c = clamp(Math.round((x - t.x0) / step), 0, m - 1); const r = clamp(Math.round((z - t.z0) / step), 0, m - 1);
      const N = t.mesh.geometry.attributes.normal.array;
      return [N[(r * m + c) * 3], N[(r * m + c) * 3 + 1], N[(r * m + c) * 3 + 2]];
    }
    const ground = TS.luxGround.create({ T, quality, Q, oy, surfY, normalAt });
    const roadHeightAt = (x, z, onBridge, roadOnly) => {
      if (onBridge) return ground.deckHeight(x, z);
      const t = tileOf(x, z);
      if (!t || !t.built || !t.mesh || !t.decor) return NaN;       // not built / not at its final LOD (decorated) yet
      const r = ground.roadSurface(t, x, z, meshY(t, x, z));       // the drawn carriageway triangles (of overlapping layers: the one at the terrain, not a ramp above / street below)
      if (r === r) return r;
      if (roadOnly) return NaN;                    // roadOnly: no terrain fallback (the traffic then levels a wheel that is off the carriageway)
      const y = surfY(t, x, z);                    // no carriageway drawn here (kerb side, parking): the terrain + the road lift
      return y === y ? y + ground.ROAD_LIFT : NaN;
    };

    /* the painted carriageway under (x, z) for infra.js (masts / boards must not stand in a lane): 1 = drawn carriageway, 0 = none, -1 = the tile is not built / decorated yet */
    const drawnRoad = (x, z) => {
      const t = tileOf(x, z);
      if (!t) return tileByKey.has(Math.floor((x + ox) / TS_) + '_' + Math.floor((z + oz) / TS_)) ? -1 : 0;
      if (!t.built || !t.mesh || !t.decor) return -1;
      const r = ground.roadSurface(t, x, z, meshY(t, x, z));
      return r === r ? 1 : 0;
    };
    TS.luxDrawnRoad = drawnRoad;
    const paintAt = (x, z) => { const t = tileOf(x, z); return t ? ground.paintAt(t, x, z) : 0; };   // painted lane line under (x, z) (traffic: lane centres)

    /* ---- traffic: moved to luxtram-traffic.js (TS.luxTraffic) */
    const traffic = (Q.cars && TS.luxTraffic)
      ? TS.luxTraffic.create({ THREE: T, root, Q, roadsByChunk, gy, rawG, roadHeightAt, paintAt, tileOf, nearest, frame, track, quality, night: () => nightK, hasOpp, oppLatAt, roadMarginExcept, routeReverse: !!(options && options.reverse) })
      : null;
    const markTraffic = () => { if (traffic) traffic.markDirty(); };
    let tramS = -1e9;

    /* ---- streaming */
    let lastS = -1e9;
    function wantedChunks(s) {
      const sOrig = lt.origFromAbs(s + lt.sStart);
      // the window is mirrored by the driving direction (return routes run towards smaller forward-track s): `ahead` always lies in front of the cab
      const back = DIR > 0 ? Q.behind : Q.ahead; const fwd = DIR > 0 ? Q.ahead : Q.behind;
      const lo = Math.max(firstCi, Math.floor((sOrig - back) / data.chunk));
      const hi = Math.min(lastCi, Math.floor((sOrig + fwd) / data.chunk));
      return [lo, hi];
    }
    function ensureTiles(s, all) {
      qFocusS = s;
      const ahead = Q.ahead; const behind = Q.behind;
      // load / keep: tiles whose nearest line position lies in the window (plus a margin for their size)
      const want = [];
      tileInfo.forEach((info) => {
        const ds = (info.s - s) * DIR;      // metres ahead (+) / behind (-) in the driving direction
        if (ds > -behind - 90 && ds < ahead + 90) want.push(info);
      });
      want.sort((a, b) => Math.abs(a.s - s) - Math.abs(b.s - s));
      const wantKeys = new Set(want.map((i) => i.key));
      Array.from(tiles.values()).forEach((t) => { const ds = (t.info.s - s) * DIR; if (!wantKeys.has(t.key) && (ds < -behind - 260 || ds > ahead + 260)) disposeTile(t); });
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
        markTraffic();
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
      roadsByChunk.delete(k); lampsByChunk.delete(k); markTraffic();
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
    /* ---- distance LOD of the draw-call heavy small stuff (budget: <= 280 draws in the city).  Throttled to ~2.5 Hz:
       - canopy tree meshes (one InstancedMesh per tile) vanish beyond LOD_TREE_R (a 400 m tree is a few pixels, the buildings hide the rest);
       - a Luxtram stop (24 draws) keeps only its shelter / platform meshes beyond LOD_STOP_DETAIL_R and disappears beyond LOD_STOP_R. */
    const LOD_POND_R = 160; const LOD_TREE_R = 400; const LOD_STOP_DETAIL_R = 230; const LOD_STOP_R = 500; const LOD_HYST = 30;
    let lodClock = 0; let infraRoot = null;
    const lodBox = new T.Box3(); const lodC = new T.Vector3();
    function distanceLod(camera, dt) {
      lodClock -= dt;
      if (lodClock > 0 || !camera) return;
      lodClock = 0.4;
      const cx = camera.position.x; const cz = camera.position.z;
      tiles.forEach((t) => {
        if (!t.tgroup || !t.info) return;
        const x0 = t.info.i * TS_ - ox; const z0 = t.info.j * TS_ - oz;
        const d = Math.hypot(Math.max(x0 - cx, 0, cx - (x0 + TS_)), Math.max(z0 - cz, 0, cz - (z0 + TS_)));
        const was = t.tgroup.visible;
        const vis = d < LOD_TREE_R + (was ? LOD_HYST : 0);
        if (vis !== was) t.tgroup.visible = vis;
        const wm = t.decor && t.decor.water;       // tiny ponds / basins: a draw call for a few pixels
        if (wm && wm.geometry && wm.geometry.index && wm.geometry.index.count < 450) { const wv = d < LOD_POND_R + (wm.visible ? LOD_HYST : 0); if (wv !== wm.visible) wm.visible = wv; }
      });
      if (!infraRoot || !infraRoot.parent) infraRoot = scene.children.find((c) => c.name === 'train-sim-infra') || null;
      if (!infraRoot) return;
      for (let i = 0; i < infraRoot.children.length; i++) {
        const g = infraRoot.children[i];
        if (!g.name || g.name.indexOf('station:') !== 0 || !g.children.length) continue;
        let u = g.userData.luxLod;
        if (!u) {
          g.updateMatrixWorld(true); lodBox.setFromObject(g); lodBox.getCenter(lodC);
          const small = []; g.traverse((o) => { if (o.isMesh && !o.castShadow) small.push(o); });
          u = g.userData.luxLod = { x: lodC.x, y: lodC.y, z: lodC.z, small, detail: true, shown: true };
        }
        const d = Math.hypot(u.x - camera.position.x, u.z - camera.position.z);
        const show = d < LOD_STOP_R + (u.shown ? LOD_HYST : 0);
        if (show !== u.shown) { u.shown = show; g.visible = show; }
        const detail = show && d < LOD_STOP_DETAIL_R + (u.detail ? LOD_HYST : 0);
        if (detail !== u.detail) { u.detail = detail; for (let k = 0; k < u.small.length; k++) u.small[k].visible = detail; }
      }
    }
    function update(s, camera, dt) {
      if (disposed) return;
      hideProceduralScenery();
      distanceLod(camera, Math.min(0.1, dt || 0.016));
      const sc = clamp(s, 0, L);
      tramS = sc;
      trackDirection(sc);
      if (traffic) traffic.update(Math.min(0.1, dt || 0.016), sc, camera);
      ensureTiles(sc, false);
      ensureDecor(false, sc);
      ensureChunks(sc, false);
      ensureFar(sc, camera, false);
      ground.update(Math.min(0.1, dt || 0.016));
      const sun = landscape && landscape.sun ? landscape.sun.intensity : 3;
      nightK = 1 - smooth(0.2, 1.4, sun);
      fx.setNight(nightK * 1.25);
      if (lm && lm.update) { try { lm.update(sc, camera); } catch (e) { console.warn(TAG + 'landmark update', e); } }
      lastS = s; qFocusS = s;
    }
    let warmS = null;   // where the opening warm-up was asked for (progress() measures that window)
    function warm(s) {
      const sc = clamp(s === undefined ? 0 : s, 0, L);
      if (warmS === null) warmS = sc;
      ensureTiles(sc, true);
      ensureDecor(true, sc);
      ensureChunks(sc, true);
      ensureFar(sc, null, true);
    }
    /* the detailed tiles of the window around s (same rule as ensureTiles) and the far tiles within the far radius (same rule as ensureFar) */
    function windowTiles(s) {
      return tileInfo.filter((info) => { const ds = (info.s - s) * DIR; return ds > -Q.behind - 90 && ds < Q.ahead + 90; });
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
        const ds = (info.s - tramS) * DIR;
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
      if (traffic) traffic.dispose();
      ground.dispose();
      treeTplDec.dispose(); treeTplCon.dispose(); treeTplBoth.dispose();
      treeTpl.length = 0;
      activeOrigin = null;
      if (TS.luxRoadMargin === roadMargin) TS.luxRoadMargin = null;
      if (TS.luxDrawnRoad === drawnRoad) TS.luxDrawnRoad = null;
    }
    ensureTiles(0, false);
    void lastS;
    /* test hook: the road carriageways (scene metres, half width) and road lamps of the loaded chunks, to check that no pole stands in a lane */
    const debugRoadFurniture = () => ({
      roads: Array.from(roadsByChunk.values()).flat().map((r) => ({ cls: r.cls, hw: r.hw, bridge: r.bridge === true, oneway: r.oneway === true, pts: r.pts.map((p) => [p.x, p.z]) })),
      lamps: Array.from(lampsByChunk.values()).flat().map((l) => ({ x: l[0], z: l[1] })),
      posts: traffic ? traffic.posts() : [],
    });
    const debugSlot = (s) => { const sl = slotAt(s); if (!sl) return null; const f = frame(s); const L = slotLatL(s); return { kind: sl.kind, s0: sl.s0, s1: sl.s1, y: f.pos.y, HsL: slotShelf(sl, s, -1), HsR: slotShelf(sl, s, 1), L, R: SLOT_IN_R, left: COLLAR_D.map((d) => { const x = f.pos.x + f.right.x * (L - d); const z = f.pos.z + f.right.z * (L - d); return [d, +rawG(x, z).toFixed(1), +collarY(sl, s, -1, d, x, z).toFixed(1)]; }), right: COLLAR_D.map((d) => { const x = f.pos.x + f.right.x * (SLOT_IN_R + d); const z = f.pos.z + f.right.z * (SLOT_IN_R + d); return [d, +rawG(x, z).toFixed(1), +collarY(sl, s, 1, d, x, z).toFixed(1)]; }) }; };
    const paintDistance = (x, z) => { const t = tileOf(x, z); return t && t.ground ? ground.paintDistance(t, x, z) : NaN; };
    return { paintDistance, debugSlot, debugRoadFurniture, update, setTimeOfDay: noop, setWeather: noop, warm, stats, progress, pendingAhead, dispose, root, groundAt: gy, roadHeightAt, ground, meshY, tileOf, tiles, underpasses, far: farTiles, facades: fx };
  }

  TS.luxtramWorld = { create, QUALITY, prefetchData };
})();
