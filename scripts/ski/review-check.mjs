/* Physics / input review after launch (22 Nov 2026): the two small fixes, checked in Node.   node scripts/ski/review-check.mjs
 *   air    steering held through a long plain air (no tricks) never ends in the "sideways" fall: the skis stop turning 1.15 rad off
 *          the flight line (the fall starts at 1.45 rad); a short steer still turns them; the flight line itself never changes
 *   touch  the steering pad: a 5 px rest zone, monotonic, full throw = full steer, symmetric, half throw 35-45 %
 * (The camera has its own check: camera-check.mjs; the numbers of the review: physics-probe.mjs, ride-probe.mjs.) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pb', 'ski');
const { createSkierState, stepSkier } = await import(path.join(root, 'skier.js'));
const { SKI } = await import(path.join(root, 'config.js'));
const { skiParams } = await import(path.join(root, 'modes', 'skis.js'));
const { touchSteer, TOUCH_DEADZONE } = await import(path.join(root, 'input.js'));

let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };
const world = { height: () => 0, normal: (x, z, o) => { o.x = 0; o.y = 1; o.z = 0; return o; }, snow: () => 1, hit: () => null, ski: skiParams('allmountain', true) };
/** A plain air of about `secs` s at v m/s over flat snow with the steering held; returns the state after the landing. */
function air(v, secs, steer, heading0 = 0) {
  const vy = 9.81 * secs / 2;
  let s = { ...createSkierState(0, 0, heading0, 0), hold: 0, grounded: false, y: 0.5, vx: v, vy, vz: 0, speed: v };
  let maxOff = 0, flew = 0, line = 0;
  for (let i = 0; i < 600 && !(s.grounded || s.crash > 0); i++) {
    s = stepSkier(s, { steer, tuck: 0, brake: 0, push: 0, jump: false }, world);
    if (!s.grounded) { flew += SKI.dt; maxOff = Math.max(maxOff, Math.abs(s.heading)); line = Math.max(line, Math.abs(s.z)); }
  }
  return { s, maxOff, flew, line };
}
console.log('air: steering held in a plain air');
for (const secs of [0.8, 1.6, 2.0]) for (const v of [12, 25]) {
  const r = air(v, secs, 1), l = air(v, secs, -1);
  check(r.s.crash === 0 && l.s.crash === 0 && r.maxOff <= 1.16 && l.maxOff <= 1.16, `${secs} s at ${(v * 3.6).toFixed(0)} km/h, full steer held: lands (${r.flew.toFixed(2)} s in the air, skis at most ${r.maxOff.toFixed(2)} rad off the flight line, the fall starts at 1.45)`);
  check(r.line < 1e-6, `... and the flight line stays straight (${r.line.toFixed(3)} m sideways)`);
}
const short = air(20, 0.6, 1);
check(short.maxOff > 0.5 && short.maxOff < 0.95, `a 0.6 s air still turns the skis for style (${short.maxOff.toFixed(2)} rad)`);
const none = air(20, 1.6, 0);
check(none.maxOff === 0 && none.s.crash === 0, 'no steering: the skis stay on the flight line');
const sw = air(20, 1.2, 0, 3.0);
check(sw.s.crash === 0, 'an air that starts nearly backwards (3.0 rad) is left alone: lands switch, no fall');

console.log('touch: the steering pad');
check(touchSteer(0) === 0 && touchSteer(TOUCH_DEADZONE) === 0 && touchSteer(-TOUCH_DEADZONE) === 0 && touchSteer(5 / 60) > 0, `rest zone: up to ${(TOUCH_DEADZONE * 60).toFixed(1)} px of the 60 px throw gives no steer, 5 px gives ${touchSteer(5 / 60).toFixed(3)}`);
check(touchSteer(1) === 1 && touchSteer(-1) === -1 && touchSteer(3) === 1, 'the full throw (and beyond) is full steer');
let mono = true, sym = true;
for (let i = 1; i <= 100; i++) { if (touchSteer(i / 100) < touchSteer((i - 1) / 100)) mono = false; if (touchSteer(-i / 100) !== -touchSteer(i / 100)) sym = false; }
check(mono && sym, 'monotonic and symmetric');
check(touchSteer(0.5) >= 0.35 && touchSteer(0.5) <= 0.45, `half the throw = ${(touchSteer(0.5) * 100).toFixed(0)} % steer (35-45: finer than linear, not sluggish)`);
check(touchSteer(0.1) < 0.02, `no jump at the edge of the rest zone (6 px = ${(touchSteer(0.1) * 100).toFixed(1)} %)`);
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
