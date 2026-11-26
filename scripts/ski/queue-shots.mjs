#!/usr/bin/env node
/* Developer tool (lift lines, 26 Nov 2026): the queue mazes with the other skiers in them, and the boarding of the three kinds, on the GPU.
 *   node scripts/ski/queue-shots.mjs OUT_DIR [--resorts killy,3vallees,arlberg] [--time midday|evening] [--q medium] [--lifts 3]
 *        [--board 1] [--size 1180x820] [--dpr 1] [--no-gpu]
 * Per resort: the busiest-looking maze lifts (a 6-seat chair first, a gondola, a 4-seat chair) from a fixed camera beside the maze,
 * a few frames apart (the line moving), the draw calls / triangles; --board 1: the player boards a chair, a gondola and a drag lift
 * (frames through the walk-in, the gate / doors / bar, the start; the top too). Run it through ~/Library/Caches/browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0] || path.join(process.env.HOME, "Library/Caches/ski-work/queues");
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,arlberg").split(",");
const time = opt("--time", "midday");
const q = opt("--q", "medium");
const nLifts = Number(opt("--lifts", "3"));
const board = opt("--board", "0") === "1";
const [W, H] = opt("--size", "1180x820").split("x").map(Number);
const dpr = Number(opt("--dpr", "1"));
fs.mkdirSync(out, { recursive: true });
const GL = args.includes("--no-gpu") ? [] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await launchBrowser({ fullChromium: true, args: GL });
const { server, origin } = await startServer();
const report = [];
const wait = (page, ms) => page.waitForTimeout(ms);
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.addInitScript(() => { try { localStorage.setItem("pb_ski_npcs", "1"); } catch (error) { /* ignore */ } });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&res=fixed&weather=sun&time=${time}&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
    await page.evaluate(() => window.__ski.streamer.release());
    await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
    await page.waitForFunction("!!window.__ski.village && !!window.__ski.lifts", null, { timeout: 60000 }).catch(() => {});
    await wait(page, 2000);
    const picks = await page.evaluate((n) => {
      const S = window.__ski, w = S.modes.lifts.world, out = [];
      const score = (l, site) => (site.key === "chair" ? (site.path.seats >= 6 ? 30 : site.path.seats >= 4 ? 10 : 0) : site.key === "gondola" ? 20 : 5) + site.queue.len;
      const all = S.modes.lifts.list.map((l) => ({ l, site: w.sites.get(l.index) })).filter((o) => o.site && o.site.queue).sort((a, b) => score(b.l, b.site) - score(a.l, a.site));
      const kinds = new Set();
      for (const o of all) { const k = o.site.key + (o.site.path.seats >= 6 ? "6" : ""); if (kinds.has(k)) continue; kinds.add(k); out.push(o.l.id); if (out.length >= n) break; }
      for (const o of all) { if (out.length >= n) break; if (!out.includes(o.l.id)) out.push(o.l.id); }
      return out;
    }, nLifts);
    for (const id of picks) {
      await page.evaluate((id) => window.__ski.goFree(id), id);
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 30000 });
      await wait(page, 3500);
      // step out of the zone (else he holds the line): 6 m back along the free lane's entry side, then look at the maze from its side
      const info = await page.evaluate((id) => {
        const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), m = site.queue;
        const e = m.lanes[m.free].entry;
        S.placeHold(e.x + (e.x - site.wait.x) * 0.6, e.z + (e.z - site.wait.z) * 0.6, 0);
        // the camera: off the maze's +a side, a little back and up, looking at the middle between the zone and the maze
        const mid = { x: (site.wait.x + m.x) / 2, z: (site.wait.z + m.z) / 2 };
        const cx = mid.x + m.fx * 9 + m.rx * 7, cz = mid.z + m.fz * 9 + m.rz * 7;
        S.setCamera(cx, cz, 5.5, mid.x, mid.z, 0.6, 55);
        return { name: l.name, kind: site.key, seats: site.path.seats, lanes: m.n, len: +m.len.toFixed(1) };
      }, id);
      await wait(page, 1500);
      const hide = await page.evaluate(() => { const e = document.getElementById("ui"); if (e) e.style.visibility = "hidden"; });
      void hide;
      for (let k = 0; k < 3; k++) {
        await page.screenshot({ path: path.join(out, `${rid}-${time}-${id}-${k}.png`) });
        await wait(page, 1600);
      }
      const stats = await page.evaluate(() => { const S = window.__ski, i = S.info(); return { calls: i.calls, tris: i.triangles, listed: S.npcs.crowd.stats.listed }; });
      // a wider look from behind the maze, over the line to the station
      await page.evaluate((id) => {
        const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), m = site.queue;
        const back = m.lanes[0].entry;
        S.setCamera(back.x + m.rx * 7 + m.fx * 3, back.z + m.rz * 7 + m.fz * 3, 4.5, site.wait.x, site.wait.z, 1.0, 60);
      }, id);
      await wait(page, 1200);
      await page.screenshot({ path: path.join(out, `${rid}-${time}-${id}-back.png`) });
      await page.evaluate(() => { window.__ski.setCamera(null); const e = document.getElementById("ui"); if (e) e.style.visibility = ""; });
      report.push({ rid, time, id, ...info, ...stats });
    }
    if (errors.length) report.push({ rid, errors: errors.slice(0, 5) });
    await ctx.close();
  }
} finally {
  fs.writeFileSync(path.join(out, `report-${time}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
}
