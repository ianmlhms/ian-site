/* The crossing as the driver sees it: the real cab camera at 3 distances, barriers closed, vehicles queueing.
 *   node scripts/zuch/crossing_cab.mjs <outDir> <routeId> <crossingIndex> [--root <repo>] */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined);
const [outDir, routeId, idx] = args;
const sim = await openSim({ quality: 'high', root });
try {
  await sim.start(routeId);
  const c = await sim.evalGame(({ track }, i) => track.crossings[i].s, Number(idx));
  const base = path.join(outDir, `${routeId}-x${idx}-cab`);
  await sim.viewCab({ s: c - 130, settle: 10 });
  await sim.page.waitForTimeout(32000);      // the barriers close (380 m), traffic arrives and queues
  for (const d of [130, 60, 24]) {
    await sim.viewCab({ s: c - d, settle: 90 });
    await sim.shot(`${base}-${d}m.png`);
  }
  console.log('ok', c);
} finally { await sim.close(); }
