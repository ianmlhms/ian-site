#!/usr/bin/env node
/* Round 8e probe: one challenge course ridden by the scripted bot, state sampled (why a course does not reach the ZIL in time).
 *   node scripts/ski/probe8e-course.mjs <resort> <piste> [--engine webkit] */
import { startServer, launchBrowser } from "../flows/lib.mjs";
const [rid, pid] = process.argv.slice(2);
const ei = process.argv.indexOf("--engine"); process.env.FLOW_BROWSER = ei > 0 ? process.argv[ei + 1] : "chromium";
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${origin}/pb/ski.html?resort=${rid}&map=1&debug=1&q=low&res=fixed&timescale=3`);
await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 120000 });
await page.evaluate((id) => { const p = window.__ski.pistes.byId.get(id); return window.__ski.streamer.ready(p.top.x, p.top.z, 800); }, pid);
await page.evaluate(() => window.__ski.explore.buildings());
await page.evaluate((id) => window.__ski.start(id), pid);
await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 30000 });
await page.evaluate(async () => { const { createBot } = await import("/pb/ski/bot.js"); window.__ski.game.bot = createBot(window.__ski.game.piste, { blocked: window.__ski.blocked }); });
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const s = await page.evaluate(() => { const k = window.__ski, st = k.state, c = k.lastCourse; return { scr: document.documentElement.dataset.skiScreen, ph: k.game.phase, paused: k.game.paused, v: +(st.speed * 3.6).toFixed(1), crash: +st.crash.toFixed(2), rem: c ? Math.round(c.remaining) : null, abort: !!document.getElementById("courseAbort"), x: Math.round(st.x), z: Math.round(st.z) }; });
  console.log(((Date.now() - t0) / 1000).toFixed(0), JSON.stringify(s));
  if (s.v < 2 && s.ph === "running") console.log("  stuck:", JSON.stringify(await page.evaluate(() => {
    const k = window.__ski, st = k.state, p = k.game.piste, pr = p.project(st.x, st.z, null, 0, {});
    const a = p.at(pr.s, {}), b = p.at(pr.s + 20, {});
    const h = (x, z) => k.surface.height(x, z);
    const inp = k.game.bot ? k.game.bot(st) : null;
    return { hold: st.hold, gHold: k.game.hold, stop: st.stop, brake: st.brake, grounded: st.grounded, y: +(st.y - h(st.x, st.z)).toFixed(2), heading: +st.heading.toFixed(2), lineDir: +Math.atan2(a.dz, a.dx).toFixed(2), s: Math.round(pr.s), off: +pr.off.toFixed(1), hw: p.halfWidth, drop20: +(h(a.x, a.z) - h(b.x, b.z)).toFixed(1), inp, blocked: k.explore && k.explore.obs.blocked(st.x, st.z, 2), keys: Object.keys(st).join(",") };
  })));
  if (s.scr === "finish" || s.abort) break;
  await page.waitForTimeout(4000);
}
await browser.close(); server.close(); process.exit(0);
