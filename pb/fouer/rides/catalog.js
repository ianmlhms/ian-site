/* Schueberfouer Tycoon "Rides" wave: which attractions can be ridden and how a ride runs (DOM-free, THREE-free, tested by harness-rides.js).
 *
 *   kind   'wheel'  the Riserad (ride.js, W6)               'track'  coaster point of view along ud.ridePath (maus, looping, alpina)
 *          'seat'   the camera sits on an animated seat of the model (ud.rideSeat.frame): carousels, swings, towers, arms
 *          'flume'  Waasserbunn: the boat on its channel, the lift, the drop and the splash   'ghost'  Geeschterbunn: dark ride inside the castle
 *          'drive'  Autoscooter: you steer a bumper car (rides/bumper.js)
 *   clock  'speed'  the model clock runs at speedAt(p) x real time (spin-up, cruise, spin-down); 'map' the ride time is mapped on the model's own cycle
 *          (towers: pure functions of t), 'cycle' coasters / flume / ghost train: the model clock starts a few seconds before the train leaves the station
 * Every ride gives a one-time flag (a letter in the save's `ea`) and a stamp card. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** the save flags: g = starter gift, r = Riserad, p = Probefahrt (W6); every ride below gets its own letter */
export const RIDE_FLAGS = Object.freeze({
  wheel: "r", kanner: "k", gold: "o", kette: "e", scooter: "s", bayern: "b", happy: "h", break: "d", musik: "m", takeoff: "t",
  jules: "j", hangover: "v", booster: "x", infinity: "i", maus: "u", looping: "l", alpina: "a", splash: "w", geister: "c",
});

/** hangover: ride time -> model time (piecewise linear): a slow lift, a long pause at the top, then the free fall at the model's own speed */
const HANGOVER_MAP = Object.freeze([[0, 2], [3, 6], [18, 17], [22, 18], [22.6, 19.5], [30, 26.9]]);
const julesMap = rt => 5 + rt;
const boosterMap = rt => 4 + rt;
const infinityMap = rt => 3 + rt;
export function piecewise(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return points[points.length - 1][1];
}
const hangoverMap = rt => piecewise(HANGOVER_MAP, rt);

/** ride definitions. dur = real seconds; hi / lo = speed factor of the model clock at cruise / at the ends (clock 'speed');
 *  eye = where the player sits (documented in the model files); high = the ride goes up high (the crowd spreads over the whole fair, no tiles) */
export const RIDE_DEFS = Object.freeze({
  kanner:   { kind: "seat", clock: "speed", dur: 46, hi: 1.25, lo: 0.1, icon: "🎠", sound: "carousel", up: 0.14, down: 0.82, high: false },
  gold:     { kind: "seat", clock: "speed", dur: 46, hi: 1.2, lo: 0.1, icon: "🎠", sound: "carousel", up: 0.14, down: 0.82, high: false },
  kette:    { kind: "seat", clock: "speed", dur: 54, hi: 1.55, lo: 0.12, icon: "🎪", sound: "swing", up: 0.22, down: 0.8, high: false, assist: { pitch: 0.3, roll: 0.3 } },
  bayern:   { kind: "seat", clock: "speed", dur: 50, hi: 1.7, lo: 0.12, icon: "🏎️", sound: "curve", up: 0.2, down: 0.82, high: false },
  happy:    { kind: "seat", clock: "speed", dur: 50, hi: 1.5, lo: 0.1, icon: "⛵", sound: "boats", up: 0.16, down: 0.82, high: false },
  break:    { kind: "seat", clock: "speed", dur: 56, hi: 2.3, lo: 0.12, icon: "💫", sound: "dance", up: 0.22, down: 0.8, high: false },
  musik:    { kind: "seat", clock: "speed", dur: 54, hi: 1.9, lo: 0.12, icon: "🎶", sound: "dance", up: 0.2, down: 0.82, high: false },
  takeoff:  { kind: "seat", clock: "speed", dur: 54, hi: 1.55, lo: 0.12, icon: "🛫", sound: "dance", up: 0.22, down: 0.8, high: false },
  jules:    { kind: "seat", clock: "map", dur: 50, map: julesMap, icon: "🗼", sound: "tower", high: true, cycle: 60, assist: { pitch: 0.85, roll: 0.7, down: 0.22 } },
  hangover: { kind: "seat", clock: "map", dur: 30, map: hangoverMap, icon: "⬇️", sound: "drop", high: true, cycle: 38 },
  booster:  { kind: "seat", clock: "map", dur: 44, map: boosterMap, icon: "🚀", sound: "arm", high: true, cycle: 56 },
  infinity: { kind: "seat", clock: "map", dur: 46, map: infinityMap, icon: "♾️", sound: "arm", high: true, cycle: 52 },
  maus:     { kind: "track", clock: "cycle", icon: "🎢", sound: "coaster", high: true },
  looping:  { kind: "track", clock: "cycle", icon: "🎢", sound: "coaster", high: true },
  alpina:   { kind: "track", clock: "cycle", icon: "🎢", sound: "coaster", high: true },
  splash:   { kind: "flume", clock: "cycle", icon: "🌊", sound: "flume", high: true },
  geister:  { kind: "ghost", clock: "cycle", icon: "👻", sound: "ghost", high: false },
  scooter:  { kind: "drive", clock: "none", dur: 60, icon: "🚗", sound: "scooter", high: false },
  wheel:    { kind: "wheel", clock: "none", icon: "🎡", sound: "wheel", high: true },
});

