/* Real lift rides (round 6, pure: no THREE, no DOM; Node tests use the same code).
 * A ride follows one lift's real line (lift-path.js: the data's polyline, the rope over the pylon tops) from the boarding point just past
 * the bottom station to the exit just before the top one, at RIDE.factor times the real line speed (the real lines are long), and it can
 * be skipped. Where the rider is comes from the carrier:
 *   chair    seated on a chair under the rope (pose 'sit'), the safety bar down
 *   gondola  standing in a small cabin, cable  standing in the big cabin, train  standing in the carriage (pose 'stand', skis in the rack)
 *   drag     on the snow, pulled up the track by a T-bar (pose 'drag', skis on the snow)
 * The ride state that goes on the wire (multiplayer: a friend on the same lift sits in his own chair) is { lift index, s, kind }.
 * The camera: 'chase' = third person beside / behind the carrier, 'window' = from the rider's eyes along the line. */
import { LIFT_SPEC } from '../lift-path.js';

export const RIDE = Object.freeze({
  factor: 4,                 // x the real line speed
  boardRadius: 12,           // m from the bottom station: the boarding zone (round 7: in front of the hall, not anywhere near it)
  boardTime: 1.1,            // s: the rider skates into the station and steps into the carrier waiting there before it moves
  boardSpeed: 6,             // m/s: slower than this to board
  enter: { chair: 6, gondola: 5, cable: 7, drag: 3, train: 9 },       // m past the bottom wheel / buffer where the rider gets on
  exit: { chair: 7, gondola: 6, cable: 8, drag: 4, train: 10 },       // m before the top one where he gets off
  seat: { chair: -2.0, gondola: -4.05, cable: -6.05, drag: 0, train: 0.5 },   // the rider's feet / seat below the rope (train: above the rail)
  minRide: 1.5,              // s: even a skipped ride shows the carrier this long
});
export const POSE_OF = Object.freeze({ chair: 'sit', gondola: 'stand', cable: 'stand', train: 'stand', drag: 'drag' });
export const KIND_CODE = Object.freeze({ chair: 1, gondola: 2, cable: 3, drag: 4, train: 5 });
export const KIND_OF_CODE = Object.freeze(Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])));

/** Seconds a ride takes at the game's speed (path = lift-path.js createLiftPath). */
export function rideSeconds(path, factor = RIDE.factor) {
  const k = path.kind;
  // the same boarding / leaving stretch as createRide (clamped to 10 % of the line on very short lifts: the 60 m Leisee-Shuttle)
  const s0 = Math.min(RIDE.enter[k], path.len * 0.1), s1 = Math.max(s0 + 1, path.len - Math.min(RIDE.exit[k], path.len * 0.1));
  return Math.max(0, s1 - s0) / (path.spec.speed * factor);
}

/** The carrier and the rider at s along the line (up side): { cx, cy, cz (rope point / rail top), x, y, z (rider), heading, yaw, pitch }.
 *  height(x, z) is the snow (drag lifts and trains sit on it). */
export function riderAt(path, s, height, out = {}) {
  const q = path.at(s, {});
  const k = path.kind, side = path.spec.side;
  const fx = q.dx, fz = q.dz;                                        // along the line, uphill
  const rx = -fz, rz = fx;                                           // the up side's offset direction (lifts.js: x - dz * off)
  const cx = q.x + rx * side, cz = q.z + rz * side;
  const cy = k === 'drag' ? path.cableY(s) : k === 'train' ? (path.tunnels && path.tunnels.length ? path.cableY(s) : height(cx, cz) + 0.35) : path.cableY(s);   // round 7: a tunnel's rail is its grade
  out.cx = cx; out.cy = cy; out.cz = cz; out.s = s;
  out.heading = Math.atan2(fz, fx);
  out.pitch = k === 'train' ? Math.atan(path.slope(s)) : 0;
  if (k === 'drag') { out.x = q.x; out.z = q.z; out.y = height(q.x, q.z); }
  else if (k === 'chair') {
    const slot = Math.min(0.45, 0.25 * Math.max(1, (path.seats || 4) / 2 - 0.5));     // a seat left of the middle
    out.x = cx - fx * 0.05 - rx * slot; out.z = cz - fz * 0.05 - rz * slot; out.y = cy + RIDE.seat.chair;
  } else if (k === 'train') {
    out.x = cx + fx * 3; out.z = cz + fz * 3; out.y = cy + RIDE.seat.train + Math.tan(out.pitch) * 3;
  } else { out.x = cx + fx * 0.35; out.z = cz + fz * 0.35; out.y = cy + RIDE.seat[k]; }
  return out;
}

