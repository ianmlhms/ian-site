/* Tree look screenshots: cab + side views at stations and a forest leg.
 *   node scripts/zuch/tree_shots.mjs <outDir> <routeId> [--quality high] [--tag before] [--root <repo>] [--stations Munsbach,Oetrange]
 * Files: <outDir>/<tag>-<place>-<view>.png */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'high');
const root = flag('root', undefined);
const tag = flag('tag', 'run');
const stationNames = flag('stations', 'Munsbach,Oetrange').split(',');
const [outDir, routeId = 'east'] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }, names) => {
    const stations = names.map((name) => {
      const i = track.stations.findIndex((s) => s.name === name); if (i < 0) return null;
      const s = track.stations[i];
      return { name, ps: s.platformStart, pe: s.platformEnd, mid: (s.platformStart + s.platformEnd) / 2, side: s.side === 'right' ? 1 : -1, height: track.platformInfo(i).height };
    }).filter(Boolean);
    const forest = [];
    for (let s = 200; s < track.length - 200; s += 100) { const b = track.biomeAt(s); if (b === 'forest' || b === 'ardennes') forest.push(s); }
    return { stations, forest };
  }, stationNames);
  const shot = async (name, v) => {
    if (v.cab) await sim.viewCab({ s: v.s, settle: 40 }); else await sim.view({ trainS: v.trainS ?? v.s - 150, settle: 40, ...v });
    await sim.shot(path.join(outDir, `${tag}-${name}.png`));
  };
  for (const st of info.stations) {
    const sd = st.side, key = st.name.replace(/[^A-Za-z0-9]+/g, '_');
    await shot(`${key}-cab`, { cab: true, s: st.ps - 70 });
    await shot(`${key}-cab2`, { cab: true, s: st.pe + 120 });
    await shot(`${key}-platform`, { s: st.mid + 60, lat: sd * 5.6, up: st.height + 1.7, yaw: 0, pitch: -0.01, fov: 64 });
    await shot(`${key}-side`, { s: st.mid - 40, lat: -sd * 34, up: 4, yaw: -sd * 0.0, target: { s: st.mid + 30, lat: -sd * 60, up: 4 }, fov: 60 });
    await shot(`${key}-air`, { s: st.mid - 60, lat: -sd * 60, up: 45, target: { s: st.mid, lat: sd * 20, up: 0 }, fov: 58 });
  }
  if (info.forest.length) {
    const s = info.forest[Math.floor(info.forest.length / 2)];
    await shot('forest-cab', { cab: true, s });
    await shot('forest-side', { s: s, lat: 10, up: 3, target: { s: s + 40, lat: 45, up: 4 }, fov: 62 });
    await shot('forest-close', { s: s + 20, lat: 14, up: 2.2, target: { s: s + 20, lat: 40, up: 4 }, fov: 55 });
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
