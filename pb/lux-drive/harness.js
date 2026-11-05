#!/usr/bin/env node
/* Lux Drive: the harness.   node pb/lux-drive/harness.js [--quick] [--verbose]
 *
 * The gates of Milestone 4.  The harness loads the baked world exactly like the browser does (the same decoders,
 * the same height function, the same tile builder) and proves, in Node, that
 *   A  the data decodes, is finite, has the expected size and fits the budget                       (data)
 *   B  the road network: no way ends in nowhere, no car drives on the rails, the paint follows
 *      the real width of the carriageway                                                             (roads)
 *   C  the city: no house floats, no house is buried in the hill, no road runs through a house       (city)
 *   D  the decks: every deck stands on a way that rides over the others, no deck floats             (decks)
 *   E  the trees: every tree stands on the ground, none stands inside a house                        (trees)
 *   F  the car and the camera: the car stays on the surface, the camera never goes under the ground (car)
 *   G  the render mesh height equals the physics surface height                                     (render)
 *
 * The exit code is 0 only when every check passes.  The numbers it prints are the ones PROGRESS.md records.
 * The Python probes (scripts/luxdrive/probe_roads.py, probe_buildings.py) check the same world against OSM:
 * the harness knows the bake, the probes know the source. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from './world-data.js';
import { createHeightField } from './heightfield.js';
import { createSurface } from './surface.js';
import { createDeckNetwork, createGround, DECK } from './decks.js';
import { DECK_ON_ROAD, piersOf } from './deck-shape.js';
import { createWallCollider } from './wall-collider.js';
import { createBuildingIndex } from './buildings.js';
import { createLandmarks, fixLandmarkDecks } from './landmarks.js';
import { createTreeIndex, treesOfBlock, keepWaysClear, bakedCrownRadius, wayMargin, crownShare } from './trees.js';
import { createPortals, portalRoadAt, portalBlocked } from './portals.js';
import { createPlayArea } from './play-area.js';
import { buildWorldMap } from './world-map.js';
import { createCar } from './car.js';
import { createChaseCamera } from './camera.js';
import { createRoadIndex, isCarRoad } from './road-index.js';
import { createGearbox, ENGINE, squealLevel, thudLevel } from './sound-model.js';
import { createQualityStepper } from './quality-step.js';
import { roadDirectionAt } from './roads.js';
import { bedAtArc, designSpeed, deviationOf, radiusOf } from './road-bed.js';
import { addBuilding, createBuildingMesh, KIND } from './building-mesh.js';
import { computeTileNodes, buildTileMesh, meshHeightAt } from './tile-mesh.js';
import { leafAt, selectTiles } from './quadtree.js';
import { createRng } from './noise.js';
import { WORLD, QUADTREE, CAMERA, PORTAL, TRAM, CAR, ROAD, QUALITY } from './config.js';
import { createTramNetwork } from './tram-network.js';
import { createTramSim } from './tram-sim.js';
import { placeStreetLights } from './street-lights.js';
import { placeParkBenches } from './park-benches.js';
import { createPropCollider } from './props.js';
import { WALL, WALL_DRAW_FACTOR, findRamp, wallQuads, rampTolerance, createWallFootprint } from './retaining-walls.js';
import { JUNCTION, junctionClusters, driveLine } from './junction-probe.js';
import { runBridgeChecks } from './harness-bridges.js';          // section N (bridges7)
import { runTunnelChecks } from './harness-tunnels.js';          // section O (bridges8)
import { runRoads9Checks } from './harness-roads9.js';           // section P (roads9)
import { runMarkingChecks } from './marking-checks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const args = new Set(process.argv.slice(2));
const QUICK = args.has('--quick');
const VERBOSE = args.has('--verbose');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);   // --only=I,J: just those sections (the others cost two minutes)
const wants = (id) => ONLY.length === 0 || ONLY.includes(id);
const J_SAMPLES = Number((process.argv.find((a) => a.startsWith('--j-samples=')) || '').slice(12)) || 0;   // --j-samples=200: more random places for gate J (the default is 24 per quality, 6 with --quick)

const results = { pass: 0, fail: 0, failures: [] };
const stats = {};
/** Records one check.  `ok` may be a number: a count that has to be zero. */
function check(name, ok, detail = '') {
  const good = typeof ok === 'number' ? ok === 0 : !!ok;
  if (good) { results.pass++; if (VERBOSE) console.log('  ok  ', name, detail); return; }
  results.fail++;
  results.failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
  console.log('  FAIL', name, detail);
}
const section = (title) => console.log(`\n== ${title}`);
const t0 = Date.now();

const read = async (name) => new Uint8Array(fs.readFileSync(path.join(DATA, name)));
const data = await loadWorldData(read);          // the checksums are verified inside: a mismatch throws
const area = JSON.parse(fs.readFileSync(path.join(DATA, 'area.json'), 'utf8'));

const field = createHeightField({ near: data.near, far: data.far, roads: data.roads, decks: data.decks });
const surface = createSurface(field);
const deckNetwork = createDeckNetwork(fixLandmarkDecks(data.decks, (x, z) => surface.height(x, z)), surface);
const ground = createGround(surface, deckNetwork);
const landmarks = createLandmarks({ buildings: data.buildings, decks: deckNetwork.decks, ground: (x, z) => surface.height(x, z), roads: data.roads });
const buildings = createBuildingIndex(data.buildings, { hidden: landmarks.hiddenBuildings });
const playArea = createPlayArea(area);
const portals = createPortals(data.roads, (x, z) => surface.height(x, z), (r) => field.network.isDrawn(r.id), (x, z) => playArea.inside(x, z), portalRoadAt(field.network), portalBlocked(buildings, deckNetwork));
const maps = buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy, buildings: data.buildings });
const treeDecks = createDeckNetwork([...ground.decks, ...landmarks.footprints]);      // the same trees as the game plants (main.js)
const bakedTrees = keepWaysClear(data.trees, { network: field.network, field, treeDecks, treeFree: landmarks.treeFree });
const forest = createTreeIndex({ map: maps, field, network: field.network, buildings, trees: bakedTrees, clearings: landmarks.clearings, treeDecks });
const net = field.network;

/* ---------------------------------------------------------------- shared: where the carved ways meet (gates I and J) */
const GC = 32, gk = (a, b) => a * 4096 + b, segGrid = new Map();
for (const ch of net.chains) for (let i = 1; i < ch.x.length; i++) {
  const x0 = Math.floor(Math.min(ch.x[i - 1], ch.x[i]) / GC), x1 = Math.floor(Math.max(ch.x[i - 1], ch.x[i]) / GC);
  const z0 = Math.floor(Math.min(ch.z[i - 1], ch.z[i]) / GC), z1 = Math.floor(Math.max(ch.z[i - 1], ch.z[i]) / GC);
  for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = gk(a, b); const l = segGrid.get(k); if (l) l.push(ch, i); else segGrid.set(k, [ch, i]); }
}
/** A junction apron: the point lies on or beside the carriageway + pavement (+ 3 m) of another carved way, where the two surfaces are
 *  blended on purpose; or under a way that rides over it (the ground there is the DTM). */
const JUNCTION_MARGIN = 3;
function inJunction(roadIndexOf, x, z) {
  if (net.protection(x, z) > 0) return true;
  const cx = Math.floor(x / GC), cz = Math.floor(z / GC);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = segGrid.get(gk(cx + a, cz + b));
    if (!l) continue;
    for (let q = 0; q < l.length; q += 2) {
      const o = l[q], j = l[q + 1];
      if (o.road === roadIndexOf) continue;
      const ax = o.x[j - 1], az = o.z[j - 1], ex = o.x[j] - ax, ez = o.z[j] - az, ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < net.info[o.road].a0 + JUNCTION_MARGIN) return true;
    }
  }
  return false;
}
/** Another carved way (or a way that rides over) has its centre line within `reach` of the point. */
function nearOtherWay(roadIndexOf, x, z, reach) {
  const cx = Math.floor(x / GC), cz = Math.floor(z / GC), cells = Math.ceil(reach / GC);
  for (let a = -cells; a <= cells; a++) for (let b = -cells; b <= cells; b++) {
    const l = segGrid.get(gk(cx + a, cz + b));
    if (!l) continue;
    for (let q = 0; q < l.length; q += 2) {
      const o = l[q], j = l[q + 1];
      if (o.road === roadIndexOf) continue;
      const ax = o.x[j - 1], az = o.z[j - 1], ex = o.x[j] - ax, ez = o.z[j] - az, ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < reach) return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------- A: the data */
if (wants('A')) {
  section('A data');
  const finite = (arr) => { for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return i; return -1; };
  check('the near terrain grid is finite', finite(data.near.data) < 0);
  check('the far terrain grid is finite', finite(data.far.data) < 0);
  check('the near grid has the expected size',
    data.near.nx === WORLD.width / WORLD.nearStep + 1 && data.near.nz === WORLD.depth / WORLD.nearStep + 1,
    `${data.near.nx}x${data.near.nz}`);
  check('the far grid covers the box and its margin',
    data.far.nx === (WORLD.width + 2 * WORLD.farMargin) / WORLD.farStep + 1 &&
    data.far.nz === (WORLD.depth + 2 * WORLD.farMargin) / WORLD.farStep + 1,
    `${data.far.nx}x${data.far.nz}`);
  // no single node that is a pit or a peak: the baker clips the spikes, nothing may be left
  const { nx, nz, data: h } = data.near;
  const SPIKE = 3.0;
  let spikes = 0, worst = 0;
  for (let j = 1; j < nz - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const v = h[j * nx + i];
      const lo = Math.min(h[j * nx + i - 1], h[j * nx + i + 1], h[(j - 1) * nx + i], h[(j + 1) * nx + i]);
      const hi = Math.max(h[j * nx + i - 1], h[j * nx + i + 1], h[(j - 1) * nx + i], h[(j + 1) * nx + i]);
      const d = Math.max(lo - v, v - hi);
      if (d > worst) worst = d;
      if (d > SPIKE) spikes++;
    }
  }
  stats.worstSpike = worst;
  check(`no single node pit or peak above ${SPIKE} m in the terrain`, spikes === 0, `${spikes} nodes, worst ${worst.toFixed(2)} m`);
  check('the canopy grids are finite', finite(data.canopy.height.data) < 0 && finite(data.canopy.cover.data) < 0);
  check('the roads decode', data.roads.length > 1000, `${data.roads.length} ways`);
  check('the buildings decode', data.buildings.length > 1000, `${data.buildings.length} buildings`);
  check('the decks decode', data.decks.length > 10, `${data.decks.length} decks`);
  check('the trees decode', data.trees.length > 1000, `${data.trees.length} trees`);
  let outside = 0;
  for (const r of data.roads) for (const [x, z] of r.pts) if (x < -200 || z < -200 || x > WORLD.width + 200 || z > WORLD.depth + 200) outside++;
  check('the road points lie inside the world (+200 m)', outside === 0, `${outside} outside`);
  // the height function is finite everywhere, also far outside the box
  const rng = createRng(11);
  let bad = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -WORLD.farMargin - 3000 + rng() * (WORLD.width + 2 * WORLD.farMargin + 6000);
    const z = -WORLD.farMargin - 3000 + rng() * (WORLD.depth + 2 * WORLD.farMargin + 6000);
    if (!Number.isFinite(field.height(x, z))) bad++;
  }
  check('height(x, z) is finite everywhere (also 3 km beyond the far field)', bad === 0, `${bad} bad`);
  // the budget of the brief: all the shipped data in 30 MB
  let bytes = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size;
    }
  };
  walk(DATA);
  stats.dataBytes = bytes;
  check('the shipped data fits the budget of the brief (30 MB)', bytes <= 30 * 1024 * 1024, `${(bytes / 1048576).toFixed(2)} MB`);
}

