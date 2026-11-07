/* The drivable tunnels of Lux Drive (tunnels16): a real road tunnel is an underground deck.
 *
 * Until tunnels16 every tunnel ended at a closed portal (portals.js): one height field cannot hold a road under the land.  A tube does not
 * need the height field: the ground of a car INSIDE a tube is the tube's own road profile, the terrain and the streets above stay exactly
 * as they are (createGround asks the tubes first, at the car's own level, the way it asks the decks).  The tube is drawn as a tube
 * (tunnel-view.js: walls, ceiling, lights, lane lines), its mouths are open portals set into the cut of the approach road, and the
 * terrain inside the tube's shell is not drawn there (tunnel-mask.js), so the hill never shows a hole and never fills the mouth.
 *
 * The rule is measured, like tunnel-cover.js: a run of tunnel ways becomes a tube when
 *   - it is a car road (TUBE.kinds: a garage ramp or a car park lane stays closed),
 *   - it is one chain with two mouths (no fork inside: the branches of Albert Bousser stay closed),
 *   - a drawn road leads to each mouth along the tunnel axis (the road a car arrives on), and
 *   - a floor exists: smooth (a spline from the road at one mouth to the road at the other, with the grade of each approach), no steeper than
 *     TUBE.gradeMax, and deep enough that every carriageway over the tube keeps its ground (the roof under the road), and the land over it
 *     beyond the portal zones too.
 *
 * The floor of a tube, along its centre line s (1 m samples), is the solution of a small banded least-squares problem: minimal curvature
 * inside, the surface of the approach roads outside, and an upper bound under everything that lies over it (an active set).  The road
 * across is that profile plus the crossfall of the approaches.  In front of each mouth the floor blends into the surface over TUBE.blend m,
 * so the car meets no step (flush, like the deck ends).
 *
 * Pure (no THREE): the game, the harness and the tools read the same tubes. */
import { PORTAL } from './config.js';
import { insidePolygon, houseGrid } from './tunnel-cover.js';

export const TUBE = Object.freeze({
  // the classes of the roads that get a tube (a car park lane, a service way, a track or a footway stays closed)
  kinds: new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'unclassified', 'residential']),
  minLength: 25,           // m: a shorter tunnel run is a culvert or a passage under a building, not a tunnel to drive through
  shoulder: 1.0,           // m beside the carriageway to the wall of the tube (the inner half width is road.width / 2 + shoulder) ...
  shoulderMin: 0.2,        // ... at least this much on a side it shares with a parallel tube
  wall: 0.6,               // m: the thickness of the walls and the roof slab's edge
  clearance: { motorway: 5.0, motorway_link: 4.9, trunk: 4.8, trunk_link: 4.7, primary: 4.5 },
  clearanceDefault: 4.3,
  clearanceUnderpass: 3.9, // m: an underpass shorter than underpassLength (the roads under a roundabout: 4.0 - 4.7 m of land over its road) is a low box ...
  slabUnderpass: 0.35,     // ... with a thin slab
  underpassLength: 120,
  slab: 0.45,              // m: the roof slab over the ceiling (the roof top is floor + clearance + slab)
  coverMargin: 0.05,       // m: a road over the tube keeps this much over the roof
  approachRun: 130,        // m of each approach road that is part of the floor problem (its surface is the boundary; longer than the longest trough)
  fixedInside: 4,          // m: the surface outside the mouth is the boundary up to this far before the OSM mouth (the cap of a carved road end rises there)
  blend: 8,                // m in front of each mouth over which the car's ground blends from the surface into the floor of the tube
  flushIn: 16,             // m: the cross-section of the approach at a face fades into the plane floor over this ...
  flushOut: 0.4,           // ... read this far out of the face ...
  flushMax: 0.2,           // ... and never more than this off the plane (the cut slope beside a narrow approach is not its road)
  frontBack: 1.2,          // m: the face of a portal stands this far before the place where the drawn terrain rises over the road ...
  frontOut: 12,            // ... but at most this far out of the OSM mouth ...
  frontIn: 3,              // ... or this far into it
  riseLimit: 0.35,         // m: the drawn terrain "rises" over the road where it is this much higher (the lattice of a narrow approach lies 0.2 m over its continuous ground)
  portalZone: 16,          // m inside each face where the land over the tube may be lower than its roof (the hood of the portal)
  gradeMax: 0.10,          // the steepest floor
  crossMax: 0.03,          // the steepest crossfall of the floor (read on the approaches)
  overAbove: 2.0,          // m: in a portal zone a carriageway counts as "over" the tube where it lies this far above the straight floor (a road beside a mouth at its level
                           // does not; farther in, a road at the tube's level crosses it and the floor has to go under it: Bd Jean Ulveling over the René Konen tunnel)
  levelAbove: 2.6,         // m: a car (its body) at most this far over the floor is in the tube ...
  levelBelow: 2.0,         // ... and at most this far under it
  roofLift: 0.6,           // m: a car this close under the roof top (or over it) above the tube's footprint stands on the roof, not in the tube
  headDepth: 0.9,          // m: the thickness of the headwall of a portal
  wing: 1.4,               // m: the headwall reaches this far beside the outer walls
  parapet: 0.6,            // m: the headwall rises this much over the roof top
  headMax: 4.0,            // m: ... and covers the land behind it up to this much over the roof top
  maskInset: 0.25,         // m: the terrain is hidden this far inside the outer face of the shell (the wall hides the rest)
  maskLift: 0.03,          // m: ... and up to this much over the roof top
  exposeMargin: 3.2,       // m: a stretch of the shell whose land lies less than this over the roof is "exposed" (masked: the skirts of the terrain tiles hang 2.5 m and more
                           // under their edges, and from land 1 m over the roof a skirt stood in the tunnel)
  cell: 32,                // m: the spatial hash
  pushMax: 0.8,            // m: the most a wall pushes in one pass
  houseClear: 0.5,         // m: a house over a tube whose land lies less than this over the roof stands in the tube
  boundReach: 8,           // m: the bounds over the tube are eroded over this ...
  boundSigma: 12,          // ... and smoothed over this (m, a Gaussian) into the target of the floor ...
  approachGrade: 0.075,    // ... after reaching out from every bound at this grade (the highest floor of this grade under the bounds)
  lambda: 1.0,             // the weight of the curvature in the floor problem ...
  wFixed: 1.0,             // ... of the surface outside ...
  wFree: 1e-4,             // ... of the target inside (the straight line, or the smooth curve under the bounds) ...
  wPush: 1e-2,             // ... of a sample over its bound (doubled every pass it is still over) ...
  wHard: 1e7,              // ... at most
});

/**
 * The cut of an approach (tunnels16, round 2): where the land beside the road in front of a face lies over its floor, the road runs in a TROUGH, as at the real
 * portals - concrete retaining walls on both sides (the tube's walls continued out of the face), the floor of the tube's own profile between them (a plane across:
 * no gully, clean tarmac edges, the same lanes in every lane), and the terrain inside hidden (tunnel-mask.js).  Before, the hill reached the lane in one lattice cell:
 * a grass gully with ragged paint, and the outer lanes of the René Konen south approach rocked a car at 33.7 m/s2.
 */
export const TROUGH = Object.freeze({
  rise: 0.5,               // m: a station is in the cut where the land beside the road (at the foot or the back of a wall) lies this much over the floor ...
  quiet: 4,                // ... and the cut ends after this many metres of level land
  reach: 120,              // m: at most this far out of the face (the Rocade de Bonnevoie runs in a cut 3 - 6 m deep for more than 80 m)
  minLength: 6,            // m: a shorter cut gets no trough (the wings of the headwall hold it)
  laneRoom: 0.3,           // m: the approach's carriageway keeps this much to each wall ...
  wideReach: 12,           // ... and an approach wider than that (René Konen north, 3 lanes into a 2-lane tube) gets a trough of at most this many metres: its outer lane ends
                           // at the wall there, as it would in front of the face (tunnels18: without one, the face of the cut between it and the road beside it - 3.8 m higher -
                           // stood across the outer lane in front of the face, and the chase camera saw a slab of terrain where the tube's wall should be)
  levelRoad: 1.5,          // m: another road beside the trough within this of the floor is a junction at its level: the trough ends before it
  parapet: 0.8,            // m: a wall stands this much over the land behind it (a parapet: nobody drives over the edge) ...
  parapetEnd: 0.3,         // ... and this much at the outer end of the trough ...
  taper: 8,                // ... rising over this many metres
  back: 1.5,               // m behind a wall over which the land it holds is read
  speed: 20,               // m/s: the blend from the approach's ground into the floor at the outer end is long enough for this speed ...
  accel: 2,                // ... at this vertical acceleration (m/s2) ...
  blendMin: 6,             // ... and at least this long (m)
  slopeRun: 3,             // samples (m) out of the outer end over which the approach's grade in each lane is read ...
  slopeFade: 6,            // ... and the m over which the floor's own grade takes over from it
  wheelIn: 0.8,            // m: the wheels of a car in an outer lane run this far inside the edge of the carriageway
  wFloor: 1e-3,            // the weight of the carved approach under the smoothed floor of a trough (against TUBE.lambda: a smoothing over ~6 m) ...
  fixInside: 3,            // ... which is free from this far inside the face
});

