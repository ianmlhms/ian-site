/* Lux Drive harness, section S (look11): how the walls, the trees, the façades and the chase camera LOOK (QA2 round, Ian's E2 / C1 wall shots).
 *   S1  the face of every drawn retaining wall is smooth along the wall (the two stretches at a point share its normal: no facets, the "diamonds" of Rue Godchaux),
 *       horizontal within the batter, and leans BACK (never out over the road) by at most the batter
 *   S2  no wall is drawn twice (the two arms of a hairpin baked the same ramp: two faces 0.2 m apart, the end of one a dark stripe on the other, Eecherfeld)
 *   S3  the footing of every wall stands as high as the drawn ground in front of its face (the 1 m lattice climbs up to 0.8 m in front of a vertical face: the sawtooth
 *       grass fringe along the foot), up to its cap
 *   S4  the trunk of every tree model reaches into its crown (QA TR01: the crown floated up to 0.07 x the height over the trunk, the floating hats)
 *   S5  the storeys of a façade are level: the façade height v is world height minus one level per house (QA BL02: the bands followed the slope and waved)
 *   S6  the chase camera never puts its lens inside the block of a retaining wall (QA2 N-C02 at 4620,11599: the picture was the inside of the face), at the QA pose and
 *       with the car turned away from the middle of every wall
 *   S8  the drawn wheels stand on the ground (QA2 N-C03: at rest beside a kerb / on a crest a wheel stood up to 24 cm in the drawn ground): at the QA2 places, the car settled,
 *       every wheel within 3 cm of the ground under it unless its spring is at the end of its travel
 *   S7  the slim columns of the footbridges / cycle bridges (deck-view SLIM, QA2 N-B02 deck 218) stand clear of every carriageway under them
 * Called by harness.js; everything it needs is passed in.  Pure Node. */

import { WALL, WALL_LOOK, wallQuads, createWallBlockTest, drawnWalls } from './retaining-walls.js';
import { buildBroadleaf } from './tree-models.js';
import { addBuilding, createBuildingMesh, KIND } from './building-mesh.js';
import { createChaseCamera } from './camera.js';
import { ROAD_MIN_WIDTH, SLIM_PIERS, piersOf } from './deck-shape.js';
import { createCar } from './car.js';
import { WHEEL_TRAVEL, wheelContact, wheelOffsets } from './car-wheels.js';

const NORMAL_TOL = 1e-4;          // S1: the normals of two stretches at their shared point
const FOOT_TOL = 0.05;            // S3: m the drawn ground may stand over the footing (the lattice between the probes)
const MAX_FOOT_OVER = 40;         // S3: samples over the footing where the footing is at its cap (footMax, or half the wall) - a ratchet, lower it as walls get fixed
const AXIS = 0.06;                // S4: the trunk's vertices lie within this of the axis of the model (the crown's are >= 0.15 away)
const LEVEL_TOL = 1e-3;           // S5: m
const S5_SAMPLE = 4000;           // S5: the houses measured (every n-th)
const QA_POSES = [[4620.0, 11599.2, -2.634], [4688.9, 11620.1, 0.749]];
const CAMERA_FRAMES = 90, DT = 1 / 60;