/* ---------------------------------------------------------------- B: the roads */
if (wants('B')) {
  section('B roads');
  // ---- no road to nowhere: a way that ends in the area meets another way.
  // The bake clips the ways to the area (the two communes and their 300 m buffer), so a way that leaves the
  // area ends on the clip: that is not a road to nowhere, it is the edge of the world.  Every other end must meet
  // another way (of any class: a street may end at a footpath, and the probe checks that against OSM).
  const END_TOL = 3.0;
  const CLIP_TOL = 12.0;                    // m, an end this close to the border of the area is on the clip
  const ends = [];
  for (const r of data.roads) {
    if (!r.info.drivable) continue;
    ends.push({ road: r, x: r.pts[0][0], z: r.pts[0][1] });
    const last = r.pts[r.pts.length - 1];
    ends.push({ road: r, x: last[0], z: last[1] });
  }
  const CELL = 64;
  const key = (cx, cz) => cx * 100003 + cz;
  const buckets = new Map();
  for (const e of ends) {
    const k = key(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    const list = buckets.get(k);
    if (list) list.push(e); else buckets.set(k, [e]);
  }
  const nearEnds = (x, z, radius) => {
    const out = [];
    const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
    const d0 = Math.floor((z - radius) / CELL), d1 = Math.floor((z + radius) / CELL);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = d0; cz <= d1; cz++) {
        for (const e of (buckets.get(key(cx, cz)) || [])) out.push(e);
      }
    }
    return out;
  };
  // every way of the bake (also the paths) is a place where an end may meet somebody
  const anyWay = [];
  for (const r of data.roads) for (const p of r.pts) anyWay.push(p);
  const meetsAWay = (x, z) => {
    for (const e of nearEnds(x, z, END_TOL)) {
      if (e.road.info.drivable) continue;                  // only a way of another class counts
      if (Math.hypot(e.x - x, e.z - z) <= END_TOL) return true;
    }
    // a way that runs past the end (a T junction onto a longer way) counts too
    for (const p of anyWay) {
      if (Math.abs(p[0] - x) > END_TOL || Math.abs(p[1] - z) > END_TOL) continue;
      if (Math.hypot(p[0] - x, p[1] - z) <= END_TOL) return true;
    }
    return false;
  };
  // the border of the area: the outer ring of the play area is the clip of the bake
  const ring = playArea.rings[0].pts;
  const nearClip = (x, z) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const ax = ring[i][0], az = ring[i][1];
      const bx = ring[(i + 1) % n][0], bz = ring[(i + 1) % n][1];
      const ex = bx - ax, ez = bz - az;
      const ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - (ax + ex * t), z - (az + ez * t)) <= CLIP_TOL) return true;
    }
    return false;
  };
  let nowhere = 0, border = 0;
  const worstNowhere = [];
  for (const e of ends) {
    // an end on the clip of the area is the edge of the world, not a road to nowhere
    if (nearClip(e.x, e.z)) { border++; continue; }
    if (meetsAWay(e.x, e.z)) continue;
    nowhere++;
    if (worstNowhere.length < 8) worstNowhere.push({ name: e.road.name || e.road.kind, x: Math.round(e.x), z: Math.round(e.z) });
  }
  stats.roadEnds = ends.length;
  stats.roadEndsNowhere = nowhere;
  check('no road ends in nowhere (every way that ends in the area meets another way)', nowhere === 0,
    `${nowhere} of ${ends.length} ends meet nobody${worstNowhere.length ? ' ' + JSON.stringify(worstNowhere) : ''}`);
  stats.roadEndsAtBorder = border;
  check('the roads reach the border of the area (the clip of the bake)', border > 0, `${border} ends on the clip`);

  // ---- no car on the rails: a railway that has its own corridor may not carry a road at its own level.
  // The tram runs in the street (its lines are marked inStreet): that is a tram line, not a railway.
  const rails = data.lines.filter((l) => !l.inStreet);
  let railRuns = 0;
  const railReport = [];
  const railScratch = { road: -1, index: 0, lat: 0, dist: 0, coverage: 0, kind: 0 };
  for (const line of rails) {
    let run = 0;
    for (let i = 0; i + 1 < line.pts.length; i += 2) {
      const x = line.pts[i], z = line.pts[i + 1];
      // the road whose centre line runs along the rails: a level crossing is one or two points long, a road
      // that really runs on the rails is a long stretch of them
      let on = false;
      for (const r of net.roads) {
        if (!r.info.drivable || r.tunnel || r.bridge || r.over) continue;
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const ax = r.pts[k][0], az = r.pts[k][1], bx = r.pts[k + 1][0], bz = r.pts[k + 1][1];
          const ex = bx - ax, ez = bz - az;
          const ll = ex * ex + ez * ez;
          if (ll < 1e-9) continue;
          let t = ((x - ax) * ex + (z - az) * ez) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
          if (d < 2.5) { on = true; break; }
        }
        if (on) break;
      }
      if (on) {
        run++;
        if (railReport.length < 6) railReport.push({ x: Math.round(x), z: Math.round(z) });
      } else {
        if (run >= 3) railRuns++;
        run = 0;
      }
    }
    if (run >= 3) railRuns++;
  }
  stats.railRunsOnRoads = railRuns;
  check('no car drives on the rails', railRuns === 0,
    `${railRuns} stretches of railway carry a road at the same level${railReport.length ? ' ' + JSON.stringify(railReport) : ''}`);

  // ---- the painted tarmac follows the real width of the carriageway (the reviewer's first complaint:
  // the roads were blobs far too wide).  The paint is measured on the carve itself: the asphalt is the ground
  // whose road is this road and whose offset from the centre line is inside the half width of the carriageway.
  //
  // The band of tarmac around a sample is measured outwards in both directions, and it is only good where the
  // paint ENDS at the edge of the ribbon of this way.  Two places say nothing about the width of the way:
  // where a neighbour takes the paint over (a junction, or the second carriageway of a divided road), and
  // where the walk runs along the road instead of across it (the corner of a loop).  The width of the way is
  // the MEDIAN of the good bands.
  //
  // A closed way (a square, or a street that loops) is an AREA: the paint covers the ground inside it, so the
  // band there is the width of the area as well.  Its reference is the width of the way plus the width of the
  // area it encloses (the width of a disc of the same area), and the paint may not be narrower than the way.
  const s = net.samples;
  let tooWide = 0, tooNarrow = 0, worstWide = 0, worstNarrow = 0;
  const rng = createRng(77);
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0, surface: 0 };
  let measured = 0, notMeasured = 0, closedWays = 0;
  const PAINT_WALK = 30;                       // m: the paint of a road longer than this is a blob
  /** The band of tarmac around a sample.  -1 when the paint does not end at the edge of the ribbon. */
  const paintBand = (ri, i) => {
    const first = s.first[ri], count = s.segs[ri];
    const ax = s.x[Math.max(first, i - 1)], az = s.z[Math.max(first, i - 1)];
    const bx = s.x[Math.min(first + count - 1, i + 1)], bz = s.z[Math.min(first + count - 1, i + 1)];
    const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez) || 1;
    const nx = -ez / len, nz = ex / len;
    const x = s.x[i], z = s.z[i];
    const walk = (sign) => {
      let last = 0;
      for (let d = 0.25; d <= PAINT_WALK; d += 0.25) {
        surface.roadInfoAt(x + nx * d * sign, z + nz * d * sign, info);
        if (info.road !== ri) return -1;                 // a neighbour took the paint over
        if (Math.abs(info.lat) > info.hw) return last;   // the edge of the ribbon of this way
        last = d;
      }
      return -2;                                          // the paint runs on: the way is a blob
    };
    const up = walk(1), down = walk(-1);
    if (up === -2 || down === -2) return -2;
    if (up < 0 || down < 0) return -1;
    return up + down;
  };
  /** The area of the polygon a closed way encloses (the shoelace formula). */
  const enclosedArea = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  };
  const order = [];
  for (let i = 0; i < net.roads.length; i++) order.push(i);
  for (let k = 0; k < order.length; k++) {
    const j = (k * 7919 + 13) % order.length;                 // a walk over every road, shuffled
    const ri = order[j];
    const r = net.roads[ri];
    if (!r.info.drivable || r.tunnel || r.bridge || r.over) continue;
    if (r.width < 3 || r.width > 20) continue;
    const first = s.first[ri], count = s.segs[ri];
    if (count < 4) continue;
    // the width of the area a closed way encloses: the diameter of the disc of the same area
    const raw = data.roads[ri].pts;
    const closed = raw.length > 2
      && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 12;
    const areaW = closed ? 2 * Math.sqrt(enclosedArea(raw) / Math.PI) : 0;
    if (closed) closedWays++;
    const bands = [];
    for (let i = first; i < first + count; i += 2) {         // every other sample: 8 m apart
      const b = paintBand(ri, i);
      // (roads9: where the carriageway tapers to the next way of its chain - a lane added or dropped, 1 : 12 - the design width there is the tapered one; measured against it)
      const taper = net.taperDhw && net.taperDhw[ri] ? 2 * net.taperDhw[ri][i - first] : 0;
      if (b > 0) bands.push(b - taper);
    }
    if (!bands.length) { notMeasured++; continue; }
    bands.sort((a, b) => a - b);
    const painted = bands[Math.floor(bands.length / 2)];
    measured++;
    const over = painted - (r.width + areaW);
    if (over > 1.5) { tooWide++; worstWide = Math.max(worstWide, over); }
    else if (painted - r.width < -1.5) { tooNarrow++; worstNarrow = Math.min(worstNarrow, painted - r.width); }
  }
  stats.paintTooWide = tooWide;
  stats.paintTooNarrow = tooNarrow;
  stats.paintMeasured = measured;
  stats.paintNotMeasured = notMeasured;
  stats.paintClosedWays = closedWays;
  check('the painted tarmac is not wider than the carriageway of OSM', tooWide === 0,
    `${tooWide} of ${measured} roads paint more than 1.5 m too wide (worst ${worstWide.toFixed(2)} m)`);
  check('the painted tarmac is not narrower than the carriageway of OSM', tooNarrow === 0,
    `${tooNarrow} of ${measured} roads paint more than 1.5 m too narrow (worst ${worstNarrow.toFixed(2)} m)`);
  check('the paint of every road can be measured', notMeasured * 4 < measured,
    `${notMeasured} ways have no place where the paint can be measured (the paint of a neighbour covers them), ${closedWays} of them enclose an area`);
}

/* ---------------------------------------------------------------- C: the city */
if (wants('C')) {
  section('C city');
  // The base of a house: the mesh of the house is built here, exactly as the browser builds it, and every point
  // of the bottom of its walls is compared with the ground under it.  A house that hangs over a slope (its base
  // more than 0.3 m above the ground) or that the hill eats (more than 1 m below the ground) is a failure.
  const heightAt = (x, z) => field.height(x, z);
  const landAt = (x, z) => field.baseHeight(x, z);
  let floating = 0, buried = 0, worstFloating = 0, worstBuried = 0, inverted = 0;
  const step = QUICK ? 4 : 1;                                // every n-th building
  let houses = 0;
  for (let i = 0; i < data.buildings.length; i += step) {
    const b = data.buildings[i];
    const n = b.pts.length / 2;
    if (n < 3) continue;
    houses++;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += b.pts[k * 2]; cz += b.pts[k * 2 + 1]; }
    cx /= n; cz /= n;
    // The eaves of the house: on the ground the player sees (the same rule as the mesh of the house), so a
    // house beside a road on an embankment does not sink into it.
    const eaveY = Math.max(landAt(cx, cz), heightAt(cx, cz)) + b.eave;
    // the ground may not climb over the eaves: the wall would be drawn upside down
    for (let k = 0; k < n; k++) {
      const g = heightAt(b.pts[k * 2], b.pts[k * 2 + 1]);
      if (g > eaveY) inverted++;
    }
    const mesh = createBuildingMesh();
    addBuilding(mesh, b, heightAt, landAt);
    for (let v = 0; v < mesh.pos.length / 3; v++) {
      if (mesh.info[v * 4 + 2] !== KIND.wall) continue;
      if (mesh.info[v * 4 + 1] > 0.001) continue;             // only the bottom of a wall
      const x = mesh.pos[v * 3], y = mesh.pos[v * 3 + 1], z = mesh.pos[v * 3 + 2];
      const g = heightAt(x, z);
      if (y - g > 0.3) { floating++; worstFloating = Math.max(worstFloating, y - g); }
      if (g - y > 1.0) { buried++; worstBuried = Math.max(worstBuried, g - y); }
    }
  }
  stats.houses = houses;
  stats.buildingsFloating = floating;
  stats.buildingsBuried = buried;
  check('no house stands on stilts (its base more than 0.3 m above the ground)', floating === 0,
    `${floating} points of the base of ${houses} houses, worst ${worstFloating.toFixed(2)} m`);
  check('no house is cut into the hill (its base more than 1 m under the ground)', buried === 0,
    `${buried} points of the base of ${houses} houses, worst ${worstBuried.toFixed(2)} m`);
  check('no wall of a house is drawn upside down', inverted === 0, `${inverted} corners`);

  // no house inside another house
  const insideOf = (poly, px, pz) => {
    let hit = false;
    const q = poly.length / 2;
    for (let k = 0, j = q - 1; k < q; j = k++) {
      const xi = poly[k * 2], zi = poly[k * 2 + 1], xj = poly[j * 2], zj = poly[j * 2 + 1];
      if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  let inside = 0;
  for (const b of data.buildings) {
    const n = b.pts.length / 2;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += b.pts[k * 2]; cz += b.pts[k * 2 + 1]; }
    cx /= n; cz /= n;
    for (const id of buildings.near(cx, cz, 40)) {
      if (id === b.id) continue;
      const o = data.buildings[id];
      const m = o.pts.length / 2;
      let ox = 0, oz = 0;
      for (let k = 0; k < m; k++) { ox += o.pts[k * 2]; oz += o.pts[k * 2 + 1]; }
      ox /= m; oz /= m;
      if (Math.hypot(ox - cx, oz - cz) > 30) continue;
      if (insideOf(o.pts, cx, cz) || insideOf(b.pts, ox, oz)) inside++;
    }
  }
  stats.housesInsideHouses = inside;
  check('no house stands inside another house', inside === 0, `${inside} pairs`);

  // No road runs through a house: the centre line of a way must not cross a footprint.  The centre line may
  // graze the wall of a house (the OSM and the LOD2 do not agree on the exact edge of the street), but it may
  // not run through the middle of it: the car would drive into the wall.
  const depthIn = (poly, px, pz) => {
    const q = poly.length / 2;
    let inside = false, best = Infinity;
    for (let k = 0, j = q - 1; k < q; j = k++) {
      const xi = poly[k * 2], zi = poly[k * 2 + 1], xj = poly[j * 2], zj = poly[j * 2 + 1];
      if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
      const ex = xj - xi, ez = zj - zi;
      const ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((px - xi) * ex + (pz - zi) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(px - (xi + ex * t), pz - (zi + ez * t)));
    }
    return inside ? best : -best;
  };
  const THROUGH = 3.0;                                       // m, how deep the road may cut into a house
  const throughHouses = new Set();
  const throughList = [];
  for (const r of data.roads) {
    if (!r.info.drivable || r.tunnel) continue;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const ax = r.pts[k][0], az = r.pts[k][1], bx = r.pts[k + 1][0], bz = r.pts[k + 1][1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps;
        for (const id of buildings.near(x, z, 30)) {
          const b = data.buildings[id];
          if (depthIn(b.pts, x, z) < THROUGH) continue;
          if (throughHouses.has(id)) break;
          throughHouses.add(id);
          if (throughList.length < 6) throughList.push({ name: r.name || r.kind, x: Math.round(x), z: Math.round(z), house: id });
          break;
        }
      }
    }
  }
  const through = throughHouses.size;
  stats.roadsThroughHouses = through;
  check('no road runs through a house', through === 0,
    `${through} houses have a road through them${throughList.length ? ' ' + JSON.stringify(throughList) : ''}`);
}

