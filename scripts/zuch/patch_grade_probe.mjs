/* Which patch crossings have steep road polylines?  node scripts/zuch/patch_grade_probe.mjs <route> */
import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start(process.argv[2] || 'wittlich');
  const rep = await sim.evalGame(({ track }) => {
    const out = [];
    track.crossingRoads.crossings.forEach((c) => {
      if (!c.patch) return;
      c.roads.forEach((r) => {
        let worst = 0; let at = 0;
        r.pts.forEach((p, i) => { if (i > 0) { const q = r.pts[i - 1]; const g = Math.abs(p.yT - q.yT) / Math.max(0.5, Math.hypot(p.x - q.x, p.z - q.z)); if (g > worst) { worst = g; at = i; } } });
        out.push({ s: Math.round(c.s), name: c.patchName, road: r.id, n: r.pts.length, worst: +(worst * 100).toFixed(1), at, len: Math.round(r.len) });
      });
    });
    return out;
  });
  rep.forEach((r) => console.log(JSON.stringify(r)));
} finally { await sim.close(); }
