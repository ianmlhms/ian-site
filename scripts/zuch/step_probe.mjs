/* Where does the drawn terrain strip differ from the terrain function? (W5 roads2: hole scan "step" findings on steep valley sides)
 *   node scripts/zuch/step_probe.mjs <route> <s> <latCentre> [--half 30] [--step 1] [--along 40] [--quality medium]
 * Casts vertical rays on a lateral line through (s + 0.37, latCentre +- half) and along s through (latCentre) and prints the worst differences with the terrain
 * vertex columns / rows next to them.  Run through python3 ~/Library/Caches/browser-slot.py. */
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const half = Number(flag('half', '30')); const step = Number(flag('step', '1')); const along = Number(flag('along', '40')); const quality = flag('quality', 'medium');
const [route, sArg, latArg] = args;
const sim = await openSim({ quality });
try {
  await sim.start(route);
  const s = Number(sArg); const lat0 = Number(latArg);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, s);
  await sim.frames(4);
  const res = await sim.page.evaluate(({ s, lat0, half, step, along }) => {
    const { world, THREE } = __tsTest.internals();
    const track = world.track.base || world.track;
    const meshes = world.landscape.terrainMeshes();
    const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
    const diff = (sx, lat) => {
      const f = track.frameAt(sx);
      const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
      const y = world.landscape.groundHeightAt(x, z);
      rc.set(new THREE.Vector3(x, y + 80, z), down);
      const hit = rc.intersectObjects(meshes, false)[0];
      return hit ? Math.round((hit.point.y - y) * 100) / 100 : null;
    };
    const func = (sx, lat) => { const f = track.frameAt(sx); return Math.round(world.landscape.groundHeightAt(f.pos.x + f.right.x * lat, f.pos.z + f.right.z * lat) * 100) / 100; };
    const lateral = []; for (let l = lat0 - half; l <= lat0 + half + 1e-6; l += step) lateral.push([Math.round(l * 10) / 10, diff(s + 0.37, l)]);
    const alongS = []; for (let d = -along; d <= along + 1e-6; d += step * 2) alongS.push([Math.round((s + d) * 10) / 10, diff(s + d + 0.37, lat0)]);
    // vertex columns / rows of the terrain meshes near the point (lateral offsets of the mesh vertices on the row nearest to s)
    const f = track.frameAt(s);
    const cols = new Set(); const rows = new Set();
    meshes.forEach((m) => {
      const p = m.geometry.attributes.position; m.updateWorldMatrix(true, false);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i); const z = p.getZ(i);
        const q = track.nearest(x, z);
        if (Math.abs(q.s - s) < 14 && Math.abs(q.lat - lat0) < half + 5) cols.add(Math.round(q.lat * 10) / 10);
        if (Math.abs(q.lat - lat0) < 3 && Math.abs(q.s - s) < along + 10) rows.add(Math.round(q.s * 10) / 10);
      }
    });
    const funcAlong = alongS.map(([sx]) => [sx, func(sx + 0.37, lat0)]);
    return { lateral, alongS, funcAlong, cols: Array.from(cols).sort((a, b) => a - b), rows: Array.from(rows).sort((a, b) => a - b), relief: world.track.real ? null : null };
  }, { s, lat0, half, step, along });
  const worst = (list) => list.filter(([, d]) => d !== null).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  console.log('lateral worst', JSON.stringify(worst(res.lateral)));
  console.log('along worst', JSON.stringify(worst(res.alongS)));
  console.log('misses lateral', res.lateral.filter(([, d]) => d === null).length, 'along', res.alongS.filter(([, d]) => d === null).length);
  if (process.env.DUMP) console.log('function along s', JSON.stringify(res.funcAlong));
  console.log('columns', res.cols.join(' '));
  console.log('rows', res.rows.join(' '));
} finally { await sim.close(); }
