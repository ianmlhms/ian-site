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
   * Two tracks with two side platforms of tan paver blocks and a concrete kerb with recessed panels; one low cream-plastered building (a single
   * storey, low gable roof of grey slate with a white fascia) at the platform, five maroon doors (WC, waiting room, T = telephone, ...) and one maroon
   * window with a light surround; a cantilever canopy of maroon steel with diagonal struts and translucent cream panels over most of the front,
   * round clock, maroon bench, yellow tube-framed name boards, pink ticket machine and blue CFL info totem, perforated white CFL bike box,
   * grey poles with loudspeakers. */
  reg('Munsbach', {
    canopy: false,
    furniture: false,
    build(api) {
      const k = makeKit(api);
      const { sx, H, W, edge, col, WHITE } = api;
      const { X, vc, quadO, tex, roof, glow } = k;
            const lB = edge + W;
      const BL = 17.3;                    // building length along the platform (real LOD2 footprint, z -90.7 .. -73.4)
      const BD = 6.5;                     // depth
      const EAVES = 3.75;
      const z0 = -90.7;
      const z1 = z0 + BL;
      const l0 = lB + 0.05;
      const l1 = l0 + BD;
      const wall = '#ece3c6';
      const maroon = '#7d1c2d';

      /* front facade (towards the track): plaster, plinth, doors, window */
      const doors = [{ u: 2.0, w: 0.95, kind: 'wc' }, { u: 4.7, w: 1.05, kind: 'wifi' }, { u: 7.3, w: 1.05, kind: 'T' }, { u: 10.1, w: 1.05, kind: 'plain' }];
      const front = tex('munfront', {
        w: Math.round(BL * PX), h: Math.round(EAVES * PX),
        draw: (c, w, h) => {
          plasterFill(c, w, h, wall, 41, true);
          c.fillStyle = '#9d9684'; c.fillRect(0, h - 0.55 * PX, w, 0.55 * PX);                       // plinth
          const doorTop = h - 0.55 * PX - 2.3 * PX;
          doors.forEach((d) => {
            const x = d.u * PX - (d.w * PX) / 2;
            c.fillStyle = '#cfc5a4'; c.fillRect(x - 0.18 * PX, doorTop - 0.12 * PX, d.w * PX + 0.36 * PX, 2.4 * PX);   // reveal
            c.fillStyle = maroon; c.fillRect(x, doorTop, d.w * PX, 2.3 * PX);
            c.fillStyle = 'rgba(150,172,184,0.9)'; c.fillRect(x + 0.12 * PX, doorTop + 0.15 * PX, d.w * PX - 0.24 * PX, 1.05 * PX);   // upper glass
            c.fillStyle = 'rgba(120,150,164,0.75)'; c.fillRect(x + 0.12 * PX, doorTop + 1.35 * PX, d.w * PX - 0.24 * PX, 0.7 * PX);
            c.fillStyle = '#c9c4b4'; c.fillRect(x + d.w * PX - 0.2 * PX, doorTop + 1.2 * PX, 0.05 * PX, 0.3 * PX);       // handle
            if (d.kind === 'T') { c.fillStyle = '#f2f0e8'; c.fillRect(x + 0.2 * PX, doorTop + 0.35 * PX, 0.6 * PX, 0.7 * PX); c.fillStyle = '#111'; c.font = 'bold ' + 0.6 * PX + 'px Arial'; c.textAlign = 'center'; c.fillText('T', x + 0.5 * PX, doorTop + 0.95 * PX); }
            if (d.kind === 'wifi') { c.fillStyle = '#1f55c4'; c.fillRect(x + 0.25 * PX, doorTop + 0.4 * PX, 0.55 * PX, 0.55 * PX); }
            if (d.kind === 'wc') { c.fillStyle = '#e6e2d4'; c.fillRect(x - 0.9 * PX, doorTop + 0.2 * PX, 0.5 * PX, 0.3 * PX); c.fillStyle = '#333'; c.font = 'bold ' + 0.22 * PX + 'px Arial'; c.fillText('WC', x - 0.65 * PX, doorTop + 0.43 * PX); }
          });
          // window at the right end: light stone surround, maroon casement
          const wx = 14.0 * PX; const wy = doorTop + 0.45 * PX; const ww = 1.25 * PX; const wh = 1.55 * PX;
          c.fillStyle = '#e6dec2'; c.fillRect(wx - 0.28 * PX, wy - 0.28 * PX, ww + 0.56 * PX, wh + 0.5 * PX);
          c.fillStyle = maroon; c.fillRect(wx, wy, ww, wh);
          c.fillStyle = 'rgba(140,166,180,0.9)'; c.fillRect(wx + 0.09 * PX, wy + 0.09 * PX, ww - 0.18 * PX, wh * 0.46); c.fillRect(wx + 0.09 * PX, wy + wh * 0.52, ww - 0.18 * PX, wh * 0.42);
          c.fillStyle = '#c8c0a2'; c.fillRect(wx - 0.3 * PX, wy + wh + 0.2 * PX, ww + 0.6 * PX, 0.1 * PX);                // sill
          // ventilation grille
          c.fillStyle = '#6b2430'; c.fillRect(16.4 * PX, doorTop + 1.2 * PX, 0.45 * PX, 0.3 * PX);
        },
      });
      const xf = X(l0);
      const yA = H - 0.3;
      const yTop = H + EAVES;
      const hint = [X(l0 + BD / 2), H + 1.5, (z0 + z1) / 2];
      // the front is read from the track: with the platform on the left of the travel direction (sx < 0) the texture runs the other way along z
      const uA = sx > 0 ? 0 : 1; const uB = 1 - uA;
      quadO(front, [xf, yA, z0], [xf, yA, z1], [xf, yTop, z1], [xf, yTop, z0], hint, WHITE, [[uA, 0.085], [uB, 0.085], [uB, 1], [uA, 1]]);
      const wallCol = col(wall);
      const xb = X(l1);
      quadO(vc, [xb, yA, z0], [xb, yA, z1], [xb, yTop, z1], [xb, yTop, z0], hint, wallCol);
      [z0, z1].forEach((z) => quadO(vc, [xf, yA, z], [xb, yA, z], [xb, yTop, z], [xf, yTop, z], hint, wallCol));
      vc.box(X(l0 + BD / 2), yTop - 0.05, (z0 + z1) / 2, BD + 0.3, 0.1, BL + 0.3, col('#cfc7aa'));
      /* low gable roof, ridge along the platform; white fascia */
      roof({ kind: 'gable', mat: 'slate', l0, l1, z0, z1, y: yTop + 0.05, rise: 2.4, ov: 0.45, gableCol: wall, ridgeCol: '#3b3e43' });
      vc.box(X(l0 - 0.5), yTop + 0.08, (z0 + z1) / 2, 0.08, 0.16, BL + 1.0, col('#f1efe8'));
      vc.box(X(l1 + 0.5), yTop + 0.08, (z0 + z1) / 2, 0.08, 0.16, BL + 1.0, col('#f1efe8'));
      /* the end gable of the right end: chimney-free; a small roof drain */
      vc.box(X(l0 + 0.15), yTop - 1.7, z0 + 0.7, 0.08, 3.4, 0.08, col('#8d9296'));
      vc.box(X(l0 + 0.15), yTop - 1.7, z0 + 11.2, 0.08, 3.4, 0.08, col('#8d9296'));

      /* cantilever canopy: maroon steel, diagonal struts, translucent cream panels (z0 + 0.4 .. z0 + 12.6) */
      const cz0 = z0 + 0.5; const cz1 = z0 + 12.2;
      const cOut = 3.0;                                  // projection over the platform
      const yWall = H + 3.45; const yOut = H + 2.95;
      const panel = tex('munpanel', { w: 64, h: 64, draw: (c, w, h) => { c.fillStyle = '#8d2437'; c.fillRect(0, 0, w, h); c.fillStyle = '#f3efdc'; c.fillRect(3, 3, w - 6, h - 6); c.fillStyle = 'rgba(200,196,170,0.5)'; c.fillRect(3, h / 2, w - 6, 2); } });
      const ch = [X(l0 - cOut / 2), yWall, (cz0 + cz1) / 2];
      const panesZ = (cz1 - cz0) / 1.55; const panesL = cOut / 0.85;
      quadO(panel, [X(l0), yWall, cz0], [X(l0), yWall, cz1], [X(l0 - cOut), yOut, cz1], [X(l0 - cOut), yOut, cz0], [ch[0], ch[1] - 5, ch[2]], WHITE, [[0, 0], [panesZ, 0], [panesZ, panesL], [0, panesL]]);
      quadO(panel, [X(l0), yWall - 0.04, cz0], [X(l0), yWall - 0.04, cz1], [X(l0 - cOut), yOut - 0.04, cz1], [X(l0 - cOut), yOut - 0.04, cz0], [ch[0], ch[1] + 5, ch[2]], WHITE, [[0, 0], [panesZ, 0], [panesZ, panesL], [0, panesL]]);
      const mr = col(maroon);
      vc.box(X(l0 - cOut), yOut + 0.02, (cz0 + cz1) / 2, 0.12, 0.16, cz1 - cz0 + 0.1, mr);        // edge beam
      vc.box(X(l0 - 0.05), yWall + 0.02, (cz0 + cz1) / 2, 0.12, 0.16, cz1 - cz0 + 0.1, mr);       // wall plate
      for (let z = cz0; z <= cz1 + 0.01; z += 1.55) {
        vc.between([X(l0 - 0.05), yWall, z], [X(l0 - cOut), yOut, z], 0.07, mr, 0.1);              // rafter
        vc.between([X(l0 - 0.05), yWall - 1.15, z], [X(l0 - cOut + 0.15), yOut - 0.1, z], 0.06, mr, 0.08);   // strut from the wall
      }
      for (let z = cz0 + 0.4; z < cz1; z += 0.78) vc.between([X(l0 - 0.05), yWall + 0.03, z], [X(l0 - cOut), yOut + 0.03, z], 0.035, mr, 0.04);   // glazing bars
      for (let l = 0.6; l < cOut; l += 0.75) vc.box(X(l0 - l), yWall - (yWall - yOut) * (l / cOut) + 0.07, (cz0 + cz1) / 2, 0.05, 0.05, cz1 - cz0, mr);   // purlins
      [cz0, cz1].forEach((z) => vc.box(X(l0 - 0.1), (H + yWall) / 2, z, 0.18, yWall - H, 0.18, mr));      // end posts at the wall
      k.clockFace(l0 - 0.04, H + 3.05, z0 + 8.6, 0.62, -1);

      /* platform furniture (the platform is 3.2 m wide: everything stands between the kerb and the building) */
      k.bench(lB - 0.8, z0 + 1.2, '#7d1f26');
      k.yellowBoard(lB - 1.0, z0 - 24, 'Munsbach');
      k.yellowBoard(lB - 1.0, z1 + 38, 'Munsbach');
      [z0 - 12, z0 + 14, z1 + 12, z1 + 44].forEach((z) => k.totem(edge + 1.0, z));
      // pink ticket machine beside the left name board
      vc.box(X(lB - 1.0), H + 1.0, z0 - 19, 0.5, 2.0, 0.6, col('#b02a6e'));
      vc.box(X(lB - 1.0) - sx * 0.27, H + 1.3, z0 - 19, 0.04, 0.7, 0.45, col('#e8e8ec'));
      [z0 - 44, z0 - 8, z1 + 6, z1 + 30, z1 + 58].forEach((z) => k.lamp(lB - 0.5, z, '#9aa0a4', 5.4));
      [z0 - 6, z1 + 8].forEach((z) => k.bin(lB - 0.5, z, '#d9631a'));
      vc.box(X(lB - 0.5), H + 0.6, z0 + 14, 0.32, 1.2, 0.3, col('#c9ccce'));                      // telephone box PK 15,326
      glow.box(X(lB - 0.5) - sx * 0.17, H + 0.8, z0 + 14, 0.03, 0.3, 0.2, col('#f6f4ea'));
      // perforated white CFL bike box beside the end of the building
      k.bikebox(l1 - 2.2, z1 + 3.4);
      vc.box(X(l1 - 2.2) - sx * 1.22, H + 1.9, z1 + 3.4, 0.05, 0.5, 1.8, col('#2a2d30'));
      // the opposite side platform (real: edge 5.2 m from the main track, 3.2 m wide), yellow name board, "A" letter sign
      k.platformBox(-6.2, 3.2, -1, -95, 95);
      k.yellowBoard(-7.5, z0 + 6, 'Munsbach');
      k.sign(-7.2, z0 + 40, 'A', 'blue');
      [z0 - 20, z0 + 20, z1 + 36].forEach((z) => k.totem(-7.4, z));
      [z0 - 44, z0 - 8, z0 + 30, z1 + 30].forEach((z) => k.lamp(-8.4, z, '#9aa0a4', 5.4));
      k.bench(-8.6, z0 + 14, '#7d1f26');
      k.bin(-8.8, z0 + 24, '#d9631a');
    },
  });
})();
