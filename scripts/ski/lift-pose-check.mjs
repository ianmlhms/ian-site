#!/usr/bin/env node
/* Round 8e: the lift rides, checked by geometry in the real game (every resort):
 *   chair     every seat count: riding with the bar down, no ski / pole point inside a part of the chair (footrest bar, its struts, the
 *             seat, the backrest, the yoke), the ski bases resting on the footrest bar (0-6 cm over its top)
 *   drag      platter + T-bar: the rod runs from the spring box down and BACK to the disc / T between his legs (>= 15 deg off the
 *             vertical, its top >= 0.5 m ahead of him), his hand on it (<= 10 cm)
 *   funitel   the twin-rope lifts (lift-path.js isFunitel: Funitel 3 Vallées, Thorens, Grand Fond, Péclet, the Glacier Rides) ride as
 *             gondolas with sub 'funitel' and many cabins on the loop; the chase camera never inside the cabin (boarding + first 3 s)
 *   cable     a fast travel to a cable car: its up-track cabin docked at the bottom, still there 6 s later (it waits for him), boarding
 *             starts at once; out of the zone it leaves; back in the zone (no fade) boarding waits for the scheduled cabin, which is
 *             on its rope or docked at every sample and reaches the dock before he gets in
 *   node scripts/ski/lift-pose-check.mjs [--resorts 3vallees,...] [--engine webkit|chromium] [--out DIR]   (exit 1 on a failure) */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax,soelden").split(",");
const engine = opt("--engine", "chromium");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round8e/lifts"));
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
let fails = 0;
const check = (ok, text) => { if (!ok) fails++; console.log(`${ok ? "  ok  " : "  FAIL"} ${text}`); };

