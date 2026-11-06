/* Lux Drive: bakes the retaining walls into pb/lux-drive/data/walls.bin.
 *   node scripts/luxdrive/bake_walls.mjs [--out=<file>] [--stats]
 * Walks along every carved way at every centre line sample, on both sides, and reads the profile of the height function across the way (the very function the game runs).
 * A ramp in that profile (retaining-walls.js findRamp: steeper than 1.6 m/m, at least 0.8 m high, steeper than the land under it) becomes a point of a wall: the foot of the
 * ramp, the direction toward the high ground, the top, the bottom and the depth of the ramp.  Points of neighbouring samples that agree form one wall; a ramp that two ways
 * both see (a wall between two carriageways) is written once.  Deterministic.  Re-run it whenever the carve changes: the harness (gate K) fails when a wall no longer stands
 * on a ramp or a ramp has no wall. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './world_node.mjs';
import { WALL, CUT_RAMP, findRamp, encodeWalls, rampTolerance } from '../../pb/lux-drive/retaining-walls.js';
import { PORTAL } from '../../pb/lux-drive/config.js';
import { WALL_COLLIDER } from '../../pb/lux-drive/wall-collider.js';
import { createLaneSegments, wallBlocksLane, WALL_LANE } from '../../pb/lux-drive/lane-clearance.js';

const OUT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/lux-drive/data/walls.bin');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : OUT_DEFAULT;

const LINK_FRONT = 5.5;        // m: the feet of the face at two neighbouring samples are at most this far apart (the samples are 4 m apart, on a bend the feet spread)
const LINK_HEIGHT = 1.5;       // m: ... and their tops and bottoms differ by at most this
const LINK_FACING = 0.6;       // ... and they face the same way (cosine of the angle between the directions to the high ground)
const COVER_CELL = 2;          // m: a ramp that is already in a wall of an earlier way (a point of it this close, same facing, same top) is not written again
const COVER_DIST = 1.4;
const COVER_TOP = 1.2;
const CUT_MEETS_LAND = 0.15;   // m: the face of a cut ends where the ground is this close to the land
const MIN_SAMPLES = 2;         // a ramp seen at a single sample is noise of the scan (a bend, a driveway) and a lone block of stone looks like a crate: a wall is at least two samples long
const CAR_CLEAR = -0.6;        // the foot of the face and the back of the block lie outside every carriageway (signed distance to the union of the carriageways; -0.6 = the face may stand on the edge line, which lies 0.5 m inside the carriageway): a wall never stands on tarmac
const MAX_PULL_IN = 0.6;       // m: the back of the block is pulled in at most this far to get off a carriageway (a sliver of the lane edge); a ramp whose head lies deeper in the road has no wall
const MIN_LENGTH = 6;          // m: a LOW wall (rise < MIN_RISE_SHORT) shorter than this (2 samples on a short bend) reads as a crate lying on the bank: not baked, the ground carries the step
const MIN_RISE_SHORT = WALL.shortRise;    // m: a higher ramp keeps its wall however short: with its tapered ends it is a wedge on the bank, and the bare ramp would be a crack
const TAPER_LENGTH = 2.5;      // m: the ends of a wall run out into the ground over this length (a sloped end, not a box)
const TAPER_HEIGHT = 0.12;     // m: the height of the tip of a tapered end above the ground
const FOOT_PROBE = 1.0, FOOT_DROP = 1.5;   // m: the ground a metre in front of the foot of the face lies at most this under the bottom of the ramp.  Lower, the ramp goes on down below the foot (the scan
                               // split a face of 7 m between two carriageways at a flat spot): a wall there would stand in the air on the slope, open to the car from below (wall-collider levelReach)
const APPROACH_DUG = 2.0;      // m: on the way that leads into the mouth of an opened cut, a steep face that the carve dug at least this far below the land (somewhere on it) is the cut's face going on
                               // (CUT_RAMP): the road was cut into the hillside there too (QA2 N-U03: Rue Godchaux runs 100 m along the foot of a hill of 2 m/m before its cut, the car
                               // climbed that bank 15 m before the mouth and rolled 65 deg).  A face the land has anyway (dug less) stays the land's own slope.
const CUT_JOIN_GAP = 2;       // the walls of a cut and of the ways into its mouths are joined across a gap of up to this many LINK_FRONT (the samples of two ways do not meet at the mouth)
const DECK_CLEAR = 0.05;       // m: the top of a wall (with its coping) stays this far under the carriageway of a deck over it, or the ramp there has no wall
const GAP_SAMPLES = 1;         // a wall goes on across a sample where the scan found nothing (the ramp flickers around its thresholds), if the ground under the middle of the bridge fits

// drive12 (QA3 N3-W01): a wall's collision block keeps WALL_LANE.clear from the centre line of every lane at its level; a point that reaches a lane moves WALL_LANE.shiftStep
// per pass (its face up the ramp, or its back toward the face), at most WALL_LANE.shiftMax (= MAX_PULL_IN), else it is dropped (lane-clearance.js)
const { clear: LANE_WALL_CLEAR, shiftStep: LANE_SHIFT_STEP, shiftMax: LANE_SHIFT_MAX } = WALL_LANE;

const { field, surface, ground, data } = await loadWorld();
const net = field.network;
const chains = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road));
/** The ways that lead into the mouth of an opened cut: an end of theirs within PORTAL.mouthGap of an end of a cut way. */
const chainEnds = (c) => [[c.x[0], c.z[0]], [c.x[c.x.length - 1], c.z[c.z.length - 1]]];
const cutMouths = chains.filter((c) => net.roads[c.road].openCut).flatMap(chainEnds);
const approachWays = new Set(chains.filter((c) => !net.roads[c.road].openCut
  && chainEnds(c).some(([x, z]) => cutMouths.some(([mx, mz]) => Math.hypot(x - mx, z - mz) <= PORTAL.mouthGap))).map((c) => c.road));
