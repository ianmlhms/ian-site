/* Real lift rides (round 6, round 7-B: from station to station; pure: no THREE, no DOM; the Node tests use the same code).
 * A ride follows one lift's real line (lift-path.js: the data's polyline, the rope over the pylon tops with its sag) between the stations
 * of lift-site.js, at RIDE.factor times the real line speed (the real lines are long), and the ride itself can be skipped.
 *   board   from the waiting zone in the bottom station to the loading line: gondola / cable car / train: step out of the skis, carry
 *           them on the shoulder to the door; chair / drag lift / carpet: skate up to the line. The rider's own carrier comes round
 *           the bull-wheel (the next one of the lift's own loop: lifts.js nextCarrier) and picks him up there; a T-bar's spring line
 *           reels out to his hips
 *   ride    seated on the chair (the bar comes down once out of the station), standing in the cabin / carriage with the skis on the
 *           shoulder, on the snow in the track behind the bar (skis on the snow), on the belt
 *   alight  at the top: off onto the platform on the outer side, then out of the station to the exit spot (lift-site.js exitOf:
 *           outside every building, on snow, facing downhill, 15 m clear); cabins: walk out carrying the skis, put them down and click
 *           in. Then he stands still (main.js holds him at 0 km/h until the player steers or pushes)
 * The ride state that goes on the wire (multiplayer: a friend on the same lift sits in his own chair) is { lift index, s, kind } while
 * he is on the carrier. The camera: 'chase' = third person beside / behind, 'window' = from the rider's eyes along the line. */
import { LIFT_SPEC, carrierBox } from '../lift-path.js';
import { BOARD, UNLOAD } from '../lift-site.js';

export const RIDE = Object.freeze({
  factor: 4,                 // x the real line speed
  boardSpeed: 6,             // m/s: slower than this to board (in the zone)
  enter: BOARD, exit: UNLOAD,
  seat: { chair: -2.0, gondola: -4.05, cable: -6.05, drag: 0, train: 0.5, carpet: 0.18 },   // the rider below the rope (train: on the rail)
  minRide: 1.5,              // s: even a skipped ride shows the carrier this long
  walk: 1.7, glide: 2.2, out: 3.0,    // m/s: walking with the skis, skating to the loading line, skiing out of the station
  stepOut: 0.7, getIn: 0.55, clickIn: 1.3, barDrop: 0.9, getOut: 0.6, turn: 0.6,
  wait: 2.5,                 // s at most the rider waits for the next carrier (beyond that the lift catches up)
});
const DRAG_BACK = 1.8;                // R8e: m the rider of a platter / T-bar is pulled behind the spring box (the rod ~20 deg off the vertical)
/** R8e: how far behind the spring box he rides: the rod ~22 deg off the vertical whatever the rope's height over the track. */
function dragBack(path, s, height) {
  const q = path.at(s, {}), up = path.cableY(s) - 0.65 - (height(q.x, q.z) + 0.8);
  return Math.max(DRAG_BACK, Math.min(3.2, up * 0.42));
}
const FUNITEL_SEAT = -4.75;            // R8e: the rider's feet below the ropes in a funitel cabin (carriers.js: floor 4.8 m down)
export const POSE_OF = Object.freeze({ chair: 'sit', gondola: 'carry', cable: 'carry', train: 'carry', drag: 'drag', carpet: 'belt' });
export const KIND_CODE = Object.freeze({ chair: 1, gondola: 2, cable: 3, drag: 4, train: 5, carpet: 6 });
export const KIND_OF_CODE = Object.freeze(Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])));
const CARRY = new Set(['gondola', 'cable', 'train']);
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const lerp = (a, b, k) => a + (b - a) * k;
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** The stretch of line a ride covers: [s0, s1] (clamped to 20 % of the line on very short lifts: the 60 m Leisee-Shuttle). */
export function rideSpan(path) {
  const key = path.kind === 'drag' && path.sub === 'rope' ? 'rope' : path.kind;
  const s0 = Math.min(BOARD[key], path.len * 0.2), s1 = Math.max(s0 + 1, path.len - Math.min(UNLOAD[key], path.len * 0.2));
  return [s0, s1];
}
/** Seconds the ride on the carrier takes at the game's speed (path = lift-path.js createLiftPath). */
export function rideSeconds(path, factor = RIDE.factor) {
  const [s0, s1] = rideSpan(path);
  return Math.max(0, s1 - s0) / (path.spec.speed * factor);
}

