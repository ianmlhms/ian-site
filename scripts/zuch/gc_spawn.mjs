/* Gare Centrale spawn check: for each route (and its '~r' return) starts the service and shoots the three game cameras at the real spawn pose (cab, chase, platform)
 * plus a free aerial. usage: node scripts/zuch/gc_spawn.mjs <outDir> <routeId[,routeId...]> [--root <repo>] [--end] */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };
const root = flag('root', undefined);
const atEnd = bool('end');
const [outDir, routes] = args;
const sim = await openSim({ quality: 'medium', root });
try {
  for (const id of routes.split(',')) {
    await sim.start(id);
    const info = await sim.evalGame(({ track }) => {
      const st = __tsTest.state();
      return { s: st.s, stations: st.stations.map((x) => x.name + '@' + Math.round(x.s)), side: track.stations.map((x) => x.name + ':' + x.side + ':' + Math.round(x.platformStart) + '-' + Math.round(x.platformEnd)).slice(0, 2) };
    });
    console.log(id, JSON.stringify(info));
    const idx = await sim.evalGame(({ track }) => { const i = track.stations.findIndex((s) => /Lëtzebuerg/.test(s.name)); const s = track.stations[i]; return { i, ps: s.platformStart, pe: s.platformEnd, s: s.s, n: track.stations.length }; });
    if (atEnd) await sim.page.evaluate((s) => __tsTest.placeAt(s, 0), idx.s - 1);   // the stop marker
    for (const cam of ['cab', 'chase', 'platform']) {
      await sim.page.evaluate((c) => __tsTest.setCamera(c), cam);
      await sim.frames(40);
      await sim.shot(path.join(outDir, `${id.replace('~', 'R')}-${cam}.png`));
    }
    await sim.page.evaluate(() => __tsTest.setCamera('cab'));
    console.log(id, 'stats', JSON.stringify(await sim.stats()));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
