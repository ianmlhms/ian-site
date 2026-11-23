/* The chase camera (pb/ski/camera.js) over scripted rides in Node: "from above and behind" (Ian, 22 Nov 2026: "the camera should be
 * more from above and less straight from behind"). Rides: a blue upright, a weaving blue and red, a steep black tucked (60 and 15 fps),
 * a hockey stop. Per frame: the pitch (degrees the view axis points below the horizontal), the camera's height over the skier and over
 * its own snow, the boom length, the angle at which the view axis meets the snow at the skier (how much "from above"), where the skier
 * and the horizon sit in the picture, the view's turn rate, the clearance of the camera and of the line skier -> camera over the snow.
 *   node scripts/ski/camera-check.mjs            pass / fail bands
 *   node scripts/ski/camera-check.mjs --table    + the table by speed (the before / after numbers of the hand-off) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { unpackResort } = await imp('linepack.js');
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createPisteSet } = await imp('pistes.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { CAMERA } = await imp('config.js');
const { createParkLayout } = await imp('modes/park.js');
const { skiParams } = await imp('modes/skis.js');
const { planSteps, frameSeconds } = await imp('clock.js');
const { createChaseCamera } = await imp('camera.js');

const TABLE = process.argv.includes('--table');
const DEG = 180 / Math.PI;
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function loadResort(rid) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`))), 0, true));
  const surface = createSurface(field);
  const world = { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: () => null, ski: skiParams('allmountain', true) };
  return { resort, surface, world, pistes: createPisteSet(resort) };
}

/** One ride down a piste: down the line, or S turns +-weave m round it; stopAt = the share of the piste where he brakes to a stop. */
function ride({ world, surface }, piste, { fps = 60, tuck = false, weave = 0, stopAt = 0, maxS = 240, hard = false }) {
  const a = piste.at(2, {});
  let s = { ...createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z)), hold: 0, vx: a.dx * 4.8, vz: a.dz * 4.8, speed: 4.8 };
  const cam = createChaseCamera(surface);
  cam.snap(s);
  const proj = {}, q = {}, n = {}, frames = [];
  let acc = 0, real = 0, best = 0, time = 0, prevYaw = null, prevRate = 0, braking = false, stopped = 0;
  const frameDt = frameSeconds(1 / fps);
  while (real < maxS && best < piste.length - 15 && stopped < 2) {
    real += 1 / fps;
    const plan = planSteps(acc, frameDt);
    acc = plan.acc;
    for (let i = 0; i < plan.steps; i++) {
      piste.project(s.x, s.z, best, 150, proj);
      best = Math.max(best, proj.s);
      piste.at(proj.s + 12 + s.speed * 0.9, q);
      const side = weave ? Math.sin(best / 38) * weave : 0;
      const err = wrap(Math.atan2(q.z - q.dx * side - s.z, q.x + q.dz * side - s.x) - s.heading);
      if (stopAt && best > piste.length * stopAt) braking = true;
      const input = { steer: braking ? 0 : Math.max(-1, Math.min(1, err * 2.4)), tuck: tuck && !braking ? 1 : 0, brake: braking ? 1 : 0, push: !braking && s.speed < 3 ? 1 : 0, jump: false, hard: hard && braking };
      s = stepSkier(s, input, world);
      if (s.crash > 0) s = { ...s, crash: 0 };
    }
    if (braking && s.speed < 0.2) stopped += 1 / fps;
    time += frameDt;
    const c = cam.update(s, frameDt, time);
    world.normal(s.x, s.z, n);
    const dx = c.tx - c.x, dy = c.ty - c.y, dz = c.tz - c.z, h = Math.hypot(dx, dz), l = Math.hypot(h, dy);
    const pitch = Math.atan2(-dy, h) * DEG;
    const yaw = Math.atan2(dz, dx);
    const rate = prevYaw === null ? 0 : wrap(yaw - prevYaw) / frameDt;
    // the angle at which the view axis meets the snow at the skier: 0 = along the snow, 90 = straight down on it
    const above = Math.asin(Math.max(-1, Math.min(1, -(dx * n.x + dy * n.y + dz * n.z) / l))) * DEG;
    // the skier (hips, 1 m) in the picture: the angle below the view axis as a share of the half field of view (-1 top .. 1 bottom)
    const sx = s.x - c.x, sy = s.y + 1 - c.y, sz = s.z - c.z;
    const fwd = (sx * dx + sy * dy + sz * dz) / l;
    const upx = -dx * dy / (h * l), upy = h / l, upz = -dz * dy / (h * l);
    const below = -Math.atan2(sx * upx + sy * upy + sz * upz, fwd) * DEG;
    const rgt = (sx * -dz + sz * dx) / h;
    const half = c.fov / 2;
    let line = Infinity;
    for (let k = 1; k <= 12; k++) { const u = k / 12; line = Math.min(line, s.y + 1.2 + (c.y - s.y - 1.2) * u - surface.height(s.x + (c.x - s.x) * u, s.z + (c.z - s.z) * u)); }
    if (real > 2.5) frames.push({
      v: s.speed, pitch, up: c.y - s.y, clear: c.y - surface.height(c.x, c.z), dist: Math.hypot(c.x - s.x, c.z - s.z), above, skier: below / half, horizon: pitch / half,
      side: Math.atan2(rgt, fwd) * DEG, fov: c.fov, rate: rate * DEG, jerk: Math.abs(rate - prevRate) * DEG / frameDt, line, slope: Math.acos(Math.min(1, n.y)) * DEG, grounded: s.grounded,
    });
    prevYaw = yaw; prevRate = rate;
  }
  return frames;
}

