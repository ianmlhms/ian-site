/* Geometry check of the station patches (the LOD2 / OSM buildings the simulator draws): degenerate, huge, twisted (non-planar), out-of-footprint and floating faces.
 *   node scripts/zuch/patch_geometry_check.mjs [key ...] [--json]      exit code 1 when a face fails and is not in scripts/zuch/patch_geometry_allow.json
 * Also imported by scripts/flows/train_sim_world.mjs (checkPatches).  Patch frame: x lateral, z along, y above the formation level; faces are rings [[x, y, z], ...]. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', 'pb', 'train-sim', 'data', 'stations');
const ALLOW_FILE = path.join(HERE, 'patch_geometry_allow.json');

export const LIMITS = Object.freeze({
  minArea: 0.0001,           // m2: smaller faces are degenerate slivers
  maxExtent: 220,           // m: no single LOD2 face spans more than this (a 250 m platform roof wall did)
  maxHeight: 90,            // m
  maxPlaneDev: 2.0,         // m: a roof or wall ring further than this from its best plane is twisted (smaller warps are normal in LOD2; the renderer drops faces its triangulation cannot cover)
  footprintMargin: 4,       // m: faces may overhang the footprint bounding box by this much (eaves, canopies)
  maxFootprintExtent: 320,   // m: an extruded footprint may be a whole station building (Metz-Ville 293 m), nothing longer
  minFootprintArea: 1.0,     // m2: an extruded footprint (no LOD2 faces: France / Belgium / Rheinland-Pfalz) smaller than this is a sliver
  floatAbove: 1.6,          // m: a building (with walls) whose lowest wall point is above the highest ground of its footprint by more than this floats (the renderer's foundation skirt covers 1.6 m)
});

function ringStats(ring) {
  let nx = 0; let ny = 0; let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  const area = len / 2;
  const n = len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
  const c = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / ring.length);
  let dev = 0;
  ring.forEach((p) => { dev = Math.max(dev, Math.abs((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2])); });
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  ring.forEach((p) => p.forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }));
  return { area, n, dev, lo, hi, finite: ring.every((p) => p.every(Number.isFinite)) };
}

function demAt(data, x, z) {
  const d = data.dem; if (!d || !d.raw) return null;
  const ix = Math.round((x - d.x0) / d.res); const iz = Math.round((z - d.z0) / d.res);
  if (ix < 0 || iz < 0 || ix >= d.nx || iz >= d.nz) return null;
  return d.raw.readInt16LE((iz * d.nx + ix) * 2) / 10;
}

/* segment p1p2 crosses q1q2 (proper crossing, shared end points do not count) */
function segmentsCross(p1, p2, q1, q2) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(q1, q2, p1); const d2 = o(q1, q2, p2); const d3 = o(p1, p2, q1); const d4 = o(p1, p2, q2);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
function isSimpleRing(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
    }
  }
  return true;
}
function ringArea2d(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

/* a building without LOD2 faces is extruded from its footprint ring + height by the renderer: the ring must be a simple polygon, the height sane, the ground under it level enough */
function checkFootprint(b, data, fail) {
  const g = b.ground;
  if (g.length < 3 || !g.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) { fail('degenerate', 'footprint with ' + g.length + ' vertices / non-finite'); return; }
  if (ringArea2d(g) < LIMITS.minFootprintArea) { fail('degenerate', 'footprint of ' + ringArea2d(g).toFixed(2) + ' m2'); return; }
  if (!isSimpleRing(g)) fail('twisted', 'footprint ring crosses itself');
  const ext = Math.max(Math.max(...g.map((p) => p[0])) - Math.min(...g.map((p) => p[0])), Math.max(...g.map((p) => p[1])) - Math.min(...g.map((p) => p[1])));
  if (ext > LIMITS.maxFootprintExtent) fail('huge', 'footprint ' + ext.toFixed(0) + ' m long');
  if (!(b.h > 0) || b.h > LIMITS.maxHeight) fail('huge', 'height ' + b.h + ' m');
  const ys = g.map((p) => demAt(data, p[0], p[1])).filter((v) => v !== null);
  if (ys.length && b.base - Math.min(...ys) > LIMITS.floatAbove) fail('floating', 'base ' + (b.base - Math.min(...ys)).toFixed(1) + ' m above the lowest ground of the footprint (foundation skirt covers ' + LIMITS.floatAbove + ' m)');
}

export function checkPatch(key, data, allow = {}, dropped = []) {
  const problems = [];
  if (data.dem && data.dem.dm) data.dem.raw = Buffer.from(data.dem.dm, 'base64');
  const allowed = new Set(allow[key] || []);
  (data.buildings || []).forEach((b) => {
    const fail = (kind, what) => { if (!allowed.has(b.id) && !allowed.has(b.id + ':' + kind)) problems.push({ patch: key, id: b.id, kind, what }); };
    const g = b.ground || [];
    if (!g.length) return;
    if (!(b.roofs || []).length && !(b.walls || []).length) { checkFootprint(b, data, fail); return; }
    const fx = [Math.min(...g.map((p) => p[0])) - LIMITS.footprintMargin, Math.max(...g.map((p) => p[0])) + LIMITS.footprintMargin];
    const fz = [Math.min(...g.map((p) => p[1])) - LIMITS.footprintMargin, Math.max(...g.map((p) => p[1])) + LIMITS.footprintMargin];
    let minWallY = Infinity;
    const faces = [...(b.roofs || []).map((r) => ['roof', r]), ...(b.walls || []).map((r) => ['wall', r])];
    const seen = new Set();
    faces.forEach(([kind, ring]) => {
      if (ring.length < 3) { dropped.push({ patch: key, id: b.id, kind: 'degenerate', what: kind + ' ring with ' + ring.length + ' vertices' }); return; }
      const st = ringStats(ring);
      if (!st.finite) { fail('degenerate', kind + ' with non-finite vertices'); return; }
      if (st.area < LIMITS.minArea) { dropped.push({ patch: key, id: b.id, kind: 'degenerate', what: kind + ' of ' + st.area.toFixed(4) + ' m2' }); return; }   // the renderer drops these (triangulate3)
      const ext = Math.max(st.hi[0] - st.lo[0], st.hi[2] - st.lo[2]);
      if (ext > LIMITS.maxExtent) fail('huge', kind + ' ' + ext.toFixed(0) + ' m long');
      if (st.hi[1] - st.lo[1] > LIMITS.maxHeight) fail('huge', kind + ' ' + (st.hi[1] - st.lo[1]).toFixed(0) + ' m high');
      if (st.dev > LIMITS.maxPlaneDev && st.area > 4) seen.add('twisted ' + kind + ' (plane deviation ' + st.dev.toFixed(2) + ' m, ' + st.area.toFixed(0) + ' m2)');
      if (st.lo[0] < fx[0] || st.hi[0] > fx[1] || st.lo[2] < fz[0] || st.hi[2] > fz[1]) fail('outside', kind + ' leaves the footprint by more than ' + LIMITS.footprintMargin + ' m');
      if (kind === 'wall') minWallY = Math.min(minWallY, st.lo[1]);
    });
    seen.forEach((w) => fail('twisted', w));
    if (minWallY < Infinity) {
      const ys = g.map((p) => demAt(data, p[0], p[1])).filter((v) => v !== null);
      if (ys.length) {
        const gyHi = Math.max(...ys);
        if (minWallY - gyHi > LIMITS.floatAbove) fail('floating', 'lowest wall point ' + (minWallY - gyHi).toFixed(1) + ' m above the highest ground of the footprint');
      }
    }
  });
  return problems;
}

export function loadPatches(keys) {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('index') && !f.endsWith('.c.json'));
  return files.map((f) => f.replace(/\.json$/, '')).filter((k) => !keys.length || keys.includes(k));
}

