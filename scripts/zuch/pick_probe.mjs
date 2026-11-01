/* What is at a pixel of the cab view?  node scripts/zuch/pick_probe.mjs <route> <s> <px> <py> [<px> <py> ...]  (1280x720 canvas; prints the picked mesh, its parents, world position and size) */
import { openSim } from './zlib.mjs';
const [route, s, ...px] = process.argv.slice(2);
const sim = await openSim({ quality: 'medium' });
try {
  await sim.start(route);
  await sim.viewCab({ s: Number(s) });
  for (let i = 0; i < px.length; i += 2) {
    const r = await sim.evalGame(({ scene, camera, THREE }, [x, y]) => {
      const el = document.querySelector('canvas').getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((x / el.width) * 2 - 1, -(y / el.height) * 2 + 1), camera);
      const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.visible).slice(0, 3);
      return hits.map((h) => { const chain = []; for (let o = h.object; o && chain.length < 6; o = o.parent) chain.push((o.name || o.type) + (o.userData && Object.keys(o.userData).length ? '{' + Object.keys(o.userData).slice(0, 4).join(',') + '}' : '')); return { d: +h.distance.toFixed(1), p: h.point.toArray().map((v) => +v.toFixed(1)), chain, mat: h.object.material && (h.object.material.name || h.object.material.type) }; });
    }, [Number(px[i]), Number(px[i + 1])]);
    console.log(px[i], px[i + 1], JSON.stringify(r));
  }
} finally { await sim.close(); }
