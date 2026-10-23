/* The ride rigs (rides wave): one per kind of ride. A rig owns the ride clock, hooks the model's animate() so that it runs on the ride clock (spin-up,
 * cruise, spin-down; the fair layer keeps calling userData.animate every frame, we only change the time it receives), and produces the camera frame.
 *
 *   rig = { start(), update(dt) -> true when the ride is over, frame (current smoothed frame), stop(), progress (0..1), left (seconds), bounds info }
 * ride.js runs the fades, the flag / stamp, the crowd and the HUD around it. update() runs after fair.update() and before walk.update() (main.js). */
import { createProgram, swingAngle, rotorTilt, rideTimeAtClock } from "./catalog.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

/** exponential smoothing of a camera frame (forward / up): removes jitter of rattling seats without a visible lag; `tau` seconds */
export function createSmoother(T) {
  const f = new T.Vector3(), u = new T.Vector3(); let init = false;
  return {
    reset() { init = false; },
    apply(frame, dt, tau) {
      if (!init) { f.copy(frame.forward); u.copy(frame.up); init = true; return frame; }
      const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      f.lerp(frame.forward, a); if (f.lengthSq() < 1e-6) f.copy(frame.forward); f.normalize();
      u.lerp(frame.up, a); u.addScaledVector(f, -u.dot(f)); if (u.lengthSq() < 1e-6) u.copy(frame.up); u.normalize();
      frame.forward.copy(f); frame.up.copy(u);
      return frame;
    },
  };
}

/** comfort: flatten the camera pitch and roll of a frame towards the horizon (k = 0 keeps the seat's own orientation, 1 = always level); the frame stays orthonormal */
export function levelAssist(frame, pitchK, rollK, down = 0) {
  if (pitchK > 0) { frame.forward.y = frame.forward.y * (1 - pitchK) - down; if (frame.forward.lengthSq() < 1e-8) frame.forward.set(0, 0, 1); frame.forward.normalize(); }
  if (rollK > 0) { frame.up.x *= 1 - rollK; frame.up.z *= 1 - rollK; frame.up.y = frame.up.y * (1 - rollK) + rollK; }
  frame.up.addScaledVector(frame.forward, -frame.up.dot(frame.forward));
  if (frame.up.lengthSq() < 1e-8) frame.up.set(0, 1, 0);
  frame.up.normalize();
  return frame;
}

/** wrap userData.animate so that the model sees the ride clock; returns the unhook function */
export function hookClock(ud, clock) {
  const orig = ud.animate;
  ud.animate = function ridden(t, dt, k) { return orig.call(this, clock.ct, Math.max(1e-4, clock.dtScaled), k); };
  return () => { ud.animate = orig; };
}

/** makes sure the model is drawn animated and in its full LOD */
function wake(ud) { if (ud.setAnimated) ud.setAnimated(true); if (ud.setLOD) ud.setLOD(1); }

/** random shrieks and laughter while the ride is fast */
function createCrowdVoices(snd) {
  let next = 3;
  return {
    update(dt, excite) {
      next -= dt;
      if (next > 0) return;
      next = rand(3.2, 7.5) / Math.max(0.35, excite);
      if (excite < 0.3) return;
      snd.scream(rand(0.9, 1.7), rand(0.05, 0.1) * clamp(excite, 0.4, 1), rand(700, 1250));
    },
  };
}

