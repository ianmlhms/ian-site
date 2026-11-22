/* Launch fix (22 Nov 2026, Ian on an iPad 9 on Killy's "Face (Schwaarz)": "you can't get faster than like 32 km/h"): straight runs
 * of the reference skier (the challenge physics, modes/skis.js fair) through the challenge course (modes/course.js barriers), driven
 * frame by frame like main.js (clock.js planSteps) at 60 fps AND at 15 fps (an iPad 9 on a heavy scene). Checks:
 *   - Face de Bellevarde (Killy's steep black), tucked: top 80-119 km/h, the steep half (>= 20 degrees) at >= 80 km/h on average
 *   - one long blue per resort: upright 40-70 km/h cruising (p75 of the run), tucked faster but under the 119 km/h cap
 *   - a low frame rate never makes the skier slower: 15 fps reaches the same speeds (+-3 %) and the game clock keeps real time
 *   - every black challenge not named as a link ("Verbindung ...", "Umfahrung ...") reaches 60 km/h tucked
 *   - the hard cap (SKI.maxSpeed = PLAY.maxRunSpeed = the ski-v1.sql floors) is never passed
 *   node scripts/ski/speed-check.mjs            the checks above
 *   node scripts/ski/speed-check.mjs --survey   every piste of every resort tucked at 60 fps: top / cruise speed (no pass / fail) */
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
const { SKI, PLAY, COURSE } = await imp('config.js');
const { createParkLayout } = await imp('modes/park.js');
const { createCourse } = await imp('modes/course.js');
const { skiParams } = await imp('modes/skis.js');
const { planSteps, frameSeconds } = await imp('clock.js');

const SURVEY = process.argv.includes('--survey');
const KMH = 3.6;
const CAP_KMH = SKI.maxSpeed * KMH;
const BLACK = { resort: 'killy', piste: 'face-de-bellevarde', top: [80, CAP_KMH + 0.5], steepMean: 80 };
const BLUE = { cruiseUpright: [40, 70] };
const BLUE_PICK = { killy: null, '3vallees': null, zermatt: null, arlberg: null, kronplatz: null };   // null: the longest plain blue
const FPS_TOLERANCE = 0.03;
const BLACK_MIN = 60;                        // km/h every black challenge reaches tucked (the survey: p10 of the blacks 91, median 111)
const LINK_NAME = /^(Verbindung|Umfahrung)\b/i;
const SAMPLE_S = 0.25;
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };

