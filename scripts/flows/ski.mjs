/* Flow: Ski Alpen gameplay. Menu -> (round 6) the free ride at a village lift -> the piste map (M) -> Challengen: piste -> a finished timed run (scripted skier, game time x4), the leaderboard post (mocked: the
 * standalone arcade kit fires "arcade:score"), weather and time switches by key and by HUD button, the ghost on the next run, the
 * keyboard controls, the pause menu, frame times on "Niddreg", zero page errors.
 * The scripted skier normally never posts a time; the flow opts in with window.__skiAllowBotScore. */
import { runIfMain } from "./lib.mjs";

const PISTE = "face";            // a red slalom piste, 1.1 km (Tignes)

export const flow = {
  name: "ski",
  fullChromium: true,
  measuresFrames: true,                    // R8f: the Niddreg p95 budget: real pixels + frame rate under FLOW_POWER
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,                    // round 5: a retina screen, so the flow's screenshots show the game as an iPad does
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      window.__scores = [];
      window.addEventListener("arcade:score", (e) => window.__scores.push(e.detail));
      window.addEventListener("arcade:board", (e) => { window.__board = e.detail.board; });
      // round 4A: reds and blacks open at a number of stars per resort; this player has them (placeholder star keys count like real ones)
      const stars = {};
      for (const rid of ["killy", "3vallees", "zermatt"]) for (let i = 0; i < 9; i++) stars[`${rid}/seed${i}`] = 7;
      try { localStorage.setItem("pb_ski_save", JSON.stringify({ v: 1, best: {}, ghosts: {}, runs: {}, stars, park: {}, bestHash: {}, last: null, ghostOrder: [] })); localStorage.setItem("pb_ski_weather", "random"); localStorage.setItem("pb_ski_time", "random"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("open: resort picker with all five resorts ready");
    await h.goto(`/pb/ski.html?debug=1&bot=1&timescale=4&q=low`);
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    h.eq(await page.$$eval(".resort", (b) => b.map((x) => (x.classList.contains("ready") ? x.dataset.id : "-"))), ["killy", "3vallees", "zermatt", "arlberg", "kronplatz", "vialattea", "obertauern", "livigno", "davos", "laax"], "Val d'Isère · Tignes first, all five resorts ready");
    await h.shot("picker");

    h.step("pick the resort: the free ride starts at a village lift's bottom station");
    await page.click(".resort.ready");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 60000 });
    h.expect(await page.evaluate(() => !document.getElementById("freeHud").hidden), "free ride HUD up");
    await h.pause(1500);
    await h.shot("free-spawn");

    h.step("piste map (M) over the free ride: Challengen tab, pick a piste from the list, weather and time controls");
    await page.keyboard.press("m");
    await page.waitForSelector("#mapCanvas");
    h.expect(await page.evaluate(() => !!document.getElementById("mapResume")), "the map over the free ride can go back to it (Weiderfueren)");
    await page.click('.modetabs [data-mode="piste"]');
    const listed = await page.$$eval(".prow", (r) => r.length);
    h.expect(listed > 100, `${listed} pistes listed`);
    await page.click(`.prow[data-id="${PISTE}"]`);
    h.eq(await page.textContent("#pkName"), "Face (Rout)", "the picked piste shows in the card (R8c: a name used by two colours carries its colour)");
    h.eq(await page.evaluate(() => window.__board && window.__board.id), `ski-killy-${PISTE}`, "its leaderboard is selected (ski-<resort>-<piste>)");
    await page.click('#segWeather [data-v="snow"]');
    await page.click('#segTime [data-v="evening"]');
    h.eq(await page.evaluate(() => [localStorage.getItem("pb_ski_weather"), localStorage.getItem("pb_ski_time")]), ["snow", "evening"], "weather and time choices are stored");
    await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
    await h.shot("map");

    h.step("start: 3-2-1, the scripted skier finishes the slalom piste");
    await page.click("#startBtn");
    await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1", null, { timeout: 20000 });
    await h.pause(1500);
    await h.shot("run");
    h.step("weather and time switch in game: G and T keys, HUD buttons");
    const before = await page.evaluate(() => [window.__ski.env.state.weatherMode, window.__ski.env.state.timeMode]);
    await page.keyboard.press("g");
    await page.keyboard.press("t");
    const after = await page.evaluate(() => [window.__ski.env.state.weatherMode, window.__ski.env.state.timeMode]);
    h.expect(after[0] !== before[0] && after[1] !== before[1], `G / T change weather and time (${before} -> ${after})`);
    await page.click('.hbtn[data-b="weather"]');
    const third = await page.evaluate(() => window.__ski.env.state.weatherMode);
    h.expect(third !== after[0], `the HUD weather button changes it again (${after[0]} -> ${third})`);
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 180000 });
    await h.shot("finish");
    const last = await page.evaluate(() => Number(document.documentElement.dataset.skiLast));
    await h.pause(600);                                       // the kit sends a running score after 250 ms
    const scores = await page.evaluate(() => window.__scores);
    h.expect(last > 20000 && last < 600000, `a time was recorded (${last} ms)`);
    h.eq(scores.length ? [scores[scores.length - 1].board, scores[scores.length - 1].score] : null, [`ski-killy-${PISTE}`, last], "the time went to the piste board (lower is better)");
    const prog = await page.evaluate(() => window.__ski.progress());
    h.expect(prog.best[`killy/${PISTE}`] === last && typeof prog.ghosts[`killy/${PISTE}`] === "string", "personal best and ghost stored");
    const card = await page.textContent("#finishCard");
    h.expect(/Nach eng Kéier/.test(card) && /Pistekaart/.test(card) && /Bescht Zäit/.test(card), "finish card: time, best, Nach eng Kéier, Pistekaart");

    h.step("again: the ghost of the best run skis along");
    await page.click('#finishCard [data-a="again"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski", null, { timeout: 10000 });
    await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 10000 });
    await h.pause(1200);
    h.expect(await page.evaluate(() => !!window.__ski.game.ghost), "the ghost is loaded for the run");
    await h.shot("ghost");

    h.step("keyboard: the player steers (the script hands over)");
    await page.evaluate(() => { window.__ski.game.bot = null; });
    const h0 = await page.evaluate(() => window.__ski.state.heading);
    await page.keyboard.down("ArrowRight");
    await h.pause(700);
    await page.keyboard.up("ArrowRight");
    const h1 = await page.evaluate(() => window.__ski.state.heading);
    h.expect(Math.abs(h1 - h0) > 0.05, `right arrow turns the skier (heading ${h0.toFixed(2)} -> ${h1.toFixed(2)})`);
    await page.keyboard.down("Space");
    await h.pause(500);
    h.expect(await page.evaluate(() => window.__ski.state.tuck > 0.5), "space tucks");
    await page.keyboard.up("Space");

    h.step("menu (Esc): back to the piste map");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#menuCard");
    await page.click('#menuCard [data-a="map"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });

    h.step("frame times on Niddreg while skiing (no CPU throttle)");
    await page.evaluate(() => window.__ski.start("diebold"));
    await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 20000 });
    await page.evaluate(() => { window.__ski.game.bot = null; window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 0, jump: false }); });
    await h.pause(8000);
    const fr = await page.evaluate(() => ({ ...window.__ski.frames(), ...window.__ski.info() }));
    console.log(`    frames p50 ${fr.p50?.toFixed(1)} ms, p95 ${fr.p95?.toFixed(1)} ms, max ${fr.max?.toFixed(1)} ms; ${fr.calls} draw calls, ${fr.triangles} triangles, level ${fr.level}`);
    h.expect(fr.level === "low" && fr.p95 <= 25 && fr.calls <= 160 && fr.triangles <= 450000, `Niddreg: p95 ${fr.p95?.toFixed(1)} ms <= 25, ${fr.calls} draw calls <= 160, ${fr.triangles} triangles <= 450k`);
    await h.shot("low");

    for (const [rid, name] of [["zermatt", "Zermatt · Cervinia"], ["3vallees", "Les 3 Vallées"]]) {
      h.step(`another resort: back to the picker, pick ${name}: the page reloads into its free ride, M = its piste map`);
      if (await page.evaluate(() => document.documentElement.dataset.skiScreen !== "map")) {
        await page.keyboard.press("Escape");
        await page.waitForSelector("#menuCard");
        await page.click('#menuCard [data-a="map"]');
        await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
      }
      await page.click('[data-act="back"]');
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker", null, { timeout: 10000 });
      await Promise.all([page.waitForURL(new RegExp(`resort=${rid}`), { timeout: 30000 }), page.click(`.resort.ready[data-id="${rid}"]`)]);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski && window.__ski.game.mode === "freeride") || document.documentElement.dataset.bootError, null, { timeout: 90000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${name} boots without an error, into the free ride`);
      await page.keyboard.press("m");
      await page.waitForSelector("#mapCanvas");
      await page.click('.modetabs [data-mode="piste"]');
      const n = await page.$$eval(".prow", (r) => r.length);
      const board = await page.evaluate(() => window.__board && window.__board.id);
      h.expect(n > 60 && new RegExp(`^ski-${rid}-`).test(board || ""), `${n} pistes listed, board ${board}`);
      await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
      await h.shot(`map-${rid}`);
    }
    h.eq(errors, [], "zero console errors");
    // R8f (WebKit): a resort switch (location.replace) cuts the old page's height-tile loads; WebKit reports each as an uncaught
    // "... due to access control checks" page error (like ski-mp's reload at the start): only those, for the game's own data, are dropped
    if (process.env.FLOW_BROWSER === "webkit") {
      const cut = h.failures.filter((f) => /^uncaught page error: .*\/pb\/ski\/data\/[a-z0-9]+\/t\/\d+_\d+\.bin due to access control checks\.$/.test(f));
      if (cut.length) console.log(`    (WebKit: ${cut.length} tile loads cut by the resort switches, not counted)`);
      h.failures.splice(0, h.failures.length, ...h.failures.filter((f) => !cut.includes(f)));
    }
  },
};

runIfMain(import.meta.url, flow);