/* ------------------------------------------------------------------------------------------------------------------ seat rides */
export function createSeatRig(env) {
  const { T, ud, def, id, fx, snd, audio, calm } = env;
  const program = createProgram(def, { reduce: calm() });
  const clock = { ct: program.ct, dtScaled: 0 };
  const seat = ud.rideSeat;
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const prev = new T.Vector3(); let havePrev = false, speed = 0, swing = 0.2, camSpeed = 0;
  const smoother = createSmoother(T);
  const voices = createCrowdVoices(snd);
  let unhook = null, over = false;
  const ev = { drop: false, brake: false, settle: false, lift: false, hold: false };
  const tDrop = def.sound === "drop" ? rideTimeAtClock(def, 19.5) : 0;
  const tBrake = def.sound === "drop" ? rideTimeAtClock(def, 19.5 + Math.sqrt(2 * (80 - 27) / 25)) : 0;
  const tHold = def.sound === "drop" ? rideTimeAtClock(def, 17) : 0;
  let climbTick = 0;

  function compute(dt) {
    seat.frame(seat.preferred, out);
    camSpeed = havePrev && dt > 0 ? out.position.distanceTo(prev) / dt : 0; prev.copy(out.position); havePrev = true;
    speed += (camSpeed - speed) * (1 - Math.exp(-dt * 6));
    const a = def.assist, c = calm();
    if (a || c) levelAssist(out, Math.min(1, (a ? a.pitch : 0) + (c ? 0.25 : 0)), Math.min(1, (a ? a.roll : 0) + (c ? 0.3 : 0)), a && a.down ? a.down : 0);
    smoother.apply(out, dt, c ? 0.28 : 0.07);
  }
  return {
    kind: "seat", id,
    start() {
      wake(ud);
      unhook = hookClock(ud, clock);
      // the towers integrate their spin from the idle animation: start every ride from the same pose (the same view each time)
      if (ud.rig) { if ("spin" in ud.rig) ud.rig.spin = 0; if ("theta" in ud.rig) ud.rig.theta = 0; }
      if (ud.kette) { ud.kette.swing = swing; ud.kette.tilt = 0.03; }
      snd.startBed(def.sound);
      compute(0);
      fx.hint(env.hint, 5);
    },
    update(dt) {
      if (over) return true;
      program.step(dt); clock.ct = program.ct; clock.dtScaled = program.dtScaled;
      if (ud.kette) {
        const target = swingAngle(program.speed), k = 1 - Math.exp(-dt * 1.4);
        swing += (target - swing) * k; ud.kette.swing = swing; ud.kette.tilt = 0.03 + rotorTilt(program.speed);
      }
      compute(dt);
      const excite = def.high ? clamp(speed / 22, 0, 1) : clamp(program.speed / def.hi, 0, 1) ** 1.5;
      snd.setBed(excite, def.high ? clamp(speed / 28, 0, 1) : excite * 0.6);
      audio.setWind(def.high ? clamp(speed / 30, 0, 0.9) : excite * 0.35);
      fx.setVignette(def.high ? clamp(speed / 40, 0, 0.5) : excite * 0.4);
      if (def.sound !== "drop") voices.update(dt, excite);
      else {
        if (!ev.lift && program.mt > 3) { ev.lift = true; snd.clank(1); }
        if (program.mt < tHold && program.mt > 3 && (climbTick -= dt) <= 0) { climbTick = 0.45; snd.clank(0.5); }
        if (!ev.hold && program.mt > tHold) { ev.hold = true; fx.hint(env.holdHint, 3); }
        if (!ev.drop && program.mt >= tDrop - 0.05) { ev.drop = true; snd.whoosh(2.4, 1.2); snd.scream(2.1, 0.16, 760); fx.setVignette(0.6); }
        if (ev.drop && !ev.brake) fx.setVignette(0.6);
        if (!ev.brake && program.mt >= tBrake) { ev.brake = true; snd.thud(1); snd.clank(1.2); fx.shake(1); fx.strobe(0.25); }
        if (!ev.settle && program.mt >= tBrake + 1.1) { ev.settle = true; snd.bump(0.6); fx.shake(0.5); }
      }
      if (program.done) { over = true; return true; }
      return false;
    },
    get frame() { return out; },
    get progress() { return program.p; },
    get left() { return Math.max(0, program.dur - program.rt); },
    get speed() { return speed; },
    get clock() { return clock; },
    debug() { return { clock: +clock.ct.toFixed(2), modelSpeed: +program.speed.toFixed(2), camSpeed: +speed.toFixed(1), calm: calm(), events: { ...ev }, swing: ud.kette ? +swing.toFixed(2) : null, seat: seat.preferred }; },
    stop() { if (unhook) unhook(); unhook = null; if (ud.kette) { ud.kette.swing = null; ud.kette.tilt = 0.03; } snd.stopBed(); audio.setWind(0); fx.setVignette(0); },
  };
}

