/* Kart Lëtzebuerg — shared helpers for the track files: distance fields, valley terrain + painting, tram line, bridge girders. */
(function () {
  'use strict';
  const KL = window.KL, { clamp, lerp, smooth } = KL;
  const K = (KL.kit = {});
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const decode = (a) => { const o = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i] / 10, a[i + 1] / 10]); return o; };
  K.hex = hex; K.mixc = mixc;

  /* rivers of a baked OSM extract (kind 0 = river) as polylines in metres */
  K.rivers = (id, kinds) => ((KL.osm[id] && KL.osm[id].w) || []).filter((w) => (kinds || [0]).includes(w[0])).map((w) => decode(w[1]));

  /* distance to the nearest of several polylines, sampled on a grid (bilinear): fast enough for terrain queries by the thousand */
  K.distField = (lines, x0, z0, x1, z1, cell) => {
    const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1, f = new Float32Array(nx * nz);
    const segs = []; for (const l of lines) for (let i = 0; i + 1 < l.length; i++) segs.push([l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]]);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell; let best = 1e9;
      for (const s of segs) { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1, t = clamp(((x - s[0]) * dx + (z - s[1]) * dz) / l2, 0, 1), ex = x - (s[0] + dx * t), ez = z - (s[1] + dz * t), d = ex * ex + ez * ez; if (d < best) best = d; }
      f[j * nz + i] = Math.sqrt(best);
    }
    return (x, z) => {
      const fx = clamp((x - x0) / cell, 0, nx - 1.001), fz = clamp((z - z0) / cell, 0, nz - 1.001), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const a = f[j * nz + i], b = f[j * nz + i + 1], c = f[(j + 1) * nz + i], d = f[(j + 1) * nz + i + 1];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
    };
  };

  /* emissive geometry that only shows at night (windows, signs): returns the mesh; chains the theme's onWeather hook */
  K.nightOnly = (S, batch, threshold) => {
    const m = S.add(batch, S.mats.plainEmissive); if (!m) return null;
    const prev = S.theme.onWeather, th = threshold != null ? threshold : 0.35;
    S.theme.onWeather = (r, name, W) => { if (prev) prev(r, name, W); m.visible = W.night >= th; };
    m.visible = false; return m;
  };

  /* a river valley: floor at -depth within `a` metres of the river, level plateau beyond `b` metres */
  K.valleyTerrain = (id, o) => {
    let field = null;
    return (x, z) => {
      if (!field) { const r = K.rivers(id, o.kinds); field = r.length ? K.distField(r, o.box[0], o.box[1], o.box[2], o.box[3], o.cell || 6) : () => 1e9; }
      const d = field(x, z); if (d >= o.b) return 0;
      return -o.depth * (1 - smooth(o.a, o.b, d));
    };
  };

  /* paint the valley (rock slopes, grass floor, river) into the top-down street map */
  K.valleyPaint = (terrain, id, o) => (g, X, Z, sc, data) => {
    for (const poly of o.lawns || []) { g.beginPath(); poly.forEach((q, i) => { if (i) g.lineTo(X(q[0]), Z(q[1])); else g.moveTo(X(q[0]), Z(q[1])); }); g.closePath(); g.fillStyle = o.lawn || '#7fb55e'; g.fill(); }
    const [x0, z0, x1, z1] = o.box, cs = 3, cw = Math.round((x1 - x0) / cs), ch = Math.round((z1 - z0) / cs);
    const ROCK = hex(o.rock || '#a39c8c'), GRASS = hex(o.grass || '#6aa149'), GRASS2 = hex(o.grass2 || '#86b85c'), PAVE = hex(o.edge || '#b2aea6'), DEEP = hex(o.floor || '#79ad55');
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const cg = cv.getContext('2d'), im = cg.createImageData(cw, ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = x0 + (i + 0.5) * cs, z = z0 + (j + 0.5) * cs, h = terrain(x, z), a = clamp(-h / 4, 0, 1), depth = clamp(-h / o.depth, 0, 1), n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + 0.5, p = (j * cw + i) * 4;
      let c; if (depth < 0.4) c = mixc(PAVE, ROCK, smooth(0, 0.22, depth)); else c = mixc(ROCK, mixc(GRASS, GRASS2, n), smooth(0.3, 0.75, depth));
      if (depth > 0.85) c = mixc(c, DEEP, 0.35);
      im.data[p] = c[0]; im.data[p + 1] = c[1]; im.data[p + 2] = c[2]; im.data[p + 3] = a * 255;
    }
    cg.putImageData(im, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(cv, X(x0), Z(z0), (x1 - x0) * sc, (z1 - z0) * sc);
    const rnd = KL.rng(77);
    for (let k = 0; k < (o.blotches || 2400); k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), h = terrain(x, z); if (h > -o.depth * 0.2) continue;
      g.fillStyle = rnd() > 0.5 ? 'rgba(40,100,40,.18)' : 'rgba(150,200,90,.16)'; g.beginPath(); g.ellipse(X(x), Z(z), (1 + rnd() * 5) * sc, (1 + rnd() * 3) * sc, rnd() * 3, 0, 7); g.fill();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const l of K.rivers(id, o.kinds)) for (const [w, c] of [[9, '#3d86b8'], [6, '#5aa9d6'], [2, 'rgba(210,235,250,.7)']]) {
      g.beginPath(); l.forEach((q, i) => { if (i) g.lineTo(X(q[0]), Z(q[1])); else g.moveTo(X(q[0]), Z(q[1])); }); g.lineWidth = w * sc; g.strokeStyle = c; g.stroke();
    }
  };
  /* ================= fantasy-track helpers (stage 2b) ================= */
  const T3 = () => window.THREE;
  const gv = (hexv, k) => { const c = KL.col(hexv); return [c[0] * k, c[1] * k, c[2] * k]; };
  K.cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  K.canvasTex = (c, o) => { o = o || {}; const T = T3(), t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = o.wrapS || T.RepeatWrapping; t.wrapT = o.wrapT || T.RepeatWrapping; t.anisotropy = KL.maxAniso || 4; return t; };

  /* a quad strip along the main road: s0..s1, lateral d0..d1 (d > 0 right), yo above the surface; u = across 0..1 (x uvx), v = metres / vscale */
  K.strip = (B, track, s0, s1, d0, d1, yo, color, vscale, uvx) => {
    const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 2)), a = [], b = [];
    for (let i = 0; i <= n; i++) { const s = s0 + ((s1 - s0) * i) / n; a.push(track.at(s, d0)); b.push(track.at(s, d1)); }
    for (let i = 0; i < n; i++) {
      const v0 = (i * Math.abs(s1 - s0)) / n / (vscale || 6), v1 = ((i + 1) * Math.abs(s1 - s0)) / n / (vscale || 6), ux = uvx || 1;
      B.quadUV([a[i].x, a[i].y + yo, a[i].z], [b[i].x, b[i].y + yo, b[i].z], [b[i + 1].x, b[i + 1].y + yo, b[i + 1].z], [a[i + 1].x, a[i + 1].y + yo, a[i + 1].z], color || [1, 1, 1], [0, v0], [ux, v0], [ux, v1], [0, v1]);
    }
  };

  /* second routes (track.def.alts): a ribbon of road along each alt polyline; `o.mat` = material (lit, vertex colours + map) */
  K.altRoads = (S, o) => {
    const { track } = S, tmp = {}, road = new KL.Batch();
    for (const a of track.alts) {
      const P = a.P, L = [], R = [];
      for (let i = 0; i < P.length; i++) {
        const q = P[Math.min(P.length - 1, i + 1)], r = P[Math.max(0, i - 1)]; let tx = q[0] - r[0], tz = q[1] - r[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const pj = track.project(P[i][0], P[i][1], -1, null, tmp), y = pj.y + 0.17;
        L.push([P[i][0] + tz * a.hw, y, P[i][1] - tx * a.hw]); R.push([P[i][0] - tz * a.hw, y, P[i][1] + tx * a.hw]);
      }
      let v = 0;
      for (let i = 0; i + 1 < P.length; i++) {
        const dv = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) / 8;
        road.quadUV(L[i], R[i], R[i + 1], L[i + 1], o.color || [1, 1, 1], [0, v], [1, v], [1, v + dv], [0, v + dv]);
        v += dv;
      }
    }
    if (road.count) S.add(road, o.mat);
    return road;
  };

  /* surface patches (track.def.patches): decals on the road. styles: { goo: { a: '#hex', b: '#hex', emissive: bool, flow: speed }, ice: {...}, lava: {...} } */
  K.patchDecals = (S, styles) => {
    const { track, renderer } = S, T = T3(), made = {};
    for (const q of track.patches) {
      const st = styles[q.kind]; if (!st) continue;
      let m = made[q.kind];
      if (!m) {
        const [c, g] = K.cv(128, 128), rnd = KL.rng(KL.hashStr(q.kind));
        g.fillStyle = st.a; g.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 40; i++) { g.fillStyle = st.b; g.globalAlpha = 0.25 + rnd() * 0.5; g.beginPath(); g.ellipse(rnd() * 128, rnd() * 128, 4 + rnd() * 16, 3 + rnd() * 9, rnd() * 3, 0, 7); g.fill(); }
        g.globalAlpha = 1;
        if (st.glints) for (let i = 0; i < 22; i++) { g.fillStyle = st.glints; g.globalAlpha = 0.35 + rnd() * 0.5; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 0, 7); g.fill(); } g.globalAlpha = 1;
        const tex = K.canvasTex(c);
        const mat = st.emissive ? new T.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }) : new T.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: st.opacity != null, opacity: st.opacity != null ? st.opacity : 1 });
        m = made[q.kind] = { B: new KL.Batch(), mat, tex, st };
      }
      const s1 = q.s1 < q.s0 ? q.s1 + track.length : q.s1;
      K.strip(m.B, track, q.s0, s1, q.d0, q.d1, 0.05, [1, 1, 1], 8, Math.max(1, (q.d1 - q.d0) / 8));
    }
    for (const k in made) {
      const m = made[k], mesh = S.add(m.B, m.mat);
      if (m.st.flow && renderer) renderer.animators.push((dt) => { m.tex.offset.y -= dt * m.st.flow; });
    }
  };

  /* wedge supports under ramps that rise above the base height: side walls from the wall line down below the terrain */
  K.skirts = (S, color) => {
    const { track } = S, B = new KL.Batch(), c = color || KL.col('#8a8f99');
    for (const rp of track.def.ramps || []) {
      const k = rp.k, i0 = Math.floor((((rp.s + k[0][0]) % track.length) + track.length) % track.length / track.step), n = Math.ceil((k[k.length - 1][0] - k[0][0]) / track.step) + 1;
      for (let m = 0; m < n; m++) {
        const i = (i0 + m) % track.N, j = (i + 1) % track.N;
        if (track.Y[i] - track.YB[i] < 0.25 && track.Y[j] - track.YB[j] < 0.25) continue;
        for (const sd of [-1, 1]) {
          const lim = (q) => track.HW[q] + (sd < 0 ? track.WL[q] : track.WR[q]) + 0.55;
          const a = KL.edgePt(track, i, sd * lim(i), 0), b = KL.edgePt(track, j, sd * lim(j), 0);
          const aLow = track.YB[i] - 2.5, bLow = track.YB[j] - 2.5;
          const P0 = [a[0], aLow, a[2]], P1 = [b[0], bLow, b[2]], P2 = [b[0], b[1], b[2]], P3 = [a[0], a[1], a[2]];
          if (sd > 0) B.quad(P0, P1, P2, P3, c); else B.quad(P1, P0, P3, P2, c);
        }
      }
    }
    if (B.count) S.add(B, S.mats.plain);
  };

  /* a river / stream: ribbon along a world polyline [[x, z], ...] with half width w at height y */
  K.river = (S, pts0, w, y, mat, vscale) => {
    const B = new KL.Batch(), yf = typeof y === 'function' ? y : () => y; let pts = pts0, v = 0;
    if (typeof y === 'function') { pts = []; for (let i = 0; i + 1 < pts0.length; i++) { const a = pts0[i], b = pts0[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9)); for (let k = 0; k < n; k++) pts.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]); } pts.push(pts0[pts0.length - 1]); }
    const nrm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dz / l * w, -dx / l * w]; });      // averaged normals: no gaps at the bends
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dv = dl / (vscale || 10), ya = yf(a[0], a[1]), yb = yf(b[0], b[1]), na = nrm[i], nb = nrm[i + 1];
      B.quadUV([a[0] + na[0], ya, a[1] + na[1]], [a[0] - na[0], ya, a[1] - na[1]], [b[0] - nb[0], yb, b[1] - nb[1]], [b[0] + nb[0], yb, b[1] + nb[1]], [1, 1, 1], [0, v], [1, v], [1, v + dv], [0, v + dv]);
      v += dv;
    }
    return S.add(B, mat);
  };

  /* random placement away from the road: fn(x, y, z, i) for up to n points inside box [x0, z0, x1, z1] whose distance to the road is >= clear (and fn not skipped) */
  K.scatter = (S, rnd, n, box, clear, fn, maxTry) => {
    const { track } = S, tmp = {}, terr = track.terrain || (() => 0); let placed = 0, tries = 0;
    while (placed < n && tries++ < (maxTry || n * 30)) {
      const x = box[0] + rnd() * (box[2] - box[0]), z = box[1] + rnd() * (box[3] - box[1]), p = track.project(x, z, -1, null, tmp), dist = Math.hypot(x - p.cx, z - p.cz);
      if (dist < p.hw + Math.max(p.wl, p.wr) + clear) continue;
      if (track.onAlt(x, z) || (track.alts.length && track.alts.some((a) => { for (let i = 0; i < a.P.length; i += 2) if (Math.hypot(a.P[i][0] - x, a.P[i][1] - z) < a.hw + clear) return true; return false; }))) continue;
      if (fn(x, terr(x, z), z, placed) === false) continue;
      placed++;
    }
    return placed;
  };

  /* glowing points (always on or with the night amount): positions flat [x,y,z,...] */
  K.glow = (S, pos, o) => {
    const T = T3(), g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const p = new T.Points(g, new T.PointsMaterial({ map: KL.tex.glow(), color: o.color || 0xffe08a, size: o.size || 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: o.opacity != null ? o.opacity : 0.9, fog: false }));
    p.frustumCulled = false; S.group.add(p); if (o.night !== false) S.renderer.glowPoints.push(p); return p;
  };

  /* timed fire geysers (track.def.hazards): a pulsing warning ring on the ground, then a column of flame while the sim burns karts there */
  K.geysers = (S, o) => {
    const T = T3(), R = S.race, hz = R && R.hazards || [], items = [];
    if (!hz.length) return;
    const ringMat = new T.MeshBasicMaterial({ map: KL.tex.glow(), color: o.ring || 0xff6a1a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const colMat = new T.MeshBasicMaterial({ color: o.flame || 0xffa030, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide });
    const coreMat = new T.MeshBasicMaterial({ color: o.core || 0xfff1b0, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide });
    const colGeo = new T.CylinderGeometry(0.55, 1, 1, 10, 1, true), vent = new KL.Batch();
    for (const h of hz) {
      const ring = new T.Mesh(new T.PlaneGeometry(h.r * 2.6, h.r * 2.6), ringMat.clone()); ring.rotation.x = -Math.PI / 2; ring.position.set(h.x, h.y + 0.12, h.z); S.group.add(ring);
      const col = new T.Mesh(colGeo, colMat.clone()), core = new T.Mesh(colGeo, coreMat.clone()); col.scale.set(h.r * 0.85, 0.01, h.r * 0.85); core.scale.set(h.r * 0.4, 0.01, h.r * 0.4);
      col.position.set(h.x, h.y, h.z); core.position.set(h.x, h.y, h.z); col.visible = core.visible = false; S.group.add(col, core);
      vent.cyl(h.x, h.y, h.z, h.r * 0.75, h.r * 0.95, 0.5, 10, KL.col(o.vent || '#2b2220'), { capTop: true });
      items.push({ h, ring, col, core });
    }
    S.add(vent, S.mats.plain);
    const H = o.height || 11;
    S.renderer.animators.push((dt, t) => {
      for (const it of items) {
        const st = R.hazardState(it.h), on = st === 2, warn = st > 0 && !on;
        it.ring.material.opacity = on ? 0.9 : warn ? 0.25 + 0.55 * st * (0.6 + 0.4 * Math.sin(t * 22)) : 0;
        it.ring.scale.setScalar(on ? 1.25 : 0.7 + 0.5 * st);
        it.col.visible = it.core.visible = on;
        if (on) { const f = 1 + 0.12 * Math.sin(t * 40 + it.h.id); it.col.scale.y = H * f; it.core.scale.y = H * 0.82 * f; it.col.position.y = it.h.y + H * f / 2; it.core.position.y = it.h.y + H * 0.82 * f / 2; }
      }
    });
  };
  /* a tunnel / cave over a stretch of road or along any polyline. o.pts = [[x, y, z, hw], ...] (centre line, <= 6 m apart); o.H inner height, o.thick shell thickness;
   * colours: o.inner (walls), o.outer (shell), o.top (cap, snow), o.crystal (emissive spikes), o.drip (stalactites). Returns nothing; adds meshes to S. */
  K.tunnel = (S, o) => {
    const P = o.pts, n = P.length, B = new KL.Batch(), E = new KL.Batch(), rnd = KL.rng(o.seed || 5), M = 14, H = o.H || 11, th = o.thick || 6;
    const ci = KL.col(o.inner || '#9ccbea'), co = KL.col(o.outer || '#d6e6f4'), ct = KL.col(o.top || '#ffffff'), cc = KL.col(o.crystal || '#7fe0ff'), cd = KL.col(o.drip || '#cfeaff');
    const fr = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; let tx = b[2] - a[2] === 0 && b[0] - a[0] === 0 ? 1 : b[0] - a[0], tz = b[2] - a[2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return { tx, tz, rx: -tz, rz: tx }; });
    const jit = (i, k) => 1 + (Math.sin(i * 1.7 + k * 2.3) * 0.5 + Math.sin(i * 0.43 + k * 5.1) * 0.5) * 0.09 * (o.rough || 1);
    const prof = (i, k, out) => {          // inner profile point k of ring i -> [u, v]
      const a = Math.PI - (Math.PI * k) / M, W = P[i][3] + (o.margin || 5), j = jit(i, k);
      return [Math.cos(a) * W * j, Math.pow(Math.sin(a), 0.75) * H * j];
    };
    const outer = (i, k) => {              // outer shell point of ring i -> [u, v]
      const a = Math.PI - (Math.PI * k) / M, e = Math.min(i, n - 1 - i), tp = 0.38 + 0.62 * KL.smooth(0, 4, e), W = P[i][3] + (o.margin || 5), sn = Math.sin(a);
      const lump = 1 + 0.1 * Math.sin(i * 0.37 + k * 0.7) + 0.07 * Math.sin(i * 0.91 + k * 1.9 + 1) + 0.05 * Math.sin(i * 0.19 - k * 0.5);
      return [Math.cos(a) * (W + th * 1.1 * tp * lump), -2 + (H + 2 + th * 1.15 * tp * lump) * Math.pow(Math.max(0, sn), 0.7)];
    };
    const pt = (i, u, v) => [P[i][0] + fr[i].rx * u, P[i][1] + v, P[i][2] + fr[i].rz * u];
    const Qf = (p0, p1, p2, p3, c, hx, hy, hz) => {        // quad facing the hint direction (hx,hy,hz)
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * hx + ny * hy + nz * hz >= 0) B.quad(p0, p1, p2, p3, c); else B.quad(p0, p3, p2, p1, c);
    };
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k < M; k++) {
      const a0 = prof(i, k), a1 = prof(i, k + 1), b0 = prof(i + 1, k), b1 = prof(i + 1, k + 1);
      const q = [pt(i, ...a0), pt(i + 1, ...b0), pt(i + 1, ...b1), pt(i, ...a1)], cx = (a0[0] + a1[0]) / 2, cy = (a0[1] + a1[1]) / 2;
      const sh = 0.8 + 0.28 * Math.min(1, cy / H) + 0.1 * ((i * 7 + k * 3) % 5) / 4;
      Qf(q[0], q[1], q[2], q[3], KL.shade(ci, sh), -fr[i].rx * cx, H * 0.45 - cy, -fr[i].rz * cx);          // faces inward (towards the axis)
      // shell: a rounded, lumpy dome (superellipse) that is thinner at the portals and carries a snow cap
      const o0 = outer(i, k), o1 = outer(i, k + 1), p0 = outer(i + 1, k), p1 = outer(i + 1, k + 1);
      const oq = [pt(i, ...o0), pt(i + 1, ...p0), pt(i + 1, ...p1), pt(i, ...o1)], hi = (o0[1] + o1[1] + p0[1] + p1[1]) / 4 / (H + th);
      const mixK = KL.smooth(0.3 + 0.04 * Math.sin(i * 1.3 + k * 2.1), 0.62, hi);
      Qf(oq[0], oq[1], oq[2], oq[3], KL.shade(KL.mix(co, ct, mixK), 0.86 + 0.14 * ((i * 5 + k * 3) % 4) / 3), cx * fr[i].rx, cy + 6, cx * fr[i].rz);       // faces outward
    }
    // portals: close the shell between inner and outer ring at both ends
    for (const [i, dir] of [[0, -1], [n - 1, 1]]) for (let k = 0; k < M; k++) {
      const a0 = prof(i, k), a1 = prof(i, k + 1), o0 = outer(i, k), o1 = outer(i, k + 1);
      Qf(pt(i, ...a0), pt(i, ...a1), pt(i, ...o1), pt(i, ...o0), KL.shade(co, 0.95), fr[i].tx * dir, 0, fr[i].tz * dir);
    }
    // snow drifts piled on the dome
    for (let i = 3; i + 3 < n; i += 2) if (rnd() < 0.7) { const u = (rnd() - 0.5) * (P[i][3] + (o.margin || 5)) * 0.6, e = outer(i, M / 2), q = pt(i, u, e[1] * 0.97); B.sphere(q[0], q[1] - 0.6, q[2], 2.2 + rnd() * 2.4, 6, KL.shade(ct, 0.93 + rnd() * 0.07), { sy: 0.5, noise: 1 }); }
    // stalactites and crystals
    for (let i = 1; i + 1 < n; i++) {
      if (rnd() < 0.55) { const k = 3 + Math.floor(rnd() * 5), a = prof(i, k), u = a[0] * 0.92 + (rnd() - 0.5) * 2, p = pt(i, u, a[1] - 0.4), len = 1.6 + rnd() * 3.2; B.cyl(p[0], p[1] - len, p[2], 0.05, 0.4 + rnd() * 0.5, len, 5, cd, { flat: true }); }
      if (rnd() < 0.4) { const sd = rnd() < 0.5 ? -1 : 1, a = prof(i, sd < 0 ? 0 : M), p = pt(i, a[0] * 0.96, 0.2), h = 1.4 + rnd() * 2.6; E.cyl(p[0], p[1], p[2], 0.5, 0.05, h, 5, KL.shade(cc, 0.8 + rnd() * 0.4), { flat: true }); }
    }
    S.add(B, S.mats.plain); S.add(E, S.mats.plainEmissive);
  };

  /* samples of the main road for K.tunnel: s0..s1 every `step` metres -> [[x, y, z, hw], ...] */
  K.roadPts = (track, s0, s1, step) => { const o = []; for (let s = s0; s <= s1 + 1e-6; s += step || 5) { const p = track.at(s, 0); o.push([p.x, p.y, p.z, p.hw]); } return o; };
})();
