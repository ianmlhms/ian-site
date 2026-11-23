#!/usr/bin/env node
/* Cleanup round (23 Nov 2026): the other skiers AHEAD of the player from the normal chase camera, at full quality (real pixels, GPU,
 * dpr 2: not the halved pixels of a FLOW_POWER flow run), while he skis down a piste. Per piste: 4 frames 1 s apart (+ a burst of 3
 * frames ~1/30 s apart to judge shimmer of the figures / nets), how many others are drawn, how many in the picture within 150 m ahead.
 *   node scripts/ski/npc-ahead-shots.mjs OUT_DIR [--resort 3vallees] [--pistes boulevard-du-france] [--q high] [--dpr 2]
 * Run it through ~/Library/Caches/browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

process.env.FLOW_FULL = "1";
const args = process.argv.slice(2);
const out = args[0] || path.join(process.env.HOME, "Library/Caches/ski-work/cleanup/npc-ahead");
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rid = opt("--resort", "3vallees");
const ids = opt("--pistes", "boulevard-du-france").split(",");
const q = opt("--q", "high");
const dpr = Number(opt("--dpr", "2"));
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
const report = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.addInitScript(() => { try { localStorage.setItem("pb_ski_npcs", "1"); } catch (error) { /* ignore */ } });
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
  await page.evaluate(() => window.__ski.streamer.release());
  await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(2500);
  for (const id of ids) {
    const spot = await page.evaluate((id) => {
      const S = window.__ski, p = S.pistes.byId.get(id);
      if (!p) return null;
      const a = p.at(Math.min(120, p.length * 0.1), {});
      S.placeHold(a.x, a.z, Math.atan2(a.dz, a.dx));
      return { id, name: p.name, length: p.length };
    }, id);
    if (!spot) { console.log(`no piste ${id}`); continue; }
    await page.waitForTimeout(3000);
    // the scripted skier down the piste (the bot follows the line)
    await page.evaluate(async (id) => {
      const S = window.__ski, { createBot } = await import("/pb/ski/bot.js");
      S.game.bot = createBot(S.pistes.byId.get(id), { blocked: S.blocked });
    }, id);
    const count = () => page.evaluate(() => {
      const S = window.__ski, cam = S.camera, c = S.npcs.crowd, v = S.npcs.view;
      const f = new window.THREE.Frustum().setFromProjectionMatrix(new window.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let ahead = 0, ahead150 = 0;
      for (const o of c.list || []) {
        const p = new window.THREE.Vector3(o.x, (o.y ?? S.surface.height(o.x, o.z)) + 0.9, o.z);
        if (!f.containsPoint(p)) continue;
        ahead++;
        if (p.distanceTo(cam.position) < 150) ahead150++;
      }
      return { listed: c.stats.listed, near: v ? v.stats.near : 0, crowd: v ? v.stats.crowd : 0, inPicture: ahead, within150: ahead150, speed: +(S.state.speed * 3.6).toFixed(0) };
    });
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(1000);
      const n = await count();
      await page.screenshot({ path: path.join(out, `${rid}-${id}-${k}.png`) });
      report.push({ id, k, ...n });
      console.log(`${id} frame ${k}: ${JSON.stringify(n)}`);
    }
    for (let k = 0; k < 3; k++) await page.screenshot({ path: path.join(out, `${rid}-${id}-burst${k}.png`) });
    await page.evaluate(() => { window.__ski.game.bot = null; });
  }
  if (errors.length) console.log("page errors:", errors);
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(out, `${rid}-report.json`), JSON.stringify(report, null, 1));