/* ---------------------------------------------------------------- D: the decks */
if (wants('D')) {
  section('D decks');
  // Every deck stands on a way that rides over the others: a deck far from any bridge road is wrong (the reviewer
  // saw small dark boxes floating near the roads).
  const overRoads = data.roads.filter((r) => (r.over || r.bridge) && !r.tunnel);
  const decks = deckNetwork.decks;                 // the decks the game draws: their ends stand on the ground
  let orphan = 0;
  const orphanList = [];
  for (const d of decks) {
    let best = Infinity;
    const mid = d.pts[d.pts.length >> 1];            // the middle: the ends of a landmark bridge are carried on to the approach road (fixLandmarkDecks), which does not ride over anything
    for (const r of overRoads) {
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const ax = r.pts[k][0], az = r.pts[k][1], bx = r.pts[k + 1][0], bz = r.pts[k + 1][1];
        const ex = bx - ax, ez = bz - az;
        const ll = ex * ex + ez * ez;
        if (ll < 1e-9) continue;
        let t = ((mid[0] - ax) * ex + (mid[1] - az) * ez) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = Math.min(best, Math.hypot(mid[0] - (ax + ex * t), mid[1] - (az + ez * t)));
      }
    }
    if (best > 6) { orphan++; if (orphanList.length < 6) orphanList.push({ x: Math.round(mid[0]), z: Math.round(mid[1]), near: +best.toFixed(1) }); }
  }
  stats.deckOrphans = orphan;
  check('every deck stands on a way that rides over the others', orphan === 0,
    `${orphan} of ${decks.length} decks${orphanList.length ? ' ' + JSON.stringify(orphanList) : ''}`);

  // The ends of the decks that meet one another (one bridge in pieces, a joint): every piece ends at the same level there.  A joint is not an end of the bridge: it hangs over the valley
  // with the bridge (before, the pieces were pinned to the valley floor under the joint: 16 m spikes at Rue de Neudorf), so it is checked as a joint below, not for the ground.
  const deckEndList = [];
  for (const d of decks) if (d.pts.length > 1) deckEndList.push({ d, k: 0, j: 1 }, { d, k: d.pts.length - 1, j: d.pts.length - 2 });
  // (a ring's two ends meet each other: its closing point is a joint with itself, not an end - bridges7, deck 33 over the Kirchberg interchange)
  const jointOf = (e) => (landmarks.hiddenDecks.has(e.d.id) ? [] : deckEndList.filter((o) => (o.d !== e.d || o.k !== e.k) && !landmarks.hiddenDecks.has(o.d.id) && Math.hypot(o.d.pts[o.k][0] - e.d.pts[e.k][0], o.d.pts[o.k][1] - e.d.pts[e.k][1]) <= DECK.joinTolerance));
  const isJoint = (e) => { const others = jointOf(e); return others.length > 0 && others.every((o) => Math.abs(o.d.tops[o.k] - e.d.tops[e.k]) <= 0.05); };

  // The deck meets the ground at its two ends: it is pinned to the approach road, not floating in the air.
  let floating = 0, worst = 0;
  const floatList = [];
  for (const d of decks) {
    for (const i of [0, d.pts.length - 1]) {
      if (d.pts.length > 1 && isJoint({ d, k: i })) continue;
      const x = d.pts[i][0], z = d.pts[i][1];
      const gap = d.tops[i] - field.height(x, z);
      if (Math.abs(gap) > 1.5) {
        floating++;
        worst = Math.max(worst, Math.abs(gap));
        if (floatList.length < 6) floatList.push({ x: Math.round(x), z: Math.round(z), gap: +gap.toFixed(2) });
      }
    }
  }
  stats.deckEndsFloating = floating;
  check('the ends of every deck reach the ground (no deck floats)', floating === 0,
    `${floating} ends, worst ${worst.toFixed(2)} m${floatList.length ? ' ' + JSON.stringify(floatList) : ''}`);

  // A deck crosses a valley, it does not dive into it.
  let through = 0, worstThrough = 0;
  for (const d of decks) {
    for (let i = 0; i < d.pts.length; i++) {
      const x = d.pts[i][0], z = d.pts[i][1];
      const g = field.height(x, z);
      if (d.tops[i] < g - 0.6) { through++; worstThrough = Math.max(worstThrough, g - d.tops[i]); }
    }
  }
  stats.deckDiving = through;
  check('no deck dives into the ground', through === 0, `${through} points, worst ${worstThrough.toFixed(2)} m`);

  // Every road runs flush onto its deck (Rue de Neudorf: the decks started 2 m above the approach road with a vertical face).  At every end of a deck where a carved way runs onto it
  // (its end within DECK.approachJoin, leaving it toward the deck): the deck starts at the road the car drives on (step <= 5 cm), the road does not sag before the bridge (its surface
  // over the last 16 m within 0.3 m of its bed), and the first metres of a carriageway deck never climb or fall faster than a steep street (no face).  The joints of a bridge in pieces
  // lie at the level of the bridge (within the end grade of the pieces' own first points), not at the valley floor.
  {
    const MAX_STEP = 0.05, MAX_SAG = 0.3, MAX_FIRST_GRADE = 0.2, APPROACH_RUN = 16;
    let approaches = 0, steps = 0, worstStep = 0, sags = 0, worstSag = 0, faces = 0, worstGrade = 0, joints = 0, badJoints = 0;
    const list = [];
    for (const e of deckEndList) {
      if (landmarks.hiddenDecks.has(e.d.id)) continue;                 // (the landmark models meet their roads themselves)
      const p = e.d.pts[e.k], q = e.d.pts[e.j];
      const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const inX = (q[0] - p[0]) / l1, inZ = (q[1] - p[1]) / l1;
      const grade = (e.d.tops[e.j] - e.d.tops[e.k]) / l1;
      let any = false;
      for (const c of net.chains) {
        if (net.overRoads.has(c.road) || c.x.length < 2) continue;
        for (const [a, b] of [[0, 1], [c.x.length - 1, c.x.length - 2]]) {
          if (Math.hypot(c.x[a] - p[0], c.z[a] - p[1]) > DECK.approachJoin) continue;
          const ux = c.x[a] - c.x[b], uz = c.z[a] - c.z[b], ul = Math.hypot(ux, uz) || 1;
          if ((ux * inX + uz * inZ) / ul < DECK.approachAlign) continue;  // (a way that only ends near the deck, at an angle, does not run onto it)
          any = true; approaches++;
          const step = Math.abs(e.d.tops[e.k] - surface.height(p[0], p[1]));
          let sag = 0;
          for (let i = a, run = 0; i >= 0 && i < c.x.length && run <= APPROACH_RUN; i += a === 0 ? 1 : -1, run = Math.abs(c.arc[i] - c.arc[a])) sag = Math.max(sag, Math.abs(surface.height(c.x[i], c.z[i]) - c.bed[i]));
          if (step > MAX_STEP) steps++;
          if (sag > MAX_SAG) sags++;
          worstStep = Math.max(worstStep, step); worstSag = Math.max(worstSag, sag);
          if (step > MAX_STEP || sag > MAX_SAG) if (list.length < 6) list.push({ id: e.d.id, x: Math.round(p[0]), z: Math.round(p[1]), step: +step.toFixed(3), sag: +sag.toFixed(2) });
        }
      }
      if (any && e.d.width >= 5) {
        worstGrade = Math.max(worstGrade, Math.abs(grade));
        if (Math.abs(grade) > MAX_FIRST_GRADE) { faces++; if (list.length < 6) list.push({ id: e.d.id, x: Math.round(p[0]), z: Math.round(p[1]), grade: +grade.toFixed(2) }); }
      }
      if (!any && jointOf(e).length) {
        joints++;
        // the pieces end at one level, and that level is the level of the bridge: within a metre of where the first two points of every piece lead (the DSM of the bake: the valley floor
        // under the joint is metres below it)
        const lead = (o) => { const n = o.d.pts.length; if (n < 3) return o.d.tops[o.j]; const j2 = o.k === 0 ? 2 : n - 3; const a = o.d.pts[o.j], b = o.d.pts[j2], c0 = o.d.pts[o.k];
          const g = (o.d.tops[o.j] - o.d.tops[j2]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1); return o.d.tops[o.j] + Math.max(-DECK.endGrade, Math.min(DECK.endGrade, g)) * Math.hypot(a[0] - c0[0], a[1] - c0[1]); };
        const pieces = [e, ...jointOf(e)];
        const level = pieces.reduce((sum, o) => sum + lead(o), 0) / pieces.length;
        if (!isJoint(e) || Math.abs(e.d.tops[e.k] - level) > 1.0) { badJoints++; if (list.length < 6) list.push({ joint: e.d.id, x: Math.round(p[0]), z: Math.round(p[1]), off: +(e.d.tops[e.k] - level).toFixed(2) }); }
      }
    }
    stats.deckApproach = { approaches, steps, worstStep: +worstStep.toFixed(3), sags, worstSag: +worstSag.toFixed(2), faces, worstGrade: +worstGrade.toFixed(2), joints, badJoints };
    check(`every road runs flush onto its deck (step <= ${MAX_STEP * 100} cm, approach sag <= ${MAX_SAG} m, carriageway deck start <= ${MAX_FIRST_GRADE * 100} %, joints at deck level)`,
      steps === 0 && sags === 0 && faces === 0 && badJoints === 0,
      `${approaches} approaches: steps ${steps} (worst ${(worstStep * 100).toFixed(1)} cm), sags ${sags} (worst ${worstSag.toFixed(2)} m), faces ${faces} (worst ${(worstGrade * 100).toFixed(0)} %), joints ${badJoints} of ${joints} off ${JSON.stringify(list)}`);
  }

  // The ground under a bridge is the ground: no road may cut a pit under the deck (the reviewer's overpass = pit).
  // The ends of the deck are where the approach road is, and a road on an embankment has the land beside it:
  // that is the bench of the road, not a pit, so the ends are not measured.
  // (the street that runs onto a bridge continues the gradient of the street and does not follow the valley edge, designBed; the original limit of 1.0 m)
  const MAX_PIT = 1.0;
  let pits = 0, worstPit = 0;
  for (const d of decks) {
    for (let i = 1; i < d.pts.length - 1; i++) {
      const x = d.pts[i][0], z = d.pts[i][1];
      const land = field.baseHeight(x, z);
      const g = field.height(x, z);
      if (land - g > MAX_PIT) { pits++; worstPit = Math.max(worstPit, land - g); }
    }
  }
  stats.deckPits = pits;
  check('the ground under a bridge is the ground (no pit under a deck)', pits === 0,
    `${pits} points, worst ${worstPit.toFixed(2)} m`);

  // A deck is a bridge: it stands clear of the ground under it, it is not a slab on the ground.
  let flat = 0;
  for (const d of decks) {
    let clear = 0;
    for (let i = 0; i < d.pts.length; i++) {
      clear = Math.max(clear, d.tops[i] - field.baseHeight(d.pts[i][0], d.pts[i][1]));
    }
    if (clear < 0.5) flat++;
  }
  stats.decksOnTheGround = flat;
  check('no deck lies on the ground (every deck is a bridge)', flat === 0, `${flat} of ${decks.length} decks`);

  // The flag of the deck must match the land under it.  A deck that spans a dip in the land is drawn as a
  // slab over the dip (the valley shows under it); a deck over land that does not dip is drawn as a solid
  // wall of roadbed.  The bake decides this from the same dip, so the two must agree - otherwise the
  // bridge over the Alzette is a grey wedge from the valley floor up.
  let wrongFlag = 0;
  const flagList = [];
  for (const d of decks) {
    const n = d.pts.length;
    let lowest = Infinity;
    for (let i = 1; i < n - 1; i++) {
      lowest = Math.min(lowest, field.baseHeight(d.pts[i][0], d.pts[i][1]));
    }
    const endHigh = Math.max(field.baseHeight(d.pts[0][0], d.pts[0][1]),
      field.baseHeight(d.pts[n - 1][0], d.pts[n - 1][1]));
    const dip = n > 2 ? endHigh - lowest : 0;
    if (d.spans !== (dip >= DECK.spanDip)) {
      wrongFlag++;
      if (flagList.length < 6) flagList.push({ x: Math.round(d.pts[0][0]), z: Math.round(d.pts[0][1]), dip: +dip.toFixed(1), spans: d.spans });
    }
  }
  stats.deckFlags = wrongFlag;
  check('every deck knows whether it spans the land or stands on it', wrongFlag === 0,
    `${wrongFlag} of ${decks.length} decks${flagList.length ? ' ' + JSON.stringify(flagList) : ''}`);

  // A deck runs one way: no segment turns back on the one before (the Pont Rouge was carried on to its approach roads with the extension points in the wrong
  // order: the deck zigzagged over its own end, the model stopped short of it and the car drove over 12 m of invisible bridge).
  let folded = 0;
  const foldList = [];
  for (const d of decks) {
    if (d.width < 5) continue;                       // a footway deck may be a hairpin of a ramp (3.2 m wide); a carriageway is never
    for (let i = 1; i + 1 < d.pts.length; i++) {
      const ax = d.pts[i][0] - d.pts[i - 1][0], az = d.pts[i][1] - d.pts[i - 1][1];
      const bx = d.pts[i + 1][0] - d.pts[i][0], bz = d.pts[i + 1][1] - d.pts[i][1];
      if (ax * bx + az * bz < -0.5 * Math.hypot(ax, az) * Math.hypot(bx, bz)) {          // a turn of more than 120 degrees
        folded++;
        if (foldList.length < 6) foldList.push({ id: d.id, x: Math.round(d.pts[i][0]), z: Math.round(d.pts[i][1]) });
        break;
      }
    }
  }
  stats.decksFolded = folded;
  check('no deck folds back on itself', folded === 0, `${folded} of ${decks.length} decks ${JSON.stringify(foldList)}`);

  // A bridge the landmarks draw replaces its baked decks: every point of such a deck lies inside the model (no stretch of road the car drives and nobody sees).
  let uncovered = 0;
  const uncoveredList = [];
  for (const d of decks) {
    if (!landmarks.hiddenDecks.has(d.id)) continue;
    const sorted = Array.from(d.tops).sort((p, q) => p - q), median = sorted[sorted.length >> 1];
    // the pinned ends of a footway dip to the ground under them (a bake artefact the models ignore: passerelle.js): points more than 3 m under the median are not the bridge, and a deck that lies on the land (within 0.6 m of it) hides nothing
    const bad = d.pts.filter(([x, z], i) => d.tops[i] > median - 3 && d.tops[i] - surface.height(x, z) > 0.6 && !landmarks.list.some((m) => x >= m.bounds[0] - 0.5 && x <= m.bounds[2] + 0.5 && z >= m.bounds[1] - 0.5 && z <= m.bounds[3] + 0.5));
    if (bad.length) { uncovered++; uncoveredList.push({ id: d.id, points: bad.length, first: bad[0].map(Math.round) }); }
  }
  stats.hiddenDecksUncovered = uncovered;
  check('every deck a landmark model replaces lies inside that model (no invisible bridge)', uncovered === 0, JSON.stringify(uncoveredList));
  // A deck is a bridge OVER whatever lies under it: no slab lies on a carriageway at road level (the grey slabs across Escher Strooss).  Samples every 1.5 m, the approach (first and
  // last 8 m) left out; the decks a landmark replaces are not drawn.  scripts/luxdrive/bake_deck_fixes.mjs removes / splits the decks that fail this.
  {
    const { STEP, END_MARGIN, ON_ROAD_CLEAR, ROAD_SD } = DECK_ON_ROAD;
    const probe = { sdCar: 9, sdPave: 9 };
    let onRoad = 0;
    const roadList = [];
    for (const d of decks) {
      if (landmarks.hiddenDecks.has(d.id)) continue;
      const n = d.pts.length, cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]));
      let hits = 0, at = null;
      for (let i = 0; i < n - 1; i++) {
        const L = cum[i + 1] - cum[i], m = Math.max(1, Math.ceil(L / STEP));
        for (let k = 0; k < m; k++) {
          const f = k / m, s = cum[i] + L * f;
          if (s < END_MARGIN || s > cum[n - 1] - END_MARGIN) continue;
          const x = d.pts[i][0] + (d.pts[i + 1][0] - d.pts[i][0]) * f, z = d.pts[i][1] + (d.pts[i + 1][1] - d.pts[i][1]) * f;
          net.carve(x, z, probe);
          if (probe.sdCar < ROAD_SD && d.tops[i] + (d.tops[i + 1] - d.tops[i]) * f - surface.height(x, z) < ON_ROAD_CLEAR) { hits++; at = at || [Math.round(x), Math.round(z)]; }
        }
      }
      if (hits) { onRoad++; if (roadList.length < 6) roadList.push({ id: d.id, at, hits }); }
    }
    stats.decksOnCarriageway = onRoad;
    check('no deck lies on a carriageway at road level', onRoad === 0, `${onRoad} decks${roadList.length ? ' ' + JSON.stringify(roadList) : ''}`);
  }

  // A high deck stands on piers, never on a wall of roadbed: where the deck is 3+ m over the ground and a carriageway lies under it, no pier stands in the carriageway.
  {
    const probe = { sdCar: 9, sdPave: 9 };
    let inRoad = 0, piers = 0;
    for (const d of decks) {
      if (landmarks.hiddenDecks.has(d.id)) continue;
      for (const p of piersOf(d, surface, (x, z) => { net.carve(x, z, probe); return probe.sdCar; })) { piers++; net.carve(p.x, p.z, probe); if (probe.sdCar < 0) inRoad++; }
    }
    stats.deckPiers = piers;
    check('no bridge pier stands in a carriageway', inRoad === 0, `${inRoad} of ${piers} piers`);
  }
}

/* ---------------------------------------------------------------- D1: the landmarks */
if (wants('D1')) {
  section('D1 landmarks');
  // A landmark stands on the ground, floats nowhere and is not buried: its lowest face is under the land, its walls stand
  // where the land is, and the blocks it replaces are really gone from the collision.
  let floating = 0;
  for (const lm of landmarks.list) {
    if (lm.id.startsWith('pont-')) continue;      // a bridge spans a valley: its bounding box corners are not its feet (the decks gates above cover the bridges)
    // the lowest face relative to the land UNDER IT (not to the corners of the bounding box: a skin on a cliff or a ring on a slope has feet at different heights)
    let lowest = Infinity;
    for (let i = 0; i < lm.soup.pos.length; i += 3) lowest = Math.min(lowest, lm.soup.pos[i + 1] - field.height(lm.soup.pos[i], lm.soup.pos[i + 2]));
    if (lowest > 1.0) { floating++; console.log('  landmark above the ground:', lm.id, `lowest face ${lowest.toFixed(1)} m over the land under it`); }
  }
  check('no landmark floats (its lowest face reaches the ground)', floating === 0, `${floating} of ${landmarks.list.length}`);
  let ghost = 0;
  for (const id of landmarks.hiddenBuildings) if (buildings.near(data.buildings[id].pts[0], data.buildings[id].pts[1], 1).includes(id)) ghost++;
  check('the blocks a landmark replaces have no invisible collision left', ghost === 0, `${ghost} of ${landmarks.hiddenBuildings.size}`);
  // CAMPUS: Campus Geesseknäppchen has its own budget (60 000 triangles, at most 10 meshes, the models campus-*); the other landmarks keep theirs
  const isCampus = (l) => l.id.startsWith('campus-');
  const trisTotal = landmarks.list.filter((l) => !isCampus(l)).reduce((s, l) => s + l.soup.triangleCount, 0);
  const trisCampus = landmarks.list.filter(isCampus).reduce((s, l) => s + l.soup.triangleCount, 0);
  stats.landmarks = { count: landmarks.list.length, triangles: trisTotal, campusTriangles: trisCampus, hiddenBlocks: landmarks.hiddenBuildings.size };
  check('the landmarks stay inside the triangle budget (60 000)', trisTotal <= 60000, `${trisTotal}`);
  check('the campus stays inside its triangle budget (60 000, at most 10 meshes)', trisCampus <= 60000 && landmarks.list.filter(isCampus).length <= 10, `${trisCampus} in ${landmarks.list.filter(isCampus).length} meshes`);
}