let approachRamps = 0;

// The faces already written, as the SEGMENTS of their walls: two ways that both see one face (the step between two carriageways at two levels, surface11) sample it 4 m apart
// at offsets of their own, so a point of the second way lies up to 2 m from the nearest POINT of the first one's wall and was written again - a second wall in the first
// (Merl link beside the A4: two 85 m walls in one another).  A point within COVER_DIST of a segment, facing the same way, at the same top, is covered.
const covered = new Map();      // grid cell -> the segments [p, q] of the walls already written that pass near it
const cellKey = (cx, cz) => cx * 100003 + cz;
function segmentGap(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return { d: Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z), top: a.top + (b.top - a.top) * t, nx: a.nx + (b.nx - a.nx) * t, nz: a.nz + (b.nz - a.nz) * t };
}
function isCovered(p) {
  const cx = Math.floor(p.x / COVER_CELL), cz = Math.floor(p.z / COVER_CELL);
  for (const [a, b] of covered.get(cellKey(cx, cz)) || []) {
    const g = segmentGap(p, a, b);
    if (g.d <= COVER_DIST && g.nx * p.nx + g.nz * p.nz > LINK_FACING && Math.abs(g.top - p.top) <= COVER_TOP) return true;
  }
  return false;
}
/** Lists the segment a-b in every cell within COVER_DIST of its box (isCovered then reads one cell). */
function cover(a, b) {
  const x0 = Math.floor((Math.min(a.x, b.x) - COVER_DIST) / COVER_CELL), x1 = Math.floor((Math.max(a.x, b.x) + COVER_DIST) / COVER_CELL);
  const z0 = Math.floor((Math.min(a.z, b.z) - COVER_DIST) / COVER_CELL), z1 = Math.floor((Math.max(a.z, b.z) + COVER_DIST) / COVER_CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const k = cellKey(cx, cz), l = covered.get(k);
    if (l) l.push([a, b]); else covered.set(k, [[a, b]]);
  }
}

const rejected = { foot: 0, back: 0, air: 0, deck: 0 };   // ramps left without a wall: the foot of the face / the back of the block would lie on a carriageway; the foot would stand in the air (FOOT_DROP)
const roadProbe = { sdCar: 9, sdPave: 9 };
/** True when (x, z) lies outside every carriageway of the carved ground. */
function clearOfRoads(x, z) { net.carve(x, z, roadProbe); return roadProbe.sdCar >= CAR_CLEAR; }

