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
    await page.addStyleTag({ content: "#hud, #title, #hint, #touchControls { display: none !important; } header, .arcade-bar, [class*='arcade'] { display: none !important; }" });
    await page.evaluate((p) => {
      const m = window.__mtb;
      let x, z, yaw = p.yaw;
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
