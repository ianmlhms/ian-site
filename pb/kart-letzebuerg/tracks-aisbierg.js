/* Kart Lëtzebuerg — fantasy track 3: Äisbierg (ice mountain). Original design: a winter-market village with a Ferris wheel and a Gromperekichelcher
 * stand, a climb round a snowy massif, a slippery ice cave, a summit shortcut, a ski jump over a snow crevasse, ski-lift gondolas, aurora at night. */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, K = KL.kit, L = KL.lm;
  const PEAKS = [[-20, -140, 92, 125], [85, -175, 66, 95], [-135, -130, 58, 80], [190, -140, 48, 70]];
  const JUMP = 124.5, CAVE = [540, 645];
  let FIELD = null;       // distance to the crevasse line (set by makeTerrain, read by the ground colouring)

  function crevassePts(track) {
    const f = track.at(JUMP, 0), rx = -f.tz, rz = f.tx, out = [];
    for (let v = -200; v <= 220; v += 30) { const u = Math.sin(v * 0.03) * 10 + Math.sin(v * 0.071) * 4; out.push([f.x + f.tx * u + rx * v, f.z + f.tz * u + rz * v]); }
    const k = out.findIndex((p, i) => -200 + i * 30 >= 0); out[k] = [f.x, f.z];
    return out;
  }
  const massif = (x, z) => { let h = 0; for (const [px, pz, ph, pr] of PEAKS) { const d = Math.hypot(x - px, z - pz) / pr; if (d < 1) h = Math.max(h, ph * Math.pow(1 - smooth(0, 1, d), 1.25)); } return h; };

  KL.registerTrack({
    id: 'aisbierg',
    speedMul: 1.05,
    autoBank: { k: 3.0, max: 0.12 },
    /* ski jump over a crevasse on the start straight (bed = deep powder: slow if you fall in); snow-bank hops */
    ramps: [{ s: 105, k: [[0, 0], [10, 2.6], [11.5, -1.6], [13, -3.2], [28, -3.2], [38, 0]] }, { s: 255, k: [[0, 0], [8, 1.7], [9.5, 0]] }, { s: 1380, k: [[0, 0], [8, 1.7], [9.5, 0]] }],
    patches: [{ s0: 548, s1: 640, d0: -12, d1: 12, kind: 'ice' }, { s0: 1110, s1: 1178, d0: -11, d1: 3, kind: 'ice' }, { s0: 118, s1: 134, d0: -12, d1: 12, kind: 'goo' }],
    pads: [[190, 0, 10], [545, 0, 9], [88, 0, 10], [1380, 0, 8], [874, -37.6, 9, 0.8], [977, -29.9, 9, -0.5]],
    extraBoxes: [[915, -40], [920, -37]],
    alts: [{ hw: 4.6, pts: [[-69.9, -251.2], [-183.6, -241.4]] }],
    theme: {
      weathers: ['day', 'sunset', 'night', 'snow'], startText: 'ÄISBIERG', facade: 'old', buildings: false, lamps: false, skyline: false,
      roadStyle: 'ice', vergeTex: ['#f4f8ff', '#d6e4f6', '#ffffff', { flakes: '#ffffff' }], kerbColors: ['#2f7de0', '#ffffff'],
      ground: 'grass', groundTex: ['#f1f6ff', '#c9dcf3', '#ffffff', { flakes: '#ffffff' }], groundY: 0, groundCell: 12, groundColor: '#f1f6ff',
      wallStyle: 'snow', wallColor: '#f2f7ff', wallTop: '#ffffff', wallH: 1.5, vergeColor: '#ffffff', fogScale: 1.1, farColor: '#c9d8ec', farDrop: -50,
      weatherTint: {
        day: { sky: ['#3f8fe4', '#e6f3ff'], fog: '#e1eefb', hemi: ['#ffffff', '#9fb8dc', 1.05] },
        sunset: { sky: ['#5a3fa0', '#ff9a78'], fog: '#f0b3a6', hemi: ['#ffc4b4', '#7a6a9a', 0.9] },
        night: { sky: ['#020819', '#17335f'], fog: '#0e1d3d', hemi: ['#8aaaff', '#243a6a', 0.8] },
      },
      groundColorAt(x, z, h) {
        const n = Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.5 + 0.5, w = Math.sin(x * 0.11 + z * 0.07) * 0.5 + 0.5;
        const snow = KL.mix([1, 1, 1], [0.84, 0.9, 1], n * 0.8), rock = [0.5, 0.52, 0.6], ice = [0.5, 0.74, 1.0];
        let c = snow; if (h > 14 && w > 0.62) c = KL.mix(c, rock, smooth(0.62, 0.8, w) * smooth(14, 30, h) * 0.85);
        if (FIELD) { const d = FIELD(x, z); if (d < 20) c = KL.mix(ice, c, smooth(6, 20, d)); }
        return c;
      },
      onWeather: null,
    },
    makeTerrain(track) {
      const sc = {}; let field = null;
      const fld = () => field || (field = FIELD = K.distField([crevassePts(track)], -700, -700, 700, 500, 6));
      const base = (x, z, dC) => {
        const calm = smooth(8, 50, dC), n = (2.6 * Math.sin(x * 0.022 + 1) * Math.cos(z * 0.019) + 1.4 * Math.sin(x * 0.07 + z * 0.05)) * calm;
        const far = 70 * smooth(320, 600, Math.hypot(x - 20, z + 100)) + 24 * smooth(150, 400, Math.hypot(x - 20, z + 100));
        return n + massif(x, z) + far - 3.6 * (1 - smooth(6, 20, dC));
      };
      return (x, z) => {
        const p = track.project(x, z, -1, null, sc), dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + (p.d >= 0 ? p.wr : p.wl) + 0.8;
        const t = smooth(flat, flat + 34, dist), dC = fld()(x, z);
        return lerp(Math.min(p.cy, p.by) - 0.4, base(x, z, dC), t);
      };
    },
    decorate(S) {
      const { add, mats, track, rnd, renderer, quality: q } = S, M = mats, terr = track.terrain;
      const B = new KL.Batch(), E = new KL.Batch();
      const snowW = col('#f7fbff'), wood = col('#8a5a34'), woodD = col('#5e3c22');
      K.skirts(S, col('#bcd4ee'));
      K.patchDecals(S, { goo: { a: '#e8f0fb', b: '#b9cde8', glints: '#ffffff', opacity: 0.97 } });
      /* ice patches: a glossy shine over the road */
      K.patchDecals(S, { ice: { a: '#9fd4f5', b: '#e8f8ff', glints: '#ffffff', opacity: 0.55 } });
      { /* summit shortcut: a packed-snow track */
        const [c, g] = K.cv(128, 128), r = KL.rng(6); g.fillStyle = '#dfe9f6'; g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 30; i++) { g.fillStyle = r() > 0.5 ? '#c3d4ea' : '#ffffff'; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(r() * 128, r() * 128, 3 + r() * 8, 2 + r() * 4, r() * 3, 0, 7); g.fill(); }
        g.globalAlpha = 1; g.fillStyle = '#2f7de0'; g.fillRect(5, 0, 4, 128); g.fillRect(119, 0, 4, 128); g.fillStyle = '#9bb4d4'; g.fillRect(40, 0, 3, 128); g.fillRect(85, 0, 3, 128);
        K.altRoads(S, { mat: new T.MeshLambertMaterial({ map: K.canvasTex(c), vertexColors: true }) });
      }
      /* ---- crevasse: deep powder with blue ice walls ---- */
      {
        const pts = crevassePts(track), y = track.at(JUMP, 0).y + 0.35;
        const [c, g] = K.cv(128, 256), r = KL.rng(9); g.fillStyle = '#f6faff'; g.fillRect(0, 0, 128, 256);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(150,190,235,${0.15 + r() * 0.25})`; g.beginPath(); g.ellipse(r() * 128, r() * 256, 6 + r() * 20, 3 + r() * 8, r() * 3, 0, 7); g.fill(); }
        K.river(S, pts, 13, y, new T.MeshLambertMaterial({ map: K.canvasTex(c), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 20);
      }
      /* ---- the ice cave ---- */
      K.tunnel(S, { pts: K.roadPts(track, CAVE[0] - 6, CAVE[1] + 6, 5), H: 12, thick: 7, margin: 5, inner: '#8fc8ee', outer: '#9db9d6', top: '#ffffff', crystal: '#6fe3ff', drip: '#d8f1ff', seed: 3 });
      /* ---- trees: snowy pines ---- */
      const pine = (x, y, z, k) => { B.cyl(x, y, z, 0.35 * k, 0.3 * k, 1.8 * k, 5, woodD); for (let i = 0; i < 4; i++) { const r = (2.7 - i * 0.55) * k, y0 = y + (1.2 + i * 1.5) * k; B.cyl(x, y0, z, r, 0.05, 2.7 * k, 7, KL.mix(col('#1d4a3a'), col('#2f7a56'), i / 4)); B.cyl(x, y0 + 1.15 * k, z, r * 0.72, 0.05, 1.55 * k, 7, snowW, { flat: true }); } };
      K.scatter(S, rnd, Math.round(190 * q.trees), [-430, -430, 430, 200], 6, (x, y, z, i) => { if (massif(x, z) > 38) return false; pine(x, y, z, 0.9 + rnd() * 1.1); });
      /* ---- chalets, village ---- */
      const chalet = (x, y, z, yaw, w, d, h) => {
        const f = { x, y, z, yaw };
        L.box(B, f, 0, 0, 0, w, h, d, 0, wood, { topCol: wood }); L.box(B, f, 0, h * 0.5, 0, w + 0.05, 0.4, d + 0.05, 0, woodD);
        L.gable(B, f, 0, h, 0, w, d, h * 0.6, snowW, 1.1); L.box(B, f, -w * 0.25, 0.05, d / 2 + 0.05, 1.3, 2.4, 0.2, 0, woodD);
        L.box(E, f, w * 0.2, h * 0.45, d / 2 + 0.07, 1.5, 1.4, 0.2, 0, col('#ffd36a')); L.box(E, f, w / 2 + 0.07, h * 0.45, 0, 0.2, 1.4, 1.5, 0, col('#ffd36a'));
        L.box(B, f, w * 0.3, h + h * 0.3, -d * 0.1, 1, h * 0.55, 1, 0, col('#7a6a60'));
      };
      const side = (s, sd, off) => { const a = track.at(s, 0), p = track.at(s, sd * (a.hw + 2.8 + off)); return [p, Math.atan2(a.tz * sd, -a.tx * sd)]; };
      for (const [s, sd, off, w, h] of [[-48, -1, 14, 9, 5], [-20, 1, 15, 10, 5.5], [24, 1, 16, 9, 5], [150, -1, 15, 10, 5.5], [165, 1, 14, 9, 5], [1380, -1, 16, 10, 5.5], [1420, 1, 15, 9, 5], [1330, 1, 18, 11, 6], [260, -1, 16, 9, 5], [300, 1, 16, 10, 5.5], [1250, 1, 18, 9, 5], [905, -1, 22, 8, 4.6]]) {
        const [p, yaw] = side(s, sd, off); chalet(p.x, terr(p.x, p.z) - 0.1, p.z, yaw, w, 7 + rnd() * 2, h);
      }
      /* market stalls with striped awnings along the start straight */
      const stall = (x, y, z, yaw, c1) => { const f = { x, y, z, yaw }; L.box(B, f, 0, 0, 0, 4.4, 2.4, 3, 0, wood); L.box(B, f, 0, 0.9, 1.55, 4.8, 0.35, 0.6, 0, woodD); for (let i = 0; i < 6; i++) L.box(B, f, -2.2 + i * 0.8 + 0.4, 2.4, 0, 0.8, 0.3, 4.2, 0, i % 2 ? col('#ffffff') : col(c1)); L.box(E, f, 0, 1.5, 1.5, 3.6, 0.5, 0.15, 0, col('#ffe08a')); };
      for (const [s, sd, c1] of [[-30, 1, '#d9323c'], [-8, -1, '#2f7de0'], [6, 1, '#d9323c'], [58, -1, '#2f9d5a'], [78, 1, '#2f7de0'], [138, 1, '#d9323c'], [158, -1, '#2f9d5a']]) { const [p, yaw] = side(s, sd, 4.5); stall(p.x, terr(p.x, p.z), p.z, yaw, c1); }
      /* Gromperekichelcher stand with steam */
      {
        const [p, yaw] = side(38, -1, 6.5), x = p.x, z = p.z, y = terr(x, z), f = { x, y, z, yaw };
        L.box(B, f, 0, 0, 0, 7.5, 3.4, 4.6, 0, col('#9a6a3c')); L.gable(B, f, 0, 3.4, 0, 7.5, 4.6, 1.8, col('#c63a2e'), 0.9); L.box(B, f, 0, 1.0, 2.4, 6.6, 0.4, 0.9, 0, woodD);
        for (let i = 0; i < 5; i++) L.cyl(B, f, -2.4 + i * 1.2, 1.4, 2.5, 0.35, 0.35, 0.18, 8, col('#e8b45a'), { capTop: true }); L.box(E, f, 0, 2.2, 2.32, 5.5, 0.7, 0.15, 0, col('#ffcf6a'));
        const sign = new T.Mesh(new T.PlaneGeometry(9, 1.5), new T.MeshBasicMaterial({ map: KL.tex.label('GROMPEREKICHELCHER', { w: 1024, h: 170, size: 96, fg: '#ffe9b0', bg: '#6a2f16' }) })), P = L.frame(f)(0, 6.2, 2.45);
        sign.position.set(P[0], P[1], P[2]); sign.rotation.y = yaw; S.group.add(sign); const sg2 = sign.clone(); sg2.position.set(...L.frame(f)(0, 6.2, -2.45)); sg2.rotation.y = yaw + Math.PI; S.group.add(sg2);
        L.cyl(B, f, 2.6, 3.4, -1, 0.5, 0.4, 1.8, 6, col('#6a5a52'));
        const sp = [], seeds = []; for (let i = 0; i < 14; i++) seeds.push([rnd(), rnd() * 6.28]);
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(42), 3));
        const pts = new T.Points(g, new T.PointsMaterial({ map: KL.tex.glow(), color: 0xffffff, size: 3.4, sizeAttenuation: true, transparent: true, opacity: 0.45, depthWrite: false, fog: true }));
        pts.frustumCulled = false; S.group.add(pts); const sc0 = L.frame(f)(2.6, 5.4, -1);
        renderer.animators.push((dt, t) => { const a = g.attributes.position.array; for (let i = 0; i < 14; i++) { const u = ((t * 0.22 + seeds[i][0]) % 1); a[i * 3] = sc0[0] + Math.sin(seeds[i][1] + u * 4) * u * 1.6; a[i * 3 + 1] = sc0[1] + u * 7; a[i * 3 + 2] = sc0[2] + Math.cos(seeds[i][1] + u * 3) * u * 1.4; } g.attributes.position.needsUpdate = true; });
      }
      /* Christmas tree with lights + snowmen + igloo */
      {
        const [p] = side(12, -1, 20), x = p.x, z = p.z, y = terr(x, z), lp = [];
        B.cyl(x, y, z, 0.8, 0.6, 2.6, 6, woodD); for (let i = 0; i < 6; i++) B.cyl(x, y + 2 + i * 2.3, z, (6.5 - i) * 0.95, 0.05, 4.2, 9, KL.mix(col('#1d5a3a'), col('#2f9a56'), i / 6));
        B.sphere(x, y + 17.4, z, 0.9, 5, col('#ffd54a'));
        for (let i = 0; i < 26; i++) { const a = i * 2.4, hh = 3 + (i / 26) * 12, rr = (6.5 - hh / 2.6) * 0.8; lp.push(x + Math.cos(a) * rr, y + hh, z + Math.sin(a) * rr); }
        K.glow(S, lp, { color: 0xffcf6a, size: 2.6, night: false, opacity: 0.95 });
        for (let i = 0; i < 4; i++) { const sx = x + 11 + i * 4.5, sz = z + 8 + (i % 2) * 3, sy = terr(sx, sz); B.sphere(sx, sy + 1, sz, 1.2, 7, snowW); B.sphere(sx, sy + 2.6, sz, 0.9, 7, snowW); B.sphere(sx, sy + 3.8, sz, 0.65, 6, snowW); B.cyl(sx, sy + 3.7, sz + 0.6, 0.12, 0.01, 0.9, 4, col('#ff7a1a')); B.cyl(sx, sy + 4.4, sz, 0.55, 0.55, 0.7, 6, col('#26303f')); }
        const ix = x - 18, iz = z + 4, iy = terr(ix, iz); B.sphere(ix, iy - 0.5, iz, 4.4, 9, snowW, { sy: 0.85 }); B.cyl(ix + 3.5, iy, iz, 1.6, 1.6, 2, 8, snowW); E.box(ix + 5.2, iy, iz - 0.9, 0.2, 1.6, 1.8, 0, col('#ffcf6a'));
      }
      /* ---- Ferris wheel (Winterlights wink) ---- */
      {
        const a = track.at(70, 0), p = track.at(70, -(a.hw + 30)), hubY = terr(p.x, p.z) + 24, R = 19, yaw = Math.atan2(a.tx, a.tz);
        const base = new T.Group(); base.position.set(p.x, hubY, p.z); base.rotation.y = yaw - Math.PI / 2; S.group.add(base);       // local +x along the road, +z across
        const fr = new KL.Batch(), st = new KL.Batch(), lt = new KL.Batch(), white = col('#f0f4fa'), blue = col('#2f7de0');
        const ring = (zz, rr, c) => { for (let i = 0; i < 28; i++) { const a0 = i / 28 * 6.283, a1 = (i + 1) / 28 * 6.283; L.bar(fr, [Math.cos(a0) * rr, Math.sin(a0) * rr, zz], [Math.cos(a1) * rr, Math.sin(a1) * rr, zz], 0.5, c); } };
        ring(1, R, white); ring(-1, R, white); ring(1, R * 0.55, blue); ring(-1, R * 0.55, blue);
        for (let i = 0; i < 14; i++) { const an = i / 14 * 6.283; L.bar(fr, [0, 0, 1], [Math.cos(an) * R, Math.sin(an) * R, 1], 0.28, blue); L.bar(fr, [0, 0, -1], [Math.cos(an) * R, Math.sin(an) * R, -1], 0.28, blue); lt.sphere(Math.cos(an) * R, Math.sin(an) * R, 0, 0.5, 4, col('#ffe08a')); }
        const wheel = new T.Group(); wheel.add(new T.Mesh(fr.toGeometry(), M.plain));
        const lm = new T.Mesh(lt.toGeometry(), M.plainEmissive); wheel.add(lm); base.add(wheel);
        for (const sd of [-1, 1]) { L.bar(st, [-R * 0.55, -24, sd * 3.5], [0, 0, sd * 1.2], 0.9, white); L.bar(st, [R * 0.55, -24, sd * 3.5], [0, 0, sd * 1.2], 0.9, white); }
        base.add(new T.Mesh(st.toGeometry(), M.plain));
        const gb = new KL.Batch(); gb.box(0, -2.3, 0, 2.2, 1.7, 1.8, 0, col('#d9323c')); gb.box(0, -0.6, 0, 2.5, 0.25, 2.1, 0, white); gb.box(0, 0, 0, 0.12, 0.1, 0.12, 0, white); const gE = new KL.Batch(); gE.box(0, -2.0, 0.92, 1.5, 0.8, 0.1, 0, col('#ffe9a8')); gE.box(0, -2.0, -0.92, 1.5, 0.8, 0.1, 0, col('#ffe9a8'));
        const gg = gb.toGeometry(), ge = gE.toGeometry(), gondolas = [];
        for (let i = 0; i < 12; i++) { const gr = new T.Group(); gr.add(new T.Mesh(gg, M.plain), new T.Mesh(ge, M.plainEmissive)); base.add(gr); gondolas.push(gr); }
        const prev = S.theme.onWeather; S.theme.onWeather = (r, name, Wx) => { if (prev) prev(r, name, Wx); lm.visible = Wx.night >= 0.2; };
        renderer.animators.push((dt, t) => { wheel.rotation.z = t * 0.12; for (let i = 0; i < 12; i++) { const an = i / 12 * 6.283 + t * 0.12; gondolas[i].position.set(Math.cos(an) * R, Math.sin(an) * R, 0); } });
      }
      /* ---- ski lift: pylons and a cable with moving gondolas over the interior ---- */
      {
        const A = [30, -70], Bp = [-100, -215], n = 7, pts = [];
        for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(A[0], Bp[0], t), z = lerp(A[1], Bp[1], t); pts.push([x, terr(x, z) + 13, z]); }
        for (let i = 0; i <= n; i++) { const [x, y, z] = pts[i]; B.cyl(x, y - 13, z, 0.5, 0.35, 13.6, 6, col('#6b7684')); L.bar(B, [x - 2.6, y + 0.4, z], [x + 2.6, y + 0.4, z], 0.5, col('#6b7684')); }
        for (let i = 0; i < n; i++) for (const o of [-1.6, 1.6]) L.bar(B, [pts[i][0] + o, pts[i][1] + 0.4, pts[i][2]], [pts[i + 1][0] + o, pts[i + 1][1] + 0.4, pts[i + 1][2]], 0.12, col('#2a2f38'));
        const cab = new KL.Batch(); cab.box(0, -3.4, 0, 2.6, 1.9, 2.0, 0, col('#d9323c')); cab.box(0, -1.5, 0, 0.14, 1.5, 0.14, 0, col('#2a2f38')); cab.box(0, -3.0, 0, 2.7, 0.7, 2.1, 0, col('#ffffff'), { topCol: col('#bcd9ff') });
        const cg = cab.toGeometry(), cabs = [];
        for (let i = 0; i < 6; i++) { const m = new T.Mesh(cg, M.plain); S.group.add(m); cabs.push(m); }
        renderer.animators.push((dt, t) => { for (let i = 0; i < 6; i++) { const dirn = i < 3 ? 1 : -1, off = dirn > 0 ? -1.6 : 1.6; let u = ((t * 0.035 + i / 3) % 1); if (dirn < 0) u = 1 - u; const f = u * n, k = Math.min(n - 1, Math.floor(f)), r = f - k; cabs[i].position.set(lerp(pts[k][0], pts[k + 1][0], r) + off, lerp(pts[k][1], pts[k + 1][1], r), lerp(pts[k][2], pts[k + 1][2], r)); cabs[i].rotation.y = Math.atan2(Bp[0] - A[0], Bp[1] - A[1]); } });
      }
      /* ---- ice crystals near the cave and the summit ---- */
      for (const s0 of [520, 655, 880, 995]) for (let i = 0; i < 7; i++) { const sd = i % 2 ? 1 : -1, a = track.at(s0 + i * 6, 0), p = track.at(s0 + i * 6, sd * (a.hw + 5 + rnd() * 9)), h = 2.5 + rnd() * 6, y = terr(p.x, p.z); E.cyl(p.x, y - 0.2, p.z, 0.9 + rnd() * 0.7, 0.05, h, 5, KL.shade(col('#7fdcff'), 0.7 + rnd() * 0.5), { flat: true }); }
      /* ---- aurora at night ---- */
      {
        const [c, g] = K.cv(8, 128); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(120,255,190,0)'); gr.addColorStop(0.35, 'rgba(90,255,170,.75)'); gr.addColorStop(0.7, 'rgba(70,170,255,.45)'); gr.addColorStop(1, 'rgba(160,90,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 128);
        const tex = K.canvasTex(c, { wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping }), au = new T.Group(), mats = [];
        for (let i = 0; i < 3; i++) {
          const geo = new T.PlaneGeometry(520, 110, 28, 1), pos = geo.attributes.position;
          for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); pos.setZ(k, Math.sin(x * 0.02 + i) * 22); pos.setY(k, pos.getY(k) + Math.sin(x * 0.013 + i * 2) * 14); }
          const m = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide }); mats.push(m);
          const mesh = new T.Mesh(geo, m); mesh.position.set(i * 90 - 90, 150 + i * 14, -300 - i * 40); mesh.rotation.y = 0.1 * i; mesh.renderOrder = -5; au.add(mesh);
        }
        au.visible = false; S.group.add(au);
        const prev = S.theme.onWeather; S.theme.onWeather = (r, name, Wx) => { if (prev) prev(r, name, Wx); au.visible = name === 'night'; };
        renderer.animators.push((dt, t) => { if (!au.visible) return; au.position.set(renderer.cam.x, 0, renderer.cam.z); mats.forEach((m, i) => { m.opacity = 0.5 + 0.25 * Math.sin(t * 0.5 + i * 2); }); au.children.forEach((ch, i) => { ch.position.x = i * 90 - 90 + Math.sin(t * 0.07 + i) * 30; }); });
      }
      add(B, M.plain); K.nightOnly(S, E, 0.2);
    },
  });
})();
