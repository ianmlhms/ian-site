/* Lokféierer: painted tree kit (geometry + leaf atlas + material) for the landscape and the station patches.
 *   TS.treeKit.create({ decorate, antialias }) -> { geos: { oak: [lod0, lod1, lod2], ... }, meta: { oak: { h, r } }, material, species, dispose() }
 *
 * Every species has three levels of detail (all share one material and one 512 px atlas, so a whole field of trees is a handful of draw calls):
 *   lod0  near  (< ~45 m): lumpy crown blobs with SMOOTH normals + alpha-tested leaf-cluster cards on the surface (the soft, painted silhouette), flared trunk with limbs
 *   lod1  mid   (< ~170 m): 1-3 smooth blobs / 4-5 cone tiers, simple trunk
 *   lod2  far:  one smooth blob / 2 cones (12-30 triangles)
 * Smooth shading comes from blending the sphere / cone normal into the face normals (the old kit had flat-shaded icosahedra, which is what looked faceted).
 * The atlas is painted on a canvas (leaf dabs, no photo): 3 leaf-cluster tiles (alpha cut-out, opaque core), bark, birch bark.
 * Geometry is unit-per-metre (trunk base at y = 0), like the old kit, so the landscape's scale ranges (SPECIES_SCALE) still apply. */
