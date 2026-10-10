/* Game of the Week, per-run reporting, daily streak and exact numeric scores. */
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const BIG_SCORE = 1234567890123;
const ENDS_AT = new Date(Date.now() + 53 * 3_600_000).toISOString();
const ROWS = Array.from({ length: 7 }, (_, index) => ({
  week: "2026-10-05", game_id: "reaction", ends_at: ENDS_AT, rank: index + 1,
  user_id: index === 6 ? ME : `player-${index}`, username: index === 6 ? ME_NAME : `Player${index + 1}`,
  score: index === 0 ? BIG_SCORE : 200 + index,
}));
const TAGS = ROWS.map((row) => ({
  user_id: row.user_id, username: row.username, class: null,
  is_admin: false, is_owner: false, streak: 5, weekly_champion: row.rank === 1,
}));

async function noOverflow(h, label) {
  h.expect(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
}

async function finishReaction(h, ms) {
  const response = h.page.waitForResponse((reply) => reply.url().includes("/rpc/submit_weekly_score"));
  const frame = h.page.frames().find((candidate) => candidate.parentFrame());
  await frame.evaluate((time) => {
    beginRound();
    clearTimeout(timeout);
    state = "ready";
    startTime = performance.now() - time;
    hit();
  }, ms);
  await response;
}

export const flow = {
  name: "arcade-weekly-streak",
  touch: true,
  backend: {
    rpc: {
      weekly_game: () => "reaction", weekly_board: () => ROWS,
      leaderboard_tags: () => TAGS,
      touch_streak: () => ({ streak: 5, best: 9, is_new_day: true }),
      game_leaderboard: () => [{ username: ME_NAME, wins: BIG_SCORE, losses: 20, winpct: 99, total: BIG_SCORE + 20 }],
      wordle_leaderboard: () => [{ username: ME_NAME, wins: BIG_SCORE, played: BIG_SCORE + 20, avg_guesses: 3.5, today: 4 }],
    },
    tables: { scores: ({ url }) => url.searchParams.has("user_id") ? [{ score: 100 }] : [{ user_id: ME, username: ME_NAME, score: BIG_SCORE }] },
  },
  async run(h) {
    const { page } = h;
    h.step("signed-out weekly card");
    await page.setViewportSize({ width: 390, height: 844 });
    const boardCalls = h.backend.callsTo("weekly_board").length;
    await h.goto("/pixelbreak.html");
    await page.waitForSelector("#weeklyCard:not([hidden])");
    h.expect((await page.locator("#weeklyCard").innerText()).includes("Mell dech un fir matzemaachen"), "signed-out card invites participation");
    h.eq(h.backend.callsTo("weekly_board").length, boardCalls, "signed-out card avoids the restricted weekly board RPC");
    await noOverflow(h, "signed-out at 390px");
    await h.signIn();
    for (const mode of ["light", "dark"]) {
      h.step(`weekly home at 820px, ${mode}`);
      await page.evaluate((theme) => localStorage.setItem("site_theme", JSON.stringify({ mode: theme })), mode);
      await page.setViewportSize({ width: 820, height: 1180 });
      await h.goto("/pixelbreak.html");
      await page.waitForSelector("#weeklyCard .weekly-row");
      const text = await page.locator("#weeklyCard").innerText();
      h.expect(text.includes("Reaction Time"), "weekly card names the game");
      h.eq(await page.locator("#weeklyCard .weekly-row").count(), 6, "top five plus own rank outside top five");
      h.expect(text.includes("Deng Plaz") && text.includes(ME_NAME), "own weekly rank is visible");
      h.expect(/nach \d+ D \d+ St/.test(text), "countdown is visible");
      h.eq(await page.locator(".weekly-badge").count(), 1, "weekly game tile has its badge");
      h.expect(await page.locator("#weeklyCard .streak-tag").count() > 0, "🔥 tags render");
      h.eq(await page.locator("#weeklyCard .champion-tag").count(), 1, "🏆 champion tag renders");
      const GROUPED = String(BIG_SCORE).replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
      const score = page.locator(`#weeklyCard button[title="${GROUPED}"]`);
      h.eq(await score.innerText(), "1.23T", "trillion score compacts with full exact title");
      await score.tap();
      h.eq(await score.innerText(), GROUPED, "tap expands to the exact number, grouped");
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(h, `${mode} expanded home at 390px`);
      await score.focus(); await page.keyboard.press("Enter");
      h.eq(await score.innerText(), "1.23T", "keyboard toggles the exact score");
      h.expect(await page.locator("#weeklyCard .score-key").count() === 1, "compact score key appears below board");
      await h.shot(`weekly-${mode}-phone`);
    }
    h.step("final runs and streak delivery");
    await page.locator("#weeklyCard .weekly-play").click();
    await page.waitForSelector("#pbStreakToast");
    h.eq(await page.locator("#pbStreakToast").innerText(), "🔥 Dag 5!", "new day toast appears");
    await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.Arcade?.startRun);
    h.eq(await page.evaluate(() => window.__pbStreak), { streak: 5, best: 9 }, "streak result is exposed");
    h.eq(await page.evaluate(() => document.getElementById("gf").contentWindow.__pbStreak), { streak: 5, best: 9 }, "streak is delivered to iframe");
    const before = h.backend.callsTo("submit_weekly_score").length;
    await finishReaction(h, 250);
    await finishReaction(h, 350);
    await finishReaction(h, 350);
    h.eq(h.backend.callsTo("submit_weekly_score").slice(before).map((call) => call.body), [
      { p_game: "reaction", p_score: 250 }, { p_game: "reaction", p_score: 350 }, { p_game: "reaction", p_score: 350 },
    ], "all finished runs count, including worse and equal scores");
    const frame = page.frames().find((candidate) => candidate.parentFrame());
    await frame.evaluate(() => {
      Arcade.gameOver(350);
      parent.postMessage({ __pb: 1, final: true, score: 350, run: 3 }, "*");
    });
    await h.pause(300);
    h.eq(h.backend.callsTo("submit_weekly_score").length - before, 3, "duplicate final reports do not resend");
    await page.waitForSelector("#pbStreakToast", { state: "hidden", timeout: 5000 });
    await page.evaluate(() => { closeGame(); openGame(arcadeGameIndex("snake")); });
    await h.pause(200);
    h.eq(h.backend.callsTo("touch_streak").length, 1, "streak is touched once for this page view");
    await noOverflow(h, "open game at 390px");

    h.step("weekly tab and other score surfaces");
    await h.goto("/leaderboard.html");
    await page.waitForSelector("table.lb button.score-number");
    await noOverflow(h, "match leaderboard at 390px");
    await page.locator('[data-g="weekly"]').click();
    await page.waitForSelector("#body .weekly-row");
    h.eq(await page.locator("#body .weekly-row").count(), 7, "weekly tab renders every RPC row");
    await noOverflow(h, "weekly tab at 390px");
    await h.goto("/wordle.html");
    await page.waitForFunction(() => typeof window.openWordleBoard === "function");
    await page.evaluate(() => window.openWordleBoard("lb"));
    await page.waitForSelector("#lbBody button.score-number");
    await noOverflow(h, "wordle big scores at 390px");
    await h.goto("/profile.html");
    await page.waitForSelector("#stats button.score-number");
    await page.waitForFunction(() => document.getElementById("arcadeStreak")?.textContent.includes("5"));
    await noOverflow(h, "profile at 390px");


  },
};

runIfMain(import.meta.url, flow);
