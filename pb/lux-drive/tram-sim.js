/* The Luxtram vehicles of Lux Drive: the simulation.  Pure (no THREE).
 *
 * A vehicle never leaves its track: it is a distance `s` along the centre line of a track (the front of the vehicle), and its
 * five articulated sections are the points of the track at fixed distances behind it.  So a tram is on its rails by
 * construction, in every curve, on every hill (cars are not on rails: the car physics is a different thing).
 *
 * A vehicle runs the line like the real one: it accelerates to the line speed, slows for the curves, brakes to stop with its
 * middle at the stop, waits (the doors), and goes on.  At a terminus it leaves the track for a few seconds (the real tram
 * changes tracks on a crossover and goes back; the game does not draw that) and appears at the first stop of the other track.
 * A vehicle never runs into the one in front of it. */

const CURVE_WINDOW = 14;            // m on each side of a point that measure the turn of the track
const CURVE_STEP = 4;               // m between the samples of the speed limit of the curves
const LATERAL_ACCEL = 1.1;          // m/s2 the passengers stand in a curve
const MIN_CURVE_SPEED = 4.5;        // m/s: the slowest curve speed (a hairpin of the turnback)
const LOOK_AHEAD = 90;              // m: how far ahead the braking for a curve looks
const HEADWAY = 14;                 // m: the free distance two vehicles keep when the front one stands
const STOP_MARGIN = 0.4;            // m: the vehicle is "at the stop" this close to its mark
const OBSTACLE_LOOK = 75;           // m: how far ahead the driver sees a car on the track
const OBSTACLE_STEP = 3;            // m between the points of the track that are tested
const OBSTACLE_CLEAR = 2.9;         // m: a car this close to the centre line of the track is in the way (half the body + the car + a margin)
const OBSTACLE_STOP_GAP = 9;        // m: the vehicle stops this far from the car in its way

/** The speed limit of the curves along a track: [limit per CURVE_STEP metres]. */
function curveLimits(track, maxSpeed) {
  const n = Math.ceil(track.length / CURVE_STEP) + 1;
  const out = new Float32Array(n);
  const a = { x: 0, z: 0, dx: 0, dz: 0 }, b = { x: 0, z: 0, dx: 0, dz: 0 };
  for (let i = 0; i < n; i++) {
    const s = i * CURVE_STEP;
    track.at(Math.max(0, s - CURVE_WINDOW), a); track.at(Math.min(track.length, s + CURVE_WINDOW), b);
    const turn = Math.abs(Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz));       // rad over the window
    const span = Math.min(track.length, s + CURVE_WINDOW) - Math.max(0, s - CURVE_WINDOW);
    const curvature = span > 1 ? turn / span : 0;
    out[i] = curvature < 1e-4 ? maxSpeed : Math.min(maxSpeed, Math.max(MIN_CURVE_SPEED, Math.sqrt(LATERAL_ACCEL / curvature)));
  }
  return out;
}

