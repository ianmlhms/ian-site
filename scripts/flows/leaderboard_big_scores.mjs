/* Leaderboard with scores far above 2^53 (20 Oct 2026): any finite score up to 1e300.
 * Mocked backend that behaves like the new double precision `scores` table (upsert + keep-best trigger + the
 * +-1e300 range check). Cookie Clicker reports 3e20 and then 1.5e45; both must be sent as normal JSON numbers,
 * the second must replace the first, the board must show them readable (300Qi, 1.5e45) and in the right order,
 * a lower score afterwards must not be sent, and scores beyond 1e300 are ignored by the kit. */
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const OTHERS = [
  { user_id: "p1", username: "Emma", game_id: "cookie-clicker", score: 9.9e19 },
  { user_id: "p2", username: "Max", game_id: "cookie-clicker", score: 4.2e22 },
  { user_id: "p3", username: "Lena", game_id: "cookie-clicker", score: 8733648105594070 },
];
const RANGE = 1e300;
const rows = OTHERS.map((row) => ({ ...row }));
const writes = [];

/** PostgREST-like handler for /rest/v1/scores */
function scoresTable({ url, method, body }) {
  const eq = (name) => { const value = url.searchParams.get(name); return value && value.startsWith("eq.") ? value.slice(3) : null; };
  if (method === "GET") {
    let found = rows.filter((row) => (!eq("game_id") || row.game_id === eq("game_id")) && (!eq("user_id") || row.user_id === eq("user_id")));
    if ((url.searchParams.get("order") || "").startsWith("score.desc")) found = [...found].sort((a, b) => b.score - a.score);
    const limit = Number(url.searchParams.get("limit"));
    return limit ? found.slice(0, limit) : found;
  }
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    for (const row of Array.isArray(body) ? body : [body]) {
      writes.push({ game_id: row.game_id, score: row.score, type: typeof row.score });
      if (typeof row.score !== "number" || !(row.score >= -RANGE && row.score <= RANGE)) return { error: { code: "23514", message: 'violates check constraint "scores_score_range"' } };
      const existing = rows.find((candidate) => candidate.user_id === row.user_id && candidate.game_id === row.game_id);
      if (!existing) rows.push({ user_id: row.user_id, username: row.username, game_id: row.game_id, score: row.score });
      else if (row.score > existing.score) existing.score = row.score;   // scores_keep_best
    }
    return [];
  }
  return [];
}

const cookieSave = (baked) => ({ v: 1, c: 1e9, tb: baked, tc: 100, rb: baked, st: 0, rbc: 0, gd: "2026-10-18", savedAt: Date.now(),
  u: Array(25).fill(0), cu: Array(9).fill(0) });

async function gameFrame(h, selector) {
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), selector, { timeout: 15000 });
  return h.page.frames().find((candidate) => candidate.parentFrame());
}
const mine = () => rows.find((row) => row.user_id === ME && row.game_id === "cookie-clicker")?.score;

