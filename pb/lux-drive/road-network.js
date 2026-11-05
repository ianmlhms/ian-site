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
import { createJunctionSurface } from './junction-surface.js';
import { chainCarriageways } from './carriageways.js';
import { isLandmarkDeck } from './decks.js';

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
const OWN_PROTECT_FADE = 2.0;          // m: ... and away from them only its own carriageway, fading out over this
const CROSSING_MARGIN = 1.0, CROSSING_FADE = 4.0;   // m: ... there the ground is protected this far past its pavement, fading out over this
const CROSSING_PROTECT = 30.0;         // m: a way that the crossings found to ride over another protects the ground within this of its crossings (see the protected corridors)
const PROTECT_RAMP = 1.5;              // m: where a carved way runs onto a bridge, the protection of the ground under the bridge grows from nothing at the abutment to its full strength over this
                                       // distance along the bridge, and is nothing BEFORE the abutment.  The approach road keeps its own bed right up to the deck (the ground under the deck drops
                                       // away from there, hidden by the deck).  With full protection in a disc round the first point of the bridge the approach road followed the valley edge for the last
                                       // 15 m and sagged up to 7 m (110 ends), and the deck, pinned to that surface at its end, started metres above it: a raised box with a vertical face (Rue de Neudorf).
const APPROACH_JOIN = 3.0;             // m: a carved way whose end lies this close to an end of a bridge runs onto it at that end
const DECK_TRUST_WIDTH = 5.0;          // m: the DSM of a deck at least this wide (a carriageway) is its level; a narrower one (a track, a footbridge) is often the canopy over it
const DECK_END_GRADE = 0.12;           // m/m: the deck is continued from its first two points to its end at no steeper grade than this
const APPROACH_LIFT_MAX = 7.0;         // m: a way is lifted onto the deck at its end by at most this; more is a DSM that is not the deck (a canopy)
const APPROACH_LOWER_MAX = 4.0;        // m: ... and lowered to it by at most this (a steep street whose bed ran on past the bank in the air)
const DECK_BELOW_BANK = 1.0;           // m: a deck level more than this under the land at the end of the deck is not the deck (the DSM is the top of everything: a deck under its bank is one under a structure)
const APPROACH_ALIGN = 0.7;            // the cosine between the direction a way leaves through its end and the direction into a bridge: at least this, and the way runs onto the bridge
const GROUNDED_MATCH = 2.0;            // m: a deck belongs to a way when both its ends lie this close to the ends of the way
const GROUNDED_MAX_LENGTH = 16.0;      // m: a narrow deck at most this long ...
const GROUNDED_MAX_DIP = 1.0;          // m: ... over land that dips less than this under it spans nothing (see groundedDeckOf)
const APPROACH_FREE = 20.0;            // m: the last metres of a way that runs onto a bridge are its approach: its carriageway there is not protected (see carve(), protHere)
const ABUT_HOLD = 2.0;                 // m: ... and its carriageway is held at its own level this far under the bridge (the cap of the way starts fading only there, the protection only ramps up
                                       // from there): the 1 m lattice under the first metres of the deck is the road, so the deck starts flush on a level surface, not on the edge of the drop
const DECK_TUCK = 0.08, DECK_TUCK_FROM = 0.4, DECK_TUCK_RUN = 1.0;   // m: under its deck the carriageway of an approach way lies this much lower, reached between these distances past the end of
                                       // the way: flush with the deck at the abutment, and no longer in the same plane as the deck beyond it (the two surfaces fought for the pixels: a ragged seam across the road)
const ABUT_FADE_MAX = 6.0;             // m: past the hold the ground under the deck falls from the deck to the land below over 1.5 x drop / RAMP_SLOPE (an earth abutment under the deck end, never
                                       // steeper than the ramp between two levels), at least CAP_SOFT / PROTECT_RAMP and at most this.  With the fixed 2 m of CAP_SOFT a deck 6 m over the road below
                                       // stood on a vertical face of ground (the world flow's "walls the carve made": 153 of them at the motorway interchanges after the approaches were lifted)
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const MAX_PINS = 16;                   // carriageways that lie over one point, at most
export const CHANNELS = 3;              // the paint channels: the nearest carriageways whose edges the shader takes exactly (tile-mesh.js carriagewayChannels)
const MAX_CAND = 192;                  // segments that reach one point, at most
const FOOT_FADE = 1.0, FOOT_FLOOR = 0.01;   // m: a segment counts fully when the foot of the perpendicular is this far from its ends; the floor of its weight (so the weights never all vanish)
const SHEPARD_OFFSET = 0.5, SHEPARD_MIN = 1e-4;   // the weight of a segment of a way is ((d_nearest + 0.5) / (d + 0.5))^4: equal at equal distance, a few per cent at twice the distance               // m: the segments of a way that are this much farther than its nearest one still count for the ground (weighted by how much nearer the nearest is)
const ARM_GAP = 3;                     // segments: two stretches of one way this far apart are different arms (a hairpin)
const ARM_DETOUR_LO = 6.0, ARM_DETOUR_HI = 12.0;   // m: the ground of a way at a point is the pin of the ARM it passes on; a segment whose foot lies this much farther along the way than straight across from the
                                       // nearest foot (the detour: along minus chord) belongs to another arm of the way (a hairpin, a loop), fading in between.  The two arms of a hairpin at two levels were
                                       // one Shepard blend by distance: the carriageway of the lower arm leaned toward the upper one (Eecherfeld 5070,6192: 16.7 % across)
const ARM_SOFT = 10.0;                 // m: the distance of the other arm is the soft minimum of candD + (1 - share) x this (continuous where a segment's share of the other arm grows)
const CAP_SOFT = 2.0;                  // m: the carriageway pin ends this softly past the END of a way (no flat disc at the end of a street)
const PIN_FADE = 3.0;                  // m: the carriageway level fades into the batter over this distance beyond the pavement
const FILL_TAPER = 3.0;                // m: the last stretch of a fill face where it sinks to the land (the scan that finds the end of the face is coarse)
const MAG_WINDOW = [0.3, 1.2];         // m: the strength of the pin of a way is the mean of the pins of the segments that are about as near as the nearest one (a ring comes back past its own seam:
                                       // the pin of one arbitrary segment of the two jumped where the nearest one changed)
const SEP_LOW = 0.4, SEP_HIGH = 0.8;   // m: two carriageways whose beds differ by less than SEP_LOW are one level (a junction), by more than SEP_HIGH two levels
const RAMP_SLOPE = 1.9;                // m per m: the steepest ground between two carriageways at different levels (a retaining wall hides it, see retaining-walls.js)
const OWN_FADE = 0.5;                  // m: the carriageway of a way is its own from its bench edge to this far past it: a bigger way's fade is not laid over it (same level)
const MEDIAN_FLAT_FADE = 1.0;          // m: the gap of up to MEDIAN_WIDTH between two carriageways at one level (a median) is the straight line from the edge of one to the edge of the other,
                                       // letting go over this much more gap.  Beside a bridge (the approach keeps its own bed, not the junction sheet) the median was a ditch 0.5 m deep under both
                                       // carriageways: its paint frayed and showed grass (Rue de Neudorf, the deck start)
const RAMP_MIN = 0.8, RAMP_MAX = 4.0;  // m: half width of the hand-over from one carriageway to the other, bounds
const FACE_JOIN_PER_M = 0.79;         // the join of the bed and the face is at least as wide as this per m of their difference: a smoothstep is at most 1.5 times as steep as its mean, so the
                                       // ground between a terrace and the face under it never rises faster than RAMP_SLOPE (a terrace on a cliff dropped 5 m in 0.4 m: a crack)
const FACE_JOIN = 0.4;                 // m: the pinned surface runs from the bed to the face of the batter over this distance past the bench (they meet to within the noise of the land)
const JUNCTION_LEVEL = 0.6;            // m: two ways meet at a junction when their beds differ by less than this where they meet (more: one is over the other)
const CLOSED_MIN_SAMPLES = 6;          // a ring has at least this many samples (a way shorter than 20 m that ends where it starts is a stub)
const BRIDGE_JOIN = 8.0;               // m: a street whose end lies this close to the end of a bridge (or a tunnel) runs onto it
const END_JOIN = 3.0;                  // m: the ends of ways this close to one another meet at one node
const JUNCTION_TOUCH = 0.6;           // m: a way whose centre line lies within the pavement (+ this) of another way runs into it: the apron of the junction is the level of that way
export const GARAGE_RAMP_MAX = 40.0;          // m: a service way at most this long that dives into a tunnel (a garage ramp, ~60 in the city) is not a road of the game: it is neither carved nor painted, and
                                       // the trench the DTM has for it is filled to the level of its mouth (GARAGE_PAD_FADE).  Carved, it was a pit with a wall beside the avenue at the very start of the game
                                       // (Avenue J.F. Kennedy: a grey wedge rising from the road edge and a patch of pavement), and no portal leads into the garage anyway
const CUT_WALL_SLOPE = 3.5;             // m per m: the steepest face of the cut of an opened shallow tunnel (tunnel-cover.js; mean 2/3 of it): the faces are steep enough for the retaining walls
                                       // (retaining-walls.js findRamp: a place >= 2 m/m), a real cut with walls - the batter of 1 : 1.67 left plain slopes (the A1 under deck 32, bridges8)
