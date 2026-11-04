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
import { createBuildingIndex } from './buildings.js';
import { createTreeIndex, treesOfBlock } from './trees.js';
import { createPortals } from './portals.js';
import { createPlayArea } from './play-area.js';
import { buildWorldMap } from './world-map.js';
import { createCar } from './car.js';
import { createChaseCamera } from './camera.js';
import { createRoadIndex, isCarRoad } from './road-index.js';
import { createGearbox, ENGINE, squealLevel, thudLevel } from './sound-model.js';
import { createQualityStepper } from './quality-step.js';
import { roadDirectionAt } from './roads.js';
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const args = new Set(process.argv.slice(2));
const QUICK = args.has('--quick');
const VERBOSE = args.has('--verbose');

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

const field = createHeightField({ near: data.near, far: data.far, roads: data.roads });
const surface = createSurface(field);
const deckNetwork = createDeckNetwork(data.decks, surface);
const ground = createGround(surface, deckNetwork);
const buildings = createBuildingIndex(data.buildings);
const portals = createPortals(data.roads);
const playArea = createPlayArea(area);
const maps = buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy, buildings: data.buildings });
const forest = createTreeIndex({ map: maps, field, network: field.network, buildings, trees: data.trees });
const net = field.network;

/* ---------------------------------------------------------------- A: the data */
section('A data');
{
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
section('B roads');
{
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
      if (b > 0) bands.push(b);
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
section('C city');
{
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
section('D decks');
{
  // Every deck stands on a way that rides over the others: a deck far from any bridge road is wrong (the reviewer
  // saw small dark boxes floating near the roads).
  const overRoads = data.roads.filter((r) => (r.over || r.bridge) && !r.tunnel);
  const decks = deckNetwork.decks;                 // the decks the game draws: their ends stand on the ground
  let orphan = 0;
  const orphanList = [];
  for (const d of decks) {
    let best = Infinity;
    for (const r of overRoads) {
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const ax = r.pts[k][0], az = r.pts[k][1], bx = r.pts[k + 1][0], bz = r.pts[k + 1][1];
        const ex = bx - ax, ez = bz - az;
        const ll = ex * ex + ez * ez;
        if (ll < 1e-9) continue;
        let t = ((d.pts[0][0] - ax) * ex + (d.pts[0][1] - az) * ez) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = Math.min(best, Math.hypot(d.pts[0][0] - (ax + ex * t), d.pts[0][1] - (az + ez * t)));
      }
    }
    if (best > 6) { orphan++; if (orphanList.length < 6) orphanList.push({ x: Math.round(d.pts[0][0]), z: Math.round(d.pts[0][1]), near: +best.toFixed(1) }); }
  }
  stats.deckOrphans = orphan;
  check('every deck stands on a way that rides over the others', orphan === 0,
    `${orphan} of ${decks.length} decks${orphanList.length ? ' ' + JSON.stringify(orphanList) : ''}`);

  // The deck meets the ground at its two ends: it is pinned to the approach road, not floating in the air.
  let floating = 0, worst = 0;
  const floatList = [];
  for (const d of decks) {
    for (const i of [0, d.pts.length - 1]) {
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

  // The ground under a bridge is the ground: no road may cut a pit under the deck (the reviewer's overpass = pit).
  // The ends of the deck are where the approach road is, and a road on an embankment has the land beside it:
  // that is the bench of the road, not a pit, so the ends are not measured.
  let pits = 0, worstPit = 0;
  for (const d of decks) {
    for (let i = 1; i < d.pts.length - 1; i++) {
      const x = d.pts[i][0], z = d.pts[i][1];
      const land = field.baseHeight(x, z);
      const g = field.height(x, z);
      if (land - g > 1.0) { pits++; worstPit = Math.max(worstPit, land - g); }
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
}

/* ---------------------------------------------------------------- D2: the portals */
section('D2 portals');
{
  // Every portal stands on the ground: the headwall is buried under it and the mouth of the tunnel opens at
  // the level of the road that leads to it.  A wall that hangs in the air is the small dark box the
  // reviewer saw near the roads.
  //
  // The road that leads to the mouth ends up to seven metres before it, so the two levels differ by the
  // slope of the road: two metres of difference is a steep approach, more than that is a mouth in the air.
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
    if (gap > 2.0 || base > y0) {
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
section('E trees');
{
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

  // the woods: the trees of the blocks near the start stand on the ground too
  const rng = createRng(23);
  let woodFloating = 0, woodWorst = 0, woodCount = 0, woodInHouse = 0;
  for (let i = 0; i < (QUICK ? 20 : 120); i++) {
    const bx = Math.floor(rng() * 400), bz = Math.floor(rng() * 400);
    const list = treesOfBlock(bx, bz, { map: maps, field, network: field.network, buildings });
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
section('F car and camera');
{
  const collide = (x, z, radius) => buildings.collide(x, z, radius) || portals.collide(x, z, radius) ||
    forest.collide(x, z, radius) || playArea.collide(x, z, radius);
  const start = data.places.start;
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide, start });
  const chase = createChaseCamera(surface, (x, z, radius) => buildings.collide(x, z, radius) || forest.collide(x, z, radius) || portals.collide(x, z, radius));
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
section('F2 kaart, sound, auto-step');
{
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
section('G render == physics');
{
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
section('H tram + lights');
{
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
  const lights = placeStreetLights({ roads: data.roads, network: net, buildings, map: maps });
  stats.streetLights = lights.count;
  check('the city has street lights (> 3000)', lights.count > 3000, `${lights.count}`);
  let lampInHouse = 0, lampInRoad = 0, lampOut = 0;
  const li = { sdCar: 9, sdPave: 9 };
  for (let i = 0; i < lights.count; i++) {
    if (buildings.collide(lights.x[i], lights.z[i], 0.2)) lampInHouse++;
    net.carve(lights.x[i], lights.z[i], li);
    if (li.sdCar < 0) lampInRoad++;
    if (lights.x[i] < 0 || lights.z[i] < 0 || lights.x[i] > WORLD.width || lights.z[i] > WORLD.depth) lampOut++;
  }
  check('no street light stands inside a house', lampInHouse === 0, `${lampInHouse}`);
  check('no street light stands in a carriageway', lampInRoad === 0, `${lampInRoad}`);
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
section('I smooth roads');
{
  // Ian: "the road is really bumpy and not level at all".  A real street is smooth along its length (only its real gradient), has
  // a gentle constant crossfall and a kerb of constant height; and what the player SEES (the render tile of the lattice the game
  // uses at that distance) is the same surface as the height function, at every quality level.
  const li = { sdCar: 9, sdPave: 9 };
  const rng = createRng(77);
  const WINDOW = 10, MAX_DEV = 0.03, MAX_CROSSFALL = 0.025, MAX_KERB_DEV = 0.03;
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
  // the ways: carved, at ground level (layer 0, not riding over anything), long enough to hold a window; half in the town, half outside
  const urban = [], rural = [];
  for (const ch of net.chains) {
    if (ch.tagged || net.overRoads.has(ch.road) || ch.arc[ch.arc.length - 1] < 3 * WINDOW) continue;
    const mid = Math.floor(ch.x.length / 2);
    (buildings.near(ch.x[mid], ch.z[mid], 60).length > 6 ? urban : rural).push(ch);
  }
  const pick = (list, n) => { const out = [], pool = list.slice(); while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]); return out; };
  const ways = [...pick(urban, 100), ...pick(rural, 100)];
  let measured = 0, worstDev = 0, worstAt = null, badWays = 0, worstFall = 0, worstFallAt = null, fallBad = 0, kerbWorst = 0, kerbBad = 0, kerbMeasured = 0, points = 0;
  const lineAt = (ch, d, out) => {                                     // the point of the centre line at the distance d along it
    let k = 0;
    while (k < ch.arc.length - 2 && ch.arc[k + 1] < d) k++;
    const t = (d - ch.arc[k]) / Math.max(1e-9, ch.arc[k + 1] - ch.arc[k]);
    out.x = ch.x[k] + (ch.x[k + 1] - ch.x[k]) * t; out.z = ch.z[k] + (ch.z[k + 1] - ch.z[k]) * t;
    const l = Math.hypot(ch.x[k + 1] - ch.x[k], ch.z[k + 1] - ch.z[k]) || 1;
    out.nx = -(ch.z[k + 1] - ch.z[k]) / l; out.nz = (ch.x[k + 1] - ch.x[k]) / l;
    return out;
  };
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
    let wayWorst = 0, any = false;
    for (let q = WINDOW; q <= m - WINDOW; q++) {
      let ok = true;
      for (let j = -WINDOW; j <= WINDOW; j++) if (!clean[q + j]) { ok = false; break; }
      if (!ok) continue;
      any = true; points++;
      let sum = 0;
      for (let j = -WINDOW; j <= WINDOW; j++) sum += h[q + j];
      const dev = Math.abs(h[q] - sum / (2 * WINDOW + 1));
      if (dev > wayWorst) wayWorst = dev;
      if (dev > worstDev) { worstDev = dev; worstAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} ${Math.round(pt.x)},${Math.round(pt.z)}`; lineAt(ch, q, pt); worstAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
      if (q % 3 === 0) {
        lineAt(ch, q, pt);
        // the crossfall: left and right of the centre line, inside the carriageway
        const w = hw * 0.8;
        const fall = Math.abs(surface.height(pt.x - pt.nx * w, pt.z - pt.nz * w) - surface.height(pt.x + pt.nx * w, pt.z + pt.nz * w)) / (2 * w);
        if (fall > worstFall) { worstFall = fall; worstFallAt = `${data.roads[ch.road].name || data.roads[ch.road].kind} at ${Math.round(pt.x)},${Math.round(pt.z)}`; }
        if (fall > MAX_CROSSFALL) fallBad++;
        // the kerb: its height over the carriageway beside it is the same all along the street
        if (kerbH > 0) {
          const a = field.height(pt.x + pt.nx * (hw - 0.15), pt.z + pt.nz * (hw - 0.15), li), onKerb = li.road === ch.road;
          const b = field.height(pt.x + pt.nx * (hw + kerbW + 0.1), pt.z + pt.nz * (hw + kerbW + 0.1), li);
          if (onKerb && li.sdCar > 0.05) {
            kerbMeasured++;
            const dk = Math.abs((b - a) - kerbH);
            if (dk > kerbWorst) kerbWorst = dk;
            if (dk > MAX_KERB_DEV) kerbBad++;
          }
        }
      }
    }
    if (any) measured++;
    if (wayWorst > MAX_DEV) badWays++;
  }
  stats.roadSmooth = { ways: ways.length, measuredWays: measured, points, worstDevCm: +(worstDev * 100).toFixed(2), worstCrossfallPct: +(worstFall * 100).toFixed(2), kerbWorstCm: +(kerbWorst * 100).toFixed(2) };
  check('the carved ways measured are enough (200 sampled, urban + rural, most with a clean stretch)', measured >= 150, `${measured} of ${ways.length} ways, ${points} points`);
  check(`every carved centre line is within ${MAX_DEV * 100} cm of its 20 m moving mean (no waves, no bumps; junction aprons and underpasses excepted)`, badWays === 0, `${badWays} ways over, worst ${(worstDev * 100).toFixed(2)} cm at ${worstAt}`);
  check(`the crossfall is gentle and constant (<= ${MAX_CROSSFALL * 100} %)`, fallBad === 0, `${fallBad} points over, worst ${(worstFall * 100).toFixed(2)} % at ${worstFallAt}`);
  check(`the kerb stands at a constant height (+-${MAX_KERB_DEV * 100} cm of ${(ROAD.kerbHeight * 100).toFixed(0)} cm)`, kerbBad === 0 && kerbMeasured > 200, `${kerbMeasured} kerbs measured, ${kerbBad} off, worst ${(kerbWorst * 100).toFixed(2)} cm`);
}

/* ---------------------------------------------------------------- J: what is drawn near the car is the surface, at every quality */
section('J render lattice');
{
  // The tile the game builds for the car at each quality level (the same quadtree selection, the same tile builder): within 40 m of
  // the car the lattice is the 1 m physics lattice and the carriageway of the mesh is the height function to the centimetre; within
  // 80 m it is at most a 2 m lattice (the UI branch's low quality left a 4 m lattice from 26 m on, a faceted street in front of the car).
  const li = { sdCar: 9, sdPave: 9 };
  const rng2 = createRng(91);
  const ways = net.chains.filter((c) => !c.tagged && !net.overRoads.has(c.road) && c.arc[c.arc.length - 1] > 40);
  const MAX_MESH_DEV = 0.03;
  for (const [qid, Q] of Object.entries(QUALITY)) {
    let worst = 0, worstAt = '', measured = 0, coarseNear = 0, coarseMid = 0, bad = 0;
    for (let n = 0; n < (QUICK ? 6 : 24); n++) {
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
          const nx = i + 1 < way.x.length ? -(way.z[i + 1] - way.z[i]) : -(way.z[i] - way.z[i - 1]);
          const nz = i + 1 < way.x.length ? (way.x[i + 1] - way.x[i]) : (way.x[i] - way.x[i - 1]);
          const nl = Math.hypot(nx, nz) || 1;
          for (const lat of [-0.8, 0, 0.8]) {
            const px = way.x[i] + (nx / nl) * lat * hwW, pz = way.z[i] + (nz / nl) * lat * hwW;
            const leaf = leafAt(sel.split, px, pz);
            const entry = leaf && meshes.get(leaf.key);
            if (!entry) continue;
            // a point near the border of its tile is stitched to the coarser neighbour: the mesh there is the neighbour's polyline
            if (px - leaf.x0 < leaf.step * 1.5 || leaf.x0 + leaf.size - px < leaf.step * 1.5 || pz - leaf.z0 < leaf.step * 1.5 || leaf.z0 + leaf.size - pz < leaf.step * 1.5) continue;
            net.carve(px, pz, li);
            if (li.sdCar > -0.3 || li.road !== way.road) continue;              // only the tarmac of this way (a junction is the blend of two)
            const dv = Math.abs(meshHeightAt(entry.mesh, px, pz) - field.height(px, pz));
            measured++;
            if (dv > MAX_MESH_DEV) bad++;
            if (dv > worst) { worst = dv; worstAt = `${Math.round(px)},${Math.round(pz)} step ${leaf.step}`; }
          }
        }
      }
    }
    stats[`renderLattice_${qid}`] = { measured, worstCm: +(worst * 100).toFixed(2) };
    check(`${qid}: the lattice within 40 m of the car is 1 m, within 80 m at most 2 m (a road is never faceted near the car)`, coarseNear === 0 && coarseMid === 0, `${coarseNear} tiles near coarser than 1 m, ${coarseMid} within 80 m coarser than 2 m`);
    check(`${qid}: the tile mesh within 40 m is the height function on the carriageway (<= ${MAX_MESH_DEV * 100} cm)`, measured > 100 && bad === 0, `${measured} points, ${bad} off, worst ${(worst * 100).toFixed(2)} cm at ${worstAt}`);
  }
}

/* ---------------------------------------------------------------- the summary */
console.log(`\n${results.fail === 0 ? 'PASS' : 'FAIL'}  ${results.pass} checks passed, ${results.fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (results.fail) { for (const f of results.failures) console.log('  -', f); }
console.log(JSON.stringify(stats));
process.exit(results.fail === 0 ? 0 : 1);
