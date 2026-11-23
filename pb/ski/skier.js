/* Skier physics: an arcade skier on the physics surface, not a simulator. Pure functions on a plain, serialisable state object
 * (JSON-safe numbers only, so a later multiplayer round can send it as it is); a step returns a NEW state, the input is never mutated.
 *
 *   carving: the heading turns with the steering, at speed only as fast as the edges can hold (grip / speed), and the velocity is pulled
 *            towards the skis; a turn across the fall line scrubs speed (skidding)
 *   speed:   gravity along the slope, ski friction (groomed vs deep snow), air drag (upright vs tuck), extra drag in deep snow
 *   brake:   snowplough (S / down): a strong deceleration, slower turns
 *   push:    skating on flats (W / up) below 6 m/s; slow, it walks up short rises (herringbone) instead of sliding back
 *   jumps:   the skier leaves the ground where it falls away faster than gravity can follow (crests, rollers, wind drifts); the jump key (a
 *            short crouch, then) pops
 *   crashes: a trunk or rock hit above SKI.hitCrash m/s, a landing harder than SKI.hardLanding m/s -> state.crash counts down, then the
 *            caller respawns the skier on the piste
 * world = { height(x, z), normal(x, z, out), snow(x, z) -> 0..1 groomed, hit(x, z, r) -> { nx, nz, pen, kind } | null } */
import { SKI, COURSE } from './config.js';

const G = 9.81;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
const RISE_FULL = G * Math.sin(6 * Math.PI / 180), RISE_NONE = G * Math.sin(12 * Math.PI / 180);     // m/s2 of gravity against him: the assist's rise gate
const LAUNCH_OVER = 1;                 // m/s over kick.to the launch lets him reach before it ends (a steep start)
const HOCKEY_MAX = 9.5;                 // R8: m/s2, the hockey stop's strongest deceleration
const AIR_LOOK = 0.7, AIR_FAN = 0.45;    // s ahead along the flight line the piste magnet looks; rad to each side it compares
const AIR_STEER_MAX = 1.15;            // rad the skis may turn off the flight line in a plain air (the sideways fall starts at 1.45)
const HOLD_COS = Math.cos(38 * Math.PI / 180);       // round 7: steeper than this a stop can not hold (side-slip)
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createSkierState(x, z, heading, y) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, heading, grounded: true, air: 0, steer: 0, tuck: 0, brake: 0, edge: 0, crash: 0, crashKind: '',
    jumpCd: 0, jumpWind: 0, speed: 0, snow: 1, slip: 0, landed: 0, t: 0,
    // tricks (round 4A, world.tricks): rotation since the take-off (rad), grab time (s), landing judgement 0 clean / 1 sketchy, rail slid
    spin: 0, flip: 0, grab: 0, landQ: 0, rail: -1,
    hold: 1,                // round 7: standing still on the edges (a placed skier waits for input; braking to a stop holds there)
    kick: null,             // launch follow-up: the challenge launch after "0" ({ t, from, to, dur, max }, main.js pushStart)
  };
}

/** The challenge start at "0" (main.js pushStart, the same for every player and online race): out of the hold, the COURSE.push kick
 *  down the piste direction (a = piste.at(start): dx, dz), then the launch to COURSE.launchTo m/s over COURSE.launchTime s. */
export function launchState(s, a) {
  return {
    ...s, hold: 0, vx: a.dx * COURSE.push, vz: a.dz * COURSE.push, speed: COURSE.push, heading: Math.atan2(a.dz, a.dx),
    kick: { t: 0, from: COURSE.push, to: COURSE.launchTo, dur: COURSE.launchTime, max: COURSE.launchMax },
  };
}

/** Cleanup round (cliff routes): back on the snow after a landing crash, already skiing on at SKI.respawnRoll m/s along his heading
 *  (out of the standing hold): a drop costs the tumble + ~0 s, not a stand-still start below it. Returns a new state. */
