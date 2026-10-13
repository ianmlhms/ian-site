/* Lokféierer: infrastructure along the track (TS.infra.create).
 * Everything is procedural: merged vertex-coloured batches + a few cached canvas textures,
 * streamed in 200 m chunks around the train. Local coordinates are chunk-relative to keep
 * float precision on long routes. */
(function () {
  'use strict';
  window.TS = window.TS || {};
  const T = THREE;

  /* ------------------------------------------------------------ constants */
  const CHUNK = 200;
  const QUALITY = {
    high: { ahead: 1500, behind: 300, sleeperStep: 0.6, sweepStep: 4, mastSpacing: 50, droppers: true, messenger: true, glass: true, castAll: true, castStations: true, ribs: 8 },
    medium: { ahead: 1100, behind: 250, sleeperStep: 0.75, sweepStep: 4, mastSpacing: 60, droppers: false, messenger: true, glass: false, castAll: false, castStations: true, ribs: 14 },
    low: { ahead: 800, behind: 200, sleeperStep: 1.3, sweepStep: 8, mastSpacing: 75, droppers: false, messenger: false, glass: false, castAll: false, castStations: false, ribs: 24 },
  };
  const WINDOW_BUILDS_PER_UPDATE = 1;
  const TRAM_SWEEP_STEP = 2;
  const RAIL_X = 0.7175;
  const BALLAST_TOP = -0.24;
  const FORM_Y = -0.55;
  const SLEEPER_SIZE = [2.6, 0.2, 0.26];
  const CONTACT_H = 5.3;
  const MESSENGER_H = 6.4;
  const MAST_H = 6.9;
  const MAST_X = 3.3;
  const PLATFORM_EDGE = 1.7;
  const PLATFORM_H_RAIL = 0.76;
  const PLATFORM_H_TRAM = 0.3;
  const BLINK_PERIOD = 0.55;
  const CROSSING_ROAD_HALF = 22;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mulberry = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hashStr = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };

  /* ---------------------------------------------------------------- colours */
  const colCache = new Map();
  function col(hex) {
    let c = colCache.get(hex);
    if (!c) {
      const k = new T.Color(hex);
      c = [k.r, k.g, k.b];
      colCache.set(hex, c);
    }
    return c;
  }
  function shade(hex, f) {
    const c = col(hex);
    return [clamp(c[0] * f, 0, 1), clamp(c[1] * f, 0, 1), clamp(c[2] * f, 0, 1)];
  }

  /* --------------------------------------------------------------- textures */
  const texCache = new Map();
  function canvasTex(key, w, h, draw, opts) {
    if (texCache.has(key)) return texCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx, w, h);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const o = opts || {};
    tex.wrapS = o.clampU ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    tex.wrapT = o.clampV ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    tex.anisotropy = 4;
    texCache.set(key, tex);
    return tex;
  }
  function speckle(ctx, w, h, base, spread, count, size) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(hashStr(base) + count);
    for (let i = 0; i < count; i++) {
      const v = Math.floor(128 + (rnd() - 0.5) * spread);
      ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.1 + rnd() * 0.25).toFixed(2) + ')';
      const s = 1 + rnd() * size;
      ctx.fillRect(rnd() * w, rnd() * h, s, s * (0.5 + rnd()));
    }
  }
  const tex = {
    ballast: () => canvasTex('ballast', 256, 256, (c, w, h) => {
      speckle(c, w, h, '#8c8a86', 150, 5200, 4);
      const rnd = mulberry(7);
      for (let i = 0; i < 700; i++) {
        c.fillStyle = 'rgba(' + (rnd() > 0.5 ? '40,38,36' : '200,196,188') + ',0.35)';
        c.beginPath();
        c.ellipse(rnd() * w, rnd() * h, 1.5 + rnd() * 2.5, 1 + rnd() * 2, rnd() * 3, 0, 6.3);
        c.fill();
      }
    }),
    concrete: () => canvasTex('concrete', 256, 256, (c, w, h) => {
      speckle(c, w, h, '#a4a29d', 90, 2600, 3);
      c.strokeStyle = 'rgba(60,58,54,0.25)';
      c.lineWidth = 1;
      c.strokeRect(0.5, 0.5, w - 1, h - 1);
    }),
    lining: () => canvasTex('lining', 256, 256, (c, w, h) => {
      speckle(c, w, h, '#8f8d88', 80, 2200, 3);
      c.fillStyle = 'rgba(30,28,26,0.55)';
      c.fillRect(0, 0, w, 3);
    }),
    asphalt: () => canvasTex('asphalt', 256, 256, (c, w, h) => speckle(c, w, h, '#4b4d50', 110, 4200, 3)),
    stone: () => canvasTex('stone', 256, 256, (c, w, h) => {
      speckle(c, w, h, '#b59f7c', 60, 2000, 5);
      c.strokeStyle = 'rgba(70,56,38,0.35)';
      c.lineWidth = 2;
      for (let y = 0; y < h; y += 32) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
        for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) {
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y + 32);
          c.stroke();
        }
      }
    }),
    slate: () => canvasTex('slate', 128, 128, (c, w, h) => {
      c.fillStyle = '#4c5159';
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        for (let x = (y / 16) % 2 ? 0 : 8; x < w; x += 16) {
          const v = 60 + Math.floor(Math.random() * 28);
          c.fillStyle = 'rgb(' + v + ',' + (v + 4) + ',' + (v + 10) + ')';
          c.fillRect(x + 1, y + 1, 14, 14);
        }
      }
    }),
    platform: () => canvasTex('platform', 256, 256, (c, w, h) => {
      // u: 0 = track edge, 1 = back (5.2 m); v: 4 m repeat
      speckle(c, w, h, '#a8a6a0', 70, 2600, 3);
      const mpx = w / 5.2;
      c.fillStyle = '#e8e6df';
      c.fillRect(0, 0, 0.1 * mpx, h);
      c.fillStyle = '#e3c022';
      c.fillRect(0.28 * mpx, 0, 0.5 * mpx, h);
      c.fillStyle = 'rgba(90,70,0,0.45)';
      for (let y = 4; y < h; y += 10) for (let x = 0.32 * mpx; x < 0.76 * mpx; x += 10) c.fillRect(x, y, 4, 4);
      c.strokeStyle = 'rgba(70,68,64,0.35)';
      c.beginPath();
      c.moveTo(0, h - 0.5);
      c.lineTo(w, h - 0.5);
      c.moveTo(w / 2, 0);
      c.lineTo(w / 2, h);
      c.stroke();
    }),
    tramPave: () => canvasTex('trampave', 128, 128, (c, w, h) => {
      speckle(c, w, h, '#9b9a96', 60, 1600, 3);
      c.strokeStyle = 'rgba(60,58,54,0.4)';
      for (let y = 0; y < h; y += 16) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
        for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) {
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y + 16);
          c.stroke();
        }
      }
    }),
    sidewalk: () => canvasTex('sidewalk', 128, 128, (c, w, h) => {
      speckle(c, w, h, '#b4b0a8', 40, 900, 3);
      c.strokeStyle = 'rgba(70,66,60,0.45)';
      c.strokeRect(0.5, 0.5, w - 1, h - 1);
    }),
    plaster: (hex) => canvasTex('plaster' + hex, 128, 128, (c, w, h) => speckle(c, w, h, hex, 40, 1500, 3)),
  };

  function facadeTexture(style, hex, rows) {
    return canvasTex('facade:' + style + hex + rows, 256, 256 * rows, (c, w, h) => {
      speckle(c, w, h, hex, 36, 2400, 3);
      const floorH = h / rows;
      for (let r = 0; r < rows; r++) {
        const y0 = r * floorH;
        const ground = r === rows - 1;
        const ww = 76;
        const wx = (w - ww) / 2;
        const wh = floorH * (ground && style === 'gare' ? 0.7 : 0.52);
        const wy = y0 + floorH * (ground && style === 'gare' ? 0.18 : 0.24);
        c.fillStyle = '#d8d2c4';
        c.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
        const grad = c.createLinearGradient(0, wy, 0, wy + wh);
        grad.addColorStop(0, '#5b7488');
        grad.addColorStop(1, '#a3b9c9');
        c.fillStyle = grad;
        if (style === 'gare' && ground) {
          c.beginPath();
          c.moveTo(wx, wy + wh);
          c.lineTo(wx, wy + ww / 2);
          c.arc(w / 2, wy + ww / 2, ww / 2, Math.PI, 0);
          c.lineTo(wx + ww, wy + wh);
          c.closePath();
          c.fill();
        } else c.fillRect(wx, wy, ww, wh);
        c.fillStyle = '#e9e5da';
        c.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        c.fillRect(wx, wy + wh * 0.45, ww, 3);
        c.fillStyle = 'rgba(40,36,30,0.45)';
        c.fillRect(0, y0 + floorH - 4, w, 4);
      }
    });
  }

  function signTexture(name, kind) {
    return canvasTex('sign:' + kind + ':' + name, 1024, 160, (c, w, h) => {
      c.fillStyle = kind === 'tram' ? '#14513f' : '#12365e';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#f3f1ea';
      c.fillRect(6, 6, w - 12, 5);
      c.fillRect(6, h - 11, w - 12, 5);
      let size = 96;
      c.font = '700 ' + size + 'px "Helvetica Neue", Arial, sans-serif';
      while (c.measureText(name).width > w - 90 && size > 30) {
        size -= 4;
        c.font = '700 ' + size + 'px "Helvetica Neue", Arial, sans-serif';
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#f7f6f1';
      c.fillText(name, w / 2, h / 2 + 3);
    }, { clampU: true, clampV: true });
  }

  function limitTexture(kmh) {
    return canvasTex('limit:' + kmh, 128, 160, (c, w, h) => {
      c.fillStyle = '#e8e8e6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#d8231c';
      c.fillRect(0, 0, w, 22);
      c.fillStyle = '#111';
      c.fillRect(0, 22, w, 4);
      c.fillStyle = '#16181a';
      c.font = '800 ' + (kmh >= 100 ? 66 : 82) + 'px "Helvetica Neue", Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(kmh), w / 2, 94);
      c.font = '700 20px Arial';
      c.fillText('km/h', w / 2, 140);
      c.strokeStyle = '#111';
      c.lineWidth = 6;
      c.strokeRect(3, 3, w - 6, h - 6);
    }, { clampU: true, clampV: true });
  }

  /* Temporary speed restriction board: yellow plate, black number; the end board is the same plate with a diagonal bar. */
  function tsrTexture(kmh, isEnd) {
    return canvasTex('tsr:' + (isEnd ? 'end' : kmh), 128, 160, (c, w, h) => {
      c.fillStyle = '#f2b600';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#111';
      c.lineWidth = 8;
      c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#111';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (isEnd) {
        c.font = '800 70px "Helvetica Neue", Arial, sans-serif';
        c.fillText('E', w / 2, 80);
        c.lineWidth = 10;
        c.beginPath();
        c.moveTo(14, h - 14);
        c.lineTo(w - 14, 14);
        c.stroke();
      } else {
        c.font = '800 ' + (kmh >= 100 ? 62 : 80) + 'px "Helvetica Neue", Arial, sans-serif';
        c.fillText(String(kmh), w / 2, 78);
        c.font = '700 20px Arial';
        c.fillText('km/h', w / 2, 130);
      }
    }, { clampU: true, clampV: true });
  }

  function stopTexture() {
    return canvasTex('stopboard', 128, 192, (c, w, h) => {
      c.fillStyle = '#f2a600';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#16181a';
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(0, i * 18 + 6);
        c.lineTo(w, i * 18 - 14);
        c.lineTo(w, i * 18 + 6);
        c.lineTo(0, i * 18 + 26);
        c.fill();
      }
      c.fillStyle = '#f7f6f1';
      c.fillRect(10, 62, w - 20, 116);
      c.fillStyle = '#16181a';
      c.font = '800 44px "Helvetica Neue", Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('STOP', w / 2, 100);
      c.beginPath();
      c.moveTo(w / 2, 172);
      c.lineTo(w / 2 - 26, 136);
      c.lineTo(w / 2 + 26, 136);
      c.closePath();
      c.fillStyle = '#d8231c';
      c.fill();
    }, { clampU: true, clampV: true });
  }

  function clockTexture() {
    const now = new Date();
    const key = 'clock:' + now.getHours() + ':' + now.getMinutes();
    return canvasTex(key, 256, 256, (c, w, h) => {
      c.fillStyle = '#f5f3ec';
      c.beginPath();
      c.arc(128, 128, 124, 0, 6.3);
      c.fill();
      c.strokeStyle = '#1a1a1c';
      c.lineWidth = 8;
      c.stroke();
      c.fillStyle = '#1a1a1c';
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * 6.2832;
        const big = i % 5 === 0;
        c.save();
        c.translate(128, 128);
        c.rotate(a);
        c.fillRect(-(big ? 3 : 1), -118, big ? 6 : 2, big ? 20 : 8);
        c.restore();
      }
      const m = now.getMinutes();
      const hr = (now.getHours() % 12) + m / 60;
      const hand = (angle, len, width) => {
        c.save();
        c.translate(128, 128);
        c.rotate(angle);
        c.fillRect(-width / 2, -len, width, len + 10);
        c.restore();
      };
      hand((hr / 12) * 6.2832, 66, 9);
      hand((m / 60) * 6.2832, 98, 6);
      c.fillStyle = '#c4231c';
      c.beginPath();
      c.arc(128, 128, 7, 0, 6.3);
      c.fill();
    }, { clampU: true, clampV: true });
  }

  const haloTex = () => canvasTex('halo', 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }, { clampU: true, clampV: true });

  /* -------------------------------------------------------------- materials */
  const matCache = new Map();
  function mat(key, make) {
    let m = matCache.get(key);
    if (!m) {
      m = make();
      matCache.set(key, m);
    }
    return m;
  }
  const M = {
    vc: () => mat('vc', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 })),
    steel: () => mat('steel', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.72 })),
    glow: () => mat('glow', () => new T.MeshBasicMaterial({ vertexColors: true })),
    tex: (key, texture, extra) => mat('tex:' + key, () => new T.MeshStandardMaterial(Object.assign({ map: texture, vertexColors: true, roughness: 0.9, metalness: 0.02 }, extra || {}))),
    lining: () => mat('lining', () => new T.MeshStandardMaterial({ vertexColors: true, map: tex.lining(), emissive: new T.Color(0x3a342c), emissiveMap: tex.lining(), roughness: 0.95, metalness: 0 })),
    glass: () => mat('glass', () => new T.MeshStandardMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.3, side: T.DoubleSide, depthWrite: false })),
    sign: (key, texture) => mat('signm:' + key, () => new T.MeshStandardMaterial({ map: texture, emissive: new T.Color(0xffffff), emissiveMap: texture, emissiveIntensity: 0.32, roughness: 0.6, vertexColors: true })),
  };

  /* ------------------------------------------------------------------ batch */
  const tmpM = new T.Matrix4();
  const tmpQ = new T.Quaternion();
  const tmpE = new T.Euler();
  const tmpV = new T.Vector3();
  const tmpS = new T.Vector3();
  const tmpN = new T.Matrix3();
  const UNIT_BOX = new T.BoxGeometry(1, 1, 1);
  const UNIT_CYL = new T.CylinderGeometry(1, 1, 1, 10);

  function Batch(origin) {
    this.o = origin || new T.Vector3();
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.n = 0;
  }
  Batch.prototype.vert = function (x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x - this.o.x, y - this.o.y, z - this.o.z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.n++;
  };
  // quad a,b,c,d (arrays [x,y,z]) with intended normal; winding is corrected automatically
  Batch.prototype.quad = function (a, b, c, d, nrm, color, uvs) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
    const flip = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0;
    const uv = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const pts = flip ? [a, d, c, b] : [a, b, c, d];
    const uvq = flip ? [uv[0], uv[3], uv[2], uv[1]] : uv;
    const i0 = this.vert(pts[0][0], pts[0][1], pts[0][2], nrm[0], nrm[1], nrm[2], uvq[0][0], uvq[0][1], color);
    const i1 = this.vert(pts[1][0], pts[1][1], pts[1][2], nrm[0], nrm[1], nrm[2], uvq[1][0], uvq[1][1], color);
    const i2 = this.vert(pts[2][0], pts[2][1], pts[2][2], nrm[0], nrm[1], nrm[2], uvq[2][0], uvq[2][1], color);
    const i3 = this.vert(pts[3][0], pts[3][1], pts[3][2], nrm[0], nrm[1], nrm[2], uvq[3][0], uvq[3][1], color);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  };
  Batch.prototype.tri = function (a, b, c, nrm, color) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const flip = (aby * acz - abz * acy) * nrm[0] + (abz * acx - abx * acz) * nrm[1] + (abx * acy - aby * acx) * nrm[2] < 0;
    const p = flip ? [a, c, b] : [a, b, c];
    const ids = p.map((q, k) => this.vert(q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], k === 1 ? 1 : 0, k === 2 ? 1 : 0, color));
    this.idx.push(ids[0], ids[1], ids[2]);
  };
  Batch.prototype.geom = function (g, m, color, uvScale) {
    const p = g.attributes.position;
    const nn = g.attributes.normal;
    const uu = g.attributes.uv;
    const e = m.elements;
    tmpN.getNormalMatrix(m);
    const ne = tmpN.elements;
    const base = this.n;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx0 = nn.getX(i), ny0 = nn.getY(i), nz0 = nn.getZ(i);
      let nx = ne[0] * nx0 + ne[3] * ny0 + ne[6] * nz0;
      let ny = ne[1] * nx0 + ne[4] * ny0 + ne[7] * nz0;
      let nz = ne[2] * nx0 + ne[5] * ny0 + ne[8] * nz0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const us = uvScale || 1;
      this.vert(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx, ny, nz, uu ? uu.getX(i) * us : 0, uu ? uu.getY(i) * us : 0, color);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  };
  Batch.prototype.box = function (cx, cy, cz, sx, sy, sz, color, ry, rx, rz) {
    tmpE.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(cx, cy, cz), tmpQ, tmpS.set(sx, sy, sz));
    this.geom(UNIT_BOX, tmpM, color);
  };
  // oriented thin box between two points (arrays)
  Batch.prototype.between = function (a, b, t1, color, t2) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    tmpV.set(dx / len, dy / len, dz / len);
    tmpQ.setFromUnitVectors(new T.Vector3(0, 0, 1), tmpV);
    tmpM.compose(new T.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), tmpQ, tmpS.set(t1, t2 || t1, len));
    this.geom(UNIT_BOX, tmpM, color);
  };
  Batch.prototype.cyl = function (cx, cy, cz, r, h, color, ry, rx, rz) {
    tmpE.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(cx, cy, cz), tmpQ, tmpS.set(r, h, r));
    this.geom(UNIT_CYL, tmpM, color);
  };
  Batch.prototype.mesh = function (material, castShadow, receiveShadow) {
    if (!this.n) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65000 ? new T.Uint32BufferAttribute(this.idx, 1) : new T.Uint16BufferAttribute(this.idx, 1));
    const m = new T.Mesh(g, material);
    m.position.copy(this.o);
    m.castShadow = !!castShadow;
    m.receiveShadow = receiveShadow !== false;
    return m;
  };

  /* A set of named batches that become meshes with the right material. */
  function BatchSet(origin) {
    this.o = origin;
    this.map = new Map();
  }
  BatchSet.prototype.get = function (key, materialFn, cast) {
    let e = this.map.get(key);
    if (!e) {
      e = { batch: new Batch(this.o), materialFn, cast: !!cast };
      this.map.set(key, e);
    }
    return e.batch;
  };
  BatchSet.prototype.meshes = function (castAll) {
    const out = [];
    this.map.forEach((e) => {
      const m = e.batch.mesh(e.materialFn(), e.cast && castAll, true);
      if (m) out.push(m);
    });
    return out;
  };

  /* ------------------------------------------------------------------ sweeps */
  // frames along the track: [{s,x,y,z,rx,rz}]
  function makeFrames(track, s0, s1, step) {
    const out = [];
    const f = track.frameAt(s0);
    const count = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= count; i++) {
      const s = Math.min(s1, s0 + (i * (s1 - s0)) / count);
      track.frameAt(s, f);
      out.push({ s, x: f.pos.x, y: f.pos.y, z: f.pos.z, rx: f.right.x, rz: f.right.z, tx: f.tangent.x, ty: f.tangent.y, tz: f.tangent.z });
    }
    return out;
  }
  // same for any frameAt function (the opposite track)
  function makeFramesF(frameAt, s0, s1, step) {
    const out = [];
    const f = frameAt(s0);
    const count = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= count; i++) {
      const s = Math.min(s1, s0 + (i * (s1 - s0)) / count);
      frameAt(s, f);
      out.push({ s, x: f.pos.x, y: f.pos.y, z: f.pos.z, rx: f.right.x, rz: f.right.z, tx: f.tangent.x, ty: f.tangent.y, tz: f.tangent.z });
    }
    return out;
  }
  // profile points [lat, dy]; open polyline left->right (normal = (-dy, dx)) or closed clockwise polygon.
  function sweep(batch, frames, pts, color, o) {
    const opts = o || {};
    const closed = !!opts.closed;
    const edges = closed ? pts.length : pts.length - 1;
    const uvU = opts.uvU || 1;
    const uvV = opts.uvV || 1;
    const flip = opts.flip ? -1 : 1;
    let cum = 0;
    for (let k = 0; k < edges; k++) {
      const p0 = pts[k];
      const p1 = pts[(k + 1) % pts.length];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const el = Math.hypot(dx, dy) || 1;
      const nl = [(-dy / el) * flip, (dx / el) * flip];
      const c = Array.isArray(color[0]) ? color[k % color.length] : color;
      const u0 = cum * uvU;
      const u1 = (cum + el) * uvU;
      cum += el;
      for (let i = 0; i < frames.length - 1; i++) {
        const fa = frames[i];
        const fb = frames[i + 1];
        const A = [fa.x + fa.rx * p0[0], fa.y + p0[1], fa.z + fa.rz * p0[0]];
        const B = [fa.x + fa.rx * p1[0], fa.y + p1[1], fa.z + fa.rz * p1[0]];
        const C = [fb.x + fb.rx * p1[0], fb.y + p1[1], fb.z + fb.rz * p1[0]];
        const D = [fb.x + fb.rx * p0[0], fb.y + p0[1], fb.z + fb.rz * p0[0]];
        const nrm = [fa.rx * nl[0], nl[1], fa.rz * nl[0]];
        batch.quad(A, B, C, D, nrm, c, [[u0, fa.s * uvV], [u1, fa.s * uvV], [u1, fb.s * uvV], [u0, fb.s * uvV]]);
      }
    }
  }
  const worldPt = (f, lat, dy) => [f.x + f.rx * lat, f.y + dy, f.z + f.rz * lat];

  /* ============================================================ track bed */
  const RAIL_PROFILE = [[-0.034, 0], [0.034, 0], [0.036, -0.012], [0.036, -0.032], [0.012, -0.046], [0.0095, -0.12], [0.075, -0.162], [0.075, -0.172], [-0.075, -0.172], [-0.075, -0.162], [-0.0095, -0.12], [-0.012, -0.046], [-0.036, -0.032], [-0.036, -0.012]];
  const RAIL_COLORS = [col('#e6e3dc'), col('#a8a298'), col('#a8a298'), col('#948e84'), col('#948e84'), col('#867f75'), col('#6f6a62'), col('#6f6a62'), col('#6f6a62'), col('#867f75'), col('#948e84'), col('#948e84'), col('#a8a298'), col('#a8a298')];
  const WHITE = [1, 1, 1];
  const mark = () => mat('mark', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

  function shifted(profile, dx) {
    return profile.map((p) => [p[0] + dx, p[1]]);
  }

  /* LUXTRAM rails: embedded grooved rails must stay visible where a road crosses (the road surface sits a few cm above the track
     formation), so the tram rails sit RAIL_LIFT above the track height and use strong negative polygon offsets; the crossing / street
     paving strip lies between the road surface and the rails. */
  const RAIL_LIFT = 0.05;
  const PAVE_LIFT = 0.035;
  const tramSteel = () => mat('steelTram', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.72, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
  const tramGroove = () => mat('grooveTram', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  const tramPaveMat = () => mat('paveTram', () => new T.MeshStandardMaterial({ map: tex.tramPave(), vertexColors: true, roughness: 0.9, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const lifted = (profile, dx) => profile.map((p) => [p[0] + dx, p[1] + RAIL_LIFT]);

  /* Rails (and the street paving) of the player's track and of the opposite track. Both tracks sweep the chunk's own frames, so the
     rails and the wires of addTramOcs share their sample points. */
  function addTramRails(ctx) {
    const { sets, track } = ctx;
    const steel = sets.get('steelTram', tramSteel);
    const groove = sets.get('grooveTram', tramGroove);
    const dark = [col('#222426')];
    const one = (frames) => {
      if (!frames || frames.length < 2) return;
      [-RAIL_X, RAIL_X].forEach((x) => {
        sweep(steel, frames, lifted(RAIL_PROFILE, x), RAIL_COLORS, { closed: true });
        sweep(groove, frames, [[x - Math.sign(x) * 0.075, RAIL_LIFT - 0.012], [x - Math.sign(x) * 0.036, RAIL_LIFT - 0.012]].sort((a, b) => a[0] - b[0]), dark, { uvU: 1, uvV: 1 });
      });
    };
    one(ctx.frames);
    one(ctx.frames2);
    // street paving between / beside the rails wherever the line runs embedded in a road (not on the grass track)
    const lt = track.luxtram;
    if (!lt || !lt.segs) return;
    const pave = sets.get('paveTram', tramPaveMat);
    const strip = (frames) => { if (frames && frames.length > 1) sweep(pave, frames, [[-1.75, PAVE_LIFT], [1.75, PAVE_LIFT]], WHITE, { uvU: 1 / 2, uvV: 1 / 2 }); };
    lt.segs.forEach((sg) => {
      if (sg.surf === 0) return;
      const a = Math.max(ctx.s0, sg.s0);
      const b = Math.min(ctx.s1, sg.s1);
      if (b - a < 1) return;
      strip(makeFrames(track, a, b, TRAM_SWEEP_STEP));
      if (track.opposite) {
        const a2 = Math.max(a, track.opposite.from);
        const b2 = Math.min(b, track.opposite.to);
        if (b2 - a2 >= 1) strip(makeFramesF(track.opposite.frameAt, a2, b2, TRAM_SWEEP_STEP));
      }
    });
  }

  function addBed(ctx) {
    const { sets, frames, kind } = ctx;
    if (kind === 'tram') return addTramStreet(ctx);
    sweep(sets.get('ballast', () => M.tex('ballast', tex.ballast())), frames,
      [[-3.5, -0.52], [-2.0, -0.25], [2.0, -0.25], [3.5, -0.52]], WHITE, { uvU: 1 / 3, uvV: 1 / 3 });
    const steel = sets.get('steel', M.steel);
    [-RAIL_X, RAIL_X].forEach((x) => sweep(steel, frames, shifted(RAIL_PROFILE, x), RAIL_COLORS, { closed: true }));
    const trough = sets.get('vc', M.vc);
    [-1, 1].forEach((sd) => sweep(trough, frames, [[sd * 2.4, -0.1], [sd * 2.75, -0.1], [sd * 2.75, -0.45], [sd * 2.4, -0.45]].map((p) => p), [col('#a9a69f'), col('#908d87'), col('#908d87'), col('#908d87')], { closed: sd > 0 ? true : true, flip: sd < 0 }));
  }

  function addSleepers(ctx) {
    const { track, q, s0, s1, origin, group } = ctx;
    if (ctx.kind === 'tram') return;
    const step = q.sleeperStep;
    const count = Math.floor((s1 - s0) / step);
    if (count < 1) return;
    const inst = new T.InstancedMesh(ctx.env.sleeperGeo, ctx.env.sleeperMat, count);
    const f = track.frameAt(s0);
    const dummy = new T.Object3D();
    for (let i = 0; i < count; i++) {
      track.frameAt(s0 + (i + 0.5) * step, f);
      dummy.position.set(f.pos.x - origin.x, f.pos.y - 0.27 - origin.y, f.pos.z - origin.z);
      dummy.rotation.set(0, -Math.atan2(f.tangent.x, -f.tangent.z), 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.position.copy(origin);
    inst.receiveShadow = true;
    inst.frustumCulled = true;
    inst.computeBoundingSphere();
    group.add(inst);
    ctx.instanced.push(inst);
  }

  function addTramStreet(ctx) {
    const { sets, frames } = ctx;
    if (ctx.track.noStreet) return addTramRails(ctx); // LUXTRAM: the real route draws its own bed/roads (luxtram-world.js); we add both tracks' rails
    const asphalt = sets.get('asphalt', () => M.tex('asphalt', tex.asphalt()));
    sweep(asphalt, frames, [[-4.6, -0.03], [4.6, -0.03]], WHITE, { uvU: 1 / 4, uvV: 1 / 4 });
    const pave = sets.get('tramPave', () => M.tex('tramPave', tex.tramPave()));
    sweep(pave, frames, [[-1.6, -0.02], [1.6, -0.02]], WHITE, { uvU: 1 / 2, uvV: 1 / 2 });
    const walk = sets.get('sidewalk', () => M.tex('sidewalk', tex.sidewalk()));
    const vc = sets.get('vc', M.vc);
    [-1, 1].forEach((sd) => {
      sweep(walk, frames, sd > 0 ? [[4.8, 0.14], [7.0, 0.14]] : [[-7.0, 0.14], [-4.8, 0.14]], WHITE, { uvU: 1 / 2, uvV: 1 / 2 });
      sweep(vc, frames, [[sd * 4.6, -0.03], [sd * 4.8, -0.03], [sd * 4.8, 0.14], [sd * 4.6, 0.14]], [col('#b9b7b0')], { closed: true, flip: sd > 0 });
    });
    const marks = sets.get('mark', mark);
    [-1, 1].forEach((sd) => sweep(marks, frames, [[sd * 4.15, -0.02], [sd * 4.27, -0.02]], [col('#e9e7df')], { uvU: 1, uvV: 1 }));
    // grooved rails: head + dark groove band on the inside
    const steel = sets.get('steel', M.steel);
    [-RAIL_X, RAIL_X].forEach((x) => {
      sweep(steel, frames, shifted(RAIL_PROFILE, x), RAIL_COLORS, { closed: true });
      sweep(marks, frames, [[x - Math.sign(x) * 0.075, -0.012], [x - Math.sign(x) * 0.036, -0.012]].sort((a, b) => a[0] - b[0]), [col('#222426')], { uvU: 1, uvV: 1 });
    });
  }

  /* ================================================================ OCS */
  const frameTmp = { pos: new T.Vector3(), tangent: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(), grade: 0, curvature: 0 };
  function posAt(track, s, lat, dy) {
    const f = track.frameAt(s, frameTmp);
    return [f.pos.x + f.right.x * lat, f.pos.y + dy, f.pos.z + f.right.z * lat];
  }
  function inStation(track, s, pad) {
    const idx = track.stations.findIndex((st) => s >= st.platformStart - pad && s <= st.platformEnd + pad);
    return idx;
  }
  function inSteelBridge(track, s) {
    const b = track.bridgeAt(s);
    return b && b.kind === 'steel';
  }

  function addCatenary(ctx) {
    const { track, sets, q, s0, s1, kind } = ctx;
    const dark = sets.get('mast', M.vc, true);
    const wire = sets.get('wire', M.vc);
    if (kind === 'tram') return addTramOcs(ctx, dark, wire);
    const spacing = q.mastSpacing;
    const k0 = Math.ceil(s0 / spacing);
    const k1 = Math.ceil(s1 / spacing) - 1;
    const concrete = col('#a7a49e');
    const steelCol = col('#7d8286');
    const insul = col('#d8d3c4');
    const wireCol = col('#66605a');
    const copper = col('#8a6a48');
    for (let k = k0; k <= k1; k++) {
      const s = k * spacing;
      if (s > track.length + 20) break;
      const tunnelMast = track.inTunnel(s);
      const stIdx = inStation(track, s, 14);
      let sign = k % 2 === 0 ? 1 : -1;
      if (stIdx >= 0) sign = track.stations[stIdx].side === 'right' ? -1 : 1;
      const f = track.frameAt(s);
      const theta = Math.atan2(f.tangent.x, -f.tangent.z);
      const onSteel = inSteelBridge(track, s);
      const crossing = track.crossings.some((c) => Math.abs(c.s - s) < 7);
      if (!tunnelMast && !onSteel && !crossing) {
        const base = posAt(track, s, sign * MAST_X, 0);
        dark.box(base[0], base[1] - 0.3, base[2], 0.62, 0.5, 0.62, concrete, -theta);
        dark.box(base[0], base[1] - 0.05 + MAST_H / 2, base[2], 0.2, MAST_H, 0.3, steelCol, -theta);
        const top = posAt(track, s, sign * MAST_X, 6.55);
        const tip = posAt(track, s, sign * 0.1, 6.4);
        dark.between(top, tip, 0.07, steelCol);
        dark.between(posAt(track, s, sign * MAST_X, 5.5), posAt(track, s, sign * 1.5, 6.4), 0.05, steelCol);
        const i1 = posAt(track, s, sign * (MAST_X - 0.3), 6.4);
        const i2 = posAt(track, s, sign * (MAST_X - 0.3), 6.7);
        dark.between(i1, i2, 0.1, insul);
        const stag = 0.2 * (k % 2 === 0 ? 1 : -1);
        dark.between(posAt(track, s, sign * 0.1, 6.3), posAt(track, s, stag, CONTACT_H + 0.02), 0.04, steelCol);
      }
      // wires of the span [s, s+spacing]
      const segs = 6;
      const stagA = 0.2 * (k % 2 === 0 ? 1 : -1);
      let prevC = null;
      let prevM = null;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        const sj = s + u * spacing;
        const lat = stagA * (1 - 2 * u);
        const c = posAt(track, sj, lat, CONTACT_H);
        const mY = MESSENGER_H - 1.05 * 4 * u * (1 - u);
        const m = posAt(track, sj, 0, mY);
        if (prevC) {
          wire.between(prevC, c, 0.035, copper);
          const spanTunnel = tunnelMast || track.inTunnel(s + spacing) || inSteelBridge(track, s) || inSteelBridge(track, s + spacing);
          if (q.messenger && !spanTunnel) wire.between(prevM, m, 0.03, wireCol);
          if (q.droppers && !spanTunnel && j < segs) wire.between(c, posAt(track, sj, 0, mY - 0.02), 0.012, wireCol);
        }
        prevC = c;
        prevM = m;
      }
    }
  }

  /* LUXTRAM overhead line, one contact wire per track. The wire polyline uses the very sample points of the rails (ctx.frames /
     ctx.frames2, 2 m apart) so it always runs exactly above the track's centreline (only the +-0.12 m zig-zag stagger of a real
     contact wire is added). Masts stand beside the outer edge of each track (behind the platform at stops) and carry a cantilever
     arm + steady arm to the wire; a thin messenger wire with droppers hangs between the masts. No wire where the line is
     catenary-free (track.noOcs). */
  const TRAM_WIRE_H = 5.6;
  const TRAM_MAST_SPACING = 36;
  const TRAM_STAGGER = 0.12;
  function tramStagger(s) {
    const k = Math.floor(s / TRAM_MAST_SPACING + 1e-9);
    const u = s / TRAM_MAST_SPACING - k;
    return (k % 2 === 0 ? 1 : -1) * TRAM_STAGGER * (1 - 2 * u);
  }
  function tramMastLat(track, s, side) {
    // side +1 = right of the player's track, -1 = left of the opposite track (outer side of the double track)
    const idx = inStation(track, s, 8);
    if (idx >= 0) {
      const st = track.stations[idx];
      if (st.kind === 'island') return 3.45;   // the island lies between the tracks: the masts keep to the outer sides
      const ours = st.side === 'right' ? 1 : -1;
      if (side === 1 && ours === 1) return st.edge + st.width + 0.55;
      if (side === -1 && st.kind !== 'island' && ours === 1) return st.edge + st.width + 0.55;   // the opposite track's own side platform
    }
    return 3.45;
  }
  function addTramOcs(ctx, dark, wire) {
    const { track, s0, s1, q } = ctx;
    const poleCol = col('#4f565c');
    const copper = col('#8a6a48');
    const messCol = col('#66605a');
    const noOcs = (s) => !!(track.noOcs && track.noOcs(s));
    const H = TRAM_WIRE_H;

    const wireRun = (frames, label) => {
      if (!frames || frames.length < 2) return;
      const pt = (f, dy) => { const st = tramStagger(f.s); return [f.x + f.rx * st, f.y + dy, f.z + f.rz * st]; };
      for (let i = 0; i + 1 < frames.length; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        if (noOcs(a.s) || noOcs(b.s)) continue;
        wire.between(pt(a, H), pt(b, H), 0.035, copper);
        if (ctx.env.ocsLog) ctx.env.ocsLog.push({ kind: 'wire', track: label, s: a.s, p: pt(a, H), c: [a.x, a.y, a.z] });
        if (q.messenger) {
          // messenger wire: high at the masts, close to the contact wire mid-span; droppers every 6 m
          const mY = (f) => { const u = (f.s / TRAM_MAST_SPACING) - Math.floor(f.s / TRAM_MAST_SPACING + 1e-9); return H + 0.12 + 0.6 * Math.pow(Math.abs(1 - 2 * u), 2); };
          wire.between(pt(a, mY(a)), pt(b, mY(b)), 0.022, messCol);
          if (q.droppers && Math.round(a.s) % 6 === 0) wire.between(pt(a, H), pt(a, mY(a) - 0.02), 0.012, messCol);
        }
      }
    };
    wireRun(ctx.frames, 'player');
    wireRun(ctx.frames2, 'opposite');

    const mast = (frameAt, s, side) => {
      const f = frameAt(s);
      const lat = side * tramMastLat(track, s, side);
      const theta = Math.atan2(f.tangent.x, -f.tangent.z);
      const P = (l, dy) => [f.pos.x + f.right.x * l, f.pos.y + dy, f.pos.z + f.right.z * l];
      const st = tramStagger(s);
      const base = P(lat, 0.14);
      if (ctx.env.ocsLog) ctx.env.ocsLog.push({ kind: 'mast', track: side === 1 ? 'player' : 'opposite', s, lat: Math.abs(lat), p: base, c: [f.pos.x, f.pos.y, f.pos.z] });
      dark.box(base[0], base[1] + 3.6, base[2], 0.22, 7.4, 0.22, poleCol, -theta);
      dark.box(base[0], base[1] + 0.2, base[2], 0.5, 0.4, 0.5, col('#a7a49e'), -theta);
      const top = P(lat, 6.75);
      const tip = P(st, H + 0.65);
      dark.between(top, tip, 0.07, poleCol);                                  // cantilever arm
      dark.between(P(lat, 5.75), P(lat + (st - lat) * 0.55, H + 0.55), 0.045, poleCol);   // brace
      dark.between(tip, P(st, H + 0.04), 0.04, poleCol);                     // steady arm down to the contact wire
    };
    const k0 = Math.ceil(s0 / TRAM_MAST_SPACING);
    const k1 = Math.ceil(s1 / TRAM_MAST_SPACING) - 1;
    for (let k = k0; k <= k1; k++) {
      const s = k * TRAM_MAST_SPACING;
      if (s <= track.length + 10 && !noOcs(s) && !track.inTunnel(s)) mast(track.frameAt, s, 1);
    }
    if (track.opposite) {
      const opp = track.opposite;
      const j0 = Math.ceil((s0 - TRAM_MAST_SPACING / 2) / TRAM_MAST_SPACING);
      const j1 = Math.ceil((s1 - TRAM_MAST_SPACING / 2) / TRAM_MAST_SPACING) - 1;
      for (let k = j0; k <= j1; k++) {
        const s = k * TRAM_MAST_SPACING + TRAM_MAST_SPACING / 2;
        if (s >= s0 && s < s1 && opp.has(s) && !noOcs(s) && !track.inTunnel(s)) mast(opp.frameAt, s, -1);
      }
    }
  }

  /* ============================================================== boards */
  function lateralFree(track, s) {
    if (track.kind === 'tram') return 1;   // the left side of a tram track is the opposite track: boards and signals stand on the right
    const idx = inStation(track, s, 22);
    if (idx >= 0) return track.stations[idx].side === 'right' ? -1 : 1;
    return 1;
  }

  function addLimitBoards(ctx) {
    const { track, sets, s0, s1 } = ctx;
    const post = sets.get('mast', M.vc, true);
    track.limits.forEach((lim) => {
      if (lim.s < s0 || lim.s >= s1) return;
      const sd = ctx.kind === 'tram' ? 1 : lateralFree(track, lim.s);   // tram: right of the track (the left side is the opposite track)
      let lat = sd * (ctx.kind === 'tram' ? 4.7 : 2.95);
      if (ctx.kind === 'tram') { const si = inStation(track, lim.s, 4); if (si >= 0 && track.stations[si].side === 'right' && track.stations[si].kind !== 'island') lat = track.stations[si].edge + track.stations[si].width + 0.45; }
      const f = track.frameAt(lim.s);
      const th = [f.tangent.x, 0, f.tangent.z];
      const tl = Math.hypot(th[0], th[2]) || 1;
      const nrm = [-th[0] / tl, 0, -th[2] / tl];
      const base = posAt(track, lim.s, lat, ctx.kind === 'tram' ? 0.14 : -0.2);
      post.box(base[0], base[1] + 1.2, base[2], 0.09, 2.5, 0.09, col('#6c7075'), -Math.atan2(f.tangent.x, -f.tangent.z));
      const batch = sets.get('limit:' + lim.kmh, () => M.tex('limit' + lim.kmh, limitTexture(lim.kmh), {}));
      const r = [f.right.x, 0, f.right.z];
      const hw = 0.55;
      const hh = 0.69;
      const cy = base[1] + 2.7;
      const P = (a, b) => [base[0] + r[0] * hw * a, cy + hh * b, base[2] + r[2] * hw * a];
      batch.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), nrm, WHITE, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      // thin dark back so the board is not paper thin
      const back = sets.get('mast', M.vc, true);
      back.box(base[0] - nrm[0] * 0.03, cy, base[2] - nrm[2] * 0.03, 1.12, 1.4, 0.03, col('#202226'), -Math.atan2(f.tangent.x, -f.tangent.z));
    });
  }

  function addDistantBoards(ctx) {
    const { track, sets, s0, s1 } = ctx;
    if (ctx.kind === 'tram') return;
    const post = sets.get('mast', M.vc, true);
    track.signals.forEach((sig) => {
      const s = sig.s - 320;
      if (s < s0 || s >= s1 || s < 5 || track.inTunnel(s) || track.bridgeAt(s)) return;
      const sd = lateralFree(track, s);
      const base = posAt(track, s, sd * 3.5, -0.2);
      const f = track.frameAt(s);
      const th = -Math.atan2(f.tangent.x, -f.tangent.z);
      post.box(base[0], base[1] + 1.1, base[2], 0.08, 2.3, 0.08, col('#6c7075'), th);
      post.box(base[0], base[1] + 2.5, base[2], 0.84, 0.84, 0.04, col('#16181a'), th, 0, Math.PI / 4);
      post.box(base[0], base[1] + 2.5, base[2], 0.7, 0.7, 0.05, col('#f0b400'), th, 0, Math.PI / 4);
      post.box(base[0], base[1] + 2.5, base[2], 0.34, 0.34, 0.06, col('#16181a'), th, 0, Math.PI / 4);
    });
  }

  function addLineFence(ctx) {
    const { track, sets, s0, s1 } = ctx;
    if (ctx.kind !== 'hst') return;
    const post = sets.get('mast', M.vc);
    const panel = sets.get('wire', M.vc);
    const step = 12.5;
    for (let s = Math.ceil(s0 / step) * step; s < s1; s += step) {
      if (track.inTunnel(s) || track.bridgeAt(s) || inStation(track, s, 30) >= 0) continue;
      [-1, 1].forEach((sd) => {
        const a = posAt(track, s, sd * 5.4, -0.45);
        const b = posAt(track, s + step, sd * 5.4, -0.45);
        const f = track.frameAt(s);
        post.box(a[0], a[1] + 0.9, a[2], 0.1, 1.8, 0.1, col('#6e757b'), -Math.atan2(f.tangent.x, -f.tangent.z));
        [0.35, 0.8, 1.3, 1.7].forEach((h) => panel.between([a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.025, col('#9aa0a6')));
      });
    }
  }

  function addKmPosts(ctx) {
    const { track, sets, s0, s1 } = ctx;
    const post = sets.get('mast', M.vc);
    const first = Math.ceil(s0 / 500);
    for (let k = first; k * 500 < s1; k++) {
      const s = k * 500;
      if (s > track.length || track.inTunnel(s) || track.bridgeAt(s)) continue;
      const sd = ctx.kind === 'tram' ? 1 : -lateralFree(track, s);
      const si = ctx.kind === 'tram' ? inStation(track, s, 4) : -1;
      const p = posAt(track, s, sd * (ctx.kind === 'tram' ? (si >= 0 && track.stations[si].kind !== 'island' ? track.stations[si].edge + track.stations[si].width + 0.9 : 5.6) : 3.1), ctx.kind === 'tram' ? 0.14 : -0.3);
      const f = track.frameAt(s);
      const th = -Math.atan2(f.tangent.x, -f.tangent.z);
      post.box(p[0], p[1] + 0.5, p[2], 0.14, 1.0, 0.1, col('#e8e6de'), th);
      post.box(p[0], p[1] + 0.92, p[2], 0.15, 0.2, 0.11, col('#1a1b1d'), th);
    }
  }

  /* ============================================================== signals */
  const LAMP_ON = { red: '#ff3524', yellow: '#ffc61e', green: '#2bff74' };
  const LAMP_OFF = { red: '#3b0d09', yellow: '#3b300a', green: '#0a3b19' };
  const LAMP_ORDER = ['red', 'yellow', 'green'];
  const lampMat = (name, on) => mat('lamp:' + name + on, () => new T.MeshBasicMaterial({ color: on ? LAMP_ON[name] : LAMP_OFF[name] }));
  const LAMP_GEO = new T.CircleGeometry(0.13, 18);

  function buildSignal(env, track, sig, index, aspect) {
    const f = track.frameAt(sig.s);
    const group = new T.Group();
    const lat = 3.9;
    const sd = lateralFree(track, sig.s);
    group.position.set(f.pos.x + f.right.x * lat * sd, f.pos.y, f.pos.z + f.right.z * lat * sd);
    group.rotation.y = -Math.atan2(f.tangent.x, -f.tangent.z);
    const local = new Batch(new T.Vector3());
    local.box(0, 1.9, 0, 0.17, 4.9, 0.17, col('#7b8086'));
    local.box(0, -0.35, 0, 0.5, 0.4, 0.5, col('#a7a49e'));
    local.box(0, 4.0, 0.02, 0.58, 1.7, 0.3, col('#17181a'));
    local.box(0, 4.0, 0.0, 0.7, 1.82, 0.2, col('#e9e6dc'));
    local.box(0, 4.0, 0.06, 0.58, 1.7, 0.3, col('#17181a'));
    [4.55, 4.0, 3.45].forEach((y) => local.box(0, y + 0.1, 0.22, 0.34, 0.06, 0.2, col('#111214')));
    local.box(0, 1.2, 0.1, 0.42, 0.32, 0.03, col('#f0efe6'));
    local.box(0, 1.2, 0.115, 0.26, 0.05, 0.03, col('#1a1b1d'));
    const mastMesh = local.mesh(M.vc(), env.q.castAll, true);
    group.add(mastMesh);
    const lamps = LAMP_ORDER.map((name, i) => {
      const m = new T.Mesh(LAMP_GEO, lampMat(name, name === aspect));
      m.position.set(0, 4.55 - i * 0.55, 0.325);
      group.add(m);
      return m;
    });
    const halo = new T.Sprite(new T.SpriteMaterial({ map: haloTex(), blending: T.AdditiveBlending, transparent: true, depthWrite: false, color: LAMP_ON[aspect] }));
    halo.scale.set(1.5, 1.5, 1);
    halo.position.set(0, 4.55 - LAMP_ORDER.indexOf(aspect) * 0.55, 0.45);
    group.add(halo);
    const api = {
      group,
      setAspect(a) {
        LAMP_ORDER.forEach((name, i) => { lamps[i].material = lampMat(name, name === a); });
        halo.material.color.set(LAMP_ON[a]);
        halo.position.y = 4.55 - LAMP_ORDER.indexOf(a) * 0.55;
      },
      dispose() { mastMesh.geometry.dispose(); halo.material.dispose(); },
    };
    return api;
  }

  /* ============================================================= tunnels */
  const TUNNEL_R = 3.5;
  const TUNNEL_CY = 2.4;
  const TUNNEL_PROFILE = (() => {
    const pts = [[TUNNEL_R, FORM_Y], [TUNNEL_R, TUNNEL_CY]];
    for (let i = 1; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      pts.push([TUNNEL_R * Math.cos(t), TUNNEL_CY + TUNNEL_R * Math.sin(t)]);
    }
    pts.push([-TUNNEL_R, FORM_Y]);
    return pts;
  })();

  function portalGeometry(env) {
    if (env.portalGeo) return env.portalGeo;
    const depth = 2.2;
    const wall = new T.Shape();
    wall.moveTo(-6.6, FORM_Y);
    wall.lineTo(6.6, FORM_Y);
    wall.lineTo(6.6, 9.6);
    wall.lineTo(-6.6, 9.6);
    wall.closePath();
    const hole = new T.Path();
    hole.moveTo(-3.7, FORM_Y);
    hole.lineTo(-3.7, TUNNEL_CY);
    hole.absarc(0, TUNNEL_CY, 3.7, Math.PI, 0, true);
    hole.lineTo(3.7, FORM_Y);
    hole.closePath();
    wall.holes.push(hole);
    const wallGeo = new T.ExtrudeGeometry(wall, { depth, bevelEnabled: false, curveSegments: 14 });
    wallGeo.translate(0, 0, -depth);
    const ring = new T.Shape();
    ring.moveTo(3.7, FORM_Y);
    ring.lineTo(4.35, FORM_Y);
    ring.lineTo(4.35, TUNNEL_CY);
    ring.absarc(0, TUNNEL_CY, 4.35, 0, Math.PI, false);
    ring.lineTo(-4.35, FORM_Y);
    ring.lineTo(-3.7, FORM_Y);
    ring.lineTo(-3.7, TUNNEL_CY);
    ring.absarc(0, TUNNEL_CY, 3.7, Math.PI, 0, true);
    ring.closePath();
    const ringGeo = new T.ExtrudeGeometry(ring, { depth: 0.4, bevelEnabled: false, curveSegments: 14 });
    ringGeo.translate(0, 0, 0.35 - 0.4 + 0.05);
    env.portalGeo = { wallGeo, ringGeo };
    return env.portalGeo;
  }

  function addPortal(ctx, s, entry) {
    const { track, sets, env } = ctx;
    const f = track.frameAt(s);
    const th = Math.atan2(f.tangent.x, -f.tangent.z);
    const yaw = entry ? -th : -th + Math.PI;
    const { wallGeo, ringGeo } = portalGeometry(env);
    const m = new T.Matrix4().compose(f.pos.clone(), new T.Quaternion().setFromEuler(new T.Euler(0, yaw, 0)), new T.Vector3(1, 1, 1));
    const concrete = sets.get('concrete', () => M.tex('concrete', tex.concrete()), true);
    concrete.geom(wallGeo, m, col('#b4b1aa'), 0.2);
    const stone = sets.get('stone', () => M.tex('stone', tex.stone()), true);
    stone.geom(ringGeo, m, col('#e6dcc4'), 0.25);
    // wing walls
    const wing = sets.get('concrete', () => M.tex('concrete', tex.concrete()), true);
    const dirOut = entry ? -1 : 1;
    [-1, 1].forEach((sd) => {
      const a = posAt(track, s, sd * 6.5, 0);
      const bOff = posAt(track, s + dirOut * 7, sd * 12.5, 0);
      wing.between([a[0], a[1] + 4.2, a[2]], [bOff[0], bOff[1] + 3.5, bOff[2]], 0.9, col('#a9a69f'), 8.4);
    });
    // number plate / lamp
    const glow = sets.get('glow', M.glow);
    const lamp = posAt(track, s + (entry ? -0.2 : 0.2), 0, 7.4);
    glow.box(lamp[0], lamp[1], lamp[2], 0.3, 0.3, 0.3, col('#ffe9b0'));
  }

  function addTunnel(ctx, tn) {
    const { track, sets, q, s0, s1 } = ctx;
    const a = Math.max(s0, tn.s0);
    const b = Math.min(s1, tn.s1);
    if (b <= a) return;
    const frames = makeFrames(track, a, b, q.sweepStep);
    sweep(sets.get('lining', M.lining), frames, TUNNEL_PROFILE, WHITE, { uvU: 1 / 3, uvV: 1 / 3 });
    // lamps and wire hangers
    const glow = sets.get('glow', M.glow);
    const hang = sets.get('wire', M.vc);
    const first = Math.ceil(a / 14) * 14;
    for (let s = first; s < b - 1; s += 14) {
      [-1, 1].forEach((sd) => {
        const p = posAt(track, s, sd * 3.38, 3.4);
        const f = track.frameAt(s);
        glow.box(p[0], p[1], p[2], 0.1, 0.14, 1.4, col('#ffe7b2'), -Math.atan2(f.tangent.x, -f.tangent.z));
      });
      hang.between(posAt(track, s, 0, TUNNEL_CY + TUNNEL_R - 0.05), posAt(track, s, 0, CONTACT_H), 0.05, col('#5b5d60'));
    }
    if (tn.s0 >= s0 && tn.s0 < s1) addPortal(ctx, tn.s0, true);
    if (tn.s1 > s0 && tn.s1 <= s1) addPortal(ctx, tn.s1, false);
  }

  /* ============================================================== bridges */
  const STONE = col('#f2e8d2');
  const RED = col('#b3211b');
  const RED_DARK = col('#8d1a16');

  function archGeometry(env, pitch) {
    const key = 'arch' + pitch.toFixed(2);
    if (env.geoCache.has(key)) return env.geoCache.get(key);
    const r = (pitch - 3) / 2;
    const h = r + 1.3;
    const shape = new T.Shape();
    shape.moveTo(-pitch / 2, 0);
    shape.lineTo(-r, 0);
    shape.absarc(0, 0, r, Math.PI, 0, true);
    shape.lineTo(pitch / 2, 0);
    shape.lineTo(pitch / 2, h);
    shape.lineTo(-pitch / 2, h);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: 7.6, bevelEnabled: false, curveSegments: 12 });
    geo.translate(0, 0, -3.8);
    const out = { geo, h, r };
    env.geoCache.set(key, out);
    return out;
  }

  function groundBelow(track, x, z, extra) {
    return track.terrainHeightAt(x, z) - (extra || 0);
  }

  function addBridge(ctx, br) {
    const { track, sets, q, s0, s1, kind } = ctx;
    const a = Math.max(s0, br.s0);
    const b = Math.min(s1, br.s1);
    if (b <= a) return;
    const frames = makeFrames(track, a, b, q.sweepStep);
    const isTram = kind === 'tram';
    const half = br.kind === 'steel' ? (isTram ? 7.4 : 3.65) : isTram ? 7.4 : 3.85;
    const stone = sets.get('stone', () => M.tex('stone', tex.stone()), true);
    const steel = sets.get('steel', M.steel);
    if (br.kind === 'steel') {
      sweep(steel, frames, [[-half, -0.5], [half, -0.5], [half, -1.6], [-half, -1.6]], [col('#7a1814'), col('#7a1814'), col('#5c110e'), col('#7a1814')], { closed: true });
      addSteelTruss(ctx, br, a, b, isTram ? 7.45 : 3.75, isTram ? 6.2 : 7.2);
    } else {
      const body = br.kind === 'viaduct' ? stone : sets.get('concrete', () => M.tex('concrete', tex.concrete()), true);
      sweep(body, frames, [[-half, -0.5], [half, -0.5], [half, -1.7], [-half, -1.7]], br.kind === 'viaduct' ? [col('#f0e6cf')] : [col('#c9c6bf')], { closed: true, uvU: 1 / 3, uvV: 1 / 3 });
      [[-half - 0.05, -half + 0.28], [half - 0.28, half + 0.05]].forEach(([l, r]) => sweep(body, frames, [[l, 0.6], [r, 0.6], [r, -0.5], [l, -0.5]], [col('#efe3c8')], { closed: true, uvU: 1 / 3, uvV: 1 / 3 }));
      addBridgePiers(ctx, br, half);
    }
  }

  function addBridgePiers(ctx, br, half) {
    const { track, sets, s0, s1, env } = ctx;
    const len = br.s1 - br.s0;
    const body = br.kind === 'viaduct' ? sets.get('stone', () => M.tex('stone', tex.stone()), true) : sets.get('concrete', () => M.tex('concrete', tex.concrete()), true);
    const spans = Math.max(1, Math.round(len / (br.kind === 'viaduct' ? 22 : 18)));
    const pitch = len / spans;
    for (let i = 0; i <= spans; i++) {
      const s = br.s0 + i * pitch;
      const center = i < spans ? s + pitch / 2 : null;
      const f = track.frameAt(s);
      const th = Math.atan2(f.tangent.x, -f.tangent.z);
      // pier at s (interior piers only)
      if (i > 0 && i < spans && s >= s0 && s < s1) {
        const x = f.pos.x;
        const z = f.pos.z;
        const foot = Math.min(groundBelow(track, x, z, 1.2), groundBelow(track, x + f.right.x * 4, z + f.right.z * 4, 1.2));
        const top = f.pos.y - 1.7 - (br.kind === 'viaduct' ? archGeometry(env, pitch).h : 0);
        if (top > foot + 0.5) {
          body.box(x, (top + foot) / 2, z, br.kind === 'viaduct' ? 3.0 : 1.1, top - foot, br.kind === 'viaduct' ? 7.6 : 5.6, br.kind === 'viaduct' ? STONE : col('#aeaba4'), -th + Math.PI / 2);
        }
      }
      if (br.kind === 'viaduct' && center !== null && center >= s0 && center < s1) {
        const { geo, h } = archGeometry(env, pitch);
        const fc = track.frameAt(center);
        const thc = Math.atan2(fc.tangent.x, -fc.tangent.z);
        const m = new T.Matrix4().compose(new T.Vector3(fc.pos.x, fc.pos.y - 1.7 - h, fc.pos.z), new T.Quaternion().setFromEuler(new T.Euler(0, Math.PI / 2 - thc, 0)), new T.Vector3(1, 1, 1));
        body.geom(geo, m, STONE, 0.25);
      }
    }
  }

  function addSteelTruss(ctx, br, a, b, lat, topH) {
    const { track, sets, q } = ctx;
    const steel = sets.get('truss', () => mat('truss', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 })));
    const len = br.s1 - br.s0;
    const panels = Math.max(2, Math.round(len / 7));
    const pitch = len / panels;
    const bot = -0.95;
    for (let i = 0; i <= panels; i++) {
      const s = br.s0 + i * pitch;
      if (s < a - pitch || s > b + 0.01) continue;
      if (s >= a - 0.001) {
        [-1, 1].forEach((sd) => steel.between(posAt(track, s, sd * lat, bot), posAt(track, s, sd * lat, topH), 0.3, RED, 0.34));
        steel.between(posAt(track, s, -lat, topH), posAt(track, s, lat, topH), 0.34, RED_DARK, 0.36);
        steel.between(posAt(track, s, -lat, bot), posAt(track, s, lat, bot), 0.4, RED_DARK, 0.5);
        if (!ctx.isTramKind && q.droppers) steel.between(posAt(track, s, 0, topH), posAt(track, s, 0, CONTACT_H + 0.05), 0.04, col('#555'));
      }
      if (i < panels) {
        const s2 = s + pitch;
        if (s2 < a - 0.001 || s > b) continue;
        [-1, 1].forEach((sd) => {
          steel.between(posAt(track, s, sd * lat, topH), posAt(track, s2, sd * lat, topH), 0.44, RED);
          steel.between(posAt(track, s, sd * lat, bot), posAt(track, s2, sd * lat, bot), 0.44, RED);
          const up = i % 2 === 0;
          steel.between(posAt(track, s, sd * lat, up ? bot : topH), posAt(track, s2, sd * lat, up ? topH : bot), 0.26, RED_DARK);
        });
      }
    }
    // trestle piers
    const piers = len > 120 ? [0.33, 0.67] : [0.5];
    piers.forEach((u) => {
      const s = br.s0 + u * len;
      if (s < ctx.s0 || s >= ctx.s1) return;
      const f = track.frameAt(s);
      const th = Math.atan2(f.tangent.x, -f.tangent.z);
      const yTop = f.pos.y - 1.5;
      const legs = [];
      [-1, 1].forEach((sl) => [-1, 1].forEach((sa) => {
        const topP = posAt(track, s + sa * 1.2, sl * 2.4, -1.5);
        const gx = topP[0] + f.right.x * sl * 3.2 + f.tangent.x * sa * 3.4;
        const gz = topP[2] + f.right.z * sl * 3.2 + f.tangent.z * sa * 3.4;
        const foot = groundBelow(track, gx, gz, 1.0);
        legs.push({ top: topP, foot: [gx, foot, gz] });
        steel.between(topP, [gx, foot, gz], 0.7, RED, 0.7);
      }));
      const levels = Math.max(2, Math.round((yTop - Math.min(...legs.map((l) => l.foot[1]))) / 7));
      for (let k = 1; k < levels; k++) {
        const t = k / levels;
        const pts = legs.map((l) => [l.top[0] + (l.foot[0] - l.top[0]) * t, l.top[1] + (l.foot[1] - l.top[1]) * t, l.top[2] + (l.foot[2] - l.top[2]) * t]);
        // legs order: (-1,-1),(-1,1),(1,-1),(1,1)
        [[0, 1], [2, 3], [0, 2], [1, 3]].forEach(([i, j]) => steel.between(pts[i], pts[j], 0.4, RED_DARK));
        const t2 = (k + 1) / levels;
        const pts2 = legs.map((l) => [l.top[0] + (l.foot[0] - l.top[0]) * Math.min(1, t2), l.top[1] + (l.foot[1] - l.top[1]) * Math.min(1, t2), l.top[2] + (l.foot[2] - l.top[2]) * Math.min(1, t2)]);
        [[0, 3], [1, 2]].forEach(([i, j]) => steel.between(pts[i], pts2[j], 0.3, RED_DARK));
      }
      steel.box(f.pos.x, yTop - 0.3, f.pos.z, 2.2, 0.8, 8.4, RED_DARK, -th + Math.PI / 2);
    });
  }

  /* ================================================================ crossings */
  const CAR_COLORS = ['#c9c9c6', '#25354a', '#8c1f24', '#2e5a3a', '#d7d2c4', '#1d1f22'];
  const lampDisc = (on) => mat('xlamp' + on, () => new T.MeshBasicMaterial({ color: on ? 0xff2a1a : 0x2e0a07 }));

  function armGeometry(env, dir) {
    const key = 'arm' + dir;
    if (env.geoCache.has(key)) return env.geoCache.get(key);
    const b = new Batch();
    const L = 3.3;
    for (let i = 0; i < 6; i++) b.box(0, 0, dir * (0.275 + i * 0.55), 0.09, 0.09, 0.55, i % 2 ? col('#f2f0ea') : col('#d12a20'));
    b.box(0, 0, -dir * 0.3, 0.14, 0.22, 0.6, col('#222426'));
    const geo = b.mesh(M.vc()).geometry;
    env.geoCache.set(key, geo);
    return geo;
  }

  function buildCrossing(env, track, cr, closed) {
    const f = track.frameAt(cr.s);
    const group = new T.Group();
    group.position.copy(f.pos);
    group.rotation.y = -Math.atan2(f.tangent.x, -f.tangent.z);
    const local = new BatchSet(new T.Vector3());
    // road with ramp profile (lateral = local x)
    const road = local.get('asphalt', () => M.tex('asphalt', tex.asphalt()));
    const prof = [[-CROSSING_ROAD_HALF, FORM_Y + 0.03], [-12, FORM_Y + 0.03], [-4.6, -0.05], [4.6, -0.05], [12, FORM_Y + 0.03], [CROSSING_ROAD_HALF, FORM_Y + 0.03]];
    for (let i = 0; i < prof.length - 1; i++) {
      const p = prof[i];
      const n2 = prof[i + 1];
      road.quad([p[0], p[1], -2.9], [n2[0], n2[1], -2.9], [n2[0], n2[1], 2.9], [p[0], p[1], 2.9], [0, 1, 0], WHITE, [[p[0] / 4, -0.7], [n2[0] / 4, -0.7], [n2[0] / 4, 0.7], [p[0] / 4, 0.7]]);
    }
    const marks = local.get('mark', mark);
    [-1, 1].forEach((sd) => {
      marks.quad([-CROSSING_ROAD_HALF, FORM_Y + 0.05, sd * 2.7], [CROSSING_ROAD_HALF, FORM_Y + 0.05, sd * 2.7], [CROSSING_ROAD_HALF, FORM_Y + 0.05, sd * 2.58], [-CROSSING_ROAD_HALF, FORM_Y + 0.05, sd * 2.58], [0, 1, 0], [0.9, 0.9, 0.86]);
    });
    const vc = local.get('vc', M.vc, true);
    const lampsA = new Batch();
    const lampsB = new Batch();
    const discGeo = new T.CircleGeometry(0.19, 14);
    [[1, -1], [1, 1], [-1, -1], [-1, 1]].forEach(([sx, sz]) => {
      const px = sx * 3.9;
      const pz = sz * 3.4;
      vc.box(px, 1.1, pz, 0.16, 3.0, 0.16, col('#e9e6dc'));
      vc.box(px, 0.5, pz, 0.17, 0.5, 0.17, col('#c8242b'));
      vc.box(px, 2.7, pz, 0.34, 1.0, 0.18, col('#1a1b1d'));
      // St Andrew's cross
      vc.between([px, 3.0, pz - 0.4], [px, 3.9, pz + 0.4], 0.08, col('#d12a20'), 0.02);
      vc.between([px, 3.0, pz + 0.4], [px, 3.9, pz - 0.4], 0.08, col('#f0eee6'), 0.02);
      vc.box(px, 1.0, pz, 0.5, 0.3, 0.4, col('#d6d3c8'));
      const m = new T.Matrix4().makeRotationY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      const place = (batch, zOff) => {
        const mm = m.clone().setPosition(px + sx * 0.1, 2.95, pz + zOff);
        batch.geom(discGeo, mm, WHITE);
      };
      place(lampsA, -0.1);
      place(lampsB, 0.1);
      // repeater lamps facing along the track so the driver sees the warning too
      [1, -1].forEach((dz) => {
        const mz = new T.Matrix4().makeRotationY(dz > 0 ? 0 : Math.PI);
        lampsA.geom(discGeo, mz.clone().setPosition(px - 0.1, 2.95, pz + dz * 0.1), WHITE);
        lampsB.geom(discGeo, mz.clone().setPosition(px + 0.1, 2.95, pz + dz * 0.1), WHITE);
      });
    });
    group.add(...local.meshes(env.q.castAll));
    const meshA = lampsA.mesh(lampDisc(false), false, false);
    const meshB = lampsB.mesh(lampDisc(false), false, false);
    group.add(meshA, meshB);
    // barrier arms
    const arms = [];
    [[1, -1], [1, 1], [-1, -1], [-1, 1]].forEach(([sx, sz]) => {
      const dir = -sz; // arm reaches towards the road centre line
      const arm = new T.Mesh(armGeometry(env, dir), M.vc());
      arm.position.set(sx * 3.9, 1.15, sz * 3.4);
      arm.userData.shared = true;
      group.add(arm);
      arms.push({ mesh: arm, dir, angle: 0 });
    });
    // waiting cars
    const rnd = mulberry(Math.floor(cr.s));
    const carB = new Batch();
    [[10, -1.4, 1], [-11, 1.4, -1]].forEach(([x, z, dirX]) => {
      const c = col(CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]);
      carB.box(x, FORM_Y + 0.75, z, 4.3, 0.75, 1.8, c);
      carB.box(x - dirX * 0.2, FORM_Y + 1.4, z, 2.3, 0.62, 1.7, c);
      carB.box(x - dirX * 0.2, FORM_Y + 1.42, z, 2.32, 0.4, 1.72, col('#22303a'));
      [[-1.4, -0.9], [-1.4, 0.9], [1.4, -0.9], [1.4, 0.9]].forEach(([ox, oz]) => carB.box(x + ox, FORM_Y + 0.33, z + oz, 0.66, 0.66, 0.24, col('#141415')));
      carB.box(x + dirX * 2.16, FORM_Y + 0.8, z, 0.05, 0.2, 1.3, col('#ffefb0'));
    });
    const cars = carB.mesh(M.vc(), false, true);
    group.add(cars);
    cars.visible = closed;
    const api = {
      group,
      closed,
      angle: 0,
      setClosed(v) {
        this.closed = v;
        cars.visible = v;
      },
      tick(now, dt) {
        const target = this.closed ? 0 : 1;
        this.angle += clamp(target - this.angle, -dt * 0.55, dt * 0.55);
        arms.forEach((a) => { a.mesh.rotation.x = this.angle * (a.dir > 0 ? -1 : 1) * (Math.PI / 2) * 0.96; });
        const phase = this.closed && Math.floor(now / BLINK_PERIOD) % 2 === 0;
        meshA.material = lampDisc(this.closed && phase);
        meshB.material = lampDisc(this.closed && !phase);
      },
      dispose() {
        group.traverse((o) => { if (o.geometry && !env.geoCache.has(o.geometry)) o.geometry.dispose(); });
      },
    };
    api.angle = closed ? 0 : 1;
    return api;
  }

  /* ================================================================ stations */
  const STYLES = {
    plaster: { wall: '#e6d9b8', trim: '#c9b88f', roof: 'slate' },
    sandstone: { wall: '#cdb48c', trim: '#b79e72', roof: 'slate' },
    brick: { wall: '#a8553f', trim: '#d8cdb4', roof: 'slate' },
    white: { wall: '#ebe8df', trim: '#b5b1a6', roof: 'slate' },
  };
  const STYLE_KEYS = Object.keys(STYLES);

  function pickStyle(name) {
    return STYLE_KEYS[hashStr(name) % STYLE_KEYS.length];
  }

  // gabled or hipped building. frontX = lateral position of the facade facing the track, back = further from the track.
  function addBuilding(sets, o) {
    const st = STYLES[o.style] || STYLES.plaster;
    const sx = o.sx; // +1 right of the track, -1 left (direction away from the track)
    const x0 = o.frontX;
    const x1 = o.frontX + sx * o.w;
    const z0 = o.cz - o.len / 2;
    const z1 = o.cz + o.len / 2;
    const y0 = FORM_Y;
    const y1 = o.h;
    const rows = o.rows || 2;
    const facade = sets.get('facade:' + o.style + rows + (o.gare ? 'g' : ''), () => M.tex('facade' + o.style + rows + (o.gare ? 'g' : ''), facadeTexture(o.gare ? 'gare' : 'house', st.wall, rows)), true);
    const plain = sets.get('plaster:' + st.wall, () => M.tex('plaster' + st.wall, tex.plaster(st.wall)), true);
    const bays = Math.max(1, Math.round(o.len / 6));
    facade.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    const back = o.sx;
    facade.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    plain.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], WHITE, [[0, 0], [2, 0], [2, 1], [0, 1]]);
    plain.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], WHITE, [[0, 0], [2, 0], [2, 1], [0, 1]]);
    const trim = sets.get('vc', M.vc, true);
    trim.box((x0 + x1) / 2, y1 + 0.1, (z0 + z1) / 2, o.w + 0.5, 0.25, o.len + 0.5, col(st.trim));
    trim.box(x0 - sx * 0.05, 0.2, (z0 + z1) / 2, 0.3, 0.9, o.len + 0.2, col(st.trim));
    const roof = sets.get('slate', () => M.tex('slate', tex.slate()), true);
    const rY = y1 + 0.22;
    const ridge = rY + o.roofH;
    const mid = (x0 + x1) / 2;
    const ov = 0.5;
    if (o.roof === 'flat') {
      trim.box(mid, y1 + 0.3, (z0 + z1) / 2, o.w + 1.2, 0.3, o.len + 1.2, col('#8d9296'));
      return;
    }
    if (o.roof === 'hip') {
      const xa = Math.min(x0, x1) - ov;
      const xb = Math.max(x0, x1) + ov;
      const za = z0 - ov;
      const zb = z1 + ov;
      const inset = (xb - xa) / 2;
      const ridge0 = [mid, ridge, za + inset];
      const ridge1 = [mid, ridge, zb - inset];
      roof.quad([xa, rY, za], [xa, rY, zb], ridge1, ridge0, [-1, 0.7, 0], WHITE, [[0, 0], [o.len / 3, 0], [o.len / 3, 3], [0, 3]]);
      roof.quad([xb, rY, zb], [xb, rY, za], ridge0, ridge1, [1, 0.7, 0], WHITE, [[0, 0], [o.len / 3, 0], [o.len / 3, 3], [0, 3]]);
      roof.tri([xa, rY, za], [xb, rY, za], ridge0, [0, 0.6, -1], col('#8a9099'));
      roof.tri([xb, rY, zb], [xa, rY, zb], ridge1, [0, 0.6, 1], col('#8a9099'));
      return;
    }
    // gable roof, ridge along z
    const xa = Math.min(x0, x1) - ov;
    const xb = Math.max(x0, x1) + ov;
    const za = z0 - ov;
    const zb = z1 + ov;
    roof.quad([xa, rY, za], [xa, rY, zb], [mid, ridge, zb], [mid, ridge, za], [-1, 1, 0], WHITE, [[0, 0], [o.len / 3, 0], [o.len / 3, 3], [0, 3]]);
    roof.quad([xb, rY, zb], [xb, rY, za], [mid, ridge, za], [mid, ridge, zb], [1, 1, 0], WHITE, [[0, 0], [o.len / 3, 0], [o.len / 3, 3], [0, 3]]);
    plain.tri([x0, y1, z0], [x1, y1, z0], [mid, ridge, z0], [0, 0, -1], WHITE);
    plain.tri([x1, y1, z1], [x0, y1, z1], [mid, ridge, z1], [0, 0, 1], WHITE);
  }

  function addPyramid(sets, cx, cz, base, y0, height, colorHex) {
    const b = sets.get('vc', M.vc, true);
    const h = base / 2;
    const apex = [cx, y0 + height, cz];
    const corners = [[cx - h, y0, cz - h], [cx + h, y0, cz - h], [cx + h, y0, cz + h], [cx - h, y0, cz + h]];
    const c = col(colorHex);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const n2 = corners[(i + 1) % 4];
      const mx = (a[0] + n2[0]) / 2 - cx;
      const mz = (a[2] + n2[2]) / 2 - cz;
      const len = Math.hypot(mx, mz) || 1;
      b.tri(a, n2, apex, [mx / len, 0.8, mz / len], i % 2 ? shade(colorHex, 0.88) : c);
    }
  }

  function addFence(batch, x, z0, z1, h, colorHex, spacing) {
    const c = col(colorHex);
    const sp = spacing || 3;
    for (let z = z0; z <= z1 + 0.01; z += sp) batch.box(x, FORM_Y + (h + 0.55) / 2, z, 0.07, h + 0.55, 0.07, c);
    batch.box(x, h * 0.92 + 0.05, (z0 + z1) / 2, 0.04, 0.05, z1 - z0, c);
    batch.box(x, h * 0.5, (z0 + z1) / 2, 0.03, 0.04, z1 - z0, c);
  }

  function addBench(batch, x, y, z) {
    const wood = col('#8a5a30');
    const frame = col('#2e3033');
    batch.box(x, y + 0.45, z, 0.45, 0.05, 1.8, wood);
    batch.box(x + 0.2, y + 0.8, z, 0.05, 0.4, 1.8, wood);
    [-0.8, 0.8].forEach((dz) => batch.box(x, y + 0.22, z + dz, 0.4, 0.44, 0.06, frame));
  }

  function addLampPost(sets, x, y, z) {
    const vc = sets.get('vc', M.vc);
    vc.box(x, y + 2.2, z, 0.1, 4.4, 0.1, col('#4b5258'));
    sets.get('glow', M.glow).box(x, y + 4.5, z, 0.5, 0.1, 0.3, col('#fff1c8'));
  }

  function textQuad(batch, center, wide, high, nrm, right, up, uvs) {
    const hw = wide / 2;
    const hh = high / 2;
    const P = (a, b) => [center[0] + right[0] * hw * a + up[0] * hh * b, center[1] + right[1] * hw * a + up[1] * hh * b, center[2] + right[2] * hw * a + up[2] * hh * b];
    batch.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), nrm, WHITE, uvs || [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  function clockMat() {
    const t = new Date();
    return mat('clockm' + t.getHours() + ':' + t.getMinutes(), () => new T.MeshStandardMaterial({ map: clockTexture(), alphaTest: 0.5, vertexColors: true, roughness: 0.5 }));
  }

  /* variant = { opposite: true, lat } builds the platform of the OPPOSITE track (side platform on the far left of the double track,
     lat = the opposite track's lateral position at the stop); without it the platform of the player's track (its side = st.side). */
  function buildStation(env, track, idx, variant) {
    const st = track.stations[idx];
    const q = env.q;
    const isTram = track.kind === 'tram';
    const oppPlat = !!(variant && variant.opposite);
    const sx = oppPlat ? -1 : st.side === 'right' ? 1 : -1;
    const off = oppPlat ? variant.lat : 0;
    const pinfo = track.platformInfo(idx);
    const H = pinfo.height;
    const W = pinfo.width;
    const edge = pinfo.edge;
    const sMid = (st.platformStart + st.platformEnd) / 2;
    const L = st.platformEnd - st.platformStart;
    const zOf = (s) => -(s - sMid);
    const zA = zOf(st.platformStart); // + (behind)
    const zB = zOf(st.platformEnd); // - (ahead)
    const sets = new BatchSet(new T.Vector3());
    const pf = (lat) => off + sx * lat;
    const meshes = [];
    const glow = sets.get('glow', M.glow);
    const vc = sets.get('vc', M.vc, true);
    const concrete = sets.get('concrete', () => M.tex('concrete', tex.concrete()), true);
    const gare = idx === 0 && st.name === 'Lëtzebuerg';
    const modern = /TGV|Belval/.test(st.name);
    const style = pickStyle(st.name);
    // REAL STATIONS: a photo-modelled builder for this station name (pb/train-sim/stations-*.js) replaces the generic building/canopy
    const real = window.TS.realStations ? window.TS.realStations.get(st.name, isTram ? 'tram' : 'rail') : null;

    /* LUXTRAM: the platform follows the curve of ITS track (place(s, lateral) maps a point of the track at arc length s into the station
       group's local frame; yaw = heading difference). Rail stations are straight and keep the plain box layout. */
    const curved = isTram && !!track.noStreet;
    const frameOf = oppPlat && track.opposite ? track.opposite.frameAt : track.frameAt;
    const cF = track.frameAt(sMid);
    const thm = Math.atan2(cF.tangent.x, -cF.tangent.z);
    const place = (s, l) => {
      const f = frameOf(s);
      const wx = f.pos.x + f.right.x * l - cF.pos.x;
      const wz = f.pos.z + f.right.z * l - cF.pos.z;
      return { x: wx * Math.cos(thm) + wz * Math.sin(thm), y: f.pos.y - cF.pos.y, z: -wx * Math.sin(thm) + wz * Math.cos(thm), yaw: -(Math.atan2(f.tangent.x, -f.tangent.z) - thm) };
    };
    // a point of the platform at local z (z = -(s - sMid)) and lateral distance `lat` from the track centre, on the platform side
    const spot = (z, lat) => (curved ? place(sMid - z, sx * lat) : { x: pf(lat), y: 0, z, yaw: 0 });
    const plat = sets.get('platform', () => M.tex('platform', tex.platform()));
    const xe = pf(edge);
    const xb = pf(edge + W);
    if (curved) {
      const n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const sa = st.platformStart + (k * L) / n;
        const sb = st.platformStart + ((k + 1) * L) / n;
        const mid = (sa + sb) / 2;
        const len = L / n + 0.1;
        const body = place(mid, sx * (edge + W / 2));
        concrete.box(body.x, body.y + (H + FORM_Y) / 2 - 0.005, body.z, W, H - FORM_Y - 0.01, len, col('#b9b6af'), body.yaw);
        const lip = place(mid, sx * (edge - 0.06));
        concrete.box(lip.x, lip.y + H - 0.3, lip.z, 0.12, 0.6, len, col('#8f8c85'), lip.yaw);
        const A = place(sa, sx * edge);
        const B = place(sa, sx * (edge + W));
        const C = place(sb, sx * (edge + W));
        const D = place(sb, sx * edge);
        const v = (p) => [p.x, p.y + H + 0.001, p.z];
        const uv = [[0, sa / 4], [1, sa / 4], [1, sb / 4], [0, sb / 4]];
        if (sx > 0) plat.quad(v(A), v(B), v(C), v(D), [0, 1, 0], WHITE, uv);
        else plat.quad(v(A), v(D), v(C), v(B), [0, 1, 0], WHITE, [uv[0], uv[3], uv[2], uv[1]]);
      }
    } else {
      const midX = pf(edge + W / 2);
      concrete.box(midX, (H + FORM_Y) / 2 - 0.005, 0, W, H - FORM_Y - 0.01, L, col('#b9b6af'));
      concrete.box(pf(edge - 0.06), H - 0.3, 0, 0.12, 0.6, L, col('#8f8c85'));
      plat.quad([xe, H + 0.001, zA], [xb, H + 0.001, zA], [xb, H + 0.001, zB], [xe, H + 0.001, zB], [0, 1, 0], WHITE, [[0, zA / 4], [1, zA / 4], [1, zB / 4], [0, zB / 4]]);
    }
    // ramps
    [[zA, 1], [zB, -1]].forEach(([z, dir]) => {
      const rampLen = isTram ? 3.5 : 14;
      const ang = Math.atan2(H, rampLen);
      const rp = spot(z + dir * rampLen / 2, edge + W / 2);
      concrete.box(rp.x, rp.y + H / 2 - 0.3, rp.z, W, 0.25, Math.hypot(rampLen, H), col('#b2afa8'), rp.yaw, dir * -ang);
    });
    // stop marker
    const zm = zOf(st.s);
    const markBatch = sets.get('mark', mark);
    if (curved) {
      const mk = (s, lat) => { const p = place(s, sx * lat); return [p.x, p.y + H + 0.012, p.z]; };
      if (sx > 0) markBatch.quad(mk(st.s - 0.12, edge), mk(st.s - 0.12, edge + W), mk(st.s + 0.12, edge + W), mk(st.s + 0.12, edge), [0, 1, 0], col('#f58a00'));
      else markBatch.quad(mk(st.s - 0.12, edge), mk(st.s + 0.12, edge), mk(st.s + 0.12, edge + W), mk(st.s - 0.12, edge + W), [0, 1, 0], col('#f58a00'));
    } else {
      markBatch.quad([xe, H + 0.012, zm + 0.12], [xb, H + 0.012, zm + 0.12], [xb, H + 0.012, zm - 0.12], [xe, H + 0.012, zm - 0.12], [0, 1, 0], col('#f58a00'));
    }
    const stopB = sets.get('stop', () => M.sign('stop', stopTexture()));
    const sp = spot(zm, edge + 0.45);
    const bx = sp.x;
    vc.box(bx, sp.y + H + 1.2, sp.z + 0.02, 0.08, 2.4, 0.08, col('#40464b'));
    textQuad(stopB, [bx, sp.y + H + 2.3, sp.z + 0.1], 0.8, 1.2, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    vc.box(bx, sp.y + H + 2.3, sp.z - 0.02, 0.86, 1.26, 0.04, col('#202226'));

    // canopy
    const canopyLen = isTram ? 14 : st.size >= 3 ? L * 0.86 : st.size === 2 ? L * 0.5 : 18;
    const cz = isTram ? 0 : 0;
    const roofH = isTram ? 2.9 : 3.5;
    const roofW = isTram ? 2.8 : W + 0.4;
    const colX = pf(edge + (isTram ? Math.min(2.6, W - 0.4) : W - 0.9));
    if (!gare && !(real && real.canopy === false)) {
      vc.box(pf(edge + (isTram ? 1.4 : W / 2 + 0.2)), roofH + 0.1, cz, roofW, 0.16, canopyLen, col(isTram ? '#2f6b57' : '#c5c9cb'), 0, 0, sx * 0.05);
      vc.box(pf(edge + (isTram ? 0.05 : 0.1)), roofH - 0.05, cz, 0.08, 0.34, canopyLen, col(isTram ? '#1e4b3d' : '#17406e'));
      const cols = Math.max(2, Math.round(canopyLen / 9));
      for (let i = 0; i <= cols; i++) {
        const z = cz - canopyLen / 2 + (i * canopyLen) / cols;
        vc.box(colX, H + (roofH - H) / 2, z, 0.18, roofH - H, 0.18, col('#7f868b'));
        glow.box(pf(edge + (isTram ? 1.2 : W / 2)), roofH - 0.12, z + canopyLen / cols / 2, 0.6, 0.05, 0.3, col('#fff3d0'));
      }
      if (isTram && pinfo.kind !== 'island') {
        // glass shelter back wall
        const g = sets.get('glass', M.glass);
        g.box(pf(edge + Math.min(2.7, W - 0.3)), H + 1.1, cz, 0.04, 2.0, canopyLen - 1, WHITE);
      }
    }
    const furniture = !(real && real.furniture === false);
    // benches, bins, lamps, timetable boards
    if (furniture) for (let z = cz - canopyLen / 2 + 4; z < cz + canopyLen / 2 - 3; z += isTram ? 8 : 16) {
      const bp = spot(z, edge + (isTram ? Math.min(2.3, W - 0.7) : W - 0.45));
      addBench(vc, bp.x, H + bp.y, bp.z);
    }
    if (furniture) for (let z = zB + 8; z < zA - 8; z += isTram ? 14 : 22) {
      const lp = spot(z, edge + (isTram ? 0.7 : W * 0.55));
      addLampPost(sets, lp.x, H + lp.y, lp.z);
    }
    if (!isTram && furniture) {
      for (let z = cz - canopyLen / 2 + 9; z < cz + canopyLen / 2; z += 24) {
        vc.cyl(pf(edge + W - 0.5), H + 0.38, z, 0.22, 0.76, col('#3b5a47'));
        vc.box(colX, H + 1.5, z + 1.2, 0.04, 1.3, 0.8, col('#1d3555'));
      }
    }
    // clocks (double faced)
    const clockB = sets.get('clock', clockMat);
    const clockZ = isTram || !furniture ? [] : [-L * 0.22, L * 0.22];
    clockZ.forEach((z) => {
      const cx = colX;
      vc.box(cx, H + 2.9, z, 0.06, 0.6, 0.06, col('#4b5258'));
      textQuad(clockB, [cx, H + 2.7, z + 0.04], 0.78, 0.78, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      textQuad(clockB, [cx, H + 2.7, z - 0.04], 0.78, 0.78, [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
    });
    // name signs
    const signB = sets.get('sign:' + st.name, () => M.sign(st.name, signTexture(st.name, isTram ? 'tram' : 'rail')));
    const signH = H + (isTram ? 2.2 : 2.45);
    const signX = pf(edge + (isTram ? 2.8 : W + 0.12));
    const signZs = isTram ? [0] : [-L * 0.32, L * 0.05, L * 0.34];
    signZs.forEach((z) => {
      textQuad(signB, [signX, signH, z], 2.9, 0.46, [-sx, 0, 0], [0, 0, -sx * -1], [0, 1, 0]);
      vc.box(signX + sx * 0.04, signH, z, 0.03, 0.52, 3.0, col('#1b1d20'));
      [-1.35, 1.35].forEach((dz) => vc.box(signX + sx * 0.04, (H + signH) / 2, z + dz, 0.07, signH - H, 0.07, col('#5a6066')));
    });
    // totem facing the driver (the opposite track's trains come from the other end: no totem)
    if (!oppPlat) {
      const tp = spot(zA - 5, edge + 1.1);
      textQuad(signB, [tp.x, tp.y + H + 2.7, tp.z], 2.6, 0.5, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      vc.box(tp.x, tp.y + H + 2.7, tp.z - 0.03, 2.7, 0.56, 0.04, col('#1b1d20'));
      [-1, 1].forEach((d) => vc.box(tp.x + d * 1.2, tp.y + H + 1.35, tp.z - 0.03, 0.07, 2.7, 0.07, col('#5a6066')));
    }
    // fences
    if (!isTram) {
      addFence(vc, pf(edge + W + 0.45), zB - 5, zA + 5, 1.2, '#6d7378', 3);
      addFence(vc, -pf(7.4), zB - 5, zA + 5, 1.4, '#6d7378', 3);
    }

    // station building
    const extra = [];
    if (real) {
      try {
        real.build({
          T, THREE: T, sets, M, mat, col, shade, WHITE, FORM_Y, hashStr, q, st, idx, track, isTram, opposite: oppPlat, variant,
          sx, pf, spot, place, curved, H, W, edge, L, sMid, zA, zB, zOf, gapX: edge + W + 3.2, extra,
          helpers: { addBuilding, addPyramid, addFence, addBench, addLampPost, textQuad, facadeTexture, signTexture, clockMat, canvasTex, addTrainShed, buildGare, buildModern, addBufferStop, stopTexture },
        });
      } catch (err) {
        console.warn('[Lokféierer] real station build failed', st.name, err);
      }
    } else if (!isTram) {
      const gapX = edge + W + 3.2;
      if (gare) {
        buildGare(sets, sx, gapX, zA, zB, st);
        addTrainShed(sets, sx, q);
      }
      else if (modern) buildModern(sets, sx, gapX, st);
      else if (st.size >= 3) {
        addBuilding(sets, { sx, frontX: pf(gapX), cz: -8, len: 34, w: 11, h: 8.8, roofH: 4.6, style, roof: 'hip', rows: 2 });
        addBuilding(sets, { sx, frontX: pf(gapX - 0.8), cz: -8, len: 12, w: 13, h: 10.5, roofH: 4.2, style, roof: 'gable', rows: 2 });
      } else if (st.size === 2) {
        addBuilding(sets, { sx, frontX: pf(gapX), cz: 6, len: 18, w: 8.2, h: 5.4, roofH: 3.4, style, roof: 'gable', rows: 2 });
      } else if (hashStr(st.name) % 2 === 0) {
        addBuilding(sets, { sx, frontX: pf(gapX), cz: 12, len: 7, w: 4.6, h: 3.3, roofH: 1.8, style, roof: 'gable', rows: 1 });
      }
    }
    // terminus buffer stop
    if (st.terminus && !oppPlat) {
      const sBuf = idx === 0 ? 2.5 : Math.min(track.length - 8, st.platformEnd + 28);
      addBufferStop(vc, zOf(sBuf), idx === 0 ? -1 : 1);
    }

    const out = sets.meshes(q.castStations).concat(extra);
    // lit windows on the main building are part of the facade texture; platform is solid
    return out;
  }

  function addBufferStop(vc, z, dir) {
    const steelC = col('#43484d');
    vc.box(0, -0.25, z + dir * 0.4, 3.2, 0.5, 1.2, col('#8f8b84'));
    vc.box(0, 0.8, z, 2.7, 0.35, 0.35, steelC);
    [-0.9, 0.9].forEach((x) => {
      vc.box(x, 0.8, z - dir * 0.25, 0.5, 0.5, 0.2, col('#d12a20'));
      vc.box(x, 0.3, z + dir * 0.3, 0.2, 1.0, 0.2, steelC);
    });
    vc.box(0, 0.1, z + dir * 0.5, 0.5, 0.1, 1.2, steelC);
    [-1.3, 1.3].forEach((x) => vc.between([x, 0.8, z + dir * 0.1], [x * 1.1, -0.45, z + dir * 1.6], 0.2, steelC));
  }

  function buildGare(sets, sx, gapX, zA, zB, st) {
    const pf = (v) => sx * v;
    const vc = sets.get('vc', M.vc, true);
    const style = 'sandstone';
    // main block + two wings
    addBuilding(sets, { sx, frontX: pf(gapX + 4), cz: 0, len: 30, w: 14, h: 12.5, roofH: 5.5, style, roof: 'hip', rows: 2, gare: true });
    [-1, 1].forEach((d) => addBuilding(sets, { sx, frontX: pf(gapX + 5), cz: d * 31.5, len: 33, w: 11, h: 9.2, roofH: 4.2, style, roof: 'gable', rows: 2, gare: true }));
    // clock tower
    const tx = pf(gapX + 4 + 5);
    const faces = sets.get('facade:tower', () => M.tex('facadetower', facadeTexture('house', '#c8b088', 3), {}), true);
    const tw = 8;
    const t0 = FORM_Y;
    const t1 = 33;
    const px0 = tx - tw / 2;
    const px1 = tx + tw / 2;
    const pz0 = -tw / 2;
    const pz1 = tw / 2;
    faces.quad([px0, t0, pz1], [px0, t0, pz0], [px0, t1, pz0], [px0, t1, pz1], [-1, 0, 0], WHITE, [[0, 0], [1.3, 0], [1.3, 1], [0, 1]]);
    faces.quad([px1, t0, pz0], [px1, t0, pz1], [px1, t1, pz1], [px1, t1, pz0], [1, 0, 0], WHITE, [[0, 0], [1.3, 0], [1.3, 1], [0, 1]]);
    faces.quad([px0, t0, pz0], [px1, t0, pz0], [px1, t1, pz0], [px0, t1, pz0], [0, 0, -1], WHITE, [[0, 0], [1.3, 0], [1.3, 1], [0, 1]]);
    faces.quad([px1, t0, pz1], [px0, t0, pz1], [px0, t1, pz1], [px1, t1, pz1], [0, 0, 1], WHITE, [[0, 0], [1.3, 0], [1.3, 1], [0, 1]]);
    vc.box(tx, t1 + 0.4, 0, tw + 0.8, 0.8, tw + 0.8, col('#b79e72'));
    [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]].forEach(([a, b]) => vc.box(tx + a * (tw + 0.4), t1 + 1.6, b * (tw + 0.4), 0.9, 1.9, 0.9, col('#b79e72')));
    addPyramid(sets, tx, 0, tw + 1.6, t1 + 0.8, 11, '#4f7f6c');
    vc.box(tx, t1 + 11.8, 0, 0.12, 3, 0.12, col('#c7a83a'));
    // clock faces on the tower (four sides)
    const clockB = sets.get('clock', clockMat);
    const cy = 27;
    textQuad(clockB, [px0 - 0.05, cy, 0], 5, 5, [-1, 0, 0], [0, 0, 1], [0, 1, 0]);
    textQuad(clockB, [px1 + 0.05, cy, 0], 5, 5, [1, 0, 0], [0, 0, -1], [0, 1, 0]);
    textQuad(clockB, [tx, cy, pz0 - 0.05], 5, 5, [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
    textQuad(clockB, [tx, cy, pz1 + 0.05], 5, 5, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const nameB = sets.get('sign:' + st.name, () => M.sign(st.name, signTexture(st.name, 'rail')));
    textQuad(nameB, [pf(gapX + 4) - sx * 0.12, 9.6, 0], 13, 2.0, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
    // entrance canopy facing the platform
    vc.box(pf(gapX + 1.2), 4.4, 0, 3.6, 0.3, 18, col('#40474d'));
    [-8, -2.7, 2.7, 8].forEach((z) => vc.box(pf(gapX + 0.1), 2.0, z, 0.3, 4.5, 0.3, col('#40474d')));
  }

  function addTrainShed(sets, sx, q) {
    const R = 8.4;
    const cy = 3.2;
    const cx = sx * 3.2;
    const half = 72;
    const steel = sets.get('shedsteel', () => mat('shedsteel', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })), true);
    const glassB = sets.get('shedglass', M.glass);
    const ribCol = col('#6b7a84');
    const segs = 16;
    const arch = [];
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI - (i / segs) * Math.PI;
      arch.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    const spacing = q.ribs || 8;
    const count = Math.max(2, Math.round((half * 2) / spacing));
    for (let k = 0; k <= count; k++) {
      const z = -half + (k * half * 2) / count;
      for (let i = 0; i < segs; i++) {
        steel.between([arch[i][0], arch[i][1], z], [arch[i + 1][0], arch[i + 1][1], z], 0.34, ribCol, 0.55);
      }
      [arch[0], arch[segs]].forEach((p) => steel.between([p[0], FORM_Y, z], [p[0], p[1], z], 0.4, ribCol, 0.4));
      for (let i = 2; i < segs - 1; i += 2) steel.between([arch[i][0], arch[i][1] - 0.3, z], [arch[segs - i][0], arch[segs - i][1] - 0.3, z], 0.05, col('#8b949a'));
    }
    for (let i = 1; i < segs; i++) steel.between([arch[i][0], arch[i][1], -half], [arch[i][0], arch[i][1], half], 0.12, ribCol);
    for (let i = 0; i < segs; i++) {
      const a = arch[i];
      const b = arch[i + 1];
      glassB.quad([a[0], a[1], -half], [b[0], b[1], -half], [b[0], b[1], half], [a[0], a[1], half], [0, 1, 0], WHITE);
    }
    const glow = sets.get('glow', M.glow);
    for (let z = -half + 6; z < half; z += 12) glow.box(cx, cy + R - 0.9, z, 0.5, 0.12, 2.4, col('#fff2cc'));
  }

  function buildModern(sets, sx, gapX, st) {
    const pf = (v) => sx * v;
    const vc = sets.get('vc', M.vc, true);
    const glass = sets.get('glassdark', () => mat('glassdark', () => new T.MeshStandardMaterial({ color: 0x7aa6ba, emissive: new T.Color(0x17323f), roughness: 0.2, metalness: 0.1, vertexColors: false })), true);
    const len = 42;
    const w = 12;
    const x0 = pf(gapX);
    const x1 = pf(gapX + w);
    const h = 8;
    glass.box(pf(gapX + w / 2), h / 2 - 0.2, 0, w, h + 0.5, len, WHITE);
    for (let z = -len / 2; z <= len / 2; z += 3.5) vc.box(x0 - sx * 0.05, h / 2 - 0.2, z, 0.12, h + 0.5, 0.12, col('#d9dde0'));
    vc.box(pf(gapX + w / 2 - 1.5), h + 0.5, 0, w + 6, 0.5, len + 4, col('#e9ecee'), 0, 0, sx * -0.04);
    vc.box(pf(gapX + w / 2), 0.1, 0, w + 0.4, 0.4, len + 0.4, col('#9ea3a6'));
    [-len / 2, len / 2].forEach((z) => vc.box(x0, h / 2, z, 0.3, h + 0.4, 0.3, col('#d9dde0')));
  }

  /* ================================================================== chunks */
  function disposeObject(root) {
    root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
    });
  }

  function buildChunkContent(env, index) {
    const { track, q } = env;
    const s0 = index * CHUNK;
    const bedEnd = Math.min(s0 + CHUNK, track.length);
    if (bedEnd - s0 < 0.5) return null;
    const origin = track.frameAt((s0 + bedEnd) / 2).pos.clone();
    const sets = new BatchSet(origin);
    const group = new T.Group();
    const step = track.kind === 'tram' ? TRAM_SWEEP_STEP : q.sweepStep;
    const ctx = { env, track, q, kind: track.kind, s0, s1: bedEnd, origin, sets, group, instanced: [], frames: makeFrames(track, s0, bedEnd, step), frames2: null };
    if (track.kind === 'tram' && track.opposite) {   // the opposite (left-hand) track exists along the real line only
      const a2 = Math.max(s0, track.opposite.from);
      const b2 = Math.min(bedEnd, track.opposite.to);
      if (b2 - a2 >= 1) ctx.frames2 = makeFramesF(track.opposite.frameAt, a2, b2, step);
    }
    addBed(ctx);
    addSleepers(ctx);
    addCatenary(ctx);
    addLimitBoards(ctx);
    addDistantBoards(ctx);
    addLineFence(ctx);
    addKmPosts(ctx);
    track.tunnels.forEach((tn) => addTunnel(ctx, tn));
    track.bridges.forEach((br) => addBridge(ctx, br));
    sets.meshes(q.castAll).forEach((m) => group.add(m));
    const rec = { group, signals: [], crossings: [] };
    track.signals.forEach((sig, i) => {
      if (sig.s < s0 || sig.s >= bedEnd) return;
      const obj = buildSignal(env, track, sig, i, env.signalState[i]);
      group.add(obj.group);
      env.signalObjs.set(i, obj);
      rec.signals.push(i);
    });
    track.crossings.forEach((cr, i) => {
      if (cr.s < s0 || cr.s >= bedEnd) return;
      const obj = buildCrossing(env, track, cr, env.crossingState[i]);
      group.add(obj.group);
      env.crossingObjs.set(i, obj);
      rec.crossings.push(i);
    });
    return rec;
  }

  /* ============================================================ public API */
  function create(scene, track, options) {
    const qualityName = (options && options.quality) || 'medium';
    const q = QUALITY[qualityName] || QUALITY.medium;
    const isTram = track.kind === 'tram';
    const platformHeight = track.stations.length ? track.platformInfo(0).height : isTram ? PLATFORM_H_TRAM : PLATFORM_H_RAIL;
    LAMP_GEO.userData = { shared: true };
    const sleeperGeo = new T.BoxGeometry(SLEEPER_SIZE[0], SLEEPER_SIZE[1], SLEEPER_SIZE[2]);
    sleeperGeo.userData = { shared: true };
    const env = {
      track, q, platformHeight,
      geoCache: new Map(),
      sleeperGeo,
      sleeperMat: new T.MeshStandardMaterial({ color: 0x8e8b86, roughness: 0.92 }),
      signalState: track.signals.map(() => 'green'),
      signalObjs: new Map(),
      crossingState: track.crossings.map(() => false),
      crossingObjs: new Map(),
      portalGeo: null,
      ocsLog: options && options.debugOcs ? [] : null,   // test hook: contact wire sample points + masts of the tram overhead line
    };
    const root = new T.Group();
    root.name = 'train-sim-infra';
    scene.add(root);
    const chunks = new Map();
    const lastIndex = Math.floor(Math.max(0, track.length - 0.01) / CHUNK);

    const stationObjects = track.stations.map((st, i) => {
      const sMid = (st.platformStart + st.platformEnd) / 2;
      const f = track.frameAt(sMid);
      const group = new T.Group();
      group.name = 'station:' + st.name;
      group.position.copy(f.pos);
      group.rotation.y = -Math.atan2(f.tangent.x, -f.tangent.z);
      group.userData = { stationIndex: i, built: false, platformHeight, side: st.side, platformEdge: track.platformInfo(i).edge, platformWidth: track.platformInfo(i).width, sMid, meshes: [] };
      root.add(group);
      return { group, stationIndex: i };
    });

    function loadStation(i) {
      const obj = stationObjects[i];
      if (obj.group.userData.built) return;
      try {
        let meshes = buildStation(env, track, i);
        meshes.forEach((m) => { m.userData.platformOf = 'player'; });
        const pi = track.platformInfo(i);
        if (track.kind === 'tram' && pi.kind !== 'island' && track.opposite && Number.isFinite(pi.oppLat)) {
          const other = buildStation(env, track, i, { opposite: true, lat: pi.oppLat });
          other.forEach((m) => { m.userData.platformOf = 'opposite'; });
          meshes = meshes.concat(other);
        }
        meshes.forEach((m) => obj.group.add(m));
        obj.group.userData.meshes = meshes;
        obj.group.userData.built = true;
      } catch (err) {
        console.warn('[Lokféierer] station build failed', track.stations[i].name, err);
      }
    }
    function unloadStation(i) {
      const obj = stationObjects[i];
      if (!obj.group.userData.built) return;
      obj.group.userData.meshes.forEach((m) => {
        obj.group.remove(m);
        m.geometry.dispose();
      });
      obj.group.userData.meshes = [];
      obj.group.userData.built = false;
    }

    function loadChunk(index) {
      if (chunks.has(index)) return;
      let rec = null;
      try {
        rec = buildChunkContent(env, index);
      } catch (err) {
        console.warn('[Lokféierer] chunk build failed', index, err);
      }
      chunks.set(index, rec);
      if (rec) root.add(rec.group);
    }
    function unloadChunk(index) {
      const rec = chunks.get(index);
      chunks.delete(index);
      if (!rec) return;
      rec.signals.forEach((i) => { const o = env.signalObjs.get(i); if (o) o.dispose(); env.signalObjs.delete(i); });
      rec.crossings.forEach((i) => { const o = env.crossingObjs.get(i); if (o) o.dispose(); env.crossingObjs.delete(i); });
      root.remove(rec.group);
      disposeObject(rec.group);
    }

    let lastNow = performance.now();
    function update(s, camera) {
      const pos = Number.isFinite(s) ? s : 0;
      const lo = Math.max(0, Math.floor((pos - q.behind) / CHUNK));
      const hi = Math.min(lastIndex, Math.floor((pos + q.ahead) / CHUNK));
      Array.from(chunks.keys()).forEach((index) => {
        if (index < lo - 1 || index > hi + 1) unloadChunk(index);
      });
      const wanted = [];
      for (let i = lo; i <= hi; i++) if (!chunks.has(i)) wanted.push(i);
      wanted.sort((a, b) => Math.abs(a * CHUNK + CHUNK / 2 - pos) - Math.abs(b * CHUNK + CHUNK / 2 - pos));
      let built = 0;
      for (const index of wanted) {
        const urgent = Math.abs(index * CHUNK + CHUNK / 2 - pos) < 320;
        if (built >= WINDOW_BUILDS_PER_UPDATE && !urgent) break;
        loadChunk(index);
        built += 1;
        if (built >= 3) break;
      }
      track.stations.forEach((st, i) => {
        const near = st.platformEnd > pos - q.behind - 150 && st.platformStart < pos + q.ahead * 0.8;
        if (near) loadStation(i);
        else if (st.platformEnd < pos - q.behind - 400 || st.platformStart > pos + q.ahead + 400) unloadStation(i);
      });
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      env.crossingObjs.forEach((o) => o.tick(now / 1000, dt));
      return camera;
    }

    function setSignalAspect(index, aspect) {
      if (!(index >= 0 && index < env.signalState.length) || !LAMP_ON[aspect]) return;
      env.signalState[index] = aspect;
      const o = env.signalObjs.get(index);
      if (o) o.setAspect(aspect);
    }
    function setCrossing(index, closed) {
      if (!(index >= 0 && index < env.crossingState.length)) return;
      env.crossingState[index] = !!closed;
      const o = env.crossingObjs.get(index);
      if (o) o.setClosed(!!closed);
    }
    /* Temporary speed restriction boards (yellow). addTempBoard(s, kmh, endS?) puts a start board at s and, when endS is given, an end board. */
    const tempBoards = [];
    function makeTempBoard(s, kmh, isEnd) {
      const sd = lateralFree(track, s);
      const lat = sd * (isTram ? 4.7 : 3.2);
      const f = track.frameAt(s);
      const group = new T.Group();
      const map = tsrTexture(kmh, isEnd);
      const plate = new T.Mesh(new T.PlaneGeometry(1.1, 1.38), new T.MeshBasicMaterial({ map, side: T.DoubleSide }));
      plate.position.y = 2.7;
      const post = new T.Mesh(new T.BoxGeometry(0.09, 2.5, 0.09), new T.MeshStandardMaterial({ color: 0x6c7075 }));
      post.position.y = 1.2;
      group.add(post, plate);
      const p = posAt(track, s, lat, isTram ? 0.14 : -0.2);
      group.position.set(p[0], p[1], p[2]);
      group.rotation.y = Math.atan2(-f.tangent.x, -f.tangent.z);
      group.userData = { s, kmh, isEnd };
      root.add(group);
      tempBoards.push(group);
      return group;
    }
    function addTempBoard(s, kmh, endS) {
      if (!Number.isFinite(s) || !Number.isFinite(kmh)) return false;
      try {
        makeTempBoard(s, Math.round(kmh), false);
        if (Number.isFinite(endS)) makeTempBoard(endS, Math.round(kmh), true);
        return true;
      } catch (err) {
        console.warn('[Lokféierer] temp board failed', err);
        return false;
      }
    }
    function clearTempBoards() {
      tempBoards.splice(0).forEach((g) => {
        root.remove(g);
        g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });   // textures are shared via the cache
      });
    }
    function dispose() {
      clearTempBoards();
      Array.from(chunks.keys()).forEach(unloadChunk);
      track.stations.forEach((st, i) => unloadStation(i));
      scene.remove(root);
      sleeperGeo.dispose();
      env.sleeperMat.dispose();
      env.geoCache.forEach((v) => { if (v && v.dispose) v.dispose(); else if (v && v.geo) v.geo.dispose(); });
    }

    /* Test / debug: builds every platform and reports on which side of the player's track the player's platform was really built
       (lateral centre of its meshes in the station group, + = right of the direction of travel) and where the opposite platform is. */
    function stationReport() {
      return track.stations.map((st, i) => {
        loadStation(i);
        const group = stationObjects[i].group;
        const span = { player: [Infinity, -Infinity], opposite: [Infinity, -Infinity] };
        group.children.forEach((m) => {
          if (!m.geometry) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox;
          const key = m.userData.platformOf === 'opposite' ? 'opposite' : 'player';
          span[key][0] = Math.min(span[key][0], b.min.x + m.position.x);
          span[key][1] = Math.max(span[key][1], b.max.x + m.position.x);
        });
        const mid = (a) => (Number.isFinite(a[0]) ? (a[0] + a[1]) / 2 : null);
        // the same in world space: median lateral position (track.nearest: + = right of the direction of travel) of the platform meshes' vertices
        group.updateMatrixWorld(true);
        const medianLat = (key) => {
          const lats = [];
          const v = new T.Vector3();
          group.children.forEach((m) => {
            if (!m.geometry || !m.geometry.attributes.position || (m.userData.platformOf === 'opposite' ? 'opposite' : 'player') !== key) return;
            const pos = m.geometry.attributes.position;
            const stride = Math.max(1, Math.floor(pos.count / 120));
            for (let k = 0; k < pos.count; k += stride) {
              v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
              if (v.y > track.frameAt(st.s).pos.y + 0.1 && v.y < track.frameAt(st.s).pos.y + 0.5 && track.nearest) { const nq = track.nearest(v.x, v.z); if (nq && nq.d < 12) lats.push(nq.lat); }   // platform top / body vertices only
            }
          });
          lats.sort((a, b) => a - b);
          return lats.length ? lats[Math.floor(lats.length / 2)] : null;
        };
        return {
          name: st.name, side: st.side, kind: track.platformInfo(i).kind || 'side', playerMidX: mid(span.player), oppositeMidX: mid(span.opposite), playerSpan: span.player,
          playerWorldLat: medianLat('player'), oppositeWorldLat: medianLat('opposite'), built: group.userData.built,
        };
      });
    }

    update(0);
    return {
      update, dispose, setSignalAspect, setCrossing, addTempBoard, clearTempBoards, platformHeight, stationObjects, stationReport,
      quality: qualityName,
      debug: { chunks, env },
    };
  }

  window.TS.infra = { create, QUALITY };
})();
