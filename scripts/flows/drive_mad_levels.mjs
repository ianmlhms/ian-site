/* Stunt Driver levels 17-24 ("Beyond the Machine"): a player who finished all 16 levels keeps their
 * progress, level 17 is the next stage, the picker shows 24 stages, best times of the new levels are saved,
 * and the real game (physics + three.js) can be driven through a new level with the same reactive bot the
 * node harness (pb/drive-mad/harness.js) uses. */
import { runIfMain } from "./lib.mjs";

const OLD_BEST_TIMES = [295, 307, 306, 361, 230, 440, 356, 598, 259, 240, 516, 538, 386, 303, 412, 944];

/** The save the previous release wrote for a player who finished all 16 levels (schema: dmSnapshot). */
const legacySave = () => ({ v: 1, done: 16, bt: Object.fromEntries(OLD_BEST_TIMES.map((time, index) => [index, time])) });

async function gameFrame(h, selector) {
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), selector, { timeout: 60000 });
  return h.page.frames().find((candidate) => candidate.parentFrame());
}

/** Drives the level with the reactive bot (the one the node harness uses) until the game says won or dead. */
async function driveWithBot(page, levelNumber, timeoutMs) {
  await page.evaluate((index) => {
    __driveMad.startLevel(index);
    window.__bot = setInterval(() => {
      if (__driveMad.getState().state === "play") __driveMad.setKeys(__driveMad.botInput());
    }, 8);
  }, levelNumber - 1);
  await page.waitForFunction(() => ["won", "dead"].includes(__driveMad.getState().state), null, { timeout: timeoutMs });
  return page.evaluate(() => { clearInterval(window.__bot); return __driveMad.getState(); });
}

export const flow = {
  name: "drive-mad-levels", touch: false,
  async run(h) {
    const { page } = h;
    const problems = [];
    page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
    await page.addInitScript((save) => {
      if (sessionStorage.getItem("drive-mad-seeded")) return;
      sessionStorage.setItem("drive-mad-seeded", "1");
      localStorage.setItem("pb_save_drive-mad", JSON.stringify(save));
    }, legacySave());

    h.step("player with 16 finished levels opens the picker");
    await h.goto("/pixelbreak.html?g=drive-mad");
    const game = await gameFrame(h, "#levels button");
    const picker = await game.evaluate(() => ({
      total: document.querySelectorAll("#levels button").length,
      enabled: [...document.querySelectorAll("#levels button")].filter((button) => !button.disabled).length,
      done: document.querySelectorAll("#levels button.done").length,
      names: [...document.querySelectorAll("#levels button")].slice(16).map((button) => button.title),
      hud: document.getElementById("levelText").textContent,
      message: document.getElementById("message").textContent,
    }));
    h.eq(picker.total, 24, "picker shows 24 stages");
    h.eq([picker.done, picker.enabled], [16, 17], "16 stages done, stage 17 is the next one, 18-24 stay locked");
    h.eq(picker.names.length, 8, "eight new levels");
    h.expect(new Set(picker.names).size === 8 && picker.names.every((name) => name.length > 3), `new level names are distinct (${picker.names.join(", ")})`);
    h.expect(picker.message.includes("twenty-four"), "intro text says twenty-four");
    const preserved = await game.evaluate(() => ({ done: localStorage.getItem("pb_dm_done"), first: localStorage.getItem("pb_dm_bt_0"), last: localStorage.getItem("pb_dm_bt_15") }));
    h.eq(preserved, { done: "16", first: "295", last: "944" }, "old progress and best times preserved");

    h.step("play the real level 17 with the bot (page opened directly with the test handle)");
    await h.goto("/pb/drive-mad.html?dmTest=1");
    await h.page.waitForFunction(() => window.__driveMad, null, { timeout: 60000 });
    const outcome17 = await driveWithBot(h.page, 17, 60000);
    h.eq(outcome17.state, "won", `level 17 won in the browser (${(outcome17.ticks / 60).toFixed(1)} s)`);
    const after17 = await h.page.evaluate(() => __driveMad.snapshot());
    h.eq(after17.done, 17, "done goes to 17");
    h.expect(Number.isFinite(after17.bt[16]) && after17.bt[16] > 0, "best time of level 17 is saved (snapshot covers all 24 levels)");

    h.step("the last level in the real game");
    await h.page.evaluate(() => __driveMad.unlock(23));
    const outcome24 = await driveWithBot(h.page, 24, 120000);
    h.eq(outcome24.state, "won", `level 24 won in the browser (${(outcome24.ticks / 60).toFixed(1)} s)`);
    await h.pause(1500); // the win screen appears after a short delay
    const final = await h.page.evaluate(() => ({ snapshot: __driveMad.snapshot(), button: document.getElementById("play").textContent, score: window.score }));
    h.eq([final.snapshot.done, final.score], [24, 24], "all 24 done, score 24");
    h.eq(final.button, "LEVEL SELECT", "after the last level the button returns to the picker");
    await h.shot("drive-mad-24");
    h.eq(problems.filter((text) => !/Failed to load resource/.test(text)), [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