export function createTramSim(network, cfg, { vehicles = cfg.vehicles, seed = 11 } = {}) {
  const tracks = network.tracks;
  const stops = network.stops;
  const limits = tracks.map((t) => curveLimits(t, cfg.maxSpeed));
  const length = cfg.sections * cfg.sectionLength + (cfg.sections - 1) * cfg.gap;
  const pitch = cfg.sectionLength + cfg.gap;
  const trams = [];
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const obstacle = { active: false, x: 0, z: 0 };       // the player's car: a vehicle brakes for it when it stands on the track ahead

  const frontMark = (track, stopIdx) => stops[track][stopIdx].s + length / 2;     // the vehicle stands with its middle at the stop
  const limitAt = (track, s) => { const f = Math.max(0, s) / CURVE_STEP, i = Math.min(limits[track].length - 2, Math.floor(f)); return limits[track][i] * (1 - (f - i)) + limits[track][i + 1] * (f - i); };

  /** Places the vehicle on a stop of a track (standing, the doors open for `wait` seconds). */
  function place(tram, track, stopIdx, wait) {
    tram.track = track; tram.stop = stopIdx; tram.s = frontMark(track, stopIdx); tram.v = 0;
    tram.mode = 'dwell'; tram.timer = wait; tram.hidden = false;
  }

  // the vehicles start spread over the line, standing at stops: the first one at the stop next to the start of the game (Philharmonie),
  // on the track that runs EAST like the player does, so that it pulls out in front of the car; the others at Hamilius and Gare
  const starts = [['Philharmonie - MUDAM', 1], ['Hamilius', 0], ['Gare Centrale', 1], ['Rout Bréck - Pafendall', 0], ['Place de Metz', 1]];
  for (let i = 0; i < vehicles; i++) {
    const [want, preferred] = starts[i % starts.length];
    let track = preferred, idx = stops[track].findIndex((s) => s.name === want);
    if (idx < 0) { track = 1 - track; idx = stops[track].findIndex((s) => s.name === want); }
    if (idx < 0) { track = 0; idx = Math.min(stops[0].length - 1, 1 + i * 3); }
    const tram = { id: i, track, s: 0, v: 0, stop: 0, mode: 'dwell', timer: 0, hidden: false, sections: [] };
    for (let k = 0; k < cfg.sections; k++) tram.sections.push({ fx: 0, fz: 0, rx: 0, rz: 0 });
    place(tram, track, idx, 6 + i * 5);
    trams.push(tram);
  }

  function updateSections(tram) {
    const track = tracks[tram.track];
    for (let k = 0; k < cfg.sections; k++) {
      const sec = tram.sections[k];
      const sf = tram.s - k * pitch, sr = sf - cfg.sectionLength;
      track.at(sf, tmp); sec.fx = tmp.x; sec.fz = tmp.z;
      track.at(sr, tmp); sec.rx = tmp.x; sec.rz = tmp.z;
    }
  }

  /** The free distance in front of a vehicle on the same track (Infinity: nothing there). */
  function gapAhead(tram) {
    let gap = Infinity;
    for (const o of trams) {
      if (o === tram || o.hidden || o.track !== tram.track || o.s <= tram.s) continue;
      gap = Math.min(gap, (o.s - length) - tram.s);
    }
    return gap;
  }

  function step(tram, dt) {
    if (tram.mode === 'turn') {
      tram.timer -= dt;
      if (tram.timer <= 0) place(tram, 1 - tram.track, 0, cfg.dwell * 0.6);
      return;
    }
    if (tram.mode === 'dwell') {
      tram.timer -= dt;
      if (tram.timer > 0) return;
      if (tram.stop >= stops[tram.track].length - 1) { tram.mode = 'turn'; tram.timer = cfg.turnback; tram.hidden = true; return; }
      tram.mode = 'run'; tram.stop += 1;
    }
    // running: the speed that the stop, the curves ahead and the vehicle in front allow
    const track = tracks[tram.track];
    const toStop = frontMark(tram.track, tram.stop) - tram.s;
    let vMax = Math.min(cfg.maxSpeed, limitAt(tram.track, tram.s));
    vMax = Math.min(vMax, Math.sqrt(2 * cfg.decel * Math.max(0, toStop - STOP_MARGIN * 0.5)) + 0.3);
    for (let d = CURVE_STEP; d <= LOOK_AHEAD; d += CURVE_STEP) {
      const lim = limitAt(tram.track, tram.s + d);
      vMax = Math.min(vMax, Math.sqrt(lim * lim + 2 * cfg.decel * d));
    }
    if (obstacle.active) {
      for (let d = 0; d <= OBSTACLE_LOOK; d += OBSTACLE_STEP) {
        track.at(tram.s + d, tmp);
        if (Math.hypot(tmp.x - obstacle.x, tmp.z - obstacle.z) < OBSTACLE_CLEAR) {
          vMax = Math.min(vMax, Math.sqrt(2 * cfg.decel * 1.4 * Math.max(0, d - OBSTACLE_STOP_GAP)));
          break;
        }
      }
    }
    const gap = gapAhead(tram);
    if (gap < Infinity) vMax = Math.min(vMax, Math.sqrt(2 * cfg.decel * Math.max(0, gap - HEADWAY)));
    tram.v = tram.v < vMax ? Math.min(vMax, tram.v + cfg.accel * dt) : Math.max(vMax, tram.v - cfg.decel * 1.5 * dt);
    tram.s = Math.min(track.length, tram.s + tram.v * dt);
    if (toStop - tram.v * dt <= STOP_MARGIN && tram.v < 1.2) {
      tram.s = frontMark(tram.track, tram.stop); tram.v = 0; tram.mode = 'dwell'; tram.timer = cfg.dwell;
    }
  }

  function update(dt) {
    for (const tram of trams) {
      step(tram, dt);
      if (!tram.hidden) updateSections(tram);
    }
  }
  for (const tram of trams) updateSections(tram);

  /** The push out of a vehicle: { nx, nz, pen, tram, speed, qx, qz, tx, tz } when the circle touches a section, otherwise null ((qx, qz) the nearest point of the
   *  section and (tx, tz) its direction: the car's collider reads the level of the rails there, car-collide.js). */
  function collide(x, z, radius) {
    let best = null;
    const reach = cfg.bodyHalfWidth + radius;
    for (const tram of trams) {
      if (tram.hidden) continue;
      for (const sec of tram.sections) {
        const ex = sec.fx - sec.rx, ez = sec.fz - sec.rz;
        const ll = ex * ex + ez * ez || 1;
        let t = ((x - sec.rx) * ex + (z - sec.rz) * ez) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = sec.rx + ex * t, qz = sec.rz + ez * t;
        const d = Math.hypot(x - qx, z - qz);
        if (d >= reach) continue;
        const pen = reach - d;
        if (best && pen <= best.pen) continue;
        let nx = 1, nz = 0;
        if (d > 1e-4) { nx = (x - qx) / d; nz = (z - qz) / d; }
        const l = Math.sqrt(ll);
        best = { nx, nz, pen, tram: tram.id, speed: tram.v, qx, qz, tx: ex / l, tz: ez / l };
      }
    }
    return best;
  }

  /** The player's car (null: nothing in the way): the vehicles brake for it when it stands on their track. */
  function setObstacle(x, z) { obstacle.active = x !== null; obstacle.x = x; obstacle.z = z; }

  return { trams, update, collide, setObstacle, length, tracks, stops, pitch };
}