const mean = (a, f) => (a.length ? a.reduce((t, o) => t + f(o), 0) / a.length : NaN);
const min = (a, f) => a.reduce((t, o) => Math.min(t, f(o)), Infinity);
const max = (a, f) => a.reduce((t, o) => Math.max(t, f(o)), -Infinity);
const p99 = (a, f) => { const v = a.map(f).sort((x, y) => x - y); return v[Math.floor(v.length * 0.99)]; };
const BANDS = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 26], [26, 34]];
function table(label, frames) {
  console.log(`  ${label}`);
  console.log('    m/s      n  pitch  onSnow  up(m)  clear(m)  dist(m)  fov  skier  horizon  slope');
  for (const [lo, hi] of BANDS) {
    const f = frames.filter((o) => o.v >= lo && o.v < hi);
    if (f.length < 20) continue;
    const m = (k) => mean(f, (o) => o[k]);
    console.log(`    ${String(lo).padStart(2)}-${String(hi).padEnd(2)} ${String(f.length).padStart(5)}  ${m('pitch').toFixed(1).padStart(5)}  ${m('above').toFixed(1).padStart(6)}  ${m('up').toFixed(2).padStart(5)}  ${m('clear').toFixed(2).padStart(8)}  ${m('dist').toFixed(2).padStart(7)}  ${m('fov').toFixed(0).padStart(3)}  ${m('skier').toFixed(2).padStart(5)}  ${m('horizon').toFixed(2).padStart(7)}  ${m('slope').toFixed(0).padStart(5)}`);
  }
}

const R = loadResort('killy');
const pick = (diff) => R.pistes.list.filter((p) => p.diff === diff && !p.src.slalom && !p.src.link && !p.src.variant).sort((x, y) => y.length - x.length)[0];
const blue = pick('blue'), red = pick('red'), black = R.pistes.byId.get('face-de-bellevarde');
const rides = {
  'blue upright': ride(R, blue, { maxS: 150 }),
  'blue weaving': ride(R, blue, { weave: 9, maxS: 150 }),
  'red weaving tucked': ride(R, red, { weave: 7, tuck: true, maxS: 120 }),
  'black tucked': ride(R, black, { tuck: true, maxS: 120 }),
  'black tucked 15 fps': ride(R, black, { tuck: true, maxS: 120, fps: 15 }),
  'red hockey stop': ride(R, red, { tuck: true, stopAt: 0.2, hard: true, maxS: 90 }),
};
if (TABLE) for (const [k, f] of Object.entries(rides)) table(`${k} (${f.length} frames)`, f);

