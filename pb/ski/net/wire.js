/* The wire format of one skier state (pure: Node tests import it; remotes.js re-exports it). 16 numbers, and since round 6 three more
 * while the player rides a lift ("riding lift X at s": the kind code of modes/liftride.js KIND_CODE, the lift's index in resort.json
 * lifts, metres along its line), so a friend on the same lift is drawn in his own chair / cabin. An old client sends 16 (never riding).
 * 28 Nov 2026: flag 8 = he rides a snowboard (an old client ignores the bit and draws skis; an old sender never sets it). */
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
/** any finite angle into [-pi, pi) in constant time (security: a while-loop on 1e300 never ends; % is exact even for huge values) */
export const wrapAngle = (a) => { const r = a % TAU; return r >= Math.PI ? r - TAU : r < -Math.PI ? r + TAU : r; };
export const RIDE_FLAG = 4;
export const BOARD_FLAG = 8;
const MAX_FIELDS = 19;
const POSE_OF_CODE = { 1: 'sit', 2: 'carry', 3: 'carry', 4: 'drag', 5: 'carry', 6: 'belt' };      // R7-B: skis on the shoulder in cabins; 6 = carpet
// ride down: the kind code + 10 (liftride.js DOWN_CODE; drag lifts / carpets never go down)
POSE_OF_CODE[11] = 'sit'; POSE_OF_CODE[12] = 'carry'; POSE_OF_CODE[13] = 'carry'; POSE_OF_CODE[15] = 'carry';

export function packState(st, progress, finished, board = false) {
  const riding = !!st.ride && Number.isInteger(st.rideLift);
  const flags = (st.grounded ? 1 : 0) | (finished ? 2 : 0) | (riding ? RIDE_FLAG : 0) | (board ? BOARD_FLAG : 0);
  const a = [r2(st.x), r2(st.y), r2(st.z), r3(st.heading), r2(st.speed), r3(st.edge), r2(st.tuck), r2(st.brake), flags, r2(st.air || 0), r2(st.crash || 0), r2(st.landed || 0), Math.round(progress || 0), r2(st.vx || 0), r2(st.vz || 0), r2(st.vy || 0)];
  if (riding) a.push(st.rideKind | 0, st.rideLift | 0, Math.round((st.rideS || 0) * 10) / 10);
  return a;
}
export function unpackState(a) {
  if (!Array.isArray(a) || a.length < 16) return null;
  const v = a.slice(0, MAX_FIELDS).map((x) => (typeof x === 'number' ? x : NaN));      // security: never more than 19, numbers only
  if (!v.slice(0, 4).every(Number.isFinite) || Math.abs(v[0]) > 1e5 || Math.abs(v[2]) > 1e5) return null;
  const st = {
    x: v[0], y: clamp(num(v[1]), -500, 9000), z: v[2], heading: wrapAngle(v[3]), speed: Math.min(60, Math.abs(num(v[4]))), edge: Math.max(-1.5, Math.min(1.5, num(v[5]))),
    tuck: Math.max(0, Math.min(1, num(v[6]))), brake: Math.max(0, Math.min(1, num(v[7]))), grounded: (v[8] & 1) === 1, finished: (v[8] & 2) === 2,
    air: clamp(num(v[9]), 0, 30), crash: Math.max(0, Math.min(3, num(v[10]))), landed: Math.max(0, Math.min(1, num(v[11]))), progress: clamp(num(v[12]), 0, 1e5),
    vx: Math.max(-60, Math.min(60, num(v[13]))), vz: Math.max(-60, Math.min(60, num(v[14]))), vy: Math.max(-60, Math.min(60, num(v[15]))),
    board: (v[8] & BOARD_FLAG) === BOARD_FLAG,
  };
  if ((v[8] & RIDE_FLAG) && v.length >= 19 && POSE_OF_CODE[v[16]] && Number.isInteger(v[17]) && v[17] >= 0 && v[17] < 4096 && Number.isFinite(v[18])) {
    st.ride = POSE_OF_CODE[v[16]]; st.rideKind = v[16]; st.rideLift = v[17]; st.rideS = Math.max(0, Math.min(1e5, v[18]));
  }
  return st;
}

/** When the next state goes out (cleanup round, 23 Nov: the free ride sent 7-8 states / s instead of 15 under load). The schedule runs
 *  on the wall clock, not the frame clock: a send is due once `1000 / hz` ms have passed since the SLOT the last one was due at, so a
 *  frame that comes a little late (30 fps: frames 30-36 ms apart) does not push every later send back by a frame. The old
 *  `now - lastSend >= period` sent only every 3rd frame whenever two frames came < 64.7 ms apart (30 fps under load: 8-10 / s).
 *  Now the rate is `hz` at any frame rate above it (and every frame below it: no new state exists between two frames). A clock that
 *  fell behind (a pause, a long frame) catches up by at most half a slot, never with a burst.
 *  at = the slot of the last send (ms, 0 = never sent). Returns the new slot when a state should go out now, else null. Pure. */
export const SEND_SLACK_MS = 2;
export function sendSlot(at, now, hz) {
  const period = 1000 / hz;
  if (now - at < period - SEND_SLACK_MS) return null;
  return Math.max(at + period, now - period / 2);
}