/** True when the top of wall point p (with its coping) stays DECK_CLEAR under the carriageway of any deck over its block (foot, middle, back).  Inside the slab it is hidden. */
function clearOfDecks(p) {
  for (const d of [0, p.depth / 2, p.depth]) {
    const x = p.x + p.nx * d, z = p.z + p.nz * d;
    if (ground.overheadAt(x, z, p.bottom + 0.1) < p.top + WALL.coping && ground.onDeck(x, z) && ground.height(x, z) < p.top + WALL.coping + DECK_CLEAR) return false;
  }
  return true;
}

/** The wall point at sample i of a way on one side (side = +1 right, -1 left), or null. */
function wallPointAt(chain, i, side) {
  const n = chain.x.length;
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  let dx = chain.x[b] - chain.x[a], dz = chain.z[b] - chain.z[a];
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  const nx = -dz * side, nz = dx * side;                       // across the way, to this side
  const info = net.info[chain.road];
  const bench = info.hw + info.kerbW;
  const t0 = Math.max(0.3, info.hw * WALL.scanFrom), t1 = bench + WALL.scanReach;
  const count = Math.floor((t1 - t0) / WALL.scanStep) + 1;
  const heights = new Float64Array(count), lands = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const t = t0 + k * WALL.scanStep, x = chain.x[i] + nx * t, z = chain.z[i] + nz * t;
    heights[k] = field.height(x, z); lands[k] = field.groundHeight(x, z);
  }
  // (the cut of an opened tunnel: a wall wherever its face is steep, retaining-walls.js CUT_RAMP, its lowest WALL.maxRise metres; the face ends where the ground meets the land
  // again - the hillside above it is the land's own)
  const cut = !!net.roads[chain.road].openCut;
  let end = count;
  if (cut) { let k = 1; while (k < count && heights[k] < lands[k] - CUT_MEETS_LAND) k++; end = Math.min(count, k + 1); }
  let ramp = findRamp(end < count ? heights.subarray(0, end) : heights, end < count ? lands.subarray(0, end) : lands, WALL.scanStep, cut ? CUT_RAMP : WALL);
  if (!ramp && approachWays.has(chain.road)) {
    const face = findRamp(heights, lands, WALL.scanStep, CUT_RAMP);
    let dug = -Infinity;
    for (let k = face ? face.first : 0; face && k <= face.last; k++) dug = Math.max(dug, lands[k] - heights[k]);
    if (dug >= APPROACH_DUG) { ramp = face; approachRamps++; }
  }
  if (!ramp) return null;
  // the foot of the face is the low end of the ramp; the block reaches back to its high end
  const rising = ramp.rise > 0;
  const tFoot = t0 + (rising ? ramp.first : ramp.last) * WALL.scanStep;
  const tHead = t0 + (rising ? ramp.last : ramp.first) * WALL.scanStep;
  const toHigh = rising ? 1 : -1;                              // the direction toward the high ground, along (nx, nz)
  const fx = chain.x[i] + nx * tFoot, fz = chain.z[i] + nz * tFoot;
  // never on tarmac: the foot of the face outside every carriageway; the back of the block is pulled in until it is (the coping is a sliver on the lip, the ramp behind it stays ground)
  if (!clearOfRoads(fx, fz)) { rejected.foot++; return null; }
  const full = Math.max(WALL.minDepth, Math.abs(tHead - tFoot));
  let depth = full;
  while (depth > WALL.minDepth && full - depth < MAX_PULL_IN && !clearOfRoads(fx + nx * toHigh * depth, fz + nz * toHigh * depth)) depth = Math.max(WALL.minDepth, depth - 0.15);
  if (!clearOfRoads(fx + nx * toHigh * depth, fz + nz * toHigh * depth)) { rejected.back++; return null; }       // the head of the ramp lies in a carriageway: the ramp is part of the road
  const top = Math.max(heights[ramp.first], heights[ramp.last]), bottom = Math.min(heights[ramp.first], heights[ramp.last]);
  if (field.height(fx - nx * toHigh * FOOT_PROBE, fz - nz * toHigh * FOOT_PROBE) < bottom - FOOT_DROP) { rejected.air++; return null; }
  // under a bridge: the block reaches up to the deck (the ground under the A6 bridge at Croix de Gasperich rises to the deck's level; a wall there poked its coping through
  // the carriageway above)
  if (!clearOfDecks({ x: fx, z: fz, nx: nx * toHigh, nz: nz * toHigh, depth, top, bottom })) { rejected.deck++; return null; }
  return {
    x: chain.x[i] + nx * tFoot, z: chain.z[i] + nz * tFoot, top, bottom, depth,
    nx: nx * toHigh, nz: nz * toHigh, tx: dx, tz: dz, rise: Math.abs(ramp.rise), slope: ramp.maxSlope,
  };
}

