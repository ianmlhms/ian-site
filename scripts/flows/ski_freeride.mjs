/* Flow: Ski Alpen free ride all day (round 4A). The "Fräi fueren" tab of the piste map: the lifts as the start list and as dots on the
 * map, pick one, start at its top (no clock, no countdown). The HUD: the day clock, distance / vertical / lifts, the minimap. Skiing
 * downhill counts distance and vertical metres; off-piste between pistes is allowed (no "back to the piste"); the piste under the skier
 * changes from one to the next. At the bottom of a lift the "Mam Lift erop" button appears; riding up fades to its top, the lift count
 * goes up and the clock moves on by the ride. The light follows the day clock while the time choice is random; a fixed time keeps it.
 * Zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-freeride",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "random"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const state = () => page.evaluate(() => { const s = window.__ski.state, r = window.__ski.game.run; return { x: s.x, z: s.z, y: s.y, speed: s.speed, piste: r && r.piste ? r.piste.id : null, stats: r && r.stats ? { ...r.stats } : null, hour: window.__ski.modes.clock ? window.__ski.modes.clock.hour : null }; });

    h.step("piste map: the Fräi fueren tab lists the lifts");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&timescale=3&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    await page.click('.modetabs [data-mode="freeride"]');
    await page.waitForSelector(".lrow");
    const rows = await page.$$eval(".lrow", (r) => r.length);
    h.expect(rows > 40, `${rows} lifts to start from`);
    // the highest lift top of Tignes' Grande Motte area is first; pick the Grattalu chair (next to the park) by name if there
    const liftId = await page.evaluate(() => { const l = window.__ski.modes.lifts.list.find((x) => /Grattalu/.test(x.name)) || window.__ski.modes.lifts.list[0]; return l.id; });
    await page.click(`.lrow[data-lift="${liftId}"]`);
    await page.waitForFunction(() => document.documentElement.dataset.skiFreeReady === "1", null, { timeout: 60000 });
    await h.shot("free-map");

    h.step("start at the lift's top: day clock, counters, minimap");
    await page.click("#freeStart");
    await page.waitForFunction(() => window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 10000 });
    h.expect(await page.evaluate(() => !document.getElementById("freeHud").hidden && !!document.querySelector(".minimap canvas")), "the free ride HUD and the minimap are up");
    const s0 = await state();
    h.expect(s0.hour >= 9 && s0.hour < 16.5, `day clock at ${s0.hour.toFixed(2)} h`);

    h.step("ski down the piste from the top (the scripted skier steers): distance and vertical count");
    const first = await page.evaluate(async () => { const { createBot } = await import("/pb/ski/bot.js"); const s = window.__ski.state; const n = window.__ski.pistes.nearest(s.x, s.z, 250); window.__ski.game.bot = createBot(n.piste); return n.piste.id; });
    await h.pause(7000);
    await page.evaluate(() => { window.__ski.game.bot = null; window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
    await h.pause(1200);
    const s1 = await state();
    h.expect(s1.stats.distance > 60 && s1.stats.vertical > 10, `${Math.round(s1.stats.distance)} m ridden down ${first}, ${Math.round(s1.stats.vertical)} m down`);
    await h.shot("free-ride");

    h.step("from piste to piste: the piste under the skier changes, between them no reset");
    const two = await page.evaluate(() => {
      const L = window.__ski.pistes.list, a = L.find((p) => p.id === "moutons") || L[0];
      const b = L.filter((p) => p !== a && p.length > 500).sort((p, q) => Math.hypot(p.top.x - a.top.x, p.top.z - a.top.z) - Math.hypot(q.top.x - a.top.x, q.top.z - a.top.z))[0];
      return [a.id, b.id];
    });
    const names = [];
    for (const id of two) {
      await page.evaluate((pid) => { const p = window.__ski.pistes.byId.get(pid); const m = p.at(p.length * 0.5, {}); window.__ski.place(m.x, m.z, Math.atan2(m.dz, m.dx)); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); }, id);
      await h.pause(1600);
      names.push((await state()).piste);
    }
    h.eq(names, two, `the free run follows the piste under the skier (${two.join(" -> ")})`);
    const off = await page.evaluate(() => {
      const L = window.__ski.pistes;
      for (let i = 0; i < 400; i++) {
        const x = 3000 + (i * 977) % 11000, z = 3000 + (i * 613) % 9000;
        if (!L.nearest(x, z, 160) && window.__ski.surface.height(x, z) > 2000) { window.__ski.place(x, z, 0); return [x, z]; }
      }
      return null;
    });
    await h.pause(1500);
    const s2 = await state();
    h.expect(off && Math.hypot(s2.x - off[0], s2.z - off[1]) < 40 && s2.piste === null, "off-piste between pistes: no piste, the skier stays there");

    h.step("at a lift's bottom: Mam Lift erop, up to its top, the clock moves on");
    const lift = await page.evaluate((id) => { const l = window.__ski.modes.lifts.byId.get(id); window.__ski.place(l.bottom.x + 8, l.bottom.z + 8, 0); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); return { id: l.id, name: l.name, top: l.top, seconds: l.seconds }; }, liftId);
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 8000 });
    h.expect(/Mam Lift erop/.test(await page.textContent("#liftBtn")), `the lift button: ${(await page.textContent("#liftBtn")).trim()}`);
    await h.shot("free-lift-button");
    const hourBefore = (await state()).hour;
    await page.click("#liftBtn");
    await page.waitForFunction(() => document.documentElement.dataset.skiLifts === "1", null, { timeout: 15000 });
    const s3 = await state();
    h.expect(Math.hypot(s3.x - lift.top.x, s3.z - lift.top.z) < 60 && s3.stats.lifts === 1, `at the top of ${lift.name} (${Math.round(Math.hypot(s3.x - lift.top.x, s3.z - lift.top.z))} m from the station), 1 lift ridden`);
    h.expect(s3.hour - hourBefore > lift.seconds / 3600 * 0.9, `the clock moved on by the ride (${((s3.hour - hourBefore) * 60).toFixed(1)} min)`);

    h.step("the light follows the day clock (time random); a fixed time keeps it");
    await page.evaluate(() => window.__ski.modes.clock.set(16.2));
    await h.pause(600);
    h.eq(await page.evaluate(() => window.__ski.env.state.timeId), "evening", "16:12: the evening light");
    await page.evaluate(() => window.__ski.modes.clock.set(12.4));
    await h.pause(600);
    h.eq(await page.evaluate(() => window.__ski.env.state.timeId), "midday", "12:24: the midday light");
    await page.evaluate(() => window.__ski.setInput({ steer: 0.3, tuck: 1, brake: 0, push: 1, jump: false }));
    await h.pause(2500);
    await h.shot("free-day");
    await page.evaluate(() => { window.__ski.env.setTime("morning"); window.__ski.modes.clock.set(15.5); });
    await h.pause(600);
    h.eq(await page.evaluate(() => window.__ski.env.state.timeId), "morning", "the player fixed the morning: the clock does not change it");
    await page.evaluate(() => window.__ski.env.setTime("random"));
    const info = await page.evaluate(() => window.__ski.info());
    h.expect(info.calls <= 160, `Niddreg free ride: ${info.calls} draw calls <= 160`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
