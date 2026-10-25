/* The game loop as a pure state machine (no DOM, no THREE): the browser (main.js), the Node harness and the flows run exactly this code.
 *
 *   modes   'card'       the start card is up, the rider waits at the start gate (physics frozen)
 *           'countdown'  3 - 2 - 1 - Go (physics frozen until Go)
 *           'run'        the clock runs: checkpoints with splits against the best run, crash -> respawn at the last checkpoint after PLAY.respawnTime,
 *                        stuck / lost rescue, finish arch
 *           'finished'   the result is known (medal, new best); the rider rolls out
 *           'free'       free ride over the whole valley: no clock, viewpoints are collected
 *   events  update() returns a list of { type, ... } the shell turns into sounds, toasts and screens:
 *           countdown {n}, go, checkpoint {n, total, ms, delta}, crash {cause}, respawn {index, reason}, rescue {index}, finish {ms, medal, ...}, viewpoint {index}
 * Nothing here knows about the weather: times and medals are times. */
import { PLAY } from './config.js';

export const GAME = Object.freeze({
  countdownSeconds: 3,
  checkpointAlong: 14,              // m past the checkpoint's centre index the rider may be and still count it (fast riders skip over the 9 m radius)
  stuckSeconds: 3.4,                // pedalling without moving for this long: put the rider back on the trail
  lostMetres: 38,                   // this far from the trail line ...
  lostSeconds: 4,                   // ... for this long: back on the trail
  rescueAhead: 5,                   // samples (m) forward of the nearest point the rescue puts the rider
  ghostEvery: 0.25,                 // s between ghost samples
  searchBack: 25, searchAhead: 90,  // centre samples searched around the last known position
  viewpointRadius: 9,               // m: a viewpoint counts when the rider comes this close
  finishReach: 14,                  // m: the finish arch counts within this distance of the centre line
});

export const MEDAL_VALUE = Object.freeze({ none: 0, bronze: 1, silver: 2, gold: 3 });
export const MEDAL_NAME = Object.freeze(['none', 'bronze', 'silver', 'gold']);

/** Medal (0..3) for a time in ms against a medals table { gold, silver, bronze } in seconds. */
export function medalFor(ms, table) {
  if (!table || !Number.isFinite(ms)) return 0;
  const s = ms / 1000;
  return s <= table.gold ? 3 : s <= table.silver ? 2 : s <= table.bronze ? 1 : 0;
}

const hypot = Math.hypot;