const GARAGE_TRENCH_IN = 25.0;          // m: ... and the first this many metres of its tunnel (the DTM shows the open ramp there too: a pit where no portal stands)
const GARAGE_PAD_FADE = 2.0;           // m: the fill of a garage ramp runs out into the land over this past its half width
const WIDTH_TAPER = 12.0;              // m of length per m of half width: where the width of a carriageway changes from one way to the next (a lane added or dropped: Av. J.F. Kennedy 2 / 3 / 4 lanes)
                                       // the tarmac of the WIDER way narrows to the other one at 1 : 12 (as markings.js tapers its lines), never a step at the joint
const MINOR_HW = 3.4;                   // m: a carriageway at least this wide (half width) is a street; the narrower service ways get the lighter tar of the ground shader.  The shader reads that from
                                       // sdMajor, the signed distance to the union of the STREET carriageways (continuous): from the half width of the one nearest way it was a switch per lattice node,
                                       // and where a service way overlaps the avenue at a junction the pale tar came in a sawtooth of 1 m steps (Avenue J.F. Kennedy, Ian's junction view)
const KERB_SURFACES = new Set(['asphalt', 'cobble', 'concrete']);
const PAINT_LEVEL_TOL = 0.20;          // m: a way paints its carriageway where the ground lies within this of its bed ...
const PAINT_LEVEL_PUSH = 8.0;          // ... and beyond that its edge moves in by this many m per m of the difference (see carve(), the paint)
const SHEET_GAP_HOLD = 1.5;            // m: in a junction the sheet (junction-surface.js) holds the ground this far past the bench of a way at its level: a gap of up to 2 x this between two carriageways
                                       // (a median, the nose of a slip road, the wedge where a dual carriageway splits) is at road level, not a dip to the land
const SHEET_MEET_FADE = 16.0;           // m: a point is in a junction while a second way at its level is within its bench + SHEET_GAP_HOLD + this (fading out)
const SHEET_GAP_FADE = 2.0;            // m: ... and lets go of it over this distance
const SHEET_CROSS_MAX = 0.02;          // m/m: on the carriageway of a way away from the other ways of its junction the sheet tilts it across by at most this (a plane fitted to a junction carries the
                                       // gradient of the main road, or the level difference of two ways side by side, across the side street: 8 - 22 % across tracks, Rue de la Vallée, a motorway link)
const SHEET_FOOT_WEIGHT = 0.05;         // the weight of the sheet at the foot from which its level there is the reference of the limit (below it the way's own bed)
const SHEET_ISO_NEAR = 1.0, SHEET_ISO_FAR = 3.0;   // m past the bench of another way at the sheet's level: inside NEAR the junction's plane holds as it is (the apron), past FAR the cross tilt is limited

/**
 * The level at the two ends of every bridge deck a car drives onto, from the DSM of the deck itself: the first two points inside the deck, continued to its end (the DSM AT the end is
 * the abutment or the bank, the bake writes the land there).  Only the decks of a carriageway (DECK_TRUST_WIDTH): the DSM of a track or a footbridge in a wood is the canopy.
 * The Pont Rouge and the Pont Adolphe are left out: their landmark models meet their approach roads themselves (landmark-bridges.js fixLandmarkDecks).
 * Returns [{ deck, x, z, level }].
 */
export function deckEndLevels(decks) {
  const out = [];
  for (const d of decks) {
    const n = d.pts.length;
    if (n < 3 || d.width < DECK_TRUST_WIDTH) continue;
    if (isLandmarkDeck(d)) continue;
    for (const [k, j, j2] of [[0, 1, 2], [n - 1, n - 2, n - 3]]) {
      const l1 = Math.hypot(d.pts[j][0] - d.pts[k][0], d.pts[j][1] - d.pts[k][1]);
      const l2 = Math.hypot(d.pts[j2][0] - d.pts[j][0], d.pts[j2][1] - d.pts[j][1]) || 1;
      const grade = Math.max(-DECK_END_GRADE, Math.min(DECK_END_GRADE, (d.tops[j] - d.tops[j2]) / l2));
      out.push({ deck: d.id, x: d.pts[k][0], z: d.pts[k][1], level: d.tops[j] + grade * l1 });
    }
  }
  return out;
}

/** A grid of points ([x, z, ...]) for the question "is any of them within r of (x, z)?" (r at most `cell`); `test(p)` may reject a point.  The lists of ends of the ways are tens of
 *  thousands long, and a linear search per way was most of the time of building the network. */
