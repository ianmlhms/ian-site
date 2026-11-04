/* Lux Drive: take screenshots of the game from named poses (cloud / Linux friendly, no video, no browser-slot).
 *   node scripts/luxdrive/shot.mjs <outdir> <pose.json|inline json array> [query]
 * A pose: { name, x, z, h (camera height above ground), yaw? (deg, 0 = +x), pitch? (deg, negative = down), dist?, fov?, car? [x,z,yawRad] }
 * The camera is placed at (x, ground+h, z) looking along yaw/pitch, or from `from` to `at`. Prints the stats of each shot. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
// the cloud container keeps Playwright in /opt/node-tools, the Mac in the global playwright-cli install
const PW_HOME = fs.existsSync("/opt/node-tools/node_modules/playwright") ? "/opt/node-tools/" : "/opt/homebrew/lib/node_modules/@playwright/cli/";
const require = createRequire(PW_HOME);
const { chromium } = require("playwright");
const MIME = { html: "text/html", js: "text/javascript", json: "application/json", css: "text/css", webp: "image/webp", png: "image/png", bin: "application/octet-stream" };

const [outDir, poseArg, query = "q=medium&time=noon&weather=clear"] = process.argv.slice(2);
if (!outDir || !poseArg) throw new Error("usage: shot.mjs <outdir> <poses json|file> [query]");
const poses = JSON.parse(fs.existsSync(poseArg) ? fs.readFileSync(poseArg, "utf8") : poseArg);
fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.normalize(path.join(REPO, rel));
  if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("nf"); return; }
  res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(`${origin}/pb/lux-drive.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 240000 });
  if (await page.evaluate(() => document.documentElement.dataset.bootError)) throw new Error("boot error: " + await page.evaluate(() => document.documentElement.dataset.bootError) + "\n" + errors.join("\n"));
  await page.click('[data-act="drive"]');
  for (const pose of poses) {
    await page.evaluate((p) => {
      const m = window.__lux;
      if (p.car) { m.car.reset(p.car[0], p.car[1], p.car[2] || 0); }
      if (p.mode === "chase") { m.setCamera(null); return; }
      let { x, z } = p;
      let y = p.y !== undefined ? p.y : m.ground.height(x, z) + (p.h || 40);
      let tx, ty, tz;
      if (p.at) { tx = p.at[0]; tz = p.at[1]; ty = m.ground.height(tx, tz) + (p.at[2] || 0); }
      else {
        const yaw = (p.yaw || 0) * Math.PI / 180, pitch = (p.pitch === undefined ? -20 : p.pitch) * Math.PI / 180;
        tx = x + Math.cos(yaw) * Math.cos(pitch) * 100; tz = z + Math.sin(yaw) * Math.cos(pitch) * 100; ty = y + Math.sin(pitch) * 100;
      }
      m.setCamera({ x, y, z, tx, ty, tz, fov: p.fov || 62 });
    }, pose);
    // let the tiles / cells / trees build around the new pose (software GL is slow: wait on the pending counters)
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => window.__lux.stats());
      if (i > 3 && s.pending === 0 && s.cityPending === 0) break;
    }
    await page.waitForTimeout(600);
    const stats = await page.evaluate(() => window.__lux.stats());
    const file = path.join(outDir, `${pose.name}.png`);
    await page.screenshot({ path: file });
    console.log(pose.name, JSON.stringify(stats));
  }
  if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.slice(0, 10).join("\n"));
} finally {
  await browser.close();
  server.close();
}
