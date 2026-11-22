/* Node checks of the pure Ski Alpen code (no browser):  node pb/ski/harness.js [resort] [--rides N] [--all] [--only id,id] [--trace]
 *   A  data decodes, tiles match resort.json
 *   B  the height function is continuous: across every tile edge, with and without the neighbour loaded (streaming), and at the feather
 *   C  render == physics: the LOD 0 tile vertices are the physics lattice
 *   D  the scripted skier rides pistes top to bottom: finishes, crashes, times, top speeds, the ★2 target times (every piste with --all)
 *   E  the snow park (modes/park-check.js): every kicker, tricks, rails / boxes, the halfpipe, a scored run (--park: only A-C + E)
 * Exit code 1 on a failed check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackResort } from './linepack.js';      // R7-D: packed piste lines

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const { decodeGrid, decodeRle } = await import('./codec.js');
const { createField, createPisteNet } = await import('./field.js');
const { createSurface } = await import('./surface.js');
const { createScatter } = await import('./scatter.js');
const { createPisteSet } = await import('./pistes.js');
const { createSkierState, stepSkier } = await import('./skier.js');
const { createBot } = await import('./bot.js');
const { setRoot, selectTiles } = await import('./quadtree.js');
const { computeTileNodes, buildTileMesh } = await import('./tile-mesh.js');
const { SKI, LATTICE, DATA } = await import('./config.js');
const { challengeFor } = await import('./modes/challenges.js');
const { createParkLayout } = await import('./modes/park.js');
const { runParkChecks } = await import('./modes/park-check.js');

const args = process.argv.slice(2);
const rid = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'killy';
const ridesArg = args.indexOf('--rides');
const RIDES = args.includes('--all') ? Infinity : ridesArg >= 0 ? Number(args[ridesArg + 1]) : 8;
const onlyArg = args.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;      // ride just these pistes
const TRACE = args.includes('--trace');                                          // one line per second of each ride
const PARK_ONLY = args.includes('--park');                                       // only the data and the snow park (section E)
const dir = path.join(here, 'data', rid);
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };
const t0 = Date.now();

console.log('A data');
const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
check(far.nx === resort.far.nx && far.nz === resort.far.nz, `far grid ${far.nx}x${far.nz}`);
check(classes.nx === resort.classes.nx && classes.nz === resort.classes.nz, `classes ${classes.nx}x${classes.nz}`);
const net = createPisteNet(resort.network);
const field = createField({ resort, far, classes, net, park: createParkLayout(resort.park) });
const grids = new Map();
for (const [tx, tz, bytes] of resort.tiles.list) {
  const buf = new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)));
  if (buf.length !== bytes) { check(false, `tile ${tx}_${tz} size ${buf.length} != ${bytes}`); continue; }
  grids.set(`${tx},${tz}`, decodeGrid(buf));
}
check(grids.size === resort.tiles.list.length, `${grids.size} height tiles decode`);

console.log('B continuity');
// first with only every other tile loaded (streaming), then with all
const half = [...grids.entries()].filter(([k]) => { const [x, z] = k.split(',').map(Number); return (x + z) % 2 === 0; });
for (const [k, g] of half) { const [tx, tz] = k.split(',').map(Number); field.addTile(tx, tz, g); }
const edgeJump = () => {
  let worst = 0;
  for (const [k] of grids) {
    const [tx, tz] = k.split(',').map(Number);
    for (let i = 0; i <= 64; i++) {
      const x = tx * DATA.tileSize + i * 20, z = tz * DATA.tileSize;
      worst = Math.max(worst, Math.abs(field.baseHeight(x, z - 1e-5) - field.baseHeight(x, z + 1e-5)));
      const x2 = tx * DATA.tileSize, z2 = tz * DATA.tileSize + i * 20;
      worst = Math.max(worst, Math.abs(field.baseHeight(x2 - 1e-5, z2) - field.baseHeight(x2 + 1e-5, z2)));
    }
  }
  return worst;
};
let jump = edgeJump();
check(jump < 0.05, `half the tiles loaded: worst step across a tile edge ${jump.toFixed(3)} m`);
for (const [k, g] of grids) { const [tx, tz] = k.split(',').map(Number); if (!field.hasTile(tx, tz)) field.addTile(tx, tz, g); }
jump = edgeJump();
check(jump < 0.05, `all tiles loaded: worst step across a tile edge ${jump.toFixed(3)} m`);

console.log('C render == physics');
const surface = createSurface(field);
setRoot(resort.width, resort.depth);
const p0 = resort.pistes[0];
const sel = selectTiles(p0.line[0], p0.line[1], { maxDistance: 20000 });
check(sel.leaves.length > 20 && sel.leaves.length < 400, `${sel.leaves.length} terrain tiles around the first start`);
const lod0 = sel.leaves.filter((l) => Math.abs(l.step - LATTICE) < 1e-9);
let worstRP = 0;
for (const leaf of lod0.slice(0, 12)) {
  const mesh = buildTileMesh(leaf, computeTileNodes(leaf, surface, field), sel.split, field);
  for (let v = 0; v < 33 * 33; v += 37) {
    const vi = v % 33, vj = Math.floor(v / 33);
    if (vi === 0 || vj === 0 || vi === 32 || vj === 32) continue;          // edge vertices may be stitched to a coarser neighbour
    const x = leaf.x0 + mesh.positions[v * 3], z = leaf.z0 + mesh.positions[v * 3 + 2];
    worstRP = Math.max(worstRP, Math.abs(mesh.positions[v * 3 + 1] - surface.height(x, z)));
  }
}
check(lod0.length >= 9 && worstRP < 0.02, `${lod0.length} LOD 0 tiles, worst render-physics gap at sampled vertices ${worstRP.toFixed(4)} m (stitched edges excluded below 2 cm)`);
let tBuild = Date.now(), built = 0;
for (const leaf of sel.leaves) { buildTileMesh(leaf, computeTileNodes(leaf, surface, field), sel.split, field); built++; }
console.log(`      built all ${built} tiles in ${Date.now() - tBuild} ms`);

console.log('D rides');
const scatter = createScatter(field);
const nrm = { x: 0, y: 1, z: 0 };
const world = {
  height: (x, z) => surface.height(x, z),
  normal: (x, z, out) => surface.normal(x, z, out),
  snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.2),
  hit: (x, z, r, y) => scatter.hit(x, z, r, y),
};
const set = createPisteSet(resort);
const order = [...set.list].sort((a, b) => (a.src.slalom === b.src.slalom ? 0 : a.src.slalom ? -1 : 1));
let rides = 0, finished = 0;
const summary = [];
const ratios = [];                       // bot time / star target time (round 4A: the ★2 target must be fair on every piste)
for (const piste of order) {
  if (PARK_ONLY) break;
  if (ONLY && !ONLY.has(piste.id)) continue;
  if (rides >= RIDES && !ONLY) break;
  rides++;
  const pt = piste.at(2, {});
  let s = createSkierState(pt.x, pt.z, Math.atan2(pt.dz, pt.dx), surface.height(pt.x, pt.z));
  const drive = createBot(piste);
  const proj = {};
  let t = 0, crashes = 0, top = 0, air = 0, best = 0, lastS = 0, stuck = 0;
  while (t < 900) {
    const input = drive(s);
    const wasCrash = s.crash > 0;
    s = stepSkier(s, input, world);
    if (!wasCrash && s.crash > 0) crashes++;
    if (wasCrash && s.crash === 0) {               // respawn on the line
      const q = piste.at(Math.max(0, best - 15), {});
      s = createSkierState(q.x, q.z, Math.atan2(q.dz, q.dx), surface.height(q.x, q.z));
    }
    t += SKI.dt;
    top = Math.max(top, s.speed);
    if (!s.grounded) air += SKI.dt;
    piste.project(s.x, s.z, best, 150, proj);
    best = Math.max(best, proj.s);
    if (Math.floor(t) !== Math.floor(t - SKI.dt)) {
      if (best - lastS < 0.5) stuck++; else stuck = 0; lastS = best;
      if (TRACE) console.log(`      t ${t.toFixed(0)} s ${proj.s.toFixed(0)} off ${proj.off.toFixed(1)} v ${s.speed.toFixed(1)} snow ${s.snow.toFixed(2)} crash ${s.crash.toFixed(1)} ${s.crashKind || ''} y ${s.y.toFixed(1)} push ${input.push} brake ${input.brake}`);
    }
    if (stuck > 25) break;
    if (best > piste.length - 25) break;
  }
  const ok = best > piste.length - 25;
  if (ok) finished++;
  const ch = challengeFor(piste, field.farHeight);
  if (ok) ratios.push({ id: piste.id, diff: piste.diff, r: t * 1000 / ch.targetMs });
  summary.push(`${piste.id.padEnd(28)} ${piste.diff.padEnd(5)} ${String(Math.round(piste.length)).padStart(5)} m ${ok ? `${t.toFixed(1).padStart(6)} s` : `STOPPED at ${Math.round(best)} m`}  ★2 ${(ch.targetMs / 1000).toFixed(1)} s  ★3 ${ch.special}${ch.special === 'speed' ? ' ' + ch.speedKmh : ''}  top ${(top * 3.6).toFixed(0)} km/h  air ${air.toFixed(1)} s  crashes ${crashes}${piste.src.slalom ? '  slalom' : ''}`);
}
for (const line of summary) console.log('      ' + line);
if (ratios.length) {
  const rs = ratios.map((o) => o.r).sort((a, b) => a - b);
  const q = (f) => rs[Math.min(rs.length - 1, Math.floor(rs.length * f))].toFixed(2);
  console.log(`      bot time / ★2 target: p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}  (${rs.length} pistes)`);
  for (const o of ratios.filter((o) => o.r > 1.35 || o.r < 0.75)) console.log(`        outlier ${o.id} ${o.diff} ${o.r.toFixed(2)}`);
  check(rs[Math.floor(rs.length * 0.5)] > 0.85 && rs[Math.floor(rs.length * 0.5)] < 1.25, 'the ★2 target time is near what the careful scripted skier takes (median 0.85..1.25)');
}
if (!PARK_ONLY) check(finished >= Math.ceil(rides * 0.8), `${finished}/${rides} pistes ridden to the bottom by the scripted skier`);
console.log('E snow park');
runParkChecks({ resort, world: { ...world, tricks: true }, check, trace: TRACE });
console.log(`\n${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
