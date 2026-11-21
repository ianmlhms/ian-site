/* Round 7: the first-person camera (Ian's idea from a reel): the skier's own eyes, only the ski tips and the poles in view.
 * Pure maths like camera.js: the THREE camera receives position, target, fov and a roll (main.js rotates the view round its axis).
 *   eye     over the heels, lower in a tuck, dipping on a landing, leaning into the turn with the body (skier-model.js lean)
 *   look    along the skis, pitched with the slope and ~20 degrees down (the tips sit at the bottom of the picture)
 *   motion  a subtle head bob with the speed and the bumps, a roll into the turn (less than the body: no sea-sickness), and the speed
 *           sensation: the field of view widens at speed (FOV kick); main.js adds the speed streaks on Mëttel / Héich.
 * The mode is saved (CAM_KEY); in a lift ride the first-person mode is the ride's window view. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const CAM_KEY = 'pb_ski_cam';
export const FP = Object.freeze({
  eye: 1.62, tuckDrop: 0.46, back: 0.16, lookDown: 0.36, lookDist: 12, fov: 76, fovKick: 16, kickFrom: 8, kickTo: 28,
  bob: 0.022, bump: 0.05, roll: 0.3, leanShift: 0.55, near: 0.12, streakFrom: 19, streakTo: 30,
});

export function readCamMode(storage) { try { return storage.getItem(CAM_KEY) === 'first' ? 'first' : 'third'; } catch (error) { return 'third'; } }
export function writeCamMode(storage, mode) { try { storage.setItem(CAM_KEY, mode === 'first' ? 'first' : 'third'); } catch (error) { /* private mode */ } }

export function createFirstPersonCamera(surface) {
  let yaw = null, edge = 0, crouch = 0, dip = 0, fovNow = FP.fov, phase = 0, lastVy = 0;
  const n = { x: 0, y: 1, z: 0 };
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: FP.fov, roll: 0, streak: 0 };
  function snap(state) { yaw = state.heading; edge = 0; crouch = 0; dip = 0; }
  function update(state, dt, time = 0) {
    const k = Math.min(1, dt * 10);
    if (yaw === null) yaw = state.heading;
    let d = state.heading - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * 14);
    edge += (clamp(state.edge || 0, -1.1, 1.1) - edge) * k;
    const landing = state.landed > 0 ? Math.sin(Math.min(1, state.landed / 0.35) * Math.PI) : 0;
    crouch += (clamp((state.tuck || 0) * 0.95 + landing * 0.6, 0, 1) - crouch) * k;
    // a hard bump (the vertical speed changing quickly) dips the head a little
    const jolt = clamp(Math.abs((state.vy || 0) - lastVy) / Math.max(dt, 1e-3) / 60, 0, 1);
    lastVy = state.vy || 0;
    dip += (jolt * FP.bump - dip) * Math.min(1, dt * 8);
    const fx = Math.cos(yaw), fz = Math.sin(yaw), rx = -fz, rz = fx;
    const speed = Math.hypot(state.vx || 0, state.vy || 0, state.vz || 0);
    const ground = surface.height(state.x, state.z);
    const feet = state.grounded ? Math.max(state.y, ground) : state.y;
    // the body leans into the turn: the head moves to the inside (edge > 0: a right turn, +right)
    const lean = Math.sin(edge * 0.62) * FP.leanShift;
    phase += dt * (2 + speed * 0.35);
    const bob = FP.bob * Math.min(1, speed / 10) * (state.grounded ? 1 : 0.2) * Math.sin(phase * 2) + Math.sin(time * 41) * 0.006 * smoothstep(12, 28, speed) * (state.grounded ? 1 : 0);
    const eyeH = FP.eye - crouch * FP.tuckDrop - dip;
    out.x = state.x - fx * FP.back + rx * lean; out.z = state.z - fz * FP.back + rz * lean;
    out.y = Math.max(feet + eyeH + bob, surface.height(out.x, out.z) + 0.4);
    // the slope along the skis (from the ground normal): look down it
    surface.normal(state.x, state.z, n);
    const along = -(n.x * fx + n.z * fz) / Math.max(0.2, n.y);          // rise per metre ahead (< 0 downhill)
    const pitch = Math.atan(along) * (state.grounded ? 1 : 0.5) - FP.lookDown - crouch * 0.06;
    const c = Math.cos(pitch);
    out.tx = out.x + fx * FP.lookDist * c; out.tz = out.z + fz * FP.lookDist * c; out.ty = out.y + Math.sin(pitch) * FP.lookDist;
    const kick = FP.fovKick * smoothstep(FP.kickFrom, FP.kickTo, speed);
    fovNow += (FP.fov + kick - fovNow) * Math.min(1, dt * (FP.fov + kick > fovNow ? 2 : 1.2));
    out.fov = fovNow;
    out.roll = -edge * 0.62 * FP.roll;
    out.streak = smoothstep(FP.streakFrom, FP.streakTo, speed) * (state.grounded || state.air < 1 ? 1 : 0.6);
    return out;
  }
  return { update, snap, out };
}
