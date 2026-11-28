/* Flow: Ski Alpen «Dagesfuerderung» board (28 Nov 2026). A board per day (modes/daily-board.js; server: scripts/ski-daily-v1.sql, the RPCs
 * ski_daily_submit / ski_daily_board over the arcade's RPC bridge, mocked here like the server: one row per player and day, a better time
 * replaces the row, stars / combo = the first completion, the top 10 + your own row). The page's clock is pinned per scenario.
 *   guest        the standalone page (no arcade): the picker's board and the Ziler tab show the hint «Mell dech am Arcade un», 0 requests
 *   signed in    the arcade frame: the picker card's «Klassement vun haut» (top 10, total), the Ziler tab's board, your place when you are
 *                outside the top 10 (a gap row), a finished challenge submits (time: ms + the piste's board id; stars / combo: nothing but the
 *                kind), a second slower time sends no better row, the board then shows «(du)»
 * The three kinds are completed by feeding the game's own daily events (host.dailyEv; ski-daily plays them for real). Zero page errors. */
import { runIfMain, REPO } from "./lib.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const imp = (p) => import(pathToFileURL(path.join(REPO, "pb/ski", p)).href);
const OTHERS = ["Emma", "Max", "Lena", "Tom", "Anna", "Jo", "Sara", "Luc", "Mia", "Paul", "Nora", "Sam", "Zoe", "Ben"];

// the mock server: rows[day] = [{ name, kind, value, self }]
const rows = new Map();
const state = { rows, submits: [], boards: [] };
const rpc = {
  ski_daily_submit: ({ p_day, p_kind, p_value, p_board }) => {
    state.submits.push({ p_day, p_kind, p_value, p_board });
    if (!["time", "stars", "combo"].includes(p_kind) || !/^\d{4}-\d{2}-\d{2}$/.test(p_day)) return false;
    const list = rows.get(p_day) || [];
    rows.set(p_day, list);
    const mine = list.find((r) => r.self);
    if (p_kind === "time") {
      if (!Number.isInteger(p_value) || p_value < 20000 || !/^ski-[a-z0-9]+-/.test(p_board || "")) return false;
      if (mine) { if (mine.kind === "time" && p_value < mine.value) { mine.value = p_value; return true; } return false; }
      list.push({ name: "Du", kind: "time", value: p_value, self: true });
      return true;
    }
    if (mine) return false;
    list.push({ name: "Du", kind: p_kind, value: 13 * 3600 + 20 * 60, self: true });
    return true;
  },
  ski_daily_board: ({ p_day, p_kind }) => {
    state.boards.push({ p_day, p_kind });
    const list = (rows.get(p_day) || []).filter((r) => r.kind === p_kind).sort((a, b) => a.value - b.value);
    return list.map((r, i) => ({ rank: i + 1, username: r.name, value: r.value, is_self: !!r.self, total: list.length })).filter((r) => r.rank <= 10 || r.is_self);
  },
};

