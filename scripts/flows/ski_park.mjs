/* Flow: Ski Alpen snow park (round 4A). Espace Killy's park (the mapped Tignes snow park by Grattalu): the Snowpark tab on the piste map
 * (its card, the park on the map), a park run with 3-2-1, the trick button (touch) and the score HUD; a scripted rider (game time x2,
 * allowed to count) takes the kickers with spins and a grab, slides a rail, lands clean: the judge names the tricks, the combo builds,
 * the finish card shows the points and the best tricks, the points go to the park board ski-killy-park (stored as 1,000,000 - points,
 * format skipark: the arcade kit is standalone here, so the post is the "arcade:score" event). A trick in the air is shot from the side.
 * Niddreg: draw calls with the park in view. Zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-park",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      window.__scores = [];
      window.addEventListener("arcade:score", (e) => window.__scores.push(e.detail));
      window.addEventListener("arcade:board", (e) => { window.__board = e.detail.board; });
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("piste map: the Snowpark tab");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&timescale=2&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    await page.click('.modetabs [data-mode="park"]');
    await page.waitForSelector("#parkStart");
    const card = await page.textContent("#modePane");
    h.expect(/Snowpark Grattalu/.test(card) && /Sprongschanzen S S M L/.test(card) && /Halfpipe/.test(card), `park card: ${card.replace(/\s+/g, " ").slice(0, 110)}`);
    await page.waitForFunction(() => document.documentElement.dataset.skiParkReady === "1", null, { timeout: 60000 });
    await h.shot("park-map");

    h.step("start the park run: 3-2-1, the trick button, the points in the HUD");
    await page.click("#parkStart");
    await page.waitForFunction(() => window.__ski.game.mode === "park" && window.__ski.game.screen === "ski", null, { timeout: 10000 });
    h.eq(await page.evaluate(() => window.__board && window.__board.id), "ski-killy-park", "the park board is selected");
    h.expect(await page.evaluate(() => !document.querySelector('#touchControls [data-k="trick"]').hidden), "the Trick button is there (touch)");
    // the scripted rider: every kicker in its lane with a trick, then the first rail of the right lane sliding across
    await page.evaluate(async () => {
      const { parkRider } = await import("/pb/ski/modes/park-check.js");
      const L = window.__ski.parkLayout;
      const plan = [];
      for (const k of L.kickers) {
        plan.push({ v: k.v, until: k.s0 + k.run + 2, speed: k.size === "L" ? 12.5 : 11 });
        plan.push({ v: k.v, until: k.end + 6, speed: 11, trick: k.size === "S" ? { spin: Math.PI } : k.size === "M" ? { spin: Math.PI * 2, grab: true } : { spin: Math.PI * 4, grab: true } });
      }
      plan.push({ v: 0, until: 1e9, speed: 10 });
      window.__ski.game.bot = parkRider(L, plan);
    });
    await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 15000 });
    h.step("a trick in the air, seen from the side");
    await page.waitForFunction(() => { const s = window.__ski.state; return s && !s.grounded && Math.abs(s.spin || 0) > 2.2 && s.y - window.__ski.surface.height(s.x, s.z) > 1.2; }, null, { timeout: 90000, polling: 16 });
    await page.evaluate(() => { window.__ski.game.paused = true; window.__ski.orbit(128, 10, 2.6, 48); });
    await h.pause(500);
    await h.shot("trick-air");
    await page.evaluate(() => { window.__ski.orbit(null); window.__ski.game.paused = false; });
    await page.waitForFunction(() => window.__ski.modes.judge && window.__ski.modes.judge.tricks.length >= 2, null, { timeout: 90000 });
    const hudText = await page.textContent("#hSplit");
    h.expect(/Punkten/.test(hudText), `HUD: ${hudText}`);
    await h.shot("park-hud");

    h.step("the bottom of the park: points, best tricks, the board");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 120000 });
    const pts = await page.evaluate(() => Number(document.documentElement.dataset.skiPark));
    const tricks = await page.evaluate(() => window.__ski.modes.judge ? window.__ski.modes.judge.tricks.map((t) => `${t.name} ${t.quality} ${t.points}`) : []);
    console.log(`      ${pts} points: ${tricks.join(" | ")}`);
    const clean = tricks.filter((t) => / clean /.test(t)).length;
    h.expect(pts > 1000 && clean >= 2 && tricks.some((t) => /360|720/.test(t)), `${pts} points, ${clean} clean tricks (spins and grabs)`);
    const finish = await page.textContent("#finishCard");
    h.expect(/Punkten/.test(finish) && /Neie Rekord/.test(finish) && /Propper/.test(finish), "the card: points, new record, the tricks with their landing");
    await h.shot("park-finish");
    await h.pause(600);
    const scores = await page.evaluate(() => window.__scores);
    const last = scores[scores.length - 1];
    h.eq(last ? [last.board, last.score] : null, ["ski-killy-park", 1000000 - pts], "the points went to ski-killy-park as 1,000,000 - points");
    h.eq(await page.evaluate(() => window.__ski.progress().park.killy), pts, "the park record is saved");

    h.step("Niddreg: draw calls with the park in view");
    await page.click('#finishCard [data-a="again"]');
    await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 15000 });
    await page.evaluate(() => { window.__ski.game.bot = null; window.__ski.setInput({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false }); window.__ski.teleport(150); });
    await h.pause(2500);
    const info = await page.evaluate(() => window.__ski.info());
    h.expect(info.level === "low" && info.calls <= 160, `Niddreg in the park: ${info.calls} draw calls <= 160, ${info.triangles} triangles`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
