/* Before / after pair at the Gare Centrale: the cab view and the Place de la Gare (views/luxembourg.json "place de la Gare").
 *   node scripts/zuch/lux_ab.mjs <outDir> <tag> [--root <repo>] [--quality medium] [--route wittlich] */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined); const quality = flag('quality', 'medium'); const route = flag('route', 'wittlich');
const [outDir, tag] = args;
const VIEWS = {
  cab: { cab: true },
  place: { pos: [-72, 150, 2.2], look: [-50, -30, 14], fov: 55 },
  forecourt: { pos: [-86, 70, 2.2], look: [-44, -24, 18], fov: 55 },
  top: { pos: [-72, 80, 210], look: [-72, 60, 0], fov: 60 },
  top2: { pos: [-72, 130, 120], look: [-72, 100, 0], fov: 70 },
  low: { pos: [-72, 150, 2.2], look: [-72, 100, 1], fov: 70 },
  air: { pos: [-60, 220, 95], look: [-20, -20, 0], fov: 60 },
};
const sim = await openSim({ quality, root });
try {
  await sim.start(route);
  const st = await sim.evalGame(({ track }) => { const s = track.stations.find((x) => x.name === 'Lëtzebuerg'); return { ps: s.platformStart, mid: (s.platformStart + s.platformEnd) / 2 }; });
  for (const [name, v] of Object.entries(VIEWS)) {
    if (v.cab) await sim.viewCab({ s: st.ps - 60 });
    else await sim.view({ s: st.mid - v.pos[1], lat: v.pos[0], up: v.pos[2], target: { s: st.mid - v.look[1], lat: v.look[0], up: v.look[2] }, fov: v.fov, trainS: st.mid - 170, settle: 30 });
    await sim.shot(path.join(outDir, `lux-${tag}-${name}.png`));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
