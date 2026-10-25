/* node scripts/zuch/ray_probe.mjs <route> <s> [latFrom latTo latStep]: terrain mesh vs terrain function across the strip at s */
import { openSim } from './zlib.mjs';
const [route, sArg, a = '-40', b = '40', st = '2'] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  const s = Number(sArg);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, s);
  await sim.frames(2);
  const rows = await sim.page.evaluate(({ s, a, b, st }) => {
    const { world, THREE } = __tsTest.internals();
    const track = world.track.base || world.track;
    const meshes = world.landscape.terrainMeshes();
    const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
    const out = [];
    for (const ds of [0, 10]) {
      const f = track.frameAt(s + 0.37 + ds);
      for (let lat = a; lat <= b; lat += st) {
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        const y = world.landscape.groundHeightAt(x, z);
        rc.set(new THREE.Vector3(x, y + 60, z), down);
        const hit = rc.intersectObjects(meshes, false)[0];
        out.push([ds, lat, Math.round(y * 100) / 100, hit ? Math.round(hit.point.y * 100) / 100 : null, hit ? Math.round((hit.point.y - y) * 100) / 100 : null, Math.round(x), Math.round(z)]);
      }
    }
    return out;
  }, { s, a: Number(a), b: Number(b), st: Number(st) });
  rows.forEach((r) => console.log(r.join('\t')));
} finally { await sim.close(); }
