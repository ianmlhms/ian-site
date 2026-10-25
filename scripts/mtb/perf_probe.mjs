#!/usr/bin/env node
/* Developer tool: triangles and draw calls per scene part at gorge poses and quality levels.
 *   node scripts/mtb/perf_probe.mjs [low|medium|high ...]
 * Reports total / terrain / forest / rocks / water per pose (one browser, one page per quality). */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const levels = process.argv.slice(2).length ? process.argv.slice(2) : ["low", "medium", "high"];
const POSES = [
  { name: "trail-start", trail: 0 }, { name: "gorge-b1", trail: 38 }, { name: "gorge-b2", trail: 780 }, { name: "beech-c3", trail: 1400 },
  { name: "beech-c4", trail: 3000 }, { name: "schiess", at: [1556.5, 5764.5], up: 2.4, yaw: 108 }, { name: "schiess-wide", at: [1548, 5750], up: 1.8, yaw: 100 },
];
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  for (const q of levels) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`${origin}/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&season=summer`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1", null, { timeout: 120000 });
    for (const p of POSES) {
      const r = await page.evaluate(async (p) => {
        const m = window.__mtb;
        let x, z, yaw = (p.yaw || 0) * Math.PI / 180;
        if (p.trail !== undefined) { const c = m.centre[Math.min(m.centre.length - 1, p.trail)], d = m.centre[Math.min(m.centre.length - 1, p.trail + 6)]; x = c[0]; z = c[1]; yaw = Math.atan2(d[1] - c[1], d[0] - c[0]); } else { x = p.at[0]; z = p.at[1]; }
        m.teleport(x, z); m.rider.setVisible(false);
        const y = m.surface.height(x, z) + (p.up || 1.7);
        m.setCamera({ x, y, z, tx: x + Math.cos(yaw) * 50, ty: y, tz: z + Math.sin(yaw) * 50, fov: 64 });
        await new Promise((r) => setTimeout(r, 1800));
        const tris = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(m.renderer.info.render.triangles))));
        const out = { total: await tris(), calls: m.renderer.info.render.calls };
        const groups = { forest: m.forest.group, rocks: m.rockView.group, water: m.water.group };
        for (const [k, g] of Object.entries(groups)) { g.visible = false; out[k] = out.total - (await tris()); g.visible = true; }
        out.terrain = out.total - out.forest - out.rocks - out.water;
        return out;
      }, p);
      console.log(q.padEnd(7), p.name.padEnd(13), `total ${(r.total / 1000).toFixed(0)}k  forest ${(r.forest / 1000).toFixed(0)}k  rocks ${(r.rocks / 1000).toFixed(0)}k  water ${(r.water / 1000).toFixed(0)}k  terrain+sky ${(r.terrain / 1000).toFixed(0)}k  calls ${r.calls}`);
    }
    await page.context().close();
  }
} finally { await browser.close(); server.close(); }
