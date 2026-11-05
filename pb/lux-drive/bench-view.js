/* The park benches on screen: the benches near the camera as ONE instanced mesh (the same pooling as the street lights).
 * A bench is two steel legs, a wooden seat and a back of slats; its local +z is the direction it faces. */
import { PartBuilder } from './part-builder.js';
import { createPartMaterial } from './part-material.js';

const THREE = window.THREE;
const SHOW_RADIUS = 170;               // m
const CAPACITY = 160;
const REFRESH = 20;                    // m the camera moves before the set is rebuilt
const CELL = 64;
const WOOD = [0.52, 0.37, 0.22], STEEL = [0.26, 0.28, 0.28];

function benchGeometry() {
  const b = new PartBuilder();
  for (const x of [-0.75, 0.75]) b.box(x - 0.04, x + 0.04, 0, 0.45, -0.2, 0.2, STEEL);     // the legs
  b.box(-0.9, 0.9, 0.43, 0.5, -0.24, 0.24, WOOD);                                            // the seat
  b.box(-0.9, 0.9, 0.62, 0.95, -0.27, -0.22, WOOD);                                          // the back (it leans away from the sitter: -z is the back)
  for (const x of [-0.8, 0.8]) b.box(x - 0.03, x + 0.03, 0.45, 0.95, -0.27, -0.2, STEEL);   // the posts of the back
  return b.build(THREE);
}

export function createBenchView({ scene, benches, ground, env }) {
  const land = ground.surface || ground;          // a bench stands on the land, never on the deck over it (see street-light-view.js)
  const mesh = new THREE.InstancedMesh(benchGeometry(), createPartMaterial(env), CAPACITY);
  mesh.frustumCulled = false; mesh.count = 0;
  scene.add(mesh);
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let i = 0; i < benches.count; i++) {
    const k = key(Math.floor(benches.x[i] / CELL), Math.floor(benches.z[i] / CELL));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let lastX = 1e9, lastZ = 1e9;
  function refresh(cx, cz) {
    const picks = [];
    const r = Math.ceil(SHOW_RADIUS / CELL), ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      for (const n of cells.get(key(i, j)) || []) { const d = Math.hypot(benches.x[n] - cx, benches.z[n] - cz); if (d < SHOW_RADIUS) picks.push([d, n]); }
    }
    picks.sort((a, b) => a[0] - b[0]);
    const n = Math.min(CAPACITY, picks.length);
    for (let k = 0; k < n; k++) {
      const i = picks[k][1];
      q.setFromAxisAngle(up, benches.yaw[i]);
      pos.set(benches.x[i], land.height(benches.x[i], benches.z[i]), benches.z[i]);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(k, m4);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  }
  function update(camX, camZ) { if (Math.hypot(camX - lastX, camZ - lastZ) > REFRESH) { lastX = camX; lastZ = camZ; refresh(camX, camZ); } }
  return { update, mesh, count: benches.count };
}
