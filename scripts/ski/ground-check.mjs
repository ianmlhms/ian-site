#!/usr/bin/env node
/* Round 7 (A): the drawn ground == the physics ground, in every village of every resort, in Chromium AND WebKit.
 *   node scripts/ski/ground-check.mjs [--resorts killy,...] [--engines chromium,webkit] [--villages 5] [--out DIR] [--shots]
 * Per resort: the free ride spawn (the skier on the loaded ground, within 0.3 m), then up to N village spots (street points spread over the
 * resort, farthest-point sampling): the skier is put there, the terrain settles, and
 *   streets   every street vertex within 80 m: |drawn - physics| (the street ribbon vs surface.height) <= 6 cm (no spikes, no banks in the air)
 *   ground    40 random rays straight down within 50 m: the first visible surface (terrain tiles + streets) vs surface.height <= 6 cm
 *   skis      the skier standing on the street: the lowest ski point is not under the snow (>= -2 cm)
 *   carve     a scripted carve on the spawn slope: the skis never more than 2 cm under the snow
 * plus a ground-level screenshot of each village spot (--shots). Exit 1 on any failure; a per-resort table at the end. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz").split(",");
const engines = opt("--engines", "chromium,webkit").split(",");
const villages = Number(opt("--villages", "5"));
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round7/ground"));
const shots = args.includes("--shots");
fs.mkdirSync(out, { recursive: true });

const { server, origin } = await startServer();
const table = [];
let fails = 0;
try {
  for (const engine of engines) {
    process.env.FLOW_BROWSER = engine;
    const browser = await launchBrowser({ fullChromium: true });
    for (const rid of resorts) {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
      await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
      await page.waitForTimeout(2500);
      const spawn = await page.evaluate(() => { const S = window.__ski, s = S.state; return { above: s.y - S.surface.height(s.x, s.z), clear: S.skierClear }; });
      await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
      await page.waitForFunction(() => !!window.__ski.roadRows, null, { timeout: 60000 });
      await page.waitForTimeout(2500);
      const spawnLate = await page.evaluate(() => { const S = window.__ski, s = S.state; return s.y - S.surface.height(s.x, s.z); });
      // village spots: street points spread over the resort (farthest-point sampling), inside the shipped tiles
      const spots = await page.evaluate((n) => {
        const S = window.__ski, pts = [];
        for (const r of S.roadRows) for (const p of r.pts) pts.push(p);
        if (!pts.length) return [];
        const out = [pts[Math.floor(pts.length / 2)]];
        while (out.length < n) {
          let best = null, bd = -1;
          for (let i = 0; i < pts.length; i += 7) { const p = pts[i]; let d = Infinity; for (const q of out) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])); if (d > bd) { bd = d; best = p; } }
          if (!best || bd < 300) break;
          out.push(best);
        }
        return out;
      }, villages);
      const rows = [];
      for (const [i, [x, z]] of spots.entries()) {
        const r = await page.evaluate(async ({ x, z }) => {
          const S = window.__ski, T = window.THREE;
          S.place(x, z, 0);
          S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false });
          await new Promise((res) => setTimeout(res, 1800));
          // streets: every vertex near by vs the physics surface
          let worstStreet = 0, n = 0;
          const roads = S.scene.getObjectByName('ski-roads');
          if (roads) roads.traverse((o) => {
            if (!o.isMesh) return;
            const p = o.geometry.attributes.position;
            for (let k = 0; k < p.count; k++) {
              const vx = p.getX(k), vz = p.getZ(k);
              if (Math.abs(vx - x) > 80 || Math.abs(vz - z) > 80) continue;
              const d = p.getY(k) - S.surface.height(vx, vz) - 0.03;
              n++; if (Math.abs(d) > Math.abs(worstStreet)) worstStreet = d;
            }
          });
          // rays straight down: the first visible ground surface (terrain + streets) vs the physics
          const ray = new T.Raycaster();
          const targets = [S.scene.getObjectByName('ski-terrain'), roads].filter(Boolean);
          let worstRay = 0, rays = 0, worstWhat = '';
          for (let k = 0; k < 40; k++) {
            const a = k * 2.39996, rr = 6 + (k % 10) * 4.4, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
            const h = S.surface.height(px, pz);
            ray.set(new T.Vector3(px, h + 30, pz), new T.Vector3(0, -1, 0));
            ray.far = 60;
            const hit = ray.intersectObjects(targets, true)[0];
            if (!hit) continue;
            rays++;
            const d = hit.point.y - h;
            if (Math.abs(d) > Math.abs(worstRay)) { worstRay = d; worstWhat = `${hit.object.parent ? hit.object.parent.name : ''}/${hit.object.name} r${rr.toFixed(0)}`; }
          }
          return { worstStreet, streetVerts: n, worstRay, worstWhat, rays, clear: S.skierClear, above: S.state.y - S.surface.height(S.state.x, S.state.z) };
        }, { x, z });
        if (shots) {
          await page.evaluate(({ x, z }) => { window.__ski.setCamera(x - 14, z - 9, 2.2, x + 10, z + 6, 1.0, 62); }, { x, z });
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-v${i + 1}.png`) });
          await page.evaluate(() => window.__ski.setCamera(null));
        }
        rows.push(r);
      }
      // a scripted carve on the spawn slope: the skis stay on the snow
      const carve = await page.evaluate(async () => {
        const S = window.__ski;
        const p = S.pistes.list.find((q) => q.diff === 'red' && q.length > 800) || S.pistes.list[0];
        const a = p.at(Math.min(200, p.length / 3), {});
        S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
        let worst = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < 6000) {
          const t = (performance.now() - t0) / 1000;
          S.setInput({ steer: Math.sin(t * 1.6) > 0 ? 1 : -1, tuck: 0, brake: 0, push: 0, jump: false });
          await new Promise((res) => requestAnimationFrame(res));
          if (S.state.grounded && S.state.crash === 0) worst = Math.min(worst, S.skierClear);
        }
        S.setInput(null);
        return { worst, kmh: S.state.speed * 3.6 };
      });
      const worstStreet = rows.reduce((m, r) => (Math.abs(r.worstStreet) > Math.abs(m) ? r.worstStreet : m), 0);
      const worstRay = rows.reduce((m, r) => (Math.abs(r.worstRay) > Math.abs(m) ? r.worstRay : m), 0);
      const worstWhat = (rows.find((r) => r.worstRay === worstRay) || {}).worstWhat || '';
      const minClear = Math.min(...rows.map((r) => r.clear), 0.5);
      const ok = Math.abs(spawn.above) < 0.3 && Math.abs(spawnLate) < 0.3 && Math.abs(worstStreet) <= 0.06 && Math.abs(worstRay) <= 0.06 && minClear >= -0.02 && carve.worst >= -0.02 && !errors.length;
      if (!ok) fails++;
      const line = { engine, rid, ok, spawnAbove: +spawn.above.toFixed(3), spawnLate: +spawnLate.toFixed(3), villages: rows.length, worstStreet: +worstStreet.toFixed(3), worstRay: +worstRay.toFixed(3), worstWhat, minSkiClear: +minClear.toFixed(3), carveSki: +carve.worst.toFixed(3), errors: errors.slice(0, 3) };
      table.push(line);
      console.log(JSON.stringify(line));
      await ctx.close();
    }
    await browser.close();
  }
} finally {
  server.close();
}
fs.writeFileSync(path.join(out, "ground.json"), JSON.stringify(table, null, 1));
console.log(`\n${table.length - fails} / ${table.length} resort runs green`);
process.exit(fails ? 1 : 0);
