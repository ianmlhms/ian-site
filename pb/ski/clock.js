/* The frame clock of the game loop (pure, no DOM): how much game time one drawn frame advances and how many fixed physics steps that is.
 * Launch fix (22 Nov 2026, Ian on an iPad 9: "you can't get faster than like 32 km/h"): the loop used to clamp a frame to 0.05 s and
 * at most 6 steps of SKI.dt, so below 20 fps the whole game ran slow (15 fps: 0.75 x real time, 12 fps: 0.6 x: the skier, the
 * snow and the timer crawled). Now a frame advances real time down to 10 fps (MAX_FRAME_S); only a longer hitch is clamped. */
import { SKI } from './config.js';

export const MAX_FRAME_S = 0.1;                                    // s: the longest frame that still advances real time (10 fps)
export const MAX_STEPS = Math.ceil(MAX_FRAME_S / SKI.dt - 1e-9);     // fixed physics steps one frame may take (12 at 1/120 s)

/** The game time of a frame of rawDt seconds (clamped: a hitch or a tab coming back never jumps the game). */
export const frameSeconds = (rawDt) => (rawDt > 0 ? Math.min(MAX_FRAME_S, rawDt) : 0);

/** One frame of the fixed-step accumulator: acc (s) + this frame's game time -> { steps, acc } (the leftover, < one step). */
export function planSteps(acc, dt, timescale = 1) {
  let left = acc + dt * timescale, steps = 0;
  const cap = MAX_STEPS * timescale;
  while (left >= SKI.dt && steps < cap) { left -= SKI.dt; steps++; }
  if (left > SKI.dt * cap) left = 0;
  return { steps, acc: left };
}
