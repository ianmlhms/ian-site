#!/usr/bin/env node
/* MTB Mëllerdall: the play harness.   node pb/mtb/harness-play.js [--rides] [--physics] [--quick] [--verbose] [--trail=<id>]
 *   P  physics unit checks on synthetic ground (brakes, surfaces, rain, pump, pop, landings, crashes, the four bikes)
 *   T  the six trails: features exist and are carved, surfaces, bridge decks, checkpoints, gates, signposts
 *   R  the reference rider finishes every trail without crashing; medal times (data/medals.json) match the reference ride
 * Exit code 0 only when every check passes. (The zero-holes harness is harness.js; save / ghost: harness-save.js; audio: harness-audio.js.) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from './world-data.js';
import { buildPlayWorld, stateAt, bikeSpec } from './play-world.js';
import { createBikeState, stepBike, advanceBike } from './bike.js';
import { BIKES, BIKE_IDS, PLAY, SURFACES, BIKE } from './config.js';
import { rideTrail } from './bot.js';
import { createGround } from './decks.js';
import { featureOffset, KICKER, DROP, dropFallLength, lipFallLength } from './trail-features.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = ['physics', 'rides', 'trails'].filter(flag);
const want = (k) => only.length === 0 || only.includes(k);
const QUICK = flag('quick'), VERBOSE = flag('verbose');
const trailArg = (args.find((a) => a.startsWith('--trail=')) || '').slice(8);
const results = { pass: 0, fail: 0 };
const stats = {};
function check(name, ok, detail = '') {
  if (ok) { results.pass++; if (VERBOSE) console.log('  ok  ', name, detail); return; }
  results.fail++;
  console.log('  FAIL', name, detail);
}
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const DT = 1 / 120;

/* ---------------------------------------------------------------- P: physics on synthetic ground */
/** A hand-made ground: h(x, z) analytic, normals by central differences. */
function makeSurface(h) {
  return {
    height: h,
    normal(x, z, out) { const e = 0.5, dx = (h(x + e, z) - h(x - e, z)) / (2 * e), dz = (h(x, z + e) - h(x, z - e)) / (2 * e); const l = Math.hypot(dx, 1, dz); out.x = -dx / l; out.y = 1 / l; out.z = -dz / l; return out; },
  };
}
const groundOf = (kind) => () => ({ kind, ...SURFACES[kind] });
function ride(surface, kind, state, inputFn, seconds, env = {}) {
  let s = state;
  const dt = DT, n = Math.round(seconds / dt);
  const ga = typeof kind === 'function' ? kind : groundOf(kind);
  for (let i = 0; i < n; i++) s = stepBike(s, inputFn(s, i * dt), dt, surface, ga, env);
  return s;
}
const speedOf = (s) => Math.hypot(s.vx, s.vz);
const startAt = (surface, x = 0, z = 0, v = 0, heading = 0) => { const b = createBikeState(x, z, heading, surface); return Object.freeze({ ...b, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v }); };

