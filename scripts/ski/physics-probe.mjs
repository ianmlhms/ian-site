/* The skier physics (pb/ski/skier.js) measured on ideal planes (no terrain noise): the numbers behind the physics review after launch
 * (22 Nov 2026). No pass / fail, a table to read:  node scripts/ski/physics-probe.mjs
 *   1 terminal speed and the time to get there by slope (upright / tuck)      2 full-steer turns: radius, speed lost, slip
 *   3 the steering's step response        4 S turns against a straight line   5 braking distances (plough / hockey stop)
 *   6 deep snow and skating               7 a trunk: crash or slide           8 a crest: air time */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pb', 'ski');
const { createSkierState, stepSkier } = await import(path.join(root, 'skier.js'));
const { SKI } = await import(path.join(root, 'config.js'));
const { skiParams } = await import(path.join(root, 'modes', 'skis.js'));
const DEG = Math.PI / 180;
const ski = skiParams('allmountain', true);
/** A plane falling towards +x at theta degrees. */
const plane = (theta, snow = 1, hit = () => null) => {
  const t = Math.tan(theta * DEG), c = Math.cos(theta * DEG), s = Math.sin(theta * DEG);
  return { height: (x) => -x * t, normal: (x, z, o) => { o.x = s; o.y = c; o.z = 0; return o; }, snow: () => snow, hit, ski };
};
const start = (w, v = 0, heading = 0) => ({ ...createSkierState(0, 0, heading, 0), hold: 0, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v, speed: v });
const run = (w, s0, input, secs, each) => {
  let s = s0;
  const n = Math.round(secs / SKI.dt);
  for (let i = 0; i < n; i++) { s = stepSkier(s, typeof input === 'function' ? input(s, i * SKI.dt) : input, w); if (each && each(s, (i + 1) * SKI.dt) === false) break; }
  return s;
};
const I = (o) => ({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false, ...o });
const kmh = (v) => (v * 3.6).toFixed(0);

