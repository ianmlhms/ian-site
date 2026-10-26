#!/usr/bin/env node
/* Developer tool: ride a trail with the reference rider in the real game loop (many frames per tick, no teleport) and take screenshots at chosen distances.
 *   node scripts/mtb/trail-shots.mjs OUTDIR --trail id --at name:metres[,name:metres...] [--fromEnd] [--size 1280x720] [--q high] [--time noon] [--weather clear] [--hideui] [--season summer|autumn] [--finish name]
 * metres = arc length from the start (or from the end with --fromEnd); `--finish name` also rides to the end and shoots the finish. One browser at a time. */
import { launchBrowser, startServer } from "../flows/lib.mjs";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const trail = opt("--trail", "ernz-waldwee");
const fromEnd = args.includes("--fromEnd");
const hideUi = args.includes("--hideui");
const stops = (opt("--at", "") || "").split(",").filter(Boolean).map((s) => { const [name, m] = s.split(":"); return { name, m: Number(m) }; });
const finishName = opt("--finish", "");
fs.mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(`${origin}/pb/mtb.html?debug=1&q=${opt("--q", "high")}&time=${opt("--time", "noon")}&weather=${opt("--weather", "clear")}&season=${opt("--season", "summer")}&trail=${trail}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (id) => {
    const { createBot } = await import("/pb/mtb/bot.js");
    const m = window.__mtb;
    m.setProgress({ ...m.progress, m: "333333" });                  // every trail unlocked (dev tool: the screenshots never save)
    m.enterCard(id);
    m.startRun();
    window.__bot = createBot(m.trail.centre.slice(0, m.trail.arch.index + 4), m.trail.grade);
    for (let i = 0; i < 200; i++) m.tick(1 / 60, { throttle: 0, brake: 0, steer: 0, jump: false });
  }, trail);
  if (hideUi) await page.addStyleTag({ content: ".mhud,.mcard,.mtouch,.mhint,#mtbUi,.mfin{display:none!important}" });
  const info = await page.evaluate(() => ({ length: window.__mtb.trail.length, mode: window.__mtb.game.mode }));
  console.log("trail length", info.length.toFixed(0), "mode", info.mode);
  const ride = (target, untilFinish) => page.evaluate(([target, untilFinish]) => {
    const m = window.__mtb;
    let frames = 0;
    while (frames++ < 60 * 3600 && m.game.mode === "run" && (untilFinish || m.trail.s[Math.min(m.trail.count - 1, m.game.progress)] < target)) m.tick(1 / 60, window.__bot.input(m.bike));
    m.setInput({ throttle: 0.15, brake: 0, steer: 0, jump: false });
    return { s: m.trail.s[Math.min(m.trail.count - 1, m.game.progress)], mode: m.game.mode, x: m.bike.x, z: m.bike.z };
  }, [target, untilFinish]);
  for (const st of stops) {
    const target = fromEnd ? info.length - st.m : st.m;
    const r = await ride(target, false);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, `${st.name}.png`) });
    console.log("saved", st.name, "at s", r.s.toFixed(0), "mode", r.mode, `(${r.x.toFixed(0)}, ${r.z.toFixed(0)})`);
    if (r.mode !== "run") break;
  }
  if (finishName) {
    const r = await ride(0, true);
    await page.waitForTimeout(600);
    await page.waitForFunction(() => window.__mtb.focusBlend >= 0.999 || window.__mtb.game.mode !== "finished", null, { timeout: 60000 }).catch(() => {});        // (the glide to the sight at the end takes ~1.7 s of game time)
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, `${finishName}.png`) });
    console.log("saved", finishName, "mode", r.mode);
  }
} finally { await browser.close(); server.close(); }
