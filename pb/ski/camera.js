/* Chase camera behind the skier (the pattern of pb/mtb/camera.js): follows the heading with a lag, rises with the speed, widens the view
 * when fast, and never goes below the physics surface (the boom is shortened until every probe clears the ground). Pure maths: the THREE
 * camera only receives position, target and fov. */
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createChaseCamera(surface) {
  let yaw = null, height = null, fovNow = CAMERA.fov;
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: CAMERA.fov };

  function snap(state) { yaw = Math.atan2(state.vz, state.vx); if (Math.hypot(state.vx, state.vz) < 1) yaw = state.heading; height = null; }

  function update(state, dt, time = 0) {
    const hv = Math.hypot(state.vx, state.vz);
    // follow the direction of travel when moving (a skidding skier looks sideways, the camera does not), the skis when slow
    const want = hv > 2.5 ? Math.atan2(state.vz, state.vx) : state.heading;
    if (yaw === null) yaw = want;
    let d = want - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * (state.crash > 0 ? 0.6 : 2.6));
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ground = surface.height(state.x, state.z);
    const skierY = Math.max(state.y, ground);
    if (height === null) height = skierY;
    height += (skierY - height) * Math.min(1, dt * 6);
    const speed = Math.hypot(state.vx, state.vy, state.vz);
    const dist = CAMERA.followDistance + Math.min(2.2, speed * 0.07);
    const wantX = state.x - cy * dist, wantZ = state.z - sy * dist;
    const wantY = height + CAMERA.followHeight + Math.min(1.2, speed * 0.035);
    const eyeX = state.x, eyeY = skierY + 1.2, eyeZ = state.z;
    let t = 1;
    for (let k = CAMERA.clearanceProbe; k >= 1; k--) {
      const u = k / CAMERA.clearanceProbe;
      if (lerp(eyeY, wantY, u) < surface.height(lerp(eyeX, wantX, u), lerp(eyeZ, wantZ, u)) + 0.5) t = Math.min(t, (k - 1) / CAMERA.clearanceProbe);
    }
    const px = lerp(eyeX, wantX, Math.max(t, 0.35)), pz = lerp(eyeZ, wantZ, Math.max(t, 0.35));
    let py = Math.max(lerp(eyeY, wantY, Math.max(t, 0.35)), surface.height(px, pz) + CAMERA.minClearance);
    const amp = CAMERA.shake * smoothstep(12, 28, speed) * (state.grounded ? 1 : 0.2);
    py += Math.sin(time * 41) * amp + Math.sin(time * 67 + 1) * amp * 0.6;
    out.x = px + Math.sin(time * 53) * amp * 0.5; out.z = pz + Math.cos(time * 47) * amp * 0.5;
    out.y = Math.max(py, surface.height(out.x, out.z) + CAMERA.minClearance);
    out.tx = state.x + cy * CAMERA.lookAhead; out.tz = state.z + sy * CAMERA.lookAhead;
    out.ty = skierY * 0.45 + Math.min(skierY, surface.height(out.tx, out.tz)) * 0.55 + CAMERA.lookHeight;     // look down the slope, not at the sky
    const targetFov = CAMERA.fov + CAMERA.fovGain * smoothstep(CAMERA.fovFrom, CAMERA.fovTo, speed);
    fovNow += (targetFov - fovNow) * Math.min(1, dt * (targetFov > fovNow ? 1.8 : 1.2));
    out.fov = fovNow;
    return out;
  }
  return { update, snap, out };
}
