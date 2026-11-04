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
const FREE_END_RUN = 16;                 // m: the stretch of a way next to a bridge that the DTM cannot be trusted on (the valley edge begins at the abutment)
const FREE_END_WEIGHT = 0.02;            // the weight of a terrain sample there against 1 elsewhere: the profile continues the gradient of the street into the bridge
const TIGHT_END_RUN = 12;                // m: the stretch of a way next to a tunnel mouth that follows the land ...
const TIGHT_END_WEIGHT = 20;             // ... with this weight of a terrain sample against 1 elsewhere (a hard clamp to the land carried the street over the wall of the hillside at the portal: 330 m/s2)
const PIN_WEIGHT = 1e4;                  // the weight of a junction constraint against the weight 1 of a terrain sample

/** Median of a window (a small array, sorted in place). */
function median(values, i, radius) {
  const lo = Math.max(0, i - radius), hi = Math.min(values.length - 1, i + radius);
  const win = [];
  for (let k = lo; k <= hi; k++) win.push(values[k]);
  win.sort((a, b) => a - b);
  return win[win.length >> 1];
}

/** Solves (W + lambda * D'C D) z = W y for a series: D is the second DIVIDED difference (it is zero for any straight slope, whatever the spacing of the
 *  samples), C the mean spacing of the rows, so lambda keeps its meaning of "per sample of ROAD.sampleSpacing" and the penalty does not depend on how the samples
 *  are spaced.  `arc` is the distance of every sample along the way; the samples of a bend are closer than their nominal spacing (2.6 .. 4 m on a way sampled every
 *  4 m), and with the plain difference in index space a straight 22 % slope was a zigzag of 10 cm that the curvature limiter then tried to repair.
 *  The matrix is symmetric and pentadiagonal; it is factorised as L D L' in O(n).  A straight line is a fixed point of the smoother, also at the ends. */
export function whittaker(y, w, lambda, arc = null) {
  const n = y.length;
  if (n < 4) {                                     // too short to have a curvature: a straight line from end to end
    const line = new Float64Array(n);
    for (let i = 0; i < n; i++) line[i] = n > 1 ? y[0] + (y[n - 1] - y[0]) * (i / (n - 1)) : y[0];
    return line;
  }
  // the entries of A = W + lambda * D'C D: main diagonal a0, first off-diagonal a1, second off-diagonal a2
  const a0 = new Float64Array(n), a1 = new Float64Array(n), a2 = new Float64Array(n);
  for (let i = 0; i < n; i++) a0[i] = w[i];
  for (let r = 1; r < n - 1; r++) {                // row r of D: the second divided difference at sample r
    const hl = arc ? Math.max(1e-6, arc[r] - arc[r - 1]) : 1, hr = arc ? Math.max(1e-6, arc[r + 1] - arc[r]) : 1;
    const c = arc ? ((hl + hr) / 2) / ROAD.sampleSpacing : 1;
    const scale = arc ? ROAD.sampleSpacing * ROAD.sampleSpacing : 1;      // (the divided difference has the unit 1/m2: bring it back to the unit of a plain difference)
    const dl = 2 / (hl * (hl + hr)) * scale, dc = -2 / (hl * hr) * scale, dr = 2 / (hr * (hl + hr)) * scale;
    const q = lambda * c;
    a0[r - 1] += q * dl * dl; a0[r] += q * dc * dc; a0[r + 1] += q * dr * dr;
    a1[r - 1] += q * dl * dc; a1[r] += q * dc * dr;
    a2[r - 1] += q * dl * dr;
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
export function limitCurvature(bed, arc, pinned, limit, sweeps = 4000, curvature = Infinity) {
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
      if (pinned && pinned.has(i)) continue;
      // The LOCAL curvature: the 20 m mean below lets a kink through (a change of gradient of 9 % in one sample is only 5 cm from the mean, but it is 4 m/s2 for the car).  A point never lies
      // farther from the line through its two neighbours than a vertical curve of the radius of the class would put it.
      let localExcess = 0, localDev = 0;
      if (curvature < Infinity && i > 0 && i < n - 1) {
        const hl = arc[i] - arc[i - 1], hr = arc[i + 1] - arc[i];
        if (hl > 1e-6 && hr > 1e-6) {
          localDev = cur[i] - (cur[i - 1] * hr + cur[i + 1] * hl) / (hl + hr);
          localExcess = Math.abs(localDev) - (curvature * hl * hr) / 2;
        }
      }
      if (w < MIN_WINDOW) {
        if (localExcess > 0) { next[i] = cur[i] - Math.sign(localDev) * localExcess * LIMIT_GAIN; moved += localExcess; }
        continue;
      }
      while (lo + 1 < n - 1 && arc[lo + 1] <= arc[i] - w) lo++;
      while (hi + 1 < n - 1 && arc[hi + 1] <= arc[i] + w) hi++;
      const mean = (integral(arc[i] + w, hi) - integral(arc[i] - w, lo)) / (2 * w);
      const dev = cur[i] - mean;
      const excess = Math.abs(dev) - limit * (w / LIMIT_METRES) * (w / LIMIT_METRES);   // a shorter window sees a proportionally smaller deviation of the same curvature
      if (localExcess > Math.max(0, excess)) { next[i] = cur[i] - Math.sign(localDev) * localExcess * LIMIT_GAIN; moved += localExcess; }
      else if (excess > 0) { next[i] = cur[i] - Math.sign(dev) * excess * LIMIT_GAIN; moved += excess; }
    }
    [cur, next] = [next, cur];
    if (moved < 1e-6) break;
  }
  return cur;
}

