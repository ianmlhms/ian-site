#!/usr/bin/env node
/* Village streets, seen the way a skier sees them (streets round, 23 Nov 2026): per resort one village spot, shot from
 *   chase     the game's own camera, the skier standing on the street
 *   eye       1.7 m over the street, looking along it
 *   side      from the field beside the street (bank, edge)
 *   junction  the nearest street junction;   deadend  the nearest dead end (eye height) and deadend-chase
 *   node scripts/ski/street-shots.mjs [--resorts killy,...] [--engine chromium] [--q medium] [--time midday] [--weather sun]
 *                                     [--only chase,eye,...] [--out DIR] [--tag T] [--at x,z]
 * PNGs <resort>-<tag>-<view>.png; prints draw calls / triangles / street triangles per spot. Run through browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SPOTS = {
  "3vallees": [14155, 4908], killy: [11242, 8691], zermatt: [11575, 2844], arlberg: [20044, 17494], kronplatz: [13377, 4903],
  vialattea: null, obertauern: [4245, 3866], livigno: null,
};
const PLACES = { vialattea: /Sestriere/i, livigno: /Livigno/i };
const resorts = opt("--resorts", Object.keys(SPOTS).join(",")).split(",").filter((r) => fs.existsSync(new URL(`../../pb/ski/data/${r}/resort.json`, import.meta.url)));
const engine = opt("--engine", "chromium"), q = opt("--q", "medium"), time = opt("--time", "midday"), weather = opt("--weather", "sun");
const only = opt("--only", "") ? opt("--only", "").split(",") : null;
const tag = opt("--tag", `${q}-${time}-${weather}`);
const at = opt("--at", "") ? opt("--at", "").split(",").map(Number) : null;
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/streets/shots"));
const want = (n) => !only || only.includes(n);
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true, args: engine === "chromium" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
try {
  for (const rid of resorts) {
    const page = await (await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 600)));
    page.on("console", (m) => { if (m.type() === "error" || /THREE|shader/i.test(m.text())) errors.push(m.text().slice(0, 1500)); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&res=fixed&q=${q}&weather=${weather}&time=${time}&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1" && !!window.__ski.roadRows && !!window.__ski.boxIndex, null, { timeout: 300000, polling: 500 }).catch(() => {});
    let target = at || SPOTS[rid];
    if (!target) {
      const re = PLACES[rid] || /./;
      const places = JSON.parse(fs.readFileSync(new URL(`../../pb/ski/data/${rid}/resort.json`, import.meta.url), "utf8")).places || [];
      const p = places.find((v) => re.test(v.name)) || places[0];
      target = [p.x, p.z];
    }
    const picks = await page.evaluate(([tx, tz]) => {
      const S = window.__ski, rows = S.roadRows;
      const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1e-6))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
      const near = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.pts.some((p) => Math.hypot(p[0] - tx, p[1] - tz) < 1500));
      let street = null, dead = null, junction = null, sd = Infinity, dd = Infinity, jd = Infinity;
      for (const { r, i } of near) {
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1], L = Math.hypot(bx - ax, bz - az);
          if (L < 14 || r.hw < 2.6) continue;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2, d = Math.hypot(mx - tx, mz - tz);
          if (d < sd && !S.boxIndex.hit(mx, mz, 4.5) && !S.boxIndex.hit(mx - (bx - ax) / L * 9, mz - (bz - az) / L * 9, 3)) { sd = d; street = { x: mx, z: mz, h: Math.atan2(bz - az, bx - ax), hw: r.hw }; }
        }
        for (const end of [0, r.pts.length - 1]) {
          const [x, z] = r.pts[end], n = r.pts[end ? end - 1 : 1], d = Math.hypot(x - tx, z - tz), L = Math.hypot(n[0] - x, n[1] - z);
          if (L < 6) continue;
          let m = Infinity, jn = Infinity;
          for (const o of near) if (o.i !== i) for (let k = 0; k + 1 < o.r.pts.length; k++) { m = Math.min(m, segD(x, z, o.r.pts[k], o.r.pts[k + 1])); if (k > 0) jn = Math.min(jn, Math.hypot(x - o.r.pts[k][0], z - o.r.pts[k][1])); }
          const h = Math.atan2(z - n[1], x - n[0]);
          if (m > 12 && d < dd && !S.boxIndex.hit(x, z, 4) && !S.boxIndex.hit(x - Math.cos(h) * 12, z - Math.sin(h) * 12, 3)) { dd = d; dead = { x, z, h, hw: r.hw }; }
          if (m < 1.5 && d < jd && !S.boxIndex.hit(x, z, 7) && !S.boxIndex.hit(x - Math.cos(h) * 13, z - Math.sin(h) * 13, 3)) { jd = d; junction = { x, z, h, hw: r.hw }; }
        }
      }
      return { street, dead, junction };
    }, target);
    const go = async (x, z, h) => {
      await page.evaluate(({ x, z, h }) => { const S = window.__ski; S.place(x, z, h); S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); S.streamer.focus(x, z); }, { x, z, h });
      await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), { x, z });
      await page.evaluate(async () => { const S = window.__ski; for (let i = 0; i < 100 && (S.terrain.stats.pending > 0 || i < 12); i++) await new Promise((r) => setTimeout(r, 100)); });
      await page.waitForTimeout(2200);
    };
    const shot = async (name) => { await page.screenshot({ path: path.join(out, `${rid}-${tag}-${name}.png`) }); };
    const cam = async (f, r, up, fx, fr, up2, fov = 55, p) => {
      const c = Math.cos(p.h), s = Math.sin(p.h), P = (a, b) => [p.x + c * a - s * b, p.z + s * a + c * b];
      const [x, z] = P(f, r), [x2, z2] = P(fx, fr);
      await page.evaluate((a) => window.__ski.setCamera(...a), [x, z, up, x2, z2, up2, fov]);
      await page.waitForTimeout(700);
    };
    const free = () => page.evaluate(() => window.__ski.setCamera(null));
    if (picks.street) {
      const p = picks.street;
      await go(p.x, p.z, p.h);
      if (want("chase")) await shot("chase");
      const info = await page.evaluate(() => { const i = window.__ski.info(); const r = window.__ski.roads; return { calls: i.calls, tris: i.triangles, roads: r && r.stats ? { ...r.stats } : null }; });
      console.log(rid, tag, "street", JSON.stringify(p), JSON.stringify(info));
      if (want("eye")) { await cam(-14, 0.8, 1.7, 22, 0, 0.6, 62, p); await shot("eye"); }
      if (want("side")) { await cam(-5, p.hw + 5.5, 1.8, 6, 0, 0.1, 62, p); await shot("side"); }
      if (want("top")) { await cam(-22, 8, 16, 4, 0, 0, 55, p); await shot("top"); }
      await free();
    }
    // a house approach near the spot
    const pa = want("path") ? await page.evaluate(([tx, tz]) => {
      const l = (window.__ski.roads.paths || []).map((p) => ({ p, d: Math.hypot(p[0][0] - tx, p[0][1] - tz), L: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) })).filter((q) => q.L > 7).sort((a, b) => a.d - b.d)[0];
      return l ? { n: window.__ski.roads.paths.length, x: l.p[1][0], z: l.p[1][1], h: Math.atan2(l.p[0][1] - l.p[1][1], l.p[0][0] - l.p[1][0]), hw: 3 } : { n: 0 };
    }, target) : null;
    if (pa && pa.n) { await go(pa.x, pa.z, pa.h); await cam(-9, 4, 2.6, 5, 0, 0, 62, pa); await shot("path"); await free(); }
    if (pa) console.log(rid, "paths", JSON.stringify(pa));
    if (picks.junction && want("junction")) { const p = picks.junction; await go(p.x - Math.cos(p.h) * 12, p.z - Math.sin(p.h) * 12, p.h); await cam(-15, 0.5, 3.2, 6, 0, 0, 62, p); await shot("junction"); await free(); }
    if (picks.dead && (want("deadend") || want("deadend-chase"))) {
      const p = picks.dead;
      await go(p.x - Math.cos(p.h) * 5, p.z - Math.sin(p.h) * 5, p.h);
      if (want("deadend-chase")) await shot("deadend-chase");
      if (want("deadend")) { await cam(-19, 0.8, 2.2, 2, 0, 0, 60, p); await shot("deadend"); }
      await free();
    }
    console.log(rid, "junction", JSON.stringify(picks.junction), "dead", JSON.stringify(picks.dead), errors.length ? "ERRORS " + errors.slice(0, 3).join(" | ") : "no errors");
    await page.context().close();
  }
} finally { await browser.close(); server.close(); }
