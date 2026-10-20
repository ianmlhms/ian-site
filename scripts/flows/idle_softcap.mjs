/* Business Empire prestige soft cap (20 Oct 2026) + save migration.
 * Saves below are built from the save schema (not real player data):
 *   small  - investors/stars well under the cap: nothing changes, no notice
 *   huge   - investors/stars/lifetime of a runaway account (x1e139): counts and lifetime survive the load untouched,
 *            only the effective bonus is capped, and a one-time notice explains it
 *   cross  - just under the cap, then a rebirth carries the player over it: the notice appears then
 * Also: continuity/monotonicity of the bonus function, offline earnings, the leaderboard score (lifetime, no 2^53
 * clamp), investor claims and the rebirth preview texts. */
import { runIfMain } from "./lib.mjs";

const CAP = 1e8;
const expectedBonus = (investors, stars) => {
  const raw = (1 + 0.1 * investors) * (1 + 0.1 * stars);
  return raw <= CAP ? raw : CAP * (1 + Math.log1p(0.1 * investors) + Math.log1p(0.1 * stars) - Math.log(CAP));
};
const relClose = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const BUSINESS_IDS = ["lemonade", "newspaper", "carwash", "pizzeria", "donut", "shrimp", "hockey", "studio", "bank", "oil",
  "airline", "port", "tech", "space", "moon", "asteroid", "dyson", "galaxy"];

/** A schema-shaped Business Empire save. Everything is invented. */
function saveFor({ investors, st, lifetime, rb = lifetime, rbc = 1, savedAgo = 0, sc, cash = 1e12, oil = 150 }) {
  const owned = Object.fromEntries(BUSINESS_IDS.map((id) => [id, id === "oil" ? oil : id === "lemonade" ? 30 : 0]));
  const managers = Object.fromEntries(BUSINESS_IDS.map((id) => [id, id === "oil" || id === "lemonade"]));
  const now = Date.now();
  return { v: 1, cash, lifetime, rb, st, rbc, gd: "2026-10-18", tb: lifetime, owned, managers, investors, ts: now - savedAgo, savedAt: now - savedAgo, ...(sc === undefined ? {} : { sc }) };
}
const SMALL = saveFor({ investors: 12345, st: 3, lifetime: 4.2e17, rb: 4e11, rbc: 2 });
const HUGE = saveFor({ investors: 1.2e71, st: 1.3e70, lifetime: 3e152, rb: 2.9e152, rbc: 32, savedAgo: 2 * 3600 * 1000, cash: 5e150, oil: 300 });
const CROSS = saveFor({ investors: 4e8, st: 0, lifetime: 7e25, rb: 4e13, rbc: 4 });   // raw bonus 4e7: under the cap; 20 stars from the rebirth lift it to 1.2e8

async function gameFrame(h, selector) {
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), selector, { timeout: 15000 });
  return h.page.frames().find((candidate) => candidate.parentFrame());
}
const tap = (game, selector) => game.evaluate((sel) => { const node = document.querySelector(sel); if (!node) throw new Error("missing " + sel); node.click(); }, selector);
/** Writes the save into the arcade's local store, then opens the game (a plain page first: localStorage needs the origin). */
async function openWith(h, save) {
  await h.goto("/about.html");
  await h.page.evaluate((value) => localStorage.setItem("pb_save_idle-empire", JSON.stringify(value)), save);
  await h.goto("/pixelbreak.html?g=idle-empire");
  const game = await gameFrame(h, ".business");
  await h.pause(600);
  return game;
}
const noticeState = (game) => game.evaluate(() => {
  const node = document.getElementById("softcap-notice");
  return { shown: node.classList.contains("show"), copy: document.getElementById("softcap-copy").textContent, visible: getComputedStyle(node).display !== "none" };
});

