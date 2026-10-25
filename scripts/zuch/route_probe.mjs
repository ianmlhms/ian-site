/* Starts a route and prints its basics: length, stations (s), crossings, bridges, tunnels, errors.   node scripts/zuch/route_probe.mjs <routeId> [--shots <dir> --every 1500] */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const shots = flag('shots', ''); const every = Number(flag('every', '1500')); const quality = flag('quality', 'medium');
const [routeId] = args;
const sim = await openSim({ quality });
try {
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }) => ({ length: track.length, stations: track.stations.map((s) => [s.name, Math.round(s.platformStart)]), crossings: (track.crossings || []).map((c) => Math.round(c.s)), bridges: track.bridges.map((b) => [Math.round(b.s0), Math.round(b.s1), b.kind, b.h]), tunnels: track.tunnels.map((t) => [Math.round(t.s0), Math.round(t.s1)]) }));
  console.log(JSON.stringify(info));
  if (shots) for (let s = 100; s < info.length; s += every) { await sim.viewCab({ s }); await sim.shot(path.join(shots, `cab-${String(Math.round(s)).padStart(6, '0')}.png`)); }
  console.log('errors', sim.errors.slice(0, 10));
} finally { await sim.close(); }
