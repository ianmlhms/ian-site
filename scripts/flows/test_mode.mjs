/* Arcade test mode: the owner (konto@ian.lu) is asked "Test mode or Normal?" on every game; test mode unlocks
 * everything game-side, but nothing it does may reach a leaderboard, a counter, game_saves or the real saves.
 * Everyone else is never asked and plays exactly as before. */
import { runIfMain, fakeJwt, ME, ME_NAME } from "./lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const OWNER_EMAIL = "konto@ian.lu";
const GAME = "reaction";
const CLOUD_SAVE = { cloud: 1 };

function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: fakeJwt(), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
    user: { id: ME, aud: "authenticated", role: "authenticated", email, user_metadata: { username: ME_NAME },
      app_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

const calls = (h, name, method) => h.backend.calls.filter((c) => c.name === name && (!method || c.method === method)).length;
const scoreWrites = (h) => calls(h, "scores", "POST") + calls(h, "scores", "PATCH") + calls(h, "scores", "PUT");
const saveWrites = (h) => calls(h, "game_saves", "POST") + calls(h, "game_saves", "PATCH") + calls(h, "game_saves", "PUT");
const frameOf = (h) => h.page.frames().find((candidate) => candidate.parentFrame());

async function openGame(h, id) {
  await h.page.evaluate((gameId) => window.openGame(window.arcadeGameIndex(gameId)), id);
}
async function waitForFrame(h) {
  await h.page.waitForFunction(() => {
    const win = document.getElementById("gf")?.contentWindow;
    return !!win && !!win.Arcade && win.document.readyState === "complete";
  });
}
async function closeGame(h) {
  await h.page.evaluate(() => window.closeGame());
  await h.page.waitForFunction(() => !document.getElementById("overlay").classList.contains("open"));
}
const dialogVisible = (h) => h.page.locator(".pb-mode__box").isVisible();

export const flow = {
  name: "test-mode",
  fullChromium: true,          // the Schueberfouer step needs WebGL
  backend: {
    rpc: { weekly_game: () => GAME },
    tables: {
      game_saves: ({ method }) => (method === "GET" ? [{ data: CLOUD_SAVE }] : []),
      scores: ({ url }) => (url.searchParams.has("user_id") ? [] : []),
    },
  },
  async run(h) {
    const { page } = h;

    /* ---------------- everyone else: never asked ---------------- */
    h.step("non-owner (tester@example.test): no prompt, no flag");
    await h.signIn();
    await h.goto(`/pixelbreak.html?test=1&g=${GAME}`);
    await waitForFrame(h);
    h.expect(!(await dialogVisible(h)), "no prompt for a signed-in non-owner (also with ?test=1)");
    h.eq(await frameOf(h).evaluate(() => window.__pbTestMode), undefined, "flag is absent in normal mode");
    h.eq(await frameOf(h).evaluate(() => window.Arcade.testMode), false, "Arcade.testMode is false");
    h.expect(!(await page.evaluate(() => document.body.classList.contains("pb-test-mode"))), "no test mode class on the page");
    await closeGame(h);

    h.step("signed-out visitor: no prompt");
    await page.evaluate(() => localStorage.clear());
    await page.context().clearCookies();
    await page.context().addInitScript(() => { try { localStorage.removeItem("sb-lvksqmgfwkfbblfsozfk-auth-token"); } catch { /* storage unavailable */ } });
    await h.goto(`/pixelbreak.html?g=${GAME}`);
    await waitForFrame(h);
    h.expect(!(await dialogVisible(h)), "no prompt when signed out");
    await closeGame(h);

    /* ---------------- the owner ---------------- */
    await page.context().addInitScript(([key, session]) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("playerName", "ian");
    }, [SESSION_KEY, sessionFor(OWNER_EMAIL)]);
    await h.goto("/pixelbreak.html");
    await page.waitForFunction(() => window.PB && window.PB.isOwner() && document.getElementById("pbAcct")?.textContent.includes("tester"));

    h.step("owner opens a game: the prompt appears before the game loads");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    const text = await page.locator(".pb-mode__box").innerText();
    h.expect(text.includes("Test-Modus") && text.includes("Normal spillen"), "prompt offers Test-Modus and Normal spillen (lb)");
    h.expect(text.includes("fräigeschalt") && text.includes("Leaderboard") && text.includes("onberéiert"), "prompt explains test mode (lb)");
    h.eq(await page.evaluate(() => document.activeElement?.dataset.mode), "normal", "default focus is Normal");
    h.expect(await page.evaluate(() => !document.getElementById("gf").srcdoc), "the game has not been loaded yet");
    await h.shot("prompt");

    h.step("Normal (Enter): plays like before");
    await page.keyboard.press("Enter");
    await waitForFrame(h);
    h.expect(!(await dialogVisible(h)), "prompt is gone");
    h.eq(await frameOf(h).evaluate(() => window.__pbTestMode), undefined, "no flag in normal mode");
    h.eq(await frameOf(h).evaluate(() => window.Arcade.testMode), false, "Arcade.testMode is false");
    h.eq(await page.locator(".arcade-bar__badge").count(), 0, "no TEST badge in normal mode");
    const normalStreaks = calls(h, "touch_streak");
    h.expect(normalStreaks >= 1, "normal mode touches the streak");
    const scoresBefore = scoreWrites(h), weeklyBefore = calls(h, "submit_weekly_score");
    await frameOf(h).evaluate(() => { Arcade.startRun(); Arcade.gameOver(321); });
    await frameOf(h).evaluate(() => parent.postMessage({ __pbSave: 1, data: { real: 1 } }, "*"));
    await h.pause(700);
    await page.evaluate(() => window.__pbFlushSave());
    h.expect(scoreWrites(h) > scoresBefore, "normal mode saves the score to scores");
    h.expect(calls(h, "submit_weekly_score") > weeklyBefore, "normal mode submits the weekly run");
    h.expect(saveWrites(h) > 0, "normal mode upserts game_saves");
    h.eq(await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_reaction"))), { real: 1 }, "normal save lands in pb_save_reaction");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_best_reaction")), "321", "normal best lands in pb_best_reaction");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_testsave_reaction")), null, "no test save from a normal play");
    await frameOf(h).evaluate(() => { window.__got = []; addEventListener("message", (e) => { if (e.data && e.data.__pbLoadSave) window.__got.push(e.data.data); }); });
    await frameOf(h).evaluate(() => parent.postMessage({ __pbWantSave: 1 }, "*"));
    await h.pause(500);
    h.eq(await frameOf(h).evaluate(() => window.__got), [{ real: 1 }], "normal mode answers __pbWantSave with the cloud copy");
    await closeGame(h);

    h.step("owner is asked again on the next open; the last choice only sets the focus");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    h.eq(await page.evaluate(() => document.activeElement?.dataset.mode), "normal", "focus still on Normal after a normal play");
    await page.keyboard.press("Escape");
    h.expect(!(await dialogVisible(h)), "Escape closes the prompt");
    h.expect(!(await page.evaluate(() => document.getElementById("overlay").classList.contains("open"))), "Escape also closes the game overlay");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    await page.locator(".pb-mode__back").click();
    h.expect(!(await page.evaluate(() => document.getElementById("overlay").classList.contains("open"))), "Back closes the game overlay");

    /* ---------------- test mode ---------------- */
    h.step("owner picks Test (T): flag, badge, isolation");
    const saveWritesBefore = saveWrites(h), saveCallsBefore = calls(h, "game_saves");
    const scoreWritesBefore = scoreWrites(h), scoreCallsBefore = calls(h, "scores");
    const weeklyCallsBefore = calls(h, "submit_weekly_score"), streakBefore = calls(h, "touch_streak");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    await page.keyboard.press("t");
    await waitForFrame(h);
    h.expect(!(await dialogVisible(h)), "prompt is gone");
    h.eq(await frameOf(h).evaluate(() => window.__pbTestMode), true, "window.__pbTestMode === true in the frame");
    h.eq(await frameOf(h).evaluate(() => window.Arcade.testMode), true, "Arcade.testMode is true");
    h.expect(await frameOf(h).evaluate(() => /__pbTestMode=true/.test(document.scripts[0].textContent)), "the flag is the very first script, before any game script");
    h.expect(await page.evaluate(() => document.body.classList.contains("pb-test-mode")), "page is marked as test mode");
    await page.waitForSelector("#gh .arcade-bar__badge");
    h.expect((await page.locator("#gh .arcade-bar__badge").innerText()).includes("TEST"), "game bar shows the 🧪 TEST badge");
    h.eq((await page.locator("#arcadeBest").innerText()).trim(), "", "no best score is shown");
    await h.shot("badge");

    h.step("test mode: scores go nowhere");
    await frameOf(h).evaluate(() => {
      Arcade.startRun(); Arcade.score(111); Arcade.gameOver(222);                 // through the kit
      parent.postMessage({ __pb: 1, score: 333 }, "*");                            // straight at the arcade
      parent.postMessage({ __pb: 1, score: 444, final: true, run: 77 }, "*");
    });
    await h.pause(1200);
    await page.evaluate(() => window.__pbFlushSave());
    h.eq(scoreWrites(h), scoreWritesBefore, "no write to scores");
    h.eq(calls(h, "scores"), scoreCallsBefore, "no request to scores at all");
    h.eq(calls(h, "submit_weekly_score"), weeklyCallsBefore, "no weekly run submitted");
    h.eq(calls(h, "touch_streak"), streakBefore, "streak untouched");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_best_reaction")), "321", "real local best untouched");
    h.eq((await page.locator("#arcadeBest").innerText()).trim(), "", "still no best score in the bar");

    h.step("test mode: saves are isolated");
    await frameOf(h).evaluate(() => { window.__got = []; addEventListener("message", (e) => { if (e.data && e.data.__pbLoadSave) window.__got.push(e.data.data); }); });
    await frameOf(h).evaluate(() => parent.postMessage({ __pbWantSave: 1 }, "*"));
    await frameOf(h).evaluate(() => parent.postMessage({ __pbSave: 1, data: { test: 9 } }, "*"));
    await h.pause(3600);                                       // longer than the 3 s cloud debounce
    await page.evaluate(() => window.__pbFlushSave());
    h.eq(await frameOf(h).evaluate(() => window.__got), [], "__pbWantSave is answered with nothing");
    h.eq(await page.evaluate(() => JSON.parse(localStorage.getItem("pb_testsave_reaction"))), { test: 9 }, "save lands in pb_testsave_reaction");
    h.eq(await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_reaction"))), { real: 1 }, "pb_save_reaction is untouched");
    h.eq(calls(h, "game_saves"), saveCallsBefore, "zero game_saves requests during test mode");
    h.eq(saveWrites(h), saveWritesBefore, "no game_saves upsert");
    await frameOf(h).evaluate(() => {
      localStorage.setItem("pb_save_reaction", JSON.stringify({ viaStorage: 1 }));
      localStorage.setItem("pb_best_reaction", "5");
      localStorage.setItem("some_game_key", "x");
    });
    h.eq(await frameOf(h).evaluate(() => localStorage.getItem("some_game_key")), "x", "inside the frame the game reads back what it wrote");
    h.eq(await page.evaluate(() => [localStorage.getItem("some_game_key"), localStorage.getItem("pb_best_reaction"), localStorage.getItem("pb_save_reaction")]),
      [null, "321", JSON.stringify({ real: 1 })], "a game writing localStorage directly never touches the real keys");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_testls_reaction_some_game_key")), "x", "other keys are redirected to pb_testls_<game>_*");

    h.step("test mode: RPC bridge refuses writes, still serves reads");
    const rpcBefore = calls(h, "submit_daily_score"), boardBefore = calls(h, "daily_board");
    const replies = await frameOf(h).evaluate(() => new Promise((resolve) => {
      const out = {};
      addEventListener("message", (e) => {
        const res = e.data && e.data.__pbRpcRes;
        if (!res) return;
        out[res.id] = res.error || "ok";
        if (Object.keys(out).length === 4) resolve(out);
      });
      parent.postMessage({ __pbRpc: { id: "a", fn: "submit_daily_score", args: { p_game: "paket-express-daily", p_score: 9 } } }, "*");
      parent.postMessage({ __pbRpc: { id: "b", fn: "publish_park", args: { p_name: "x" } } }, "*");
      parent.postMessage({ __pbRpc: { id: "c", fn: "like_park", args: {} } }, "*");
      parent.postMessage({ __pbRpc: { id: "d", fn: "daily_board", args: { p_game: "paket-express-daily" } } }, "*");
    }));
    h.eq(replies, { a: "test-mode", b: "test-mode", c: "test-mode", d: "ok" }, "submit_daily_score / publish_park / like_park refused, daily_board allowed");
    h.eq(calls(h, "submit_daily_score"), rpcBefore, "submit_daily_score never reached the backend");
    h.eq(calls(h, "publish_park"), 0, "publish_park never reached the backend");
    h.expect(calls(h, "daily_board") > boardBefore, "read-only daily_board still works");

    h.step("test mode: the next open starts from the test save");
    await closeGame(h);
    h.expect(!(await page.evaluate(() => document.body.classList.contains("pb-test-mode"))), "closing leaves test mode");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    h.eq(await page.evaluate(() => document.activeElement?.dataset.mode), "test", "last choice (test) is the default focus");
    await page.keyboard.press("Enter");
    await waitForFrame(h);
    h.eq(await frameOf(h).evaluate(() => window.__pbTestMode), true, "Enter on the focused Test button picks test");
    h.eq(await frameOf(h).evaluate(() => window.__pbSave), { viaStorage: 1 }, "window.__pbSave comes from pb_testsave_<id> (the last test save, incl. the redirected pb_save_ write)");
    await closeGame(h);

    h.step("switching back to Normal: reopen");
    await openGame(h, GAME);
    await page.waitForSelector(".pb-mode__box");
    await page.locator('.pb-mode__box [data-mode="normal"]').click();
    await waitForFrame(h);
    h.eq(await frameOf(h).evaluate(() => window.__pbTestMode), undefined, "flag is gone again");
    h.eq(await frameOf(h).evaluate(() => window.__pbSave), { real: 1 }, "window.__pbSave is the real save");
    h.eq(await page.locator(".arcade-bar__badge").count(), 0, "TEST badge is gone");
    await closeGame(h);

    h.step("test mode: Halloween progress is not counted");
    // Deep links keep ?halloween=1 (openGame from a card would rewrite the URL to ?g=<id>).
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    await page.waitForSelector(".pb-mode__box");
    await page.keyboard.press("t");
    await waitForFrame(h);
    const eventsBefore = calls(h, "add_event_progress");
    h.expect(await page.evaluate(() => window.PB.testMode), "cookie-clicker is in test mode");
    await frameOf(h).evaluate(() => parent.postMessage({ __pbEvent: { event: "halloween-2026", count: 1 } }, "*"));
    await h.pause(1500);
    h.eq(calls(h, "add_event_progress"), eventsBefore, "test mode posts no Halloween progress");
    h.eq(await page.locator("#pbEventChip").count(), 0, "no event counter chip in test mode");
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    await page.waitForSelector(".pb-mode__box");
    await page.keyboard.press("n");
    await waitForFrame(h);
    await frameOf(h).evaluate(() => parent.postMessage({ __pbEvent: { event: "halloween-2026", count: 1 } }, "*"));
    await h.pause(1500);
    h.expect(calls(h, "add_event_progress") > eventsBefore, "control: normal mode does post Halloween progress");
    h.eq(await page.locator("#pbEventChip").count(), 1, "control: normal mode shows the event counter chip");

    /* ---------------- languages ---------------- */
    h.step("prompt follows the site language");
    for (const [lang, expected] of [["en", "Play normally"], ["de", "Normal spielen"]]) {
      await page.evaluate((value) => localStorage.setItem("site_lang", value), lang);
      await h.goto("/pixelbreak.html");
      await page.waitForFunction(() => window.PB && window.PB.isOwner() && document.getElementById("pbAcct")?.textContent.includes("tester"));
      await openGame(h, GAME);
      await page.waitForSelector(".pb-mode__box");
      h.expect((await page.locator(".pb-mode__box").innerText()).includes(expected), `prompt in ${lang}`);
      await h.shot(`prompt-${lang}`);
      await page.keyboard.press("Escape");
    }
    await page.evaluate(() => localStorage.setItem("site_lang", "lb"));

    /* ---------------- games that are their own page ---------------- */
    h.step("online (o-*) games: no prompt");
    await h.goto("/pixelbreak.html");
    await page.waitForFunction(() => window.PB && window.PB.isOwner() && document.getElementById("pbAcct")?.textContent.includes("tester"));
    await page.evaluate(() => window.openOnline(GAMES.findIndex((game) => game.id === "o-connect4")));
    h.expect(!(await dialogVisible(h)), "online game opens its room dialog without the mode prompt");
    await page.evaluate(() => window.closeOnline());

    h.step("Schueberfouer Tycoon in test mode: everything unlocked, nothing written, no gallery writes, no gifts; ?fouerDate= works only here");
    {
      const savesBefore = saveWrites(h), scoresBefore = scoreWrites(h), claimsBefore = calls(h, "claim_game_gifts"), publishBefore = calls(h, "publish_park"), likeBefore = calls(h, "like_park");
      await h.goto("/pixelbreak.html?g=park&fouerDebug=1&fouerDate=2027-08-20T17%3A00%3A30%2B02%3A00");
      await page.waitForSelector(".pb-mode__box");
      await page.keyboard.press("t");
      await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document?.documentElement?.dataset.fouerReady === "1", null, { timeout: 120000 });
      await h.pause(1500);
      const fouer = await frameOf(h).evaluate(() => { const G = window.__fouerGame; const s = G.game.state; return { test: window.__pbTestMode, c: s.c, tu: s.tu, pi: s.pi, ev: G.events.state().kind, year: G.game.events.fair.year, title: (window.parent.document.querySelector(".arcade-bar__title") || document.querySelector(".arcade-bar__title"))?.textContent.trim() }; });
      h.eq([fouer.test, fouer.tu, fouer.pi, fouer.title], [true, 8, 1, "Schueberfouer Tycoon"], "test mode: flag set, tutorial done, pioneer items unlocked");
      h.expect(fouer.c >= 5e7, `test cash (${fouer.c})`);
      h.eq([fouer.year, fouer.ev], [2027, "opening"], "?fouerDate= moves the calendar in test mode: the opening ceremony runs");
      await frameOf(h).evaluate(() => { const G = window.__fouerGame; G.game.build(0, "kachel"); G.game.advance(20); G.game.flushSave(); });
      await h.pause(3800);
      await page.evaluate(() => window.__pbFlushSave());
      h.eq(saveWrites(h), savesBefore, "no game_saves write from the Schueberfouer in test mode");
      h.eq(scoreWrites(h), scoresBefore, "no score write");
      h.eq(calls(h, "claim_game_gifts"), claimsBefore, "no live gifts are claimed in test mode");
      for (let i = 0; i < 4 && (await frameOf(h).locator(".modal button").count()); i++) { await frameOf(h).locator(".modal button").first().click(); await h.pause(300); }   // the stamp card of a fair day
      await frameOf(h).locator("#menuBtn").click();
      await frameOf(h).locator('[data-gal="open"]').click();
      await frameOf(h).locator(".dialog.gallery").waitFor({ timeout: 8000 });
      h.eq(await frameOf(h).locator('[data-gal="publish"]').count(), 0, "the gallery offers no 'publish' in test mode");
      await h.pause(1200);
      h.eq(await frameOf(h).locator(".like").count(), 0, "...and no like buttons");
      h.eq([calls(h, "publish_park"), calls(h, "like_park")], [publishBefore, likeBefore], "no gallery write reached the backend");
      await h.shot("park-test-mode");
      await closeGame(h);
    }

    h.step("Geometry Dash (own page): test choice is handed over");
    await page.evaluate(() => window.openGo(GAMES.findIndex((game) => game.id === "geometrydash")));
    await page.waitForSelector(".pb-mode__box");
    await page.keyboard.press("t");
    await page.waitForURL(/geometrydash\.html/);
    await page.waitForFunction(() => window.Arcade && window.PB);
    h.eq(await page.evaluate(() => window.__pbTestMode), true, "flag set on the standalone page");
    h.eq(await page.evaluate(() => window.Arcade.testMode), true, "Arcade.testMode is true on the standalone page");
    await page.waitForFunction(() => window.PB.testMode === true);
    h.expect((await page.locator(".arcade-bar__badge").first().innerText()).includes("TEST"), "badge in the standalone bar");
    const gdScores = scoreWrites(h), gdWeekly = calls(h, "submit_weekly_score");
    await page.evaluate(() => { Arcade.startRun(); Arcade.gameOver(1500); });
    await h.pause(800);
    h.eq(scoreWrites(h), gdScores, "standalone test play writes no score");
    h.eq(calls(h, "submit_weekly_score"), gdWeekly, "standalone test play submits no weekly run");
    await h.shot("geometrydash-test");
    await h.goto("/pixelbreak.html");
    await page.waitForFunction(() => window.PB);
    h.eq(await page.evaluate(() => sessionStorage.getItem("pb_testmode_game")), null, "the hand-over token is cleared on the hub");
    await page.evaluate(() => window.openGo(GAMES.findIndex((game) => game.id === "geometrydash")));
    await page.waitForSelector(".pb-mode__box");
    await page.keyboard.press("n");
    await page.waitForURL(/geometrydash\.html/);
    await page.waitForFunction(() => window.Arcade && window.PB);
    h.eq(await page.evaluate(() => window.__pbTestMode), undefined, "normal choice: no flag on the standalone page");
    h.eq(await page.locator(".arcade-bar__badge").count(), 0, "normal choice: no badge");
  },
};

runIfMain(import.meta.url, flow);
