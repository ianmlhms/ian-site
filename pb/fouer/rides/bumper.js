/* Autoscooter physics-lite (pure, no THREE, no DOM; tested by harness-rides.js): you steer car 0, the others are driven by a simple AI.
 * Frame = the hall model's local frame (x right, z towards the front/alley, yaw 0 looks along +z, forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw)).
 * Cars are circles; a car-car hit swaps the normal speeds (restitution), pushes the circles apart and reports an event; the barrier bounces too.
 * Steering is a rate: the car turns only while it rolls. The tyres grip sideways (a bumper car slides a little). */

export const BUMPER = Object.freeze({
  radius: 0.95, accel: 7.5, reverseAccel: 4, vMax: 6.4, vReverse: 2.2, drag: 0.35, coast: 1.2, grip: 5.5, steerRate: 2.1, steerLowSpeed: 2.0,
  restitution: 0.72, wallRestitution: 0.5, bumpMin: 1.1, bumpCooldown: 0.4, aiSpeed: [2.6, 4.6], aiSteer: 1.6, mass: 1,
});

/** small deterministic generator (mulberry32) */
export function makeRandom(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** the driving arena from the model's `floor` rectangle ({ x0, x1, z0, z1 }): the padded barrier sits on its edge */
export function arenaOf(floor, inset = 0.5) { return { x0: floor.x0 + inset, x1: floor.x1 - inset, z0: floor.z0 + inset, z1: floor.z1 - inset }; }

/** one car's dynamics for dt with throttle (-1..1) and steer (-1..1; + = right turn, a right turn lowers yaw) */
export function driveCar(car, throttle, steer, dt, cfg = BUMPER) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
  let vf = car.vx * fx + car.vz * fz, vl = car.vx * rx + car.vz * rz;
  if (throttle > 0) vf += throttle * cfg.accel * dt * (vf < 0 ? 2 : 1);
  else if (throttle < 0) vf += throttle * (vf > 0 ? cfg.accel * 1.4 : cfg.reverseAccel) * dt;
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), cfg.coast * dt);
  vf *= Math.exp(-cfg.drag * dt);
  vl *= Math.exp(-cfg.grip * dt);
  vf = clamp(vf, -cfg.vReverse, cfg.vMax);
  car.vx = fx * vf + rx * vl; car.vz = fz * vf + rz * vl;
  const turn = steer * cfg.steerRate * clamp(Math.abs(vf) / cfg.steerLowSpeed, 0, 1) * Math.sign(vf || 1);
  car.yaw = wrapAngle(car.yaw - turn * dt);
  car.speed = Math.hypot(car.vx, car.vz);
  car.slip = vl;
}

