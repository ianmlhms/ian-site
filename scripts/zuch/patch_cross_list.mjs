/* node scripts/zuch/patch_cross_list.mjs <route>: the level crossings that live inside station patches (patch-crossings.js): station, s, road name, reach and steepest grade of the real road */
import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start(process.argv[2] || 'north');
  const rep = await sim.evalGame(({ track }) => {
    const plan = track.crossingRoads; if (!plan) return [];
    return plan.crossings.filter((c) => c.patch).map((c) => {
      let reach = [0, 0]; let grade = 0; let ymax = 0; let name = '';
      c.roads.forEach((r) => { name = name || (r.name || ''); r.pts.forEach((p, i) => { ymax = Math.max(ymax, Math.abs(p.yT)); reach[p.l >= 0 ? 0 : 1] = Math.max(reach[p.l >= 0 ? 0 : 1], Math.hypot(p.a, Math.abs(p.l))); if (i) { const q = r.pts[i - 1]; grade = Math.max(grade, Math.abs(p.yT - q.yT) / Math.max(0.5, Math.hypot(p.x - q.x, p.z - q.z))); } }); });
      const st = track.stations.find((s) => c.s > s.platformStart - 320 && c.s < s.platformEnd + 320);
      return { s: Math.round(c.s), station: st && st.name, road: name, reach: reach.map(Math.round), grade: Math.round(grade * 100), ymax: Math.round(ymax * 10) / 10, kinds: c.roads.map((r) => r.kind).join(',') };
    });
  });
  rep.forEach((r) => console.log(JSON.stringify(r)));
} finally { await sim.close(); }
