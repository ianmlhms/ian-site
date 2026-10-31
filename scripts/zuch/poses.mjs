/* Several free-camera poses in one browser: node scripts/zuch/poses.mjs <route> <outDir> '<json array of {n,s,lat,up,yaw,pitch,fov}>' [--quality medium]
 * (s, lat: game track coordinates, lat + = right of travel, yaw 0 = along the track, + = left; the train stands far away at s - 400 unless trainS is given) */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const qi = args.indexOf('--quality'); const quality = qi >= 0 ? args.splice(qi, 2)[1] : 'high';
const [route, outDir, json] = args;
const poses = JSON.parse(json);
const sim = await openSim({ quality });
try {
  await sim.start(route);
  for (const p of poses) {
    await sim.page.evaluate((ts) => { const w = __tsTest.internals().world; w.landscape.warm(ts); }, p.s);
    await sim.view({ settle: 30, trainS: p.s - 400, ...p });
    await sim.shot(path.join(outDir, `${p.n}.png`));
  }
  console.log('ok', sim.errors.filter((e) => !/404|groundAt/.test(e)).slice(0, 3));
} finally { await sim.close(); }