export function rollOn(s) {
  const v = SKI.respawnRoll;
  return { ...s, hold: 0, vx: Math.cos(s.heading) * v, vz: Math.sin(s.heading) * v, vy: 0, speed: v };
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
  const K = world.ski || SKI;          // round 6: the ski type's numbers (modes/skis.js), else the reference set
  world.normal(s.x, s.z, n);
  const snow = world.snow(s.x, s.z);
  s.snow = snow;
  let vx = s.vx, vy = s.vy, vz = s.vz;
  let v = Math.hypot(vx, vy, vz);
  const vStart = v;                    // R8: the hockey stop's deceleration is capped against this (below)
  const grip = (K.gripPowder + (K.gripGroomed - K.gripPowder) * snow) * G * (1 - 0.35 * s.brake);

  // heading: pivots freely when slow, carves (limited by grip / speed) when fast
  const authority = (1 - s.tuck * (1 - K.tuckSteer)) * (1 - s.brake * (1 - K.brakeSteer));
  const rate = Math.min(K.pivotRate, K.carveGain * grip / Math.max(v, 0.6));
  // R8e (pose-check: held on the brake after a hockey stop, a steer key pivoted the skis back down the fall line): standing in the
  // stop the steering does not pivot him; the skis settle across the fall line (that is what holds him there)
  const settled = (s.stop || 0) > 0.5 && v < 1.2;
  s.heading = wrapAngle(s.heading + s.steer * rate * authority * dt * (settled ? 0 : 1));
  if (settled && Math.hypot(n.x, n.z) > 0.05) {
    const fall = Math.atan2(n.z, n.x), a = wrapAngle(s.heading - fall), want = fall + (a >= 0 ? Math.PI / 2 : -Math.PI / 2);
    const d = wrapAngle(want - s.heading), step = 1.5 * dt;
    s.heading = wrapAngle(s.heading + clamp(d, -step, step));
  }
  // round 7: the hockey stop: a player braking fast (or braking with a hard steer) swings both skis across the motion and digs the
  // edges in (strong deceleration, a big spray); slow, the brake stays the snowplough. Scripted input (bots, flows) never does it.
  const hockeyFrom = K.hockeyFrom || SKI.hockeyFrom || 7;
  const wantStop = input.brake && input.hard && ((v > 1.5 && (v > hockeyFrom || (Math.abs(input.steer || 0) > 0.5 && v > 4))) || (s.stop || 0) > 0.5) ? 1 : 0;      // R8: held to the end and while he stands on the brake (skis stay parallel)      // R8: once across, it stays a hockey stop to the end
  if ((s.stop || 0) < 0.05 && wantStop) {
    const mh = Math.atan2(vz, vx), off = wrapAngle(s.heading - mh);
    s.stopSide = Math.sign(input.steer || 0) || Math.sign(off) || 1;
    s.stopDir = mh;                                       // R8: the skis turn across THIS travel direction (no spin as he slows)
  }
  s.stop = approach(s.stop || 0, wantStop, wantStop ? 6 : 3, dt);
  if (s.stop > 0.01 && v > 1.2) {
    const target = (s.stopDir !== undefined ? s.stopDir : Math.atan2(vz, vx)) + (s.stopSide || 1) * Math.PI / 2 * 0.9;
    const d = wrapAngle(target - s.heading), maxStep = (K.hockeyTurn || SKI.hockeyTurn || 7.5) * s.stop * dt;
    s.heading = wrapAngle(s.heading + clamp(d, -maxStep, maxStep));
  }

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
    const want = theta * (1 - Math.exp(-K.edgeLock * dt));
    const maxTurn = grip * dt / v;
    const turn = clamp(want, -maxTurn, maxTurn);
    const nt = theta - turn;
    slip = Math.abs(Math.sin(nt));
    // cheaper clean carving (physics review; Ian: yes): only the slip beyond carveFree (the sine of ~1.7 degrees) is scrubbed. The
    // velocity follows the skis with a lag (edgeLock), so every clean turn carried 2-6 degrees of slip and paid ~15 % of the speed
    // per 90 degrees; braking and the hockey stop scrub as before (the free part fades out with them).
    const taxed = Math.max(0, slip - (K.carveFree ?? SKI.carveFree) * (1 - s.brake) * (1 - (s.stop || 0)));
    const scrub = K.skidLoss * taxed * (0.6 + 1.4 * s.brake) * dt * 1.6 * (1 - 0.6 * (s.stop || 0));      // R8: a hockey stop scrubs over ~1.5 s, not a wall
    const sp = v * Math.max(0, 1 - scrub);
    const c = Math.cos(nt), si = Math.sin(nt);
    vx = (fx * c + lx * si) * sp; vy = (fy * c + ly * si) * sp; vz = (fz * c + lz * si) * sp;
  }
  s.slip = slip;

  // resistances along the motion
  v = Math.hypot(vx, vy, vz);
  if (v > 1e-4) {
    const mu = K.muPowder + (K.muGroomed - K.muPowder) * snow;
    const cda = K.cdaUpright + (K.cdaTuck - K.cdaUpright) * s.tuck;
    let dec = mu * G * n.y + 0.5 * K.airDensity * cda * v * v / K.mass + (1 - snow) * K.powderDrag * v * v;
    dec += (K.brakeDecel + 0.9 * G * Math.sqrt(Math.max(0, 1 - n.y * n.y))) * s.brake * smoothstep(0, 0.5, v) * (1 - 0.6 * (s.stop || 0))      /* round 7: the edges hold against the slope: a full stop on any piste */ + (K.hockeyDecel || SKI.hockeyDecel || 5.5) * (s.stop || 0) * smoothstep(0.5, 3, v);
    const nv = Math.max(0, v - dec * dt);
    const k = nv / v;
    vx *= k; vy *= k; vz *= k;
    v = nv;
  }
  // R8 (early QA: 33 -> 0 km/h in 0.6 s, a wall): a hockey stop bites at most HOCKEY_MAX m/s2 (33 km/h -> 0 in ~1.4 s)
  if ((s.stop || 0) > 0.05 && v > 1e-4 && v < vStart - HOCKEY_MAX * dt) { const k = Math.max(0, vStart - HOCKEY_MAX * dt) / v; vx *= k; vy *= k; vz *= k; v *= k; }
  // round 7: a full stop that holds. Braking below walking pace sets the edges (plough or sideways): 0 km/h, and he stays there,
  // on any piste slope, until the player steers, pushes, tucks or jumps (a placed skier starts in this hold too). Only very steep
  // ground (> HOLD_MAX degrees, off piste) is too steep to hold: there he side-slips slowly.
  const moving = (input.push || 0) > 0 || (input.tuck || 0) > 0 || Math.abs(input.steer || 0) > 0.05 || !!input.jump;
  const holdable = n.y > HOLD_COS;
  if (moving || !holdable) s.hold = 0;
  else if (input.brake && v < 0.9) s.hold = 1;
  if (s.hold) { vx = 0; vy = 0; vz = 0; v = 0; }
  // skating on the flat
  if ((input.push || 0) > 0 && v < K.pushMaxSpeed && s.brake < 0.5) {
    let a = K.pushAccel * input.push * (1 - v / K.pushMaxSpeed);
    // herringbone / side-step: slow, the skier walks up a short rise (a flat with a bump, the way back onto the piste) instead of
    // sliding back: the push also beats the slope and the snow friction, up to K.climbMax
    if (v < K.climbSpeed) {
      const gf = G * n.y * (n.x * fx + n.z * fz) + (-G + G * n.y * n.y) * fy;          // gravity along the skis (< 0: uphill)
      const mu = K.muPowder + (K.muGroomed - K.muPowder) * snow;
      if (gf < 0.3) a += Math.min(Math.max(0, -gf) + mu * G * n.y, K.climbMax) * input.push * (1 - v / K.climbSpeed * 0.5);
    }
    vx += fx * a * dt; vy += fy * a * dt; vz += fz * a * dt;
  }
  // launch follow-up (Ian: "accelerate faster to at least ~45 km/h"): the arcade assist below K.assistTo. Along the motion (the skis
  // when slow), gated by the slope along it: downhill (>= ~1 degree) on its own; with push / tuck held also on flats and rises (full up
  // to a 6 degree rise, gone at 12: well inside the herringbone's ~20 degree climb limit; OSM links that climb through a dip were a
  // 100 m crawl at 8 km/h); never braking, in a stop or in the edge hold
  const quiet = !input.brake && s.brake < 0.05 && (s.stop || 0) < 0.02 && !s.hold;
  if (quiet && !s.kick && (K.assistAccel || 0) > 0 && v < K.assistTo) {                 // the launch below has its own curve
    const moves = v > 1.2;
    const dx = moves ? vx / v : fx, dy = moves ? vy / v : fy, dz = moves ? vz / v : fz;
    const gAlong = -G * dy;                                               // m/s2 of gravity along that direction (< 0: uphill)
    const wants = (input.push || 0) > 0 || (input.tuck || 0) > 0;
    const gate = wants ? 1 - smoothstep(RISE_FULL, RISE_NONE, -gAlong) : smoothstep(0.05, 0.25, gAlong);
    const a = (K.assistAccel + (K.assistFlat || 0) * (1 - smoothstep(0, RISE_FULL, gAlong))) * gate * (1 - smoothstep(K.assistFull, K.assistTo, v));
    if (a > 0) { vx += dx * a * dt; vy += dy * a * dt; vz += dz * a * dt; }
  }
  // the challenge launch (main.js pushStart: state.kick = { t, from, to, dur, max }): the speed follows an S-curve from the push to
  // kick.to over kick.dur s; only what gravity and the assist do not give is added (at most kick.max m/s2); braking ends it
  if (s.kick) {
    const k = s.kick, t = k.t + dt;
    if (input.brake || s.hold || t > k.dur + 0.3) s.kick = null;
    else {
      s.kick = { ...k, t };
      const want = k.from + (k.to - k.from) * smoothstep(0, k.dur, t);
      const vNow = Math.hypot(vx, vy, vz);
      if (vNow < want) {
        const add = Math.min(want - vNow, k.max * dt);
        const dx = vNow > 1e-3 ? vx / vNow : fx, dy = vNow > 1e-3 ? vy / vNow : fy, dz = vNow > 1e-3 ? vz / vNow : fz;
        vx += dx * add; vy += dy * add; vz += dz * add;
      } else if (vNow > k.to + LAUNCH_OVER) {           // a steep start: the same launch speed for everyone until the curve ends
        const c = (k.to + LAUNCH_OVER) / vNow; vx *= c; vy *= c; vz *= c;
      }
    }
  }
  // keep the velocity in the slope plane, cap
  const vn = vx * n.x + vy * n.y + vz * n.z;
  vx -= vn * n.x; vy -= vn * n.y; vz -= vn * n.z;
  v = Math.hypot(vx, vy, vz);
  if (v > K.maxSpeed) { const k = K.maxSpeed / v; vx *= k; vy *= k; vz *= k; v = K.maxSpeed; }

  // move, then stay on the ground or take off
  const nx2 = s.x + vx * dt, nz2 = s.z + vz * dt;
  const ground = world.height(nx2, nz2);
  const n0y = n.y, n0x = n.x, n0z = n.z;
  world.normal(nx2, nz2, n);
  const vyNext = -(n.x * vx + n.z * vz) / n.y;               // vertical speed that follows the (smoothed) slope at the new point
  const vyNow = -(n0x * vx + n0z * vz) / n0y;
  const fallAway = (vyNext - vyNow) / dt;                     // < 0: the ground drops away
  s.x = nx2; s.z = nz2;
  // launch fix (Ian, iPad: "the jump is like a crouch"): the jump key is a short crouch (K.jumpWind s, the model dips) and then the
  // pop off the snow, at any speed (standing too); one press = one jump, released or not during the crouch
  let pop = false;
  if (s.jumpWind > 0) { s.jumpWind = Math.max(0, s.jumpWind - dt); pop = s.jumpWind <= 1e-9; if (pop) s.jumpWind = 0; }
  else if (input.jump && s.jumpCd <= 0) s.jumpWind = K.jumpWind ?? SKI.jumpWind;
  if (pop) {
    s.vx = vx + n.x * K.jumpPop; s.vy = vyNow + n.y * K.jumpPop; s.vz = vz + n.z * K.jumpPop;
    s.y = Math.max(ground, s.y + vyNow * dt) + 0.02;
    s.grounded = false; s.air = 0; s.jumpCd = K.jumpCooldown;
    s.spin = 0; s.flip = 0; s.grab = 0;
  } else if (fallAway < -K.leaveGround * G && v > 6) {
    s.vx = vx; s.vy = vyNow; s.vz = vz;
    s.y = Math.max(ground, s.y + vyNow * dt);
    s.grounded = false; s.air = 0;
    s.spin = 0; s.flip = 0; s.grab = 0;
  } else {
    s.vx = vx; s.vy = vyNext; s.vz = vz;
    s.y = ground;
  }
  s.speed = v;
  s.edge = approach(s.edge, clamp(s.steer * rate * authority * v / G, -1.1, 1.1) * (1 - (s.stop || 0)) + (s.stopSide || 1) * 1.0 * (s.stop || 0), 8, dt);
  return collide(s, world);
}

