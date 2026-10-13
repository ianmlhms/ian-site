/* Zuchsimulator Lëtzebuerg: photo-modelled stations (lu-a). Registers into TS.realStations (stations-real.js).
 * Stations: Lëtzebuerg Gare Centrale, Hollerich, Berchem, Bettembuerg, Esch-Uelzecht, Belval-Université, Déifferdang, Péiteng,
 * Rodange, Bartreng, Mamer, Capellen, Kleinbettingen.
 * Local frame: platform middle on the track centre line, +x right of the driving direction, the train drives towards -z.
 * "lat" = distance from the track centre on the platform side (pf(lat) puts it in the mirrored-safe local x). */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations) return;
  const reg = window.TS.realStations.register;

  /* ---------------------------------------------------------------- shared helpers */
  const geoCache = new Map();
  function frustumGeo(T, rt, rb, segs) {
    const k = rt + '|' + rb + '|' + segs;
    let g = geoCache.get(k);
    if (!g) {
      g = new T.CylinderGeometry(rt, rb, 1, segs);
      geoCache.set(k, g);
    }
    return g;
  }

  // everything a builder needs, derived once per build from the api object
  function kit(api) {
    const { T, sets, M, mat, col, WHITE, FORM_Y, pf, H, W, edge, zA, zB, sx, helpers } = api;
    const canvasTex = helpers.canvasTex;
    const P = (lat, y, z) => [pf(lat), y, z];
    const tmpM = new T.Matrix4();
    const tmpQ = new T.Quaternion();
    const tmpV = new T.Vector3();
    const tmpS = new T.Vector3();
    const k = {
      api, T, sets, M, mat, col, WHITE, FORM_Y, pf, H, W, edge, zA, zB, sx, canvasTex, P, helpers,
      vc: sets.get('vc', M.vc, true),
      glass: sets.get('glass', M.glass),
      glow: sets.get('glow', M.glow),
      tex(key, w, h, draw, opts) {
        return sets.get('luA:' + key, () => M.tex('luA:' + key, canvasTex('luA:' + key, w, h, draw, opts)), true);
      },
      // quad with auto winding; a..d = [lat,y,z]
      quadL(b, a, bb, c, d, nrm, color, uvs) {
        b.quad(P(...a), P(...bb), P(...c), P(...d), nrm, color || WHITE, uvs);
      },
      // triangle with explicit uvs, winding from the normal
      triUV(b, a, bb, c, nrm, uv, color) {
        const A = P(...a), B = P(...bb), C = P(...c);
        const cx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
        const cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        const cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        const flip = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0;
        const pts = flip ? [A, C, B] : [A, B, C];
        const uvs = flip ? [uv[0], uv[2], uv[1]] : uv;
        const ids = pts.map((p, i) => b.vert(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], uvs[i][0], uvs[i][1], color || WHITE));
        b.idx.push(ids[0], ids[1], ids[2]);
      },
      // box in lateral coords (lat, y, z); sizes (along lat, y, z)
      box(b, lat, y, z, sl, sy, sz, color, ry, rx, rz) {
        b.box(pf(lat), y, z, sl, sy, sz, color, ry, rx, rz);
      },
      // tapered cylinder / octagon (centre bottom at y)
      frust(b, lat, y, z, rTop, rBot, h, color, segs, ry) {
        tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), ry || 0);
        tmpM.compose(tmpV.set(pf(lat), y + h / 2, z), tmpQ, tmpS.set(1, h, 1));
        b.geom(frustumGeo(T, rTop, rBot, segs || 10), tmpM, color);
      },
      between(b, a, bb, t1, color, t2) {
        b.between(P(...a), P(...bb), t1, color, t2);
      },
    };
    return k;
  }

  /* ---------------------------------------------------------------- textures */
  function stoneBase(c, w, h, base, spread, courseH, rnd) {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += courseH) {
      let x = (Math.floor(y / courseH) % 2) * (courseH * 1.4);
      while (x < w) {
        const bw = courseH * (1.6 + rnd() * 1.4);
        const v = Math.floor((rnd() - 0.5) * spread);
        c.fillStyle = 'rgba(' + (v > 0 ? '255,244,214' : '70,52,28') + ',' + (Math.abs(v) / 255).toFixed(3) + ')';
        c.fillRect(x, y, bw, courseH);
        c.fillStyle = 'rgba(80,62,38,0.22)';
        c.fillRect(x, y, 1, courseH);
        x += bw;
      }
      c.fillStyle = 'rgba(80,62,38,0.30)';
      c.fillRect(0, y, w, 1);
    }
  }
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SAND = '#c1b08d';
  function archWindow(c, x, y, ww, hh, glass) {
    // round-arched window with a stone surround
    const r = ww / 2;
    c.fillStyle = '#b39c74';
    c.beginPath();
    c.moveTo(x - 5, y + hh);
    c.lineTo(x - 5, y + r);
    c.arc(x + r, y + r, r + 5, Math.PI, 0);
    c.lineTo(x + ww + 5, y + hh);
    c.closePath();
    c.fill();
    c.fillStyle = glass || '#3b4650';
    c.beginPath();
    c.moveTo(x, y + hh);
    c.lineTo(x, y + r);
    c.arc(x + r, y + r, r, Math.PI, 0);
    c.lineTo(x + ww, y + hh);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(190,210,225,0.28)';
    c.fillRect(x + 3, y + r, ww - 6, hh - r - 3);
    c.fillStyle = '#e9e3d3';
    c.fillRect(x + r - 1.5, y + 2, 3, hh - 2);
    c.fillRect(x, y + hh * 0.5, ww, 3);
    c.fillRect(x, y + r, ww, 3);
  }

  // one 8 m bay of the long wing: tall arched windows below a cornice, sandstone coursing (256 px = 8 m)
  function wingTex(c, w, h) {
    const rnd = seeded(11);
    stoneBase(c, w, h, SAND, 60, 14, rnd);
    // rusticated plinth
    c.fillStyle = 'rgba(70,56,36,0.28)';
    c.fillRect(0, h - 26, w, 26);
    // pilasters at the bay edges
    c.fillStyle = '#d6c3a0';
    c.fillRect(0, 0, 12, h);
    c.fillRect(w - 12, 0, 12, h);
    // cornice band
    c.fillStyle = '#bda885';
    c.fillRect(0, 10, w, 12);
    c.fillStyle = 'rgba(60,44,24,0.35)';
    c.fillRect(0, 22, w, 3);
    // two tall arched windows
    archWindow(c, 40, 56, 54, h - 56 - 30);
    archWindow(c, w - 94, 56, 54, h - 56 - 30);
    // oval window between them in the frieze
    c.fillStyle = '#b39c74';
    c.beginPath();
    c.ellipse(w / 2, 52, 17, 20, 0, 0, 6.3);
    c.fill();
    c.fillStyle = '#3b4650';
    c.beginPath();
    c.ellipse(w / 2, 52, 12, 15, 0, 0, 6.3);
    c.fill();
  }

  // platform-side wall of the wing: low arched doors and windows under the canopy, plain coursed stone above
  function wingBackTex(c, w, h) {
    const rnd = seeded(13);
    stoneBase(c, w, h, SAND, 60, 14, rnd);
    c.fillStyle = 'rgba(70,56,36,0.28)';
    c.fillRect(0, h - 26, w, 26);
    c.fillStyle = '#d6c3a0';
    c.fillRect(0, 0, 10, h);
    c.fillRect(w - 10, 0, 10, h);
    c.fillStyle = '#bda885';
    c.fillRect(0, 10, w, 12);
    const top = h - 26 - 116;
    archWindow(c, 34, top, 56, 116, '#2b3036');
    archWindow(c, w - 90, top + 22, 56, 94, '#3b4650');
    // small square windows on the upper floor
    [48, w - 80].forEach((x) => {
      c.fillStyle = '#b39c74';
      c.fillRect(x - 5, 70, 42, 62);
      c.fillStyle = '#3b4650';
      c.fillRect(x, 75, 32, 52);
      c.fillStyle = '#e4dcc6';
      c.fillRect(x + 14, 75, 4, 52);
    });
  }

  // gable of the big hall: huge arched window, pilasters, pediment, coat of arms. u = across the gable, v = up
  function gableTex(c, w, h) {
    const rnd = seeded(23);
    stoneBase(c, w, h, SAND, 60, 18, rnd);
    c.fillStyle = '#d6c3a0';
    c.fillRect(0, 0, 26, h);
    c.fillRect(w - 26, 0, 26, h);
    // main arch window: spans 0.52 of the width, from 0.36 up to 0.80 of the height (canvas y downwards)
    const ww = w * 0.5;
    const x0 = (w - ww) / 2;
    const yTop = h * 0.20;
    const yBot = h * 0.60;
    c.fillStyle = '#a9926a';
    c.beginPath();
    c.moveTo(x0 - 16, yBot);
    c.lineTo(x0 - 16, yTop + ww / 2);
    c.arc(w / 2, yTop + ww / 2, ww / 2 + 16, Math.PI, 0);
    c.lineTo(x0 + ww + 16, yBot);
    c.fill();
    c.fillStyle = '#3d4a54';
    c.beginPath();
    c.moveTo(x0, yBot);
    c.lineTo(x0, yTop + ww / 2);
    c.arc(w / 2, yTop + ww / 2, ww / 2, Math.PI, 0);
    c.lineTo(x0 + ww, yBot);
    c.fill();
    c.fillStyle = 'rgba(214,190,130,0.30)';
    c.fillRect(x0 + 6, yTop + ww / 2, ww - 12, yBot - yTop - ww / 2);
    c.fillStyle = '#e4dcc6';
    for (let i = 1; i < 9; i++) c.fillRect(x0 + (ww * i) / 9 - 2, yTop + 8, 4, yBot - yTop - 8);
    for (let j = 1; j < 5; j++) c.fillRect(x0, yTop + ((yBot - yTop) * j) / 5, ww, 3);
    // balustrade + portal below
    c.fillStyle = '#b39c74';
    c.fillRect(x0 - 30, yBot, ww + 60, 16);
    c.fillStyle = '#2f3840';
    c.fillRect(x0 + 20, yBot + 30, ww - 40, h - yBot - 30);
    c.fillStyle = 'rgba(190,210,225,0.18)';
    c.fillRect(x0 + 24, yBot + 34, ww - 48, h - yBot - 34);
    // coat of arms in the pediment
    c.fillStyle = '#b39c74';
    c.beginPath();
    c.arc(w / 2, h * 0.08, 20, 0, 6.3);
    c.fill();
    c.fillStyle = '#8a7650';
    c.beginPath();
    c.arc(w / 2, h * 0.08, 12, 0, 6.3);
    c.fill();
  }

  function slateTex(c, w, h) {
    const rnd = seeded(5);
    c.fillStyle = '#434a54';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 12) {
      for (let x = (y / 12) % 2 ? 0 : 8; x < w; x += 16) {
        const v = 58 + Math.floor(rnd() * 22);
        c.fillStyle = 'rgb(' + v + ',' + (v + 5) + ',' + (v + 12) + ')';
        c.fillRect(x + 1, y + 1, 14, 10);
      }
    }
  }

  function timberTex(c, w, h) {
    const rnd = seeded(9);
    c.fillStyle = '#b27a40';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      const v = Math.floor((rnd() - 0.5) * 40);
      c.fillStyle = 'rgba(' + (v > 0 ? '255,214,160' : '60,32,10') + ',' + (Math.abs(v) / 120).toFixed(2) + ')';
      c.fillRect(0, y, w, 7);
      c.fillStyle = 'rgba(40,22,8,0.55)';
      c.fillRect(0, y + 7, w, 1);
    }
  }

  function paverTex(c, w, h) {
    // 256 px = 4 m along the platform; u across (0 = track edge) - drawn for a 7 m platform in 8 m of u
    const rnd = seeded(31);
    c.fillStyle = '#6a6d72';
    c.fillRect(0, 0, w, h);
    const bw = 16;
    const bh = 8;
    for (let y = 0; y < h; y += bh) {
      for (let x = (y / bh) % 2 ? 0 : bw / 2; x < w; x += bw) {
        const v = 92 + Math.floor(rnd() * 28);
        c.fillStyle = 'rgb(' + v + ',' + (v + 1) + ',' + (v + 4) + ')';
        c.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    // edge strip (white line + beige tactile band) near u = 0
    const mpx = w / 8;
    c.fillStyle = '#d9d6cc';
    c.fillRect(0, 0, 0.08 * mpx, h);
    c.fillStyle = '#b8ad8d';
    c.fillRect(0.75 * mpx, 0, 0.5 * mpx, h);
    c.fillStyle = 'rgba(70,64,48,0.45)';
    for (let y = 4; y < h; y += 8) for (let x = 0.78 * mpx; x < 1.22 * mpx; x += 8) c.fillRect(x, y, 3, 3);
    c.fillStyle = '#8f9196';
    c.fillRect(1.25 * mpx, 0, 0.35 * mpx, h);
  }

  function bedTex(c, w, h) {
    // ballast with sleepers (256 px = 2.6 m along, one sleeper per 0.6 m)
    const rnd = seeded(41);
    c.fillStyle = '#8d8a85';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 90 + Math.floor(rnd() * 90);
      c.fillStyle = 'rgba(' + v + ',' + (v - 4) + ',' + (v - 10) + ',0.55)';
      c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    c.fillStyle = '#5f5a53';
    for (let y = 0; y < h; y += 64) c.fillRect(w * 0.18, y + 10, w * 0.64, 24);
  }

  function stationSignTex(c, w, h, label) {
    c.fillStyle = '#17407a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.font = '700 ' + Math.floor(h * 0.62) + 'px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, w / 2, h / 2 + 2);
  }

  /* ---------------------------------------------------------------- extra tracks + platforms (visual only) */
  // a track at lateral position lat from z0 to z1 (ballast bed with sleepers + two rails)
  function addTrack(k, lat, z0, z1) {
    const bed = k.tex('bed', 256, 256, bedTex);
    const len = Math.abs(z1 - z0);
    const a = Math.min(z0, z1);
    const b = Math.max(z0, z1);
    const v = len / 2.6;
    k.quadL(bed, [lat - 2.1, -0.245, a], [lat + 2.1, -0.245, a], [lat + 2.1, -0.245, b], [lat - 2.1, -0.245, b], [0, 1, 0], k.WHITE, [[0, 0], [1.4, 0], [1.4, v], [0, v]]);
    const steel = k.sets.get('steel', k.M.steel);
    [-0.7175, 0.7175].forEach((o) => k.box(steel, lat + o, -0.075, (a + b) / 2, 0.075, 0.15, len, k.col('#8b8680')));
  }

  /* platform slab (+ tactile edge) at lateral range [l0,l1] (positive away from our track on the far side use negative sign) */
  function addIslandPlatform(k, latA, latB, zN, zP) {
    // latA = near edge (to the track it serves), latB = far edge; both signed lateral values
    const mid = (latA + latB) / 2;
    const len = zP - zN;
    const cz = (zP + zN) / 2;
    const body = k.sets.get('luA:slab', () => k.M.vc(), true);
    k.box(body, mid, (k.H + k.FORM_Y) / 2 - 0.005, cz, Math.abs(latB - latA), k.H - k.FORM_Y - 0.01, len, k.col('#b4b1aa'));
    const pav = k.sets.get('luA:pavers', () => k.mat('luA:pavers', () => new k.T.MeshStandardMaterial({ map: k.canvasTex('luA:pavers', 256, 256, paverTex), vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    // texture u runs from the edge (u=0) across 8 m; the near edge is latA
    const dir = Math.sign(latB - latA);
    const w = Math.abs(latB - latA);
    const uMax = w / 8;
    const vA = zN / 4;
    const vB = zP / 4;
    k.quadL(pav, [latA, k.H + 0.004, zN], [latB, k.H + 0.004, zN], [latB, k.H + 0.004, zP], [latA, k.H + 0.004, zP], [0, 1, 0], k.WHITE, [[0, vA], [uMax, vA], [uMax, vB], [0, vB]]);
    return dir;
  }

  /* ---------------------------------------------------------------- wavy timber canopy */
  const waveAt = (z) => Math.sin(z * 0.17) * 0.5 + Math.sin(z * 0.43 + 1.3) * 0.12;
  function addWaveCanopy(k, latIn, latOut, hIn, hOut, z0, z1, opts) {
    const o = opts || {};
    const timber = k.tex('timber', 128, 128, timberTex);
    const dark = k.vc;
    const roofCol = k.col('#363c42');
    const fasciaCol = k.col('#252a2f');
    const step = 2.5;
    const n = Math.max(1, Math.ceil((z1 - z0) / step));
    const damp = o.damp === undefined ? 0.55 : o.damp;
    for (let i = 0; i < n; i++) {
      const za = z0 + ((z1 - z0) * i) / n;
      const zb = z0 + ((z1 - z0) * (i + 1)) / n;
      const wa = waveAt(za);
      const wb = waveAt(zb);
      const yIa = hIn + wa * damp;
      const yIb = hIn + wb * damp;
      const yOa = hOut + wa;
      const yOb = hOut + wb;
      // timber soffit (faces down)
      k.quadL(timber, [latIn, yIa, za], [latOut, yOa, za], [latOut, yOb, zb], [latIn, yIb, zb], [0, -1, 0], k.WHITE, [[0, za / 3], [1, za / 3], [1, zb / 3], [0, zb / 3]]);
      // top
      k.quadL(dark, [latIn, yIa + 0.22, za], [latOut, yOa + 0.22, za], [latOut, yOb + 0.22, zb], [latIn, yIb + 0.22, zb], [0, 1, 0], roofCol);
      // thick fascia on the outer edge
      k.quadL(dark, [latOut, yOa - 0.05, za], [latOut, yOa + 0.34, za], [latOut, yOb + 0.34, zb], [latOut, yOb - 0.05, zb], [Math.sign(latOut - latIn) * k.sx, 0, 0], fasciaCol);
    }
    return n;
  }

  /* ================================================================== LËTZEBUERG */
  function buildLetzebuerg(api) {
    const k = kit(api);
    const { T, vc, col, FORM_Y, WHITE, H, sx, sets, M, mat, P, helpers, pf } = k;
    const stone = col(SAND);
    const trim = col('#b6a07a');
    const green = col('#5b937f');
    const greenD = col('#4f8a76');
    const dark = col('#23282d');
    const WALL = 8.8; // platform-side face of the building (lat)
    const wallT = k.tex('wing', 256, 336, wingTex);
    const wallB = k.tex('wingback', 256, 336, wingBackTex);
    const gable = k.tex('gable', 512, 640, gableTex);
    const plain = k.tex('stone', 256, 256, (c, w, h) => stoneBase(c, w, h, SAND, 60, 16, seeded(3)));
    const slate = k.tex('slate', 128, 128, slateTex);
    const eY = 10.5; // eaves of the wings

    // ---- a long wing with a mansard roof (ridge along z). lat l0 (platform side) .. l1 (street side)
    function wing(z0, z1, l0, l1, eaves, opts) {
      const o = opts || {};
      const y0 = FORM_Y;
      const bays = Math.max(1, Math.round((z1 - z0) / 8));
      const vTop = (eaves - y0) / (eY - y0);
      // texture is 8 m x 11 m: u per bay, v ~ 1
      k.quadL(wallB, [l0, y0, z1], [l0, y0, z0], [l0, eaves, z0], [l0, eaves, z1], [-sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, vTop], [0, vTop]]);
      k.quadL(wallT, [l1, y0, z0], [l1, y0, z1], [l1, eaves, z1], [l1, eaves, z0], [sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, vTop], [0, vTop]]);
      k.quadL(plain, [l0, y0, z0], [l1, y0, z0], [l1, eaves, z0], [l0, eaves, z0], [0, 0, -1], WHITE, [[0, 0], [2, 0], [2, 1.2], [0, 1.2]]);
      k.quadL(plain, [l1, y0, z1], [l0, y0, z1], [l0, eaves, z1], [l1, eaves, z1], [0, 0, 1], WHITE, [[0, 0], [2, 0], [2, 1.2], [0, 1.2]]);
      // cornice
      k.box(vc, (l0 + l1) / 2, eaves + 0.1, (z0 + z1) / 2, l1 - l0 + 1.0, 0.45, z1 - z0 + 1.0, trim);
      // mansard: steep lower slopes + shallow top
      const lm = (l0 + l1) / 2;
      const inset = 1.6;
      const hLow = 4.0;
      const hTop = 2.5;
      const yE = eaves + 0.35;
      const yK = yE + hLow;
      const yR = yK + hTop;
      const rz0 = z0 - 0.3;
      const rz1 = z1 + 0.3;
      const rl = (z1 - z0) / 6;
      [[l0, 1], [l1, -1]].forEach(([le, d]) => {
        // d: +1 slopes towards larger lat
        k.quadL(slate, [le, yE, rz0], [le, yE, rz1], [le + d * inset, yK, rz1], [le + d * inset, yK, rz0], [-d * sx * 0.9, 0.45, 0], WHITE, [[0, 0], [rl, 0], [rl, 1], [0, 1]]);
        k.quadL(slate, [le + d * inset, yK, rz0], [le + d * inset, yK, rz1], [lm, yR, rz1], [lm, yR, rz0], [-d * sx * 0.4, 1, 0], WHITE, [[0, 0], [rl, 0], [rl, 1.6], [0, 1.6]]);
      });
      // end caps of the mansard (closed with slate)
      [[rz0, -1], [rz1, 1]].forEach(([zz, dz]) => {
        k.quadL(slate, [l0, yE, zz], [l0 + inset, yK, zz], [l1 - inset, yK, zz], [l1, yE, zz], [0, 0, dz], WHITE, [[0, 0], [1, 1], [3, 1], [4, 0]]);
        k.triUV(slate, [l0 + inset, yK, zz], [l1 - inset, yK, zz], [lm, yR, zz], [0, 0, dz], [[0, 0], [2, 0], [1, 1]]);
      });
      // dormers (copper-green eyebrow dormers) on the lower slope, both sides
      if (!o.noDormers) {
        for (let z = z0 + 4; z < z1 - 2; z += 8) {
          [[l0, 1, -sx], [l1, -1, sx]].forEach(([le, d]) => {
            const dl = le + d * (inset * 0.55);
            const dy = yE + hLow * 0.5;
            k.box(vc, dl + d * 0.1, dy, z, 0.9, 1.5, 1.7, stone);
            k.box(vc, dl + d * 0.62, dy - 0.05, z, 0.1, 1.05, 1.15, col('#2f3b45'));
            k.box(vc, dl + d * 0.2, dy + 0.95, z, 1.2, 0.18, 2.1, green, 0, 0, d * sx * 0.35);
          });
        }
      }
      // chimneys
      for (let z = z0 + 14; z < z1 - 8; z += 36) k.box(vc, lm, yR + 1.0, z, 1.0, 2.2, 1.0, col('#a4846b'));
    }

    // ---- big hall block: gable towards the street and towards the platforms, ridge along lat. z0..z1 wide
    function hall(z0, z1, l0, l1, eaves, ridge) {
      const y0 = FORM_Y;
      const zc = (z0 + z1) / 2;
      const half = (z1 - z0) / 2;
      const ov = 0.7;
      // walls on the long sides
      [[z0, -1], [z1, 1]].forEach(([zz, dz]) => {
        k.quadL(plain, dz > 0 ? [l1, y0, zz] : [l0, y0, zz], dz > 0 ? [l0, y0, zz] : [l1, y0, zz], dz > 0 ? [l0, eaves, zz] : [l1, eaves, zz], dz > 0 ? [l1, eaves, zz] : [l0, eaves, zz], [0, 0, dz], WHITE, [[0, 0], [(l1 - l0) / 8, 0], [(l1 - l0) / 8, (eaves - y0) / 8], [0, (eaves - y0) / 8]]);
      });
      // gables (street side l1 and platform side l0)
      [[l1, 1], [l0, -1]].forEach(([le, d]) => {
        const vE = (eaves - y0) / (ridge - y0);
        const nrm = [d * sx, 0, 0];
        k.quadL(gable, [le, y0, z0], [le, y0, z1], [le, eaves, z1], [le, eaves, z0], nrm, WHITE, [[0, 0], [1, 0], [1, vE], [0, vE]]);
        k.triUV(gable, [le, eaves, z0], [le, eaves, z1], [le, ridge, zc], nrm, [[0, vE], [1, vE], [0.5, 1]]);
        // pediment trim
        k.between(vc, [le + d * 0.1, eaves, z0 - 0.4], [le + d * 0.1, ridge + 0.1, zc], 0.5, trim, 0.4);
        k.between(vc, [le + d * 0.1, eaves, z1 + 0.4], [le + d * 0.1, ridge + 0.1, zc], 0.5, trim, 0.4);
      });
      // slate roof
      const rl = (l1 - l0) / 6;
      const ya = eaves + 0.3;
      k.quadL(slate, [l0 - ov, ya, z0 - ov], [l1 + ov, ya, z0 - ov], [l1 + ov, ridge + 0.3, zc], [l0 - ov, ridge + 0.3, zc], [0, 0.7, -1], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      k.quadL(slate, [l1 + ov, ya, z1 + ov], [l0 - ov, ya, z1 + ov], [l0 - ov, ridge + 0.3, zc], [l1 + ov, ridge + 0.3, zc], [0, 0.7, 1], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      k.box(vc, (l0 + l1) / 2, ridge + 0.4, zc, l1 - l0 + 1.4, 0.3, 0.5, col('#3a4048'));
      void half;
    }

    // ---- the clock tower
    function tower(lc, zc, wd) {
      const t0 = FORM_Y;
      const t1 = 33;
      const a = lc - wd / 2;
      const b = lc + wd / 2;
      const z0 = zc - wd / 2;
      const z1 = zc + wd / 2;
      const face = k.tex('tower', 256, 512, (c, w, h) => {
        stoneBase(c, w, h, SAND, 60, 16, seeded(77));
        c.fillStyle = '#c0aa84';
        c.fillRect(0, 0, 30, h);
        c.fillRect(w - 30, 0, 30, h);
        for (let y = 0; y < h; y += 20) {
          c.fillStyle = 'rgba(60,44,22,0.5)';
          c.fillRect(0, y, 30, 2);
          c.fillRect(w - 30, y, 30, 2);
        }
        // slim arched window with balcony
        archWindow(c, w / 2 - 14, 250, 28, 110);
        c.fillStyle = '#b39c74';
        c.fillRect(w / 2 - 28, 372, 56, 14);
        c.fillStyle = '#2b3036';
        for (let i = 0; i < 9; i++) c.fillRect(w / 2 - 26 + i * 6.5, 340, 2, 32);
        // oval clock surround
        c.fillStyle = '#b39c74';
        c.beginPath();
        c.ellipse(w / 2, 100, 78, 90, 0, 0, 6.3);
        c.fill();
        c.fillStyle = '#9b8560';
        c.beginPath();
        c.ellipse(w / 2, 100, 66, 78, 0, 0, 6.3);
        c.fill();
      });
      const vT = (t1 - t0) / 33;
      const wallsQ = [
        [[a, t0, z1], [a, t0, z0], [a, t1, z0], [a, t1, z1], [-sx, 0, 0]],
        [[b, t0, z0], [b, t0, z1], [b, t1, z1], [b, t1, z0], [sx, 0, 0]],
        [[a, t0, z0], [b, t0, z0], [b, t1, z0], [a, t1, z0], [0, 0, -1]],
        [[b, t0, z1], [a, t0, z1], [a, t1, z1], [b, t1, z1], [0, 0, 1]],
      ];
      wallsQ.forEach(([p, q2, r, s2, n]) => k.quadL(face, p, q2, r, s2, n, WHITE, [[0, 0], [1, 0], [1, vT], [0, vT]]));
      // clocks on the four faces
      const clk = sets.get('clock', helpers.clockMat);
      const cy = 29.0;
      const cs = 4.6;
      helpers.textQuad(clk, [pf(a) - sx * 0.08, cy, zc], cs, cs, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
      helpers.textQuad(clk, [pf(b) + sx * 0.08, cy, zc], cs, cs, [sx, 0, 0], [0, 0, -sx], [0, 1, 0]);
      helpers.textQuad(clk, [pf(lc), cy, z0 - 0.08], cs, cs, [0, 0, -1], [-sx, 0, 0], [0, 1, 0]);
      helpers.textQuad(clk, [pf(lc), cy, z1 + 0.08], cs, cs, [0, 0, 1], [sx, 0, 0], [0, 1, 0]);
      // cornice
      k.box(vc, lc, t1 + 0.3, zc, wd + 1.1, 0.7, wd + 1.1, trim);
      k.box(vc, lc, t1 + 0.75, zc, wd + 0.5, 0.35, wd + 0.5, col('#c1ab85'));
      // corner pinnacles
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([u, v]) => {
        k.box(vc, lc + u * (wd / 2 + 0.2), t1 + 1.7, zc + v * (wd / 2 + 0.2), 0.7, 1.7, 0.7, trim);
        k.frust(vc, lc + u * (wd / 2 + 0.2), t1 + 2.5, zc + v * (wd / 2 + 0.2), 0.02, 0.45, 1.8, green, 4, Math.PI / 4);
      });
      // bell-shaped copper dome (green), gallery, two lantern stages, slim spire (about 21 m of cap in the real tower)
      let y = t1 + 1.0;
      [[3.6, 4.0, 0.9], [4.4, 3.6, 1.0], [4.7, 4.4, 0.9], [3.8, 4.7, 1.2], [2.3, 3.8, 1.5], [2.0, 2.3, 0.7]].forEach(([rt, rb, h]) => {
        k.frust(vc, lc, y, zc, rt, rb, h, green, 12, 0.1);
        y += h;
      });
      k.frust(vc, lc, y, zc, 2.1, 2.1, 0.5, col('#d0c2a0'), 12);
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * Math.PI * 2;
        k.box(vc, lc + Math.cos(an) * 2.0, y + 0.95, zc + Math.sin(an) * 2.0, 0.14, 0.9, 0.14, col('#d0c2a0'), -an);
      }
      y += 0.5;
      // lantern stage 1: dark shaft with green posts
      k.frust(vc, lc, y, zc, 1.55, 1.55, 3.6, col('#2e4a42'), 8);
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2 + Math.PI / 8;
        k.box(vc, lc + Math.cos(an) * 1.75, y + 1.8, zc + Math.sin(an) * 1.75, 0.34, 3.6, 0.34, green, -an);
      }
      y += 3.6;
      k.frust(vc, lc, y, zc, 0.9, 2.1, 1.2, green, 8);
      y += 1.2;
      k.frust(vc, lc, y, zc, 1.1, 1.1, 2.4, col('#2e4a42'), 8);
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.box(vc, lc + Math.cos(an) * 1.2, y + 1.2, zc + Math.sin(an) * 1.2, 0.26, 2.4, 0.26, green, -an);
      }
      y += 2.4;
      k.frust(vc, lc, y, zc, 0.5, 1.5, 1.3, green, 8);
      y += 1.3;
      k.frust(vc, lc, y, zc, 0.03, 0.4, 6.0, green, 8);
      k.box(vc, lc, y + 6.2, zc, 0.12, 1.2, 0.12, col('#c7a83a'));
      k.box(vc, lc, y + 6.5, zc, 0.12, 0.45, 0.9, col('#c7a83a'));
    }

    function annex(z0, z1, l0, l1, hgt) {
      const y0 = FORM_Y;
      const bays = Math.max(1, Math.round((z1 - z0) / 8));
      const vTop = (hgt - y0) / 11;
      k.quadL(wallB, [l0, y0, z1], [l0, y0, z0], [l0, hgt, z0], [l0, hgt, z1], [-sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, vTop], [0, vTop]]);
      k.quadL(plain, [l1, y0, z0], [l1, y0, z1], [l1, hgt, z1], [l1, hgt, z0], [sx, 0, 0], WHITE, [[0, 0], [5, 0], [5, 1], [0, 1]]);
      k.quadL(plain, [l0, y0, z0], [l1, y0, z0], [l1, hgt, z0], [l0, hgt, z0], [0, 0, -1], WHITE, [[0, 0], [2, 0], [2, 1], [0, 1]]);
      k.quadL(plain, [l1, y0, z1], [l0, y0, z1], [l0, hgt, z1], [l1, hgt, z1], [0, 0, 1], WHITE, [[0, 0], [2, 0], [2, 1], [0, 1]]);
      k.box(vc, (l0 + l1) / 2, hgt + 0.2, (z0 + z1) / 2, l1 - l0 + 0.8, 0.45, z1 - z0 + 0.8, trim);
      k.box(vc, (l0 + l1) / 2, hgt + 0.5, (z0 + z1) / 2, l1 - l0 + 0.2, 0.2, z1 - z0 + 0.2, col('#585e64'));
    }

    // ---- layout (z: + = behind, - = ahead; the train drives to -z)
    wing(-40, 70, WALL, WALL + 12, eY);
    // low service annex that closes the platform wall towards the buffer end
    annex(70, 108, WALL, WALL + 9, 7.6);
    hall(-72, -50, WALL, WALL + 26, 19.5, 28);
    wing(-106, -72, WALL, WALL + 13, eY + 0.5);
    tower(WALL + 11, -45, 8.4);
    // central mid block between the tower and the left wing (low) and entrance canopy on the street side (stone portal)
    k.box(vc, WALL + 27.5, 3.6, -61, 3.0, 0.3, 16, dark);
    [-67, -61, -55].forEach((z) => k.box(vc, WALL + 26.4, 1.7, z, 0.3, 4.2, 0.3, dark));
    // name on the platform-side wall of the tower block
    const nameB = sets.get('sign:' + api.st.name, () => M.sign(api.st.name, helpers.signTexture(api.st.name, 'rail')));
    helpers.textQuad(nameB, [pf(WALL) - sx * 0.1, 7.4, -22], 9, 1.4, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);

    // ---- platform paving (dark grey pavers + beige tactile band) over the generic slab
    const pav = sets.get('luA:pavers', () => mat('luA:pavers', () => new T.MeshStandardMaterial({ map: k.canvasTex('luA:pavers', 256, 256, paverTex), vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    const zA = api.zA;
    const zB = api.zB;
    const uM = api.W / 8;
    k.quadL(pav, [api.edge, H + 0.004, zA], [api.edge + api.W, H + 0.004, zA], [api.edge + api.W, H + 0.004, zB], [api.edge, H + 0.004, zB], [0, 1, 0], WHITE, [[0, zA / 4], [uM, zA / 4], [uM, zB / 4], [0, zB / 4]]);

    // ---- our platform canopy: sweeping timber-soffit wave, steel fascia, slender steel columns, glazed waiting rooms
    const cz0 = zB + 4;
    const cz1 = zA - 4;
    addWaveCanopy(k, WALL - 0.1, api.edge + 1.0, 7.4, 5.0, cz0, cz1);
    for (let z = cz0 + 5; z < cz1 - 3; z += 12.5) {
      const hh = 5.0 + 2.4 * 0.38 + waveAt(z) * 0.8;
      k.frust(vc, api.edge + 5.4, H, z, 0.17, 0.17, hh - H - 0.2, dark, 8);
      sets.get('glow', M.glow).box(pf(api.edge + 3.4), 5.65 + waveAt(z) * 0.7, z + 6, 0.2, 0.05, 3.0, col('#fff0cc'));
      // a station clock on every other column
      if (Math.round((z - cz0) / 12.5) % 4 === 1) {
        const clk = sets.get('clock', helpers.clockMat);
        k.box(vc, api.edge + 5.4, H + 3.5, z, 0.05, 0.9, 0.05, dark);
        helpers.textQuad(clk, [pf(api.edge + 5.4), H + 3.2, z + 0.05], 0.8, 0.8, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
        helpers.textQuad(clk, [pf(api.edge + 5.4), H + 3.2, z - 0.05], 0.8, 0.8, [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
      }
    }
    // glazed waiting cabins + benches
    [60, 12, -45].forEach((z) => {
      k.box(vc, api.edge + 3.9, H + 2.8, z, 2.3, 0.14, 9.2, dark);
      [[-4.4, 0.8], [4.4, 0.8], [-4.4, -0.8], [4.4, -0.8]].forEach(([dz, dl]) => k.box(vc, api.edge + 3.9 + dl, H + 1.4, z + dz, 0.12, 2.8, 0.12, dark));
      k.box(k.glass, api.edge + 4.7, H + 1.4, z, 0.05, 2.5, 8.8, WHITE);
      k.box(k.glass, api.edge + 3.9, H + 1.4, z - 4.5, 2.2, 2.5, 0.05, WHITE);
      k.box(vc, api.edge + 4.2, H + 0.45, z, 0.5, 0.06, 3.0, col('#6a7076'));
      k.box(vc, api.edge + 4.2, H + 0.22, z, 0.1, 0.44, 2.6, col('#40464b'));
    });
    // benches (perforated steel) along the building wall, bins, blue 'Voie' signs
    const voie = sets.get('luA:voie', () => M.sign('luA:voie', k.canvasTex('luA:voie', 256, 96, (c, w, h) => stationSignTex(c, w, h, 'Voie 1'), { clampU: true, clampV: true })));
    for (let z = cz0 + 12; z < cz1 - 8; z += 25) {
      k.box(vc, WALL - 0.5, H + 0.45, z, 0.45, 0.06, 1.8, col('#7d838a'));
      k.box(vc, WALL - 0.32, H + 0.85, z, 0.05, 0.4, 1.8, col('#7d838a'));
      k.box(vc, WALL - 0.5, H + 0.22, z, 0.1, 0.44, 1.5, col('#40464b'));
      k.frust(vc, WALL - 1.0, H, z + 3, 0.22, 0.22, 0.8, col('#3b5a47'), 8);
      helpers.textQuad(voie, [pf(api.edge + 5.4), 4.7 + waveAt(z) * 0.8, z + 6.2], 1.5, 0.56, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
      helpers.textQuad(voie, [pf(api.edge + 5.4), 4.7 + waveAt(z) * 0.8, z + 6.2], 1.5, 0.56, [sx, 0, 0], [0, 0, -sx], [0, 1, 0]);
    }

    // ---- other tracks + island platform with its own wave canopy + the 2000s glass hall at the head of the station
    const tz0 = zB - 55;
    const tz1 = zA + 35;
    addTrack(k, -4.5, tz0, tz1);
    addTrack(k, -9.0, tz0, tz1);
    addTrack(k, -19.4, tz0, tz1);
    addIslandPlatform(k, -10.7, -17.7, zB, zA);
    addWaveCanopy(k, -17.9, -11.2, 5.9, 4.3, zB + 6, zA - 6, { damp: 0.4 });
    for (let z = zB + 11; z < zA - 8; z += 12.5) k.frust(vc, -14.3, H, z, 0.17, 0.17, 4.7 - H + waveAt(z) * 0.5, dark, 8);
    for (let z = zB + 17; z < zA - 15; z += 38) {
      k.box(k.glass, -14.3, H + 1.3, z, 0.05, 2.4, 9, WHITE);
      k.box(k.glass, -12.6, H + 1.3, z - 4.5, 3.4, 2.4, 0.05, WHITE);
    }
    // overhead portals (grey steel lattice) over the tracks, above the catenary
    for (let z = zB + 6; z < zA - 4; z += 45) {
      const st1 = col('#8a9096');
      k.box(vc, -2.7, 4.4, z, 0.28, 8.8, 0.28, st1);
      k.box(vc, -12.0, 4.4, z, 0.28, 8.8, 0.28, st1);
      k.box(vc, -7.35, 8.6, z, 9.6, 0.34, 0.5, st1);
      k.box(vc, -7.35, 9.1, z, 9.6, 0.1, 0.1, st1);
      for (let x = -11.5; x < -3; x += 1.9) k.between(vc, [x, 8.45, z], [x + 0.95, 9.1, z], 0.06, st1);
    }
    glassHall(k, { zStart: zB - 3, zEnd: zB - 52, latL: -12.5, latR: WALL + 1.7, ySpring: 7.4, rise: 5.6 });
  }

  // the glazed vault with the diagonal lattice over the head of the station
  function glassHall(k, o) {
    const { vc, col, FORM_Y, sets, M, glass } = k;
    const steelM = sets.get('luA:hallsteel', () => k.mat('luA:hallsteel', () => new k.T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 })), true);
    const half = (o.latR - o.latL) / 2;
    const lc = (o.latR + o.latL) / 2;
    const seg = 12;
    const ribs = Math.max(4, Math.round(Math.abs(o.zEnd - o.zStart) / 4));
    const arch = [];
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI - (i / seg) * Math.PI;
      arch.push([lc + half * Math.cos(a), o.ySpring + o.rise * Math.sin(a)]);
    }
    const zs = [];
    for (let r = 0; r <= ribs; r++) zs.push(o.zStart + ((o.zEnd - o.zStart) * r) / ribs);
    const ribCol = col('#d6dadd');
    zs.forEach((z) => {
      for (let i = 0; i < seg; i++) k.between(steelM, [arch[i][0], arch[i][1], z], [arch[i + 1][0], arch[i + 1][1], z], 0.22, ribCol, 0.4);
      [arch[0], arch[seg]].forEach((p) => k.between(steelM, [p[0], FORM_Y, z], [p[0], p[1], z], 0.4, col('#c9cdd0'), 0.4));
    });
    // diagonal lattice between ribs (the diamond pattern of the real hall)
    for (let r = 0; r < ribs; r++) {
      for (let i = 0; i < seg; i += 1) {
        const a = arch[i];
        const b = arch[i + 1];
        if ((i + r) % 2 === 0) k.between(steelM, [a[0], a[1], zs[r]], [b[0], b[1], zs[r + 1]], 0.09, ribCol);
        else k.between(steelM, [a[0], a[1], zs[r + 1]], [b[0], b[1], zs[r]], 0.09, ribCol);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = arch[i];
      const b = arch[i + 1];
      k.quadL(glass, [a[0], a[1], o.zStart], [b[0], b[1], o.zStart], [b[0], b[1], o.zEnd], [a[0], a[1], o.zEnd], [0, 1, 0], k.WHITE);
    }
    const g = sets.get('glow', M.glow);
    for (let z = Math.min(o.zStart, o.zEnd) + 6; z < Math.max(o.zStart, o.zEnd); z += 9) g.box(k.pf(lc), o.ySpring + o.rise - 0.7, z, 0.5, 0.1, 2.0, col('#fff2cc'));
  }


  /* ================================================================== shared kit for the smaller stations */
  const MAROON = '#7d2230';
  const BAYW = 3.2;

  // facade tile: one bay (BAYW m wide) x `floors` floors; windows with trim, optional arched ground floor, plinth, cornice
  function facadeTile(c, w, h, cfg) {
    const rnd = seeded(cfg.seed || 7);
    c.fillStyle = cfg.wall;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const v = Math.floor(rnd() * 60);
      c.fillStyle = 'rgba(' + (rnd() > 0.5 ? '255,250,235' : '60,50,40') + ',' + (v / 600).toFixed(3) + ')';
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    if (cfg.coursing) {
      c.fillStyle = 'rgba(70,56,36,0.22)';
      for (let y = 0; y < h; y += 12) c.fillRect(0, y, w, 1);
    }
    const fl = cfg.floors;
    const fh = h / fl;
    for (let f = 0; f < fl; f++) {
      const y0 = f * fh;
      const ground = f === fl - 1;
      const ww = w * (cfg.ww || 0.42);
      const wh = fh * ((ground && cfg.arch ? 0.62 : cfg.wh) || 0.5);
      const wx = (w - ww) / 2;
      const wy = y0 + fh * (ground && cfg.arch ? 0.14 : 0.18);
      c.fillStyle = cfg.trim || '#ece6d6';
      if (ground && cfg.arch) {
        c.beginPath();
        c.moveTo(wx - 5, wy + wh);
        c.lineTo(wx - 5, wy + ww / 2);
        c.arc(w / 2, wy + ww / 2, ww / 2 + 5, Math.PI, 0);
        c.lineTo(wx + ww + 5, wy + wh);
        c.fill();
      } else c.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
      c.fillStyle = cfg.glass || '#4a5a68';
      if (ground && cfg.arch) {
        c.beginPath();
        c.moveTo(wx, wy + wh);
        c.lineTo(wx, wy + ww / 2);
        c.arc(w / 2, wy + ww / 2, ww / 2, Math.PI, 0);
        c.lineTo(wx + ww, wy + wh);
        c.fill();
      } else c.fillRect(wx, wy, ww, wh);
      c.fillStyle = 'rgba(210,225,235,0.22)';
      c.fillRect(wx + 2, wy + wh * 0.45, ww - 4, wh * 0.5);
      c.fillStyle = cfg.frame || '#ece6d6';
      c.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      c.fillRect(wx, wy + wh * 0.38, ww, 3);
      if (cfg.frameOuter) {
        c.strokeStyle = cfg.frame;
        c.lineWidth = 4;
        c.strokeRect(wx + 1, wy + 1, ww - 2, wh - 2);
      }
      if (cfg.shutter) {
        c.fillStyle = cfg.shutter;
        c.fillRect(wx - ww * 0.42, wy, ww * 0.38, wh);
        c.fillRect(wx + ww * 1.04, wy, ww * 0.38, wh);
      }
      c.fillStyle = cfg.sill || 'rgba(60,50,40,0.35)';
      c.fillRect(wx - 6, wy + wh + 5, ww + 12, 4);
    }
    if (cfg.plinth) {
      c.fillStyle = cfg.plinth;
      c.fillRect(0, h - h * 0.07, w, h * 0.07);
    }
    c.fillStyle = cfg.band || 'rgba(60,50,40,0.28)';
    for (let f = 1; f < fl; f++) c.fillRect(0, f * fh - 3, w, 5);
  }
  const facadeBatch = (k, cfg) => k.tex('fac:' + JSON.stringify(cfg), 128, Math.round(128 * cfg.floors * (cfg.floorH || 3.3) / BAYW), (c, w, h) => facadeTile(c, w, h, cfg));

  // simple tri in lateral coords (flat colour)
  const triC = (k, b, a, bb, c, nrm, color) => b.tri(k.P(...a), k.P(...bb), k.P(...c), nrm, color);

  /* box building with a roof (ridge along z). o: lat0 (platform side), lat1, z0, z1, floors, floorH, cfg (facade), roof {type, h, col}, baseY */
  function building(k, o) {
    const { sx, FORM_Y, WHITE, col, vc } = k;
    const y0 = o.baseY !== undefined ? o.baseY : FORM_Y;
    const fh = o.floorH || 3.3;
    const cfg = Object.assign({ floorH: fh, floors: o.floors }, o.cfg);
    const fb = facadeBatch(k, cfg);
    const yE = y0 + 0.55 + o.floors * fh;
    const bays = Math.max(1, Math.round((o.z1 - o.z0) / BAYW));
    const baysE = Math.max(1, Math.round(Math.abs(o.lat1 - o.lat0) / BAYW));
    const vT = (yE - y0) / (o.floors * fh + 0.55) * 1.0;
    const { lat0: l0, lat1: l1, z0, z1 } = o;
    k.quadL(fb, [l0, y0, z1], [l0, y0, z0], [l0, yE, z0], [l0, yE, z1], [-sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, vT], [0, vT]]);
    k.quadL(fb, [l1, y0, z0], [l1, y0, z1], [l1, yE, z1], [l1, yE, z0], [sx, 0, 0], WHITE, [[0, 0], [bays, 0], [bays, vT], [0, vT]]);
    k.quadL(fb, [l0, y0, z0], [l1, y0, z0], [l1, yE, z0], [l0, yE, z0], [0, 0, -1], WHITE, [[0, 0], [baysE, 0], [baysE, vT], [0, vT]]);
    k.quadL(fb, [l1, y0, z1], [l0, y0, z1], [l0, yE, z1], [l1, yE, z1], [0, 0, 1], WHITE, [[0, 0], [baysE, 0], [baysE, vT], [0, vT]]);
    const trim = col(o.trim || '#d8d2c2');
    k.box(vc, (l0 + l1) / 2, yE + 0.12, (z0 + z1) / 2, l1 - l0 + 0.5, 0.26, z1 - z0 + 0.5, trim);
    const r = o.roof || { type: 'hip', h: 3 };
    const rc = col(r.col || '#4b535d');
    const slate = k.tex('slate', 128, 128, slateTex);
    const ov = 0.55;
    const ya = yE + 0.26;
    const lm = (l0 + l1) / 2;
    const yR = ya + (r.h || 3);
    const wallC = col(cfg.wall);
    if (r.type === 'flat') {
      k.box(vc, lm, yE + 0.38, (z0 + z1) / 2, l1 - l0 + 0.9, 0.26, z1 - z0 + 0.9, col(r.col || '#6b7076'));
      return yE;
    }
    if (r.type === 'pent') {
      // single slope, high side on the platform side
      const hi = r.h || 1.4;
      k.quadL(slate, [l0 - ov, ya + hi, z0 - ov], [l0 - ov, ya + hi, z1 + ov], [l1 + ov, ya, z1 + ov], [l1 + ov, ya, z0 - ov], [-sx * 0.2, 1, 0], WHITE, [[0, 0], [(z1 - z0) / 3, 0], [(z1 - z0) / 3, 3], [0, 3]]);
      triC(k, vc, [l0, yE, z0], [l1, yE, z0], [l0, ya + hi, z0], [0, 0, -1], wallC);
      triC(k, vc, [l1, yE, z1], [l0, yE, z1], [l0, ya + hi, z1], [0, 0, 1], wallC);
      return yE;
    }
    const rl = (z1 - z0) / 4;
    if (r.type === 'gable') {
      k.quadL(slate, [l0 - ov, ya, z0 - ov], [l0 - ov, ya, z1 + ov], [lm, yR, z1 + ov], [lm, yR, z0 - ov], [-sx, 1, 0], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      k.quadL(slate, [l1 + ov, ya, z1 + ov], [l1 + ov, ya, z0 - ov], [lm, yR, z0 - ov], [lm, yR, z1 + ov], [sx, 1, 0], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      triC(k, vc, [l0, yE, z0], [l1, yE, z0], [lm, yR, z0], [0, 0, -1], wallC);
      triC(k, vc, [l1, yE, z1], [l0, yE, z1], [lm, yR, z1], [0, 0, 1], wallC);
    } else {
      // hip: ridge along z, shortened by the half width at both ends
      const half = Math.abs(l1 - l0) / 2 + ov;
      const ra = Math.min(z0 - ov + half, (z0 + z1) / 2);
      const rb = Math.max(z1 + ov - half, (z0 + z1) / 2);
      k.quadL(slate, [l0 - ov, ya, z0 - ov], [l0 - ov, ya, z1 + ov], [lm, yR, rb], [lm, yR, ra], [-sx, 1, 0], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      k.quadL(slate, [l1 + ov, ya, z1 + ov], [l1 + ov, ya, z0 - ov], [lm, yR, ra], [lm, yR, rb], [sx, 1, 0], WHITE, [[0, 0], [rl, 0], [rl, 3], [0, 3]]);
      k.triUV(slate, [l0 - ov, ya, z0 - ov], [l1 + ov, ya, z0 - ov], [lm, yR, ra], [0, 0.8, -1], [[0, 0], [3, 0], [1.5, 2]]);
      k.triUV(slate, [l1 + ov, ya, z1 + ov], [l0 - ov, ya, z1 + ov], [lm, yR, rb], [0, 0.8, 1], [[0, 0], [3, 0], [1.5, 2]]);
    }
    if (r.chimney) r.chimney.forEach((z) => k.box(vc, lm, yR + 0.4, z, 0.8, 1.6, 0.8, col('#9a7a62')));
    void rc;
    return yE;
  }

  // pyramid-roofed square tower (corner/centre tower of the old CFL buildings)
  function tower(k, lat, z, side, y0, hWall, hRoof, cfg, roofCol, clock) {
    const fb = facadeBatch(k, Object.assign({ floorH: hWall / 2, floors: 2 }, cfg));
    const a = lat - side / 2;
    const b = lat + side / 2;
    const za = z - side / 2;
    const zb = z + side / 2;
    const yT = y0 + hWall;
    const bays = Math.max(1, Math.round(side / BAYW));
    const W = k.WHITE;
    const sx = k.sx;
    k.quadL(fb, [a, y0, zb], [a, y0, za], [a, yT, za], [a, yT, zb], [-sx, 0, 0], W, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    k.quadL(fb, [b, y0, za], [b, y0, zb], [b, yT, zb], [b, yT, za], [sx, 0, 0], W, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    k.quadL(fb, [a, y0, za], [b, y0, za], [b, yT, za], [a, yT, za], [0, 0, -1], W, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    k.quadL(fb, [b, y0, zb], [a, y0, zb], [a, yT, zb], [b, yT, zb], [0, 0, 1], W, [[0, 0], [bays, 0], [bays, 1], [0, 1]]);
    k.box(k.vc, lat, yT + 0.12, z, side + 0.5, 0.26, side + 0.5, k.col('#d8d2c2'));
    k.frust(k.vc, lat, yT + 0.25, z, 0.02, side * 0.78, hRoof, k.col(roofCol), 4, Math.PI / 4);
    if (clock) {
      const clk = k.sets.get('clock', k.helpers.clockMat);
      k.helpers.textQuad(clk, [k.pf(a) - sx * 0.06, yT - 2.0, z], 1.5, 1.5, [-sx, 0, 0], [0, 0, sx], [0, 1, 0]);
      k.helpers.textQuad(clk, [k.pf(b) + sx * 0.06, yT - 2.0, z], 1.5, 1.5, [sx, 0, 0], [0, 0, -sx], [0, 1, 0]);
    }
  }

  // small dormers on a roof slope (lat = lateral position, dir = +1 faces larger lat)
  function dormers(k, lat, z0, z1, y, dir, spacing, wallHex, roofHex) {
    for (let z = z0; z <= z1; z += spacing) {
      k.box(k.vc, lat, y, z, 0.8, 1.3, 1.5, k.col(wallHex));
      k.box(k.vc, lat + dir * 0.45, y - 0.02, z, 0.08, 0.9, 1.0, k.col('#2f3b45'));
      k.box(k.vc, lat + dir * 0.1, y + 0.8, z, 1.1, 0.16, 1.9, k.col(roofHex), 0, 0, -dir * k.sx * 0.3);
    }
  }

  // floor of the platform: paving + tactile band. variant: 'grey' | 'brick' | 'slab' (white-striped slabs, newer stations)
  const PAVE_STYLES = {
    grey: { base: '#7d7f84', lo: 112, hi: 142, band: '#b8ad8d', stripe: false },
    brick: { base: '#7a7672', lo: 108, hi: 136, band: '#c9bf9a', stripe: false, tint: [6, -2, -6] },
    slab: { base: '#a3a4a6', lo: 150, hi: 176, band: '#e8e8e6', stripe: true },
  };
  function paverTex2(c, w, h, st) {
    const rnd = seeded(31);
    c.fillStyle = st.base;
    c.fillRect(0, 0, w, h);
    const bw = st.stripe ? 32 : 16;
    const bh = st.stripe ? 32 : 8;
    const t = st.tint || [0, 0, 0];
    for (let y = 0; y < h; y += bh) {
      for (let x = st.stripe ? 0 : (y / bh) % 2 ? 0 : bw / 2; x < w; x += bw) {
        const v = st.lo + Math.floor(rnd() * (st.hi - st.lo));
        c.fillStyle = 'rgb(' + (v + t[0]) + ',' + (v + t[1]) + ',' + (v + t[2]) + ')';
        c.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    const mpx = w / 8;
    c.fillStyle = '#e4e2da';
    c.fillRect(0, 0, 0.08 * mpx, h);
    if (st.stripe) {
      c.fillStyle = '#d4d6d8';
      c.fillRect(0.55 * mpx, 0, 1.0 * mpx, h);
      c.fillStyle = '#f4f4f2';
      for (let y = 0; y < h; y += 28) c.fillRect(0.55 * mpx, y, 1.0 * mpx, 12);
    } else {
      c.fillStyle = st.band;
      c.fillRect(0.75 * mpx, 0, 0.5 * mpx, h);
      c.fillStyle = 'rgba(70,64,48,0.45)';
      for (let y = 4; y < h; y += 8) for (let x = 0.78 * mpx; x < 1.22 * mpx; x += 8) c.fillRect(x, y, 3, 3);
      c.fillStyle = '#e1d8a8';
      c.fillRect(0.1 * mpx, 0, 0.05 * mpx, h);
    }
  }
  function platformSurface(k, variant, z0, z1) {
    const key = 'luA:pave:' + variant;
    const st = PAVE_STYLES[variant] || PAVE_STYLES.grey;
    const pav = k.sets.get(key, () => k.mat(key, () => new k.T.MeshStandardMaterial({ map: k.canvasTex(key, 256, 256, (c, w, h) => paverTex2(c, w, h, st)), vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    const a = z0 === undefined ? k.zA : z0;
    const b = z1 === undefined ? k.zB : z1;
    const uM = k.W / 8;
    k.quadL(pav, [k.edge, k.H + 0.004, a], [k.edge + k.W, k.H + 0.004, a], [k.edge + k.W, k.H + 0.004, b], [k.edge, k.H + 0.004, b], [0, 1, 0], k.WHITE, [[0, a / 4], [uM, a / 4], [uM, b / 4], [0, b / 4]]);
  }

  // another platform + track beyond our track (visual only). side -1: other side of our track; lat = track position
  function otherPlatform(k, opts) {
    const o = Object.assign({ trackLat: -4.5, width: 4.4, z0: k.zB, z1: k.zA, variant: 'grey', shelter: true, shelterAt: [-10, 35], shelterCol: MAROON }, opts);
    addTrack(k, o.trackLat, o.z0 - 40, o.z1 + 40);
    const e0 = o.trackLat - 1.7;
    const e1 = e0 - o.width;
    const slab = k.sets.get('luA:slab', () => k.M.vc(), true);
    k.box(slab, (e0 + e1) / 2, (k.H + k.FORM_Y) / 2 - 0.005, (o.z0 + o.z1) / 2, o.width, k.H - k.FORM_Y - 0.01, o.z1 - o.z0, k.col('#b4b1aa'));
    const key = 'luA:pave:' + o.variant;
    const st = PAVE_STYLES[o.variant] || PAVE_STYLES.grey;
    const pav = k.sets.get(key, () => k.mat(key, () => new k.T.MeshStandardMaterial({ map: k.canvasTex(key, 256, 256, (c, w, h) => paverTex2(c, w, h, st)), vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    const uM = o.width / 8;
    k.quadL(pav, [e0, k.H + 0.004, o.z0], [e1, k.H + 0.004, o.z0], [e1, k.H + 0.004, o.z1], [e0, k.H + 0.004, o.z1], [0, 1, 0], k.WHITE, [[0, o.z0 / 4], [uM, o.z0 / 4], [uM, o.z1 / 4], [0, o.z1 / 4]]);
    if (o.shelter) o.shelterAt.forEach((z) => shelter(k, e0 - 1.4, z, 9, 2.3, o.shelterCol, true));
    return { e0, e1 };
  }

  // open-frame passenger shelter (posts, glazed roof panels, glazed back, bench). lat = centre across, z = centre along
  function shelter(k, lat, z, len, depth, hex, glazedBack) {
    const { vc, col, H } = k;
    const c = col(hex);
    const hgt = 2.6;
    [-1, 1].forEach((u) => [-1, 0, 1].forEach((v) => k.box(vc, lat + u * depth / 2, H + hgt / 2, z + v * (len / 2 - 0.1), 0.12, hgt, 0.12, c)));
    k.box(vc, lat, H + hgt + 0.08, z, depth + 0.5, 0.12, len + 0.4, c, 0, 0, 0.06);
    k.box(k.glass, lat, H + hgt + 0.2, z, depth + 0.3, 0.04, len, k.WHITE, 0, 0, 0.06);
    if (glazedBack) k.box(k.glass, lat + depth / 2, H + 1.3, z, 0.04, 2.3, len - 0.3, k.WHITE);
    k.box(vc, lat + depth / 2 - 0.35, H + 0.45, z, 0.45, 0.06, len * 0.65, c);
    k.box(vc, lat + depth / 2 - 0.35, H + 0.22, z, 0.08, 0.44, len * 0.55, k.col('#40464b'));
  }

  // flat-roofed platform canopy with columns
  function canopy(k, o) {
    const { vc, col, H } = k;
    const roof = col(o.roof || '#c9cdcf');
    const fas = col(o.fascia || '#252a2f');
    const colC = col(o.col || '#2c3136');
    const n = Math.max(1, Math.round((o.z1 - o.z0) / 2.5));
    const len = o.z1 - o.z0;
    const cz = (o.z0 + o.z1) / 2;
    const lm = (o.lat0 + o.lat1) / 2;
    const tilt = Math.atan2(o.hIn - o.hOut, Math.abs(o.lat1 - o.lat0)) * (o.lat0 > o.lat1 ? 1 : -1);
    k.box(vc, lm, (o.hIn + o.hOut) / 2, cz, Math.abs(o.lat1 - o.lat0) + 0.2, 0.18, len, roof, 0, 0, tilt * k.sx);
    // lighter soffit (lit a little from the platform lights) so the underside does not read as black
    const soffit = k.sets.get('luA:soffit', () => k.mat('luA:soffit', () => new k.T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: new k.T.Color(0x3a3a3a) })));
    k.box(soffit, lm, (o.hIn + o.hOut) / 2 - 0.1, cz, Math.abs(o.lat1 - o.lat0) + 0.1, 0.04, len - 0.1, col(o.soffit || '#a8a49c'), 0, 0, tilt * k.sx);
    k.box(vc, o.lat1, o.hOut - 0.05, cz, 0.1, 0.4, len, fas);
    for (let z = o.z0 + 2; z <= o.z1 - 1; z += o.spacing || 10) {
      k.box(vc, o.colLat, H + (o.hOut - H) / 2 - 0.1, z, o.colSize || 0.2, o.hOut - H - 0.2, o.colSize || 0.2, colC);
      if (o.lights) k.glow.box(k.pf(o.colLat - 0.8), o.hOut - 0.12, z + (o.spacing || 10) / 2, 0.25, 0.05, 2.0, col('#fff3d0'));
    }
    void n;
  }

  // CFL blue totem (information pylon) and blue 'Voie' board
  function totem(k, lat, z) {
    k.box(k.vc, lat, k.H + 1.2, z, 0.5, 2.4, 0.3, k.col('#1d4f94'));
    k.box(k.vc, lat, k.H + 1.6, z, 0.4, 0.9, 0.32, k.col('#0f2547'));
    k.box(k.vc, lat, k.H + 2.35, z, 0.5, 0.12, 0.34, k.col('#b4232b'));
  }
  function voieBoard(k, label, lat, z, y) {
    const key = 'luA:voie:' + label;
    const b = k.sets.get(key, () => k.M.sign(key, k.canvasTex(key, 256, 96, (c, w, h) => stationSignTex(c, w, h, label), { clampU: true, clampV: true })));
    k.vc.box(k.pf(lat), y - 0.9, z, 0.07, 1.8, 0.07, k.col('#6a7076'));
    const h = k.helpers;
    h.textQuad(b, [k.pf(lat), y, z + 0.05], 1.1, 0.42, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    h.textQuad(b, [k.pf(lat), y, z - 0.05], 1.1, 0.42, [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
  }

  // ordinary extra 'yard' tracks beyond the other platform
  function yardTracks(k, lats, z0, z1) {
    lats.forEach((l) => addTrack(k, l, z0, z1));
  }

  // steel-arch road/foot bridge across the tracks (z = centre, width along z), deck bottom at yBot, spanning lat a..b
  function overBridge(k, o) {
    const { vc, col } = k;
    const deck = col(o.deck || '#8f9398');
    const yb = o.yBot;
    const lm = (o.latA + o.latB) / 2;
    const span = Math.abs(o.latB - o.latA);
    k.box(vc, lm, yb + 0.5, o.z, span, 1.0, o.width, deck);
    k.box(vc, o.latA, yb / 2 - 0.3, o.z, 1.6, yb + 0.5, o.width, col(o.pier || '#9a9ea3'));
    k.box(vc, o.latB, yb / 2 - 0.3, o.z, 1.6, yb + 0.5, o.width, col(o.pier || '#9a9ea3'));
    [-1, 1].forEach((d) => k.box(vc, lm, yb + 1.5, o.z + d * (o.width / 2 - 0.05), span, 0.9, 0.08, col('#2f3b45')));
  }


  /* ---------------------------------------------------------------- more helpers */
  const sphereGeos = new Map();
  function sphere(k, b, lat, y, z, rx, ry, rz, color, segs) {
    const key = segs || 14;
    let g = sphereGeos.get(key);
    if (!g) {
      g = new k.T.SphereGeometry(1, key, Math.max(6, Math.round(key / 2)));
      sphereGeos.set(key, g);
    }
    const m = new k.T.Matrix4().compose(new k.T.Vector3(k.pf(lat), y, z), new k.T.Quaternion(), new k.T.Vector3(rx, ry, rz));
    b.geom(g, m, color);
  }

  // stairs down to an underpass: white-tiled low walls, dark void, glazed pitched canopy on a coloured frame
  function stairCanopy(k, o) {
    const { vc, col, H } = k;
    const c = col(o.col || MAROON);
    const w = o.w || 2.6;
    const len = o.len || 5;
    k.quadL(vc, [o.lat - w / 2 + 0.15, H + 0.012, o.z - len / 2], [o.lat + w / 2 - 0.15, H + 0.012, o.z - len / 2], [o.lat + w / 2 - 0.15, H + 0.012, o.z + len / 2], [o.lat - w / 2 + 0.15, H + 0.012, o.z + len / 2], [0, 1, 0], col('#1b1e21'));
    [-1, 1].forEach((u) => k.box(vc, o.lat + u * (w / 2), H + 0.45, o.z, 0.14, 0.9, len, col('#e6e4dc')));
    k.box(vc, o.lat, H + 0.45, o.z + len / 2, w, 0.9, 0.14, col('#e6e4dc'));
    if (o.glazed === false) return;
    [-1, 1].forEach((u) => [-1, 0, 1].forEach((v) => k.box(vc, o.lat + u * (w / 2), H + 1.5, o.z + v * (len / 2 - 0.1), 0.1, 3.0, 0.1, c)));
    // pitched roof (two glass slopes meeting at a ridge)
    const rise = 0.9;
    [-1, 1].forEach((u) => {
      k.box(k.glass, o.lat + u * (w / 4 + 0.05), H + 3.0 + rise / 2, o.z, w / 2 + 0.2, 0.05, len + 0.3, k.WHITE, 0, 0, -u * k.sx * 0.42);
      k.box(vc, o.lat + u * (w / 4 + 0.05), H + 3.0 + rise / 2, o.z - len / 2, w / 2 + 0.2, 0.1, 0.1, c, 0, 0, -u * k.sx * 0.42);
      k.box(vc, o.lat + u * (w / 4 + 0.05), H + 3.0 + rise / 2, o.z + len / 2, w / 2 + 0.2, 0.1, 0.1, c, 0, 0, -u * k.sx * 0.42);
    });
    k.box(vc, o.lat, H + 3.0 + rise, o.z, 0.12, 0.1, len + 0.3, c);
  }

  // footbridge across the tracks with towers on both sides (towers outside the track envelope)
  function footBridge(k, o) {
    const { vc, col } = k;
    const deck = col(o.deck || '#c9cdd0');
    const lm = (o.latA + o.latB) / 2;
    const span = Math.abs(o.latB - o.latA);
    k.box(vc, lm, o.yBot + 0.3, o.z, span, 0.6, o.width, deck);
    [-1, 1].forEach((d) => {
      k.box(k.glass, lm, o.yBot + 1.3, o.z + d * (o.width / 2), span, 1.6, 0.04, k.WHITE);
      k.box(vc, lm, o.yBot + 2.1, o.z + d * (o.width / 2), span, 0.1, 0.1, col(o.rail || '#e8eaec'));
    });
    k.box(vc, lm, o.yBot + 2.4, o.z, span, 0.12, o.width + 0.3, col(o.roof || '#d4d8da'));
    [o.latA, o.latB].forEach((l, i) => {
      const dir = i === 0 ? Math.sign(o.latA - o.latB) : Math.sign(o.latB - o.latA);
      k.box(vc, l + dir * 0.1, (o.yBot + 2.4) / 2 - 0.3, o.z, 2.6, o.yBot + 2.4 + 0.5, o.width + 0.6, col(o.tower || '#d9dcde'));
      if (o.fins) for (let z = o.z - o.width / 2; z <= o.z + o.width / 2; z += 0.6) k.box(vc, l - dir * 1.45, (o.yBot + 2.4) / 2 - 0.3, z, 0.08, o.yBot + 2.4 + 0.5, 0.2, col(o.fins));
      k.box(k.glass, l - dir * 1.35, o.yBot / 2, o.z, 0.04, o.yBot, o.width, k.WHITE);
    });
  }

  function furnish(k, o) {
    const { edge, W, col, vc, H } = k;
    (o.totems || []).forEach((z) => totem(k, edge + W - 0.9, z));
    (o.voie || []).forEach(([label, z, lat]) => voieBoard(k, label, lat === undefined ? edge + 1.6 : lat, z, H + 2.7));
    (o.benches || []).forEach((z) => {
      k.box(vc, edge + W - 0.7, H + 0.45, z, 0.45, 0.06, 1.8, col('#7d838a'));
      k.box(vc, edge + W - 0.52, H + 0.85, z, 0.05, 0.4, 1.8, col('#7d838a'));
      k.box(vc, edge + W - 0.7, H + 0.22, z, 0.1, 0.44, 1.5, col('#40464b'));
    });
    (o.bins || []).forEach((z) => k.frust(vc, edge + W - 0.5, H, z, 0.2, 0.2, 0.8, col('#d96b17'), 8));
    (o.bikebox || []).forEach(([lat, z]) => {
      k.box(vc, lat, H + 1.2, z, 2.4, 2.4, 4.6, col('#a8aaac'));
      k.box(vc, lat, H + 1.2, z, 2.45, 1.7, 1.6, col('#a5262e'));
    });
  }

  // wide glass hall ETFE vault with steel arches (Belval): translucent white
  function etfeVault(k, o) {
    const { sets, M, mat, col, T } = k;
    const etfe = sets.get('luA:etfe', () => mat('luA:etfe', () => new T.MeshStandardMaterial({ color: 0xf4f8fb, emissive: new T.Color(0x56606a), transparent: true, opacity: 0.66, roughness: 0.3, metalness: 0.1, side: T.DoubleSide, depthWrite: false })));
    const steel = sets.get('luA:hallsteel', () => mat('luA:hallsteel', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 })), true);
    const half = (o.latR - o.latL) / 2;
    const lc = (o.latR + o.latL) / 2;
    const seg = 10;
    const arch = [];
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI - (i / seg) * Math.PI;
      arch.push([lc + half * Math.cos(a), o.ySpring + o.rise * Math.sin(a)]);
    }
    const n = Math.max(3, Math.round((o.z1 - o.z0) / o.ribGap));
    for (let r = 0; r <= n; r++) {
      const z = o.z0 + ((o.z1 - o.z0) * r) / n;
      for (let i = 0; i < seg; i++) k.between(steel, [arch[i][0], arch[i][1], z], [arch[i + 1][0], arch[i + 1][1], z], 0.38, col(o.rib || '#323a40'), 0.5);
    }
    for (let i = 1; i < seg; i += 2) k.between(steel, [arch[i][0], arch[i][1] + 0.1, o.z0], [arch[i][0], arch[i][1] + 0.1, o.z1], 0.14, col(o.rib || '#323a40'));
    for (let i = 0; i < seg; i++) {
      const a = arch[i];
      const b = arch[i + 1];
      k.quadL(etfe, [a[0], a[1], o.z0], [b[0], b[1], o.z0], [b[0], b[1], o.z1], [a[0], a[1], o.z1], [0, 1, 0], k.WHITE);
    }
  }

  // steel arch bridge across the tracks (Bettembuerg): deck on hangers under a big arch rib on each edge
  function archBridge(k, o) {
    const { vc, col } = k;
    const steel = col(o.col || '#d9dcde');
    const lm = (o.latA + o.latB) / 2;
    const span = Math.abs(o.latB - o.latA);
    k.box(vc, lm, o.yBot + 0.5, o.z, span, 1.0, o.width, col('#8f9398'));
    [o.latA, o.latB].forEach((l) => k.box(vc, l, o.yBot / 2 - 0.3, o.z, 2.2, o.yBot + 0.5, o.width, col('#9a9ea3')));
    const yDeck = o.yBot + 1.0;
    const pts = [];
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1;
      pts.push([lm + (u * span) / 2, yDeck + o.rise * (1 - u * u)]);
    }
    [-1, 1].forEach((d) => {
      const zz = o.z + d * (o.width / 2 - 0.2);
      for (let i = 0; i < n; i++) k.between(vc, [pts[i][0], pts[i][1], zz], [pts[i + 1][0], pts[i + 1][1], zz], 0.55, steel, 0.55);
      for (let i = 1; i < n; i++) k.between(vc, [pts[i][0], pts[i][1], zz], [pts[i][0], yDeck, zz], 0.06, col('#e8eaec'), 0.06);
      k.box(vc, lm, yDeck + 0.5, zz, span, 0.9, 0.08, col('#cfd3d6'));
    });
  }

  /* ---------------------------------------------------------------- the small stations */
  const SANDSTONE = { wall: '#c9b88e', trim: '#e2d8bc', frame: '#6b4a34', glass: '#3f4d58', arch: true, coursing: true, shutter: null };

  // Hollerich: pale sage-cream two-storey building with arched ground-floor windows, hipped slate roof; small red booth, glazed stair
  // canopy (dark-red frame) to the underpass, black technical cube; several tracks and a yard beside the line
  function buildHollerich(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'grey');
    building(k, { lat0: BACK + 3.2, lat1: BACK + 12.6, z0: 6, z1: 34, floors: 2, floorH: 3.7, cfg: { wall: '#d2d9bd', trim: '#efe2c4', frame: '#efe9d6', glass: '#5a4038', arch: true, ww: 0.4, band: 'rgba(214,160,140,0.55)', plinth: '#c8a98c', seed: 4 }, trim: '#e9d4b4', roof: { type: 'hip', h: 3.2, col: '#444b54', chimney: [14, 26] } });
    k.box(k.vc, BACK + 4.5, 2.0, 46, 3.6, 4.2, 4.2, k.col('#1d2023'));
    shelter(k, k.edge + 3.2, -12, 6, 2.0, '#a8262e', true);
    stairCanopy(k, { lat: k.edge + 3.4, z: -34, col: '#7a2430', w: 2.6, len: 5.5 });
    furnish(k, { totems: [4], voie: [['Voie 1', -22], ['Voie 1', 28]], benches: [20, -45], bins: [10] });
    yardTracks(k, [-4.5, -9, -13.5, -18], k.zB - 40, k.zA + 40);
  }

  // Berchem: pale roughcast two-storey building with a slate gable roof and a lower side wing; long low glazed concrete shelter on the platform
  function buildBerchem(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'brick');
    building(k, { lat0: BACK + 2.4, lat1: BACK + 10.4, z0: -12, z1: 10, floors: 2, floorH: 3.6, cfg: { wall: '#dcd8bd', trim: '#efe6c2', frame: '#7a5232', glass: '#4b4c4e', arch: true, ww: 0.3, wh: 0.5, plinth: '#c4bfa6', seed: 9 }, roof: { type: 'gable', h: 3.4, col: '#4a4b50', chimney: [-6, 6] } });
    building(k, { lat0: BACK + 2.4, lat1: BACK + 7.4, z0: 10, z1: 18, floors: 1, floorH: 3.6, cfg: { wall: '#dcd8bd', trim: '#efe6c2', frame: '#7a5232', glass: '#4b4c4e', arch: true, ww: 0.3, plinth: '#c4bfa6' }, roof: { type: 'hip', h: 2.0, col: '#4a4b50' } });
    // long low glazed shelter (concrete frame, band of windows), flat roof
    k.box(k.vc, k.edge + 4.2, k.H + 1.35, -34, 2.3, 2.7, 15, k.col('#bfc1be'));
    k.box(k.vc, k.edge + 3.0, k.H + 1.65, -34, 0.08, 1.0, 13.6, k.col('#2f3b45'));
    k.box(k.vc, k.edge + 3.7, k.H + 2.8, -34, 3.4, 0.18, 16, k.col('#8e9296'));
    furnish(k, { totems: [8], voie: [['Voie 1', -10], ['Voie 1', 40]], benches: [-10, 30], bins: [22] });
    otherPlatform(k, { width: 4.2, variant: 'brick', shelterAt: [-20], shelterCol: '#8a8e92' });
    voieBoard(k, 'Voie 2', -5.3, -10, k.H + 2.7);
  }

  // Bettembuerg: long cream-yellow two-storey building with maroon windows and a centre clock tower with a dark pyramid roof; cast-iron canopies;
  // the big white steel arch bridge over the tracks at the head of the station; many tracks
  function buildBettembuerg(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'grey');
    const cfg = { wall: '#e4d9a4', trim: '#f2eee0', frame: '#f2eee0', glass: '#4e3a3e', arch: false, ww: 0.36, wh: 0.52, plinth: '#cdbf86', frameOuter: false, seed: 14, band: 'rgba(120,100,60,0.25)' };
    building(k, { lat0: BACK + 3.4, lat1: BACK + 11.6, z0: -34, z1: 26, floors: 2, floorH: 3.5, cfg, trim: '#f0ead6', roof: { type: 'gable', h: 2.6, col: '#5a5f66', chimney: [-20, 4, 18] } });
    tower(k, BACK + 5.2, -4, 5.4, -0.55, 11.5, 3.6, cfg, '#3f444b', true);
    canopy(k, { lat0: BACK + 3.2, lat1: k.edge + 1.4, hIn: 4.9, hOut: 4.0, z0: -50, z1: 38, colLat: k.edge + 3.9, col: MAROON, roof: '#bfc6c6', fascia: '#6f1f2c', spacing: 6, colSize: 0.2, lights: true });
    furnish(k, { totems: [6], voie: [['Voie 1', -40], ['Voie 1', 34]], benches: [-30, 20], bins: [0] });
    otherPlatform(k, { width: 5.2, variant: 'grey', shelterAt: [-16, 14], shelterCol: MAROON });
    yardTracks(k, [-13.4, -17.9, -22.4], k.zB - 40, k.zA + 40);
    archBridge(k, { z: -150, width: 11, latA: -17, latB: 14, yBot: 8.6, rise: 16 });
  }

  // Esch-Uelzecht: new station of dark panel and glass with orange accents, long canopies on slim dark iron columns, pale striped-tactile slabs,
  // footbridge across the tracks, rust-red apartment/office block behind, island platform with its own canopy
  function buildEsch(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'slab');
    building(k, { lat0: BACK + 2.4, lat1: BACK + 14, z0: -24, z1: 26, floors: 2, floorH: 4.2, cfg: { wall: '#43474d', trim: '#c9672b', frame: '#23272b', glass: '#6d90a4', arch: false, ww: 0.78, wh: 0.58, plinth: '#2f3236', seed: 22, band: 'rgba(201,103,43,0.9)' }, trim: '#2f3236', roof: { type: 'flat', col: '#7d8286' } });
    k.box(k.vc, BACK + 2.35, 4.4, 26.4, 0.4, 9.2, 0.7, k.col('#d6762a'));
    k.box(k.vc, BACK + 2.35, 4.4, -24.4, 0.4, 9.2, 0.7, k.col('#d6762a'));
    // colourful block
    building(k, { lat0: BACK + 18, lat1: BACK + 28, z0: 20, z1: 70, floors: 5, floorH: 3.3, cfg: { wall: '#b24f31', trim: '#d7b6a0', frame: '#e8dcc8', glass: '#4b5560', arch: false, ww: 0.5, wh: 0.5, seed: 31, band: 'rgba(120,60,40,0.4)' }, roof: { type: 'flat', col: '#8a8f93' } });
    building(k, { lat0: BACK + 18, lat1: BACK + 27, z0: -60, z1: -22, floors: 4, floorH: 3.3, cfg: { wall: '#c9c6bd', trim: '#e8e4da', frame: '#d6762a', glass: '#4b5560', arch: false, ww: 0.55, wh: 0.5, seed: 37 }, roof: { type: 'flat', col: '#8a8f93' } });
    canopy(k, { lat0: BACK + 0.2, lat1: k.edge + 1.2, hIn: 5.4, hOut: 4.5, z0: -96, z1: 96, colLat: k.edge + 4.8, col: '#4a413b', roof: '#d9dcde', fascia: '#5b4b43', spacing: 8, colSize: 0.24, lights: true });
    const op = otherPlatform(k, { width: 6, variant: 'slab', shelter: false });
    canopy(k, { lat0: op.e1 + 0.4, lat1: op.e0 - 1.0, hIn: 5.0, hOut: 4.4, z0: -90, z1: 90, colLat: (op.e0 + op.e1) / 2, col: '#4a413b', roof: '#d9dcde', fascia: '#5b4b43', spacing: 8, colSize: 0.24 });
    yardTracks(k, [-13.9, -18.4, -22.9], k.zB - 40, k.zA + 40);
    footBridge(k, { z: -70, latA: BACK + 2.2, latB: -17, yBot: 6.9, width: 3.2, deck: '#e9ecee' });
    furnish(k, { totems: [-8], voie: [['Voie 1', -60], ['Voie 1', 60]], benches: [-30, 30, 70], bins: [10, -50] });
  }

  // Belval-Université: translucent white barrel vault on steel arches over the platforms, round white concrete columns, the pod-shaped glass
  // station building at the head, red-brown Belval Plaza block behind
  function buildBelval(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'slab');
    etfeVault(k, { z0: -78, z1: 78, ribGap: 6.5, latL: -9.4, latR: BACK + 0.6, ySpring: 5.6, rise: 4.4, rib: '#2c3338' });
    for (let z = -72; z <= 72; z += 16) {
      k.frust(k.vc, k.edge + 3.2, k.H, z, 0.55, 0.45, 5.1, k.col('#e6e4de'), 14);
      k.frust(k.vc, k.edge + 3.2, k.H + 5.0, z, 1.1, 0.55, 1.0, k.col('#e6e4de'), 14);
    }
    // pod-shaped station building
    sphere(k, k.vc, BACK + 9, 5.2, 96, 7.2, 3.6, 13, k.col('#ecebe6'), 18);
    sphere(k, k.vc, BACK + 9, 4.4, 96, 7.4, 2.0, 13.2, k.col('#5d8195'), 18);
    k.box(k.vc, BACK + 9, 1.1, 96, 3.6, 4.0, 8, k.col('#d9d8d2'));
    building(k, { lat0: BACK + 14, lat1: BACK + 24, z0: -60, z1: 40, floors: 4, floorH: 3.4, cfg: { wall: '#9a4b33', trim: '#c9a090', frame: '#2c2e30', glass: '#3f4c58', arch: false, ww: 0.5, wh: 0.46, seed: 51, band: 'rgba(60,30,20,0.35)' }, roof: { type: 'flat', col: '#767b7f' } });
    furnish(k, { totems: [10], voie: [['Voie 1', -50], ['Voie 1', 50]], benches: [-40, 0, 40], bins: [24] });
    yardTracks(k, [-4.5, -9, -13.5], k.zB - 40, k.zA + 40);
  }

  // Déifferdang: platform below the old town on a sandstone retaining wall with stairs; big ochre building with a mansard roof above; dark-red
  // glass shelter, black glass cabin, rust-coloured (Corten) underpass arch, blue totems
  function buildDeifferdang(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'grey');
    const stoneB = k.tex('stone', 256, 256, (c, w, h) => stoneBase(c, w, h, '#c9b68d', 50, 16, seeded(3)));
    const hT = 3.4;
    k.quadL(stoneB, [BACK + 0.6, -0.55, -64], [BACK + 0.6, -0.55, 64], [BACK + 0.6, hT, 64], [BACK + 0.6, hT, -64], [-k.sx, 0, 0], k.WHITE, [[0, 0], [24, 0], [24, 1.5], [0, 1.5]]);
    k.box(k.vc, BACK + 7.6, (hT - 0.55) / 2 - 0.1, 0, 14, hT + 0.55, 128, k.col('#8f8774'));
    k.box(k.vc, BACK + 0.6, hT + 0.55, 0, 0.7, 0.2, 128, k.col('#a99f88'));
    for (let z = -63; z <= 63; z += 3) k.box(k.vc, BACK + 0.6, hT + 0.55, z, 0.05, 1.1, 0.05, k.col('#5a6066'));
    k.box(k.vc, BACK + 0.6, hT + 1.1, 0, 0.04, 0.05, 128, k.col('#5a6066'));
    building(k, { lat0: BACK + 4, lat1: BACK + 13, z0: -20, z1: 20, baseY: hT, floors: 3, floorH: 3.4, cfg: { wall: '#dcc27c', trim: '#eee4c6', frame: '#f0ead8', glass: '#4a4a50', arch: false, ww: 0.36, seed: 61, plinth: '#c7ae6a' }, trim: '#b9a05c', roof: { type: 'hip', h: 4.6, col: '#5c4a42', chimney: [-10, 8] } });
    dormers(k, BACK + 5.2, -16, 16, hT + 0.55 + 3 * 3.4 + 1.6, -1, 5.5, '#dcc27c', '#5c4a42');
    shelter(k, k.edge + 3.1, 0, 12, 2.4, '#8a1f33', true);
    k.box(k.vc, k.edge + 3.2, k.H + 1.3, -40, 3.0, 2.6, 3.4, k.col('#15181b'));
    k.box(k.glass, k.edge + 1.69, k.H + 1.3, -40, 0.04, 2.2, 3.0, k.WHITE);
    // rust arch of the underpass
    const rust = k.col('#9a5430');
    [-1.6, 1.6].forEach((d) => k.box(k.vc, BACK + 0.3, k.H + 1.4, 30 + d, 0.2, 2.8, 0.3, rust));
    k.box(k.vc, BACK + 0.3, k.H + 2.95, 30, 0.2, 0.3, 3.5, rust);
    furnish(k, { totems: [-16], voie: [['Voie 1', -30], ['Voie 1', 40]], benches: [-6, 24] });
    otherPlatform(k, { width: 4.4, variant: 'grey', shelter: false });
    voieBoard(k, 'Voie 2', -5.3, -30, k.H + 2.7);
  }

  // Péiteng: sandstone station with a square corner tower under a pyramid slate roof; long historic canopy on dark-red cast-iron columns with
  // glazed roof; white-tiled stairs to the underpass; wide track field
  function buildPeiteng(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'grey');
    const cfg = { wall: '#c3ad82', trim: '#e0d3b4', frame: '#6b2a2a', glass: '#3d3f44', arch: true, ww: 0.4, coursing: true, plinth: '#a8946a', seed: 71 };
    building(k, { lat0: BACK + 3.2, lat1: BACK + 11.2, z0: -4, z1: 28, floors: 2, floorH: 3.9, cfg, trim: '#d4c49c', roof: { type: 'hip', h: 3.6, col: '#434a52', chimney: [4, 20] } });
    tower(k, BACK + 5.4, -9, 5.2, -0.55, 12.5, 4.2, cfg, '#434a52', false);
    building(k, { lat0: BACK + 3.2, lat1: BACK + 9.2, z0: 28, z1: 60, floors: 1, floorH: 5.0, cfg: Object.assign({}, cfg, { ww: 0.5 }), trim: '#d4c49c', roof: { type: 'gable', h: 2.4, col: '#434a52' } });
    canopy(k, { lat0: BACK + 3.0, lat1: k.edge + 0.9, hIn: 4.9, hOut: 4.1, z0: -64, z1: 66, colLat: k.edge + 3.4, col: '#7a1d2a', roof: '#c4ced1', fascia: '#7a1d2a', spacing: 5.5, colSize: 0.2 });
    for (let z = -60; z <= 62; z += 5.5) k.between(k.vc, [k.edge + 3.4, 3.9, z], [k.edge + 0.9, 4.25, z], 0.07, k.col('#7a1d2a'), 0.07);
    stairCanopy(k, { lat: k.edge + 3.0, z: -40, col: '#7a1d2a', w: 2.6, len: 5 });
    shelter(k, k.edge + 3.0, 70, 8, 2.2, '#7a1d2a', true);
    furnish(k, { totems: [30], voie: [['Voie 1', -50], ['Voie 1', 45]], benches: [-20, 10, 40], bins: [0] });
    otherPlatform(k, { width: 5, variant: 'grey', shelterAt: [24], shelterCol: '#7a1d2a' });
    yardTracks(k, [-12.9, -17.4, -21.9], k.zB - 40, k.zA + 40);
  }

  // Rodange: rebuilt station with long anthracite canopies on slender columns, pale striped-tactile slabs, footbridge with glass lifts and
  // dark-red fins; old cream station building with ochre stone window surrounds on the street side
  function buildRodange(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'slab');
    building(k, { lat0: BACK + 5, lat1: BACK + 13.5, z0: -62, z1: -22, floors: 2, floorH: 3.7, cfg: { wall: '#e9e0b0', trim: '#c9b27a', frame: '#e8e2cf', glass: '#3d3a38', arch: false, ww: 0.34, frameOuter: false, plinth: '#c8b88a', seed: 81, coursing: false }, trim: '#c9b27a', roof: { type: 'hip', h: 3.2, col: '#5e5148', chimney: [-52, -32] } });
    canopy(k, { lat0: BACK + 0.4, lat1: k.edge + 1.3, hIn: 5.3, hOut: 4.6, z0: -100, z1: 100, colLat: k.edge + 4.4, col: '#2b3035', roof: '#4b5157', fascia: '#22272b', spacing: 9, colSize: 0.18, lights: true });
    const op = otherPlatform(k, { width: 6, variant: 'slab', shelter: false });
    canopy(k, { lat0: op.e1 + 0.4, lat1: op.e0 - 1.0, hIn: 5.0, hOut: 4.5, z0: -90, z1: 90, colLat: (op.e0 + op.e1) / 2, col: '#2b3035', roof: '#4b5157', fascia: '#22272b', spacing: 9, colSize: 0.18 });
    yardTracks(k, [-13.9, -18.4, -22.9, -27.4], k.zB - 40, k.zA + 40);
    footBridge(k, { z: -40, latA: BACK + 2.5, latB: -17, yBot: 6.9, width: 3.4, deck: '#8d9296', tower: '#a9adb1', fins: '#7a2a2a', roof: '#6b7075' });
    furnish(k, { totems: [-10], voie: [['Voie 1', -70], ['Voie 1', 60]], benches: [-20, 25, 60], bins: [8], bikebox: [[BACK + 3.2, 20]] });
  }

  // Bartreng (Bertrange-Strassen): white flat-roofed modernist cubes with dark-red window frames, dark-red steel shelters, brick-paver platform,
  // concrete road bridge across the tracks, three platform tracks
  function buildBartreng(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'brick');
    const cfg = { wall: '#cfd0cf', trim: '#f4f4f0', frame: MAROON, glass: '#4f5c68', arch: false, ww: 0.5, wh: 0.46, frameOuter: true, seed: 91, plinth: '#c9c9c4' };
    building(k, { lat0: BACK + 2.6, lat1: BACK + 9.6, z0: -8, z1: 7, floors: 2, floorH: 3.1, cfg, roof: { type: 'pent', h: 1.0, col: '#6b727a' } });
    building(k, { lat0: BACK + 2.6, lat1: BACK + 7.4, z0: 7, z1: 16, floors: 1, floorH: 3.2, cfg, roof: { type: 'flat', col: '#80858a' } });
    shelter(k, k.edge + 3.2, -24, 10, 2.4, MAROON, true);
    shelter(k, k.edge + 3.2, 30, 8, 2.4, MAROON, true);
    furnish(k, { totems: [-6], voie: [['Voie 1', -40], ['Voie 1', 50]], benches: [14], bins: [-14] });
    otherPlatform(k, { width: 4.4, variant: 'brick', shelterAt: [-12], shelterCol: MAROON });
    yardTracks(k, [-12.9], k.zB - 40, k.zA + 40);
    overBridge(k, { z: -100, width: 13, latA: -11, latB: 13, yBot: 7.3, deck: '#9ca0a4', pier: '#a7abaf' });
  }

  // Mamer: grey-blue plaster two-storey building with white trim and dark-red window frames under a hipped slate roof, dark-red steel
  // shelters, brick platforms, glazed stair canopy to the underpass
  function buildMamer(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'brick');
    const cfg = { wall: '#919fae', trim: '#eceae4', frame: MAROON, glass: '#463b3f', arch: false, ww: 0.34, wh: 0.52, frameOuter: true, plinth: '#7d8998', seed: 101 };
    building(k, { lat0: BACK + 3.2, lat1: BACK + 11.6, z0: -6, z1: 20, floors: 2, floorH: 3.6, cfg, trim: '#eceae4', roof: { type: 'hip', h: 3.0, col: '#4a4f57', chimney: [2, 12] } });
    building(k, { lat0: BACK + 3.2, lat1: BACK + 8.2, z0: 20, z1: 28, floors: 1, floorH: 3.4, cfg, roof: { type: 'hip', h: 1.6, col: '#4a4f57' } });
    shelter(k, k.edge + 3.2, -30, 12, 2.4, MAROON, true);
    shelter(k, k.edge + 3.2, -70, 10, 2.4, MAROON, true);
    stairCanopy(k, { lat: k.edge + 3.0, z: -50, col: MAROON, w: 2.8, len: 5 });
    furnish(k, { totems: [-44], voie: [['Voie 1', -20], ['Voie 1', 40]], benches: [10, 30], bins: [-8], bikebox: [[BACK + 3.2, 50]] });
    otherPlatform(k, { width: 4.4, variant: 'brick', shelterAt: [-30], shelterCol: MAROON });
    voieBoard(k, 'Voie 2', -5.3, 10, k.H + 2.7);
  }

  // Capellen: small cream-yellow two-storey block with a shallow hipped roof, a low annex, dark-red open shelter, next to the level crossing
  function buildCapellen(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'grey');
    const cfg = { wall: '#efe4bd', trim: '#f0e9cc', frame: '#f0ead8', glass: '#4b4b4f', arch: true, ww: 0.3, wh: 0.46, plinth: '#c9bb87', seed: 111 };
    building(k, { lat0: BACK + 2.4, lat1: BACK + 9.4, z0: -5.5, z1: 4.5, floors: 2, floorH: 4.0, cfg, trim: '#dcd2a4', roof: { type: 'pent', h: 1.2, col: '#5b5048' } });
    building(k, { lat0: BACK + 2.4, lat1: BACK + 6.4, z0: -13, z1: -5, floors: 1, floorH: 3.0, cfg, roof: { type: 'pent', h: 0.6, col: '#5b5048' } });
    shelter(k, k.edge + 3.0, -26, 7, 2.2, '#7a2230', true);
    furnish(k, { totems: [3], voie: [['Voie 1', -36], ['Voie 1', 30]], benches: [12], bins: [-18], bikebox: [[BACK + 3.0, 22]] });
    otherPlatform(k, { width: 4.0, variant: 'grey', shelterAt: [-16], shelterCol: '#7a2230' });
  }

  // Kleinbettingen: modern long flat-roofed glazed waiting building with grey cladding and a red trim stripe, striped-tactile slabs, blue totems,
  // the grain silos behind, cream house with slate roof
  function buildKleinbettingen(api) {
    const k = kit(api);
    const BACK = k.edge + k.W;
    platformSurface(k, 'slab');
    building(k, { lat0: k.edge + 2.6, lat1: BACK + 0.3, z0: -22, z1: 4, floors: 1, floorH: 3.2, cfg: { wall: '#dfe2e3', trim: '#b4232b', frame: '#2c3136', glass: '#41505b', arch: false, ww: 0.86, wh: 0.58, floorH: 3.2, plinth: '#a4a8aa', seed: 121, band: '#b4232b' }, trim: '#b4232b', roof: { type: 'flat', col: '#8d9296' } });
    k.box(k.vc, k.edge + 2.6, 3.65, -9, 0.1, 0.45, 26, k.col('#b4232b'));
    building(k, { lat0: BACK + 4, lat1: BACK + 11, z0: 22, z1: 36, floors: 2, floorH: 3.3, cfg: { wall: '#e4dcc2', trim: '#f0ead8', frame: '#f0ead8', glass: '#46484c', ww: 0.36, plinth: '#c9bda0', seed: 131 }, roof: { type: 'gable', h: 3.2, col: '#50555c' } });
    // grain silos (corrugated silver) on a pale mill block
    const siloC = k.col('#bcc2c6');
    [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]].forEach(([i, j]) => {
      const lat = BACK + 17 + i * 5.2;
      const z = -16 + j * 5.2;
      k.frust(k.vc, lat, 9.4, z, 2.3, 2.3, 15, siloC, 14);
      k.frust(k.vc, lat, 24.4, z, 0.2, 2.3, 1.6, k.col('#8e959a'), 14);
    });
    k.box(k.vc, BACK + 22, 4.4, -12, 16, 9.9, 14, k.col('#e6dfc9'));
    k.box(k.vc, BACK + 22, 10.2, -12, 16.4, 0.5, 14.4, k.col('#6c7076'));
    furnish(k, { totems: [-26, 6], voie: [['Voie 1', -40], ['Voie 1', 40]], benches: [-30], bins: [-4] });
    otherPlatform(k, { width: 5, variant: 'slab', shelter: false });
    yardTracks(k, [-13.9, -18.4], k.zB - 40, k.zA + 40);
  }

  reg('Hollerich', { canopy: false, furniture: false, build: buildHollerich });
  reg('Berchem', { canopy: false, furniture: false, build: buildBerchem });
  reg('Bettembuerg', { canopy: false, furniture: false, build: buildBettembuerg });
  reg('Esch-Uelzecht', { canopy: false, furniture: false, build: buildEsch });
  reg('Belval-Université', { canopy: false, furniture: false, build: buildBelval });
  reg('Déifferdang', { canopy: false, furniture: false, build: buildDeifferdang });
  reg('Péiteng', { canopy: false, furniture: false, build: buildPeiteng });
  reg('Rodange', { canopy: false, furniture: false, build: buildRodange });
  reg('Bartreng', { canopy: false, furniture: false, build: buildBartreng });
  reg('Mamer', { canopy: false, furniture: false, build: buildMamer });
  reg('Capellen', { canopy: false, furniture: false, build: buildCapellen });
  reg('Kleinbettingen', { canopy: false, furniture: false, build: buildKleinbettingen });

  reg('Lëtzebuerg', { canopy: false, furniture: false, build: buildLetzebuerg });
})();