const CLOSED_COPIES = 3;                 // a closed way is designed as this many laps in a row; the middle lap is the bed (no seam, no end effects)

/** The deviation from the 20 m mean that a vertical curve of radius R has at its apex: the mean of x2 / 2R over +-LIMIT_METRES is L2 / 6R with L = LIMIT_METRES. */
export const deviationOf = (radius) => (LIMIT_METRES * LIMIT_METRES) / (6 * radius);

/** The design speed of a class (m/s). */
export const designSpeed = (kind) => (ROAD.bedSpeed[kind] ?? ROAD.bedSpeedDefault) / 3.6;

/** The radius of the tightest vertical curve a way of this class may have (m): the car is lifted by at most bedLift at the design speed. */
export const radiusOf = (kind) => designSpeed(kind) ** 2 / ROAD.bedLift;

/**
 * The bed of a way.  `ground`: the terrain under the samples of the centre line; `arc`: the distance along the way of every sample (m); `pins`: optional Map(sample index -> the height
 * the surface must have there, a junction with a way that is already designed); `kind`: the class of the way (its vertical curves are never tighter than the radius of the class).
 * `ends`: optional { start, end }, what each end of the way meets: 'bridge' (the terrain next to it is a valley edge and counts for little), 'tunnel' (the street follows the land), or null.
 * Returns Float64Array of the heights.
 *
 * `closed`: the last sample is (about) the first (a ring road, a pedestrian square, a loop of a service road).  An open design leaves the two ends at two
 * different levels - a step of up to 2.5 m across the carriageway where the ring closes (measured: Parvis de l'Abbaye) - so a closed way is designed as three laps
 * in a row and the middle lap is kept: the profile is periodic, the seam is as smooth as any other place of the ring, and the last sample takes the level of the first.
 */
export function designBed(ground, arc, pins, closed = false, kind = '', ends = null) {
  const n = ground.length;
  if (!closed || n < 6) return designOpenBed(ground, arc, pins, kind, ends);
  const m = n - 1;                                                       // the last sample repeats the first: one lap is m samples
  const lap = arc[n - 1];                                                // the length of a lap (the last sample is the first again)
  const total = m * CLOSED_COPIES;
  const g = new Float64Array(total), a = new Float64Array(total);
  const wrapPins = pins ? new Map() : null;
  for (let c = 0; c < CLOSED_COPIES; c++) {
    for (let i = 0; i < m; i++) { g[c * m + i] = ground[i]; a[c * m + i] = arc[i] + c * lap; }
    if (pins) for (const [i, h] of pins) wrapPins.set(c * m + (i === n - 1 ? 0 : i), h);   // the pin of the last sample is the pin of the first
  }
  const bed = designOpenBed(g, a, wrapPins, kind);
  const out = new Float64Array(n);
  for (let i = 0; i < m; i++) out[i] = bed[m + i];
  out[n - 1] = out[0];
  return out;
}

/** The stretches of a way next to a bridge (`free`: the terrain there is the edge of a valley, the street does not follow it) and next to a tunnel (`tight`: the
 *  mouth of the tunnel is cut into the hillside at the level of the street, the street follows the land).  `ends` = { start, end }, each 'bridge', 'tunnel' or null. */
function endStretches(arc, ends) {
  const n = arc.length;
  const free = new Uint8Array(n), tight = new Uint8Array(n);
  if (!ends) return { free, tight };
  for (let i = 0; i < n; i++) {
    const fromStart = arc[i] - arc[0], fromEnd = arc[n - 1] - arc[i];
    if (ends.start === 'bridge' && fromStart <= FREE_END_RUN) free[i] = 1;
    if (ends.end === 'bridge' && fromEnd <= FREE_END_RUN) free[i] = 1;
    if (ends.start === 'tunnel' && fromStart <= TIGHT_END_RUN) tight[i] = 1;
    if (ends.end === 'tunnel' && fromEnd <= TIGHT_END_RUN) tight[i] = 1;
  }
  return { free, tight };
}

