/* Flow: MTB Mëllerdall Grafik levels (28 Nov 2026; the fix Ski Alpen got the same day: a school iPad dropped a picked "Héich" to "Niddreg" by itself).
 *  1. Héich picked by hand in the settings stays Héich for 40 s under forced slow frames (window.__mtb.slow(ms): every judged frame +ms, a
 *     GPU-bound device simulated): never a level change, at most one small hint.
 *  2. A reload keeps the pick (Héich, manual).
 *  3. Automatesch under the same slow frames steps down ONE level at a time (Héich -> Mëttel -> Niddreg, a gap between the steps), and
 *     back up when the frames are fine again.
 *  Zero page errors. Chromium only (WebKit untested while Playwright WebKit is broken on this Mac). Shots into $QUALITY_SHOTS. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const SHOTS = process.env.QUALITY_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/quality/mtb-flow");
const SLOW_MS = 30;          // +30 ms a frame: ~21 fps on a 60 Hz screen, ~16 fps under a 30 fps cap: slow at every level
const PAGE = "/pb/mtb.html?debug=1&time=noon&weather=clear";      // no ?q=: the real Grafik logic

export const flow = {
  name: "mtb-quality",
  fullChromium: true,
  measuresFrames: true,                 // real frame rate (the controller learns the display's beat)
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem("flowQualityInit")) return;              // once: the reload must find the pick of before
        sessionStorage.setItem("flowQualityInit", "1");
        for (const k of ["arcade_gfx", "pb_mtb_gfx_auto"]) localStorage.removeItem(k);
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const q = () => page.evaluate(() => window.__mtb.gfx());
    const ready = () => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 150000 });
    const ride = async () => {
      await ready();
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
      await page.evaluate(() => window.__mtb.startFree());
      await page.waitForFunction(() => window.__mtb.game.mode === "free", null, { timeout: 15000 });
    };
    const pick = async (v) => {
      await page.evaluate(() => window.__mtb.openMenu("settings"));
      await page.selectOption('select[data-set="quality"]', v);
      h.eq(await page.$eval('select[data-set="quality"]', (e) => e.value), v, `the settings show ${v} picked`);
      await page.evaluate(() => window.__mtb.closeMenu());
    };
    /** Watches the level for `seconds`, sampling every 0.5 s; returns the distinct levels in order + the last stats. */
    const watch = async (seconds, until = null) => page.evaluate(async ([seconds, until]) => {
      const seen = [], t0 = performance.now();
      let last = null;
      while (performance.now() - t0 < seconds * 1000) {
        last = window.__mtb.gfx();
        if (!seen.length || seen[seen.length - 1].level !== last.level) seen.push({ level: last.level, at: +((performance.now() - t0) / 1000).toFixed(1) });
        if (until && last.level === until) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      return { seen, last };
    }, [seconds, until]);

    h.step("free ride, no ?q=: pick Héich in the settings (Grafik)");
    await h.goto(PAGE);
    await ride();
    await page.waitForTimeout(1500);
    await pick("high");
    let s = await q();
    h.expect(s.level === "high" && s.manual && s.choice === "high", `Héich, manual (${JSON.stringify({ level: s.level, manual: s.manual, choice: s.choice })})`);
    console.log(`    display beat ${s.beat} ms, target ${s.target} ms`);

    h.step(`40 s of forced slow frames (+${SLOW_MS} ms each): Héich stays Héich`);
    await page.evaluate((ms) => window.__mtb.slow(ms), SLOW_MS);
    const manualRun = await watch(40);
    h.eq(manualRun.seen.map((x) => x.level), ["high"], `the level over 40 s (${JSON.stringify(manualRun.seen)})`);
    const hint = await page.evaluate(() => document.documentElement.dataset.mtbGfxHint || "");
    console.log(`    hint: ${hint || "none"}; median ${manualRun.last.median} ms`);
    h.expect(hint === "" || hint === "high", `at most the one hint, never a switch (hint ${hint || "none"})`);
    h.eq(await page.evaluate(() => window.__mtb.quality.id), "high", "the renderer still runs Héich");
    await page.screenshot({ path: path.join(SHOTS, "manual-high-after-40s.chromium.png") });
    await page.evaluate(() => window.__mtb.slow(0));

    h.step("reload: the pick is kept");
    await page.reload();
    await ride();
    s = await q();
    h.expect(s.level === "high" && s.manual && s.choice === "high", `after the reload: Héich, manual (${s.level}, ${s.choice})`);
    h.expect(!s.recoveredFrom, `a clean reload is no crash recovery (${s.recoveredFrom})`);

    h.step("crash recovery (WebGL context lost while riding): the next load runs ONE level lower, the pick itself stays Héich");
    await page.evaluate(() => sessionStorage.setItem("pb_mtb_gfx_recover", "1"));
    await page.reload();
    await ride();
    s = await q();
    h.expect(s.level === "medium" && s.recoveredFrom === "high" && s.choice === "high", `Mëttel for this load only (${s.level}, from ${s.recoveredFrom}, pick ${s.choice})`);
    await page.reload();
    await ride();
    s = await q();
    h.expect(s.level === "high" && !s.recoveredFrom, `the next load is Héich again (${s.level})`);

    h.step("Automatesch, slow frames: one level at a time, Héich -> Mëttel -> Niddreg");
    await pick("auto");
    s = await q();
    h.expect(s.choice === "auto" && !s.manual && s.level === "high", `Automatesch goes on from Héich (${s.level})`);
    await page.evaluate((ms) => window.__mtb.slow(ms), SLOW_MS);
    const autoDown = await watch(70, "low");
    h.eq(autoDown.seen.map((x) => x.level), ["high", "medium", "low"], `steps ${JSON.stringify(autoDown.seen)}`);
    const step1 = autoDown.seen[1]?.at ?? 0, step2 = autoDown.seen[2]?.at ?? 0;
    h.expect(step1 >= 4, `the first step only after sustained slow frames (${step1} s)`);
    h.expect(step2 - step1 >= 7.5, `a gap between the two steps (${(step2 - step1).toFixed(1)} s)`);
    h.eq(await page.evaluate(() => window.__mtb.quality.id), "low", "the renderer runs Niddreg");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_mtb_gfx_auto")), "low", "where Automatesch settled is remembered");
    await page.screenshot({ path: path.join(SHOTS, "auto-low.chromium.png") });

    h.step("frames fine again: Automatesch steps back up (one level)");
    await page.evaluate(() => window.__mtb.slow(0));
    const autoUp = await watch(90, "medium");
    console.log(`    up: ${JSON.stringify(autoUp.seen)}; median ${autoUp.last.median} ms, good for ${autoUp.last.goodFor} s`);
    h.eq(autoUp.seen.map((x) => x.level).slice(0, 2), ["low", "medium"], "back up to Mëttel");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
