/* Schueberfouer Tycoon W6 "Ride" + the Rides wave: every ride attraction can be ridden from the walk (DESIGN section 5).
 *
 *   Wheel (W6): interact on the boarding platform -> fade -> the camera sits in the seated eye of a gondola (ud.gondolaAnchor(i); that gondola is hidden, rides/cabin.js puts its interior around you), the wheel runs at
 *          6x for two revolutions (about 40 s; the pioneers' free "Probefahrt" is three revolutions = 60 s on a temporary wheel), free look by dragging,
 *          the cabin is upright by construction -> fade -> back on the platform. First completed ride = the stamp "Op der Spëtzt" (flag 'r' in the save).
 *   Rides wave: rides/catalog.js says what each attraction is (seat ride on an animated seat of the model, coaster, flume, ghost train, bumper cars) and
 *          rides/rigs.js runs it (the ride clock feeds userData.animate: spin-up, cruise, spin-down; the camera is the seat's world matrix, smoothed a little).
 * The ride never moves the walker: it only supplies a camera frame (position / forward / up) that walk.js applies on top of the drag-look. */
import { faceVec, frontSpot, halfDepth } from "./walk.js";
import { PITCHES } from "./data.js";
import { RIDE_DEFS, defOf, flagOf, isHigh } from "./rides/catalog.js";
import { createSeatRig, createTrackRig } from "./rides/rigs.js";
import { createGhostRig } from "./rides/ghost.js";
import { createDriveRig } from "./rides/drive.js";
import { createCabin, CABIN_LOOK } from "./rides/cabin.js";
import { createFx } from "./rides/fx.js";
import { createRideSound } from "./rides/sound.js";
import { readReduceMotion, writeReduceMotion } from "./rides/settings.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WHEEL_SPEED = 6;
const WHEEL_REVS = 2;
const PROBE_REVS = 3;
const FADE_MS = 420;
const WHEEL_SPEED_CALM = 4;                              // cruise speed of the wheel with the reduce-motion option (x of the normal speed)
const CABIN_NEAR = 0.08;                                // near plane inside the cabin (the walk's 0.2 would clip the bench and the safety bar)
const SPEED_UP_AT = 0.07, SLOW_DOWN_AT = 0.9;           // share of the ride where the wheel is still speeding up / already slowing
export const FLAG_RIDDEN = "r";                         // save flag: "Op der Spëtzt" stamp earned
export const FLAG_PROBE = "p";                          // save flag: the pioneers' free Probefahrt was used

export { readReduceMotion, writeReduceMotion };

/** wheel speed over the ride progress p (0..1): ease in, cruise at 6x, ease out to 2x for the landing (pure, harness-tested) */
export function wheelSpeedAt(p, calm = false) {
  const up = clamp(p / SPEED_UP_AT, 0, 1), down = clamp((1 - p) / (1 - SLOW_DOWN_AT), 0, 1);
  const k = Math.min(up * up * (3 - 2 * up), down * down * (3 - 2 * down));
  return 1.5 + ((calm ? WHEEL_SPEED_CALM : WHEEL_SPEED) - 1.5) * k;
}

