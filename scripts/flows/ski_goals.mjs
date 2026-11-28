/* Flow: Ski Alpen goals and badges per ski area (28 Nov 2026). Espace Killy: the Ziler tab on the map lists the goals with bars (all at
 * zero for a new player); a save that is ONE step from three badges (every black piste but one, every lift but the village gondola) earns
 * them in the real game: the gondola ride (key L) = "All Lifte gefuer", the last black piste (scripted skier, counted) = "All schwaarz
 * Pisten", each with a small badge pop that never blocks (pointer-events none); discovering the area ("Ganz Gebitt entdeckt") and
 * coming to the highest lift top ("Héchste Punkt") pop at the HUD rate; the park goals go through the same check the park finish card
 * calls. The badges persist (local save + the compact cloud record g / l), a reload shows them in the Ziler tab, and the resort picker
 * shows n / m on every card and the total. Zero page errors. */
import { runIfMain, REPO } from "./lib.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const imp = (p) => import(pathToFileURL(path.join(REPO, "pb/ski", p)).href);

export const flow = {
  name: "ski-goals",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    const { GOALS_DATA } = await imp("modes/goals-data.js");
    const G = await imp("modes/goals.js");
    const { liftKey } = await imp("modes/goals-keys.js");
    const rid = "killy", data = GOALS_DATA[rid];
    // the seed: every black piste but the shortest one finished (star 1), every lift but the village gondola ridden (set in the page: needs the lift keys)
    const { hash5 } = await imp("modes/challenges.js");
    const fs = await import("node:fs");
    const lens = new Map(JSON.parse(fs.readFileSync(path.join(REPO, "pb/ski/data/killy/resort.json"), "utf8")).pistes.map((p) => [hash5(p.id), p.len]));
    const blacks = [];
    for (let i = 0; i < data.pd.length; i++) if (data.pd[i] === "k") blacks.push(G.pisteHashAt(rid, i));
    blacks.sort((a, b) => lens.get(a) - lens.get(b));          // the shortest black piste is the one left to ski
    const seedStars = {};
    for (const hsh of blacks.slice(1)) seedStars[`${rid}/${hsh}`] = 1;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      try {
        if (!sessionStorage.getItem("skiGoalsInit")) {
          sessionStorage.setItem("skiGoalsInit", "1");
          localStorage.removeItem("pb_ski_save");
          localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
        }
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });      // (WebKit reports a tile fetch cut off by a page load as a page error)
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const html = (k) => page.evaluate((key) => document.documentElement.dataset[key] || "", k);
    const toMap = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 60000 });
    const inGame = () => page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    const badgeText = () => page.evaluate(() => [...document.querySelectorAll("#badgePop .bp b")].map((b) => b.textContent));
    const waitBadge = (label, ms = 20000) => page.waitForFunction((t) => [...document.querySelectorAll("#badgePop .bp b")].some((b) => b.textContent === t), label, { timeout: ms });

    h.step("a new player: the Ziler tab lists the goals, all at zero");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&bot=1&timescale=8&q=low");
    await toMap();
    h.eq(await html("bootError"), "", "boots without an error");
    await page.click('.modetabs [data-mode="goals"]');
    await page.waitForSelector("#goalList .goal");
    const rows = await page.$$eval("#goalList .goal", (r) => r.map((x) => ({ id: x.dataset.goal, done: x.classList.contains("done"), text: x.textContent.replace(/\s+/g, " ").trim() })));
    const want = G.areaGoals(rid).map((g) => g.def.id);
    h.eq(rows.map((r) => r.id), want, `${want.length} goals: ${want.join(", ")}`);
    h.expect(rows.every((r) => !r.done), "none done yet");
    h.expect(/All Lifte gefuer/.test(rows[0].text) && /0 \/ 66/.test(rows[0].text), `first goal: ${rows[0].text}`);
    h.eq((await page.textContent("#gCount")).trim(), `0 / ${want.length}`, "badge count 0 / n");
    h.expect(await page.$eval(".dailycard, .dailyhint", (e) => !!e), "the daily challenge card (or the hint to its area) is in the pane");
    await h.shot("goals-fresh");

    h.step("a save one step from three badges: the gondola ride gives \"All Lifte gefuer\"");
    await page.evaluate(async (stars) => {
      const G = await import("/pb/ski/modes/goals.js");
      const S = window.__ski;
      const spawnIndex = S.modes.lifts.list.find((l) => l.id === S.spawn.id).index;
      const res = await (await fetch("/pb/ski/data/killy/resort.json")).json();     // the lifts keep their osm ids (only the piste lines are packed)
      let p = { ...S.progress(), stars };
      res.lifts.forEach((l, i) => { if (i !== spawnIndex && S.modes.lifts.byIndex.get(i)) p = G.markLift(p, "killy", l); });
      localStorage.setItem("pb_ski_save", JSON.stringify(p));
    }, seedStars);
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&timescale=3&q=low");
    await inGame();
    h.eq(await html("bootError"), "", "boots into the free ride");
    const before = await page.evaluate(() => window.__ski.progress());
    h.expect(!(before.goals || {}).killy, "no badge before the ride");
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 15000 });
    await page.keyboard.press("l");
    await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 8000 });
    await waitBadge("All Lifte gefuer", 8000);
    h.expect(true, "badge pop: All Lifte gefuer");
    const pop = await page.evaluate(() => { const b = document.getElementById("badgePop"); return { events: getComputedStyle(b).pointerEvents, shown: b.querySelectorAll(".bp").length, parent: b.parentElement.id }; });
    h.expect(pop.events === "none" && pop.parent === "ui", `the pop is small and does not take clicks (pointer-events ${pop.events})`);
    await h.shot("badge-lifts");
    const afterRide = await page.evaluate(() => window.__ski.progress());
    h.expect((afterRide.goals.killy & 1) === 1, `saved: goals.killy = ${afterRide.goals.killy} (bit 1 = lifts)`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 60000 });

    h.step("the last black piste (scripted skier) gives \"All schwaarz Pisten\"");
    await page.evaluate(() => window.__ski.showMap());
    await toMap();
    await page.click('.modetabs [data-mode="piste"]');
    const last = await page.evaluate(async (hsh) => {
      const { hash5 } = await import("/pb/ski/modes/challenges.js");
      const p = window.__ski.pistes.list.find((q) => hash5(q.id) === hsh);
      window.__ski.select(p.id);
      return { id: p.id, name: p.name, length: Math.round(p.length), slalom: !!p.src.slalom };
    }, blacks[0]);
    console.log(`      last black piste: ${last.name} (${last.length} m)`);
    await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 90000 });
    await page.click("#startBtn");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 240000 });
    await waitBadge("All schwaarz Pisten", 6000);
    h.expect(true, "badge pop: All schwaarz Pisten on the finish card");
    await h.shot("badge-black-finish");
    const afterBlack = await page.evaluate(() => window.__ski.progress());
    h.expect((afterBlack.goals.killy & 2) === 2, `saved: goals.killy = ${afterBlack.goals.killy} (bit 2 = black)`);

    h.step("discover the area, then reach the highest lift top");
    await page.click('#finishCard [data-a="map"]');
    await toMap();
    await page.evaluate(() => window.__ski.goFree(window.__ski.spawn.id));
    await page.waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.game.mode === "freeride", null, { timeout: 30000 });
    await page.evaluate(() => window.__ski.explore.discoverAll());
    await waitBadge("Ganz Gebitt entdeckt", 15000);
    h.expect(true, "badge pop: Ganz Gebitt entdeckt");
    const top = await page.evaluate(() => {
      const L = window.__ski.modes.lifts.list.slice().sort((a, b) => b.top.y - a.top.y)[0];
      const t = window.__ski.modes.lifts.startAt(L, (x, z) => window.__ski.surface.height(x, z));
      return { name: L.name, y: Math.round(L.top.y), x: t.x, z: t.z, heading: t.heading };
    });
    await page.evaluate((t) => { window.__ski.streamer.focus(t.x, t.z); }, top);
    await page.evaluate((t) => window.__ski.streamer.ready(t.x, t.z, 300), top);
    await page.evaluate((t) => window.__ski.placeHold(t.x, t.z, t.heading), top);
    await waitBadge("Héchste Punkt", 15000);
    h.expect(true, `badge pop: Héchste Punkt (${top.name}, ${top.y} m)`);
    await h.shot("badge-top");

    h.step("a park run (scripted rider) gives \"Snowpark gefuer\"");
    await page.evaluate(() => window.__ski.showMap());
    await toMap();
    await page.click('.modetabs [data-mode="park"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiParkReady === "1", null, { timeout: 60000 });
    await page.click("#parkStart");
    await page.waitForFunction(() => window.__ski.game.mode === "park" && window.__ski.game.screen === "ski", null, { timeout: 10000 });
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
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 180000 });
    await waitBadge("Snowpark gefuer", 6000);
    const pts = await page.evaluate(() => Number(document.documentElement.dataset.skiPark));
    h.expect(true, `badge pop: Snowpark gefuer (${pts} points${pts >= 5000 ? ", also the 5,000 points badge" : ""})`);
    await h.shot("badge-park");
    await page.click('#finishCard [data-a="map"]');
    await toMap();

    h.step("persistence: the cloud record carries the badges and the lifts, the picker shows them");
    const rec = await page.evaluate(async () => {
      const { encodeCloud, decodeCloud, mergeCloud } = await import("/pb/ski/modes/cloud.js");
      const { emptyProgress } = await import("/pb/ski/progress.js");
      const p = window.__ski.progress();
      const r = encodeCloud(p);
      const back = mergeCloud(emptyProgress(), decodeCloud(JSON.parse(JSON.stringify(r))));
      return { g: r.g, lLen: JSON.stringify(r.l).length, goals: p.goals, back: back.goals, size: JSON.stringify(r).length };
    });
    h.expect(rec.g && rec.g.killy === rec.goals.killy && rec.back.killy === rec.goals.killy, `cloud record g = ${JSON.stringify(rec.g)} (round trip into a new device ok), ${rec.size} bytes`);
    await page.evaluate(() => { localStorage.setItem("pb_ski_save", JSON.stringify(window.__ski.progress())); });
    await h.goto("/pb/ski.html?resort=killy&debug=1&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    await page.waitForSelector("#rpTotal");
    const medals = await page.$$eval(".resort.ready .rp-medals", (m) => m.map((x) => x.textContent.trim()));
    h.expect(medals.length === 11, `a badge count on every card: ${medals.join(" | ")}`);
    const killyMedals = await page.$eval('.resort.ready[data-id="killy"] .rp-medals', (m) => m.textContent.trim());
    h.expect(/^[4-9] \/ \d+$/.test(killyMedals), `Espace Killy: ${killyMedals}`);
    h.expect(/\d+ \/ 1\d\d/.test(await page.textContent("#rpTotal")), `total: ${(await page.textContent("#rpTotal")).replace(/\s+/g, " ")}`);
    await h.shot("picker-badges");

    h.step("a reload keeps the badges in the Ziler tab");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&q=low");
    await toMap();
    await page.click('.modetabs [data-mode="goals"]');
    await page.waitForSelector("#goalList .goal");
    const done = await page.$$eval("#goalList .goal.done", (r) => r.map((x) => x.dataset.goal));
    h.expect(["lifts", "black", "disc", "top", "park"].every((id) => done.includes(id)), `done after the reload: ${done.join(", ")}`);
    await h.shot("goals-after");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
