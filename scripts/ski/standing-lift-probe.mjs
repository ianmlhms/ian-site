#!/usr/bin/env node
/* Developer tool (standing lifts, 28 Nov 2026): boards drag lifts (T-bar / platter / J-bar / rope tow) and magic carpets from ~12 m out in
 * the catchment and records every frame: the skier's position (jumps = a teleport), the camera's position (a cut), and the skis / board
 * against the ground under each point (clearance min / max: < 0 = in the snow; the pitch error = tip vs tail).
 *   node scripts/ski/standing-lift-probe.mjs [--resorts killy,arlberg,obertauern] [--kinds drag,carpet] [--per 2] [--board] [--shots DIR]
 *        [--root DIR (another checkout: before / after)]
 * --shots: a side view of the skier on the steepest lift per resort halfway up (the skis vs the slope) + the carpet ride.
 * Run it through ~/Library/Caches/browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer, REPO } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,arlberg,obertauern").split(",");
const kinds = opt("--kinds", "drag,carpet").split(",");
const per = Number(opt("--per", "2"));
const shots = opt("--shots", "");
const root = opt("--root", REPO);
const board = args.includes("--board");
const browserName = process.env.FLOW_BROWSER || "chromium";
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await launchBrowser({ fullChromium: true, args: browserName === "chromium" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [] });
const { server, origin } = await startServer(root);
const report = [];
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.addInitScript((board) => {
    try { localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); if (board) localStorage.setItem("pb_ski_save", JSON.stringify({ ski: "snowboard" })); } catch (error) { /* ignore */ }
  }, board);
  for (const rid of resorts) {
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 180000 });
    if (board) await page.evaluate(() => window.__ski.setSki && window.__ski.setSki("snowboard"));
    const picks = await page.evaluate(({ kinds, per }) => {
      const S = window.__ski, W = S.modes.lifts.world, out = [];
      for (const kind of kinds) {
        const L = S.modes.lifts.list.filter((l) => { const s = W.sites.get(l.index); return s && s.path.kind === kind && !l.tunnel && (kind !== 'chair' || (s.chair && s.chair.detach)); });
        // the steepest first (rise per length)
        L.sort((a, b) => (b.top.y - b.bottom.y) / b.len - (a.top.y - a.bottom.y) / a.len);
        for (const l of L.slice(0, per)) { const s = W.sites.get(l.index); out.push({ id: l.id, name: l.name, kind, sub: s.path.sub || "", grade: Math.round(Math.atan((l.top.y - l.bottom.y) / l.len) * 180 / Math.PI) }); }
      }
      return out;
    }, { kinds, per });
    for (const p of picks) {
      await page.evaluate((id) => window.__ski.goFree(id), p.id);
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' && window.__ski.game.phase === 'running'", null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      // ~12 m out in the catchment (a clear way in)
      const spot = await page.evaluate((id) => {
        const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), w = site.wait, H = (x, z) => S.surface.height(x, z);
        for (const r of [12, 10, 14, 8, 6]) for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2, q = { x: w.x + Math.cos(a) * r, z: w.z + Math.sin(a) * r };
          if (S.modes.lifts.world.inStation(q.x, q.z, 0.5) || S.modes.lifts.world.inBuilding(q.x, q.z, 0.5)) continue;
          const c = S.modes.lifts.catchAt(q.x, q.z);
          if (!c || c.lift.id !== id || c.down) continue;
          if (S.modes.lifts.guideWay(l, false, q, H)) return { x: q.x, z: q.z, heading: Math.atan2(w.z - q.z, w.x - q.x), r };
        }
        return null;
      }, p.id);
      if (spot) await page.evaluate((s) => window.__ski.placeHold(s.x, s.z, s.heading), spot);
      await page.waitForTimeout(1200);
      const full = p.kind === "carpet";                 // a carpet: the whole ride (onto the belt, carried, off the top, out) is checked
      const rec = await page.evaluate(async ({ maxS, full }) => {
        const S = window.__ski, frames = [];
        let alive = true;
        const H = (x, z) => (S.ride && S.ride.kind === 'carpet' && S.ride.phase === 'ride' ? S.field.height(x, z) + 0.18 : S.standHeight(x, z));      // (a carpet: its drawn belt)
        const tick = () => {
          if (!alive) return;
          const st = S.state, c = S.camera.position, g = S.skier.gearPoints();
          const pts = g.board.length ? [g.board] : [g.skis.slice(0, 16), g.skis.slice(16, 32)];
          const cl = pts.map((P) => { let mn = Infinity, mx = -Infinity; for (const q of P) { const d = q[1] - H(q[0], q[2]); mn = Math.min(mn, d); mx = Math.max(mx, d); } return [mn, mx]; });
          frames.push({ t: performance.now(), phase: S.game.phase, rp: S.ride ? S.ride.phase : "", x: st.x, y: st.y, z: st.z, cx: c.x, cy: c.y, cz: c.z, cl, ride: st.ride || "" });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        S.boardLift();
        const t0 = performance.now();
        while (performance.now() - t0 < maxS * 1000) {
          await new Promise((r) => setTimeout(r, 100));
          if (!full && S.ride && S.ride.phase === "ride" && S.ride.share > 0.35) break;
          if (full && !S.ride && S.game.phase === "running") { await new Promise((r) => setTimeout(r, 1200)); break; }
        }
        alive = false;
        return frames;
      }, { maxS: full ? 120 : 40, full });
      if (full && shots) {
        // (the shots: board the carpet again from the same spot)
        await page.evaluate((id) => window.__ski.goFree(id), p.id);
        await page.waitForFunction("window.__ski.game.phase === 'running'", null, { timeout: 60000 });
        await page.waitForTimeout(1200);
        if (spot) await page.evaluate((s) => window.__ski.placeHold(s.x, s.z, s.heading), spot);
        await page.waitForTimeout(800);
        await page.evaluate(() => window.__ski.boardLift());
        await page.waitForFunction("window.__ski.ride && window.__ski.ride.phase === 'ride' && window.__ski.ride.share > 0.35", null, { timeout: 60000 });
      }
      // side view halfway up (shots)
      let shot = "";
      if (shots) {
        const base = path.join(shots, `${rid}-${p.kind}${p.sub ? "-" + p.sub : ""}-${p.id.replace(/[^a-z0-9]+/gi, "_").slice(0, 30)}${board ? "-board" : ""}`);
        await page.evaluate(() => { const S = window.__ski; document.getElementById("ui").style.visibility = "hidden"; S.orbit(90, 3.6, 0.7, 34); });
        await page.waitForTimeout(500);
        shot = `${base}-side.png`;
        await page.screenshot({ path: shot });
        await page.evaluate(() => window.__ski.orbit(null));
        if (p.kind === "carpet") {
          // the rest of the carpet ride in the game's own camera: carried up, off the top, skied out
          for (const [tag, cond] of [["2-ride", "window.__ski.ride && window.__ski.ride.share > 0.7"], ["3-off", "window.__ski.ride && window.__ski.ride.phase === 'alight'"], ["4-out", "!window.__ski.ride"]]) {
            await page.waitForFunction(cond, null, { timeout: 60000 }).catch(() => {});
            await page.waitForTimeout(tag === "3-off" ? 350 : 150);
            await page.screenshot({ path: `${base}-${tag}.png` });
          }
        }
        await page.evaluate(() => { document.getElementById("ui").style.visibility = ""; });
      }
      // analysis: position jumps (> 1.2 m in one frame), camera jumps (> 3 m), clearance during the ride
      let maxStep = 0, maxCam = 0, at = "", camAt = "";
      for (let i = 1; i < rec.length; i++) {
        const a = rec[i - 1], b = rec[i], d = Math.hypot(b.x - a.x, b.z - a.z), dc = Math.hypot(b.cx - a.cx, b.cy - a.cy, b.cz - a.cz);
        if (d > maxStep) { maxStep = d; at = `${a.phase}/${a.rp} -> ${b.phase}/${b.rp}`; }
        if (dc > maxCam) { maxCam = dc; camAt = `${a.phase}/${a.rp} -> ${b.phase}/${b.rp}`; }
      }
      const onRide = rec.filter((f) => f.rp === "ride");
      const span = (f) => f.cl.map(([mn, mx]) => mx - mn);
      let minCl = Infinity, maxSpan = 0;
      for (const f of onRide) { for (const [mn] of f.cl) minCl = Math.min(minCl, mn); maxSpan = Math.max(maxSpan, ...span(f)); }
      const boardF = rec.filter((f) => f.rp === "board");
      let minB = Infinity, spanB = 0;
      for (const f of boardF) { for (const [mn] of f.cl) minB = Math.min(minB, mn); spanB = Math.max(spanB, ...span(f)); }
      const jumps = [];
      for (let i = 1; i < rec.length; i++) {
        const a = rec[i - 1], b = rec[i], d = Math.hypot(b.x - a.x, b.z - a.z), dc = Math.hypot(b.cx - a.cx, b.cy - a.cy, b.cz - a.cz);
        if (d > 0.4 || dc > 1.0) jumps.push(`t ${((b.t - rec[0].t) / 1000).toFixed(2)} s ${a.phase}/${a.rp}->${b.phase}/${b.rp} skier ${d.toFixed(2)} cam ${dc.toFixed(2)}`);
      }
      const phases = [...new Set(rec.map((f) => `${f.phase}/${f.rp}`))].join(" ");
      const standing = p.kind !== "chair";             // (a chair: seated, the skis hang)
      const ok = maxStep < 1.2 && maxCam < 1.5 && (!standing || (minCl > -0.06 && maxSpan < 0.15));
      if (!ok) bad++;
      report.push(`${ok ? "ok " : "BAD"} ${rid} ${p.kind}${p.sub ? "/" + p.sub : ""} "${p.name}" ${p.grade}° from ${spot ? spot.r + " m" : "the zone"}: frames ${rec.length}, max step ${maxStep.toFixed(2)} m (${at}), max cam ${maxCam.toFixed(2)} m (${camAt}); ride: ski min clearance ${minCl.toFixed(3)} m, tip-tail span ${maxSpan.toFixed(3)} m; board phase: min ${minB.toFixed(3)}, span ${spanB.toFixed(3)}; phases ${phases}${jumps.length ? `\n    jumps: ${jumps.slice(0, 8).join("; ")}` : ""}${shot ? `\n    shot ${shot}` : ""}`);
      console.log(report[report.length - 1]);
    }
  }
  if (errors.length) report.push(`page errors: ${errors.slice(0, 5).join(" | ")}`);
} finally {
  console.log(`\n${report.length} rides, ${bad} bad`);
  await browser.close();
  server.close();
}
