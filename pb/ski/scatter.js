/* Where the trees and the boulders stand (pure, deterministic: the same block always gets the same trees, for the picture and for the
 * collisions). Placed per 80 m block on a jittered 5 m grid from the land-cover attributes: forest (OSM forest / wood, and open larch
 * stands below 2150 m where OSM maps none), never on a piste or within 2.5 m of its edge, never on rock, water or in a village street.
 * Species: spruce / pine (evergreen, snow on the branches) and larch (bare and copper-brown in winter, like the real Tarentaise).
 * Boulders: in the mapped rock and scree areas on slopes a skier can reach, never on a piste. */
import { hash2 } from './noise.js';

export const BLOCK = 80;
const GRID = 5;
const TREE_KEEP = 0.62;          // share of the 5 m candidates that hold a tree in full forest (about one tree per 40 m2)
const ROCK_GRID = 10;

/** opts.guard(x, z, y) -> true = no tree here (round 7-B: the lift aisles, stations and pylon bases, lift-site.js liftTreeGuard). */
export function createScatter(field, opts = {}) {
  const guard = opts.guard || null;
  const trees = new Map();       // block key -> Float32Array [x, y, z, scale, species, seed] * n
  const rocks = new Map();       // block key -> Float32Array [x, y, z, radius, seed] * n
  const key = (bx, bz) => bx * 100003 + bz;
  const a = { piste: 0, diff: -1, forest: 0, rock: 0, built: 0, water: 0, glacier: 0 };

  function slopeAt(x, z) {
    const d = 2.5;
    const gx = (field.baseHeight(x + d, z) - field.baseHeight(x - d, z)) / (2 * d);
    const gz = (field.baseHeight(x, z + d) - field.baseHeight(x, z - d)) / (2 * d);
    return Math.hypot(gx, gz);
  }

  function treeBlock(bx, bz) {
    const k = key(bx, bz);
    let t = trees.get(k);
    if (t) return t;
    const out = [];
    const x0 = bx * BLOCK, z0 = bz * BLOCK;
    if (x0 + BLOCK > 0 && z0 + BLOCK > 0 && x0 < field.width && z0 < field.depth) {
      for (let j = 0; j < BLOCK / GRID; j++) {
        for (let i = 0; i < BLOCK / GRID; i++) {
          const gi = bx * (BLOCK / GRID) + i, gj = bz * (BLOCK / GRID) + j;
          const r0 = hash2(gi, gj, 11);
          const x = x0 + (i + 0.5) * GRID + (hash2(gi, gj, 12) - 0.5) * GRID * 0.9;
          const z = z0 + (j + 0.5) * GRID + (hash2(gi, gj, 13) - 0.5) * GRID * 0.9;
          field.attrs(x, z, a);
          if (a.forest <= 0.05 || r0 > a.forest * TREE_KEEP) continue;
          if (a.piste > 0.01 || a.dist < 2.5 || a.rock > 0.45 || a.built > 0.2 || a.water > 0.05) continue;
          if (slopeAt(x, z) > 0.9) continue;
          const y = field.height(x, z) - 0.25;
          if (guard && guard(x, z, y)) continue;
          const h = hash2(gi, gj, 14);
          const larch = hash2(gi, gj, 15) < 0.36 && y < 2250 ? 1 : 0;
          const scale = 0.7 + 0.7 * h * h + (y < 1900 ? 0.25 : 0);
          out.push(x, y, z, scale, larch, hash2(gi, gj, 16));
        }
      }
    }
    t = new Float32Array(out);
    t.bx = bx; t.bz = bz;
    trees.set(k, t);
    if (trees.size > 4000) trees.delete(trees.keys().next().value);
    return t;
  }

  function rockBlock(bx, bz) {
    const k = key(bx, bz);
    let r = rocks.get(k);
    if (r) return r;
    const out = [];
    const x0 = bx * BLOCK, z0 = bz * BLOCK;
    if (x0 + BLOCK > 0 && z0 + BLOCK > 0 && x0 < field.width && z0 < field.depth) {
      for (let j = 0; j < BLOCK / ROCK_GRID; j++) {
        for (let i = 0; i < BLOCK / ROCK_GRID; i++) {
          const gi = bx * (BLOCK / ROCK_GRID) + i, gj = bz * (BLOCK / ROCK_GRID) + j;
          const x = x0 + (i + 0.5) * ROCK_GRID + (hash2(gi, gj, 21) - 0.5) * ROCK_GRID * 0.8;
          const z = z0 + (j + 0.5) * ROCK_GRID + (hash2(gi, gj, 22) - 0.5) * ROCK_GRID * 0.8;
          field.attrs(x, z, a);
          if (a.rock < 0.3 || a.piste > 0.01 || a.dist < 4 || a.built > 0.1 || a.water > 0.05) continue;
          if (hash2(gi, gj, 23) > 0.55 * a.rock) continue;
          const sl = slopeAt(x, z);
          if (sl > 1.1) continue;                                   // a cliff face is the terrain itself (painted rock)
          if (guard && guard(x, z, field.height(x, z))) continue;                // (no boulders in a station or a lift track either)
          const rad = 0.7 + 2.2 * Math.pow(hash2(gi, gj, 24), 2);
          out.push(x, field.height(x, z) - rad * 0.35, z, rad, hash2(gi, gj, 25));
        }
      }
    }
    r = new Float32Array(out);
    r.bx = bx; r.bz = bz;
    rocks.set(k, r);
    if (rocks.size > 3000) rocks.delete(rocks.keys().next().value);
    return r;
  }

  /** Nearest obstacle overlap for a body of radius r at (x, z) (y = feet height: a skier flying over a small rock misses it), or null. */
  const hitOut = { nx: 0, nz: 0, pen: 0, kind: '' };
  function hit(x, z, r, y = -1e9, density = 1) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    let best = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const lx = (bx + dx) * BLOCK, lz = (bz + dz) * BLOCK;
        if (x < lx - 6 || x > lx + BLOCK + 6 || z < lz - 6 || z > lz + BLOCK + 6) continue;
        const t = treeBlock(bx + dx, bz + dz);
        for (let i = 0; i < t.length; i += 6) {
          if (t[i + 5] > density) continue;
          const rr = r + 0.28 * t[i + 3];
          const ddx = x - t[i], ddz = z - t[i + 2];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < rr * rr && y < t[i + 1] + 9 * t[i + 3]) {
            const d = Math.sqrt(d2) || 1e-3, pen = rr - d;
            if (!best || pen > best.pen) { best = hitOut; best.nx = ddx / d; best.nz = ddz / d; best.pen = pen; best.kind = 'tree'; }
          }
        }
        const q = rockBlock(bx + dx, bz + dz);
        for (let i = 0; i < q.length; i += 5) {
          const rr = r + q[i + 3] * 0.8;
          const ddx = x - q[i], ddz = z - q[i + 2];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < rr * rr && y < q[i + 1] + q[i + 3] * 1.2) {
            const d = Math.sqrt(d2) || 1e-3, pen = rr - d;
            if (!best || pen > best.pen) { best = hitOut; best.nx = ddx / d; best.nz = ddz / d; best.pen = pen; best.kind = 'rock'; }
          }
        }
      }
    }
    return best;
  }

  function invalidate(x0, z0, x1, z1) {
    for (const m of [trees, rocks]) for (const [k, v] of [...m]) {
      const wx = v.bx * BLOCK, wz = v.bz * BLOCK;
      if (wx <= x1 && wx + BLOCK >= x0 && wz <= z1 && wz + BLOCK >= z0) m.delete(k);
    }
  }

  const has = (bx, bz) => trees.has(key(bx, bz)) && rocks.has(key(bx, bz));
  return { treeBlock, rockBlock, hit, invalidate, has };
}
