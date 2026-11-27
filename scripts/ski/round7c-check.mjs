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
const { createObstacles, firstLift, liftSpot, safeSpot, courseGate, courseFinish } = await imp('modes/clear.js');
const { createDiscovery, mergeRle, rleIntervals } = await imp('modes/discovery.js');
const { findFaces, releasable, createSlab, stepSlab, cellId, slopeDeg, lowestPiste, faceView, knownZone } = await imp('avalanche.js');
const { createCourse, courseLayout, courseSeats, distanceText } = await imp('modes/course.js');
const { createRun } = await imp('game.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { createBot } = await imp('bot.js');
const { SKI, AVALANCHE, MODES, COURSE } = await imp('config.js');
const { unpackResort } = await imp('linepack.js');                 // R8b: resort.json carries packed piste lines (R7-D)
const { housesOnStreets, decodeRoads } = await imp('roads.js');                 // R8d: houses a street runs through
const { buildingBoxes, createBoxIndex } = await imp('look.js');
const { worldcupNets } = await imp('landmarks.js');                             // R8g: the race piste's nets (Arlberg Kandahar)
const { markerList, markerAt, promptable } = await imp('modes/markers.js');      // R8e: the challenge prompt     // R8e: the rides collide with the houses like main.js

const args = process.argv.slice(2);
const RIDES = args.includes('--rides');
const onlyArg = args.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',')) : null;
const rids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
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
  const obs = createObstacles({ resort, field, scatter, density: 0.8, liftWorld: () => lifts.world });      // R8b: R7-B's stations too
  obs.setPistes(pistes.list);                                              // R8e: start banners clear of other pistes
  // R8b: like main.js: R7-B's stations replace the OSM station buildings, the obstacles know the kept (drawn) houses
  const buildingRows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const liftWorld = lifts.setBuildings(buildingRows);
  // R8d: like main.js, a house a street runs through is not drawn either
  const onStreet = housesOnStreets(buildingRows, decodeRoads(JSON.parse(fs.readFileSync(path.join(dir, 'roads.json'), 'utf8'))));
  obs.setBuildings(buildingRows.filter((_, i) => liftWorld.keepBuilding(i) && !onStreet.has(i)));
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
  // R8b (security LOW 3): a friend's avalanche id must be a real zone (avalanche.js knownZone): every cell a skier can release here is
  // known (by the far grid, before any tile is in), the piste middles and forged ids are not
  {
    const zf = typeof faces !== 'undefined' ? faces : [];
    let rel = 0, relKnown = 0, pisteKnown = 0;
    const rr = (() => { let a = 777; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
    for (let k = 0; k < 60000 && rel < 400; k++) {
      const x = 200 + rr() * (resort.width - 400), z = 200 + rr() * (resort.depth - 400);
      if (!releasable(field, x, z, height)) continue;
      rel++; if (knownZone(field, zf, cellId(x, z))) relKnown++;
    }
    for (const p of pistes.list.slice(0, 200)) { const a = p.at(p.length / 2, {}); if (knownZone(field, zf, cellId(a.x, a.z))) pisteKnown++; }
    const forged = ['a-5_3', 'a999999_1', 'x1_2', 'a1_2;', '', 'a1.5_2'].filter((id) => knownZone(field, zf, id)).length;
    check(rel === 0 || (relKnown / rel >= 0.97 && pisteKnown <= 2 && forged === 0), `avalanche zones: ${relKnown}/${rel} releasable cells known to a friend, ${pisteKnown}/200 piste middles and ${forged} forged ids accepted`);
  }

  // ---- course ----
  let clear = 0, moved = 0, beside = 0, lined = 0, seatsOk = 0, worstBury = 0, worstGap = 0, netInHouse = 0, openTotal = 0, edgeTotal = 0;
  const blocked = [], badSeats = [], unlined = [];
  const gates = new Map(), finishes = new Map();
  let gateHits = 0, finishBad = 0, finishMoved = 0;
  const gateHitList = [], finishBadList = [];
  const gp = {};
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    const g = courseGate(p, obs);
    gates.set(p.id, g);
    if (g.ok) clear++; else blocked.push(`${p.id} (${g.why})`);
    if (g.s > 2) moved++;
    if (g.lat) beside++;
    // R8b (3V QA: 13/481 gates touched houses / lift parts): independent of courseGate, the gate's posts and the skier's spot vs R7-B's
    // station frames + solid parts + pylons (lifts.world) and the kept (drawn) houses
    p.at(g.s, gp);
    for (const k of [0, 3.5, -3.5]) {
      const x = gp.x - gp.dz * ((g.lat || 0) + k), z = gp.z + gp.dx * ((g.lat || 0) + k);
      if (lifts.world.inStation(x, z, 1) || lifts.world.hit(x, z, 1) || obs.inBuilding(x, z, 1)) { gateHits++; gateHitList.push(p.id); break; }
    }
    const f = courseFinish(p, obs, g.s);
    finishes.set(p.id, f.s);
    if (f.s < p.length - COURSE.finishBack) finishMoved++;
    p.at(f.s, gp);
    if (!f.ok || [0, p.halfWidth + 0.8, -(p.halfWidth + 0.8)].some((k) => { const x = gp.x - gp.dz * k, z = gp.z + gp.dx * k; return lifts.world.inStation(x, z, 1) || obs.inBuilding(x, z, 1); })) { finishBad++; finishBadList.push(`${p.id} (${f.why})`); }
    const lay = courseLayout(p, g.s, pistes, obs, f.s);
    for (const r of lay.rails) for (let i = 0; i < r.length; i += 8) if (obs.inBuilding(r[i], r[i + 1], 0) || obs.nearStation(r[i], r[i + 1], 0)) netInHouse++;
    // the nets: both sides from the start gate to the finish (the inside of a tight bend may be left out)
    let netLen = 0;
    for (const r of lay.rails) for (let i = 2; i < r.length; i += 2) netLen += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    const cover = (netLen + lay.openLen) / 2 / Math.max(1, lay.finishS - g.s - 4);      // netted or left open on purpose (a house, a hairpin)
    openTotal += lay.openLen; edgeTotal += 2 * Math.max(1, lay.finishS - g.s - 4);
    if (cover > 0.95 && lay.finish && lay.finishS === Math.max(g.s + 30, f.s)) lined++;
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
  check(gateHits === 0, `course: ${gateHits} start gates touch a station / lift part / house (R7-B world + kept houses)${gateHitList.length ? `: ${gateHitList.slice(0, 8).join(', ')}` : ''}`);
  check(finishBad === 0, `course: every ZIL on open snow, clear of stations / houses with a clear 60 m run-in (${finishMoved} moved up the line)${finishBadList.length ? `; not: ${finishBadList.slice(0, 8).join(', ')}` : ''}`);
  check(blocked.length === 0, `course: ${clear}/${total} start gates on open snow (${moved} moved down the piste, ${beside} beside the line)${blocked.length ? `; blocked: ${blocked.slice(0, 8).join(', ')}` : ''}`);
  check(netInHouse === 0, `course: no net through a house or a station hall (${netInHouse} net points inside one)`);
  check(lined === total, `course: ${lined}/${total} courses lined with barriers on both edges (${(openTotal / edgeTotal * 100).toFixed(1)} % of the edges left open at houses / stations / hairpins), finish at the line's real end${unlined.length ? `; not: ${unlined.slice(0, 6).join(', ')}` : ''}`);
  check(seatsOk === total, `course objects: ${seatsOk}/${total} courses with every barrier / arrow / post / ZIL pillar / beam / finish strip on the snow, <= ${COURSE.archHeight} m above it, intended size (net edge over the snow <= ${worstGap.toFixed(2)} m, into it <= ${worstBury.toFixed(2)} m)${badSeats.length ? `; bad: ${badSeats.slice(0, 6).join('; ')}` : ''}`);
  row.gates = `${clear}/${total}`;
  // R7-C2: the barriers hold: a skier at 15 m/s aimed 35° at the net, on the ground, every 5th course
  // R8e (ski-course flow: Kronplatz sylvester stopped dead against a station 33 m below the gate, the Node rides only knew the
  // trees): the rides collide like main.js world.hit = trees + R7-B's pylons / station parts + the kept houses
  const boxIndex = createBoxIndex(buildingBoxes(buildingRows.filter((_, i) => liftWorld.keepBuilding(i) && !onStreet.has(i))));      // R8d: as main.js drawn
  const houseOut = { nx: 0, nz: 0, pen: 0, kind: 'house' };
  const houseHit = (x, z, r, y) => {
    const b = boxIndex.hit(x, z, r);
    if (!b || (y !== undefined && y > b[6])) return null;
    const dx = x - b[0], dz = z - b[1], u = dx * b[2] + dz * b[3], v = -dx * b[3] + dz * b[2];
    const pu = b[4] + r - Math.abs(u), pv = b[5] + r - Math.abs(v);
    if (pu < pv) { const su = Math.sign(u) || 1; houseOut.nx = b[2] * su; houseOut.nz = b[3] * su; houseOut.pen = pu; } else { const sv = Math.sign(v) || 1; houseOut.nx = -b[3] * sv; houseOut.nz = b[2] * sv; houseOut.pen = pv; }
    return houseOut;
  };
  const world = { height, normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: (x, z, r, y) => scatter.hit(x, z, r, y, 0.8) || lifts.world.hit(x, z, r, y, height) || houseHit(x, z, r, y) };
  // R8e: the first 60 m below every start gate (the push start) run on open snow: no station / pylon / house on the line
  let runInBad = 0;
  const runInList = [];
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    const g = gates.get(p.id);
    for (let d = 0; d <= 60; d += 3) {
      p.at(g.s + d, gp);
      const x = gp.x - gp.dz * (g.lat || 0), z = gp.z + gp.dx * (g.lat || 0);
      if (lifts.world.inStation(x, z, 1) || lifts.world.hit(x, z, 1, -Infinity) || obs.inBuilding(x, z, 1)) { runInBad++; runInList.push(`${p.id}@+${d}`); break; }
    }
  }
  // R8e (3V QA "Lac des Creux"): independent of courseGate, no OTHER piste's line through any start banner (+-5.5 m across, +-10 m
  // along), sampled every 0.5 m
  let bannerBad = 0;
  const bannerList = [], q0 = {};
  for (const p of pistes.list) {
    if (ONLY && !ONLY.has(p.id)) continue;
    const g = gates.get(p.id);
    p.at(g.s, gp);
    const gx = gp.x - gp.dz * (g.lat || 0), gz = gp.z + gp.dx * (g.lat || 0), ux = gp.dx, uz = gp.dz;
    for (const q of pistes.list) {
      if (q === p) continue;
      if (gx < Math.min(q.top.x, q.bottom.x) - 3000 || gx > Math.max(q.top.x, q.bottom.x) + 3000) continue;
      const pr = q.project(gx, gz, null, 0, {});
      if (pr.dist > 20) continue;
      let hitQ = false;
      for (let d = -30; d <= 30 && !hitQ; d += 0.5) {
        q.at(Math.max(0, Math.min(q.length, pr.s + d)), q0);
        const a = (q0.x - gx) * ux + (q0.z - gz) * uz, b = -(q0.x - gx) * uz + (q0.z - gz) * ux;
        if (Math.abs(a) <= COURSE.bannerAlong && Math.abs(b) <= 5.5) hitQ = true;
      }
      if (hitQ) { bannerBad++; bannerList.push(`${p.id}x${q.id}`); break; }
    }
  }
  // R8e: the "Start?" prompt of every gate (markers.js promptable over markerList at the gates of courseGate): crossing it sideways at
  // 61 km/h or skiing up through it never asks; skiing into it from above along the piste at 40 km/h and standing in it do
  const mlist = markerList(pistes, null, (p) => gates.get(p.id) || { s: 2, lat: 0 }).filter((m) => !ONLY || ONLY.has(m.id));
  let askBad = 0;
  const askList = [];
  for (const m of mlist) {
    const c = Math.cos(m.heading), sn = Math.sin(m.heading);
    const at = (u, v, dir, speed) => ({ x: m.x + u * c - v * sn, z: m.z + u * sn + v * c, vx: Math.cos(dir) * speed, vz: Math.sin(dir) * speed, speed });
    const asks = (st) => { const g = markerAt(mlist, st.x, st.z); return !!g && g.id === m.id && promptable(g, st); };
    const cross = [-6, -3, 0, 3, 6].some((v) => asks(at(0, v, m.heading + Math.PI / 2, 17)) || asks(at(0, v, m.heading - Math.PI / 2, 17)));
    const up = asks(at(-2, 0, m.heading + Math.PI, 17)) || asks(at(0.5, 0, m.heading + Math.PI, 17));
    const into = asks(at(-4, 0, m.heading, 11)), stand = asks(at(0, 0, m.heading, 0));
    const near = mlist.some((o) => o !== m && Math.hypot(o.x - m.x, o.z - m.z) < 9);      // another gate this close may win markerAt
    if (cross || up || (!near && (!into || !stand))) { askBad++; askList.push(`${m.id}${cross ? ' cross' : ''}${up ? ' up' : ''}${!into ? ' !into' : ''}${!stand ? ' !stand' : ''}`); }
  }
  check(askBad === 0, `challenge prompt: ${mlist.length - askBad}/${mlist.length} gates ask only when stopped or skied into from the start side (never crossing at 61 km/h)${askList.length ? `; bad: ${askList.slice(0, 6).join(', ')}` : ''}`);
  check(bannerBad === 0, `course: no other piste's line through any of the ${total} start banners (+-5.5 m across, +-${COURSE.bannerAlong} m along)${bannerList.length ? ` (${bannerBad} not: ${bannerList.slice(0, 8).join(', ')})` : ''}`);
  check(runInBad === 0, `course: the first 60 m below all ${total} start gates clear of stations / lift parts / houses${runInList.length ? ` (${runInBad} not: ${runInList.slice(0, 8).join(', ')})` : ''}`);
  let hold = 0, holdN = 0, through = 0, stopped = 0, minKeep = 1, missed = 0;
  const holdBad = [];
  let openGap = 0;
  // 23 Nov 2026: the same skiers once more in the AIR (a crest air: 0.6 m over the snow, rising 2.5 m/s): the net turns him back too
  const air = { hold: 0, n: 0, through: 0, bad: [] };
  for (const [i, p] of pistes.list.entries()) {
    if (ONLY ? !ONLY.has(p.id) : i % 5) continue;
    const g = gates.get(p.id) || courseGate(p, obs);
    for (const side of [-1, 1]) for (const airborne of [false, true]) {
      const sA = Math.min(p.length - 40, g.s + 60 + (p.length - g.s) * 0.3);
      if (sA < g.s + 20) continue;
      const c = createCourse({ piste: p, startS: g.s });
      const a = p.at(sA, {});
      const h0 = Math.atan2(a.dz, a.dx) + side * 35 * Math.PI / 180;      // + = towards the right edge
      const x0 = a.x - a.dz * side * (p.halfWidth - 3), z0 = a.z + a.dx * side * (p.halfWidth - 3);
      let s = { ...createSkierState(x0, z0, h0, height(x0, z0)), hold: 0, vx: Math.cos(h0) * 15, vz: Math.sin(h0) * 15, speed: 15 };
      if (airborne) {
        s = { ...s, y: s.y + 0.6, vy: 2.5, grounded: false, air: 0.05 };
        let maxUp = 0;
        for (let w = g.s; w < sA; w += 20) { const q = p.at(w, {}); const st0 = createSkierState(q.x, q.z, 0, height(q.x, q.z)); c.collide(st0, st0); }
        c.collide(s, s);
        let worst = 0, flew = false;
        for (let k = 0; k < 240; k++) {
          const prev = s;
          s = stepSkier(s, { steer: 0, tuck: 0, brake: 0, push: 0, jump: false }, world);
          s = c.collide(prev, s);
          const pr = p.project(s.x, s.z, sA, 120, {});
          const out = Math.abs(pr.off) - (p.halfWidth + 0.5);
          if (out > 0 && !s.grounded) flew = true;
          maxUp = Math.max(maxUp, s.y - height(s.x, s.z));
          worst = Math.max(worst, out);
        }
        if (!flew && worst <= 0.05) { air.n++; air.hold++; continue; }
        const lay = courseLayout(p, g.s, pistes, obs, finishes.get(p.id));
        let near = Infinity;
        for (const r of lay.rails) for (let i = 0; i < r.length; i += 2) near = Math.min(near, Math.hypot(r[i] - s.x, r[i + 1] - s.z));
        if (near > 4) continue;                                           // out through a gap left open at a house / station
        air.n++; air.through++; air.bad.push(`${p.id} side ${side} ${worst.toFixed(2)} m out at s ${Math.round(sA)} (up to ${maxUp.toFixed(1)} m in the air)`);
        continue;
      }
      holdN++;
      // R8d: the course follows the skier down from the gate (in the game he skis there): walk its projection hint down the line, so
      // a piste whose own legs lie side by side (arlberg stapf: two 45 m wide legs 90 m apart) is not read on the wrong leg
      for (let w = g.s; w < sA; w += 20) { const q = p.at(w, {}); const st0 = createSkierState(q.x, q.z, 0, height(q.x, q.z)); c.collide(st0, st0); }
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
      if (worst > 0.05) {
        // R8d: through where the net is left open on purpose (a house / station beside the piste: courseLayout openLen) is no fault
        const lay = courseLayout(p, g.s, pistes, obs, finishes.get(p.id));
        let near = Infinity;
        for (const r of lay.rails) for (let i = 0; i < r.length; i += 2) near = Math.min(near, Math.hypot(r[i] - s.x, r[i + 1] - s.z));
        if (near > 4) { openGap++; holdN--; continue; }
        through++; holdBad.push(`${p.id} side ${side} through ${worst.toFixed(2)} m at s ${Math.round(sA)} (net ${near.toFixed(1)} m away)`);
      }
      if (hitAt < 0) { missed++; holdN--; continue; }                    // fell / stopped before the net (a tree, a crest): no contact
      if (s.speed < 1 && s.crash === 0) { stopped++; holdBad.push(`${p.id} side ${side} stopped at s ${Math.round(sA)}`); }
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
  check(air.through === 0 && air.n > 0, `barriers: ${air.hold}/${air.n} skiers aimed at the net at 54 km/h IN THE AIR (0.6 m up, rising) held inside${air.bad.length ? `; bad: ${air.bad.slice(0, 6).join('; ')}` : ''}`);
  check(through === 0 && stopped === 0 && hold === holdN && holdN > 0, `barriers: ${hold}/${holdN} skiers aimed at the net at 54 km/h held inside (${through} through, ${stopped} stopped, ${missed} never reached it, ${openGap} out through a gap left open at a house / station), speed kept at the hit >= ${(minKeep * 100).toFixed(0)} %${holdBad.length ? `; bad: ${holdBad.slice(0, 6).join('; ')}` : ''}`);
  if (RIDES) {
    let fin = 0, resets = 0, warned = 0, hudBad = 0, hits = 0, outside = 0, timeouts = 0, crossed = 0, jumpedOver = 0, stalls = 0;
    const stallList = [];
    const stuck = [], hudFail = [], timeoutList = [], crossList = [];
    // R8g: every barrier the rider could meet: the race nets (permanent) + each course's own net ribbons, as a 20 m grid of segments
    const raceSegs = [];
    for (const lm of resort.landmarks || []) if (lm.kind === 'worldcup' && pistes.byId.get(lm.piste)) for (const r of worldcupNets(pistes.byId.get(lm.piste), height, pistes).runs) for (let i = 3; i < r.length; i += 3) raceSegs.push([r[i - 3], r[i - 1], r[i], r[i + 2]]);
    const segGrid = (segs) => { const g = new Map(); for (const q of segs) for (let i = Math.floor(Math.min(q[0], q[2]) / 20); i <= Math.floor(Math.max(q[0], q[2]) / 20); i++) for (let j = Math.floor(Math.min(q[1], q[3]) / 20); j <= Math.floor(Math.max(q[1], q[3]) / 20); j++) { const k = i * 65536 + j; if (!g.has(k)) g.set(k, []); g.get(k).push(q); } return g; };
    const cross = (g, ax, az, bx, bz) => {
      const ka = Math.floor(ax / 20) * 65536 + Math.floor(az / 20), kb = Math.floor(bx / 20) * 65536 + Math.floor(bz / 20);
      for (const q of ka === kb ? g.get(kb) || [] : [...(g.get(ka) || []), ...(g.get(kb) || [])]) {
        const d1 = (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax), d2 = (bx - ax) * (q[3] - az) - (bz - az) * (q[2] - ax);
        const d3 = (q[2] - q[0]) * (az - q[1]) - (q[3] - q[1]) * (ax - q[0]), d4 = (q[2] - q[0]) * (bz - q[1]) - (q[3] - q[1]) * (bx - q[0]);
        if (d1 * d2 < 0 && d3 * d4 < 0) return true;
      }
      return false;
    };
    for (const p of pistes.list) {
      if (ONLY && !ONLY.has(p.id)) continue;
      const g = gates.get(p.id);
      const run = createRun({ piste: p, mode: MODES.run, startS: g.s, finishS: finishes.get(p.id) });
      const lay = courseLayout(p, g.s, pistes, obs, finishes.get(p.id));
      const course = createCourse({ piste: p, startS: g.s, finishS: finishes.get(p.id), open: lay.openAt });      // R8e: like main.js
      const own = [...raceSegs];
      for (const r of lay.rails) for (let i = 2; i < r.length; i += 2) own.push([r[i - 2], r[i - 1], r[i], r[i + 1]]);
      const bars = segGrid(own);
      let timedOut = null, crossedAt = null, stalled = null;
      const trail = [];                                       // [t, run progress] of the last stuckAfter + 1 s: progress before a timer ran out
      const a = p.at(g.s, {});
      const x0 = a.x - a.dz * (g.lat || 0), z0 = a.z + a.dx * (g.lat || 0);
      let s = createSkierState(x0, z0, Math.atan2(a.dz, a.dx), height(x0, z0));
      s = { ...s, hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };      // the push start (main.js pushStart) ends the standing hold
      const bot = createBot(p, { blocked: (x, z) => { const y = height(x, z); return !!(lifts.world.hit(x, z, 2.5, y, height) || houseHit(x, z, 2.5, y)); } });      // R8e: round a station / house on the line (2.5 m margin: he carves wide)
      let t = 0, done = false, low = Infinity, rise = 0, atFinish = null, lastRemain = null, fresh = true;
      const limit = 300 + p.length / 3;                       // long flat ski routes (Arlberg woster-bockbachtal: 8.2 km) take time
      while (t < limit && !done) {
        const was = s.crash > 0;
        const prev = s;
        const inp = bot(s);
        s = stepSkier(s, inp, world);
        s = course.collide(prev, s);
        if (was && s.crash === 0) {
          let r = run.respawnPoint();
          // R8e: like main.js clearSpot: a respawn spot in a house / station part moves along the line to the nearest clear one
          const stuckAt = (x, z) => !!(houseHit(x, z, 1.5) || lifts.world.hit(x, z, 1.5, height(x, z), height));
          if (stuckAt(r.x, r.z)) for (const ds of [8, -8, 16, -16, 30]) { const a = p.at(Math.max(2, Math.min(p.length - 2, (r.s || run.progress) + ds)), {}); if (!stuckAt(a.x, a.z)) { r = { x: a.x, z: a.z, heading: Math.atan2(a.dz, a.dx), s: a.s }; break; } }
          s = createSkierState(r.x, r.z, r.heading, height(r.x, r.z)); fresh = true; course.rebase();
        }
        // R8g: the skier never passes through a net on his way (a put-down after a crash is no crossing)
        // a jump that carries him over the net (> 1.1 m above the snow there) is no crossing: it is counted apart
        if (!fresh && crossedAt === null && cross(bars, prev.x, prev.z, s.x, s.z) && !s.grounded && Math.max(prev.y - height(prev.x, prev.z), s.y - height(s.x, s.z)) > 1.05) jumpedOver++;
        else if (!fresh && crossedAt === null && cross(bars, prev.x, prev.z, s.x, s.z)) { const q = p.project(s.x, s.z, null, 0, {}); crossedAt = `${Math.round(q.s)} (off ${q.off.toFixed(1)} m, hw ${p.halfWidth.toFixed(1)}, ${s.crash > 0 ? 'crash' : !s.grounded ? `air ${s.air.toFixed(2)} s` : `${s.speed.toFixed(1)} m/s`}, t ${t.toFixed(0)} s${process.env.R7C_TRACE === p.id ? `, open ${lay.openAt(q.s, Math.sign(q.off))} prev off ${p.project(prev.x, prev.z, null, 0, {}).off.toFixed(2)} at ${s.x.toFixed(1)},${s.z.toFixed(1)}` : ''})`; }
        const c = course.update(s, SKI.dt);
        if (c.warn) warned++;
        // R8g: neither course timer ("Zréck op d'Pist" 8 s off the course, 10 s standing without progress) runs out on a ride
        // the stuck timer (no 1 m of progress for COURSE.stuckAfter s, < 1 m/s) is a stall of the scripted skier (listed apart); any
        // other timer, or one while he still got anywhere, is a fault
        trail.push([t, c.s]); while (trail.length && trail[0][0] < t - COURSE.stuckAfter - 1) trail.shift();
        if (c.abort && timedOut === null && stalled === null) {
          const gain = Math.max(...trail.map((q) => q[1])) - trail[0][1];
          const at = `at s ${Math.round(c.s)} after ${t.toFixed(0)} s`;
          // the stuck timer only runs out without 1 m beyond the best point reached (he may have slid back and forth): a stall
          if (c.why === 'stuck') stalled = at; else timedOut = `${c.why} ${at}, ${gain.toFixed(0)} m gained in the last ${COURSE.stuckAfter} s`;
        }
        // the HUD distance: falls along the ride (a crash puts him back up to 10 m: a new reference)
        if (fresh) { low = c.remaining; fresh = false; } else { rise = Math.max(rise, c.remaining - low); low = Math.min(low, c.remaining); }
        lastRemain = c.remaining;
        for (const ev of run.update(s, SKI.dt)) {
          if (ev.type === 'finish' || ev.type === 'invalid') { done = true; atFinish = lastRemain; }
          if (ev.type === 'offpiste') resets++;
        }
        t += SKI.dt;
        if (process.env.R7C_TRACE === p.id && Math.round(t / SKI.dt) % 120 === 0) console.log(`    t ${t.toFixed(0)} steer ${inp.steer.toFixed(2)} push ${inp.push} hd ${(s.heading * 57.3).toFixed(0)} line ${(Math.atan2(p.at(run.progress, {}).dz, p.at(run.progress, {}).dx) * 57.3).toFixed(0)} s ${Math.round(run.progress)} v ${s.speed.toFixed(1)} hold ${s.hold} crash ${s.crash.toFixed(1)} y ${s.y.toFixed(0)} off ${p.project(s.x, s.z, null, 0, {}).off.toFixed(1)} at ${s.x.toFixed(0)},${s.z.toFixed(0)} in ${lifts.world.inStation(s.x, s.z, 1) ? 'station' : lifts.world.hit(s.x, s.z, 1, -Infinity) ? 'lift part' : houseHit(s.x, s.z, 1) ? 'house' : scatter.hit(s.x, s.z, 1, undefined, 0.8) ? 'tree' : '-'}`);
      }
      if (timedOut !== null) { timeouts++; timeoutList.push(`${p.id} (${timedOut})`); }
      if (stalled !== null) { stalls++; stallList.push(`${p.id} ${stalled}`); }
      if (crossedAt !== null) { crossed++; crossList.push(`${p.id} at s ${crossedAt}`); }
      hits += course.hits;
      const pr = p.project(s.x, s.z, null, 0, {});
      if (pr.dist > p.halfWidth + 0.6 && course.hits) outside++;
      if (done) fin++; else stuck.push(`${p.id}@${Math.round(run.progress)}/${Math.round(p.length)}`);
      const startText = distanceText(course.finishS - g.s), endText = atFinish === null ? '-' : distanceText(atFinish);
      if (!done || atFinish >= 30 || rise > 15) { hudBad++; hudFail.push(`${p.id}: ${startText} -> ${endText}, rise ${rise.toFixed(0)} m`); }
    }
    check(fin === total && resets === 0, `course rides: ${fin}/${total} finished by the scripted skier inside the course, ${resets} silent resets${stuck.length ? `; not finished: ${stuck.slice(0, 10).join(', ')}` : ''}`);
    check(hudBad === 0, `course HUD: the distance falls along all ${total} rides and reads < 30 m at the ZIL (${hits} barrier contacts, ${outside} ended outside a barrier)${hudFail.length ? `; bad: ${hudFail.slice(0, 6).join('; ')}` : ''}`);
    check(timeouts === 0, `course timers: ${timeouts} of ${total} rides timed out while getting anywhere (off course 8 s, or standing with progress)${timeoutList.length ? `; ${timeoutList.slice(0, 8).join(', ')}` : ''}`);
    console.log(`  info  course stalls: ${stalls} rides where the scripted skier stood ${COURSE.stuckAfter} s without 1 m of progress (the stuck choice would come up)${stallList.length ? `: ${stallList.join(', ')}` : ''}`);
    check(crossed === 0, `course barriers: ${total - crossed}/${total} rides reach the ZIL without passing through a net (course + race nets; ${jumpedOver} times a jump carried him over one)${crossList.length ? `; through: ${crossList.slice(0, 8).join(', ')}` : ''}`);
    row.rides = `${fin}/${total}, ${timeouts} timeouts, ${stalls} stalls, ${crossed} through a net`;
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  report.push(row);
}
console.log('\nper resort:');
for (const r of report) console.log(`  ${r.rid.padEnd(10)} spawn ${r.spawn} | teleport ${r.teleport} | faces ${r.faces} | gates ${r.gates}${r.rides ? ` | rides ${r.rides}` : ''}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
