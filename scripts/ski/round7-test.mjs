#!/usr/bin/env node
/* Round 7 (A) checks without a browser (pure modules only), trimmed in the R8 integration to what R7-A owns:
 *   far        the far grid's height step (1 m, first play)
 *   braking    a full stop that holds on every piste colour, the hockey stop, a placed skier waits, scripted braking never hockeys
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
  ok(far.step === 1, `${rid}: far.bin height step ${far.step} m (round 7: 1 m)`);
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
console.log(`${checks - fails} / ${checks} checks green`);
process.exit(fails ? 1 : 0);