export function createRide({ T, r, world, fair, game, scene, ui, audio, crowd = null, rects, faces, getWalk, getFairTime, translate }) {
  const wheelPitch = PITCHES.findIndex(p => p.size === "W");
  const T_ = (key, params) => translate(ui.lang, key, params);
  let speedup = 1;                                         // tests only: run the rides faster so the full ride fits a flow
  const st = { active: false, kind: null, id: null, def: null, phase: "idle", ud: null, pitch: -1, gondola: 0, startAngle: 0, travelled: 0, lastAngle: 0, time: 0, total: 1, speed0: 1, probe: null, frame: null, cabin: null, near: null, ridden: false, peak: 0, rig: null, aborted: false, completed: false, look: null };
  const frameOut = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const rgt = new T.Vector3();
  const snd = createRideSound(audio);
  let fx = null;
  let calmNow = false;                                     // the reduce-motion option, read once per ride (not every frame)
  const calm = () => calmNow;
  const getFx = () => fx ?? (fx = createFx({ hud: getWalk().hud, reduce: calm }));
  const pit = i => fair.pits.get(PITCHES[i].id);
  const model = i => { const p = pit(i); return p && p.near ? p.near : null; };
  const itemAt = i => { const e = game.state.pitches[i]; return e ? e.k : null; };

  function wheelUd(i) { const m = model(i); return m && m.userData.ride && m.userData.gondolaAnchor ? m.userData : null; }
  function boardWorld(i) {
    const ud = wheelUd(i);
    if (ud) { const b = ud.ride.board(); return { u: b.position.x, w: b.position.z, radius: b.radius }; }
    return null;
  }

  /** the camera is the seated eye of the ridden gondola (inside its first-person cabin, which is placed on the same anchor, so both follow the gondola exactly) */
  function frameOfWheel() {
    const a = st.ud.gondolaAnchor(st.gondola);
    if (st.cabin) st.cabin.place(a, st.ud.nightK ?? 0);
    frameOut.position.copy(a.eye); frameOut.forward.copy(a.forward); frameOut.up.set(0, 1, 0);
    return frameOut;
  }
  /** the frame of a rig plus the camera shake (screen-shake of a landing, hits, rattles); the reduce-motion option damps it */
  function frameOfRig() {
    const f = st.rig.frame;
    frameOut.position.copy(f.position); frameOut.forward.copy(f.forward); frameOut.up.copy(f.up);
    const k = (fx ? fx.shakeValue : 0) * (calmNow ? 0.3 : 1);
    if (k > 0.002) {
      const t = st.time;
      rgt.crossVectors(frameOut.forward, frameOut.up).normalize();
      const a = (Math.sin(t * 61) + Math.sin(t * 37 + 1.3)) * 0.5, b = (Math.sin(t * 53 + 0.4) + Math.sin(t * 29 + 2.1)) * 0.5;
      frameOut.position.addScaledVector(rgt, a * 0.035 * k).addScaledVector(frameOut.up, b * 0.05 * k);
      frameOut.forward.addScaledVector(rgt, a * 0.025 * k).addScaledVector(frameOut.up, b * 0.02 * k).normalize();
    }
    return frameOut;
  }

  /** the model must be live (animated parts as separate meshes) before the ride starts: the walker stands next to it, so it is among the nearest.
   *  A pit whose model was rebuilt (a new attraction or an upgrade on an already live pit) stays frozen while the set of live pits is unchanged (fair.js keeps a key of
   *  the set), so the quality call resets that key. */
  async function ensureLive(pitch) {
    const p = pit(pitch);
    if (!p || p.opaque || p.live) return;
    try { fair.setQuality(fair.quality()); } catch (error) { /* older fair layer */ }
    for (let i = 0; i < 12 && !(p.opaque || p.live); i++) { fair.flush(r.camera); if (p.opaque || p.live) break; await new Promise(res => setTimeout(res, 80)); }
  }

  async function begin(id, ud, pitch, opts = {}) {
    const walk = getWalk();
    if (st.active) return false;
    const def = RIDE_DEFS[id] ?? RIDE_DEFS.wheel;
    st.active = true; st.id = id; st.def = def; st.kind = def.kind; st.phase = "fadeOut"; st.ud = ud; st.pitch = pitch; st.travelled = 0; st.time = 0; st.peak = 0; st.probe = opts.probe ?? null; st.aborted = false; st.completed = false; st.rig = null;
    audio.clunk();
    await walk.fade(1, FADE_MS);
    if (!st.active) return false;
    // the cabin / car is set up while the screen is dark
    if (ud.setAnimated) ud.setAnimated(true);
    if (ud.setLOD) ud.setLOD(1);
    const w = getWalk();
    st.look = { yaw: w.view.yaw, pitch: w.view.pitch };      // the walker's own view comes back after the ride
    if (def.kind === "wheel") {
      st.gondola = ud.ride.boardingIndex();
      st.speed0 = ud.ride.speed;
      st.lastAngle = ud.ride.angle();
      st.total = (opts.revs ?? WHEEL_REVS) * TAU;
      calmNow = readReduceMotion();
      ud.ride.setGondolaVisible(st.gondola, false);                      // the ridden gondola's outside is hidden: its first-person cabin takes its place
      ud.ride.speed = wheelSpeedAt(0, calmNow);
      st.cabin = createCabin(T, ud.gondolaStyle);
      r.scene.add(st.cabin.group);
      st.cabin.place(ud.gondolaAnchor(st.gondola), ud.nightK ?? 0); st.cabin.show();
      st.near = r.camera.near; r.camera.near = CABIN_NEAR; r.camera.updateProjectionMatrix();
      st.frame = frameOfWheel;
    } else {
      calmNow = readReduceMotion();
      await ensureLive(pitch);
      const f = getFx();
      f.show(T_(`item.${id}`), def.icon);
      const env = { T, ud, group: model(pitch), def, id, fx: f, snd, audio, calm, walk: w, r, world, fair, game, T_, pitch, getFairTime, hint: T_("ride.hint"), holdHint: T_("ride.holdHint") };
      try {
        st.rig = def.kind === "seat" ? createSeatRig(env) : def.kind === "ghost" ? createGhostRig(env) : def.kind === "drive" ? createDriveRig(env) : createTrackRig(env);
        st.rig.start();
      } catch (error) {
        console.error("[fouer] ride setup failed", error);
        f.hide(); st.rig = null; st.active = false; st.phase = "idle"; st.frame = null; st.ud = null;
        await w.fade(0, FADE_MS);
        return false;
      }
      st.frame = frameOfRig;
    }
    w.setLook(0, 0);
    if (crowd && isHigh(id)) crowd.setMode("ride");              // the whole fair is the show from up here: a full crowd spread over it, not only around the walker
    st.phase = "riding";
    await w.fade(0, FADE_MS);
    return true;
  }

  async function finish(instant = false) {
    const walk = getWalk();
    if (!st.active) return;
    const wasId = st.id, wasKind = st.kind, completed = !st.aborted && (wasKind === "wheel" ? st.travelled >= st.total * 0.9 : (st.rig ? st.rig.progress >= 0.9 : false));
    st.phase = "fadeIn";
    if (!instant) await walk.fade(1, FADE_MS);
    if (st.kind === "wheel" && st.ud) { st.ud.ride.setGondolaVisible(st.gondola, true); st.ud.ride.speed = st.speed0 || 1; }
    if (st.cabin) { st.cabin.dispose(); st.cabin = null; }
    if (st.near !== null) { r.camera.near = st.near; r.camera.updateProjectionMatrix(); st.near = null; }
    if (st.rig) { try { st.rig.stop(); } catch (error) { console.warn("[fouer] ride cleanup failed", error); } }
    if (fx) fx.hide();
    snd.stopBed();
    if (st.probe) { try { fair.setPitch(st.probe.id, st.probe.prev); fair.flush(r.camera); } catch (error) { console.warn("[fouer] probe cleanup failed", error); } }
    audio.setWind(0);
    if (crowd && getWalk().active) crowd.setMode("walk");
    st.completed = completed;
    st.active = false; st.phase = "idle"; st.frame = null; st.ud = null; st.rig = null;
    if (st.look) walk.setLook(st.look.yaw, st.look.pitch);
    if (walk.fromBuilder) { if (!instant) await walk.leaveToBuilder(); }           // feedback A: a ride that began in the builder view returns to the builder camera
    else if (!instant) await walk.fade(0, FADE_MS);
    if (completed) firstRide(wasId, wasKind, st.probe);
    st.probe = null;
  }

  function firstRide(id, kind, probe) {
    if (kind === "wheel") {
      if (probe && !game.hasFlag(FLAG_PROBE)) game.setFlag(FLAG_PROBE);
      if (!game.hasFlag(FLAG_RIDDEN)) {
        game.setFlag(FLAG_RIDDEN);
        getWalk().showStamp("🎡", T_("ride.stamp"), T_("ride.stampBody"));
        audio.clunk();
      }
    } else {
      const flag = flagOf(id), name = T_(`item.${id}`);
      if (flag && !game.hasFlag(flag)) {
        if (game.setFlag(flag)) { getWalk().showStamp(RIDE_DEFS[id].icon, T_("ride.stampRide", { name }), T_("ride.stampRideBody", { name })); audio.clunk(); }
      }
    }
    if (game.fun) {
      const res = game.fun(id);
      if (res && res.granted) ui.toast(T_("fun.gain", { n: res.percent }), 3800);
    }
  }

  function update(dt) {
    if (!st.active || st.phase !== "riding") return;
    st.time += dt;
    if (st.kind === "wheel") {
      const ud = st.ud, angle = ud.ride.angle();
      let d = angle - st.lastAngle; if (d < -Math.PI) d += TAU; if (d < 0) d = 0;
      st.travelled += d; st.lastAngle = angle;
      const p = clamp(st.travelled / st.total, 0, 1);
      ud.ride.speed = wheelSpeedAt(p, calmNow) * speedup;
      audio.setWind(clamp(ud.ride.speed / WHEEL_SPEED, 0, 1) * clamp((ud.gondolaAnchor(st.gondola).eye.y - 8) / 45, 0.15, 1));
      if (st.travelled >= st.total - 0.02) finish();
    } else if (st.rig) {
      // tests fast-forward the ride (speedup > 1): sub-steps of at most 0.12 s keep the springs and the physics of the rigs stable
      const total = dt * speedup, n = Math.max(1, Math.ceil(total / 0.12));
      let done = false;
      for (let i = 0; i < n && !done; i++) done = st.rig.update(total / n);
      st.peak = Math.max(st.peak, st.rig.frame.position.y);
      const f = getFx(); f.setProgress(st.rig.progress, st.rig.left); f.update(dt);
      if (done) finish();
    }
  }

  const info = () => {
    const f = st.frame ? st.frame() : null;
    return { active: st.active, kind: st.kind, id: st.id, phase: st.phase, progress: api.progress, travelled: st.travelled, total: st.total, gondola: st.gondola, left: st.rig ? st.rig.left : null,
      speed: st.rig && st.rig.speed !== undefined ? st.rig.speed : null, completed: st.completed,
      cam: f ? { pos: f.position.toArray(), fwd: f.forward.toArray(), up: f.up.toArray() } : null, rig: st.rig && st.rig.debug ? st.rig.debug() : null };
  };

  const rideKindOf = i => { const id = itemAt(i); return id ? defOf(id) : null; };
  function canRide(i) {
    const id = itemAt(i); const def = id ? defOf(id) : null; if (!def) return false;
    const m = model(i); if (!m) return false;
    const ud = m.userData;
    switch (def.kind) {
      case "wheel": return Boolean(ud.ride && ud.gondolaAnchor);
      case "seat": return Boolean(ud.rideSeat);
      case "drive": return Boolean(ud.floor && "drive" in ud);
      default: return Boolean(ud.ridePath);
    }
  }
  function board(i) {
    const id = itemAt(i); if (!id || !canRide(i)) return false;
    const def = defOf(id);
    if (def.kind === "wheel") return begin("wheel", wheelUd(i), i);
    return begin(id, model(i).userData, i);
  }

  const api = {
    get active() { return st.active; },
    get kind() { return st.kind; },
    get id() { return st.id; },
    get phase() { return st.phase; },
    get high() { return st.active && st.id ? isHigh(st.id) : false; },
    /** the wheel sees the whole field from up there: the walk then draws the merged (untiled) batches (W6); every other ride keeps the tiles (frustum culling: fewer triangles, a few more draws) */
    get untiled() { return st.active && st.kind === "wheel"; },
    /** the drive rig wants the arrow keys for steering (walk.js does not turn the view with them) */
    get steering() { return st.active && st.kind === "drive"; },
    get progress() { return st.kind === "wheel" ? (st.total ? clamp(st.travelled / st.total, 0, 1) : 0) : (st.rig ? st.rig.progress : 0); },
    get peakHeight() { return st.peak; },
    /** the drag-look range of the ride (relative to the seat): inside the wheel's cabin the head turns about 100 degrees each way; null = the walk's own limits */
    get lookLimits() { return st.active && st.kind === "wheel" ? CABIN_LOOK : null; },
    /** tests only: the first-person cabin of the wheel ride (null outside the ride) */
    get cabin() { return st.cabin; },
    get fx() { return fx; },
    /** tests only: the running rig (the bumper-car rig exposes `sim`) */
    get rig() { return st.rig; },
    get sound() { return snd; },
    info,
    update,
    frame() { return st.frame ? st.frame() : null; },
    abort(instant = false) { if (!st.active) return; st.aborted = true; finish(instant); },
    wheelPitch,
    /** tests only */
    setTestSpeedup(k) { speedup = Math.max(0.1, k); },
    /** boarding spot of the built Riserad (world u / w, interact radius) */
    boardInfo(i) { return boardWorld(i); },
    /** the rectangle (game frame) that stays walkable inside the Riserad pitch: from the boarding platform out to the front edge */
    boardingHole(i) {
      const rect = rects[i], face = faces[i];
      const board = boardWorld(i);
      const [fu, fw] = faceVec(face);
      const b = board ?? { u: rect.u + fu * 5.2, w: rect.w + fw * 5.2 };
      const end = { u: rect.u + fu * (halfDepth(rect, face) + 1), w: rect.w + fw * (halfDepth(rect, face) + 1) };
      const half = 2.6;
      const tu = Math.abs(fw) * half, tw = Math.abs(fu) * half;
      return { u0: Math.min(b.u - fu * 3, end.u) - tu, u1: Math.max(b.u - fu * 3, end.u) + tu, w0: Math.min(b.w - fw * 3, end.w) - tw, w1: Math.max(b.w - fw * 3, end.w) + tw };
    },
    /** can the attraction on pitch i be ridden (a model with a seat, a path, a car ...)? The walk shows its round button when this is true and the wheel is handled by boardInfo */
    canRide,
    rideKindOf,
    board,
    canCoaster(i) { const m = model(i); return Boolean(m && m.userData.ridePath); },
    boardWheel(i) { const ud = wheelUd(i); if (ud) return begin("wheel", ud, i); return false; },
    boardCoaster(i) { const m = model(i); if (m && m.userData.ridePath) return begin(itemAt(i) ?? "maus", m.userData, i); return false; },
    /** the pioneers' free Probefahrt: only before the wheel is built, once */
    probeSpot() {
      if (wheelPitch < 0 || game.state.pi !== 1 || game.hasFlag(FLAG_PROBE) || game.state.pitches.some(e => e && e.k === "wheel") || game.state.pitches[wheelPitch]) return null;
      const spot = frontSpot(rects[wheelPitch], faces[wheelPitch], 3);
      return { i: wheelPitch, x: spot.x, z: spot.z };
    },
    async probe() {
      const spot = api.probeSpot(); if (!spot || st.active) return false;
      const id = PITCHES[wheelPitch].id, prev = fair.getPitch(id) ?? { state: "locked" };
      fair.setPitch(id, { state: "built", item: "wheel", look: 0, level: 2 });
      fair.flush(r.camera);
      const ud = wheelUd(wheelPitch);
      if (!ud) { fair.setPitch(id, prev); return false; }
      return begin("wheel", ud, wheelPitch, { revs: PROBE_REVS, probe: { id, prev } });
    },
  };
  return api;
}
