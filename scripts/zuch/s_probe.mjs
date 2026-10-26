/* mesh vs terrain function along s at a fixed lat: node scripts/zuch/s_probe.mjs <route> <lat> <s0> <s1> <step> */
import { openSim } from './zlib.mjs';
const [route, lat, s0, s1, st] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, Number(s0));
  await sim.frames(3);
  const rows = await sim.page.evaluate(({ lat, s0, s1, st }) => {
    const { world, THREE } = __tsTest.internals();
    const track = world.track.base || world.track;
    const meshes = world.landscape.terrainMeshes();
    const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
    const out = [];
    for (let s = s0; s <= s1; s += st) {
      const f = track.frameAt(s);
      const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
      const y = world.landscape.groundHeightAt(x, z);
      rc.set(new THREE.Vector3(x, y + 60, z), down);
      const hit = rc.intersectObjects(meshes, false)[0];
      out.push([s, Math.round(y * 100) / 100, hit ? Math.round((hit.point.y - y) * 100) / 100 : null]);
    }
    return out;
  }, { lat: Number(lat), s0: Number(s0), s1: Number(s1), st: Number(st) });
  rows.forEach((r) => console.log(r.join('\t')));
} finally { await sim.close(); }