export const RIDEABLE = Object.freeze(Object.keys(RIDE_DEFS));
export const defOf = id => RIDE_DEFS[id] ?? null;
export const isRideable = id => Boolean(RIDE_DEFS[id]);
export const flagOf = id => RIDE_FLAGS[id] ?? null;

/** model-clock speed factor over the ride progress p (0..1): smooth spin-up to `hi`, cruise, smooth spin-down to `lo`. `reduce` = the reduce-motion option (slower spin) */
export function speedAt(def, p, reduce = false) {
  const up = smooth(p / def.up), down = smooth((1 - p) / (1 - def.down));
  const k = Math.min(up, down);
  const hi = reduce ? 1 + (def.hi - 1) * 0.45 : def.hi;
  return def.lo + (hi - def.lo) * k;
}

/** the ride program: advance with step(dt); `ct` is the model clock to feed into userData.animate, `dtScaled` the matching delta.
 *  Clock 'map' rides (towers) follow the model's own cycle; with `reduce` they run at 80 % (the ride lasts 25 % longer). `mt` is the position on the map (ride time at 100 %). */
export function createProgram(def, { reduce = false, start = 0 } = {}) {
  const k = def.clock === "map" && reduce ? 0.8 : 1;
  const dur = def.dur / k;
  const st = { rt: 0, ct: def.clock === "map" ? def.map(0) : start, dtScaled: 0, speed: def.lo ?? 1 };
  const api = {
    get rt() { return st.rt; },
    get mt() { return st.rt * k; },
    get ct() { return st.ct; },
    get dtScaled() { return st.dtScaled; },
    get speed() { return st.speed; },
    get dur() { return dur; },
    get p() { return clamp(st.rt / dur, 0, 1); },
    get done() { return st.rt >= dur; },
    step(dt) {
      st.rt += dt;
      const prev = st.ct;
      if (def.clock === "map") { st.ct = def.map(Math.min(st.rt * k, def.dur)); st.speed = dt > 0 ? (st.ct - prev) / dt : st.speed; }
      else { st.speed = speedAt(def, api.p, reduce); st.ct += dt * st.speed; }
      st.dtScaled = st.ct - prev;
      return api;
    },
  };
  return api;
}

/** the ride time at which the model clock reaches `ct` (bisection on the monotone map; clock 'map' rides) */
export function rideTimeAtClock(def, ct) {
  let lo = 0, hi = def.dur;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (def.map(mid) < ct) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** The swing angle (rad) of the Kettenkarussell chairs at model-clock speed s: atan(w^2 r / g) with r = 5 m, capped like the real ride (about 45 degrees) */
export function swingAngle(speed, radius = 5) { return Math.min(0.8, Math.atan((speed * speed * radius) / 9.81)); }
/** the rotor tilt of the Kettenkarussell (rad) for the same speed */
export function rotorTilt(speed) { return 0.11 * clamp((speed - 0.3) / 1.2, 0, 1); }

/** the crowd of tall rides: the whole fair is the show */
export const isHigh = id => Boolean(RIDE_DEFS[id]?.high);
export { clamp as clampRide, smooth as smoothRide };
