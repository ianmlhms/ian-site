/* Draw calls / triangles at the standard perf viewpoints (Munsbach cab, Munsbach aerial, forest-leg cab, crossing cab).
 *   node scripts/zuch/perf_probe.mjs <routeId> [--quality high] [--root <repo>] [--shots <dir>] [--tag before] [--station Munsbach]
 * Prints one JSON line: { quality, points: { name: { draws, triangles, tris, treeTris, s } } } (renderer.info of the last frame, shadow pass included). */
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'high');
const root = flag('root', undefined);
const shots = flag('shots', '');
const tag = flag('tag', 'run');
const stationName = flag('station', 'Munsbach');
const scanStep = Number(flag('scan', '0'));          // > 0: also measure the cab view every <scanStep> m along the route and print the worst 8
const [routeId = 'east'] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }, name) => {
    const i = track.stations.findIndex((s) => s.name === name);
    const st = track.stations[i];
    const forest = [];
    for (let s = 200; s < track.length - 200; s += 100) { const b = track.biomeAt(s); if (b === 'forest' || b === 'ardennes') forest.push(s); }
    return { i, ps: st.platformStart, pe: st.platformEnd, mid: (st.platformStart + st.platformEnd) / 2, side: st.side === 'right' ? 1 : -1, height: track.platformInfo(i).height,
      crossings: (track.crossings || []).map((c) => c.s), forest, length: track.length };
  }, stationName);
  if (info.i < 0) throw new Error('station not found');
  // forest leg: the middle of the longest run of forest samples
  let best = [], cur = [];
  info.forest.forEach((s, k) => { if (k && s - info.forest[k - 1] > 150) { if (cur.length > best.length) best = cur; cur = []; } cur.push(s); });
  if (cur.length > best.length) best = cur;
  const forestS = best.length ? best[Math.floor(best.length / 2)] : null;
  const crossS = info.crossings.length ? info.crossings[0] : null;
  const measure = async (name, s, setup) => {
    await setup();
    await sim.frames(20);
    const m = await sim.evalGame(({ world }) => { const st = world.landscape.stats(); return { tris: st.triangles, meshes: st.meshes, chunks: st.chunks }; });
    const r = await sim.stats();
    if (shots) await sim.shot(path.join(shots, `${tag}-${quality}-${name}.png`));
    return { s: Math.round(s), draws: r.draws, triangles: r.triangles, landscapeTris: m.tris, landscapeMeshes: m.meshes, chunks: m.chunks };
  };
  const points = {};
  points.munsbachCab = await measure('munsbach-cab', info.ps - 60, () => sim.viewCab({ s: info.ps - 60 }));
  points.munsbachAir = await measure('munsbach-air', info.mid, () => sim.view({ s: info.mid - 70, lat: -info.side * 70, up: 60, target: { s: info.mid, lat: info.side * 10, up: 0 }, fov: 58, trainS: info.mid - 160, settle: 30 }));
  if (forestS !== null) points.forestCab = await measure('forest-cab', forestS, () => sim.viewCab({ s: forestS }));
  if (crossS !== null) points.crossingCab = await measure('crossing-cab', crossS - 90, () => sim.viewCab({ s: crossS - 90 }));
  if (scanStep > 0) {
    const all = [];
    for (let s = 150; s < info.length - 100; s += scanStep) {
      await sim.viewCab({ s, settle: 12 });
      const r = await sim.stats();
      all.push({ s, draws: r.draws, triangles: r.triangles });
    }
    all.sort((a, b) => b.triangles - a.triangles);
    points.scanWorst = all.slice(0, 8);
    points.scanMax = all[0];
    points.scanMean = { draws: Math.round(all.reduce((a, b) => a + b.draws, 0) / all.length), triangles: Math.round(all.reduce((a, b) => a + b.triangles, 0) / all.length) };
  }
  console.log(JSON.stringify({ route: routeId, quality, points }));
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 6));
} finally { await sim.close(); }
