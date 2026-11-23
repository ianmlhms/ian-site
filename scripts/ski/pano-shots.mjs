#!/usr/bin/env node
/* The printed piste map, looked at like a player (iPad, touch, dpr 2): opened on the skier at the spawn, the whole resort, zoomed in on a
 * valley, a piste and a lift tapped, the plan view, the challenge tab. Frame times while panning too.
 *   node scripts/ski/pano-shots.mjs [--resorts killy,3vallees,zermatt] [--out DIR] [--tag after] [--size 1180x820] [--only spawn,whole]
 *        [--discover]   some of the pistes discovered (full ink) before the shots
 * PNGs <resort>-<tag>-<shot>.png. Run through browser-slot.py (one browser). */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt").split(",");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/map-print"));
const tag = opt("--tag", "after"), only = opt("--only", "").split(",").filter(Boolean);
const [W, H] = opt("--size", "1180x820").split("x").map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
const report = [];
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(String(e.stack || e).slice(0, 500)); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    const t0 = Date.now();
    let panoAt = null, skiAt = null;
    page.on("request", (r) => { if (/panorama\.webp/.test(r.url()) && panoAt === null) panoAt = Date.now() - t0; });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 240000 });
    await page.waitForTimeout(4500);
    skiAt = Date.now() - t0;
    if (args.includes("--discover")) await page.evaluate(() => { const S = window.__ski; S.pistes.list.forEach((p, i) => { if (i % 3 === 0) for (let s = 0; s < p.length; s += 60) { const a = p.at(s, {}); S.explore.disc.reveal(a.x, a.z); } }); });
    const shot = async (name) => { if (only.length && !only.includes(name)) return; await page.screenshot({ path: path.join(out, `${rid}-${tag}-${name}.png`) }); console.log(`  ${rid} ${name}`); };
    const lazyOk = panoAt === null;
    const open = await page.evaluate(() => { const t = performance.now(); window.__ski.showMap(); return performance.now() - t; });
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 15000 });
    await page.waitForTimeout(2600);
    await shot("spawn");
    const box = await page.locator("#mapCanvas").boundingBox();
    // pan for half a second: the frame times
    const pan = await page.evaluate(async () => {
      const c = document.getElementById("mapCanvas"), r = c.getBoundingClientRect(), at = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: r.left + x, clientY: r.top + y, bubbles: true }));
      c.setPointerCapture = () => {};
      const idle = []; for (let i = 0; i < 30; i++) { const t = performance.now(); await new Promise((f) => requestAnimationFrame(f)); idle.push(performance.now() - t); }
      idle.sort((a, b) => a - b);
      const ts = [];
      at("pointerdown", 400, 300);
      for (let i = 0; i < 40; i++) { at("pointermove", 400 - i * 4, 300 - i * 2); const t = performance.now(); await new Promise((f) => requestAnimationFrame(f)); ts.push(performance.now() - t); }
      at("pointerup", 240, 220);
      ts.sort((a, b) => a - b);
      const d0 = performance.now(); for (let i = 0; i < 5; i++) window.__ski.pisteMap.draw(); const d = (performance.now() - d0) / 5;
      return { idle: idle[15], med: ts[20], p95: ts[38], draw: d };
    });
    await page.click("#mapMe");
    await page.waitForTimeout(900);
    const ev = (f, a) => page.evaluate(f, a);
    const tp = await ev(() => { const S = window.__ski, m = S.pisteMap, s = S.game.resume ? S.game.resume.state : S.state, L = S.pistes.list.filter((p) => p.length > 900).map((p) => ({ p, a: p.at(p.length * 0.5, {}) })).sort((x, y) => Math.hypot(x.a.x - s.x, x.a.z - s.z) - Math.hypot(y.a.x - s.x, y.a.z - s.z)); return L[0] ? m.screenXY(L[0].a.x, L[0].a.z) : null; });
    if (tp) { await page.touchscreen.tap(box.x + tp[0], box.y + tp[1]); await page.waitForTimeout(700); await shot("tap-piste"); }
    const tl = await ev(() => { const S = window.__ski, m = S.pisteMap, s = S.game.resume ? S.game.resume.state : S.state, l = [...S.modes.lifts.list].sort((a, b) => Math.hypot(a.bottom.x - s.x, a.bottom.z - s.z) - Math.hypot(b.bottom.x - s.x, b.bottom.z - s.z))[0]; return m.screenXY(l.bottom.x, l.bottom.z); });
    if (tl) { await page.touchscreen.tap(box.x + tl[0], box.y + tl[1]); await page.waitForTimeout(700); await shot("tap-lift"); }
    await page.evaluate(() => { const x = document.getElementById("mcClose"); if (x) x.click(); });
    await ev(() => window.__ski.pisteMap.zoomBy(2.1)); await page.waitForTimeout(1200); await shot("close");
    await page.click("#mapFit"); await page.waitForTimeout(900); await shot("whole");
    // a valley: the biggest village's surroundings, twice the fit
    await ev(() => { const S = window.__ski; S.pisteMap.center(S.spawn.bottom.x, S.spawn.bottom.z, 2.2); });
    await page.waitForTimeout(1200); await shot("valley");
    await ev(() => window.__ski.setMapMode("piste")); await page.waitForTimeout(900); await shot("challenges");
    if (await page.locator("#mapView").isVisible().catch(() => false)) { await page.click("#mapView"); await page.waitForTimeout(1800); await shot("flat"); await page.click("#mapView"); }
    report.push(`${rid}: open ${open.toFixed(0)} ms, idle frame ${pan.idle.toFixed(1)} ms, pan frame ${pan.med.toFixed(1)} / p95 ${pan.p95.toFixed(1)} ms, draw ${pan.draw.toFixed(1)} ms, panorama lazy ${lazyOk}, ${errors.length} errors${errors.length ? ": " + errors[0] : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(report.join("\n"));