try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { fails++; console.log(`  FAIL [${rid}] pageerror ${String(e).slice(0, 200)}`); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}&timescale=4`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForFunction(() => !!window.__ski.lifts, null, { timeout: 60000 }).catch(() => {});
    const plan = await page.evaluate(() => {
      const S = window.__ski, L = S.modes.lifts.list, view = S.lifts, by = {};
      for (const l of L) {
        const p = view.pathOf(l.index);
        if (!p || p.tunnel) continue;
        const k = p.kind === "chair" ? `chair:${p.seats}` : p.kind === "drag" ? `drag:${p.sub}` : p.sub === "funitel" ? "funitel" : p.kind === "cable" ? "cable" : null;
        if (!k || (k.startsWith("drag:") && !/platter|tbar/.test(k))) continue;
        if (!by[k] || Math.abs(l.len - 600) < Math.abs(by[k].len - 600)) by[k] = { id: l.id, index: l.index, len: l.len, name: l.name };
      }
      const fun = L.map((l) => view.pathOf(l.index)).filter((p) => p && p.sub === "funitel");
      return { by, funitels: fun.map((p) => ({ name: p.src.name, n: Math.ceil(p.loopLen / p.spec.gap) + 1, shuttle: p.shuttle })) };
    });
    console.log(`== ${rid}: ${Object.keys(plan.by).join(", ")}`);
    for (const f of plan.funitels) check(!f.shuttle && f.n > 4, `${rid} funitel ${f.name}: a loop with ${f.n} cabins (not a 2-cabin shuttle)`);
    const ride = async (id) => {
      await page.evaluate((id) => window.__ski.goFree(id), id);
      await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, id, { timeout: 40000 });
    };
    for (const [k, l] of Object.entries(plan.by)) {
      try {
        if (k === "cable") {
          await ride(l.id);
          const docked = () => page.evaluate((i) => { const b = window.__ski.lifts.shuttleBoard(i); return b ? b.wait : -1; }, l.index);
          const w0 = await docked();
          await page.waitForTimeout(6000);
          const w1 = await docked();
          check(w0 === 0 && w1 === 0, `${rid} cable ${l.name}: after the fast travel its cabin is docked at the bottom (wait ${w0.toFixed(1)} s) and still 6 s later (${w1.toFixed(1)} s)`);
          // out of the zone: the pair leaves; back in without a fade: the boarding waits for the scheduled cabin
          await page.evaluate(() => { const S = window.__ski, s = S.state; S.placeHold(s.x - Math.sin(s.heading) * 40, s.z + Math.cos(s.heading) * 40, s.heading); });
          await page.waitForFunction((i) => window.__ski.lifts.shuttleBoard(i).wait > 3, l.index, { timeout: 30000 }).catch(() => {});
          await page.evaluate((i) => { const S = window.__ski, site = S.lifts.siteOf(i); S.placeHold(site.wait.x, site.wait.z, site.wait.heading); }, l.index);
          await page.waitForFunction((id) => window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, l.id, { timeout: 10000 });
          const wait = await docked();
          await page.evaluate(() => window.__ski.boardLift());
          const samples = await page.evaluate(async (i) => {
            const S = window.__ski, p = S.lifts.pathOf(i), out = [];
            const t0 = performance.now();
            while (S.ride && S.ride.phase === "board" && performance.now() - t0 < 60000) {
              const c = S.carrier && S.carrier.group.position;
              if (c) { const pr = { d: Infinity }; for (let s = 0; s <= p.len; s += 0.4) { const a = p.shuttleAt(s, 1, true, {}); pr.d = Math.min(pr.d, Math.hypot(a.x - c.x, a.z - c.z)); } out.push(pr.d); }
              await new Promise((r) => setTimeout(r, 400));
            }
            const w = S.ride ? S.ride.where() : null;
            return { off: out.length ? Math.max(...out) : 0, n: out.length, phase: S.ride ? S.ride.phase : null, on: w && w.onCarrier };
          }, l.index);
          check(wait > 1 && samples.n >= 2 && samples.off < 0.5 && samples.phase === "ride", `${rid} cable ${l.name}: boarding waited for the scheduled cabin (${wait.toFixed(0)} s, ${samples.n} samples, always on its rope: ${samples.off.toFixed(2)} m off), then rode`);
          await page.evaluate(() => window.__ski.skipRide());
          await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 60000 });
          continue;
        }
        await ride(l.id);
        await page.evaluate(() => window.__ski.boardLift());
        // the chase camera vs the cabin (funitel): from the boarding to 3 s into the ride
        const camIn = await page.evaluate(async (k) => {
          const S = window.__ski, T = window.THREE, v = new T.Vector3();
          let inside = 0, n = 0;
          const t0 = performance.now();
          while (performance.now() - t0 < 30000) {
            await new Promise((r) => requestAnimationFrame(r));
            const r = S.ride;
            if (!r) break;
            if (k === "funitel" && S.carrier) {
              v.copy(S.camera.position); S.carrier.group.updateMatrixWorld(true); S.carrier.group.worldToLocal(v);
              n++;
              if (Math.abs(v.x) < 1.45 && Math.abs(v.z) < 1.85 && v.y > -4.95 && v.y < -2.25) inside++;
            }
            if (r.phase === "ride" && r.s - r.path.docks[0] > (k.startsWith("chair") ? 14 : k === "funitel" ? 25 : 10)) break;
          }
          return { inside, n };
        }, k);
        if (k === "funitel") check(camIn.inside === 0 && camIn.n > 10, `${rid} funitel ${l.name}: the chase camera never inside the cabin (${camIn.inside} / ${camIn.n} frames)`);
        await page.waitForTimeout(400);
        const r = await page.evaluate(async (k) => {
          const S = window.__ski, T = window.THREE, ride = S.ride, w = ride.where(), g = S.skier.gearPoints();
          const res = { phase: ride.phase, barDown: !!w.barDown };
          if (k.startsWith("chair")) {
            const { carrierParts } = await import("/pb/ski/modes/carriers.js");
            const parts = carrierParts("chair", { seats: ride.path.seats, barUp: false }).parts;
            const boxes = [];
            for (const [geo, , m] of parts) {
              const P = geo.parameters;
              if (!P || P.width === undefined) continue;
              const e = new T.Euler().setFromRotationMatrix(m);
              if (Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z) > 1e-6) continue;
              const c = new T.Vector3().setFromMatrixPosition(m);
              boxes.push({ x0: c.x - P.width / 2, x1: c.x + P.width / 2, y0: c.y - P.height / 2, y1: c.y + P.height / 2, z0: c.z - P.depth / 2, z1: c.z + P.depth / 2 });
            }
            const grp = S.carrier.group; grp.updateMatrixWorld(true);
            const v = new T.Vector3();
            const local = (p) => grp.worldToLocal(v.set(p[0], p[1], p[2])).clone();
            const inBox = (q) => boxes.some((b) => q.x > b.x0 + 0.01 && q.x < b.x1 - 0.01 && q.y > b.y0 + 0.01 && q.y < b.y1 - 0.01 && q.z > b.z0 + 0.01 && q.z < b.z1 - 0.01);
            const skis = g.skis.map(local), poles = g.poles.map(local);
            res.skiIn = skis.filter(inBox).length; res.poleIn = poles.filter(inBox).length;
            const rest = boxes.reduce((a, b) => (b.y1 < -2.3 && b.x0 > 0.3 ? b : a), null);          // the footrest bar
            const over = skis.filter((q) => rest && q.x > rest.x0 && q.x < rest.x1 && q.z > rest.z0 && q.z < rest.z1).map((q) => q.y - rest.y1);
            res.rest = over.length ? Math.min(...over) : null; res.restN = over.length;
          } else {
            const f = { x: Math.cos(w.heading), z: Math.sin(w.heading) };
            const top = { x: w.cx, y: w.cy - 0.65, z: w.cz }, bot = { x: w.x + f.x * 0.04, y: w.hip, z: w.z + f.z * 0.04 };
            const d = { x: top.x - bot.x, y: top.y - bot.y, z: top.z - bot.z }, L = Math.hypot(d.x, d.y, d.z);
            res.angle = Math.acos(Math.min(1, d.y / L)) * 180 / Math.PI;
            res.ahead = d.x * f.x + d.z * f.z;
            const hand = g.hands.reduce((best, h) => {
              const t = Math.max(0, Math.min(1, ((h[0] - bot.x) * d.x + (h[1] - bot.y) * d.y + (h[2] - bot.z) * d.z) / (L * L)));
              const dist = Math.hypot(h[0] - bot.x - d.x * t, h[1] - bot.y - d.y * t, h[2] - bot.z - d.z * t);
              return Math.min(best, dist);
            }, Infinity);
            res.hand = hand;
            const disc = Math.hypot(bot.x - w.x, bot.z - w.z);
            res.disc = disc;
          }
          return res;
        }, k);
        if (k.startsWith("chair")) {
          check(r.barDown && r.skiIn === 0 && r.poleIn === 0, `${rid} ${k} ${l.name}: bar down, ${r.skiIn} ski / ${r.poleIn} pole points inside a chair part`);
          check(r.rest !== null && r.rest > -0.02 && r.rest < 0.06, `${rid} ${k} ${l.name}: the skis rest on the footrest bar (${r.rest === null ? "none over it" : `${(r.rest * 100).toFixed(1)} cm over it, ${r.restN} points`})`);
          await page.evaluate(() => window.__ski.orbit(70, 4.2, -0.4, 50));
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-${k.replace(":", "")}.png`) });
          await page.evaluate(() => window.__ski.orbit(null));
        } else if (k.startsWith("drag")) {
          check(r.angle > 15 && r.ahead > 0.5 && r.hand < 0.1 && r.disc < 0.15, `${rid} ${k} ${l.name}: the rod ${r.angle.toFixed(0)} deg off the vertical, its top ${r.ahead.toFixed(2)} m ahead, the disc ${(r.disc * 100).toFixed(0)} cm from between his legs, his hand ${(r.hand * 100).toFixed(0)} cm from it`);
          await page.evaluate(() => window.__ski.orbit(80, 3.6, 0.6, 45));
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-${k.replace(":", "")}.png`) });
          await page.evaluate(() => window.__ski.orbit(null));
        } else if (k === "funitel") {
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-funitel-ride.png`) });
        }
        await page.evaluate(() => window.__ski.skipRide());
        await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 60000 });
      } catch (error) {
        fails++;
        console.log(`  FAIL ${rid} ${k} ${l.name}: ${String(error.message).split("\n")[0]}`);
        await page.evaluate(() => window.__ski.skipRide && window.__ski.skipRide()).catch(() => {});
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `${fails} FAILED` : "all lift poses green");
process.exit(fails ? 1 : 0);
