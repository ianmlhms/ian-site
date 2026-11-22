/* The snow park (round 4A, pure: no THREE, no DOM; the Node checks use the same code).
 * One park per resort, from resort.json "park" (scripts/ski/park_site.mjs: a mapped OSM snow park, else a gentle open slope by a lift):
 * a straight run line top -> bottom, a corridor hw m either side, a baked ground profile (heights every `step` m).
 *
 *   layout    the corridor is flattened to the profile (field.js `park` hook: mask + shape), then the features are built on it, in lanes:
 *             kickers S / M / L (run-up, table, landing: terrain, so the picture and the physics agree), boxes and rails (objects, each
 *             fed by a small snow ramp whose top meets the rail), and a halfpipe cut into the slope at the end when the line is long enough
 *   physics   stepPark() wraps skier.js stepSkier: rail / box capture and slides, the halfpipe lip (the walls are 45 degrees on the 2.5 m
 *             lattice, the lip turns the flight upwards like a real vertical lip), a soft speed check (a park is skied at 30-50 km/h)
 *   tricks    the trick judge watches the states: spins (180 .. 1080, steering in the air), grabs (trick button held), flips (up / down in
 *             the air: only the big kickers give the air for one), rail / box slides; every landing is judged clean / sketchy / crash;
 *             tricks landed within COMBO_GAP s of each other build a combo multiplier, a fall loses the open combo.
 *   score     points of the park run (higher is better). The board stores PARK_BASE - points (every ski-* board is lower-is-better in
 *             the arcade and in scripts/ski-v1.sql); the format "skipark" prints the points. */
import { createPiste } from '../pistes.js';
import { stepSkier } from '../skier.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const G = 9.81;
const TAU = Math.PI * 2;

export const PARK_BASE = 1000000;          // stored board score = PARK_BASE - points
export const PARK_MAX_POINTS = 250000;     // the same ceiling in scripts/ski-v1.sql (a perfect run with every feature is far below it)
export const PARK_MIN_POINTS = 1;
export const parkBoardId = (rid) => `ski-${rid}-park`;
export const parkBoardName = (resortShort) => `Ski Alpen · Snowpark (${resortShort})`.slice(0, 80);
export const parkScoreOf = (points) => PARK_BASE - Math.round(points);
export const pointsOfScore = (score) => PARK_BASE - score;

const FEATHER = 10;                         // m beside the corridor over which the ground blends back into the terrain
const END_FEATHER = 14;
/* H lip height, run-up, table, landing, width (m); points multiplier. The run-up is h = H q^LIP_POW (q = 0..1 along it): steep at the lip.
 * On the 2.5 m lattice a lip is rounded off, so stepPark launches the skier at the lip with the lip's own angle (as a sharp lip would). */
const LIP_POW = 3.4;
export const KICKERS = Object.freeze({
  S: { h: 1.2, run: 7.5, table: 3, land: 11, w: 5.5, mult: 1 },
  M: { h: 2.0, run: 10, table: 5.5, land: 15, w: 6.5, mult: 1.3 },
  L: { h: 3.0, run: 12.5, table: 8, land: 21, w: 7.5, mult: 1.6 },
});
const RAIL = Object.freeze({ rail: { h: 0.75, half: 0.06, tol: 0.65, len: 12 }, box: { h: 0.55, half: 0.32, tol: 0.85, len: 9 } });
const RAMP = 6;                             // m: the snow ramp before a rail / box (wide and long enough for the 2.5 m lattice to show it)
const PIPE = Object.freeze({ depth: 2.8, flat: 8, wall: 7.5, inRamp: 14, outRamp: 16, minLen: 70, mult: 1.25, pop: 1.05, minPop: 3.2, back: 0.9 });
const LANE = 7;                             // m between the lane centres
/** R8c: the in-run: at least `slope` average fall over the first `len` m of the park; the start deck behind it (where the run starts,
 *  s = -4) falls at least `deckSlope` */
