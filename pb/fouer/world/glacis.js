/* Schueberfouer Tycoon, W2: the real Glacis ground from the baked bundle.
 *
 * Reuses the Luxtram modules unchanged (classic scripts, TS.luxGround / TS.luxFacades): the painted ground (splat shader + draped roads,
 * kerbs, bay lines, zebras) and the LOD2 facade renderer with the typology atlas (lit windows at night).  What is new here is the host:
 *   - tiles come from the bundle (h / g / bf / t sections), not from per-tile fetches;
 *   - tiles are drawn as 2 x 2 tile CHUNKS (256 m): one terrain mesh (one class-map mosaic at 1 m/px), one merged ground-decor mesh,
 *     one facade mesh, one instanced tree mesh per chunk, so the empty world costs about 4 draw calls per visible chunk;
 *   - the far ring (640 m tiles) is ONE terrain mesh (40 m nodes, one class mosaic) + ONE mesh of extruded far buildings.
 * Everything here is in Luxtram local metres (x east, z south) with y = LiDAR height - oy; frame.js rotates the root into the game frame. */
import { decodeHeights } from './dem.js';
import { getMaterials } from '../models/materials.js';
import { makePlaneTreeGeometries, createTreeLod } from './trees.js';

const TILE = 128;
const CHUNK = 2;                    // tiles per chunk edge
const SKIRT = 8;                    // m

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (x, y) => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function pointInRing(ring, x, z) {
  let ins = false;
  for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
    const xi = ring[k][0]; const zi = ring[k][1]; const xj = ring[j][0]; const zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}

/** concatenates same-schema BufferGeometries (indexed or not) into one */
function mergeGeos(T, geos) {
  if (!geos.length) return null;
  const names = Object.keys(geos[0].attributes);
  const indexed = !!geos[0].index;
  let nv = 0; let ni = 0;
  geos.forEach((g) => { nv += g.attributes.position.count; if (indexed) ni += g.index.count; });
  const out = new T.BufferGeometry();
  names.forEach((nm) => {
    const a0 = geos[0].attributes[nm]; const size = a0.itemSize;
    const arr = new Float32Array(nv * size);
    let o = 0;
    geos.forEach((g) => { const a = g.attributes[nm]; arr.set(a.array, o); o += a.array.length; });
    out.setAttribute(nm, new T.BufferAttribute(arr, size));
  });
  if (indexed) {
    const big = nv > 65535;
    const idx = big ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0; let base = 0;
    geos.forEach((g) => { const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[o + k] = ia[k] + base; o += ia.length; base += g.attributes.position.count; });
    out.setIndex(new T.BufferAttribute(idx, 1));
  }
  out.computeBoundingSphere();
  return out;
}

