/* The geometry of the Schiessentümpel ledge (see cascade.js for the layout): a closed sandstone solid with a flat top, a vertical front face with strata and big mossy boulders on
 * the lip between the chutes, plus a few loose stones in the pool. Built once at start-up. Model space: x across the river (v), y up from the water level at the lip, z along the flow (u).
 * Two geometries for rock-view's landmark material: `ledge` (the solid + the boulders; the bottom ring is marked aSkirt, so the solid always reaches below the terrain) and `stones`. */
import { LEDGE, CHUTES, BOULDERS, POOL_STONES, ledgeTop, bankBoulders, toWorld } from './cascade.js';
import { valueNoise } from './noise.js';

const THREE = window.THREE;
const COLUMN_STEP = 0.46;         // m between the columns of the ledge outline
const TOP_STEP = 0.8;             // m between the points along the top
const FACE_STEP = 0.42;           // m between the points down the face
const LIP_ROUND = 0.22;           // m radius of the rounded lip
const SPHERE_SEGMENTS = 22, SPHERE_RINGS = 14;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class Mesh {
  constructor() { this.pos = []; this.col = []; this.skirt = []; this.idx = []; }
  vertex(x, y, z, shade, skirt = 0) { this.pos.push(x, y, z); this.col.push(shade, shade * 0.97, shade * 0.92); this.skirt.push(skirt); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(this.skirt, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Where the face stands at across-position v (m in front of the lip): rough, recessed in the chutes (the water pours in the gap between the boulders), grooved by the strata. */
export function faceAt(faceU, v) {
  let recess = 0;
  for (const ch of CHUTES) recess = Math.max(recess, Math.exp(-((v - ch.v) * (v - ch.v)) / (2 * (ch.w * 0.9) ** 2)));
  return faceU - 0.3 - 0.35 * recess + 0.28 * (valueNoise(v * 1.7, 3.1, 11) - 0.5);
}

/** The ledge: one outline per column across the river (bottom of the back wall, up, along the top, round the lip, down the face to the base), joined into a grid, closed at both ends. */
function addLedge(m, faceU, drop) {
  const base = -drop - LEDGE.baseBelow;
  const columns = [];
  const nCol = Math.round(2 * LEDGE.halfWidth / COLUMN_STEP);
  for (let ci = 0; ci <= nCol; ci++) {
    const v = -LEDGE.halfWidth + (2 * LEDGE.halfWidth * ci) / nCol;
    const uf = faceAt(faceU, v);
    const outline = [];                                          // [u, y, shade, skirt]
    outline.push([-LEDGE.backU, base, 0.5, 1]);
    const nTop = Math.max(2, Math.ceil((uf - LIP_ROUND + LEDGE.backU) / TOP_STEP));
    for (let k = 0; k <= nTop; k++) { const u = -LEDGE.backU + ((uf - LIP_ROUND + LEDGE.backU) * k) / nTop; outline.push([u, ledgeTop(u, v) + 0.05 * (valueNoise(u * 0.9, v * 0.9, 5) - 0.5), 1.0, 0]); }
    const yLip = ledgeTop(uf - LIP_ROUND, v);
    for (let k = 1; k <= 3; k++) { const a = (k / 3) * Math.PI / 2; outline.push([uf - LIP_ROUND + Math.sin(a) * LIP_ROUND, yLip - LIP_ROUND + Math.cos(a) * LIP_ROUND, 0.95, 0]); }
    const yEnd = yLip - LIP_ROUND;
    const nFace = Math.max(3, Math.ceil((yEnd - base) / FACE_STEP));
    for (let k = 1; k <= nFace; k++) {
      const y = yEnd + ((base - yEnd) * k) / nFace;
      const groove = 0.14 * Math.sin(y * 5.3 + v * 1.1) * (k < nFace ? 1 : 0) + 0.1 * (valueNoise(v * 2.3, y * 1.9, 4) - 0.5);        // strata: hard layers stand, soft layers are eaten back
      const wet = 0.5 + 0.4 * smooth(base, yEnd, y);
      outline.push([uf + groove, y, wet, k === nFace ? 1 : 0]);
    }
    columns.push({ v, outline });
  }
  // grid: every column has the same point count only if the outlines match; the lengths differ with the face position, so resample every outline to the same count by index fraction
  const N = 44;
  const resampled = columns.map((col) => {
    const o = col.outline, lens = [0];
    for (let i = 1; i < o.length; i++) lens.push(lens[i - 1] + Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]));
    const total = lens[lens.length - 1], pts = [];
    for (let k = 0; k < N; k++) {
      const s = (total * k) / (N - 1);
      let i = 1; while (i < lens.length - 1 && lens[i] < s) i++;
      const t = (s - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
      const a = o[i - 1], b = o[i];
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, (k === 0 || k === N - 1) ? 1 : (a[3] && b[3] ? 1 : 0)]);
    }
    return { v: col.v, pts };
  });
  const ids = resampled.map((col) => col.pts.map((p) => m.vertex(col.v, p[1], p[0], p[2] * (0.88 + 0.22 * valueNoise(col.v * 1.3, p[0] * 0.7, 8)), p[3])));
  for (let ci = 0; ci < nCol; ci++) for (let k = 0; k < N - 1; k++) { const a = ids[ci][k], b = ids[ci + 1][k], c = ids[ci][k + 1], d = ids[ci + 1][k + 1]; m.tri(a, b, c); m.tri(b, d, c); }
  // end caps: a fan over each end outline (the ledge ends inside the banks, nobody sees it)
  for (const ci of [0, nCol]) {
    const col = resampled[ci], centre = m.vertex(col.v, base * 0.4, (col.pts[0][0] + col.pts[N - 1][0]) / 2, 0.5, 1);
    const flip = ci === 0;
    for (let k = 0; k < N - 1; k++) { if (flip) m.tri(centre, ids[ci][k], ids[ci][k + 1]); else m.tri(centre, ids[ci][k + 1], ids[ci][k]); }
  }
}

