/* Flow: MTB Mëllerdall "smooth". The reference rider rides the Hallerbach-Flow for 30 s in the LIVE game loop (real requestAnimationFrame, real rendering) and every frame time is
 * recorded. After the first 3 s nothing may stall: terrain tiles, forest rebuilds, rock / prop updates and first-use shader compiles are all spread or pre-warmed, so a ride has no
 * hitch (before the fix: a 45-80 ms freeze every ~4 m of riding, from the terrain stitch scan).
 * Headless timing is noisy (video recording, other processes), so the gate is loose: no frame over 40 ms (a failing ride is repeated once), plus p99 and the slowest game callback
 * are reported and bounded. The old code had dozens of 45-80 ms frames in 30 s. */
import { runIfMain } from "./lib.mjs";

const WARM_S = 3;
const MAX_FRAME_MS = 40;
const MAX_CALLBACK_MS = 30;
const P99_MS = 34;
const RIDE = (q) => `/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&season=summer&mode=free&trail=hallerbach-flow`;
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });

/** Rides `seconds` s with the bot and returns { frames, p50, p99, max, over25, over40, jsMax, odo, speed } (after the warm-up). */
async function ride(page, seconds) {
  return page.evaluate(async ({ seconds, warm }) => {
    const { createBot } = await import("/pb/mtb/bot.js");
    const m = window.__mtb, t = m.trail;
    const bot = createBot(t.centre, t.grade, { speedScale: 0.55 });
    const js = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((now) => { const t0 = performance.now(); cb(now); js.push([now, performance.now() - t0]); });
    const gaps = [];
    let prev = 0, start = 0, vmax = 0;
    await new Promise((resolve) => {
      const tick = (now) => {
        if (!start) start = now;
        if (prev) gaps.push([(now - start) / 1000, now - prev]);
        prev = now;
        vmax = Math.max(vmax, Math.hypot(m.bike.vx, m.bike.vz) * 3.6);
        m.setInput(bot.input(m.bike));
        if ((now - start) / 1000 >= seconds) resolve(); else raf(tick);
      };
      raf(tick);
    });
    window.requestAnimationFrame = raf;
    m.setInput(null);
    const d = gaps.filter(([s]) => s >= warm).map(([, g]) => g).sort((a, b) => a - b);
    const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    const jsMax = Math.max(0, ...js.filter(([n]) => (n - start) / 1000 >= warm).map(([, x]) => x));
    return { frames: d.length, p50: q(0.5), p99: q(0.99), max: d[d.length - 1], over25: d.filter((x) => x > 25).length, over40: d.filter((x) => x > 40).length, jsMax: +jsMax.toFixed(1), odo: m.bike.odometer, vmax: +vmax.toFixed(0) };
  }, { seconds, warm: WARM_S });
}

export const flow = {
  name: "mtb-smooth",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    for (const [q, seconds] of [["medium", 30], ["low", 15]]) {
      h.step(`${q} quality: the reference rider rides the Hallerbach-Flow for ${seconds} s in the live loop, every frame is timed`);
      await h.goto(RIDE(q));
      await ready(page);
      let r = await ride(page, seconds);
      if (r.max > MAX_FRAME_MS) {                                  // headless timing is noisy: one repeat before it counts
        console.log(`    (retry: first ride max ${r.max.toFixed(1)} ms)`);
        await h.goto(RIDE(q));
        await ready(page);
        r = await ride(page, seconds);
      }
      console.log(`    ${q}: ${r.frames} frames, p50 ${r.p50.toFixed(1)} ms, p99 ${r.p99.toFixed(1)} ms, max ${r.max.toFixed(1)} ms, ${r.over25} frames > 25 ms, ${r.over40} > 40 ms, slowest game callback ${r.jsMax} ms, ${r.odo.toFixed(0)} m ridden, top ${r.vmax} km/h`);
      h.expect(r.odo > seconds * 5, `the bot really rode (${r.odo.toFixed(0)} m in ${seconds} s)`);
      h.expect(r.max <= MAX_FRAME_MS, `${q}: no frame over ${MAX_FRAME_MS} ms after the ${WARM_S} s warm-up (max ${r.max.toFixed(1)} ms, ${r.over25} frames over 25 ms)`);
      h.expect(r.p99 <= P99_MS, `${q}: p99 frame time ${r.p99.toFixed(1)} ms (<= ${P99_MS} ms)`);
      h.expect(r.jsMax <= MAX_CALLBACK_MS, `${q}: the slowest game frame callback took ${r.jsMax} ms (<= ${MAX_CALLBACK_MS} ms of main-thread work)`);
    }
    h.eq(errors, [], "zero console errors");
  },
};

runIfMain(import.meta.url, flow);
