/* Mountain bike physics: a rider + bike point mass on the physics surface (W3: surfaces, two brakes, pump and pop, landings, soft crashes, four bikes).
 *
 *   forces    pedal power (P / v, limited by rear traction) - brakes - rolling resistance - air drag + gravity along the slope
 *   brakes    front and rear separately; the weight moves forward when braking, so the front brake bites hardest but can wash out in a corner, the rear brake
 *             skids first, and a hard front-only stop on a steep descent goes over the bars (a soft crash)
 *   grip      every surface (dirt, gravel, rock, roots, mud, leaves, wood, grass, water, road) has its own grip and drag; rain takes grip away (more on rock, wood and roots)
 *   steering  kinematic bicycle (yaw rate = v * tan(bar angle) / wheelbase); the bar angle shrinks with speed, the rider leans into the turn
 *   pump/pop  Space = crouch while held, extend on release: on a crest the crouch costs little, in a valley the extension pushes against the ground and
 *             adds speed (energy = height * normal force); a long hold on a lip or a flat pops the bike into the air
 *   contact   the bike is a free body (gravity) pushed out of the ground; it sticks over small drops (suspension travel) and leaves it over crests and jumps;
 *             touch-downs are graded (perfect / good / rough) and a very hard or sideways one is a crash
 *   crashes   a stylised tumble: the bike slides to a stop, the game respawns the rider at the last checkpoint after PLAY.respawnTime (< 1.5 s)
 * Pure functions on plain numbers (no THREE): the harness and the scripted rider run it in Node, the browser draws it. Never mutates its inputs: state is replaced. */
import { BIKE, BIKES, PLAY, SURFACES, SURFACE_OF_CODE, WAY_SURFACE } from './config.js';
import { WAY_KIND_NAMES } from './trails.js';

const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createBikeState(x, z, heading, surface) {
  if (surface.hint) surface.hint(1e9);
  const y = surface.height(x, z);
  return Object.freeze({
    x, y, z, vx: 0, vy: 0, vz: 0, heading, steer: 0, lean: 0, grounded: true, preload: 0, airTime: 0,
    pedal: 0, cadence: 0, crank: 0, groundKind: 'forest', rough: 0, compression: 0, lastImpact: 0, odometer: 0, slip: 0,
    skid: 0, brakeF: 0, brakeR: 0, kappa: 0, pumped: 0, popped: false, stall: 0, landSeq: 0, landImpact: 0, landQuality: 1, crashed: '', crashT: 0, crashSeq: 0, hitSeq: 0, shield: 0,
  });
}

/** Grip of a surface in the rain (wet 0..1). Exported for the unit checks. */
export const wetGrip = (kind, grip, wet) => grip * (1 - clamp(wet, 0, 1) * (SURFACES[kind] || SURFACES.dirt).wetLoss);

/** One fixed physics step. input = { throttle 0..1, brakeF, brakeR (or one `brake` that is split), steer -1..1 (right positive), jump boolean }.
 *  env = { bike (a BIKES entry), wet 0..1, gripScale, collide(x, z, r), shield (seconds of invulnerability left) }. Returns a NEW state. */
