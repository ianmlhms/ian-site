#!/usr/bin/env node
/* Developer tool: ride a trail with the scripted bot in the LIVE game loop and record every frame time.
 *   node scripts/mtb/smooth_probe.mjs [--browser chromium|webkit] [--q low|medium|high] [--trail hallerbach-flow] [--seconds 60] [--scale 0.75] [--size 1440x900] [--warm 3] [--json out.json]
 * Per-frame time = gap between two requestAnimationFrame callbacks. The suspect updates (terrain / forest / rocks / town / props / water / render) are wrapped with
 * timers so every frame above the threshold is attributed. Exit 0 always (report tool). */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const browserName = opt("--browser", "chromium");
const q = opt("--q", "high");
const trail = opt("--trail", "hallerbach-flow");
const seconds = Number(opt("--seconds", "60"));
const scale = Number(opt("--scale", "0.75"));
const warm = Number(opt("--warm", "3"));
const [W, H] = opt("--size", "1440x900").split("x").map(Number);
const jsonOut = opt("--json", "");
const spikeMs = Number(opt("--spike", "25"));
const cpu = Number(opt("--cpu", "1"));                 // Chromium: CDP CPU throttling rate (4 = a machine 4x slower)
const cbMs = Number(opt("--cbms", "10"));               // list rAF callbacks slower than this with their breakdown
const disable = opt("--disable", "").split(",").filter(Boolean);        // experiment: no-op these updates (forest, props, terrain, rocks, town, foam)

async function launch() {
  if (browserName === "webkit") {
    const dir = process.env.PLAYWRIGHT_DIR || "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright";
    const mod = await import(pathToFileURL(path.join(dir, "index.mjs")).href).catch(() => import(pathToFileURL(path.join(dir, "index.js")).href));
    return mod.webkit.launch();
  }
  return launchBrowser({ fullChromium: true });
}

