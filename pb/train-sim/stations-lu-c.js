/* Zuchsimulator Lëtzebuerg: photo-modelled stations of the Mosel line (lu-c). Registers into TS.realStations (stations-real.js), built with the kit of
 * stations-lu-b.js (TS.stationKits.luB).  Stations: Munsbach.
 * Local frame as in lu-b: l = lateral distance from the track centre towards the platform side (negative = far side), z = along the platform (the
 * train drives towards -z), y up (platform top = H). */
(function () {
  'use strict';
  if (!window.TS || !window.TS.realStations || !window.TS.stationKits || !window.TS.stationKits.luB) return;
  const reg = window.TS.realStations.register;
  const makeKit = window.TS.stationKits.luB;

  const PX = 48;                         // texture density of the building front (px per metre)
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
  function plasterFill(c, w, h, base, seed, stain) {
    const r = mulb(seed);
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 90; i++) { c.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,60,40,0.06)'; c.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
    if (stain) for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(80,70,50,' + (0.03 + r() * 0.05) + ')'; c.fillRect(r() * w, r() * h * 0.8, 6 + r() * 30, 20 + r() * 50); }
  }

  /* ================================================================ MUNSBACH
   * Refs: ~/Library/Caches/zuch-refs/Munsbach (Commons: Schuttrange, gare CFL Munsbach (101)-(106), Gare Munsbach 01, Munsbach railway station,
   * Mënsbechgare12/14).
   * Two tracks with two side platforms (munsbach-platform.js: panelled concrete kerb, pavers, yellow line).  One low cream-plastered building of two
   * volumes under slate gable roofs with white fascias: the WC / door block (WC, waiting room with the blue Wi-Fi sticker, T = telephone, a plain door;
   * lower eaves, cantilever canopy of maroon steel with diagonal struts and translucent cream panels) and the taller office block on the north end
   * (higher eaves and ridge, one maroon window with a light stone surround; the back wall has four such windows).  Round clock, maroon bench, yellow
   * tube-framed name boards, pink ticket machine and blue CFL info totem, perforated white CFL bike box, grey poles with loudspeakers.
   * Orientation (physical): the WC end is the south (Luxembourg) end, the taller block is on the north end; u = metres from the WC end. */
  const BL = 17.3;                    // building length along the platform (real LOD2 footprint)
  const BD = 6.5;                     // depth
  const UL = 10.7;                    // length of the WC / door block (u 0 .. UL); the taller block is u UL .. BL
  const EL = 3.5, ER = 4.45;          // eaves heights above the platform
  const RL = 1.95, RR = 2.3;          // roof rises
  const DOORS = [{ u: 2.0, w: 0.95, kind: 'wc' }, { u: 4.7, w: 1.05, kind: 'wifi' }, { u: 7.3, w: 1.05, kind: 'T' }, { u: 10.1, w: 1.05, kind: 'plain' }];
  const WALL = '#ece3c6';
  const MAROON = '#7d1c2d';

  function windowPane(c, x, y, ww, wh) {
    c.fillStyle = '#e6dec2'; c.fillRect(x - 0.28 * PX, y - 0.28 * PX, ww + 0.56 * PX, wh + 0.5 * PX);          // light stone surround
    c.fillStyle = MAROON; c.fillRect(x, y, ww, wh);
    c.fillStyle = 'rgba(140,166,180,0.9)'; c.fillRect(x + 0.09 * PX, y + 0.09 * PX, ww - 0.18 * PX, wh * 0.46); c.fillRect(x + 0.09 * PX, y + wh * 0.52, ww - 0.18 * PX, wh * 0.42);
    c.fillStyle = '#c8c0a2'; c.fillRect(x - 0.3 * PX, y + wh + 0.2 * PX, ww + 0.6 * PX, 0.1 * PX);               // sill
  }

  reg('Munsbach', {
    canopy: false,
    furniture: false,
    ownPlatform: true,          // infra.js leaves the slab / kerb / paving to this model (munsbach-platform.js)
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, WHITE, zA, zB } = api;
      const { X, vc, quadO, tex, roof, glow } = k;
      const lB = edge + W;
      if (window.TS.munsbachPlatform) window.TS.munsbachPlatform.build(api, k, { lEdge: edge, w: W, dir: 1, z0: zB, z1: zA });
      const z0 = -90.7;                   // real LOD2 footprint z -90.7 .. -73.4
      const z1 = z0 + BL;
      const l0 = lB + 0.05;
      const l1 = l0 + BD;
      const yA = H - 0.3;
      const zU = (u) => (sx > 0 ? z0 + u : z1 - u);             // position along the platform of the point u m from the WC end (the physical orientation is fixed, the frame flips)
      const uOf = (z) => (sx > 0 ? z - z0 : z1 - z);
      const span = (ua, ub) => { const a = zU(ua); const b = zU(ub); return a < b ? [a, b] : [b, a]; };
      const blocks = [{ u0: 0, u1: UL, eaves: EL, rise: RL }, { u0: UL, u1: BL, eaves: ER, rise: RR }].map((b) => Object.assign({ z: span(b.u0, b.u1), yTop: H + b.eaves }, b));
      const texH = ER + 0.3;                                    // facade textures start at the plinth (yA) and reach the highest eaves

      /* front facade (towards the track): plaster, plinth, doors, window */
      const front = tex('munfront2', {
        w: Math.round(BL * PX), h: Math.round(texH * PX),
        draw: (c, w, h) => {
          plasterFill(c, w, h, WALL, 41, true);
          const base = h - 0.3 * PX;                              // platform level
          c.fillStyle = '#9d9684'; c.fillRect(0, h - 0.55 * PX, w, 0.55 * PX);                       // plinth
          const doorTop = base - 2.3 * PX;
          DOORS.forEach((d) => {
            const x = d.u * PX - (d.w * PX) / 2;
            c.fillStyle = '#cfc5a4'; c.fillRect(x - 0.18 * PX, doorTop - 0.12 * PX, d.w * PX + 0.36 * PX, 2.4 * PX);   // reveal
            c.fillStyle = MAROON; c.fillRect(x, doorTop, d.w * PX, 2.3 * PX);
            c.fillStyle = 'rgba(150,172,184,0.9)'; c.fillRect(x + 0.12 * PX, doorTop + 0.15 * PX, d.w * PX - 0.24 * PX, 1.05 * PX);   // upper glass
            c.fillStyle = 'rgba(120,150,164,0.75)'; c.fillRect(x + 0.12 * PX, doorTop + 1.35 * PX, d.w * PX - 0.24 * PX, 0.7 * PX);
            c.fillStyle = '#c9c4b4'; c.fillRect(x + d.w * PX - 0.2 * PX, doorTop + 1.2 * PX, 0.05 * PX, 0.3 * PX);       // handle
            if (d.kind === 'T') { c.fillStyle = '#f2f0e8'; c.fillRect(x + 0.2 * PX, doorTop + 0.35 * PX, 0.6 * PX, 0.7 * PX); c.fillStyle = '#111'; c.font = 'bold ' + 0.6 * PX + 'px Arial'; c.textAlign = 'center'; c.fillText('T', x + 0.5 * PX, doorTop + 0.95 * PX); }
            if (d.kind === 'wifi') { c.fillStyle = '#1f55c4'; c.fillRect(x + 0.25 * PX, doorTop + 0.4 * PX, 0.55 * PX, 0.55 * PX); }
            if (d.kind === 'wc') { c.fillStyle = '#e6e2d4'; c.fillRect(x - 0.9 * PX, doorTop + 0.2 * PX, 0.5 * PX, 0.3 * PX); c.fillStyle = '#333'; c.font = 'bold ' + 0.22 * PX + 'px Arial'; c.fillText('WC', x - 0.65 * PX, doorTop + 0.43 * PX); }
          });
          windowPane(c, 14.0 * PX, base - 2.55 * PX, 1.25 * PX, 1.55 * PX);                           // the window of the taller block
          c.fillStyle = '#6b2430'; c.fillRect(16.4 * PX, base - 1.4 * PX, 0.45 * PX, 0.3 * PX);       // ventilation grille
          c.fillStyle = 'rgba(70,60,45,0.12)'; c.fillRect(UL * PX - 3, 0, 6, h);                       // the joint between the two volumes
        },
      });
      /* back (forecourt side): four maroon windows with stone surrounds along the long wall */
      const back = tex('munback', {
        w: Math.round(BL * PX), h: Math.round(texH * PX),
        draw: (c, w, h) => {
          plasterFill(c, w, h, WALL, 53, true);
          const base = h - 0.3 * PX;
          c.fillStyle = '#9d9684'; c.fillRect(0, h - 0.55 * PX, w, 0.55 * PX);
          [1.9, 5.4, 8.9, 14.0].forEach((u) => windowPane(c, u * PX - 0.6 * PX, base - 2.45 * PX, 1.2 * PX, 1.55 * PX));
          c.fillStyle = 'rgba(70,60,45,0.12)'; c.fillRect(UL * PX - 3, 0, 6, h);
        },
      });
      const endWin = tex('munend', {
        w: Math.round(BD * PX), h: Math.round(texH * PX),
        draw: (c, w, h) => {
          plasterFill(c, w, h, WALL, 67, true);
          c.fillStyle = '#9d9684'; c.fillRect(0, h - 0.55 * PX, w, 0.55 * PX);
          windowPane(c, w / 2 - 0.6 * PX, h - 0.3 * PX - 2.45 * PX, 1.2 * PX, 1.55 * PX);
        },
      });
      const plain = tex('munplain', { w: 64, h: 64, draw: (c, w, h) => plasterFill(c, w, h, WALL, 71, false) });
      const hint = [X(l0 + BD / 2), H + 1.5, (z0 + z1) / 2];
      const xf = X(l0); const xb = X(l1);
      const vOf = (y) => (y - yA) / texH;
      blocks.forEach((b) => {
        const [za, zb] = b.z;
        const uA = (z) => uOf(z) / BL;
        quadO(front, [xf, yA, za], [xf, yA, zb], [xf, b.yTop, zb], [xf, b.yTop, za], hint, WHITE, [[uA(za), 0], [uA(zb), 0], [uA(zb), vOf(b.yTop)], [uA(za), vOf(b.yTop)]]);
        quadO(back, [xb, yA, za], [xb, yA, zb], [xb, b.yTop, zb], [xb, b.yTop, za], hint, WHITE, [[uA(za), 0], [uA(zb), 0], [uA(zb), vOf(b.yTop)], [uA(za), vOf(b.yTop)]]);
      });
      // end walls: the WC end is plain, the tall end has a window; the partition wall between the volumes rises above the lower roof
      const wcEndZ = zU(0); const tallEndZ = zU(BL); const joinZ = zU(UL);
      const wallCol = col(WALL);
      quadO(plain, [xf, yA, wcEndZ], [xb, yA, wcEndZ], [xb, H + EL, wcEndZ], [xf, H + EL, wcEndZ], hint, WHITE, [[0, 0], [BD / 4, 0], [BD / 4, EL / 4], [0, EL / 4]]);
      quadO(endWin, [xf, yA, tallEndZ], [xb, yA, tallEndZ], [xb, H + ER, tallEndZ], [xf, H + ER, tallEndZ], hint, WHITE, [[0, 0], [1, 0], [1, vOf(H + ER)], [0, vOf(H + ER)]]);
      quadO(vc, [xf, yA, joinZ], [xb, yA, joinZ], [xb, H + ER, joinZ], [xf, H + ER, joinZ], hint, wallCol);
      // roofs: two gables with white fascias; the taller block's gable shows above the lower roof
      blocks.forEach((b) => {
        const [za, zb] = b.z;
        roof({ kind: 'gable', mat: 'slate', l0, l1, z0: za, z1: zb, y: b.yTop + 0.05, rise: b.rise, ov: b === blocks[0] ? 0.3 : 0.45, gableCol: WALL, ridgeCol: '#3b3e43' });
        vc.box(X(l0 - 0.3), b.yTop + 0.1, (za + zb) / 2, 0.08, 0.18, zb - za + 0.6, col('#f1efe8'));
        vc.box(X(l1 + 0.3), b.yTop + 0.1, (za + zb) / 2, 0.08, 0.18, zb - za + 0.6, col('#f1efe8'));
        vc.box(X((l0 + l1) / 2), b.yTop - 0.05, (za + zb) / 2, BD + 0.3, 0.1, zb - za + 0.3, col('#cfc7aa'));   // soffit
      });
      // grey downpipes: one at the joint between the volumes, one at the WC end
      [zU(UL - 0.35), zU(0.5)].forEach((z) => vc.box(X(l0 + 0.12), H + (EL - 0.1) / 2, z, 0.1, EL - 0.1, 0.1, col('#8d9296')));

      /* cantilever canopy over the four doors: maroon steel, diagonal struts, translucent cream panels (lit from above, glowing from below) */
      const [cz0, cz1] = span(0.3, UL + 0.2);
      const cOut = 3.0;                                  // projection over the platform
      const yWall = H + 3.2; const yOut = H + 2.7;
      const panelTex = api.helpers.canvasTex('mun:panel2', 128, 128, (c, w, h) => {
        c.fillStyle = '#8d2437'; c.fillRect(0, 0, w, h); c.fillStyle = '#f3efdc'; c.fillRect(5, 5, w - 10, h - 10);
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,240,0)'); g.addColorStop(1, 'rgba(190,184,150,0.35)'); c.fillStyle = g; c.fillRect(5, 5, w - 10, h - 10);
        c.fillStyle = 'rgba(120,112,90,0.35)'; for (let i = 0; i < 90; i++) c.fillRect(8 + ((i * 53) % (w - 16)), 8 + ((i * 37) % (h - 16)), 2, 2);
      });
      const panelMat = () => api.mat('mun:panelmat', () => new api.T.MeshStandardMaterial({ map: panelTex, vertexColors: true, emissive: new api.T.Color(0xfff3d0), emissiveMap: panelTex, emissiveIntensity: 0.42, roughness: 0.7, side: api.T.DoubleSide }));
      const panel = api.sets.get('mun:panel', panelMat, true);
      const panesZ = (cz1 - cz0) / 1.55; const panesL = cOut / 0.85;
      const uvP = [[0, 0], [panesZ, 0], [panesZ, panesL], [0, panesL]];
      const ch = [X(l0 - cOut / 2), yWall, (cz0 + cz1) / 2];
      // top face (normal up) and underside (normal down): quadO turns a face away from the hint point
      quadO(panel, [X(l0), yWall, cz0], [X(l0), yWall, cz1], [X(l0 - cOut), yOut, cz1], [X(l0 - cOut), yOut, cz0], [ch[0], ch[1] - 5, ch[2]], WHITE, uvP);
      quadO(panel, [X(l0), yWall - 0.05, cz0], [X(l0), yWall - 0.05, cz1], [X(l0 - cOut), yOut - 0.05, cz1], [X(l0 - cOut), yOut - 0.05, cz0], [ch[0], ch[1] + 5, ch[2]], WHITE, uvP);
      const mr = col(MAROON);
      vc.box(X(l0 - cOut), yOut + 0.02, (cz0 + cz1) / 2, 0.12, 0.16, cz1 - cz0 + 0.1, mr);        // edge beam
      vc.box(X(l0 - 0.05), yWall + 0.02, (cz0 + cz1) / 2, 0.12, 0.16, cz1 - cz0 + 0.1, mr);       // wall plate
      for (let z = cz0; z <= cz1 + 0.01; z += 1.55) {
        vc.between([X(l0 - 0.05), yWall, z], [X(l0 - cOut), yOut, z], 0.07, mr, 0.1);              // rafter
        vc.between([X(l0 - 0.05), yWall - 1.15, z], [X(l0 - cOut + 0.15), yOut - 0.1, z], 0.06, mr, 0.08);   // strut from the wall
      }
      for (let z = cz0 + 0.4; z < cz1; z += 0.78) vc.between([X(l0 - 0.05), yWall + 0.03, z], [X(l0 - cOut), yOut + 0.03, z], 0.035, mr, 0.04);   // glazing bars
      for (let l = 0.6; l < cOut; l += 0.75) vc.box(X(l0 - l), yWall - (yWall - yOut) * (l / cOut) + 0.07, (cz0 + cz1) / 2, 0.05, 0.05, cz1 - cz0, mr);   // purlins
      [cz0, cz1].forEach((z) => vc.box(X(l0 - 0.1), (H + yWall) / 2, z, 0.18, yWall - H, 0.18, mr));      // end posts at the wall
      k.clockFace(l0 - 0.04, H + 3.0, zU(8.6), 0.62, -1);

      /* platform furniture (the platform is 3.2 m wide: everything stands between the kerb and the building) */
      k.bench(lB - 0.8, zU(3.4), '#7d1f26');
      k.yellowBoard(lB - 1.0, z0 - 24, 'Munsbach');
      k.yellowBoard(lB - 1.0, z1 + 38, 'Munsbach');
      [z0 - 12, z0 + 14, z1 + 12, z1 + 44].forEach((z) => k.totem(edge + 1.0, z));
      // pink ticket machine beside the left name board
      vc.box(X(lB - 1.0), H + 1.0, z0 - 19, 0.5, 2.0, 0.6, col('#b02a6e'));
      vc.box(X(lB - 1.0) - sx * 0.27, H + 1.3, z0 - 19, 0.04, 0.7, 0.45, col('#e8e8ec'));
      [z0 - 44, z0 - 8, z1 + 6, z1 + 30, z1 + 58].forEach((z) => k.lamp(lB - 0.5, z, '#9aa0a4', 5.4));
      [z0 - 6, z1 + 8].forEach((z) => k.bin(lB - 0.5, z, '#d9631a'));
      // perforated white CFL bike box beside the end of the building
      k.bikebox(l1 - 2.2, z1 + 3.4);
      vc.box(X(l1 - 2.2) - sx * 1.22, H + 1.9, z1 + 3.4, 0.05, 0.5, 1.8, col('#2a2d30'));
      // the opposite side platform (real: edge 5.2 m from the main track, 3.2 m wide) with the same kerb and paving, the yellow name board, the T box (PK 15,326) and the "A" letter sign
      if (window.TS.munsbachPlatform) window.TS.munsbachPlatform.build(api, k, { lEdge: -6.2, w: 3.2, dir: -1, z0: -95, z1: 95 }); else k.platformBox(-6.2, 3.2, -1, -95, 95);
      k.yellowBoard(-7.5, z0 + 6, 'Munsbach');
      vc.box(X(-8.2), H + 0.6, z0 + 2.4, 0.5, 0.9, 0.5, col('#c9ccce'));                          // the grey telephone box with the black T
      vc.box(X(-8.2) + sx * 0.26, H + 0.78, z0 + 2.4, 0.03, 0.55, 0.4, col('#f1f0ea'));
      k.sign(-7.2, z0 + 40, 'A', 'blue');
      [z0 - 20, z0 + 20, z1 + 36].forEach((z) => k.totem(-7.4, z));
      [z0 - 44, z0 - 8, z0 + 30, z1 + 30].forEach((z) => k.lamp(-8.4, z, '#9aa0a4', 5.4));
      k.bench(-8.6, z0 + 14, '#7d1f26');
      k.bin(-8.8, z0 + 24, '#d9631a');
      void glow;
    },
  });
})();
