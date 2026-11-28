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
import { BOARD, UNLOAD, stationCrawl } from '../lift-site.js';

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
/** After launch: chair boarding (liftride.js chairPlan): s the gate takes to open, m/s skating through it and on the belt, m he stands
 *  ahead of the seat, s standing at the line, s sitting down, the chair's crawl (m/s) for the last slowFor s before him (+ a ramp),
 *  s to speed up to the ride speed after. */
export const CHAIR = Object.freeze({ open: 0.45, glide: 1.9, belt: 1.4, ahead: 0.3, stand: 0.45, sit: 0.5, vsDetach: 2.0, vsFixed: 2.6, slowFor: 1.6, ramp: 1.0, accel: 1.6 });
/** Lift lines round (26 Nov 2026; Ian: "rework the climbing in"): the boarding / getting-off moments. A cabin (gondola, funitel, cable
 *  car) docks at the loading point with its doors opening, he walks in through them (walkIn s), they close (close s, after gap s), it
 *  pulls away over CABIN.accel s; at the top it slows into the station over CABIN.accel s, stops, the doors open, he walks out (out s),
 *  they close behind him. A T-bar / platter: he glances back at the bar coming, takes it, it pulls him up to speed over PULL s. A chair:
 *  the bar swings down BAR s after leaving the station and up again BAR s before the top. */
export const CABIN = Object.freeze({ open: 0.8, close: 0.6, gap: 0.15, walkIn: 0.85, out: 0.9, accel: 1.6 });
const PULL = 0.8, BAR = Object.freeze({ downAfter: 0.9, upBefore: 1.6, swing: 0.9 });
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
/** Ride down on the wire: the kind code + DOWN_CODE (11 chair, 12 gondola, 13 cable car, 15 train; an old client ignores them). */
export const DOWN_CODE = 10;
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
/** Lift fixes (28 Nov 2026): the speed of the player's carrier `tRide` s into the ride at `s` m along the line. A gondola cabin / a
 *  detachable chair crawls through its stations like the lift's other carriers (lift-site.js stationCrawl: the same curve of the share of
 *  the line speed by the distance to the nearer end, so no hall is crossed at line speed), a loop cabin brakes gently to stand at the top.
 *  env = { k, path, speed, s1, crawl, cab (a cabin that docks), vs (a chair's crawl at the loading line) }. */
const STOP_DECEL = 4;                  // m/s^2: a cabin that crawls through the hall brakes to a stop at the unloading point
export function rideSpeedAt(env, tRide, s) {
  const { k, path, speed, s1, crawl, cab, vs } = env;
  let v = vs ? vs + (speed - vs) * ease(tRide / CHAIR.accel) : speed;
  if (cab && k !== 'train') {
    // (a jig-back cable car keeps its old arrival: slowed, its roof clips the top terminal's roof edge at Cime Caron (3V, round7b))
    const dLeft = Math.max(0, s1 - s), dStop = crawl ? (speed * crawl.vs) ** 2 / (2 * STOP_DECEL) : 0;      // (crawling: the stop only starts from the crawl speed)
    const brake = path.shuttle || dLeft > dStop && crawl ? speed : Math.max(0.9, Math.sqrt(2 * (crawl ? STOP_DECEL : speed / CABIN.accel) * dLeft));
    v = Math.min(speed * Math.max(0.03, ease(tRide / CABIN.accel)), brake);
  } else if (k === 'drag' && path.sub !== 'rope') v = speed * Math.max(0.03, ease(tRide / PULL));
  if (crawl) v = Math.min(v, speed * crawl.k(Math.min(s, path.len - s)));
  return v;
}
/** Seconds a ride on the carrier takes at the game's speed (path = lift-path.js createLiftPath; site: the station slow-down of a
 *  gondola / detachable chair counts, else the analytic time). */
export function rideSeconds(path, factor = RIDE.factor, site = null) {
  const [s0, s1] = rideSpan(path);
  const D = Math.max(0, s1 - s0), v = path.spec.speed * factor;
  const crawl = site ? stationCrawl(site) : null;
  if (crawl) {
    const env = { k: path.kind, path, speed: v, s1, crawl, cab: path.kind !== 'chair', vs: path.kind === 'chair' ? ((path.seats || 4) >= 4 ? CHAIR.vsDetach : CHAIR.vsFixed) : 0 };
    let s = s0, t = 0;
    for (; s < s1 && t < 3600; t += 1 / 60) s = Math.min(s1, s + rideSpeedAt(env, t + 1 / 60, s) / 60);
    return t;
  }
  if (path.kind !== 'chair') {
    // lift lines round: a cabin pulls away and stops over CABIN.accel s each, a drag bar pulls him up to speed over PULL s
    const T = (CARRY.has(path.kind) && path.kind !== 'train' ? CABIN.accel * (path.shuttle ? 1 : 2) : 0) + (path.kind === 'drag' && path.sub !== 'rope' ? PULL : 0);
    return D >= v * T / 2 ? D / v + T / 2 : D / v;
  }
  // after launch: a chair speeds up from the station crawl over CHAIR.accel s (liftride step): A (v + vs) / 2 m in that time
  const A = CHAIR.accel, vs = (path.seats || 4) >= 4 ? CHAIR.vsDetach : CHAIR.vsFixed, dA = A * (v + vs) / 2;
  return D >= dA ? A + (D - dA) / v : D / v;
}

