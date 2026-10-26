/* The scripted rider ("the reference rider"): follows a trail's centre line with pure pursuit and a speed plan from the curvature of the line.
 * It is the yardstick for the medal times (bake_medals.mjs) and the player of the harness / flow tests. Pure functions, no THREE.
 *
 *   plan     v_target(i) = min(vmax(grade), sqrt(aLat / curvature(i)), brake-limited speed from the corners ahead)
 *   control  steer from the angle to a look-ahead point; pedal when slower than the plan; brake in proportion to how much faster it is
 * It never jumps and never pumps unless asked (`pump: true` pumps the rollers: crouch on the crest, extend in the valley). */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const BOT = Object.freeze({
  vmax: { green: 13, blue: 16, red: 14, black: 12.5 },       // m/s: how fast the reference rider goes on a clear line
  aLat: 5.4,                      // m/s2 of cornering it asks of the tyres (about 0.6 g on dry dirt: the tyres give 1 g)
  aBrake: 6.0,                    // m/s2 it plans to brake with
  lookMin: 4.5, lookMax: 13, lookPerMs: 0.45,
  steerGain: 1.9,
  curvatureWindow: 4,             // samples either side that the curvature is smoothed over
  spacing: 1.5,                   // m between plan samples
  slack: 0.5,                     // m/s the rider may be over the plan before it brakes
});

function resampleLine(line, spacing) {
  const out = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    let [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= spacing) {
      const k = (spacing - carry) / seg;
      ax += (bx - ax) * k; az += (bz - az) * k;
      out.push([ax, az]);
      seg = Math.hypot(bx - ax, bz - az);
      carry = 0;
    }
    carry += seg;
  }
  out.push(line[line.length - 1]);
  return out;
}

/** The speed plan for a centre line: { pts, kappa, vTarget }. */
export function planLine(line, grade = 'blue', opts = {}) {
  const spacing = opts.spacing || BOT.spacing;
  const pts = resampleLine(line, spacing);
  const n = pts.length;
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; heading[i] = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  const kappa = new Float64Array(n);
  const W = BOT.curvatureWindow;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n - 1, i + W);
    let dh = heading[b] - heading[a];
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    kappa[i] = Math.abs(dh) / Math.max(spacing, (b - a) * spacing);
  }
  const vmax = (opts.vmax || BOT.vmax[grade] || 10) * (opts.speedScale || 1);
  const aLat = (opts.aLat || BOT.aLat);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(aLat / Math.max(kappa[i], 1e-4)));
  v[n - 1] = Math.min(v[n - 1], 6);
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * (opts.aBrake || BOT.aBrake) * spacing));      // braking distance before a corner
  return { pts, kappa, vTarget: v, spacing };
}

/** A bot instance: call `input(state)` every frame; `progress()` is the index it has reached, `done()` when it is at the end. */
export function createBot(line, grade = 'blue', opts = {}) {
  const plan = planLine(line, grade, opts);
  const { pts, vTarget, spacing } = plan;
  const n = pts.length;
  let at = 0;
  const pump = opts.pump === true;
  const api = {
    plan,
    progress: () => at,
    done: () => at >= n - 3,
    input(s) {
      // find the nearest plan point near where we were
      let best = at, bd = 1e18;
      const hi = Math.min(n - 1, at + 60);
      for (let i = Math.max(0, at - 10); i <= hi; i++) { const d = (pts[i][0] - s.x) ** 2 + (pts[i][1] - s.z) ** 2; if (d < bd) { bd = d; best = i; } }
      if (bd > 40 * 40) { for (let i = 0; i < n; i++) { const d = (pts[i][0] - s.x) ** 2 + (pts[i][1] - s.z) ** 2; if (d < bd) { bd = d; best = i; } } }
      at = best;
      const speed = Math.hypot(s.vx, s.vz);
      const look = clamp(BOT.lookMin + BOT.lookPerMs * speed, BOT.lookMin, BOT.lookMax);
      const target = pts[Math.min(n - 1, at + Math.round(look / spacing))];
      let err = Math.atan2(target[1] - s.z, target[0] - s.x) - s.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      const steer = clamp(err * BOT.steerGain, -1, 1);
      const plan0 = Math.min(vTarget[at], vTarget[Math.min(n - 1, at + Math.round(speed * 0.8 / spacing))]);
      const over = speed - plan0 - BOT.slack;
      const throttle = speed < plan0 ? 1 : 0;
      const brake = over > 0 ? clamp(0.25 + over / 1.6, 0, 1) : 0;
      return { throttle, brake, steer, jump: pump ? s.kappa < -0.015 && speed > 4 : false };
    },
  };
  return api;
}

/** Rides a bot over a trail in Node (no rendering): returns { time, crashes, finished, maxSpeed, airTime, nan, below, splits[] }. step(state, input, dt) and respawn(state, planIndex) are injected. */
export function rideTrail({ line, grade, start, step, respawn, rescue, ground, dt = 1 / 60, maxTime = 4000, checkpoints = [], opts = {} }) {
  const bot = createBot(line, grade, opts);
  let s = start;
  let t = 0, crashes = 0, maxSpeed = 0, air = 0, nan = 0, below = 0, stuck = 0, rescues = 0;
  const rescueAt = [], crashAt = [];
  const splits = new Array(checkpoints.length).fill(0);
  let nextCp = 0;
  const end = line[line.length - 1];
  while (!bot.done() && t < maxTime) {
    const input = bot.input(s);
    s = step(s, input, dt);
    t += dt;
    if (![s.x, s.y, s.z, s.vx, s.vy, s.vz].every(Number.isFinite)) { nan++; break; }
    if (s.y < ground(s.x, s.z) - 1e-6) below++;
    if (s.crashed) { crashes++; crashAt.push([Math.round(s.x), Math.round(s.z), s.crashed]); s = respawn(s, bot.progress()); }
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    maxSpeed = Math.max(maxSpeed, sp);
    if (!s.grounded) air += dt;
    while (nextCp < checkpoints.length && bot.progress() >= checkpoints[nextCp]) splits[nextCp++] = t;
    if (Math.hypot(s.vx, s.vz) < 0.25 && t > 6) { if (++stuck > 150) { if (!rescue || rescues >= 6) break; rescueAt.push([Math.round(s.x), Math.round(s.z), bot.progress()]); s = rescue(s, bot.progress()); rescues++; stuck = 0; } } else stuck = 0;
  }
  return { time: t, crashes, rescues, rescueAt, crashAt, finished: bot.done(), maxSpeed, airTime: air, nan, below, splits, state: s, end, progress: bot.progress(), length: bot.plan.pts.length };
}
