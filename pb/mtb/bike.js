/* Mountain bike physics: a rider + bike point mass on the physics surface.
 *
 *   forces   pedal power (P / v, limited by rear traction) - brake - rolling resistance - air drag + gravity along the slope
 *   steering kinematic bicycle (yaw rate = v * tan(bar angle) / wheelbase); the bar angle shrinks with speed, the rider leans into the turn
 *   grip     the velocity is dragged towards the heading with at most grip * g; beyond that the bike slides and loses speed
 *   contact  the bike is a free body (gravity) pushed out of the ground; it sticks to the surface over small drops (suspension travel) and
 *            leaves it over crests and jumps; touch-down speeds cost energy
 * Pure functions on plain numbers (no THREE): the harness rides it in Node, the browser draws it. Never mutates its inputs: state is replaced. */
import { BIKE, GROUND } from './config.js';

const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createBikeState(x, z, heading, surface) {
  const y = surface.height(x, z);
  return Object.freeze({
    x, y, z, vx: 0, vy: 0, vz: 0, heading, steer: 0, lean: 0, grounded: true, preload: 0, airTime: 0,
    pedal: 0, cadence: 0, crank: 0, groundKind: 'forest', compression: 0, lastImpact: 0, odometer: 0, slip: 0,
  });
}

/** One fixed physics step. input = { throttle 0..1, brake 0..1, steer -1..1 (right positive), jump boolean }. env = { gripScale }. Returns a NEW state. */
export function stepBike(s, input, dt, surface, groundAt, env = {}) {
  const gripScale = env.gripScale ?? 1;
  const nrm = { x: 0, y: 1, z: 0 };
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);

  // --- steering and lean state
  const steer = s.steer + (clamp(input.steer || 0, -1, 1) - s.steer) * Math.min(1, BIKE.steerRate * dt);
  let { x, y, z, vx, vy, vz } = s;
  let heading = s.heading;
  const speedH = Math.hypot(vx, vz);
  const bar = steer * BIKE.steerMax / (1 + (speedH / BIKE.steerSpeedRef) ** 2);
  const fwdX = Math.cos(heading), fwdZ = Math.sin(heading);
  const forwardSpeedH = vx * fwdX + vz * fwdZ;
  const yawRate = (s.grounded ? forwardSpeedH : forwardSpeedH * 0.15) * Math.tan(bar) / BIKE.wheelbase;
  heading = (heading + yawRate * dt) % TWO_PI;
  const fx = Math.cos(heading), fz = Math.sin(heading);

  const ground = groundAt(x, z);              // { kind, crr, grip }
  const mu = ground.grip * gripScale;
  let grounded = s.grounded;
  let slip = 0, crank = s.crank, lastImpact = s.lastImpact;
  let ax = 0, ay = -BIKE.gravity, az = 0;

  if (grounded) {
    surface.normal(x, z, nrm);
    // tangent frame: forward along the heading projected into the slope, lateral to its right
    let tfx = fx, tfy = 0, tfz = fz;
    const d = tfx * nrm.x + tfz * nrm.z;
    tfx -= nrm.x * d; tfy -= nrm.y * d; tfz -= nrm.z * d;
    const tl = Math.hypot(tfx, tfy, tfz) || 1;
    tfx /= tl; tfy /= tl; tfz /= tl;
    // right = f x n ... (x east, z south, y up): right of travel = (-fz, 0, fx) in the plane; keep it tangent
    const rx0 = -tfz * 1, rz0 = tfx * 1;
    let rx = rx0 - nrm.x * (rx0 * nrm.x + rz0 * nrm.z), ry = -nrm.y * (rx0 * nrm.x + rz0 * nrm.z), rz = rz0 - nrm.z * (rx0 * nrm.x + rz0 * nrm.z);
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;

    // remove the normal part of the velocity (we are in contact)
    const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
    vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
    let vf = vx * tfx + vy * tfy + vz * tfz;
    let vl = vx * rx + vy * ry + vz * rz;

    // gravity along the slope
    const gTan = (BIKE.gravity * (nrm.y)) ;      // normal component of g (positive) used for friction limits
    const gdotn = -BIKE.gravity * nrm.y;         // g . n  (negative: gravity pulls into the ground)
    const gtx = 0 - nrm.x * gdotn * 1, gty = -BIKE.gravity - nrm.y * gdotn, gtz = 0 - nrm.z * gdotn;
    let aF = gtx * tfx + gty * tfy + gtz * tfz;
    let aL = gtx * rx + gty * ry + gtz * rz;
    const normalAccel = Math.max(0.3, gTan);     // m/s2 pressing the tyres into the ground

    // pedalling: power limited, traction limited
    const vAbs = Math.max(0.9, Math.abs(vf));
    let drive = throttle * Math.min(BIKE.power / vAbs, BIKE.pedalForceMax) / BIKE.mass;
    drive = Math.min(drive, mu * normalAccel * 0.55);
    aF += drive;
    // rolling resistance and drag (opposing the motion)
    const speed3 = Math.hypot(vf, vl);
    const resist = ground.crr * normalAccel + 0.5 * BIKE.airDensity * BIKE.cdA * speed3 * speed3 / BIKE.mass;
    if (speed3 > 1e-3) { aF -= resist * (vf / speed3); aL -= resist * (vl / speed3); }
    // braking
    const brakeA = brake * Math.min(BIKE.brakeDecel, mu * normalAccel * 0.92);
    if (speed3 > 1e-3) { aF -= brakeA * (vf / speed3); aL -= brakeA * (vl / speed3); }
    vf += aF * dt;
    vl += aL * dt;
    if (brake > 0.05 && Math.abs(vf) < 0.25 && throttle < 0.05) vf = 0;      // a stopped bike stays stopped on a gentle slope with the brake held
    // lateral grip: pull the slip velocity towards zero at most mu * g
    const maxCorrect = mu * normalAccel * dt * 1.15;
    const corrected = Math.abs(vl) <= maxCorrect ? 0 : vl - Math.sign(vl) * maxCorrect;
    slip = Math.abs(vl);
    const lost = Math.abs(vl) - Math.abs(corrected);
    vl = corrected;
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), lost * 0.25);         // skidding scrubs a little speed
    const sp = Math.hypot(vf, vl);
    if (sp > BIKE.maxSpeed) { vf *= BIKE.maxSpeed / sp; vl *= BIKE.maxSpeed / sp; }
    vx = tfx * vf + rx * vl; vy = tfy * vf + ry * vl; vz = tfz * vf + rz * vl;
    ax = ay = az = 0;
    crank = (crank + Math.max(0, vf) * dt * 1.35 * (throttle > 0.05 ? 1 : 0.25)) % TWO_PI;
    // jump: pre-load while the key is held, pop on release (or at full pre-load)
  } else {
    // in the air: gravity and a little drag, no steering authority
    const sp = Math.hypot(vx, vy, vz);
    const k = 0.5 * BIKE.airDensity * BIKE.cdA / BIKE.mass * sp;
    ax = -k * vx; ay = -BIKE.gravity - k * vy; az = -k * vz;
  }

  // jump handling (works on the state before integration)
  let preload = s.preload;
  let popped = false;
  if (grounded) {
    if (input.jump) preload = Math.min(1, preload + dt / BIKE.jumpPreload);
    else if (preload > 0.08) {
      surface.normal(x, z, nrm);
      const power = BIKE.jumpImpulse * (0.45 + 0.55 * preload);
      vx += nrm.x * power * 0.6; vy += (nrm.y * 0.4 + 0.6) * power; vz += nrm.z * power * 0.6;
      preload = 0; grounded = false; popped = true;
    } else preload = 0;
  } else preload = 0;

  // --- integrate
  vx += ax * dt; vy += ay * dt; vz += az * dt;
  x += vx * dt; y += vy * dt; z += vz * dt;

  // --- contact with the surface
  const ground2 = surface.height(x, z);
  const gap = y - ground2;
  let airTime = s.airTime;
  let compression = s.compression * Math.exp(-9 * dt);
  if (grounded && !popped) {
    if (gap <= BIKE.stickDistance) {
      // follow the ground; keep the speed (energy) through the change of slope
      const sp0 = Math.hypot(vx, vy, vz);
      y = ground2;
      surface.normal(x, z, nrm);
      const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
      if (vn < 0) compression = Math.min(1, compression - vn * 0.05);
      vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
      const sp1 = Math.hypot(vx, vy, vz);
      if (sp1 > 1e-4 && Math.abs(vn) < 2.2) { const k2 = sp0 / sp1; vx *= k2; vy *= k2; vz *= k2; }
    } else { grounded = false; }
  }
  if (!grounded) {
    airTime += dt;
    if (y <= ground2) {
      surface.normal(x, z, nrm);
      const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
      y = ground2;
      if (vn < 0) {
        lastImpact = -vn;
        compression = Math.min(1, -vn / 8);
        const hard = Math.max(0, -vn - BIKE.landingHard);
        vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
        const keep = 1 - Math.min(0.5, hard * 0.05);
        vx *= keep; vy *= keep; vz *= keep;
      }
      grounded = true; airTime = 0;
    }
  }

  // lean into the turn: the bank angle that balances the centripetal acceleration
  const speedNow = Math.hypot(vx, vz);
  const wantLean = clamp(Math.atan2(speedNow * yawRate, BIKE.gravity), -BIKE.leanMax, BIKE.leanMax) * (grounded ? 1 : 0.4);
  const lean = s.lean + (wantLean - s.lean) * Math.min(1, BIKE.leanRate * dt);

  const cadence = grounded ? clamp(speedNow * 9.5, 0, 112) * (throttle > 0.05 ? 1 : 0.0) : 0;
  return Object.freeze({
    x, y, z, vx, vy, vz, heading, steer, lean, grounded, preload, airTime,
    pedal: throttle, cadence, crank, groundKind: ground.kind, compression, lastImpact, odometer: s.odometer + speedNow * dt, slip,
  });
}

/** Advances the state by `dt` seconds with fixed sub-steps. */
export function advanceBike(state, input, dt, surface, groundAt, env) {
  let s = state;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(BIKE.fixedStep, left);
    s = stepBike(s, input, h, surface, groundAt, env);
    left -= h;
  }
  return s;
}

export function groundResolver(field) {
  const info = { coverage: 0, way: -1 };
  return (x, z) => {
    field.height(x, z, info);
    const c = info.coverage;
    if (c > 0.55) return { kind: 'trail', ...GROUND.trail };
    if (c > 0.15) return { kind: 'track', ...GROUND.track };
    return { kind: 'forest', ...GROUND.forest };
  };
}

export const speedKmh = (s) => Math.hypot(s.vx, s.vy, s.vz) * 3.6;
export const speedMs = (s) => Math.hypot(s.vx, s.vy, s.vz);
