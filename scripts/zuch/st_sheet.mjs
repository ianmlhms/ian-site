/* Three standard views of several stations in ONE browser: cab 80 m before the platform, the platform seen from across the tracks, an aerial.
 *   node scripts/zuch/st_sheet.mjs <outDir> <routeId> <Station>[,<Station>...] [--quality medium] [--root <repo>]  -> <outDir>/<Station>-{cab,across,air}.png */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const [outDir, routeId, names] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  for (const name of names.split(',')) {
    const st = await sim.evalGame(({ track }, n) => {
      const i = track.stations.findIndex((s) => s.name === n); if (i < 0) return null;
      const s = track.stations[i]; const p = track.platformInfo(i);
      return { i, mid: (s.platformStart + s.platformEnd) / 2, ps: s.platformStart, side: s.side === 'right' ? 1 : -1, edge: p.edge, width: p.width, height: p.height };
    }, name);
    if (!st) { console.log('no station', name); continue; }
    const base = path.join(outDir, name.replace(/[^A-Za-z0-9]+/g, '_'));
    const sd = st.side;
    await sim.page.evaluate((ts) => { const w = __tsTest.internals().world; w.landscape.warm(ts); }, st.mid);
    await sim.loadScenery();
    await sim.viewCab({ s: st.ps - 80 }); await sim.shot(base + '-cab.png');
    await sim.view({ s: st.mid + 10, lat: -sd * 8.5, up: st.height + 1.7, yaw: sd > 0 ? -Math.PI / 2 : Math.PI / 2, pitch: -0.02, fov: 64, ahead: 40, trainS: st.mid - 600, settle: 30 }); await sim.shot(base + '-across.png');
    await sim.view({ s: st.mid - 70, lat: -sd * 75, up: 55, target: { s: st.mid, lat: sd * 10, up: 0 }, fov: 58, trainS: st.mid - 600, settle: 30 }); await sim.shot(base + '-air.png');
    console.log(name, JSON.stringify(st), JSON.stringify(await sim.stats()));
  }
  console.log('errors', sim.errors.filter((e) => !/404|groundAt/.test(e)).slice(0, 4));
} finally { await sim.close(); }
