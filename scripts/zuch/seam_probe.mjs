/* node scripts/zuch/seam_probe.mjs <route> <seamS> [tol 0.05]: lateral columns of the strip vertices on both sides of a chunk seam (T-junctions show as columns present on one side only) */
import { openSim } from './zlib.mjs';
const [route, seamS, tol = '0.05'] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); __tsTest.internals().world.landscape.warm(ts); }, Number(seamS));
  await sim.frames(3);
  const r = await sim.page.evaluate(({ seamS, tol }) => {
    const { world } = __tsTest.internals(); const track = world.track.base || world.track;
    const f = track.frameAt(seamS);
    const out = {};
    world.landscape.terrainMeshes().forEach((m, mi) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + m.position.x, z = p.getZ(i) + m.position.z;
        const dx = x - f.pos.x, dz = z - f.pos.z;
        const along = dx * f.tangent.x + dz * f.tangent.z; const lat = dx * f.right.x + dz * f.right.z;
        if (Math.abs(along) < tol * 4 && Math.abs(lat) < 160) (out[mi] = out[mi] || []).push(+lat.toFixed(2));
      }
    });
    Object.keys(out).forEach((k) => out[k].sort((a, b) => a - b));
    return out;
  }, { seamS: Number(seamS), tol: Number(tol) });
  Object.entries(r).forEach(([k, v]) => console.log('mesh', k, v.length, 'columns:', JSON.stringify(v)));
} finally { await sim.close(); }
