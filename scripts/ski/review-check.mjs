/* Physics / input review after launch (22 Nov 2026): the two small fixes, checked in Node.   node scripts/ski/review-check.mjs
 *   air    steering held through a long plain air (no tricks) never ends in the "sideways" fall: the skis stop turning 1.15 rad off
 *          the flight line (the fall starts at 1.45 rad); a short steer still turns them; the flight line itself never changes
 *   crest  airs over a real break (not over a roller, not slow), soft normal landings, cliffs still crash, the piste magnet, air control
 *   carve  a clean 90 degree turn keeps >= 85-90 % of the speed, full steer does not out-turn the grip, braking distances as before
 *   snow   deep snow at 8 degrees 35-46 km/h tucked, steep deep snow unchanged
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
  let maxOff = 0, flew = 0, line = 0, speed = v;
  for (let i = 0; i < 600 && !(s.grounded || s.crash > 0); i++) {
    s = stepSkier(s, { steer, tuck: 0, brake: 0, push: 0, jump: false }, world);
    if (!s.grounded) { flew += SKI.dt; const travel = Math.atan2(s.vz, s.vx); maxOff = Math.max(maxOff, Math.abs(Math.atan2(Math.sin(s.heading - travel), Math.cos(s.heading - travel)))); line = Math.abs(travel); speed = Math.hypot(s.vx, s.vz); }
  }
  return { s, maxOff, flew, line, speed };
}
console.log('air: steering held in a plain air');
for (const secs of [0.8, 1.6, 2.0]) for (const v of [12, 25]) {
  const r = air(v, secs, 1), l = air(v, secs, -1);
  check(r.s.crash === 0 && l.s.crash === 0 && r.maxOff <= 1.16 && l.maxOff <= 1.16, `${secs} s at ${(v * 3.6).toFixed(0)} km/h, full steer held: lands (${r.flew.toFixed(2)} s in the air, skis at most ${r.maxOff.toFixed(2)} rad off the flight line, the fall starts at 1.45)`);
  check(Math.abs(r.line - SKI.airSteer * r.flew) < 0.05 && Math.abs(l.line - r.line) < 1e-6, `... and the flight line bends ${r.line.toFixed(2)} rad (air control ${SKI.airSteer} rad/s x ${r.flew.toFixed(2)} s, the same to both sides)`);
}
const short = air(20, 0.6, 1);
check(short.maxOff > 0.5 && short.maxOff < 0.95, `a 0.6 s air still turns the skis for style (${short.maxOff.toFixed(2)} rad off the flight line)`);
const none = air(20, 1.6, 0);
check(none.maxOff === 0 && none.line === 0 && none.s.crash === 0, 'no steering: the skis and the flight line stay straight');
const sw = air(20, 1.2, 0, 3.0);
check(sw.s.crash === 0, 'an air that starts nearly backwards (3.0 rad) is left alone: lands switch, no fall');


// ---- round 2 (Ian: yes to all three recommendations): crest airs + air control + piste magnet, cheaper clean carving, deep snow ----
const DEG = Math.PI / 180;
const ski = skiParams('allmountain', true);
const I = (o) => ({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false, ...o });
const go = (w, s0, input, secs, each) => { let s = s0; for (let i = 0; i < Math.round(secs / SKI.dt); i++) { s = stepSkier(s, typeof input === 'function' ? input(s, i * SKI.dt) : input, w); if (each && each(s, (i + 1) * SKI.dt) === false) break; } return s; };
const moving = (v, o = {}) => ({ ...createSkierState(0, 0, 0, 0), hold: 0, vx: v, vz: 0, speed: v, ...o });
const plane = (theta, snow = 1) => { const t = Math.tan(theta * DEG), c = Math.cos(theta * DEG), sn = Math.sin(theta * DEG); return { height: (x) => -x * t, normal: (x, z, o) => { o.x = sn; o.y = c; o.z = 0; return o; }, snow: typeof snow === 'function' ? snow : () => snow, hit: () => null, ski }; };
/** A slope of a degrees that breaks into b degrees at x = 40 (normals over 2.5 m like the physics lattice). */
const crest = (a, b, snow = () => 1) => { const t1 = Math.tan(a * DEG), t2 = Math.tan(b * DEG), h = (x) => (x < 40 ? -x * t1 : -40 * t1 - (x - 40) * t2); return { height: h, normal: (x, z, o) => { const e = 1.25, g = (h(x + e) - h(x - e)) / (2 * e), l = Math.hypot(g, 1); o.x = -g / l; o.y = 1 / l; o.z = 0; return o; }, snow, hit: () => null, ski }; };
function overCrest(w, v, input = I({ tuck: 1 })) {
  let air = 0, longest = 0, crash = false, off = 0, last = null;
  last = go(w, { ...moving(v), x: 20, y: w.height(20) }, input, 7, (q) => { if (!q.grounded) air += SKI.dt; else { longest = Math.max(longest, air); air = 0; } if (q.grounded && q.snow < 0.5) off += SKI.dt; if (q.crash > 0) { crash = true; return false; } return true; });
  return { longest, crash, off, z: last.z };
}
console.log('crest airs');
const fast = overCrest(crest(12, 30), 25), mid = overCrest(crest(12, 30), 12), slow = overCrest(crest(12, 30), 5), roller = overCrest(crest(12, 16), 25);
check(fast.longest > 0.6 && fast.longest < 1.6 && !fast.crash, `a 12 -> 30 degree break at 90 km/h: ${fast.longest.toFixed(2)} s in the air (0.6-1.6), lands`);
check(mid.longest > 0.25 && !mid.crash, `... at 43 km/h: ${mid.longest.toFixed(2)} s (> 0.25)`);
check(slow.longest < 0.05, `... at 18 km/h he stays on the snow (${slow.longest.toFixed(2)} s)`);
check(roller.longest < 0.05, `a gentle roller (12 -> 16 degrees) at 90 km/h keeps him on the snow (${roller.longest.toFixed(2)} s)`);
const flatLanding = (() => { const t1 = Math.tan(28 * DEG), h = (x) => (x < 40 ? -x * t1 * 0 : x < 60 ? -(x - 40) * t1 : -20 * t1); const w = { height: h, normal: (x, z, o) => { const e = 1.25, g = (h(x + e) - h(x - e)) / (2 * e), l = Math.hypot(g, 1); o.x = -g / l; o.y = 1 / l; o.z = 0; return o; }, snow: () => 1, hit: () => null, ski }; return overCrest(w, 24); })();
check(flatLanding.longest > 0.6 && !flatLanding.crash, `a flat -> 28 degree drop onto a flat run-out at 86 km/h: ${flatLanding.longest.toFixed(2)} s, a normal landing, no fall`);
const cliff = air(5, 3.4, 0);
check(cliff.s.crash > 0, 'a fall of more than softAir s onto the flat is still a crash (cliffs)');
// the piste magnet: a 30 m wide piste along +x that bends away (to +z) right after the crest; flying straight on ends in deep snow
const bend = (x, z) => { const mid2 = x < 45 ? 0 : (x - 45) * 0.55; return Math.abs(z - mid2) < 15 ? 1 : 0; };
const drift = overCrest(crest(12, 30, bend), 27, I({ tuck: 1 }));
const SKI0 = { ...ski, airMagnet: 0, airSteer: 0 };
const noHelp = (() => { const w = { ...crest(12, 30, bend), ski: SKI0 }; return overCrest(w, 27, I({ tuck: 1 })); })();
check(drift.z > noHelp.z + 2, `the piste magnet bends a flight that would end beside the piste: ${drift.z.toFixed(1)} m towards the piste after the bend (without it ${noHelp.z.toFixed(1)} m)`);
const steerAir = air(20, 1.2, 1);
check(Math.abs(steerAir.line - SKI.airSteer * steerAir.flew) < 0.05 && Math.abs(steerAir.speed - air(20, 1.2, 0).speed) < 0.05, `air control: full steer bends the flight line ${steerAir.line.toFixed(2)} rad in ${steerAir.flew.toFixed(2)} s and costs no speed (${steerAir.speed.toFixed(1)} m/s, as without steering)`);