/** One ride. lift = the free ride lift (modes/freeride.js createLiftNet entry), path = its line. */
export function createRide({ lift, path, height, factor = RIDE.factor }) {
  const k = path.kind;
  const s0 = Math.min(RIDE.enter[k], path.len * 0.1), s1 = Math.max(s0 + 1, path.len - Math.min(RIDE.exit[k], path.len * 0.1));
  const speed = path.spec.speed * factor;
  let s = s0, t = 0, skipped = false;
  const pose = {};
  const ride = {
    lift, path, kind: k, pose: POSE_OF[k], speed,
    get s() { return s; }, get t() { return t; }, get done() { return s >= s1 && t >= (skipped ? RIDE.minRide * 0.5 : 0); },
    get share() { return (s - s0) / (s1 - s0); },
    /** Seconds left at the game's speed. */
    get left() { return Math.max(0, (s1 - s) / speed); },
    step(dt) { t += dt; s = Math.min(s1, s + speed * dt); return ride.done; },
    skip() { skipped = true; s = s1; },
    /** Where the carrier and the rider are now. */
    where() { return riderAt(path, s, height, pose); },
    /** A skier state for the figure (skier-model.js pose: ride = 'sit' | 'stand' | 'drag'). */
    state(base) {
      const w = riderAt(path, s, height, pose);
      return { ...base, x: w.x, y: w.y, z: w.z, heading: w.heading, vx: Math.cos(w.heading) * speed, vz: Math.sin(w.heading) * speed, vy: 0, speed: k === 'drag' ? speed : 0,
        grounded: true, air: 0, crash: 0, tuck: 0, brake: 0, edge: 0, steer: 0, slip: 0, landed: 0, spin: 0, flip: 0, grab: 0, rail: -1, ride: POSE_OF[k], rideLift: lift.index, rideS: s, rideKind: KIND_CODE[k] };
    },
    /** The wire form (multiplayer): [kind code, lift index, s]. */
    wire: () => [KIND_CODE[k], lift.index, Math.round(s * 10) / 10],
  };
  return ride;
}

/** The ride cameras. mode 'chase' | 'window'; w = riderAt(); returns { x, y, z, tx, ty, tz, fov } (the caller smooths 'chase'). */
export function rideCamera(path, w, mode, ground) {
  const k = path.kind;
  const fx = Math.cos(w.heading), fz = Math.sin(w.heading), rx = -fz, rz = fx;
  const out = {};
  if (mode === 'window') {
    // from the rider's eyes: a chair looks a little down (the safety bar and the chairs ahead), a cabin out of its front window (the
    // ceiling and the posts frame the view), a drag lift up the track
    // round 7: in a cabin the eyes stand nearer the front window and a little lower, the view climbs only a little with the rope: the
    // ceiling is a thin frame at the top, not a wide band
    const eye = k === 'chair' ? 1.02 : k === 'drag' ? 1.62 : 1.5;
    const ahead = k === 'chair' ? 0.08 : k === 'drag' ? 0.2 : k === 'train' ? -1 : k === 'cable' ? 1.5 : 0.5;
    out.x = w.x + fx * ahead; out.z = w.z + fz * ahead; out.y = w.y + eye;
    const look = 40;
    const tx = w.x + fx * look, tz = w.z + fz * look;
    const climb = k === 'drag' || k === 'train' ? (ground(w.x + fx * 20, w.z + fz * 20) - ground(w.x, w.z)) / 20 : path.slope(w.s || 0);
    const pitch = k === 'chair' ? Math.atan(climb) - 0.5 : k === 'drag' ? Math.atan(climb) * 0.7 - 0.1 : k === 'train' ? Math.atan(climb) * 0.6 - 0.05 : Math.atan(climb) * 0.3 - 0.07;
    out.tx = tx; out.tz = tz; out.ty = out.y + look * Math.tan(pitch);
    out.fov = k === 'chair' ? 80 : k === 'train' ? 74 : 70;
  } else {
    const back = k === 'cable' ? 13 : k === 'gondola' ? 7.5 : k === 'train' ? 16 : k === 'drag' ? 5.5 : 5.2;
    const side = k === 'cable' ? 6 : k === 'gondola' ? 3.6 : k === 'train' ? 5 : k === 'drag' ? 1.6 : 2.6;
    const up = k === 'cable' ? 2.5 : k === 'gondola' ? 1.9 : k === 'train' ? 4 : k === 'drag' ? 2.3 : 1.9;
    out.x = w.x - fx * back + rx * side; out.z = w.z - fz * back + rz * side;
    out.y = w.y + up + (k === 'chair' ? 0.4 : 0);
    out.tx = w.x + fx * 4; out.tz = w.z + fz * 4; out.ty = w.y + (k === 'chair' ? 0.5 : k === 'drag' ? 1 : 1.2);
    out.fov = 58;
    if (k === 'chair') {               // a chair from behind is only its backrest: beside it, a little ahead, looking back at the rider
      out.x = w.x + fx * 2.6 + rx * 3.3; out.z = w.z + fz * 2.6 + rz * 3.3; out.y = w.y + 1.1;
      out.tx = w.x - fx * 1.2; out.tz = w.z - fz * 1.2; out.ty = w.y + 0.2; out.fov = 60;
    }
  }
  // round 7: an underground funicular: the chase camera rides inside the tube, behind the carriage over the middle of the tunnel
  const tunnel = path.tunnels && path.tunnels.length;
  if (tunnel && mode !== 'window') {
    const sideIn = -path.spec.side;                                  // the carriage runs on the up side: back to the tunnel's middle
    out.x = w.x - fx * 11 + rx * sideIn; out.z = w.z - fz * 11 + rz * sideIn; out.y = w.y + 2.0 - Math.tan(w.pitch || 0) * 11;
    out.tx = w.x + fx * 8; out.tz = w.z + fz * 8; out.ty = w.y + 1.2 + Math.tan(w.pitch || 0) * 8; out.fov = 62;
  }
  if (tunnel && path.underground((w.s || 0) - 12, 6)) { out.inTunnel = true; return out; }     // under the mountain: no ground clamp
  const g = ground(out.x, out.z) + 0.8;
  if (out.y < g) out.y = g;
  return out;
}
export { LIFT_SPEC };
