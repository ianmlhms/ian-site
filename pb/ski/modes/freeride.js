/* Free ride all day (round 4A, pure: no THREE, no DOM).
 *   lifts      every lift of the resort with its bottom and top (by height), the start spots at the tops (a few metres beyond the top
 *              station, facing down the fall line or the nearest piste), and the ride time
 *   free run   the run object of main.js for the whole-area free ride: no clock, no piste to stay on (off-piste is fine anywhere in the
 *              resort box), "lift" when the skier stands at a lift's bottom, the session counters (distance, vertical, lifts, top speed),
 *              a respawn point that follows the skier (the last safe spot on the snow)
 *   day clock  9:00 -> 16:30 over about half an hour of play (lift rides add their own minutes); env.js turns it into light unless the
 *              player fixed the time of day */
export const DAY = Object.freeze({ start: 9, end: 16.5, hoursPerSecond: 1 / 240 });     // one game hour = 4 real minutes
const LIFT_SPEED = Object.freeze({ chair: 5, gondola: 6, cable: 10, drag: 3, carpet: 1 });
const BOTTOM_RADIUS = 28;      // m from the bottom station: the skier may ride up
const SAFE_EVERY = 1.5;        // s between respawn spots
const EDGE = 150;              // m inside the box edge: beyond it the skier is sent back

const fmt2 = (n) => String(n).padStart(2, '0');
export const formatHour = (h) => { const m = Math.floor(h * 60 + 1e-6); return `${Math.floor(m / 60)}:${fmt2(m % 60)}`; };

/** Lifts with bottom / top / ride time and a start spot at the top. heightAt(x, z) = any height function (the far grid is enough). */
export function createLiftNet(resort, heightAt, pistes = null) {
  const list = [];
  for (const [i, l] of resort.lifts.entries()) {
    if (!LIFT_SPEED[l.kind] || l.kind === 'carpet' || l.pts.length < 4) continue;
    const p = l.pts, n = p.length / 2;
    const a = { x: p[0], z: p[1], y: heightAt(p[0], p[1]) }, b = { x: p[2 * n - 2], z: p[2 * n - 1], y: heightAt(p[2 * n - 2], p[2 * n - 1]) };
    const [bottom, top] = a.y <= b.y ? [a, b] : [b, a];
    if (top.y - bottom.y < 25) continue;                      // flat links and people movers
    let len = 0;
    for (let k = 1; k < n; k++) len += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    // the lift's own direction at the top (bottom -> top): the start spot is ahead of the top station and a little to the side
    const ux = (top.x - bottom.x) / (Math.hypot(top.x - bottom.x, top.z - bottom.z) || 1), uz = (top.z - bottom.z) / (Math.hypot(top.x - bottom.x, top.z - bottom.z) || 1);
    list.push({ id: `l${i}`, name: l.name || kindName(l.kind), kind: l.kind, bottom, top, len, seconds: len / LIFT_SPEED[l.kind], ux, uz });
  }
  /** Where a skier starts at a lift's top: on the piste that starts nearest the top station (a few metres down it, facing along it),
   *  else 14 m past the station facing down the fall line (measured over 40 m, so a small dip does not turn the skier round). */
  function startAt(lift, height = heightAt) {
    let best = null, bd = 220;
    for (const p of pistes ? pistes.list : []) { const d = Math.hypot(p.top.x - lift.top.x, p.top.z - lift.top.z); if (d < bd) { bd = d; best = p; } }
    if (best) { const a = best.at(Math.min(14, best.length * 0.2), {}); return { x: a.x, z: a.z, heading: Math.atan2(a.dz, a.dx), piste: best.id }; }
    let x = lift.top.x + lift.ux * 14 - lift.uz * 6, z = lift.top.z + lift.uz * 14 + lift.ux * 6;
    const g = 40;
    const gx = (height(x + g, z) - height(x - g, z)) / (2 * g), gz = (height(x, z + g) - height(x, z - g)) / (2 * g);
    const heading = Math.hypot(gx, gz) > 0.02 ? Math.atan2(-gz, -gx) : Math.atan2(lift.uz, lift.ux);
    x += Math.cos(heading) * 8; z += Math.sin(heading) * 8;
    return { x, z, heading };
  }
  function nearestBottom(x, z, radius = BOTTOM_RADIUS) {
    let best = null, bd = radius;
    for (const l of list) { const d = Math.hypot(l.bottom.x - x, l.bottom.z - z); if (d < bd) { bd = d; best = l; } }
    return best;
  }
  function nearestTop(x, z, radius = 400) {
    let best = null, bd = radius;
    for (const l of list) { const d = Math.hypot(l.top.x - x, l.top.z - z); if (d < bd) { bd = d; best = l; } }
    return best;
  }
  return { list, byId: new Map(list.map((l) => [l.id, l])), startAt, nearestBottom, nearestTop };
}