function physicsChecks() {
  section('P physics on synthetic ground');
  const flat = makeSurface(() => 0);
  const env = (bike = 'trail', wet = 0) => ({ bike: BIKES[bike], wet });

  // pedalling
  let s = ride(flat, 'dirt', startAt(flat), () => ({ throttle: 1, brake: 0, steer: 0 }), 10, env());
  check(`pedalling on the flat reaches a sensible speed (${(speedOf(s) * 3.6).toFixed(1)} km/h after 10 s)`, speedOf(s) > 5.5 && speedOf(s) < 9.5);
  s = ride(flat, 'dirt', startAt(flat, 0, 0, 9), () => ({ throttle: 0, brake: 0, steer: 0 }), 20, env());
  check(`coasting on the flat loses speed slowly (${speedOf(s).toFixed(1)} m/s left of 9 after 20 s)`, speedOf(s) > 2.5 && speedOf(s) < 8.6);

  // brakes: stopping distance, front vs rear, blended
  const stop = (input, bike = 'trail', kind = 'dirt', wet = 0, v = 9, surf = flat) => {
    let q = startAt(surf, 0, 0, v), t = 0;
    while (speedOf(q) > 0.2 && t < 20) { q = stepBike(q, input, DT, surf, groundOf(kind), env(bike, wet)); t += DT; if (q.crashed) return { dist: Infinity, q, t, crashed: q.crashed }; }
    return { dist: q.odometer, q, t, crashed: '' };
  };
  const both = stop({ throttle: 0, brake: 1, steer: 0 });
  const front = stop({ throttle: 0, brakeF: 1, brakeR: 0, steer: 0 });
  const rear = stop({ throttle: 0, brakeF: 0, brakeR: 1, steer: 0 });
  check(`front brake stops shorter than the rear brake (${front.dist.toFixed(1)} m vs ${rear.dist.toFixed(1)} m)`, front.dist < rear.dist * 0.8);
  check(`the blended brake stops from 9 m/s in ${both.dist.toFixed(1)} m (4..10 m)`, both.dist > 4 && both.dist < 10);
  check('the rear brake alone skids at full lever (skid > 0)', rear.q.skid >= 0 && stepBike(startAt(flat, 0, 0, 9), { brakeR: 1 }, DT, flat, groundOf('dirt'), env()).skid > 0);
  const stopWet = stop({ throttle: 0, brake: 1, steer: 0 }, 'trail', 'rock', 1);
  const stopDry = stop({ throttle: 0, brake: 1, steer: 0 }, 'trail', 'rock', 0);
  check(`rain lengthens the stop on rock (${stopDry.dist.toFixed(1)} m dry, ${stopWet.dist.toFixed(1)} m wet)`, stopWet.dist > stopDry.dist * 1.1);
  const stopMud = stop({ throttle: 0, brake: 1, steer: 0 }, 'trail', 'mud');
  check(`mud stops longer than dirt and slows the bike on its own`, stopMud.dist > both.dist * 0.9 && ride(flat, 'mud', startAt(flat, 0, 0, 8), () => ({}), 5, env()).odometer < ride(flat, 'dirt', startAt(flat, 0, 0, 8), () => ({}), 5, env()).odometer * 0.85);

  // surfaces: grip ordering in the rain, rolling resistance ordering
  const roll = (kind, bike = 'trail') => ride(flat, kind, startAt(flat, 0, 0, 8), () => ({}), 6, env(bike)).odometer;
  check('rolling distance: road > dirt > leaves > grass > mud', roll('road') > roll('dirt') && roll('dirt') > roll('leaves') && roll('leaves') > roll('grass') && roll('grass') > roll('mud'), [roll('road'), roll('dirt'), roll('leaves'), roll('grass'), roll('mud')].map((v) => v.toFixed(1)).join(' > '));
  check('every surface has finite positive crr / grip', Object.values(SURFACES).every((m) => m.crr > 0 && m.grip > 0.3 && m.grip < 1.3 && m.wetLoss >= 0 && m.wetLoss < 0.6));

  // steering and lean: a turn at speed leans, never produces NaN, and stays inside the grip circle
  s = ride(flat, 'dirt', startAt(flat, 0, 0, 7), () => ({ throttle: 0.5, brake: 0, steer: 1 }), 3, env());
  check(`a hard right turn at 7 m/s: heading changes and the bike leans (lean ${s.lean.toFixed(2)} rad)`, Math.abs(s.heading) > 0.8 && s.lean > 0.15 && !s.crashed);
  s = ride(flat, 'dirt', startAt(flat, 0, 0, 13), () => ({ throttle: 0, brake: 0, steer: 1 }), 2, env());
  check('a full lock at 13 m/s does not flip the bike (no crash, slip < slide limit)', !s.crashed || s.crashed === 'slide');
  const slipOf = (input) => { let q = startAt(flat, 0, 0, 10); for (let i = 0; i < 90; i++) q = stepBike(q, input, DT, flat, groundOf('dirt'), env()); return Math.abs(-q.vx * Math.sin(q.heading) + q.vz * Math.cos(q.heading)); };
  const slipBrake = slipOf({ throttle: 0, brakeF: 1, brakeR: 0, steer: 1 }), slipCoast = slipOf({ throttle: 0, brake: 0, steer: 1 });
  check(`braking hard with the front brake in a corner washes the front wheel (drift ${slipBrake.toFixed(2)} vs ${slipCoast.toFixed(2)} m/s coasting)`, slipBrake > slipCoast);

  // endo: front brake only on a steep descent
  const steep = makeSurface((x) => -0.34 * x);
  const endo = ride(steep, 'dirt', startAt(steep, 0, 0, 8), () => ({ brakeF: 1, brakeR: 0 }), 2, env());
  check(`full front brake only on a 34 % descent goes over the bars (${endo.crashed || 'no crash'})`, endo.crashed === 'endo');
  const noEndo = ride(steep, 'dirt', startAt(steep, 0, 0, 8), () => ({ brake: 1 }), 3, env());
  check('the blended brake on the same descent is safe', !noEndo.crashed);
  const shielded = ride(steep, 'dirt', startAt(steep, 0, 0, 8), () => ({ brakeF: 1, brakeR: 0 }), 2, { ...env(), shield: 2 });
  check('right after a respawn (shield) nothing crashes', !shielded.crashed);

  // gravity along a slope: a 10 % descent accelerates
  const down10 = makeSurface((x) => -0.1 * x);
  s = ride(down10, 'dirt', startAt(down10, 0, 0, 2), () => ({ throttle: 0, brake: 0 }), 8, env());
  check(`a 10 % descent accelerates freewheeling (${(speedOf(s) * 3.6).toFixed(0)} km/h after 8 s)`, speedOf(s) > 6 && speedOf(s) < BIKE.maxSpeed);
  const up8 = makeSurface((x) => 0.08 * x);
  s = ride(up8, 'dirt', startAt(up8, 0, 0, 5), () => ({ throttle: 1, brake: 0 }), 10, env());
  check(`an 8 % climb is pedalable (${(speedOf(s) * 3.6).toFixed(1)} km/h)`, speedOf(s) > 2 && speedOf(s) < 7);

  // pump: rollers (h 0.4, period 7.5 m) ridden at 7 m/s: pumping beats not pumping
  const rollers = makeSurface((x) => (x > 5 && x < 5 + 8 * 7.5 ? 0.2 * (1 - Math.cos(2 * Math.PI * (x - 5) / 7.5)) : 0));
  const rollersRide = (pump, bike = 'trail') => {
    let q = startAt(rollers, 0, 0, 7);
    let maxV = 0;
    for (let i = 0; i < 13 * 120; i++) {
      const input = { throttle: 0, brake: 0, steer: 0, jump: pump && q.kappa < -0.01 && speedOf(q) > 3 };
      q = stepBike(q, input, DT, rollers, groundOf('dirt'), env(bike));
      if (q.x > 5 + 8 * 7.5 + 4) break;
    }
    return q;
  };
  const noPump = rollersRide(false), pumped = rollersRide(true);
  check(`pumping a roller section keeps more speed than not pumping (${speedOf(pumped).toFixed(2)} vs ${speedOf(noPump).toFixed(2)} m/s)`, speedOf(pumped) > speedOf(noPump) + 0.4, `crash ${pumped.crashed}`);
  check('pumping on rollers never launches the bike into the air for long', pumped.airTime < 0.5);
  const hardtailPump = speedOf(rollersRide(true, 'hardtail')) - speedOf(rollersRide(false, 'hardtail')), dhPump = speedOf(rollersRide(true, 'downhill')) - speedOf(rollersRide(false, 'downhill'));
  check(`the hardtail pumps better than the downhill bike (${hardtailPump.toFixed(2)} vs ${dhPump.toFixed(2)} m/s gained)`, hardtailPump > dhPump);

  // pop: hold, release on the flat -> airborne; a tap -> stays on the ground
  const popRide = (holdSeconds, bike = 'trail') => {
    let q = startAt(flat, 0, 0, 8);
    let maxY = 0, airborne = 0;
    for (let i = 0; i < 3 * 120; i++) {
      const t = i * DT;
      q = stepBike(q, { throttle: 0, brake: 0, steer: 0, jump: t < holdSeconds }, DT, flat, groundOf('dirt'), env(bike));
      maxY = Math.max(maxY, q.y); if (!q.grounded) airborne += DT;
    }
    return { maxY, airborne, q };
  };
  const tap = popRide(0.08), full = popRide(0.4), mid = popRide(0.18);
  check(`a tap does not pop (${tap.maxY.toFixed(2)} m), a full hold does (${full.maxY.toFixed(2)} m), in between is in between (${mid.maxY.toFixed(2)} m)`, tap.maxY < 0.03 && full.maxY > 0.3 && full.maxY < 1.2 && mid.maxY < full.maxY);
  check(`a full pop at 8 m/s stays in the air about ${full.airborne.toFixed(2)} s (0.3..0.9 s)`, full.airborne > 0.3 && full.airborne < 0.9);
  check('a clean pop lands without a crash', !full.q.crashed && full.q.landSeq === 1);

  // jump + landing: kicker-like step down, perfect / rough landings
  const lip = makeSurface((x) => (x < 20 ? 0 : -((x - 20) * 0.0)));
  const dropOf = (h) => makeSurface((x) => (x < 10 ? 0 : -h));
  const land = (h, bike = 'trail', v = 8) => ride(dropOf(h), 'dirt', startAt(dropOf(h), 0, 0, v), () => ({ throttle: 0, brake: 0 }), 3, env(bike));
  const d1 = land(0.6), d3 = land(3.2), d6 = land(8);
  check(`rolling off a 0.6 m drop is a good landing (impact ${d1.landImpact.toFixed(1)} m/s, no crash)`, d1.landSeq === 1 && !d1.crashed && d1.landQuality > 0.4);
  check(`a 3.2 m drop (impact ${d3.landImpact.toFixed(1)} m/s) is rough but fine on the trail bike`, d3.landSeq === 1 && d3.landImpact > 6.5 && !d3.crashed);
  check(`an 8 m fall (impact ${d6.landImpact.toFixed(1)} m/s) is a crash`, d6.crashed === 'landing');
  const hardtailDrop = land(3.2, 'hardtail'), dhDrop = land(3.2, 'downhill');
  check('the downhill bike takes the 3.2 m drop with more grace than the hardtail (quality, speed kept)', dhDrop.landQuality > hardtailDrop.landQuality && speedOf(dhDrop) >= speedOf(hardtailDrop) - 0.2);
  check('crash thresholds rise with the bike: hardtail < trail < enduro < downhill', BIKE_IDS.every((id, i) => i === 0 || BIKES[id].crashImpact > BIKES[BIKE_IDS[i - 1]].crashImpact));

  // crash: tumble + stop
  let tumble = d6;
  tumble = ride(dropOf(8), 'dirt', tumble, () => ({ throttle: 1 }), 2.5, env());
  check('after a crash the bike tumbles to a stop on the ground (speed < 0.5 m/s, no NaN)', tumble.crashed && speedOf(tumble) < 0.5 && Number.isFinite(tumble.x) && Number.isFinite(tumble.y));
  check(`respawn time ${PLAY.respawnTime} s is below 1.5 s`, PLAY.respawnTime < 1.5);

  // trunks: a gentle touch slides, a hard hit crashes
  const trunk = (v) => ride(flat, 'dirt', startAt(flat, 0, 0, v), () => ({ throttle: 0 }), 1.5, { ...env(), collide: (x, z, r) => (x + r > 5 ? { nx: -1, nz: 0, pen: x + r - 5 } : null) });
  const touch = trunk(3), hit = trunk(8);
  check(`bumping a trunk at 3 m/s only slows the bike; at 8 m/s it is a crash (${hit.crashed || 'none'})`, !touch.crashed && hit.crashed === 'hit');

  // the four bikes differ in the way they should
  const climb = (id) => speedOf(ride(up8, 'dirt', startAt(up8, 0, 0, 4), () => ({ throttle: 1 }), 12, env(id)));
  const coast = (id) => speedOf(ride(down10, 'dirt', startAt(down10, 0, 0, 5), () => ({}), 10, env(id)));
  check(`on a climb the hardtail is quickest, the downhill bike slowest (${BIKE_IDS.map((id) => climb(id).toFixed(2)).join(' / ')} m/s)`, climb('hardtail') > climb('trail') && climb('trail') > climb('enduro') && climb('enduro') > climb('downhill'));
  check('every bike spec is complete and plausible', BIKE_IDS.every((id) => { const b = BIKES[id]; return b.mass > 75 && b.mass < 100 && b.travel >= 0.1 && b.travel <= 0.22 && b.brakeF > b.brakeR && b.grip > 0.9 && b.grip < 1.2; }));
  const rough = (id) => ride(flat, 'roots', startAt(flat, 0, 0, 8), () => ({}), 4, env(id)).odometer;
  check(`over roots the downhill bike keeps more speed than the hardtail (${rough('downhill').toFixed(1)} m vs ${rough('hardtail').toFixed(1)} m rolled in 4 s)`, rough('downhill') > rough('hardtail') - 0.3);
  const turnGrip = (id) => { const q = ride(flat, 'dirt', startAt(flat, 0, 0, 9), () => ({ steer: 1 }), 1.5, env(id)); return q.slip; };
  check('slip stays finite for every bike in a hard turn', BIKE_IDS.every((id) => Number.isFinite(turnGrip(id))));

  // determinism and purity
  const a = ride(flat, 'dirt', startAt(flat), () => ({ throttle: 1, steer: 0.3 }), 2, env()), b = ride(flat, 'dirt', startAt(flat), () => ({ throttle: 1, steer: 0.3 }), 2, env());
  check('the physics is deterministic and never mutates its inputs', a.x === b.x && a.z === b.z && Object.isFrozen(a));
}

