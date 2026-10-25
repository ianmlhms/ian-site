#!/usr/bin/env node
/* Developer tool: open the MTB game headless, wait until it is ready, optionally run steps, save screenshots.
 *   node scripts/mtb/shot.mjs OUT.png [--url "/pb/mtb.html?q=high&time=noon"] [--size 1280x720] [--eval "js run in the page"] [--wait ms] [--pose x,z,heightAboveGround,yawDeg,pitchDeg]
 * Uses the flow harness (local static server, Chromium with a real GL stack). One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const url = opt("--url", "/pb/mtb.html?q=high&time=noon&weather=clear&debug=1");
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const evalJs = opt("--eval", "");
const wait = Number(opt("--wait", "1500"));
const pose = opt("--pose", "");

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("[page]", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(origin + url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  const err = await page.evaluate(() => document.documentElement.dataset.bootError || "");
  if (err) throw new Error("boot error: " + err);
  if (pose) {
    const [x, z, hAbove, yaw, pitch] = pose.split(",").map(Number);
    await page.evaluate(([x, z, hAbove, yaw, pitch]) => {
      const m = window.__mtb; const g = m.surface.height(x, z); const y = g + hAbove;
      const yr = yaw * Math.PI / 180, pr = pitch * Math.PI / 180;
      m.setCamera({ x, y, z, tx: x + Math.cos(yr) * Math.cos(pr) * 50, ty: y + Math.sin(pr) * 50, tz: z + Math.sin(yr) * Math.cos(pr) * 50, fov: 62 });
    }, [x, z, hAbove, yaw, pitch]);
  }
  if (evalJs) console.log("eval ->", JSON.stringify(await page.evaluate(evalJs)));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
  const stats = await page.evaluate(() => { const m = window.__mtb; return { perf: m.perf, tiles: m.terrain.stats, trees: m.forest.stats, draw: m.renderer.info.render, mem: m.renderer.info.memory }; });
  console.log(JSON.stringify(stats));
} finally {
  await browser.close();
  server.close();
}
