#!/usr/bin/env node
/* Developer tool (round 7): Ski Alpen in Playwright WebKit (the engine of Safari and the school iPads) next to Chromium.
 *   node scripts/ski/webkit-probe.mjs [--resorts killy,3vallees] [--q low,medium] [--out DIR] [--engines webkit,chromium]
 * Boots straight into the free ride, waits for the start tiles, prints every console error / warning (shader compile logs included), the
 * WebGL caps the look depends on, a picture check (distinct colours, sky vs snow brightness) and saves a screenshot per engine, so the
 * two can be compared side by side. Run it through browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy").split(",");
const levels = opt("--q", "low").split(",");
const engines = opt("--engines", "webkit,chromium").split(",");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round7/webkit"));
const extra = opt("--extra", "");
fs.mkdirSync(out, { recursive: true });

const { server, origin } = await startServer();
const results = [];
try {
  for (const engine of engines) {
    process.env.FLOW_BROWSER = engine;
    const browser = await launchBrowser({ fullChromium: true, args: engine === "webkit" ? [] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
    for (const rid of resorts) for (const q of levels) {
      const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const logs = [];
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text().slice(0, 600)}`); });
      page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 600)}`));
      await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&weather=sun&time=midday&resort=${rid}${extra}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
      await page.waitForTimeout(9000);
      const info = await page.evaluate(() => {
        const S = window.__ski, r = S.renderer, gl = r.getContext();
        const caps = r.capabilities;
        const ext = (n) => !!gl.getExtension(n);
        const res = S.resolution ? S.resolution() : {};
        // read the canvas through a 2D copy (the default framebuffer may be cleared after compositing)
        const c = document.getElementById('skiCanvas');
        const k = document.createElement('canvas'); k.width = 96; k.height = 72;
        const g = k.getContext('2d');
        S.post.render(S.scene, S.camera);
        g.drawImage(c, 0, 0, 96, 72);
        const d = g.getImageData(0, 0, 96, 72).data;
        const set = new Set(); let top = [0, 0, 0], low = [0, 0, 0];
        for (let y = 0; y < 72; y++) for (let x = 0; x < 96; x++) {
          const i = (y * 96 + x) * 4; set.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
          const t = y < 18 ? top : y > 54 ? low : null; if (t) { t[0] += d[i]; t[1] += d[i + 1]; t[2] += d[i + 2]; }
        }
        const n = 96 * 18;
        return {
          ua: navigator.userAgent.slice(0, 120), webgl2: caps.isWebGL2, precision: caps.precision, maxSamples: caps.maxSamples, floatLinear: ext('OES_texture_float_linear'),
          cbf: ext('EXT_color_buffer_float'), cbhf: ext('EXT_color_buffer_half_float'), res, glError: gl.getError(), colours: set.size,
          me: (() => { const st = S.state; return { x: Math.round(st.x), z: Math.round(st.z), y: +st.y.toFixed(2), ground: +S.surface.height(st.x, st.z).toFixed(2), field: +S.field.height(st.x, st.z).toFixed(2), cam: [S.camera.position.x, S.camera.position.y, S.camera.position.z].map((v) => +v.toFixed(1)), camGround: +S.surface.height(S.camera.position.x, S.camera.position.z).toFixed(2), phase: S.game.phase, speed: +st.speed.toFixed(2), grounded: st.grounded }; })(),
          sky: top.map((v) => Math.round(v / n)), ground: low.map((v) => Math.round(v / n)), calls: S.info().calls,
        };
      });
      const file = path.join(out, `${engine}-${rid}-${q}.png`);
      await page.screenshot({ path: file });
      results.push({ engine, rid, q, ...info, logs, file });
      console.log(`\n== ${engine} ${rid} ${q}: webgl2 ${info.webgl2} ${info.precision} samples ${info.maxSamples} cbf ${info.cbf} cbhf ${info.cbhf} floatLinear ${info.floatLinear} glError ${info.glError}`);
      console.log(`   me ${JSON.stringify(info.me)}`);
      console.log(`   colours ${info.colours}, sky ${info.sky}, ground ${info.ground}, calls ${info.calls}, res ${JSON.stringify(info.res)}`);
      for (const l of logs.slice(0, 25)) console.log(`   ${l}`);
      await ctx.close();
    }
    await browser.close();
  }
} finally {
  server.close();
}
fs.writeFileSync(path.join(out, "probe.json"), JSON.stringify(results, null, 1));
