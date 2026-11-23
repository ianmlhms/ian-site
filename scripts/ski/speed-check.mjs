/* Launch fix (22 Nov 2026, Ian on an iPad 9 on Killy's "Face (Schwaarz)": "you can't get faster than like 32 km/h"): straight runs
 * of the reference skier (the challenge physics, modes/skis.js fair) through the challenge course (modes/course.js barriers), driven
 * frame by frame like main.js (clock.js planSteps) at 60 fps AND at 15 fps (an iPad 9 on a heavy scene). Checks:
 *   - Face de Bellevarde (Killy's steep black), tucked: top 80-119 km/h, the steep half (>= 20 degrees) at >= 80 km/h on average
 *   - one long blue per resort: upright 40-70 km/h cruising (p75 of the run), tucked faster but under the 119 km/h cap
 *   - a low frame rate never makes the skier slower: 15 fps reaches the same speeds (+-3 %) and the game clock keeps real time
 *   - every black challenge not named as a link ("Verbindung ...", "Umfahrung ...") reaches 60 km/h tucked
 *   - launch follow-up (Ian: "accelerate faster to at least ~45 km/h"): 0 -> 45 km/h from a standstill on the longest blue (tucked,
 *     <= 4.5 s) and the flattest link (tucked / pushed, <= 6.5 s), at 60 and 15 fps; 1.5 s after "0" every course start is at 40-50 km/h;
 *     Jardin Alpin (3 Vallées) and each resort's 5 slowest greens / blues average >= 40 km/h tucked
 *   - the hard cap (SKI.maxSpeed = PLAY.maxRunSpeed = the ski-v1.sql floors) is never passed
 *   node scripts/ski/speed-check.mjs            the checks above
 *   node scripts/ski/speed-check.mjs --survey   every piste of every resort tucked at 60 fps: top / cruise speed (no pass / fail) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.SKI_ROOT || path.join(here, '..', '..', 'pb', 'ski');     // SKI_ROOT: another copy of pb/ski (before / after numbers)
const imp = (p) => import(path.join(root, p));
const { unpackResort } = await imp('linepack.js');
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createPisteSet } = await imp('pistes.js');
const skierMod = await imp('skier.js');
const { createSkierState, stepSkier } = skierMod;
const launchState = skierMod.launchState || ((st, a) => ({ ...st, hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push, heading: Math.atan2(a.dz, a.dx) }));      // before the launch: the bare kick
const { SKI, PLAY, COURSE } = await imp('config.js');
const { createParkLayout } = await imp('modes/park.js');
const { createCourse } = await imp('modes/course.js');
const { skiParams } = await imp('modes/skis.js');
const { planSteps, frameSeconds } = await imp('clock.js');

const SURVEY = process.argv.includes('--survey');
const traceArg = process.argv.indexOf('--trace');
const TRACE = traceArg >= 0 ? process.argv[traceArg + 1] : '';     // --trace <resort>:<piste>: one line a second of that ride (tucked, launch)
const KMH = 3.6;
const CAP_KMH = SKI.maxSpeed * KMH;
const BLACK = { resort: 'killy', piste: 'face-de-bellevarde', top: [80, CAP_KMH + 0.5], steepMean: 80 };
const BLUE = { cruiseUpright: [40, 70] };
const BLUE_PICK = { killy: null, '3vallees': null, zermatt: null, arlberg: null, kronplatz: null, vialattea: null, obertauern: null, livigno: null };   // null: the longest plain blue
const FPS_TOLERANCE = 0.03;
const BLACK_MIN = 60;                        // km/h every black challenge reaches tucked (the survey: p10 of the blacks 91, median 111)
const LINK_NAME = /^(Verbindung|Umfahrung)\b/i;
const TO45 = { blue: 4.5, flat: 6.5 };       // s from a standstill to 45 km/h: a typical blue ~3-4 s, a near-flat link ~5-6 s (launch follow-up)
const LAUNCH_AT15 = [40, 50];                // km/h 1.5 s after "0" on every course start
const GENTLE_AVG = 40;                       // km/h a gentle green / blue course averages tucked
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

/** The link (a "Verbindung", >= 150 m) whose first 100 m fall the least (0-3 degrees): a near-flat connector. */
function flattestLink(R) {
  let best = null;
  for (const p of R.pistes.list) {
    if (!p.src.link || p.length < 150) continue;
    const a = p.at(2, {}), b = p.at(102, {});
    const grade = Math.atan2(R.surface.height(a.x, a.z) - R.surface.height(b.x, b.z), 100) * 180 / Math.PI;
    if (grade >= 0 && grade <= 3 && (!best || grade < best.grade)) best = Object.assign(Object.create(p), p, { grade });
  }
  return best;
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** A player skiing the course straight down the line: steers at a point ahead, never brakes; tuck or upright. Frames of 1 / fps s
 *  through clock.js like main.js frame(). start: 'launch' = the challenge start at "0" (skier.js launchState, main.js pushStart),
 *  'stand' = from a standstill (the edge hold, released by the input). Returns the speed samples (every SAMPLE_S game seconds), the
 *  time to 45 km/h, the speed 1.5 s after the start, the average speed over the course and the clock. */
function ride({ world, surface }, piste, { fps, tuck, push = false, start = 'launch', maxS = 600, stopAt45 = false, startS = 2 }) {
  const course = createCourse({ piste, startS });
  const a = piste.at(startS, {});
  let s = createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z));
  if (start === 'launch') s = launchState(s, a);
  const proj = {}, q = {}, n = {};
  const samples = [];
  let acc = 0, real = 0, game = 0, best = startS, nextSample = 0, top = 0, to45 = null, at15 = null;
  const frameDt = frameSeconds(1 / fps);
  while (real < maxS && best < course.finishS && !(stopAt45 && to45 !== null)) {
    real += 1 / fps;
    const plan = planSteps(acc, frameDt);
    acc = plan.acc;
    for (let i = 0; i < plan.steps; i++) {
      piste.project(s.x, s.z, best, 150, proj);
      best = Math.max(best, proj.s);
      piste.at(proj.s + 12 + s.speed * 0.9, q);
      const err = wrap(Math.atan2(q.z - s.z, q.x - s.x) - s.heading);
      // physics review (cheaper carving): turning no longer dumps the speed, so the rider brakes for a hairpin like a player (the line
      // turns more than 0.9 rad off his skis at over 43 km/h); before, Arlberg's Hoppelweg hairpin sent him down the neighbouring piste
      const hairpin = Math.abs(err) > 0.9 && s.speed > 12 && best > 80;            // (never in the launch)
      const input = { steer: Math.max(-1, Math.min(1, err * 2.4)), tuck: tuck && !hairpin ? 1 : 0, brake: hairpin ? 1 : 0, push: push || s.speed < 3 ? 1 : 0, jump: false };
      const prev = s;
      s = course.collide(prev, stepSkier(prev, input, world));
      game += SKI.dt;
      top = Math.max(top, s.speed);
      if (to45 === null && s.speed * KMH >= 45) to45 = game;
      if (at15 === null && game >= 1.5) at15 = s.speed * KMH;
      if (game >= nextSample) {
        nextSample += SAMPLE_S;
        world.normal(s.x, s.z, n);
        if (TRACE && Math.round(game / SAMPLE_S) % 4 === 0) { const ah = {}; piste.at(best + 10, ah); console.log(`      t ${game.toFixed(0)} s ${best.toFixed(0)} off ${proj.off.toFixed(1)} v ${(s.speed * KMH).toFixed(0)} km/h ground ${(Math.acos(Math.min(1, n.y)) * 180 / Math.PI).toFixed(1)} deg, line ahead ${(surface.height(s.x, s.z) - surface.height(ah.x, ah.z)).toFixed(1)} m drop / ${(best + 10 - proj.s).toFixed(0)} m, snow ${s.snow.toFixed(2)} air ${s.grounded ? 0 : 1} hits ${course.hits}`); }
        samples.push({ s: best, v: s.speed, slope: Math.acos(Math.min(1, n.y)) * 180 / Math.PI });
      }
    }
  }
  const vs = samples.map((o) => o.v).sort((x, y) => x - y);
  const pct = (f) => (vs.length ? vs[Math.min(vs.length - 1, Math.floor(vs.length * f))] : 0) * KMH;
  const steep = samples.filter((o) => o.slope >= 20);
  const done = best >= course.finishS - 1;
  return {
    done, real, game, top: top * KMH, p75: pct(0.75), median: pct(0.5), to45, at15, avg: (Math.min(best, course.finishS) - startS) / Math.max(game, 1e-6) * KMH,
    steepMean: steep.length ? steep.reduce((t, o) => t + o.v, 0) / steep.length * KMH : 0, steepShare: steep.length / Math.max(1, samples.length), hits: course.hits,
  };
}

