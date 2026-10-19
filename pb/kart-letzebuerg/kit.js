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
})();
