/* Flow — Halloween look: the seasonal layer turns on/off by date, never
 * themes a game or an iframe, the picker toggle works and is remembered,
 * decorations stay pointer-events:none, and nothing throws a console error.
 *
 * Uses the ?season-date= test override (season.js) instead of the system
 * clock, so this flow passes the same way on any day of the year. */
import { runIfMain } from "./lib.mjs";

const IN_SEASON = "2026-10-31"; // Halloween itself
const OUT_OF_SEASON = "2026-11-05"; // a few days after the window closes

async function seasonAttr(page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-season"));
}

function watchConsole(page, errors) {
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${page.url()}: ${msg.text()}`); });
}

export const flow = {
  name: "halloween",
  async run(h) {
    const { page } = h;
    const consoleErrors = [];
    watchConsole(page, consoleErrors);

    // ---- 1. in season: the attribute is set on the home page and the arcade ----
    h.step("home page, 31 Oct — season is on");
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "index.html gets data-season on 31 Oct");
    h.expect(await page.$("link[href*='halloween.css']") !== null, "halloween.css is loaded on index.html");
    h.expect(await page.$(".hw-deco") !== null, "at least one decoration is present in the DOM");
    await h.shot("index-in-season");

    h.step("arcade lobby, 31 Oct — season is on");
    await h.goto(`/pixelbreak.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "pixelbreak.html gets data-season on 31 Oct");
    h.expect(await page.$(".hw-deco--pumpkin") !== null, "the arcade header carries a pumpkin decoration");
    await h.shot("arcade-in-season");

    // ---- 2. out of season: the attribute is gone on both ----
    h.step("home page, 5 Nov — season is off");
    await h.goto(`/index.html?season-date=${OUT_OF_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), null, "index.html has no data-season on 5 Nov");

    h.step("arcade lobby, 5 Nov — season is off");
    await h.goto(`/pixelbreak.html?season-date=${OUT_OF_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), null, "pixelbreak.html has no data-season on 5 Nov");

    // ---- 3. never themed: a standalone game page, and a game inside the arcade iframe ----
    h.step("a standalone game page (wordle.html) is never themed, even in season");
    await h.goto(`/wordle.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), null, "wordle.html carries no data-season on 31 Oct");

    h.step("a pb/*.html game page is never themed, even loaded directly");
    await h.goto(`/pb/tictactoe.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), null, "pb/tictactoe.html carries no data-season");
    h.expect(await page.$("script[src*='season.js']") === null, "pb/tictactoe.html does not even load season.js");

    h.step("a game opened inside the arcade's sandboxed iframe is never themed");
    await h.goto(`/pixelbreak.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "the arcade lobby itself is still themed");
    const gameIndex = await page.evaluate(() => GAMES.findIndex((g) => g.id === "tictactoe"));
    h.expect(gameIndex >= 0, "found tic-tac-toe in the GAMES catalogue");
    await page.evaluate((idx) => window.openGame(idx), gameIndex);
    await page.waitForFunction(() => document.getElementById("gf").srcdoc.length > 0, null, { timeout: 8000 });
    const frameEl = await page.$("#gf");
    const frame = await frameEl.contentFrame();
    h.expect(!!frame, "the game's sandboxed iframe is reachable");
    if (frame) {
      await frame.waitForLoadState("domcontentloaded");
      const inFrameSeason = await frame.evaluate(() => document.documentElement.getAttribute("data-season"));
      h.eq(inFrameSeason, null, "data-season is never set inside the game's iframe document");
      const inFrameHasSeasonScript = await frame.evaluate(() => !!document.querySelector("script[src*='season.js']"));
      h.expect(!inFrameHasSeasonScript, "the game's own document never loaded season.js");
    }
    await h.shot("arcade-game-open");

    // ---- 4. the toggle works, and is remembered across a reload ----
    h.step("the picker toggle turns the look off, live, with no reload");
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "starts on (in season, no stored preference yet)");
    await page.evaluate(() => window.SEASON.setToggle(false));
    await h.pause(100);
    h.eq(await seasonAttr(page), null, "turning the toggle off removes data-season without a reload");

    h.step("the choice survives a reload (localStorage)");
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), null, "still off after reload, even though the date is in season");
    h.eq(await page.evaluate(() => localStorage.getItem("site_halloween")), "off", "the off choice is the one stored");

    await page.evaluate(() => window.SEASON.setToggle(true));
    await h.pause(100);
    h.eq(await seasonAttr(page), "halloween", "turning the toggle back on restores data-season live");
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "still on after reload");
    h.eq(await page.evaluate(() => localStorage.getItem("site_halloween")), "on", "the on choice is the one stored");

    h.step("the picker UI itself reflects the toggle and can drive it");
    await page.evaluate(() => localStorage.removeItem("site_halloween"));
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    await page.click("#themeFab");
    await page.waitForSelector("#themePop.open [data-season-toggle]");
    const onLabel = await page.$eval('[data-season-toggle="on"]', (b) => b.classList.contains("on"));
    h.expect(onLabel, "the On button shows as selected by default while in season");
    await page.click('[data-season-toggle="off"]');
    await h.pause(100);
    h.eq(await seasonAttr(page), null, "clicking Off in the picker turns the look off");
    h.eq(await page.evaluate(() => localStorage.getItem("site_halloween")), "off", "the picker's Off click is remembered");

    // ---- 5. decorations never intercept clicks ----
    h.step("every ambient decoration is pointer-events:none");
    await page.evaluate(() => localStorage.removeItem("site_halloween")); // clean slate: the previous step left an explicit "off"
    await h.goto(`/index.html?season-date=${IN_SEASON}`);
    await h.pause(300);
    h.eq(await seasonAttr(page), "halloween", "season is back on (in window, no stored preference) before checking decorations");
    const badPointerEvents = await page.$$eval(
      ".hw-deco:not(.hw-deco--interactive), .hw-hero-fx, .hw-bat, .hw-leaf",
      (nodes) => nodes.filter((n) => getComputedStyle(n).pointerEvents !== "none").map((n) => n.className)
    );
    h.eq(badPointerEvents, [], "no ambient decoration intercepts pointer events");
    const decoCount = await page.$$eval(".hw-deco", (nodes) => nodes.length);
    h.expect(decoCount >= 2, `index.html shows more than one decoration (got ${decoCount})`);

    h.step("the home-page pumpkin Easter egg is the one deliberate exception");
    const interactiveCount = await page.$$eval(".hw-deco--interactive", (nodes) => nodes.length);
    h.eq(interactiveCount, 1, "exactly one interactive decoration (the home footer pumpkin)");
    await page.click(".hw-deco--interactive");
    await page.waitForSelector(".hw-pumpkin-laugh", { timeout: 2000 });
    h.expect(await page.$(".hw-pumpkin-laugh") !== null, "clicking the pumpkin shows the laugh bubble");

    // ---- 6. no console errors anywhere in this flow ----
    h.step("no console errors across the whole flow");
    h.eq(consoleErrors, [], `no console errors (saw ${consoleErrors.length})`);
  },
};

runIfMain(import.meta.url, flow);
