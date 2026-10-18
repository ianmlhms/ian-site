/* Kart Lëtzebuerg — track 1: Uewerstad (Ville Haute, Luxembourg City).
 * Layout follows real streets (OpenStreetMap contributors, ODbL): Boulevard Roosevelt past the Gëlle Fra, Rue de l'Ancien Athénée,
 * Rue Notre-Dame along the cathedral, Rue du Fossé, Place Guillaume II (Hôtel de Ville), Place d'Armes, Avenue Monterey, Avenue de la Porte-Neuve.
 * Coordinates are metres from 49.6105 N / 6.1295 E (x east, z south). `front` = where real buildings stand beside the track (8 m cells,
 * digit = OSM building:levels, a = unknown height, 0 = open), measured from OSM footprints with scripts/kart_frontage.mjs. */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade;

  // rims of the Pétrusse valley (z of the plateau edge as a function of x)
  const RIM_N = [[-400, 250], [-330, 230], [-260, 192], [-228, 176], [-205, 144], [-150, 128], [-62, 124], [-46, 160], [-26, 186], [14, 186], [36, 154], [62, 132], [100, 152], [160, 208], [240, 262], [400, 380]];
  const RIM_S = [[-400, 470], [-330, 430], [-230, 350], [-150, 306], [-60, 318], [40, 340], [130, 322], [220, 296], [400, 250]];
  const interp = (poly, x) => { if (x <= poly[0][0]) return poly[0][1]; for (let i = 1; i < poly.length; i++) if (x <= poly[i][0]) { const t = (x - poly[i - 1][0]) / (poly[i][0] - poly[i - 1][0]); return lerp(poly[i - 1][1], poly[i][1], t); } return poly[poly.length - 1][1]; };
  const VALLEY = 40;
  function terrain(x, z) {
    const dN = z - interp(RIM_N, x), dS = interp(RIM_S, x) - z;
    if (dN <= 0 || dS <= 0) return 0;
    return -VALLEY * smooth(0, 22, dN) * smooth(0, 22, dS);
  }
  /* valley colours (sRGB 0-255), painted into the street map so the slopes blend smoothly and the river is a curve */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ROCK = hex('#a39c8c'), GRASS = hex('#6aa149'), GRASS2 = hex('#86b85c'), PAVE = hex('#b2aea6');
  const riverZ = (x) => (interp(RIM_N, x) + interp(RIM_S, x)) / 2 + Math.sin(x * 0.03) * 12;
  function valleyColor(x, z, h) {
    const depth = clamp(-h / VALLEY, 0, 1), n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + 0.5;
    if (depth < 0.55) return mixc(PAVE, ROCK, smooth(0, 0.25, depth));
    return mixc(ROCK, mixc(GRASS, GRASS2, n), smooth(0.4, 0.75, depth));
  }

  /* the Pétrusse valley is coloured by vertex colours; keep the street map neutral (white) there */
  function paintValley(g, X, Z, sc) {
    const x0 = -640, x1 = 640, z0 = 90, z1 = 500, cs = 4, cw = Math.round((x1 - x0) / cs), ch = Math.round((z1 - z0) / cs);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const cg = cv.getContext('2d'), im = cg.createImageData(cw, ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = x0 + (i + 0.5) * cs, z = z0 + (j + 0.5) * cs, h = terrain(x, z), a = clamp(-h / 5, 0, 1), c = valleyColor(x, z, h), o = (j * cw + i) * 4;
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = a * 255;
    }
    cg.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(cv, X(x0), Z(z0), (x1 - x0) * sc, (z1 - z0) * sc);
    const rnd = KL.rng(77);                                   // leaf / grass blotches
    for (let k = 0; k < 2600; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), h = terrain(x, z); if (h > -6) continue;
      g.fillStyle = rnd() > 0.5 ? 'rgba(40,100,40,.18)' : 'rgba(150,200,90,.16)'; g.beginPath(); g.ellipse(X(x), Z(z), (1 + rnd() * 5) * sc, (1 + rnd() * 3) * sc, rnd() * 3, 0, 7); g.fill();
    }
    // the Pétrusse
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, c] of [[9, '#3d86b8'], [6, '#5aa9d6'], [2, 'rgba(210,235,250,.7)']]) {
      g.beginPath(); let open = false;
      for (let x = x0; x <= x1; x += 8) { const z = riverZ(x); if (terrain(x, z) > -33) { open = false; continue; } if (!open) { g.moveTo(X(x), Z(z)); open = true; } else g.lineTo(X(x), Z(z)); }
      g.lineWidth = w * sc; g.strokeStyle = c; g.stroke();
    }
  }

  KL.registerTrack({
    id: 'villehaute', hw: 9, r: 26, origin: [49.6105, 6.1295],
    theme: { facade: 'old', verge: 'slabs', ground: 'slabs', groundTint: '#ffffff', groundCell: 10, farColor: '#b9b4ab', farDrop: -41, weathers: ['day', 'sunset', 'night', 'rain'],
      startText: 'UEWERSTAD', wallColor: '#d3c9b6', wallTop: '#e6dfcf', vergeColor: '#c4bfb6', skyline: false, lampSpacing: 28,
      osm: 'villehaute', cityRadius: 430, boulevardTrees: 15,
      groundMap: { x0: -640, z0: -480, size: 1280, paving: '#8d8a84', paint: paintValley },
    },
    terrain,
    pts: [
      [-232, 100, { r: 34, hw: 10 }], [-120, 104, { hw: 11 }], [-62, 106, { r: 16 }], [-37, 122, { r: 12 }], [-31, 148, { r: 16 }], [-10, 164, { r: 20 }], [14, 148, { r: 16 }], [18, 122, { r: 12 }], [40, 106, { r: 16 }], [61, 104, { r: 18 }],
      [62, 56, { r: 20 }], [190, 45, { r: 34 }], [162, -24, { r: 46 }], [50, -24, { r: 30 }], [56, -78, { r: 24 }], [12, -66, { r: 30 }],
      [-100, -52, { r: 16 }], [-101, -181, { r: 24 }], [-196, -191, { r: 24 }], [-187, -38, { r: 12 }], [-232, -30, { r: 30 }], [-232, 50],
    ],
    // (front strings from the old procedural facades are no longer used: city.js builds from the real OSM footprints)
    front0: {"L":"333333333333555330333000000000000000000000aa77a7660222aaaaaaaaaaaaaaa000000000000000000aaaaaaaaa35444443443666aaa444444a0000000666666888003","R":"8800000003333300000000000000000000000000000000aaaaa0000aa000aaaaa033aaaa000000000000000aaaaaa000000aa000000aa366600000000000000000000000000"},
    noBuild: [[71, 34, 30], [155, 98, 52], [-10, 137, 14]],
    pads: [[150, 0, 10], [470, 0, 10], [850, 0, 10]],
    decorate(S) {
      const { add, mats, track, rnd } = S, M = mats;
      const B = new KL.Batch(), W = new KL.Batch();   // B: coloured solids, W: facade-textured walls (not used here)
      const stone = col('#d2c6ad'), stoneD = col('#b3a78f'), roofDark = col('#454b58'), copper = col('#5a9a86'), gold = col('#f4c430'), glass = col('#2b3a4a'), cream = col('#e9ddc2');

      /* ---- Gëlle Fra (Monument du Souvenir, 1923): stone obelisk with the golden woman holding a laurel wreath ---- */
      {
        const f = { x: -10, y: 0, z: 137, yaw: 0.1 }, L = KL.lm;
        L.box(B, f, 0, 0, 0, 13, 0.5, 13, 0, stone); L.box(B, f, 0, 0.5, 0, 10, 0.5, 10, 0, stone); L.box(B, f, 0, 1.0, 0, 7.4, 0.5, 7.4, 0, stone);
        L.box(B, f, 0, 1.5, 0, 4.2, 2.4, 4.2, 0, stoneD);                              // plinth
        for (const sx of [-1, 1]) { L.box(B, f, sx * 2.6, 1.5, 0, 1.3, 2.4, 1.6, 0, stone); L.sphere(B, f, sx * 2.6, 4.4, 0, 0.55, 6, col('#7a6a52')); }   // soldiers (suggested)
        L.cyl(B, f, 0, 3.9, 0, 2.0, 1.0, 17.5, 4, stone, { flat: true });             // obelisk (4-sided taper)
        L.cyl(B, f, 0, 21.3, 0, 0.9, 0.9, 0.5, 4, stoneD);
        L.cyl(B, f, 0, 21.8, 0, 0.75, 0.42, 2.6, 8, gold);                             // the woman: gown
        L.sphere(B, f, 0, 24.65, 0, 0.36, 8, gold);
        L.box(B, f, 0.55, 22.9, 0, 0.16, 1.9, 0.16, 0, gold);                          // raised arm
        for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283; L.sphere(B, f, 0.55 + Math.cos(a) * 0.62, 25.3 + Math.sin(a) * 0.62, 0, 0.16, 4, gold); }   // wreath
        L.box(B, f, -0.9, 22.5, 0, 0.1, 1.8, 0.5, -0.35, gold); L.box(B, f, 0.0, 22.5, -0.45, 0.5, 1.6, 0.1, 0, gold);   // cloak
      }

      /* ---- Hôtel de Ville (1838, neoclassical, bronze lions): faces north onto Place Guillaume II ---- */
      {
        const f = { x: 71, y: 0, z: 34, yaw: 0.09 }, L = KL.lm;
        L.box(B, f, 0, -1, 0, 34, 15.5, 14, 0, cream);
        L.box(B, f, 0, 14.5, 0, 35, 0.8, 15, 0, stone);
        L.gable(B, f, 0, 15.3, 0, 35, 15, 3.4, col('#6b6f78'), 0.1);
        for (let i = 0; i < 7; i++) for (const lz of [-7.07, 7.07]) for (const fl of [0, 1]) L.box(B, f, -13.5 + i * 4.5, 1.2 + fl * 5.2 + (lz < 0 ? 0 : 0), lz, 1.6, 2.8, 0.2, 0, glass);
        // portico on the north side
        L.box(B, f, 0, 0, -8.5, 13, 0.5, 4, 0, stone);
        L.columns(B, f, -5.4, 5.4, -9.8, 4, 0.5, 8.8, 0.55, stone);
        L.box(B, f, 0, 9.3, -8.7, 13.6, 0.9, 4.2, 0, stone);
        L.gable(B, f, 0, 10.2, -8.7, 13.6, 4.2, 2.6, col('#7a7f88'), 0.1);
        for (const sx of [-1, 1]) { L.box(B, f, sx * 8.5, 0, -11, 1.8, 1.0, 3.2, 0, stone); L.box(B, f, sx * 8.5, 1.0, -11, 1.0, 0.9, 2.6, 0, col('#6a5a3a')); L.sphere(B, f, sx * 8.5, 2.2, -11.9, 0.55, 6, col('#6a5a3a')); }     // lions
        L.cyl(B, f, 0, 17.8, 0, 0.55, 0.55, 3.2, 6, col('#6e7078'));
      }

      /* ---- Cathédrale Notre-Dame (1613, Jesuit baroque with a Gothic-revival feel): twin front towers, nave, transept, tall central spire ---- */
      {
        const f = { x: 155, y: 0, z: 58, yaw: 0.07 }, L = KL.lm;      // local z grows south: facade at z = 0
        const wall = col('#cfc3ab'), roof = col('#3f4552'), win = col('#2a3646');
        L.box(B, f, 0, -1, 38, 34, 19, 74, 0, wall);                                    // nave
        L.gable(B, f, 0, 18, 38, 34, 74, 10.5, roof, 0.6);
        L.box(B, f, 0, -1, 40, 62, 18, 17, 0, wall);                                    // transept
        L.gableX(B, f, 0, 17, 40, 62, 17, 8.5, roof, 0.6);
        L.box(B, f, 0, -1, 78, 22, 14, 12, 0, wall); L.gable(B, f, 0, 13, 78, 22, 12, 7, roof, 0.4);     // choir
        // west front
        L.box(B, f, 0, 0, -1.2, 34, 22, 2.4, 0, wall);
        L.gable(B, f, 0, 22, -1.2, 18, 2.6, 8.5, col('#8f8672'), 0.2);
        for (const sx of [-1, 1]) {
          L.box(B, f, sx * 11.5, 0, 0.5, 8.6, 33, 8.6, 0, wall);
          L.box(B, f, sx * 11.5, 33, 0.5, 9.2, 1, 9.2, 0, shade(wall, 0.9));
          L.pyramid(B, f, sx * 11.5, 34, 0.5, 8.8, 17, copper);
          L.windows(B, f, sx * 11.5 - 1.4, sx * 11.5 + 1.4, -3.9, -1, 2, 24, 1.1, 5.5, win);
        }
        L.windows(B, f, -5, 5, -2.5, -1, 3, 8, 1.3, 6.5, win);
        L.box(B, f, 0, 0, -2.6, 4.4, 7.4, 0.4, 0, col('#5b3f2a')); L.box(B, f, 0, 7.4, -2.6, 5.6, 0.8, 0.5, 0, wall);   // portal
        // tall slender central spire on the crossing
        L.box(B, f, 0, 17, 40, 8.4, 20, 8.4, 0, wall);
        L.pyramid(B, f, 0, 37, 40, 8.8, 22, copper); L.pyramid(B, f, 0, 59, 40, 2.4, 9, copper);
        L.windowsSide(B, f, 17.1, 8, 70, 7, 5.5, 1.6, 8.5, win); L.windowsSide(B, f, -17.1, 8, 70, 7, 5.5, 1.6, 8.5, win);
        for (let z = 6; z < 70; z += 8.2) for (const sx of [-1, 1]) L.box(B, f, sx * 17.4, 0, z, 0.9, 14, 1.2, 0, shade(wall, 0.9));   // buttresses
      }

      /* ---- Place d'Armes: bandstand + plane trees, café parasols ---- */
      {
        const f = { x: -28, y: 0, z: -92, yaw: 0 }, L = KL.lm;
        L.cyl(B, f, 0, 0, 0, 5.2, 5.2, 0.6, 8, stoneD);
        L.cyl(B, f, 0, 0.6, 0, 4.4, 4.4, 0.3, 8, stone);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; L.cyl(B, f, Math.cos(a) * 3.9, 0.9, Math.sin(a) * 3.9, 0.16, 0.16, 3.6, 5, col('#40576b')); }
        L.cyl(B, f, 0, 4.5, 0, 4.8, 3.9, 0.35, 8, col('#40576b'));
        L.cyl(B, f, 0, 4.85, 0, 4.2, 0.2, 3.2, 8, col('#2f6f6a'), { flat: true });
        L.sphere(B, f, 0, 8.2, 0, 0.35, 5, gold);
        // parasols
        const colors = ['#d9323c', '#2e6f9e', '#f2c230', '#2f8f5b'];
        for (let i = 0; i < 14; i++) { const px = -85 + (i % 7) * 11 + (i > 6 ? 5 : 0), pz = i > 6 ? -97 : -81 + 0; B.cyl(px, 0, pz, 0.06, 0.06, 2.4, 4, col('#444')); B.cyl(px, 2.2, pz, 1.7, 0.1, 0.6, 8, col(colors[i % 4]), { flat: true }); }
      }

      /* ---- Pont Adolphe (1903): 84.6 m stone arch over the Pétrusse; the real double-decker is shown with the main arch and the approach arcades ---- */
      KL.lm.archBridge(B, [-218, 168], [-146, 300], { width: 18, deckY: 0, archA: 34, archB: 119, springY: -37, rise: 30, groundY: -42, color: '#d8c7a4' });

      /* ---- BCEE tower and the far rim, as a recognisable skyline element ---- */
      { const f = { x: -67, y: -2, z: 345, yaw: 0.2 }, L = KL.lm; L.box(B, f, 0, 0, 0, 14, 62, 14, 0, col('#9aa3b3')); L.box(B, f, 0, 62, 0, 10, 4, 10, 0, col('#d8dbe3')); L.pyramid(B, f, 0, 66, 0, 11, 8, col('#4f5a6a')); }

      add(B, M.plain);

      /* ---- trees: plane trees on the squares, forest in the valley ---- */
      const T = new KL.Batch(), q = S.quality.trees, planeA = KL.scenery.tree('plane', rnd), parkA = KL.scenery.tree('park', rnd);
      const place = (x, z, kind, sc) => { const y = terrain(x, z) - 0.15; T.addBatch(kind === 'plane' ? planeA : parkA, x, y, z, rnd() * 6.28, sc || (0.85 + rnd() * 0.5)); };
      let tries = 0, planted = 0;
      while (planted < 130 * q && tries++ < 3000) {
        const x = -260 + rnd() * 560, z = 120 + rnd() * 260, h = terrain(x, z);
        if (h > -8 || h < -39) continue;
        place(x, z, 'park', 1.2 + rnd() * 1.6); planted++;
      }
      add(T, M.plain);
    },
  });
})();