const link = (p, q, gap = 1) => Math.hypot(p.x - q.x, p.z - q.z) <= LINK_FRONT * gap && Math.abs(p.top - q.top) <= LINK_HEIGHT && Math.abs(p.bottom - q.bottom) <= LINK_HEIGHT && p.nx * q.nx + p.nz * q.nz >= LINK_FACING;

const ON_RAMP = 0.9;           // m: the foot of the face stands within this of the bottom of the ramp and the back of the block within this of its top (harness gate K proves it)

/** The wall point stands on the ramp it was found on: the ground under the foot of the face is the bottom, the ground under the back of the block is the top. */
function fits(p) {
  const tol = Math.max(ON_RAMP, rampTolerance(p.top - p.bottom, p.depth));
  return Math.abs(surface.height(p.x, p.z) - p.bottom) <= tol && Math.abs(surface.height(p.x + p.nx * p.depth, p.z + p.nz * p.depth) - p.top) <= tol;
}

/** A wall found at one sample covers WALL.endExtend m of the way on both sides of it: the ends of a wall are extended, as far as the ramp goes on (the ground may change there). */
function extend(pts) {
  const first = pts[0], last = pts[pts.length - 1];
  const reach = (p, sign) => {
    for (const e of [WALL.endExtend, WALL.endExtend / 2, WALL.endExtend / 4]) {
      const q = { ...p, x: p.x + sign * p.tx * e, z: p.z + sign * p.tz * e };
      if (fits(q) && clearOfRoads(q.x, q.z) && clearOfRoads(q.x + q.nx * q.depth, q.z + q.nz * q.depth) && clearOfDecks(q)) return q;
    }
    return null;
  };
  const head = reach(first, -1), tail = reach(last, 1);
  return [...(head ? [head] : []), ...pts, ...(tail ? [tail] : [])];
}

/** The ends of a wall run out into the ground: a tip TAPER_LENGTH beyond the last point, 12 cm over the ground there, so the wall is a wedge on the bank and never a box with flat ends. */
function taper(pts) {
  const tip = (p, q) => {                                       // p the end point, q its neighbour: the tip lies beyond p, away from q (shorter where the road is in the way)
    const dx = p.x - q.x, dz = p.z - q.z, len = Math.hypot(dx, dz) || 1;
    for (const reach of [TAPER_LENGTH, TAPER_LENGTH * 0.6, TAPER_LENGTH * 0.3]) {
      const x = p.x + dx / len * reach, z = p.z + dz / len * reach;
      if (!clearOfRoads(x, z) || !clearOfRoads(x + p.nx * WALL.minDepth, z + p.nz * WALL.minDepth)) continue;
      const g = surface.height(x, z);
      return { x, z, top: g + TAPER_HEIGHT, bottom: g, depth: WALL.minDepth, nx: p.nx, nz: p.nz };
    }
    // a road is in the way at every reach (the end of the wall is at a carriageway): the end point itself runs out into the ground instead, over the last segment
    return { ...p, top: p.bottom + TAPER_HEIGHT, own: true };
  };
  const a = tip(pts[0], pts[1]), b = tip(pts[pts.length - 1], pts[pts.length - 2]);
  const body = pts.slice(a && a.own ? 1 : 0, b && b.own ? pts.length - 1 : pts.length);
  const strip = ({ own, ...rest }) => rest;
  return [...(a ? [strip(a)] : []), ...body, ...(b ? [strip(b)] : [])];
}
const wallLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

