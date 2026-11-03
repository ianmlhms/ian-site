/* The road network of Lux Drive, carved INTO the terrain.
 *
 * There is no ribbon: a road is a chain of segments, each with the height of its bed (the smoothed terrain
 * along the centre line), the half width of the carriageway, the kerb and the pavement it carries.  The
 * ground at a point is the terrain, mixed towards the road bed with a coverage that is 1 on the carriageway
 * and fades to 0 a couple of metres past the pavement.  The kerb is a small ridge at the edge of the
 * carriageway: the car feels it, and the ground shader paints it.
 *
 * The distance to a road is the distance to its POLYLINE (not to its samples), so a straight road has a
 * perfectly straight edge.  Where two roads overlap (a junction) the beds are blended by their coverage,
 * so there is no step and no hole; the kerb of a road that runs into another road is switched off at the
 * junction, because a real junction is flat.
 *
 * Pure functions: the same code feeds the render mesh, the physics lattice and the Node harness. */
import { ROAD } from './config.js';
import { ROAD_KINDS, kindInfo } from './roads.js';

const CELL = ROAD.cell;                 // m, the spatial hash cell (the biggest kernel radius fits inside it)
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KERB_SURFACES = new Set(['asphalt', 'cobble', 'concrete']);

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

/** A Gaussian smoothing of a series of values (the ends are renormalised, so a value keeps its end). */
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
      if (j < 0 || j >= n) continue;
      const w = kernel[k + radius];
      sum += values[j] * w; wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

/**
 * roads: the decoded road network (roads.js).  baseHeight(x, z): the terrain without any road.
 * Returns { carve, nearestRoad, roads, segments, count }.
 */
