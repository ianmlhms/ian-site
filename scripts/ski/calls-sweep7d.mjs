#!/usr/bin/env node
/* R7-D developer check: Niddreg (q=low) draw calls at many spots of every resort, the worst spot per resort, and what the calls of the
 * worst spot are spent on. Spots: every piste start (the chase camera looking down the piste) and every lift top (looking down the fall
 * line), after every tile, the village, the lifts, signs and landmarks are in.
 *   node scripts/ski/calls-sweep7d.mjs [--resorts killy,3vallees] [--every 1] [--limit 160] [--json out.json] [--gpu]
 * Exit 1 when a resort's worst spot is over --limit. Run it through ~/Library/Caches/browser-slot.py. */
import fs from "node:fs";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax,soelden").split(",");
const every = Number(opt("--every", "1"));
const limit = Number(opt("--limit", "160"));
const trisLimit = Number(opt("--tris", "450000"));
const jsonOut = opt("--json", "");
const gpu = args.includes("--gpu");

const browser = await launchBrowser({ fullChromium: true, args: gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer();
const out = {};
let failed = false;
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${rid} pageerror]`, String(e).slice(0, 300)));
    await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (error) { /* blocked */ } });
    await page.goto(`${origin}/pb/ski.html?resort=${rid}&go=1&debug=1&q=low&weather=sun&time=midday&res=fixed`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || !!document.documentElement.dataset.bootError, null, { timeout: 240000 });
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1" && window.__ski.lifts && window.__ski.landmarks, null, { timeout: 600000 });
    await page.waitForTimeout(3000);
    const spots = await page.evaluate((k) => {
      const S = window.__ski, out = [];
      S.pistes.list.forEach((p, i) => { if (i % k) return; const a = p.at(2, {}); out.push({ kind: "piste", name: p.name, x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx) }); });
      S.modes.lifts.list.forEach((l, i) => { if (i % k) return; const s = S.modes.lifts.startAt(l, (x, z) => S.field.height(x, z)); out.push({ kind: "lift", name: l.name, x: s.x, z: s.z, h: s.heading }); });
      return out;
    }, every);
    // freeze the skier at each spot (paused, no input), let the chase camera + time-sliced LOD settle, keep the max over a few frames
    const res = await page.evaluate(async (list) => {
      const S = window.__ski;
      S.game.paused = true;
      const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const rows = [];
      for (const s of list) {
        S.place(s.x, s.z, s.h);
        S.game.paused = false; await frames(2); S.game.paused = true;
        for (let i = 0; i < 6; i++) { S.terrain.update(S.camera.position.x, S.camera.position.z, 40); await frames(1); }
        let calls = 0, tris = 0;
        for (let i = 0; i < 3; i++) { await frames(1); const inf = S.info(); calls = Math.max(calls, inf.calls); tris = Math.max(tris, inf.triangles); }
        rows.push({ ...s, calls, tris });
      }
      return rows;
    }, spots);
    res.sort((a, b) => b.calls - a.calls);
    const worst = res[0];
    // what the worst spot's calls are spent on
    const tally = await page.evaluate(async (w) => {
      const S = window.__ski, r = S.renderer;
      S.place(w.x, w.z, w.h);
      S.game.paused = false;
      await new Promise((res) => setTimeout(res, 400));
      S.game.paused = true;
      for (let i = 0; i < 6; i++) { S.terrain.update(S.camera.position.x, S.camera.position.z, 40); await new Promise((res) => requestAnimationFrame(res)); }
      const counts = {};
      const orig = r.renderBufferDirect.bind(r);
      r.renderBufferDirect = (cam, scene, geo, mat, obj, group) => {
        let o = obj, name = "";
        while (o && !name) { name = o.name || ""; o = o.parent; }
        const key = `${(name || obj.type).replace(/\s.*$/, "")}${obj.isInstancedMesh ? " (inst)" : ""}`;
        counts[key] = (counts[key] || 0) + 1;
        return orig(cam, scene, geo, mat, obj, group);
      };
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      r.renderBufferDirect = orig;
      return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, worst);
    const n = res.length, p95 = res[Math.floor(n * 0.05)].calls, med = res[Math.floor(n / 2)].calls;
    out[rid] = { spots: n, worst: { kind: worst.kind, name: worst.name, calls: worst.calls, tris: worst.tris, x: Math.round(worst.x), z: Math.round(worst.z) }, p95, median: med, top: res.slice(0, 8).map((r) => `${r.calls} ${r.kind} ${r.name}`), tally };
    console.log(`${rid.padEnd(10)} ${n} spots: worst ${worst.calls} calls (${worst.kind} ${worst.name}, ${Math.round(worst.tris / 1000)}k tris), p95 ${p95}, median ${med}`);
    console.log(`           top: ${out[rid].top.join(" | ")}`);
    console.log(`           worst spot spends: ${tally.slice(0, 14).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const heavy = res.reduce((a, b) => (b.tris > a.tris ? b : a));            // the triangle budget is over ALL spots, not the worst-calls one
    out[rid].maxTris = { kind: heavy.kind, name: heavy.name, tris: heavy.tris };
    console.log(`           max triangles ${Math.round(heavy.tris / 1000)}k (${heavy.kind} ${heavy.name})`);
    if (worst.calls > limit || heavy.tris > trisLimit) failed = true;
    await ctx.close();
  }
} finally {
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
