/* Lokféierer: the real world around Luxtram T1 (TS.luxtramWorld).
 * Streams data/luxtram-world.json (OpenStreetMap, © OpenStreetMap contributors, ODbL) in 200 m chunks along the line:
 * ground, real building footprints extruded to their real heights with facades, roads + pavements, the tram bed
 * (grass track / concrete / paving), the opposite track, trees, water, traffic lights, lamps and the bridges
 * (Pont Rouge, Pont Adolphe, generic).  All geometry is merged per chunk and per material (about 12 draw calls a chunk).
 * Created by the TS.landscape.create wrapper in luxtram.js; sky, sun, weather and the far horizon stay procedural. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] luxtram world: ';
  const WORLD_URL = '/pb/train-sim/data/luxtram-world.json?v=1';

  const QUALITY = {
    high: { ahead: 1100, behind: 300, half: 150, castShadow: true, trees: 1, rowStep: 6, lamps: true, echo: 2, cars: 56 },
    medium: { ahead: 850, behind: 250, half: 120, castShadow: false, trees: 0.8, rowStep: 8, lamps: true, echo: 1, cars: 36 },
    low: { ahead: 600, behind: 200, half: 90, castShadow: false, trees: 0.45, rowStep: 12, lamps: false, echo: 0, cars: 14 },
  };
  const GROUND_LATS = [0, 3, 6, 9, 13, 18, 24, 31, 40, 52, 66, 82, 100, 120, 150];
  const FLOOR_H = 3.1;
  const BAY_W = 3.6;
  const MAX_BUILDS_PER_UPDATE = 1;

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

  /* ------------------------------------------------------------ data */
  let worldData = null;
  function loadWorld() {
    if (worldData) return worldData;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', WORLD_URL, false);
    xhr.send();
    if (xhr.status < 200 || xhr.status >= 300) throw new Error('world data HTTP ' + xhr.status);
    worldData = JSON.parse(xhr.responseText);
    return worldData;
  }
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
    t.wrapS = t.wrapT = T.RepeatWrapping;
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
  // facade: 4 bays x 4 floors, white wall so vertex colours tint it
  function facadeTextures(kind) {
    const glass = kind === 'glass';
    const bays = 4;
    const floors = 4;
    const W = 256;
    const H = 256;
    const day = canvasTex('lt-facade-' + kind, W, H, (g, w, h) => {
      g.fillStyle = glass ? '#aab7c0' : '#f4f2ec';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 2600, 0.045, 2, 3);
      const cw = w / bays;
      const ch = h / floors;
      const r = mulberry(glass ? 21 : 22);
      for (let fy = 0; fy < floors; fy++) {
        for (let bx = 0; bx < bays; bx++) {
          const x = bx * cw;
          const y = fy * ch;
          if (glass) {
            const grd = g.createLinearGradient(x, y, x + cw, y + ch);
            grd.addColorStop(0, '#5f7f95'); grd.addColorStop(0.5, '#33505f'); grd.addColorStop(1, '#486a7d');
            g.fillStyle = grd; g.fillRect(x + 1, y + 6, cw - 2, ch * 0.72);
            g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x + 1, y + 6, cw - 2, 3);
            g.fillStyle = '#c4ccd1'; g.fillRect(x, y + ch * 0.74, cw, ch * 0.26); // spandrel band
            g.fillStyle = '#8d979d'; g.fillRect(x, y + ch - 3, cw, 3);
          } else {
            const ww = cw * 0.46;
            const wh = ch * 0.56;
            const wx = x + (cw - ww) / 2;
            const wy = y + ch * 0.2;
            g.fillStyle = '#e4dfd2'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
            const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
            grd.addColorStop(0, '#6f8798'); grd.addColorStop(0.5, '#2f4352'); grd.addColorStop(1, '#1d2a35');
            g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
            g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(wx, wy + wh * 0.55); g.lineTo(wx + ww * 0.6, wy); g.lineTo(wx + ww, wy); g.lineTo(wx, wy + wh * 0.95); g.fill();
            g.fillStyle = '#ece8dd'; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.45, ww, 3);
            g.fillStyle = '#c2bdb0'; g.fillRect(wx - 7, wy + wh + 4, ww + 14, 5);
            if (r() < 0.22) { g.fillStyle = 'rgba(244,238,222,0.55)'; g.fillRect(wx, wy, ww, wh * 0.5); }
          }
        }
      }
    });
    const lit = canvasTex('lt-facade-lit-' + kind, W, H, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const cw = w / bays;
      const ch = h / floors;
      const r = mulberry(glass ? 31 : 32);
      for (let fy = 0; fy < floors; fy++) {
        for (let bx = 0; bx < bays; bx++) {
          if (r() > 0.42) continue;
          const x = bx * cw;
          const y = fy * ch;
          g.fillStyle = r() > 0.5 ? '#ffd58a' : '#fff0c8';
          if (glass) g.fillRect(x + 2, y + 8, cw - 4, ch * 0.68);
          else g.fillRect(x + cw * 0.27, y + ch * 0.2, cw * 0.46, ch * 0.56);
        }
      }
    });
    return { day, lit };
  }
  const texRoof = () => canvasTex('lt-roof', 128, 128, (g, w, h) => {
    g.fillStyle = '#9a9a96'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4000, 0.08, 2, 5);
    const r = mulberry(8);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : 8; x < w; x += 16) {
      const v = 120 + r() * 40; g.fillStyle = 'rgba(' + (v | 0) + ',' + ((v + 3) | 0) + ',' + ((v + 8) | 0) + ',0.22)'; g.fillRect(x + 1, y + 1, 14, 14);
    }
  });
  const texGround = () => canvasTex('lt-ground', 128, 128, (g, w, h) => {
    g.fillStyle = '#e8e8e4'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5200, 0.1, 1.6, 9);
    const r = mulberry(12);
    for (let i = 0; i < 1400; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.1 + r() * 0.2).toFixed(2) + ')'; g.fillRect(r() * w, r() * h, 1, 2 + r() * 3); }
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

  /* ------------------------------------------------------------ main factory */
  function create(scene, track, options, landscape) {
    const quality = options && QUALITY[options.quality] ? options.quality : 'medium';
    const Q = QUALITY[quality];
    const data = loadWorld();
    const lt = track.luxtram;
    const ox = lt.origin.x;
    const oz = lt.origin.z;
    const L = track.length;
    const root = new T.Group();
    root.name = 'luxtram-world';
    scene.add(root);
    const chunks = new Map();
    const roadsByChunk = new Map();
    let disposed = false;
    let nightK = 0;
    const firstCi = Math.max(0, Math.floor(lt.origFromAbs(lt.sStart) / data.chunk) - 1);
    const lastCi = Math.floor(lt.origFromAbs(lt.sEnd) / data.chunk) + 1;

    /* ---- shared materials */
    const fac = facadeTextures('plaster');
    const facGlass = facadeTextures('glass');
    const matWall = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: fac.day, emissive: new T.Color('#ffffff'), emissiveMap: fac.lit, emissiveIntensity: 0 });
    const matGlass = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: facGlass.day, emissive: new T.Color('#ffffff'), emissiveMap: facGlass.lit, emissiveIntensity: 0 });
    const matRoof = new T.MeshLambertMaterial({ vertexColors: true, map: texRoof(), side: T.DoubleSide });
    const matGround = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texGround(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const matRoad = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texRoad(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const matPave = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texPave(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const matBed = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, map: texBed(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const matMisc = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    const matSteel = new T.MeshStandardMaterial({ side: T.DoubleSide, vertexColors: true, roughness: 0.45, metalness: 0.7 });
    const matLeaf = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true });
    const matWater = new T.MeshPhongMaterial({ color: '#2d5b63', specular: '#ffffff', shininess: 80, transparent: true, opacity: 0.88, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mats = [matWall, matGlass, matRoof, matGround, matRoad, matPave, matBed, matMisc, matSteel, matLeaf, matWater];
    const treeTpl = [treeTemplate(0), treeTemplate(1)];

    /* ---- coordinates */
    const gy = (x, z) => track.terrainHeightAt(x, z);
    const toScene = (p) => [p[0] - ox, p[1] - oz];
    const sceneRing = (flat) => decodeFlat(flat).map(toScene);
    const frame = (s) => track.frameAt(s);
    const nearest = (x, z) => track.nearest(x, z);

    /* ---- landcover classification for the ground colours */
    const GRASS = C('#719548'); const PAVE = C('#9a978d'); const PARK = C('#65903f'); const FOREST = C('#4c7a38'); const SCRUB = C('#7b8a45');
    const PITCH = C('#5f9a4c'); const CEMETERY = C('#7d9a64'); const DIRT = C('#8c7c62'); const FARM = C('#a5a35e'); const GRAVEL = C('#8d8a82'); const ROCK = C('#837d72');
    const LAND_COL = [PARK, FOREST, SCRUB, C('#5b7f7e'), PITCH, CEMETERY, DIRT, FARM, GRAVEL, ROCK];
    const aabb = (ring) => { let x0 = 1e9; let x1 = -1e9; let z0 = 1e9; let z1 = -1e9; ring.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }); return [x0, z0, x1, z1]; };
    const inRing = (x, z, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0]; const zi = ring[i][1]; const xj = ring[j][0]; const zj = ring[j][1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
      }
      return inside;
    };
    const preCache = new Map(); // decoded polygons per data chunk, shared with neighbours
    function chunkLand(ci) {
      let e = preCache.get(ci);
      if (e) return e;
      const d = data.chunks[String(ci)];
      e = { land: [], bld: [] };
      if (d) {
        d.l.forEach((l) => { const ring = sceneRing(l[1]); e.land.push({ code: l[0], ring, box: aabb(ring) }); });
        d.b.forEach((b) => { const ring = sceneRing(b[5]); const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]); e.bld.push({ c, box: aabb(ring) }); });
      }
      preCache.set(ci, e);
      return e;
    }
    function classify(x, z, ci, out) {
      let urban = 0;
      for (let k = -1; k <= 1; k++) {
        chunkLand(ci + k).bld.forEach((b) => { const dx = b.c[0] - x; const dz = b.c[1] - z; if (dx * dx + dz * dz < 900) urban += 1; });
      }
      let col = mix3(GRASS, PAVE, clamp(urban / 4, 0, 1) * 0.92);
      let best = -1;
      for (let k = -1; k <= 1 && best < 0; k++) {
        const polys = chunkLand(ci + k).land;
        for (let i = 0; i < polys.length; i++) {
          const p = polys[i];
          if (x < p.box[0] || x > p.box[2] || z < p.box[1] || z > p.box[3]) continue;
          if (inRing(x, z, p.ring)) { best = p.code; if (p.code === 3) break; }
        }
      }
      if (best >= 0) col = LAND_COL[best];
      out[0] = col[0]; out[1] = col[1]; out[2] = col[2];
      return out;
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

    /* ---- chunk builders */
    function buildGround(ci, sa, sb) {
      const m = new Mesher();
      const half = Q.half + 6;
      const lats = GROUND_LATS.filter((l) => l < half - 1);
      lats.push(half);
      const LAT = lats.slice(1).reverse().map((l) => -l).concat(lats);
      const nRows = Math.max(2, Math.round((sb - sa) / Q.rowStep));
      const nl = LAT.length;
      const tmp = [0, 0, 0];
      for (let r = 0; r <= nRows; r++) {
        const s = lerp(sa, sb, r / nRows);
        const f = frame(s);
        for (let k = 0; k < nl; k++) {
          const x = f.pos.x + f.right.x * LAT[k];
          const z = f.pos.z + f.right.z * LAT[k];
          const y = gy(x, z) + 0.05;
          classify(x, z, ci, tmp);
          const nz2 = vnoise((x + ox) * 0.05, (z + oz) * 0.05) * 0.16 + 0.92;
          m.vert(x, y, z, 0, 1, 0, x / 6, z / 6, [tmp[0] * nz2, tmp[1] * nz2, tmp[2] * nz2]);
        }
      }
      for (let r = 0; r < nRows; r++) {
        for (let k = 0; k < nl - 1; k++) {
          const a = r * nl + k;
          m.quad(a, a + 1, a + nl + 1, a + nl);
        }
      }
      // smooth normals from heights
      const p = m.p;
      for (let r = 0; r <= nRows; r++) {
        for (let k = 0; k < nl; k++) {
          const i = r * nl + k;
          const ia = Math.max(0, r - 1) * nl + k; const ib = Math.min(nRows, r + 1) * nl + k;
          const ic = r * nl + Math.max(0, k - 1); const id = r * nl + Math.min(nl - 1, k + 1);
          const ux = p[ib * 3] - p[ia * 3]; const uy = p[ib * 3 + 1] - p[ia * 3 + 1]; const uz = p[ib * 3 + 2] - p[ia * 3 + 2];
          const vx = p[id * 3] - p[ic * 3]; const vy = p[id * 3 + 1] - p[ic * 3 + 1]; const vz = p[id * 3 + 2] - p[ic * 3 + 2];
          let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const nlen = Math.hypot(nx, ny, nz) || 1;
          m.n[i * 3] = nx / nlen; m.n[i * 3 + 1] = ny / nlen; m.n[i * 3 + 2] = nz / nlen;
        }
      }
      // skirts on both edges
      [0, nl - 1].forEach((k) => {
        const sb0 = m.count;
        for (let r = 0; r <= nRows; r++) {
          const i = r * nl + k;
          m.vert(p[i * 3], p[i * 3 + 1] - 8, p[i * 3 + 2], 0, 1, 0, m.u[i * 2], m.u[i * 2 + 1], [m.c[i * 3], m.c[i * 3 + 1], m.c[i * 3 + 2]]);
        }
        for (let r = 0; r < nRows; r++) { const t0 = r * nl + k; const t1 = (r + 1) * nl + k; m.quad(t0, sb0 + r, sb0 + r + 1, t1); }
      });
      return m;
    }

    /* roof helpers */
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

    const PAL = {
      0: ['#e9e1d0', '#e2d5bb', '#d8c9b1', '#e6d2c0', '#d9d4c8', '#f0e9da', '#cfc4b0', '#dfd0a8'],
      1: ['#c9ced1', '#b9c2c8', '#d5d8d8', '#aab4ba', '#c6c0b4'],
      2: ['#d9ccb2', '#cfc3a8', '#d8d2c4', '#c7bba3'],
      3: ['#a9a69e', '#bdb9ad', '#9e9b94'],
      4: ['#d0c4a6', '#c8bb9c'],
      5: ['#d8d4c8', '#c5c9cc', '#e0d8c2'],
      6: ['#d8cfbc', '#cfc5b0'],
      7: ['#c9c5bb', '#b8b6b0'],
    };
    const ROOF_COL = ['#5b6168', '#6a5a52', '#4c525a', '#7a6a60', '#686e74'].map(C);
    const FLAT_ROOF = C('#8d8f8e');


    /* ---- landmarks ---- */
    function triFan(m, pts, y, col) {
      const contour = pts.map((p) => new T.Vector2(p[0], p[1]));
      let tris = null;
      try { tris = T.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = null; }
      if (!tris) return;
      const base = m.count;
      pts.forEach((p) => m.vert(p[0], y, p[1], 0, 1, 0, p[0] / 3, p[1] / 3, col));
      tris.forEach((t) => m.tri(base + t[0], base + t[2], base + t[1]));
    }
    function quadStrip(m, a, b, c, d, col, nrm) {
      const n = nrm || (() => {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const x = e1[1] * e2[2] - e1[2] * e2[1]; const y = e1[2] * e2[0] - e1[0] * e2[2]; const z = e1[0] * e2[1] - e1[1] * e2[0];
        const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
      })();
      const i0 = m.vert(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0, col);
      const i1 = m.vert(b[0], b[1], b[2], n[0], n[1], n[2], 1, 0, col);
      const i2 = m.vert(c[0], c[1], c[2], n[0], n[1], n[2], 1, 1, col);
      const i3 = m.vert(d[0], d[1], d[2], n[0], n[1], n[2], 0, 1, col);
      m.quad(i0, i1, i2, i3);
    }
    function addBigLandmark(batch, name, ring, H) {
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      let gMin = 1e9; let gSum = 0;
      ring.forEach((p) => { const g = gy(p[0], p[1]); gMin = Math.min(gMin, g); gSum += g; });
      const gAvg = gSum / ring.length;
      const yb = gMin - 0.6;
      if (name === 'philharmonie') {
        const top = gAvg + H;
        const inner = ring.map((p) => [c[0] + (p[0] - c[0]) * 0.9, c[1] + (p[1] - c[1]) * 0.9]);
        const glaze = [0.5, 0.58, 0.64];
        for (let i = 0; i < inner.length; i++) {
          const p = inner[i]; const q = inner[(i + 1) % inner.length];
          quadStrip(batch.misc, [p[0], yb, p[1]], [q[0], yb, q[1]], [q[0], top, q[1]], [p[0], top, p[1]], glaze);
        }
        ring.forEach((p) => addBox(batch.misc, p[0], (yb + top) / 2 + 0.6, p[1], 0.7, top - yb + 1.2, 0.7, 0, [0.93, 0.92, 0.88]));
        triFan(batch.roof, ring.map((p) => [c[0] + (p[0] - c[0]) * 0.97, c[1] + (p[1] - c[1]) * 0.97]), top + 1.3, [0.88, 0.88, 0.86]);
        return true;
      }
      // Stade de Luxembourg: oval stands with a canopy
      const top = gAvg + H;
      const ringCw = ring;
      for (let i = 0; i < ringCw.length; i++) {
        const p = ringCw[i]; const q = ringCw[(i + 1) % ringCw.length];
        const pi = [c[0] + (p[0] - c[0]) * 0.58, c[1] + (p[1] - c[1]) * 0.58];
        const qi = [c[0] + (q[0] - c[0]) * 0.58, c[1] + (q[1] - c[1]) * 0.58];
        const pr = [c[0] + (p[0] - c[0]) * 0.74, c[1] + (p[1] - c[1]) * 0.74];
        const qr = [c[0] + (q[0] - c[0]) * 0.74, c[1] + (q[1] - c[1]) * 0.74];
        quadStrip(batch.misc, [p[0], yb, p[1]], [q[0], yb, q[1]], [q[0], top - 1, q[1]], [p[0], top - 1, p[1]], [0.86, 0.86, 0.84]);     // outer wall
        quadStrip(batch.misc, [p[0], top - 1, p[1]], [q[0], top - 1, q[1]], [qr[0], top - 1.4, qr[1]], [pr[0], top - 1.4, pr[1]], [0.95, 0.95, 0.94]); // canopy
        quadStrip(batch.misc, [pr[0], top - 1.4, pr[1]], [qr[0], top - 1.4, qr[1]], [qi[0], gAvg + 1.5, qi[1]], [pi[0], gAvg + 1.5, pi[1]], [0.2, 0.36, 0.62]); // stand slope (seats)
        quadStrip(batch.misc, [pi[0], gAvg + 1.5, pi[1]], [qi[0], gAvg + 1.5, qi[1]], [qi[0], gAvg - 0.4, qi[1]], [pi[0], gAvg - 0.4, pi[1]], [0.6, 0.6, 0.58]);
        if (i % 3 === 0) addBox(batch.misc, p[0], (yb + top) / 2, p[1], 0.9, top - yb, 0.9, 0, [0.7, 0.7, 0.68]);
      }
      triFan(batch.misc, ring.map((p) => [c[0] + (p[0] - c[0]) * 0.56, c[1] + (p[1] - c[1]) * 0.56]), gAvg + 0.05, [0.36, 0.62, 0.3]);
      return true;
    }
    function addGareTower(batch, ring, area, gAvg) {
      if (Math.abs(area) < 700) return;
      let best = null;
      ring.forEach((p) => { const q = nearest(p[0], p[1]); if (!best || q.d < best.d) best = { p, d: q.d }; });
      if (!best) return;
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      const dx = c[0] - best.p[0]; const dz = c[1] - best.p[1]; const dl = Math.hypot(dx, dz) || 1;
      const tx = best.p[0] + (dx / dl) * 5; const tz = best.p[1] + (dz / dl) * 5;
      const g = gy(tx, tz);
      const sand = [0.8, 0.72, 0.58];
      addBox(batch.misc, tx, g + 21, tz, 7, 42, 7, 0, sand);
      addBox(batch.misc, tx, g + 43, tz, 7.8, 1.2, 7.8, 0, [0.7, 0.62, 0.5]);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => {
        addBox(batch.glowLamp, tx + d[0] * 3.55, g + 37, tz + d[1] * 3.55, d[0] ? 0.12 : 3.4, 3.4, d[1] ? 0.12 : 3.4, 0, [0.96, 0.95, 0.88]);
      });
      const h = 3.9; const y0 = g + 43.6;
      const apex = [tx, y0 + 11, tz];
      const cs = [[tx - h, tz - h], [tx + h, tz - h], [tx + h, tz + h], [tx - h, tz + h]];
      for (let k = 0; k < 4; k++) {
        const a = cs[k]; const bq = cs[(k + 1) % 4];
        quadStrip(batch.roof, [a[0], y0, a[1]], [bq[0], y0, bq[1]], apex, apex, [0.3, 0.45, 0.4]);
      }
      void gAvg;
    }

    function addBuilding(batch, b, ci, idx, ringOverride) {
      const ring0 = ringOverride || sceneRing(b[5]);
      const meta = b[0];
      const kind = meta & 7;
      const roofCode = (meta >> 3) & 31;
      const H = b[1] / 10;
      const minH = b[2] / 10;
      const ring = signedArea(ring0) > 0 ? ring0.slice().reverse() : ring0; // clockwise-in-(x,z) => outward normal = (dz, -dx) for A<0 handled below
      // keep clear of the track and its neighbours (platform, overhead wires)
      let tooClose = false;
      for (let i = 0; i < ring.length && !tooClose; i++) {
        const q = nearest(ring[i][0], ring[i][1]);
        if (q.d < 3.4) tooClose = true;
      }
      if (tooClose) return false;
      const rng = mulberry(hash2(ci * 977 + idx, 17) * 4294967296);
      const lmName = b[6];
      if (lmName === 'philharmonie' || lmName === 'stade') return addBigLandmark(batch, lmName, ring, H);
      // ground
      let gMin = 1e9; let gSum = 0;
      ring.forEach((p) => { const g = gy(p[0], p[1]); gMin = Math.min(gMin, g); gSum += g; });
      const gAvg = gSum / ring.length;
      const base = Math.min(gMin, gAvg) - 0.5;
      const top = gAvg + H;
      const glassy = (kind === 1 || kind === 5 || kind === 6) && H > 17 && ((meta >> 8) & 1) === 0 ? rng() < 0.55 : false;
      const wallBatch = glassy ? batch.glass : batch.wall;
      let wallCol = b[3] ? hexRGB(b[3]) : C(PAL[kind][Math.floor(rng() * PAL[kind].length)]);
      if (glassy) wallCol = scale3(C('#dfe6ea'), 0.92 + rng() * 0.12);
      const bays = glassy ? 2.4 : BAY_W;
      const floorH = glassy ? 3.6 : FLOOR_H;
      const area = signedArea(ring);
      let cum = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]; const q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0]; const dz = q[1] - p[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        // outward normal: for area<0 (clockwise in x,z) the outside is on the left of travel: (dz, -dx)
        const sgn = area < 0 ? -1 : 1;
        const nx = (dz / len) * sgn; const nz = (-dx / len) * sgn;
        const u0 = cum / bays; const u1 = (cum + len) / bays;
        const v0 = (base + 0.5 - (gMin - 0.0)) / floorH;
        const wallBase = minH > 0 ? gAvg + minH : base;
        const vA = (wallBase - gMin) / floorH; const vB = (top - gMin) / floorH;
        const shade = 0.9 + 0.1 * Math.abs(nx);
        const col = [wallCol[0] * shade, wallCol[1] * shade, wallCol[2] * shade];
        const i0 = wallBatch.vert(p[0], wallBase, p[1], nx, 0, nz, u0, vA, col);
        const i1 = wallBatch.vert(q[0], wallBase, q[1], nx, 0, nz, u1, vA, col);
        const i2 = wallBatch.vert(q[0], top, q[1], nx, 0, nz, u1, vB, col);
        const i3 = wallBatch.vert(p[0], top, p[1], nx, 0, nz, u0, vB, col);
        wallBatch.quad(i0, i1, i2, i3);
        cum += len;
        void v0;
      }
      // roof
      const rcol = b[4] ? hexRGB(b[4]) : ROOF_COL[Math.floor(rng() * ROOF_COL.length)];
      const small = ring.length <= 8;
      const o = small ? obb(ring) : null;
      const rectLike = o && signedArea(ring) !== 0 && Math.abs(area) / o.area > 0.8;
      let pitched = roofCode === 2 || roofCode === 3 || roofCode === 4;
      if (roofCode === 0 && (kind === 0 || kind === 4) && H < 11 && rectLike && ring.length <= 6) pitched = true;
      if (kind === 4 && rectLike) pitched = true;
      if (pitched && rectLike) {
        const w = o.x1 - o.x0; const d = o.z1 - o.z0;
        const long = w >= d;
        const span = long ? d : w;
        const rise = clamp(span * 0.34, 1.4, 6.5);
        const ov = 0.35;
        const cxl = (o.x0 + o.x1) / 2; const czl = (o.z0 + o.z1) / 2;
        const toWorld = (u, v) => [u * o.c - v * o.s, u * o.s + v * o.c];
        const hip = roofCode === 3 || roofCode === 4;
        const ridgeInset = hip ? Math.min(span * 0.5, (long ? w : d) * 0.5 - 0.1) : 0;
        const P = (u, v, y) => { const q = toWorld(u, v); return [q[0], y, q[1]]; };
        const ya = top; const yb = top + rise;
        const hu = (o.x1 - o.x0) / 2 + ov; const hv = (o.z1 - o.z0) / 2 + ov;
        const cu = cxl; const cv = czl;
        const corners = [P(cu - hu, cv - hv, ya - 0.15), P(cu + hu, cv - hv, ya - 0.15), P(cu + hu, cv + hv, ya - 0.15), P(cu - hu, cv + hv, ya - 0.15)];
        let ridgeA; let ridgeB;
        if (long) { ridgeA = P(cu - hu + ridgeInset + (hip ? ov : 0), cv, yb); ridgeB = P(cu + hu - ridgeInset - (hip ? ov : 0), cv, yb); }
        else { ridgeA = P(cu, cv - hv + ridgeInset + (hip ? ov : 0), yb); ridgeB = P(cu, cv + hv - ridgeInset - (hip ? ov : 0), yb); }
        const face = (a, b2, c2, d2) => {
          const e1 = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]]; const e2 = [d2[0] - a[0], d2[1] - a[1], d2[2] - a[2]];
          let nx = e1[1] * e2[2] - e1[2] * e2[1]; let ny = e1[2] * e2[0] - e1[0] * e2[2]; let nz = e1[0] * e2[1] - e1[1] * e2[0];
          const nl2 = Math.hypot(nx, ny, nz) || 1; nx /= nl2; ny /= nl2; nz /= nl2;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const i0 = batch.roof.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, rcol);
          const i1 = batch.roof.vert(b2[0], b2[1], b2[2], nx, ny, nz, 4, 0, rcol);
          const i2 = batch.roof.vert(c2[0], c2[1], c2[2], nx, ny, nz, 4, 3, rcol);
          const i3 = batch.roof.vert(d2[0], d2[1], d2[2], nx, ny, nz, 0, 3, rcol);
          batch.roof.quad(i0, i1, i2, i3);
        };
        const triFace = (a, b2, c2, col) => {
          const e1 = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]]; const e2 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
          let nx = e1[1] * e2[2] - e1[2] * e2[1]; let ny = e1[2] * e2[0] - e1[0] * e2[2]; let nz = e1[0] * e2[1] - e1[1] * e2[0];
          const nl2 = Math.hypot(nx, ny, nz) || 1; nx /= nl2; ny /= nl2; nz /= nl2;
          const i0 = batch.roof.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, col);
          const i1 = batch.roof.vert(b2[0], b2[1], b2[2], nx, ny, nz, 3, 0, col);
          const i2 = batch.roof.vert(c2[0], c2[1], c2[2], nx, ny, nz, 1.5, 3, col);
          batch.roof.tri(i0, i1, i2);
        };
        if (long) {
          face(corners[0], corners[1], ridgeB, ridgeA);   // v- slope
          face(corners[3], corners[2], ridgeB, ridgeA);   // v+ slope
          if (hip) { triFace(corners[0], corners[3], ridgeA, rcol); triFace(corners[1], corners[2], ridgeB, rcol); }
          else {
            triFace(corners[0], corners[3], ridgeA, wallCol); triFace(corners[1], corners[2], ridgeB, wallCol);
          }
        } else {
          face(corners[0], corners[3], ridgeB, ridgeA);
          face(corners[1], corners[2], ridgeB, ridgeA);
          if (hip) { triFace(corners[0], corners[1], ridgeA, rcol); triFace(corners[3], corners[2], ridgeB, rcol); }
          else { triFace(corners[0], corners[1], ridgeA, wallCol); triFace(corners[3], corners[2], ridgeB, wallCol); }
        }
      } else {
        // flat roof: triangulate the footprint
        const contour = ring.map((p) => new T.Vector2(p[0], p[1]));
        let tris = null;
        try { tris = T.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = null; }
        const col = FLAT_ROOF;
        const baseIdx = batch.roof.count;
        ring.forEach((p) => batch.roof.vert(p[0], top + 0.02, p[1], 0, 1, 0, p[0] / 3, p[1] / 3, col));
        if (tris) tris.forEach((t) => batch.roof.tri(baseIdx + t[0], baseIdx + t[2], baseIdx + t[1]));
        // parapet lip + roof furniture on bigger roofs
        if (Math.abs(area) > 120 && H > 8) {
          const hx = (o ? (o.x0 + o.x1) / 2 : ring[0][0]); void hx;
          const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
          addBox(batch.misc, c[0] + (rng() - 0.5) * 4, top + 0.9, c[1] + (rng() - 0.5) * 4, 2.5 + rng() * 3, 1.6, 2 + rng() * 2.5, rng() * 3, C('#8d9093'));
        }
      }
      if (lmName === 'gare') addGareTower(batch, ring, area, gAvg);
      return true;
    }

    function buildRoads(ci, d, batch, lampOut, roadsOut) {
      d.r.forEach((rd, ri) => {
        const cls = rd[0]; const flags = rd[1]; const width = rd[3] / 10;
        if (flags & 2) return;
        const raw = decodeFlat(rd[4]).map(toScene);
        if (raw.length < 2) return;
        const pts = densify(raw, 9);
        const bridge = (flags & 1) !== 0;
        const lift = 0.07 + ((ri % 6) * 0.004) + (cls <= 1 ? 0.004 : 0);
        let yA = 0; let yB = 0; let cumLen = [0]; let total = 0;
        if (bridge) {
          yA = gy(pts[0].x, pts[0].z); yB = gy(pts[pts.length - 1].x, pts[pts.length - 1].z);
          for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cumLen.push(total); }
          // ends of bridges follow the ground, the deck is straight in between (never below the line's own deck where it runs beside it)
          const q0 = nearest(pts[0].x, pts[0].z); const q1 = nearest(pts[pts.length - 1].x, pts[pts.length - 1].z);
          if (q0.d < 40 && q1.d < 40) { yA = q0.y - 0.5; yB = q1.y - 0.5; }
        }
        pts.forEach((p, i) => { p.y = bridge ? lerp(yA, yB, total ? cumLen[i] / total : 0) : gy(p.x, p.z); });
        const marked = cls <= 3 || (cls === 4 && width > 6);
        const hw = width / 2;
        if (!bridge && cls >= 1 && cls <= 4 && pts.length >= 2) {
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
          if (cum[cum.length - 1] > 30) roadsOut.push({ pts, cum, len: cum[cum.length - 1], hw, oneway: (flags & 4) !== 0, cls });
        }
        const colr = cls === 5 || cls === 8 ? [0.86, 0.86, 0.84] : cls === 6 ? [0.8, 0.78, 0.74] : [1, 1, 1];
        ribbon(batch.road, pts, hw, colr, { u0: marked ? 0.52 : 0.02, u1: marked ? 0.98 : 0.48, vScale: 8, lift, yAt: bridge ? null : (x, z) => gy(x, z) });
        if (bridge) {
          // underside slab so the deck has thickness
          ribbon(batch.misc, pts, hw + 0.3, C('#8a8780'), { lift: lift - 1.1 });
        } else if (cls <= 4 || cls === 6) {
          const sw = 2.3;
          const left = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)]; const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: p.x - ((b.z - a.z) / dl) * (hw + sw / 2 + 0.05), z: p.z + ((b.x - a.x) / dl) * (hw + sw / 2 + 0.05), y: p.y }; });
          const right = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)]; const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: p.x + ((b.z - a.z) / dl) * (hw + sw / 2 + 0.05), z: p.z - ((b.x - a.x) / dl) * (hw + sw / 2 + 0.05), y: p.y }; });
          const trimmed = (arr) => (arr.length > 3 ? arr.slice(1, -1) : arr);
          [trimmed(left), trimmed(right)].forEach((side) => { if (side.length >= 2) ribbon(batch.pave, side, sw / 2, [1, 1, 1], { vScale: 4, lift: 0.045, yAt: (x, z) => gy(x, z) }); });
          if (Q.lamps && cls >= 1 && cls <= 3) {
            let acc = 14;
            for (let i = 1; i < pts.length; i++) {
              const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
              acc += seg;
              if (acc >= 34) {
                acc = 0;
                const dl = seg || 1; const nxv = -(pts[i].z - pts[i - 1].z) / dl; const nzv = (pts[i].x - pts[i - 1].x) / dl;
                const side = (lampOut.n++ % 2) ? 1 : -1;
                const lx = pts[i].x + nxv * side * (hw + 1.2); const lz = pts[i].z + nzv * side * (hw + 1.2);
                if (nearest(lx, lz).d > 5.5) lampOut.list.push([lx, gy(lx, lz), lz, -nxv * side, -nzv * side]);
              }
            }
          }
        }
      });
    }

    function addLamp(batch, p) {
      const [x, y, z, ax, az] = p;
      const col = C('#464b50');
      addBeam(batch.misc, [x, y, z], [x, y + 7.2, z], 0.14, col);
      addBeam(batch.misc, [x, y + 7.2, z], [x + ax * 1.6, y + 7.35, z + az * 1.6], 0.1, col);
      addBox(batch.glowLamp, x + ax * 1.6, y + 7.25, z + az * 1.6, 0.5, 0.12, 0.28, Math.atan2(az, ax), C('#fff3d6'));
    }

    /* ---- the tram: bed, opposite tracks, rails */
    const SURF_COL = [[0.4, 0.58, 0.27], [0.6, 0.6, 0.58], [0.34, 0.35, 0.38], [0.52, 0.5, 0.47]];
    function railStrip(m, pts, off, y0) {
      // two rails offset +-off from a polyline (pts [{x,y,z}]), each a raised strip with side faces
      const steel = [0.58, 0.58, 0.56];
      [-1, 1].forEach((sd) => {
        const rail = pts.map((p, i) => {
          const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
          const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          return { x: p.x + (-(b.z - a.z) / dl) * off * sd, z: p.z + ((b.x - a.x) / dl) * off * sd, y: p.y + y0 };
        });
        ribbon(m, rail, 0.045, steel, { vScale: 4 });
        // side walls
        for (let k = 0; k < 2; k++) {
          const base = m.count;
          rail.forEach((p, i) => {
            const a = rail[Math.max(0, i - 1)]; const b = rail[Math.min(rail.length - 1, i + 1)];
            const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const nx = -(b.z - a.z) / dl; const nz = (b.x - a.x) / dl; const sg = k ? 1 : -1;
            m.vert(p.x + nx * 0.045 * sg, p.y, p.z + nz * 0.045 * sg, nx * sg, 0, nz * sg, 0, 0, [0.45, 0.45, 0.44]);
            m.vert(p.x + nx * 0.045 * sg, p.y - 0.1, p.z + nz * 0.045 * sg, nx * sg, 0, nz * sg, 0, 1, [0.4, 0.4, 0.4]);
          });
          for (let i = 0; i < rail.length - 1; i++) { const a = base + i * 2; if (k) m.quad(a, a + 1, a + 3, a + 2); else m.quad(a, a + 2, a + 3, a + 1); }
        }
      });
    }

    function buildTram(ci, sa, sb, batch) {
      // main track bed by surface segments, clipped to this chunk
      const step = 3;
      const segs = lt.segs;
      segs.forEach((sg) => {
        const a = Math.max(sa, sg.s0); const b = Math.min(sb, sg.s1);
        if (b - a < 0.5) return;
        const pts = [];
        const n = Math.max(1, Math.ceil((b - a) / step));
        for (let i = 0; i <= n; i++) { const f = frame(a + ((b - a) * i) / n); pts.push({ x: f.pos.x, y: f.pos.y, z: f.pos.z }); }
        const surf = sg.surf;
        const grass = surf === 0;
        const col = SURF_COL[surf] || SURF_COL[1];
        const yb = grass ? -0.11 : -0.02;
        const slab = pts.map((p) => ({ x: p.x, y: p.y + yb, z: p.z }));
        ribbon(batch.bed, slab, grass ? 1.75 : 1.65, col, { vScale: 3, u0: 0, u1: 1 });
        if (grass) { // concrete edge strips
          [-1, 1].forEach((sd) => {
            const edge = pts.map((p, i) => { const q0 = pts[Math.max(0, i - 1)]; const q1 = pts[Math.min(pts.length - 1, i + 1)]; const dl = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1; return { x: p.x + (-(q1.z - q0.z) / dl) * 1.78 * sd, z: p.z + ((q1.x - q0.x) / dl) * 1.78 * sd, y: p.y - 0.06 }; });
            ribbon(batch.bed, edge, 0.1, [0.7, 0.7, 0.68], { vScale: 3 });
          });
        }
      });
      // the opposite track and yard tracks
      const d = data.chunks[String(ci)];
      if (d && d.g) {
        d.g.forEach((g) => {
          const raw = decodeFlat(g[2]).map(toScene);
          if (raw.length < 2) return;
          const pts = densify(raw, 6);
          pts.forEach((p) => { const q = nearest(p.x, p.z); p.y = q.d < 30 ? q.y : gy(p.x, p.z) + 0.06; });
          const surf = g[0];
          const col = SURF_COL[surf] || SURF_COL[1];
          if (surf !== 0) ribbon(batch.bed, pts.map((p) => ({ x: p.x, z: p.z, y: p.y - 0.02 })), 1.6, col, { vScale: 3 });
          else ribbon(batch.bed, pts.map((p) => ({ x: p.x, z: p.z, y: p.y - 0.11 })), 1.7, col, { vScale: 3 });
          railStrip(batch.steel, pts, 0.7175, 0);
        });
      }
    }

    /* ---- bridges */
    function buildBridge(br, batch) {
      const n = Math.max(4, Math.ceil((br.s1 - br.s0) / 4));
      const frames = [];
      for (let i = 0; i <= n; i++) { const f = frame(br.s0 + ((br.s1 - br.s0) * i) / n); frames.push({ x: f.pos.x, y: f.pos.y, z: f.pos.z, rx: f.right.x, rz: f.right.z }); }
      const rouge = /Charlotte/.test(br.name || '');
      const adolphe = /Adolphe/.test(br.name || '');
      const half = rouge ? 11.5 : adolphe ? 9.5 : 5.4;
      const girder = rouge ? C('#b0261f') : adolphe ? C('#cdb994') : C('#a9a69f');
      const girderDark = rouge ? C('#7f1a15') : adolphe ? C('#a6946f') : C('#8b8982');
      const depth = rouge ? 3.4 : adolphe ? 1.6 : 1.5;
      const strip = (lat0, lat1, y0, y1, col, normal) => {
        const base = batch.steel.count;
        frames.forEach((f) => {
          batch.steel.vert(f.x + f.rx * lat0, f.y + y0, f.z + f.rz * lat0, normal[0], normal[1], normal[2], 0, 0, col);
          batch.steel.vert(f.x + f.rx * lat1, f.y + y1, f.z + f.rz * lat1, normal[0], normal[1], normal[2], 1, 0, col);
        });
        for (let i = 0; i < frames.length - 1; i++) { const a = base + i * 2; batch.steel.quad(a, a + 2, a + 3, a + 1); }
      };
      // underside + two sides (double sided material)
      strip(-half, half, -depth, -depth, girderDark, [0, -1, 0]);
      strip(-half, -half, -depth, -0.3, girder, [-1, 0, 0]);
      strip(half, half, -0.3, -depth, girder, [1, 0, 0]);
      // parapets
      strip(-half, -half, -0.3, 1.0, adolphe ? C('#e0d3b4') : C('#9a9c9e'), [1, 0, 0]);
      strip(half, half, -0.3, 1.0, adolphe ? C('#e0d3b4') : C('#9a9c9e'), [-1, 0, 0]);
      // piers / arches down to the ground
      const mid = frames[Math.floor(frames.length / 2)];
      const groundAt = (x, z) => gy(x, z);
      if (rouge) {
        [0.3, 0.7].forEach((u) => {
          const f = frames[Math.round(u * n)];
          const gyv = groundAt(f.x, f.z);
          [-1, 1].forEach((sd) => {
            const x0 = f.x + f.rx * half * 0.7 * sd; const z0 = f.z + f.rz * half * 0.7 * sd;
            // V legs from the deck to the ground, two per side (steel red)
            [-1, 1].forEach((tilt) => {
              const gx = x0 + (f.rz) * 6 * tilt; const gz = z0 - (f.rx) * 6 * tilt;
              addBeam(batch.steel, [x0, f.y - depth, z0], [gx, gyv, gz], 1.5, girder);
            });
          });
          addBeam(batch.steel, [f.x - f.rx * half * 0.7, f.y - depth - 5, f.z - f.rz * half * 0.7], [f.x + f.rx * half * 0.7, f.y - depth - 5, f.z + f.rz * half * 0.7], 1.2, girderDark);
        });
      } else if (adolphe) {
        const f0 = frames[0]; const f1 = frames[frames.length - 1];
        const span = Math.hypot(f1.x - f0.x, f1.z - f0.z);
        const gyv = Math.min(groundAt(mid.x, mid.z), mid.y - 12);
        const rise = (mid.y - depth) - gyv;
        [-1, 1].forEach((sd) => { // two arch ribs
          let prev = null;
          for (let i = 0; i <= 14; i++) {
            const u = -1 + (i / 14) * 2;
            const t = 0.5 + u * 0.5 * 0.86;
            const f = frames[Math.round(t * n)];
            const yy = gyv + rise * Math.sqrt(Math.max(0, 1 - u * u));
            const p = [f.x + f.rx * (half - 1.5) * sd, yy, f.z + f.rz * (half - 1.5) * sd];
            if (prev) addBeam(batch.steel, prev, p, 1.6, girder);
            if (i % 2 === 0 && i > 0 && i < 14) addBeam(batch.steel, p, [p[0], f.y - depth, p[2]], 1.2, girderDark);
            prev = p;
          }
        });
        void span;
      } else if (br.s1 - br.s0 > 30) {
        const piers = Math.floor((br.s1 - br.s0) / 24);
        for (let k = 1; k <= piers; k++) {
          const f = frames[Math.round((k / (piers + 1)) * n)];
          const gyv = groundAt(f.x, f.z);
          if (f.y - gyv > 3) addBox(batch.steel, f.x, (f.y - depth + gyv) / 2, f.z, 1.6, f.y - depth - gyv, half * 1.6, Math.atan2(f.rz, f.rx) + Math.PI / 2, girderDark);
        }
      }
    }

    /* ---- trees, signals */
    function buildTrees(ci, d, batch) {
      const rng = mulberry(ci * 7919 + 13);
      const out = batch.leaf;
      d.t.forEach((t, idx) => {
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
        void idx;
      });
      d.x.forEach((sgn) => { // traffic lights
        const x = sgn[0] / 10 - ox; const z = sgn[1] / 10 - oz;
        if (nearest(x, z).d < 4.5) return;
        const y = gy(x, z);
        addBeam(batch.misc, [x, y, z], [x, y + 4.6, z], 0.12, C('#3c4146'));
        addBox(batch.misc, x, y + 4.2, z, 0.34, 1.0, 0.3, 0, C('#1f2225'));
        addBox(batch.glowLamp, x, y + 4.55, z, 0.2, 0.2, 0.31, 0, C('#cc3a2a'));
      });
    }

    function buildWaters(ci, d, batch) {
      d.w.forEach((w) => {
        if (w[1]) return;
        const raw = decodeFlat(w[2]).map(toScene);
        if (raw.length < 2) return;
        const pts = densify(raw, 12);
        const hw = Math.max(1.2, w[0] / 20);
        pts.forEach((p) => { p.y = gy(p.x, p.z) - 0.1; });
        ribbon(batch.water, pts, hw + 1.5, [1, 1, 1], { vScale: 10, lift: 0.18 });
      });
      const info = chunkLand(ci);
      info.land.forEach((p) => {
        if (p.code !== 3 || p.ring.length < 3) return;
        const contour = p.ring.map((q) => new T.Vector2(q[0], q[1]));
        let tris = null;
        try { tris = T.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
        if (!tris || !tris.length) return;
        let yMin = 1e9; p.ring.forEach((q) => { yMin = Math.min(yMin, gy(q[0], q[1])); });
        const base = batch.water.count;
        p.ring.forEach((q) => batch.water.vert(q[0], yMin + 0.25, q[1], 0, 1, 0, q[0] / 8, q[1] / 8, [1, 1, 1]));
        tris.forEach((t) => batch.water.tri(base + t[0], base + t[1], base + t[2]));
      });
    }


    /* ---- far field: the real footprints nearer than the data corridor are echoed outwards, so the city does not stop at the data edge */
    function echoBuildings(batch, d, ci) {
      const rng = mulberry(ci * 4441 + 5);
      d.b.forEach((b, idx) => {
        if (b[6] || b[1] < 40 || rng() > 0.8) return;
        const ring = sceneRing(b[5]);
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        const q = nearest(c[0], c[1]);
        if (q.d < 35 || q.d > 128) return;
        const f = frame(q.s);
        const side = q.lat >= 0 ? 1 : -1;
        for (let layer = 0; layer < Q.echo; layer++) {
          const off = (130 - q.d) + 12 + layer * (95 + rng() * 40) + rng() * 30;
          const dx = f.right.x * side * off; const dz = f.right.z * side * off;
          const moved = ring.map((p) => [p[0] + dx, p[1] + dz]);
          const b2 = b.slice(); b2[1] = Math.round(b[1] * (0.75 + rng() * 0.5)); b2[3] = 0; b2[4] = 0;
          try { addBuilding(batch, b2, ci, idx + 1000 * (layer + 1), moved); } catch (e) { /* ignore */ }
        }
      });
    }

    /* ---- chunk assembly */
    function buildChunk(ci) {
      const d = data.chunks[String(ci)] || { b: [], r: [], t: [], l: [], w: [], x: [], g: [] };
      const sOrigA = ci * data.chunk;
      const sOrigB = sOrigA + data.chunk;
      const sa = lt.toRoute(lt.absFromOrig(sOrigA));
      const sb = lt.toRoute(lt.absFromOrig(sOrigB));
      const group = new T.Group();
      group.name = 'lt-chunk-' + ci;
      const batch = { wall: new Mesher(), glass: new Mesher(), roof: new Mesher(), road: new Mesher(), pave: new Mesher(), bed: new Mesher(), misc: new Mesher(), steel: new Mesher(), leaf: new Mesher(), water: new Mesher(), glowLamp: new Mesher() };
      const add = (m, mat, o) => { const mesh = m.mesh(mat, o); if (mesh) group.add(mesh); return mesh; };
      add(buildGround(ci, sa, sb), matGround, { order: -1 });
      let built = 0;
      d.b.forEach((b, i) => { try { if (addBuilding(batch, b, ci, i)) built++; } catch (e) { console.warn(TAG + 'building failed', e); } });
      if (Q.echo) echoBuildings(batch, d, ci);
      const lampOut = { n: ci, list: [] };
      const roadsOut = [];
      buildRoads(ci, d, batch, lampOut, roadsOut);
      lampOut.list.forEach((p) => addLamp(batch, p));
      buildTram(ci, sa, sb, batch);
      track.bridges.forEach((br) => { const mid = (br.s0 + br.s1) / 2; if (mid >= sa && mid < sb) buildBridge(br, batch); });
      buildTrees(ci, d, batch);
      buildWaters(ci, d, batch);
      add(batch.wall, matWall, { cast: Q.castShadow });
      add(batch.glass, matGlass, { cast: Q.castShadow });
      add(batch.roof, matRoof, { cast: Q.castShadow });
      add(batch.road, matRoad, { order: 0 });
      add(batch.pave, matPave, { order: 0 });
      add(batch.bed, matBed, { order: 1 });
      add(batch.misc, matMisc, {});
      add(batch.steel, matSteel, { cast: Q.castShadow });
      add(batch.leaf, matLeaf, { cast: Q.castShadow, noReceive: true });
      add(batch.glowLamp, matLampGlow, { noReceive: true });
      const w = add(batch.water, matWater, { order: 2, noReceive: true });
      void w;
      root.add(group);
      roadsByChunk.set(ci, roadsOut);
      return { ci, group, buildings: built };
    }
    const matLampGlow = new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true });
    mats.push(matLampGlow);


    /* ---- traffic: a few cars driving along the real roads (one instanced mesh) */
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
    let carList = [];
    let carDirty = true;
    function rebuildCars() {
      const rng = mulberry(77);
      const list = [];
      roadsByChunk.forEach((roads) => roads.forEach((rd) => {
        const per = rd.cls <= 2 ? 55 : 90;
        const n = Math.floor(rd.len / per) + (rng() < (rd.len / per) % 1 ? 1 : 0);
        for (let i = 0; i < n && list.length < Q.cars; i++) {
          const dir = rd.oneway ? 1 : (rng() < 0.5 ? 1 : -1);
          list.push({ rd, t: rng() * rd.len, v: dir * (7 + rng() * 6), dir, col: CAR_COLS[Math.floor(rng() * CAR_COLS.length)] });
        }
      }));
      carList = list;
      carMesh.count = list.length;
      list.forEach((c, i) => carMesh.setColorAt(i, c.col));
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
      carDirty = false;
    }
    const cm = new T.Matrix4(); const cq = new T.Quaternion(); const cp = new T.Vector3(); const cs1 = new T.Vector3(1, 1, 1); const cUp = new T.Vector3(0, 1, 0);
    function updateCars(dt) {
      if (carDirty) rebuildCars();
      for (let i = 0; i < carList.length; i++) {
        const c = carList[i]; const rd = c.rd;
        c.t += c.v * dt;
        if (c.t > rd.len) c.t -= rd.len; else if (c.t < 0) c.t += rd.len;
        let j = 1; while (j < rd.cum.length - 1 && rd.cum[j] < c.t) j++;
        const a = rd.pts[j - 1]; const b = rd.pts[j];
        const seg = rd.cum[j] - rd.cum[j - 1] || 1; const u = (c.t - rd.cum[j - 1]) / seg;
        const dx = b.x - a.x; const dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1;
        const lane = rd.hw * 0.45 * c.dir;
        cp.set(lerp(a.x, b.x, u) + (-dz / dl) * lane, lerp(a.y, b.y, u) + 0.07, lerp(a.z, b.z, u) + (dx / dl) * lane);
        cq.setFromAxisAngle(cUp, Math.atan2(-dx * c.dir, -dz * c.dir));
        cm.compose(cp, cq, cs1);
        carMesh.setMatrixAt(i, cm);
      }
      carMesh.instanceMatrix.needsUpdate = true;
    }

    /* ---- streaming */
    let lastS = -1e9;
    function wanted(s) {
      const sOrig = lt.origFromAbs(s + lt.sStart);
      const lo = Math.max(firstCi, Math.floor((sOrig - Q.behind) / data.chunk));
      const hi = Math.min(lastCi, Math.floor((sOrig + Q.ahead) / data.chunk));
      return [lo, hi];
    }
    function ensure(s, all) {
      const [lo, hi] = wanted(s);
      Array.from(chunks.keys()).forEach((k) => { if (k < lo - 1 || k > hi + 1) disposeChunk(k); });
      const sOrig = lt.origFromAbs(s + lt.sStart);
      const centre = Math.floor(sOrig / data.chunk);
      const list = [];
      for (let k = lo; k <= hi; k++) if (!chunks.has(k)) list.push(k);
      list.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
      let n = 0;
      for (const k of list) {
        if (!all && n >= MAX_BUILDS_PER_UPDATE) break;
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
      roadsByChunk.delete(k); carDirty = true;
    }

    function update(s, camera, dt) {
      if (disposed) return;
      if (Q.cars) updateCars(Math.min(0.1, dt || 0.016));
      ensure(clamp(s, 0, L), false);
      const sun = landscape && landscape.sun ? landscape.sun.intensity : 3;
      nightK = 1 - smooth(0.2, 1.4, sun);
      matWall.emissiveIntensity = matGlass.emissiveIntensity = nightK * 1.25;
      lastS = s;
    }
    function warm(s) { ensure(clamp(s === undefined ? 0 : s, 0, L), true); }
    const noop = () => {};
    function stats() {
      let tris = 0; let meshes = 0;
      root.traverse((o) => { if (o.isMesh && o.visible) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
      return { chunks: chunks.size, meshes, triangles: Math.round(tris), buildings: Array.from(chunks.values()).reduce((a, c) => a + c.buildings, 0) };
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      Array.from(chunks.keys()).forEach(disposeChunk);
      scene.remove(root);
      mats.forEach((m) => m.dispose());
      carGeo.dispose(); carMesh.dispose();
      treeTpl.length = 0;
    }
    ensure(0, false);
    void lastS;
    return { update, setTimeOfDay: noop, setWeather: noop, warm, stats, dispose, root };
  }

  TS.luxtramWorld = { create, QUALITY };
})();