export function runLookChecks({ check, section, stats, data, field, surface, ground, net, buildings, forest, portals }) {
  section('S look11: walls, trees, façades, camera');
  const walls = data.walls;
  const shown = drawnWalls(walls);
  const groundAt = (x, z) => surface.height(x, z);

  // ---- S1: smooth, horizontal, leaning back
  let faceSeams = 0, notLevel = 0, leanOut = 0, faces = 0;
  for (const w of shown) {
    const quads = wallQuads(w, groundAt).filter((q) => q.part === 'face');
    for (let k = 0; k < quads.length; k++) {
      const f = quads[k];
      faces++;
      for (const n of f.n) if (Math.abs(n[1]) > WALL_LOOK.batter + 1e-6) notLevel++;
      // the top corners (3 over 0, 2 over 1) lie behind the foot corners (toward the high ground), by at most the batter times the height
      for (const [lo, hi] of [[0, 3], [1, 2]]) {
        const a = f.q[lo], b = f.q[hi], n = f.n[lo];
        const back = -((b[0] - a[0]) * n[0] + (b[2] - a[2]) * n[2]) / Math.hypot(n[0], n[2]);
        if (back < -1e-6 || back > WALL_LOOK.batter * (b[1] - a[1]) + 1e-6) leanOut++;
      }
      const g = quads[k + 1];
      if (g && Math.abs(g.a[0][0] - f.a[1][0]) < 1e-6) {
        const d = Math.hypot(g.n[0][0] - f.n[1][0], g.n[0][1] - f.n[1][1], g.n[0][2] - f.n[1][2]);
        if (d > NORMAL_TOL) faceSeams++;
      }
    }
  }
  stats.wallFaces = faces;
  check('S1 the face of every wall is smooth along it (no facets between its stretches)', faceSeams, `${faceSeams} seams of ${faces} faces`);
  check('S1 the face of every wall is upright: horizontal normals within the batter, leaning back, never out over the road', notLevel + leanOut, `${notLevel} tilted normals, ${leanOut} leaning corners`);

  // ---- S2: no wall drawn twice
  let twins = 0;
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j];
      if (drawnWalls([a, b]).length < 2) twins++;
    }
  }
  stats.wallsDrawn = shown.length;
  check('S2 no retaining wall is drawn twice (two faces in one place)', twins, `${twins} pairs; ${shown.length} of ${walls.length} walls drawn`);

  // ---- S3: the footing covers the drawn ground in front of the face
  let footSamples = 0, footOver = 0, footOverCapped = 0;
  for (const w of shown) {
    const quads = wallQuads(w, groundAt);
    for (const p of w.pts) {
      if (p.top - p.bottom < WALL.minRise) continue;
      // the footing top at this point: its front's top corner at its place
      let foot = -Infinity;
      for (const q of quads) if (q.part === 'footing') for (const v of q.q) if (Math.hypot(v[0] - (p.x - p.nx * WALL_LOOK.footOut), v[2] - (p.z - p.nz * WALL_LOOK.footOut)) < 1e-3) foot = Math.max(foot, v[1]);
      if (!Number.isFinite(foot)) continue;
      footSamples++;
      for (let d = 0.1; d <= WALL_LOOK.footReach + 1e-6; d += 0.2) {
        const over = groundAt(p.x - p.nx * d, p.z - p.nz * d) - foot;
        if (over <= FOOT_TOL) continue;
        const capped = foot - p.bottom >= Math.min(WALL_LOOK.footMax, (p.top - p.bottom) * 0.5) - 1e-3;
        if (capped) footOverCapped++; else footOver++;
        break;
      }
    }
  }
  stats.wallFoot = { samples: footSamples, over: footOver, overCapped: footOverCapped };
  check('S3 the footing of every wall is as high as the drawn ground in front of its face (no grass teeth along the foot)', footOver, `${footOver} of ${footSamples} points`);
  check(`S3 where the footing is at its cap the ground stands over it at <= ${MAX_FOOT_OVER} points`, footOverCapped <= MAX_FOOT_OVER, `${footOverCapped}`);

  // ---- S4: the trunk reaches into the crown
  let detached = 0, worstGap = 0;
  for (let detail = 0; detail <= 2; detail++) {
    for (let seed = 1; seed <= 40; seed++) {
      const m = buildBroadleaf(detail, seed);
      let trunkTop = -Infinity, crownLow = Infinity;
      for (let v = 0; v < m.pos.length / 3; v++) {
        const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
        if (Math.hypot(x, z) < AXIS) trunkTop = Math.max(trunkTop, y);
      }
      // the lowest point of the crown's surface over the axis: every crown triangle that the vertical line through the trunk top crosses
      const tx = 0, tz = 0;
      for (let t = 0; t < m.idx.length; t += 3) {
        const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]].map((i) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]);
        if ([a, b, c].some((p) => Math.hypot(p[0], p[2]) < AXIS)) continue;          // (the trunk)
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((b[2] - c[2]) * (tx - c[0]) + (c[0] - b[0]) * (tz - c[2])) / d, l2 = ((c[2] - a[2]) * (tx - c[0]) + (a[0] - c[0]) * (tz - c[2])) / d, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        crownLow = Math.min(crownLow, l1 * a[1] + l2 * b[1] + l3 * c[1]);
      }
      const gap = crownLow - trunkTop;
      if (gap > 0) { detached++; worstGap = Math.max(worstGap, gap); }
    }
  }
  check('S4 the trunk of every tree model reaches into its crown (no floating crowns)', detached, `${detached} of 120 models, worst gap ${worstGap.toFixed(3)} of the height`);

  // ---- S5: level storeys
  const landAt = (x, z) => field.baseHeight(x, z);                // (as building-view.js)
  let houses = 0, waving = 0;
  const step = Math.max(1, Math.floor(data.buildings.length / S5_SAMPLE));
  for (let i = 0; i < data.buildings.length; i += step) {
    const mesh = createBuildingMesh();
    addBuilding(mesh, data.buildings[i], groundAt, landAt);
    let off = null, bad = false;
    for (let v = 0; v < mesh.pos.length / 3; v++) {
      if (mesh.info[v * 4 + 2] !== KIND.wall) continue;
      const d = mesh.pos[v * 3 + 1] - mesh.info[v * 4 + 1];         // world height - v: the level of the house
      if (off === null) off = d; else if (Math.abs(d - off) > LEVEL_TOL) bad = true;
    }
    if (off === null) continue;
    houses++;
    if (bad) waving++;
  }
  check('S5 the storeys of every façade are level (v = height over one level per house)', waving, `${waving} of ${houses} houses`);

  // ---- S6: the lens never inside a wall
  const lensIn = createWallBlockTest(walls);
  const collide = (x, z, r, y) => buildings.collide(x, z, r) || (ground.onDeck(x, z) ? null : forest.collide(x, z, r)) || portals.collide(x, z, r, y) || lensIn(x, z, r, y);   // (as main.js)
  const lensInside = (x, z, heading) => {
    const chase = createChaseCamera(ground, collide);
    const state = { x, z, y: ground.height(x, z) + 0.42, heading, vx: 0, vz: 0, vy: 0, speed: 0, roll: 0, grounded: true };
    chase.snap(state);
    let out = null;
    for (let f = 0; f < CAMERA_FRAMES; f++) out = chase.update(state, DT, 0, f * DT);
    return lensIn(out.x, out.z, 0, out.y) ? out : null;
  };
  let qaIn = 0;
  for (const [x, z, h] of QA_POSES) if (lensInside(x, z, h)) qaIn++;
  check('S6 the chase camera is not inside a retaining wall at the QA2 N-C02 poses', qaIn, `${qaIn} of ${QA_POSES.length}`);
  let probes = 0, inside = 0;
  const where = [];
  for (const w of shown) {
    const p = w.pts[w.pts.length >> 1];
    if (p.top - p.bottom < 2) continue;
    // the car 2.5 m in front of the face, its back to the wall: the boom points into the block
    const x = p.x - p.nx * 2.5, z = p.z - p.nz * 2.5;
    probes++;
    if (lensInside(x, z, Math.atan2(-p.nz, -p.nx))) { inside++; if (where.length < 4) where.push(`${x.toFixed(0)},${z.toFixed(0)}`); }
  }
  check('S6 the chase camera is not inside a retaining wall with the car backed up to the middle of any wall', inside, `${inside} of ${probes} ${where.join(' ')}`);

  // ---- S7: the slim piers keep out of the roads
  const probe = { ...net.scratch };
  let slimPiers = 0, slimInRoad = 0;
  for (const d of data.decks) {
    if (d.width >= ROAD_MIN_WIDTH) continue;
    for (const p of piersOf(d, surface, (x, z) => { net.carve(x, z, probe); return probe.sdCar; }, SLIM_PIERS)) {
      slimPiers++;
      net.carve(p.x, p.z, probe);
      if (probe.sdCar < 0) slimInRoad++;
    }
  }
  stats.slimPiers = slimPiers;
  check('S7 no slim column of a footbridge / cycle bridge stands on a carriageway', slimInRoad, `${slimInRoad} of ${slimPiers}`);

  // ---- S8: the drawn wheels on the ground
  const SPOTS = [[1.31, 0.78], [1.31, -0.78], [-1.31, 0.78], [-1.31, -0.78]];       // (car-model.js WHEEL_X, WHEEL_Z)
  const NC03 = [[5237.3, 6293.6, -0.659], [5938.2, 6337.6, -0.872], [5724, 8853, 0], [5273.6, 9214.7, 1.154], [7615, 8342, 0], [3264, 9986, 0], [3608.3, 7993.4, -1.793], [8311.4, 6184.8, 2.388]];
  const car = createCar({ ground, roadInfoAt: (x, z, o) => surface.roadInfoAt(x, z, o) });
  const groundAtW = (x, z) => ground.height(x, z);
  let wheelsOff = 0, wheelsAt = 0, worstOff = 0, beforeWorst = 0;
  for (const [x, z, h] of NC03) {
    car.reset(x, z, h);
    for (let f = 0; f < 120; f++) car.update(1 / 60, {});
    const st = car.state, y0 = st.y - 0.42, roll = Math.max(-0.3, Math.min(0.3, st.roll));
    const offs = wheelOffsets(st.x, y0, st.z, st.heading, st.pitch, roll, SPOTS, groundAtW);
    SPOTS.forEach(([lx, lz], i) => {
      const [wx, wy, wz] = wheelContact(st.x, y0, st.z, st.heading, st.pitch, roll, lx, lz);
      const d = groundAtW(wx, wz) - wy;
      beforeWorst = Math.max(beforeWorst, Math.abs(d));
      const atStop = offs[i] >= WHEEL_TRAVEL.bump - 1e-6 || offs[i] <= -WHEEL_TRAVEL.droop + 1e-6;
      wheelsAt++;
      const left = Math.abs(d - offs[i]);
      if (left > 0.03 && !atStop) { wheelsOff++; worstOff = Math.max(worstOff, left); }
    });
  }
  check('S8 every drawn wheel stands on the ground at the QA2 N-C03 places (its spring takes the kerb / the crest)', wheelsOff, `${wheelsOff} of ${wheelsAt} wheels, worst ${worstOff.toFixed(3)} m (without the springs ${beforeWorst.toFixed(2)} m)`);
}
