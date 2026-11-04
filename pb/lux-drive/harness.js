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
import { createDeckNetwork, createGround } from './decks.js';
import { createBuildingIndex } from './buildings.js';
import { createTreeIndex, treesOfBlock } from './trees.js';
import { createPortals } from './portals.js';
import { createPlayArea } from './play-area.js';
import { buildWorldMap } from './world-map.js';
import { createCar } from './car.js';
import { createChaseCamera } from './camera.js';
import { addBuilding, createBuildingMesh, KIND } from './building-mesh.js';
import { computeTileNodes, buildTileMesh, meshHeightAt } from './tile-mesh.js';
import { leafAt, selectTiles } from './quadtree.js';
import { createRng } from './noise.js';
import { WORLD, QUADTREE, CAMERA } from './config.js';

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
const maps = buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy });
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
  const chase = createChaseCamera(surface, (x, z, radius) => buildings.collide(x, z, radius));
  car.reset(start.x, start.z, start.yaw || 0);
  chase.snap(car.state);
  let bad = 0, below = 0, worstBelow = 0, maxSpeed = 0, camUnder = 0, worstCam = 0;
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
  }
  stats.carSteps = QUICK ? 600 : 3600;
  stats.carMaxSpeed = maxSpeed * 3.6;
  check('the car physics stays finite', bad === 0, `${bad} bad steps`);
  check('the car never sinks into the ground', below === 0, `${below} steps, worst ${worstBelow.toFixed(2)} m`);
  check('the car drives (it is not stuck)', maxSpeed > 5, `max ${(maxSpeed * 3.6).toFixed(0)} km/h`);
  stats.cameraUnder = camUnder;
  check('the camera is never under the ground', camUnder === 0, `${camUnder} frames, worst ${worstCam.toFixed(2)} m`);
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

/* ---------------------------------------------------------------- the summary */
console.log(`\n${results.fail === 0 ? 'PASS' : 'FAIL'}  ${results.pass} checks passed, ${results.fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (results.fail) { for (const f of results.failures) console.log('  -', f); }
console.log(JSON.stringify(stats));
process.exit(results.fail === 0 ? 0 : 1);