/* ---------------------------------------------------------------- D2: the portals */
if (wants('D2')) {
  section('D2 portals');
  // Every portal stands on the ground: the headwall is buried under it and the mouth of the tunnel opens at
  // the level of the road that leads to it.  A wall that hangs in the air is the small dark box the
  // reviewer saw near the roads.
  //
  // The road that leads to the mouth ends up to seven metres before it, so the two levels differ by the
  // slope of the road: two metres of difference is a steep approach, more than that is a mouth in the air.
  const MAX_PORTAL_GAP = 2.0;
  let floating = 0, worst = 0;
  const floatList = [];
  for (const p of portals.list) {
    const y0 = ground.height(p.x, p.z);
    // the ground under the three points of the wall: the mouth and the two ends of it
    let lowest = y0;
    for (const s of [-1, 1]) {
      lowest = Math.min(lowest, ground.height(p.x + p.sx * p.half * s, p.z + p.sz * p.half * s));
    }
    // the wall is drawn from the base, which is under the lowest of them: it can never float
    const base = lowest - PORTAL.base;
    // the mouth must open at the level of the road that leads to it
    const approach = data.roads.find((r) => r.id === p.approach);
    let yRoad = y0;
    if (approach) {
      const ends = [approach.pts[0], approach.pts[approach.pts.length - 1]];
      let best = ends[0], bd = Infinity;
      for (const e of ends) {
        const d = Math.hypot(e[0] - p.x, e[1] - p.z);
        if (d < bd) { bd = d; best = e; }
      }
      yRoad = ground.height(best[0], best[1]);
    }
    const gap = Math.abs(y0 - yRoad);
    if (gap > MAX_PORTAL_GAP || base > y0) {
      floating++;
      worst = Math.max(worst, gap);
      if (floatList.length < 6) floatList.push({ name: p.name, x: Math.round(p.x), z: Math.round(p.z), gap: +gap.toFixed(2) });
    }
  }
  stats.portalsFloating = floating;
  check('every portal stands on the ground at the level of its road', floating === 0,
    `${floating} of ${portals.list.length} portals, worst ${worst.toFixed(2)} m${floatList.length ? ' ' + JSON.stringify(floatList) : ''}`);

  // The mouth of a tunnel is in the open: no house grows through the wall.
  let inHouse = 0;
  for (const p of portals.list) if (buildings.collide(p.x, p.z, 0)) inHouse++;
  stats.portalsInHouses = inHouse;
  check('no portal grows through a house', inHouse === 0, `${inHouse} of ${portals.list.length} portals`);
}

/* ---------------------------------------------------------------- E: the trees */
if (wants('E')) {
  section('E trees');
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0, surface: 0 };
  let inHouse = 0, onRoad = 0, worstOnRoad = 0;
  for (const t of data.trees) {
    if (buildings.collide(t.x, t.z, 0.2)) inHouse++;
    // A tree may stand on the pavement of a street, but not in the carriageway.  The test is the EXACT
    // distance from the tree to the centre line of the way, not the value the 1 m lattice holds at the
    // node of the tree: the node lies up to a metre and a half away from the tree, and a tree that stands
    // half a metre outside the kerb is on the pavement, not in the road.
    net.carve(t.x, t.z, net.scratch);
    const s = net.scratch;
    if (s.road >= 0 && s.dist <= s.hw) {
      onRoad++;
      worstOnRoad = Math.max(worstOnRoad, t.height);
    }
  }
  stats.treesInHouses = inHouse;
  stats.treesOnTheRoad = onRoad;
  check('no tree stands inside a house', inHouse === 0, `${inHouse} of ${data.trees.length}`);
  check('no tree stands in the carriageway of a road', onRoad === 0, `${onRoad} of ${data.trees.length}`);

  // No tree on a bridge, through its slab or with its crown over it: brute force over EVERY deck segment and every landmark bridge footprint (not the spatial hash
  // the game uses), for the trees of OSM and for the woods around every bridge.
  const allDecks = [...ground.decks, ...landmarks.footprints];
  const treeOnDeck = (x, z, y0, y1, radius) => {
    for (const d of allDecks) {
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1];
        const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
        if (ll < 1e-9) continue;
        const u = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / ll));
        if (Math.hypot(x - ax - ex * u, z - az - ez * u) > d.width / 2 + radius) continue;
        const top = d.tops[i] + (d.tops[i + 1] - d.tops[i]) * u;
        if (y0 < top + 1.5 && y1 > top - 0.6 - 0.3) return true;
      }
    }
    return false;
  };
  let onDeck = 0, overLane = 0;
  for (const t of forest.trees) {
    const g = field.height(t.x, t.z), crown = bakedCrownRadius(t);
    if (treeOnDeck(t.x, t.z, g, g + t.height, Math.max(crown, 1.5))) onDeck++;
    if (t.kind === 2) continue;
    net.carve(t.x, t.z, net.scratch);
    const s = net.scratch;
    if (s.road >= 0 && s.lines < 3 && s.dist < s.hw + wayMargin(t, s) + crown * crownShare(t, s) - 1e-6) overLane++;
  }
  stats.treesOnDecks = onDeck; stats.treesOverLanes = overLane;
  check('no tree of OSM stands on a bridge, through its slab or with its crown over it', onDeck === 0, `${onDeck} of ${forest.trees.length}`);
  check('no crown of a tree of OSM hangs over a lane (street trees: half a crown over the kerb)', overLane === 0, `${overLane} of ${forest.trees.length}`);
  {
    let woodOnDeck = 0, woodOverLane = 0, n = 0;
    const seen = new Set();
    for (const d of allDecks) {
      if (d.pts.length < 8 && d.width < 5) continue;        // the little decks of footpaths are covered by the sample below
      for (const [x, z] of d.pts.filter((_, i) => i % 6 === 0)) {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const bx = Math.floor(x / 32) + dx, bz = Math.floor(z / 32) + dz, k = bx * 100003 + bz;
          if (seen.has(k)) continue;
          seen.add(k);
          const list = treesOfBlock(bx, bz, { map: maps, field, network: field.network, buildings, clearings: landmarks.clearings, treeDecks });
          for (let i = 0; i < list.length; i += 6) {
            n++;
            const h = list[i + 3], crown = h * 0.4;
            if (treeOnDeck(list[i], list[i + 2], list[i + 1], list[i + 1] + h, Math.max(crown, 2))) woodOnDeck++;
            net.carve(list[i], list[i + 2], net.scratch);
            if (net.scratch.road >= 0 && net.scratch.lines < 3 && net.scratch.dist < net.scratch.hw + 1.5 + crown - 1e-6) woodOverLane++;
          }
        }
      }
    }
    stats.woodTreesNearBridges = n;
    check('no tree of the woods grows on a bridge or with its crown over it (blocks around every bridge)', woodOnDeck === 0, `${woodOnDeck} of ${n}`);
    check('no crown of a tree of the woods hangs over a lane (blocks around every bridge)', woodOverLane === 0, `${woodOverLane} of ${n}`);
  }

  // the woods: the trees of the blocks near the start stand on the ground too
  const rng = createRng(23);
  let woodFloating = 0, woodWorst = 0, woodCount = 0, woodInHouse = 0;
  for (let i = 0; i < (QUICK ? 20 : 120); i++) {
    const bx = Math.floor(rng() * 400), bz = Math.floor(rng() * 400);
    const list = treesOfBlock(bx, bz, { map: maps, field, network: field.network, buildings, clearings: landmarks.clearings, treeDecks });
    for (let k = 0; k < list.length; k += 6) {
      woodCount++;
      const x = list[k], y = list[k + 1], z = list[k + 2];
      const g = field.height(x, z);
      if (y - g > 0.05) { woodFloating++; woodWorst = Math.max(woodWorst, y - g); }
      if (buildings.collide(x, z, 0.2)) woodInHouse++;
    }
  }
  stats.woodTrees = woodCount;
  check('no tree of the woods floats above the ground', woodFloating === 0, `${woodFloating} of ${woodCount}, worst ${woodWorst.toFixed(2)} m`);
  check('no tree of the woods stands inside a house', woodInHouse === 0, `${woodInHouse} of ${woodCount}`);
}

/* ---------------------------------------------------------------- F: the car and the camera */
if (wants('F')) {
  section('F car and camera');
  const collide = (x, z, radius, y) => buildings.collide(x, z, radius) || portals.collide(x, z, radius, y) ||
    (ground.onDeck(x, z) ? null : forest.collide(x, z, radius)) || playArea.collide(x, z, radius);      // (as main.js)
  const start = data.places.start;
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide, start });
  const chase = createChaseCamera(surface, (x, z, radius, y) => buildings.collide(x, z, radius) || forest.collide(x, z, radius) || portals.collide(x, z, radius, y));
  car.reset(start.x, start.z, start.yaw || 0);
  chase.snap(car.state);

  // The start: the car must stand on the carriageway of a road, in a lane, facing along the road (the reviewer
  // found it on the paving of the plaza between the office blocks).
  {
    const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0 };
    surface.roadInfoAt(start.x, start.z, info);
    const r = info.road >= 0 ? data.roads[info.road] : null;
    const dir = r ? roadDirectionAt(r, start.x, start.z) : null;
    const onWay = !!r && r.info.drivable && Math.abs(info.lat) <= r.width / 2;
    // the heading must be along the way: with the traffic or against it, but never across it
    const diff = dir ? Math.atan2(Math.sin(Math.atan2(dir.z, dir.x) - (start.yaw || 0)), Math.cos(Math.atan2(dir.z, dir.x) - (start.yaw || 0))) : Math.PI;
    const along = Math.abs(diff) < 0.25 || Math.abs(Math.abs(diff) - Math.PI) < 0.25;
    check('the car starts on the carriageway of a road, facing along it',
      onWay && along, r ? `${r.name || r.kind}: ${info.lat.toFixed(2)} m from the centre line of ${r.width.toFixed(2)} m` : 'no road under the start');
    stats.startRoad = r ? (r.name || r.kind) : '';
  }
  let bad = 0, below = 0, worstBelow = 0, maxSpeed = 0, camUnder = 0, worstCam = 0, camInside = 0, camMinBoom = 99;
  const dt = 1 / 60;
  for (let step = 0; step < (QUICK ? 600 : 3600); step++) {
    const steer = Math.sin(step * 0.01) * 0.5;
    car.update(dt, { throttle: step < 900 ? 1 : 0, brake: step >= 900 && step < 1200 ? 1 : 0, steer, handbrake: false });
    const s = car.state;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z) || !Number.isFinite(s.speed)) { bad++; break; }
    const g = ground.height(s.x, s.z);
    if (s.y < g - 0.35) { below++; worstBelow = Math.max(worstBelow, g - s.y); }
    maxSpeed = Math.max(maxSpeed, Math.abs(s.speed));
    // the camera shortens its boom when the ground rises under it: it is never under the ground
    const c = chase.update(s, dt, 0, step * dt);
    const cg = surface.height(c.x, c.z) + CAMERA.minClearance;
    if (c.y < cg - 0.05) { camUnder++; worstCam = Math.max(worstCam, cg - c.y); }
    if (buildings.collide(c.x, c.z, 0.25) || forest.collide(c.x, c.z, 0.25) || portals.collide(c.x, c.z, 0.25)) camInside++;
    camMinBoom = Math.min(camMinBoom, Math.hypot(c.x - s.x, c.z - s.z));
  }
  stats.carSteps = QUICK ? 600 : 3600;
  stats.carMaxSpeed = maxSpeed * 3.6;
  check('the car physics stays finite', bad === 0, `${bad} bad steps`);
  check('the car never sinks into the ground', below === 0, `${below} steps, worst ${worstBelow.toFixed(2)} m`);
  check('the car drives (it is not stuck)', maxSpeed > 5, `max ${(maxSpeed * 3.6).toFixed(0)} km/h`);
  stats.cameraUnder = camUnder;
  check('the camera is never under the ground', camUnder === 0, `${camUnder} frames, worst ${worstCam.toFixed(2)} m`);
  check('the chase camera is never inside a house, a tree or a tunnel portal', camInside === 0, `${camInside} frames, closest to the car ${camMinBoom.toFixed(1)} m`);
}

/* ---------------------------------------------------------------- F2: the Kaart taps, the sound numbers, the auto-step */
if (wants('F2')) {
  section('F2 kaart, sound, auto-step');
  const index = createRoadIndex(data.roads);
  const start = data.places.start;
  const startHit = index.nearest(start.x, start.z, 80);
  check('the start place has a CAR road within 80 m (the reset puts the car there)', !!startHit && isCarRoad(startHit.road), startHit ? `${startHit.road.name || startHit.road.kind} ${startHit.dist.toFixed(1)} m away` : 'none');
  const rng = createRng(77);
  let hits = 0, wrong = 0;
  for (let i = 0; i < 600; i++) {
    const hit = index.nearest(rng() * 16000, rng() * 14000, 200);
    if (!hit) continue;
    hits += 1; if (!isCarRoad(hit.road)) wrong += 1;
  }
  check('a tap on the Kaart only ever finds a car road (never footway, steps, path, cycleway, track, pedestrian, bridleway)', hits > 100 && wrong === 0, `${hits} taps found a road, ${wrong} wrong`);
  const NOT_CAR = ['footway', 'pedestrian', 'steps', 'path', 'cycleway', 'track', 'bridleway', 'busway'];
  let onNot = 0, onNotWrong = 0;
  for (const seg of index.segments) {
    if (!NOT_CAR.includes(seg.road.kind) || seg.i % 7 !== 0) continue;
    const hit = index.nearest((seg.ax + seg.bx) / 2, (seg.az + seg.bz) / 2, 120);
    if (!hit) continue;
    onNot += 1; if (!isCarRoad(hit.road)) onNotWrong += 1;
  }
  check('a tap exactly on a non-car way lands on a car road', onNot > 100 && onNotWrong === 0, `${onNot} taps, ${onNotWrong} wrong`);

  // the engine note: a gearbox that changes up, drops the revs at a change, stays between idle and the redline
  const box = createGearbox();
  let maxRpm = 0, minRpm = 1e9, shifts = 0, lastGear = 1, dropped = 0, prevRpm = ENGINE.idleRpm;
  for (let step = 0; step < 60 * 14; step++) {
    const v = Math.min(45, step / 60 * 4);
    const g = box.update(1 / 60, v, 1);
    maxRpm = Math.max(maxRpm, g.rpm); minRpm = Math.min(minRpm, g.rpm);
    if (g.gear !== lastGear) { shifts += 1; if (g.rpm < prevRpm - 100) dropped += 1; lastGear = g.gear; }
    prevRpm = g.rpm;
  }
  check('the gearbox of the sound changes up and the revs stay between idle and the redline', shifts >= 3 && minRpm >= ENGINE.idleRpm - 1 && maxRpm <= ENGINE.redlineRpm + 1 && lastGear >= 4, `${shifts} shifts, top gear ${lastGear}, ${minRpm.toFixed(0)}..${maxRpm.toFixed(0)} rpm`);
  check('a gear change drops the revs', dropped >= 2, `${dropped} drops`);
  check('the tyre squeal needs slip AND speed (no squeal at a standstill, none while the grip holds)', squealLevel(0.5, 0.5) === 0 && squealLevel(0, 20) === 0 && squealLevel(0.5, 15) > 0.9 && squealLevel(0.5, 15, false) === 0, `${squealLevel(0.5, 15).toFixed(2)}`);
  check('the thud grows with the speed into the wall, none for a touch', thudLevel(1) === 0 && thudLevel(4) < thudLevel(12) && thudLevel(12) <= 1, `${thudLevel(4).toFixed(2)} / ${thudLevel(12).toFixed(2)}`);

  // the auto-step: slow frames drop the game to low within a few seconds
  for (const [ms, limit] of [[35, 10], [60, 7]]) {
    const s = createQualityStepper({ initial: 'high', max: 'high' });
    let t = 0, lowAt = null;
    for (; t < 30 && lowAt === null; t += ms / 1000) if (s.frame(ms / 1000) === 'low') lowAt = t;
    check(`the auto-step reaches low within ${limit} s of ${ms} ms frames`, lowAt !== null && lowAt <= limit, lowAt === null ? 'never' : `${lowAt.toFixed(1)} s`);
  }
}

