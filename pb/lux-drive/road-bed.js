/* The bed of a road: the long profile of its surface, designed like a street engineer would draw it.
 *
 * The LiDAR terrain under a street is noisy at exactly the scale a driver feels: parked cars, kerbs, the DTM under trees,
 * terraces of the houses.  A Gaussian of a few metres (the first version) leaves waves of 10 .. 30 m in the profile, and a
 * Gaussian pulls the ends of a steep street into the hill.  A real street is the opposite: straight gradients joined by long
 * gentle vertical curves.  So the bed is the PENALISED LEAST SQUARES fit of the terrain with a penalty on the second
 * difference (a Whittaker smoother): a straight slope passes through unchanged - also at the ends of the way, where a
 * Gaussian is biased - and everything wavier than a vertical curve is taken out.
 *
 * Junctions: where a way meets a way that was designed before it (a higher class), its profile is pulled onto the profile
 * of that way at the meeting point with a heavy weight, so the crossing is one level surface and the side street arrives
 * smoothly instead of with a hump.
 *
 * Pure functions (typed arrays), shared by the game and the Node harness. */
import { ROAD } from './config.js';

const SPIKE_WINDOW = 1;                  // samples each side of the median that removes single-sample spikes (a parked car in the DTM)
const LIMIT_METRES = 10;                 // m each side of a point for the curvature limit (the 20 m moving mean of the gate)
const MIN_WINDOW = 2;                    // m: no limit where the way is shorter than this on one side (its end)
const LIMIT_GAIN = 0.8;                  // the share of the excess one sweep removes (below 1: the sweeps converge)
const PIN_WEIGHT = 1e4;                  // the weight of a junction constraint against the weight 1 of a terrain sample

/** Median of a window (a small array, sorted in place). */
function median(values, i, radius) {
  const lo = Math.max(0, i - radius), hi = Math.min(values.length - 1, i + radius);
  const win = [];
  for (let k = lo; k <= hi; k++) win.push(values[k]);
  win.sort((a, b) => a - b);
  return win[win.length >> 1];
}

/** Solves (W + lambda * D'D) z = W y for a series: D is the second difference.  The matrix is symmetric and pentadiagonal; it is
 *  factorised as L D L' in O(n).  A straight line is a fixed point of the smoother (D line = 0), also at the ends. */
export function whittaker(y, w, lambda) {
  const n = y.length;
  if (n < 4) {                                     // too short to have a curvature: a straight line from end to end
    const line = new Float64Array(n);
    for (let i = 0; i < n; i++) line[i] = n > 1 ? y[0] + (y[n - 1] - y[0]) * (i / (n - 1)) : y[0];
    return line;
  }
  // the entries of A = W + lambda * D'D: main diagonal a0, first off-diagonal a1, second off-diagonal a2
  const a0 = new Float64Array(n), a1 = new Float64Array(n), a2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = i === 0 || i === n - 1 ? 1 : i === 1 || i === n - 2 ? 5 : 6;
    a0[i] = w[i] + lambda * m;
    if (i < n - 1) a1[i] = lambda * (i === 0 || i === n - 2 ? -2 : -4);
    if (i < n - 2) a2[i] = lambda;
  }
  const d = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i >= 2) l2[i] = a2[i - 2] / d[i - 2];
    if (i >= 1) l1[i] = (a1[i - 1] - (i >= 2 ? l2[i] * l1[i - 1] * d[i - 2] : 0)) / d[i - 1];
    d[i] = a0[i] - (i >= 1 ? l1[i] * l1[i] * d[i - 1] : 0) - (i >= 2 ? l2[i] * l2[i] * d[i - 2] : 0);
  }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = w[i] * y[i] - (i >= 1 ? l1[i] * z[i - 1] : 0) - (i >= 2 ? l2[i] * z[i - 2] : 0);
  for (let i = 0; i < n; i++) z[i] /= d[i];
  for (let i = n - 1; i >= 0; i--) z[i] -= (i + 1 < n ? l1[i + 1] * z[i + 1] : 0) + (i + 2 < n ? l2[i + 2] * z[i + 2] : 0);
  return z;
}