/** The levels a bed may keep from the land: between `ground - maxCut` and `ground + maxFill`; a pin keeps its level. */
function clampToLand(bed, ground, pins, maxCut, maxFill, stretch) {   // (cut: below the land, fill: above it)
  const out = new Float64Array(bed.length);
  let clamped = false;
  for (let i = 0; i < bed.length; i++) {
    out[i] = pins && pins.has(i) ? pins.get(i) : stretch && stretch.free[i] ? bed[i] : Math.min(ground[i] + maxFill, Math.max(ground[i] - maxCut, bed[i]));
    if (out[i] !== bed[i]) clamped = true;
  }
  return { bed: out, clamped };
}

/**
 * A street is cut through a crest and filled in a sag; it does not follow them.  Two demands pull against each other: a vertical curve never tighter than the
 * radius of the class (the car is not thrown), and a cutting or an embankment that is no deeper than bedMaxCut / bedMaxFill (a street is not a trench and
 * not a dam).  The bed is the Whittaker fit of the land, then alternately projected on one demand and the other (the two sets are convex, so the rounds converge on a profile
 * that has both wherever one exists).  Where none does (a cliff beside the road, a wall of the DTM) the curvature limit wins - a smooth street 3 m below the
 * crest is better than a street that follows a spike - but never by more than bedHardLimit.
 */
function designOpenBed(ground, arc, pins, kind, ends) {
  const n = ground.length;
  const w = new Float64Array(n).fill(1);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = median(ground, i, SPIKE_WINDOW);
  const stretch = endStretches(arc, ends);
  for (let i = 0; i < n; i++) {
    if (stretch.free[i]) w[i] = FREE_END_WEIGHT;                // (a bridge abutment: the DTM drops into the valley there, the street does not)
    else if (stretch.tight[i]) w[i] = TIGHT_END_WEIGHT;         // (a tunnel mouth: the street arrives at the level of the hillside it enters)
  }
  if (pins) for (const [i, h] of pins) { w[i] = PIN_WEIGHT; y[i] = h; }
  const limit = deviationOf(radiusOf(kind));
  const curvature = 1 / radiusOf(kind);
  let bed = whittaker(y, w, ROAD.bedStiffness, arc);
  for (let round = 0; round < ROAD.bedRounds; round++) {
    const clamped = clampToLand(limitCurvature(bed, arc, pins, limit, 4000, curvature), ground, pins, ROAD.bedMaxCut, ROAD.bedMaxFill, stretch);
    bed = clamped.bed;
    if (!clamped.clamped) break;
  }
  return clampToLand(limitCurvature(bed, arc, pins, limit, 4000, curvature), ground, pins, ROAD.bedHardCut, ROAD.bedHardFill).bed;
}

/** The slope of the bed at every sample (m per m along the way): the central difference, one-sided at the two ends.  The surface between two samples is the cubic
 *  Hermite curve through their heights and slopes (`hermite`), so the profile has no kinks at the samples: a linear interpolation put the whole change of slope of
 *  a vertical curve into the samples 4 m apart, twice the lift of the curve at every one of them. */
export function bedSlopes(bed, arc) {
  const n = bed.length;
  const slope = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    slope[k] = b > a ? (bed[b] - bed[a]) / Math.max(1e-6, arc[b] - arc[a]) : 0;
  }
  return slope;
}

/** The height of the cubic Hermite curve between two samples at t (0 .. 1): heights b0 and b1, tangents tan0 and tan1 (slope times the length of the segment). */
export function hermite(b0, b1, tan0, tan1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * b0 + (t3 - 2 * t2 + t) * tan0 + (3 * t2 - 2 * t3) * b1 + (t3 - t2) * tan1;
}

/** The height of the bed of a chain at the distance d along it (the same curve the carve uses). */
export function bedAtArc(chain, d) {
  const { arc, bed } = chain;
  const slope = chain.slope || (chain.slope = bedSlopes(bed, arc));
  let k = 0;
  while (k < arc.length - 2 && arc[k + 1] < d) k++;
  const len = Math.max(1e-9, arc[k + 1] - arc[k]);
  return hermite(bed[k], bed[k + 1], slope[k] * len, slope[k + 1] * len, Math.min(1, Math.max(0, (d - arc[k]) / len)));
}
