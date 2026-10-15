/* Lokféierer: facades and roofs of the Luxtram world (TS.luxFacades).
 * "Painted realism": no photo textures.  Every LOD2 / OSM building gets a typology (historic town house, post-war block, modern residential,
 * house, office curtain wall, commercial / industrial, institutional, church) chosen from the OSM tags, the LOD2 roof shape and the district of the line;
 * facades come from a procedural cell atlas (one cell = one window bay x one storey, painted below) with an integer number of bays per wall,
 * tall shop-front ground floors with awnings along the shopping streets, cornices, plinths; roofs are slate / clay tile / zinc / gravel shaded in the
 * fragment shader with dormers and chimneys added as geometry.  Roof colours come from the OSM tags + typology, never from an aerial image.
 *
 *   TS.luxFacades.create(ctx) -> fx   { matWall, parseTile(buf), buildTile(t), newBatch(), addOsmBuilding(batch, b, ci, idx), batchMesh(batch), setNight(k), dispose() }
 * All geometry of a tile / chunk is merged into one mesh with one material (no extra draw calls for dormers, chimneys, cornices).
 * Data: data/luxtram/bf/<i>_<j>.bin from scripts/build_luxtram_facades.py. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const FX = (TS.luxFacades = TS.luxFacades || {});
  const TAG = '[Lokféierer] facades: ';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash2 = (x, y) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

  /* ============================================================ the cell atlas
   * 8 x 8 cells.  Row = typology (0 historic, 1 post-war, 2 modern residential, 3 house, 4 office, 5 commercial / industrial, 6 institutional, 7 specials),
   * columns 0-3 = ground floor (0 entrance, 1 window, 2 shop front, 3 shop front with door), 4-7 = upper floors (4 standard, 5 / 6 / 7 variants).
   * Three canvases with the same layout:
   *   day   (1024^2) final colours; pixels that take the building's wall colour are painted in luminance (white = lit render) and flagged in the mask
   *   mask  (512^2)  R = wall colour, G = accent colour (window frames, shutters, awnings, doors), B = glass; all black = fixed colour
   *   lit   (512^2)  warm light of the windows at night */
  const CELL = 128;
  const COLS = 8;
  const ROWS = 8;
  const TYP = { HISTORIC: 0, POSTWAR: 1, MODERN: 2, HOUSE: 3, OFFICE: 4, INDUSTRIAL: 5, INSTITUTIONAL: 6, SPECIAL: 7 };
  const BAY = [3.1, 3.4, 3.2, 2.8, 1.8, 4.0, 3.6, 4.2];                       // bay width (m) per typology
  const FLOOR_T = [3.3, 2.9, 3.05, 2.7, 3.9, 3.7, 3.6, 3.5];                  // typical upper storey height
  const GROUND_T = [4.2, 3.3, 3.3, 2.9, 4.8, 4.6, 4.2, 4.5];                  // typical ground floor height
  const ACCENTS = ['#f1efe8', '#e6dcc4', '#c4c7c8', '#3a3f44', '#4a3426', '#3c5a42', '#7d8f78', '#9b2f2a', '#2b3f5f', '#6d2530', '#c4952f', '#7a9bb5', '#6b6a3a', '#202428', '#b0553a', '#5f736b'];
  const AWNINGS = [7, 5, 8, 10, 9, 14, 3, 13, 11, 12];

  function paintAtlas() {
    const mk = (px) => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };
    const cD = mk(CELL * COLS); const cM = mk(CELL * COLS / 2); const cL = mk(CELL * COLS / 2);
    const gD = cD.getContext('2d'); const gM = cM.getContext('2d'); const gL = cL.getContext('2d');
    gD.fillStyle = '#fff'; gD.fillRect(0, 0, cD.width, cD.height);
    gM.fillStyle = '#f00'; gM.fillRect(0, 0, cM.width, cM.height);
    gL.fillStyle = '#000'; gL.fillRect(0, 0, cL.width, cL.height);

    function cell(col, row, seed, fn) {
      const ox = col * CELL; const oy = row * CELL;
      const gs = [gD, gM, gL];
      gs.forEach((g, i) => { const k = i === 0 ? 1 : 0.5; g.save(); g.beginPath(); g.rect(ox * k, oy * k, CELL * k, CELL * k); g.clip(); g.translate(ox * k, oy * k); g.scale(k, k); });
      const r = mulberry(seed);
      const P = {
        r,
        // fill kinds: wall (takes the wall colour), acc (takes the accent colour), fix (fixed colour)
        rect(kind, v, x, y, w, h) { this.path(kind, v, (g) => { g.rect(x, y, w, h); }); },
        path(kind, v, draw) {
          let d; let m;
          if (kind === 'wall') { const s = Math.round(clamp(v, 0, 1) * 255); d = 'rgb(' + s + ',' + s + ',' + s + ')'; m = '#f00'; }
          else if (kind === 'acc') { const s = Math.round(clamp(v, 0, 1) * 255); d = 'rgb(' + s + ',' + s + ',' + s + ')'; m = '#0f0'; }
          else if (kind === 'glass') { d = v; m = '#00f'; }
          else { d = v; m = '#000'; }
          gD.fillStyle = d; gD.beginPath(); draw(gD); gD.fill();
          gM.fillStyle = m; gM.beginPath(); draw(gM); gM.fill();
        },
        wall(x, y, w, h, s) { this.rect('wall', s === undefined ? 1 : s, x, y, w, h); },
        acc(x, y, w, h, s) { this.rect('acc', s === undefined ? 1 : s, x, y, w, h); },
        fix(x, y, w, h, col) { this.rect('fix', col, x, y, w, h); },
        shade(x, y, w, h, a) { gD.fillStyle = 'rgba(0,0,0,' + a + ')'; gD.fillRect(x, y, w, h); },
        shine(x, y, w, h, a) { gD.fillStyle = 'rgba(255,255,255,' + a + ')'; gD.fillRect(x, y, w, h); },
        lit(x, y, w, h, col) { gL.fillStyle = col || '#ffd9a0'; gL.fillRect(x, y, w, h); },
        grain(n, a) { for (let i = 0; i < n; i++) { gD.fillStyle = r() > 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')'; gD.fillRect(r() * CELL, r() * CELL, 2, 2); } },
        // window glass with a bit of life behind it (curtains), flagged as glass in the mask; lit at night
        glass(x, y, w, h, o) {
          o = o || {};
          const tone = o.tone || 'blue';
          const g = gD.createLinearGradient(x, y, x + w * 0.7, y + h);
          if (tone === 'blue') { g.addColorStop(0, '#a6bccb'); g.addColorStop(0.45, '#58707f'); g.addColorStop(1, '#33444f'); }
          else if (tone === 'green') { g.addColorStop(0, '#9ab8b2'); g.addColorStop(0.5, '#4a6a68'); g.addColorStop(1, '#2b3f40'); }
          else if (tone === 'dark') { g.addColorStop(0, '#869fae'); g.addColorStop(0.5, '#41596a'); g.addColorStop(1, '#2a3a46'); }
          else { g.addColorStop(0, '#b9c9d2'); g.addColorStop(0.5, '#6d8798'); g.addColorStop(1, '#3c5262'); }
          this.path('glass', g, (c) => { c.rect(x, y, w, h); });
          if (o.curtain !== false) {
            const q = r();
            if (q < 0.34) this.shine2(x, y, w, h * (0.16 + r() * 0.12), 'rgba(236,226,206,0.55)');
            else if (q < 0.55) { this.shine2(x, y, w * 0.28, h, 'rgba(232,222,204,0.5)'); }
            else if (q < 0.7) { this.shine2(x + w * 0.72, y, w * 0.28, h, 'rgba(232,222,204,0.5)'); }
          }
          gD.fillStyle = 'rgba(255,255,255,0.16)'; gD.beginPath(); gD.moveTo(x, y + h * 0.62); gD.lineTo(x + w * 0.58, y); gD.lineTo(x + w, y); gD.lineTo(x, y + h); gD.closePath(); gD.fill();
          if (o.lit !== false) { const lg = gL.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, '#fff0cc'); lg.addColorStop(1, '#d9a468'); gL.fillStyle = lg; gL.fillRect(x, y, w, h); }
        },
        shine2(x, y, w, h, col) { gD.fillStyle = col; gD.fillRect(x, y, w, h); },
        // a sash window: accent frame + glass + glazing bars + inner shadow
        sash(x, y, w, h, o) {
          o = o || {};
          const fr = o.fr || 3;
          this.acc(x, y, w, h, 0.97);
          this.glass(x + fr, y + fr, w - 2 * fr, h - 2 * fr, o);
          const bars = o.bars === undefined ? 'cross' : o.bars;
          if (bars === 'cross' || bars === 'v') this.acc(x + w / 2 - 1.2, y + fr, 2.4, h - 2 * fr, 0.97);
          if (bars === 'cross' || bars === 'h') this.acc(x + fr, y + h * 0.36, w - 2 * fr, 2.4, 0.97);
          if (bars === 'six') { this.acc(x + w / 3 - 1, y + fr, 2, h - 2 * fr, 0.97); this.acc(x + 2 * w / 3 - 1, y + fr, 2, h - 2 * fr, 0.97); this.acc(x + fr, y + h * 0.5 - 1, w - 2 * fr, 2, 0.97); }
          this.shade(x + fr, y + fr, w - 2 * fr, 4, 0.34); this.shade(x + fr, y + fr, 3, h - 2 * fr, 0.16);
        },
        sill(x, y, w, s) { this.wall(x, y, w, 5, s === undefined ? 1 : s); this.shade(x, y + 5, w, 5, 0.3); this.shade(x, y + 5, w, 2, 0.15); },
        shutter(x, y, w, h) { this.acc(x, y, w, h, 0.92); for (let yy = y + 3; yy < y + h - 2; yy += 4) this.shade(x + 1, yy, w - 2, 1.2, 0.32); this.shade(x, y, 1.5, h, 0.2); },
        fixedRail(x, y, w, h, col) { this.fix(x, y, w, 2, col); this.fix(x, y + h - 2, w, 2, col); for (let xx = x; xx <= x + w - 2; xx += 5) this.fix(xx, y, 1.6, h, col); },
      };
      fn(P);
      gs.forEach((g) => g.restore());
    }
    const baseWall = (P, s) => { P.wall(0, 0, CELL, CELL, s === undefined ? 0.95 : s); P.grain(300, 0.035); };

    /* ---------------------------------------------------------------- 0 historic town house (19th c., Gare / Ville / Bonnevoie) */
    cell(0, 0, 11, (P) => { // entrance: arched door with stone surround
      baseWall(P);
      P.wall(22, 16, 84, 112, 1.0);                                         // stone surround
      P.path('wall', 1.0, (g) => { g.moveTo(26, 128); g.lineTo(26, 42); g.quadraticCurveTo(64, -6, 102, 42); g.lineTo(102, 128); });
      P.path('acc', 0.84, (g) => { g.moveTo(36, 128); g.lineTo(36, 50); g.quadraticCurveTo(64, 14, 92, 50); g.lineTo(92, 128); });     // door leaf
      P.path('glass', '#20303a', (g) => { g.moveTo(41, 52); g.quadraticCurveTo(64, 22, 87, 52); g.lineTo(87, 60); g.lineTo(41, 60); });  // fanlight
      P.path('glass', '#20303a', (g) => { g.rect(44, 70, 16, 34); g.rect(68, 70, 16, 34); });
      P.acc(62, 62, 4, 66, 0.7);
      P.rect('fix', '#d9b560', 84, 90, 4, 5);
      P.shade(36, 50, 56, 5, 0.3);
      P.rect('fix', '#9d988c', 20, 120, 88, 8); P.shade(20, 128 - 3, 88, 3, 0.25);
      P.lit(41, 52, 46, 8, '#ffd9a0');
    });
    cell(1, 0, 12, (P) => { // ground floor window with iron grille
      baseWall(P);
      P.wall(0, 0, CELL, 20, 0.9);
      P.wall(30, 24, 68, 78, 1.0); P.sash(38, 30, 52, 62, { bars: 'cross' });
      P.fixedRail(38, 36, 52, 54, '#25292c'); P.sill(32, 92, 64);
    });
    cell(2, 0, 13, (P) => { // shop front with striped awning and sign band
      baseWall(P, 0.93);
      P.wall(0, 0, 10, 128, 1.0); P.wall(118, 0, 10, 128, 1.0);                          // pilasters
      P.wall(0, 6, 128, 26, 0.82);                                                        // fascia
      P.fix(14, 10, 100, 18, '#2a2e32');                                                   // sign board
      for (let x = 20, n = 0; x < 106 && n < 5; n++) { const w = 8 + P.r() * 20; P.fix(x, 15 + P.r() * 2, w, 5 + P.r() * 3, '#e8e2d2'); x += w + 6 + P.r() * 6; }   // lettering
      P.glass(14, 44, 100, 74, { tone: 'dark', curtain: false });
      P.shine(14, 44, 100, 12, 0.12);
      for (let i = 0; i < 7; i++) { const h = 14 + P.r() * 22; P.fix(20 + i * 13, 118 - h, 9, h, ['#c9b08a', '#b4bcc2', '#8a6a5a', '#d8d2c4'][i % 4]); }                 // goods
      P.fix(18, 96, 92, 2, '#555a5e');
      P.path('acc', 0.95, (g) => { g.moveTo(8, 32); g.lineTo(120, 32); g.lineTo(126, 58); g.lineTo(2, 58); });                  // awning
      for (let i = 0; i < 12; i++) P.path('fix', '#f2efe6', (g) => { const x0 = 8 + i * 9.3; g.moveTo(x0 - 3, 32); g.lineTo(x0 + 2.7, 32); g.lineTo(x0 + 2.7 + (x0 < 64 ? -0.6 : 0.6), 58); g.lineTo(x0 - 3 + (x0 < 64 ? -0.6 : 0.6), 58); });
      P.shade(2, 58, 124, 6, 0.38);
      P.rect('fix', '#3b3f44', 10, 118, 108, 10);
      P.lit(14, 44, 100, 74, '#ffe2b0');
    });
    cell(3, 0, 14, (P) => { // shop front with door
      baseWall(P, 0.93);
      P.wall(0, 0, 8, 128, 1.0); P.wall(120, 0, 8, 128, 1.0);
      P.wall(0, 6, 128, 24, 0.82); P.fix(12, 9, 104, 16, '#e9e4d6'); for (let i = 0; i < 7; i++) P.fix(18 + i * 13, 13, 7, 8, '#33383c');
      P.glass(12, 38, 64, 80, { tone: 'dark', curtain: false }); P.acc(10, 36, 4, 84, 0.9);
      P.acc(78, 38, 38, 84, 0.9); P.glass(82, 44, 30, 72, { tone: 'dark', curtain: false }); P.acc(95, 44, 2.5, 72, 0.9);
      P.fix(106, 80, 3, 14, '#c9a95a');
      P.rect('fix', '#8a867c', 70, 120, 50, 8);
      P.shade(12, 38, 64, 4, 0.3);
      P.lit(12, 38, 64, 80, '#ffe2b0'); P.lit(82, 44, 30, 72, '#ffe2b0');
    });
    cell(4, 0, 15, (P) => { // upper floor: tall window, stone surround, lintel and sill
      baseWall(P);
      P.wall(28, 8, 72, 94, 1.0);
      P.sash(37, 18, 54, 76, { bars: 'cross' });
      P.wall(32, 4, 64, 10, 1.0); P.shade(32, 14, 64, 3, 0.26);
      P.sill(31, 94, 66);
    });
    cell(5, 0, 16, (P) => { // upper floor with shutters
      baseWall(P);
      P.sash(46, 20, 36, 72, { bars: 'cross' });
      P.shutter(28, 18, 15, 76); P.shutter(85, 18, 15, 76);
      P.wall(24, 10, 80, 7, 1.0); P.shade(24, 17, 80, 3, 0.22);
      P.sill(42, 92, 44);
    });
    cell(6, 0, 17, (P) => { // upper floor: French window with wrought-iron balcony
      baseWall(P);
      P.wall(30, 2, 68, 100, 1.0);
      P.sash(38, 10, 52, 80, { bars: 'cross' });
      P.wall(8, 92, 112, 8, 1.0); P.shade(8, 100, 112, 7, 0.34);
      P.fixedRail(10, 70, 108, 22, '#23272b');
      P.shade(0, 0, 128, 7, 0.14);
    });
    cell(7, 0, 18, (P) => { // upper floor: small stair window
      baseWall(P);
      P.wall(46, 20, 36, 62, 1.0); P.sash(51, 26, 26, 48, { bars: 'h' });
      P.sill(45, 76, 38);
    });

    /* ---------------------------------------------------------------- 1 post-war apartment block (1950-80) */
    cell(0, 1, 21, (P) => { // entrance with glass doors and concrete canopy
      baseWall(P, 0.9);
      P.wall(0, 8, 128, 10, 0.78);
      P.acc(24, 26, 80, 102, 0.9); P.glass(28, 30, 33, 98, { tone: 'dark' }); P.glass(67, 30, 33, 98, { tone: 'dark' }); P.acc(62, 30, 4, 98, 0.9);
      P.wall(14, 20, 100, 8, 0.7); P.shade(14, 28, 100, 6, 0.3);
      P.fix(84, 76, 3, 10, '#b8b8b8'); P.lit(28, 30, 72, 98, '#ffe2b0');
    });
    cell(1, 1, 22, (P) => { // ground floor ribbon window
      baseWall(P, 0.9);
      P.wall(0, 0, 128, 14, 0.78); P.sash(14, 28, 100, 56, { bars: 'v', tone: 'blue' }); P.wall(8, 84, 112, 8, 0.8); P.shade(8, 92, 112, 5, 0.3);
    });
    cell(2, 1, 23, (P) => { // simple shop front
      baseWall(P, 0.9);
      P.wall(0, 4, 128, 20, 0.72); P.fix(12, 8, 104, 12, '#2f3438'); for (let i = 0; i < 6; i++) P.fix(18 + i * 16, 11, 9, 6, '#e8e4d8');
      P.acc(6, 34, 116, 86, 0.9); P.glass(10, 38, 108, 78, { tone: 'dark', curtain: false }); P.acc(62, 38, 3, 78, 0.9);
      P.fix(0, 120, 128, 8, '#6a6d70'); P.lit(10, 38, 108, 78, '#ffe2b0');
    });
    cell(3, 1, 24, (P) => { // garage door
      baseWall(P, 0.88);
      P.acc(10, 30, 108, 98, 0.78); for (let y = 36; y < 126; y += 11) P.shade(10, y, 108, 1.5, 0.3); P.shade(10, 30, 108, 6, 0.3);
      P.wall(6, 24, 116, 6, 0.72);
    });
    cell(4, 1, 25, (P) => { // upper floor: wide window pair with parapet band
      baseWall(P, 0.93);
      P.wall(0, 78, 128, 50, 0.78); P.shade(0, 78, 128, 3, 0.2);
      P.sash(14, 20, 100, 56, { bars: 'v' });
      P.wall(8, 14, 112, 6, 0.74);
      P.shade(0, 0, 128, 5, 0.1);
    });
    cell(5, 1, 26, (P) => { // balcony with perforated panel railing
      baseWall(P, 0.93);
      P.sash(14, 16, 34, 80, { bars: 'h' }); P.sash(54, 40, 60, 40, { bars: 'v' });
      P.wall(0, 96, 128, 7, 0.82); P.shade(0, 103, 128, 8, 0.3);
      P.acc(0, 72, 128, 24, 0.84); for (let x = 3; x < 128; x += 6) P.shade(x, 74, 1.5, 20, 0.28);
      P.shade(0, 0, 128, 7, 0.18);
    });
    cell(6, 1, 27, (P) => { // recessed loggia
      baseWall(P, 0.93);
      P.fix(14, 16, 100, 84, '#464a4e'); P.shade(14, 16, 100, 84, 0.1);
      P.sash(34, 28, 60, 62, { bars: 'v' });
      P.wall(8, 100, 112, 7, 0.8); P.acc(14, 78, 100, 22, 0.8); for (let x = 16; x < 112; x += 7) P.shade(x, 80, 1.5, 18, 0.3);
      P.shade(14, 16, 100, 8, 0.4);
    });
    cell(7, 1, 28, (P) => { // stair-well strip
      baseWall(P, 0.93);
      P.wall(0, 0, 128, 128, 0.9); P.acc(48, 0, 32, 128, 0.9); P.glass(52, 10, 24, 52, { tone: 'blue' }); P.glass(52, 70, 24, 50, { tone: 'blue' }); P.shade(52, 10, 24, 4, 0.3);
    });

    /* ---------------------------------------------------------------- 2 modern residential (2000+) */
    cell(0, 2, 31, (P) => { // entrance: glazed door under a canopy
      baseWall(P, 0.97);
      P.wall(10, 18, 108, 7, 0.8); P.shade(10, 25, 108, 6, 0.3);
      P.acc(28, 30, 70, 98, 0.22); P.glass(32, 34, 28, 94, { tone: 'dark' }); P.glass(64, 34, 30, 94, { tone: 'dark' }); P.acc(61, 34, 3, 94, 0.2);
      P.fix(72, 84, 3, 12, '#b9bcc0'); P.lit(32, 34, 62, 94, '#ffe6b8');
    });
    cell(1, 2, 32, (P) => { // ground floor window above a plinth
      baseWall(P, 0.97);
      P.acc(18, 24, 92, 74, 0.2); P.glass(21, 27, 86, 68, { tone: 'dark' }); P.acc(62, 27, 3, 68, 0.2);
      P.wall(14, 98, 100, 6, 0.8); P.shade(14, 104, 100, 5, 0.3);
    });
    cell(2, 2, 33, (P) => { // modern shop front
      baseWall(P, 0.97);
      P.wall(0, 6, 128, 20, 0.86); P.fix(10, 10, 108, 12, '#2c3034'); for (let i = 0; i < 5; i++) P.fix(18 + i * 20, 13, 12, 6, '#eceae2');
      P.acc(6, 32, 116, 90, 0.2); P.glass(9, 35, 110, 84, { tone: 'dark', curtain: false }); P.acc(63, 35, 2.5, 84, 0.2);
      P.lit(9, 35, 110, 84, '#ffe6b8');
    });
    cell(3, 2, 34, (P) => { // garage door
      baseWall(P, 0.97);
      P.acc(14, 34, 100, 94, 0.5); for (let y = 42; y < 126; y += 12) P.shade(14, y, 100, 1.3, 0.3);
    });
    cell(4, 2, 35, (P) => { // upper floor: tall dark-framed window
      baseWall(P, 0.97);
      P.acc(26, 14, 76, 92, 0.2); P.glass(30, 18, 68, 84, { tone: 'dark' }); P.acc(63, 18, 2.5, 84, 0.2);
      P.shade(30, 18, 68, 5, 0.3); P.wall(24, 106, 80, 5, 0.9); P.shade(24, 111, 80, 3, 0.25);
    });
    cell(5, 2, 36, (P) => { // balcony with glass railing
      baseWall(P, 0.97);
      P.acc(30, 8, 68, 84, 0.2); P.glass(34, 12, 60, 76, { tone: 'dark' }); P.acc(63, 12, 2.5, 76, 0.2);
      P.wall(6, 92, 116, 9, 0.85); P.shade(6, 101, 116, 8, 0.3);
      P.glass(6, 64, 116, 28, { tone: 'light', curtain: false, lit: false }); P.fix(6, 62, 116, 2.4, '#454a50');
    });
    cell(6, 2, 37, (P) => { // window with a dark cladding panel
      baseWall(P, 0.97);
      P.acc(0, 0, 40, 128, 0.42); for (let x = 5; x < 40; x += 7) P.shade(x, 0, 1.2, 128, 0.25);
      P.acc(54, 16, 62, 80, 0.2); P.glass(57, 19, 56, 74, { tone: 'dark' }); P.shade(57, 19, 56, 5, 0.3);
    });
    cell(7, 2, 38, (P) => { // slit window
      baseWall(P, 0.97);
      P.acc(54, 14, 20, 96, 0.2); P.glass(56, 16, 16, 92, { tone: 'dark' });
    });

    /* ---------------------------------------------------------------- 3 house (suburb) */
    cell(0, 3, 41, (P) => { // front door under a small porch
      baseWall(P, 0.96);
      P.wall(30, 26, 70, 6, 0.8); P.shade(30, 32, 70, 8, 0.3);
      P.acc(42, 38, 44, 90, 0.85); P.glass(48, 46, 32, 30, { tone: 'dark', curtain: false }); P.shade(42, 38, 44, 5, 0.3);
      P.rect('fix', '#c8a850', 78, 86, 3, 7); P.rect('fix', '#9a968c', 34, 120, 60, 8);
      P.lit(48, 46, 32, 30, '#ffe0aa');
    });
    cell(1, 3, 42, (P) => { // ground floor window
      baseWall(P, 0.96);
      P.sash(34, 34, 60, 50, { bars: 'cross' }); P.sill(30, 84, 68);
      P.shutter(14, 34, 17, 52); P.shutter(97, 34, 17, 52);
    });
    cell(2, 3, 43, (P) => { // conservatory / large window
      baseWall(P, 0.96);
      P.acc(10, 26, 108, 82, 0.95); P.glass(14, 30, 100, 74, { tone: 'light' }); P.acc(62, 30, 3, 74, 0.95); P.shade(14, 30, 100, 5, 0.3);
    });
    cell(3, 3, 44, (P) => { // garage door
      baseWall(P, 0.96);
      P.acc(8, 30, 112, 98, 0.8); for (let y = 38; y < 126; y += 12) P.shade(8, y, 112, 1.5, 0.28); P.wall(4, 24, 120, 6, 0.8); P.shade(8, 30, 112, 5, 0.3);
    });
    cell(4, 3, 45, (P) => { // upper floor window with sill
      baseWall(P, 0.96);
      P.sash(40, 24, 48, 64, { bars: 'cross' }); P.sill(36, 88, 56);
      P.shutter(22, 24, 15, 66); P.shutter(91, 24, 15, 66);
    });
    cell(5, 3, 46, (P) => { // window with flower box
      baseWall(P, 0.96);
      P.sash(40, 24, 48, 64, { bars: 'cross' }); P.sill(36, 88, 56);
      P.fix(38, 92, 52, 10, '#6a4a32'); for (let i = 0; i < 9; i++) P.fix(40 + i * 5.5, 86 + P.r() * 4, 5, 8, i % 3 ? '#d85a6a' : '#4f8a3c');
    });
    cell(6, 3, 47, (P) => { // wide window
      baseWall(P, 0.96);
      P.sash(24, 28, 80, 56, { bars: 'six' }); P.sill(20, 84, 88);
    });
    cell(7, 3, 48, (P) => { // small window
      baseWall(P, 0.96);
      P.sash(52, 40, 24, 36, { bars: 'h' }); P.sill(48, 76, 32);
    });

    /* ---------------------------------------------------------------- 4 office curtain wall (glass / steel, Kirchberg and Cloche d'Or) */
    const curtain = (P, tone, spandrelShade, fins) => {
      P.wall(0, 0, CELL, CELL, 0.82);
      P.glass(0, 36, CELL, 92, { tone, curtain: false });
      P.wall(0, 0, CELL, 38, spandrelShade); P.shade(0, 0, CELL, 38, 0.12);
      P.acc(0, 34, CELL, 5, 0.75); P.acc(0, 0, 3, CELL, 0.75); P.acc(63, 38, 2.5, 90, 0.75);
      if (fins) { for (let y = 52; y < 128; y += 22) { P.acc(0, y, CELL, 4, 0.9); P.shade(0, y + 4, CELL, 6, 0.3); } }
      P.shade(0, 38, CELL, 3, 0.3);
    };
    cell(0, 4, 51, (P) => { // lobby: revolving door
      P.wall(0, 0, CELL, CELL, 0.82); P.glass(0, 8, CELL, 120, { tone: 'dark', curtain: false }); P.acc(0, 4, 128, 5, 0.75); P.acc(0, 0, 3, 128, 0.75); P.acc(62, 8, 3, 120, 0.75);
      P.fix(38, 52, 52, 76, '#1b2730'); P.acc(38, 52, 52, 4, 0.8); P.acc(62, 52, 3, 76, 0.8); P.lit(0, 8, 128, 120, '#ffe6b8');
    });
    cell(1, 4, 52, (P) => { // lobby glazing
      P.wall(0, 0, CELL, CELL, 0.82); P.glass(0, 8, CELL, 120, { tone: 'blue', curtain: false }); P.acc(0, 4, 128, 5, 0.75); P.acc(0, 0, 3, 128, 0.75); P.acc(62, 8, 3, 120, 0.75); P.acc(0, 54, 128, 3, 0.75);
    });
    cell(2, 4, 53, (P) => { // stone-clad base with window
      P.wall(0, 0, CELL, CELL, 0.86); for (let y = 0; y < 128; y += 32) P.shade(0, y, 128, 1.5, 0.22); P.shade(63, 0, 1.5, 128, 0.2);
      P.glass(34, 30, 60, 54, { tone: 'dark' });
    });
    cell(3, 4, 54, (P) => { // stone base: blank
      P.wall(0, 0, CELL, CELL, 0.86); for (let y = 0; y < 128; y += 32) P.shade(0, y, 128, 1.5, 0.22); P.shade(63, 0, 1.5, 128, 0.2); P.grain(300, 0.04);
    });
    cell(4, 4, 55, (P) => curtain(P, 'blue', 0.86, false));
    cell(5, 4, 56, (P) => curtain(P, 'green', 0.8, false));
    cell(6, 4, 57, (P) => curtain(P, 'dark', 0.84, true));
    cell(7, 4, 58, (P) => { // stone panel with punched window
      P.wall(0, 0, CELL, CELL, 0.92); for (let y = 0; y < 128; y += 64) P.shade(0, y, 128, 1.5, 0.25); P.shade(0, 0, 1.5, 128, 0.2); P.grain(260, 0.04);
      P.acc(24, 22, 80, 80, 0.5); P.glass(28, 26, 72, 72, { tone: 'dark' }); P.shade(28, 26, 72, 6, 0.35); P.shade(28, 26, 5, 72, 0.18);
    });

    /* ---------------------------------------------------------------- 5 commercial / industrial */
    const cladding = (P, s) => { P.wall(0, 0, CELL, CELL, s); for (let x = 0; x < 128; x += 8) { P.shade(x, 0, 1.4, 128, 0.12); P.shine(x + 2, 0, 1.2, 128, 0.05); } P.shade(0, 0, 128, 4, 0.1); };
    cell(0, 5, 61, (P) => { cladding(P, 0.86); P.acc(40, 44, 48, 84, 0.8); P.glass(46, 52, 36, 34, { tone: 'dark' }); P.wall(30, 36, 68, 6, 0.7); P.shade(30, 42, 68, 6, 0.3); });
    cell(1, 5, 62, (P) => { // loading dock roller door
      cladding(P, 0.86); P.acc(18, 26, 92, 102, 0.82); for (let y = 32; y < 126; y += 7) P.shade(18, y, 92, 1.2, 0.3); P.wall(12, 22, 104, 5, 0.7); P.shade(18, 26, 92, 6, 0.3);
    });
    cell(2, 5, 63, (P) => { // retail glazing with fascia
      P.wall(0, 0, CELL, CELL, 0.9); P.wall(0, 8, 128, 24, 0.75); P.acc(8, 12, 112, 16, 0.55);
      P.acc(4, 38, 120, 88, 0.85); P.glass(8, 42, 112, 80, { tone: 'dark', curtain: false }); P.acc(36, 42, 3, 80, 0.85); P.acc(66, 42, 3, 80, 0.85); P.acc(96, 42, 3, 80, 0.85); P.lit(8, 42, 112, 80, '#ffe6b8');
    });
    cell(3, 5, 64, (P) => { // double roller door
      cladding(P, 0.86); P.acc(8, 34, 52, 94, 0.82); P.acc(66, 34, 54, 94, 0.82); for (let y = 40; y < 126; y += 7) { P.shade(8, y, 52, 1.2, 0.3); P.shade(66, y, 54, 1.2, 0.3); }
    });
    cell(4, 5, 65, (P) => { cladding(P, 0.88); P.acc(0, 22, 128, 4, 0.85); P.glass(0, 26, 128, 30, { tone: 'dark' }); for (let x = 32; x < 128; x += 32) P.acc(x, 26, 2.5, 30, 0.85); P.shade(0, 26, 128, 4, 0.3); });
    cell(5, 5, 66, (P) => { // concrete panels
      P.wall(0, 0, CELL, CELL, 0.9); P.shade(0, 0, 128, 2, 0.28); P.shade(0, 0, 2, 128, 0.2); P.shade(0, 64, 128, 1.5, 0.15); P.grain(380, 0.045);
      P.sash(82, 18, 32, 22, { bars: 'v', tone: 'dark' });
    });
    cell(6, 5, 67, (P) => cladding(P, 0.84));
    cell(7, 5, 68, (P) => { cladding(P, 0.86); P.sash(20, 32, 36, 36, { bars: 'cross', tone: 'dark' }); P.sash(72, 32, 36, 36, { bars: 'cross', tone: 'dark' }); });

    /* ---------------------------------------------------------------- 6 institutional (school / hospital / civic) */
    cell(0, 6, 71, (P) => { // entrance with canopy
      baseWall(P, 0.9); P.wall(8, 14, 112, 8, 0.75); P.shade(8, 22, 112, 7, 0.3);
      P.acc(22, 30, 84, 98, 0.78); P.glass(26, 34, 36, 94, { tone: 'dark' }); P.glass(66, 34, 36, 94, { tone: 'dark' }); P.acc(63, 34, 3, 94, 0.78); P.lit(26, 34, 76, 94, '#ffe6b8');
    });
    cell(1, 6, 72, (P) => { baseWall(P, 0.9); P.wall(0, 0, 128, 14, 0.8); P.sash(24, 30, 80, 60, { bars: 'six', tone: 'blue' }); P.sill(20, 90, 88); });
    cell(2, 6, 73, (P) => { P.wall(0, 0, CELL, CELL, 0.86); P.glass(8, 12, 112, 108, { tone: 'dark' }); for (let x = 36; x < 120; x += 28) P.acc(x, 12, 3, 108, 0.7); P.acc(8, 60, 112, 3, 0.7); P.lit(8, 12, 112, 108, '#ffe6b8'); });
    cell(3, 6, 74, (P) => { baseWall(P, 0.88); P.wall(0, 0, 128, 128, 0.88); P.grain(300, 0.045); P.shade(0, 0, 128, 3, 0.15); });
    cell(4, 6, 75, (P) => { // vertical window pair between concrete mullions
      baseWall(P, 0.9);
      P.wall(0, 0, 128, 128, 0.92); P.sash(16, 14, 40, 84, { bars: 'h', tone: 'blue' }); P.sash(72, 14, 40, 84, { bars: 'h', tone: 'blue' });
      P.wall(60, 0, 8, 128, 0.82); P.shade(0, 0, 128, 3, 0.14); P.sill(12, 98, 48); P.sill(68, 98, 48);
    });
    cell(5, 6, 76, (P) => { baseWall(P, 0.9); P.sash(24, 18, 80, 76, { bars: 'six', tone: 'blue' }); P.sill(20, 94, 88); });
    cell(6, 6, 77, (P) => { P.wall(0, 0, CELL, CELL, 0.88); P.glass(0, 20, 128, 70, { tone: 'dark' }); for (let x = 32; x < 128; x += 32) P.acc(x, 20, 3, 70, 0.75); P.wall(0, 90, 128, 38, 0.82); P.shade(0, 20, 128, 4, 0.3); });
    cell(7, 6, 78, (P) => { baseWall(P, 0.9); P.sash(40, 22, 48, 66, { bars: 'cross', tone: 'blue' }); P.sill(36, 88, 56); });

    /* ---------------------------------------------------------------- 7 specials */
    cell(0, 7, 81, (P) => { // dormer front (the window of a dormer: the frame is painted over the dormer's grey zinc cheek colour)
      P.fix(0, 0, CELL, CELL, '#cfd1cf'); P.fix(0, 0, CELL, 14, '#8d9296');
      P.sash(24, 22, 80, 100, { bars: 'cross', tone: 'blue' });
    });
    cell(1, 7, 82, (P) => { // church lancet window between buttresses
      P.wall(0, 0, CELL, CELL, 0.9); P.grain(300, 0.05);
      P.wall(0, 0, 12, 128, 0.78); P.wall(116, 0, 12, 128, 0.78);
      P.path('glass', '#2d4254', (g) => { g.moveTo(40, 128); g.lineTo(40, 44); g.quadraticCurveTo(64, -12, 88, 44); g.lineTo(88, 128); });
      P.path('wall', 1.0, (g) => { g.moveTo(34, 128); g.lineTo(34, 42); g.quadraticCurveTo(64, -22, 94, 42); g.lineTo(88, 42); g.quadraticCurveTo(64, -10, 40, 44); g.lineTo(40, 128); });
      P.acc(62, 20, 3, 108, 0.6); P.shade(40, 40, 48, 4, 0.2);
      P.path('glass', '#2d4254', (g) => { g.rect(40, 70, 48, 4); });
      P.lit(40, 44, 48, 84, '#ffcf7a');
    });
    cell(2, 7, 83, (P) => { // church: plain stone with a small window
      P.wall(0, 0, CELL, CELL, 0.9); P.grain(380, 0.05); for (let y = 0; y < 128; y += 21) P.shade(0, y, 128, 1.2, 0.14);
      P.glass(52, 40, 24, 44, { tone: 'dark' });
    });
    cell(3, 7, 84, (P) => { // church: portal
      P.wall(0, 0, CELL, CELL, 0.92); P.grain(300, 0.05);
      P.path('wall', 1.0, (g) => { g.moveTo(28, 128); g.lineTo(28, 50); g.quadraticCurveTo(64, -14, 100, 50); g.lineTo(100, 128); });
      P.path('acc', 0.7, (g) => { g.moveTo(38, 128); g.lineTo(38, 54); g.quadraticCurveTo(64, 14, 90, 54); g.lineTo(90, 128); }); P.acc(62, 40, 3, 88, 0.45);
    });
    for (let c = 4; c < 8; c++) cell(c, 7, 90 + c, (P) => { P.wall(0, 0, CELL, CELL, 0.9); P.grain(300, 0.05); });

    // per typology average colour (far fade) and wall share
    const avg = [];
    const dImg = gD.getImageData(0, 0, cD.width, cD.height).data;
    const mImg = gM.getImageData(0, 0, cM.width, cM.height).data;
    for (let row = 0; row < ROWS; row++) {
      let r = 0; let g = 0; let b = 0; let n = 0; let mr = 0; let nm = 0;
      for (let col = 4; col < 8; col++) {            // upper floor cells
        for (let y = 0; y < CELL; y += 4) for (let x = 0; x < CELL; x += 4) {
          const i = ((row * CELL + y) * cD.width + col * CELL + x) * 4;
          r += dImg[i]; g += dImg[i + 1]; b += dImg[i + 2]; n++;
          const j = (((row * CELL + y) >> 1) * cM.width + ((col * CELL + x) >> 1)) * 4;
          mr += mImg[j] / 255; nm++;
        }
      }
      avg.push([r / n / 255, g / n / 255, b / n / 255, mr / Math.max(nm, 1)]);
    }
    return { cD, cM, cL, avg };
  }

  /* ============================================================ material: facade + roof shader (Lambert + onBeforeCompile)
   * per vertex  aTex  = (u [bays] | roof: metres along the contour, h [m above the wall base] | roof: metres down the slope, typology (0-7) | 90+ special | 100+ roof material, accent + seed)
   *             aTex2 = (floor height, ground floor height, number of upper storeys under the eaves, mode bits)
   * mode bits: gMode (2 bits: 0 dwelling, 1 shop front, 2 blank) + 4 * shop type (3 bits) + 32 * blind + 64 * awning accent (4 bits) + 1024 * overlay (0 plaster, 1 brick, 2 ashlar) */
  const SHADER_KEY = 'lt-facade-v2';
  function makeMaterial(T, atlasTex, quality) {
    const mat = new T.MeshLambertMaterial({ side: T.DoubleSide, vertexColors: true, emissive: new T.Color('#ffffff'), emissiveIntensity: 0 });
    const accC = ACCENTS.map((h) => { const c = new T.Color(h); return new T.Vector3(c.r, c.g, c.b); });
    const uniforms = {
      uAtlas: { value: atlasTex.day }, uMask: { value: atlasTex.mask }, uAtlasLit: { value: atlasTex.lit },
      uNight: { value: 0 }, uAcc: { value: accC }, uAvg: { value: atlasTex.avg.map((a) => new T.Vector4(a[0], a[1], a[2], a[3])) }, uBay: { value: BAY.slice() },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTex;\nattribute vec4 aTex2;\nvarying vec4 vTex;\nvarying vec4 vTex2;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTex = aTex;\nvTex2 = aTex2;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying vec4 vTex;', 'varying vec4 vTex2;',
          'uniform sampler2D uAtlas; uniform sampler2D uMask; uniform sampler2D uAtlasLit;',
          'uniform float uNight; uniform vec3 uAcc[16]; uniform vec4 uAvg[8]; uniform float uBay[8];',
          'vec3 gLitC = vec3(0.0);',
          'float lhash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
          'float lnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
          '  return mix(mix(lhash(i), lhash(i + vec2(1.0, 0.0)), f.x), mix(lhash(i + vec2(0.0, 1.0)), lhash(i + vec2(1.0, 1.0)), f.x), f.y); }',
        ].join('\n'))
        .replace('#include <color_fragment>', FRAG_BODY)
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= gLitC * uNight * 0.8;');
    };
    mat.customProgramCacheKey = () => SHADER_KEY + quality;
    return { mat, uniforms };
  }

  const FRAG_BODY = `
  {
    float typ = vTex.z;
    vec3 tint = vColor.rgb;
    vec3 alb = tint;
    float seedW = vTex.w; float accI = floor(seedW); float seed = fract(seedW);
    if (typ > 99.5) {
      // ------------------------------------------------ roofs
      float mt = typ - 100.0;
      vec2 q = vTex.xy;
      float fwm = max(length(dFdx(q)), length(dFdy(q)));
      float pat = 1.0;
      if (mt < 2.5) {              // 0 slate, 1 clay tile, 2 concrete tile
        float rowH = mt < 0.5 ? 0.25 : 0.34;
        float colW = mt < 0.5 ? 0.19 : 0.22;
        float r = q.y / rowH; float ri = floor(r);
        float cc = q.x / colW + (mt < 0.5 ? 0.5 * mod(ri, 2.0) : 0.0); float ci = floor(cc);
        vec2 f = vec2(fract(cc), fract(r));
        float h = lhash(vec2(ci, ri) + seed * 71.0);
        if (mt < 0.5) {
          float gap = 0.74 + 0.26 * smoothstep(0.0, 0.16, f.y);
          float side = 0.86 + 0.14 * smoothstep(0.0, 0.07, min(f.x, 1.0 - f.x));
          pat = (0.76 + 0.36 * h) * gap * side;
        } else {
          float groove = 0.84 + 0.16 * smoothstep(0.0, 0.35, abs(f.x - 0.5) * 2.0);
          float lip = 0.74 + 0.26 * smoothstep(0.0, 0.2, f.y);
          pat = (mt < 1.5 ? 0.74 + 0.34 * h : 0.84 + 0.2 * h) * lip * groove;
        }
        pat = mix(0.86, pat, 1.0 - smoothstep(0.1, 0.5, fwm / rowH));
      } else if (mt < 3.5) {       // 3 zinc / metal standing seam
        float sx = q.x / 0.6; float fx = fract(sx);
        float seam = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.05, min(fx, 1.0 - fx)));
        pat = seam * (0.93 + 0.1 * lhash(vec2(floor(sx), seed * 31.0)));
        pat = mix(0.95, pat, 1.0 - smoothstep(0.08, 0.35, fwm / 0.6));
      } else if (mt < 4.5) {       // 4 gravel
        float g1 = lhash(floor(q * 9.0) + seed * 17.0);
        float g2 = lnoise(q * 1.3 + seed * 40.0);
        pat = (0.84 + 0.2 * g1) * (0.88 + 0.22 * g2);
        pat = mix(0.95, pat, 1.0 - smoothstep(0.05, 0.25, fwm / 0.11));
      } else if (mt < 5.5) {       // 5 dark membrane with seams
        float sx = q.x / 1.0; float fx = fract(sx);
        pat = (1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.03, min(fx, 1.0 - fx)))) * (0.92 + 0.12 * lnoise(q * 0.6 + seed * 20.0));
        pat = mix(0.95, pat, 1.0 - smoothstep(0.06, 0.3, fwm / 1.0));
      } else if (mt < 6.5) {       // 6 light concrete / ceramic with slab joints
        vec2 sg = q / 0.6; vec2 fg = fract(sg);
        pat = (1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.04, min(min(fg.x, 1.0 - fg.x), min(fg.y, 1.0 - fg.y))))) * (0.94 + 0.1 * lhash(floor(sg) + seed * 9.0));
        pat = mix(0.95, pat, 1.0 - smoothstep(0.06, 0.3, fwm / 0.6));
      } else if (mt < 7.5) {       // 7 green roof (sedum)
        pat = (0.76 + 0.34 * lnoise(q * 2.2 + seed * 11.0)) * (0.86 + 0.2 * lhash(floor(q * 6.0)));
        pat = mix(0.95, pat, 1.0 - smoothstep(0.05, 0.3, fwm / 0.16));
      } else {                     // 8 copper
        float sx = q.x / 0.5; float fx = fract(sx);
        pat = (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.05, min(fx, 1.0 - fx)))) * (0.8 + 0.4 * lnoise(q * 0.7 + seed * 5.0));
        pat = mix(0.95, pat, 1.0 - smoothstep(0.08, 0.35, fwm / 0.5));
      }
      pat *= 0.9 + 0.2 * lnoise(q * 0.22 + seed * 63.0);   // weathering patches
      alb = tint * pat;
    } else if (typ > 89.5) {
      // ------------------------------------------------ plain things: cornices, parapets, rooftop boxes, chimneys, dormer cheeks, dormer fronts
      vec2 q = vTex.xy;
      float sp = typ - 90.0;
      if (sp < 0.5) {            // plain render / concrete
        alb = tint * (0.93 + 0.12 * lnoise(q * 1.7 + seed * 30.0));
      } else if (sp < 1.5) {     // dormer front: window cell (7, 0)
        vec2 atl = vec2(q.x * 0.125, 1.0 - (7.0 + 1.0 - q.y) / 8.0);
        vec2 gx = dFdx(q) * 0.125; vec2 gy2 = dFdy(q) * 0.125;
        float L = max(length(gx), length(gy2)); float k = min(1.0, 0.03 / max(L, 1e-6)); gx *= k; gy2 *= k;
        vec3 dc = textureGrad(uAtlas, atl, gx, gy2).rgb; vec3 mk = textureGrad(uMask, atl, gx, gy2).rgb;
        vec3 acc = uAcc[int(accI)];
        alb = dc * (vec3(1.0) * (1.0 - mk.r - mk.g) + tint * mk.r + acc * mk.g);
        gLitC = textureGrad(uAtlasLit, atl, gx, gy2).rgb * step(lhash(vec2(seed * 91.0, 3.1)), 0.4) * vec3(1.0, 0.85, 0.6);
      } else if (sp < 2.5) {     // brick (chimneys)
        vec2 bq = vec2(q.x / 0.22 + 0.5 * mod(floor(q.y / 0.075), 2.0), q.y / 0.075);
        vec2 f = fract(bq);
        float mortar = smoothstep(0.0, 0.1, f.x) * smoothstep(0.0, 0.14, f.y);
        float h = lhash(floor(bq) + seed * 13.0);
        float fine = mix(0.8, 1.0, mortar);
        alb = tint * (0.75 + 0.5 * h) * mix(0.9, fine, 1.0 - smoothstep(0.03, 0.12, max(length(dFdx(q)), length(dFdy(q)))));
      } else {                   // metal cap / flashing
        alb = tint;
      }
    } else {
      // ------------------------------------------------ facades
      float md = vTex2.w;
      float gMode = mod(md, 4.0);
      float shopT = mod(floor(md / 4.0), 8.0);
      float blind = mod(floor(md / 32.0), 2.0);
      float awnI = mod(floor(md / 64.0), 16.0);
      float ovl = floor(md / 1024.0);
      float floorH = vTex2.x; float groundH = vTex2.y; float nUp = vTex2.z;
      float hh = vTex.y; float bayU = vTex.x;
      float typR = floor(typ + 0.5);
      float inG = hh < groundH ? 1.0 : 0.0;
      float rowH = inG > 0.5 ? groundH : floorH;
      float fUp = (hh - groundH) / floorH;
      float fi = floor(fUp);
      float rowY = inG > 0.5 ? clamp(hh / groundH, 0.0, 1.0) : fract(fUp);
      float bx = floor(bayU);
      float shopRow = (inG > 0.5 && gMode > 0.5 && gMode < 1.5) ? 1.0 : 0.0;
      bool plain = blind > 0.5 || gMode > 1.5 && inG > 0.5 || (inG < 0.5 && fi > nUp - 0.5) || hh < -0.5;
      vec3 dc = vec3(1.0); vec3 mk = vec3(1.0, 0.0, 0.0);
      float fade = 0.0;
      if (!plain) {
        float rc = lhash(vec2(bx, seed * 97.3));
        float cellIx;
        if (inG > 0.5) {
          if (typR > 6.5) cellIx = mod(bx, 2.0) < 0.5 ? 1.0 : 2.0;
          else if (gMode > 0.5) cellIx = mod(bx + floor(seed * 3.0), 3.0) < 0.5 ? 3.0 : 2.0;
          else cellIx = mod(bx + floor(seed * 4.0), 4.0) < 0.5 ? 0.0 : 1.0;
        } else {
          if (typR > 6.5) cellIx = 1.0;
          else {
            float rf = lhash(vec2(bx * 0.37 + fi * 1.9, seed * 13.7));
            float v = fi < 0.5 && typR < 0.5 ? mix(rc, rf, 0.4) : rc;
            cellIx = 4.0 + (v < 0.62 ? 0.0 : (v < 0.82 ? 1.0 : (v < 0.94 ? 2.0 : 3.0)));
            if (typR > 3.5 && typR < 4.5) cellIx = rc < 0.9 ? 4.0 + floor(seed * 3.0) : (rc < 0.96 ? 7.0 : 4.0);
          }
        }
        vec2 atl = vec2((cellIx + fract(bayU)) * 0.125, 1.0 - (typR + 1.0 - rowY) * 0.125);
        vec2 gx = vec2(dFdx(bayU), dFdx(hh) / rowH) * 0.125;
        vec2 gy2 = vec2(dFdy(bayU), dFdy(hh) / rowH) * 0.125;
        float L = max(length(gx), length(gy2));
        float k = min(1.0, 0.03 / max(L, 1e-6)); gx *= k; gy2 *= k;
        fade = smoothstep(0.011, 0.03, L);
        dc = textureGrad(uAtlas, atl, gx, gy2).rgb;
        mk = textureGrad(uMask, atl, gx, gy2).rgb;
        vec3 lc = uNight > 0.001 ? textureGrad(uAtlasLit, atl, gx, gy2).rgb : vec3(0.0);
        float lt = lhash(vec2(bx * 1.7 + seed * 13.0, fi + 4.1 + inG * 7.0));
        float thr = shopRow > 0.5 ? 0.92 : (typR > 3.5 && typR < 4.5 ? 0.5 : 0.42);
        float warm = step(0.82, lhash(vec2(bx + 3.0, fi * 2.0 + seed * 9.0)));
        gLitC = lc * step(lt, thr) * mix(vec3(1.0, 0.84, 0.58), vec3(0.78, 0.9, 1.0), warm) * (0.8 + 0.4 * lhash(vec2(bx, fi + 9.0)));
        // glass varies a little from window to window
        dc *= 1.0 + mk.b * (lhash(vec2(bx * 3.1 + 0.7, fi + seed * 5.0)) - 0.5) * 0.35;
      }
      vec3 acc = uAcc[int(shopRow > 0.5 ? awnI : accI)];
      float mw = clamp(mk.r, 0.0, 1.0); float ma = clamp(mk.g, 0.0, 1.0 - mw);
      alb = dc * (vec3(1.0) * max(0.0, 1.0 - mw - ma) + tint * mw + acc * ma);
      // wall surface overlays (only where the wall colour shows)
      float bay = uBay[int(typR)];
      float xm = bayU * bay;
      if (ovl > 0.5 && ovl < 1.5) {               // brick
        vec2 bq = vec2(xm / 0.215 + 0.5 * mod(floor(hh / 0.0725), 2.0), hh / 0.0725);
        vec2 f = fract(bq);
        float mortar = smoothstep(0.0, 0.1, f.x) * smoothstep(0.0, 0.16, f.y);
        float h = lhash(floor(bq) + seed * 7.0);
        float det = 1.0 - smoothstep(0.02, 0.09, max(length(dFdx(vec2(xm, hh))), length(dFdy(vec2(xm, hh)))));
        alb *= mix(1.0, (0.82 + 0.3 * h) * mix(0.82, 1.0, mortar), mw * det);
      } else if (ovl > 1.5 && (hh < groundH + 0.2 || plain)) {   // ashlar blocks on the ground floor
        vec2 bq = vec2(xm / 0.7 + 0.5 * mod(floor(hh / 0.38), 2.0), hh / 0.38);
        vec2 f = fract(bq);
        float joint = smoothstep(0.0, 0.05, f.x) * smoothstep(0.0, 0.07, f.y);
        float h = lhash(floor(bq) + seed * 3.0);
        float det = 1.0 - smoothstep(0.05, 0.25, max(length(dFdx(vec2(xm, hh))), length(dFdy(vec2(xm, hh)))));
        alb *= mix(1.0, (0.9 + 0.14 * h) * mix(0.8, 1.0, joint), mw * det * step(hh, groundH + 0.2));
      }
      // string course between the ground floor and the first floor, cornice band under the eaves (historic and institutional)
      float eaveH = groundH + nUp * floorH;
      if (typR < 0.5 || typR > 5.5) {
        float sc = smoothstep(0.0, 0.05, abs(hh - groundH) - 0.1);
        alb *= mix(1.1, 1.0, sc) * mix(1.0, 1.0, 1.0);
        float cb = 1.0 - smoothstep(0.0, 0.05, abs(hh - eaveH + 0.18) - 0.16);
        alb = mix(alb, tint * 1.04, cb * mw * step(0.5, nUp + 0.5));
      }
      // weathering: dirt towards the ground, faint streaks and plaster mottling
      float dirt = mix(0.74, 1.0, smoothstep(-0.2, 1.7, hh));
      float mott = 0.94 + 0.1 * lnoise(vec2(xm * 0.8, hh * 0.45) + seed * 40.0);
      alb *= mix(1.0, dirt * mott, 0.9);
      // plinth
      alb *= mix(1.0, 0.72, (1.0 - smoothstep(0.0, 0.06, abs(hh - 0.25) - 0.25)) * step(0.0, hh + 0.5));
      // far away: fade the cell pattern into the typology's average colour
      vec4 av = uAvg[int(typR)];
      vec3 avgC = av.rgb * mix(vec3(1.0), tint, av.a) * (mix(0.74, 1.0, smoothstep(-0.2, 1.7, hh)));
      alb = mix(alb, avgC, fade);
    }
    diffuseColor.rgb = alb;
  }`;

  /* ============================================================ tile data (bf/<i>_<j>.bin, scripts/build_luxtram_facades.py) */
  const SUBN = ['', 'yes', 'apartments', 'residential', 'house', 'detached', 'terrace', 'semidetached_house', 'dormitory', 'office', 'commercial', 'retail',
    'supermarket', 'hotel', 'public', 'civic', 'government', 'school', 'kindergarten', 'university', 'college', 'hospital', 'museum', 'church',
    'chapel', 'cathedral', 'garage', 'garages', 'roof', 'shed', 'carport', 'service', 'industrial', 'warehouse', 'parking', 'train_station',
    'stadium', 'sports_hall', 'sports_centre', 'theatre', 'cinema', 'construction', 'greenhouse', 'container', 'kiosk', 'tower', 'mall'];
  const S = {}; SUBN.forEach((n, i) => { S[n] = i; });
  const inSet = (v, names) => names.some((n) => S[n] === v);
  const SUB_HOUSE = ['house', 'detached', 'semidetached_house'];
  const SUB_SMALL = ['garage', 'garages', 'roof', 'shed', 'carport', 'service', 'parking', 'greenhouse', 'container', 'kiosk', 'construction'];
  const SUB_INST = ['public', 'civic', 'government', 'school', 'kindergarten', 'university', 'college', 'hospital', 'museum', 'theatre', 'sports_hall', 'sports_centre', 'train_station', 'stadium'];
  const SUB_CHURCH = ['church', 'chapel', 'cathedral'];
  const SUB_INDUSTRIAL = ['industrial', 'warehouse'];
  const SUB_COMM = ['commercial', 'retail', 'supermarket', 'cinema', 'mall'];

  function parseTile(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint16(0, true);
    let p = 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const kind = dv.getUint8(p); const levels = dv.getUint8(p + 1); const flags = dv.getUint8(p + 2);
      const roof = (flags & 1) ? (dv.getUint8(p + 3) << 16 | dv.getUint8(p + 4) << 8 | dv.getUint8(p + 5)) : -1;
      const wall = (flags & 2) ? (dv.getUint8(p + 6) << 16 | dv.getUint8(p + 7) << 8 | dv.getUint8(p + 8)) : -1;
      const sub = dv.getUint8(p + 9); const roofLevels = dv.getUint8(p + 10); const shape = dv.getUint8(p + 11); const rmat = dv.getUint8(p + 12); const shops = dv.getUint8(p + 13);
      const ax = dv.getInt32(p + 15, true); const az = dv.getInt32(p + 19, true); const ay = dv.getInt32(p + 23, true);
      const nv = dv.getUint16(p + 27, true); const nR = dv.getUint16(p + 29, true); const nW = dv.getUint16(p + 31, true); const nB = dv.getUint16(p + 33, true);
      const nRR = dv.getUint16(p + 35, true); const nWR = dv.getUint16(p + 37, true);
      p += 39;
      const V = new Int16Array(nv * 3); for (let k = 0; k < nv * 3; k++) V[k] = dv.getInt16(p + k * 2, true); p += nv * 6;
      const R = new Uint16Array(nR * 3); for (let k = 0; k < nR * 3; k++) R[k] = dv.getUint16(p + k * 2, true); p += nR * 6;
      const W = new Uint16Array(nW * 3); for (let k = 0; k < nW * 3; k++) W[k] = dv.getUint16(p + k * 2, true); p += nW * 6;
      const B = new Uint16Array(nB); for (let k = 0; k < nB; k++) B[k] = dv.getUint16(p + k * 2, true); p += nB * 2;
      const rr = new Uint16Array(nRR); for (let k = 0; k < nRR; k++) rr[k] = dv.getUint16(p + k * 2, true); p += nRR * 2;
      const wr = new Uint16Array(nWR); for (let k = 0; k < nWR; k++) wr[k] = dv.getUint16(p + k * 2, true); p += nWR * 2;
      const wi = new Uint8Array(buf, p, nWR).slice(); p += nWR;
      out.push({ kind, levels, roof, wall, sub, roofLevels, shape, rmat, shops, ax, az, ay, nv, V, nR, R, nW, W, B, rr, wr, wi });
    }
    return out;
  }

  /* ============================================================ typology + colours */
  const hexA = (T, hex) => { const k = new T.Color(hex); return [k.r, k.g, k.b]; };
  function makePalettes(T) {
    const P = (list) => list.map((h) => hexA(T, h));
    return {
      wall: [
        P(['#ebe0c6', '#e7d7b4', '#ddcba6', '#e9d5c0', '#d8d0c0', '#f0eada', '#cfc1a1', '#dac38d', '#e3d0a9', '#cbb998', '#dfc6b0', '#d9d3c6', '#e8cf9b', '#c9a98a']),   // historic (render + yellow sandstone)
        P(['#d6d4ce', '#cbc8bf', '#d9d4c4', '#c0c4c5', '#d0c7b4', '#dfdcd3', '#bab6ac', '#c9bba1', '#d4cfc4', '#e0dcd0', '#b9a58c']),                                       // post-war
        P(['#f0eee8', '#e5e3dc', '#d6d8d8', '#ece7dd', '#caccca', '#f3f1ec', '#dedbd3', '#c6c3bb', '#eadfce']),                                                              // modern
        P(['#f0e7d5', '#e9ddc3', '#f1ece1', '#e3d0bc', '#dad3c1', '#f4f0e7', '#e6dec9', '#d9ccb2', '#efe1c8', '#e8d9d0', '#f2ede2']),                                       // house
        P(['#d2d6d8', '#c6cbce', '#b9bec1', '#dad5c8', '#cfd2d2']),                                                                                                           // office
        P(['#cbcccd', '#b9bdbf', '#d8dada', '#abb0b2', '#d0c9b9', '#c3c9cf']),                                                                                                // industrial
        P(['#d9d3c2', '#cac5b7', '#d2d1cc', '#c9bda6', '#e1ddce', '#cdc7b8']),                                                                                                // institutional
        P(['#d6c9ab', '#cbbe9f', '#c0b59c']),                                                                                                                                 // church
      ],
      bright: P(['#d9894e', '#e3c04a', '#dba8b0', '#e2b48a', '#d6b84c', '#e8a070', '#cfd7a6', '#c9a9c0']),
      dark: P(['#8d7b6d', '#7f6e62', '#757b82', '#a09282']),
      brick: P(['#a65a45', '#9a5240', '#b3694f', '#8f4c3a', '#a9654c']),
      slate: P(['#626972', '#596069', '#6c737c', '#555c65', '#666d76']),
      clay: P(['#8f4b36', '#7f4130', '#9b563a', '#74392c', '#a45f40']),
      conc: P(['#5e6064', '#4d5054', '#6b5b54', '#585b60', '#706a66']),
      zinc: P(['#8b9297', '#7d8489', '#979da1']),
      gravel: P(['#aaa9a3', '#9a9994', '#b6b3aa', '#a2a19c']),
      membrane: P(['#6c7073', '#7a7e80', '#62666a']),
      light: P(['#cfcdc5', '#dcd9d0', '#c4c5c3']),
      green: P(['#607d44', '#546f3d']),
      copper: P(['#4e8f7d', '#5a9886', '#437f6e']),
      brickRoof: P(['#8d4a39']),
      plain: P(['#9a978f', '#88857e']),
    };
  }

  /* districts of the line by position in the local frame (x east, z south, metres; LAT0/LON0 origin) */
  const D = { AIRPORT: 0, KIRCHBERG: 1, LIMPERTSBERG: 2, VILLE: 3, GARE: 4, BONNEVOIE: 5, HOWALD: 6 };
  function districtAt(lx, lz) {
    if (lx > 2200) return D.AIRPORT;
    if (lx > -2050 && lz < -1250) return D.KIRCHBERG;
    if (lz < -1000) return D.LIMPERTSBERG;
    if (lz < 230) return D.VILLE;
    if (lz < 1300) return D.GARE;
    if (lz < 2450) return D.BONNEVOIE;
    return D.HOWALD;
  }
  const OLD_TOWN = [D.VILLE, D.GARE, D.LIMPERTSBERG, D.BONNEVOIE];
  const HIST_BASE = [0, 0.05, 0.72, 0.9, 0.86, 0.55, 0.12];
  const MODERN_BASE = [0.3, 0.8, 0.3, 0.3, 0.3, 0.35, 0.65];

  /* ============================================================ the factory */
  let atlasCache = null;
  function atlasTextures(T) {
    if (atlasCache) return atlasCache;
    const a = paintAtlas();
    const mkTex = (c, srgb) => { const t = new T.CanvasTexture(c); t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.needsUpdate = true; return t; };
    atlasCache = { day: mkTex(a.cD, true), mask: mkTex(a.cM, false), lit: mkTex(a.cL, true), avg: a.avg, canvases: a };
    return atlasCache;
  }

  FX.paintAtlas = paintAtlas;
  FX.districtAt = districtAt;

  FX.create = function create(ctx) {
    const T = ctx.T;
    const ox = ctx.ox; const oz = ctx.oz; const oy = ctx.oy;
    const quality = ctx.quality || 'medium';
    const detail = quality === 'low' ? 0 : quality === 'medium' ? 1 : 2;     // 0: no roof furniture, 1: chimneys + dormers, 2: + rooftop plant
    const pal = makePalettes(T);
    const { mat: matWall, uniforms } = makeMaterial(T, atlasTextures(T), quality);
    const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];
    const stats = { ms: 0, maxMs: 0, tiles: 0, buildings: 0, tris: 0, dormers: 0, chimneys: 0, skipped: 0, byTyp: [0, 0, 0, 0, 0, 0, 0, 0] };

    /* ------------------------------------------------ vertex accumulator */
    class Acc {
      constructor() { this.p = []; this.n = []; this.c = []; this.t1 = []; this.t2 = []; this.k = 0; }
      // non-indexed triangles with one flat normal each: every third vertex re-winds the triangle so that it faces along its normal
      // (the material is double sided and flips the normal of back faces: LOD2 polygons come in arbitrary winding)
      vert(x, y, z, nx, ny, nz, col, a, b, c, d, e, f, g, h) {
        this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]);
        this.t1.push(a, b, c, d); this.t2.push(e, f, g, h);
        if (++this.k === 3) { this.k = 0; this.orient(nx, ny, nz); }
      }
      orient(nx, ny, nz) {
        const p = this.p; const o = p.length - 9;
        const ax = p[o + 3] - p[o]; const ay = p[o + 4] - p[o + 1]; const az = p[o + 5] - p[o + 2];
        const bx = p[o + 6] - p[o]; const by = p[o + 7] - p[o + 1]; const bz = p[o + 8] - p[o + 2];
        if ((ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz >= 0) return;
        const sw = (arr, stride) => { const i = arr.length - 3 * stride; for (let q = 0; q < stride; q++) { const t = arr[i + stride + q]; arr[i + stride + q] = arr[i + 2 * stride + q]; arr[i + 2 * stride + q] = t; } };
        sw(this.p, 3); sw(this.n, 3); sw(this.c, 3); sw(this.t1, 4); sw(this.t2, 4);
      }
      get empty() { return this.p.length === 0; }
      mesh(o) {
        if (this.empty) return null;
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
        g.setAttribute('aTex', new T.Float32BufferAttribute(this.t1, 4));
        g.setAttribute('aTex2', new T.Float32BufferAttribute(this.t2, 4));
        g.computeBoundingSphere();
        const m = new T.Mesh(g, matWall);
        m.castShadow = !!(o && o.cast); m.receiveShadow = true;
        return m;
      }
    }

    /* ------------------------------------------------ small geometry helpers (scene coordinates) */
    // plain-material triangle: typ 90 (plain) / 92 (brick) / 93 (metal), uv in metres
    const plainTri = (acc, a, b, c, n, col, typ, seedW) => {
      acc.vert(a[0], a[1], a[2], n[0], n[1], n[2], col, a[0] * 0.5, a[1] * 0.5, typ, seedW, 0, 0, 0, 0);
      acc.vert(b[0], b[1], b[2], n[0], n[1], n[2], col, b[0] * 0.5, b[1] * 0.5, typ, seedW, 0, 0, 0, 0);
      acc.vert(c[0], c[1], c[2], n[0], n[1], n[2], col, c[0] * 0.5, c[1] * 0.5, typ, seedW, 0, 0, 0, 0);
    };
    const plainQuad = (acc, a, b, c, d, n, col, typ, seedW) => { plainTri(acc, a, b, c, n, col, typ, seedW); plainTri(acc, a, c, d, n, col, typ, seedW); };
    // upright box with a base polygon (centre cx, cz; size sx, sz; yaw), bottom y0, top y1; sides use `sideTyp`, top is plain
    function addBox(acc, cx, cz, sx, sz, yaw, y0, y1, col, sideTyp, seedW, topCol) {
      const c = Math.cos(yaw); const s = Math.sin(yaw);
      const hx = sx / 2; const hz = sz / 2;
      const P = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map((q) => [cx + q[0] * c - q[1] * s, cz + q[0] * s + q[1] * c]);
      for (let i = 0; i < 4; i++) {
        const a = P[i]; const b = P[(i + 1) % 4];
        const dx = b[0] - a[0]; const dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1;
        const n = [dz / l, 0, -dx / l];
        const A = [a[0], y0, a[1]]; const B = [b[0], y0, b[1]]; const Cc = [b[0], y1, b[1]]; const Dd = [a[0], y1, a[1]];
        // uv in metres along the side
        const w = l;
        const h = y1 - y0;
        const vv = (p, u, v) => acc.vert(p[0], p[1], p[2], n[0], n[1], n[2], col, u, v, sideTyp, seedW, 0, 0, 0, 0);
        vv(A, 0, 0); vv(B, w, 0); vv(Cc, w, h); vv(A, 0, 0); vv(Cc, w, h); vv(Dd, 0, h);
      }
      const tc = topCol || col;
      plainQuad(acc, [P[0][0], y1, P[0][1]], [P[1][0], y1, P[1][1]], [P[2][0], y1, P[2][1]], [P[3][0], y1, P[3][1]], [0, 1, 0], tc, 90, seedW);
    }

    /* ------------------------------------------------ classification */
    function roofStatsOf(b, px, py, pz) {
      // per roof ring: area, normal; building: flat fraction, steep fraction
      const rings = [];
      let off = 0;
      let tot = 0; let flat = 0; let steep = 0; let pitched = 0;
      for (let r = 0; r < b.rr.length; r++) {
        const cnt = b.rr[r];
        let nx = 0; let ny = 0; let nz = 0; let area = 0;
        for (let k = off; k < off + cnt; k++) {
          const i0 = b.R[k * 3]; const i1 = b.R[k * 3 + 1]; const i2 = b.R[k * 3 + 2];
          const ax = px[i1] - px[i0]; const ay = py[i1] - py[i0]; const az = pz[i1] - pz[i0];
          const bx = px[i2] - px[i0]; const by = py[i2] - py[i0]; const bz = pz[i2] - pz[i0];
          let cx = ay * bz - az * by; let cy = az * bx - ax * bz; let cz = ax * by - ay * bx;
          if (cy < 0) { cx = -cx; cy = -cy; cz = -cz; }
          nx += cx; ny += cy; nz += cz;
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        area = l / 2; nx /= l; ny /= l; nz /= l;
        rings.push({ off, cnt, nx, ny, nz, area });
        tot += area;
        if (ny > 0.93) flat += area; else pitched += area;
        if (ny < 0.72 && ny > 0.1) steep += area;
        off += cnt;
      }
      return { rings, tot: tot || 1, flatFrac: flat / (tot || 1), steepFrac: steep / (tot || 1), pitchedFrac: pitched / (tot || 1) };
    }

    function classify(b, rng, ctxB) {
      const sub = b.sub; const kind = b.kind;
      const dist = districtAt(ctxB.lx, ctxB.lz);
      const H = ctxB.H; const area = ctxB.area; const rs = ctxB.rs;
      const pitched = rs.pitchedFrac > 0.45; const mansard = rs.steepFrac > 0.25;
      const r1 = rng(); const r2 = rng();
      let typ;
      const oldTown = OLD_TOWN.indexOf(dist) >= 0;
      if (inSet(sub, SUB_CHURCH)) typ = TYP.SPECIAL;
      else if (inSet(sub, SUB_SMALL)) typ = TYP.INDUSTRIAL;
      else if (inSet(sub, SUB_INDUSTRIAL)) typ = TYP.INDUSTRIAL;
      else if (inSet(sub, SUB_INST) || kind === 2) typ = TYP.INSTITUTIONAL;
      else if (inSet(sub, SUB_HOUSE)) typ = (oldTown && H > 8.5 && r1 < 0.6 && dist !== D.HOWALD) ? TYP.HISTORIC : TYP.HOUSE;
      else if (S.office === sub || kind === 1) {
        if (oldTown && pitched && H < 24 && dist !== D.BONNEVOIE) typ = r1 < 0.65 ? TYP.HISTORIC : TYP.OFFICE;
        else if (oldTown && !pitched && H < 14) typ = r1 < 0.5 ? TYP.POSTWAR : TYP.OFFICE;
        else typ = TYP.OFFICE;
      } else if (inSet(sub, SUB_COMM) || kind === 5) {
        if (oldTown && levelsOf(b, H) >= 3 && r1 < 0.6) typ = pitched ? TYP.HISTORIC : TYP.POSTWAR;
        else typ = (dist === D.KIRCHBERG && (H > 14 || area > 400)) ? TYP.OFFICE : TYP.INDUSTRIAL;
      } else if (S.hotel === sub || kind === 6) {
        typ = oldTown && pitched ? TYP.HISTORIC : (H > 14 ? TYP.OFFICE : TYP.MODERN);
      } else {
        // dwellings and unknown
        let hist = HIST_BASE[dist] + (mansard ? 0.28 : 0) + (pitched ? 0.1 : 0) - (!pitched && H > 14 ? 0.4 : 0) - (H > 26 ? 0.4 : 0);
        if (S.apartments === sub && !pitched && H > 12) hist -= 0.15;
        if (S.terrace === sub) hist += 0.3;
        if (pitched && H < 9.5 && area < 220 && !oldTown) typ = TYP.HOUSE;
        else if (r1 < hist) typ = TYP.HISTORIC;
        else if (!oldTown && !pitched && dist === D.KIRCHBERG && H > 16 && r2 < 0.5) typ = TYP.OFFICE;
        else if (pitched && H < 11 && r2 < 0.55 && dist !== D.KIRCHBERG) typ = TYP.HOUSE;
        else typ = r2 < MODERN_BASE[dist] ? TYP.MODERN : TYP.POSTWAR;
      }
      if (typ === TYP.HOUSE && H > 12) typ = TYP.POSTWAR;
      if (typ === TYP.HISTORIC && H < 5.5) typ = TYP.HOUSE;
      const cls = { typ, dist, oldTown, pitched, mansard };
      // wall colour
      const wl = pal.wall[typ];
      cls.wallCol = b.wall >= 0 ? [((b.wall >> 16) & 255) / 255, ((b.wall >> 8) & 255) / 255, (b.wall & 255) / 255] : pick(wl, rng());
      cls.ovl = 0;
      if (b.wall < 0 && typ === TYP.HISTORIC && dist === D.BONNEVOIE && rng() < 0.45) cls.wallCol = pick(pal.bright, rng());
      else if (b.wall < 0 && typ === TYP.HISTORIC && oldTown && rng() < 0.08) cls.wallCol = pick(pal.bright, rng());
      if (b.wall < 0 && typ === TYP.OFFICE && rng() < 0.25) cls.wallCol = pick(pal.dark, rng());
      if (b.wall < 0) {
        const ro = rng();
        if (typ === TYP.HISTORIC && ro < 0.38 && (dist === D.VILLE || dist === D.GARE || dist === D.LIMPERTSBERG)) { cls.ovl = 2; cls.wallCol = pick(pal.wall[0].slice(7, 9).concat([pal.wall[0][12]]), rng()); }
        else if ((typ === TYP.POSTWAR || typ === TYP.INSTITUTIONAL) && ro < 0.07) { cls.ovl = 1; cls.wallCol = pick(pal.brick, rng()); }
        else if (typ === TYP.INDUSTRIAL && ro < 0.05) { cls.ovl = 1; cls.wallCol = pick(pal.brick, rng()); }
        else if (typ === TYP.SPECIAL) cls.ovl = 0;
      }
      // accents: window frames / shutters / doors
      const ar = rng();
      let acc;
      if (typ === TYP.HISTORIC) acc = ar < 0.34 ? 0 : ar < 0.44 ? 1 : ar < 0.62 ? 5 : ar < 0.74 ? 4 : ar < 0.84 ? 2 : ar < 0.92 ? 3 : ar < 0.96 ? 6 : 9;
      else if (typ === TYP.HOUSE) acc = ar < 0.3 ? 0 : ar < 0.46 ? 5 : ar < 0.62 ? 4 : ar < 0.74 ? 7 : ar < 0.82 ? 8 : ar < 0.9 ? 2 : 3;
      else if (typ === TYP.MODERN) acc = ar < 0.5 ? 3 : ar < 0.78 ? 13 : ar < 0.9 ? 2 : 4;
      else if (typ === TYP.OFFICE) acc = ar < 0.5 ? 2 : ar < 0.8 ? 3 : 13;
      else if (typ === TYP.INDUSTRIAL) acc = ar < 0.3 ? 8 : ar < 0.5 ? 5 : ar < 0.7 ? 7 : ar < 0.85 ? 2 : 3;
      else acc = ar < 0.4 ? 0 : ar < 0.65 ? 2 : ar < 0.85 ? 3 : 5;
      cls.acc = acc;
      cls.awn = AWNINGS[Math.floor(rng() * AWNINGS.length)];
      cls.seed = Math.min(0.99, rng());
      cls.bayW = BAY[typ]; cls.floorT = FLOOR_T[typ]; cls.groundT = GROUND_T[typ];
      cls.cornice = typ === TYP.HISTORIC || (typ === TYP.INSTITUTIONAL && rng() < 0.3);
      // roofs: from OSM tags + typology, never from an image
      const rr = rng();
      let pitchedMat; let pitchedCol; let steepMat;
      if (b.rmat === 2 || (b.roof >= 0 && lumOf(b.roof) < 0.2 && b.rmat === 0)) { pitchedMat = 0; pitchedCol = pick(pal.slate, rr); }
      else if (b.rmat === 1) { pitchedMat = 1; pitchedCol = pick(pal.clay, rr); }
      else if (b.rmat === 5 || b.rmat === 3) { pitchedMat = 3; pitchedCol = pick(pal.zinc, rr); }
      else if (b.rmat === 4) { pitchedMat = 8; pitchedCol = pick(pal.copper, rr); }
      else if (b.rmat === 6 || b.rmat === 11) { pitchedMat = 2; pitchedCol = pick(pal.conc, rr); }
      else if (typ === TYP.HISTORIC || typ === TYP.SPECIAL) { pitchedMat = rr < 0.82 ? 0 : (rr < 0.93 ? 3 : 1); pitchedCol = pitchedMat === 0 ? pick(pal.slate, rng()) : pitchedMat === 3 ? pick(pal.zinc, rng()) : pick(pal.clay, rng()); }
      else if (typ === TYP.HOUSE) { pitchedMat = rr < 0.5 ? 1 : (rr < 0.86 ? 2 : 0); pitchedCol = pitchedMat === 1 ? pick(pal.clay, rng()) : pitchedMat === 2 ? pick(pal.conc, rng()) : pick(pal.slate, rng()); }
      else if (typ === TYP.INDUSTRIAL) { pitchedMat = 3; pitchedCol = pick(pal.zinc, rr); }
      else { pitchedMat = rr < 0.45 ? 2 : (rr < 0.7 ? 0 : 3); pitchedCol = pitchedMat === 2 ? pick(pal.conc, rng()) : pitchedMat === 0 ? pick(pal.slate, rng()) : pick(pal.zinc, rng()); }
      steepMat = (pitchedMat === 3 || pitchedMat === 8) ? pitchedMat : (typ === TYP.HISTORIC && mansard ? (rr < 0.88 ? 0 : 3) : pitchedMat);
      cls.pitchedMat = pitchedMat; cls.pitchedCol = pitchedCol; cls.steepMat = steepMat;
      cls.steepCol = steepMat === pitchedMat ? pitchedCol : (steepMat === 0 ? pick(pal.slate, rng()) : pick(pal.zinc, rng()));
      // flat roofs
      const fr = rng();
      if (typ === TYP.INDUSTRIAL || typ === TYP.INSTITUTIONAL) { cls.flatMat = fr < 0.45 ? 4 : (fr < 0.8 ? 5 : 6); }
      else if (typ === TYP.MODERN || typ === TYP.OFFICE) { cls.flatMat = fr < 0.25 ? 4 : (fr < 0.5 ? 5 : (fr < 0.78 ? 6 : 7)); }
      else cls.flatMat = fr < 0.4 ? 4 : (fr < 0.75 ? 5 : 6);
      if ((area < 300 || pitched) && cls.flatMat === 7) cls.flatMat = 6;
      if (pitched) cls.flatMat = (cls.flatMat === 4 ? 4 : 5);
      cls.flatCol = cls.flatMat === 4 ? pick(pal.gravel, rng()) : cls.flatMat === 5 ? pick(pal.membrane, rng()) : cls.flatMat === 6 ? pick(pal.light, rng()) : pick(pal.green, rng());
      if (b.roof >= 0 && b.rmat === 0 && lumOf(b.roof) >= 0.2) { pitchedCol = [((b.roof >> 16) & 255) / 255, ((b.roof >> 8) & 255) / 255, (b.roof & 255) / 255]; cls.pitchedCol = pitchedCol; }
      cls.chimneys = (typ === TYP.HISTORIC || typ === TYP.HOUSE) && pitched;
      cls.dormers = (typ === TYP.HISTORIC || (typ === TYP.HOUSE && area > 70)) && pitched;
      cls.parapet = !pitched && typ !== TYP.HOUSE && area > 60 && !inSet(sub, SUB_SMALL);
      cls.brickCol = pick(pal.brick, rng());
      return cls;
    }
    const lumOf = (rgb) => (((rgb >> 16) & 255) + ((rgb >> 8) & 255) + (rgb & 255)) / 765;
    const levelsOf = (b, H) => (b.levels > 0 ? b.levels : Math.max(1, Math.round(H / 3.1)));

    // floors of one wall: ground floor + n equal upper floors under the eaves
    function floorsFor(Hring, cls, levels) {
      const Gt = cls.groundT; const Ft = cls.floorT;
      if (Hring < Gt * 0.9 + 0.5) return { groundH: Math.max(Hring, 1.2), floorH: Ft, nUp: 0 };
      let nf = (levels > 0 && Math.abs(Hring - (Gt + (levels - 1) * Ft)) < 0.3 * Hring) ? levels : Math.max(1, Math.round((Hring - Gt) / Ft) + 1);
      let floorH = nf > 1 ? (Hring - Gt) / (nf - 1) : Ft;
      while (nf > 1 && floorH < Ft * 0.8) { nf--; floorH = nf > 1 ? (Hring - Gt) / (nf - 1) : Ft; }
      while (nf > 1 && floorH > Ft * 1.3) { nf++; floorH = (Hring - Gt) / (nf - 1); }
      if (nf === 1) return { groundH: Hring, floorH: Ft, nUp: 0 };
      return { groundH: Gt, floorH, nUp: nf - 1 };
    }

    /* ------------------------------------------------ a wall: a vertical polygon (given as triangles) with its bays */
    // emitWall: tris = [[ia, ib, ic], ...] over vertex arrays (px, py, pz, yWall(i))
    function emitWall(acc, wall) {
      const { px, py, pz, yv, idx, cls, bcx, bcz, mode, levels, info } = wall;
      // plane normal and horizontal tangent
      let nx = 0; let ny = 0; let nz = 0;
      for (let k = 0; k < idx.length; k += 3) {
        const i0 = idx[k]; const i1 = idx[k + 1]; const i2 = idx[k + 2];
        const ax = px[i1] - px[i0]; const ay = py[i1] - py[i0]; const az = pz[i1] - pz[i0];
        const bx = px[i2] - px[i0]; const by = py[i2] - py[i0]; const bz = pz[i2] - pz[i0];
        nx += ay * bz - az * by; ny += az * bx - ax * bz; nz += ax * by - ay * bx;
      }
      const hl = Math.hypot(nx, nz);
      const nl = Math.hypot(nx, ny, nz) || 1;
      if (hl < 1e-4 || hl / nl < 0.35) return null;      // not a wall (soffit, floor)
      nx /= nl; ny /= nl; nz /= nl;
      // ring centre; outward = away from the building centre
      let rcx = 0; let rcz = 0; let ymin = 1e9; let ymax = -1e9; let smin = 1e9; let smax = -1e9;
      const seen = new Set(idx);
      const hn = Math.hypot(nx, nz); const hx = nx / hn; const hz = nz / hn;
      const tx = -hz; const tz = hx;
      seen.forEach((i) => { rcx += px[i]; rcz += pz[i]; });
      rcx /= seen.size; rcz /= seen.size;
      let ox_ = hx; let oz_ = hz;
      if ((rcx - bcx) * hx + (rcz - bcz) * hz < 0) { ox_ = -hx; oz_ = -hz; }
      const nrm = [ox_ * hn + 0, ny * (ox_ * hx + oz_ * hz >= 0 ? 1 : -1), oz_ * hn];
      seen.forEach((i) => { const s = px[i] * tx + pz[i] * tz; if (s < smin) smin = s; if (s > smax) smax = s; if (py[i] < ymin) ymin = py[i]; if (py[i] > ymax) ymax = py[i]; });
      const len = smax - smin;
      // eave: lowest vertex that is clearly above the base
      let eave = ymax;
      seen.forEach((i) => { if (py[i] > ymin + 1.0 && py[i] < eave) eave = py[i]; });
      const Hring = eave - ymin;
      const fl = floorsFor(Hring, cls, levels);
      const nb = Math.max(1, Math.round(len / cls.bayW));
      // sign of the tangent so that u grows to the right when seen from outside
      const flipU = (tx * oz_ - tz * ox_) < 0 ? -1 : 1;     // cross(t, out) sign
      const party = (info & 64) !== 0;
      const shopT = (info >> 3) & 7;
      const rclass = info & 7;
      let gMode = 0;
      const wantShop = shopT > 0 || (mode.shopStreet && rclass >= 1 && rclass <= 3 && len > 3.2);
      if (wantShop && fl.nUp >= 0 && Hring > 2.8 && len > 2.8 && !party) gMode = 1;
      const blind = party || len < 1.5 || (Hring < 1.6);
      const awn = cls.awn;
      const md = gMode + 4 * (shopT || 1) + (blind ? 32 : 0) + 64 * awn + 1024 * cls.ovl;
      const wc = cls.wallCol;
      const shade = 0.9 + 0.1 * Math.abs(ox_);
      const col = [wc[0] * shade, wc[1] * shade, wc[2] * shade];
      const seedW = cls.acc + cls.seed;
      const typ = cls.typ;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const u = flipU * ((px[i] * tx + pz[i] * tz) - (flipU > 0 ? smin : smax)) / (len || 1) * nb;
        acc.vert(px[i], yv[i], pz[i], nrm[0], nrm[1], nrm[2], col, u, yv[i] - ymin, typ, seedW, fl.floorH, fl.groundH, fl.nUp, md);
      }
      return { ymin, eave, len, tx, tz, ox: ox_, oz: oz_, hn, seen, fl, party, smin, smax, Hring };
    }

    /* cornice and parapet along the top edge of a wall: a thin ledge */
    function addLedge(acc, w, ids, px, pz, y, protrude, h, col, seedW) {
      // endpoints: the two highest-and-farthest vertices at y~eave
      let a = null; let b = null; let best = 0;
      const top = ids.filter((i) => Math.abs(w.py[i] - y) < 0.2);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const d = Math.hypot(px[top[i]] - px[top[j]], pz[top[i]] - pz[top[j]]);
        if (d > best) { best = d; a = top[i]; b = top[j]; }
      }
      if (!a || best < 1.5) return;
      const A0 = [px[a], 0, pz[a]]; const B0 = [px[b], 0, pz[b]];
      const ex = w.ox * protrude; const ez = w.oz * protrude;
      const n = [w.ox, 0, w.oz];
      const y0 = y - h; const y1 = y + 0.06;
      const A1 = [A0[0] + ex, 0, A0[2] + ez]; const B1 = [B0[0] + ex, 0, B0[2] + ez];
      plainQuad(acc, [A1[0], y0, A1[2]], [B1[0], y0, B1[2]], [B1[0], y1, B1[2]], [A1[0], y1, A1[2]], n, col, 90, seedW);                // front
      plainQuad(acc, [A0[0], y1, A0[2]], [A1[0], y1, A1[2]], [B1[0], y1, B1[2]], [B0[0], y1, B0[2]], [0, 1, 0], col, 90, seedW);       // top
      plainQuad(acc, [A0[0], y0, A0[2]], [B0[0], y0, B0[2]], [B1[0], y0, B1[2]], [A1[0], y0, A1[2]], [0, -1, 0], col, 90, seedW);      // underside
    }
    // low parapet on a flat roof: an outer face and a cap
    function addParapet(acc, w, ids, px, pz, y, col, seedW) {
      let a = null; let b = null; let best = 0;
      const top = ids.filter((i) => Math.abs(w.py[i] - y) < 0.25);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const d = Math.hypot(px[top[i]] - px[top[j]], pz[top[i]] - pz[top[j]]);
        if (d > best) { best = d; a = top[i]; b = top[j]; }
      }
      if (!a || best < 2) return;
      const hgt = 0.55; const th = 0.22;
      const A0 = [px[a], px[b] === undefined ? 0 : 0, pz[a]]; const B0 = [px[b], 0, pz[b]];
      const inx = -w.ox * th; const inz = -w.oz * th;
      const n = [w.ox, 0, w.oz];
      const A1 = [A0[0] + inx, 0, A0[2] + inz]; const B1 = [B0[0] + inx, 0, B0[2] + inz];
      const y1 = y + hgt;
      plainQuad(acc, [A0[0], y, A0[2]], [B0[0], y, B0[2]], [B0[0], y1, B0[2]], [A0[0], y1, A0[2]], n, col, 90, seedW);
      plainQuad(acc, [A0[0], y1, A0[2]], [B0[0], y1, B0[2]], [B1[0], y1, B1[2]], [A1[0], y1, A1[2]], [0, 1, 0], col, 90, seedW);
      plainQuad(acc, [B1[0], y, B1[2]], [A1[0], y, A1[2]], [A1[0], y1, A1[2]], [B1[0], y1, B1[2]], [-n[0], 0, -n[2]], col, 90, seedW);
    }

    /* ------------------------------------------------ roofs */
    function emitRoof(acc, b, rs, px, py, pz, cls, rng) {
      const seedW = cls.acc + cls.seed;
      const tmp = [0, 0, 0];
      void tmp;
      rs.rings.forEach((rg) => {
        const flat = rg.ny > 0.93;
        const steep = rg.ny < 0.72;
        const mt = flat ? cls.flatMat : (steep ? cls.steepMat : cls.pitchedMat);
        const base = flat ? cls.flatCol : (steep ? cls.steepCol : cls.pitchedCol);
        const jit = 0.94 + 0.12 * ((rg.off * 7919) % 13) / 13;
        const col = [base[0] * jit, base[1] * jit, base[2] * jit];
        // plane basis: t = contour direction, s = down-slope direction
        let tx; let tz; let sx; let sy; let sz;
        if (flat) { tx = 1; tz = 0; sx = 0; sy = 0; sz = 1; }
        else {
          const hl = Math.hypot(rg.nx, rg.nz) || 1;
          tx = -rg.nz / hl; tz = rg.nx / hl;
          sx = rg.nx * rg.ny; sy = rg.ny * rg.ny - 1; sz = rg.nz * rg.ny;
          const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
        }
        for (let k = rg.off; k < rg.off + rg.cnt; k++) {
          for (let j = 0; j < 3; j++) {
            const i = b.R[k * 3 + j];
            const u = flat ? px[i] : px[i] * tx + pz[i] * tz;
            const v = flat ? pz[i] : px[i] * sx + py[i] * sy + pz[i] * sz;
            acc.vert(px[i], py[i], pz[i], rg.nx, rg.ny, rg.nz, col, u, v, 100 + mt, seedW, 0, 0, 0, 0);
          }
        }
      });
    }

    /* chimneys on pitched roofs: along the highest ridge */
    function addChimneys(acc, rs, px, py, pz, b, cls, rng, area) {
      if (detail < 1) return;
      let top = -1; let topY = -1e9;
      for (let i = 0; i < b.nv; i++) if (py[i] > topY) { topY = py[i]; top = i; }
      if (top < 0) return;
      // ridge partner: another vertex at the same height, 2.5 - 30 m away
      let other = -1; let od = 0;
      for (let i = 0; i < b.nv; i++) {
        if (i === top || py[i] < topY - 0.35) continue;
        const d = Math.hypot(px[i] - px[top], pz[i] - pz[top]);
        if (d > 2.5 && d < 30 && d > od) { od = d; other = i; }
      }
      const n = area < 55 ? 1 : (area < 220 ? 2 : 3);
      const seedW = cls.acc + cls.seed;
      const brick = cls.brickCol;
      for (let c = 0; c < n; c++) {
        if (rng() < 0.18) continue;
        let x; let z;
        if (other >= 0) { const t = n === 1 ? 0.25 + rng() * 0.5 : 0.12 + (0.76 * c) / (n - 1) + (rng() - 0.5) * 0.06; x = lerp(px[top], px[other], t); z = lerp(pz[top], pz[other], t); }
        else { x = px[top] + (rng() - 0.5) * 1.5; z = pz[top] + (rng() - 0.5) * 1.5; }
        const yaw = Math.atan2(other >= 0 ? pz[other] - pz[top] : 0, other >= 0 ? px[other] - px[top] : 1);
        addBox(acc, x, z, 0.62, 0.52, yaw, topY - 0.9, topY + 0.85 + rng() * 0.3, brick, 92, seedW, [0.3, 0.3, 0.32]);
        addBox(acc, x, z, 0.8, 0.7, yaw, topY + 0.85 + 0.3, topY + 1.0 + 0.3, [0.36, 0.36, 0.38], 90, seedW);
        stats.chimneys++;
      }
    }

    /* dormers on big pitched facets (historic mansards, big house roofs) */
    function addDormers(acc, b, rs, px, py, pz, cls, rng, wallInfos, tileBudget) {
      if (detail < 1 || rs.rings.length > 9) return 0;
      let made = 0;
      const seedW = cls.acc + cls.seed;
      for (let q = 0; q < rs.rings.length && made < 14 && tileBudget.n > 0; q++) {
        const rg = rs.rings[q];
        if (rg.ny > 0.84 || rg.ny < 0.28 || rg.area < 14) continue;
        // facet vertices
        const ids = new Set(); for (let k = rg.off; k < rg.off + rg.cnt; k++) { ids.add(b.R[k * 3]); ids.add(b.R[k * 3 + 1]); ids.add(b.R[k * 3 + 2]); }
        const arr = Array.from(ids);
        let ymin = 1e9; let ymax = -1e9; arr.forEach((i) => { ymin = Math.min(ymin, py[i]); ymax = Math.max(ymax, py[i]); });
        const low = arr.filter((i) => py[i] < ymin + 0.2);
        let a = null; let c = null; let best = 0;
        for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) {
          const d = Math.hypot(px[low[i]] - px[low[j]], pz[low[i]] - pz[low[j]]);
          if (d > best) { best = d; a = low[i]; c = low[j]; }
        }
        if (!a || best < 3.8) continue;
        const hl = Math.hypot(rg.nx, rg.nz) || 1;
        const ox_ = rg.nx / hl; const oz_ = rg.nz / hl;                   // horizontal outward (down-slope) direction
        const slope = Math.acos(clamp(rg.ny, 0, 1));
        const rise = ymax - ymin;
        const slopeLen = rise / Math.sin(slope);
        if (slopeLen < 2.1) continue;
        // facing a street / front? use the wall infos: prefer facets that face the road
        const nd = Math.max(1, Math.round((best - 1.2) / 3.2));
        const tx = -oz_; const tz = ox_;
        // order a -> c along t
        const sa = px[a] * tx + pz[a] * tz; const sc = px[c] * tx + pz[c] * tz;
        const [e0, e1] = sa < sc ? [a, c] : [c, a];
        const dirx = (px[e1] - px[e0]) / best; const dirz = (pz[e1] - pz[e0]) / best;
        const tn = Math.tan(slope);
        for (let d = 0; d < nd; d++) {
          if (rng() < 0.12) continue;
          const f = (d + 0.5) / nd;
          const lat = f * best;
          const upslope = Math.min(0.42 * (rise / tn) / 1.0, 1.4) + 0.2;            // horizontal distance up the slope from the eave
          const cx = px[e0] + dirx * lat - ox_ * upslope;
          const cz = pz[e0] + dirz * lat - oz_ * upslope;
          const y0 = ymin + upslope * tn;                                           // roof height under the dormer's front
          makeDormer(acc, cx, cz, y0, tx, tz, ox_, oz_, tn, cls, seedW, rng);
          made++; tileBudget.n--; stats.dormers++;
        }
      }
      return made;
    }
    function makeDormer(acc, cx, cz, y0, tx, tz, ox_, oz_, tn, cls, seedW, rng) {
      const w = 1.15; const hf = 1.35; const ap = 0.42;
      const hw = w / 2;
      const FL = [cx - tx * hw, cz - tz * hw]; const FR = [cx + tx * hw, cz + tz * hw];
      const yb = y0 - 0.1; const yt = y0 + hf; const ya = y0 + hf + ap;
      const d1 = (hf + 0.1) / tn; const d2 = (hf + ap + 0.1) / tn;                 // depth until the roof is met
      const BL = [FL[0] - ox_ * d1, FL[1] - oz_ * d1]; const BR = [FR[0] - ox_ * d1, FR[1] - oz_ * d1];
      const AB = [cx - ox_ * d2, cz - oz_ * d2];
      const n = [ox_, 0, oz_];
      const zinc = [0.5, 0.52, 0.54];
      const slate = cls.steepMat === 0 || cls.pitchedMat === 0 ? cls.steepCol : cls.pitchedCol;
      const mt = 100 + (cls.steepMat === 0 || cls.pitchedMat === 0 ? 0 : cls.pitchedMat);
      // front (window): rectangle with the dormer cell, gable above it
      const vf = (p, u, v) => acc.vert(p[0], p[1], p[2], n[0], n[1], n[2], zinc, u, v, 91, seedW, 0, 0, 0, 0);
      const A = [FL[0], yb, FL[1]]; const B = [FR[0], yb, FR[1]]; const C = [FR[0], yt, FR[1]]; const Dd = [FL[0], yt, FL[1]];
      vf(A, 0, 0); vf(B, 1, 0); vf(C, 1, 1); vf(A, 0, 0); vf(C, 1, 1); vf(Dd, 0, 1);
      const ap_ = [cx, ya, cz];
      plainTri(acc, Dd, C, ap_, n, zinc, 90, seedW);
      // cheeks
      const nl = [-tx, 0, -tz]; const nr = [tx, 0, tz];
      plainTri(acc, [FL[0], yb, FL[1]], [BL[0], yt, BL[1]], [FL[0], yt, FL[1]], nl, zinc, 90, seedW);
      plainTri(acc, [FR[0], yb, FR[1]], [FR[0], yt, FR[1]], [BR[0], yt, BR[1]], nr, zinc, 90, seedW);
      // gable roof: two planes
      const rl = [-tx * 0.4 + 0, 0.9, -tz * 0.4]; const rn = [tx * 0.4, 0.9, tz * 0.4];
      const ll = Math.hypot(rl[0], rl[1], rl[2]); const lr = Math.hypot(rn[0], rn[1], rn[2]);
      const nL = [rl[0] / ll, rl[1] / ll, rl[2] / ll]; const nR = [rn[0] / lr, rn[1] / lr, rn[2] / lr];
      const rv = (p, nn) => acc.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2], slate, p[0] * 0.8, p[2] * 0.8 + p[1], mt, seedW, 0, 0, 0, 0);
      const P1 = [FL[0], yt, FL[1]]; const P2 = [cx, ya, cz]; const P3 = [AB[0], ya, AB[1]]; const P4 = [BL[0], yt, BL[1]];
      rv(P1, nL); rv(P2, nL); rv(P3, nL); rv(P1, nL); rv(P3, nL); rv(P4, nL);
      const Q1 = [cx, ya, cz]; const Q2 = [FR[0], yt, FR[1]]; const Q3 = [BR[0], yt, BR[1]]; const Q4 = [AB[0], ya, AB[1]];
      rv(Q1, nR); rv(Q2, nR); rv(Q3, nR); rv(Q1, nR); rv(Q3, nR); rv(Q4, nR);
      void rng;
    }

    /* rooftop plant on big flat roofs: a lift overrun and some units */
    function addRooftop(acc, b, rs, px, py, pz, cls, rng) {
      if (detail < 2) return;
      const flatRings = rs.rings.filter((r) => r.ny > 0.96 && r.area > 90);
      if (!flatRings.length) return;
      const seedW = cls.acc + cls.seed;
      const rg = flatRings[0];
      const n = rg.area > 600 ? 3 : rg.area > 250 ? 2 : 1;
      for (let c = 0; c < n; c++) {
        // random triangle of the facet, point inside it shrunk towards the centroid
        const k = rg.off + Math.floor(rng() * rg.cnt);
        const i0 = b.R[k * 3]; const i1 = b.R[k * 3 + 1]; const i2 = b.R[k * 3 + 2];
        const u = 0.25 + rng() * 0.3; const v = 0.2 + rng() * 0.3;
        const x = px[i0] * (1 - u - v) + px[i1] * u + px[i2] * v; const z = pz[i0] * (1 - u - v) + pz[i1] * u + pz[i2] * v; const y = py[i0];
        const big = c === 0 && rg.area > 180;
        const sx = big ? 2.8 + rng() * 1.6 : 1.2 + rng() * 1.6; const sz = big ? 2.8 + rng() * 1.6 : 1.0 + rng() * 1.4; const h = big ? 2.4 : 1.0 + rng() * 0.9;
        addBox(acc, x, z, sx, sz, rng() * Math.PI, y - 0.05, y + h, big ? [0.62, 0.62, 0.6] : [0.7, 0.72, 0.73], 90, seedW, [0.55, 0.55, 0.55]);
      }
    }

    /* ------------------------------------------------ LOD2 buildings of one 128 m tile */
    function convexHull(pts) {
      const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (p.length < 3) return p;
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      lo.pop(); up.pop(); return lo.concat(up);
    }
    function buildTile(t, tileBudget) {
      const list = t.bld;
      if (!list || !list.length) return null;
      const t0 = performance.now();
      const acc = new Acc();
      const budget = tileBudget || { n: 400 };
      list.forEach((b, bi) => {
        const nv = b.nv;
        const px = new Float32Array(nv); const py = new Float32Array(nv); const pz = new Float32Array(nv);
        let cx = 0; let cz = 0; let ymin = 1e9; let ymax = -1e9;
        for (let i = 0; i < nv; i++) {
          px[i] = b.ax / 10 + b.V[i * 3] / 20 - ox; pz[i] = b.az / 10 + b.V[i * 3 + 1] / 20 - oz; py[i] = b.ay / 10 + b.V[i * 3 + 2] / 20 - oy;
          cx += px[i]; cz += pz[i]; ymin = Math.min(ymin, py[i]); ymax = Math.max(ymax, py[i]);
        }
        cx /= nv; cz /= nv;
        // the ground outline of the building (convex hull of its bottom vertices) against the landmark footprints; the first six vertices decide the old centre / vertex test
        const bottomIdx = Array.from(new Set(b.B));
        const hull = convexHull(bottomIdx.map((i) => [px[i], pz[i]]));
        if (ctx.replacedBy(cx, cz, hull.length >= 3 ? hull : Array.from({ length: Math.min(nv, 6) }, (_, i) => [px[i], pz[i]]))) { stats.skipped++; return; }
        if (ctx.logBuilding && hull.length >= 3) ctx.logBuilding(hull, 'lod2');
        const H = ymax - ymin;
        if (H <= ctx.STOP_CLEAR_H && ctx.atStop(cx, cz)) { stats.skipped++; return; }
        const bottom = new Set(b.B);
        const yv = new Float32Array(nv);
        for (let i = 0; i < nv; i++) yv[i] = bottom.has(i) ? Math.min(py[i], ctx.gy(px[i], pz[i])) - 0.3 : py[i];
        const rs = roofStatsOf(b, px, py, pz);
        // footprint area ~ flat bounding of the wall bottom: use roof area projected
        let area = 0; rs.rings.forEach((r) => { area += r.area * Math.max(r.ny, 0.2); });
        const rng = mulberry((hash2(Math.round(b.ax) + t.info.i * 31, Math.round(b.az) + t.info.j * 17) * 4294967296) | 0);
        const ll = ctx.localXZ(cx, cz);
        const cls = classify(b, rng, { lx: ll[0], lz: ll[1], H, area, rs });
        stats.buildings++; stats.byTyp[cls.typ]++;
        const levels = b.levels > 0 ? b.levels : 0;
        const mode = { shopStreet: false };
        // shop streets: dense shops around, urban typologies
        if (ctx.shopStreetOk !== false && (b.shops >= 3 && (cls.typ === TYP.HISTORIC || cls.typ === TYP.POSTWAR || cls.typ === TYP.MODERN) && H > 7 && cls.oldTown)) mode.shopStreet = b.shops >= 5 || rng() < 0.6;
        if (S.garage === b.sub || S.garages === b.sub) mode.shopStreet = false;
        // walls
        let off = 0;
        const wallSeed = cls.acc + cls.seed;
        for (let r = 0; r < b.wr.length; r++) {
          const cnt = b.wr[r];
          const idx = [];
          for (let k = off; k < off + cnt; k++) idx.push(b.W[k * 3], b.W[k * 3 + 1], b.W[k * 3 + 2]);
          off += cnt;
          const w = emitWall(acc, { px, py, pz, yv, idx, cls, bcx: cx, bcz: cz, mode, levels, info: b.wi[r] });
          if (!w) continue;
          const ids = Array.from(w.seen);
          if (cls.cornice && w.fl.nUp >= 1 && w.len > 2.5 && detail >= 1) addLedge(acc, { py, ox: w.ox, oz: w.oz }, ids, px, pz, w.eave, 0.3, 0.34, [cls.wallCol[0] * 1.04, cls.wallCol[1] * 1.04, cls.wallCol[2] * 1.04], wallSeed);
          else if (cls.parapet && rs.flatFrac > 0.6 && w.len > 2.5 && detail >= 1) addParapet(acc, { py, ox: w.ox, oz: w.oz }, ids, px, pz, w.eave, [cls.wallCol[0] * 0.95, cls.wallCol[1] * 0.95, cls.wallCol[2] * 0.95], wallSeed);
        }
        emitRoof(acc, b, rs, px, py, pz, cls, rng);
        if (cls.chimneys && rs.pitchedFrac > 0.5) addChimneys(acc, rs, px, py, pz, b, cls, rng, area);
        if (cls.dormers && rs.pitchedFrac > 0.5) addDormers(acc, b, rs, px, py, pz, cls, rng, b.wi, budget);
        if (rs.flatFrac > 0.6 && area > 90 && cls.typ !== TYP.HOUSE) addRooftop(acc, b, rs, px, py, pz, cls, rng);
      });
      if (acc.empty) return null;
      stats.tris += acc.p.length / 9;
      const grp = new T.Group();
      grp.add(acc.mesh({ cast: ctx.castShadow }));
      const dt = performance.now() - t0; stats.ms += dt; stats.tiles++; if (dt > stats.maxMs) stats.maxMs = dt;
      return grp;
    }

    /* ------------------------------------------------ OSM footprints that LOD2 does not cover (chunks of data/luxtram-world.json) */
    function newBatch() { return new Acc(); }
    const signedArea = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    function addOsmBuilding(acc, b, ci, idx) {
      const ring0 = ctx.sceneRing(b[5]);
      const meta = b[0];
      const kind = meta & 7;
      const H = b[1] / 10;
      const minH = b[2] / 10;
      const ring = signedArea(ring0) > 0 ? ring0.slice().reverse() : ring0;
      for (let i = 0; i < ring.length; i++) if (ctx.nearest(ring[i][0], ring[i][1]).d < 3.4) return false;
      const cc = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      if (ctx.replacedBy(cc[0], cc[1], ring)) return false;
      if (ctx.logBuilding) ctx.logBuilding(ring, 'osm');
      if (H <= ctx.STOP_CLEAR_H && ctx.atStop(cc[0], cc[1])) return false;
      const rng = mulberry(hash2(ci * 977 + idx, 17) * 4294967296);
      let gMin = 1e9; let gSum = 0;
      ring.forEach((p) => { const g = ctx.gy(p[0], p[1]); gMin = Math.min(gMin, g); gSum += g; });
      const gAvg = gSum / ring.length;
      const base = Math.min(gMin, gAvg) - 0.4;
      const top = gAvg + H;
      const sub = kind === 4 ? S.church : kind === 3 ? S.shed : kind === 2 ? S.public : kind === 1 ? S.office : kind === 5 ? S.retail : kind === 6 ? S.hotel : S.yes;
      const ll = ctx.localXZ(cc[0], cc[1]);
      const rs = { pitchedFrac: 0, steepFrac: 0, flatFrac: 1, rings: [] };
      const cls = classify({ sub, kind, wall: b[3] ? b[3] : -1, roof: -1, rmat: 0, shops: 0 }, rng, { lx: ll[0], lz: ll[1], H, area: Math.abs(signedArea(ring)), rs });
      const area = signedArea(ring);
      const levels = 0;
      const wc = cls.wallCol;
      const seedW = cls.acc + cls.seed;
      const wallBase = minH > 0 ? gAvg + minH : base;
      const eaveH = top - wallBase;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]; const q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0]; const dz = q[1] - p[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const sgn = area < 0 ? -1 : 1;
        const nx = (dz / len) * sgn; const nz = (-dx / len) * sgn;
        const fl = floorsFor(eaveH, cls, levels);
        const nb = Math.max(1, Math.round(len / cls.bayW));
        const md = 4 + 64 * cls.awn + 1024 * cls.ovl + (len < 1.5 ? 32 : 0);
        const shade = 0.9 + 0.1 * Math.abs(nx);
        const col = [wc[0] * shade, wc[1] * shade, wc[2] * shade];
        const hgt = top - wallBase;
        const mk = (pt, y, u) => acc.vert(pt[0], y, pt[1], nx, 0, nz, col, u, y - wallBase, cls.typ, seedW, fl.floorH, fl.groundH, fl.nUp, md);
        mk(p, wallBase, 0); mk(q, wallBase, nb); mk(q, top, nb); mk(p, wallBase, 0); mk(q, top, nb); mk(p, top, 0);
        void hgt;
      }
      // flat roof
      let tris = null;
      try { tris = T.ShapeUtils.triangulateShape(ring.map((p) => new T.Vector2(p[0], p[1])), []); } catch (e) { tris = null; }
      if (tris) {
        const rcol = cls.flatCol;
        tris.forEach((tr) => { [tr[0], tr[2], tr[1]].forEach((k) => acc.vert(ring[k][0], top + 0.02, ring[k][1], 0, 1, 0, rcol, ring[k][0], ring[k][1], 100 + cls.flatMat, seedW, 0, 0, 0, 0)); });
      }
      return true;
    }
    const batchMesh = (acc) => acc.mesh({ cast: ctx.castShadow });

    const api = {
      matWall,
      stats,
      parseTile,
      buildTile,
      newBatch,
      addOsmBuilding,
      batchMesh,
      setNight(k) { uniforms.uNight.value = k; matWall.emissiveIntensity = k > 0.001 ? 1 : 0; },
      dispose() { matWall.dispose(); },
      debug: { classify, floorsFor, districtAt },
    };
    FX.last = api;
    return api;
  };
})();