export const flow = {
  name: "leaderboard-big-scores",
  backend: { tables: { scores: scoresTable } },
  async run(h) {
    const { page } = h;
    rows.length = 0; rows.push(...OTHERS.map((row) => ({ ...row }))); writes.length = 0;
    const problems = [];
    page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
    await h.signIn();

    h.step("readable format for huge numbers (score-format.js)");
    await h.goto("/about.html");
    const formatted = await page.evaluate(async () => {
      const mod = await import("/score-format.js");
      const values = [8733648105594070, 3e20, 1e21, 9.99e32, 1e33, 1e36, 1.23e45, 3.3e152, 1e300];
      return { compact: values.map((v) => mod.compactScore(v)), html: mod.scoreHtml(1.5e45), key: mod.scoreKeyHtml([3e20]) };
    });
    h.eq(formatted.compact, ["8.73Qa", "300Qi", "1Sx", "999No", "1Dc", "1e36", "1.23e45", "3.3e152", "1e300"], "compactScore: suffixes to Dc, scientific beyond");
    h.expect(formatted.html.includes('title="1.5e45"') && formatted.html.includes(">1.5e45<"), "scoreHtml shows 1.5e45 with the exact value as title");
    h.expect(formatted.key.includes("score-key"), "score key line appears for compact numbers");

    h.step("Cookie Clicker with 3e20 baked: score reaches the board as a normal number");
    await page.evaluate((save) => localStorage.setItem("pb_save_cookie-clicker", JSON.stringify(save)), cookieSave(3e20));
    await h.goto("/pixelbreak.html?g=cookie-clicker");
    const game = await gameFrame(h, ".upgrade");
    await page.waitForFunction(() => window.PB?.openBoard, null, { timeout: 8000 });
    await page.waitForFunction(() => Number(localStorage.getItem("pb_best_cookie-clicker")) >= 3e20, null, { timeout: 8000 });
    await h.pause(800);
    h.eq(writes.map((w) => [w.score, w.type]), [[3e20, "number"]], "3e20 sent once, as a JSON number");
    h.eq(mine(), 3e20, "the table holds 3e20 exactly");
    h.eq(await page.evaluate(() => Number(localStorage.getItem("pb_best_cookie-clicker"))), 3e20, "local best is 3e20");
    const best1 = await page.evaluate(() => document.getElementById("arcadeBest")?.textContent || "");
    h.expect(/Best:\s*300Qi/.test(best1), `Best: shows 300Qi (${best1})`);

    h.step("1.5e45: a new personal best beats 3e20 and replaces it");
    await game.evaluate(() => { totalBaked = 1.5e45; reportScore(); });
    await h.pause(600);   // the kit forwards after 250 ms; the arcade batches cloud writes for a minute
    h.eq(writes.length, 1, "no extra request before the minute is up (batching unchanged)");
    await page.evaluate(() => window.__pbFlushSave());
    await h.pause(300);
    h.eq(writes.map((w) => w.score), [3e20, 1.5e45], "1.5e45 sent as the second write");
    h.eq(mine(), 1.5e45, "the table now holds 1.5e45");
    h.eq(await page.evaluate(() => Number(localStorage.getItem("pb_best_cookie-clicker"))), 1.5e45, "local best is 1.5e45");
    const best2 = await page.evaluate(() => document.getElementById("arcadeBest")?.textContent || "");
    h.expect(/Best:\s*1\.5e45/.test(best2), `Best: shows 1.5e45 (${best2})`);

    h.step("a lower score afterwards is neither a best nor sent");
    await game.evaluate(() => { totalBaked = 2e30; reportScore(); });
    await h.pause(600);
    await page.evaluate(() => window.__pbFlushSave());
    await h.pause(300);
    h.eq(writes.length, 2, "no third write");
    h.eq(await page.evaluate(() => Number(localStorage.getItem("pb_best_cookie-clicker"))), 1.5e45, "local best unchanged");

    h.step("the board lists them readable and in order");
    await page.evaluate(() => window.PB.openBoard());
    await page.waitForSelector("#pbBoardList .pb-row", { timeout: 8000 });
    const board = await page.$$eval("#pbBoardList .pb-row", (list) => list.map((row) => ({
      rank: row.querySelector(".r")?.textContent, name: row.querySelector(".pb-name")?.textContent, shown: row.querySelector("b")?.textContent,
      exact: row.querySelector("b .score-number")?.getAttribute("title") })));
    h.eq(board.map((row) => [row.rank, row.name, row.shown]), [["1", ME_NAME, "1.5e45"], ["2", "Max", "42Sx"], ["3", "Emma", "99Qi"], ["4", "Lena", "8.73Qa"]], "ranks 1-4: 1.5e45 > 42Sx > 99Qi > 8.73Qa");
    h.eq(board.map((row) => row.exact), ["1.5e45", "4.2e22", "99 000 000 000 000 000 000", "8 733 648 105 594 070"], "exact values in the tooltips");
    h.expect((await page.$("#pbBoardList .score-key")) !== null, "score key line under the board");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    h.expect(!overflow, "no horizontal scroll with the long numbers");
    await h.shot("board");
    await page.click("#pbBoardList .score-number >> nth=0");
    h.eq(await page.$eval("#pbBoardList .pb-row b", (cell) => cell.textContent), "1.5e45", "tapping the top score keeps a readable value");

    h.step("limits: 1e300 is accepted, beyond it the kit drops the score");
    await game.evaluate(() => { Arcade.score(1e301); Arcade.score(Infinity); Arcade.score(NaN); });
    await h.pause(600);
    await page.evaluate(() => window.__pbFlushSave());
    await h.pause(300);
    h.eq(writes.length, 2, "1e301, Infinity and NaN never leave the game");
    h.eq(await page.evaluate(() => Number(localStorage.getItem("pb_best_cookie-clicker"))), 1.5e45, "local best unchanged");
    await game.evaluate(() => { totalBaked = 1e300; reportScore(); });
    await h.pause(600);
    await page.evaluate(() => window.__pbFlushSave());
    await h.pause(300);
    h.eq(mine(), 1e300, "1e300 reaches the table");
    h.eq(writes.at(-1).score, 1e300, "sent as a JSON number");

    h.eq(problems.filter((text) => !/Ignored an invalid score/.test(text)), [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