/* ---------------------------------------------------------------- T / R: the world, the trails, the reference rider */
const read = async (name) => new Uint8Array(fs.readFileSync(path.join(HERE, 'data', name)));

async function worldChecks() {
  section('T the trails (world build)');
  const data = await loadWorldData(read);
  const play = buildPlayWorld(data);
  const { surface, ground, groundAt, trails, decks, field } = play;
  console.log(`  world built in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${trails.length} trails, ${decks.length} bridge decks`);
  check('six trails, ids in the unlock order', trails.map((t) => t.id).join() === 'ernz-waldwee,hallerbach-flow,schiessentuempel,binzelt-rocks,waschbrunnen-black,maratoun', trails.map((t) => t.id).join());
  check('the four grades are all present', ['green', 'blue', 'red', 'black'].every((g) => trails.some((t) => t.grade === g)));
  const marathon = trails.find((t) => t.id === 'maratoun');
  check(`the Marathon is the long one (${Math.round(marathon.length)} m, > 9 km) on the official GPX`, marathon.length > 9000);
  for (const t of trails) {
    check(`${t.id}: length ${Math.round(t.length)} m, climb ${Math.round(t.climb)} m`, t.length > 1200 && Number.isFinite(t.length));
    check(`${t.id}: ${t.cps.length} checkpoints, strictly increasing along the trail`, t.cps.length >= 1 && t.cps.every((c, i) => i === 0 || c.s > t.cps[i - 1].s + 100) && t.cps.every((c) => c.s > 100 && c.s < t.length - 100));
    check(`${t.id}: start gate and finish arch sit on the trail`, t.gate.index < 30 && t.arch.index > t.count - 30);
    check(`${t.id}: signposts: start, finish, one per checkpoint`, t.posts.filter((p) => p.k === 'start').length === 1 && t.posts.filter((p) => p.k === 'finish').length === 1 && t.posts.filter((p) => p.k === 'cp').length === t.cps.length);
    const kinds = new Set(t.features.map((f) => f.k));
    const need = t.grade === 'green' ? ['roots'] : t.grade === 'black' ? ['drop', 'kicker'] : t.id === 'maratoun' ? ['kicker', 'drop', 'slab'] : ['roots'];
    check(`${t.id}: features ${[...kinds].join(',')}`, need.every((k) => kinds.has(k)) || t.features.length >= 4);
    if (t.grade === 'green') check(`${t.id}: a beginner trail has no drops and no kickers`, !kinds.has('drop') && !kinds.has('kicker'));
  }
  // surfaces really exist on the ground of each feature
  let surfaceMisses = 0, surfaceChecked = 0;
  for (const t of trails) for (const f of t.features) {
    const want = { slab: 'rock', roots: 'roots', mud: 'mud', leaves: 'leaves', boardwalk: 'wood' }[f.k];
    if (!want) continue;
    const mid = Math.round((f.i0 + f.i1) / 2);      // centre index inside the way
    const idx = Math.min(t.count - 1, Math.max(0, mid));
    const [x, z] = t.centre[idx];
    surfaceChecked++;
    if (groundAt(x, z).kind !== want) surfaceMisses++;
  }
  check(`feature surfaces are what the physics reads (${surfaceChecked} checked)`, surfaceMisses <= Math.ceil(surfaceChecked * 0.08), `${surfaceMisses} misses`);
  // bridge decks
  const deckProblems = [];
  for (const d of decks) {
    const gA = surface.height(d.x0, d.z0), gB = surface.height(d.x1, d.z1);
    if (Math.abs(d.topA - gA) > 0.35 || Math.abs(d.topB - gB) > 0.35) deckProblems.push(`deck ${d.id} ends are ${(d.topA - gA).toFixed(2)} / ${(d.topB - gB).toFixed(2)} m from the bank`);
    for (let k = 0; k <= 8; k++) { const t = k / 8; const gx = d.x0 + (d.x1 - d.x0) * t, gz = d.z0 + (d.z1 - d.z0) * t; if (surface.height(gx, gz) > d.topA + (d.topB - d.topA) * t + 0.02) deckProblems.push(`deck ${d.id} is below the ground at ${k}/8`); }
    if (!(d.len > 5 && d.len < 14)) deckProblems.push(`deck ${d.id} length ${d.len.toFixed(1)}`);
  }
  check(`${decks.length} bridge decks: ends meet the banks (< 0.35 m), never below the ground, 5..14 m long`, deckProblems.length === 0, deckProblems.slice(0, 3).join('; '));
  const g2 = createGround(surface, decks);
  if (decks.length) {
    const d = decks[0], mx = (d.x0 + d.x1) / 2, mz = (d.z0 + d.z1) / 2;
    g2.hint(d.topA + 0.5);
    const onTop = g2.height(mx, mz);
    g2.hint(surface.height(mx, mz) - 1);                 // a rider below the deck does not climb onto it
    const under = g2.height(mx, mz);
    check('a rider on a bridge rides on the deck; a rider below it stays below', onTop > under + 0.05, `${onTop.toFixed(2)} vs ${under.toFixed(2)}`);
  }
  // features are continuous in the bed (no wall): drop and kicker faces are gentler than 45 degrees
  let maxFace = 0;
  for (const f of [{ k: 'drop', len: 16, h: 1.54 }, { k: 'kicker', len: 28, h: 1.05, gap: 5.4 }, { k: 'roller', len: 40, n: 5, p: 7.5, h: 0.55 }, { k: 'roots', len: 24, h: 0.1 }, { k: 'slab', len: 40, h: 0.1 }]) {
    for (let u = 0; u < f.len; u += 0.05) maxFace = Math.max(maxFace, Math.abs(featureOffset(f, u + 0.05) - featureOffset(f, u)) / 0.05);
  }
  check(`the steepest feature face is ${(maxFace * 100).toFixed(0)} % (< 190 %: no walls)`, maxFace < 1.9);
  check('drop and kicker fall lengths grow with their height', dropFallLength(1.5) > dropFallLength(0.5) && lipFallLength(1.0) >= KICKER.lipFall && DROP.approach > 3);
  return play;
}

