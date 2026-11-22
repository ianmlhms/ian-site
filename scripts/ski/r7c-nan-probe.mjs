/* R7-C debug probe: a park run on Niddreg, prints page errors with their stacks, the draw calls by object name, and any non-finite field
 * of the skier state.   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/r7c-nan-probe.mjs */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", (e.stack || e.message).split("\n").slice(0, 6).join(" | ")));
  await page.goto(origin + "/pb/ski.html?resort=killy&map=1&debug=1&q=low&timescale=3", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 120000 });
  await page.evaluate(() => { const p = window.__ski.parkLayout; return window.__ski.streamer.ready(p.top.x, p.top.z, 600); });
  await page.evaluate(() => window.__ski.startPark());
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => { const s = window.__ski.state; return Object.entries(s).filter(([, v]) => typeof v === "number" && !Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join(",") + ` phase=${window.__ski.game.phase} v=${s.speed.toFixed(1)}`; });
    console.log(i, r);
  }
  const calls = await page.evaluate(() => {
    const k = window.__ski, r = k.renderer, seen = [];
    k.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible) { let v = true; for (let p = o.parent; p; p = p.parent) if (!p.visible) v = false; if (v) seen.push(o.name || o.type); } });
    const counts = {};
    for (const n of seen) counts[n] = (counts[n] || 0) + 1;
    return { info: k.info(), counts };
  });
  console.log(JSON.stringify(calls.info), JSON.stringify(Object.entries(calls.counts).filter(([n]) => /ski-|spray|track|aval|fp|course/.test(n))));
} finally { await browser.close(); server.close(); }
