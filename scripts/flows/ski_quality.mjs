/* Flow: Ski Alpen Grafik levels (28 Nov 2026; Ian, school iPad: "I pick Héich and within ~20 s it drops to Niddreg by itself").
 *  1. Héich picked by hand in the pause menu stays Héich for 60 s under forced slow frames (window.__ski.slow(ms): every judged frame
 *     +ms, a GPU-bound device simulated): never a level change, at most one small hint.
 *  2. A reload keeps the pick (Héich, manual).
 *  3. Automatesch under the same slow frames steps down ONE level at a time (Héich -> Mëttel -> Niddreg, a gap between the steps), and
 *     back up when the frames are fine again.
 *  Zero page errors. FLOW_BROWSER=webkit for Safari's engine. Shots into $QUALITY_SHOTS (default ~/Library/Caches/ski-work/quality/flow). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const SHOTS = process.env.QUALITY_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/quality/flow");
const SLOW_MS = 30;          // +30 ms a frame: ~21 fps on a 60 Hz screen, ~16 fps under a 30 fps cap: slow at every level

export const flow = {
  name: "ski-quality",
  fullChromium: true,
  measuresFrames: true,                 // real frame rate (the controller learns the display's beat)
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    fs.mkdirSync(SHOTS, { recursive: true });
    const engine = process.env.FLOW_BROWSER || "chromium";
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem("flowQualityInit")) return;              // once: the reload must find the pick of before
        sessionStorage.setItem("flowQualityInit", "1");
        for (const k of ["arcade_gfx", "pb_ski_gfx_auto", "pb_ski_save"]) localStorage.removeItem(k);
        localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const q = () => page.evaluate(() => window.__ski.gfx());
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 150000 });
    const pick = async (v) => {
      await page.keyboard.press("Escape");
      await page.waitForSelector("#menuCard");
      await page.click(`#mGfx [data-v="${v}"]`);
      h.eq(await page.$eval("#mGfx .on", (b) => b.dataset.v), v, `pause menu shows ${v} picked`);
      await page.click('#menuCard [data-a="resume"]');
      await page.waitForFunction(() => !document.getElementById("menuCard") && !window.__ski.game.paused, null, { timeout: 10000 });
    };
    /** Watches the level for `seconds`, sampling every 0.5 s; returns the distinct levels in order + the last stats. */
    const watch = async (seconds, until = null) => page.evaluate(async ([seconds, until]) => {
      const seen = [], t0 = performance.now();
      let last = null;
      while (performance.now() - t0 < seconds * 1000) {
        last = window.__ski.gfx();
        if (!seen.length || seen[seen.length - 1].level !== last.level) seen.push({ level: last.level, at: +((performance.now() - t0) / 1000).toFixed(1) });
        if (until && last.level === until) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      return { seen, last };
    }, [seconds, until]);

    h.step("Killy free ride, no ?q=: pick Héich in the pause menu (Grafik)");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1");
    await running();
    await page.waitForTimeout(1500);
    await pick("high");
    let s = await q();
    h.expect(s.level === "high" && s.manual && s.choice === "high", `Héich, manual (${JSON.stringify({ level: s.level, manual: s.manual, choice: s.choice })})`);
    console.log(`    display beat ${s.beat} ms, target ${s.target} ms, budget ${s.budget} ms`);

    h.step(`60 s of forced slow frames (+${SLOW_MS} ms each): Héich stays Héich`);
    await page.evaluate((ms) => window.__ski.slow(ms), SLOW_MS);
    const manualRun = await watch(60);
    h.eq(manualRun.seen.map((x) => x.level), ["high"], `the level over 60 s (${JSON.stringify(manualRun.seen)})`);
    const hint = await page.evaluate(() => document.documentElement.dataset.skiGfxHint || "");
    console.log(`    hint: ${hint || "none"}; resolution ${manualRun.last.res.ratio}x (floor of Héich), median ${manualRun.last.median} ms`);
    h.expect(hint === "" || hint === "high", `at most the one hint, never a switch (hint ${hint || "none"})`);
    h.expect(manualRun.last.res.ratio <= 1.5 + 1e-3, `the dynamic resolution still does its part within Héich (${manualRun.last.res.ratio}x)`);
    await page.screenshot({ path: path.join(SHOTS, `manual-high-after-60s.${engine}.png`) });
    await page.evaluate(() => window.__ski.slow(0));

    h.step("reload: the pick is kept");
    await page.reload();
    await running();
    s = await q();
    h.expect(s.level === "high" && s.manual && s.choice === "high", `after the reload: Héich, manual (${s.level}, ${s.choice})`);
    h.expect(!s.recoveredFrom, `a clean reload is no crash recovery (${s.recoveredFrom})`);

    h.step("Automatesch, slow frames: one level at a time, Héich -> Mëttel -> Niddreg");
    await pick("auto");
    s = await q();
    h.expect(s.choice === "auto" && !s.manual && s.level === "high", `Automatesch goes on from Héich (${s.level})`);
    await page.evaluate((ms) => window.__ski.slow(ms), SLOW_MS);
    const autoDown = await watch(70, "low");
    const levels = autoDown.seen.map((x) => x.level);
    h.eq(levels, ["high", "medium", "low"], `steps ${JSON.stringify(autoDown.seen)}`);
    const step1 = autoDown.seen[1]?.at ?? 0, step2 = autoDown.seen[2]?.at ?? 0;
    h.expect(step1 >= 4, `the first step only after sustained slow frames (${step1} s)`);
    h.expect(step2 - step1 >= 7.5, `a gap between the two steps (${(step2 - step1).toFixed(1)} s)`);
    await page.screenshot({ path: path.join(SHOTS, `auto-low.${engine}.png`) });

    h.step("frames fine again: Automatesch steps back up (one level)");
    await page.evaluate(() => window.__ski.slow(0));
    const autoUp = await watch(90, "medium");
    s = autoUp.last;
    console.log(`    up: ${JSON.stringify(autoUp.seen)}; resolution ${s.res.ratio}x, median ${s.median} ms, good for ${s.goodFor} s`);
    h.eq(autoUp.seen.map((x) => x.level).slice(0, 2), ["low", "medium"], "back up to Mëttel");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
