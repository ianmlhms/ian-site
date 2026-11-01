/* In-game check of every rolling stock: starts a service with each train on a route it may run, takes the cab view at the first platform, prints draws / triangles
 * and the console errors.   node scripts/zuch/stock_ingame.mjs <outDir> [--trains a,b] [--route west] [--quality medium] */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const only = flag('trains', ''); const route = flag('route', 'west'); const quality = flag('quality', 'medium');
const outDir = args[0];
if (!outDir) { console.error('usage: stock_ingame.mjs <outDir> [--trains a,b]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const sim = await openSim({ quality });
try {
  const ids = only ? only.split(',') : await sim.page.evaluate(() => TS.config.trains.filter((t) => t.kind === 'rail').map((t) => t.id));
  for (const id of ids) {
    const r = id === 'hst' ? 'paris' : route;
    await sim.start(r, id, { lazy: true });
    const s0 = await sim.evalGame(({ track }) => track.stations[0].platformStart);
    await sim.viewCab({ s: s0 + 20, settle: 40 });
    await sim.shot(path.join(outDir, `${id}-cab.png`));
    const st = await sim.stats();
    console.log(JSON.stringify({ id, route: r, cabDraws: st.draws, cabTris: st.triangles }));
  }
  const errs = sim.errors.filter((e) => !/404/.test(e));
  if (errs.length) console.log('errors:', errs.slice(0, 8));
} finally { await sim.close(); }
