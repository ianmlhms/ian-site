import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(process.argv[2] || 'east');
  const r = await sim.evalGame(({ track }) => { const out = []; track.crossingRoads.crossings.forEach((c) => c.roads.forEach((r) => r.pts.forEach((p, i) => { if (i) { const q = r.pts[i - 1]; const g = Math.abs(p.yT - q.yT) / Math.max(0.5, Math.hypot(p.x - q.x, p.z - q.z)); if (g > 0.11) out.push([Math.round(c.s), r.id, i, Math.round(g * 1000) / 10, Math.round(q.yT * 10) / 10, Math.round(p.yT * 10) / 10, Math.round(p.l)]); } }))); return out; });
  console.log(JSON.stringify(r));
} finally { await sim.close(); }
