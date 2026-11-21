/* Flow: Ski Alpen real lift rides (round 6). Espace Killy, free ride:
 *   gondola    the village spawn (a gondola's bottom station): "Astegen" by key L -> standing in a cabin on the real line, pylons
 *              passing, the third-person view and the window view (V), "Iwwersprangen" (Enter) -> off at the top, facing downhill
 *   chairlift  fast travel there through the map (M, Fräi fueren, a chair, "Bei de Lift"): the boarding button -> seated on a chair
 *              (the lift's own chairs keep their spacing round it), the ride goes on by itself until the top
 *   drag lift  pulled up on the snow (skis on the ground), to the top on its own
 * The multiplayer state while riding carries "riding lift X at s". Zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-lift",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const ride = () => page.evaluate(() => {
      const r = window.__ski.ride, s = window.__ski.state;
      if (!r) return null;
      const g = window.__ski.surface.height(s.x, s.z);
      const towers = r.path.supports.filter((t) => t.tower).map((t) => t.s);
      return { kind: r.kind, pose: s.ride, s: r.s, len: r.path.len, above: s.y - g, towers, carrier: !!window.__ski.scene.getObjectByName(`ski-ride-${r.kind}`), held: window.__ski.lifts.pathOf(r.lift.index).ride, view: window.__ski.rideView, lift: r.lift.name, top: r.lift.top };
    });
    const arrived = async (top) => {
      await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 120000 });
      return page.evaluate((t) => {
        const s = window.__ski.state, f = window.__ski.surface;
        const ahead = f.height(s.x + Math.cos(s.heading) * 15, s.z + Math.sin(s.heading) * 15), back = f.height(s.x - Math.cos(s.heading) * 15, s.z - Math.sin(s.heading) * 15);
        return { d: Math.hypot(s.x - t.x, s.z - t.z), downhill: ahead < back + 0.5, ride: s.ride || "" };
      }, top);
    };

    h.step("the free ride starts at the village gondola: Astegen with L");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&timescale=3&q=low");
    await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots straight into the free ride (?go=1)");
    const spawn = await page.evaluate(() => ({ name: window.__ski.spawn.name, kind: window.__ski.spawn.kind }));
    h.eq(spawn.kind, "gondola", `spawn at ${spawn.name}`);
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 10000 });
    await page.keyboard.press("l");
    await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 5000 });
    const g1 = await ride();
    await h.pause(2500);
    const g2 = await ride();
    h.expect(g1.kind === "gondola" && g1.pose === "stand" && g1.carrier && g1.held !== null && g2.above > 1.5, `in a cabin (${g2.lift}), standing, ${g2.above.toFixed(1)} m over the snow; the lift's own cabins keep their spacing around it`);
    h.expect(g2.s > g1.s + 30, `riding up the real line: ${Math.round(g1.s)} -> ${Math.round(g2.s)} m of ${Math.round(g2.len)} m (x4, test time x3)`);
    const passed = g2.towers.filter((t) => t < g2.s).length;
    h.expect(g2.towers.length > 3, `${g2.towers.length} pylons on the line, ${passed} passed`);
    await h.shot("gondola-chase");
    await page.keyboard.press("v");
    await h.pause(800);
    const cam = await page.evaluate(() => { const c = window.__ski.camera.position, s = window.__ski.state; return { view: window.__ski.rideView, d: Math.hypot(c.x - s.x, c.z - s.z), dy: c.y - s.y }; });
    h.expect(cam.view === "window" && cam.d < 1.5 && cam.dy > 1 && cam.dy < 2, `window view from his eyes (${cam.d.toFixed(2)} m, ${cam.dy.toFixed(2)} m up)`);
    await h.shot("gondola-window");
    await page.keyboard.press("v");
    await page.keyboard.press("Enter");
    const a1 = await arrived(g2.top);
    h.expect(a1.d < 120 && a1.downhill && !a1.ride, `Iwwersprangen: off at the top (${Math.round(a1.d)} m from the station), facing downhill, skis on`);
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiLifts), "1", "one lift ridden");
    await h.shot("gondola-top");

    h.step("fast travel through the map to a chairlift's bottom station, board with the button");
    const chairId = await page.evaluate(() => { const L = window.__ski.modes.lifts.list.filter((l) => l.kind === "chair" && l.len > 500 && l.len < 1300); return (L.find((l) => /Grattalu|Fresse|Borsat/.test(l.name)) || L[0]).id; });
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
    await page.evaluate(() => window.__ski.explore.discoverAll());      // R7-C: fast travel goes only to discovered lifts
    await page.click(`.lrow[data-lift="${chairId}"]`);
    await page.waitForFunction(() => document.documentElement.dataset.skiFreeReady === "1", null, { timeout: 60000 });
    await page.click("#freeStart");
    await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, chairId, { timeout: 20000 });
    await page.click("#liftBtn");
    await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 5000 });
    await h.pause(3000);
    const c1 = await ride();
    h.expect(c1.kind === "chair" && c1.pose === "sit" && c1.carrier && c1.held !== null && c1.above > 2, `seated on a chair of ${c1.lift}, ${c1.above.toFixed(1)} m over the snow`);
    await h.shot("chair-chase");
    await page.keyboard.press("v");
    await h.pause(700);
    await h.shot("chair-window");
    await page.keyboard.press("v");
    h.step("the chair rides to the top on its own");
    const a2 = await arrived(c1.top);
    h.expect(a2.d < 120 && a2.downhill, `off at the top of ${c1.lift} (${Math.round(a2.d)} m), facing downhill`);
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiLifts), "2", "two lifts ridden");
    h.eq(await page.evaluate(() => window.__ski.lifts.pathOf(window.__ski.modes.lifts.byId.get(window.__ski.game.freeLift.id).index).ride), null, "the chair is let go again");

    h.step("a drag lift: pulled up on the snow");
    const dragId = await page.evaluate(() => { const L = window.__ski.modes.lifts.list.filter((l) => l.kind === "drag" && l.len > 250 && l.len < 700); return L[0].id; });
    await page.evaluate((id) => window.__ski.goFree(id), dragId);
    await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, dragId, { timeout: 20000 });
    await page.keyboard.press("l");
    await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 5000 });
    await h.pause(2000);
    const d1 = await ride();
    h.expect(d1.kind === "drag" && d1.pose === "drag" && Math.abs(d1.above) < 0.3, `on ${d1.lift}: skis on the snow (${d1.above.toFixed(2)} m)`);
    const wire = await page.evaluate(async () => { const { packState, unpackState } = await import("/pb/ski/net/wire.js"); const a = packState(window.__ski.state, 0, false); const u = unpackState(a); return { n: a.length, ride: u.ride, lift: u.rideLift, s: u.rideS }; });
    h.expect(wire.n === 19 && wire.ride === "drag" && wire.s > 0, `the multiplayer state says: riding lift ${wire.lift} at ${wire.s} m`);
    await h.shot("drag");
    const a3 = await arrived(d1.top);
    h.expect(a3.d < 120, `off at the top of ${d1.lift} (${Math.round(a3.d)} m)`);
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiLifts), "3", "three lifts ridden");
    h.step("a rack railway / funicular of the bigger data (synthetic line here): track, carriage and the rider's train");
    const train = await page.evaluate(async () => {
      const S = window.__ski, s = S.state;
      const { createLifts } = await import("/pb/ski/lifts.js");
      const { createLiftPath } = await import("/pb/ski/lift-path.js");
      const { createRide } = await import("/pb/ski/modes/liftride.js");
      const { createCarrier } = await import("/pb/ski/modes/carriers.js");
      const pts = [s.x, s.z, s.x + 300, s.z + 200, s.x + 700, s.z + 260];
      const src = { kind: "rack_railway", name: "Test-Bunn", pts, pylons: [] };
      const h = (x, z) => S.surface.height(x, z);
      const view = createLifts({ scene: S.scene, resort: { lifts: [src] }, height: h });
      const path = createLiftPath(src, h);
      const r = createRide({ lift: { index: 0, name: "Test-Bunn", kind: "train" }, path, height: h });
      const car = createCarrier({ scene: S.scene, kind: "train" });
      for (let i = 0; i < 120; i++) r.step(1 / 60);
      const w = r.where();
      car.place(w); view.setRide(0, r.s); view.update(1, s.x, s.z, 5000);
      const st = r.state(s);
      S.renderer.render(S.scene, S.camera);
      const out = { kind: path.kind, pose: st.ride, above: st.y - h(st.x, st.z), count: view.count };
      car.dispose(); view.dispose();
      return out;
    });
    h.expect(train.kind === "train" && train.pose === "stand" && train.above > 0.4 && train.above < 1.5 && train.count === 1, `rack_railway -> a train: standing in the carriage ${train.above.toFixed(2)} m over the snow, track and stations drawn`);
    const info = await page.evaluate(() => window.__ski.info());
    h.expect(info.calls <= 160, `Niddreg: ${info.calls} draw calls <= 160`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
