/* node scripts/zuch/cab_pick.mjs <route> <train> <px,py> [px,py ...]: which cab mesh (name, bucket, local bbox) lies under these canvas pixels (2000x1251) */
import { openSim } from './zlib.mjs';
const [route, train, ...pts] = process.argv.slice(2);
const sim = await openSim({ quality: 'high', width: 2000, height: 1251 });
try {
  await sim.start(route, train);
  await sim.page.evaluate(() => __tsTest.placeAt(400, 9));
  await sim.frames(40);
  for (const p of pts) {
    const [x, y] = p.split(',').map(Number);
    const r = await sim.page.evaluate(([x, y]) => {
      const { world, camera, THREE } = __tsTest.internals();
      const rc = new THREE.Raycaster(); const c = document.querySelector('canvas').getBoundingClientRect();
      rc.setFromCamera(new THREE.Vector2((x / c.width) * 2 - 1, -(y / c.height) * 2 + 1), camera);
      const hits = rc.intersectObject(world.cab.group, true).slice(0, 3);
      return hits.map((h) => { h.object.geometry.computeBoundingBox(); const b = h.object.geometry.boundingBox; const chain = []; for (let o = h.object; o && o !== world.cab.group; o = o.parent) chain.push(o.name || o.type); return { d: +h.distance.toFixed(2), chain: chain.join('<'), pt: h.point.toArray().map((v) => +v.toFixed(2)), bb: [b.min, b.max].map((v) => v.toArray().map((q) => +q.toFixed(2))) }; });
    }, [x, y]);
    console.log(p, JSON.stringify(r));
  }
} finally { await sim.close(); }
