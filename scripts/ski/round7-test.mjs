#!/usr/bin/env node
/* Round 7 (A) checks without a browser (pure modules only), trimmed in the R8 integration to what R7-A owns:
 *   far        the far grid's height step (1 m, first play)
 *   braking    a full stop that holds on every piste colour, the hockey stop, a placed skier waits, scripted braking never hockeys
 *   jump       (launch fix) a tap of the jump key: <= 150 ms crouch, then >= 0.6 m off the flat (standing too), >= 0.45 m on slopes
 * The spawn / exit / tunnel / avalanche / name-tag / free-plan parts moved with their owners: lifts, exits and tunnels =
 * round7b-test.mjs (R7-B), first-lift spawn + avalanches = R7-C's round7c-check.mjs, tags + online free ride = R7-D.
 *   node scripts/ski/round7-test.mjs [resort ...]      exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid } = await imp('codec.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { SKI } = await imp('config.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${text}`); } };
const resorts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json')));

for (const rid of resorts) {
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(root, 'data', rid, 'far.bin'))));
  ok(far.step === 0.25, `${rid}: far.bin height step ${far.step} m (R8: 0.25 m: 1 m striped the far lighting)`);
}
// ---- braking (A): a full stop that holds, the hockey stop, a placed skier waits
{
  const slopeWorld = (deg, snow = 1) => { const t = Math.tan(deg * Math.PI / 180), ny = 1 / Math.hypot(1, t), nx = t * ny; return { height: (x) => -t * x, normal: (x, z, o) => { o.x = nx; o.y = ny; o.z = 0; return o; }, snow: () => snow, hit: () => null }; };
  const run = (w, s, input, secs) => { for (let i = 0; i < secs / SKI.dt; i++) s = stepSkier(s, input, w); return s; };
  const go = { steer: 0, tuck: 1, brake: 0, push: 1, jump: false };
  for (const [deg, label] of [[8, 'green'], [14, 'blue'], [22, 'red'], [30, 'black']]) {
    const w = slopeWorld(deg);
    let st = run(w, createSkierState(0, 0, 0, 0), go, 4);
    const v0 = st.speed * 3.6;
    for (const hard of [false, true]) {
      let s2 = st, tStop = null;
      for (let i = 0; i < 10 / SKI.dt; i++) { s2 = stepSkier(s2, { steer: 0, tuck: 0, brake: 1, push: 0, jump: false, hard }, w); if (tStop === null && s2.speed === 0) tStop = i * SKI.dt; }
      ok(tStop !== null && tStop < 6, `brake ${hard ? 'hockey' : 'plough'} on a ${deg} deg ${label} slope from ${v0.toFixed(0)} km/h: 0.0 km/h after ${tStop === null ? 'never' : tStop.toFixed(1) + ' s'}`);
      const held = run(w, s2, { steer: 0, tuck: 0, brake: 0, push: 0, jump: false }, 5);
      ok(held.speed === 0 && Math.hypot(held.x - s2.x, held.z - s2.z) < 0.01, `${label}: stays at 0 for 5 s after letting go of the brake`);
      if (hard) ok(Math.abs(Math.abs(Math.sin(s2.heading)) - 1) < 0.35 || deg < 10, `${label}: the hockey stop turned the skis across the slope`);
    }
  }
  // R8 (early QA: the hockey stop was a wall): from 33 km/h on a blue slope it takes 1.2 - 1.9 s
  {
    const w14 = slopeWorld(14);
    let s3 = createSkierState(0, 0, 0, 0);
    for (let i = 0; i < 20 / SKI.dt && s3.speed < 9.2; i++) s3 = stepSkier(s3, go, w14);
    let t = 0;
    for (; t < 8 && s3.speed > 0.01; t += SKI.dt) s3 = stepSkier(s3, { steer: 0.2, tuck: 0, brake: 1, push: 0, jump: false, hard: true }, w14);
    ok(t >= 1.2 && t <= 1.9, `hockey stop from 33 km/h on 14 deg: ${t.toFixed(2)} s (1.2 - 1.9)`);
  }
  const w = slopeWorld(20);
  const placed = run(w, createSkierState(0, 0, 0, 0), { steer: 0, tuck: 0, brake: 0, push: 0, jump: false }, 5);
  ok(placed.speed === 0 && placed.x === 0, 'a placed skier stays put without input');
  const started = run(w, placed, { steer: 0, tuck: 1, brake: 0, push: 0, jump: false }, 2);
  ok(started.speed > 3, `a tuck starts him again (${(started.speed * 3.6).toFixed(0)} km/h)`);
  const bot = run(w, createSkierState(0, 0, 0, 0), { steer: 0, tuck: 1, brake: 0, push: 1, jump: false }, 3);
  const botBrake = run(w, bot, { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, 0.5);
  ok(Math.abs(botBrake.heading) < 0.05, 'scripted braking never makes a hockey stop (bots, flows)');
  const steep = run(slopeWorld(45, 0), { ...createSkierState(0, 0, 0, 0), hold: 0 }, { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, 6);
  ok(steep.speed > 0, `45 deg off piste: too steep to hold, he side-slips (${(steep.speed * 3.6).toFixed(1)} km/h)`);
}
// ---- launch fix (Ian, iPad: "the jump is like a crouch"): the jump key = a short crouch, then a clear pop off the snow
{
  const slopeWorld = (deg) => { const t = Math.tan(deg * Math.PI / 180), ny = 1 / Math.hypot(1, t), nx = t * ny; return { height: (x) => -t * x, normal: (x, z, o) => { o.x = nx; o.y = ny; o.z = 0; return o; }, snow: () => 1, hit: () => null }; };
  const none = { steer: 0, tuck: 0, brake: 0, push: 0, jump: false };
  for (const [deg, v0, label] of [[0, 0, 'standing on the flat'], [0, 8, 'the flat at 29 km/h'], [14, 12, 'a blue slope at 43 km/h'], [25, 15, 'a red slope at 54 km/h']]) {
    const w = slopeWorld(deg);
    let s = { ...createSkierState(0, 0, 0, 0), vx: v0, vy: -Math.tan(deg * Math.PI / 180) * v0, hold: 0 };
    let tOff = null, maxUp = 0, crouchT = 0, steps = 0;
    for (let i = 0; i < 2 / SKI.dt; i++) {
      s = stepSkier(s, i < 0.05 / SKI.dt ? { ...none, jump: true } : none, w);          // a 50 ms tap
      steps++;
      if (s.grounded && s.jumpWind > 0) crouchT += SKI.dt;
      if (!s.grounded && tOff === null) tOff = i * SKI.dt;
      maxUp = Math.max(maxUp, s.y - w.height(s.x, s.z));
      if (tOff !== null && s.grounded) break;
    }
    ok(tOff !== null && tOff <= 0.15 + 1e-6, `jump, ${label}: off the snow after ${tOff === null ? 'never' : (tOff * 1000).toFixed(0) + ' ms'} (crouch ${(crouchT * 1000).toFixed(0)} ms, <= 150)`);
    ok(maxUp >= (deg ? 0.45 : 0.6) && s.crash === 0, `jump, ${label}: ${maxUp.toFixed(2)} m over the snow, ${s.crash ? 'CRASH' : 'landed'}`);
  }
}
console.log(`${checks - fails} / ${checks} checks green`);
process.exit(fails ? 1 : 0);
