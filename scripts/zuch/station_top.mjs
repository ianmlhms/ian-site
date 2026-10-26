/* Top-down view of a station twice: the photo model alone, and with the real LOD2 station building of the patch drawn too (TS.debugStationLod2), to check the side and position of the model.
 *   node scripts/zuch/station_top.mjs <outDir> <routeId> <stationName> [--up 90] [--shift 0]   -> <outDir>/<Station>-top-model.png, -top-lod2.png */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const up = Number(flag('up', '90')); const shift = Number(flag('shift', '0'));
const [outDir, routeId, name] = args;
for (const lod2 of [false, true]) {
  const sim = await openSim({ quality: 'high' });
  try {
    if (lod2) await sim.page.evaluate(() => { window.TS.debugStationLod2 = true; });
    await sim.start(routeId);
    const st = await sim.evalGame(({ track }, n) => { const s = track.stations.find((x) => x.name === n); return { mid: (s.platformStart + s.platformEnd) / 2, side: s.side === 'right' ? 1 : -1 }; }, name);
    await sim.view({ s: st.mid + shift - 0.1, lat: 0, up, target: { s: st.mid + shift - 40, lat: 0, up: 0 }, fov: 55, trainS: st.mid - 400, settle: 40 });
    await sim.page.evaluate(({ mid, shift, up }) => { const { THREE } = __tsTest.internals(); const t = __tsTest.trackInfo(); const f = t.frameAt(mid + shift); __tsTest.setFreeCam({ pos: [f.pos.x, f.pos.y + up, f.pos.z], look: [f.pos.x + 0.001, f.pos.y, f.pos.z + 0.001], fov: 55 }); }, { mid: st.mid, shift, up });
    await sim.frames(20);
    await sim.shot(path.join(outDir, `${name.replace(/[^A-Za-z0-9]+/g, '_')}-top-${lod2 ? 'lod2' : 'model'}.png`));
    if (!lod2) console.log(JSON.stringify(st));
  } finally { await sim.close(); }
}
