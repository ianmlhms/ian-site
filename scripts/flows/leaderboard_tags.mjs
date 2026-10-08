/* Flow 6 — Leaderboard tags: signed in, every board shows 👑 Admin + class tags
 * next to names; no pinned admin row (removed 8 Oct 2026). */
import { runIfMain } from "./lib.mjs";

const OWNER = { user_id: "o1", username: "Ian", class: "4C6", is_admin: true, is_owner: true };
const TAGS = [
  OWNER,
  { user_id: "p1", username: "Emma", class: "4C6", is_admin: false, is_owner: false },
  { user_id: "p2", username: "Max", class: "5C2", is_admin: false, is_owner: false },
  { user_id: "p3", username: "Lena", class: null, is_admin: false, is_owner: false },
];
const ARCADE = [
  { user_id: "p1", username: "Emma", score: 9200 },
  { user_id: "p2", username: "Max", score: 8100 },
  { user_id: "o1", username: "Ian", score: 7000 },
  { user_id: "p3", username: "Lena", score: 500 },
];
const WINS = [
  { username: "Emma", wins: 12, losses: 3, draws: 0, total: 15, winpct: 80 },
  { username: "Max", wins: 9, losses: 6, draws: 0, total: 15, winpct: 60 },
  { username: "Ian", wins: 7, losses: 2, draws: 0, total: 9, winpct: 78 },
  { username: "Lena", wins: 1, losses: 4, draws: 0, total: 5, winpct: 20 },
];
const WORDLE = [
  { username: "Max", played: 20, wins: 18, avg_guesses: 3.9, today: 4 },
  { username: "Ian", played: 15, wins: 14, avg_guesses: 3.5, today: null },
  { username: "Emma", played: 10, wins: 8, avg_guesses: 4.2, today: 0 },
];

function scoresTable({ url }) {
  const userId = url.searchParams.get("user_id");
  if (userId) return ARCADE.filter((r) => `eq.${r.user_id}` === userId);
  return ARCADE;
}

async function setTheme(h, mode) {
  await h.page.evaluate((m) => localStorage.setItem("site_theme", JSON.stringify({ mode: m })), mode);
}

async function checkTable(h, rowsSel, label) {
  const info = await h.page.$$eval(rowsSel, (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  const pinnedRows = await h.page.$$eval(".pinned, .pinned-row, .pb-pinned", (rows) => rows.length);
  h.expect(info.length >= 3, `${label}: board has its normal rows (got ${info.length})`);
  h.expect(pinnedRows === 0, `${label}: no pinned row`);
  h.expect(info.filter((t) => /Ian/.test(t)).length === 1, `${label}: Ian appears once, at his real place`);
  h.expect(info.some((t) => /Ian/.test(t) && /Admin/.test(t) && /4C6/.test(t)), `${label}: Ian has the 👑 Admin + class tags`);
  h.expect(info.some((t) => /Emma/.test(t) && /4C6/.test(t)), `${label}: class tag next to Emma`);
  h.expect(!info.some((t) => /Emma/.test(t) && /Admin/.test(t)), `${label}: no admin tag on Emma`);
  const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  h.expect(!overflow, `${label}: no horizontal scroll`);
}

export const flow = {
  name: "leaderboard-tags",
  backend: {
    rpc: {
      leaderboard_tags: () => TAGS,
      game_leaderboard: () => WINS,
      game_leaderboard_window: () => WINS,
      wordle_leaderboard: () => WORDLE,
      admin_user_ids: () => [{ user_id: "o1" }],
    },
    tables: { scores: scoresTable },
  },
  async run(h) {
    const { page } = h;
    await h.signIn();

    for (const mode of ["dark", "light"]) {
      h.step(`leaderboard.html (${mode})`);
      await h.goto("/leaderboard.html");
      await setTheme(h, mode);
      await h.goto("/leaderboard.html");
      await page.waitForSelector("table.lb.tagged .admin-tag", { timeout: 8000 });
      await checkTable(h, "table.lb tbody tr", `wins table ${mode}`);
      await h.shot(`wins-${mode}`);

      h.step(`wordle board (${mode})`);
      await h.goto("/wordle.html");
      await page.waitForFunction(() => typeof window.openWordleBoard === "function", null, { timeout: 8000 });
      await page.evaluate(() => window.openWordleBoard("lb"));   // the 🏆 button lives in the Arcade bar
      await page.waitForSelector("#lbBody .admin-tag", { timeout: 8000 });
      await checkTable(h, "#lbBody tr:not(:first-child)", `wordle ${mode}`);
      await h.shot(`wordle-${mode}`);

      h.step(`arcade board (${mode})`);
      await h.goto("/pixelbreak.html?g=cookie-clicker");
      await page.waitForFunction(() => typeof window.PB?.openBoard === "function", null, { timeout: 8000 });
      await h.pause(1500);
      await page.evaluate(() => window.PB.openBoard());
      await page.waitForSelector("#pbBoardList .admin-tag", { timeout: 8000 });
      await checkTable(h, "#pbBoardList .pb-row", `arcade ${mode}`);
      await h.shot(`arcade-${mode}`);
    }
  },
};

runIfMain(import.meta.url, flow);
