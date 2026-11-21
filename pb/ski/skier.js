/* Skier physics: an arcade skier on the physics surface, not a simulator. Pure functions on a plain, serialisable state object
 * (JSON-safe numbers only, so a later multiplayer round can send it as it is); a step returns a NEW state, the input is never mutated.
 *
 *   carving: the heading turns with the steering, at speed only as fast as the edges can hold (grip / speed), and the velocity is pulled
 *            towards the skis; a turn across the fall line scrubs speed (skidding)
 *   speed:   gravity along the slope, ski friction (groomed vs deep snow), air drag (upright vs tuck), extra drag in deep snow
 *   brake:   snowplough (S / down): a strong deceleration, slower turns
 *   push:    skating on flats (W / up) below 6 m/s; slow, it walks up short rises (herringbone) instead of sliding back
 *   jumps:   the skier leaves the ground where it falls away faster than gravity can follow (crests, rollers, wind drifts); the jump key pops
 *   crashes: a trunk or rock hit above SKI.hitCrash m/s, a landing harder than SKI.hardLanding m/s -> state.crash counts down, then the
 *            caller respawns the skier on the piste
 * world = { height(x, z), normal(x, z, out), snow(x, z) -> 0..1 groomed, hit(x, z, r) -> { nx, nz, pen, kind } | null } */
import { SKI } from './config.js';

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createSkierState(x, z, heading, y) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, heading, grounded: true, air: 0, steer: 0, tuck: 0, brake: 0, edge: 0, crash: 0, crashKind: '',
    jumpCd: 0, speed: 0, snow: 1, slip: 0, landed: 0, t: 0,
  };
}

/** A copy that is safe to send / store (numbers and strings only). */
export const serialise = (s) => JSON.parse(JSON.stringify(s));

const n = { x: 0, y: 1, z: 0 };

/** One fixed step. input = { steer -1..1, tuck 0..1, brake 0..1, push 0..1, jump bool }. Returns the next state. */
export function stepSkier(prev, input, world, dt = SKI.dt) {
  const s = { ...prev, t: prev.t + dt, landed: Math.max(0, prev.landed - dt), jumpCd: Math.max(0, prev.jumpCd - dt) };
  if (s.crash > 0) return crashStep(s, world, dt);
  s.steer = approach(s.steer, clamp(input.steer || 0, -1, 1), 7, dt);
  s.tuck = approach(s.tuck, input.tuck ? 1 : 0, 5, dt);
  s.brake = approach(s.brake, input.brake ? 1 : 0, 6, dt);
  return s.grounded ? groundStep(s, input, world, dt) : airStep(s, input, world, dt);
}