const DEBUG_AT = (process.argv.find((a) => a.startsWith('--debug-at=')) || '').slice(11).split(',').map(Number);   // --debug-at=x,z: why a ramp near there has no wall
const debugOn = DEBUG_AT.length === 2 && !DEBUG_AT.some(Number.isNaN);
const walls = [];
let probed = 0, found = 0, duplicate = 0, short = 0;
for (const chain of chains) {
  const firstOfChain = walls.length;
  for (const side of [1, -1]) {
    let run = [];
    const flush = () => {
      if (run.length >= MIN_SAMPLES) {
        const body = extend(run).map((p) => ({ x: p.x, z: p.z, top: p.top, bottom: p.bottom, depth: p.depth, nx: p.nx, nz: p.nz }));
        if (wallLength(body) < MIN_LENGTH && Math.max(...run.map((p) => p.rise)) < MIN_RISE_SHORT) { short++; run = []; return; }
        const pts = taper(body);
        walls.push({ pts, body, slope: Math.max(...run.map((p) => p.slope)), rise: Math.max(...run.map((p) => p.rise)), way: chain.road });
      }
      run = [];
    };
    let misses = 0;                                              // samples in a row without a ramp since the last point of the run
    for (let i = 0; i < chain.x.length; i++) {
      probed++;
      const p = wallPointAt(chain, i, side);
      if (debugOn && Math.hypot(chain.x[i] - DEBUG_AT[0], chain.z[i] - DEBUG_AT[1]) < 12) console.log('debug', chain.road, i, side, p ? `point rise ${p.rise.toFixed(1)} depth ${p.depth.toFixed(2)} fits ${fits(p)} foot ${surface.height(p.x, p.z).toFixed(2)}/${p.bottom.toFixed(2)} head ${surface.height(p.x + p.nx * p.depth, p.z + p.nz * p.depth).toFixed(2)}/${p.top.toFixed(2)} covered ${isCovered(p)}` : 'none');
      if (!p || !fits(p)) { misses++; if (misses > GAP_SAMPLES) { flush(); misses = 0; } continue; }
      if (isCovered(p)) { duplicate++; flush(); misses = 0; continue; }
      found++;
      if (run.length && !link(run[run.length - 1], p, misses + 1)) flush();
      run.push(p);
      misses = 0;
    }
    flush();
  }
  // the points of this way are written now: the ways after it do not write them again
  for (let w = firstOfChain; w < walls.length; w++) { const b = walls[w].body; for (let i = 0; i < b.length; i++) cover(b[i], b[Math.min(i + 1, b.length - 1)]); }
}

// The face of a cut goes on from one way to the next (the cut and the ways into its mouths are ways of their own): their walls are joined into one where the end of the one
// and the start of the next agree, instead of two tapered ends that meet in a notch down to the ground at the mouth (Rue Godchaux).
const isCutWall = (w) => net.roads[w.way].openCut || approachWays.has(w.way);
let joined = 0;
for (let again = true; again;) {
  again = false;
  for (const a of walls) {
    if (!isCutWall(a) || a.body.length < 2) continue;
    const end = a.body[a.body.length - 1];
    const prev = a.body[a.body.length - 2];
    const onward = (w) => {                                       // the next wall goes on in the same direction (two walls of one face that run back over each other are not joined)
      const s = w.body[0], s1 = w.body[1], tx = end.x - prev.x, tz = end.z - prev.z;
      return (s.x - end.x) * tx + (s.z - end.z) * tz > 0 && (s1.x - s.x) * tx + (s1.z - s.z) * tz > 0;
    };
    const b = walls.find((w) => w !== a && isCutWall(w) && w.body.length > 1 && link(end, w.body[0], CUT_JOIN_GAP) && onward(w));
    if (!b) continue;
    const s = b.body[0];
    const mid = { ...end, x: (end.x + s.x) / 2, z: (end.z + s.z) / 2, top: (end.top + s.top) / 2, bottom: (end.bottom + s.bottom) / 2, depth: (end.depth + s.depth) / 2 };
    if (!fits(mid) || !clearOfRoads(mid.x, mid.z) || !clearOfRoads(mid.x + mid.nx * mid.depth, mid.z + mid.nz * mid.depth)) continue;
    const body = [...a.body, mid, ...b.body];
    walls.splice(walls.indexOf(b), 1);
    walls.splice(walls.indexOf(a), 1, { ...a, body, pts: taper(body), slope: Math.max(a.slope, b.slope), rise: Math.max(a.rise, b.rise) });
    joined++; again = true;
    break;
  }
}

