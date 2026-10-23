/* Schueberfouer Tycoon W6 "Ride": the Riserad ride and the coaster point of view (DESIGN section 5, "Riesenrad ride").
 *
 *   Wheel: interact on the boarding platform -> fade -> the camera sits in a gondola eye (ud.gondolaAnchor(i); that gondola is hidden), the wheel runs at
 *          6x for two revolutions (about 40 s; the pioneers' free "Probefahrt" is three revolutions = 60 s on a temporary wheel), free look by dragging,
 *          the cabin is upright by construction -> fade -> back on the platform. First completed ride = the stamp "Op der Spëtzt" (flag 'r' in the save).
 *   Coaster: ud.ridePath(t, { train: 0, car: 0 }) of the built coasters (maus, looping, alpina, splash boats, geister carts), one lap from the front seat.
 * The ride never moves the walker: it only supplies a camera frame (position / forward / up) that walk.js applies on top of the drag-look. */
import { faceVec, frontSpot, halfDepth } from "./walk.js";
import { PITCHES } from "./data.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WHEEL_SPEED = 6;
const WHEEL_REVS = 2;
const PROBE_REVS = 3;
const FADE_MS = 420;
const EYE_OUT = 2.1;                                     // metres in front of the cabin centre (the rim is at 1.15)
const SPEED_UP_AT = 0.07, SLOW_DOWN_AT = 0.9;           // share of the ride where the wheel is still speeding up / already slowing
export const FLAG_RIDDEN = "r";                         // save flag: "Op der Spëtzt" stamp earned
export const FLAG_PROBE = "p";                          // save flag: the pioneers' free Probefahrt was used

/** wheel speed over the ride progress p (0..1): ease in, cruise at 6x, ease out to 2x for the landing (pure, harness-tested) */
export function wheelSpeedAt(p) {
  const up = clamp(p / SPEED_UP_AT, 0, 1), down = clamp((1 - p) / (1 - SLOW_DOWN_AT), 0, 1);
  const k = Math.min(up * up * (3 - 2 * up), down * down * (3 - 2 * down));
  return 1.5 + (WHEEL_SPEED - 1.5) * k;
}

