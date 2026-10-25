#!/usr/bin/env node
/* Developer tool: the screenshot series of a wave report.
 *   node scripts/mtb/report_shots.mjs OUT_DIR
 * One headless Chromium (one at a time!), several scenarios; every shot is a PNG in OUT_DIR. */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const BASE = "/pb/mtb.html?debug=1&weather=clear";
const at = (frac) => `const c = m.centre[Math.floor(m.centre.length * ${frac})]; m.teleport(c[0], c[1]);`;
const ride = (frac, speed) => `${at(frac)} const b = m.bike; m.setBike({ vx: Math.cos(b.heading) * ${speed}, vz: Math.sin(b.heading) * ${speed} }); m.setInput({ throttle: 1, brake: 0, steer: 0, jump: false });`;
const flyCam = (x, z, up, yaw, pitch, fov = 62) => `{ const g = m.surface.height(${x}, ${z}) + ${up}; const yr = ${yaw} * Math.PI / 180, pr = ${pitch} * Math.PI / 180; m.setCamera({ x: ${x}, y: g, z: ${z}, tx: ${x} + Math.cos(yr) * Math.cos(pr) * 50, ty: g + Math.sin(pr) * 50, tz: ${z} + Math.sin(yr) * Math.cos(pr) * 50, fov: ${fov} }); }`;

const SCENES = [
  { name: "01-overview-valley", url: `${BASE}&q=high&time=noon`, setup: `${at(0.4)} ${flyCam(1500, 1250, 150, 20, -16)}`, wait: 3500 },
  { name: "02-overview-east", url: `${BASE}&q=high&time=morning`, setup: `${at(0.9)} ${flyCam(2600, 1900, 90, 250, -8)}`, wait: 3500 },
  { name: "03-trail-start", url: `${BASE}&q=high&time=noon`, setup: `${at(0.0)}`, wait: 3000 },
  { name: "04-action-gorge", url: `${BASE}&q=high&time=noon`, setup: `${ride(0.38, 9)}`, wait: 2200 },
  { name: "05-action-fast", url: `${BASE}&q=high&time=evening`, setup: `${ride(0.6, 12)}`, wait: 2400 },
  { name: "06-jump", url: `${BASE}&q=high&time=noon`, setup: `${ride(0.55, 9)} setTimeout(() => m.setBike({ vy: 6.5, grounded: false }), 700);`, wait: 1500 },
  { name: "07-rock-wall", url: `${BASE}&q=high&time=noon`, setup: `${ride(0.778, 6)}`, wait: 2200 },
  { name: "08-sandstone-gorge", url: `${BASE}&q=high&time=morning`, setup: `${ride(0.94, 6)}`, wait: 2200 },
  { name: "40a-gorge-view", url: `${BASE}&q=high&time=noon`, setup: `${at(0.3)} ${flyCam(700, 1330, 70, 10, -14)}`, wait: 3500 },
  { name: "40b-gorge-view", url: `${BASE}&q=high&time=morning`, setup: `${at(0.3)} ${flyCam(1500, 1360, 80, 10, -16)}`, wait: 3500 },
  { name: "40c-gorge-view", url: `${BASE}&q=high&time=evening`, setup: `${at(0.3)} ${flyCam(2250, 1470, 60, 350, -12)}`, wait: 3500 },
  { name: "40d-gorge-view", url: `${BASE}&q=high&time=noon`, setup: `${at(0.3)} ${flyCam(2500, 1800, 50, 200, -10)}`, wait: 3500 },
  { name: "09-evening", url: `${BASE}&q=high&time=evening`, setup: `${at(0.15)}`, wait: 3000 },
  { name: "10-fog", url: "/pb/mtb.html?debug=1&q=high&time=morning&weather=fog", setup: `${at(0.2)}`, wait: 4500 },
  { name: "11-rain-dusk", url: "/pb/mtb.html?debug=1&q=high&time=dusk&weather=rain", setup: `${at(0.45)}`, wait: 4500 },
  { name: "12-night", url: "/pb/mtb.html?debug=1&q=high&time=night&weather=clear", setup: `${at(0.45)}`, wait: 3500 },
  { name: "20-ipad-portrait-medium", url: `${BASE}&q=medium&time=noon`, size: [820, 1180], setup: `${ride(0.25, 8)}`, wait: 2500 },
  { name: "21-ipad-landscape-low", url: `${BASE}&q=low&time=noon`, size: [1180, 820], setup: `${ride(0.7, 8)}`, wait: 2500 },
  { name: "22-ipad-landscape-medium-touch", url: `${BASE}&q=medium&time=morning`, size: [1180, 820], touch: true, setup: `${at(0.05)}`, wait: 2500 },
  { name: "30-far-hills", url: `${BASE}&q=high&time=noon`, setup: `${at(0.1)} ${flyCam(900, 1500, 260, 60, -4, 75)}`, wait: 4000 },
  { name: "31-world-edge", url: `${BASE}&q=high&time=noon`, setup: `${at(0.1)} ${flyCam(200, 2500, 40, 180, -3, 75)}`, wait: 4000 },
];

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
const log = [];
try {
  for (const scene of SCENES) {
    const [w, h] = scene.size || [1280, 720];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: !!scene.touch, isMobile: !!scene.touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(origin + scene.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
    await page.evaluate(`(() => { const m = window.__mtb; ${scene.setup} })()`);
    await page.waitForTimeout(scene.wait || 2500);
    const file = path.join(out, scene.name + ".png");
    await page.screenshot({ path: file });
    const perf = await page.evaluate(() => { const m = window.__mtb; return { fps: m.perf.fps, calls: m.perf.drawCalls, tris: m.perf.triangles, q: m.quality.id }; });
    log.push({ scene: scene.name, ...perf, errors });
    console.log(scene.name, JSON.stringify(perf), errors.length ? "ERRORS " + errors.join(" | ") : "");
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(out, "perf.json"), JSON.stringify(log, null, 1));
