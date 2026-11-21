#!/usr/bin/env node
/* Developer tool: the skier model in its poses (carve left / right, tuck, plough, jump, crash), seen by a debug camera that circles the
 * skier (window.__ski.orbit), plus a lift-station and a signpost view. One PNG per pose: OUT_PREFIX-<pose>.png.
 *   node scripts/ski/pose-shots.mjs OUT_PREFIX [--q high|medium|low] [--outfit rout|blo|giel|greng|rosa|schwaarz] [--piste id]
 * Run it through ~/Library/Caches/browser-slot.py (one browser at a time). */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const q = opt("--q", "high");
const piste = opt("--piste", "face");
const outfit = opt("--outfit", "");
const POSES = [
  ["carve-right", { steer: 0.9, tuck: 0, brake: 0, push: 0, jump: false }, 150, 4.2, 1.0],
  ["carve-left", { steer: -0.9, tuck: 0, brake: 0, push: 0, jump: false }, 200, 4.2, 1.0],
  ["tuck", { steer: 0, tuck: 1, brake: 0, push: 0, jump: false }, 110, 3.8, 0.9],
  ["plough", { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, 30, 4.0, 1.1],
  ["jump", { steer: 0, tuck: 0, brake: 0, push: 0, jump: true }, 90, 4.6, 1.0],
];

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  if (outfit) await page.addInitScript((o) => { try { localStorage.setItem("pb_ski_outfit", o); } catch (e) { /* ignore */ } }, outfit);
  await page.goto(`${origin}/pb/ski.html?auto=1&debug=1&q=${q}&weather=sun&time=midday&piste=${piste}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 120000 });
  await page.evaluate(() => document.querySelectorAll("#hud,.arcade-bar,#touchControls").forEach((e) => { e.style.display = "none"; }));
  await page.waitForTimeout(1500);
  for (const [name, input, angle, dist, h] of POSES) {
    // gain speed in a tuck first, then hold the pose
    await page.evaluate(([a, d, hh]) => { window.__ski.teleport(200); window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 0, jump: false }); window.__ski.orbit(a, d, hh); }, [angle, dist, h]);
    await page.waitForTimeout(3500);
    await page.evaluate((inp) => window.__ski.setInput(inp), input);
    await page.waitForTimeout(name === "jump" ? 380 : 900);
    if (name === "jump") await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false }));
    await page.screenshot({ path: `${out}-${name}.png` });
    console.log(name, JSON.stringify(await page.evaluate(() => ({ v: Math.round(window.__ski.state.speed * 3.6), edge: +window.__ski.state.edge.toFixed(2), air: !window.__ski.state.grounded }))));
  }
  // crash: steer hard into the nearest tree is unreliable; force the physics' crash state instead
  await page.evaluate(() => { window.__ski.teleport(200); window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 0, jump: false }); window.__ski.orbit(120, 4.5, 1.4); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const g = window.__ski.game; g.state = { ...g.state, crash: 1.6, crashKind: "fall" }; });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}-crash.png` });
  console.log("crash");
} finally {
  await browser.close();
  server.close();
}
