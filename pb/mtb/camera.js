/* Chase camera. Pure maths on plain numbers (the THREE camera just receives position / target / fov).
 *
 * Zero-holes rule for the camera: its position is ALWAYS above the physics surface by at least CAMERA.minClearance, and the boom between
 * the rider and the camera is shortened until it also clears every probe along its length. Because the render tiles around the rider are
 * the same lattice as the physics surface (LOD 0), a camera that clears the surface can never end up below the drawn ground. */
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

export function createChaseCamera(surface, collide = null, pushOut = null) {
  let yaw = null;                       // smoothed heading the camera sits behind
  let fovNow = CAMERA.fov;
  let height = null;
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: CAMERA.fov, shake: 0, boom: CAMERA.followDistance };

  /** Reset (respawn): snap behind the rider. */
  function snap(state) { yaw = state.heading; height = null; }

  function update(state, dt, mode = 0, time = 0) {
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
    const dist = (mode === 2 ? CAMERA.farDistance : CAMERA.followDistance) + Math.min(1.1, speed * 0.05);
    const rx = -sy, rz = cy;                                    // the rider's right (x east, z south)
    const wantX = state.x - cy * dist + rx * CAMERA.sideOffset, wantZ = state.z - sy * dist + rz * CAMERA.sideOffset;
    const wantY = Math.max(height, riderY - 0.4) + (mode === 2 ? CAMERA.farHeight : CAMERA.followHeight) + Math.min(0.5, speed * 0.015);
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
    let px = cx, pz = cz;
    if (collide) {                      // never inside a trunk: two passes push the ball out of up to two neighbouring trunks
      for (let pass = 0; pass < 2; pass++) {
        const hit = collide(px, pz, CAMERA.bodyRadius);
        if (!hit) break;
        px += hit.nx * hit.pen; pz += hit.nz * hit.pen;
      }
    }
    let py = Math.max(cyy, surface.height(px, pz) + CAMERA.minClearance);
    if (pushOut) {                      // crowns and rocks: push the ball out (a rock only counts while the camera is lower than its top)
      for (let pass = 0; pass < 2; pass++) {
        const hit = pushOut(px, py, pz, CAMERA.bodyRadius);
        if (!hit) break;
        px += hit.dx; py += hit.dy; pz += hit.dz;
      }
      py = Math.max(py, surface.height(px, pz) + CAMERA.minClearance);
    }
    out.x = px; out.y = py; out.z = pz;
    out.tx = state.x + cy * CAMERA.lookAhead; out.tz = state.z + sy * CAMERA.lookAhead; out.ty = riderY + CAMERA.lookHeight;
    if (mode === 1) {                  // helmet camera: the eye on the helmet, a little head shake, looking down the trail
      const hx = state.x + cy * CAMERA.helmetForward, hz = state.z + sy * CAMERA.helmetForward;
      out.x = hx; out.z = hz; out.y = Math.max(riderY + CAMERA.helmetHeight - 0.25 * Math.abs(state.lean), surface.height(hx, hz) + CAMERA.minClearance);
      out.tx = state.x + cy * 14; out.tz = state.z + sy * 14; out.ty = riderY + 0.8 - clamp(state.vy * 0.05, -0.4, 0.4);
    }
    // speed sensation: a little shake that grows with speed and rough ground, a wider view when fast
    const rough = state.grounded ? clamp(state.slip * 0.06 + (state.compression || 0) * 0.5, 0, 0.5) : 0;
    const amp = CAMERA.shake * (clamp((speed - 9) / 14, 0, 1) + rough);
    out.y += Math.sin(time * 47) * amp * 0.6 + Math.sin(time * 71 + 1) * amp * 0.4;
    out.x += Math.sin(time * 53 + 2) * amp * 0.5; out.z += Math.cos(time * 59 + 3) * amp * 0.5;
    const targetFov = (mode === 1 ? CAMERA.helmetFov : CAMERA.fov) + clamp(speed - 6, 0, 16) * 0.85;
    fovNow += (targetFov - fovNow) * Math.min(1, dt * 2.5);
    out.fov = fovNow;
    out.boom = Math.hypot(px - state.x, pz - state.z);
    return out;
  }
  return { update, snap, out };
}
