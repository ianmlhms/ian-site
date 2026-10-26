#!/usr/bin/env node
/* Developer tool: screenshots from named world poses: camera at (x, z) `up` metres above the ground (or at absolute height with a leading =), looking at (tx, tz, ty above the ground).
 *   node scripts/mtb/pose-shots.mjs OUT_DIR name=x,z,up,tx,tz,tyUp,fov [name=...] [--q high] [--time noon] [--weather clear] [--size 1280x720] [--tag montage-name]
 * Hides the UI. One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const poses = args.slice(1).filter((a) => a.includes("=") && !a.startsWith("--")).map((a) => { const [name, v] = a.split("="); return { name, n: v.split(",").map(Number) }; });
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${opt("--q", "high")}&time=${opt("--time", "noon")}&weather=${opt("--weather", "clear")}&season=${opt("--season", "summer")}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.addStyleTag({ content: ".mhud,.mcard,.mhint,.mtouch,.mfin,.mfinish,.mmenu,#mtbMenuBtn,#hud,#title,#hint,#touchControls,header{display:none!important}" });
  for (const p of poses) {
    const info = await page.evaluate((n) => {
      const m = window.__mtb;
      const [x, z, up, tx, tz, tyUp, fov] = n;
      m.teleport(x, z); m.rider.setVisible(false);
      const y = m.surface.height(x, z) + up, ty = m.surface.height(tx, tz) + tyUp;
      m.setCamera({ x, y, z, tx, ty, tz, fov: fov || 60 });
      return { ground: m.surface.height(x, z), town: m.town ? m.town.stats : null };
    }, p.n);
    await page.waitForTimeout(Number(opt("--wait", "2200")));
    await page.screenshot({ path: path.join(out, p.name + ".png") });
    console.log("saved", p.name, JSON.stringify(info));
  }
  console.log(JSON.stringify(await page.evaluate(() => ({ draw: window.__mtb.renderer.info.render, town: window.__mtb.town.stats }))));
} finally { await browser.close(); server.close(); }
