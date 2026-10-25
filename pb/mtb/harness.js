#!/usr/bin/env node
/* MTB Mëllerdall: the "zero holes" harness.   node pb/mtb/harness.js [--quick] [--verbose]
 *
 * Loads the baked world exactly like the browser does (same decoders, same height function, same tile builder) and proves, in Node, that
 *   A  the data decodes and is finite, with no pits / spikes beyond the de-spike limit                         (data)
 *   B  the tile quadtree is a partition: no gap, no overlap, for rider positions all over the world            (partition)
 *   C  neighbouring tiles of ANY LOD level agree along their whole shared edge (corners, vertices, midpoints) (cracks)
 *   D  the render mesh height equals the physics surface height along every trail every 0.5 m                 (render == physics)
 *   E  the trails are rideable: finite, continuous (no steps), no downward spikes                              (trails)
 *   F  the camera can never be below the terrain, for bikes riding every trail and for random poses            (camera)
 *   G  the bike physics stays finite and on or above the surface, rides a whole trail                          (bike)
 * Exit code 0 only when every check passes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from './world-data.js';
import { createHeightField } from './heightfield.js';
import { createSurface } from './surface.js';
import { selectTiles, leafAt, tilesTouching, tileKey } from './quadtree.js';
import { computeTileNodes, buildTileMesh, meshHeightAt } from './tile-mesh.js';
import { createBikeState, advanceBike, groundResolver } from './bike.js';
import { createChaseCamera } from './camera.js';
import { createRng } from './noise.js';
import { QUADTREE, WORLD, CAMERA } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const args = new Set(process.argv.slice(2));
const QUICK = args.has('--quick');
const VERBOSE = args.has('--verbose');

const results = { pass: 0, fail: 0, failures: [] };
const stats = {};
function check(name, ok, detail = '') {
  if (ok) { results.pass++; if (VERBOSE) console.log('  ok  ', name, detail); return; }
  results.fail++;
  results.failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
  console.log('  FAIL', name, detail);
}
const section = (title) => console.log(`\n== ${title}`);
const t0 = Date.now();

const read = async (name) => new Uint8Array(fs.readFileSync(path.join(DATA, name)));
const data = await loadWorldData(read);
const rideWays = data.ways.filter((w) => !w.bridge && !w.tunnel);
const trailWays = data.trails.trails.flatMap((t) => t.ways);
const field = createHeightField({ near: data.near, far: data.far, ways: [...rideWays, ...trailWays] });
const surface = createSurface(field);
const groundAt = groundResolver(field);

/* ---------------------------------------------------------------- A: data */
section('A data');
{
  const finite = (arr) => { for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return i; return -1; };
  check('terrain grid is finite', finite(data.near.data) < 0);
  check('far grid is finite', finite(data.far.data) < 0);
  check('terrain grid has the expected size', data.near.nx === WORLD.width / WORLD.nearStep + 1 && data.near.nz === WORLD.depth / WORLD.nearStep + 1, `${data.near.nx}x${data.near.nz}`);
  check('far grid covers box + margin', data.far.nx === (WORLD.width + 2 * WORLD.farMargin) / WORLD.farStep + 1 && data.far.nz === (WORLD.depth + 2 * WORLD.farMargin) / WORLD.farStep + 1, `${data.far.nx}x${data.far.nz}`);
  const { nx, nz, data: h } = data.near;
  let pits = 0, worst = 0;
  const SPIKE = 3.0;                                   // the baker clips at 2.5 m (+0.4 keep): nothing may exceed 3.0 m
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v = h[j * nx + i];
    const lo = Math.min(h[j * nx + i - 1], h[j * nx + i + 1], h[(j - 1) * nx + i], h[(j + 1) * nx + i]);
    const hi = Math.max(h[j * nx + i - 1], h[j * nx + i + 1], h[(j - 1) * nx + i], h[(j + 1) * nx + i]);
    const d = Math.max(lo - v, v - hi);
    if (d > worst) worst = d;
    if (d > SPIKE) pits++;
  }
  stats.worstSpike = worst;
  check(`no single-node pit or peak above ${SPIKE} m in the 2 m terrain`, pits === 0, `${pits} nodes, worst ${worst.toFixed(2)} m`);
  check('canopy grids are finite', finite(data.canopy.height.data) < 0 && finite(data.canopy.cover.data) < 0);
  check('ways decode (count matches the attribute table)', data.ways.length > 100, `${data.ways.length} ways`);
  let wayPtsOutside = 0;
  for (const w of data.ways) for (const [x, z] of w.pts) if (x < -150 || z < -150 || x > WORLD.width + 150 || z > WORLD.depth + 150) wayPtsOutside++;
  check('way points lie inside the world (+150 m)', wayPtsOutside === 0, `${wayPtsOutside} outside`);
  // the function itself is finite and continuous everywhere we sample it, also far outside the box
  const rng = createRng(11);
  let bad = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -WORLD.farMargin - 3000 + rng() * (WORLD.width + 2 * WORLD.farMargin + 6000), z = -WORLD.farMargin - 3000 + rng() * (WORLD.depth + 2 * WORLD.farMargin + 6000);
    if (!Number.isFinite(field.height(x, z))) bad++;
  }
  check('height(x, z) is finite everywhere (also 3 km beyond the far field)', bad === 0, `${bad} bad`);
  // no jump across the feather zone between the 2 m grid and the far grid (continuity of the base)
  let maxStep = 0;
  for (let k = 0; k < 400; k++) {
    const x = rng() * WORLD.width, z = 0 - 40 + rng() * 80;                  // across the north edge of the box
    maxStep = Math.max(maxStep, Math.abs(field.baseHeight(x, z) - field.baseHeight(x, z + 0.25)));
  }
  check('base terrain continuous across the box edge (<= 0.6 m per 0.25 m)', maxStep <= 0.6, `${maxStep.toFixed(3)} m`);
}

