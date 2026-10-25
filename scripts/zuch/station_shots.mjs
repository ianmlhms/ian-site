/* Screenshots of one station from the standard viewpoints (platform across the tracks, cab approach, forecourt, aerial, along the platform).
 *   node scripts/zuch/station_shots.mjs <outDir> <routeId> <stationName> [--quality high] [--root <repo>] [--tag name]
 * The viewpoints are chosen to match reference photos (platform view + forecourt/building). */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'high');
const root = flag('root', undefined);
const tag = flag('tag', '');
const [outDir, routeId, stationName] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const st = await sim.evalGame(({ track }, name) => {
    const i = track.stations.findIndex((s) => s.name === name);
    const s = track.stations[i];
    const pinfo = track.platformInfo(i);
    return { i, mid: (s.platformStart + s.platformEnd) / 2, ps: s.platformStart, pe: s.platformEnd, side: s.side === 'right' ? 1 : -1, edge: pinfo.edge, width: pinfo.width, height: pinfo.height };
  }, stationName);
  if (st.i < 0) throw new Error('station not found: ' + stationName);
  const sd = st.side;
  const toPlatform = sd > 0 ? -Math.PI / 2 : Math.PI / 2;      // yaw that looks to the platform side
  const base = path.join(outDir, `${stationName.replace(/[^A-Za-z0-9]+/g, '_')}${tag ? '-' + tag : ''}`);
  const views = {
    '1-across': { s: st.mid, lat: -sd * 8.5, up: st.height + 1.7, yaw: toPlatform, pitch: -0.02, fov: 60, ahead: 40 },
    '2-cab': { s: st.ps - 60, lat: 0, up: 2.9, yaw: 0, pitch: -0.03, fov: 62 },
    '3-forecourt': { s: st.mid, lat: sd * (st.edge + st.width + 24), up: 2.2, yaw: toPlatform + Math.PI, pitch: 0.0, fov: 62, ahead: 40 },
    '4-air': { s: st.mid - 60, lat: -sd * 70, up: 60, target: { s: st.mid, lat: sd * 10, up: 0 }, fov: 58 },
    '5-platform-along': { s: st.mid + 60, lat: sd * (st.edge + 2.2), up: st.height + 1.7, yaw: 0, pitch: -0.01, fov: 64 },
    '6-building-close': { s: st.mid, lat: -sd * 4.5, up: st.height + 1.6, yaw: toPlatform, pitch: -0.01, fov: 50, ahead: 40, },
  };
  for (const [name, v] of Object.entries(views)) {
    await sim.view({ trainS: st.mid - 160, settle: 30, ...v });
    await sim.shot(`${base}-${name}.png`);
  }
  console.log(JSON.stringify(st), 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
