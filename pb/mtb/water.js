/* Water ribbons: built from the SAME samples that carve the channels (trails.js), so the water always lies in its channel. Pure (typed arrays).
 * A stream way gives a strip along its centre line: three vertices across (left bank, middle, right bank), the surface level = the carved bed + the water depth.
 * The strip is a little wider than the flat bed, so its edges disappear under the banks (the terrain is higher there). One chunk per 512 m world block. */
import { WORLD, WAY_KINDS } from './config.js';

const WATER_CHUNK = 192;           // m (see below).            // m: ribbons are chunked finely, so frustum culling drops the water behind the camera (a 512 m chunk was ~100 k triangles in view)
const BANK_EXTRA = 0.5;            // m the strip reaches under the bank on each side
const FADE_LENGTH = 6;             // m at the ends of a stream where the water fades in / out
export const WATER_KINDS = ['stream', 'river', 'ditch'];

/** `skip` (optional { lo, hi }): sample indices whose segments are not drawn (the cascade landmark brings its own water). Returns [{ bx, bz, positions, normals, aux, indices, vertexCount }] chunks. aux = (lateral -1..1, metres along the flow, slope 0..1 (drop per metre * 2), end fade 0..1). */
export function buildWaterChunks(network, skip = null) {
  const S = network.samples;
  const chunks = new Map();
  const chunkOf = (x, z) => {
    const bx = Math.floor(x / WATER_CHUNK), bz = Math.floor(z / WATER_CHUNK), key = bx * 1000 + bz;
    let c = chunks.get(key);
    if (!c) { c = { bx, bz, pos: [], nor: [], aux: [], idx: [] }; chunks.set(key, c); }
    return c;
  };
  for (const info of network.ways) {
    if (!WATER_KINDS.includes(info.kind)) continue;
    const kind = WAY_KINDS[info.kind];
    const n = info.count, f = info.first;
    if (n < 2) continue;
    const half = kind.halfWidth + BANK_EXTRA;
    const total = S.s[f + n - 1] - S.s[f];
    const y = (i) => S.water[f + i];
    for (let i = 0; i < n - 1; i++) {
      const a = f + i, b = f + i + 1;
      if (skip && a >= skip.lo && b <= skip.hi) continue;                     // replaced by the water of a landmark (cascade.js)
      const mx = (S.px[a] + S.px[b]) / 2, mz = (S.pz[a] + S.pz[b]) / 2;
      const c = chunkOf(mx, mz);
      const base = c.pos.length / 3;
      for (const [k, idx] of [[a, i], [b, i + 1]]) {
        const slopeSrc = Math.min(n - 2, Math.max(0, idx));
        const drop = Math.max(0, (y(slopeSrc) - y(slopeSrc + 1)) / Math.max(0.2, S.s[f + slopeSrc + 1] - S.s[f + slopeSrc]));
        const dy = Math.min(2, Math.max(0, drop));
        const along = S.s[k] - S.s[f];
        const fade = Math.min(1, Math.min(along, total - along) / FADE_LENGTH);
        // tangent -> surface normal tilted by the slope
        const tx = -S.nz[k], tz = S.nx[k];
        const slopeLen = Math.hypot(1, dy);
        const nyv = 1 / slopeLen, nh = dy / slopeLen;
        for (const side of [-1, 0, 1]) {
          const w = side * half;
          c.pos.push(S.px[k] + S.nx[k] * w, S.water[k], S.pz[k] + S.nz[k] * w);
          c.nor.push(tx * nh, nyv, tz * nh);
          c.aux.push(side, along, Math.min(1, dy * 2), fade);
        }
      }
      for (let q = 0; q < 2; q++) {
        const p0 = base + q, p1 = base + q + 1, p2 = base + 3 + q, p3 = base + 3 + q + 1;
        c.idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
  }
  return [...chunks.values()].map((c) => ({ bx: c.bx, bz: c.bz, positions: Float32Array.from(c.pos), normals: Float32Array.from(c.nor), aux: Float32Array.from(c.aux), indices: Uint32Array.from(c.idx), vertexCount: c.pos.length / 3 }));
}

const FALL_MIN_DROP = 0.35;        // m of water level between two neighbouring samples that makes a waterfall

/** Waterfalls: runs of steep samples along a stream become vertical curtains. Returns [{ x, z, nx, nz, fx, fz, top, bottom, width }] (nx, nz = across the stream, fx, fz = the flow direction). */
export function findFalls(network) {
  const S = network.samples;
  const falls = [];
  for (const info of network.ways) {
    if (!WATER_KINDS.includes(info.kind)) continue;
    const kind = WAY_KINDS[info.kind];
    const dir = S.water[info.first] >= S.water[info.first + info.count - 1] ? 1 : -1;       // +1: the flow runs along the way
    let i = info.first;
    while (i < info.first + info.count - 1) {
      const a = dir > 0 ? i : i + 1, b = dir > 0 ? i + 1 : i;                                // a upstream, b downstream
      if (S.water[a] - S.water[b] >= FALL_MIN_DROP) {
        let j = i + 1;
        let top = S.water[a], bottom = S.water[b], last = b;
        while (j < info.first + info.count - 1) {
          const a2 = dir > 0 ? j : j + 1, b2 = dir > 0 ? j + 1 : j;
          if (S.water[a2] - S.water[b2] < FALL_MIN_DROP * 0.5) break;
          bottom = S.water[b2]; last = b2; j++;
        }
        const mid = Math.round((a + last) / 2);
        falls.push({ x: S.px[mid], z: S.pz[mid], nx: S.nx[mid], nz: S.nz[mid], fx: -S.nz[mid] * dir, fz: S.nx[mid] * dir, top, bottom, width: (kind.halfWidth + 0.3) * 2 });
        i = j;
      } else i++;
    }
  }
  return falls;
}
