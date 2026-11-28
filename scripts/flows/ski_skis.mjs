/* Flow: Ski Alpen ski types (round 6). A player with 9 stars and 9.99 km off the piste: the Skier tab shows five skis, only the
 * All-Mountain is open, the others name what they need. The 10th star (a challenge run, scripted skier allowed to count) opens the
 * Carving ski ("Op: Ski Carving" on the finish card); 20 more metres off the piste in the free ride (real key input: Space) open the
 * Powder ski (toast). Picking a ski: in the Skier tab and at a lift station (🎿 card). The handling is measurably different on the real
 * mountain (the same scripted descent, the same spot, one ski each: Powder faster off the piste, Carving sharper on it), and a timed
 * run always uses the reference ski (fair boards). The pick and the stats go into the save and the cloud record. Zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-skis",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      try {
        if (!sessionStorage.getItem("skiSkisInit")) {
          sessionStorage.setItem("skiSkisInit", "1");
          localStorage.setItem("pb_ski_save", JSON.stringify({ v: 1, best: {}, ghosts: {}, runs: {}, stars: { "killy/seed1": 7, "killy/seed2": 7, "killy/seed3": 7 }, park: {}, bestHash: {}, last: null, ghostOrder: [], stats: { off: 9990, top: 10 } }));
          localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
        }
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const toMap = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 30000 });

    h.step("the Skier tab: five skis + the snowboard, only the All-Mountain and the snowboard open");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&bot=1&timescale=8&q=low");
    await toMap();
    await page.click('.modetabs [data-mode="skis"]');
    await page.waitForSelector(".skicard");
    const cards = await page.$$eval(".skicard", (c) => c.map((x) => ({ id: x.dataset.ski, locked: x.classList.contains("locked"), sel: x.classList.contains("sel"), lock: (x.querySelector(".lock") || {}).textContent || "" })));
    h.eq(cards.map((c) => c.id), ["allmountain", "carving", "race", "powder", "snowboard", "park"], "five ski types + the snowboard (28 Nov 2026)");
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    h.expect(by.allmountain.sel && !by.allmountain.locked && !by.snowboard.locked && ["carving", "race", "powder", "park"].every((id) => by[id].locked), "All-Mountain picked, the snowboard open from the start, the other four locked");
    h.expect(/10 ★/.test(by.carving.lock) && /30 ★.*90 km\/h/.test(by.race.lock) && /10 km/.test(by.powder.lock) && /5.000 Punkten/.test(by.park.lock), `what they need: ${cards.filter((c) => c.locked).map((c) => c.lock.replace("🔒 ", "")).join(" | ")}`);
    h.expect(/fair/.test(await page.textContent(".fairnote")), "the fairness note is on the tab");
    await h.shot("skis-locked");

    h.step("the 10th star opens the Carving ski");
    await page.click('.modetabs [data-mode="piste"]');
    const blue = await page.evaluate(() => window.__ski.pistes.list.filter((p) => p.diff === "blue" && !p.src.slalom && p.length > 380).sort((a, b) => a.length - b.length)[0].id);
    await page.evaluate((id) => window.__ski.select(id), blue);
    await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
    await page.click("#startBtn");
    await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" && window.__ski.game.phase === "running", null, { timeout: 30000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiPhysics), "fair", "a timed run uses the reference ski (fair boards)");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 120000 });
    const card = await page.textContent("#finishCard");
    h.expect(/Op: Ski Carving/.test(card), "the finish card: Op: Ski Carving");
    h.expect(/Weider fräi fueren/.test(card), "the finish card offers: Weider fräi fueren");
    await h.shot("finish-carving");
    await page.click('#finishCard [data-a="map"]');
    await toMap();
    await page.click('.modetabs [data-mode="skis"]');
    await page.click('.skicard [data-pick="carving"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiType === "carving", null, { timeout: 5000 });
    h.expect(await page.evaluate(() => document.querySelector('.skicard.sel').dataset.ski === "carving"), "Carving picked in the Skier tab");

    h.step("the free ride uses the ski; 20 m more off the piste (real keys) open the Powder ski");
    const spot = await page.evaluate(() => {
      const S = window.__ski, f = S.surface;
      for (let i = 0; i < 3000; i++) {
        const x = 2500 + (i * 977) % 12000, z = 2500 + (i * 613) % 10000;
        if (S.pistes.nearest(x, z, 200) || f.info(x, z, 0) > 0.1 || f.info(x, z, 1) > 0.05 || f.height(x, z) < 1900) continue;
        const gx = (f.height(x + 20, z) - f.height(x - 20, z)) / 40, gz = (f.height(x, z + 20) - f.height(x, z - 20)) / 40;
        const g = Math.hypot(gx, gz);
        if (g < 0.3 || g > 0.6) continue;
        const hd = Math.atan2(-gz, -gx);
        let clear = true;
        for (let d = 10; d < 120 && clear; d += 10) { const px = x + Math.cos(hd) * d, pz = z + Math.sin(hd) * d; if (S.pistes.nearest(px, pz, 60) || f.info(px, pz, 0) > 0.1 || f.info(px, pz, 1) > 0.05) clear = false; }
        if (clear) return { x, z, heading: hd };
      }
      return null;
    });
    h.expect(!!spot, `an open off-piste slope at ${spot && Math.round(spot.x)}, ${spot && Math.round(spot.z)}`);
    await page.evaluate((sp) => window.__ski.goFree(null), spot);
    await page.waitForFunction(() => window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 20000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiPhysics), "carving", "the free ride rides on the picked ski");
    await page.evaluate((sp) => { window.__ski.streamer.focus(sp.x, sp.z); }, spot);
    await page.evaluate((sp) => window.__ski.streamer.ready(sp.x, sp.z, 300), spot);
    await page.evaluate((sp) => window.__ski.place(sp.x, sp.z, sp.heading), spot);
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.__ski.modes.sessionStats.off > 25, null, { timeout: 20000 });
    await page.keyboard.up("Space");
    await page.keyboard.down("s");
    await page.waitForFunction(() => window.__ski.modes.openSkis().includes("powder"), null, { timeout: 15000 });
    await page.keyboard.up("s");
    h.expect(true, `${Math.round(await page.evaluate(() => window.__ski.modes.sessionStats.off))} m off the piste: the Powder ski is open`);
    await h.shot("free-offpiste");

    h.step("the handling is measurably different (the same descent on the real mountain, one ski each)");
    const test = await page.evaluate(async (sp) => {
      const { stepSkier, createSkierState } = await import("/pb/ski/skier.js");
      const { skiParams } = await import("/pb/ski/modes/skis.js");
      const W = window.__ski.world;
      const run = (id, input, x, z, hd, steps) => {
        const w = { ...W, ski: skiParams(id), tricks: false };
        let s = createSkierState(x, z, hd, w.height(x, z));
        let dist = 0, turn = 0;
        for (let i = 0; i < steps; i++) { const p = s; s = stepSkier(s, input, w); dist += Math.hypot(s.x - p.x, s.z - p.z); if (s.crash > 0) break; }
        turn = Math.abs(Math.atan2(Math.sin(s.heading - hd), Math.cos(s.heading - hd)));
        return { dist, speed: s.speed * 3.6, turn };
      };
      const straight = { steer: 0, tuck: 1, brake: 0, push: 0, jump: false };
      const off = Object.fromEntries(["allmountain", "carving", "powder"].map((id) => [id, run(id, straight, sp.x, sp.z, sp.heading, 480)]));
      const p = window.__ski.pistes.byId.get("face"), a = p.at(p.length * 0.3, {});
      const carveIn = { steer: 0, tuck: 0, brake: 0, push: 0, jump: false };
      const onP = Object.fromEntries(["allmountain", "carving"].map((id) => { const w = run(id, carveIn, a.x, a.z, Math.atan2(a.dz, a.dx), 360); return [id, w]; }));
      // a hard carve at speed: from the same entry speed, how far the skis turn in 0.6 s
      const carve = Object.fromEntries(["allmountain", "carving", "race"].map((id) => {
        const w = { ...W, ski: skiParams(id), tricks: false };
        let s = createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), w.height(a.x, a.z));
        s = { ...s, vx: Math.cos(s.heading) * 16, vz: Math.sin(s.heading) * 16, speed: 16 };
        const h0 = s.heading;
        for (let i = 0; i < 72; i++) s = stepSkier(s, { steer: 1, tuck: 0, brake: 0, push: 0, jump: false }, w);
        return [id, Math.abs(Math.atan2(Math.sin(Math.atan2(s.vz, s.vx) - h0), Math.cos(Math.atan2(s.vz, s.vx) - h0))) * 180 / Math.PI];
      }));
      return { off, onP, carve };
    }, spot);
    console.log(`      off piste 4 s tuck: ${Object.entries(test.off).map(([k, v]) => `${k} ${v.dist.toFixed(0)} m / ${v.speed.toFixed(0)} km/h`).join(", ")}`);
    console.log(`      carve 0.6 s at 58 km/h: ${Object.entries(test.carve).map(([k, v]) => `${k} ${v.toFixed(0)}°`).join(", ")}`);
    h.expect(test.off.powder.dist > test.off.allmountain.dist * 1.08, `Powder floats off the piste: ${test.off.powder.dist.toFixed(0)} m vs ${test.off.allmountain.dist.toFixed(0)} m (All-Mountain)`);
    h.expect(test.off.carving.dist < test.off.allmountain.dist, `Carving sinks: ${test.off.carving.dist.toFixed(0)} m`);
    h.expect(test.carve.carving > test.carve.allmountain * 1.1 && test.carve.race < test.carve.allmountain, `turn in 0.6 s: Carving ${test.carve.carving.toFixed(0)}°, All-Mountain ${test.carve.allmountain.toFixed(0)}°, Race GS ${test.carve.race.toFixed(0)}°`);

    h.step("at a lift station: the 🎿 card switches the ski");
    await page.evaluate(() => window.__ski.goFree(window.__ski.spawn.id));
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !document.getElementById("skiSwap").hidden, null, { timeout: 20000 });
    await page.click("#skiSwap");
    await page.waitForSelector("#skiCard");
    await h.shot("lift-ski-card");
    await page.click('#skiCard [data-pick="powder"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiType === "powder" && !document.getElementById("skiCard"), null, { timeout: 5000 });
    h.eq(await page.evaluate(() => [document.documentElement.dataset.skiPhysics, window.__ski.world.ski.powderDrag < 0.01]), ["powder", true], "Powder on: its physics in the free ride");
    await h.pause(1200);
    await h.shot("powder-skis");

    h.step("the pick and the stats are saved (local and the cloud record)");
    const saved = await page.evaluate(async () => {
      const p = window.__ski.progress();
      const { encodeCloud } = await import("/pb/ski/modes/cloud.js");
      const rec = encodeCloud(p);
      return { ski: p.ski, off: p.stats.off, k: rec.x.k, o: rec.x.o };
    });
    h.expect(saved.ski === "powder" && saved.k === "powder" && saved.off >= 10000 && saved.o >= 10000, `save: ski ${saved.ski}, ${saved.off} m off the piste; cloud x.k ${saved.k}, x.o ${saved.o}`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