export const DROP_IN = Object.freeze({ len: 24, slope: 0.22, deckSlope: 0.12 });
/** R8c (QA: a straight run over the kickers scored 0): a clean straight air off a kicker counts (x the kicker's multiplier) */
export const STRAIGHT_AIR = Object.freeze({ minAir: 0.3, points: 100 });
const SPEED_CHECK = 15;                     // m/s: faster than this on the ground in the park, a soft brake pulls the speed back
/* The features in order down the line: [s from the top, kind, size / type, lane (-1 left .. +1 right)]. After the first big kicker a
 * long park gets the halfpipe (PIPE_AT ..), a shorter one a second line of kickers and a rail. */
const PLAN_A = Object.freeze([
  [30, 'kicker', 'S', -1], [30, 'box', 'box', 1],
  [76, 'rail', 'rail', -1], [76, 'kicker', 'S', 1],
  [122, 'kicker', 'M', 0],
  [172, 'box', 'box', -1], [172, 'rail', 'rail', 1],
  [208, 'kicker', 'L', 0],
]);
const PLAN_B = Object.freeze([[268, 'kicker', 'M', -1], [270, 'rail', 'rail', 1], [308, 'kicker', 'L', 0]]);
const PIPE_AT = 266, PIPE_MAX = 135;
/* R7-D: the meshes' extents: the ramps' side walls, the pipe deck beside the lips, the trough under the pipe (terrain only): in / out of
 * the lip line, how far past the pipe's ends, how much deeper than the pipe */
const RAMP_SIDE = 0.7;
export const PIPE_DECK = 4.6;               // > TROUGH.out + the lattice's diagonal (3.54 m): the trough's slope never reaches the deck's rim
const TROUGH = Object.freeze({ in: 1.0, out: 0.5, ends: 4, extra: 0.5, cover: 4, drop: 0.08 });