function groundStep(s, input, world, dt) {
  world.normal(s.x, s.z, n);
  const snow = world.snow(s.x, s.z);
  s.snow = snow;
  let vx = s.vx, vy = s.vy, vz = s.vz;
  let v = Math.hypot(vx, vy, vz);
  const grip = (SKI.gripPowder + (SKI.gripGroomed - SKI.gripPowder) * snow) * G * (1 - 0.35 * s.brake);

  // heading: pivots freely when slow, carves (limited by grip / speed) when fast
  const authority = (1 - s.tuck * (1 - SKI.tuckSteer)) * (1 - s.brake * (1 - SKI.brakeSteer));
  const rate = Math.min(SKI.pivotRate, SKI.carveGain * grip / Math.max(v, 0.6));
  s.heading = wrapAngle(s.heading + s.steer * rate * authority * dt);

  // skis direction in the slope plane, and the lateral axis
  let fx = Math.cos(s.heading), fz = Math.sin(s.heading), fy = 0;
  const fn = fx * n.x + fz * n.z;
  fx -= fn * n.x; fy -= fn * n.y; fz -= fn * n.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const lx = n.y * fz - n.z * fy, ly = n.z * fx - n.x * fz, lz = n.x * fy - n.y * fx;     // n x f

  // gravity along the slope
  vx += -(-G * n.y) * n.x * dt; vy += (-G - (-G * n.y) * n.y) * dt; vz += -(-G * n.y) * n.z * dt;

  // edges: rotate the velocity towards the skis (carve), scrub what the grip cannot hold (skid)
  v = Math.hypot(vx, vy, vz);
  let slip = 0;
  if (v < 1.2) {
    const fwd = vx * fx + vy * fy + vz * fz;
    const keep = Math.max(0, fwd);
    vx = fx * keep; vy = fy * keep; vz = fz * keep;
  } else {
    const vf = vx * fx + vy * fy + vz * fz, vl = vx * lx + vy * ly + vz * lz;
    const theta = Math.atan2(vl, vf);
    const want = theta * (1 - Math.exp(-SKI.edgeLock * dt));
    const maxTurn = grip * dt / v;
    const turn = clamp(want, -maxTurn, maxTurn);
    const nt = theta - turn;
    slip = Math.abs(Math.sin(nt));
    const scrub = SKI.skidLoss * slip * (0.6 + 1.4 * s.brake) * dt * 1.6;
    const sp = v * Math.max(0, 1 - scrub);
    const c = Math.cos(nt), si = Math.sin(nt);
    vx = (fx * c + lx * si) * sp; vy = (fy * c + ly * si) * sp; vz = (fz * c + lz * si) * sp;
  }
  s.slip = slip;

  // resistances along the motion
  v = Math.hypot(vx, vy, vz);
  if (v > 1e-4) {
    const mu = SKI.muPowder + (SKI.muGroomed - SKI.muPowder) * snow;
    const cda = SKI.cdaUpright + (SKI.cdaTuck - SKI.cdaUpright) * s.tuck;
    let dec = mu * G * n.y + 0.5 * SKI.airDensity * cda * v * v / SKI.mass + (1 - snow) * SKI.powderDrag * v * v;
    dec += SKI.brakeDecel * s.brake * smoothstep(0, 2.5, v);
    const nv = Math.max(0, v - dec * dt);
    const k = nv / v;
    vx *= k; vy *= k; vz *= k;
    v = nv;
  }
  // skating on the flat
  if ((input.push || 0) > 0 && v < SKI.pushMaxSpeed && s.brake < 0.5) {
    let a = SKI.pushAccel * input.push * (1 - v / SKI.pushMaxSpeed);
    // herringbone / side-step: slow, the skier walks up a short rise (a flat with a bump, the way back onto the piste) instead of
    // sliding back: the push also beats the slope and the snow friction, up to SKI.climbMax
    if (v < SKI.climbSpeed) {
      const gf = G * n.y * (n.x * fx + n.z * fz) + (-G + G * n.y * n.y) * fy;          // gravity along the skis (< 0: uphill)
      const mu = SKI.muPowder + (SKI.muGroomed - SKI.muPowder) * snow;
      if (gf < 0.3) a += Math.min(Math.max(0, -gf) + mu * G * n.y, SKI.climbMax) * input.push * (1 - v / SKI.climbSpeed * 0.5);
    }
    vx += fx * a * dt; vy += fy * a * dt; vz += fz * a * dt;
  }
  // keep the velocity in the slope plane, cap
  const vn = vx * n.x + vy * n.y + vz * n.z;
  vx -= vn * n.x; vy -= vn * n.y; vz -= vn * n.z;
  v = Math.hypot(vx, vy, vz);
  if (v > SKI.maxSpeed) { const k = SKI.maxSpeed / v; vx *= k; vy *= k; vz *= k; v = SKI.maxSpeed; }

  // move, then stay on the ground or take off
  const nx2 = s.x + vx * dt, nz2 = s.z + vz * dt;
  const ground = world.height(nx2, nz2);
  const n0y = n.y, n0x = n.x, n0z = n.z;
  world.normal(nx2, nz2, n);
  const vyNext = -(n.x * vx + n.z * vz) / n.y;               // vertical speed that follows the (smoothed) slope at the new point
  const vyNow = -(n0x * vx + n0z * vz) / n0y;
  const fallAway = (vyNext - vyNow) / dt;                     // < 0: the ground drops away
  s.x = nx2; s.z = nz2;
  if (input.jump && s.jumpCd <= 0 && v > 1) {
    s.vx = vx + n.x * SKI.jumpPop; s.vy = vyNow + n.y * SKI.jumpPop; s.vz = vz + n.z * SKI.jumpPop;
    s.y = Math.max(ground, s.y + vyNow * dt) + 0.02;
    s.grounded = false; s.air = 0; s.jumpCd = SKI.jumpCooldown;
  } else if (fallAway < -SKI.leaveGround * G && v > 6) {
    s.vx = vx; s.vy = vyNow; s.vz = vz;
    s.y = Math.max(ground, s.y + vyNow * dt);
    s.grounded = false; s.air = 0;
  } else {
    s.vx = vx; s.vy = vyNext; s.vz = vz;
    s.y = ground;
  }
  s.speed = v;
  s.edge = approach(s.edge, clamp(s.steer * rate * authority * v / G, -1.1, 1.1), 8, dt);
  return collide(s, world);
}

