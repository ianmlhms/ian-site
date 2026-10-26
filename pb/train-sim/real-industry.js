/* Zuchsimulator W3: industrial silhouettes of the real routes (steelworks halls, chimneys, tanks, cooling towers, pipe racks, logistics sheds).
 *   TS.realIndustry.fill(ctx)   draws the objects of one landscape chunk into its merged meshes (ctx = chunk context of landscape.js, see the hook there)
 *
 * The data comes from scripts/zuch/build_industry.py (OSM industrial zones + LOD2 footprints / heights), per leg in <route>-features.json (`industry`), resolved by real-line.js
 * (`real.industryIn(s0, s1)`).  Object frame: local +x along the track, +z to the right (= landscape placeM with yawOf), polygon points [ds, dl] relative to the object centre.
 * Everything is painted with vertex colours into the chunk's wall / roof meshes (no extra draw calls): rust, grey and pale cladding, plinths, clerestory bands, roof monitors. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const PLINTH = 1.6;           // m, concrete base of every wall
  const BAND_H = 1.9;           // m, glazing / louvre band under the eave of a tall hall
  const PANEL = 6.0;            // m, width of one cladding panel (alternate shades) along a wall
  const BAY = 22;               // m, span of one roof bay of a big hall
  const WALL = ['#8d9298', '#8c5d46', '#b9b5aa', '#6f757b', '#7d8a82', '#80503d', '#9aa0a2', '#a7a090'];
  const ROOF = ['#6b6f72', '#7a6e66', '#5f656a', '#85796c'];
  const hash = (a, b) => { let h = (Math.imul(Math.round(a * 7.31) + 1013, 374761393) ^ Math.imul(Math.round(b * 3.17) + 7919, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };

  /* ------------------------------------------------------------------ hall */
  function ccw(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a > 0 ? p : p.slice().reverse(); }

  /* the faces of matBlock are single sided: every quad / triangle is wound so that its normal points along `out` (a Vector3-like {x, y, z} direction away from the solid) */
  function orient(c, mb, M0, pts, col, out) {
    const { T } = c;
    const e1 = new T.Vector3().subVectors(pts[1], pts[0]); const e2 = new T.Vector3().subVectors(pts[2], pts[0]);
    const n = e1.cross(e2);
    const ok = n.x * out.x + n.y * out.y + n.z * out.z >= 0;
    const q = ok ? pts : pts.slice().reverse();
    if (q.length === 4) mb.quad(M0, q[0], q[1], q[2], q[3], null, col); else mb.tri(M0, q[0], q[1], q[2], null, col);
  }

  /* chord of the polygon along the line through (px, pz) with direction (dx, dz): [t0, t1] of the longest inside piece, or null */
  function chord(pts, px, pz, dx, dz) {
    const ts = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const ex = b[0] - a[0]; const ez = b[1] - a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - px) * ez - (a[1] - pz) * ex) / den;
      const u = ((a[0] - px) * dz - (a[1] - pz) * dx) / den;
      if (u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i + 1 < ts.length; i += 2) if (!best || ts[i + 1] - ts[i] > best[1] - best[0]) best = [ts[i], ts[i + 1]];
    return best;
  }

  function hall(c, o, M0, groundAt) {
    const { T, mbBlock, C, mixColor } = c;
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const pts = ccw(o.p);
    const n = pts.length;
    const h = hash(o.s, o.l);
    const wall = C(WALL[h % WALL.length]);
    const rust = h % 3 === 0;
    const wallLo = mixColor(wall, C('#4a3b33'), rust ? 0.3 : 0.16);      // dirtier foot of the cladding
    const wallAlt = mixColor(wall, C('#2e2a28'), 0.1);                  // alternate cladding panels
    const roofC = C(ROOF[(h >> 4) % ROOF.length]).multiplyScalar(0.34);  // top faces in matBlock catch the full sun: dark colours
    const plinthC = C('#8d8a83');
    const bandC = C('#38424a');
    const gy = pts.map((q) => groundAt(q[0], q[1]));
    const base = Math.max(...gy);
    const eave = Math.max(2.5, o.e);
    const top = base + eave;
    const band = eave >= 7 ? BAND_H : 0;
    let cx = 0; let cz = 0;
    pts.forEach((q) => { cx += q[0] / n; cz += q[1] / n; });
    // walls: skirt + plinth, cladding in panels, clerestory band
    for (let i = 0; i < n; i++) {
      const a = pts[i]; const b = pts[(i + 1) % n];
      const ex = b[0] - a[0]; const ez = b[1] - a[1]; const el = Math.hypot(ex, ez);
      if (el < 0.5) continue;
      const out = { x: ez, y: 0, z: -ex };   // outward normal of an edge of a counter-clockwise polygon
      const lowA = Math.min(gy[i] - 0.6, base - 0.2); const lowB = Math.min(gy[(i + 1) % n] - 0.6, base - 0.2);
      const P = (t) => [a[0] + ex * t, a[1] + ez * t];
      const nP = Math.max(1, Math.round(el / PANEL));
      for (let k = 0; k < nP; k++) {
        const p0 = P(k / nP); const p1 = P((k + 1) / nP);
        const yl0 = lowA + (lowB - lowA) * (k / nP); const yl1 = lowA + (lowB - lowA) * ((k + 1) / nP);
        const pil = k % 4 === 0;
        const col = pil ? mixColor(wall, C('#2e2a28'), 0.2) : k % 2 ? wallAlt : wall;
        orient(c, mbBlock, M0, [V(p0[0], yl0, p0[1]), V(p1[0], yl1, p1[1]), V(p1[0], base + PLINTH, p1[1]), V(p0[0], base + PLINTH, p0[1])], plinthC, out);
        orient(c, mbBlock, M0, [V(p0[0], base + PLINTH, p0[1]), V(p1[0], base + PLINTH, p1[1]), V(p1[0], base + PLINTH + 2.4, p1[1]), V(p0[0], base + PLINTH + 2.4, p0[1])], wallLo, out);
        orient(c, mbBlock, M0, [V(p0[0], base + PLINTH + 2.4, p0[1]), V(p1[0], base + PLINTH + 2.4, p1[1]), V(p1[0], top - band, p1[1]), V(p0[0], top - band, p0[1])], col, out);
        if (band) orient(c, mbBlock, M0, [V(p0[0], top - band, p0[1]), V(p1[0], top - band, p1[1]), V(p1[0], top, p1[1]), V(p0[0], top, p0[1])], bandC, out);
      }
    }
    // roof
    const ridge = Math.min(Math.max(0, o.r - eave), 6.5);
    const ux = Math.cos(o.th); const uz = Math.sin(o.th);       // long axis (ridge direction)
    const vx = -uz; const vz = ux;                              // across
    let wMin = 1e9; let wMax = -1e9;
    pts.forEach((q) => { const t = (q[0] - cx) * vx + (q[1] - cz) * vz; wMin = Math.min(wMin, t); wMax = Math.max(wMax, t); });
    const width = wMax - wMin;
    const rectLike = n === 4;
    const up = { x: 0, y: 1, z: 0 };
    if (rectLike && ridge > 0.9) {
      // multi-bay gable roof: bays of about BAY m across, ridges along the long axis
      const nb = Math.max(1, Math.round(width / BAY));
      const bw = width / nb;
      const lenAxis = [1e9, -1e9];
      pts.forEach((q) => { const t = (q[0] - cx) * ux + (q[1] - cz) * uz; lenAxis[0] = Math.min(lenAxis[0], t); lenAxis[1] = Math.max(lenAxis[1], t); });
      const P = (t, w, y) => V(cx + ux * t + vx * w, y, cz + uz * t + vz * w);
      const rh = top + Math.min(ridge, nb > 1 ? 3.6 : 5.5);
      for (let b = 0; b < nb; b++) {
        const w0 = wMin + b * bw; const w1 = w0 + bw; const wm = (w0 + w1) / 2;
        const rc = (b % 2 && nb > 1) ? mixColor(roofC, C('#ffffff'), 0.07) : roofC;
        orient(c, mbBlock, M0, [P(lenAxis[0], w0, top), P(lenAxis[1], w0, top), P(lenAxis[1], wm, rh), P(lenAxis[0], wm, rh)], rc, up);
        orient(c, mbBlock, M0, [P(lenAxis[0], wm, rh), P(lenAxis[1], wm, rh), P(lenAxis[1], w1, top), P(lenAxis[0], w1, top)], mixColor(rc, C('#ffffff'), 0.05), up);
        [lenAxis[0], lenAxis[1]].forEach((t, k) => orient(c, mbBlock, M0, [P(t, w0, top), P(t, w1, top), P(t, wm, rh)], wall, { x: ux * (k ? 1 : -1), y: 0, z: uz * (k ? 1 : -1) }));
      }
    } else {
      // flat roof (a polygon too irregular for gables): triangulated, a parapet rim, skylight / monitor strips every bay across
      const tri = T.ShapeUtils.triangulateShape(pts.map((q) => new T.Vector2(q[0], q[1])), []);
      tri.forEach((t) => orient(c, mbBlock, M0, [V(pts[t[0]][0], top + 0.15, pts[t[0]][1]), V(pts[t[1]][0], top + 0.15, pts[t[1]][1]), V(pts[t[2]][0], top + 0.15, pts[t[2]][1])], roofC, up));
      for (let i = 0; i < n; i++) {
        const a = pts[i]; const b = pts[(i + 1) % n];
        orient(c, mbBlock, M0, [V(a[0], top, a[1]), V(b[0], top, b[1]), V(b[0], top + 0.6, b[1]), V(a[0], top + 0.6, a[1])], mixColor(wall, C('#ffffff'), 0.12), { x: b[1] - a[1], y: 0, z: -(b[0] - a[0]) });
      }
      if (width >= 22) {
        const nb = Math.max(1, Math.round(width / BAY));
        for (let b = 0; b < nb; b++) {
          const w = wMin + (b + 0.5) * (width / nb);
          const px = cx + vx * w; const pz = cz + vz * w;
          const ch = chord(pts, px, pz, ux, uz);
          if (!ch || ch[1] - ch[0] < 16) continue;
          const t0 = ch[0] + 3; const t1 = ch[1] - 3;
          const mh = 1.9; const mw = Math.min(5, width / nb * 0.25);
          const Q = (t, ww, y) => V(px + ux * t + vx * ww, y, pz + uz * t + vz * ww);
          const y0 = top + 0.15; const y1 = y0 + mh;
          orient(c, mbBlock, M0, [Q(t0, -mw, y0), Q(t1, -mw, y0), Q(t1, -mw, y1), Q(t0, -mw, y1)], bandC, { x: -vx, y: 0, z: -vz });
          orient(c, mbBlock, M0, [Q(t0, mw, y0), Q(t1, mw, y0), Q(t1, mw, y1), Q(t0, mw, y1)], bandC, { x: vx, y: 0, z: vz });
          orient(c, mbBlock, M0, [Q(t0, -mw - 0.5, y1), Q(t1, -mw - 0.5, y1), Q(t1, mw + 0.5, y1), Q(t0, mw + 0.5, y1)], roofC.clone().multiplyScalar(1.15), up);
          orient(c, mbBlock, M0, [Q(t0, -mw, y0), Q(t0, mw, y0), Q(t0, mw, y1), Q(t0, -mw, y1)], bandC, { x: -ux, y: 0, z: -uz });
          orient(c, mbBlock, M0, [Q(t1, -mw, y0), Q(t1, mw, y0), Q(t1, mw, y1), Q(t1, -mw, y1)], bandC, { x: ux, y: 0, z: uz });
        }
      }
    }
    // a pipe bundle along the long face of a big hall (steelworks look)
    if (o.e >= 9 && width * 0 + Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) > 30) addPipes(c, pts, M0, base + eave * 0.62, h);
  }

  /* two or three pipes along the longest edge of a hall, on brackets, in rust / grey / pale colours */
  function addPipes(c, pts, M0, y, h) {
    const { T, mbBlock, C } = c;
    let best = 0; let bl = 0;
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = i; } });
    if (bl < 30) return;
    const a = pts[best]; const b = pts[(best + 1) % pts.length];
    const dx = (b[0] - a[0]) / bl; const dz = (b[1] - a[1]) / bl;
    const nx = dz; const nz = -dx;                       // 1.3 m off the wall, towards the outside of a CCW polygon
    const cols = [C('#9a9da0'), C('#8a5440'), C('#b9b7ae')];
    const len = Math.min(bl - 6, 140);
    const mx = (a[0] + b[0]) / 2 + nx * 1.4; const mz = (a[1] + b[1]) / 2 + nz * 1.4;
    const ang = Math.atan2(dz, dx);
    const m = M0.clone().multiply(new T.Matrix4().makeTranslation(mx, 0, mz)).multiply(new T.Matrix4().makeRotationY(-ang));
    const k = 2 + (h % 2);
    for (let j = 0; j < k; j++) {
      const r = 0.34 + (j % 2) * 0.22;
      mbBlock.addGeo(new T.CylinderGeometry(r, r, len, 8).rotateZ(Math.PI / 2), m.clone().multiply(new T.Matrix4().makeTranslation(0, y + j * 1.2, 0.4 * j)), cols[(j + h) % 3], true);
    }
    for (let t = -len / 2; t <= len / 2; t += 9) mbBlock.addGeo(new T.BoxGeometry(0.35, 3.2, 0.35), m.clone().multiply(new T.Matrix4().makeTranslation(t, y + 0.2, -0.5)), C('#6a6f73'), true);
  }

  /* ------------------------------------------------------------------ chimney, tank, cooling tower, pipe rack */
  function chimney(c, o, M0, y0) {
    const { T, mbBlock, C } = c;
    const h = Math.min(o.h, 160); const r = Math.max(1.6, o.r);
    const tall = h > 55;
    const concrete = C(tall ? '#a59f97' : '#8a5a48');
    const segs = 12;
    const rb = Math.max(r, h * 0.035); const rt = rb * 0.62;
    const at = (x, y, z) => M0.clone().multiply(new T.Matrix4().makeTranslation(x, y, z));
    mbBlock.addGeo(new T.CylinderGeometry(rt, rb, h, segs), at(0, y0 + h / 2 - 1.5, 0), (v) => (tall && (v.y - y0) > h * 0.62 && (v.y - y0) < h * 0.75) || (tall && (v.y - y0) > h * 0.88) ? C('#b33d2e') : concrete, true);
    mbBlock.addGeo(new T.CylinderGeometry(rt * 1.1, rt * 1.05, 1.2, segs), at(0, y0 + h - 1.0, 0), C('#3d3a38'), true);
    mbBlock.addGeo(new T.CylinderGeometry(rb * 1.25, rb * 1.4, 3, segs), at(0, y0 + 0.2, 0), C('#7d7a74'), true);
  }

  function tank(c, o, M0, y0) {
    const { T, mbBlock, C, mixColor } = c;
    const r = Math.max(2, o.r); const h = Math.max(3, Math.min(o.h, 45));
    const h0 = hash(o.s, o.l);
    const col = C(['#c9cccc', '#b8bcbc', '#8c5d46', '#a9acaa', '#d6d2c6'][h0 % 5]);
    const at = (x, y, z) => M0.clone().multiply(new T.Matrix4().makeTranslation(x, y, z));
    mbBlock.addGeo(new T.CylinderGeometry(r, r, h + 1.5, 16), at(0, y0 + h / 2 - 0.75, 0), (v) => mixColor(C('#5c5047'), col, Math.min(1, (v.y - y0 + 1) / 2.4)), true);
    mbBlock.addGeo(new T.ConeGeometry(r * 1.02, Math.min(r * 0.22, 3.4), 16), at(0, y0 + h + Math.min(r * 0.22, 3.4) / 2, 0), mixColor(col, C('#8a8f92'), 0.4), true);
    if (r < 9) mbBlock.addGeo(new T.BoxGeometry(0.5, h, 0.5), at(r * 0.95, y0 + h / 2, 0), C('#6f757b'), true);   // ladder
  }

  function coolingTower(c, o, M0, y0) {
    const { T, mbBlock, C } = c;
    const r = Math.max(7, o.r); const h = Math.max(20, Math.min(o.h, 80));
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const k = t < 0.72 ? 0.68 + 0.32 * Math.pow((0.72 - t) / 0.72, 2) : 0.68 + 0.1 * Math.pow((t - 0.72) / 0.28, 2); prof.push(new T.Vector2(r * k, h * t)); }
    const g = new T.LatheGeometry(prof, 20);
    mbBlock.addGeo(g, M0.clone().multiply(new T.Matrix4().makeTranslation(0, y0 - 0.5, 0)), (v) => C((v.y - y0) > h * 0.9 ? '#8e8c86' : '#a9a7a0'), true);
  }

  function pipeRack(c, o, M0, y0) {
    const { T, mbBlock, C } = c;
    const len = Math.max(20, o.len); const w = Math.max(1.6, o.w); const h = Math.max(4, Math.min(o.h, 24));
    const m = M0.clone().multiply(new T.Matrix4().makeRotationY(-o.th));
    const at = (x, y, z) => m.clone().multiply(new T.Matrix4().makeTranslation(x, y, z));
    const steel = C('#6a6f73'); const rust = C('#8a5a43'); const pipeCols = [C('#9a9da0'), C('#7d4f3a'), C('#b8b6ae')];
    const nSup = Math.max(2, Math.round(len / 10));
    for (let i = 0; i < nSup; i++) {
      const x = -len / 2 + (len * i) / (nSup - 1);
      [-1, 1].forEach((sd) => mbBlock.addGeo(new T.BoxGeometry(0.55, h, 0.55), at(x, y0 + h / 2 - 0.5, sd * w * 0.45), steel, true));
      mbBlock.addGeo(new T.BoxGeometry(0.5, 0.5, w + 0.6), at(x, y0 + h - 0.3, 0), steel, true);
    }
    mbBlock.addGeo(new T.BoxGeometry(len, 0.35, w), at(0, y0 + h - 0.05, 0), rust, true);
    const k = Math.max(2, Math.min(4, Math.round(w / 1.4)));
    for (let j = 0; j < k; j++) {
      const z = (j - (k - 1) / 2) * (w / k) * 0.95; const r = 0.28 + (j % 2) * 0.18;
      mbBlock.addGeo(new T.CylinderGeometry(r, r, len, 8).rotateZ(Math.PI / 2), at(0, y0 + h + 0.2 + r, z), pipeCols[j % 3], true);
    }
  }

  /* ------------------------------------------------------------------ chunk hook */
  function fill(c) {
    const list = c.real && c.real.industryIn ? c.real.industryIn(c.s0, c.s1) : [];
    if (!list.length) return 0;
    let n = 0;
    list.forEach((o) => {
      if (c.inTunnel(o.s, 20)) return;
      const p = c.place(o.s, o.l);
      const M0 = c.placeM(p.x, 0, p.z, c.yawOf(p.f));
      const groundAt = (dx, dz) => { const q = c.place(o.s + dx, o.l + dz); return q.y; };
      const y0 = p.y;
      try {
        if (o.k === 'h') {
          hall(c, o, M0, groundAt);
          let sMin = 1e9; let sMax = -1e9; let lMin = 1e9; let lMax = -1e9;
          o.p.forEach((q) => { sMin = Math.min(sMin, q[0]); sMax = Math.max(sMax, q[0]); lMin = Math.min(lMin, q[1]); lMax = Math.max(lMax, q[1]); });
          c.markOcc(o.s + sMin - 2, o.s + sMax + 2, o.l + lMin - 2, o.l + lMax + 2);
        } else if (o.k === 'c') { chimney(c, o, M0, y0); c.markOcc(o.s - o.r - 3, o.s + o.r + 3, o.l - o.r - 3, o.l + o.r + 3); }
        else if (o.k === 't') { tank(c, o, M0, y0); c.markOcc(o.s - o.r - 1, o.s + o.r + 1, o.l - o.r - 1, o.l + o.r + 1); }
        else if (o.k === 'w') { coolingTower(c, o, M0, y0); c.markOcc(o.s - o.r - 2, o.s + o.r + 2, o.l - o.r - 2, o.l + o.r + 2); }
        else if (o.k === 'p') { pipeRack(c, o, M0, y0); }
        n++;
      } catch (e) { console.warn('[Lokféierer] industry object failed', o.k, e && e.message); }
    });
    return n;
  }

  TS.realIndustry = Object.freeze({ fill });
})();