/* The ways over a tube that need their ground (the roof stays under them): the roads of cars.  The land and the footways over a tube may lie lower than its roof: there the shell
 * shows (the hood of a portal) and the terrain inside it is hidden (exposedStretches, tunnel-mask.js).  Held under the land too, the floor of the Cents tunnel dived 1 m
 * just inside its mouth (13 % up and down) for a hill 5.6 m over the road. */
const OVER_KINDS = new Set([...TUBE.kinds, 'service', 'living_street', 'busway']);

/** The inner half width of a tube on the side of lat (a side next to a parallel tube is narrower: the two share a wall, see pairTubes). */
export const innerOf = (tube, lat) => (lat >= 0 ? tube.innerR : tube.innerL);
/** ... and the outer face of its wall on that side. */
export const outerOf = (tube, lat) => (lat >= 0 ? tube.outerR : tube.outerL);
/** ... and how far its headwall reaches beside the mouth on that side (no wing on a shared wall). */
export const headOf = (tube, lat) => (lat >= 0 ? tube.headR : tube.headL);

/** The sample index of a tube at arc length s (the samples are about 1 m apart, not exactly: the index is searched, not s rounded). */
export function indexAt(tube, s) {
  const n = tube.s.length;
  let i = Math.max(0, Math.min(n - 2, Math.round(s)));
  while (i > 0 && tube.s[i] > s) i--;
  while (i < n - 2 && tube.s[i + 1] <= s) i++;
  return i;
}

/** The side offsets (in inner half widths) at which the cross-section of an approach is read at a face. */
const FLUSH_LATS = [-1, -0.875, -0.75, -0.625, -0.5, -0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

/**
 * The floor of a tube at sample i (+ fraction f toward i + 1) and side offset lat: the profile, the crossfall and the approach's cross-section near each face.  The game
 * (createTubeNetwork) and the view (tunnel-view.js) read the floor through this one function.
 */
export function floorOf(tube, i, f, lat) {
  const s = tube.s[i] + (tube.s[i + 1] - tube.s[i]) * f;
  let h = tube.floor[i] + (tube.floor[i + 1] - tube.floor[i]) * f + (tube.cross[i] + (tube.cross[i + 1] - tube.cross[i]) * f) * lat;
  const u = clamp(lat / tube.innerHalf, -1, 1) * 8 + 8, k = Math.min(15, Math.floor(u)), r = u - k;
  if (tube.flushA && s < tube.sA + TUBE.flushIn) h += (tube.flushA[k] + (tube.flushA[k + 1] - tube.flushA[k]) * r) * (1 - smooth01((s - tube.sA) / TUBE.flushIn));
  if (tube.flushB && s > tube.sB - TUBE.flushIn) h += (tube.flushB[k] + (tube.flushB[k + 1] - tube.flushB[k]) * r) * (1 - smooth01((tube.sB - s) / TUBE.flushIn));
  return h;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const endsOf = (road) => [road.pts[0], road.pts[road.pts.length - 1]];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** The runs of tunnel ways (two ways whose ends are within PORTAL.joinTolerance belong to one tunnel), as tunnel-cover.js chains them. */
function tunnelRuns(tunnels) {
  const parent = tunnels.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < tunnels.length; i++) {
    for (let j = i + 1; j < tunnels.length; j++) {
      if (endsOf(tunnels[i]).some((a) => endsOf(tunnels[j]).some((b) => dist(a, b) <= PORTAL.joinTolerance))) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
    }
  }
  const runs = new Map();
  tunnels.forEach((t, i) => { const r = find(i); if (runs.has(r)) runs.get(r).push(t); else runs.set(r, [t]); });
  return [...runs.values()];
}

/** A run as ONE chain of points from one mouth to the other, or null (a fork, a ring, a lone way that is its own ring). */
function chainOf(run) {
  const tol = PORTAL.joinTolerance;
  const degree = (p) => run.reduce((n, r) => n + endsOf(r).filter((e) => dist(e, p) <= tol).length, 0);
  const ends = run.flatMap((r) => endsOf(r));
  if (ends.some((e) => degree(e) > 2)) return null;
  const mouths = ends.filter((e) => degree(e) === 1);
  if (mouths.length !== 2 || dist(mouths[0], mouths[1]) < 10) return null;
  const left = new Set(run);
  let at = mouths[0];
  const pts = [at];
  const ways = [];
  while (left.size) {
    const next = [...left].find((r) => endsOf(r).some((e) => dist(e, at) <= tol));
    if (!next) return null;
    left.delete(next);
    const fwd = dist(next.pts[0], at) <= dist(next.pts[next.pts.length - 1], at) ? next.pts : [...next.pts].reverse();
    for (let i = 1; i < fwd.length; i++) pts.push(fwd[i]);
    at = fwd[fwd.length - 1];
    ways.push(next);
  }
  return { pts, ways };
}

/** The drawn centre line of way ri ([[x, z], ...]), as the network carves it (road-network samples). */
function drawnLine(net, ri) {
  const s = net.samples, first = s.first[ri], n = s.segs[ri] + 1;
  if (first < 0 || n < 2) return null;
  const out = [];
  for (let i = 0; i < n; i++) out.push([s.x[first + i], s.z[first + i]]);
  return out;
}

/**
 * The road a car arrives on at a mouth: a drawn way (net.isDrawn) whose end lies within PORTAL.mouthGap of the mouth and that leaves it outward along
 * the tunnel axis (as portals.js finds the approach of a portal).  Returns its drawn line from that end outward (up to TUBE.approachRun m) or null.
 */
function approachAt(roads, net, mouth, axisOut, tunnelIds) {
  let best = null, bestGap = PORTAL.mouthGap;
  for (const r of roads) {
    if (r.tunnel || tunnelIds.has(r.id) || !r.info.drivable || !net.isDrawn(r.id) || !net.info[r.id]) continue;
    const m = r.pts.length;
    for (let f = 0; f < 2; f++) {
      const b = f === 0 ? r.pts[0] : r.pts[m - 1], nb = f === 0 ? r.pts[1] : r.pts[m - 2];
      const g = dist(mouth, b);
      if (g > bestGap) continue;
      const ox = nb[0] - b[0], oz = nb[1] - b[1], ol = Math.hypot(ox, oz);
      if (!(ol > 0.01) || (ox * axisOut[0] + oz * axisOut[1]) / ol < PORTAL.approachAlign) continue;
      best = { road: r, atStart: f === 0 }; bestGap = g;
    }
  }
  if (!best) return null;
  const line = drawnLine(net, best.road.id);
  if (!line) return null;
  const fwd = best.atStart ? line : [...line].reverse();
  const out = [fwd[0]];
  let s = 0;
  for (let i = 1; i < fwd.length && s < TUBE.approachRun; i++) { s += dist(fwd[i], fwd[i - 1]); out.push(fwd[i]); }
  return { road: best.road, pts: out, gap: bestGap };
}

/** Resamples a polyline every `step` m (the ends kept).  Returns [[x, z], ...]. */
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = dist(a, b);
    let d = step - carry;
    while (d < l) { out.push([a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l]); d += step; }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push(last); else out[out.length - 1] = last;
  return out;
}

/** A Gaussian smoothing of the inner points of a polyline (sigma in samples); the points in `keep` (indices) stay where they are. */
function smoothLine(pts, sigma, keep) {
  const n = pts.length, r = Math.ceil(sigma * 3), out = pts.map((p) => [p[0], p[1]]);
  for (let i = 1; i < n - 1; i++) {
    if (keep(i)) continue;
    let sx = 0, sz = 0, sw = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { const w = Math.exp(-0.5 * ((j - i) / sigma) ** 2); sx += w * pts[j][0]; sz += w * pts[j][1]; sw += w; }
    out[i] = [sx / sw, sz / sw];
  }
  return out;
}

/**
 * Solves (lambda D'D + W) f = W t for a 1 m sample line (D the second difference): a pentadiagonal symmetric system, banded LDL'.  Pure: a new array.
 */