// A lower wall on the foot line of a higher one is inside its block: two ways see one face, the farther one's scan ends below its top (the A4 under the Merl link: a 3 m wall
// in the 6 m one, its sandstone showing through the concrete face).  The walls are kept from the highest down; the points of a lower one that a kept wall covers (COVER_DIST
// from its face, the same facing, no higher than its top + COVER_TOP) are dropped, and what is left of it stays a wall where it is still MIN_SAMPLES long.
const insideOf = (p, kept) => kept.some((w) => w.body.some((a, i) => {
  const b = w.body[Math.min(i + 1, w.body.length - 1)], g = segmentGap(p, a, b);
  return g.d <= COVER_DIST && g.nx * p.nx + g.nz * p.nz > LINK_FACING && p.top <= g.top + COVER_TOP;
}));
const nearWalls = (w, all) => all.filter((o) => o.body.some((a) => w.body.some((p) => Math.hypot(a.x - p.x, a.z - p.z) < 12)));
const byRise = walls.slice().sort((a, b) => b.rise - a.rise);
const keptWalls = [];
let trimmedInside = 0;
for (const w of byRise) {
  const near = nearWalls(w, keptWalls);
  if (!near.length) { keptWalls.push(w); continue; }
  const runs = [];
  let run = [];
  for (const p of w.body) { if (insideOf(p, near)) { if (run.length) runs.push(run); run = []; } else run.push(p); }
  if (run.length) runs.push(run);
  if (runs.length === 1 && runs[0].length === w.body.length) { keptWalls.push(w); continue; }
  trimmedInside++;
  for (const r of runs) if (r.length >= MIN_SAMPLES) keptWalls.push({ ...w, body: r, pts: taper(r) });
}
walls.splice(0, walls.length, ...walls.filter((w) => keptWalls.includes(w)), ...keptWalls.filter((w) => !walls.includes(w)));
console.log(`walls inside a higher one: ${trimmedInside} trimmed`);

// Two walls of one face whose ends meet (one way's wall goes on as the next one's, or what a trim left of a lower wall meets the higher one) are one wall: two tapered
// ends that met left a V down to the ground in the face (the A4 under the Merl link, 3112,9993).  Either may run either way along the face.
let faceJoins = 0;
const ends = (w) => [{ end: w.body[w.body.length - 1], prev: w.body[w.body.length - 2], body: w.body }, { end: w.body[0], prev: w.body[1], body: w.body.slice().reverse() }];
for (let again = true; again;) {
  again = false;
  search: for (const a of walls) {
    if (a.body.length < 2) continue;
    for (const ea of ends(a)) {
      for (const b of walls) {
        if (b === a || b.body.length < 2) continue;
        for (const eb of ends(b)) {
          const s = eb.end, s1 = eb.prev;                               // b's end that meets a, and the point before it (b's body runs on away from a)
          const tx = ea.end.x - ea.prev.x, tz = ea.end.z - ea.prev.z;
          if (!link(ea.end, s, CUT_JOIN_GAP) || (s.x - ea.end.x) * tx + (s.z - ea.end.z) * tz <= 0 || (s1.x - s.x) * tx + (s1.z - s.z) * tz <= 0) continue;
          const mid = { ...ea.end, x: (ea.end.x + s.x) / 2, z: (ea.end.z + s.z) / 2, top: (ea.end.top + s.top) / 2, bottom: (ea.end.bottom + s.bottom) / 2, depth: (ea.end.depth + s.depth) / 2 };
          if (!fits(mid) || !clearOfRoads(mid.x, mid.z) || !clearOfRoads(mid.x + mid.nx * mid.depth, mid.z + mid.nz * mid.depth) || !clearOfDecks(mid)) continue;
          const body = [...ea.body, mid, ...eb.body.slice().reverse()];
          walls.splice(walls.indexOf(b), 1);
          walls.splice(walls.indexOf(a), 1, { ...a, body, pts: taper(body), slope: Math.max(a.slope, b.slope), rise: Math.max(a.rise, b.rise) });
          faceJoins++; again = true;
          break search;
        }
      }
    }
  }
}
console.log(`walls of one face joined where their ends met: ${faceJoins}`);

