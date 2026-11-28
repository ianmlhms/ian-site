#!/usr/bin/env node
/* Before / after shots of a spot on the printed piste map (28 Nov 2026, dead pistes of Via Lattea Sauze d'Oulx / Moncrons).
 *   node scripts/ski/dead-pistes-shots.mjs --tag before|after [--resort vialattea] [--at 18000,3100] [--zoom 2.4] [--out DIR] [--size 1180x820]
 * Everything discovered (full ink), the map opened on the skier, then centred on --at at the zoom and 2 x zoom; also the plan ("2D") view.
 * Run through: BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/dead-pistes-shots.mjs ... */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rid = opt("--resort", "vialattea"), tag = opt("--tag", "after");
const [ax, az] = opt("--at", "18000,3100").split(",").map(Number);
const zoom = Number(opt("--zoom", "2.4"));
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/dead-pistes"));
const [W, H] = opt("--size", "1180x820").split("x").map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 400)));
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 240000 });
  await page.waitForTimeout(4500);
  await page.evaluate(() => { const S = window.__ski; S.pistes.list.forEach((p) => { for (let s = 0; s < p.length; s += 40) { const a = p.at(s, {}); S.explore.disc.reveal(a.x, a.z); } }); });
  await page.evaluate(() => window.__ski.showMap());
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 15000 });
  await page.waitForTimeout(2600);
  const shot = async (name) => { await page.screenshot({ path: path.join(out, `${rid}-${tag}-${name}.png`) }); console.log("  shot", name); };
  const ev = (f, a) => page.evaluate(f, a);
  await ev(([x, z, k]) => window.__ski.pisteMap.center(x, z, k), [ax, az, zoom]); await page.waitForTimeout(1600); await shot("near");
  await ev(([x, z, k]) => window.__ski.pisteMap.center(x, z, k), [ax, az, zoom * 1.7]); await page.waitForTimeout(1600); await shot("closer");
  if (await page.locator("#mapView").isVisible().catch(() => false)) {
    await page.click("#mapView"); await page.waitForTimeout(1800);
    await ev(([x, z, k]) => window.__ski.pisteMap.center(x, z, k), [ax, az, zoom]); await page.waitForTimeout(1400); await shot("plan");
  }
  console.log(errors.length ? "errors: " + errors.join(" | ") : "no page errors");
} finally {
  await browser.close();
  server.close();
}
