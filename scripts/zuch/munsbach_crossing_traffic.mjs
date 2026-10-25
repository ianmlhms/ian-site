/* Munsbach level crossing with the barriers closed and the traffic queueing: screenshots + the traffic state.
 *   node scripts/zuch/munsbach_crossing_traffic.mjs <outDir> [--route east] [--tag a1] */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const routeId = flag('route', 'east'); const tag = flag('tag', 'run'); const quality = flag('quality', 'high');
const [outDir] = args;
const sim = await openSim({ quality });
try {
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }) => { const m = track.stations.find((s) => s.name === 'Munsbach'); const mid = (m.platformStart + m.platformEnd) / 2; const c = track.crossings.find((x) => x.patch && Math.abs(x.s - mid) < 300); return { s: c ? c.s : null, mid }; });
  if (info.s === null) throw new Error('no patch crossing near Munsbach');
  const sc = info.s;
  await sim.evalGame(({ world }, s) => { world.landscape.setCrossing(s, true); }, sc);
  await sim.view({ s: sc, lat: 30, up: 3.2, target: { s: sc, lat: 0, up: 1.2 }, fov: 58, trainS: sc - 300, settle: 10 });
  for (let k = 0; k < 40; k++) await sim.frames(30);          // let the vehicles arrive and queue
  const st = await sim.evalGame(({ world }, s) => { const t = world.landscape.crossingTraffic().state().find((x) => Math.abs(x.s - s) < 3); return t ? { closed: t.closed, queue: t.lanes.map((l) => l.cars.length) } : null; }, sc);
  console.log('traffic', JSON.stringify(st));
  await sim.shot(path.join(outDir, `${tag}-crossing-closed-east.png`));
  await sim.view({ s: sc - 3, lat: -34, up: 3.4, target: { s: sc, lat: 0, up: 1.2 }, fov: 58, trainS: sc - 300, settle: 10 });
  await sim.shot(path.join(outDir, `${tag}-crossing-closed-west.png`));
  await sim.view({ s: sc - 45, lat: 14, up: 24, target: { s: sc, lat: 0, up: 0 }, fov: 58, trainS: sc - 300, settle: 10 });
  await sim.shot(path.join(outDir, `${tag}-crossing-closed-aerial.png`));
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