/** The park layout of a resort (null when resort.json has no park). */
export function createParkLayout(site) {
  if (!site || !Array.isArray(site.line) || site.line.length < 4 || !Array.isArray(site.profile) || site.profile.length < 3) return null;
  const [x0, z0, x1, z1] = site.line;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
  const hw = site.hw || 18, step = site.step || 10;
  const prof = site.profile;
  const last = prof.length - 1;
  const slopeEnd = (prof[last] - prof[last - 1]) / step, slopeStart = (prof[1] - prof[0]) / step;
  /** Ground profile at arc length s (extrapolated beyond the ends with the end slopes). */
  function profileRaw(s) {
    if (s <= 0) return prof[0] + slopeStart * s;
    const f = s / step;
    if (f >= last) return prof[last] + slopeEnd * (s - last * step);
    const i = Math.floor(f), t = f - i;
    return prof[i] + (prof[i + 1] - prof[i]) * t;
  }
  // R8c (QA: Grattalu's start almost flat, 6.5 s to 10 km/h): a drop-in. Where the first DROP_IN.len m fall less than DROP_IN.slope on
  // average, the start is raised (a smooth bump, steepest at the top, none at the end of the in-run); behind it the start deck (the run
  // starts there, s = -4) falls at least DROP_IN.deckSlope. Ground, meshes and physics all read profileAt.
  const dropIn = Math.max(0, DROP_IN.slope * DROP_IN.len - (profileRaw(0) - profileRaw(DROP_IN.len)));
  const p0 = profileRaw(0);
  const profileAt = (s) => {
    if (s >= DROP_IN.len) return profileRaw(s);
    if (s > 0) { const t = 1 - s / DROP_IN.len; return profileRaw(s) + dropIn * t * t; }
    return p0 + dropIn + Math.max(profileRaw(s) - p0, -DROP_IN.deckSlope * s);       // the deck: never flatter than deckSlope
  };
  const local = (x, z, out) => { const rx = x - x0, rz = z - z0; out.s = rx * ux + rz * uz; out.v = rx * -uz + rz * ux; return out; };
  const world = (s, v, out = {}) => { out.x = x0 + ux * s - uz * v; out.z = z0 + uz * s + ux * v; return out; };

  // features
  const kickers = [], rails = [], ramps = [];
  let lastEnd = 0;
  const withPipe = len - 4 - PIPE_AT >= PIPE.minLen;
  for (const [s, kind, size, lane] of withPipe ? PLAN_A : [...PLAN_A, ...PLAN_B]) {
    const v = lane * LANE;
    if (kind === 'kicker') {
      const k = KICKERS[size];
      const end = s + k.run + k.table + k.land;
      if (end > len - 12) continue;
      kickers.push({ s0: s, size, v, ...k, end, id: kickers.length, lip: s + k.run, lipSlope: LIP_POW * k.h / k.run, side: clamp(k.h * 0.8, 0.9, 2.4) });   // R7-D: side = the side walls' width
      lastEnd = Math.max(lastEnd, end);
    } else {
      const r = RAIL[kind];
      const sr = s + RAMP;
      if (sr + r.len > len - 12) continue;
      const rail = { kind, s0: sr, s1: sr + r.len, v, h: r.h, half: r.half, tol: r.tol, id: rails.length };
      rails.push(rail);
      ramps.push({ s0: s, s1: sr, v, h: r.h - 0.08, w: 4.6 });
      lastEnd = Math.max(lastEnd, sr + r.len);
    }
  }
  const pipe = withPipe ? { ...PIPE, s0: PIPE_AT, s1: Math.min(len - 4, PIPE_AT + PIPE_MAX) } : null;
  const deck = PIPE.flat / 2 + PIPE.wall;

  /* R7-D: the kickers, the rail ramps and the halfpipe are real meshes now (modes/views.js createParkView), built from these analytic
   * shapes, and the physics reads the same shapes (solidAt, through surface.js): drawn == skied, crisp lips, straight side walls, a
   * smooth pipe. The terrain lattice under them only keeps the flattened corridor plus a trough under the pipe (cut deeper than the
   * pipe's own surface, so the 2.5 m lattice never shows through the curved walls). */
  const kickerAlong = (k, t) => (t < k.run ? Math.pow(t / k.run, LIP_POW) : t < k.run + k.table ? 1 : 1 - smoothstep(0, 1, (t - k.run - k.table) / k.land));
  const rampAlong = (r, s) => (s <= r.s1 ? smoothstep(r.s0 - 0.5, r.s1, s) : 1 - smoothstep(r.s1, r.s1 + 0.6, s));
  /** across share of a crisp snow body: flat top |dv| <= half, straight side walls `side` m wide */
  const crisp = (dv, half, side) => { const a = Math.abs(dv); return a <= half ? 1 : Math.max(0, 1 - (a - half) / side); };
  const pipeDepthK = (s) => (s < pipe.s0 ? smoothstep(pipe.s0 - pipe.inRamp, pipe.s0, s) : s > pipe.s1 ? 1 - smoothstep(pipe.s1, pipe.s1 + pipe.outRamp, s) : 1);
  /** The pipe surface at (s, v) under the deck (<= 0). */
  function pipeHeight(s, v) {
    if (!pipe || s <= pipe.s0 - pipe.inRamp || s >= pipe.s1 + pipe.outRamp) return 0;
    const av = Math.abs(v);
    if (av >= deck) return 0;
    const t = av < pipe.flat / 2 ? 0 : (av - pipe.flat / 2) / pipe.wall;
    return -pipe.depth * pipeDepthK(s) * (1 - t * t);
  }
  /** Extra height of the features at local (s, v) over the flattened ground: what is drawn and what is skied. */
  function featureHeight(s, v) {
    let h = 0;
    for (const k of kickers) {
      if (s < k.s0 || s > k.end) continue;
      const across = crisp(v - k.v, k.w / 2, k.side);
      if (across > 0) h = Math.max(h, k.h * kickerAlong(k, s - k.s0) * across);
    }
    for (const r of ramps) {
      if (s < r.s0 - 0.5 || s > r.s1 + 0.6) continue;
      const across = crisp(v - r.v, r.w / 2, RAMP_SIDE);
      if (across > 0) h = Math.max(h, r.h * rampAlong(r, s) * across);
    }
    return h + pipeHeight(s, v);
  }
  /** What the terrain lattice gets: only the trough under the pipe (deeper than the pipe and wider, hidden by the pipe mesh). */
  function terrainExtra(s, v) {
    if (!pipe) return 0;
    // under the whole pipe mesh the terrain sits a few cm lower (the 2.5 m lattice cuts the profile's 10 m kinks by up to ~4 cm),
    // back to the profile over the mesh's outer band, so the terrain never shows through the flat deck
    const av = Math.abs(v), rim = deck + PIPE_DECK;
    const band = Math.min(rim - av, s - (pipe.s0 - pipe.inRamp - TROUGH.ends - TROUGH.cover), pipe.s1 + pipe.outRamp + TROUGH.ends + TROUGH.cover - s);
    if (band <= 0) return 0;
    const drop = -TROUGH.drop * clamp((band - 0.4) / (TROUGH.cover - 0.6), 0, 1);
    if (s <= pipe.s0 - pipe.inRamp - TROUGH.ends || s >= pipe.s1 + pipe.outRamp + TROUGH.ends) return drop;
    const edge = deck + TROUGH.out;
    if (av >= edge) return drop;
    const ends = smoothstep(pipe.s0 - pipe.inRamp - TROUGH.ends, pipe.s0 - TROUGH.ends * 0.3, s) * (1 - smoothstep(pipe.s1 + TROUGH.ends * 0.3, pipe.s1 + pipe.outRamp + TROUGH.ends, s));
    const across = av <= deck - TROUGH.in ? 1 : (edge - av) / (TROUGH.in + TROUGH.out);
    return Math.min(drop, -(pipe.depth + TROUGH.extra) * ends * across);
  }
  /** The footprint boxes of the meshes: inside one, the physics reads the analytic shape (solidAt). */
  const boxes = [
    ...kickers.map((k) => [k.s0 - 0.5, k.end + 0.5, k.v - k.w / 2 - k.side - 0.9, k.v + k.w / 2 + k.side + 0.9]),        // R7-D: each box wider than its mesh
    ...ramps.map((r) => [r.s0 - 1, r.s1 + 1.1, r.v - r.w / 2 - RAMP_SIDE - 0.9, r.v + r.w / 2 + RAMP_SIDE + 0.9]),
    ...(pipe ? [[pipe.s0 - pipe.inRamp - TROUGH.ends - TROUGH.cover - 0.5, pipe.s1 + pipe.outRamp + TROUGH.ends + TROUGH.cover + 0.5, -deck - PIPE_DECK - 0.5, deck + PIPE_DECK + 0.5]] : []),
  ];
  /** the pipe mesh's extent along the line (the trough + its lattice slope + a margin) */
  const pipeSpan = pipe ? [pipe.s0 - pipe.inRamp - TROUGH.ends - TROUGH.cover, pipe.s1 + pipe.outRamp + TROUGH.ends + TROUGH.cover] : null;

  const q = { s: 0, v: 0 };
  /** 0..1: the share of the park ground at (x, z) (the corridor, feathered at the sides and the ends). */
  function mask(x, z) {
    local(x, z, q);
    if (q.s < -END_FEATHER - 6 || q.s > len + END_FEATHER + 10 || Math.abs(q.v) > hw + FEATHER) return 0;
    const side = 1 - smoothstep(hw, hw + FEATHER, Math.abs(q.v));
    const ends = smoothstep(-END_FEATHER - 6, -6, q.s) * (1 - smoothstep(len + 10, len + END_FEATHER + 10, q.s));
    return side * ends;
  }
  /** The park ground at (x, z): the profile blended into the terrain `base`, plus the features. */
  function shape(x, z, base, lod = 2.5) {
    local(x, z, q);
    const m = mask(x, z);
    if (m <= 0) return base;
    const flat = base + (profileAt(q.s) - base) * m;
    return flat + terrainExtra(q.s, q.v) * m;          // R7-D: the features are meshes; the trough is kept on every level (the pipe mesh covers it)
  }
  /** R7-D: the analytic snow surface where a park mesh lies (kickers, ramps, the pipe and its deck), NaN elsewhere (then the lattice). */
  function solidAt(x, z) {
    local(x, z, q);
    if (q.s < -30 || q.s > len + 30 || Math.abs(q.v) > hw) return NaN;
    for (const b of boxes) if (q.s >= b[0] && q.s <= b[1] && q.v >= b[2] && q.v <= b[3]) return profileAt(q.s) + featureHeight(q.s, q.v);
    return NaN;
  }

  /** The run line (a piste for game.js / pistes.js: projection, respawn, the START / ZIL arches). */
  const line = [];
  for (let s = -6; s <= len + 4; s += 10) { const p = world(s, 0); line.push(p.x, p.z); }
  const run = createPiste({ id: 'park', name: site.name || 'Snowpark', ref: '', diff: 'blue', hw: hw - 2, slalom: false, line, len: len + 10, drop: prof[0] - prof[last], top: Math.round(prof[0]), bottom: Math.round(prof[last]) });

  /** Rail top height at rail s (the ground profile + the rail height; the rails follow the slope). */
  const railTop = (r, s) => profileAt(s) + r.h;
  /** The feature a skier takes off from at local (s, v): 'S' | 'M' | 'L' | 'pipe' | null. */
  function featureAt(s, v) {
    for (const k of kickers) if (s > k.s0 + k.run - 3 && s < k.s0 + k.run + k.table + 2 && Math.abs(v - k.v) < k.w / 2 + 1.2) return k.size;
    if (pipe && s > pipe.s0 - 2 && s < pipe.s1 + 2 && Math.abs(v) > pipe.flat / 2 + pipe.wall * 0.45 && Math.abs(v) < deck + 1.5) return 'pipe';
    return null;
  }
  return {
    site, name: site.name || 'Snowpark', len, hw, ux, uz, x0, z0, kickers, rails, ramps, pipe, run, deck,
    profileAt, featureHeight, mask, shape, local, world, railTop, featureAt,
    solidAt, terrainExtra, kickerAlong, rampAlong, boxes, pipeSpan, rampSide: RAMP_SIDE, pipeDeck: PIPE_DECK, trough: TROUGH,      // R7-D
    top: world(-4, 0), bottom: world(len, 0),
    heading: Math.atan2(uz, ux),
  };
}