function solveBanded(t, w, lambda) {
  const n = t.length;
  // the bands of A: a0 (diagonal), a1 (first off-diagonal), a2 (second)
  const a0 = new Float64Array(n), a1 = new Float64Array(n), a2 = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {          // one second difference (i-1, i, i+1) with coefficients (1, -2, 1)
    const idx = [i - 1, i, i + 1], c = [1, -2, 1];
    for (let p = 0; p < 3; p++) {
      for (let q = p; q < 3; q++) {
        const v = lambda * c[p] * c[q], k = q - p, r = idx[p];
        if (k === 0) a0[r] += v; else if (k === 1) a1[r] += v; else a2[r] += v;
      }
    }
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) { a0[i] += w[i]; b[i] = w[i] * t[i]; }
  // banded Cholesky-like LDL' (bandwidth 2)
  const d = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let di = a0[i];
    if (i >= 1) di -= l1[i - 1] * l1[i - 1] * d[i - 1];
    if (i >= 2) di -= l2[i - 2] * l2[i - 2] * d[i - 2];
    d[i] = di;
    if (!(Math.abs(di) > 1e-14)) throw new Error(`tunnel-tubes: singular floor system at ${i}`);
    if (i + 1 < n) {
      let v = a1[i];
      if (i >= 1) v -= l1[i - 1] * l2[i - 1] * d[i - 1];
      l1[i] = v / di;
    }
    if (i + 2 < n) l2[i] = a2[i] / di;
  }
  // forward (L y = b), diagonal, backward (L' f = z)
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = b[i] - (i >= 1 ? l1[i - 1] * y[i - 1] : 0) - (i >= 2 ? l2[i - 2] * y[i - 2] : 0);
  for (let i = 0; i < n; i++) y[i] /= d[i];
  const f = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) f[i] = y[i] - (i + 1 < n ? l1[i] * f[i + 1] : 0) - (i + 2 < n ? l2[i] * f[i + 2] : 0);
  return f;
}

/** The clearance of a tube of this run (the inner height, floor to ceiling). */
function clearanceOf(kind, length) {
  const base = TUBE.clearance[kind] ?? TUBE.clearanceDefault;
  return length < TUBE.underpassLength ? Math.min(base, TUBE.clearanceUnderpass) : base;
}

/**
 * Builds one tube (or returns { reject: why }).
 * surface: surface.js (height = the drawn lattice, field.height = the continuous ground, roadInfoAt), net: the road network.
 */
