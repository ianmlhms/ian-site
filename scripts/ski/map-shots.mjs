#!/usr/bin/env node
/* Map look (22 Nov 2026, Ian: "you're lost when the map opens"): per resort, the free ride's HUD with the minimap and the full map as it
 * opens over the free ride (iPad landscape 1180 x 820 @2, touch), the skier put mid-mountain on a piste first.
 *   node scripts/ski/map-shots.mjs [--resorts killy,zermatt,kronplatz] [--out DIR] [--tag before] [--size 1180x820] [--engine chromium]
 *        [--extra]   also: zoomed in on the skier, a piste tapped (info card), the 3D view when there is one
 * PNGs <resort>-<tag>-<shot>.png. Run through browser-slot.py (one browser). */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,zermatt,kronplatz").split(",");
const engine = opt("--engine", "chromium");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/map-ui"));
const tag = opt("--tag", "shot");
const [W, H] = opt("--size", "1180x820").split("x").map(Number);
const extra = args.includes("--extra");
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true, args: engine === "chromium" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
const report = [];
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: engine === "chromium" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(String(e).slice(0, 300)); console.log(`[${rid}] pageerror`, String(e).slice(0, 300)); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 240000 });
    await page.waitForTimeout(5000);                    // the minimap's painted base loads 4 s in
    const shot = async (name, clip) => { await page.screenshot({ path: path.join(out, `${rid}-${tag}-${name}.png`), clip }); console.log(`  ${rid} ${name}`); };
    // mid-mountain: the middle of a red piste of ~2 km, a few km from the spawn, the skier heading down it
    const at = await page.evaluate(async () => {
      const S = window.__ski;
      const L = S.pistes.list.filter((p) => p.diff === "red" && p.length > 1200).sort((a, b) => Math.abs(a.length - 2000) - Math.abs(b.length - 2000));
      const p = L[0] || S.pistes.list[0];
      const a = p.at(p.length * 0.4, {}), b = p.at(p.length * 0.4 + 20, {});
      await S.teleportTo({ x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x), kind: "piste", piste: p.id });
      return { piste: p.name, x: a.x, z: a.z };
    });
    await page.waitForFunction(() => window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 60000 });
    await page.waitForTimeout(3500);
    await shot("hud");
    const mm = await page.locator(".minimap").boundingBox().catch(() => null);
    if (mm) await shot("minimap", { x: Math.max(0, mm.x - 20), y: Math.max(0, mm.y - 20), width: Math.min(W - mm.x + 20, mm.width + 40), height: mm.height + 60 });
    // open the map the iPad way: a touch tap on the minimap
    if (mm) await page.touchscreen.tap(mm.x + mm.width / 2, mm.y + mm.height / 2);
    else await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await shot("map-open");
    if (extra) {
      const ev = (f, a) => page.evaluate(f, a);
      // a piste tapped near the skier -> the info card
      const tp = await ev(() => {
        const S = window.__ski, m = S.pisteMap, s = S.game.resume ? S.game.resume.state : S.state;
        const p = S.pistes.nearest(s.x, s.z, 3000);
        const piste = p && (p.piste || p);
        if (!piste || !piste.at) return null;
        const a = piste.at(piste.length * 0.7, {});
        return m.screenXY(a.x, a.z);
      });
      if (tp) {
        const box = await page.locator("#mapCanvas").boundingBox();
        await page.touchscreen.tap(box.x + tp[0], box.y + tp[1]);
        await page.waitForTimeout(900);
        await shot("map-tap-piste");
      }
      // the nearest lift's line tapped -> the card with the lift and "Hei hin teleportéieren?"
      const tl = await ev(() => {
        const S = window.__ski, m = S.pisteMap, s = S.game.resume ? S.game.resume.state : S.state;
        const L = [...S.modes.lifts.list].sort((a, b) => Math.hypot(a.bottom.x - s.x, a.bottom.z - s.z) - Math.hypot(b.bottom.x - s.x, b.bottom.z - s.z));
        const l = L[0];
        return l ? m.screenXY(l.bottom.x * 0.6 + l.top.x * 0.4, l.bottom.z * 0.6 + l.top.z * 0.4) : null;
      });
      if (tl) {
        const box = await page.locator("#mapCanvas").boundingBox();
        await page.touchscreen.tap(box.x + tl[0], box.y + tl[1]);
        await page.waitForTimeout(900);
        await shot("map-tap-lift");
      }
      if (await page.locator("#map3d").count()) {
        await page.click("#map3d");
        await page.waitForTimeout(4000);
        await shot("map-3d");
        await page.click("#map3d");
        await page.waitForTimeout(600);
      }
      await ev(() => window.__ski.pisteMap && window.__ski.pisteMap.zoomBy(1 / 4));
      await page.waitForTimeout(600);
      await shot("map-out");
    }
    report.push(`${rid}: at ${at.piste}, ${errors.length} page errors${errors.length ? ": " + errors[0] : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(report.join("\n"));
