/* W3 view helper: node scripts/zuch/w3_views.mjs <route> <outDir> [--quality medium] [--tag t] spec...
 * spec = "Station:dz:lat:up:yaw:pitch:fov[:name]"  (dz = metres along the track from the station middle, lat to the right, yaw in degrees, + = left)
 *      or "s=1234:lat:up:yaw:pitch:fov[:name]" for an absolute s.  Prints the station list when no spec is given. */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const tag = flag('tag', 'v');
const [routeId, outDir, ...specs] = args;
const sim = await openSim({ quality });
try {
  await sim.start(routeId);
  const st = await sim.evalGame(({ track }) => track.stations.map((s) => ({ n: s.name, a: Math.round(s.platformStart), b: Math.round(s.platformEnd), side: s.side })));
  if (!specs.length) console.log(JSON.stringify(st));
  for (const spec of specs) {
    const p = spec.split(':');
    let s; let rest;
    if (p[0].startsWith('s=')) { s = Number(p[0].slice(2)); rest = p.slice(1); } else { const x = st.find((q) => q.n === p[0]); if (!x) { console.log('no station', p[0]); continue; } s = (x.a + x.b) / 2 + Number(p[1]); rest = p.slice(2); }
    const [lat = 0, up = 3, yaw = 0, pitch = 0, fov = 60, name] = rest;
    await sim.view({ s, trainS: s, lat: Number(lat), up: Number(up), yaw: Number(yaw) * Math.PI / 180, pitch: Number(pitch) * Math.PI / 180, fov: Number(fov), settle: 40 });
    const stats = await sim.stats();
    const f = path.join(outDir, `${tag}-${name || spec.replace(/[^\w]+/g, '_')}.png`);
    await sim.shot(f);
    console.log(f, JSON.stringify(stats));
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
