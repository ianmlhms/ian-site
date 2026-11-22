#!/usr/bin/env node
/* Round 6 checks without a browser (pure modules only): every lift of every resort can be ridden (lift-path.js + modes/liftride.js),
 * the free ride's spawn lift, the challenge gates, the ski types (handling measurably different on a test slope, the fair reference set,
 * the unlocks), the save / cloud fields and the multiplayer "riding lift X at s" wire variant.
 *   node scripts/ski/round6-test.mjs [resort ...]      (default: every baked resort)    exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackResort } from '../../pb/ski/linepack.js';      // R7-D: packed piste lines

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftPath, liftClass } = await imp('lift-path.js');
const { createLiftSite } = await imp('lift-site.js');
const { createRide, riderAt, rideSeconds, RIDE, KIND_CODE } = await imp('modes/liftride.js');
const { createLiftNet, spawnLift } = await imp('modes/freeride.js');
const { markerList, markerAt } = await imp('modes/markers.js');
const { SKI_TYPES, skiParams, skiUnlock, skiStatsOf, addSkiStats } = await imp('modes/skis.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { SKI } = await imp('config.js');
const { packState, unpackState } = await imp('net/wire.js');
const { encodeCloud, decodeCloud, mergeCloud } = await imp('modes/cloud.js');
const { emptyProgress, normalize } = await imp('progress.js');
const { createParkLayout } = await imp('modes/park.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${text}`); } };
const resorts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json')));

for (const rid of resorts) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));      // R7-D: packed piste lines
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network) });
  const h = (x, z) => field.farHeight(x, z);
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, h, pistes);
  const kinds = {};
  let rides = 0, worstJump = 0, worstClear = Infinity, longest = 0;
  for (const lift of net.list) {
    const p = createLiftPath(resort.lifts[lift.index], h);
    ok(!!p, `${rid} ${lift.name}: has a line`);
    if (!p) continue;
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    const r = createRide({ lift, path: p, site: net.world.sites.get(lift.index), height: h });      // R7-B: from station to station
    let prev = null, steps = 0, rideSteps = 0, midState = null;
    while (!r.done && steps < 200000) {
      r.step(1 / 60); steps++;
      if (r.phase === 'ride') { rideSteps++; if (!midState) midState = r.state(createSkierState(0, 0, 0, 0)); }
      const w = r.where();
      if (prev) worstJump = Math.max(worstJump, Math.hypot(w.x - prev.x, w.y - prev.y, w.z - prev.z));
      if (w.onCarrier && p.kind !== 'drag' && p.kind !== 'train' && p.kind !== 'carpet') worstClear = Math.min(worstClear, w.y - h(w.x, w.z));
      prev = { ...w };
    }
    ok(r.done, `${rid} ${lift.name} (${p.kind}): the ride ends`);
    const secs = rideSteps / 60;
    longest = Math.max(longest, secs);
    ok(Math.abs(secs - rideSeconds(p)) < 0.2, `${rid} ${lift.name}: ${secs.toFixed(1)} s = rideSeconds ${rideSeconds(p).toFixed(1)}`);
    const st = midState || {};
    ok(st.ride && st.rideLift === lift.index && st.rideKind === KIND_CODE[p.kind], `${rid} ${lift.name}: the ride state carries the lift`);
    const top = net.startAt(lift, h);
    // R8d: a funitel / 3S station (R8e, 22 m long) on a cramped summit (Klein Matterhorn: 128 m to open snow) may put him a little farther
    ok(Math.hypot(top.x - lift.top.x, top.z - lift.top.z) < (p.sub === 'funitel' ? 150 : 120), `${rid} ${lift.name}: off at the top (${Math.round(Math.hypot(top.x - lift.top.x, top.z - lift.top.z))} m from the station)`);
    rides++;
  }
  ok(worstJump < SKI.maxSpeed * RIDE.factor / 60 * 1.2 + 0.5, `${rid}: no jump along a ride (worst ${worstJump.toFixed(2)} m per frame)`);
  ok(worstClear > -1.5, `${rid}: chairs / cabins stay above the ground (worst clearance ${worstClear.toFixed(1)} m on the far grid)`);
  const spawn = spawnLift(net, resort.places);
  const village = (resort.places || []).filter((p) => p.kind === 'village' || p.kind === 'town');
  const dv = Math.min(...village.map((v) => Math.hypot(v.x - spawn.bottom.x, v.z - spawn.bottom.z)));
  ok(spawn && spawn.kind !== 'drag' && dv < 1500, `${rid}: spawn ${spawn && spawn.name} (${spawn && spawn.kind}) ${Math.round(dv)} m from a village`);
  const layout = createParkLayout(resort.park);
  const marks = markerList(pistes, layout);
  ok(marks.length === pistes.list.length + (layout ? 1 : 0), `${rid}: ${marks.length} challenge gates (every piste${layout ? ' + the park' : ''})`);
  const m0 = marks[Math.floor(marks.length / 2)];
  const hit = markerAt(marks, m0.x + 3, m0.z - 2);
  ok(hit && Math.hypot(hit.x - m0.x - 3, hit.z - m0.z + 2) < 9, `${rid}: skiing into a gate finds it`);
  console.log(`${rid}: ${rides} lifts ridden (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), longest ${longest.toFixed(0)} s at x${RIDE.factor}, spawn ${spawn.name}, ${marks.length} gates`);
}

// lift classes of the bigger data
ok(liftClass('funicular') === 'train' && liftClass('rack_railway') === 'train' && liftClass('t-bar') === 'drag' && liftClass('carpet') === 'carpet', 'lift classes: rail kinds ride as a train, carpets ride on the belt (R7-B)');
const fake = createLiftPath({ kind: 'funicular', pts: [0, 0, 300, 400, 900, 1200], pylons: [] }, (x, z) => 1600 + 0.4 * Math.hypot(x, z));
const fr = createRide({ lift: { index: 99, name: 'Test' }, path: fake, site: createLiftSite(fake), height: (x, z) => 1600 + 0.4 * Math.hypot(x, z) });
let n = 0, pitch = 0; while (!fr.done && n < 1e5) { fr.step(1 / 60); n++; if (fr.phase === 'ride') pitch = fr.where().pitch; }
ok(fr.done && fake.kind === 'train' && Math.abs(pitch - Math.atan(0.4)) < 0.05, `a funicular rides as a train on its rails (pitch ${pitch.toFixed(2)})`);

/* ---------------- ski types: the handling on a test slope ---------------- */
function slopeWorld(deg, snow, ski) {
  const t = Math.tan(deg * Math.PI / 180), ny = 1 / Math.hypot(1, t), nx = t * ny;
  return { height: (x) => -t * x, normal: (x, z, o) => { o.x = nx; o.y = ny; o.z = 0; return o; }, snow: () => snow, hit: () => null, ski };
}
function topSpeed(ski, deg, snow, seconds = 25) {
  const w = slopeWorld(deg, snow, ski);
  let s = createSkierState(0, 0, 0, 0);
  for (let i = 0; i < seconds / SKI.dt; i++) s = stepSkier(s, { steer: 0, tuck: 1, brake: 0, push: 0, jump: false }, w);
  return s.speed * 3.6;
}
function turnTime(ski, deg = 18) {             // a hard turn at speed: seconds to turn 90 degrees across the slope
  const w = slopeWorld(deg, 1, ski);
  let s = createSkierState(0, 0, 0, 0);
  for (let i = 0; i < 4 / SKI.dt; i++) s = stepSkier(s, { steer: 0, tuck: 1, brake: 0, push: 0, jump: false }, w);
  const h0 = Math.atan2(s.vz, s.vx);
  for (let i = 0; i < 6 / SKI.dt; i++) {
    s = stepSkier(s, { steer: 1, tuck: 0, brake: 0, push: 0, jump: false }, w);
    if (Math.abs(Math.atan2(s.vz, s.vx) - h0) >= Math.PI / 2) return i * SKI.dt;
  }
  return 6;
}
const table = SKI_TYPES.map((t) => {
  const k = skiParams(t.id);
  return { id: t.id, piste: topSpeed(k, 12, 1), powder: topSpeed(k, 22, 0), turn: turnTime(k), spin: k.spinRate, landing: k.spinCrash };
});
console.log('ski        piste km/h  powder km/h  turn 90° s  spin rad/s  spin-crash rad');
for (const r of table) console.log(`${r.id.padEnd(11)}${r.piste.toFixed(1).padStart(10)}${r.powder.toFixed(1).padStart(13)}${r.turn.toFixed(2).padStart(12)}${r.spin.toFixed(1).padStart(12)}${r.landing.toFixed(2).padStart(15)}`);
const T = Object.fromEntries(table.map((r) => [r.id, r]));
const AM = T.allmountain;
ok(T.race.piste > AM.piste + 3, `Race GS is faster on the piste (${T.race.piste.toFixed(1)} vs ${AM.piste.toFixed(1)} km/h)`);
ok(T.race.turn > AM.turn * 1.08, `Race GS turns wider (${T.race.turn.toFixed(2)} vs ${AM.turn.toFixed(2)} s for 90°)`);
ok(T.carving.turn < AM.turn * 0.95, `Carving turns sharper on hard snow (${T.carving.turn.toFixed(2)} vs ${AM.turn.toFixed(2)} s)`);
ok(T.carving.powder < AM.powder - 2, `Carving sinks in powder (${T.carving.powder.toFixed(1)} vs ${AM.powder.toFixed(1)} km/h)`);
ok(T.powder.powder > AM.powder + 5, `Powder floats off piste (${T.powder.powder.toFixed(1)} vs ${AM.powder.toFixed(1)} km/h)`);
ok(T.powder.piste < AM.piste - 2, `Powder is slow on the hard piste (${T.powder.piste.toFixed(1)} vs ${AM.piste.toFixed(1)} km/h)`);
ok(T.park.spin > AM.spin * 1.1 && T.park.landing > AM.landing * 1.1 && T.park.piste < AM.piste, `Park twin-tip spins easier, lands softer, is slower (${T.park.piste.toFixed(1)} km/h)`);
ok(skiParams('race', true) === SKI && skiParams('powder', true) === SKI, 'fair runs: every ski = the reference set');
ok(Object.isFrozen(SKI) && SKI.cdaTuck === 0.42, 'config.js SKI is never touched');

