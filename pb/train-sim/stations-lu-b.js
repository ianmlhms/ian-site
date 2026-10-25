/* Zuchsimulator Lëtzebuerg: photo-modelled stations (lu-b). Registers into TS.realStations (stations-real.js).
 * Stations: Sandweiler-Contern, Oetrange, Betzder, Manternach, Mertert, Wasserbëlleg, Pafendall-Kierchbierg, Walfer, Lëntgen,
 * Miersch, Ettelbréck, Kautebaach, Wëlwerwolz, Clierf. Everything is built relative to the platform side (sx / pf) so mirrored
 * routes work. Local frame: l = lateral distance from the track centre towards the platform side (negative = far side),
 * z = along the platform (the train drives towards -z), y up (platform top = H). */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations) return;
  const reg = window.TS.realStations.register;

  const PX = 64; // facade texture density: pixels per metre
  const mulb = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hexRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (h, f) => {
    const c = hexRgb(h);
    return 'rgb(' + c.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))).join(',') + ')';
  };
  const lerpHex = (a, b, t) => {
    const p = hexRgb(a);
    const q = hexRgb(b);
    return 'rgb(' + p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',') + ')';
  };

  /* ---------------------------------------------------------------- textures (cached by key in infra's canvasTex) */
  function ashlar(c, w, h, base, rnd, course, jitter) {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    let y = 0;
    let row = 0;
    while (y < h) {
      const ch = course * (0.8 + rnd() * 0.45);
      let x = -rnd() * course * 2;
      while (x < w) {
        const bw = course * (1.4 + rnd() * 1.6);
        const f = 1 - jitter + rnd() * jitter * 2;
        c.fillStyle = mix(base, f);
        c.fillRect(x + 1, y + 1, bw - 2, ch - 2);
        x += bw;
      }
      y += ch;
      row++;
    }
    c.fillStyle = 'rgba(60,48,30,0.16)';
    for (let i = 0; i < 260; i++) c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  function plaster(c, w, h, base, rnd) {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 128 + (rnd() - 0.5) * 70;
      c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.05 + rnd() * 0.12).toFixed(2) + ')';
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }
  function brick(c, w, h, base, rnd) {
    c.fillStyle = mix(base, 0.7);
    c.fillRect(0, 0, w, h);
    const bh = 5;
    const bw = 12;
    for (let y = 0, r = 0; y < h; y += bh, r++) {
      for (let x = -(r % 2) * (bw / 2); x < w; x += bw) {
        c.fillStyle = mix(base, 0.88 + rnd() * 0.26);
        c.fillRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      }
    }
  }
  function drawWindow(c, x, y, ww, wh, kind, s) {
    const frame = s.frame || '#f2efe8';
    const trim = s.trim;
    const t = 0.16 * PX;
    c.fillStyle = trim;
    if (kind === 'arch') {
      c.fillRect(x - t, y + ww / 2 - t, ww + 2 * t, wh - ww / 2 + t);
      c.beginPath();
      c.arc(x + ww / 2, y + ww / 2, ww / 2 + t, Math.PI, 0);
      c.fill();
    } else c.fillRect(x - t, y - t, ww + 2 * t, wh + 2 * t + 0.1 * PX);
    const g = c.createLinearGradient(0, y, 0, y + wh);
    g.addColorStop(0, s.glassTop || '#51677a');
    g.addColorStop(1, s.glassBot || '#93aabb');
    c.fillStyle = g;
    c.beginPath();
    if (kind === 'arch') {
      c.moveTo(x, y + wh);
      c.lineTo(x, y + ww / 2);
      c.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0);
      c.lineTo(x + ww, y + wh);
    } else c.rect(x, y, ww, wh);
    c.fill();
    c.strokeStyle = frame;
    c.lineWidth = Math.max(2, 0.05 * PX);
    c.strokeRect(x + 0.5, y + 0.5, ww - 1, wh - 1);
    c.beginPath();
    c.moveTo(x + ww / 2, y);
    c.lineTo(x + ww / 2, y + wh);
    const my = kind === 'arch' ? y + ww / 2 : y + wh * 0.38;
    c.moveTo(x, my);
    c.lineTo(x + ww, my);
    c.stroke();
    if (kind === 'arch') {
      c.beginPath();
      c.arc(x + ww / 2, y + ww / 2, ww / 2 - 1, Math.PI, 0);
      c.stroke();
    }
    if (s.sill !== false) {
      c.fillStyle = trim;
      c.fillRect(x - t * 1.3, y + wh, ww + t * 2.6, 0.12 * PX);
    }
    if (s.shutters) {
      c.fillStyle = s.shutters;
      c.fillRect(x - 0.5 * ww * 0.55 - t, y, ww * 0.5, wh);
      c.fillRect(x + ww + t + ww * 0.05, y, ww * 0.5, wh);
    }
  }
  /* One bay of facade: floors listed bottom (ground) to top. */
  function facadeCanvas(s) {
    const w = Math.round(s.bayM * PX);
    const fh = Math.round(s.floorM * PX);
    const h = fh * s.floors.length;
    return { w, h, draw: (c) => {
      const rnd = mulb(w * 31 + h);
      if (s.stone) ashlar(c, w, h, s.wall, rnd, 0.36 * PX, 0.07);
      else if (s.brick) brick(c, w, h, s.wall, rnd);
      else plaster(c, w, h, s.wall, rnd);
      s.floors.forEach((f, i) => {
        const top = h - (i + 1) * fh; // canvas y of this floor's ceiling line
        const fy = top + fh; // floor line
        if (i > 0 && s.band !== false) {
          c.fillStyle = s.trim;
          c.fillRect(0, fy - 0.1 * PX - fh * 0 + fh - fh, w, 0.22 * PX);
        }
        if (f.k === 'blank') return;
        const ww = (f.ww || 1.1) * PX;
        const wh = (f.wh || 1.6) * PX;
        const x = (w - ww) / 2;
        const y = fy - ((f.sy == null ? 0.9 : f.sy) * PX) - wh;
        if (f.k === 'door') {
          c.fillStyle = s.trim;
          c.beginPath();
          c.arc(x + ww / 2, y + ww / 2, ww / 2 + 0.16 * PX, Math.PI, 0);
          c.fillRect(x - 0.16 * PX, y + ww / 2, ww + 0.32 * PX, wh - ww / 2);
          c.fill();
          c.fillStyle = f.col || '#3a3c40';
          c.beginPath();
          c.moveTo(x, fy);
          c.lineTo(x, y + ww / 2);
          c.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0);
          c.lineTo(x + ww, fy);
          c.fill();
          c.fillStyle = f.panel || '#e0801a';
          c.fillRect(x, fy - 0.9 * PX, ww, 0.3 * PX);
          c.fillStyle = 'rgba(150,170,190,0.8)';
          c.fillRect(x + 0.1 * PX, y + ww / 2, ww - 0.2 * PX, wh * 0.4);
          return;
        }
        drawWindow(c, x, y, ww, wh, f.k, s);
      });
      if (s.cornice) {
        c.fillStyle = s.trim;
        c.fillRect(0, 0, w, 0.28 * PX);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(0, 0.28 * PX, w, 3);
      }
    } };
  }

  function roofCanvas(kind) {
    return { w: 128, h: 128, draw: (c, w, h) => {
      const rnd = mulb(kind.length * 977);
      const base = { slate: '#4b4f55', slateb: '#5f5a52', tile: '#8a4a36', zinc: '#6f777d', shingle: '#3d4044' }[kind] || '#4b4f55';
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      const rows = kind === 'zinc' ? 0 : 10;
      for (let r = 0; r < rows; r++) {
        const y = (r * h) / rows;
        for (let x = -(r % 2) * 8; x < w; x += 16) {
          c.fillStyle = mix(base, 0.82 + rnd() * 0.3);
          c.fillRect(x + 1, y + 1, 14, h / rows - 2);
        }
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(0, y, w, 1.5);
      }
      if (kind === 'zinc') {
        for (let x = 0; x < w; x += 16) {
          c.fillStyle = 'rgba(255,255,255,0.18)';
          c.fillRect(x, 0, 2, h);
          c.fillStyle = 'rgba(0,0,0,0.22)';
          c.fillRect(x + 2, 0, 1.5, h);
        }
      }
    } };
  }
  function timberCanvas(base) {
    return { w: 128, h: 128, draw: (c, w, h) => {
      const rnd = mulb(hashCode(base));
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) {
        c.fillStyle = mix(base, 0.9 + rnd() * 0.18);
        c.fillRect(x + 1, 0, 14, h);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(x, 0, 1.5, h);
      }
      for (let i = 0; i < 240; i++) {
        c.fillStyle = 'rgba(0,0,0,0.1)';
        c.fillRect(rnd() * w, rnd() * h, 1, 3 + rnd() * 10);
      }
    } };
  }
  function concreteCanvas() {
    return { w: 128, h: 128, draw: (c, w, h) => {
      const rnd = mulb(4242);
      c.fillStyle = '#a9a8a2';
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) {
        const v = 128 + (rnd() - 0.5) * 60;
        c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.06 + rnd() * 0.12).toFixed(2) + ')';
        c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 5, 1 + rnd() * 2);
      }
      c.fillStyle = 'rgba(50,50,48,0.35)';
      c.fillRect(0, 0, w, 1.5);
      c.fillRect(0, 0, 1.5, h);
      [[32, 32], [96, 32], [32, 96], [96, 96]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 2.2, 0, 6.3); c.fill(); });
    } };
  }
  const hashCode = (s) => {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h >>> 0;
  };
  function tilesCanvas(base, line) {
    return { w: 128, h: 128, draw: (c, w, h) => {
      const rnd = mulb(hashCode(base + line));
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
        c.fillStyle = mix(base, 0.94 + rnd() * 0.12);
        c.fillRect(x + 1, y + 1, 30, 30);
      }
      c.strokeStyle = line;
      c.lineWidth = 1.5;
      for (let i = 0; i <= 128; i += 32) {
        c.beginPath();
        c.moveTo(i, 0);
        c.lineTo(i, h);
        c.moveTo(0, i);
        c.lineTo(w, i);
        c.stroke();
      }
    } };
  }

  /* ---------------------------------------------------------------- the kit (per station build) */
  function makeKit(api) {
    const { T, sets, M, col, shade, WHITE, FORM_Y, sx, pf, H, W, edge, helpers } = api;
    const { canvasTex, textQuad } = helpers;
    const X = (l) => pf(l);
    const vc = sets.get('vc', M.vc, true);
    const glow = sets.get('glow', M.glow);
    const glass = () => sets.get('glass', M.glass);
    const glassDark = () => sets.get('lubglassdark', () => api.mat('lub:glassdark', () => new T.MeshStandardMaterial({ color: 0x6f95a8, transparent: true, opacity: 0.42, roughness: 0.12, metalness: 0.35, side: T.DoubleSide, depthWrite: false })));
    const matTex = (key, spec, extra) => () => api.M.tex('lub:' + key, canvasTex('lub:' + key, spec.w, spec.h, spec.draw), extra);
    const tex = (key, spec, cast) => sets.get('lub:' + key, matTex(key, spec), cast !== false);
    const steel = () => sets.get('steel', M.steel, true);
    const facadeBatch = (key, spec) => tex('f:' + key, facadeCanvas(spec));
    const roofBatch = (kind) => tex('r:' + kind, roofCanvas(kind));
    const timberBatch = (base) => tex('t:' + base, timberCanvas(base));
    const concBatch = () => tex('conc', concreteCanvas());
    const plainBatch = (hex) => tex('p:' + hex, { w: 64, h: 64, draw: (c, w, h) => plaster(c, w, h, hex, mulb(hashCode(hex))) });

    // quad with a normal derived from the vertex order but pointing away from `hint`
    function quadO(batch, a, b, c, d, hint, color, uvs) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const cx = (a[0] + b[0] + c[0] + d[0]) / 4 - hint[0];
      const cy = (a[1] + b[1] + c[1] + d[1]) / 4 - hint[1];
      const cz = (a[2] + b[2] + c[2] + d[2]) / 4 - hint[2];
      if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      batch.quad(a, b, c, d, [nx, ny, nz], color || WHITE, uvs);
    }
    function triUV(batch, a, b, c, hint, color, uvs) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const cx = (a[0] + b[0] + c[0]) / 3 - hint[0];
      const cy = (a[1] + b[1] + c[1]) / 3 - hint[1];
      const cz = (a[2] + b[2] + c[2]) / 3 - hint[2];
      let p = [a, b, c];
      let q = uvs || [[0, 0], [1, 0], [0.5, 1]];
      if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; p = [a, c, b]; q = [q[0], q[2], q[1]]; }
      const ids = p.map((pt, k) => batch.vert(pt[0], pt[1], pt[2], nx, ny, nz, q[k][0], q[k][1], color || WHITE));
      batch.idx.push(ids[0], ids[1], ids[2]);
    }

    /* Rectangular building. o = { l0, l1, z0, z1, floors, floorM, front, back, end (facade specs), baseCol, yF }
       Walls from the ground (FORM_Y) to the floor (yF = H) are a plain plinth; facade textures cover yF .. eaves. */
    function walls(o) {
      const yF = o.yF == null ? H : o.yF;
      const eaves = yF + o.floors * o.floorM;
      const hint = [X((o.l0 + o.l1) / 2), (yF + eaves) / 2, (o.z0 + o.z1) / 2];
      const nBaysZ = (o.z1 - o.z0) / o.front.bayM;
      const nBaysL = (o.l1 - o.l0) / (o.end ? o.end.bayM : o.front.bayM);
      const fb = facadeBatch(o.frontKey, o.front);
      const bb = o.back ? facadeBatch(o.backKey, o.back) : fb;
      const eb = o.end ? facadeBatch(o.endKey, o.end) : fb;
      const pl = plainBatch(o.baseCol || '#9a9486');
      const xa = X(o.l0), xb = X(o.l1);
      const uvF = [[0, 0], [nBaysZ, 0], [nBaysZ, 1], [0, 1]];
      quadO(fb, [xa, yF, o.z0], [xa, yF, o.z1], [xa, eaves, o.z1], [xa, eaves, o.z0], hint, WHITE, uvF);
      quadO(bb, [xb, yF, o.z0], [xb, yF, o.z1], [xb, eaves, o.z1], [xb, eaves, o.z0], hint, WHITE, uvF);
      const uvE = [[0, 0], [nBaysL, 0], [nBaysL, 1], [0, 1]];
      [o.z0, o.z1].forEach((z) => quadO(eb, [xa, yF, z], [xb, yF, z], [xb, eaves, z], [xa, eaves, z], hint, WHITE, uvE));
      // plinth
      [[xa, xb, 0], [xa, xb, 1]].forEach((_, k) => {});
      const yB = FORM_Y;
      quadO(pl, [xa, yB, o.z0], [xa, yB, o.z1], [xa, yF, o.z1], [xa, yF, o.z0], hint, WHITE, [[0, 0], [4, 0], [4, 0.3], [0, 0.3]]);
      quadO(pl, [xb, yB, o.z0], [xb, yB, o.z1], [xb, yF, o.z1], [xb, yF, o.z0], hint, WHITE, [[0, 0], [4, 0], [4, 0.3], [0, 0.3]]);
      [o.z0, o.z1].forEach((z) => quadO(pl, [xa, yB, z], [xb, yB, z], [xb, yF, z], [xa, yF, z], hint, WHITE, [[0, 0], [2, 0], [2, 0.3], [0, 0.3]]));
      return { eaves, yF, xa, xb };
    }

    /* Roofs. kind 'gable' (ridge along z) | 'gableX' (ridge across, along l) | 'hip' | 'pyr' | 'flat' | 'mono' */
    function roof(o) {
      const rb = roofBatch(o.mat || 'slate');
      const ov = o.ov == null ? 0.5 : o.ov;
      const l0 = o.l0 - ov, l1 = o.l1 + ov, z0 = o.z0 - ov, z1 = o.z1 + ov;
      const y0 = o.y;
      const yr = y0 + o.rise;
      const lm = (o.l0 + o.l1) / 2, zm = (o.z0 + o.z1) / 2;
      const hint = [X(lm), y0 - 1, zm];
      const uvL = (len) => [[0, 0], [len / 2, 0], [len / 2, Math.hypot(o.rise, (l1 - l0) / 2) / 2], [0, Math.hypot(o.rise, (l1 - l0) / 2) / 2]];
      const gableTri = (a, b, c) => {
        if (o.gableTex) {
          const g = o.gableTex;
          const wd = Math.hypot(b[0] - a[0], b[2] - a[2]);
          triUV(g.b, a, b, c, hint, WHITE, [[0, 0], [wd / g.bayM, 0], [wd / 2 / g.bayM, (c[1] - a[1]) / g.floorM]]);
        } else if (o.gableHex) triUV(plainBatch(o.gableHex), a, b, c, hint, WHITE, [[0, 0], [2, 0], [1, 1.5]]);
        else triUV(vc, a, b, c, hint, col(o.gableCol || '#cfc5a8'));
      };
      if (o.kind === 'gable') {
        quadO(rb, [X(l0), y0, z0], [X(l0), y0, z1], [X(lm), yr, z1], [X(lm), yr, z0], hint, WHITE, uvL(z1 - z0));
        quadO(rb, [X(l1), y0, z0], [X(l1), y0, z1], [X(lm), yr, z1], [X(lm), yr, z0], hint, WHITE, uvL(z1 - z0));
        [o.z0, o.z1].forEach((z) => gableTri([X(o.l0), y0, z], [X(o.l1), y0, z], [X(lm), yr, z]));
        vc.box(X(lm), yr + 0.04, zm, 0.22, 0.14, z1 - z0 + 0.1, col(o.ridgeCol || '#3b3e43'));
      } else if (o.kind === 'gableX') {
        quadO(rb, [X(l0), y0, z0], [X(l1), y0, z0], [X(l1), yr, zm], [X(l0), yr, zm], hint, WHITE, uvL(l1 - l0));
        quadO(rb, [X(l0), y0, z1], [X(l1), y0, z1], [X(l1), yr, zm], [X(l0), yr, zm], hint, WHITE, uvL(l1 - l0));
        [o.l0, o.l1].forEach((l) => gableTri([X(l), y0, o.z0], [X(l), y0, o.z1], [X(l), yr, zm]));
        vc.box(X((l0 + l1) / 2), yr + 0.04, zm, l1 - l0 + 0.1, 0.14, 0.22, col(o.ridgeCol || '#3b3e43'));
      } else if (o.kind === 'hip') {
        const inset = Math.min((l1 - l0) / 2, (z1 - z0) / 2) * (o.hipK == null ? 1 : o.hipK);
        const rA = [X(lm), yr, z0 + inset], rB = [X(lm), yr, z1 - inset];
        quadO(rb, [X(l0), y0, z0], [X(l0), y0, z1], rB, rA, hint, WHITE, uvL(z1 - z0));
        quadO(rb, [X(l1), y0, z0], [X(l1), y0, z1], rB, rA, hint, WHITE, uvL(z1 - z0));
        triUV(rb, [X(l0), y0, z0], [X(l1), y0, z0], rA, hint, WHITE, [[0, 0], [(l1 - l0) / 2, 0], [(l1 - l0) / 4, 2]]);
        triUV(rb, [X(l0), y0, z1], [X(l1), y0, z1], rB, hint, WHITE, [[0, 0], [(l1 - l0) / 2, 0], [(l1 - l0) / 4, 2]]);
      } else if (o.kind === 'pyr') {
        const ap = [X(lm), yr, zm];
        const cs = [[l0, z0], [l1, z0], [l1, z1], [l0, z1]];
        for (let i = 0; i < 4; i++) {
          const a = cs[i], b = cs[(i + 1) % 4];
          triUV(rb, [X(a[0]), y0, a[1]], [X(b[0]), y0, b[1]], ap, hint, WHITE, [[0, 0], [(l1 - l0) / 2, 0], [(l1 - l0) / 4, o.rise / 2]]);
        }
      } else if (o.kind === 'mono') {
        // single slope, high side at l1 (away from track) when o.high === 'far', else at l0
        const hiL = o.high === 'near' ? l0 : l1;
        const loL = o.high === 'near' ? l1 : l0;
        quadO(rb, [X(loL), y0, z0], [X(loL), y0, z1], [X(hiL), yr, z1], [X(hiL), yr, z0], hint, WHITE, uvL(z1 - z0));
        vc.box(X(loL), y0 - 0.1, zm, 0.14, 0.2, z1 - z0, col(o.fasciaCol || '#3b3e43'));
      } else {
        vc.box(X(lm), y0 + 0.1, zm, l1 - l0, 0.3, z1 - z0, col(o.flatCol || '#6c7075'));
      }
    }

    function chimney(l, z, yBase, h, hex) {
      vc.box(X(l), yBase + h / 2, z, 0.7, h, 0.7, col(hex || '#8c5a48'));
      vc.box(X(l), yBase + h + 0.08, z, 0.9, 0.16, 0.9, col('#5a5a5a'));
    }
    function dormer(l, z, yBase, wBay, hex) {
      vc.box(X(l), yBase + 0.9, z, 1.4, 1.8, 1.5, col(hex));
      glassPane(X(l) - sx * 0.72, yBase + 1.0, z, 0.9, 0.9);
      roof({ kind: 'gable', mat: 'slate', l0: l - 0.7, l1: l + 0.7, z0: z - 0.75, z1: z + 0.75, y: yBase + 1.8, rise: 0.7, ov: 0.15, gableHex: hex });
    }
    function glassPane(x, y, z, w, h) {
      // a small dark window quad facing along the track-lateral axis (towards -sx)
      const b = sets.get('lubwin', () => api.mat('lub:win', () => new T.MeshStandardMaterial({ color: 0x31475a, roughness: 0.25, metalness: 0.2 })));
      b.box(x, y, z, 0.05, h, w, WHITE);
    }

    /* ---- platform furniture ---- */
    function bench(l, z, hexSeat) {
      const seat = col(hexSeat || '#8a5a30');
      const fr = col('#2e3033');
      vc.box(X(l), H + 0.45, z, 0.5, 0.06, 1.8, seat);
      vc.box(X(l) + sx * 0.22, H + 0.78, z, 0.05, 0.4, 1.8, seat);
      [-0.8, 0.8].forEach((dz) => vc.box(X(l), H + 0.22, z + dz, 0.4, 0.44, 0.06, fr));
    }
    function bin(l, z, hex) {
      vc.cyl(X(l), H + 0.45, z, 0.22, 0.9, col(hex || '#d9631a'));
    }
    function lamp(l, z, hex, hgt) {
      const h = hgt || 5;
      vc.box(X(l), H + h / 2, z, 0.12, h, 0.12, col(hex || '#7a2a2a'));
      vc.box(X(l) - sx * 0.35, H + h + 0.05, z, 0.9, 0.12, 0.3, col(hex || '#7a2a2a'));
      glow.box(X(l) - sx * 0.7, H + h - 0.04, z, 0.4, 0.08, 0.26, col('#fff1c8'));
    }
    function clockPole(l, z) {
      vc.box(X(l), H + 1.6, z, 0.1, 3.2, 0.1, col('#9aa0a4'));
      const clk = sets.get('clock', helpers.clockMat);
      textQuad(clk, [X(l), H + 3.45, z + 0.06], 0.7, 0.7, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      textQuad(clk, [X(l), H + 3.45, z - 0.06], 0.7, 0.7, [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
      vc.box(X(l), H + 3.45, z, 0.78, 0.78, 0.1, col('#1b1d20'));
    }
    // CFL blue passenger info totem (stainless foot + blue screen), faces the track
    function totem(l, z) {
      const b = sets.get('lubtotemscreen', () => api.mat('lub:totemscreen', () => new T.MeshStandardMaterial({ color: 0x1a3fa6, emissive: new T.Color(0x0d2670), emissiveIntensity: 0.9, roughness: 0.3, vertexColors: true })));
      vc.box(X(l), H + 0.5, z, 0.6, 1.0, 0.9, col('#b9bec2'));
      vc.box(X(l), H + 1.65, z, 0.28, 1.4, 0.8, col('#1d3a8a'));
      b.box(X(l) - sx * 0.15, H + 1.7, z, 0.04, 1.15, 0.64, WHITE);
    }
    function sign(l, z, label, kind) {
      const key = 'lublbl:' + label + ':' + (kind || 'blue');
      const b = sets.get(key, () => api.M.sign('lub:' + key, canvasTex('lub:' + key, 256, 128, (c, w, h) => {
        c.fillStyle = kind === 'yellow' ? '#f3b81b' : '#12365e';
        c.fillRect(0, 0, w, h);
        c.fillStyle = kind === 'yellow' ? '#14181c' : '#f7f6f1';
        c.font = '700 74px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, w / 2, h / 2 + 4);
      }, { clampU: true, clampV: true })));
      textQuad(b, [X(l) - sx * 0.04, H + 2.4, z], 0.55, 0.55, [-sx, 0, 0], [0, 0, -sx * -1], [0, 1, 0]);
      vc.box(X(l), H + 1.2, z, 0.06, 2.4, 0.06, col('#7b8186'));
    }
    // yellow-framed CFL name board (old style): white board with blue letters in a yellow tubular frame
    function yellowBoard(l, z, name) {
      const key = 'lubynm:' + name;
      const b = sets.get(key, () => api.M.sign('lub:' + key, canvasTex('lub:' + key, 512, 128, (c, w, h) => {
        c.fillStyle = '#eceae2';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#1b4aa8';
        let size = 84;
        c.font = '800 ' + size + 'px Arial';
        while (c.measureText(name.toUpperCase()).width > w - 40 && size > 28) { size -= 4; c.font = '800 ' + size + 'px Arial'; }
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(name.toUpperCase(), w / 2, h / 2 + 4);
      }, { clampU: true, clampV: true })));
      const yel = col('#f2b200');
      textQuad(b, [X(l) - sx * 0.05, H + 2.0, z], 2.4, 0.6, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
      [-1.25, 1.25].forEach((dz) => vc.box(X(l), H + 1.15, z + dz, 0.07, 2.3, 0.07, yel));
      vc.box(X(l), H + 2.38, z, 0.07, 0.07, 2.6, yel);
      vc.box(X(l), H + 1.62, z, 0.07, 0.07, 2.6, yel);
    }

    /* ---- shelters ---- */
    // flat-roofed open shelter on three walls (white brick / red brick), seats inside, opening towards the track
    function boxShelter(l, z, len, depth, hexWall, hexRoof, seats) {
      const hgt = 2.6;
      vc.box(X(l + depth - 0.1), H + hgt / 2, z, 0.2, hgt, len, col(hexWall));
      [-1, 1].forEach((d) => vc.box(X(l + depth / 2), H + hgt / 2, z + d * (len / 2 - 0.1), depth, hgt, 0.2, col(hexWall)));
      vc.box(X(l + depth / 2), H + hgt + 0.1, z, depth + 0.5, 0.2, len + 0.5, col(hexRoof), 0, 0, sx * -0.03);
      for (let i = 0; i < (seats || 4); i++) vc.box(X(l + depth - 0.55), H + 0.5, z - (seats || 4) * 0.27 + i * 0.54 + 0.27, 0.4, 0.08, 0.45, col('#7d1f26'));
    }
    // steel + glass bus-stop style shelter
    function glassShelter(l, z, len, depth, hexFrame, hexRoof) {
      const hgt = 2.7;
      const fr = col(hexFrame || '#6b7076');
      [-1, 1].forEach((d) => {
        vc.box(X(l + 0.1), H + hgt / 2, z + d * (len / 2 - 0.05), 0.1, hgt, 0.1, fr);
        vc.box(X(l + depth - 0.1), H + hgt / 2, z + d * (len / 2 - 0.05), 0.1, hgt, 0.1, fr);
      });
      vc.box(X(l + depth / 2), H + hgt + 0.06, z, depth + 0.3, 0.12, len + 0.3, col(hexRoof || '#4c5258'), 0, 0, sx * -0.04);
      glass().box(X(l + depth - 0.1), H + 1.3, z, 0.03, 2.2, len - 0.1, WHITE);
      [-1, 1].forEach((d) => glass().box(X(l + depth / 2), H + 1.3, z + d * (len / 2 - 0.05), depth - 0.1, 2.2, 0.03, WHITE));
      vc.box(X(l + depth - 0.45), H + 0.5, z, 0.4, 0.07, len - 0.6, col('#5b3a22'));
    }

    /* ---- extra track (visual): ballast, sleepers, two rails; l = lateral position of its centre, along z0..z1 ---- */
    function track(l, z0, z1, opt) {
      // declared to infra.js (helpers.addSiding): turnouts at both ends (a ladder), ballast, sleepers, rails and catenary come from there
      api.helpers.addSiding({ lat: l });
    }
    /* A side platform for a visual track: surface at H, edge facing the track at lateral lEdge, extending away by w (towards `dir`: +1 platform-side, -1 far side). */
    function platformBox(lEdge, w, dir, z0, z1) {
      const lm = lEdge + dir * w / 2;
      const conc = sets.get('lubconc', () => api.mat('lub:conc', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
      conc.box(X(lm), (H + FORM_Y) / 2, (z0 + z1) / 2, w, H - FORM_Y, z1 - z0, col('#aaa79f'));
      conc.box(X(lEdge), H - 0.05, (z0 + z1) / 2, 0.14, 0.3, z1 - z0, col('#8f8c85'));
      vc.box(X(lEdge + dir * 0.55), H + 0.012, (z0 + z1) / 2, 0.55, 0.02, z1 - z0, col('#c9b25a'));
    }

    /* Wavy canopy (Ettelbréck): strip lA..lB over z0..z1, height y0 + amp*sin(z), dark steel top, timber soffit, slanted columns. */
    function waveCanopy(o) {
      const step = o.step || 3;
      const top = col(o.topCol || '#3a4249');
      const timber = timberBatch(o.timber || '#b8834c');
      const nL = o.lSegs || 1;
      const hint = [X((o.lA + o.lB) / 2), o.y0 - 3, (o.z0 + o.z1) / 2];
      const yAt = o.fn ? o.fn : (z, l) => o.y0 + o.amp * Math.sin((z / o.per) * Math.PI * 2) + (o.tilt || 0) * ((l - o.lA) / (o.lB - o.lA) - 0.5);
      for (let z = o.z0; z < o.z1 - 0.01; z += step) {
        const z2 = Math.min(o.z1, z + step);
        const a = [X(o.lA), yAt(z, o.lA), z], b = [X(o.lA), yAt(z2, o.lA), z2];
        const c = [X(o.lB), yAt(z2, o.lB), z2], d = [X(o.lB), yAt(z, o.lB), z];
        const th = 0.34;
        const up = (p) => [p[0], p[1] + th, p[2]];
        quadO(vc, up(a), up(b), up(c), up(d), hint, top);
        quadO(timber, a, b, c, d, [hint[0], hint[1] + 20, hint[2]], WHITE, [[0, 0], [(z2 - z) / 2, 0], [(z2 - z) / 2, (o.lB - o.lA) / 2], [0, (o.lB - o.lA) / 2]]);
        // fascia on the track side and back side
        [[a, b], [d, c]].forEach(([p, q], i) => quadO(vc, p, q, up(q), up(p), [X(i ? o.lA : o.lB), p[1], p[2]], top));
        if (Math.round(z / step) % 2 === 0) glow.box(X((o.lA + o.lB) / 2), yAt(z, (o.lA + o.lB) / 2) - 0.04, z + step / 2, 0.5, 0.05, 1.6, col('#fff3d0'));
      }
      const colEvery = o.colEvery || 15;
      for (let z = o.z0 + 4; z < o.z1; z += colEvery) {
        const lf = o.colFoot, lt = o.colTop == null ? o.lA + (o.lB - o.lA) * 0.35 : o.colTop;
        [-0.5, 0.5].forEach((dz) => k_between([X(lf), H, z + dz * 2.2], [X(lt), yAt(z + dz * 2.2, lt) - 0.1, z + dz * 2.2], 0.2, col(o.colCol || '#2e353b')));
      }
    }
    function paving(lA, lB, z0, z1, hex) {
      const b = sets.get('lubpave', () => api.mat('lub:pave', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
      b.box(X((lA + lB) / 2), FORM_Y + 0.06, (z0 + z1) / 2, lB - lA, 0.14, z1 - z0, col(hex));
    }
    const k_between = (a, b, t, c) => vc.between(a, b, t, c);
    // glass lift shaft with a steel frame and sliding door (l = lateral centre, z; top = roof underside)
    function lift(l, z, topY) {
      const fr = col('#46505a');
      const hw = 1.1;
      [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]].forEach(([dl, dz]) => vc.box(X(l + dl), (H + topY) / 2, z + dz, 0.12, topY - H, 0.12, fr));
      glass().box(X(l), (H + topY) / 2, z, 2.3, topY - H - 0.1, 2.3, WHITE);
      vc.box(X(l), topY + 0.08, z, 2.5, 0.16, 2.5, col('#59616a'));
      vc.box(X(l), H + 1.2, z, 1.4, 2.4, 1.4, col('#c8ccd0'));
    }
    function stairOpening(l, z, len) {
      const b = sets.get('lubdark', () => api.mat('lub:dark', () => new T.MeshStandardMaterial({ color: 0x15171a, roughness: 1 })));
      b.box(X(l), H + 0.015, z, 2.4, 0.02, len, WHITE);
      [-1.25, 1.25].forEach((d) => {
        vc.box(X(l + d), H + 0.55, z, 0.05, 0.05, len, col('#9aa0a4'));
        vc.box(X(l + d), H + 0.28, z, 0.04, 0.55, 0.04, col('#9aa0a4'));
        vc.box(X(l + d), H + 0.28, z - len / 2, 0.04, 0.55, 0.04, col('#9aa0a4'));
        vc.box(X(l + d), H + 0.28, z + len / 2, 0.04, 0.55, 0.04, col('#9aa0a4'));
      });
    }

    /* Lean-to platform canopy hugging a building: high edge at lHi (wall), low edge at lLo; timber soffit, dark top, iron posts + brackets. */
    function leanCanopy(o) {
      const timber = timberBatch(o.timber || '#a06f40');
      const top = col(o.topCol || '#4b4540');
      const hint = [X((o.lHi + o.lLo) / 2), o.yLo - 3, (o.z0 + o.z1) / 2];
      const a = [X(o.lHi), o.yHi, o.z0], b = [X(o.lHi), o.yHi, o.z1], c = [X(o.lLo), o.yLo, o.z1], d = [X(o.lLo), o.yLo, o.z0];
      const lenL = Math.hypot(o.lHi - o.lLo, o.yHi - o.yLo);
      quadO(timber, a, b, c, d, [hint[0], hint[1] + 20, hint[2]], WHITE, [[0, 0], [(o.z1 - o.z0) / 2, 0], [(o.z1 - o.z0) / 2, lenL / 2], [0, lenL / 2]]);
      const up = (p) => [p[0], p[1] + 0.16, p[2]];
      quadO(vc, up(a), up(b), up(c), up(d), hint, top);
      vc.box(X(o.lLo), o.yLo + 0.02, (o.z0 + o.z1) / 2, 0.16, 0.34, o.z1 - o.z0, top);
      const post = col(o.postCol || '#26282b');
      for (let z = o.z0 + 1.5; z <= o.z1 - 1; z += o.postEvery || 6.4) {
        vc.box(X(o.lLo + 0.4), (H + o.yLo) / 2, z, 0.2, o.yLo - H, 0.2, post);
        vc.between([X(o.lLo + 0.4), o.yLo - 0.2, z], [X(o.lLo + (o.lHi - o.lLo) * 0.55), o.yLo + (o.yHi - o.yLo) * 0.6 - 0.1, z], 0.1, post, 0.14);
      }
      for (let z = o.z0 + 4; z < o.z1; z += 9) glow.box(X(o.lLo + (o.lHi - o.lLo) * 0.4), o.yLo + (o.yHi - o.yLo) * 0.4 - 0.05, z, 0.5, 0.05, 1.4, col('#fff3d0'));
    }
    // yellow-framed CFL poster/display board on legs (Ettelbréck, Oetrange, Wilwerwiltz style)
    function yellowDisplay(l, z) {
      const yel = col('#f2b200');
      vc.box(X(l), H + 1.0, z - 0.45, 0.07, 2.0, 0.07, yel);
      vc.box(X(l), H + 1.0, z + 0.45, 0.07, 2.0, 0.07, yel);
      vc.box(X(l), H + 2.02, z, 0.07, 0.07, 1.0, yel);
      vc.box(X(l) - sx * 0.03, H + 1.35, z, 0.03, 1.2, 0.8, col('#f4efe4'));
    }

    // textured box in (l, y, z) space: batch UVs scale 1 per `u` metres; faces: all except the bottom
    function texBox(batch, l0, l1, y0, y1, z0, z1, u, colr) {
      const c = colr || WHITE;
      const q = u || 2.4;
      const xa = X(l0), xb = X(l1);
      const hint = [(xa + xb) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      const dz = (z1 - z0) / q, dl = Math.abs(l1 - l0) / q, dy = (y1 - y0) / q;
      quadO(batch, [xa, y0, z0], [xa, y0, z1], [xa, y1, z1], [xa, y1, z0], hint, c, [[0, 0], [dz, 0], [dz, dy], [0, dy]]);
      quadO(batch, [xb, y0, z0], [xb, y0, z1], [xb, y1, z1], [xb, y1, z0], hint, c, [[0, 0], [dz, 0], [dz, dy], [0, dy]]);
      [z0, z1].forEach((z) => quadO(batch, [xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], hint, c, [[0, 0], [dl, 0], [dl, dy], [0, dy]]));
      quadO(batch, [xa, y1, z0], [xb, y1, z0], [xb, y1, z1], [xa, y1, z1], hint, c, [[0, 0], [dl, 0], [dl, dz], [0, dz]]);
    }

    // round clock face on a wall facing the track (side = -1 platform side of a wall, +1 street side)
    function clockFace(l, y, z, size, side) {
      const clk = sets.get('clock', helpers.clockMat);
      const nx = side > 0 ? sx : -sx;
      textQuad(clk, [X(l), y, z], size, size, [nx, 0, 0], [0, 0, -nx], [0, 1, 0]);
      vc.box(X(l) - nx * 0.03, y, z, 0.05, size + 0.2, size + 0.2, col('#ece8dc'));
    }
    function cylTower(l, z, r, y0, y1, hex) {
      vc.cyl(X(l), (y0 + y1) / 2, z, r, y1 - y0, col(hex));
    }

    // old maroon cast-iron gas-lantern style lamp (Clervaux, Walferdange)
    function lampOld(l, z, hex) {
      const m = col(hex || '#6a2b3a');
      vc.box(X(l), H + 0.35, z, 0.34, 0.7, 0.34, m);
      vc.cyl(X(l), H + 2.0, z, 0.075, 2.6, m);
      vc.box(X(l), H + 3.35, z, 0.22, 0.14, 0.22, m);
      vc.box(X(l), H + 3.75, z, 0.4, 0.62, 0.4, col('#ddd6b4'));
      vc.box(X(l), H + 4.15, z, 0.5, 0.14, 0.5, m);
      glow.box(X(l), H + 3.75, z, 0.3, 0.45, 0.3, col('#fff1c8'));
    }
    // flat paved strip (cobble/setts) on the platform surface
    function paveStrip(lA, lB2, z0, z1, hex, key) {
      const b = tex('pv:' + (key || hex), { w: 128, h: 128, draw: (c, w, h) => {
        const r = mulb(hashCode(hex) + 5);
        c.fillStyle = mix(hex, 0.45);
        c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 16) for (let x = -((y / 16) % 2) * 8; x < w; x += 16) { c.fillStyle = mix(hex, 0.7 + r() * 0.35); c.fillRect(x + 1.2, y + 1.2, 13.6, 13.6); }
      } }, false);
      const y = H + 0.02;
      quadO(b, [X(lA), y, z0], [X(lB2), y, z0], [X(lB2), y, z1], [X(lA), y, z1], [X((lA + lB2) / 2), -5, (z0 + z1) / 2], WHITE, [[0, 0], [Math.abs(lB2 - lA) / 2, 0], [Math.abs(lB2 - lA) / 2, (z1 - z0) / 2], [0, (z1 - z0) / 2]]);
    }
    // glass-roofed shelter with maroon frame, brick piers and timber slat benches
    function glassRoofShelter(l, z, wd, len) {
      const fr = col('#6a2b3a');
      const post = col('#b6b9bb');
      const brick = col('#9b4f3b');
      const lm = l + wd / 2;
      const hint = [X(lm), H + 1, z];
      [-1, 1].forEach((d) => [0, 1].forEach((e) => {
        vc.box(X(l + e * wd), H + 1.3, z + d * len / 2, 0.14, 2.6, 0.14, post);
      }));
      const yE = H + 2.7, yP = H + 4.0;
      const g = glass();
      quadO(g, [X(l - 0.3), yE, z - len / 2], [X(l - 0.3), yE, z + len / 2], [X(lm), yP, z + len / 2], [X(lm), yP, z - len / 2], [hint[0], hint[1] - 5, hint[2]], WHITE);
      quadO(g, [X(l + wd + 0.3), yE, z - len / 2], [X(l + wd + 0.3), yE, z + len / 2], [X(lm), yP, z + len / 2], [X(lm), yP, z - len / 2], [hint[0], hint[1] - 5, hint[2]], WHITE);
      [-1, 1].forEach((d) => {
        vc.between([X(l - 0.3), yE, z + d * len / 2], [X(lm), yP, z + d * len / 2], 0.1, fr, 0.1);
        vc.between([X(l + wd + 0.3), yE, z + d * len / 2], [X(lm), yP, z + d * len / 2], 0.1, fr, 0.1);
      });
      vc.box(X(lm), yP, z, 0.12, 0.12, len, fr);
      vc.box(X(l - 0.3), yE, z, 0.12, 0.12, len, fr);
      vc.box(X(l + wd + 0.3), yE, z, 0.12, 0.12, len, fr);
      [0.3, wd - 0.3].forEach((e) => vc.box(X(l + e), H + 0.5, z, 0.3, 1.0, len - 0.4, brick));
      for (let i = 0; i < 5; i++) vc.box(X(l + 0.3), H + 0.5 + i * 0.2, z, 0.1, 0.12, len - 0.5, col('#8b3a3f'));
    }
    // concrete footbridge over the track (deck above 7.4 m), stone pier on the platform side, green lattice railing
    function footbridge(z, lFrom, lTo) {
      const deck = col('#8e8b84');
      const yD = 7.6;
      const lm = (lFrom + lTo) / 2;
      vc.box(X(lm), yD, z, Math.abs(lTo - lFrom), 0.9, 3.2, deck);
      const green = col('#2f6f5e');
      [-1.5, 1.5].forEach((dz) => {
        vc.box(X(lm), yD + 1.25, z + dz, Math.abs(lTo - lFrom), 0.07, 0.07, green);
        vc.box(X(lm), yD + 0.78, z + dz, Math.abs(lTo - lFrom), 0.05, 0.05, green);
        for (let l = Math.min(lFrom, lTo); l <= Math.max(lFrom, lTo); l += 1.6) vc.box(X(l), yD + 0.9, z + dz, 0.05, 0.9, 0.05, green);
      });
      const stone = plainBatch('#8a8576');
      [lFrom, lTo].forEach((l) => {
        if (Math.abs(l) > 9) texBox(stone, l - 1.2, l + 1.2, FORM_Y, yD, z - 1.6, z + 1.6, 3, WHITE);
      });
      // paved deck + a stair flight down to the ground at both ends (infra.js helpers): nothing ends in the air
      api.helpers.addBridgeDeck({ lat0: lFrom, lat1: lTo, z, width: 3.2, yTop: yD + 0.45, kind: 'foot', inset: 0.2 });
      [[lFrom, Math.sign(lFrom - lTo)], [lTo, Math.sign(lTo - lFrom)]].forEach(([l, out]) => api.helpers.addBridgeApproach({ lat: l + out * 0.2, out, z, width: 3.2, yTop: yD + 0.45, kind: 'foot' }));
    }

    // generic house: walls + roof + eaves band. o = { l0, dep, z0, z1, floors, FL, spec, specBack, specEnd, key, kind, mat, rise, ov, wall, eaveCol, base, gab }
    function house(o) {
      const w = walls({ l0: o.l0, l1: o.l0 + o.dep, z0: o.z0, z1: o.z1, floors: o.floors, floorM: o.FL, front: o.spec, frontKey: o.key + 'F', back: o.specBack || o.spec, backKey: o.key + (o.specBack ? 'B' : 'F'), end: o.specEnd || o.spec, endKey: o.key + (o.specEnd ? 'E' : 'F'), baseCol: o.base || '#9a9486', yF: o.yF });
      roof({ kind: o.kind, mat: o.mat || 'slate', l0: o.l0, l1: o.l0 + o.dep, z0: o.z0, z1: o.z1, y: w.eaves + 0.12, rise: o.rise, ov: o.ov == null ? 0.5 : o.ov, gableTex: o.gab, gableHex: o.gab ? null : o.wall, high: o.high });
      if (o.eaveCol) vc.box(X(o.l0 + o.dep / 2), w.eaves + 0.04, (o.z0 + o.z1) / 2, o.dep + 0.3, 0.22, o.z1 - o.z0 + 0.3, col(o.eaveCol));
      return w;
    }
    // open flat-roofed shelter on posts (maroon steel + coloured roof) with benches
    function postShelter(l, z, wd, len, hexRoof, hexPost) {
      const pc = col(hexPost || '#6a2b3a');
      [-1, 1].forEach((d) => [0, 1].forEach((e) => vc.box(X(l + e * wd), H + 1.35, z + d * (len / 2 - 0.1), 0.14, 2.7, 0.14, pc)));
      vc.box(X(l + wd / 2), H + 2.78, z, wd + 0.7, 0.16, len + 0.7, col(hexRoof || '#8a2a2e'));
      for (let i = 0; i < 3; i++) vc.box(X(l + wd - 0.3), H + 0.5, z - 1.1 + i * 1.1, 0.4, 0.07, 0.95, col('#7d1f26'));
    }
    // white timber waiting shelter with an open front and bracketed gable roof (Betzdorf)
    function timberShelter(l, z, wd, len, hexWall, hexRoof) {
      const wl = col(hexWall || '#efece4');
      const hgt = 2.7;
      vc.box(X(l + wd), H + hgt / 2, z, 0.14, hgt, len, wl);
      [-1, 1].forEach((d) => {
        vc.box(X(l + wd / 2), H + hgt / 2, z + d * (len / 2 - 0.07), wd, hgt, 0.14, wl);
        const b = sets.get('lubwin', () => api.mat('lub:win', () => new T.MeshStandardMaterial({ color: 0x31475a, roughness: 0.25, metalness: 0.2 })));
        b.box(X(l + wd / 2), H + 1.5, z + d * (len / 2 + 0.01), wd * 0.6, 0.9, 0.04, WHITE);
      });
      roof({ kind: 'gable', mat: 'tile', l0: l, l1: l + wd, z0: z - len / 2, z1: z + len / 2, y: H + hgt, rise: 1.0, ov: 0.6, gableHex: hexWall || '#efece4' });
      [-1, 1].forEach((d) => vc.between([X(l + 0.1), H + hgt - 0.5, z + d * (len / 2 - 0.6)], [X(l - 0.4), H + hgt, z + d * (len / 2 - 0.6)], 0.1, wl, 0.1));
      for (let i = 0; i < 5; i++) vc.box(X(l + wd - 0.5), H + 0.5, z - 1.3 + i * 0.65, 0.4, 0.07, 0.5, col('#7d1f26'));
    }
    function silo(l, z, w, hBase, hTop) {
      vc.box(X(l), (FORM_Y + hBase) / 2, z, w, hBase - FORM_Y, w, col('#9a978f'));
      vc.box(X(l), (hBase + hTop) / 2, z, w + 0.4, hTop - hBase, w + 0.4, col('#8b6446'));
      vc.box(X(l), hTop + 0.4, z, w + 1.0, 0.8, w + 1.0, col('#5a5650'));
    }
    function bikebox(l, z) {
      vc.box(X(l), H + 1.2, z, 2.4, 2.4, 4.2, col('#cfd2d4'));
      vc.box(X(l) - sx * 1.22, H + 1.1, z, 0.05, 2.0, 1.4, col('#b52a2a'));
    }

    // parked cars (simple boxes) in a row: l = lateral position of the row, z0..z1, count; deterministic colours
    function cars(l, z0, z1, n, seed) {
      const palette = ['#c9ccd0', '#2c3036', '#7a8794', '#a63a32', '#e5e3dc', '#2d4f7a', '#444b52', '#b8b2a2'];
      const r = mulb(seed || 3);
      const asph = sets.get('lubasph', () => api.mat('lub:asph', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
      asph.box(X(l), FORM_Y + 0.06, (z0 + z1) / 2, 6.2, 0.14, z1 - z0 + 2, col('#5b5e62'));
      for (let i = 0; i < n; i++) {
        const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
        if (r() < 0.2) continue;
        const c = col(palette[Math.floor(r() * palette.length)]);
        vc.box(X(l), FORM_Y + 0.75, z, 1.7, 0.7, 4.3, c);
        vc.box(X(l), FORM_Y + 1.35, z - 0.1, 1.5, 0.55, 2.3, col('#26303a'));
      }
    }

    return { cars, house, postShelter, timberShelter, silo, bikebox, lampOld, paveStrip, glassRoofShelter, footbridge, clockFace, cylTower, texBox, concBatch, leanCanopy, yellowDisplay, paving, waveCanopy, lift, stairOpening, X, vc, glow, glass, glassDark, steel, tex, matTex, facadeBatch, roofBatch, timberBatch, plainBatch, quadO, triUV, walls, roof, chimney, dormer, glassPane, bench, bin, lamp, clockPole, totem, sign, yellowBoard, boxShelter, glassShelter, track, platformBox, steelB: steel };
  }

  // the kit is shared with the later station files (stations-lu-c.js ...)
  window.TS.stationKits = Object.assign(window.TS.stationKits || {}, { luB: makeKit });

  /* ================================================================ PAFENDALL-KIERCHBIERG (Pfaffenthal-Kirchberg)
   * Refs: refs/ST-LU-B/Pafendall_1..4 + Pafendall_s* (Commons: Gare Pfaffenthal-Kirchberg 10-2017 *, Luxembourg Kirchberg-Pfaffenthal station 2024 *).
   * 2017 station in the Alzette valley cut: two side platforms with silver folded (origami) canopies, grey tiled platforms, concrete retaining
   * wall + rock bank, the big board-marked concrete block with glass lift shafts and a dark flat roof slab (funicular link), the red steel
   * V-legs of the Pont Grand-Duchesse Charlotte (Red Bridge) overhead. */
  reg('Pafendall-Kierchbierg', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W; // platform back edge
      const conc = k.concBatch();
      const steel = k.steel();
      // low concrete retaining wall + steel posts behind the platform, wooded rock bank rising above
      k.texBox(conc, lB + 0.05, lB + 0.6, FORM_Y, 1.9, -115, 115, 2.4);
      const bank = k.tex('lubbank', { w: 64, h: 64, draw: (c, w, h) => { const r = mulb(77); c.fillStyle = '#4f5f3c'; c.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { c.fillStyle = 'rgba(' + (r() > 0.5 ? '25,45,20' : '110,98,76') + ',0.3)'; c.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 3); } } });
      const bz0 = -120, bz1 = 120;
      k.quadO(bank, [X(lB + 0.6), 1.9, bz0], [X(lB + 0.6), 1.9, bz1], [X(lB + 12), 14, bz1], [X(lB + 12), 14, bz0], [X(lB), 0, 0], WHITE, [[0, 0], [60, 0], [60, 6], [0, 6]]);
      // silver folded canopy over the platform (sawtooth in z gives the faceted look), anthracite soffit, LED strips
      const saw = (z, l) => { const t = ((z + 200) / 14) % 1; const tri = t < 0.5 ? t * 2 : 2 - t * 2; return 4.3 + 0.8 * tri + 0.4 * ((l - (edge + 0.9)) / (W - 0.9)); };
      k.waveCanopy({ lA: edge + 0.9, lB: lB - 0.2, z0: -105, z1: 105, fn: saw, step: 7, topCol: '#bcc4ca', timber: '#6c737a', colFoot: lB - 0.3, colTop: lB - 0.3, colEvery: 7, colCol: '#9aa2a8' });
      // the central concrete block with glass lift shafts and the dark roof slab (z = -40), funicular link behind
      const bz = -40;
      k.texBox(conc, lB + 0.6, lB + 11, FORM_Y, 15, bz - 9, bz + 9, 2.4);
      k.texBox(steel, lB - 2.4, lB + 13.5, 15, 15.8, bz - 18, bz + 18, 4, col('#3e454c'));
      k.lift(lB - 0.9, bz - 5, 14.8);
      k.lift(lB - 0.9, bz + 5, 14.8);
      [-1, 1].forEach((d) => {
        const a = [X(lB + 0.7), 9.5, bz + d * 9.5];
        const b = [X(lB - 0.5), H + 0.4, bz + d * 17];
        k.glass().between(a, b, 2.6, WHITE, 0.15);
        vc.between(a, b, 0.14, col('#46505a'), 0.14);
      });
      // totems, benches, clock poles, railings on the platform
      [-85, -62, -20, 14, 50, 82].forEach((z) => k.totem(edge + 1.6, z));
      [-72, -52, -4, 30, 68].forEach((z) => k.bench(lB - 1.0, z, '#7b5a3a'));
      [-95, 95].forEach((z) => k.clockPole(edge + 2.8, z));
      // opposite side: second track and side platform with its own silver canopy and wall (visual only)
      k.track(-9.2, -125, 125, { pole: true });
      k.platformBox(-10.9, 4.6, -1, -118, 118);
      k.texBox(conc, -15.6, -16.2, FORM_Y, 1.9, -118, 118, 2.4);
      const saw2 = (z, l) => { const t = ((z + 200) / 14) % 1; const tri = t < 0.5 ? t * 2 : 2 - t * 2; return 4.55 + 0.9 * tri - 0.3 * ((-l - 11.8) / 3.6); };
      k.waveCanopy({ lA: -11.8, lB: -15.5, z0: -105, z1: 105, fn: saw2, step: 7, topCol: '#bcc4ca', timber: '#6c737a', colFoot: -14.9, colTop: -14.9, colEvery: 7, colCol: '#9aa2a8' });
      [-70, -20, 30, 75].forEach((z) => k.totem(-12.2, z));
      // the Red Bridge: red steel V-legs and deck high above, a little ahead of the platform (z = -170)
      const rb = k.tex('lubredsteel', { w: 8, h: 8, draw: (c, w, h) => { c.fillStyle = '#a63a2c'; c.fillRect(0, 0, w, h); } });
      const rz = -175;
      vc.box(X(0), 58, rz, 170, 5.4, 26, col('#b3402f'));
      vc.box(X(0), 61, rz, 170, 0.5, 26.5, col('#d9d7d0'));
      [-1, 1].forEach((d) => {
        vc.between([X(d * 18), 55.5, rz - 8], [X(d * 52), -1, rz - 8], 4.2, col('#a63a2c'), 4.8);
        vc.between([X(d * 18), 55.5, rz + 8], [X(d * 52), -1, rz + 8], 4.2, col('#a63a2c'), 4.8);
        vc.between([X(d * 18), 55.5, rz - 8], [X(d * 18), 55.5, rz + 8], 3.4, col('#a63a2c'), 3.4);
        // abutment: the deck ends on a solid concrete block standing on the valley side and the road continues over it (nothing ends in the air)
        vc.box(X(d * 92.5), 58, rz, 15, 5.4, 26, col('#b3402f'));
        vc.box(X(d * 92.5), 61, rz, 15, 0.5, 26.5, col('#d9d7d0'));
        vc.box(X(d * 92.5), (55.3 + FORM_Y) / 2, rz, 15, 55.3 - FORM_Y, 24, col('#a9a69f'));
        api.helpers.registerBridgeEnd({ lat: d * 98, out: d, z: rz, y: 60.7, kind: 'abutment' });
      });
      api.helpers.addBridgeDeck({ lat0: -100, lat1: 100, z: rz, width: 26, yTop: 60.7, kind: 'road', inset: 1.5 });
    },
  });

  /* ================================================================ WASSERBËLLEG
   * Refs: refs/ST-LU-B/Wasserbilleg_1..5 (Commons: Wasserbillig, gare CFL (103)/(104)/(118)/(136)/(115); Gare Wasserbillig 01).
   * Cream/ochre plastered two-storey building, steep dark slate roofs, a clock in the central roof pediment, white window surrounds with
   * arched ground-floor windows, long light grey lean-to canopy on the platform, a 3-storey signal tower with a flat overhanging roof, the
   * grey concrete water tower, the ochre goods shed, island platform and more tracks across (the Moselle/Sauer town behind). */
  reg('Wasserbëlleg', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const FL = 3.55;
      const cz = -34;
      const wall = '#f0dcae';
      const trim = '#f3eee2';
      const fr = '#4a3524';
      const specG = { bayM: 3.4, floorM: FL, floors: [{ k: 'arch', ww: 1.25, wh: 2.65, sy: 0.35 }, { k: 'rect', ww: 1.05, wh: 1.75, sy: 0.65 }], wall, trim, frame: fr, glassTop: '#5b5047', glassBot: '#8f8479', sill: false, band: true };
      const specD = { bayM: 3.4, floorM: FL, floors: [{ k: 'door', ww: 1.35, wh: 2.75, sy: 0, col: '#5a3a22', panel: '#6a4429' }, { k: 'rect', ww: 1.05, wh: 1.75, sy: 0.65 }], wall, trim, frame: fr, glassTop: '#5b5047', glassBot: '#8f8479', sill: false };
      const specE = { bayM: 3.4, floorM: FL, floors: [{ k: 'blank' }, { k: 'rect', ww: 0.95, wh: 1.5, sy: 0.9 }], wall, trim, frame: fr, glassTop: '#5b5047', glassBot: '#8f8479', sill: false };
      const specTop = { bayM: 3.4, floorM: FL, floors: [{ k: 'blank' }], wall, trim, frame: fr };
      const gab = { b: k.facadeBatch('wasTop', specTop), bayM: 3.4, floorM: FL };
      // wings + main body (z runs along the platform)
      const parts = [
        { z0: cz - 27, z1: cz - 13.6, dep: 8.8, spec: specG, key: 'wasL', kind: 'hip', rise: 4.4 },
        { z0: cz - 13.6, z1: cz + 13.6, dep: 11.2, spec: specG, key: 'wasM', kind: 'gable', rise: 5.6 },
        { z0: cz + 13.6, z1: cz + 30.6, dep: 9.6, spec: specG, key: 'wasR', kind: 'gable', rise: 5.0 },
      ];
      parts.forEach((p) => {
        const w = k.walls({ l0, l1: l0 + p.dep, z0: p.z0, z1: p.z1, floors: 2, floorM: FL, front: p.spec, frontKey: p.key + 'F', back: p.spec, backKey: p.key + 'F', end: specE, endKey: 'wasE', baseCol: '#a39070' });
        k.roof({ kind: p.kind, mat: 'slate', l0, l1: l0 + p.dep, z0: p.z0, z1: p.z1, y: w.eaves + 0.2, rise: p.rise, ov: 0.55, gableTex: gab });
        vc.box(X(l0 + p.dep / 2), w.eaves + 0.05, (p.z0 + p.z1) / 2, p.dep + 0.5, 0.25, p.z1 - p.z0 + 0.5, col('#cdb98a'));
      });
      const eavesY = H + 2 * FL;
      // central pediment (wall dormer) with the station clock, facing the platform and the street
      k.texBox(k.plainBatch(wall), l0 - 0.4, l0 + 3.6, eavesY, eavesY + 2.4, cz - 3.6, cz + 3.6, 3);
      k.roof({ kind: 'gableX', mat: 'slate', l0: l0 - 0.4, l1: l0 + 3.6, z0: cz - 3.6, z1: cz + 3.6, y: eavesY + 2.4, rise: 3.0, ov: 0.35, gableHex: wall });
      k.clockFace(l0 - 0.42, eavesY + 1.15, cz, 1.7, -1);
      k.chimney(l0 + 3, cz - 8, eavesY + 2.5, 2.4, '#a58f72');
      k.chimney(l0 + 8, cz + 9, eavesY + 2.5, 2.4, '#a58f72');
      k.chimney(l0 + 5, cz + 24, eavesY + 2.2, 2.2, '#a58f72');
      // CFL plate over the door
      vc.box(X(l0 - 0.05), H + 3.5, cz, 0.05, 0.45, 1.6, col('#f0f0ec'));
      vc.box(X(l0 - 0.08), H + 3.5, cz, 0.05, 0.28, 0.9, col('#e0801a'));
      // long lean-to canopy (light grey sheet roof) along the building, iron posts
      k.leanCanopy({ lHi: l0 - 0.2, lLo: edge + 2.3, yHi: H + 3.9, yLo: H + 3.2, z0: cz - 28, z1: cz + 32, topCol: '#8f969b', timber: '#9a7a55', postCol: '#3c4147', postEvery: 5 });
      // signal tower: three storeys, cream, flat roof overhang, window band
      const tz = cz + 56;
      const specT = { bayM: 3.0, floorM: 3.2, floors: [{ k: 'blank' }, { k: 'rect', ww: 1.0, wh: 1.4, sy: 0.9 }, { k: 'rect', ww: 2.4, wh: 1.5, sy: 0.7 }], wall, trim, frame: '#ece8dc', glassTop: '#3d4a52', glassBot: '#7d8b94', sill: false };
      const tw = k.walls({ l0: lB - 1.0, l1: lB + 5.2, z0: tz - 3.2, z1: tz + 3.2, floors: 3, floorM: 3.2, front: specT, frontKey: 'wasT', back: specT, backKey: 'wasT', end: specT, endKey: 'wasT', baseCol: '#a39070' });
      vc.box(X(lB + 2.1), tw.eaves + 0.15, tz, 8.4, 0.3, 8.4, col('#8d9296'));
      // water tower (grey concrete cylinder with a wider tank) behind the platform
      k.cylTower(15.5, tz + 22, 3.9, FORM_Y, 21, '#bdb9b0');
      k.cylTower(15.5, tz + 22, 5.1, 21, 25.5, '#aaa69d');
      // goods shed: ochre, brown timber canopy on the track side
      const gz = cz - 66;
      const specS = { bayM: 4, floorM: 4.6, floors: [{ k: 'rect', ww: 1.8, wh: 2.0, sy: 1.2 }], wall: '#d9b778', trim: '#b99a62', frame: '#5b3a25', sill: false, band: false };
      const sw = k.walls({ l0: lB + 0.4, l1: lB + 9, z0: gz - 12, z1: gz + 12, floors: 1, floorM: 4.6, front: specS, frontKey: 'wasS', back: specS, backKey: 'wasS', end: specS, endKey: 'wasS', baseCol: '#a39070' });
      k.roof({ kind: 'gable', mat: 'tile', l0: lB + 0.4, l1: lB + 9, z0: gz - 12, z1: gz + 12, y: sw.eaves + 0.1, rise: 2.4, ov: 0.6, gableHex: '#d9b778' });
      k.leanCanopy({ lHi: lB + 0.3, lLo: edge + 3.4, yHi: H + 3.9, yLo: H + 3.3, z0: gz - 12, z1: gz + 12, topCol: '#5a4535', timber: '#8a6038', postCol: '#4a3a2e', postEvery: 6 });
      // platform furniture
      [-60, -34, 4, 26].forEach((z) => k.bench(l0 - 0.9, z, '#8a1f26'));
      [-72, -48, -20, 12, 40].forEach((z) => k.totem(edge + 1.5, z));
      [-14, 20, 44].forEach((z) => k.bin(edge + 2.6, z, '#d9631a'));
      [-92, 88].forEach((z) => k.clockPole(edge + 3.2, z));
      // across: island platform between two more tracks, flat steel canopy
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 3.4, -1, -120, 100);
      k.track(-16.0, -135, 135, { pole: true });
      k.waveCanopy({ lA: -11.4, lB: -13.8, z0: -50, z1: 70, fn: () => 4.1, step: 8, topCol: '#9aa0a5', timber: '#8d9296', colFoot: -13.5, colTop: -13.5, colEvery: 8, colCol: '#4a5258' });
      [-60, -10, 40, 80].forEach((z) => k.totem(-12.0, z));
    },
  });

  /* ================================================================ CLIERF (Clervaux)
   * Refs: refs/ST-LU-B/Clierf_1..4 (Commons: Clervaux, gare CFL Clervaux (102)/(103)/(105)/(106); Clervaux Gare vers sud 2022).
   * White-plastered two-storey building with sandstone window surrounds and red doors, weathered slate roof, brick chimney, low annex;
   * cobbled platform strip, ornate maroon cast-iron lamps, maroon-framed glass-roofed shelter over the underpass stairs, concrete footbridge
   * with green railings at the north end, second platform across, steep wooded Ardennes valley. */
  reg('Clierf', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const FL = 3.5;
      const cz = -44;
      const wall = '#f1eee6';
      const trim = '#c7a690';
      const sp = { bayM: 3.5, floorM: FL, wall, trim, frame: '#ece7dc', glassTop: '#4b5a68', glassBot: '#8798a6', sill: true, band: true };
      const specF = Object.assign({}, sp, { floors: [{ k: 'door', ww: 1.15, wh: 2.55, sy: 0, col: '#b02a2a', panel: '#b02a2a' }, { k: 'rect', ww: 1.0, wh: 1.65, sy: 0.75 }] });
      const specW = Object.assign({}, sp, { floors: [{ k: 'rect', ww: 1.15, wh: 1.8, sy: 0.8 }, { k: 'rect', ww: 1.0, wh: 1.65, sy: 0.75 }] });
      const specE = Object.assign({}, sp, { bayM: 4, floors: [{ k: 'rect', ww: 1.0, wh: 1.6, sy: 0.9 }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.75 }] });
      const specA = Object.assign({}, sp, { floors: [{ k: 'door', ww: 1.15, wh: 2.55, sy: 0, col: '#b02a2a', panel: '#b02a2a' }] });
      const gab = { b: k.facadeBatch('clGab', Object.assign({}, sp, { floors: [{ k: 'blank' }] })), bayM: 3.5, floorM: FL };
      // main block: 6 bays, gable roof (ridge along the track), a hipped lower annex towards the front of the platform
      const m = k.walls({ l0, l1: l0 + 9, z0: cz - 11, z1: cz + 11, floors: 2, floorM: FL, front: specF, frontKey: 'clF', back: specW, backKey: 'clB', end: specE, endKey: 'clE', baseCol: '#8f8a80' });
      k.roof({ kind: 'gable', mat: 'slateb', l0, l1: l0 + 9, z0: cz - 11, z1: cz + 11, y: m.eaves + 0.15, rise: 3.6, ov: 0.55, gableTex: gab });
      vc.box(X(l0 + 4.5), m.eaves + 0.05, cz, 9.6, 0.2, 22.6, col('#d8d2c4'));
      // round window in both gables
      [-1, 1].forEach((d) => {
        vc.box(X(l0 + 4.5) - sx * 0.0, m.eaves + 1.35, cz + d * 11.04, 0.9, 0.9, 0.06, col('#e7e1d2'));
        vc.box(X(l0 + 4.5), m.eaves + 1.35, cz + d * 11.08, 0.6, 0.6, 0.05, col('#37424c'));
      });
      const a = k.walls({ l0: l0 + 1, l1: l0 + 7, z0: cz - 19, z1: cz - 11, floors: 1, floorM: FL, front: specA, frontKey: 'clA', back: specA, backKey: 'clA', end: specE, endKey: 'clAE', baseCol: '#8f8a80' });
      k.roof({ kind: 'hip', mat: 'slateb', l0: l0 + 1, l1: l0 + 7, z0: cz - 19, z1: cz - 11, y: a.eaves + 0.1, rise: 2.0, ov: 0.45 });
      k.chimney(l0 + 6.5, cz + 4, m.eaves + 2.2, 3.0, '#a5492f');
      // cobbled strip along the building, ornate maroon lamps, benches, red ticket machine
      k.paveStrip(lB - 3.2, lB, cz - 25, cz + 14, '#b3a48c', 'cobCl');
      [-26, -8, 12, 34, 56].forEach((z) => k.lampOld(lB - 2.0, cz + z));
      [-6, 8].forEach((z) => k.bench(lB - 0.9, cz + z, '#a8321f'));
      vc.box(X(lB - 0.9), H + 0.9, cz + 14, 0.5, 1.8, 0.8, col('#c42a24'));
      // glass-roofed shelter over the underpass stairs
      k.glassRoofShelter(lB - 4.6, cz - 31, 3.9, 8);
      // totems / signs / bins
      [-70, -50, 6, 40].forEach((z) => k.totem(edge + 1.5, z));
      [-86, 54].forEach((z) => k.clockPole(edge + 2.6, z));
      [-24, 16, 40].forEach((z) => k.bin(edge + 2.4, z, '#d9631a'));
      // second platform across (visual): track, platform, maroon shelter
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.6, -1, -120, 100);
      k.glassRoofShelter(-14.2, -28, 3.6, 7);
      [-70, -20, 25, 60].forEach((z) => k.totem(-12.2, z));
      [-60, 0, 44].forEach((z) => k.lampOld(-12.0, z));
      // concrete footbridge across the tracks at the north end
      k.footbridge(-121, -23, 14);
    },
  });

  /* ================================================================ OETRANGE
   * Refs: refs/ST-LU-B/Oetrange_1..3 (Commons: Gare Oetrange 01, Oetrange Gare, Contern gare CFL Oetrange (104)).
   * Cream plastered two-storey building with a central gable (round window) and a lower wing, dark roofs, yellow-orange sign frames,
   * maroon glass shelter, wide yard with several tracks and an underpass. */
  reg('Oetrange', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const FL = 3.5;
      const cz = -40;
      const wall = '#efe0b6';
      const base = { bayM: 3.4, floorM: FL, wall, trim: '#dccda4', frame: '#f4f0e6', glassTop: '#55616c', glassBot: '#8e9ba6', sill: true, band: true };
      const specG = Object.assign({}, base, { floors: [{ k: 'arch', ww: 1.2, wh: 2.5, sy: 0.4 }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.75 }] });
      const specE = Object.assign({}, base, { floors: [{ k: 'blank' }, { k: 'rect', ww: 0.9, wh: 1.5, sy: 0.9 }] });
      const specL = Object.assign({}, base, { floors: [{ k: 'rect', ww: 1.2, wh: 1.7, sy: 0.9 }] });
      const gab = { b: k.facadeBatch('oetG', Object.assign({}, base, { floors: [{ k: 'blank' }] })), bayM: 3.4, floorM: FL };
      const dep = 8.8;
      // main block (hipped), central gabled projection, low lean-to wing
      k.house({ l0, dep, z0: cz + 4.6, z1: cz + 17, floors: 2, FL, spec: specG, specEnd: specE, key: 'oetM', kind: 'hip', rise: 3.2, mat: 'slate', gab, eaveCol: '#d8c9a0' });
      const c = k.house({ l0: l0 - 0.6, dep: dep + 0.6, z0: cz - 4.6, z1: cz + 4.6, floors: 2, FL, spec: specG, specEnd: specE, key: 'oetC', kind: 'gableX', rise: 3.8, mat: 'slate', gab, eaveCol: '#d8c9a0' });
      k.house({ l0: l0 + 0.6, dep: 6.2, z0: cz - 14, z1: cz - 4.6, floors: 1, FL: 3.6, spec: specL, specEnd: specL, key: 'oetW', kind: 'mono', rise: 1.0, high: 'far', mat: 'slate', wall });
      const eavesY = H + 2 * FL;
      vc.box(X(l0 - 0.65), eavesY + 1.3, cz, 0.06, 0.8, 0.8, col('#f0ece0'));
      vc.box(X(l0 - 0.7), eavesY + 1.3, cz, 0.05, 0.55, 0.55, col('#3a4650'));
      vc.box(X(l0 - 0.65), H + 3.5, cz, 0.06, 0.45, 1.5, col('#f0f0ec'));
      vc.box(X(l0 - 0.7), H + 3.5, cz, 0.05, 0.28, 0.85, col('#e0801a'));
      k.chimney(l0 + 5, cz + 10, eavesY + 1.8, 2.4, '#a98466');
      // platform: yellow-framed boards, lamps, bench, totem, maroon shelter on the platform end
      [-24, 12, 38].forEach((z) => k.yellowDisplay(edge + 1.4, z));
      [-70, -52, 0, 30].forEach((z) => k.totem(edge + 1.5, z));
      [-52, 4, 38].forEach((z) => k.lamp(lB - 1.0, z, '#7a2a2a', 4.4));
      [-30, 8].forEach((z) => k.bench(l0 - 0.9, z, '#7d1f26'));
      k.glassRoofShelter(lB - 4.2, cz + 40, 3.6, 7);
      k.paveStrip(lB - 1.2, lB, cz - 14, cz + 17, '#b3a48c', 'cobOe');
      // yard: more tracks across, an island platform with a maroon shelter, underpass sign
      k.track(-9.2, -135, 135, { pole: true });
      k.track(-14.0, -135, 135, { pole: true });
      k.platformBox(-10.9, 1.4, -1, -100, 100);
      k.track(-18.0, -135, 135);
      k.glassRoofShelter(-10.9, -18, 1.5, 7);
    },
  });

  /* ================================================================ BETZDER (Betzdorf)
   * Refs: refs/ST-LU-B/Betzder_1..3 (Commons: Betzdorf, gare CFL Betzdorf (103)/(105)/(101)).
   * White timber waiting shelters with brown tiled gable roofs and bracketed fronts, the long grey-timber goods shed with a canopy,
   * the light-blue clad warehouse behind, yellow-framed name board. */
  reg('Betzder', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      k.timberShelter(lB - 3.2, -30, 3.0, 6.5, '#efece4', 'tile');
      k.timberShelter(lB - 3.2, 28, 3.0, 5.0, '#efece4', 'tile');
      // the goods shed: weathered timber boards, low gable roof, canopy overhanging the platform side
      const gz = 62;
      const specS = { bayM: 3.4, floorM: 4.6, floors: [{ k: 'rect', ww: 1.0, wh: 1.6, sy: 1.7 }], wall: '#e8e4d6', trim: '#e8e4d6', frame: '#4a3a2c', sill: false, band: false, glassTop: '#2e3438', glassBot: '#4a5258' };
      const sw = k.walls({ l0: lB + 0.6, l1: lB + 9, z0: gz - 9, z1: gz + 9, floors: 1, floorM: 4.6, front: specS, frontKey: 'betS', back: specS, backKey: 'betS', end: specS, endKey: 'betS', baseCol: '#8f8a80' });
      k.roof({ kind: 'gable', mat: 'slateb', l0: lB + 0.6, l1: lB + 9, z0: gz - 9, z1: gz + 9, y: sw.eaves, rise: 2.8, ov: 0.8, gableHex: '#e8e4d6' });
      k.leanCanopy({ lHi: lB + 0.5, lLo: lB - 2.8, yHi: H + 3.9, yLo: H + 3.2, z0: gz - 9, z1: gz + 9, topCol: '#5c5148', timber: '#9a7a55', postCol: '#4a3a2e', postEvery: 4.5 });
      // light-blue clad warehouse behind the platform
      const bl = k.tex('lubblue', { w: 64, h: 64, draw: (c, w, h) => { c.fillStyle = '#8bb0cf'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x, 0, 1.5, h); } } });
      k.texBox(bl, lB + 5, lB + 14.5, FORM_Y, 6.6, -62, -30, 2.5);
      vc.box(X(lB + 9.7), 6.9, -46, 10.2, 0.4, 32.6, col('#8a8f94'));
      // yellow-framed name board and notice frames, red bench, orange bin
      k.yellowBoard(edge + 3.4, -8, 'Betzdorf');
      [-70, 0, 44].forEach((z) => k.totem(edge + 1.5, z));
      [-86, 90].forEach((z) => k.lamp(edge + 3.0, z, '#7a2a2a', 4.4));
      [-52, 12].forEach((z) => k.lamp(edge + 3.0, z, '#7a2a2a', 4.4));
      k.bin(lB - 0.8, -22, '#d9631a');
      // across the empty track: second track + platform with a small shelter (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.timberShelter(-14.9, 8, 2.8, 5.0, '#efece4', 'tile');
    },
  });

  /* ================================================================ MANTERNACH
   * Refs: refs/ST-LU-B/Manternach_1..2 (Commons: Manternach, gare CFL Manternach (104)/(106)).
   * Red-brick open shelter with flat white roof, maroon steel shelter on the far platform, round clocks and blue CFL totems, tan paver
   * platform, yellow-framed name board, the old grain silo by the crossing and the yellow village house behind, bike box. */
  reg('Manternach', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      // red-brick shelter with a flat white roof, dark red seats
      k.boxShelter(lB - 3.0, -18, 5.6, 2.4, '#a85a44', '#d6d7d4', 5);
      k.yellowBoard(edge + 3.2, 10, 'Manternach');
      [-60, -30, 24, 56].forEach((z) => k.totem(edge + 1.5, z));
      [-52, 4, 40, 70].forEach((z) => k.lamp(lB - 0.6, z, '#8d9296', 5.0));
      [-44, 36].forEach((z) => k.clockPole(edge + 2.6, z));
      [-6, 22].forEach((z) => k.bin(lB - 0.7, z, '#d9631a'));
      // old grain silo, yellow village house, bike box behind the platform
      k.silo(14, -66, 5.5, 9, 17);
      const wall = '#ecd183';
      const sp = { bayM: 3.2, floorM: 3.3, wall, trim: '#f4efe0', frame: '#f4efe0', glassTop: '#55616c', glassBot: '#8e9ba6', sill: true, band: true };
      const specH = Object.assign({}, sp, { floors: [{ k: 'rect', ww: 1.1, wh: 1.7, sy: 0.8 }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.7 }] });
      k.house({ l0: lB + 6.5, dep: 8, z0: 20, z1: 34, floors: 2, FL: 3.3, spec: specH, key: 'manH', kind: 'hip', rise: 3.0, mat: 'slate', wall, eaveCol: '#d6c27a' });
      k.bikebox(lB + 2.0, -42);
      // across the empty track: maroon steel shelter on its own platform
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.postShelter(-14.2, -10, 2.6, 6, '#7a2a30', '#6a2b3a');
      k.postShelter(-14.2, 40, 2.6, 6, '#7a2a30', '#6a2b3a');
      [-50, 10, 60].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ MERTERT
   * Refs: refs/ST-LU-B/Mertert_1..2 (Commons: Mertert, gare CFL Mertert (111)/(106)).
   * Square two-storey ochre-plastered building with sandstone trim, arched ground-floor openings, hipped slate roof and chimney, standing
   * directly at the platform; small shelter, blue totem, bike box, underpass; yellow-framed name board. */
  reg('Mertert', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const FL = 3.6;
      const wall = '#dcc592';
      const sp = { bayM: 3.3, floorM: FL, wall, trim: '#b8996a', frame: '#f1ede2', glassTop: '#4d5a66', glassBot: '#8794a0', sill: true, band: true };
      const specG = Object.assign({}, sp, { floors: [{ k: 'arch', ww: 1.15, wh: 2.5, sy: 0.4 }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.75 }] });
      const specE = Object.assign({}, sp, { floors: [{ k: 'arch', ww: 1.1, wh: 2.4, sy: 0.4 }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.75 }] });
      const l0 = lB + 0.1;
      const cz = -34;
      const w = k.house({ l0, dep: 8.4, z0: cz - 5.5, z1: cz + 5.5, floors: 2, FL, spec: specG, specEnd: specE, key: 'merB', kind: 'hip', rise: 3.4, hipK: 1, mat: 'slate', wall, eaveCol: '#b8996a' });
      k.chimney(l0 + 4.2, cz, H + 2 * FL + 3.0, 2.2, '#a98466');
      vc.box(X(l0 - 0.1), H + 4.1, cz, 0.06, 0.5, 1.6, col('#f0f0ec'));
      // low annex
      k.house({ l0: l0 + 0.5, dep: 6.4, z0: cz + 5.5, z1: cz + 13, floors: 1, FL: 3.2, spec: specE, key: 'merA', kind: 'mono', rise: 1.0, high: 'far', mat: 'slate', wall });
      // platform shelter (white block shelter, red seats), totem, bike box, yellow board
      k.boxShelter(lB - 3.2, 20, 5.2, 2.2, '#e8e6e0', '#a4a8ab', 4);
      k.yellowBoard(edge + 3.2, -60, 'Mertert');
      [-70, -52, -8, 36, 56].forEach((z) => k.totem(edge + 1.5, z));
      [-52, -14, 20, 52].forEach((z) => k.lamp(edge + 3.2, z, '#8d9296', 5.0));
      k.clockPole(edge + 2.6, -16);
      k.bikebox(lB + 3.5, 30);
      // across the empty track: second platform with a small shelter
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.boxShelter(-14.9, 6, 4.8, 2.0, '#e8e6e0', '#a4a8ab', 4);
      [-40, 36].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ SANDWEILER-CONTERN
   * Refs: refs/ST-LU-B/Sandweiler-Contern_1..2 (Commons: Contern, gare CFL Sandweiler-Contern (102)/(110)).
   * Modern halte in a cutting: long anthracite pavilions with blue-glass strips and projecting blue-grey standing-seam canopies on both
   * platforms, maroon lamp posts, blue letter signs, CFL totems, a road bridge across the line and the P+R beside it. */
  reg('Sandweiler-Contern', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const zinc = k.roofBatch('zinc');
      const pavilion = (l, z0, z1, dir) => {
        // pavilion body on the platform back edge (dir +1: walls towards +l), dark panels with a glass strip facing the track
        const lw = l + dir * 2.8;
        vc.box(X(l + dir * 1.4), H + 1.5, (z0 + z1) / 2, 2.8, 3.0, z1 - z0, col('#565d65'));
        k.glassDark().box(X(l + dir * 0.02), H + 1.5, (z0 + z1) / 2, 0.04, 1.8, z1 - z0 - 2, WHITE);
        // standing-seam canopy projecting over the platform, slightly sloped
        k.quadO(zinc, [X(lw), H + 3.55, z0 - 0.3], [X(lw), H + 3.55, z1 + 0.3], [X(l - dir * 3.0), H + 3.15, z1 + 0.3], [X(l - dir * 3.0), H + 3.15, z0 - 0.3], [X(l), -5, (z0 + z1) / 2], WHITE, [[0, 0], [(z1 - z0) / 2, 0], [(z1 - z0) / 2, 3], [0, 3]]);
        k.quadO(zinc, [X(lw), H + 3.55, z0 - 0.3], [X(lw), H + 3.55, z1 + 0.3], [X(l - dir * 3.0), H + 3.15, z1 + 0.3], [X(l - dir * 3.0), H + 3.15, z0 - 0.3], [X(l), 30, (z0 + z1) / 2], WHITE, [[0, 0], [(z1 - z0) / 2, 0], [(z1 - z0) / 2, 3], [0, 3]]);
        vc.box(X(l - dir * 3.0), H + 3.1, (z0 + z1) / 2, 0.12, 0.4, z1 - z0 + 0.6, col('#3d4349'));
        for (let z = z0 + 2; z < z1; z += 7) vc.box(X(l - dir * 2.2), H + 1.6, z, 0.12, 3.2, 0.12, col('#3d4349'));
      };
      pavilion(lB - 0.2, -48, -10, 1);
      pavilion(lB - 0.2, 14, 36, 1);
      // letter sign (blue square "A"), CFL totems, maroon lamp posts, benches
      [-62, -30, 24, 46].forEach((z) => k.totem(edge + 1.5, z));
      [-70, -40, 0, 30, 60].forEach((z) => k.lamp(lB - 1.4, z, '#7a2a2a', 5.0));
      [-26, 20].forEach((z) => k.bench(lB - 0.9, z, '#7d1f26'));
      k.sign(edge + 1.0, -52, 'A', 'blue');
      k.sign(edge + 1.0, 40, 'C', 'blue');
      // across: second track, platform, pavilion (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      pavilion(-14.7, -30, 8, -1);
      [-50, 0, 40].forEach((z) => k.totem(-12.2, z));
      // road bridge over the line at the south end and the P+R behind the platform
      const bz = 128;
      vc.box(X(0), 7.4, bz, 64, 1.3, 9, col('#9a978f'));
      [-1, 1].forEach((d) => vc.box(X(0), 8.5, bz + d * 4.3, 64, 0.8, 0.25, col('#7a2a2a')));
      // road on the deck, abutments + ramps at both ends (nothing ends in the air)
      api.helpers.addBridgeDeck({ lat0: -32, lat1: 32, z: bz, width: 9, yTop: 8.05, kind: 'road', inset: 0.5 });
      [[-32, -1], [32, 1]].forEach(([lat, out]) => api.helpers.addBridgeApproach({ lat, out, z: bz, width: 9, yTop: 8.05, kind: 'road', slope: 0.2 }));
      k.cars(lB + 8.5, -30, 10, 8, 5);
    },
  });

  /* ================================================================ WALFER (Walferdange)
   * Refs: refs/ST-LU-B/Walfer_1..3 (Commons: Walferdange, gare CFL Walferdange (109)/(105)/(110)).
   * Sandstone ashlar station: two-storey central block with a small gable, a square slate-roofed clock tower, single-storey wings with long
   * slate roofs; yellow-brick platform paving, maroon-timber gabled shelter over the underpass stairs, white block shelter. */
  reg('Walfer', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const wall = '#bf9f64';
      const sp = { bayM: 3.2, floorM: 3.7, wall, trim: '#dcc690', frame: '#f4efe2', glassTop: '#4d5a66', glassBot: '#8794a0', stone: true, sill: true, band: true };
      const specM = Object.assign({}, sp, { floors: [{ k: 'door', ww: 1.3, wh: 2.7, sy: 0, col: '#e8e2cf', panel: '#e8e2cf' }, { k: 'rect', ww: 1.05, wh: 1.8, sy: 0.7 }] });
      const specW = Object.assign({}, sp, { floorM: 3.9, floors: [{ k: 'rect', ww: 1.3, wh: 2.6, sy: 0.05 }], sill: false, band: false });
      const specE = Object.assign({}, sp, { floors: [{ k: 'blank' }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.8 }] });
      const gab = { b: k.facadeBatch('walG', Object.assign({}, sp, { floors: [{ k: 'blank' }] })), bayM: 3.2, floorM: 3.7 };
      const cz = -40;
      k.house({ l0: l0 + 0.2, dep: 8.6, z0: cz - 24, z1: cz - 8, floors: 1, FL: 3.9, spec: specW, specEnd: specE, key: 'walWL', kind: 'hip', rise: 2.4, mat: 'slate', gab });
      const m = k.house({ l0, dep: 9.4, z0: cz - 8, z1: cz + 6, floors: 2, FL: 3.7, spec: specM, specEnd: specE, key: 'walM', kind: 'gable', rise: 4.4, mat: 'slate', gab, eaveCol: '#d4be8c' });
      k.house({ l0: l0 - 0.7, dep: 5.0, z0: cz - 2.6, z1: cz + 2.6, floors: 2, FL: 3.7, spec: specM, specEnd: specE, key: 'walP', kind: 'gableX', rise: 2.4, mat: 'slate', gab });
      // the square clock tower with a pyramid roof
      const t = k.house({ l0: l0 + 1.0, dep: 4.6, z0: cz + 6, z1: cz + 10.6, floors: 3, FL: 3.7, spec: specE, key: 'walT', kind: 'pyr', rise: 5.4, mat: 'slate', gab, eaveCol: '#d4be8c' });
      k.house({ l0: l0 + 0.2, dep: 8.6, z0: cz + 10.6, z1: cz + 28, floors: 1, FL: 3.9, spec: specW, specEnd: specE, key: 'walWR', kind: 'hip', rise: 2.4, mat: 'slate', gab });
      k.chimney(l0 + 6.5, cz - 2, H + 2 * 3.7 + 3.2, 2.0, '#a98466');
      // yellow-brick paving across the platform, maroon timber gabled shelter over the underpass, white block shelter, totems
      k.paveStrip(edge + 1.2, lB, cz - 30, cz + 34, '#bfa05c', 'brkWa');
      k.postShelter(lB - 5.2, 20, 2.8, 5, '#6a2b3a', '#6a2b3a');
      k.boxShelter(lB - 3.0, -78, 5, 2.2, '#e8e6e0', '#a4a8ab', 4);
      [-64, -30, 10, 40, 60].forEach((z) => k.totem(edge + 1.5, z));
      [-60, -20, 20, 50].forEach((z) => k.lamp(edge + 3.2, z, '#8d9296', 5.0));
      [-12, 30].forEach((z) => k.clockPole(edge + 2.4, z));
      // across: second track + platform with white shelter and totems (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.boxShelter(-14.9, -30, 5.6, 2.2, '#e8e6e0', '#a4a8ab', 4);
      [-70, -10, 40].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ LËNTGEN (Lintgen)
   * Refs: refs/ST-LU-B/Lentgen_1..2 (Commons: Lintgen, gare CFL Lintgen (103)/(105)).
   * Long dark vertical-timber-clad building with a concrete base along the platform, small white block shelters with red seats and a flat
   * roof, yellow emergency phones, platform letters, village houses and car park behind. */
  reg('Lëntgen', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const tb = k.timberBatch('#4a392c');
      const conc = k.concBatch();
      const zc = -28;
      // timber-clad block raised on concrete pilotis (open dark ground floor), vertical dark timber boards, horizontal louvre bands, flat roof
      k.texBox(k.plainBatch('#1d1f21'), lB + 1.2, lB + 9.2, FORM_Y, 3.0, zc - 17, zc + 17, 3);
      for (let i = 0; i < 8; i++) k.texBox(conc, lB + 0.6, lB + 1.6, FORM_Y, 3.0, zc - 16.5 + i * 4.7, zc - 15.5 + i * 4.7, 2.4);
      k.texBox(tb, lB + 0.6, lB + 9.8, 3.0, 9.4, zc - 17.4, zc + 17.4, 2.2);
      const lv = k.timberBatch('#7a5d42');
      for (let z = zc - 14; z <= zc + 14; z += 9.4) k.texBox(lv, lB + 0.45, lB + 0.62, 4.3, 7.8, z - 2.2, z + 2.2, 0.9);
      vc.box(X(lB + 5.2), 9.5, zc, 9.8, 0.3, 35.2, col('#5f6469'));
      // white block shelters with red seats and a flat roof
      k.boxShelter(lB - 3.0, 14, 5.2, 2.2, '#eceae4', '#d3d5d6', 5);
      k.boxShelter(lB - 3.0, -26, 5.2, 2.2, '#eceae4', '#d3d5d6', 5);
      k.sign(edge + 1.0, -52, 'B', 'blue');
      k.sign(edge + 1.0, 36, 'D', 'blue');
      // yellow emergency phone posts
      [-40, 0, 40].forEach((z) => { vc.box(X(edge + 0.9), H + 0.6, z, 0.07, 1.2, 0.07, col('#f2b200')); vc.box(X(edge + 0.9), H + 1.3, z, 0.25, 0.4, 0.18, col('#f2b200')); });
      [-64, -30, 8, 30, 52].forEach((z) => k.totem(edge + 1.7, z));
      [-58, -20, 22, 56].forEach((z) => k.lamp(edge + 3.2, z, '#8d9296', 5.0));
      // car park behind the block
      k.cars(lB + 12.5, -50, 20, 14, 21);
      // across: second track + platform with a white shelter (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.boxShelter(-14.9, -10, 5.2, 2.2, '#eceae4', '#d3d5d6', 5);
      [-56, 4, 50].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ MIERSCH (Mersch)
   * Refs: refs/ST-LU-B/Miersch_1..2 (Commons: Mersch, gare CFL Mersch (102)/(107)).
   * The old brown-yellow sandstone building with a square tower (round window, pyramid slate roof), the new gold-bronze folded canopy with
   * grey columns over the platforms, gold perforated-panel lift/underpass blocks, blue signs; a second platform across. */
  reg('Miersch', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const wall = '#c6a76a';
      const sp = { bayM: 3.2, floorM: 3.7, wall, trim: '#dfc995', frame: '#f4efe2', glassTop: '#4d5a66', glassBot: '#8794a0', stone: true, sill: true, band: true };
      const specM = Object.assign({}, sp, { floors: [{ k: 'arch', ww: 1.2, wh: 2.6, sy: 0.4 }, { k: 'rect', ww: 1.05, wh: 1.8, sy: 0.7 }] });
      const specE = Object.assign({}, sp, { floors: [{ k: 'blank' }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.8 }] });
      const gab = { b: k.facadeBatch('mieG', Object.assign({}, sp, { floors: [{ k: 'blank' }] })), bayM: 3.2, floorM: 3.7 };
      const cz = -62;
      k.house({ l0, dep: 8.6, z0: cz - 8, z1: cz + 8, floors: 2, FL: 3.7, spec: specM, specEnd: specE, key: 'mieM', kind: 'gable', rise: 4.0, mat: 'slate', gab, eaveCol: '#d4be8c' });
      k.house({ l0: l0 + 1.2, dep: 5.4, z0: cz + 8, z1: cz + 13.4, floors: 3, FL: 3.7, spec: specE, key: 'mieT', kind: 'pyr', rise: 5.8, mat: 'slate', gab, eaveCol: '#d4be8c' });
      vc.box(X(l0 + 1.15), H + 8.8, cz + 10.7, 0.06, 1.0, 1.0, col('#efe9d8'));
      vc.box(X(l0 + 1.1), H + 8.8, cz + 10.7, 0.05, 0.7, 0.7, col('#37424c'));
      // new gold-bronze canopy: butterfly wedge over the platform, thin steel edge, grey columns
      k.waveCanopy({ lA: edge + 0.8, lB: lB + 0.4, z0: -40, z1: 100, fn: (z, l) => 4.4 - 0.9 * ((l - (edge + 0.8)) / (W - 0.4)), step: 10, topCol: '#b49a5c', timber: '#c9b27a', colFoot: lB - 1.2, colTop: lB - 1.2, colEvery: 11, colCol: '#7d848a' });
      // gold perforated-panel lift/underpass blocks with stainless lift doors
      [[10, 3.4, 3.2], [60, 3.4, 3.2]].forEach(([z, dl, dz]) => {
        vc.box(X(lB - 0.5 - dl / 2), H + 2.4, z, dl, 4.8, dz, col('#bda468'));
        vc.box(X(lB - 0.5 - dl) + sx * 0.02, H + 1.1, z, 0.05, 2.2, 1.4, col('#c9cdd0'));
      });
      [-30, 16, 40, 66, 88].forEach((z) => k.totem(edge + 1.5, z));
      [-6, 30, 52, 78].forEach((z) => k.bench(lB - 1.2, z, '#7b6a4c'));
      k.sign(edge + 1.0, -20, 'A', 'blue');
      // across: Voie 3 platform with the same canopy language (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.6, -1, -90, 110);
      k.waveCanopy({ lA: -11.6, lB: -15.8, z0: -30, z1: 100, fn: (z, l) => 4.3 - 0.9 * ((-l - 11.6) / 4.2), step: 10, topCol: '#b49a5c', timber: '#c9b27a', colFoot: -14.6, colTop: -14.6, colEvery: 11, colCol: '#7d848a' });
      [-20, 30, 70].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ KAUTEBAACH (Kautenbach)
   * Refs: refs/ST-LU-B/Kautebaach_1..3 (Commons: Kautenbach, Gare (101)/(102); Gare Kautebaach).
   * Long two-storey cream-pink plastered building (stone quoins and window surrounds), slate roof with three dormers and tall chimneys,
   * red-brown arched windows and double doors, three little sawtooth glass-and-maroon-iron entrance canopies over the platform, wooded valley
   * slope right behind, junction tracks (Wiltz branch) alongside, small annex building at the end of the platform. */
  reg('Kautebaach', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y, WHITE } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const FL = 3.6;
      const wall = '#ecd3b4';
      const sp = { bayM: 3.4, floorM: FL, wall, trim: '#d8b894', frame: '#8b3a30', glassTop: '#4b5a68', glassBot: '#8798a6', sill: true, band: true };
      const specG = Object.assign({}, sp, { floors: [{ k: 'arch', ww: 1.15, wh: 2.6, sy: 0.4 }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.75 }] });
      const specD = Object.assign({}, sp, { floors: [{ k: 'door', ww: 1.35, wh: 2.8, sy: 0, col: '#8b3a30', panel: '#8b3a30' }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.75 }] });
      const specE = Object.assign({}, sp, { bayM: 4, floors: [{ k: 'rect', ww: 1.0, wh: 1.6, sy: 0.9 }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.8 }] });
      const gab = { b: k.facadeBatch('kauG', Object.assign({}, sp, { floors: [{ k: 'blank' }] })), bayM: 3.4, floorM: FL };
      const cz = -30;
      const eavesY = H + 2 * FL;
      // two wings of the long building plus the central double-door section
      k.house({ l0, dep: 8.6, z0: cz - 16, z1: cz - 3.4, floors: 2, FL, spec: specG, specEnd: specE, key: 'kauL', kind: 'gable', rise: 4.2, mat: 'slateb', gab, eaveCol: '#cfae88' });
      k.house({ l0, dep: 8.6, z0: cz - 3.4, z1: cz + 14, floors: 2, FL, spec: specD, specEnd: specE, key: 'kauR', kind: 'gable', rise: 4.2, mat: 'slateb', gab, eaveCol: '#cfae88' });
      // dormers on the platform side of the roof
      [-12, -7, 6, 11].forEach((d) => {
        const dz = cz + d;
        vc.box(X(l0 + 1.5), eavesY + 1.2, dz, 1.5, 1.7, 1.5, col(wall));
        k.glassPane(X(l0 + 1.5) - sx * 0.76, eavesY + 1.3, dz, 0.8, 0.9);
        k.roof({ kind: 'gable', mat: 'slateb', l0: l0 + 0.7, l1: l0 + 2.4, z0: dz - 0.85, z1: dz + 0.85, y: eavesY + 2.0, rise: 0.8, ov: 0.15, gableHex: wall });
      });
      [-14, -2, 7, 13].forEach((d, i) => k.chimney(l0 + 5.0 + (i % 2) * 0.6, cz + d, eavesY + 2.4, 2.2, '#b3714c'));
      // three little sawtooth glass entrance canopies on maroon iron frames
      [-8.5, 0.3, 8.0].forEach((z) => {
        const lo = lB - 1.6;
        [-1.6, 1.6].forEach((dz) => vc.box(X(lo), H + 1.45, cz + z + dz, 0.14, 2.9, 0.14, col('#7a2a30')));
        vc.box(X(lo), H + 2.95, cz + z, 0.14, 0.14, 3.4, col('#7a2a30'));
        const g = k.glass();
        k.quadO(g, [X(lo), H + 2.95, cz + z - 1.8], [X(lo), H + 2.95, cz + z + 1.8], [X(l0 - 0.1), H + 3.9, cz + z + 1.8], [X(l0 - 0.1), H + 3.9, cz + z - 1.8], [X(lo), 20, cz + z], WHITE);
        [-1.8, 1.8].forEach((dz) => vc.between([X(lo), H + 2.95, cz + z + dz], [X(l0 - 0.1), H + 3.9, cz + z + dz], 0.1, col('#7a2a30'), 0.1));
      });
      // annex house at the south end of the platform
      const specA = Object.assign({}, sp, { floors: [{ k: 'rect', ww: 1.1, wh: 1.7, sy: 0.9 }] });
      k.house({ l0: lB + 1.0, dep: 6.0, z0: cz + 24, z1: cz + 31, floors: 1, FL: 3.4, spec: specA, specEnd: specA, key: 'kauA', kind: 'gable', rise: 2.2, mat: 'slateb', wall });
      // wooded rock slope right behind the building (the valley side)
      const bank = k.tex('lubbank2', { w: 64, h: 64, draw: (c, w, h) => { const r = mulb(91); c.fillStyle = '#3f5a33'; c.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { c.fillStyle = 'rgba(' + (r() > 0.5 ? '20,48,22' : '100,92,70') + ',0.32)'; c.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 3); } } });
      k.quadO(bank, [X(lB + 16), FORM_Y, cz - 60], [X(lB + 16), FORM_Y, cz + 60], [X(lB + 34), 26, cz + 60], [X(lB + 34), 26, cz - 60], [X(lB), 0, 0], WHITE, [[0, 0], [60, 0], [60, 8], [0, 8]]);
      // platform furniture: totem, red bench, lamps, orange bins
      [-60, -22, 26, 54].forEach((z) => k.totem(edge + 1.5, z));
      [-54, -14, 20, 46].forEach((z) => k.lampOld(edge + 3.2, z, '#6a2b3a'));
      k.bench(lB - 0.9, cz - 12, '#a8321f');
      k.bench(lB - 0.9, cz + 6, '#a8321f');
      [-18, 14].forEach((z) => k.bin(lB - 0.9, z, '#d9631a'));
      // across: second track + platform with a small shelter (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 3.6, -1, -90, 90);
      k.boxShelter(-14.2, -14, 4.8, 2.0, '#e8e6e0', '#a4a8ab', 4);
      k.track(-15.2, -135, 135);
    },
  });

  /* ================================================================ WËLWERWOLZ (Wilwerwiltz)
   * Refs: refs/ST-LU-B/Welwerwolz_1..3 (Commons: Kiischpelt, gare CFL Wilwerwiltz (102)/(103)/(104)).
   * White-plastered two-storey building with pink-beige sandstone window surrounds and red-brown doors, a gable end with oculus, slate roof,
   * a small teal entrance canopy, wall clock, blue CFL totem, white-brick shelter with flat roof on the platform. */
  reg('Wëlwerwolz', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, FORM_Y } = api;
      const { X, vc } = k;
      const lB = edge + W;
      const l0 = lB + 0.1;
      const FL = 3.5;
      const sp = { bayM: 3.3, floorM: FL, wall: '#f3f0ea', trim: '#c9a690', frame: '#4a3524', glassTop: '#4b5a68', glassBot: '#8798a6', sill: true, band: true };
      const specD = Object.assign({}, sp, { floors: [{ k: 'door', ww: 1.2, wh: 2.6, sy: 0, col: '#6a2b2b', panel: '#6a2b2b' }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.8 }] });
      const specW = Object.assign({}, sp, { floors: [{ k: 'rect', ww: 1.15, wh: 1.8, sy: 0.8 }, { k: 'rect', ww: 1.0, wh: 1.7, sy: 0.8 }] });
      const specE = Object.assign({}, sp, { bayM: 4, floors: [{ k: 'rect', ww: 1.0, wh: 1.6, sy: 0.9 }, { k: 'rect', ww: 1.0, wh: 1.6, sy: 0.8 }] });
      const gab = { b: k.facadeBatch('welG', Object.assign({}, sp, { floors: [{ k: 'blank' }] })), bayM: 3.3, floorM: FL };
      const cz = -36;
      const m = k.house({ l0, dep: 8.2, z0: cz - 9, z1: cz + 9, floors: 2, FL, spec: specD, specBack: specW, specEnd: specE, key: 'welM', kind: 'gable', rise: 3.8, mat: 'slateb', gab, eaveCol: '#d8d2c4' });
      [-1, 1].forEach((d) => {
        vc.box(X(l0 + 4.1), H + 2 * FL + 1.3, cz + d * 9.04, 0.9, 0.9, 0.06, col('#e7e1d2'));
        vc.box(X(l0 + 4.1), H + 2 * FL + 1.3, cz + d * 9.08, 0.6, 0.6, 0.05, col('#37424c'));
      });
      k.house({ l0: l0 + 0.4, dep: 6.0, z0: cz + 9, z1: cz + 17, floors: 1, FL: 3.5, spec: specD, specEnd: specE, key: 'welA', kind: 'mono', rise: 1.0, high: 'far', mat: 'slateb', wall: '#f3f0ea' });
      k.chimney(l0 + 5.0, cz - 3, H + 2 * FL + 2.6, 2.0, '#a5492f');
      // small teal entrance canopy over the doors and a wall clock
      k.leanCanopy({ lHi: l0 - 0.05, lLo: l0 - 1.7, yHi: H + 3.1, yLo: H + 2.7, z0: cz - 5, z1: cz + 5, topCol: '#4f8a8a', timber: '#8a6a45', postCol: '#4f8a8a', postEvery: 5 });
      k.clockFace(l0 - 0.05, H + 3.6, cz - 7, 0.8, -1);
      // totem, shelter, sign, bench
      [-64, -18, 24, 52].forEach((z) => k.totem(edge + 1.5, z));
      [-50, -10, 30].forEach((z) => k.lamp(edge + 3.0, z, '#8d9296', 5.0));
      k.bench(lB - 0.9, cz + 14, '#7b5a3a');
      k.sign(edge + 1.0, -48, 'A', 'blue');
      // across: second track + platform with the white brick shelter (visual)
      k.track(-9.2, -135, 135, { pole: true });
      k.platformBox(-10.9, 4.0, -1, -90, 90);
      k.boxShelter(-14.9, 6, 5.0, 2.0, '#efeee8', '#a4a8ab', 4);
      [-40, 20, 60].forEach((z) => k.totem(-12.2, z));
    },
  });

  /* ================================================================ ETTELBRÉCK
   * Refs: refs/ST-LU-B/Ettelbreck_1..3 (Commons: Ettelbruck station 2023 2, Gare Ettelbruck 01, Ettelbruck Gare CFL 101).
   * Long two-storey sandstone building (ashlar, sandstone window surrounds, string course, arched ground-floor windows with orange doors),
   * 3-part: hipped slate wings + central block with a pediment (round window) facing the platform; the new wavy timber-underside canopy
   * with dark steel fascia and slanted columns, glass lift, CFL blue totems; 3rd track and 2nd platform beyond. */
  reg('Ettelbréck', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col } = api;
      const { X, vc } = k;
      const l0 = edge + W + 0.1;
      const dep = 9.2;
      const cz = -44;
      const wall = '#cdb68a';
      const trim = '#dcc79c';
      const FL = 3.7;
      const specG = { bayM: 3.2, floorM: FL, floors: [{ k: 'arch', ww: 1.2, wh: 2.6, sy: 0.4 }, { k: 'rect', ww: 1.05, wh: 1.85, sy: 0.7 }], wall, trim, stone: true };
      const specE = { bayM: 3.2, floorM: FL, floors: [{ k: 'blank' }, { k: 'rect', ww: 0.9, wh: 1.5, sy: 0.9 }], wall, trim, stone: true };
      const specDoor = { bayM: 3.2, floorM: FL, floors: [{ k: 'door', ww: 1.3, wh: 2.7, sy: 0, col: '#2c2f33' }, { k: 'rect', ww: 1.05, wh: 1.85, sy: 0.7 }], wall, trim, stone: true };
      const specGab = { bayM: 3.2, floorM: FL, floors: [{ k: 'blank' }], wall, trim, stone: true };
      const gab = { b: k.facadeBatch('ettGab', specGab), bayM: 3.2, floorM: FL };
      const parts = [
        { z0: cz - 32, z1: cz - 12.8, spec: specG, key: 'ettL', roof: 'hip', rise: 3.0 },
        { z0: cz - 12.8, z1: cz + 6.4, spec: specDoor, key: 'ettC', roof: 'gableX', rise: 3.4, proj: 0.8 },
        { z0: cz + 6.4, z1: cz + 28.8, spec: specG, key: 'ettR', roof: 'hip', rise: 2.6 },
      ];
      parts.forEach((p) => {
        const pl0 = l0 - (p.proj || 0);
        const w = k.walls({ l0: pl0, l1: l0 + dep, z0: p.z0, z1: p.z1, floors: 2, floorM: FL, front: p.spec, frontKey: p.key + 'F', back: p.spec, backKey: p.key + 'F', end: specE, endKey: 'ettE', baseCol: '#9d8a68' });
        k.roof({ kind: p.roof, mat: 'slate', l0: pl0, l1: l0 + dep, z0: p.z0, z1: p.z1, y: w.eaves + 0.15, rise: p.rise, ov: 0.45, gableTex: gab });
        vc.box(X((pl0 + l0 + dep) / 2), w.eaves + 0.05, (p.z0 + p.z1) / 2, dep + 0.4, 0.22, p.z1 - p.z0 + 0.4, col('#bda673'));
      });
      const eavesY = H + 2 * FL;
      // round window in the pediment (platform side) and CFL plate above the doors
      vc.box(X(l0 - 0.85), eavesY + 1.7, cz - 3.2, 0.06, 1.0, 1.0, col('#e8e2d2'));
      vc.box(X(l0 - 0.9), eavesY + 1.7, cz - 3.2, 0.05, 0.7, 0.7, col('#31475a'));
      vc.box(X(l0 - 0.85), H + 3.55, cz - 3.2, 0.06, 0.45, 1.6, col('#f0f0ec'));
      vc.box(X(l0 - 0.9), H + 3.55, cz - 3.2, 0.05, 0.28, 0.9, col('#e0801a'));
      [[cz - 24, 4], [cz + 18, 5]].forEach(([z, l]) => k.chimney(l0 + l, z, eavesY + 1.2, 2.2, '#b08a68'));
      // red cast lamp posts on the platform in front of the building
      [-30, -14, 2, 18].forEach((z) => k.lamp(l0 - 1.4, cz + z, '#7a2a2a', 3.8));

      // old timber platform canopy along the building (dark iron posts, timber soffit)
      k.leanCanopy({ lHi: l0 - 0.9, lLo: edge + 2.15, yHi: H + 5.3, yLo: H + 3.75, z0: cz - 40, z1: cz + 38, postEvery: 6.4 });
      [-44, -12, 12, 34].forEach((z) => k.yellowDisplay(edge + 1.3, cz + z));
      [-58, -26, 0, 20].forEach((z) => k.totem(edge + 1.3, cz + z + 6));
      [-30, -6, 16, 38].forEach((z) => k.bench(l0 - 1.7, cz + z, '#a2713c'));
      [-20, 26].forEach((z) => k.bin(edge + 3.3, cz + z, '#8a8f93'));
      [-86, 72].forEach((z) => k.clockPole(edge + 3.0, z));

      // across the empty track: the new island platform with the wavy timber canopy, lift and stairs (visual only)
      k.track(-9.2, -130, 130, { pole: true });
      k.platformBox(-10.9, 5.6, -1, -125, 105);
      k.waveCanopy({ lA: -11.8, lB: -16.2, z0: -115, z1: 95, y0: 5.1, amp: 0.8, per: 30, tilt: -0.9, colFoot: -15.2, colTop: -13.0, colEvery: 17 });
      k.lift(-14.5, -24, 5.0);
      k.lift(-14.5, 34, 5.0);
      k.stairOpening(-14.0, -6, 6);
      k.stairOpening(-14.0, 52, 6);
      [-85, -50, -12, 14, 40, 75].forEach((z) => k.totem(-12.3, z));
      [-66, -34, 6, 24, 60].forEach((z) => k.bench(-13.2, z, '#a2713c'));
    },
  });
})();
