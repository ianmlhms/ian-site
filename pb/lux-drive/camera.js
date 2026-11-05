/* Chase camera of Lux Drive. Pure maths on plain numbers (the THREE camera just receives position / target / fov).
 *
 * Zero-holes rule for the camera: its position is ALWAYS above the physics surface by at least CAMERA.minClearance, and the boom
 * between the car and the camera is shortened until it also clears every probe along its length. Because the render tiles around the
 * car are the same lattice as the physics surface (LOD 0), a camera that clears the surface can never end up below the drawn ground.
 *
 * The heading convention of the whole game: forward = (cos h, sin h) in (x east, z south), the same as the MTB engine, so the
 * baked yaw of a road (atan2(dz, dx)) can be used as a heading without a conversion. */
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * @param surface the ground (height, and overheadAt for the bridge decks above the car)
 * @param collide (x, z, radius, y) => { nx, nz, pen } | null: anything the lens at height y must not sit in (houses, trees, tunnel portals)
 */
export function createChaseCamera(surface, collide = null) {
  let yaw = null;                       // the smoothed heading the camera sits behind
  let fovNow = CAMERA.fov;
  let height = null;
  let boomShare = 1;                    // the share of the boom that is free: it drops at once at an obstacle and grows back slowly
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: CAMERA.fov, shake: 0, boom: CAMERA.followDistance };

  /** Reset (respawn / start): snap behind the car. */
  function snap(state) { yaw = state.heading; height = null; boomShare = 1; }

  /**
   * state: { x, y, z, heading, vx, vz, vy, speed, roll, grounded }
   * mode:  0 chase, 1 bonnet, 2 far chase
   */
  function update(state, dt, mode = 0, time = 0) {
    if (yaw === null) yaw = state.heading;
    // the camera follows the heading with a lag: the quicker the car turns, the quicker the camera swings round
    let d = state.heading - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * CAMERA.turnLag);
    const speed = Math.hypot(state.vx, state.vz);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ground = surface.height(state.x, state.z);
    const carY = Math.max(state.y, ground);
    if (height === null) height = carY;
    height += (carY - height) * Math.min(1, dt * CAMERA.heightLag);       // vertical smoothing: the camera does not bob over every bump
    const dist = (mode === 2 ? CAMERA.farDistance : CAMERA.followDistance) + Math.min(1.6, speed * 0.05);
    const wantX = state.x - cy * dist, wantZ = state.z - sy * dist;
    const wantY = Math.max(height, carY - 0.4) + (mode === 2 ? CAMERA.farHeight : CAMERA.followHeight) + Math.min(0.6, speed * 0.02);
    // shorten the boom until every probe clears the ground
    const eyeX = state.x, eyeY = carY + 1.1, eyeZ = state.z;
    let t = 1;
    for (let k = CAMERA.clearanceProbe; k >= 1; k--) {
      const u = k / CAMERA.clearanceProbe;
      const px = lerp(eyeX, wantX, u), pz = lerp(eyeZ, wantZ, u), py = lerp(eyeY, wantY, u);
      if (py < surface.height(px, pz) + 0.45) t = Math.min(t, (k - 1) / CAMERA.clearanceProbe);
    }
    // the obstacles: houses, trees and tunnel portals on the boom, and the deck of a bridge the car drives under (the lens must
    // stay below it).  The boom is cut before the first one, but never shorter than minBoom (then the push-out below takes over).
    const boom = Math.hypot(wantX - eyeX, wantZ - eyeZ) || 1;
    const minT = Math.min(1, CAMERA.minBoom / boom);
    for (let k = 1; k <= CAMERA.occlusionProbe; k++) {
      const u = k / CAMERA.occlusionProbe;
      if (u > t) break;
      const px = lerp(eyeX, wantX, u), pz = lerp(eyeZ, wantZ, u), py = lerp(eyeY, wantY, u);
      const blocked = (collide && collide(px, pz, CAMERA.bodyRadius, py)) || (surface.overheadAt && py > surface.overheadAt(px, pz, carY + 0.9) - CAMERA.deckClearance);
      if (blocked) { t = Math.max(minT, Math.min(t, (k - 1) / CAMERA.occlusionProbe)); break; }
    }
    // the boom shortens at once and grows back gently, so the camera never pops in and out along a row of trees
    boomShare = t < boomShare ? t : boomShare + (t - boomShare) * Math.min(1, dt * CAMERA.boomRelax);
    t = Math.min(t, boomShare);
    const cx = lerp(eyeX, wantX, t), cz = lerp(eyeZ, wantZ, t);
    const floor = surface.height(cx, cz) + CAMERA.minClearance;
    let py = Math.max(lerp(eyeY, wantY, t), floor);
    let px = cx, pz = cz;
    if (collide) {                      // never inside a building: two passes push the camera out of up to two neighbours
      for (let pass = 0; pass < 2; pass++) {
        const hit = collide(px, pz, CAMERA.bodyRadius, py);
        if (!hit) break;
        px += hit.nx * hit.pen; pz += hit.nz * hit.pen;
      }
    }
    py = Math.max(py, surface.height(px, pz) + CAMERA.minClearance);
    if (surface.overheadAt) {            // under a bridge: never above the underside of the deck (the ground floor wins when the headroom is tiny)
      const ceiling = surface.overheadAt(px, pz, carY + 0.9) - CAMERA.deckClearance;
      if (py > ceiling) py = Math.max(ceiling, surface.height(px, pz) + CAMERA.minClearance);
    }
    out.x = px; out.y = py; out.z = pz;
    out.tx = state.x + cy * CAMERA.lookAhead; out.tz = state.z + sy * CAMERA.lookAhead; out.ty = carY + CAMERA.lookHeight;
    if (mode === 1) {                  // the bonnet camera: the eye over the hood, looking down the road
      const hx = state.x + cy * CAMERA.bonnetForward, hz = state.z + sy * CAMERA.bonnetForward;
      out.x = hx; out.z = hz;
      out.y = Math.max(carY + CAMERA.bonnetHeight, surface.height(hx, hz) + CAMERA.minClearance);
      out.tx = state.x + cy * 22; out.tz = state.z + sy * 22; out.ty = carY + 1.0;
    }
    // the speed sensation: a little shake that grows with speed, a wider view when fast
    const rough = state.grounded ? clamp((state.slip || 0) * 0.05, 0, 0.5) : 0;
    const amp = CAMERA.shake * (clamp((speed - CAMERA.shakeFrom) / CAMERA.shakeSpan, 0, 1) * 0.8 + rough);
    out.y += Math.sin(time * 47) * amp * 0.6 + Math.sin(time * 71 + 1) * amp * 0.4;
    out.x += Math.sin(time * 53 + 2) * amp * 0.5; out.z += Math.cos(time * 59 + 3) * amp * 0.5;
    out.y = Math.max(out.y, surface.height(out.x, out.z) + CAMERA.minClearance);          // the shake never dips the lens into the ground
    const targetFov = (mode === 1 ? CAMERA.bonnetFov : CAMERA.fov) + CAMERA.fovGain * smoothstep(CAMERA.fovFrom, CAMERA.fovTo, speed);
    fovNow += (targetFov - fovNow) * Math.min(1, dt * (targetFov > fovNow ? 2.2 : 1.4));   // the view opens quickly when the car picks up speed
    out.fov = fovNow;
    out.boom = Math.hypot(px - state.x, pz - state.z);
    return out;
  }
  return { update, snap, out };
}
