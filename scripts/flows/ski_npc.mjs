/* Flow: Ski Alpen, the other skiers ("Aner Skifuerer", pb/ski/npc.js + npc-view.js). Espace Killy on Niddreg, the free ride at the first
 * lift: others stand at the station, ski the pistes and ride the lifts (counted near the spawn); the draw calls with them on stay
 * <= 160 (and <= 3 more than off), the triangles <= 450k; with the CPU throttled 4 x their update (simulation + drawing) stays <= 1 ms a
 * frame; the menu switch "Aner Skifuerer: Un / Aus" hides / shows them and is remembered; nobody stands in the boarding zone; a running
 * challenge has nobody in its corridor; zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-npc",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { if (!sessionStorage.getItem("skiNpcInit")) { sessionStorage.setItem("skiNpcInit", "1"); localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_npcs"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);

    h.step("free ride at the first lift (Niddreg): the others are there by default");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiNpcs), "1", "Aner Skifuerer: on by default");
    await page.evaluate(() => window.__ski.streamer.release());
    await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 240000, polling: 500 });
    await page.waitForFunction(() => !!window.__ski.lifts && !!window.__ski.npcs.view && window.__ski.npcs.live, null, { timeout: 60000 });
    await frames(40);
    const near = await page.evaluate(() => {
      const S = window.__ski, s = S.state, list = S.npcs.crowd.list, v = S.npcs.view.stats;
      const close = list.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < 150);
      const zone = list.filter((o) => S.modes.lifts.world.boardingAt(o.x, o.z) !== null).length;
      return { listed: list.length, close: close.length, kinds: [...new Set(list.map((o) => o.kind))].sort(), drawn: v.near + v.crowd, riders: v.riders, zone, info: S.info() };
    });
    h.expect(near.close >= 5 && near.listed >= 10, `${near.listed} others listed, ${near.close} within 150 m of the spawn (${near.kinds.join(", ")})`);
    h.expect(near.drawn >= 8 && near.riders >= 3, `${near.drawn} drawn on screen, ${near.riders} of them riding the lifts`);
    h.eq(near.zone, 0, "nobody stands in a boarding zone");
    await h.shot("npc-spawn");

    h.step("Niddreg budget with the others: draw calls, triangles, frame rate");
    const budget = await page.evaluate(async () => {
      const S = window.__ski, frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      S.npcs.set(false); await frames(10); const off = S.info();
      S.npcs.set(true); await frames(40); const on = S.info();
      await new Promise((r) => setTimeout(r, 3000));
      return { off, on, fr: S.frames() };
    });
    h.expect(budget.on.calls <= 160 && budget.on.calls - budget.off.calls <= 3, `draw calls ${budget.off.calls} -> ${budget.on.calls} (<= 160, <= +3)`);
    h.expect(budget.on.triangles <= 450000, `triangles ${budget.off.triangles} -> ${budget.on.triangles} (<= 450k)`);
    h.note && h.note(`frames p50 ${budget.fr.p50?.toFixed(1)} ms, p95 ${budget.fr.p95?.toFixed(1)} ms`);
    h.expect(Number.isFinite(budget.fr.p50), `frame time p50 ${budget.fr.p50?.toFixed(1)} ms, p95 ${budget.fr.p95?.toFixed(1)} ms`);

    h.step("CPU x4 (an iPad's pace): the others' update stays <= 1 ms a frame");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const cpu = await page.evaluate(async () => {
      const S = window.__ski, out = [];
      S.setInput({ steer: 0.25, tuck: 0, brake: 0, push: 1, jump: false });                // he moves: the selection follows him
      for (let i = 0; i < 150; i++) { await new Promise((r) => requestAnimationFrame(r)); out.push(S.npcs.crowd.stats.ms + (S.npcs.view.stats.ms || 0)); }
      S.setInput(null);
      out.sort((a, b) => a - b);
      return { mean: out.reduce((a, b) => a + b, 0) / out.length, p90: out[Math.floor(out.length * 0.9)], listed: S.npcs.crowd.stats.listed };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    h.expect(cpu.mean <= 1, `update + draw ${cpu.mean.toFixed(3)} ms a frame on average (p90 ${cpu.p90.toFixed(3)} ms), ${cpu.listed} listed, CPU x4`);

    h.step("the menu: Aner Skifuerer Aus / Un, remembered");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#menuCard #mNpcs", { timeout: 5000 });
    await page.click('#mNpcs [data-v="off"]');
    await page.click('#menuCard [data-a="resume"]');
    await frames(10);
    const offNow = await page.evaluate(() => ({ live: window.__ski.npcs.live, drawn: window.__ski.npcs.view.instances().length, saved: localStorage.getItem("pb_ski_npcs") }));
    h.expect(!offNow.live && offNow.drawn === 0 && offNow.saved === "0", `off: nobody drawn (${offNow.drawn}), saved "${offNow.saved}"`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#menuCard #mNpcs", { timeout: 5000 });
    h.expect(await page.$eval('#mNpcs [data-v="off"]', (b) => b.classList.contains("on")), "the menu shows Aus");
    await page.click('#mNpcs [data-v="on"]');
    await page.click('#menuCard [data-a="resume"]');
    await frames(30);
    const onNow = await page.evaluate(() => ({ live: window.__ski.npcs.live, drawn: window.__ski.npcs.view.instances().length, saved: localStorage.getItem("pb_ski_npcs") }));
    h.expect(onNow.live && onNow.drawn > 0 && onNow.saved === "1", `on again: ${onNow.drawn} drawn, saved "${onNow.saved}"`);

    h.step("a running challenge: nobody in its corridor");
    const pid = await page.evaluate(() => {
      const S = window.__ski, s = S.state;
      let best = null;
      for (const p of S.pistes.list) { if (p.diff !== "blue" || p.length < 700) continue; const d = Math.hypot(p.top.x - s.x, p.top.z - s.z); if (!best || d < best.d) best = { p, d }; }
      return (best ? best.p : S.pistes.list[0]).id;
    });
    await page.evaluate((id) => window.__ski.start(id), pid);
    await page.waitForFunction(() => !!window.__ski.course, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 30000 });
    let inCorridor = 0, seen = 0;
    for (let k = 0; k < 6; k++) {
      await frames(20);
      const r = await page.evaluate((id) => {
        const S = window.__ski, p = S.pistes.byId.get(id), hw = p.halfWidth + 12, list = S.npcs.crowd.list;
        let inside = 0;
        for (const o of list) { const pr = p.project(o.x, o.z, null, 0, {}); if (pr.dist < hw - 0.5 && pr.s > S.course.startS - 30 && pr.s < S.course.finishS + 10) inside++; }
        // drawn on the snow (riders on a lift crossing over the course are up in the air: no interference)
        for (const o of S.npcs.view.instances()) { if (o.pose >= 6 || Math.abs(o.y - S.surface.height(o.x, o.z)) > 2) continue; const pr = p.project(o.x, o.z, null, 0, {}); if (pr.dist < p.halfWidth && pr.s > S.course.startS && pr.s < S.course.finishS) inside++; }
        S.teleport(Math.min(p.length - 60, (S.game.run.progress || 0) + 120));
        return { inside, n: list.length };
      }, pid);
      inCorridor += r.inside; seen += r.n;
    }
    h.eq(inCorridor, 0, `nobody in the corridor of the challenge (${seen} listed around it over 6 looks)`);
    await h.shot("npc-challenge");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
