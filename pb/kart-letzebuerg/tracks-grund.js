/* Kart Lëtzebuerg — track: Grund & Corniche. Down the "most beautiful balcony of Europe" (Chemin de la Corniche, with its fortress wall), a hairpin descent
 * into the Alzette valley, along the Grund quay and past the Abbaye de Neumünster, over the river at Stierchen and back up the Montée de Clausen
 * beside the Bock casemates. Layout loosely after OpenStreetMap (contributors, ODbL); metres from 49.61 N / 6.137 E (x east, z south). */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, L = KL.lm;
  const BOX = [-330, -300, 330, 330];
  const valley = KL.kit.valleyTerrain('grund', { box: BOX, depth: 40, a: 20, b: 84, cell: 4 });
  let TERR = (x, z) => valley(x, z);

  KL.registerTrack({
    id: 'grund', origin: [49.61, 6.137],
    theme: {
      facade: 'old', ground: 'slabs', groundTint: '#ffffff', groundCell: 10, farColor: '#7d8a78', farDrop: -41, skyline: false, lampSpacing: 26, lampBothSides: false,
      startText: 'GRUND & CORNICHE', wallColor: '#c4b28e', wallTop: '#e0d2b0', vergeColor: '#b8ad98', wallH: 1.3, road: 'asphalt', fogScale: 0.95,
      osm: 'grund', cityRadius: 420, cityFloors: [3, 4], maxFloors: 6, cityFollow: true, cityMaxSlope: 8, boulevardTrees: 18,
      palette: ['#ecd9a8', '#e6c98b', '#e3b88a', '#efe0c0', '#d9a97a', '#e8c6a8', '#cdb48a', '#f0e3c8'],
      roofs: ['#4a505c', '#434955', '#58606b', '#3c424d', '#5d5560'],
      groundMap: { x0: -540, z0: -520, size: 1050, paving: '#a89f8c', water: '#4f90b8',
        paint: KL.kit.valleyPaint((x, z) => TERR(x, z), 'grund', { box: BOX, depth: 40, rock: '#a79f8d', grass: '#6aa149', grass2: '#86b85c', edge: '#b1a894', floor: '#8fa56d', blotches: 1800 }) },
      weathers: ['day', 'sunset', 'night', 'rain'],
    },
    zones: [{ a: 9, b: 17, road: 'cobble', name: 'grund' }],
    makeTerrain(track) {
      const sc = {}, L0 = track.length;
      TERR = (x, z) => {
        const base = valley(x, z), p = track.project(x, z, -1, null, sc);
        const dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + Math.max(p.wl, p.wr) + 0.9;
        const corniche = (p.s > L0 - 80 || p.s < 175) && p.d < 0;                // balcony: the valley side drops like a cliff
        return lerp(p.cy - 0.4, base, smooth(flat, flat + (corniche ? 5 : 26), dist));
      };
      return TERR;
    },
    noBuild: [[118, -86, 46], [-52, -150, 30]],
    pads: [[40, 0, 10], [560, 0, 10], [760, 0, 10], [1050, 0, 10]],
    decorate(S) {
      const { add, mats, track, rnd } = S, M = mats, st = track.stations, N = track.N;
      const B = new KL.Batch(), E = new KL.Batch();
      const sand = col('#c9b68e'), sandD = col('#a8956f'), rock = col('#b5a37c'), rockD = col('#8f7f5e'), ochre = col('#e4c88a'), slate = col('#454b58'), dark = col('#2a2f38');
      const T = (x, z) => TERR(x, z);

      /* ---- the Corniche's fortress wall: a tall sandstone face under the balcony with round towers ---- */
      {
        const i0 = Math.floor((track.length - 80) / track.step), i1 = Math.floor(175 / track.step), idx = [];
        for (let i = i0; i < N; i++) idx.push(i); for (let i = 0; i <= i1; i++) idx.push(i);
        for (let k = 0; k + 1 < idx.length; k++) {
          const a = idx[k], b = idx[k + 1], la = track.HW[a] + track.WL[a] + 0.35, lb = track.HW[b] + track.WL[b] + 0.35;
          const P = (j, d, y) => [track.X[j] + -track.TZ[j] * d, y, track.Z[j] + track.TX[j] * d];
          const yb = -42, c = k % 3 === 0 ? sandD : sand;
          const top = [P(a, -la, -0.2), P(b, -lb, -0.2)], bot = [P(a, -la - 4, yb), P(b, -lb - 4, yb)];
          B.quad(bot[0], bot[1], top[1], top[0], c);
          B.quad(P(b, -lb, -0.2), P(a, -la, -0.2), P(a, -la, -1.4), P(b, -lb, -1.4), shade(sand, 1.12));
        }
        for (let s = 30; s < track.length; s += 62) {
          if (s > 175 && s < track.length - 80) continue;
          const p = track.at(s, -(track.HW[Math.floor(s / track.step)] + track.WL[Math.floor(s / track.step)] + 4));
          B.cyl(p.x, -42, p.z, 7, 6.2, 42, 12, sand); B.cyl(p.x, 0, p.z, 7.4, 7.4, 1.0, 12, sandD);
          for (let q = 0; q < 8; q++) { const an = (q / 8) * 6.283; B.box(p.x + Math.cos(an) * 6.9, 1, p.z + Math.sin(an) * 6.9, 1.8, 1.3, 1.8, an, sandD); }
          for (const hh of [-14, -26]) B.box(p.x + 5, hh, p.z, 0.6, 2.4, 0.9, 0, dark);
        }
      }

      /* ---- Abbaye de Neumünster: ochre wings with slate mansards around a courtyard, slender church spire ---- */
      {
        const y0 = T(120, -86) + 0.2, f = { x: 120, y: y0, z: -86, yaw: -0.5 };
        L.box(B, f, 0, 0, 0, 74, 15, 15, 0, ochre); L.gable(B, f, 0, 15, 0, 74, 15, 7, slate, 0.5);
        L.box(B, f, -30, 0, 22, 14, 15, 30, 0, ochre); L.gableX(B, f, -30, 15, 22, 14, 30, 6, slate, 0.5);
        L.box(B, f, 30, 0, 22, 14, 15, 30, 0, ochre); L.gableX(B, f, 30, 15, 22, 14, 30, 6, slate, 0.5);
        for (let i = 0; i < 11; i++) for (const lz of [-7.6, 7.6]) for (const fl of [0, 1, 2]) L.box(B, f, -32 + i * 6.4, 1.6 + fl * 4.4, lz, 1.7, 2.6, 0.3, 0, dark);
        for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) for (const fl of [0, 1, 2]) L.box(B, f, -30 + (sx > 0 ? 60 : 0), 1.6 + fl * 4.4, 10 + i * 7, 0.3, 2.6, 1.7, 0, dark);
        const c = { x: 120, y: y0, z: -86, yaw: -0.5 };                                // church: nave + square tower + needle
        L.box(B, c, 0, 0, -26, 16, 17, 30, 0, shade(ochre, 0.95)); L.gable(B, c, 0, 17, -26, 16, 30, 9, slate, 0.5);
        L.box(B, c, 0, 0, -44, 9, 36, 9, 0, shade(ochre, 0.92)); L.pyramid(B, c, 0, 36, -44, 10, 26, col('#2f3541'));
        L.box(B, c, 0, 22, -44.4, 3.2, 6, 9.4, 0, dark);
      }

      /* ---- Bock casemates: a sandstone promontory with arched openings, a round tower on top ---- */
      {
        const bx = -50, bz = -150, y0 = T(bx, bz) - 6;
        const f = { x: bx, y: y0, z: bz, yaw: 0.3 };
        for (const [lx, lz, w, d, h] of [[0, 0, 34, 22, 42], [-14, 12, 16, 18, 36], [12, -12, 18, 16, 44], [4, 18, 14, 12, 30]]) L.box(B, f, lx, 0, lz, w, h, d, 0, rock);
        for (let k = 0; k < 4; k++) { L.box(E, f, -12 + k * 8, 24, 11.2, 2.8, 4.4, 0.4, 0, dark); L.box(E, f, -12 + k * 8, 28.4, 11.2, 2.8, 0.4, 0.4, 0, col('#5a4a33')); }
        L.cyl(B, f, 8, 42, -14, 5.5, 5, 12, 12, rock); for (let q = 0; q < 8; q++) { const an = (q / 8) * 6.283; L.box(B, f, 8 + Math.cos(an) * 5.2, 54, -14 + Math.sin(an) * 5.2, 1.6, 1.4, 1.6, an, rockD); }
        for (let k = 0; k < 18; k++) L.box(B, f, -16 + rnd() * 32, 2 + rnd() * 38, 11.4, 2 + rnd() * 3, 1.2, 0.7, 0, rockD);
      }
      add(B, M.plain); KL.kit.nightOnly(S, E, 0.35);
    },
  });
})();
