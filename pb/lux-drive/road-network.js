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
const BATTER_STEP = 2.0;               // m, the step of the walk that finds where the batter gives up
const BATTER_TOL = 0.05;               // m, how close the land must be to the road for the batter to end
const OVER_LEVEL = 1.5;                // m: at a crossing, the way whose bed is this much higher than the other one
                                    // rides OVER it: it keeps its own earthworks and the ground under it is protected
const PROTECT_MARGIN = 4.0;            // m: the ground beside an over way is protected this far past its pavement
const PROTECT_FADE = 10.0;             // m: the protection fades out over this distance, so the ground is never a wall
const PROTECT_CELL = 64;               // m, the cell of the spatial hash of the protected corridors
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
  const segHw = [], segKerbH = [], segKerbW = [], segPw = [], segA0 = [], segBench = [], segR = [], segReach = [];
  const segKind = [], segRoad = [], segKerbOn = [], segLines = [], segS0 = [], segS1 = [], segSurf = [];
  const segSamp = [];            // the index of the centre line sample every segment starts at
  const sampleX = [], sampleZ = [], sampleRoad = [];
  const fadeL = [], fadeR = [];   // the length of the batter on each side of the way, per sample
  const notchL = [], notchR = []; // the depth of the bench of the way in the land on each side, per sample
  const info = [];
  const firstSample = [];            // the index of a road's first sample in the sample arrays
  const firstSeg = [];               // the index of a road's first segment in the segment arrays
  const segCount = [];               // the number of segments of a road
  const chains = [];                 // the centre line and the bed of every drivable way (the crossings decide what is over what)
  const overCorridors = [];          // the corridors of the ways that ride over the ground: their ground is protected

  /**
   * Where the batter on one side of a way ends, in metres past the edge of the pavement.
   * The ground beside a road is the land, but the carve may never make it steeper than the slope limit, so the
   * ground follows a ramp of at most that slope from the level of the road until the ramp reaches the land again.
   * The batter ends there: the ground of the carve is the land itself, so the batter leaves no step behind it.
   * Where the land is steeper than the limit the ramp never catches it (a cliff beside a road): the batter then runs
   * to its full length.
   * `nx, nz` points away from the way, `bed` is the level of the road, `a0` the edge of the pavement.
   */
  function batterLength(px, pz, nx, nz, bed, a0, maxEdge) {
    let lastFail = -1;
    for (let e = 0; e <= maxEdge + 1e-6; e += BATTER_STEP) {
      const g = baseHeight(px + nx * (a0 + e), pz + nz * (a0 + e));
      // the ramp of the batter reaches the land when the land is not more than the slope limit away from the road
      if (Math.abs(g - bed) > ROAD.maxBatterSlope * e + BATTER_TOL) lastFail = e;
    }
    if (lastFail < 0) return maxEdge;
    return Math.min(maxEdge, lastFail + BATTER_STEP);
  }

  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    firstSample[ri] = -1; firstSeg[ri] = -1; segCount[ri] = 0; info[ri] = null;
    // Only the roads a car may drive on are carved. A footpath or a staircase is not a road: carving it would cut a
    // trench into the hillside where the path follows a steep slope. A tunnel cannot be a trench in a single valued
    // height field (it gets a portal instead) and a way that rides over the ground is a deck (decks.js).
    if (!road.info.drivable) continue;
    const kind = kindInfo(road.kind);
    const hw = Math.max(0.8, road.width / 2);
    // the kerb belongs to the material of the way itself: a cobbled street has one, a paved area has none
    const kerbH = KERB_SURFACES.has(road.surface || kind.surface) ? ROAD.kerbHeight : 0;
    const kerbW = kerbH > 0 ? ROAD.kerbWidth : 0;
    const pw = Math.max(0, road.sidewalk);
    // The bench of the road is the carriageway and its kerb; the pavement beside it is PAINT, not a bench.
    // A wide pavement would dig the ground deeper into the hillside and build a wall beside the street (the
    // reviewer saw one), so the carve keeps its narrow bench and the pavement is painted on the ground beside it.
    const bench = hw + kerbW;
    const a0 = bench + pw;
    // A way that rides OVER the ground: OSM says so (a bridge, or a layer above the others).  It is never carved
    // into the height function and the ground under it is protected (see the crossings below).
    const tagged = !!(road.over || (road.layer || 0) >= 1);

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
    // Every drivable way keeps its centre line and its bed: the crossings of the ways decide which one rides over
    // which.  That is how an overpass that OSM does not tag as a bridge (a slip road on a viaduct) is found.
    chains.push({ road: ri, x: rs.x, z: rs.z, bed, tagged });
    if (road.tunnel || tagged) {
      // A tunnel and an over way are not carved.  The ground under an over way is protected: the way that goes
      // under it may not dig a hole in it (the reviewer saw the bridge road dive into a dark pit).
      if (tagged) overCorridors.push({ x: rs.x, z: rs.z, half: a0 + PROTECT_MARGIN });
      continue;
    }
    const radius = Math.min(ROAD.maxRadius, a0 + ROAD.falloff);
    // The BATTER reaches much farther than the paint: the ground beside the road is shaped by the slope limit over
    // the whole embankment, while the paint stops at the pavement (the painted tarmac must be the carriageway).
    const reach = Math.min(ROAD.maxRadius, bench + ROAD.embankment);
    info[ri] = { hw, kerbH, kerbW, pw, a0, radius, reach, kind, road, lines: kind.lines, lanes: road.lanes };
    firstSample[ri] = sampleX.length;
    firstSeg[ri] = segAx.length;
    // The BATTER on each side of the way: how far past the pavement the ground beside the road is shaped.
    // The ground beside a road is the LAND, but the carve may never make it steeper than the slope limit, so the
    // ground follows a ramp of at most that slope until the ramp reaches the land again.  The batter ends there:
    // at that point the ground of the carve IS the land, so the batter leaves no step behind it.  The length is
    // found per SAMPLE and not per segment, so that it is continuous along the road: two segments that share a
    // sample share its batter, and the ground does not jump where they meet.
    for (let i = 0; i < n; i++) {
      let dx, dz;
      if (i === 0) { dx = rs.x[1] - rs.x[0]; dz = rs.z[1] - rs.z[0]; }
      else if (i === n - 1) { dx = rs.x[n - 1] - rs.x[n - 2]; dz = rs.z[n - 1] - rs.z[n - 2]; }
      else { dx = rs.x[i + 1] - rs.x[i - 1]; dz = rs.z[i + 1] - rs.z[i - 1]; }
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;              // to the right of the way, the way the traffic runs
      const s = sampleX.length + i;
      const maxEdge = reach - bench;                    // m, the longest batter this road may have
      fadeR[s] = batterLength(rs.x[i], rs.z[i], nx, nz, bed[i], bench, maxEdge);
      fadeL[s] = batterLength(rs.x[i], rs.z[i], -nx, -nz, bed[i], bench, maxEdge);
      // The NOTCH of the way on each side: how deep the bench of the way is cut into the land (or how high the way
      // stands above it).  The ground beside the way is the land itself, shifted by the notch: the face of a cutting
      // is the shape of the hillside it is cut into, and the ground under an embankment is the shape of the ground it
      // stands on.  The notch is measured on the land at the edge of the bench, so the two meet exactly.
      notchR[s] = baseHeight(rs.x[i] + nx * bench, rs.z[i] + nz * bench) - bed[i];
      notchL[s] = baseHeight(rs.x[i] - nx * bench, rs.z[i] - nz * bench) - bed[i];
    }
    // the distance along the centre line: the shader draws the lane markings as dashes along it
    const along = new Float64Array(n);
    for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]);
    const kindCode = ROAD_KINDS.indexOf(road.kind);
    for (let i = 0; i < n - 1; i++) {
      segAx.push(rs.x[i]); segAz.push(rs.z[i]); segBx.push(rs.x[i + 1]); segBz.push(rs.z[i + 1]);
      segB0.push(bed[i]); segB1.push(bed[i + 1]);
      segHw.push(hw); segKerbH.push(kerbH); segKerbW.push(kerbW); segPw.push(pw);
      segA0.push(a0); segBench.push(bench); segR.push(radius); segReach.push(reach);
      segKind.push(kindCode); segRoad.push(ri); segKerbOn.push(1);
      segLines.push(kind.lines); segS0.push(along[i]); segS1.push(along[i + 1]);
      segSurf.push(road.surfaceCode ?? 0);
      segSamp.push(sampleX.length + i);
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
  const BENCH = Float32Array.from(segBench);
  const REACH = Float32Array.from(segReach);
  // the box of every segment: the cheap reject of the segments that are far away (the batter reaches 10 m past the
  // pavement, so the loop cannot stop at the paint's radius)
  const MINX = new Float32Array(count), MAXX = new Float32Array(count);
  const MINZ = new Float32Array(count), MAXZ = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    MINX[i] = Math.min(X0[i], X1[i]); MAXX[i] = Math.max(X0[i], X1[i]);
    MINZ[i] = Math.min(Z0[i], Z1[i]); MAXZ[i] = Math.max(Z0[i], Z1[i]);
  }
  const KIND = Uint8Array.from(segKind), ROADOF = Int32Array.from(segRoad);

  // ---- the batter: how far the ground beside the road is shaped, on each side of the road.
  // The ground beside a road is the LAND, but the carve may never make it steeper than the slope limit: the ground
  // follows a ramp of at most that slope from the level of the road until the ramp reaches the land again, and there
  // the batter ends.  The lengths are found per centre line sample (see the road loop), so the batter is continuous
  // along the road.
  const FADEL = Float32Array.from(fadeL), FADER = Float32Array.from(fadeR);
  const NOTCHL = Float32Array.from(notchL), NOTCHR = Float32Array.from(notchR);
  const SAMP0 = Int32Array.from(segSamp);
  const SURF = Uint8Array.from(segSurf);
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

  // ---- the crossings: which way rides over which -------------------------
  // At a crossing the two ways are at their own level.  If one of them is more than OVER_LEVEL higher than the
  // other, it rides OVER it: its earthworks (the fill of the DTM) are the ground there, so it is never carved, and
  // the ground under it is protected.  The way that goes under it may not dig a hole in it: the reviewer saw the cut
  // of the lower road carved into the crossing road, so the bridge road dived into a dark pit.
  const overRoads = new Set();
  const crossings = [];            // the crossings of two ways where one of them rides over the other
  const crossingKeys = new Set();
  for (const chain of chains) if (chain.tagged) overRoads.add(chain.road);

  /** Where the segment AB crosses the segment CD: the parameters t (on AB) and u (on CD), or null. */
  function crossing(ax, az, bx, bz, cx, cz, dx, dz) {
    const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = cx - ax, qz = cz - az;
    const t = (qx * sz - qz * sx) / den;
    const u = (qx * rz - qz * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [t, u];
  }

  {
    // the ways that OSM does not tag: their crossings are the ones that have to be found
    const cands = chains.filter((chain) => !chain.tagged);
    const GC = 32;                                   // m, the cell of the grid of the centre lines
    const gkey = (cx, cz) => cx * 4096 + cz;
    const grid = new Map();
    const cellRange = (ax, az, bx, bz) => [
      Math.floor(Math.min(ax, bx) / GC), Math.floor(Math.max(ax, bx) / GC),
      Math.floor(Math.min(az, bz) / GC), Math.floor(Math.max(az, bz) / GC),
    ];
    for (const chain of cands) {
      for (let i = 1; i < chain.x.length; i++) {
        const [cx0, cx1, cz0, cz1] = cellRange(chain.x[i - 1], chain.z[i - 1], chain.x[i], chain.z[i]);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const k = gkey(cx, cz);
            const list = grid.get(k);
            if (list) list.push(chain, i); else grid.set(k, [chain, i]);
          }
        }
      }
    }
    for (const chain of cands) {
      for (let i = 1; i < chain.x.length; i++) {
        const ax = chain.x[i - 1], az = chain.z[i - 1], bx = chain.x[i], bz = chain.z[i];
        const [cx0, cx1, cz0, cz1] = cellRange(ax, az, bx, bz);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cz = cz0; cz <= cz1; cz++) {
            const list = grid.get(gkey(cx, cz));
            if (!list) continue;
            for (let q = 0; q < list.length; q += 2) {
              const other = list[q], j = list[q + 1];
              if (other.road <= chain.road) continue;      // every crossing is looked at once
              const hit = crossing(ax, az, bx, bz, other.x[j - 1], other.z[j - 1], other.x[j], other.z[j]);
              if (!hit) continue;
              const bedA = chain.bed[i - 1] + (chain.bed[i] - chain.bed[i - 1]) * hit[0];
              const bedB = other.bed[j - 1] + (other.bed[j] - other.bed[j - 1]) * hit[1];
              if (bedA > bedB + OVER_LEVEL) overRoads.add(chain.road);
              else if (bedB > bedA + OVER_LEVEL) overRoads.add(other.road);
              else continue;
              // the crossing is recorded: the harness checks that the over way does not dive into a pit there
              const px = ax + (bx - ax) * hit[0], pz = az + (bz - az) * hit[0];
              const key = Math.round(px) * 100000 + Math.round(pz);
              if (crossingKeys.has(key)) continue;
              crossingKeys.add(key);
              crossings.push({
                x: px, z: pz,
                over: bedA > bedB ? chain.road : other.road,
                under: bedA > bedB ? other.road : chain.road,
                bedOver: Math.max(bedA, bedB), bedUnder: Math.min(bedA, bedB),
              });
            }
          }
        }
      }
    }
  }

  // ---- the protected corridors: the ground under a way that rides over the others stays the ground -----
  const protX0 = [], protZ0 = [], protX1 = [], protZ1 = [], protHalf = [];
  for (const corridor of overCorridors) {              // the ways that OSM tags as over
    for (let i = 1; i < corridor.x.length; i++) {
      protX0.push(corridor.x[i - 1]); protZ0.push(corridor.z[i - 1]);
      protX1.push(corridor.x[i]); protZ1.push(corridor.z[i]);
      protHalf.push(corridor.half);
    }
  }
  for (let i = 0; i < count; i++) {                     // the ways the crossings found to be over
    if (!overRoads.has(ROADOF[i])) continue;
    protX0.push(X0[i]); protZ0.push(Z0[i]); protX1.push(X1[i]); protZ1.push(Z1[i]);
    protHalf.push(A0[i] + PROTECT_MARGIN);
  }
  const pKey = (cx, cz) => cx * 4096 + cz;
  const pBuckets = new Map();
  for (let s = 0; s < protX0.length; s++) {
    const minX = Math.min(protX0[s], protX1[s]), maxX = Math.max(protX0[s], protX1[s]);
    const minZ = Math.min(protZ0[s], protZ1[s]), maxZ = Math.max(protZ0[s], protZ1[s]);
    for (let cx = Math.floor(minX / PROTECT_CELL); cx <= Math.floor(maxX / PROTECT_CELL); cx++) {
      for (let cz = Math.floor(minZ / PROTECT_CELL); cz <= Math.floor(maxZ / PROTECT_CELL); cz++) {
        const k = pKey(cx, cz);
        const list = pBuckets.get(k);
        if (list) list.push(s); else pBuckets.set(k, [s]);
      }
    }
  }
  const pCells = new Map();
  for (const [key, list] of pBuckets) pCells.set(key, Int32Array.from(list));

  /** How much of the ground at (x, z) is protected: 1 inside a corridor of an over way, 0 outside it. */
  function protection(x, z) {
    const cx = Math.floor(x / PROTECT_CELL), cz = Math.floor(z / PROTECT_CELL);
    let p = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = pCells.get(pKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const s = list[q];
          const ax = protX0[s], az = protZ0[s];
          const ex = protX1[s] - ax, ez = protZ1[s] - az;
          const ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t)) - protHalf[s];
          if (d <= 0) return 1;
          if (d < PROTECT_FADE) { const v = 1 - d / PROTECT_FADE; if (v > p) p = v; }
        }
      }
    }
    return p;
  }

  // A way that rides over the others keeps the earthworks of the DTM: its batter never shapes the ground.
  const NOBATTER = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (overRoads.has(ROADOF[i])) NOBATTER[i] = 1;

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
  const scratch = { coverage: 0, bed: 0, band: 0, kerb: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, dist: 0, lines: 0, lanes: 0, s: 0, surface: 0 };

  const LEVEL_FULL = 4.0;           // m: a road shapes the ground that lies at its own level (within this).  A road
                                    // that stands far above the ground is a viaduct and must not fill the valley
                                    // under it; a road far below it is a cutting the batter cannot carry away
  const LEVEL_FADE = 14.0;          // m: ... and its influence is gone at this distance.  The fade is wide on purpose:
                                    // a narrow one would step the bed at the foot of a cliff, where the ground
                                    // passes the road's level, and the step would be steeper than the ground itself

  /**
   * Writes the road influence at (x, z) into `out`:
   *   coverage 0..1  how much of the ground here is road
   *   bed      the height of the road surface
   *   band     the height of the ground beside the road: the land, reached by the slope limited ramp of the batter
   *   kerb     the height of the kerb / pavement above the bed (0 on the carriageway)
   *   lat      the signed offset from the centre line of the nearest road (positive = to the right of the way)
   *   hw       the half width of the carriageway of that road
   *   a0       the outer edge of the pavement (the carriageway + the kerb + the pavement)
   *   kind     the class code of that road, road its index, dist the distance to it
   *   surface  the material of that road (the code the ground shader switches on)
   *
   * The contributions of the roads near the point are SUMMED, not "the nearest one wins" (the way the MTB engine
   * carves its trails): where two roads meet their beds are averaged, so a junction has no step, and where one road
   * ends the other one simply takes over.  The sum is the HEIGHT blend only: the geometry (lat, hw, a0) that the
   * shader paints comes from the one road the point is on, so the painted tarmac follows the real edge of the
   * carriageway and the sum of the neighbouring roads never paints asphalt where the kernel only blends the height.
   *
   * The HEIGHT is the BATTER, and the batter is a SLOPE LIMITED RAMP: the ground beside a road is the land, and the
   * road is cut into it.  The face of the cutting or of the embankment starts at the edge of the pavement, at the
   * level of the road, and it goes back to the land over the length of the batter; it never rises or falls faster
   * than the slope limit, so the ground beside a road is never a wall (the reviewer saw one: a grey slab running up
   * the hill with a slit).  Where the land itself is steeper than the limit, the ramp is the ground: a cliff beside
   * a road stays a cliff.
   */
  function carve(x, z, out, groundY) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const ground = groundY === undefined ? baseHeight(x, z) : groundY;
    // The ground under a way that rides over the others is protected: no road may cut into it, so the bridge road
    // does not dive into a dark pit where the road below it was cut into the hill.
    const prot = protection(x, z);
    let best = -1, bestScore = -1, bestLat = 0, bestDist = 0, bestT = 0;
    let covSum = 0, bedSum = 0;     // the paint: the coverage of the road the point is on (the tight radius) and the
                                    // flat level of a junction (the roads that meet are blended)
    let devSum = 0, devW = 0;       // the batter: how far the roads pull the ground here, and how much they claim it
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          const reach = REACH[i];
          // the cheap reject: the segment is too far away to shape the ground here
          if (x < MINX[i] - reach || x > MAXX[i] + reach || z < MINZ[i] - reach || z > MAXZ[i] + reach) continue;
          const ax = X0[i], az = Z0[i];
          const ex = X1[i] - ax, ez = Z1[i] - az;
          const ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const rx = x - (ax + ex * t), rz = z - (az + ez * t);
          const len = Math.sqrt(ll) || 1;
          const lat = (rx * -ez + rz * ex) / len;         // the signed offset from the centre line (right is positive)
          const d = Math.hypot(rx, rz);
          if (d >= reach) continue;
          // ---- the batter: the face of the cutting or of the embankment beside the road.
          // The ground beside a road is the LAND, and the road is cut into it.  The face of the cutting (or of the
          // embankment) starts at the edge of the pavement, at the level of the road, and it goes back to the land
          // over the length of the batter.  It never rises or falls faster than the slope limit, so the ground beside
          // a road is never a wall (the reviewer saw one: a grey slab running up the hill).  Where the land itself is
          // steeper than the limit, the ramp is the ground: a cliff beside a road stays a cliff.
          const a0 = A0[i];
          const bench = BENCH[i];
          const edge = d > bench ? d - bench : 0;
          const bed = BED0[i] + (BED1[i] - BED0[i]) * t;
          // The NOTCH of the way on this side, interpolated along the road like the bed: how deep the bench of the
          // way is cut into the land (or how high the way stands above it).
          const s0 = SAMP0[i];
          const notch = lat >= 0
            ? NOTCHR[s0] + (NOTCHR[s0 + 1] - NOTCHR[s0]) * t
            : NOTCHL[s0] + (NOTCHL[s0 + 1] - NOTCHL[s0]) * t;
          // A way that stands ABOVE the ground is a viaduct or an embankment: its fill fades out, so the valley
          // under it stays the valley.  A way that runs BELOW the ground is a cut, and a cut is dug: the batter
          // limits the slope of its face, so the face is a ramp and not a wall.
          const off = ground - bed;
          const level = notch >= 0 ? 1 : 1 - smoothstep(LEVEL_FULL, LEVEL_FADE, -off);
          // The length of the batter on this side of the way, interpolated along the road like the bed.
          const fadeLen = lat >= 0
            ? FADER[s0] + (FADER[s0 + 1] - FADER[s0]) * t
            : FADEL[s0] + (FADEL[s0 + 1] - FADEL[s0]) * t;
          if (fadeLen <= 0) continue;  // the road does not reach this far
          // The ground of the batter.
          // A CUT (the land is above the way): the ground beside the way is the LAND itself, shifted down by the
          // depth of the notch: the face of the cutting is the shape of the hillside the way is cut into.  The shift
          // fades out over the batter, so the ground is the land again where the batter ends.  The face of the
          // cutting is therefore never steeper than the land it is cut into, and the ground never jumps from the cut
          // to the land (the wall the reviewer saw beside Rue de la Semois).
          // A FILL (the way stands above the ground): the ground beside the way is a ramp of at most the slope limit
          // from the level of the way, and the ramp fades out where the way stands far above the ground (a viaduct
          // must not fill the valley under it).
          // A way that rides over the others has no batter at all: the earthworks of the DTM are its ground.
          if (!NOBATTER[i]) {
            let dev;                    // how far the way pulls the ground here, in metres
            let reach = fadeLen;
            if (notch >= 0) {
              reach = REACH[i] - bench;
              if (reach <= 0 || edge >= reach) continue;
              // On the way itself the ground is the level of the way (the road is flat across its width); beside
              // it, the land shifted down by the notch.
              dev = edge > 0 ? -notch * (1 - smoothstep(0, reach, edge)) : bed - ground;
            } else {
              if (edge >= fadeLen) continue;
              const lim = ROAD.maxBatterSlope * edge;
              const shaped = bed + (off > lim ? lim : off < -lim ? -lim : off);
              dev = level * (shaped - ground);
            }
            // The claim of the batter: full on the road, and gone at the far end of the batter.  It is squared so that
            // a road further away does not pull the ground of the road the point is on.
            const fall = 1 - edge / reach;
            const claim = fall * fall;
            devSum += claim * dev;
            devW += claim;
          }
          // ---- the paint: it stops at the pavement, so the painted tarmac is the carriageway and nothing else
          const R = RAD[i];
          if (d >= R) continue;
          let cov;
          if (d <= a0) cov = 1;
          else { const uu = (d - a0) / (R - a0); cov = (1 - uu) * (1 - uu); }
          const w = cov * level;
          if (w <= 0) continue;
          covSum += w; bedSum += w * bed;
          // The paint belongs to ONE road, and it is the road the point is really on: the one whose
          // carriageway contains the point, and among those the most central one.  Without this rule a wide
          // road (a square) swallows the street that crosses it and the street is painted with its surface.
          // The narrowness is the last tie break: at a crossing the minor road keeps its own surface.
          const hw = HW[i];
          const score = ((d <= hw ? 2 : 1) + 1 - Math.min(1, Math.abs(lat) / Math.max(hw, 0.5))
                         - Math.min(hw, 12) * 0.02) * level;
          if (score > bestScore) { bestScore = score; best = i; bestLat = lat; bestDist = d; bestT = t; }
        }
      }
    }
    // ---- the batter: the ground beside the road -----------------------------
    // The ground beside a road is the terrain, and the road is cut into it: the face of the cutting or of the
    // embankment is a straight ramp from the level of the road back to the terrain, so the ground beside a road is
    // never steeper than the terrain is (the reviewer saw a wall: a grey slab running up the hill with a slit).
    // The faces of the roads near the point are BLENDED: where two roads meet their levels are averaged, so a
    // junction has no step.
    // The protection scales the WHOLE blend, not the claim of each road: the ground under a way that rides over the
    // others is the land, and the cut of the road that goes under it ramps up to that land over the fade of the
    // corridor.  Scaling the claim instead would keep the shape of the cut and only lose its weight, and the ground
    // would jump from the land to the full cut in half a metre: the wall the reviewer saw beside Rue de Kirchberg.
    out.band = devW > 0 ? ground + (1 - prot) * (devSum / devW) : ground;
    if (best < 0) {
      out.coverage = 0; out.bed = 0; out.kerb = 0; out.lat = 0; out.hw = 0; out.a0 = 0; out.kind = 0; out.road = -1;
      out.dist = Infinity; out.lines = 0; out.lanes = 0; out.s = 0; out.surface = 0;
      return out;
    }
    out.coverage = Math.min(1, covSum);
    out.bed = covSum > 0 ? bedSum / covSum : 0;
    out.lat = bestLat;
    out.dist = bestDist;
    out.hw = HW[best];
    out.a0 = A0[best];
    out.kind = KIND[best];
    out.road = ROADOF[best];
    out.surface = SURF[best];
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
    carve, nearestRoad, roads, info, count, scratch, overRoads, crossings, chains,
    segments: { X0, Z0, X1, Z1, BED0, BED1, HW, KERBH, KERBW, PW, A0, RAD, REACH, KIND, ROADOF, KERBON, LINES, S0, S1, SURF },
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