/* ---------------- physics ---------------- */

const GRIND = Object.freeze({ mu: 0.06, minSpeed: 1.2, pop: 2.6, leave: 0.7 });

/** One fixed step in the park: rails / boxes, the halfpipe lip, the speed check, around skier.js stepSkier (world.tricks = true). */
export function stepPark(layout, prev, input, world, dt) {
  if (prev.rail >= 0 && prev.crash === 0) return grindStep(layout, prev, input, dt);
  const next = stepSkier(prev.leftRail ? { ...prev, leftRail: null } : prev, input, world, dt);
  if (!layout || next.crash > 0) return next;
  const q = layout.local(next.x, next.z, {});
  if (q.s < -30 || q.s > layout.len + 30 || Math.abs(q.v) > layout.hw + 12) return next;
  // the halfpipe lip: riding out over a wall's top, the flight goes straight up (and a little back in) as off a real vertical lip,
  // never out over the deck; early hops off the lattice on the way up the wall are held on the snow
  if (layout.pipe && q.s > layout.pipe.s0 - 4 && q.s < layout.pipe.s1 + 4 && prev.crash === 0) {
    const lipV = layout.deck - 0.9;
    const pv = layout.local(prev.x, prev.z, {}).v;
    const rx = -layout.uz, rz = layout.ux;                                       // across (right)
    const across = next.vx * rx + next.vz * rz, along = next.vx * layout.ux + next.vz * layout.uz;
    const out = Math.sign(q.v) * across;                                         // > 0: towards the deck
    const nearSnow = prev.grounded || prev.y - world.height(prev.x, prev.z) < 0.4;
    if (nearSnow && out > 0.6 && Math.abs(pv) < lipV && Math.abs(q.v) >= lipV && Math.sign(pv) === Math.sign(q.v)) {
      const up = Math.max(PIPE.minPop, out * PIPE.pop + Math.max(0, next.vy) * 0.5);
      const back = -Math.sign(q.v) * PIPE.back;
      return { ...next, grounded: false, air: 0, spin: 0, flip: 0, grab: 0, y: Math.max(next.y, world.height(next.x, next.z)) + 0.12, vx: layout.ux * along + rx * back, vz: layout.uz * along + rz * back, vy: up };
    }
    if (prev.grounded && !next.grounded && Math.abs(q.v) < lipV && Math.abs(q.v) > PIPE.flat / 2) return { ...next, grounded: true, y: world.height(next.x, next.z) };
  }
  // a kicker's run-up holds the skier on the snow (no early hop off a lattice edge), its lip launches him along the lip's own slope
  // (the lattice rounds the lip off: without this a slow skier would roll over it)
  const q0 = layout.local(prev.x, prev.z, {});
  for (const k of layout.kickers) {
    if (Math.abs(q.v - k.v) > k.w / 2 - 0.4 || q.s < k.s0 || q.s > k.lip + 1) continue;
    if (q.s < k.lip && prev.grounded && !next.grounded) return { ...next, grounded: true, y: world.height(next.x, next.z) };
  }
  if (prev.crash === 0 && (prev.grounded || prev.y - world.height(prev.x, prev.z) < 0.35)) {
    for (const k of layout.kickers) {
      if (q0.s >= k.lip || q.s < k.lip || Math.abs(q.v - k.v) > k.w / 2 - 0.4) continue;
      const base = (layout.profileAt(k.lip + 1) - layout.profileAt(k.lip - 1)) / 2;      // the park slope there (< 0)
      const slope = k.lipSlope + base;                                                   // the lip's slope over the horizontal
      const rx = -layout.uz, rz = layout.ux;
      const along = next.vx * layout.ux + next.vz * layout.uz, across = next.vx * rx + next.vz * rz;
      const v = Math.hypot(along, next.vy);
      const c = 1 / Math.hypot(1, slope);
      const h = v * c;
      return { ...next, grounded: false, air: 0, y: Math.max(next.y, world.height(next.x, next.z)) + 0.1, spin: 0, flip: 0, grab: 0,
        vx: layout.ux * h + rx * across, vz: layout.uz * h + rz * across, vy: v * slope * c };
    }
  }
  // rails / boxes: caught when the skier comes onto one from its ramp (or drops onto it) roughly along it
  for (const r of layout.rails) {
    if (q.s < r.s0 - 0.3 || q.s > r.s1 - 0.8 || Math.abs(q.v - r.v) > r.tol) continue;
    const top = layout.railTop(r, q.s);
    const fromRamp = q.s < r.s0 + 1.5;                                          // off the ramp: the lattice rounds the ramp, a small hop up
    if (next.y < top - (fromRamp ? 0.8 : 0.35) || next.y > top + 0.9) continue;
    const along = next.vx * layout.ux + next.vz * layout.uz;
    if (along < GRIND.minSpeed) continue;
    const hv = Math.hypot(next.vx, next.vz);
    if (hv > 1 && along / hv < 0.62) continue;                                  // across the rail: no slide
    const rh = layout.heading;
    return { ...next, rail: r.id, railS: q.s, railS0: q.s, railT: 0, railSide: 0, grounded: true, air: 0, y: top, vx: layout.ux * along, vz: layout.uz * along, vy: 0,
      heading: next.heading, x: layout.world(q.s, r.v).x, z: layout.world(q.s, r.v).z, railHeading: rh, spin: 0, flip: 0, grab: 0 };
  }
  // the soft speed check on the park ground
  if (next.grounded && next.speed > SPEED_CHECK) {
    const k = Math.max(SPEED_CHECK / next.speed, 1 - 1.4 * dt);
    return { ...next, vx: next.vx * k, vy: next.vy * k, vz: next.vz * k, speed: next.speed * k };
  }
  return next;
}