// drive12 (QA3 N3-W01 / N3-W02): a wall's COLLISION block never reaches into a lane.  The rules above keep the foot and the back off the carriageways the carve knows
// (sdCar), at the samples; but the solid lines between the samples, the tapered ends, the ends of the block, and the carriageways the carve does not know (the ways on
// a deck: wall 52 stood across both lanes of the A1 at the start of viaduct deck 23) were not tested - 34 road / wall pairs had the lane centre inside a block, and
// invisible walls stopped the car on open motorway lanes.  Now every solid line of every wall (wall-collider.js: face, back, ends) is tested against the centre line of
// every lane of every car road at the wall's level (lane-clearance.js, the same lanes as harness T); a wall point whose line comes within LANE_WALL_CLEAR of a lane is
// dropped, the wall splits there and is tapered again, until no line reaches a lane.  The ramp there is left to the ground (the harness K coverage counts it with the
// ramps on tarmac).
{
  const cellOf = (x, z) => `${Math.floor(x / 24)},${Math.floor(z / 24)}`;
  const nearWall = new Set();
  for (const w of walls) for (const p of w.pts) for (const d of [0, p.depth]) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) nearWall.add(cellOf(p.x + p.nx * d + a * 24, p.z + p.nz * d + b * 24));
  const lanes = createLaneSegments({ roads: data.roads, ground, surface, isOpen: (r) => !!(net.roads[r.id] && net.roads[r.id].openCut), within: (x, z) => nearWall.has(cellOf(x, z)) });
  const solid = (p, q) => ((p.top - p.bottom) + (q.top - q.bottom)) / 2 >= WALL_COLLIDER.minHeight;
  const blocks = (a, b, p, q) => solid(p, q) && !!wallBlocksLane(lanes, a[0], a[1], b[0], b[1], Math.min(p.bottom, q.bottom), Math.max(p.top, q.top), LANE_WALL_CLEAR, WALL_COLLIDER.levelReach);
  const back = (p) => [p.x + p.nx * p.depth, p.z + p.nz * p.depth];
  /** The body points of a wall whose collision lines (with the taper of its ends) reach a lane: { face: Set, back: Set } of body indices (the face line or the
   *  back line / an end reaches it). */
  const offending = (body) => {
    const pts = taper(body), face = new Set(), backs = new Set();
    const bodyIndex = pts.map((p) => body.indexOf(p));                             // (taper keeps the body points as they are; a tip is -1)
    const lastBody = body.length - 1;
    const mark = (set, k) => { const b = bodyIndex[k]; set.add(b >= 0 ? b : k === 0 ? 0 : lastBody); };   // a tip that reaches a lane: its end point answers
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k], q = pts[k + 1];
      if (blocks([p.x, p.z], [q.x, q.z], p, q)) { mark(face, k); mark(face, k + 1); }
      if (blocks(back(p), back(q), p, q)) { mark(backs, k); mark(backs, k + 1); }
    }
    for (const k of [0, pts.length - 1]) { const p = pts[k]; if (blocks([p.x, p.z], back(p), p, p)) mark(face, k); }
    return { face, back: backs, size: face.size + backs.size };
  };
  /** A wall point moved off a lane by `step` (a NEW point): the face toward the high ground (the back stays, the foot is the ground there), or the back toward the face
   *  (the top is the ground there).  null when it would no longer stand on its ramp (fits), would leave LANE_SHIFT_MAX behind, or the block gets too thin. */
  const shifted = (p, side) => {
    const moved = (p.shift || 0) + LANE_SHIFT_STEP;
    if (moved > LANE_SHIFT_MAX + 1e-6 || p.depth - LANE_SHIFT_STEP < WALL.minDepth) return null;
    const q = side === 'face'
      ? { ...p, x: p.x + p.nx * LANE_SHIFT_STEP, z: p.z + p.nz * LANE_SHIFT_STEP, depth: p.depth - LANE_SHIFT_STEP, shift: moved }
      : { ...p, depth: p.depth - LANE_SHIFT_STEP, shift: moved };
    if (side === 'face') q.bottom = Math.min(q.top - WALL.minRise, surface.height(q.x, q.z)); else q.top = Math.max(q.bottom + WALL.minRise, surface.height(...back(q)));
    return fits(q) && clearOfRoads(q.x, q.z) && clearOfDecks(q) ? q : null;
  };
  let trimmedLane = 0, droppedLane = 0, pointsLane = 0, shiftedLane = 0;
  const out = [];
  for (const w of walls) {
    let runs = [w.body];
    let touched = false;
    for (let pass = 0; pass < 24; pass++) {
      let changed = false;
      const next = [];
      for (const body of runs) {
        const bad = offending(body);
        if (!bad.size) { next.push(body); continue; }
        changed = true; touched = true;
        // first move the point off the lane (a few decimetres up its ramp); a point that cannot move far enough is dropped and the wall splits there
        const moved = body.map((p, i) => (bad.face.has(i) ? shifted(p, 'face') : bad.back.has(i) ? shifted(p, 'back') : p));
        let run = [];
        moved.forEach((p, i) => { if (!p) { pointsLane++; if (run.length) next.push(run); run = []; } else { if (p !== body[i]) shiftedLane++; run.push(p); } });
        if (run.length) next.push(run);
      }
      runs = next.filter((r) => r.length >= MIN_SAMPLES && !(wallLength(r) < MIN_LENGTH && Math.max(...r.map((p) => p.top - p.bottom)) < MIN_RISE_SHORT));
      if (!changed) break;
    }
    if (runs.some((r) => offending(r).size)) throw new Error(`bake_walls: wall of way ${w.way} still reaches a lane after 24 passes`);
    if (touched) { trimmedLane++; if (!runs.length) droppedLane++; }
    for (const body of runs) { const clean = body.map(({ shift, ...rest }) => rest); out.push({ ...w, body: clean, pts: taper(clean) }); }
  }
  walls.splice(0, walls.length, ...out);
  console.log(`walls whose collision block reached a lane (lane-clearance.js, ${lanes.count} lane pieces near walls): ${trimmedLane} touched, ${shiftedLane} point moves off a lane, ${pointsLane} points dropped, ${droppedLane} walls dropped whole`);
}