/** A street engineer limits the curvature of the long profile: a vertical curve is never tighter than the comfort of the driver allows.
 *  The measure is the very one of the harness gate: the deviation of the profile at a point from its MEAN over the 20 m around it
 *  (the integral of the profile, which is linear between the samples, over +-LIMIT_METRES; a window next to an end of the way is
 *  balanced, so a straight slope is never a deviation).  Where it exceeds `limit` the point is pulled toward the mean by the excess.
 *  A junction pin never moves (the free points around it give way).  Jacobi sweeps, so the result does not depend on the direction
 *  of the way.  The window is measured in METRES: the samples of a bend are closer than their nominal spacing, and a window counted
 *  in samples would see a straight slope as a curve (it bent the steep tracks it was meant to keep straight). */
export function limitCurvature(bed, arc, pinned, limit, sweeps = 4000) {
  const n = bed.length;
  if (n < 3) return bed;
  let cur = Float64Array.from(bed);
  let next = new Float64Array(n);
  const cum = new Float64Array(n);                              // the integral of the profile from the first sample to sample k
  const half = new Float64Array(n);                             // the balanced half window of every point (m)
  for (let i = 0; i < n; i++) half[i] = Math.min(LIMIT_METRES, arc[i] - arc[0], arc[n - 1] - arc[i]);
  /** The integral of the profile (linear between the samples) from the start to the arc position s; `k` is a hint (a sample at or before s). */
  const integral = (s, k) => {
    while (k + 1 < n - 1 && arc[k + 1] <= s) k++;
    const len = arc[k + 1] - arc[k];
    const u = s - arc[k];
    const slope = len > 1e-9 ? (cur[k + 1] - cur[k]) / len : 0;
    return cum[k] + cur[k] * u + 0.5 * slope * u * u;
  };
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + 0.5 * (cur[k - 1] + cur[k]) * (arc[k] - arc[k - 1]);
    let moved = 0;
    let lo = 0, hi = 0;                                         // sample hints for the window ends (they only move forward)
    for (let i = 0; i < n; i++) {
      next[i] = cur[i];
      const w = half[i];
      if (w < MIN_WINDOW || (pinned && pinned.has(i))) continue;
      while (lo + 1 < n - 1 && arc[lo + 1] <= arc[i] - w) lo++;
      while (hi + 1 < n - 1 && arc[hi + 1] <= arc[i] + w) hi++;
      const mean = (integral(arc[i] + w, hi) - integral(arc[i] - w, lo)) / (2 * w);
      const dev = cur[i] - mean;
      const excess = Math.abs(dev) - limit * (w / LIMIT_METRES) * (w / LIMIT_METRES);   // a shorter window sees a proportionally smaller deviation of the same curvature
      if (excess > 0) { next[i] = cur[i] - Math.sign(dev) * excess * LIMIT_GAIN; moved += excess; }
    }
    [cur, next] = [next, cur];
    if (moved < 1e-6) break;
  }
  return cur;
}

/**
 * The bed of a way.  `ground`: the terrain under the samples of the centre line; `arc`: the distance along the way of every sample (m); `pins`: optional Map(sample index -> the height
 * the surface must have there, a junction with a way that is already designed).  Returns Float64Array of the heights.
 */
export function designBed(ground, arc, pins) {
  const n = ground.length;
  const w = new Float64Array(n).fill(1);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = median(ground, i, SPIKE_WINDOW);
  if (pins) for (const [i, h] of pins) { w[i] = PIN_WEIGHT; y[i] = h; }
  let bed = whittaker(y, w, ROAD.bedStiffness);
  // a street must not leave the land by more than bedClamp (it would cut a trench into a hill or stand on a wall): clamp, then
  // round the kinks the clamp made with a lighter pass
  let clamped = false;
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = ground[i] - ROAD.bedClamp, hi = ground[i] + ROAD.bedClamp;
    c[i] = pins && pins.has(i) ? pins.get(i) : Math.min(hi, Math.max(lo, bed[i]));
    if (c[i] !== bed[i]) clamped = true;
  }
  if (clamped) bed = whittaker(c, w, ROAD.bedStiffness * ROAD.bedRelax);
  return limitCurvature(bed, arc, pins, ROAD.bedDeviation);
}
