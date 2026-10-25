/* The way network (trails, paths, forest tracks, roads) carved INTO the terrain.
 *
 * There is no ribbon: a way is a set of samples every 1-2 m along its centre line, each with a bed height, a cross tilt and a berm.
 * carve(x, z) mixes the terrain towards the bed with a coverage c that is 1 on the flat bed and fades to 0 at the way's outer width:
 *      height = base * (1 - c) + bed * c
 * Every sample contributes with a smooth kernel, and the contributions are SUMMED (not "nearest wins"), so the result is continuous
 * where two ways cross, where one bends back on itself (hairpins) and where a way ends. That is the reason there are no steps or
 * holes at junctions. Pure functions: the same code feeds the render mesh, the physics lattice and the Node harness. */
import { CARVE, WAY_KINDS } from './config.js';
import { valueNoise } from './noise.js';

const CELL = 8;                                   // spatial hash cell (m); the biggest kernel radius is below CELL
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Resamples a polyline (array of [x, z]) every `spacing` m, keeping its shape. Returns { x: number[], z: number[] }. */
export function resample(points, spacing) {
  const xs = [points[0][0]], zs = [points[0][1]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let ax = points[i - 1][0], az = points[i - 1][1];
    const bx = points[i][0], bz = points[i][1];
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= spacing) {
      const k = (spacing - carry) / seg;
      ax += (bx - ax) * k; az += (bz - az) * k;
      xs.push(ax); zs.push(az);
      seg = Math.hypot(bx - ax, bz - az);
      carry = 0;
    }
    carry += seg;
  }
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - xs[xs.length - 1], last[1] - zs[zs.length - 1]) > spacing * 0.35) { xs.push(last[0]); zs.push(last[1]); }
  return { x: xs, z: zs };
}

function gaussianSmooth(values, sigmaSamples) {
  const n = values.length;
  const radius = Math.max(1, Math.ceil(sigmaSamples * 2.5));
  const kernel = [];
  let total = 0;
  for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)); kernel.push(w); total += w; }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;                 // renormalised at the ends: a way's end keeps the terrain height there
      const w = kernel[k + radius];
      sum += values[j] * w; wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

/** The bed of a water channel: the smoothed ground minus the channel depth, never rising along the flow (the way direction is the flow direction;
 *  a way that climbs overall is read backwards). `cascade` (optional { index, count, steps, pool }): a stretch of `count` samples around sample `index` becomes a
 *  staircase of `steps` drops with plunge pools: the height lost over the stretch is redistributed into sharp steps, so the ends of the stretch keep the terrain
 *  level (no trench downstream, no dam upstream). */
export function channelBed(smoothed, depth, cascade) {
  const n = smoothed.length;
  const down = smoothed[0] >= smoothed[n - 1];
  const order = down ? [...smoothed.keys()] : [...smoothed.keys()].reverse();
  const out = new Array(n);
  let level = Infinity;
  for (const i of order) { level = Math.min(level, smoothed[i] - depth); out[i] = level; }
  if (cascade) {
    const half = Math.floor(cascade.count / 2);
    const lo = Math.max(0, cascade.index - half), hi = Math.min(n - 1, cascade.index + half);
    // `lo..hi` runs in index order; the flow runs from the higher end to the lower one
    const top = down ? lo : hi, bottom = down ? hi : lo;
    const hTop = out[top], hBottom = out[bottom];
    const k = cascade.steps;
    for (let i = lo; i <= hi; i++) {
      const t = Math.abs(i - top) / Math.max(1, Math.abs(bottom - top));            // 0 at the top of the cascade, 1 at its foot
      const u = t * k, fl = Math.min(k - 1, Math.floor(u)), fr = u - fl;
      const sm = Math.min(1, Math.max(0, (fr - 0.8) / 0.13));
      const stairs = (fl + sm * sm * (3 - 2 * sm)) / k;
      // plunge pool below every drop
      const pool = cascade.pool * Math.exp(-Math.pow((fr - 0.05) * (hi - lo) / k / 1.2, 2)) * (fl > 0 || fr > 0.7 ? 1 : 0);
      out[i] = hTop + (hBottom - hTop) * stairs - pool * 0;
    }
  }
  return out;
}

