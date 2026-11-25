/* Clock-based earnings of the idle games with a controlled clock (page.clock): live play pays rate x time, a tab that was hidden or
 * frozen for an hour pays exactly the away rule (25 % at 0 stars, capped), a reload right afterwards pays (almost) nothing more, and a
 * closed tab pays the offline credit once. 10 production per second in both games, so every number below is exact to the tick. */
import { runIfMain } from "./lib.mjs";

const CPS = 10, HOUR = 3600, AWAY = 0.25;
const GAMES = {
  "cookie-clicker": {
    read: (s) => s.tb,
    save: () => ({ v: 1, c: 0, tb: 1000, tc: 0, rb: 1000, st: 0, rbc: 0, gd: "", rs: 0, savedAt: Date.now(), u: [100], cu: [], giftIds: [] }),   // 100 Auto Clickers = 10 / s
  },
  "idle-empire": {
    read: (s) => s.lifetime,
    save: () => ({ v: 1, cash: 10, lifetime: 1000, rb: 1000, st: 0, rbc: 0, gd: "", sc: 0, rs: 0, owned: { lemonade: 10 }, managers: { lemonade: true }, investors: 0, giftIds: [], ts: Date.now(), savedAt: Date.now() }),   // 10 stands, 1 s cycle, payout 1 each = 10 / s
  },
};

export const flow = {
  name: "idle-clock-earnings",
  async run(h) {
    const { page } = h;
    for (const [id, game] of Object.entries(GAMES)) {
      h.step(id);
      await page.clock.install({ time: new Date() });
      await h.goto("/pixelbreak.html");
      await page.evaluate(([key, save]) => localStorage.setItem(key, JSON.stringify(save)), ["pb_save_" + id, game.save()]);
      const saved = async () => game.read(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), "pb_save_" + id));
      const open = async () => {
        await h.goto("/pixelbreak.html?g=" + id);
        await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document.body?.innerText.length > 50);
        await page.clock.runFor(5200);                     // boot, first tick, the 5 s save
      };
      await open();
      const t0 = await saved();
      h.expect(t0 >= 1000 && t0 < 1000 + CPS * 12, `${id}: opening right after the save pays almost nothing (${t0 - 1000})`);

      await page.clock.runFor(60000);                       // one minute of live play
      const t1 = await saved();
      const live = t1 - t0;
      h.expect(live >= CPS * 54 && live <= CPS * 61, `${id}: 60 s live play pays ${live} (expected ${CPS * 55}..${CPS * 60})`);

      await page.clock.fastForward(HOUR * 1000);            // the tab was hidden / frozen for one hour
      await page.clock.runFor(5200);
      const t2 = await saved();
      const jump = t2 - t1;
      const exact = CPS * HOUR * AWAY;
      h.expect(jump >= exact - CPS * 2 && jump <= exact + CPS * 12, `${id}: 1 h frozen pays ${jump} (away rule ${exact})`);
      h.expect(jump <= CPS * HOUR, `${id}: never more than full rate x time`);

      await page.clock.fastForward(30 * HOUR * 1000);       // a day and a half frozen: capped by the away rule
      await page.clock.runFor(5200);
      const t3 = await saved();
      const day = t3 - t2;
      h.expect(day <= CPS * 12 * HOUR * AWAY + CPS * 12, `${id}: 30 h frozen pays ${day}, at most the 12 h away cap ${CPS * 12 * HOUR * AWAY}`);

      // reload right away: the save is current, so the offline credit must be about nothing (no double pay)
      await open();
      const t4 = await saved();
      h.expect(t4 - t3 <= CPS * 25, `${id}: reload right after pays ${t4 - t3}, not the hour again`);

      // closed for one hour: the offline credit, once
      await page.goto("about:blank");
      await page.clock.fastForward(HOUR * 1000);
      await open();
      const t5 = await saved();
      const away = t5 - t4;
      h.expect(away >= exact - CPS * 2 && away <= exact + CPS * 15, `${id}: closed for 1 h pays ${away} once (offline rule ${exact})`);
      await page.clock.runFor(60000);
      const t6 = await saved();
      h.expect(t6 - t5 <= CPS * 61 + 1, `${id}: and not twice: the next minute pays only ${t6 - t5}`);
    }
  },
};
runIfMain(import.meta.url, flow);
