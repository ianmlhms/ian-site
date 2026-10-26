#!/usr/bin/env node
/* Developer tool: screenshots of the Schiessentümpel cascade from poses given in the cascade frame (u metres along the flow from the lip, v across, y above the pool level).
 *   node scripts/mtb/cascade-shot.mjs OUT_DIR name=u,v,y,lookU,lookV,lookY,fov [name=...] [--q high] [--time noon] [--weather clear] [--size 1280x720]
 * One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const poses = args.slice(1).filter((a) => a.includes("=") && !a.startsWith("--")).map((a) => { const [name, v] = a.split("="); const n = v.split(",").map(Number); return { name, n }; });
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${opt("--q", "high")}&time=${opt("--time", "noon")}&weather=${opt("--weather", "clear")}&season=${opt("--season", "summer")}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.addStyleTag({ content: ".mhud,.mcard,.mhint,.mtouch,.mfin,.mmenu,#mtbMenuBtn,#hud,#title,#hint,#touchControls{display:none!important}" });
  for (const p of poses) {
    await page.evaluate((n) => {
      const m = window.__mtb, c = m.cascade;
      const at = (u, v) => ({ x: c.x + c.f[0] * u + c.a[0] * v, z: c.z + c.f[1] * u + c.a[1] * v });
      const [u, v, y, lu, lv, ly, fov] = n;
      const p0 = at(u, v), p1 = at(lu, lv);
      m.teleport(p0.x, p0.z); m.rider.setVisible(false);
      m.setCamera({ x: p0.x, y: Math.max(c.poolY + y, m.surface.height(p0.x, p0.z) + 1.3), z: p0.z, tx: p1.x, ty: c.poolY + ly, tz: p1.z, fov });
    }, p.n);
    await page.waitForTimeout(Number(opt("--wait", "2200")));
    await page.screenshot({ path: path.join(out, p.name + ".png") });
    console.log("saved", p.name);
  }
  const info = await page.evaluate(() => { const m = window.__mtb; return { cascade: { faceU: m.cascade.faceU, drop: m.cascade.drop, lipY: m.cascade.lipY, poolY: m.cascade.poolY }, draw: m.renderer.info.render }; });
  console.log(JSON.stringify(info));
} finally { await browser.close(); server.close(); }
