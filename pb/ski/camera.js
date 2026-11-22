/* Chase camera behind and ABOVE the skier (the pattern of pb/mtb/camera.js): follows the direction of travel with a lag, rises and drops
 * back with the speed, widens the view when fast, and never goes below the physics surface. Pure maths: the THREE camera only receives
 * position, target and fov.
 * After launch (Ian, 22 Nov 2026: "the camera should be more from above and less straight from behind"): the camera flies higher at every
 * speed and looks down on the skier and the piste ahead (about 20 degrees down at walking pace, 25-35 cruising and fast). On a slope the
 * snow behind the skier rises, so the height also follows that rise (slopeGain): the view stays "from above" on a steep black too, where
 * it used to sink to a metre over the snow behind him. Where a crest or a bank would cut the line camera -> skier the camera climbs over
 * it (eased) instead of jumping in close; the boom is only shortened as a last resort. scripts/ski/camera-check.mjs holds the bands. */
import { CAMERA } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createChaseCamera(surface) {
  let yaw = null, height = null, fovNow = CAMERA.fov, rise = 0, behind = null, lift = 0;
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: CAMERA.fov };
  const ease = (rate, dt) => 1 - Math.exp(-rate * dt);                 // the same easing at 15 and at 60 fps

  function snap(state) { yaw = Math.atan2(state.vz, state.vx); if (Math.hypot(state.vx, state.vz) < 1) yaw = state.heading; height = null; behind = null; lift = 0; }

  function update(state, dt, time = 0) {
    const hv = Math.hypot(state.vx, state.vz);
    // follow the direction of travel when moving (a skidding skier looks sideways, the camera does not), the skis when slow
    const want = hv > 2.5 ? Math.atan2(state.vz, state.vx) : state.heading;
    if (yaw === null) yaw = want;
    let d = want - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * ease(state.crash > 0 ? 0.6 : CAMERA.yawRate, dt);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ground = surface.height(state.x, state.z);
    const skierY = Math.max(state.y, ground);
    if (height === null) height = skierY;
    height += (skierY - height) * ease(6, dt);
    const speed = Math.hypot(state.vx, state.vy, state.vz);
    // round 7 (A): at speed the camera climbs and drops back, looking down the slope from above (eased both ways, ~1.5 s)
    rise += (smoothstep(CAMERA.riseFrom, CAMERA.riseTo, speed) - rise) * ease(1.3, dt);
    const dist = CAMERA.followDistance + Math.min(CAMERA.distGainMax, speed * CAMERA.distGain) + CAMERA.riseBack * rise;
    const wantX = state.x - cy * dist, wantZ = state.z - sy * dist;
    // the snow behind him rises on a slope: the camera keeps its height over THAT snow too (eased: rollers do not pump the view)
    const rises = clamp(surface.height(wantX, wantZ) - skierY, 0, CAMERA.slopeMax);
    behind = behind === null ? rises : behind + (rises - behind) * ease(CAMERA.slopeEase, dt);
    let wantY = height + CAMERA.followHeight + Math.min(CAMERA.heightGainMax, speed * CAMERA.heightGain) + CAMERA.riseUp * rise + CAMERA.slopeGain * behind;
    const eyeX = state.x, eyeY = skierY + 1.2, eyeZ = state.z;
    // a crest or a bank between the camera and him: the camera climbs until the line clears it (fast up, slowly down again) ...
    let need = 0;
    for (let k = 1; k <= CAMERA.clearanceProbe; k++) {
      const u = k / CAMERA.clearanceProbe;
      const under = surface.height(lerp(eyeX, wantX, u), lerp(eyeZ, wantZ, u)) + CAMERA.lineClearance - lerp(eyeY, wantY, u);
      if (under > 0) need = Math.max(need, under / u);
    }
    need = Math.min(need, CAMERA.liftMax);
    lift += (need - lift) * ease(need > lift ? 14 : 1.6, dt);
    wantY += lift;
    // ... and only what is still in the way then shortens the boom
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
    out.ty = skierY * 0.45 + Math.min(skierY, surface.height(out.tx, out.tz)) * 0.55 + CAMERA.lookHeight - CAMERA.riseLook * rise;     // look down the slope, not at the sky
    // the horizon stays in the picture: the view never points lower than horizonMargin degrees inside the top edge (the fov of this frame)
    const reach = Math.hypot(out.tx - out.x, out.tz - out.z);
    out.ty = Math.max(out.ty, out.y - Math.tan((fovNow / 2 - CAMERA.horizonMargin) * Math.PI / 180) * reach);
    // ... but he comes first: on a very steep face (the camera high over him) the view tilts down far enough to keep him skierLow of
    // the half height below the middle at the most
    const himDown = Math.atan2(out.y - (skierY + 1), Math.hypot(state.x - out.x, state.z - out.z)) * 180 / Math.PI;
    out.ty = Math.min(out.ty, out.y - Math.tan(Math.max(0, himDown - CAMERA.skierLow * fovNow / 2) * Math.PI / 180) * reach);
    const targetFov = CAMERA.fov + CAMERA.fovGain * smoothstep(CAMERA.fovFrom, CAMERA.fovTo, speed);
    fovNow += (targetFov - fovNow) * ease(targetFov > fovNow ? 1.8 : 1.2, dt);
    out.fov = fovNow;
    return out;
  }
  return { update, snap, out, get rise() { return rise; } };
}
