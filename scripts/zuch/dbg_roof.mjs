import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'high' });
try {
  await sim.start('wittlich');
  const out = await sim.evalGame(({ scene }) => {
    const res = [];
    scene.traverse((o) => { if (o.name && o.name.startsWith('station-surround-Lëtz')) o.children.forEach((m) => { if (!m.isMesh) return; const n = m.geometry.attributes.normal; const c = m.material.color; res.push({ tris: m.geometry.index.count / 3, mat: m.material.type, color: c ? c.getHexString() : null, map: !!m.material.map, vc: !!m.material.vertexColors, n0: n ? [n.getX(0), n.getY(0), n.getZ(0)].map((v) => +v.toFixed(2)) : null, rs: m.receiveShadow }); }); });
    return res;
  });
  console.log(JSON.stringify(out, null, 0));
} finally { await sim.close(); }
