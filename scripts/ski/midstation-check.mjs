#!/usr/bin/env node
/* Mid station check (28 Nov 2026): every lift with `stops` (a train's mid stations) and every multi-section lift (a section's top and the
 * next section's bottom in one shared station, modes/freeride.js sectionAfter) in all 11 resorts, with the game's own code (Node).
 *   stops    a stop on the snow has a platform + boarding mat (waiting spot in the mat, clear of walls); a stop underground (tunnel)
 *            has none (the train passes it); the exit out of each stop's platform exists (lift-site.js exitOf with the stop's frame):
 *            on snow, outside every station / building / lane, 15 m clear ahead, facing downhill, a piste within PISTE_M m (not a
 *            fallback, not steep); a ride up through every stop (stay) and one that gets out at each stop (out) end cleanly
 *   chains   the next section exists, its boarding zone is where the section before ends (<= CHAIN_M); a ride that stays in
 *            (createRide chainNext) ends in the 'through' phase at the station, the next section's `through` ride starts on the
 *            carrier in its bottom station and runs to its own top (no jump of the carrier's place larger than JUMP_M), the choice
 *            "out" gets out at the section's top as before
 *   node scripts/ski/midstation-check.mjs [resort ...] [--verbose]     exit 1 on any failure */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet, CHAIN_M, STOP_PISTE_M } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { createRide, MID } = await imp('modes/liftride.js');

const PISTE_M = STOP_PISTE_M, JUMP_M = 45, DT = 1 / 30;
const args = process.argv.slice(2), verbose = args.includes('--verbose');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
const resorts = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : ALL;
let failed = 0, checks = 0;
const bad = (msg) => { failed++; console.log('FAIL', msg); };
const ok = (cond, msg) => { checks++; if (!cond) bad(msg); else if (verbose) console.log('ok  ', msg); };

/** Steps a ride until `stop(ride)` or done / limit; returns { steps, jump (largest carrier move per step) }. */
function run(ride, until, limit = 60 * 30 * 4) {
  let n = 0, jump = 0, px = null, pz = null;
  while (n < limit && !until(ride)) {
    ride.step(DT); n++;
    const w = ride.where();
    if (!Number.isFinite(w.x + w.y + w.z)) return { n, jump: Infinity, nan: true };
    if (px !== null && ride.phase !== 'board') jump = Math.max(jump, Math.hypot(w.x - px, w.z - pz));
    px = w.x; pz = w.z;
  }
  return { n, jump };
}

