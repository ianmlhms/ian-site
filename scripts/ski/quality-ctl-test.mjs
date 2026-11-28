#!/usr/bin/env node
/* The Grafik level controller (pb/ski/quality-ctl.js) in Node, simulated clock: a manual pick never changes; Automatesch steps one
 * level at a time with hysteresis and back up; 60 Hz / 120 Hz / a 30 fps cap; the grace after a load. node scripts/ski/quality-ctl-test.mjs */
import { createQualityControl, QCTL } from "../../pb/gfx-ctl/quality-ctl.js";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };

/** Runs `seconds` of frames of `ms` each (a function of t allowed) through the controller; returns the events. */
function run(ctl, clock, seconds, ms, opts = {}, onEvent = null) {
  const events = [];
  const end = clock.t + seconds * 1000;
  while (clock.t < end) {
    const f = typeof ms === "function" ? ms(clock.t) : ms;
    clock.t += f;
    const lim = typeof opts.limited === "function" ? opts.limited() : opts.limited ?? true;
    const ev = ctl.frame(f, { limited: lim, atTop: opts.atTop ?? false });
    if (ev) { events.push({ ...ev, at: clock.t }); if (onEvent) onEvent(ev); }
  }
  return events;
}
const make = (level, manual, beatFrames = 16.7) => {
  const clock = { t: 0 };
  const ctl = createQualityControl({ level, manual, now: () => clock.t });
  for (let i = 0; i < 60; i++) ctl.idleFrame(beatFrames);          // the loading screen
  ctl.settle(5000);                                                 // the game settles after the load
  return { ctl, clock };
};

