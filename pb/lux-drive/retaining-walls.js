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

const STONE = [0.56, 0.52, 0.45];
const COPING = [0.27, 0.27, 0.27];      // a dark concrete cap: the light grey it had was a white strip lying on the edge of the road when seen from the driver's seat
const MAGIC = 0x4c4c4157;              // 'WALL'
const FLOATS_PER_POINT = 7;            // x, z, top, bottom, depth, nx, nz

/** Course tint: a deterministic hash of the course and the place, so a wall is not one flat colour. */
function tint(course, x, z) {
  const h = Math.sin(course * 12.9898 + Math.floor(x / 3.1) * 78.233 + Math.floor(z / 3.1) * 37.719) * 43758.5453;
  return 0.88 + 0.16 * (h - Math.floor(h));
}

/**
 * The ramp in a profile of the ground across a way.  `heights[k]` and `lands[k]` (the terrain without the roads) at distance k * step.
 * Returns { first, last, rise, maxSlope } (the sample range of the ramp; rise > 0 when the ground rises away from the way) or null.
 * A ramp is a run of ground steeper than toeSlope that has a place steeper than steepSlope and rises (or falls) by at least minRise, and is steeper than the land under it:
 * a cliff that the land has anyway is the shader's business, not a wall.
 */
/** The face of the cut of an opened shallow tunnel (tunnel-cover.js) is a retaining wall wherever it is steep, however steep the hillside it is cut into and up to the height of the
 *  cut (QA2 N-U03: the car climbed the 60 deg grass bank of the Rue Godchaux cut, 12 m into a hillside of 1.6 m/m): findRamp with these limits for the ways of a cut (bake_walls.mjs). */
export const CUT_RAMP = Object.freeze({ maxRise: 12, maxLandSlope: Infinity, naturalFactor: 0, naturalMargin: 0 });

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
    const rise = heights[m] - heights[k];
    const isRamp = maxSlope >= lim.steepSlope && Math.abs(rise) >= lim.minRise && Math.abs(rise) <= lim.maxRise
      && landSlope <= lim.maxLandSlope && maxSlope > lim.naturalFactor * landSlope + lim.naturalMargin;
    if (isRamp && (!best || Math.abs(rise) > Math.abs(best.rise))) best = { first: k, last: m, rise, maxSlope };
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

/**
 * The quads of one wall: [{ q: [a, b, c, d], color }] with a, b, c, d = [x, y, z].  A block with a vertical face in courses of stone at the foot of the ramp, a flat top
 * and a coping that overhangs the face a little; the two ends are closed.  The back of the block is buried in the ground and is not drawn.
 */
export function wallQuads(wall) {
  const quads = [];
  const pts = wall.pts;
  const add = (a, b, c, d, color) => quads.push({ q: [a, b, c, d], color });
  const scale = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], r = pts[i + 1];
    // the face: courses of stone from the buried foot to the top
    const yLow0 = p.bottom - WALL.skirt, yLow1 = r.bottom - WALL.skirt;
    const courses = Math.max(1, Math.round((Math.max(p.top, r.top) - Math.min(yLow0, yLow1)) / WALL.courseHeight));
    for (let c = 0; c < courses; c++) {
      const f0 = c / courses, f1 = (c + 1) / courses;
      const ya0 = yLow0 + (p.top - yLow0) * f0, ya1 = yLow0 + (p.top - yLow0) * f1;
      const yb0 = yLow1 + (r.top - yLow1) * f0, yb1 = yLow1 + (r.top - yLow1) * f1;
      add(front(p, ya0), front(r, yb0), front(r, yb1), front(p, ya1), scale(STONE, tint(c, p.x, p.z)));
    }
    // the coping: the face of the slab, then the top of the block
    add(front(p, p.top, WALL.copingLip), front(r, r.top, WALL.copingLip), front(r, r.top + WALL.coping, WALL.copingLip), front(p, p.top + WALL.coping, WALL.copingLip), scale(COPING, 0.92));
    add(front(p, p.top + WALL.coping, WALL.copingLip), front(r, r.top + WALL.coping, WALL.copingLip), back(r, r.top + WALL.coping), back(p, p.top + WALL.coping), COPING);
  }
  // the ends
  for (const [s, flip] of [[pts[0], false], [pts[pts.length - 1], true]]) {
    const a = front(s, s.bottom - WALL.skirt), b = front(s, s.top + WALL.coping), c = back(s, s.top + WALL.coping), d = back(s, s.bottom - WALL.skirt);
    if (flip) add(a, d, c, b, scale(STONE, 0.9)); else add(a, b, c, d, scale(STONE, 0.9));
  }
  return quads;
}

/** A point of the face of the wall at height y, `over` m in front of it (the coping overhangs). */
function front(s, y, over = 0) { return [s.x - s.nx * over, y, s.z - s.nz * over]; }
/** A point of the back of the block (buried in the high ground) at height y. */
function back(s, y) { return [s.x + s.nx * s.depth, y, s.z + s.nz * s.depth]; }

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

