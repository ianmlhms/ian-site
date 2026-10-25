/* node scripts/zuch/miss_probe.mjs <route> <s0> <s1> <lat0> <lat1> [step 0.7]: dense vertical rays against the strip mesh, prints misses / steps */
import { openSim } from './zlib.mjs';
const [route, s0, s1, l0, l1, st = '0.7'] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, Number(s0));
  await sim.frames(2);
  const r = await sim.page.evaluate(({ s0, s1, l0, l1, st }) => {
    const { world, THREE } = __tsTest.internals();
    const track = world.track.base || world.track;
    const meshes = world.landscape.terrainMeshes();
    const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
    const out = []; let n = 0;
    for (let s = s0; s <= s1; s += st) {
      const f = track.frameAt(s);
      for (let lat = l0; lat <= l1; lat += st) {
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        const y = world.landscape.groundHeightAt(x, z);
        rc.set(new THREE.Vector3(x, y + 60, z), down);
        const hit = rc.intersectObjects(meshes, false)[0];
        n += 1;
        if (!hit) out.push([Math.round(s * 10) / 10, Math.round(lat * 10) / 10, 'miss']);
        else if (Math.abs(hit.point.y - y) > 0.5) out.push([Math.round(s * 10) / 10, Math.round(lat * 10) / 10, Math.round((hit.point.y - y) * 100) / 100]);
      }
    }
    return { n, out: out.slice(0, 40), total: out.length };
  }, { s0: Number(s0), s1: Number(s1), l0: Number(l0), l1: Number(l1), st: Number(st) });
  console.log(r.n, 'rays', r.total, 'bad'); r.out.forEach((o) => console.log(o.join('\t')));
} finally { await sim.close(); }
