/* debug: describe the sites of a route at given s (info.sides, road ids, lane joint gaps).  node scripts/zuch/gap_debug.mjs <route> <s> [<s> ...] */
import { openSim } from './zlib.mjs';
const [route, ...ss] = process.argv.slice(2);
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start(route);
  const out = await sim.evalGame(({ track, world }, want) => {
    const traffic = world.landscape.crossingTraffic();
    return traffic.sites.filter((st) => want.some((s) => Math.abs(st.s - s) < 3)).map((st) => ({
      s: st.s, info: st.c.info, roads: st.c.roads.map((r) => ({ id: r.id, role: r.role, kind: r.kind, n: r.pts.length, first: [Math.round(r.pts[0].a), Math.round(r.pts[0].l)], last: [Math.round(r.pts[r.pts.length - 1].a), Math.round(r.pts[r.pts.length - 1].l)] })),
      gaps: st.lanes.map((ln, k) => { const g = []; const P = ln.bikePts; P.forEach((p, i) => { if (i && Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) > 4.5) g.push({ i, d: Math.round(Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) * 10) / 10 }); }); return { k, from: ln.from, n: P.length, g }; }).filter((q) => q.g.length),
    }));
  }, ss.map(Number));
  console.log(JSON.stringify(out, null, 1));
} finally { await sim.close(); }
