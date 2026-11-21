#!/usr/bin/env node
/* Developer tool (round 7): the draw calls at every piste of a resort, to find the worst spots (target: <= 160 on Niddreg).
 *   node scripts/ski/calls-sweep.mjs --resort killy [--q low] [--every 1] [--top 8] [--only id,id] [--wait 450]
 * Free ride with all tiles in (no CPU throttle: only the count matters), the skier placed at each piste's start gate and half way down
 * facing down the piste, the chase camera settled; renderer.info after a few frames. The worst spots are printed with the calls per
 * scene group (onAfterRender counts every draw of every mesh, attributed to its top-level group). Run it through browser-slot.py. */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resort = opt("--resort", "killy"), q = opt("--q", "low"), every = Number(opt("--every", "1")), top = Number(opt("--top", "8")), wait = Number(opt("--wait", "450"));
const only = opt("--only", "");

const browser = await launchBrowser({ fullChromium: true, args: args.includes("--gpu") ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&res=fixed&weather=sun&time=midday&resort=${resort}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
  await page.evaluate(() => { window.__ski.streamer.release(); });
  await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(3000);
  const spots = await page.evaluate(({ every, only }) => {
    const S = window.__ski, out = [];
    const ids = only ? only.split(",") : null;
    S.pistes.list.forEach((p, i) => {
      if (ids ? !ids.includes(p.id) : i % every) return;
      for (const s of p.length > 600 ? [2, p.length / 2] : [2]) { const a = p.at(s, {}); out.push({ id: p.id, name: p.name, s: Math.round(s), x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx) }); }
    });
    // attribute every draw to its top-level group
    const counts = window.__callCounts = {};
    window.__patchCalls = () => S.scene.traverse((o) => {
      if ((!o.isMesh && !o.isPoints && !o.isLine && !o.isLineSegments) || o.__counted) return;
      o.__counted = true;
      let t = o; while (t.parent && t.parent !== S.scene) t = t.parent;
      const key = t.name || o.name || t.type, own = o.onAfterRender;
      o.onAfterRender = function (...a) { counts[key] = (counts[key] || 0) + 1; return own.apply(this, a); };
    });
    return out;
  }, { every, only });
  console.log(`${resort} ${q}: ${spots.length} spots`);
  const results = [];
  for (const sp of spots) {
    const r = await page.evaluate(async ({ sp, wait }) => {
      const S = window.__ski;
      S.place(sp.x, sp.z, sp.h);
      S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
      await new Promise((res) => setTimeout(res, wait));
      window.__patchCalls();
      for (const k of Object.keys(window.__callCounts)) delete window.__callCounts[k];
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const by = { ...window.__callCounts };
      return { calls: S.info().calls, by };
    }, { sp, wait });
    results.push({ ...sp, ...r });
  }
  results.sort((a, b) => b.calls - a.calls);
  const calls = results.map((r) => r.calls);
  console.log(`  max ${calls[0]}  p90 ${calls[Math.floor(calls.length * 0.1)]}  median ${calls[Math.floor(calls.length / 2)]}`);
  for (const r of results.slice(0, top)) {
    const by = Object.entries(r.by).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(`  ${String(r.calls).padStart(4)}  ${r.name} @${r.s} m   [${by}]`);
  }
  console.log(`RESULT resort=${resort} q=${q} max=${calls[0]} worst=${results[0] ? results[0].id : ""}`);
} finally {
  await browser.close();
  server.close();
}
