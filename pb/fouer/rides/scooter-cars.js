/* The Autoscooter ride's own cars (the "bigger inside" hall, rides/drive.js): the same car, riders and pole as the hall model's cars (models/hall-scooter.js buildRideCars),
 * but drawn unlit (MeshBasicMaterial: the interior has no scene lights, the real map is hidden while it runs).  The light of the kit's Lambert material is baked into the
 * vertex colours once (a soft top light + a darker underside), lamp vertices keep their own colour.  One geometry, one draw call; every car is a vertex range that
 * K.dynamic moves rigidly (CPU skinning, like the model's own cars). */
import { makeKit } from "../models/big-kit.js";
import { buildRideCars } from "../models/hall-scooter.js";

const LIGHT = [0.3, 0.8, 0.35];

/** bake a fixed top light into the vertex colours and replace the emissive attribute by the lamp colour itself */
export function bakeUnlit(geometry) {
  const nrm = geometry.attributes.normal.array, col = geometry.attributes.color.array, em = geometry.attributes.aEm ? geometry.attributes.aEm.array : null;
  const n = col.length / 3;
  for (let v = 0; v < n; v++) {
    const o = v * 3, lit = Math.max(0, nrm[o] * LIGHT[0] + nrm[o + 1] * LIGHT[1] + nrm[o + 2] * LIGHT[2]);
    const shade = 0.52 + 0.55 * lit;
    if (em && em[v * 4] + em[v * 4 + 1] + em[v * 4 + 2] > 0.02) { col[o] = Math.min(1, em[v * 4] * 1.1); col[o + 1] = Math.min(1, em[v * 4 + 1] * 1.1); col[o + 2] = Math.min(1, em[v * 4 + 2] * 1.1); }
    else { col[o] = Math.min(1, col[o] * shade); col[o + 1] = Math.min(1, col[o + 1] * shade); col[o + 2] = Math.min(1, col[o + 2] * shade); }
  }
  if (geometry.attributes.aEm) geometry.deleteAttribute("aEm");
  geometry.attributes.color.needsUpdate = true;
}

/** `count` cars (index 0 = the player's, hidden: the cockpit stands in for it); `radius` is the bounding radius used for culling (culling is off anyway) */
export function createFleet(T, { look = 0, count = 8 } = {}) {
  const K = makeKit(T);
  const { geometry, ranges, pal } = buildRideCars(K, { look, count });
  bakeUnlit(geometry);
  const dyn = K.dynamic(geometry, ranges, 40, [0, 2, 0]);
  const mat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false });
  const mesh = new T.Mesh(geometry, mat); mesh.name = "ride-cars"; mesh.frustumCulled = false;
  const hide = new T.Matrix4().makeScale(0, 0, 0);
  return {
    mesh, pal, count, tris: geometry.attributes.position.count / 3,
    set(j, matrix) { dyn.set(j, matrix); },
    hide(j) { dyn.set(j, hide); },
    commit() { dyn.commit(); },
    dispose() { geometry.dispose(); mat.dispose(); },
  };
}