/* ---------------- unlocks, saves ---------------- */
const fresh = emptyProgress();
const st0 = skiStatsOf(fresh, 0);
ok(SKI_TYPES.filter((t) => skiUnlock(t, st0).open).map((t) => t.id).join() === 'allmountain', 'a new player: only the All-Mountain ski');
const p1 = addSkiStats(fresh, { off: 10200, top: 26 });
ok(p1 !== fresh && fresh.stats.off === 0 && p1.stats.off === 10200, 'addSkiStats returns a NEW progress');
const st1 = skiStatsOf({ ...p1, park: { killy: 5200 } }, 31);
ok(SKI_TYPES.every((t) => skiUnlock(t, st1).open), `31 ★, 10.2 km off piste, ${(26 * 3.6).toFixed(0)} km/h, 5200 park points: every ski open`);
ok(!skiUnlock(SKI_TYPES.find((t) => t.id === 'race'), skiStatsOf(p1, 29)).open, 'Race GS needs the stars too');
const saved = normalize(JSON.parse(JSON.stringify({ ...p1, ski: 'powder' })));
ok(saved.stats.off === 10200 && saved.ski === 'powder' && normalize({ v: 1, best: { 'killy/x': 5000 } }).stats.off === 0, 'the local save keeps the stats and the ski; old saves read as zero');
const rec = encodeCloud({ ...p1, stars: { 'killy/abcde': 7 }, park: {}, bestHash: {}, ski: 'carving' });
const back = decodeCloud(JSON.parse(JSON.stringify(rec)));
ok(back.stats.off === 10200 && Math.abs(back.stats.top - 26) < 0.11 && back.ski === 'carving' && back.stars['killy/abcde'] === 7, 'cloud record: stats + ski round-trip, stars kept');
const old = decodeCloud({ v: 1, tb: 3, s: { killy: 'zzzzz7' }, p: {}, b: {} });
ok(old && old.stats.off === 0 && old.stars['killy/zzzzz'] === 7, 'an old cloud record (no x) still reads');
const merged = mergeCloud({ ...fresh, stats: { off: 50, top: 30 } }, back);
ok(merged.stats.off === 10200 && merged.stats.top === 30, 'merge keeps the bigger of each stat');

/* ---------------- multiplayer wire ---------------- */
const rs = { x: 10, y: 2000, z: 20, heading: 0.5, speed: 0, edge: 0, tuck: 0, brake: 0, grounded: true, air: 0, crash: 0, landed: 0, vx: 1, vy: 0, vz: 2, ride: 'sit', rideLift: 12, rideKind: 1, rideS: 345.67 };
const a = packState(rs, 0, false);
const u = unpackState(JSON.parse(JSON.stringify(a)));
ok(a.length === 19 && u.ride === 'sit' && u.rideLift === 12 && u.rideKind === 1 && Math.abs(u.rideS - 345.7) < 0.01, 'riding lift X at s: packed and read back');
const plain = packState({ ...rs, ride: '' }, 0, false);
ok(plain.length === 16 && !unpackState(plain).ride, 'not riding: the old 16 numbers');
ok(!unpackState([...plain.slice(0, 8), 4 | 1, ...plain.slice(9), 9, 1, 1]).ride, 'a bad kind code is ignored');

console.log(`${checks - fails} / ${checks} checks green`);
process.exit(fails ? 1 : 0);
