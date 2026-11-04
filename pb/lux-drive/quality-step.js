/* The quality auto-step of Lux Drive (like the MTB game's, with a way back up).
 *
 * The game starts at the quality the player chose (or the one picked for the device); `max` is that choice and the step never
 * goes above it.  Frames are timed with a running average: when the average stays slow the quality drops one level, and when
 * it has been fast for a long time it may climb one level again - but never to a level that has already been too slow for
 * this device in this session (that would oscillate).  Pure logic, no THREE: the caller applies the level it is told. */
const LEVELS = ['low', 'medium', 'high'];
const SLOW_MS = 27;                 // an average frame slower than this (about 37 fps) is slow ...
const SLOW_SECONDS = 2.0;           // ... when it lasts this long
const VERY_SLOW_MS = 43;            // an average frame slower than this (under 23 fps) counts double: a very slow game must not wait
                                    // 8 s for two steps down
const FAST_MS = 15;                 // an average frame faster than this (about 66 fps) is fast ...
const FAST_SECONDS = 25;            // ... when it lasts this long
const SETTLE_SECONDS = 1.5;         // after the start the first frames are not timed: the tiles are building
const STEP_SETTLE_SECONDS = 1.0;    // ... and after a change of the level (the renderer rebuilds, the next frames hitch anyway)
const HITCH_S = 0.25;               // a frame longer than this is a hitch (a background tab, a teleport), not a trend
const SMOOTHING = 0.06;             // the weight of a new frame in the running average

/** @param {{ initial: string, max?: string, enabled?: boolean }} options */
export function createQualityStepper({ initial, max = initial, enabled = true }) {
  if (!LEVELS.includes(initial) || !LEVELS.includes(max)) throw new Error(`quality-step: unknown level "${initial}" / "${max}"`);
  let level = initial, ceiling = max;
  let avgMs = 16, slowFor = 0, fastFor = 0, settle = SETTLE_SECONDS;
  const failed = new Set();         // the levels that were too slow on this device

  return {
    get level() { return level; },
    get max() { return ceiling; },
    get averageMs() { return avgMs; },
    /** The player chose a quality: it becomes the new ceiling (and the current level). */
    choose(id) {
      if (!LEVELS.includes(id)) throw new Error(`quality-step: unknown level "${id}"`);
      level = id; ceiling = id; failed.clear(); slowFor = fastFor = 0; settle = SETTLE_SECONDS;
    },
    /** Call every frame with the frame time in seconds. Returns the new level when it changes, else null. */
    frame(dt) {
      if (!enabled || dt > HITCH_S) { settle = Math.max(settle, 0.5); return null; }
      if (settle > 0) { settle -= dt; return null; }
      avgMs += (dt * 1000 - avgMs) * SMOOTHING;
      if (avgMs > SLOW_MS) { slowFor += dt * (avgMs > VERY_SLOW_MS ? 2 : 1); fastFor = 0; } else if (avgMs < FAST_MS) { fastFor += dt; slowFor = 0; } else { slowFor = Math.max(0, slowFor - dt); fastFor = 0; }
      if (slowFor >= SLOW_SECONDS && level !== LEVELS[0]) {
        failed.add(level);
        level = LEVELS[LEVELS.indexOf(level) - 1];
        slowFor = fastFor = 0; settle = STEP_SETTLE_SECONDS; avgMs = Math.max(avgMs, SLOW_MS);       // still slow: the next step down does not start from a fast average
        return level;
      }
      if (fastFor >= FAST_SECONDS) {
        const up = LEVELS[LEVELS.indexOf(level) + 1];
        fastFor = 0;
        if (up && LEVELS.indexOf(up) <= LEVELS.indexOf(ceiling) && !failed.has(up)) { level = up; settle = STEP_SETTLE_SECONDS; avgMs = 16; return level; }
      }
      return null;
    },
  };
}