/** The carrier and the rider at s along the line (up lane): { cx, cy, cz (rope grip / rail top / belt), x, y, z (rider), heading, pitch,
 *  hip (drag: where the bar holds him) }. height(x, z) is the snow (drag lifts, belts and trains sit on it). */
export function riderAt(path, s, height, out = {}) {
  const k = path.kind;
  const c = path.shuttle ? path.shuttleAt(s, 1, true, {}) : path.loopAt(path.upU(s), {});
  const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
  const rx = -fz, rz = fx;
  out.s = s; out.heading = c.heading; out.pitch = 0; out.roll = out.roll || 0;
  out.cx = c.x; out.cz = c.z;
  if (k === 'train') { out.cy = c.y; out.pitch = Math.atan(path.slope(s)); }
  else if (k === 'carpet') out.cy = height(c.x, c.z) + 0.18;
  else out.cy = c.y;
  if (k === 'drag') {
    const lat = path.sub === 'rope' ? -0.45 * path.sign : 0;       // a rope tow: the rope at his outer hand
    // R8e (3V QA "Belvédère": the platter rod hung straight down behind him, not held): he is pulled 1 m behind the spring box, the rod
    // runs from it down and back to the disc / T between his legs, his hand holds it ~0.55 m up from there (skier-model.js poseDrag)
    const back = path.sub === 'rope' ? 0 : dragBack(path, s, height);
    out.x = c.x + rx * lat - fx * back; out.z = c.z + rz * lat - fz * back; out.y = height(out.x, out.z); out.hip = out.y + (path.sub === 'platter' ? 0.78 : 0.86);
    if (back) {
      const bx = out.x + fx * 0.04, bz = out.z + fz * 0.04, ty = c.y - 0.65, dx = c.x - bx, dy = ty - out.hip, dz = c.z - bz, L = Math.hypot(dx, dy, dz) || 1;
      out.hand = { x: bx + dx / L * 0.55, y: out.hip + dy / L * 0.55, z: bz + dz / L * 0.55 };
    } else out.hand = null;
  } else if (k === 'carpet') { out.x = c.x; out.z = c.z; out.y = out.cy; }
  else if (k === 'chair') {
    const slot = Math.min(0.45, 0.25 * Math.max(1, (path.seats || 4) / 2 - 0.5));     // a seat left of the middle (towards the line)
    out.x = c.x - fx * 0.05 - rx * slot; out.z = c.z - fz * 0.05 - rz * slot; out.y = c.y + RIDE.seat.chair;
  } else if (k === 'train') {
    const f = path.shuttleAt(Math.min(path.len, s + 3), 1, true, {});      // 3 m ahead in the carriage, on the line (smooth in the curves)
    out.x = f.x; out.z = f.z; out.y = f.y + RIDE.seat.train;
  } else { out.x = c.x + fx * 0.35; out.z = c.z + fz * 0.35; out.y = c.y + (path.sub === 'funitel' ? FUNITEL_SEAT : RIDE.seat[k]); }
  return out;
}

/**
 * One ride. lift = the free ride lift (modes/freeride.js createLiftNet entry), path = its line, site = lift-site.js createLiftSite,
 * from = where the rider stands (in the waiting zone; default: the zone's waiting spot), startU = the loop parameter of the carrier that
 * will pick him up (lifts.js nextCarrier; default: one line-speed approach behind the loading point), exitAt() = the exit spot at the
 * top ({ x, z, heading }; asked for when he gets off, so the tiles there are in).
 */
