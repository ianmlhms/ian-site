/* Real pistes, the reference skier (the challenge physics): what a ride feels like in numbers. A table to read (no pass / fail):
 *   node scripts/ski/ride-probe.mjs [resort]                       the table
 *   node scripts/ski/ride-probe.mjs <resort> --json OUT.json       the check set as data (3 reds, 2 blacks, 1 blue, the Face)
 *   node scripts/ski/ride-probe.mjs --compare BEFORE.json AFTER.json   exit 1 when a ride loses > 10 s, crashes or no longer finishes
 * Per piste (the longest green / blue / red, Killy's Face de Bellevarde): time, mean and top speed, the airs (count, the longest, the
 * share of the ride in the air), crashes by kind, the mean slip angle; straight down the line and in S turns (+-8 m round the line),
 * upright and tucked. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { unpackResort } = await imp('linepack.js');
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createPisteSet } = await imp('pistes.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { SKI, COURSE } = await imp('config.js');
const { createParkLayout } = await imp('modes/park.js');
const { createCourse } = await imp('modes/course.js');
const { skiParams } = await imp('modes/skis.js');

/* --compare BEFORE.json AFTER.json: the two --json files of the same rides side by side (time lost, airs, crashes). */
if (process.argv[2] === '--compare') {
  const [A, B] = [3, 4].map((i) => JSON.parse(fs.readFileSync(process.argv[i], 'utf8')));
  let lost = 0, crashed = 0, dnf = 0, airs = 0, longest = 0, n = 0, faster = 0;
  for (const b of B) {
    const a = A.find((o) => o.rid === b.rid && o.id === b.id && o.style === b.style);
    if (!a) continue;
    n++; airs += b.airs; longest = Math.max(longest, b.longest); faster += a.t - b.t;
    const bad = [];
    if (b.t - a.t > 10) { lost++; bad.push(`loses ${(b.t - a.t).toFixed(1)} s`); }
    if (Object.keys(b.crashes).length) { crashed++; bad.push(`crashes ${JSON.stringify(b.crashes)}`); }
    if (a.done && !b.done) { dnf++; bad.push('did not finish'); }
    console.log(`${b.rid.padEnd(9)} ${b.id.padEnd(28)} ${b.diff.padEnd(5)} ${b.style.padEnd(12)} ${a.t.toFixed(1).padStart(6)} -> ${b.t.toFixed(1).padStart(6)} s  airs ${String(a.airs).padStart(2)} -> ${String(b.airs).padStart(2)} (longest ${a.longest.toFixed(2)} -> ${b.longest.toFixed(2)} s, ${b.high.toFixed(1)} m up, ${b.airShare.toFixed(1)} % in the air)  off the groomed ${a.off.toFixed(1)} -> ${b.off.toFixed(1)} s  ${bad.length ? 'PROBLEM: ' + bad.join(', ') : ''}`);
  }
  console.log(`${n} rides: ${lost} lose > 10 s, ${crashed} with a crash, ${dnf} no longer finish; ${(airs / n).toFixed(1)} airs a ride, the longest ${longest.toFixed(2)} s; ${(faster / n).toFixed(1)} s faster on average`);
  process.exit(lost || crashed || dnf ? 1 : 0);
}
const rid = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'killy';
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const dir = path.join(root, 'data', rid);
const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
const field = createField({ resort, far: decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin')))), classes: decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin')))), net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`))), 0, true));
const surface = createSurface(field);
const world = { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: () => null, ski: skiParams('allmountain', true) };
const pistes = createPisteSet(resort);

function ride(piste, { tuck, weave, maxS = 400 }) {
  const course = createCourse({ piste, startS: 2 });
  const a = piste.at(2, {});
  let s = { ...createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z)), hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };
  const proj = {}, q = {};
  let t = 0, best = 0, top = 0, airs = 0, air = 0, longest = 0, airT = 0, slip = 0, n = 0, highest = 0;
  let off = 0;
  const crashes = {};
  while (t < maxS && best < course.finishS) {
    piste.project(s.x, s.z, best, 150, proj);
    best = Math.max(best, proj.s);
    piste.at(proj.s + 12 + s.speed * 0.9, q);
    const side = weave ? Math.sin(best / 38) * weave : 0;
    const err = wrap(Math.atan2(q.z - q.dx * side - s.z, q.x + q.dz * side - s.x) - s.heading);
    const prev = s;
    s = course.collide(prev, stepSkier(prev, { steer: Math.max(-1, Math.min(1, err * 2.4)), tuck: tuck ? 1 : 0, brake: 0, push: s.speed < 3 ? 1 : 0, jump: false }, world));
    t += SKI.dt; n++;
    top = Math.max(top, s.speed); slip += s.slip;
    if (s.grounded && s.snow < 0.5) off += SKI.dt;
    if (!s.grounded) { air += SKI.dt; airT += SKI.dt; highest = Math.max(highest, s.y - surface.height(s.x, s.z)); } else if (air > 0) { if (air > 0.15) airs++; longest = Math.max(longest, air); air = 0; }
    if (s.crash > 0 && prev.crash === 0) crashes[s.crashKind] = (crashes[s.crashKind] || 0) + 1;
    if (s.crash > 0 && s.crash < 0.05) s = { ...s, crash: 0 };
  }
  if (JSON_OUT) return { done: best >= course.finishS - 1, t, airs, longest, high: highest, airShare: airT / t * 100, crashes, off, top: top * 3.6 };
  return `${(best >= course.finishS - 1 ? t.toFixed(1) : 'DNF').padStart(6)} s  mean ${(best / t * 3.6).toFixed(0).padStart(3)} km/h  top ${(top * 3.6).toFixed(0).padStart(3)}  airs>0.15s ${String(airs).padStart(2)} (longest ${longest.toFixed(2)} s, ${highest.toFixed(1)} m up, ${(airT / t * 100).toFixed(1)} % of the ride)  slip ${(Math.asin(Math.min(1, slip / n)) * 180 / Math.PI).toFixed(1)} deg  crashes ${JSON.stringify(crashes)}  net hits ${course.hits}`;
}

const JSON_OUT = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : '';
if (JSON_OUT) {
  // the check set: the three longest reds and the two longest blacks (+ the longest blue, + Killy's Face), each down the line upright,
  // down the line tucked and in S turns tucked
  const plain = (d) => pistes.list.filter((p) => p.diff === d && !p.src.slalom && !p.src.link && !p.src.variant && !/^(Verbindung|Umfahrung)/.test(p.name)).sort((x, y) => y.length - x.length);
  const set = [...plain('red').slice(0, 3), ...plain('black').slice(0, 2), plain('blue')[0]];
  if (rid === 'killy' && !set.includes(pistes.byId.get('face-de-bellevarde'))) set.push(pistes.byId.get('face-de-bellevarde'));
  const rows = [];
  for (const p of set.filter(Boolean)) for (const [style, o] of [['line upright', { tuck: 0, weave: 0 }], ['line tucked', { tuck: 1, weave: 0 }], ['S tucked', { tuck: 1, weave: 8 }]]) rows.push({ rid, id: p.id, diff: p.diff, style, ...ride(p, { ...o, maxS: 600 }) });
  fs.writeFileSync(JSON_OUT, JSON.stringify(rows));
  console.log(`${rid}: ${rows.length} rides -> ${JSON_OUT}`);
  process.exit(0);
}
const pick = (diff) => pistes.list.filter((p) => p.diff === diff && !p.src.slalom && !p.src.link && !p.src.variant).sort((x, y) => y.length - x.length)[0];
const list = [pick('green'), pick('blue'), pick('red'), rid === 'killy' ? pistes.byId.get('face-de-bellevarde') : pick('black')].filter(Boolean);
for (const p of list) {
  console.log(`${p.id} (${p.diff}, ${Math.round(p.length)} m, drop ${Math.round(p.src.drop)} m)`);
  for (const [lab, o] of [['line upright', { tuck: 0, weave: 0 }], ['line tucked ', { tuck: 1, weave: 0 }], ['S upright   ', { tuck: 0, weave: 8 }], ['S tucked    ', { tuck: 1, weave: 8 }]]) console.log(`  ${lab} ${ride(p, o)}`);
}