export function kindName(kind) {
  return kind === 'chair' ? 'Sesselbunn' : kind === 'gondola' ? 'Gondel' : kind === 'cable' ? 'Seelbunn' : kind === 'drag' ? 'Schlepplift' : 'Lift';
}

/** The run of a whole-area free ride. pistes = createPisteSet, lifts = createLiftNet. */
export function createFreeRun({ resort, pistes, lifts, start }) {
  const stats = { distance: 0, vertical: 0, lifts: 0, top: 0, time: 0 };
  let safe = { x: start.x, z: start.z, heading: start.heading }, safeT = 0, lastX = start.x, lastY = null, lastZ = start.z, atLift = null, current = null, nearT = 99;
  const run = {
    mode: 'freeride', timed: false, gates: [], checkpoints: [], stats,
    get piste() { return current; }, get progress() { return 0; }, get elapsed() { return stats.time; }, get finished() { return null; }, get penalty() { return 0; }, get ms() { return 0; },
    get atLift() { return atLift; },
    samples: () => [],
    proj: {},
    /** After a physics step: counters, the lift at hand, the box edge. */
    update(state, dt) {
      const events = [];
      stats.time += dt;
      if (state.crash === 0) {
        const d = Math.hypot(state.x - lastX, state.z - lastZ);
        if (d < 5) stats.distance += d;
        if (lastY !== null && state.grounded && lastY > state.y) stats.vertical += Math.min(3, lastY - state.y);
        stats.top = Math.max(stats.top, state.speed);
      }
      lastX = state.x; lastZ = state.z; lastY = state.grounded ? state.y : lastY;
      safeT += dt;
      if (safeT > SAFE_EVERY && state.grounded && state.crash === 0 && state.speed > 1) { safeT = 0; safe = { x: state.x, z: state.z, heading: Math.atan2(state.vz, state.vx) }; }
      const lift = state.speed < 6 ? lifts.nearestBottom(state.x, state.z) : null;
      if (lift !== atLift) { atLift = lift; events.push({ type: 'lift', lift }); }
      nearT += dt;
      if (nearT > 1) { nearT = 0; const n = pistes.nearest(state.x, state.z, 90); current = n ? n.piste : null; }
      if (state.x < EDGE || state.z < EDGE || state.x > resort.width - EDGE || state.z > resort.depth - EDGE) events.push({ type: 'offpiste' });
      return events;
    },
    respawnPoint() { return { ...safe }; },
    /** Ride a lift: the counters, the respawn spot at the top; returns the start spot. */
    rideUp(lift, height) {
      stats.lifts += 1;
      const s = lifts.startAt(lift, height);
      safe = { ...s }; lastX = s.x; lastZ = s.z; lastY = null; atLift = null;
      return s;
    },
  };
  return run;
}

/** The day clock: advance(dt) in real seconds, addMinutes(m) for a lift ride; done at DAY.end. */
export function createDayClock(startHour = DAY.start) {
  let hour = startHour;
  return {
    get hour() { return hour; }, get done() { return hour >= DAY.end; },
    advance(dt) { hour = Math.min(DAY.end, hour + dt * DAY.hoursPerSecond); return hour; },
    addMinutes(m) { hour = Math.min(DAY.end, hour + m / 60); return hour; },
    set(h) { hour = Math.max(DAY.start, Math.min(DAY.end, h)); },
  };
}

/** Start hour of a day from the chosen time of day (morning / midday / evening). */
export const startHourFor = (timeId) => (timeId === 'evening' ? 15 : timeId === 'midday' ? 12 : DAY.start);
