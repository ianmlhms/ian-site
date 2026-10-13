/* Lokféierer: hand-built Luxtram landmarks (TS.luxLandmarks).
 * Procedural three.js models (one shared texture atlas + vertex colours, one draw call per landmark and LOD) of the buildings and
 * bridges along Luxtram T1: Luxexpo, Coque, European Parliament (Konrad Adenauer), Cour de Justice, Philharmonie, Mudam + Fort Thüngen,
 * Pont Grande-Duchesse Charlotte, Pfaffenthal funicular/lift, Royal-Hamilius, Place de l'Étoile, Pont Adolphe, Gare Centrale,
 * Stade de Luxembourg and the Cloche d'Or centre.
 * Footprints (c) OpenStreetMap contributors (ODbL); heights/roof colours checked against the geoportail.lu orthophoto and web photos.
 * Used by luxtram-world.js:  const lm = TS.luxLandmarks.build(scene, ctx);  lm.update(s, camera);  lm.dispose();
 * ctx = { project(lat, lon) -> {x, z}   scene coordinates (default: the build_luxtram.py equirectangular projection around 49.6055 N / 6.1640 E),
 *         groundY(x, z)                 terrain height (default 0),
 *         railY(x, z)                   height of the tram deck near x,z (bridges; default groundY),
 *         quality: 'high'|'medium'|'low', night: () => 0..1 (optional), origin: {x, z} (optional, subtracted by the default projection) }
 * TS.luxLandmarks.replaces lists the OSM ways (+ bounding boxes) the models replace; TS.luxLandmarks.covers(lat, lon) tests a point. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] landmarks: ';

  const LAT0 = 49.6055;
  const LON0 = 6.164;
  const M_LAT = 111194.93;
  const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const defaultProject = (lat, lon) => ({ x: (lon - LON0) * M_LON, z: -(lat - LAT0) * M_LAT });
  function mulberry(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash2 = (x, y) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const col = (hex) => { const k = new T.Color(hex); return [k.r, k.g, k.b]; };
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const WHITE = [1, 1, 1];

  /* ================================================================== texture atlas
   * 2048 x 1024, 8 x 4 cells of 256 px. Cell index -> uv rectangle; day atlas + a half-size emissive atlas (lit windows at night). */
  const CELL = 256;
  const COLS = 8;
  const ROWS = 6;
  const CELL_NAMES = ['plain', 'curtain0', 'curtain1', 'curtain2', 'curtain3', 'punched0', 'punched1', 'punched2', 'punched3',
    'ribbon0', 'ribbon1', 'ribbon2', 'ribbon3', 'gold0', 'gold1', 'ashlar', 'slate', 'roofGrey', 'diamond', 'glassroof', 'columns',
    'corrug', 'pave', 'glow', 'greenroof', 'shell', 'clock', 'curtainLo', 'punchedLo', 'ribbonLo', 'goldLo', 'brick', 'plaza', 'panel', 'metal', 'flags', 'fins', 'blinds',
    'balust', 'hexfrieze', 'schist', 'lights', 'awning', 'sign'];
  const CELL_INDEX = {};
  CELL_NAMES.forEach((n, i) => { CELL_INDEX[n] = i; });
  const UV_PAD = 3 / 2048; // keeps bilinear/mip sampling inside the cell
  function cellRect(name) {
    const i = CELL_INDEX[name];
    const cx = i % COLS;
    const cy = Math.floor(i / COLS);
    const u0 = (cx * CELL) / (CELL * COLS) + UV_PAD;
    const u1 = ((cx + 1) * CELL) / (CELL * COLS) - UV_PAD;
    const v1 = 1 - (cy * CELL) / (CELL * ROWS) - UV_PAD * 2;
    const v0 = 1 - ((cy + 1) * CELL) / (CELL * ROWS) + UV_PAD * 2;
    return [u0, v0, u1, v1];
  }
  const RECTS = {};
  CELL_NAMES.forEach((n) => { RECTS[n] = cellRect(n); });

  let atlas = null;
  function noise(g, x, y, w, h, n, a, size, seed) {
    const r = mulberry(seed);
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
      g.fillRect(x + r() * w, y + r() * h, size, size);
    }
  }
  /* Each painter draws into the 256 x 256 box at (x, y); lit=true paints the emissive (night) version. */
  const PAINT = {
    plain(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#f4f2ee'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 900, 0.035, 2, 4);
    },
    curtain(g, x, y, lit, v) {
      const wLit = lit && (v === 1 || v === 2);
      if (lit) {
        if (!wLit) return;
        g.fillStyle = v === 1 ? '#ffd993' : '#f4f0dc';
        g.fillRect(x + 8, y + 14, CELL - 16, 150);
        return;
      }
      g.fillStyle = '#c8cdd0'; g.fillRect(x, y, CELL, CELL);
      const grd = g.createLinearGradient(x, y + 14, x + CELL, y + 170);
      grd.addColorStop(0, '#e0ecf2'); grd.addColorStop(0.5, '#a3bccb'); grd.addColorStop(1, '#6f8fa3');
      g.fillStyle = grd; g.fillRect(x + 8, y + 14, CELL - 16, 150);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.moveTo(x + 8, y + 150); g.lineTo(x + 120, y + 14); g.lineTo(x + 170, y + 14); g.lineTo(x + 8, y + 164); g.fill();
      g.fillStyle = '#eef1f2'; g.fillRect(x, y, 6, CELL); g.fillRect(x + CELL - 6, y, 6, CELL);
      g.fillStyle = '#9aa3a8'; g.fillRect(x, y + 164, CELL, 6);
      g.fillStyle = '#d7dcde'; g.fillRect(x, y + 170, CELL, 86);
      g.fillStyle = '#8b959b'; g.fillRect(x, y + CELL - 5, CELL, 5);
      if (v === 3) { g.fillStyle = 'rgba(244,238,222,0.6)'; g.fillRect(x + 8, y + 14, CELL - 16, 64); }
      noise(g, x, y, CELL, CELL, 300, 0.03, 2, 7 + v);
    },
    punched(g, x, y, lit, v) {
      const wx = x + 66; const wy = y + 56; const ww = 124; const wh = 150;
      if (lit) {
        if (v !== 1 && v !== 2) return;
        g.fillStyle = v === 1 ? '#ffd58a' : '#fff0c8'; g.fillRect(wx, wy, ww, wh);
        return;
      }
      g.fillStyle = '#f1ece0'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 700, 0.04, 2, 11 + v);
      g.fillStyle = '#d8d2c2'; g.fillRect(wx - 10, wy - 12, ww + 20, 12); // lintel
      g.fillStyle = '#e9e5d9'; g.fillRect(wx - 6, wy - 4, ww + 12, wh + 12);
      const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grd.addColorStop(0, '#76909f'); grd.addColorStop(0.5, '#30475a'); grd.addColorStop(1, '#1f2d39');
      g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.beginPath(); g.moveTo(wx, wy + wh * 0.6); g.lineTo(wx + ww * 0.6, wy); g.lineTo(wx + ww, wy); g.lineTo(wx, wy + wh * 0.95); g.fill();
      g.fillStyle = '#efebe0'; g.fillRect(wx + ww / 2 - 3, wy, 6, wh); g.fillRect(wx, wy + wh * 0.42, ww, 6);
      g.fillStyle = '#c4beae'; g.fillRect(wx - 14, wy + wh + 8, ww + 28, 10); // sill
      if (v === 3) { g.fillStyle = 'rgba(245,240,226,0.62)'; g.fillRect(wx, wy, ww / 2, wh); }
    },
    ribbon(g, x, y, lit, v) {
      if (lit) {
        if (v !== 1 && v !== 2) return;
        g.fillStyle = v === 1 ? '#ffdc9c' : '#f2efe0'; g.fillRect(x + 4, y + 58, CELL - 8, 112);
        return;
      }
      g.fillStyle = '#f0efec'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 500, 0.03, 2, 21 + v);
      const grd = g.createLinearGradient(x, y + 58, x, y + 170);
      grd.addColorStop(0, '#c4d6e0'); grd.addColorStop(0.55, '#7d9bb0'); grd.addColorStop(1, '#4f6c80');
      g.fillStyle = grd; g.fillRect(x, y + 58, CELL, 112);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + 58, CELL, 10); // overhang shadow
      g.fillStyle = '#e9ebec';
      for (let k = 0; k < 4; k++) g.fillRect(x + k * 64 - 2, y + 58, 4, 112);
      g.fillStyle = '#d4d6d6'; g.fillRect(x, y + 170, CELL, 14);
      if (v === 3) { g.fillStyle = 'rgba(240,236,224,0.55)'; g.fillRect(x + 64, y + 58, 64, 112); }
    },
    gold(g, x, y, lit, v) {
      if (lit) { if (v === 1) { g.fillStyle = '#ffd47a'; g.fillRect(x + 20, y + 150, CELL - 40, 64); } return; }
      const grd = g.createLinearGradient(x, y, x + CELL, y + CELL);
      grd.addColorStop(0, '#d8c58a'); grd.addColorStop(0.5, '#c4ab68'); grd.addColorStop(1, '#a89050');
      g.fillStyle = grd; g.fillRect(x, y, CELL, CELL);
      g.strokeStyle = 'rgba(255,236,160,0.55)'; g.lineWidth = 3;
      for (let k = -CELL; k < CELL * 2; k += 32) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + CELL, y + CELL); g.stroke(); }
      g.strokeStyle = 'rgba(110,76,10,0.5)';
      for (let k = -CELL; k < CELL * 2; k += 32) { g.beginPath(); g.moveTo(x + k + 16, y); g.lineTo(x + k - CELL + 16, y + CELL); g.stroke(); }
      g.fillStyle = 'rgba(60,44,12,0.55)'; g.fillRect(x, y + 138, CELL, 8); // floor band
      g.fillStyle = v === 1 ? 'rgba(46,52,58,0.45)' : 'rgba(46,52,58,0.3)'; g.fillRect(x, y + 150, CELL, 64);
    },
    ashlar(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#ece4cf'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 1400, 0.06, 2, 31);
      const r = mulberry(32);
      g.strokeStyle = 'rgba(96,86,64,0.55)'; g.lineWidth = 3;
      for (let row = 0; row < 8; row++) {
        const yy = y + row * 32;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x + CELL, yy); g.stroke();
        const off = (row % 2) * 32 + r() * 6;
        for (let bx = off; bx < CELL; bx += 64) { g.beginPath(); g.moveTo(x + bx, yy); g.lineTo(x + bx, yy + 32); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,' + (0.03 + r() * 0.05) + ')'; g.fillRect(x + (r() * 200), yy + 3, 56, 26);
      }
    },
    slate(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#4b5058'; g.fillRect(x, y, CELL, CELL);
      const r = mulberry(41);
      for (let row = 0; row < 16; row++) for (let k = 0; k < 8; k++) {
        const v = 70 + r() * 22;
        g.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 4) | 0) + ',' + ((v + 10) | 0) + ')';
        g.fillRect(x + k * 32 + (row % 2) * 16 - 16, y + row * 16 + 1, 30, 14);
      }
    },
    roofGrey(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#b4b5b2'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 2400, 0.09, 2, 51);
      g.fillStyle = 'rgba(70,70,66,0.18)';
      for (let k = 0; k < CELL; k += 64) g.fillRect(x + k, y, 2, CELL);
    },
    diamond(g, x, y, lit) {
      if (lit) { g.fillStyle = 'rgba(255,255,255,0.16)'; for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) { g.beginPath(); g.moveTo(x + k * 128 + 64, y + j * 128 + 14); g.lineTo(x + k * 128 + 114, y + j * 128 + 64); g.lineTo(x + k * 128 + 64, y + j * 128 + 114); g.lineTo(x + k * 128 + 14, y + j * 128 + 64); g.fill(); } return; }
      g.fillStyle = '#c3c9ce'; g.fillRect(x, y, CELL, CELL);
      for (let k = -1; k < 3; k++) for (let j = -1; j < 3; j++) {
        const cx = x + k * 128 + 64 + (j % 2 ? 64 : 0); const cy = y + j * 64 + 64;
        const sh = ((k + j) & 1) ? 218 : 196;
        g.fillStyle = 'rgb(' + sh + ',' + (sh + 4) + ',' + (sh + 8) + ')';
        g.beginPath(); g.moveTo(cx, cy - 60); g.lineTo(cx + 60, cy); g.lineTo(cx, cy + 60); g.lineTo(cx - 60, cy); g.fill();
      }
      g.strokeStyle = 'rgba(60,66,72,0.6)'; g.lineWidth = 3;
      for (let k = -4; k < 6; k++) { g.beginPath(); g.moveTo(x + k * 64, y); g.lineTo(x + k * 64 + 256, y + 256); g.stroke(); g.beginPath(); g.moveTo(x + k * 64 + 256, y); g.lineTo(x + k * 64, y + 256); g.stroke(); }
    },
    glassroof(g, x, y, lit) {
      if (lit) return;
      const grd = g.createLinearGradient(x, y, x + CELL, y + CELL);
      grd.addColorStop(0, '#b5cfe0'); grd.addColorStop(0.5, '#6e93ab'); grd.addColorStop(1, '#3f6078');
      g.fillStyle = grd; g.fillRect(x, y, CELL, CELL);
      g.strokeStyle = 'rgba(235,242,246,0.85)'; g.lineWidth = 4;
      for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(x + k * 64, y); g.lineTo(x + k * 64, y + CELL); g.stroke(); g.beginPath(); g.moveTo(x, y + k * 64); g.lineTo(x + CELL, y + k * 64); g.stroke(); }
      g.lineWidth = 3;
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) { g.beginPath(); g.moveTo(x + k * 64, y + j * 64); g.lineTo(x + k * 64 + 64, y + j * 64 + 64); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 64, y + 64, 64, 64); g.fillRect(x + 192, y + 128, 64, 64);
    },
    columns(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#3a4047'; g.fillRect(x, y, CELL, CELL);
      g.fillStyle = '#f6f6f2';
      for (let k = 0; k < 16; k++) g.fillRect(x + k * 16 + 2, y, 9, CELL);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 16; k++) g.fillRect(x + k * 16 + 8, y, 3, CELL);
    },
    corrug(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#d9dcdd'; g.fillRect(x, y, CELL, CELL);
      for (let k = 0; k < 64; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(60,64,68,0.22)'; g.fillRect(x + k * 4, y, 2, CELL); }
      g.fillStyle = 'rgba(60,64,68,0.5)'; g.fillRect(x, y + 190, CELL, 4);
    },
    pave(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#c2bcae'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 1200, 0.05, 2, 61);
      g.strokeStyle = 'rgba(80,76,68,0.4)'; g.lineWidth = 2;
      for (let k = 0; k <= CELL; k += 32) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + CELL); g.stroke(); g.beginPath(); g.moveTo(x, y + k); g.lineTo(x + CELL, y + k); g.stroke(); }
    },
    balust(g, x, y, lit) { // stone balustrade: 8 turned balusters (0.2 m pitch when the cell spans 1.6 m), shaded gaps
      if (lit) return;
      g.fillStyle = '#bfb6a0'; g.fillRect(x, y, CELL, CELL);
      for (let k = 0; k < 8; k++) {
        const cx = x + k * 32 + 16;
        const shape = [[0, 14], [14, 22], [36, 12], [48, 18], [66, 27], [92, 22], [118, 17], [146, 12], [170, 17], [196, 24], [222, 30], [250, 32]]; // [y, half-width*2/...]
        for (let i = 0; i < shape.length - 1; i++) {
          const y0 = shape[i][0]; const y1 = shape[i + 1][0]; const w = shape[i][1] * 0.78;
          const grd = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
          grd.addColorStop(0, '#d9d0b8'); grd.addColorStop(0.45, '#f1eadb'); grd.addColorStop(1, '#bcb299');
          g.fillStyle = grd; g.fillRect(cx - w / 2, y + y0, w, y1 - y0 + 1);
        }
      }
      noise(g, x, y, CELL, CELL, 500, 0.04, 2, 121);
    },
    hexfrieze(g, x, y, lit) { // Grand Théâtre: precast frieze of triangular / diamond panels (tan, grey, white) with small dark hexagonal windows
      if (lit) return;
      g.fillStyle = '#d9d7d1'; g.fillRect(x, y, CELL, CELL);
      const cols = ['#cdb89c', '#a9adb2', '#f1efe9', '#c5b497', '#dedbd2'];
      const r = mulberry(131);
      const w = 64; const h = 64;
      for (let row = -1; row < 5; row++) for (let k = -1; k < 5; k++) {
        const cx = x + k * w + (row & 1 ? w / 2 : 0); const cy = y + row * h * 0.5 + 32;
        g.fillStyle = cols[(r() * cols.length) | 0];
        g.beginPath(); g.moveTo(cx, cy - 32); g.lineTo(cx + 30, cy); g.lineTo(cx, cy + 32); g.lineTo(cx - 30, cy); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(cx, cy - 32); g.lineTo(cx + 30, cy); g.lineTo(cx, cy); g.fill();
      }
      g.fillStyle = '#33394a';
      for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) {
        const cx = x + k * w + (row & 1 ? w / 2 : 0) + 32; const cy = y + row * 64 + 40;
        g.beginPath(); g.moveTo(cx - 12, cy - 4); g.lineTo(cx, cy - 12); g.lineTo(cx + 12, cy - 4); g.lineTo(cx + 12, cy + 7); g.lineTo(cx - 12, cy + 7); g.fill();
      }
      noise(g, x, y, CELL, CELL, 700, 0.05, 2, 132);
    },
    schist(g, x, y, lit) { // grey-green slate rubble masonry
      if (lit) return;
      g.fillStyle = '#6f7a7d'; g.fillRect(x, y, CELL, CELL);
      const r = mulberry(141);
      for (let i = 0; i < 70; i++) {
        const cx = x + r() * CELL; const cy = y + r() * CELL; const rw = 14 + r() * 24; const rh = 8 + r() * 14;
        const v = 92 + r() * 54; g.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 6) | 0) + ',' + ((v + 8) | 0) + ')';
        g.beginPath(); g.moveTo(cx - rw, cy); g.lineTo(cx - rw * 0.4, cy - rh); g.lineTo(cx + rw * 0.6, cy - rh * 0.8); g.lineTo(cx + rw, cy + rh * 0.2); g.lineTo(cx + rw * 0.2, cy + rh); g.lineTo(cx - rw * 0.7, cy + rh * 0.7); g.fill();
      }
      g.strokeStyle = 'rgba(30,36,38,0.35)'; g.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) { const yy = y + r() * CELL; g.beginPath(); g.moveTo(x + r() * 40, yy); g.lineTo(x + 180 + r() * 76, yy + (r() - 0.5) * 6); g.stroke(); }
    },
    lights(g, x, y, lit) { // 4 x 4 solid colour swatches (bulbs / neon): emissive at night
      const cs = ['#ff2a2a', '#ff7a1a', '#ffd21a', '#c6ff2a', '#2aff5a', '#1affd8', '#2ab4ff', '#2a4aff', '#8a2aff', '#ff2ae6', '#ff7aa8', '#ffffff', '#fff0b0', '#ffb347', '#7fffd4', '#b0b0ff'];
      cs.forEach((c, i) => { g.fillStyle = c; g.fillRect(x + (i % 4) * 64, y + Math.floor(i / 4) * 64, 64, 64); });
    },
    awning(g, x, y, lit) { // 2 x 2 striped awning fabrics: red/white, blue/white, yellow/red, green/white
      if (lit) return;
      const pairs = [['#d8262b', '#f6f2ea'], ['#2a58b8', '#f6f2ea'], ['#f2c21a', '#d8262b'], ['#2f9a4a', '#f6f2ea']];
      pairs.forEach((p, q) => {
        const ox = x + (q % 2) * 128; const oy = y + Math.floor(q / 2) * 128;
        for (let k = 0; k < 8; k++) { g.fillStyle = p[k & 1]; g.fillRect(ox + k * 16, oy, 16, 128); }
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(ox, oy + 116, 128, 12);
      });
    },
    sign(g, x, y, lit) { // "SCHUEBERFOUER" gate board: drawn 4x narrow so a 4:1 board shows it undistorted
      g.save(); g.translate(x, y); g.scale(0.25, 1);
      if (!lit) { const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#1c3aa0'); grd.addColorStop(1, '#0d1f6b'); g.fillStyle = grd; g.fillRect(0, 0, 1024, 256); }
      g.strokeStyle = lit ? '#ffe9a0' : '#f2c21a'; g.lineWidth = 16; g.strokeRect(14, 14, 996, 228);
      g.font = 'bold 104px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 12; g.strokeStyle = lit ? '#ff9a3a' : '#c8102e'; g.strokeText('SCHUEBERFOUER', 512, 134);
      g.fillStyle = lit ? '#fff7c8' : '#ffd21a'; g.fillText('SCHUEBERFOUER', 512, 134);
      g.restore();
    },
    glow(g, x, y, lit) {
      g.fillStyle = lit ? '#ffffff' : '#fff6d8'; g.fillRect(x, y, CELL, CELL);
    },
    greenroof(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#76844f'; g.fillRect(x, y, CELL, CELL);
      const r = mulberry(71);
      for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(' + ((60 + r() * 60) | 0) + ',' + ((90 + r() * 60) | 0) + ',' + ((40 + r() * 30) | 0) + ',0.55)'; g.beginPath(); g.arc(x + r() * CELL, y + r() * CELL, 3 + r() * 9, 0, 6.3); g.fill(); }
    },
    shell(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#5a6068'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 1800, 0.05, 2, 81);
      for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + k * 32, y, 14, CELL); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + k * 32 + 14, y, 3, CELL); }
    },
    clock(g, x, y, lit) {
      const cx = x + 128; const cy = y + 128;
      if (lit) { g.fillStyle = '#ffffe0'; g.beginPath(); g.arc(cx, cy, 108, 0, 6.3); g.fill(); return; }
      g.fillStyle = '#6d6a60'; g.fillRect(x, y, CELL, CELL);
      g.fillStyle = '#f5f2e6'; g.beginPath(); g.arc(cx, cy, 112, 0, 6.3); g.fill();
      g.strokeStyle = '#1d1d1d'; g.lineWidth = 8; g.beginPath(); g.arc(cx, cy, 112, 0, 6.3); g.stroke();
      g.lineWidth = 6;
      for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6; g.beginPath(); g.moveTo(cx + Math.sin(a) * 92, cy - Math.cos(a) * 92); g.lineTo(cx + Math.sin(a) * 106, cy - Math.cos(a) * 106); g.stroke(); }
      g.lineWidth = 9; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(2.4) * 54, cy - Math.cos(2.4) * 54); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(0.3) * 90, cy - Math.cos(0.3) * 90); g.stroke();
    },
    plaza(g, x, y, lit) { // EU flag square: grey concrete pavers, a pale diagonal stripe pattern
      if (lit) return;
      g.fillStyle = '#8c9093'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 1800, 0.06, 2, 101);
      const r = mulberry(102);
      g.strokeStyle = 'rgba(40,44,48,0.28)'; g.lineWidth = 1.5;
      for (let k = 0; k <= CELL; k += 16) { g.beginPath(); g.moveTo(x, y + k); g.lineTo(x + CELL, y + k); g.stroke(); }
      for (let row = 0; row < 16; row++) for (let k = (row % 2) * 16; k <= CELL; k += 32) { g.beginPath(); g.moveTo(x + k, y + row * 16); g.lineTo(x + k, y + row * 16 + 16); g.stroke(); }
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '0,0,0') + ',0.05)'; g.fillRect(x + ((r() * 16) | 0) * 16, y + ((r() * 16) | 0) * 16, 32, 16); }
      g.strokeStyle = '#e9ebed'; g.lineWidth = 7; // the pale diagonals
      g.beginPath(); g.moveTo(x, y + CELL); g.lineTo(x + CELL, y); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x + CELL - 14, y + CELL); g.stroke();
    },
    panel(g, x, y, lit, v) { // coloured cladding panels (tinted orange / lime by the vertex colour): 4 x 3 panels with dark joints
      if (lit) return;
      g.fillStyle = '#f4f4f1'; g.fillRect(x, y, CELL, CELL);
      noise(g, x, y, CELL, CELL, 500, 0.03, 2, 111);
      g.strokeStyle = 'rgba(60,64,66,0.55)'; g.lineWidth = 3;
      for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(x + k * 64, y); g.lineTo(x + k * 64, y + CELL); g.stroke(); }
      for (let k = 0; k <= 3; k++) { g.beginPath(); g.moveTo(x, y + k * 85); g.lineTo(x + CELL, y + k * 85); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x + 64, y + 85, 64, 85); g.fillRect(x + 192, y, 64, 85);
    },
    metal(g, x, y, lit) { // standing-seam grey metal cladding
      if (lit) return;
      g.fillStyle = '#a4aaaf'; g.fillRect(x, y, CELL, CELL);
      for (let k = 0; k < 32; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)'; g.fillRect(x + k * 8, y, 4, CELL); }
      g.fillStyle = 'rgba(40,44,48,0.4)'; g.fillRect(x, y + CELL - 6, CELL, 6);
    },
    flags(g, x, y, lit) { // 28 national flags (4 x 7 swatches of 64 x 36)
      if (lit) return;
      const defs = [['#1d3f94', '#ffffff', '#c8102e', 'h'], ['#000000', '#dd0000', '#ffce00', 'h'], ['#ed2939', '#ffffff', '#ed2939', 'v'], ['#009246', '#ffffff', '#ce2b37', 'v'], ['#0055a4', '#ffffff', '#ef4135', 'v'], ['#ae1c28', '#ffffff', '#21468b', 'h'], ['#ffd100', '#ffd100', '#d52b1e', 'h'], ['#003399', '#003399', '#ffcc00', 'star'],
        ['#ffffff', '#ce1126', '#ffffff', 'h'], ['#006aa7', '#fecc00', '#006aa7', 'cross'], ['#c60b1e', '#ffc400', '#c60b1e', 'h'], ['#169b62', '#ffffff', '#ff883e', 'v'], ['#c8102e', '#ffffff', '#c8102e', 'cross'], ['#fcd116', '#006b3f', '#ce1126', 'h'], ['#d52b1e', '#ffffff', '#d52b1e', 'h'], ['#0d5eaf', '#ffffff', '#0d5eaf', 'cross'],
        ['#ffffff', '#cd2e3a', '#003478', 'h'], ['#00209f', '#ffffff', '#d21034', 'v'], ['#006a4e', '#006a4e', '#f42a41', 'h'], ['#ffd700', '#0057b8', '#ffd700', 'h'], ['#2b7a3d', '#ffffff', '#c8102e', 'h'], ['#003893', '#ffffff', '#ce1126', 'h'], ['#ffffff', '#12a05a', '#c8102e', 'h'], ['#ce1126', '#ffffff', '#00a550', 'h'],
        ['#00247d', '#cf142b', '#ffffff', 'cross'], ['#fecb00', '#0f47af', '#c8102e', 'h'], ['#1d3f94', '#ffd100', '#1d3f94', 'star'], ['#e30a17', '#ffffff', '#e30a17', 'h']];
      for (let i = 0; i < 28; i++) {
        const fx = x + (i % 4) * 64; const fy = y + Math.floor(i / 4) * 36; const d = defs[i];
        if (d[3] === 'v') { const w = 64 / 3; [d[0], d[1], d[2]].forEach((c, k) => { g.fillStyle = c; g.fillRect(fx + k * w, fy, w + 0.5, 36); }); }
        else if (d[3] === 'cross') { g.fillStyle = d[0]; g.fillRect(fx, fy, 64, 36); g.fillStyle = d[1]; g.fillRect(fx + 18, fy, 12, 36); g.fillRect(fx, fy + 12, 64, 12); }
        else if (d[3] === 'star') { g.fillStyle = d[0]; g.fillRect(fx, fy, 64, 36); g.fillStyle = d[1]; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.fillRect(fx + 32 + Math.cos(a) * 11 - 1.5, fy + 18 + Math.sin(a) * 11 - 1.5, 3, 3); } }
        else { const h = 36 / 3; [d[0], d[1], d[2]].forEach((c, k) => { g.fillStyle = c; g.fillRect(fx, fy + k * h, 64, h + 0.5); }); }
      }
    },
    fins(g, x, y, lit) { // light grey tower facade: slender vertical fins, glass between, pale spandrel
      if (lit) { g.fillStyle = '#f2ecd8'; g.fillRect(x + 40, y + 20, CELL - 80, 130); return; }
      g.fillStyle = '#dfe2e2'; g.fillRect(x, y, CELL, CELL);
      const grd = g.createLinearGradient(x, y + 10, x, y + 170); grd.addColorStop(0, '#c9dde3'); grd.addColorStop(1, '#8aa9b6');
      g.fillStyle = grd; g.fillRect(x + 22, y + 10, CELL - 44, 168);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(x + 22, y + 140); g.lineTo(x + 130, y + 10); g.lineTo(x + 170, y + 10); g.lineTo(x + 22, y + 170); g.fill();
      g.fillStyle = '#eceeee'; g.fillRect(x, y, 22, CELL); g.fillRect(x + CELL - 22, y, 22, CELL); g.fillRect(x + CELL / 2 - 4, y + 10, 8, 168);
      g.fillStyle = '#b9bfc1'; g.fillRect(x, y + 178, CELL, 6); g.fillStyle = '#e6e8e8'; g.fillRect(x, y + 184, CELL, 72);
    },
    blinds(g, x, y, lit) { // KAD1: silver spandrel bands with maroon sun-blind strips and dark glass
      if (lit) { g.fillStyle = '#ffe3a8'; g.fillRect(x + 8, y + 150, CELL - 16, 36); return; }
      g.fillStyle = '#e6e9ea'; g.fillRect(x, y, CELL, CELL);
      g.fillStyle = '#8b3a44'; g.fillRect(x + 6, y + 26, CELL - 12, 58);
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 6; k++) g.fillRect(x + 6, y + 30 + k * 9, CELL - 12, 2);
      g.fillStyle = '#7f98a6'; g.fillRect(x + 6, y + 146, CELL - 12, 44);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 6, y + 146, CELL - 12, 10);
      g.fillStyle = '#f0f2f2'; g.fillRect(x, y + 200, CELL, 8);
    },
    brick(g, x, y, lit) {
      if (lit) return;
      g.fillStyle = '#a45f49'; g.fillRect(x, y, CELL, CELL);
      const r = mulberry(91);
      for (let row = 0; row < 32; row++) for (let k = 0; k < 8; k++) {
        const v = 0.8 + r() * 0.35; g.fillStyle = 'rgb(' + ((172 * v) | 0) + ',' + ((92 * v) | 0) + ',' + ((72 * v) | 0) + ')';
        g.fillRect(x + k * 32 + (row % 2) * 16 - 16 + 1, y + row * 8 + 1, 30, 6);
      }
    },
  };
  function paintMulti(kind, lit) { // 4 x 4 bays in one cell (far LOD facades)
    return (g, x, y) => {
      const r = mulberry(kind === 'curtainLo' ? 5 : kind === 'punchedLo' ? 6 : kind === 'ribbonLo' ? 7 : 8);
      const s = CELL / 4;
      for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
        const px = x + bx * s; const py = y + fy * s; const on = r() < 0.4;
        if (lit) {
          if (!on) continue;
          g.fillStyle = r() > 0.5 ? '#ffd993' : '#f4f0dc';
          if (kind === 'curtainLo') g.fillRect(px + 2, py + s * 0.06, s - 4, s * 0.58);
          else if (kind === 'punchedLo') g.fillRect(px + s * 0.27, py + s * 0.2, s * 0.46, s * 0.56);
          else if (kind === 'ribbonLo') g.fillRect(px + 1, py + s * 0.23, s - 2, s * 0.44);
          else g.fillRect(px + 4, py + s * 0.58, s - 8, s * 0.25);
          continue;
        }
        if (kind === 'curtainLo') {
          g.fillStyle = '#d3d8da'; g.fillRect(px, py, s, s);
          const grd = g.createLinearGradient(px, py, px + s, py + s * 0.66); grd.addColorStop(0, '#9db8c8'); grd.addColorStop(1, '#4d6a7c');
          g.fillStyle = grd; g.fillRect(px + 2, py + s * 0.06, s - 4, s * 0.58);
        } else if (kind === 'punchedLo') {
          g.fillStyle = '#efe9db'; g.fillRect(px, py, s, s);
          g.fillStyle = '#3b5062'; g.fillRect(px + s * 0.27, py + s * 0.2, s * 0.46, s * 0.56);
          g.fillStyle = '#d9d3c4'; g.fillRect(px + s * 0.22, py + s * 0.76, s * 0.56, s * 0.05);
        } else if (kind === 'ribbonLo') {
          g.fillStyle = '#efeeea'; g.fillRect(px, py, s, s);
          g.fillStyle = '#56748a'; g.fillRect(px, py + s * 0.23, s, s * 0.44);
        } else {
          g.fillStyle = '#c99d33'; g.fillRect(px, py, s, s);
          g.fillStyle = 'rgba(50,50,56,0.4)'; g.fillRect(px, py + s * 0.58, s, s * 0.25);
        }
      }
    };
  }
  function paintCell(g, name, x, y, lit) {
    const m = /^(curtain|punched|ribbon|gold)(\d)$/.exec(name);
    if (m) return PAINT[m[1]](g, x, y, lit, +m[2]);
    if (name === 'curtainLo' || name === 'punchedLo' || name === 'ribbonLo' || name === 'goldLo') return paintMulti(name, lit)(g, x, y);
    return PAINT[name](g, x, y, lit);
  }
  function makeAtlas() {
    if (atlas) return atlas;
    const mk = (lit, scale) => {
      const c = document.createElement('canvas');
      c.width = CELL * COLS * scale; c.height = CELL * ROWS * scale;
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.fillStyle = lit ? '#000' : '#cfcfcf'; g.fillRect(0, 0, CELL * COLS, CELL * ROWS);
      CELL_NAMES.forEach((n, i) => { const cx = (i % COLS) * CELL; const cy = Math.floor(i / COLS) * CELL; g.save(); g.beginPath(); g.rect(cx, cy, CELL, CELL); g.clip(); paintCell(g, n, cx, cy, lit); g.restore(); });
      const t = new T.CanvasTexture(c);
      t.colorSpace = lit ? T.SRGBColorSpace : T.SRGBColorSpace;
      t.anisotropy = 4;
      t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
      return t;
    };
    atlas = { day: mk(false, 1), lit: mk(true, 0.5) };
    return atlas;
  }

  /* ================================================================== geometry accumulator + primitives */
  class Geo {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    vert(x, y, z, nx, ny, nz, u, v, c) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(c[0], c[1], c[2]);
      return this.p.length / 3 - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
    toGeometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]; const q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
  const centroid = (r) => { let x = 0; let z = 0; r.forEach((p) => { x += p[0]; z += p[1]; }); return [x / r.length, z / r.length]; };
  const orient = (r, negative) => ((area2(r) < 0) === negative ? r.slice() : r.slice().reverse());
  const scaleRing = (r, k, c) => { const m = c || centroid(r); return r.map((p) => [m[0] + (p[0] - m[0]) * k, m[1] + (p[1] - m[1]) * k]); };
  const rot2 = (x, z, a) => { const c = Math.cos(a); const s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; };
  const bbox = (r) => { let x0 = 1e9; let z0 = 1e9; let x1 = -1e9; let z1 = -1e9; r.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); return [x0, z0, x1, z1]; };
  function insetRing(r, d) { // offset a (roughly convex) ring inwards by d metres, per-vertex along the angle bisector
    const o = orient(r, true); const n = o.length; const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = o[(i + n - 1) % n]; const p1 = o[i]; const p2 = o[(i + 1) % n];
      let e1 = [p1[0] - p0[0], p1[1] - p0[1]]; let e2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const l1 = Math.hypot(e1[0], e1[1]) || 1; const l2 = Math.hypot(e2[0], e2[1]) || 1;
      e1 = [e1[0] / l1, e1[1] / l1]; e2 = [e2[0] / l2, e2[1] / l2];
      const n1 = [-e1[1], e1[0]]; const n2 = [-e2[1], e2[0]]; // outward normals for negative-area rings
      let bx = n1[0] + n2[0]; let bz = n1[1] + n2[1]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const k = clamp(bx * n1[0] + bz * n1[1], 0.35, 1);
      out.push([p1[0] - (bx * d) / k, p1[1] - (bz * d) / k]);
    }
    return out;
  }

  /* wall style: { cell: 'curtain'|'punched'|'ribbon'|'gold'|'ashlar'|'plain'|'diamond'|'corrug'|'columns'|'brick'|'shell'|'slate'|'greenroof'|'pave'|..., bay, floor, color, jitter } */
  const LO_CELL = { curtain: 'curtainLo', punched: 'punchedLo', ribbon: 'ribbonLo', gold: 'goldLo' };
  const VARIANTS = { curtain: 4, punched: 4, ribbon: 4, gold: 2 };
  let tileSeed = 1;
  function wall(g, ax, az, bx, bz, y0, y1, st, hi, flip) {
    const dx = bx - ax; const dz = bz - az; const L = Math.hypot(dx, dz);
    const H = y1 - y0;
    if (L < 0.05 || H < 0.05) return;
    const base = st.color || WHITE;
    let nx = -dz / L; let nz = dx / L;
    if (flip) { nx = -nx; nz = -nz; }
    const cellName = st.cell || 'plain';
    const bay = st.bay || 3.6; const flo = st.floor || 3.6;
    const multi = VARIANTS[cellName];
    let nb; let nf; let name = cellName; let lo = false;
    if (hi || !LO_CELL[cellName]) {
      nb = Math.max(1, Math.round(L / bay)); nf = Math.max(1, Math.round(H / flo));
    } else {
      nb = Math.max(1, Math.round(L / (bay * 4))); nf = Math.max(1, Math.round(H / (flo * 4)));
      name = LO_CELL[cellName]; lo = true;
    }
    const maxT = hi ? 6000 : 600;
    if (nb * nf > maxT) { const k = Math.sqrt(maxT / (nb * nf)); nb = Math.max(1, Math.floor(nb * k)); nf = Math.max(1, Math.floor(nf * k)); }
    const jit = st.jitter === undefined ? 0.06 : st.jitter;
    for (let f = 0; f < nf; f++) {
      const ya = y0 + (H * f) / nf; const yb = y0 + (H * (f + 1)) / nf;
      for (let b = 0; b < nb; b++) {
        const t0 = b / nb; const t1 = (b + 1) / nb;
        const x0 = ax + dx * t0; const z0 = az + dz * t0; const x1 = ax + dx * t1; const z1 = az + dz * t1;
        let nm = name;
        if (multi && !lo) nm = cellName + ((hash2(b * 7 + f, tileSeed) * multi) | 0);
        const r = RECTS[nm];
        const k = 1 + (hash2(b + f * 131, tileSeed + 5) - 0.5) * jit;
        const c = [base[0] * k, base[1] * k, base[2] * k];
        let i0; let i1; let i2; let i3;
        if (flip) {
          i0 = g.vert(x1, ya, z1, nx, 0, nz, r[0], r[1], c); i1 = g.vert(x0, ya, z0, nx, 0, nz, r[2], r[1], c);
          i2 = g.vert(x0, yb, z0, nx, 0, nz, r[2], r[3], c); i3 = g.vert(x1, yb, z1, nx, 0, nz, r[0], r[3], c);
        } else {
          i0 = g.vert(x0, ya, z0, nx, 0, nz, r[0], r[1], c); i1 = g.vert(x1, ya, z1, nx, 0, nz, r[2], r[1], c);
          i2 = g.vert(x1, yb, z1, nx, 0, nz, r[2], r[3], c); i3 = g.vert(x0, yb, z0, nx, 0, nz, r[0], r[3], c);
        }
        g.quad(i0, i1, i2, i3);
      }
    }
    tileSeed = (tileSeed * 1664525 + 1013904223) | 0;
  }
  /* arbitrary planar quad, a b c d counter-clockwise seen from outside, uv spans the whole cell (or uv = [u0,v0,u1,v1]) */
  function quadP(g, a, b, c, d, cellName, color, uvRepeat) {
    const n = norm(cross(sub(b, a), sub(d, a)));
    const r = RECTS[cellName];
    const k = uvRepeat || 1;
    const uu = (t) => lerp(r[0], r[2], t);
    const vv = (t) => lerp(r[1], r[3], t);
    void k;
    const i0 = g.vert(a[0], a[1], a[2], n[0], n[1], n[2], uu(0), vv(0), color);
    const i1 = g.vert(b[0], b[1], b[2], n[0], n[1], n[2], uu(1), vv(0), color);
    const i2 = g.vert(c[0], c[1], c[2], n[0], n[1], n[2], uu(1), vv(1), color);
    const i3 = g.vert(d[0], d[1], d[2], n[0], n[1], n[2], uu(0), vv(1), color);
    g.quad(i0, i1, i2, i3);
  }
  /* tiled planar quad: nb x nf cell tiles over the parallelogram a(b-a) (d-a) */
  function tiledQuad(g, a, b, d, nb, nf, cellName, color, hi) {
    const r = RECTS[cellName];
    const n = norm(cross(sub(b, a), sub(d, a)));
    const ex = sub(b, a); const ey = sub(d, a);
    nb = Math.max(1, nb); nf = Math.max(1, nf);
    const maxT = hi ? 3000 : 300;
    if (nb * nf > maxT) { const k = Math.sqrt(maxT / (nb * nf)); nb = Math.max(1, Math.floor(nb * k)); nf = Math.max(1, Math.floor(nf * k)); }
    for (let f = 0; f < nf; f++) for (let q = 0; q < nb; q++) {
      const p = (s, t) => [a[0] + ex[0] * ((q + s) / nb) + ey[0] * ((f + t) / nf), a[1] + ex[1] * ((q + s) / nb) + ey[1] * ((f + t) / nf), a[2] + ex[2] * ((q + s) / nb) + ey[2] * ((f + t) / nf)];
      const p0 = p(0, 0); const p1 = p(1, 0); const p2 = p(1, 1); const p3 = p(0, 1);
      const i0 = g.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], r[0], r[1], color);
      const i1 = g.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], r[2], r[1], color);
      const i2 = g.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], r[2], r[3], color);
      const i3 = g.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], r[0], r[3], color);
      g.quad(i0, i1, i2, i3);
    }
  }
  /* horizontal polygon (with holes) at height y facing up (or down), solid pattern from one cell centre */
  function flatPoly(g, ring, holes, y, cellName, color, down) {
    const outer = orient(ring, false);
    const hs = (holes || []).map((h) => orient(h, true));
    const contour = outer.map((p) => new T.Vector2(p[0], p[1]));
    const hv = hs.map((h) => h.map((p) => new T.Vector2(p[0], p[1])));
    let tris;
    try { tris = T.ShapeUtils.triangulateShape(contour, hv); } catch (e) { tris = null; }
    if (!tris || !tris.length) return;
    const all = outer.concat(...hs);
    const r = RECTS[cellName];
    const u = lerp(r[0], r[2], 0.43); const v = lerp(r[1], r[3], 0.43);
    const base = g.count;
    const ny = down ? -1 : 1;
    all.forEach((p) => g.vert(p[0], y, p[1], 0, ny, 0, u, v, color));
    tris.forEach((t) => {
      const a = all[t[0]]; const b = all[t[1]]; const c = all[t[2]];
      const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); // y component of (b-a) x (c-a) with x,z plane
      const up = cy > 0 !== !!down;
      if (up) g.tri(base + t[0], base + t[1], base + t[2]); else g.tri(base + t[0], base + t[2], base + t[1]);
    });
  }
  /* extruded footprint: walls (outer + holes), flat roof */
  function prism(g, ring, holes, y0, y1, st, roofSt, hi) {
    const o = orient(ring, true);
    for (let i = 0; i < o.length; i++) { const p = o[i]; const q = o[(i + 1) % o.length]; wall(g, p[0], p[1], q[0], q[1], y0, y1, st, hi, false); }
    (holes || []).forEach((h) => {
      const hh = orient(h, false);
      for (let i = 0; i < hh.length; i++) { const p = hh[i]; const q = hh[(i + 1) % hh.length]; wall(g, p[0], p[1], q[0], q[1], y0, y1, st, hi, false); }
    });
    if (roofSt !== false) {
      const rs = roofSt || {};
      flatPoly(g, o, holes, y1, rs.cell || 'roofGrey', rs.color || col('#8d8f8e'), false);
    }
  }
  function box(g, cx, cy, cz, sx, sy, sz, rot, st, roofSt, hi) { // cy = centre height
    const hx = sx / 2; const hz = sz / 2; const a = rot || 0;
    const cs = Math.cos(a); const sn = Math.sin(a);
    const ring = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map((p) => [cx + p[0] * cs - p[1] * sn, cz + p[0] * sn + p[1] * cs]); // local x -> (cos a, sin a)
    prism(g, ring, null, cy - sy / 2, cy + sy / 2, st, roofSt, hi);
  }
  function cylinder(g, cx, cz, y0, y1, r0, r1, seg, st, capSt, hi, cut) {
    const ring = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]); }
    const o = orient(ring, true);
    const topRing = o.map((p) => [cx + (p[0] - cx) * (r1 / r0), cz + (p[1] - cz) * (r1 / r0)]);
    const c = st.color || WHITE;
    const rr = RECTS[st.cell || 'plain'];
    const hs = hi ? Math.max(1, Math.round((y1 - y0) / (st.floor || 3.6))) : 1;
    for (let i = 0; i < o.length; i++) {
      const j = (i + 1) % o.length;
      for (let f = 0; f < hs; f++) {
        const t0 = f / hs; const t1 = (f + 1) / hs;
        const a0 = [lerp(o[i][0], topRing[i][0], t0), lerp(y0, y1, t0), lerp(o[i][1], topRing[i][1], t0)];
        const b0 = [lerp(o[j][0], topRing[j][0], t0), lerp(y0, y1, t0), lerp(o[j][1], topRing[j][1], t0)];
        const b1 = [lerp(o[j][0], topRing[j][0], t1), lerp(y0, y1, t1), lerp(o[j][1], topRing[j][1], t1)];
        const a1 = [lerp(o[i][0], topRing[i][0], t1), lerp(y0, y1, t1), lerp(o[i][1], topRing[i][1], t1)];
        const n = norm(cross(sub(b0, a0), sub(a1, a0)));
        const vi = [a0, b0, b1, a1].map((p, k) => g.vert(p[0], p[1], p[2], n[0], n[1], n[2], k === 0 || k === 3 ? rr[0] : rr[2], k < 2 ? rr[1] : rr[3], c));
        g.quad(vi[0], vi[1], vi[2], vi[3]);
      }
    }
    if (capSt !== false) flatPoly(g, topRing, null, y1, (capSt && capSt.cell) || 'roofGrey', (capSt && capSt.color) || col('#8d8f8e'), false);
    void cut;
  }
  function cone(g, cx, cz, y0, r, h, seg, cellName, color, y1r) {
    const rr = RECTS[cellName]; const u = (rr[0] + rr[2]) / 2; const v = (rr[1] + rr[3]) / 2;
    const top = y1r === undefined ? 0 : y1r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2; const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r]; const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const q0 = [cx + Math.cos(a0) * top, y0 + h, cz + Math.sin(a0) * top]; const q1 = [cx + Math.cos(a1) * top, y0 + h, cz + Math.sin(a1) * top];
      const n = norm(cross(sub(p1, p0), sub(q0, p0)));
      const nn = (n[0] * (p0[0] - cx) + n[2] * (p0[2] - cz)) < 0 ? [-n[0], -n[1], -n[2]] : n;
      const i0 = g.vert(p0[0], p0[1], p0[2], nn[0], nn[1], nn[2], u, v, color); const i1 = g.vert(p1[0], p1[1], p1[2], nn[0], nn[1], nn[2], u, v, color);
      const i2 = g.vert(q1[0], q1[1], q1[2], nn[0], nn[1], nn[2], u, v, color); const i3 = g.vert(q0[0], q0[1], q0[2], nn[0], nn[1], nn[2], u, v, color);
      const flip = (n[0] * (p0[0] - cx) + n[2] * (p0[2] - cz)) < 0;
      if (top > 0) { if (flip) g.quad(i1, i0, i3, i2); else g.quad(i0, i1, i2, i3); } else if (flip) g.tri(i1, i0, i2); else g.tri(i0, i1, i2);
    }
  }
  /* oriented beam (rectangular section w x h) between points a and b, "up" hint for the section */
  function beam(g, a, b, w, h, color, cellName, up) {
    const d = norm(sub(b, a));
    let u = up || [0, 1, 0];
    let s = cross(d, u);
    if (Math.hypot(s[0], s[1], s[2]) < 1e-4) { u = [1, 0, 0]; s = cross(d, u); }
    s = norm(s); u = norm(cross(s, d));
    const hw = w / 2; const hh = h / 2;
    const corner = (p, sx, sy) => [p[0] + s[0] * hw * sx + u[0] * hh * sy, p[1] + s[1] * hw * sx + u[1] * hh * sy, p[2] + s[2] * hw * sx + u[2] * hh * sy];
    const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
    const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
    const cn = cellName || 'plain';
    quadP(g, A[0], B[0], B[1], A[1], cn, color); // bottom
    quadP(g, A[1], B[1], B[2], A[2], cn, color); // side +s
    quadP(g, A[2], B[2], B[3], A[3], cn, color); // top
    quadP(g, A[3], B[3], B[0], A[0], cn, color); // side -s
    quadP(g, A[0], A[1], A[2], A[3], cn, color); // cap a
    quadP(g, B[1], B[0], B[3], B[2], cn, color); // cap b
  }

  /* ================================================================== registry */
  const FP = /*FP-BEGIN*/{"philharmonie":{"a":[49.618433,6.142455],"p":[{"id":37847301,"role":"hall","r":[-430,-252,-423,-211,-404,-178,-364,-135,-350,-166,-339,-161,-335,-158,-358,-90,-371,-23,-380,56,-376,166,-367,225,-339,327,-305,478,-300,498,-42,544,239,562,378,560,383,473,448,428,497,355,521,288,531,183,524,125,501,48,459,-35,387,99,271,265,240,249,278,195,319,124,355,43,391,-63,400,-192,388,-338,333,-608,222,-583,-202,-489,-193,-455,-249,-443,-306,-418,-363,-388,-399,-356,-424,-306],"h":23.0,"hm":23.5,"hx":25.7,"g":0.9}],"a0":324.67,"ad":324.67,"lg":[[361,-479,377,-410,382,-388,394,-326,395,-323,402,-264,402,-261,404,-203,404,-202,402,-144,402,-139,394,-77,393,-73,381,-17,381,-16,366,34,364,44,347,85,341,102,326,133,314,158,298,185,282,212,264,237,246,263,230,282,206,311,195,321,192,324,218,347,231,334,238,327,242,322,246,319,290,266,339,207,380,142,412,73,450,-14,460,-38,490,21,512,84,524,148,528,214,521,280,511,323,493,362,469,399,439,430,404,457,389,465,381,555,367,555,334,556,317,557,284,558,267,558,259,558,234,558,222,558,200,558,185,557,173,557,141,555,129,555,96,553,88,553,1,545,-67,538,-136,527,-197,517,-302,495,-348,279,-359,240,-362,229,-366,204,-372,173,-373,164,-377,116,-377,116,-377,59,-377,52,-374,14,-373,2,-366,-38,-363,-55,-354,-91,-349,-110,-334,-152,-330,-163,-351,-172,-364,-140,-366,-142,-383,-157,-395,-173,-398,-177,-410,-196,-411,-199,-420,-220,-426,-243,-426,-245,-427,-269,-425,-294,-425,-295,-419,-319,-407,-341,-392,-362,-373,-379,-352,-393,-258,-437,-157,-464,-62,-473,-58,-476,-22,-494,-13,-498,23,-512,33,-517,94,-539,104,-543,155,-562,194,-577,223,-584,332,-609,346,-546]]},"mudam":{"a":[49.616789,6.140164],"p":[{"id":9042342,"role":"museum","r":[281,-315,287,-17,102,189,197,285,280,286,311,314,312,396,282,430,205,430,166,396,166,315,73,224,-22,314,-31,309,-39,-4,-205,-169,-284,-148,-361,-143,-437,-151,-511,-172,-418,-270,-416,-396,-294,-400,-206,-494,96,-497,189,-406],"h":20.0,"hm":21.5,"hx":22.7,"g":NaN},{"id":26424184,"role":"fort","r":[-739,477,-750,486,-763,491,-777,493,-791,492,-804,486,-815,478,-824,466,-829,453,-831,439,-829,425,-824,412,-815,401,-804,393,-791,387,-777,385,-763,387,-750,393,-739,401,-703,386,-667,357,-630,328,-579,271,-526,216,-506,186,-498,167,-495,151,-500,136,-529,106,-550,82,-551,65,-545,50,-529,41,-262,32,-249,32,-230,48,-230,63,-248,355,-253,373,-265,380,-275,379,-283,375,-300,354,-352,303,-365,301,-376,305,-432,354,-480,404,-519,452,-578,541,-581,568,-578,580,-577,593,-580,605,-584,615,-593,626,-604,635,-617,640,-631,642,-645,640,-658,635,-669,626,-678,615,-683,602,-685,588,-683,574,-678,561,-669,550,-658,541,-727,487],"h":11.0,"hm":null,"hx":null,"g":0}],"a0":305.35,"ad":null,"lg":[[-663,552,-661,551,-722,498,-835,628,-853,612,-739,482,-741,481,-745,485,-761,492,-779,493,-796,489,-811,479,-821,465,-827,448,-827,431,-821,414,-811,400,-796,390,-779,386,-761,387,-745,394,-742,397,-740,395,-696,363,-654,328,-613,291,-574,252,-538,211,-504,169,-501,163,-500,157,-501,151,-504,146,-557,86,-561,75,-562,64,-559,53,-553,44,-545,37,-535,32,-525,32,-247,31,-242,32,-237,34,-233,38,-230,43,-229,48,-241,358,-243,368,-248,376,-256,383,-265,387,-275,387,-285,385,-293,379,-298,372,-352,309,-356,306,-359,305,-362,305,-366,305,-369,308,-403,336,-436,366,-467,398,-496,431,-524,466,-550,502,-574,540,-586,559,-588,564,-583,572,-580,588,-583,604,-591,618,-603,629,-617,636,-634,637,-649,633,-663,624,-673,612,-678,596,-678,580,-673,565],[257,14,231,40,223,49,197,76,166,108,87,190,190,288,190,288,269,284,301,315,303,397,272,428,193,428,177,412,161,397,160,320,163,317,60,218,-27,306,-32,2,-111,-76,-137,-102,-132,-107,-210,-181,-232,-173,-255,-167,-278,-162,-301,-158,-325,-155,-348,-154,-372,-154,-396,-155,-419,-157,-442,-160,-466,-165,-488,-170,-511,-177,-476,-213,-446,-245,-427,-263,-429,-366,-429,-392,-401,-392,-300,-393,-290,-404,-289,-405,-262,-433,-255,-441,-228,-469,-221,-476,-208,-490,-2,-493,277,-497,281,-217,281,-209,281,-199,282,-172,282,-163,282,-137,282,-128,283,-101,283,-93,283,-66,283,-57,284,-30,284,-21,284,-14,265,5]]},"coque":{"a":[49.623403,6.151963],"p":[{"id":218592870,"role":"pool","r":[-439,506,-408,506,-378,497,-353,478,-336,452,-327,423,245,563,479,641,476,662,481,683,493,701,510,714,530,720,552,719,572,711,587,696,597,677,599,656,595,635,583,617,566,604,545,598,524,599,521,545,512,324,523,202,547,203,573,194,597,171,606,149,606,126,599,104,589,89,570,74,555,69,532,67,509,74,489,88,454,68,399,2,356,-62,321,-140,292,-212,281,-256,305,-260,328,-275,341,-294,347,-321,345,-340,336,-359,320,-375,300,-386,272,-387,241,-374,222,-351,215,-326,89,-400,48,-424,-49,-481,-130,-530,-116,-551,-112,-575,-115,-590,-117,-600,-131,-621,-152,-635,-177,-639,-202,-633,-223,-619,-236,-597,-240,-572,-237,-555,-637,-561,-635,-585,-641,-608,-656,-627,-677,-639,-701,-642,-725,-636,-744,-622,-757,-602,-762,-578,-757,-555,-744,-534,-724,-521,-701,-515,-677,-519,-592,-254,-458,292,-488,301,-514,319,-533,343,-543,373,-544,404,-512,398,-482,379,-460,364,-434,363,-412,376,-400,399,-403,425,-419,446,-433,473],"lv":4,"rs":"dome","hm":15.3,"hx":17.3,"g":-0.0},{"id":22762585,"role":"arena","r":[1345,-699,1090,-718,950,-717,810,-709,670,-692,532,-667,403,-634,319,-613,359,-523,440,-366,520,-238,636,-70,780,93,891,205,908,183,937,217,977,243,1021,252,1051,245,1045,282,1156,291,1309,297,1431,295,1559,287,1684,270,1798,249,1937,216,2038,187,2029,162,2073,153,2109,134,2140,108,2162,73,2180,90,2259,-30,2318,-124,2378,-228,2433,-332,2474,-428,2510,-526,2555,-664,2576,-739,2598,-820,2530,-833,2393,-841,2255,-838,2109,-828,1976,-811,1839,-789,1579,-723,1658,-885,1607,-908,1608,-921,1601,-933,1589,-942,1572,-942,1559,-935,1553,-924,1480,-960,1439,-955,1398,-951,1333,-902,1323,-914,1309,-918,1295,-915,1284,-905,1280,-891,1283,-877,1237,-844],"lv":4,"rs":"dome","hm":18.1,"hx":19.3,"g":-0.0},{"id":218592872,"role":"b1","r":[970,721,1072,655,1066,647,1133,555,1188,481,1143,455,1183,406,1361,435,1542,440,1676,419,1682,481,1732,470,1760,401,1929,345,2103,256,2255,143,2389,13,2477,-98,2550,-101,2580,-150,2522,-177,2608,-348,2672,-346,2714,-474,2665,-545,2693,-730,2657,-732,2611,-736,2576,-739,2555,-664,2510,-526,2474,-428,2433,-332,2378,-228,2318,-124,2259,-30,2180,90,2162,73,2140,108,2109,134,2073,153,2029,162,2038,187,1937,216,1798,249,1684,270,1559,287,1431,295,1309,297,1156,291,1045,282,1051,245,1021,252,977,243,937,217,908,183,891,205,780,93,740,168,709,204,684,233,612,283,556,313,586,342,720,475],"lv":1,"hm":4.4,"hx":15.7,"g":-0.1},{"id":218592869,"role":"b2","r":[89,-400,215,-326,222,-351,241,-374,272,-387,300,-386,320,-375,336,-359,345,-340,347,-321,341,-294,328,-275,305,-260,281,-256,292,-212,321,-140,356,-62,399,2,454,68,489,88,509,74,532,67,555,69,570,74,589,89,599,104,606,126,606,149,597,171,573,194,547,203,523,202,512,324,556,313,612,283,684,233,709,204,740,168,780,93,636,-70,520,-238,440,-366,359,-523,315,-519,272,-510,230,-496,178,-471,131,-439],"lv":2,"hm":10.8,"hx":15.6,"g":-0.0}],"a0":338.57,"ad":338.57,"lg":[[439,53,431,43,423,33,414,22,406,11,398,0,391,-11,383,-22,376,-34,369,-45,362,-57,355,-69,348,-81,342,-93,336,-105,330,-118,325,-130,320,-143,315,-155,310,-168,305,-180,301,-192,297,-205,300,-208,298,-213,297,-214,290,-231,285,-241,299,-256,295,-264,306,-269,318,-276,334,-294,339,-303,342,-316,343,-324,340,-338,337,-347,329,-361,321,-369,315,-372,305,-378,292,-382,280,-382,265,-379,251,-373,245,-369,236,-359,231,-350,226,-337,188,-351,183,-338,171,-344,154,-354,137,-363,120,-372,103,-382,86,-391,96,-402,128,-431,161,-454,187,-471,219,-486,257,-500,293,-511,322,-517,360,-521,361,-521,343,-559,319,-614,377,-632,394,-636,341,-715,382,-731,473,-759,630,-797,804,-822,935,-827,1047,-825,1208,-806,1216,-859,1229,-856,1205,-889,1227,-905,1240,-913,1253,-921,1267,-929,1281,-936,1295,-942,1309,-948,1324,-954,1338,-959,1353,-964,1368,-968,1384,-971,1399,-974,1414,-977,1430,-979,1445,-980,1461,-981,1476,-981,1492,-981,1507,-980,1523,-979,1538,-977,1554,-974,1569,-971,1584,-968,1599,-964,1614,-959,1629,-954,1643,-949,1658,-942,1682,-930,1674,-913,1691,-862,1720,-871,1764,-886,1842,-907,1855,-910,1930,-925,2003,-936,2125,-950,2274,-953,2390,-947,2581,-918,2622,-1019,2917,-998,2900,-709,2894,-562,2777,-567,2783,-714,2784,-726,2689,-731,2684,-687,2679,-632,2671,-583,2663,-547,2692,-506,2712,-477,2672,-346,2645,-351,2607,-354,2580,-290,2557,-241,2525,-181,2522,-176,2580,-150,2550,-103,2475,-102,2440,-53,2409,-14,2367,35,2328,76,2260,140,2203,185,2109,250,2004,309,1866,369,1764,399,1732,472,1681,483,1676,419,1667,421,1547,437,1479,439,1468,473,1460,503,1430,503,1426,473,1421,439,1371,438,1264,426,1192,411,1178,409,1142,456,1180,478,1350,565,1195,779,1070,654,973,719,723,478,663,421,606,365,549,309,547,309,535,313,523,316,512,319,504,320,505,310,505,291,506,272,507,253,508,234,508,232,526,229,529,190,540,191,556,190,566,187,579,179,588,172,595,161,601,150,602,139,602,120,599,109,595,101,586,92,574,83,561,76,548,71,474,91,465,78,454,64,454,63,449,65,448,63],[-640,-455,-650,-477,-659,-500,-670,-522,-680,-543,-712,-569,-685,-592,-671,-555,-654,-554,-637,-553,-620,-552,-603,-551,-586,-550,-585,-550,-567,-549,-549,-549,-531,-548,-513,-548,-494,-547,-476,-547,-457,-547,-439,-547,-422,-547,-420,-547,-402,-547,-383,-547,-365,-548,-346,-548,-328,-548,-310,-549,-292,-550,-291,-550,-274,-550,-256,-551,-239,-552,-222,-553,-205,-554,-194,-555,-190,-581,-172,-576,-157,-571,-166,-551,-159,-546,-144,-536,-129,-525,-114,-515,-112,-514,-98,-504,-82,-494,-66,-483,-49,-473,-33,-463,-16,-452,1,-442,18,-432,32,-423,34,-421,52,-411,69,-401,86,-392,103,-382,120,-372,137,-363,154,-354,171,-344,187,-335,204,-327,221,-318,221,-318,250,-306,275,-341,300,-315,265,-292,269,-281,276,-264,282,-248,290,-231,297,-214,299,-210,300,-208,297,-205,300,-196,301,-192,305,-182,305,-180,309,-170,310,-168,311,-164,315,-155,317,-150,320,-143,322,-136,325,-130,330,-118,333,-113,339,-100,342,-93,342,-93,346,-86,347,-84,348,-81,349,-79,353,-72,355,-69,358,-64,362,-57,364,-52,367,-48,369,-45,375,-35,376,-34,383,-22,387,-15,391,-11,396,-3,398,0,399,1,406,11,407,12,412,19,414,22,418,27,423,33,426,37,428,39,431,43,434,47,439,53,445,59,448,63,449,65,454,63,454,64,465,78,476,93,486,107,497,121,504,129,547,111,557,148,513,152,512,162,511,180,510,198,509,216,508,234,507,253,506,272,506,278,505,291,505,310,504,329,504,348,504,367,504,382,503,387,503,406,504,425,504,445,504,464,504,483,505,502,506,521,506,539,507,549,507,558,508,576,509,594,510,612,511,630,533,637,551,646,527,673,516,652,500,641,469,628,439,615,407,603,376,591,343,580,311,570,278,560,244,551,211,542,177,534,115,516,54,500,-8,483,-70,468,-131,453,-193,439,-254,425,-315,413,-376,401,-400,416,-402,399,-406,382,-421,368,-441,364,-459,362,-441,336,-455,266,-470,194,-486,123,-502,51,-520,-20,-538,-92,-556,-164,-569,-215,-583,-211,-598,-206,-609,-242,-594,-247,-579,-252,-581,-261,-587,-286,-593,-311,-600,-336,-607,-360,-615,-384,-623,-408,-631,-432]]},"kad2":{"a":[49.621697,6.147654],"p":[{"id":18163400,"role":"kad2","r":[1047,674,1493,460,192,-1473,-243,-1176,-677,-879,-638,-820,-599,-761,-577,-774,-389,-492,-417,-475,-337,-361,-311,-377,-125,-102,-149,-84,-73,32,-44,11,75,190,40,214,-129,330,-73,413,30,521,-11,550,184,848,104,883,179,1030,408,941],"h":20.0,"holes":[[119,446,325,310,607,125,569,62,625,28,662,92,681,67,954,-116,973,-90,992,-64,741,115,942,415,964,448,995,495,953,510,956,522,638,656,345,779]],"hm":29.4,"hx":66.8,"g":2.3}],"a0":329.52,"ad":329.52,"lg":[[-203,-233,-315,-398,-339,-382,-416,-494,-392,-511,-578,-785,-598,-771,-602,-776,-609,-771,-596,-751,-604,-746,-619,-736,-660,-797,-702,-858,-720,-884,-704,-895,-691,-904,-706,-926,-513,-1057,-320,-1189,-294,-1151,-253,-1179,-213,-1120,-173,-1061,587,58,556,79,506,7,133,262,-74,403,-132,318,75,177,-52,-11,-79,7,-156,-107,-130,-125,-186,-207,-212,-189,-238,-171,-255,-196,-229,-214],[-625,779,-59,393,506,7,583,119,540,149,470,196,446,213,483,268,304,404,261,339,209,374,60,476,70,491,109,464,326,784,947,526,940,515,991,494,740,123,785,92,952,-22,986,-45,934,-122,1053,-203,1231,59,1409,322,1451,384,1501,456,1420,490,1054,639,1031,649,1024,638,227,970,-461,1256,-738,848,-685,812,-629,773],[-173,-1061,-253,-1179,-33,-1329,187,-1479,1053,-203,955,-136,758,-2,688,46,646,74,620,35,587,58]]},"kad1":{"a":[49.621806,6.146526],"p":[{"id":4283127,"role":"kad1","r":[349,428,272,318,226,345,195,337,190,340,184,345,184,373,-88,556,-113,555,-257,349,-252,313,-259,303,-284,301,-348,207,-398,202,-479,259,-510,254,-564,173,-559,152,-536,137,-528,85,-540,62,-585,5,-577,-24,-500,-74,-473,-74,-457,-47,-409,-42,-258,-143,-230,-137,-222,-142,-208,-151,-205,-180,-126,-231,-117,-286,-174,-371,-169,-396,-88,-449,-63,-445,-51,-424,-1,-414,147,-513,169,-511,225,-435,224,-408,139,-352,132,-300,236,-151,230,-122,234,-115,241,-104,347,-178,462,-161,510,-89,544,-109,566,-103,608,-26,604,5,577,29,641,105,618,217,603,234,619,265],"h":25.0,"holes":[[-280,74,-271,23,-197,-31,-191,-59,-175,-70,-146,-65,6,-167,55,-159,119,-77,148,-73,157,-62,161,-57,154,-25,202,43,257,120,245,174,161,228,152,266,144,271,135,277,107,271,-48,369,-87,357,-146,268,-175,262,-183,249,-178,220]],"hm":32.1,"hx":37.0,"g":0.3}],"a0":327.39,"ad":327.39,"lg":[[-90,559,-113,554,-256,343,-251,321,-246,318,-259,298,-265,302,-288,297,-346,212,-395,202,-480,260,-505,255,-560,173,-554,151,-533,137,-524,88,-581,3,-578,-22,-578,-26,-509,-78,-473,-72,-460,-52,-460,-52,-410,-42,-261,-143,-236,-139,-234,-135,-214,-148,-218,-154,-212,-177,-126,-236,-118,-283,-174,-367,-172,-390,-88,-447,-66,-442,-53,-423,-4,-414,146,-515,170,-510,225,-430,220,-405,135,-347,126,-299,227,-149,222,-122,219,-120,231,-103,234,-105,259,-101,261,-98,370,-171,412,-163,429,-170,442,-158,484,-150,513,-106,516,-108,539,-103,595,-20,590,3,588,5,661,113,653,156,661,172,648,184,640,226,595,257,597,259,593,283,513,337,488,332,487,330,482,334,494,352,367,439,326,377,284,315,305,301,299,292,227,340,208,337,204,331,186,344,189,348,184,374]]},"eca":{"a":[49.62286,6.149423],"p":[{"id":372682369,"role":"eca","r":[-580,-96,-565,-105,-551,-195,-544,-198,-532,-203,-521,-243,-423,-225,-372,-216,-339,-235,-299,-440,-111,-399,-152,-199,-133,-160,19,-126,-1,-41,17,-39,23,-61,36,-94,56,-125,84,-156,111,-182,146,-206,178,-224,211,-234,276,-244,267,-258,248,-245,203,-313,228,-330,-19,-700,146,-810,393,-440,404,-448,452,-376,434,-364,885,313,354,667,-85,960,-370,535,-343,516,-309,492,-204,419,-27,684,196,535,89,374,250,267,354,423,605,256,465,46,456,64,440,83,417,101,393,113,356,118,328,114,305,108,276,96,255,79,235,63,209,32,192,6,180,-18,172,-43,168,-74,168,-101,170,-122,176,-145,185,-163,198,-179,215,-195,232,-206,248,-212,240,-217,213,-211,181,-199,150,-184,128,-166,108,-147,91,-128,78,-113,68,-95,61,-80,51,-60,44,-42,39,-14,37,24,38,62,41,94,44,114,47,129,51,149,58,173,69,208,77,231,89,259,105,295,119,324,131,345,109,360,92,330,78,302,65,274,41,213,25,169,18,131,15,112,12,85,10,51,9,15,11,-17,-6,-19,-23,63,-166,31,-205,52,-264,350,-458,309,-395,14,-421,-24,-557,-48,-564,-10,-580,-12,-605,4,-632,21,-692,9,-727,-42,-716,-102,-666,-138,-640,-134,-605,-129],"h":25.0,"hm":28.0,"hx":32.1,"g":-1.2}],"a0":334.65,"ad":334.65,"lg":[[-331,325,-333,333,-392,320,-391,312,-404,309,-406,317,-458,306,-415,106,-506,87,-569,-12,-580,-14,-634,21,-695,7,-728,-44,-716,-106,-662,-139,-602,-127,-583,-96,-567,-106,-557,-146,-563,-153,-554,-193,-528,-206,-520,-243,-426,-223,-424,-233,-477,-245,-478,-245,-720,-297,-716,-320,-472,-267,-472,-265,-375,-245,-382,-214,-377,-213,-343,-236,-300,-438,-247,-427,-249,-417,-235,-414,-233,-424,-173,-411,-175,-402,-161,-400,-160,-408,-130,-402,-122,-442,-113,-482,-91,-478,-94,-465,-31,-507,-111,-630,-10,-696,-13,-700,147,-805,388,-433,407,-445,451,-377,432,-365,870,310,-79,958,-366,535,-208,427,-133,537,71,397,1,294,-122,378,-266,347,-318,336,-316,328]]},"ecj":{"a":[49.621632,6.143275],"p":[{"id":133301875,"role":"towerA","r":[-89,-185,-200,-83,134,277,244,175],"h":60,"hm":102.9,"hx":102.9,"g":NaN},{"id":133301876,"role":"towerB","r":[301,-555,191,-453,526,-90,636,-192],"h":60,"hm":null,"hx":null,"g":0},{"id":659961054,"role":"towerC","r":[603,-978,557,-906,626,-862,547,-739,957,-474,1037,-598,970,-641,1016,-711,668,-936],"h":80,"hm":112.9,"hx":113.8,"g":NaN},{"id":681104587,"role":"themis","r":[-2942,2569,-2489,2463,-2556,2177,-2595,2008,-2948,2089,-3049,2114],"h":18.0,"hm":28.7,"hx":29.7,"g":NaN},{"id":24457477,"role":"thomasmore","r":[-2595,2008,-2556,2177,-2371,2145,-2298,2115,-2228,2069,-2164,2001,-2129,1943,-2085,1881,-2022,1827,-1736,1658,-1755,1634,-1654,1577,-1784,1437,-1847,1367,-1817,1331,-2025,1109,-2764,1801,-2736,1947,-2672,1890,-2596,1974,-2614,1989],"h":10.0,"hm":11.9,"hx":14.6,"g":NaN},{"id":205062453,"role":"erasmus","r":[-1784,1437,-1654,1577,-1544,1692,-928,1112,-980,1057,-899,980,-847,1035,-234,457,-476,189],"h":10.0,"hm":10.8,"hx":13.6,"g":NaN}],"a0":311.02,"ad":null,"lg":[[-2900,1993,-2885,2009,-2972,2090,-2973,2091,-2988,2075],[233,175,237,180,140,271,135,267,131,271,53,187,-117,346,-168,292,-363,83,-365,81,-377,68,-426,16,550,-900,559,-908,558,-908,602,-976,808,-842,1013,-708,969,-640,1034,-598,954,-476,839,-551,671,-393,423,-658,304,-546,629,-198,625,-194,630,-189,532,-97,528,-102,523,-98,446,-182,274,-21,27,-286,-89,-178,237,171],[-2351,1416,-2199,1274,-2177,1253,-2016,1102,-1815,1318,-1820,1323,-1806,1337,-1841,1370,-1651,1573,-1759,1635,-1744,1651,-1738,1657,-1991,1807,-1969,1831,-1972,1834,-1976,1838,-1980,1842,-1984,1846,-1987,1849,-2014,1820,-2032,1831,-2052,1846,-2071,1863,-2087,1880,-2104,1899,-2118,1917,-2128,1932,-2142,1957,-2169,1999,-2184,2016,-2200,2034,-2217,2052,-2235,2067,-2253,2082,-2276,2097,-2301,2111,-2327,2125,-2347,2133,-2366,2140,-2385,2146,-2399,2149,-2544,2182,-2508,2336,-2520,2338,-2506,2399,-2492,2460,-2614,2489,-2615,2485,-2625,2487,-2623,2497,-2682,2511,-2679,2519,-2681,2531,-2686,2542,-2694,2551,-2705,2556,-2717,2558,-2729,2555,-2740,2548,-2747,2538,-2750,2527,-2811,2542,-2814,2531,-2819,2533,-2818,2537,-2940,2565,-2954,2504,-2969,2444,-2971,2436,-2971,2436,-2984,2439,-3027,2251,-3015,2248,-3015,2248,-3016,2239,-3045,2118,-2984,2103,-2964,2099,-2869,2009,-2876,2001,-2884,2008,-2896,1995,-2911,1979,-2929,1960,-2946,1942,-2962,1925,-2857,1827,-2841,1844,-2824,1862,-2807,1881,-2801,1887,-2772,1860,-2776,1854,-2777,1846,-2776,1839,-2773,1832,-2767,1827,-2761,1824,-2765,1805,-2723,1765,-2712,1755,-2701,1744,-2548,1601,-2526,1580,-2374,1437],[-1074,1242,-1092,1259,-1199,1359,-1234,1322,-1317,1400,-1283,1437,-1389,1536,-1408,1554,-1403,1559,-1406,1562,-1409,1565,-1413,1569,-1417,1572,-1419,1574,-1424,1569,-1442,1587,-1547,1685,-1596,1632,-1651,1573,-1656,1568,-1671,1552,-1744,1474,-1780,1435,-1841,1370,-1806,1337,-1820,1323,-1815,1318,-426,16,-377,68,-365,81,-480,189,-479,191,-467,204,-431,243,-283,401,-234,453,-342,554,-358,569,-353,575,-356,578,-360,581,-364,585,-367,588,-371,591,-376,586,-394,603,-501,703,-534,667,-618,745,-583,782,-689,881,-708,899,-704,904,-706,907,-710,910,-713,913,-717,917,-719,919,-724,914,-743,931,-850,1032,-839,1042,-797,1002,-689,1118,-857,1275,-965,1160,-923,1120,-933,1109,-1039,1209,-1058,1226,-1053,1231,-1056,1233,-1060,1237,-1064,1240,-1067,1244,-1070,1246]]},"gasperi":{"a":[49.618369,6.143983],"p":[{"id":132316478,"role":"gasperi","r":[220,-248,103,10,47,114,-120,349,-164,324,-176,348,-220,323,-207,300,-247,277,-123,23,-68,-80,93,-320,133,-298,142,-314,186,-288,179,-271],"h":81,"hm":86.6,"hx":87.9,"g":0.9},{"id":51768380,"role":"porteA","r":[-479,-545,-565,-880,-578,-930,-358,-987,-346,-938,-310,-801,-259,-602],"h":71,"lv":19,"hm":71.7,"hx":72.4,"g":3.5},{"id":51768386,"role":"porteB","r":[-720,-1487,-724,-1503,-821,-1868,-607,-1924,-569,-1782,-535,-1654,-510,-1560,-506,-1543],"h":71,"lv":19,"hm":73.5,"hx":74.9,"g":2.9},{"id":37847304,"role":"hemicycle","r":[1132,2,1081,32,1080,169,1229,256,1352,190,1418,220,1499,262,1556,291,1832,129,1831,66,1829,-70,1962,-146,1962,-314,1874,-370,1760,-373,1613,-288,1559,-315,1301,-164,1288,-158,1288,-99],"h":31.0,"hm":37.1,"hx":38.6,"g":-12.3}],"a0":320.48,"ad":320.48,"lg":[[1825,-71,1828,151,1554,311,1446,250,1338,189,1233,251,1076,164,1074,87,1095,59,1115,30,1141,-4,1281,-86,1280,-139,1280,-162,1304,-177,1545,-320,1615,-281,1757,-363,1783,-378,1804,-391,1818,-399,1825,-403,1934,-341,1934,-332,1954,-321,1956,-147],[-467,-956,-362,-983,-262,-603,-368,-575,-473,-547,-573,-928]]},"eib":{"a":[49.620234,6.137729],"p":[{"id":24457411,"role":"wki","r":[155,130,320,-23,392,55,505,-50,402,-160,324,-88,290,-124,169,-254,706,-753,605,-863,12,-312,-102,-435,-415,-772,-524,-672,-315,-447,-436,-334,-376,-269,-572,-87,-375,125,-265,22,-250,38,-345,127,-262,217,-749,670,-648,780,-188,352,-17,537,172,362,319,521,378,584,463,505,484,485],"h":20,"hm":27.3,"hx":28.9,"g":-2.5},{"id":51071558,"role":"eki","r":[1122,-1564,2407,-2788,1843,-2995,585,-1807,804,-1712,1039,-1602],"h":24,"hm":null,"hx":null,"g":0}],"a0":323.0},"luxexpo":{"a":[49.634617,6.172761],"p":[{"id":286901423,"role":"hall","r":[464,-124,395,-59,237,89,80,238,-77,386,-171,476,-695,-77,-641,-128,-59,-678],"hm":7.9,"hx":9.2,"g":0.0},{"id":286901418,"role":"hall","r":[-771,-1442,-1299,-945,-1407,-843,-1928,-1395,-1293,-1994],"hm":7.9,"hx":9.2,"g":3.2},{"id":208692446,"role":"hall","r":[-208,-1670,-302,-1770,-349,-1726,-406,-1787,-300,-1886,-246,-1828,-149,-1726,-77,-1796,83,-1630,136,-1574,189,-1518,341,-1355,269,-1287,307,-1246,418,-1129,241,-962,183,-1024,256,-1093,169,-1185,-230,-808,-650,-1253],"hm":14.7,"hx":20.9,"g":1.1},{"id":286901424,"role":"hall","r":[418,-1129,942,-575,866,-504,709,-356,552,-207,464,-124,-59,-678,241,-962],"hm":7.9,"hx":9.2,"g":0.1},{"id":286901417,"role":"hall","r":[-406,-1787,-771,-1442,-1293,-1994,-816,-2446,-294,-1892,-300,-1886],"hm":7.9,"hx":9.1,"g":3.2},{"id":286901422,"role":"hall","r":[-171,476,-234,535,-391,683,-548,832,-633,913,-1157,358,-695,-77],"hm":7.9,"hx":9.2,"g":0.1},{"id":286901419,"role":"hall","r":[-1320,-751,-1630,-458,-2239,-1102,-1928,-1395,-1407,-843],"hm":8.8,"hx":10.5,"g":3.3},{"id":286901421,"role":"hall","r":[-633,913,-705,981,-862,1129,-953,1215,-1477,659,-1439,623,-1356,545,-1157,358],"hm":7.9,"hx":10.2,"g":0.1},{"id":286901404,"role":"hall","r":[-1630,-458,-1603,-429,-1664,-371,-1640,-345,-1367,-601,-1298,-528,-1236,-586,-1213,-561,-1274,-503,-1203,-427,-1615,-39,-1782,-216,-1693,-300,-1743,-352,-1712,-381],"hm":16.7,"hx":16.9,"g":1.8},{"id":286901403,"role":"hall","r":[-641,-128,-695,-77,-731,-113,-754,-92,-800,-141,-777,-163,-1320,-751,-1407,-843,-1299,-945,-1213,-854,-1266,-804],"hm":5.3,"hx":8.6,"g":1.6},{"id":286901407,"role":"hall","r":[-1446,456,-1460,440,-1353,339,-1322,372,-1275,329,-1291,310,-1234,257,-1217,274,-1170,232,-1188,213,-1132,158,-1115,176,-1063,129,-1044,147,-993,98,-974,117,-754,-92,-731,-113,-695,-77,-1157,358,-1356,545],"hm":10.3,"hx":10.8,"g":0.1}],"a0":356.58,"ad":356.58,"lg":[[257,-1591,166,-1505,61,-1616,151,-1702],[-1152,1001,-1203,1050,-1281,968,-1229,919]]},"stade":{"a":[49.576841,6.113963],"p":[{"id":707074800,"role":"stadium","r":[-602,-961,-750,238,-761,316,-770,387,699,585,866,602,874,533,1046,-744],"hm":20.6,"hx":27.9,"g":0.2},{"id":642190532,"role":"pitch","r":[784,-538,688,200,-495,47,-399,-694],"hm":25.5,"hx":27.9,"g":0.0}],"a0":295.21,"ad":295.21,"lg":[[886,457,886,457,867,607,-772,394,-752,234,-750,235,-597,-950,1041,-737]]},"cloche":{"a":[49.582843,6.124629],"p":[{"id":645974313,"role":"mall","r":[-21,-1132,-808,-272,-823,-256,-715,-157,-704,-141,-399,146,-293,248,-51,485,812,1251,1410,594,1612,371],"lv":4,"hm":61.6,"hx":70.8,"g":-0.2}],"a0":297.31,"ad":297.31,"lg":[[1598,363,799,1246,-408,146,-408,146,-711,-130,-711,-130,-857,-264,-263,-921,-272,-929,-59,-1164,94,-1024,247,-884,239,-875]]},"gare":{"a":[49.599979,6.134014],"p":[{"id":209293282,"role":"main","r":[306,-268,301,-254,291,-227,282,-201,232,-64,206,8,181,80,167,119,150,166,139,195,91,330,65,401,1,579,-134,533,-148,528,-137,496,-144,494,-123,432,-128,428,-131,424,-133,419,-132,413,-130,408,-127,404,-122,401,-117,399,-111,400,-93,346,-65,356,-40,284,-28,249,-45,243,-51,228,6,63,-48,45,-88,30,-109,88,-122,97,-165,82,-170,66,-134,-32,-159,-41,-162,-54,-179,-50,-182,-70,-183,-96,-175,-126,-158,-155,-140,-176,-125,-187,-116,-176,-107,-182,-86,-175,-73,-212,-63,-216,-42,-210,14,-373,0,-406,17,-448,57,-459,85,-448,149,-427,157,-451,165,-453,173,-453,181,-451,188,-446,193,-439,185,-414,198,-410,230,-398,197,-306],"lv":2,"rs":"many","hm":20.3,"hx":21.8,"g":0.0},{"id":123661455,"role":"pavilion","r":[-316,665,-194,709,-507,1581,-629,1537],"lv":1,"rs":"gabled","hm":7.5,"hx":8.1,"g":-0.1},{"id":209293283,"role":"tower","r":[396,-519,306,-268,197,-306,230,-398,250,-456,286,-558,357,-533],"rs":"pyramidal","hm":14.6,"hx":15.0,"g":-0.0},{"id":198144651,"role":"canopy","r":[-51,228,6,63,-48,45,-88,30,-109,88,-117,112,-129,108,-143,151,-146,161,-212,140,-234,203,-275,319,-294,374,-312,425,-373,598,-379,617,-362,623,-326,636,-308,643,-186,686,-183,676,-134,533,-148,528,-137,496,-144,494,-123,432,-128,428,-131,424,-133,419,-132,413,-130,408,-127,404,-122,401,-117,399,-111,400,-93,346,-65,356,-28,249,-45,243],"hm":10.6,"hx":11.9,"g":-0.0}],"a0":283.93,"ad":283.93,"lg":[[-180,150,-152,160,-149,161,-148,162,-130,112,-127,113,-126,114,-120,98,-137,106,-173,93,-182,76,-153,-6,-160,-8,-156,-21,-174,-27,-175,-42,-193,-38,-200,-35,-202,-51,-202,-68,-200,-87,-194,-108,-186,-128,-176,-147,-166,-161,-150,-177,-145,-171,-132,-158,-124,-167,-107,-157,-108,-156,-75,-144,-73,-151,-89,-157,-96,-173,-86,-203,-71,-211,-68,-210,-54,-205,6,-373,2,-375,-10,-401,-7,-409,-15,-412,0,-453,7,-451,9,-450,13,-462,38,-474,94,-454,146,-436,150,-446,163,-452,187,-444,194,-432,183,-402,183,-402,188,-400,233,-384,261,-461,262,-479,272,-493,291,-548,350,-527,403,-676,315,-708,315,-709,315,-710,315,-711,314,-712,314,-713,314,-715,314,-716,314,-717,313,-718,313,-719,313,-720,312,-721,312,-722,311,-723,311,-724,310,-725,309,-726,309,-727,308,-728,307,-729,307,-730,306,-731,305,-732,304,-732,304,-733,310,-752,299,-755,301,-760,314,-796,317,-805,328,-801,333,-815,334,-816,336,-816,337,-816,339,-817,341,-817,343,-818,345,-818,347,-819,348,-820,350,-820,352,-821,353,-822,355,-823,357,-824,358,-825,448,-793,451,-800,489,-907,499,-934,496,-935,506,-965,546,-951,553,-970,626,-945,596,-863,595,-860,593,-853,590,-845,587,-836,583,-827,580,-818,578,-812,577,-807,562,-767,441,-430,323,-99,227,169,28,729,-46,703,-46,705,-90,689,-95,704,-190,670,-194,682,-381,614,-212,139],[-319,661,-257,683,-195,705,-505,1574,-567,1552,-629,1530]]},"hamilius":{"a":[49.61148,6.126489],"p":[{"id":643060803,"role":"lafayette","r":[-94,222,-108,50,-112,10,-208,-167,-47,-180,48,-188,189,-199,206,27,220,200],"lv":8,"hm":37.3,"hx":37.6,"g":0.1},{"id":643060805,"role":"lafayette2","r":[-222,-348,-252,-659,-279,-768,-236,-802,143,-759,174,-378,34,-367,-61,-360],"lv":8,"hm":44.2,"hx":44.5,"g":1.9},{"id":643060802,"role":"lafayette3","r":[-94,222,220,200,234,426,146,433,146,461,34,471,36,502,-72,512],"lv":5,"hm":34.1,"hx":35.3,"g":-0.8}],"a0":301.67,"ad":301.67,"lg":[[190,-193,204,-4,200,-4,216,206,-95,229,-111,19,-117,19,-177,-99,-194,-130,-209,-163,-48,-179,-8,-183,-7,-178],[25,458,28,488,-78,496,-90,335,-99,230,216,206,220,206,228,311,235,411,129,419,129,420,132,450],[-223,-798,-220,-797,-153,-785,-96,-779,7,-769,121,-758,147,-755,149,-728,176,-376,-12,-361,-13,-365,-228,-346,-228,-350,-260,-672,-275,-747,-269,-753,-273,-796,-230,-792]]},"etoile":{"a":[49.614158,6.120121],"p":[{"id":210440141,"role":"centre","r":[181,-37,110,-73,34,-96,-45,-106,-124,-101,-201,-82,-199,-70,-282,-31,-226,17,-173,-4,-146,71,-64,57,19,71,93,111,64,152,205,238,355,3,212,-86],"hm":25.0,"hx":26.5,"g":1.4},{"id":210440175,"role":"radbury","r":[412,670,325,621,332,608,253,564,234,596,186,570,28,833,20,862,21,893,37,918,63,941,253,1045,383,819,342,796,395,706],"lv":4,"hm":18.0,"hx":18.9,"g":2.2}],"a0":297.74,"ad":297.74,"lg":[[308,606,306,609,351,637,382,646,407,661,327,790,370,817,246,1047,67,950,44,936,26,915,15,890,13,863,18,836,32,812,181,571,219,595,237,563],[-177,-7,-220,10,-272,-36,-263,-43,-255,-49,-245,-54,-236,-59,-227,-64,-217,-69,-207,-73,-203,-74,-206,-81,-119,-105,-29,-108,59,-90,124,-63,169,-31,199,-79,206,-74,213,-85,220,-80,222,-83,340,-9,338,-6,347,-1,343,6,352,11,279,129,271,124,197,241,185,234,76,166,64,158,89,116,54,87,7,66,-44,56,-96,58,-148,70]]},"pfaff":{"a":[49.618935,6.132878],"p":[{"id":502762887,"role":"lower","r":[-211,167,-182,172,-157,177,-192,361,-198,394,-127,407,-84,187,-45,194,-32,197,13,205,28,208,77,218,36,431,78,440,120,223,185,235,200,156,204,133,216,74,222,43,239,-48,245,-80,261,-162,223,-170,270,-417,211,-428,195,-431,147,-183,101,-192,90,-194,50,-202,30,-206,-10,-214,38,-468,-2,-475,-51,-217,-138,-234,-142,-214,-198,-225,-200,-163,-205,-31,-236,-32,-238,26,-207,27,-207,40,-209,111],"lv":2,"hm":32.9,"hx":36.1,"g":3.8},{"id":427694054,"role":"upper","r":[1956,-76,2342,-161,2419,189,2428,230,2043,315,2037,291,2005,143,1999,114,1977,19,1970,-12],"lv":1,"hm":12.7,"hx":12.8,"g":53.7}],"a0":254.64,"ad":254.64,"lg":[[2336,-164,2388,64,2391,71,2392,79,2391,87,2388,95,2382,101,2396,101,2424,225,2032,303,1982,84,2012,85,2004,48,1974,47,1946,-76],[232,-22,202,-23,196,15,225,16,185,222,-205,146,-176,-1,-148,0,-142,-38,-169,-39,-129,-246,-86,-237,-84,-245,-83,-253,-44,-246,-46,-238,-47,-230,261,-171]]},"rouge":{"p":[],"a":[49.617852,6.131733],"ax":[1736,-391,-1737,392],"prof":[[0.0,309.58,297.19],[0.0112,309.57,295.69],[0.0225,309.62,295.39],[0.0337,309.63,295.26],[0.0449,309.64,295.13],[0.0562,309.66,294.88],[0.0674,309.68,289.3],[0.0787,309.73,288.18],[0.0899,309.75,285.94],[0.1011,309.8,284.3],[0.1124,309.82,282.48],[0.1236,309.85,281.05],[0.1348,309.87,279.59],[0.1461,309.89,278.81],[0.1573,309.92,277.79],[0.1685,309.97,276.02],[0.1798,310.02,274.25],[0.191,310.02,273.0],[0.2022,310.06,272.14],[0.2135,310.14,271.25],[0.2247,310.11,269.06],[0.236,310.17,267.39],[0.2472,310.16,263.78],[0.2584,310.21,262.25],[0.2697,310.23,261.5],[0.2809,310.27,261.53],[0.2921,310.3,261.77],[0.3034,310.34,258.78],[0.3146,310.36,255.37],[0.3258,310.37,253.36],[0.3371,310.41,251.14],[0.3483,310.39,247.52],[0.3596,310.44,246.13],[0.3708,310.47,243.65],[0.382,310.49,243.69],[0.3933,310.54,243.59],[0.4045,310.55,243.71],[0.4157,310.59,243.84],[0.427,310.6,243.96],[0.4382,310.66,243.94],[0.4494,310.69,243.88],[0.4607,310.69,243.69],[0.4719,310.71,243.64],[0.4831,310.78,243.69],[0.4944,310.79,243.64],[0.5056,310.84,243.38],[0.5169,310.84,243.24],[0.5281,310.86,242.12],[0.5393,310.93,239.25],[0.5506,310.96,236.55],[0.5618,311.03,236.09],[0.573,311.04,236.12],[0.5843,311.09,236.08],[0.5955,311.09,236.71],[0.6067,311.17,238.91],[0.618,311.18,241.83],[0.6292,311.2,241.9],[0.6404,311.28,242.09],[0.6517,311.28,241.98],[0.6629,311.33,241.99],[0.6742,311.36,242.11],[0.6854,311.38,242.1],[0.6966,311.41,242.21],[0.7079,311.47,244.56],[0.7191,311.51,245.03],[0.7303,311.62,248.56],[0.7416,311.58,251.09],[0.7528,311.6,253.59],[0.764,311.6,255.96],[0.7753,311.62,258.44],[0.7865,311.69,261.1],[0.7978,311.69,263.67],[0.809,311.71,266.19],[0.8202,311.74,268.86],[0.8315,311.77,271.42],[0.8427,311.79,273.11],[0.8539,311.84,275.82],[0.8652,311.88,278.48],[0.8764,311.9,281.29],[0.8876,311.93,284.1],[0.8989,311.99,286.24],[0.9101,312.03,286.38],[0.9213,312.08,286.99],[0.9326,312.1,290.87],[0.9438,312.1,294.69],[0.9551,312.15,296.28],[0.9663,312.17,298.26],[0.9775,312.2,302.95],[0.9888,312.25,305.15],[1.0,312.28,307.47]],"len":356.0,"a0":310.81,"ad":243.54},"adolphe":{"p":[],"a":[49.608465,6.126947],"ax":[-372,-679,372,680],"prof":[[0.0,295.66,290.68],[0.0263,295.69,286.91],[0.0526,295.71,278.93],[0.0789,295.73,278.71],[0.1053,295.75,278.4],[0.1316,295.76,278.26],[0.1579,295.79,278.11],[0.1842,295.82,275.9],[0.2105,295.82,273.53],[0.2368,295.85,269.14],[0.2632,295.84,264.9],[0.2895,295.88,261.89],[0.3158,295.89,261.96],[0.3421,295.91,259.41],[0.3684,295.92,257.34],[0.3947,295.95,257.29],[0.4211,295.96,257.05],[0.4474,295.94,255.37],[0.4737,295.95,253.36],[0.5,295.96,252.11],[0.5263,295.95,252.34],[0.5526,295.93,253.85],[0.5789,295.89,254.33],[0.6053,295.86,255.11],[0.6316,295.84,255.88],[0.6579,295.81,256.75],[0.6842,295.77,257.44],[0.7105,295.74,257.52],[0.7368,295.7,257.83],[0.7632,295.66,261.87],[0.7895,295.63,268.56],[0.8158,295.58,271.25],[0.8421,295.54,274.48],[0.8684,295.46,277.3],[0.8947,295.43,278.7],[0.9211,295.33,279.02],[0.9474,295.26,279.18],[0.9737,295.21,279.73],[1.0,295.09,287.74]],"len":155.0,"a0":295.79,"ad":252.11},"lift":{"a":[49.615537,6.1305598],"p":[],"ad":null,"a0":0}}/*FP-END*/;
  const THEATRE_COURT = (() => { // forecourt (parvis) in front of the west front: d -34..0, a -40..40 in the frame of def('theatre'); the LOD2 low walls / planters there are replaced by the flat paved model
    const DD = [0.976, -0.219]; const AA = [-0.219, -0.976]; const o = [];
    [[-34, -40], [0, -40], [0, 40], [-34, 40]].forEach(([d, a]) => { o.push(Math.round((DD[0] * d + AA[0] * a) * 10), Math.round((DD[1] * d + AA[1] * a) * 10)); });
    return o;
  })();
  FP.theatre = { a: [49.6177108, 6.1273391], p: [{ id: 9653796, role: 'hall', r: [78, 348, 757, 195, 677, -159, 849, -197, 784, -488, 610, -449, 599, -500, -78, -347, -6, -24, -55, -13, -9, 188, 39, 177, 62, 278], h: 13, hm: 13 }, { id: -1, role: 'forecourt', r: THEATRE_COURT, h: 3, hm: 3 }], ad: null, a0: 0 };
  const DEFS = [];
  const decode = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([flat[i] / 10, flat[i + 1] / 10]); return o; };
  let LOD = null; // key -> { b: [ { role, id, roofs: [flat x,z,y dm], walls: [...], zmax, ... } ] } (data/luxtram-landmarks.json)
  const lodCache = {};
  function landmarkData(key) {
    const fp = FP[key];
    const polys = fp ? fp.p.map((e) => ({ id: e.id, role: e.role, r: decode(e.r), h: e.h, hm: e.hm, hx: e.hx, g: e.g || 0, lv: e.lv, rs: e.rs, holes: (e.holes || []).map(decode), more: (e.more || []).map(decode) })) : [];
    return {
      key,
      anchor: fp ? fp.a : [LAT0, LON0],
      polys,
      a0: fp ? fp.a0 : 0,
      ad: fp && fp.ad !== undefined && fp.ad !== null ? fp.ad : null,
      dy: fp && fp.ad !== undefined && fp.ad !== null ? fp.a0 - fp.ad : 0, // LOD2 baseline minus the terrain at the anchor
      axis: fp && fp.ax ? decode(fp.ax) : null,
      prof: fp && fp.prof ? fp.prof : null,
      len: fp ? fp.len : 0,
      get(role) { return polys.filter((p) => p.role === role); },
      one(role) { return polys.find((p) => p.role === role) || null; },
      height(role, fallback) { const p = polys.find((q) => q.role === role); return p && p.hm ? p.hm : (p && p.h) || fallback || 12; },
      lod(role) {
        if (!LOD || !LOD[key]) return [];
        const k = key + ':' + role;
        if (!lodCache[k]) lodCache[k] = LOD[key].b.filter((b) => !role || b.role === role).map((b) => ({ role: b.role, id: b.id, zmax: b.zmax, gmin: b.gmin, roofs: b.roofs.map(decodeLod), walls: b.walls.map(decodeLod) }));
        return lodCache[k];
      },
    };
  }
  /* def(key, name, opts, build(g, hi, L)); opts: radius (m), showR / hiR per quality, base 'ground'|'rail', anchor override [lat, lon] */
  function def(key, name, opts, build) {
    DEFS.push(Object.assign({ key, name, radius: 60, base: 'ground', build }, opts, {
      showR: Object.assign({ high: 1500, medium: 1100, low: 800 }, opts.showR),
      hiR: Object.assign({ high: 420, medium: 300, low: 0 }, opts.hiR),
    }));
  }

  /* ================================================================== shared helpers for the models */
  function ringPoints(ring, spacing) { // evenly spaced points along a closed ring (arc length)
    const o = orient(ring, true); const pts = []; let carry = 0;
    for (let i = 0; i < o.length; i++) {
      const p = o[i]; const q = o[(i + 1) % o.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      let t = carry;
      while (t < L) { pts.push([lerp(p[0], q[0], t / L), lerp(p[1], q[1], t / L)]); t += spacing; }
      carry = t - L;
    }
    return pts;
  }
  const C_CONCRETE = col('#d9d8d3'); const C_WHITE = col('#f1efea'); const C_DARK = col('#3c4046'); const C_ROOF = [1, 1, 1];
  const C_STONE = col('#e0d2ae'); const C_GREEN = col('#7a8a52');
  const S_PLAIN = (c) => ({ cell: 'plain', color: c || C_WHITE, bay: 8, floor: 8, jitter: 0.02 });
  const tintOf = (c) => { const m = Math.max(c[0], c[1], c[2]) || 1; return mixc(WHITE, [c[0] / m, c[1] / m, c[2] / m], 0.6); }; // textured cells already carry their brightness: only keep the hue
  const roofS = (c, cell) => ((!cell || cell === 'plain') && cell ? { cell: 'plain', color: c || C_ROOF } : { cell: cell || 'roofGrey', color: c ? tintOf(c) : WHITE });
  function foundationRing(g, ring, depth, st) { // hides the slope under a building
    const o = orient(ring, true);
    for (let i = 0; i < o.length; i++) { const p = o[i]; const q = o[(i + 1) % o.length]; wall(g, p[0], p[1], q[0], q[1], -depth, 0, st || S_PLAIN(col('#9d9a92')), false); }
  }


  /* ================================================================== LOD2 (national 3D buildings 2023, LOD 2.2) helpers
   * Real roof shapes + walls of the landmark buildings, baked into data/luxtram-landmarks.json (x, z metres from the landmark anchor,
   * y metres above the landmark's baseline). The models dress them with facades and add what LOD2 does not have. */
  function quadTiled(g, A, B, Cc, D, nb, nf, cellFn, color, jitter) { // bilinear tiling of the quad A(bottom-left) B(bottom-right) C(top-right) D(top-left)
    nb = Math.max(1, nb); nf = Math.max(1, nf);
    const n = norm(cross(sub(B, A), sub(D, A)));
    const P = (s, t) => {
      const bx = lerp(A[0], B[0], s); const by = lerp(A[1], B[1], s); const bz = lerp(A[2], B[2], s);
      const tx = lerp(D[0], Cc[0], s); const ty = lerp(D[1], Cc[1], s); const tz = lerp(D[2], Cc[2], s);
      return [lerp(bx, tx, t), lerp(by, ty, t), lerp(bz, tz, t)];
    };
    for (let f = 0; f < nf; f++) for (let b = 0; b < nb; b++) {
      const p0 = P(b / nb, f / nf); const p1 = P((b + 1) / nb, f / nf); const p2 = P((b + 1) / nb, (f + 1) / nf); const p3 = P(b / nb, (f + 1) / nf);
      const r = RECTS[cellFn(b, f)];
      const k = 1 + (hash2(b * 5 + f * 17, tileSeed + 9) - 0.5) * (jitter === undefined ? 0.06 : jitter);
      const c = [color[0] * k, color[1] * k, color[2] * k];
      const i0 = g.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], r[0], r[1], c); const i1 = g.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], r[2], r[1], c);
      const i2 = g.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], r[2], r[3], c); const i3 = g.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], r[0], r[3], c);
      g.quad(i0, i1, i2, i3);
    }
    tileSeed = (tileSeed * 1664525 + 1013904223) | 0;
  }
  function decodeLod(flat3) { const o = []; for (let i = 0; i < flat3.length; i += 3) o.push([flat3[i] / 10, flat3[i + 1] / 10, flat3[i + 2] / 10]); return o; }
  function newell(ring) { // ring of [x, z, y] -> normal in (x, y, z) world axes (unnormalised)
    let nx = 0; let ny = 0; let nz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      nx += (p[2] - q[2]) * (p[1] + q[1]); ny += (p[1] - q[1]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[2] + q[2]);
    }
    return [nx, ny, nz];
  }
  /* triangulate a planar-ish 3D polygon (ring of [x, z, y]) with the normal facing `want` ([x,y,z] direction, or up if absent) */
  function polyFace(g, ring, color, cellName, want, dy, shadeN) {
    const n = ring.length;
    if (n < 3) return;
    let nm = newell(ring);
    const l = Math.hypot(nm[0], nm[1], nm[2]);
    if (l < 1e-6) return;
    nm = [nm[0] / l, nm[1] / l, nm[2] / l];
    const w = want || [0, 1, 0];
    if (nm[0] * w[0] + nm[1] * w[1] + nm[2] * w[2] < 0) nm = [-nm[0], -nm[1], -nm[2]];
    const sn = shadeN || nm;
    const r = RECTS[cellName];
    const u = lerp(r[0], r[2], 0.43); const v = lerp(r[1], r[3], 0.43);
    let tris;
    if (n === 3) tris = [[0, 1, 2]];
    else if (n === 4) tris = [[0, 1, 2], [0, 2, 3]];
    else {
      // project onto the dominant plane
      const ax = Math.abs(nm[0]); const ay = Math.abs(nm[1]); const az = Math.abs(nm[2]);
      const pr = ay >= ax && ay >= az ? (p) => new T.Vector2(p[0], p[1]) : ax >= az ? (p) => new T.Vector2(p[1], p[2]) : (p) => new T.Vector2(p[0], p[2]);
      try { tris = T.ShapeUtils.triangulateShape(ring.map(pr), []); } catch (e) { tris = null; }
      if (!tris || !tris.length) return;
    }
    const base = g.count;
    ring.forEach((p) => g.vert(p[0], p[2] + dy, p[1], sn[0], sn[1], sn[2], u, v, color));
    tris.forEach((t) => {
      const a = ring[t[0]]; const b = ring[t[1]]; const c = ring[t[2]];
      const e1 = [b[0] - a[0], b[2] - a[2], b[1] - a[1]]; const e2 = [c[0] - a[0], c[2] - a[2], c[1] - a[1]];
      const cr = cross(e1, e2);
      if (cr[0] * nm[0] + cr[1] * nm[1] + cr[2] * nm[2] >= 0) g.tri(base + t[0], base + t[1], base + t[2]); else g.tri(base + t[0], base + t[2], base + t[1]);
    });
  }
  /* a vertical polygon (ring of [x, z, y]) tiled with facade cells: the polygon is clipped against every bay x floor tile */
  function clipPoly(pts, k, lim, keepGreater) { // Sutherland-Hodgman against one axis-aligned line in (s, y) space
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const ina = keepGreater ? a[k] >= lim : a[k] <= lim; const inb = keepGreater ? b[k] >= lim : b[k] <= lim;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (lim - a[k]) / (b[k] - a[k]); out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); }
    }
    return out;
  }
  function wallPoly(g, ring, out, st, hi, dy) {
    let best = -1; let ia = 0; let ib = 1;
    for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) { const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]); if (d > best) { best = d; ia = i; ib = j; } }
    if (best < 0.3) return;
    const p0 = ring[ia]; const e = [(ring[ib][0] - p0[0]) / best, (ring[ib][1] - p0[1]) / best];
    const pts = ring.map((p) => [(p[0] - p0[0]) * e[0] + (p[1] - p0[1]) * e[1], p[2]]);
    let smin = 1e9; let smax = -1e9; let ymin = 1e9; let ymax = -1e9;
    pts.forEach((p) => { smin = Math.min(smin, p[0]); smax = Math.max(smax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
    const cellName = st.cell || 'plain'; const multi = VARIANTS[cellName]; const bay = st.bay || 3.6; const flo = st.floor || 3.6;
    const useMulti = !hi && LO_CELL[cellName];
    let nb = Math.max(1, Math.round((smax - smin) / (useMulti ? bay * 4 : bay))); let nf = Math.max(1, Math.round((ymax - ymin) / (useMulti ? flo * 4 : flo)));
    if (nb * nf > 900) { const k = Math.sqrt(900 / (nb * nf)); nb = Math.max(1, Math.floor(nb * k)); nf = Math.max(1, Math.floor(nf * k)); }
    const dS = (smax - smin) / nb; const dY = (ymax - ymin) / nf;
    let nrm = [-e[1], 0, e[0]];
    if (nrm[0] * out[0] + nrm[2] * out[2] < 0) nrm = [-nrm[0], 0, -nrm[2]];
    const base = st.color || WHITE;
    for (let f = 0; f < nf; f++) for (let b = 0; b < nb; b++) {
      const sL = smin + b * dS; const sR = sL + dS; const yB = ymin + f * dY; const yT = yB + dY;
      let poly = clipPoly(pts, 0, sL, true); if (poly.length < 3) continue;
      poly = clipPoly(poly, 0, sR, false); if (poly.length < 3) continue;
      poly = clipPoly(poly, 1, yB, true); if (poly.length < 3) continue;
      poly = clipPoly(poly, 1, yT, false); if (poly.length < 3) continue;
      const sMid = (sL + sR) / 2; const es = st.ends ? (sMid - smin < st.ends.w ? st.ends.a : (smax - sMid < st.ends.w ? st.ends.b : null)) : null;
      const nm = es ? es.cell : (useMulti ? LO_CELL[cellName] : (multi ? cellName + ((hash2(b * 7 + f, tileSeed) * multi) | 0) : cellName));
      const r = RECTS[nm];
      const k = 1 + (hash2(b + f * 31, tileSeed + 3) - 0.5) * (st.jitter === undefined ? 0.06 : st.jitter);
      const bc = es ? es.color : base;
      const c = [bc[0] * k, bc[1] * k, bc[2] * k];
      const i0 = g.count;
      poly.forEach((q) => g.vert(p0[0] + e[0] * q[0], q[1] + dy, p0[1] + e[1] * q[0], nrm[0], 0, nrm[2], lerp(r[0], r[2], (q[0] - sL) / dS), lerp(r[1], r[3], (q[1] - yB) / dY), c));
      for (let i = 1; i < poly.length - 1; i++) {
        const A = [e[0] * poly[0][0], poly[0][1], e[1] * poly[0][0]]; const B = [e[0] * poly[i][0], poly[i][1], e[1] * poly[i][0]]; const Cc = [e[0] * poly[i + 1][0], poly[i + 1][1], e[1] * poly[i + 1][0]];
        const cr = cross(sub(B, A), sub(Cc, A));
        if (cr[0] * nrm[0] + cr[2] * nrm[2] >= 0) g.tri(i0, i0 + i, i0 + i + 1); else g.tri(i0, i0 + i + 1, i0 + i);
      }
    }
    tileSeed = (tileSeed * 1664525 + 1013904223) | 0;
  }
  /* o: { wall: {cell,color,bay,floor}, roofFlat: {cell,color}, roofSteep: {cell,color}, steepDeg, skirt, wallFn(ring, nrm) -> style|null, roofFn(ring, slopeDeg) -> {cell,color}|null } */
  function drawLod2(g, b, o, hi, dy) {
    dy = dy || 0;
    let cx = 0; let cz = 0; let cn = 0;
    b.roofs.forEach((r) => r.forEach((p) => { cx += p[0]; cz += p[1]; cn++; }));
    if (!cn) b.walls.forEach((r) => r.forEach((p) => { cx += p[0]; cz += p[1]; cn++; }));
    cx /= cn || 1; cz /= cn || 1;
    const stW = o.wall || { cell: 'plain', color: C_WHITE, bay: 8, floor: 8 };
    b.walls.forEach((ring) => {
      const nm = newell(ring); const l = Math.hypot(nm[0], nm[1], nm[2]) || 1;
      let wx = 0; let wz = 0; ring.forEach((p) => { wx += p[0]; wz += p[1]; }); wx /= ring.length; wz /= ring.length;
      const out = [wx - cx, 0, wz - cz];
      const st = (o.wallFn && o.wallFn(ring, nm)) || stW;
      if (Math.abs(nm[1]) / l < 0.3 && ring.length === 4) {
        const idx = [0, 1, 2, 3].sort((i, j) => ring[i][2] - ring[j][2]);
        const lo2 = [ring[idx[0]], ring[idx[1]]]; const hi2 = [ring[idx[2]], ring[idx[3]]];
        const d00 = Math.hypot(lo2[0][0] - hi2[0][0], lo2[0][1] - hi2[0][1]); const d01 = Math.hypot(lo2[0][0] - hi2[1][0], lo2[0][1] - hi2[1][1]);
        const t0 = d00 <= d01 ? hi2[0] : hi2[1]; const t1 = d00 <= d01 ? hi2[1] : hi2[0];
        const P = (p, y) => [p[0], (y === undefined ? p[2] : y) + dy - (o.skirt || 0) * 0, p[1]];
        let A = P(lo2[0]); let B = P(lo2[1]); let Cc = P(t1); let D = P(t0);
        const sk = o.skirt || 0; if (sk) { A[1] -= sk; B[1] -= sk; }
        const nn = cross(sub(B, A), sub(D, A));
        if (nn[0] * out[0] + nn[2] * out[2] < 0) { const tA = A; A = B; B = tA; const tC = Cc; Cc = D; D = tC; }
        const emit = (A, B, Cc, D, st) => {
        const Lw = Math.hypot(B[0] - A[0], B[2] - A[2]); const Hh = ((Cc[1] + D[1]) - (A[1] + B[1])) / 2;
        if (Lw < 0.2 || Hh < 0.2) return;
        const TBd = st.topBand || o.topBand;
        if (TBd && Hh > TBd.h * 2.2 && !(st.noBand && !st.topBand)) { // grey metal top storey: split the wall at (top - h)
          const f = (Hh - TBd.h) / Hh; const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
          const A2 = mix(A, D, f); const B2 = mix(B, Cc, f); const bst = TBd.st;
          const cn2 = st.cell || 'plain'; const m2 = VARIANTS[cn2]; const bay2 = st.bay || 3.6; const flo2 = st.floor || 3.6;
          const nb2 = Math.max(1, Math.round(Lw / (hi || !LO_CELL[cn2] ? bay2 : bay2 * 4))); const nf2 = Math.max(1, Math.round((Hh - TBd.h) / (hi || !LO_CELL[cn2] ? flo2 : flo2 * 4)));
          quadTiled(g, A, B, B2, A2, nb2, nf2, (bb, ff) => ((hi || !LO_CELL[cn2]) ? (m2 ? cn2 + ((hash2(bb * 7 + ff, tileSeed) * m2) | 0) : cn2) : LO_CELL[cn2]), st.color || WHITE, st.jitter);
          quadTiled(g, A2, B2, Cc, D, Math.max(1, Math.round(Lw / (bst.bay || 6))), Math.max(1, Math.round(TBd.h / (bst.floor || TBd.h))), () => bst.cell, bst.color, 0.02);
          return;
        }
        const cellName = st.cell || 'plain'; const multi = VARIANTS[cellName];
        const bay = st.bay || 3.6; const flo = st.floor || 3.6;
        if (hi || !LO_CELL[cellName]) {
          let nb = Math.max(1, Math.round(Lw / bay)); let nf = Math.max(1, Math.round(Hh / flo));
          if (nb * nf > 900) { const k = Math.sqrt(900 / (nb * nf)); nb = Math.max(1, Math.floor(nb * k)); nf = Math.max(1, Math.floor(nf * k)); }
          quadTiled(g, A, B, Cc, D, nb, nf, (bb, ff) => (multi ? cellName + ((hash2(bb * 7 + ff, tileSeed) * multi) | 0) : cellName), st.color || WHITE, st.jitter);
        } else {
          const nb = Math.max(1, Math.round(Lw / (bay * 4))); const nf = Math.max(1, Math.round(Hh / (flo * 4)));
          quadTiled(g, A, B, Cc, D, nb, nf, () => LO_CELL[cellName], st.color || WHITE, st.jitter);
        }
        };
        if (st.ends && Math.hypot(B[0] - A[0], B[2] - A[2]) > st.ends.w * 3) {
          const Lw0 = Math.hypot(B[0] - A[0], B[2] - A[2]); const t = st.ends.w / Lw0; const mixp = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
          const A1 = mixp(A, B, t); const D1 = mixp(D, Cc, t); const B1 = mixp(A, B, 1 - t); const C1 = mixp(D, Cc, 1 - t);
          emit(A, A1, D1, D, st.ends.a); emit(A1, B1, C1, D1, st); emit(B1, B, Cc, C1, st.ends.b);
        } else emit(A, B, Cc, D, st);
      } else if (Math.abs(nm[1]) / l < 0.3 && !o.polyPlain) {
        const sk = o.skirt || 0;
        wallPoly(g, sk ? ring.map((p) => [p[0], p[1], p[2] - (p[2] < 0.5 ? sk : 0)]) : ring, out, st, hi, dy);
      } else {
        const pr = ring.map((p) => [p[0], p[1], p[2] - (o.skirt && p[2] < 0.5 ? o.skirt : 0)]);
        polyFace(g, pr, st.color || WHITE, 'plain', out, dy);
      }
    });
    const steepDeg = o.steepDeg || 28;
    b.roofs.forEach((ring) => {
      const nm = newell(ring); const l = Math.hypot(nm[0], nm[1], nm[2]) || 1;
      const slope = (Math.acos(Math.min(1, Math.abs(nm[1]) / l)) * 180) / Math.PI;
      let rs = (o.roofFn && o.roofFn(ring, slope)) || (slope > steepDeg ? o.roofSteep : o.roofFlat) || { cell: 'roofGrey', color: C_ROOF };
      polyFace(g, ring, rs.color, rs.cell, [0, 1, 0], dy);
    });
  }
  /* LOD2 where available, otherwise the OSM footprint extruded to the measured (LiDAR) height */
  function lodOr(g, L, role, hi, o, fallback) {
    const bl = L.lod(role);
    if (bl.length) { bl.forEach((b) => drawLod2(g, b, o, hi, L.dy)); return true; }
    if (fallback) fallback();
    return false;
  }

  /* ================================================================== models: buildings (LOD2 shapes + facades) */
  const wallS = (cell, hex, bay, floor, jitter) => ({ cell, color: col(hex), bay: bay || 3.6, floor: floor || 3.6, jitter });
  const RF = (hex, cell) => (cell === 'plain' ? { cell: 'plain', color: col(hex) } : { cell: cell || 'roofGrey', color: tintOf(col(hex)) });
  const lodTop = (b) => { let m = -1e9; b.roofs.forEach((r) => r.forEach((p) => { m = Math.max(m, p[2]); })); return m; };
  const ringTop = (ring) => ring.reduce((m, p) => Math.max(m, p[2]), -1e9);

  /* ---- Philharmonie: eye-shaped white hall behind a screen of 823 white columns (Portzamparc, 2005) */
  def('philharmonie', 'Philharmonie Luxembourg', { radius: 70, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const hall = L.one('hall');
    const ring = orient(hall.r, true);
    const c = centroid(ring);
    const H = 19.6; // top of the colonnade (roof plate underside)
    const plate = { cell: 'plain', color: col('#efeee9'), bay: 8, floor: 6, jitter: 0.01 };
    foundationRing(g, ring, 6);
    const ok = lodOr(g, L, 'hall', hi, {
      wall: { cell: 'columns', color: WHITE, bay: 10, floor: 20, jitter: 0 }, roofFlat: RF('#ecebe6', 'plain'), roofSteep: RF('#e3e2dd', 'plain'), skirt: 6,
      wallFn: (ring3) => (ringTop(ring3) > H + 1 ? { cell: 'curtain', color: col('#cfe0e8'), bay: 3.2, floor: 3.4 } : null),
    }, () => {
      prism(g, scaleRing(ring, 0.9, c), null, 0, H, { cell: 'curtain', color: col('#dfe9ee'), bay: 3.2, floor: 3.4 }, false, hi);
      prism(g, ring, null, H, H + 1.4, plate, RF('#e7e6e1', 'plain'), false);
    });
    void ok;
    if (hi) { // the colonnade: 4 staggered rows, denser at the entrance, thin 6-sided white steel columns
      const st = { cell: 'plain', color: col('#f7f6f2'), floor: 60, jitter: 0 };
      [[0.992, 1.5], [0.962, 1.6], [0.932, 1.8], [0.9, 2.1]].forEach((rw, ri) => {
        ringPoints(scaleRing(ring, rw[0], c), rw[1]).forEach((p, i) => { if ((i * 7 + ri * 3) % 13 !== 0) cylinder(g, p[0], p[1], 0, H, 0.17, 0.15, 5, st, false, false); });
      });
    }
  });

  /* ---- d'Coque (Roger Taillibert, 1982): swimming-pool fan and arena under big folded concrete shells */
  def('coque', "d'Coque", { radius: 130, hiR: { high: 600, medium: 420 } }, (g, hi, L) => {
    const st = wallS('ribbon', '#e9e7e1', 4, 3.8);
    const shell = (ring, slope) => (slope > 38 ? RF('#4a4f56', 'shell') : slope > 12 ? RF('#585d65', 'shell') : RF('#6d7279', 'shell'));
    ['pool', 'arena'].forEach((role) => {
      lodOr(g, L, role, hi, { wall: st, roofFn: shell, roofFlat: RF('#6d7279', 'shell'), skirt: 5, polyPlain: true }, () => {
        const p = L.one(role); prism(g, p.r, null, -4, p.hm || 14, st, RF('#585d65', 'shell'), hi);
      });
    });
    ['b1', 'b2'].forEach((role) => { const p = L.one(role); if (p && !L.lod(role).length) prism(g, p.r, null, -3, Math.max(4, p.hm || 6), st, roofS(), hi); });
  });

  /* ---- European Parliament (Konrad Adenauer buildings KAD / KAD2) beside the Europaparlament stop */
  def('kad1', 'European Parliament – KAD', { radius: 90, hiR: { high: 480, medium: 340 } }, (g, hi, L) => {
    const st = wallS('blinds', '#ffffff', 3.6, 3.6);
    lodOr(g, L, 'kad1', hi, { wall: st, roofFlat: RF('#7b7f83'), roofSteep: RF('#5d6269', 'slate'), skirt: 6 }, () => {
      const k = L.one('kad1'); prism(g, k.r, k.holes, -4, k.hm || 25, st, roofS(col('#7b7f83')), hi);
    });
  });
  /* ---- European Parliament secretariat (KAD2) around the Europaparlament stop + its flag square.
   * Geometry: LOD2 (U-shaped complex, 16-floor tower at the east corner), styled after the photo: grey-clad office wings with horizontal
   * window bands and a grey metal top storey, orange / lime-green panelled ends, dark glass curtain-wall block at the back. */
  const SQ = { ax: -1130, az: -1745, p0: [-1224, -1675], p1: [-1075, -1737] }; // anchor of the square; south facade (portico) line
  const SQD = (() => { const dx = SQ.p1[0] - SQ.p0[0]; const dz = SQ.p1[1] - SQ.p0[1]; const dl = Math.hypot(dx, dz); const d = [dx / dl, dz / dl]; const south = [-d[1], d[0]]; return { d, dl, south, north: [-south[0], -south[1]] }; })();
  const KAD2_BANDS = { h: 3.4, st: { cell: 'metal', color: [0.9, 0.92, 0.94] } };
  def('kad2', 'European Parliament – KAD2', { radius: 170, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const A = defaultProject(L.anchor[0], L.anchor[1]); // anchor in the lat/lon projection: absolute local metres = anchor + model coordinates
    const ORANGE = [1, 0.62, 0.1]; const LIME = [0.72, 0.95, 0.12];
    const horizExtent = (ring) => { let m = 0; for (let i = 0; i < ring.length; i++) for (let k = i + 1; k < ring.length; k++) m = Math.max(m, Math.hypot(ring[i][0] - ring[k][0], ring[i][1] - ring[k][1])); return m; };
    const wallFn = (ring) => {
      let cx = 0; let cz = 0; ring.forEach((p) => { cx += p[0]; cz += p[1]; }); cx = cx / ring.length + A.x; cz = cz / ring.length + A.z;
      const top = ringTop(ring); const len = horizExtent(ring);
      if (top > 45) return { cell: 'fins', color: [1, 1, 1], bay: 3.0, floor: 3.7, jitter: 0.03, topBand: { h: 7.5, st: { cell: 'curtain', color: [0.55, 0.7, 0.8], bay: 3.2, floor: 3.7 } } }; // the 20-floor tower: light grey fins + glass crown
      if (cz < -1778 || (len >= 30 && len < 60 && cx < -1120 && cx > -1210 && cz > -1790 && cz < -1735)) return { cell: 'curtain', color: [0.4, 0.5, 0.58], bay: 3.2, floor: 3.6, noBand: true }; // the glass block at the back of the square
      if (len < 30 && top > 12) { // building ends and corners: orange / lime panels
        const k = hash2((cx * 3) | 0, (cz * 3) | 0);
        return { cell: 'panel', color: k < 0.5 ? ORANGE : LIME, bay: 4, floor: 3.4, jitter: 0.04 };
      }
      const ribbon = { cell: 'ribbon', color: [0.86, 0.88, 0.9], bay: 3.8, floor: 3.4 };
      if (len >= 26 && top < 45 && cz < -1721 + (cx + 1155) * -0.41 - 3) { // long wings facing the square: orange / lime panelled ends
        ribbon.ends = { w: 11, a: { cell: 'panel', color: ORANGE, bay: 4, floor: 3.4, jitter: 0.03, noBand: true }, b: { cell: 'panel', color: LIME, bay: 4, floor: 3.4, jitter: 0.03, noBand: true } };
      }
      return ribbon;
    };
    /* The long 11 m wide strip along Avenue JFK is NOT a closed wing: it is a flat canopy slab (roof at ~31 m, LiDAR/LOD2) on free standing white columns,
     * open to the tram stop and the flag square. LOD2 extrudes it down to the ground, so its walls are cut to a thin canopy edge and columns are added. */
    const { d: sd, dl: sdl, north: snorth } = SQD;
    const inStrip = (ring) => {
      let cx = 0; let cz = 0; ring.forEach((p) => { cx += p[0]; cz += p[1]; }); cx = cx / ring.length + A.x - SQ.p0[0]; cz = cz / ring.length + A.z - SQ.p0[1];
      const u = cx * sd[0] + cz * sd[1]; const w = cx * snorth[0] + cz * snorth[1];
      return u > 6 && u < sdl + 2 && w > -2 && w < 14 && ringTop(ring) > 20;
    };
    let canopyTop = -1e9;
    const bld = L.lod('kad2').map((b) => {
      const walls = []; const strWalls = []; const roofs = []; const strRoofs = [];
      b.walls.forEach((r) => (inStrip(r) ? strWalls : walls).push(r));
      b.roofs.forEach((r) => (inStrip(r) ? strRoofs : roofs).push(r));
      strRoofs.forEach((r) => { canopyTop = Math.max(canopyTop, ringTop(r)); });
      return { b, walls, roofs, strWalls, strRoofs };
    });
    bld.forEach((x) => drawLod2(g, { roofs: x.roofs, walls: x.walls }, { wall: { cell: 'ribbon', color: [0.86, 0.88, 0.9], bay: 3.8, floor: 3.4 }, wallFn, topBand: KAD2_BANDS, roofFlat: RF('#7b7f83'), roofSteep: RF('#5d6269'), skirt: 6 }, hi, L.dy));
    const T_SLAB = 0.9; const white = [0.93, 0.94, 0.94];
    bld.forEach((x) => {
      x.strRoofs.forEach((r) => { polyFace(g, r, white, 'plain', [0, 1, 0], L.dy); polyFace(g, r.slice().reverse(), [0.82, 0.84, 0.85], 'plain', [0, -1, 0], L.dy - T_SLAB); });
      x.strWalls.forEach((r) => { // keep only the top T_SLAB of every wall: the canopy edge
        const top = ringTop(r); const cut = r.map((p) => [p[0], p[1], Math.max(p[2], top - T_SLAB)]);
        polyFace(g, cut, white, 'plain', [(cut[0][0] - 0), 0, 0], L.dy);
      });
    });
    if (canopyTop > -1e8) {
      const top = canopyTop + L.dy - T_SLAB;
      // cantilever: the slab reaches 9 m out over the tram tracks, thinning to a slightly upturned edge
      const P = (u, w, y) => { const x = SQ.p0[0] + sd[0] * u + snorth[0] * w - A.x; const z = SQ.p0[1] + sd[1] * u + snorth[1] * w - A.z; return [x, y, z]; };
      const ua = 8; const ub = sdl + 2; const wTip = -9.5; const wRoot = 0;
      const top0 = canopyTop + L.dy; const tipUp = 1.3;
      quadP(g, P(ua, wRoot, top0), P(ub, wRoot, top0), P(ub, wTip, top0 + tipUp), P(ua, wTip, top0 + tipUp), 'plain', white);
      quadP(g, P(ua, wTip, top0 + tipUp - 0.3), P(ub, wTip, top0 + tipUp - 0.3), P(ub, wRoot, top - 0.0), P(ua, wRoot, top - 0.0), 'plain', [0.84, 0.86, 0.87]);
      quadP(g, P(ua, wTip, top0 + tipUp), P(ub, wTip, top0 + tipUp), P(ub, wTip, top0 + tipUp - 0.3), P(ua, wTip, top0 + tipUp - 0.3), 'plain', white);
      quadP(g, P(ub, wTip, top0 + tipUp - 0.3), P(ub, wTip, top0 + tipUp), P(ub, wRoot, top0), P(ub, wRoot, top), 'plain', white);
      quadP(g, P(ua, wTip, top0 + tipUp), P(ua, wTip, top0 + tipUp - 0.3), P(ua, wRoot, top), P(ua, wRoot, top0), 'plain', white);
      const colSt = { cell: 'plain', color: [0.97, 0.97, 0.96], floor: 80, jitter: 0 };
      const cols = [[2.0, 10, 19], [2.0, 29, 19], [2.0, 48, 19], [2.0, 67, 19], [2.0, 86, 19], [2.0, 105, 19], [2.0, 124, 19], [8.5, 22, 38], [8.5, 60, 38], [8.5, 98, 38]];
      cols.forEach(([w, u0]) => {
        const u = u0; if (u > sdl - 3) return;
        const x = SQ.p0[0] + sd[0] * u + snorth[0] * w; const z = SQ.p0[1] + sd[1] * u + snorth[1] * w;
        const gyv = L.gy ? L.gy(x - A.x, z - A.z) : 0;
        cylinder(g, x - A.x, z - A.z, gyv - 0.3, top + 0.05, hi ? 0.34 : 0.5, hi ? 0.3 : 0.45, hi ? 8 : 4, colSt, false, false);
      });
    }
  });
  /* ---- flag square: grey paving with pale diagonals, 28 flags, planters; tall white portico along Avenue JFK next to the tram stop */
  def('epsquare', 'Europaparlament flag square', { radius: 90, anchor: [LAT0 - SQ.az / M_LAT, LON0 + SQ.ax / M_LON], hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const rel = (x, z) => [x - SQ.ax, z - SQ.az];
    const gyAt = (x, z) => (L.gy ? L.gy(x - SQ.ax, z - SQ.az) : 0);
    const dx = SQ.p1[0] - SQ.p0[0]; const dz = SQ.p1[1] - SQ.p0[1]; const dl = Math.hypot(dx, dz); const d = [dx / dl, dz / dl];
    const n = [-d[1] * -1, d[0] * -1]; // placeholder, fixed below
    void n;
    const south = [d[1] * -1, d[0]]; // normal pointing south-east: (+z side), away from the square
    const north = [-south[0], -south[1]];
    const at = (u, w, y) => { const x = SQ.p0[0] + d[0] * u + north[0] * w; const z = SQ.p0[1] + d[1] * u + north[1] * w; return [x - SQ.ax, y + gyAt(x, z), z - SQ.az]; };
    // paved square: along the facade (u 0..dl), 46 m deep, tiles of 24 m so the diagonals read as the big stripe pattern
    const W = 70; const nu = Math.max(1, Math.round(dl / 24)); const nw = Math.max(1, Math.round((W - 0.5) / 24));
    const U0 = 2; const U1 = dl + 2;
    for (let i = 0; i < nu; i++) for (let k = 0; k < nw; k++) {
      const u0 = U0 + ((U1 - U0) * i) / nu; const u1 = U0 + ((U1 - U0) * (i + 1)) / nu; const w0 = 0.5 + ((W - 0.5) * k) / nw; const w1 = 0.5 + ((W - 0.5) * (k + 1)) / nw;
      quadP(g, at(u0, w1, 0.12), at(u1, w1, 0.12), at(u1, w0, 0.12), at(u0, w0, 0.12), 'plaza', WHITE);
    }
    // flag poles: two staggered rows, 28 poles; flags (animated look = a gentle static wave) streaming north-east
    const flagR = RECTS.flags; const poleSt = { cell: 'plain', color: col('#e4e6e8'), floor: 40, jitter: 0 };
    let nf = 0;
    for (let row = 0; row < 2 && nf < 28; row++) for (let k = 0; k < 14 && nf < 28; k++) {
      const u = 36 + k * 5.4 + row * 2.7; const w = 25 + row * 4.5; const p = at(u, w, 0);
      cylinder(g, p[0], p[2], p[1], p[1] + 12.5, 0.1, 0.07, 5, poleSt, false, false);
      box(g, p[0], p[1] + 12.7, p[2], 0.3, 0.3, 0.3, 0, { cell: 'glow', color: [0.95, 0.85, 0.5], bay: 8, floor: 8 }, { cell: 'glow', color: [0.95, 0.85, 0.5] }, false);
      const fi = nf; const c0 = fi % 4; const r0 = Math.floor(fi / 4);
      const fu0 = lerp(flagR[0], flagR[2], c0 / 4 + 0.004); const fu1 = lerp(flagR[0], flagR[2], (c0 + 1) / 4 - 0.004);
      const fv1 = lerp(flagR[3], flagR[1], r0 / 7 + 0.004); const fv0 = lerp(flagR[3], flagR[1], (r0 + 1) / 7 - 0.004); // atlas rows run top to bottom
      const dirU = d; const dirW = north; const fl = 3.0; const fh = 1.9; const sgn = fi % 2 ? 1 : -1;
      const seg = hi ? 4 : 1; const phase = fi * 0.9;
      const pts = []; for (let s = 0; s <= seg; s++) { const t = s / seg; const wave = Math.sin(t * 5 + phase) * 0.25 * t; pts.push([p[0] + (dirU[0] * 0.7 + dirW[0] * 0.3) * fl * t + dirW[0] * wave * sgn, p[2] + (dirU[1] * 0.7 + dirW[1] * 0.3) * fl * t + dirW[1] * wave * sgn]); }
      for (let s = 0; s < seg; s++) {
        const a = pts[s]; const b = pts[s + 1]; const y1 = p[1] + 12.2; const y0 = y1 - fh; const ua = lerp(fu0, fu1, s / seg); const ub = lerp(fu0, fu1, (s + 1) / seg);
        const nrm = norm(cross([b[0] - a[0], 0, b[1] - a[1]], [0, 1, 0]));
        const i0 = g.vert(a[0], y0, a[1], nrm[0], 0, nrm[2], ua, fv0, WHITE); const i1 = g.vert(b[0], y0, b[1], nrm[0], 0, nrm[2], ub, fv0, WHITE);
        const i2 = g.vert(b[0], y1, b[1], nrm[0], 0, nrm[2], ub, fv1, WHITE); const i3 = g.vert(a[0], y1, a[1], nrm[0], 0, nrm[2], ua, fv1, WHITE);
        g.quad(i0, i1, i2, i3);
      }
      nf++;
    }
    // planters with small trees
    [[40, 44], [75, 46], [105, 42]].forEach(([u, w], i) => {
      const a = at(u, w, 0); const rot = Math.atan2(d[1], d[0]);
      box(g, a[0], a[1] + 0.35, a[2], 16, 0.7, 2.6, rot, { cell: 'plain', color: col('#8e9296'), bay: 8, floor: 8, jitter: 0.02 }, RF('#6f7d4a', 'greenroof'), false);
      [-5, 0, 5].forEach((o2, k) => { const t = at(u + o2, w, 0); cylinder(g, t[0], t[2], t[1] + 0.7, t[1] + 3.0, 0.12, 0.1, 5, { cell: 'plain', color: col('#5a4a3a'), floor: 40 }, false, false); cone(g, t[0], t[2], t[1] + 2.4, 1.5, 2.8, hi ? 7 : 5, 'greenroof', [0.95, 1.0, 0.85], 0.6); void i; void k; });
    });
    // low concrete bench blocks at the edge of the square
    [[30, 36], [60, 38], [95, 36]].forEach(([u, w]) => { const a = at(u, w, 0); box(g, a[0], a[1] + 0.3, a[2], 9, 0.6, 1.2, Math.atan2(d[1], d[0]), { cell: 'plain', color: col('#a3a6a8') }, RF('#a3a6a8', 'plain'), false); });
  });
  def('eca', 'European Court of Auditors', { radius: 80, hiR: { high: 420, medium: 300 } }, (g, hi, L) => {
    const st = wallS('punched', '#bfb5a4', 3.4, 3.4);
    lodOr(g, L, 'eca', hi, { wall: st, roofFlat: RF('#7d6558'), roofSteep: RF('#6a5448', 'slate'), skirt: 6 }, () => {
      const k = L.one('eca'); prism(g, k.r, k.holes, -4, k.hm || 26, st, roofS(col('#7d6558')), hi);
    });
  });

  /* ---- Cour de Justice: the three golden towers + Thomas More / Erasmus galleries */
  def('ecj', 'Cour de Justice de l\'Union européenne', { radius: 120, hiR: { high: 560, medium: 400 } }, (g, hi, L) => {
    const gold = { cell: 'gold', color: WHITE, bay: 3.6, floor: 3.6 };
    const dark = wallS('ribbon', '#cfd2d2', 3.6, 3.6);
    const roofCu = (ring, slope) => RF(slope > 8 ? '#8c9096' : '#a4a8ac', 'plain');
    let any = false;
    ['towerB', 'thomasmore', 'erasmus', 'themis'].forEach((role) => {
      const bl = L.lod(role);
      bl.forEach((b) => {
        any = true;
        const towerWall = (ring3) => (ringTop(ring3) > 40 ? gold : dark);
        drawLod2(g, b, { wall: dark, wallFn: towerWall, roofFn: (ring3, slope) => (ringTop(ring3) > 40 ? RF('#4a4d52', 'plain') : roofCu(ring3, slope)), skirt: 8 }, hi, L.dy);
      });
    });
    if (!any) { // no LOD2 detail data: three towers from the footprints (LiDAR: 103 / 108 / 113 m)
      [['towerA', 103], ['towerB', 108], ['towerC', 113]].forEach((t) => { const p = L.one(t[0]); if (p) prism(g, p.r, null, -6, t[1], gold, RF('#4a4d52', 'plain'), hi); });
    } else {
      ['towerA', 'towerC'].forEach((role, i) => { const p = L.one(role); if (p && !L.lod('towerB').length) prism(g, p.r, null, -6, [103, 113][i], gold, RF('#4a4d52', 'plain'), hi); });
    }
  });

  /* ---- Kirchberg towers along Avenue JFK: Alcide de Gasperi (87 m), Porte de l'Europe A/B (72 m), the EP hemicycle, EIB */
  def('gasperi', 'Alcide de Gasperi / Porte de l\'Europe', { radius: 130, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const gl = { cell: 'curtain', color: col('#c9d9df'), bay: 3.4, floor: 3.5 };
    const porte = { cell: 'curtain', color: col('#e4ecef'), bay: 3.2, floor: 3.5 };
    const p0 = L.one('gasperi'); if (p0) prism(g, p0.r, null, -6, p0.hm || 86, { cell: 'curtain', color: col('#c4d6e0'), bay: 3.2, floor: 3.6 }, RF('#7b7f83'), hi);
    const pb = L.one('porteB'); if (pb) prism(g, pb.r, null, -6, pb.hm || 72, porte, RF('#7b7f83'), hi);
    lodOr(g, L, 'porteA', hi, { wall: porte, roofFlat: RF('#7b7f83'), skirt: 8 }, () => { const pa = L.one('porteA'); if (pa) prism(g, pa.r, null, -6, pa.hm || 72, porte, RF('#7b7f83'), hi); });
    lodOr(g, L, 'hemicycle', hi, { wall: wallS('ribbon', '#dedcd6', 3.6, 3.6), roofFlat: RF('#7a7e82'), roofSteep: RF('#64696f'), skirt: 8 }, () => { const h = L.one('hemicycle'); if (h) prism(g, h.r, null, -6, h.hm || 30, wallS('ribbon', '#dedcd6'), RF('#7a7e82'), hi); });
    void gl;
  });
  def('eib', 'European Investment Bank', { radius: 100, hiR: { high: 480, medium: 340 } }, (g, hi, L) => {
    const gl = { cell: 'curtain', color: [0.62, 0.7, 0.76], bay: 3.4, floor: 3.6 };
    const w = L.one('wki'); if (w) { prism(g, w.r, null, -6, 15, gl, false, hi); const ob = obbOf(w.r); const fill = Math.abs(area2(w.r)) / 2 / ((ob.u1 - ob.u0) * (ob.w1 - ob.w0)); if (fill > 0.75) barrelRoof(g, w.r, 15, 7, hi ? 8 : 4, 'glassroof', [0.9, 0.82, 0.68], hi); else flatPoly(g, w.r, null, 15.05, 'glassroof', [0.85, 0.9, 0.92], false); }
    const e = L.one('eki'); if (e) prism(g, e.r, null, -6, Math.max(18, e.hm || 24), { cell: 'curtain', color: [0.7, 0.78, 0.82], bay: 3.4, floor: 3.6 }, RF('#8a8e91'), hi);
  });


  /* pitched glazed roof over an oriented box: glass slopes up from y0 to a ridge at y1 */
  function glassPitch(g, ring, y0, y1, hip, hi, tint) {
    const o = obbOf(ring); const col2 = tint || WHITE;
    const P = (u, w, y) => { const q = o.at(u, w); return [q[0], y, q[1]]; };
    const mw = (o.w0 + o.w1) / 2;
    const nU = Math.max(1, Math.round((o.u1 - o.u0) / (hi ? 6 : 24))); const nW = Math.max(1, Math.round((o.w1 - o.w0) / (hi ? 12 : 48)));
    tiledQuad(g, P(o.u0, o.w0, y0), P(o.u1, o.w0, y0), P(o.u0, mw, y1), nU, nW, 'glassroof', col2, hi);
    tiledQuad(g, P(o.u1, o.w1, y0), P(o.u0, o.w1, y0), P(o.u1, mw, y1), nU, nW, 'glassroof', col2, hi);
    quadP(g, P(o.u0, o.w1, y0), P(o.u0, o.w0, y0), P(o.u0, mw, y1), P(o.u0, mw, y1), 'glassroof', col2);
    quadP(g, P(o.u1, o.w0, y0), P(o.u1, o.w1, y0), P(o.u1, mw, y1), P(o.u1, mw, y1), 'glassroof', col2);
    void hip;
  }
  function barrelRoof(g, ring, y0, rise, seg, cellName, color, hi) {
    const o = obbOf(ring); const P = (u, w, y) => { const q = o.at(u, w); return [q[0], y, q[1]]; };
    const mw = (o.w0 + o.w1) / 2; const hw = (o.w1 - o.w0) / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI; const a1 = ((i + 1) / seg) * Math.PI;
      const w0 = mw - Math.cos(a0) * hw; const w1 = mw - Math.cos(a1) * hw; const y00 = y0 + Math.sin(a0) * rise; const y11 = y0 + Math.sin(a1) * rise;
      tiledQuad(g, P(o.u0, w0, y00), P(o.u1, w0, y00), P(o.u0, w1, y11), Math.max(1, Math.round((o.u1 - o.u0) / (hi ? 6 : 30))), 1, cellName, color, hi);
    }
  }

  /* ---- Luxexpo The Box: long steel-clad halls with striped roofs */
  def('luxexpo', 'Luxexpo The Box', { radius: 260, hiR: { high: 560, medium: 380 } }, (g, hi, L) => {
    const wallC = { cell: 'corrug', color: WHITE, bay: 8, floor: 8, jitter: 0.03 };
    L.get('hall').forEach((p, i) => {
      const big = Math.abs(area2(p.r)) / 2 > 3000; const glassHall = p.id === 208692446 || p.id === 286901404 || big;
      const h = glassHall ? 5 : Math.max(6.5, p.hm || 8);
      const dark = (i % 3) !== 1;
      if (glassHall) { // the sloping glass hall with its blue steel frame (reference photo): glazed walls, glass pitched roof, black / glass sign tower
        prism(g, p.r, null, -3, h, { cell: 'curtain', color: [0.72, 0.84, 0.92], bay: 4, floor: 5 }, false, hi);
        glassPitch(g, p.r, h, big ? 12 : (p.id === 208692446 ? 14.5 : 12.5), false, hi, [0.78, 0.9, 0.98]);
        if (p.id === 208692446) { const cc = centroid(p.r); box(g, cc[0] + 8, 10.5, cc[1] - 2, 5.5, 21, 5.5, 0, { cell: 'curtain', color: [0.55, 0.7, 0.82], bay: 2.8, floor: 3.6 }, RF('#2d3033', 'plain'), hi); box(g, cc[0] + 8, 23, cc[1] - 2, 7.5, 4, 7.5, 0, { cell: 'plain', color: col('#26282b'), bay: 8, floor: 8 }, RF('#26282b', 'plain'), false); }
        return;
      }
      prism(g, p.r, null, -3, h, wallC, RF(dark ? '#5e6266' : '#d4d6d3', 'plain'), hi);
      { // roof stripes along the hall
        const o = obbOf(p.r); const sw = 6.5; const nst = Math.max(2, Math.round((2 * o.hw) / sw));
        for (let k = 0; k < nst; k += 2) {
          const w0 = o.w0 + (k * 2 * o.hw) / nst; const w1 = o.w0 + ((k + 1) * 2 * o.hw) / nst;
          const q = (u, w) => { const t = o.at(u, w); return [t[0], h + 0.06, t[1]]; };
          quadP(g, q(o.u0 + 0.3, w0), q(o.u1 - 0.3, w0), q(o.u1 - 0.3, w1), q(o.u0 + 0.3, w1), 'plain', col(dark ? '#cfd1ce' : '#4d5156'));
        }
      }
    });
  });

  /* ---- Mudam (I. M. Pei, 2006) on the Fort Thüngen / Dräi Eechelen bastion */
  def('mudam', 'Mudam + Fort Thüngen', { radius: 120, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const stone = { cell: 'ashlar', color: [1, 0.98, 0.94], bay: 4, floor: 4, jitter: 0.04 };
    lodOr(g, L, 'museum', hi, {
      wall: stone, skirt: 8,
      roofFn: (ring, slope) => (slope > 18 && slope < 80 ? RF('#a8c4d4', 'glassroof') : RF('#d9d0bb', 'plain')),
    }, () => { const p = L.one('museum'); prism(g, p.r, null, -6, p.hm || 20, stone, RF('#d9d0bb', 'plain'), hi); });
    lodOr(g, L, 'fort', hi, {
      wall: { cell: 'ashlar', color: [0.8, 0.78, 0.72], bay: 4, floor: 4 }, skirt: 8,
      roofFn: (ring, slope) => (slope > 28 ? RF('#4d5159', 'slate') : RF('#7d8f58', 'greenroof')),
    }, () => { const p = L.one('fort'); if (p) prism(g, p.r, null, -6, 8, { cell: 'ashlar', color: [0.74, 0.72, 0.66] }, RF('#7d8f58', 'greenroof'), hi); });
  });

  /* ---- Cloche d'Or shopping centre */
  def('cloche', "Cloche d'Or", { radius: 150, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const mall = { cell: 'ribbon', color: col('#4a4f55'), bay: 4, floor: 4.2 };
    const tower = { cell: 'punched', color: [0.7, 0.7, 0.58], bay: 3.4, floor: 3.6 }; // Sky Cloche: olive-gold grid facade
    lodOr(g, L, 'mall', hi, {
      wall: mall, skirt: 8,
      wallFn: (ring3) => (ringTop(ring3) > 35 ? tower : null),
      roofFn: (ring, slope) => (slope > 6 && slope < 75 ? RF('#9bb8c9', 'glassroof') : (ringTop(ring) > 35 ? RF('#80848a') : RF('#9a8a5c', 'greenroof'))),
    }, () => { const p = L.one('mall'); prism(g, p.r, null, -6, 20, mall, RF('#8b7a68', 'greenroof'), hi); });
  });

  /* ---- Royal-Hamilius (Foster + Partners): faceted stone-and-glass Galeries Lafayette block with terraced green roofs */
  def('hamilius', 'Royal-Hamilius', { radius: 80, hiR: { high: 480, medium: 340 } }, (g, hi, L) => {
    const facet = { cell: 'diamond', color: [0.82, 0.9, 0.95], bay: 5, floor: 5, jitter: 0.05 };
    ['lafayette', 'lafayette2', 'lafayette3'].forEach((role) => {
      lodOr(g, L, role, hi, { wall: facet, roofFn: (ring, slope) => (slope > 12 ? RF('#a9bfcc', 'glassroof') : RF('#7e8c58', 'greenroof')), skirt: 8 }, () => {
        const p = L.one(role); if (p) prism(g, p.r, null, -6, p.hm || 30, facet, RF('#7e8c58', 'greenroof'), hi);
      });
    });
  });

  /* ---- Place de l'Étoile: the corner blocks around the junction (slate mansards, sandstone) */
  def('etoile', 'Stäreplaz / Place de l\'Étoile', { radius: 90, hiR: { high: 480, medium: 340 } }, (g, hi, L) => {
    const st = wallS('punched', '#ece4d2', 3.4, 3.4);
    ['radbury', 'centre'].forEach((role) => {
      lodOr(g, L, role, hi, { wall: st, roofFlat: RF('#8b8d8e'), roofSteep: RF('#4b5058', 'slate'), skirt: 6 }, () => { const p = L.one(role); if (p) prism(g, p.r, null, -5, p.hm || 18, st, roofS(), hi); });
    });
  });

  /* ---- Gare Centrale: Moselle-baroque station with its clock tower, the glass entrance hall and the long platform canopies */
  def('gare', 'Gare Centrale', { radius: 200, hiR: { high: 520, medium: 380 } }, (g, hi, L) => {
    const sand = { cell: 'punched', color: col('#d9c9a6'), bay: 3.6, floor: 3.8, jitter: 0.05 };
    const slate = RF('#41464e', 'slate');
    const roofFn = (ring, slope) => (slope > 20 ? (ringTop(ring) > 24 ? RF('#4f9a86', 'plain') : slate) : RF('#6f7377', 'roofGrey'));
    let tower = null;
    ['main', 'pavilion'].forEach((role) => {
      lodOr(g, L, role, hi, { wall: sand, roofFn, skirt: 6 }, () => { const p = L.one(role); if (p) prism(g, p.r, null, -4, p.hm || 14, sand, slate, hi); });
    });
    L.lod('main').forEach((b) => b.roofs.forEach((r) => r.forEach((p) => { if (!tower || p[2] > tower[2]) tower = p; })));
    if (tower) { // four clock dials just below the belfry (the tall tower is part of the LOD2 shape)
      const dy = L.dy; const ty = tower[2] - 12.5 + dy; const off = 3.9;
      [[0, -1], [0, 1], [1, 0], [-1, 0]].forEach((d) => {
        const px = tower[0] + d[0] * off; const pz = tower[1] + d[1] * off; const s = 2.6; const tx = -d[1]; const tz = d[0];
        const A = [px - tx * s, ty - s, pz - tz * s]; const B = [px + tx * s, ty - s, pz + tz * s]; const Cc = [px + tx * s, ty + s, pz + tz * s]; const D = [px - tx * s, ty + s, pz - tz * s];
        const nn = cross(sub(B, A), sub(D, A)); if (nn[0] * d[0] + nn[2] * d[1] < 0) quadP(g, B, A, D, Cc, 'clock', WHITE); else quadP(g, A, B, Cc, D, 'clock', WHITE);
      });
    }
    // platform canopies: grey vaulted steel roofs with a glazed ridge, running NNE like the tracks (22 deg east of north)
    const ang = (22 * Math.PI) / 180; const d = [Math.sin(ang), -Math.cos(ang)]; const nrm = [Math.cos(ang), Math.sin(ang)];
    [[-37, -139, 48], [-9, -139, 62], [21, -139, 100], [51, -139, 140], [83, -139, 165], [115, -139, 165]].forEach((cp, k) => {
      const base = [cp[0], 81]; const w = 8.2; const e = 4.6; const rdg = 7;
      const p0 = [base[0] + d[0] * cp[1], base[1] + d[1] * cp[1]]; const p1 = [base[0] + d[0] * cp[2], base[1] + d[1] * cp[2]];
      const P = (pt, lat, y) => [pt[0] + nrm[0] * lat, y, pt[1] + nrm[1] * lat];
      const grey = col('#b4c0c8'); const glass = WHITE;
      // two roof slopes, glazed strip in the middle of the ridge
      const nseg = hi ? Math.max(1, Math.round((cp[2] - cp[1]) / 22)) : 1;
      for (let s = 0; s < nseg; s++) {
        const a = [lerp(p0[0], p1[0], s / nseg), lerp(p0[1], p1[1], s / nseg)]; const b = [lerp(p0[0], p1[0], (s + 1) / nseg), lerp(p0[1], p1[1], (s + 1) / nseg)];
        quadP(g, P(a, -w, e), P(b, -w, e), P(b, -2.4, rdg), P(a, -2.4, rdg), 'plain', grey);
        tiledQuad(g, P(a, -2.4, rdg), P(b, -2.4, rdg), P(a, 2.4, rdg + 0.6), Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5)), 1, 'glassroof', glass, hi);
        quadP(g, P(a, 2.4, rdg + 0.6), P(b, 2.4, rdg + 0.6), P(b, w, e), P(a, w, e), 'plain', grey);
        if (hi) { // posts every segment
          [-w + 0.3, w - 0.3].forEach((lat) => beam(g, P(a, lat, 0), P(a, lat, e), 0.35, 0.35, col('#5c656c'), 'plain'));
        }
      }
      if (k === 0 || k === 5) { /* end gables are open */ }
    });
  });

  /* ================================================================== models: stadium, bridges, funicular, lift */
  const interp = (prof, t, k) => { // prof rows [t, deckAbs, dtmAbs]
    const n = prof.length - 1; const f = clamp(t, 0, 1) * n; const i = Math.min(n - 1, Math.floor(f)); const u = f - i;
    return lerp(prof[i][k], prof[i + 1][k], u);
  };
  function loft(g, A, B, color, cellName) { // two polylines of [x,y,z] points with the same length -> quad strip
    for (let i = 0; i < A.length - 1; i++) quadP(g, A[i], B[i], B[i + 1], A[i + 1], cellName || 'plain', color);
  }
  const RED = [0.7, 0.3, 0.33]; const RED_D = [0.58, 0.24, 0.27];

  /* ---- Stade de Luxembourg (gmp, 2021): silver diamond-cladded bowl, wide white roof ring, open pitch */
  function obbOf(ring, angOverride) {
    let ang = angOverride;
    if (ang === undefined) { let best = 0; ang = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } } }
    const c = Math.cos(ang); const s = Math.sin(ang);
    let u0 = 1e9; let u1 = -1e9; let w0 = 1e9; let w1 = -1e9;
    ring.forEach((p) => { const u = p[0] * c + p[1] * s; const w = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); });
    return { ang, u0, u1, w0, w1, cu: (u0 + u1) / 2, cw: (w0 + w1) / 2, hu: (u1 - u0) / 2, hw: (w1 - w0) / 2, at(u, w) { return [u * c - w * s, u * s + w * c]; } };
  }
  def('stade', 'Stade de Luxembourg', { radius: 110, hiR: { high: 620, medium: 440 } }, (g, hi, L) => {
    const outer = L.one('stadium'); const pitch = L.one('pitch');
    const o = obbOf(outer.r);
    const pb = obbOf(pitch ? pitch.r : outer.r.map((p) => [p[0] * 0.5, p[1] * 0.5]), o.ang);
    const cu = o.cu; const cw = o.cw;
    const NS = hi ? 44 : 24; const EXP = 4.2; // super-ellipse = the rounded-rectangle bowl of the real stadium
    const loop = (hu, hw, y) => {
      const out = [];
      for (let i = 0; i < NS; i++) {
        const a = (i / NS) * Math.PI * 2; const ca = Math.cos(a); const sa = Math.sin(a);
        const u = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / EXP) * hu; const w = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / EXP) * hw;
        const q = o.at(cu + u, cw + w); out.push([q[0], y, q[1]]);
      }
      return out;
    };
    const strip = (A, B, color, cellName) => { for (let i = 0; i < NS; i++) { const j2 = (i + 1) % NS; quadP(g, A[i], A[j2], B[j2], B[i], cellName || 'plain', color); } };
    const stripT = (A, B, nb, nf, cellName, color) => { for (let i = 0; i < NS; i++) { const j2 = (i + 1) % NS; tiledQuad(g, A[i], A[j2], B[i], nb, nf, cellName, color, hi); } };
    const hu0 = o.hu; const hw0 = o.hw;
    const huP = pb.hu + 3.5; const hwP = pb.hw + 3.5;
    const huR = huP + 12; const hwR = hwP + 12;
    const wallTop = 25;
    // plinth + diamond-panel cladding
    strip(loop(hu0, hw0, -5), loop(hu0, hw0, 3.2), col('#9fa3a4'), 'plain');
    stripT(loop(hu0, hw0, 3.2), loop(hu0, hw0, wallTop), hi ? 2 : 1, hi ? 3 : 1, 'diamond', [0.95, 0.97, 0.98]);
    // roof ring: outer edge above the wall, sloping down to the opening, bright white
    const R0 = loop(hu0 - 0.3, hw0 - 0.3, wallTop + 1.6); const R1 = loop(huR, hwR, wallTop - 4.4);
    strip(R0, R1, col('#f1f2f0'), 'plain');
    const R1b = loop(huR, hwR, wallTop - 5.4);
    strip(R1, R1b, col('#cfd3d6'), 'plain');
    strip(R1b, loop(hu0 - 0.4, hw0 - 0.4, wallTop - 0.2), col('#8d949a'), 'plain'); // underside
    // seating bowl
    const huO = hu0 - 1.4; const hwO = hw0 - 1.4;
    const tier = (f) => [lerp(huP, huO, f), lerp(hwP, hwO, f)];
    const stages = [[0, 0.8, '#2d58a6'], [0.4, 10.2, '#2d58a6'], [0.46, 10.8, '#bfc4c8'], [0.52, 12.2, '#35476b'], [1, wallTop - 2.4, '#35476b']];
    let prev = loop(huP, hwP, 0.5);
    strip(loop(huP, hwP, -0.6), prev, col('#bdc2c5'), 'plain');
    for (let i = 0; i < stages.length; i++) { const [f, y, hex] = stages[i]; const t = tier(f); const cur = loop(t[0], t[1], y); strip(prev, cur, col(hex), 'plain'); prev = cur; }
    strip(prev, loop(huO, hwO, wallTop + 0.4), col('#4a5568'), 'plain');
    // pitch with mowing stripes (rectangle inside the bowl)
    const P = (u, w, y) => { const q = o.at(cu + u, cw + w); return [q[0], y, q[1]]; };
    const nst = hi ? 16 : 2;
    for (let i = 0; i < nst; i++) {
      const u0 = -pb.hu + (i * 2 * pb.hu) / nst; const u1 = -pb.hu + ((i + 1) * 2 * pb.hu) / nst;
      quadP(g, P(u0, pb.hw, 0.12), P(u1, pb.hw, 0.12), P(u1, -pb.hw, 0.12), P(u0, -pb.hw, 0.12), 'plain', i % 2 ? col('#4c8c3c') : col('#5a9b46'));
    }
    quadP(g, P(-pb.hu, pb.hw + 3.5, 0.1), P(pb.hu, pb.hw + 3.5, 0.1), P(pb.hu, -pb.hw - 3.5, 0.1), P(-pb.hu, -pb.hw - 3.5, 0.1), 'plain', col('#3f7a33')); // run-off grass under the stripes
    if (hi) { // floodlight bar along the roof opening (glows at night) + the steel roof ribs
      const glowS = { cell: 'glow', color: WHITE, bay: 8, floor: 8 };
      const ring = loop(huR, hwR, wallTop - 4.7);
      for (let i = 0; i < NS; i += 1) { const p = ring[i]; box(g, p[0], p[1] + 0.35, p[2], 2.6, 0.7, 1.4, o.ang, glowS, { cell: 'glow', color: WHITE }, false); }
      const ribs = 51; const R0b = loop(hu0 - 0.3, hw0 - 0.3, wallTop + 1.9); const R1c = loop(huR, hwR, wallTop - 4.2);
      for (let i = 0; i < NS; i += 1) beam(g, R0b[i], R1c[i], 0.5, 0.45, col('#e6e8e8'), 'plain');
      void ribs;
    }
  });

  /* ---- Pont Grande-Duchesse Charlotte ("Rout Bréck"): red steel box girder on two pairs of inclined V legs. LT-WORLD draws the deck slab; this is the superstructure. */
  def('rouge', 'Pont Grande-Duchesse Charlotte', { radius: 200, base: 'ground', showR: { high: 1700, medium: 1300, low: 900 }, hiR: { high: 700, medium: 480 } }, (g, hi, L) => {
    const P0 = L.axis[0]; const P1 = L.axis[1]; const len = L.len;
    const u = [(P1[0] - P0[0]) / len, (P1[1] - P0[1]) / len]; const v = [-u[1], u[0]];
    const deck = (s) => interp(L.prof, s / len, 1) - L.a0; const dtm = (s) => interp(L.prof, s / len, 2) - L.a0;
    // the real deck (LiDAR + orthophoto, as LT-WORLD meshes it) spans lat -23.2 .. +5.2 from the player's track (right positive): centre -9.0, half width 14.1
    const LAT_C = -9.0; const LAT_K = 14.1 / 12.4;
    const at = (s, lat, y) => { const l = LAT_C + lat * LAT_K; return [P0[0] + u[0] * s + v[0] * l, y, P0[1] + u[1] * s + v[1] * l]; };
    const piers = [len * 0.172, len * 0.828];
    const step = hi ? 5 : 10; const N = Math.round(len / step);
    const secs = [];
    for (let k = 0; k <= N; k++) {
      const s = (k / N) * len; const top = deck(s) - 0.5;
      const d = Math.min(...piers.map((p) => Math.abs(s - p)));
      const depth = 3.2 + 3.4 * Math.exp(-((d / 38) * (d / 38)));
      secs.push([at(s, -12.4, top - 0.7), at(s, -6.4, top), at(s, -3.5, top - depth), at(s, 3.5, top - depth), at(s, 6.4, top), at(s, 12.4, top - 0.7)]);
    }
    const nSeg = secs[0].length - 1;
    for (let k = 0; k < N; k++) for (let i = 0; i < nSeg; i++) quadP(g, secs[k][i], secs[k + 1][i], secs[k + 1][i + 1], secs[k][i + 1], 'plain', i === 2 ? RED_D : RED);
    // deck-edge fascia and railing (red)
    for (let k = 0; k < N; k++) [-1, 1].forEach((sg) => {
      const s0 = (k / N) * len; const s1 = ((k + 1) / N) * len;
      const a = at(s0, sg * 12.6, deck(s0) - 1.3); const b = at(s1, sg * 12.6, deck(s1) - 1.3); const c = at(s1, sg * 12.6, deck(s1) + 0.1); const d = at(s0, sg * 12.6, deck(s0) + 0.1);
      if (sg < 0) quadP(g, a, b, c, d, 'plain', RED); else quadP(g, b, a, d, c, 'plain', RED);
      const r0 = at(s0, sg * 12.6, deck(s0) + 1.25); const r1 = at(s1, sg * 12.6, deck(s1) + 1.25);
      beam(g, r0, r1, 0.12, 0.1, RED, 'plain');
      if (hi && k % 1 === 0) beam(g, at(s0, sg * 12.6, deck(s0) + 0.2), at(s0, sg * 12.6, deck(s0) + 1.25), 0.1, 0.1, RED, 'plain');
    });
    // V legs: two per pier, feet spread out along the valley slope (batter posts), joined at the girder
    piers.forEach((sp, pi) => {
      const out = pi === 0 ? -1 : 1; const sf = sp + out * 30;
      [-1, 1].forEach((sg) => {
        const top = at(sp, sg * 5.4, deck(sp) - 3.4); const foot = at(sf, sg * 1.9, dtm(sf) - 2.5);
        beam(g, foot, top, 3.2, 4.2, RED_D, 'plain', [0, 1, 0]);
      });
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const lA = mid(at(sf, -1.9, dtm(sf) - 2.5), at(sp, -5.4, deck(sp) - 3.4)); const lB = mid(at(sf, 1.9, dtm(sf) - 2.5), at(sp, 5.4, deck(sp) - 3.4));
      beam(g, lA, lB, 1.1, 1.3, RED, 'plain');
      const ft = at(sf, 0, dtm(sf) - 2.5);
      box(g, ft[0], ft[1] + 1.2, ft[2], 9, 4.4, 8, Math.atan2(u[1], u[0]), { cell: 'plain', color: col('#a9a69d'), bay: 6, floor: 6 }, RF('#9a978e', 'plain'), false);
    });
  });

  /* ---- axis-frame kit for structures along a bridge axis: s along the axis, lat to the right of travel, y up (group origin) */
  function axisKit(g, L) {
    const P0 = L.axis[0]; const P1 = L.axis[1]; const len = L.len;
    const ux = (P1[0] - P0[0]) / len; const uz = (P1[1] - P0[1]) / len; const vx = -uz; const vz = ux;
    const at = (s, lat, y) => [P0[0] + ux * s + vx * lat, y, P0[1] + uz * s + vz * lat];
    const nrmSide = (dir) => [vx * dir, 0, vz * dir];
    const tileUV = (cell) => RECTS[cell];
    /* vertical convex polygon in the (s, y) plane at lateral `lat`, facing dir (+1 right / -1 left), tiled tw x th (anchored at 0, y0) */
    function vpoly(pts, lat, dir, cell, color, tw, th, y0) {
      if (pts.length < 3) return;
      let smin = 1e9; let smax = -1e9; let ymin = 1e9; let ymax = -1e9;
      pts.forEach((p) => { smin = Math.min(smin, p[0]); smax = Math.max(smax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); });
      if (smax - smin < 0.004 || ymax - ymin < 0.004) return;
      const r = tileUV(cell); const n = nrmSide(dir);
      const kx0 = Math.floor(smin / tw); const ky0 = Math.floor((ymin - y0) / th);
      for (let kx = kx0; kx * tw < smax - 1e-6; kx++) for (let ky = ky0; y0 + ky * th < ymax - 1e-6; ky++) {
        let p = pts;
        p = clipPoly(p, 0, kx * tw, true); if (p.length < 3) continue;
        p = clipPoly(p, 0, (kx + 1) * tw, false); if (p.length < 3) continue;
        p = clipPoly(p, 1, y0 + ky * th, true); if (p.length < 3) continue;
        p = clipPoly(p, 1, y0 + (ky + 1) * th, false); if (p.length < 3) continue;
        const base = g.count;
        p.forEach((q) => {
          const w = at(q[0], lat, q[1]);
          g.vert(w[0], w[1], w[2], n[0], 0, n[2], lerp(r[0], r[2], (q[0] - kx * tw) / tw), lerp(r[1], r[3], (q[1] - (y0 + ky * th)) / th), color);
        });
        for (let i = 1; i < p.length - 1; i++) g.tri(base, base + i, base + i + 1);
      }
    }
    /* vertical quad strip between two (s, y) points pairs (trapezoid): s0 < s1, bottom y at both ends, top y at both ends */
    const vtrap = (s0, s1, b0, b1, t0, t1, lat, dir, cell, color, tw, th, y0) => vpoly([[s0, b0], [s1, b1], [s1, t1], [s0, t0]], lat, dir, cell, color, tw, th, y0);
    /* horizontal strip between s0..s1 (heights ya at s0, yb at s1), lat l0..l1; up = +1 faces up, -1 down; uv spans the cell once per `tw` m along s and `tl` m across */
    function hq(s0, s1, l0, l1, ya, yb, up, cell, color, tw, tl) {
      const r = tileUV(cell);
      const a = at(s0, l0, ya); const b = at(s1, l0, yb); const c = at(s1, l1, yb); const d = at(s0, l1, ya);
      let n = norm(cross(sub(b, a), sub(d, a))); if ((n[1] > 0) !== (up > 0)) n = [-n[0], -n[1], -n[2]];
      const f1 = Math.min(1, (s1 - s0) / (tw || 4)); const f2 = Math.min(1, Math.abs(l1 - l0) / (tl || tw || 4));
      const i0 = g.vert(a[0], a[1], a[2], n[0], n[1], n[2], r[0], r[1], color);
      const i1 = g.vert(b[0], b[1], b[2], n[0], n[1], n[2], lerp(r[0], r[2], f1), r[1], color);
      const i2 = g.vert(c[0], c[1], c[2], n[0], n[1], n[2], lerp(r[0], r[2], f1), lerp(r[1], r[3], f2), color);
      const i3 = g.vert(d[0], d[1], d[2], n[0], n[1], n[2], r[0], lerp(r[1], r[3], f2), color);
      g.quad(i0, i1, i2, i3);
    }
    /* box in the axis frame (constant y0..y1); faces: side +lat, side -lat, top, optional ends */
    function abox(s0, s1, l0, l1, y0, y1, cell, color, tw, th, o) {
      const oo = o || {};
      if (!oo.noL) vpoly([[s0, y0], [s1, y0], [s1, y1], [s0, y1]], l0, -1, cell, color, tw, th, 0);
      if (!oo.noR) vpoly([[s0, y0], [s1, y0], [s1, y1], [s0, y1]], l1, 1, cell, color, tw, th, 0);
      if (!oo.noTop) hq(s0, s1, l0, l1, y1, y1, 1, oo.topCell || cell, oo.topColor || color, tw, tw);
      if (oo.bottom) hq(s0, s1, l0, l1, y0, y0, -1, cell, oo.bottomColor || mul(color, 0.7), tw, tw);
      if (oo.ends) {
        [[s0, -1], [s1, 1]].forEach(([s, d]) => {
          const a = at(s, l0, y0); const b = at(s, l1, y0); const c = at(s, l1, y1); const e = at(s, l0, y1);
          const n = [ux * d, 0, uz * d]; const r = tileUV(cell);
          const i0 = g.vert(a[0], a[1], a[2], n[0], 0, n[2], r[0], r[1], color); const i1 = g.vert(b[0], b[1], b[2], n[0], 0, n[2], r[2], r[1], color);
          const i2 = g.vert(c[0], c[1], c[2], n[0], 0, n[2], r[2], r[3], color); const i3 = g.vert(e[0], e[1], e[2], n[0], 0, n[2], r[0], r[3], color);
          g.quad(i0, i1, i2, i3);
        });
      }
    }
    /* vertical wall across the bridge (a plane at constant s) between lat l0..l1 and heights y0..y1, facing dir (+1 along the axis / -1) */
    function xwall(s, l0, l1, y0, y1, dir, cell, color, tw, th) {
      if (y1 - y0 < 0.02 || l1 - l0 < 0.02) return;
      const r = tileUV(cell); const n = [ux * dir, 0, uz * dir];
      const a = at(s, l0, y0); const b = at(s, l1, y0); const c = at(s, l1, y1); const d = at(s, l0, y1);
      const f1 = Math.min(1, (l1 - l0) / tw); const f2 = Math.min(1, (y1 - y0) / th);
      const i0 = g.vert(a[0], a[1], a[2], n[0], 0, n[2], r[0], r[1], color); const i1 = g.vert(b[0], b[1], b[2], n[0], 0, n[2], lerp(r[0], r[2], f1), r[1], color);
      const i2 = g.vert(c[0], c[1], c[2], n[0], 0, n[2], lerp(r[0], r[2], f1), lerp(r[1], r[3], f2), color); const i3 = g.vert(d[0], d[1], d[2], n[0], 0, n[2], r[0], lerp(r[1], r[3], f2), color);
      g.quad(i0, i1, i2, i3);
    }
    /* thin bar between two axis-frame points (square section w), colour + cell */
    function bar(a, b, w, cell, color) { beam(g, at(a[0], a[1], a[2]), at(b[0], b[1], b[2]), w, w, color, cell || 'plain'); }
    return { at, vpoly, vtrap, hq, abox, xwall, bar, len, ux, uz, vx, vz };
  }

  /* ---- Pont Adolphe (Séjourné / Rodange, 1903): sandstone double arch, 84.6 m span, 153 m long; 4-arch arcades at both ends, open spandrel arches,
   * rusticated end towers, bracketed cornice + stone balustrade; deck 2 x tram + 2 southbound lanes + 2 pavements; white cycle/footbridge (2018) hung between the arch rings */
  def('adolphe', 'Pont Adolphe', { radius: 110, base: 'ground', showR: { high: 1400, medium: 1000, low: 750 }, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const K = axisKit(g, L);
    const { at, vpoly, vtrap, hq, abox, xwall } = K;
    const len = L.len;
    const D = (s) => interp(L.prof, clamp(s, 0, len) / len, 1) - L.a0;      // rail / deck level
    const G = (s) => interp(L.prof, clamp(s, 0, len) / len, 2) - L.a0;      // terrain under the axis
    const LF = -8.0; const RF = 11.5;                                       // the two stone faces = the deck edges LT-WORLD meshes (LiDAR: lat -8.0 .. +11.5)
    const TOPd = 2.3;                                                       // face top = deck - 2.3 (underside of the cornice)
    const TOP = (s) => D(s) - TOPd;
    const BOT = (s) => G(s) - 5;                                            // piers sink into the slope
    const SAND = [1, 0.95, 0.78]; const SAND_L = [1, 0.97, 0.86]; const SAND_D = [0.86, 0.76, 0.6]; const SOFFIT = [0.66, 0.6, 0.5];
    const cs = 78.5; const half = 44.5; const sA = cs - half; const sB = cs + half;   // main arch between the springing towers (34 .. 123)
    const yS = -31.5; const rise = 23.5;                                    // springing / rise relative to the deck level at mid span
    const D0 = D(cs);
    const yi = (s) => { const x = Math.min(1, Math.abs(s - cs) / half); return D0 + yS + rise * (1 - Math.pow(x, 2.2)); };
    const ringT = (s) => { const x = Math.min(1, Math.abs(s - cs) / half); return lerp(1.5, 2.6, x * x); };
    const ye = (s) => yi(s) + ringT(s);
    const rings = [[LF, -3.0], [6.5, RF]];                                  // the two arch rings (lateral extents); the cycle bridge hangs in the gap
    const STEP = 0.5;
    /* openings: through-arches. sill / spring / radius, lateral segments */
    const opens = [];
    const arcade = (s0, n, clear, pier) => { for (let i = 0; i < n; i++) { const a = s0 + i * (clear + pier); opens.push({ s0: a, s1: a + clear, c: a + clear / 2, r: clear / 2, spring: -7.6, sill: -15.2, segs: [[LF, RF]], arc: 'A' }); } };
    arcade(5, 4, 4.5, 2); arcade(128, 4, 4, 2);
    [40, 46.5, 53, 59.5, 97.5, 104, 110.5, 117].forEach((c) => {
      const sill = ye(c) + 0.7; const crown = -3.9; const r = 2.0; // heads level, sills ride on the ring
      if (crown - r - sill < 0.6 || crown - sill > 12.5) return;
      opens.push({ s0: c - 2, s1: c + 2, c, r, spring: crown - r, sill, segs: rings, arc: 'S' });
    });
    const headY = (o, s) => D(s) + o.spring + Math.sqrt(Math.max(0, o.r * o.r - (s - o.c) * (s - o.c)));
    const openAt = (s) => opens.find((o) => s > o.s0 + 1e-6 && s < o.s1 - 1e-6) || null;
    const faceLow = (s) => { const o = openAt(s); if (o) return headY(o, s); return (s < sA || s > sB) ? BOT(s) : ye(s); };
    // ---- the two faces: ashlar walls with the arch heads cut out
    const tw = 4.8; const th = 4.8;
    [[LF, -1], [RF, 1]].forEach(([lat, dir]) => {
      for (let s = 0; s < len - 1e-6; s += STEP) {
        const s1 = Math.min(len, s + STEP); const sm = (s + s1) / 2;
        const o = openAt(sm);
        const lo0 = o ? headY(o, Math.max(s, o.s0)) : faceLow(s + 1e-3); const lo1 = o ? headY(o, Math.min(s1, o.s1)) : faceLow(s1 - 1e-3);
        const tower = (s < 5 || (s >= 29 && s < sA) || (s >= sB && s < 128) || s >= 150);
        const col = tower ? SAND_D : SAND;
        vtrap(s, s1, lo0, lo1, TOP(s), TOP(s1), lat, dir, 'ashlar', col, tw, th, 0);
      }
    });
    // pilaster towers: rusticated blocks proud of the faces at both ends of both arcades (OSM outline ears)
    [[0, 5], [29, 34], [123, 128], [150, 155]].forEach(([a, b]) => {
      const top = (D(a) + D(b)) / 2 - TOPd - 0.4;
      [[LF, LF - 1.5, -1], [RF, RF + 1.5, 1]].forEach(([l0, l1, dir]) => {
        const y0 = Math.min(BOT(a), BOT(b));
        vpoly([[a, y0], [b, y0], [b, top], [a, top]], l1, dir, 'ashlar', SAND_D, 3.2, 1.6, 0);
        const sideN = (dir > 0);
        // flanks (end faces) of the block
        [a, b].forEach((s, k) => {
          const n = [K.ux * (k ? 1 : -1), 0, K.uz * (k ? 1 : -1)]; const A = at(s, l0, y0); const B = at(s, l1, y0); const C = at(s, l1, top); const Dd = at(s, l0, top); const r = RECTS.ashlar;
          const i0 = g.vert(A[0], A[1], A[2], n[0], 0, n[2], r[0], r[1], SAND_D); const i1 = g.vert(B[0], B[1], B[2], n[0], 0, n[2], r[2], r[1], SAND_D);
          const i2 = g.vert(C[0], C[1], C[2], n[0], 0, n[2], r[2], r[3], SAND_D); const i3 = g.vert(Dd[0], Dd[1], Dd[2], n[0], 0, n[2], r[0], r[3], SAND_D); g.quad(i0, i1, i2, i3);
        });
        hq(a, b, Math.min(l0, l1), Math.max(l0, l1), top, top, 1, 'ashlar', SAND_L, 3.2, 1.5);
        void sideN;
      });
    });
    // ---- main arch rings: lighter proud band on the faces, intrados soffit, flanks at the springings
    const nR = hi ? 44 : 22;
    for (let k = 0; k < nR; k++) {
      const a = sA + (k / nR) * (sB - sA); const b = sA + ((k + 1) / nR) * (sB - sA);
      [[LF, -1], [RF, 1]].forEach(([lat, dir]) => vtrap(a, b, yi(a), yi(b), ye(a), ye(b), lat + dir * 0.3, dir, 'ashlar', SAND_L, 4.8, 4.8, 0));
      rings.forEach(([l0, l1]) => hq(a, b, l0, l1, yi(a), yi(b), -1, 'ashlar', SOFFIT, 4.8, 5.2));
    }
    rings.forEach(([l0, l1]) => { [[sA, -1], [sB, 1]].forEach(([s, d]) => xwall(s, l0, l1, BOT(s), yi(s), d > 0 ? -1 : 1, 'ashlar', SAND_D, 5, 4.8)); });
    // ---- the openings: floors, flanks, vaults
    opens.forEach((o) => {
      const nA = hi ? 10 : 6;
      o.segs.forEach(([l0, l1]) => {
        const sillY = D(o.c) + o.sill;
        hq(o.s0, o.s1, l0, l1, sillY, sillY, 1, 'ashlar', SAND_D, 4.8, 4.8);                // floor
        if (o.arc === 'A') abox(o.s0, o.s1, l0, l1, sillY - 0.9, sillY, 'ashlar', SAND_D, 4.8, 4.8, { noL: true, noR: true, noTop: true, bottom: true });
        const sp = D(o.c) + o.spring;
        [[o.s0, 1], [o.s1, -1]].forEach(([s, d]) => xwall(s, l0, l1, o.arc === 'A' ? Math.min(BOT(s), sillY - 6) : sillY, sp, d, 'ashlar', SAND_D, 5, 4.8));   // pier flanks facing the opening
        for (let k = 0; k < nA; k++) { // barrel vault
          const a0 = o.c - o.r + (k / nA) * 2 * o.r; const a1 = o.c - o.r + ((k + 1) / nA) * 2 * o.r;
          hq(a0, a1, l0, l1, headY(o, a0 + 1e-4), headY(o, a1 - 1e-4), -1, 'ashlar', SOFFIT, 4.8, 5.2);
        }
      });
    });
    // ---- the deck: soffit slab between the rings; the road, pavements and tram bed on top are the world's (orthophoto deck), this slab only closes the gap under them
    hq(sA, sB, rings[0][1], rings[1][0], TOP(cs), TOP(cs), -1, 'ashlar', SOFFIT, 5, 5);
    for (let s = 0; s < len - 1e-6; s += hi ? 12 : 24) { const s1 = Math.min(len, s + (hi ? 12 : 24)); hq(s, s1, LF, RF, D(s) - 0.3, D(s1) - 0.3, 1, 'plain', [0.42, 0.42, 0.42], 6, 6); }
    // ---- cornice (stepped, bracketed) + balustrade with pilasters; both sides
    const cornStep = 6.2;
    const nC = Math.ceil(len / cornStep);
    for (let k = 0; k < nC; k++) {
      const a = (k / nC) * len; const b = ((k + 1) / nC) * len; const dm = D((a + b) / 2);
      [[LF, -1], [RF, 1]].forEach(([lat, dir]) => {
        const o1 = lat + dir * 0.45; const o2 = lat + dir * 0.95;
        abox(a, b, Math.min(lat, o1), Math.max(lat, o1), dm - 2.3, dm - 1.2, 'ashlar', SAND_L, 4.8, 4.8, { noTop: true });
        abox(a, b, Math.min(lat, o2), Math.max(lat, o2), dm - 1.2, dm - 0.08, 'ashlar', SAND_L, 4.8, 4.8, { noTop: true });
        if (hi) for (let m = 0; m < 3; m++) { // modillion brackets under the corona
          const sm = a + ((m + 0.5) / 3) * (b - a); abox(sm - 0.28, sm + 0.28, Math.min(lat, lat + dir * 0.7), Math.max(lat, lat + dir * 0.7), dm - 1.75, dm - 1.2, 'ashlar', SAND_D, 4.8, 4.8, { noTop: true });
        }
        // balustrade
        const bl0 = lat + dir * 0.05; const bl1 = lat + dir * 0.55;
        const lo = Math.min(bl0, bl1); const hiL = Math.max(bl0, bl1);
        abox(a, b, lo, hiL, dm - 0.08, dm + 0.4, 'ashlar', SAND_L, 4.8, 4.8, { noTop: false });                  // plinth
        if (hi) {
          const bi = lat + dir * 0.18; const bo = lat + dir * 0.42;
          const nB = Math.max(1, Math.round((b - a) / 1.55));
          for (let m = 0; m < nB; m++) {
            const x0 = a + (m / nB) * (b - a) + 0.35; const x1 = a + ((m + 1) / nB) * (b - a) - 0.35;
            [bi, bo].forEach((bl, qi) => { const dd = qi ? dir : -dir; vpoly([[x0, dm + 0.4], [x1, dm + 0.4], [x1, dm + 0.98], [x0, dm + 0.98]], bl, dd, 'balust', WHITE, 1.6, 0.6, dm + 0.4); });
          }
        } else abox(a, b, lat + dir * 0.18, lat + dir * 0.42, dm + 0.4, dm + 0.98, 'plain', SAND_L, 4.8, 4.8, { noTop: true });
        abox(a, b, lo - 0.05, hiL + 0.05, dm + 0.98, dm + 1.14, 'ashlar', SAND_L, 4.8, 4.8, {});                    // handrail
      });
    }
    for (let s = 0; s <= len + 0.01; s += 4.9) { // pilasters
      const dm = D(s); const sa = clamp(s - 0.32, 0, len); const sb = clamp(s + 0.32, 0, len);
      [[LF, -1], [RF, 1]].forEach(([lat, dir]) => {
        const l0 = Math.min(lat + dir * 0.0, lat + dir * 0.6); const l1 = Math.max(lat + dir * 0.0, lat + dir * 0.6);
        abox(sa, sb, l0 - 0.05, l1 + 0.05, dm + 0.4, dm + 1.28, 'ashlar', SAND_L, 4.8, 4.8, { ends: true });
        abox(sa - 0.05, sb + 0.05, l0 - 0.1, l1 + 0.1, dm + 1.28, dm + 1.4, 'ashlar', SAND_L, 4.8, 4.8, { ends: true });
      });
    }
    // ---- street lamps (dark steel masts with a curved arm over the road, one per 24 m on both pavements)
    if (hi) {
      const POLE = col('#33373c'); const LAMP = [1, 1, 1];
      for (let s = 10; s < len - 6; s += 24) {
        [[-7.6, 1], [11.1, -1]].forEach(([lat, toward], qi) => {
          const sp = s + (qi ? 12 : 0); if (sp > len - 4) return; const dm = D(sp) + 0.12;
          K.bar([sp, lat, dm], [sp, lat, dm + 8.4], 0.2, 'plain', POLE);
          K.bar([sp, lat, dm + 8.4], [sp, lat + toward * 1.5, dm + 9.0], 0.12, 'plain', POLE);
          K.bar([sp, lat + toward * 1.5, dm + 9.0], [sp, lat + toward * 2.8, dm + 8.85], 0.1, 'plain', POLE);
          const q = RECTS.glow; const c = at(sp, lat + toward * 3.0, dm + 8.75);
          box(g, c[0], c[1], c[2], 0.9, 0.18, 0.4, Math.atan2(K.uz, K.ux), { cell: 'glow', color: LAMP, bay: 1, floor: 1 }, { cell: 'glow', color: LAMP }, false);
          void q;
        });
      }
    }
    // ---- the white cycle / pedestrian bridge (2018) hung between the arch rings
    const PW = col('#f3f5f6'); const PG = col('#d9dee0');
    const pS0 = sA - 4; const pS1 = sB + 4; const nP = hi ? 14 : 8;
    const yP = (s) => D(s) - 5.3;
    for (let k = 0; k < nP; k++) {
      const a = pS0 + (k / nP) * (pS1 - pS0); const b = pS0 + ((k + 1) / nP) * (pS1 - pS0);
      hq(a, b, 0.9, 3.5, yP(a), yP(b), 1, 'plain', PG, 6, 6);
      hq(a, b, 0.9, 3.5, yP(a) - 0.4, yP(b) - 0.4, -1, 'plain', PW, 6, 6);
      [0.9, 3.5].forEach((lat) => {
        const dir = lat < 2 ? -1 : 1;
        vpoly([[a, yP(a) - 0.4], [b, yP(b) - 0.4], [b, yP(b) + 1.1], [a, yP(a) + 1.1]], lat, dir, 'plain', PW, 6, 6, 0);
        hq(a, b, lat - 0.06, lat + 0.06, yP(a) + 1.1, yP(b) + 1.1, 1, 'plain', PW, 6, 6);
      });
    }
    if (hi) for (let s = pS0 + 3; s < pS1; s += 6) {
      [0.9, 3.5].forEach((lat) => K.bar([s, lat, yP(s) + 1.1], [s, lat, TOP(s)], 0.1, 'plain', PG));
    }
  });

  /* ---- Grand Théâtre de Luxembourg (Alain Bourbonnais, 1964), Rond-point Robert Schuman.
   * Frame: origin on the middle of the long west front (it faces the plaza and the Glacis), d = depth into the building (towards ENE), a = along the front (north +).
   * Real features (Commons refs lm2/theatre_*): glazed foyer behind a row of slender white columns, a long precast frieze of diamond panels (tan / grey / white) with small
   * dark hexagonal windows over it, flat roof with a thin dark edge, slate-rubble end walls, a 13 m body, a 17 m auditorium block and the 27 m fly tower at the back. */
  def('theatre', 'Grand Théâtre de Luxembourg', { radius: 70, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const DD = [0.976, -0.219]; const AA = [-0.219, -0.976];
    const loc = (d, a) => [DD[0] * d + AA[0] * a, DD[1] * d + AA[1] * a];
    const rect = (d0, d1, a0, a1) => [loc(d0, a0), loc(d1, a0), loc(d1, a1), loc(d0, a1)];
    const Y_COL = 5.6; const Y_BODY = 13; const Y_FLY = 27.5; const Y_AUD = 17;
    const frieze = { cell: 'hexfrieze', color: WHITE, bay: 7.2, floor: 7.2, jitter: 0.02 };
    const glass = { cell: 'curtain', color: [0.58, 0.66, 0.66], bay: 4.6, floor: Y_COL, jitter: 0.02 };
    const concrete = { cell: 'plain', color: [0.9, 0.88, 0.83], bay: 9, floor: 9, jitter: 0.03 };
    const slate = { cell: 'schist', color: [0.95, 1, 1], bay: 6, floor: 6, jitter: 0.04 };
    const dark = { cell: 'plain', color: [0.24, 0.26, 0.29], bay: 8, floor: 8, jitter: 0 };
    const towerS = { cell: 'plain', color: [0.84, 0.83, 0.8], bay: 9, floor: 9, jitter: 0.03 };
    const roofC = { cell: 'roofGrey', color: [0.78, 0.78, 0.76] };
    const slabRing = (ring, y0, y1, styleFn, roof) => {
      const o = orient(ring, true); const c = centroid(o);
      for (let i = 0; i < o.length; i++) {
        const p = o[i]; const q = o[(i + 1) % o.length];
        const nx = (p[0] + q[0]) / 2 - c[0]; const nz = (p[1] + q[1]) / 2 - c[1];
        const d = nx * DD[0] + nz * DD[1]; const a = nx * AA[0] + nz * AA[1];
        const face = Math.abs(d) > Math.abs(a) ? (d < 0 ? 'W' : 'E') : (a > 0 ? 'N' : 'S');
        wall(g, p[0], p[1], q[0], q[1], y0, y1, styleFn(face, d, a), hi, false);
      }
      if (roof) flatPoly(g, o, null, y1, roof.cell, roof.color, false);
    };
    // ---- main body: 13 m, whole front block frieze-clad on the W face and the first 18 m of the N / S faces
    foundationRing(g, rect(0, 69.5, -36, 36), 3, S_PLAIN(col('#cfcdc6')));
    { // flat paved forecourt (parvis) at the foyer's floor level: grey stone slabs out to the plaza, the low round fountain basin with its jets
      const ap = rect(-34, 0, -26, 38);
      for (let a = -26; a < 38; a += 8) { const r = rect(-34, 0, a, Math.min(38, a + 8)); flatPoly(g, orient(r, true), null, 0.05, 'pave', [0.64, 0.65, 0.66], false); }
      const o = orient(ap, true); for (let i = 0; i < o.length; i++) { const p = o[i]; const q = o[(i + 1) % o.length]; wall(g, p[0], p[1], q[0], q[1], -0.8, 0.05, { cell: 'plain', color: [0.78, 0.77, 0.74], bay: 20, floor: 20, jitter: 0 }, false, false); }
      const fc = loc(-19, 0); const R = 7.5; const seg = hi ? 28 : 14;
      cylinder(g, fc[0], fc[1], 0.04, 0.45, R, R, seg, { cell: 'plain', color: [0.86, 0.85, 0.82], floor: 5, jitter: 0 }, { cell: 'plain', color: [0.62, 0.7, 0.74] }, false);
      cylinder(g, fc[0], fc[1], 0.44, 0.5, R - 0.5, R - 0.5, seg, { cell: 'plain', color: [0.5, 0.62, 0.68], floor: 5, jitter: 0 }, { cell: 'plain', color: [0.55, 0.68, 0.74] }, false);
      if (hi) [[2.2, 8, 1.3], [4.6, 12, 1.0], [6.6, 16, 0.7]].forEach(([rr, n, hh]) => { for (let k = 0; k < n; k++) { const an = (k / n) * Math.PI * 2; cone(g, fc[0] + Math.cos(an) * rr, fc[1] + Math.sin(an) * rr, 0.5, 0.045, hh, 4, 'plain', [0.95, 0.97, 1], 0.02); } });
      [[-1, 0], [1, 0], [0, 1]].forEach(([ox, oz]) => { const bx = fc[0] + ox * (R + 1.5); const bz = fc[1] + oz * (R + 1.5); box(g, bx, 0.3, bz, 2.4, 0.5, 0.9, 0, { cell: 'plain', color: [0.9, 0.9, 0.87], bay: 9, floor: 9, jitter: 0 }, { cell: 'plain', color: [0.92, 0.92, 0.9] }, false); });
    }
    const bodyAt = (d0, d1, a0, a1, y0, y1, fn, roof) => slabRing(rect(d0, d1, a0, a1), y0, y1, fn, roof);
    // glazed foyer storey, set back 3.2 m behind the colonnade
    bodyAt(3.2, 17, -36, 36, 0, Y_COL, (f) => (f === 'W' ? glass : f === 'E' ? concrete : slate), false);
    // the frieze volume sits on the columns and overhangs the glazing
    bodyAt(0, 17, -36, 36, Y_COL, Y_BODY - 0.9, (f) => (f === 'E' ? concrete : frieze), false);
    bodyAt(-0.5, 17.4, -36.5, 36.5, Y_BODY - 0.9, Y_BODY, () => dark, false);
    // main hall body behind the foyer
    bodyAt(17, 69.5, -36, 36, 0, Y_BODY - 0.9, (f, d, a) => (f === 'W' ? concrete : (f === 'N' || f === 'S') ? slate : concrete), false);
    bodyAt(16.6, 70, -36.4, 36.4, Y_BODY - 0.9, Y_BODY, () => dark, roofC);
    // flat roof of the foyer part
    flatPoly(g, orient(rect(-0.5, 17.4, -36.5, 36.5), true), null, Y_BODY, 'roofGrey', [0.74, 0.74, 0.72], false);
    // auditorium block + fly tower + rear service annex
    bodyAt(44, 68, -19, 4, Y_BODY, Y_AUD, () => concrete, roofC);
    bodyAt(46, 70, 9, 33, Y_BODY, Y_FLY, () => towerS, roofC);
    bodyAt(69.5, 87.2, 0.7, 30.5, 0, 4, () => concrete, roofC);
    // ---- the colonnade: slender white round columns (0.45 m) every 4.6 m, entrance bays doubled in the middle
    const white = { cell: 'plain', color: [0.97, 0.97, 0.95], floor: 8, jitter: 0 };
    for (let a = -34.5; a <= 34.6; a += 4.6) {
      const p = loc(0.6, a);
      cylinder(g, p[0], p[1], 0, Y_COL, 0.3, 0.28, hi ? 8 : 5, white, false, false);
    }
    // dark entrance doors with the green / red poster boxes between the columns (the middle three bays)
    for (let k = -1; k <= 1; k++) { const a = k * 4.6; const p = loc(3.3, a - 1.7); const q = loc(3.3, a + 1.7); wall(g, p[0], p[1], q[0], q[1], 0.2, 3.4, { cell: 'plain', color: [0.14, 0.2, 0.17], bay: 4, floor: 4, jitter: 0 }, hi, false); }
    // ---- the glass canopy over the side entrance (south end) with its slim steel posts and the row of tall white masts on the plaza
    {
      const cr = rect(-7, 3.2, -27, -14);
      flatPoly(g, orient(cr, true), null, 4.9, 'glassroof', [0.86, 0.95, 0.95], false);
      const o = orient(cr, true); for (let i = 0; i < o.length; i++) { const p = o[i]; const q = o[(i + 1) % o.length]; wall(g, p[0], p[1], q[0], q[1], 4.55, 4.9, white, false, false); }
      [[-6.4, -26.4], [-6.4, -14.8], [-6.4, -20.6]].forEach(([d, a]) => { const p = loc(d, a); cylinder(g, p[0], p[1], 0, 4.55, 0.1, 0.1, 6, white, false, false); });
    }
    if (hi) for (let a = -30; a <= -4; a += 5.2) { const p = loc(-9, a); cylinder(g, p[0], p[1], 0, 11.5 - Math.abs(a + 17) * 0.1, 0.09, 0.07, 5, white, false, false); }
  });

  /* ---- Schueberfouer on the Glacis (the big car park between Rue des Glacis / Boulevard de la Foire and the tram, Faïencerie .. Theater).
   * Refs lm2/fair_*: the big white wheel with a yellow rim and a green-white hub, a lit drop tower, a chain-swing tower, a looping coaster, white beer tents, rows of striped stalls.
   * Frame: u along the tram (NE), w towards Boulevard de la Foire (SE); anchor at u = 140, w = 62 from the tram's SW corner. The wheel and the swing crown spin (extra animated parts). */
  const FAIR_U = [0.743, -0.669]; const FAIR_W = [0.669, 0.743]; const FAIR_YAW = -0.7335;
  def('fair', 'Schueberfouer (Glacis)', { radius: 175, anchor: [49.6167784, 6.1237435], showR: { high: 1300, medium: 1000, low: 700 }, hiR: { high: 480, medium: 340, low: 0 } }, (g, hi, L) => {
    const fp = (u, w) => { const a = u - 140; const b = w - 62; return [FAIR_U[0] * a + FAIR_W[0] * b, FAIR_U[1] * a + FAIR_W[1] * b]; };
    const subRect = (cell, i, j0, n, sh) => { const r = RECTS[cell]; const du = (r[2] - r[0]) / n; const dv = (r[3] - r[1]) / n; const k = sh === undefined ? 0.12 : sh; const j = n - 1 - j0; return [r[0] + (i + k) * du, r[1] + (j + k) * dv, r[0] + (i + 1 - k) * du, r[1] + (j + 1 - k) * dv]; };
    const LIGHT = (k) => subRect('lights', k % 4, Math.floor(k / 4), 4, 0.3);
    const AWN = (v) => subRect('awning', v % 2, Math.floor(v / 2), 2, 0.02);
    const stripe = (v, k) => { const r = AWN(v); const w = (r[2] - r[0]) / 8; return [r[0] + (k % 8) * w + w * 0.15, r[1], r[0] + (k % 8) * w + w * 0.85, r[3]]; };
    const qr = (a, b, c, d, rect, color, nflip) => { // quad with explicit uv rect (a,b along u; a,d along v)
      let n = norm(cross(sub(b, a), sub(d, a))); if (nflip) n = [-n[0], -n[1], -n[2]];
      const i0 = g.vert(a[0], a[1], a[2], n[0], n[1], n[2], rect[0], rect[1], color); const i1 = g.vert(b[0], b[1], b[2], n[0], n[1], n[2], rect[2], rect[1], color);
      const i2 = g.vert(c[0], c[1], c[2], n[0], n[1], n[2], rect[2], rect[3], color); const i3 = g.vert(d[0], d[1], d[2], n[0], n[1], n[2], rect[0], rect[3], color);
      g.quad(i0, i1, i2, i3);
    };
    const gb = (G, cx, cy, cz, sx, sy, sz, yaw, rect, color, noBottom) => { // box of one uv rect, yawed about y; G = geometry sink
      const cs = Math.cos(yaw); const sn = Math.sin(yaw);
      const P = (x, y, z) => [cx + x * cs - z * sn, cy + y, cz + x * sn + z * cs];
      const hx = sx / 2; const hy = sy / 2; const hz = sz / 2;
      const f = (a, b, c, d) => { const n = norm(cross(sub(b, a), sub(d, a))); const i0 = G.vert(a[0], a[1], a[2], n[0], n[1], n[2], rect[0], rect[1], color); const i1 = G.vert(b[0], b[1], b[2], n[0], n[1], n[2], rect[2], rect[1], color); const i2 = G.vert(c[0], c[1], c[2], n[0], n[1], n[2], rect[2], rect[3], color); const i3 = G.vert(d[0], d[1], d[2], n[0], n[1], n[2], rect[0], rect[3], color); G.quad(i0, i1, i2, i3); };
      f(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)); f(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz));
      f(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)); f(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz));
      f(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz)); if (!noBottom) f(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz));
    };
    const PAINT = (hex) => ({ cell: 'plain', color: col(hex), bay: 99, floor: 99, jitter: 0 });
    const paintBox = (x, y0, z, sx, sy, sz, rot, hex, roofHex) => box(g, x, y0 + sy / 2, z, sx, sy, sz, rot, PAINT(hex), roofHex ? { cell: 'plain', color: col(roofHex) } : { cell: 'plain', color: col(hex) }, false);
    const bar = (a, b, w, hex) => beam(g, a, b, w, w, col(hex), 'plain');
    const bar2 = (G, a, b, w, c) => beam(G, a, b, w, w, c, 'plain');
    const zcyl = (G, cx, cy, cz, r, len, seg, color) => { // cylinder along z (rotation-invariant gondola pod)
      const rr = RECTS.plain; const u = (rr[0] + rr[2]) / 2; const v = (rr[1] + rr[3]) / 2;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2; const a1 = ((i + 1) / seg) * Math.PI * 2; const am = (a0 + a1) / 2; const n = [Math.cos(am), Math.sin(am), 0];
        const p = (a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + z];
        const i0 = G.vert(...p(a0, -len / 2), ...n, u, v, color); const i1 = G.vert(...p(a1, -len / 2), ...n, u, v, color); const i2 = G.vert(...p(a1, len / 2), ...n, u, v, color); const i3 = G.vert(...p(a0, len / 2), ...n, u, v, color);
        G.quad(i0, i1, i2, i3);
        [-1, 1].forEach((sd) => { const c0 = G.vert(cx, cy, cz + sd * len / 2, 0, 0, sd, u, v, color); const c1 = G.vert(...p(a0, sd * len / 2), 0, 0, sd, u, v, color); const c2 = G.vert(...p(a1, sd * len / 2), 0, 0, sd, u, v, color); G.tri(c0, c1, c2); });
      }
    };
    const PAL = ['#d83a3a', '#2f6fd0', '#f0b82a', '#2fa35a', '#e2662a', '#8a4fc0', '#e04a8a', '#2fb8c8'];
    const WH = '#f4f3ee';
    const rnd = mulberry(7101);
    const gyAt = (x, z) => (L.gy ? (L.gy(x, z) || 0) : 0);   // the Glacis falls ~7 m from the tram stop end to the Faïencerie end: everything follows the terrain
    const partRaw = L.part;
    L.part = (name, o) => partRaw(name, Object.assign({}, o, { pivot: [o.pivot[0], o.pivot[1] + gyAt(o.pivot[0], o.pivot[2]), o.pivot[2]] }));

    // ---- stalls: rows of booths with striped awnings and a warm light strip under the awning
    const stall = (u, w, face, k) => { // face = +1 opens towards +w, -1 towards -w
      const w1 = face > 0 ? 1 : -1; const c = fp(u, w); const bodyH = 2.5; const wd = 4.0; const dp = 3.2;
      const body = PAL[k % PAL.length];
      const pastel = mixc(col(body), WHITE, 0.45); const pHex = '#' + new T.Color(pastel[0], pastel[1], pastel[2]).getHexString();
      paintBox(c[0], 0, c[1], wd, bodyH, dp, FAIR_YAW, pHex, '#d8d6d0');
      // coloured front pillars + counter
      const fr = fp(u, w + w1 * (dp / 2));
      paintBox(fr[0], 0.0, fr[1], wd, 1.0, 0.25, FAIR_YAW, body);
      // awning: sloped striped quad from the roof edge forward and down
      const a0 = fp(u - wd / 2 - 0.1, w + w1 * (dp / 2 - 0.2)); const a1 = fp(u + wd / 2 + 0.1, w + w1 * (dp / 2 - 0.2));
      const b0 = fp(u - wd / 2 - 0.1, w + w1 * (dp / 2 + 1.6)); const b1 = fp(u + wd / 2 + 0.1, w + w1 * (dp / 2 + 1.6));
      const v = k % 4;
      qr([a0[0], bodyH + 0.5, a0[1]], [a1[0], bodyH + 0.5, a1[1]], [b1[0], bodyH - 0.35, b1[1]], [b0[0], bodyH - 0.35, b0[1]], AWN(v), WHITE, false);
      qr([b0[0], bodyH - 0.35, b0[1]], [b1[0], bodyH - 0.35, b1[1]], [b1[0], bodyH - 0.7, b1[1]], [b0[0], bodyH - 0.7, b0[1]], AWN(v), WHITE, false);
      if (hi) { const lp = fp(u, w + w1 * (dp / 2 + 1.2)); gb(g, lp[0], bodyH - 0.5, lp[1], 3.4, 0.1, 0.1, FAIR_YAW, LIGHT(12), WHITE, false); }
      else { const lp = fp(u, w + w1 * (dp / 2 + 1.2)); gb(g, lp[0], bodyH - 0.5, lp[1], 3.4, 0.2, 0.2, FAIR_YAW, LIGHT(12), WHITE, true); }
    };
    let sk = 0;
    const BLOCK = [[85, 116, 43, 65], [137, 163, 42, 66], [151, 185, 37, 55], [98, 126, 70, 86], [69, 91, 33, 47], [174, 190, 80, 96], [124, 152, 76, 104], [38, 124, 80, 98], [188, 256, 46, 74], [14, 28, 48, 76]];
    const blocked = (u, w) => BLOCK.some((r) => u > r[0] - 2.6 && u < r[1] + 2.6 && w > r[2] - 3 && w < r[3] + 3);
    const row = (w, face, u0, u1, idx) => { for (let u = u0; u <= u1; u += 4.6) { sk++; if (blocked(u, w)) continue; if (rnd() < 0.1) continue; if (!hi && (idx % 2) && sk % 2) continue; stall(u, w, face, sk); } };
    [[23, 1], [34, -1], [45, 1], [56, -1], [67, 1], [78, -1], [89, 1], [100, -1]].forEach(([w, f], i) => row(w, f, 30, 236, i));

    // ---- big white beer tents (gable roof, striped valance) as in the aerial photos
    const tent = (u, w, lu, lw, h, hr) => {
      const c = fp(u, w);
      paintBox(c[0], 0, c[1], lu, h, lw, FAIR_YAW, WH, WH);
      // gable roof along u
      const A = (du, dw, y) => { const p = fp(u + du, w + dw); return [p[0], y, p[1]]; };
      const hu = lu / 2; const hw = lw / 2;
      qr(A(-hu, -hw, h), A(hu, -hw, h), A(hu, 0, h + hr), A(-hu, 0, h + hr), RECTS.plain, [0.97, 0.97, 0.96], false);
      qr(A(hu, hw, h), A(-hu, hw, h), A(-hu, 0, h + hr), A(hu, 0, h + hr), RECTS.plain, [0.97, 0.97, 0.96], false);
      const sr = stripe(0, 0);
      [-1, 1].forEach((sgn) => qr(A(-hu, sgn * hw, h), A(hu, sgn * hw, h), A(hu, sgn * hw, h - 0.8), A(-hu, sgn * hw, h - 0.8), sr, WHITE, sgn < 0));
    };
    tent(168, 46, 32, 16, 4.5, 3.5);
    tent(112, 78, 26, 14, 4.2, 3.2);
    tent(80, 40, 20, 12, 4, 2.8);

    // ---- bumper-car hall (u 100, w 54): box with a shallow gabled roof, bright front with a light frieze
    {
      const c = fp(100, 54);
      paintBox(c[0], 0, c[1], 30, 6.2, 19, FAIR_YAW, '#3a58c8', '#9aa0a8');
      const F = fp(100, 54 - 9.6);
      paintBox(F[0], 0.0, F[1], 30.4, 8.2, 0.5, FAIR_YAW, '#f0c02a');
      for (let k = 0; k < 15; k++) { const q = fp(100 - 14 + k * 2, 54 - 10.1); gb(g, q[0], 7.4, q[1], 0.5, 0.5, 0.3, FAIR_YAW, LIGHT((k * 3 + 1) % 12), WHITE, true); }
      for (let k = 0; k < 15; k++) { const q = fp(100 - 14 + k * 2, 54 - 10.1); gb(g, q[0], 1.6, q[1], 0.4, 0.4, 0.3, FAIR_YAW, LIGHT((k * 5) % 12), WHITE, true); }
    }
    // ---- carousel tent: round platform, striped conical roof, centre pole, bulb ring
    {
      const c = fp(150, 54); const R = 9.5; const seg = hi ? 24 : 12;
      cylinder(g, c[0], c[1], 0, 0.5, R, R, seg, { cell: 'plain', color: col('#6d5a46') }, { cell: 'plain', color: col('#80664a') }, false);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2; const a1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [c[0] + Math.cos(a0) * (R + 0.6), 4.2, c[1] + Math.sin(a0) * (R + 0.6)]; const p1 = [c[0] + Math.cos(a1) * (R + 0.6), 4.2, c[1] + Math.sin(a1) * (R + 0.6)];
        const apex = [c[0], 10.4, c[1]];
        const n = norm(cross(sub(p1, p0), sub(apex, p0))); const fl = (n[0] * (p0[0] - c[0]) + n[2] * (p0[2] - c[1])) < 0; const nn = fl ? [-n[0], -n[1], -n[2]] : n;
        const rc = stripe(i % 2 ? 0 : 2, 3 + (i & 1)); const u0 = (rc[0] + rc[2]) / 2; const v0 = (rc[1] + rc[3]) / 2;
        const j0 = g.vert(p0[0], p0[1], p0[2], nn[0], nn[1], nn[2], u0, v0, WHITE); const j1 = g.vert(p1[0], p1[1], p1[2], nn[0], nn[1], nn[2], u0, v0, WHITE); const j2 = g.vert(apex[0], apex[1], apex[2], nn[0], nn[1], nn[2], u0, v0, WHITE);
        if (fl) g.tri(j1, j0, j2); else g.tri(j0, j1, j2);
        if (i % 2 === 0) gb(g, p0[0], 4.0, p0[2], 0.5, 0.5, 0.5, 0, LIGHT([2, 0, 6, 4, 9, 1][(i / 2) % 6]), WHITE, true);
        const wl = [c[0] + Math.cos(a0) * (R - 0.4), 0.5, c[1] + Math.sin(a0) * (R - 0.4)];
        if (i % 3 === 0) bar(wl, [wl[0], 4.2, wl[2]], 0.18, '#e9d27a');
      }
      cylinder(g, c[0], c[1], 0.5, 9, 0.25, 0.18, 6, { cell: 'plain', color: col('#e8e8e4') }, false, false);
      gb(g, c[0], 10.6, c[1], 0.6, 0.6, 0.6, 0, LIGHT(0), WHITE, true);
    }

    // ---- roller coaster (u 40..118, w 89): lift hill, drop, two vertical loops, camel humps; blue track, yellow supports
    {
      const path = []; const base = 89; const push = (u, y, dw) => path.push([u, base + (dw || 0), y]);
      for (let u = 42; u <= 56; u += 2) push(u, 1 + (u - 42) * 1.8);              // lift hill
      for (let u = 58; u <= 66; u += 2) push(u, Math.max(0.8, 26 - 0.34 * (u - 56) * (u - 56)));   // crest + drop
      for (let u = 68; u <= 74; u += 2) push(u, 0.8 + (u - 68) * 0.05);
      const loopAt = (u0, R, w0) => { for (let k = 0; k <= 28; k++) { const th = (k / 28) * Math.PI * 2; push(u0 + R * Math.sin(th) * 0.9 + (k / 28) * 4.5, 0.8 + R * (1 - Math.cos(th)), w0 + (k / 28) * 2.4 - 1.2); } };
      loopAt(76, 8.5, 0);
      for (let u = 82; u <= 94; u += 3) push(u, 0.8 + 3.2 * Math.sin((u - 82) * 0.26) * Math.sin((u - 82) * 0.26) + 1.2);
      loopAt(96, 7.0, 0);
      for (let u = 104; u <= 120; u += 2) push(u, 1.2 + 4 * Math.sin((u - 104) * 0.33) * Math.sin((u - 104) * 0.33));
      const pr = (p) => { const q = fp(p[0], p[1]); return [q[0], p[2], q[1]]; };
      const bluE = '#2e6bff'; const yel = '#f2c21a';
      for (let i = 0; i < path.length - 1; i++) {
        const a = pr(path[i]); const b = pr(path[i + 1]);
        bar(a, b, 0.7, bluE);
        const dwv = hi ? 1.1 : 0; if (hi) { bar([a[0] + FAIR_W[0] * dwv, a[1], a[2] + FAIR_W[1] * dwv], [b[0] + FAIR_W[0] * dwv, b[1], b[2] + FAIR_W[1] * dwv], 0.3, '#d8dce4'); bar([a[0] - FAIR_W[0] * dwv, a[1], a[2] - FAIR_W[1] * dwv], [b[0] - FAIR_W[0] * dwv, b[1], b[2] - FAIR_W[1] * dwv], 0.3, '#d8dce4'); }
        if (i % 4 === 0 && a[1] > 3) bar([a[0], 0, a[2]], [a[0], a[1] - 0.3, a[2]], 0.4, yel);
        if (i % 3 === 1) gb(g, a[0], a[1] + 0.5, a[2], 0.35, 0.35, 0.35, 0, LIGHT([1, 6, 9, 2, 5][i % 5]), WHITE, true);
      }
    }

    // ---- drop tower ("Power Tower"): triangular lattice mast with a lit gondola ring, LED bands
    {
      const c = fp(182, 88); const H = 62; const r = 1.5;
      const ang = [0, 2.0944, 4.1888].map((a) => a + 0.4);
      const col3 = ang.map((a) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      col3.forEach((p) => bar([p[0], 0, p[1]], [p[0], H, p[1]], 0.45, '#eceff3'));
      const rings = hi ? 12 : 6;
      for (let k = 1; k <= rings; k++) { const y = (k / rings) * H; for (let q = 0; q < 3; q++) { const p0 = col3[q]; const p1 = col3[(q + 1) % 3]; bar([p0[0], y, p0[1]], [p1[0], y, p1[1]], 0.18, '#d4d8de'); if (hi) bar([p0[0], y - H / rings, p0[1]], [p1[0], y, p1[1]], 0.12, '#d4d8de'); } }
      for (let k = 0; k < 20; k++) { const y = 2 + k * 3; col3.forEach((p, q) => gb(g, p[0] + Math.cos(ang[q]) * 0.3, y, p[1] + Math.sin(ang[q]) * 0.3, 0.3, 1.4, 0.3, 0, LIGHT((k * 3 + q * 5) % 12), WHITE, true)); }
      const ringY = 54; for (let q = 0; q < 12; q++) { const a = (q / 12) * Math.PI * 2; gb(g, c[0] + Math.cos(a) * 4.2, ringY, c[1] + Math.sin(a) * 4.2, 1.5, 1.2, 1.5, -a, LIGHT([0, 2, 6, 9][q % 4]), WHITE, true); }
      bar([c[0], H, c[1]], [c[0], H + 4, c[1]], 0.5, '#eceff3'); gb(g, c[0], H + 4.5, c[1], 0.8, 0.8, 0.8, 0, LIGHT(0), WHITE, true);
      paintBox(c[0], 0, c[1], 7.5, 1.2, 7.5, FAIR_YAW, '#2c3a60');
    }

    // ---- chain-swing tower ("Star Flyer", 70 m): white mast, spinning crown with chain seats
    {
      const c = fp(138, 90); const H = 52;
      cylinder(g, c[0], c[1], 0, H, 0.95, 0.55, 8, { cell: 'plain', color: col('#f4f3ee'), floor: 20 }, false, false);
      for (let k = 0; k < 10; k++) { const y = 2 + k * 5; gb(g, c[0], y, c[1], 1.2, 0.6, 1.2, 0, LIGHT((k * 7 + 3) % 12), WHITE, true); }
      paintBox(c[0], 0, c[1], 9, 0.8, 9, FAIR_YAW, '#2a8a4a');
      const part = L.part('swing', { pivot: [c[0], H, c[1]], axis: 'y', rate: 0.6 });
      const Rn = 9.2; const nA = 8;
      for (let q = 0; q < nA; q++) { const a = (q / nA) * Math.PI * 2; bar2(part.g, [0, 0, 0], [Math.cos(a) * Rn, 0.3, Math.sin(a) * Rn], 0.5, col('#f1f1ee')); }
      for (let q = 0; q < 24; q++) {
        const a = (q / 24) * Math.PI * 2; const sx = Math.cos(a) * (Rn + 1.8); const sz = Math.sin(a) * (Rn + 1.8);
        bar2(part.g, [Math.cos(a) * Rn, 0.2, Math.sin(a) * Rn], [sx, -6.5, sz], 0.07, col('#c8ccd2'));
        gb(part.g, sx, -6.9, sz, 0.8, 0.5, 0.8, -a, LIGHT([0, 1, 2, 4, 6, 9][q % 6]), WHITE, true);
      }
      gb(part.g, 0, 1.0, 0, 1.4, 1.0, 1.4, 0, LIGHT(11), WHITE, true);
    }

    // ---- the big wheel (u 222, w 60): 55 m, white spokes, yellow rim, green-white hub, round cabins (spins)
    {
      const c = fp(222, 60); const R = 27; const HUB = R + 5.6; const yaw = FAIR_YAW; // wheel plane along u
      // A-frame legs and the boarding platform (static)
      [-1, 1].forEach((zs) => [-1, 1].forEach((xs) => {
        const base = [c[0] + (Math.cos(yaw) * xs * 13 - Math.sin(yaw) * zs * 7.5), 0, c[1] + (Math.sin(yaw) * xs * 13 + Math.cos(yaw) * zs * 7.5)];
        const top = [c[0] + (-Math.sin(yaw) * zs * 2.4), HUB, c[1] + (Math.cos(yaw) * zs * 2.4)];
        bar(base, top, 0.9, '#f4f3ee');
      }));
      [-1, 1].forEach((zs) => { const a = [c[0] - Math.sin(yaw) * zs * 7.5 - Math.cos(yaw) * 13, 0.5, c[1] + Math.cos(yaw) * zs * 7.5 - Math.sin(yaw) * 13]; const b = [c[0] - Math.sin(yaw) * zs * 7.5 + Math.cos(yaw) * 13, 0.5, c[1] + Math.cos(yaw) * zs * 7.5 + Math.sin(yaw) * 13]; bar(a, b, 0.5, '#d4d8de'); });
      paintBox(c[0], 0, c[1], 10, 1.3, 8, FAIR_YAW, '#3d4048', '#575b64');
      const part = L.part('wheel', { pivot: [c[0], HUB, c[1]], axis: 'z', yaw, rate: 0.045 });
      const nS = hi ? 72 : 36; const zs = [-1.2, 1.2]; const P = (a, r, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
      zs.forEach((z) => {
        for (let i = 0; i < nS; i++) { const a0 = (i / nS) * Math.PI * 2; const a1 = ((i + 1) / nS) * Math.PI * 2; bar2(part.g, P(a0, R, z), P(a1, R, z), 0.5, col('#f2c230')); if (hi) bar2(part.g, P(a0, R - 2.6, z), P(a1, R - 2.6, z), 0.22, col('#f4f3ee')); }
        const nSp = hi ? 36 : 18;
        for (let i = 0; i < nSp; i++) { const a = (i / nSp) * Math.PI * 2; bar2(part.g, P(a, 2.6, z * 1.2), P(a, R, z), 0.2, col('#f7f7f4')); if (hi && i % 2 === 0) bar2(part.g, P(a, R - 2.6, z), P(a + 0.3, R, z), 0.1, col('#e8e8e4')); }
      });
      for (let i = 0; i < nS / 2; i++) { const a = (i / (nS / 2)) * Math.PI * 2; bar2(part.g, P(a, R, -1.2), P(a, R, 1.2), 0.3, col('#f2c230')); }
      // hub with green-white stripes
      for (let i = 0; i < 12; i++) { const a0 = (i / 12) * Math.PI * 2; const a1 = ((i + 1) / 12) * Math.PI * 2; const r = 2.8;
        const A0 = P(a0, r, -2.2); const B0 = P(a1, r, -2.2); const B1 = P(a1, r, 2.2); const A1 = P(a0, r, 2.2);
        qr(A0, B0, B1, A1, stripe(3, i % 2 ? 0 : 1), WHITE, false); }
      // cabins: round pods on the rim (rotation invariant), coloured, with lit windows
      const nC = hi ? 36 : 18;
      for (let i = 0; i < nC; i++) { const a = ((i + 0.5) / nC) * Math.PI * 2; const px = Math.cos(a) * (R + 1.1); const py = Math.sin(a) * (R + 1.1);
        zcyl(part.g, px, py, 0, 1.0, 2.2, 10, col(PAL[i % PAL.length]));
        gb(part.g, px, py, 0, 0.5, 0.5, 2.4, a, LIGHT(12), WHITE, true); }
      // bulbs along the rim
      for (let i = 0; i < nS; i += (hi ? 1 : 2)) { const a = (i / nS) * Math.PI * 2; [-1.5, 1.5].forEach((z) => gb(part.g, Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), z, 0.4, 0.4, 0.4, 0, LIGHT([2, 12, 6, 1, 9, 5][i % 6]), WHITE, true)); }
      gb(part.g, 0, 0, 2.5, 1.5, 1.5, 0.4, 0, LIGHT(0), WHITE, true); gb(part.g, 0, 0, -2.5, 1.5, 1.5, 0.4, 0, LIGHT(0), WHITE, true);
    }

    // ---- the "Schueberfouer" entrance gate on the alley mouth (SW end)
    {
      const A = fp(20, 52); const B = fp(20, 72); const h = 11;
      [A, B].forEach((p) => { bar([p[0], 0, p[1]], [p[0], h, p[1]], 0.6, '#d6dae0'); gb(g, p[0], h + 0.5, p[1], 0.9, 0.9, 0.9, 0, LIGHT(0), WHITE, true); });
      bar([A[0], h, A[1]], [B[0], h, B[1]], 0.5, '#d6dae0'); bar([A[0], h - 1.6, A[1]], [B[0], h - 1.6, B[1]], 0.3, '#d6dae0');
      const c0 = [A[0] * 0.5 + B[0] * 0.5, B[1] * 0.5 + A[1] * 0.5];
      const Lq = (dw, y, du) => { const p = fp(20 + (du || 0), 62 + dw); return [p[0], y, p[1]]; };
      const sg = RECTS.sign;
      qr(Lq(-9, h - 1.4, -0.12), Lq(9, h - 1.4, -0.12), Lq(9, h + 2.8, -0.12), Lq(-9, h + 2.8, -0.12), sg, WHITE, false);       // reads correctly from the SW (outside)
      qr(Lq(9, h - 1.4, 0.12), Lq(-9, h - 1.4, 0.12), Lq(-9, h + 2.8, 0.12), Lq(9, h + 2.8, 0.12), [sg[0], sg[1], sg[2], sg[3]], WHITE, false);   // the other face, from the field
      void c0;
      for (let k = 0; k < 10; k++) { const p = fp(20, 54 + k * 2); gb(g, p[0], h - 1.7, p[1], 0.35, 0.35, 0.35, 0, LIGHT([2, 6, 0, 9][k % 4]), WHITE, true); }
    }
    for (let i = 0; i < g.p.length; i += 3) g.p[i + 1] += gyAt(g.p[i], g.p[i + 2]);
  });

  // LOD2 holds a 20 m block on the Glacis (u 51..67, w 45..74 from the tram's SW corner; probably captured while the fair stood): the car park is open, so the model replaces it
  FP.fair = { a: [49.6167784, 6.1237435], p: [{ id: -2, role: 'lod2ghost', r: [[49, 43], [69, 43], [69, 75.5], [49, 75.5]].reduce((o, [u, w]) => { const a = u - 140; const b = w - 62; o.push(Math.round((FAIR_U[0] * a + FAIR_W[0] * b) * 10), Math.round((FAIR_U[1] * a + FAIR_W[1] * b) * 10)); return o; }, []), h: 20, hm: 20 }], ad: null, a0: 0 };

  /* ---- Pfaffenthal–Kirchberg funicular (two stations + twin track on a slender viaduct) */
  def('pfaff', 'Pfaffenthal funicular', { radius: 150, hiR: { high: 520, medium: 360 } }, (g, hi, L) => {
    const lower = L.one('lower'); const upper = L.one('upper');
    const glass = { cell: 'plain', color: col('#c9c7c0'), bay: 8, floor: 8, jitter: 0.03 }; // concrete portals
    [['lower', lower, 9], ['upper', upper, 8]].forEach(([role, p, h]) => { if (p) { prism(g, p.r, null, -5, h, glass, RF('#e0e2e2', 'plain'), hi); prism(g, scaleRing(p.r, 1.04), null, h, h + 0.6, { cell: 'plain', color: col('#eceeee'), bay: 8, floor: 8 }, RF('#e8eaea', 'plain'), false); } });
    if (!lower || !upper) return;
    const cL = centroid(lower.r); const cU = centroid(upper.r);
    const yL = L.gy(cL[0], cL[1]) + 3.2; const yU = L.gy(cU[0], cU[1]) + 3.0;
    const dx = cU[0] - cL[0]; const dz = cU[1] - cL[1]; const ln = Math.hypot(dx, dz); const ux = dx / ln; const uz = dz / ln; const nx = -uz; const nz = ux;
    const P = (s, lat, y) => [cL[0] + ux * s + nx * lat, y, cL[1] + uz * s + nz * lat];
    const Y = (s) => lerp(yL, yU, s / ln);
    const nseg = Math.max(2, Math.round(ln / (hi ? 6 : 14)));
    for (let k = 0; k < nseg; k++) {
      const s0 = (k / nseg) * ln; const s1 = ((k + 1) / nseg) * ln;
      quadP(g, P(s0, -5.2, Y(s0) - 0.9), P(s1, -5.2, Y(s1) - 0.9), P(s1, 5.2, Y(s1) - 0.9), P(s0, 5.2, Y(s0) - 0.9), 'plain', col('#b8b6af')); // underside
      quadP(g, P(s0, -5.2, Y(s0)), P(s1, -5.2, Y(s1)), P(s1, 5.2, Y(s1)), P(s0, 5.2, Y(s0)), 'pave', col('#bdb9b0')); // deck top
      quadP(g, P(s0, -5.2, Y(s0) - 0.9), P(s1, -5.2, Y(s1) - 0.9), P(s1, -5.2, Y(s1)), P(s0, -5.2, Y(s0)), 'plain', col('#cfcdc6'));
      quadP(g, P(s1, 5.2, Y(s1) - 0.9), P(s0, 5.2, Y(s0) - 0.9), P(s0, 5.2, Y(s0)), P(s1, 5.2, Y(s1)), 'plain', col('#cfcdc6'));
    }
    [-2.4, 2.4].forEach((lat) => { beam(g, P(0, lat, Y(0) + 0.2), P(ln, lat, Y(ln) + 0.2), 0.14, 0.2, col('#6b6f73'), 'plain'); }); // rails (centre of each track)
    // two glass cabins passing in the middle
    [[0.4, -2.4], [0.6, 2.4]].forEach(([f, lat]) => {
      const s = f * ln; const c = P(s, lat, Y(s) + 1.9);
      const rotY = Math.atan2(uz, ux);
      box(g, c[0], c[1], c[2], 8.2, 3.2, 3.6, rotY, { cell: 'plain', color: col('#b4343c'), bay: 8, floor: 8, jitter: 0.01 }, RF('#e5e7e8', 'plain'), hi); box(g, c[0], c[1] - 1.9, c[2], 8.2, 0.9, 3.4, rotY, { cell: 'plain', color: col('#8e9296') }, false, false);
    });
    for (let s = 14; s < ln - 6; s += 22) { // support columns down to the slope
      [-3.6, 3.6].forEach((lat) => { const t = P(s, lat, Y(s) - 0.9); const gy = L.gy(t[0], t[2]) - 1.5; if (t[1] - gy > 1.5) box(g, t[0], (t[1] + gy) / 2, t[2], 1.3, t[1] - gy, 1.3, 0, { cell: 'plain', color: col('#b3b1aa'), bay: 6, floor: 6 }, RF('#a8a69f', 'plain'), false); });
    }
  });

  /* ---- Pfaffenthal panoramic lift: glass shaft with a white steel frame and a glass footbridge at the top (Schindler / STDM, 2016) */
  def('lift', 'Pfaffenthal panoramic lift', { radius: 40, hiR: { high: 520, medium: 360 }, showR: { high: 1300, medium: 950, low: 700 } }, (g, hi, L) => {
    const H = 62; const w = 5.6;
    const shaft = { cell: 'plain', color: col('#e9ecee'), bay: 8, floor: 8, jitter: 0.01 };
    box(g, 0, H / 2 - 3, 0, w, H + 6, w, 0, shaft, RF('#e8eaea', 'plain'), hi);
    box(g, 0, H - 2, 0, w + 0.3, 3.2, w + 0.3, 0, { cell: 'curtain', color: [0.5, 0.65, 0.75], bay: 2.8, floor: 3.2 }, false, hi); // glass cabin stop at the top
    if (hi) for (let y = 4; y < H; y += 7.4) box(g, 0, y, 0, w + 0.2, 0.3, w + 0.2, 0, { cell: 'plain', color: col('#cfd3d6') }, RF('#cfd3d6', 'plain'), false);
    // long glazed footbridge, slightly rising away from the shaft towards the cliff (south-west), dark glass sides + white frame
    const dd = [-0.3, 0.954]; const bl = 30;
    beam(g, [dd[0] * (w / 2), H - 1.2, dd[1] * (w / 2)], [dd[0] * (w / 2 + bl), H - 6, dd[1] * (w / 2 + bl)], 3.6, 3.2, col('#59656d'), 'plain', [0, 1, 0]);
    beam(g, [dd[0] * (w / 2), H + 0.5, dd[1] * (w / 2)], [dd[0] * (w / 2 + bl), H - 4.3, dd[1] * (w / 2 + bl)], 3.9, 0.35, col('#eceeee'), 'plain', [0, 1, 0]);
    box(g, 0, H + 0.5, 0, w + 1.2, 1.0, w + 1.2, 0, { cell: 'plain', color: col('#eeeeec'), bay: 8, floor: 8 }, RF('#e2e4e4', 'plain'), false);
  });

  /* ================================================================== generic fallback for any landmark without its own model */
  Object.keys(FP).forEach((key) => {
    if (DEFS.some((d) => d.key === key)) return;
    def(key, key, { radius: 80 }, (g, hi, L) => {
      L.polys.forEach((p) => {
        const st = { cell: 'ribbon', color: col('#e4e2dc'), bay: 3.6, floor: 3.6 };
        lodOr(g, L, p.role, hi, { wall: st, roofFlat: { cell: 'roofGrey', color: C_ROOF }, roofSteep: { cell: 'slate', color: WHITE }, skirt: 6 }, () => {
          const h = p.hm || p.h || 12;
          prism(g, p.r, p.holes, -4, h, st, roofS(), hi);
        });
      });
    });
  });

  /* ================================================================== runtime */
  const DATA_URL = '/pb/train-sim/data/luxtram-landmarks.json?v=1';
  let lodState = 0; // 0 idle, 1 loading, 2 ready, 3 failed
  const lodWaiters = [];
  let lodPromise = null;
  function loadLod(url) {
    if (lodPromise) return lodPromise;
    lodState = 1;
    const done = (j) => { LOD = j; lodState = j ? 2 : 3; Object.keys(lodCache).forEach((k) => delete lodCache[k]); lodWaiters.splice(0).forEach((f) => f()); };
    lodPromise = new Promise((resolve) => {
      const finish = (j) => { done(j); if (!j) lodPromise = null; resolve(); };   // a failed load may be retried by the next build
      try {
        const net = (TS.net = TS.net || { bytes: 0 });   // shared download counter (the loading bar reads it)
        fetch(url || DATA_URL).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))).then((txt) => { net.bytes += txt.length; return JSON.parse(txt); }).then(finish)
          .catch((e) => { console.warn(TAG + 'detail data failed, using footprints only', e); finish(null); });
      } catch (e) { finish(null); }
    });
    return lodPromise;
  }
  function build(scene, ctx) {
    ctx = ctx || {};
    loadLod(ctx.dataUrl);
    const project = ctx.project || ((lat, lon) => { const p = defaultProject(lat, lon); const o = ctx.origin || { x: 0, z: 0 }; return { x: p.x - o.x, z: p.z - o.z }; });
    const groundY = ctx.groundAt || ctx.groundY || (() => 0);
    const railY = ctx.railY || groundY;
    replaces.forEach((r) => { // scene-coordinate boxes for consumers that work in scene metres: [x0, z0, x1, z1]
      const a = project(r.bbox[2], r.bbox[1]); const b = project(r.bbox[0], r.bbox[3]);
      r.box = [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
    });
    const quality = ctx.quality === 'low' || ctx.quality === 'medium' ? ctx.quality : 'high';
    const root = new T.Group();
    root.name = 'luxtram-landmarks';
    scene.add(root);
    const tex = makeAtlas();
    const mat = new T.MeshLambertMaterial({ vertexColors: true, map: tex.day, emissive: new T.Color('#ffffff'), emissiveMap: tex.lit, emissiveIntensity: 0, side: T.DoubleSide });
    const state = DEFS.map((d) => {
      const L = landmarkData(d.key);
      const a = d.anchor || L.anchor;
      const p = project(a[0], a[1]);
      return { d, L, x: p.x, z: p.z, y: 0, yDone: false, group: new T.Group(), lo: null, hi: null, shown: false };
    });
    state.forEach((s) => { s.group.visible = false; root.add(s.group); });
    let disposed = false;
    let nightK = 0;
    const camPos = new T.Vector3();

    function make(s, hi) {
      const g = new Geo();
      const parts = {};
      s.L.part = (name, o) => { if (!parts[name]) parts[name] = { g: new Geo(), o }; return parts[name]; };   // animated sub-meshes (wheel, swing crown): geometry built around o.pivot
      try { s.d.build(g, hi, s.L); } catch (e) { console.warn(TAG + s.d.key + (hi ? ' hi' : ' lo') + ' failed', e); }
      if (!g.count) return null;
      const mesh = new T.Mesh(g.toGeometry(), mat);
      Object.keys(parts).forEach((pn) => {
        const pt = parts[pn]; if (!pt.g.count) return;
        const pm = new T.Mesh(pt.g.toGeometry(), mat);
        pm.name = 'lm-' + s.d.key + '-' + pn; pm.position.set(pt.o.pivot[0], pt.o.pivot[1], pt.o.pivot[2]); pm.rotation.order = 'YXZ';
        pm.castShadow = quality === 'high'; pm.receiveShadow = false;
        pm.userData.spin = { axis: pt.o.axis, yaw: -(pt.o.yaw || 0), rate: pt.o.rate || 0.1, phase: pt.o.phase || 0 };
        mesh.add(pm);
      });
      mesh.name = 'lm-' + s.d.key + (hi ? '-hi' : '-lo');
      mesh.castShadow = quality === 'high';
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      s.group.add(mesh);
      return mesh;
    }
    function place(s) {
      if (s.yDone) return;
      let y = (groundY(s.x, s.z) || 0);
      if (s.d.base === 'rail' && ctx.railY) y = ctx.railY(s.x, s.z);
      else if (s.L.axis && s.L.ad !== null) y += s.L.a0 - s.L.ad; // bridges: the baked baseline is the deck, the anchor sits on the valley floor
      s.y = y;
      if (s.L.axis && s.L.prof && ctx.railY) { // bridges: lock the deck to the tram deck the world builds and the feet to its terrain
        const A = s.L.axis[0]; const B = s.L.axis[1]; const prof = s.L.prof.map((r) => r.slice());
        const at = (t) => [s.x + A[0] + (B[0] - A[0]) * t, s.z + A[1] + (B[1] - A[1]) * t];
        const mid = at(0.5); const n = prof.length - 1;
        const deckMid = lerp(prof[Math.floor(n / 2)][1], prof[Math.ceil(n / 2)][1], 0.5) - s.L.a0;
        const yBase = ctx.railY(mid[0], mid[1]) - deckMid;
        if (isFinite(yBase)) {
          s.y = yBase;
          prof.forEach((r) => { const q = at(r[0]); const ry = ctx.railY(q[0], q[1]); if (isFinite(ry)) r[1] = ry - yBase + s.L.a0; const gyq = groundY(q[0], q[1]); if (isFinite(gyq)) r[2] = gyq - yBase + s.L.a0; });
          s.L.prof = prof;
        }
      }
      s.group.position.set(s.x, s.y, s.z);
      s.L.gy = (lx, lz) => (groundY(s.x + lx, s.z + lz) || 0) - (groundY(s.x, s.z) || 0);
      s.yDone = true;
    }
    function drop(s, which) {
      const m = s[which];
      if (!m) return;
      s.group.remove(m); m.geometry.dispose(); m.children.forEach((c) => c.geometry && c.geometry.dispose()); s[which] = null;
    }
    function spinParts(m) { // the animated sub-meshes (Ferris wheel, chain swing) turn with the wall clock
      if (!m || !m.children.length) return;
      const t = performance.now() / 1000;
      m.children.forEach((c) => {
        const sp = c.userData.spin; if (!sp) return;
        const a = sp.phase + t * sp.rate;
        if (sp.axis === 'y') c.rotation.set(0, a, 0); else c.rotation.set(0, sp.yaw, a);
      });
    }
    function update(sTrack, camera) {
      if (disposed) return;
      const n = typeof ctx.night === 'function' ? ctx.night() : (ctx.nightK || 0);
      if (n !== nightK) { nightK = n; mat.emissiveIntensity = clamp(n, 0, 1) * 1.15; }
      if (camera && camera.getWorldPosition) camera.getWorldPosition(camPos); else if (camera && camera.position) camPos.copy(camera.position);
      let built = 0;
      if (lodState === 1) return; // wait for the detail data (a few hundred ms) so the first mesh is the detailed one
      for (let i = 0; i < state.length; i++) {
        const s = state[i]; const d = s.d;
        const dist = Math.hypot(camPos.x - s.x, camPos.z - s.z) - d.radius;
        const showR = d.showR[quality]; const hiR = d.hiR[quality];
        if (dist > showR) {
          s.group.visible = false;
          if (dist > showR * 1.5 + 200) { drop(s, 'lo'); drop(s, 'hi'); }
          continue;
        }
        if (!s.lo && built < 1) { place(s); s.lo = make(s, false); built++; }
        const wantHi = hiR > 0 && dist < hiR;
        if (wantHi && !s.hi && built < 1) { place(s); s.hi = make(s, true); built++; }
        if (s.hi && dist > hiR * 1.4) drop(s, 'hi');
        const useHi = !!s.hi && dist < hiR * 1.1;
        if (s.hi) s.hi.visible = useHi;
        if (s.lo) s.lo.visible = !useHi;
        s.group.visible = !!(s.lo || s.hi);
        if (s.group.visible) spinParts(s.hi && s.hi.visible ? s.hi : s.lo);
      }
    }
    function warmAll(hi, only) { state.forEach((s) => { if (only && s.d.key !== only) return; place(s); if (!s.lo) s.lo = make(s, false); if (hi && !s.hi) s.hi = make(s, true); s.group.visible = true; if (s.hi) { s.hi.visible = !!hi; if (s.lo) s.lo.visible = !hi; } }); }
    function stats() {
      let meshes = 0; let tris = 0; let visible = 0;
      root.traverse((o) => { if (o.isMesh) { meshes++; const gg = o.geometry; const t = (gg.index ? gg.index.count : gg.attributes.position.count) / 3; tris += t; if (o.visible && o.parent && o.parent.visible) visible++; } });
      return { meshes, drawCallsVisible: visible, triangles: Math.round(tris), landmarks: state.length };
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      state.forEach((s) => { drop(s, 'lo'); drop(s, 'hi'); });
      scene.remove(root);
      mat.dispose(); tex.day.dispose(); tex.lit.dispose(); atlas = null;
    }
    const whenReady = (f) => { if (lodState >= 2) f(); else lodWaiters.push(f); };
    lodWaiters.push(() => state.forEach((s) => { drop(s, 'lo'); drop(s, 'hi'); }));
    const api = { update, dispose, stats, warmAll, whenReady, root, state, material: mat };
    TS.luxLandmarks.active = api; // test hook: the running instance
    return api;
  }

  /* ------------------------------------------------------------------ what the models replace */
  const replaces = [];
  const footprints = [];
  (function () {
    DEFS.forEach((d) => {
      const L = landmarkData(d.key);
      const a = d.anchor || L.anchor;
      const ways = []; let la0 = 90; let lo0 = 190; let la1 = -90; let lo1 = -190;
      L.polys.forEach((p) => {
        if (d.replaceRoles && d.replaceRoles.indexOf(p.role) < 0) return;
        const ring = p.r.map((q) => [a[0] - q[1] / M_LAT, a[1] + q[0] / M_LON]);
        ways.push(p.id);
        footprints.push({ key: d.key, id: p.id, role: p.role, ring });
        ring.forEach((q) => { la0 = Math.min(la0, q[0]); la1 = Math.max(la1, q[0]); lo0 = Math.min(lo0, q[1]); lo1 = Math.max(lo1, q[1]); });
      });
      // the LOD2 ground outlines of the buildings the models are made from (LT-WORLD's own LOD2 buildings sit exactly on these)
      const fp = FP[d.key];
      ((fp && fp.lg) || []).forEach((flat) => {
        const r = decode(flat); if (r.length < 3) return;
        const ring = r.map((q) => [a[0] - q[1] / M_LAT, a[1] + q[0] / M_LON]);
        footprints.push({ key: d.key, id: 0, role: 'lod2', ring });
        ring.forEach((q) => { la0 = Math.min(la0, q[0]); la1 = Math.max(la1, q[0]); lo0 = Math.min(lo0, q[1]); lo1 = Math.max(lo1, q[1]); });
      });
      if (ways.length || (fp && fp.lg)) replaces.push({ key: d.key, name: d.name, ways, bbox: [la0, lo0, la1, lo1] });
    });
  })();
  function covers(lat, lon, bufferM) {
    const b = (bufferM === undefined ? 1.5 : bufferM);
    for (let i = 0; i < footprints.length; i++) {
      const ring = footprints[i].ring;
      let inside = false; let minD = 1e9;
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const yi = ring[k][0]; const xi = ring[k][1]; const yj = ring[j][0]; const xj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
        if (b > 0 && !inside) { // distance to the edge (metres)
          const ex = (xj - xi) * M_LON; const ey = (yj - yi) * M_LAT; const px = (lon - xi) * M_LON; const py = (lat - yi) * M_LAT;
          const t = clamp((px * ex + py * ey) / (ex * ex + ey * ey + 1e-9), 0, 1);
          minD = Math.min(minD, Math.hypot(px - ex * t, py - ey * t));
        }
      }
      if (inside || minD < b) return true;
    }
    return false;
  }

  TS.luxLandmarks = {
    version: 1,
    preload: (url) => loadLod(url),   // detail data, resolves when loaded (or failed): the loading bar waits for it
    build,
    replaces,
    footprints,
    covers,
    list: () => DEFS.map((d) => ({ key: d.key, name: d.name, anchor: (d.anchor || landmarkData(d.key).anchor), radius: d.radius, base: d.base })),
    defaultProject,
    credit: 'Landmark footprints © OpenStreetMap contributors; aerial photo reference © ACT Luxembourg (geoportail.lu)',
  };
})();
