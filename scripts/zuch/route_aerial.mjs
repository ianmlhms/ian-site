/* Aerial screenshots along a route: node scripts/zuch/route_aerial.mjs <routeId> <outDir> <s0> <s1> <step> [--up 200] [--quality medium] */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const up = Number(flag('up', '200')); const quality = flag('quality', 'medium');
const [routeId, outDir, s0, s1, step] = args;
const sim = await openSim({ quality });
try {
  await sim.start(routeId);
  for (let s = Number(s0); s <= Number(s1); s += Number(step)) {
    await sim.view({ trainS: s, s: s - 60, lat: 0, up, target: { s: s + 120, lat: 0, up: 0 }, fov: 75, settle: 40 });
    await sim.shot(path.join(outDir, `aerial-${String(Math.round(s)).padStart(6, '0')}.png`));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 8));
} finally { await sim.close(); }