const all = Object.entries(rides).filter(([k]) => !/15 fps/.test(k)).flatMap(([, f]) => f);
const band = (lo, hi, src = all) => src.filter((o) => o.v >= lo && o.v < hi && o.grounded);
const slow = band(2, 6), cruise = band(12, 20), fast = band(26, 34), moving = band(6, 34);
const m = (a, k) => mean(a, (o) => o[k]);
console.log('camera: from above and behind');
check(m(cruise, 'pitch') >= 25 && m(cruise, 'pitch') <= 35, `cruising (43-72 km/h): the view points ${m(cruise, 'pitch').toFixed(1)} deg down (25-35)`);
check(m(fast, 'pitch') >= 25 && m(fast, 'pitch') <= 40, `fast (>= 94 km/h): ${m(fast, 'pitch').toFixed(1)} deg down (25-40)`);
check(m(cruise, 'above') >= 12 && m(fast, 'above') >= 10, `the view meets the snow at the skier at ${m(cruise, 'above').toFixed(1)} deg cruising, ${m(fast, 'above').toFixed(1)} deg fast (>= 12 / >= 10: from above, not along the snow)`);
check(m(cruise, 'up') > m(slow, 'up') + 0.8 && m(fast, 'up') > m(cruise, 'up') + 0.8, `higher with the speed: ${m(slow, 'up').toFixed(1)} m (slow) < ${m(cruise, 'up').toFixed(1)} m (cruising) < ${m(fast, 'up').toFixed(1)} m (fast) over the skier`);
check(m(fast, 'dist') > m(slow, 'dist') + 1.5, `farther back with the speed: ${m(slow, 'dist').toFixed(1)} m (slow) -> ${m(fast, 'dist').toFixed(1)} m (fast)`);
check(m(cruise, 'clear') >= 4, `cruising: the camera flies ${m(cruise, 'clear').toFixed(1)} m over its own snow (>= 4)`);
const piste = moving.filter((o) => o.slope < 30);
check(max(piste, (o) => o.horizon) < 0.9, `the horizon stays in the picture on slopes under 30 deg: at most ${max(piste, (o) => o.horizon).toFixed(2)} of the half height above the centre (< 0.9), ${m(piste, 'horizon').toFixed(2)} on average`);
check(min(moving, (o) => o.skier) > -0.4 && max(moving, (o) => o.skier) < 0.8, `the skier stays in the picture: ${min(moving, (o) => o.skier).toFixed(2)} .. ${max(moving, (o) => o.skier).toFixed(2)} of the half height below the centre (-0.4 .. 0.8)`);
// portrait (820 x 1180): the same vertical field of view, a narrow width: the skier must stay inside it while turning
const halfW = (o, aspect) => Math.atan(Math.tan(o.fov * Math.PI / 360) * aspect) * DEG;
check(max(moving, (o) => Math.abs(o.side) / halfW(o, 820 / 1180)) < 0.8, `portrait (820 x 1180): the skier at most ${max(moving, (o) => Math.abs(o.side) / halfW(o, 820 / 1180)).toFixed(2)} of the half width off the centre (< 0.8); landscape ${max(moving, (o) => Math.abs(o.side) / halfW(o, 1180 / 820)).toFixed(2)}`);
check(min(all, (o) => o.clear) >= CAMERA.minClearance - 0.02, `never in the snow: the camera stays ${min(all, (o) => o.clear).toFixed(2)} m over its ground at the least (>= ${CAMERA.minClearance})`);
check(min(all, (o) => o.line) >= 0.2, `the line skier -> camera stays ${min(all, (o) => o.line).toFixed(2)} m over the snow at the least (>= 0.2)`);
const turns = [...rides['blue weaving'], ...rides['red weaving tucked']];
const carving = turns.filter((o) => o.v >= 6);          // (slower he pivots on the spot, a hairpin taken too fast: the view follows up to yawRate)
check(max(carving, (o) => Math.abs(o.rate)) < 75 && max(turns, (o) => Math.abs(o.rate)) < 120, `smooth in turns: the view turns at most ${max(carving, (o) => Math.abs(o.rate)).toFixed(0)} deg/s above 22 km/h (< 75), ${max(turns, (o) => Math.abs(o.rate)).toFixed(0)} deg/s at walking pace (< 120)`);
check(p99(turns, (o) => o.jerk) < 400, `no snap in turns: p99 of the turn-rate change ${p99(turns, (o) => o.jerk).toFixed(0)} deg/s2 (< 400)`);
const lo = band(20, 34, rides['black tucked 15 fps']), hi = band(20, 34, rides['black tucked']);
check(Math.abs(m(lo, 'pitch') - m(hi, 'pitch')) < 2 && Math.abs(m(lo, 'up') - m(hi, 'up')) < 0.5, `15 fps frames the same view as 60 fps (pitch ${m(lo, 'pitch').toFixed(1)} vs ${m(hi, 'pitch').toFixed(1)} deg, height ${m(lo, 'up').toFixed(1)} vs ${m(hi, 'up').toFixed(1)} m)`);
const stop = rides['red hockey stop'];
check(max(stop, (o) => Math.abs(o.rate)) < 120, `a hockey stop does not whip the view: at most ${max(stop, (o) => Math.abs(o.rate)).toFixed(0)} deg/s (< 120)`);
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