function pointGrid(points, cell) {
  const grid = new Map();
  const key = (cx, cz) => cx * 65536 + cz;
  for (const p of points) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    const l = grid.get(k);
    if (l) l.push(p); else grid.set(k, [p]);
  }
  return (x, z, r, test = null) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of grid.get(key(cx + dx, cz + dz)) || []) if (Math.hypot(p[0] - x, p[1] - z) <= r && (!test || test(p))) return true;
      }
    }
    return false;
  };
}

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
export function gaussianSmooth(values, sigmaSamples) {
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
export function createRoadNetwork(roads, baseHeight, decks = []) {
  const deckEnds = deckEndLevels(decks);
  let usableDeckEnds = [];               // (decided in reconcileJunctions, once the ways have their own beds)
  // A drivable way tagged as a bridge whose deck spans nothing: a narrow deck (its DSM is the canopy of a wood, not a deck), no dip of the land under it, and short (a track over a ditch).
  // It is carved like any way and its deck is not drawn (decks.js): a deck lifted off such a way was a box 2 .. 25 m high in the wood, and a deck laid onto it lay on the ground
  // with the cut of the track under its ends.  Returns the deck or null.
  const groundedDecks = new Set();
  function groundedDeckOf(road) {
    if (!road.info || !road.info.drivable || road.tunnel || !(road.over || (road.layer || 0) >= 1) || !road.pts || road.pts.length < 2) return null;
    const a = road.pts[0], b = road.pts[road.pts.length - 1];
    const deck = decks.find((d) => {
      const p = d.pts[0], q = d.pts[d.pts.length - 1];
      return (Math.hypot(p[0] - a[0], p[1] - a[1]) <= GROUNDED_MATCH && Math.hypot(q[0] - b[0], q[1] - b[1]) <= GROUNDED_MATCH) ||
        (Math.hypot(p[0] - b[0], p[1] - b[1]) <= GROUNDED_MATCH && Math.hypot(q[0] - a[0], q[1] - a[1]) <= GROUNDED_MATCH);
    });
    if (!deck || deck.width >= DECK_TRUST_WIDTH || deck.spans) return null;
    let len = 0;
    for (let i = 1; i < deck.pts.length; i++) len += Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]);
    if (len > GROUNDED_MAX_LENGTH) return null;
    const p = deck.pts[0], q = deck.pts[deck.pts.length - 1];
    const endLand = Math.min(baseHeight(p[0], p[1]), baseHeight(q[0], q[1]));
    const dip = Math.max(...deck.pts.map(([x, z]) => endLand - baseHeight(x, z)));
    return dip < GROUNDED_MAX_DIP ? deck : null;
  }
  const segAx = [], segAz = [], segBx = [], segBz = [], segB0 = [], segB1 = [];
  const segCut = [];                 // per segment: 1 on an opened shallow tunnel (its cut has walls, CUT_WALL_SLOPE)
  const segDhw0 = [], segDhw1 = [];  // per segment: the taper of the half width at its two ends (<= 0; see WIDTH_TAPER)
  const segHw = [], segKerbH = [], segKerbW = [], segPw = [], segA0 = [], segPaintA0 = [], segBench = [], segR = [], segReach = [];
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

  const roadLength = new Float32Array(roads.length);   // m, the length of every carved way (the distance along it from its far end)
  const capHoldA = new Float32Array(roads.length), capHoldB = new Float32Array(roads.length);   // m: how far past its first / last point the carriageway of a way is held before its cap fades (a way that runs onto a bridge)
  const capSoftA = new Float32Array(roads.length).fill(CAP_SOFT), capSoftB = new Float32Array(roads.length).fill(CAP_SOFT);
  const tuckFromA = new Float32Array(roads.length), tuckFromB = new Float32Array(roads.length);   // m past the end of an approach way where its tuck under the deck starts (the deck end + DECK_TUCK_FROM)   // m: ... and over how much it then fades (the abutment, see ABUT_FADE_MAX)
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
  /** The level of the deck whose end lies at (x, z) (within APPROACH_JOIN), or null. */
  function deckLevelAt(x, z) {
    let best = null, bestD = APPROACH_JOIN;
    for (const e of usableDeckEnds) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d <= bestD) { bestD = d; best = e.level; }
    }
    return best;
  }

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
    // The decks whose DSM level the ways at their ends are pinned to: all ends of a deck agree, or none is used (a deck lifted at one end only was a ramp of 30 %).  A deck level more
    // than DECK_BELOW_BANK under the land at its end, or more than the limits away from the bed a way had on its own, is not the deck (a canopy, a structure over the way).
    const rejected = new Set();
    for (const de of deckEnds) {
      if (de.level < baseHeight(de.x, de.z) - DECK_BELOW_BANK) { rejected.add(de.deck); continue; }
      for (const e of ends) {
        if (Math.hypot(e.x - de.x, e.z - de.z) > APPROACH_JOIN) continue;
        if (de.level - e.h > APPROACH_LIFT_MAX || e.h - de.level > APPROACH_LOWER_MAX) rejected.add(de.deck);
      }
    }
    usableDeckEnds = deckEnds.filter((de) => !rejected.has(de.deck));
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
      // an end that runs onto a bridge: the deck (the DSM of the bridge) sets the level of the node, and every way at that node meets it
      const deckLevel = deckLevelAt(e.x, e.z);
      if (deckLevel !== null) {
        for (const m of members) { pinOf(m.chain).set(m.k, deckLevel); (m.chain.deckPins || (m.chain.deckPins = new Set())).add(m.k); }
        continue;
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
  const nearBridgeEnd = pointGrid(bridgeEndPoints, BRIDGE_JOIN), nearTunnelEnd = pointGrid(tunnelEndPoints, BRIDGE_JOIN);
  const endOf = (x, z) => (nearBridgeEnd(x, z, BRIDGE_JOIN) ? 'bridge' : nearTunnelEnd(x, z, BRIDGE_JOIN) ? 'tunnel' : null);

  /** The ground under an opened shallow tunnel (tunnel-cover.js) at the samples rs: the floor of its cut (`cutLevels` at its pts, read by the
   *  distance along the way), or the land where that is lower (the cut never stands on a ridge of its own). */
  function cutGround(road, rs) {
    const pts = road.pts, lv = road.cutLevels;
    const arcPts = [0];
    for (let i = 1; i < pts.length; i++) arcPts.push(arcPts[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const n = rs.x.length, arcRs = [0];
    for (let i = 1; i < n; i++) arcRs.push(arcRs[i - 1] + Math.hypot(rs.x[i] - rs.x[i - 1], rs.z[i] - rs.z[i - 1]));
    const scale = arcRs[n - 1] > 0 ? arcPts[arcPts.length - 1] / arcRs[n - 1] : 0;
    let k = 1;
    return rs.x.map((x, i) => {
      const s = arcRs[i] * scale;
      while (k < arcPts.length - 1 && arcPts[k] < s) k++;
      const span = arcPts[k] - arcPts[k - 1];
      const f = span > 0 ? Math.min(1, Math.max(0, (s - arcPts[k - 1]) / span)) : 0;
      return Math.min(baseHeight(x, rs.z[i]), lv[k - 1] + (lv[k] - lv[k - 1]) * f);
    });
  }

  const wayLines = new Array(roads.length).fill(null);      // the centre line of every way as drawn (the carriageway chains, see below)
  const tunnelWays = roads.filter((r) => r.tunnel && r.pts && r.pts.length >= 2);
  const garagePads = [];                 // the filled trenches of the garage ramps: [{ x0, z0, x1, z1, half, level }] per segment (see GARAGE_RAMP_MAX)
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri];
    firstSample[ri] = -1; firstSeg[ri] = -1; segCount[ri] = 0; info[ri] = null;
    if (road.kind === 'service' && road.info && road.info.drivable && !road.tunnel && !(road.over || (road.layer || 0) >= 1) && road.pts && road.pts.length >= 2 && road.length <= GARAGE_RAMP_MAX) {
      const p0 = road.pts[0], p1 = road.pts[road.pts.length - 1];
      const tunnelAt0 = endOf(p0[0], p0[1]) === 'tunnel', tunnelAt1 = endOf(p1[0], p1[1]) === 'tunnel';
      if (tunnelAt0 !== tunnelAt1) {
        const mouth = tunnelAt0 ? p1 : p0;
        const level = baseHeight(mouth[0], mouth[1]);
        for (let k = 1; k < road.pts.length; k++) garagePads.push({ x0: road.pts[k - 1][0], z0: road.pts[k - 1][1], x1: road.pts[k][0], z1: road.pts[k][1], half: Math.max(0.8, road.width / 2) + 0.5, level });
        // ... and the open ramp goes on in the DTM along the first metres of the garage tunnel (a pit of 3 - 4 m in the grass where no portal stands, roads9): filled to the same level
        const inner = tunnelAt0 ? p0 : p1;
        for (const t of tunnelWays) {
          const tp = t.pts, e0 = Math.hypot(tp[0][0] - inner[0], tp[0][1] - inner[1]), e1 = Math.hypot(tp[tp.length - 1][0] - inner[0], tp[tp.length - 1][1] - inner[1]);
          if (Math.min(e0, e1) > BRIDGE_JOIN) continue;
          const pts = e0 <= e1 ? tp : tp.slice().reverse();
          let run = 0;
          for (let k = 1; k < pts.length && run < GARAGE_TRENCH_IN; k++) {
            const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]), f = Math.min(1, (GARAGE_TRENCH_IN - run) / Math.max(seg, 1e-6));
            garagePads.push({ x0: pts[k - 1][0], z0: pts[k - 1][1], x1: pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, z1: pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f, half: Math.max(0.8, t.width / 2) + 0.5, level });
            run += seg;
          }
        }
        continue;
      }
    }
    // A way that rides OVER the ground: OSM says so (a bridge, or a layer above the others).  It is never carved
    // into the height function and the ground under it is protected (see the crossings below).
    const grounded = groundedDeckOf(road);
    if (grounded) groundedDecks.add(grounded.id);
    const tagged = !grounded && !!(road.over || (road.layer || 0) >= 1);
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
    wayLines[ri] = rs;
    const kind = kindInfo(road.kind);
    const hw = Math.max(0.8, road.width / 2);
    // the kerb belongs to the material of the way itself: a cobbled street has one, a paved area has none
    const kerbH = KERB_SURFACES.has(road.surface || kind.surface) ? ROAD.kerbHeight : 0;
    const kerbW = kerbH > 0 ? ROAD.kerbWidth : 0;
    // A service way that dives into a tunnel is a garage ramp: the class default of 2.5 m of pavement (bake_roads URBAN_PAVEMENT) is for streets, and on a ramp it is a grey slab
    // field lying over the verge and the trench (the start of the game).  A ramp has no pavement.
    const isGarageRamp = road.kind === 'service' && (endOf(rs.x[0], rs.z[0]) === 'tunnel' || endOf(rs.x[n - 1], rs.z[n - 1]) === 'tunnel');
    const pw = isGarageRamp ? 0 : Math.max(0, road.sidewalk);
    // A service way (a lane to a car park, a farm, a petrol station) has no pavement PAINTED: the bake's urban default of 2.5 m on both sides joined the pavement of the street it
    // leaves into an apron of 6 - 8 m of slabs beside every junction mouth (QA T11).  (The shape of the ground keeps the pavement's level shelf: only the paint goes.)
    const paintA0 = road.kind === 'service' ? hw + (KERB_SURFACES.has(road.surface || kind.surface) ? ROAD.kerbWidth : 0) : null;
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
    // (an opened shallow tunnel, tunnel-cover.js: the floor of its cut runs between its mouths; the land over it is cut away, never followed over)
    const ground = road.openCut ? cutGround(road, rs) : rs.x.map((x, i) => baseHeight(x, rs.z[i]));
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
    prep.push({ ri, road, rs, n, hw, kerbH, kerbW, pw, bench, a0, paintA0, kind, chain });
  }

  // ---- the carriageways: consecutive ways of one road joined (carriageways.js).  The paint tells a MEDIAN (the gap between two carriageways) from the hand-over of two ways of one
  // carriageway by these groups, and the lane markings run along them (markings.js)
  const carriageways = chainCarriageways(roads, (r) => (r.info && r.info.drivable && !r.tunnel ? wayLines[r.id] : null));
  const GROUP = carriageways.groupOf;
  // ---- the width tapers: along every carriageway chain the half width of the tarmac is the lower envelope of slope 1 / WIDTH_TAPER of the half widths of its ways (the narrowing is laid in
  // the wider way, the narrow way keeps its own width; a short wider way - a turning lane - ramps up from both ends as far as it can).  Per sample of a carved way: the change of its half width.
  const taperDhw = new Array(roads.length).fill(null);
  {
    const prepOf = new Map(prep.map((p) => [p.ri, p]));
    for (const ws of carriageways.chainWays) {
      if (ws.length < 2) continue;
      const span = [];                          // per way of the chain: its interval along the chain and its nominal half width
      let at = 0;
      for (const w of ws) {
        const pr = prepOf.get(w.road);
        const L = pr ? pr.chain.arc[pr.n - 1] : (roads[w.road].length || 0);
        span.push({ a: at, b: at + L, hw: Math.max(0.8, roads[w.road].width / 2), w, pr, L });
        at += L;
      }
      if (span.every((q) => Math.abs(q.hw - span[0].hw) < 1e-3)) continue;
      for (const q of span) {
        if (!q.pr) continue;
        const { n, chain: c } = q.pr;
        let out = null;
        for (let i = 0; i < n; i++) {
          const sc = q.w.rev ? q.b - c.arc[i] : q.a + c.arc[i];          // the place of the sample along the chain
          let hw = q.hw;
          for (const o of span) {
            if (o === q || o.hw >= hw) continue;
            const dist = sc < o.a ? o.a - sc : sc > o.b ? sc - o.b : 0;
            const v = o.hw + dist / WIDTH_TAPER;
            if (v < hw) hw = v;
          }
          if (hw < q.hw - 1e-3) { if (!out) out = new Float32Array(n); out[i] = hw - q.hw; }
        }
        taperDhw[q.w.road] = out;
      }
    }
  }

  // ---- the bed of every way: designed on its own first (this decides which way rides over which), then again with the
  // junctions pinned to the ways that were designed before ----
  for (const chain of chains) chain.bed = designBed(chain.ground, chain.arc, null, chain.closed, chain.kind, chain.ends);
  findCrossings();
  reconcileJunctions();
  // the junction sheets: one smooth surface where ways meet at one level (junction-surface.js)
  const junctionSheet = createJunctionSurface(chains, (c) => overRoads.has(c.road), (c) => Math.max(0.8, roads[c.road].width / 2));
  const sheet = { level: 0, weight: 0 };
  const sheetFoot = { level: 0, weight: 0 };

  for (const { ri, road, rs, n, hw, kerbH, kerbW, pw, bench, a0, paintA0, kind, chain } of prep) {
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
      { const tp = taperDhw[ri]; segDhw0.push(tp ? tp[i] : 0); segDhw1.push(tp ? tp[i + 1] : 0); }
      segCut.push(road.openCut ? 1 : 0);
      segHw.push(hw); segKerbH.push(kerbH); segKerbW.push(kerbW); segPw.push(pw);
      segA0.push(a0); segPaintA0.push(paintA0 === null ? a0 : paintA0); segBench.push(bench); segR.push(radius); segReach.push(reach);
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
  const DHW0 = Float32Array.from(segDhw0), DHW1 = Float32Array.from(segDhw1), CUT = Uint8Array.from(segCut);
  const HW = Float32Array.from(segHw), KERBH = Float32Array.from(segKerbH), KERBW = Float32Array.from(segKerbW);
  const PW = Float32Array.from(segPw), A0 = Float32Array.from(segA0), PAINT_A0 = Float32Array.from(segPaintA0), RAD = Float32Array.from(segR);
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
  // per segment: the distance along its way at its start and the distances along the way at which the protection starts / ends ramping (-Infinity / Infinity: an end that no road runs onto
  // keeps the full protection up to it and the disc round it)
  const protArc = [], protRampA = [], protRampB = [], protFade = [], protLenA = [], protLenB = [];   // (protLen: the length of the ramp-up at each end, see ABUT_FADE_MAX)
  const corridorEnds = overCorridors.filter((c) => !isLandmarkDeck({ pts: c.x.map((x, i) => [x, c.z[i]]) })).flatMap((c) => [[c.x[0], c.z[0]], [c.x[c.x.length - 1], c.z[c.z.length - 1]]]);
  const nearCorridorEnd = pointGrid(corridorEnds, APPROACH_JOIN);
  const atBridgeEnd = (x, z) => nearCorridorEnd(x, z, APPROACH_JOIN);
  /** How long the ground under a bridge takes to fall from the deck to the land below past the hold (m, 0 = no more than the defaults): the end of a way at level `bed` that leaves
   *  through (x, z) in the direction (ux, uz) onto the bridge. */
  function abutmentFade(x, z, ux, uz, bed) {
    let land = Infinity;
    for (let s = ABUT_HOLD; s <= ABUT_HOLD + ABUT_FADE_MAX + 1e-6; s += 1) land = Math.min(land, baseHeight(x + ux * s, z + uz * s));
    return Math.min(ABUT_FADE_MAX, Math.max(0, (1.5 * (bed - land)) / RAMP_SLOPE));
  }
  const approachEnds = [];                             // the ends of the carved ways (not over): an end of a bridge near one of them is an abutment; [x, z, ux, uz, fade]
  for (const chain of chains) {
    if (overRoads.has(chain.road) || chain.x.length < 2) continue;
    const m = chain.x.length;
    for (const [e, f] of [[0, 1], [m - 1, m - 2]]) {               // the end, and the direction the way leaves through it (toward the bridge)
      const dx = chain.x[e] - chain.x[f], dz = chain.z[e] - chain.z[f], l = Math.hypot(dx, dz) || 1;
      const fade = !chain.closed && atBridgeEnd(chain.x[e], chain.z[e]) ? abutmentFade(chain.x[e], chain.z[e], dx / l, dz / l, chain.bed[e]) : 0;
      approachEnds.push([chain.x[e], chain.z[e], dx / l, dz / l, fade]);
      if (fade > 0 || atBridgeEnd(chain.x[e], chain.z[e])) {
        // the end of the bridge lies up to APPROACH_JOIN before or after the end of the way: the tuck is counted from the end of the bridge
        let ahead = 0, best = Infinity;
        for (const [bx, bz] of corridorEnds) { const dd = Math.hypot(bx - chain.x[e], bz - chain.z[e]); if (dd < best && dd <= APPROACH_JOIN) { best = dd; ahead = (bx - chain.x[e]) * dx / l + (bz - chain.z[e]) * dz / l; } }
        if (e === 0) tuckFromA[chain.road] = Math.max(0, ahead) + DECK_TUCK_FROM; else tuckFromB[chain.road] = Math.max(0, ahead) + DECK_TUCK_FROM;
      }
      if (fade > 0) {
        if (e === 0) capSoftA[chain.road] = Math.max(capSoftA[chain.road], fade);
        else capSoftB[chain.road] = Math.max(capSoftB[chain.road], fade);
      }
    }
  }
  // An end of a bridge is an abutment when a carved way ends there (APPROACH_JOIN) and runs on in the direction of the bridge.  (The ends of the pavement decks beside a road bridge also
  // protected the end of the road between them; the protection now only keeps the ground from being CUT - see carve() - and a road lifted onto its bridge is a fill.)
  const nearApproachEnd = pointGrid(approachEnds, APPROACH_JOIN);
  const isAbutment = (x, z, ux, uz) => nearApproachEnd(x, z, APPROACH_JOIN, (p) => p[2] * ux + p[3] * uz >= APPROACH_ALIGN);
  /** The length of the ramp-up of the protection at an abutment: the fade of the approach ways that run onto it there (the ground falls from the deck to the land over it). */
  const protectRampAt = (x, z, ux, uz) => {
    let fade = 0;
    nearApproachEnd(x, z, APPROACH_JOIN, (p) => { if (p[2] * ux + p[3] * uz >= APPROACH_ALIGN) fade = Math.max(fade, p[4]); return false; });
    return Math.max(PROTECT_RAMP, fade);
  };
  for (const corridor of overCorridors) {              // the ways that OSM tags as over
    const m = corridor.x.length;
    if (isLandmarkDeck({ pts: corridor.x.map((x, i) => [x, corridor.z[i]]) })) {     // (the Pont Rouge / Pont Adolphe models meet their roads themselves: full protection, as before)
      for (let i = 1; i < m; i++) {
        protX0.push(corridor.x[i - 1]); protZ0.push(corridor.z[i - 1]); protX1.push(corridor.x[i]); protZ1.push(corridor.z[i]);
        protHalf.push(corridor.half); protFade.push(PROTECT_FADE); protArc.push(0); protRampA.push(-Infinity); protRampB.push(Infinity); protLenA.push(PROTECT_RAMP); protLenB.push(PROTECT_RAMP);
      }
      continue;
    }
    let total = 0;
    for (let i = 1; i < m; i++) total += Math.hypot(corridor.x[i] - corridor.x[i - 1], corridor.z[i] - corridor.z[i - 1]);
    const inA = [corridor.x[1] - corridor.x[0], corridor.z[1] - corridor.z[0]], inB = [corridor.x[m - 2] - corridor.x[m - 1], corridor.z[m - 2] - corridor.z[m - 1]];   // into the bridge at each end
    const lA = Math.hypot(inA[0], inA[1]) || 1, lB = Math.hypot(inB[0], inB[1]) || 1;
    const rampA = isAbutment(corridor.x[0], corridor.z[0], inA[0] / lA, inA[1] / lA) ? 0 : -Infinity;
    const rampB = isAbutment(corridor.x[m - 1], corridor.z[m - 1], inB[0] / lB, inB[1] / lB) ? total : Infinity;
    const lenA = protectRampAt(corridor.x[0], corridor.z[0], inA[0] / lA, inA[1] / lA), lenB = protectRampAt(corridor.x[m - 1], corridor.z[m - 1], inB[0] / lB, inB[1] / lB);
    let arc = 0;
    for (let i = 1; i < m; i++) {
      protX0.push(corridor.x[i - 1]); protZ0.push(corridor.z[i - 1]);
      protX1.push(corridor.x[i]); protZ1.push(corridor.z[i]);
      protHalf.push(corridor.half); protFade.push(PROTECT_FADE);
      protArc.push(arc); protRampA.push(rampA); protRampB.push(rampB); protLenA.push(lenA); protLenB.push(lenB);
      arc += Math.hypot(corridor.x[i] - corridor.x[i - 1], corridor.z[i] - corridor.z[i - 1]);
    }
  }
  // the ways that run onto a bridge: their carriageway is held at its level ABUT_HOLD under the deck (see the cap in carve())
  for (const chain of chains) {
    if (overRoads.has(chain.road) || chain.closed) continue;
    const m = chain.x.length;
    if (atBridgeEnd(chain.x[0], chain.z[0])) capHoldA[chain.road] = ABUT_HOLD;
    if (atBridgeEnd(chain.x[m - 1], chain.z[m - 1])) capHoldB[chain.road] = ABUT_HOLD;
    roadLength[chain.road] = chain.arc[m - 1];
  }
  // The ways the crossings found to be over: their ground is protected near the crossings only.  Along the rest of such a way (an overpass that runs on beside the trunk road on its
  // embankment) the corridor of 4 m past its pavement lay over the carriageway of the road beside it, kept it on the slope of the embankment, and that slope was painted as tarmac
  // (Nei Escher Strooss).
  const crossingsOf = new Map();
  for (const c of crossings) { const l = crossingsOf.get(c.over); if (l) l.push(c); else crossingsOf.set(c.over, [c]); }
  const nearCrossing = (i) => (crossingsOf.get(ROADOF[i]) || []).some((c) => {
    const ex = X1[i] - X0[i], ez = Z1[i] - Z0[i], ll = ex * ex + ez * ez;
    const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((c.x - X0[i]) * ex + (c.z - Z0[i]) * ez) / ll)) : 0;
    return Math.hypot(c.x - X0[i] - ex * t, c.z - Z0[i] - ez * t) <= CROSSING_PROTECT;
  });
  for (let i = 0; i < count; i++) {                     // the ways the crossings found to be over
    if (!overRoads.has(ROADOF[i])) continue;
    const near = !crossingsOf.has(ROADOF[i]) || nearCrossing(i);
    protX0.push(X0[i]); protZ0.push(Z0[i]); protX1.push(X1[i]); protZ1.push(Z1[i]);
    // (away from its crossings only its own carriageway and pavement is protected: it is not carved, its surface is the embankment of the DTM, and the batter of the road beside it may not cut it)
    // (near a crossing: its carriageway and a metre, fading over CROSSING_FADE: the corridor of a tagged bridge (4 m, fading over 10 m) lay over the carriageway of the trunk road beside the
    // overpass and kept its right lane on the slope of the embankment)
    protHalf.push(near ? BENCH[i] + CROSSING_MARGIN : BENCH[i]); protFade.push(near ? CROSSING_FADE : OWN_PROTECT_FADE);
    protArc.push(0); protRampA.push(-Infinity); protRampB.push(Infinity); protLenA.push(PROTECT_RAMP); protLenB.push(PROTECT_RAMP);
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
  // (protFill: the protection against a FILL, set by every call of protection(): at an abutment it ramps up over the fade of the abutment, so the ground under the deck may fall from the deck
  // to the land over that length; the protection against a CUT keeps the short PROTECT_RAMP, so the road under the bridge never digs a pit under the deck end - harness gate D)
  let protFill = 0;
  function protection(x, z) {
    const cx = Math.floor(x / PROTECT_CELL), cz = Math.floor(z / PROTECT_CELL);
    let p = 0;
    protFill = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = pCells.get(pKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const s = list[q];
          const ax = protX0[s], az = protZ0[s];
          const ex = protX1[s] - ax, ez = protZ1[s] - az;
          const ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
          // at an abutment the protection ramps up along the bridge from its end (and is nothing before it, where the approach road is)
          const along = protArc[s] + t * Math.sqrt(ll);
          const ramp = smoothstep(ABUT_HOLD, ABUT_HOLD + PROTECT_RAMP, Math.min(along - protRampA[s], protRampB[s] - along));
          const rampFill = smoothstep(ABUT_HOLD, ABUT_HOLD + protLenA[s], along - protRampA[s]) * smoothstep(ABUT_HOLD, ABUT_HOLD + protLenB[s], protRampB[s] - along);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t)) - protHalf[s];
          const across = d <= 0 ? 1 : d < protFade[s] ? 1 - d / protFade[s] : 0;
          if (across * rampFill > protFill) protFill = across * rampFill;
          const v = across * ramp;
          if (v > p) p = v;
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
  const candPast = new Float32Array(MAX_CAND), candDh = new Float32Array(MAX_CAND);   // (candDh: the taper of the half width at the foot, WIDTH_TAPER)
  const candI = new Int32Array(MAX_CAND), candD = new Float32Array(MAX_CAND), candT = new Float32Array(MAX_CAND), candLat = new Float32Array(MAX_CAND), candOver = new Float32Array(MAX_CAND);
  const pinPri = new Float32Array(MAX_PINS), pinVal = new Float32Array(MAX_PINS), pinWt = new Float32Array(MAX_PINS);
  const pinEdge = new Float32Array(MAX_PINS), pinBed = new Float32Array(MAX_PINS), slotPinRoad = new Int32Array(MAX_PINS), pinAlong = new Float32Array(MAX_PINS);
  const pinCap = new Float32Array(MAX_PINS), pinDirX = new Float32Array(MAX_PINS), pinDirZ = new Float32Array(MAX_PINS);
  const wayEdge = new Float32Array(MAX_CAND), wayBed = new Float32Array(MAX_CAND), wayDirX = new Float32Array(MAX_CAND), wayDirZ = new Float32Array(MAX_CAND), wayGap = new Float32Array(MAX_CAND);
  const paintMajor = new Uint8Array(MAX_CAND);
  const wayDist = new Float32Array(MAX_CAND);                  // per slot: the distance to the nearest segment of the way
  const armShare = new Float32Array(MAX_CAND);                 // per candidate segment: its share in the other arm of its way (see ARM_DETOUR_LO)
  const chGroup = new Int32Array(MAX_CAND), chCar = new Float32Array(MAX_CAND), chPave = new Float32Array(MAX_CAND), chMajor = new Uint8Array(MAX_CAND);   // (the paint channels, per carriageway)
  const paintECar = new Float32Array(MAX_CAND), paintEPave = new Float32Array(MAX_CAND), paintBed = new Float32Array(MAX_CAND), paintRoad = new Int32Array(MAX_CAND);
  const paintOffX = new Float32Array(MAX_CAND), paintOffZ = new Float32Array(MAX_CAND);   // per way near the point: the distance past the edge of its bench (its end cap included) and its bed there   // per pin: the distance to the edge of its bench (negative inside) and the level of its carriageway
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
  const scratch = { coverage: 0, bed: 0, band: 0, kerb: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, dist: 0, lines: 0, lanes: 0, s: 0, surface: 0, sdCar: SD_FAR, sdPave: SD_FAR, sdMajor: SD_FAR, junction: 0,
    chGroup: new Int32Array(CHANNELS).fill(-1), chCar: new Float32Array(CHANNELS).fill(SD_FAR), chPave: new Float32Array(CHANNELS).fill(SD_FAR), chMajor: new Uint8Array(CHANNELS) };

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
  // the garage pads in a grid (GARAGE_RAMP_MAX)
  const PAD_CELL = 32, padGrid = new Map();
  for (const pad of garagePads) {
    const r = pad.half + GARAGE_PAD_FADE;
    for (let cx = Math.floor((Math.min(pad.x0, pad.x1) - r) / PAD_CELL); cx <= Math.floor((Math.max(pad.x0, pad.x1) + r) / PAD_CELL); cx++) {
      for (let cz = Math.floor((Math.min(pad.z0, pad.z1) - r) / PAD_CELL); cz <= Math.floor((Math.max(pad.z0, pad.z1) + r) / PAD_CELL); cz++) {
        const k = cx * 65536 + cz, l = padGrid.get(k);
        if (l) l.push(pad); else padGrid.set(k, [pad]);
      }
    }
  }
  /** The land at (x, z) with the trench of a dropped garage ramp filled to the level of its mouth (only ever raised). */
  function garageFill(x, z, land) {
    const list = padGrid.get(Math.floor(x / PAD_CELL) * 65536 + Math.floor(z / PAD_CELL));
    if (!list) return land;
    let y = land;
    for (const pad of list) {
      const ex = pad.x1 - pad.x0, ez = pad.z1 - pad.z0, ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - pad.x0) * ex + (z - pad.z0) * ez) / ll)) : 0;
      const w = 1 - smoothstep(pad.half, pad.half + GARAGE_PAD_FADE, Math.hypot(x - pad.x0 - ex * t, z - pad.z0 - ez * t));
      if (w > 0 && pad.level > land) y = Math.max(y, land + (pad.level - land) * w);
    }
    return y;
  }

  function carve(x, z, out, groundY) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const ground = garageFill(x, z, groundY === undefined ? baseHeight(x, z) : groundY);
    // The ground under a way that rides over the others is protected: no road may cut into it, so the bridge road
    // does not dive into a dark pit where the road below it was cut into the hill.
    const prot = protection(x, z);
    let best = -1, bestScore = -1, bestLat = 0, bestDist = 0, bestT = 0, bestDh = 0;
    let covSum = 0, bedSum = 0;     // the paint: the coverage of the road the point is on (the tight radius) and the
                                    // flat level of a junction (the roads that meet are blended)
    // The UNION of the carriageways and of the pavements, as signed distances (negative = inside).  The edge of the paint
    // is the zero of these, and a min over all the roads is continuous in the place: the lattice interpolates it into
    // a straight line.  The offset of ONE nearest road (lat, hw, a0) jumps where the nearest road changes, and the jump
    // was the ragged kerb and pavement the reviewer saw.
    let sdCar = SD_FAR, sdPave = SD_FAR, sdCarRoad = -1, sdCar2 = SD_FAR, sdCar2Road = -1, sdMajor = SD_FAR;   // (sdCar2: the nearest carriageway edge of a DIFFERENT carriageway than the nearest one; the roads are their carriageway groups)
    let dispX = 0, dispZ = 0, disp2X = 0, disp2Z = 0;                        // (the offsets of the point from those two roads: opposite ones = the point lies BETWEEN them)
    let partners = 0;               // the marked roads whose carriageway (plus the clearance) holds this point
    let nPaint = 0;                 // the arms that paint here (their distances to the edges, their bed, their road, the offset of the point from them)
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
          let d = Math.hypot(rx, rz);                    // the distance to the SEGMENT of the way
          // (a way that runs onto a bridge ends SQUARE under the deck, over its hold and fade: the distance past that end is the offset from its line.  Rounded, the corners of its carriageway and
          // pavement fell away in front of the deck, and the blur of the paint field showed a wedge of grass at every corner of the deck start: Rue de Neudorf)
          {
            const r = ROADOF[i];
            const square = t0 < 0 && i === firstSeg[r] && capHoldA[r] > 0 ? capHoldA[r] + capSoftA[r]
              : t0 > 1 && i === firstSeg[r] + segCount[r] - 1 && capHoldB[r] > 0 ? capHoldB[r] + capSoftB[r] : 0;
            if (square > 0) d += (Math.abs(lat) - d) * (1 - smoothstep(square - 1, square, (t0 < 0 ? -t0 : t0 - 1) * len));   // (back to round over the last metre: continuous)
          }
          if (d >= reach || nCand >= MAX_CAND) continue;
          // how far the point lies beyond the END of the way (0 along the way): the carriageway ends at the end of the way
          let over = 0;
          if (closedRoad[ROADOF[i]]) over = 0;
          // (scaled so that the cap fades over CAP_SOFT of `over`: an abutment fades over its own length, capSoft)
          else if (t0 < 0 && i === firstSeg[ROADOF[i]]) over = Math.max(0, -t0 * len - capHoldA[ROADOF[i]]) * (CAP_SOFT / capSoftA[ROADOF[i]]);
          else if (t0 > 1 && i === firstSeg[ROADOF[i]] + segCount[ROADOF[i]] - 1) over = Math.max(0, (t0 - 1) * len - capHoldB[ROADOF[i]]) * (CAP_SOFT / capSoftB[ROADOF[i]]);
          // how far an approach way runs on under its deck (0 elsewhere): its carriageway is tucked DECK_TUCK under the deck there (see below)
          const r0 = ROADOF[i];
          const past = t0 < 0 && i === firstSeg[r0] && capHoldA[r0] > 0 ? -t0 * len - tuckFromA[r0] : t0 > 1 && i === firstSeg[r0] + segCount[r0] - 1 && capHoldB[r0] > 0 ? (t0 - 1) * len - tuckFromB[r0] : 0;
          candI[nCand] = i; candD[nCand] = d; candT[nCand] = t; candLat[nCand] = lat; candOver[nCand] = over; candPast[nCand] = past; candDh[nCand] = DHW0[i] + (DHW1[i] - DHW0[i]) * t; nCand++;
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
      const i = candI[c], t = candT[c], lat = candLat[c], d = candD[c], dh = candDh[c];
      {
        {
          const ex = X1[i] - X0[i], ez = Z1[i] - Z0[i];
          const len = Math.sqrt(ex * ex + ez * ez) || 1;
          const a0 = A0[i] + dh;
          segmentState(c);
          const bed = sBed;
          // A way that stands far ABOVE the land (a viaduct) is not painted: its overhang over the land at the edge of the bench is the measure
          // (the level is a function of that overhang, which varies smoothly along the face; measured at this point - ground minus bed - it jumped to 1 where
          // the notch changes sign, a step of up to 0.7 m in the ground beside a way on an embankment)
          const level = 1 - smoothstep(LEVEL_FULL, LEVEL_FADE, -sNotch);
          if (level >= 0.5) {
            const eCar = d - (HW[i] + dh);
            // (the union of the carriageways and pavements is taken below, once the level of the ground here is known)
            if (nPaint < MAX_CAND) {
              paintECar[nPaint] = eCar; paintEPave[nPaint] = d - (PAINT_A0[i] + dh); paintBed[nPaint] = bed; paintRoad[nPaint] = ROADOF[i]; paintMajor[nPaint] = HW[i] >= MINOR_HW || LINES[i] === 1 || LINES[i] === 2 ? 1 : 0;   // (a marked road - a slip road of 6 m - is never the pale tar of a service way)
              paintOffX[nPaint] = -lat * ez / len; paintOffZ[nPaint] = lat * ex / len; nPaint++;
            }
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
          const hw = HW[i] + dh;
          const score = ((d <= hw ? 2 : 1) + 1 - d / Math.max(R, 1)
                         - Math.min(hw, 12) * 0.02) * level;
          if (score > bestScore) { bestScore = score; best = i; bestLat = lat >= 0 ? d : -d; bestDist = d; bestT = t; bestDh = dh; }
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
      if (NOBATTER[candI[slotArm1[sl]]]) { wayEdge[sl] = Infinity; continue; }             // a way that rides over the others keeps the DTM (its fill): no batter, no pin
      segmentState(slotArm1[sl]); wayBed[sl] = sBed; wayEdge[sl] = dMin - (BENCH[candI[slotArm1[sl]]] + candDh[slotArm1[sl]]); wayDist[sl] = dMin;
      { const c1 = slotArm1[sl], i1 = candI[c1], t1 = candT[c1];          // the direction from the way to the point (which side of it the point lies on)
        const fx = X0[i1] + (X1[i1] - X0[i1]) * t1, fz = Z0[i1] + (Z1[i1] - Z0[i1]) * t1, dl = Math.hypot(x - fx, z - fz) || 1;
        wayDirX[sl] = (x - fx) / dl; wayDirZ[sl] = (z - fz) / dl; }
      // the other arm of this way here (a hairpin, a loop): the share of every candidate segment in it (0 = the arm of the nearest segment), its soft nearest distance
      let dMin2 = Infinity, k2 = -1;
      { const c1 = slotArm1[sl], i1 = candI[c1];
        const f1x = X0[i1] + (X1[i1] - X0[i1]) * candT[c1], f1z = Z0[i1] + (Z1[i1] - Z0[i1]) * candT[c1], s1 = S0[i1] + (S1[i1] - S0[i1]) * candT[c1];
        const ring = closedRoad[road] ? S1[firstSeg[road] + segCount[road] - 1] : 0;
        for (let k = 0; k < nCand; k++) {
          const i = candI[k];
          if (ROADOF[i] !== road) continue;
          const fx = X0[i] + (X1[i] - X0[i]) * candT[k], fz = Z0[i] + (Z1[i] - Z0[i]) * candT[k];
          let ds = Math.abs(S0[i] + (S1[i] - S0[i]) * candT[k] - s1);
          if (ring > 0) ds = Math.min(ds, ring - ds);
          armShare[k] = smoothstep(ARM_DETOUR_LO, ARM_DETOUR_HI, ds - Math.hypot(fx - f1x, fz - f1z));
          const dd = candD[k] + (1 - armShare[k]) * ARM_SOFT;
          if (armShare[k] > 0 && dd < dMin2) { dMin2 = dd; k2 = k; }
        } }
      let pinSum2 = 0, pinValSum2 = 0, pinBedSum2 = 0, pinMagSum2 = 0, pinMagW2 = 0, pinCapSum2 = 0, presence2 = 0;   // (the pin of the other arm: the same sums, weighted by the share)
      let wAll = 0, claimSum = 0, devAcc = 0, pinSum = 0, pinValSum = 0, pinBedSum = 0, pinMagSum = 0, pinMagW = 0, pinCapSum = 0;   // (pinCap: how much of the way is here at all - its end cap)   // (pinMag: the strength of the pin of the way here)   // (a segment that does not reach the point counts with zero claim and zero pin: the weights of a way fade out where its batter ends)
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
        const d = candD[k], bench = BENCH[i] + candDh[k], edge = d > bench ? d - bench : 0;
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
          // (the cut of an opened tunnel: a steep face for its walls, not the batter of a road on the hillside)
          reach = CUT[i] ? Math.min(REACH[i] - bench, Math.max(FACE_JOIN, (1.5 * notch) / CUT_WALL_SLOPE)) : REACH[i] - bench;
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
        // The level the pin pulls toward is the bed within the bench of the NEAREST segment of the way (dMin) and its face beyond: it is a property of the point and of the way, not of the
        // segment.  (Per segment, a segment on the far side of a tight bend had its own distance beyond the bench and pulled the carriageway toward the face of its batter.)
        const face = ground + (applies ? dev : 0);
        const join = Math.max(FACE_JOIN, FACE_JOIN_PER_M * Math.abs(bed - face));
        // The pin itself fades over PIN_FADE, or over the join where that is longer: a pin that let go while the join was still half way from the bed to the face multiplied the two fades,
        // and the side of a way that stands 5 m over a valley (Boulevard Roosevelt over the Pétrusse) dropped 3 m in a metre.
        const pin = (1 - smoothstep(bench, bench + Math.max(PIN_FADE, join), d)) * (1 - smoothstep(0, CAP_SOFT, over));
        const share = armShare[k], w1 = w * (1 - share);
        const tuck = DECK_TUCK * smoothstep(0, DECK_TUCK_RUN - DECK_TUCK_FROM, candPast[k]);   // (candPast counts from the deck end + DECK_TUCK_FROM)
        if (pin > 0) {
          pinSum += w1 * pin; pinValSum += w1 * pin * (face + (bed - tuck - face) * (1 - smoothstep(bench, bench + join, dMin))); pinBedSum += w1 * pin * bed;
        }
        { const wm = w1 * (1 - smoothstep(MAG_WINDOW[0], MAG_WINDOW[1], d - dMin)); pinMagSum += wm * pin; pinMagW += wm; pinCapSum += wm * (1 - smoothstep(0, CAP_SOFT, over)); }
        if (share > 0) {                   // the other arm: its own Shepard weights about its own nearest segment
          const q2 = (dMin2 + SHEPARD_OFFSET) / (d + SHEPARD_OFFSET);
          const w2 = q2 * q2 * q2 * q2 * (FOOT_FLOOR + smoothstep(0, FOOT_FADE, along)) * share;
          if (pin > 0) {
            pinSum2 += w2 * pin; pinValSum2 += w2 * pin * (face + (bed - tuck - face) * (1 - smoothstep(bench, bench + join, dMin2))); pinBedSum2 += w2 * pin * bed;
          }
          const win = 1 - smoothstep(MAG_WINDOW[0], MAG_WINDOW[1], d - dMin2), wm = w2 * win;
          pinMagSum2 += wm * pin; pinMagW2 += wm; pinCapSum2 += wm * (1 - smoothstep(0, CAP_SOFT, over));
          if (share * win > presence2) presence2 = share * win;
        }
      }
      if (claimSum > 0 || pinSum > 0) {
        devSum += devAcc / wAll; devW += claimSum / wAll;
        if (pinSum > 0 && nPins < MAX_PINS) {
          pinPri[nPins] = priority[road]; pinVal[nPins] = pinValSum / pinSum; pinWt[nPins] = pinMagSum / pinMagW;
          pinBed[nPins] = pinBedSum / pinSum; pinEdge[nPins] = dMin - (BENCH[candI[slotArm1[sl]]] + candDh[slotArm1[sl]]); slotPinRoad[nPins] = road;
          pinCap[nPins] = pinCapSum / pinMagW; pinDirX[nPins] = wayDirX[sl]; pinDirZ[nPins] = wayDirZ[sl];
          { const i1 = candI[slotArm1[sl]]; pinAlong[nPins] = S0[i1] + (S1[i1] - S0[i1]) * candT[slotArm1[sl]]; }
          nPins++;
        }
        // the other arm of the way (a hairpin, a loop) is a carriageway of its own: the hold below keeps each arm on its own bed (and hands over between them at two levels)
        if (pinSum2 > 0 && pinMagW2 > 0 && presence2 > 0 && nPins < MAX_PINS) {
          const c2 = k2, i2 = candI[c2];
          const fx = X0[i2] + (X1[i2] - X0[i2]) * candT[c2], fz = Z0[i2] + (Z1[i2] - Z0[i2]) * candT[c2], dl = Math.hypot(x - fx, z - fz) || 1;
          pinPri[nPins] = priority[road]; pinVal[nPins] = pinValSum2 / pinSum2; pinWt[nPins] = (pinMagSum2 / pinMagW2) * presence2;
          pinBed[nPins] = pinBedSum2 / pinSum2; pinEdge[nPins] = dMin2 - (BENCH[i2] + candDh[c2]); slotPinRoad[nPins] = road;
          pinCap[nPins] = pinCapSum2 / pinMagW2; pinDirX[nPins] = (x - fx) / dl; pinDirZ[nPins] = (z - fz) / dl;
          pinAlong[nPins] = S0[i2] + (S1[i2] - S0[i2]) * candT[c2];
          nPins++;
        }
      }
    }
    let bandY = devW > 0 ? ground + devSum / devW : ground;
    // The ways lay their carriageway over the ground in the order of their rank: the smallest way first, the biggest last, so
    // that at a junction the surface IS the bed of the bigger way (flat across, smooth along) and the side street joins it.
    // Averaging the beds of the ways that meet (the first version) made a hump of a hand's breadth on the main road.
    for (let a = 1; a < nPins; a++) {                          // insertion sort by priority, ascending (a handful of entries)
      const pr = pinPri[a], v = pinVal[a], wt = pinWt[a], ed = pinEdge[a], bd = pinBed[a], rr = slotPinRoad[a], al = pinAlong[a], cp = pinCap[a], dx = pinDirX[a], dz = pinDirZ[a];
      let b = a - 1;
      while (b >= 0 && pinPri[b] > pr) { pinPri[b + 1] = pinPri[b]; pinVal[b + 1] = pinVal[b]; pinWt[b + 1] = pinWt[b]; pinEdge[b + 1] = pinEdge[b]; pinBed[b + 1] = pinBed[b]; slotPinRoad[b + 1] = slotPinRoad[b]; pinAlong[b + 1] = pinAlong[b]; pinCap[b + 1] = pinCap[b]; pinDirX[b + 1] = pinDirX[b]; pinDirZ[b + 1] = pinDirZ[b]; b--; }
      pinPri[b + 1] = pr; pinVal[b + 1] = v; pinWt[b + 1] = wt; pinEdge[b + 1] = ed; pinBed[b + 1] = bd; slotPinRoad[b + 1] = rr; pinAlong[b + 1] = al; pinCap[b + 1] = cp; pinDirX[b + 1] = dx; pinDirZ[b + 1] = dz;
    }
    // A carriageway belongs to its own way.  Where two ways lie side by side (or one inside the other) at different levels, the bigger way used to lay its pin - and its 3 m fade -
    // over the carriageway of the smaller one, and a bed that is smooth was cut up by 1 .. 8 cm (Boulevard de la Foire: 15 m/s2).  Now a way is held back by every way laid BELOW it
    // (a smaller one) whose carriageway is at another level and which this point is farther from: the hand-over from one level to the other is centred on the line of equal distance
    // from the two benches and as wide as the steepest allowed ground between two levels (RAMP_SLOPE).  Ways at one level (junctions) are not held back at all.
    let cutCover = 0;                                          // how much of the point is the carriageway of an opened shallow tunnel (its cut passes under a bridge: deck 32 over the A1)
    let pinCover = 0;                                          // how much of the point is the carriageway of a way that runs onto a bridge (its pins), not a batter
    for (let a = 0; a < nPins; a++) {
      let hold = 1;
      for (let b = 0; b < a; b++) {
        const apart = Math.abs(pinBed[a] - pinBed[b]);
        const sep = smoothstep(SEP_LOW, SEP_HIGH, apart);
        // one level: the fade of the bigger way (a) is held off the bench of the smaller one (b), where a's own bench does not hold the point; two levels: the hand-over is centred between the two
        const own = (1 - smoothstep(0, OWN_FADE, pinEdge[b])) * smoothstep(0, OWN_FADE, pinEdge[a]);
        let half = Math.min(RAMP_MAX, Math.max(RAMP_MIN, (1.5 * apart) / RAMP_SLOPE));
        // (two arms of ONE way - a hairpin at two levels - hand over within the gap between their benches: a ramp laid into both carriageways tilted the outer metre of each lane;
        // the step between them is the retaining wall of the hairpin)
        if (slotPinRoad[a] === slotPinRoad[b]) half = Math.min(half, Math.max(RAMP_MIN, pinEdge[a] + pinEdge[b]));
        // (a rival that has no pin here - the end of a way, the far side of its fade - takes nothing from this way: scaled by the pin of the rival)
        hold *= 1 - pinWt[b] * (1 - ((1 - sep) * (1 - own) + sep * (1 - smoothstep(-half, half, pinEdge[a] - pinEdge[b]))));
      }
      if (out.debug) out.debug.push({ road: slotPinRoad[a], pri: pinPri[a], val: pinVal[a], wt: pinWt[a], hold, edge: pinEdge[a], bed: pinBed[a], before: bandY });
      bandY += (pinVal[a] - bandY) * pinWt[a] * hold;
      const r = slotPinRoad[a];
      const nearAbutment = (capHoldA[r] > 0 && pinAlong[a] <= APPROACH_FREE) || (capHoldB[r] > 0 && roadLength[r] - pinAlong[a] <= APPROACH_FREE);
      if (nearAbutment) pinCover += (1 - pinCover) * pinWt[a] * hold;
      if (roads[r].openCut) cutCover += (1 - cutCover) * pinWt[a] * hold;          // (see protHere)
    }
    // The median: the gap between two carriageways at ONE level that lie on opposite sides of the point is the straight line from the bench of one to the bench of the other (both ways
    // present here, their caps; a pair at two levels keeps the hand-over above).
    for (let a = 0; a < nPins; a++) {
      for (let b = 0; b < a; b++) {
        const gap = pinEdge[a] + pinEdge[b];
        if (gap > MEDIAN_WIDTH + MEDIAN_FLAT_FADE || Math.min(pinEdge[a], pinEdge[b]) < -OWN_FADE) continue;
        const w = (1 - smoothstep(SEP_LOW, SEP_HIGH, Math.abs(pinBed[a] - pinBed[b]))) * (1 - smoothstep(MEDIAN_WIDTH, MEDIAN_WIDTH + MEDIAN_FLAT_FADE, gap)) * pinCap[a] * pinCap[b]
          * smoothstep(-0.3, -0.6, pinDirX[a] * pinDirX[b] + pinDirZ[a] * pinDirZ[b]) * smoothstep(-OWN_FADE, 0, Math.min(pinEdge[a], pinEdge[b]));
        if (w <= 0) continue;
        const t = Math.min(1, Math.max(0, pinEdge[a] / Math.max(gap, 1e-3)));        // 0 at the bench of a, 1 at the bench of b
        bandY += (pinBed[a] + (pinBed[b] - pinBed[a]) * t - bandY) * w;
      }
    }
    // The junction sheet: where ways meet at one level the carriageways (and the gaps of up to 2 x SHEET_GAP_HOLD between them) lie on one smooth surface, not on the layered beds.
    // A way at another level (a ramp beside the junction) keeps its own surface: the sheet lets go of its bench.
    junctionSheet.sample(x, z, sheet);
    if (sheet.weight > 1e-3) {
      let inBench = 0, between = 0, apart = 0, meet1 = 0, meet2 = 0;
      for (let sl = 0; sl < nSlots; sl++) {
        if (wayEdge[sl] === Infinity) continue;
        const same = 1 - smoothstep(SEP_LOW, SEP_HIGH, Math.abs(wayBed[sl] - sheet.level));
        // on the bench of a way at the sheet's level: the sheet; past the benches only BETWEEN two such ways (a gap of up to 2 x SHEET_GAP_HOLD), not on the outer side of a lone
        // carriageway, where the face of its batter joins the land (held there at the sheet level, the side of a steep street became a wall: Rue Vauban, Montée du Grund)
        const bench = same * (1 - smoothstep(0, OWN_FADE, wayEdge[sl]));
        if (bench > inBench) inBench = bench;
        wayGap[sl] = same * (1 - smoothstep(SHEET_GAP_HOLD, SHEET_GAP_HOLD + SHEET_GAP_FADE, wayEdge[sl]));
        // between two ways: their benches lie on OPPOSITE sides of the point (two ways that run side by side on one side of it are no gap)
        for (let o = 0; o < sl; o++) {
          if (wayEdge[o] === Infinity || wayDirX[o] * wayDirX[sl] + wayDirZ[o] * wayDirZ[sl] > -0.3) continue;
          const b = Math.min(wayGap[o], wayGap[sl]);
          if (b > between) between = b;
        }
        const inside = (1 - same) * (1 - smoothstep(0, OWN_FADE, wayEdge[sl]));
        if (inside > apart) apart = inside;
        // how much two ways meet here: the second strongest of the ways near (a wide fade): a single way passing beside the plane of a junction keeps its own bed (flat across)
        const m = same * (1 - smoothstep(SHEET_GAP_HOLD, SHEET_GAP_HOLD + SHEET_MEET_FADE, wayEdge[sl]));
        if (m > meet1) { meet2 = meet1; meet1 = m; } else if (m > meet2) meet2 = m;
      }
      const near = Math.max(inBench, between);
      // the tilt across the way the point lies on (the nearest way at the sheet's level) is limited where no other way of the junction is near: the sheet at the foot on its centre line
      // plus at most SHEET_CROSS_MAX per m of the offset (continuous: the limit fades in with the distance from the other ways, and the owner changes only where two benches meet)
      let level = sheet.level, own = -1, ownBench = 0;
      for (let sl = 0; sl < nSlots; sl++) {
        if (wayEdge[sl] === Infinity) continue;
        const b = (1 - smoothstep(SEP_LOW, SEP_HIGH, Math.abs(wayBed[sl] - sheet.level))) * (1 - smoothstep(0, OWN_FADE, wayEdge[sl]));
        if (b > ownBench) { ownBench = b; own = sl; }
      }
      if (own >= 0) {
        let iso = 1;
        for (let sl = 0; sl < nSlots; sl++) {
          if (sl === own || wayEdge[sl] === Infinity) continue;
          const same = 1 - smoothstep(SEP_LOW, SEP_HIGH, Math.abs(wayBed[sl] - sheet.level));
          iso *= 1 - same * (1 - smoothstep(SHEET_ISO_NEAR, SHEET_ISO_FAR, wayEdge[sl]));
        }
        const off = wayDist[own];
        if (iso > 0 && off > 1e-3) {
          junctionSheet.sample(x - wayDirX[own] * off, z - wayDirZ[own] * off, sheetFoot);
          // (no plane reaches the foot: its own bed is the reference; the planes' level takes over as their weight grows)
          const ref = wayBed[own] + (sheetFoot.level - wayBed[own]) * smoothstep(0, SHEET_FOOT_WEIGHT, sheetFoot.weight);
          const lim = SHEET_CROSS_MAX * off, dv = sheet.level - ref;
          const capped = ref + (dv > lim ? lim : dv < -lim ? -lim : dv);
          level += (capped - level) * iso;
        }
      }
      bandY += (level - bandY) * sheet.weight * near * meet2 * (1 - apart) * (1 - pinCover);   // (the approach of a bridge keeps its own bed: the deck starts there)
    }
    // The protection keeps the ground under a bridge from being CUT (a pit under the deck) and from being buried under the batter of a road beside it; the CARRIAGEWAY of a way that
    // rises onto a bridge (its approach on a fill, lifted to the deck) is neither, and the corridor of the other carriageway's deck beside it - whose end lies 10 .. 20 m along on a skewed
    // bridge - flattened the end of the approach road into the valley.
    // (the cut of an opened tunnel under a bridge is the road the bridge spans: the protection kept the land there, a 1.2 m hump on the A1 under deck 32 with no tarmac painted)
    const protHere = (bandY > ground ? protFill : prot) * (1 - pinCover) * (1 - cutCover);    // (a fill under a bridge end may fall to the land over the abutment; a cut may not dig a pit)
    out.band = ground + (1 - protHere) * (bandY - ground);
    // The paint: the union of the carriageways and of the pavements, each way painted only where the ground lies at its own level.  Where two ways at different levels overlap in plan
    // (a slip road beside the trunk road, an overpass on its embankment) the ground between them is a ramp or the side of the embankment, and painted with the carriageway of the way
    // above it was a hillside of asphalt (Nei Escher Strooss).  A way off its level is pushed out of the union smoothly (PAINT_LEVEL_PUSH per m past PAINT_LEVEL_TOL), so the edge of the
    // tarmac runs along the top or the foot of the ramp and the distance field stays continuous.
    for (let q = 0; q < nPaint; q++) {
      const push = PAINT_LEVEL_PUSH * Math.max(0, Math.abs(out.band - paintBed[q]) - PAINT_LEVEL_TOL);
      // (the second distance is that of another CARRIAGEWAY: two ways of one carriageway that hand over are no median, and the paint reads the two as two exact channels, tile-mesh.js)
      const eCar = paintECar[q] + push, ePave = paintEPave[q] + push, roadHere = GROUP[paintRoad[q]];
      if (eCar < sdCar) {
        if (sdCarRoad !== roadHere) { sdCar2 = sdCar; sdCar2Road = sdCarRoad; disp2X = dispX; disp2Z = dispZ; }
        sdCar = eCar; sdCarRoad = roadHere; dispX = paintOffX[q]; dispZ = paintOffZ[q];
      } else if (roadHere !== sdCarRoad && eCar < sdCar2) { sdCar2 = eCar; sdCar2Road = roadHere; disp2X = paintOffX[q]; disp2Z = paintOffZ[q]; }
      if (ePave < sdPave) sdPave = ePave;
      if (paintMajor[q] && eCar < sdMajor) sdMajor = eCar;
    }
    // The paint CHANNELS (tile-mesh.js carriagewayChannels): the three nearest carriageways (groups), each with its distance, the distance to its pavement and whether it is a street
    // (the pale tar of the service ways is outside every street, see sdMajor).
    let nGrp = 0;
    for (let q = 0; q < nPaint && out.chCar; q++) {
      const push = PAINT_LEVEL_PUSH * Math.max(0, Math.abs(out.band - paintBed[q]) - PAINT_LEVEL_TOL);
      const g = GROUP[paintRoad[q]], eCar = paintECar[q] + push, ePave = paintEPave[q] + push;
      let k = 0;
      while (k < nGrp && chGroup[k] !== g) k++;
      if (k === nGrp) { chGroup[k] = g; chCar[k] = eCar; chPave[k] = ePave; chMajor[k] = paintMajor[q]; nGrp++; continue; }
      if (eCar < chCar[k]) chCar[k] = eCar;
      if (ePave < chPave[k]) chPave[k] = ePave;
      if (paintMajor[q]) chMajor[k] = 1;
    }
    for (let c = 0; c < CHANNELS && out.chCar; c++) {
      let bestK = -1;
      for (let k = 0; k < nGrp; k++) if (chGroup[k] !== -2 && (bestK < 0 || chCar[k] < chCar[bestK])) bestK = k;
      out.chGroup[c] = bestK < 0 ? -1 : chGroup[bestK]; out.chCar[c] = bestK < 0 ? SD_FAR : chCar[bestK];
      out.chPave[c] = bestK < 0 ? SD_FAR : chPave[bestK]; out.chMajor[c] = bestK < 0 ? 0 : chMajor[bestK];
      if (bestK >= 0) chGroup[bestK] = -2;          // (taken)
    }
    out.sdMajor = sdMajor;
    if (out.debug) out.debug.push({ ground, batter: devW > 0 ? ground + devSum / devW : ground, prot, pinCover, protHere, sheetLevel: sheet.level, sheetW: sheet.weight, ways: Array.from({ length: nSlots }, (_, q) => [slotRoad[q], wayEdge[q], wayBed[q]]) });
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
    out.hw = HW[best] + bestDh;
    out.a0 = A0[best] + bestDh;
    out.kind = KIND[best];
    out.road = ROADOF[best];
    out.surface = SURF[best];
    out.lines = LINES[best];
    out.lanes = info[ROADOF[best]].lanes;
    out.s = S0[best] + (S1[best] - S0[best]) * bestT;      // the distance along the centre line of that road
    const a = Math.abs(bestLat);
    const kerbH = KERBH[best];
    const hwB = HW[best] + bestDh, a0B = A0[best] + bestDh;
    if (kerbH <= 0 || !KERBON[best] || a <= hwB) out.kerb = 0;
    else if (a <= hwB + KERBW[best]) out.kerb = kerbH * (a - hwB) / KERBW[best];
    else if (a <= a0B) out.kerb = kerbH;
    else out.kerb = kerbH * Math.max(0, 1 - (a - a0B) / (RAD[best] - a0B));
    return out;
  }

  /** The road the point is on (or nearest to): { road, index, lat, dist, coverage }. */
  function nearestRoad(x, z, out) {
    carve(x, z, out);
    if (out.road < 0) return null;
    return { road: roads[out.road], index: out.road, lat: out.lat, dist: out.dist, coverage: out.coverage, kind: out.kind };
  }

  /** Does the game draw this way for a car: carved into the ground, or a drivable way that rides over it (a deck)?  A garage ramp is neither. */
  const isDrawn = (ri) => !!info[ri] || (!!roads[ri].info.drivable && !roads[ri].tunnel && !!(roads[ri].over || (roads[ri].layer || 0) >= 1));
  return {
    carve, nearestRoad, roads, info, count, scratch, overRoads, crossings, chains, protection, groundedDecks, isDrawn, carriageways,
    taperDhw, segments: { X0, Z0, X1, Z1, BED0, BED1, TAN0, TAN1, HW, DHW0, DHW1, KERBH, KERBW, PW, A0, RAD, REACH, KIND, ROADOF, KERBON, LINES, S0, S1, SURF },
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
