/* Flow: Ski Alpen daily challenge "Dagesfuerderung" (28 Nov 2026). One challenge per day, the same for everybody (seed = the date in
 * Europe/Luxembourg). The page's clock is pinned per scenario (Date replaced in an init script) so each of the three kinds is played for
 * real: "stars" (N new stars in an area: the scripted skier skis short blues), "time" (a given piste under its star-2 time) and "combo"
 * (ride a given lift, then finish a given piste). Before: the resort picker shows the challenge, the area, and the streak ("Serie: 2 Deeg");
 * the run completes it (pop "Dagesfuerderung gemaach!", streak 3, dataset skiDailyDone); the picker then shows "Gemaach!" and the streak.
 * The next day the streak is still alive but the challenge is a new one; two days later the shown streak is 0. Zero page errors.
 * No daily leaderboard: the time challenge is a normal piste run and posts to that piste's own board as always. */
import { runIfMain, REPO } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const imp = (p) => import(pathToFileURL(path.join(REPO, "pb/ski", p)).href);

export const flow = {
  name: "ski-daily",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    const D = await imp("modes/daily.js");
    const { hash5 } = await imp("modes/challenges.js");
    const { liftKey } = await imp("modes/goals-keys.js");
    const { areaTitle } = await imp("picker.js").catch(() => ({ areaTitle: (r) => r }));
    const pisteLen = (rid) => new Map(JSON.parse(fs.readFileSync(path.join(REPO, `pb/ski/data/${rid}/resort.json`), "utf8")).pistes.map((p) => [hash5(p.id), p.len]));
    // the three days: the first day from 1 Dec 2026 whose challenge is of the kind (a short piste, so the scripted run is quick)
    const pick = (type, n = 1) => {
      const out = [];
      for (let i = 0; i < 200 && out.length < n; i++) {
        const day = D.dayAfter("2026-12-01", i), ch = D.dailyFor(day);
        if (ch.type !== type) continue;
        if (type !== "stars" && !(pisteLen(ch.rid).get(ch.pisteKey) <= 1700)) continue;
        out.push(ch);
      }
      return out;
    };
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      try {
        localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
        const iso = localStorage.getItem("flow_now");
        if (iso) {                                    // the day of the scenario: only `new Date()` and Date.now() move on from there
          const RD = Date, base = RD.parse(iso), t0 = RD.now(), now = () => base + (RD.now() - t0);
          window.Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } };
        }
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });      // (WebKit reports a tile fetch cut off by a page load as a page error)
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const html = (k) => page.evaluate((key) => document.documentElement.dataset[key] || "", k);
    const toMap = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 90000 });
    const atPicker = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    const setClock = async (day, daily) => {                 // pin the page's day and seed the streak (the save is plain localStorage)
      await page.evaluate(([d, dl]) => {
        localStorage.setItem("flow_now", `${d}T11:00:00Z`);
        localStorage.setItem("pb_ski_save", JSON.stringify({ v: 1, best: {}, ghosts: {}, runs: {}, stars: {}, park: {}, bestHash: {}, last: null, ghostOrder: [], stats: { off: 0, top: 0 }, ski: "allmountain", disc: {}, lawin: {}, goals: {}, lifts: {}, daily: dl }));
      }, [day, daily]);
    };
    const dailyCard = () => page.evaluate(() => { const c = document.querySelector("#rpDaily .dailycard"); return c ? { text: c.textContent.replace(/\s+/g, " ").trim(), done: c.classList.contains("done"), rid: c.dataset.daily } : null; });
    const finishRunOf = async (pisteHash) => {
      await page.click('.modetabs [data-mode="piste"]');
      await page.evaluate(async (hsh) => {
        const { hash5: h5 } = await import("/pb/ski/modes/challenges.js");
        window.__ski.select(window.__ski.pistes.list.find((q) => h5(q.id) === hsh).id);
      }, pisteHash);
      await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 90000 });
      await page.click("#startBtn");
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 240000 });
    };

    // the scripted skier makes a piste's star-2 time on most pistes, not all: up to four "time" days are tried; a miss is checked as a miss
    const only = (process.env.SKI_DAILY || "").split(",").filter(Boolean);                      // SKI_DAILY=stars,combo narrows a rerun
    const scenarios = [...pick("time", 4), ...pick("stars"), ...pick("combo")].filter((ch) => !only.length || only.includes(ch.type)).map((ch) => ({ type: ch.type, ch }));
    h.expect(scenarios.length >= (only.length ? 1 : 3),`days: ${scenarios.map((s) => `${s.ch.day} ${s.type} (${s.ch.rid})`).join(", ")}`);
    let timeDone = false;

    for (const { type, ch } of scenarios) {
      if (type === "time" && timeDone) continue;
      const yesterday = D.dayNumber(ch.day) - 1;
      const text = D.dailyText(ch, areaTitle(ch.rid));
      h.step(`${ch.day}: ${type} challenge in ${ch.rid}: ${text}`);
      await h.goto(`/pb/ski.html?resort=${ch.rid === "killy" ? "laax" : "killy"}&debug=1&q=low`);
      await setClock(ch.day, { d: "", n: 0, s: 0, last: yesterday, streak: 2, best: 2 });
      await h.goto(`/pb/ski.html?resort=${ch.rid === "killy" ? "laax" : "killy"}&debug=1&q=low`);
      await atPicker();
      await page.waitForSelector("#rpDaily .dailycard");
      const c0 = await dailyCard();
      h.expect(c0 && c0.text.includes(text) && c0.rid === ch.rid && !c0.done, `the picker names it: "${c0 && c0.text}"`);
      h.expect(/Serie: 2 Deeg/.test(c0.text), "the streak before: Serie: 2 Deeg");
      await h.shot(`${type}-picker-before`);

      await h.goto(`/pb/ski.html?resort=${ch.rid}&map=1&debug=1&bot=1&timescale=8&q=low`);
      await toMap();
      await page.click('.modetabs [data-mode="goals"]');
      await page.waitForSelector(".dailycard");
      h.expect(/Dagesfuerderung/.test(await page.textContent("#modePane .dailycard")), "the Ziler tab of that area shows the challenge too");
      if (type === "time") {
        await finishRunOf(ch.pisteKey);
        const ms = Number(await html("skiLast"));
        console.log(`      run ${ms} ms, target ${ch.targetMs} ms`);
        if (ms > ch.targetMs) {
          await h.pause(500);
          const missed = await page.evaluate(() => ({ done: document.documentElement.dataset.skiDailyDone || "", daily: window.__ski.progress().daily, pop: [...document.querySelectorAll("#badgePop .bp")].map((b) => b.textContent) }));
          h.expect(!missed.done && missed.daily.last === yesterday && missed.daily.streak === 2 && !missed.pop.some((t) => /Dagesfuerderung/.test(t)), `too slow (${ms} > ${ch.targetMs} ms): not done, the streak stays ${missed.daily.streak}, no pop`);
          continue;
        }
        timeDone = true;
        h.expect(true, `the scripted run is under the time: ${ms} <= ${ch.targetMs}`);
      } else if (type === "stars") {
        const blues = await page.evaluate(() => window.__ski.pistes.list.filter((p) => p.diff === "blue" && !p.src.slalom && p.length > 380).sort((a, b) => a.length - b.length).slice(0, 8).map((p) => p.id));
        let runs = 0;
        for (const id of blues) {
          if (await html("skiDailyDone")) break;
          await page.click('.modetabs [data-mode="piste"]');
          await page.evaluate((pid) => window.__ski.select(pid), id);
          await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 90000 });
          await page.click("#startBtn");
          await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 240000 });
          runs++;
          const have = await page.evaluate(() => window.__ski.progress().daily.n);
          console.log(`      run ${runs}: ${have} stars counted for today`);
          if (!(await html("skiDailyDone"))) { await page.click('#finishCard [data-a="map"]'); await toMap(); }
        }
      } else {
        const lift = await page.evaluate(async (key) => {
          const { liftKey: lk } = await import("/pb/ski/modes/goals-keys.js");
          const res = await (await fetch(`/pb/ski/data/${new URL(location.href).searchParams.get("resort")}/resort.json`)).json();
          const idx = res.lifts.findIndex((l) => lk(l) === key);
          const l = window.__ski.modes.lifts.byIndex.get(idx);
          return l ? { id: l.id, name: l.name } : null;
        }, ch.liftKey);
        h.expect(!!lift, `the combo lift exists in the game: ${lift && lift.name}`);
        await page.evaluate((id) => window.__ski.goFree(id), lift.id);
        await page.waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.game.mode === "freeride" && !document.getElementById("liftBtn").hidden, null, { timeout: 60000 });
        h.eq(await page.evaluate(() => window.__ski.progress().daily.s), 0, "the lift is not ridden yet");
        await page.keyboard.press("l");
        await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 10000 });
        h.eq(await page.evaluate(() => window.__ski.progress().daily.s), 1, "the lift ride is step 1 of the combo");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 30000 });
        await page.evaluate(() => window.__ski.showMap());
        await toMap();
        await finishRunOf(ch.pisteKey);
      }
      await page.waitForFunction((day) => document.documentElement.dataset.skiDailyDone === day, ch.day, { timeout: 6000 });
      h.expect(true, "the challenge is done: dataset skiDailyDone, the pop says it");
      const popText = await page.evaluate(() => [...document.querySelectorAll("#badgePop .bp")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
      h.expect(popText.some((t) => /Dagesfuerderung gemaach/.test(t) && /Serie: 3 Deeg/.test(t)), `pop: ${popText.join(" | ")}`);
      await h.shot(`${type}-done`);
      const saved = await page.evaluate(() => window.__ski.progress().daily);
      h.expect(saved.last === D.dayNumber(ch.day) && saved.streak === 3 && saved.best === 3, `saved: ${JSON.stringify(saved)}`);
      const cloud = await page.evaluate(async () => { const { encodeCloud } = await import("/pb/ski/modes/cloud.js"); return encodeCloud(window.__ski.progress()).y; });
      h.eq(cloud, [D.dayNumber(ch.day), 3, 3], "the cloud record carries y = [day, streak, best]");

      await page.evaluate(() => { localStorage.setItem("pb_ski_save", JSON.stringify(window.__ski.progress())); });
      await h.goto(`/pb/ski.html?resort=${ch.rid === "killy" ? "laax" : "killy"}&debug=1&q=low`);
      await atPicker();
      await page.waitForSelector("#rpDaily .dailycard");
      const c1 = await dailyCard();
      h.expect(c1.done && /Gemaach/.test(c1.text) && /Serie: 3 Deeg/.test(c1.text), `the picker after: "${c1.text}"`);
      await h.shot(`${type}-picker-after`);
      if (type === "time") {
        h.step("the next day: the streak lives, a new challenge; two days later: streak 0");
        await page.evaluate((d) => localStorage.setItem("flow_now", `${d}T11:00:00Z`), D.dayAfter(ch.day, 1));
        await h.goto(`/pb/ski.html?resort=${ch.rid === "killy" ? "laax" : "killy"}&debug=1&q=low`);
        await atPicker(); await page.waitForSelector("#rpDaily .dailycard");
        const c2 = await dailyCard();
        h.expect(!c2.done && /Serie: 3 Deeg/.test(c2.text) && !c2.text.includes(text), `next day: "${c2.text}"`);
        await page.evaluate((d) => localStorage.setItem("flow_now", `${d}T11:00:00Z`), D.dayAfter(ch.day, 2));
        await h.goto(`/pb/ski.html?resort=${ch.rid === "killy" ? "laax" : "killy"}&debug=1&q=low`);
        await atPicker(); await page.waitForSelector("#rpDaily .dailycard");
        const c3 = await dailyCard();
        h.expect(/Serie: 0 Deeg/.test(c3.text), `two days later: "${c3.text}"`);
      }
    }
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