console.log('1 terminal speed and the seconds to 30 km/h / 50 % / 90 % of it from a standstill, groomed');
for (const th of [3, 5, 8, 10, 15, 20, 25, 30]) for (const tuck of [0, 1]) {
  const w = plane(th), tr = [];
  const s = run(w, start(w, 0.1), I({ tuck }), 120, (q, t) => { if (Math.round(t / SKI.dt) % 12 === 0) tr.push([t, q.speed]); });
  const at = (v) => (tr.find((o) => o[1] >= v) || [NaN])[0].toFixed(1).padStart(5);
  console.log(`  ${String(th).padStart(2)} deg ${tuck ? 'tuck   ' : 'upright'} ${kmh(s.speed).padStart(4)} km/h   30 km/h after ${at(30 / 3.6)} s   50 % ${at(s.speed * 0.5)} s   90 % ${at(s.speed * 0.9)} s`);
}
console.log('\n2 a full-steer turn on the flat, groomed: the time for 90 degrees of travel direction, radius, speed after 90 / 180 degrees, peak slip');
for (const v0 of [5, 10, 15, 20, 25, 30]) for (const [lab, inp] of [['upright', I({ steer: 1 })], ['tuck', I({ steer: 1, tuck: 1 })], ['half', I({ steer: 0.5 })]]) {
  const w = plane(0.01);
  let t90 = null, t180 = null, v90 = 0, v180 = 0, slip = 0;
  run(w, start(w, v0), inp, 40, (q, t) => {
    const d = Math.atan2(q.vz, q.vx); slip = Math.max(slip, q.slip);
    if (t90 === null && Math.abs(d) >= Math.PI / 2) { t90 = t; v90 = q.speed; }
    if (t90 !== null && (Math.abs(d) >= Math.PI - 0.02 || d < 0)) { t180 = t; v180 = q.speed; return false; }
    return true;
  });
  const radius = t90 ? (v0 + v90) / 2 * t90 / (Math.PI / 2) : NaN;
  console.log(`  ${kmh(v0).padStart(3)} km/h ${lab.padEnd(7)} 90 deg in ${(t90 || NaN).toFixed(2).padStart(5)} s  radius ~${radius.toFixed(0).padStart(3)} m  ${kmh(v90).padStart(3)} km/h after 90, ${kmh(v180).padStart(3)} after 180 (${t180 ? t180.toFixed(1) : '-'} s)  peak slip ${(Math.asin(Math.min(1, slip)) / DEG).toFixed(0)} deg`);
}
console.log('\n3 steering response: the heading rate (deg/s) 0.1 / 0.2 / 0.4 / 0.8 s after a step to full steer');
for (const v0 of [3, 8, 15, 25]) {
  const w = plane(0.01), r = [];
  let prev = 0;
  run(w, start(w, v0), I({ steer: 1 }), 0.81, (q, t) => { const k = Math.round(t / SKI.dt); if ([12, 24, 48, 96].includes(k)) r.push(((q.heading - prev) / SKI.dt / DEG).toFixed(0)); prev = q.heading; });
  console.log(`  ${kmh(v0).padStart(3)} km/h: ${r.join(' / ')} deg/s`);
}
console.log('\n4 S turns (steer +-amp, 3 s period) down a 12 degree blue for 30 s against a straight line');
for (const [lab, amp, tuck] of [['straight', 0, 0], ['gentle 0.4', 0.4, 0], ['full 1.0', 1, 0], ['full tucked', 1, 1]]) {
  const w = plane(12);
  let zmin = 0, zmax = 0, sum = 0, n = 0;
  const s = run(w, start(w, 5), (q, t) => I({ steer: amp * (Math.sin(t * 2 * Math.PI / 3) > 0 ? 1 : -1), tuck }), 30, (q, t) => { if (t > 12) { zmin = Math.min(zmin, q.z); zmax = Math.max(zmax, q.z); sum += q.speed; n++; } });
  console.log(`  ${lab.padEnd(11)} mean ${kmh(sum / n)} km/h   corridor ${(zmax - zmin).toFixed(0)} m wide   ${s.x.toFixed(0)} m down the slope`);
}
console.log('\n5 braking to a stop: distance and time (plough = scripted input, hockey stop = a player)');
for (const th of [0.01, 12, 22, 30]) for (const v0 of [8, 15, 25, 33]) {
  const o = [];
  for (const hard of [false, true]) {
    const w = plane(th);
    let T = NaN;
    const s = run(w, start(w, v0), I({ brake: 1, hard }), 60, (q, t) => { if (q.speed < 0.05) { T = t; return false; } return true; });
    o.push(`${hard ? 'hockey' : 'plough'} ${Math.hypot(s.x, s.z).toFixed(0).padStart(3)} m ${T.toFixed(1).padStart(4)} s`);
  }
  console.log(`  ${th.toFixed(0).padStart(2)} deg from ${kmh(v0).padStart(3)} km/h: ${o.join('   ')}`);
}
console.log('\n6 deep snow (snow 0): terminal speed upright / tucked; skating on the flat; pushing uphill');
for (const th of [8, 15, 25, 35]) { const w = plane(th, 0); console.log(`  ${th} deg deep snow: ${kmh(run(w, start(w, 1), I({}), 90).speed)} / ${kmh(run(w, start(w, 1), I({ tuck: 1 }), 90).speed)} km/h`); }
for (const sn of [1, 0.5, 0]) { const w = plane(0.01, sn); console.log(`  flat, groomed share ${sn}: skating tops out at ${(run(w, start(w, 0), I({ push: 1 }), 30).speed * 3.6).toFixed(1)} km/h`); }
for (const th of [2, 5, 10, 15, 20]) { const w = plane(-th); const a = run(w, start(w, 0), I({ push: 1 }), 30); console.log(`  ${th} deg uphill, groomed, pushing: ${(a.speed * 3.6).toFixed(1)} km/h, ${a.x.toFixed(0)} m in 30 s`); }
console.log('\n7 a trunk (0.4 m) straight ahead / off the line by 0.3 and 0.6 m: crash, stop or slide past');
for (const v0 of [3, 6, 12, 25]) for (const off of [0, 0.3, 0.6]) {
  const tree = (x, z, r) => { const dx = x - 30, dz = z - off, d = Math.hypot(dx, dz); return d < 0.4 + r ? { nx: dx / d, nz: dz / d, pen: 0.4 + r - d, kind: 'tree' } : null; };
  const w = plane(0.01, 1, tree);
  let crashed = false, vAfter = null;
  const s = run(w, start(w, v0), I({}), 90 / v0, (q) => { if (q.crash > 0) { crashed = true; return false; } if (q.x > 31.5) { vAfter = q.speed; return false; } return true; });
  console.log(`  ${kmh(v0).padStart(3)} km/h, ${off} m off: ${crashed ? 'CRASH' : vAfter === null ? `stopped at the trunk (x ${s.x.toFixed(1)}, ${(s.speed * 3.6).toFixed(1)} km/h)` : `slides past at ${kmh(vAfter)} km/h`}`);
}
console.log('\n8 a crest (12 degrees breaking into 30): air time, height over the snow, landing');
for (const v0 of [8, 12, 18, 25, 32]) {
  const t1 = Math.tan(12 * DEG), t2 = Math.tan(30 * DEG);
  const h = (x) => (x < 40 ? -x * t1 : -40 * t1 - (x - 40) * t2);
  const w = { height: h, normal: (x, z, o) => { const e = 1.25, g = (h(x + e) - h(x - e)) / (2 * e), l = Math.hypot(g, 1); o.x = -g / l; o.y = 1 / l; o.z = 0; return o; }, snow: () => 1, hit: () => null, ski };
  let air = 0, maxAir = 0, crash = false, maxH = 0;
  run(w, { ...start(w, v0), x: 20, y: h(20) }, I({ tuck: 1 }), 6, (q) => {
    if (!q.grounded) { air += SKI.dt; maxH = Math.max(maxH, q.y - h(q.x)); } else { maxAir = Math.max(maxAir, air); air = 0; }
    if (q.crash > 0) { crash = true; return false; }
    return true;
  });
  console.log(`  ${kmh(v0).padStart(3)} km/h: ${maxAir.toFixed(2)} s in the air, ${maxH.toFixed(1)} m over the snow${crash ? ', CRASH' : ''}`);
}
