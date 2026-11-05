/* The car of Lux Drive: arcade physics on the physics surface.
 *
 * The car is a point mass with a suspension and a bicycle model for the steering: it follows the ground exactly (the same
 * lattice the renderer draws), it slides when the tyres cannot hold it, it slows on the steep slopes, it cannot drive through a
 * building and it never leaves the play area. Everything is in SI units.
 *
 * The heading convention: forward = (cos h, sin h) in (x east, z south) - the same as the MTB engine and the baked road yaw.
 * A positive steer input turns right (from +x towards +z). */
import { CAR, SURFACES } from './config.js';
import { SURFACE_NAMES } from './roads.js';

const GRAVITY = 9.81;
const HIT_SOUND_SPEED = 1.5;      // m/s into a wall that the ears notice
const HIT_COOLDOWN_S = 0.3;       // s between two counted hits
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
    roll: 0, pitch: 0,      // the attitude of the car on the slope (rad)
    squat: 0, lean: 0,      // the movement of the body on its suspension (rad)
    grounded: true, slip: 0, bump: 0,
    onRoad: false, surface: 'grass', speedLimit: CAR.maxSpeed, gear: 0, rpm: 0.1,
    crashed: false, crashTime: 0,
    hits: 0, lastHitSpeed: 0,   // every collision counts: the sound makes a thud when the count changes
    braking: false, reversing: false, longAccel: 0,    // for the brake lights and the reversing lights of the model
  };
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0 };
  const normal = { x: 0, y: 1, z: 0 };
  let steerAngle = 0;
  let accumulator = 0;
  let hitCool = 0;                  // s: sliding along a wall is one hit for the ears, not one per physics step

  /** Places the car on the ground at (x, z), pointing along `heading`. */
  function reset(x, z, heading = 0) {
    state.x = x; state.z = z; state.heading = heading;
    state.vx = 0; state.vz = 0; state.vy = 0; state.speed = 0; state.steer = 0;
    state.y = ground.height(x, z) + CAR.rideHeight;
    state.grounded = true; state.crashed = false; state.crashTime = 0;
    state.roll = 0; state.pitch = 0; state.squat = 0; state.lean = 0;
    steerAngle = 0;
    accumulator = 0;
    return state;
  }

  /** The physics step (fixed, 1/120 s): the tyres, the brakes, the slope and the collisions. */
  function step(dt, input) {
    hitCool -= dt;
    const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
    // the road under the car: its class decides the grip and the top speed
    roadInfoAt(state.x, state.z, info);
    const onRoad = info.coverage > 0.35;
    // the material under the tyres is the material of the way itself (the OSM surface tag), not the class default
    const surfaceName = onRoad ? (SURFACE_NAMES[info.surface] || 'asphalt') : 'grass';
    const surf = SURFACES[surfaceName] || SURFACES.asphalt;
    // No speed limits (Ian): every road lets the car run to its top speed; only off the roads the grass holds it back
    const topSpeed = onRoad ? CAR.maxSpeed : CAR.maxSpeed * CAR.offRoadShare;

    // --- steering: the road wheel follows the input, its authority falls with the speed
    // The authority also falls with the speed so that full lock never asks for more sideways acceleration than the tyres give
    // (a keyboard is all or nothing: without this cap full lock at 90 km/h spins the car).
    const speedAbs = Math.abs(state.speed);
    const gripNow = surf.grip * (input.gripScale === undefined ? 1 : input.gripScale);
    const lateralCap = Math.atan((CAR.steerGripShare * gripNow * GRAVITY * CAR.wheelbase) / Math.max(speedAbs * speedAbs, 1));
    const steerLimit = Math.min(CAR.steerMax / (1 + speedAbs / CAR.steerSpeedRef), Math.max(lateralCap, CAR.steerMin));
    const steerTarget = clamp(input.steer || 0, -1, 1) * steerLimit;
    steerAngle = approach(steerAngle, steerTarget, CAR.steerRate * steerLimit * dt);
    state.steer = steerAngle;

    // --- the velocity in the frame of the car
    let vf = state.vx * cy + state.vz * sy;         // forward
    let vl = -state.vx * sy + state.vz * cy;        // to the right
    const handbrake = input.handbrake ? 1 : 0;
    // the tyres hold the car sideways, up to the limit of the friction circle
    // the handbrake locks the rear wheels: the car keeps its direction of travel and the tail steps out (a drift)
    const grip = gripNow * (handbrake ? CAR.handbrakeGrip : 1);
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
    // The brake pedal reverses the car once it is (nearly) standing - and keeps reversing while it rolls backwards (the old test on
    // |vf| < 0.7 stopped the car at 0.7 m/s backwards: the brake took over and a wedged car could never get out)
    const reversing = brake > 0 && vf < 0.7 && throttle < 0.05;
    let drive = 0;
    if (throttle > 0) {
      drive = (CAR.power * throttle) / Math.max(Math.abs(vf), 8) / CAR.mass;
      drive = Math.min(drive, CAR.launchCap);                                    // no rocket launch
      drive *= clamp(1 - slip * 0.8, 0.25, 1);                                   // the friction circle takes from the drive
      if (vf >= topSpeed) drive = 0;                                            // the top speed of the car (lower on grass)
    } else if (reversing) {
      drive = -(CAR.reversePower * brake) / Math.max(Math.abs(vf), 4) / CAR.mass;
      drive = Math.max(drive, -6);
    }

    // --- the brakes, the engine brake, the drag, the rolling resistance and the slope
    const dir = Math.sign(vf) || 0;
    let brakeDecel = 0;
    if (brake > 0 && !reversing) brakeDecel = CAR.brakeDecel * brake * gripNow * (handbrake ? 1.25 : 1);
    const engineBrake = throttle < 0.05 ? CAR.engineBrake : 0;
    const drag = (0.5 * CAR.airDensity * CAR.cdA * vf * Math.abs(vf)) / CAR.mass;
    const roll = surf.crr * GRAVITY * (handbrake ? 2.5 : 1);
    // the slope: the ground normal tells how steep the road is under the car
    ground.normal(state.x, state.z, normal);
    const slope = GRAVITY * normal.y * (cy * normal.x + sy * normal.z);
    const handbrakeDecel = handbrake ? CAR.handbrakeDrag * (1 - CAR.handbrakeGrip) : 0;

    const accel = drive - brakeDecel * dir - drag - roll * dir - engineBrake * dir + slope - handbrakeDecel * dir;
    state.longAccel = accel;
    vf += accel * dt;
    if (brake > 0 && !reversing && Math.abs(vf) < 0.25) vf = 0;
    if (vf > topSpeed * 1.15) vf = topSpeed * 1.15;                     // the cap is soft: the car can overshoot downhill
    if (vf < -CAR.maxReverse) vf = -CAR.maxReverse;

    // --- the yaw: the bicycle model (a car standing still does not turn)
    const yawGain = handbrake ? CAR.handbrakeYaw : 1;                                // the locked rear wheels turn the car more eagerly
    const yawRate = (Math.abs(vf) > 0.15 ? (vf / CAR.wheelbase) * Math.tan(steerAngle) * yawGain : 0) * (1 - slip * 0.5);
    state.heading = wrapAngle(state.heading + yawRate * dt);

    // --- back to the world.  The velocity is rebuilt in the OLD frame: turning the car does not turn the velocity with it, the
    // angle between the two is the lateral speed the tyres have to take away next step (up to the grip: a slide beyond it).
    const ncy = Math.cos(state.heading), nsy = Math.sin(state.heading);
    state.vx = cy * vf - sy * vl;
    state.vz = sy * vf + cy * vl;
    state.x += state.vx * dt;
    state.z += state.vz * dt;

    // --- the collisions: the buildings and the play area push the car back
    // The body is two circles (the nose and the tail), not one at the centre: a 4.4 m car with one circle of 1.35 m drives its
    // bonnet into a wall.  Walls push along the normal only, so the car slides along a wall instead of sticking to it.
    if (collide) {
      for (let pass = 0; pass < 3; pass++) {
        let hit = null;
        for (const offset of CAR.bodyCircles) {
          hit = collide(state.x + ncy * offset, state.z + nsy * offset, CAR.bodyRadius, state.y - CAR.rideHeight);   // (the level of the wheels: a car on a bridge is not stopped by a wall under it)
          if (hit) break;
        }
        if (!hit) break;
        state.x += hit.nx * hit.pen; state.z += hit.nz * hit.pen;
        // the speed into the wall is lost, a little of it comes back as a bounce
        const into = state.vx * hit.nx + state.vz * hit.nz;
        if (into < 0) {
          if (-into > HIT_SOUND_SPEED && hitCool <= 0) { state.hits += 1; state.lastHitSpeed = -into; hitCool = HIT_COOLDOWN_S; }
          state.vx -= into * hit.nx * (1 + CAR.hitSpeedLoss);
          state.vz -= into * hit.nz * (1 + CAR.hitSpeedLoss);
          if (-into > CAR.crashSpeed && state.crashTime <= 0) { state.crashed = true; state.crashTime = CAR.respawnTime; }
        }
      }
    }
    // sliding scrubs the speed: the tyres that cannot hold the car drag it
    if (slip > 0) { const scrub = 1 - Math.min(0.5, slip * CAR.slideScrub * dt); state.vx *= scrub; state.vz *= scrub; }
    state.speed = state.vx * ncy + state.vz * nsy;
    state.slip = slip;
    state.braking = brake > 0.05 && !reversing && vf > 0.3;
    state.reversing = vf < -0.3 || (reversing && brake > 0);
    state.onRoad = onRoad;
    state.surface = surfaceName;
    state.speedLimit = topSpeed;
    state.gear = gearOf(state.speed);
    state.rpm = rpmOf(state.speed, state.gear, throttle);
  }

  /**
   * The ground the body rests on: the mean of the ground under the four wheels (ground.contact: the continuous height, not the lattice), each within CAR.wheelReach
   * of the ground under the centre.  One point under the
   * centre read every facet of the 1 m lattice, and beside a kerb the kerb's saw-tooth on the lattice (a kerb ridge crosses the lattice rows every 7 m on a road at
   * 8 degrees to them): a 2-8 cm step every 7 m, 20-47 m/s2 of vertical acceleration on ordinary streets (QA D01).
   */
  function groundUnderWheels() {
    const at = ground.contact || ground.height;
    const centre = at(state.x, state.z);
    const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
    const a = CAR.wheelbase / 2, b = CAR.track / 2;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const u = k < 2 ? a : -a, v = k % 2 === 0 ? b : -b;
      const h = at(state.x + cy * u - sy * v, state.z + sy * u + cy * v);
      sum += clamp(h, centre - CAR.wheelReach, centre + CAR.wheelReach);
    }
    // a body never sinks deeper than CAR.crestSink below the ground under its middle: on a sharp crest (the top of a kerb with the wheels on both sides of it, the
    // brow of a bank) the chord of the four wheels runs under the ground there
    // (the ground under the middle as it is DRAWN, the lattice: the body never dips into the drawn kerb or bank either)
    return Math.max(sum / 4, ground.height(state.x, state.z) - CAR.crestSink);
  }

  /** The vertical: the suspension follows the ground, but the car flies over a crest and lands again. */
  function updateVertical(dt) {
    const groundY = groundUnderWheels();
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
    // The attitude: the whole car lies on the slope (pitch / roll, the wheels follow), and the body moves on its suspension
    // on top of that (squat when the car accelerates, dive when it brakes, lean outwards in a corner).
    ground.normal(state.x, state.z, normal);
    const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
    const along = normal.x * cy + normal.z * sy;
    const lateral = normal.x * -sy + normal.z * cy;
    const ny = Math.max(normal.y, 0.2);
    state.pitch = lerp(state.pitch, Math.atan2(-along, ny), Math.min(1, dt * 8));
    state.roll = lerp(state.roll, Math.atan2(lateral, ny), Math.min(1, dt * 6));      // positive roll leans the right side down
    state.squat = lerp(state.squat, clamp(state.longAccel * CAR.squatGain, -CAR.squatMax, CAR.squatMax), Math.min(1, dt * 8));
    state.lean = lerp(state.lean, clamp(-state.steer * state.speed * CAR.leanGain, -CAR.leanMax, CAR.leanMax), Math.min(1, dt * 6));
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
