/* Several camera poses of one route in ONE browser session (W5 roads2):
 *   node scripts/zuch/poses.mjs <route> <outDir> [--quality medium] <name>:<s>:<lat>:<up>:<yaw>:<pitch>:<fov>[:<trainS>] ...
 * s / lat / up in track coordinates (lat to the right), yaw + = left, pitch + = up.  Run through python3 ~/Library/Caches/browser-slot.py. */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const [route, outDir, ...poses] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(route);
  for (const p of poses) {
    const [name, s, lat, up, yaw, pitch, fov, trainS] = p.split(':');
    await sim.page.evaluate((ts) => { const w = __tsTest.internals().world; w.landscape.warm(ts); }, Number(s));
    await sim.view({ s: Number(s), lat: Number(lat), up: Number(up), yaw: Number(yaw), pitch: Number(pitch), fov: Number(fov), trainS: trainS === undefined ? Number(s) - 200 : Number(trainS), settle: 30 });
    await sim.shot(path.join(outDir, name + '.png'));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