// R8e (3V QA: a cable car boarded with no cabin at the bottom station): shuttle = lifts.js shuttleBoard(): the boarding waits until the
// scheduled up-track cabin has come down and docked (the cabin drawn coming in), never a cabin out of nowhere
export function createRide({ lift, path, site, height, factor = RIDE.factor, from = null, startU = null, exitAt = null, shuttle = null }) {
  const k = path.kind;
  const [s0, s1] = rideSpan(path);
  const speed = path.spec.speed * factor;
  const carry = CARRY.has(k);
  const start = from || site.wait;
  const load = site.load;
  const seatAt0 = riderAt(path, s0, height, {});
  // the boarding timeline
  const tStep = carry ? RIDE.stepOut : 0;
  const moveD = Math.hypot(load.x - start.x, load.z - start.z);
  const tMove = Math.max(0.8, moveD / (carry ? RIDE.walk : RIDE.glide));
  const tIn = k === 'drag' ? (path.sub === 'rope' ? 0.4 : RIDE.barDrop) : k === 'carpet' ? 0.3 : RIDE.getIn;
  const sLoad = k === 'drag' && path.sub !== 'rope' ? Math.min(s1 - 1, s0 + dragBack(path, s0, height)) : s0;      // R8e: the bar's box 1 m ahead of him
  const uLoad = path.shuttle ? s0 : path.upU(sLoad);
  const tNeed = tStep + tMove + tIn;
  let u0 = startU === null || !Number.isFinite(startU) ? uLoad - path.spec.speed * tNeed : startU;
  if (path.shuttle) u0 = uLoad;
  const approach = uLoad - u0;
  const tArrive = path.shuttle ? Math.max(tNeed, shuttle ? shuttle.wait + tIn : 0) : Math.max(tNeed, Math.min(approach / path.spec.speed, tNeed + RIDE.wait));
  const cabin = (tt) => (path.shuttle && shuttle ? shuttle.at(tt) : { s: s0, up: true });       // the jig-back cabin while he boards
  let phase = 'board', t = 0, s = sLoad, skipped = false, tRide = 0, alight = null;
  const pose = { roll: 0 };
  const ride = {
    lift, path, site, kind: k, pose: POSE_OF[k], speed, carry,
    get phase() { return phase; },
    get s() { return s; }, get t() { return t; },
    get done() { return phase === 'done'; },
    get share() { return phase === 'board' ? 0 : phase === 'ride' ? (s - s0) / (s1 - s0) : 1; },
    /** Seconds left on the carrier at the game's speed. */
    get left() { return phase === 'ride' ? Math.max(0, (s1 - s) / speed) : phase === 'board' ? rideSeconds(path, factor) : 0; },
    /** The loop parameter of the rider's own carrier while it holds him (lifts.js setRide), else null (the lift's own loop has it). */
    get carrierU() {
      if (phase === 'board') return path.shuttle ? path.upU(cabin(t).s) : u0 + approach * Math.min(1, t / tArrive);
      if (phase === 'ride') return path.upU(s);
      return null;
    },
    get canSkip() { return phase === 'ride' && tRide > 0.6; },
    get exit() { return alight ? alight.exit : null; },
    step(dt) {
      t += dt;
      if (phase === 'board' && t >= tArrive) { phase = 'ride'; tRide = 0; }
      else if (phase === 'ride') {
        tRide += dt;
        s = Math.min(s1, s + speed * dt);
        if (s >= s1 && tRide >= (skipped ? RIDE.minRide * 0.5 : 0)) beginAlight();
      } else if (phase === 'alight') {
        alight.t += dt;
        if (alight.t >= alight.total) phase = 'done';
      }
      return ride.done;
    },
    skip() { if (phase !== 'ride') return false; skipped = true; s = s1; return true; },
    /** Where the carrier and the rider are now: riderAt() + { onCarrier, walk (m walked: the gait), pose }. */
    where() { return place(); },
    /** A skier state for the figure (skier-model.js pose: ride = 'sit' | 'carry' | 'drag' | 'belt' | '' (on his skis)). */
    state(base) {
      const w = place();
      const moving = phase === 'ride' ? speed : 0;
      const st = { ...base, x: w.x, y: w.y, z: w.z, heading: w.heading, vx: Math.cos(w.heading) * moving, vz: Math.sin(w.heading) * moving, vy: 0, speed: k === 'drag' && phase === 'ride' ? speed : w.glide || 0,
        grounded: true, air: 0, crash: 0, tuck: 0, brake: 0, edge: 0, steer: 0, slip: 0, landed: 0, spin: 0, flip: 0, grab: 0, rail: -1, ride: w.pose, walk: w.walk || 0 };
      st.dragHand = k === 'drag' && w.onCarrier && w.hand ? w.hand : null;      // R8e: the hand on the rod (skier-model.js poseDrag)
      if (w.onCarrier) { st.rideLift = lift.index; st.rideS = s; st.rideKind = KIND_CODE[k]; }
      else { delete st.rideLift; delete st.rideS; delete st.rideKind; }
      return st;
    },
    /** The wire form (multiplayer): [kind code, lift index, s]. */
    wire: () => [KIND_CODE[k], lift.index, Math.round(s * 10) / 10],
  };
  function beginAlight() {
    phase = 'alight';
    const inCar = riderAt(path, s1, height, {});
    const off = site.off;
    const ex = (exitAt && exitAt()) || { x: off.x, z: off.z, heading: inCar.heading };
    const tOut = k === 'drag' || k === 'carpet' ? 0.5 : RIDE.getOut;
    // the way out: straight, or down the piste that starts at the station (exit.via)
    const way = [off, ...(ex.via || []), ex];
    const cum = [0];
    for (let n = 1; n < way.length; n++) cum.push(cum[n - 1] + Math.hypot(way[n].x - way[n - 1].x, way[n].z - way[n - 1].z));
    const d = cum[cum.length - 1];
    const tGo = Math.min(8, Math.max(0.6, d / (carry ? RIDE.walk * 1.4 : RIDE.out)));
    alight = { t: 0, inCar, off, exit: ex, tOut, tGo, way, cum, tClick: carry ? RIDE.clickIn : 0, total: tOut + tGo + RIDE.turn + (carry ? RIDE.clickIn : 0) };
  }
  function place() {
    const w = pose;
    w.onCarrier = false; w.walk = 0; w.glide = 0;
    if (phase === 'ride' || (phase === 'board' && t >= tArrive)) {
      riderAt(path, s, height, w);
      w.onCarrier = true; w.pose = POSE_OF[k];
      w.barDown = k === 'chair' && s - s0 > 9 && s1 - s > 12;
      return w;
    }
    if (phase === 'board') {
      // the carrier comes in; the rider steps out of his skis (cabins), walks / skates to the loading line, gets in as it arrives
      const cu = u0 + approach * Math.min(1, t / tArrive);
      const cb = cabin(t), c = path.shuttle ? path.shuttleAt(cb.s, 1, cb.up, {}) : path.loopAt(cu, {});
      w.cx = c.x; w.cz = c.z; w.cy = k === 'carpet' ? height(c.x, c.z) + 0.18 : c.y; w.heading = c.heading; w.pitch = k === 'train' ? Math.atan(path.slope(s0)) : 0;
      w.barDown = false;
      w.hip = undefined;
      const tm = t - tStep;
      if (tm <= 0) { setGround(w, start.x, start.z, start.heading); w.pose = carry ? 'carry' : ''; return w; }
      if (tm < tMove) {
        const kk = ease(tm / tMove);
        const hx = Math.atan2(load.z - start.z, load.x - start.x);
        setGround(w, lerp(start.x, load.x, kk), lerp(start.z, load.z, kk), moveD > 0.3 ? angLerp(start.heading, hx, Math.min(1, tm / 0.4)) : start.heading);
        w.pose = carry ? 'carry' : ''; w.walk = moveD * kk; w.glide = carry ? 0 : moveD / tMove;
        if (tm > tMove - 0.4) w.heading = angLerp(w.heading, load.heading, (tm - (tMove - 0.4)) / 0.4);
        return w;
      }
      // at the loading line (waiting, then getting in)
      const tin = t - (tArrive - tIn);
      setGround(w, load.x, load.z, load.heading);
      w.pose = carry ? 'carry' : k === 'drag' ? 'drag' : '';
      if (tin > 0) {
        const kk = ease(tin / tIn);
        if (k === 'drag') { const g = w.y; w.hip = lerp(w.cy - 1.4, g + 0.85, kk); }
        else if (k !== 'carpet') {
          const seat = seatAt0;
          w.x = lerp(load.x, seat.x, kk); w.z = lerp(load.z, seat.z, kk); w.y = lerp(w.y, seat.y, kk);
          if (kk > 0.5) w.pose = POSE_OF[k];
        } else w.y = lerp(w.y, w.cy, kk);
      }
      return w;
    }
    // alight: off the carrier onto the platform, out of the station to the exit, (cabins: skis down, click in)
    const a = alight;
    const ex = a.exit;
    w.cx = a.inCar.cx; w.cy = a.inCar.cy; w.cz = a.inCar.cz;
    if (phase === 'done') { setGround(w, ex.x, ex.z, ex.heading); w.pose = ''; return w; }
    if (a.t < a.tOut) {
      const kk = ease(a.t / a.tOut);
      const gy = height(a.off.x, a.off.z);
      w.x = lerp(a.inCar.x, a.off.x, kk); w.z = lerp(a.inCar.z, a.off.z, kk); w.y = lerp(a.inCar.y, gy, kk); w.heading = a.inCar.heading;
      w.pose = carry ? 'carry' : kk < 0.5 && k === 'chair' ? 'sit' : '';
      return w;
    }
    const tg = a.t - a.tOut;
    const total = a.cum[a.cum.length - 1];
    const last = a.way.length - 1;
    const hx = Math.atan2(ex.z - a.way[last - 1].z, ex.x - a.way[last - 1].x);
    if (tg < a.tGo) {
      const m = ease(tg / a.tGo) * total;
      let n = 1;
      while (n < last && a.cum[n] < m) n++;
      const A = a.way[n - 1], B = a.way[n], f = (m - a.cum[n - 1]) / ((a.cum[n] - a.cum[n - 1]) || 1);
      const hseg = Math.atan2(B.z - A.z, B.x - A.x);
      setGround(w, lerp(A.x, B.x, f), lerp(A.z, B.z, f), angLerp(a.inCar.heading, hseg, Math.min(1, tg / 0.5)));
      w.pose = carry ? 'carry' : ''; w.walk = m; w.glide = carry ? 0 : total / a.tGo;
      return w;
    }
    const tt = tg - a.tGo;
    setGround(w, ex.x, ex.z, angLerp(hx, ex.heading, ease(tt / RIDE.turn)));
    w.pose = carry && tt < RIDE.turn ? 'carry' : carry && tt < RIDE.turn + a.tClick * 0.35 ? 'skisdown' : carry && tt < RIDE.turn + a.tClick ? 'clickin' : '';
    return w;
  }
  function setGround(w, x, z, heading) { w.x = x; w.z = z; w.y = height(x, z); w.heading = heading; }
  return ride;
}

