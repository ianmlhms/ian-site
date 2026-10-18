/* Kart Lëtzebuerg — fantasy track 1: Geeschterschlass (haunted castle, Halloween). Original design, free-form, with hills, a gate, a causeway
 * over a swamp, a graveyard start straight, jack-o'-lanterns, bats and drifting ghosts. */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE, { clamp, lerp, smooth } = KL;
  const col = KL.col, shade = KL.shade;
  const CX = 90, CZ = 180;

  function baseHeight(x, z) {
    const n = 4.5 * Math.sin(x * 0.018 + 1) * Math.cos(z * 0.015) + 2.2 * Math.sin(x * 0.045 + z * 0.037) + 1.2 * Math.sin(x * 0.11) * Math.cos(z * 0.09);
    const far = 34 * smooth(240, 520, Math.hypot(x - CX, z - CZ));
    const pond = -10 * Math.max(0, 1 - Math.hypot(x - 225, z - 350) / 95);
    const keepHill = 9 * Math.max(0, 1 - Math.hypot(x + 55, z - 150) / 85);
    return n + far + pond + keepHill;
  }

  KL.registerTrack({
    id: 'geeschterschlass', hw: 9, r: 30, wl: 2.6, wr: 2.6,
    theme: {
      facade: 'old', ground: 'grass', verge: 'grass', buildings: false, lamps: false, groundY: 0, groundCell: 12, skyline: false, farColor: '#2b2f3a', farDrop: -40,
      weathers: ['night', 'fog', 'sunset', 'rain'], startText: 'GEESCHTERSCHLASS', wallColor: '#6b6679', wallTop: '#8a8498', wallH: 1.5, vergeColor: '#6c7a60', roadColor: '#a6a0b4', groundColor: '#6b7a62', fogScale: 0.9,
      weatherTint: {
        night: { sky: ['#0a0720', '#3b2468'], fog: '#2a1b4a', hemi: ['#7a6ab8', '#2b2238', 0.62] },
        fog: { sky: ['#5d5775', '#8d82a6'], fog: '#7f7599', hemi: ['#d0c8e6', '#5a5070', 0.8] },
        sunset: { sky: ['#3d1f66', '#ff7b3a'], fog: '#b05a4c', hemi: ['#ffb089', '#5a3550', 0.78] },
        rain: { sky: ['#343a4a', '#646b7c'], fog: '#4e5566', hemi: ['#b8c2d6', '#4a4f5c', 0.75] },
      },
      groundColorAt(x, z, h) {
        const n = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 0.5 + 0.5, hi = clamp((h - 14) / 26, 0, 1);
        const grass = KL.mix(col('#3f5a44'), col('#566b46'), n), rock = col('#6a6478'), pond = col('#2c4a52');
        if (h < -3.5) return KL.mix(grass, pond, smooth(-3.5, -7, h));
        return KL.mix(grass, rock, hi);
      },
    },
    makeTerrain(track) {
      const sc = {};
      return (x, z) => {
        const p = track.project(x, z, -1, null, sc);
        const dist = Math.hypot(x - p.cx, z - p.cz), flat = p.hw + 3.2;
        const t = smooth(flat, flat + 34, dist);
        return lerp(p.cy - 0.4, baseHeight(x, z), t);
      };
    },
    pts: [[-30, 0, { y: 0, hw: 11, r: 30 }], [160, -6, { y: 0, r: 40 }], [270, 50, { y: 1, r: 60 }], [285, 150, { y: 2, r: 30 }], [222, 186, { y: 3, r: 14 }], [276, 238, { y: 3.5, r: 14 }], [270, 330, { y: 4, r: 40 }], [180, 362, { y: 5, r: 22 }], [60, 346, { y: 7, r: 30 }], [40, 262, { y: 9, r: 16 }], [-60, 232, { y: 11, r: 16 }], [-130, 170, { y: 11, r: 30 }], [-120, 90, { y: 9, r: 30 }], [-70, 30, { y: 5, r: 30 }]],
    zones: [{ a: 9, b: 11, road: 'cobble', name: 'gate' }],
    pads: [[160, 0, 10], [860, 0, 10]],
    decorate(S) {
      const { add, mats, track, rnd, renderer } = S, M = mats, L = KL.lm;
      const B = new KL.Batch(), E = new KL.Batch();     // E: always-bright (windows, flames)
      const stone = col('#7c7689'), stoneD = col('#5d5870'), stoneL = col('#9b95aa'), roof = col('#3a3547'), wood = col('#5a3f2a'), win = col('#ffc65a');
      const terr = track.terrain;
      const gyAt = (x, z) => terr(x, z);

      /* ---- castle on the keep hill, with a gatehouse straddling the road ---- */
      const castle = (cx, cz, yaw) => {
        const y0 = gyAt(cx, cz) - 1, f = { x: cx, y: y0, z: cz, yaw };
        // curtain wall ring
        const ring = [[-48, -42], [48, -42], [48, 42], [-48, 42]];
        for (let i = 0; i < 4; i++) {
          const a = ring[i], b = ring[(i + 1) % 4], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
          L.box(B, f, mx, 0, mz, 3.2, 13, len, ang - Math.PI / 2 + Math.PI / 2 - ang + ang, stone);
          for (let k = -len / 2 + 2; k < len / 2; k += 4) { const px = mx + Math.sin(ang) * k, pz = mz + Math.cos(ang) * k; L.box(B, f, px, 13, pz, 1.6, 1.6, 1.6, ang, stoneL); }
        }
        for (const [x, z] of ring) { L.cyl(B, f, x, 0, z, 6.2, 5.8, 20, 10, stone); L.cyl(B, f, x, 20, z, 6.8, 6.8, 1.4, 10, stoneD); L.cyl(B, f, x, 21.4, z, 7, 0.4, 9, 10, roof, { flat: true }); L.box(B, f, x + 4.0, 10, z, 0.5, 2.0, 1.1, 0, win); }
        // keep
        L.box(B, f, 0, 0, 0, 24, 40, 20, 0, stone);
        L.box(B, f, 0, 40, 0, 26, 2, 22, 0, stoneD);
        for (let k = -11; k <= 11; k += 3.2) for (const sz of [-10.5, 10.5]) L.box(B, f, k, 42, sz, 1.8, 1.8, 1.6, 0, stoneL);
        L.gable(B, f, 0, 42, 0, 22, 18, 12, roof, 1.2);
        L.cyl(B, f, 0, 0, -13, 5.5, 5.0, 46, 10, stone); L.cyl(B, f, 0, 46, -13, 6.2, 0.4, 14, 10, roof, { flat: true });
        for (let fl = 0; fl < 4; fl++) for (const sx of [-7, -2, 3, 8]) { L.box(B, f, sx, 6 + fl * 8, -10.1, 1.5, 3, 0.3, 0, win); }
        L.cyl(B, f, 0, 52, -13, 0.12, 0.12, 6, 4, stoneD);
        E.sphere(...L.frame(f)(0, 59.2, -13), 0.9, 5, col('#ffb030'));
        L.windowsSide(B, f, 12.1, -7, 7, 3, 8, 1.4, 3.6, win);
      };
      castle(-50, 152, 0.15);

      /* gatehouse straddling the cobbled road */
      {
        const s = track.sOf(-22, 241), p = track.at(s, 0), yaw = Math.atan2(p.tx, p.tz) + Math.PI / 2;
        const f = { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
        // local z = along the road. towers either side, bridge over the top
        for (const sd of [-1, 1]) {
          L.box(B, f, sd * 15.8, -2, 0, 7, 24, 9, 0, stone); L.cyl(B, f, sd * 15.8, 22, 0, 5.2, 5.2, 1.2, 8, stoneD); L.cyl(B, f, sd * 15.8, 23.2, 0, 5.6, 0.3, 9, 8, roof, { flat: true });
          L.box(B, f, sd * 15.8, 8, -4.6, 1.2, 2.6, 0.3, 0, win); L.box(B, f, sd * 15.8, 14, -4.6, 1.2, 2.6, 0.3, 0, win);
          // torches
          const tp = L.frame(f)(sd * 11.6, 3.4, -4.7); B.cyl(tp[0], tp[1], tp[2], 0.1, 0.1, 1.3, 4, wood); E.sphere(tp[0], tp[1] + 1.55, tp[2], 0.42, 5, col('#ff8a1f'));
        }
        L.box(B, f, 0, 9.5, 0, 24, 6, 9, 0, stone);            // arch lintel block over the road (road is 18 wide + walls)
        for (let k = -11; k <= 11; k += 3.3) { L.box(B, f, k, 15.5, -4.2, 1.8, 1.8, 1.4, 0, stoneL); L.box(B, f, k, 15.5, 4.2, 1.8, 1.8, 1.4, 0, stoneL); }
        L.box(B, f, 0, 12, -4.62, 6, 3.4, 0.3, 0, col('#c6212b'));     // banner
        E.sphere(...L.frame(f)(0, 13.7, -4.9), 0.6, 5, col('#ffd36a'));
      }

      /* ---- graveyard along the start straight ---- */
      const stones = new KL.Batch();
      for (let s = 20; s < 300; s += 6.5 + rnd() * 5) for (const sd of [-1, 1]) {
        const dd = track.at(s, 0).hw + 2.6 + 3.2 + 1.5 + rnd() * 11, p = track.at(s, sd * dd), yaw = Math.atan2(p.tx, p.tz) + (rnd() - 0.5) * 0.4;
        const y = terr(p.x, p.z);
        if (rnd() < 0.3) { stones.box(p.x, y, p.z, 0.3, 1.9, 0.3, yaw, col('#8a8f99')); stones.box(p.x, y + 1.2, p.z, 1.3, 0.3, 0.3, yaw, col('#8a8f99')); }
        else { stones.box(p.x, y, p.z, 1.0, 1.3 + rnd() * 0.7, 0.32, yaw, col(rnd() < 0.5 ? '#8a8f99' : '#9d9aa8')); stones.cyl(p.x, y + 1.3, p.z, 0.52, 0.5, 0.32, 8, col('#8a8f99')); }
      }
      add(stones, M.plain);
      // iron fence posts at the verge near the graveyard
      const fence = new KL.Batch();
      for (let s = 6; s < 320; s += 2.4) for (const sd of [-1, 1]) { const p = track.at(s, sd * (track.at(s, 0).hw + 2.6 + 0.3)); fence.box(p.x, p.y + 1.6, p.z, 0.12, 1.4, 0.12, 0, col('#26232f')); }
      add(fence, M.plain);

      /* ---- trees: dead trees and dark pines ---- */
      const trees = new KL.Batch(), dead = KL.scenery.tree('dead', rnd), pine = KL.scenery.tree('pine', rnd), q = S.quality.trees;
      let planted = 0, tries = 0;
      while (planted < 210 * q && tries++ < 6000) {
        const x = -160 + rnd() * 500, z = -60 + rnd() * 500, p = track.project(x, z, -1, null, {}), dist = Math.hypot(x - p.cx, z - p.cz);
        if (dist < p.hw + 7.5 || Math.hypot(x + 50, z - 152) < 62) continue;
        trees.addBatch(rnd() < 0.55 ? dead : pine, x, terr(x, z), z, rnd() * 6.28, 0.9 + rnd() * 0.9); planted++;
      }
      add(trees, M.plain);

      /* ---- swamp water ---- */
      {
        const water = new T.Mesh(new T.PlaneGeometry(520, 520), new T.MeshBasicMaterial({ color: 0x244a4e, transparent: true, opacity: 0.86 }));
        water.rotation.x = -Math.PI / 2; water.position.set(225, -3.8, 350); S.group.add(water);
        renderer.animators.push((dt, t) => { water.position.y = -3.8 + Math.sin(t * 0.8) * 0.06; });
      }

      /* ---- jack-o'-lanterns along the road ---- */
      {
        const P = new KL.Batch(), pos = [];
        for (let s = 30; s < track.length; s += 34 + rnd() * 26) { const sd = rnd() < 0.5 ? -1 : 1, lim = track.at(s, 0).hw + 2.6 + 0.9; const p = track.at(s, sd * lim); const y = p.y + 0.15; P.sphere(p.x, y + 0.55, p.z, 0.62, 7, col('#f27a14'), { sy: 0.85 }); P.cyl(p.x, y + 1.1, p.z, 0.1, 0.07, 0.3, 4, col('#2f5a2a')); P.box(p.x, y + 0.55, p.z + 0.3, 0.3, 0.2, 0.1, 0, col('#ffe27a')); pos.push(p.x, y + 0.7, p.z); }
        add(P, M.plain);
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        const pts = new T.Points(g, new T.PointsMaterial({ map: KL.tex.glow(), color: 0xffa040, size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.8, fog: false }));
        pts.frustumCulled = false; S.group.add(pts); renderer.glowPoints.push(pts);
      }

      /* ---- floating candles around the castle path + torch glows ---- */
      {
        const pos = [], C = new KL.Batch();
        for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, r = 40 + rnd() * 40, x = -50 + Math.cos(a) * r, z = 152 + Math.sin(a) * r * 0.8, y = terr(x, z) + 3 + rnd() * 5; C.cyl(x, y, z, 0.12, 0.12, 0.5, 5, col('#f1ead2')); pos.push(x, y + 0.7, z); }
        add(C, M.plain);
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        const pts = new T.Points(g, new T.PointsMaterial({ map: KL.tex.glow(), color: 0xffe08a, size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.9, fog: false }));
        pts.frustumCulled = false; S.group.add(pts); renderer.glowPoints.push(pts);
      }
      add(B, M.plain);
      add(E, M.plainEmissive);

      /* ---- bats circling the keep ---- */
      {
        const wing = new T.BufferGeometry(); wing.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1.3, 0.25, -0.5, 0.2, 0, -0.7, 0, 0, 0, 0.2, 0, -0.7, 0.9, -0.1, -1.0], 3)); wing.computeVertexNormals();
        const bm = new T.MeshBasicMaterial({ color: 0x1a1424, side: T.DoubleSide });
        const bats = [];
        for (let i = 0; i < 14; i++) { const g = new T.Group(), w1 = new T.Mesh(wing, bm), w2 = new T.Mesh(wing, bm); w2.scale.x = -1; g.add(w1, w2); S.group.add(g); bats.push({ g, w1, w2, a: rnd() * 6.28, r: 22 + rnd() * 34, h: 36 + rnd() * 16, sp: 0.35 + rnd() * 0.4, ph: rnd() * 6 }); }
        renderer.animators.push((dt, t) => {
          for (const b of bats) { b.a += dt * b.sp; const x = -50 + Math.cos(b.a) * b.r, z = 152 + Math.sin(b.a) * b.r, y = b.h + Math.sin(t * 1.3 + b.ph) * 2.5; b.g.position.set(x, y, z); b.g.rotation.y = -b.a - Math.PI / 2; const fl = Math.sin(t * 14 + b.ph) * 0.8; b.w1.rotation.z = fl; b.w2.rotation.z = -fl; }
        });
      }

      /* ---- drifting ghosts (billboards) ---- */
      {
        const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
        const gr = g.createRadialGradient(64, 56, 4, 64, 60, 60); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(210,225,255,.55)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(24, 118); g.lineTo(24, 56); g.arc(64, 56, 40, Math.PI, 0); g.lineTo(104, 118); for (let i = 0; i < 4; i++) g.quadraticCurveTo(96 - i * 18, 100, 86 - i * 18, 118); g.closePath(); g.fill();
        g.fillStyle = '#1b1530'; g.beginPath(); g.ellipse(50, 56, 7, 10, 0, 0, 7); g.ellipse(78, 56, 7, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(64, 80, 6, 9, 0, 0, 7); g.fill();
        const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
        const ghosts = [];
        for (let i = 0; i < 9; i++) { const s = (i / 9) * track.length + rnd() * 60, sd = i % 2 ? -1 : 1, p = track.at(s, sd * (track.at(s, 0).hw + 9 + rnd() * 6)); const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false })); sp.scale.set(5, 5, 1); sp.position.set(p.x, p.y + 3.2, p.z); S.group.add(sp); ghosts.push({ sp, x: p.x, y: p.y + 3.2, z: p.z, ph: rnd() * 6.28 }); }
        renderer.animators.push((dt, t) => { for (const gh of ghosts) { gh.sp.position.set(gh.x + Math.sin(t * 0.7 + gh.ph) * 2.2, gh.y + Math.sin(t * 1.4 + gh.ph) * 0.6, gh.z + Math.cos(t * 0.6 + gh.ph) * 2.2); gh.sp.material.opacity = 0.35 + 0.25 * Math.sin(t * 2 + gh.ph); } });
      }
    },
  });
})();
