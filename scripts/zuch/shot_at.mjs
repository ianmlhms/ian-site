/* One free-camera shot: node scripts/zuch/shot_at.mjs <routeId> <out.png> <s> <lat> <up> <targetLat> <targetUp> [fov] [ahead target s offset] */
import { openSim } from './zlib.mjs';
const [route, out, s, lat, up, tlat, tup, fov = '60', ds = '0'] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  await sim.view({ s: +s - 120, trainS: +s - 400, lat: +lat, up: +up, target: { s: +s + +ds, lat: +tlat, up: +tup }, fov: +fov, settle: 40 });
  await sim.shot(out);
  console.log('ok', out, sim.errors.filter((e) => !/404/.test(e)).slice(0, 3));
} finally { await sim.close(); }