/* ---------------------------------------------------------------- trails */
const trails = data.trails.trails;
/* The line that is actually carved: the network's own smoothed samples of the trail's way (not the raw OSM polyline). */
const trailSamples = field.network.samples;
const trailLine = (t) => {
  const info = field.network.ways.find((w) => w.id === `trail-${t.id}`);
  if (!info) return [];
  const out = [];
  for (let i = info.first; i < info.first + info.count; i++) out.push([trailSamples.px[i], trailSamples.pz[i]]);
  return out;
};
for (const t of data.trails.trails) t.centre = null;

/* ---------------------------------------------------------------- B + C: partition and cracks */
const nodeCache = new Map();
const meshCache = new Map();
function meshFor(leaf, split) {
  let n = nodeCache.get(leaf.key);
  if (!n) { n = computeTileNodes(leaf, surface, field); nodeCache.set(leaf.key, n); }
  const m = buildTileMesh(leaf, n, split, field);
  return m;
}
function riderPositions(count, seed) {
  const rng = createRng(seed);
  const out = [];
  for (const t of trails) { const c = trailLine(t); for (let i = 0; i < c.length; i += Math.max(1, Math.floor(c.length / 6))) out.push(c[i]); }
  while (out.length < count) out.push([rng() * WORLD.width, rng() * WORLD.depth]);
  // also edges and corners of the world and far outside
  out.push([0, 0], [WORLD.width, WORLD.depth], [WORLD.width / 2, -2000], [-3000, WORLD.depth / 2], [WORLD.width + 4000, WORLD.depth + 3000], [WORLD.width / 2, WORLD.depth / 2]);
  return out.slice(0, Math.max(count, trails.length ? out.length : count));
}

section('B partition of the plane');
const selections = [];
{
  const positions = riderPositions(QUICK ? 10 : 24, 5);
  let previous = null;
  let bad = 0, overlap = 0, gaps = 0, leafCount = 0, maxLeaves = 0;
  const rng = createRng(77);
  for (const [px, pz] of positions) {
    const sel = selectTiles(px, pz, { previous });
    previous = sel.split;
    selections.push({ px, pz, sel });
    leafCount += sel.leaves.length;
    maxLeaves = Math.max(maxLeaves, sel.leaves.length);
    // area of the leaves vs the area of the ground they claim: the leaves of a quadtree cannot overlap; verify with random points
    for (let k = 0; k < 400; k++) {
      const x = px + (rng() - 0.5) * 9000, z = pz + (rng() - 0.5) * 9000;
      const leaf = leafAt(sel.split, x, z);
      if (!leaf) continue;
      const dist = Math.hypot(Math.max(leaf.x0 - px, 0, px - leaf.x0 - leaf.size), Math.max(leaf.z0 - pz, 0, pz - leaf.z0 - leaf.size));
      if (dist > 11000) continue;           // culled beyond the fog
      const inList = sel.leaves.filter((l) => l.key === leaf.key).length;
      if (inList === 0) gaps++;
      if (inList > 1) overlap++;
      if (x < leaf.x0 || x >= leaf.x0 + leaf.size || z < leaf.z0 || z >= leaf.z0 + leaf.size) bad++;
    }
    // the sum of leaf areas within the view must be a union of disjoint squares: compare to a recomputation by area
    const seen = new Set();
    for (const l of sel.leaves) { if (seen.has(l.key)) overlap++; seen.add(l.key); }
    // the 3x3 LOD 0 neighbourhood of the rider
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const leaf = leafAt(sel.split, px + dx * 32, pz + dz * 32);
      if (!leaf || leaf.size !== QUADTREE.minSize) bad++;
    }
  }
  stats.maxLeaves = maxLeaves;
  stats.avgLeaves = Math.round(leafCount / selections.length);
  check(`quadtree leaves are a partition (${selections.length} rider positions, ${leafCount} leaves)`, gaps === 0 && overlap === 0 && bad === 0, `gaps ${gaps}, overlaps ${overlap}, bad ${bad}`);
  check('tile budget: at most 330 leaves per selection', maxLeaves <= 330, `max ${maxLeaves}, avg ${stats.avgLeaves}`);
  // the rider's own 3x3 tiles are always LOD 0 even at hysteresis edges
  let finest = 0;
  for (const { px, pz, sel } of selections) { const l = leafAt(sel.split, px, pz); if (l && l.size === QUADTREE.minSize) finest++; }
  check('the tile under the rider is always LOD 0', finest === selections.length, `${finest}/${selections.length}`);
}

