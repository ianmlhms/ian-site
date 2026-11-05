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
import { designBed, bedSlopes, hermite } from './road-bed.js';

const CELL = ROAD.cell;                 // m, the spatial hash cell (the biggest kernel radius fits inside it)
const BATTER_STEP = 2.0;               // m, the step of the walk that finds where the batter gives up
const BATTER_TOL = 0.05;               // m, how close the land must be to the road for the batter to end
const OVER_LEVEL = 1.5;                // m: at a crossing, the way whose bed is this much higher than the other one
                                    // rides OVER it: it keeps its own earthworks and the ground under it is protected
const PROTECT_MARGIN = 4.0;            // m: the ground beside an over way is protected this far past its pavement
const PROTECT_FADE = 10.0;             // m: the protection fades out over this distance, so the ground is never a wall
const MEDIAN_WIDTH = 3.0;             // m: a gap of at most this between the carriageways of two ROADS (the median of a dual carriageway, the nose of a slip road) is paved as a whole: the grass left in a gap that
                                    // narrow was a wobbling green sliver between two ragged kerbs (the paint edge of each side is a contour on a 1 m lattice)
const PROTECT_CELL = 64;               // m, the cell of the spatial hash of the protected corridors
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MAX_PINS = 16;                   // carriageways that lie over one point, at most
const MAX_CAND = 192;                  // segments that reach one point, at most
const FOOT_FADE = 1.0, FOOT_FLOOR = 0.01;   // m: a segment counts fully when the foot of the perpendicular is this far from its ends; the floor of its weight (so the weights never all vanish)
const SHEPARD_OFFSET = 0.5, SHEPARD_MIN = 1e-4;   // the weight of a segment of a way is ((d_nearest + 0.5) / (d + 0.5))^4: equal at equal distance, a few per cent at twice the distance               // m: the segments of a way that are this much farther than its nearest one still count for the ground (weighted by how much nearer the nearest is)
const ARM_GAP = 3;                     // segments: two stretches of one way this far apart are different arms (a hairpin)
const CAP_SOFT = 2.0;                  // m: the carriageway pin ends this softly past the END of a way (no flat disc at the end of a street)
const PIN_FADE = 3.0;                  // m: the carriageway level fades into the batter over this distance beyond the pavement
const FILL_TAPER = 3.0;                // m: the last stretch of a fill face where it sinks to the land (the scan that finds the end of the face is coarse)
const MAG_WINDOW = [0.3, 1.2];         // m: the strength of the pin of a way is the mean of the pins of the segments that are about as near as the nearest one (a ring comes back past its own seam:
                                       // the pin of one arbitrary segment of the two jumped where the nearest one changed)
const SEP_LOW = 0.4, SEP_HIGH = 0.8;   // m: two carriageways whose beds differ by less than SEP_LOW are one level (a junction), by more than SEP_HIGH two levels
const RAMP_SLOPE = 1.9;                // m per m: the steepest ground between two carriageways at different levels (a retaining wall hides it, see retaining-walls.js)
const OWN_FADE = 0.5;                  // m: the carriageway of a way is its own from its bench edge to this far past it: a bigger way's fade is not laid over it (same level)
const RAMP_MIN = 0.8, RAMP_MAX = 4.0;  // m: half width of the hand-over from one carriageway to the other, bounds
const FACE_JOIN_PER_M = 0.79;         // the join of the bed and the face is at least as wide as this per m of their difference: a smoothstep is at most 1.5 times as steep as its mean, so the
                                       // ground between a terrace and the face under it never rises faster than RAMP_SLOPE (a terrace on a cliff dropped 5 m in 0.4 m: a crack)