export function checkAll(keys = [], dropped = []) {
  const allow = fs.existsSync(ALLOW_FILE) ? JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')) : {};
  const out = [];
  loadPatches(keys).forEach((key) => {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, key + '.json'), 'utf8'));
    const coreFile = path.join(DIR, key.replace(/\.h$/, '') + '.c.json');
    if (key.endsWith('.h') && !data.dem && fs.existsSync(coreFile)) data.dem = JSON.parse(fs.readFileSync(coreFile, 'utf8')).dem;      // the heavy half has no relief: take the core's (floating test)
    out.push(...checkPatch(key, data, allow, dropped));
  });
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dropped = [];
  const problems = checkAll(args.filter((a) => !a.startsWith('--')), dropped);
  if (json) console.log(JSON.stringify(problems, null, 1));
  else {
    const by = {};
    problems.forEach((p) => { (by[p.patch] = by[p.patch] || []).push(p); });
    Object.entries(by).forEach(([k, list]) => { console.log(k + ': ' + list.length); list.slice(0, 12).forEach((p) => console.log('   ' + p.id + ' [' + p.kind + '] ' + p.what)); });
    console.log(dropped.length + ' sliver / degenerate faces (dropped by the renderer, not failures)');
    console.log(problems.length ? problems.length + ' problem(s) in ' + Object.keys(by).length + ' patch(es)' : 'patch geometry: clean');
  }
  process.exit(problems.length ? 1 : 0);
}
