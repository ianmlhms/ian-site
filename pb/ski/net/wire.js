/* The wire format of one skier state (pure: Node tests import it; remotes.js re-exports it). 16 numbers, and since round 6 three more
 * while the player rides a lift ("riding lift X at s": the kind code of modes/liftride.js KIND_CODE, the lift's index in resort.json
 * lifts, metres along its line), so a friend on the same lift is drawn in his own chair / cabin. An old client sends 16 (never riding). */
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
export const RIDE_FLAG = 4;
const POSE_OF_CODE = { 1: 'sit', 2: 'carry', 3: 'carry', 4: 'drag', 5: 'carry', 6: 'belt' };      // R7-B: skis on the shoulder in cabins; 6 = carpet

export function packState(st, progress, finished) {
  const riding = !!st.ride && Number.isInteger(st.rideLift);
  const flags = (st.grounded ? 1 : 0) | (finished ? 2 : 0) | (riding ? RIDE_FLAG : 0);
  const a = [r2(st.x), r2(st.y), r2(st.z), r3(st.heading), r2(st.speed), r3(st.edge), r2(st.tuck), r2(st.brake), flags, r2(st.air || 0), r2(st.crash || 0), r2(st.landed || 0), Math.round(progress || 0), r2(st.vx || 0), r2(st.vz || 0), r2(st.vy || 0)];
  if (riding) a.push(st.rideKind | 0, st.rideLift | 0, Math.round((st.rideS || 0) * 10) / 10);
  return a;
}
export function unpackState(a) {
  if (!Array.isArray(a) || a.length < 16) return null;
  const v = a.map((x) => Number(x));
  if (!v.slice(0, 4).every(Number.isFinite) || Math.abs(v[0]) > 1e5 || Math.abs(v[2]) > 1e5) return null;
  const st = {
    x: v[0], y: num(v[1]), z: v[2], heading: v[3], speed: Math.min(60, Math.abs(num(v[4]))), edge: Math.max(-1.5, Math.min(1.5, num(v[5]))),
    tuck: Math.max(0, Math.min(1, num(v[6]))), brake: Math.max(0, Math.min(1, num(v[7]))), grounded: (v[8] & 1) === 1, finished: (v[8] & 2) === 2,
    air: Math.max(0, num(v[9])), crash: Math.max(0, Math.min(3, num(v[10]))), landed: Math.max(0, Math.min(1, num(v[11]))), progress: Math.max(0, num(v[12])),
    vx: Math.max(-60, Math.min(60, num(v[13]))), vz: Math.max(-60, Math.min(60, num(v[14]))), vy: Math.max(-60, Math.min(60, num(v[15]))),
  };
  if ((v[8] & RIDE_FLAG) && v.length >= 19 && POSE_OF_CODE[v[16]] && Number.isInteger(v[17]) && v[17] >= 0 && v[17] < 4096 && Number.isFinite(v[18])) {
    st.ride = POSE_OF_CODE[v[16]]; st.rideKind = v[16]; st.rideLift = v[17]; st.rideS = Math.max(0, Math.min(1e5, v[18]));
  }
  return st;
}
