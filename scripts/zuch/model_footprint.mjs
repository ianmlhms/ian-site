/* Where the hand-made / photo model of each station stands (patch frame): every vertex of the station group that is higher than 1.2 m above the group origin and outside the
 * player's track corridor is rasterised on a 2 m grid.  scripts/zuch/patch_model_overlap.py drops the OSM / LOD2 buildings of the patch that stand in these cells (the model
 * draws its own hall; a real footprint under it is "something inside something else", e.g. the camera inside a block at the Metz forecourt).
 *   node scripts/zuch/model_footprint.mjs [routeId ...] > model-footprint.json     { "<route>/<Station>": { cell: 2, side, cells: [[ix, iz], ...] } }
 * ix = floor(x / 2), iz = floor(z / 2) in the station frame (x right of travel, z = -(s - sMid), the group's local frame) */
import { openSim } from './zlib.mjs';
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['west', 'south', 'north', 'east', 'wittlich', 'trier', 'metz', 'brussels', 'paris'];
const CELL = 2;
const sim = await openSim({ quality: 'medium' });
const out = {};
try {
  for (const id of routes) {
    await sim.start(id);
    const res = await sim.page.evaluate((cell) => {
      const { world, THREE } = __tsTest.internals();
      const infra = world.infra; const t = __tsTest.trackInfo();
      infra.stationReport();                      // builds every station group
      const rows = {};
      t.stations.forEach((st, i) => {
        const g = infra.stationObjects[i].group;
        g.updateMatrixWorld(true);
        const sMid = (st.platformStart + st.platformEnd) / 2;
        const v = new THREE.Vector3(); const seen = new Set(); const set = new Set();
        const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3(); const P = new THREE.Vector3();
        const mark = (x, z, y) => {
          const wk = Math.round(x) + ',' + Math.round(z);
          if (seen.has(wk)) return; seen.add(wk);
          const q = t.nearest(x, z);          // curvilinear: lat (right of the player's track) and s along it = the patch frame (x, -(s - sMid))
          if (!q || q.d > 160 || Math.abs(q.lat) < 2.6) return;
          set.add(Math.floor(q.lat / cell) + ',' + Math.floor(-(q.s - sMid) / cell));
        };
        g.traverse((m) => {
          if (!m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
          const pos = m.geometry.attributes.position; const idx = m.geometry.index;
          m.updateMatrixWorld(true);
          const n = idx ? idx.count : pos.count;
          for (let k = 0; k + 2 < n; k += 3) {
            const ia = idx ? idx.getX(k) : k; const ib = idx ? idx.getX(k + 1) : k + 1; const ic = idx ? idx.getX(k + 2) : k + 2;
            A.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); B.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); C.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
            const yTop = Math.max(A.y, B.y, C.y) - g.position.y;
            if (yTop < 1.2) continue;
            const ext = Math.max(Math.hypot(A.x - B.x, A.z - B.z), Math.hypot(B.x - C.x, B.z - C.z), Math.hypot(A.x - C.x, A.z - C.z));
            const steps = Math.min(40, Math.max(1, Math.ceil(ext / 1.2)));
            for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps - a; b++) {
              const u = a / steps; const w = b / steps;
              P.set(A.x * u + B.x * w + C.x * (1 - u - w), A.y * u + B.y * w + C.y * (1 - u - w), A.z * u + B.z * w + C.z * (1 - u - w));
              mark(P.x, P.z, P.y);
            }
          }
        });
        rows[st.name] = { cell, side: st.side, cells: Array.from(set, (k) => k.split(',').map(Number)) };
      });
      return rows;
    }, CELL);
    for (const [name, r] of Object.entries(res)) out[id + '/' + name] = r;
  }
  console.log(JSON.stringify(out));
} finally { await sim.close(); }
