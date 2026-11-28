/* Flow: Ski Alpen standing lifts (28 Nov 2026; Ian, iPad: "on a T-bar the skis stay level with the world, they stick into the
 * mountain" + "on the carpets you are always teleported to the bottom station instead of moving continuously").
 * Per resort (SKI_STANDING_RESORTS, default killy,arlberg):
 *   drag      the steepest platter / T-bar / J-bar: pressed from ~12 m out, walked in, boarded, pulled up: every frame the skier moves
 *             < 1.2 m and the camera < 1.5 m (no teleport, no cut), on the lift both skis lie on the track (no point > 6 cm in the snow,
 *             tip and tail within 15 cm of the snow under them); the same on a snowboard (its edges)
 *   carpet    a magic carpet (where the resort has one): rideable, boarded from ~12 m out, carried the whole way at the belt's speed
 *             (lift-path.js CARPET_FACTOR), the skis on the belt (0.18 m over the snow), off the top and out to the exit, all of it
 *             without a jump of the skier or the camera; no waiting for a "cabin" (a carpet is no jig-back)
 * Zero page errors. FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.SKI_STANDING_RESORTS || "killy,arlberg").split(",");

/** In the page: press, then record every frame until `until` ('share': 30 % up the line, 'done': off and standing) or maxS s. */
async function rideRecord(page, { until, maxS, belt = 0 }) {
  return page.evaluate(async ({ until, maxS, belt }) => {
    const S = window.__ski, frames = [], H = belt ? (x, z) => S.field.height(x, z) + belt : (x, z) => S.standHeight(x, z);       // (a carpet: its drawn belt, lifts.js)
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const st = S.state, c = S.camera.position, g = S.skier.gearPoints();
      // (on a carpet only where the belt is under both skis: past its ends the tips / tails reach over the end plates)
      const onRide = !!(S.ride && S.ride.phase === "ride" && (!belt || (S.ride.s > 1.5 && S.ride.s < S.ride.path.len - 1.5)));
      let mn = Infinity, span = 0;
      if (onRide) {
        const sets = g.board.length ? [g.board] : [g.skis.slice(0, 16), g.skis.slice(16, 32)];
        for (const P of sets) { let lo = Infinity, hi = -Infinity; for (const q of P) { const d = q[1] - H(q[0], q[2]); lo = Math.min(lo, d); hi = Math.max(hi, d); } mn = Math.min(mn, lo); span = Math.max(span, hi - lo); }
      }
      frames.push({ t: performance.now(), ph: `${S.game.phase}/${S.ride ? S.ride.phase : ""}`, x: st.x, z: st.z, cx: c.x, cy: c.y, cz: c.z, s: S.ride ? S.ride.s : null, onRide, mn, span });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.boardLift();
    const t0 = performance.now();
    const done = until === "done" ? () => !S.ride && S.game.phase === "running" : () => !!(S.ride && S.ride.phase === "ride" && S.ride.share > 0.3);
    while (performance.now() - t0 < maxS * 1000) { await new Promise((r) => setTimeout(r, 80)); if (done()) break; }
    alive = false;
    let step = 0, cam = 0, minCl = Infinity, maxSpan = 0, stepAt = "", camAt = "";
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i], d = Math.hypot(b.x - a.x, b.z - a.z), dc = Math.hypot(b.cx - a.cx, b.cy - a.cy, b.cz - a.cz);
      if (d > step) { step = d; stepAt = `${a.ph}->${b.ph}`; }
      if (dc > cam) { cam = dc; camAt = `${a.ph}->${b.ph}`; }
    }
    const ride = frames.filter((f) => f.onRide);
    let worstS = null;
    for (const f of ride) { if (f.mn < minCl) { minCl = f.mn; worstS = f.s; } maxSpan = Math.max(maxSpan, f.span); }
    // the speed on the carrier: metres along the line per second over the middle of the ride
    let v = null;
    if (ride.length > 20) { const a = ride[Math.floor(ride.length * 0.3)], b = ride[Math.floor(ride.length * 0.8)]; v = (b.s - a.s) / ((b.t - a.t) / 1000); }
    const phases = [...new Set(frames.map((f) => f.ph))];
    return { n: frames.length, step: +step.toFixed(2), stepAt, cam: +cam.toFixed(2), camAt, minCl: +minCl.toFixed(3), worstS: worstS === null ? null : +worstS.toFixed(1), maxSpan: +maxSpan.toFixed(3), v: v === null ? null : +v.toFixed(2), rideSpeed: S.ride ? S.ride.speed : null, phases, done: done(), ms: Math.round(performance.now() - t0) };
  }, { until, maxS, belt });
}