/** Medal times from the reference ride: gold a little faster than the reference rider, silver a little slower, bronze generous. */
export const MEDAL_FACTORS = Object.freeze({ gold: 0.95, silver: 1.12, bronze: 1.5 });
function medalTable(time, splits) {
  const r1 = (v) => Math.round(v * 10) / 10;
  return { ref: r1(time), gold: r1(time * MEDAL_FACTORS.gold), silver: r1(time * MEDAL_FACTORS.silver), bronze: r1(time * MEDAL_FACTORS.bronze), splits: splits.map(r1) };
}

function respawnFor(trail, ground) { return (s, planIndex) => stateAt(trail, Math.max(0, trail.nearest(s.x, s.z, 0) - 4), ground, 1); }

async function rideChecks(play) {
  section('R the reference rider on every trail');
  const { ground, groundAt, trails } = play;
  const out = {};
  for (const t of trails) {
    if (trailArg && t.id !== trailArg) continue;
    if (QUICK && t.id === 'maratoun') continue;
    const start = stateAt(t, 0, ground);
    const spec = BIKES.trail;
    const t1 = Date.now();
    const line = t.centre.slice(0, t.arch.index + 4);       // the finish line is the arch
    const cpIdx = t.cps.map((c) => Math.round(c.index * (0))) ;   // filled below (plan index differs from centre index)
    const planSpacing = 1.5;
    const checkpoints = t.cps.map((c) => Math.round(c.s / planSpacing));
    const res = rideTrail({
      line, grade: t.grade, start,
      step: (s, input, dt) => advanceBike(s, input, dt, ground, groundAt, { bike: spec, wet: 0, shield: s.shield, collide: null }),
      respawn: (s) => { const cps = t.cps.filter((c) => c.s < t.s[t.nearest(s.x, s.z)] - 20); return stateAt(t, cps.length ? cps[cps.length - 1].index : 0, ground, 1); },
      rescue: (s) => stateAt(t, t.nearest(s.x, s.z) + 4, ground, 2),
      ground: (x, z) => ground.height(x, z), dt: 1 / 60, maxTime: t.length / 2.5, checkpoints,
    });
    out[t.id] = res;
    const avg = t.length / res.time;
    console.log(`  ${t.id.padEnd(18)} ${res.finished ? 'finished' : 'DID NOT FINISH'} in ${res.time.toFixed(0)} s (avg ${(avg * 3.6).toFixed(1)} km/h, max ${(res.maxSpeed * 3.6).toFixed(0)}), crashes ${res.crashes}, rescues ${res.rescues}, air ${res.airTime.toFixed(1)} s, progress ${res.progress}/${res.length}  [${((Date.now() - t1) / 1000).toFixed(1)} s]`);
    check(`${t.id}: the reference rider finishes (${res.time.toFixed(0)} s)`, res.finished && res.nan === 0 && res.below === 0);
    check(`${t.id}: ... with at most 1 crash per 3 km (${res.crashes}) and 2 rescues (${res.rescues})`, res.crashes <= Math.ceil(t.length / 3000) && res.rescues <= 2);
    check(`${t.id}: average speed ${(avg * 3.6).toFixed(1)} km/h is sensible (8..38)`, avg * 3.6 > 8 && avg * 3.6 < 38);
    stats[`ride:${t.id}`] = { time: res.time, crashes: res.crashes, splits: res.splits };
  }
  return out;
}

