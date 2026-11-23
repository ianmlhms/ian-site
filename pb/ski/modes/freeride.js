/* Free ride all day (round 4A, pure: no THREE, no DOM).
 *   lifts      every lift of the resort with its bottom and top (by height), the start spots at the tops (a few metres beyond the top
 *              station, facing down the fall line or the nearest piste), and the ride time
 *   free run   the run object of main.js for the whole-area free ride: no clock, no piste to stay on (off-piste is fine anywhere in the
 *              resort box), "lift" when the skier stands at a lift's bottom, the session counters (distance, vertical, lifts, top speed),
 *              a respawn point that follows the skier (the last safe spot on the snow)
 *   day clock  9:00 -> 16:30 over about half an hour of play (lift rides add their own minutes); env.js turns it into light unless the
 *              player fixed the time of day */
import { liftClass, LIFT_SPEC, createLiftPath } from '../lift-path.js';
import { createLiftWorld } from '../lift-site.js';

export const DAY = Object.freeze({ start: 9, end: 16.5, hoursPerSecond: 1 / 240 });     // one game hour = 4 real minutes
const NEAR_ZONE = 18;          // m from a boarding zone's waiting spot: the hint where to stand (outside the zone)
const BOTTOM_RADIUS = 30;      // m from a bottom station: "the lift nearest here" for the map (round 7-B: boarding = lift-site.js zones)
const MIN_RISE_DRAG = 2;       // m: launch fix ("every lift rideable"): the nursery rope tows (Fontany, Replat, Balmengrat: 4-5 m) ride too
const MIN_RISE = 8;            // m: lower lifts (flat links) are not ridden (round 7-B: was 25; magic carpets ride from 15 m long)
const EXIT_PISTE = 80;         // m: a piste that starts this close to a top station is where the skier gets off
const SAFE_EVERY = 1.5;        // s between respawn spots
const EDGE = 150;              // m inside the box edge: beyond it the skier is sent back

const fmt2 = (n) => String(n).padStart(2, '0');
export const formatHour = (h) => { const m = Math.floor(h * 60 + 1e-6); return `${Math.floor(m / 60)}:${fmt2(m % 60)}`; };

/** Lifts with bottom / top / ride time and a start spot at the top. heightAt(x, z) = any height function (the far grid is enough).
 *  Round 7-B: `world` = lift-site.js createLiftWorld over every drawn lift (stations, boarding zones, exits, colliders); setBuildings(rows)
 *  once buildings.json is in (the exits keep clear of them, the village leaves out those standing in a station or a lift lane). */
