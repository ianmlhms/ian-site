/* Chase camera. Pure maths on plain numbers (the THREE camera just receives position / target / fov).
 *
 * Zero-holes rule for the camera: its position is ALWAYS above the physics surface by at least CAMERA.minClearance, and the boom between
 * the rider and the camera is shortened until it also clears every probe along its length. Because the render tiles around the rider are
 * the same lattice as the physics surface (LOD 0), a camera that clears the surface can never end up below the drawn ground. */
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

export function createChaseCamera(surface) {
  let yaw = null;                       // smoothed heading the camera sits behind
  let fovNow = CAMERA.fov;
  let height = null;
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: CAMERA.fov, shake: 0, boom: CAMERA.followDistance };

  /** Reset (respawn): snap behind the rider. */
  function snap(state) { yaw = state.heading; height = null; }

  function update(state, dt) {
    if (yaw === null) yaw = state.heading;
    // follow the heading with a lag that is shorter the faster the rider turns
    let d = state.heading - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * 3.2);
    const speed = Math.hypot(state.vx, state.vy, state.vz);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ground = surface.height(state.x, state.z);
    const riderY = Math.max(state.y, ground);
    if (height === null) height = riderY;
    height += (riderY - height) * Math.min(1, dt * 5);        // vertical smoothing: no bobbing over bumps
    const dist = CAMERA.followDistance + Math.min(1.1, speed * 0.05);
    const wantX = state.x - cy * dist, wantZ = state.z - sy * dist;
    const wantY = Math.max(height, riderY - 0.4) + CAMERA.followHeight + Math.min(0.5, speed * 0.015);
    // shorten the boom until every probe clears the ground
    const eyeX = state.x, eyeY = riderY + 1.1, eyeZ = state.z;
    let t = 1;
    for (let k = CAMERA.clearanceProbe; k >= 1; k--) {
      const u = k / CAMERA.clearanceProbe;
      const px = lerp(eyeX, wantX, u), pz = lerp(eyeZ, wantZ, u), py = lerp(eyeY, wantY, u);
      if (py < surface.height(px, pz) + 0.45) t = Math.min(t, (k - 1) / CAMERA.clearanceProbe);
    }
    const cx = lerp(eyeX, wantX, t), cz = lerp(eyeZ, wantZ, t);
    const floor = surface.height(cx, cz) + CAMERA.minClearance;
    const cyy = Math.max(lerp(eyeY, wantY, t), floor);
    out.x = cx; out.y = cyy; out.z = cz;
    out.tx = state.x + cy * CAMERA.lookAhead; out.tz = state.z + sy * CAMERA.lookAhead; out.ty = riderY + 1.0;
    const targetFov = CAMERA.fov + clamp(speed - 6, 0, 16) * 0.85;
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 2.5);
    out.fov = fovNow;
    out.boom = Math.hypot(cx - state.x, cz - state.z);
    return out;
  }
  return { update, snap, out };
}
