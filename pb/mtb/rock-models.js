/* Sandstone models, built from displaced boxes and spheres (no photographs). Slab space: x along the contour (-0.5 .. 0.5), y up the slope (0 .. 1), z out of the slope:
 * the face is at z = 0, the body reaches back to z = -1 into the hill. Strata are recesses by height (hard layers stand, soft layers are eaten back), block joints are
 * vertical grooves, the top and the edges are rounded, the lower part may be undercut (overhang). The bottom ring of every model is marked aSkirt = 1: the vertex
 * shader lowers it by the instance's `sink`, so the solid always reaches below the terrain.
 * Two levels of detail: near (about 300 triangles) and far (about 70). */
import { createRng, valueNoise, hash2 } from './noise.js';

const THREE = window.THREE;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CREASE_COS_SLAB = Math.cos(58 * Math.PI / 180);
const CREASE_COS = Math.cos(52 * Math.PI / 180);    // faces meeting at more than this stay a crisp edge (blocky sandstone), flatter joins are smooth
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Recess of the strata at height y (0 .. 1): a stack of layers, soft ones eaten back. Returns metres-in-unit (0 .. 0.13). */
function strata(y, seed) {
  let acc = 0, edge = 0;
  const layers = [0.17, 0.12, 0.22, 0.14, 0.19, 0.16];
  for (let i = 0; i < layers.length; i++) {
    const w = layers[i] * (0.85 + 0.3 * valueNoise(i * 3.7 + seed, 1.3, 2));
    const lo = edge, hi = edge + w;
    if (y >= lo && y < hi) { const soft = (i + Math.floor(seed * 10)) % 2 === 0; const t = (y - lo) / w; return (soft ? 0.12 : 0.02) * (0.85 + 0.15 * Math.sin(t * Math.PI)) + acc; }
    edge = hi;
  }
  return 0.04;
}

function displaceSlab(geo, variant, seed) {
  const p = geo.attributes.position;
  const skirt = new Float32Array(p.count);
  const overhang = variant === 'overhang';
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // the Box is centred: map to slab space (x -0.5..0.5, y 0..1, z -1..0)
    y += 0.5; z -= 0.5;
    const front = smooth(-0.3, 0, z), side = smooth(0.32, 0.5, Math.abs(x));
    const rec = strata(clamp01(y), seed);
    z -= rec * front;
    // fractured planes: the face is cut into blocks (vertical joints, bedding planes); every block stands a little proud or sits a little back, with hard edges
    const bi = Math.floor((x + 0.5) * 6 + seed * 3), bj = Math.floor(y * 5 + seed * 2);
    const blockOff = (hash2(bi, bj, Math.floor(seed * 97)) - 0.5) * 0.17;
    z += blockOff * front;
    x += (hash2(bi + 7, bj, Math.floor(seed * 97)) - 0.5) * 0.05 * side;
    x -= Math.sign(x) * strata(clamp01(y + 0.2), seed + 3) * 0.7 * side;
    // block joints: vertical grooves in the face
    const joint = Math.max(0, 1 - Math.abs(x - (valueNoise(seed * 5.1, 4.4, 1) - 0.5) * 0.6) * 38) * 0.05;
    z -= joint * front;
    // large irregularity of the outline, rounded top and edges
    const n1 = valueNoise(x * 2.6 + seed * 9, y * 2.2 + z * 1.9, 5) - 0.5, n2 = valueNoise(x * 6.1 + 4, y * 5.3 + z * 4.1 + seed * 5, 6) - 0.5;
    z += (n1 * 0.2 + n2 * 0.06) * front;
    x += (n1 * 0.14 + n2 * 0.04) * side * Math.sign(x);
    const top = smooth(0.62, 1.0, y);
    y -= top * (0.16 * Math.pow(Math.abs(x) * 2, 3) + 0.12 * Math.pow(clamp01((z + 0.35) / 0.35), 2.2) + (n1 + 0.3) * 0.12);
    if (overhang) {                                                    // undercut: the lower third is cut back, a cap rests on it
      const cut = 1 - smooth(0.2, 0.42, y);
      z -= cut * 0.42 * front * (0.7 + 0.5 * valueNoise(x * 3 + 1, 8, 3));
    }
    const bottom = y <= 0.001 ? 1 : 0;
    skirt[i] = bottom;
    p.setXYZ(i, x, y, z);
  }
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  return geo;
}

