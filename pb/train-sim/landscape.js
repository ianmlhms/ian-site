/* Lokféierer: world around the track (sky, light, terrain, scenery, weather).
   TS.landscape.create(scene, track, { quality }) -> { update(s, camera, dt), setTimeOfDay(h), setWeather(w), dispose(), sun, ... }
   Everything is procedural: canvas textures + merged / instanced geometry, streamed in chunks along the route. */
window.TS = window.TS || {};
(function (TS) {
  'use strict';
  const T = THREE;
  const TAG = '[Lokféierer] landscape: ';
  const CHUNK = 250;               // metres of track per streamed chunk
  const ROW_STEP = 10;             // terrain row spacing along the track
  const CORRIDOR_FLAT = 5.5;       // formation half-width under the track
  const TREE_CLEAR_LAT = 17.5;     // no tree trunks closer than this to the track axis: the chase camera sits ~10 m to the side, ~4 m up and used to end up inside a crown
  const FLAT_UV = 0.03;            // uv pointing at a plain patch of every facade texture

  const TUFTS = { high: 800, medium: 400, low: 0 };
  const QUALITY = {
    high:   { ahead: 7, behind: 2, strip: 150, trees: 1.0, shadow: 2048, rain: 6500, houses: 1.0, rowStep: 10, cars: 70, far: true },
    medium: { ahead: 5, behind: 2, strip: 120, trees: 0.6, shadow: 1024, rain: 3500, houses: 0.8, rowStep: 12.5, cars: 40, far: true },
    low:    { ahead: 4, behind: 1, strip: 90,  trees: 0.3, shadow: 0,    rain: 1800, houses: 0.6, rowStep: 25, cars: 16, far: true }
  };
  const LAT_OFFSETS = [0, 3, 6, 9, 13, 18, 24, 31, 40, 52, 66, 82, 100, 120, 150];

  /* ---------- small math helpers ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function mulberry(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
  }
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.17;
  const hashString = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
  const C = hex => new T.Color(hex);
  const mixColor = (a, b, t) => a.clone().lerp(b, t);

  /* ---------- canvas textures (cached for the session) ---------- */
  const texCache = new Map();
  function canvasTexture(key, w, h, draw, opts) {
    if (texCache.has(key)) return texCache.get(key);
    const o = opts || {};
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = o.linear ? T.NoColorSpace : T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = 4;
    texCache.set(key, tex); return tex;
  }
  const speckle = (g, w, h, n, alpha, size) => {
    const r = mulberry(w * 31 + n);
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      g.fillRect(r() * w, r() * h, size, size);
    }
  };
  const texGrass = () => canvasTexture('grass', 256, 256, (g, w, h) => {
    g.fillStyle = '#d8ddd0'; g.fillRect(0, 0, w, h);
    const r = mulberry(5);
    for (let i = 0; i < 26; i++) { g.fillStyle = r() < 0.6 ? 'rgba(255,252,235,0.85)' : r() < 0.5 ? 'rgba(255,225,90,0.8)' : 'rgba(210,150,230,0.7)'; g.fillRect(r() * w, r() * h, 2, 2); }
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 105;
      g.fillStyle = `rgba(${v * 0.9 | 0},${v | 0},${v * 0.85 | 0},0.20)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 1.2, 2 + r() * 4);
    }
  });
  const texRows = () => canvasTexture('rows', 128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { // 4 crop rows per 3 m tile
      const x = i * 32;
      const grd = g.createLinearGradient(x, 0, x + 32, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.30)'); grd.addColorStop(0.35, 'rgba(0,0,0,0.0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.0)'); grd.addColorStop(1, 'rgba(0,0,0,0.30)');
      g.fillStyle = grd; g.fillRect(x, 0, 32, h);
    }
    speckle(g, w, h, 1400, 0.10, 2);
  });
  const texVines = () => canvasTexture('vines', 128, 128, (g, w, h) => {
    g.fillStyle = '#9b8566'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, 0.12, 2);
    for (let i = 0; i < 2; i++) { // 2 rows per 4 m
      const x = i * 64 + 22;
      const grd = g.createLinearGradient(x, 0, x + 22, 0);
      grd.addColorStop(0, 'rgba(60,92,40,0)'); grd.addColorStop(0.3, '#4f7a38'); grd.addColorStop(0.7, '#3e6a2c'); grd.addColorStop(1, 'rgba(60,92,40,0)');
      g.fillStyle = grd; g.fillRect(x, 0, 22, h);
    }
  });
  const texSlate = () => canvasTexture('slate', 128, 128, (g, w, h) => {
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, w, h);
    const r = mulberry(11);
    for (let y = 0; y < h; y += 14) for (let x = -32; x < w; x += 32) {
      const o = ((y / 14) % 2) * 16, v = 118 + r() * 50;
      g.fillStyle = `rgb(${v | 0},${v + 4 | 0},${v + 9 | 0})`; g.fillRect(x + o + 1, y + 1, 30, 12);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + o + 1, y + 1, 30, 1.5);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + o + 1, y + 11, 30, 2);
    }
  });
  const texAsphalt = () => canvasTexture('asphalt', 128, 128, (g, w, h) => {
    g.fillStyle = '#54585b'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, 0.05, 1);
    g.fillStyle = 'rgba(235,235,225,0.85)';
    g.fillRect(w * 0.045, 0, 3, h); g.fillRect(w * 0.955 - 3, 0, 3, h);
    g.fillRect(w * 0.5 - 2, 0, 4, h * 0.45);
  });
  /* Window facades. Day map + emissive map share a layout so night lights line up. */
  function drawWindow(g, x, y, ww, wh, lit, style) {
    if (style === 'house') {
      g.fillStyle = '#7f8c8a'; g.fillRect(x - ww * 0.42, y, ww * 0.38, wh); g.fillRect(x + ww * 1.04, y, ww * 0.38, wh); // shutters
    }
    g.fillStyle = '#f3efe6'; g.fillRect(x - 4, y - 4, ww + 8, wh + 8);
    const grd = g.createLinearGradient(x, y, x + ww, y + wh);
    grd.addColorStop(0, '#6f8798'); grd.addColorStop(0.45, '#2f4352'); grd.addColorStop(1, '#1d2a35');
    g.fillStyle = grd; g.fillRect(x, y, ww, wh);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x, y + wh * 0.5); g.lineTo(x + ww * 0.6, y); g.lineTo(x + ww, y); g.lineTo(x, y + wh * 0.9); g.fill();
    g.fillStyle = '#f3efe6'; g.fillRect(x + ww / 2 - 1.5, y, 3, wh); g.fillRect(x, y + wh * 0.42, ww, 3);
    g.fillStyle = '#c9c4b8'; g.fillRect(x - 7, y + wh + 4, ww + 14, 5);
  }
  function makeFacade(key, size, cells, kind) {
    const day = canvasTexture(key + 'D', size, size, (g, w, h) => {
      g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, size * 5, 0.045, 2);
      const r = mulberry(kind === 'house' ? 3 : 4), cell = w / cells;
      for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
        const ww = cell * (kind === 'house' ? 0.34 : 0.52), wh = cell * (kind === 'house' ? 0.5 : 0.62);
        const x = cx * cell + (cell - ww) / 2, y = cy * cell + cell * (kind === 'house' ? 0.2 : 0.14);
        drawWindow(g, x, y, ww, wh, false, kind);
        if (r() < 0.25) { g.fillStyle = 'rgba(240,235,220,0.55)'; g.fillRect(x, y, ww, wh * 0.45); } // curtains
        if (kind === 'block') { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(cx * cell, cy * cell + cell - 5, cell, 5); }
      }
    });
    const lit = canvasTexture(key + 'E', size, size, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const r = mulberry(kind === 'house' ? 9 : 17), cell = w / cells;
      for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
        if (r() > 0.4) continue;
        const ww = cell * (kind === 'house' ? 0.34 : 0.52), wh = cell * (kind === 'house' ? 0.5 : 0.62);
        const x = cx * cell + (cell - ww) / 2, y = cy * cell + cell * (kind === 'house' ? 0.2 : 0.14);
        g.fillStyle = r() > 0.5 ? '#ffd58a' : '#fff0c8'; g.fillRect(x, y, ww, wh);
      }
    });
    return { day, lit };
  }
  const texWaterNormal = () => canvasTexture('waterN', 128, 128, (g, w, h) => {
    const waves = [[1, 0, 0.8, 0.3], [0, 2, 0.5, 1.1], [2, 1, 0.35, 2.0], [3, -2, 0.2, 0.4], [-1, 3, 0.18, 1.7]];
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, a, ph] of waves) {
        const arg = 6.2832 * (kx * x / w + ky * y / h) + ph, d = Math.cos(arg) * a * 6.2832;
        dx += d * kx / w; dy += d * ky / h;
      }
      const nx = -dx * 5, ny = -dy * 5, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * w + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { linear: true });

  /* ---------- merged-geometry builder (vertex colours baked, uv in metres) ---------- */
  class MB {
    constructor(faceUp) { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.faceUp = !!faceUp; }   // faceUp: roof builder, surfaces that point downwards are flipped (the shadow normal bias pushes along the vertex normal, so inward normals turned roofs black)
    get count() { return this.p.length / 3; }
    get empty() { return this.p.length === 0; }
    addGeo(geo, m, color, flat) {
      const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, idx = geo.index;
      const base = this.count, v = new T.Vector3(), n = new T.Vector3(), nm = new T.Matrix3().getNormalMatrix(m);
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m);
        n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        const col = typeof color === 'function' ? color(v, n) : color;
        this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); this.c.push(col.r, col.g, col.b);
        if (flat || !uv) this.u.push(FLAT_UV, FLAT_UV); else this.u.push(uv.getX(k), uv.getY(k));
      }
      if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
      else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    }
    /* a,b,c,d: THREE.Vector3 in local space (any winding, materials are double sided). uvs [[u,v]*4] */
    quad(m, a, b, c, d, uvs, color) {
      let pts = [a, b, c, d].map(q => q.clone().applyMatrix4(m));
      const n = new T.Vector3().subVectors(pts[1], pts[0]).cross(new T.Vector3().subVectors(pts[2], pts[0])).normalize();
      if (this.faceUp && n.y < -0.001) { pts = [pts[0], pts[3], pts[2], pts[1]]; n.negate(); if (uvs) uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
      const base = this.count;
      for (let k = 0; k < 4; k++) {
        this.p.push(pts[k].x, pts[k].y, pts[k].z); this.n.push(n.x, n.y, n.z); this.c.push(color.r, color.g, color.b);
        this.u.push(uvs ? uvs[k][0] : FLAT_UV, uvs ? uvs[k][1] : FLAT_UV);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    tri(m, a, b, c, uvs, color) {
      let pts = [a, b, c].map(q => q.clone().applyMatrix4(m));
      const n = new T.Vector3().subVectors(pts[1], pts[0]).cross(new T.Vector3().subVectors(pts[2], pts[0])).normalize();
      if (this.faceUp && n.y < -0.001) { pts = [pts[0], pts[2], pts[1]]; n.negate(); if (uvs) uvs = [uvs[0], uvs[2], uvs[1]]; }
      const base = this.count;
      for (let k = 0; k < 3; k++) {
        this.p.push(pts[k].x, pts[k].y, pts[k].z); this.n.push(n.x, n.y, n.z); this.c.push(color.r, color.g, color.b);
        this.u.push(uvs ? uvs[k][0] : FLAT_UV, uvs ? uvs[k][1] : FLAT_UV);
      }
      this.i.push(base, base + 1, base + 2);
    }
    build() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  const TMP_M = new T.Matrix4(), TMP_Q = new T.Quaternion(), TMP_P = new T.Vector3(), TMP_S = new T.Vector3(1, 1, 1), UP = new T.Vector3(0, 1, 0);
  function placeM(x, y, z, rotY, sx, sy, sz) {
    TMP_Q.setFromAxisAngle(UP, rotY || 0); TMP_P.set(x, y, z); TMP_S.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
    return new T.Matrix4().compose(TMP_P, TMP_Q, TMP_S);
  }
  /* box with uv in metres: walls tile every `tile` m horizontally and vertically; top/bottom are flat. vDrop = hidden plinth depth. */
  function wallBoxGeo(w, h, d, tile, vDrop) {
    const g = new T.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, drop = vDrop || 0;
    for (let k = 0; k < p.count; k++) {
      const ax = Math.abs(n.getX(k)), ay = Math.abs(n.getY(k));
      if (ay > 0.5) { uv.setXY(k, FLAT_UV, FLAT_UV); continue; }
      const v = (p.getY(k) + h / 2 - drop) / tile;
      if (ax > 0.5) uv.setXY(k, (p.getZ(k) * Math.sign(n.getX(k)) + d / 2) / tile, v);
      else uv.setXY(k, (-p.getX(k) * Math.sign(n.getZ(k)) + w / 2) / tile, v);
    }
    return g;
  }
  const cylGeo = (rt, rb, h, seg) => new T.CylinderGeometry(rt, rb, h, seg, 1, false);
  const gradientByY = (lo, hi, y0, y1) => (v) => mixColor(lo, hi, clamp((v.y - y0) / (y1 - y0), 0, 1));

  /* ---------- shared geometry kits (built once per create) ---------- */
  const PLASTER = ['#efe9d8', '#f1e3b8', '#ead7c4', '#e9c9bb', '#d9e3dd', '#f3efe4', '#e8d9a8', '#d8cfc3', '#f0d5a0', '#cfdbe0'].map(C);
  const SLATE_TINTS = ['#5a6068', '#4c525a', '#656b72', '#444a52', '#6a5a52'].map(C);
  const BRICK_TINTS = ['#b36d52', '#a05a45', '#c07f60'].map(C);
  const CITY_TINTS = ['#e4d8c2', '#d6cdbd', '#c9bfae', '#e8e0d0', '#b9a58f', '#c8b79c', '#a9b4bd', '#9fa8a8'].map(C);
  const LEAF = {
    oak: [C('#2f5a28'), C('#5a8a37')], oakDry: [C('#556b2a'), C('#9a9a3a')],
    beech: [C('#3d6b2d'), C('#7da63f')], birch: [C('#4f8a35'), C('#a3c64c')],
    spruce: [C('#1b3d2c'), C('#2f6a45')], poplar: [C('#3a6a2b'), C('#78a63a')], bush: [C('#3a6a2d'), C('#6a9a3c')]
  };

  function buildTreeKit() {
    const kit = {};
    const leafCol = (pair, y0, y1) => (v, n) => mixColor(pair[0], pair[1], clamp(((v.y - y0) / (y1 - y0)) * 0.7 + (n.y * 0.5 + 0.5) * 0.3, 0, 1));
    const blob = (mb, x, y, z, rx, ry, rz, pair, y0, y1, detail) => {
      const geo = new T.IcosahedronGeometry(1, detail === undefined ? 1 : detail), pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) { // organic silhouette: same jitter for coincident vertices
        const hx = Math.round(pa.getX(i) * 50), hy = Math.round(pa.getY(i) * 50), hz = Math.round(pa.getZ(i) * 50), j = 0.82 + 0.36 * hash2(hx * 31 + hz, hy * 17 + hz * 7 + (x * 10 | 0));
        pa.setXYZ(i, pa.getX(i) * j, pa.getY(i) * j, pa.getZ(i) * j);
      }
      geo.computeVertexNormals();
      mb.addGeo(geo, placeM(x, y, z, x * 3.1, rx, ry, rz), leafCol(pair, y0, y1));
    };
    // oak: broad, layered blobs
    let mb = new MB(); const bark = C('#4a3a2c');
    mb.addGeo(cylGeo(0.22, 0.38, 3.2, 6), placeM(0, 1.6, 0), bark);
    [[0, 4.6, 0, 2.7, 2.1, 2.7], [1.7, 3.8, 0.7, 1.9, 1.6, 1.9], [-1.6, 4.0, -0.6, 2.0, 1.7, 2.0], [0.3, 6.0, 0.1, 1.9, 1.5, 1.9], [-0.4, 3.6, 1.6, 1.6, 1.3, 1.6]]
      .forEach(b => blob(mb, b[0], b[1], b[2], b[3], b[4], b[5], LEAF.oak, 2, 7.5));
    kit.oak = mb.build();
    mb = new MB(); // beech: taller & rounder
    mb.addGeo(cylGeo(0.2, 0.34, 3.6, 6), placeM(0, 1.8, 0), C('#6b5d52'));
    [[0, 5.6, 0, 2.1, 3.1, 2.1], [1.2, 4.6, 0.4, 1.4, 1.7, 1.4], [-1.2, 4.9, -0.3, 1.5, 1.8, 1.5]].forEach(b => blob(mb, b[0], b[1], b[2], b[3], b[4], b[5], LEAF.beech, 2.5, 8.5));
    kit.beech = mb.build();
    mb = new MB(); // birch: white trunk
    mb.addGeo(cylGeo(0.12, 0.2, 4.4, 6), placeM(0, 2.2, 0), C('#d8d3c6'));
    [[0, 5.4, 0, 1.5, 2.2, 1.5], [0.6, 4.2, 0.3, 1.1, 1.3, 1.1]].forEach(b => blob(mb, b[0], b[1], b[2], b[3], b[4], b[5], LEAF.birch, 3, 7.6));
    kit.birch = mb.build();
    mb = new MB(); // spruce: stacked cones
    mb.addGeo(cylGeo(0.18, 0.3, 1.8, 6), placeM(0, 0.9, 0), bark);
    for (let k = 0; k < 6; k++) {
      const r = 2.15 - k * 0.3, h = 2.4 - k * 0.12, y = 1.2 + k * 1.15;
      mb.addGeo(new T.ConeGeometry(r, h, 9, 1), placeM(0, y + h / 2, 0, k * 0.7), (v, n) => mixColor(LEAF.spruce[0], LEAF.spruce[1], clamp((v.y - y) / h * 0.5 + (n.y * 0.5 + 0.5) * 0.25 + k * 0.05, 0, 1)));
    }
    kit.spruce = mb.build();
    mb = new MB(); // poplar
    mb.addGeo(cylGeo(0.14, 0.24, 3, 6), placeM(0, 1.5, 0), C('#5d5346'));
    blob(mb, 0, 7.5, 0, 1.15, 5.2, 1.15, LEAF.poplar, 2, 12.5);
    kit.poplar = mb.build();
    mb = new MB(); // bush / hedge shrub
    blob(mb, 0, 0.55, 0, 1.0, 0.75, 1.0, LEAF.bush, 0, 1.4, 1); blob(mb, 0.7, 0.4, 0.2, 0.7, 0.55, 0.7, LEAF.bush, 0, 1.2, 0);
    kit.bush = mb.build();
    mb = new MB(); // grass tuft for the verge
    [[0.12, 0, 0], [0.4, 2.1, 0.1], [-0.38, 4.2, -0.1]].forEach(([tilt, rot, off], i) => {
      const g = new T.ConeGeometry(0.09, 0.55 + i * 0.06, 3, 1).translate(off * 0.2, 0.27, 0), m = new T.Matrix4().makeRotationY(rot).multiply(new T.Matrix4().makeRotationZ(tilt));
      mb.addGeo(g, m, (v) => mixColor(C('#4a6f2a'), C('#a3b45a'), clamp(v.y / 0.55, 0, 1)), true);
    });
    kit.tuft = mb.build();
    mb = new MB(); // cow (black/white patches by vertex colour)
    const cowCol = (v) => (hash2(Math.floor(v.x * 3.1) + 7, Math.floor(v.z * 2.3)) > 0.62 ? C('#26221f') : C('#ece8e0'));
    mb.addGeo(new T.BoxGeometry(0.85, 0.8, 1.7), placeM(0, 1.0, 0), cowCol, true);
    mb.addGeo(new T.BoxGeometry(0.45, 0.48, 0.5), placeM(0, 1.25, -1.05), C('#d9cfc2'), true);
    mb.addGeo(new T.BoxGeometry(0.3, 0.2, 0.2), placeM(0, 1.0, -1.34), C('#d3a6a0'), true);
    [[-0.3, -0.65], [0.3, -0.65], [-0.3, 0.65], [0.3, 0.65]].forEach(([x, z]) => mb.addGeo(new T.BoxGeometry(0.16, 0.65, 0.16), placeM(x, 0.32, z), C('#2c2824'), true));
    kit.cow = mb.build();
    mb = new MB(); // sheep
    mb.addGeo(new T.IcosahedronGeometry(0.5, 0), placeM(0, 0.7, 0, 0, 1.0, 0.85, 1.4), C('#efece4'), true);
    mb.addGeo(new T.BoxGeometry(0.22, 0.26, 0.3), placeM(0, 0.78, -0.72), C('#3a332e'), true);
    [[-0.15, -0.3], [0.15, -0.3], [-0.15, 0.3], [0.15, 0.3]].forEach(([x, z]) => mb.addGeo(new T.BoxGeometry(0.08, 0.4, 0.08), placeM(x, 0.2, z), C('#3a332e'), true));
    kit.sheep = mb.build();
    mb = new MB(); // street lamp: pole + arm (head is a separate emissive mesh)
    mb.addGeo(cylGeo(0.07, 0.11, 7.2, 6), placeM(0, 3.6, 0), C('#3a3f44'), true);
    mb.addGeo(new T.BoxGeometry(0.08, 0.08, 1.5), placeM(0, 7.15, 0.7), C('#3a3f44'), true);
    kit.lampPole = mb.build();
    kit.lampHead = new T.BoxGeometry(0.55, 0.16, 1.1).translate(0, 7.05, 1.4);
    return kit;
  }

  /* House: walls go to `wb` (facade texture), roofs to `rb` (slate texture). Local frame: x along the ridge, +z = front. */
  function addHouse(wb, rb, M0, rng, o) {
    const w = o.w || pick(rng, [6, 9, 9, 12]), d = o.d || pick(rng, [6, 8, 9]), floors = o.floors || pick(rng, [2, 2, 3]);
    const H = floors * 3, drop = 1.4, wall = o.wall || pick(rng, PLASTER), roofCol = o.roof || pick(rng, SLATE_TINTS);
    const rise = (d / 2 + 0.45) * (0.75 + rng() * 0.25), ov = 0.5;
    const at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0));
    wb.addGeo(wallBoxGeo(w, H + drop, d, 6, drop), at(0, (H - drop) / 2, 0), wall);
    // gable ends (plaster, plain)
    [-1, 1].forEach(sx => wb.tri(at(sx * w / 2, 0, 0), new T.Vector3(0, H, -d / 2), new T.Vector3(0, H, d / 2), new T.Vector3(0, H + rise - 0.2, 0), null, wall));
    // roof slopes with overhang
    const rw = w / 2 + ov, rd = d / 2 + ov, rm = at(0, 0, 0);
    [-1, 1].forEach(sz => {
      const len = Math.hypot(rd, rise);
      rb.quad(rm, new T.Vector3(-rw, H - 0.15, sz * rd), new T.Vector3(rw, H - 0.15, sz * rd), new T.Vector3(rw, H + rise, 0), new T.Vector3(-rw, H + rise, 0),
        [[0, 0], [rw * 2 / 1.5, 0], [rw * 2 / 1.5, len / 1.5], [0, len / 1.5]], roofCol);
    });
    [-1, 1].forEach(sx => rb.quad(rm, new T.Vector3(sx * (rw - 0.02), H - 0.15, -rd), new T.Vector3(sx * (rw - 0.02), H - 0.15, rd), new T.Vector3(sx * (rw - 0.02), H + 0.02, rd), new T.Vector3(sx * (rw - 0.02), H + 0.02, -rd), [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], C('#e9e5da')));
    // door
    const door = new T.Vector3(0, 0, 0);
    wb.quad(at(0, 0, d / 2 + 0.02), new T.Vector3(-0.55, 0, 0), new T.Vector3(0.55, 0, 0), new T.Vector3(0.55, 2.1, 0), new T.Vector3(-0.55, 2.1, 0), null, pick(rng, [C('#5a3a28'), C('#3b4b5a'), C('#6a2f2a'), C('#2f4a3a')]));
    wb.addGeo(new T.BoxGeometry(1.5, 0.15, 0.9), at(0, 0.0, d / 2 + 0.45), C('#8f8b84'), true);
    void door;
    // chimney
    wb.addGeo(new T.BoxGeometry(0.7, 1.8, 0.7), at(w * (rng() * 0.5 - 0.25), H + rise * 0.7, -d * 0.12), pick(rng, BRICK_TINTS), true);
    // dormers on the front slope
    const dormers = rng() < 0.55 && w >= 9 ? (w >= 12 ? 2 : 1) : 0;
    for (let k = 0; k < dormers; k++) {
      const dx = dormers === 1 ? 0 : (k === 0 ? -w * 0.22 : w * 0.22), dz = rd * 0.52, dy = H + rise * (1 - 0.52) - 0.2;
      wb.addGeo(wallBoxGeo(1.6, 1.5, 1.4, 6, 0), at(dx, dy + 0.75 - 0.5, dz - 0.3), wall);
      rb.quad(at(dx, dy + 1.25, dz - 0.3), new T.Vector3(-1.0, 0, 0.9), new T.Vector3(1.0, 0, 0.9), new T.Vector3(1.0, 0.8, -0.6), new T.Vector3(-1.0, 0.8, -0.6), [[0, 0], [1, 0], [1, 1], [0, 1]], roofCol);
    }
    // small annex
    if (o.annex !== false && rng() < 0.4) {
      const side = rng() < 0.5 ? -1 : 1, aw = 4, ad = d * 0.7;
      wb.addGeo(wallBoxGeo(aw, 2.9 + drop, ad, 6, drop), at(side * (w / 2 + aw / 2), (2.9 - drop) / 2, -d * 0.1), wall);
      wb.addGeo(new T.BoxGeometry(aw + 0.4, 0.25, ad + 0.4), at(side * (w / 2 + aw / 2), 2.95, -d * 0.1), C('#555a60'), true);
    }
    return { w, d, h: H + rise };
  }

  /* City block: textured shaft, optional hipped (mansard) roof or flat roof furniture. */
  function addBlock(wb, rb, M0, rng, o) {
    const w = o.w, d = o.d, floors = o.floors, H = floors * 3, drop = 1.5;
    const tint = o.tint || pick(rng, CITY_TINTS), at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0));
    wb.addGeo(wallBoxGeo(w, H + drop, d, 12, drop), at(0, (H - drop) / 2, 0), tint);
    if (o.roof === 'mansard') {
      const inset = 2.4, mh = 4.2, col = pick(rng, SLATE_TINTS), hw = w / 2, hd = d / 2;
      const P = (x, y, z) => new T.Vector3(x, y, z), m = at(0, 0, 0);
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4], ai = [Math.sign(a[0]) * (hw - inset), Math.sign(a[1]) * (hd - inset)], bi = [Math.sign(b[0]) * (hw - inset), Math.sign(b[1]) * (hd - inset)];
        rb.quad(m, P(a[0], H, a[1]), P(b[0], H, b[1]), P(bi[0], H + mh, bi[1]), P(ai[0], H + mh, ai[1]), [[0, 0], [Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5, 0], [Math.hypot(bi[0] - ai[0], bi[1] - ai[1]) / 1.5, mh / 1.5], [0, mh / 1.5]], col);
      }
      rb.quad(m, P(-hw + inset, H + mh, -hd + inset), P(hw - inset, H + mh, -hd + inset), P(hw - inset, H + mh, hd - inset), P(-hw + inset, H + mh, hd - inset), [[0, 0], [(w - 2 * inset) / 1.5, 0], [(w - 2 * inset) / 1.5, (d - 2 * inset) / 1.5], [0, (d - 2 * inset) / 1.5]], col);
      for (let k = 0; k < Math.floor(w / 6); k++) wb.addGeo(new T.BoxGeometry(1.4, 1.6, 1.2), at(-w / 2 + 3 + k * 6, H + 1.2, d / 2 - 1.5), tint, true);
    } else {
      wb.addGeo(new T.BoxGeometry(w + 0.5, 0.6, d + 0.5), at(0, H + 0.3, 0), C('#a8a49a'), true);
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) wb.addGeo(new T.BoxGeometry(2 + rng() * 3, 1.6 + rng() * 1.5, 2 + rng() * 3), at((rng() - 0.5) * (w - 6), H + 1.4, (rng() - 0.5) * (d - 6)), pick(rng, [C('#8d8f90'), C('#6c7276'), C('#b9b6ac')]), true);
    }
    return { w, d, h: H };
  }

  function addChurch(wb, rb, M0, rng) {
    const at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0)), wall = C('#e6dfcb'), stone = C('#c6bfae');
    wb.addGeo(wallBoxGeo(9, 10 + 1.4, 18, 6, 1.4), at(0, 4.3, 3), wall);
    const rise = 4.6, rw = 5.2, rd = 9.4, roof = C('#4a5058'), m = at(0, 0, 3);
    [-1, 1].forEach(sx => rb.quad(m, new T.Vector3(sx * rw, 9.9, -rd), new T.Vector3(sx * rw, 9.9, rd), new T.Vector3(0, 10 + rise, rd), new T.Vector3(0, 10 + rise, -rd), [[0, 0], [rd * 2 / 1.5, 0], [rd * 2 / 1.5, 4], [0, 4]], roof));
    wb.tri(at(0, 0, 3 + 9), new T.Vector3(-4.5, 10, 0), new T.Vector3(4.5, 10, 0), new T.Vector3(0, 10 + rise - 0.3, 0), null, wall);
    wb.tri(at(0, 0, 3 - 9), new T.Vector3(-4.5, 10, 0), new T.Vector3(4.5, 10, 0), new T.Vector3(0, 10 + rise - 0.3, 0), null, wall);
    // tower with spire
    wb.addGeo(wallBoxGeo(5, 16 + 1.4, 5, 6, 1.4), at(0, 7.3, -9.5), stone);
    wb.addGeo(new T.BoxGeometry(5.2, 3.2, 5.2), at(0, 17.6, -9.5), stone, true);
    wb.addGeo(new T.BoxGeometry(1.2, 1.6, 0.2), at(0, 17.6, -9.5 + 2.65), C('#2b3036'), true);
    wb.addGeo(new T.BoxGeometry(1.2, 1.6, 0.2), at(0, 17.6, -9.5 - 2.65), C('#2b3036'), true);
    rb.addGeo(new T.ConeGeometry(3.8, 12, 4, 1), at(0, 19.2 + 6, -9.5, Math.PI / 4), (v) => mixColor(C('#3f5a55'), C('#566f68'), clamp((v.y - 19) / 12, 0, 1)));
    wb.addGeo(cylGeo(0.06, 0.06, 2.4, 4), at(0, 32.2, -9.5), C('#d8c37a'), true);
    wb.addGeo(new T.BoxGeometry(1, 0.1, 0.1), at(0, 32.6, -9.5), C('#d8c37a'), true);
    void rng;
    return { w: 9, d: 24, h: 33 };
  }

  /* Industrial landmarks (Belval-like blast furnace, stoves, chimneys, sheds) - flat colours, no windows */
  function addFurnace(wb, M0, rng, sb) {
    const at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0));
    const rust = C('#8a4a33'), rust2 = C('#6d3a2b'), steel = C('#6b6f73'), dark = C('#3b3d40');
    const col = (a, b, y0, y1) => (v, n) => mixColor(a, b, clamp((v.y - y0) / (y1 - y0), 0, 1)).multiplyScalar(0.85 + 0.15 * n.y);
    wb.addGeo(new T.CylinderGeometry(7, 9, 12, 10), at(0, 6, 0), col(rust2, rust, 0, 12), true);       // hearth
    wb.addGeo(new T.CylinderGeometry(5, 7, 26, 10), at(0, 25, 0), col(rust, C('#a45a3c'), 12, 38), true); // shaft
    wb.addGeo(new T.CylinderGeometry(2.6, 4.2, 14, 8), at(0, 45, 0), col(rust2, rust, 38, 52), true);     // top cone
    wb.addGeo(new T.CylinderGeometry(3.2, 3.2, 3.2, 8), at(0, 54, 0), dark, true);
    // stoves (cowper)
    [[16, 6], [16, -7], [24, 0]].forEach(([x, z]) => {
      wb.addGeo(new T.CylinderGeometry(5, 5.4, 34, 12), at(x, 17, z), col(C('#7d4936'), C('#9c5a40'), 0, 34), true);
      wb.addGeo(new T.SphereGeometry(5, 12, 6, 0, 6.3, 0, 1.57), at(x, 34, z), C('#9c5a40'), true);
    });
    // pipes (downcomers)
    const pipe = (x0, y0, z0, x1, y1, z1, r) => {
      const a = new T.Vector3(x0, y0, z0), b = new T.Vector3(x1, y1, z1), mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      const q = new T.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
      const m = M0.clone().multiply(new T.Matrix4().compose(mid, q, new T.Vector3(1, 1, 1)));
      wb.addGeo(cylGeo(r, r, len, 6), m, steel, true);
    };
    pipe(0, 56, 0, 14, 36, 4, 1.1); pipe(0, 55, 0, 16, 36, -6, 1.1); pipe(14, 36, 4, 22, 30, 0, 1.3); pipe(0, 40, 0, 0, 12, 12, 0.7); pipe(0, 12, 12, 22, 5, 14, 0.9);
    // skip incline + gantry
    pipe(-30, 2, 0, -3, 48, 0, 0.5); pipe(-29, 2, 1.6, -2, 48, 1.6, 0.5);
    wb.addGeo(new T.BoxGeometry(10, 3, 8), at(-32, 2, 0), steel, true);
    // legs / catwalk frame
    [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(([x, z]) => wb.addGeo(new T.BoxGeometry(0.8, 18, 0.8), at(x * 2.2, 9, z * 2.2), dark, true));
    wb.addGeo(new T.BoxGeometry(24, 0.6, 24), at(0, 18, 0), dark, true);
    // chimney
    wb.addGeo(new T.CylinderGeometry(2.4, 3.4, 70, 10), at(40, 35, -4), (v) => ((Math.floor(v.y / 7) % 2) ? C('#b83a2e') : C('#e9e5db')), true);
    if (sb) { // smoke plumes drifting downwind
      const plume = (x, y, z, n, r0, dx, col) => {
        for (let k = 0; k < n; k++) {
          const r = r0 + k * 1.25 + rng() * 1.4, spread = 1.2 + k * 0.5;
          sb.addGeo(new T.IcosahedronGeometry(1, 1), M0.clone().multiply(placeM(x + dx * k * 2.6 + (rng() - 0.5) * spread, y + k * 4.6 + rng() * 2, z + k * 0.7 + (rng() - 0.5) * spread, rng() * 6, r, r * 0.78, r * 0.95)), mixColor(col, C('#ffffff'), k / n * 0.55), true);
        }
      };
      plume(40, 72, -4, 12, 2.4, 1.0, C('#7a7c80'));
      plume(0, 57, 0, 8, 1.8, 0.8, C('#d8dadc'));
    }
    void rng;
  }
  function addShed(wb, rb, M0, rng, w, d, h) {
    const at = (x, y, z) => M0.clone().multiply(placeM(x, y, z)), col = pick(rng, [C('#9aa0a4'), C('#b8b2a2'), C('#8a9298'), C('#a58a7a')]);
    wb.addGeo(new T.BoxGeometry(w, h, d), at(0, h / 2, 0), col, true);
    for (let k = 0; k < 3; k++) wb.addGeo(new T.BoxGeometry(w * 0.9, 1.1, 0.1), at(0, h * (0.5 + k * 0.1), d / 2 + 0.06), C('#2e3a44'), true);
    wb.addGeo(new T.BoxGeometry(w + 0.4, 0.4, d + 0.4), at(0, h + 0.2, 0), C('#6f7479'), true);
  }

  function addBarn(wb, rb, M0, rng, w, d, h) {
    const at = (x, y, z) => M0.clone().multiply(placeM(x, y, z)), wood = pick(rng, [C('#8a5a44'), C('#7a6a58'), C('#9a4f3c'), C('#b5a58a')]), roof = pick(rng, [C('#5a5148'), C('#6a4a40'), C('#4a4e52')]);
    wb.addGeo(new T.BoxGeometry(w, h + 1.2, d), at(0, (h - 1.2) / 2, 0), wood, true);
    const rise = d * 0.34, m = at(0, 0, 0);
    [-1, 1].forEach(sz => rb.quad(m, new T.Vector3(-w / 2 - 0.5, h - 0.1, sz * (d / 2 + 0.6)), new T.Vector3(w / 2 + 0.5, h - 0.1, sz * (d / 2 + 0.6)), new T.Vector3(w / 2 + 0.5, h + rise, 0), new T.Vector3(-w / 2 - 0.5, h + rise, 0), [[0, 0], [w / 1.5, 0], [w / 1.5, d / 2.5], [0, d / 2.5]], roof));
    [-1, 1].forEach(sx => wb.tri(at(sx * w / 2, 0, 0), new T.Vector3(0, h, -d / 2), new T.Vector3(0, h, d / 2), new T.Vector3(0, h + rise - 0.1, 0), null, wood));
    wb.addGeo(new T.BoxGeometry(4.2, 4.6, 0.2), at(w * 0.15, 2.3, d / 2 + 0.06), C('#3f2e24'), true);
  }

  function addCastle(wb, rb, M0) {
    const at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0));
    const stone = (v, n) => mixColor(C('#a39d8f'), C('#c9c2b0'), clamp(v.y / 30 + n.y * 0.1, 0, 1)), roofC = C('#4a5058');
    wb.addGeo(new T.BoxGeometry(22, 18, 14), at(0, 9, 0), stone, true);          // main hall
    rb.addGeo(new T.ConeGeometry(14, 8, 4, 1), at(0, 22, 0, Math.PI / 4), roofC);
    wb.addGeo(new T.BoxGeometry(34, 8, 3), at(0, 4, 14), stone, true);           // curtain walls
    wb.addGeo(new T.BoxGeometry(3, 8, 28), at(17, 4, 0), stone, true);
    wb.addGeo(new T.BoxGeometry(3, 8, 28), at(-17, 4, 0), stone, true);
    wb.addGeo(new T.BoxGeometry(5, 10, 5), at(0, 5, 14.5), C('#8a8478'), true); // gate house
    [[-17, -14], [17, -14], [17, 14], [-17, 14]].forEach(([x, z], k) => {
      const hgt = k === 1 ? 26 : 20;
      wb.addGeo(new T.CylinderGeometry(4.2, 4.6, hgt, 10), at(x, hgt / 2, z), stone, true);
      rb.addGeo(new T.ConeGeometry(5.2, 9, 10, 1), at(x, hgt + 4.5, z), roofC);
    });
    wb.addGeo(new T.BoxGeometry(8, 34, 8), at(-8, 17, -5), stone, true);          // keep
    rb.addGeo(new T.ConeGeometry(6.5, 10, 4, 1), at(-8, 39, -5, Math.PI / 4), roofC);
    for (let k = 0; k < 5; k++) wb.addGeo(new T.BoxGeometry(1, 1.6, 0.3), at(-8, 14 + k * 4.5, -0.9), C('#2b2e33'), true);
  }

  function addTurbine(mbTower, bladesMb, M0) {
    const at = (x, y, z, rot) => M0.clone().multiply(placeM(x, y, z, rot || 0));
    mbTower.addGeo(new T.CylinderGeometry(1.5, 2.6, 88, 10), at(0, 44, 0), (v) => mixColor(C('#dcdcd6'), C('#f2f2ee'), clamp(v.y / 88, 0, 1)), true);
    mbTower.addGeo(new T.BoxGeometry(3.4, 3.4, 9), at(0, 89.5, 0.8), C('#e9e9e4'), true);
    const hub = new T.SphereGeometry(1.7, 8, 6);
    bladesMb.addGeo(hub, placeM(0, 0, 0), C('#e9e9e4'), true);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3, shape = new T.BoxGeometry(1.0, 38, 0.35);
      shape.translate(0, 20, 0);
      const m = new T.Matrix4().makeRotationZ(a);
      bladesMb.addGeo(shape, m, (v) => mixColor(C('#f4f4f1'), C('#d8d8d3'), clamp(v.length() / 40, 0, 1)), true);
    }
  }

  /* cars: shared InstancedMesh geometry */
  function buildCarGeo() {
    const mb = new MB(), white = C('#ffffff'), glass = C('#26323c'), dark = C('#16181a');
    mb.addGeo(new T.BoxGeometry(1.8, 0.62, 4.3), placeM(0, 0.62, 0), white, true);
    mb.addGeo(new T.BoxGeometry(1.64, 0.55, 2.2), placeM(0, 1.17, -0.1), glass, true);
    mb.addGeo(new T.BoxGeometry(1.5, 0.08, 2.0), placeM(0, 1.47, -0.1), white, true);
    [[-0.92, 1.4], [0.92, 1.4], [-0.92, -1.4], [0.92, -1.4]].forEach(([x, z]) => mb.addGeo(new T.CylinderGeometry(0.34, 0.34, 0.22, 8).rotateZ(Math.PI / 2), placeM(x, 0.34, z), dark, true));
    mb.addGeo(new T.BoxGeometry(1.5, 0.12, 0.06), placeM(0, 0.72, -2.17), C('#fff3c8'), true); // headlights
    mb.addGeo(new T.BoxGeometry(1.5, 0.12, 0.06), placeM(0, 0.72, 2.17), C('#a01818'), true);
    return mb.build();
  }

  /* ---------- sky / light palettes (keyed by sine of the sun elevation) ---------- */
  const SKY_KEYS = [
    { e: -0.32, top: '#0c1a3e', hor: '#22345f', hemiSky: '#4a62a0', hemiGnd: '#1a2030', hemiI: 1.15, sun: '#8899cc' },
    { e: -0.09, top: '#12214c', hor: '#2c3c6a', hemiSky: '#4a5f9a', hemiGnd: '#1c2230', hemiI: 1.15, sun: '#8899cc' },
    { e: -0.01, top: '#26356a', hor: '#8a5a62', hemiSky: '#6a6f98', hemiGnd: '#3a3238', hemiI: 0.9, sun: '#ff9a5a' },
    { e: 0.05, top: '#4468ab', hor: '#f0a66e', hemiSky: '#aeb9d2', hemiGnd: '#7a6a58', hemiI: 1.15, sun: '#ffb070' },
    { e: 0.2, top: '#4f88cf', hor: '#d6cdb9', hemiSky: '#cfe0f2', hemiGnd: '#8b8065', hemiI: 1.4, sun: '#ffe2b8' },
    { e: 0.6, top: '#3b82d8', hor: '#b3d1ec', hemiSky: '#dfeaf1', hemiGnd: '#8b8065', hemiI: 1.55, sun: '#fff2dc' },
    { e: 1.0, top: '#3b82d8', hor: '#b3d1ec', hemiSky: '#dfeaf1', hemiGnd: '#8b8065', hemiI: 1.55, sun: '#fff2dc' }
  ].map(k => ({ e: k.e, top: C(k.top), hor: C(k.hor), hemiSky: C(k.hemiSky), hemiGnd: C(k.hemiGnd), hemiI: k.hemiI, sun: C(k.sun) }));
  const WEATHER = {
    clear: { cloud: 0.5, dark: 0, vis: 3800, rain: 0, snow: 0, grey: C('#aab3ba'), snowCover: 0 },
    rain:  { cloud: 1.0, dark: 0.62, vis: 650, rain: 1, snow: 0, grey: C('#7d868c'), snowCover: 0 },
    fog:   { cloud: 0.85, dark: 0.3, vis: 200, rain: 0, snow: 0, grey: C('#bcc3c6'), snowCover: 0 },
    snow:  { cloud: 0.95, dark: 0.34, vis: 750, rain: 0, snow: 1, grey: C('#c3cbd1'), snowCover: 1 }
  };
  function sampleKeys(e) {
    let i = 0; while (i < SKY_KEYS.length - 2 && e > SKY_KEYS[i + 1].e) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1], t = clamp((e - a.e) / (b.e - a.e), 0, 1);
    return { top: mixColor(a.top, b.top, t), hor: mixColor(a.hor, b.hor, t), hemiSky: mixColor(a.hemiSky, b.hemiSky, t), hemiGnd: mixColor(a.hemiGnd, b.hemiGnd, t), hemiI: lerp(a.hemiI, b.hemiI, t), sun: mixColor(a.sun, b.sun, t) };
  }

  const SKY_VERT = `varying vec3 vDir; void main(){ vDir = position; mat4 mv = modelViewMatrix; mv[3] = vec4(0.0, 0.0, 0.0, 1.0); /* always centred on the eye: no translucent dome when a camera sits far from the sky mesh */ vec4 p = projectionMatrix * mv * vec4(position, 1.0); gl_Position = p.xyww; gl_Position.z = p.w * 0.99999; }`;
  const SKY_FRAG = `
    uniform vec3 uTop, uHor, uSunDir, uSunCol, uMoonDir, uCloudLit, uCloudDark; uniform float uNight, uCloud, uTime, uSunVis, uMoonVis, uGlow; uniform vec3 uGlowCol;
    varying vec3 vDir;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(uHor, uTop, smoothstep(0.0, 1.0, pow(clamp(h, 0.0, 1.0), 0.55)));
      if (h < 0.0) col = mix(uHor, uHor * 0.85, clamp(-h * 5.0, 0.0, 1.0));
      // distant city glow: a warm, low band that is stronger towards a few directions (towns), reflected a little by cloud
      if (uGlow > 0.001) {
        float az = atan(d.z, d.x);
        float dirK = 0.45 + 0.35 * sin(az * 2.0 + 0.9) + 0.2 * sin(az * 5.0 + 2.3);
        float band = exp(-max(h, 0.0) * 5.5) * (1.0 - smoothstep(-0.12, 0.0, -h) * 0.0);
        col += uGlowCol * band * dirK * uGlow * (1.0 + 0.6 * uCloud);
      }
      // stars
      if (h > 0.0 && uNight > 0.01) {
        vec3 q = d * 420.0; vec3 id = floor(q); float r = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float tw = smoothstep(0.9985, 1.0, r) * (0.55 + 0.45 * sin(uTime * 2.0 + r * 40.0));
        col += vec3(0.9, 0.95, 1.0) * tw * uNight * smoothstep(0.0, 0.15, h) * (1.0 - uCloud * 0.8);
      }
      float sd = max(dot(d, uSunDir), 0.0);
      col += uSunCol * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.4) * uSunVis;
      col += uSunCol * smoothstep(0.99955, 0.99985, sd) * 7.0 * uSunVis * (1.0 - uCloud * 0.55);
      float md = dot(d, uMoonDir);
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * 2.4 * uMoonVis * (1.0 - uCloud * 0.7) + vec3(0.35, 0.45, 0.75) * pow(max(md, 0.0), 36.0) * 0.18 * uMoonVis;
      if (h > 0.0) {
        vec2 p = d.xz / (h + 0.14) * 0.85 + vec2(uTime * 0.012, uTime * 0.005);
        float n = fbm(p * 1.5) + fbm(p * 0.45 + 3.0) * 0.28;
        float lo = 1.12 - uCloud * 0.85;
        float cov = smoothstep(lo, lo + 0.3, n);
        float n2 = fbm((p + uSunDir.xz * 0.07) * 1.5) + fbm((p + uSunDir.xz * 0.02) * 0.45 + 3.0) * 0.28;
        float lit = clamp(0.62 + (n - n2) * 4.5, 0.0, 1.0);
        vec3 cc = mix(uCloudDark, uCloudLit, lit);
        col = mix(col, cc, cov * smoothstep(0.0, 0.16, h) * 0.94);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  /* top-down "roof map" (see the occlusion block in create()): R+G = height of the highest surface above each 0.94 m cell, packed (0..120 m above uOccC.y - 60), A = something is there. 1 = this point lies under a roof. */
  const OCC_HALF = 60, OCC_SIZE = 128;
  const OCC_GLSL = `
    float roofAt(vec3 p){
      vec2 uv = vec2(0.5 + (p.x - uOccC.x) / ${(OCC_HALF * 2).toFixed(1)}, 0.5 - (p.z - uOccC.z) / ${(OCC_HALF * 2).toFixed(1)});
      vec4 oc = texture2D(uOcc, uv);
      float ceilY = uOccC.y - ${OCC_HALF.toFixed(1)} + (oc.x + oc.y / 255.0) * ${(OCC_HALF * 2).toFixed(1)};
      float inside = step(abs(p.x - uOccC.x), ${(OCC_HALF - 1).toFixed(1)}) * step(abs(p.z - uOccC.z), ${(OCC_HALF - 1).toFixed(1)});
      return inside * step(0.5, oc.a) * step(p.y, ceilY - 0.4);
    }`;
  const OCC_VERT = 'varying float vV; void main(){\n#include <begin_vertex>\n#include <project_vertex>\n vV = clamp((mvPosition.z + ' + (OCC_HALF * 2).toFixed(1) + ') / ' + (OCC_HALF * 2).toFixed(1) + ', 0.0, 1.0); }';
  const OCC_FRAG = 'varying float vV; void main(){ float s = vV * 255.0; gl_FragColor = vec4(floor(s) / 255.0, fract(s), 0.0, 1.0); }';
  const RAIN_VERT = `
    attribute vec4 aSeed; uniform vec3 uCam, uBox, uRel; uniform float uTime, uLen;
    uniform sampler2D uOcc; uniform vec3 uOccC;
    varying float vA;
    ${OCC_GLSL}
    void main(){
      vec3 p = aSeed.xyz * uBox + vec3(0.0, -13.0, 0.0) * uTime;
      p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
      float roof = roofAt(p);
      vec3 dir = normalize(uRel);
      p -= dir * aSeed.w * uLen;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      vA = (1.0 - aSeed.w * 0.9) * smoothstep(0.4, 3.0, -mv.z) * (1.0 - roof);
      gl_Position = projectionMatrix * mv;
    }`;
  const RAIN_FRAG = `uniform vec3 uCol; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uCol, uAlpha * vA); }`;
  const SNOW_VERT = `
    attribute vec4 aSeed; uniform vec3 uCam, uBox; uniform float uTime, uSize;
    uniform sampler2D uOcc; uniform vec3 uOccC;
    varying float vA;
    ${OCC_GLSL}
    void main(){
      vec3 p = aSeed.xyz * uBox + vec3(0.0, -1.4, 0.0) * uTime;
      p.x += sin(uTime * 0.7 + aSeed.w * 30.0) * 0.8; p.z += cos(uTime * 0.5 + aSeed.w * 20.0) * 0.8;
      p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
      float roof = roofAt(p);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_PointSize = clamp(uSize * (0.5 + aSeed.w) / max(-mv.z, 0.5), 1.0, 14.0);
      vA = smoothstep(0.3, 2.0, -mv.z) * (1.0 - roof);
      gl_Position = projectionMatrix * mv;
    }`;
  const SNOW_FRAG = `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, vA * smoothstep(0.5, 0.15, d) * 0.9); }`;

  /* snow cover on up-facing surfaces (shared uniform) */
  const SNOW_UNIFORM = { value: 0 };
  function withSnow(material, strength) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSnow = SNOW_UNIFORM;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nuniform float uSnow;')
        .replace('#include <color_fragment>', `#include <color_fragment>\n{ float up = smoothstep(0.35, 0.8, normalize(vWN).y); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow * up * ${strength.toFixed(2)}); }`);
    };
    return material;
  }

  /* ---------- biome palettes ---------- */
  const PAL = {
    city:       { g1: '#7d8a6a', g2: '#8c9778', rock: '#8a877d', trees: 0.02 },
    tramcity:   { g1: '#7d8a6a', g2: '#8c9778', rock: '#8a877d', trees: 0 },
    suburb:     { g1: '#6f9a48', g2: '#86ab52', rock: '#8a8576', trees: 0.5 },
    farmland:   { g1: '#6e9a45', g2: '#8aab4e', rock: '#8a8576', trees: 0.4 },
    forest:     { g1: '#4f7f38', g2: '#5f8f3d', rock: '#7d7a6c', trees: 1.0 },
    ardennes:   { g1: '#46703a', g2: '#587d40', rock: '#716f66', trees: 1.0 },
    vineyard:   { g1: '#74993f', g2: '#8ca44a', rock: '#9a9176', trees: 0.25 },
    river:      { g1: '#6a9a47', g2: '#7ea84f', rock: '#8a8576', trees: 0.55 },
    industrial: { g1: '#8a6a52', g2: '#7a604c', rock: '#6f5f52', trees: 0.12 },
    highspeed:  { g1: '#8ea24c', g2: '#a8ab52', rock: '#8a8576', trees: 0.12 }
  };
  Object.keys(PAL).forEach(k => { PAL[k].g1 = C(PAL[k].g1); PAL[k].g2 = C(PAL[k].g2); PAL[k].rock = C(PAL[k].rock); });
  const DRY = C('#a39a55');
  const PAVED = C('#74726d');
  const COL = { bed: C('#6a655c'), asphalt: C('#4d5154'), side: C('#aaa69b'), yard: C('#7c7870'), mud: C('#8c7f66'), sand: C('#b6a784'), red: C('#7d5242'), dark: C('#4a4540'), slag: C('#3b3a3a') };
  const FIELD_KINDS = {
    rowsGold: { tex: 'rows', tint: ['#d9c374', '#cdb468', '#e2cf80'] }, rowsGreen: { tex: 'rows', tint: ['#7da64a', '#6c9a42', '#8fb04c'] },
    rowsBrown: { tex: 'rows', tint: ['#7b6046', '#6d5640', '#85694e'] }, rowsRape: { tex: 'rows', tint: ['#e3d44c', '#dccb40'] },
    meadow: { tex: 'grass', tint: ['#78a845', '#8ab552', '#6c9c40', '#93bb58'] }, vines: { tex: 'vines', tint: ['#ffffff'] }
  };

  function create(scene, track, opts) {
    const quality = opts && QUALITY[opts.quality] ? opts.quality : 'medium';
    const Q = QUALITY[quality];
    const L = track.length, seedBase = hashString(String(track.id || 'route'));
    const riverSide = (seedBase & 1) ? 1 : -1;
    const root = new T.Group(); root.name = 'landscape'; scene.add(root);
    const chunks = new Map();
    let disposed = false, timeOfDay = 12, weatherName = 'clear', elapsed = 0, firstUpdate = true;
    const W = Q.strip, latHalf = LAT_OFFSETS.filter(v => v < W - 1); latHalf.push(W);
    const PORTAL_HOLE = 9;   // m each side of the track: the hole in the ground's cliff face at a portal (the portal wall in infra.js is wide enough to hide it)
    const LAT = [...latHalf.slice(1).reverse().map(v => -v), ...latHalf];

    /* --- track helpers --- */
    const frameCache = new Map();
    function frame(s) {
      const key = Math.round(s * 2);
      let f = frameCache.get(key); if (f) return f;
      const sc = clamp(s, 0, L), r = track.frameAt(sc);
      let tx = r.tangent.x, tz = r.tangent.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      f = { s, x: r.pos.x + (s - sc) * tx, y: r.pos.y, z: r.pos.z + (s - sc) * tz, tx, tz, rx: -tz, rz: tx };
      if (frameCache.size > 30000) frameCache.clear();
      frameCache.set(key, f); return f;
    }
    const biomeAt = s => { try { return track.biomeAt(clamp(s, 0, L)) || 'farmland'; } catch (e) { return 'farmland'; } };
    const terrainH = (x, z) => { const h = track.terrainHeightAt ? track.terrainHeightAt(x, z) : 0; return Number.isFinite(h) ? h : 0; };
    const tunnels = (track.tunnels || []).slice(), bridges = (track.bridges || []).slice(), stations = (track.stations || []).slice();
    const nearStation = (s, m) => stations.some(st => s > (st.platformStart !== undefined ? Math.min(st.platformStart, st.s) : st.s - 100) - m && s < (st.platformEnd !== undefined ? Math.max(st.platformEnd, st.s) : st.s + 100) + m);
    const inTunnel = (s, m) => tunnels.some(t => s > t.s0 - (m || 0) && s < t.s1 + (m || 0));
    const BRIDGE_DEPTH = { viaduct: 15, steel: 7, river: 9 };
    const riverBridgeAt = (s, m) => bridges.some(b => b.waterY !== null && b.waterY !== undefined && s > b.s0 - m && s < b.s1 + m);
    const inBridge = (s, m) => bridges.some(b => s > b.s0 - (m || 0) && s < b.s1 + (m || 0));

    /* distance-to-track field (segments in a 200 m hash grid) for the far terrain */
    let distGrid = null;
    function buildDistGrid() {
      const step = 25, pts = []; for (let s = 0; s <= L + 1; s += step) { const f = frame(s); pts.push([f.x, f.z]); }
      const grid = new Map(), cell = 200, add = (cx, cz, i) => { const k = cx * 100003 + cz; let a = grid.get(k); if (!a) grid.set(k, a = []); if (a[a.length - 1] !== i) a.push(i); };
      for (let i = 0; i < pts.length - 1; i++) {
        for (let t = 0; t <= 1; t += 0.5) { const x = lerp(pts[i][0], pts[i + 1][0], t), z = lerp(pts[i][1], pts[i + 1][1], t); add(Math.floor(x / cell), Math.floor(z / cell), i); }
      }
      distGrid = { pts, grid, cell };
    }
    function distToTrack(x, z) {
      if (typeof track.distanceToTrack === 'function') { try { const d = track.distanceToTrack(x, z); if (Number.isFinite(d)) return d; } catch (e) { /* fall back */ } }
      if (!distGrid) buildDistGrid();
      const { pts, grid, cell } = distGrid, cx = Math.floor(x / cell), cz = Math.floor(z / cell); let best = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const list = grid.get((cx + a) * 100003 + cz + b); if (!list) continue;
        for (const i of list) {
          const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1], dx = bx - ax, dz = bz - az;
          const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = ax + dx * t - x, ez = az + dz * t - z;
          best = Math.min(best, ex * ex + ez * ez);
        }
      }
      return Math.sqrt(best);
    }

    /* --- per-row info: everything that depends on s only --- */
    const rowCache = new Map();
    function rowInfo(s) {
      const key = Math.round(s / 5); let r = rowCache.get(key); if (r) return r;
      const f = frame(s), biome = biomeAt(s), wat = track.water ? track.water(clamp(s, 0, L)) : null;
      r = { s, f, biome, wat, form: f.y - (track.formationDrop || 0.45) };
      rowCache.set(key, r); return r;
    }
    // A1's terrainHeightAt already shapes formation, cuttings, tunnel covers, bridge valleys and the river bed.
    const riverBridges = bridges.filter(b => b.waterY !== null && b.waterY !== undefined);
    function groundY(info, lat, x, z, sExact) {
      let h = terrainH(x, z);
      if (riverBridges.length) { // cut a river channel through the meadow under a river viaduct (A1 only digs a bowl)
        const s = sExact === undefined ? info.s : sExact;
        for (const b of riverBridges) {
          const du = Math.abs(s - (b.s0 + b.s1) / 2); if (du > 90) continue;
          const hw = Math.min(8 + (b.s1 - b.s0) * 0.1, (b.s1 - b.s0) / 2 + 3);
          const c = (1 - smooth(hw, hw + 16, du)) * (1 - smooth(70, 125, Math.abs(lat)));
          if (c > 0) h = lerp(h, Math.min(h, b.waterY - 1.5), c);
        }
      }
      return h;
    }
    const riverLat = w => w.side * w.offset;
    const worldAt = (info, lat) => ({ x: info.f.x + info.f.rx * lat, z: info.f.z + info.f.rz * lat });
    const yawOf = f => Math.atan2(-f.tz, f.tx);

    function groundColor(info, x, z, nY, lat, h) {
      const pal = PAL[info.biome] || PAL.farmland, a = Math.abs(lat);
      const c = mixColor(pal.g1, pal.g2, fbm(x * 0.008, z * 0.008));
      const dry = smooth(0.52, 0.78, fbm(x * 0.017 + 11, z * 0.017 - 4));
      if (dry > 0 && info.biome !== 'industrial') c.lerp(DRY, dry * 0.55);
      const b = 0.8 + 0.2 * vnoise(x * 0.09, z * 0.09) + 0.22 * (fbm(x * 0.035, z * 0.035) - 0.5) + 0.12 * vnoise(x * 0.4, z * 0.4);
      const rock = smooth(0.1, 0.34, 1 - nY);
      if (rock > 0) c.lerp(pal.rock, rock * 0.85);
      if (info.biome === 'industrial') { c.lerp(COL.red, 0.3 + 0.4 * fbm(x * 0.02, z * 0.02)).lerp(COL.dark, 0.5 * smooth(0.5, 0.75, fbm(x * 0.03 + 9, z * 0.03))); c.lerp(COL.slag, 0.55 * smooth(0.55, 0.8, fbm(x * 0.045 - 5, z * 0.045 + 2))); }
      if (info.wat) { const dd = Math.abs(lat - riverLat(info.wat)), m = 1 - smooth(info.wat.halfWidth + 2, info.wat.halfWidth + 16, dd); if (m > 0) c.lerp(h < info.wat.y + 0.4 ? COL.mud : COL.sand, m * 0.85); }
      if (info.biome === 'tramcity') { c.lerp(COL.yard, 0.9); if (a < 9.4) c.lerp(COL.asphalt, smooth(9.6, 8.6, a)); else if (a < 13.2) c.lerp(COL.side, smooth(9.2, 9.9, a) * smooth(13.4, 12.5, a)); }
      else if (info.biome === 'city') { if (a < 25) c.lerp(COL.yard, smooth(26, 20, a) * 0.95); if (a > 21 && a < 25) c.lerp(COL.side, 0.35); }
      c.multiplyScalar(b);
      if (info.biome === 'tramcity') { if (a < 3.4) c.lerp(PAVED, smooth(4.2, 3.0, a)); }
      else if (a < 6.5) c.lerp(COL.bed, smooth(6.5, 3.4, a));
      return c;
    }

    /* --- shared materials --- */
    const facadeHouse = makeFacade('fH', 256, 2, 'house'), facadeBlock = makeFacade('fB', 512, 4, 'block');
    const matTerrain = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texGrass() }), 1);
    const matFieldRows = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texRows(), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }), 0.9);
    const matFieldVines = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texVines(), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }), 0.7);
    const matFieldMeadow = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texGrass(), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }), 0.95);
    const matHouse = new T.MeshLambertMaterial({ vertexColors: true, map: facadeHouse.day, emissive: new T.Color('#ffffff'), emissiveMap: facadeHouse.lit, emissiveIntensity: 0 });
    const matBlock = new T.MeshLambertMaterial({ vertexColors: true, map: facadeBlock.day, emissive: new T.Color('#ffffff'), emissiveMap: facadeBlock.lit, emissiveIntensity: 0 });
    const matRoof = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texSlate(), side: T.DoubleSide }), 0.95);
    const matRoad = new T.MeshLambertMaterial({ vertexColors: true, map: texAsphalt(), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -3 });
    const matLeaf = withSnow(new T.MeshLambertMaterial({ vertexColors: true }), 0.55);
    const matCar = new T.MeshLambertMaterial({ vertexColors: true });
    const matLamp = new T.MeshBasicMaterial({ color: '#9a9a96' });
    const matSmoke = new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
    const waterNormal = texWaterNormal(); waterNormal.repeat.set(1, 1);
    const matWater = new T.MeshPhongMaterial({ side: T.DoubleSide, color: '#2c5a63', specular: '#ffffff', shininess: 90, normalMap: waterNormal, normalScale: new T.Vector2(0.55, 0.55), transparent: true, opacity: 0.86, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
    const matFar = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texGrass() }), 1);
    const mats = [matLamp, matSmoke, matTerrain, matFieldRows, matFieldVines, matFieldMeadow, matHouse, matBlock, matRoof, matRoad, matLeaf, matCar, matWater, matFar];
    const treeKit = buildTreeKit(), carGeo = buildCarGeo();

    /* --- shared grid mesher (draped quads with smooth normals) --- */
    function addGrid(mb, grid, uvFn, colorFn, lift) {
      const nA = grid.length, nB = grid[0].length, base = mb.count, n = new T.Vector3(), u = new T.Vector3(), v = new T.Vector3();
      for (let a = 0; a < nA; a++) for (let b = 0; b < nB; b++) {
        const p = grid[a][b], pa0 = grid[Math.max(a - 1, 0)][b], pa1 = grid[Math.min(a + 1, nA - 1)][b], pb0 = grid[a][Math.max(b - 1, 0)], pb1 = grid[a][Math.min(b + 1, nB - 1)];
        u.set(pa1.x - pa0.x, pa1.y - pa0.y, pa1.z - pa0.z); v.set(pb1.x - pb0.x, pb1.y - pb0.y, pb1.z - pb0.z);
        n.crossVectors(v, u).normalize(); if (n.y < 0) n.negate();
        const col = colorFn(p, a, b, n), uv = uvFn(p, a, b);
        mb.p.push(p.x, p.y + (lift || 0), p.z); mb.n.push(n.x, n.y, n.z); mb.c.push(col.r, col.g, col.b); mb.u.push(uv[0], uv[1]);
      }
      for (let a = 0; a < nA - 1; a++) for (let b = 0; b < nB - 1; b++) {
        const i0 = base + a * nB + b, i1 = i0 + 1, i2 = i0 + nB, i3 = i2 + 1;
        mb.i.push(i0, i1, i2, i1, i3, i2);
      }
    }

    /* ================= chunk construction ================= */
    const roadsAll = new Map();   // chunk index -> [{ pts:[{x,y,z}], cum:[], len }]
    const turbines = [];          // { mesh, speed }
    const waterMeshes = [];

    function terrainMesh(k, s0) {
      const step = Q.rowStep, nRow = Math.round(CHUNK / step), grid = [];
      /* extra rows at every tunnel portal (the ground steps up to the tunnel cover exactly at s0 / s1): without them the triangles between two regular rows would
         slope through the first metres of the bore */
      const rowS = [];
      for (let j = -1; j <= nRow + 1; j++) rowS.push(s0 + j * step);
      if (track.kind !== 'tram') for (const tn of tunnels) for (const ps of [tn.s0, tn.s1]) {
        if (ps >= s0 - 0.5 && ps <= s0 + CHUNK + 0.5) rowS.push(ps - 0.3, ps + 0.3);
      }
      rowS.sort((p, q) => p - q);
      const portalPad = new Set();   // the pad rows of a portal pair: the quads between them (the ground's cliff face at the mouth) get a hole so the bore stays open
      if (track.kind !== 'tram') for (const tn of tunnels) for (const ps of [tn.s0, tn.s1]) if (ps >= s0 - 0.5 && ps <= s0 + CHUNK + 0.5) for (let a = 0; a + 2 < rowS.length; a++) if (rowS[a + 1] >= ps - 0.3 - 1e-6 && rowS[a + 2] <= ps + 0.3 + 1e-6) portalPad.add(a);
      for (let jj = 0; jj < rowS.length; jj++) {
        const s = rowS[jj], info = rowInfo(s), f = frame(s), row = [];
        for (let i = 0; i < LAT.length; i++) {
          const lat = LAT[i], x = f.x + f.rx * lat, z = f.z + f.rz * lat;
          row.push({ x, z, y: groundY(info, lat, x, z, s), lat, info });
        }
        grid.push(row);
      }
      const mb = new MB(), inner = grid.slice(1, grid.length - 1), nB = LAT.length;
      // use the padded rows for normals: build a grid with one extra row on each side, then drop them
      const full = grid;
      const nA = full.length, base = mb.count, n = new T.Vector3(), u = new T.Vector3(), v = new T.Vector3();
      for (let a = 1; a < nA - 1; a++) for (let b = 0; b < nB; b++) {
        const p = full[a][b], a0 = full[a - 1][b], a1 = full[a + 1][b], b0 = full[a][Math.max(b - 1, 0)], b1 = full[a][Math.min(b + 1, nB - 1)];
        u.set(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z); v.set(b1.x - b0.x, b1.y - b0.y, b1.z - b0.z);
        n.crossVectors(v, u).normalize(); if (n.y < 0) n.negate();
        const col = groundColor(p.info, p.x, p.z, n.y, p.lat, p.y);
        mb.p.push(p.x, p.y, p.z); mb.n.push(n.x, n.y, n.z); mb.c.push(col.r, col.g, col.b); mb.u.push(p.x / 7, p.z / 7);
      }
      const nR = nA - 2;
      for (let a = 0; a < nR - 1; a++) for (let b = 0; b < nB - 1; b++) {
        if (portalPad.has(a) && Math.abs(LAT[b]) <= PORTAL_HOLE && Math.abs(LAT[b + 1]) <= PORTAL_HOLE) continue;
        const i0 = base + a * nB + b, i1 = i0 + 1, i2 = i0 + nB, i3 = i2 + 1;
        mb.i.push(i0, i1, i2, i1, i3, i2);
      }
      // skirts on both lateral edges
      for (const edge of [0, nB - 1]) {
        const sb = mb.count;
        for (let a = 0; a < nR; a++) {
          const idx = base + a * nB + edge;
          mb.p.push(mb.p[idx * 3], mb.p[idx * 3 + 1] - 6, mb.p[idx * 3 + 2]); mb.n.push(0, 1, 0); mb.c.push(mb.c[idx * 3], mb.c[idx * 3 + 1], mb.c[idx * 3 + 2]); mb.u.push(mb.u[idx * 2], mb.u[idx * 2 + 1]);
        }
        for (let a = 0; a < nR - 1; a++) { const t0 = base + a * nB + edge, t1 = base + (a + 1) * nB + edge, b0 = sb + a, b1 = sb + a + 1; mb.i.push(t0, b0, t1, t1, b0, b1); }
      }
      void inner;
      return mb;
    }

    function ribbonMesh(mb, pointsFn, sA, sB, halfW, lift, tileV) {
      const pts = [], step = 8, n = Math.max(2, Math.ceil((sB - sA) / step)), grid = [];
      let dist = 0, last = null;
      for (let a = 0; a <= n; a++) {
        const s = lerp(sA, sB, a / n), p = pointsFn(s), info = rowInfo(s), f = info.f;
        const q = pointsFn(s + 2), dx = q.x - p.x, dz = q.z - p.z, dl = Math.hypot(dx, dz) || 1, px = -dz / dl, pz = dx / dl;
        const left = { x: p.x - px * halfW, z: p.z - pz * halfW }, right = { x: p.x + px * halfW, z: p.z + pz * halfW };
        const lat = (p.x - f.x) * f.rx + (p.z - f.z) * f.rz;
        left.y = groundY(info, lat - halfW, left.x, left.z); right.y = groundY(info, lat + halfW, right.x, right.z); left.lat = lat - halfW; right.lat = lat + halfW;
        const cy = groundY(info, lat, p.x, p.z);
        if (last) dist += Math.hypot(p.x - last.x, p.z - last.z); last = p;
        grid.push([left, { x: p.x, z: p.z, y: cy, lat }, right]); pts.push({ x: p.x, y: cy + 0.1, z: p.z, d: dist });
      }
      grid.forEach((row, a) => row.forEach((p, b) => { p.d = pts[a].d; }));
      const white = C('#ffffff');
      addGrid(mb, grid, (p, a, b) => [b / 2, p.d / (tileV || 8)], () => white, lift === undefined ? 0.07 : lift);
      return pts;
    }

    function makeWater(mb, sA, sB, centerFn, hwFn, levelFn) {
      const n = Math.max(2, Math.ceil((sB - sA) / 10)), base = mb.count; let dist = 0;
      for (let a = 0; a <= n; a++) {
        const s = lerp(sA, sB, a / n), c = centerFn(s), hw = hwFn(s), y = levelFn(s), info = rowInfo(s);
        dist = s - sA;
        for (const sd of [-1, 1]) {
          const lat = c + sd * hw, w = worldAt(info, lat);
          mb.p.push(w.x, y, w.z); mb.n.push(0, 1, 0); mb.c.push(1, 1, 1); mb.u.push(sd < 0 ? 0 : hw / 6, dist / 6);
        }
      }
      for (let a = 0; a < n; a++) { const i0 = base + a * 2; mb.i.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); }
    }

    const VILLAGE_P = { suburb: 0.8, farmland: 0.3, vineyard: 0.5, river: 0.4, ardennes: 0.2, forest: 0.07, highspeed: 0.04 };
    const FIELD_P = { farmland: 0.9, highspeed: 0.95, suburb: 0.4, vineyard: 0.8, river: 0.55, forest: 0.04, ardennes: 0.16 };
    const SPECIES = {
      ardennes: [['spruce', 0.55], ['beech', 0.2], ['oak', 0.1], ['birch', 0.1], ['bush', 0.05]],
      forest: [['oak', 0.3], ['beech', 0.28], ['spruce', 0.18], ['birch', 0.12], ['bush', 0.12]],
      river: [['poplar', 0.35], ['oak', 0.25], ['birch', 0.15], ['bush', 0.25]],
      vineyard: [['oak', 0.3], ['bush', 0.45], ['birch', 0.15], ['poplar', 0.1]],
      highspeed: [['poplar', 0.4], ['oak', 0.3], ['bush', 0.3]],
      industrial: [['birch', 0.4], ['bush', 0.5], ['poplar', 0.1]],
      city: [['birch', 0.6], ['beech', 0.4]], tramcity: [['birch', 0.6], ['beech', 0.4]],
      def: [['oak', 0.35], ['beech', 0.2], ['birch', 0.12], ['poplar', 0.08], ['bush', 0.25]]
    };
    function pickSpecies(biome, r) {
      const tab = SPECIES[biome] || SPECIES.def; let acc = 0;
      for (const [name, p] of tab) { acc += p; if (r <= acc) return name; }
      return tab[0][0];
    }
    const SPECIES_SCALE = { oak: [0.7, 1.25], beech: [0.75, 1.3], birch: [0.7, 1.15], spruce: [0.8, 1.6], poplar: [0.8, 1.4], bush: [0.6, 1.3] };

    function buildChunk(k) {
      const s0 = k * CHUNK, s1 = s0 + CHUNK, sMid = s0 + CHUNK / 2, rng = mulberry((seedBase ^ Math.imul(k + 1000, 2654435761)) >>> 0);
      const group = new T.Group(); group.name = 'ls-chunk-' + k;
      const occ = [], woods = [], chunkRoads = [];
      const isOcc = (sa, sb, la, lb) => occ.some(o => sa < o.s1 && sb > o.s0 && Math.min(la, lb) < o.l1 && Math.max(la, lb) > o.l0);
      const markOcc = (sa, sb, la, lb) => occ.push({ s0: sa, s1: sb, l0: Math.min(la, lb), l1: Math.max(la, lb) });
      const mbHouse = new MB(), mbBlock = new MB(), mbRoof = new MB(true), mbRoad = new MB(), mbWater = new MB(), mbSmoke = new MB();
      const fieldMB = { rows: new MB(), vines: new MB(), meadow: new MB() };
      const trees = { oak: [], beech: [], birch: [], spruce: [], poplar: [], bush: [], tuft: [], cow: [], sheep: [], lampPole: [], lampHead: [] };
      const bMid = biomeAt(sMid), bStart = biomeAt(s0 + 5), bEnd = biomeAt(s1 - 5);
      const place = (s, lat) => { const f = frame(s), info = rowInfo(s), x = f.x + f.rx * lat, z = f.z + f.rz * lat; return { f, info, x, z, y: groundY(info, lat, x, z) }; };
      const r3 = r => { const c = r() < 0.15 ? C('#f2e2a0') : C('#ffffff'); return c.multiplyScalar(0.75 + r() * 0.4); };
      const addTree = (name, x, y, z, sc, r) => {
        const tint = r() < 0.12 ? C('#e6e4a8') : C('#ffffff'); tint.multiplyScalar(0.82 + r() * 0.32);
        trees[name].push({ x, y, z, rot: r() * 6.28, sc, tint });
      };
      const addRoadRibbon = (latFn, sa, sb, hw) => {
        const pts = ribbonMesh(mbRoad, s => { const f = frame(s), l = latFn(s); return { x: f.x + f.rx * l, z: f.z + f.rz * l }; }, sa, sb, hw);
        let len = 0; const cum = [0]; for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cum.push(len); }
        chunkRoads.push({ pts, cum, len, hw, city: false });
        return chunkRoads[chunkRoads.length - 1];
      };

      /* ---- villages ---- */
      const vp = (VILLAGE_P[bMid] || 0) * Q.houses;
      if (vp > 0 && rng() < vp && !inTunnel(sMid, 140) && !inBridge(sMid, 140)) {
        const side = rng() < 0.5 ? -1 : 1, L0 = 30 + rng() * 14, sC = sMid + (rng() - 0.5) * 60, half = 55 + rng() * 45;
        addRoadRibbon(() => side * L0, sC - half - 14, sC + half + 14, 3.3).city = true;
        markOcc(sC - half - 16, sC + half + 16, side * (L0 - 18), side * (L0 + 32));
        let churchDone = false;
        for (let ds = -half; ds <= half; ds += 13 + rng() * 9) {
          for (const row of [-1, 1]) {
            if (rng() < 0.16) continue;
            const s = sC + ds + rng() * 3, lat = side * (L0 + row * (9.5 + rng() * 3));
            const wantChurch = !churchDone && row === 1 && Math.abs(ds) < half * 0.5 && rng() < 0.35;
            const p = place(s, lat);
            if (inTunnel(s, 30) || inBridge(s, 40)) continue;
            const facing = (row === -1 ? side : -side), yaw = yawOf(p.f) + (facing > 0 ? 0 : Math.PI), M0 = placeM(p.x, p.y - 0.1, p.z, yaw);
            if (wantChurch) { churchDone = true; addChurch(mbHouse, mbRoof, M0, rng); }
            else addHouse(mbHouse, mbRoof, M0, rng, {});
          }
        }
        // cross lane with a few extra garden-side houses
      }

      /* ---- lone farms ---- */
      if (['farmland', 'highspeed', 'ardennes', 'forest', 'vineyard'].includes(bMid) && rng() < 0.32 * Q.houses && !inTunnel(sMid, 120) && !inBridge(sMid, 120)) {
        const side = rng() < 0.5 ? -1 : 1, sF = sMid + (rng() - 0.5) * 100, lF = side * (42 + rng() * 40);
        if (!isOcc(sF - 30, sF + 30, lF - 22, lF + 22)) {
          const p = place(sF, lF), yaw = yawOf(p.f) + (side > 0 ? Math.PI : 0), cs = Math.cos(yaw), sn = Math.sin(yaw);
          const at = (dx, dz) => placeM(p.x + cs * dx + sn * dz, groundY(p.info, lF, p.x + cs * dx + sn * dz, p.z - sn * dx + cs * dz) - 0.1, p.z - sn * dx + cs * dz, yaw);
          addHouse(mbHouse, mbRoof, at(0, 0), rng, { w: 12, d: 8, floors: 2, annex: false });
          addBarn(mbBlock, mbRoof, at(-4, -16), rng, 20, 11, 6.5);
          const sx = 10, sz = -14, sy = groundY(p.info, lF, p.x + cs * sx + sn * sz, p.z - sn * sx + cs * sz);
          mbBlock.addGeo(new T.CylinderGeometry(2.2, 2.2, 11, 12), placeM(p.x + cs * sx + sn * sz, sy + 5.3, p.z - sn * sx + cs * sz), C('#b9bcbc'), true);
          mbBlock.addGeo(new T.ConeGeometry(2.3, 1.6, 12), placeM(p.x + cs * sx + sn * sz, sy + 11.8, p.z - sn * sx + cs * sz), C('#7f8588'), true);
          markOcc(sF - 32, sF + 32, lF - 26, lF + 26);
        }
      }

      /* ---- city blocks ---- */
      const cityBiomes = bMid === 'city' || bMid === 'tramcity';
      if (cityBiomes && !track.ownScenery) { // LUXTRAM: routes with ownScenery draw their own city (luxtram-world.js)
        const tram = bMid === 'tramcity';
        for (const side of [-1, 1]) {
          const rows = tram ? [{ l: 14.5, dep: 14, fl: [3, 7] }, { l: 40, dep: 18, fl: [5, 10] }] : [{ l: 25, dep: 18, fl: [4, 9] }, { l: 62, dep: 20, fl: [6, 12] }];
          rows.forEach((rw, ri) => {
            let s = s0 + rng() * 4, count = 0;
            while (s < s1 - 12) {
              const widths = [12, 15, 18, 21, 24, 30].filter(w => s + w <= s1 - 1);
              if (!widths.length) break;
              const w = pick(rng, widths), dep = rw.dep + (rng() - 0.5) * 5, sm = s + w / 2;
              const floors = rw.fl[0] + Math.floor(rng() * (rw.fl[1] - rw.fl[0] + 1)), l = side * (rw.l + dep / 2);
              if (!inTunnel(sm, 30) && !inBridge(sm, 40) && !nearStationBlock(sm, rw.l)) {
                const p = place(sm, l), yaw = yawOf(p.f), M0 = placeM(p.x, p.y - 0.1, p.z, yaw);
                const tint = ri === 1 && rng() < 0.3 ? C('#9fb2bd') : pick(rng, CITY_TINTS);
                addBlock(mbBlock, mbRoof, M0, rng, { w, d: dep, floors, roof: rng() < 0.55 ? 'mansard' : 'flat', tint });
              }
              s += w; count++;
              if (count % (tram ? 4 : 3) === 0) s += 10 + rng() * 4;
            }
          });
          markOcc(s0, s1, side * 8, side * 90);
          for (let s = s0 + 8; s < s1; s += 26) { // street lamps (arm points to the street)
            const lat = tram ? side * 12.8 : side * 17.2, p = place(s, lat), yaw = yawOf(p.f) + (side > 0 ? 0 : Math.PI) + (tram ? Math.PI : 0);
            const item = { x: p.x, y: p.y, z: p.z, rot: yaw, sc: 1, tint: C('#ffffff') };
            trees.lampPole.push(item); trees.lampHead.push(item);
          }
          // street trees
          if (tram) for (let s = s0 + 5; s < s1; s += 14) { if (rng() < 0.7 && !nearStation(s, 20)) { const p = place(s, side * 11), r = rng; addTree(rng() < 0.5 ? 'birch' : 'beech', p.x, p.y, p.z, 0.8 + r() * 0.3, r); } }
          else {
            addRoadRibbon(() => side * 19.5, s0, s1, 3.4).city = true;
            addRoadRibbon(() => side * (rows[0].l + rows[0].dep + 7), s0, s1, 3.2).city = true;
          }
        }
        if (tram) for (const side of [-1, 1]) { const r = addRoadRibbon(() => side * 6.4, s0, s1, 2.2); r.city = true; r.lane = true; }
      }
      function nearStationBlock(s, l) { return l < 20 && nearStation(s, 6) && !tramLike(); }
      function tramLike() { return bMid === 'tramcity'; }

      /* ---- industry ---- */
      if (bMid === 'industrial') {
        const side = rng() < 0.5 ? -1 : 1;
        if (hash2(k, seedBase & 255) < 0.34 && !inTunnel(sMid, 80)) {
          const p = place(sMid + (rng() - 0.5) * 60, side * (88 + rng() * 25));
          addFurnace(mbBlock, placeM(p.x, p.y - 1, p.z, yawOf(p.f) + rng()), rng, mbSmoke);
          markOcc(sMid - 60, sMid + 60, side * 60, side * 160);
        }
        for (let n = 0; n < 5; n++) {
          const s = s0 + 15 + rng() * (CHUNK - 30), lat = (rng() < 0.5 ? -1 : 1) * (26 + rng() * 48), w = 14 + rng() * 22, d = 10 + rng() * 14;
          if (isOcc(s - w / 2, s + w / 2, lat - d / 2, lat + d / 2) || inTunnel(s, 40) || inBridge(s, 50)) continue;
          const p = place(s, lat); addShed(mbBlock, mbRoof, placeM(p.x, p.y - 0.1, p.z, yawOf(p.f)), rng, w, d, 7 + rng() * 6);
          markOcc(s - w / 2 - 2, s + w / 2 + 2, lat - d / 2 - 2, lat + d / 2 + 2);
        }
        const BOXCOL = ['#a8442f', '#2f5d8c', '#c9a23a', '#4f7a4a', '#8a8f94', '#d1d1cc', '#7a2f2f'].map(C);
        for (let n = 0; n < 3; n++) { // container stacks + ore piles
          const s = s0 + 20 + rng() * (CHUNK - 40), lat = (rng() < 0.5 ? -1 : 1) * (20 + rng() * 30);
          if (isOcc(s - 8, s + 8, lat - 5, lat + 5) || inTunnel(s, 40) || inBridge(s, 50) || nearStation(s, 30)) continue;
          const p = place(s, lat), yaw = yawOf(p.f);
          if (rng() < 0.6) {
            for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const lv = 1 + Math.floor(rng() * 3); for (let h = 0; h < lv; h++) mbBlock.addGeo(new T.BoxGeometry(6, 2.5, 2.4), placeM(p.x + Math.cos(yaw) * i * 6.2 - Math.sin(yaw) * j * 2.6, p.y + 1.25 + h * 2.5, p.z - Math.sin(yaw) * i * 6.2 - Math.cos(yaw) * j * 2.6, yaw), pick(rng, BOXCOL), true); }
          } else mbBlock.addGeo(new T.ConeGeometry(7 + rng() * 4, 6 + rng() * 3, 9), placeM(p.x, p.y + 2.8, p.z), pick(rng, [C('#5a3b2e'), C('#2f2d2c'), C('#7d5a40')]), true);
          markOcc(s - 8, s + 8, lat - 7, lat + 7);
        }
        for (let n = 0; n < 2; n++) { // silos / tanks
          const s = s0 + 20 + rng() * (CHUNK - 40), lat = (rng() < 0.5 ? -1 : 1) * (34 + rng() * 40);
          if (isOcc(s - 6, s + 6, lat - 6, lat + 6) || inTunnel(s, 40) || inBridge(s, 50)) continue;
          const p = place(s, lat), h = 12 + rng() * 14;
          mbBlock.addGeo(new T.CylinderGeometry(4.5, 4.5, h, 12), placeM(p.x, p.y + h / 2 - 0.2, p.z), C('#a9adb0'), true);
          mbBlock.addGeo(new T.ConeGeometry(4.6, 2.2, 12), placeM(p.x, p.y + h + 1, p.z), C('#7d8286'), true);
          markOcc(s - 6, s + 6, lat - 6, lat + 6);
        }
      }

      /* ---- Clervaux castle (north line, near the end) ---- */
      if (String(track.id) === 'north' && L - 560 >= s0 && L - 560 < s1) {
        const side = 1, p = place(L - 560, side * 120);
        const hill = new T.CylinderGeometry(30, 46, 46, 14);
        mbHouse.addGeo(hill, placeM(p.x, p.y - 10, p.z), (v, n) => mixColor(C('#6a7d4a'), C('#8b8a7c'), clamp(0.2 + (1 - n.y) * 1.6, 0, 1)), true);
        addCastle(mbHouse, mbRoof, placeM(p.x, p.y + 12.5, p.z, yawOf(p.f)));
        markOcc(L - 600, L - 520, 70, 175);
      }

      /* ---- wind turbines ---- */
      const tp = bMid === 'highspeed' ? 0.65 : bMid === 'farmland' ? 0.08 : 0;
      const turbineSpots = [];
      if (tp > 0 && rng() < tp) {
        const n = 1 + Math.floor(rng() * 2);
        for (let t = 0; t < n; t++) turbineSpots.push({ s: s0 + 20 + rng() * (CHUNK - 40), lat: (rng() < 0.5 ? -1 : 1) * (170 + rng() * 260) });
      }

      /* ---- woodlots & fields ---- */
      const wild = bMid === 'forest' || bMid === 'ardennes';
      if (!cityBiomes && bMid !== 'industrial' && !wild) {
        const nWood = Math.floor(rng() * 2.2);
        for (let n = 0; n < nWood; n++) {
          const side = rng() < 0.5 ? -1 : 1, sa = s0 + rng() * (CHUNK - 70), la = 22 + rng() * 60, w = { s0: sa, s1: sa + 40 + rng() * 70, l0: side * la, l1: side * (la + 25 + rng() * 45) };
          w.l0 = Math.min(w.l0, w.l1) === w.l0 ? w.l0 : w.l1;
          const lo = Math.min(side * la, w.l1), hi = Math.max(side * la, w.l1);
          if (!isOcc(w.s0, w.s1, lo, hi)) { woods.push({ s0: w.s0, s1: w.s1, l0: lo, l1: hi }); markOcc(w.s0, w.s1, lo, hi); }
        }
      }
      const fieldP = (FIELD_P[bMid] === undefined ? 0 : FIELD_P[bMid]) * (quality === 'low' ? 0.8 : 1);
      if (fieldP > 0) {
        for (const side of [-1, 1]) {
          let sCur = s0 + rng() * 15;
          while (sCur < s1 - 25) {
            const big = bMid === 'highspeed', len = (big ? 130 : 65) + rng() * (big ? 150 : 90), sEnd = Math.min(sCur + len, s1 - 1);
            let l = 17 + rng() * 6;
            while (l < W - 30) {
              const wd = (big ? 80 : 38) + rng() * (big ? 90 : 60), l1 = Math.min(l + wd, W - 12);
              const a = side * l, b = side * l1, sa = sCur + 1.5, sb = sEnd - 1.5;
              const midS = (sCur + sEnd) / 2, biome = rowInfo(midS).biome;
              if (rng() < fieldP && sb - sa > 18 && l1 - l > 14 && !isOcc(sa, sb, a, b) && !inTunnel(midS, 50) && !inBridge(midS, 60) && !nearStationField(midS, l)) {
                addField(fieldMB, rng, biome, sa, sb, Math.min(a, b) + (side > 0 ? 1.2 : 0), Math.max(a, b) - (side > 0 ? 0 : 1.2));
                markOcc(sa, sb, a, b);
                if (rng() < 0.5 && biome !== 'vineyard') for (let s = sa; s < sb; s += 2.4) { const p = place(s, side * (l - 0.6)); addTree('bush', p.x, p.y - 0.1, p.z, 0.8 + rng() * 0.6, rng); }
              }
              l = l1 + 3 + rng() * 9;
            }
            sCur = sEnd + 2 + rng() * 6;
          }
        }
      }
      function nearStationField(s, l) { return l < 18 && nearStation(s, 20); }
      function addField(fm, r, biome, sa, sb, la, lb) {
        let kind;
        if (biome === 'vineyard') kind = r() < 0.96 ? 'vines' : 'meadow';
        else if (biome === 'suburb' || biome === 'ardennes' || biome === 'river') kind = r() < 0.7 ? 'meadow' : pick(r, ['rowsGold', 'rowsGreen']);
        else kind = pick(r, ['rowsGold', 'rowsGold', 'rowsGreen', 'rowsGreen', 'rowsBrown', 'rowsRape', 'meadow', 'meadow']);
        const spec = FIELD_KINDS[kind], tint = C(pick(r, spec.tint)), mb = kind === 'vines' ? fm.vines : spec.tex === 'rows' ? fm.rows : fm.meadow;
        const nS = Math.max(1, Math.ceil((sb - sa) / 10)), nL = Math.max(1, Math.ceil((lb - la) / 10)), grid = [], across = r() < 0.35;
        for (let a = 0; a <= nS; a++) {
          const s = lerp(sa, sb, a / nS), row = [], info = rowInfo(s), f = frame(s);
          for (let b = 0; b <= nL; b++) { const lat = lerp(la, lb, b / nL), x = f.x + f.rx * lat, z = f.z + f.rz * lat; row.push({ x, z, y: groundY(info, lat, x, z), s, lat }); }
          grid.push(row);
        }
        const tile = kind === 'vines' ? 4 : kind === 'meadow' ? 9 : 3;
        const vary = 0.9 + r() * 0.18;
        addGrid(mb, grid, kind === 'meadow' ? (p) => [p.x / 9, p.z / 9] : (kind === 'vines' || !across) ? (p) => [(p.lat - la) / tile, (p.s - sa) / tile] : (p) => [(p.s - sa) / tile, (p.lat - la) / tile],
          (p) => tint.clone().multiplyScalar(vary * (0.92 + 0.16 * vnoise(p.x * 0.05, p.z * 0.05))), 0.09);
        if (kind === 'meadow' && biome !== 'suburb' && biome !== 'vineyard' && r() < 0.6 && (lb - la) > 25 && (sb - sa) > 30) { // grazing animals
          const herd = r() < 0.5 ? 'cow' : 'sheep', n = (herd === 'cow' ? 3 : 5) + Math.floor(r() * 5), cx = (sa + sb) / 2, cl = (la + lb) / 2;
          for (let i = 0; i < n; i++) {
            const ps = clamp(cx + (r() - 0.5) * (sb - sa) * 0.7, sa + 3, sb - 3), pl = clamp(cl + (r() - 0.5) * (lb - la) * 0.7, la + 3, lb - 3), p = place(ps, pl);
            trees[herd].push({ x: p.x, y: p.y, z: p.z, rot: r() * 6.28, sc: 0.9 + r() * 0.25, tint: C('#ffffff') });
          }
        }
        if (kind === 'vines') { // 3D vine rows: low green hedges (plain-uv geometry in the block mesh)
          const lq = quality === 'low' ? 2 : 1;
          for (let lat = la + 3; lat < lb - 2; lat += 2.4 * lq) for (let s = sa + 2; s < sb - 7; s += 6) {
            const p0 = place(s, lat), p1 = place(s + 6, lat), dir = new T.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z), len = dir.length();
            const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), dir.normalize());
            const m = new T.Matrix4().compose(new T.Vector3((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 + 0.5, (p0.z + p1.z) / 2), q, new T.Vector3(1, 1, 1));
            mbBlock.addGeo(new T.BoxGeometry(0.6, 1.1, len), m, (v) => mixColor(C('#4a7a30'), C('#86b04a'), clamp((v.y - p0.y) / 1.3, 0, 1) * (0.8 + 0.4 * vnoise(v.x * 0.5, v.z * 0.5))), true);
          }
        }
      }

      /* ---- country roads ---- */
      const roadGroup = Math.floor(k / 3);
      if (!cityBiomes && bMid !== 'industrial' && hash2(roadGroup, seedBase & 1023) < (bMid === 'highspeed' ? 0.35 : 0.6)) {
        const side = hash2(roadGroup, 77) < 0.5 ? -1 : 1, off = 38 + 12 * hash2(roadGroup, 5), ph = hash2(roadGroup, 9) * 6;
        const latFn = s => side * (off + 10 * Math.sin(s / 310 + ph));
        if (!isOcc(s0, s1, side * (off - 14), side * (off + 14)) && !inTunnel(sMid, 130) && !inBridge(sMid, 130)) {
          addRoadRibbon(latFn, s0, s1, 3.0);
          markOcc(s0, s1, side * (off - 13), side * (off + 13));
        }
      }

      /* ---- trees ---- */
      const nAttempt = Math.round((wild ? 1150 : 600) * Q.trees);
      for (let n = 0; n < nAttempt; n++) {
        const s = s0 + rng() * CHUNK, side = rng() < 0.5 ? -1 : 1;
        const lmin = nearStation(s, 25) ? 18 : TREE_CLEAR_LAT, lat = side * (lmin + (W - 8 - lmin) * Math.pow(rng(), 1.3));
        const info = rowInfo(s), pal = PAL[info.biome] || PAL.farmland;
        if (inTunnel(s, 15)) continue;
        let accept = pal.trees;
        const wood = woods.find(w => s > w.s0 && s < w.s1 && lat > w.l0 && lat < w.l1);
        if (wood) accept = 0.9; else if (isOcc(s - 1, s + 1, lat - 1, lat + 1)) continue;
        const f = frame(s), x = f.x + f.rx * lat, z = f.z + f.rz * lat;
        const cl = fbm(x * 0.012, z * 0.012);
        if (!wood) accept *= wild ? (cl > 0.38 ? 1 : 0.2) : (0.15 + 1.6 * Math.max(0, cl - 0.35));
        if (rng() > accept) continue;
        if (info.wat && Math.abs(lat - riverLat(info.wat)) < info.wat.halfWidth + 9) continue;
        if (riverBridgeAt(s, 25) && Math.abs(lat) < 110) continue;
        const name = wood ? pickSpecies(rng() < 0.5 ? 'forest' : 'def', rng()) : pickSpecies(info.biome, rng()), sc = SPECIES_SCALE[name];
        addTree(name, x, groundY(info, lat, x, z) - 0.15, z, lerp(sc[0], sc[1], rng()), rng);
      }
      // tree belt right beside the track in open country (gives depth to the cab view)
      if (!cityBiomes && !wild && bMid !== 'industrial') for (let s = s0 + 4; s < s1; s += 7 + rng() * 8) {
        if (rng() > 0.45 * Q.trees + 0.15 || nearStation(s, 30) || inTunnel(s, 20) || inBridge(s, 30)) continue;
        const side = rng() < 0.5 ? -1 : 1, p = place(s, side * (TREE_CLEAR_LAT + 1 + rng() * 6)), nm = pickSpecies('def', rng()), sc = SPECIES_SCALE[nm];
        addTree(nm, p.x, p.y - 0.15, p.z, lerp(sc[0], sc[1], rng()), rng);
      }

      /* ---- grass tufts on the verge (cab-view texture) ---- */
      for (let n = TUFTS[quality] || 0; n > 0; n--) {
        const s = s0 + rng() * CHUNK, side = rng() < 0.5 ? -1 : 1, lat = side * (7 + Math.pow(rng(), 1.6) * 24), info = rowInfo(s);
        if (info.biome === 'city' || info.biome === 'tramcity' || info.biome === 'industrial' || inTunnel(s, 10) || riverBridgeAt(s, 40) || nearStation(s, 8) && Math.abs(lat) < 14) continue;
        if (info.wat && Math.abs(lat - riverLat(info.wat)) < info.wat.halfWidth + 4) continue;
        const f = frame(s), x = f.x + f.rx * lat, z = f.z + f.rz * lat;
        const tint = r3(rng); trees.tuft.push({ x, y: groundY(info, lat, x, z) - 0.02, z, rot: rng() * 6.28, sc: 0.8 + rng() * 1.2, tint });
      }

      /* ---- water ---- */
      {
        let started = false, sA = s0;
        const segs = [];
        for (let s = s0; s <= s1 + 0.1; s += 10) {
          const ok = !!rowInfo(s).wat;
          if (ok && !started) { sA = s; started = true; }
          if (started && (!ok || s + 10 > s1 + 0.1)) { segs.push([sA, ok ? s : s - 10]); started = false; }
        }
        for (const [a, b] of segs) if (b - a > 10) makeWater(mbWater, a, b, s => { const w = rowInfo(s).wat; return w ? riverLat(w) : 0; }, s => { const w = rowInfo(s).wat; return w ? w.halfWidth + 7 : 1; }, s => { const w = rowInfo(s).wat; return w ? w.y : 0; });
      }
      for (const br of bridges) if (br.waterY !== null && br.waterY !== undefined) {
        const mid = (br.s0 + br.s1) / 2, hw = Math.min(8 + (br.s1 - br.s0) * 0.1, (br.s1 - br.s0) / 2 + 3) + 4;
        if (mid < s0 || mid >= s1) continue;  // the whole crossing belongs to the chunk holding its midpoint
        const f = frame(mid), latMax = Math.min(126, W - 6), n = Math.ceil(latMax * 2 / 8), base = mbWater.count;
        for (let i = 0; i <= n; i++) {
          const lat = -latMax + (latMax * 2) * i / n, wd = hw * (1 - smooth(50, latMax, Math.abs(lat))) + 0.6;
          for (const sd of [-1, 1]) {
            mbWater.p.push(f.x + f.rx * lat + f.tx * wd * sd, br.waterY, f.z + f.rz * lat + f.tz * wd * sd);
            mbWater.n.push(0, 1, 0); mbWater.c.push(1, 1, 1); mbWater.u.push(sd < 0 ? 0 : wd / 6, lat / 6);
          }
        }
        for (let i = 0; i < n; i++) { const i0 = base + i * 2; mbWater.i.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
      }

      /* ---- assemble meshes ---- */
      const addMesh = (mb, mat, cast, recv) => {
        if (mb.empty) return null;
        const mesh = new T.Mesh(mb.build(), mat); mesh.castShadow = !!cast; mesh.receiveShadow = recv !== false; group.add(mesh); return mesh;
      };
      const terrain = track.ownScenery ? new MB() : terrainMesh(k, s0), terr = addMesh(terrain, matTerrain, false, true); // LUXTRAM: ownScenery = no procedural near ground
      addMesh(fieldMB.rows, matFieldRows, false, true); addMesh(fieldMB.vines, matFieldVines, quality !== 'low', true); addMesh(fieldMB.meadow, matFieldMeadow, false, true);
      addMesh(mbHouse, matHouse, true, true); addMesh(mbBlock, matBlock, true, true); addMesh(mbRoof, matRoof, true, true);
      addMesh(mbRoad, matRoad, false, true);
      { const sm = addMesh(mbSmoke, matSmoke, false, false); if (sm) sm.renderOrder = 3; }
      const water = addMesh(mbWater, matWater, false, false); if (water) { water.renderOrder = 2; waterMeshes.push(water); }
      for (const spot of turbineSpots) {
        const p = place(spot.s, spot.lat), towerMb = new MB(), bladeMb = new MB(), yaw = 0.9;
        addTurbine(towerMb, bladeMb, placeM(0, 0, 0));
        const tower = new T.Mesh(towerMb.build(), matCar); tower.position.set(p.x, terrainH(p.x, p.z) - 1, p.z); tower.rotation.y = yaw; tower.castShadow = false; group.add(tower);
        const blades = new T.Mesh(bladeMb.build(), matCar); blades.position.set(0, 89.5, 6.2); const hubG = new T.Group(); hubG.add(blades); hubG.position.copy(tower.position); hubG.rotation.y = yaw;
        blades.position.set(0, 89.5, 6.2); group.add(hubG); turbines.push({ spin: blades, speed: 0.9 + rng() * 0.6, group: hubG });
      }
      const hubs = [];
      for (const name of Object.keys(trees)) {
        const list = trees[name]; if (!list.length) continue;
        const im = new T.InstancedMesh(treeKit[name], name === 'lampHead' ? matLamp : matLeaf, list.length), m = new T.Matrix4(), q = new T.Quaternion();
        list.forEach((t, i) => { q.setFromAxisAngle(UP, t.rot); m.compose(TMP_P.set(t.x, t.y, t.z), q, TMP_S.set(t.sc, t.sc * (0.92 + 0.16 * hash2(i, k)), t.sc)); im.setMatrixAt(i, m); im.setColorAt(i, t.tint); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = quality !== 'low' && name !== 'tuft' && name !== 'sheep' && name !== 'lampHead'; im.receiveShadow = false; if (im.computeBoundingSphere) im.computeBoundingSphere(); group.add(im); hubs.push(im);
      }
      void terr;
      root.add(group);
      return { k, group, roads: chunkRoads };
    }

    /* ================= far terrain (camera-centred clipmap levels) + backdrop ================= */
    const FAR_TINT = { farmland: [1, 1, 1], suburb: [1, 1, 1], city: [0.92, 0.95, 0.9], tramcity: [0.92, 0.95, 0.9], forest: [0.86, 0.95, 0.86], ardennes: [0.8, 0.9, 0.82], industrial: [1.18, 0.86, 0.76], highspeed: [1.12, 1.04, 0.86], vineyard: [1.05, 1.02, 0.92], river: [0.96, 1, 0.96] };
    const farMeshes = [], farCache = new Map(), farTint = new T.Color(1, 1, 1), farTintTarget = new T.Color(1, 1, 1);
    let baseY = 0;
    const FAR_TUNNEL_PAD = 160;
    function farHeight(x, z) {
      const key = (Math.round(x) + 524288) * 1048576 + Math.round(z) + 524288;
      let h = farCache.get(key); if (h !== undefined) return h;
      h = terrainH(x, z); const d = distToTrack(x, z);
      if (d < W) {
        const f = 1 - smooth(W - 40, W, d);
        let low = h - 22 * f;
        /* tunnel corridor: the coarse far triangles (24 m / 96 m grid) must never cross the tube.  A vertex next to a tunnel (+/- FAR_TUNNEL_PAD m along it, which
           also covers the portals seen from outside) goes far below the rails, deeper than the hill is high, so no triangle between it and the hillside can rise to
           rail level (that was the flat field-coloured quad floating in the tunnel) */
        if (tunnels.length && track.nearest) {
          const q = track.nearest(x, z);
          if (q && inTunnel(q.s, FAR_TUNNEL_PAD)) low = Math.min(low, lerp(h, q.y - 8 - Math.max(24, h - q.y), f));
        }
        h = low;
      }
      if (farCache.size > 120000) farCache.clear();
      farCache.set(key, h); return h;
    }
    const FAR_LAND = [C('#86a84e'), C('#3f6a33'), C('#bfae5c'), C('#7ea84c'), C('#807d70')];
    let forestTh = 0.56;
    function farColor(x, z, nY) {
      const n = fbm(x * 0.0009 + 3, z * 0.0009), m = fbm(x * 0.003, z * 0.003 + 8);
      const c = n > forestTh ? mixColor(FAR_LAND[3], FAR_LAND[1], smooth(forestTh, forestTh + 0.1, n)) : mixColor(FAR_LAND[0], m > 0.5 ? FAR_LAND[2] : FAR_LAND[3], smooth(0.4, 0.6, m));
      c.lerp(FAR_LAND[4], smooth(0.1, 0.36, 1 - nY) * 0.8);
      return c.multiplyScalar(0.9 + 0.2 * vnoise(x * 0.01, z * 0.01));
    }
    function makeFarLevel(spacing, cells, lowerBox, offset) {
      const nV = cells + 1, pos = new Float32Array(nV * nV * 3), nor = new Float32Array(nV * nV * 3), col = new Float32Array(nV * nV * 3), uv = new Float32Array(nV * nV * 2), idx = [];
      for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) { const a = i * nV + j, b = a + 1, c = a + nV, d = c + 1; idx.push(a, b, c, b, d, c); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(idx);
      const mat = withSnow(new T.MeshLambertMaterial({ vertexColors: true, map: texGrass(), polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: offset }), 1);
      mats.push(mat);
      const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.renderOrder = -2; root.add(mesh);
      const level = { mesh, mat, last: null, spacing, cells };
      level.update = (cx, cz, force) => {
        const ox = Math.round(cx / spacing), oz = Math.round(cz / spacing);
        if (!force && level.last && level.last[0] === ox && level.last[1] === oz) return false;
        level.last = [ox, oz]; const half = cells / 2, R = half * spacing;
        for (let i = 0; i < nV; i++) for (let j = 0; j < nV; j++) {
          const gx = (ox + i - half) * spacing, gz = (oz + j - half) * spacing, v = i * nV + j;
          let h = farHeight(gx, gz);
          if (lowerBox && Math.abs(gx - cx) < lowerBox && Math.abs(gz - cz) < lowerBox) h -= 6;
          const rim = smooth(0.84, 1.0, Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) / R); if (rim > 0 && !lowerBox) h = lerp(h, baseY - 12, rim); else if (rim > 0) h = lerp(h, baseY - 12, rim);
          pos[v * 3] = gx; pos[v * 3 + 1] = h; pos[v * 3 + 2] = gz; uv[v * 2] = gx / 40; uv[v * 2 + 1] = gz / 40;
        }
        for (let i = 0; i < nV; i++) for (let j = 0; j < nV; j++) {
          const v = i * nV + j, im = Math.max(i - 1, 0), ip = Math.min(i + 1, cells), jm = Math.max(j - 1, 0), jp = Math.min(j + 1, cells);
          const dx = pos[(ip * nV + j) * 3 + 1] - pos[(im * nV + j) * 3 + 1], dz = pos[(i * nV + jp) * 3 + 1] - pos[(i * nV + jm) * 3 + 1];
          const sx = (ip - im) * spacing, sz = (jp - jm) * spacing, l = Math.hypot(dx / sx, 1, dz / sz);
          nor[v * 3] = -dx / sx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -dz / sz / l;
          const c = farColor(pos[v * 3], pos[v * 3 + 2], nor[v * 3 + 1]); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        }
        geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.uv.needsUpdate = true;
        return true;
      };
      farMeshes.push(level); return level;
    }
    const farL1 = makeFarLevel(24, 64, 0, 2), farL2 = makeFarLevel(96, 64, 720, 4);
    let flatY = null;
    const flat = new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ color: '#6f8f48' }));
    flat.scale.set(80000, 1, 80000); flat.frustumCulled = false; flat.renderOrder = -3; root.add(flat);
    // soften far-away white: the flat plane takes the average far colour
    function makeHills(seed, elev, tintA, tintB) {
      const seg = 128, pos = [], col = [], idx = [], a = C(tintA), b = C(tintB);
      for (let i = 0; i <= seg; i++) {
        const t = i / seg * Math.PI * 2, w = i === seg ? 0 : i;
        const hgt = elev * (0.35 + 1.1 * fbm(Math.cos(t) * 2.2 + seed, Math.sin(t) * 2.2 + seed) + 0.5 * vnoise(w * 0.35 + seed, 3)), c = mixColor(a, b, vnoise(i * 0.2, seed));
        pos.push(Math.cos(t), hgt, Math.sin(t), Math.cos(t), -0.05, Math.sin(t)); col.push(b.r, b.g, b.b, c.r, c.g, c.b);
        if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide })); m.frustumCulled = false; m.renderOrder = -1; root.add(m); mats.push(m.material); return m;
    }
    const hills = [makeHills(3, 0.05, '#5d7d55', '#47663f'), makeHills(11, 0.075, '#6e8798', '#5c7685')];

    /* ================= sky, lights, weather ================= */
    const skyMat = new T.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new T.Color() }, uHor: { value: new T.Color() }, uSunDir: { value: new T.Vector3(0, 1, 0) }, uSunCol: { value: new T.Color() }, uMoonDir: { value: new T.Vector3(0, -1, 0) }, uCloudLit: { value: new T.Color() }, uCloudDark: { value: new T.Color() }, uNight: { value: 0 }, uCloud: { value: 0.4 }, uTime: { value: 0 }, uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uGlow: { value: 0 }, uGlowCol: { value: new T.Color('#e08a46') } }
    });
    const sky = new T.Mesh(new T.SphereGeometry(100, 32, 16), skyMat); sky.userData.noRainOcc = true; sky.frustumCulled = false; sky.renderOrder = 999; root.add(sky);
    const hemi = new T.HemisphereLight('#dfeaf1', '#8b8065', 1.5); root.add(hemi);
    const sun = new T.DirectionalLight('#fff0d6', 3.1); sun.name = 'ls-sun'; root.add(sun); root.add(sun.target);
    const moon = new T.DirectionalLight('#9db4e8', 0); root.add(moon); root.add(moon.target);
    const shadowHalf = quality === 'high' ? 90 : 70;
    if (Q.shadow) {
      sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      const sc = sun.shadow.camera; sc.left = -shadowHalf; sc.right = shadowHalf; sc.top = shadowHalf; sc.bottom = -shadowHalf; sc.near = 5; sc.far = 420; sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35; sun.shadow.radius = 2.5;
    }
    const prevFog = scene.fog;
    const ownFog = new T.FogExp2('#b3d1ec', 0.0006);
    scene.fog = ownFog;
    const sunDir = new T.Vector3(0, 1, 0), moonDir = new T.Vector3(0, -1, 0);
    let sinE = 1;
    const wx = { cloud: 0.38, dark: 0, vis: 3800, rain: 0, snow: 0, snowCover: 0, grey: WEATHER.clear.grey.clone() };
    let wxTarget = WEATHER.clear;

    function applyLook() {
      const SUNRISE = 5.6, SUNSET = 20.6, hh = timeOfDay < SUNRISE ? timeOfDay + 24 : timeOfDay;
      const ang = hh <= SUNSET ? (hh - SUNRISE) / (SUNSET - SUNRISE) * Math.PI : Math.PI + (hh - SUNSET) / (24 - (SUNSET - SUNRISE)) * Math.PI, rawSin = Math.sin(ang);
      const elev = Math.asin(clamp(rawSin, -1, 1)) * 0.64; sinE = Math.sin(elev);
      const ce = Math.cos(elev);
      sunDir.set(Math.cos(ang) * 0.9 * ce, sinE, 0.45 * ce).normalize(); moonDir.copy(sunDir).negate();
      const k = sampleKeys(sinE), fogAmt = 1 - smooth(200, 3000, wx.vis), mixAmt = clamp(Math.max(wx.dark * 1.25, fogAmt * 0.88), 0, 0.9);
      const lum = c => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      const greyOf = c => { const l = lum(c) * (1 - 0.3 * wx.dark) * 0.98; return new T.Color(l * 0.97, l, l * 1.03); };
      const hor = mixColor(k.hor, greyOf(k.hor).lerp(wx.grey, 0.25 * smooth(0.0, 0.3, sinE)), mixAmt);
      const top = mixColor(mixColor(k.top, greyOf(k.top), mixAmt * 0.85), hor, fogAmt * 0.9);
      skyMat.uniforms.uTop.value.copy(top); skyMat.uniforms.uHor.value.copy(hor);
      const night = smooth(0.0, -0.22, sinE), day = smooth(-0.08, 0.28, sinE);
      skyMat.uniforms.uSunDir.value.copy(sunDir); skyMat.uniforms.uMoonDir.value.copy(moonDir); skyMat.uniforms.uSunCol.value.copy(k.sun);
      skyMat.uniforms.uGlow.value = night * 0.2; skyMat.uniforms.uNight.value = night; skyMat.uniforms.uCloud.value = wx.cloud; skyMat.uniforms.uSunVis.value = smooth(-0.1, 0.0, sinE); skyMat.uniforms.uMoonVis.value = night;
      const litBase = mixColor(C('#06080f'), mixColor(C('#fbfbf8'), k.sun, 0.28 * (1 - day * 0.6)), day);
      skyMat.uniforms.uCloudLit.value.copy(mixColor(mixColor(litBase, greyOf(litBase).multiplyScalar(0.92), wx.dark), hor, fogAmt * 0.8));
      skyMat.uniforms.uCloudDark.value.copy(mixColor(mixColor(litBase.clone().multiplyScalar(0.5), hor, 0.45).multiplyScalar(1 - 0.35 * wx.dark), hor, fogAmt * 0.85));
      const dim = 1 - 0.82 * wx.dark, sunI = 3.1 * smooth(-0.04, 0.24, sinE) * dim * (1 - 0.2 * wx.cloud);
      sun.color.copy(k.sun); sun.intensity = sunI;
      moon.intensity = 1.25 * smooth(0.04, -0.2, sinE) * (1 - 0.5 * wx.dark);
      hemi.color.copy(mixColor(k.hemiSky, greyOf(k.hemiSky), mixAmt * 0.7)); hemi.groundColor.copy(k.hemiGnd); hemi.intensity = k.hemiI * (1 - 0.28 * wx.dark) * (0.92 + 0.08 * (1 - wx.cloud)) + 0.12 * night;
      { // what the lights and the wipers of the train need to know (read through getLook(), no allocation)
        const dusk = smooth(0.2, -0.06, sinE);
        look.night = night; look.dark = clamp(Math.max(dusk * 0.8, night, wx.dark * 0.75, fogAmt * 0.45), 0, 1);
        look.haze = clamp(Math.max(night * 0.18, dusk * 0.08, fogAmt * 0.7, wx.rain * 0.4, wx.snow * 0.5), 0, 1);
      }
      if (scene.fog !== ownFog) scene.fog = ownFog;
      ownFog.color.copy(hor); ownFog.density = 2.15 / Math.max(Math.min(wx.vis, visCap), 120);
      matHouse.emissiveIntensity = matBlock.emissiveIntensity = Math.max(smooth(0.06, -0.1, sinE), wx.dark * 0.45 * day) * 1.3;
      SNOW_UNIFORM.value = wx.snowCover;
      matLamp.color.copy(mixColor(C('#8d8e8c'), C('#ffe0a8').multiplyScalar(1.6), Math.max(smooth(0.08, -0.08, sinE), wx.dark * 0.5 * smooth(-0.05, 0.2, sinE))));
      const wet = 1 - 0.32 * wx.dark * (wx.snow > 0.5 ? 0 : 1); [matTerrain, matFieldRows, matFieldVines, matFieldMeadow].forEach(m => m.color.setScalar(wet)); wetFactor = wet;
      const tint = FAR_TINT[currentBiome] || FAR_TINT.farmland; farTintTarget.setRGB(tint[0], tint[1], tint[2]);
      matWater.color.copy(mixColor(C('#244f5a'), hor, 0.2)); matWater.opacity = 0.9;
      hills[0].material.color.copy(mixColor(C('#ffffff'), hor, 0.0)); hills[1].material.color.copy(mixColor(C('#ffffff'), hor, 0.0));
    }
    const look = { night: 0, dark: 0, haze: 0, covered: 0 };
    let wetFactor = 1, visCap = 1e9;
    let currentBiome = bMidInit();
    function bMidInit() { return biomeAt(0); }

    /* ---- roof map: no rain or snow under roofs, station halls, canopies, bridges or in tunnels.
       A small top-down orthographic render of the whole scene (flat height shader, one cheap pass) around the camera, redone every ~0.5 s or after 10 m while it rains or snows.
       The rain / snow shaders discard drops that lie below the surface above them. Lines (wires), points, sprites, additive effects, the sky and the train itself (userData.noRainOcc) are left out.
       A 3x3 read-back of the cells at the camera (asynchronous, WebGL2 pixel buffer) tells the windscreen whether the cab itself is covered (look.covered). */
    const occ = (function makeOcc() {
      const empty = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, T.RGBAFormat, T.UnsignedByteType); empty.needsUpdate = true;
      const o = { texture: empty, centre: new T.Vector3(1e9, 0, 1e9), ok: false, update() {}, dispose() { empty.dispose(); } };
      const renderer = opts && opts.renderer;
      if (!renderer || !renderer.getContext) return o;
      const gl = renderer.getContext();
      const rt = new T.WebGLRenderTarget(OCC_SIZE, OCC_SIZE, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, format: T.RGBAFormat, type: T.UnsignedByteType, depthBuffer: true, generateMipmaps: false });
      rt.texture.colorSpace = T.NoColorSpace;
      const cam = new T.OrthographicCamera(-OCC_HALF, OCC_HALF, OCC_HALF, -OCC_HALF, 0.1, OCC_HALF * 2 + 0.5); cam.up.set(0, 0, -1);
      const hmat = new T.ShaderMaterial({ vertexShader: OCC_VERT, fragmentShader: OCC_FRAG, side: T.DoubleSide, blending: T.NoBlending, fog: false });
      const hidden = [], clearCol = new T.Color(), cpos = new T.Vector3();
      const isAsync = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      let pbo = null, fence = null; const px = new Uint8Array(36);
      if (isAsync) { pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 36, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); }
      let age = 99, valid = false;
      const hide = (obj) => {
        if (obj.isLine || obj.isPoints || obj.isSprite || obj.userData.noRainOcc || (obj.material && obj.material.blending === T.AdditiveBlending)) { obj.visible = false; hidden.push(obj); }
      };
      o.texture = rt.texture; o.ok = true;
      /* wants: rain or snow is falling. Returns nothing; look.covered is set from the previous read-back. */
      o.update = function (camPos, dt, wants) {
        age += dt;
        if (fence) {
          const st = gl.clientWaitSync(fence, 0, 0);
          if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
            gl.deleteSync(fence); fence = null;
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            let n = 0; for (let i = 0; i < 9; i++) if (px[i * 4 + 3] > 127) { const v = (px[i * 4] + px[i * 4 + 1] / 255) / 255; if (v * OCC_HALF * 2 - OCC_HALF > 1.6) n++; }
            look.covered = n >= 7 ? 1 : 0;
          } else if (st === gl.WAIT_FAILED) { gl.deleteSync(fence); fence = null; }
        }
        if (!wants) { if (valid) { valid = false; o.centre.set(1e9, 0, 1e9); look.covered = 0; } return; }
        const moved = Math.hypot(camPos.x - cpos.x, camPos.z - cpos.z) > 10 || Math.abs(camPos.y - cpos.y) > 6;
        if (valid && !moved && age < 0.5) return;
        age = 0; valid = true; cpos.copy(camPos);
        o.centre.set(camPos.x, camPos.y, camPos.z);
        cam.position.set(camPos.x, camPos.y + OCC_HALF, camPos.z); cam.lookAt(camPos.x, camPos.y, camPos.z); cam.updateMatrixWorld(true);
        scene.traverseVisible(hide);
        const prevRT = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha(), prevAuto = renderer.shadowMap.autoUpdate, prevOv = scene.overrideMaterial;
        renderer.getClearColor(clearCol);
        renderer.shadowMap.autoUpdate = false; scene.overrideMaterial = hmat;
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
        renderer.render(scene, cam);
        if (isAsync && !fence) {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.readPixels(OCC_SIZE / 2 - 1, OCC_SIZE / 2 - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        }
        scene.overrideMaterial = prevOv; renderer.shadowMap.autoUpdate = prevAuto;
        renderer.setRenderTarget(prevRT); renderer.setClearColor(clearCol, prevAlpha);
        for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
        hidden.length = 0;
      };
      o.dispose = () => { rt.dispose(); hmat.dispose(); empty.dispose(); if (fence) gl.deleteSync(fence); if (pbo) gl.deleteBuffer(pbo); };
      return o;
    })();

    /* rain & snow */
    const BOX = new T.Vector3(46, 30, 46);
    function makeParticles(count, isSnow) {
      const seeds = new Float32Array(count * (isSnow ? 4 : 8)), r = mulberry(isSnow ? 91 : 17);
      for (let i = 0; i < count; i++) {
        const x = r(), y = r(), z = r(), w = r();
        if (isSnow) { seeds.set([x, y, z, w], i * 4); } else { seeds.set([x, y, z, 0, x, y, z, 1], i * 8); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(count * (isSnow ? 3 : 6)), 3));
      g.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
      const mat = new T.ShaderMaterial({
        vertexShader: isSnow ? SNOW_VERT : RAIN_VERT, fragmentShader: isSnow ? SNOW_FRAG : RAIN_FRAG, transparent: true, depthWrite: false, fog: false,
        uniforms: { uCam: { value: new T.Vector3() }, uBox: { value: BOX }, uTime: { value: 0 }, uRel: { value: new T.Vector3(0, -13, 0) }, uLen: { value: 0.9 }, uCol: { value: new T.Color('#c3ccd6') }, uAlpha: { value: 0.4 }, uSize: { value: 55 }, uOcc: { value: occ.texture }, uOccC: { value: occ.centre } }
      });
      const m = isSnow ? new T.Points(g, mat) : new T.LineSegments(g, mat);
      m.frustumCulled = false; m.renderOrder = 5; m.visible = false; root.add(m); return m;
    }
    const rainMesh = makeParticles(Q.rain, false), snowMesh = makeParticles(Math.round(Q.rain * 0.7), true);

    /* cars (shared instanced mesh, moving along road polylines of the live chunks) */
    const carMesh = new T.InstancedMesh(carGeo, matCar, Q.cars); carMesh.frustumCulled = false; carMesh.castShadow = false; carMesh.count = 0; root.add(carMesh);
    let carList = [];
    const CAR_COLORS = ['#c8c8c8', '#1f2328', '#a42a2a', '#2c4a7a', '#e9e9e9', '#4c5a48', '#c9a23a', '#7a7f86', '#5a1f1f'].map(C);
    function rebuildCars() {
      const list = [], r = mulberry(seedBase + 5);
      for (const roads of roadsAll.values()) for (const road of roads) {
        if (road.len < 40) continue;
        const per = road.lane ? 60 : road.city ? 45 : 110, n = Math.floor(road.len / per) + (r() < (road.len / per) % 1 ? 1 : 0);
        for (let i = 0; i < n && list.length < Q.cars; i++) {
          const parked = road.city && !road.lane && r() < 0.35, dir = r() < 0.5 ? 1 : -1;
          list.push({ road, t: r() * road.len, v: parked ? 0 : dir * (road.lane ? 5 + r() * 4 : 8 + r() * 8), sign: dir, lane: road.hw * (parked ? 0.8 : 0.42), color: pick(r, CAR_COLORS) });
        }
      }
      carList = list; carMesh.count = list.length;
      list.forEach((c, i) => carMesh.setColorAt(i, c.color));
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    }
    const carM = new T.Matrix4(), carQ = new T.Quaternion(), carP = new T.Vector3(), carS = new T.Vector3(1, 1, 1);
    function updateCars(dt) {
      for (let i = 0; i < carList.length; i++) {
        const c = carList[i], road = c.road; c.t += c.v * dt;
        if (c.t > road.len) c.t -= road.len; else if (c.t < 0) c.t += road.len;
        let j = 1; while (j < road.cum.length - 1 && road.cum[j] < c.t) j++;
        const a = road.pts[j - 1], b = road.pts[j], seg = road.cum[j] - road.cum[j - 1] || 1, u = (c.t - road.cum[j - 1]) / seg;
        const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1, nx = -dz / dl, nz = dx / dl;
        const heading = Math.atan2(-dx, -dz) + (c.sign < 0 ? Math.PI : 0);
        carP.set(lerp(a.x, b.x, u) + nx * c.lane * c.sign, lerp(a.y, b.y, u) - 0.02, lerp(a.z, b.z, u) + nz * c.lane * c.sign);
        carQ.setFromAxisAngle(UP, heading); carM.compose(carP, carQ, carS); carMesh.setMatrixAt(i, carM);
      }
      carMesh.instanceMatrix.needsUpdate = true;
    }

    /* ================= streaming + per-frame update ================= */
    const lastCamera = new T.Vector3(), camPos = new T.Vector3(), camDir = new T.Vector3();
    let lastKc = null, camVel = new T.Vector3(), haveCam = false, lastBiomeS = -1e9;
    const maxChunk = Math.floor(L / CHUNK) + 1;

    function disposeChunk(c) {
      root.remove(c.group);
      c.group.traverse(o => {
        if (o.isInstancedMesh) o.dispose();
        else if (o.isMesh && o.geometry) { o.geometry.dispose(); const wi = waterMeshes.indexOf(o); if (wi >= 0) waterMeshes.splice(wi, 1); }
      });
      for (let i = turbines.length - 1; i >= 0; i--) if (c.group.children.includes(turbines[i].group)) turbines.splice(i, 1);
      roadsAll.delete(c.k);
    }
    function ensureChunks(s, all) {
      const kc = Math.floor(clamp(s, 0, L) / CHUNK), lo = Math.max(-1, kc - Q.behind), hi = Math.min(maxChunk, kc + Q.ahead);
      for (const [k, c] of chunks) if (k < lo - 1 || k > hi + 1) { disposeChunk(c); chunks.delete(k); lastKc = null; }
      const order = []; for (let k = lo; k <= hi; k++) if (!chunks.has(k)) order.push(k);
      order.sort((a, b) => Math.abs(a - kc) - Math.abs(b - kc) || a - b);
      let built = 0;
      for (const k of order) {
        if (!all && built >= 1) break;
        try { const c = buildChunk(k); chunks.set(k, c); roadsAll.set(k, c.roads); built++; }
        catch (e) { console.warn(TAG + 'chunk ' + k + ' failed', e); chunks.set(k, { k, group: new T.Group(), roads: [] }); }
      }
      if (built) rebuildCars();
    }

    const snapV = new T.Vector3(), lightRight = new T.Vector3(), lightUp = new T.Vector3();
    function updateSunFollow(cp, dir) {
      const center = cp.clone().addScaledVector(dir, 22);
      if (Q.shadow) { // snap to shadow texels so the shadow doesn't shimmer
        const d = sunDir; lightRight.crossVectors(UP, d).normalize(); lightUp.crossVectors(d, lightRight).normalize();
        const texel = (shadowHalf * 2) / Q.shadow, a = Math.round(center.dot(lightRight) / texel) * texel, b = Math.round(center.dot(lightUp) / texel) * texel, c = center.dot(d);
        snapV.set(0, 0, 0).addScaledVector(lightRight, a).addScaledVector(lightUp, b).addScaledVector(d, c);
        center.copy(snapV);
      }
      sun.target.position.copy(center); sun.position.copy(center).addScaledVector(sunDir, 160);
      sun.target.updateMatrixWorld(); moon.position.copy(cp).addScaledVector(moonDir, 100); moon.target.position.copy(cp);
    }

    function update(s, camera, dt) {
      if (disposed) return;
      dt = clamp(dt === undefined ? 0.016 : dt, 0, 0.1); elapsed += dt;
      if (camera && camera.getWorldPosition) { camera.getWorldPosition(camPos); camera.getWorldDirection(camDir); } else { const f = frame(s); camPos.set(f.x, f.y + 3, f.z); camDir.set(f.tx, 0, f.tz); }
      if (haveCam && dt > 0) camVel.copy(camPos).sub(lastCamera).divideScalar(dt).clampLength(0, 120); else camVel.set(0, 0, 0);
      lastCamera.copy(camPos); haveCam = true;
      const kcNow = Math.floor(clamp(s, 0, L) / CHUNK);
      ensureChunks(s, firstUpdate || (lastKc !== null && Math.abs(kcNow - lastKc) > 3)); lastKc = kcNow;
      // biome-driven tint of the far terrain
      if (Math.abs(s - lastBiomeS) > 40) { lastBiomeS = s; const b = biomeAt(s); if (b !== currentBiome) { currentBiome = b; const t = FAR_TINT[b] || FAR_TINT.farmland; farTintTarget.setRGB(t[0], t[1], t[2]); } }
      farTint.lerp(farTintTarget, 1 - Math.exp(-dt * 0.6));
      forestTh += ((currentBiome === 'forest' || currentBiome === 'ardennes' ? 0.3 : currentBiome === 'highspeed' ? 0.72 : currentBiome === 'river' || currentBiome === 'vineyard' ? 0.5 : 0.58) - forestTh) * (1 - Math.exp(-dt * 0.15));
      const f = frame(s); baseY = f.y;
      if (firstUpdate) farTint.copy(farTintTarget);
      const moved1 = farL1.update(camPos.x, camPos.z, firstUpdate), moved2 = farL2.update(camPos.x, camPos.z, firstUpdate);
      void moved1; void moved2;
      farL1.mat.color.copy(farTint).multiplyScalar(wetFactor); farL2.mat.color.copy(farTint).multiplyScalar(wetFactor);
      // safety plane under the far terrain: 12.5 m below the track, but well below the valley floor on bridges and viaducts (it used to hang between the deck and the valley and hid it)
      let flatTarget = baseY - 12.5;
      for (const br of (track.bridges || [])) if (s > br.s0 - 140 && s < br.s1 + 140 && Number.isFinite(br.h)) flatTarget = Math.min(flatTarget, baseY - br.h - 6);
      flatY = flatY === null || firstUpdate ? flatTarget : flatY + (flatTarget - flatY) * (1 - Math.exp(-dt * 2.5));
      flat.position.set(camPos.x, flatY, camPos.z); flat.material.color.copy(farTint).multiplyScalar(0.42);
      const farPlane = camera && camera.far ? camera.far : 6000, capChanged = Math.abs(visCap - farPlane * 0.8) > 1; if (capChanged) visCap = farPlane * 0.8;
      // weather easing
      const k = 1 - Math.exp(-dt * (firstUpdate ? 100 : 0.8)), tw = wxTarget;
      let changed = firstUpdate || capChanged;
      for (const key of ['cloud', 'dark', 'rain', 'snow', 'snowCover']) { const target = key === 'snowCover' ? tw.snowCover : tw[key]; if (Math.abs(wx[key] - target) > 1e-3) { wx[key] += (target - wx[key]) * k; changed = true; } }
      if (Math.abs(wx.vis - tw.vis) > 1) { wx.vis = Math.exp(lerp(Math.log(wx.vis), Math.log(tw.vis), k)); changed = true; }
      wx.grey.lerp(tw.grey, k);
      if (changed) applyLook();
      // backdrop & sky follow the camera
      sky.position.copy(camPos);
      const far = camera && camera.far ? camera.far : 6000, R1 = clamp(far * 0.5, 1500, 3300), R2 = clamp(far * 0.8, 2400, 5000), ard = currentBiome === 'ardennes' ? 1.6 : currentBiome === 'highspeed' ? 0.7 : 1;
      hills[0].position.set(camPos.x, baseY - 14, camPos.z); hills[0].scale.set(R1, R1 * ard, R1);
      hills[1].position.set(camPos.x, baseY - 14, camPos.z); hills[1].scale.set(R2, R2 * ard, R2);
      skyMat.uniforms.uTime.value = elapsed;
      updateSunFollow(camPos, camDir.y > 0.9 ? new T.Vector3(f.tx, 0, f.tz) : camDir.clone().setY(0).normalize());
      // particles
      const rainOn = wx.rain > 0.02, snowOn = wx.snow > 0.02; rainMesh.visible = rainOn; snowMesh.visible = snowOn;
      occ.update(camPos, dt, rainOn || snowOn);
      if (rainOn) {
        const u = rainMesh.material.uniforms; u.uCam.value.copy(camPos); u.uTime.value = elapsed; u.uRel.value.set(-camVel.x, -13 - camVel.y, -camVel.z);
        u.uLen.value = 0.7 + Math.min(camVel.length() * 0.035, 3.2); u.uAlpha.value = 0.42 * wx.rain; u.uCol.value.copy(mixColor(C('#b9c4cf'), ownFog.color, 0.35));
      }
      if (snowOn) { const u = snowMesh.material.uniforms; u.uCam.value.copy(camPos); u.uTime.value = elapsed; u.uSize.value = 60 * wx.snow; }
      // animation
      waterNormal.offset.x = (elapsed * 0.012) % 1; waterNormal.offset.y = (elapsed * 0.02) % 1;
      for (const t of turbines) t.spin.rotation.z += dt * t.speed;
      if (carList.length) updateCars(dt);
      firstUpdate = false;
    }

    function setTimeOfDay(h) { timeOfDay = ((Number(h) % 24) + 24) % 24; applyLook(); }
    function setWeather(name, instant) {
      wxTarget = WEATHER[name] || WEATHER.clear; weatherName = WEATHER[name] ? name : 'clear';
      if (instant) { Object.assign(wx, { cloud: wxTarget.cloud, dark: wxTarget.dark, vis: wxTarget.vis, rain: wxTarget.rain, snow: wxTarget.snow, snowCover: wxTarget.snowCover }); wx.grey.copy(wxTarget.grey); }
      applyLook();
    }
    function warm(s) { ensureChunks(s === undefined ? 0 : s, true); }
    function stats() {
      let tris = 0, meshes = 0; root.traverse(o => { if (o.isMesh && o.visible) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
      return { chunks: chunks.size, meshes, triangles: Math.round(tris), quality, timeOfDay, weather: weatherName };
    }
    function dispose() {
      if (disposed) return; disposed = true;
      for (const c of chunks.values()) disposeChunk(c);
      chunks.clear(); roadsAll.clear();
      scene.remove(root);
      root.traverse(o => { if (o.isMesh || o.isPoints || o.isLine) { if (!o.isInstancedMesh || o === carMesh) { if (o.geometry && o.geometry !== carGeo) o.geometry.dispose(); } if (o.material && o.material.isShaderMaterial) o.material.dispose(); } });
      occ.dispose(); carGeo.dispose(); Object.keys(treeKit).forEach(n => treeKit[n].dispose()); carMesh.dispose();
      mats.forEach(m => m.dispose()); skyMat.dispose(); sun.shadow && sun.shadow.map && sun.shadow.map.dispose();
      if (scene.fog === ownFog) scene.fog = prevFog || null;
    }

    setWeather('clear', true); setTimeOfDay(12);
    return { update, setTimeOfDay, setWeather, dispose, warm, stats, sun, moon, hemi, group: root, quality, getWeather: () => weatherName, getTimeOfDay: () => timeOfDay, getLook: () => look };
  }

  TS.landscape = { create, CHUNK };
})(window.TS);