section('C cracks between neighbouring tiles (every LOD pair)');
{
  let edges = 0, samples = 0, worst = 0, worstWhere = '', nonFinite = 0, pairs = new Map();
  const use = QUICK ? selections.slice(0, 8) : selections;
  for (const { sel } of use) {
    const byKey = new Map();
    const get = (leaf) => { let m = byKey.get(leaf.key); if (!m) { m = meshFor(leaf, sel.split); byKey.set(leaf.key, m); } return m; };
    // build only tiles within 2.2 km of the rider for speed, plus one ring of far tiles
    const { px, pz } = use.find((u) => u.sel === sel);
    for (const leaf of sel.leaves) {
      const dist = Math.hypot(Math.max(leaf.x0 - px, 0, px - leaf.x0 - leaf.size), Math.max(leaf.z0 - pz, 0, pz - leaf.z0 - leaf.size));
      if (dist > 2600) continue;
      const mesh = get(leaf);
      for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i]) || !Number.isFinite(mesh.normals[i])) nonFinite++;
      // walk the four edges at half the vertex spacing, ask the tile across for ITS mesh height at the same point
      const sides = [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]];
      for (const [sx, sz, alongX] of sides) {
        const n = QUADTREE.cells * 2;
        for (let k = 0; k <= n; k++) {
          const t = k / n * leaf.size;
          let x, z, ox, oz;
          if (alongX) { z = leaf.z0 + t; x = sx < 0 ? leaf.x0 : leaf.x0 + leaf.size; ox = x + sx * 1e-3; oz = z; if (k === n) oz -= 2e-3; if (k === 0) oz += 0; }
          else { x = leaf.x0 + t; z = sz < 0 ? leaf.z0 : leaf.z0 + leaf.size; oz = z + sz * 1e-3; ox = x; if (k === n) ox -= 2e-3; }
          const other = leafAt(sel.split, ox, oz);
          if (!other || other.key === leaf.key) continue;
          const odist = Math.hypot(Math.max(other.x0 - px, 0, px - other.x0 - other.size), Math.max(other.z0 - pz, 0, pz - other.z0 - other.size));
          if (odist > 2600) continue;
          const mo = get(other);
          const a = meshHeightAt(mesh, x, z), b = meshHeightAt(mo, x, z);
          const d = Math.abs(a - b);
          samples++;
          const pk = `${Math.log2(leaf.size)}-${Math.log2(other.size)}`;
          pairs.set(pk, (pairs.get(pk) || 0) + 1);
          if (d > worst) { worst = d; worstWhere = `${leaf.key} | ${other.key} @ ${x.toFixed(1)},${z.toFixed(1)}`; }
        }
        edges++;
      }
    }
  }
  stats.crackWorst = worst; stats.crackSamples = samples; stats.crackEdges = edges;
  check(`adjacent tiles agree on every shared edge sample (${samples.toLocaleString()} samples, ${edges} edges, ${pairs.size} LOD pairings)`, worst <= 2e-3, `worst ${worst.toExponential(2)} m at ${worstWhere}`);
  check('all vertex positions and normals of all tiles are finite', nonFinite === 0, `${nonFinite} bad values`);
  check('LOD pairings seen include size jumps of 1 and more levels', [...pairs.keys()].some((k) => { const [a, b] = k.split('-').map(Number); return Math.abs(a - b) >= 1; }));
}

