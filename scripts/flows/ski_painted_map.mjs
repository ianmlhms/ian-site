/* Flow: Ski Alpen, the painted piste map (28 Nov 2026, a test on Via Lattea only; resort.json panorama.style = 'painted'):
 *   whole    the map opens on the WHOLE area (zoom 1 = fit), "Du" is on it; ◎ goes close to him
 *   style    thin lines, number badges, the legend line shows the lift symbols; the plan from above ("2D") has none of that
 *   taps     a tap on a piste gives its card; «Bei den éischte Lift» still teleports
 *   ride     the map on a lift still opens on the lift (highlight, "Hei kënns du un")
 *   others   Killy is unchanged: opens on the skier (zoom > 1), no painted legend items
 * Shots (SKI_PAINTED_SHOTS=dir, default ~/Library/Caches/ski-work/painted-map/): LOOK at them. Zero page errors. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-painted-map",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_mapview"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const outDir = process.env.SKI_PAINTED_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/painted-map");
    const engine = process.env.FLOW_BROWSER || "chromium";
    const shot = async (label) => { fs.mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, `flow-${engine}-${label}.png`) }); };
    const boot = async (resort) => {
      await h.goto(`/pb/ski.html?resort=${resort}&go=1&debug=1&timescale=3&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 120000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${resort} boots into the free ride`);
    };
    const openMap = async () => {
      await page.evaluate(() => window.__ski.showMap());
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" && window.__ski.pisteMap, null, { timeout: 15000 });
      await h.pause(1500);
    };
    const state = () => page.evaluate(() => {
      const m = window.__ski.pisteMap, you = m.you, xy = you ? m.screenXY(you.x, you.z) : null, r = document.getElementById("mapCanvas").getBoundingClientRect();
      const keys = [...document.querySelectorAll("#mapLegend .lg-paint")];
      return {
        view: m.view, zoom: m.zoom, scale: m.scale, you: !!you, xy, w: r.width, h: r.height,
        style: m.style, keys: keys.length, keysShown: keys.filter((k) => !k.hidden && k.closest("summary") && k.querySelector("canvas")).length,
        pulse: !!document.querySelector(".mappulse:not([hidden])"),
      };
    });

    h.step("Via Lattea: the painted map opens on the whole area");
    await boot("vialattea");
    await openMap();
    let s = await state();
    h.eq(s.style, "painted", "Via Lattea's panorama is the painted style");
    h.eq(s.view, "relief", "the panorama is shown");
    h.expect(s.zoom > 0.85 && s.zoom < 1.1, `opens on the whole area (zoom ${s.zoom.toFixed(2)} of the fit)`);
    h.expect(s.you && s.xy && s.xy[0] > 0 && s.xy[1] > 0 && s.xy[0] < s.w && s.xy[1] < s.h, `"Du" is on the overview at ${s.xy && s.xy.map(Math.round)}`);
    h.eq(s.keysShown, 3, "the compact legend shows the three lift symbols (+ the mid station in the list)");
    await shot("1-whole");
    h.step("◎ goes close to him");
    await page.click("#mapMe");
    await h.pause(900);
    s = await state();
    h.expect(s.zoom > 1.6 && Math.hypot(s.xy[0] - s.w / 2, s.xy[1] - s.h / 2) < Math.max(s.w, s.h) * 0.3, `◎: zoom ${s.zoom.toFixed(2)}, him near the middle (${s.xy.map(Math.round)})`);
    await shot("2-me");
    h.step("a tap on a piste: its card");
    const tp = await page.evaluate(() => {
      const S = window.__ski, m = S.pisteMap, r = document.getElementById("mapCanvas").getBoundingClientRect();
      for (const p of S.pistes.list.filter((q) => q.length > 600)) {
        const a = p.at(p.length * 0.5, {}), [x, y] = m.screenXY(a.x, a.z);
        if (x > 60 && y > 80 && x < r.width - 200 && y < r.height - 120 && m.pisteAt(a.x, a.z) === p) return { x: r.left + x, y: r.top + y, name: p.name };
      }
      return null;
    });
    h.expect(!!tp, `a piste on screen to tap (${tp && tp.name})`);
    if (tp) {
      await page.mouse.click(tp.x, tp.y);
      await h.pause(500);
      const card = await page.evaluate(() => ({ shown: !document.getElementById("mapCard").hidden, name: (document.getElementById("mcName") || {}).textContent || "" }));
      h.expect(card.shown && card.name.length > 0, `the card names "${card.name}"`);
      await shot("3-tap");
      await page.evaluate(() => { const x = document.getElementById("mcClose"); if (x) x.click(); });
    }
    h.step("the plan from above keeps the old look");
    await page.click("#mapView");
    await h.pause(1200);
    s = await state();
    h.expect(s.view === "flat" && s.keysShown === 0, `2D: view ${s.view}, painted legend items hidden (${s.keysShown})`);
    await page.click("#mapView");
    await h.pause(800);
    h.eq((await state()).view, "relief", "back to the panorama");
    h.step("«Bei den éischte Lift» still teleports");
    await page.click('[data-act="resume"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running", null, { timeout: 20000 });
    const first = await page.evaluate(() => { const b = window.__ski.spawn.bottom, s = window.__ski.state; window.__ski.placeHold(s.x + 900, s.z + 600, 0); return { x: b.x, z: b.z }; });
    await h.pause(600);
    const away = await page.evaluate(([fx, fz]) => Math.hypot(window.__ski.state.x - fx, window.__ski.state.z - fz), [first.x, first.z]);
    await openMap();
    if (await page.locator("#tpFirst").isVisible().catch(() => false)) {
      await page.click("#tpFirst");
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski", null, { timeout: 20000 }).catch(() => {});
      await h.pause(800);
      const after = await page.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z, screen: document.documentElement.dataset.skiScreen }));
      const d = Math.hypot(after.x - first.x, after.z - first.z);
      h.expect(after.screen === "ski" && away > 500 && d < 150, `«Bei den éischte Lift»: ${Math.round(away)} m away -> ${Math.round(d)} m from the first lift`);
    } else h.expect(false, "the «Bei den éischte Lift» button is there");

    h.step("Via Lattea: the map on a lift still opens on the lift");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 20000 });
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 30000 }).catch(() => {});
    await page.keyboard.press("l");
    await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride, null, { timeout: 15000 });
    await page.keyboard.press("m");
    await h.pause(700);
    const rm = await page.evaluate(() => { const r = window.__ski.rideMap; return r ? { open: document.documentElement.dataset.skiRideMap === "1", rs: r.map.rideState, zoom: r.map.zoom } : null; });
    h.expect(!!rm && rm.open && rm.rs && rm.rs.label === "Hei kënns du un", `the ride map is open on the lift ("${rm && rm.rs && rm.rs.label}", zoom ${rm && rm.zoom.toFixed(2)})`);
    await shot("4-ride");
    await page.keyboard.press("m");
    await page.evaluate(() => window.__ski.skipRide());

    h.step("Killy is unchanged: opens on the skier, no painted items");
    await boot("killy");
    await openMap();
    s = await state();
    h.expect(s.style === "print" && s.view === "relief" && s.zoom > 1.1 && s.keys === 0, `Killy: style "${s.style}", zoom ${s.zoom.toFixed(2)}, painted legend items ${s.keys}`);
    await shot("5-killy");
    h.eq(errors, [], "no page errors");
  },
};

await runIfMain(import.meta.url, flow);
