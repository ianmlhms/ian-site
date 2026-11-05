/* The surface of a junction: one smooth sheet where carved ways meet at one level.
 *
 * Every way is a surface of its own (its bed, flat across), and the carve lays them over one another in the order of their rank
 * (road-network.js).  Where they meet, that layering hands the surface from one way to the next within half a metre (OWN_FADE), the
 * ground between two carriageways a metre apart sinks to the land, and the end of a way stops pinning the ground while its tarmac is
 * still painted.  A driver crossing a junction felt every one of those: dips of 4 .. 13 cm within a metre (5 m/s2 at 50 km/h, the
 * median of the 20 biggest junctions; a plain road is 0.04).
 *
 * Here the junction gets ONE surface: at every point where two ways touch (a junction pin of road-network.js reconcileJunctions) a
 * plane is fitted to the beds of the ways around it (least squares over their centre line samples within FIT_RADIUS, wider ways
 * counting more, a soft wish that every way is flat across, so a single way does not tilt), and the junction surface at a point is the
 * Gaussian blend of the planes of the contact points around it.  A blend of planes that agree is a plane; where they disagree a little
 * the blend bends over SIGMA metres, never within one.  The carve pulls the carriageways of the ways at that level onto this sheet with
 * the weight `weight` (1 in the junction, gone ~2 SIGMA away), so a way runs from its own bed onto the sheet and back gently.
 *
 * Pure (no THREE): built once from the chains, queried by the carve. */

const MAX_GRADE = 0.35;               // the steepest street of the city (Pafendaller Bierg, Clausener Bierg: 30 %)

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const JUNCTION_SURFACE = Object.freeze({
  sigma: 6.0,          // m: the Gaussian of the blend of the planes (the hand-over from a way's own bed to the sheet runs over ~2 sigma)
  cutoff: 3.0,         // sigmas: a plane farther than this does not count
  fitRadius: 14.0,     // m: the centre line samples within this of a contact point shape its plane ...
  fitSigma: 8.0,       // m: ... weighted by a Gaussian of this width
  crossWeight: 0.3,    // the wish that a way is flat across, against 1 for its level (a lone way gives no tilt across; two crossing ways tilt it)
  ridge: 1e-3,         // a tiny pull of the gradient to zero (a fit from one sample)
  levelTol: 0.6,       // m: only the ways at the level of the contact (within this) shape its plane (a flyover beside it does not)
  dedupe: 2.0,         // m: contact points closer than this are one
  cell: 24,            // m: the spatial hash of the planes
  goodFit: 0.10,       // m: a plane whose weighted rms distance from the beds it was fitted to is below this counts fully ...
  poorFit: 0.30,       // m: ... and one above this not at all
});

/** Solves the symmetric 3 x 3 system A x = b (row-major array of 9).  Returns [x0, x1, x2] or null when singular. */
function solve3(A, b) {
  const [a, bb, c, , e, f, , , i] = A;
  const d = A[3], g = A[6], h = A[7];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e * i - f * h), -(bb * i - c * h), (bb * f - c * e),
    -(d * i - f * g), (a * i - c * g), -(a * f - c * d),
    (d * h - e * g), -(a * h - bb * g), (a * e - bb * d),
  ];
  return [0, 1, 2].map((r) => (inv[r * 3] * b[0] + inv[r * 3 + 1] * b[1] + inv[r * 3 + 2] * b[2]) / det);
}

/**
 * chains: the carved ways of road-network.js ({ road, x, z, bed, pins: Map(sample -> level) }), `skip(chain)`: true for a way that is not
 * carved at its level (it rides over the others), `hwOf(chain)`: the half width of its carriageway.
 * Returns { count, sample(x, z, out) } where sample writes out.level (the sheet) and out.weight (0 .. 1: how much of a junction this is).
 */