/** Sliding a rail or box: along it with little friction; steering turns the skis across it (a slide); jump pops off; the end lets go. */
function grindStep(layout, prev, input, dt) {
  const r = layout.rails[prev.rail];
  const s = { ...prev, t: prev.t + dt, landed: Math.max(0, prev.landed - dt), jumpCd: Math.max(0, prev.jumpCd - dt) };
  const along0 = prev.vx * layout.ux + prev.vz * layout.uz;
  const slope = (layout.profileAt(prev.railS + 1) - layout.profileAt(prev.railS - 1)) / 2;   // dy per m (< 0 downhill)
  const sin = -slope / Math.hypot(1, slope), cos = 1 / Math.hypot(1, slope);
  let v = along0 + (G * sin - GRIND.mu * G * cos) * dt;
  const steer = clamp(input.steer || 0, -1, 1);
  // skis across the rail when the player steers (a slide), back along when he lets go
  let side = prev.railSide + (Math.abs(steer) > 0.35 ? Math.sign(steer) * 5 * dt : -Math.sign(prev.railSide) * Math.min(Math.abs(prev.railSide), 3 * dt));
  side = clamp(side, -Math.PI / 2, Math.PI / 2);
  const rs = prev.railS + v * dt;
  s.railS = rs; s.railT = prev.railT + dt; s.railSide = side;
  s.heading = prev.railHeading + side;
  const p = layout.world(rs, r.v);
  s.x = p.x; s.z = p.z; s.y = layout.railTop(r, rs);
  s.vx = layout.ux * v; s.vz = layout.uz * v; s.vy = slope * v;
  s.speed = Math.abs(v); s.grounded = true; s.air = 0; s.edge = 0; s.slip = 0; s.snow = 1;
  s.steer = steer; s.tuck = 0; s.brake = 0;
  const off = rs > r.s1 || v < GRIND.minSpeed * 0.6;
  const pop = input.jump && s.railT > 0.2 && s.jumpCd <= 0;
  if (off || pop) {
    s.rail = -1; s.grounded = false; s.air = 0; s.jumpCd = 0.6;
    s.vy = slope * v + (pop ? GRIND.pop : GRIND.leave);
    s.heading = prev.railHeading;                                           // the skis come back round off the end
    s.leftRail = { id: r.id, kind: r.kind, len: Math.max(0, Math.min(rs, r.s1) - prev.railS0), time: s.railT, side: Math.abs(side) > 1 };
  }
  return s;
}