/** Lift lines round: a cabin's boarding timeline (createRide and createDescent): the rider walks to the door spot beside the cabin, the
 *  cabin docks (a loop cabin slows over the last `tail` s) with its doors opening, he walks in, they close. The plan: { tDock, tEnter,
 *  tArrive, door, cam, u(t), doorK(t), rider(t, w) }. */
export function cabinBoarding({ path, k, door, start, tStep, approach, uLoad, seat, height, shuttleWait, tail = 1.2 }) {
  const setGround = (w, x, z, heading) => { w.x = x; w.z = z; w.y = height(x, z); w.heading = heading; };
  const doored = DOORED.has(k);
  const dMove = Math.hypot(door.x - start.x, door.z - start.z);
  const tAtDoor = tStep + Math.max(0.8, dMove / RIDE.walk);
  let tDock;
  if (path.shuttle) tDock = shuttleWait;
  else tDock = Math.max(Math.min(approach / path.spec.speed, tAtDoor + RIDE.wait), tAtDoor - CABIN.open * 0.7, 0.4);
  const tEnter = Math.max(tDock + (doored ? CABIN.open * 0.75 : 0.2), tAtDoor);
  const tClose = tEnter + CABIN.walkIn + CABIN.gap;
  const tArr = tClose + (doored ? CABIN.close : 0) + 0.1;
  // the loop cabin's way in: D(x) m still to go x s before it docks (line speed, then slowing over the last 1.2 s)
  const T = tDock, vv = T > tail ? approach / (T - tail / 2) : 0;
  const D = (x) => (x <= 0 ? 0 : T <= tail ? approach * (x / T) * (x / T) : x <= tail ? vv * x * x / (2 * tail) : vv * (x - tail / 2));
  return {
    tDock, tEnter, tArrive: tArr, door, cam: door.cam,
    u: (tt) => uLoad - D(tDock - tt),
    doorK(tt) {
      if (!doored) return 0;
      const open = path.shuttle ? ease((tt - tDock) / CABIN.open) : ease(1 - (tDock - tt) / CABIN.open);
      return Math.min(open, 1 - ease((tt - tClose) / CABIN.close));
    },
    rider(tt, w) {
      w.doorK = this.doorK(tt); w.doorCam = door.cam;
      if (tt < tStep) { setGround(w, start.x, start.z, start.heading); w.pose = 'carry'; return; }
      if (tt < tAtDoor) {
        const kk = ease((tt - tStep) / (tAtDoor - tStep)), hx = Math.atan2(door.z - start.z, door.x - start.x);
        setGround(w, lerp(start.x, door.x, kk), lerp(start.z, door.z, kk), dMove > 0.3 ? angLerp(start.heading, hx, Math.min(1, (tt - tStep) / 0.4)) : start.heading);
        if (tt > tAtDoor - 0.45) w.heading = angLerp(w.heading, door.heading, (tt - (tAtDoor - 0.45)) / 0.45);
        w.pose = 'carry'; w.walk = dMove * kk;
        return;
      }
      if (tt < tEnter) { setGround(w, door.x, door.z, door.heading); w.pose = 'carry'; return; }
      // in through the door (onto the cabin's floor), turning to face the way it will go
      const kk = ease((tt - tEnter) / CABIN.walkIn), g = height(door.x, door.z);
      w.x = lerp(door.x, seat.x, kk); w.z = lerp(door.z, seat.z, kk); w.y = lerp(g, seat.y, Math.min(1, kk * 1.6));
      w.heading = angLerp(door.heading, seat.heading, kk); w.pose = 'carry'; w.walk = dMove + kk * 1.6;
    },
  };
}

/** The carrier and the rider at s along the line (up lane): { cx, cy, cz (rope grip / rail top / belt), x, y, z (rider), heading, pitch,
 *  hip (drag: where the bar holds him) }. height(x, z) is the snow (drag lifts, belts and trains sit on it). */
export function riderAt(path, s, height, out = {}, down = false) {
  const k = path.kind;
  // (ride down: the carrier on the down lane / the -1 track going down, heading down the line)
  const c = down ? (path.shuttle ? path.shuttleAt(s, -1, false, {}) : path.loopAt(path.downU(s), {})) : path.shuttle ? path.shuttleAt(s, 1, true, {}) : path.loopAt(path.upU(s), {});
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
    const f = down ? path.shuttleAt(Math.max(0, s - 3), -1, false, {}) : path.shuttleAt(Math.min(path.len, s + 3), 1, true, {});      // 3 m ahead in the carriage, on the line (smooth in the curves)
    out.x = f.x; out.z = f.z; out.y = f.y + RIDE.seat.train;
  } else { out.x = c.x + fx * 0.35; out.z = c.z + fz * 0.35; out.y = c.y + (path.sub === 'funitel' ? FUNITEL_SEAT : RIDE.seat[k]); }
  return out;
}

/** Lift lines round: the kinds with doors (the player's cabin: carriers.js createCarrier doorSide), the walk points round them. */
const DOORED = new Set(['gondola', 'cable']);
/** The spot on the platform beside a cabin's door (station frame f, a along the line from the end; side +1 = the up lane's outer side,
 *  -1 = the return side): { x, z, heading (facing the cabin), cam (a camera spot outside, looking at the door) }. */