export function createLiftNet(resort, heightAt, pistes = null) {
  const list = [];
  const paths = new Map();
  for (const [i, l] of resort.lifts.entries()) { const p = createLiftPath(l, heightAt); if (p) paths.set(i, p); }
  let world = createLiftWorld(paths);
  for (const [i, l] of resort.lifts.entries()) {
    const cls = liftClass(l.kind) || liftClass(l.type);        // round 6: every kind of the data (rail kinds too); 7-B: carpets too
    if (!cls || l.pts.length < 4 || !paths.has(i)) continue;
    const p = l.pts, n = p.length / 2;
    const a = { x: p[0], z: p[1], y: heightAt(p[0], p[1]) }, b = { x: p[2 * n - 2], z: p[2 * n - 1], y: heightAt(p[2 * n - 2], p[2 * n - 1]) };
    const [bottom, top] = a.y <= b.y ? [a, b] : [b, a];
    if (cls === 'carpet' ? paths.get(i).len < 15 : top.y - bottom.y < (cls === 'drag' ? MIN_RISE_DRAG : MIN_RISE)) continue;      // flat links
    let len = 0;
    for (let k = 1; k < n; k++) len += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    // the lift's own direction at the top (bottom -> top): the start spot is ahead of the top station and a little to the side
    const ux = (top.x - bottom.x) / (Math.hypot(top.x - bottom.x, top.z - bottom.z) || 1), uz = (top.z - bottom.z) / (Math.hypot(top.x - bottom.x, top.z - bottom.z) || 1);
    // round 6: the line's own start is its bottom in the baked data (bake.py orients every lift uphill); `reversed` if not
    list.push({ id: `l${i}`, index: i, name: l.name || kindName(cls), kind: cls, bottom, top, len, seconds: len / LIFT_SPEC[cls].speed, ux, uz, reversed: a.y > b.y, seats: l.seats || 0, tunnel: !!l.tunnel, sub: paths.get(i).sub });
  }
  // R8 (early QA: 3 x "Plan Maison", 2 x "Kumme" in the lift list): lifts sharing a name get a number, bottom (lowest) first;
  // `baseName` keeps the data's name (a first-lift lookup by name still finds it)
  const byName = new Map();
  for (const l of list) { l.baseName = l.name; if (!byName.has(l.name)) byName.set(l.name, []); byName.get(l.name).push(l); }
  for (const same of byName.values()) if (same.length > 1) [...same].sort((a, b) => a.bottom.y - b.bottom.y || a.index - b.index).forEach((l, k) => { l.name = `${l.baseName} ${k + 1}`; });
  const pisteStarts = pistes ? pistes.list : null;               // (exitOf: their tops, and points down the ones starting at a top)
  /** Where a skier stands after a lift (round 7-B: lift-site.js exitOf: out of the top station on snow, facing downhill, 15 m clear;
   *  the old guess was the nearest piste start, which could be inside a building). tree(x, z) = a tree there (scatter), optional. */
  function startAt(lift, height = heightAt, tree = null) {
    const e = world.exitOf(lift.index, height, tree, pisteStarts);
    return { x: e.x, z: e.z, heading: e.heading };
  }
  /** Where a skier waits to board (round 7-B): in the bottom station's boarding zone, facing up the line. */
  function boardAt(lift) {
    const site = world.sites.get(lift.index);
    return { ...site.wait };
  }
  /** The lift whose boarding zone holds (x, z) (round 7-B: only there the "Astegen" button shows), or null. */
  function boardingAt(x, z) {
    const i = world.boardingAt(x, z);
    return i === null ? null : byIndex.get(i) || null;
  }
  /** The rideable lift whose boarding zone's waiting spot is nearest (x, z) within r m, or null. */
  function nearZone(x, z, r) {
    let best = null, bd = r;
    for (const l of list) { const s = world.sites.get(l.index); if (!s) continue; const d = Math.hypot(s.wait.x - x, s.wait.z - z); if (d < bd) { bd = d; best = l; } }
    return best;
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
  const byIndex = new Map(list.map((l) => [l.index, l]));
  return {
    list, byId: new Map(list.map((l) => [l.id, l])), byIndex, startAt, boardAt, boardingAt, nearZone, nearestBottom, nearestTop, paths,
    get world() { return world; },
    setBuildings(rows) { world = createLiftWorld(paths, { buildings: rows, cutsFrom: world }); return world; },
  };
}

export function kindName(kind, sub = '') {
  if (sub === 'funitel') return 'Funitel';                                 // R8e: the twin-rope lifts (lift-path.js isFunitel)
  return kind === 'chair' ? 'Sesselbunn' : kind === 'gondola' ? 'Gondel' : kind === 'cable' ? 'Seelbunn' : kind === 'drag' ? 'Schlepplift' : kind === 'train' ? 'Zuch' : kind === 'carpet' ? 'Zauberteppech' : 'Lift';
}

/** Round 6: where a resort's free ride starts: the bottom station of a lift in a village (chairs, cabins and trains before drag lifts and
 *  underground funiculars, near the resort's start piste breaks ties). lifts = createLiftNet; places = resort.json places. */
export function spawnLift(lifts, places, near = null) {
  const villages = (places || []).filter((p) => p.kind === 'village' || p.kind === 'town');
  const pool = villages.length ? villages : (places || []);
  let best = null, bs = Infinity;
  for (const l of lifts.list) {
    let d = 4000;
    for (const v of pool) d = Math.min(d, Math.hypot(v.x - l.bottom.x, v.z - l.bottom.z));
    const score = d + (l.kind === 'drag' || l.kind === 'carpet' || l.tunnel ? 900 : 0) +          // (an underground funicular is no start: the ride is unseen)
      (near ? 0.08 * Math.hypot(near.x - l.bottom.x, near.z - l.bottom.z) : 0) - Math.min(400, (l.top.y - l.bottom.y) * 0.4);
    if (score < bs) { bs = score; best = l; }
  }
  return best || lifts.list[0] || null;
}

/** The run of a whole-area free ride. pistes = createPisteSet, lifts = createLiftNet. */
export function createFreeRun({ resort, pistes, lifts, start, stats: shared = null }) {
  const stats = shared || { distance: 0, vertical: 0, lifts: 0, top: 0, time: 0, off: 0 };       // off: metres skied off the piste (round 6: the Powder ski)
  let safe = { x: start.x, z: start.z, heading: start.heading }, safeT = 0, lastX = start.x, lastY = null, lastZ = start.z, atLift = null, atNear = null, current = null, nearT = 99;
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
        if (d < 5) { stats.distance += d; if (!current && (state.snow === undefined || state.snow < 0.5)) stats.off += d; }
        if (lastY !== null && state.grounded && lastY > state.y) stats.vertical += Math.min(3, lastY - state.y);
        stats.top = Math.max(stats.top, state.speed);
      }
      lastX = state.x; lastZ = state.z; lastY = state.grounded ? state.y : lastY;
      safeT += dt;
      if (safeT > SAFE_EVERY && state.grounded && state.crash === 0 && state.speed > 1) { safeT = 0; safe = { x: state.x, z: state.z, heading: Math.atan2(state.vz, state.vx) }; }
      const lift = state.speed < 6 && !state.ride ? lifts.boardingAt(state.x, state.z) : null;      // round 7-B: only in the zone
      if (lift !== atLift) { atLift = lift; events.push({ type: 'lift', lift }); }
      // launch fix (Ian stood beside a lift and found no way on): slow near a bottom station but not in its zone: say where it is
      const near = !lift && state.speed < 3 && !state.ride ? lifts.nearZone(state.x, state.z, NEAR_ZONE) : null;
      if (near !== atNear) { atNear = near; if (near) events.push({ type: 'lift', lift: null, near }); }
      nearT += dt;
      if (nearT > 1) { nearT = 0; const n = pistes.nearest(state.x, state.z, 90); current = n ? n.piste : null; }
      if (state.x < EDGE || state.z < EDGE || state.x > resort.width - EDGE || state.z > resort.depth - EDGE) events.push({ type: 'offpiste' });
      return events;
    },
    /** The last safe spot (every SAFE_EVERY s on the snow at speed); cleanup round: after a landing crash where he came to rest (he
     *  flew down there: the safe spot before the drop would only send him over it again), facing the way he was going, unless that
     *  is a wall steeper than 45 deg (slopeAt(x, z) in deg) or off the map. */
    respawnPoint({ landed = false, at = null, slopeAt = null } = {}) {
      if (landed && at && at.x > EDGE && at.z > EDGE && at.x < resort.width - EDGE && at.z < resort.depth - EDGE && (!slopeAt || slopeAt(at.x, at.z) < 45)) {
        return { x: at.x, z: at.z, heading: Math.hypot(at.vx, at.vz) > 0.5 ? Math.atan2(at.vz, at.vx) : at.heading };
      }
      return { ...safe };
    },
    /** Ride a lift: the counters, the respawn spot at the top; returns the start spot. */
    rideUp(lift, height) {
      stats.lifts += 1;
      const s = lifts.startAt(lift, height);
      safe = { ...s }; lastX = s.x; lastZ = s.z; lastY = null; atLift = null;
      return s;
    },
    /** Round 6: the skier was moved (fast travel, the end of a challenge): no distance across the jump, a safe spot here. */
    moved(spot) { lastX = spot.x; lastZ = spot.z; lastY = null; safe = { x: spot.x, z: spot.z, heading: spot.heading || 0 }; },     // (R7-B: atLift stays, so the next step reports a change of zone)
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