/**
 * ways: [{ id, kind: 'trail'|'path'|'track'|'road', pts: [[x, z], ...] }]
 * baseHeight(x, z): the terrain without any way.
 */
export function createTrailNetwork(ways, baseHeight) {
  const px = [], pz = [], bed = [], tilt = [], nxArr = [], nzArr = [], berm = [], side = [], rad = [], inv = [], wayOf = [], sOf = [], water = [], isStream = [];
  const wayInfo = [];
  for (let wi = 0; wi < ways.length; wi++) {
    const way = ways[wi];
    const kind = WAY_KINDS[way.kind];
    if (!kind || !way.pts || way.pts.length < 2) continue;
    const rs = resample(way.pts, kind.spacing);
    const n = rs.x.length;
    if (n < 2) continue;
    if (n > 4) {                                   // round the corners of the (sparse) OSM polyline; the two end points stay where they are
      const sx = gaussianSmooth(rs.x, CARVE.lineSmoothing / kind.spacing), sz = gaussianSmooth(rs.z, CARVE.lineSmoothing / kind.spacing);
      for (let i = 1; i < n - 1; i++) { rs.x[i] = sx[i]; rs.z[i] = sz[i]; }
    }
    const tx = new Array(n), tz = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = rs.x[b] - rs.x[a], dz = rs.z[b] - rs.z[a];
      const len = Math.hypot(dx, dz) || 1;
      tx[i] = dx / len; tz[i] = dz / len;
    }
    const nxs = tz.map((v) => v), nzs = tx.map((v) => -v);                 // normal = (tz, -tx)
    const ground = rs.x.map((x, i) => baseHeight(x, rs.z[i]));
    let bedH = gaussianSmooth(ground, CARVE.bedSmoothing / kind.spacing);
    if (kind.flow) {
      let cascade = null;
      if (way.cascade) {                                       // { x, z, length, steps, pool }: where the stream is a staircase of falls
        let best = 0, bd = 1e18;
        for (let i = 0; i < n; i++) { const d = (rs.x[i] - way.cascade.x) ** 2 + (rs.z[i] - way.cascade.z) ** 2; if (d < bd) { bd = d; best = i; } }
        if (bd < 25 * 25) cascade = { index: best, count: Math.round(way.cascade.length / kind.spacing), steps: way.cascade.steps, pool: way.cascade.pool || 0 };
      }
      bedH = channelBed(bedH, kind.depth, cascade);
    }
    // signed curvature (1/m): heading change per metre, smoothed over about +-4 m
    const heading = tx.map((v, i) => Math.atan2(tz[i], v));
    const turn = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      let dh = heading[i + 1] - heading[i - 1];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      turn[i] = dh / (2 * kind.spacing);
    }
    const kappa = gaussianSmooth(turn, 3 / kind.spacing);
    // cross slope of the terrain across the way (rise per m towards +normal), smoothed
    const cross = rs.x.map((x, i) => (baseHeight(x + nxs[i] * 1.5, rs.z[i] + nzs[i] * 1.5) - baseHeight(x - nxs[i] * 1.5, rs.z[i] - nzs[i] * 1.5)) / 3);
    const crossS = gaussianSmooth(cross, 3 / kind.spacing);
    const radius = kind.width * CARVE.kernelRadiusFactor;
    const sref = radius * (32 / 35);
    let sAlong = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) sAlong += Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]);
      px.push(rs.x[i]); pz.push(rs.z[i]);
      bed.push(kind.flow ? bedH[i] - 0.14 * (valueNoise(sAlong * 0.35, wi * 1.7, 9) - 0.4) * Math.min(1, kind.depth * 2) : bedH[i]);       // pools and riffles in the bed (the water surface stays level, see below)
      const bank = kind.berm ? Math.max(-CARVE.tiltMax, Math.min(CARVE.tiltMax, kappa[i] * 3.2)) : 0;     // banked towards the centre of the turn
      const half = Math.max(-CARVE.tiltMax, Math.min(CARVE.tiltMax, crossS[i] * (kind.tiltScale === undefined ? 0.5 : kind.tiltScale)));       // half-bench on a side hill (a channel follows the slope only a little)
      tilt.push(Math.max(-CARVE.tiltMax, Math.min(CARVE.tiltMax, half + bank)));
      nxArr.push(nxs[i]); nzArr.push(nzs[i]);
      const k = kind.berm ? Math.min(1, Math.abs(kappa[i]) / CARVE.bermCurvature) : 0;
      berm.push(k * CARVE.bermHeight);
      side.push(kappa[i] > 0 ? 1 : -1);          // the berm stands on the OUTSIDE of the turn (normal = left of travel; kappa > 0 turns right)
      rad.push(kind.flow ? radius * (0.72 + 0.55 * valueNoise(sAlong * 0.09, wi * 3.1, 5)) : radius);                // a natural channel is not a canal: it widens and narrows
      inv.push(kind.spacing / sref);
      wayOf.push(wi);
      sOf.push(sAlong);
      water.push(kind.flow ? bedH[i] + kind.waterDepth : NaN);
      isStream.push(kind.flow ? 1 : 0);
    }
    wayInfo.push({ id: way.id, kind: way.kind, first: px.length - n, count: n });
  }
  const count = px.length;
  const P = { px: Float32Array.from(px), pz: Float32Array.from(pz), bed: Float32Array.from(bed), tilt: Float32Array.from(tilt), nx: Float32Array.from(nxArr), nz: Float32Array.from(nzArr), berm: Float32Array.from(berm), side: Int8Array.from(side), rad: Float32Array.from(rad), inv: Float32Array.from(inv), way: Int32Array.from(wayOf), s: Float32Array.from(sOf), water: Float32Array.from(water), stream: Uint8Array.from(isStream) };

  // spatial hash (CSR): cell -> sample indices
  const cellOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const key = cellOf(P.px[i], P.pz[i]);
    const list = buckets.get(key);
    if (list) list.push(i); else buckets.set(key, [i]);
  }
  const cells = new Map();
  for (const [key, list] of buckets) cells.set(key, Int32Array.from(list));
  const EMPTY = new Int32Array(0);

  /** Writes { coverage, bed, tilt... } for the point into `out`: coverage 0..1 (0: no way here) and the bed height there. */
  function carve(x, z, out) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let sum = 0, bedSum = 0, streamSum = 0, nearest = 1e9, nearestWay = -1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(`${cx + dx},${cz + dz}`) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          const rx = x - P.px[i], rz = z - P.pz[i];
          const r2 = rx * rx + rz * rz;
          const R = P.rad[i];
          if (r2 >= R * R) continue;
          const u = 1 - r2 / (R * R);
          const w = u * u * u * P.inv[i];
          const lat = rx * P.nx[i] + rz * P.nz[i];
          const off = lat * P.side[i] - CARVE.bermOffset;
          const bump = P.berm[i] > 0 ? P.berm[i] * Math.exp(-(off * off) / (2 * CARVE.bermSigma * CARVE.bermSigma)) : 0;
          sum += w;
          if (P.stream[i]) streamSum += w;
          bedSum += w * (P.bed[i] + P.tilt[i] * lat + bump);
          if (r2 < nearest) { nearest = r2; nearestWay = P.way[i]; }
        }
      }
    }
    if (sum <= 1e-6) { out.coverage = 0; out.bed = 0; out.way = -1; out.stream = 0; return out; }
    out.coverage = smoothstep(CARVE.coverLow, CARVE.coverHigh, Math.min(1, sum));
    out.stream = out.coverage * (streamSum / sum);                      // how much of the shaping is a water channel (0..1): feeds the stream-bed paint
    out.bed = bedSum / sum;
    out.way = nearestWay;
    return out;
  }

  return { carve, samples: P, count, ways: wayInfo };
}

export function createCarveScratch() { return { coverage: 0, bed: 0, way: -1, stream: 0 }; }
