#!/usr/bin/env node
/* Developer tool: where the others' (npc.js + npc-view.js) update + draw time goes, CPU x4 like flow ski-npc. Prints the mean ms a frame
 * (crowd.stats.ms + view.stats.ms), its split, and the top self-time functions of the V8 sampling profile limited to npc.js / npc-view.js.
 *   node scripts/ski/npc-profile.mjs [--runs 3]       (run it through ~/Library/Caches/browser-slot.py) */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const still = args.includes("--still");                       // the player stands: the same scene every run (A / B comparisons)
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 2);
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (e) { /* */ } });
  await page.goto(`${origin}/pb/ski.html?resort=killy&go=1&debug=1&q=low`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 120000 });
  await page.evaluate(() => window.__ski.streamer.release());
  await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 240000, polling: 500 });
  await page.waitForFunction("!!window.__ski.lifts && !!window.__ski.npcs.view && window.__ski.npcs.live", null, { timeout: 60000 });
  await page.evaluate(async () => { for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r)); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const measure = () => page.evaluate(async (still) => {
    const S = window.__ski, a = [], b = [];
    if (!still) S.setInput({ steer: 0.25, tuck: 0, brake: 0, push: 1, jump: false });
    for (let i = 0; i < 150; i++) { await new Promise((r) => requestAnimationFrame(r)); a.push(S.npcs.crowd.stats.ms); b.push(S.npcs.view.stats.ms || 0); }
    S.setInput(null);
    const m = (x) => x.reduce((p, c) => p + c, 0) / x.length;
    return { update: m(a), draw: m(b), total: m(a) + m(b), listed: S.npcs.crowd.stats.listed };
  }, still);
  console.log(await page.evaluate(() => { const c = {}; for (const o of window.__ski.npcs.crowd.list) c[o.kind] = (c[o.kind] || 0) + 1; return JSON.stringify(c); }));
  await measure();                                         // warm up
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  for (let i = 0; i < runs; i++) { const r = await measure(); console.log(`run ${i}: update ${r.update.toFixed(3)} + draw ${r.draw.toFixed(3)} = ${r.total.toFixed(3)} ms (${r.listed} listed)`); }
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const label = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().replace(/\?.*/, "")}:${n.callFrame.lineNumber + 1}`;
  const roots = { "npc update": /^update npc\.js/, "npc-view draw": /^draw npc-view\.js/ };
  const dt = profile.timeDeltas, tot = {}, self = {};
  profile.samples.forEach((id, i) => {
    let n = byId.get(id), leaf = label(n), root = null;
    for (let cur = id; cur; cur = parent.get(cur)) { const l = label(byId.get(cur)); for (const [k, re] of Object.entries(roots)) if (re.test(l)) root = k; if (root) break; }
    if (!root) return;
    tot[root] = (tot[root] || 0) + (dt[i] || 0);
    const m = (self[root] ||= new Map());
    m.set(leaf, (m.get(leaf) || 0) + (dt[i] || 0));
  });
  for (const [root, m] of Object.entries(self)) {
    console.log(`== ${root}: ${(tot[root] / 1000 / runs).toFixed(1)} ms per run of 150 frames`);
    for (const [k, v] of [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14)) console.log(`${(v / 1000 / runs).toFixed(1).padStart(7)} ms ${(100 * v / tot[root]).toFixed(1).padStart(5)} %  ${k}`);
  }
} finally {
  await browser.close();
  server.close();
}
