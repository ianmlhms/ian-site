/* Kart Lëtzebuerg — track: Kirchberg (miniature, 0.65 scale). Avenue John F. Kennedy with its tram line, the Philharmonie's white columns, the Mudam and
 * Fort Thüngen, the red Pont Grande-Duchesse Charlotte over the Pfaffenthal valley, the golden Cour de Justice towers, Coque and Luxexpo.
 * Layout loosely after OpenStreetMap (contributors, ODbL), scaled by 0.65 about 49.62 N / 6.145 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, L = KL.lm;
  const BOX = [-900, -320, 220, 470];
  const terrain = KL.kit.valleyTerrain('kirchberg', { box: BOX, depth: 62, a: 22, b: 100, cell: 5 });
  const PARK = [[-545, 170], [-430, 182], [-340, 208], [-262, 236], [-205, 285], [-230, 330], [-340, 335], [-470, 305], [-560, 240]];
  const ROUND = []; for (let i = 0; i < 20; i++) ROUND.push([-805 + Math.cos(i / 20 * 6.283) * 30, 183 + Math.sin(i / 20 * 6.283) * 28]);
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };

  /* face with a guaranteed outward orientation */
  function Q(B, p0, p1, p2, p3, c, h) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * h[0] + cy * h[1] + cz * h[2] >= 0) B.quad(p0, p1, p2, p3, c); else B.quad(p0, p3, p2, p1, c);
  }

  KL.registerTrack({
    id: 'kirchberg', origin: [49.62, 6.145],
    theme: {
      facade: 'old', modernKinds: true, modernFacade: 'glass', modernBox: [-540, 420, -320, 420], cityFloorsOld: [3, 4], ground: 'slabs', groundTint: '#ffffff', groundCell: 12, farColor: '#8c97a3', farDrop: -64, skyline: false, lampSpacing: 28, lampBothSides: true,
      startText: 'KIRCHBERG', wallColor: '#c6c9ce', wallTop: '#e3e5e8', vergeColor: '#c5c6c8', wallH: 1.1,
      osm: 'kirchberg', cityRadius: 560, cityFloors: [5, 11], maxFloors: 19, flatRoofs: true, cityFollow: true, cityMaxSlope: 14, boulevardTrees: 16,
      palette: ['#f1e6d0', '#e6d3b0', '#ece0c8', '#d9c3a0', '#e8cfc0', '#d7d2c4'],
      paletteM: ['#e6e9ed', '#d8dfe7', '#c4d0dc', '#eef0f2', '#b8c6d4'],
      roofs: ['#8a9098', '#767c85', '#9aa0a8'],
      groundMap: { x0: -960, z0: -460, size: 1300, paving: '#b8b9b8', tramBed: '#aaa79d', water: '#4f90b8',
        paint: KL.kit.valleyPaint(terrain, 'kirchberg', { box: [-900, -320, 220, 470], depth: 62, rock: '#a69f90', grass: '#69a24c', grass2: '#86b95e', edge: '#b9b8b2', lawns: [PARK, ROUND] }) },
      weathers: ['day', 'sunset', 'night', 'rain'],
    },
    terrain,
    noBuild: [[-119, 113, 52], [-205, 252, 38], [-262, 262, 14], [150, -40, 60], [260, -70, 60]],
    pads: [[60, 0, 10], [200, 0, 10], [392, 13, 9], [438, 14, 9], [700, 0, 10], [980, 0, 10], [1150, 13, 9], [1198, 14, 9], [1245, 13, 9], [1500, 0, 10]],
    extraBoxes: [[415, 14], [1198, 15]],
    decorate(S) {
      const { add, mats, track, rnd, renderer, group } = S, M = mats, N = track.N, st = track.stations;
      const B = new KL.Batch(), E = new KL.Batch(), W = new KL.Batch();
      const red = col('#8d2a2f'), redD = col('#6c1f25'), redL = col('#a8383c'), white = col('#f3f3f0'), stone = col('#e4e0d6'), glass = col('#2a3d52'), steel = col('#5b6068');

      /* ---- Pont Grande-Duchesse Charlotte: red steel box girder under both decks, V-shaped struts down the valley slopes ---- */
      const decks = [];
      for (const [wa, wb] of [[13, 16], [20, 22]]) {      // south deck (westbound), north deck (eastbound): waypoint ranges
        let i0 = -1, i1 = -1;
        for (let i = Math.floor(st[wa] / track.step); i < N; i++) { if (i * track.step > st[wb] + 80) break; const x = track.X[i]; if (x > -738 && x < -503) { if (i0 < 0) i0 = i; i1 = i; } }
        decks.push([i0, i1]);
      }
      for (const [i0, i1] of decks) {
        const yb = -3.9;
        for (let i = i0; i < i1; i++) {
          const a = i % N, b = (i + 1) % N, la = track.HW[a] + track.WL[a] + 0.5, lb = track.HW[b] + track.WL[b] + 0.5;
          const P = (j, d, y) => [track.X[j] + -track.TZ[j] * d, y, track.Z[j] + track.TX[j] * d];
          const stripe = i % 2 ? red : redL;
          Q(B, P(a, -la, yb), P(b, -lb, yb), P(b, lb, yb), P(a, la, yb), redD, [0, -1, 0]);                       // soffit
          Q(B, P(a, la, yb), P(b, lb, yb), P(b, lb, -0.25), P(a, la, -0.25), stripe, [-track.TZ[a], 0, track.TX[a]]);    // right fascia
          Q(B, P(a, -la, yb), P(b, -lb, yb), P(b, -lb, -0.25), P(a, -la, -0.25), stripe, [track.TZ[a], 0, -track.TX[a]]); // left fascia
          Q(B, P(a, la + 0.02, -0.3), P(b, lb + 0.02, -0.3), P(b, lb + 0.02, -0.12), P(a, la + 0.02, -0.12), white, [-track.TZ[a], 0, track.TX[a]]);   // pale edge band
          Q(B, P(a, -la - 0.02, -0.3), P(b, -lb - 0.02, -0.3), P(b, -lb - 0.02, -0.12), P(a, -la - 0.02, -0.12), white, [track.TZ[a], 0, -track.TX[a]]);
        }
        // V struts: two piers per deck where the valley is ~35 m deep
        const piers = [];
        for (let i = i0; i <= i1; i++) if (terrain(track.X[i], track.Z[i]) < -34) { piers.push(i); break; }
        for (let i = i1; i >= i0; i--) if (terrain(track.X[i], track.Z[i]) < -34) { piers.push(i); break; }
        for (const pi of piers) {
          const tx = track.TX[pi], tz = track.TZ[pi], rx = -tz, rz = tx;
          for (const dd of [-5.2, 5.2]) {
            const ax = track.X[pi] + rx * dd, az = track.Z[pi] + rz * dd;
            for (const sg of [-1, 1]) {
              const fx = ax + tx * sg * 15, fz = az + tz * sg * 15, fy = terrain(fx, fz) - 1.2;
              L.bar(B, [ax, yb + 0.4, az], [fx, fy, fz], 3.3, red);
              B.box(fx, fy - 1.2, fz, 6, 2.4, 6, Math.atan2(tx, tz), stone);
            }
          }
          const ex = track.X[pi], ez = track.Z[pi], lim = track.HW[pi] + track.WL[pi] + 0.5;
          B.box(ex, yb - 0.9, ez, lim * 2, 1.3, 3.2, Math.atan2(track.TX[pi], track.TZ[pi]) + Math.PI / 2, redD);
        }
      }

      /* ---- tram line along the avenue (south of the north carriageway): bed, rails, catenary, two trams ---- */
      {
        const R = new KL.Batch(), sA = st[21], sB = track.length + st[3] - 20, step = 3;
        const tp = (s, d, out) => track.at(((s % track.length) + track.length) % track.length, d, out);
        const bed = col('#b6b0a3'), rail = col('#4c5058');
        for (const d0 of [15.3, 19.8]) {
          for (let s = sA; s < sB; s += step) {
            const a = tp(s, d0), b = tp(s + step, d0), na = [-a.tz, a.tx], nb = [-b.tz, b.tx];
            const Pt = (p, n, o) => [p.x + n[0] * o, p.y + 0.05, p.z + n[1] * o];
            R.quad(Pt(a, na, -2.1), Pt(b, nb, -2.1), Pt(b, nb, 2.1), Pt(a, na, 2.1), bed);
            for (const o of [-0.72, 0.72]) R.quad(Pt(a, na, o - 0.1), Pt(b, nb, o - 0.1), Pt(b, nb, o + 0.1), Pt(a, na, o + 0.1), rail);
          }
        }
        // catenary poles between the two tracks and the wire
        const tops = [];
        for (let s = sA + 10; s < sB; s += 26) { const p = tp(s, 17.55), pole = [p.x, p.y, p.z]; B.cyl(p.x, p.y, p.z, 0.16, 0.12, 7, 5, steel); tops.push([p.x, p.y + 6.6, p.z]); L.bar(B, [p.x, p.y + 6.6, p.z], [p.x - p.tz * 2.5, p.y + 6.9, p.z + p.tx * 2.5], 0.1, steel); L.bar(B, [p.x, p.y + 6.6, p.z], [p.x + p.tz * 2.5, p.y + 6.9, p.z - p.tx * 2.5], 0.1, steel); }
        for (let i = 0; i + 1 < tops.length; i++) for (const o of [-1, 1]) { const a = tops[i], b = tops[i + 1]; L.bar(B, [a[0] - (a[2] - b[2]) * 0 + 0, a[1] + 0.3, a[2]], [b[0], b[1] + 0.3, b[2]], 0.05, col('#2c2f35')); break; }
        add(R, M.plain);
        // trams: three-car sets that shuttle along the avenue
        const car = new KL.Batch(), silver = col('#d8dce2'), band = col('#1c2a3a'), accent = col('#7b3fa0');
        car.box(0, 0.7, 0, 2.6, 3.0, 8.4, 0, silver, { topCol: col('#f0f2f5') });
        car.box(1.31, 1.6, 0, 0.1, 1.2, 8.0, 0, band); car.box(-1.31, 1.6, 0, 0.1, 1.2, 8.0, 0, band);
        car.box(1.32, 0.9, 0, 0.1, 0.35, 8.2, 0, accent); car.box(-1.32, 0.9, 0, 0.1, 0.35, 8.2, 0, accent);
        car.box(0, 3.7, 0, 1.6, 0.25, 1.6, 0, steel);
        const geo = car.toGeometry(), trams = [];
        for (let k = 0; k < 2; k++) {
          const meshes = []; for (let c = 0; c < 3; c++) { const m = new T.Mesh(geo, M.plain); m.matrixAutoUpdate = true; group.add(m); meshes.push(m); }
          trams.push({ meshes, d: k ? 19.8 : 15.3, dir: k ? -1 : 1, s: sA + (k ? (sB - sA) * 0.7 : (sB - sA) * 0.2), v: 9 });
        }
        const o = {};
        renderer.animators.push((dt) => {
          for (const tr of trams) {
            tr.s += tr.dir * tr.v * dt; if (tr.s > sB - 30) tr.dir = -1; else if (tr.s < sA + 30) tr.dir = 1;
            tr.meshes.forEach((m, c) => { const p = tp(tr.s - tr.dir * c * 8.7, tr.d, o); m.position.set(p.x, p.y + 0.35, p.z); m.rotation.y = Math.atan2(p.tx, p.tz) + (tr.dir < 0 ? Math.PI : 0) + Math.PI / 2 - Math.PI / 2; });
          }
        });
      }

      /* ---- Philharmonie: white drum ringed by slender columns ---- */
      {
        const f = { x: -119, y: 0, z: 113, yaw: 0.35 };
        L.cyl(B, f, 0, 0, 0, 29, 29, 1.2, 28, col('#d9d8d3'));                       // plinth
        L.cyl(B, f, 0, 1.2, 0, 24.5, 24.5, 15, 28, glass, { flat: true });             // glazed drum
        for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; L.cyl(B, f, Math.cos(a) * 26.6, 1.2, Math.sin(a) * 26.6, 0.42, 0.38, 15.6, 5, white); }
        L.cyl(B, f, 0, 16.4, 0, 29.2, 28.4, 0.9, 28, white);                           // roof slab
        L.cyl(B, f, 0, 17.3, 0, 22, 22, 3, 24, col('#e9e9e6'));                       // upper volume
        L.cyl(B, f, 0, 20.3, 0, 22.4, 22.4, 0.5, 24, white);
        L.box(E, f, 0, 3, 0, 1, 1, 1, 0, col('#000000'));
        for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2 + 0.05; L.box(E, f, Math.cos(a) * 24.8, 3.4, Math.sin(a) * 24.8, 2.6, 9, 2.6, a, col('#ffd98a')); }  // warm light behind the glass (night)
        L.box(B, f, -40, 0, 8, 22, 6, 16, 0, col('#eeeeea')); L.box(B, f, -40, 6, 8, 23, 0.7, 17, 0, white);
        L.box(B, f, 36, 0, -10, 14, 5, 12, 0, col('#eeeeea')); L.box(B, f, 36, 5, -10, 15, 0.6, 13, 0, white);
      }

      /* ---- Mudam (white stone, glass pyramid) beside Fort Thüngen's round tower ---- */
      {
        const f = { x: -205, y: 0, z: 254, yaw: 0.5 };
        L.box(B, f, 0, 0, 0, 36, 9, 20, 0, stone); L.box(B, f, 14, 0, -16, 16, 7, 16, 0, col('#f0ece4'));
        L.gable(B, f, -6, 9, 0, 22, 20, 7, col('#f3f0e8'), 0.2); L.gableX(B, f, 14, 7, -16, 16, 16, 5.5, col('#f8f5ee'), 0.2);
        L.box(B, f, -8, 0, 0, 14, 17, 14, 0, glass); L.pyramid(B, f, -8, 17, 0, 15, 10, col('#76b0c2'));
        L.box(E, f, -8, 3, 7.1, 11, 8, 0.3, 0, col('#ffe3a5'));
        const g = { x: -262, y: 0, z: 262, yaw: 0 };
        L.cyl(B, g, 0, 0, 0, 10, 8.6, 16, 14, col('#b9ae98')); L.cyl(B, g, 0, 16, 0, 10.8, 10.8, 1.4, 14, col('#a99d86'));
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; L.box(B, g, Math.cos(a) * 10.3, 17.4, Math.sin(a) * 10.3, 2.2, 1.6, 2.2, a, col('#b9ae98')); }
        for (let i = 0; i < 6; i++) { const a = i * 1.05; L.box(B, g, Math.cos(a) * 8.9, 9, Math.sin(a) * 8.9, 0.6, 1.4, 0.6, 0, col('#2f3640')); }
        const wallB = [[-262, 262], [-232, 262]]; void wallB;
      }

      /* ---- Cour de Justice: three golden towers; Coque and Luxexpo at the end of the avenue ---- */
      for (const [x, z, h, w] of [[-31, -169, 62, 22], [-55, -142, 52, 20], [-81, -118, 42, 20]]) {
        W.box(x, 0, z, w, h, w, 0.45, col('#c9a14e'), { wall: KL.facadeWall('glass'), noTop: false, topCol: col('#8a6a2a') });
        B.box(x, h, z, w + 0.6, 0.8, w + 0.6, 0.45, col('#8a6a2a'));
      }
      {
        const f = { x: 150, y: 0, z: -40, yaw: -0.2 };                                   // Coque: oval arena with a sweeping white roof
        L.cyl(B, f, 0, 0, 0, 36, 33, 12, 24, col('#aeb4bb')); L.cyl(B, f, 0, 12, 0, 34, 20, 7, 24, white, { flat: true });
        for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; L.cyl(B, f, Math.cos(a) * 36.5, 0, Math.sin(a) * 36.5, 0.5, 0.5, 12, 5, white); }
        const g = { x: 262, y: 0, z: -72, yaw: -0.2 };                                  // Luxexpo The Box: grey-blue angular hall + mast
        L.box(B, g, 0, 0, 0, 96, 12, 54, 0, col('#93a1ae')); L.gable(B, g, 0, 12, 0, 96, 54, 9, col('#b6c3cf'), 0.6);
        L.cyl(B, g, 50, 0, -20, 0.5, 0.3, 46, 5, steel); L.box(E, g, 50, 46, -20, 1, 1, 1, 0, col('#ff3a2a'));
      }
      /* ---- Park Dräi Eechelen: lawn trees ---- */
      {
        const Tb = new KL.Batch(), park = KL.scenery.tree('park', rnd), plane = KL.scenery.tree('plane', rnd), q = S.quality.trees, sc = {};
        let n = 0, tries = 0;
        while (n < 120 * q && tries++ < 4000) {
          const x = -560 + rnd() * 360, z = 165 + rnd() * 175; if (!inPoly(x, z, PARK)) continue;
          const p = track.project(x, z, -1, null, sc); if (Math.hypot(x - p.cx, z - p.cz) < p.hw + 8) continue;
          if (Math.hypot(x + 205, z - 254) < 30) continue;
          Tb.addBatch(rnd() < 0.5 ? park : plane, x, terrain(x, z) - 0.1, z, rnd() * 6.28, 0.9 + rnd() * 0.7); n++;
        }
        add(Tb, M.plain);
      }
      add(B, M.plain); KL.kit.nightOnly(S, E); add(W, M.buildingM || M.building);
    },
  });
})();