export function createBumper({ floor, count = 8, seed = 1, cfg = BUMPER, playerStart = null } = {}) {
  const arena = arenaOf(floor);
  const rnd = makeRandom(seed * 7919 + 13);
  const cars = [];
  const cols = 4, spanX = (arena.x1 - arena.x0 - 4), spanZ = (arena.z1 - arena.z0 - 3) - 3.4;          // the strip at the front (where the player starts) stays free of cars
  for (let i = 0; i < count; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = arena.x0 + 2 + spanX * (c + 0.5 + (r % 2) * 0.25) / cols * (1 / 1) + (rnd() - 0.5) * 1.2;
    const z = arena.z0 + 1.5 + spanZ * (r + 0.5) / Math.ceil(count / cols) + (rnd() - 0.5) * 0.8;
    cars.push({ x: clamp(x, arena.x0 + cfg.radius, arena.x1 - cfg.radius), z: clamp(z, arena.z0 + cfg.radius, arena.z1 - cfg.radius), yaw: rnd() * Math.PI * 2 - Math.PI, vx: 0, vz: 0, speed: 0, slip: 0,
      ai: { until: 0, steer: 0, target: 2.6 + rnd() * 2, bias: 0, hunt: rnd() < 0.4, wx: 0, wz: 0 } });
  }
  const start = playerStart ?? { x: (arena.x0 + arena.x1) / 2, z: arena.z1 - cfg.radius - 0.3, yaw: Math.PI };
  Object.assign(cars[0], { x: start.x, z: start.z, yaw: start.yaw, vx: 0, vz: 0 });
  cars[0].ai = null;
  const events = [];
  const cool = new Map();                              // per car / per pair: when the next bump may be reported (a car pressed into the barrier would otherwise report every frame)
  const mayBump = (key, now) => { if ((cool.get(key) ?? 0) > now) return false; cool.set(key, now + cfg.bumpCooldown); return true; };
  const stats = { time: 0, bumps: 0, playerBumps: 0, wallBumps: 0, carBumps: 0, distance: 0, topSpeed: 0, hardest: 0 };

  function aiThink(car, i, now) {
    const ai = car.ai;
    if (now < ai.until) return;
    ai.until = now + 0.8 + rnd() * 2.2;
    ai.target = cfg.aiSpeed[0] + rnd() * (cfg.aiSpeed[1] - cfg.aiSpeed[0]);
    // spread out: head for the emptiest of three random spots on the floor (a bigger floor with 9 - 11 cars should not turn into one pile)
    let bestSpot = null, bestGap = -1;
    for (let k = 0; k < 3; k++) {
      const wx = arena.x0 + 1.5 + rnd() * (arena.x1 - arena.x0 - 3), wz = arena.z0 + 1.5 + rnd() * (arena.z1 - arena.z0 - 3);
      let gap = 1e9; for (let j = 0; j < cars.length; j++) if (j !== i) gap = Math.min(gap, Math.hypot(cars[j].x - wx, cars[j].z - wz));
      if (gap > bestGap) { bestGap = gap; bestSpot = [wx, wz]; }
    }
    ai.wx = bestSpot[0]; ai.wz = bestSpot[1];
    let steer = clamp(-wrapAngle(Math.atan2(ai.wx - car.x, ai.wz - car.z) - car.yaw) * 1.3, -1, 1) + (rnd() - 0.5) * 0.4;
    if (ai.hunt && now > 5 && rnd() < 0.5) {                      // nobody hunts the player in the first seconds: he gets to roll off the start                    // go for the nearest other car (mostly the player)
      let best = null, bd = 1e9;
      for (let j = 0; j < cars.length; j++) { if (j === i) continue; const d = Math.hypot(cars[j].x - car.x, cars[j].z - car.z) - (j === 0 ? 3 : 0); if (d < bd) { bd = d; best = cars[j]; } }
      if (best) { const want = Math.atan2(best.x - car.x, best.z - car.z); steer = clamp(-wrapAngle(want - car.yaw) * 1.5, -1, 1); }
    }
    ai.steer = steer;
  }
  function aiControl(car, i, now) {
    aiThink(car, i, now);
    // steer away from the barrier when it gets close ahead
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), look = 3.4;
    const px = car.x + fx * look, pz = car.z + fz * look;
    let steer = car.ai.steer;
    if (px < arena.x0 + 0.6 || px > arena.x1 - 0.6 || pz < arena.z0 + 0.6 || pz > arena.z1 - 0.6) {
      const cx = (arena.x0 + arena.x1) / 2, cz = (arena.z0 + arena.z1) / 2;
      const want = Math.atan2(cx - car.x, cz - car.z); steer = clamp(-wrapAngle(want - car.yaw) * 2, -1, 1);
    }
    const throttle = car.speed < car.ai.target ? 0.9 : 0.1;
    return { throttle, steer: steer * cfg.aiSteer / 1.6 };
  }

  function wallCollide(car, i) {
    const r = cfg.radius; let hit = false, impulse = 0;
    const bounce = (nx, nz, depth) => {
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) { car.vx -= (1 + cfg.wallRestitution) * vn * nx; car.vz -= (1 + cfg.wallRestitution) * vn * nz; impulse = Math.max(impulse, -vn); }
      car.x += nx * depth; car.z += nz * depth; hit = true;
    };
    if (car.x < arena.x0 + r) bounce(1, 0, arena.x0 + r - car.x);
    if (car.x > arena.x1 - r) bounce(-1, 0, car.x - (arena.x1 - r));
    if (car.z < arena.z0 + r) bounce(0, 1, arena.z0 + r - car.z);
    if (car.z > arena.z1 - r) bounce(0, -1, car.z - (arena.z1 - r));
    if (hit && impulse > cfg.bumpMin && mayBump(`w${i}`, stats.time)) { events.push({ type: "wall", i, impulse, x: car.x, z: car.z }); stats.wallBumps++; stats.bumps++; if (i === 0) stats.playerBumps++; stats.hardest = Math.max(stats.hardest, impulse); }
  }
  function carCollide(a, ai, b, bi) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = cfg.radius * 2;
    if (d >= min || d < 1e-6) return;
    const nx = dx / d, nz = dz / d, push = (min - d) / 2;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;      // closing speed < 0
    if (rv < 0) {
      const j = -(1 + cfg.restitution) * rv / 2;
      a.vx -= j * nx; a.vz -= j * nz; b.vx += j * nx; b.vz += j * nz;
      const impulse = -rv;
      if (impulse > cfg.bumpMin && mayBump(`c${ai}-${bi}`, stats.time)) { events.push({ type: "car", i: ai, j: bi, impulse, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, player: ai === 0 || bi === 0 }); stats.carBumps++; stats.bumps++; if (ai === 0 || bi === 0) stats.playerBumps++; stats.hardest = Math.max(stats.hardest, impulse); }
    }
  }

  return {
    arena, cars, stats, events, cfg,
    /** advance dt seconds (sub-stepped); input = { throttle, steer } for the player's car. Events of this call are in `events` (cleared first). */
    step(dt, input = { throttle: 0, steer: 0 }) {
      events.length = 0;
      const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
      for (let s = 0; s < n; s++) {
        stats.time += h;
        for (let i = 0; i < cars.length; i++) {
          const car = cars[i];
          const ctl = i === 0 ? input : aiControl(car, i, stats.time);
          driveCar(car, clamp(ctl.throttle, -1, 1), clamp(ctl.steer, -1, 1), h, cfg);
          car.x += car.vx * h; car.z += car.vz * h;
          if (i === 0) { stats.distance += car.speed * h; stats.topSpeed = Math.max(stats.topSpeed, car.speed); }
        }
        for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) carCollide(cars[i], i, cars[j], j);
        for (let i = 0; i < cars.length; i++) wallCollide(cars[i], i);
      }
      return events;
    },
  };
}
