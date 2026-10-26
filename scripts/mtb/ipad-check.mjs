#!/usr/bin/env node
/* Developer tool: the best iPad check we can do without an iPad. Opens the game in WebKit (the Safari engine; --engine chromium for the JS heap numbers) at the real iPad viewport sizes with touch,
 * at `low` and `medium`, and measures on this machine's GPU: what quality the automatic choice picks, the milliseconds per frame at five busy places (a pixel read-back after every render, so the
 * 60 Hz vsync does not hide headroom), the frames per second while riding with the reference rider, and the memory (JS heap in Chromium, the estimated GPU bytes of every texture and buffer, the
 * resident size of the WebKit processes).
 *   node scripts/mtb/ipad-check.mjs [--engine webkit|chromium] [--sizes 1194x834,834x1194] [--q low,medium] [--dpr 2] [--out file.json]
 * One browser at a time. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const engine = opt("--engine", "webkit");
const sizes = opt("--sizes", "1194x834,834x1194").split(",").map((s) => s.split("x").map(Number));
const qualities = opt("--q", "low,medium").split(",");
const dpr = Number(opt("--dpr", "2"));
const GLOBAL_PLAYWRIGHT = "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright";
async function importPlaywright() {
  try { return await import("playwright"); } catch { /* fall through */ }
  for (const dir of [process.env.PLAYWRIGHT_DIR, GLOBAL_PLAYWRIGHT].filter(Boolean)) for (const entry of ["index.mjs", "index.js"]) { const file = path.join(dir, entry); if (fs.existsSync(file)) return import(pathToFileURL(file).href); }
  throw new Error("Playwright not found");
}
const POSES = [
  { name: "trail start (card)", run: (m) => m.enterCard(m.trail.id) },
  { name: "gorge (Haller, 780 m)", run: (m) => { const c = m.centre[780], d = m.centre[786]; const yaw = Math.atan2(d[1] - c[1], d[0] - c[0]); m.teleport(c[0], c[1]); const y = m.surface.height(c[0], c[1]) + 1.6; m.setCamera({ x: c[0], y, z: c[1], tx: c[0] + Math.cos(yaw) * 50, ty: y - 0.5, tz: c[1] + Math.sin(yaw) * 50, fov: 70 }); } },
  { name: "Schiessentuempel falls", run: (m) => { const c = m.cascade, at = (u, v) => ({ x: c.x + c.f[0] * u + c.a[0] * v, z: c.z + c.f[1] * u + c.a[1] * v }); const p = at(11, -0.8), q = at(0, 0); m.teleport(p.x, p.z); m.setCamera({ x: p.x, y: c.poolY + 1.5, z: p.z, tx: q.x, ty: c.poolY + 1.6, tz: q.z, fov: 46 }); } },
  { name: "Berdorf village", run: (m) => { m.teleport(4950, 2030); m.setCamera({ x: 4950, y: m.surface.height(4950, 2030) + 22, z: 2030, tx: 5100, ty: m.surface.height(5100, 1790) + 8, tz: 1790, fov: 58 }); } },
  { name: "Beaufort castle", run: (m) => { m.teleport(585, 432); m.setCamera({ x: 585, y: m.surface.height(585, 432) + 4, z: 432, tx: 622, ty: m.surface.height(622, 380) + 6, tz: 380, fov: 55 }); } },
];

/** In the page: estimated bytes of every distinct texture and geometry buffer in the scene, plus the drawing buffer. */
const MEMORY_JS = () => {
  const m = window.__mtb, seenT = new Set(), seenG = new Set();
  let tex = 0, geo = 0;
  const addTex = (t) => { if (!t || !t.isTexture || seenT.has(t)) return; seenT.add(t); const im = t.image; const w = (im && (im.width || (im.data && im.data.length))) || 0, h = (im && im.height) || 1; tex += w * h * 4 * (t.generateMipmaps === false || t.minFilter === 1006 || t.minFilter === 1003 ? 1 : 1.34); };
  m.scene.traverse((o) => {
    if (o.geometry && !seenG.has(o.geometry)) { seenG.add(o.geometry); for (const a of Object.values(o.geometry.attributes)) geo += (a.array ? a.array.byteLength : 0); if (o.geometry.index) geo += o.geometry.index.array.byteLength; }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) for (const u of Object.values(mat.uniforms || {})) addTex(u && u.value); });
  for (const v of Object.values(m.env.uniforms)) addTex(v.value);
  const rt = m.renderer.getDrawingBufferSize(new window.THREE.Vector2());
  const buffer = rt.x * rt.y * 4 * 3;                                // colour + depth + the resolve copy
  return { textureMB: tex / 1048576, geometryMB: geo / 1048576, bufferMB: buffer / 1048576, textures: seenT.size, geometries: seenG.size, canvas: [rt.x, rt.y] };
};
const FRAME_JS = async () => {
  const m = window.__mtb, gl = m.renderer.getContext();
  m.stop();                                                          // the game loop stops: only the measured renders run
  await new Promise((r) => setTimeout(r, 120));
  for (let i = 0; i < 6; i++) { m.renderer.render(m.scene, m.camera); }
  const px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);       // reading a pixel back waits for the GPU (gl.finish() does not in WebKit)
  sync();
  const times = [];
  for (let i = 0; i < 40; i++) { const t0 = performance.now(); m.renderer.render(m.scene, m.camera); sync(); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  return { median: times[20], p90: times[36], draw: m.renderer.info.render.calls, tris: m.renderer.info.render.triangles };
};
/** Resident size (MB) of the Chromium processes (browser, GPU, renderer) via the DevTools process list. */
const chromiumRssMB = async (browser) => {
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  const pids = processInfo.map((p) => p.id);
  const out = execSync(`ps -o rss= -p ${pids.join(",")}`, { encoding: "utf8" }).trim().split("\n").map(Number);
  return out.reduce((a, b) => a + b, 0) / 1024;
};
const rssNow = () => { try { return execSync("ps -axo rss=,command= | grep -i -E 'com.apple.WebKit|WebKit.WebContent|WebKit.GPU|WebKit.Networking|pw_run' | grep -v grep | awk '{s+=$1} END {print s/1024}'", { encoding: "utf8" }).trim(); } catch { return "?"; } };

