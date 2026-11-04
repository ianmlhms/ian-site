/* The trees of Lux Drive as painted low-poly models, built from code (no picture files).
 *
 * A tree is one unit tall at scale 1: the instance carries the real height, so one model serves every tree of the
 * forest.  The shapes are flat shaded (every face carries its own normal), so a crown reads as a handful of facets
 * the way the rest of the game is painted.  The crown is a lumpy blob: the lumpiness comes from the vertices, not
 * from a texture, so a tree never shows the same silhouette twice.
 *
 * Pure (no THREE), so the Node harness measures the very same shapes as the browser. */

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTICES = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const BARK = [0.40, 0.37, 0.32];         // the grey brown of a beech
const BARK_DARK = [0.30, 0.27, 0.23];
const LEAF = [0.27, 0.42, 0.16];         // the green of a crown
const LEAF_DARK = [0.19, 0.31, 0.12];    // the shade under the crown

/** The mesh of a tree: the arrays the view turns into a buffer geometry. */
export function createTreeMesh() {
  return { pos: [], nor: [], col: [], idx: [] };
}

/**
 * A lumpy blob: an icosahedron whose vertices are pushed about, flat shaded.
 * The vertices are shared before they are drawn, so the shell stays closed.
 */
function addBlob(m, cx, cy, cz, radius, colour, rng, flatten = 0.86) {
  const pts = ICO_VERTICES.map(([vx, vy, vz]) => {
    const l = Math.hypot(vx, vy, vz);
    const k = 1 + 0.24 * (rng() - 0.5) * 2;
    return [cx + (vx / l) * radius * k, cy + (vy / l) * radius * k * flatten, cz + (vz / l) * radius * k];
  });
  for (const [ia, ib, ic] of ICO_FACES) {
    const a = pts[ia], b = pts[ib], c = pts[ic];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // the faces that look at the sky are lighter, the ones under the crown are darker
    const shade = 0.78 + 0.34 * (ny * 0.5 + 0.5);
    const base = m.pos.length / 3;
    for (const p of [a, b, c]) {
      m.pos.push(p[0], p[1], p[2]);
      m.nor.push(nx, ny, nz);
      const k = shade * (0.94 + 0.12 * rng());
      m.col.push(colour[0] * k, colour[1] * k, colour[2] * k);
    }
    m.idx.push(base, base + 1, base + 2);
  }
}

/**
 * The trunk: a tapered prism that leans a little and flares at the foot.
 * The rings are the three heights of the trunk, the sides the number of faces.
 */
function addTrunk(m, height, r0, r1, r2, leanX, leanZ, rng, sides = 6) {
  const rings = [[0, r0], [height * 0.45, r1], [height, r2]];
  const at = (ring, k) => {
    const a = (k / sides) * Math.PI * 2 + rng() * 0.0;
    const [y, r] = rings[ring];
    const t = y / height;
    return [Math.cos(a) * r + leanX * t * t, y, Math.sin(a) * r + leanZ * t * t];
  };
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let k = 0; k < sides; k++) {
      const a = at(ring, k), b = at(ring, k + 1), c = at(ring + 1, k + 1), d = at(ring + 1, k);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const shade = ring === 0 ? 0.78 : ring === 1 ? 0.92 : 1.0;      // the foot of a trunk is in its own shade
      const base = m.pos.length / 3;
      for (const p of [a, b, c, d]) {
        m.pos.push(p[0], p[1], p[2]);
        m.nor.push(nx, ny, nz);
        const col = ring === 0 ? BARK_DARK : BARK;
        m.col.push(col[0] * shade, col[1] * shade, col[2] * shade);
      }
      m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

/** A stable number out of a seed: the same tree always looks the same. */
function rngOf(seed) {
  let s = (seed | 0) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A broadleaf: a clear trunk and a crown of one, two or three blobs.
 * detail 0 = near (three blobs, a forked trunk), 1 = mid (two blobs), 2 = far (one blob).
 */
export function buildBroadleaf(detail, seed = 1) {
  const rng = rngOf(seed * 7919 + detail * 31);
  const m = createTreeMesh();
  const fork = 0.42 + rng() * 0.12;
  const leanX = (rng() - 0.5) * 0.05, leanZ = (rng() - 0.5) * 0.05;
  addTrunk(m, fork, 0.028, 0.018, 0.011, leanX, leanZ, rng);
  const crownR = detail === 0 ? 0.30 : detail === 1 ? 0.32 : 0.34;
  const cy = fork + (1 - fork) * 0.46;
  const blobs = detail === 0
    ? [[0, cy, 0, crownR], [crownR * 0.62, cy - 0.1, crownR * 0.2, crownR * 0.66], [-crownR * 0.5, cy - 0.06, -crownR * 0.3, crownR * 0.62]]
    : detail === 1
      ? [[0, cy, 0, crownR], [crownR * 0.5, cy - 0.08, 0, crownR * 0.7]]
      : [[0, cy, 0, crownR * 1.05]];
  for (const [x, y, z, r] of blobs) {
    const under = y < cy + 0.02 ? LEAF_DARK : LEAF;
    addBlob(m, x + leanX * 0.6, y, z + leanZ * 0.6, r, under, rng);
  }
  return m;
}

/** A bush: a single blob close to the ground (the hedges and the shrubs of the parks). */
export function buildBush(seed = 1) {
  const rng = rngOf(seed * 3571 + 5);
  const m = createTreeMesh();
  const r = 0.42 + rng() * 0.1;
  addBlob(m, 0, r * 0.85, 0, r, LEAF, rng, 0.8);
  addBlob(m, r * 0.5, r * 0.6, r * 0.2, r * 0.6, LEAF_DARK, rng, 0.8);
  return m;
}
