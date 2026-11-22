#!/usr/bin/env node
/* Map clarity (22 Nov 2026): the piste map opened and closed over a free ride N times must not grow (Chromium CDP after a forced GC:
 * JS heap, DOM nodes, event listeners). Touch taps the iPad way: the minimap opens it, "Weiderfueren" closes it; each open also pans,
 * zooms (buttons + ◎ + ⤢) and taps the map once so the animation / overview / card paths run.
 *   node scripts/ski/map-memory.mjs [--resort killy] [--times 10]     (through browser-slot.py; exit 1 on growth) */
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const RID = opt("resort", "killy");
const TIMES = Number(opt("times", "10"));
const LIMIT = { heapMb: 6, nodes: 150, listeners: 60 };

const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
let fail = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${RID}`, { waitUntil: "domcontentloaded" });
  const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 240000 });
  await running();
  await page.waitForTimeout(6000);
  const measure = async () => {
    await cdp.send("HeapProfiler.collectGarbage"); await page.waitForTimeout(300); await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { heapMb: m.JSHeapUsedSize / 1048576, nodes: m.Nodes, listeners: m.JSEventListeners };
  };
  const cycle = async () => {
    const mm = await page.locator(".hud .minimap").boundingBox();
    await page.touchscreen.tap(mm.x + mm.width / 2, mm.y + mm.height / 2);
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const box = await page.locator("#mapCanvas").boundingBox();
    await page.click('[data-z="in"]'); await page.waitForTimeout(350);
    await page.click("#mapFit"); await page.waitForTimeout(350);
    await page.click("#mapMe"); await page.waitForTimeout(350);
    await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 360, box.y + 340, { steps: 4 }); await page.mouse.up();
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.45);
    await page.waitForTimeout(300);
    await page.click("#mapResume");
    await running();
    await page.waitForTimeout(300);
  };
  await cycle();                                     // warm up (first open builds caches, fonts, etc.)
  const before = await measure();
  for (let i = 0; i < TIMES; i++) await cycle();
  const after = await measure();
  const grow = { heapMb: after.heapMb - before.heapMb, nodes: after.nodes - before.nodes, listeners: after.listeners - before.listeners };
  const ok = grow.heapMb <= LIMIT.heapMb && grow.nodes <= LIMIT.nodes && grow.listeners <= LIMIT.listeners;
  console.log(`${RID}: map open/close x${TIMES}: heap ${before.heapMb.toFixed(1)} -> ${after.heapMb.toFixed(1)} MB (${grow.heapMb >= 0 ? "+" : ""}${grow.heapMb.toFixed(2)}), nodes ${before.nodes} -> ${after.nodes} (${grow.nodes >= 0 ? "+" : ""}${grow.nodes}), listeners ${before.listeners} -> ${after.listeners} (${grow.listeners >= 0 ? "+" : ""}${grow.listeners}), page errors ${errors.length}${errors.length ? ": " + errors[0] : ""}`);
  console.log(ok && !errors.length ? "PASS" : "FAIL");
  fail = !ok || errors.length > 0;
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
