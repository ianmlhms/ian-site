#!/usr/bin/env node
/* Developer tool: the release screenshots in one browser session (the reference rider rides the real game loop, no teleports).
 *   node scripts/mtb/release-shots.mjs OUTDIR [--size 1280x800] [--q high] [--parts trails,falls,weather,menu,finish]
 * trails: for every trail the start card and one mid-run shot with the HUD; falls: the Schiessentuempel approach, the bridge and the finish with the falls camera;
 * weather: the same pose in every time of day and weather; menu: trail map, bikes, settings; finish: the finish screen of the first trail. One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "1280x800").split("x").map(Number);
const q = opt("--q", "high");
const parts = (opt("--parts", "trails,falls,weather,menu,finish") || "").split(",");
const IDS = ["ernz-waldwee", "hallerbach-flow", "schiessentuempel", "binzelt-rocks", "waschbrunnen-black", "maratoun"];
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&season=summer`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const m = window.__mtb; m.setProgress({ ...m.progress, m: "333333" }); });
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(outDir, name + ".png") }); console.log("saved", name); };
  const begin = (id) => page.evaluate(async (trailId) => {
    const { createBot } = await import("/pb/mtb/bot.js");
    const m = window.__mtb;
    m.enterCard(trailId); m.startRun();
    window.__bot = createBot(m.trail.centre.slice(0, m.trail.arch.index + 4), m.trail.grade);
    for (let i = 0; i < 200; i++) m.tick(1 / 60, { throttle: 0, brake: 0, steer: 0, jump: false });
  }, id);
  const rideTo = (frac, fromEnd = false) => page.evaluate(([frac, fromEnd]) => {
    const m = window.__mtb, t = m.trail;
    const target = fromEnd ? t.length - frac : t.length * frac;
    let f = 0;
    while (f++ < 60 * 3600 && m.game.mode === "run" && t.s[Math.min(t.count - 1, m.game.progress)] < target) m.tick(1 / 60, window.__bot.input(m.bike));
    m.setInput({ throttle: 0.15, brake: 0, steer: 0, jump: false });
    return m.game.mode;
  }, [frac, fromEnd]);
  const rideOut = () => page.evaluate(() => { const m = window.__mtb; let f = 0; while (f++ < 60 * 3600 && m.game.mode === "run") m.tick(1 / 60, window.__bot.input(m.bike)); return m.game.mode; });
  if (parts.includes("trails")) {
    for (const id of IDS) {
      await page.evaluate((t) => window.__mtb.enterCard(t), id);
      await page.waitForTimeout(900);
      await shot("start-" + id);
      await begin(id);
      await rideTo(0.45);
      await page.waitForTimeout(500);
      await shot("mid-" + id);
      await page.evaluate(() => { window.__mtb.stop && 0; window.__mtb.setInput(null); });
    }
  }
  if (parts.includes("falls")) {
    await begin("schiessentuempel");
    await rideTo(70, true); await shot("falls-1-approach");
    await rideTo(22, true); await shot("falls-2-bridge-ramp");
    await rideOut(); await page.waitForTimeout(1800); await shot("falls-3-finish-view");
  }
  if (parts.includes("weather")) {
    await begin("ernz-waldwee"); await rideTo(0.5);
    for (const [time, weather] of [["morning", "clear"], ["noon", "clear"], ["evening", "clear"], ["night", "clear"], ["noon", "cloudy"], ["noon", "fog"], ["noon", "rain"], ["dusk", "rain"]]) {
      await page.evaluate(([t, wx]) => { const m = window.__mtb; m.env.setTime(t); m.env.setWeather(wx); }, [time, weather]);
      await page.waitForTimeout(1500);
      await shot(`weather-${time}-${weather}`);
    }
  }
  if (parts.includes("menu")) {
    await page.evaluate(() => { const m = window.__mtb; m.env.setTime("noon"); m.env.setWeather("clear"); m.enterCard("ernz-waldwee"); m.openMenu("trails"); });
    await shot("menu-map");
    await page.evaluate(() => window.__mtb.openMenu("bikes")); await shot("menu-bikes");
    await page.evaluate(() => window.__mtb.openMenu("settings")); await shot("menu-settings");
    await page.evaluate(() => window.__mtb.closeMenu());
  }
  if (parts.includes("finish")) {
    await begin("ernz-waldwee"); await rideOut(); await page.waitForTimeout(2200); await shot("finish-ernz-waldwee");
  }
} finally { await browser.close(); server.close(); }
