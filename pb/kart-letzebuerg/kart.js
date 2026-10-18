/* Kart Lëtzebuerg — kart state and arcade physics (no rendering). All units metres / seconds / radians.
 * Heading yaw gives forward = (sin yaw, cos yaw); steering right DEcreases yaw. */
(function () {
  'use strict';
  const KL = window.KL, C = KL.CFG;
  const { clamp, lerp, wrapAngle } = KL;
  const proj = {};     // scratch result for track.project

  KL.createKart = function createKart(o) {
    return {
      id: o.id, name: o.name, driver: o.driver, isBot: !!o.isBot, human: !!o.human, remote: !!o.remote, slot: o.slot || 0,
      botSkill: o.botSkill || 1, lanePref: o.lanePref || 0,
      x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, vy: 0, grounded: true, steer: 0,
      input: { steer: 0, gas: 0, brake: 0, drift: false, item: false, itemBack: false },
      prevDrift: false, prevItem: false,
      drift: { state: 0, dir: 0, charge: 0, level: 0, hopT: 0 },
      boostT: 0, boostKind: 0, spinT: 0, spinDir: 1, spinVis: 0, invuln: 0, frozenT: 0, shieldT: 0, slipT: 0, hitT: 0,
      surf: 0, hint: -1, s: 0, d: 0, prog: 0, lap: 0, lapStart: 0, lapTimes: [], bestLap: Infinity, finished: false, finishTime: 0, finishOrder: 0,
      place: o.slot + 1, item: null, roll: null, itemCool: 0, auto: false,
      wrongT: 0, stuckT: 0, airT: 0, rocketStart: 0, gasSince: -1, stallT: 0, safeS: 0, speed: 0, vf: 0, hopY: 0, wheelSpin: 0, bumpT: 0,
      scrapeT: 0, landT: 0, lastHitBy: null, boxes: 0, rubber: 1, t: 0, steerVis: 0, roll3: 0,
    };
  };

  KL.placeKart = function placeKart(k, track, s, d, extra) {
    const p = track.at(s, d);
    k.x = p.x; k.z = p.z; k.y = p.y; k.yaw = p.h; k.vx = 0; k.vz = 0; k.vy = 0; k.grounded = true;
    k.hint = p.i; k.s = ((s % track.length) + track.length) % track.length; k.d = d || 0;
    k.px = k.x; k.py = k.y; k.pz = k.z; k.pyaw = k.yaw;
    k.drift.state = 0; k.drift.charge = 0; k.boostT = 0; k.spinT = 0; k.spinVis = 0; k.steer = 0;
    Object.assign(k, extra || {});
  };

  /* respawn on the tarmac a little behind the current position */
  KL.rescueKart = function rescueKart(k, track) {
    const sBack = (k.safeS != null ? k.safeS : k.s) - 5;
    const p = track.at(sBack, 0);
    k.x = p.x; k.z = p.z; k.y = p.y + 1.5; k.yaw = p.h; k.vx = Math.sin(p.h) * 6; k.vz = Math.cos(p.h) * 6; k.vy = 0; k.grounded = false;
    k.hint = p.i; k.s = ((sBack % track.length) + track.length) % track.length; k.d = 0;
    k.px = k.x; k.py = k.y; k.pz = k.z; k.pyaw = k.yaw; k.teleported = true;
    const L = track.length;
    // keep progress consistent: put prog at the rescue point
    const turns = Math.round((k.prog - k.s) / L);
    k.prog = k.s + turns * L;
    k.drift.state = 0; k.drift.charge = 0; k.boostT = 0; k.spinT = 0; k.spinVis = 0; k.shieldT = 0;
    k.frozenT = 0.7; k.invuln = 2.5; k.stuckT = 0; k.airT = 0; k.wrongT = 0;
    k.rescued = (k.rescued || 0) + 1;
  };

  KL.stepKart = function stepKart(k, dt, R) {
    const track = R.track, def = track.def;
    k.t += dt;
    k.px = k.x; k.py = k.y; k.pz = k.z; k.pyaw = k.yaw;
    // timers
    for (const key of ['boostT', 'spinT', 'invuln', 'frozenT', 'shieldT', 'slipT', 'hitT', 'itemCool', 'bumpT', 'scrapeT', 'landT']) if (k[key] > 0) k[key] = Math.max(0, k[key] - dt);
    const inp = k.input;
    const racing = R.phase === 'race' || (R.phase === 'finished');
    const spinning = k.spinT > 0;
    const controllable = racing && !spinning && !(k.frozenT > 0) && k.stallT <= 0.0001;
    if (k.stallT > 0) k.stallT = Math.max(0, k.stallT - dt);

    // ---------- driving inputs ----------
    const steerIn = controllable ? inp.steer : 0;
    const gas = controllable ? inp.gas : 0;
    const brake = controllable ? inp.brake : 0;
    k.steer += (steerIn - k.steer) * Math.min(1, dt * (Math.abs(steerIn) < 0.05 ? 13 : 9));

    // ---------- limits ----------
    let vmax = C.MAX_SPEED * (k.rubber || 1);
    const offroadCap = def.offroadSpeed || (def.offroad === 'grass' ? C.OFFROAD_SPEED : C.SIDEWALK_SPEED);
    if (k.surf === 1 && k.boostT <= 0) vmax = Math.min(vmax, offroadCap);
    if (k.boostT > 0) vmax = Math.max(vmax, C.BOOST_SPEED * (k.boostKind === 2 ? 1.04 : 1));
    if (R.weather && R.weather.wet) vmax *= 1 - 0.02 * R.weather.wet;

    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let vf = k.vx * fx + k.vz * fz;
    const sp = Math.abs(vf);

    if (k.grounded) {
      // accelerate / brake / coast
      if (gas > 0 && vf < vmax) {
        const boosting = k.boostT > 0;
        const a = boosting ? 58 : C.ACCEL * (1 - clamp(vf / vmax, 0, 1) * 0.72) * gas;
        vf = Math.min(vmax, vf + a * dt);
      } else if (vf > vmax) {
        vf = Math.max(vmax, vf - (k.surf === 1 ? 30 : 12) * dt);
      } else if (gas <= 0 && brake <= 0) {
        vf -= Math.sign(vf) * Math.min(Math.abs(vf), C.DRAG * dt);
      }
      if (brake > 0) {
        if (vf > 0.6) vf = Math.max(0, vf - C.BRAKE * brake * dt);
        else if (gas <= 0) vf = Math.max(-9, vf - 15 * brake * dt);
      }
      if (spinning) vf *= Math.exp(-3.2 * dt);
      if (k.frozenT > 0) vf *= Math.exp(-6 * dt);
    }

    // ---------- steering ----------
    const turnAuth = clamp(sp / 6, 0, 1) * (1 - 0.3 * clamp(sp / C.MAX_SPEED, 0, 1));
    const dr = k.drift;
    let rate = 0;
    if (k.grounded || k.airT < 0.4) {
      if (dr.state === 2) {
        const ds = dr.dir * (0.62 + 0.38 * k.steer * dr.dir);
        rate = C.TURN_RATE * 1.18 * ds * turnAuth;
      } else rate = C.TURN_RATE * k.steer * turnAuth;
      if (k.slipT > 0) rate *= 0.55;
      if (!k.grounded) rate *= 0.4;
      if (k.surf === 1 && k.boostT <= 0) rate *= 0.9;
    }
    // rebuild the velocity with the new forward speed (sideways part kept), then turn the heading
    const yawOld = k.yaw;
    const vr = -k.vx * Math.cos(yawOld) + k.vz * Math.sin(yawOld);   // sideways speed (right positive)
    k.yaw -= rate * dt * (vf >= -0.5 ? 1 : -1);
    let vx = fx * vf - Math.cos(yawOld) * vr;
    let vz = fz * vf + Math.sin(yawOld) * vr;
    if (k.grounded) {
      // grip: turn the velocity vector towards the new heading (keeps speed)
      const nfx = Math.sin(k.yaw), nfz = Math.cos(k.yaw);
      const sgn = vx * nfx + vz * nfz >= 0 ? 1 : -1;
      const dx = nfx * sgn, dz = nfz * sgn, nx = -dz, nz = dx;      // nx,nz = right of the travel direction
      const along = vx * dx + vz * dz, side = vx * nx + vz * nz;
      let grip = dr.state === 2 ? C.DRIFT_GRIP : C.GRIP;
      if (k.surf === 1) grip *= 0.6;
      if (R.weather && R.weather.wet) grip *= 1 - 0.28 * R.weather.wet;
      if (k.slipT > 0) grip *= 0.5;
      if (spinning) grip = 1.2;
      const mag = Math.hypot(along, side);
      let ang = Math.atan2(side, along);
      ang *= Math.exp(-grip * dt);
      vx = (Math.cos(ang) * dx + Math.sin(ang) * nx) * mag;
      vz = (Math.cos(ang) * dz + Math.sin(ang) * nz) * mag;
    }
    // total speed never exceeds the cap (drifting turns the heading away from the velocity, which let the forward-only cap leak)
    if (k.grounded) {
      const m2 = Math.hypot(vx, vz), over = m2 - vmax;
      if (over > 0.3) { const k2 = (m2 - over * (1 - Math.exp(-5 * dt))) / m2; vx *= k2; vz *= k2; }
    }
    k.vx = vx; k.vz = vz;

    // ---------- drift state machine ----------
    const wantDrift = controllable && inp.drift;
    if (dr.state === 0) {
      if (wantDrift && !k.prevDrift && k.grounded && sp > C.DRIFT_MIN_SPEED * 0.8) { dr.state = 1; dr.hopT = 0.2; k.hopY = 1; }
    } else if (dr.state === 1) {
      dr.hopT -= dt;
      if (!wantDrift) dr.state = 0;
      else if (Math.abs(k.steer) > 0.25 && sp > C.DRIFT_MIN_SPEED * 0.8) { dr.state = 2; dr.dir = Math.sign(k.steer) || 1; dr.charge = 0; dr.level = 0; }
      else if (dr.hopT < -1.2) dr.state = 0;
    } else if (dr.state === 2) {
      if (!wantDrift || sp < C.DRIFT_MIN_SPEED * 0.55 || !k.grounded && k.airT > 0.6) {
        if (dr.level > 0 && controllable) {
          const bt = C.DRIFT_BOOST[dr.level - 1];
          k.boostT = Math.max(k.boostT, bt); k.boostKind = dr.level;
          const f2x = Math.sin(k.yaw), f2z = Math.cos(k.yaw);
          k.vx += f2x * 3.2; k.vz += f2z * 3.2;
          R.events.push({ t: 'miniturbo', id: k.id, level: dr.level });
        }
        dr.state = 0; dr.charge = 0; dr.level = 0;
      } else {
        dr.charge += dt * (0.8 + 0.55 * Math.max(0, k.steer * dr.dir));
        let lv = 0; for (let i = 0; i < C.DRIFT_LEVELS.length; i++) if (dr.charge >= C.DRIFT_LEVELS[i]) lv = i + 1;
        if (lv > dr.level) { dr.level = lv; R.events.push({ t: 'driftlevel', id: k.id, level: lv }); }
      }
    }
    k.prevDrift = wantDrift;
    if (k.hopY > 0) k.hopY = Math.max(0, k.hopY - dt * 5);

    // ---------- integrate ----------
    k.x += k.vx * dt; k.z += k.vz * dt;
    k.vf = vf; k.speed = Math.hypot(k.vx, k.vz);

    // ---------- track, walls, ground ----------
    const p = track.project(k.x, k.z, k.hint, k.y, proj);
    k.hint = p.i;
    const side = p.d >= 0 ? 1 : -1, ad = Math.abs(p.d);
    const lim = p.hw + (side > 0 ? p.wr : p.wl);
    const nxR = -p.tz, nzR = p.tx;                       // right normal
    let surf = 0;
    if (ad > p.hw) surf = 1;
    if (ad > lim) {
      // wall: push back, bounce, scrape
      const over = ad - lim;
      k.x -= nxR * side * (over + 0.02); k.z -= nzR * side * (over + 0.02);
      const vn = (k.vx * nxR + k.vz * nzR) * side;       // outward speed
      if (vn > 0) {
        const rest = 0.22;
        k.vx -= nxR * side * vn * (1 + rest); k.vz -= nzR * side * vn * (1 + rest);
        const hit = vn;
        // lose speed, more for head-on hits; nudge the heading along the wall
        const sc = 1 - clamp(hit * 0.018, 0, 0.35);
        k.vx *= sc; k.vz *= sc;
        const wallYaw = Math.atan2(p.tx, p.tz);
        const al = wrapAngle(wallYaw - k.yaw), al2 = Math.abs(al) > Math.PI / 2 ? wrapAngle(wallYaw + Math.PI - k.yaw) : al;
        k.yaw += clamp(al2, -0.3, 0.3) * Math.min(1, hit * 0.08 + 0.05);
        if (hit > 4 && k.scrapeT <= 0) { R.events.push({ t: 'wall', id: k.id, power: hit }); k.scrapeT = 0.25; }
        if (hit > 9) k.drift.state = 0;
      }
      surf = 1;
      k.wallT = 0.2;
    }
    k.surf = surf; k.d = p.d;
    // static obstacles (fountains, statues, planters)
    if (def.obstacles) for (const ob of def.obstacles) {
      const dx = k.x - ob[0], dz = k.z - ob[1], rr = ob[2] + C.KART_RADIUS * 0.8, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const dd = Math.sqrt(d2) || 0.01, nx = dx / dd, nz = dz / dd;
        k.x = ob[0] + nx * rr; k.z = ob[1] + nz * rr;
        const vn = k.vx * nx + k.vz * nz;
        if (vn < 0) { k.vx -= nx * vn * 1.3; k.vz -= nz * vn * 1.3; k.vx *= 0.8; k.vz *= 0.8; if (vn < -5) R.events.push({ t: 'wall', id: k.id, power: -vn }); }
      }
    }
    // progress along the track (unwrapped, start line = 0)
    let ds = p.s - k.s;
    if (track.closed) { if (ds > track.length / 2) ds -= track.length; else if (ds < -track.length / 2) ds += track.length; }
    k.prog += ds; k.s = p.s;
    if (surf === 0 && k.grounded) k.safeS = p.s;

    // vertical motion: stick to the surface, take off over crests, land
    const gy = p.y;
    if (k.grounded) {
      const climb = (gy - k.y) / dt;
      const vyG = k.lastClimb || 0;
      // leave the ground when the surface falls away faster than a ballistic path (crests, ramps)
      if (gy < k.y + vyG * dt - 0.5 * C.GRAVITY * dt * dt - 0.1 && k.speed > 6 && !k.noAir) { k.grounded = false; k.vy = vyG; k.airT = 0; }
      else { k.y = gy; k.vy = 0; }
      k.lastClimb = lerp(vyG, clamp(climb, -30, 30), 0.35);
    }
    if (!k.grounded) {
      k.airT += dt;
      k.vy -= C.GRAVITY * dt;
      k.y += k.vy * dt;
      if (k.y <= gy) {
        if (k.airT > 0.25) R.events.push({ t: 'land', id: k.id, power: -k.vy });
        k.y = gy; k.vy = 0; k.grounded = true; k.airT = 0; k.landT = 0.25;
      }
    }
    k.wheelSpin += k.vf * dt;

    // ---------- bookkeeping ----------
    // wrong way / stuck
    const along = k.vx * p.tx + k.vz * p.tz;
    if (racing && !k.finished && along < -2.5 && k.speed > 3) k.wrongT += dt; else k.wrongT = Math.max(0, k.wrongT - dt * 2);
    if (racing && !k.finished && k.speed < 1.2 && k.frozenT <= 0 && k.spinT <= 0) k.stuckT += dt; else k.stuckT = 0;
    // use item button edge
    if (inp.item && !k.prevItem && controllable) k.wantItem = true;
    k.prevItem = inp.item;
  };

  KL.hitKart = function hitKart(R, k, kind, source) {
    if (k.finished && false) return false;
    if (k.invuln > 0 || k.frozenT > 0 || k.hitGuard > 0) return false;
    if (k.shieldT > 0) { k.shieldT = 0; k.invuln = 0.5; R.events.push({ t: 'shieldpop', id: k.id }); return false; }
    const spec = {
      oil: { spin: C.SPIN_TIME, keep: 0.55, vy: 0 },
      orb: { spin: C.SPIN_TIME * 0.95, keep: 0.4, vy: 0 },
      rocket: { spin: C.SPIN_TIME * 1.25, keep: 0.2, vy: 6 },
      comet: { spin: C.SPIN_TIME * 1.6, keep: 0.1, vy: 13 },
      bump: { spin: 0, keep: 0.8, vy: 0 },
    }[kind] || { spin: C.SPIN_TIME, keep: 0.5, vy: 0 };
    if (k.remote) k.hitGuard = 0.35;     // online: the owner's packets lag behind, do not hit the same kart twice
    k.spinT = spec.spin; k.spinTot = spec.spin; k.spinDir = Math.random() < 0.5 ? -1 : 1; k.vx *= spec.keep; k.vz *= spec.keep;
    if (spec.vy) { k.vy = spec.vy; k.grounded = false; k.airT = 0; }
    k.drift.state = 0; k.drift.charge = 0; k.boostT = Math.min(k.boostT, 0.2);
    k.invuln = spec.spin + 0.9; k.hitT = 0.5; k.lastHitBy = source ? source.id : null;
    if (k.roll) k.roll = null;
    R.events.push({ t: 'hit', id: k.id, kind, by: source ? source.id : null });
    return true;
  };
})();
