/* One scripted ride, traced every 5 s (where does a ride lose its time?):  node scripts/ski/ride-trace.mjs <resort> <piste id> [tuck 0|1]
 * The rider of speed-check.mjs / ride-probe.mjs (the challenge physics + the course nets, straight down the line). */
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

const [rid, id, tuckArg = '1'] = process.argv.slice(2);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const dir = path.join(root, 'data', rid);
const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
const field = createField({ resort, far: decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin')))), classes: decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin')))), net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`))), 0, true));
const surface = createSurface(field);
const world = { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: () => null, ski: skiParams('allmountain', true) };
const piste = createPisteSet(resort).byId.get(id);
const course = createCourse({ piste, startS: 2 });
const a = piste.at(2, {});
let s = { ...createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z)), hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push };
const proj = {}, q = {}, n = {};
let t = 0, best = 0, k = 0, air = 0, hits = 0;
while (t < 400 && best < course.finishS) {
  piste.project(s.x, s.z, best, 150, proj);
  best = Math.max(best, proj.s);
  piste.at(proj.s + 12 + s.speed * 0.9, q);
  const err = wrap(Math.atan2(q.z - s.z, q.x - s.x) - s.heading);
  const prev = s;
  s = course.collide(prev, stepSkier(prev, { steer: Math.max(-1, Math.min(1, err * 2.4)), tuck: tuckArg === '1' && !(Math.abs(err) > 0.9 && s.speed > 12) ? 1 : 0, brake: Math.abs(err) > 0.9 && s.speed > 12 ? 1 : 0, push: s.speed < 3 ? 1 : 0, jump: false }, world));
  t += SKI.dt; k++;
  if (!s.grounded) air += SKI.dt;
  if (k % (process.env.EVERY ? Number(process.env.EVERY) : 600) === 0 && t >= Number(process.env.FROM || 0)) {
    world.normal(s.x, s.z, n);
    piste.at(proj.s, q);
    console.log(`t ${t.toFixed(0).padStart(3)} s  s ${best.toFixed(0).padStart(5)} m (now ${proj.s.toFixed(0)})  ${(s.speed * 3.6).toFixed(0).padStart(3)} km/h  ${Math.hypot(s.x - q.x, s.z - q.z).toFixed(0).padStart(3)} m off the line  snow ${s.snow.toFixed(2)}  slope ${(Math.acos(Math.min(1, n.y)) * 57.3).toFixed(0)} deg  air ${air.toFixed(1)} s  net hits ${course.hits - hits}  ${s.grounded ? '' : 'IN THE AIR'}${s.crash > 0 ? ' CRASH ' + s.crashKind : ''}`);
    air = 0; hits = course.hits;
  }
}
console.log(best >= course.finishS - 1 ? `finished in ${t.toFixed(1)} s` : `not at the finish after ${t.toFixed(0)} s (s ${best.toFixed(0)} of ${course.finishS.toFixed(0)} m)`);
