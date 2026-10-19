/* Kart Lëtzebuerg — fantasy track 2: Zockerland (candy land). Original design: icing road, a layer-cake mountain with a chocolate river
 * that the last straight crosses on a kicker (ford), a rainbow sugar arch, honey puddles, a gumdrop shortcut, banked sweepers. */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, K = KL.kit, L = KL.lm;
  const CAKE = [70, 118], FORD = 1407;
  let FIELD = null;

  const PAL = ['#ff7eb6', '#7fd8ff', '#ffe066', '#9be37a', '#b78cff', '#ff9a5c', '#ffffff', '#ff5f7e'];

  /* the chocolate river: a meandering line that crosses the last straight at the ford, flowing from under the cake hill to the horizon */
  function riverPts(track) {
    const f = track.at(FORD, 0), rx = -f.tz, rz = f.tx, out = [];       // local: along the road (tx,tz), lateral = right (rx,rz); river runs along the lateral axis
    for (let v = -330; v <= 210; v += 30) { const u = Math.sin(v * 0.021) * 22 + Math.sin(v * 0.053 + 1) * 8 - (v > 60 ? (v - 60) * 0.28 : 0) - v * 0.05 * (v < 0 ? -1 : 0); out.push([f.x + f.tx * u + rx * v, f.z + f.tz * u + rz * v]); }
    // pin the crossing: the river passes exactly through the ford centre
    const k = out.findIndex((p, i) => (-330 + i * 30) >= 0); out[k] = [f.x, f.z];
    return out;
  }

  KL.registerTrack({
    id: 'zockerland',
    speedMul: 1.06,
    /* chocolate ford on the last straight: kicker (rise 9 m, lip), river bed 15 m wide, exit ramp; a marshmallow hop mid-lap */
    ramps: [{ s: 1388, k: [[0, 0], [9, 2.2], [10.5, -1.8], [12, -3.2], [27, -3.2], [36, 0]] }, { s: 804, k: [[0, 0], [8, 1.7], [9.5, 0]] }],
    patches: [{ s0: 1400, s1: 1418, d0: -12, d1: 12, kind: 'goo' }, { s0: 696, s1: 742, d0: -11, d1: -3, kind: 'goo' }, { s0: 970, s1: 1010, d0: 2, d1: 10, kind: 'goo' }],
    pads: [[170, 0, 10], [1372, 0, 10], [800, 0, 8], [426, 31.6, 9, -0.62], [497, 28.9, 9, 0.23]],
    extraBoxes: [[460, 33], [465, 30]],
    alts: [{ hw: 4.6, pts: [[266.9, 90.6], [229, 189.9]] }],
    theme: {
      weathers: ['day', 'sunset', 'night', 'rain'], startText: 'ZOCKERLAND', facade: 'old', buildings: false, lamps: false, skyline: false,
      roadStyle: 'candy', vergeTex: ['#a8ecc4', '#7fd3a4', '#d8fae6', { dots: ['#ff7eb6', '#ffe066', '#7fd8ff', '#ffffff'] }], kerbColors: ['#ff5fa2', '#ffffff'],
      ground: 'grass', groundTex: ['#b4efc9', '#8edcae', '#e2fbec', { dots: ['#ff7eb6', '#ffe066', '#7fd8ff', '#ffffff', '#b78cff'] }], groundY: 0, groundCell: 12, groundColor: '#b4efc9',
      wallStyle: 'icing', wallColor: '#ffd9ea', wallTop: '#ffffff', wallH: 1.3, vergeColor: '#ffffff', fogScale: 1.15, farColor: '#f3b9d2', farDrop: -30, depth: [8, 12],
      weatherTint: {
        day: { sky: ['#6ec6ff', '#ffe7f3'], fog: '#ffe3f1', hemi: ['#fffafc', '#e9a9c6', 1.05] },
        sunset: { sky: ['#8f5cf0', '#ffa0bf'], fog: '#ffb4c8', hemi: ['#ffd1c8', '#9a5a86', 0.9] },
        night: { sky: ['#140b3d', '#7a2f9c'], fog: '#3a1f63', hemi: ['#a58cff', '#3a2a6a', 0.7] },
        rain: { sky: ['#8a93c4', '#d4c4e6'], fog: '#c9bede', hemi: ['#e8def5', '#8a7aa6', 0.88] },
      },
      groundColorAt(x, z, h) {
        const n = Math.sin(x * 0.045) * Math.cos(z * 0.04) * 0.5 + 0.5, m = Math.sin(x * 0.013 + 2) * Math.sin(z * 0.017) * 0.5 + 0.5;
        const mint = [1, 1, 1], pink = [1.0, 0.82, 0.9], lilac = [0.92, 0.86, 1.0];
        let c = KL.mix(KL.mix(mint, pink, smooth(0.35, 0.65, n)), lilac, smooth(0.55, 0.8, m) * 0.7);
        if (FIELD) { const d = FIELD(x, z); if (d < 22) c = KL.mix([0.55, 0.36, 0.26], c, smooth(10, 22, d)); }
        return c;
      },
    },
    makeTerrain(track) {
      const sc = {};
      let field = null;
      const river = () => field || (field = FIELD = K.distField([riverPts(track)], -700, -500, 700, 700, 6));
      const base = (x, z, dR) => {
        const r = Math.hypot(x - CAKE[0], z - CAKE[1]), calm = smooth(8, 46, dR);
        const n = (3.4 * Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 2 * Math.sin(x * 0.052 + z * 0.041) + 0.9 * Math.sin(x * 0.12) * Math.cos(z * 0.1)) * calm;
        const far = 30 * smooth(300, 560, Math.hypot(x - 20, z - 120));
        return n + far + 6.5 * (1 - smooth(52, 92, r)) - 3.7 * (1 - smooth(7, 15, dR));
      };
      return (x, z) => {
        const p = track.project(x, z, -1, null, sc), dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + (p.d >= 0 ? p.wr : p.wl) + 0.8;
        const t = smooth(flat, flat + 30, dist), dR = river()(x, z);
        return lerp(Math.min(p.cy, p.by) - 0.4, base(x, z, dR), t);
      };
    },
    zones: [],
    decorate(S) {
      const { add, mats, track, rnd, renderer, quality } = S, M = mats;
      const B = new KL.Batch(), E = new KL.Batch(), terr = track.terrain, q = quality;
      const wafer = col('#d9a35c');
      K.skirts(S, wafer);
      K.patchDecals(S, { goo: { a: '#d99a2b', b: '#f6c453', glints: '#fff3b0', opacity: 0.95 } });
      /* second route: a gingerbread path */
      {
        const path = (() => { const [c, g] = K.cv(128, 128), r = KL.rng(4); g.fillStyle = '#c98a4b'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 40; i++) { g.fillStyle = r() > 0.5 ? '#b57638' : '#dba46a'; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(r() * 128, r() * 128, 3 + r() * 9, 2 + r() * 5, r() * 3, 0, 7); g.fill(); } g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(4, 0, 4, 128); g.fillRect(120, 0, 4, 128); for (let i = 0; i < 6; i++) { g.fillStyle = PAL[i]; g.beginPath(); g.arc(64, 12 + i * 21, 4, 0, 7); g.fill(); } return K.canvasTex(g.canvas); })();
        K.altRoads(S, { mat: new T.MeshLambertMaterial({ map: path, vertexColors: true }) });
      }
      /* ---- chocolate river with the ford ---- */
      {
        const pts = riverPts(track), y = track.at(FORD, 0).y + 0.5;
        const [c, g] = K.cv(128, 256), r = KL.rng(8); g.fillStyle = '#5b2e1b'; g.fillRect(0, 0, 128, 256);
        for (let i = 0; i < 60; i++) { g.strokeStyle = r() > 0.5 ? '#7d4529' : '#3f1f10'; g.globalAlpha = 0.5; g.lineWidth = 2 + r() * 5; g.beginPath(); const x = r() * 128, y0 = r() * 256; g.moveTo(x, y0); g.bezierCurveTo(x + 14, y0 + 20, x - 14, y0 + 40, x + 6, y0 + 64); g.stroke(); }
        g.globalAlpha = 1; for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(255,220,170,.45)'; g.beginPath(); g.ellipse(r() * 128, r() * 256, 2 + r() * 5, 1 + r() * 2, 0, 0, 7); g.fill(); }
        const tex = K.canvasTex(c), mat = new T.MeshPhongMaterial({ map: tex, specular: new T.Color(0x886655), shininess: 60, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        K.river(S, pts, 15, y, mat, 24); renderer.animators.push((dt) => { tex.offset.y -= dt * 0.06; });
      }
      /* ---- candy canes along the road, lollipops, gumdrop trees ---- */
      const cane = (x, y, z, h) => { const seg = 6, hh = h / seg; for (let i = 0; i < seg; i++) B.cyl(x, y + i * hh, z, 0.2, 0.2, hh, 6, i % 2 ? col('#ffffff') : col('#ff3d6e'), { flat: true }); B.sphere(x, y + h, z, 0.3, 5, col('#ff3d6e')); };
      for (let s = 12; s < track.length; s += 24) for (const sd of [-1, 1]) {
        const ci = Math.floor(s / track.step) % track.N, lim = track.HW[ci] + (sd < 0 ? track.WL[ci] : track.WR[ci]) + 0.9; if (lim > 20) continue;
        const p = track.at(s + (sd > 0 ? 12 : 0), sd * lim); cane(p.x, p.y, p.z, 3.1);
      }
      const gumTree = (x, y, z, k, c1) => { B.cyl(x, y, z, 0.35 * k, 0.28 * k, 2.2 * k, 5, col('#f6f0e0')); B.sphere(x, y + 3.1 * k, z, 2.1 * k, 8, col(c1), { sy: 1.15, noise: 1 }); for (let i = 0; i < 6; i++) { const a = i * 1.1 + k, rr = 1.45 * k; B.sphere(x + Math.cos(a) * rr, y + (2.5 + (i % 3) * 0.8) * k, z + Math.sin(a) * rr, 0.22 * k, 4, col('#ffffff')); } };
      const lolli = (x, y, z, k, c1, c2) => { B.cyl(x, y, z, 0.16 * k, 0.16 * k, 3.4 * k, 5, col('#ffffff')); const cy = y + 4.2 * k; B.cyl(x, cy - 0.3 * k, z, 1.5 * k, 1.5 * k, 0.6 * k, 12, col(c1), { capTop: true, flat: true }); B.cyl(x, cy - 0.31 * k, z, 0.9 * k, 0.9 * k, 0.64 * k, 8, col(c2), { capTop: true, flat: true }); };
      const box = [-440, -300, 460, 460];
      K.scatter(S, rnd, Math.round(120 * q.trees), box, 5, (x, y, z, i) => { if (Math.hypot(x - CAKE[0], z - CAKE[1]) < 70) return false; if (i % 3 === 0) lolli(x, y, z, 0.9 + rnd() * 0.9, PAL[Math.floor(rnd() * 5)], PAL[6]); else gumTree(x, y, z, 0.9 + rnd() * 0.9, PAL[Math.floor(rnd() * 5)]); });
      /* ---- gingerbread houses ---- */
      const house = (x, y, z, yaw, w, d, h) => {
        const f = { x, y, z, yaw }, body = col(rnd() < 0.5 ? '#c98a4b' : '#b9733a'), ic = col('#ffffff'), rc = col(PAL[Math.floor(rnd() * 5)]);
        L.box(B, f, 0, 0, 0, w, h, d, 0, body); L.box(B, f, 0, h - 0.5, d / 2 + 0.05, w + 0.3, 0.45, 0.25, 0, ic); L.box(B, f, 0, 0, d / 2 + 0.05, w + 0.3, 0.4, 0.25, 0, ic);
        L.gable(B, f, 0, h, 0, w, d, h * 0.55, col('#fff4f8'), 0.7);
        L.box(B, f, -w * 0.28, 0.1, d / 2 + 0.06, 1.3, 2.3, 0.2, 0, col('#6d3b1d')); L.box(E, f, w * 0.18, h * 0.38, d / 2 + 0.08, 1.4, 1.5, 0.2, 0, col('#ffe066')); L.box(E, f, w * 0.38, h * 0.38, d / 2 + 0.08, 1.4, 1.5, 0.2, 0, col('#ffb3d9'));
        for (let i = 0; i < 6; i++) L.sphere(B, f, (i - 2.5) * w * 0.15, h + 0.15 + (i % 2) * 0.6, d * 0.05 * (i % 3 - 1), 0.32, 5, col(PAL[(i + 2) % 7]));
        cane(f.x + Math.cos(yaw) * (w / 2 + 0.6), y, f.z - Math.sin(yaw) * (w / 2 + 0.6), 3);
      };
      for (const [s, sd, off] of [[-40, -1, 16], [-12, 1, 17], [40, -1, 20], [74, 1, 22], [130, -1, 18], [165, 1, 18], [1470, -1, 16], [1440, 1, 18], [1305, 1, 20], [1180, 1, 22], [890, -1, 22], [820, 1, 24], [610, -1, 26]]) {
        const a = track.at(s, 0), lim = a.hw + 2.8, p = track.at(s, sd * (lim + off));
        house(p.x, terr(p.x, p.z) - 0.1, p.z, Math.atan2(a.tz * sd, -a.tx * sd), 7 + rnd() * 3, 6 + rnd() * 2, 5 + rnd() * 1.5);
      }
      /* ---- the layer cake ---- */
      {
        const f = { x: CAKE[0], y: terr(CAKE[0], CAKE[1]) - 0.2, z: CAKE[1], yaw: 0 };
        const layers = [[44, 12, '#6b3a22', '#fff1d6'], [34, 11, '#ff93bf', '#ffffff'], [24, 10, '#fff0d4', '#ff7eb6'], [14.5, 7, '#9be37a', '#ffffff']];
        let y = 0;
        layers.forEach(([r, h, c, band], li) => {
          L.cyl(B, f, 0, y, 0, r, r, h, 24, col(c), { capTop: true }); L.cyl(B, f, 0, y + h * 0.42, 0, r + 0.25, r + 0.25, 1.5, 24, col(band), { flat: true });
          L.cyl(B, f, 0, y + h, 0, r + 0.5, r + 0.5, 0.9, 24, col(band), { capTop: true, flat: true });
          const n = Math.round(r * 0.75);
          for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + li, dl = 1.6 + ((i * 7) % 5) * 0.9; L.sphere(B, f, Math.cos(a) * (r + 0.4), y + h - dl * 0.4, Math.sin(a) * (r + 0.4), 1.05, 5, col(band), { sy: dl / 1.05 * 0.5 }); }
          y += h + 0.9;
        });
        L.sphere(B, f, 0, y + 4.3, 0, 5.2, 10, col('#e3173f'), { noise: 1 }); L.cyl(B, f, 0, y + 8.6, 0, 0.3, 0.2, 4.5, 5, col('#3b7a2a'));
        for (let i = 0; i < 5; i++) { const a = i * 1.257, cx = Math.cos(a) * 9, cz = Math.sin(a) * 9; L.cyl(B, f, cx, y - 0.2, cz, 0.55, 0.55, 5.5, 6, col(PAL[i])); L.sphere(E, f, cx, y + 5.9, cz, 0.7, 5, col('#ffd54a')); }
        // a slice cut out of the plate: gumdrop border
        for (let i = 0; i < 32; i++) { const a = (i / 32) * 6.283; L.sphere(B, f, Math.cos(a) * 52, 0.6, Math.sin(a) * 52, 2.2, 6, col(PAL[i % 7]), { sy: 0.7 }); }
      }
      /* ---- chocolate fountain beside the start straight ---- */
      {
        const p0 = track.at(0, 0), fx = p0.x + 95, fz = p0.z - 70, fy = terr(fx, fz), f = { x: fx, y: fy, z: fz, yaw: 0 }, ch = col('#5b2e1b'), chl = col('#8a4a2a');
        L.cyl(B, f, 0, 0, 0, 16, 17, 2.6, 18, col('#f6efe2'), { capTop: true }); L.cyl(B, f, 0, 2.6, 0, 14.5, 14.5, 0.8, 18, ch, { capTop: true, flat: true });
        L.cyl(B, f, 0, 3, 0, 3, 2.4, 12, 10, col('#f6efe2')); L.cyl(B, f, 0, 9.5, 0, 10, 4, 1.6, 14, col('#ff7eb6'), { capTop: true }); L.cyl(B, f, 0, 11.1, 0, 9.2, 9.2, 0.5, 14, ch, { capTop: true, flat: true });
        L.cyl(B, f, 0, 11, 0, 2.2, 1.8, 7, 8, col('#f6efe2')); L.cyl(B, f, 0, 17, 0, 6.5, 2.6, 1.3, 12, col('#7fd8ff'), { capTop: true }); L.cyl(B, f, 0, 18.3, 0, 5.8, 5.8, 0.4, 12, ch, { capTop: true, flat: true }); L.sphere(B, f, 0, 20, 0, 1.7, 6, ch);
        const cm = new T.MeshBasicMaterial({ map: (() => { const [c, g] = K.cv(64, 128); g.fillStyle = '#5b2e1b'; g.fillRect(0, 0, 64, 128); for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#7d4529' : '#47230f'; g.fillRect(i * 9 + 2, 0, 5, 128); } g.fillStyle = 'rgba(255,225,190,.5)'; for (let i = 0; i < 14; i++) g.fillRect(4 + (i * 17) % 56, (i * 37) % 120, 2, 14); return K.canvasTex(c); })(), side: T.DoubleSide, transparent: true, opacity: 0.93 });
        const mkc = (r1, r2, h, y) => { const m = new T.Mesh(new T.CylinderGeometry(r1, r2, h, 14, 1, true), cm); m.position.set(fx, fy + y, fz); S.group.add(m); return m; };
        mkc(6.2, 9.4, 6, 14.6 + 0.0); mkc(9.0, 14.2, 7.2, 7.1); renderer.animators.push((dt) => { cm.map.offset.y -= dt * 0.5; });
      }
      /* ---- rainbow sugar arch over the first straight (four pastel bands, gumdrop feet, sprinkles on top) ---- */
      {
        const s = 108, p = track.at(s, 0), rx = -p.tz, rz = p.tx, base = p.y;
        const R = p.hw + 2.6 + 4.2, T0 = 1.5, bands = ['#ff5f9a', '#ffd23f', '#7be08a', '#59b8ff'];
        const P = (u, v, d) => [p.x + rx * u - p.tx * (d || 0), base + v, p.z + rz * u - p.tz * (d || 0)];
        bands.forEach((c, bi) => {
          const r = R - bi * T0, n = 30, cc = col(c), pts = [];
          for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; pts.push(P(Math.cos(a) * r, 1 + Math.sin(a) * r * 1.05)); }
          for (let i = 0; i < n; i++) L.bar(B, pts[i], pts[i + 1], T0 * 1.02, cc);
        });
        // gumdrop feet on both sides, sprinkles and a cherry on the crown
        for (const sd of [-1, 1]) { const q = P(sd * (R - 2.25), 0.2); B.sphere(q[0], q[1], q[2], 4.4, 9, col('#ffffff'), { sy: 0.55 }); const q2 = P(sd * (R - 2.25), 1.8); B.sphere(q2[0], q2[1], q2[2], 3.0, 8, col(sd < 0 ? '#ff7eb6' : '#b78cff'), { sy: 0.8 }); }
        for (let i = 1; i < 17; i++) { const a = Math.PI * i / 17, q = P(Math.cos(a) * (R + 0.9), 1 + Math.sin(a) * (R + 0.9) * 1.05, 0); B.sphere(q[0], q[1], q[2], 0.7, 5, col(PAL[i % 7])); }
        const top = P(0, 1 + R * 1.05 + 1.8); B.sphere(top[0], top[1], top[2], 1.8, 7, col('#e3173f'), { noise: 1 }); B.cyl(top[0], top[1] + 1.6, top[2], 0.2, 0.15, 1.6, 5, col('#3b7a2a'));
      }
      /* ---- cupcakes, ice-cream towers, donuts around the field ---- */
      K.scatter(S, rnd, Math.round(16 * q.trees), [-380, -240, 420, 420], 14, (x, y, z, i) => {
        if (Math.hypot(x - CAKE[0], z - CAKE[1]) < 80) return false;
        const k = 1.6 + rnd() * 1.2, c1 = PAL[Math.floor(rnd() * 5)];
        if (i % 3 === 0) { B.cyl(x, y, z, 1.2 * k, 2.2 * k, 4 * k, 10, col('#e9b86f')); B.sphere(x, y + 5.2 * k, z, 2.6 * k, 8, col(c1), { sy: 0.95, noise: 1 }); B.sphere(x, y + 7.4 * k, z, 1.7 * k, 7, col(PAL[(i + 3) % 5])); B.sphere(x, y + 9 * k, z, 0.5 * k, 5, col('#e3173f')); }
        else if (i % 3 === 1) { B.cyl(x, y, z, 0.1, 2.4 * k, 6 * k, 8, col('#e9b86f')); B.sphere(x, y + 6.8 * k, z, 2.5 * k, 8, col(c1), { noise: 1 }); B.sphere(x, y + 9 * k, z, 1.8 * k, 7, col(PAL[(i + 1) % 5]), { noise: 1 }); B.sphere(x, y + 10.8 * k, z, 0.6 * k, 5, col('#e3173f')); }
        else { const R2 = 2.7 * k; for (let a = 0; a < 14; a++) { const an = a / 14 * 6.283; B.sphere(x + Math.cos(an) * R2, y + 1.1 * k, z + Math.sin(an) * R2, 1.15 * k, 6, col('#e59a52'), { sy: 0.85, noise: 1 }); B.sphere(x + Math.cos(an) * R2, y + 1.75 * k, z + Math.sin(an) * R2, 0.95 * k, 5, col(c1), { sy: 0.55 }); } }
      });
      /* ---- distant candy mountains ---- */
      for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.283 + rnd() * 0.2, r = 430 + rnd() * 90, x = 20 + Math.cos(a) * r, z = 120 + Math.sin(a) * r * 0.85, h = 50 + rnd() * 45, w = 22 + rnd() * 14, c = PAL[Math.floor(rnd() * 5)], y = terr(x, z) - 4; B.cyl(x, y, z, w, w * 0.12, h, 9, col(c), { noise: 1 }); B.cyl(x, y + h * 0.78, z, w * 0.32, 0.01, h * 0.22, 9, col('#ffffff'), { flat: true }); }
      add(B, M.plain); const em = K.nightOnly(S, E);
      K.glow(S, (() => { const o = []; for (let s = 20; s < track.length; s += 48) for (const sd of [-1, 1]) { const ci = Math.floor(s / track.step) % track.N, lim = track.HW[ci] + (sd < 0 ? track.WL[ci] : track.WR[ci]) + 0.9; if (lim > 20) continue; const p = track.at(s + (sd > 0 ? 24 : 0), sd * lim); o.push(p.x, p.y + 3.4, p.z); } return o; })(), { color: 0xff7eb6, size: 6 });
    },
  });
})();