export const flow = {
  name: "idle-softcap", touch: false,
  async run(h) {
    const { page } = h;
    const consoleProblems = [];
    page.on("console", (message) => {
      if (message.type() === "error" || /Ignored an invalid score/.test(message.text())) consoleProblems.push(message.text());
    });

    h.step("small save: below the cap nothing changes");
    let game = await openWith(h, SMALL);
    let loaded = await game.evaluate(() => ({ save: snapshot(), bonus: prestigeMultiplier(), raw: rawPrestigeMultiplier(state.investors, state.st), cap: PRESTIGE_SOFT_CAP, capped: isSoftCapped(),
      oil: getCyclePayout(getBusiness("oil")), profit: getProfitMultiplier(150), stat: document.getElementById("investors").textContent }));
    h.eq([loaded.save.investors, loaded.save.st, loaded.save.rbc], [12345, 3, 2], "investors, stars, rebirth count untouched");
    h.expect(loaded.save.lifetime >= 4.2e17, "lifetime kept");
    h.expect(relClose(loaded.bonus, (1 + 1234.5) * 1.3) && loaded.bonus === loaded.raw, `bonus is exactly the old formula (${loaded.bonus})`);
    h.expect(relClose(loaded.oil, 18e9 * 150 * loaded.profit * loaded.raw), "Oil payout = old formula");
    h.eq(loaded.cap, CAP, "soft cap is x1e8");
    h.eq(await noticeState(game), { shown: false, copy: "", visible: false }, "no notice for a player under the cap");
    h.eq(loaded.save.sc, 0, "sc stays 0 (nothing to remember)");

    h.step("bonus function: continuous, increasing, linear below the cap, logarithmic above");
    const curve = await game.evaluate(() => {
      const points = []; const stars = 7;
      for (let e = 3; e <= 150; e += 0.25) points.push(prestigeMultiplier(Math.pow(10, e), stars));
      const edge = [prestigeMultiplier(1e9 - 1, 0), prestigeMultiplier(1e9, 0), prestigeMultiplier(1e9 + 1, 0), prestigeMultiplier(1e9 + 1e4, 0)];
      const raw = (i, s) => rawPrestigeMultiplier(i, s);
      return { increasing: points.every((v, i) => i === 0 || v > points[i - 1]), finite: points.every(Number.isFinite), edge, rawEdge: [raw(1e9 - 1, 0), raw(1e9, 0)],
        last: points.at(-1), huge: prestigeMultiplier(1e200, 1e200), inf: prestigeMultiplier(1e300, 1e300), zero: prestigeMultiplier(0, 0) };
    });
    h.expect(curve.increasing && curve.finite, "strictly increasing and finite for 1e3 .. 1e150 investors");
    h.eq(curve.zero, 1, "no investors, no stars: x1");
    h.expect(curve.edge[0] === curve.rawEdge[0] && curve.edge[1] === curve.rawEdge[1], "exactly linear up to the cap");
    h.expect(curve.edge[2] - curve.edge[1] > 0 && curve.edge[2] - curve.edge[1] < 1 + 1e-6 * CAP, "continuous across the cap (no jump)");
    h.expect(relClose(curve.last, expectedBonus(Math.pow(10, 150), 7)) && relClose(curve.huge, expectedBonus(1e200, 1e200)), "matches C x (1 + ln(raw / C)) far above the cap");
    h.expect(Number.isFinite(curve.inf), `no overflow with absurd counts (${curve.inf.toExponential(2)})`);

    h.step("huge save: counts and lifetime survive, bonus is capped, one-time notice");
    game = await openWith(h, HUGE);
    loaded = await game.evaluate(() => ({ save: snapshot(), bonus: prestigeMultiplier(), raw: rawPrestigeMultiplier(state.investors, state.st), capped: isSoftCapped(),
      oil: getCyclePayout(getBusiness("oil")), profit: getProfitMultiplier(300), income: getAutomaticIncome(), score: window.score, offline: { ...lastOfflineResult },
      stat: document.getElementById("investors").textContent, stars: document.querySelector(".idle-stars").textContent, lifetimeText: document.getElementById("lifetime").textContent }));
    h.eq([loaded.save.investors, loaded.save.st, loaded.save.rbc], [1.2e71, 1.3e70, 32], "investors, stars and rebirth count are EXACTLY what the save said (nothing drops)");
    h.expect(loaded.save.lifetime >= 3e152 && loaded.save.lifetime < 3.0001e152, `lifetime kept (${loaded.save.lifetime.toExponential(4)})`);
    h.expect(loaded.save.rb >= 2.9e152, "round earnings kept");
    h.expect(loaded.capped && loaded.raw > 1e138, `old bonus was x${loaded.raw.toExponential(2)}`);
    h.expect(relClose(loaded.bonus, expectedBonus(1.2e71, 1.3e70)) && loaded.bonus > 1e10 && loaded.bonus < 1e11, `effective bonus is x${loaded.bonus.toExponential(3)}`);
    h.expect(relClose(loaded.oil, 18e9 * 300 * loaded.profit * loaded.bonus), "Oil payout uses the capped bonus");
    h.expect(loaded.stat.includes("1.2e") === false && /\d/.test(loaded.stat), `header shows investors and the capped bonus (${loaded.stat})`);
    h.expect(/soft cap/.test(loaded.stars), `star line mentions the cap (${loaded.stars})`);
    h.expect(loaded.score >= 3e152, `leaderboard score = lifetime, no 2^53 clamp (${loaded.score.toExponential(3)})`);
    h.expect(loaded.offline.credited > 0 && Number.isFinite(loaded.offline.credited) && loaded.offline.credited < 1e40, `offline earnings still credited, from the capped income (+${loaded.offline.credited.toExponential(3)} after 2 h)`);
    const notice = await noticeState(game);
    h.expect(notice.shown && notice.visible, "one-time notice is visible");
    h.expect(/Prestige bonus soft cap|investors and stars/i.test(notice.copy) && notice.copy.includes("×") && /Nothing is removed/.test(notice.copy), `notice text: ${notice.copy}`);
    h.eq(loaded.save.sc, 1, "save remembers the notice (sc = 1)");
    await h.shot("softcap-huge");
    await tap(game, "#softcap-close");
    h.eq((await noticeState(game)).visible, false, "notice can be dismissed");

    h.step("reload: the notice is not shown again, state is identical");
    await h.goto("/pixelbreak.html?g=idle-empire");   // the arcade kept the save the game pushed (sc = 1)
    game = await gameFrame(h, ".business");
    await h.pause(600);
    const again = await game.evaluate(() => ({ save: snapshot(), shown: document.getElementById("softcap-notice").classList.contains("show") }));
    h.eq(again.shown, false, "no second notice");
    h.eq([again.save.investors, again.save.st, again.save.sc], [1.2e71, 1.3e70, 1], "counts and sc survive the round trip");

    h.step("investor claim and rebirth previews explain the cap");
    await game.evaluate(() => { state = { ...state, lifetime: 1e300, rb: 1e300 }; refreshAll(); });
    await tap(game, "#prestige-button");
    const claimText = await game.evaluate(() => document.getElementById("prestige-preview").textContent);
    h.expect(/Claim .* investors?\. Global profit: .*× → .*×\..*diminishing returns/.test(claimText), `claim preview: ${claimText}`);
    await tap(game, "#prestige-cancel");
    await tap(game, ".idle-rebirth");
    const rebirthText = await game.evaluate(() => document.querySelector(".idle-preview").textContent);
    h.expect(/You get .* stars\. Total investor and star bonus: ×.* → ×.*diminishing returns/.test(rebirthText), `rebirth preview: ${rebirthText}`);
    await tap(game, ".idle-cancel");

    h.step("a player who crosses the cap in play gets the notice then");
    game = await openWith(h, CROSS);
    h.eq((await noticeState(game)).visible, false, "under the cap: no notice yet");
    const before = await game.evaluate(() => ({ bonus: prestigeMultiplier(), raw: rawPrestigeMultiplier(state.investors, state.st), capped: isSoftCapped() }));
    h.expect(!before.capped && before.bonus === before.raw && relClose(before.bonus, 4e7 + 1, 1e-6), `bonus x${before.bonus.toExponential(2)}, linear`);
    await tap(game, ".idle-rebirth");
    await tap(game, ".idle-confirm");
    await h.pause(300);
    const crossed = await game.evaluate(() => ({ save: snapshot(), bonus: prestigeMultiplier(), raw: rawPrestigeMultiplier(state.investors, state.st), capped: isSoftCapped() }));
    h.expect(crossed.save.st >= 20 && crossed.capped, `rebirth gave ${crossed.save.st} stars and crossed the cap (raw x${crossed.raw.toExponential(3)} -> x${crossed.bonus.toExponential(3)})`);
    h.expect(relClose(crossed.bonus, expectedBonus(4e8, crossed.save.st)), "bonus follows C x (1 + ln(raw / C))");
    const late = await noticeState(game);
    h.expect(late.shown && /Nothing is removed/.test(late.copy), "notice shown on crossing");
    h.eq(crossed.save.investors, 4e8, "investors survive the rebirth");

    h.step("daily gift and Halloween production still follow the capped income");
    const gift = await game.evaluate(() => ({ income: getAutomaticIncome(), snapshotIncome: IdleExtras.offline(snapshot().st, Date.now() - 3600 * 1000, getAutomaticIncome()).credited }));
    h.expect(Number.isFinite(gift.income) && gift.snapshotIncome > 0, "automatic income and the offline helper work with the capped bonus");

    h.eq(consoleProblems, [], "no console errors or ignored-score warnings");
  },
};

runIfMain(import.meta.url, flow);
