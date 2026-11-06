/* The retaining walls of Lux Drive: where two carriageways at different levels lie side by side, or a terrace stands on a cliff, the ground between them is a ramp
 * of 1.5 .. 3 m/m (road-network.js keeps it from being steeper: a height field cannot hold a vertical face, and a steeper ramp would be a crack).  A ramp that steep
 * drawn as ground is a stretched stripe of grass texture; here it is hidden inside a real wall: a block of stone with a vertical face at the foot of the ramp, a top
 * flush with the high ground and a coping.  The walls are BAKED (scripts/luxdrive/bake_walls.mjs finds the ramps in the very height function the game runs and
 * writes data/walls.bin), the game draws them (wall-view.js) and the harness checks that every one of them still stands on a ramp (gate K).
 *
 * Pure functions (no THREE), shared by the baker, the view and the harness. */

export const WALL = Object.freeze({
  scanStep: 0.25,          // m: the step of a profile across a way
  scanFrom: 0.5,           // the profile starts this share of the half width of the way from its axis ...
  scanReach: 9,            // ... and ends this far beyond its bench
  steepSlope: 2.0,         // m/m: a ramp has a place this steep ...
  toeSlope: 0.45,          // m/m: ... and reaches as far as the ground is steeper than this (the toe and the shoulder of the ramp)
  minRise: 0.8,            // m: a ramp lower than this is a kerb or a bank, not a wall
  maxRise: 6,              // m: a ramp higher than this is a rock face (the Alzette valley), not a wall: the ground shader paints it as rock
  naturalFactor: 1.5,      // a ramp is the land's own cliff when it is not steeper than the land by more than this factor + naturalMargin
  naturalMargin: 0.5,
  maxLandSlope: 1.4,       // m/m: where the land itself is steeper than this the ground is a hillside, and a block of stone on it reads as a crate (a wall stands where the carve made the ramp)
  skirt: 0.5,              // m: the face of the wall goes this far below the foot of the ramp (buried), so nothing shows under it
  coping: 0.06,            // m: the coping stands this far above the high ground, and overhangs the face by copingLip
  copingLip: 0.07,
  courseHeight: 0.42,      // m: the height of a course of stone
  minDepth: 0.45,          // m: the block is at least this thick (the ramp inside it is narrower, but the coping needs a seat)
  shortRise: 2,            // m: a ramp lower than this that is only a couple of samples long is carried by the ground (a short wall of 1 .. 2 m on a bank reads as a crate): bake_walls.mjs drops it, gate K does not ask for it
  endExtend: 2,            // m: a wall found at a sample of the way covers this far along the way on both sides of it
});

/**
 * How far the drawn ground (the 1 m lattice of the physics surface) may lie from the foot / the head of a wall point and still be "the ramp": 0.9 m, and on a ramp steeper than 3 m/m
 * (rise / depth) the lattice itself cannot follow the face - bilinear cells of 1 m across a 4 m/m ramp are off by a metre - so 0.3 m more per m/m beyond 3.
 */
export function rampTolerance(rise, depth) {
  const slope = depth > 1e-6 ? rise / depth : 0;
  return 0.9 + 0.3 * Math.max(0, slope - 3);
}

/** The walls are drawn out to this many times the far building radius of the quality level (a wall is a small thing: a bridge deck is drawn out to 1.5 times). */
export const WALL_DRAW_FACTOR = 0.6;

const MAGIC = 0x4c4c4157;              // 'WALL'
const FLOATS_PER_POINT = 7;            // x, z, top, bottom, depth, nx, nz

/** The face of the cut of an opened shallow tunnel (tunnel-cover.js) is a retaining wall wherever it is steep, however steep the hillside it is cut into (findRamp with these limits
 *  for the ways of a cut, bake_walls.mjs).  A face that rises higher than maxRise is not dropped as a rock face: the wall holds its lowest maxRise metres (capRise) and the hillside
 *  goes on above the coping (QA2 N-U03: the Rue Godchaux cut lies at the foot of a hill of 2 m/m that rises 20 m within the scan; the car climbed its bare bank and rolled 65 deg). */
export const CUT_RAMP = Object.freeze({ maxRise: WALL.maxRise, capRise: true, maxLandSlope: Infinity, naturalFactor: 0, naturalMargin: 0 });

