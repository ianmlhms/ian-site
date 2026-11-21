#!/usr/bin/env node
/* Developer tool: frame times, draw calls and triangles of a scripted run per graphics level, on the iPad profile of the flows
 * (1080x810, deviceScaleFactor 2, CPU throttled 4x).  node scripts/ski/perf-probe.mjs [--levels low,medium,high] [--piste id] [--resort rid] [--cpu 4]
 * Run it through ~/Library/Caches/browser-slot.py (one browser at a time). Numbers are relative (the Mini's GPU is not an iPad's). */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const levels = opt("--levels", "low,medium,high").split(",");
const resort = opt("--resort", "");                        // default: the last / default resort (Espace Killy)
const piste = opt("--piste", resort ? "" : "coupe-du-monde");  // empty: the resort's start piste
const cpu = Number(opt("--cpu", "4"));

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  for (const q of levels) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const t0 = Date.now();
    await page.goto(`${origin}/pb/ski.html?auto=1&bot=1&debug=1&q=${q}&weather=sun&time=midday${piste ? `&piste=${piste}` : ""}${resort ? `&resort=${resort}` : ""}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
    const tRun = (Date.now() - t0) / 1000;
    await page.waitForTimeout(6000);
    const samples = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(2500);
      samples.push(await page.evaluate(() => ({ ...window.__ski.info(), fr: window.__ski.frames() })));
    }
    const p50 = samples.map((s) => s.fr.p50).sort((a, b) => a - b)[2], p95 = Math.max(...samples.map((s) => s.fr.p95));
    const calls = Math.max(...samples.map((s) => s.calls)), tris = Math.max(...samples.map((s) => s.triangles));
    console.log(`${q.padEnd(6)} running after ${tRun.toFixed(1)} s | frame p50 ${p50.toFixed(1)} ms p95 ${p95.toFixed(1)} ms | draw calls <= ${calls} | triangles <= ${(tris / 1000).toFixed(0)}k | cards ${samples[3].cards} trees ${samples[3].trees} | level now ${samples[3].level}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
