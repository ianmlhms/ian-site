/* Flow: Ski Alpen challenges and stars (round 4A, round 6). A new player on Espace Killy: since round 6 EVERYTHING is open (every piste,
 * every outfit); the piste card lists the three stars (finish, the target time, the piste's special). The scripted skier (game time x8,
 * allowed to count) skis short blues until he has 10 stars: each finish card shows the stars of the run, the map shows them, and the
 * 10th star opens the Carving ski ("Op: Ski Carving"; the stars unlock ski types now). Cloud save: inside a parent frame the game posts its
 * compact record ({__pbSave}, game id ski) and merges a cloud record sent back ({__pbLoadSave}). Zero page errors. */
import { runIfMain } from "./lib.mjs";

const RED = "face";

export const flow = {
  name: "ski-challenges",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      try { if (!sessionStorage.getItem("skiChInit")) { sessionStorage.setItem("skiChInit", "1"); localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const html = (k) => page.evaluate((key) => document.documentElement.dataset[key] || "", k);
    const toMap = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 30000 });

    h.step("a new player: the piste map of Espace Killy");
    await h.goto("/pb/ski.html?resort=killy&map=1&debug=1&bot=1&timescale=8&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    h.eq(await html("bootError"), "", "boots without an error");
    h.eq(await page.$$eval(".modetabs button", (b) => b.map((x) => x.textContent)), ["Fräi fueren", "Challengen", "Snowpark", "Skier"], "mode tabs: Fräi fueren, Challengen, Snowpark, Skier");
    const lockedRows = await page.$$eval(".prow.locked", (r) => r.length);
    h.eq(lockedRows, 0, "round 6: no piste is locked");

    h.step("a red piste is open from the start: no lock line, Start goes live");
    await page.click(`.prow[data-id="${RED}"]`);
    await h.pause(300);
    h.eq(await html("skiLocked"), "0", "the red is open");
    h.eq(await page.$$eval("#pkStars .lock", (l) => l.length), 0, "no lock line");
    await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
    h.expect(!(await page.$eval("#startBtn", (b) => b.disabled)), "Start is live");

    h.step("the scripted skier earns stars on short blues");
    const blues = await page.evaluate(() => window.__ski.pistes.list.filter((p) => p.diff === "blue" && !p.src.slalom && p.length > 380).sort((a, b) => a.length - b.length).slice(0, 9).map((p) => p.id));
    let stars = 0, runs = 0, unlockedSeen = false, firstCard = "";
    for (const id of blues) {
      if (stars >= 10) break;
      await page.evaluate((pid) => window.__ski.select(pid), id);
      const goals = await page.$$eval("#pkStars .goals li", (l) => l.map((x) => x.textContent.trim()));
      if (!runs) h.expect(goals.length === 3 && /Ukommen/.test(goals[0]) && /Ënner \d/.test(goals[1]), `three goals on the card: ${goals.join(" | ")}`);
      await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
      await page.click("#startBtn");
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 120000 });
      runs++;
      const card = await page.textContent("#finishCard");
      if (!firstCard) { firstCard = card; await h.shot("finish-stars"); }
      if (/Op: Ski Carving/.test(card)) { unlockedSeen = true; await h.shot("finish-unlock"); }
      stars = await page.evaluate(() => window.__ski.modes.pisteInfo(window.__ski.game.piste).resortStars);
      console.log(`      ${id}: stars on this piste ${await html("skiStars")}, resort ${stars}`);
      await page.click('#finishCard [data-a="map"]');
      await toMap();
    }
    h.expect(/★/.test(firstCard) && /Ukommen/.test(firstCard), "the finish card shows the stars of the run");
    h.expect(stars >= 10, `${stars} stars in ${runs} runs`);
    h.expect(unlockedSeen, "a finish card announced: Op: Ski Carving");
    const listStars = await page.$$eval(".prow .pst", (b) => b.filter((x) => /★/.test(x.textContent)).length);
    h.expect(listStars >= 2, `${listStars} pistes show won stars in the list`);
    await page.evaluate((id) => window.__ski.select(id), blues[runs - 1]);
    await h.pause(300);
    await page.click('[data-z="in"]');
    await h.pause(400);
    await h.shot("star-map");
    await page.evaluate(() => window.__ski.select("face"));
    await h.pause(200);
    h.eq(await html("skiLocked"), "0", "the red is open");

    h.step("nothing is ever locked: a fresh save, a save with times only");
    const kept = await page.evaluate(() => {
      const prog = window.__ski.progress();
      const p = window.__ski.pistes.byId.get("face");
      const ch = window.__ski.modes;
      return import("/pb/ski/modes/challenges.js").then((c) => {
        const poor = { ...prog, stars: {}, best: { "killy/face": 99999 } };
        const fresh = { ...prog, stars: {}, best: {} };
        return [c.lockState(poor, "killy", p).open, c.lockState(fresh, "killy", p).open, ch.isOpen(p)];
      });
    });
    h.eq(kept, [true, true, true], "the red is open with any save");

    h.step("outfits: all open (round 6)");
    const outfitLocks = await page.$$eval("#segOutfit button.locked", (b) => b.map((x) => x.title));
    const outfitCount = await page.$$eval("#segOutfit button", (b) => b.length);
    h.expect(outfitLocks.length === 0 && outfitCount >= 10, `${outfitCount} outfits, none locked`);

    h.step("cloud: the compact record fits game_saves with every star of all five resorts");
    const sizes = await page.evaluate(async () => {
      const c = await import("/pb/ski/modes/cloud.js");
      const ch = await import("/pb/ski/modes/challenges.js");
      const stars = {};
      for (const rid of ["killy", "3vallees", "zermatt", "arlberg", "kronplatz"]) for (let i = 0; i < 160; i++) stars[ch.starKey(rid, `piste-${i}`)] = 7;
      const bestHash = Object.fromEntries(Object.keys(stars).map((k) => [k, 123456]));
      const rec = c.encodeCloud({ stars, park: { killy: 12345 }, bestHash });
      const back = c.decodeCloud(JSON.parse(JSON.stringify(rec)));
      return { bytes: JSON.stringify(rec).length, tb: rec.tb, stars: Object.keys(back.stars).length, park: back.park.killy, times: Object.keys(back.bestHash).length };
    });
    h.expect(sizes.bytes < 7000 && sizes.tb === 2400 && sizes.stars === 800 && sizes.park === 12345, `800 pistes x 3 stars: ${sizes.bytes} bytes, tb ${sizes.tb}, ${sizes.stars} stars back, park ${sizes.park}, ${sizes.times} times kept`);

    h.step("cloud: inside a parent frame the game posts {__pbSave} and merges {__pbLoadSave}");
    await h.goto("/__ski_parent_frame__");                     // a blank same-origin page (404 text) to hold the game frame
    const posted = await page.evaluate(async () => {
      document.body.innerHTML = "";
      const saves = [];
      window.addEventListener("message", (e) => { if (e.data && e.data.__pbSave === 1) saves.push(e.data.data); if (e.data && e.data.__pbWantSave === 1) e.source.postMessage({ __pbLoadSave: 1, data: { v: 1, tb: 3, s: { killy: "zzzzz7" }, p: { killy: 4321 }, b: {} } }, "*"); });
      const f = document.createElement("iframe");
      f.style.cssText = "width:900px;height:600px;border:0";
      f.src = "/pb/ski.html?resort=killy&map=1&debug=1&q=low";
      document.body.appendChild(f);
      const until = (fn, ms) => new Promise((res) => { const t0 = Date.now(); const tick = () => { const v = fn(); if (v || Date.now() - t0 > ms) res(v); else setTimeout(tick, 200); }; tick(); });
      await until(() => f.contentDocument && f.contentDocument.documentElement.dataset.skiScreen === "map", 90000);
      const merged = await until(() => { try { const p = f.contentWindow.__ski.progress(); return p.stars["killy/zzzzz"] === 7 && p.park.killy === 4321 ? p : null; } catch (error) { return null; } }, 10000);
      // a finished run pushes the record: simulate the save after a change
      f.contentWindow.__ski.modes.cloud.push(f.contentWindow.__ski.progress());
      await until(() => saves.length > 0, 6000);
      return { merged: !!merged, saves: saves.length, last: saves[saves.length - 1] || null };
    });
    h.expect(posted.merged, "the cloud record's stars and park points are merged into the local progress");
    h.expect(posted.saves > 0 && posted.last && posted.last.v === 1 && posted.last.tb >= 9 && /zzzzz7/.test(posted.last.s.killy || ""), `the game posts its record (tb ${posted.last && posted.last.tb}, killy ${(posted.last && posted.last.s.killy || "").length / 6} pistes)`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
