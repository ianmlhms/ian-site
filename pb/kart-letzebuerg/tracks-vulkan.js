/* Kart Lëtzebuerg — fantasy track 4: Feierbierg (volcano). Original design: a smoking cone with a lava lake, two lava rivers that the road jumps
 * on kickers, timed fire geysers beside the road, a narrow rim, a glowing crust shortcut, a golden lady on a rock in a lava pond (Gëlle Fra wink). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade, K = KL.kit, L = KL.lm;
  const VC = [25, 5], CONE_R = 128, PEAK = 78;
  const FORDS = [349.5, 1051.5];
  let FIELD = null;

  const cone = (x, z) => {
    const r = Math.hypot(x - VC[0], z - VC[1]);
    if (r >= CONE_R) return 0;
    if (r < 34) return PEAK - 36 * smooth(34, 12, r);
    return PEAK * Math.pow(1 - smooth(34, CONE_R, r), 1.15);
  };
  /* a lava river from the crater, through the ford, beyond */
  function riverPts(track, sFord) {
    const f = track.at(sFord, 0), out = [], dx = f.x - VC[0], dz = f.z - VC[1], l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    for (let i = 0; i <= 8; i++) { const t = i / 8, d = lerp(20, l, t), w = Math.sin(t * 9 + sFord) * 12 * Math.sin(t * Math.PI) * (t < 0.92 ? 1 : 0); out.push([VC[0] + ux * d - uz * w, VC[1] + uz * d + ux * w]); }
    out[8] = [f.x, f.z];
    for (let k = 1; k <= 4; k++) out.push([f.x + ux * k * 40 + uz * Math.sin(k) * 6, f.z + uz * k * 40 - ux * Math.sin(k) * 6]);
    return out;
  }

  KL.registerTrack({
    id: 'vulkan',
    speedMul: 1.0,
    autoBank: { k: 3.0, max: 0.12 },
    ramps: [{ s: 330, k: [[0, 0], [9, 2.3], [10.5, -1.8], [12, -3.4], [27, -3.4], [36, 0]] }, { s: 1030, k: [[0, 0], [10, 2.6], [11.5, -1.6], [13, -3.4], [30, -3.4], [40, 0]] }],
    patches: [{ s0: 342, s1: 358, d0: -12, d1: 12, kind: 'lava' }, { s0: 1044, s1: 1062, d0: -12, d1: 12, kind: 'lava' }],
    hazards: [{ s: 1215, d: 6, r: 4, period: 5.4, on: 1, phase: 0 }, { s: 1240, d: -6, r: 4, period: 5.4, on: 1, phase: 2.7 }, { s: 235, d: 6, r: 4, period: 5.4, on: 1, phase: 1.35 }, { s: 262, d: -6, r: 4, period: 5.4, on: 1, phase: 4.05 }, { s: 960, d: 5, r: 3.6, period: 5.4, on: 1, phase: 0.7 }, { s: 985, d: -5, r: 3.6, period: 5.4, on: 1, phase: 3.4 }],
    pads: [[310, 0, 8], [1016, 0, 10], [715, 17.4, 9, -0.02], [826, -24.6, 9, -0.37]],
    extraBoxes: [[790, -18], [795, -16]],
    alts: [{ hw: 4.6, pts: [[-190.8, 41.6], [-72.3, -93.3]] }],
    theme: {
      weathers: ['day', 'sunset', 'night', 'fog'], startText: 'FEIERBIERG', facade: 'old', buildings: false, lamps: false, skyline: false,
      roadStyle: 'basalt', vergeTex: ['#5a4a42', '#33292a', '#7a6458', { cracks: '#ff6a14' }], kerbColors: ['#ff6a14', '#2a2220'],
      ground: 'grass', groundTex: ['#5c4a42', '#352a28', '#80675a', { cracks: '#ff6a14' }], groundY: 0, groundCell: 8, groundColor: '#5c4a42',
      wallStyle: 'rock', wallColor: '#8a766b', wallTop: '#a88e80', wallH: 1.4, vergeColor: '#ffffff', fogScale: 1.0, farColor: '#3a2a26', farDrop: -50,
      weatherTint: {
        day: { sky: ['#d2603a', '#ffd0a0'], fog: '#eeaa7c', hemi: ['#fff0d8', '#b07a64', 1.65] },
        sunset: { sky: ['#4a1d4a', '#ff7a3a'], fog: '#d0643c', hemi: ['#ffbc94', '#8e5044', 1.4] },
        night: { sky: ['#07030a', '#3a1210'], fog: '#241010', hemi: ['#ff9a6a', '#33181a', 0.8] },
        fog: { sky: ['#5a4a46', '#8a7870'], fog: '#80706a', hemi: ['#d0bcb0', '#4a3a36', 0.82] },
      },
      groundColorAt(x, z, h) {
        const n = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 0.5 + 0.5; let c = KL.mix([1, 1, 1], [0.7, 0.62, 0.6], n);
        if (h > 30) c = KL.mix(c, [0.55, 0.5, 0.52], smooth(30, 60, h));
        if (FIELD) { const d = FIELD(x, z); if (d < 26) c = KL.mix([2.0, 0.75, 0.3], c, smooth(10, 26, d)); }
        return c;
      },
    },
    makeTerrain(track) {
      const sc = {}; let field = null;
      const fld = () => field || (field = FIELD = K.distField(FORDS.map((s) => riverPts(track, s)), -700, -700, 700, 700, 6));
      const base = (x, z, dR) => {
        const calm = smooth(8, 50, dR), n = (3.0 * Math.sin(x * 0.024 + 1) * Math.cos(z * 0.02) + 1.6 * Math.sin(x * 0.06 + z * 0.05) + 0.7 * Math.sin(x * 0.16)) * calm;
        const far = 60 * smooth(300, 560, Math.hypot(x - 20, z - 10)) + 22 * smooth(170, 420, Math.hypot(x - 20, z - 10));
        return n + cone(x, z) + far - 3.6 * (1 - smooth(6, 20, dR));
      };
      return (x, z) => {
        const p = track.project(x, z, -1, null, sc), dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + (p.d >= 0 ? p.wr : p.wl) + 0.8;
        const t = smooth(flat, flat + 34, dist), dR = fld()(x, z);
        return lerp(Math.min(p.cy, p.by) - 0.4, base(x, z, dR), t);
      };
    },
    decorate(S) {
      const { add, mats, track, rnd, renderer, quality: q } = S, M = mats, terr = track.terrain;
      const B = new KL.Batch(), E = new KL.Batch(), basalt = [col('#3b3533'), col('#2c2725'), col('#4a4240'), col('#262120')];
      K.skirts(S, col('#4a403c'));
      /* second route: glowing crust */
      {
        const [c, g] = K.cv(128, 128), r = KL.rng(6); g.fillStyle = '#4a3a34'; g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(255,${100 + Math.floor(r() * 90)},20,.8)`; g.lineWidth = 1.5 + r() * 2; g.beginPath(); let x = r() * 128, y = r() * 128; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
        g.fillStyle = '#ffb347'; g.fillRect(4, 0, 4, 128); g.fillRect(120, 0, 4, 128);
        K.altRoads(S, { mat: new T.MeshBasicMaterial({ map: K.canvasTex(c), vertexColors: true }) });
      }
      /* ---- lava: rivers (animated), crater lake, pond ---- */
      const lavaTex = (() => { const [c, g] = K.cv(128, 256), r = KL.rng(12); g.fillStyle = '#e8420c'; g.fillRect(0, 0, 128, 256); for (let i = 0; i < 70; i++) { g.fillStyle = r() > 0.5 ? '#ffb21e' : '#b32a08'; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(r() * 128, r() * 256, 5 + r() * 16, 3 + r() * 10, r() * 3, 0, 7); g.fill(); } g.globalAlpha = 1; for (let i = 0; i < 24; i++) { g.fillStyle = '#fff2a0'; g.globalAlpha = 0.6; g.beginPath(); g.ellipse(r() * 128, r() * 256, 2 + r() * 4, 1 + r() * 2, 0, 0, 7); g.fill(); } return K.canvasTex(c); })();
      const lavaMat = new T.MeshBasicMaterial({ map: lavaTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      for (const s of FORDS) K.river(S, riverPts(track, s), 13, (x, z) => terr(x, z) + 0.9, lavaMat, 18);
      renderer.animators.push((dt) => { lavaTex.offset.y -= dt * 0.04; });
      const craterY = PEAK - 36 + 4;
      { const m = new T.Mesh(new T.CircleGeometry(24, 28), lavaMat); m.rotation.x = -Math.PI / 2; m.position.set(VC[0], craterY, VC[1]); S.group.add(m); }
      const pond = track.at(70, -46), pondY = terr(pond.x, pond.z) + 0.05;
      { const m = new T.Mesh(new T.CircleGeometry(15, 24), lavaMat); m.rotation.x = -Math.PI / 2; m.position.set(pond.x, pondY + 0.4, pond.z); S.group.add(m); }
      /* golden lady on a rock pillar in the pond */
      {
        const f = { x: pond.x, y: pondY, z: pond.z, yaw: 0 };
        L.cyl(B, f, 0, -1, 0, 5.2, 3.4, 15, 8, basalt[1]); L.cyl(B, f, 0, 14, 0, 3.6, 3.6, 0.8, 8, basalt[2]);
        const gold = col('#ffd23f'), gd = col('#e0a82a');
        L.box(E, f, 0, 14.8, 0, 2.6, 1.2, 2.6, 0, gd); L.cyl(E, f, 0, 16, 0, 1.9, 0.8, 5.2, 10, gold); L.cyl(E, f, 0, 21.2, 0, 0.85, 0.65, 2.4, 8, gold); L.sphere(E, f, 0, 24.0, 0, 0.7, 6, gold);
        const ap = L.frame(f); L.bar(E, ap(0.5, 22.4, 0), ap(1.8, 26.2, 0), 0.28, gold);
        for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; L.sphere(E, f, 1.8 + Math.cos(a) * 1.25, 27.2 + Math.sin(a) * 1.25, 0, 0.32, 4, gold); }
      }
      /* ---- the volcano: smoke, embers, bombs ---- */
      {
        const crater = [VC[0], craterY + 6, VC[1]];
        const sm = [], smoke = new T.SpriteMaterial({ map: KL.tex.cloud(), color: 0x3a2f2d, transparent: true, depthWrite: false, opacity: 0.8, fog: true });
        for (let i = 0; i < 16; i++) { const sp = new T.Sprite(smoke.clone()); S.group.add(sp); sm.push({ sp, ph: i / 16, dr: [rnd() - 0.5, rnd() - 0.5] }); }
        const prev = S.theme.onWeather; let nightK = 0; S.theme.onWeather = (r, name, Wx) => { if (prev) prev(r, name, Wx); nightK = Wx.night; };
        renderer.animators.push((dt, t) => { for (const m of sm) { const u = (t * 0.045 + m.ph) % 1; m.sp.position.set(crater[0] + m.dr[0] * 30 * u + u * 40, crater[1] + 8 + u * 150, crater[2] + m.dr[1] * 30 * u); const sz = 40 + u * 130; m.sp.scale.set(sz, sz * 0.7, 1); m.sp.material.opacity = 0.75 * Math.sin(Math.min(1, u * 1.2) * Math.PI) ; m.sp.material.color.setRGB(0.22 + (1 - u) * 0.35 * (0.4 + nightK), 0.18 + (1 - u) * 0.1 * (0.4 + nightK), 0.17); } });
        // lava bombs: glowing balls on ballistic arcs
        const bombGeo = new T.SphereGeometry(1.3, 7, 5), bombs = [];
        for (let i = 0; i < 6; i++) { const m = new T.Mesh(bombGeo, new T.MeshBasicMaterial({ color: 0xff7a1a, fog: false })), halo = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0xff8a2a, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); halo.scale.set(9, 9, 1); m.add(halo); S.group.add(m); bombs.push({ m, per: 5 + rnd() * 3, ph: rnd() * 8, a: rnd() * 6.28, v: 24 + rnd() * 14, up: 40 + rnd() * 20 }); }
        renderer.animators.push((dt, t) => { for (const b of bombs) { const u = ((t + b.ph) % b.per); const tt = u; const x = crater[0] + Math.cos(b.a + Math.floor((t + b.ph) / b.per)) * b.v * tt * 0.6, z = crater[2] + Math.sin(b.a + Math.floor((t + b.ph) / b.per)) * b.v * tt * 0.6, y = crater[1] + b.up * tt - 9 * tt * tt; b.m.visible = tt < 7 && y > terr(x, z) + 0.5; b.m.position.set(x, y, z); } });
        // embers drifting up near the cone
        const en = 90, ep = new Float32Array(en * 3), es = []; for (let i = 0; i < en; i++) es.push([rnd(), rnd() * 6.28, 8 + rnd() * 60]);
        const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(ep, 3)); const em = new T.Points(eg, new T.PointsMaterial({ map: KL.tex.spark(), color: 0xffa040, size: 2.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); em.frustumCulled = false; S.group.add(em);
        renderer.animators.push((dt, t) => { for (let i = 0; i < en; i++) { const u = (t * 0.07 + es[i][0]) % 1, a = es[i][1] + t * 0.05; ep[i * 3] = VC[0] + Math.cos(a) * es[i][2] * (0.5 + u); ep[i * 3 + 1] = craterY + u * 120; ep[i * 3 + 2] = VC[1] + Math.sin(a) * es[i][2] * (0.5 + u); } eg.attributes.position.needsUpdate = true; });
      }
      /* ---- fire geysers ---- */
      K.geysers(S, { height: 11, vent: '#26201e' });
      /* ---- basalt columns, boulders, obsidian shards, dead trees ---- */
      const columns = (x, y, z, k) => { const n = 4 + Math.floor(rnd() * 5); for (let i = 0; i < n; i++) { const a = rnd() * 6.28, r = rnd() * 3.2 * k, h = (1.5 + rnd() * 5) * k; B.cyl(x + Math.cos(a) * r, y - 0.5, z + Math.sin(a) * r, 0.9 * k, 0.8 * k, h, 6, basalt[Math.floor(rnd() * 4)]); if (rnd() < 0.25) E.cyl(x + Math.cos(a) * r, y + h - 0.45, z + Math.sin(a) * r, 0.55 * k, 0.5 * k, 0.12, 6, col('#ff7a1a'), { flat: true }); } };
      K.scatter(S, rnd, Math.round(46 * q.trees), [-400, -330, 420, 380], 4, (x, y, z, i) => { if (cone(x, z) > 18) return false; if (i % 4 === 0) { B.sphere(x, y + 0.6, z, 1.6 + rnd() * 2, 6, basalt[Math.floor(rnd() * 4)], { noise: 1, sy: 0.7 }); } else columns(x, y, z, 0.8 + rnd() * 0.9); });
      for (let s = 10; s < track.length; s += 17) for (const sd of [-1, 1]) { if (rnd() < 0.45) continue; const a = track.at(s, 0), lim = a.hw + (sd < 0 ? track.WL[Math.floor(s / track.step) % track.N] : track.WR[Math.floor(s / track.step) % track.N]) + 1.2 + rnd() * 2; if (lim > 22) continue; const p = track.at(s, sd * lim), h = 1.6 + rnd() * 3; B.cyl(p.x, terr(p.x, p.z) - 0.2, p.z, 0.7, 0.04, h, 4, col('#1d1a1f'), { flat: true }); if (rnd() < 0.4) E.cyl(p.x, terr(p.x, p.z) + h - 0.5, p.z, 0.12, 0.02, 0.5, 4, col('#ff7a1a'), { flat: true }); }
      const dead = KL.scenery.tree('dead', rnd), dt0 = new KL.Batch();
      K.scatter(S, rnd, Math.round(34 * q.trees), [-400, -330, 420, 380], 8, (x, y, z) => { if (cone(x, z) > 14) return false; dt0.addBatch(dead, x, y, z, rnd() * 6, 1 + rnd() * 0.8); });
      add(dt0, M.plain);
      /* ---- gates at both ends of the shortcut ---- */
      for (const a of track.alts) for (const [P0, P1] of [[a.P[0], a.P[2]], [a.P[a.P.length - 1], a.P[a.P.length - 3]]]) {
        const dx = P1[0] - P0[0], dz = P1[1] - P0[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, y = track.project(P0[0], P0[1], -1, null, {}).y, yaw = Math.atan2(dx, dz), f = { x: P0[0], y, z: P0[1], yaw };
        for (const sd of [-1, 1]) { L.cyl(B, f, sd * 6.4, 0, 0, 1.5, 1.2, 8, 6, basalt[0]); E.sphere(P0[0] + nx * sd * 6.4, y + 8.5, P0[1] + nz * sd * 6.4, 0.9, 5, col('#ff7a1a')); }
        L.box(B, f, 0, 7.6, 0, 14.6, 1.2, 1.8, 0, basalt[2]); L.box(E, f, 0, 7.5, 0, 14.6, 0.15, 1.9, 0, col('#ff6a14'));
      }
      /* start gantry lava drips: a lava glow strip along the start line */
      add(B, M.plain); add(E, M.plainEmissive);
    },
  });
})();