/**
 * The ramp in a profile of the ground across a way.  `heights[k]` and `lands[k]` (the terrain without the roads) at distance k * step.
 * Returns { first, last, rise, maxSlope } (the sample range of the ramp; rise > 0 when the ground rises away from the way) or null.
 * A ramp is a run of ground steeper than toeSlope that has a place steeper than steepSlope and rises (or falls) by at least minRise, and is steeper than the land under it:
 * a cliff that the land has anyway is the shader's business, not a wall.
 */
export function findRamp(heights, lands, step = WALL.scanStep, limits = WALL) {
  const lim = limits === WALL ? WALL : { ...WALL, ...limits };
  const n = heights.length;
  let best = null;
  let k = 0;
  while (k < n - 1) {
    const g = (heights[k + 1] - heights[k]) / step;
    if (Math.abs(g) < WALL.toeSlope) { k++; continue; }
    const sign = Math.sign(g);
    let m = k, maxSlope = 0, landSlope = 0;
    while (m < n - 1) {
      const gm = (heights[m + 1] - heights[m]) / step;
      if (Math.sign(gm) !== sign || Math.abs(gm) < WALL.toeSlope) break;
      maxSlope = Math.max(maxSlope, Math.abs(gm));
      landSlope = Math.max(landSlope, Math.abs((lands[m + 1] - lands[m]) / step));
      m++;
    }
    let lo = k, hi = m;                                                // (the samples of the ramp that are kept: all of it, or its lowest maxRise metres)
    if (lim.capRise && Math.abs(heights[m] - heights[k]) > lim.maxRise) {
      const foot = sign > 0 ? k : m;                                   // the low end of the ramp is its foot
      if (sign > 0) { while (hi > lo + 1 && heights[hi] - heights[foot] > lim.maxRise) hi--; } else { while (lo < hi - 1 && heights[lo] - heights[foot] > lim.maxRise) lo++; }
      maxSlope = 0; landSlope = 0;
      for (let q = lo; q < hi; q++) {
        maxSlope = Math.max(maxSlope, Math.abs(heights[q + 1] - heights[q]) / step);
        landSlope = Math.max(landSlope, Math.abs(lands[q + 1] - lands[q]) / step);
      }
    }
    const rise = heights[hi] - heights[lo];
    const isRamp = maxSlope >= lim.steepSlope && Math.abs(rise) >= lim.minRise && Math.abs(rise) <= lim.maxRise
      && landSlope <= lim.maxLandSlope && maxSlope > lim.naturalFactor * landSlope + lim.naturalMargin;
    if (isRamp && (!best || Math.abs(rise) > Math.abs(best.rise))) best = { first: lo, last: hi, rise, maxSlope };
    k = m + 1;
  }
  return best;
}

/** The binary file: u32 magic, u32 walls, then per wall u32 points and 7 float32 per point (x, z of the foot of the face, top, bottom, depth, direction toward the high ground). */
export function encodeWalls(walls) {
  let floats = 0;
  for (const w of walls) floats += w.pts.length * FLOATS_PER_POINT;
  const bytes = new Uint8Array(8 + walls.length * 4 + floats * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, walls.length, true);
  let pos = 8;
  for (const w of walls) {
    view.setUint32(pos, w.pts.length, true); pos += 4;
    for (const p of w.pts) {
      for (const v of [p.x, p.z, p.top, p.bottom, p.depth, p.nx, p.nz]) { view.setFloat32(pos, v, true); pos += 4; }
    }
  }
  return bytes;
}