const { webkit, chromium } = await importPlaywright();
const { server, origin } = await startServer();
const report = { engine, dpr, sizes, results: [] };
try {
  for (const [w, h] of sizes) {
    for (const q of qualities) {
      const baseline = Number(rssNow()) || 0;
      const browser = engine === "webkit" ? await webkit.launch() : await launchBrowser({ fullChromium: true });
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: engine !== "webkit" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      const t0 = Date.now();
      await page.goto(`${origin}/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&season=summer`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000 });
      const bootMs = Date.now() - t0;
      const info = await page.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches, cores: navigator.hardwareConcurrency, touchPoints: navigator.maxTouchPoints, quality: window.__mtb.quality.id, ua: navigator.userAgent.slice(0, 60) }));
      const row = { size: `${w}x${h}`, q, bootMs, info, poses: [], ride: null, errors };
      for (const pose of POSES) {
        await page.evaluate(`(${pose.run.toString()})(window.__mtb)`);
        await page.waitForTimeout(1800);
        const r = await page.evaluate(FRAME_JS);
        const mem = await page.evaluate(MEMORY_JS);
        row.poses.push({ name: pose.name, ms: +r.median.toFixed(1), p90: +r.p90.toFixed(1), calls: r.draw, tris: r.tris, mem });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1", null, { timeout: 180000 });
      }
      // ride 10 s with the reference rider on the first trail in the real loop: fps as the game itself measures it
      await page.evaluate(async () => {
        const { createBot } = await import("/pb/mtb/bot.js");
        const m = window.__mtb;
        m.setCamera(null);
        m.enterCard(m.trail.id); m.startRun();
        const bot = createBot(m.trail.centre.slice(0, m.trail.arch.index + 4), m.trail.grade);
        window.__ride = { fps: [], ms: [], timer: setInterval(() => { m.setInput(bot.input(m.bike)); }, 40), sample: setInterval(() => { window.__ride.fps.push(m.perf.fps); window.__ride.ms.push(m.perf.ms); }, 1000) };
      });
      await page.waitForTimeout(12000);
      row.ride = await page.evaluate(() => { const r = window.__ride; clearInterval(r.timer); clearInterval(r.sample); const f = r.fps.filter((x) => x > 0), ms = r.ms.filter((x) => x > 0); return { fpsMin: Math.min(...f), fpsAvg: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), msMax: Math.max(...ms), speed: Math.round(window.__mtb.perf.fps) }; });
      row.heapMB = await page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null));
      row.rssMB = engine === "chromium" ? +(await chromiumRssMB(browser)).toFixed(0) : +(Number(rssNow()) - baseline).toFixed(0);          // the processes of this browser (before / after the launch: other browsers on the machine do not count)
      report.results.push(row);
      console.log(JSON.stringify(row));
      await browser.close();
    }
  }
  // the automatic quality: no ?q, the iPad Pro situation (touch, coarse pointer): what does the game pick?
  const browser = engine === "webkit" ? await webkit.launch() : await launchBrowser({ fullChromium: true });
  const ctx = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.removeItem("pb_mtb_quality"); } catch (e) { /* ignore */ } });
  await page.goto(`${origin}/pb/mtb.html?debug=1&time=noon&weather=clear`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1", null, { timeout: 180000 });
  report.auto = await page.evaluate(() => ({ quality: window.__mtb.quality.id, coarse: matchMedia("(pointer: coarse)").matches, cores: navigator.hardwareConcurrency, touchPoints: navigator.maxTouchPoints }));
  console.log("auto quality (iPad UA, touch):", JSON.stringify(report.auto));
  await browser.close();
} finally { server.close(); }
const outFile = opt("--out", "");
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
