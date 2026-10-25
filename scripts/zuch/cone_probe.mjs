/* node scripts/zuch/cone_probe.mjs <route> <s> <lat> <up> <worldX> <worldZ> <halfWidthM>: view rays from a camera point toward a world point: which meshes does the ray hit; misses against the strip + far meshes */
import { openSim } from './zlib.mjs';
const [route, s, lat, up, wx, wz, hw = '3'] = process.argv.slice(2);
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, Number(s));
  await sim.frames(3);
  const r = await sim.page.evaluate(({ s, lat, up, wx, wz, hw }) => {
    const { world, THREE } = __tsTest.internals();
    const track = world.track.base || world.track;
    const f = track.frameAt(s);
    const cam = new THREE.Vector3().copy(f.pos).addScaledVector(f.right, lat); cam.y += up;
    const ls = world.landscape; const meshes = ls.terrainMeshes();
    const rc = new THREE.Raycaster();
    let miss = 0, n = 0; const pts = [];
    const gy = ls.groundHeightAt(wx, wz);
    for (let dx = -hw; dx <= hw; dx += 0.1) for (let dz = -hw; dz <= hw; dz += 0.1) {
      const tgt = new THREE.Vector3(wx + dx, ls.groundHeightAt(wx + dx, wz + dz), wz + dz);
      rc.set(cam, tgt.clone().sub(cam).normalize());
      const hit = rc.intersectObjects(meshes, false)[0]; n++;
      if (!hit || hit.point.distanceTo(tgt) > 0.6) { miss++; if (pts.length < 8) pts.push([Math.round((wx + dx) * 10) / 10, Math.round((wz + dz) * 10) / 10, hit ? Math.round(hit.distance * 10) / 10 : null, Math.round(tgt.distanceTo(cam))]); }
    }
    return { cam: [cam.x, cam.y, cam.z], gy, n, miss, pts, meshCount: meshes.length };
  }, { s: Number(s), lat: Number(lat), up: Number(up), wx: Number(wx), wz: Number(wz), hw: Number(hw) });
  console.log(JSON.stringify(r));
} finally { await sim.close(); }
