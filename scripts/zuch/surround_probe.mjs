/* Which station patches are built near the player?  node scripts/zuch/surround_probe.mjs <routeId> <stationName> */
import { openSim } from './zlib.mjs';
const [routeId, name] = process.argv.slice(2);
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start(routeId);
  const st = await sim.evalGame(({ track }, n) => { const i = track.stations.findIndex((s) => s.name === n); const s = track.stations[i]; return { i, mid: (s.platformStart + s.platformEnd) / 2, side: s.side }; }, name);
  await sim.viewCab({ s: st.mid - 100, settle: 40 });
  const info = await sim.page.evaluate(() => {
    const { scene, track } = Object.assign(__tsTest.internals(), { track: __tsTest.trackInfo() });
    const names = []; scene.traverse((o) => { if (o.name && /station-surround/.test(o.name)) names.push(o.name); });
    return { names, patches: (track.surroundPatches || []).map((p) => [p.name, Math.round(p.sMid)]), reverse: !!track.reverse, len: Math.round(track.length) };
  });
  console.log(JSON.stringify(st), JSON.stringify(info), sim.errors.filter((e) => !/404/.test(e)).slice(0, 4));
} finally { await sim.close(); }