export async function createGlacis({ T, TS, bundle, quality = 'medium', frame, onProgress = () => {}, nightRef }) {
  const H = bundle.header;
  const oy = H.oy;
  const Q = {
    high: { stride: 2, farStride: 2, trees: 1, shadows: false },
    medium: { stride: 2, farStride: 2, trees: 0.6, shadows: false },
    low: { stride: 4, farStride: 4, trees: 0.45, shadows: false },
  }[quality] || { stride: 2, farStride: 2, trees: 0.8 };
  const root = new T.Group();
  root.name = 'fouer-world';
  root.rotation.y = frame.rotY;
  root.position.set(frame.rootPos[0], 0, frame.rootPos[1]);

  /* ---------------------------------------------------------------- tiles from the bundle */
  const tiles = new Map();
  const fieldRings = [H.polys.glacis, H.polys.bus];
  const footprints = H.footprints.map((f) => ({ key: f.key, role: f.role, ring: f.ring, box: ringBox(f.ring) }));
  function ringBox(r) { let a = 1e9; let b = 1e9; let c = -1e9; let d = -1e9; r.forEach((p) => { a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[1]); }); return [a, b, c, d]; }

  const ground = TS.luxGround.create({
    T, quality, oy,
    surfY: (t, x, z) => { const y = meshY(t, x, z); return y === y ? y : gy(x, z); },
    normalAt: (t, x, z) => normalAtTile(t, x, z),
    tileOf: (x, z) => tiles.get(Math.floor(x / TILE) + '_' + Math.floor(z / TILE)),
    groundAt: (x, z) => gy(x, z),
    slotClear: null,
  });

  function strideOf(t) {
    const dem = t.dem.n;
    const maxS = (dem - 1) / 4;
    let s = Q.stride;
    if (t.nearD > 55) s *= 2;
    if (t.step >= 4) s = Math.max(1, Math.floor(s / 2));
    return Math.min(s, maxS);
  }
  function meshY(t, x, z) {
    if (!t || !t.dem) return NaN;
    const n = t.dem.n; const stride = t.stride; const m = Math.floor((n - 1) / stride) + 1; const step = t.step * stride;
    const u = (x - t.x0) / step; const v = (z - t.z0) / step;
    const c = clamp(Math.floor(u), 0, m - 2); const r = clamp(Math.floor(v), 0, m - 2);
    const fu = clamp(u - c, 0, 1); const fv = clamp(v - r, 0, 1);
    const h = t.dem.h; const hh = (rr, cc) => h[rr * stride * n + cc * stride] - oy;
    const ya = hh(r, c); const yb = hh(r, c + 1); const yc = hh(r + 1, c); const yd = hh(r + 1, c + 1);
    return fu + fv <= 1 ? ya + (yb - ya) * fu + (yc - ya) * fv : yd + (yc - yd) * (1 - fu) + (yb - yd) * (1 - fv);
  }
  function normalAtTile(t, x, z) {
    if (!t || !t.dem) return [0, 1, 0];
    const e = 1.5;
    const dx = (gy(x + e, z) - gy(x - e, z)) / (2 * e); const dz = (gy(x, z + e) - gy(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }
  /** LiDAR ground (bilinear on the full-resolution nodes); falls back to the far ring, then 0 */
  function gy(x, z) {
    const t = tiles.get(Math.floor(x / TILE) + '_' + Math.floor(z / TILE));
    if (t && t.dem) {
      const n = t.dem.n; const step = t.step; const u = (x - t.x0) / step; const v = (z - t.z0) / step;
      const c = clamp(Math.floor(u), 0, n - 2); const r = clamp(Math.floor(v), 0, n - 2); const fu = clamp(u - c, 0, 1); const fv = clamp(v - r, 0, 1);
      const h = t.dem.h;
      return ((h[r * n + c] * (1 - fu) + h[r * n + c + 1] * fu) * (1 - fv) + (h[(r + 1) * n + c] * (1 - fu) + h[(r + 1) * n + c + 1] * fu) * fv) - oy;
    }
    return farY(x, z);
  }
  let farDem = null;
  function farY(x, z) {
    if (!farDem) return 0;
    const FT = H.farTile; const i = Math.floor(x / FT); const j = Math.floor(z / FT);
    const f = farDem.get(i + '_' + j);
    if (!f) return 0;
    const n = f.n; const step = FT / (n - 1); const u = (x - i * FT) / step; const v = (z - j * FT) / step;
    const c = clamp(Math.floor(u), 0, n - 2); const r = clamp(Math.floor(v), 0, n - 2); const fu = clamp(u - c, 0, 1); const fv = clamp(v - r, 0, 1);
    const h = f.h;
    return ((h[r * n + c] * (1 - fu) + h[r * n + c + 1] * fu) * (1 - fv) + (h[(r + 1) * n + c] * (1 - fu) + h[(r + 1) * n + c + 1] * fu) * fv) - oy - 1.5;
  }

  /* ---------------------------------------------------------------- facades (Luxtram renderer, shimmed host) */
  const replacedBy = (cx, cz, pts) => {
    const hull = pts && pts.length >= 3 ? pts : null;
    const hb = hull ? ringBox(hull) : [cx, cz, cx, cz];
    for (const fp of footprints) {
      const b = fp.box;
      if (hb[2] < b[0] - 1 || hb[0] > b[2] + 1 || hb[3] < b[1] - 1 || hb[1] > b[3] + 1) continue;
      if (pointInRing(fp.ring, cx, cz)) return true;
      if (hull) {
        let inside = 0;
        for (const p of hull) if (pointInRing(fp.ring, p[0], p[1])) inside++;
        if (inside * 2 >= hull.length) return true;
        for (const p of fp.ring) if (pointInRing(hull, p[0], p[1])) return true;
      }
    }
    return false;
  };
  const fx = TS.luxFacades.create({
    T, ox: 0, oz: 0, oy, quality, castShadow: false, STOP_CLEAR_H: 0,
    gy, nearest: () => ({ d: 99, s: 0 }), replacedBy, logBuilding: null, atStop: () => false, sceneRing: (f) => f, localXZ: (x, z) => [x, z],
  });

  onProgress(0.05, 'tiles');
  const keys = Object.keys(H.tiles);
  for (const key of keys) {
    const e = H.tiles[key]; const [i, j] = key.split('_').map(Number);
    const dem = decodeHeights(bundle.view(e.h));
    const t = { key, info: { i, j, s: 0 }, step: e.step, dem, ground: null, bld: null, trees: null, x0: i * TILE, z0: j * TILE, coarse: e.step >= 4, stride: 1, disposed: false };
    // distance from the tile centre to the field polygons (decides the terrain stride)
    const cx = t.x0 + TILE / 2; const cz = t.z0 + TILE / 2;
    let d = 1e9;
    fieldRings.forEach((ring) => { for (let k = 0; k < ring.length; k++) { const a = ring[k]; const b = ring[(k + 1) % ring.length]; const dx = b[0] - a[0]; const dz = b[1] - a[1]; const tt = clamp(((cx - a[0]) * dx + (cz - a[1]) * dz) / (dx * dx + dz * dz + 1e-9), 0, 1); d = Math.min(d, Math.hypot(cx - a[0] - dx * tt, cz - a[1] - dz * tt)); } });
    t.nearD = d;
    t.stride = strideOf(t);
    tiles.set(key, t);
    e._t = t;
  }
  // ground tiles (class map PNG decode is async)
  await Promise.all(keys.map(async (key) => {
    const e = H.tiles[key]; const t = e._t;
    t.ground = await ground.fetchTile(bundle.copy(e.g));
    if (e.bf) { try { t.bld = fx.parseTile(bundle.copy(e.bf)); } catch (err) { console.warn('[fouer] facades parse', key, err); t.bld = []; } } else t.bld = [];
    if (e.t) t.trees = bundle.copy(e.t);
  }));
  (H.osmTrees || []).forEach(([x, z]) => { const t = tiles.get(Math.floor(x / TILE) + '_' + Math.floor(z / TILE)); if (t) (t.osmTrees = t.osmTrees || []).push([x, z]); });
  onProgress(0.2, 'ground');

  /* ---------------------------------------------------------------- chunks */
  const chunks = new Map();
  tiles.forEach((t) => {
    const ci = Math.floor(t.info.i / CHUNK); const cj = Math.floor(t.info.j / CHUNK);
    const k = ci + '_' + cj;
    if (!chunks.has(k)) chunks.set(k, { key: k, ci, cj, tiles: [], group: new T.Group(), x0: ci * CHUNK * TILE, z0: cj * CHUNK * TILE });
    chunks.get(k).tiles.push(t);
  });
  const stats = { tris: 0 };

  /** class mosaic of a chunk at 1 m/px (2 x 2 mode filter of the 0.5 m maps; absent tiles = paving) */
  function chunkCtrl(ch) {
    const N = ground.N;                                // 256 per tile
    const out = new Uint8Array(N * N).fill(1);          // chunk = CHUNK*TILE metres at N px -> 1 m per px
    const sub = N / CHUNK;                              // tile px -> chunk px: each tile occupies 128 px
    ch.tiles.forEach((t) => {
      if (!t.ground) return;
      const ox_ = (t.info.i - ch.ci * CHUNK) * sub; const oz_ = (t.info.j - ch.cj * CHUNK) * sub;
      const cls = t.ground.cls;
      for (let y = 0; y < sub; y++) {
        for (let x = 0; x < sub; x++) {
          const a = cls[(2 * y) * N + 2 * x]; const b = cls[(2 * y) * N + 2 * x + 1]; const c = cls[(2 * y + 1) * N + 2 * x]; const d = cls[(2 * y + 1) * N + 2 * x + 1];
          let v = a;
          if (b === c || b === d) v = b; else if (c === d) v = c;      // majority of 4 (ties: the first)
          out[(oz_ + y) * N + ox_ + x] = v;
        }
      }
    });
    return ground.weightTextures(out, N);
  }

  function terrainGeometry(ch) {
    const P = []; const Nn = []; const Cc = []; const I = [];
    let base = 0;
    ch.tiles.forEach((t) => {
      const n = t.dem.n; const stride = t.stride; const m = Math.floor((n - 1) / stride) + 1; const step = t.step * stride;
      const h = t.dem.h;
      const yAt = (r, c) => h[Math.min(n - 1, r * stride) * n + Math.min(n - 1, c * stride)] - oy;
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) {
          const x = t.x0 + c * step; const z = t.z0 + r * step;
          const ya = yAt(Math.max(0, r - 1), c); const yb = yAt(Math.min(m - 1, r + 1), c); const yc = yAt(r, Math.max(0, c - 1)); const yd = yAt(r, Math.min(m - 1, c + 1));
          const dz = (Math.min(m - 1, r + 1) - Math.max(0, r - 1)) * step; const dx = (Math.min(m - 1, c + 1) - Math.max(0, c - 1)) * step;
          let nx = -(yd - yc) / dx; let nz = -(yb - ya) / dz; const nl = Math.hypot(nx, 1, nz); nx /= nl; nz /= nl;
          P.push(x, yAt(r, c), z); Nn.push(nx, 1 / nl, nz);
          const ao = ground.shadeAt(t, x, z); Cc.push(ao, ao, ao);
        }
      }
      for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) { const a = base + r * m + c; const b = a + 1; const c2 = a + m; const d = c2 + 1; I.push(a, c2, b, b, c2, d); }
      // skirts where a neighbour is absent or drawn at another stride (hides the cracks)
      const nb = (di, dj) => tiles.get((t.info.i + di) + '_' + (t.info.j + dj));
      const edge = (list, neighbour) => {
        if (neighbour && neighbour.stride === t.stride) return;
        const sk = P.length / 3;
        list.forEach((k) => { P.push(P[(base + k) * 3], P[(base + k) * 3 + 1] - SKIRT, P[(base + k) * 3 + 2]); Nn.push(0, 1, 0); Cc.push(Cc[(base + k) * 3], Cc[(base + k) * 3 + 1], Cc[(base + k) * 3 + 2]); });
        for (let q = 0; q < list.length - 1; q++) I.push(base + list[q], sk + q, base + list[q + 1], base + list[q + 1], sk + q, sk + q + 1);
      };
      const top = []; const bot = []; const lef = []; const rig = [];
      for (let c = 0; c < m; c++) { top.push(c); bot.push((m - 1) * m + c); }
      for (let r = 0; r < m; r++) { lef.push(r * m); rig.push(r * m + m - 1); }
      edge(top, nb(0, -1)); edge(bot, nb(0, 1)); edge(lef, nb(-1, 0)); edge(rig, nb(1, 0));
      base = P.length / 3;
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(Nn, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(Cc, 3));
    g.setIndex(P.length / 3 > 65535 ? new T.Uint32BufferAttribute(I, 1) : new T.Uint16BufferAttribute(I, 1));
    g.computeBoundingSphere();
    return g;
  }

  /* ---- trees: LiDAR canopy + OSM avenue trees = painted plane trees (world/trees.js): a near and a far template, two InstancedMesh per chunk */
  const treeGeos = makePlaneTreeGeometries(T, quality);
  const matTree = new T.MeshLambertMaterial({ vertexColors: true });
  getMaterials().patchLit(matTree, 'tree');          // polish wave: the fair's night light map reaches the avenue trees; a little more saturated by day
  const treeLod = createTreeLod({ T, root, near: treeGeos.near, far: treeGeos.far, material: matTree, quality });
  const tmpM = new T.Matrix4(); const tmpQ = new T.Quaternion(); const tmpP = new T.Vector3(); const tmpS = new T.Vector3(); const tmpC = new T.Color(); const yAxis = new T.Vector3(0, 1, 0);
  const noTreeRings = [];        // no tree on the tram lane (both tracks + 2.5 m)
  { const pts = H.tram.pts; const L = []; const R = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(len / 3));
      const tx = (b[0] - a[0]) / (len || 1); const tz = (b[1] - a[1]) / (len || 1);
      for (let k = 0; k < n; k++) { const x = a[0] + (b[0] - a[0]) * k / n; const z = a[1] + (b[1] - a[1]) * k / n; L.push([x - tz * -6.2, z + tx * -6.2]); R.push([x - tz * 2.8, z + tx * 2.8]); }
    }
    if (L.length > 2) { const ring = L.concat(R.reverse()); noTreeRings.push({ ring, box: ringBox(ring) }); } }
  function treesFor(ch) {
    const items = [];
    ch.tiles.forEach((t) => {
      (t.osmTrees || []).forEach(([x, z], q) => {          // avenue trees (plane trees) the LiDAR canopy missed: 14 m, crown radius 3.9 m
        if (noTreeRings.some((nq) => x > nq.box[0] && x < nq.box[2] && z > nq.box[1] && z < nq.box[3] && pointInRing(nq.ring, x, z))) return;
        const j = hash2(Math.round(x * 10), Math.round(z * 10));
        items.push([x, z, 14 + 5 * j, 5 + 2.3 * hash2(q, 77), 0.3 + 0.05 * j, 0.42 + 0.05 * j, 0.2, 1000 + q]);
      });
      if (!t.trees || t.trees.byteLength < 8) return;
      const dv = new DataView(t.trees); const n = Math.floor(t.trees.byteLength / 8);
      const cls = t.ground && t.ground.cls; const N = ground.N; const cell = TILE / N;
      for (let k = 0; k < n; k++) {
        if (Q.trees < 1 && hash2(k * 7 + t.info.i, t.info.j * 13 + 1) > Q.trees) continue;
        const lx = dv.getUint16(k * 8, true) / 10; const lz = dv.getUint16(k * 8 + 2, true) / 10;
        const h = dv.getUint8(k * 8 + 4) / 4; const r = dv.getUint8(k * 8 + 5) / 20; const c565 = dv.getUint16(k * 8 + 6, true);
        const x = t.x0 + lx; const z = t.z0 + lz;
        if (cls) { // never on / within 1.5 m of a carriageway (a LiDAR canopy over a road is not a tree)
          let hit = false; const rr = Math.ceil(1.5 / cell);
          const cx = Math.floor(lx / cell); const cz = Math.floor(lz / cell);
          for (let dz = -rr; dz <= rr && !hit; dz++) for (let dx = -rr; dx <= rr; dx++) { const ix = cx + dx; const iz = cz + dz; if (ix < 0 || iz < 0 || ix >= N || iz >= N || dx * dx + dz * dz > rr * rr + 1) continue; if (cls[iz * N + ix] === 0) { hit = true; break; } }
          if (hit) continue;
        }
        if (noTreeRings.some((q) => x > q.box[0] && x < q.box[2] && z > q.box[1] && z < q.box[3] && pointInRing(q.ring, x, z))) continue;
        const cr = ((c565 >> 11) & 31) / 31; const cg = ((c565 >> 5) & 63) / 63; const cb = (c565 & 31) / 31;
        items.push([x, z, h, r, cr, cg, cb, k]);
      }
    });
    if (!items.length) return null;
    const group = treeLod.add(ch.key, items, null, {
      compose(m, it, q) {
        const y = gy(it[0], it[1]) - 0.15;
        const lum = (it[4] + it[5] + it[6]) / 3;
        const con = lum < 0.26 && it[5] > it[4] * 1.05 && hash2(it[7], ch.ci * 5 + ch.cj) < 0.75;
        tmpQ.setFromAxisAngle(yAxis, hash2(q * 3, 11) * 6.283);
        tmpP.set(it[0], y, it[1]);
        const rad = Math.max(1.2, it[3]) * (0.9 + 0.2 * hash2(q, 5));
        const sq = 0.9 + 0.2 * hash2(q, 9);                        // crowns are not round: a little x / z stretch
        if (con) tmpS.set(rad * 0.62, it[2] * 1.02, rad * 0.62); else tmpS.set(rad * sq, it[2], rad / sq);
        m.compose(tmpP, tmpQ, tmpS);
      },
      colorOf(c, it, q) {
        // tint around white: the LiDAR / orthophoto colour only nudges it, so the painted vertex colours carry the look
        const lum = (it[4] + it[5] + it[6]) / 3;
        const con = lum < 0.26 && it[5] > it[4] * 1.05 && hash2(it[7], ch.ci * 5 + ch.cj) < 0.75;
        if (con) { c.setRGB(0.55, 0.8, 0.68); return; }
        const l = lum + 0.02; const v = 0.86 + 0.28 * hash2(q, 21);
        const nr = clamp(it[4] / l, 0.6, 1.5); const ng = clamp(it[5] / l, 0.7, 1.4); const nb = clamp(it[6] / l, 0.5, 1.4);
        const k = 0.4; const warm = hash2(q, 33) < 0.18 ? 1.18 : 1;     // some trees a bit yellower
        c.setRGB((1 + (nr - 1) * k) * v * warm, (1 + (ng - 1) * k) * v, (1 + (nb - 1) * k) * v * (warm > 1 ? 0.75 : 1));
      },
    });
    group.name = 'fouer-trees-group-' + ch.key;
    stats.tris += items.length * (treeGeos.tris.far);
    return group;
  }

  /** the painted bay lines inside the fair field stay (the 2008 photo shows them between the rides) but fainter: vertex colour x 0.55 */
  const BAY_K = 0.55;
  function fadeFieldBays(g) {
    const aM = g.attributes.aMat; const col = g.attributes.color; const pos = g.attributes.position;
    if (!aM || !col) return;
    for (let i = 0; i < aM.count; i++) {
      if (aM.array[i] < 7.5) continue;
      const r = col.array[i * 3]; const gg = col.array[i * 3 + 1]; const b = col.array[i * 3 + 2];
      if (r < 0.85 || r > 0.9 || gg < 0.85 || b < 0.8 || b > 0.87) continue;       // BAY = (0.88, 0.88, 0.85) in luxtram-ground.js
      const x = pos.array[i * 3]; const z = pos.array[i * 3 + 2];
      if (!(pointInRing(fieldRings[0], x, z) || pointInRing(fieldRings[1], x, z))) continue;
      col.array[i * 3] = r * BAY_K; col.array[i * 3 + 1] = gg * BAY_K; col.array[i * 3 + 2] = b * BAY_K;
    }
  }
  let chunkNo = 0;
  const tmpGroup = new T.Group();
  const decorBuckets = new Map();
  for (const ch of chunks.values()) {
    // terrain
    const ctrl = chunkCtrl(ch);
    const mat = ground.terrainMaterial(ch.x0, ch.z0, CHUNK * TILE, ctrl, false);
    mat.vertexColors = true;
    ch.ctrl = ctrl; ch.mat = mat;
    const geo = terrainGeometry(ch);
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = -1; mesh.name = 'fouer-terrain-' + ch.key;
    ch.group.add(mesh); ch.terrain = mesh;
    ch.tiles.forEach((t) => { t.mesh = mesh; });        // (the ground module asks for a built tile's mesh)
    stats.tris += geo.index.count / 3;
    ch.group.name = 'fouer-chunk-' + ch.key;
    root.add(ch.group);
  }
  onProgress(0.3, 'terrain');
  // ground decor (draped on the final mesh), merged per chunk and material.  Tiles on the field get everything; the ring around it gets
  // carriageways / sidewalks / kerbs / paint only; beyond that the painted class map is enough (the Luxtram DECOR_R idea).
  const TIERS = quality === 'low' ? [[50, null, 4.5], [95, ['a', 's', 'k', 'm'], 6], [135, ['a'], 8]] : [[48, null, 7], [95, ['a', 'k'], 8], [150, ['a'], 10]];
  for (const ch of chunks.values()) {
    decorBuckets.clear();
    for (const t of ch.tiles) {
      if (!t.ground) continue;
      const tier = TIERS.find((q) => t.nearD <= q[0]);
      if (!tier) continue;
      const vec = t.ground.vec;
      if (tier[1]) { const lite = {}; tier[1].forEach((k) => { if (vec[k]) lite[k] = vec[k]; }); t.ground = Object.assign({}, t.ground, { vec: lite }); }
      let dc = null;
      window.__lgAsphSeg = tier[2];
      try { dc = ground.decorate(t, tmpGroup); } catch (e) { console.warn('[fouer] ground decor', t.key, e); }
      window.__lgAsphSeg = undefined;
      if (!dc || !dc.group) continue;
      t.decor = dc;
      dc.group.children.slice().forEach((m) => {
        if (!m.isMesh) return;
        const key = m.material.uuid;
        if (!decorBuckets.has(key)) decorBuckets.set(key, { mat: m.material, geos: [], order: m.renderOrder });
        decorBuckets.get(key).geos.push(m.geometry);
      });
      tmpGroup.remove(dc.group);
    }
    decorBuckets.forEach((b) => {
      if (b.mat === ground.matSurface) b.geos.forEach(fadeFieldBays);
      const g = mergeGeos(T, b.geos);
      b.geos.forEach((q) => q.dispose());
      if (!g) return;
      const m = new T.Mesh(g, b.mat); m.renderOrder = b.order; m.name = 'fouer-ground-' + ch.key;
      ch.group.add(m);
      stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    if (++chunkNo % 2 === 0) { onProgress(0.3 + 0.3 * chunkNo / chunks.size, 'decor'); await tick(); }
  }
  // facades + trees
  chunkNo = 0;
  for (const ch of chunks.values()) {
    const bld = []; ch.tiles.forEach((t) => { if (t.bld) bld.push(...t.bld); });
    if (bld.length) {
      try {
        const g = fx.buildTile({ bld, info: { i: ch.ci, j: ch.cj }, key: ch.key }, { n: 2000 });
        if (g) { g.children.forEach((m) => { m.name = 'fouer-bld-' + ch.key; stats.tris += m.geometry.attributes.position.count / 3; }); ch.group.add(g); ch.bld = g; }
      } catch (e) { console.warn('[fouer] facades', ch.key, e); }
    }
    const tr = treesFor(ch);
    if (tr) { ch.group.add(tr); ch.trees = tr; }
    if (++chunkNo % 2 === 0) { onProgress(0.6 + 0.2 * chunkNo / chunks.size, 'buildings'); await tick(); }
  }

  /* ---------------------------------------------------------------- far ring: one terrain mesh + one building mesh */
  const farGroup = new T.Group(); farGroup.name = 'fouer-far';
  farDem = new Map();
  const farKeys = Object.keys(H.far);
  let farMat = null;
  {
    const FT = H.farTile; const FN = H.farNode;
    let i0 = 1e9; let i1 = -1e9; let j0 = 1e9; let j1 = -1e9;
    farKeys.forEach((k) => { const [i, j] = k.split('_').map(Number); i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); });
    const side = Math.max(i1 - i0 + 1, j1 - j0 + 1);
    const fieldC = (() => { const p = H.polys.glacis; return [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]; })();
    const cn = H.far[farKeys[0]].cn; const mosaicN = side * cn;
    const mosaic = new Uint8Array(mosaicN * mosaicN).fill(3);
    const P = []; const Nn = []; const I = [];
    let base = 0;
    farKeys.forEach((k) => {
      const [i, j] = k.split('_').map(Number); const e = H.far[k];
      // heights (0.25 m, 2-D predictor, zigzag uint16): see bake_fouer_world.py encode_far_heights
      const v = bundle.view(e.h); const n = v[0];
      const q = new Int32Array(n * n); const hgt = new Float32Array(n * n);
      const dv = new DataView(v.buffer, v.byteOffset + 1, v.byteLength - 1);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const idx = r * n + c; const z = dv.getUint16(idx * 2, true); const d = (z >> 1) ^ -(z & 1);
        const pred = idx === 0 ? 0 : r === 0 ? q[idx - 1] : c === 0 ? q[idx - n] : q[idx - 1] + q[idx - n] - q[idx - n - 1];
        q[idx] = pred + d; hgt[idx] = q[idx] / 4 + 100;
      }
      farDem.set(k, { n, h: hgt });
      const cls = bundle.view(e.c);
      const ox_ = (i - i0) * cn; const oz_ = (j - j0) * cn;
      for (let y = 0; y < cn; y++) for (let x = 0; x < cn; x++) mosaic[(oz_ + y) * mosaicN + ox_ + x] = cls[y * cn + x];
      // terrain nodes: 40 m within ~1.5 km of the field, 80 m beyond; nodes under the detailed tiles sit 14 m lower (they stay hidden below them)
      const dcx = (i + 0.5) * FT - fieldC[0]; const dcz = (j + 0.5) * FT - fieldC[1];
      const st = Math.max(1, Math.min(Math.hypot(dcx, dcz) < 1000 ? Q.farStride : Q.farStride * 2, (n - 1) / 4)); const m = Math.floor((n - 1) / st) + 1; const step = FN * st;
      for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
        const x = i * FT + c * step; const z = j * FT + r * step;
        const inNear = tiles.has(Math.floor(x / TILE) + '_' + Math.floor(z / TILE)) || tiles.has(Math.floor((x - 1) / TILE) + '_' + Math.floor((z - 1) / TILE));
        P.push(x, hgt[Math.min(n - 1, r * st) * n + Math.min(n - 1, c * st)] - oy - (inNear ? 14 : 1.5), z);
      }
      for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
        const ya = P[(base + Math.max(0, r - 1) * m + c) * 3 + 1]; const yb = P[(base + Math.min(m - 1, r + 1) * m + c) * 3 + 1];
        const yc = P[(base + r * m + Math.max(0, c - 1)) * 3 + 1]; const yd = P[(base + r * m + Math.min(m - 1, c + 1)) * 3 + 1];
        const dx = (yd - yc) / (2 * step); const dz = (yb - ya) / (2 * step); const nl = Math.hypot(dx, 1, dz);
        Nn.push(-dx / nl, 1 / nl, -dz / nl);
      }
      for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) { const a = base + r * m + c; I.push(a, a + m, a + 1, a + 1, a + m, a + m + 1); }
      // skirts (30 m) on the four tile edges hide the cracks between the two strides
      { const edges = [[], [], [], []]; for (let c = 0; c < m; c++) { edges[0].push(c); edges[1].push((m - 1) * m + c); } for (let r = 0; r < m; r++) { edges[2].push(r * m); edges[3].push(r * m + m - 1); }
        edges.forEach((list) => { const sk = (P.length / 3); list.forEach((k) => { P.push(P[(base + k) * 3], P[(base + k) * 3 + 1] - 30, P[(base + k) * 3 + 2]); Nn.push(0, 1, 0); });
          for (let q = 0; q < list.length - 1; q++) I.push(base + list[q], sk + q, base + list[q + 1], base + list[q + 1], sk + q, sk + q + 1); });
      }
      base = P.length / 3;
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(Nn, 3));
    g.setIndex(P.length / 3 > 65535 ? new T.Uint32BufferAttribute(I, 1) : new T.Uint16BufferAttribute(I, 1));
    g.computeBoundingSphere();
    const ctrl = ground.weightTextures(mosaic, mosaicN);
    farMat = ground.farMaterial(i0 * FT, j0 * FT, side * FT, ctrl);
    const mesh = new T.Mesh(g, farMat); mesh.renderOrder = -2; mesh.name = 'fouer-far-terrain'; mesh.frustumCulled = false;
    farGroup.add(mesh);
    stats.tris += I.length / 3;
    farGroup.userData.ctrl = ctrl;
  }
  onProgress(0.88, 'far');
  // far buildings: extruded footprints, vertex colours from the facade palettes
  const farPal = [
    ['#ebe0c6', '#e7d7b4', '#ddcba6', '#e9d5c0', '#d8d0c0', '#f0eada'], ['#d6d4ce', '#cbc8bf', '#d9d4c4', '#c0c4c5'], ['#f0eee8', '#e5e3dc', '#d6d8d8', '#ece7dd'],
    ['#f0e7d5', '#e9ddc3', '#f1ece1', '#e3d0bc'], ['#d2d6d8', '#c6cbce', '#b9bec1'], ['#cbcccd', '#b9bdbf', '#d8dada'], ['#d9d3c2', '#cac5b7', '#d2d1cc'], ['#d6c9ab', '#cbbe9f'],
  ].map((l) => l.map((h) => { const c = new T.Color(h); return [c.r, c.g, c.b]; }));
  const farRoof = [['#626972', '#596069'], ['#8b9297', '#aaa9a3'], ['#8b9297', '#aaa9a3'], ['#8f4b36', '#7f4130', '#626972'], ['#9a9994', '#8b9297'], ['#aaa9a3', '#9a9994'], ['#626972', '#8b9297'], ['#626972', '#4e8f7d']]
    .map((l) => l.map((h) => { const c = new T.Color(h); return [c.r, c.g, c.b]; }));
  {
    const wp = []; const wn = []; const wc = []; const rp = []; const rn = []; const rc = [];
    const FT = H.farTile; let bi = 0;
    farKeys.forEach((k) => {
      const e = H.far[k]; if (!e.b) return;
      const [ti, tj] = k.split('_').map(Number); const v = bundle.view(e.b);
      const dv = new DataView(v.buffer, v.byteOffset, v.byteLength); let p = 2; const nb = dv.getUint16(0, true);
      for (let q = 0; q < nb; q++, bi++) {
        const kind = dv.getUint8(p); const np = dv.getUint8(p + 1); const zmin = dv.getUint16(p + 2, true) / 10 + 100; const zmax = dv.getUint16(p + 4, true) / 10 + 100; p += 6;
        const ring = [];
        let x = dv.getInt16(p, true) / 10 - 1000 + ti * FT; let z = dv.getInt16(p + 2, true) / 10 - 1000 + tj * FT; p += 4;
        ring.push([x, z]);
        for (let a = 1; a < np; a++) { x += dv.getInt8(p) / 2; z += dv.getInt8(p + 1) / 2; p += 2; ring.push([x, z]); }
        const y0 = zmin - oy - 0.5; const y1 = zmax - oy;
        const pal = farPal[kind] || farPal[0]; const wcol = pal[(bi * 7) % pal.length]; const rp0 = farRoof[kind] || farRoof[1]; const rcol = rp0[(bi * 5 + 3) % rp0.length];
        let ar = 0; for (let a = 0; a < ring.length; a++) { const pa = ring[a]; const pb = ring[(a + 1) % ring.length]; ar += pa[0] * pb[1] - pb[0] * pa[1]; }
        const sg = ar < 0 ? -1 : 1;
        for (let a = 0; a < ring.length; a++) {
          const p0 = ring[a]; const p1 = ring[(a + 1) % ring.length];
          const dx = p1[0] - p0[0]; const dz = p1[1] - p0[1]; const l = Math.hypot(dx, dz) || 1;
          const nx = (dz / l) * sg; const nz = (-dx / l) * sg; const sh = 0.85 + 0.15 * Math.abs(nx);
          [[p0, y0], [p1, y0], [p1, y1], [p0, y0], [p1, y1], [p0, y1]].forEach((q2) => { wp.push(q2[0][0], q2[1], q2[0][1]); wn.push(nx, 0, nz); wc.push(wcol[0] * sh, wcol[1] * sh, wcol[2] * sh); });
        }
        try {
          const tris = T.ShapeUtils.triangulateShape(ring.map((q2) => new T.Vector2(q2[0], q2[1])), []);
          tris.forEach((tr) => tr.forEach((vi) => { rp.push(ring[vi][0], y1 + 0.02, ring[vi][1]); rn.push(0, 1, 0); rc.push(rcol[0], rcol[1], rcol[2]); }));
        } catch (e2) { /* skip the roof */ }
      }
    });
    if (wp.length) {
      const g2 = new T.BufferGeometry();
      g2.setAttribute('position', new T.Float32BufferAttribute(wp.concat(rp), 3));
      g2.setAttribute('normal', new T.Float32BufferAttribute(wn.concat(rn), 3));
      g2.setAttribute('color', new T.Float32BufferAttribute(wc.concat(rc), 3));
      g2.computeBoundingSphere();
      const m = new T.Mesh(g2, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }));
      m.name = 'fouer-far-buildings'; m.frustumCulled = false;
      farGroup.add(m);
      stats.tris += (wp.length + rp.length) / 9;
      farGroup.userData.farBuildings = bi;
    }
  }
  root.add(farGroup);
  onProgress(0.95, 'done');

  /* ---------------------------------------------------------------- API */
  const api = {
    root, ground, fx, tiles, chunks, stats, oy, quality,
    gy, meshY: (x, z) => { const t = tiles.get(Math.floor(x / TILE) + '_' + Math.floor(z / TILE)); const y = t ? meshY(t, x, z) : NaN; return y === y ? y : gy(x, z); },
    setNight(k) { fx.setNight(k); },
    update(dt) { ground.update(Math.min(0.1, dt || 0.016)); treeLod.update(); },
    treeLod, treeGeos,
    /** every mesh of the near + far world (sky/weather module tints materials through this) */
    materials() { const s = new Set(); root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => s.add(m)); }); return [...s]; },
    dispose() { root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); }); fx.dispose && fx.dispose(); ground.dispose(); matTree.dispose(); treeGeos.near.dispose(); treeGeos.far.dispose(); },
  };
  void nightRef; void mulberry;
  return api;
}