export function stepBike(s, input, dt, surface, groundAt, env = {}) {
  const spec = env.bike || BIKES.trail;
  const wet = clamp(env.wet || 0, 0, 1);
  const gripScale = env.gripScale ?? 1;
  const shielded = (env.shield || 0) > 0;
  if (surface.hint) surface.hint(s.y);
  if (s.crashed) return tumbleStep(s, dt, surface, groundAt);

  const nrm = { x: 0, y: 1, z: 0 }, tmpN = { x: 0, y: 1, z: 0 };
  const throttle = clamp(input.throttle || 0, 0, 1);
  let bf = input.brakeF, br = input.brakeR;
  if (bf === undefined && br === undefined) { const b = clamp(input.brake || 0, 0, 1); bf = b * PLAY.brakeBlend.front; br = b * PLAY.brakeBlend.rear; }
  bf = clamp(bf || 0, 0, 1); br = clamp(br || 0, 0, 1);

  // --- steering and lean state
  const steer = s.steer + (clamp(input.steer || 0, -1, 1) - s.steer) * Math.min(1, BIKE.steerRate * dt);
  let { x, y, z, vx, vy, vz } = s;
  let heading = s.heading;
  const speedH = Math.hypot(vx, vz);
  const bar = steer * BIKE.steerMax * spec.steerK / (1 + (speedH / spec.steerRef) ** 2);
  const fwdX = Math.cos(heading), fwdZ = Math.sin(heading);
  const forwardSpeedH = vx * fwdX + vz * fwdZ;
  const yawRate = (s.grounded ? forwardSpeedH : forwardSpeedH * 0.15) * Math.tan(bar) / BIKE.wheelbase;
  heading = (heading + yawRate * dt) % TWO_PI;
  const fx = Math.cos(heading), fz = Math.sin(heading);

  const ground = groundAt(x, z);              // { kind, crr, grip, rough, wetLoss }
  let grounded = s.grounded;
  let slip = 0, crank = s.crank, lastImpact = s.lastImpact;
  let skid = 0, brakeF = 0, brakeR = 0, kappa = s.kappa, pumped = 0, stall = 0;
  let crashed = '';
  let ax = 0, ay = -BIKE.gravity, az = 0;
  let preload = s.preload;
  let popped = false;

  if (grounded) {
    surface.normal(x, z, nrm);
    let tfx = fx, tfy = 0, tfz = fz;
    const d = tfx * nrm.x + tfz * nrm.z;
    tfx -= nrm.x * d; tfy -= nrm.y * d; tfz -= nrm.z * d;
    const tl = Math.hypot(tfx, tfy, tfz) || 1;
    tfx /= tl; tfy /= tl; tfz /= tl;
    const rx0 = -tfz, rz0 = tfx;
    const rd = rx0 * nrm.x + rz0 * nrm.z;
    let rx = rx0 - nrm.x * rd, ry = -nrm.y * rd, rz = rz0 - nrm.z * rd;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;

    const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
    vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
    let vf = vx * tfx + vy * tfy + vz * tfz;
    let vl = vx * rx + vy * ry + vz * rz;

    const gdotn = -BIKE.gravity * nrm.y;
    const gtx = -nrm.x * gdotn, gty = -BIKE.gravity - nrm.y * gdotn, gtz = -nrm.z * gdotn;
    let aF = gtx * tfx + gty * tfy + gtz * tfz;
    let aL = gtx * rx + gty * ry + gtz * rz;
    const normalAccel = Math.max(0.3, BIKE.gravity * nrm.y);
    const mu = wetGrip(ground.kind, ground.grip, wet) * spec.grip * gripScale;

    // pedalling: power limited, traction limited
    const vAbs = Math.max(0.9, Math.abs(vf));
    const sprint = 1 + BIKE.launchBoost * (1 - smoothstep(BIKE.launchFade[0], BIKE.launchFade[1], vAbs));
    let drive = throttle * Math.min(BIKE.power * spec.powerK * sprint / vAbs, BIKE.pedalForceMax) / spec.mass;
    drive = Math.min(drive, mu * normalAccel * 0.55);
    // hike-a-bike: below walking pace the rider pushes the bike up a bank; a stall that lasts more than a second makes the push stronger (never stuck)
    stall = throttle > 0.3 && Math.abs(vf) < 0.6 ? s.stall + dt : Math.max(0, s.stall - 2 * dt);
    if (throttle > 0.3 && vf > -0.5) drive += (PLAY.pushAssist + PLAY.pushSlope * Math.max(0, -aF)) * (1 + 2.2 * smoothstep(0.4, 1.2, stall)) * (1 - smoothstep(PLAY.pushFade[0], PLAY.pushFade[1], Math.abs(vf))) * throttle;
    aF += drive;

    // rolling resistance, roughness and drag
    const speed3 = Math.hypot(vf, vl);
    const wetDrag = 1 + wet * 0.35 * (ground.kind === 'mud' || ground.kind === 'dirt' || ground.kind === 'grass' || ground.kind === 'forest' ? 1 : 0.2);
    const resist = ground.crr * spec.crrK * wetDrag * normalAccel
      + ground.rough * spec.rough * 0.9 * smoothstep(1, 8, speed3)
      + 0.5 * BIKE.airDensity * BIKE.cdA * spec.cdaK * speed3 * speed3 / spec.mass;
    if (speed3 > 1e-3) { aF -= resist * (vf / speed3); aL -= resist * (vl / speed3); }

    // brakes: the weight moves forward when braking (front bites, rear skids first)
    let washFront = false;
    if ((bf > 0 || br > 0) && speed3 > 0.05) {
      const dmdF = bf * spec.brakeF, dmdR = br * spec.brakeR;
      let aFb = dmdF, aRb = dmdR, limR = mu * normalAccel * 0.5;
      for (let k = 0; k < 2; k++) {
        const ff = clamp(0.5 + PLAY.weightTransfer * (aFb + aRb) / normalAccel, 0.2, 0.95);
        const limF = mu * normalAccel * ff;
        limR = mu * normalAccel * (1 - ff);
        aFb = Math.min(dmdF, limF); aRb = Math.min(dmdR, limR);
        washFront = dmdF > limF * 1.02;
      }
      const brakeA = aFb + aRb;
      aF -= brakeA * (vf / speed3); aL -= brakeA * (vl / speed3);
      brakeF = bf; brakeR = br;
      skid = dmdR > limR * 1.05 && speed3 > 2 ? clamp((dmdR - limR) / Math.max(0.5, limR), 0, 1) : 0;
      // over the bars: a hard front-only stop on a steep descent
      const downhill = Math.max(0, -tfy) * BIKE.gravity;
      if (!shielded && bf > 0.85 && br < 0.35 && vf > 4 && aFb + downhill > PLAY.flipDecel) crashed = 'endo';
    }
    vf += aF * dt;
    vl += aL * dt;
    if ((bf > 0.05 || br > 0.05) && Math.abs(vf) < 0.25 && throttle < 0.05) vf = 0;          // a stopped bike stays stopped on a gentle slope with the brake held

    // lateral grip: pull the slip velocity towards zero at most muLat * g
    const muLat = mu * (1 - PLAY.frontWash * bf * Math.abs(steer) * (washFront ? 1 : 0.5)) * (skid > 0 ? PLAY.rearLockLateral : 1);
    const maxCorrect = muLat * normalAccel * dt * 1.15;
    const corrected = Math.abs(vl) <= maxCorrect ? 0 : vl - Math.sign(vl) * maxCorrect;
    slip = Math.abs(vl);
    const lost = Math.abs(vl) - Math.abs(corrected);
    vl = corrected;
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), lost * 0.25);
    if (!shielded && slip > PLAY.slideCrash && speed3 > 5) crashed = crashed || 'slide';
    const sp = Math.hypot(vf, vl);
    if (sp > BIKE.maxSpeed) { vf *= BIKE.maxSpeed / sp; vl *= BIKE.maxSpeed / sp; }

    // curvature of the ground along the travel direction (+ = valley: the ground pushes up harder than gravity)
    const nfAt = (px, pz) => { surface.normal(px, pz, tmpN); return tmpN.x * fx + tmpN.z * fz; };
    kappa = (nfAt(x - fx * 1.5, z - fz * 1.5) - nfAt(x + fx * 1.5, z + fz * 1.5)) / 3;
    const pressG = BIKE.gravity * nrm.y + vf * vf * kappa;                // m/s2 the ground presses on the bike (valley: more than g)

    // crouch while the jump key is held, extend on release
    if (input.jump) {
      const dp = Math.min(1 - preload, dt / BIKE.jumpPreload);
      preload += dp;
      const cost = PLAY.pumpHeight * Math.max(0, pressG) * dp / Math.max(2, Math.abs(vf));          // crouching pushes against a (small) normal force on a crest, a big one in a valley
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), cost * 0.6);
    } else if (preload > 0.02) {
      const gain = clamp(spec.pump * PLAY.pumpHeight * Math.max(0, pressG) * preload / Math.max(2, Math.abs(vf)), 0, PLAY.pumpGainMax);
      vf += Math.sign(vf || 1) * gain;
      pumped = gain;
      const valley = smoothstep(0.3, PLAY.popValleyG, vf * vf * Math.max(0, kappa) / BIKE.gravity);
      const pop = preload > PLAY.popMin ? BIKE.jumpImpulse * spec.pop * smoothstep(PLAY.popMin, 1, preload) * (1 - valley) : 0;
      if (pop > PLAY.popMinSpeed) {
        vx = tfx * vf + rx * vl; vy = tfy * vf + ry * vl; vz = tfz * vf + rz * vl;
        vx += nrm.x * pop * 0.6; vy += (nrm.y * 0.4 + 0.6) * pop; vz += nrm.z * pop * 0.6;
        grounded = false; popped = true;
      }
      preload = 0;
    }
    if (!popped) { vx = tfx * vf + rx * vl; vy = tfy * vf + ry * vl; vz = tfz * vf + rz * vl; }
    ax = ay = az = 0;
    crank = (crank + Math.max(0, vf) * dt * 1.35 * (throttle > 0.05 ? 1 : 0.25)) % TWO_PI;
  } else {
    // in the air: gravity and a little drag, no steering authority; the crouch is released
    const sp = Math.hypot(vx, vy, vz);
    const k = 0.5 * BIKE.airDensity * BIKE.cdA * spec.cdaK / spec.mass * sp;
    ax = -k * vx; ay = -BIKE.gravity - k * vy; az = -k * vz;
    preload = 0;
  }

  // --- integrate
  vx += ax * dt; vy += ay * dt; vz += az * dt;
  x += vx * dt; y += vy * dt; z += vz * dt;

  // --- contact with the surface
  const ground2 = surface.height(x, z);
  const gap = y - ground2;
  let airTime = s.airTime;
  let compression = s.compression * Math.exp(-9 * dt);
  let landSeq = s.landSeq, landImpact = s.landImpact, landQuality = s.landQuality;
  if (grounded && !popped) {
    if (gap <= spec.stick) {
      const sp0 = Math.hypot(vx, vy, vz);
      y = ground2;
      surface.normal(x, z, nrm);
      const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
      if (vn < 0) compression = Math.min(1, compression - vn * 0.05 / (0.5 + spec.travel * 4));
      vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
      const sp1 = Math.hypot(vx, vy, vz);
      if (sp1 > 1e-4 && Math.abs(vn) < 2.2) { const k2 = sp0 / sp1; vx *= k2; vy *= k2; vz *= k2; }
    } else { grounded = false; }
  }
  if (!grounded) {
    airTime += dt;
    if (y <= ground2 && !popped) {
      surface.normal(x, z, nrm);
      const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
      y = ground2;
      if (vn < 0) {
        const impact = -vn;
        lastImpact = impact;
        compression = Math.min(1, impact / (6 + spec.travel * 30));
        const hard = Math.max(0, impact - spec.hardImpact);
        // sideways speed at touch-down (relative to the heading)
        const side = Math.abs(-vx * fz + vz * fx);
        vx -= nrm.x * vn; vy -= nrm.y * vn; vz -= nrm.z * vn;
        const keep = 1 - Math.min(0.5, hard * 0.05);
        vx *= keep; vy *= keep; vz *= keep;
        landSeq += 1; landImpact = impact;
        landQuality = clamp(1 - (impact - PLAY.perfectImpact) / (spec.hardImpact + 3 - PLAY.perfectImpact), 0, 1);
        if (!shielded && airTime > 0.12 && (impact > spec.crashImpact || side > PLAY.sideLandCrash)) crashed = crashed || (impact > spec.crashImpact ? 'landing' : 'sideways');
      }
      grounded = true; airTime = 0;
    }
  }

  // trunks and rocks: a gentle touch slides along, a hard hit is a crash
  let hitSeq = s.hitSeq;
  if (env.collide) {
    const hit = env.collide(x, z, BIKE.bodyRadius);
    if (hit) {
      x += hit.nx * hit.pen; z += hit.nz * hit.pen;
      const vn = vx * hit.nx + vz * hit.nz;
      if (vn < 0) {
        lastImpact = Math.max(lastImpact, -vn);
        vx -= hit.nx * vn; vz -= hit.nz * vn;
        const k = BIKE.treeBump;
        vx *= k; vz *= k;
        hitSeq += 1;
        if (!shielded && -vn > PLAY.hitCrash) crashed = crashed || 'hit';
      }
      const g = surface.height(x, z);
      if (grounded || y < g) y = g;
    }
  }

  // lean into the turn: the bank angle that balances the centripetal acceleration
  const speedNow = Math.hypot(vx, vz);
  const wantLean = clamp(Math.atan2(speedNow * yawRate, BIKE.gravity), -BIKE.leanMax, BIKE.leanMax) * (grounded ? 1 : 0.4);
  const lean = s.lean + (wantLean - s.lean) * Math.min(1, BIKE.leanRate * dt);

  const cadence = grounded ? clamp(speedNow * 9.5, 0, 112) * (throttle > 0.05 ? 1 : 0.0) : 0;
  return Object.freeze({
    x, y, z, vx, vy, vz, heading, steer, lean, grounded, preload, airTime,
    pedal: throttle, cadence, crank, groundKind: ground.kind, rough: grounded ? ground.rough * spec.rough : 0, compression, lastImpact, odometer: s.odometer + speedNow * dt, slip,
    skid, brakeF, brakeR, kappa, pumped, popped, stall, landSeq, landImpact, landQuality, crashed, crashT: 0, crashSeq: s.crashSeq + (crashed ? 1 : 0), hitSeq, shield: 0,
  });
}

