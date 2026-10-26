/* Do the shared-tail hills match between two services?  node scripts/zuch/tail_hills_probe.mjs
 * Samples groundHeightAt along the tail legs (B..) at fixed (s, lat) on 'wittlich' and 'trier' and prints the largest difference. */
import { openSim } from './zlib.mjs';
const out = {};
for (const route of ['wittlich', 'trier']) {
  const sim = await openSim({ quality: 'medium' });
  try {
    await sim.start(route);
    out[route] = await sim.evalGame(({ track, world }) => {
      const hafe = track.stations.find((s) => s.name === 'Tréier Hafestrooss');
      const sch = track.stations.find((s) => s.name === 'Schweich');
      const rows = [];
      for (let s = hafe.platformStart; s < sch.platformStart; s += 150) for (const lat of [-120, -60, 60, 120, 240]) {
        const f = track.frameAt(s);
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        rows.push([Math.round(s - hafe.platformStart), lat, +(world.landscape.groundHeightAt(x, z) - f.pos.y).toFixed(2)]);
      }
      return rows;
    });
  } finally { await sim.close(); }
}
let worst = 0;
out.wittlich.forEach((r, i) => { const d = Math.abs(r[2] - out.trier[i][2]); if (d > worst) worst = d; });
const big = out.wittlich.map((r, i) => [r, out.trier[i]]).filter(([a, b]) => Math.abs(a[2] - b[2]) > 0.8).slice(0, 12); console.log('big', JSON.stringify(big));
console.log('samples', out.wittlich.length, 'max |dy| between services (relative to rail):', worst.toFixed(2), 'm');
console.log(JSON.stringify(out.wittlich.slice(0, 6)), JSON.stringify(out.trier.slice(0, 6)));