console.log('carving');
function turn(v0, steer) {
  const w = plane(0.01); let t90 = null, v90 = 0, slip = 0;
  go(w, moving(v0), I({ steer }), 30, (q, t) => { slip = Math.max(slip, q.slip); if (Math.abs(Math.atan2(q.vz, q.vx)) >= Math.PI / 2) { t90 = t; v90 = q.speed; return false; } return true; });
  return { keeps: v90 / go(w, moving(v0), I({}), t90).speed, slip: Math.asin(Math.min(1, slip)) / DEG };
}
for (const v0 of [15, 20, 25]) {
  const half = turn(v0, 0.5), full = turn(v0, 1);
  check(half.keeps >= 0.9 && full.keeps >= 0.85 && full.keeps <= 0.99, `${(v0 * 3.6).toFixed(0)} km/h: a clean 90 degree turn keeps ${(half.keeps * 100).toFixed(0)} % (half steer, >= 90), ${(full.keeps * 100).toFixed(0)} % at full steer (85-99) of a straight line's speed; peak slip ${full.slip.toFixed(0)} degrees (no growing skid)`);
  check(full.slip < 12, `... full steer no longer out-turns the grip (peak slip ${full.slip.toFixed(1)} < 12 degrees; it was ~21)`);
}
const stopDist = (hard, v0) => { const w = plane(12); const s = go(w, moving(v0), I({ brake: 1, hard }), 40, (q) => q.speed > 0.05); return Math.hypot(s.x, s.z); };
const plough = stopDist(false, 25), hockey = stopDist(true, 25);
check(plough > 52 && plough < 60 && hockey > 29 && hockey < 35, `skids still scrub: from 90 km/h on 12 degrees the plough stops in ${plough.toFixed(0)} m (56 before), the hockey stop in ${hockey.toFixed(0)} m (32 before)`);

console.log('deep snow');
const term = (th, tuck) => go(plane(th, 0), moving(1), I({ tuck }), 90).speed * 3.6;
check(term(8, 1) >= 35 && term(8, 1) <= 46 && term(8, 0) >= 30, `8 degrees of deep snow: ${term(8, 1).toFixed(0)} km/h tucked (35-46), ${term(8, 0).toFixed(0)} upright (it was 19 / 18 before the acceleration assist)`);
check(Math.abs(term(25, 1) - 56) < 3 && Math.abs(term(35, 1) - 68) < 3, `steep deep snow unchanged: 25 degrees ${term(25, 1).toFixed(0)} km/h (56), 35 degrees ${term(35, 1).toFixed(0)} (68) tucked`);

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