for (const rid of resorts) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const H = (x, z) => field.height(x, z);
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, field.farHeight, pistes);
  const world = net.world;
  const nearestPiste = (x, z) => { let d = 1e9; for (const p of pistes.list) for (let s = 0; s <= p.length; s += 40) { const q = p.at(s, {}); d = Math.min(d, Math.hypot(q.x - x, q.z - z)); } return d; };
  // ---- stops
  let nStops = 0, nTunnel = 0;
  for (const l of net.list) {
    const src = resort.lifts[l.index];
    const declared = (src.stops || []).length;
    if (!declared) continue;
    const site = world.sites.get(l.index);
    const stops = net.stopsOf(l), allStops = net.stopsOf(l, true);
    nTunnel += declared - allStops.length;
    for (const q of allStops) if (!stops.includes(q) && !stops.some((o) => o.s === q.s)) console.log(`${rid}: ${l.name} stop "${q.name}" @${Math.round(q.s)}: no piste within ${STOP_PISTE_M} m of the platform, the train passes it`);
    console.log(`${rid}: ${l.name} (${l.kind}) has ${declared} stops, ${allStops.length} on the snow, ${stops.length} served: ${stops.map((q) => `${q.name} @${Math.round(q.s)}`).join(', ')}${declared > stops.length ? ` (underground: ${(src.stops || []).filter(([s]) => !allStops.some((q) => q.s === s)).map((x) => x[1]).join(', ')})` : ''}`);
    for (const st of stops) {
      nStops++;
      const tag = `${rid} ${l.name} stop "${st.name}" @${Math.round(st.s)}`;
      const f = st.frame;
      ok(f.inZone(st.wait.x, st.wait.z), `${tag}: the waiting spot is in the boarding mat`);
      const hit = world.stopAt(st.wait.x, st.wait.z), cat = net.catchAt(st.wait.x, st.wait.z);
      ok(!!hit && hit.stop === f && hit.index === l.index, `${tag}: world.stopAt finds the stop from its waiting spot`);
      ok(!!cat && cat.stop === f && cat.lift === l && cat.d === 0, `${tag}: lifts.catchAt gives the stop (the boarding button shows)`);
      ok(!world.hit(st.wait.x, st.wait.z, 0.3, H(st.wait.x, st.wait.z) + 0.6, H), `${tag}: the waiting spot is clear of walls`);
      ok(!world.inBuilding(st.wait.x, st.wait.z, 0.3), `${tag}: the waiting spot is outside every building`);
      const why = {};
      const ex = world.exitOf(l.index, H, null, pistes.list, why, f);
      ok(!!ex && !ex.fallback, `${tag}: an exit exists (${ex ? `${Math.round(ex.dist)} m out${ex.steep ? ', steep' : ''}${ex.fallback ? ', FALLBACK' : ''}` : 'none ' + JSON.stringify(why)})`);
      if (ex) {
        ok(!ex.steep, `${tag}: the exit is walkable (slope ${ex.slope !== undefined ? ex.slope.toFixed(2) : '?'})`);
        ok(!world.inStation(ex.x, ex.z, 1.5) && !world.inBuilding(ex.x, ex.z, 1.5), `${tag}: the exit is outside every station and building`);
        let wall = false;
        for (let m = 0; m <= 15; m += 1) { const x = ex.x + Math.cos(ex.heading) * m, z = ex.z + Math.sin(ex.heading) * m; if (world.hit(x, z, 0.4, H(x, z), H) || world.inBuilding(x, z, 0.8)) wall = true; }
        ok(!wall, `${tag}: 15 m clear ahead of the exit`);
        const dp = nearestPiste(ex.x, ex.z);
        ok(dp <= PISTE_M, `${tag}: a piste ${Math.round(dp)} m from the exit (<= ${PISTE_M})`);
        const h0 = H(ex.x, ex.z), h1 = H(ex.x + Math.cos(ex.heading) * 15, ex.z + Math.sin(ex.heading) * 15);
        ok(h1 <= h0 + 0.35, `${tag}: facing downhill / level (${(h1 - h0).toFixed(2)} m over 15 m)`);
      }
    }
    // rides: stay through every stop to the top, and get out at each stop
    const path_ = net.paths.get(l.index);
    const mk = (extra = {}) => createRide({ lift: l, path: path_, site, height: H, stops: net.stopsOf(l).map((q) => ({ ...q, passed: false, exitAt: () => world.exitOf(l.index, H, null, pistes.list, null, q.frame) })), exitAt: () => world.exitOf(l.index, H, null, pistes.list), ...extra });
    {
      const r = mk();
      run(r, (x) => x.phase === 'ride', 3000);
      let seen = 0, last = false;
      const res = run(r, (x) => { const d = x.dwelling; if (d && !last) seen++; last = d; return x.done; }, 60 * 30 * 30);
      ok(r.done && seen === stops.length && !res.nan, `${rid} ${l.name}: rides to the top staying in, stopped at ${seen} / ${stops.length} stops (${(res.n * DT / 60).toFixed(1)} min)`);
      ok(res.jump < JUMP_M, `${rid} ${l.name}: no jump of the carrier (${res.jump.toFixed(1)} m per step)`);
    }
    for (let k = 0; k < stops.length; k++) {
      const r = mk();
      run(r, (x) => x.phase === 'ride', 3000);
      let at = -1, chose = false, was = false;
      const res = run(r, (x) => { if (x.dwelling && !was) { at++; if (at === k) { x.choose('out'); chose = true; } } was = x.dwelling; return x.done; }, 60 * 30 * 30);
      const e = r.exit;
      ok(r.done && chose && e && Number.isFinite(e.x) && !res.nan, `${rid} ${l.name}: gets out at stop ${k} "${stops[k].name}" and ends on the exit (${e ? `${Math.round(Math.hypot(e.x - stops[k].off.x, e.z - stops[k].off.z))} m from the platform` : 'no exit'})`);
      if (e) ok(Math.hypot(e.x - stops[k].off.x, e.z - stops[k].off.z) < 130, `${rid} ${l.name}: the exit of stop ${k} is near its platform`);
    }
    // boarding at each stop and riding on to the top
    for (const st of stops) {
      const r = createRide({ lift: l, path: path_, site, height: H, from: { x: st.wait.x, z: st.wait.z, heading: st.wait.heading }, fromStop: st, stops: net.stopsOf(l).map((q) => ({ ...q, passed: false, exitAt: () => world.exitOf(l.index, H, null, pistes.list, null, q.frame) })), exitAt: () => world.exitOf(l.index, H, null, pistes.list) });
      const res = run(r, (x) => x.done, 60 * 30 * 30);
      ok(r.done && !res.nan && res.jump < JUMP_M, `${rid} ${l.name}: boarding at stop "${st.name}" rides on to the top (jump ${res.jump.toFixed(1)} m)`);
    }
  }
  // ---- multi-section lifts
  const chains = [];
  for (const l of net.list) { const n = net.sectionAfter(l); if (n) chains.push([l, n]); }
  console.log(`${rid}: ${nStops} mid stops on the snow${nTunnel ? ` (${nTunnel} underground, no platform)` : ''}; ${chains.length} multi-section links: ${chains.map(([a, b]) => `${a.name} -> ${b.name}`).join(' | ') || '-'}`);
  for (const [a, b] of chains) {
    const tag = `${rid} ${a.name} -> ${b.name}`;
    const sa = world.sites.get(a.index), sb = world.sites.get(b.index), pa = net.paths.get(a.index), pb = net.paths.get(b.index);
    const d = Math.hypot(b.bottom.x - a.top.x, b.bottom.z - a.top.z);
    ok(d <= CHAIN_M, `${tag}: the sections' stations are ${d.toFixed(1)} m apart`);
    ok(sb.inZone(sb.wait.x, sb.wait.z) && !world.hit(sb.wait.x, sb.wait.z, 0.3, H(sb.wait.x, sb.wait.z) + 0.6, H), `${tag}: boarding the next section here (its waiting spot is in its zone, clear)`);
    ok(!a.down || (sa.down && sa.down.inZone(sa.down.wait.x, sa.down.wait.z)), `${tag}: ${a.down ? 'ride down from the shared station: the descent mat is there' : 'section 1 has no ride down'}`);
    const exitA = () => world.exitOf(a.index, H, null, pistes.list);
    // stays in -> through at the top
    const r1 = createRide({ lift: a, path: pa, site: sa, height: H, chainNext: b, exitAt: exitA });
    run(r1, (x) => x.phase === 'ride', 3000);
    let sawMid = false;
    const res1 = run(r1, (x) => { if (x.mid && x.mid.kind === 'chain') sawMid = true; return x.through || x.done; }, 60 * 30 * 30);
    ok(r1.through && sawMid && !res1.nan, `${tag}: staying in ends 'through' at the shared station (the choice showed before)`);
    // the next section on from there
    const r2 = createRide({ lift: b, path: pb, site: sb, height: H, through: true, chainNext: net.sectionAfter(b), exitAt: () => world.exitOf(b.index, H, null, pistes.list) });
    ok(r2.phase === 'ride', `${tag}: the next section starts on the carrier (no boarding)`);
    const res2 = run(r2, (x) => x.through || x.done, 60 * 30 * 30);
    ok((r2.through || r2.done) && !res2.nan && res2.jump < JUMP_M, `${tag}: the next section rides to its own top (jump ${res2.jump.toFixed(1)} m)`);
    // the carrier of section 1 at its top and of section 2 at its bottom: where it jumps over the fade
    const w1 = r1.where(), w2 = createRide({ lift: b, path: pb, site: sb, height: H, through: true }).where();
    ok(Math.hypot(w2.x - w1.x, w2.z - w1.z) < 40, `${tag}: the carrier goes on ${Math.hypot(w2.x - w1.x, w2.z - w1.z).toFixed(1)} m away (under the fade)`);
    // out -> as before
    const r3 = createRide({ lift: a, path: pa, site: sa, height: H, chainNext: b, exitAt: exitA });
    run(r3, (x) => x.phase === 'ride', 3000);
    run(r3, (x) => x.phase === 'ride' && x.mid, 60 * 30 * 30);
    r3.choose('out');
    const res3 = run(r3, (x) => x.done || x.through, 60 * 30 * 30);
    ok(r3.done && !r3.through && r3.exit && !res3.nan, `${tag}: "Hei erausgoen" gets out at the shared station, onto the exit`);
  }
}
console.log(`midstation-check: ${checks} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
