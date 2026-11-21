#!/usr/bin/env node
/* Developer tool: open Ski Alpen headless, wait, optionally run JS, save screenshots.
 *   node scripts/ski/shot.mjs OUT_PREFIX [--url "/pb/ski.html?auto=1&bot=1&debug=1&q=high"] [--size 1280x720] [--until running|ready|map]
 *        [--eval "js"] [--at 1500,6000,12000] (ms after "until", one PNG each: OUT_PREFIX-<ms>.png)
 * Uses the flow harness (local static server, full Chromium). Run it through ~/Library/Caches/browser-slot.py (one browser at a time). */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const url = opt("--url", "/pb/ski.html?auto=1&bot=1&debug=1&q=high&weather=sun&time=midday");
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const until = opt("--until", "running");
const evalJs = opt("--eval", "");
const at = opt("--at", "3000").split(",").map(Number);

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("[page]", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  const t0 = Date.now();
  await page.goto(origin + url, { waitUntil: "domcontentloaded" });
  const cond = { running: "document.documentElement.dataset.skiRunning === '1'", ready: "document.documentElement.dataset.skiReady === '1'", map: "document.documentElement.dataset.skiScreen === 'map'" }[until];
  await page.waitForFunction(`(${cond}) || !!document.documentElement.dataset.bootError`, null, { timeout: 120000 });
  const err = await page.evaluate(() => document.documentElement.dataset.bootError || "");
  if (err) throw new Error("boot error: " + err);
  console.log(`${until} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (evalJs) console.log("eval ->", JSON.stringify(await page.evaluate(evalJs)));
  let waited = 0;
  for (const ms of at) {
    await page.waitForTimeout(Math.max(0, ms - waited));
    waited = ms;
    await page.screenshot({ path: `${out}-${ms}.png` });
    const info = await page.evaluate(() => (window.__ski ? { ...window.__ski.info(), fr: window.__ski.frames(), speed: Math.round((window.__ski.state?.speed || 0) * 3.6), screen: document.documentElement.dataset.skiScreen, x: Math.round(window.__ski.state?.x), z: Math.round(window.__ski.state?.z) } : null));
    console.log(ms, JSON.stringify(info));
  }
} finally {
  await browser.close();
  server.close();
}
