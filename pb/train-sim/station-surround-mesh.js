/* Lokféierer: real surroundings of stations, mesh stage (TS.stationSurroundMesh.build).
 * Builds, for one station patch (see station-surround.js), in world coordinates:
 *   - the painted ground: a decal mesh draped on the terrain (4 m grid, 15 cm above it, soft alpha edge) textured from the OSM / LiDAR class map
 *     (asphalt, paving, lawn, meadow, forest floor, gravel, water; no photograph is read or shipped)
 *   - the LOD2 buildings: the real roof and wall faces with painted facades (windows, plaster / brick / cladding by building type), slate / tile / flat roofs
 *   - trees (LiDAR canopy), water, and small street furniture (benches, bus stops, lamps, bins, bike racks)
 * Nothing here is shared with the Luxtram world (luxtram-*.js): the rail stations have their own small renderer. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;

  const GRID_STEP = 4;
  const GROUND_LIFT = 0.15;
  const TEX_W = 1024;
  const TEX_H = 2048;
  const EDGE_FADE_X = 30;
  const EDGE_FADE_Z = 50;
  const WIDTH_MARGIN = 4;          // the painted ground stays this far inside the terrain strip
  const BUILDING_MARGIN = 7;
  const SKIRT = 1.6;               // wall foundation below the LOD2 ground line
  const BAY = 3.0;                 // facade bay width and floor height of the facade textures (m)
  const WATER_LIFT = 0.02;
  const TREE_SHARE = { high: 1, medium: 0.6, low: 0.3 };
  const WALL_TINTS = [[1, 1, 1], [1, 0.95, 0.86], [0.94, 0.96, 1], [1, 0.9, 0.88], [0.9, 0.95, 0.9], [1, 0.98, 0.92]];   // plaster colours (multiply the facade texture)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
  function hash2(x, y) {
    let h = Math.imul(Math.floor(x) | 0, 374761393) + Math.imul(Math.floor(y) | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x); const yi = Math.floor(y); const xf = x - xi; const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  }
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15;
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------------------------------------------------------------- polygon triangulation (ear clipping) */
  function triangulate2(pts) {
    const n = pts.length;
    if (n < 3) return [];
    let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i]; const b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const idx = []; for (let i = 0; i < n; i++) idx.push(i);
    if (area < 0) idx.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    const out = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 4000) {
      let clipped = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k + idx.length - 1) % idx.length]; const i1 = idx[k]; const i2 = idx[(k + 1) % idx.length];
        const a = pts[i0]; const b = pts[i1]; const c = pts[i2];
        if (cross(a, b, c) <= 1e-9) continue;
        let ear = true;
        for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(pts[j], a, b, c)) { ear = false; break; } }
        if (!ear) continue;
        out.push(i0, i1, i2); idx.splice(k, 1); clipped = true; break;
      }
      if (!clipped) { out.push(idx[0], idx[1], idx[2]); idx.splice(1, 1); }
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    return out;
  }
  /* a planar 3D ring [[x, y, z], ...] -> triangle index list (projected along its dominant normal axis) */
  function triangulate3(ring) {
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const ax = Math.abs(nx); const ay = Math.abs(ny); const az = Math.abs(nz);
    const proj = ay >= ax && ay >= az ? (p) => [p[0], p[2]] : ax >= az ? (p) => [p[1], p[2]] : (p) => [p[0], p[1]];
    const tris = triangulate2(ring.map(proj));
    /* a ring whose projection overlaps itself (a strongly warped LOD2 face, ring order broken) triangulates into spikes / ribbons: the triangles must cover the ring's own area */
    const ringArea = Math.hypot(nx, ny, nz) / 2;
    let triArea = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = ring[tris[t]]; const b = ring[tris[t + 1]]; const c = ring[tris[t + 2]];
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      triArea += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    if (!(ringArea > 1e-4) || !Number.isFinite(triArea) || Math.abs(triArea - ringArea) > 0.35 * ringArea + 0.05) return { tris: [], normal: [nx, ny, nz] };
    return { tris, normal: [nx, ny, nz] };
  }

  /* ---------------------------------------------------------------- buildings without LOD2 faces: footprint extrusion
   * Patches of other countries (data.extrudeFaceless) carry OSM-only footprints and far buildings as ground ring + eave height h + roof type; the walls rise to base + h and the roof is
   * a gable / hip on the footprint's long axis when the footprint is rectangular enough, else flat.  Returns rings of [x, y, z] like the LOD2 faces. */
  function extrudeFootprint(b) {
    const g = b.ground;
    if (!g || g.length < 3) return { walls: [], roofs: [] };
    const y0 = b.base !== undefined ? b.base : 0;
    const h = Math.max(2.2, b.h || 5);
    const walls = [];
    for (let i = 0; i < g.length; i++) {
      const a = g[i]; const c = g[(i + 1) % g.length];
      if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.05) continue;
      walls.push([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y0 + h, c[1]], [a[0], y0 + h, a[1]]]);
    }
    // long axis from the longest edge
    let best = 0; let bl = 0;
    for (let i = 0; i < g.length; i++) { const a = g[i]; const c = g[(i + 1) % g.length]; const l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > bl) { bl = l; best = i; } }
    const a0 = g[best]; const a1 = g[(best + 1) % g.length];
    const dx = (a1[0] - a0[0]) / (bl || 1); const dz = (a1[1] - a0[1]) / (bl || 1);
    let t0 = Infinity; let t1 = -Infinity; let s0 = Infinity; let s1 = -Infinity;
    g.forEach((p) => { const t = p[0] * dx + p[1] * dz; const s = -p[0] * dz + p[1] * dx; t0 = Math.min(t0, t); t1 = Math.max(t1, t); s0 = Math.min(s0, s); s1 = Math.max(s1, s); });
    let area = 0;
    for (let i = 0; i < g.length; i++) { const a = g[i]; const c = g[(i + 1) % g.length]; area += a[0] * c[1] - c[0] * a[1]; }
    area = Math.abs(area) / 2;
    const rectArea = (t1 - t0) * (s1 - s0);
    const wd = s1 - s0;
    const pitched = (b.roof === 'gable' || b.roof === 'hip') && rectArea > 0 && area / rectArea > 0.8 && wd >= 3 && wd <= 16 && (t1 - t0) >= wd * 0.9;
    if (!pitched) return { walls, roofs: [g.map((p) => [p[0], y0 + h, p[1]])] };
    const rise = Math.min(4.5, 0.62 * wd * 0.5 + 0.4);
    const sm = (s0 + s1) / 2;
    const at = (t, s, y) => [t * dx - s * dz, y, t * dz + s * dx];
    const hip = b.roof === 'hip' ? Math.min(wd * 0.5, (t1 - t0) * 0.35) : 0;
    const r0 = at(t0 + hip, sm, y0 + h + rise); const r1 = at(t1 - hip, sm, y0 + h + rise);
    const A = at(t0, s0, y0 + h); const B = at(t1, s0, y0 + h); const C = at(t1, s1, y0 + h); const D = at(t0, s1, y0 + h);
    const roofs = [[A, B, r1, r0], [C, D, r0, r1]];
    if (hip > 0) { roofs.push([D, A, r0], [B, C, r1]); } else {
      // gable ends: triangles, also as wall faces so they take the facade
      walls.push([A, D, r0], [B, C, r1]);
    }
    return { walls, roofs };
  }

  /* ---------------------------------------------------------------- mesh builder with vertex colours */
  class MB {
    constructor(alpha) { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; this.alpha = !!alpha; }
    get count() { return this.p.length / 3; }
    get empty() { return this.i.length === 0; }
    vert(x, y, z, nx, ny, nz, col, u, v, a) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); if (this.alpha) this.c.push(a === undefined ? 1 : a); this.u.push(u, v);
      return this.count - 1;
    }
    /* every triangle is wound counter-clockwise as seen from its normal's side: a DoubleSide material flips the normal of a back face, so a roof whose triangulation came out clockwise
     * was lit from below (black); LOD2 faces carry an arbitrary ring direction */
    fixWinding() {
      const p = this.p; const n = this.n; const ix = this.i;
      for (let t = 0; t + 2 < ix.length; t += 3) {
        const a = ix[t] * 3; const b = ix[t + 1] * 3; const c = ix[t + 2] * 3;
        const ux = p[b] - p[a]; const uy = p[b + 1] - p[a + 1]; const uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a]; const vy = p[c + 1] - p[a + 1]; const vz = p[c + 2] - p[a + 2];
        const gx = uy * vz - uz * vy; const gy = uz * vx - ux * vz; const gz = ux * vy - uy * vx;
        const dot = gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2]);
        if (dot < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
      }
    }
    geometry() {
      this.fixWinding();
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, this.alpha ? 4 : 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      return g;
    }
    box(cx, cy, cz, sx, sy, sz, col, yaw) {
      const hx = sx / 2; const hy = sy / 2; const hz = sz / 2;
      const c = Math.cos(yaw || 0); const s = Math.sin(yaw || 0);
      const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
      const faces = [
        [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 0, -1]], [[hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz], [0, 0, 1]],
        [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [-1, 0, 0]], [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz], [1, 0, 0]],
        [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz], [0, 1, 0]],
      ];
      faces.forEach((f) => {
        const nrm = [f[4][0] * c + f[4][2] * s, f[4][1], -f[4][0] * s + f[4][2] * c];
        const ids = f.slice(0, 4).map((p, k) => { const w = P(p[0], p[1], p[2]); return this.vert(w[0], w[1], w[2], nrm[0], nrm[1], nrm[2], col, k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0); });
        this.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      });
    }
  }

  /* ---------------------------------------------------------------- painted textures */
  const texCache = new Map();
  function canvasTexture(key, w, h, draw, repeat) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    texCache.set(key, t);
    return t;
  }
  const PXM = 128 / BAY;           // facade texture pixels per metre
  function windowAt(c, x, y, w, h, frame, shutter) {
    c.fillStyle = '#d9d6cc'; c.fillRect(x - 0.1 * PXM, y - 0.1 * PXM, w + 0.2 * PXM, h + 0.24 * PXM);        // reveal / sill
    c.fillStyle = frame; c.fillRect(x, y, w, h);
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#a9c3d6'); g.addColorStop(1, '#5d7388');
    c.fillStyle = g; c.fillRect(x + 0.07 * PXM, y + 0.07 * PXM, w - 0.14 * PXM, h * 0.5 - 0.1 * PXM); c.fillRect(x + 0.07 * PXM, y + h * 0.52, w - 0.14 * PXM, h * 0.48 - 0.1 * PXM);
    c.fillStyle = frame; c.fillRect(x + w / 2 - 0.03 * PXM, y, 0.06 * PXM, h);
    if (shutter) { c.fillStyle = shutter; c.fillRect(x - 0.38 * PXM, y, 0.34 * PXM, h); c.fillRect(x + w + 0.04 * PXM, y, 0.34 * PXM, h); }
  }
  const FACADES = {
    houseA: { wall: '#ece1c5', frame: '#f4f1ea', shutter: null, kind: 'house' },
    houseB: { wall: '#f1eee6', frame: '#5a4636', shutter: '#6d7f66', kind: 'house' },
    apart: { wall: '#d9d1c1', frame: '#f2f0ea', shutter: null, kind: 'apart' },
    brick: { wall: '#a9573f', frame: '#f1ede4', shutter: null, kind: 'brick' },
    shop: { wall: '#cfc9bd', frame: '#2f3438', shutter: null, kind: 'shop' },
    industrial: { wall: '#aeb4b8', frame: '#4a5157', shutter: null, kind: 'industrial' },
  };
  function facadeTexture(name) {
    const spec = FACADES[name];
    return canvasTexture('surf:facade:' + name, 128, 128, (c, w, h) => {
      const r = mulberry(hashStr(name));
      c.fillStyle = spec.wall; c.fillRect(0, 0, w, h);
      if (spec.kind === 'brick') {
        for (let y = 0; y < h; y += 8) for (let x = ((y / 8) % 2) * 8; x < w + 8; x += 16) { c.fillStyle = 'rgba(' + (r() > 0.5 ? '255,235,210' : '40,20,10') + ',' + (0.06 + r() * 0.1) + ')'; c.fillRect(x, y, 15, 7); }
        c.fillStyle = 'rgba(210,200,185,0.45)'; for (let y = 0; y < h; y += 8) c.fillRect(0, y + 7, w, 1);
      } else {
        for (let i = 0; i < 480; i++) { c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(60,50,40,0.06)'; c.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
      }
      if (spec.kind === 'industrial') {
        c.fillStyle = 'rgba(40,46,52,0.22)'; for (let y = 0; y < h; y += 10) c.fillRect(0, y, w, 2);
        c.fillStyle = '#39434d'; c.fillRect(8, 40, w - 16, 26); c.fillStyle = 'rgba(150,175,195,0.8)'; c.fillRect(11, 43, w - 22, 20);
        return;
      }
      if (spec.kind === 'shop') {
        c.fillStyle = '#2f3438'; c.fillRect(6, 30, w - 12, 76);
        const g = c.createLinearGradient(0, 30, 0, 106); g.addColorStop(0, '#8aa3b4'); g.addColorStop(1, '#46586a'); c.fillStyle = g; c.fillRect(10, 34, w - 20, 68);
        c.fillStyle = '#2f3438'; c.fillRect(w / 2 - 2, 30, 4, 76);
        return;
      }
      const ww = 1.15 * PXM; const wh = 1.5 * PXM;
      windowAt(c, (w - ww) / 2, h - 0.95 * PXM - wh, ww, wh, spec.frame, spec.shutter);
      if (spec.kind === 'apart') { c.fillStyle = '#b8b3a6'; c.fillRect(0, h - 0.18 * PXM, w, 0.18 * PXM); c.fillStyle = 'rgba(90,90,90,0.5)'; c.fillRect(0, h - 0.18 * PXM - 0.55 * PXM, w, 0.05 * PXM); }
    }, true);
  }
  function roofTexture(kind) {
    return canvasTexture('surf:roof:' + kind, 128, 128, (c, w, h) => {
      const r = mulberry(hashStr(kind));
      const base = { slate: '#80868e', tile: '#b4694c', flat: '#8c8f93', zinc: '#a6adb3' }[kind];
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      if (kind === 'slate' || kind === 'tile') {
        const rows = 12;
        for (let k = 0; k < rows; k++) { const y = (k * h) / rows; for (let x = -(k % 2) * 8; x < w; x += 16) { c.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.05 + r() * 0.09) + ')'; c.fillRect(x, y, 15, h / rows - 1); } c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, y + h / rows - 1.5, w, 1.5); }
      } else { for (let i = 0; i < 900; i++) { c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'; c.fillRect(r() * w, r() * h, 2, 2); } }
    }, true);
  }
  const FACADE_BY_KIND = {
    house: ['houseA', 'houseB', 'houseA'], apartments: ['apart', 'apart', 'houseA'], commercial: ['shop', 'apart'], retail: ['shop'], industrial: ['industrial'],
    garage: ['industrial', 'houseB'], shed: ['industrial'], church: ['houseA'], other: ['houseA', 'apart'],
  };

  /* ground colours (sRGB 0-255) */
  const CLASS_COL = [
    [88, 90, 94],      // 0 asphalt
    [178, 172, 160],   // 1 paving
    [112, 154, 78],    // 2 lawn
    [138, 166, 84],    // 3 meadow / field
    [64, 94, 56],      // 4 forest floor
    [156, 148, 134],   // 5 gravel / bare soil
    [58, 98, 112],     // 6 water
    [140, 136, 128],   // 7 building ground
    [136, 130, 120],   // 8 rail bed (not painted)
  ];
  const CLASS_ALPHA = [1, 1, 1, 1, 1, 1, 1, 0, 0];

  function paintGround(patch, data) {
    const cg = data.classGrid;
    const canvas = document.createElement('canvas'); canvas.width = TEX_W; canvas.height = TEX_H;
    const g = canvas.getContext('2d');
    const img = g.createImageData(TEX_W, TEX_H);
    const px = img.data;
    const sx = (2 * TS.stationSurround.EXT_X) / TEX_W; const sz = (2 * TS.stationSurround.EXT_Z) / TEX_H;
    const x0 = -TS.stationSurround.EXT_X; const z0 = -TS.stationSurround.EXT_Z;
    for (let py = 0; py < TEX_H; py++) {
      const z = z0 + (py + 0.5) * sz;
      for (let pxl = 0; pxl < TEX_W; pxl++) {
        const x = x0 + (pxl + 0.5) * sx;
        // ragged edges: sample the 1 m class map at a jittered position
        const jx = (hash2(pxl, py) - 0.5) * 0.9; const jz = (hash2(py + 17, pxl + 5) - 0.5) * 0.9;
        const cls = TS.stationSurround.classAt(cg, x + jx, z + jz);
        const col = CLASS_COL[cls] || CLASS_COL[2];
        const a = CLASS_ALPHA[cls] === undefined ? 1 : CLASS_ALPHA[cls];
        let k = 0.92 + 0.16 * fbm(x * 0.35, z * 0.35) + 0.07 * (hash2(pxl, py) - 0.5);
        let r = col[0]; let gg = col[1]; let b = col[2];
        if (cls === 1) {                       // paving: slab joints
          const fx = (x / 0.6) - Math.floor(x / 0.6); const fz = (z / 0.6) - Math.floor(z / 0.6);
          if (fx < 0.07 || fz < 0.07) k *= 0.86; else k *= 0.97 + 0.06 * hash2(Math.floor(x / 0.6), Math.floor(z / 0.6));
        } else if (cls === 0) {                // asphalt: patches and wear
          k *= 0.95 + 0.1 * vnoise(x * 0.9, z * 0.9);
        } else if (cls === 2 || cls === 3) {   // grass: tone drift, dry patches
          const dry = smooth01((fbm(x * 0.05 + 11, z * 0.05 - 4) - 0.52) / 0.25);
          r = lerp(r, 168, dry * 0.5); gg = lerp(gg, 160, dry * 0.4); b = lerp(b, 92, dry * 0.4);
          if (cls === 3) { const row = 0.5 + 0.5 * Math.sin((x * 0.9 + z * 0.35) * 2.2); k *= 0.96 + 0.06 * row; }
        } else if (cls === 4) { k *= 0.9 + 0.2 * vnoise(x * 0.6, z * 0.6); }
        const i4 = (py * TEX_W + pxl) * 4;
        px[i4] = clamp(r * k, 0, 255); px[i4 + 1] = clamp(gg * k, 0, 255); px[i4 + 2] = clamp(b * k, 0, 255);
        px[i4 + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
    return tex;
  }

  /* ---------------------------------------------------------------- the build */
  function build(patch, o) {
    const track = o.track;
    const data = patch.data;
    const quality = o.quality || 'medium';
    const EXT_X = o.EXT_X; const EXT_Z = o.EXT_Z;
    const stripW = o.width || 120;
    const capX = Math.min(EXT_X, stripW - WIDTH_MARGIN);
    const group = new T.Group();
    group.name = 'station-surround-' + patch.name;
    const disposables = [];
    const frameCache = new Map();
    const dropN = track.formationDrop || 0.55;
    const frame = (s) => {
      const key = Math.round(s * 4);
      let f = frameCache.get(key);
      if (!f) {
        // beyond either end of the track (a terminus station: the patch reaches 320 m behind the platforms) the frame continues straight along the end tangent instead of collapsing onto the end point
        const sc = clamp(s, 0, track.length); const r = track.frameAt(sc); const tl = Math.hypot(r.tangent.x, r.tangent.z) || 1; const tx = r.tangent.x / tl; const tz = r.tangent.z / tl; const over = s - sc;
        f = { x: r.pos.x + tx * over, y: r.pos.y - dropN, z: r.pos.z + tz * over, rx: r.right.x, rz: r.right.z, tx, tz }; frameCache.set(key, f);
      }
      return f;
    };
    /* patch (x lateral, z along backwards) -> world */
    const world = (x, z) => { const f = frame(patch.sMid - z); return { x: f.x + f.rx * x, z: f.z + f.rz * x, form: f.y }; };
    /* a horizontal normal (nx, nz) of the patch frame -> the world frame (the patch x axis is the track's right vector, its z axis points backwards): lighting needs world normals */
    const rotN = (z, nx, nz) => { const f = frame(patch.sMid - z); return [nx * f.rx - nz * f.tx, nx * f.rz - nz * f.tz]; };
    const stats = { buildings: 0, trees: 0, tris: 0 };
    let treeKey = null;

    /* ---- painted ground (W2c: a patch whose heavy half did not load has no class map: roads and water only) */
    if (data.classGrid) {
      const tex = paintGround(patch, data);
      disposables.push(tex);
      const mb = new MB(true);
      const nx = Math.round((2 * capX) / GRID_STEP); const nz = Math.round((2 * EXT_Z) / GRID_STEP);
      const grid = [];
      for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
        const x = -capX + (ix * 2 * capX) / nx; const z = -EXT_Z + (iz * 2 * EXT_Z) / nz;
        const w = world(x, z);
        const y = track.terrainHeightAt(w.x, w.z) + GROUND_LIFT;
        const a = Math.min(smooth01((capX - Math.abs(x)) / EDGE_FADE_X), smooth01((EXT_Z - Math.abs(z)) / EDGE_FADE_Z));
        grid.push([w.x, y, w.z, a, x, z]);
      }
      const at = (ix, iz) => grid[iz * (nx + 1) + ix];
      for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
        const p = at(ix, iz); const pl = at(Math.max(0, ix - 1), iz); const pr = at(Math.min(nx, ix + 1), iz); const pa = at(ix, Math.max(0, iz - 1)); const pb = at(ix, Math.min(nz, iz + 1));
        const ux = pr[0] - pl[0]; const uy = pr[1] - pl[1]; const uz = pr[2] - pl[2]; const vx = pb[0] - pa[0]; const vy = pb[1] - pa[1]; const vz = pb[2] - pa[2];
        let nxn = uy * vz - uz * vy; let nyn = uz * vx - ux * vz; let nzn = ux * vy - uy * vx;
        const l = Math.hypot(nxn, nyn, nzn) || 1; nxn /= l; nyn /= l; nzn /= l;
        if (nyn < 0) { nxn = -nxn; nyn = -nyn; nzn = -nzn; }
        mb.vert(p[0], p[1], p[2], nxn, nyn, nzn, [1, 1, 1], (p[4] + EXT_X) / (2 * EXT_X), 1 - (p[5] + EXT_Z) / (2 * EXT_Z), p[3]);
      }
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        const i0 = iz * (nx + 1) + ix; const i1 = i0 + 1; const i2 = i0 + nx + 1; const i3 = i2 + 1;
        if (at(ix, iz)[3] <= 0 && at(ix + 1, iz)[3] <= 0 && at(ix, iz + 1)[3] <= 0 && at(ix + 1, iz + 1)[3] <= 0) continue;
        mb.i.push(i0, i2, i1, i1, i2, i3);
      }
      const mat = new T.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
      disposables.push(mat);
      const mesh = new T.Mesh(mb.geometry(), mat);
      mesh.receiveShadow = true; mesh.renderOrder = 1;
      group.add(mesh); disposables.push(mesh.geometry);
      stats.tris += mb.i.length / 3;
    }

    /* ---- buildings */
    {
      const walls = {}; const roofs = {};
      const wallMB = (name) => walls[name] || (walls[name] = new MB());
      const roofMB = (name) => roofs[name] || (roofs[name] = new MB());
      /* the painted LOD2 faces of the station building and of the styled buildings are batched into texture atlases + a few meshes (W2e: 657 single-face meshes -> a handful of draws) */
      const batch = TS.stationBuilding && TS.stationBuilding.newBatch ? TS.stationBuilding.newBatch({ T, group, disposables, stats, MB }) : null;
      /* the station building of a station with a photo model is drawn by the model; a station of the OSM-layout kind (stations-osm.js) has none, so its real (LOD2) station building is drawn here */
      const stationSpec = TS.realStations && TS.realStations.get(patch.name);
      const drawStationBuilding = !!(stationSpec && stationSpec.osm) || !!TS.debugStationLod2;   // TS.debugStationLod2 (scripts/zuch/station_top.mjs): the LOD2 station building next to the photo model, to check its side and position
      /* an OSM platform roof (building=roof / canopy, tagged 'commercial' by the LOD2 pass) lies ON a platform polygon: drawn as a house it is a 250 m long wall of windows along the platform.  The
         stations draw their own canopies (infra.js, the photo models, stations-osm.js), so a building whose centre is inside a platform polygon is not drawn (W2c, 26 Oct 2026). */
      const platformRings = (data.platforms || []).map((pl) => pl.ring).filter((r) => r && r.length > 2);
      const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
      const onPlatform = (b) => { if (!b.ground || b.ground.length < 3 || !platformRings.length) return false; const mx = b.ground.reduce((a, p) => a + p[0], 0) / b.ground.length; const mz = b.ground.reduce((a, p) => a + p[1], 0) / b.ground.length; return platformRings.some((r) => inRing(r, mx, mz)); };
      (data.buildings || []).forEach((b, bi) => {
        if (b.station) {
          /* the real station building from its LOD2 faces, painted from the station's style (station-building.js); without a style the station model draws it */
          const style = TS.stationStyles && TS.stationStyles.get(patch.name);
          if (style && style.useLod2 !== false && TS.stationBuilding) {
            try { TS.stationBuilding.build({ T, b, style, world, rotN, group, disposables, triangulate3, MB, roofTexture, stats, batch }); stats.buildings += 1; } catch (error) { console.warn('[Lokféierer] station building of ' + patch.name + ' failed', error); }
            return;
          }
          if (!drawStationBuilding) return;
        }
        if (onPlatform(b)) return;
        const gx = b.ground && b.ground.length ? b.ground.reduce((s, p) => s + p[0], 0) / b.ground.length : 0;
        if (Math.abs(gx) > stripW - BUILDING_MARGIN) return;
        const sty = TS.stationStyles && TS.stationStyles.get(patch.name);
        if (sty && sty.skipIds && sty.skipIds.includes(b.id)) return;
        if (sty && sty.others && sty.others[b.id] && TS.stationBuilding) {
          /* a building of the station area that the photos show (goods shed, toilet hut ...): painted from its own style entry */
          try { TS.stationBuilding.build({ T, b, style: Object.assign({}, sty.otherBase || {}, sty.others[b.id], { doors: sty.others[b.id].doors || [], extras: sty.others[b.id].extras || null }), world, rotN, group, disposables, triangulate3, MB, roofTexture, stats, batch }); stats.buildings += 1; return; } catch (error) { console.warn('[Lokféierer] station-area building ' + b.id + ' failed', error); }
        }
        const names = FACADE_BY_KIND[b.kind] || FACADE_BY_KIND.other;
        const facade = names[Math.floor(hash2(bi, 5) * names.length) % names.length];
        const roofKind = b.roof === 'flat' ? (b.kind === 'industrial' ? 'zinc' : 'flat') : (hash2(bi, 9) < 0.28 ? 'tile' : 'slate');
        const levels = Math.max(1, b.levels || Math.round((b.h || 6) / 3));
        const baseY = b.base !== undefined ? b.base : 0;
        const tint = 0.9 + 0.2 * hash2(bi, 13);
        const wt = WALL_TINTS[Math.floor(hash2(bi, 21) * WALL_TINTS.length) % WALL_TINTS.length];
        const wmb = wallMB(facade);
        const cx = b.ground.reduce((s, p) => s + p[0], 0) / b.ground.length; const cz = b.ground.reduce((s, p) => s + p[1], 0) / b.ground.length;
        const addFace = (mb, ring, kind) => {
          if (ring.length < 3) return;
          const { tris, normal } = triangulate3(ring);
          if (!tris.length) return;
          let nl = Math.hypot(normal[0], normal[1], normal[2]) || 1; let nxn = normal[0] / nl; let nyn = normal[1] / nl; let nzn = normal[2] / nl;
          // orient: roofs up, walls away from the building centre
          const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length; const mz = ring.reduce((s, p) => s + p[2], 0) / ring.length;
          if (kind === 'roof') { if (nyn < 0) { nxn = -nxn; nyn = -nyn; nzn = -nzn; } } else if (nxn * (mx - cx) + nzn * (mz - cz) < 0) { nxn = -nxn; nyn = -nyn; nzn = -nzn; }
          // texture coordinates
          let hx = 1; let hz = 0;
          if (kind === 'wall') { const l2 = Math.hypot(nzn, nxn) || 1; hx = -nzn / l2; hz = nxn / l2; }
          let pmin = Infinity; let pmax = -Infinity; let ymin = Infinity;
          ring.forEach((p) => { const t = p[0] * hx + p[2] * hz; pmin = Math.min(pmin, t); pmax = Math.max(pmax, t); ymin = Math.min(ymin, p[1]); });
          const width = Math.max(0.5, pmax - pmin);
          const bays = Math.max(1, Math.round(width / BAY));
          const eave = (b.h || levels * 3);
          const floorH = Math.max(2.4, eave / levels);
          const ids = ring.map((p) => {
            const w = world(p[0], p[2]);
            const y = w.form + p[1];
            let u; let v;
            if (kind === 'wall') { u = ((p[0] * hx + p[2] * hz - pmin) / width) * bays; v = (p[1] - baseY) / floorH; } else { u = p[0] / 2.4; v = p[2] / 2.4; }
            const tn = kind === 'roof' ? tint : 1;
            const rn = rotN(p[2], nxn, nzn);
            return mb.vert(w.x, y, w.z, rn[0], nyn, rn[1], kind === 'roof' ? [tn, tn, tn] : wt, u, v);
          });
          for (let t = 0; t < tris.length; t += 3) mb.i.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
        };
        let wallRings = b.walls || []; let roofRings = b.roofs || [];
        if (!wallRings.length && !roofRings.length && data.extrudeFaceless) { const syn = extrudeFootprint(b); wallRings = syn.walls; roofRings = syn.roofs; }
        wallRings.forEach((ring) => addFace(wmb, ring, 'wall'));
        roofRings.forEach((ring) => addFace(roofMB(roofKind), ring, 'roof'));
        // foundation skirt below the LOD2 ground line (the terrain here is not the LiDAR ground to the centimetre)
        const gr = b.ground;
        for (let i = 0; i < gr.length; i++) {
          const a = gr[i]; const c2 = gr[(i + 1) % gr.length];
          const wa = world(a[0], a[1]); const wc = world(c2[0], c2[1]);
          let ex = wc.x - wa.x; let ez = wc.z - wa.z; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
          let nxn = ez; let nzn = -ex;
          const mx = (wa.x + wc.x) / 2; const mz = (wa.z + wc.z) / 2; const wcn = world(cx, cz);
          if (nxn * (mx - wcn.x) + nzn * (mz - wcn.z) < 0) { nxn = -nxn; nzn = -nzn; }
          const y0 = wa.form + baseY - SKIRT; const y1 = wa.form + baseY + 0.05; const y1c = wc.form + baseY + 0.05; const y0c = wc.form + baseY - SKIRT;
          const bays = Math.max(1, Math.round(el / BAY));
          const ids = [wmb.vert(wa.x, y0, wa.z, nxn, 0, nzn, [0.8, 0.8, 0.8], 0, -SKIRT / BAY), wmb.vert(wc.x, y0c, wc.z, nxn, 0, nzn, [0.8, 0.8, 0.8], bays, -SKIRT / BAY),
            wmb.vert(wc.x, y1c, wc.z, nxn, 0, nzn, [0.8, 0.8, 0.8], bays, 0), wmb.vert(wa.x, y1, wa.z, nxn, 0, nzn, [0.8, 0.8, 0.8], 0, 0)];
          wmb.i.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
        }
        stats.buildings += 1;
      });
      if (batch) batch.flush();
      Object.keys(walls).forEach((name) => {
        if (walls[name].empty) return;
        const mat = new T.MeshLambertMaterial({ map: facadeTexture(name), vertexColors: true, side: T.DoubleSide });
        disposables.push(mat);
        const mesh = new T.Mesh(walls[name].geometry(), mat); mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh); disposables.push(mesh.geometry); stats.tris += walls[name].i.length / 3;
      });
      Object.keys(roofs).forEach((name) => {
        if (roofs[name].empty) return;
        const mat = new T.MeshLambertMaterial({ map: roofTexture(name), vertexColors: true, side: T.DoubleSide });
        disposables.push(mat);
        const mesh = new T.Mesh(roofs[name].geometry(), mat); mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh); disposables.push(mesh.geometry); stats.tris += roofs[name].i.length / 3;
      });
    }

    /* ---- road surfaces: asphalt ribbons with edge / centre lines and kerbs on the painted roads; the road over the level crossing joins the deck of infra.js */
    if (TS.stationRoads) {
      try {
        const pc = ((track.crossingRoads && track.crossingRoads.crossings) || []).find((c) => c.patch && c.patchName === patch.name) || null;
        const rec = TS.stationRoads.build({
          data, quality,
          world: (x, z) => world(x, z),
          groundY: (wx, wz) => track.terrainHeightAt(wx, wz) + GROUND_LIFT,
          crossing: pc ? { road: pc.road, roadIndex: pc.roadIndex, used: pc.used, lLo: pc.lLo, lHi: pc.lHi, deckY: pc.formY + 0.05 } : null,
        });
        group.add(rec.group); disposables.push(rec); stats.tris += rec.stats.tris;
      } catch (error) { console.warn('[Lokféierer] station roads of ' + patch.name + ' failed', error); }
    }

    /* ---- the yard of a big station (tracks, platforms, canopies; station-yard.js) */
    {
      const ys = TS.stationStyles && TS.stationStyles.get(patch.name);
      if (ys && ys.yard && TS.stationYard) {
        try { TS.stationYard.build({ patch, data, world, track, group, disposables, MB, triangulate2, triangulate3, stats, style: ys, quality }); } catch (error) { console.warn('[Lokféierer] station yard of ' + patch.name + ' failed', error); }
      }
    }

    /* ---- trees (LiDAR canopy) */
    {
      const share = TREE_SHARE[quality] || 0.6;
      const list = (data.trees || []).filter((t, i) => Math.abs(t[0]) < stripW - 6 && hash2(i, 77) < share);
      if (list.length && o.treeField) {
        /* the pooled, LOD-sorted tree field (tree-field.js) draws them: LiDAR height / crown radius pick the species and the scale */
        const lists = { oak: [], beech: [], spruce: [] }; const meta = o.treeField.meta;
        // boxes of the buildings: a crown must not reach into a roof (the LiDAR canopy of a tree beside a house overlaps the footprint)
        const boxes = (data.buildings || []).map((b) => { let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity; (b.ground || []).forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); return { x0, x1, z0, z1 }; });
        const nearHouse = (x, z, r) => boxes.some((b) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
        list.forEach((t, i) => {
          if (nearHouse(t[0], t[1], Math.min(3.2, t[3] * 0.55))) return;
          const w = world(t[0], t[1]); const y = track.terrainHeightAt(w.x, w.z) - 0.15;
          const h = clamp(t[2], 3, 32); const r = clamp(t[3], 1.2, 9);
          const conifer = t[3] / Math.max(1, t[2]) < 0.26;
          const name = conifer ? 'spruce' : (r / h > 0.36 ? 'oak' : 'beech');
          const sc = r / meta[name].r; const sy = clamp(h / (meta[name].h * sc), 0.6, 1.8);
          const v = hash2(i, 41);
          lists[name].push({ x: w.x, y, z: w.z, rot: hash2(i, 31) * 6.28, sc, sy, tint: { r: 0.9 + v * 0.2, g: 0.92 + v * 0.16, b: 0.88 + v * 0.18 } });
        });
        treeKey = 'surround:' + patch.name;
        o.treeField.add(treeKey, lists); stats.trees += list.length;
      } else if (list.length) {
        const blob = new T.IcosahedronGeometry(1, 1);
        const trunk = new T.CylinderGeometry(0.12, 0.2, 1, 6);
        const broad = mergeTree(blob, trunk, false); const cone = mergeTree(blob, trunk, true);
        const conifers = []; const broads = [];
        list.forEach((t) => { (t[3] / Math.max(1, t[2]) < 0.26 ? conifers : broads).push(t); });
        [[broad, broads, 'broad'], [cone, conifers, 'conifer']].forEach(([geo, items, kind]) => {
          if (!items.length) { geo.dispose(); return; }
          const mat = new T.MeshLambertMaterial({ vertexColors: true });
          disposables.push(mat, geo);
          const im = new T.InstancedMesh(geo, mat, items.length);
          const m = new T.Matrix4(); const q = new T.Quaternion(); const col = new T.Color();
          items.forEach((t, i) => {
            const w = world(t[0], t[1]);
            const y = track.terrainHeightAt(w.x, w.z) - 0.15;
            const h = clamp(t[2], 3, 32); const r = clamp(t[3], 1.2, 9);
            q.setFromAxisAngle(new T.Vector3(0, 1, 0), hash2(i, 31) * 6.28);
            m.compose(new T.Vector3(w.x, y, w.z), q, new T.Vector3(r, h, r));
            im.setMatrixAt(i, m);
            const v = hash2(i, 41);
            col.setRGB(kind === 'conifer' ? 0.55 + v * 0.3 : 0.75 + v * 0.45, kind === 'conifer' ? 0.8 + v * 0.3 : 0.9 + v * 0.3, 0.6 + v * 0.3);
            im.setColorAt(i, col);
          });
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.castShadow = quality !== 'low'; im.receiveShadow = false;
          group.add(im); disposables.push(im); stats.trees += items.length;
        });
      }
    }

    /* ---- water */
    {
      const mb = new MB();
      (data.water || []).forEach((wt) => {
        const ring = (wt.ring || []).filter((p) => Math.abs(p[0]) < stripW - 4);
        if (ring.length < 3) return;
        const tris = triangulate2(ring.map((p) => [p[0], p[1]]));
        const ids = ring.map((p) => { const w = world(p[0], p[1]); return mb.vert(w.x, w.form + wt.y + WATER_LIFT, w.z, 0, 1, 0, [1, 1, 1], p[0] / 8, p[1] / 8); });
        for (let t = 0; t < tris.length; t += 3) mb.i.push(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
      });
      if (!mb.empty) {
        const mat = o.materials.water || new T.MeshLambertMaterial({ color: 0x3c6672, transparent: true, opacity: 0.88, side: T.DoubleSide });
        const mesh = new T.Mesh(mb.geometry(), mat); mesh.renderOrder = 2; mesh.position.y = 0;
        group.add(mesh); disposables.push(mesh.geometry); if (!o.materials.water) disposables.push(mat);
      }
    }

    /* ---- street furniture */
    {
      const mb = new MB();
      const gy = (x, z) => { const w = world(x, z); return { w, y: track.terrainHeightAt(w.x, w.z) }; };
      (data.poi || []).forEach((p) => {
        if (Math.abs(p.x) > stripW - 6) return;
        const { w, y } = gy(p.x, p.z);
        if (p.t === 'bench') { mb.box(w.x, y + 0.45, w.z, 1.6, 0.08, 0.5, [0.45, 0.32, 0.2]); mb.box(w.x, y + 0.75, w.z - 0.2, 1.6, 0.4, 0.06, [0.45, 0.32, 0.2]); }
        else if (p.t === 'lamp') { mb.box(w.x, y + 2.8, w.z, 0.12, 5.6, 0.12, [0.45, 0.47, 0.5]); mb.box(w.x + 0.4, y + 5.6, w.z, 1.0, 0.1, 0.28, [0.4, 0.42, 0.45]); }
        else if (p.t === 'bin') mb.box(w.x, y + 0.5, w.z, 0.45, 1.0, 0.45, [0.2, 0.32, 0.22]);
        else if (p.t === 'bus_stop') { mb.box(w.x, y + 1.3, w.z, 0.1, 2.6, 0.1, [0.85, 0.8, 0.1]); mb.box(w.x, y + 2.35, w.z, 0.5, 0.5, 0.08, [0.1, 0.45, 0.2]); }
        else if (p.t === 'shelter') { mb.box(w.x, y + 1.3, w.z, 3.2, 0.12, 1.6, [0.4, 0.43, 0.46]); [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]].forEach(([dx, dz]) => mb.box(w.x + dx, y + 0.65, w.z + dz, 0.08, 1.3, 0.08, [0.4, 0.43, 0.46])); }
        else if (p.t === 'bike_parking') mb.box(w.x, y + 0.45, w.z, 2.4, 0.9, 0.3, [0.6, 0.62, 0.65]);
        else if (p.t === 'ticket') mb.box(w.x, y + 1.0, w.z, 0.6, 2.0, 0.5, [0.69, 0.16, 0.43]);
      });
      if (!mb.empty) {
        const mat = new T.MeshLambertMaterial({ vertexColors: true });
        disposables.push(mat);
        const mesh = new T.Mesh(mb.geometry(), mat); mesh.castShadow = true;
        group.add(mesh); disposables.push(mesh.geometry);
      }
    }

    return {
      group, stats,
      dispose() {
        if (treeKey && o.treeField) o.treeField.remove(treeKey);
        group.traverse((obj) => { if (obj.isInstancedMesh) obj.dispose(); });
        disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
      },
    };
  }

  /* one low-poly tree (unit height, unit crown radius): trunk + crown (blob or cone stack), vertex-coloured */
  function mergeTree(blob, trunk, conifer) {
    const blobTop = new T.IcosahedronGeometry(1, 0);
    const mb = new MB();
    const add = (geo, sx, sy, sz, ty, col) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.scale(sx, sy, sz); g.translate(0, ty, 0); g.computeVertexNormals();
      const pos = g.attributes.position; const nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) { const id = mb.vert(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), col, 0, 0); mb.i.push(id); }
      g.dispose();
    };
    add(trunk, 0.18, 0.4, 0.18, 0.2, [0.32, 0.22, 0.14]);
    if (conifer) {
      const cone = new T.ConeGeometry(1, 1, 7);
      add(cone, 0.8, 0.5, 0.8, 0.45, [0.14, 0.34, 0.18]); add(cone, 0.6, 0.45, 0.6, 0.72, [0.16, 0.38, 0.2]); add(cone, 0.38, 0.4, 0.38, 0.92, [0.18, 0.42, 0.22]);
      cone.dispose();
    } else {
      add(blob, 1, 0.42, 1, 0.62, [0.26, 0.48, 0.2]); add(blobTop, 0.72, 0.3, 0.72, 0.86, [0.32, 0.55, 0.24]);
    }
    blobTop.dispose();
    return mb.geometry();
  }

  TS.stationSurroundMesh = Object.freeze({ build, triangulate2, triangulate3, MB });
})();
