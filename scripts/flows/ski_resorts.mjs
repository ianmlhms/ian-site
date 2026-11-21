/* Flow: Ski Alpen resort switching and the round 2B resorts. From the picker of the default resort (Espace Killy) the player picks
 * St. Anton am Arlberg: the page reloads into that resort (one resort per page life, ?resort=<id>&map=1) straight onto its piste
 * map with its pistes, the Kandahar is preselected with its board, the credits name the BEV terrain; the landmarks are built once the
 * tiles are in. Then the same for Kronplatz (South Tyrol terrain, Concordia bell + MMM Corones). Zero page errors.
 * Then Les 3 Vallées and Zermatt-Cervinia the same way. Env SKI_RESORTS=arlberg,kronplatz (default all four). */
import { runIfMain } from "./lib.mjs";

const CASES = {
  "3vallees": { title: "Les 3 Vallées", start: "combe-de-la-saulire", credit: /IGN/, landmarks: 0, minPistes: 150 },
  zermatt: { title: "Zermatt · Cervinia", start: "riffelalp", credit: /swisstopo/, landmarks: 2, minPistes: 60 },
  arlberg: { title: "St. Anton · Arlberg", start: "kandahar", credit: /BEV/, landmarks: 5, minPistes: 60 },
  kronplatz: { title: "Kronplatz", start: "sylvester", credit: /Bozen - Südtirol/, landmarks: 2, minPistes: 30 },
};

export const flow = {
  name: "ski-resorts",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      // a fresh save once per tab (the resort switch reloads the page and must find the picked resort in it)
      // round 4A: the start pistes are reds / blacks, open at a number of stars per resort: this player has them
      const stars = {};
      for (const rid of ["killy", "3vallees", "zermatt", "arlberg", "kronplatz"]) for (let i = 0; i < 9; i++) stars[`${rid}/seed${i}`] = 7;
      try { if (!sessionStorage.getItem("skiFlowInit")) { sessionStorage.setItem("skiFlowInit", "1"); localStorage.setItem("pb_ski_save", JSON.stringify({ v: 1, best: {}, ghosts: {}, runs: {}, stars, park: {}, bestHash: {}, last: null, ghostOrder: [] })); } } catch (error) { /* ignore */ }
      window.addEventListener("arcade:board", (e) => { window.__board = e.detail.board; });
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const atPicker = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });

    h.step("open the default resort's picker");
    await h.goto("/pb/ski.html?debug=1&q=low");
    await atPicker();
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");

    const ids = (process.env.SKI_RESORTS || Object.keys(CASES).join(",")).split(",").filter((id) => CASES[id]);
    for (const id of ids) {
      const c = CASES[id];
      h.step(`pick ${c.title}: the page reloads straight onto its piste map`);
      await Promise.all([page.waitForURL(new RegExp(`resort=${id}&map=1`), { timeout: 30000 }), page.click(`.resort.ready[data-id="${id}"]`)]);
      await page.waitForFunction((want) => (document.documentElement.dataset.skiScreen === "map" || document.documentElement.dataset.bootError) && window.__ski && window.__ski.game
        && (JSON.parse(localStorage.getItem("pb_ski_save") || "{}").last || {}).resort === want, id, { timeout: 90000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${id} boots without an error`);

      h.step(`${c.title}: piste map, the start piste and its board`);
      await page.waitForSelector("#mapCanvas");
      h.eq((await page.textContent("#mapScreen h1")).trim(), c.title, "the map is that resort's");
      const listed = await page.$$eval(".prow", (r) => r.length);
      h.expect(listed >= c.minPistes, `${listed} pistes listed`);
      h.eq(await page.evaluate(() => window.__board && window.__board.id), `ski-${id}-${c.start}`, "the start piste's board is selected (ski-<resort>-<piste>)");
      await page.click('[data-act="credits"]');
      h.expect(c.credit.test(await page.textContent("#creditsCard")), "the credits name the terrain source");
      await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 90000 });
      await h.shot(`${id}-map`);

      h.step(`${c.title}: a run starts, the landmarks are built once the tiles are in`);
      await page.click("#startBtn");
      await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1", null, { timeout: 30000 });
      await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 120000 });
      await h.pause(800);
      h.eq(await page.evaluate(() => window.__ski.landmarks && window.__ski.landmarks.count), c.landmarks, "landmarks built");
      await h.shot(`${id}-run`);
      await page.keyboard.press("m");
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
      await page.click('[data-act="back"]');
      await atPicker();
    }
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
