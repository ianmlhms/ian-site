#!/usr/bin/env node
/* Developer tool: the other skiers (pb/ski/npc.js) in the real game, on the GPU: screenshots + numbers per resort.
 *   node scripts/ski/npc-shots.mjs OUT_DIR [--resorts killy,3vallees,zermatt] [--q medium] [--size 1180x820] [--dpr 2] [--no-gpu]
 *        [--only village,piste,station,chair]
 * Scenes (each resort): village = the free ride's first lift in its village (chase camera); piste = a busy blue piste half way down
 * (the camera behind the skier); station = a fixed camera on a chair lift's bottom station (the queue); chair = riding that chair lift,
 * the chairs ahead with others on them. Per scene: the draw calls / triangles with the other skiers on and off, how many are drawn
 * (near / crowd / riders), their CPU ms. Run it through ~/Library/Caches/browser-slot.py (one browser at a time). */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0] || path.join(process.env.HOME, "Library/Caches/ski-work/npc");
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt").split(",");
const q = opt("--q", "medium");
const [W, H] = opt("--size", "1180x820").split("x").map(Number);
const dpr = Number(opt("--dpr", "1"));
const only = opt("--only", "village,piste,station,chair").split(",");
fs.mkdirSync(out, { recursive: true });
const GL = args.includes("--no-gpu") ? [] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await launchBrowser({ fullChromium: true, args: GL });
const { server, origin } = await startServer();
const report = [];
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.addInitScript(() => { try { localStorage.setItem("pb_ski_npcs", "1"); } catch (error) { /* ignore */ } });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
    await page.evaluate(() => window.__ski.streamer.release());
    await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
    await page.waitForFunction("!!window.__ski.village && !!window.__ski.lifts", null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const measure = async (label) => page.evaluate(async (label) => {
      const S = window.__ski, frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      S.npcs.set(false); await frames(8);
      const off = S.info();
      S.npcs.set(true); await frames(30);
      const on = S.info(), v = S.npcs.view ? S.npcs.view.stats : {}, c = S.npcs.crowd.stats;
      const figs = S.npcs.view ? { near: S.npcs.view.figs.near.triangles, crowd: S.npcs.view.figs.crowd.triangles } : null;
      return { label, figs, off: { calls: off.calls, tris: off.triangles }, on: { calls: on.calls, tris: on.triangles }, near: v.near, crowd: v.crowd, riders: v.riders, cars: v.cars, npcTris: v.triangles, simMs: +c.ms.toFixed(3), viewMs: +(v.ms || 0).toFixed(3), listed: c.listed };
    }, label);
    const shot = async (name) => { const f = path.join(out, `${rid}-${name}.png`); await page.screenshot({ path: f }); return f; };
    const hideUi = () => page.evaluate(() => { for (const id of ["ui"]) { const e = document.getElementById(id); if (e) e.style.visibility = "hidden"; } });
    const showUi = () => page.evaluate(() => { const e = document.getElementById("ui"); if (e) e.style.visibility = ""; });
    // ---- village: the spawn lift, chase camera, a little turned towards the village
    if (only.includes("village")) {
      await page.evaluate(() => { const S = window.__ski; S.firstLift(); });
      await page.waitForTimeout(4000);
      await hideUi();
      report.push({ rid, ...(await measure("village")) });
      await page.waitForTimeout(600);
      await shot("village");
      // a wider look over the village from behind the station
      await page.evaluate(() => {
        // from the village (its nearest place) towards the station: the queue, the walkers, the village
        const S = window.__ski, s = S.state, v = (S.npcs.crowd.walkerList()[0]) || { x: s.x + 40, z: s.z };
        let best = null;
        for (const w of S.npcs.crowd.walkerList()) { const d = Math.hypot(w.x - s.x, w.z - s.z); if (!best || d < best.d) best = { w, d }; }
        const to = best ? best.w : v, dx = to.x - s.x, dz = to.z - s.z, L = Math.hypot(dx, dz) || 1;
        S.setCamera(s.x + dx / L * 34, s.z + dz / L * 34, 10, s.x, s.z, 0, 62);
      });
      await page.waitForTimeout(1500);
      await shot("village-wide");
      await page.evaluate(() => window.__ski.setCamera(null));
      await showUi();
    }
    // ---- a busy blue piste half way down
    if (only.includes("piste")) {
      const spot = await page.evaluate(() => {
        const S = window.__ski, cr = S.npcs.crowd;
        let best = null;
        for (const p of S.pistes.list) { if (p.diff !== "blue" || p.length < 900) continue; const n = cr.popOf(p).skiers.length / p.length; if (!best || n > best.n || (n === best.n && p.length > best.p.length)) best = { p, n }; }
        const p = best ? best.p : S.pistes.list[0], a = p.at(p.length * 0.45, {});
        S.placeHold(a.x, a.z, Math.atan2(a.dz, a.dx));
        return { id: p.id, name: p.name, x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx) };
      });
      await page.waitForTimeout(3500);
      await hideUi();
      report.push({ rid, ...(await measure(`piste ${spot.name}`)) });
      await page.evaluate((sp) => { const S = window.__ski; S.setCamera(sp.x - Math.cos(sp.h) * 30, sp.z - Math.sin(sp.h) * 30, 14, sp.x + Math.cos(sp.h) * 60, sp.z + Math.sin(sp.h) * 60, 0, 55); }, spot);
      await page.waitForTimeout(1800);
      await shot("piste");
      await page.evaluate((sp) => { const S = window.__ski; S.setCamera(sp.x + Math.cos(sp.h) * 70, sp.z + Math.sin(sp.h) * 70, 6, sp.x, sp.z, 0, 45); }, spot);
      await page.waitForTimeout(1800);
      await shot("piste-up");
      await page.evaluate(() => window.__ski.setCamera(null));
      await showUi();
    }
    // ---- a chair lift's bottom station (the queue), then riding it
    let chairId = null;
    if (only.includes("station") || only.includes("chair")) {
      chairId = await page.evaluate(() => {
        const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === "chair" && (l.seats || 4) >= 4 && l.len > 600);
        const l = L.sort((a, b) => b.len - a.len)[Math.min(2, L.length - 1)] || S.modes.lifts.list[0];
        return l.id;
      });
      await page.evaluate((id) => window.__ski.goFree(id), chairId);
      await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 30000 });
      await page.waitForTimeout(4000);
    }
    if (only.includes("station")) {
      await hideUi();
      report.push({ rid, ...(await measure("station")) });
      const pose = await page.evaluate((id) => {
        const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), f = site.bottom;
        const w = site.wait, cam = f.toWorld(site.zone.a1 + 14, site.zone.b1 + 9, {});
        S.setCamera(cam.x, cam.z, 5, w.x, w.z, 0.5, 55);
        return { name: l.name };
      }, chairId);
      await page.waitForTimeout(1800);
      await shot("station");
      await page.evaluate(() => window.__ski.setCamera(null));
      await showUi();
      report[report.length - 1].label += ` ${pose.name}`;
    }
    if (only.includes("chair")) {
      await page.evaluate(() => window.__ski.boardLift());
      await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.where && window.__ski.ride.where().onCarrier, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(9000);
      await hideUi();
      report.push({ rid, ...(await measure("chair ride")) });
      await shot("chair");
      await page.evaluate(() => window.__ski.toggleRideView());
      await page.waitForTimeout(1500);
      await shot("chair-window");
      await showUi();
    }
    report.push({ rid, errors: errors.slice(0, 5) });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(out, `report-${q}.json`), JSON.stringify(report, null, 1));
for (const r of report) console.log(JSON.stringify(r));