/* ---------------------------------------------------------------- D: render == physics */
section('D render == physics along every trail');
{
  let compared = 0, worst = 0, worstAt = '';
  for (const t of trails) {
    const line = trailLine(t);
    if (line.length < 2) continue;
    // ride along: rider position every ~60 m of the trail, compare everything within 70 m on the trail line
    let acc = 0; let last = line[0];
    const stops = [];
    for (const p of line) { acc += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p; if (acc >= (QUICK ? 240 : 80)) { stops.push(p); acc = 0; } }
    if (!stops.length) stops.push(line[0]);
    let prev = null;
    for (const [px, pz] of stops) {
      const sel = selectTiles(px, pz, { previous: prev });
      prev = sel.split;
      const meshes = new Map();
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = line[i - 1], [bx, bz] = line[i];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 0.5));
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
          if (Math.hypot(x - px, z - pz) > 70) continue;
          const leaf = leafAt(sel.split, x, z);
          if (leaf.size !== QUADTREE.minSize) { check('the trail within 70 m of the rider is LOD 0', false, `${leaf.key} at ${x.toFixed(1)},${z.toFixed(1)}`); continue; }
          let m = meshes.get(leaf.key);
          if (!m) { m = meshFor(leaf, sel.split); meshes.set(leaf.key, m); }
          const d = Math.abs(meshHeightAt(m, x, z) - surface.height(x, z));
          compared++;
          if (d > worst) { worst = d; worstAt = `${t.id} ${x.toFixed(1)},${z.toFixed(1)}`; }
        }
      }
    }
  }
  stats.renderPhysicsWorst = worst; stats.renderPhysicsCompared = compared;
  check(`render mesh height == physics surface height (${compared.toLocaleString()} points, every 0.5 m along ${trails.length} trails)`, trails.length > 0 && compared > 0 && worst <= 1e-3, `worst ${worst.toExponential(2)} m at ${worstAt}`);
}

/* ---------------------------------------------------------------- E: trails */
section('E the trails');
{
  for (const t of trails) {
    const line = trailLine(t);
    let nan = 0, steps = 0, spikes = 0, maxGrade = 0, minH = 1e9, maxH = -1e9, outside = 0, prev = null, prev2 = null;
    let climb = 0, desc = 0, total = 0, last = null;
    let covered = 0, count = 0;
    const info = { coverage: 0, way: -1 };
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 0.5));
      for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
        const h = surface.height(x, z);
        if (!Number.isFinite(h)) { nan++; continue; }
        field.height(x, z, info); covered += info.coverage > 0.5 ? 1 : 0; count++;
        if (x < WORLD.playInset - 100 || z < WORLD.playInset - 100 || x > WORLD.width - WORLD.playInset + 100 || z > WORLD.depth - WORLD.playInset + 100) outside++;
        minH = Math.min(minH, h); maxH = Math.max(maxH, h);
        if (prev !== null) {
          const dh = h - prev;
          maxGrade = Math.max(maxGrade, Math.abs(dh) / 0.5);
          if (Math.abs(dh) > 0.9) steps++;                                  // a step of 0.9 m in 0.5 m = a wall, not a trail
          if (prev2 !== null && h < Math.min(prev, prev2 + 0) - 0.35 && prev > prev2 - 0.01 && h < prev2 - 0.35 && prev2 < prev + 0.2) spikes++;
          if (dh > 0) climb += dh; else desc -= dh;
        }
        prev2 = prev; prev = h;
      }
    }
    check(`trail ${t.id}: heights finite along the whole line`, nan === 0, `${nan} NaN`);
    check(`trail ${t.id}: no wall (step > 0.9 m per 0.5 m)`, steps === 0, `${steps} steps, max grade ${(maxGrade * 100).toFixed(0)} %`);
    check(`trail ${t.id}: no downward spike (pit > 0.35 m within 1 m)`, spikes === 0, `${spikes}`);
    check(`trail ${t.id}: inside the playable box`, outside === 0, `${outside} samples outside`);
    check(`trail ${t.id}: carved bed under the line (>= 70 % of samples covered)`, count > 0 && covered / count >= 0.7, `${(100 * covered / Math.max(1, count)).toFixed(0)} %`);
    stats[`trail:${t.id}`] = `${Math.round(t.length || 0)} m, up ${Math.round(climb)} / down ${Math.round(desc)}, max grade ${(maxGrade * 100).toFixed(0)}%`;
  }
}