/** After a crash: the bike slides to a stop on the ground (the rider model plays the tumble); the game respawns the rider after PLAY.respawnTime. */
function tumbleStep(s, dt, surface, groundAt) {
  const decay = Math.exp(-PLAY.tumbleDecay * dt);
  let { vx, vz } = s;
  vx *= decay; vz *= decay;
  const x = s.x + vx * dt, z = s.z + vz * dt;
  const y = Math.max(surface.height(x, z), s.y + (s.grounded ? 0 : s.vy * dt));
  const grounded = y <= surface.height(x, z) + 1e-6;
  const vy = grounded ? 0 : s.vy - BIKE.gravity * dt;
  return Object.freeze({ ...s, x, y: grounded ? surface.height(x, z) : y, z, vx, vy, vz, grounded, crashT: s.crashT + dt, odometer: s.odometer + Math.hypot(vx, vz) * dt, steer: s.steer * decay, lean: s.lean * decay, preload: 0, pedal: 0, cadence: 0, brakeF: 0, brakeR: 0, skid: 0, popped: false, pumped: 0 });
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

/**
 * The ground under (x, z): { kind, crr, grip, rough, wetLoss }.
 *   on a carved way: a trail feature surface (rock slab, roots, mud, leaves, boardwalk) or the way's own kind (path, gravel track, road, water channel)
 *   off the ways: forest litter, meadow grass or bare rock from the 4 m land cover (`classify(x, z)` -> 'forest' | 'grass' | 'rock', optional)
 *   on a bridge deck (`onDeck(x, z)`, optional): wood
 */
export function groundResolver(field, options = {}) {
  const info = { coverage: 0, way: -1, stream: 0, surf: 0, kind: 0 };
  const out = { kind: 'forest', ...SURFACES.forest };
  const set = (kind) => { const m = SURFACES[kind]; out.kind = kind; out.crr = m.crr; out.grip = m.grip; out.rough = m.rough; out.wetLoss = m.wetLoss; return out; };
  return (x, z) => {
    if (options.onDeck && options.onDeck(x, z)) return set('wood');
    field.height(x, z, info);
    const c = info.coverage;
    if (info.stream > 0.35 && c > 0.3) return set('water');
    if (c > 0.5) {
      if (info.surf > 0) return set(SURFACE_OF_CODE[info.surf] || 'dirt');
      return set(WAY_SURFACE[WAY_KIND_NAMES[info.kind] || 'trail'] || 'dirt');
    }
    if (c > 0.15) return set('track');
    const cls = options.classify ? options.classify(x, z) : 'forest';
    return set(cls === 'grass' ? 'grass' : cls === 'rock' ? 'rock' : 'forest');
  };
}

export const speedKmh = (s) => Math.hypot(s.vx, s.vy, s.vz) * 3.6;
export const speedMs = (s) => Math.hypot(s.vx, s.vy, s.vz);
