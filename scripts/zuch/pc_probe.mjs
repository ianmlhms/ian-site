import { openSim } from '/Users/Ian/Library/Caches/website-zstations/scripts/zuch/zlib.mjs';
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start('brussels');
  const r = await sim.evalGame(({ track }) => (track.crossingRoads ? track.crossingRoads.crossings : []).filter((c) => c.patch).map((c) => ({ name: c.patchName, s: Math.round(c.s), roads: c.roads.length, pts: c.roads.map((r) => r.pts.length), len: c.roads.map((r) => Math.round(r.len)) })));
  console.log(JSON.stringify(r));
} finally { await sim.close(); }