export function createGame() {
  const g = {
    mode: 'card', kind: 'trail', trail: null, viewpoints: [], found: new Set(),
    timeMs: 0, countdown: 0, lastCount: 99,
    progress: 0, cpNext: 0, lastCp: 0, splits: [], bestSplits: [], bestMs: 0, ghostBestMs: 0,
    crashes: 0, rescues: 0, resets: 0, crashT: 0, stuckT: 0, lostT: 0, shield: 0,
    ghostT: 0, ghost: [], result: null,
  };
  const events = [];
  const pending = [];                 // events raised between two updates (a reset asked by the player)
  const emit = (e) => events.push(e);

  /** Local nearest centre index (windowed, global search when lost). */
  function nearest(trail, x, z, from) {
    const lo = Math.max(0, from - GAME.searchBack), hi = Math.min(trail.count - 1, from + GAME.searchAhead);
    let best = from, bd = 1e18;
    for (let i = lo; i <= hi; i++) { const d = (trail.centre[i][0] - x) ** 2 + (trail.centre[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    if (bd > 45 * 45) { for (let i = 0; i < trail.count; i++) { const d = (trail.centre[i][0] - x) ** 2 + (trail.centre[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } } }
    g.lastDist = Math.sqrt(bd);
    return best;
  }

  /** Lateral offset (m, + = right of travel) of a point from the centre line at index i. */
  function lateral(trail, i, x, z) {
    const a = trail.centre[Math.max(0, i - 1)], b = trail.centre[Math.min(trail.count - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = hypot(tx, tz) || 1;
    const rx = -tz / l, rz = tx / l;                      // right of travel (x east, z south)
    return (x - trail.centre[i][0]) * rx + (z - trail.centre[i][1]) * rz;
  }

  Object.assign(g, {
    /** Puts the trail on the start card. `info` = { bestMs, bestSplits, ghostMs, kind: 'trail' | 'daily' }. */
    showCard(trail, info = {}) {
      Object.assign(g, { mode: 'card', kind: info.kind || 'trail', trail, timeMs: 0, countdown: 0, lastCount: 99, progress: 0, cpNext: 0, lastCp: 0, splits: [], bestSplits: info.bestSplits || [], bestMs: info.bestMs || 0, ghostBestMs: info.ghostMs || 0,
        crashes: 0, rescues: 0, resets: 0, crashT: 0, stuckT: 0, lostT: 0, shield: 0, ghostT: 0, ghost: [], result: null });
    },
    /** From the card: 3 - 2 - 1 - Go. */
    begin() { if (g.mode !== 'card') return; g.mode = 'countdown'; g.countdown = GAME.countdownSeconds; g.lastCount = 99; },
    /** Free ride: no clock; viewpoints = [{ index, x, z, name }]. */
    startFree(trail, viewpoints, foundSet = new Set()) {
      Object.assign(g, { mode: 'free', kind: 'free', trail, viewpoints, found: new Set(foundSet), progress: 0, timeMs: 0, result: null, crashT: 0, shield: 0 });
    },
    /** The rider asked to go back on the trail (R key / button): the last checkpoint, the clock keeps running. */
    reset() {
      if (g.mode !== 'run' && g.mode !== 'free') return;
      g.resets++;
      pending.push({ type: 'respawn', index: g.mode === 'run' ? g.lastCp : g.progress, reason: 'reset' });
      g.crashT = 0; g.shield = PLAY.respawnShield;
    },
    /** One frame. `bike` = the physics state, `input` = { throttle, ... } (to tell "stuck" from "waiting"). Returns the events of this frame (the same array, cleared next call). */
    update(dt, bike, input = {}) {
      events.length = 0;
      for (const e of pending) events.push(e);
      pending.length = 0;
      if (g.shield > 0) g.shield = Math.max(0, g.shield - dt);
      const trail = g.trail;
      if (!trail) return events;
      if (g.mode === 'countdown') {
        g.countdown -= dt;
        const n = Math.ceil(g.countdown);
        if (n < g.lastCount && n >= 1) { g.lastCount = n; emit({ type: 'countdown', n }); }
        if (g.countdown <= 0) { g.mode = 'run'; g.timeMs = 0; g.ghostT = 0; g.shield = 0.8; emit({ type: 'go' }); }
        return events;
      }
      if (g.mode === 'free') {
        g.progress = nearest(trail, bike.x, bike.z, g.progress);
        for (let i = 0; i < g.viewpoints.length; i++) {
          if (g.found.has(i)) continue;
          const v = g.viewpoints[i];
          if (hypot(v.x - bike.x, v.z - bike.z) < GAME.viewpointRadius) { g.found.add(i); emit({ type: 'viewpoint', index: i, name: v.name, count: g.found.size, total: g.viewpoints.length }); }
        }
        if (bike.crashed) {
          g.crashT += dt;
          if (g.crashT >= PLAY.respawnTime) { g.crashT = 0; g.shield = PLAY.respawnShield; emit({ type: 'respawn', index: g.progress, reason: 'crash' }); }
        }
        return events;
      }
      if (g.mode !== 'run') return events;

      g.timeMs += dt * 1000;
      g.progress = nearest(trail, bike.x, bike.z, g.progress);
      const dist = g.lastDist;

      // soft crash: a tumble, then back at the last checkpoint
      if (bike.crashed) {
        if (g.crashT === 0) { g.crashes++; emit({ type: 'crash', cause: bike.crashed }); }
        g.crashT += dt;
        if (g.crashT >= PLAY.respawnTime) { g.crashT = 0; g.shield = PLAY.respawnShield; emit({ type: 'respawn', index: g.lastCp, reason: 'crash' }); }
        return events;
      }
      // pedalling without moving, or far from the trail: put the rider back (never frustrating)
      const speed = hypot(bike.vx, bike.vz);
      g.stuckT = (input.throttle || 0) > 0.3 && speed < 0.3 && bike.grounded ? g.stuckT + dt : 0;
      g.lostT = dist > GAME.lostMetres ? g.lostT + dt : 0;
      if (g.stuckT > GAME.stuckSeconds || g.lostT > GAME.lostSeconds) {
        g.stuckT = g.lostT = 0; g.rescues++; g.shield = PLAY.respawnShield;
        emit({ type: 'rescue', index: Math.min(trail.count - 1, g.progress + GAME.rescueAhead) });
        return events;
      }
      // checkpoints
      while (g.cpNext < trail.cps.length) {
        const cp = trail.cps[g.cpNext];
        const through = g.progress >= cp.index && g.progress <= cp.index + GAME.checkpointAlong && dist < 25;
        const near = hypot(bike.x - cp.x, bike.z - cp.z) < trail.checkpointRadius && Math.abs(g.progress - cp.index) < 30;
        if (!through && !near) break;
        const ms = g.timeMs;
        const best = g.bestSplits[g.cpNext];
        g.splits.push(ms);
        g.lastCp = cp.index;
        emit({ type: 'checkpoint', n: g.cpNext + 1, total: trail.cps.length, ms, delta: best ? ms - best : null });
        g.cpNext++;
      }
      // the ghost: arc length + lateral offset every ghostEvery seconds
      g.ghostT += dt;
      if (g.ghostT >= GAME.ghostEvery) {
        g.ghostT -= GAME.ghostEvery;
        g.ghost.push({ t: Math.round(g.timeMs), s: trail.s[g.progress], o: lateral(trail, g.progress, bike.x, bike.z) });
      }
      // the finish arch
      if (g.progress >= trail.arch.index && dist < GAME.finishReach) {
        const ms = Math.round(g.timeMs);
        g.mode = 'finished';
        g.ghost.push({ t: ms, s: trail.s[g.progress], o: lateral(trail, g.progress, bike.x, bike.z) });
        const medal = medalFor(ms, trail.medals);
        g.result = { ms, medal, isBest: g.bestMs === 0 || ms < g.bestMs, crashes: g.crashes, rescues: g.rescues, splits: [...g.splits], bestMs: g.bestMs, ghost: g.ghost, kind: g.kind, beatGhost: g.ghostBestMs > 0 && ms < g.ghostBestMs };
        emit({ type: 'finish', ...g.result });
      }
      return events;
    },
    /** What the next medal needs: { medal (1..3), seconds } or null when gold is won. */
    nextMedal(ms) {
      const t = g.trail && g.trail.medals;
      if (!t) return null;
      const s = ms / 1000;
      if (s > t.bronze) return { medal: 1, seconds: t.bronze };
      if (s > t.silver) return { medal: 2, seconds: t.silver };
      if (s > t.gold) return { medal: 3, seconds: t.gold };
      return null;
    },
  });
  return g;
}

/** Ghost samples ({ t, s, o }) -> world pose at time tMs on a trail: { x, z, heading } (the caller adds the height from the surface). */
export function poseOnTrail(trail, s, o) {
  const i = trail.indexAtS(Math.max(0, Math.min(trail.length, s)));
  const a = trail.centre[Math.max(0, i - 1)], b = trail.centre[Math.min(trail.count - 1, i + 1)];
  const tx = b[0] - a[0], tz = b[1] - a[1], l = hypot(tx, tz) || 1;
  const rx = -tz / l, rz = tx / l;
  return { x: trail.centre[i][0] + rx * o, z: trail.centre[i][1] + rz * o, heading: Math.atan2(tz, tx), index: i };
}