/** walls.bin -> [{ pts: [{ x, z, top, bottom, depth, nx, nz }] }] */
export function decodeWalls(bytes) {
  if (bytes.byteLength < 8) throw new Error(`walls.bin: ${bytes.byteLength} bytes is too short for a header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('walls.bin: bad magic (not a wall file)');
  const count = view.getUint32(4, true);
  const walls = [];
  let pos = 8;
  for (let w = 0; w < count; w++) {
    if (pos + 4 > bytes.byteLength) throw new Error(`walls.bin: truncated at wall ${w} of ${count}`);
    const n = view.getUint32(pos, true); pos += 4;
    if (pos + n * FLOATS_PER_POINT * 4 > bytes.byteLength) throw new Error(`walls.bin: truncated inside wall ${w} (${n} points)`);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const f = [];
      for (let q = 0; q < FLOATS_PER_POINT; q++) { f.push(view.getFloat32(pos, true)); pos += 4; }
      pts.push({ x: f[0], z: f[1], top: f[2], bottom: f[3], depth: f[4], nx: f[5], nz: f[6] });
    }
    walls.push({ id: w, pts });
  }
  return walls;
}

/** The look of the walls (look11, wall-view.js / wall-material.js): the geometry of the face, the coping and the block. */
export const WALL_LOOK = Object.freeze({
  batter: 0.04,            // m/m: the face leans back this much toward the high ground (a laid wall has a batter; the foot line stays where the bake put it)
  copingDepth: 0.2,        // m: the coping slab is this thick (it covers the top of the face) ...
  copingLip: 0.05,         // ... overhangs the face by this much, and stands WALL.coping over the top
  backDrop: 1.2,           // m: the back of the block is closed this far down (seen only where the ground behind it falls away: no see-through block)
  footOut: 0.32,           // m: the footing stands out of the face this far at the foot ...
  footMin: 0.22,           // ... and is at least this high, or as high as the drawn ground in front of the face (+ footOver): the 1 m lattice cannot follow a
  footMax: 0.75,           // vertical face, its triangles climb up to 0.8 m in front of it, and that was the sawtooth grass fringe along the foot of every wall
  footOver: 0.08,
  footReach: 0.9,          // m: how far in front of the face the ground is looked at
  copingBack: 0.5,         // m: the pale coping is this deep; behind it the block is a bank of earth (city12, QA3 N3-W04 / W05: the full block top was a pale slab and its back
                           // and ends stood above a falling ground as a beige box or a dark tombstone; JFK's first wall read as a concrete kerb slab lying on the tarmac)
  endTaper: 2.5,           // m: the end of a wall runs down into the ground beyond it over at most this
  bankBelow: 0.25,         // m: the bank behind the coping goes down to this far under the drawn ground behind the block (buried where the ground is as high as the top)
  oldTown: [4300, 8200, 5700, 9900],   // x0, z0, x1, z1: the old town, the Grund, Pfaffenthal and Clausen are walled in Luxembourg sandstone
});

// the colours of the kinds (wall-material.js draws the joints and the grain on top): Luxembourg sandstone, grey limestone, poured concrete, a pale concrete coping
const STONE_OF = Object.freeze({ 0: [0.66, 0.58, 0.45], 1: [0.57, 0.56, 0.52], 2: [0.62, 0.61, 0.58] });
const COPING_COLOR = [0.55, 0.54, 0.52];
const BANK_COLOR = [0.40, 0.45, 0.27];  // the earth and grass of the bank behind the coping (wall-material.js KIND back: a mottled ground colour, never a box of stone)
const FOOTING_SHADE = 0.86;             // the footing's front is the stone of the wall, this much darker (a stepped base, not a pale bench)
const scaleColor = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const KIND = Object.freeze({ coping: 3, back: 4 });      // (= WALL_KIND of wall-material.js; 0..2 are the stone of the face)
export const WALL_PART_KIND = KIND;                       // (harness U5: wall-material.js needs THREE)

/** The stone of a wall: sandstone in the old town, elsewhere concrete or limestone or sandstone by a stable hash of its place. */
export function wallStone(wall) {
  const m = wall.pts[wall.pts.length >> 1];
  const [x0, z0, x1, z1] = WALL_LOOK.oldTown;
  if (m.x > x0 && m.x < x1 && m.z > z0 && m.z < z1) return 0;
  const h = Math.sin(Math.floor(m.x) * 12.9898 + Math.floor(m.z) * 78.233) * 43758.5453, f = h - Math.floor(h);
  return f < 0.45 ? 2 : f < 0.75 ? 1 : 0;
}

/**
 * The quads of one wall: [{ part, q: [a, b, c, d], n: [na, nb, nc, nd], color, a: [ua, ub, uc, ud] }] (part: face, footing, footTop, lipUnder, lipFront, top, bank, back, end, endBank) with a.. = [x, y, z], n.. = the vertex normals and
 * u.. = [metres along the wall, kind, the height of the foot] (wall-material.js).  A block with a face in one piece from the buried foot to the coping (the
 * courses are the shader's, level in world height), a coping slab that overhangs the face a little, a flat top and a closed back; the two ends are closed.
 * The normals of the face are SMOOTH along the wall (the mean of the two segments at a point), so a curved wall has no facets.
 * groundAt(x, z): the drawn ground (optional): the footing at the foot is as high as the ground in front of the face (it hides the lattice's teeth).
 */
export function wallQuads(wall, groundAt = null) {
  const quads = [];
  const pts = wall.pts;
  const stone = wallStone(wall), stoneColor = STONE_OF[stone];
  const add = (part, q, n, color, kind, us, foot) => quads.push({ part, q, n, color, a: us.map((u, k) => [u, kind, foot[k]]) });
  // the distance along the wall and the outward normal of the face at every point (away from the high ground), smoothed over the two segments
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const out = pts.map((p, i) => {
    let sx = 0, sz = 0;
    for (const [a, b] of [[pts[i - 1], p], [p, pts[i + 1]]]) {
      if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      if (l < 1e-3) continue;
      let ox = dz / l, oz = -dx / l;
      if (ox * p.nx + oz * p.nz > 0) { ox = -ox; oz = -oz; }      // away from the high ground
      sx += ox; sz += oz;
    }
    const l = Math.hypot(sx, sz);
    return l > 1e-6 ? [sx / l, sz / l] : [-p.nx, -p.nz];
  });
  const lean = Math.hypot(1, WALL_LOOK.batter);
  const faceN = (i) => [out[i][0] / lean, WALL_LOOK.batter / lean, out[i][1] / lean];
  const backN = (i) => [-out[i][0], 0, -out[i][1]];
  const UP = [0, 1, 0], DOWN = [0, -1, 0];
  // the geometry of a point: the face leans back by the batter from the foot; the coping is at most half the height of a tapered tip thick
  const geo = pts.map((p, i) => {
    const rise = p.top - p.bottom;
    const cap = Math.min(WALL_LOOK.copingDepth, Math.max(0.02, rise * 0.5));
    const at = (y, over) => {                                          // the face at height y, `over` m in front of it
      const back = WALL_LOOK.batter * Math.max(0, y - p.bottom) - over;
      return [p.x + p.nx * back, y, p.z + p.nz * back];
    };
    const yUnder = p.top - cap, yTop = p.top + WALL.coping;
    const cb = Math.min(p.depth, WALL_LOOK.copingBack);
    // the back edge of the bank: under the drawn ground behind the block (buried where the ground there is as high as the top: a retaining wall), down the slope where it falls away
    const behind = groundAt ? groundAt(p.x + p.nx * p.depth, p.z + p.nz * p.depth) - WALL_LOOK.bankBelow : yTop - WALL_LOOK.backDrop;
    const backY = Math.max(p.bottom, Math.min(yTop - 0.02, behind));
    return {
      foot: at(p.bottom - WALL.skirt, 0), under: at(yUnder, 0), lipLow: at(yUnder, WALL_LOOK.copingLip), lipTop: at(yTop, WALL_LOOK.copingLip),
      cope: [p.x + p.nx * cb, yTop, p.z + p.nz * cb], copeFoot: [p.x + p.nx * cb, p.bottom - WALL.skirt, p.z + p.nz * cb],
      backTop: [p.x + p.nx * p.depth, backY, p.z + p.nz * p.depth], backLow: [p.x + p.nx * p.depth, backY - WALL_LOOK.backDrop, p.z + p.nz * p.depth],
      footY: p.bottom, i,
    };
  });
  // the footing: a concrete step at the foot, as high as the drawn ground in front of the face (the highest of the point and its neighbours: a calm top)
  const rawFoot = pts.map((p) => {
    let up = WALL_LOOK.footMin - WALL_LOOK.footOver;
    if (groundAt) for (let d = 0.1; d <= WALL_LOOK.footReach + 1e-6; d += 0.2) up = Math.max(up, groundAt(p.x - p.nx * d, p.z - p.nz * d) - p.bottom);
    return Math.min(WALL_LOOK.footMax, up + WALL_LOOK.footOver, Math.max(0.02, (p.top - p.bottom) * 0.5));
  });
  const footH = rawFoot.map((f, i) => Math.min(Math.max(f, rawFoot[i - 1] ?? 0, rawFoot[i + 1] ?? 0), Math.max(0.02, (pts[i].top - pts[i].bottom) * 0.5)));
  const footing = pts.map((p, i) => {
    const y0 = p.bottom - WALL.skirt, y1 = p.bottom + footH[i];
    return { low: [p.x - p.nx * WALL_LOOK.footOut, y0, p.z - p.nz * WALL_LOOK.footOut], high: [p.x - p.nx * WALL_LOOK.footOut, y1, p.z - p.nz * WALL_LOOK.footOut],
      seat: [p.x + p.nx * WALL_LOOK.batter * footH[i], y1 + 0.03, p.z + p.nz * WALL_LOOK.batter * footH[i]] };
  });
  for (let i = 0; i + 1 < pts.length; i++) {
    const g = geo[i], h = geo[i + 1], us = [along[i], along[i + 1], along[i + 1], along[i]], foot = [g.footY, h.footY, h.footY, g.footY];
    const f = footing[i], e = footing[i + 1];
    add('footing', [f.low, e.low, e.high, f.high], [faceN(i), faceN(i + 1), faceN(i + 1), faceN(i)], scaleColor(stoneColor, FOOTING_SHADE), stone, us, foot);   // the footing's front: the wall's stone, a shade darker
    add('footTop', [f.high, e.high, e.seat, f.seat], [UP, UP, UP, UP], scaleColor(stoneColor, FOOTING_SHADE * 0.92), stone, us, foot);                                           // its top
    add('face', [g.foot, h.foot, h.under, g.under], [faceN(i), faceN(i + 1), faceN(i + 1), faceN(i)], stoneColor, stone, us, foot);            // the face
    add('lipUnder', [g.under, h.under, h.lipLow, g.lipLow], [DOWN, DOWN, DOWN, DOWN], COPING_COLOR, KIND.coping, us, foot);                         // the underside of the lip
    add('lipFront', [g.lipLow, h.lipLow, h.lipTop, g.lipTop], [faceN(i), faceN(i + 1), faceN(i + 1), faceN(i)], COPING_COLOR, KIND.coping, us, foot); // the front of the coping
    add('top', [g.lipTop, h.lipTop, h.cope, g.cope], [UP, UP, UP, UP], COPING_COLOR, KIND.coping, us, foot);                                     // the coping
    add('bank', [g.cope, h.cope, h.backTop, g.backTop], [UP, UP, UP, UP], BANK_COLOR, KIND.back, us, foot);                                     // the bank behind it, down to the ground at the back
    add('back', [g.backTop, h.backTop, h.backLow, g.backLow], [backN(i), backN(i + 1), backN(i + 1), backN(i)], BANK_COLOR, KIND.back, us, foot); // the back (buried; earth where the ground falls away)
  }
  // the ends: the side of the block from the buried foot to the top of the coping
  for (const [k, sign] of [[0, -1], [pts.length - 1, 1]]) {
    const g = geo[k], p = pts[k];
    const tx = p.nz * sign, tz = -p.nx * sign;                         // along the wall, outward (the sign of the end)
    const n = Math.sign(out[k][0] * -tz + out[k][1] * tx) || 1;        // (any orientation: the material is two-sided and flips N)
    const endN = [tx * n, 0, tz * n];
    const backFoot = [p.x + p.nx * p.depth, p.bottom - WALL.skirt, p.z + p.nz * p.depth];
    const at = [along[k], along[k], along[k], along[k]], ft = [p.bottom, p.bottom, p.bottom, p.bottom];
    add('end', [g.foot, g.lipTop, g.cope, g.copeFoot], [endN, endN, endN, endN], stoneColor, stone, at, ft);                         // the stone: as deep as the coping
    add('endBank', [g.copeFoot, g.cope, g.backTop, backFoot], [endN, endN, endN, endN], BANK_COLOR, KIND.back, at, ft);              // the earth behind it, sloping to the back
    // the end tapers into the ground beyond it: a wedge of earth from the top of the end down to the drawn ground ENDTAPER m on (the end stood up out of a falling slope as
    // a dark slab, QA3 N3-W04); its face side is the wall's stone
    if (groundAt) {
      const run = Math.min(WALL_LOOK.endTaper, Math.max(0.5, p.top - p.bottom));
      const on = (q) => { const x = q[0] + tx * run, z = q[2] + tz * run; return [x, Math.min(q[1], groundAt(x, z) - 0.1), z]; };
      const c1 = on(g.cope), b1 = on(g.backTop), l1 = on(g.lipTop);
      const slopeN = [tx * n * 0.7, 0.7, tz * n * 0.7];
      add('endTaper', [g.cope, c1, b1, g.backTop], [slopeN, slopeN, slopeN, slopeN], BANK_COLOR, KIND.back, at, ft);
      add('endTaperTop', [g.lipTop, l1, c1, g.cope], [slopeN, slopeN, slopeN, slopeN], COPING_COLOR, KIND.coping, at, ft);
      quads.push({ part: 'endTaperFace', q: [g.foot, [l1[0], g.foot[1], l1[2]], l1, g.lipTop], n: [faceN(k), faceN(k), faceN(k), faceN(k)], color: stoneColor, a: at.map((u) => [u, stone, p.bottom]) });
    }
  }
  return quads;
}

/**
 * A test "does a thing of radius r at (x, z) stand in a retaining wall": the block of every stretch (face line to back line, in plan) of every wall, in a spatial hash.
 * The street lamps and the benches keep out of the walls (QA W03: a lamp stood inside the block of wall 54 at Hostert).
 * Returns (x, z, r) => boolean.
 */
export function createWallFootprint(walls, cell = 16) {
  const quads = [], grid = new Map();
  const key = (cx, cz) => cx * 65536 + cz;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.pts.length; i++) {
      const p = wall.pts[i], q = wall.pts[i + 1];
      const poly = [[p.x, p.z], [q.x, q.z], [q.x + q.nx * q.depth, q.z + q.nz * q.depth], [p.x + p.nx * p.depth, p.z + p.nz * p.depth]];
      const k = quads.push(poly) - 1;
      const xs = poly.map((v) => v[0]), zs = poly.map((v) => v[1]);
      for (let cx = Math.floor((Math.min(...xs) - 2) / cell); cx <= Math.floor((Math.max(...xs) + 2) / cell); cx++) {
        for (let cz = Math.floor((Math.min(...zs) - 2) / cell); cz <= Math.floor((Math.max(...zs) + 2) / cell); cz++) {
          const l = grid.get(key(cx, cz)); if (l) l.push(k); else grid.set(key(cx, cz), [k]);
        }
      }
    }
  }
  /** The distance from (x, z) to a convex quad (0 inside). */
  const distTo = (poly, x, z) => {
    let inside = true, best = Infinity;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % 4], ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
      if (ex * (z - az) - ez * (x - ax) < 0) inside = false;
    }
    // (the winding of a wall quad depends on the side its back lies on: inside means all on one side)
    if (!inside) { inside = true; for (let i = 0; i < 4; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % 4]; if ((bx - ax) * (z - az) - (bz - az) * (x - ax) > 0) inside = false; } }
    return inside ? 0 : best;
  };
  return (x, z, r) => {
    for (const k of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) || []) if (distTo(quads[k], x, z) <= r) return true;
    return false;
  };
}


/**
 * The lens test of the chase camera (QA2 N-C02): is a sphere of radius r at (x, y, z) inside the block of a retaining wall (between the face and the back, under the
 * coping)?  At the end of a service way under a 3.6 m wall (4620,11599) the boom reached over the face into the block and the picture was the inside of the face.
 * Returns (x, z, r, y) => { nx, nz, pen } | null: the shorter way out, through the face (toward the low side) or over the back.
 */
export function createWallBlockTest(walls, cell = 16) {
  const segs = [], grid = new Map();
  const key = (cx, cz) => cx * 65536 + cz;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.pts.length; i++) {
      const p = wall.pts[i], q = wall.pts[i + 1];
      const top = Math.max(p.top, q.top) + WALL.coping + 0.05, bottom = Math.min(p.bottom, q.bottom) - WALL.skirt;
      if (Math.max(p.top - p.bottom, q.top - q.bottom) < WALL.minRise * 0.5) continue;      // (the tapered tips)
      const k = segs.push({ p, q, top, bottom }) - 1;
      const r = Math.max(p.depth, q.depth) + 2;
      for (let cx = Math.floor((Math.min(p.x, q.x) - r) / cell); cx <= Math.floor((Math.max(p.x, q.x) + r) / cell); cx++) {
        for (let cz = Math.floor((Math.min(p.z, q.z) - r) / cell); cz <= Math.floor((Math.max(p.z, q.z) + r) / cell); cz++) {
          const l = grid.get(key(cx, cz)); if (l) l.push(k); else grid.set(key(cx, cz), [k]);
        }
      }
    }
  }
  return (x, z, r, y) => {
    let best = null;
    for (const k of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) || []) {
      const { p, q, top, bottom } = segs[k];
      if (y > top + r || y < bottom) continue;
      const ex = q.x - p.x, ez = q.z - p.z, ll = ex * ex + ez * ez;
      if (ll < 1e-9) continue;
      const t = ((x - p.x) * ex + (z - p.z) * ez) / ll;
      if (t < 0 || t > 1) continue;
      const nx = p.nx + (q.nx - p.nx) * t, nz = p.nz + (q.nz - p.nz) * t, nl = Math.hypot(nx, nz) || 1;
      const depth = p.depth + (q.depth - p.depth) * t;
      const s = ((x - p.x - ex * t) * nx + (z - p.z - ez * t) * nz) / nl;      // how far into the block (from the face toward the high ground)
      if (s <= -r || s >= depth + r) continue;
      const out = s + r <= depth + r - s ? { nx: -nx / nl, nz: -nz / nl, pen: s + r } : { nx: nx / nl, nz: nz / nl, pen: depth + r - s };
      if (!best || out.pen > best.pen) best = out;
    }
    return best;
  };
}

/** Two walls closer than this (m, face to face) with the same high side are one wall baked twice (the two arms of a hairpin scan the same ramp: Eecherfeld 68 / 69). */
const TWIN_GAP = 0.8;
/** ... when this share of the points of the shorter one lies on the other. */
const TWIN_SHARE = 0.7;
/** ... and the other one reaches as high and as low there (m). */
const TWIN_COVER = 0.4;

/** The distance in plan from (x, z) to the face polyline of a wall. */
function distToFace(wall, x, z) {
  let best = Infinity;
  const pts = wall.pts;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, ll = ex * ex + ez * ez;
    const t = ll > 1e-9 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / ll)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - ex * t, z - a.z - ez * t));
  }
  return best;
}

/**
 * The walls to draw: every wall but the twins (a wall whose points lie on the face of a longer one with the same high side): two faces 0.2 m apart flicker,
 * and the end of the one shows as a dark stripe on the other.  The physics keeps both (they stand in the same place).  Pure: returns a new list.
 */
export function drawnWalls(walls) {
  const len = (w) => w.pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - w.pts[i - 1].x, p.z - w.pts[i - 1].z) : 0), 0);
  const lengths = new Map(walls.map((w) => [w, len(w)]));
  const twin = (w, o) => {
    if (o === w) return false;
    const lw = lengths.get(w), lo = lengths.get(o);
    if (lo < lw || (lo === lw && o.id > w.id)) return false;            // only the shorter one (or the later of two equal ones) gives way
    const m = w.pts[w.pts.length >> 1], c = o.pts[o.pts.length >> 1];
    if (Math.hypot(m.x - c.x, m.z - c.z) > lw + lo) return false;
    let on = 0;
    for (const p of w.pts) {
      if (distToFace(o, p.x, p.z) > TWIN_GAP) continue;
      const near = o.pts.reduce((b, q) => (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? q : b));
      // (the same high side, and the other one covers this one's height: a short high wall in front of a long low one is not its twin)
      if (near.nx * p.nx + near.nz * p.nz > 0.7 && near.top >= p.top - TWIN_COVER && near.bottom <= p.bottom + TWIN_COVER) on++;
    }
    return on >= TWIN_SHARE * w.pts.length;
  };
  return walls.filter((w) => !walls.some((o) => twin(w, o)));
}