function airStep(s, input, world, dt) {
  const K = world.ski || SKI;
  s.air += dt;
  s.jumpWind = 0;                                             // (a crest took him off during the crouch: no pop on landing)
  s.vy -= G * dt;
  const v = Math.hypot(s.vx, s.vy, s.vz);
  const cda = K.cdaUpright + (K.cdaTuck - K.cdaUpright) * s.tuck;
  let k = Math.max(0, 1 - 0.5 * K.airDensity * cda * v / K.mass * dt);
  if (v * k > K.maxSpeed) k = K.maxSpeed / v;                 // the hard cap holds in the air too (a long crest air fell past it)
  s.vx *= k; s.vy *= k; s.vz *= k;
  // round 6: free ride = 'hold': the air turns into a trick only while the trick button is held (or a rotation is already going)
  const tricks = world.tricks === true || (world.tricks === 'hold' && (input.trick || Math.abs(s.spin || 0) > 0.05 || Math.abs(s.flip || 0) > 0.05));
  if (tricks) {
    // snow park / free ride: steering spins (fast), up / down flips, the trick button grabs; judged at the landing
    // (the raw input, not the smoothed steer: a spin stops when the key is let go); without input the rotation settles onto the
    // nearest half turn / whole flip when it is close (a little landing help)
    const steer = clamp(input.steer || 0, -1, 1), pitch = clamp(input.pitch || 0, -1, 1);
    let turn = steer * K.spinRate * dt;
    if (Math.abs(steer) < 0.15) { const r = (s.spin || 0) - Math.round((s.spin || 0) / Math.PI) * Math.PI; if (Math.abs(r) < 0.9) turn = -Math.sign(r) * Math.min(Math.abs(r), K.spinSettle * dt); }
    s.heading = wrapAngle(s.heading + turn);
    s.spin = (s.spin || 0) + turn;
    let flipTurn = pitch * K.flipRate * dt;
    if (Math.abs(pitch) < 0.15) { const r = wrapAngle(s.flip || 0); if (Math.abs(r) < 1.4) flipTurn = -Math.sign(r) * Math.min(Math.abs(r), K.flipSettle * dt); }
    s.flip = (s.flip || 0) + flipTurn;
    s.grab = input.trick ? (s.grab || 0) + dt : s.grab || 0;
  } else {
    // style only: the skis turn in the air, the flight line does not. Physics review after launch: they stop turning AIR_STEER_MAX
    // off the flight line (steering held through a long air, 1.3 s at full steer, used to end in the "sideways" fall at 1.45 rad)
    const travel = Math.atan2(s.vz, s.vx), fast = Math.hypot(s.vx, s.vz) > 1;
    const next = wrapAngle(s.heading + (input.steer || 0) * 1.1 * dt);
    const offNow = Math.abs(wrapAngle(s.heading - travel)), offNext = Math.abs(wrapAngle(next - travel));
    if (!fast || offNext <= AIR_STEER_MAX || offNext < offNow || offNow > Math.PI / 2) s.heading = next;
    // air control (with the crest airs): the steering bends the flight line a little (airSteer rad/s at full steer, the speed stays),
    // and a mild piste magnet: he took off on the piste and the flight ends in deep snow -> the line bends towards the side that is
    // still groomed (airMagnet rad/s). A bend with a crest in it no longer throws a run off the piste.
    const hv = Math.hypot(s.vx, s.vz);
    if (hv > 3) {
      let turn = clamp(input.steer || 0, -1, 1) * (K.airSteer ?? SKI.airSteer);
      const magnet = K.airMagnet ?? SKI.airMagnet;
      if (magnet > 0 && s.snow > 0.5) {
        const reach = hv * AIR_LOOK, a = Math.atan2(s.vz, s.vx);
        if (world.snow(s.x + Math.cos(a) * reach, s.z + Math.sin(a) * reach) < 0.5) {
          const left = world.snow(s.x + Math.cos(a + AIR_FAN) * reach, s.z + Math.sin(a + AIR_FAN) * reach);
          const right = world.snow(s.x + Math.cos(a - AIR_FAN) * reach, s.z + Math.sin(a - AIR_FAN) * reach);
          if (Math.abs(left - right) > 0.1) turn += Math.sign(left - right) * magnet;
        }
      }
      if (turn !== 0) {
        const c = Math.cos(turn * dt), si = Math.sin(turn * dt), vx = s.vx * c - s.vz * si, vz = s.vx * si + s.vz * c;
        s.vx = vx; s.vz = vz;
        s.heading = wrapAngle(s.heading + turn * dt);
      }
    }
  }
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  s.edge = approach(s.edge, 0, 3, dt);
  const ground = world.height(s.x, s.z);
  // launch fix: right after a pop he rises from ~2 cm over the snow: within stickGap the old check landed him the next step (the
  // jump key only ever showed the crouch); rising from a pop (the first 0.2 s) he only stays on top of the snow (crests: unchanged)
  let rising = false;
  if (s.air < 0.2 && s.jumpCd > (K.jumpCooldown ?? SKI.jumpCooldown) - 0.2) { world.normal(s.x, s.z, n); rising = s.vx * n.x + s.vy * n.y + s.vz * n.z > 0.5; }      // popped, moving away from the slope
  if (rising && s.y < ground) s.y = ground;
  // crest air (physics review after launch; Ian: yes): he left the ground because it falls away faster than gravity (groundStep), but
  // a step later he is still within stickGap of it and the old check landed him again at once: crests and rollers only ever gave
  // 0.01 s "airs" (a 12 -> 30 degree break held him down up to 110 km/h). Still moving away from the slope faster than crestLeave he
  // flies on; a gentle roller (slower than that) keeps him on the snow.
  // On the piste a crest only throws him where the piste goes on straight ahead (groomed snow 0.5 and 1 s down the flight line): a
  // path across a steep hillside or a bend with a crest in it keeps him on the snow, as before (Arlberg's Hoppelweg flew him 60 m
  // down the hillside beside the path). Off the piste every crest counts.
  if (!rising && s.y > ground && s.y <= ground + K.stickGap) {
    world.normal(s.x, s.z, n);
    rising = s.vx * n.x + s.vy * n.y + s.vz * n.z > (K.crestLeave ?? SKI.crestLeave)
      && (s.snow < 0.5 || (world.snow(s.x + s.vx * 0.5, s.z + s.vz * 0.5) >= 0.5 && world.snow(s.x + s.vx, s.z + s.vz) >= 0.5));
  }
  if (!rising && s.y <= ground + K.stickGap) {
    world.normal(s.x, s.z, n);
    const into = -(s.vx * n.x + s.vy * n.y + s.vz * n.z);
    s.y = ground;
    s.vx += into * n.x; s.vy += into * n.y; s.vz += into * n.z;        // the speed into the slope is absorbed by the legs
    const hv = Math.hypot(s.vx, s.vz);
    const off = hv > 1 ? Math.abs(wrapAngle(Math.atan2(s.vz, s.vx) - s.heading)) : 0;
    s.grounded = true; s.landed = 0.35;
    if (tricks) {
      // a spin must end near a whole half turn (a switch landing is fine), a flip near a whole turn; still grabbing: sketchy
      const sres = hv > 3 ? Math.min(off, Math.PI - off) : 0;
      const fres = Math.abs(wrapAngle(s.flip || 0));
      s.flip = 0;
      if (into > K.parkHardLanding || sres > K.spinCrash || fres > K.flipCrash) { s.landQ = 2; return startCrash(s, fres > K.flipCrash ? 'flip' : into > K.parkHardLanding ? 'landing' : 'sideways'); }
      s.landQ = sres > K.spinClean || fres > K.flipClean || into > K.parkHardLanding * 0.7 || input.trick ? 1 : 0;
      if (off > Math.PI / 2) s.heading = wrapAngle(s.heading + Math.PI);  // landed switch: the skier turns round (forgiving)
      s.speed = Math.hypot(s.vx, s.vy, s.vz);
      return collide(s, world);
    }
    // with the crest airs: a normal air (up to softAir s) lands softer than a long fall. Crests throw him into run-outs and
    // counter-slopes at speed (11-16 m/s into the snow after 0.7-2.5 s): the legs take up to softLanding; a fall off a cliff keeps hardLanding
    const hard = s.air <= (K.softAir ?? SKI.softAir) ? Math.max(K.hardLanding, K.softLanding ?? SKI.softLanding) : K.hardLanding;
    if (into > hard || (off > 1.45 && off < Math.PI - 0.3 && hv > 9)) return into > hard ? startCrash(s, 'landing', SKI.landingCrashSeconds) : startCrash(s, 'sideways');
    if (off > Math.PI / 2) s.heading = wrapAngle(s.heading + Math.PI);  // landed backwards at low angle: turn the skis round (forgiving)
  }
  s.speed = Math.hypot(s.vx, s.vy, s.vz);
  return collide(s, world);
}

