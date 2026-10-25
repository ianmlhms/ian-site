import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'low' });
try {
  const r = await sim.page.evaluate(([id, name]) => {
    const r = TS.track.build(TS.routes.get(id)); const sc = new THREE.Scene();
    const inf = TS.infra.create(sc, r, { quality: 'low' }); inf.stationReport();
    const i = r.stations.findIndex((s) => s.name === name); const st = r.stations[i];
    const g = inf.stationObjects[i].group; g.updateMatrixWorld(true);
    const f = r.frameAt((st.platformStart + st.platformEnd) / 2);
    const out = { f: { pos: f.pos.toArray(), right: f.right.toArray(), tan: f.tangent.toArray() }, g: { pos: g.position.toArray(), ry: g.rotation.y }, meshes: [] };
    const v = new THREE.Vector3();
    g.children.forEach((m) => { if (!m.geometry || !m.geometry.attributes.position) return; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; if (b.max.y > 0.4 && b.max.y < 1.2 && b.max.x - b.min.x > 3) { v.set((b.min.x + b.max.x) / 2, b.max.y, 0).applyMatrix4(m.matrixWorld); const q = r.nearest(v.x, v.z); out.meshes.push({ name: m.name, bx: [b.min.x, b.max.x], by: b.max.y, m: m.matrixWorld.elements.slice(0, 3), lat: q.lat, d: q.d }); } });
    inf.dispose();
    return out;
  }, [process.argv[2], process.argv[3]]);
  console.log(JSON.stringify(r, null, 0));
} finally { await sim.close(); }