/** A lumpy boulder: a sphere grid with low and medium noise, flattened where it sits on the ledge. Embedded boulders have no skirt (they sit in the ledge), stones in the pool do. */
function addBoulder(m, cx, cy, cz, rx, ry, rz, seed, skirtBelow = null, groundAt = null) {
  const rows = [];
  for (let r = 0; r <= SPHERE_RINGS; r++) {
    const phi = (r / SPHERE_RINGS) * Math.PI, row = [];
    for (let s = 0; s < SPHERE_SEGMENTS; s++) {
      const th = (s / SPHERE_SEGMENTS) * 2 * Math.PI;
      const dx = Math.sin(phi) * Math.cos(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.sin(th);
      const k = 1 + 0.26 * (valueNoise(dx * 1.7 + seed * 9, dz * 1.7 + dy * 1.3, 21) - 0.5) + 0.09 * (valueNoise(dx * 5.1 + seed * 3, dz * 5.1 + dy * 4.4, 22) - 0.5);
      const flatten = dy < -0.55 ? 1 - 0.25 * (-0.55 - dy) : 1;
      const x = cx + dx * rx * k * flatten, z = cz + dz * rz * k * flatten;
      let y = cy + dy * ry * k;
      if (groundAt && dy < 0.1) y = Math.min(y, groundAt(x, z) - 0.14);                // a boulder in a slope: its lower half is clamped under the ground at every vertex (no gap on the downhill side)
      const ao = 0.62 + 0.42 * smooth(-1, 0.8, dy);
      row.push(m.vertex(x, y, z, ao * (0.88 + 0.22 * valueNoise(dx * 3 + seed * 5, dz * 3, 23)), skirtBelow !== null && y < skirtBelow ? 1 : 0));
    }
    rows.push(row);
  }
  for (let r = 0; r < SPHERE_RINGS; r++) {
    for (let s = 0; s < SPHERE_SEGMENTS; s++) {
      const s1 = (s + 1) % SPHERE_SEGMENTS;
      const a = rows[r][s], b = rows[r][s1], c = rows[r + 1][s], d = rows[r + 1][s1];
      if (r > 0) m.tri(a, c, b);
      if (r < SPHERE_RINGS - 1) m.tri(b, c, d);
    }
  }
}

/** c = placeCascade() result, surface = the physics surface (the bank boulders are clamped into the slope). Returns { ledge, stones } geometries (model space, see the header). */
export function buildCascadeModel(c, surface) {
  const ledge = new Mesh();
  addLedge(ledge, c.faceU, c.drop);
  for (const b of BOULDERS) {
    const ry = Math.min(1.35, Math.max(0.75, b.rv * 0.95));
    const u = faceAt(c.faceU, b.v) - 0.1 - b.rz * 0.35;
    addBoulder(ledge, b.v, b.up - ry, u, b.rv, ry, b.rz, b.seed);
  }
  const stones = new Mesh();
  for (const s of POOL_STONES) addBoulder(stones, s.v, -c.drop + s.r * 0.15, c.faceU + s.u, s.r * 1.1, s.r * 0.85, s.r, s.seed, -c.drop + s.r * 0.1);
  const world = { x: 0, z: 0 };
  const groundAt = (v, u) => { toWorld(c, u, v, world); return surface.height(world.x, world.z) - c.lipY; };          // model space (x = v, z = u) -> height above the lip level
  for (const b of bankBoulders(c, surface)) {
    toWorld(c, b.u, b.v, world);
    const base = groundAt(b.v, b.u);
    addBoulder(stones, b.v, base + b.ry * 0.25, b.u, b.rx, b.ry, b.rz, b.seed, null, groundAt);
  }
  return { ledge: ledge.build(), stones: stones.build() };
}
