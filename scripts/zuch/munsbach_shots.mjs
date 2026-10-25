/* Munsbach photo-comparison viewpoints (same viewpoints as the Commons reference photos in ~/Library/Caches/zuch-refs/Munsbach).
 *   node scripts/zuch/munsbach_shots.mjs <outDir> [--route east] [--quality high] [--tag after] [--root <repo>]
 * Views are given in the station patch frame (x = lateral, + right of travel; z = along, ahead = negative; origin = platform middle). */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'high');
const routeId = flag('route', 'east');
const tag = flag('tag', 'run');
const root = flag('root', undefined);
const only = flag('only', '');
const [outDir] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const st = await sim.evalGame(({ track }) => {
    const i = track.stations.findIndex((s) => s.name === 'Munsbach'); const s = track.stations[i];
    return { mid: (s.platformStart + s.platformEnd) / 2, ps: s.platformStart, height: track.platformInfo(i).height, side: s.side === 'right' ? 1 : -1 };
  });
  const H = st.height, E = H + 1.7;
  // patch (x, z) -> s / lat
  const V = (x, z, up, tx, tz, tup, fov) => ({ s: st.mid - z, lat: x, up, target: { s: st.mid - tz, lat: tx, up: tup }, fov, trainS: st.mid - 160 });
  const views = {
    'p102-front': V(8.5, -82, E, -8, -82, 2.3, 62),
    'p01-oblique': V(7.6, -52, E, -7, -83, 2.3, 60),
    'p103-along': V(-1.5, 62, H + 1.9, -1.5, -40, H + 1.4, 62),
    'p104-backend': V(-19, -60, 1.7, -9, -82, 2.4, 58),
    'p-board-across': V(-5.2, -66, E, 7.4, -84, 1.6, 54),
    'p105-nameboard': V(-2.4, -30, E, 5.5, -64, 1.4, 50),
    'canopy-under': V(-4.0, -78, E, -7.2, -82, 3.4, 70),
    'platform-ahead': V(-2.6, -40, E, -2.6, -120, 1.2, 64),
    'crossing-from-platform': V(-2.4, -75, E, 0, -120, 1.5, 64),
    'crossing-cab': null,
    'crossing-road-east': V(42, -108, 1.9, 0, -108, 1.6, 60),
    'crossing-road-west': V(-42, -108, 1.9, 0, -108, 1.6, 60),
    'crossing-aerial': V(-30, -75, 28, 0, -108, 0, 62),
    'crossing-close': V(-14, -118, 2.2, 6, -108, 1.4, 66),
    'crossing-cab-near': { cab: true, sOffset: 108 - 60 },
    'crossing-cab-far': { cab: true, sOffset: 108 - 140 },
  };
  for (const [name, v] of Object.entries(views)) {
    if (only && !only.split(',').includes(name)) continue;
    if (!v) { await sim.viewCab({ s: st.mid + 22, settle: 40 }); }
    else if (v.cab) { await sim.viewCab({ s: st.mid + v.sOffset, settle: 40 }); }
    else await sim.view({ settle: 40, ...v });
    await sim.shot(path.join(outDir, `${tag}-${name}.png`));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
