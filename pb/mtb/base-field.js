/* The LiDAR terrain as a continuous function: baseHeight(x, z).
 *   - near grid (2 m nodes over the box) and far grid (32 m nodes, box + 8 km) are both read with a clamped Catmull-Rom bicubic,
 *     which is smooth (no facets on a 1 m lattice) and never overshoots the four nodes around the point (no ringing at cliffs);
 *   - the far grid fills in everything outside the box and the border zone, blended with a smoothstep, so the function is defined and
 *     continuous on the whole plane and the distant hills share the same surface as the playable valley.
 * Pure functions, no THREE, so the Node harness and the browser use the very same code. */
import { WORLD } from './config.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Clamped Catmull-Rom sample of a regular grid whose node (i, j) lies at (i * step, j * step) (+ offset). Pure and allocation free. */
export function sampleBicubic(grid, x, z) {
  const { nx, nz, data } = grid;
  const gx = Math.min(nx - 1.0000001, Math.max(0, x));
  const gz = Math.min(nz - 1.0000001, Math.max(0, z));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const tx = gx - i;
  const tz = gz - j;
  const t2x = tx * tx, t3x = t2x * tx, t2z = tz * tz, t3z = t2z * tz;
  const wx0 = -0.5 * t3x + t2x - 0.5 * tx, wx1 = 1.5 * t3x - 2.5 * t2x + 1, wx2 = -1.5 * t3x + 2 * t2x + 0.5 * tx, wx3 = 0.5 * t3x - 0.5 * t2x;
  const wz0 = -0.5 * t3z + t2z - 0.5 * tz, wz1 = 1.5 * t3z - 2.5 * t2z + 1, wz2 = -1.5 * t3z + 2 * t2z + 0.5 * tz, wz3 = 0.5 * t3z - 0.5 * t2z;
  const x0 = Math.max(0, i - 1), x1 = i, x2 = i + 1, x3 = Math.min(nx - 1, i + 2);
  const z0 = Math.max(0, j - 1), z1 = j, z2 = j + 1, z3 = Math.min(nz - 1, j + 2);
  let sum = 0;
  for (let r = 0; r < 4; r++) {
    const zr = r === 0 ? z0 : r === 1 ? z1 : r === 2 ? z2 : z3;
    const wz = r === 0 ? wz0 : r === 1 ? wz1 : r === 2 ? wz2 : wz3;
    const o = zr * nx;
    sum += wz * (wx0 * data[o + x0] + wx1 * data[o + x1] + wx2 * data[o + x2] + wx3 * data[o + x3]);
  }
  const a = data[z1 * nx + x1], b = data[z1 * nx + x2], c = data[z2 * nx + x1], d = data[z2 * nx + x2];
  const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
  return sum < lo ? lo : sum > hi ? hi : sum;
}

/** Bilinear read for the low-priority layers (canopy, classes). */
export function sampleBilinear(grid, x, z) {
  const { nx, nz, data } = grid;
  const gx = Math.min(nx - 1.0000001, Math.max(0, x));
  const gz = Math.min(nz - 1.0000001, Math.max(0, z));
  const i = Math.floor(gx), j = Math.floor(gz), tx = gx - i, tz = gz - j;
  const o = j * nx + i;
  return (data[o] * (1 - tx) + data[o + 1] * tx) * (1 - tz) + (data[o + nx] * (1 - tx) + data[o + nx + 1] * tx) * tz;
}

export function createBaseField(near, far) {
  const nearStep = WORLD.nearStep, farStep = WORLD.farStep, margin = WORLD.farMargin, feather = WORLD.featherDist;
  const w = WORLD.width, d = WORLD.depth;
  function baseHeight(x, z) {
    const edge = Math.min(x, w - x, z, d - z);
    const hf = sampleBicubic(far, (x + margin) / farStep, (z + margin) / farStep);
    if (edge <= 0) return hf;
    const k = edge >= feather ? 1 : smoothstep(0, feather, edge);
    const hn = sampleBicubic(near, x / nearStep, z / nearStep);
    return k >= 1 ? hn : hf + (hn - hf) * k;
  }
  return { baseHeight, near, far };
}
