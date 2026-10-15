/* Zuchsimulator Lëtzebuerg: photo-modelled stations (luxtram). Registers into TS.realStations (stations-real.js).
 * All 24 Luxtram T1 stops, modelled after Wikimedia Commons photos of the real stops (category "Tram stops in Luxembourg"):
 *  - the Luxtram stop family: slim shelter (flat light-grey or anthracite roof on thin posts, glass back wall and ends, dark bench, anthracite
 *    name plate with white lettering), backlit advertising vitrine (mupi), white ticket machine, tall black pole with LED departure board,
 *    cream tactile guidance strip with black borders along the platform edge, slender black lamp poles, bins, black railings behind the platform;
 *  - the special stops: Luxexpo (leaf-shaped glass canopy on tree columns), Philharmonie (one long low canopy), Faïencerie (cemetery iron fence),
 *    Alphonse Weicker (long dark shelter + Vel'oh docks), Findel / Rout Bréck / Stäreplaz (island platforms; Findel with light plank paving).
 * Everything is built with merged batches of the station's BatchSet (a handful of draw calls per platform); textures are canvas textures cached by key. */
(function () {
  'use strict';
  const RS = window.TS && window.TS.realStations;
  if (!RS) return;

  /* ------------------------------------------------------------------ palettes */
  const TONES = {
    light: { roof: '#d4d8db', under: '#c9ced2', frame: '#a9b0b5', trim: '#454b51', bench: '#3a3f44' },
    dark: { roof: '#3b4046', under: '#555c63', frame: '#2c3035', trim: '#1c1f22', bench: '#2a2e32' },
  };
  const DARK = '#2b2f33';
  const ASPHALT = '#4a4d50';

  /* two-line name plates as printed on the real signs */
  const SIGN_LINES = {
    'Findel-Aéroport': ['Findel - Luxembourg Airport'],
    Héienhaff: ['Héienhaff P+R'],
    Philharmonie: ['Philharmonie - Mudam'],
    'Rout Bréck': ['Rout Bréck - Pafendall'],
    Stäreplaz: ['Stäreplaz / Etoile'],
    Europaparlament: ['Europaparlament', 'Parlement européen'],
    Nationalbibliothéik: ['Nationalbibliothéik', 'Bibliothèque nationale'],
    'Paräisser Plaz': ['Paräisser Plaz', 'Place de Paris'],
    'Leschte Steiwer': ['Leschte Steiwer', 'Dernier Sol'],
  };

  /* ------------------------------------------------------------------ per-stop layouts
   * shelters: [{ z, len }] along the platform (local z, + = behind the tram's nose); ads: z of advertising vitrines (faces the track);
   * ticket / led: z of the ticket machine / departure pole; rail: black railing behind the platform (true | false);
   * lamps / bins: z lists; extras: named add-ons. tone picks the shelter colour family. */
  const STD1 = [{ z: 0, len: 6 }];
  const STD2 = [{ z: 0, len: 6.5 }, { z: -13.5, len: 4.5 }];
  const STD3 = [{ z: 0, len: 7 }, { z: -14, len: 5 }, { z: 14, len: 5 }];
  const LAYOUT = {
    'Findel-Aéroport': { tone: 'dark', shelters: [{ z: 0, len: 9 }, { z: -14, len: 7 }, { z: 13, len: 7 }], ads: [-8.2, 8.4], ticket: 5.4, led: -5.8, lamps: [-20, -6, 8, 21], bins: [4, -10], island: true, planks: true },
    Héienhaff: { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true },
    Luxexpo: { tone: 'light', wing: true, shelters: [], ads: [-17.5, 17], ticket: 5.2, led: -5, lamps: [-22, 22], bins: [-9] },
    'Alphonse Weicker': { tone: 'dark', shelters: [{ z: 0, len: 13 }], ads: [-7.4, 7.4], ticket: 8.6, led: -9, lamps: [-18, 13], bins: [4], rail: true, extras: ['veloh'] },
    Nationalbibliothéik: { tone: 'light', shelters: [{ z: 0, len: 7.5 }, { z: -13.5, len: 4 }], ads: [-4.9, -16.4], ticket: 4.9, led: 6, lamps: [-18, 12], bins: [4] },
    Universitéit: { tone: 'light', shelters: [{ z: 0, len: 7 }, { z: -12.5, len: 4.5 }], ads: [-4.2, -15.4], ticket: 4.4, led: 6, lamps: [-18, 12], bins: [4], rail: true },
    Coque: { tone: 'light', shelters: [{ z: 0, len: 6 }, { z: -9, len: 4.5 }], ads: [-3.9, -11.8], ticket: 3.9, led: 4.8, lamps: [-18, 8, 18], bins: [4] },
    Europaparlament: { tone: 'light', shelters: [{ z: 0, len: 6 }, { z: -12.5, len: 4.5 }], ads: [-3.9, -15.2], ticket: 3.9, led: 4.8, lamps: [-18, 12], bins: [4], rail: true },
    Philharmonie: { tone: 'light', shelters: [{ z: -1, len: 18 }], ads: [-11.8, 9.6], ticket: 10.8, led: 12.6, lamps: [-18, 16], bins: [-13], rail: true },
    'Rout Bréck': { tone: 'dark', shelters: [{ z: 0, len: 8 }, { z: -14, len: 6 }, { z: 14, len: 5 }], ads: [-9.5, 8.4, -18.4], ticket: 5.4, led: -6, lamps: [-20, -7, 8, 21], bins: [-3], island: true },
    Theater: { tone: 'light', shelters: STD2, ads: [-4.2, -16.1], ticket: 4.6, led: 5.8, lamps: [-18, 12], bins: [4], rail: true },
    Faïencerie: { tone: 'light', shelters: STD2, ads: [-4.2, -16.1], ticket: 4.6, led: 5.8, lamps: [-18, 12], bins: [4], fence: 'iron' },
    Stäreplaz: { tone: 'dark', shelters: [{ z: 0, len: 8 }, { z: -13, len: 6.5 }], ads: [-4.8, -16.9], ticket: 4.9, led: 6, lamps: [-20, -7, 9, 20], bins: [4], island: true },
    Hamilius: { tone: 'dark', shelters: STD3, ads: [-4.4, -17.1, 17.2], ticket: 4.6, led: 5.6, lamps: [-18, 7, 20], bins: [4, -8], rail: true },
    'Place de Metz': { tone: 'dark', shelters: [], ads: [-4.4, 6.5], ticket: null, led: 5.6, lamps: [-18, 12], bins: [4], rail: true },
    'Paräisser Plaz': { tone: 'dark', shelters: STD2, ads: [-4.4, -16.4], ticket: 4.6, led: 5.6, lamps: [-18, 12], bins: [4], rail: true },
    'Gare Centrale': { tone: 'dark', shelters: STD3, ads: [-4.4, -17.1, 17.2], ticket: 4.6, led: 5.6, lamps: [-18, 7, 20], bins: [4, -8], rail: true },
    'Leschte Steiwer': { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true },
    'Lycée Bouneweg': { tone: 'light', shelters: STD2, ads: [-4.2, -16.1], ticket: 4.6, led: 5.8, lamps: [-18, 12], bins: [4] },
    Scillas: { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true },
    'Gare Howald': { tone: 'light', shelters: STD2, ads: [-4.2, -16.1], ticket: 4.6, led: 5.8, lamps: [-18, 12], bins: [4], rail: true },
    'Lycée Vauban': { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true },
    Waassertuerm: { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true },
    Stadion: { tone: 'light', shelters: STD3, ads: [-4.2, -16.6, 16.4], ticket: 4.6, led: 5.8, lamps: [-18, 7, 20], bins: [4, -8], rail: true },
  };

  /* ------------------------------------------------------------------ small helpers */
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function paintSign(t, lines) {
    if (!t || !t.image || t.userData.luxtramSign) return;
    const c = t.image.getContext('2d');
    const w = t.image.width;
    const h = t.image.height;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2d3034');
    g.addColorStop(1, '#212427');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#e9e6df';
    const fit = (txt, size, weight) => {
      let s = size;
      c.font = weight + ' ' + s + 'px "Helvetica Neue", Arial, sans-serif';
      while (c.measureText(txt).width > w - 100 && s > 24) { s -= 4; c.font = weight + ' ' + s + 'px "Helvetica Neue", Arial, sans-serif'; }
    };
    if (lines.length === 1) {
      fit(lines[0], 100, '700');
      c.fillText(lines[0], w / 2, h / 2 + 4);
    } else {
      fit(lines[0], 76, '700');
      c.fillText(lines[0], w / 2, h * 0.37);
      fit(lines[1], 50, '600');
      c.fillText(lines[1], w / 2, h * 0.78);
    }
    t.userData.luxtramSign = true;
    t.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ the builder */
  function buildStop(api) {
    const { T, sets, M, mat, col, shade, WHITE, st, sx, spot, place, curved, H, W, edge, L, zA, zB, helpers, track, idx, opposite } = api;
    const canvasTex = helpers.canvasTex;
    const cfg = LAYOUT[st.name] || { tone: 'light', shelters: STD1, ads: [-3.9], ticket: 3.9, led: 5, lamps: [-18, 12], bins: [4], rail: true };
    const tone = TONES[cfg.tone] || TONES.light;
    const pinfo = track.platformInfo(idx);
    const island = pinfo.kind === 'island';
    const vc = sets.get('vc', M.vc, true);
    const glass = sets.get('glass', M.glass);
    const glow = sets.get('glow', M.glow);
    const cDark = col(DARK);

    // the generic name plate / totem get the real anthracite design (their texture is cached by name: repaint it once)
    paintSign(helpers.signTexture(st.name, 'tram'), SIGN_LINES[st.name] || [st.name]);

    /* ---------- textures (cached by key) ---------- */
    const adTex = () => canvasTex('luxtram:ads', 1024, 416, (c, w, h) => {
      const cw = w / 4;
      const draw = (i, bg1, bg2, big, small, accent, shape) => {
        const x0 = i * cw;
        const g = c.createLinearGradient(x0, 0, x0 + cw, h);
        g.addColorStop(0, bg1);
        g.addColorStop(1, bg2);
        c.fillStyle = g;
        c.fillRect(x0, 0, cw, h);
        c.fillStyle = accent;
        if (shape === 0) { c.beginPath(); c.arc(x0 + cw * 0.5, h * 0.42, cw * 0.34, 0, 6.3); c.fill(); }
        if (shape === 1) { c.fillRect(x0 + 18, h * 0.18, cw - 36, h * 0.34); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x0 + 18, h * 0.18, (cw - 36) * 0.5, h * 0.34); }
        if (shape === 2) { for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(x0 + cw * (0.2 + 0.12 * k), h * (0.3 + 0.06 * (k % 3)), 20 + k * 3, 0, 6.3); c.fill(); } }
        if (shape === 3) { c.beginPath(); c.moveTo(x0 + 20, h * 0.55); c.lineTo(x0 + cw - 20, h * 0.2); c.lineTo(x0 + cw - 20, h * 0.55); c.closePath(); c.fill(); }
        c.fillStyle = '#ffffff';
        c.textAlign = 'center';
        c.font = '800 46px "Helvetica Neue", Arial, sans-serif';
        c.fillText(big, x0 + cw / 2, h * 0.72);
        c.font = '600 22px "Helvetica Neue", Arial, sans-serif';
        c.fillText(small, x0 + cw / 2, h * 0.83);
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.fillRect(x0 + 30, h * 0.9, cw - 60, 6);
      };
      draw(0, '#d8341f', '#f0742a', 'SOLDES', '-50% a Lëtzebuerg', '#ffd24a', 0);
      draw(1, '#3a2a78', '#8a47c9', 'KONSCHT', 'Concert 20:00', '#f2b8ff', 1);
      draw(2, '#1d8a5c', '#6cc08a', 'FRESH', 'Mobilitéit fir all', '#eaffd8', 2);
      draw(3, '#f6c21e', '#f08a1c', 'FOUER', 'Fête foraine', '#c8352b', 3);
    }, { clampU: true, clampV: true });
    const ticketTex = () => canvasTex('luxtram:ticket', 128, 256, (c, w, h) => {
      c.fillStyle = '#d9dcde';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#b4babe';
      c.fillRect(0, 0, 8, h);
      c.fillStyle = '#27303a';
      c.fillRect(18, 28, w - 36, 54);
      c.fillStyle = '#7fd0ff';
      c.fillRect(24, 34, w - 48, 40);
      c.fillStyle = '#3a4046';
      c.fillRect(30, 104, w - 60, 46);
      c.fillStyle = '#e9edef';
      for (let k = 0; k < 6; k++) c.fillRect(34 + (k % 3) * 22, 110 + Math.floor(k / 3) * 18, 16, 12);
      c.fillStyle = '#191c1f';
      c.fillRect(30, 172, w - 60, 10);
      c.fillStyle = '#e03a2f';
      c.fillRect(w - 52, 196, 22, 22);
      c.fillStyle = '#2b2f33';
      c.font = '700 16px Arial';
      c.textAlign = 'center';
      c.fillText('TICKETS', w / 2, 20);
    }, { clampU: true, clampV: true });
    const ledTex = () => canvasTex('luxtram:led', 256, 96, (c, w, h) => {
      c.fillStyle = '#0d0f11';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffb02e';
      c.font = '700 22px "Courier New", monospace';
      c.textAlign = 'left';
      c.fillText("T1  Stadion       2'", 12, 30);
      c.fillText("T1  Findel        9'", 12, 58);
      c.fillText('T1  Stadion    10:12', 12, 86);
      c.strokeStyle = '#3c4146';
      c.lineWidth = 4;
      c.strokeRect(2, 2, w - 4, h - 4);
    }, { clampU: true, clampV: true });
    const tactileTex = () => canvasTex('luxtram:tactile', 64, 128, (c, w, h) => {
      c.fillStyle = '#d9d4c7';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#34383c';
      c.fillRect(0, 0, w * 0.1, h);
      c.fillRect(w * 0.9, 0, w * 0.1, h);
      c.fillStyle = '#bcb6a6';
      for (let x = w * 0.17; x < w * 0.84; x += 6) c.fillRect(x, 0, 2.5, h);
      c.fillStyle = '#e9e5d9';
      for (let x = w * 0.17 + 3; x < w * 0.84; x += 6) c.fillRect(x, 0, 1.5, h);
      c.fillStyle = 'rgba(40,40,40,0.35)';
      c.fillRect(0, h - 1, w, 1);
    }, { clampU: true });

    const adB = sets.get('luxtram-ads', () => M.sign('luxtram-ads', adTex()));
    const ticketB = sets.get('luxtram-ticket', () => M.tex('luxtram-ticket', ticketTex()));
    const ledB = sets.get('luxtram-led', () => M.sign('luxtram-led', ledTex()));
    const tactB = sets.get('luxtram-tactile', () => M.tex('luxtram-tactile', tactileTex(), { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const signB = sets.get('sign:' + st.name, () => M.sign(st.name, helpers.signTexture(st.name, 'tram')));

    /* ---------- placement ---------- */
    // frame at platform position (z, lat from the track centre): object axes ox = local +x, oz = local +z; yaw follows the curved platform
    const frame = (z, lat) => {
      const p = spot(z, lat);
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      return {
        yaw: p.yaw,
        pt: (ox, y, oz) => [p.x + ox * c + oz * s, p.y + H + y, p.z - ox * s + oz * c],
        dir: (nx, nz) => [nx * c + nz * s, -nx * s + nz * c],
      };
    };
    const B = (b, f, ox, y, oz, sizeX, sizeY, sizeZ, color, rz) => {
      const q = f.pt(ox, y, oz);
      b.box(q[0], q[1], q[2], sizeX, sizeY, sizeZ, color, f.yaw, 0, rz || 0);
    };
    const back = sx; // object x direction pointing from the track towards the platform back
    const latBack = island ? edge + W / 2 : Math.min(edge + 2.95, edge + W - 0.12);
    // a quad facing the track side (or +/-z) at the frame: w along the platform, h up; uv = [u0,u1]
    const faceQuad = (b, f, ox, y, oz, w, h, nx, nz, uv, color) => {
      // a viewer in front of the quad looks along -normal; his right-hand direction in the (x,z) plane is (nz, -nx)
      const rx = nz;
      const rz = -nx;
      const hw = w / 2;
      const A = f.pt(ox - rx * hw, y - h / 2, oz - rz * hw);
      const Bq = f.pt(ox + rx * hw, y - h / 2, oz + rz * hw);
      const C = f.pt(ox + rx * hw, y + h / 2, oz + rz * hw);
      const D = f.pt(ox - rx * hw, y + h / 2, oz - rz * hw);
      const n = f.dir(nx, nz);
      b.quad(A, Bq, C, D, [n[0], 0, n[1]], color || WHITE, [[uv[0], 0], [uv[1], 0], [uv[1], 1], [uv[0], 1]]);
    };

    /* ---------- tactile guidance strip along the platform edge (+ the far edge of an island) ---------- */
    const strip = (latA, latB) => {
      const n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const sa = st.platformStart + (k * L) / n;
        const sb = st.platformStart + ((k + 1) * L) / n;
        const A = place(sa, sx * latA);
        const Bp = place(sa, sx * latB);
        const C = place(sb, sx * latB);
        const D = place(sb, sx * latA);
        const y = H + 0.006;
        tactB.quad([A.x, A.y + y, A.z], [Bp.x, Bp.y + y, Bp.z], [C.x, C.y + y, C.z], [D.x, D.y + y, D.z], [0, 1, 0], WHITE, [[0, sa], [1, sa], [1, sb], [0, sb]]);
      }
    };
    if (curved) {
      strip(edge + 0.09, edge + 0.86);
      if (island) strip(edge + W - 0.86, edge + W - 0.09);
    }

    /* Findel airport: light plank paving with dark guide lines on the island (overlay between the tactile strips) */
    if (cfg.planks && curved) {
      const plankB = sets.get('luxtram-planks', () => M.tex('luxtram-planks', canvasTex('luxtram:planks', 128, 256, (c, w, h) => {
        c.fillStyle = '#d8ccb2';
        c.fillRect(0, 0, w, h);
        const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
        for (let r = 0; r < 4; r++) {
          for (let k = 0; k < 4; k++) {
            const sh = 196 + Math.floor(rnd(r * 7 + k) * 40);
            c.fillStyle = 'rgb(' + sh + ',' + (sh - 8) + ',' + (sh - 30) + ')';
            c.fillRect(r * (w / 4) + 1, k * (h / 4) + 1, w / 4 - 2, h / 4 - 2);
          }
        }
        c.fillStyle = '#4b4943';
        c.fillRect(0, 0, 4, h);
        c.fillRect(w - 4, 0, 4, h);
      }, {}), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const sa = st.platformStart + (k * L) / n;
        const sb = st.platformStart + ((k + 1) * L) / n;
        const A = place(sa, sx * (edge + 0.9));
        const Bp = place(sa, sx * (edge + W - 0.9));
        const C = place(sb, sx * (edge + W - 0.9));
        const D = place(sb, sx * (edge + 0.9));
        const y = H + 0.004;
        plankB.quad([A.x, A.y + y, A.z], [Bp.x, Bp.y + y, Bp.z], [C.x, C.y + y, C.z], [D.x, D.y + y, D.z], [0, 1, 0], WHITE, [[0, sa / 1.6], [1, sa / 1.6], [1, sb / 1.6], [0, sb / 1.6]]);
      }
    }

    /* ---------- advertising vitrine (backlit, faces the track) ---------- */
    let adCell = (hashName(st.name) % 4 + 4) % 4;
    const vitrine = (z, lat) => {
      const f = frame(z, lat);
      B(vc, f, 0, 1.0, 0, 0.17, 2.0, 1.34, cDark);
      B(vc, f, 0, 2.05, 0, 0.2, 0.08, 1.4, cDark);
      const cell = adCell % 4;
      adCell += 1;
      faceQuad(adB, f, -back * 0.09, 1.0, 0, 1.12, 1.76, -back, 0, [cell / 4, (cell + 1) / 4]);
      // poster on the back as well (the vitrine is double-sided at island stops)
      if (island) faceQuad(adB, f, back * 0.09, 1.0, 0, 1.12, 1.76, back, 0, [((cell + 2) % 4) / 4, (((cell + 2) % 4) + 1) / 4]);
    };

    /* ---------- shelter (the Luxtram stop shelter) ---------- */
    const shelter = (z, len, withSign) => {
      const rF = Math.max(edge + 0.85, 2.4);
      const rB = (island ? latBack + Math.min(1.5, (W - 0.9) / 2) : latBack + 0.22);
      const rFront = island ? latBack - Math.min(1.5, (W - 0.9) / 2) : rF;
      const midLat = (rFront + rB) / 2;
      const depth = rB - rFront;
      const f = frame(z, midLat);
      const roofY = 2.72;
      // roof slab + visible light/dark underside + front lip
      B(vc, f, 0, roofY, 0, depth, 0.08, len + 0.5, col(tone.roof), 0);
      B(glow, f, 0, roofY - 0.055, 0, depth - 0.1, 0.02, len + 0.4, col(tone.under));
      B(vc, f, -back * (depth / 2 - 0.01), roofY - 0.06, 0, 0.06, 0.26, len + 0.5, col(tone.trim));
      B(vc, f, back * (depth / 2 - 0.01), roofY - 0.06, 0, 0.06, 0.22, len + 0.5, col(tone.trim));
      // posts: ends front + back, intermediate on the back line
      const postC = col(tone.frame);
      const nPosts = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i <= nPosts; i++) {
        const dz = -len / 2 + 0.15 + ((len - 0.3) * i) / nPosts;
        B(vc, f, back * (depth / 2 - 0.12), 1.32, dz, 0.07, 2.64, 0.07, postC);
        if (i === 0 || i === nPosts) B(vc, f, -back * (depth / 2 - 0.2), 1.32, dz, 0.07, 2.64, 0.07, postC);
      }
      // glass: back wall + both ends
      const gz = glass;
      B(gz, f, back * (depth / 2 - 0.12), 1.2, 0, 0.02, 2.0, len - 0.35, WHITE);
      [-1, 1].forEach((d) => B(gz, f, -back * 0.05, 1.2, d * (len / 2 - 0.15), depth - 0.5, 1.9, 0.02, WHITE));
      if (island) B(gz, f, -back * (depth / 2 - 0.2), 1.2, 0, 0.02, 2.0, len - 0.35, WHITE);
      // bench (dark slab on two feet) + a leaning rail
      const bl = Math.min(len * 0.62, 4.6);
      B(vc, f, back * (depth / 2 - 0.55), 0.46, 0, 0.42, 0.05, bl, col(tone.bench));
      [-0.42, 0.42].forEach((d) => B(vc, f, back * (depth / 2 - 0.55), 0.22, d * bl, 0.08, 0.44, 0.1, cDark));
      B(vc, f, back * (depth / 2 - 0.2), 0.96, 0, 0.06, 0.06, bl * 0.9, col(tone.trim));
      // lights under the roof
      for (let d = -len / 2 + 1; d < len / 2; d += 2.4) {
        const q = f.pt(0, roofY - 0.1, d);
        glow.box(q[0], q[1], q[2], 0.3, 0.03, 0.12, col('#fff3d0'), f.yaw);
      }
      // extra name plate on shelters that do not carry the generic one
      if (withSign) faceQuad(signB, f, back * (depth / 2 - 0.15), 2.18, 0, 1.5, 0.3, -back, 0, [0, 1]);
      if (withSign) B(vc, f, back * (depth / 2 - 0.12), 2.18, 0, 0.03, 0.34, 1.56, cDark);
    };
    cfg.shelters.forEach((s) => shelter(s.z, s.len, Math.abs(s.z) > 1));

    /* ---------- ticket machine, departure pole, ad vitrines, bins, lamps ---------- */
    const ticketLat = island ? latBack - 0.4 : Math.min(edge + 2.35, edge + W - 0.5);
    if (cfg.ticket != null) {
      const f = frame(cfg.ticket, ticketLat);
      B(vc, f, 0, 0.82, 0, 0.42, 1.64, 0.7, col('#d4d8db'));
      faceQuad(ticketB, f, -back * 0.216, 1.02, 0, 0.7, 1.2, -back, 0, [0, 1]);
      B(vc, f, 0, 1.67, 0, 0.46, 0.05, 0.74, cDark);
    }
    (cfg.ads || []).forEach((z) => vitrine(z, island ? latBack : Math.min(latBack - 0.1, edge + W - 0.45)));
    if (cfg.led != null) {
      const f = frame(cfg.led, island ? latBack + 0.6 : Math.min(edge + 1.5, edge + W - 0.7));
      B(vc, f, 0, 1.5, 0, 0.085, 3.0, 0.085, col('#3a3f44'));
      B(vc, f, 0, 2.85, 0, 0.1, 0.4, 0.8, cDark);
      faceQuad(ledB, f, 0, 2.85, 0.055, 0.74, 0.34, 0, 1, [0, 1]);
      faceQuad(ledB, f, 0, 2.85, -0.055, 0.74, 0.34, 0, -1, [0, 1]);
    }
    (cfg.bins || []).forEach((z) => {
      const f = frame(z, island ? latBack + 1.1 : edge + W - 0.35);
      vc.cyl(...f.pt(0, 0.4, 0), 0.22, 0.8, col('#4c5156'));
      B(vc, f, 0, 0.82, 0, 0.46, 0.05, 0.46, cDark);
    });
    (cfg.lamps || []).forEach((z) => {
      const f = frame(z, island ? edge + W / 2 : edge + W - 0.3);
      B(vc, f, 0, 2.7, 0, 0.1, 5.4, 0.1, col('#2b2f33'));
      B(vc, f, -back * 0.5, 5.35, 0, 1.0, 0.07, 0.07, col('#2b2f33'));
      const q = f.pt(-back * 1.0, 5.3, 0);
      glow.box(q[0], q[1], q[2], 0.55, 0.06, 0.28, col('#fff1c8'), f.yaw);
    });

    /* ---------- railing behind the platform / ornamental iron fence ---------- */
    if (!island && (cfg.rail || cfg.fence)) {
      const rail = col('#2b2f33');
      const lat = edge + W - 0.05;
      const h = cfg.fence === 'iron' ? 1.9 : 1.05;
      const step = cfg.fence === 'iron' ? 1.6 : 2.0;
      let prev = null;
      for (let z = zB + 3; z <= zA - 3 + 0.01; z += step) {
        const p = spot(z, lat);
        const gap = z > -10.5 && z < -6.5; // a crossing gap
        const top = [p.x, p.y + H + h, p.z];
        vc.box(p.x, p.y + H + h / 2, p.z, 0.05, h, 0.05, rail);
        if (cfg.fence === 'iron') vc.box(p.x, p.y + H + h + 0.1, p.z, 0.09, 0.18, 0.09, rail);
        if (prev && !gap && !prev.gap) {
          [h - 0.03, h * 0.66, h * 0.33].forEach((hh, k) => {
            vc.between([prev.p.x, prev.p.y + H + hh, prev.p.z], [p.x, p.y + H + hh, p.z], k === 0 ? 0.04 : 0.025, rail, k === 0 ? 0.05 : 0.03);
          });
          if (cfg.fence === 'iron') {
            const a = [prev.p.x, prev.p.y + H, prev.p.z];
            for (let u = 0.125; u < 1; u += 0.125) vc.box(a[0] + (p.x - a[0]) * u, p.y + H + h / 2, a[2] + (p.z - a[2]) * u, 0.03, h, 0.03, rail);
          }
        }
        prev = { p, gap, top };
      }
      if (cfg.fence === 'iron') {
        const q = spot(0, lat + 0.25);
        vc.box(q.x, q.y + H + 0.25, q.z, 0.5, 0.5, L - 6, col('#a29c8e'), q.yaw);
      }
    }

    /* ---------- special add-ons ---------- */
    (cfg.extras || []).forEach((name) => {
      if (name === 'veloh') {
        // Vel'oh dock row with a blue totem, at the platform end behind the shelters
        const z0 = (cfg.island ? 20 : 19);
        const lat = island ? edge + W - 0.7 : edge + W - 0.5;
        const f0 = frame(z0, lat);
        B(vc, f0, 0, 1.05, 0, 0.32, 2.1, 0.5, col('#1c4f88'));
        B(vc, f0, -back * 0.17, 1.4, 0, 0.02, 0.8, 0.3, col('#cfe6f7'));
        for (let k = 1; k <= 6; k++) {
          const f = frame(z0 - 1.5 - k * 0.9, lat);
          B(vc, f, 0, 0.45, 0, 0.14, 0.9, 0.14, col('#2d3237'));
          if (k % 2 === 1) {
            // Vel'oh bike: two dark wheels + a blue frame, parked across the dock row
            [-0.55, 0.55].forEach((dz) => { const w = f.pt(0, 0.34, dz); vc.cyl(w[0], w[1], w[2], 0.34, 0.05, col('#26292c'), f.yaw, 0, Math.PI / 2); });
            B(vc, f, 0, 0.62, 0, 0.05, 0.06, 1.0, col('#2478c7'));
            B(vc, f, 0, 0.5, 0.3, 0.05, 0.5, 0.06, col('#2478c7'), 0);
            B(vc, f, 0, 0.98, 0.45, 0.4, 0.05, 0.08, col('#26292c'));
          }
        }
      } else if (name === 'bollards') {
        for (let z = zB + 10; z < zA - 14; z += 1.8) {
          const p = spot(z, edge + W - 0.2);
          vc.box(p.x, p.y + H + 0.45, p.z, 0.16, 0.9, 0.16, col('#34393e'));
        }
      } else if (name === 'mbox') {
        // mBox bike box: perforated anthracite container with a magenta label
        const f = frame(zA - 4, edge + W - 1.1);
        B(vc, f, 0, 1.15, 0, 2.0, 2.3, 4.4, col('#565d63'));
        B(vc, f, -back * 1.02, 1.1, 0, 0.03, 1.1, 1.6, col('#c02e92'));
        B(vc, f, 0, 2.33, 0, 2.1, 0.08, 4.5, col('#3a4046'));
      }
    });

    /* ---------- Luxexpo: leaf-shaped glass canopy on tree columns ---------- */
    if (cfg.wing) wing();

    function wing() {
      const dark = sets.get('luxtram-steel', () => mat('luxtram-steel', () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 })), true);
      const pv = sets.get('luxtram-wing', () => mat('luxtram-wing', () => new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, transparent: true, opacity: 0.66, roughness: 0.25, metalness: 0.3, side: T.DoubleSide, depthWrite: false })));
      const lats = [edge + W + 0.35, edge + W * 0.78, edge + W * 0.52, edge + W * 0.28, Math.max(edge + 0.8, 2.45)];
      const profile = [3.7, 4.5, 5.0, 4.7, 4.1];   // leaf arch: highest over the column, curving down to both edges
      const nz = 30;
      const z0 = -19.5;
      const z1 = 19.5;
      const heightAt = (li, z) => profile[li] + 5.2 * smooth(11, 19.5, z) * (0.3 + 0.7 * (li / (lats.length - 1)));
      const grid = [];
      for (let j = 0; j <= nz; j++) {
        const z = z0 + ((z1 - z0) * j) / nz;
        grid.push(lats.map((lat, li) => { const p = spot(z, lat); return [p.x, p.y + H + heightAt(li, z), p.z]; }));
      }
      const steel = col('#837e76');
      const steelDk = col('#5d5a55');
      for (let j = 0; j <= nz; j++) {
        for (let li = 0; li < lats.length - 1; li++) dark.between(grid[j][li], grid[j][li + 1], 0.07, steel, 0.3);
      }
      for (let li = 0; li < lats.length; li += li === 3 ? 2 : 1) {
        for (let j = 0; j < nz; j++) dark.between(grid[j][li], grid[j + 1][li], 0.1, steelDk, 0.12);
      }
      for (let j = 0; j < nz; j++) {
        for (let li = 0; li < lats.length - 1; li++) {
          const shadeV = (j + li) % 3 === 0 ? 0.8 : 1;
          pv.quad(grid[j][li], grid[j][li + 1], grid[j + 1][li + 1], grid[j + 1][li], [0, 1, 0], [0.6 * shadeV, 0.74 * shadeV, 0.88 * shadeV]);
        }
      }
      // four curved tree columns with branches into the ribs
      [-14, -4.7, 4.7, 14].forEach((z) => {
        const lat0 = edge + W - 0.85;
        const pts = [0, 0.34, 0.68, 1].map((u) => {
          const p = spot(z, lat0 - 0.9 * u * u);
          return [p.x, p.y + H + 4.6 * u, p.z];
        });
        for (let i = 0; i < pts.length - 1; i++) dark.between(pts[i], pts[i + 1], 0.46 - 0.09 * i, steelDk);
        const jz = Math.round(((z - z0) / (z1 - z0)) * nz);
        const gj = (d) => grid[Math.max(0, Math.min(nz, jz + d))];
        [[0, 1], [0, 3], [0, 4], [-3, 2], [3, 2], [-6, 1], [6, 1], [-6, 3], [6, 3]].forEach(([d, li]) => dark.between(pts[3], gj(d)[li], 0.09, steelDk));
      });
    }
  }

  function hashName(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  }

  /* Footprints of everything standing on a platform, for the passengers (pb/train-sim/passengers.js): { s, o, hs, ho } = centre along the track,
   * lateral distance from the track centre, half size along / across (people keep out of them). Mirrors the placement rules of buildStop. */
  function obstacles(name, p) {
    const cfg = LAYOUT[name];
    if (!cfg || !p) return [];
    const { edge, width: W, island } = p;
    const sMid = (p.platformStart + p.platformEnd) / 2;
    const out = [];
    const add = (z, lat, hz, hl) => out.push({ s: sMid - z, o: lat, hs: hz, ho: hl });
    const latBack = island ? edge + W / 2 : Math.min(edge + 2.95, edge + W - 0.12);
    (cfg.shelters || []).forEach((sh) => {
      const rB = island ? latBack + Math.min(1.5, (W - 0.9) / 2) : latBack + 0.22;
      const bl = Math.min(sh.len * 0.62, 4.6);
      add(sh.z, rB - 0.55, bl / 2 + 0.3, 0.4);                       // bench
      add(sh.z, rB - 0.1, sh.len / 2 + 0.3, 0.1);                    // glass back wall
      const rFr = island ? latBack - Math.min(1.5, (W - 0.9) / 2) : Math.max(edge + 0.85, 2.4);
      [-1, 1].forEach((d) => add(sh.z + d * (sh.len / 2 - 0.15), (rFr + rB) / 2 - 0.05, 0.1, (rB - rFr - 0.5) / 2 + 0.1));   // glass end panels
    });
    if (cfg.ticket != null) add(cfg.ticket, island ? latBack - 0.4 : Math.min(edge + 2.35, edge + W - 0.5), 0.6, 0.5);
    (cfg.ads || []).forEach((z) => add(z, island ? latBack : Math.min(latBack - 0.1, edge + W - 0.45), 0.85, 0.45));
    if (cfg.led != null) add(cfg.led, island ? latBack + 0.6 : Math.min(edge + 1.5, edge + W - 0.7), 0.35, 0.35);
    (cfg.bins || []).forEach((z) => add(z, island ? latBack + 1.1 : edge + W - 0.35, 0.4, 0.4));
    (cfg.lamps || []).forEach((z) => add(z, island ? edge + W / 2 : edge + W - 0.3, 0.3, 0.3));
    (cfg.extras || []).forEach((e) => {
      if (e === 'veloh') add(cfg.island ? 20 - 4.5 : 19 - 4.5, island ? edge + W - 0.7 : edge + W - 0.5, 5.2, 0.7);
      if (e === 'mbox') add((sMid - p.platformStart) - 4, edge + W - 1.1, 2.4, 1.2);
    });
    if (cfg.wing) [-14, -4.7, 4.7, 14].forEach((z) => add(z, edge + W - 0.85, 0.6, 0.6));
    return out;
  }
  window.TS.luxtramObstacles = obstacles;

  const spec = { kind: 'tram', canopy: false, furniture: false, build: buildStop };
  Object.keys(LAYOUT).forEach((name) => RS.register(name, spec));
})();