const FACE_JOIN = 0.4;                 // m: the pinned surface runs from the bed to the face of the batter over this distance past the bench (they meet to within the noise of the land)
const JUNCTION_LEVEL = 0.6;            // m: two ways meet at a junction when their beds differ by less than this where they meet (more: one is over the other)
const CLOSED_MIN_SAMPLES = 6;          // a ring has at least this many samples (a way shorter than 20 m that ends where it starts is a stub)
const BRIDGE_JOIN = 8.0;               // m: a street whose end lies this close to the end of a bridge (or a tunnel) runs onto it
const END_JOIN = 3.0;                  // m: the ends of ways this close to one another meet at one node
const JUNCTION_TOUCH = 0.6;           // m: a way whose centre line lies within the pavement (+ this) of another way runs into it: the apron of the junction is the level of that way
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
  const segTan0 = [], segTan1 = [];   // the tangents of the bed at the two ends of every segment (slope times length: the cubic Hermite curve, road-bed.js)
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
   * How far a FILL (the bench stands above the land at its edge) lifts the ground at `edge` m past the bench, in metres above the land.
   * Two shapes, and the ground follows the one that hugs the land closer:
   *   - the RAMP: the slope limit from the level of the way (an embankment over flat land: 0.8 down per m);
   *   - the SHIFT: the land itself, lifted by the overhang of the bench and sinking back at `fillSlope` per m (a way on the edge of a cliff).
   * The ramp alone never catches a land that falls faster than the limit: it carried the ground up to 6 m above a cliff and ended in a wall of
   * 6 m/m (the pedestrian way above the Alzette: land 2.3, ground 6.7).  The shift is steeper than the land by only `fillSlope`.
   * `overhang` is how far the bench stands above the land at the edge of the bench (>= 0); `level` fades out the fill of a viaduct.
   */
  function fillDeviation(bed, ground, overhang, edge, level) {
    const ramp = Math.max(0, bed - ground - ROAD.maxBatterSlope * edge);
    if (edge <= 0) return level * ramp;                          // (on the way itself the ground is the level of the way)
    const shift = Math.max(0, overhang - ROAD.fillSlope * edge);
    return level * Math.min(ramp, shift);
  }

  /**
   * Where the batter on one side of a way ends, in metres past the edge of the pavement.
   * The ground beside a road is the land, but the carve may never make it steeper than the slope limit, so the
   * ground follows a ramp of at most that slope from the level of the road until the ramp reaches the land again.
   * The batter ends there: the ground of the carve is the land itself, so the batter leaves no step behind it.
   * Where the land is steeper than the limit the ramp never catches it (a cliff beside a road): the batter then runs
   * to its full length.
   * `nx, nz` points away from the way, `bed` is the level of the road, `a0` the edge of the pavement.
   */
  function batterLength(px, pz, nx, nz, bed, a0, maxEdge, overhang) {
    if (overhang <= 0) return maxEdge;                 // (a cut: its face is the land shifted down, see carve())
    let lastFail = -1;
    for (let e = 0; e <= maxEdge + 1e-6; e += BATTER_STEP) {
      const g = baseHeight(px + nx * (a0 + e), pz + nz * (a0 + e));
      // the fill reaches the land when it no longer lifts the ground
      if (fillDeviation(bed, g, overhang, e, 1) > BATTER_TOL) lastFail = e;
    }
    if (lastFail < 0) return maxEdge;
    return Math.min(maxEdge, lastFail + BATTER_STEP);
  }

  const closedRoad = new Uint8Array(roads.length);     // the rings (a pedestrian square, a loop): they have no ends, so no end cap
  const priority = new Float32Array(roads.length);     // the order of the design: the bigger way has the higher number (it wins at a junction)
  const prep = [];                   // the ways that are carved, with everything the second pass needs
  // ---- the crossings: which way rides over which -------------------------
  // At a crossing the two ways are at their own level.  If one of them is more than OVER_LEVEL higher than the
  // other, it rides OVER it: its earthworks (the fill of the DTM) are the ground there, so it is never carved, and
  // the ground under it is protected.  The way that goes under it may not dig a hole in it: the reviewer saw the cut
  // of the lower road carved into the crossing road, so the bridge road dived into a dark pit.
  const overRoads = new Set();
  const crossings = [];            // the crossings of two ways where one of them rides over the other
  const crossingKeys = new Set();

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

  function findCrossings() {
    for (const chain of chains) if (chain.tagged) overRoads.add(chain.road);
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

  /** The class of a way for the order of the design: the bigger way is designed first and the smaller ones meet it. */
  const CLASS_RANK = { motorway: 9, motorway_link: 8.5, trunk: 8, trunk_link: 7.5, primary: 7, primary_link: 6.5, secondary: 6, secondary_link: 5.5,
    tertiary: 5, tertiary_link: 4.5, unclassified: 4, residential: 4, living_street: 3, road: 3, pedestrian: 2, busway: 2, service: 2, track: 1 };
  const roadRank = (road, hw) => (CLASS_RANK[road.kind] ?? 1) + hw * 0.01;

  /** The junctions.  Two kinds, and both give ONE level surface at the meeting point:
   *   - the ENDS of ways that meet at a node (a street that OSM splits into two ways, with a side street ending at the same
   *     node): the bed of every one of them at the end is the mean of the beds that were designed for them on their own;
   *   - a way that runs INTO the carriageway of another way (a side street ends on the main road, two roads cross): it is pinned
   *     to the bed of the way that was designed before it (a bigger class, or the same class and longer).  The end cap of a
   *     way is not a junction of this kind (the through street beside it passes it, it does not cross it).
   *  The pins are heavy weights in the smoother (road-bed.js), so a profile reaches its junction smoothly instead of with a hump
   *  (the reviewer's "rides on a blanket" was, among other things, the beds of a crossing differing by a hand's breadth and being
   *  averaged into a bump on the carriageway). */
  function reconcileJunctions() {
    const GC = 32;
    const gkey = (cx, cz) => cx * 4096 + cz;
    // ---- 1. the ends that meet
    const endGrid = new Map();
    const ends = [];
    for (const chain of chains) {
      const n = chain.x.length;
      for (const k of n > 1 ? [0, n - 1] : [0]) {
        const e = { chain, k, x: chain.x[k], z: chain.z[k], h: chain.bed[k], cluster: -1 };
        ends.push(e);
        const kk = gkey(Math.floor(e.x / GC), Math.floor(e.z / GC));
        const list = endGrid.get(kk);
        if (list) list.push(e); else endGrid.set(kk, [e]);
      }
    }
    const endPins = new Map();                  // chain -> Map(sample index -> level)
    const pinOf = (chain) => { let m = endPins.get(chain); if (!m) { m = new Map(); endPins.set(chain, m); } return m; };
    for (const e of ends) {
      if (e.cluster >= 0) continue;
      const members = [e];
      e.cluster = 1;
      for (let qi = 0; qi < members.length; qi++) {              // the ends within END_JOIN of one another (transitively)
        const m = members[qi];
        const cx = Math.floor(m.x / GC), cz = Math.floor(m.z / GC);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          for (const o of endGrid.get(gkey(cx + dx, cz + dz)) || []) {
            if (o.cluster >= 0 || o.chain === m.chain && o.k === m.k) continue;
            if (Math.hypot(o.x - m.x, o.z - m.z) <= END_JOIN) { o.cluster = 1; members.push(o); }
          }
        }
      }
      if (members.length < 2) continue;
      const hs = members.map((m) => m.h).sort((a, b) => a - b);
      const mid = hs[hs.length >> 1];
      const same = members.filter((m) => Math.abs(m.h - mid) <= JUNCTION_LEVEL);       // the way at another level rides over or under
      if (same.length < 2) continue;
      const mean = same.reduce((sum, m) => sum + m.h, 0) / same.length;
      for (const m of same) pinOf(m.chain).set(m.k, mean);
    }
    // ---- 2. the ways that run into the carriageway of a way designed before them
    const order = chains.slice().sort((a, b) => b.rank - a.rank || b.x.length - a.x.length || a.road - b.road);
    order.forEach((chain, idx) => { priority[chain.road] = order.length - idx; });
    const grid = new Map();
    for (const chain of order) {
      const pins = endPins.get(chain) || new Map();
      const n = chain.x.length;
      for (let k = 0; k < n; k++) {
        const x = chain.x[k], z = chain.z[k];
        let bestD = Infinity, bestH = 0;
        const cx = Math.floor(x / GC), cz = Math.floor(z / GC);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const list = grid.get(gkey(cx + dx, cz + dz));
            if (!list) continue;
            for (let q = 0; q < list.length; q += 2) {
              const other = list[q], j = list[q + 1];
              const ax = other.x[j - 1], az = other.z[j - 1];
              const ex = other.x[j] - ax, ez = other.z[j] - az;
              const ll = ex * ex + ez * ez;
              const t0 = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
              // the end cap of the other way is not a crossing (the foot of the perpendicular falls off its end)
              if ((j === 1 && t0 < 0) || (j === other.x.length - 1 && t0 > 1)) continue;
              const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
              const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
              if (d >= bestD || d > other.hw + JUNCTION_TOUCH) continue;
              const h = other.bed[j - 1] + (other.bed[j] - other.bed[j - 1]) * t;
              // A crossing at another level: one of them rides over the other.  The END of a way that stops inside the carriageway of another way is no crossing, it is a T junction
              // whatever the levels its land would give them (a track that climbs out of a pit onto a plateau ended 2.6 m under the road it joins, and the ground climbed a wall there).
              const endsHere = (k <= 1 || k >= n - 2) && d <= other.hw + JUNCTION_TOUCH;
              if (Math.abs(h - chain.bed[k]) > JUNCTION_LEVEL && !(endsHere && !overRoads.has(other.road))) continue;
              bestD = d; bestH = h;
            }
          }
        }
        if (bestD < Infinity) pins.set(k, bestH);
      }
      chain.pins = pins;                                  // (the harness reads them: the profile is free of curvature limits only there)
      if (pins.size) chain.bed = designBed(chain.ground, chain.arc, pins, chain.closed, chain.kind, chain.ends);
      for (let i = 1; i < n; i++) {
        const x0 = Math.floor(Math.min(chain.x[i - 1], chain.x[i]) / GC), x1 = Math.floor(Math.max(chain.x[i - 1], chain.x[i]) / GC);
        const z0 = Math.floor(Math.min(chain.z[i - 1], chain.z[i]) / GC), z1 = Math.floor(Math.max(chain.z[i - 1], chain.z[i]) / GC);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
          const kk = gkey(cx, cz);
          const list = grid.get(kk);
          if (list) list.push(chain, i); else grid.set(kk, [chain, i]);
        }
      }
    }
  }

  // The ends of the bridges (the ways that ride over the ground, not the tunnels): a street that ends there runs onto a bridge, and the terrain at its end is the
  // edge of a valley that the street does not follow (designBed)
  const bridgeEndPoints = [], tunnelEndPoints = [];
  for (const road of roads) {
    if (!road.pts || road.pts.length < 2) continue;
    const list = road.tunnel ? tunnelEndPoints : road.over || (road.layer || 0) >= 1 ? bridgeEndPoints : null;
    if (list) list.push(road.pts[0], road.pts[road.pts.length - 1]);
  }
  const near = (list, x, z) => list.some((p) => Math.hypot(p[0] - x, p[1] - z) <= BRIDGE_JOIN);
  const endOf = (x, z) => (near(bridgeEndPoints, x, z) ? 'bridge' : near(tunnelEndPoints, x, z) ? 'tunnel' : null);

  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    firstSample[ri] = -1; firstSeg[ri] = -1; segCount[ri] = 0; info[ri] = null;
    // A way that rides OVER the ground: OSM says so (a bridge, or a layer above the others).  It is never carved
    // into the height function and the ground under it is protected (see the crossings below).
    const tagged = !!(road.over || (road.layer || 0) >= 1);
    // The centre line of the way, as the game draws it: the polyline resampled and its corners rounded.
    // Every way needs it: the drivable ones are carved along it, and the ones that ride over the ground
    // protect the ground under them along it.
    const rs = resample(road.pts, ROAD.sampleSpacing);
    const n = rs.x.length;
    if (n < 2) continue;
    if (n > 4) {                                     // round the corners of the (sparse) OSM polyline; the two end points stay where they are
      const sx = gaussianSmooth(rs.x, ROAD.lineSmoothing / ROAD.sampleSpacing);
      const sz = gaussianSmooth(rs.z, ROAD.lineSmoothing / ROAD.sampleSpacing);
      for (let i = 1; i < n - 1; i++) { rs.x[i] = sx[i]; rs.z[i] = sz[i]; }
    }
    const kind = kindInfo(road.kind);
    const hw = Math.max(0.8, road.width / 2);
    // the kerb belongs to the material of the way itself: a cobbled street has one, a paved area has none
    const kerbH = KERB_SURFACES.has(road.surface || kind.surface) ? ROAD.kerbHeight : 0;
    const kerbW = kerbH > 0 ? ROAD.kerbWidth : 0;
    // A service way that dives into a tunnel is a garage ramp: the class default of 2.5 m of pavement (bake_roads URBAN_PAVEMENT) is for streets, and on a ramp it is a grey slab
    // field lying over the verge and the trench (the start of the game).  A ramp has no pavement.
    const isGarageRamp = road.kind === 'service' && (endOf(rs.x[0], rs.z[0]) === 'tunnel' || endOf(rs.x[n - 1], rs.z[n - 1]) === 'tunnel');
    const pw = isGarageRamp ? 0 : Math.max(0, road.sidewalk);
    // The bench of the road is the carriageway and its kerb; the pavement beside it is PAINT, not a bench.
    // A wide pavement would dig the ground deeper into the hillside and build a wall beside the street (the
    // reviewer saw one), so the carve keeps its narrow bench and the pavement is painted on the ground beside it.
    const bench = hw + kerbW;
    const a0 = bench + pw;
    // A way that rides over the ground protects it, whether a car may drive on it or not: the footpath bridge
    // of a park stands over a street, and the street may not dig a pit under it.
    if (tagged && !road.tunnel) overCorridors.push({ x: rs.x, z: rs.z, half: a0 + PROTECT_MARGIN });
    // Only the roads a car may drive on are carved. A footpath or a staircase is not a road: carving it would cut a
    // trench into the hillside where the path follows a steep slope. A tunnel cannot be a trench in a single valued
    // height field (it gets a portal instead) and a way that rides over the ground is a deck (decks.js).
    if (!road.info.drivable) continue;
    if (road.tunnel || tagged) {
      // A tunnel and an over way are not carved.  The ground under an over way is protected: the way that goes
      // under it may not dig a hole in it (the reviewer saw the bridge road dive into a dark pit).
      continue;
    }
    // the terrain under the centre line; the bed (the profile of the surface) is designed below, once every way is known,
    // because the ways that meet must agree on the level of their junction
    const ground = rs.x.map((x, i) => baseHeight(x, rs.z[i]));
    // Every drivable way keeps its centre line and its bed: the crossings of the ways decide which one rides over
    // which.  That is how an overpass that OSM does not tag as a bridge (a slip road on a viaduct) is found.
    const arc = new Float64Array(n);
    for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]);
    // a ring (the last sample at the first one): its profile is periodic, see designBed
    const closed = n >= CLOSED_MIN_SAMPLES && Math.hypot(rs.x[0] - rs.x[n - 1], rs.z[0] - rs.z[n - 1]) <= END_JOIN;
    const ends = closed ? null : { start: endOf(rs.x[0], rs.z[0]), end: endOf(rs.x[n - 1], rs.z[n - 1]) };
    const chain = { road: ri, kind: road.kind, x: rs.x, z: rs.z, arc, ground, bed: null, tagged, hw, rank: roadRank(road, hw), closed, ends };
    chains.push(chain);
    if (closed) closedRoad[ri] = 1;
    prep.push({ ri, road, rs, n, hw, kerbH, kerbW, pw, bench, a0, kind, chain });
  }

  // ---- the bed of every way: designed on its own first (this decides which way rides over which), then again with the
  // junctions pinned to the ways that were designed before ----
  for (const chain of chains) chain.bed = designBed(chain.ground, chain.arc, null, chain.closed, chain.kind, chain.ends);
  findCrossings();
  reconcileJunctions();

  for (const { ri, road, rs, n, hw, kerbH, kerbW, pw, bench, a0, kind, chain } of prep) {
    const bed = chain.bed;
    const slope = bedSlopes(bed, chain.arc);
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
      // The NOTCH of the way on each side: how deep the bench of the way is cut into the land (or how high the way
      // stands above it).  The ground beside the way is the land itself, shifted by the notch: the face of a cutting
      // is the shape of the hillside it is cut into, and the ground under an embankment is the shape of the ground it
      // stands on.  The notch is measured on the land at the edge of the bench, so the two meet exactly.
      notchR[s] = baseHeight(rs.x[i] + nx * bench, rs.z[i] + nz * bench) - bed[i];
      notchL[s] = baseHeight(rs.x[i] - nx * bench, rs.z[i] - nz * bench) - bed[i];
      fadeR[s] = batterLength(rs.x[i], rs.z[i], nx, nz, bed[i], bench, maxEdge, -notchR[s]);
      fadeL[s] = batterLength(rs.x[i], rs.z[i], -nx, -nz, bed[i], bench, maxEdge, -notchL[s]);
    }
    // the distance along the centre line: the shader draws the lane markings as dashes along it
    const along = new Float64Array(n);
    for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]);
    const kindCode = ROAD_KINDS.indexOf(road.kind);
    for (let i = 0; i < n - 1; i++) {
      segAx.push(rs.x[i]); segAz.push(rs.z[i]); segBx.push(rs.x[i + 1]); segBz.push(rs.z[i + 1]);
      segB0.push(bed[i]); segB1.push(bed[i + 1]);
      segTan0.push(slope[i] * (chain.arc[i + 1] - chain.arc[i])); segTan1.push(slope[i + 1] * (chain.arc[i + 1] - chain.arc[i]));
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
  const TAN0 = Float32Array.from(segTan0), TAN1 = Float32Array.from(segTan1);
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
  /** The signed distances of the paint are capped here: beyond it no road is near, and a cap that is positive on both
   *  nodes of a quad can never put an edge in the quad (the zero crossing of a lerp needs a node on each side). */
  const SD_FAR = 8;
  /** The lane markings stop this far before the carriageway of a road that crosses (m past its half width), and the
   *  roads count as crossing when their directions differ by more than this (sine): two ways that continue one street
   *  meet end to end at a small angle and are not a junction. */
  const MARK_CLEAR = 3.5, CROSS_SIN = 0.35, MAX_PARTNERS = 6;
  const candI = new Int32Array(MAX_CAND), candD = new Float32Array(MAX_CAND), candT = new Float32Array(MAX_CAND), candLat = new Float32Array(MAX_CAND), candOver = new Float32Array(MAX_CAND);
  const pinPri = new Float32Array(MAX_PINS), pinVal = new Float32Array(MAX_PINS), pinWt = new Float32Array(MAX_PINS);
  const pinEdge = new Float32Array(MAX_PINS), pinBed = new Float32Array(MAX_PINS);   // per pin: the distance to the edge of its bench (negative inside) and the level of its carriageway
  const armOf = new Int32Array(MAX_CAND), armFirst = new Uint8Array(MAX_CAND), slotRoad = new Int32Array(MAX_CAND), slotArm1 = new Int32Array(MAX_CAND), slotArm2 = new Int32Array(MAX_CAND);
  const partnerId = new Int32Array(MAX_PARTNERS), partnerDx = new Float32Array(MAX_PARTNERS), partnerDz = new Float32Array(MAX_PARTNERS);
  // What one segment of a way gives a point: the bed under the foot of the perpendicular, the NOTCH of the way on this side (how deep the bench of the way is cut
  // into the land, or how high the way stands above it) and the length of the batter, interpolated along the segment.
  // The side of the way is a smooth function of the direction (+1 straight to the right, -1 straight to the left): the sign of the offset from the LINE of a
  // segment flips on its extension, in the wedge around a corner of the way where the nearest point is the corner itself, and the notches of the two sides
  // differ by the hillside (metres).
  let sBed = 0, sNotch = 0, sFade = 0;
  function segmentState(k) {
    const i = candI[k], t = candT[k], s0 = SAMP0[i];
    const right = smoothstep(-0.5, 0.5, candD[k] > 1e-6 ? candLat[k] / candD[k] : 0);
    sBed = hermite(BED0[i], BED1[i], TAN0[i], TAN1[i], t);
    sNotch = right * (NOTCHR[s0] + (NOTCHR[s0 + 1] - NOTCHR[s0]) * t) + (1 - right) * (NOTCHL[s0] + (NOTCHL[s0 + 1] - NOTCHL[s0]) * t);
    sFade = right * (FADER[s0] + (FADER[s0 + 1] - FADER[s0]) * t) + (1 - right) * (FADEL[s0] + (FADEL[s0 + 1] - FADEL[s0]) * t);
  }
  const scratch = { coverage: 0, bed: 0, band: 0, kerb: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, dist: 0, lines: 0, lanes: 0, s: 0, surface: 0, sdCar: SD_FAR, sdPave: SD_FAR, junction: 0 };

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
   *   lat      the signed distance to the way (positive = to the right of it): the paint of the carriageway is
   *            the band within the half width of this distance, so the edge of the tarmac follows the way itself
   *            and not the infinite line of one of its segments
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
    // The UNION of the carriageways and of the pavements, as signed distances (negative = inside).  The edge of the paint
    // is the zero of these, and a min over all the roads is continuous in the place: the lattice interpolates it into
    // a straight line.  The offset of ONE nearest road (lat, hw, a0) jumps where the nearest road changes, and the jump
    // was the ragged kerb and pavement the reviewer saw.
    let sdCar = SD_FAR, sdPave = SD_FAR, sdCarRoad = -1, sdCar2 = SD_FAR;   // (sdCar2: the nearest carriageway edge of a DIFFERENT road than the nearest one)
    let dispX = 0, dispZ = 0, disp2X = 0, disp2Z = 0;                        // (the offsets of the point from those two roads: opposite ones = the point lies BETWEEN them)
    let partners = 0;               // the marked roads whose carriageway (plus the clearance) holds this point
    // ---- pass 1: the segments that reach this point.  Only the NEAREST segment of every way takes part (and, where the same way
    // comes back past this point - a hairpin, a loop - the nearest segment of the other arm): the ground at a point is the
    // ground of the way as it passes THIS point.  Summing every segment in reach (the first version) mixed in the bed of
    // the segments 5 .. 20 m along the same road, and their batter is the noisy LAND, so the noise of the land leaked into
    // the carriageway with a weight of a third: the ripples a driver felt.
    let nCand = 0;
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
          const t0 = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
          const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
          const rx = x - (ax + ex * t), rz = z - (az + ez * t);
          const len = Math.sqrt(ll) || 1;
          const lat = (rx * -ez + rz * ex) / len;         // the signed offset from the LINE of the way (right is positive)
          const d = Math.hypot(rx, rz);                  // the distance to the SEGMENT of the way
          if (d >= reach || nCand >= MAX_CAND) continue;
          // how far the point lies beyond the END of the way (0 along the way): the carriageway ends at the end of the way
          let over = 0;
          if (closedRoad[ROADOF[i]]) over = 0;
          else if (t0 < 0 && i === firstSeg[ROADOF[i]]) over = -t0 * len;
          else if (t0 > 1 && i === firstSeg[ROADOF[i]] + segCount[ROADOF[i]] - 1) over = (t0 - 1) * len;
          candI[nCand] = i; candD[nCand] = d; candT[nCand] = t; candLat[nCand] = lat; candOver[nCand] = over; nCand++;
        }
      }
    }
    // ---- pass 2: pick the arms (the nearest segment of a way; the nearest segment of its other arm, 3+ segments away)
    let nArms = 0, nSlots = 0;
    for (let c = 0; c < nCand; c++) {
      const r = ROADOF[candI[c]];
      let sl = 0;
      while (sl < nSlots && slotRoad[sl] !== r) sl++;
      if (sl === nSlots) { slotRoad[sl] = r; slotArm1[sl] = c; slotArm2[sl] = -1; nSlots++; }
      else if (candD[c] < candD[slotArm1[sl]]) slotArm1[sl] = c;
    }
    for (let c = 0; c < nCand; c++) {
      let sl = 0;
      while (slotRoad[sl] !== ROADOF[candI[c]]) sl++;
      const a1 = slotArm1[sl];
      if (c === a1 || Math.abs(candI[c] - candI[a1]) < ARM_GAP) continue;
      if (slotArm2[sl] < 0 || candD[c] < candD[slotArm2[sl]]) slotArm2[sl] = c;
    }
    for (let sl = 0; sl < nSlots; sl++) {
      armOf[nArms] = slotArm1[sl]; armFirst[nArms++] = 1;
      if (slotArm2[sl] >= 0) { armOf[nArms] = slotArm2[sl]; armFirst[nArms++] = 0; }
    }
    // ---- the paint and the identity of the road under the point: the nearest segment of a way, and the nearest segment of its other arm
    for (let ar = 0; ar < nArms; ar++) {
      const c = armOf[ar];
      const i = candI[c], t = candT[c], lat = candLat[c], d = candD[c];
      {
        {
          const ex = X1[i] - X0[i], ez = Z1[i] - Z0[i];
          const len = Math.sqrt(ex * ex + ez * ez) || 1;
          const a0 = A0[i];
          segmentState(c);
          const bed = sBed;
          // A way that stands far ABOVE the land (a viaduct) is not painted: its overhang over the land at the edge of the bench is the measure
          // (the level is a function of that overhang, which varies smoothly along the face; measured at this point - ground minus bed - it jumped to 1 where
          // the notch changes sign, a step of up to 0.7 m in the ground beside a way on an embankment)
          const level = 1 - smoothstep(LEVEL_FULL, LEVEL_FADE, -sNotch);
          if (level >= 0.5) {
            const eCar = d - HW[i], ePave = d - a0;
            const roadHere = ROADOF[i];
            const offX = -lat * ez / len, offZ = lat * ex / len;
            if (eCar < sdCar) {
              if (sdCarRoad !== roadHere) { sdCar2 = sdCar; disp2X = dispX; disp2Z = dispZ; }
              sdCar = eCar; sdCarRoad = roadHere; dispX = offX; dispZ = offZ;
            } else if (roadHere !== sdCarRoad && eCar < sdCar2) { sdCar2 = eCar; disp2X = offX; disp2Z = offZ; }
            if (ePave < sdPave) sdPave = ePave;
            if (LINES[i] > 0 && eCar < MARK_CLEAR && partners < MAX_PARTNERS) {
              partnerId[partners] = ROADOF[i]; partnerDx[partners] = ex / len; partnerDz[partners] = ez / len; partners++;
            }
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
          // The distance that decides it is the distance to the SEGMENT, not the offset from the infinite
          // line of the segment: a street that curls into a loop paints a disc when the paint follows the
          // line, and a disc is not a street.
          // The score has to keep falling with the distance at EVERY distance.  It used to stop falling at the
          // edge of the carriageway (the offset from the line was clamped to the half width), so past the
          // carriageway every way scored the same and an arbitrary one won: the offset of the paint jumped
          // from way to way, and the edge of the tarmac tore into the ragged steps the reviewer saw.  Now the
          // nearest way wins out there, and the offset is the distance to the polyline: a straight street has a
          // straight edge, because that distance is a linear function of the place.
          const hw = HW[i];
          const score = ((d <= hw ? 2 : 1) + 1 - d / Math.max(R, 1)
                         - Math.min(hw, 12) * 0.02) * level;
          if (score > bestScore) { bestScore = score; best = i; bestLat = lat >= 0 ? d : -d; bestDist = d; bestT = t; }
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
    // ---- the ground, way by way.  Every segment of a way that is about as near as the nearest one counts, weighted by how much nearer the nearest is (Shepard weights):
    // the nearest segment alone jumps along a line - on the inner side of a bend the feet of the perpendiculars of two segments differ by the gradient times their
    // distance, and where a ring or a hairpin comes back past the point the nearest arm changes - and the bed, the face and the pin of the way are means, so nothing
    // jumps where the nearest segment changes.
    let nPins = 0;                         // the carriageway: the bed of the ways whose carriageway (plus the pavement) holds this point
    let devSum = 0, devW = 0;              // the batter: how far the roads pull the ground here, and how much they claim it
    for (let sl = 0; sl < nSlots; sl++) {
      const road = slotRoad[sl];
      const dMin = candD[slotArm1[sl]];
      if (NOBATTER[candI[slotArm1[sl]]]) continue;             // a way that rides over the others keeps the DTM (its fill): no batter, no pin
      let wAll = 0, claimSum = 0, devAcc = 0, pinSum = 0, pinValSum = 0, pinBedSum = 0, pinMagSum = 0, pinMagW = 0;   // (pinMag: the strength of the pin of the way here)   // (a segment that does not reach the point counts with zero claim and zero pin: the weights of a way fade out where its batter ends)
      for (let k = 0; k < nCand; k++) {
        const i = candI[k];
        if (ROADOF[i] !== road) continue;
        // how much this segment counts: the nearer it is to the nearest one the more, and the farther its foot is from its ends the more (the foot of a perpendicular
        // that is a corner of the way is the corner itself, and the neighbour of the nearest segment would pull the bed of a straight road toward its own end)
        const q = (dMin + SHEPARD_OFFSET) / (candD[k] + SHEPARD_OFFSET);
        const nearness = q * q * q * q;
        if (nearness < SHEPARD_MIN) continue;
        const along = Math.min(candT[k], 1 - candT[k]) * Math.hypot(X1[i] - X0[i], Z1[i] - Z0[i]);
        const w = nearness * (FOOT_FLOOR + smoothstep(0, FOOT_FADE, along));
        wAll += w;
        const d = candD[k], bench = BENCH[i], edge = d > bench ? d - bench : 0;
        segmentState(k);
        const bed = sBed, notch = sNotch, fadeLen = sFade;
        const level = 1 - smoothstep(LEVEL_FULL, LEVEL_FADE, -notch);
        // ---- the batter: the face of the cutting or of the embankment beside the road.
        // The ground beside a road is the LAND, and the road is cut into it.  The face starts at the edge of the bench, at the level of the road, and it goes back to the
        // land over the length of the batter without ever being steeper than the land itself (or than the slope limit where the land is flatter): the ground beside a road
        // is never a wall (the reviewer saw one: a grey slab running up the hill).
        //   A CUT (the land is above the way): the ground beside the way is the LAND itself, shifted down by the depth of the notch, the shift fading out over the batter.
        //   A FILL (the way stands above the land): fillDeviation().
        let dev = 0, reach = fadeLen, applies = true;       // (the batter ends; the carriageway and its fade, below, do not)
        if (notch >= 0) {
          reach = REACH[i] - bench;
          if (reach <= 0 || edge >= reach) applies = false;
          else dev = edge > 0 ? -notch * (1 - smoothstep(0, reach, edge)) : bed - ground;     // (on the way itself the ground is the level of the way: the road is flat across its width)
        } else if (edge >= fadeLen) {
          applies = false;
        } else {
          // The fill of a way far above the land (a viaduct) must not fill the valley under it: it fades with the overhang of the bench, which is the same all along the
          // face.  (Fading it with the drop of the land at THIS point made the face of a fill on a steep hillside a stair, and the ground dropped 7 m in a metre.)
          dev = fillDeviation(bed, ground, -notch, edge, level) * (1 - smoothstep(fadeLen - FILL_TAPER, fadeLen, edge));
        }
        if (applies) {
          // The claim of the batter: full on the road, and gone at the far end of the batter.  It is squared so that a road further away does not pull the ground of
          // the road the point is on.
          const fall = 1 - edge / reach;
          claimSum += w * fall * fall; devAcc += w * fall * fall * dev;
        }
        // ---- the carriageway (and the pavement beside it) lies exactly at the bed of its way: a pin that is 1 on the road and fades out over PIN_FADE metres.
        // What the pin pulls the ground toward is the surface of THIS way: the bed within the bench, and beside it the face of its own batter.  Pulling toward the flat
        // bed (the first version) multiplied the slope of the ground by 1 + e * |pin'| = 1.75 over the whole fade whenever the hillside was not flat.
        const over = candOver[k];
        const pin = (1 - smoothstep(bench, bench + PIN_FADE, d)) * (1 - smoothstep(0, CAP_SOFT, over));
        if (pin > 0) {
          // The level the pin pulls toward is the bed within the bench of the NEAREST segment of the way (dMin) and its face beyond: it is a property of the point and of the way, not of the
          // segment.  (Per segment, a segment on the far side of a tight bend had its own distance beyond the bench and pulled the carriageway toward the face of its batter.)
          const face = ground + (applies ? dev : 0);
          pinSum += w * pin; pinValSum += w * pin * (face + (bed - face) * (1 - smoothstep(bench, bench + Math.max(FACE_JOIN, FACE_JOIN_PER_M * Math.abs(bed - face)), dMin))); pinBedSum += w * pin * bed;
        }
        { const wm = w * (1 - smoothstep(MAG_WINDOW[0], MAG_WINDOW[1], d - dMin)); pinMagSum += wm * pin; pinMagW += wm; }
      }
      if (claimSum > 0 || pinSum > 0) {
        devSum += devAcc / wAll; devW += claimSum / wAll;
        if (pinSum > 0 && nPins < MAX_PINS) {
          pinPri[nPins] = priority[road]; pinVal[nPins] = pinValSum / pinSum; pinWt[nPins] = pinMagSum / pinMagW;
          pinBed[nPins] = pinBedSum / pinSum; pinEdge[nPins] = dMin - BENCH[candI[slotArm1[sl]]];
          nPins++;
        }
      }
    }
    let bandY = devW > 0 ? ground + devSum / devW : ground;
    // The ways lay their carriageway over the ground in the order of their rank: the smallest way first, the biggest last, so
    // that at a junction the surface IS the bed of the bigger way (flat across, smooth along) and the side street joins it.
    // Averaging the beds of the ways that meet (the first version) made a hump of a hand's breadth on the main road.
    for (let a = 1; a < nPins; a++) {                          // insertion sort by priority, ascending (a handful of entries)
      const pr = pinPri[a], v = pinVal[a], wt = pinWt[a], ed = pinEdge[a], bd = pinBed[a];
      let b = a - 1;
      while (b >= 0 && pinPri[b] > pr) { pinPri[b + 1] = pinPri[b]; pinVal[b + 1] = pinVal[b]; pinWt[b + 1] = pinWt[b]; pinEdge[b + 1] = pinEdge[b]; pinBed[b + 1] = pinBed[b]; b--; }
      pinPri[b + 1] = pr; pinVal[b + 1] = v; pinWt[b + 1] = wt; pinEdge[b + 1] = ed; pinBed[b + 1] = bd;
    }
    // A carriageway belongs to its own way.  Where two ways lie side by side (or one inside the other) at different levels, the bigger way used to lay its pin - and its 3 m fade -
    // over the carriageway of the smaller one, and a bed that is smooth was cut up by 1 .. 8 cm (Boulevard de la Foire: 15 m/s2).  Now a way is held back by every way laid BELOW it
    // (a smaller one) whose carriageway is at another level and which this point is farther from: the hand-over from one level to the other is centred on the line of equal distance
    // from the two benches and as wide as the steepest allowed ground between two levels (RAMP_SLOPE).  Ways at one level (junctions) are not held back at all.
    for (let a = 0; a < nPins; a++) {
      let hold = 1;
      for (let b = 0; b < a; b++) {
        const apart = Math.abs(pinBed[a] - pinBed[b]);
        const sep = smoothstep(SEP_LOW, SEP_HIGH, apart);
        // one level: the fade of the bigger way (a) is held off the bench of the smaller one (b), where a's own bench does not hold the point; two levels: the hand-over is centred between the two
        const own = (1 - smoothstep(0, OWN_FADE, pinEdge[b])) * smoothstep(0, OWN_FADE, pinEdge[a]);
        const half = Math.min(RAMP_MAX, Math.max(RAMP_MIN, (1.5 * apart) / RAMP_SLOPE));
        // (a rival that has no pin here - the end of a way, the far side of its fade - takes nothing from this way: scaled by the pin of the rival)
        hold *= 1 - pinWt[b] * (1 - ((1 - sep) * (1 - own) + sep * (1 - smoothstep(-half, half, pinEdge[a] - pinEdge[b]))));
      }
      bandY += (pinVal[a] - bandY) * pinWt[a] * hold;
    }
    out.band = ground + (1 - prot) * (bandY - ground);
    // A junction: two marked roads of different ways that cross at an angle meet here.  The lane markings are cut
    // before it (a dash that ends in the middle of the crossing street is the fragment the reviewer saw).
    let junction = 0;
    for (let a = 0; a < partners && !junction; a++) {
      for (let b = a + 1; b < partners; b++) {
        if (partnerId[a] !== partnerId[b] && Math.abs(partnerDx[a] * partnerDz[b] - partnerDz[a] * partnerDx[b]) > CROSS_SIN) { junction = 1; break; }
      }
    }
    out.junction = junction;
    if (sdCar2 < SD_FAR && sdCar >= 0 && dispX * disp2X + dispZ * disp2Z < 0) sdPave = Math.min(sdPave, sdCar + sdCar2 - MEDIAN_WIDTH);   // the median between two carriageways: paved as a whole, the edges are the kerbs
    if (best < 0) {
      out.coverage = 0; out.bed = 0; out.kerb = 0; out.lat = 0; out.hw = 0; out.a0 = 0; out.kind = 0; out.road = -1;
      out.dist = Infinity; out.lines = 0; out.lanes = 0; out.s = 0; out.surface = 0;
      out.sdCar = sdCar; out.sdPave = sdPave;
      return out;
    }
    out.sdCar = sdCar; out.sdPave = sdPave;
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
    carve, nearestRoad, roads, info, count, scratch, overRoads, crossings, chains, protection,
    segments: { X0, Z0, X1, Z1, BED0, BED1, TAN0, TAN1, HW, KERBH, KERBW, PW, A0, RAD, REACH, KIND, ROADOF, KERBON, LINES, S0, S1, SURF },
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