/* ---------------------------------------------------------------- G: render == physics */
if (wants('G')) {
  section('G render == physics');
  // The tiles of LOD 0 are built from the very lattice the car drives on: the mesh height and the surface height
  // must be the same number, or the car drives on something the player does not see.  The border of a tile is
  // stitched to the coarser neighbour, so the probe stays inside the tile.
  const rng = createRng(31);
  let worst = 0, worstAt = null, checked = 0;
  for (let i = 0; i < (QUICK ? 4 : 24); i++) {
    const r = data.roads[Math.floor(rng() * data.roads.length)];
    if (!r || !r.info.drivable || r.pts.length < 2) continue;
    const [x, z] = r.pts[Math.floor(rng() * r.pts.length)];
    const sel = selectTiles(x, z, {});
    for (const leaf of sel.leaves) {
      if (leaf.step !== 1) continue;
      const nodes = computeTileNodes(leaf, surface, field);
      const mesh = buildTileMesh(leaf, nodes, sel.split, field);
      for (let k = 0; k < 60; k++) {
        const px = leaf.x0 + 2 + rng() * (leaf.size - 4), pz = leaf.z0 + 2 + rng() * (leaf.size - 4);
        const a = meshHeightAt(mesh, px, pz), b = surface.height(px, pz);
        const d = Math.abs(a - b);
        if (d > worst) { worst = d; worstAt = { px: Math.round(px), pz: Math.round(pz), mesh: +a.toFixed(3), surface: +b.toFixed(3) }; }
        checked++;
      }
    }
  }
  check('the render mesh is the physics surface (LOD 0 tiles)', worst < 0.02,
    `${checked} points, worst ${worst.toFixed(4)} m${worstAt ? ' ' + JSON.stringify(worstAt) : ''}`);

  // the tiles are a partition: no gap around the car
  let gaps = 0;
  for (let i = 0; i < (QUICK ? 6 : 40); i++) {
    const x = rng() * WORLD.width, z = rng() * WORLD.depth;
    const sel = selectTiles(x, z, {});
    for (let k = 0; k < 200; k++) {
      const px = x + (rng() - 0.5) * 4000, pz = z + (rng() - 0.5) * 4000;
      const leaf = leafAt(sel.split, px, pz);
      if (!leaf) continue;
      if (!sel.leaves.some((l) => l.key === leaf.key)) gaps++;
    }
  }
  check('the tiles around the car are a partition (no gap)', gaps === 0, `${gaps} gaps`);

  // the tile under the car is always the finest one
  let coarse = 0;
  for (let i = 0; i < 40; i++) {
    const x = rng() * WORLD.width, z = rng() * WORLD.depth;
    const sel = selectTiles(x, z, {});
    const leaf = leafAt(sel.split, x, z);
    if (!leaf || leaf.size !== QUADTREE.minSize) coarse++;
  }
  check('the tile under the car is always LOD 0', coarse === 0, `${coarse} of 40`);
}

/* ---------------------------------------------------------------- H: the Luxtram and the street lights */
if (wants('H')) {
  section('H tram + lights');
  const tramNet = createTramNetwork(data.lines, data.stops, TRAM);
  const [A, B] = tramNet.tracks;
  stats.tramKm = +((A.length + B.length) / 1000).toFixed(1);
  check('the Luxtram has two tracks of at least 8 km each', A.length > 8000 && B.length > 8000, `A ${A.length.toFixed(0)} m, B ${B.length.toFixed(0)} m`);
  // right-hand running: from the middle of A the nearest point of B lies on the LEFT
  const p = { x: 0, z: 0, dx: 0, dz: 0 }, pr = { s: 0, dist: 0, side: 0 };
  let wrong = 0, measured = 0, farApart = 0;
  for (let s = 400; s < A.length - 400; s += 150) {
    A.at(s, p); B.project(p.x, p.z, pr);
    if (pr.dist > 12) { farApart++; continue; }          // a place where the tracks are not side by side (a branch, a loop)
    const q = B.at(pr.s, { x: 0, z: 0, dx: 0, dz: 0 });
    const side = ((q.x - p.x) * -p.dz + (q.z - p.z) * p.dx);          // > 0: B is on the right of A
    measured++;
    if (side > 0.5) wrong++;
  }
  check('the tracks run on the right: the other track lies on the left of every vehicle', wrong === 0 && measured > 30, `${wrong} of ${measured} samples on the wrong side (${farApart} apart)`);
  stats.tramStops = tramNet.stops.map((a) => a.length);
  check('every track has its stops (>= 18) in order and at least 35 m apart', tramNet.stops.every((list) => list.length >= 18 && list.every((st, i) => i === 0 || st.s - list[i - 1].s >= 35)), JSON.stringify(stats.tramStops));
  // the stops lie on the rails
  let offRail = 0; const pj = { s: 0, dist: 0, side: 0 };
  tramNet.tracks.forEach((t, i) => { for (const st of tramNet.stops[i]) { t.project(st.x, st.z, pj); if (pj.dist > 2.5) offRail++; } });
  check('every tram stop lies on its rails (within 2.5 m)', offRail === 0, `${offRail} off`);
  // nothing is inside something else: the rails and the vehicle body run through no house.  A viaduct runs OVER the houses of the
  // valley (the Pont Rouge over Pfaffenthal), so a place where the rails ride more than 4 m above the ground is not tested in 2D.
  let inHouse = 0, firstAt = null, onViaduct = 0;
  const dsc = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  for (const t of tramNet.tracks) {
    for (let s = 0; s < t.length; s += 3) {
      t.at(s, p);
      const g = surface.height(p.x, p.z), deck = deckNetwork.deckAt(p.x, p.z, 1e9, dsc);
      // a viaduct CARRIES the track: the deck runs along it (a deck across the track is a bridge the tram runs under: the houses are tested)
      if (deck && deck.top > g + 4 && Math.abs(deck.ux * p.dz - deck.uz * p.dx) < 0.42) { onViaduct++; continue; }
      if (buildings.collide(p.x, p.z, TRAM.bodyHalfWidth)) { inHouse++; if (!firstAt) firstAt = `${p.x.toFixed(0)},${p.z.toFixed(0)}`; }
    }
  }
  stats.tramInHouse = inHouse; stats.tramOnViaduct = onViaduct;
  check('no vehicle of the Luxtram would stand inside a house (3 m steps along both tracks, viaducts excluded)', inHouse === 0, `${inHouse} samples, first at ${firstAt}; ${onViaduct} samples ride on a viaduct`);
  // the vehicles on their rails, for 20 minutes of the line
  const sim = createTramSim(tramNet, TRAM);
  let minGap = Infinity, vTop = 0, stopsServed = 0, maxStep = 0, seenModes = new Set();
  let prev = sim.trams.map((t) => ({ s: t.s, track: t.track }));
  for (let i = 0; i < 20 * 60 * 20; i++) {
    sim.update(1 / 20);
    sim.trams.forEach((t, k) => {
      seenModes.add(t.mode);
      if (t.hidden) { prev[k] = { s: t.s, track: t.track }; return; }
      if (t.track === prev[k].track) maxStep = Math.max(maxStep, Math.abs(t.s - prev[k].s));
      prev[k] = { s: t.s, track: t.track };
      vTop = Math.max(vTop, t.v);
      if (t.mode === 'dwell' && t.v === 0 && t.timer > TRAM.dwell - 0.1) stopsServed++;
      for (const o of sim.trams) if (o !== t && !o.hidden && o.track === t.track && o.s < t.s) minGap = Math.min(minGap, (t.s - sim.length) - o.s);
    });
  }
  stats.tramTopSpeed = +vTop.toFixed(1);
  check('the vehicles never run into each other (free distance in 20 minutes)', minGap > 5, `${minGap.toFixed(1)} m`);
  check('the vehicles keep to the line speed', vTop <= TRAM.maxSpeed + 0.01, `${vTop.toFixed(2)} m/s`);
  check('the vehicles move smoothly along the rails (no jump along the track)', maxStep < TRAM.maxSpeed / 20 + 0.01, `${maxStep.toFixed(3)} m in one step`);
  check('the vehicles stop at stops, run, and turn back at the terminus', stopsServed >= 6 && seenModes.has('run') && seenModes.has('dwell'), `${stopsServed} stops served, modes ${[...seenModes].join('/')}`);
  // a car that drives into a vehicle is pushed out
  const t0v = sim.trams.find((t) => !t.hidden);
  const mid = t0v.sections[2];
  const hit = sim.collide((mid.fx + mid.rx) / 2, (mid.fz + mid.rz) / 2, 1.35);
  check('the car collides with a tram', !!hit && hit.pen > 0.5, hit ? `${hit.pen.toFixed(2)} m` : 'no hit');
  // a car that stands on the track ahead stops the vehicle (it never drives into it)
  {
    const sim2 = createTramSim(tramNet, TRAM);
    const v = sim2.trams[0];
    sim2.update(0.05);
    for (let i = 0; i < 20 * 120 && v.mode !== 'run'; i++) sim2.update(0.05);          // wait for the doors to close: it runs
    let blocked = null;
    for (let i = 0; i < 20 * 60 && !blocked; i++) {
      sim2.update(0.05);
      if (v.mode === 'run' && v.v > 8) blocked = tramNet.tracks[v.track].at(v.s + 80, { x: 0, z: 0, dx: 0, dz: 0 });
    }
    let hitSeen = false, closest = Infinity;
    if (blocked) {
      sim2.setObstacle(blocked.x, blocked.z);
      for (let i = 0; i < 20 * 60; i++) {
        sim2.update(0.05);
        const gapNow = Math.hypot(v.sections[0].fx - blocked.x, v.sections[0].fz - blocked.z);
        closest = Math.min(closest, gapNow);
        if (sim2.collide(blocked.x, blocked.z, 1.35)) hitSeen = true;
      }
    }
    check('a vehicle brakes for a car on its track and stops before it', !!blocked && !hitSeen && closest > 4, blocked ? `closest ${closest.toFixed(1)} m` : 'no run found');
  }
  // the street lights
  const lights = placeStreetLights({ roads: data.roads, network: net, buildings, map: maps, walls: data.walls });
  stats.streetLights = lights.count;
  check('the city has street lights (> 3000)', lights.count > 3000, `${lights.count}`);
  let lampInHouse = 0, lampInRoad = 0, lampOut = 0, lampInWall = 0;
  const li = { sdCar: 9, sdPave: 9 };
  const inWall = createWallFootprint(data.walls);
  const LAMP_ROAD_CLEAR = 0.5;           // m: the foot of a lamp (0.22 m post) stands at least this far outside every carriageway (QA TR02)
  for (let i = 0; i < lights.count; i++) {
    if (buildings.collide(lights.x[i], lights.z[i], 0.2)) lampInHouse++;
    net.carve(lights.x[i], lights.z[i], li);
    if (li.sdCar < LAMP_ROAD_CLEAR) lampInRoad++;
    if (inWall(lights.x[i], lights.z[i], 0.22)) lampInWall++;
    if (lights.x[i] < 0 || lights.z[i] < 0 || lights.x[i] > WORLD.width || lights.z[i] > WORLD.depth) lampOut++;
  }
  check('no street light stands inside a house', lampInHouse === 0, `${lampInHouse}`);
  check(`no street light stands in a carriageway or within ${LAMP_ROAD_CLEAR} m of one`, lampInRoad === 0, `${lampInRoad}`);
  check('no street light stands in a retaining wall', lampInWall === 0, `${lampInWall}`);
  check('every street light is inside the world', lampOut === 0, `${lampOut}`);
  // the lamps are solid: a car that drives at a lamp post is pushed out of it
  const propBox = createPropCollider();
  for (let i = 0; i < lights.count; i++) propBox.add(lights.x[i], lights.z[i], 0.22);
  const lampHit = propBox.collide(lights.x[0] + 0.3, lights.z[0], CAR.bodyRadius);
  check('the car stops at a street lamp (the props are solid)', !!lampHit && lampHit.pen > 0.5 && propBox.collide(lights.x[0] + 30, lights.z[0] + 30, CAR.bodyRadius) === null, lampHit ? `${lampHit.pen.toFixed(2)} m` : 'no hit');
  // the park benches
  const benches = placeParkBenches({ roads: data.roads, network: net, buildings, map: maps });
  stats.parkBenches = benches.count;
  let benchBad = 0;
  for (let i = 0; i < benches.count; i++) { net.carve(benches.x[i], benches.z[i], li); if (buildings.collide(benches.x[i], benches.z[i], 0.3) || li.sdCar < 0) benchBad++; }
  check('the parks have benches (> 100), none in a house or in a carriageway', benches.count > 100 && benchBad === 0, `${benches.count} benches, ${benchBad} in a house or a road`);
}

