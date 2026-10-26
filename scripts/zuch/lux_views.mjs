/* Gare Centrale review shots: node scripts/zuch/lux_views.mjs <outDir> <tag> [route=wittlich].  Free-camera views in the patch frame (x right of the track, z along, up above the rail head). */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const [outDir, tag, route = 'wittlich'] = process.argv.slice(2);
const VIEWS = {
  a_cab: { cab: true },
  b_platform1: { pos: [-4, 70, 1.8], look: [-5, -60, 4], fov: 64 },
  c_island: { pos: [12.5, 60, 1.8], look: [14, -60, 4], fov: 64 },
  d_hall: { pos: [38, 120, 2.0], look: [35, -80, 5], fov: 70 },
  e_tower: { pos: [-100, 30, 2.5], look: [-42, -25, 22], fov: 60 },
  f_forecourt: { pos: [-110, 85, 2.5], look: [-50, 0, 8], fov: 70 },
  g_tram: { pos: [-90, 20, 2.2], look: [-62, -10, 2], fov: 62 },
  h_air: { pos: [-60, 220, 95], look: [20, -20, 0], fov: 60 },
  i_across: { pos: [30, 10, 1.8], look: [-20, -10, 5], fov: 62 },
  j_back: { pos: [6, -150, 1.8], look: [6, 60, 4], fov: 64 },
};
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  const st = await sim.evalGame(({ track }) => { const i = track.stations.findIndex((s) => s.name === 'Lëtzebuerg'); const s = track.stations[i]; return { mid: (s.platformStart + s.platformEnd) / 2 }; });
  for (const [name, v] of Object.entries(VIEWS)) {
    if (v.cab) await sim.viewCab({ s: 0 });
    else await sim.view({ s: st.mid - v.pos[1], lat: v.pos[0], up: v.pos[2], target: { s: st.mid - v.look[1], lat: v.look[0], up: v.look[2] }, fov: v.fov, trainS: st.mid - 170, settle: 30 });
    await sim.shot(path.join(outDir, `lux-${tag}-${name}.png`));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
