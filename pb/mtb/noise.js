/* Small deterministic noise helpers (pure, shared by terrain micro relief, tree placement and the harness). */

/** 32-bit integer hash -> [0, 1). */
export function hash2(ix, iz, seed = 0) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

/** Fractal noise in [-1, 1], `octaves` octaves starting at `scale` metres. */
export function fbm(x, z, scale, octaves, seed = 0) {
  let amp = 1, sum = 0, norm = 0, f = 1 / scale;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * f, z * f, seed + o * 31) * 2 - 1) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

/** Small seeded PRNG (mulberry32). */
export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
