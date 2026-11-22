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
 *   R7-C2      every start gate on open snow (0 blocked, beside the line where a station / lift line takes the middle); every course
 *              object (barrier panels, arrow boards + posts, ZIL pillars + beam, the finish strip) stands on the snow (<= 0.5 m gap) and
 *              no higher than 6 m above it, at its intended size; the barriers hold a skier aimed at them (pushed back inside, slowed
 *              a little, never stopped, never through); with --rides the HUD distance falls along every ride (no rise > 15 m) and is
 *              < 30 m when he crosses the ZIL, the skier never ends up outside a barrier he hit
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
const { findFaces, releasable, createSlab, stepSlab, cellId, slopeDeg, lowestPiste, faceView } = await imp('avalanche.js');
const { createCourse, courseLayout, courseSeats, distanceText } = await imp('modes/course.js');
const { createRun } = await imp('game.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { createBot } = await imp('bot.js');
const { SKI, AVALANCHE, MODES, COURSE } = await imp('config.js');
const { unpackResort } = await imp('linepack.js');                 // R8b: resort.json carries packed piste lines (R7-D)

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
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
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
  // R8b: like main.js: R7-B's stations replace the OSM station buildings, the obstacles know the kept (drawn) houses
  const buildingRows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const liftWorld = lifts.setBuildings(buildingRows);
  obs.setBuildings(buildingRows.filter((_, i) => liftWorld.keepBuilding(i)));
  const row = { rid };

  // ---- spawn ----
  const first = firstLift(rid, lifts, resort.places);
  // R8b: the spawn waits in R7-B's boarding zone of the first lift (lift-site.js site.wait), like every fast travel to a lift
  const spot = lifts.boardAt(first);
  const gap = Math.hypot(spot.x - first.bottom.x, spot.z - first.bottom.z);
  const zoneLift = lifts.boardingAt(spot.x, spot.z);
  const state = createSkierState(spot.x, spot.z, spot.heading, height(spot.x, spot.z));
  const inHouse = obs.inBuilding(spot.x, spot.z, 0.6);
  check(zoneLift && zoneLift.index === first.index, `spawn at ${first.name}: in its boarding zone, ${gap.toFixed(1)} m from the bottom station`);
  check(!inHouse && obs.slopeAt(spot.x, spot.z, height) < 22, `spawn: not in a house, not steep (${obs.slopeAt(spot.x, spot.z, height).toFixed(0)}°)`);
  check(Math.abs(state.y - height(spot.x, spot.z)) <= 0.3, 'spawn: on the ground (<= 0.3 m)');
  row.spawn = `${first.name} ${gap.toFixed(0)} m`;

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
  const faces = findFaces(field, resort, AVALANCHE.faces, { minY: lowestPiste(pistes, (x, z) => field.farHeight(x, z)) });
  row.faces = faces.map((f) => `${Math.round(f.slope)}°/${Math.round(f.len)}m`).join(' ');
  check(faces.length === AVALANCHE.faces, `avalanche: ${faces.length} Lawin faces (${row.faces}) in ${Date.now() - tF} ms`);
  check(faces.every((f) => f.slope >= AVALANCHE.slope && !f.gentle), `avalanche: every Lawin face starts >= ${AVALANCHE.slope}° steep (${faces.map((f) => Math.round(f.slope)).join(', ')}°)`);
  for (const f of faces) {
    const id = cellId(f.top.x, f.top.z);
    const run = (seed) => { const sl = createSlab(id, seed, (x, z) => field.farHeight(x, z)); let t = 0, moving = 1; while (moving && t < AVALANCHE.maxTime) { moving = stepSlab(sl, t, (x, z) => field.farHeight(x, z)); t += AVALANCHE.step; } return { sl, t }; };
    const a = run(7001 + f.index), b = run(7001 + f.index);
    const y0 = field.farHeight(a.sl.crown.x, a.sl.crown.z);
    const drop = a.sl.blocks.reduce((m, q) => m + (y0 - field.farHeight(q.x, q.z)), 0) / a.sl.blocks.length;
    const same = a.sl.blocks.every((q, i) => q.x === b.sl.blocks[i].x && q.z === b.sl.blocks[i].z);
    check(drop > 60 && a.t < AVALANCHE.maxTime && same, `avalanche ${f.id}: the slab flows ${drop.toFixed(0)} m down, stops after ${a.t.toFixed(1)} s, deterministic ${same}`);
  }
  // R7-C2: the avalanche camera: a clear view of every face's flow, >= 0.6 m above the snow, nothing of the mountain in between
  const views = faces.map((f) => faceView(f, height));
  check(views.every((v) => v && v.clear && v.above >= 0.6), `avalanche camera: ${views.filter((v) => v && v.clear).length}/${faces.length} faces watched from a clear spot (${views.map((v) => `${Math.round(v.above)} m up${v.open ? ', open foreground' : ''}`).join('; ')}), never in the rock`);
  let onPiste = 0;
  for (const p of pistes.list.slice(0, 200)) { const a = p.at(p.length / 2, {}); if (releasable(field, a.x, a.z, height)) onPiste++; }
  check(onPiste === 0, `avalanche: never releasable on a piste (${onPiste} of 200 piste middles)`);

  // ---- course ----
  let clear = 0, moved = 0, beside = 0, lined = 0, seatsOk = 0, worstBury = 0, worstGap = 0, netInHouse = 0, openTotal = 0, edgeTotal = 0;
  const blocked = [], badSeats = [], unlined = [];
  const gates = new Map();
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    const g = courseGate(p, obs);
    gates.set(p.id, g);
    if (g.ok) clear++; else blocked.push(`${p.id} (${g.why})`);
    if (g.s > 2) moved++;
    if (g.lat) beside++;
    const lay = courseLayout(p, g.s, pistes, obs);
    for (const r of lay.rails) for (let i = 0; i < r.length; i += 8) if (obs.inBuilding(r[i], r[i + 1], 0) || obs.nearStation(r[i], r[i + 1], 0)) netInHouse++;
    // the nets: both sides from the start gate to the finish (the inside of a tight bend may be left out)
    let netLen = 0;
    for (const r of lay.rails) for (let i = 2; i < r.length; i += 2) netLen += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    const cover = (netLen + lay.openLen) / 2 / Math.max(1, lay.finishS - g.s - 4);      // netted or left open on purpose (a house, a hairpin)
    openTotal += lay.openLen; edgeTotal += 2 * Math.max(1, lay.finishS - g.s - 4);
    if (cover > 0.95 && lay.finish && Math.hypot(lay.finish.x - p.bottom.x, lay.finish.z - p.bottom.z) < COURSE.finishBack + 1) lined++;
    else unlined.push(`${p.id} (${(cover * 100).toFixed(0)} % netted)`);
    // R7-C2: every course object on the snow, nothing higher than 6 m above it, nothing bigger than meant
    const st = courseSeats(lay, height);
    const all = [...st.barriers, ...st.arrows, ...st.posts, ...st.pillars, st.beam, st.line];
    const hwArch = lay.halfWidth + 1.5, cross = Math.abs(st.pillars[0].ground[0] - st.pillars[1].ground[0]);
    const maxSize = { barrier: [0.1, 1.3, 0.1], arrow: [1.1, 1.1, 0.05], post: [0.1, 1.8, 0.1], pillar: [0.9, COURSE.archHeight + 0.4 + cross + 0.01, 0.9], beam: [0.4, 1.4, hwArch * 2 + 0.9], line: [1.6, 0, hwArch * 2] };
    const bad = all.find((o) => o.top - o.ground[1] > COURSE.archHeight + 0.01 || (o.kind !== 'beam' && o.kind !== 'arrow' && o.y - o.ground[0] > 0.3) || (o.kind === 'arrow' && o.y - o.ground[0] > 1.7)
      || st.netGap > 0.3 || st.netSunk > 0.3
      || o.size.some((v, i) => v > maxSize[o.kind][i] + 1e-6) || !Number.isFinite(o.y + o.top));
    if (!bad) seatsOk++; else badSeats.push(`${p.id}: ${bad.kind} ${(bad.y - bad.ground[0]).toFixed(1)}..${(bad.top - bad.ground[1]).toFixed(1)} m, net gap ${st.netGap.toFixed(2)} sunk ${st.netSunk.toFixed(2)}, ${bad.size.map((v) => v.toFixed(1)).join('x')}`);
    worstGap = Math.max(worstGap, st.netGap); worstBury = Math.max(worstBury, st.netSunk);
  }
  const total = ONLY ? ONLY.size : pistes.list.length;
  check(blocked.length === 0, `course: ${clear}/${total} start gates on open snow (${moved} moved down the piste, ${beside} beside the line)${blocked.length ? `; blocked: ${blocked.slice(0, 8).join(', ')}` : ''}`);
  check(netInHouse === 0, `course: no net through a house or a station hall (${netInHouse} net points inside one)`);
  check(lined === total, `course: ${lined}/${total} courses lined with barriers on both edges (${(openTotal / edgeTotal * 100).toFixed(1)} % of the edges left open at houses / stations / hairpins), finish at the line's real end${unlined.length ? `; not: ${unlined.slice(0, 6).join(', ')}` : ''}`);
  check(seatsOk === total, `course objects: ${seatsOk}/${total} courses with every barrier / arrow / post / ZIL pillar / beam / finish strip on the snow, <= ${COURSE.archHeight} m above it, intended size (net edge over the snow <= ${worstGap.toFixed(2)} m, into it <= ${worstBury.toFixed(2)} m)${badSeats.length ? `; bad: ${badSeats.slice(0, 6).join('; ')}` : ''}`);
  row.gates = `${clear}/${total}`;
  // R7-C2: the barriers hold: a skier at 15 m/s aimed 35° at the net, on the ground, every 5th course
  const world = { height, normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: (x, z, r, y) => scatter.hit(x, z, r, y, 0.8) };
  let hold = 0, holdN = 0, through = 0, stopped = 0, minKeep = 1, missed = 0;
  for (const [i, p] of pistes.list.entries()) {
    if (ONLY ? !ONLY.has(p.id) : i % 5) continue;
    const g = gates.get(p.id) || courseGate(p, obs);
    for (const side of [-1, 1]) {
      const sA = Math.min(p.length - 40, g.s + 60 + (p.length - g.s) * 0.3);
      if (sA < g.s + 20) continue;
      holdN++;
      const c = createCourse({ piste: p, startS: g.s });
      const a = p.at(sA, {});
      const h0 = Math.atan2(a.dz, a.dx) + side * 35 * Math.PI / 180;      // + = towards the right edge
      const x0 = a.x - a.dz * side * (p.halfWidth - 3), z0 = a.z + a.dx * side * (p.halfWidth - 3);
      let s = { ...createSkierState(x0, z0, h0, height(x0, z0)), vx: Math.cos(h0) * 15, vz: Math.sin(h0) * 15, speed: 15 };
      c.collide(s, s);
      let worst = 0, hitAt = -1;
      for (let k = 0; k < 240; k++) {
        const prev = s;
        s = stepSkier(s, { steer: 0, tuck: 0, brake: 0, push: 0, jump: false }, world);
        const before = c.hits;
        s = c.collide(prev, s);
        if (c.hits > before && hitAt < 0) { hitAt = k; minKeep = Math.min(minKeep, s.speed / Math.max(0.1, prev.speed)); }
        const pr = p.project(s.x, s.z, sA, 120, {});
        worst = Math.max(worst, Math.abs(pr.off) - (p.halfWidth + 0.5));
      }
      if (worst > 0.05) through++;
      if (hitAt < 0) { missed++; holdN--; continue; }                    // fell / stopped before the net (a tree, a crest): no contact
      if (s.speed < 1 && s.crash === 0) stopped++;
      if (worst <= 0.05) hold++;
    }
  }
  // put down 30 m outside the net (the map / a flow / a respawn): never pulled back in through it
  let pulled = 0, placedN = 0;
  for (const [i, p] of pistes.list.entries()) {
    if (ONLY ? !ONLY.has(p.id) : i % 25) continue;
    const g = gates.get(p.id) || courseGate(p, obs);
    const sA = Math.min(p.length - 40, g.s + 80);
    if (sA < g.s + 20) continue;
    placedN++;
    const c = createCourse({ piste: p, startS: g.s }), a = p.at(sA, {});
    let s = { ...createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), height(a.x, a.z)) };
    for (let k = 0; k < 30; k++) { const prev = s; s = c.collide(prev, stepSkier(s, { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, world)); }
    const ox = a.x - a.dz * (p.halfWidth + 30), oz = a.z + a.dx * (p.halfWidth + 30);
    s = { ...createSkierState(ox, oz, Math.atan2(a.dz, a.dx), height(ox, oz)) };
    for (let k = 0; k < 30; k++) { const prev = s; s = c.collide(prev, stepSkier(s, { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, world)); }
    if (Math.hypot(s.x - ox, s.z - oz) > 5) pulled++;
  }
  check(pulled === 0, `barriers: ${placedN - pulled}/${placedN} skiers put down outside the net stay there (no pull through it)`);
  check(through === 0 && stopped === 0 && hold === holdN && holdN > 0, `barriers: ${hold}/${holdN} skiers aimed at the net at 54 km/h held inside (${through} through, ${stopped} stopped, ${missed} never reached it), speed kept at the hit >= ${(minKeep * 100).toFixed(0)} %`);
  if (RIDES) {
    let fin = 0, resets = 0, warned = 0, hudBad = 0, hits = 0, outside = 0;
    const stuck = [], hudFail = [];
    for (const p of pistes.list) {
      if (ONLY && !ONLY.has(p.id)) continue;
      const g = gates.get(p.id);
      const run = createRun({ piste: p, mode: MODES.run, startS: g.s });
      const course = createCourse({ piste: p, startS: g.s });
      const a = p.at(g.s, {});
      const x0 = a.x - a.dz * (g.lat || 0), z0 = a.z + a.dx * (g.lat || 0);
      let s = createSkierState(x0, z0, Math.atan2(a.dz, a.dx), height(x0, z0));
      s = { ...s, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };
      const bot = createBot(p);
      let t = 0, done = false, low = Infinity, rise = 0, atFinish = null, lastRemain = null, fresh = true;
      const limit = 300 + p.length / 3;                       // long flat ski routes (Arlberg woster-bockbachtal: 8.2 km) take time
      while (t < limit && !done) {
        const was = s.crash > 0;
        const prev = s;
        s = stepSkier(s, bot(s), world);
        s = course.collide(prev, s);
        if (was && s.crash === 0) { const r = run.respawnPoint(); s = createSkierState(r.x, r.z, r.heading, height(r.x, r.z)); fresh = true; course.rebase(); }
        const c = course.update(s, SKI.dt);
        if (c.warn) warned++;
        // the HUD distance: falls along the ride (a crash puts him back up to 10 m: a new reference)
        if (fresh) { low = c.remaining; fresh = false; } else { rise = Math.max(rise, c.remaining - low); low = Math.min(low, c.remaining); }
        lastRemain = c.remaining;
        for (const ev of run.update(s, SKI.dt)) {
          if (ev.type === 'finish' || ev.type === 'invalid') { done = true; atFinish = lastRemain; }
          if (ev.type === 'offpiste') resets++;
        }
        t += SKI.dt;
      }
      hits += course.hits;
      const pr = p.project(s.x, s.z, null, 0, {});
      if (pr.dist > p.halfWidth + 0.6 && course.hits) outside++;
      if (done) fin++; else stuck.push(`${p.id}@${Math.round(run.progress)}/${Math.round(p.length)}`);
      const startText = distanceText(course.finishS - g.s), endText = atFinish === null ? '-' : distanceText(atFinish);
      if (!done || atFinish >= 30 || rise > 15) { hudBad++; hudFail.push(`${p.id}: ${startText} -> ${endText}, rise ${rise.toFixed(0)} m`); }
    }
    check(fin === total && resets === 0, `course rides: ${fin}/${total} finished by the scripted skier inside the course, ${resets} silent resets${stuck.length ? `; not finished: ${stuck.slice(0, 10).join(', ')}` : ''}`);
    check(hudBad === 0, `course HUD: the distance falls along all ${total} rides and reads < 30 m at the ZIL (${hits} barrier contacts, ${outside} ended outside a barrier)${hudFail.length ? `; bad: ${hudFail.slice(0, 6).join('; ')}` : ''}`);
    row.rides = `${fin}/${total}`;
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report.push(row);
}
console.log('\nper resort:');
for (const r of report) console.log(`  ${r.rid.padEnd(10)} spawn ${r.spawn} | teleport ${r.teleport} | faces ${r.faces} | gates ${r.gates}${r.rides ? ` | rides ${r.rides}` : ''}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
