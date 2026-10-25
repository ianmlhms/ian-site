import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(process.argv[2] || 'east');
  const r = await sim.evalGame(({ track }) => track.crossingRoads.crossings.filter((c) => c.patch).map((c) => ({ s: Math.round(c.s), roads: c.roads.map((r) => ({ id: r.id, n: r.pts.length, len: Math.round(r.len), last: r.pts.length ? [Math.round(r.pts[r.pts.length - 1].a), Math.round(r.pts[r.pts.length - 1].l)] : null })), arms: Object.fromEntries(Object.entries(c.arms).map(([k, v]) => [k, v.length])), road: c.road.length, roadX: [Math.min(...c.road.map((p) => p.x)), Math.max(...c.road.map((p) => p.x))] })));
  console.log(JSON.stringify(r, null, 1));
} finally { await sim.close(); }