if (want('physics')) physicsChecks();
if (want('trails') || want('rides')) {
  const play = await worldChecks();
  if (want('rides')) {
    const rides = await rideChecks(play);
    const stored = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'medals.json'), 'utf8'));
    if (flag('write-medals')) {
      const medals = {};
      for (const [id, r] of Object.entries(rides)) if (r.finished) medals[id] = medalTable(r.time, r.splits);
      fs.writeFileSync(path.join(HERE, 'data', 'medals.json'), JSON.stringify(medals));
      console.log('  wrote data/medals.json');
    } else if (!QUICK && !trailArg) {
      for (const [id, r] of Object.entries(rides)) {
        const m = stored[id];
        check(`${id}: stored medal times match the reference ride (${m ? m.ref : 'none'} s vs ${r.time.toFixed(1)} s, within 4 %)`, !!m && Math.abs(m.ref - r.time) < 0.04 * r.time);
        if (m) check(`${id}: gold < silver < bronze, all within 3 x the reference`, m.gold < m.silver && m.silver < m.bronze && m.bronze < 3 * m.ref && m.gold > 0.6 * m.ref);
      }
    }
  }
}
console.log(results.fail === 0 ? `\nPASS: ${results.pass} checks in ${((Date.now() - t0) / 1000).toFixed(1)} s` : `\nFAIL: ${results.fail} of ${results.pass + results.fail} checks failed`);
process.exit(results.fail === 0 ? 0 : 1);