/* ------------------------------------------------------------------------------------------------------------------ track rides (coasters, flume) */
/** the model-clock time at which train 0 leaves the station (scans ridePath's arc length) */
export function departureTime(ud) {
  const per = ud.run.period; let t = 0, prevS = ud.ridePath(0).s;
  for (; t < per * 1.05; t += 0.25) {
    const s = ud.ridePath(t).s;
    if (prevS < 0.02 && s >= 0.02) {
      let lo = t - 0.25, hi = t;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ud.ridePath(mid).s < 0.02) lo = mid; else hi = mid; }
      return hi;
    }
    prevS = s;
  }
  return 0;
}

/** coasters: the eye sits a little higher and at the nose of the front car (the models' default eye is behind the hood, which then fills a third of the view) */
const COASTER_EYE = [0, 1.5, 0.85];

export function createTrackRig(env) {
  const { T, ud, def, id, fx, snd, audio, calm } = env;
  const LEAD = 2.2, TAIL = 3.0;
  const dep = departureTime(ud);
  const clock = { ct: dep - LEAD, dtScaled: 0 };
  const total = ud.run.runTime + LEAD + TAIL;
  const out = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const smoother = createSmoother(T);
  const voices = createCrowdVoices(snd);
  const st = { rt: 0, speed: 0, climbTick: 0, lastY: 0, lastDy: 0, splash: false, whoosh: false, tail: false, peak: 0, over: false, dropK: 0 };
  let unhook = null;
  const flume = def.kind === "flume";
  const impact = flume ? ud.tImpact : 0;

  function compute(dt) {
    const p = ud.ridePath(clock.ct, flume ? { train: 0, car: 0 } : { train: 0, car: 0, eye: COASTER_EYE });
    out.position.copy(p.position); out.forward.copy(p.forward); out.up.copy(p.up);
    st.speed = p.speed; st.peak = Math.max(st.peak, p.position.y);
    smoother.apply(out, dt, calm() ? 0.22 : 0.05);
    return p;
  }
  return {
    kind: def.kind, id,
    start() {
      wake(ud);
      unhook = hookClock(ud, clock);
      st.lastY = ud.ridePath(clock.ct).position.y;
      snd.startBed(def.sound);
      compute(0);
    },
    update(dt) {
      if (st.over) return true;
      st.rt += dt; clock.ct += dt; clock.dtScaled = dt;
      const p = compute(dt);
      const dy = dt > 0 ? (p.position.y - st.lastY) / dt : 0; st.lastY = p.position.y;
      const sp01 = clamp(p.speed / (flume ? 10 : 22), 0, 1);
      snd.setBed(sp01, sp01 * (flume ? 0.6 : 1));
      audio.setWind(sp01 * 0.7);
      fx.setVignette(sp01 * 0.35);
      if (dy > 1.0 && (st.climbTick -= dt) <= 0) { st.climbTick = flume ? 0.38 : 0.3; snd.clank(0.45); }
      if (dy < -6 && st.lastDy >= -6 && st.rt > 3) { snd.scream(rand(1.3, 2.0), 0.12, rand(750, 1100)); snd.whoosh(1.4, 0.7); }
      st.lastDy = dy;
      if (flume) {
        const ph = ((clock.ct % ud.run.period) + ud.run.period) % ud.run.period;
        if (!st.whoosh && ph >= impact - 2.4 && ph < impact) { st.whoosh = true; snd.whoosh(2.0, 1.0); snd.scream(1.8, 0.14, 900); }
        if (!st.splash && ph >= impact - 0.05 && ph < impact + 1) { st.splash = true; snd.splash(1); fx.spray(110, 1.25); fx.shake(0.9); fx.flashHit(0); }
      } else voices.update(dt, sp01);
      if (st.rt >= total) { st.over = true; return true; }
      return false;
    },
    get frame() { return out; },
    get progress() { return clamp(st.rt / total, 0, 1); },
    get left() { return Math.max(0, total - st.rt); },
    get speed() { return st.speed; },
    get peak() { return st.peak; },
    get clock() { return clock; },
    debug() { return { clock: +clock.ct.toFixed(2), speed: +st.speed.toFixed(1), peak: +st.peak.toFixed(1), splash: st.splash, whoosh: st.whoosh, calm: calm(), dep: +dep.toFixed(2), total: +total.toFixed(1) }; },
    stop() { if (unhook) unhook(); unhook = null; snd.stopBed(); audio.setWind(0); fx.setVignette(0); },
  };
}