export function createRide({ T, r, world, fair, game, scene, ui, audio, crowd = null, rects, faces, getWalk, getFairTime, translate }) {
  const wheelPitch = PITCHES.findIndex(p => p.size === "W");
  const T_ = (key, params) => translate(ui.lang, key, params);
  let speedup = 1;                                         // tests only: run the wheel faster so the full ride fits a flow
  const st = { active: false, kind: null, phase: "idle", ud: null, pitch: -1, gondola: 0, startAngle: 0, travelled: 0, lastAngle: 0, time: 0, total: 1, speed0: 1, probe: null, frame: null, ridden: false, peak: 0 };
  const frameOut = { position: new T.Vector3(), forward: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) };
  const pit = i => fair.pits.get(PITCHES[i].id);
  const model = i => { const p = pit(i); return p && p.near ? p.near : null; };

  function wheelUd(i) { const m = model(i); return m && m.userData.ride && m.userData.gondolaAnchor ? m.userData : null; }
  function boardWorld(i) {
    const ud = wheelUd(i);
    if (ud) { const b = ud.ride.board(); return { u: b.position.x, w: b.position.z, radius: b.radius }; }
    return null;
  }

  function frameOfWheel() {
    const a = st.ud.gondolaAnchor(st.gondola);
    // the eye sits just outside the front rim (the cabin is hidden): from inside the rim plane the rim and spokes would fill the view
    frameOut.position.copy(a.eye).addScaledVector(a.forward, EYE_OUT); frameOut.forward.copy(a.forward); frameOut.up.set(0, 1, 0);
    return frameOut;
  }
  function frameOfCoaster() {
    const p = st.ud.ridePath(getFairTime(), { train: 0, car: 0 });
    frameOut.position.copy(p.position); frameOut.forward.copy(p.forward); frameOut.up.copy(p.up);
    st.peak = Math.max(st.peak, p.position.y);
    return frameOut;
  }

  async function begin(kind, ud, pitch, opts = {}) {
    const walk = getWalk();
    if (st.active) return false;
    st.active = true; st.kind = kind; st.phase = "fadeOut"; st.ud = ud; st.pitch = pitch; st.travelled = 0; st.time = 0; st.peak = 0; st.probe = opts.probe ?? null; st.aborted = false;
    audio.clunk();
    await walk.fade(1, FADE_MS);
    if (!st.active) return false;
    // the cabin / car is set up while the screen is dark
    if (ud.setAnimated) ud.setAnimated(true);
    if (ud.setLOD) ud.setLOD(1);
    if (kind === "wheel") {
      st.gondola = ud.ride.boardingIndex();
      st.speed0 = ud.ride.speed;
      st.lastAngle = ud.ride.angle();
      st.total = (opts.revs ?? WHEEL_REVS) * TAU;
      ud.ride.setGondolaVisible(st.gondola, false);
      ud.ride.speed = wheelSpeedAt(0);
      st.frame = frameOfWheel;
    } else {
      st.total = ud.cycle ?? ud.run?.period ?? 45;
      st.frame = frameOfCoaster;
    }
    const w = getWalk();
    st.look = { yaw: w.view.yaw, pitch: w.view.pitch };      // the walker's own view comes back after the ride
    w.setLook(0, 0);
    if (crowd) crowd.setMode("ride");                  // the whole fair is the show from up here: a full crowd spread over it, not only around the walker
    st.phase = "riding";
    await w.fade(0, FADE_MS);
    return true;
  }

  async function finish(instant = false) {
    const walk = getWalk();
    if (!st.active) return;
    const wasKind = st.kind, completed = !st.aborted && st.travelled >= st.total * 0.9;
    st.phase = "fadeIn";
    if (!instant) await walk.fade(1, FADE_MS);
    if (st.kind === "wheel" && st.ud) { st.ud.ride.setGondolaVisible(st.gondola, true); st.ud.ride.speed = st.speed0 || 1; }
    if (st.probe) { try { fair.setPitch(st.probe.id, st.probe.prev); fair.flush(r.camera); } catch (error) { console.warn("[fouer] probe cleanup failed", error); } }
    audio.setWind(0);
    if (crowd && getWalk().active) crowd.setMode("walk");
    st.active = false; st.phase = "idle"; st.frame = null; st.ud = null;
    if (st.look) walk.setLook(st.look.yaw, st.look.pitch);
    if (!instant) await walk.fade(0, FADE_MS);
    if (completed && wasKind === "wheel") firstRide(st.probe);
    st.probe = null;
  }

  function firstRide(probe) {
    if (probe && !game.hasFlag(FLAG_PROBE)) game.setFlag(FLAG_PROBE);
    if (!game.hasFlag(FLAG_RIDDEN)) {
      game.setFlag(FLAG_RIDDEN);
      getWalk().showStamp("🎡", T_("ride.stamp"), T_("ride.stampBody"));
      audio.clunk();
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
      ud.ride.speed = wheelSpeedAt(p) * speedup;
      audio.setWind(clamp(ud.ride.speed / WHEEL_SPEED, 0, 1) * clamp((ud.gondolaAnchor(st.gondola).eye.y - 8) / 45, 0.15, 1));
      if (st.travelled >= st.total - 0.02) finish();
    } else {
      st.travelled += dt;
      audio.setWind(0.6);
      if (st.travelled >= st.total) finish();
    }
  }

  const api = {
    get active() { return st.active; },
    get kind() { return st.kind; },
    get phase() { return st.phase; },
    get progress() { return st.total ? clamp(st.travelled / st.total, 0, 1) : 0; },
    get peakHeight() { return st.peak; },
    info() { return { active: st.active, kind: st.kind, phase: st.phase, progress: api.progress, travelled: st.travelled, total: st.total, gondola: st.gondola }; },
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
    canCoaster(i) { const m = model(i); return Boolean(m && m.userData.ridePath); },
    boardWheel(i) { const ud = wheelUd(i); if (ud) return begin("wheel", ud, i); return false; },
    boardCoaster(i) { const m = model(i); if (m && m.userData.ridePath) return begin("coaster", m.userData, i); return false; },
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