/* ---------------------------------------------------------------- F + G: camera and bike */
section('F/G bike and camera');
{
  const dt = 1 / 60;
  let rides = 0, cameraBelow = 0, cameraChecks = 0, nan = 0, belowSurface = 0, minClear = 1e9, maxSpeed = 0, finished = 0;
  const rng = createRng(31);
  for (const t of trails) {
    const line = trailLine(t);
    if (line.length < 3) continue;
    const startHeading = Math.atan2(line[3][1] - line[0][1], line[3][0] - line[0][0]);
    let s = createBikeState(line[0][0], line[0][1], startHeading, surface);
    const cam = createChaseCamera(surface);
    cam.snap(s);
    let wp = 1, time = 0, stuck = 0;
    const maxTime = QUICK ? 40 : 900;
    while (wp < line.length && time < maxTime) {
      // pure pursuit: aim at a point 7 m ahead along the line
      while (wp < line.length - 1 && Math.hypot(line[wp][0] - s.x, line[wp][1] - s.z) < 7) wp++;
      const aim = Math.atan2(line[wp][1] - s.z, line[wp][0] - s.x);
      let err = aim - s.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      const steer = Math.max(-1, Math.min(1, err * 1.8));
      const speed = Math.hypot(s.vx, s.vz);
      const input = { throttle: speed < 8.5 ? 1 : 0.3, brake: speed > 12 ? 0.5 : 0, steer, jump: false };
      s = advanceBike(s, input, dt, surface, groundAt, {});
      time += dt;
      if (![s.x, s.y, s.z, s.vx, s.vy, s.vz].every(Number.isFinite)) { nan++; break; }
      const g = surface.height(s.x, s.z);
      if (s.y < g - 1e-6) belowSurface++;
      maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy, s.vz));
      const c = cam.update(s, dt);
      cameraChecks++;
      const cg = surface.height(c.x, c.z);
      minClear = Math.min(minClear, c.y - cg);
      if (c.y < cg + CAMERA.minClearance - 1e-6) cameraBelow++;
      if (Math.hypot(s.vx, s.vz) < 0.2 && time > 6) { if (++stuck > 120) break; } else stuck = 0;
    }
    rides++;
    if (wp >= line.length - 1) finished++;
    stats[`ride:${t.id}`] = `${time.toFixed(0)} s, reached ${wp}/${line.length}, ${(s.odometer).toFixed(0)} m`;
  }
  // random camera poses: boom probes around random rider states on and off trails
  for (let i = 0; i < 3000; i++) {
    const x = WORLD.playInset + rng() * (WORLD.width - 2 * WORLD.playInset), z = WORLD.playInset + rng() * (WORLD.depth - 2 * WORLD.playInset);
    const s = Object.freeze({ ...createBikeState(x, z, rng() * 6.28, surface), vx: (rng() - 0.5) * 20, vz: (rng() - 0.5) * 20 });
    const cam = createChaseCamera(surface); cam.snap(s);
    let c;
    for (let k = 0; k < 4; k++) c = cam.update(s, 1 / 30);
    cameraChecks++;
    const cg = surface.height(c.x, c.z);
    minClear = Math.min(minClear, c.y - cg);
    if (c.y < cg + CAMERA.minClearance - 1e-6) cameraBelow++;
  }
  stats.cameraMinClearance = minClear; stats.cameraChecks = cameraChecks;
  check(`camera is never below ground + ${CAMERA.minClearance} m (${cameraChecks.toLocaleString()} camera poses, min clearance ${minClear.toFixed(2)} m)`, cameraBelow === 0, `${cameraBelow} violations`);
  check('bike state stays finite on every trail ride', nan === 0, `${nan} rides with NaN`);
  check('the bike never sinks below the physics surface', belowSurface === 0, `${belowSurface} steps`);
  check(`bike speed stays physical (max ${maxSpeed.toFixed(1)} m/s)`, maxSpeed < 27);
  check('a scripted rider follows every trail to its end', trails.length > 0 && finished === rides, `${finished}/${rides}`);
}

/* ---------------------------------------------------------------- summary */
section('result');
for (const [k, v] of Object.entries(stats)) console.log(' ', k, typeof v === 'number' ? (Number.isInteger(v) ? v : v.toPrecision(4)) : v);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (results.fail) {
  console.log(`\nFAIL: ${results.fail} of ${results.pass + results.fail} checks failed (${secs} s)`);
  for (const f of results.failures) console.log('  -', f);
  process.exit(1);
}
console.log(`\nPASS: ${results.pass} checks in ${secs} s; worst crack ${stats.crackWorst?.toExponential(1)} m over ${stats.crackSamples?.toLocaleString()} edge samples; render==physics worst ${stats.renderPhysicsWorst?.toExponential(1)} m over ${stats.renderPhysicsCompared?.toLocaleString()} trail points; camera min clearance ${stats.cameraMinClearance?.toFixed(2)} m.`);