/* A sandstone wall as a stack of bedding bands: every band is a grid of rounded blocks separated by V-shaped joint grooves, hard bands stand out, soft ones are eaten back, and a
 * horizontal ledge (tread) joins each band to the next one (moss collects on it, an overhang casts a dark crevice under it). Slab space: x -0.5 .. 0.5 along the contour, y 0 .. 1
 * up the slope, z -1 .. 0 into the hill (the face is at z about 0). Columns are shared by all bands, so the treads connect without T-junctions. */
const BAND_LAYERS = [0.17, 0.12, 0.22, 0.14, 0.19, 0.16];
function slabGeometry(variant, seed, near) {
  const rng = createRng(Math.floor(seed * 1000) + (near ? 11 : 29));
  const overhang = variant === 'overhang';
  const C = near ? 15 : 7;                                         // columns across the face
  const rows = near ? 3 : 2;                                       // vertex rows per band (front face)
  const total = BAND_LAYERS.reduce((a, v) => a + v, 0);
  const tri = [];                                                  // flat triangle list: [x, y, z, skirt, ao] x 3
  const V = (x, y, z, ao = 1) => [x, y, z, y <= 1e-4 ? 1 : 0, ao];
  const push = (a, b, c, want) => {                                // orient outward (want = rough outward direction)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) tri.push(a, c, b); else tri.push(a, b, c);
  };
  const strip = (r0, r1, want) => { for (let i = 0; i < r0.length - 1; i++) { push(r0[i], r0[i + 1], r1[i + 1], want); push(r0[i], r1[i + 1], r1[i], want); } };
  const noise = (x, y) => valueNoise(x * 3.1 + seed * 13, y * 2.6, 4) - 0.5;
  // bands
  let y0 = 0;
  const bands = [];
  for (let i = 0; i < BAND_LAYERS.length; i++) {
    const h = BAND_LAYERS[i] / total * (0.85 + 0.3 * rng());
    const y1 = i === BAND_LAYERS.length - 1 ? 1 : Math.min(1, y0 + h);
    const hard = rng() < 0.5;
    let depth = hard ? -0.012 - 0.025 * rng() : -0.10 - 0.07 * rng();
    if (overhang && y0 < 0.45) depth -= 0.36 * (1 - y0 / 0.45);
    const period = 3 + Math.floor(rng() * 2), phase = Math.floor(rng() * period);
    const cols = [];
    for (let c = 0; c < C; c++) {
      const groove = near ? (c - phase) % period === 0 && c > 0 && c < C - 1 : false;
      const block = Math.floor((c - phase + period * 4) / period);
      const x = -0.5 + c / (C - 1) + (c > 0 && c < C - 1 ? (valueNoise(c * 1.7, i * 3.3, 6) - 0.5) * 0.35 / (C - 1) : 0);
      cols.push({ x: c === 0 ? -0.5 + (hard ? 0 : 0.03) : c === C - 1 ? 0.5 - (hard ? 0 : 0.03) : x, groove, bz: (hash2(block, i, Math.floor(seed * 97)) - 0.5) * 0.055 });
    }
    bands.push({ y0, y1, depth, cols });
    y0 = y1;
  }
  const rowZ = near ? [-0.032, 0.0, -0.02] : [-0.02, -0.02];
  const rowAO = near ? [0.62, 1.0, 0.85] : [0.7, 0.9];
  const frontRow = (band, r) => {
    const y = band.y0 + (band.y1 - band.y0) * (rows === 1 ? 0 : r / (rows - 1));
    const rowPoly = band.cols.map((col, c) => {
      const edge = c === 0 || c === C - 1 ? -0.035 : 0;
      const z = band.depth + col.bz + rowZ[r] + (col.groove ? -0.03 : 0.0) + edge + noise(col.x, y) * 0.03;
      const ao = rowAO[r] * (col.groove ? 0.55 : 1) * (0.9 + 0.2 * valueNoise(col.x * 7 + seed, y * 9, 8));
      return V(col.x, y, Math.min(0, z), ao);
    });
    return rowPoly;
  };
  const faces = bands.map((band) => Array.from({ length: rows }, (_, r) => frontRow(band, r)));
  for (let i = 0; i < bands.length; i++) {
    for (let r = 0; r < rows - 1; r++) strip(faces[i][r], faces[i][r + 1], [0, 0, 1]);
    if (i < bands.length - 1) {                                      // the ledge between this band and the next
      const top = faces[i][rows - 1], bottom = faces[i + 1][0];
      const up = bottom.reduce((a, v, c) => a + (v[2] - top[c][2]), 0) < 0;   // the next band is set back: the tread faces up
      strip(top, bottom, [0, up ? 1 : -1, 0]);
    }
  }
  // sides: from the front edge of each band to the back (x = +-0.5, z = -1)
  const back = (x, y, ao = 0.6) => V(x, y, -1, ao);
  for (const side of [0, 1]) {
    const dir = side === 0 ? -1 : 1;
    for (let i = 0; i < bands.length; i++) {
      for (let r = 0; r < rows - 1; r++) {
        const f0 = faces[i][r][side === 0 ? 0 : C - 1], f1 = faces[i][r + 1][side === 0 ? 0 : C - 1];
        const b0 = back(dir * 0.5, f0[1]), b1 = back(dir * 0.5, f1[1]);
        push(f0, f1, b1, [dir, 0, 0]); push(f0, b1, b0, [dir, 0, 0]);
      }
    }
  }
  // top: the front polyline of the top band, the middle (slightly domed and rolled off at the sides) and the back edge
  const topFront = faces[bands.length - 1][rows - 1];
  const mid = topFront.map((v) => V(v[0], 1 + 0.03 - 0.05 * Math.pow(Math.abs(v[0]) * 2, 3) + noise(v[0] * 2, 5) * 0.04, v[2] * 0.4 - 0.32, 0.95));
  const rear = topFront.map((v) => V(v[0] * 0.98, 1 - 0.03 * Math.pow(Math.abs(v[0]) * 2, 3), -1, 0.8));
  strip(topFront, mid, [0, 1, 0]); strip(mid, rear, [0, 1, 0]);
  // back: one big quad per band chain (hidden in the hill, closes the solid)
  for (const band of bands) { const q = [back(-0.5, band.y0), back(0.5, band.y0), back(0.5, band.y1), back(-0.5, band.y1)]; push(q[0], q[1], q[2], [0, 0, -1]); push(q[0], q[2], q[3], [0, 0, -1]); }
  const pos = new Float32Array(tri.length * 3), skirt = new Float32Array(tri.length), ao = new Float32Array(tri.length);
  tri.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; skirt[i] = v[3]; ao[i] = v[4]; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  geo.computeVertexNormals();
  smoothByCrease(geo, CREASE_COS_SLAB);
  const colour = new Float32Array(tri.length * 3);
  for (let i = 0; i < tri.length; i++) {
    const tone = 0.92 + 0.16 * valueNoise(pos[i * 3] * 4 + seed * 3, pos[i * 3 + 1] * 4 + pos[i * 3 + 2] * 4, 9), k = ao[i] * (0.82 + 0.3 * Math.min(1, pos[i * 3 + 1] * 1.2)) * tone;
    colour[i * 3] = k; colour[i * 3 + 1] = k * 0.97; colour[i * 3 + 2] = k * 0.92;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Crease-aware smoothing of a non-indexed geometry's normals: faces that meet within the crease angle share a normal (rounded weathering), steeper joins stay crisp (ledges, joints). */
function smoothByCrease(g, creaseCos) {
  const p = g.attributes.position, n = g.attributes.normal;
  const key = (i) => `${Math.round(p.getX(i) * 400)},${Math.round(p.getY(i) * 400)},${Math.round(p.getZ(i) * 400)}`;
  const flat = Float32Array.from(n.array);
  const groups = new Map();
  for (let i = 0; i < p.count; i++) { const k = key(i); const list = groups.get(k); if (list) list.push(i); else groups.set(k, [i]); }
  for (let i = 0; i < p.count; i++) {
    let sx = 0, sy = 0, sz = 0;
    const fx = flat[i * 3], fy = flat[i * 3 + 1], fz = flat[i * 3 + 2];
    for (const j of groups.get(key(i))) {
      const jx = flat[j * 3], jy = flat[j * 3 + 1], jz = flat[j * 3 + 2];
      if (fx * jx + fy * jy + fz * jz > creaseCos) { sx += jx; sy += jy; sz += jz; }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    n.setXYZ(i, sx / l, sy / l, sz / l);
  }
}

function boulderGeometry(seed, near, round = false) {
  const geo = new THREE.IcosahedronGeometry(0.5, near ? 2 : 1);
  const p = geo.attributes.position;
  const skirt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.34 * (valueNoise(x * 2.3 + seed * 11, z * 2.3 + y * 1.7, 7) - 0.5) + 0.07 * (valueNoise(x * 7, z * 7 + y * 6, 8) - 0.5);
    x *= k; z *= k; y *= k;
    const ledge = 0.05 * Math.sin((y + 0.5) * 17 + seed * 5);
    x *= 1 + ledge; z *= 1 + ledge;
    y = Math.max(0, y * (round ? 1.3 : 0.9) + (round ? 0.1 : 0.12));
    if (y <= 0.02) { skirt[i] = 1; y = 0; }
    p.setXYZ(i, x * 1.02, y, z * 0.96);
  }
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  return finish(geo, round ? 'boulder-round' : 'boulder', seed);
}

/** Smooth normals (merged by position), vertex colour AO, a position-keyed uv. */
function finish(geo, label, seed, smooth = true) {
  geo.deleteAttribute('uv');
  const g = geo.index ? geo.toNonIndexed() : geo;
  const skirtSrc = geo.attributes.aSkirt;
  const p = g.attributes.position;
  // aSkirt must follow the non-indexed expansion: rebuild by matching
  let skirt = skirtSrc;
  if (geo.index) {
    const sk = new Float32Array(p.count);
    for (let i = 0; i < geo.index.count; i++) sk[i] = skirtSrc.getX(geo.index.getX(i));
    skirt = new THREE.BufferAttribute(sk, 1);
  }
  g.setAttribute('aSkirt', skirt);
  // smooth normals: average the face normals of the vertices that share a quantised position
  g.computeVertexNormals();
  if (!smooth) {                                                 // flat shading: fractured planes keep their hard edges
    const col2 = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const ao = 0.7 + 0.4 * clamp01(p.getY(i) * 1.2 + p.getZ(i) * 0.2 + 0.3), tone = 0.9 + 0.2 * valueNoise(p.getX(i) * 4 + seed * 3, p.getY(i) * 4 + p.getZ(i) * 4, 9); col2[i * 3] = ao * tone; col2[i * 3 + 1] = ao * tone * 0.97; col2[i * 3 + 2] = ao * tone * 0.92; }
    g.setAttribute('color', new THREE.BufferAttribute(col2, 3));
    g.computeBoundingSphere();
    return g;
  }
  const key = (i) => `${Math.round(p.getX(i) * 400)},${Math.round(p.getY(i) * 400)},${Math.round(p.getZ(i) * 400)}`;
  const n = g.attributes.normal;
  const flat = Float32Array.from(n.array);
  const groups = new Map();
  for (let i = 0; i < p.count; i++) { const k = key(i); const list = groups.get(k); if (list) list.push(i); else groups.set(k, [i]); }
  const smoothed = new Float32Array(flat.length);
  for (let i = 0; i < p.count; i++) {                                // crease-aware: only faces within the crease angle of this face join its smoothing group
    let sx = 0, sy = 0, sz = 0;
    const fx = flat[i * 3], fy = flat[i * 3 + 1], fz = flat[i * 3 + 2];
    for (const j of groups.get(key(i))) {
      const jx = flat[j * 3], jy = flat[j * 3 + 1], jz = flat[j * 3 + 2];
      if (fx * jx + fy * jy + fz * jz > CREASE_COS) { sx += jx; sy += jy; sz += jz; }
    }
    smoothed[i * 3] = sx; smoothed[i * 3 + 1] = sy; smoothed[i * 3 + 2] = sz;
  }
  const sum = { get: (k) => null };
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const sx = smoothed[i * 3], sy = smoothed[i * 3 + 1], sz = smoothed[i * 3 + 2], l = Math.hypot(sx, sy, sz) || 1;
    n.setXYZ(i, sx / l, sy / l, sz / l);
    const ao = label.startsWith('boulder') ? 0.72 + 0.4 * clamp01(p.getY(i) * 1.6) : 0.7 + 0.4 * clamp01(p.getY(i) * 1.2 + p.getZ(i) * 0.2 + 0.3);
    const tone = 0.9 + 0.2 * valueNoise(p.getX(i) * 4 + seed * 3, p.getY(i) * 4 + p.getZ(i) * 4, 9);
    col[i * 3] = ao * tone; col[i * 3 + 1] = ao * tone * 0.97; col[i * 3 + 2] = ao * tone * 0.92;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function buildRockModels() {
  return {
    slabA: { near: slabGeometry('slab', 0.17, true), far: slabGeometry('slab', 0.17, false) },
    slabB: { near: slabGeometry('slab', 0.61, true), far: slabGeometry('slab', 0.61, false) },
    overhang: { near: slabGeometry('overhang', 0.38, true), far: slabGeometry('overhang', 0.38, false) },
    boulderA: { near: boulderGeometry(0.3, true), far: boulderGeometry(0.3, false) },
    boulderB: { near: boulderGeometry(0.7, true), far: boulderGeometry(0.7, false) },
    stone: { near: boulderGeometry(0.5, true, true), far: boulderGeometry(0.5, false, true) },
  };
}