export const flow = {
  name: "ski-standing-lift",
  fullChromium: true,
  viewport: { width: 1080, height: 810 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.phase === "running" && !window.__ski.ride && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 60000 });
    /** ~12 m out of the zone in the catchment, with the game's own way in clear; placed there standing. */
    const standOut = (id) => page.evaluate((id) => {
      const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), w = site.wait, H = (x, z) => S.surface.height(x, z);
      for (const r of [12, 10, 14, 8, 6]) for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, q = { x: w.x + Math.cos(a) * r, z: w.z + Math.sin(a) * r };
        if (S.modes.lifts.world.inStation(q.x, q.z, 0.5) || S.modes.lifts.world.inBuilding(q.x, q.z, 0.5)) continue;
        const c = S.modes.lifts.catchAt(q.x, q.z);
        if (!c || c.lift.id !== id || c.down) continue;
        if (S.modes.lifts.guideWay(l, false, q, H)) { S.placeHold(q.x, q.z, Math.atan2(w.z - q.z, w.x - q.x)); return r; }
      }
      return 0;
    }, id);
    const goTo = async (id) => {
      await page.evaluate((id) => window.__ski.goFree(id), id);
      await running();
      await page.waitForTimeout(800);
    };
    for (const rid of RESORTS) {
      h.step(`${rid}: the steepest drag lift, on skis and on a board`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 120000 });
      const picks = await page.evaluate(() => {
        const S = window.__ski, W = S.modes.lifts.world, grade = (l) => (l.top.y - l.bottom.y) / l.len;
        const of = (kind, f = () => true) => S.modes.lifts.list.filter((l) => { const s = W.sites.get(l.index); return s && s.path.kind === kind && !l.tunnel && f(s); }).sort((a, b) => grade(b) - grade(a));
        const drag = of("drag", (s) => s.path.sub !== "rope")[0], carpet = of("carpet").sort((a, b) => b.len - a.len)[0];
        const info = (l) => (l ? { id: l.id, name: l.name, deg: Math.round(Math.atan(grade(l)) * 180 / Math.PI), len: Math.round(l.len), sub: W.sites.get(l.index).path.sub || "" } : null);
        return { drag: info(drag), carpet: info(carpet), ski: S.skiType };
      });
      if (picks.drag) {
        for (const kit of ["skis", "snowboard"]) {
          if (kit === "snowboard") await page.evaluate(() => window.__ski.setSki("snowboard"));
          await goTo(picks.drag.id);
          const r = await standOut(picks.drag.id);
          await page.waitForTimeout(600);
          const rec = await rideRecord(page, { until: "share", maxS: 45 });
          const tag = `${rid} ${picks.drag.sub} "${picks.drag.name}" (${picks.drag.deg}°) on ${kit}`;
          h.expect(rec.done, `${tag}: pressed ${r} m out, walked in, boarded and pulled up (${rec.phases.join(" ")}, ${rec.ms} ms)`);
          h.expect(rec.step < 1.2, `${tag}: no jump of the skier (max ${rec.step} m in a frame, ${rec.stepAt})`);
          h.expect(rec.cam < 1.5, `${tag}: no camera cut (max ${rec.cam} m in a frame, ${rec.camAt})`);
          h.expect(rec.minCl > -0.06 && rec.maxSpan < 0.15, `${tag}: on the track the ${kit === "skis" ? "skis lie" : "board lies"} on the snow (lowest ${rec.minCl} m, tip-tail ${rec.maxSpan} m)`);
          if (kit === "skis") await h.shot(`${rid}-drag-ride`);
          else await h.shot(`${rid}-drag-board`);
        }
        await page.evaluate((id) => window.__ski.setSki(id || "allmountain"), picks.ski);
      } else h.expect(true, `${rid}: no drag lift`);
      if (picks.carpet) {
        h.step(`${rid}: the magic carpet ${picks.carpet.name} (${picks.carpet.len} m)`);
        await goTo(picks.carpet.id);
        const r = await standOut(picks.carpet.id);
        await page.waitForTimeout(600);
        const rec = await rideRecord(page, { until: "done", maxS: 120, belt: 0.18 });
        const tag = `${rid} carpet "${picks.carpet.name}"`;
        h.expect(rec.done && ["lift/board", "lift/ride", "lift/alight"].every((p) => rec.phases.includes(p)), `${tag}: pressed ${r} m out, onto the belt, carried up, off the top (${rec.phases.join(" ")}, ${rec.ms} ms)`);
        h.expect(rec.step < 1.2 && rec.cam < 1.5, `${tag}: continuous all the way (skier ${rec.step} m / camera ${rec.cam} m in a frame at most)`);
        const want = await page.evaluate((id) => { const S = window.__ski, l = S.modes.lifts.byId.get(id), p = S.modes.lifts.world.sites.get(l.index).path; return p.spec.speed * 2; }, picks.carpet.id);
        h.expect(rec.v !== null && Math.abs(rec.v - want) < want * 0.2, `${tag}: carried at the belt's speed (${rec.v} m/s, belt ${want} m/s)`);
        h.expect(rec.minCl > -0.06 && rec.maxSpan < 0.15, `${tag}: the skis on the belt (lowest ${rec.minCl} m at ${rec.worstS} m, tip-tail ${rec.maxSpan} m)`);
        const end = await page.evaluate((id) => { const S = window.__ski, l = S.modes.lifts.byId.get(id), st = S.state; return { d: Math.round(Math.hypot(st.x - l.top.x, st.z - l.top.z)), hold: S.hold }; }, picks.carpet.id);
        h.expect(end.d < 40 && end.hold, `${tag}: he stands at the top, ${end.d} m from the belt's end`);
        await h.shot(`${rid}-carpet-top`);
      } else h.expect(true, `${rid}: no magic carpet in the data`);
    }
    h.eq(errors.length, 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  },
};
runIfMain(import.meta.url, flow);