// 1. manual Héich, frames at 40 ms (25 fps) for 60 s: never a change, one hint
{
  const { ctl, clock } = make("high", true);
  const ev = run(ctl, clock, 60, 40);
  ok(!ev.some((e) => e.type !== "hint"), `manual Héich at 40 ms for 60 s: no level change (${JSON.stringify(ev.map((e) => e.type))})`);
  ok(ev.filter((e) => e.type === "hint").length === 1, "manual Héich: exactly one hint");
  ok(ctl.level === "high", "manual Héich stays Héich");
}
// 2. manual Niddreg slow: no hint (nothing lower to suggest but Automatesch, which can't go lower either)
{
  const { ctl, clock } = make("low", true);
  ok(run(ctl, clock, 30, 60).length === 0, "manual Niddreg slow: no event");
}
// 3. Automatesch Héich at 33 ms on a 60 Hz screen: one step at a time, never straight to Niddreg, with a gap between
{
  const { ctl, clock } = make("high", false);
  let level = "high";
  const ev = run(ctl, clock, 40, 33.3, {}, (e) => { level = e.level; ctl.setLevel(e.level); });
  ok(ev.length === 2 && ev[0].level === "medium" && ev[1].level === "low", `Automatesch steps high -> medium -> low (${ev.map((e) => e.level)})`);
  ok(ev[0].at / 1000 >= 5 + QCTL.DOWN_AFTER_S - 0.1 && ev[0].at / 1000 < 14, `first step after ${(ev[0].at / 1000).toFixed(1)} s (grace + 4 s sustained)`);
  ok(ev[1] && (ev[1].at - ev[0].at) / 1000 >= QCTL.MIN_GAP_S, `second step ${(((ev[1]?.at ?? 0) - ev[0].at) / 1000).toFixed(1)} s after the first (>= ${QCTL.MIN_GAP_S})`);
  ok(level === "low", "ends on Niddreg");
}
// 4. short spikes do not step down (2 s of 40 ms frames every 10 s)
{
  const { ctl, clock } = make("high", false);
  const ev = run(ctl, clock, 60, (t) => ((t / 1000) % 10 < 2 ? 40 : 16.7));
  ok(ev.length === 0, `2 s spikes every 10 s: no step (${ev.map((e) => e.level)})`);
}
// 5. resolution can still help (not limited): no level step
{
  const { ctl, clock } = make("high", false);
  ok(run(ctl, clock, 30, 33.3, { limited: false }).length === 0, "slow but the resolution can still go down: no level step");
}
// 6. a 30 fps cap (iOS Low Power Mode): 33 ms is on the beat, no step down; and it may step up at the ceiling
{
  const clock = { t: 0 };
  const ctl = createQualityControl({ level: "medium", manual: false, now: () => clock.t });
  for (let i = 0; i < 200; i++) ctl.idleFrame(33.3);
  ok(Math.round(ctl.beat) === 33, `beat learnt as 30 fps (${ctl.beat.toFixed(1)} ms)`);
  const ev = run(ctl, clock, 40, 33.4, { atTop: true }, (e) => ctl.setLevel(e.level));
  ok(ev.length === 1 && ev[0].type === "up" && ev[0].level === "high", `30 fps cap at 33 ms: no step down, one step up (${JSON.stringify(ev.map((e) => e.type + ":" + e.level))})`);
  const ev2 = run(ctl, clock, 30, 50, {}, (e) => ctl.setLevel(e.level));
  ok(ev2.length >= 1 && ev2[0].level === "medium", `30 fps cap at 50 ms (20 fps): one step down (${ev2.map((e) => e.level)})`);
}
// 7. 120 Hz: the target stays 60 fps; 16.7 ms frames are fine, 25 ms are slow
{
  const clock = { t: 0 };
  const ctl = createQualityControl({ level: "high", manual: false, now: () => clock.t });
  for (let i = 0; i < 60; i++) ctl.idleFrame(8.3);
  ok(Math.round(ctl.beat) === 8 && Math.round(ctl.target) === 17, `120 Hz: beat ${ctl.beat.toFixed(1)} ms, target ${ctl.target.toFixed(1)} ms`);
  ok(run(ctl, clock, 30, 16.7).length === 0, "120 Hz at 60 fps: no step");
  const ev = run(ctl, clock, 20, 25, {}, (e) => ctl.setLevel(e.level));
  ok(ev.length >= 1 && ev[0].level === "medium", "120 Hz at 40 fps: one step down");
}
// 8. back up with headroom, and a failed step up waits longer before the next try
{
  const { ctl, clock } = make("low", false);
  let level = "low";
  const apply = (e) => { level = e.level; ctl.setLevel(e.level); };
  const up = run(ctl, clock, 30, 16.7, { atTop: true }, apply);
  ok(up.length >= 1 && up[0].level === "medium", `headroom: steps up low -> medium (${up.map((e) => e.level)})`);
  // medium is too much right away: back down within 30 s -> retry of medium waits >= 60 s
  const down = run(ctl, clock, 15, 33.3, {}, apply);
  ok(down.length === 1 && down[0].level === "low", `medium too slow: back to low (${down.map((e) => e.level)})`);
  const quick = run(ctl, clock, 40, 16.7, { atTop: true }, apply);
  ok(quick.length === 0, `no new try within the retry wait (${quick.map((e) => e.level)})`);
  const later = run(ctl, clock, 40, 16.7, { atTop: true }, apply);
  ok(later.length >= 1 && later[0].level === "medium", `tries again after the wait (${later.map((e) => e.level)})`);
}
// 9. grace: settle() hides a burst after a teleport
{
  const { ctl, clock } = make("high", false);
  run(ctl, clock, 10, 16.7);
  ctl.settle(5000);
  const ev = run(ctl, clock, 4.5, 60);
  ok(ev.length === 0 && ctl.stats().slowFor === 0, "slow frames inside the grace are not judged");
}
// 10. hitches over 250 ms are ignored
{
  const { ctl, clock } = make("high", false);
  ok(run(ctl, clock, 30, (t) => ((t / 1000) % 1 < 0.3 ? 400 : 16.7)).length === 0, "hitches (400 ms) are not the steady state");
}
console.log(fails ? `${fails} FAILED` : "all ok");
process.exit(fails ? 1 : 0);