/** The ride cameras. mode 'chase' | 'window'; w = ride.where(); returns { x, y, z, tx, ty, tz, fov, inside? } (the caller smooths
 *  'chase'; `inside` = in a tunnel: never lifted over the ground). */
export function rideCamera(path, w, mode, ground) {
  const k = path.kind;
  const fx = Math.cos(w.heading), fz = Math.sin(w.heading), rx = -fz, rz = fx;
  const out = {};
  const tunnel = !!path.tunnel && w.onCarrier && ground(w.x, w.z) - w.y > 3;
  if (!w.onCarrier) {
    // boarding / getting off: behind him on the platform, a little to the outer side
    out.x = w.x - fx * 5.2 + rx * 1.8; out.z = w.z - fz * 5.2 + rz * 1.8; out.y = w.y + 2.3;
    out.tx = w.x + fx * 3; out.tz = w.z + fz * 3; out.ty = w.y + 1.0; out.fov = 60;
  } else if (mode === 'window') {
    // from the rider's eyes: a chair looks a little down (the safety bar and the chairs ahead); a cabin from just behind its front
    // window, eyes level with the glass (no ceiling band), skis on his shoulder; a drag lift up the track
    // R8c (QA: the cable car's window view was a blank panel over the lower third, the gondola's showed no cabin at all): standing in
    //     the cable car ~2 m behind the front glass (eyes 1.72 m: the parapet, the handrail, the mullions and the head band frame the
    //     view), sitting on the gondola's back bench; the view never looks down into the parapet (pitch floor)
    const half = k === 'gondola' ? (path.sub === 'funitel' ? 1.3 : 1.0) : k === 'cable' ? 3.5 : k === 'train' ? 6.25 : 0;
    const eye = k === 'chair' ? 1.02 : k === 'drag' || k === 'carpet' ? 1.62 : k === 'cable' ? 1.72 : k === 'gondola' ? 1.25 : 1.48;
    const ahead = k === 'chair' ? 0.08 : k === 'drag' ? 0.2 : k === 'carpet' ? 0.25 : k === 'train' ? half - 3.35 : k === 'cable' ? half - 2.0 : -0.5;
    out.x = w.x + fx * ahead; out.z = w.z + fz * ahead; out.y = w.y + eye;
    if (k === 'train' && Number.isFinite(w.cx)) {
      // R8c: from a seat in the carriage's front bay (the rider stands off its middle): the benches, the end wall and its window in view
      const a = half - 2.6, sl = path.slope(w.s || 0), up = sl / Math.sqrt(1 + sl * sl);
      out.x = w.cx + fx * a; out.z = w.cz + fz * a; out.y = w.cy + 0.55 + 1.3 + a * up;
    }
    const look = 40;
    const climb = k === 'drag' || k === 'train' || k === 'carpet' ? (ground(w.x + fx * 20, w.z + fz * 20) - ground(w.x, w.z)) / 20 : path.slope(w.s || 0);
    const pitch = k === 'chair' ? Math.atan(climb) - 0.5 : k === 'drag' || k === 'carpet' ? Math.atan(climb) * 0.7 - 0.1 : k === 'train' ? Math.atan(path.slope(w.s || 0)) - 0.04 : Math.max(-0.04, Math.atan(climb) * 0.45 - 0.12);
    out.tx = w.x + fx * look; out.tz = w.z + fz * look; out.ty = out.y + look * Math.tan(pitch);
    out.fov = k === 'chair' ? 80 : k === 'drag' || k === 'carpet' ? 74 : 68;
  } else if (tunnel) {
    // in the tunnel: behind the carriage, between the two tracks, under the vault
    out.x = w.x - fx * 9 - rx * path.side * 0.9; out.z = w.z - fz * 9 - rz * path.side * 0.9;
    out.y = w.y + 2.3 - Math.tan(Math.atan(path.slope(w.s || 0))) * 9;
    out.tx = w.x + fx * 6; out.tz = w.z + fz * 6; out.ty = w.y + 1.3 + Math.tan(Math.atan(path.slope(w.s || 0))) * 6; out.fov = 64;
    out.inside = true;
    return out;
  } else {
    const fun = path.sub === 'funitel';                                   // R8e: a funitel cabin is bigger: the camera farther out
    const back = k === 'cable' ? 13 : k === 'gondola' ? (fun ? 9 : 7.5) : k === 'train' ? 16 : k === 'drag' ? 5.5 : k === 'carpet' ? 5 : 5.2;
    const side = k === 'cable' ? 6 : k === 'gondola' ? (fun ? 4.8 : 3.6) : k === 'train' ? 5 : k === 'drag' ? 1.6 : k === 'carpet' ? 1.5 : 2.6;
    const up = k === 'cable' ? 2.5 : k === 'gondola' ? 1.9 : k === 'train' ? 4 : k === 'drag' ? 2.3 : k === 'carpet' ? 2.2 : 1.9;
    out.x = w.x - fx * back + rx * side; out.z = w.z - fz * back + rz * side;
    out.y = w.y + up + (k === 'chair' ? 0.4 : 0);
    out.tx = w.x + fx * 4; out.tz = w.z + fz * 4; out.ty = w.y + (k === 'chair' ? 0.5 : k === 'drag' ? 1 : 1.2);
    out.fov = 58;
    if (k === 'chair') {               // a chair from behind is only its backrest: beside it, a little ahead, looking back at the rider
      out.x = w.x + fx * 2.6 + rx * 3.3; out.z = w.z + fz * 2.6 + rz * 3.3; out.y = w.y + 1.1;
      out.tx = w.x - fx * 1.2; out.tz = w.z - fz * 1.2; out.ty = w.y + 0.2; out.fov = 60;
    }
  }
  if (tunnel) { out.inside = true; return out; }
  const g = ground(out.x, out.z) + 0.8;
  if (out.y < g) out.y = g;
  return out;
}
export { LIFT_SPEC, carrierBox };
