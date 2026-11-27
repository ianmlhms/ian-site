#!/usr/bin/env node
/* Round 7 (A) shots: the skier's poses on the real terrain and the cameras, per resort, in Chromium (Mac GPU) or WebKit.
 *   node scripts/ski/round7a-shots.mjs [--resorts killy,...] [--engine chromium|webkit] [--out DIR] [--only plough,hockey,...]
 * Shots: carve (skis on their edges on the snow), plough, hockey (the parallel stop), speed (the camera up and back at speed), look (the
 * free look turned 120 degrees), horizon (the highest lift top, looking out over the haze), village (a street at ground level), spawn.
 * PNGs <engine>-<resort>-<shot>.png; stack them with look_sheet.py. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax,soelden").split(",");
const engine = opt("--engine", "chromium");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round7/a-shots"));
const only = opt("--only", "") ? opt("--only", "").split(",") : null;
const q = opt("--q", "medium");
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true, args: engine === "chromium" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
const want = (n) => !only || only.includes(n);
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: engine === "chromium" ? 2 : 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${rid}] pageerror`, String(e).slice(0, 300)));
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForTimeout(5000);
    const shot = async (name) => { await page.screenshot({ path: path.join(out, `${engine}-${rid}-${name}.png`) }); console.log(`  ${rid} ${name}`); };
    if (want("spawn")) await shot("spawn");
    // a red piste a little way down: the pose shots
    const setup = await page.evaluate(() => {
      const S = window.__ski;
      const p = S.pistes.list.filter((q) => q.diff === 'red' && q.length > 900).sort((a, b) => b.length - a.length)[0] || S.pistes.list[0];
      const a = p.at(Math.min(300, p.length / 3), {});
      S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
      S.streamer.focus(a.x, a.z);
      return { id: p.id, x: a.x, z: a.z };
    });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 500), setup);
    // as a fast travel does (main.js meshedAround): the full-detail ground meshed before the shots
    await page.evaluate(async () => { const S = window.__ski; for (let i = 0; i < 80 && (S.terrain.stats.pending > 0 || i < 10); i++) await new Promise((r) => setTimeout(r, 100)); });
    // the scripted piste skier (bot.js) steers; `input` only overrides what it says (tuck, brake, hard...); steer: 'bot' keeps its steering
    await page.evaluate(async (id) => {
      const { createBot } = await import('/pb/ski/bot.js');
      const S = window.__ski, bot = createBot(S.pistes.byId.get(id));
      window.__drive = { input: null };
      const tick = () => { const d = window.__drive; if (d.input) { const b = bot(S.state); S.setInput({ ...b, ...d.input, steer: d.input.steer === 'bot' ? b.steer : d.input.steer }); } requestAnimationFrame(tick); };
      tick();
    }, setup.id);
    const drive = (input, ms) => page.evaluate(async ({ input, ms }) => { window.__drive.input = input; await new Promise((r) => setTimeout(r, ms)); }, { input, ms });
    if (want("carve")) {
      await drive({ steer: 'bot', tuck: 0, brake: 0, push: 1, jump: false }, 3000);
      await drive({ steer: 1, tuck: 0, brake: 0, push: 0, jump: false }, 600);
      await page.evaluate(() => window.__ski.orbit(150, 4.2, 0.9, 45)); await page.waitForTimeout(250); await shot("carve");
      await page.evaluate(() => window.__ski.orbit(null));
    }
    if (want("speed")) {
      await drive({ steer: 'bot', tuck: 1, brake: 0, push: 1, jump: false }, 4000);
      await shot("speed");
    }
    if (want("hockey")) {
      await drive({ steer: 'bot', tuck: 1, brake: 0, push: 1, jump: false }, 2500);
      await drive({ steer: 0.2, tuck: 0, brake: 1, push: 0, jump: false, hard: true }, 450);
      await page.evaluate(() => window.__ski.orbit(200, 4.5, 1.0, 45)); await page.waitForTimeout(200); await shot("hockey");
      await page.evaluate(() => window.__ski.orbit(null));
      await drive({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false, hard: true }, 2500);
    }
    if (want("plough")) {
      await drive({ steer: 'bot', tuck: 0, brake: 0, push: 1, jump: false }, 1500);
      await drive({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, 700);
      await page.evaluate(() => window.__ski.orbit(160, 3.6, 1.0, 42)); await page.waitForTimeout(250); await shot("plough");
      await page.evaluate(() => window.__ski.orbit(null));
    }
    if (want("look")) {
      await drive({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }, 1500);
      await page.evaluate(() => { window.__ski.look.turn(-250, -30); });
      await page.waitForTimeout(300); await shot("look");
      await page.evaluate(() => window.__ski.look.reset());
    }
    await page.evaluate(() => { window.__drive.input = null; window.__ski.setInput(null); });
    if (want("horizon")) {
      // the highest lift top, the camera 40 m up, looking out of the resort (towards the nearest box edge)
      const top = await page.evaluate(() => {
        const S = window.__ski, r = S.field, W = S.pistes.list.length ? null : null; void W; void r;
        let best = null; for (const l of S.modes.lifts.list) if (!best || l.top.y > best.top.y) best = l;
        return { x: best.top.x, z: best.top.z };
      });
      await page.evaluate(({ x, z }) => { const S = window.__ski; S.streamer.focus(x, z); }, top);
      await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 800), top);
      for (const [k, a] of [[0, 0], [1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]]) {
        await page.evaluate(({ x, z, a }) => window.__ski.setCamera(x, z, 40, x + Math.cos(a) * 4000, z + Math.sin(a) * 4000, 0, 60), { ...top, a });
        await page.waitForTimeout(k ? 1200 : 3000);
        await shot(`horizon${k}`);
      }
      await page.evaluate(() => window.__ski.setCamera(null));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
