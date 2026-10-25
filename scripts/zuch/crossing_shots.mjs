/* Screenshots of every level crossing of the given routes: cab approach, from beside the track along the road both ways, and from the air.
 *   node scripts/zuch/crossing_shots.mjs <outDir> [routeIds, comma separated] [--root <repoRoot>] [--quality high|medium|low]
 * Used for the before / after montages of the crossing roads. */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined);
const quality = flag('quality', 'high');
const outDir = args[0];
const routes = (args[1] || 'west,south,east,north').split(',');
const sim = await openSim({ quality, root });
try {
  for (const route of routes) {
    await sim.start(route);
    const crossings = await sim.evalGame(({ track }) => track.crossings.map((c) => c.s));
    console.log(route, 'crossings', crossings.map(Math.round).join(','));
    for (let i = 0; i < crossings.length; i++) {
      const s = crossings[i];
      const base = path.join(outDir, `${route}-x${i}`);
      await sim.view({ s: s - 90, trainS: s - 200, lat: 0, up: 2.9, yaw: 0, pitch: -0.02, fov: 62, settle: 40 });
      await sim.shot(base + '-a-cab.png');
      await sim.view({ s, trainS: s - 200, lat: 13, up: 3.2, yaw: -Math.PI / 2, pitch: -0.06, fov: 62 });
      await sim.shot(base + '-b-right.png');
      await sim.view({ s, trainS: s - 200, lat: -13, up: 3.2, yaw: Math.PI / 2, pitch: -0.06, fov: 62 });
      await sim.shot(base + '-c-left.png');
      await sim.view({ s: s - 60, trainS: s - 200, lat: -70, up: 55, target: { s, lat: 0, up: 0 }, fov: 58 });
      await sim.shot(base + '-d-air.png');
    }
  }
  console.log('errors', sim.errors.slice(0, 8));
} finally {
  await sim.close();
}
