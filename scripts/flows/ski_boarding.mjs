/* Flow: Ski Alpen, easier boarding (Ian, 26 Nov 2026: "make climbing in lifts easier, not just that little yellow square").
 * Per resort (SKI_BOARDING_RESORTS, default killy,vialattea,arlberg) and per kind (chair, gondola / cable car, drag lift):
 *   near      placed ~12 m from the boarding spot (not in the zone), standing: the Astegen button shows
 *   press     one press (the button by touch / click): he is walked / slid in along a clear way (never through a station part), then
 *             boards: the ride's board phase starts within a few seconds
 *   skip      a second press during the walk hurries it (28 Nov 2026: no longer straight to the spot, that read as a teleport)
 *   fast      in the catchment at 30 km/h: the button shows, a press does NOT board (toast "Ze séier")
 *   far       30 m away: no button
 *   top       next to a descent mat (top): "Erof" shows, a press boards the ride down
 * Shots (SKI_BOARDING_SHOTS=dir): the walk in and the boarding per kind. Zero page errors. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.SKI_BOARDING_RESORTS || "killy,vialattea,arlberg").split(",");

export const flow = {
  name: "ski-boarding",
  fullChromium: true,
  viewport: { width: 1080, height: 810 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const outDir = process.env.SKI_BOARDING_SHOTS || "";
    const shot = async (label) => { await h.shot(label); if (outDir) { fs.mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, `${label}.png`) }); } };
    const btn = () => page.evaluate(() => { const b = document.getElementById("liftBtn"); return { shown: !b.hidden, text: b.textContent.trim() }; });
    for (const rid of RESORTS) {
      h.step(`${rid}: boarding from the catchment`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&timescale=2&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 90000 });
      const picks = await page.evaluate(() => {
        const L = window.__ski.modes.lifts.list.filter((l) => !l.tunnel);
        const pick = (f) => { const c = L.filter(f).sort((a, b) => a.len - b.len); return c.length ? c[Math.floor(c.length / 2)].id : null; };
        return [["chair", pick((l) => l.kind === "chair")], ["cabin", pick((l) => l.kind === "gondola" || l.kind === "cable")], ["drag", pick((l) => l.kind === "drag")]].filter(([, id]) => id);
      });
      for (const [kind, id] of picks) {
        // a spot ~12 m from the boarding spot, out of the station, with the guided way clear (the game's own guideWay)
        const spot = await page.evaluate((id) => {
          const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), w = site.wait, H = (x, z) => S.surface.height(x, z);
          for (const r of [12, 10, 14, 8]) for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2, p = { x: w.x + Math.cos(a) * r, z: w.z + Math.sin(a) * r };
            if (S.modes.lifts.world.inStation(p.x, p.z, 0.5) || S.modes.lifts.world.inBuilding(p.x, p.z, 0.5)) continue;
            const c = S.modes.lifts.catchAt(p.x, p.z);
            if (!c || c.lift.id !== id || c.down) continue;
            if (S.modes.lifts.guideWay(l, false, p, H)) return { x: p.x, z: p.z, heading: Math.atan2(w.z - p.z, w.x - p.x), name: l.name };
          }
          return null;
        }, id);
        if (!h.expect(!!spot, `${rid} ${kind}: a spot in the catchment with a clear way in`)) continue;
        await page.evaluate((s) => window.__ski.placeHold(s.x, s.z, s.heading), spot);
        await page.waitForFunction((id) => window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id && !document.getElementById("liftBtn").hidden, id, { timeout: 8000 });
        const b = await btn();
        h.expect(/Astegen/.test(b.text), `${rid} ${kind} ${spot.name}: 12 m out of the zone, the button shows ("${b.text}")`);
        // the way the game will walk him (its own guideWay), sampled every 5 cm against the station parts / pylons
        const walk = await page.evaluate((id) => {
          const S = window.__ski, l = S.modes.lifts.byId.get(id), st = S.state, H = (x, z) => S.surface.height(x, z), W = S.modes.lifts.world;
          const way = S.modes.lifts.guideWay(l, false, { x: st.x, z: st.z }, H, (x, z) => !!S.scatter.hit(x, z, 0.35, -1e9, S.quality.treeDensity));
          if (!way) return { way: 0 };
          const site = W.sites.get(l.index);
          for (let g = 1; g < way.length; g++) {
            const A = way[g - 1], B = way[g], d = Math.hypot(B.x - A.x, B.z - A.z);
            for (let m = 0; m <= d; m += 0.05) { const x = A.x + (B.x - A.x) * m / d, z = A.z + (B.z - A.z) * m / d; const hit = W.hit(x, z, 0.25, H(x, z), H); if (hit) { const L = site.bottom.toLocal(x, z, {}); return { way: way.length, hit: `leg ${g} at ${m.toFixed(1)} / ${d.toFixed(1)} m, a ${L.a.toFixed(1)} b ${L.b.toFixed(1)}, pen ${hit.pen.toFixed(2)}` }; } }
          }
          return { way: way.length, hit: null };
        }, id);
        h.expect(walk.way > 0 && !walk.hit, `${rid} ${kind}: the walk in (${walk.way - 1} legs) never goes through a station part or pylon${walk.hit ? ` (${walk.hit})` : ''}`);
        await page.click("#liftBtn");
        try { await page.waitForFunction(() => window.__ski.game.phase === "approach" || window.__ski.game.phase === "lift", null, { timeout: 3000 }); }
        catch (error) {
          const why = await page.evaluate(() => ({ phase: window.__ski.game.phase, liftAt: window.__ski.modes.liftAt && window.__ski.modes.liftAt.name, toast: [...document.querySelectorAll(".toast, #toast, .hudtoast")].map((t) => t.textContent).join(" | "), speed: window.__ski.state.speed }));
          throw new Error(`no walk in after the press: ${JSON.stringify(why)} errors ${errors.join(" | ")}`);
        }
        await h.pause(350);
        await shot(`${rid}-${kind}-1-walk-in`);
        await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride, null, { timeout: 8000 });
        h.expect(true, `${rid} ${kind}: walked in and boarding (${await page.evaluate(() => window.__ski.ride.phase)})`);
        await h.pause(kind === "drag" ? 900 : 1500);
        await shot(`${rid}-${kind}-2-boarding`);
        await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 25000 });
        await page.evaluate(() => window.__ski.goFree());          // back to the spawn (drops the ride)
        await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 30000 });
        if (kind === "chair") {
          // skip: a second press during the walk goes straight to the spot; fast: no boarding
          await page.evaluate((s) => window.__ski.placeHold(s.x, s.z, s.heading), spot);
          // (this lift's button: right after the fast travel to the spawn the spawn lift's button may still show)
          await page.waitForFunction((id) => window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id && !document.getElementById("liftBtn").hidden, id, { timeout: 8000 });
          // (the walk lasts ~1.5 s at the test's x2: the second press goes in straight from the page, the first starts the walk)
          // standing lifts (28 Nov 2026; Ian: "teleported to the bottom station"): the second press hurries the walk, it never jumps
          const skip = await page.evaluate(async () => {
            const S = window.__ski;
            S.boardLift();
            const a = S.game.phase, p0 = { x: S.state.x, z: S.state.z };
            S.boardLift();
            const b = S.game.phase, jump = Math.hypot(S.state.x - p0.x, S.state.z - p0.z), t0 = performance.now();
            // (the fastest it moves, m/s of page time at the test's x2: the hurried walk peaks ~22; a jump is far beyond)
            let last = { x: S.state.x, z: S.state.z, t: performance.now() }, vmax = 0;
            while (S.game.phase === "approach" && performance.now() - t0 < 8000) {
              await new Promise((r) => requestAnimationFrame(r));
              const now = performance.now();
              if (now - last.t < 60) continue;               // (over >= 60 ms: a frame's own timing is not the walk's speed)
              vmax = Math.max(vmax, Math.hypot(S.state.x - last.x, S.state.z - last.z) / ((now - last.t) / 1000)); last = { x: S.state.x, z: S.state.z, t: now };
            }
            return { first: a, second: b, jump: +jump.toFixed(2), vmax: +vmax.toFixed(1), then: S.game.phase, ms: Math.round(performance.now() - t0) };
          });
          h.expect(skip.first === "approach" && skip.second === "approach" && skip.jump < 0.3 && skip.vmax < 30 && skip.then === "lift", `${rid} chair: a second press hurries the walk in, no jump (${JSON.stringify(skip)})`);
          await page.evaluate(() => window.__ski.goFree());
          await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 30000 });
          const fast = await page.evaluate((s) => {
            const S = window.__ski;
            S.placeHold(s.x, s.z, s.heading);
            S.game.state = { ...S.game.state, vx: Math.cos(s.heading) * 8.5, vz: Math.sin(s.heading) * 8.5, speed: 8.5 };
            const ev = S.modes.freeRun.update(S.game.state, 0.016);
            for (const e of ev) S.modes.freeEvent(e);
            const shown = !document.getElementById("liftBtn").hidden;
            S.boardLift();
            return { shown, phase: S.game.phase, fast: S.modes.liftFast };
          }, spot);
          h.expect(fast.shown && fast.fast && fast.phase === "running", `${rid}: at 31 km/h in the catchment the button shows but a press does not board (${JSON.stringify(fast)})`);
          const far = await page.evaluate((s) => { const S = window.__ski, w = S.modes.lifts.byId.get(s.id); const site = S.modes.lifts.world.sites.get(w.index); return S.modes.lifts.catchAt(site.wait.x + 30, site.wait.z + 30); }, { ...spot, id });
          h.expect(!far || far.lift.id !== id, `${rid}: 40 m away: not this lift's catchment`);
        }
      }
      // the top: next to a descent mat
      const down = await page.evaluate(() => { const L = window.__ski.modes.lifts.list.filter((l) => l.down && !l.tunnel && (l.kind === "gondola" || l.kind === "chair")); return L.length ? L[0].id : null; });
      if (down) {
        await page.evaluate((id) => window.__ski.goDown(id), down);
        await page.waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.modes.liftDown, null, { timeout: 30000 });
        const s = await page.evaluate(() => { const st = window.__ski.state; return { x: st.x, z: st.z, heading: st.heading }; });
        await page.evaluate((p) => window.__ski.placeHold(p.x + Math.cos(p.heading + 1.57) * 5, p.z + Math.sin(p.heading + 1.57) * 5, p.heading), s);
        await h.pause(400);
        const b2 = await btn();
        if (b2.shown) {
          h.expect(/Erof/.test(b2.text), `${rid}: 5 m beside a descent mat: "${b2.text}"`);
          await page.click("#liftBtn");
          await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride && window.__ski.ride.down, null, { timeout: 8000 });
          h.expect(true, `${rid}: guided onto the descent mat and riding down`);
          await page.evaluate(() => window.__ski.goFree());
          await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 30000 });
        } else h.expect(true, `${rid}: 5 m beside the descent mat is outside its catchment there (station parts) — the mat itself works (ski-ride-down)`);
      }
    }
    h.eq(errors.length, 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  },
};
runIfMain(import.meta.url, flow);
