/* Flow: Ski Alpen, ride DOWN (Ian, Via Lattea: "you can't go down with the gondola Cesana Ski Lodge 1, but there is no other way to
 * come down than take that lift"). Via Lattea free ride:
 *   list      the map's lift list: "Cesana-Ski Lodge 1" has an "⬇ Erof" button; a drag lift has none
 *   top       Erof = fast travel onto the top station's descent mat: the HUD button says "Erof: …", L boards
 *   ride      in a cabin on the DOWN lane, going down, facing downhill; the wire state carries the direction (code 12); the HUD says
 *             "bis ënnen"; the day clock moves on by the ride time; the map stays shut on the lift ("ënnen")
 *   bottom    off at Cesana (the bottom station), standing still, skis on; the ride counted
 *   chair     a chairlift's descent with "Iwwersprangen" (Enter): seated, off at its bottom
 * Shots (SKI_RIDE_DOWN_SHOTS=dir, else the flow shots): boarding at the top, mid-ride, arrival. Zero page errors. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-ride-down",
  fullChromium: true,
  viewport: { width: 1080, height: 810 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "random"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const outDir = process.env.SKI_RIDE_DOWN_SHOTS || "";
    const shot = async (label) => {
      await h.shot(label);
      if (outDir) { fs.mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, `${label}.png`) }); }
    };
    const ride = () => page.evaluate(() => {
      const r = window.__ski.ride, s = window.__ski.state;
      if (!r) return null;
      const q = r.path.at(r.s, {});
      return { down: !!r.down, kind: r.kind, phase: r.phase, s: r.s, y: s.y, pose: s.ride, rideKind: s.rideKind, facingUp: Math.cos(s.heading) * q.dx + Math.sin(s.heading) * q.dz, hud: (document.getElementById("rLeft") || {}).textContent || "", dir: document.documentElement.dataset.skiRideDir, carrier: !!window.__ski.scene.getObjectByName(`ski-ride-${r.kind}`) };
    });

    h.step("Via Lattea free ride, the lift list offers Erof for the Cesana gondola");
    await h.goto("/pb/ski.html?resort=vialattea&go=1&debug=1&timescale=3&q=low&npcs=1");
    await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots into the free ride");
    const ids = await page.evaluate(() => {
      const L = window.__ski.modes.lifts.list;
      const ces = L.find((l) => l.baseName === "Cesana-Ski Lodge 1");
      const drag = L.find((l) => l.kind === "drag");
      const chair = L.filter((l) => l.kind === "chair" && l.down && l.len > 600 && l.len < 1400).sort((a, b) => a.len - b.len)[0];
      return { ces: ces && ces.id, cesDown: ces && ces.down, cesBottom: ces && ces.bottom, cesTop: ces && ces.top, drag: drag && drag.id, chair: chair && chair.id, chairName: chair && chair.name };
    });
    h.expect(!!ids.ces && ids.cesDown, `"Cesana-Ski Lodge 1" rides down (${ids.ces})`);
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
    await page.click(`.lrow[data-lift="${ids.drag}"]`);
    h.eq(await page.$("#freeDown") === null, true, "a drag lift has no Erof button");
    await page.click(`.lrow[data-lift="${ids.ces}"]`);
    await page.waitForFunction(() => document.documentElement.dataset.skiFreeReady === "1", null, { timeout: 60000 });
    h.expect(await page.$("#freeDown") !== null, "the Cesana gondola has the Erof button");
    await page.click("#freeDown");
    await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id && window.__ski.modes.liftDown, ids.ces, { timeout: 30000 });
    const btn = await page.evaluate(() => { const b = document.getElementById("liftBtn"); return { hidden: b.hidden, text: b.textContent }; });
    h.expect(!btn.hidden && /Erof: Cesana-Ski Lodge 1/.test(btn.text), `on the top's descent mat, the button says "${btn.text.trim()}"`);
    const top = await page.evaluate((t) => { const s = window.__ski.state; return { d: Math.hypot(s.x - t.x, s.z - t.z), y: s.y }; }, ids.cesTop);
    h.expect(top.d < 40, `at the middle station (${top.d.toFixed(0)} m from the line's top, ${top.y.toFixed(0)} m)`);
    await h.pause(1200);
    await shot("1-top-descent-mat");

    h.step("L: board at the top, ride DOWN facing downhill");
    const hour0 = await page.evaluate(() => window.__ski.modes.clock && window.__ski.modes.clock.hour);
    await page.keyboard.press("l");
    await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride && window.__ski.ride.down, null, { timeout: 5000 });
    await h.pause(700);
    await shot("2-boarding-at-the-top");
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 20000 });
    const hour1 = await page.evaluate(() => window.__ski.modes.clock && window.__ski.modes.clock.hour);
    const r1 = await ride();
    await h.pause(2500);
    const r2 = await ride();
    h.expect(r1.down && r1.kind === "gondola" && r1.pose === "carry" && r1.carrier && r1.dir === "down", `in a cabin of the gondola, going down (${r1.dir})`);
    h.expect(r2.s < r1.s - 20 && r2.y < r1.y - 5, `down the real line: s ${Math.round(r1.s)} -> ${Math.round(r2.s)}, ${Math.round(r1.y)} -> ${Math.round(r2.y)} m`);
    h.expect(r2.facingUp < -0.5, `facing downhill (${r2.facingUp.toFixed(2)})`);
    h.eq(r2.rideKind, 12, "the online state says: gondola, going down");
    h.expect(/bis ënnen/.test(r2.hud), `HUD: "${r2.hud}"`);
    h.expect(Number.isFinite(hour0) && hour1 > hour0 + 0.01, `the day clock moved on by the ride time (${hour0 && hour0.toFixed(3)} -> ${hour1 && hour1.toFixed(3)} h)`);
    await shot("3-mid-ride-chase");
    const wire = await page.evaluate(() => window.__ski.ride.wire());
    h.expect(wire[0] === 12 && wire[1] >= 0, `wire [${wire.join(", ")}]`);
    await page.keyboard.press("m");
    await h.pause(300);
    h.expect(await page.evaluate(() => document.documentElement.dataset.skiScreen === "ski"), "no map on the lift");

    h.step("off at Cesana, standing still");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 120000 });
    const end = await page.evaluate((b) => { const s = window.__ski.state; return { d: Math.hypot(s.x - b.x, s.z - b.z), y: s.y, ride: s.ride || "", speed: s.speed, lifts: document.documentElement.dataset.skiLifts }; }, ids.cesBottom);
    h.expect(end.d < 80 && !end.ride, `at Cesana: ${end.d.toFixed(0)} m from the bottom station, ${end.y.toFixed(0)} m, skis on`);
    h.expect(Math.abs(end.y - ids.cesBottom.y) < 25, `down in the valley (${Math.round(end.y)} m vs the station's ${Math.round(ids.cesBottom.y)} m)`);
    await h.pause(1500);
    h.expect(await page.evaluate(() => window.__ski.state.speed < 0.3), "he stands still after the ride");
    await shot("4-arrival-cesana");

    h.step(`a chair's descent with Iwwersprangen: ${ids.chairName}`);
    await page.evaluate((id) => window.__ski.goDown(id), ids.chair);
    await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id && window.__ski.modes.liftDown, ids.chair, { timeout: 30000 });
    await page.click("#liftBtn");
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 20000 });
    await h.pause(1200);
    const c1 = await ride();
    h.expect(c1.down && c1.kind === "chair" && c1.pose === "sit" && c1.facingUp < -0.5 && c1.rideKind === 11, `seated on a chair going down, facing downhill (code ${c1.rideKind})`);
    await shot("5-chair-down");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 60000 });
    const ce = await page.evaluate((id) => { const l = window.__ski.modes.lifts.byId.get(id), s = window.__ski.state; return { d: Math.hypot(s.x - l.bottom.x, s.z - l.bottom.z), ride: s.ride || "" }; }, ids.chair);
    h.expect(ce.d < 80 && !ce.ride, `Iwwersprangen: off at the chair's bottom (${ce.d.toFixed(0)} m)`);
    h.eq(errors.length, 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  },
};
runIfMain(import.meta.url, flow);
