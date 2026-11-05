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
import { WALL, findRamp, encodeWalls } from '../../pb/lux-drive/retaining-walls.js';

const OUT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/lux-drive/data/walls.bin');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : OUT_DEFAULT;

const LINK_FRONT = 5.5;        // m: the feet of the face at two neighbouring samples are at most this far apart (the samples are 4 m apart, on a bend the feet spread)
const LINK_HEIGHT = 1.5;       // m: ... and their tops and bottoms differ by at most this
const LINK_FACING = 0.6;       // ... and they face the same way (cosine of the angle between the directions to the high ground)
const COVER_CELL = 2;          // m: a ramp that is already in a wall of an earlier way (a point of it this close, same facing, same top) is not written again
const COVER_DIST = 1.4;
const COVER_TOP = 1.2;
const MIN_SAMPLES = 2;         // a ramp seen at a single sample is noise of the scan (a bend, a driveway) and a lone block of stone looks like a crate: a wall is at least two samples long
const CAR_CLEAR = -0.15;        // the foot of the face and the back of the block lie outside every carriageway (signed distance to the union of the carriageways): a wall never stands on tarmac
const MIN_LENGTH = 6;          // m: a wall shorter than this (2 samples on a short bend) reads as a crate lying on the bank: not baked, the ground carries it
const TAPER_LENGTH = 2.5;      // m: the ends of a wall run out into the ground over this length (a sloped end, not a box)
const TAPER_HEIGHT = 0.12;     // m: the height of the tip of a tapered end above the ground
const GAP_SAMPLES = 1;         // a wall goes on across a sample where the scan found nothing (the ramp flickers around its thresholds), if the ground under the middle of the bridge fits

const { field, surface } = await loadWorld();
const net = field.network;
const chains = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road));

const covered = new Map();      // grid of the points already written
const cellKey = (x, z) => Math.floor(x / COVER_CELL) * 100003 + Math.floor(z / COVER_CELL);
function isCovered(p) {
  const cx = Math.floor(p.x / COVER_CELL), cz = Math.floor(p.z / COVER_CELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    for (const q of covered.get((cx + dx) * 100003 + (cz + dz)) || []) {
      if (Math.hypot(q.x - p.x, q.z - p.z) <= COVER_DIST && q.nx * p.nx + q.nz * p.nz > LINK_FACING && Math.abs(q.top - p.top) <= COVER_TOP) return true;
    }
  }
  return false;
}
function cover(p) { const k = cellKey(p.x, p.z); const l = covered.get(k); if (l) l.push(p); else covered.set(k, [p]); }

const rejected = { foot: 0, back: 0 };       // ramps left without a wall: the foot of the face / the back of the block would lie on a carriageway
const roadProbe = { sdCar: 9, sdPave: 9 };
/** True when (x, z) lies outside every carriageway of the carved ground. */
function clearOfRoads(x, z) { net.carve(x, z, roadProbe); return roadProbe.sdCar >= CAR_CLEAR; }

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
  const ramp = findRamp(heights, lands);
  if (!ramp) return null;
  // the foot of the face is the low end of the ramp; the block reaches back to its high end
  const rising = ramp.rise > 0;
  const tFoot = t0 + (rising ? ramp.first : ramp.last) * WALL.scanStep;
  const tHead = t0 + (rising ? ramp.last : ramp.first) * WALL.scanStep;
  const toHigh = rising ? 1 : -1;                              // the direction toward the high ground, along (nx, nz)
  const fx = chain.x[i] + nx * tFoot, fz = chain.z[i] + nz * tFoot;
  // never on tarmac: the foot of the face outside every carriageway; the back of the block is pulled in until it is (the coping is a sliver on the lip, the ramp behind it stays ground)
  if (!clearOfRoads(fx, fz)) { rejected.foot++; return null; }
  let depth = Math.max(WALL.minDepth, Math.abs(tHead - tFoot));
  while (depth > WALL.minDepth && !clearOfRoads(fx + nx * toHigh * depth, fz + nz * toHigh * depth)) depth = Math.max(WALL.minDepth, depth - 0.15);
  if (!clearOfRoads(fx + nx * toHigh * depth, fz + nz * toHigh * depth)) { rejected.back++; return null; }
  const top = Math.max(heights[ramp.first], heights[ramp.last]), bottom = Math.min(heights[ramp.first], heights[ramp.last]);
  return {
    x: chain.x[i] + nx * tFoot, z: chain.z[i] + nz * tFoot, top, bottom, depth,
    nx: nx * toHigh, nz: nz * toHigh, tx: dx, tz: dz, rise: Math.abs(ramp.rise), slope: ramp.maxSlope,
  };
}