export const flow = {
  name: "ski-daily-board",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  backend: { rpc },
  async run(h) {
    const { page } = h;
    state.rows.clear(); state.submits.length = 0; state.boards.length = 0;          // (a rerun at full quality starts from an empty server)
    const D = await imp("modes/daily.js");
    const { hash5 } = await imp("modes/challenges.js");
    const { liftKey } = await imp("modes/goals-keys.js");
    const pick = (type) => { for (let i = 0; i < 200; i++) { const ch = D.dailyFor(D.dayAfter("2026-12-01", i)); if (ch.type === type) return ch; } return null; };
    const chs = { time: pick("time"), stars: pick("stars"), combo: pick("combo") };
    await page.addInitScript(() => {
      try {
        localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
        const iso = localStorage.getItem("flow_now");
        if (iso) { const RD = Date, base = RD.parse(iso), t0 = RD.now(), now = () => base + (RD.now() - t0); window.Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }; }
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const gameFrame = async () => {
      await page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!(d && d.documentElement && d.documentElement.dataset.skiReady === "1"); }, null, { timeout: 120000 });
      return page.frames().find((f) => f.url() === "about:srcdoc");
    };
    const seedClock = async (day) => page.evaluate((d) => localStorage.setItem("flow_now", `${d}T11:00:00Z`), day);
    const seed = (day, kind, n) => {          // n other players, the fastest first
      state.rows.set(day, OTHERS.slice(0, n).map((name, i) => ({ name, kind, value: kind === "time" ? 25000 + i * 400 : 8 * 3600 + i * 1500 })));
    };

    h.step("a guest (standalone page): the board shows the hint, nothing is requested");
    await h.goto("/pb/ski.html?debug=1&q=low");
    await seedClock(chs.stars.day);
    await h.goto("/pb/ski.html?debug=1&q=low");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker", null, { timeout: 90000 });
    await page.waitForSelector("#rpDBoard summary");
    await page.click("#rpDBoard summary");
    await page.waitForSelector('#rpDBoard [data-dboard] p');
    h.expect(/Mell dech am Arcade un/.test(await page.textContent("#rpDBoard")), "guest: «Mell dech am Arcade un …»");
    h.eq(state.boards.length + state.submits.length, 0, "guest: no request to the server");
    await h.shot("guest-picker");

    h.step("signed in (arcade): the picker's «Klassement vun haut» = top 10 + the total");
    await h.signIn();
    await h.goto("/pixelbreak.html?g=ski&debug=1&q=low");
    await seedClock(chs.stars.day);
    seed(chs.stars.day, "stars", 12);
    await h.goto("/pixelbreak.html?g=ski&debug=1&q=low");
    let f = await gameFrame();
    await f.waitForSelector("#rpDBoard summary");
    await f.click("#rpDBoard summary");
    await f.waitForSelector("#rpDBoard .dbrows li");
    const top = await f.$$eval("#rpDBoard .dbrows li", (l) => l.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    const foot = await f.textContent("#rpDBoard .dbfoot");
    h.expect(top.length === 10 && /^1Emmaum 8:00$/.test(top[0]) && !top.some((t) => /\(du\)/.test(t)) && /12 hunn haut gemaach/.test(foot), `top 10 of 12 (${top[0]} … ${top[9]}); ${foot}`);
    h.eq(state.boards.at(-1), { p_day: chs.stars.day, p_kind: "stars" }, "the request names today's day and the kind of the challenge");
    await h.shot("picker-board");

    h.step("stars: completing the challenge submits (no value: the server clock decides), you are in the board");
    await h.goto(`/pixelbreak.html?g=ski&resort=${chs.stars.rid}&map=1&debug=1&q=low`);
    f = await gameFrame();
    await f.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 90000 });
    await f.click('.modetabs [data-mode="goals"]');
    await f.waitForSelector("#dBoard .dbrows li");
    h.expect((await f.$$("#dBoard .dbrows li.me")).length === 0, "the Ziler tab shows the board; you are not on it yet");
    await f.evaluate((n) => window.__ski.modes.dailyEv({ t: "stars", n }), chs.stars.n);
    await page.waitForTimeout(600);
    h.eq(state.submits.at(-1), { p_day: chs.stars.day, p_kind: "stars" }, "stars: submit carries only the day and the kind");
    await f.click('.modetabs [data-mode="piste"]');
    await f.click('.modetabs [data-mode="goals"]');
    await f.waitForSelector("#dBoard .dbrows li.me");
    const me = await f.textContent("#dBoard .dbrows li.me");
    h.expect(/\(du\)/.test(me) && /um 13:20/.test(me), `the board lists you: "${me.replace(/\s+/g, " ").trim()}"`);
    await h.shot("ziler-board-stars");
    const n1 = state.submits.length;
    await f.evaluate((n) => window.__ski.modes.dailyEv({ t: "stars", n }), 3);
    await page.waitForTimeout(300);
    h.eq(state.submits.length, n1, "the day is done: more stars send nothing");

    h.step("time: every valid run under the target is sent with the piste's board id; the server keeps the best; outside the top 10 you see your place");
    await seedClock(chs.time.day);
    seed(chs.time.day, "time", 14);                       // 14 others at 0:40 .. 0:52
    await h.goto(`/pixelbreak.html?g=ski&resort=${chs.time.rid}&map=1&debug=1&q=low`);
    f = await gameFrame();
    await f.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 90000 });
    const pid = await f.evaluate(async (key) => { const { hash5: h5 } = await import("/pb/ski/modes/challenges.js"); return window.__ski.pistes.list.find((q) => h5(q.id) === key).id; }, chs.time.pisteKey);
    const rid = chs.time.rid;
    const ev = async (ms, valid = true) => { await f.evaluate(([key, m, v, board]) => window.__ski.modes.dailyEv({ t: "finish", key, ms: m, valid: v, board }), [chs.time.pisteKey, ms, valid, `ski-${rid}-${pid}`]); await page.waitForTimeout(500); };
    await ev(chs.time.targetMs + 3000);
    await ev(chs.time.targetMs - 500, false);
    h.eq(state.submits.filter((s) => s.p_kind === "time").length, 0, "too slow, or an invalid run: nothing is sent");
    const slow = Math.max(chs.time.targetMs - 400, 30000), fast = Math.max(slow - 1200, 25000);
    await ev(slow);
    h.eq(state.submits.at(-1), { p_day: chs.time.day, p_kind: "time", p_value: slow, p_board: `ski-${rid}-${pid}` }, "time: the day, the ms and the piste's board id (the server checks the floor of that board)");
    await ev(fast);
    h.eq(state.submits.at(-1).p_value, fast, "a better run of the day is sent again");
    const kept = state.rows.get(chs.time.day).find((r) => r.self);
    h.eq(kept.value, fast, "the server's row holds the better time");
    await f.click('.modetabs [data-mode="goals"]');
    await f.waitForSelector("#dBoard .dbrows li.me");
    const rows = await f.$$eval("#dBoard .dbrows li", (l) => l.map((x) => ({ me: x.classList.contains("me"), gap: x.classList.contains("gap"), text: x.textContent.replace(/\s+/g, " ").trim() })));
    h.expect(rows.length === 12 && rows[10].gap && rows[11].me && /\(du\)/.test(rows[11].text), `top 10, a gap row, then you (${rows.map((r) => r.text).slice(9).join(" | ")})`);
    h.expect(/15 hunn haut gemaach/.test(await f.textContent("#dBoard .dbfoot")) && /Du bass /.test(await f.textContent("#dBoard .dbfoot")), "the footer counts everybody and names your place");
    await h.shot("ziler-board-time");

    h.step("combo: the lift, then the piste; submit at the end");
    await seedClock(chs.combo.day);
    seed(chs.combo.day, "combo", 3);
    await h.goto(`/pixelbreak.html?g=ski&resort=${chs.combo.rid}&map=1&debug=1&q=low`);
    f = await gameFrame();
    await f.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 90000 });
    const before = state.submits.length;
    await f.evaluate((key) => window.__ski.modes.dailyEv({ t: "lift", key }), chs.combo.liftKey);
    h.eq(state.submits.length, before, "the lift alone sends nothing");
    await f.evaluate((key) => window.__ski.modes.dailyEv({ t: "finish", key, ms: 70000, valid: true, board: "ski-x-y" }), chs.combo.pisteKey);
    await page.waitForTimeout(500);
    h.eq(state.submits.at(-1), { p_day: chs.combo.day, p_kind: "combo" }, "combo: sent when the piste is finished after the lift");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