const fmt = (r) => `top ${r.top.toFixed(0)} km/h, p75 ${r.p75.toFixed(0)}, median ${r.median.toFixed(0)}${r.steepShare ? `, on >= 20 deg ${r.steepMean.toFixed(0)}` : ''}, ${r.game.toFixed(1)} s game / ${r.real.toFixed(1)} s real, ${r.hits} net hits${r.done ? '' : ' (not at the finish)'}`;

if (TRACE) {
  const [rid, id] = TRACE.split(':');
  const R = loadResort(rid), p = R.pistes.byId.get(id);
  const r = ride(R, p, { fps: 60, tuck: !process.argv.includes('--upright'), maxS: 600 });
  console.log(`${id} ${Math.round(p.length)} m: avg ${r.avg.toFixed(1)} km/h, ${r.game.toFixed(1)} s${r.done ? '' : ' NOT DONE'}`);
  process.exit(0);
}
if (process.argv.includes('--courses')) {
  // every course with the launch, tucked at 60 fps: average speed / finish time / speed 1.5 s after "0" (sorted slowest first)
  const rows = [];
  for (const rid of Object.keys(BLUE_PICK)) {
    const R = loadResort(rid);
    for (const p of R.pistes.list) {
      if (p.src.slalom) continue;
      const r = ride(R, p, { fps: 60, tuck: true, maxS: 900 });
      rows.push({ rid, id: p.id, name: p.name, diff: p.diff, len: p.length, ...r });
    }
  }
  rows.sort((x, y) => x.avg - y.avg);
  for (const r of rows) console.log(`${r.rid.padEnd(9)} ${r.id.padEnd(30)} ${r.diff.padEnd(5)} ${String(Math.round(r.len)).padStart(5)} m  avg ${r.avg.toFixed(1)} km/h  time ${r.game.toFixed(1)} s  @1.5s ${r.at15.toFixed(0)} km/h  to45 ${r.to45 === null ? '-' : r.to45.toFixed(1)}${r.done ? '' : '  NOT DONE'}`);
  process.exit(0);
}
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
  // launch follow-up: from a standstill to 45 km/h (the longest plain blue, tucked; the flattest link, tucked = touch and pushed = W)
  const flatLink = flattestLink(R);
  const starts = [{ label: `${blue.id} tucked`, p: blue, o: { tuck: true }, max: TO45.blue }];
  if (flatLink) starts.push({ label: `${flatLink.id} (flat link, ${flatLink.grade.toFixed(1)} deg) tucked`, p: flatLink, o: { tuck: true }, max: TO45.flat },
    { label: `${flatLink.id} (flat link) pushed`, p: flatLink, o: { tuck: false, push: true }, max: TO45.flat });
  for (const st of starts) {
    const t = [60, 15].map((fps) => ride(R, st.p, { ...st.o, fps, start: 'stand', stopAt45: true, maxS: 30 }).to45);
    check(t.every((x) => x !== null && x <= st.max), `${st.label}: 0 -> 45 km/h in ${t.map((x) => (x === null ? 'never' : `${x.toFixed(1)} s`)).join(' @60 / ')} @15 fps (<= ${st.max} s)`);
  }
  // the challenge launch: 1.5 s after "0" every course start is at 40-50 km/h (no input but the steering: the slowest case)
  const off = [];
  let lo = Infinity, hi = 0;
  for (const p of R.pistes.list) {
    const r = ride(R, p, { fps: 60, tuck: false, maxS: 1.6 });
    lo = Math.min(lo, r.at15); hi = Math.max(hi, r.at15);
    if (!(r.at15 >= LAUNCH_AT15[0] && r.at15 <= LAUNCH_AT15[1])) off.push(`${p.id} ${r.at15.toFixed(0)}`);
  }
  check(!off.length, `${R.pistes.list.length} course starts: 1.5 s after "0" at ${lo.toFixed(0)}-${hi.toFixed(0)} km/h (${LAUNCH_AT15.join('-')})${off.length ? `: ${off.slice(0, 8).join(', ')}` : ''}`);
  // no gentle course crawls: Jardin Alpin and the 5 slowest greens / blues of the resort, tucked, average >= GENTLE_AVG km/h
  const gentle = [];
  for (const p of R.pistes.list) if ((p.diff === 'green' || p.diff === 'blue') && !p.src.slalom) gentle.push({ p, r: ride(R, p, { fps: 60, tuck: true, maxS: 900 }) });
  gentle.sort((x, y) => x.r.avg - y.r.avg);
  const pick = gentle.slice(0, 5);
  const ja = rid === '3vallees' && gentle.find((o) => o.p.id === 'jardin-alpin');
  if (ja && !pick.includes(ja)) pick.unshift(ja);
  for (const o of pick) check(o.r.done && o.r.avg >= GENTLE_AVG, `${o.p.name} (${o.p.diff}, ${Math.round(o.p.length)} m) tucked: average ${o.r.avg.toFixed(1)} km/h, ${o.r.game.toFixed(0)} s (>= ${GENTLE_AVG})`);
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
