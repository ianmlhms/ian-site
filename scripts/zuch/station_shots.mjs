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
const focusZ = Number(flag('focusZ', '0'));          // patch z (m, ahead = negative) of the station building / the thing to look at
const fcLat = Number(flag('forecourtLat', '16'));    // lateral distance behind the platform kerb for the forecourt view
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
  const sf = st.mid - focusZ;          // arc length of the focus point
  const views = {
    '1-across': { s: sf + 8, lat: -sd * 8.5, up: st.height + 1.7, yaw: toPlatform, pitch: -0.02, fov: 62, ahead: 40 },
    '2-cab': { cab: true, s: st.ps - 90 },
    '3-forecourt': { s: sf + 22, lat: sd * (st.edge + st.width + fcLat), up: 1.9, target: { s: sf, lat: sd * 8, up: 2.0 }, fov: 62 },
    '4-air': { s: sf - 70, lat: -sd * 70, up: 60, target: { s: sf, lat: sd * 10, up: 0 }, fov: 58 },
    '5-platform-along': { s: sf + 70, lat: sd * (st.edge + 1.4), up: st.height + 1.7, yaw: 0, pitch: -0.01, fov: 64 },
    '6-building-close': { s: sf + 4, lat: -sd * 4.5, up: st.height + 1.6, yaw: toPlatform, pitch: -0.01, fov: 50, ahead: 40 },
    '8-bikebox': { s: sf - 12, lat: sd * (st.edge + st.width + 7), up: 1.7, target: { s: sf + 8, lat: sd * 8, up: 1.5 }, fov: 58 },
    '9-along-far': { s: st.mid - focusZ + 48, lat: -sd * 7.6, up: st.height + 1.7, yaw: Math.PI, pitch: -0.01, fov: 62 },
    '7-wide': { s: sf + 120, lat: -sd * 40, up: 14, target: { s: sf - 20, lat: sd * 12, up: 3 }, fov: 62 },
  };
  const stats = {};
  for (const [name, v] of Object.entries(views)) {
    if (v.cab) await sim.viewCab({ s: v.s });
    else await sim.view({ trainS: st.mid - 160, settle: 30, ...v });
    await sim.shot(`${base}-${name}.png`);
    stats[name] = await sim.stats();
  }
  console.log(JSON.stringify(stats), JSON.stringify(st), 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