/* ---------------- tricks ---------------- */

export const SPIN_POINTS = Object.freeze({ 0: 0, 180: 100, 360: 250, 540: 400, 720: 600, 900: 800, 1080: 1100 });
const FLIP_POINTS = 700;
const COMBO_GAP = 4;                 // s between landings that keeps a combo
const COMBO_STEP = 0.25, COMBO_MAX = 3;
const NATURAL_MULT = 0.6;            // an air off a roller or a drift (no park feature)
const QUALITY_MULT = Object.freeze({ clean: 1, sketchy: 0.5 });
export const QUALITY_LABEL = Object.freeze({ clean: 'Propper!', sketchy: 'Wackeleg', crash: 'Gefall' });

const wrapPi = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
/** How far a spin is from a whole half turn (rad) and a flip from a whole turn: the landing judgement (also used by skier.js). */
export const spinResidual = (spin) => Math.abs(wrapPi(spin * 2) / 2);
export const flipResidual = (flip) => Math.abs(wrapPi(flip));

export function trickName({ spinDeg, flips, flipDir, grab, railKind, side }) {
  if (railKind) return `${side ? (railKind === 'box' ? 'Boxslide' : 'Railslide') : railKind === 'box' ? 'Box 50-50' : 'Rail 50-50'}`;
  const parts = [];
  if (flips) parts.push(`${flips > 1 ? 'Double ' : ''}${flipDir > 0 ? 'Frontflip' : 'Backflip'}`);
  if (spinDeg) parts.push(String(spinDeg));
  if (grab) parts.push('Grab');
  return parts.join(' ') || 'Sprong';
}