function loadResort(rid) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`))), 0, true));
  const surface = createSurface(field);
  // main.js's world (snow share x 1.25), the challenge physics (fair = the reference ski); no trees: this measures the speed, not the line
  const world = { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: () => null, ski: skiParams('allmountain', true) };
  return { resort, surface, world, pistes: createPisteSet(resort) };
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** A player skiing the course straight down the line: steers at a point ahead, never brakes; tuck or upright. Frames of 1 / fps s
 *  through clock.js like main.js frame(). Returns the speed samples (every SAMPLE_S game seconds) and the clock. */
function ride({ world, surface }, piste, { fps, tuck, maxS = 600 }) {
  const course = createCourse({ piste, startS: 2 });
  const a = piste.at(2, {});
  let s = createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z));
  s = { ...s, hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };      // main.js pushStart
  const proj = {}, q = {}, n = {};
  const samples = [];
  let acc = 0, real = 0, game = 0, best = 0, nextSample = 0, top = 0;
  const frameDt = frameSeconds(1 / fps);
  while (real < maxS && best < course.finishS) {
    real += 1 / fps;
    const plan = planSteps(acc, frameDt);
    acc = plan.acc;
    for (let i = 0; i < plan.steps; i++) {
      piste.project(s.x, s.z, best, 150, proj);
      best = Math.max(best, proj.s);
      piste.at(proj.s + 12 + s.speed * 0.9, q);
      const err = wrap(Math.atan2(q.z - s.z, q.x - s.x) - s.heading);
      const input = { steer: Math.max(-1, Math.min(1, err * 2.4)), tuck: tuck ? 1 : 0, brake: 0, push: s.speed < 3 ? 1 : 0, jump: false };
      const prev = s;
      s = course.collide(prev, stepSkier(prev, input, world));
      game += SKI.dt;
      top = Math.max(top, s.speed);
      if (game >= nextSample) {
        nextSample += SAMPLE_S;
        world.normal(s.x, s.z, n);
        samples.push({ s: best, v: s.speed, slope: Math.acos(Math.min(1, n.y)) * 180 / Math.PI });
      }
    }
  }
  const vs = samples.map((o) => o.v).sort((x, y) => x - y);
  const pct = (f) => (vs.length ? vs[Math.min(vs.length - 1, Math.floor(vs.length * f))] : 0) * KMH;
  const steep = samples.filter((o) => o.slope >= 20);
  return {
    done: best >= course.finishS - 1, real, game, top: top * KMH, p75: pct(0.75), median: pct(0.5),
    steepMean: steep.length ? steep.reduce((t, o) => t + o.v, 0) / steep.length * KMH : 0, steepShare: steep.length / Math.max(1, samples.length), hits: course.hits,
  };
}

const fmt = (r) => `top ${r.top.toFixed(0)} km/h, p75 ${r.p75.toFixed(0)}, median ${r.median.toFixed(0)}${r.steepShare ? `, on >= 20 deg ${r.steepMean.toFixed(0)}` : ''}, ${r.game.toFixed(1)} s game / ${r.real.toFixed(1)} s real, ${r.hits} net hits${r.done ? '' : ' (not at the finish)'}`;

if (SURVEY) {
  for (const rid of Object.keys(BLUE_PICK)) {
    const R = loadResort(rid);
    for (const p of R.pistes.list) {
      if (p.src.slalom) continue;
      const r = ride(R, p, { fps: 60, tuck: true, maxS: 400 });
      console.log(`${rid.padEnd(9)} ${p.id.padEnd(30)} ${p.diff.padEnd(5)} ${String(Math.round(p.length)).padStart(5)} m drop ${String(Math.round(p.src.drop)).padStart(4)} m  ${fmt(r)}`);
    }
  }
  process.exit(0);
}

check(SKI.maxSpeed === PLAY.maxRunSpeed, `the hard cap ${SKI.maxSpeed} m/s == PLAY.maxRunSpeed ${PLAY.maxRunSpeed} (the ski-v1.sql floors)`);
for (const rid of Object.keys(BLUE_PICK)) {
  console.log(rid);
  const R = loadResort(rid);
  const runs = [];
  if (rid === BLACK.resort) {
    const p = R.pistes.byId.get(BLACK.piste);
    for (const fps of [60, 15]) {
      const r = ride(R, p, { fps, tuck: true });
      console.log(`      ${p.id} tucked @${fps} fps: ${fmt(r)}`);
      check(r.done && r.top >= BLACK.top[0] && r.top <= BLACK.top[1], `${p.name} tucked @${fps} fps: top ${r.top.toFixed(0)} km/h in ${BLACK.top[0]}-${BLACK.top[1].toFixed(0)}`);
      check(r.steepMean >= BLACK.steepMean, `${p.name} tucked @${fps} fps: ${r.steepMean.toFixed(0)} km/h on average where it is >= 20 deg steep (>= ${BLACK.steepMean})`);
      runs.push({ label: `${p.id} tucked`, fps, r });
    }
  }
  const blue = BLUE_PICK[rid] ? R.pistes.byId.get(BLUE_PICK[rid]) : R.pistes.list.filter((p) => p.diff === 'blue' && !p.src.slalom && !p.src.link && !p.src.variant).sort((x, y) => y.length - x.length)[0];
  for (const tuck of [false, true]) {
    for (const fps of [60, 15]) {
      const r = ride(R, blue, { fps, tuck });
      console.log(`      ${blue.id} (${Math.round(blue.length)} m) ${tuck ? 'tucked' : 'upright'} @${fps} fps: ${fmt(r)}`);
      if (!tuck) check(r.done && r.p75 >= BLUE.cruiseUpright[0] && r.p75 <= BLUE.cruiseUpright[1], `${blue.name} upright @${fps} fps: cruising (p75) ${r.p75.toFixed(0)} km/h in ${BLUE.cruiseUpright.join('-')}`);
      else check(r.done && r.top <= CAP_KMH + 0.5, `${blue.name} tucked @${fps} fps: top ${r.top.toFixed(0)} km/h <= the cap`);
      runs.push({ label: `${blue.id} ${tuck ? 'tucked' : 'upright'}`, fps, r });
    }
  }
  // every black challenge reads as a steep run: tucked it reaches BLACK_MIN km/h, unless its name says it is a link / bypass (the
  // Killy "Face (Schwaarz)" of the launch was a 276 m OSM link at 2-9 degrees, 38 km/h cruising, shown like the famous Face)
  const flat = [];
  for (const p of R.pistes.list) {
    if (p.diff !== 'black' || p.src.slalom || LINK_NAME.test(p.name)) continue;
    const r = ride(R, p, { fps: 60, tuck: true, maxS: 400 });
    if (r.top < BLACK_MIN) flat.push(`${p.id} "${p.name}" ${Math.round(p.length)} m ${r.top.toFixed(0)} km/h`);
  }
  check(!flat.length, `every black challenge not named as a link reaches ${BLACK_MIN} km/h tucked${flat.length ? `: ${flat.join(', ')}` : ''}`);
  // 15 fps must not be slower than 60 fps: the same speeds, the game clock at real time
  for (const label of new Set(runs.map((o) => o.label))) {
    const a = runs.find((o) => o.label === label && o.fps === 60).r, b = runs.find((o) => o.label === label && o.fps === 15).r;
    check(Math.abs(b.top - a.top) <= a.top * FPS_TOLERANCE && Math.abs(b.p75 - a.p75) <= a.p75 * FPS_TOLERANCE, `${label}: 15 fps top ${b.top.toFixed(0)} / p75 ${b.p75.toFixed(0)} km/h vs 60 fps ${a.top.toFixed(0)} / ${a.p75.toFixed(0)}`);
    check(Math.abs(b.game / b.real - 1) < 0.02, `${label}: at 15 fps the game clock keeps real time (${(b.game / b.real).toFixed(3)} x)`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