/* ---------------------------------------------------------------- I: the roads are smooth, level ribbons */
if (wants('I')) {
  section('I smooth roads');
  // Ian: "the road is really bumpy and not level at all".  A real street is smooth along its length (only its real gradient), has
  // a gentle constant crossfall and a kerb of constant height; and what the player SEES (the render tile of the lattice the game
  // uses at that distance) is the same surface as the height function, at every quality level.
  const li = { sdCar: 9, sdPave: 9 };
  const kerbLi = { sdCar: 9, sdPave: 9 };
  const rng = createRng(77);
  const LATTICE_RESOLVES_HW = 2.5;
  const TIGHT_BEND_R = 12;                              // m
  const MAX_BOB = 1.5, HARD_BOB = 4.0, MAX_SHARE = 0.003;                 // m/s2: the most a street may lift the body at the design speed of its class (50 km/h for a town street, 100 km/h for a motorway; 0.15 g, a swell over a crest, not a bump; at most 0.3 % of the points, none above 4).  Before the fix the median point of a way gave 1.2 and 56 % of all points more than 1.0
  const WINDOW = 10, DEV_SLACK = 0.01, HARD_DEV_RATIO = 2, MAX_CROSSFALL = 0.025, MAX_KERB_DEV = 0.03;   // (a vertical curve of the radius of its class leaves its 20 m mean by deviationOf(R): 11 cm for a town street, 3 cm for a motorway; + 1 cm for the rounding of the lattice and of the junction pins)
  // the ways: carved, at ground level (layer 0, not riding over anything), long enough to hold a window; half in the town, half outside
  const urban = [], rural = [];
  for (const ch of net.chains) {
    if (ch.tagged || net.overRoads.has(ch.road) || ch.arc[ch.arc.length - 1] < 3 * WINDOW) continue;
    // (an opened shallow tunnel is driven by section O; kept out of this random sample so that the sample stays the same set of streets.  With them in it
    // the draw shifted onto Eecherfeld at 5070,6192: a 16.7 % crossfall there that was never sampled before - not caused by them, listed in PROGRESS, bridges8)
    if (data.roads[ch.road].openCut) continue;
    const mid = Math.floor(ch.x.length / 2);
    (buildings.near(ch.x[mid], ch.z[mid], 60).length > 6 ? urban : rural).push(ch);
  }
  const pick = (list, n) => { const out = [], pool = list.slice(); while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]); return out; };
  const ways = [...pick(urban, 100), ...pick(rural, 100)];
  let measured = 0, worstDevRatio = 0, worstDev = 0, worstAt = null, badWays = 0, devBad = 0, worstFall = 0, worstFallAt = null, fallBad = 0, kerbWorst = 0, kerbBad = 0, kerbMeasured = 0, points = 0, fallMeasured = 0, worstAcc = 0, worstAccAt = '', bobBad = 0;
  const lineAt = (ch, d, out) => {                                     // the point of the centre line at the distance d along it
    let k = 0;
    while (k < ch.arc.length - 2 && ch.arc[k + 1] < d) k++;
    const t = (d - ch.arc[k]) / Math.max(1e-9, ch.arc[k + 1] - ch.arc[k]);
    out.x = ch.x[k] + (ch.x[k + 1] - ch.x[k]) * t; out.z = ch.z[k] + (ch.z[k + 1] - ch.z[k]) * t;
    const l = Math.hypot(ch.x[k + 1] - ch.x[k], ch.z[k + 1] - ch.z[k]) || 1;
    out.nx = -(ch.z[k + 1] - ch.z[k]) / l; out.nz = (ch.x[k + 1] - ch.x[k]) / l;
    return out;
  };
  const bedAt = bedAtArc;                                              // the designed profile of the way at the distance d along it (the curve the carve uses)
  const pt = { x: 0, z: 0, nx: 0, nz: 0 };
  for (const ch of ways) {
    const L = ch.arc[ch.arc.length - 1], m = Math.floor(L);
    const hw = net.info[ch.road].hw, kerbW = net.info[ch.road].kerbW, kerbH = net.info[ch.road].kerbH;
    const h = new Float64Array(m + 1), clean = new Uint8Array(m + 1);
    for (let q = 0; q <= m; q++) {
      lineAt(ch, q, pt);
      h[q] = surface.height(pt.x, pt.z);
      clean[q] = inJunction(ch.road, pt.x, pt.z) ? 0 : 1;
    }
    // a tight bend (radius under TIGHT_BEND_R) fans its cross sections out: inside it the nearest point of the way jumps along the way, and on a gradient
    // that is a ridge across the carriageway (a 2 m radius chicane of a farm track).  It is not gated: no street has one.
    for (let i = 1; i < ch.x.length - 1; i++) {
      const ax = ch.x[i - 1], az = ch.z[i - 1], bx = ch.x[i], bz = ch.z[i], cx = ch.x[i + 1], cz = ch.z[i + 1];
      const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));                   // twice the triangle area
      const R = area2 < 1e-9 ? Infinity : (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * area2);
      if (R >= TIGHT_BEND_R) continue;
      for (let q = Math.max(0, Math.floor(ch.arc[i] - hw - 4)); q <= Math.min(m, Math.ceil(ch.arc[i] + hw + 4)); q++) clean[q] = 0;
    }
    const speed = designSpeed(ch.kind), devMax = deviationOf(radiusOf(ch.kind)) + DEV_SLACK;
    let wayWorst = 0, any = false;
    for (let q = WINDOW; q <= m - WINDOW; q++) {
      let ok = true;
      for (let j = -WINDOW; j <= WINDOW; j++) if (!clean[q + j]) { ok = false; break; }
      if (!ok) continue;
      any = true; points++;
      let sum = 0;
      for (let j = -WINDOW; j <= WINDOW; j++) sum += h[q + j];
      const dev = Math.abs(h[q] - sum / (2 * WINDOW + 1));
      // what the car feels: the vertical acceleration of a body that follows the profile at the design speed of the class (h'' over a 2 m base)
      const acc = speed * speed * Math.abs(h[q + 2] + h[q - 2] - 2 * h[q]) / 4;
      if (acc > worstAcc) { worstAcc = acc; lineAt(ch, q, pt); worstAccAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
      if (acc > MAX_BOB) bobBad++;
      if (dev > devMax) devBad++;
      if (dev / devMax > worstDevRatio) worstDevRatio = dev / devMax;
      if (dev > wayWorst) wayWorst = dev;
      if (dev > worstDev) { worstDev = dev; worstAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} ${Math.round(pt.x)},${Math.round(pt.z)}`; lineAt(ch, q, pt); worstAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
      if (q % 3 === 0) {
        lineAt(ch, q, pt);
        // the crossfall: left and right of the centre line, inside the carriageway
        const w = hw * 0.8;
        const lx = pt.x - pt.nx * w, lz = pt.z - pt.nz * w, rx = pt.x + pt.nx * w, rz = pt.z + pt.nz * w;
        // The two sides of a bend lie at different stations of the way (the cross sections of a bend fan out), so on a gradient the
        // raw difference between them is the gradient times the shift, not a crossfall.  The crossfall is the difference of the
        // heights ABOVE THE PROFILE of the way at each side's own station.
        if (inJunction(ch.road, lx, lz) || inJunction(ch.road, rx, rz)) continue;           // the probes lie in the apron of another way (a boulevard of several carriageways)
        field.height(lx, lz, li); const sL = li.s, roadL = li.road;
        field.height(rx, rz, li); const sR = li.s, roadR = li.road;
        // (a way narrower than 5 m has no lattice node pair on its tarmac: the 1 m lattice of the physics blends the kerb into the
        // probe there, so the field itself is measured; a car road is measured on the lattice the car drives on)
        const heightOf = hw >= LATTICE_RESOLVES_HW ? surface.height : field.height;
        const hL = heightOf(lx, lz), hR = heightOf(rx, rz);
        fallMeasured++;
        const fall = roadL === ch.road && roadR === ch.road
          ? Math.abs((hL - bedAt(ch, sL)) - (hR - bedAt(ch, sR))) / (2 * w)
          : Math.abs(hL - hR) / (2 * w);
        if (fall > worstFall) { worstFall = fall; worstFallAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
        if (fall > MAX_CROSSFALL) { fallBad++; if (VERBOSE) console.log(`   crossfall ${(fall * 100).toFixed(2)} % ${data.roads[ch.road].name || data.roads[ch.road].kind} at ${pt.x.toFixed(1)},${pt.z.toFixed(1)} d=${q}/${m}`); }
        // the kerb: its height over the carriageway beside it is the same all along the street
        if (kerbH > 0) {
          const a = field.height(pt.x + pt.nx * (hw - 0.15), pt.z + pt.nz * (hw - 0.15), li), aLat = Math.abs(li.lat), aRoad = li.road, aS = li.s;
          const b = field.height(pt.x + pt.nx * (hw + kerbW + 0.1), pt.z + pt.nz * (hw + kerbW + 0.1), li);
          // a real junction or driveway is flat: the bake switches the kerb off within hw + junctionClear of another way's samples (3 segments)
          const kerbFree = nearOtherWay(ch.road, pt.x, pt.z, Math.hypot(hw + ROAD.junctionClear + ROAD.sampleSpacing / 2, 2 * ROAD.sampleSpacing));
          // (in a bend the probes along the normal of the segment can lie on the ramp of the kerb: only a probe on the tarmac and one on the flat top count)
          if (aRoad === ch.road && li.road === ch.road && aLat <= hw && Math.abs(li.lat) >= hw + kerbW + 0.02 && !kerbFree) {
            kerbMeasured++;
            // The kerb stands kerbH above the ground it stands on.  (The ground beside the kerb is the face of the cutting, which rises with the hillside from the
            // edge of the kerb on: the top of the kerb above the CARRIAGEWAY is kerbH plus that rise, a slope and not a kerb.  So the kerb term of the carve is measured,
            // and the rise is the business of the ground-beside-the-road gate of the world flow.)
            net.carve(pt.x + pt.nx * (hw + kerbW + 0.1), pt.z + pt.nz * (hw + kerbW + 0.1), kerbLi);
            const dk = Math.abs(kerbLi.kerb - kerbH);
            if (dk > kerbWorst) kerbWorst = dk;
            if (dk > MAX_KERB_DEV) { kerbBad++; if (VERBOSE) console.log(`   kerb ${(dk * 100).toFixed(2)} cm ${data.roads[ch.road].name || data.roads[ch.road].kind} at ${pt.x.toFixed(1)},${pt.z.toFixed(1)} kerb=${kerbLi.kerb.toFixed(3)} sdCar=${li.sdCar.toFixed(2)}`); }
          }
        }
      }
    }
    if (any) measured++;
    if (wayWorst > devMax) badWays++;
  }
  stats.roadSmooth = { ways: ways.length, measuredWays: measured, points, worstDevCm: +(worstDev * 100).toFixed(2), devOverShare: +(devBad / Math.max(1, points)).toFixed(5), bobOverShare: +(bobBad / Math.max(1, points)).toFixed(5), bobWorstMs2: +worstAcc.toFixed(2), crossfallMeasured: fallMeasured, worstCrossfallPct: +(worstFall * 100).toFixed(2), kerbWorstCm: +(kerbWorst * 100).toFixed(2) };
  check('the carved ways measured are enough (200 sampled, urban + rural, most with a clean stretch)', measured >= 120, `${measured} of ${ways.length} ways, ${points} points`);
  check(`the carved centre lines are within the vertical curve of their class of their 20 m moving mean (no waves, no bumps; at most ${MAX_SHARE * 100} % of the points over, none above ${HARD_DEV_RATIO} times; junction aprons and tight bends excepted)`, devBad <= MAX_SHARE * points && worstDevRatio <= HARD_DEV_RATIO, `${devBad} of ${points} points over, ${badWays} ways, worst ${(worstDev * 100).toFixed(2)} cm at ${worstAt}`);
  check(`the car does not bob: the vertical acceleration at the design speed along the centre line is <= ${MAX_BOB} m/s2 (at most ${MAX_SHARE * 100} % of the points, none above ${HARD_BOB})`, bobBad <= MAX_SHARE * points && worstAcc <= HARD_BOB, `${bobBad} of ${points} points over, worst ${worstAcc.toFixed(2)} m/s2 at ${worstAccAt}`);
  check(`the crossfall is gentle and constant (<= ${MAX_CROSSFALL * 100} %)`, fallBad === 0 && fallMeasured > 1500, `${fallMeasured} cross sections, ${fallBad} over, worst ${(worstFall * 100).toFixed(2)} % at ${worstFallAt}`);
  check(`the kerb stands at a constant height (+-${MAX_KERB_DEV * 100} cm of ${(ROAD.kerbHeight * 100).toFixed(0)} cm)`, kerbBad === 0 && kerbMeasured > 200, `${kerbMeasured} kerbs measured, ${kerbBad} off, worst ${(kerbWorst * 100).toFixed(2)} cm`);

  // (roads9) The crossfall of EVERY carved way, not a sample: the sample above never drew Eecherfeld (5070,6192: 16.7 % across, the two arms of a hairpin at two levels blended by
  // distance), and the planes of the junction sheets tilted tracks and side streets 8 - 22 % across past their junctions (2654 cross sections over 2.5 %, 341 over 6 % in 228 places).
  // Every 6 m of every carved way at ground level, junction aprons and tight bends aside, measured as above.  Left over 6 %: Neie Wee beside the 30 m cliff of the Corniche (the 1 m
  // lattice blurs the cliff into the lane), a service loop whose two arms overlap 0.7 m apart in level, and a narrow lane (6.1 %).
  {
    const ALL_STEP = 6, STEEP_ALL = 0.06, MAX_STEEP_ALL = 4, MAX_OVER_ALL = 0.0012;
    let allMeasured = 0, allOver = 0, allSteep = 0, allWorst = 0, allWorstAt = '';
    const steepAt = [];
    for (const ch of net.chains) {
      if (ch.tagged || net.overRoads.has(ch.road)) continue;
      const L = ch.arc[ch.arc.length - 1], hw = net.info[ch.road].hw;
      const tight = [];
      for (let i = 1; i < ch.x.length - 1; i++) {
        const ax = ch.x[i - 1], az = ch.z[i - 1], bx = ch.x[i], bz = ch.z[i], cx = ch.x[i + 1], cz = ch.z[i + 1];
        const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
        const R = area2 < 1e-9 ? Infinity : (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * area2);
        if (R < TIGHT_BEND_R) tight.push(ch.arc[i]);
      }
      for (let q = ALL_STEP / 2; q < L - 3; q += ALL_STEP) {
        if (tight.some((a) => Math.abs(a - q) <= hw + 4)) continue;
        lineAt(ch, q, pt);
        if (inJunction(ch.road, pt.x, pt.z)) continue;
        const w = hw * 0.8;
        const lx = pt.x - pt.nx * w, lz = pt.z - pt.nz * w, rx = pt.x + pt.nx * w, rz = pt.z + pt.nz * w;
        if (inJunction(ch.road, lx, lz) || inJunction(ch.road, rx, rz)) continue;
        field.height(lx, lz, li); const sL = li.s, roadL = li.road;
        field.height(rx, rz, li); const sR = li.s, roadR = li.road;
        const heightOf = hw >= LATTICE_RESOLVES_HW ? surface.height : field.height;
        const hL = heightOf(lx, lz), hR = heightOf(rx, rz);
        allMeasured++;
        const fall = roadL === ch.road && roadR === ch.road ? Math.abs((hL - bedAt(ch, sL)) - (hR - bedAt(ch, sR))) / (2 * w) : Math.abs(hL - hR) / (2 * w);
        if (fall > MAX_CROSSFALL) allOver++;
        if (fall > STEEP_ALL) { allSteep++; if (steepAt.length < 6) steepAt.push(`${data.roads[ch.road].name || data.roads[ch.road].kind} ${Math.round(pt.x)},${Math.round(pt.z)} ${(fall * 100).toFixed(1)} %`); }
        if (fall > allWorst) { allWorst = fall; allWorstAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
      }
    }
    stats.crossfallAll = { measured: allMeasured, over: allOver, overShare: +(allOver / Math.max(1, allMeasured)).toFixed(5), steep: allSteep, worstPct: +(allWorst * 100).toFixed(2), worstAt: allWorstAt };
    check(`every carved way (every ${ALL_STEP} m): at most ${MAX_STEEP_ALL} cross sections lean more than ${STEEP_ALL * 100} % and at most ${MAX_OVER_ALL * 100} % more than ${MAX_CROSSFALL * 100} % (junction aprons and tight bends aside)`,
      allMeasured > 100000 && allSteep <= MAX_STEEP_ALL && allOver <= MAX_OVER_ALL * allMeasured, `${allMeasured} cross sections, ${allOver} over ${MAX_CROSSFALL * 100} %, ${allSteep} over ${STEEP_ALL * 100} %: ${steepAt.join('; ')}; worst ${(allWorst * 100).toFixed(2)} % at ${allWorstAt}`);
  }
}

/* ---------------------------------------------------------------- J: what is drawn near the car is the surface, at every quality */
if (wants('J')) {
  section('J render lattice');
  // The tile the game builds for the car at each quality level (the same quadtree selection, the same tile builder): within 40 m of
  // the car the lattice is the 1 m physics lattice and the carriageway of the mesh is the height function to the centimetre; within
  // 80 m it is at most a 2 m lattice (the UI branch's low quality left a 4 m lattice from 26 m on, a faceted street in front of the car).
  const li = { sdCar: 9, sdPave: 9 };
  const kerbLi = { sdCar: 9, sdPave: 9 };
  const KERB_PROBES = [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]];
  const rng2 = createRng(91);
  const ways = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road) && c.arc[c.arc.length - 1] > 40);
  const MAX_MESH_DEV = 0.04, MESH_EDGE_CLEAR = 1.0, WAY_END_CLEAR = 6, MAX_BEND = 0.1;
  for (const [qid, Q] of Object.entries(QUALITY)) {
    let worst = 0, worstAt = '', measured = 0, coarseNear = 0, coarseMid = 0, bad = 0;
    for (let n = 0; n < (J_SAMPLES || (QUICK ? 6 : 24)); n++) {
      const ch = ways[Math.floor(rng2() * ways.length)];
      const d = rng2() * ch.arc[ch.arc.length - 1];
      let k = 0;
      while (k < ch.arc.length - 2 && ch.arc[k + 1] < d) k++;
      const t = (d - ch.arc[k]) / Math.max(1e-9, ch.arc[k + 1] - ch.arc[k]);
      const cx = ch.x[k] + (ch.x[k + 1] - ch.x[k]) * t, cz = ch.z[k] + (ch.z[k + 1] - ch.z[k]) * t;
      const sel = selectTiles(cx, cz, { scale: Q.lodScale, protectedSize: Q.protectedSize });
      const near = sel.leaves.filter((l) => Math.hypot(Math.max(l.x0 - cx, 0, cx - l.x0 - l.size), Math.max(l.z0 - cz, 0, cz - l.z0 - l.size)) <= 80);
      for (const l of near) {
        const dist = Math.hypot(Math.max(l.x0 - cx, 0, cx - l.x0 - l.size), Math.max(l.z0 - cz, 0, cz - l.z0 - l.size));
        if (dist <= 40 && l.step > 1) coarseNear++;
        if (l.step > 2) coarseMid++;
      }
      // the carriageway points of the roads within 40 m of the car, read from the mesh of their tile
      const meshes = new Map();
      for (const l of near) {
        if (Math.hypot(Math.max(l.x0 - cx, 0, cx - l.x0 - l.size), Math.max(l.z0 - cz, 0, cz - l.z0 - l.size)) > 40) continue;
        meshes.set(l.key, { l, mesh: buildTileMesh(l, computeTileNodes(l, surface, field), sel.split, field) });
      }
      for (const way of net.chains) {
        if (way.tagged || net.overRoads.has(way.road)) continue;
        const hwW = net.info[way.road].hw;
        for (let i = 0; i < way.x.length; i++) {
          if (Math.hypot(way.x[i] - cx, way.z[i] - cz) > 40) continue;
          if (way.arc[i] < hwW + WAY_END_CLEAR || way.arc[way.arc.length - 1] - way.arc[i] < hwW + WAY_END_CLEAR) continue;     // the cap of a way's end fades the carriageway out on purpose
          const nx = i + 1 < way.x.length ? -(way.z[i + 1] - way.z[i]) : -(way.z[i] - way.z[i - 1]);
          const nz = i + 1 < way.x.length ? (way.x[i + 1] - way.x[i]) : (way.x[i] - way.x[i - 1]);
          const nl = Math.hypot(nx, nz) || 1;
          for (const lat of [-0.5, 0, 0.5]) {
            const px = way.x[i] + (nx / nl) * lat * hwW, pz = way.z[i] + (nz / nl) * lat * hwW;
            const leaf = leafAt(sel.split, px, pz);
            const entry = leaf && meshes.get(leaf.key);
            if (!entry) continue;
            // a point near the border of its tile is stitched to the coarser neighbour: the mesh there is the neighbour's polyline
            if (px - leaf.x0 < leaf.step * 1.5 || leaf.x0 + leaf.size - px < leaf.step * 1.5 || pz - leaf.z0 < leaf.step * 1.5 || leaf.z0 + leaf.size - pz < leaf.step * 1.5) continue;
            net.carve(px, pz, li);
            // only the tarmac of this way, with the whole 1 m lattice cell on it (a cell that straddles the kerb is the kerb blended in), and
            // not where two ways meet (the apron of a junction is a blend of two levels, steep on purpose)
            if (li.sdCar > -MESH_EDGE_CLEAR || li.road !== way.road || inJunction(way.road, px, pz)) continue;
            // a 1 m lattice shows a surface with the error of a linear interpolation, about a eighth of the second difference over 1 m: where two levels meet
            // inside a plaza or a junction the field bends more than MAX_BEND within a metre, and that is the apron of a junction, not a road
            const here = field.height(px, pz);
            const bendX = Math.abs(field.height(px + 1, pz) + field.height(px - 1, pz) - 2 * here), bendZ = Math.abs(field.height(px, pz + 1) + field.height(px, pz - 1) - 2 * here);
            const bendD1 = Math.abs(field.height(px + 1, pz + 1) + field.height(px - 1, pz - 1) - 2 * here), bendD2 = Math.abs(field.height(px + 1, pz - 1) + field.height(px - 1, pz + 1) - 2 * here);
            if (Math.max(bendX, bendZ, bendD1, bendD2) > MAX_BEND) continue;
            // nor a kerb ridge of another way (35 cm wide) that crosses the tarmac: no 1 m lattice shows it, and it is not the surface of this way
            let kerbNear = false;
            for (const [kx, kz] of KERB_PROBES) { net.carve(px + kx, pz + kz, kerbLi); if (kerbLi.kerb > 0) { kerbNear = true; break; } }
            if (kerbNear) continue;
            const dv = Math.abs(meshHeightAt(entry.mesh, px, pz) - here);
            measured++;
            if (dv > MAX_MESH_DEV) { bad++; if (VERBOSE) console.log(`   mesh ${qid} ${(dv * 100).toFixed(2)} cm at ${px.toFixed(1)},${pz.toFixed(1)} step ${leaf.step} road ${data.roads[way.road].name || data.roads[way.road].kind} sdCar=${li.sdCar.toFixed(2)}`); }
            if (dv > worst) { worst = dv; worstAt = `${Math.round(px)},${Math.round(pz)} step ${leaf.step}`; }
            if (VERBOSE && dv > 0.02) console.log(`   mesh ${qid} ${(dv * 100).toFixed(2)} cm at ${px.toFixed(1)},${pz.toFixed(1)} step ${leaf.step} road ${data.roads[way.road].name || data.roads[way.road].kind} sdCar=${li.sdCar.toFixed(2)} lat=${li.lat.toFixed(2)} bend ${(Math.max(bendX, bendZ, bendD1, bendD2) * 100).toFixed(1)} cm`);
          }
        }
      }
    }
    stats[`renderLattice_${qid}`] = { measured, worstCm: +(worst * 100).toFixed(2) };
    check(`${qid}: the lattice within 40 m of the car is 1 m, within 80 m at most 2 m (a road is never faceted near the car)`, coarseNear === 0 && coarseMid === 0, `${coarseNear} tiles near coarser than 1 m, ${coarseMid} within 80 m coarser than 2 m`);
    check(`${qid}: the tile mesh within 40 m is the height function on the carriageway (<= ${MAX_MESH_DEV * 100} cm: the error of a linear interpolation on a 1 m lattice)`, measured > 100 && bad === 0, `${measured} points, ${bad} off, worst ${(worst * 100).toFixed(2)} cm at ${worstAt}`);
  }
}

/* ---------------------------------------------------------------- K: the retaining walls */
if (wants('K')) {
  section('K retaining walls');
  // A ramp steeper than 2 m/m beside a way is a crack in the ground if it is drawn as ground: the carve keeps it from being steeper than about 3 m/m and the baked walls
  // (data/walls.bin, scripts/luxdrive/bake_walls.mjs) hide every one of them.  Three things are proven: a wall is a sane block that stands on a ramp (not in the air, not buried);
  // every ramp the scan finds beside the ways has a wall (the data is not stale: re-bake after any change of the carve); and the walls fit the draw budget.
  const walls = data.walls;
  const MAX_TRIANGLES = 40000, MAX_VISIBLE_CHUNKS = 10, CHUNK = 1024, ON_RAMP = 0.9, COVER_RADIUS = 3.2;
  let insane = 0, floating = 0, buried = 0, points = 0, triangles = 0;
  const chunks = new Set();
  const gridW = new Map();                                    // the points of the walls, in a 4 m grid
  const wkey = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);
  for (const w of walls) {
    const mid = w.pts[w.pts.length >> 1];
    chunks.add(`${Math.floor(mid.x / CHUNK)}:${Math.floor(mid.z / CHUNK)}`);
    triangles += wallQuads(w).length * 2;
    for (const p of w.pts) {
      points++;
      // the tapered tip of a wall (a few cm over the ground, bake_walls.mjs) is a point of its own kind: no ramp to stand on, only a small height
      const tip = p.top - p.bottom < WALL.minRise * 0.5;
      const ok = [p.x, p.z, p.top, p.bottom, p.depth, p.nx, p.nz].every(Number.isFinite) && (tip ? p.top - p.bottom >= 0.02 && p.top - p.bottom <= 0.3 : p.top - p.bottom <= WALL.maxRise * 1.5) && p.depth >= WALL.minDepth * 0.9 && p.depth <= 14 && Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-3;
      if (!ok) { insane++; continue; }
      if (tip) { const k = wkey(p.x, p.z), l = gridW.get(k); if (l) l.push(p); else gridW.set(k, [p]); continue; }
      const foot = surface.height(p.x, p.z), head = surface.height(p.x + p.nx * p.depth, p.z + p.nz * p.depth);
      const tol = Math.max(ON_RAMP, rampTolerance(p.top - p.bottom, p.depth));       // (a ramp steeper than 3 m/m is off by more on the 1 m lattice)
      if (Math.abs(foot - p.bottom) > tol || Math.abs(head - p.top) > tol) { if (foot - p.bottom < -tol || p.top - head < -tol) buried++; else floating++; }
      const k = wkey(p.x, p.z), l = gridW.get(k); if (l) l.push(p); else gridW.set(k, [p]);
    }
  }
  // the draw calls: the walls are drawn within WALL_DRAW_FACTOR * the far building radius (main.js); how many chunks hold a wall within that of the busiest place
  const wallRadius = QUALITY.medium.buildingFarRadius * WALL_DRAW_FACTOR;
  let visibleChunks = 0;
  for (const w of walls) {
    const c = w.pts[w.pts.length >> 1], seen = new Set();
    for (const o of walls) { const m = o.pts[o.pts.length >> 1]; if (Math.hypot(m.x - c.x, m.z - c.z) < wallRadius + CHUNK / 2) seen.add(`${Math.floor(m.x / CHUNK)}:${Math.floor(m.z / CHUNK)}`); }
    visibleChunks = Math.max(visibleChunks, seen.size);
  }
  stats.walls = { walls: walls.length, points, triangles, chunks: chunks.size, mostChunksInView: visibleChunks };
  check('retaining walls: every wall point is a sane block (finite, 0.4 .. 12 m high, a unit direction)', insane === 0, `${insane} of ${points}`);
  check('retaining walls: every wall stands on a ramp (the foot at the bottom of the ground, the back at the top, within 0.9 m): none in the air, none buried', floating === 0 && buried === 0, `${floating} in the air, ${buried} buried`);
  check(`retaining walls: at most ${MAX_TRIANGLES} triangles and ${MAX_VISIBLE_CHUNKS} chunks (draw calls) in view at medium quality`, triangles <= MAX_TRIANGLES && visibleChunks <= MAX_VISIBLE_CHUNKS, `${triangles} triangles; up to ${visibleChunks} chunks in view`);
  // every ramp beside a way has a wall: the scan of the baker, at every 5th sample of every way, on both sides
  const coveredBy = (x, z, nx, nz, top) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of gridW.get((cx + a) * 100003 + (cz + b)) || []) {
      if (Math.hypot(p.x - x, p.z - z) <= COVER_RADIUS + p.depth && p.nx * nx + p.nz * nz > 0.3 && Math.abs(p.top - top) <= 2.5) return true;
    }
    return false;
  };
  let scanned = 0, ramps = 0, bare = 0, inRoad = 0, latticeLimited = 0;
  const wprobe = { sdCar: 9, sdPave: 9 };
  const bareList = [];
  const STRIDE = QUICK ? 25 : 5;
  /** The ramp across a way at sample i on one side (side = +1 right, -1 left): the same scan the baker makes. */
  const rampAt = (chain, i, side) => {
    const a = Math.max(0, i - 1), b = Math.min(chain.x.length - 1, i + 1);
    let dx = chain.x[b] - chain.x[a], dz = chain.z[b] - chain.z[a];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const info = net.info[chain.road], bench = info.hw + info.kerbW;
    const nx = -dz * side, nz = dx * side;
    const t0 = Math.max(0.3, info.hw * WALL.scanFrom), t1 = bench + WALL.scanReach, count = Math.floor((t1 - t0) / WALL.scanStep) + 1;
    const heights = new Float64Array(count), lands = new Float64Array(count);
    for (let k = 0; k < count; k++) { const t = t0 + k * WALL.scanStep; heights[k] = field.height(chain.x[i] + nx * t, chain.z[i] + nz * t); lands[k] = field.groundHeight(chain.x[i] + nx * t, chain.z[i] + nz * t); }
    scanned++;
    const ramp = findRamp(heights, lands);
    if (!ramp) return null;
    const rising = ramp.rise > 0, tFoot = t0 + (rising ? ramp.first : ramp.last) * WALL.scanStep, toHigh = rising ? 1 : -1;
    const tHead = t0 + (rising ? ramp.last : ramp.first) * WALL.scanStep;
    return { rise: Math.abs(ramp.rise), slope: ramp.maxSlope, depth: Math.max(WALL.minDepth, Math.abs(tHead - tFoot)), x: chain.x[i] + nx * tFoot, z: chain.z[i] + nz * tFoot, nx: nx * toHigh, nz: nz * toHigh, top: Math.max(heights[ramp.first], heights[ramp.last]), bottom: Math.min(heights[ramp.first], heights[ramp.last]) };
  };
  const ways = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road));
  for (const chain of ways) {
    for (let i = 0; i < chain.x.length; i += STRIDE) {
      for (const side of [1, -1]) {
        // a ramp whose foot or head lies on tarmac (two carriageways of different levels that overlap in plan, an interchange) cannot have a wall: a wall is never built on a carriageway; counted apart
        const usable = (q) => {
          wprobe.sdCar = 9; net.carve(q.x, q.z, wprobe);
          if (wprobe.sdCar < -0.6) return false;
          net.carve(q.x + q.nx * q.depth, q.z + q.nz * q.depth, wprobe);                    // the head of the ramp, or (the baker pulls the back of the block in by at most 0.6 m) just short of it
          if (wprobe.sdCar >= -0.6) return true;
          net.carve(q.x + q.nx * Math.max(WALL.minDepth, q.depth - 0.6), q.z + q.nz * Math.max(WALL.minDepth, q.depth - 0.6), wprobe);
          return wprobe.sdCar >= -0.6;
        };
        const r = rampAt(chain, i, side);
        if (!r) continue;
        if (!usable(r)) { inRoad++; continue; }
        // a ramp the 1 m lattice cannot show (the drawn ground at its foot / head is more than the wall tolerance from the carve's own heights: a face of 5 m in 2 m at a hairpin) has no wall to stand on
        const tolR = Math.max(ON_RAMP, rampTolerance(r.rise, r.depth));
        if (Math.abs(surface.height(r.x, r.z) - r.bottom) > tolR || Math.abs(surface.height(r.x + r.nx * r.depth, r.z + r.nz * r.depth) - r.top) > tolR) { latticeLimited++; continue; }
        // a ramp that persists: the neighbouring sample has one too (or it is a big one)
        const neighbour = (k) => { if (k < 0 || k >= chain.x.length) return false; const q = rampAt(chain, k, side); return !!q && usable(q); };
        const persists = r.rise >= WALL.shortRise ? neighbour(i + 1) || neighbour(i - 1) : neighbour(i + 1) && neighbour(i - 1);   // (a low ramp that is only two samples long is carried by the ground, see bake_walls.mjs)
        if (!persists) continue;
        ramps++;
        if (!coveredBy(r.x, r.z, r.nx, r.nz, r.top)) { bare++; if (bareList.length < 5) bareList.push(`${Math.round(r.x)},${Math.round(r.z)} rise ${r.rise.toFixed(1)} slope ${r.slope.toFixed(1)}`); }
      }
    }
  }
  stats.wallCoverage = { scanned, ramps, bare, rampsInRoads: inRoad, latticeLimited };
  // a ramp seen at a single sample is noise that the baker drops (a wall needs two samples in a row): a few bare ramps are allowed, a stretch of them is not
  // A wall is never built on tarmac: the foot of its face and the back of its block (the two lines that carry the coping) lie outside every carriageway.
  {
    let onTarmac = 0, wallsOnTarmac = 0;
    for (const w of walls) {
      let hit = 0;
      for (const p of w.pts) for (const t of [0, p.depth]) { net.carve(p.x + p.nx * t, p.z + p.nz * t, wprobe); if (wprobe.sdCar < -0.7) hit++; }
      if (hit) { wallsOnTarmac++; onTarmac += hit; }
    }
    stats.wallsOnTarmac = wallsOnTarmac;
    check('retaining walls: no wall stands on a carriageway (face and back lines outside every carriageway, the edge line aside)', wallsOnTarmac === 0, `${wallsOnTarmac} of ${walls.length} walls, ${onTarmac} points`);
  }
  // A wall is solid for the car from both sides (wall-collider.js): 0.5 m in front of the face and 0.5 m behind the back of the block a body circle of the car collides, at every stretch
  // that is higher than half a metre (the tapered tips are not obstacles).
  {
    const collider = createWallCollider(walls, (x, z) => surface.height(x, z));       // the car on the ground (a bridge above a wall is another level)
    let stretches = 0, openLow = 0, openHigh = 0;
    for (const w of walls) {
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const p = w.pts[i], q = w.pts[i + 1];
        if ((p.top - p.bottom + q.top - q.bottom) / 2 < 0.5) continue;
        stretches++;
        const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, nx = (p.nx + q.nx) / 2, nz = (p.nz + q.nz) / 2, nl = Math.hypot(nx, nz) || 1, dep = (p.depth + q.depth) / 2;
        if (!collider.collide(mx - nx / nl * 0.5, mz - nz / nl * 0.5, 1.35)) openLow++;
        if (!collider.collide(mx + nx / nl * (dep + 0.5), mz + nz / nl * (dep + 0.5), 1.35)) openHigh++;
      }
    }
    stats.wallCollision = { stretches, openLow, openHigh, segments: collider.count };
    check('retaining walls are solid for the car from the low side and from the high side', openLow === 0 && openHigh === 0, `${openLow} stretches open from the low side, ${openHigh} from the high side, of ${stretches}`);
  }
  // The car itself: driven at a wall at full throttle for 4 s from 8 m away, from the low side (at the face) and from the high side (at the back of the block), it never gets across.
  {
    const collider = createWallCollider(walls, (x, z) => surface.height(x, z));
    const tested = [];
    for (const w of walls) {
      if (tested.length >= 14) break;
      if (w.pts.length < 5) continue;
      const k = w.pts.length >> 1, p = w.pts[k], q = w.pts[k + 1];
      if (Math.min(p.top - p.bottom, q.top - q.bottom) < WALL.shortRise) continue;
      tested.push({ w, p, q });
    }
    let crossed = 0, runs = 0;
    for (const { p, q } of tested) {
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, nl = Math.hypot(p.nx + q.nx, p.nz + q.nz) || 1;
      const nx = (p.nx + q.nx) / nl, nz = (p.nz + q.nz) / nl, dep = (p.depth + q.depth) / 2;
      for (const side of ['low', 'high']) {
        // low side: stands 8 m in front of the face and drives toward the high ground (+n); high side: 8 m behind the back and drives toward the face (-n)
        const sx = side === 'low' ? mx - nx * 8 : mx + nx * (dep + 8), sz = side === 'low' ? mz - nz * 8 : mz + nz * (dep + 8);
        const dir = side === 'low' ? 1 : -1;
        if (collider.collide(sx, sz, CAR.bodyRadius)) continue;
        const c = createCar({ ground: { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), hint() {} }, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide: collider.collide, start: null });
        c.reset(sx, sz, Math.atan2(nz * dir, nx * dir));
        for (let i = 0; i < 240; i++) c.step(1 / 60, { throttle: 1, brake: 0, steer: 0 });
        runs++;
        const st = c.state;
        // the position across the wall: along n from the face (low side: must stay < 0) / from the back (high side: must stay > 0)
        const across = side === 'low' ? (st.x - mx) * nx + (st.z - mz) * nz : (st.x - (mx + nx * dep)) * nx + (st.z - (mz + nz * dep)) * nz;
        if (side === 'low' ? across > 0.2 : across < -0.2) crossed++;
      }
    }
    stats.wallDrive = { runs, crossed };
    check('retaining walls: a car driven at a wall at full throttle (from the low side and from the high side) never gets across', runs >= 8 && crossed === 0, `${crossed} of ${runs} runs crossed`);
  }
  check('retaining walls: every ramp steeper than 2 m/m beside a way has a wall (the data is not stale: re-run scripts/luxdrive/bake_walls.mjs)', bare <= Math.max(3, Math.round(ramps * 0.04)), `${bare} of ${ramps} ramps bare (${scanned} profiles), e.g. ${bareList.join('; ')}`);
}

/* ---------------------------------------------------------------- L: junctions (markings and the drive across) */
if (wants('L')) {
  section('L junctions');
  const clusters = junctionClusters(net).slice(0, QUICK ? 8 : 20);
  // (1) No fragments: a cell of the lattice whose nodes lie on two DIFFERENT roads (or arms of one) draws no markings.  The markings are interpolated from the lat / s of the nearest road
  // at each node: where the nearest road changes inside a cell the interpolation draws stray dashes and diagonal bits (what the junction beside the start looked like).
  const SIDE_N = QUADTREE.cells + 3;
  let cellsChecked = 0, fragmentCells = 0;
  const fragList = [];
  for (const c of clusters) {
    const ex = Math.floor(c.x / QUADTREE.minSize) * QUADTREE.minSize, ez = Math.floor(c.z / QUADTREE.minSize) * QUADTREE.minSize;
    for (const [ox, oz] of [[0, 0], [-QUADTREE.minSize, 0], [QUADTREE.minSize, 0], [0, -QUADTREE.minSize], [0, QUADTREE.minSize]]) {
      const leaf = { x0: ex + ox, z0: ez + oz, step: 1, size: QUADTREE.minSize };
      const nodes = computeTileNodes(leaf, surface, field);
      const b = surface.block(leaf.x0 / QUADTREE.minSize, leaf.z0 / QUADTREE.minSize);
      for (let j = 0; j < QUADTREE.cells; j++) {
        for (let i = 0; i < QUADTREE.cells; i++) {
          const idx = [(j + 1) * SIDE_N + i + 1, (j + 1) * SIDE_N + i + 2, (j + 2) * SIDE_N + i + 1, (j + 2) * SIDE_N + i + 2];
          const painted = idx.some((o) => nodes.road2[o * 4 + 3] > 0.5 && nodes.road2[o * 4 + 1] > 0.5 && b.sdCar[o] <= 1.0);
          if (!painted) continue;
          cellsChecked++;
          const roads = new Set(idx.filter((o) => b.sdCar[o] < 0.3).map((o) => b.road[o]));
          if (roads.size >= 2) { fragmentCells++; if (fragList.length < 4) fragList.push(`${Math.round(leaf.x0 + i)},${Math.round(leaf.z0 + j)}`); }
        }
      }
    }
  }
  stats.junctionMarks = { junctions: clusters.length, cellsChecked, fragmentCells };
  check('junctions: no marking fragments (no painted lattice cell holds two roads) around the biggest junctions', fragmentCells === 0, `${fragmentCells} of ${cellsChecked} cells, e.g. ${fragList.join('; ')}`);
  // (2) The drive straight across: along every way of the biggest junctions, at 50 km/h, over the tarmac of the junction box.  Reported as stats (the vertical acceleration of a car that follows
  // the surface); the check is a guard against the ridge: the median over the junctions and the worst single box.
  const boxBobs = [], pitches = [];
  let worstBox = 0, worstAt = '';
  for (const c of clusters) {
    let cBob = 0;
    for (const way of c.ways) {
      const r = driveLine(surface, c, way);
      if (r.boxBob > cBob) cBob = r.boxBob;
      pitches.push(r.boxPitch);
    }
    boxBobs.push(cBob);
    if (cBob > worstBox) { worstBox = cBob; worstAt = `${Math.round(c.x)},${Math.round(c.z)}`; }
  }
  const sorted = boxBobs.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] || 0;
  stats.junctionDrive = { junctions: clusters.length, medianBoxBob: +median.toFixed(2), worstBoxBob: +worstBox.toFixed(2), worstAt };
  // m/s2 at 50 km/h (a road is 0.04).  The junction sheets (junction-surface.js) took the median from 4.9 to 0.5 and the worst from 21.8 to 1.9 (the steep old town aside).  Two junctions of the steep old town are
  // excepted from the worst with a bound of their own: Pafendaller Bierg / Stater Bierg (5297,8632: a pitch of 32 % and two ways ending 37 cm apart in level on it) and Waassergaass
  // (5349,8778: six ways at two levels 29 cm apart within one box); a plane is no fit for either, the sheet lets go of them and the layered beds stay.
  const MAX_MEDIAN_BOX_BOB = 1.0, MAX_WORST_BOX_BOB = 2.5, STEEP_OLD_TOWN = [[5297, 8632], [5349, 8778]], MAX_STEEP_BOX_BOB = 12;
  const isSteep = (at) => { const [x, z] = at.split(',').map(Number); return STEEP_OLD_TOWN.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 6); };
  let worstPlain = 0, worstPlainAt = '', worstSteep = 0;
  clusters.forEach((c, i) => { const at = `${Math.round(c.x)},${Math.round(c.z)}`; if (isSteep(at)) worstSteep = Math.max(worstSteep, boxBobs[i]); else if (boxBobs[i] > worstPlain) { worstPlain = boxBobs[i]; worstPlainAt = at; } });
  check(`junctions: driving straight across the ${clusters.length} biggest junctions (median over the junctions <= ${MAX_MEDIAN_BOX_BOB}, worst <= ${MAX_WORST_BOX_BOB} m/s2, the two steep old-town boxes <= ${MAX_STEEP_BOX_BOB}; target ${JUNCTION.maxBob})`,
    median <= MAX_MEDIAN_BOX_BOB && worstPlain <= MAX_WORST_BOX_BOB && worstSteep <= MAX_STEEP_BOX_BOB, `median ${median.toFixed(2)}, worst ${worstPlain.toFixed(2)} at ${worstPlainAt}, steep old town ${worstSteep.toFixed(2)}`);

  // (3) Asphalt only on the carriageway, never on a slope beside it (Nei Escher Strooss: the side of an overpass embankment was painted as tarmac).  Points of the painted carriageway (0.7 m
  // inside its edge, off the kerb) across every way (every 60th centre line sample, +-14 m), where the offset of the road the point is on is clean (its gradient within 15 % of 1): the
  // ground across that road steeper than 15 % is asphalt on a slope.  Guard at today's level (0.8 % of the points before this round; what remains are lanes that the land and a
  // neighbour at another level squeeze, see PROGRESS).
  {
    const S = net.samples, ri = { sdCar: 9 }, ra = {}, rb = {}, rc = {}, rd = {};
    const MAX_SLOPE = 0.15, MAX_SHARE = 0.006;
    let pts = 0, steep = 0;
    const steepList = [];
    for (let i = 0; i + 1 < S.x.length; i += 60) {
      if (S.road[i + 1] !== S.road[i]) continue;
      let dx = S.x[i + 1] - S.x[i], dz = S.z[i + 1] - S.z[i];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      for (let o = -14; o <= 14; o++) {
        const x = S.x[i] - dz * o, z = S.z[i] + dx * o;
        if (!(surface.roadInfoAt(x, z, ri).sdCar < -0.7)) continue;
        field.height(x + 0.5, z, ra); field.height(x - 0.5, z, rb); field.height(x, z + 0.5, rc); field.height(x, z - 0.5, rd);
        if (ra.road !== rb.road || rc.road !== rd.road || ra.road !== rc.road) continue;
        const gx = ra.lat - rb.lat, gz = rc.lat - rd.lat, g = Math.hypot(gx, gz);
        if (g < 0.85 || g > 1.15) continue;
        pts++;
        const across = Math.abs(surface.height(x + gx / g * 0.5, z + gz / g * 0.5) - surface.height(x - gx / g * 0.5, z - gz / g * 0.5));
        if (across > MAX_SLOPE) { steep++; if (steepList.length < 5) steepList.push(`${Math.round(x)},${Math.round(z)} ${(across * 100).toFixed(0)} %`); }
      }
    }
    stats.asphaltOnSlope = { points: pts, steep, share: +(steep / Math.max(1, pts)).toFixed(4) };
    check(`asphalt only on level carriageway: painted carriageway on ground steeper than ${MAX_SLOPE * 100} % across the road <= ${MAX_SHARE * 100} % of the points`, pts > 1000 && steep <= MAX_SHARE * pts,
      `${steep} of ${pts} points (${(100 * steep / Math.max(1, pts)).toFixed(2)} %), e.g. ${steepList.join('; ')}`);
  }
}

/* ---------------------------------------------------------------- M: the lane markings (marking-checks.js) */
if (wants('M')) {
  section('M markings');
  runMarkingChecks({ data, net, surface, field, decks: deckNetwork.decks.filter((d) => !landmarks.hiddenDecks.has(d.id)), check, stats, quick: QUICK });
}
/* ---------------------------------------------------------------- N: the bridges, the portals, the ride (harness-bridges.js) */
if (wants('N')) runBridgeChecks({ check, section, stats, data, surface, ground, net, portals, buildings, forest, playArea });
/* ---------------------------------------------------------------- O: the shallow tunnels that are open roads, the portals on their roads (harness-tunnels.js) */
if (wants('O')) runTunnelChecks({ check, section, stats, data, field, surface, ground, net, portals, buildings, forest, playArea });
if (wants('P')) runRoads9Checks({ check, section, stats, data, field, surface, ground, net, portals, buildings, forest, playArea, markDecks: deckNetwork.decks.filter((d) => !landmarks.hiddenDecks.has(d.id)) });

/* ---------------------------------------------------------------- the summary */
console.log(`\n${results.fail === 0 ? 'PASS' : 'FAIL'}  ${results.pass} checks passed, ${results.fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (results.fail) { for (const f of results.failures) console.log('  -', f); }
console.log(JSON.stringify(stats));
process.exit(results.fail === 0 ? 0 : 1);