/** The trick judge of one park run (or of free riding). update() after every physics step returns the events of that step. */
export function createTrickJudge(layout) {
  let score = 0, combo = 0, comboPoints = 0, lastLand = -99, t = 0, air = null, best = null;
  const tricks = [];
  function bank() {
    if (comboPoints > 0) score = Math.min(PARK_MAX_POINTS, score + comboPoints);
    comboPoints = 0; combo = 0;
  }
  function land(points, name, quality, feature) {
    if (t - lastLand > COMBO_GAP) bank();
    combo += 1;
    const mult = Math.min(COMBO_MAX, 1 + COMBO_STEP * (combo - 1));
    const got = Math.round(points * mult);
    comboPoints += got;
    lastLand = t;
    const trick = { name, quality, points: got, base: Math.round(points), combo: mult, feature, t };
    tricks.push(trick);
    if (!best || got > best.points) best = trick;
    return { type: 'trick', ...trick, total: score + comboPoints };
  }
  return {
    get score() { return Math.round(score + comboPoints); }, get banked() { return score; }, get combo() { return combo > 1 ? Math.min(COMBO_MAX, 1 + COMBO_STEP * (combo - 1)) : 1; },
    get tricks() { return tricks; }, get best() { return best; },
    update(prev, cur, dt) {
      t += dt;
      const events = [];
      if (t - lastLand > COMBO_GAP && comboPoints > 0) { bank(); events.push({ type: 'banked', total: score }); }
      // a slide ended
      if (prev.rail >= 0 && cur.rail < 0 && cur.leftRail) {
        const lr = cur.leftRail;
        if (lr.len > 1.5) {
          const pts = Math.max(100, lr.len * 40) * (lr.side ? 1.5 : 1);
          events.push(land(pts, trickName({ railKind: lr.kind, side: lr.side }), 'clean', lr.kind));
        }
      }
      // take-off: what are we flying off?
      if (prev.grounded && !cur.grounded && cur.crash === 0) {
        const q = layout ? layout.local(cur.x, cur.z, {}) : null;
        air = { feature: prev.rail >= 0 ? 'rail' : q ? layout.featureAt(q.s, q.v) : null, t0: t };
      }
      if (!cur.grounded && air) air.time = t - air.t0;
      // landing (or a fall in the air / at touch-down)
      if (!prev.grounded && cur.grounded && air) {
        const a = air; air = null;
        if (cur.crash > 0) { comboPoints = 0; combo = 0; events.push({ type: 'fall' }); return events; }
        const spinDeg = Math.min(1080, Math.round(Math.abs(prev.spin || 0) / Math.PI) * 180);
        const flips = Math.round(Math.abs(prev.flip || 0) / TAU);
        const grabT = prev.grab || 0;
        const grab = grabT >= 0.25;
        const airT = a.time || 0;
        const kicker = a.feature === 'S' || a.feature === 'M' || a.feature === 'L';
        const straight = !spinDeg && !flips && !grab;
        if (straight && !(kicker && airT >= STRAIGHT_AIR.minAir) && airT < 0.7) return events;
        const quality = cur.landQ === 1 ? 'sketchy' : 'clean';
        const mult = a.feature === 'S' || a.feature === 'M' || a.feature === 'L' ? KICKERS[a.feature].mult : a.feature === 'pipe' ? PIPE.mult : a.feature === 'rail' ? 1 : NATURAL_MULT;
        const pts = (SPIN_POINTS[spinDeg] || 0) + flips * FLIP_POINTS + (grab ? Math.min(450, 150 + 100 * Math.floor((grabT - 0.25) / 0.5)) : 0) + Math.floor(airT / 0.5) * 50
          + (straight && kicker ? STRAIGHT_AIR.points : 0);
        events.push(land(pts * mult * QUALITY_MULT[quality], straight && kicker ? 'Straight Air' : trickName({ spinDeg, flips, flipDir: Math.sign(prev.flip || 0), grab }), quality, a.feature));
      }
      if (prev.crash === 0 && cur.crash > 0 && cur.grounded && !air) { if (comboPoints) events.push({ type: 'fall' }); comboPoints = 0; combo = 0; }
      return events;
    },
    /** End of the run: the open combo counts. Returns the final points. */
    finish() { bank(); return Math.round(score); },
  };
}

/** Is this a park score the game may post? (the same rule as scripts/ski-v1.sql) */
export const validParkPoints = (points) => Number.isFinite(points) && points >= PARK_MIN_POINTS && points <= PARK_MAX_POINTS;
