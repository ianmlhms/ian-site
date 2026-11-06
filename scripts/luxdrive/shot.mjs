/* Lux Drive: take screenshots of the game from named poses (cloud / Linux friendly, no video, no browser-slot).
 *   node scripts/luxdrive/shot.mjs <outdir> <pose.json|inline json array> [query]
 * A pose: { name, x, z, h (camera height above ground), yaw? (deg, 0 = +x), pitch? (deg, negative = down), dist?, fov?, car? [x,z,yawRad] }
 * The camera is placed at (x, ground+h, z) looking along yaw/pitch, or at (x, ground+h, z) looking at `at` = [x, z, height above ground].
 * Orbit form (the landmark montages): { name, at: [tx, tz, ty], az (deg, the camera stands at target + (cos az, sin az) * dist: 0 = east, 90 = south),
 * dist, h, fov }.  `hide`: names of scene meshes to leave out of this shot (prefix match, e.g. ["trees"]).  Prints the stats of each shot. */
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
// macOS renders on the Mac's own GPU (Metal: ~6x faster per shot and every tile loaded before the shot); Linux / the cloud keep software GL.
// SHOT_GL=swiftshader forces software rendering anywhere.
const USE_METAL = process.platform === "darwin" && process.env.SHOT_GL !== "swiftshader";
const GL_ARGS = USE_METAL ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args: [...GL_ARGS, "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(`${origin}/pb/lux-drive.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 240000 });
  if (await page.evaluate(() => document.documentElement.dataset.bootError)) throw new Error("boot error: " + await page.evaluate(() => document.documentElement.dataset.bootError) + "\n" + errors.join("\n"));
  await page.click('[data-act="drive"]');
  // the montages show the world, not the HUD (SHOT_HUD=1 keeps it)
  if (!process.env.SHOT_HUD) await page.addStyleTag({ content: "body > *:not(#shell), #shell > *:not(#luxCanvas) { display: none !important; }" });
  for (const pose of poses) {
    await page.evaluate((p) => {
      const m = window.__lux;
      m.scene.traverse((o) => { if (o.userData.shotHidden) { delete o.visible; o.visible = true; o.userData.shotHidden = false; } });   // the previous shot's hides are undone
      if (p.car) { m.car.reset(p.car[0], p.car[1], p.car[2] || 0); }
      if (p.mode === "chase") { m.setCamera(null); return; }
      let { x, z } = p;
      if (p.az !== undefined && p.at) {
        const a = p.az * Math.PI / 180;
        x = p.at[0] + Math.cos(a) * p.dist; z = p.at[1] + Math.sin(a) * p.dist;
      }
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
    const WAIT_ITER = Number(process.env.SHOT_WAIT_ITER) || 40;             // SHOT_WAIT_ITER=160: wait up to 80 s for the tiles (a loaded machine builds them slowly)
    for (let i = 0; i < WAIT_ITER; i++) {
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => window.__lux.stats());
      if (i > 3 && s.pending === 0 && s.cityPending === 0) break;
    }
    if (pose.hide) {
      await page.evaluate((names) => {
        window.__lux.scene.traverse((o) => { if (o.isMesh && names.some((n) => (n === "#unnamed" ? o.name === "" : o.name.startsWith(n)))) {
          // pinned: the tile / deck / tree builders switch `visible` every frame, a plain o.visible = false would not last
          Object.defineProperty(o, "visible", { get: () => false, set: () => {}, configurable: true });
          o.userData.shotHidden = true;
        } });
      }, pose.hide);
    }
    await page.waitForTimeout(600);
    const stats = await page.evaluate(() => window.__lux.stats());
    if (process.env.SHOT_LIST) console.log("meshes:", JSON.stringify(await page.evaluate(() => { const c = {}; window.__lux.scene.traverse((o) => { if (o.isMesh && o.visible) { const k = o.name.replace(/[ _-]?[-0-9,.]+$/, "") || "(unnamed)"; c[k] = (c[k] || 0) + 1; } }); return c; })));
    if (process.env.SHOT_UNNAMED) console.log("unnamed:", JSON.stringify(await page.evaluate(() => { const out = []; window.__lux.scene.traverse((o) => { if (o.isMesh && o.name === "") { const g = o.geometry; g.computeBoundingBox(); const b = g.boundingBox; out.push({ type: o.type, parent: o.parent && o.parent.name, verts: g.attributes.position.count, vis: o.visible, pos: [o.position.x, o.position.y, o.position.z].map(Math.round), bb: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(Math.round) }); } }); return out; })));
    if (process.env.SHOT_EVAL) console.log("eval:", JSON.stringify(await page.evaluate(new Function("pose", "return (async () => {" + fs.readFileSync(process.env.SHOT_EVAL, "utf8") + "})()"), pose)));   // SHOT_EVAL=<file.js>: JS run in the page after each pose (window.__lux is the game), its returned value printed
    const file = path.join(outDir, `${pose.name}.png`);
    await page.screenshot({ path: file });
    console.log(pose.name, JSON.stringify(stats));
  }
  if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.slice(0, 10).join("\n"));
} finally {
  await browser.close();
  server.close();
}