const link = (p, q, gap = 1) => Math.hypot(p.x - q.x, p.z - q.z) <= LINK_FRONT * gap && Math.abs(p.top - q.top) <= LINK_HEIGHT && Math.abs(p.bottom - q.bottom) <= LINK_HEIGHT && p.nx * q.nx + p.nz * q.nz >= LINK_FACING;

const ON_RAMP = 0.9;           // m: the foot of the face stands within this of the bottom of the ramp and the back of the block within this of its top (harness gate K proves it)

/** The wall point stands on the ramp it was found on: the ground under the foot of the face is the bottom, the ground under the back of the block is the top. */
function fits(p) {
  return Math.abs(surface.height(p.x, p.z) - p.bottom) <= ON_RAMP && Math.abs(surface.height(p.x + p.nx * p.depth, p.z + p.nz * p.depth) - p.top) <= ON_RAMP;
}

/** A wall found at one sample covers WALL.endExtend m of the way on both sides of it: the ends of a wall are extended, as far as the ramp goes on (the ground may change there). */
function extend(pts) {
  const first = pts[0], last = pts[pts.length - 1];
  const reach = (p, sign) => {
    for (const e of [WALL.endExtend, WALL.endExtend / 2, WALL.endExtend / 4]) {
      const q = { ...p, x: p.x + sign * p.tx * e, z: p.z + sign * p.tz * e };
      if (fits(q) && clearOfRoads(q.x, q.z) && clearOfRoads(q.x + q.nx * q.depth, q.z + q.nz * q.depth)) return q;
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
    return null;
  };
  const a = tip(pts[0], pts[1]), b = tip(pts[pts.length - 1], pts[pts.length - 2]);
  return [...(a ? [a] : []), ...pts, ...(b ? [b] : [])];
}
const wallLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);

const walls = [];
let probed = 0, found = 0, duplicate = 0, short = 0;
for (const chain of chains) {
  const firstOfChain = walls.length;
  for (const side of [1, -1]) {
    let run = [];
    const flush = () => {
      if (run.length >= MIN_SAMPLES) {
        const body = extend(run).map((p) => ({ x: p.x, z: p.z, top: p.top, bottom: p.bottom, depth: p.depth, nx: p.nx, nz: p.nz }));
        if (wallLength(body) < MIN_LENGTH) { short++; run = []; return; }
        const pts = taper(body);
        walls.push({ pts, slope: Math.max(...run.map((p) => p.slope)), rise: Math.max(...run.map((p) => p.rise)), way: chain.road });
      }
      run = [];
    };
    let misses = 0;                                              // samples in a row without a ramp since the last point of the run
    for (let i = 0; i < chain.x.length; i++) {
      probed++;
      const p = wallPointAt(chain, i, side);
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
  for (let w = firstOfChain; w < walls.length; w++) for (const p of walls[w].pts) cover(p);
}

fs.writeFileSync(OUT, encodeWalls(walls));
const points = walls.reduce((s, w) => s + w.pts.length, 0);
let length = 0;
for (const w of walls) for (let i = 1; i < w.pts.length; i++) length += Math.hypot(w.pts[i].x - w.pts[i - 1].x, w.pts[i].z - w.pts[i - 1].z);
console.log(`walls: ${walls.length} walls, ${points} points, ${length.toFixed(0)} m long -> ${OUT} (${fs.statSync(OUT).size} bytes); ${probed} samples probed, ${found} ramps, ${duplicate} seen twice, ${short} too short, ramps on tarmac: ${rejected.foot} at the foot / ${rejected.back} at the back`);
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