window.TS = window.TS || {};
(function (TS) {
  'use strict';
  const T = THREE;
  const ATLAS = 512;
  const TILES = { c0: [0, 0, 256, 256], c1: [256, 0, 256, 256], c2: [0, 256, 256, 256], bark: [256, 256, 128, 256], birch: [384, 256, 128, 256] };
  const WHITE = [504, 250];
  const SPECIES = ['oak', 'beech', 'birch', 'spruce', 'poplar', 'bush', 'tuft'];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hash2(x, y) {
    let h = Math.imul(Math.round(x) | 0, 374761393) + Math.imul(Math.round(y) | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const hash3 = (x, y, z) => hash2(x * 73 + z * 19, y * 131 + z * 7 + 5);
  /* smooth 3D value noise in [0, 1] */
  function vn3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (a, b, c) => hash3(xi + a, yi + b, zi + c);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v), lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
  }
  function mulberry(seed) {
    let a = seed | 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

  /* ---------------------------------------------------------------- the atlas (painted on a canvas) */
  function paintCluster(g, ox, oy, size, seed) {
    const r = mulberry(seed), cx = ox + size / 2, cy = oy + size / 2, R = size * 0.4;
    const tone = (v, warm) => { const a = clamp(v, 0, 1); return `rgb(${Math.round(255 * clamp(a * (0.96 + warm * 0.06), 0, 1))},${Math.round(255 * a)},${Math.round(255 * clamp(a * (0.84 + warm * 0.12), 0, 1))})`; };
    const leaf = (x, y, len, wid, rot, col) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
    // opaque core (the blob uv window sits inside it): mottled mid tones
    g.fillStyle = tone(0.68, 0); g.beginPath(); g.arc(cx, cy, R * 0.6, 0, Math.PI * 2); g.fill();
    // 6-8 lobes of leaves: an irregular, lumpy cluster instead of one round disc
    const lobes = [];
    const nl = 6 + Math.floor(r() * 3);
    for (let i = 0; i < nl; i++) { const a = (i / nl) * Math.PI * 2 + r() * 0.5, d = R * (0.45 + r() * 0.4); lobes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, rad: R * (0.34 + r() * 0.22), a }); }
    lobes.push({ x: cx, y: cy, rad: R * 0.55, a: 0 });
    const paint = (pass) => {
      lobes.forEach((lb) => {
        const n = pass === 0 ? 34 : pass === 1 ? 46 : 16;
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2, d = lb.rad * Math.sqrt(r()) * (pass === 1 ? 1 : 0.85);
          const x = lb.x + Math.cos(a) * d, y = lb.y + Math.sin(a) * d;
          const len = (pass === 2 ? 0.17 : 0.27) * size * (0.7 + 0.5 * r()) * 0.62, wid = len * lerp(0.34, 0.5, r());
          const rim = clamp(d / lb.rad, 0, 1);
          const lit = clamp(0.46 + (-Math.cos(a) * 0.5 - Math.sin(a) * 0.5) * 0.42 * rim + (r() - 0.5) * 0.3 + (pass === 2 ? 0.25 : 0), 0, 1);
          const v = lerp(pass === 0 ? 0.52 : 0.64, pass === 2 ? 1.0 : 0.94, lit);
          leaf(x + 1.4, y + 2, len, wid, a + (r() - 0.5) * 1.6, tone(v * 0.6, 0));
          leaf(x, y, len, wid, a + (r() - 0.5) * 1.6, tone(v, lit));
        }
      });
    };
    paint(0); paint(1); paint(2);
  }
  function paintBark(g, ox, oy, w, h, seed, birch) {
    const r = mulberry(seed);
    g.fillStyle = birch ? 'rgb(236,234,226)' : 'rgb(196,190,182)'; g.fillRect(ox, oy, w, h);
    if (birch) {
      for (let i = 0; i < 70; i++) { const x = ox + r() * (w - 20), y = oy + r() * h, ww = 8 + r() * 22; g.fillStyle = `rgba(36,34,32,${0.55 + r() * 0.4})`; g.fillRect(x, y, ww, 2 + r() * 4); }
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(200,196,184,0.5)'; g.fillRect(ox + r() * w, oy + r() * h, 3 + r() * 6, 10 + r() * 26); }
    } else {
      for (let i = 0; i < 90; i++) { const x = ox + r() * w, y = oy + r() * h, l = 30 + r() * 90; g.fillStyle = `rgba(${40 + r() * 30 | 0},${34 + r() * 26 | 0},${28 + r() * 20 | 0},${0.35 + r() * 0.35})`; g.fillRect(x, y, 2 + r() * 3, l); }
      for (let i = 0; i < 50; i++) { g.fillStyle = 'rgba(255,248,235,0.28)'; g.fillRect(ox + r() * w, oy + r() * h, 2 + r() * 2, 14 + r() * 50); }
    }
  }
  let atlasTex = null;
  function atlas() {
    if (atlasTex) return atlasTex;
    const c = document.createElement('canvas'); c.width = c.height = ATLAS;
    const g = c.getContext('2d');
    g.clearRect(0, 0, ATLAS, ATLAS);
    paintCluster(g, TILES.c0[0], TILES.c0[1], 256, 11); paintCluster(g, TILES.c1[0], TILES.c1[1], 256, 23); paintCluster(g, TILES.c2[0], TILES.c2[1], 256, 37);
    paintBark(g, TILES.bark[0], TILES.bark[1], TILES.bark[2], TILES.bark[3], 5, false);
    paintBark(g, TILES.birch[0], TILES.birch[1], TILES.birch[2], TILES.birch[3], 9, true);
    g.fillStyle = '#fff'; g.fillRect(WHITE[0] - 5, WHITE[1] - 5, 10, 10);       // a pure white texel block: geometry that only wants its vertex colours (grass tufts)
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.NoColorSpace;          // painted values multiply the vertex colours directly
    tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.anisotropy = 2;
    tex.generateMipmaps = true; tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter;
    atlasTex = tex;
    return tex;
  }
  /* uv of a point inside a tile: (a, b) in 0..1 of the tile rectangle */
  const tileUv = (tile, a, b, inset) => { const t = TILES[tile], ins = inset === undefined ? 1.5 : inset; return [(t[0] + ins + a * (t[2] - 2 * ins)) / ATLAS, 1 - (t[1] + ins + b * (t[3] - 2 * ins)) / ATLAS]; };
  /* opaque core of cluster tile 0 (every blob maps into it) */
  const coreUv = (a, b) => tileUv('c0', 0.4 + 0.2 * clamp(a, 0, 1), 0.4 + 0.2 * clamp(b, 0, 1), 0);

  /* ---------------------------------------------------------------- geometry builder */
  class GB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
    get count() { return this.p.length / 3; }
    vert(x, y, z, nx, ny, nz, uv, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(uv[0], uv[1]); this.c.push(col.r, col.g, col.b); return this.count - 1; }
    tri(a, b, c) { this.i.push(a, b, c); }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.count > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  const col3 = (r, g, b) => ({ r, g, b });
  const C = (hex) => new T.Color(hex);
  const mix = (a, b, t) => col3(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
  const shadeC = (c, k) => col3(c.r * k, c.g * k, c.b * k);

  /* welded icosphere (shared vertices, so the normals can be smooth) */
  const icoCache = new Map();
  function icoSphere(detail) {
    if (icoCache.has(detail)) return icoCache.get(detail);
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm3(v[0], v[1], v[2]));
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < detail; d++) {
      const mid = new Map(), nf = [];
      const m = (a, b) => { const k = a < b ? a * 100000 + b : b * 100000 + a; let id = mid.get(k); if (id === undefined) { const p = norm3(V[a][0] + V[b][0], V[a][1] + V[b][1], V[a][2] + V[b][2]); id = V.length; V = V.concat([p]); mid.set(k, id); } return id; };
      F.forEach(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
      F = nf;
    }
    const out = { V, F };
    icoCache.set(detail, out);
    return out;
  }

  /* a lumpy crown blob with smooth normals.  o: cx cy cz rx ry rz detail amp freq seed, color(p, n) -> {r,g,b}, uv(d) -> [u, v] */
  function addBlob(gb, o) {
    const { V, F } = icoSphere(o.detail);
    const P = V.map((d) => {
      const k = 1 + o.amp * (vn3(d[0] * o.freq + o.seed, d[1] * o.freq + o.seed * 1.7, d[2] * o.freq + o.seed * 0.6) - 0.5) * 2;
      return [o.cx + d[0] * o.rx * k, o.cy + d[1] * o.ry * k, o.cz + d[2] * o.rz * k];
    });
    const N = V.map(() => [0, 0, 0]);
    F.forEach(([a, b, c]) => {
      const ux = P[b][0] - P[a][0], uy = P[b][1] - P[a][1], uz = P[b][2] - P[a][2], vx = P[c][0] - P[a][0], vy = P[c][1] - P[a][1], vz = P[c][2] - P[a][2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [a, b, c].forEach((i) => { N[i][0] += nx; N[i][1] += ny; N[i][2] += nz; });
    });
    const base = gb.count;
    V.forEach((d, i) => {
      const fn = norm3(N[i][0], N[i][1], N[i][2]), sn = norm3(d[0] / o.rx, d[1] / o.ry, d[2] / o.rz);
      const lightLift = o.lift === undefined ? 0.18 : o.lift;           // tilts the normals up a little: crowns read lit from above
      const n = norm3(sn[0] * 0.62 + fn[0] * 0.38, sn[1] * 0.62 + fn[1] * 0.38 + lightLift, sn[2] * 0.62 + fn[2] * 0.38);
      gb.vert(P[i][0], P[i][1], P[i][2], n[0], n[1], n[2], o.uv(d), o.color({ x: P[i][0], y: P[i][1], z: P[i][2] }, { x: n[0], y: n[1], z: n[2] }));
    });
    F.forEach(([a, b, c]) => gb.tri(base + a, base + b, base + c));
  }

  const ellipsoidArea = (a, b, c) => 4 * Math.PI * Math.pow((Math.pow(a * b, 1.6) + Math.pow(a * c, 1.6) + Math.pow(b * c, 1.6)) / 3, 1 / 1.6);
  /* leaf-cluster cards on an ellipsoid surface.  o: cx cy cz rx ry rz count seed w0 w1 minY off, lightC [x, y, z], color(p, n) */
  function addCards(gb, o) {
    const r = mulberry(o.seed * 7 + 3);
    for (let i = 0; i < o.count; i++) {
      const yy = lerp(o.minY === undefined ? -0.3 : o.minY, 1, (i + 0.5) / o.count) + (r() - 0.5) * 0.12, ph = i * 2.39996 + r() * 0.8;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy)), d = [rr * Math.cos(ph), clamp(yy, -1, 1), rr * Math.sin(ph)];
      const off = o.off === undefined ? 1 : o.off, rad = lerp(0.92, 1.16, r()) * off;
      const p = [o.cx + d[0] * o.rx * rad, o.cy + d[1] * o.ry * rad, o.cz + d[2] * o.rz * rad];
      const nn = norm3(d[0] / o.rx, d[1] / o.ry, d[2] / o.rz);
      const t1 = Math.abs(nn[1]) > 0.94 ? [1, 0, 0] : norm3(-nn[2], 0, nn[0]);
      const t2 = [nn[1] * t1[2] - nn[2] * t1[1], nn[2] * t1[0] - nn[0] * t1[2], nn[0] * t1[1] - nn[1] * t1[0]];
      const ang = r() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const a1 = [t1[0] * ca + t2[0] * sa, t1[1] * ca + t2[1] * sa, t1[2] * ca + t2[2] * sa], a2 = [-t1[0] * sa + t2[0] * ca, -t1[1] * sa + t2[1] * ca, -t1[2] * sa + t2[2] * ca];
      const w = lerp(o.w0, o.w1, r()), hw = w / 2, lean = w * 0.3;
      const ln = norm3(nn[0] * 0.8 + (p[0] - o.lightC[0]) * 0.02, nn[1] * 0.8 + 0.34, nn[2] * 0.8 + (p[2] - o.lightC[2]) * 0.02);
      const tile = 'c' + Math.floor(r() * 3);
      const colour = o.color({ x: p[0], y: p[1], z: p[2] }, { x: ln[0], y: ln[1], z: ln[2] });
      const k = 0.9 + r() * 0.24, hue = (r() - 0.5) * 0.1, cc = col3(colour.r * k * (1 + hue), colour.g * k, colour.b * k * (1 - hue));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const ids = corners.map(([sx, sy]) => {
        const out = sy > 0 ? lean : 0;                              // the outer edge leans away from the crown
        const x = p[0] + a1[0] * sx * hw + a2[0] * sy * hw + nn[0] * out, y = p[1] + a1[1] * sx * hw + a2[1] * sy * hw + nn[1] * out, z = p[2] + a1[2] * sx * hw + a2[2] * sy * hw + nn[2] * out;
        return gb.vert(x, y, z, ln[0], ln[1], ln[2], tileUv(tile, (sx + 1) / 2, (sy + 1) / 2, 1), cc);
      });
      gb.tri(ids[0], ids[1], ids[2]); gb.tri(ids[0], ids[2], ids[3]);
    }
  }

  /* tapered tube through centre points with radii; smooth radial normals.  tile = 'bark' | 'birch' */
  function addTube(gb, pts, radii, segs, color, tile) {
    const base = gb.count, rings = pts.length;
    for (let k = 0; k < rings; k++) {
      const p = pts[k], q = pts[Math.min(rings - 1, k + 1)], o = pts[Math.max(0, k - 1)];
      const ax = norm3(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
      let t1 = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : norm3(-ax[2], 0, ax[0]);
      const t2 = [ax[1] * t1[2] - ax[2] * t1[1], ax[2] * t1[0] - ax[0] * t1[2], ax[0] * t1[1] - ax[1] * t1[0]];
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = t1[0] * ca + t2[0] * sa, ny = t1[1] * ca + t2[1] * sa, nz = t1[2] * ca + t2[2] * sa;
        const c = color(p[1], k / (rings - 1));
        gb.vert(p[0] + nx * radii[k], p[1] + ny * radii[k], p[2] + nz * radii[k], nx, ny * 0.4 + 0.2, nz, tileUv(tile, s / segs, k / (rings - 1), 2), c);
      }
    }
    for (let k = 0; k < rings - 1; k++) for (let s = 0; s < segs; s++) {
      const a = base + k * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      gb.tri(a, c, b); gb.tri(b, c, d);
    }
  }

  /* ---------------------------------------------------------------- species */
  const LEAF = {
    oak: [C('#2f5a28'), C('#5f9238')], beech: [C('#3d6b2d'), C('#82ad42')], birch: [C('#4f8a35'), C('#a8cc50')],
    spruce: [C('#1b3d2c'), C('#33704a')], poplar: [C('#3a6a2b'), C('#7cab3c')], bush: [C('#3a6a2d'), C('#70a040')]
  };
  const BARK = { oak: '#7a634e', beech: '#8a7c70', birch: '#ffffff', spruce: '#6f5a46', poplar: '#7d7060', bush: '#6f5a46' };

  /* crown colour: lo -> hi with height in the crown and the up-facing share of the normal, painted mottling from noise, dark under the canopy */
  function crownColor(sp, y0, y1) {
    const [lo, hi] = LEAF[sp];
    return (p, n) => {
      const t = clamp((p.y - y0) / (y1 - y0), 0, 1), up = n.y * 0.5 + 0.5;
      const m = vn3(p.x * 0.9 + 3, p.y * 0.9, p.z * 0.9 - 2) * 0.28 + 0.86;
      const c = mix(lo, hi, clamp(t * 0.62 + up * 0.38, 0, 1));
      const ao = lerp(0.74, 1, smooth(0, 0.5, t));
      return shadeC(c, m * ao * 1.12);
    };
  }
  const blobCol = (sp, y0, y1) => crownColor(sp, y0, y1);

  function trunkColor(sp) {
    const c = C(BARK[sp]);
    return (y, t) => shadeC({ r: c.r, g: c.g, b: c.b }, lerp(0.78, 1.05, t));
  }

  function broadSpecies(sp, def) {
    const out = [], col = blobCol(sp, def.y0, def.y1);
    const uvOf = (d) => coreUv(d[0] * 0.5 + 0.5, d[2] * 0.5 + 0.5);
    const mk = (lod) => {
      const gb = new GB();
      const tile = sp === 'birch' ? 'birch' : 'bark', tc = trunkColor(sp), tr = def.trunk;
      if (lod === 0) {
        addTube(gb, tr.pts, tr.radii, 7, tc, tile, 1.4);
        (def.limbs || []).forEach((l) => addTube(gb, l.pts, l.radii, 5, tc, tile, 0.6));
      } else if (lod === 1) addTube(gb, [tr.pts[0], tr.pts[tr.pts.length - 1]], [tr.radii[0], tr.radii[tr.radii.length - 1] * 0.9], 5, tc, tile, 1);
      else addTube(gb, [tr.pts[0], tr.pts[tr.pts.length - 1]], [tr.radii[0], tr.radii[tr.radii.length - 1] * 0.9], 3, tc, tile, 1);
      const blobs = lod === 0 ? def.blobs : lod === 1 ? def.blobs.slice(0, def.mid) : def.blobs.slice(0, 1);
      blobs.forEach((b, i) => {
        const detail = lod === 2 ? 0 : lod === 1 ? (i === 0 ? 1 : 0) : 1;
        const sc = lod === 2 ? def.farScale : 1;
        addBlob(gb, { cx: b[0], cy: lod === 2 ? def.cy2 : b[1], cz: b[2], rx: b[3] * sc, ry: b[4] * sc, rz: b[5] * sc, detail, amp: lod === 0 ? 0.2 : 0.12, freq: 2.0, seed: i * 3.1 + def.seed, color: col, uv: uvOf, lift: 0.26 });
      });
      if (lod === 0) def.blobs.forEach((b, i) => addCards(gb, { cx: b[0], cy: b[1], cz: b[2], rx: b[3], ry: b[4], rz: b[5], count: Math.max(4, Math.round(def.density * ellipsoidArea(b[3], b[4], b[5]) * 0.9)), seed: i + def.seed, w0: def.card[0], w1: def.card[1], minY: -0.2, off: 0.97, lightC: def.crown, color: col }));
      if (lod === 1) { const b = def.blobs[0]; addCards(gb, { cx: b[0], cy: b[1], cz: b[2], rx: b[3], ry: b[4], rz: b[5], count: Math.max(5, Math.round(def.density * 0.42 * ellipsoidArea(b[3], b[4], b[5]))), seed: def.seed + 40, w0: def.card[0] * 1.5, w1: def.card[1] * 1.7, minY: 0, off: 0.98, lightC: def.crown, color: col }); }
      return gb.geometry();
    };
    for (let lod = 0; lod < 3; lod++) out.push(mk(lod));
    return out;
  }

  function spruceSpecies() {
    const sp = 'spruce', [lo, hi] = LEAF.spruce, out = [];
    const mk = (lod) => {
      const gb = new GB();
      addTube(gb, [[0, 0, 0], [0, 1.9, 0]], [0.3, 0.17], lod === 2 ? 3 : 5, trunkColor(sp), 'bark', 1);
      const tiers = lod === 0 ? 7 : lod === 1 ? 5 : 2;
      const M = lod === 0 ? 10 : lod === 1 ? 7 : 6;
      for (let k = 0; k < tiers; k++) {
        const f = lod === 2 ? k * 2.4 : lod === 1 ? k * 1.4 : k;
        const y = 1.15 + f * 1.0, r = (2.25 - f * 0.28) * (lod === 2 ? 1.05 : 1), h = (2.5 - f * 0.1) * (lod === 2 ? 1.5 : lod === 1 ? 1.2 : 1);
        const shade = lerp(0.78, 1.12, k / Math.max(1, tiers - 1)), jit = k * 0.7;
        const cl = (v, t) => shadeC(mix(lo, hi, clamp(v, 0, 1)), shade * (0.9 + 0.3 * t) * 1.1);
        const uv = (a, b) => coreUv(a, b);
        const ring0 = [], ring1 = [];
        for (let s = 0; s < M; s++) {
          const a = (s / M) * Math.PI * 2 + jit, rv = r * (1 + (s % 2 ? -0.1 : 0.06) * (lod === 0 ? 1 : 0.5)) * (0.94 + 0.12 * hash2(k * 13 + s, 7));
          const ca = Math.cos(a), sa = Math.sin(a);
          ring0.push(gb.vert(ca * rv, y - (s % 2 ? 0.2 : 0) * (lod === 0 ? 1 : 0), sa * rv, ca * 0.72, 0.5, sa * 0.72, uv(ca * 0.5 + 0.5, sa * 0.5 + 0.5), cl(0.2 + 0.1 * (s % 2), 0.1)));
        }
        const apex = gb.vert(0, y + h, 0, 0, 1, 0, uv(0.5, 0.5), cl(0.9, 1));
        if (lod === 0) {
          for (let s = 0; s < M; s++) {
            const a = ((s + 0.5) / M) * Math.PI * 2 + jit, rv = r * 0.56, ca = Math.cos(a), sa = Math.sin(a);
            ring1.push(gb.vert(ca * rv, y + h * 0.46, sa * rv, ca * 0.55, 0.8, sa * 0.55, uv(ca * 0.3 + 0.5, sa * 0.3 + 0.5), cl(0.52, 0.5)));
          }
          for (let s = 0; s < M; s++) {
            const s1 = (s + 1) % M;
            gb.tri(ring0[s], ring1[s], ring0[s1]); gb.tri(ring0[s1], ring1[s], ring1[s1]);
            gb.tri(ring1[s], apex, ring1[s1]);
          }
        } else for (let s = 0; s < M; s++) gb.tri(ring0[s], apex, ring0[(s + 1) % M]);
      }
      return gb.geometry();
    };
    for (let lod = 0; lod < 3; lod++) out.push(mk(lod));
    return out;
  }

  /* grass tuft of the verge (cab-view texture): 3 blades near, 2 crossed quads mid, nothing far (meta.range) */
  function tuftSpecies() {
    const out = [], lo = C('#5d8a34'), hi = C('#b6c760');
    const mk = (lod) => {
      const gb = new GB(), uv = [WHITE[0] / ATLAS, 1 - WHITE[1] / ATLAS], blades = lod === 0 ? [[0.12, 0, 0], [0.4, 2.1, 0.1], [-0.38, 4.2, -0.1]] : [[0.2, 0.4, 0], [-0.2, 2.2, 0]];
      blades.forEach(([tilt, rot, off], i) => {
        const h = 0.55 + i * 0.06, w = lod === 0 ? 0.09 : 0.12, sides = lod === 0 ? 3 : 2, cr = Math.cos(rot), sr = Math.sin(rot);
        const rotY = (x, y, z) => [x * cr + z * sr, y, -x * sr + z * cr];
        const ring = [];
        for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2, q = rotY(off * 0.2 + Math.cos(a) * w, 0, Math.sin(a) * w); ring.push(gb.vert(q[0], q[1], q[2], 0, 1, 0, uv, lo)); }
        const t = rotY(off * 0.2 - Math.sin(tilt) * h, Math.cos(tilt) * h, 0), tip = gb.vert(t[0], t[1], t[2], 0, 1, 0, uv, hi);
        for (let k = 0; k < sides; k++) gb.tri(ring[k], tip, ring[(k + 1) % sides]);
      });
      return gb.geometry();
    };
    out.push(mk(0), mk(1), mk(1));
    return out;
  }

  const DEFS = {
    oak: { seed: 1, y0: 2.8, y1: 7.6, crown: [0, 4.9, 0], cy2: 4.8, farScale: 1.1, mid: 3, card: [1.7, 2.5], density: 0.5,
      trunk: { pts: [[0, 0, 0], [0, 0.5, 0], [0, 1.6, 0.05], [0, 3.0, 0.1]], radii: [0.52, 0.36, 0.28, 0.24] },
      limbs: [{ pts: [[0, 2.7, 0.08], [0.5, 3.5, 0.25], [1.1, 4.2, 0.4]], radii: [0.17, 0.12, 0.08] }, { pts: [[0, 2.8, 0.1], [-0.5, 3.6, -0.2], [-1.0, 4.3, -0.5]], radii: [0.17, 0.12, 0.08] }, { pts: [[0, 2.9, 0.1], [0.1, 3.8, -0.4], [0.2, 4.6, -0.9]], radii: [0.15, 0.1, 0.07] }],
      blobs: [[0, 4.9, 0, 2.7, 2.1, 2.6, 13], [1.7, 4.0, 0.7, 1.9, 1.55, 1.9, 8], [-1.6, 4.2, -0.6, 2.0, 1.65, 2.0, 8], [0.3, 6.2, 0.1, 1.9, 1.4, 1.8, 7], [-0.4, 3.7, 1.7, 1.5, 1.2, 1.5, 5]] },
    beech: { seed: 5, y0: 2.8, y1: 8.6, crown: [0, 5.4, 0], cy2: 5.4, farScale: 1.1, mid: 3, card: [1.5, 2.2], density: 0.5,
      trunk: { pts: [[0, 0, 0], [0, 0.5, 0], [0, 1.9, 0], [0, 3.7, 0]], radii: [0.46, 0.32, 0.25, 0.2] },
      limbs: [{ pts: [[0, 3.2, 0], [0.4, 4.0, 0.15], [0.9, 4.7, 0.3]], radii: [0.14, 0.1, 0.07] }, { pts: [[0, 3.3, 0], [-0.4, 4.1, -0.15], [-0.9, 4.8, -0.3]], radii: [0.14, 0.1, 0.07] }],
      blobs: [[0, 5.6, 0, 2.1, 3.1, 2.1, 14], [1.2, 4.6, 0.4, 1.45, 1.75, 1.45, 7], [-1.2, 4.9, -0.3, 1.55, 1.85, 1.55, 7]] },
    birch: { seed: 9, y0: 3.2, y1: 7.8, crown: [0, 5.4, 0], cy2: 5.2, farScale: 1.15, mid: 3, card: [1.2, 1.8], density: 0.55,
      trunk: { pts: [[0, 0, 0], [0.05, 1.5, 0], [0, 3.0, 0.05], [-0.05, 4.4, 0]], radii: [0.2, 0.15, 0.13, 0.1] },
      limbs: [{ pts: [[-0.05, 3.8, 0], [0.3, 4.5, 0.1], [0.6, 5.0, 0.2]], radii: [0.08, 0.06, 0.04] }],
      blobs: [[0, 5.4, 0, 1.55, 2.25, 1.55, 11], [0.6, 4.2, 0.3, 1.15, 1.35, 1.15, 6], [-0.5, 6.4, -0.2, 1.0, 1.2, 1.0, 5]] },
    poplar: { seed: 13, y0: 2.6, y1: 12.6, crown: [0, 7.5, 0], cy2: 7.5, farScale: 1.0, mid: 3, card: [1.2, 1.9], density: 0.5,
      trunk: { pts: [[0, 0, 0], [0, 1.4, 0], [0, 3, 0]], radii: [0.34, 0.26, 0.2] },
      blobs: [[0, 6.2, 0, 1.15, 3.1, 1.15, 12], [0.08, 8.9, 0, 1.1, 2.6, 1.1, 9], [0, 10.9, 0, 0.8, 2.0, 0.8, 5]] },
    bush: { seed: 17, y0: 0, y1: 1.4, crown: [0, 0.6, 0], cy2: 0.55, farScale: 1.2, mid: 2, card: [0.6, 0.95], density: 1.3,
      trunk: { pts: [[0, 0, 0], [0, 0.25, 0]], radii: [0.05, 0.04] },
      blobs: [[0, 0.62, 0, 1.0, 0.78, 1.0, 12], [0.7, 0.42, 0.2, 0.7, 0.56, 0.7, 6]] }
  };
  /* approximate height / crown radius of every species at scale 1 (the station patch maps LiDAR heights onto them) */
  const META = {
    oak: { h: 8, r: 3.4 }, beech: { h: 8.7, r: 2.4 }, birch: { h: 7.7, r: 1.9 }, spruce: { h: 9, r: 2.2 }, poplar: { h: 12.6, r: 1.3 }, bush: { h: 1.4, r: 1.3 },
    tuft: { h: 0.6, r: 0.4, range: [30, 80], noShadow: true },   // range: lod0 / lod1 distance at high quality (scaled with the quality), nothing beyond
  };

  function create(opts) {
    const o = opts || {};
    const geos = {};
    SPECIES.forEach((sp) => { geos[sp] = sp === 'spruce' ? spruceSpecies() : sp === 'tuft' ? tuftSpecies() : broadSpecies(sp, DEFS[sp]); });
    const material = new T.MeshLambertMaterial({ map: atlas(), vertexColors: true, side: T.DoubleSide, alphaTest: 0.42 });
    if (o.antialias) material.alphaToCoverage = true;
    const decorated = o.decorate ? o.decorate(material) || material : material;
    /* leaf cards are seen from both sides: light them the same from behind (the default flips the normal on back faces, which turned the tops of crowns black) */
    const prev = decorated.onBeforeCompile;
    decorated.onBeforeCompile = (sh, renderer) => {
      if (prev) prev.call(decorated, sh, renderer);
      sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
    decorated.customProgramCacheKey = () => 'ts-tree-v1';
    return {
      geos, meta: META, material: decorated, species: SPECIES.slice(), hash: (x, y) => hash2(x * 131.7, y * 97.3),
      triangles: (sp, lod) => geos[sp][lod].index.count / 3,
      dispose() { SPECIES.forEach((sp) => geos[sp].forEach((g) => g.dispose())); decorated.dispose(); },
    };
  }

  TS.treeKit = Object.freeze({ create, SPECIES, META, hash2 });
})(window.TS);