function buildTube(chain, appA, appB, surface, net, roads, housesNear) {
  const way = chain.ways.find((w) => w.name) || chain.ways[0];
  const width = Math.max(...chain.ways.map((w) => w.width));
  const length = chain.ways.reduce((s, w) => s + w.length, 0);
  const innerHalf = width / 2 + TUBE.shoulder, outerHalf = innerHalf + TUBE.wall;
  const clearance = clearanceOf(way.kind, length);
  const roofDepth = clearance + (length < TUBE.underpassLength ? TUBE.slabUnderpass : TUBE.slab);
  // the centre line: approach A (toward the mouth), the tunnel, approach B (away from it), every 1 m; the tunnel part rounded like a drawn road
  const tunnelPts = resample(chain.pts, 1);
  const aPts = resample([...appA.pts].reverse(), 1), bPts = resample(appB.pts, 1);
  const rounded = smoothLine(tunnelPts, 3, (i) => i < 2 || i > tunnelPts.length - 3);
  // (the end of an approach lies within PORTAL.mouthGap of the mouth: a light smoothing over the whole line takes the kink out of the joint)
  const raw = [...aPts.slice(0, -1), ...rounded, ...bPts.slice(1)];
  const pts = resample(smoothLine(raw, 2, () => false), 1);
  const n = pts.length;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + dist(pts[i], pts[i - 1]);
  const nearestS = (p, from, to) => { let bi = from; for (let i = from; i <= to; i++) if (dist(pts[i], p) < dist(pts[bi], p)) bi = i; return s[bi]; };
  // (each mouth on its own side of the middle of the TUNNEL part: the two approaches can differ in length by 100 m)
  const mid = clamp(aPts.length - 1 + (rounded.length >> 1), 1, n - 2);
  const sMouthA = nearestS(chain.pts[0], 0, mid), sMouthB = nearestS(chain.pts[chain.pts.length - 1], mid, n - 1);
  const tx = new Float64Array(n), tz = new Float64Array(n);       // the unit tangent at each sample
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], l = dist(a, b) || 1;
    tx[i] = (b[0] - a[0]) / l; tz[i] = (b[1] - a[1]) / l;
  }
  // the side offset: lat > 0 to the right of the direction of s (x east, z south: right = (-tz, tx))
  const at = (i, lat) => [pts[i][0] - tz[i] * lat, pts[i][1] + tx[i] * lat];
  const contact = (x, z) => (surface.field ? surface.field.height(x, z) : surface.height(x, z));

  // ---- the crossfall of each approach (m per m across, to the right), read on the continuous ground 6 m out of the mouth
  const crossAt = (sq) => {
    const i = clamp(Math.round(sq), 0, n - 1), h = clamp(width / 2 - 0.6, 0.6, 1.2);      // (inside the kerbs)
    const [xa, za] = at(i, h), [xb, zb] = at(i, -h);
    return clamp((contact(xa, za) - contact(xb, zb)) / (2 * h), -TUBE.crossMax, TUBE.crossMax);
  };
  const cA = crossAt(sMouthA - 6), cB = crossAt(sMouthB + 6);
  const cross = new Float64Array(n);
  for (let i = 0; i < n; i++) cross[i] = cA + (cB - cA) * smooth01((s[i] - (sMouthA - 6)) / Math.max(1, sMouthB - sMouthA + 12));

  // ---- the boundary (the surface outside the mouths), the straight line inside, and the bounds (everything over the tube)
  const t = new Float64Array(n), w = new Float64Array(n), upper = new Float64Array(n).fill(Infinity), hardKind = new Uint8Array(n);
  const fixA = sMouthA - TUBE.fixedInside, fixB = sMouthB + TUBE.fixedInside;
  for (let i = 0; i < n; i++) {
    if (s[i] <= fixA || s[i] >= fixB) { t[i] = contact(pts[i][0], pts[i][1]); w[i] = TUBE.wFixed; } else w[i] = TUBE.wFree;
  }
  // the straight line inside (a weak target): between the boundary values at the two ends of the free part
  let iA = 0, iB = n - 1;
  while (iA < n - 1 && s[iA + 1] <= fixA) iA++;
  while (iB > 0 && s[iB - 1] >= fixB) iB--;
  for (let i = iA + 1; i < iB; i++) t[i] = t[iA] + ((t[iB] - t[iA]) * (s[i] - s[iA])) / Math.max(1e-6, s[iB] - s[iA]);
  const info = {};
  const lats = [-outerHalf, -innerHalf, -innerHalf / 2, 0, innerHalf / 2, innerHalf, outerHalf];
  /** The upper bounds of the floor between the faces sFa .. sFb (a road over the cut in front of a face is not over the tube). */
  const boundsBetween = (sFa, sFb) => {
    upper.fill(Infinity); hardKind.fill(0);
    for (let i = iA + 1; i < iB; i++) {
      if (s[i] < sFa + 0.5 || s[i] > sFb - 0.5) continue;
        // over the tube: a carriageway of another road needs its ground (in a portal zone it may lie on the lintel of the headwall)
      const inZone = s[i] < sFa + TUBE.portalZone || s[i] > sFb - TUBE.portalZone;
      for (const lat of lats) {
        // (in a portal zone only a road over the middle of the tube counts, and it may lie on the lintel of the headwall: the roundabout over the Schuman underpass reaches over
        // the top of the cut beside the mouth, where the real headwall stands under the edge of its carriageway)
        if (inZone && Math.abs(lat) > innerHalf / 2 + 1e-6) continue;
        const [x, z] = at(i, lat);
        const h = surface.height(x, z);
        surface.roadInfoAt(x, z, info);
        const other = info.road >= 0 ? roads[info.road] : null;
        const onRoad = info.sdCar < 0 && other && other.id !== appA.road.id && other.id !== appB.road.id && !other.tunnel && OVER_KINDS.has(other.kind) && (!inZone || h > t[i] + TUBE.overAbove);
        if (onRoad) {
          const u = h - (inZone ? clearance : roofDepth) - TUBE.coverMargin - Math.abs(cross[i]) * outerHalf;
          if (u < upper[i]) { upper[i] = u; hardKind[i] = onRoad ? 1 : 2; }
        }
      }
    }
  };
  /**
   * The target inside: the straight line, or under it a smooth curve below the bounds - the bounds eroded (a moving minimum over TUBE.boundReach m) and smoothed
   * (a Gaussian of TUBE.boundSigma m).  The bounds are rough (the land and the streets over the tube): pinned to them directly, the floor followed every bump of
   * the land 5 m over it.  The few samples still over their bound are pinned by the active set below.
   */
  const target = () => {
    const out = Float64Array.from(t), eroded = new Float64Array(n);
    const cap = (i) => Math.min(upper[i], t[i] + 50);
    for (let i = 0; i < n; i++) {
      let m = cap(i);
      for (let j = i - 1; j >= 0 && s[i] - s[j] <= TUBE.boundReach; j--) m = Math.min(m, cap(j));
      for (let j = i + 1; j < n && s[j] - s[i] <= TUBE.boundReach; j++) m = Math.min(m, cap(j));
      eroded[i] = m;
    }
    // ... and every bound reaches out at TUBE.approachGrade (a cone): the floor starts down to a road it has to pass under far enough ahead, not 40 m before it
    const coned = Float64Array.from(eroded);
    for (let i = 1; i < n; i++) coned[i] = Math.min(coned[i], coned[i - 1] + TUBE.approachGrade * (s[i] - s[i - 1]));
    for (let i = n - 2; i >= 0; i--) coned[i] = Math.min(coned[i], coned[i + 1] + TUBE.approachGrade * (s[i + 1] - s[i]));
    for (let i = iA + 1; i < iB; i++) {
      let sum = 0, sw = 0;
      for (let j = Math.max(0, i - 3 * TUBE.boundSigma); j <= Math.min(n - 1, i + 3 * TUBE.boundSigma); j++) {
        const g = Math.exp(-0.5 * ((s[j] - s[i]) / TUBE.boundSigma) ** 2);
        sum += g * coned[j]; sw += g;
      }
      out[i] = Math.min(t[i], sum / sw - TUBE.coverMargin);
    }
    return out;
  };
  /** The active set: solve, push every sample over its bound down, solve again. */
  const solve = () => {
    let f = null;
    const wAct = Float64Array.from(w), tAct = target();
    // (a violator's target goes down by its violation, with a firmer weight, until none is left: pinned hard to the rough bound, the floor kinked at every pin -
    // 13 m/s2 at 13 m/s under Bd Jean Ulveling)
    for (let pass = 0; pass < 80; pass++) {
      f = solveBanded(tAct, wAct, TUBE.lambda);
      let added = 0;
      for (let i = 0; i < n; i++) {
        if (f[i] > upper[i] + 0.005) { wAct[i] = Math.min(TUBE.wHard, Math.max(wAct[i] * 2, TUBE.wPush)); tAct[i] -= f[i] - upper[i] + 0.01; added++; }
      }
      if (!added) break;
    }
    return f;
  };
  /** The face of a portal: before the place where the drawn terrain rises over the road (the straight line t between the approaches). */
  const faceOf = (sMouth, dirOut) => {
    let sRise = null;
    const hw = 0.5;      // (the middle of the approach: the hill rises across the whole road, the cut of a narrow approach beside its lane - René Konen south)
    // (from the end of the approach's boundary inward: farther out the line IS the drawn road, and only the lattice of a narrow approach lay over its continuous ground)
    for (let k = -TUBE.fixedInside; k <= TUBE.frontIn + 8; k += 0.5) {
      const sq = sMouth - dirOut * k;           // k: metres INTO the tunnel from the mouth
      const i = clamp(Math.round(sq), 0, n - 1);
      let rises = false;
      for (const lat of [-hw, -hw / 2, 0, hw / 2, hw]) {
        const [x, z] = at(i, lat);
        if (surface.height(x, z) - (t[i] + cross[i] * lat) > TUBE.riseLimit) { rises = true; break; }     // (over the straight road, not the floor: a sag would move the face out)
      }
      if (rises) { sRise = k; break; }
    }
    const kFace = sRise === null ? 0 : clamp(sRise - TUBE.frontBack, -TUBE.frontOut, TUBE.frontIn);
    return sMouth - dirOut * kFace;
  };
  const sFa = faceOf(sMouthA, -1), sFb = faceOf(sMouthB, 1);
  // the floor meets the approach AT the face: the surface is the boundary up to the face (the terrain rises only behind it), the floor free from there on.  (With the
  // boundary at the mouth +- TUBE.fixedInside, a face outside it met a floor that followed the chord between the mouths: 12 cm under the road at the face of Rue du Grünewald.)
  for (let i = 0; i < n; i++) {
    if (s[i] <= sFa || s[i] >= sFb) { t[i] = contact(pts[i][0], pts[i][1]); w[i] = TUBE.wFixed; } else w[i] = TUBE.wFree;
  }
  iA = 0; iB = n - 1;
  while (iA < n - 1 && s[iA + 1] <= sFa) iA++;
  while (iB > 0 && s[iB - 1] >= sFb) iB--;
  for (let i = iA + 1; i < iB; i++) t[i] = t[iA] + ((t[iB] - t[iA]) * (s[i] - s[iA])) / Math.max(1e-6, s[iB] - s[iA]);
  boundsBetween(sFa, sFb);
  const f = solve();
  // ---- the measures: grade, curvature, how much of the bound is still broken
  let grade = 0, gradeAt = 0, curve = 0, curveAt = 0, over = 0, overRoad = 0;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] < Math.max(sFa, fixA) || s[i] > Math.min(sFb, fixB)) continue;     // (the approaches are the roads of the world as they are: a face out on a steep approach is not the tube's grade)
    const gi = Math.abs(f[i + 1] - f[i - 1]) / Math.max(1e-6, s[i + 1] - s[i - 1]);
    if (gi > grade) { grade = gi; gradeAt = s[i]; }
    const ci = Math.abs(f[i + 1] - 2 * f[i] + f[i - 1]);
    if (ci > curve) { curve = ci; curveAt = s[i]; }
    const o = f[i] - upper[i];
    if (o > 0.02) { over = Math.max(over, o); if (hardKind[i] === 1) overRoad = Math.max(overRoad, o); }
  }
  const tube = {
    name: way.name || way.kind, label: way.name || '', kind: way.kind, ids: chain.ways.map((r) => r.id), oneway: chain.ways.every((r) => r.oneway), lanes: way.lanes || 1, width,
    length, innerHalf, outerHalf, innerL: innerHalf, innerR: innerHalf, outerL: outerHalf, outerR: outerHalf, headL: outerHalf + TUBE.wing, headR: outerHalf + TUBE.wing,
    clearance, roofDepth,
    x: Float64Array.from(pts, (p) => p[0]), z: Float64Array.from(pts, (p) => p[1]), s, tx, tz, floor: f, cross,
    sMouthA, sMouthB, sA: sFa, sB: sFb, flushA: null, flushB: null, upper: Float32Array.from(upper), line: Float32Array.from(t), approachA: appA.road.id, approachB: appB.road.id, grade, curve, curveAt, over, overRoad,
  };
  // the cross-section of each approach at its face (what the plane f + cross * lat does not hold: the crown of a street, the gully of a narrow approach), fading out
  // TUBE.flushIn m into the tube: the floor meets every lane of the approach without a step (flush, like the deck ends)
  const residualAt = (sFace, dirOut) => {
    const i = clamp(Math.round(sFace + dirOut * TUBE.flushOut), 0, n - 1);
    const out = new Float32Array(FLUSH_LATS.length);
    const [xc, zc] = at(i, 0), base = contact(xc, zc);
    FLUSH_LATS.forEach((u, k) => {
      const lat = u * innerHalf, [x, z] = at(i, lat);
      out[k] = clamp(contact(x, z) - base - cross[i] * lat, -TUBE.flushMax, TUBE.flushMax);
    });
    return out;
  };
  const flushA = residualAt(sFa, -1), flushB = residualAt(sFb, 1);
  // a house standing in the tube (its footprint over the tube where the land under it lies lower than the roof: the house's walls would stand in the tunnel) keeps it closed
  if (housesNear) {
    for (let i = 0; i < n; i++) {
      if (s[i] < sFa || s[i] > sFb) continue;
      for (const lat of [-outerHalf, 0, outerHalf]) {
        const [x, z] = at(i, lat);
        if (surface.height(x, z) < f[i] + roofDepth + TUBE.houseClear && housesNear(x, z).some((b) => insidePolygon(b.pts, x, z))) {
          return { reject: `a house stands in it at ${Math.round(x)},${Math.round(z)}`, tube };
        }
      }
    }
  }
  tube.flushA = flushA; tube.flushB = flushB;
  if (grade > TUBE.gradeMax) return { reject: `grade ${(grade * 100).toFixed(1)} % at ${(gradeAt - sMouthA).toFixed(0)} m from the first mouth (faces ${(sFa - sMouthA).toFixed(1)} / ${(sFb - sMouthA).toFixed(1)})`, tube };
  if (overRoad > 0.05) return { reject: `a road over it ${overRoad.toFixed(2)} m into the roof`, tube };
  return { tube };
}

