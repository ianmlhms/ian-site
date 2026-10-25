#!/usr/bin/env node
/* Developer tool: drive the game in a headless browser and save screenshots: the start card, the run (the reference rider drives), the finish screen, the menu, the map.
 *   node scripts/mtb/play-tour.mjs OUTDIR [--size 1180x820] [--touch] [--trail id] [--only card,run,finish,menu] [--q medium] [--url extra]
 * One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "1180x820").split("x").map(Number);
const touch = args.includes("--touch");
const trail = opt("--trail", "ernz-waldwee");
const only = (opt("--only", "card,count,run,finish,menu,map,bikes") || "").split(",");
const q = opt("--q", "medium");
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  const ready = () => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + ".png") }); console.log("saved", name); };
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&trail=${trail}${opt("--url", "")}`, { waitUntil: "domcontentloaded" });
  await ready();
  if (only.includes("card")) { await page.waitForTimeout(1500); await shot("card-" + trail); }
  if (only.includes("menu") || only.includes("map")) {
    await page.evaluate(() => window.__mtb.openMenu("trails")); await page.waitForTimeout(500); await shot("menu-trails");
    await page.evaluate(() => window.__mtb.closeMenu());
  }
  if (only.includes("bikes")) { await page.evaluate(() => window.__mtb.openMenu("bikes")); await page.waitForTimeout(300); await shot("menu-bikes"); await page.evaluate(() => window.__mtb.openMenu("settings")); await page.waitForTimeout(300); await shot("menu-settings"); await page.evaluate(() => window.__mtb.closeMenu()); }
  if (only.includes("count") || only.includes("run") || only.includes("finish")) {
    await page.click(".bigstart");
    await page.waitForTimeout(1200);
    if (only.includes("count")) await shot("countdown");
    await page.evaluate(async () => {
      const { createBot } = await import("/pb/mtb/bot.js");
      const m = window.__mtb;
      const bot = createBot(m.trail.centre.slice(0, m.trail.arch.index + 4), m.trail.grade);
      window.__botTimer = setInterval(() => { if (m.game.mode === "run") m.setInput({ ...bot.input(m.bike), jump: false }); else m.setInput(null); }, 16);
    });
    await page.waitForTimeout(9000);
    if (only.includes("run")) await shot("run-hud");
    if (only.includes("finish")) {
      // fast-forward: teleport near the end of the trail
      await page.evaluate(() => { const m = window.__mtb; const t = m.trail; m.setBike({ ...m.bike }); const i = t.arch.index - 40; const s = m.bike; m.reset(i); });
      await page.waitForFunction(() => window.__mtb.game.mode === "finished", null, { timeout: 90000 });
      await page.waitForTimeout(900);
      await shot("finish");
    }
  }
} finally { await browser.close(); server.close(); }