export function createRoadNetwork(roads, baseHeight) {
  const segAx = [], segAz = [], segBx = [], segBz = [], segB0 = [], segB1 = [];
  const segHw = [], segKerbH = [], segKerbW = [], segPw = [], segA0 = [], segR = [];
  const segKind = [], segRoad = [], segKerbOn = [], segLines = [], segS0 = [], segS1 = [];
  const sampleX = [], sampleZ = [], sampleRoad = [];
  const info = [];
  const firstSample = [];            // the index of a road's first sample in the sample arrays
  const firstSeg = [];               // the index of a road's first segment in the segment arrays
  const segCount = [];               // the number of segments of a road

  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    firstSample[ri] = -1; firstSeg[ri] = -1; segCount[ri] = 0; info[ri] = null;
    // Only the roads a car may drive on are carved. A footpath or a staircase is not a road: carving it would cut a
    // trench into the hillside where the path follows a steep slope. A bridge is a deck (decks.js), a tunnel cannot be
    // a trench in a single valued height field (it gets a portal instead).
    if (!road.info.drivable || road.tunnel || road.bridge) continue;
    const kind = kindInfo(road.kind);
    const hw = Math.max(0.8, road.width / 2);
    const kerbH = KERB_SURFACES.has(kind.surface) ? ROAD.kerbHeight : 0;
    const kerbW = kerbH > 0 ? ROAD.kerbWidth : 0;
    const pw = Math.max(0, road.sidewalk);
    const a0 = hw + kerbW + pw;
    const radius = Math.min(ROAD.maxRadius, a0 + ROAD.falloff);
    info[ri] = { hw, kerbH, kerbW, pw, a0, radius, kind, road, lines: kind.lines, lanes: road.lanes };
    firstSample[ri] = sampleX.length;
    firstSeg[ri] = segAx.length;

    const rs = resample(road.pts, ROAD.sampleSpacing);
    const n = rs.x.length;
    if (n < 2) continue;
    if (n > 4) {                                     // round the corners of the (sparse) OSM polyline; the two end points stay where they are
      const sx = gaussianSmooth(rs.x, ROAD.lineSmoothing / ROAD.sampleSpacing);
      const sz = gaussianSmooth(rs.z, ROAD.lineSmoothing / ROAD.sampleSpacing);
      for (let i = 1; i < n - 1; i++) { rs.x[i] = sx[i]; rs.z[i] = sz[i]; }
    }
    // the bed: the terrain along the centre line, smoothed (a road is smoother than the ground it lies on)
    const ground = rs.x.map((x, i) => baseHeight(x, rs.z[i]));
    const bed = gaussianSmooth(ground, ROAD.bedSmoothing / ROAD.sampleSpacing);
    // ... but never further than bedClamp from the ground: a street that runs over a cliff must not be smoothed
    // into the cliff face, and a road that climbs a hill must not cut 5 m into it.
    for (let i = 0; i < n; i++) {
      const lo = ground[i] - ROAD.bedClamp, hi = ground[i] + ROAD.bedClamp;
      bed[i] = Math.min(hi, Math.max(lo, bed[i]));
    }
    // the distance along the centre line: the shader draws the lane markings as dashes along it
    const along = new Float64Array(n);
    for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]);
    const kindCode = ROAD_KINDS.indexOf(road.kind);
    for (let i = 0; i < n - 1; i++) {
      segAx.push(rs.x[i]); segAz.push(rs.z[i]); segBx.push(rs.x[i + 1]); segBz.push(rs.z[i + 1]);
      segB0.push(bed[i]); segB1.push(bed[i + 1]);
      segHw.push(hw); segKerbH.push(kerbH); segKerbW.push(kerbW); segPw.push(pw);
      segA0.push(a0); segR.push(radius);
      segKind.push(kindCode); segRoad.push(ri); segKerbOn.push(1);
      segLines.push(kind.lines); segS0.push(along[i]); segS1.push(along[i + 1]);
    }
    for (let i = 0; i < n; i++) { sampleX.push(rs.x[i]); sampleZ.push(rs.z[i]); sampleRoad.push(ri); }
    segCount[ri] = n - 1;
  }

  const count = segAx.length;
  const X0 = Float32Array.from(segAx), Z0 = Float32Array.from(segAz);
  const X1 = Float32Array.from(segBx), Z1 = Float32Array.from(segBz);
  const BED0 = Float32Array.from(segB0), BED1 = Float32Array.from(segB1);
  const HW = Float32Array.from(segHw), KERBH = Float32Array.from(segKerbH), KERBW = Float32Array.from(segKerbW);
  const PW = Float32Array.from(segPw), A0 = Float32Array.from(segA0), RAD = Float32Array.from(segR);
  const KIND = Uint8Array.from(segKind), ROADOF = Int32Array.from(segRoad);
  const KERBON = Uint8Array.from(segKerbOn);
  const LINES = Uint8Array.from(segLines);
  const S0 = Float32Array.from(segS0), S1 = Float32Array.from(segS1);
  const SAMPLES_X = Float32Array.from(sampleX), SAMPLES_Z = Float32Array.from(sampleZ);
  const SAMPLES_ROAD = Int32Array.from(sampleRoad);

  // ---- the spatial hash of the segments ----------------------------------
  const cellKey = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const minX = Math.min(X0[i], X1[i]), maxX = Math.max(X0[i], X1[i]);
    const minZ = Math.min(Z0[i], Z1[i]), maxZ = Math.max(Z0[i], Z1[i]);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = cellKey(cx, cz);
        const list = buckets.get(key);
        if (list) list.push(i); else buckets.set(key, [i]);
      }
    }
  }
  const cells = new Map();
  for (const [key, list] of buckets) cells.set(key, Int32Array.from(list));
  const EMPTY = new Int32Array(0);

  // ---- the junctions: no kerb where a road runs into another road --------
  {
    const sKey = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
    const sBuckets = new Map();
    for (let i = 0; i < sampleX.length; i++) {
      const key = sKey(Math.floor(sampleX[i] / CELL), Math.floor(sampleZ[i] / CELL));
      const list = sBuckets.get(key);
      if (list) list.push(i); else sBuckets.set(key, [i]);
    }
    const sCells = new Map();
    for (const [key, list] of sBuckets) sCells.set(key, Int32Array.from(list));
    const sx = Float32Array.from(sampleX), sz = Float32Array.from(sampleZ);
    const sRoad = Int32Array.from(sampleRoad);
    for (let i = 0; i < sampleX.length; i++) {
      const ri = sRoad[i];
      const clear = info[ri].hw + ROAD.junctionClear;
      const cx = Math.floor(sx[i] / CELL), cz = Math.floor(sz[i] / CELL);
      let hit = false;
      for (let dz = -1; dz <= 1 && !hit; dz++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const list = sCells.get(sKey(cx + dx, cz + dz)) || EMPTY;
          for (let q = 0; q < list.length; q++) {
            const j = list[q];
            if (sRoad[j] === ri) continue;
            const ddx = sx[j] - sx[i], ddz = sz[j] - sz[i];
            if (ddx * ddx + ddz * ddz < clear * clear) { hit = true; break; }
          }
        }
      }
      if (hit) {
        // switch the kerb off on the segments around this sample (the sample index inside the road is known)
        const local = i - firstSample[ri];
        const last = firstSeg[ri] + segCount[ri] - 1;
        const from = Math.max(firstSeg[ri], firstSeg[ri] + local - 1);
        const to = Math.min(last, firstSeg[ri] + local + 1);
        for (let s = from; s <= to; s++) KERBON[s] = 0;
      }
    }
  }

  // ---- the query ---------------------------------------------------------
  const scratch = { coverage: 0, bed: 0, kerb: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, dist: 0, lines: 0, lanes: 0, s: 0 };
  const LEVEL_FULL = 2.5;           // m: a road shapes the ground that lies at its own level (within this)
  const LEVEL_FADE = 5.0;           // m: ... and its influence is gone at this distance (a road on the ledge 30 m
                                    // above must not cover the ground below it). The fade is soft: a hard cut would
                                    // step the bed at the foot of a cliff, where the ground passes the road's level.

  /**
   * Writes the road influence at (x, z) into `out`:
   *   coverage 0..1  how much of the ground here is road
   *   bed      the height of the road surface
   *   kerb     the height of the kerb / pavement above the bed (0 on the carriageway)
   *   lat      the signed offset from the centre line of the nearest road (positive = to the right of the way)
   *   hw       the half width of the carriageway of that road
   *   a0       the outer edge of the pavement (the carriageway + the kerb + the pavement)
   *   kind     the class code of that road, road its index, dist the distance to it
   *
   * The contributions of the roads near the point are SUMMED, not "the nearest one wins" (the way the MTB engine
   * carves its trails): where two roads meet their beds are averaged, so a junction has no step, and where one road
   * ends the other one simply takes over.
   */
  function carve(x, z, out, groundY) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const ground = groundY === undefined ? baseHeight(x, z) : groundY;
    let best = -1, bestW = 0, bestLat = 0, bestDist = 0, bestT = 0;
    let covSum = 0, bedSum = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          const ax = X0[i], az = Z0[i];
          const ex = X1[i] - ax, ez = Z1[i] - az;
          const ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const rx = x - (ax + ex * t), rz = z - (az + ez * t);
          const len = Math.sqrt(ll) || 1;
          const lat = (rx * -ez + rz * ex) / len;         // the signed offset from the centre line (right is positive)
          const d = Math.hypot(rx, rz);
          const R = RAD[i];
          if (d >= R) continue;
          const a0 = A0[i];
          let cov;
          if (d <= a0) cov = 1;
          else { const u = (d - a0) / (R - a0); cov = (1 - u) * (1 - u); }
          const bed = BED0[i] + (BED1[i] - BED0[i]) * t;
          const away = Math.abs(bed - ground);
          if (away >= LEVEL_FADE) continue;               // a road on another level does not reach here
          const w = cov * (1 - smoothstep(LEVEL_FULL, LEVEL_FADE, away));
          if (w <= 0) continue;
          covSum += w; bedSum += w * bed;
          if (w > bestW) { bestW = w; best = i; bestLat = lat; bestDist = d; bestT = t; }
        }
      }
    }
    if (best < 0) {
      out.coverage = 0; out.bed = 0; out.kerb = 0; out.lat = 0; out.hw = 0; out.a0 = 0; out.kind = 0; out.road = -1;
      out.dist = Infinity; out.lines = 0; out.lanes = 0; out.s = 0;
      return out;
    }
    out.coverage = Math.min(1, covSum);
    let bed = bedSum / covSum;
    // The bed may not leave the ground under it: two roads that meet on a steep slope have beds that differ by
    // metres (each was smoothed along its own direction), and the average above puts them back together.
    if (bed > ground + ROAD.bedClamp) bed = ground + ROAD.bedClamp;
    else if (bed < ground - ROAD.bedClamp) bed = ground - ROAD.bedClamp;
    out.bed = bed;
    out.lat = bestLat;
    out.dist = bestDist;
    out.hw = HW[best];
    out.a0 = A0[best];
    out.kind = KIND[best];
    out.road = ROADOF[best];
    out.lines = LINES[best];
    out.lanes = info[ROADOF[best]].lanes;
    out.s = S0[best] + (S1[best] - S0[best]) * bestT;      // the distance along the centre line of that road
    const a = Math.abs(bestLat);
    const kerbH = KERBH[best];
    if (kerbH <= 0 || !KERBON[best] || a <= HW[best]) out.kerb = 0;
    else if (a <= HW[best] + KERBW[best]) out.kerb = kerbH * (a - HW[best]) / KERBW[best];
    else if (a <= A0[best]) out.kerb = kerbH;
    else out.kerb = kerbH * Math.max(0, 1 - (a - A0[best]) / (RAD[best] - A0[best]));
    return out;
  }

  /** The road the point is on (or nearest to): { road, index, lat, dist, coverage }. */
  function nearestRoad(x, z, out) {
    carve(x, z, out);
    if (out.road < 0) return null;
    return { road: roads[out.road], index: out.road, lat: out.lat, dist: out.dist, coverage: out.coverage, kind: out.kind };
  }

  return {
    carve, nearestRoad, roads, info, count, scratch,
    segments: { X0, Z0, X1, Z1, BED0, BED1, HW, KERBH, KERBW, PW, A0, RAD, KIND, ROADOF, KERBON, LINES, S0, S1 },
    // the centre lines as they are carved (resampled and rounded): the game, the minimap and the probes follow these
    samples: { x: SAMPLES_X, z: SAMPLES_Z, road: SAMPLES_ROAD, first: firstSample, segs: segCount },
  };
}

/** The height of the road surface at a point that lies on a road (the ground without the road). */
export const roadSurfaceHeight = (network, x, z) => {
  network.carve(x, z, network.scratch);
  return network.scratch.bed;
};

export { smoothstep };
