/* Flow 6 — Leaderboard tags: signed in, every board shows 👑 Admin + class tags
 * and a pinned admin row (the owner's real result, no rank number), while the
 * owner's ranked row stays at its real position. */
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
  const info = await h.page.$$eval(rowsSel, (rows) => rows.map((r) =>
    (r.matches(".pinned, .pinned-row, .pb-pinned") ? "[pinned] " : "") + r.innerText.replace(/\s+/g, " ").trim()));
  h.expect(info.length >= 4, `${label}: board has rows (got ${info.length})`);
  h.expect(/^\[pinned\]/.test(info[0] || "") && /Ian/.test(info[0]) && /Admin/.test(info[0]), `${label}: first row is the pinned admin row (${info[0]})`);
  const ianRanked = info.slice(1).filter((t) => /Ian/.test(t) && !/^\[pinned\]/.test(t));
  h.expect(ianRanked.length === 1, `${label}: Ian also stays in the ranked list`);
  const visibleLabel = await h.page.$$eval(rowsSel, (rows) => [...rows[0].querySelectorAll("*")].some((el) =>
    /Ugepinnt|📌/.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")) &&
    el.getBoundingClientRect().width > 2));
  h.expect(!visibleLabel, `${label}: no visible pinned label`);
  h.expect(info.some((t) => /Emma/.test(t) && /4C6/.test(t)), `${label}: class tag next to Emma`);
  h.expect(!info.slice(1).some((t) => /Emma/.test(t) && /Admin/.test(t)), `${label}: no admin tag on Emma`);
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
      await page.waitForSelector("table.lb tr.pinned", { timeout: 8000 });
      await checkTable(h, "table.lb tbody tr", `wins table ${mode}`);
      await h.shot(`wins-${mode}`);

      h.step(`wordle board (${mode})`);
      await h.goto("/wordle.html");
      await page.waitForFunction(() => typeof window.openWordleBoard === "function", null, { timeout: 8000 });
      await page.evaluate(() => window.openWordleBoard("lb"));   // the 🏆 button lives in the Arcade bar
      await page.waitForSelector("#lbBody tr.pinned-row", { timeout: 8000 });
      await checkTable(h, "#lbBody tr:not(:first-child):not(.pin-gap)", `wordle ${mode}`);
      await h.shot(`wordle-${mode}`);

      h.step(`arcade board (${mode})`);
      await h.goto("/pixelbreak.html?g=cookie-clicker");
      await page.waitForFunction(() => typeof window.PB?.openBoard === "function", null, { timeout: 8000 });
      await h.pause(1500);
      await page.evaluate(() => window.PB.openBoard());
      await page.waitForSelector("#pbBoardList .pb-pinned", { timeout: 8000 });
      await checkTable(h, "#pbBoardList .pb-row", `arcade ${mode}`);
      await h.shot(`arcade-${mode}`);
    }
  },
};

runIfMain(import.meta.url, flow);