/**
 * The tubes of a road network.
 * roads: the decoded ways (after tunnel-cover.js); surface: surface.js; net: road-network.js (surface.field.network); buildings (optional): the footprints
 * [{ pts }] (a tube a house stands in stays closed).
 * Returns { tubes, rejected: [{ name, ids, why }] }.
 */
export function findTubes(roads, surface, net, buildings = null) {
  const tunnels = roads.filter((r) => r.tunnel && r.info.drivable && r.pts.length >= 2);
  const housesNear = buildings ? houseGrid(buildings, tunnels) : null;
  const tubes = [], rejected = [];
  for (const run of tunnelRuns(tunnels)) {
    const name = (run.find((r) => r.name) || run[0]).name || run[0].kind;
    const ids = run.map((r) => r.id);
    const length = run.reduce((sum, r) => sum + r.length, 0);
    if (!TUBE.kinds.has(run[0].kind) || length < TUBE.minLength) continue;          // (the garages and the lanes are not listed: they never were tunnels to drive)
    const chain = chainOf(run);
    if (!chain) { rejected.push({ name, ids, length, why: 'a fork or a ring inside' }); continue; }
    const p = chain.pts, m = p.length;
    const outA = [p[0][0] - p[1][0], p[0][1] - p[1][1]], la = Math.hypot(...outA);
    const outB = [p[m - 1][0] - p[m - 2][0], p[m - 1][1] - p[m - 2][1]], lb = Math.hypot(...outB);
    const tunnelIds = new Set(ids);
    const appA = approachAt(roads, net, p[0], [outA[0] / la, outA[1] / la], tunnelIds);
    const appB = approachAt(roads, net, p[m - 1], [outB[0] / lb, outB[1] / lb], tunnelIds);
    if (!appA || !appB) { rejected.push({ name, ids, length, why: `no drawn road at ${appA ? 'the end' : 'the start'}` }); continue; }
    const built = buildTube(chain, appA, appB, surface, net, roads, housesNear);
    if (built.reject) { rejected.push({ name, ids, length, why: built.reject, tube: built.tube }); continue; }
    tubes.push(built.tube);
  }
  const paired = pairTubes(tubes, rejected);
  return { tubes: paired.tubes.map((t) => withTroughs(t, surface, roads)), rejected: paired.rejected };
}

/** The point of a tube at sample i, lat to the right. */
const sidePoint = (tube, i, lat) => [tube.x[i] - tube.tz[i] * lat, tube.z[i] + tube.tx[i] * lat];

/**
 * The length of the trough of one approach (end -1: the approach of face A, outward = decreasing s; +1: face B), measured from the face outward: a station is in
 * the cut while the land beside the road lies TROUGH.rise over the floor on either side; the trough ends at TROUGH.quiet m of level land, at a road beside it at its
 * level (a junction), at another road across it or into it, or where the samples of the approach end.  0: no trough.
 */
function troughLength(tube, end, surface, roads) {
  const appId = end < 0 ? tube.approachA : tube.approachB;
  const app = roads[appId];
  if (!app) return 0;
  const reach = app.width / 2 > Math.min(tube.innerL, tube.innerR) - TROUGH.laneRoom ? TROUGH.wideReach : TROUGH.reach;
  const sFace = end < 0 ? tube.sA : tube.sB, n = tube.s.length;
  const own = new Set([appId, ...tube.ids]);
  const info = {};
  const plane = (i, lat) => tube.floor[i] + tube.cross[i] * lat;
  let len = 0, quiet = 0;
  for (let k = 0.5; k <= reach; k += 1) {
    const sq = sFace + end * k;
    if (sq < tube.s[0] + 1 || sq > tube.s[n - 1] - 1) break;
    const i = indexAt(tube, sq);
    let rise = -Infinity, junction = false;
    for (const side of [-1, 1]) {
      const inner = innerOf(tube, side), outer = outerOf(tube, side);
      for (const l of [inner + 0.3, outer + 0.8]) { const [x, z] = sidePoint(tube, i, side * l); rise = Math.max(rise, surface.height(x, z) - plane(i, side * l)); }
      for (const l of [0, inner - 0.5, outer + 0.3, outer + 1.2]) {
        const [x, z] = sidePoint(tube, i, side * l);
        surface.roadInfoAt(x, z, info);
        const other = info.sdCar < 0 && info.road >= 0 && !own.has(info.road) ? roads[info.road] : null;
        // (a road at its level beside it or across it is a junction; a road at any level whose carriageway reaches into the trough would lose its edge to it.  A higher
        // road just behind a wall is held by it: Bd Roosevelt over the René Konen south approach)
        if (other && !other.tunnel && (l < inner || Math.abs(surface.height(x, z) - plane(i, side * l)) < TROUGH.levelRoad)) junction = true;
      }
    }
    if (junction) break;
    if (rise > TROUGH.rise) { len = k + 0.5; quiet = 0; } else if (++quiet > TROUGH.quiet) break;
  }
  return len < TROUGH.minLength ? 0 : len;
}

/**
 * The floor of a tube with its troughs smoothed (a new array): in a trough the floor is ours (the walls hide the land), so it need not follow every cell of the carved
 * approach - the profile of the René Konen south approach, read on its centre line, changed its grade from 4 to 11 % and back every 8 m (29 m/s2 at 13 m/s).  The
 * samples outside the troughs (and TROUGH_FIX m into the tube) are held, the trough is the smoothest curve between them.
 */
function smoothTroughFloor(tube, lenA, lenB) {
  const n = tube.s.length, w = new Float64Array(n), t = Float64Array.from(tube.floor);
  for (let i = 0; i < n; i++) {
    const s = tube.s[i];
    const free = (lenA && s > tube.sA - lenA && s < tube.sA + TROUGH.fixInside) || (lenB && s < tube.sB + lenB && s > tube.sB - TROUGH.fixInside);
    w[i] = free ? TROUGH.wFloor : TUBE.wHard;
  }
  return solveBanded(t, w, TUBE.lambda);
}

/** The blend and the wall tops of a trough of length len (the floor already smoothed): { len, blend, top: [L, R] per sample index (NaN outside), width }. */
function troughShape(tube, end, len, surface, roads) {
  const app = roads[end < 0 ? tube.approachA : tube.approachB];
  const sFace = end < 0 ? tube.sA : tube.sB, n = tube.s.length;
  const plane = (i, lat) => tube.floor[i] + tube.cross[i] * lat;
  // the blend at the outer end: as long as the step between the approach's ground and the plane across its lanes needs (a smoothstep of height h over L m has a peak
  // curvature of 6 h / L2)
  // (read where the wheels run: the outer edge of an outer lane of a narrow carved approach lies on the slope of its gully, which the floor hides)
  const sEnd = sFace + end * len, hw = Math.max(0.5, app.width / 2 - TROUGH.wheelIn);
  let dh = 0;
  for (let d = 0; d <= 12; d += 1) {
    const i = indexAt(tube, sEnd - end * d);
    for (const lat of [-hw, -hw / 2, 0, hw / 2, hw]) { const [x, z] = sidePoint(tube, i, lat); dh = Math.max(dh, Math.abs(surface.height(x, z) - plane(i, lat))); }
  }
  const blend = clamp(Math.sqrt((6 * dh * TROUGH.speed ** 2) / TROUGH.accel), TROUGH.blendMin, len);
  // the cross-section of the approach at the outer end (the drawn ground against the plane, across the whole floor): the floor starts there exactly on the ground and
  // fades into the plane over the blend.  (Blended into the ground itself, the floor carried every step of the carved approach into the trough: 0.27 m in 1 m on the
  // centre line of the René Konen south approach, 20 m/s2.)
  const iE = clamp(Math.round(indexAt(tube, sEnd) + (sEnd - tube.s[indexAt(tube, sEnd)]) / Math.max(1e-6, tube.s[Math.min(n - 1, indexAt(tube, sEnd) + 1)] - tube.s[indexAt(tube, sEnd)])), 0, n - 1);
  // (read every EDGE_STEP m across: interpolated from the 17 lats of a face, the floor met the lattice 2 cm off and a car felt the step at 5 m/s2.  And its grade too, 3 m out:
  // the floor leaves the end with the approach's own grade in every lane, see troughFloor)
  const iOut = clamp(iE + end * TROUGH.slopeRun, 0, n - 1), run = Math.abs(tube.s[iE] - tube.s[iOut]) || 1;
  const lats = Array.from({ length: EDGE_N }, (_, k) => (k / (EDGE_N - 1) * 2 - 1) * tube.innerHalf);
  const residual = (i, lat) => { const [x, z] = sidePoint(tube, i, lat); return surface.height(x, z) - plane(i, lat); };
  const edge = Float32Array.from(lats, (lat) => residual(iE, lat));
  const edgeSlope = Float32Array.from(lats, (lat, k) => (edge[k] - residual(iOut, lat)) / run);
  // the wall tops: the land the wall holds (from the middle of the lane to TROUGH.back behind it) plus the parapet, never lower than a parapet over the floor
  const top = [new Float32Array(n).fill(NaN), new Float32Array(n).fill(NaN)];
  const iFace = indexAt(tube, sFace), iEnd = indexAt(tube, sEnd);
  const i0 = Math.min(iFace, iEnd), i1 = Math.min(n - 1, Math.max(iFace, iEnd) + 1);
  for (let i = i0; i <= i1; i++) {
    const dEnd = Math.abs(tube.s[i] - sEnd);
    const parapet = TROUGH.parapetEnd + (TROUGH.parapet - TROUGH.parapetEnd) * smooth01(dEnd / TROUGH.taper);
    [-1, 1].forEach((side, k) => {
      const inner = innerOf(tube, side), outer = outerOf(tube, side);
      let land = plane(i, side * inner);
      for (let l = inner / 2; l <= outer + TROUGH.back + 1e-6; l += 0.5) { const [x, z] = sidePoint(tube, i, side * l); land = Math.max(land, surface.height(x, z)); }
      top[k][i] = land + parapet;
    });
  }
  // (a moving maximum, then a moving mean, each over TOP_SMOOTH m to each side: the coping runs in long even lines, not along every cell of the lattice, and still over
  // the land at every station - every maximum in the mean covers the station)
  const pass = (arr, fn) => Float32Array.from(arr, (v, i) => {
    if (Number.isNaN(v)) return v;
    const win = [];
    for (let j = Math.max(i0, i - TOP_SMOOTH); j <= Math.min(i1, i + TOP_SMOOTH); j++) if (!Number.isNaN(arr[j])) win.push(arr[j]);
    return fn(win);
  });
  const out = top.map((arr) => pass(pass(arr, (w) => Math.max(...w)), (w) => w.reduce((p, q) => p + q, 0) / w.length));
  return { len, blend, top: out, width: app.width, edge, edgeSlope };
}

