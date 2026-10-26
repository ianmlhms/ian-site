#!/usr/bin/env node
/* Developer tool: the same gorge poses under every weather (clear / cloudy / fog / rain), as single shots and one contact sheet.
 *   node scripts/mtb/weather-shots.mjs OUT_DIR [--q high] [--time noon] [--size 640x360] [--poses 38,780,1130]
 * Poses are centre indices of the first trail (the Haller gorge). One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "640x360").split("x").map(Number);
const poses = opt("--poses", "38,780,1130").split(",").map(Number);
const weathers = ["clear", "cloudy", "fog", "rain"];
const PY = path.join(os.homedir(), "Library/Caches/luxtram-work/.venv/bin/python");
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
const files = [];
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${opt("--q", "high")}&time=${opt("--time", "noon")}&weather=clear&season=summer`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.addStyleTag({ content: ".mhud,.mcard,.mhint,.mtouch,.mfin,.mfinish,.mmenu,#mtbMenuBtn,#hud,#title,#hint,#touchControls,header{display:none!important}" });
  for (const pose of poses) {
    for (const wx of weathers) {
      await page.evaluate(([pose, wx]) => {
        const m = window.__mtb;
        m.env.setWeather(wx); m.env.snap();
        const c = m.centre[Math.min(m.centre.length - 1, pose)], d = m.centre[Math.min(m.centre.length - 1, pose + 6)], yaw = Math.atan2(d[1] - c[1], d[0] - c[0]);
        m.teleport(c[0], c[1]); m.rider.setVisible(false);
        const y = m.surface.height(c[0], c[1]) + 1.6;
        m.setCamera({ x: c[0], y, z: c[1], tx: c[0] + Math.cos(yaw) * 50, ty: y - 0.5, tz: c[1] + Math.sin(yaw) * 50, fov: 70 });
      }, [pose, wx]);
      await page.waitForTimeout(1800);
      const f = path.join(out, `wx-${pose}-${wx}.png`);
      await page.screenshot({ path: f });
      files.push(f + ":" + wx + " @" + pose);
      console.log("saved", f);
    }
  }
} finally { await browser.close(); server.close(); }
execFileSync(PY, [path.join(path.dirname(new URL(import.meta.url).pathname), "montage.py"), path.join(out, "weather-sheet.jpg"), "4", String(w), ...files]);
console.log("wrote", path.join(out, "weather-sheet.jpg"));
