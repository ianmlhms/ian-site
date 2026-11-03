/* The car of Lux Drive: arcade physics on the physics surface.
 *
 * The car is a point mass with a suspension and a bicycle model for the steering: it follows the ground exactly (the same
 * lattice the renderer draws), it slides when the tyres cannot hold it, it slows on the steep slopes, it cannot drive through a
 * building and it never leaves the play area. Everything is in SI units.
 *
 * The heading convention: forward = (cos h, sin h) in (x east, z south) - the same as the MTB engine and the baked road yaw.
 * A positive steer input turns right (from +x towards +z). */
import { CAR, SURFACES } from './config.js';
import { ROAD_KINDS, SURFACE_NAMES, kindInfo } from './roads.js';

const GRAVITY = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Moves `v` towards `target` by at most `maxDelta`. */
const approach = (v, target, maxDelta) => (v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target));
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createCar({ ground, roadInfoAt, collide = null, start = null }) {
  const state = {
    x: 0, y: 0, z: 0, heading: 0, vx: 0, vz: 0, vy: 0,
    speed: 0,               // the forward speed (m/s), signed
    steer: 0,               // the road wheel angle (rad)
    roll: 0, pitch: 0,      // the attitude of the body
    grounded: true, slip: 0, bump: 0,
    onRoad: false, surface: 'grass', speedLimit: CAR.maxSpeed, gear: 0, rpm: 0.1,
    crashed: false, crashTime: 0,
  };
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0 };
  const normal = { x: 0, y: 1, z: 0 };
  let steerAngle = 0;
  let accumulator = 0;

  /** Places the car on the ground at (x, z), pointing along `heading`. */
  function reset(x, z, heading = 0) {
    state.x = x; state.z = z; state.heading = heading;
    state.vx = 0; state.vz = 0; state.vy = 0; state.speed = 0; state.steer = 0;
    state.y = ground.height(x, z) + CAR.rideHeight;
    state.grounded = true; state.crashed = false; state.crashTime = 0;
    state.roll = 0; state.pitch = 0;
    steerAngle = 0;
    accumulator = 0;
    return state;
  }

  /** The physics step (fixed, 1/120 s): the tyres, the brakes, the slope and the collisions. */
  function step(dt, input) {
    const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
    // the road under the car: its class decides the grip and the top speed
    roadInfoAt(state.x, state.z, info);
    const onRoad = info.coverage > 0.35;
    const kindName = onRoad ? ROAD_KINDS[info.kind] : null;
    // the material under the tyres is the material of the way itself (the OSM surface tag), not the class default
    const surfaceName = onRoad ? (SURFACE_NAMES[info.surface] || 'asphalt') : 'grass';
    const surf = SURFACES[surfaceName] || SURFACES.asphalt;
    const limitShare = onRoad ? (kindInfo(kindName).speed || 0.5) : 0.4;      // off the roads the car is slow
    const topSpeed = CAR.maxSpeed * limitShare;

    // --- steering: the road wheel follows the input, its authority falls with the speed
    const steerLimit = CAR.steerMax / (1 + Math.abs(state.speed) / CAR.steerSpeedRef);
    const steerTarget = clamp(input.steer || 0, -1, 1) * steerLimit;
    steerAngle = approach(steerAngle, steerTarget, CAR.steerRate * steerLimit * dt);
    state.steer = steerAngle;

    // --- the velocity in the frame of the car
    let vf = state.vx * cy + state.vz * sy;         // forward
    let vl = -state.vx * sy + state.vz * cy;        // to the right
    const handbrake = input.handbrake ? 1 : 0;
    // the tyres hold the car sideways, up to the limit of the friction circle
    const grip = surf.grip * (input.gripScale === undefined ? 1 : input.gripScale);
    const latLimit = grip * GRAVITY * dt;
    let slip = 0;
    if (Math.abs(vl) <= latLimit) {
      vl = 0;
    } else {
      slip = (Math.abs(vl) - latLimit) / Math.max(Math.abs(vl), 0.001);
      vl -= Math.sign(vl) * latLimit;
    }

    // --- the drive: the power divided by the speed, so the car pulls away strongly and tops out
    const throttle = clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    const reversing = brake > 0 && Math.abs(vf) < 0.7 && throttle < 0.05;
    let drive = 0;
    if (throttle > 0) {
      drive = (CAR.power * throttle) / Math.max(Math.abs(vf), 8) / CAR.mass;
      drive = Math.min(drive, 9);                                                // no rocket launch
      drive *= clamp(1 - slip * 0.8, 0.25, 1);                                   // the friction circle takes from the drive
      if (vf >= topSpeed) drive = 0;                                            // the top speed of the road class
    } else if (reversing) {
      drive = -(CAR.reversePower * brake) / Math.max(Math.abs(vf), 4) / CAR.mass;
      drive = Math.max(drive, -6);
    }

    // --- the brakes, the engine brake, the drag, the rolling resistance and the slope
    const dir = Math.sign(vf) || 0;
    let brakeDecel = 0;
    if (brake > 0 && !reversing) brakeDecel = CAR.brakeDecel * brake * surf.grip * (handbrake ? 1.25 : 1);
    const engineBrake = throttle < 0.05 ? CAR.engineBrake : 0;
    const drag = (0.5 * CAR.airDensity * CAR.cdA * vf * Math.abs(vf)) / CAR.mass;
    const roll = surf.crr * GRAVITY * (handbrake ? 2.5 : 1);
    // the slope: the ground normal tells how steep the road is under the car
    ground.normal(state.x, state.z, normal);
    const slope = GRAVITY * normal.y * (cy * normal.x + sy * normal.z);
    const handbrakeDecel = handbrake ? CAR.handbrakeDrag * (1 - CAR.handbrakeGrip) : 0;

    vf += (drive - brakeDecel * dir - drag - roll * dir - engineBrake * dir + slope - handbrakeDecel * dir) * dt;
    if (brake > 0 && !reversing && Math.abs(vf) < 0.25) vf = 0;
    if (vf > topSpeed * 1.15) vf = topSpeed * 1.15;                     // the limit is soft: the car can overshoot downhill
    if (vf < -CAR.maxReverse) vf = -CAR.maxReverse;

    // --- the yaw: the bicycle model (a car standing still does not turn)
    const yawRate = (Math.abs(vf) > 0.15 ? (vf / CAR.wheelbase) * Math.tan(steerAngle) : 0) * (1 - slip * 0.5);
    state.heading = wrapAngle(state.heading + yawRate * dt);

    // --- back to the world
    const ncy = Math.cos(state.heading), nsy = Math.sin(state.heading);
    state.vx = ncy * vf - nsy * vl;
    state.vz = nsy * vf + ncy * vl;
    state.x += state.vx * dt;
    state.z += state.vz * dt;

    // --- the collisions: the buildings and the play area push the car back
    if (collide) {
      for (let pass = 0; pass < 2; pass++) {
        const hit = collide(state.x, state.z, CAR.bodyRadius);
        if (!hit) break;
        state.x += hit.nx * hit.pen; state.z += hit.nz * hit.pen;
        // the speed into the wall is lost, a little of it comes back as a bounce
        const into = state.vx * hit.nx + state.vz * hit.nz;
        state.vx -= into * hit.nx * (1 + CAR.hitSpeedLoss);
        state.vz -= into * hit.nz * (1 + CAR.hitSpeedLoss);
        if (-into > CAR.crashSpeed && state.crashTime <= 0) { state.crashed = true; state.crashTime = CAR.respawnTime; }
      }
    }
    state.speed = state.vx * ncy + state.vz * nsy;
    state.slip = slip;
    state.onRoad = onRoad;
    state.surface = surfaceName;
    state.speedLimit = topSpeed;
    state.gear = gearOf(state.speed);
    state.rpm = rpmOf(state.speed, state.gear, throttle);
  }

  /** The vertical: the suspension follows the ground, but the car flies over a crest and lands again. */
  function updateVertical(dt) {
    const groundY = ground.height(state.x, state.z);
    const target = groundY + CAR.rideHeight;
    if (state.grounded) {
      if (target < state.y - 0.28) {                 // the ground fell away: the car leaves it
        state.grounded = false; state.vy = 0;
      } else {
        state.bump = (target - state.y) / Math.max(dt, 1e-4);
        state.vy = state.bump;
        state.y = target;
      }
    }
    if (!state.grounded) {
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y <= target) {
        state.y = target;
        state.vy = Math.abs(state.vy) * CAR.restitution;          // the landing bounce
        if (Math.abs(state.vy) < 0.6) { state.vy = 0; state.grounded = true; }
      }
    }
    // the attitude of the body: it lies on the slope, it rolls into the corners
    ground.normal(state.x, state.z, normal);
    const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
    const along = normal.x * cy + normal.z * sy;
    state.pitch = lerp(state.pitch, Math.atan2(-along, Math.max(normal.y, 0.2)), Math.min(1, dt * 8));
    const lateral = normal.x * -sy + normal.z * cy;
    const targetRoll = clamp(-lateral * 1.6 - state.steer * Math.abs(state.speed) * 0.02, -0.35, 0.35);
    state.roll = lerp(state.roll, targetRoll, Math.min(1, dt * 6));
    if (state.crashTime > 0) {
      state.crashTime -= dt;
      if (state.crashTime <= 0) state.crashed = false;
    }
  }

  /** One frame: the fixed steps of the physics, then the state. */
  function update(dt, input) {
    accumulator += Math.min(dt, 0.1);
    let guard = 0;
    while (accumulator >= CAR.fixedStep && guard < 24) {
      step(CAR.fixedStep, input);
      accumulator -= CAR.fixedStep;
      guard += 1;
    }
    updateVertical(Math.min(dt, 0.1));
    return state;
  }

  if (start) reset(start.x, start.z, start.yaw || 0);
  return { state, update, reset, step };
}

/** The gear the car is in (a hint for the dashboard, not a simulation). */
function gearOf(speed) {
  const a = Math.abs(speed);
  if (a < 0.4) return 0;                      // 0 = neutral / standstill
  if (a < 11) return 1;
  if (a < 22) return 2;
  if (a < 34) return 3;
  return 4;
}

/** The engine note of the dashboard (0..1). */
function rpmOf(speed, gear, throttle) {
  const a = Math.abs(speed);
  const band = gear === 0 ? 12 : [11, 22, 34, 46][Math.min(3, gear - 1)];
  const r = clamp((a % band) / band, 0, 1);
  return clamp(0.12 + r * 0.55 + throttle * 0.33, 0, 1);
}