/** A tube with the troughs of its approaches (a new object): tA / tB the outer ends (sA / sB without one), the flush residual of a trough's face dropped (its floor is a plane). */
function withTroughs(tube, surface, roads) {
  // (each outer end on a sample: there the floor starts exactly on the cross-section read at that sample)
  const n = tube.s.length;
  const rawA = troughLength(tube, -1, surface, roads), rawB = troughLength(tube, 1, surface, roads);
  const lenA = rawA ? tube.sA - tube.s[indexAt(tube, tube.sA - rawA)] : 0;
  const lenB = rawB ? tube.s[Math.min(n - 1, indexAt(tube, tube.sB + rawB) + 1)] - tube.sB : 0;
  if (!lenA && !lenB) return { ...tube, troughA: 0, troughB: 0, blendA: 0, blendB: 0, roadA: 0, roadB: 0, edgeA: null, edgeB: null, edgeSlopeA: null, edgeSlopeB: null, tA: tube.sA, tB: tube.sB, wallTopL: new Float32Array(tube.s.length).fill(NaN), wallTopR: new Float32Array(tube.s.length).fill(NaN) };
  const smoothed = { ...tube, floor: smoothTroughFloor(tube, lenA, lenB) };
  const a = lenA ? troughShape(smoothed, -1, lenA, surface, roads) : null, b = lenB ? troughShape(smoothed, 1, lenB, surface, roads) : null;
  const topL = new Float32Array(n).fill(NaN), topR = new Float32Array(n).fill(NaN);
  for (const t of [a, b]) if (t) for (let i = 0; i < n; i++) if (!Number.isNaN(t.top[0][i])) { topL[i] = t.top[0][i]; topR[i] = t.top[1][i]; }
  return {
    ...smoothed,
    troughA: lenA, troughB: lenB, blendA: a ? a.blend : 0, blendB: b ? b.blend : 0, roadA: a ? a.width : 0, roadB: b ? b.width : 0,
    tA: tube.sA - lenA, tB: tube.sB + lenB, wallTopL: topL, wallTopR: topR,
    flushA: a ? null : tube.flushA, flushB: b ? null : tube.flushB, edgeA: a ? a.edge : null, edgeB: b ? b.edge : null, edgeSlopeA: a ? a.edgeSlope : null, edgeSlopeB: b ? b.edgeSlope : null,
  };
}

/**
 * The floor of a trough at sample i (+ f), side offset lat, arc length s (between its outer end and its face): the plane of the tube plus the cross-section of the
 * approach at the outer end, fading out over the blend, plus the difference of the approach's grade in that lane, fading out over TROUGH.slopeFade (C1 at the end:
 * no kink where the car leaves the carved road).  The car's ground and the drawn floor are this one function.
 */
export function troughFloor(tube, i, f, lat, s) {
  const h = floorOf(tube, i, f, lat);
  const atA = s < tube.sA, edge = atA ? tube.edgeA : s > tube.sB ? tube.edgeB : null;
  if (!edge) return h;
  const slope = atA ? tube.edgeSlopeA : tube.edgeSlopeB;
  const u = (clamp(lat / tube.innerHalf, -1, 1) + 1) / 2 * (EDGE_N - 1), k = Math.min(EDGE_N - 2, Math.floor(u)), r = u - k;
  const d = Math.max(0, atA ? s - tube.tA : tube.tB - s);
  return h + (edge[k] + (edge[k + 1] - edge[k]) * r) * (1 - approachWeight(tube, s)) + (slope[k] + (slope[k + 1] - slope[k]) * r) * d * Math.exp(-d / TROUGH.slopeFade);
}

/** Samples (m) to each side over which the tops of a trough's walls are evened out. */
const TOP_SMOOTH = 3;

/** The lats across a trough's floor at which the cross-section of its outer end is read (every ~0.25 m on a 9 m floor). */
const EDGE_N = 37;

/** The top of a trough wall at sample i (+ f) on the side of lat (NaN: no trough there). */
export function wallTopAt(tube, i, f, lat) {
  const arr = lat >= 0 ? tube.wallTopR : tube.wallTopL;
  const a = arr[i], b = arr[Math.min(arr.length - 1, i + 1)];
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a + (b - a) * f;
}

/**
 * How far the car's ground has blended from the surface into the floor at arc length s in front of a face (1 between the faces): in a trough over its blend from the
 * outer end, else over TUBE.blend m in front of the face.
 */
export function approachWeight(tube, s) {
  if (s >= tube.sA && s <= tube.sB) return 1;
  if (s < tube.sA) return tube.troughA ? smooth01((s - tube.tA) / tube.blendA) : smooth01((s - (tube.sA - TUBE.blend)) / TUBE.blend);
  return tube.troughB ? smooth01((tube.tB - s) / tube.blendB) : smooth01(((tube.sB + TUBE.blend) - s) / TUBE.blend);
}

/** The first and last arc length at which a tube touches the car's ground (the outer ends of its troughs, or the blends in front of its faces). */
export const groundStart = (tube) => (tube.troughA ? tube.tA : tube.sA - TUBE.blend);
export const groundEnd = (tube) => (tube.troughB ? tube.tB : tube.sB + TUBE.blend);

/**
 * Two tubes side by side (the two carriageways under the Rond-Point Schuman, 5 m apart at their west mouths; the bores under the Rond-Point Merl) share a wall: on
 * the side facing the other, a tube's interior ends TUBE.wall / 2 before the line half way between them and its shell at that line (no wing on its headwall).  Their
 * full width overlapped: the outer wall of one stood in the other.  A tube whose lanes do not fit beside its neighbour stays closed.  Pure: new tube objects.
 */