const browser = await launch();
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on("console", (m) => { if (m.text().startsWith("[probe]")) console.log(m.text()); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear&mode=free&trail=${trail}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000 });
  if (cpu > 1 && browserName === "chromium") { const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu }); }
  const res = await page.evaluate(async ({ seconds, scale, warm, spikeMs, disable, cbMs }) => {
    const { createBot } = await import("/pb/mtb/bot.js");
    const m = window.__mtb;
    const t = m.trail;
    const bot = createBot(t.centre, t.grade, { speedScale: scale });
    const acc = {};                       // per-frame section timings (ms), flushed at render()
    let lastSec = {};
    const sections = [];                  // one record per rendered frame
    const wrap = (obj, name, label) => {
      const f = obj[name];
      obj[name] = function (...a) { const t0 = performance.now(); const r = f.apply(this, a); acc[label] = (acc[label] || 0) + performance.now() - t0; return r; };
    };
    wrap(m.terrain, "update", "terrain"); wrap(m.forest, "update", "forest"); wrap(m.rockView, "update", "rocks"); wrap(m.town, "update", "town");
    wrap(m.props, "update", "props");
    wrap(m.surface, "block", "blk.surface"); wrap(m.trees, "block", "blk.trees"); wrap(m.undergrowth, "block", "blk.under"); wrap(m.rocks, "block", "blk.rocks"); wrap(m.water, "updateFoam", "foam"); wrap(m.env, "update", "env");
    const dis = { forest: [m.forest, "update"], props: [m.props, "update"], terrain: [m.terrain, "update"], rocks: [m.rockView, "update"], town: [m.town, "update"], foam: [m.water, "updateFoam"] };
    for (const k of disable) if (dis[k]) dis[k][0][dis[k][1]] = () => {};
    const cbs = [];                       // every game rAF callback's own JS duration
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => origRaf((now) => { const t0 = performance.now(); for (const k of Object.keys(acc)) delete acc[k]; cb(now); const d = performance.now() - t0; cbs.push([now, d, d > cbMs ? { ...lastSec } : null]); });
    const origRender = m.renderer.render.bind(m.renderer);
    let progs = m.renderer.info.programs ? m.renderer.info.programs.length : 0;
    m.renderer.render = (s, c) => {
      const t0 = performance.now(); origRender(s, c); const dt = performance.now() - t0;
      const p = m.renderer.info.programs ? m.renderer.info.programs.length : 0;
      sections.push({ ...acc, render: dt, newProg: p - progs, calls: m.renderer.info.render.calls, tris: m.renderer.info.render.triangles, geos: m.renderer.info.memory.geometries });
      if (p !== progs) { const ids = m.renderer.info.programs.map((q) => q.id).slice(-(p - progs || 1)); const names = ids.map((id) => { const o = []; m.scene.traverse((ob) => { const mat = ob.material; if (!mat || Array.isArray(mat)) return; const pr = m.renderer.properties.get(mat).currentProgram; if (pr && pr.id === id) o.push(ob.name || ob.type); }); return '#' + id + '[' + o.slice(0, 4).join('|') + ']'; }); sections[sections.length - 1].progNames = names; console.log('[probe] new program(s) at t=' + (performance.now() / 1000).toFixed(1) + ' render ' + dt.toFixed(1) + ' ms: ' + names.join(',')); }
      progs = p; lastSec = { ...acc, render: dt, newProg: p - progs }; for (const k of Object.keys(acc)) delete acc[k];
    };
    const frames = [];                    // { t, dt, secIdx }
    let prev = 0, start = 0, stop = false;
    await new Promise((resolve) => {
      const tick = (now) => {
        if (!start) start = now;
        if (prev) frames.push({ t: (now - start) / 1000, dt: now - prev, sec: sections.length, v: Math.hypot(m.bike.vx, m.bike.vz) * 3.6 });
        prev = now;
        m.setInput(bot.input(m.bike));
        if (Math.floor((now - start) / 5000) !== Math.floor((prev - start) / 5000) || frames.length % 300 === 0) console.log('[probe] t=' + ((now - start) / 1000).toFixed(1) + ' frames=' + frames.length + ' odo=' + m.bike.odometer.toFixed(0));
        if ((now - start) / 1000 >= seconds) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    m.setInput(null);
    const spikes = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.t < warm || f.dt <= spikeMs) continue;
      // the frame work that produced this gap is the section record just before f.sec (the render that ended this interval)
      const s = sections[f.sec - 1] || {};
      spikes.push({ t: +f.t.toFixed(2), dt: +f.dt.toFixed(1), v: +f.v.toFixed(0), sec: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(1)])) });
    }
    return { cbs: cbs.map(([n, d, sec]) => [+((n - start) / 1000).toFixed(3), +d.toFixed(1), sec && Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, +v.toFixed(1)]))]), dts: frames.map((f) => [+f.t.toFixed(3), +f.dt.toFixed(2)]), spikes, odo: m.bike.odometer, mode: m.game.mode, progress: bot.progress(), n: bot.plan.pts.length };
  }, { seconds, scale, warm, spikeMs, disable, cbMs });
  const d = res.dts.filter(([t]) => t >= warm).map(([, dt]) => dt).sort((a, b) => a - b);
  const pct = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  const out = { browser: browserName, q, trail, frames: d.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: d[d.length - 1], over25: d.filter((x) => x > 25).length, over40: d.filter((x) => x > 40).length, meanFps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), odo: Math.round(res.odo), progress: `${res.progress}/${res.n}` };
  console.log(JSON.stringify(out));
  for (const s of res.spikes) console.log("  spike", JSON.stringify(s));
  for (const [t, d, sec] of res.cbs) if (t >= warm && sec) console.log("  slow-callback", t, d, JSON.stringify(sec));
  const jsMax = res.cbs.filter(([t]) => t >= warm).map(([, d]) => d).sort((a, b) => a - b);
  console.log("  js per rAF callback (all callbacks): p50", jsMax[Math.floor(jsMax.length / 2)], "p99", jsMax[Math.floor(jsMax.length * 0.99)], "max", jsMax[jsMax.length - 1]);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ out, spikes: res.spikes, dts: res.dts, cbs: res.cbs }));
} finally { await browser.close(); server.close(); }
