/* Photo-match views of one station: free camera poses given in the STATION frame (ds = metres ahead of the platform middle, l = lateral towards the platform side (negative = across the tracks),
 * up = height above the rail, yaw = 0 along the travel direction, +90 = towards the platform side, pitch, fov), the train parked far behind (or --train s_off).
 *   node scripts/zuch/station_poses.mjs <outDir> <routeId> <stationName> <poses.json> [--tag x] [--quality medium] [--train -600]
 * poses.json: { "name": { "ds": 10, "l": -8, "up": 1.7, "yaw": 90, "pitch": 0, "fov": 60 }, ... }  or  { "name": { "ds":..., "l":..., "up":..., "target": { "ds":..., "l":..., "up":... }, "fov": 60 } } */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const tag = flag('tag', 'p'); const quality = flag('quality', 'medium'); const train = Number(flag('train', '-600')); const root = flag('root', undefined);
const [outDir, routeId, name, posesFile] = args;
const poses = JSON.parse(fs.readFileSync(posesFile, 'utf8'));
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const st = await sim.evalGame(({ track }, n) => { const s = track.stations.find((x) => x.name === n); return { mid: (s.platformStart + s.platformEnd) / 2, sd: s.side === 'right' ? 1 : -1, rev: !!track.reverse }; }, name);
  const base = path.join(outDir, `${name.replace(/[^A-Za-z0-9]+/g, '_')}-${tag}`);
  for (const [pn, p] of Object.entries(poses)) {
    const v = { s: st.mid + p.ds, lat: st.sd * p.l, up: p.up ?? 1.7, fov: p.fov || 60, trainS: st.mid + train, settle: 30 };
    if (p.target) v.target = { s: st.mid + p.target.ds, lat: st.sd * p.target.l, up: p.target.up ?? 1.5 };
    else { v.yaw = -st.sd * (p.yaw || 0) * Math.PI / 180; v.pitch = (p.pitch || 0) * Math.PI / 180; v.ahead = 60; }
    await sim.view(v);
    await sim.shot(`${base}-${pn}.png`);
  }
  console.log(JSON.stringify(st), 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 4));
} finally { await sim.close(); }
