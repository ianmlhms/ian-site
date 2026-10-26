#!/usr/bin/env node
/* Developer tool: side-by-side montages "real photo | our screenshot from the SAME viewpoint" (the reference-photo rule of DESIGN.md section 11).
 *   node scripts/mtb/compare.mjs OUT_DIR [name,...]
 * Every spec says where the camera stands (world metres or a trail index), where it looks, the field of view, the weather and the reference photo (kept in
 * ~/Library/Caches/mtb-refs, never in the repo). The screenshot is rendered at the photo's aspect ratio; PIL (the luxtram venv) joins the two. One browser at a time. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const REFS = path.join(os.homedir(), "Library/Caches/mtb-refs");
const PY = path.join(os.homedir(), "Library/Caches/luxtram-work/.venv/bin/python");
const out = process.argv[2];
const only = (process.argv[3] || "").split(",").filter(Boolean);
fs.mkdirSync(out, { recursive: true });

/* pose: { at: [x, z] | { trail: index }, up: metres above the ground, yaw: degrees (0 = east, 90 = south), pitch, fov }; hideRider: true */
const SPECS = [
  { name: "montage-p1-schiessentuempel-falls", ref: "schiess2020_101.jpg", caption: "Schiessentümpel: four falls side by side over one ledge", size: [1280, 960], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { finishView: true, dy: -0.4, dty: -0.6, fov: 52 } },
  { name: "montage-p2-schiessentuempel-photo2", ref: "schiess6020.jpg", caption: "Schiessentümpel: the falls from the side", size: [1280, 782], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { cascade: [9, 4.0, 1.4, 0, -1.5, 1.2], fov: 52 } },
  { name: "montage-p3-beaufort-ruin-a", ref: "beaufort_alt.jpg", caption: "Beaufort medieval castle ruin from the road", size: [1280, 900], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [585, 432], up: 4, look: [622, 380, 6], fov: 55 } },
  { name: "montage-p4-beaufort-ruin-b", ref: "beaufort_r02.jpg", caption: "Beaufort ruin: towers and curtain wall", size: [1280, 900], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [660, 445], up: 4, look: [622, 378, 6], fov: 52 } },
  { name: "montage-p5-beaufort-renaissance", ref: "beaufort_ren1.jpg", caption: "Beaufort Renaissance castle", size: [1280, 900], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [578, 428], up: 5, look: [562, 365, 8], fov: 58 } },
  { name: "montage-p6-berdorf-church", ref: "berdorf_kirche01.jpg", caption: "Berdorf church", size: [1280, 900], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [5148, 1820], up: 3, look: [5110, 1785, 9], fov: 52 } },
  { name: "montage-p7-berdorf-village", ref: "berdorf_2015.jpg", caption: "Berdorf village from the fields", size: [1280, 720], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [4950, 2030], up: 22, look: [5100, 1790, 8], fov: 58 } },
  { name: "montage-w3-1-schiessentuempel", ref: "trail1.jpg", caption: "Schiessentümpel: the cascade below the arched footbridge", size: [720, 1088], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { at: [1556.5, 5764.5], up: 2.4, yaw: 108, pitch: 8, fov: 52 } },
  { name: "montage-w3-2-rock-corridor", ref: "wolfsschlucht090.jpg", caption: "Rock corridor: sandstone walls on both sides of the way", size: [1280, 720], q: "high", time: "noon", weather: "clear", season: "summer",
    pose: { trail: 1130, up: 1.6, yawFromTrail: true, pitch: 6, fov: 64 } },       // (first trail = the Haller forest way since the integration wave: the corridor at 1130 m)
  { name: "montage-w3-3-beech-trail", ref: "enlightened.jpg", caption: "Beech forest trail", size: [1080, 720], q: "high", time: "morning", weather: "clear", season: "summer",
    pose: { trail: 420, up: 1.7, yawFromTrail: true, pitch: 4, fov: 74 } },
  { name: "montage-w3-4-meadow-plateau", ref: "plateau_beaufort.jpg", caption: "Meadow plateau: crop fields, hedges, woods", size: [960, 720], q: "high", time: "noon", weather: "cloudy", season: "summer",
    pose: { at: [740, 1940], up: 11, yaw: 270, pitch: -7, fov: 55 } },
];

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  for (const spec of SPECS.filter((s) => !only.length || only.some((o) => s.name.includes(o)))) {
    const [w, h] = spec.size;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
    await page.goto(`${origin}/pb/mtb.html?debug=1&q=${spec.q}&time=${spec.time}&weather=${spec.weather}&season=${spec.season}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
    await page.addStyleTag({ content: ".mhud, .mcard, .mhint, .mtouch, .mfin, .mmenu, #mtbMenuBtn, #hud, #title, #hint, #touchControls { display: none !important; } header, .arcade-bar, [class*='arcade'] { display: none !important; }" });
    await page.evaluate((p) => {
      const m = window.__mtb;
      let x, z, yaw = p.yaw;
      if (p.finishView) {                                      // the camera of the finish view of the Schiessentuempel trail, as the game puts it
        const f = m.world.finishView;
        m.teleport(f.x, f.z); m.rider.setVisible(false);
        m.setCamera({ x: f.x, y: f.y + (p.dy || 0), z: f.z, tx: f.tx, ty: f.ty + (p.dty || 0), tz: f.tz, fov: p.fov });
        return;
      }
      if (p.cascade) {                                         // pose in the Schiessentuempel cascade frame [u, v, y above the pool, lookU, lookV, lookY above the pool]
        const c = m.cascade, [u, v, y0, lu, lv, ly] = p.cascade;
        const at = (a, b) => ({ x: c.x + c.f[0] * a + c.a[0] * b, z: c.z + c.f[1] * a + c.a[1] * b });
        const p0 = at(u, v), p1 = at(lu, lv);
        m.teleport(p0.x, p0.z); m.rider.setVisible(false);
        m.setCamera({ x: p0.x, y: Math.max(c.poolY + y0, m.surface.height(p0.x, p0.z) + 1.3), z: p0.z, tx: p1.x, ty: c.poolY + ly, tz: p1.z, fov: p.fov });
        return;
      }
      if (p.look) {                                            // camera at `at`, up metres above the ground, looking at [tx, tz, metres above the ground there]
        [x, z] = p.at; m.teleport(x, z); m.rider.setVisible(false);
        m.setCamera({ x, y: m.surface.height(x, z) + p.up, z, tx: p.look[0], ty: m.surface.height(p.look[0], p.look[1]) + p.look[2], tz: p.look[1], fov: p.fov });
        return;
      }
      if (p.trail !== undefined) { const c = m.centre[p.trail], d = m.centre[Math.min(m.centre.length - 1, p.trail + 6)]; x = c[0]; z = c[1]; if (p.yawFromTrail) yaw = Math.atan2(d[1] - c[1], d[0] - c[0]) * 180 / Math.PI; }
      else { x = p.at[0]; z = p.at[1]; }
      m.teleport(x, z); m.rider.setVisible(false);
      const y = m.surface.height(x, z) + p.up, yr = yaw * Math.PI / 180, pr = p.pitch * Math.PI / 180;
      m.setCamera({ x, y, z, tx: x + Math.cos(yr) * Math.cos(pr) * 50, ty: y + Math.sin(pr) * 50, tz: z + Math.sin(yr) * Math.cos(pr) * 50, fov: p.fov });
    }, spec.pose);
    await page.waitForTimeout(3500);
    const shot = path.join(out, spec.name + "-ours.png");
    await page.screenshot({ path: shot });
    await ctx.close();
    execFileSync(PY, ["-c", `
import sys
from PIL import Image, ImageDraw
ref=Image.open(sys.argv[1]).convert("RGB"); ours=Image.open(sys.argv[2]).convert("RGB")
H=720
def fit(im): return im.resize((int(im.width*H/im.height), H))
a, b = fit(ref), fit(ours)
sheet=Image.new("RGB",(a.width+b.width+12, H+44),(16,22,18))
sheet.paste(a,(0,0)); sheet.paste(b,(a.width+12,0))
d=ImageDraw.Draw(sheet)
d.text((10,H+8),"real photo (Wikimedia Commons, kept outside the repo)",fill=(200,210,200)); d.text((a.width+22,H+8),"MTB Mëllerdall, same viewpoint: "+sys.argv[4],fill=(200,210,200))
sheet.save(sys.argv[3],quality=90)
`, path.join(REFS, spec.ref), shot, path.join(out, spec.name + ".jpg"), spec.caption]);
    console.log("wrote", spec.name);
  }
} finally { await browser.close(); server.close(); }