fs.writeFileSync(OUT, encodeWalls(walls));
const points = walls.reduce((s, w) => s + w.pts.length, 0);
let length = 0;
for (const w of walls) for (let i = 1; i < w.pts.length; i++) length += Math.hypot(w.pts[i].x - w.pts[i - 1].x, w.pts[i].z - w.pts[i - 1].z);
console.log(`the ways into an opened cut: ${approachWays.size}, ${approachRamps} dug faces on them; ${joined} cut walls joined at a mouth`);
console.log(`walls: ${walls.length} walls, ${points} points, ${length.toFixed(0)} m long -> ${OUT} (${fs.statSync(OUT).size} bytes); ${probed} samples probed, ${found} ramps, ${duplicate} seen twice, ${short} too short, ramps on tarmac: ${rejected.foot} at the foot / ${rejected.back} at the back, ${rejected.air} in the air, ${rejected.deck} under a deck`);
if (process.argv.includes('--stats')) {
  const bins = [0.8, 1.5, 2.5, 4, 6, 8.01];
  console.log('   by rise: ' + bins.slice(0, -1).map((b, i) => `${b}-${bins[i + 1]} m: ${walls.filter((w) => w.rise >= b && w.rise < bins[i + 1]).length}`).join(', '));
  const sb = [1.6, 2, 2.5, 3, 4, 100];
  console.log('   by slope: ' + sb.slice(0, -1).map((b, i) => `${b}-${sb[i + 1]}: ${walls.filter((w) => w.slope >= b && w.slope < sb[i + 1]).length}`).join(', '));
  const lens = walls.map((w) => w.pts.length).sort((a, b) => a - b);
  console.log(`   points per wall: median ${lens[lens.length >> 1]}, p90 ${lens[Math.floor(lens.length * 0.9)]}, max ${lens[lens.length - 1]}`);
  const sorted = walls.slice().sort((a, b) => b.rise * b.pts.length - a.rise * a.pts.length);
  for (const w of sorted.slice(0, 25)) {
    const m = w.pts[w.pts.length >> 1];
    console.log(`   wall at ${m.x.toFixed(0)},${m.z.toFixed(0)}  ${w.pts.length} pts  rise ${w.rise.toFixed(1)} m  slope ${w.slope.toFixed(1)}  top ${m.top.toFixed(1)}  way ${net.roads[w.way]?.name || net.roads[w.way]?.kind}`);
  }
}
