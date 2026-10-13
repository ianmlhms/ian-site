/* Lokféierer: painted ground of the Luxtram world (TS.luxGround).
 * No photographs.  Ground = a splat shader (8 painted materials, weights from a per-tile class map) plus real geometry on top: asphalt carriageways
 * with proper junctions, sidewalks with 3D kerbs, paths, lane markings, zebra crossings, parking bays, water, rails, bridge decks.
 * Data: data/luxtram/g/<i>_<j>.bin (scripts/build_luxtram_ground.py): class map PNG (0.5 m/px) + AO map + OSM-derived vector layers (cm integers).
 * The module is created by luxtram-world.js (TS.luxGround.create(ctx)) and owns every material of the ground. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const TAG = '[Lokféierer] luxtram ground: ';
  const CLS = 8;
  const N = 256;                // class map resolution (px per tile edge)
  const SHADE_N = 64;
  const ROAD_LIFT = 0.05;       // carriageway above the terrain mesh
  const KERB_H = 0.13;          // sidewalk surface above the carriageway
  const PAVE_LIFT = ROAD_LIFT + KERB_H;
  const PAINT_LIFT = ROAD_LIFT + 0.03;
  const PATH_LIFT = 0.045;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ painted textures (canvas, cached for the session) */
  const texCache = new Map();
  const CELL = 128; const GUT = 8; const CP = CELL + 2 * GUT;       // 144 px per atlas cell: 128 content + 8 px wrapped gutter on every side
  const ATLAS_W = CP * 4; const ATLAS_H = CP * 2;
  // metres per texture repeat of the 8 materials: asphalt, paving, lawn, meadow, forest, gravel, sett, water
  const PERIOD = [5.0, 2.4, 3.2, 4.0, 5.0, 2.6, 1.7, 8.0];

  /* paints one tileable material into a 128 px square; draw(g, ox, oy) draws the pattern with its origin at (ox, oy): called 9 times for the wrap */
  function paintTileable(g, w, paint) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { g.save(); g.translate(dx * w, dy * w); paint(g); g.restore(); }
  }
  const PAINTERS = [
    // 0 asphalt: dark grey, fine stone speckle, patched repairs, hairline cracks
    (g, w, r) => {
      g.fillStyle = '#5b5e62'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.025 + r() * 0.035) + ')'; g.fillRect(r() * w, r() * w, 14 + r() * 40, 10 + r() * 34); }
      for (let i = 0; i < 2600; i++) { const v = 70 + r() * 90; g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',' + (0.1 + r() * 0.18) + ')'; g.fillRect(r() * w, r() * w, 1 + r() * 1.4, 1 + r() * 1.4); }
      g.strokeStyle = 'rgba(30,30,32,0.35)'; g.lineWidth = 0.9;
      for (let i = 0; i < 4; i++) { g.beginPath(); let x = r() * w; let y = r() * w; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 18; y += 6 + r() * 12; g.lineTo(x, y); } g.stroke(); }
    },
    // 1 paving: pale concrete slabs 0.6 m with joints and per-slab tone
    (g, w, r) => {
      const n = 4; const s = w / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 168 + r() * 26; g.fillStyle = 'rgb(' + (v | 0) + ',' + ((v - 1) | 0) + ',' + ((v - 4) | 0) + ')'; g.fillRect(i * s, j * s, s, s); }
      for (let i = 0; i < 2200; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(60,55,45,0.1)'; g.fillRect(r() * w, r() * w, 1.5, 1.5); }
      g.fillStyle = 'rgba(70,66,58,0.55)';
      for (let k = 0; k < n; k++) { g.fillRect(k * s - 0.7, 0, 1.4, w); g.fillRect(0, k * s - 0.7, w, 1.4); }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = 0; k < n; k++) { g.fillRect(k * s + 0.7, 0, 1, w); g.fillRect(0, k * s + 0.7, w, 1); }
    },
    // 2 lawn: mown grass, soft tone drift, blade speckle
    (g, w, r) => {
      g.fillStyle = '#6c9a3a'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '150,190,70' : '60,110,40') + ',' + (0.12 + r() * 0.12) + ')'; g.beginPath(); g.ellipse(r() * w, r() * w, 6 + r() * 20, 5 + r() * 14, r() * 3, 0, 6.3); g.fill(); }
      for (let i = 0; i < 3800; i++) { const t = r(); g.fillStyle = t < 0.4 ? 'rgba(120,170,50,0.5)' : t < 0.75 ? 'rgba(48,96,34,0.5)' : 'rgba(170,200,90,0.45)'; g.fillRect(r() * w, r() * w, 1, 1 + r() * 2.5); }
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(r() * w, r() * w, 1.5, 1.5); }
    },
    // 3 meadow: taller, drier, yellower; stems and seed heads
    (g, w, r) => {
      g.fillStyle = '#8c9a4a'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '176,168,84' : '88,112,48') + ',' + (0.14 + r() * 0.14) + ')'; g.beginPath(); g.ellipse(r() * w, r() * w, 6 + r() * 22, 5 + r() * 16, r() * 3, 0, 6.3); g.fill(); }
      for (let i = 0; i < 2600; i++) { const t = r(); g.strokeStyle = t < 0.4 ? 'rgba(200,190,100,0.55)' : t < 0.75 ? 'rgba(96,126,50,0.55)' : 'rgba(150,150,70,0.5)'; g.lineWidth = 1; const x = r() * w; const y = r() * w; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4); g.stroke(); }
      for (let i = 0; i < 40; i++) { const c = ['#f2f0e0', '#e8d54a', '#d9a0c6'][(r() * 3) | 0]; g.fillStyle = c; g.fillRect(r() * w, r() * w, 1.6, 1.6); }
    },
    // 4 forest floor: leaf litter, moss, twigs
    (g, w, r) => {
      g.fillStyle = '#4a5a2e'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 34; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '96,70,40' : '40,66,34') + ',' + (0.16 + r() * 0.2) + ')'; g.beginPath(); g.ellipse(r() * w, r() * w, 5 + r() * 18, 4 + r() * 12, r() * 3, 0, 6.3); g.fill(); }
      for (let i = 0; i < 1500; i++) { const t = r(); g.fillStyle = t < 0.4 ? 'rgba(124,92,52,0.6)' : t < 0.7 ? 'rgba(80,100,44,0.55)' : 'rgba(30,40,22,0.5)'; g.fillRect(r() * w, r() * w, 1 + r() * 2, 1 + r() * 2); }
      g.strokeStyle = 'rgba(70,52,34,0.7)'; g.lineWidth = 1;
      for (let i = 0; i < 14; i++) { const x = r() * w; const y = r() * w; const a = r() * 6.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (4 + r() * 8), y + Math.sin(a) * (4 + r() * 8)); g.stroke(); }
    },
    // 5 gravel / bare soil
    (g, w, r) => {
      g.fillStyle = '#a3977e'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 22; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '120,100,76' : '200,188,160') + ',' + (0.12 + r() * 0.14) + ')'; g.beginPath(); g.ellipse(r() * w, r() * w, 6 + r() * 20, 5 + r() * 14, r() * 3, 0, 6.3); g.fill(); }
      for (let i = 0; i < 2600; i++) { const v = 110 + r() * 110; g.fillStyle = 'rgba(' + v + ',' + (v - 8) + ',' + (v - 22) + ',' + (0.35 + r() * 0.4) + ')'; const s = 1 + r() * 2.2; g.fillRect(r() * w, r() * w, s, s); }
    },
    // 6 sett: staggered natural-stone cobbles, each its own grey / warm tone
    (g, w, r) => {
      g.fillStyle = '#6c675f'; g.fillRect(0, 0, w, w);
      const n = 12; const s = w / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = i * s + (j % 2 ? s / 2 : 0); const v = 118 + r() * 60;
        g.fillStyle = 'rgb(' + (v | 0) + ',' + ((v - 3 + r() * 6) | 0) + ',' + ((v - 10 + r() * 8) | 0) + ')';
        g.fillRect(x + 1, j * s + 1, s - 2, s - 2);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 1, j * s + 1, s - 2, 1.5);
      }
    },
    // 7 water bed colour (the real water is its own mesh)
    (g, w, r) => {
      g.fillStyle = '#3c6678'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 24; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '120,170,190' : '20,50,64') + ',0.16)'; g.beginPath(); g.ellipse(r() * w, r() * w, 8 + r() * 24, 3 + r() * 6, r() * 3, 0, 6.3); g.fill(); }
    },
  ];
  function groundAtlas(T) {
    const key = 'lg-atlas';
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas');
    c.width = ATLAS_W; c.height = ATLAS_H;
    const g = c.getContext('2d');
    for (let k = 0; k < CLS; k++) {
      const cell = document.createElement('canvas'); cell.width = CELL; cell.height = CELL;
      const cg = cell.getContext('2d');
      const r = mulberry(1000 + k * 77);
      PAINTERS[k](cg, CELL, r);
      const ox = (k % 4) * CP; const oy = Math.floor(k / 4) * CP;
      // content in the middle, wrapped copies in the 8 px gutter
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        g.save(); g.beginPath(); g.rect(ox, oy, CP, CP); g.clip();
        g.drawImage(cell, ox + GUT + dx * CELL, oy + GUT + dy * CELL); g.restore();
      }
    }
    const t = new T.CanvasTexture(c);
    t.flipY = false; t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = 4; t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter; t.needsUpdate = true;
    texCache.set(key, t);
    return t;
  }
  function tileTex(T, key, w, h, paint, opts) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = (opts && opts.clamp) ? T.ClampToEdgeWrapping : T.RepeatWrapping; t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }

  /* ------------------------------------------------------------ geometry accumulator */
  class Acc {
    constructor() { this.p = []; this.n = []; this.m = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    vert(x, y, z, nx, ny, nz, mat, r, g, b) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.m.push(mat); this.c.push(r, g, b); return this.p.length / 3 - 1; }
    mesh(T, mat, order) {
      if (!this.p.length) return null;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('aMat', new T.Float32BufferAttribute(this.m, 1));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.p.length / 3 > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      const m = new T.Mesh(g, mat);
      m.receiveShadow = false; m.castShadow = false;
      if (order !== undefined) m.renderOrder = order;
      return m;
    }
  }


  /* ------------------------------------------------------------ parked cars (low-poly, merged into the tile's surface mesh: no extra draw call)
     The build script lays out every parking area with painted stalls (vec.m kind 5) and lists the stall centres + headings (vec.pk, cm integers + degrees).
     About half of the stalls get a car; which ones is a hash of the stall position, so the picture is the same on every visit and no state is kept. */
  const CAR_PAINT = [
    [0.9, 0.9, 0.9, 22], [0.07, 0.07, 0.08, 22], [0.62, 0.64, 0.66, 17], [0.33, 0.35, 0.38, 17], [0.12, 0.22, 0.46, 6], [0.55, 0.08, 0.08, 5],
    [0.42, 0.36, 0.28, 3], [0.1, 0.3, 0.18, 2], [0.45, 0.58, 0.7, 3], [0.85, 0.6, 0.12, 2],
  ];
  const CAR_PAINT_TOT = CAR_PAINT.reduce((a, c) => a + c[3], 0);
  const CAR_TYPES = [   // L, W, belt (top of the lower body), roof, cabin base (back .. front, fraction of L), cabin top (back .. front), weight
    { L: 4.2, W: 1.78, belt: 0.86, roof: 1.46, cb: [-0.38, 0.15], ct: [-0.31, 0.02], w: 34 },
    { L: 4.7, W: 1.82, belt: 0.88, roof: 1.45, cb: [-0.38, 0.12], ct: [-0.27, -0.02], w: 18 },
    { L: 4.6, W: 1.9, belt: 1.1, roof: 1.72, cb: [-0.42, 0.18], ct: [-0.38, 0.1], w: 24 },
    { L: 4.7, W: 1.83, belt: 0.88, roof: 1.5, cb: [-0.44, 0.12], ct: [-0.42, 0.0], w: 12 },
    { L: 5.3, W: 2.0, belt: 1.05, roof: 2.2, cb: [-0.5, 0.3], ct: [-0.5, 0.24], w: 8 },
  ];
  const CAR_W_TOT = CAR_TYPES.reduce((a, c) => a + c.w, 0);
  const GLASS = [0.1, 0.13, 0.17]; const TYRE = [0.05, 0.05, 0.06]; const HEAD = [0.88, 0.88, 0.8]; const TAIL = [0.62, 0.06, 0.06];
  function hash32(a, b, c) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  /* one parked car: placement (cx, cy, cz), forward direction (fx, fz), plane slopes sp (along) / sr (across); colour pt; AO factor ao */
  function pushCar(S, ty, cx, cy, cz, fx, fz, sp, sr, pt, ao) {
    const L = ty.L; const W = ty.W; const hw = W / 2; const hl = L / 2;
    const rx = -fz; const rz = fx;                 // across (right)
    const P = (lx, y, lz) => [cx + rx * lx + fx * lz, cy + y + sp * lz + sr * lx, cz + rz * lx + fz * lz];
    const N3 = (a, b, c) => { const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2]; let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
    const quad = (a, b, c, d, col, out) => {          // a, b, c, d around the face; out = a point the normal should face away from... (hint vector)
      let n = N3(a, b, c);
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { n = [-n[0], -n[1], -n[2]]; const tmp = b; b = d; d = tmp; }      // keep the winding counter-clockwise seen from outside
      const base = S.count; const k = ao;
      [a, b, c, d].forEach((v) => S.vert(v[0], v[1], v[2], n[0], n[1], n[2], 8, col[0] * k, col[1] * k, col[2] * k));
      S.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const dir = (lx, y, lz) => [rx * lx + fx * lz, y, rz * lx + fz * lz];       // outward hint in world axes
    const y0 = 0.3; const yb = ty.belt; const yr = ty.roof;
    // lower body (hood, flanks, nose, tail)
    const A = [P(-hw, y0, -hl), P(hw, y0, -hl), P(hw, y0, hl), P(-hw, y0, hl)];
    const B = [P(-hw, yb, -hl), P(hw, yb, -hl), P(hw, yb, hl), P(-hw, yb, hl)];
    quad(A[1], A[2], B[2], B[1], pt, dir(1, 0, 0)); quad(A[0], A[3], B[3], B[0], pt, dir(-1, 0, 0));
    quad(A[2], A[3], B[3], B[2], pt, dir(0, 0, 1)); quad(A[0], A[1], B[1], B[0], pt, dir(0, 0, -1));
    quad(B[0], B[1], B[2], B[3], pt, [0, 1, 0]);
    // cabin: glass all round, painted roof
    const cw = hw * 0.92; const tw = hw * 0.8;
    const c0 = ty.cb[0] * L; const c1 = ty.cb[1] * L; const t0 = ty.ct[0] * L; const t1 = ty.ct[1] * L;
    const CB = [P(-cw, yb, c0), P(cw, yb, c0), P(cw, yb, c1), P(-cw, yb, c1)];
    const CT = [P(-tw, yr, t0), P(tw, yr, t0), P(tw, yr, t1), P(-tw, yr, t1)];
    quad(CB[1], CB[2], CT[2], CT[1], GLASS, dir(1, 0, 0)); quad(CB[0], CB[3], CT[3], CT[0], GLASS, dir(-1, 0, 0));
    quad(CB[2], CB[3], CT[3], CT[2], GLASS, dir(0, 0.5, 1)); quad(CB[0], CB[1], CT[1], CT[0], GLASS, dir(0, 0.5, -1));
    quad(CT[0], CT[1], CT[2], CT[3], pt, [0, 1, 0]);
    // wheels (four dark blocks) + lamps
    const wb = L * 0.62; const wr = 0.34; const wx = hw - 0.12; const ww = 0.22;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const lx0 = sx * wx - ww / 2; const lx1 = sx * wx + ww / 2; const lz0 = sz * wb / 2 - wr; const lz1 = sz * wb / 2 + wr;
      const w00 = P(lx0, 0, lz0); const w10 = P(lx1, 0, lz0); const w11 = P(lx1, 0, lz1); const w01 = P(lx0, 0, lz1);
      const t00 = P(lx0, wr * 2, lz0); const t10 = P(lx1, wr * 2, lz0); const t11 = P(lx1, wr * 2, lz1); const t01 = P(lx0, wr * 2, lz1);
      quad(w10, w11, t11, t10, TYRE, dir(sx, 0, 0)); quad(w00, w01, t01, t00, TYRE, dir(sx, 0, 0));
      quad(w00, w10, t10, t00, TYRE, dir(0, 0, -1)); quad(w01, w11, t11, t01, TYRE, dir(0, 0, 1));
    });
    [-1, 1].forEach((sx) => {
      quad(P(sx * hw * 0.78 - 0.17, 0.62, hl + 0.006), P(sx * hw * 0.78 + 0.17, 0.62, hl + 0.006), P(sx * hw * 0.78 + 0.17, 0.74, hl + 0.006), P(sx * hw * 0.78 - 0.17, 0.74, hl + 0.006), HEAD, dir(0, 0, 1));
      quad(P(sx * hw * 0.8 - 0.13, 0.7, -hl - 0.006), P(sx * hw * 0.8 + 0.13, 0.7, -hl - 0.006), P(sx * hw * 0.8 + 0.13, 0.82, -hl - 0.006), P(sx * hw * 0.8 - 0.13, 0.82, -hl - 0.006), TAIL, dir(0, 0, -1));
    });
  }

  /* ------------------------------------------------------------ data parsing */
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function decodePngGray(buf, n) {
    const blob = new Blob([buf], { type: 'image/png' });
    const draw = (img) => {
      const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n).data;
      const out = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) out[i] = d[i * 4];
      if (img.close) { try { img.close(); } catch (e) { /* ignore */ } }
      return out;
    };
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }).then(draw);
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(draw(im)); im.onerror = rej; im.src = URL.createObjectURL(blob); });
  }
  function parseTile(buf) {
    const dv = new DataView(buf);
    if (dv.getUint8(0) !== 0x4c || dv.getUint8(1) !== 0x47) throw new Error('bad ground file');
    const pl = dv.getUint32(4, true); const sl = dv.getUint32(8, true); const jl = dv.getUint32(12, true);
    const png = buf.slice(16, 16 + pl); const shp = buf.slice(16 + pl, 16 + pl + sl);
    const vec = JSON.parse(dec.decode(new Uint8Array(buf, 16 + pl + sl, jl)));
    return Promise.all([decodePngGray(png, N), decodePngGray(shp, SHADE_N)]).then(([cls, shade]) => {
      for (let i = 0; i < cls.length; i++) cls[i] = Math.min(CLS - 1, (cls[i] + 16) >> 5);
      return { cls, shade, vec };
    });
  }

  /* class map -> two RGBA weight textures (classes 0-3 / 4-7), softened by a 3x3 binomial kernel so material borders are not pixel-hard */
  function weightTextures(T, cls, n, o) {
    const w0 = new Uint8Array(n * n * 4); const w1 = new Uint8Array(n * n * 4);
    const acc = new Float32Array(CLS);
    const K = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const soft = !(o && o.hard);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        acc.fill(0);
        if (soft) {
          let k = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = clamp(y + dy, 0, n - 1);
            for (let dx = -1; dx <= 1; dx++) { acc[cls[yy * n + clamp(x + dx, 0, n - 1)]] += K[k++]; }
          }
        } else acc[cls[y * n + x]] = 16;
        const o4 = (y * n + x) * 4;
        for (let c = 0; c < 4; c++) { w0[o4 + c] = Math.round(acc[c] * 15.9375); w1[o4 + c] = Math.round(acc[c + 4] * 15.9375); }
      }
    }
    const mk = (data) => {
      const t = new T.DataTexture(data, n, n, T.RGBAFormat, T.UnsignedByteType);
      t.colorSpace = T.NoColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.generateMipmaps = false;
      t.flipY = false; t.needsUpdate = true;
      return t;
    };
    return [mk(w0), mk(w1)];
  }

  /* ------------------------------------------------------------ the splat shader (Lambert, patched) */
  const SPLAT_CHUNK_VERT_COMMON = 'varying vec2 vTerrUv; varying vec3 vWP; varying float vSlopeY; uniform vec3 uTile;';
  const SPLAT_CHUNK_VERT_BEGIN = 'vTerrUv = vec2(position.x - uTile.x, position.z - uTile.y) / uTile.z; vWP = position; vSlopeY = normal.y;';
  const GLSL_CORE = [
    'float lh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float lvn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), f.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'const float PERIODS[8] = float[8](' + PERIOD.map((v) => v.toFixed(2)).join(',') + ');',
    'const vec3 FARC[8] = vec3[8](vec3(0.33,0.34,0.36), vec3(0.5,0.48,0.44), vec3(0.34,0.52,0.2), vec3(0.45,0.5,0.24), vec3(0.18,0.29,0.14), vec3(0.52,0.47,0.37), vec3(0.42,0.4,0.37), vec3(0.2,0.35,0.42));',
    'vec3 gcell(int ci, vec2 wp, vec2 dx, vec2 dy) {',
    '  float per = PERIODS[ci]; vec2 f = fract(wp / per);',
    '  vec2 org = vec2(float(ci - (ci / 4) * 4), float(ci / 4)) * ' + CP.toFixed(1) + ';',
    '  vec2 uv = (org + ' + GUT.toFixed(1) + ' + f * ' + CELL.toFixed(1) + ') / vec2(' + ATLAS_W.toFixed(1) + ', ' + ATLAS_H.toFixed(1) + ');',
    '  vec2 sc = vec2(' + (CELL / ATLAS_W).toFixed(6) + ', ' + (CELL / ATLAS_H).toFixed(6) + ') / per;',
    '  return textureGrad(uAtlas, uv, dx * sc, dy * sc).rgb;',
    '}',
  ].join('\n');
  const SPLAT_FRAG_COMMON = [
    'varying vec2 vTerrUv; varying vec3 vWP; varying float vSlopeY;',
    'uniform sampler2D uCtrl0; uniform sampler2D uCtrl1; uniform sampler2D uAtlas; uniform float uFar;',
    GLSL_CORE,
    /* the class mix at a (projected) position: planar (x, z) on the flat ground, side projection on steep banks so the texture does not streak */
    'vec3 classMix(vec4 a, vec4 b, vec2 wp, vec2 dx, vec2 dy, float m1, float m2, float m3) {',
    '  vec3 col = vec3(0.0);',
    '  for (int k = 0; k < 8; k++) {',
    '    float w = k < 4 ? (k == 0 ? a.x : k == 1 ? a.y : k == 2 ? a.z : a.w) : (k == 4 ? b.x : k == 5 ? b.y : k == 6 ? b.z : b.w);',
    '    if (w < 0.004) continue;',
    '    vec3 c = uFar > 0.5 ? FARC[k] * (0.9 + 0.2 * m3) : gcell(k, wp, dx, dy);',
    '    if (k == 2) c *= mix(vec3(1.0), vec3(1.1, 1.05, 0.74), m1) * (0.92 + 0.16 * m2);',
    '    else if (k == 3) c *= mix(vec3(0.95, 0.95, 0.9), vec3(1.12, 1.04, 0.72), m1) * (0.9 + 0.2 * m2);',
    '    else if (k == 4) c *= 0.82 + 0.3 * m2;',
    '    else if (k == 0) c *= 0.9 + 0.16 * m2;',
    '    else c *= 0.92 + 0.14 * m2;',
    '    col += c * w;',
    '  }',
    '  return col;',
    '}',
    'vec3 groundAlbedo() {',
    '  vec4 a = texture2D(uCtrl0, vTerrUv); vec4 b = texture2D(uCtrl1, vTerrUv);',
    '  float tot = dot(a, vec4(1.0)) + dot(b, vec4(1.0)); a /= tot; b /= tot;',
    '  vec2 wp = vWP.xz; vec2 dx = dFdx(wp); vec2 dy = dFdy(wp);',
    '  float m1 = lvn(wp * 0.035); float m2 = lvn(wp * 0.21); float m3 = lvn(wp * 1.3);',
    '  vec3 col = classMix(a, b, wp, dx, dy, m1, m2, m3);',
    '  float steep = 1.0 - smoothstep(0.55, 0.9, vSlopeY);',
    '  if (steep > 0.01) {',
    '    vec2 sw = vec2(vWP.x + vWP.z, vWP.y * 1.25); vec2 sdx = dFdx(sw); vec2 sdy = dFdy(sw);',
    '    float hard = a.x + a.y + b.z;',                      // asphalt / paving / setts above a drop = a retaining wall: pale concrete with form-work joints
    '    vec3 bank = classMix(a, b, sw, sdx, sdy, m1, m2, m3) * 0.9;',
    '    vec3 wall = vec3(0.56, 0.55, 0.52) * (0.9 + 0.2 * lvn(vec2(sw.x * 0.5, vWP.y * 2.0))) * (0.94 + 0.06 * step(0.5, fract(sw.x * 0.25)));',
    '    col = mix(col, mix(bank, wall, clamp(hard * 1.4, 0.0, 1.0)), steep);',
    '  }',
    '  return col;',
    '}',
  ].join('\n');
  function patchSplat(mat, uniforms) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SPLAT_CHUNK_VERT_COMMON)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SPLAT_CHUNK_VERT_BEGIN);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + SPLAT_FRAG_COMMON)
        .replace('#include <map_fragment>', 'diffuseColor.rgb *= groundAlbedo();');
    };
    mat.customProgramCacheKey = () => 'lt-splat-v2';
    return mat;
  }

  /* ------------------------------------------------------------ factory */
  function create(ctx) {
    const T = ctx.T;
    const quality = ctx.quality;
    const atlas = groundAtlas(T);
    const disposables = [];
    const own = (o) => { disposables.push(o); return o; };

    /* ---- the water (own material: normal-mapped, animated) and the ONE surface material of everything that lies on the terrain:
       asphalt, paving, kerbs, paint, gravel, setts, ballast, rails and bridge decks are merged per tile into one mesh; the material of a vertex is
       the attribute aMat (0..7 = atlas cell, 8 = flat vertex colour), painted procedurally like the terrain (no photographs). */
    const MAT = { ASPH: 0, PAVE: 1, LAWN: 2, MEADOW: 3, FOREST: 4, GRAVEL: 5, SETT: 6, FLAT: 8 };
    const matSurface = own(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    matSurface.onBeforeCompile = (sh) => {
      sh.uniforms.uAtlas = { value: atlas };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aMat; varying float vMat; varying vec3 vWP; varying float vNy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vWP = position; vNy = normal.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMat; varying vec3 vWP; varying float vNy; uniform sampler2D uAtlas;\n' + GLSL_CORE)
        .replace('#include <map_fragment>', 'vec2 swp = mix(vWP.xz, vec2(vWP.x + vWP.z, vWP.y * 1.25), smoothstep(0.78, 0.6, vNy)); vec2 sdx = dFdx(swp); vec2 sdy = dFdy(swp);   /* steep slope: side projection (no streaks)\n*/ if (vMat < 7.5) { diffuseColor.rgb *= gcell(int(vMat + 0.5), swp, sdx, sdy) * (0.94 + 0.12 * lvn(swp * 0.4)); }');
    };
    matSurface.customProgramCacheKey = () => 'lt-surface-v2';
    const waterNormal = tileTex(T, 'lg-water-n', 128, 128, (g, w, h) => {
      const hgt = new Float32Array(w * h); const r = mulberry(3);
      const waves = []; for (let k = 0; k < 9; k++) waves.push([Math.floor(r() * 4) + 1, Math.floor(r() * 4) + 1, r() * 6.28, 0.5 + r()]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; waves.forEach((wv) => { v += Math.sin((x / w * wv[0] + y / h * wv[1]) * 6.2832 + wv[2]) * wv[3]; }); hgt[y * w + x] = v; }
      const id = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dxv = hgt[y * w + (x + 1) % w] - hgt[y * w + (x + w - 1) % w]; const dyv = hgt[((y + 1) % h) * w + x] - hgt[((y + h - 1) % h) * w + x];
        const nx = -dxv * 0.5; const ny = -dyv * 0.5; const nz = 1; const l = Math.hypot(nx, ny, nz);
        const o = (y * w + x) * 4; id.data[o] = (nx / l * 0.5 + 0.5) * 255; id.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; id.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; id.data[o + 3] = 255;
      }
      g.putImageData(id, 0, 0);
    });
    waterNormal.colorSpace = T.NoColorSpace;
    const matWater = own(new T.MeshPhongMaterial({ color: 0x2f5f70, specular: 0x9db7c4, shininess: 70, normalMap: waterNormal, normalScale: new T.Vector2(0.35, 0.35), transparent: true, opacity: 0.93, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));

    /* ---- terrain / far ground materials (one instance per tile, one shared program) */
    const dummy1 = (() => { const t = new T.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, T.RGBAFormat, T.UnsignedByteType); t.needsUpdate = true; return t; })();
    function terrainMaterial(tileX, tileZ, size, ctrl, far) {
      const uniforms = {
        uCtrl0: { value: ctrl ? ctrl[0] : dummy1 }, uCtrl1: { value: ctrl ? ctrl[1] : dummy1 }, uAtlas: { value: atlas },
        uTile: { value: new T.Vector3(tileX, tileZ, size) }, uFar: { value: far ? 1 : 0 },
      };
      const m = new T.MeshLambertMaterial({ side: T.DoubleSide, color: 0xffffff });
      if (far) { m.polygonOffset = true; m.polygonOffsetFactor = 3; m.polygonOffsetUnits = 3; }
      patchSplat(m, uniforms);
      m.userData.splat = uniforms;
      return m;
    }

    /* ---- helpers on the host world's height / normal functions */
    const surfY = ctx.surfY;           // (t, x, z) -> y of the rendered terrain mesh (falls back to the LiDAR height)
    const normalAt = ctx.normalAt;     // (t, x, z) -> [nx, ny, nz]
    const shadeAt = (t, x, z) => {
      const sh = t.ground && t.ground.shade; if (!sh) return 1;
      const u = clamp((x - t.x0) / 128 * SHADE_N - 0.5, 0, SHADE_N - 1.001); const v = clamp((z - t.z0) / 128 * SHADE_N - 0.5, 0, SHADE_N - 1.001);
      const iu = Math.floor(u); const iv = Math.floor(v); const fu = u - iu; const fv = v - iv;
      const a = sh[iv * SHADE_N + iu]; const b = sh[iv * SHADE_N + iu + 1]; const c = sh[(iv + 1) * SHADE_N + iu]; const d = sh[(iv + 1) * SHADE_N + iu + 1];
      return lerp(lerp(a, b, fu), lerp(c, d, fu), fv) / 255;
    };

    /* polygon (outer ring + holes, scene metres) draped on the terrain: densified edges, ear-clipped, normals from the terrain */
    const V2 = T.Vector2;
    /* Longest-edge bisection of every triangle until all edges are <= maxEdge (T-junctions are harmless: the class-map asphalt shows below).  Ear clipping
       alone produces long thin triangles whose interior would not follow the terrain; bisection keeps the count ~ length / maxEdge for slivers. */
    function refineTris(verts, tris, maxEdge) {
      const V = verts.slice(); const out = [];
      const m2 = maxEdge * maxEdge;
      const stack = tris.slice();
      let guard = 0;
      while (stack.length && guard++ < 60000) {
        const tr = stack.pop();
        const a = tr[0]; const b = tr[1]; const c = tr[2];
        const d2 = (i, j) => (V[i][0] - V[j][0]) * (V[i][0] - V[j][0]) + (V[i][1] - V[j][1]) * (V[i][1] - V[j][1]);
        const dab = d2(a, b); const dbc = d2(b, c); const dca = d2(c, a);
        const mx = Math.max(dab, dbc, dca);
        if (mx <= m2) { out.push(tr); continue; }
        let p; let q; let r;          // split edge p-q, r opposite
        if (mx === dab) { p = a; q = b; r = c; } else if (mx === dbc) { p = b; q = c; r = a; } else { p = c; q = a; r = b; }
        const m = V.length; V.push([(V[p][0] + V[q][0]) / 2, (V[p][1] + V[q][1]) / 2]);
        stack.push([p, m, r], [m, q, r]);
      }
      return { V, Tr: out };
    }
    function drapePoly(t, acc, rings, lift, col, mat, o) {
      const maxSeg = (o && o.maxSeg) || 3.2;
      const contour = rings[0].map((p) => new V2(p[0], p[1]));
      const holes = [];
      for (let h = 1; h < rings.length; h++) holes.push(rings[h].map((p) => new V2(p[0], p[1])));
      let tris;
      try { tris = T.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
      const all = contour.concat(...holes);
      const ref = refineTris(all.map((v) => [v.x, v.y]), tris, maxSeg);
      const base = acc.count;
      const V = ref.V; const nv = V.length;
      const yv = new Float32Array(nv);
      for (let i = 0; i < nv; i++) yv[i] = surfY(t, V[i][0], V[i][1]);
      // never below the terrain: where the terrain rises above a triangle's plane (at its centroid / edge midpoints) the triangle's corners are raised
      const raise = new Float32Array(nv);
      for (let q = 0; q < ref.Tr.length; q++) {
        const a = ref.Tr[q][0]; const b = ref.Tr[q][1]; const c = ref.Tr[q][2];
        const pts = [[(V[a][0] + V[b][0] + V[c][0]) / 3, (V[a][1] + V[b][1] + V[c][1]) / 3, (yv[a] + yv[b] + yv[c]) / 3],
          [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (yv[a] + yv[b]) / 2], [(V[b][0] + V[c][0]) / 2, (V[b][1] + V[c][1]) / 2, (yv[b] + yv[c]) / 2],
          [(V[c][0] + V[a][0]) / 2, (V[c][1] + V[a][1]) / 2, (yv[c] + yv[a]) / 2]];
        let e = 0;
        for (let k = 0; k < 4; k++) { const d = surfY(t, pts[k][0], pts[k][1]) - pts[k][2]; if (d > e) e = d; }
        if (e > 0.01) { if (e > raise[a]) raise[a] = e; if (e > raise[b]) raise[b] = e; if (e > raise[c]) raise[c] = e; }
      }
      for (let i = 0; i < nv; i++) {
        const x = V[i][0]; const z = V[i][1];
        const nn = normalAt(t, x, z);
        const s = shadeAt(t, x, z);
        acc.vert(x, yv[i] + Math.min(raise[i], 0.35) + lift, z, nn[0], nn[1], nn[2], mat, col[0] * s, col[1] * s, col[2] * s);
      }
      const P = acc.p;
      for (let i = 0; i < ref.Tr.length; i++) {
        const a = base + ref.Tr[i][0]; const b = base + ref.Tr[i][1]; const c = base + ref.Tr[i][2];
        const e1x = P[b * 3] - P[a * 3]; const e1z = P[b * 3 + 2] - P[a * 3 + 2]; const e2x = P[c * 3] - P[a * 3]; const e2z = P[c * 3 + 2] - P[a * 3 + 2];
        if (o && o.cullSteep) {       // pavement / path polygons do not climb cuttings and banks (the earth of the splat shows there instead of paving streaked over a 60 degree slope)
          const e1y = P[b * 3 + 1] - P[a * 3 + 1]; const e2y = P[c * 3 + 1] - P[a * 3 + 1];
          const nx = e1y * e2z - e1z * e2y; const ny = e1z * e2x - e1x * e2z; const nz = e1x * e2y - e1y * e2x;
          if (Math.abs(ny) < 0.85 * Math.hypot(nx, ny, nz)) continue;
        }
        if (e1z * e2x - e1x * e2z >= 0) acc.i.push(a, b, c); else acc.i.push(a, c, b);
      }
    }
    /* ribbon along a polyline (scene metres, [x, z] pairs) draped on the terrain */
    function drapeRibbon(t, acc, pts, halfW, lift, col, mat, o) {
      const dens = [];
      const step = (o && o.step) || 2.5;
      for (let i = 0; i < pts.length; i++) {
        dens.push(pts[i]);
        if (i + 1 < pts.length) {
          const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); const k = Math.floor(l / step);
          for (let s = 1; s <= k; s++) dens.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / (k + 1), pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / (k + 1)]);
        }
      }
      if (dens.length < 2) return;
      const base = acc.count;
      for (let i = 0; i < dens.length; i++) {
        const a = dens[Math.max(0, i - 1)]; const b = dens[Math.min(dens.length - 1, i + 1)];
        let dx = b[0] - a[0]; let dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        const nx = -dz; const nz = dx;
        const xl = dens[i][0] - nx * halfW; const zl = dens[i][1] - nz * halfW; const xr = dens[i][0] + nx * halfW; const zr = dens[i][1] + nz * halfW;
        const yl = surfY(t, xl, zl) + lift; const yr = surfY(t, xr, zr) + lift;
        const nn = normalAt(t, dens[i][0], dens[i][1]);
        const s = shadeAt(t, dens[i][0], dens[i][1]);
        acc.vert(xl, yl, zl, nn[0], nn[1], nn[2], mat, col[0] * s, col[1] * s, col[2] * s);
        acc.vert(xr, yr, zr, nn[0], nn[1], nn[2], mat, col[0] * s, col[1] * s, col[2] * s);
      }
      for (let i = 0; i < dens.length - 1; i++) { const a = base + i * 2; acc.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    function drapeQuad(t, acc, q, lift, col, mat) {
      const base = acc.count;
      const cx = (q[0] + q[2] + q[4] + q[6]) / 4; const cz = (q[1] + q[3] + q[5] + q[7]) / 4;
      const nn = normalAt(t, cx, cz);
      const s = shadeAt(t, cx, cz);
      for (let k = 0; k < 4; k++) {
        const x = q[k * 2]; const z = q[k * 2 + 1];
        acc.vert(x, surfY(t, x, z) + lift, z, nn[0], nn[1], nn[2], mat, col[0] * s, col[1] * s, col[2] * s);
      }
      acc.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const KERB_COL = [0.74, 0.73, 0.7];
    const KERB_FACE = [0.62, 0.61, 0.58];
    const WHITE = [0.95, 0.95, 0.92];
    const BAY = [0.88, 0.88, 0.85];
    const ringsToScene = (rings, x0, z0) => rings.map((flat) => { const r = []; for (let i = 0; i + 1 < flat.length; i += 2) r.push([x0 + flat[i] / 100, z0 + flat[i + 1] / 100]); return r; });

    /* ---- tile decoration: everything that sits on the terrain mesh (needs the tile's final LOD, i.e. stride 1); one merged mesh per tile (+ water) */
    function decorate(t, group) {
      const vec = t.ground && t.ground.vec;
      if (!vec) return null;
      const tStart = (window.__lgDebug && performance.now()) || 0;
      const x0 = t.x0; const z0 = t.z0;
      const S = new Acc();
      const grp = new T.Group(); grp.name = 'lg-decor-' + t.key;
      const aT = t.coarse ? 0.07 : 0;            // 4 m terrain nodes: lift a little more
      const L_ASPH = ROAD_LIFT + aT; const L_PAINT = ROAD_LIFT + aT + 0.035; const L_PAVE = PAVE_LIFT + aT;
      const dbg = {}; const mark = (k, a) => { dbg[k] = (S.i.length - a) / 3; return S.i.length; };
      let iMark = S.i.length;
      const iA0 = S.i.length;
      (vec.a || []).forEach((poly) => drapePoly(t, S, ringsToScene(poly, x0, z0), L_ASPH, [1, 1, 1], MAT.ASPH, { maxSeg: 5.0 }));
      const roadGrid = rasterRoad(t, S, iA0, S.i.length);
      iMark = mark('asph', iMark);
      (vec.s || []).forEach((poly) => drapePoly(t, S, ringsToScene(poly, x0, z0), L_PAVE, [1, 1, 1], MAT.PAVE, { maxSeg: 3.5, cullSteep: true }));
      iMark = mark('side', iMark);
      (vec.p || []).forEach((poly) => {
        const code = poly[0]; const rings = ringsToScene(poly.slice(1), x0, z0);
        const mat = code === 1 ? MAT.GRAVEL : code === 2 ? MAT.SETT : code === 3 ? MAT.ASPH : MAT.PAVE;
        const col = code === 1 ? [0.95, 0.9, 0.8] : code === 3 ? [1, 1, 1.02] : code === 4 ? [0.82, 0.8, 0.76] : [1, 1, 1];
        drapePoly(t, S, rings, PATH_LIFT + aT, col, mat, { maxSeg: 3.2, cullSteep: code !== 3 });
      });
      iMark = mark('paths', iMark);
      // kerbs: a 3D stone edge between the carriageway and the sidewalk (the data lists them with the sidewalk on the left of the direction of travel)
      (vec.k || []).forEach((flat) => {
        const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push([x0 + flat[i] / 100, z0 + flat[i + 1] / 100]);
        const dens = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); const k = Math.max(1, Math.ceil(l / 3));
          for (let s = 0; s < k; s++) dens.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / k]);
        }
        dens.push(pts[pts.length - 1]);
        if (dens.length < 2) return;
        const base = S.count;
        for (let i = 0; i < dens.length; i++) {
          const a = dens[Math.max(0, i - 1)]; const b = dens[Math.min(dens.length - 1, i + 1)];
          let dx = b[0] - a[0]; let dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
          const lx = dz; const lz = -dx;        // normal pointing to the carriageway (right of travel = away from the sidewalk)
          const x = dens[i][0]; const z = dens[i][1];
          const y = surfY(t, x, z);
          const s = shadeAt(t, x, z);
          // vertical face: road level -> sidewalk level, facing the road
          S.vert(x, y + L_ASPH - 0.02, z, lx, 0, lz, MAT.FLAT, KERB_FACE[0] * s, KERB_FACE[1] * s, KERB_FACE[2] * s);
          S.vert(x, y + L_PAVE, z, lx, 0, lz, MAT.FLAT, KERB_FACE[0] * s, KERB_FACE[1] * s, KERB_FACE[2] * s);
          // top edge stone, 0.14 m wide towards the sidewalk
          S.vert(x - lx * 0.14, y + L_PAVE + 0.004, z - lz * 0.14, 0, 1, 0, MAT.FLAT, KERB_COL[0] * s, KERB_COL[1] * s, KERB_COL[2] * s);
        }
        for (let i = 0; i < dens.length - 1; i++) {
          const a = base + i * 3; const b = a + 3;
          S.i.push(a, b, b + 1, a, b + 1, a + 1);     // face
          S.i.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);   // top
        }
      });
      iMark = mark('kerb', iMark);
      // paint: dashes, solid lines, zebra, bays
      (vec.m || []).forEach((m) => {
        const kind = m[0]; const wcm = m[1]; const pts = [];
        for (let i = 2; i + 1 < m.length; i += 2) pts.push([x0 + m[i] / 100, z0 + m[i + 1] / 100]);
        if (pts.length >= 2) drapeRibbon(t, S, pts, wcm / 200, L_PAINT, kind === 5 ? BAY : WHITE, MAT.FLAT, { step: 3 });
      });
      (quality === 'low' ? [] : (vec.d || [])).forEach((d) => {
        const wcm = d[1];
        for (let i = 2; i + 3 < d.length; i += 4) {
          const ax = x0 + d[i] / 100; const az = z0 + d[i + 1] / 100; const bx = x0 + d[i + 2] / 100; const bz = z0 + d[i + 3] / 100;
          const dx = bx - ax; const dz = bz - az; const dl = Math.hypot(dx, dz) || 1; const nx = -dz / dl * wcm / 200; const nz = dx / dl * wcm / 200;
          drapeQuad(t, S, [ax - nx, az - nz, ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz], L_PAINT, WHITE, MAT.FLAT);
        }
      });
      const q = vec.q || [];
      for (let i = 0; i + 7 < q.length; i += 8) {
        drapeQuad(t, S, [x0 + q[i] / 100, z0 + q[i + 1] / 100, x0 + q[i + 2] / 100, z0 + q[i + 3] / 100, x0 + q[i + 4] / 100, z0 + q[i + 5] / 100, x0 + q[i + 6] / 100, z0 + q[i + 7] / 100], L_PAINT, WHITE, MAT.FLAT);
      }
      iMark = mark('paint', iMark);
      // railway beds (CFL lines): ballast ribbon, sleepers, two steel rails
      (vec.r || []).forEach((flat) => {
        const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push([x0 + flat[i] / 100, z0 + flat[i + 1] / 100]);
        if (pts.length < 2) return;
        drapeRibbon(t, S, pts, 1.6, 0.1 + aT, [0.62, 0.6, 0.57], MAT.GRAVEL, { step: 3 });
        // sleepers every 1.3 m (a coarse rhythm: the real 0.6 m would triple the triangles of the big yards)
        let acc = 0.3;
        for (let i = 0; i + 1 < pts.length; i++) {
          const ax = pts[i][0]; const az = pts[i][1]; const bx = pts[i + 1][0]; const bz = pts[i + 1][1];
          const dx = bx - ax; const dz = bz - az; const dl = Math.hypot(dx, dz); if (dl < 1e-3) continue;
          const ux = dx / dl; const uz = dz / dl; const nx = -uz; const nz = ux;
          for (; acc < dl; acc += quality === 'low' ? 1e9 : 1.3) {
            const cx = ax + ux * acc; const cz = az + uz * acc;
            drapeQuad(t, S, [cx - ux * 0.16 - nx * 1.3, cz - uz * 0.16 - nz * 1.3, cx - ux * 0.16 + nx * 1.3, cz - uz * 0.16 + nz * 1.3, cx + ux * 0.16 + nx * 1.3, cz + uz * 0.16 + nz * 1.3, cx + ux * 0.16 - nx * 1.3, cz + uz * 0.16 - nz * 1.3], 0.14 + aT, [0.36, 0.31, 0.28], MAT.FLAT);
          }
          acc -= dl;
        }
        [-0.7175, 0.7175].forEach((off) => {
          const side = pts.map((p, k) => { const a = pts[Math.max(0, k - 1)]; const b = pts[Math.min(pts.length - 1, k + 1)]; const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [p[0] + (-(b[1] - a[1]) / dl) * off, p[1] + ((b[0] - a[0]) / dl) * off]; });
          drapeRibbon(t, S, side, 0.04, 0.2 + aT, [0.55, 0.55, 0.57], MAT.FLAT, { step: 3 });
        });
      });
      iMark = mark('rail', iMark);
      decorateDecks(t, S);
      // parked cars on the painted stalls (vec.pk: x, z in cm from the tile corner, heading in degrees)
      const pk = vec.pk;
      if (pk && pk.length) {
        const occK = quality === 'low' ? 0.5 : 1;
        for (let i = 0; i + 2 < pk.length; i += 3) {
          const sx = pk[i]; const sz = pk[i + 1]; const sa = pk[i + 2];
          const lot = hash32(Math.floor(sx / 3000) + 77, Math.floor(sz / 3000) - 31, 5);          // ~30 m clusters: some lots fuller than others
          if (hash32(sx, sz, 11) > (0.38 + 0.34 * lot) * occK) continue;
          let ty = hash32(sx, sz, 23) * CAR_W_TOT; let k = 0;
          while (k < CAR_TYPES.length - 1 && ty > CAR_TYPES[k].w) { ty -= CAR_TYPES[k].w; k++; }
          let pc = hash32(sx, sz, 31) * CAR_PAINT_TOT; let q = 0;
          while (q < CAR_PAINT.length - 1 && pc > CAR_PAINT[q][3]) { pc -= CAR_PAINT[q][3]; q++; }
          const ang = (sa + (hash32(sx, sz, 41) < 0.5 ? 180 : 0) + (hash32(sx, sz, 43) - 0.5) * 5) * Math.PI / 180;
          const fx = Math.cos(ang); const fz = Math.sin(ang);
          const cx = x0 + sx / 100 + (hash32(sx, sz, 47) - 0.5) * 0.22 - fz * 0.0; const cz = z0 + sz / 100 + (hash32(sx, sz, 53) - 0.5) * 0.22;
          const ty0 = CAR_TYPES[k];
          const hwb = ty0.L * 0.31;
          const yF = surfY(t, cx + fx * hwb, cz + fz * hwb); const yR = surfY(t, cx - fx * hwb, cz - fz * hwb);
          const yL = surfY(t, cx - fz * 0.8, cz + fx * 0.8); const yRt = surfY(t, cx + fz * 0.8, cz - fx * 0.8);
          const sp = clamp((yF - yR) / (2 * hwb), -0.15, 0.15); const sr = clamp((yL - yRt) / 1.6, -0.15, 0.15);
          const cy = (yF + yR + yL + yRt) / 4 + aT;
          const ao = shadeAt(t, cx, cz);
          pushCar(S, ty0, cx, cy, cz, fx, fz, sp, sr, CAR_PAINT[q], ao);
        }
      }
      const m = S.mesh(T, matSurface, 0);
      if (m) grp.add(m);
      if (window.__lgDebug) console.log('lg tile', t.key, 'verts', S.count, 'tris', S.i.length / 3, 'ms', (performance.now() - tStart).toFixed(1), JSON.stringify(dbg));
      const wl = decorateWater(t, grp);
      group.add(grp);
      return { group: grp, water: wl, roadGrid };
    }

    /* The drawn carriageway rasterised into a 0.5 m height grid (cell centres), so roadHeightAt returns exactly the Y of the triangles that are on screen
       (the polygons are interpolated between their boundary vertices and differ from the terrain mesh by a few cm to dm). */
    const RG = 256; const RG_CELL = 128 / RG;
    function rasterRoad(t, acc, i0, i1) {
      if (i1 <= i0) return null;
      const grid = new Float32Array(RG * RG).fill(NaN);
      const P = acc.p; const I = acc.i;
      for (let k = i0; k + 2 < i1; k += 3) {
        const a = I[k] * 3; const b = I[k + 1] * 3; const c = I[k + 2] * 3;
        const ax = P[a] - t.x0; const az = P[a + 2] - t.z0; const bx = P[b] - t.x0; const bz = P[b + 2] - t.z0; const cx = P[c] - t.x0; const cz = P[c + 2] - t.z0;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) continue;
        const ya = P[a + 1]; const yb = P[b + 1]; const yc = P[c + 1];
        const gx0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / RG_CELL - 0.5)); const gx1 = Math.min(RG - 1, Math.ceil(Math.max(ax, bx, cx) / RG_CELL - 0.5));
        const gz0 = Math.max(0, Math.floor(Math.min(az, bz, cz) / RG_CELL - 0.5)); const gz1 = Math.min(RG - 1, Math.ceil(Math.max(az, bz, cz) / RG_CELL - 0.5));
        for (let gz = gz0; gz <= gz1; gz++) {
          const pz = (gz + 0.5) * RG_CELL;
          for (let gx = gx0; gx <= gx1; gx++) {
            const px = (gx + 0.5) * RG_CELL;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
            const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
            const l3 = 1 - l1 - l2;
            if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
            grid[gz * RG + gx] = l1 * ya + l2 * yb + l3 * yc;
          }
        }
      }
      return grid;
    }
    /* Y of the drawn carriageway at (x, z) (scene metres) in tile t, or NaN when the tile is not decorated / has no road there */
    function roadSurface(t, x, z) {
      const g = t && t.decor && t.decor.roadGrid;
      if (!g) return NaN;
      const u = (x - t.x0) / RG_CELL - 0.5; const v = (z - t.z0) / RG_CELL - 0.5;
      const iu = clamp(Math.floor(u), 0, RG - 2); const iv = clamp(Math.floor(v), 0, RG - 2);
      const fu = clamp(u - iu, 0, 1); const fv = clamp(v - iv, 0, 1);
      let sum = 0; let wsum = 0;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        const h = g[(iv + dz) * RG + iu + dx];
        if (h !== h) continue;
        const w = (dx ? fu : 1 - fu) * (dz ? fv : 1 - fv) + 1e-4;
        sum += h * w; wsum += w;
      }
      return wsum > 0 ? sum / wsum : NaN;
    }

    function decorateWater(t, grp) {
      const vec = t.ground.vec;
      if (!vec.w || !vec.w.length) return null;
      const W = new Acc();
      const UV = [];
      vec.w.forEach((ent) => {
        const rings = ent.map((r) => { const pts = []; for (let i = 0; i + 1 < r[0].length; i += 2) pts.push([t.x0 + r[0][i] / 100, t.z0 + r[0][i + 1] / 100]); return pts; });
        const hs = ent.map((r) => r[1]);
        const contour = rings[0].map((p) => new V2(p[0], p[1]));
        const holes = []; for (let h = 1; h < rings.length; h++) holes.push(rings[h].map((p) => new V2(p[0], p[1])));
        let tris; try { tris = T.ShapeUtils.triangulateShape(contour, holes); } catch (e) { return; }
        const all = contour.concat(...holes); const allH = [].concat(...hs);
        if (all.length !== allH.length) return;
        const base = W.count;
        all.forEach((v, i) => { W.vert(v.x, allH[i] / 100 - ctx.oy, v.y, 0, 1, 0, 0, 0.9, 0.95, 1); UV.push(v.x / 14, v.y / 14); });
        tris.forEach((tr) => W.i.push(base + tr[0], base + tr[2], base + tr[1]));
      });
      const mesh = W.mesh(T, matWater, 1);
      if (mesh) {
        mesh.geometry.setAttribute('uv', new T.Float32BufferAttribute(UV, 2));
        grp.add(mesh);
      }
      return mesh;
    }

    /* ---- bridge decks: ribbon at the measured deck height, sidewalks, fascia, underside, parapets, piers; registered for the road height query */
    const decks = new Map();       // tile key -> [{ pts: [{x, y, z}], hw }]
    const CONC = [0.72, 0.71, 0.68]; const CONC_D = [0.5, 0.49, 0.47]; const CONC_L = [0.82, 0.81, 0.78];
    function decorateDecks(t, S) {
      const list = (t.ground.vec.x || []);
      if (!list.length) { decks.delete(t.key); return; }
      const reg = [];
      list.forEach((dk) => {
        const n = dk.p.length / 2;
        const pts = []; for (let i = 0; i < n; i++) pts.push({ x: t.x0 + dk.p[i * 2] / 100, z: t.z0 + dk.p[i * 2 + 1] / 100, y: dk.y[i] / 100 - ctx.oy, g: dk.g[i] / 100 - ctx.oy });
        const lo = dk.pre; const hi = n - 1 - dk.post;
        if (hi <= lo) return;
        const hw = dk.h / 100; const foot = dk.c >= 6;            // footways / cycle paths on a bridge
        const walkW = foot ? 0 : (dk.c <= 3 ? 1.7 : 1.3);
        const tot = hw + walkW;
        const fr = pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
          let dx = b.x - a.x; let dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
          return { x: p.x, z: p.z, y: p.y, g: p.g, nx: -dz, nz: dx, dx, dz };
        });
        reg.push({ pts: fr.slice(lo, hi + 1).map((f) => ({ x: f.x, y: f.y + 0.02, z: f.z })), hw: tot });
        const thick = foot ? 0.35 : 1.0;
        const surfMat = foot ? (dk.s === 2 ? MAT.SETT : dk.s === 1 ? MAT.GRAVEL : MAT.PAVE) : MAT.ASPH;
        const strip = (latA, latB, yOff, col, mat) => {
          const b0 = S.count;
          for (let i = lo; i <= hi; i++) {
            const f = fr[i];
            S.vert(f.x + f.nx * latA, f.y + yOff, f.z + f.nz * latA, 0, 1, 0, mat, col[0], col[1], col[2]);
            S.vert(f.x + f.nx * latB, f.y + yOff, f.z + f.nz * latB, 0, 1, 0, mat, col[0], col[1], col[2]);
          }
          for (let i = 0; i < hi - lo; i++) { const a = b0 + i * 2; S.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
        };
        const wall = (lat, y0, y1, col, nSign) => {
          const b0 = S.count;
          for (let i = lo; i <= hi; i++) {
            const f = fr[i];
            S.vert(f.x + f.nx * lat, f.y + y0, f.z + f.nz * lat, f.nx * nSign, 0, f.nz * nSign, MAT.FLAT, col[0], col[1], col[2]);
            S.vert(f.x + f.nx * lat, f.y + y1, f.z + f.nz * lat, f.nx * nSign, 0, f.nz * nSign, MAT.FLAT, col[0], col[1], col[2]);
          }
          for (let i = 0; i < hi - lo; i++) { const a = b0 + i * 2; S.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
        };
        strip(-hw, hw, 0.02, foot ? [1, 1, 1] : [1, 1, 1], surfMat);
        if (walkW > 0) {
          strip(hw, tot, 0.02 + KERB_H, [0.95, 0.94, 0.9], MAT.PAVE);
          strip(-tot, -hw, 0.02 + KERB_H, [0.95, 0.94, 0.9], MAT.PAVE);
          wall(hw, 0.02, 0.02 + KERB_H, CONC_L, -1);
          wall(-hw, 0.02, 0.02 + KERB_H, CONC_L, 1);
        }
        const edge = tot + 0.12;
        const top = 1.05 + (walkW > 0 ? KERB_H : 0);
        wall(edge, -thick, top, CONC, 1);
        wall(-edge, -thick, top, CONC, -1);
        strip(edge - 0.18, edge + 0.12, top, CONC_L, MAT.FLAT);
        strip(-edge - 0.12, -edge + 0.18, top, CONC_L, MAT.FLAT);
        // underside (visible from below)
        const bu = S.count;
        for (let i = lo; i <= hi; i++) { const f = fr[i]; S.vert(f.x - f.nx * edge, f.y - thick, f.z - f.nz * edge, 0, -1, 0, MAT.FLAT, CONC_D[0], CONC_D[1], CONC_D[2]); S.vert(f.x + f.nx * edge, f.y - thick, f.z + f.nz * edge, 0, -1, 0, MAT.FLAT, CONC_D[0], CONC_D[1], CONC_D[2]); }
        for (let i = 0; i < hi - lo; i++) { const a = bu + i * 2; S.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
        // piers every ~22 m under high decks
        let acc = 0;
        for (let i = lo + 1; i < hi; i++) {
          acc += Math.hypot(fr[i].x - fr[i - 1].x, fr[i].z - fr[i - 1].z);
          if (acc < 22) continue;
          acc = 0;
          const f = fr[i]; const h = f.y - thick - f.g;
          if (h < 3.2) continue;
          [-1, 1].forEach((sd) => boxTo(S, f.x + f.nx * (hw * 0.55) * sd, f.g - 0.3, f.z + f.nz * (hw * 0.55) * sd, 1.3, h + 0.3, 1.3, Math.atan2(f.dz, f.dx), CONC));
        }
      });
      if (reg.length) decks.set(t.key, reg); else decks.delete(t.key);
    }
    function boxTo(m, cx, cy, cz, sx, sy, sz, yaw, col) {
      const c = Math.cos(yaw); const s = Math.sin(yaw);
      const hx = sx / 2; const hz = sz / 2;
      const corner = (ix, iz) => [cx + ix * hx * c - iz * hz * s, cz + ix * hx * s + iz * hz * c];
      const faces = [[[-1, -1], [1, -1], [0, -1]], [[1, -1], [1, 1], [1, 0]], [[1, 1], [-1, 1], [0, 1]], [[-1, 1], [-1, -1], [-1, 0]]];
      faces.forEach((f) => {
        const a = corner(f[0][0], f[0][1]); const b = corner(f[1][0], f[1][1]);
        const nx = f[2][0] * c - f[2][1] * s; const nz = f[2][0] * s + f[2][1] * c;
        const i0 = m.vert(a[0], cy, a[1], nx, 0, nz, MAT.FLAT, col[0], col[1], col[2]); const i1 = m.vert(b[0], cy, b[1], nx, 0, nz, MAT.FLAT, col[0], col[1], col[2]);
        const i2 = m.vert(b[0], cy + sy, b[1], nx, 0, nz, MAT.FLAT, col[0], col[1], col[2]); const i3 = m.vert(a[0], cy + sy, a[1], nx, 0, nz, MAT.FLAT, col[0], col[1], col[2]);
        m.i.push(i0, i1, i2, i0, i2, i3);
      });
    }
    /* the deck surface Y under (x, z) (scene metres) or NaN: used by roadHeightAt */
    function deckHeight(x, z) {
      let best = NaN;
      decks.forEach((list) => list.forEach((dk) => {
        const pts = dk.pts;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]; const b = pts[i + 1];
          const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1;
          const tt = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
          if (Math.hypot(x - (a.x + dx * tt), z - (a.z + dz * tt)) <= dk.hw) { const y = a.y + (b.y - a.y) * tt; if (best !== best || y > best) best = y; }
        }
      }));
      return best;
    }

    /* ---- far ring */
    function farMaterial(x0, z0, size, ctrl) { return terrainMaterial(x0, z0, size, ctrl, true); }

    function fetchFarClass(buf) { return decodePngGray(buf, 160).then((cls) => { for (let i = 0; i < cls.length; i++) cls[i] = Math.min(CLS - 1, (cls[i] + 16) >> 5); return cls; }); }

    let waterT = 0;
    function update(dt) {
      waterT += dt;
      waterNormal.offset.set((waterT * 0.012) % 1, (waterT * 0.007) % 1);
    }
    function dropTile(key) { decks.delete(key); }
    function dispose() {
      disposables.forEach((o) => { try { o.dispose(); } catch (e) { /* ignore */ } });
      dummy1.dispose();
      decks.clear();
    }
    return {
      fetchTile: (buf) => parseTile(buf), weightTextures: (cls, n, o) => weightTextures(T, cls, n, o), terrainMaterial, farMaterial, decorate, deckHeight, dropTile,
      fetchFarClass, update, dispose, ROAD_LIFT, atlas, N, shadeAt, matSurface, roadSurface, debugDecks: () => decks, Acc, MAT,
    };
  }

  TS.luxGround = { create, CLS, N };
})();
