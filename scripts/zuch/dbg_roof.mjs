import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'high' });
try {
  await sim.start('wittlich');
  const out = await sim.evalGame(({ scene, track }) => {
    const res = [];
    const f = track.frameAt(115 - 20);
    res.push({ tramRef: [f.pos.x, f.pos.y, f.pos.z] });
    scene.traverse((o) => { if (o.name && o.name.startsWith('station-surround-Lëtz')) o.children.forEach((m) => { if (!m.isMesh || !m.geometry.attributes.color) return; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; if (m.geometry.index.count / 3 < 700 && m.geometry.index.count / 3 > 150) res.push({ tris: m.geometry.index.count / 3, c: [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2].map(Math.round), sz: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(Math.round) }); }); });
    return res;
  });
  console.log(JSON.stringify(out));
} finally { await sim.close(); }