function airStep(s, input, world, dt) {
  s.air += dt;
  s.vy -= G * dt;
  const v = Math.hypot(s.vx, s.vy, s.vz);
  const cda = SKI.cdaUpright + (SKI.cdaTuck - SKI.cdaUpright) * s.tuck;
  const k = Math.max(0, 1 - 0.5 * SKI.airDensity * cda * v / SKI.mass * dt);
  s.vx *= k; s.vy *= k; s.vz *= k;
  s.heading = wrapAngle(s.heading + (input.steer || 0) * 1.1 * dt);      // style only: the skis turn in the air, the flight line does not
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  s.edge = approach(s.edge, 0, 3, dt);
  const ground = world.height(s.x, s.z);
  if (s.y <= ground + SKI.stickGap) {
    world.normal(s.x, s.z, n);
    const into = -(s.vx * n.x + s.vy * n.y + s.vz * n.z);
    s.y = ground;
    s.vx += into * n.x; s.vy += into * n.y; s.vz += into * n.z;        // the speed into the slope is absorbed by the legs
    const hv = Math.hypot(s.vx, s.vz);
    const off = hv > 1 ? Math.abs(wrapAngle(Math.atan2(s.vz, s.vx) - s.heading)) : 0;
    s.grounded = true; s.landed = 0.35;
    if (into > SKI.hardLanding || (off > 1.45 && off < Math.PI - 0.3 && hv > 9)) return startCrash(s, into > SKI.hardLanding ? 'landing' : 'sideways');
    if (off > Math.PI / 2) s.heading = wrapAngle(s.heading + Math.PI);  // landed backwards at low angle: turn the skis round (forgiving)
  }
  s.speed = Math.hypot(s.vx, s.vy, s.vz);
  return collide(s, world);
}

function collide(s, world) {
  const hit = world.hit(s.x, s.z, SKI.bodyRadius, s.y);
  if (!hit) return s;
  const into = -(s.vx * hit.nx + s.vz * hit.nz);
  if (into > SKI.hitCrash) { s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen; return startCrash(s, hit.kind); }
  s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen;
  if (into > 0) { s.vx += into * hit.nx; s.vz += into * hit.nz; }
  return s;
}

function startCrash(s, kind) {
  s.crash = SKI.crashSeconds; s.crashKind = kind;
  return s;
}

/** Tumbling: slides to a stop on the ground. */
function crashStep(s, world, dt) {
  s.crash = Math.max(0, s.crash - dt);
  const k = Math.max(0, 1 - 2.6 * dt);
  s.vx *= k; s.vz *= k; s.vy = 0;
  s.x += s.vx * dt; s.z += s.vz * dt;
  s.y = world.height(s.x, s.z);
  s.grounded = true;
  s.speed = Math.hypot(s.vx, s.vz);
  const hit = world.hit(s.x, s.z, SKI.bodyRadius, s.y);
  if (hit) { s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen; s.vx = 0; s.vz = 0; }
  return s;
}

export const kmh = (s) => s.speed * 3.6;