function pairTubes(tubes, rejected) {
  const out = tubes.map((t) => ({ ...t }));
  for (let a = 0; a < out.length; a++) {
    for (let b = 0; b < out.length; b++) {
      if (a === b) continue;
      const ta = out[a], tb = out[b];
      const reach = ta.outerHalf + tb.outerHalf;
      let gapL = Infinity, gapR = Infinity;
      for (let i = indexAt(ta, ta.sA); i <= indexAt(ta, ta.sB); i += 2) {
        for (let j = indexAt(tb, tb.sA); j <= indexAt(tb, tb.sB); j++) {
          const dx = tb.x[j] - ta.x[i], dz = tb.z[j] - ta.z[i], d = Math.hypot(dx, dz);
          if (d >= reach) continue;
          const lat = -ta.tz[i] * dx + ta.tx[i] * dz;          // (the side of ta that tb lies on)
          if (lat >= 0) gapR = Math.min(gapR, d); else gapL = Math.min(gapL, d);
        }
      }
      if (gapR < Infinity) { ta.innerR = Math.min(ta.innerR, gapR / 2 - TUBE.wall / 2); ta.outerR = Math.min(ta.outerR, gapR / 2); ta.headR = ta.outerR; }
      if (gapL < Infinity) { ta.innerL = Math.min(ta.innerL, gapL / 2 - TUBE.wall / 2); ta.outerL = Math.min(ta.outerL, gapL / 2); ta.headL = ta.outerL; }
    }
  }
  const kept = [];
  for (const t of out) {
    if (Math.min(t.innerL, t.innerR) < t.width / 2 + TUBE.shoulderMin) rejected.push({ name: t.name, ids: t.ids, length: t.length, why: `its lanes do not fit beside the tube next to it (${Math.min(t.innerL, t.innerR).toFixed(2)} m)`, tube: t });
    else kept.push(t);
  }
  return { tubes: kept, rejected };
}

/**
 * The tube network: the spatial queries of the game.
 *   locate(x, z, out)            the tube sample under (x, z): out = { tube, i, s, lat, floor } or null (within the outer half of a tube, s within its blend zones)
 *   groundAt(x, z, y, g)         the ground for a car whose body is at y, where the ground without tubes is g
 *   ceilingAt(x, z, y)           the ceiling of the tube a lens at y is in (Infinity: none)
 *   inside(x, z, y)              is (x, z, y) in a tube's interior (between its walls, between its faces, at its level; y the wheels)?
 *   collide(x, z, radius, y)     the walls, the faces of the portals and the outer shell (y: the wheels of a car or the bottom of a lens)
 *   maskSegments                 the stretches of the shells whose land lies under their roof (tunnel-mask.js hides the terrain there)
 */
export function createTubeNetwork(tubes) {
  const CELL = TUBE.cell;
  const key = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const cells = new Map();
  tubes.forEach((tube, k) => {
    const lo = Math.max(0, indexAt(tube, groundStart(tube) - 2)), hi = Math.min(tube.s.length - 1, indexAt(tube, groundEnd(tube) + 2) + 1);
    tube.iLo = lo; tube.iHi = hi;
    const r = tube.outerHalf + TUBE.wing + 1;
    for (let i = lo; i < hi; i++) {
      const minX = Math.min(tube.x[i], tube.x[i + 1]) - r, maxX = Math.max(tube.x[i], tube.x[i + 1]) + r;
      const minZ = Math.min(tube.z[i], tube.z[i + 1]) - r, maxZ = Math.max(tube.z[i], tube.z[i + 1]) + r;
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const kk = key(cx, cz);
          let list = cells.get(kk);
          if (!list) { list = []; cells.set(kk, list); }
          list.push(k * 65536 + i);
        }
      }
    }
  });

  /** The nearest tube segment within `reach` of its centre line (past the outer half by `reach`). */
  function locate(x, z, out, reach = 0) {
    const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = Infinity, found = null;
    for (let q = 0; q < list.length; q++) {
      const code = list[q], tube = tubes[Math.floor(code / 65536)], i = code % 65536;
      const ax = tube.x[i], az = tube.z[i], ex = tube.x[i + 1] - ax, ez = tube.z[i + 1] - az, ll = ex * ex + ez * ez;
      if (ll < 1e-9) continue;
      let f = ((x - ax) * ex + (z - az) * ez) / ll;
      const fc = f < 0 ? 0 : f > 1 ? 1 : f;
      const px = x - ax - ex * fc, pz = z - az - ez * fc;
      const d = Math.hypot(px, pz);
      if (d > tube.outerHalf + TUBE.wing + reach || d >= best) continue;
      // (the side to the right of s: (-tz, tx))
      const l = Math.sqrt(ll), rx = -ez / l, rz = ex / l;
      const lat = (x - ax) * rx + (z - az) * rz;
      best = d;
      f = fc;
      found = { tube, i, f, s: tube.s[i] + (tube.s[i + 1] - tube.s[i]) * f, lat, ux: ex / l, uz: ez / l, rx, rz };
    }
    if (!found) return null;
    out.tube = found.tube; out.i = found.i; out.f = found.f; out.s = found.s; out.lat = found.lat;
    out.ux = found.ux; out.uz = found.uz; out.rx = found.rx; out.rz = found.rz;
    out.floor = floorOf(found.tube, found.i, found.f, found.lat);
    return out;
  }

  const L = { tube: null, i: 0, f: 0, s: 0, lat: 0, floor: 0, ux: 1, uz: 0, rx: 0, rz: 1 };
  /** At the tube's level (y the car's body, DECK-like hint)? */
  const atLevel = (y, floor) => y <= floor + TUBE.levelAbove && y >= floor - TUBE.levelBelow;

  /** The ground for a car whose body is at y, over the ground without tubes g (the surface, lattice or continuous). */
  function groundAt(x, z, y, g) {
    if (!locate(x, z, L)) return g;
    const tube = L.tube, s = L.s, a = Math.abs(L.lat);
    if (s < groundStart(tube) || s > groundEnd(tube)) return g;
    const inner = a <= innerOf(tube, L.lat);
    if (atLevel(y, L.floor)) {
      if (!inner) return g;
      if (s >= tube.sA && s <= tube.sB) return L.floor;
      // in a trough: its floor (across its whole width: its walls hold the edges)
      if (s < tube.sA ? tube.troughA > 0 : tube.troughB > 0) return troughFloor(tube, L.i, L.f, L.lat, s);
      // in front of a face: the surface blends into the floor (in the outer metre less: the edge of the approach - but fully at the face, where the floor takes
      // over across its whole width: the wheels of a car 0.8 m from the wall stepped 3 cm there, 27 m/s2 at 20 m/s into Rangwee 16860, tunnels18)
      const w = approachWeight(tube, s), side = 1 - smooth01((a - (innerOf(tube, L.lat) - 1.0)) / 1.0);
      return g + (L.floor - g) * w * (1 - (1 - side) * (1 - w));
    }
    // over the tube: where its roof lies above the land (the hood of a portal), the roof carries the car
    if (s >= tube.sA && s <= tube.sB && a <= outerOf(tube, L.lat)) {
      const roof = L.floor - tube.cross[L.i] * L.lat + Math.abs(tube.cross[L.i]) * tube.outerHalf + tube.roofDepth;
      if (y >= roof - TUBE.roofLift && roof > g) return roof;
    }
    return g;
  }

  /** The ceiling over a lens at y (Infinity: not in a tube). */
  function ceilingAt(x, z, y) {
    if (!locate(x, z, L)) return Infinity;
    const tube = L.tube;
    if (L.s < tube.sA || L.s > tube.sB || Math.abs(L.lat) > outerOf(tube, L.lat)) return Infinity;
    if (y > L.floor + tube.clearance + 0.3 || y < L.floor - TUBE.levelBelow) return Infinity;
    return L.floor - tube.cross[L.i] * L.lat + tube.clearance;
  }

  /** Is the point (y: the level of the wheels) inside the interior of a tube (its walls, its faces, its floor and ceiling)? */
  function inside(x, z, y) {
    if (!locate(x, z, L)) return false;
    const tube = L.tube;
    return L.s >= tube.sA - 0.3 && L.s <= tube.sB + 0.3 && Math.abs(L.lat) <= innerOf(tube, L.lat) + 0.05 && y >= L.floor - 1.0 && y <= L.floor + tube.clearance;
  }

  /** The roof top of the tube under (x, z) (its outer width, face to face), -Infinity elsewhere: the foot of a house over a tunnel stays on it (building-mesh.js). */
  function roofAt(x, z) {
    if (!locate(x, z, L)) return -Infinity;
    const tube = L.tube;
    if (L.s < tube.sA - 0.5 || L.s > tube.sB + 0.5 || Math.abs(L.lat) > outerOf(tube, L.lat) + 0.5) return -Infinity;
    return L.floor - tube.cross[L.i] * L.lat + Math.abs(tube.cross[L.i]) * tube.outerHalf + tube.roofDepth + 0.02;
  }

  /** The name of the tube the car is in ('' unnamed), or null outside: the road name the dashboard shows. */
  function nameAt(x, z, y) { return inside(x, z, y) ? L.tube.label : null; }

  /**
   * The solids of a tube in its own frame (s along, lat across): the two walls (lat innerHalf .. outerHalf, s from face to face) and the two
   * headwalls (lat innerHalf .. innerHalf + wall + wing, TUBE.headDepth deep from each face).  A circle (s, lat, r) is pushed out of the one it
   * overlaps most.  Returns { nx, nz, pen } or null.
   */
  function collide(x, z, radius, y = NaN) {
    if (!Number.isFinite(y) || !locate(x, z, L, radius)) return null;      // (a tube is solid only at its own level: a pose without a level is above it)
    const tube = L.tube, s = L.s, lat = L.lat, a = Math.abs(lat), sign = lat >= 0 ? 1 : -1;
    if (s < tube.tA - radius - 0.1 || s > tube.tB + radius + 0.1) return null;
    if (y < L.floor - TUBE.levelBelow) return null;                           // far under it
    const roofTop = L.floor + tube.roofDepth + Math.abs(tube.cross[L.i]) * tube.outerHalf;
    const inner = innerOf(tube, lat), head = headOf(tube, lat), outer = outerOf(tube, lat);
    const boxes = [];
    // the tube and its headwalls up to its roof (over it: the land, a street over it) ...
    if (y <= roofTop - 0.3) boxes.push([tube.sA, tube.sB, inner, outer], [tube.sA, tube.sA + TUBE.headDepth, inner, head], [tube.sB - TUBE.headDepth, tube.sB, inner, head]);
    // ... and the walls of its troughs up to their tops (a car on the land behind one meets its parapet)
    const top = wallTopAt(tube, L.i, L.f, lat);
    if (!Number.isNaN(top) && y <= top - 0.3) {
      if (tube.troughA) boxes.push([tube.tA, tube.sA, inner, outer]);
      if (tube.troughB) boxes.push([tube.sB, tube.tB, inner, outer]);
    }
    if (!boxes.length) return null;
    let best = null;
    for (const [s0, s1, l0, l1] of boxes) {
      // the circle against the box [s0, s1] x [l0, l1] on the side of the point
      const cs = clamp(s, s0, s1), cl = clamp(a, l0, l1);
      const ds = s - cs, dl = a - cl;
      const d = Math.hypot(ds, dl);
      let pen, ns, nl;
      if (d > 1e-9) {
        if (d >= radius) continue;
        pen = radius - d; ns = ds / d; nl = dl / d;
      } else {
        // the centre inside the box: out through the nearest face
        const faces = [[s - s0, -1, 0], [s1 - s, 1, 0], [a - l0, 0, -1], [l1 - a, 0, 1]];
        faces.sort((p, q) => p[0] - q[0]);
        pen = faces[0][0] + radius; ns = faces[0][1]; nl = faces[0][2];
      }
      if (!best || pen > best.pen) best = { pen, ns, nl };
    }
    if (!best) return null;
    const nx = L.ux * best.ns + L.rx * best.nl * sign, nz = L.uz * best.ns + L.rz * best.nl * sign;
    const l = Math.hypot(nx, nz) || 1;
    return { nx: nx / l, nz: nz / l, pen: Math.min(best.pen, TUBE.pushMax) };
  }

  return { tubes, locate, groundAt, ceilingAt, inside, nameAt, collide, roofAt, count: tubes.length };
}