function collide(s, world) {
  const K = world.ski || SKI;
  const hit = world.hit(s.x, s.z, K.bodyRadius, s.y);
  if (!hit) return s;
  const into = -(s.vx * hit.nx + s.vz * hit.nz);
  if (into > K.hitCrash) { s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen; return startCrash(s, hit.kind); }
  s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen;
  if (into > 0) { s.vx += into * hit.nx; s.vz += into * hit.nz; }
  return s;
}

function startCrash(s, kind, seconds = SKI.crashSeconds) {
  s.crash = seconds; s.crashKind = kind;
  return s;
}

/** Tumbling: slides to a stop on the ground. */
function crashStep(s, world, dt) {
  const K = world.ski || SKI;
  s.crash = Math.max(0, s.crash - dt);
  const k = Math.max(0, 1 - 2.6 * dt);
  s.vx *= k; s.vz *= k; s.vy = 0;
  s.x += s.vx * dt; s.z += s.vz * dt;
  s.y = world.height(s.x, s.z);
  s.grounded = true;
  s.speed = Math.hypot(s.vx, s.vz);
  const hit = world.hit(s.x, s.z, K.bodyRadius, s.y);
  if (hit) { s.x += hit.nx * hit.pen; s.z += hit.nz * hit.pen; s.vx = 0; s.vz = 0; }
  return s;
}

export const kmh = (s) => s.speed * 3.6;
