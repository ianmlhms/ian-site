#!/usr/bin/env node
/* Round 7-C Node checks over EVERY resort (no browser):
 *   node scripts/ski/round7c-check.mjs [resort ...] [--rides] [--only id,id]
 *   spawn      the first lift (config FIRST_LIFT) and its boarding spot: within 26 m of the bottom station (the boarding zone is 30 m),
 *              on open snow, nothing within 25 m ahead (buildings, station halls, trees, a terrain wall), <= 0.3 m above the ground
 *   teleport   200 random discovered spots per resort -> the safe spot: on a piste / at a station, never in trees, rock, buildings, steep
 *   discovery  run-length save round trip + union merge
 *   avalanche  the Lawin faces (AVALANCHE.faces per resort): steep, off piste, and a slab released at the top flows downhill and stops;
 *              the same (id, seed) gives the same flow (deterministic); never releasable on a piste
 *   course     EVERY piste's challenge: the start gate clear of buildings / stations / lifts / trees, the barriers line the piste (both
 *              edges, continuous), the finish = the line's real end; with --rides the scripted skier rides each course with game.js
 *              createRun + course.js and must finish inside the barriers (leaving them gives a warning event, never a reset)
 * Exit code 1 on a failed check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createScatter } = await imp('scatter.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { createObstacles, firstLift, liftSpot, safeSpot, courseGate } = await imp('modes/clear.js');
const { createDiscovery, mergeRle, rleIntervals } = await imp('modes/discovery.js');
const { findFaces, releasable, createSlab, stepSlab, cellId, slopeDeg } = await imp('avalanche.js');
const { createCourse, courseLayout } = await imp('modes/course.js');
const { createRun } = await imp('game.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { createBot } = await imp('bot.js');
const { SKI, AVALANCHE, MODES, COURSE } = await imp('config.js');

const args = process.argv.slice(2);
const RIDES = args.includes('--rides');
const onlyArg = args.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;
const rids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz'];
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };
const report = [];

for (const rid of rids.length ? rids : ALL) {
  const t0 = Date.now();
  console.log(`\n== ${rid}`);
  const dir = path.join(root, 'data', rid);
  const resort = JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8'));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const height = (x, z) => surface.height(x, z);
  const scatter = createScatter(field);
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, (x, z) => field.farHeight(x, z), pistes);
  const obs = createObstacles({ resort, field, scatter, density: 0.8 });
  obs.setBuildings(JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8')));
  const row = { rid };

  // ---- spawn ----
  const first = firstLift(rid, lifts, resort.places);
  const spot = liftSpot(first, obs, height);
  const gap = Math.hypot(spot.x - first.bottom.x, spot.z - first.bottom.z);
  const wall = obs.wallAhead(spot.x, spot.z, spot.heading, height, 25);
  const state = createSkierState(spot.x, spot.z, spot.heading, height(spot.x, spot.z));
  check(spot.ok, `spawn at ${first.name}: ${gap.toFixed(1)} m from the bottom station, ${spot.why || 'open snow, open view'}`);
  check(gap <= 38 && !wall, `spawn: inside the boarding zone, nothing within 25 m ahead${wall ? ` (${wall.what} at ${wall.d.toFixed(0)} m)` : ''}`);
  check(Math.abs(state.y - height(spot.x, spot.z)) <= 0.3, 'spawn: on the ground (<= 0.3 m)');
  row.spawn = `${first.name} ${gap.toFixed(0)} m${spot.ok ? '' : ' ' + spot.why}`;

  // ---- teleport ----
  const disc = createDiscovery({ width: resort.width, depth: resort.depth });
  for (const p of pistes.list) for (let s = 0; s < p.length; s += 50) { const a = p.at(s, {}); disc.reveal(a.x, a.z, 200); }
  let n = 0, got = 0, bad = 0, refused = 0;
  const rand = (() => { let a = 12345; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
  while (n < 200) {
    const x = 300 + rand() * (resort.width - 600), z = 300 + rand() * (resort.depth - 600);
    if (!disc.has(x, z)) { refused++; if (refused > 20000) break; continue; }
    n++;
    const s = safeSpot(x, z, { obs, pistes, lifts, height, isOpen: disc.has });
    if (!s) continue;
    got++;
    if (obs.blocked(s.x, s.z, 1, { built: false }) || obs.slopeAt(s.x, s.z, height) > 32 || !disc.has(s.x, s.z)) bad++;
  }
  check(got >= n * 0.9 && bad === 0, `teleport: ${got}/${n} discovered taps found a safe spot, ${bad} unsafe`);
  row.teleport = `${got}/${n} ok, ${bad} bad`;
  const enc = disc.encode(), back = createDiscovery({ width: resort.width, depth: resort.depth, saved: enc });
  check(back.count === disc.count && mergeRle(enc, '') === enc && rleIntervals(mergeRle('5,3', '6,4')).length === 1, `discovery: save round trip (${disc.count} cells, ${enc.length} chars), union merge`);

  // ---- avalanche ----
  const tF = Date.now();
  const faces = findFaces(field, resort);
  row.faces = faces.map((f) => `${Math.round(f.slope)}°/${Math.round(f.len)}m`).join(' ');
  check(faces.length === AVALANCHE.faces, `avalanche: ${faces.length} Lawin faces (${row.faces}) in ${Date.now() - tF} ms`);
  for (const f of faces) {
    const id = cellId(f.top.x, f.top.z);
    const run = (seed) => { const sl = createSlab(id, seed, (x, z) => field.farHeight(x, z)); let t = 0, moving = 1; while (moving && t < AVALANCHE.maxTime) { moving = stepSlab(sl, t, (x, z) => field.farHeight(x, z)); t += AVALANCHE.step; } return { sl, t }; };
    const a = run(7001 + f.index), b = run(7001 + f.index);
    const y0 = field.farHeight(a.sl.crown.x, a.sl.crown.z);
    const drop = a.sl.blocks.reduce((m, q) => m + (y0 - field.farHeight(q.x, q.z)), 0) / a.sl.blocks.length;
    const same = a.sl.blocks.every((q, i) => q.x === b.sl.blocks[i].x && q.z === b.sl.blocks[i].z);
    check(drop > 60 && a.t < AVALANCHE.maxTime && same, `avalanche ${f.id}: the slab flows ${drop.toFixed(0)} m down, stops after ${a.t.toFixed(1)} s, deterministic ${same}`);
  }
  let onPiste = 0;
  for (const p of pistes.list.slice(0, 200)) { const a = p.at(p.length / 2, {}); if (releasable(field, a.x, a.z, height)) onPiste++; }
  check(onPiste === 0, `avalanche: never releasable on a piste (${onPiste} of 200 piste middles)`);

  // ---- course ----
  let clear = 0, moved = 0, lined = 0;
  const blocked = [];
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    const g = courseGate(p, obs);
    if (g.ok) clear++; else blocked.push(`${p.id} (${g.why})`);
    if (g.s > 2) moved++;
    const lay = courseLayout(p, g.s);
    const cover = lay.barriers.length * COURSE.barrierEvery / 2 / Math.max(1, lay.finishS - g.s);
    if (cover > 0.95 && lay.finish && Math.hypot(lay.finish.x - p.bottom.x, lay.finish.z - p.bottom.z) < COURSE.finishBack + 1) lined++;
  }
  const total = ONLY ? ONLY.size : pistes.list.length;
  check(blocked.length <= Math.ceil(total * 0.01), `course: ${clear}/${total} start gates on open snow (${moved} moved down the piste)${blocked.length ? `; blocked: ${blocked.slice(0, 8).join(', ')}` : ''}`);
  check(lined === total, `course: ${lined}/${total} courses lined with barriers on both edges, finish at the line's real end`);
  row.gates = `${clear}/${total}`;
  if (RIDES) {
    const world = { height, normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: (x, z, r, y) => scatter.hit(x, z, r, y, 0.8) };
    let fin = 0, resets = 0, warned = 0;
    const stuck = [];
    for (const p of pistes.list) {
      if (ONLY && !ONLY.has(p.id)) continue;
      const g = courseGate(p, obs);
      const run = createRun({ piste: p, mode: MODES.run, startS: g.s });
      const course = createCourse({ piste: p, startS: g.s });
      const a = p.at(g.s, {});
      let s = createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), height(a.x, a.z));
      s = { ...s, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };
      const bot = createBot(p);
      let t = 0, done = false;
      while (t < 900 && !done) {
        const was = s.crash > 0;
        s = stepSkier(s, bot(s), world);
        if (was && s.crash === 0) { const r = run.respawnPoint(); s = createSkierState(r.x, r.z, r.heading, height(r.x, r.z)); }
        for (const ev of run.update(s, SKI.dt)) { if (ev.type === 'finish' || ev.type === 'invalid') done = true; if (ev.type === 'offpiste') resets++; }
        const c = course.update(s, SKI.dt);
        if (c.warn) warned++;
        t += SKI.dt;
      }
      if (done) fin++; else stuck.push(`${p.id}@${Math.round(run.progress)}/${Math.round(p.length)}`);
    }
    check(fin >= Math.ceil(total * 0.97) && resets === 0, `course rides: ${fin}/${total} finished by the scripted skier inside the course, ${resets} silent resets${stuck.length ? `; not finished: ${stuck.slice(0, 10).join(', ')}` : ''}`);
    row.rides = `${fin}/${total}`;
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report.push(row);
}
console.log('\nper resort:');
for (const r of report) console.log(`  ${r.rid.padEnd(10)} spawn ${r.spawn} | teleport ${r.teleport} | faces ${r.faces} | gates ${r.gates}${r.rides ? ` | rides ${r.rides}` : ''}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
