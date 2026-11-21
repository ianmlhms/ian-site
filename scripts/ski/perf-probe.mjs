#!/usr/bin/env node
/* Developer tool: frame times, draw calls and triangles of a scripted run per graphics level, on the iPad profile of the flows
 * (1080x810, deviceScaleFactor 2, CPU throttled 4x).  node scripts/ski/perf-probe.mjs [--levels low,medium,high] [--piste id] [--resort rid] [--cpu 4]
 * [--remotes 7]: that many online-race skiers (pb/ski/net/remotes.js) ride along beside the player (the 8-player cost)
 * Run it through ~/Library/Caches/browser-slot.py (one browser at a time). Numbers are relative (the Mini's GPU is not an iPad's). */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const levels = opt("--levels", "low,medium,high").split(",");
const resort = opt("--resort", "");                        // default: the last / default resort (Espace Killy)
const piste = opt("--piste", resort ? "" : "coupe-du-monde");  // empty: the resort's start piste
const cpu = Number(opt("--cpu", "4"));
const remotes = Number(opt("--remotes", "0"));

// --gpu: the Mac's GPU (ANGLE Metal), as the look shots; the dynamic resolution (post.js) is reported as the average internal pixel ratio
const browser = await launchBrowser({ fullChromium: true, args: args.includes("--gpu") ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
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
    if (remotes > 0) await page.evaluate(async (n) => {
      const { createRemotes, packState } = await import("/pb/ski/net/remotes.js");
      const S = window.__ski, R = createRemotes({ scene: S.scene, camera: S.camera, surface: S.surface, overlay: document.getElementById("ui") });
      for (let i = 0; i < n; i++) R.add(`r${i}`, `Skier ${i + 1}`, ["rout", "blo", "giel", "greng", "rosa", "schwaarz"][i % 6]);
      const tick = () => {                                   // they ride beside / ahead of the player, a new state 12 times a second
        const s = S.state, now = performance.now();
        if (s && now - (tick.last || 0) > 83) {
          tick.last = now;
          for (let i = 0; i < n; i++) {
            const side = (i % 2 ? 1 : -1) * (2 + Math.floor(i / 2) * 2), ahead = 4 + i * 2.5;
            const fx = Math.cos(s.heading), fz = Math.sin(s.heading);
            R.push(`r${i}`, 0, now, packState({ ...s, x: s.x + fx * ahead - fz * side, z: s.z + fz * ahead + fx * side }, 0, false));
          }
        }
        R.update(now, now / 1000, innerWidth, innerHeight);
        requestAnimationFrame(tick);
      };
      tick();
      window.__remotesProbe = R;
    }, remotes);
    await page.evaluate(() => window.__ski.post.resetStats());
    const samples = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(2500);
      samples.push(await page.evaluate(() => ({ ...window.__ski.info(), fr: window.__ski.frames() })));
    }
    const p50 = samples.map((s) => s.fr.p50).sort((a, b) => a - b)[2], p95 = Math.max(...samples.map((s) => s.fr.p95));
    const calls = Math.max(...samples.map((s) => s.calls)), tris = Math.max(...samples.map((s) => s.triangles));
    const res = await page.evaluate(() => window.__ski.resolution());
    console.log(`${q.padEnd(6)} resolution: average ${res.average}x (now ${res.ratio}x = ${res.width}x${res.height}, MSAA ${res.samples}, screen ${res.screen}x, ${res.changes} changes, frame ema ${res.frameEma} ms, js ${res.cpuEma} ms)`);
    console.log(`${q.padEnd(6)} running after ${tRun.toFixed(1)} s | frame p50 ${p50.toFixed(1)} ms p95 ${p95.toFixed(1)} ms | draw calls <= ${calls} | triangles <= ${(tris / 1000).toFixed(0)}k | cards ${samples[3].cards} trees ${samples[3].trees} | level now ${samples[3].level}${remotes ? ` | ${remotes} remote skiers (${await page.evaluate(() => window.__remotesProbe.all().filter((r) => r.model.root.visible).length)} drawn)` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
