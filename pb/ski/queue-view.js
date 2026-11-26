/* Lift lines (26 Nov 2026): the queue mazes of lift-queue.js drawn (posts with a foot, belt tape between them; the free lane's tape blue).
 * ONE instanced mesh for every maze near the camera (a unit box per post / foot / tape, its own matrix and colour): 1 draw call, none when
 * no maze is within RADIUS; the feet only within NEAR. Rebuilt when the camera has moved REBUILD m, the lift world changed (houses in:
 * a few mazes go) or every 2 s (the tiles under them). update(camX, camZ, world, dt) every frame (cheap when nothing changed). */
import { QUEUE_COLOURS as COL, MAZE } from './lift-queue.js';

const THREE = window.THREE;
const RADIUS = 260, NEAR = 120, REBUILD = 25, CAP = 1600;
const TAPE_H = 0.05, TAPE_T = 0.012, POST_W = 0.06, FOOT_W = 0.32, FOOT_H = 0.035;

/** ground(x, z) = where feet stand (the snow, or a station deck). */
export function createQueueView({ scene, ground }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.name = 'ski-lift-queues';
  scene.add(mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), c3 = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), xAxis = new THREE.Vector3(1, 0, 0);
  let lastX = Infinity, lastZ = Infinity, lastWorld = null, n = 0, age = 0;      // (every 2 s too: the tiles under them stream in)
  const stats = { mazes: 0, instances: 0 };
  function put(x, y, z, sx, sy, sz, quat, colour) {
    if (n >= CAP) return;
    p3.set(x, y, z); s3.set(sx, sy, sz);
    m4.compose(p3, quat, s3);
    mesh.setMatrixAt(n, m4);
    c3.setHex(colour); mesh.instanceColor.setXYZ(n, c3.r, c3.g, c3.b);
    n++;
  }
  function rebuild(camX, camZ, world) {
    n = 0; stats.mazes = 0;
    const w = {};
    for (const site of world.sites.values()) {
      const m = site.queue;
      if (!m || Math.hypot(m.x - camX, m.z - camZ) > RADIUS) continue;
      stats.mazes++;
      const near = Math.hypot(m.x - camX, m.z - camZ) < NEAR;
      const heading = Math.atan2(m.fz, m.fx);
      q.setFromAxisAngle(yAxis, -heading);
      const tops = new Map();
      for (const p of m.posts) {
        m.toWorld(p.a, p.b, w);
        const g = ground(w.x, w.z);
        tops.set(p, g + MAZE.postH);
        put(w.x, g + MAZE.postH / 2, w.z, POST_W, MAZE.postH, POST_W, q, COL.post);
        put(w.x, g + MAZE.postH + 0.02, w.z, POST_W + 0.03, 0.04, POST_W + 0.03, q, COL.cap);
        if (near) put(w.x, g + FOOT_H / 2, w.z, FOOT_W, FOOT_H, FOOT_W, q, COL.base);
      }
      // the tape: from post to post just under the tops (sags a little: drawn 4 cm lower in the middle is not worth a second box)
      const a = {}, b = {};
      for (const r of m.ropes) {
        m.toWorld(r.a0, r.b0, a); m.toWorld(r.a1, r.b1, b);
        const ya = ground(a.x, a.z) + MAZE.ropeY, yb = ground(b.x, b.z) + MAZE.ropeY;
        dir.set(b.x - a.x, yb - ya, b.z - a.z);
        const len = dir.length();
        if (len < 0.05) continue;
        dir.divideScalar(len);
        const qt = new THREE.Quaternion().setFromUnitVectors(xAxis, dir);
        put((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2, Math.max(0.01, len - POST_W), TAPE_H, TAPE_T, qt, r.free ? COL.ropeFree : COL.rope);
      }
    }
    mesh.count = n; mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    stats.instances = n;
  }
  return {
    mesh, stats,
    update(camX, camZ, world, dt = 0) {
      if (!world) return;
      age += dt;
      if (world === lastWorld && Math.hypot(camX - lastX, camZ - lastZ) < REBUILD && age < 2) return;
      lastWorld = world; lastX = camX; lastZ = camZ; age = 0;
      rebuild(camX, camZ, world);
    },
    /** Rebuild at the next update (the ground under the mazes changed: tiles came in). */
    invalidate() { lastWorld = null; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}