export function createJunctionSurface(chains, skip, hwOf, opts = JUNCTION_SURFACE) {
  const live = chains.filter((c) => !skip(c));
  // ---- the centre line samples of every way, in a grid (for the fits)
  const SG = opts.fitRadius;
  const skey = (cx, cz) => cx * 65536 + cz;
  const sgrid = new Map();
  for (const c of live) {
    const n = c.x.length;
    for (let k = 0; k < n; k++) {
      const kk = skey(Math.floor(c.x[k] / SG), Math.floor(c.z[k] / SG));
      const l = sgrid.get(kk);
      if (l) l.push(c, k); else sgrid.set(kk, [c, k]);
    }
  }
  // ---- the contact points (deduplicated on a small grid, per level)
  const seen = new Set();
  const px = [], pz = [], ph = [];
  for (const c of live) {
    for (const [k, level] of c.pins || []) {
      const x = c.x[k], z = c.z[k];
      const key = `${Math.round(x / opts.dedupe)},${Math.round(z / opts.dedupe)},${Math.round(level / opts.levelTol)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      px.push(x); pz.push(z); ph.push(level);
    }
  }
  // ---- one plane per contact point: least squares of the beds around it
  const n = px.length;
  const H0 = new Float32Array(n), GX = new Float32Array(n), GZ = new Float32Array(n), Q = new Float32Array(n);
  const PX = Float64Array.from(px), PZ = Float64Array.from(pz);
  const fit2 = opts.fitRadius * opts.fitRadius, fs2 = 2 * opts.fitSigma * opts.fitSigma;
  /** The weighted least squares plane of the beds around contact p; `accept(c, k, ex, ez)` says which samples count.  Returns [h0, gx, gz] or null. */
  function eachSample(p, accept, fn) {
    const cx = Math.floor(PX[p] / SG), cz = Math.floor(PZ[p] / SG);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = sgrid.get(skey(cx + dx, cz + dz));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 2) {
          const c = l[q], k = l[q + 1];
          const ex = c.x[k] - PX[p], ez = c.z[k] - PZ[p];
          const d2 = ex * ex + ez * ez;
          if (d2 > fit2 || !accept(c, k, ex, ez)) continue;
          fn(c, k, ex, ez, Math.exp(-d2 / fs2) * hwOf(c));
        }
      }
    }
  }
  function fitPlane(p, accept) {
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
    const add = (r0, r1, r2, y, w) => {
      A[0] += w * r0 * r0; A[1] += w * r0 * r1; A[2] += w * r0 * r2;
      A[4] += w * r1 * r1; A[5] += w * r1 * r2; A[8] += w * r2 * r2;
      b[0] += w * r0 * y; b[1] += w * r1 * y; b[2] += w * r2 * y;
    };
    eachSample(p, accept, (c, k, ex, ez, w) => {
      add(1, ex, ez, c.bed[k], w);
      // flat across the way at this sample (its normal in the plane)
      const a = Math.max(0, k - 1), bI = Math.min(c.x.length - 1, k + 1);
      const tx = c.x[bI] - c.x[a], tz = c.z[bI] - c.z[a];
      const tl = Math.hypot(tx, tz) || 1;
      add(0, -tz / tl, tx / tl, 0, w * opts.crossWeight);
    });
    if (A[0] <= 0) return null;
    A[4] += opts.ridge; A[8] += opts.ridge;
    A[3] = A[1]; A[6] = A[2]; A[7] = A[5];
    return solve3(A, b);
  }
  for (let p = 0; p < n; p++) {
    // first the samples whose level a street of up to MAX_GRADE could reach from the contact, then only those that lie on that first plane (a flyover or a cutting
    // beside the junction is not part of it; a steep street is: a fixed level window around the contact kept only 2 m of a street of 30 %)
    const first = fitPlane(p, (c, k, ex, ez) => Math.abs(c.bed[k] - ph[p]) <= opts.levelTol + MAX_GRADE * Math.hypot(ex, ez));
    const sol = first && fitPlane(p, (c, k, ex, ez) => Math.abs(c.bed[k] - (first[0] + first[1] * ex + first[2] * ez)) <= opts.levelTol);
    if (sol) { H0[p] = sol[0]; GX[p] = sol[1]; GZ[p] = sol[2]; } else { H0[p] = ph[p]; GX[p] = 0; GZ[p] = 0; }
    // how well the plane holds the beds of the ways it shapes (all samples whose level is near the contact): a junction of ways at a slight angle in the steep
    // old town is no plane, and a sheet 30 cm off a carriageway would lift it.  A poor plane counts less and the layered beds keep the junction there.
    let r2 = 0, rw = 0;
    eachSample(p, (c, k) => Math.abs(c.bed[k] - ph[p]) <= opts.levelTol + MAX_GRADE * Math.hypot(c.x[k] - PX[p], c.z[k] - PZ[p]), (c, k, ex, ez, w) => {
      const r = c.bed[k] - (H0[p] + GX[p] * ex + GZ[p] * ez);
      r2 += w * r * r; rw += w;
    });
    const rms = rw > 0 ? Math.sqrt(r2 / rw) : 0;
    Q[p] = 1 - smoothstep(opts.goodFit, opts.poorFit, rms);
  }
  // ---- the spatial hash of the planes
  const C = opts.cell;
  const ckey = (cx, cz) => cx * 65536 + cz;
  const buckets = new Map();
  for (let p = 0; p < n; p++) {
    const kk = ckey(Math.floor(PX[p] / C), Math.floor(PZ[p] / C));
    const l = buckets.get(kk);
    if (l) l.push(p); else buckets.set(kk, [p]);
  }
  const cells = new Map();
  for (const [k, l] of buckets) cells.set(k, Int32Array.from(l));
  const reach = opts.sigma * opts.cutoff, reach2 = reach * reach, s2 = 2 * opts.sigma * opts.sigma;
  const span = Math.ceil(reach / C);

  /** The junction sheet at (x, z): out.level and out.weight (0: no junction near). */
  function sample(x, z, out) {
    let wSum = 0, hSum = 0;
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const l = cells.get(ckey(cx + dx, cz + dz));
        if (!l) continue;
        for (let q = 0; q < l.length; q++) {
          const p = l[q];
          const ex = x - PX[p], ez = z - PZ[p];
          const d2 = ex * ex + ez * ez;
          if (d2 > reach2) continue;
          const w = Q[p] * Math.exp(-d2 / s2);
          wSum += w; hSum += w * (H0[p] + GX[p] * ex + GZ[p] * ez);
        }
      }
    }
    out.weight = wSum > 1 ? 1 : wSum;
    out.level = wSum > 0 ? hSum / wSum : 0;
    return out;
  }

  return { count: n, sample, planes: { x: PX, z: PZ, h: H0, gx: GX, gz: GZ, q: Q } };
}
