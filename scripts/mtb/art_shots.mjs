#!/usr/bin/env node
/* Developer tool (W3 art wave): a list of named camera poses, one screenshot each, HUD hidden, rider hidden. One browser, one page per pose.
 *   node scripts/mtb/art_shots.mjs OUT_DIR [name-prefix,...] [--size 1280x720] [--q high]
 * Poses: { at: [x, z] | { trail: index }, up, yaw | yawFromTrail, pitch, fov }. The same poses are used for before / after pairs. */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0];
const only = (args[1] && !args[1].startsWith("--") ? args[1] : "").split(",").filter(Boolean);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const [W, H] = opt("--size", "1280x720").split("x").map(Number);
const QUALITY_ID = opt("--q", "high");
fs.mkdirSync(out, { recursive: true });

export const POSES = [
  { name: "a1-schiess-cascade", time: "noon", weather: "clear", pose: { at: [1556.5, 5764.5], up: 2.4, yaw: 108, pitch: 8, fov: 52 }, size: [720, 1088] },
  { name: "a2-schiess-wide", time: "morning", weather: "clear", pose: { at: [1548, 5750], up: 1.8, yaw: 100, pitch: 4, fov: 66 } },
  { name: "a3-schiess-bridge", time: "noon", weather: "clear", pose: { at: [1560, 5758], up: 1.5, yaw: 150, pitch: 6, fov: 62 } },
  { name: "b1-rock-corridor", time: "noon", weather: "clear", pose: { trail: 38, up: 1.6, yawFromTrail: true, pitch: 6, fov: 64 } },
  { name: "b2-rock-wall-close", time: "morning", weather: "clear", pose: { trail: 780, up: 1.5, yawFromTrail: true, pitch: 3, fov: 70 } },
  { name: "c1-beech-trail", time: "morning", weather: "clear", pose: { trail: 2210, up: 1.7, yawFromTrail: true, pitch: 4, fov: 74 }, size: [1080, 720] },
  { name: "c2-beech-sunny-a", time: "noon", weather: "clear", pose: { trail: 600, up: 1.7, yawFromTrail: true, pitch: 5, fov: 72 } },
  { name: "c3-beech-sunny-b", time: "noon", weather: "clear", pose: { trail: 1400, up: 1.7, yawFromTrail: true, pitch: 5, fov: 72 } },
  { name: "c4-beech-sunny-c", time: "morning", weather: "clear", pose: { trail: 3000, up: 1.7, yawFromTrail: true, pitch: 5, fov: 72 } },
  { name: "d1-meadow-plateau", time: "noon", weather: "cloudy", pose: { at: [740, 1940], up: 11, yaw: 270, pitch: -7, fov: 55 }, size: [960, 720] },
  { name: "e1-overview", time: "noon", weather: "clear", pose: { at: [1500, 1250], up: 150, yaw: 20, pitch: -16, fov: 62 } },
];

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  for (const spec of POSES.filter((s) => !only.length || only.some((o) => s.name.startsWith(o)))) {
    const [w, h] = spec.size || [W, H];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") console.log("[console error]", m.text().slice(0, 300)); });
    await page.goto(`${origin}/pb/mtb.html?debug=1&q=${QUALITY_ID}&time=${spec.time}&weather=${spec.weather}&season=${spec.season || "summer"}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
    await page.addStyleTag({ content: "#hud, #title, #hint, #touchControls, #mtbHud, .hud, header, .arcade-bar, [class*='arcade'], #hintPill, .hint { display: none !important; }" });
    await page.evaluate((p) => {
      const m = window.__mtb;
      let x, z, yaw = p.yaw;
      if (p.trail !== undefined) { const c = m.centre[Math.min(m.centre.length - 1, p.trail)], d = m.centre[Math.min(m.centre.length - 1, p.trail + 6)]; x = c[0]; z = c[1]; if (p.yawFromTrail) yaw = Math.atan2(d[1] - c[1], d[0] - c[0]) * 180 / Math.PI; }
      else { x = p.at[0]; z = p.at[1]; }
      m.teleport(x, z); m.rider.setVisible(false);
      const y = m.surface.height(x, z) + p.up, yr = yaw * Math.PI / 180, pr = p.pitch * Math.PI / 180;
      m.setCamera({ x, y, z, tx: x + Math.cos(yr) * Math.cos(pr) * 50, ty: y + Math.sin(pr) * 50, tz: z + Math.sin(yr) * Math.cos(pr) * 50, fov: p.fov });
    }, spec.pose);
    await page.waitForTimeout(3200);
    const file = path.join(out, spec.name + ".png");
    await page.screenshot({ path: file });
    const perf = await page.evaluate(() => { const m = window.__mtb; return { fps: m.perf.fps, calls: m.perf.drawCalls, tris: m.perf.triangles }; });
    console.log(spec.name, JSON.stringify(perf));
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