function doorSpotOf(path, f, a, side) {
  const hw = path.carrier.hw, b = side > 0 ? path.side + hw + 0.45 : -path.back - hw - 0.45;
  const w = f.toWorld(a, b, {});
  const big = path.kind === 'cable' || path.kind === 'train';
  const c = f.toWorld(a + (big ? 5.5 : 3.2), b + side * (big ? 5.2 : 3.4), {});
  return { x: w.x, z: w.z, heading: Math.atan2(-f.rz * side, -f.rx * side), cam: { x: c.x, z: c.z, tx: w.x - f.rx * side * (hw + 0.45), tz: w.z - f.rz * side * (hw + 0.45), up: big ? 2.6 : 2.0 } };
}
/** Along inCar -> door -> off by the share k (half each). */
function along3(w, A, B, C, k) {
  if (k < 0.5) { const f = k * 2; w.x = lerp(A.x, B.x, f); w.z = lerp(A.z, B.z, f); } else { const f = (k - 0.5) * 2; w.x = lerp(B.x, C.x, f); w.z = lerp(B.z, C.z, f); }
}
/** A drag rider's hand on the rod (the rod from the spring box at (cx, cy - 0.65, cz) down to his hips), 0.55 m up from the T. */
function rodHand(w, cx, cy, cz, hip) {
  const bx = w.x + Math.cos(w.heading) * 0.04, bz = w.z + Math.sin(w.heading) * 0.04, ty = cy - 0.65, dx = cx - bx, dy = ty - hip, dz = cz - bz, L = Math.hypot(dx, dy, dz) || 1;
  return { x: bx + dx / L * 0.55, y: hip + dy / L * 0.55, z: bz + dz / L * 0.55 };
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
  const doorSpot = (f, a, side) => doorSpotOf(path, f, a, side);
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
  let approach = uLoad - u0;
  let tArrive = path.shuttle ? Math.max(tNeed, shuttle ? shuttle.wait + tIn : 0) : Math.max(tNeed, Math.min(approach / path.spec.speed, tNeed + RIDE.wait));
  const cabin = (tt) => (path.shuttle && shuttle ? shuttle.at(tt) : { s: s0, up: true });       // the jig-back cabin while he boards
  // lift lines round: a cabin (gondola, funitel, cable car; trains as before but through the same timeline): he walks to the door spot on
  // the platform (beside the cabin, not in its lane), the cabin docks there with its doors opening, he walks in, they close, it goes
  const crawl0 = stationCrawl(site);                  // lift fixes: a gondola / detachable chair crawls through its stations (see rideSpeedAt)
  const cab = DOORED.has(k) || k === 'train' ? cabinPlan() : null;
  if (cab) tArrive = cab.tArrive;
  // After launch (Ian, 3V Tovets: "through the barrier, scooped abruptly"): a chair is boarded like a real one: he waits behind the
  // closed gate, it opens in time for his chair, he skates through into the lane (detachable: onto the loading belt, which carries
  // him to the loading line), stands, his chair comes up slowly behind him and he sits down; then it speeds up out of the station
  const CP = k === 'chair' && site.chair ? chairPlan() : null;
  if (CP) { u0 = CP.u0; approach = CP.approach; tArrive = CP.tArrive; }
  let phase = 'board', t = 0, s = sLoad, skipped = false, tRide = 0, alight = null, vNow = 0;
  const pose = { roll: 0 };
  // lift fixes: his carrier crawls through the stations like the lift's others (see rideSpeedAt)
  const speedEnv = { k, path, speed, s1, crawl: crawl0, cab: !!cab, vs: CP ? CP.vs : 0 };
  /** Seconds still to go on the carrier from s (the speed law integrated by position; the start-up of the carrier is not in it). */
  const leftFrom = (s0n) => {
    if (!speedEnv.crawl) return Math.max(0, (s1 - s0n) / speed);
    const ds = Math.max(2, (s1 - s0n) / 400);
    let tt = 0;
    for (let x = s0n; x < s1; x += ds) tt += Math.min(ds, s1 - x) / Math.max(0.5, rideSpeedAt(speedEnv, 1e3, x));
    return tt;
  };
  const ride = {
    lift, path, site, kind: k, pose: POSE_OF[k], speed, carry,
    get phase() { return phase; },
    get s() { return s; }, get t() { return t; },
    get done() { return phase === 'done'; },
    get share() { return phase === 'board' ? 0 : phase === 'ride' ? (s - s0) / (s1 - s0) : 1; },
    /** Seconds left on the carrier at the game's speed. */
    get left() { return phase === 'ride' ? leftFrom(s) : phase === 'board' ? rideSeconds(path, factor, site) : 0; },
    /** The loop parameter of the rider's own carrier while it holds him (lifts.js setRide), else null (the lift's own loop has it). */
    get carrierU() {
      if (phase === 'board') return path.shuttle ? path.upU(cabin(t).s) : boardU(t);
      if (phase === 'ride') return path.upU(s);
      if (phase === 'alight' && alight && alight.t < alight.tHold) return path.upU(s1);           // (a cabin stays docked while he gets out)
      return null;
    },
    get canSkip() { return phase === 'ride' && tRide > 0.6; },
    /** After launch: a chair's boarding gate, 0 closed .. 1 open (lifts.js setGate), and the plan (tests). */
    get gate() { return CP && phase === 'board' ? CP.gate(t) : 0; },
    get chairPlan() { return CP; },
    /** Lift lines round (tests): the cabin plan { tDock, tEnter, tArrive, door } or null. */
    get cabinPlan() { return cab; },
    get exit() { return alight ? alight.exit : null; },
    step(dt) {
      t += dt;
      if (phase === 'board' && t >= tArrive) { phase = 'ride'; tRide = 0; }
      else if (phase === 'ride') {
        tRide += dt;
        // after launch: a chair leaves the loading line at the station's crawl and speeds up to the ride speed over CHAIR.accel s;
        // lift lines round: a cabin pulls away (and slows into the top station), a drag bar pulls him up to speed
        const v = rideSpeedAt(speedEnv, tRide, s);
        vNow = v;
        s = Math.min(s1, s + v * dt);
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
      const moving = phase === 'ride' ? Math.max(vNow, 0.1) : 0;
      const st = { ...base, x: w.x, y: w.y, z: w.z, heading: w.heading, vx: Math.cos(w.heading) * moving, vz: Math.sin(w.heading) * moving, vy: 0, speed: k === 'drag' && phase === 'ride' ? speed : w.glide || 0,
        grounded: true, air: 0, crash: 0, tuck: 0, brake: 0, edge: 0, steer: 0, slip: 0, landed: 0, spin: 0, flip: 0, grab: 0, rail: -1, ride: w.pose, walk: w.walk || 0 };
      st.dragHand = k === 'drag' && (w.onCarrier || w.grab) && w.hand ? w.hand : null;      // R8e: the hand on the rod (skier-model.js poseDrag)
      if (w.onCarrier) { st.rideLift = lift.index; st.rideS = s; st.rideKind = KIND_CODE[k]; }
      else { delete st.rideLift; delete st.rideS; delete st.rideKind; }
      return st;
    },
    /** The wire form (multiplayer): [kind code, lift index, s]. */
    wire: () => [KIND_CODE[k], lift.index, Math.round(s * 10) / 10],
    down: false,
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
    // lift lines round: a cabin: the doors open first (tDoor), he walks out through them (tOut), they close behind him (held till tHold)
    const doored = DOORED.has(k), tDoor = doored ? CABIN.open : 0, tOut2 = doored ? CABIN.out : tOut;
    const door = doored ? doorSpot(site.top, -Math.min(UNLOAD[site.key], path.len * 0.2), 1) : null;
    alight = { t: 0, inCar, off, exit: ex, tOut: tDoor + tOut2, tDoor, door, tHold: doored ? tDoor + tOut2 + 0.1 + CABIN.close : 0, tGo, way, cum, tClick: carry ? RIDE.clickIn : 0, total: tDoor + tOut2 + tGo + RIDE.turn + (carry ? RIDE.clickIn : 0) };
  }
  /** Lift lines round: a chair's bar, 1 up .. 0 down: down BAR.downAfter s after leaving, up BAR.upBefore s before the top. */
  function barK() {
    if (k !== 'chair' || phase !== 'ride') return 1;
    const down = ease((tRide - BAR.downAfter) / BAR.swing), up = ease((BAR.upBefore - (s1 - s) / speed) / BAR.swing);
    return Math.max(1 - down, up);
  }
  function place() {
    const w = pose;
    w.onCarrier = false; w.walk = 0; w.glide = 0; w.boardCam = null; w.doorCam = null; w.doorK = 0; w.grab = false; w.barK = 1;
    if (phase === 'ride' || (phase === 'board' && t >= tArrive)) {
      riderAt(path, s, height, w);
      w.onCarrier = true; w.pose = POSE_OF[k];
      w.barK = barK(); w.barDown = w.barK < 0.5;
      if (cab && phase === 'ride' && tRide < 1.2) w.doorCam = cab.cam;                  // (the camera eases out of the door view)
      return w;
    }
    if (phase === 'board' && CP) {
      const c = path.loopAt(boardU(t), {});
      w.cx = c.x; w.cz = c.z; w.cy = c.y; w.heading = c.heading; w.pitch = 0; w.barDown = false; w.hip = undefined;
      CP.rider(t, w);
      return w;
    }
    if (phase === 'board') {
      // the carrier comes in; the rider steps out of his skis (cabins), walks / skates to the loading line, gets in as it arrives
      const cu = boardU(t);
      const cb = cabin(t), c = path.shuttle ? path.shuttleAt(cb.s, 1, cb.up, {}) : path.loopAt(cu, {});
      w.cx = c.x; w.cz = c.z; w.cy = k === 'carpet' ? height(c.x, c.z) + 0.18 : c.y; w.heading = c.heading; w.pitch = k === 'train' ? Math.atan(path.slope(s0)) : 0;
      w.barDown = false;
      w.hip = undefined;
      if (cab) { cab.rider(t, w); return w; }
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
      w.pose = carry ? 'carry' : '';
      // lift lines round: a T-bar / platter: he glances back at the bar coming (a turn of the body), takes it as it reaches him
      if (k === 'drag' && path.sub !== 'rope') { const look = ease((t - (tArrive - tIn - 1.1)) / 0.6) * (1 - ease(tin / (tIn * 0.6))); w.heading = load.heading - 0.55 * path.sign * look; }
      if (tin > 0) {
        const kk = ease(tin / tIn);
        if (k === 'drag') {
          const g = w.y; w.hip = lerp(w.cy - 1.4, g + 0.85, kk);
          if (path.sub !== 'rope' && kk > 0.3) { w.pose = 'drag'; w.grab = true; w.hand = rodHand(w, w.cx, w.cy, w.cz, w.hip); }
        }
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
    w.cx = a.inCar.cx; w.cy = a.inCar.cy; w.cz = a.inCar.cz; w.heading = a.inCar.heading;
    if (a.door) {
      // lift lines round: the doors open, he walks out through them, they close behind him
      w.doorK = a.t < a.tDoor ? ease(a.t / a.tDoor) : 1 - ease((a.t - a.tOut - 0.1) / CABIN.close);
      if (a.t < a.tHold) w.doorCam = a.door.cam;
    }
    if (phase === 'done') { setGround(w, ex.x, ex.z, ex.heading); w.pose = ''; return w; }
    if (a.t < a.tDoor) { w.x = a.inCar.x; w.y = a.inCar.y; w.z = a.inCar.z; w.pose = POSE_OF[k]; return w; }
    if (a.t < a.tOut) {
      const kk = ease((a.t - a.tDoor) / (a.tOut - a.tDoor));
      const gy = height(a.off.x, a.off.z);
      if (a.door) {
        // through the door spot (on the platform beside the cabin), then on to where he stands off
        along3(w, a.inCar, a.door, a.off, kk, height);
        w.y = kk < 0.5 ? lerp(a.inCar.y, height(a.door.x, a.door.z), kk * 2) : w.y;
        w.heading = angLerp(a.inCar.heading, a.door.heading + Math.PI, Math.min(1, kk * 2.5));
      } else { w.x = lerp(a.inCar.x, a.off.x, kk); w.z = lerp(a.inCar.z, a.off.z, kk); w.y = lerp(a.inCar.y, gy, kk); }
      w.pose = carry ? 'carry' : kk < 0.5 && k === 'chair' ? 'sit' : '';
      if (carry) w.walk = kk * 2;
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
  function boardU(tt) { return CP ? CP.u(tt) : cab && !path.shuttle ? cab.u(tt) : u0 + approach * Math.min(1, tt / tArrive); }
  /** Lift lines round: a cabin's boarding (see cab above). Loop cabins: the next one comes in at line speed, slows over the last 1.2 s
   *  and docks at the loading point (the lift's other cabins follow it: lifts.js setRide); a jig-back cabin: the scheduled one docks. */
  function cabinPlan() {
    return cabinBoarding({ path, k, door: doorSpot(site.bottom, -s0, 1), start, tStep, approach, uLoad, seat: seatAt0, height, shuttleWait: path.shuttle ? (shuttle ? shuttle.wait : 0) : 0, tail: crawl0 ? 2.4 : 1.2 });
  }
  /** After launch: the chair boarding plan (see CP above): the rider's way (zone -> gate -> lane (-> belt) -> loading line), the
   *  gate's timing, his chair's approach (line speed, then the last CHAIR.slowFor s at the station crawl vs behind him). */
  function chairPlan() {
    const C = site.chair, F = site.bottom, vline = path.spec.speed, gap = path.spec.gap || 0;
    const P = (a, b) => F.toWorld(a, b, {});
    const gOut = P(C.aGate, C.bGate + 0.7), gIn = P(C.aGate, C.bGate - 0.7), entry = P(C.aEntry, C.bRider), stand = P(C.aLoad - CHAIR.ahead, C.bRider);
    const way = [{ x: start.x, z: start.z }, gOut, gIn, entry];
    const cum = [0];
    for (let n = 1; n < way.length; n++) cum.push(cum[n - 1] + Math.hypot(way[n].x - way[n - 1].x, way[n].z - way[n - 1].z));
    const dWalk = cum[cum.length - 1];
    const tWalk = Math.max(0.9, dWalk / CHAIR.glide);
    const dBelt = Math.hypot(stand.x - entry.x, stand.z - entry.z);
    const tBelt = C.detach ? dBelt / CHAIR.belt : Math.min(0.6, dBelt / CHAIR.glide);
    const tNeedC = CHAIR.open * 0.6 + tWalk + tBelt + CHAIR.stand + CHAIR.sit;
    // his chair: the next one that can reach the loading line once he is there (else the one after it)
    let a0 = uLoad - (startU === null || !Number.isFinite(startU) ? uLoad - vline * tNeedC : startU);
    if (gap > 0) while (a0 < vline * tNeedC) a0 += gap; else a0 = Math.max(a0, vline * tNeedC);
    const T = a0 / vline;                                       // it arrives at the line speed on average
    const tGo = T - tNeedC;                                     // he waits behind the closed gate this long
    const vs = C.detach ? CHAIR.vsDetach : CHAIR.vsFixed;
    // the approach, as metres still to go x s before the arrival: vs for the last x1 s, a ramp over xr s, vf before
    const x1 = CHAIR.slowFor, xr = CHAIR.ramp;
    const vf = (a0 - vs * (x1 + xr / 2)) / Math.max(0.1, T - x1 - xr / 2);
    const uniform = vf < vs;
    const D = (x) => {
      if (uniform) return a0 * x / T;
      if (x <= x1) return vs * x;
      if (x <= x1 + xr) return vs * x + (vf - vs) * (x - x1) * (x - x1) / (2 * xr);
      return vs * x1 + (vs + vf) / 2 * xr + vf * (x - x1 - xr);
    };
    const tWalk0 = tGo + CHAIR.open * 0.6, tBelt0 = tWalk0 + tWalk, tStand0 = tBelt0 + tBelt, tSit0 = T - CHAIR.sit;
    const tThrough = tWalk0 + tWalk * Math.min(1, (cum[2] + 0.4) / (dWalk || 1));    // (ease-free: the gate stays open long enough)
    const seat = seatAt0;
    const lineH = load.heading;
    // the boarding camera's spot (rideCamera): ahead of him, beside the lane, the first with a clear view of him all along the belt (no
    // post of the station within 1.1 m of the sight lines: the camera guard would pull the camera in onto his head)
    const cam = (() => {
      const tb = C.bRider;
      const posts = F.parts.filter((q) => q.post && !q.cut && !q.mount && q.y1 > 1.5).map((q) => ({ a: (q.a0 + q.a1) / 2, b: (q.b0 + q.b1) / 2 }));
      const seg = (ca, cb, ta) => posts.every((q) => { const dx = ta - ca, dy = tb - cb, L2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((q.a - ca) * dx + (q.b - cb) * dy) / L2)); return Math.hypot(ca + dx * u - q.a, cb + dy * u - q.b) > 1.1; });
      const clear = (ca, cb) => seg(ca, cb, C.aEntry) && seg(ca, cb, C.aLoad - CHAIR.ahead) && seg(ca, cb, (C.aLoad + C.aEntry) / 2);
      for (const [da, db] of [[-4.2, 3.4], [-2.6, 3.8], [-1.4, 4.2], [-5.5, 2.4], [-3.4, 1.6], [0.4, 4.4], [-6.5, 4.5]]) if (clear(C.aLoad + da, C.bGate + db)) return P(C.aLoad + da, C.bGate + db);
      return P(C.aLoad - 2.6, C.bGate + 3.8);
    })();
    return {
      u0: uLoad - a0, approach: a0, tArrive: T, vs, detach: C.detach, tGo, tWalk0, tBelt0, tStand0, tSit0, way: [...way, stand],
      u: (tt) => uLoad - D(Math.max(0, T - tt)),
      gate: (tt) => (tt < tGo ? 0 : tt < tThrough + 0.5 ? ease((tt - tGo) / CHAIR.open) : Math.max(0, 1 - ease((tt - tThrough - 0.5) / CHAIR.open))),
      rider(tt, w) {
        w.walk = 0; w.glide = 0; w.pose = '';
        w.boardCam = tt >= tWalk0 ? cam : null;
        if (tt < tWalk0) {                                       // behind the gate: facing it as it opens
          const hx = Math.atan2(gOut.z - start.z, gOut.x - start.x);
          setGround(w, start.x, start.z, tt > tGo - 0.4 ? angLerp(start.heading, hx, ease((tt - tGo + 0.4) / 0.6)) : start.heading);
          return;
        }
        if (tt < tBelt0) {                                       // through the gate into the lane
          const m = ease((tt - tWalk0) / tWalk) * dWalk;
          let n = 1;
          while (n < way.length - 1 && cum[n] < m) n++;
          const A = way[n - 1], B = way[n], f = (m - cum[n - 1]) / ((cum[n] - cum[n - 1]) || 1);
          const hseg = Math.atan2(B.z - A.z, B.x - A.x);
          setGround(w, lerp(A.x, B.x, f), lerp(A.z, B.z, f), hseg);
          if (n === way.length - 1) w.heading = angLerp(hseg, lineH, ease(f));          // turning up the line as he steps into the lane
          w.walk = m; w.glide = dWalk / tWalk;
          return;
        }
        if (tt < tStand0) {                                      // on the belt (or the last step): carried to the loading line
          const f = C.detach ? (tt - tBelt0) / tBelt : ease((tt - tBelt0) / tBelt);
          setGround(w, lerp(entry.x, stand.x, f), lerp(entry.z, stand.z, f), lineH);
          return;
        }
        setGround(w, stand.x, stand.z, lineH);
        if (tt >= tSit0) {                                       // his chair comes up behind him: he sits down onto it
          const kk = ease((tt - tSit0) / CHAIR.sit);
          w.x = lerp(stand.x, seat.x, kk); w.z = lerp(stand.z, seat.z, kk); w.y = lerp(w.y, seat.y, kk);
          if (kk > 0.5) w.pose = 'sit';
        }
      },
    };
  }
  return ride;
}

/**
 * Ride DOWN (Ian, Via Lattea "Cesana-Ski Lodge 1": "you can't go down with the gondola"): the same ride the other way round, for the
 * lifts lift-path.js canRideDown() allows. He waits on the top station's descent mat (lift-site.js site.down), steps out of his skis
 * (cabins) / skates (chairs) to the down lane, the next carrier coming round the top wheel picks him up (a cabin / train waits docked),
 * down the line facing downhill, off at the bottom on the return side and out of the station to the bottom exit (exitAt()). Same API
 * as createRide (main.js, the HUD, the wire), plus `down: true`.
 */
export function createDescent({ lift, path, site, height, factor = RIDE.factor, from = null, startU = null, exitAt = null }) {
  const k = path.kind, D = site.down;
  const sT = D.sTop, sB = Math.min(D.sBottom, sT - 1);
  const speed = path.spec.speed * factor;
  const carry = CARRY.has(k);
  const start = from || D.wait, load = D.load;
  const seatAt0 = riderAt(path, sT, height, {}, true);
  const tStep = carry ? RIDE.stepOut : 0;
  const moveD = Math.hypot(load.x - start.x, load.z - start.z);
  const tMove = Math.max(0.8, moveD / (carry ? RIDE.walk : RIDE.glide));
  const tIn = RIDE.getIn;
  const uLoad = path.downU(sT);
  const tNeed = tStep + tMove + tIn;
  // the carrier: a loop's next one round the top wheel (at most RIDE.wait s late), a jig-back cabin / train waits docked at the top
  const u0 = path.shuttle ? uLoad : startU === null || !Number.isFinite(startU) ? uLoad - path.spec.speed * tNeed : startU;
  const approach = uLoad - u0;
  let tArrive = path.shuttle ? tNeed : Math.max(tNeed, Math.min(approach / path.spec.speed, tNeed + RIDE.wait));
  // lift fixes: a cabin's doors (gondola, funitel, cable car) work at the top like at the bottom: he walks to the door spot beside the
  // down lane's cabin (the return side), it docks with its doors opening, he steps in, they close, it pulls away (the up ride's timeline)
  const cab = DOORED.has(k) ? cabinBoarding({ path, k, door: doorSpotOf(path, site.top, -(path.len - sT), -1), start, tStep, approach, uLoad, seat: seatAt0, height, shuttleWait: 0, tail: 1.2 }) : null;
  if (cab) tArrive = cab.tArrive;
  let phase = 'board', t = 0, s = sT, skipped = false, tRide = 0, alight = null;
  const pose = { roll: 0 };
  const boardU = (tt) => (cab && !path.shuttle ? cab.u(tt) : u0 + approach * Math.min(1, tt / tArrive));
  // lifts.js setRide: a loop carrier by its loop parameter; a jig-back pair by the metres travelled down (the counter cabin goes up)
  const held = (u, sNow) => (path.shuttle ? Math.max(0, Math.min(path.docks[1] - path.docks[0], path.docks[1] - sNow)) : u);
  const ride = {
    lift, path, site, kind: k, pose: POSE_OF[k], speed, carry, down: true,
    get phase() { return phase; },
    get s() { return s; }, get t() { return t; },
    get done() { return phase === 'done'; },
    get share() { return phase === 'board' ? 0 : phase === 'ride' ? (sT - s) / (sT - sB) : 1; },
    get left() { return phase === 'ride' ? Math.max(0, (s - sB) / speed) : phase === 'board' ? (sT - sB) / speed : 0; },
    get carrierU() {
      if (phase === 'board') return held(boardU(t), sT);
      if (phase === 'ride') return held(path.downU(s), s);
      return null;
    },
    get canSkip() { return phase === 'ride' && tRide > 0.6; },
    get gate() { return 0; },
    get chairPlan() { return null; },
    get exit() { return alight ? alight.exit : null; },
    step(dt) {
      t += dt;
      if (phase === 'board' && t >= tArrive) { phase = 'ride'; tRide = 0; }
      else if (phase === 'ride') {
        tRide += dt;
        s = Math.max(sB, s - speed * (cab ? Math.max(0.03, ease(tRide / CABIN.accel)) : 1) * dt);
        if (s <= sB && tRide >= (skipped ? RIDE.minRide * 0.5 : 0)) beginAlight();
      } else if (phase === 'alight') {
        alight.t += dt;
        if (alight.t >= alight.total) phase = 'done';
      }
      return ride.done;
    },
    skip() { if (phase !== 'ride') return false; skipped = true; s = sB; return true; },
    where() { return place(); },
    state(base) {
      const w = place();
      const moving = phase === 'ride' ? speed : 0;
      const st = { ...base, x: w.x, y: w.y, z: w.z, heading: w.heading, vx: Math.cos(w.heading) * moving, vz: Math.sin(w.heading) * moving, vy: 0, speed: w.glide || 0,
        grounded: true, air: 0, crash: 0, tuck: 0, brake: 0, edge: 0, steer: 0, slip: 0, landed: 0, spin: 0, flip: 0, grab: 0, rail: -1, ride: w.pose, walk: w.walk || 0 };
      st.dragHand = null;
      if (w.onCarrier) { st.rideLift = lift.index; st.rideS = s; st.rideKind = KIND_CODE[k] + DOWN_CODE; }
      else { delete st.rideLift; delete st.rideS; delete st.rideKind; }
      return st;
    },
    wire: () => [KIND_CODE[k] + DOWN_CODE, lift.index, Math.round(s * 10) / 10],
  };
  function beginAlight() {
    phase = 'alight';
    const inCar = riderAt(path, sB, height, {}, true);
    const off = D.off;
    const ex = (exitAt && exitAt()) || { x: off.x, z: off.z, heading: inCar.heading };
    const way = [off, ...(ex.via || []), ex];
    const cum = [0];
    for (let n = 1; n < way.length; n++) cum.push(cum[n - 1] + Math.hypot(way[n].x - way[n - 1].x, way[n].z - way[n - 1].z));
    const d = cum[cum.length - 1];
    const tGo = Math.min(8, Math.max(0.6, d / (carry ? RIDE.walk * 1.4 : RIDE.out)));
    alight = { t: 0, inCar, off, exit: ex, tOut: RIDE.getOut, tGo, way, cum, tClick: carry ? RIDE.clickIn : 0, total: RIDE.getOut + tGo + RIDE.turn + (carry ? RIDE.clickIn : 0) };
  }
  function setGround(w, x, z, heading) { w.x = x; w.z = z; w.y = height(x, z); w.heading = heading; }
  function place() {
    const w = pose;
    w.onCarrier = false; w.walk = 0; w.glide = 0; w.boardCam = null; w.hand = null; w.hip = undefined; w.doorK = 0; w.doorCam = null;
    if (phase === 'ride' || (phase === 'board' && t >= tArrive)) {
      riderAt(path, s, height, w, true);
      w.onCarrier = true; w.pose = POSE_OF[k];
      if (cab && phase === 'ride' && tRide < 1.2) w.doorCam = cab.cam;                  // (the camera eases out of the door view)
      w.barDown = k === 'chair' && sT - s > 9 && s - sB > 12;
      return w;
    }
    if (phase === 'board') {
      const c = path.shuttle ? path.shuttleAt(sT, -1, false, {}) : path.loopAt(boardU(t), {});
      w.cx = c.x; w.cz = c.z; w.cy = c.y; w.heading = c.heading; w.pitch = k === 'train' ? Math.atan(path.slope(sT)) : 0; w.barDown = false;
      if (cab) { cab.rider(t, w); return w; }
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
      const tin = t - (tArrive - tIn);
      setGround(w, load.x, load.z, load.heading);
      w.pose = carry ? 'carry' : '';
      if (tin > 0) {
        const kk = ease(tin / tIn);
        w.x = lerp(load.x, seatAt0.x, kk); w.z = lerp(load.z, seatAt0.z, kk); w.y = lerp(w.y, seatAt0.y, kk);
        if (kk > 0.5) w.pose = POSE_OF[k];
      }
      return w;
    }
    const a = alight, ex = a.exit;
    w.cx = a.inCar.cx; w.cy = a.inCar.cy; w.cz = a.inCar.cz;
    if (phase === 'done') { setGround(w, ex.x, ex.z, ex.heading); w.pose = ''; return w; }
    if (a.t < a.tOut) {
      const kk = ease(a.t / a.tOut);
      w.x = lerp(a.inCar.x, a.off.x, kk); w.z = lerp(a.inCar.z, a.off.z, kk); w.y = lerp(a.inCar.y, height(a.off.x, a.off.z), kk); w.heading = a.inCar.heading;
      w.pose = carry ? 'carry' : kk < 0.5 && k === 'chair' ? 'sit' : '';
      return w;
    }
    const tg = a.t - a.tOut, total = a.cum[a.cum.length - 1], last = a.way.length - 1;
    const hx = Math.atan2(ex.z - a.way[last - 1].z, ex.x - a.way[last - 1].x);
    if (tg < a.tGo) {
      const m = ease(tg / a.tGo) * total;
      let n = 1;
      while (n < last && a.cum[n] < m) n++;
      const A = a.way[n - 1], B = a.way[n], f = (m - a.cum[n - 1]) / ((a.cum[n] - a.cum[n - 1]) || 1);
      setGround(w, lerp(A.x, B.x, f), lerp(A.z, B.z, f), angLerp(a.inCar.heading, Math.atan2(B.z - A.z, B.x - A.x), Math.min(1, tg / 0.5)));
      w.pose = carry ? 'carry' : ''; w.walk = m; w.glide = carry ? 0 : total / a.tGo;
      return w;
    }
    const tt = tg - a.tGo;
    setGround(w, ex.x, ex.z, angLerp(hx, ex.heading, ease(tt / RIDE.turn)));
    w.pose = carry && tt < RIDE.turn ? 'carry' : carry && tt < RIDE.turn + a.tClick * 0.35 ? 'skisdown' : carry && tt < RIDE.turn + a.tClick ? 'clickin' : '';
    return w;
  }
  return ride;
}
/** Seconds a ride down takes on the carrier at the game's speed. */
export function descentSeconds(path, site, factor = RIDE.factor) {
  // (a cabin pulls away from the dock over CABIN.accel s: half of it is lost)
  return site && site.down ? Math.max(0, site.down.sTop - site.down.sBottom) / (path.spec.speed * factor) + (DOORED.has(path.kind) ? CABIN.accel / 2 : 0) : 0;
}

/** The ride cameras. mode 'chase' | 'window'; w = ride.where(); returns { x, y, z, tx, ty, tz, fov, inside? } (the caller smooths
 *  'chase'; `inside` = in a tunnel: never lifted over the ground). */
export function rideCamera(path, w, mode, ground) {
  const k = path.kind;
  const fx = Math.cos(w.heading), fz = Math.sin(w.heading), rx = -fz, rz = fx;
  const out = {};
  const tunnel = !!path.tunnel && w.onCarrier && ground(w.x, w.z) - w.y > 3;
  if (w.doorCam && mode !== 'window') {
    // lift lines round: a cabin: from the platform outside its door (he walks in, the doors close, it pulls away; getting off the same)
    const c = w.doorCam, g = ground(c.x, c.z);
    out.x = c.x; out.z = c.z; out.y = Math.max(g, w.y - (w.onCarrier ? 0 : 0)) + c.up; out.tx = w.x; out.tz = w.z; out.ty = w.y + 1.1; out.fov = 58;
    return out;
  } else if (!w.onCarrier && w.boardCam) {
    // after launch: boarding a chair: from the platform beside the lane, a little ahead (the chair comes up behind him in view)
    const c = w.boardCam;
    out.x = c.x; out.z = c.z; out.y = w.y + 2.1; out.tx = w.x; out.tz = w.z; out.ty = w.y + 0.9; out.fov = 60;      // (over his deck, not the snow outside)
  } else if (!w.onCarrier) {
    // boarding / getting off: behind him on the platform, a little to the outer side
    // (lift lines round: a drag lift's hut stands on the outer side, behind the start line: the camera on the return side, not in it)
    const sd = k === 'drag' ? -1.8 * (path.sign || 1) : 1.8;
    out.x = w.x - fx * 5.2 + rx * sd; out.z = w.z - fz * 5.2 + rz * sd; out.y = w.y + 2.3;
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