/**
 * The stretches of a tube whose land lies under (or just over) its roof top: there the shell shows and the terrain inside it is hidden.
 * heightAt: the drawn ground (surface.height).  Returns [{ tube, i0, i1 }] (sample ranges, each from face to face at most).
 */
export function exposedStretches(tube, heightAt) {
  const out = [];
  const i0 = indexAt(tube, tube.sA), i1 = Math.min(tube.s.length - 1, indexAt(tube, tube.sB) + 1);
  let start = -1;
  for (let i = i0; i <= i1; i++) {
    const roof = tube.floor[i] + tube.roofDepth + Math.abs(tube.cross[i]) * tube.outerHalf;
    let low = Infinity;
    for (const lat of [-tube.outerHalf, -tube.innerHalf / 2, 0, tube.innerHalf / 2, tube.outerHalf]) {
      low = Math.min(low, heightAt(tube.x[i] - tube.tz[i] * lat, tube.z[i] + tube.tx[i] * lat));
    }
    const exposed = low < roof + TUBE.exposeMargin;
    if (exposed && start < 0) start = i;
    if ((!exposed || i === i1) && start >= 0) { out.push({ tube, i0: Math.max(i0, start - 3), i1: Math.min(i1, (exposed ? i : i - 1) + 3) }); start = -1; }
  }
  return out;
}

/** The road under a car in a tube (surface.roadInfoAt's fields): asphalt, fully on the road (the car's grip and top speed). */
export function tubeRoadInfo(out) {
  out.coverage = 1; out.lat = 0; out.hw = 3; out.a0 = 3; out.kind = 0; out.surface = 0; out.road = -1; out.lines = 0; out.lanes = 1; out.s = 0;
  return out;
}

/** The tubes of the world as the game builds them (main.js, the harness and the tools call this): { network, tubes, rejected, ids } (ids: every tube way). */
export function createTubes(roads, surface, net, buildings = null) {
  const { tubes, rejected } = findTubes(roads, surface, net, buildings);
  return { network: createTubeNetwork(tubes), tubes, rejected, ids: new Set(tubes.flatMap((t) => t.ids)) };
}

/**
 * Where the shells of the tubes show (exposedStretches): nothing may stand there (a lamp of the approach, a tree, the crown of a wood would grow through the hood of a portal).
 * Returns { inShell(x, z, r), clearings } (clearings: rectangles [x0, z0, x1, z1] for the generated woods, trees.js).
 */
export function tubeShells(tubes, heightAt) {
  const boxes = [];
  for (const tube of tubes) {
    // (the troughs too: a lamp of the approach would stand in its wall)
    const troughs = [];
    if (tube.troughA) troughs.push({ i0: indexAt(tube, tube.tA), i1: indexAt(tube, tube.sA) + 1 });
    if (tube.troughB) troughs.push({ i0: indexAt(tube, tube.sB), i1: Math.min(tube.s.length - 1, indexAt(tube, tube.tB) + 1) });
    for (const st of [...exposedStretches(tube, heightAt), ...troughs]) {
      const r = tube.outerHalf + TUBE.wing;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = st.i0; i <= st.i1; i++) { x0 = Math.min(x0, tube.x[i] - r); x1 = Math.max(x1, tube.x[i] + r); z0 = Math.min(z0, tube.z[i] - r); z1 = Math.max(z1, tube.z[i] + r); }
      boxes.push({ tube, i0: st.i0, i1: st.i1, r, box: [x0, z0, x1, z1] });
    }
  }
  const inShell = (x, z, rad = 0) => boxes.some((b) => {
    if (x < b.box[0] - rad || x > b.box[2] + rad || z < b.box[1] - rad || z > b.box[3] + rad) return false;
    for (let i = b.i0; i < b.i1; i++) {
      const ax = b.tube.x[i], az = b.tube.z[i], ex = b.tube.x[i + 1] - ax, ez = b.tube.z[i + 1] - az, ll = ex * ex + ez * ez || 1;
      const f = clamp(((x - ax) * ex + (z - az) * ez) / ll, 0, 1);
      if (Math.hypot(x - ax - ex * f, z - az - ez * f) <= b.r + rad) return true;
    }
    return false;
  });
  return { inShell, clearings: boxes.map((b) => b.box) };
}

/** The lamps of placeStreetLights without those in a tube's shell (a new object). */
export function lampsOutsideShells(lamps, inShell) {
  const keep = [];
  for (let i = 0; i < lamps.count; i++) if (!inShell(lamps.x[i], lamps.z[i], 0.5)) keep.push(i);
  return { count: keep.length, x: Float32Array.from(keep, (i) => lamps.x[i]), z: Float32Array.from(keep, (i) => lamps.z[i]), yaw: Float32Array.from(keep, (i) => lamps.yaw[i]), size: Uint8Array.from(keep, (i) => lamps.size[i]) };
}

/**
 * The retaining walls of the bake without the stretches inside a tube's shell or trough (new wall objects: a wall is cut where it enters one).  The trough's own
 * walls hold the cut there; a baked stone wall stood in front of the concrete at the Schuman underpass.
 */
export function wallsOutsideShells(walls, inShell, roofAt = null) {
  const out = [];
  for (const wall of walls) {
    let run = [];
    const flush = () => { if (run.length >= 2) out.push({ ...wall, pts: run }); run = []; };
    for (const p of wall.pts) {
      // (and the stretches whose foot lies under the roof of a tube - roofAt: tunnel network - wherever its land is: the bake saw the step between the Schuman
      // approach and its twin as a ramp and stood a wall 1.6 m beside the axis INSIDE the mouth of tube 482, where the land over it is high; tunnels18, QA5 TU07)
      const underRoof = roofAt && Number.isFinite(p.bottom) && p.bottom < roofAt(p.x, p.z);
      if (inShell(p.x, p.z, 0.3) || underRoof) flush(); else run.push(p);
    }
    flush();
  }
  return out;
}
