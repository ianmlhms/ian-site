/* Business Empire "Beyond Oil" (8 new businesses, profit milestones to 5000 owned) and
 * Cookie Clicker "Beyond the God" (8 new production tiers, 3 click upgrades).
 * Old-shaped saves (built from the previous schema, not real player data) must load
 * unchanged, the new top tiers must be buyable, rebirth must reset them, and big
 * numbers must format and clamp to the leaderboard cap without console noise. */
import { runIfMain } from "./lib.mjs";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const OLD_BUSINESSES = ["lemonade", "newspaper", "carwash", "pizzeria", "donut", "shrimp", "hockey", "studio", "bank", "oil"];
const NEW_BUSINESSES = ["airline", "port", "tech", "space", "moon", "asteroid", "dyson", "galaxy"];
const relClose = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1);

async function gameFrame(h, selector) {
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), selector);
  return h.page.frames().find((candidate) => candidate.parentFrame());
}

/** Clicks inside the game frame through the DOM: signed out, the parent's sign-in hint covers the bottom of the
 *  shop and Playwright would refuse the click; signing in makes the mocked Supabase fail CORS in WebKit. */
const tap = (game, selector) => game.evaluate((sel) => { const node = document.querySelector(sel); if (!node) throw new Error("missing " + sel); node.click(); }, selector);

/** The Business Empire save as the previous release wrote it: ten businesses only. */
function legacyEmpireSave() {
  const owned = Object.fromEntries(OLD_BUSINESSES.map((id, i) => [id, [900, 600, 500, 400, 300, 250, 220, 210, 205, 250][i]]));
  return { v: 1, cash: 1e30, lifetime: 4.2e17, rb: 4e11, st: 3, rbc: 2, gd: "2026-10-18", tb: 4.2e17,
    owned, managers: Object.fromEntries(OLD_BUSINESSES.map((id) => [id, true])), investors: 12345, ts: Date.now(), savedAt: Date.now() };
}

/** The Cookie Clicker save before this release: 16 tiers (no Haunted Oven slot yet) and 6 click upgrades. */
function legacyCookieSave(overrides = {}) {
  return { v: 1, c: 5e14, tb: 3e14, tc: 4000, rb: 3e14, st: 14, rbc: 1, gd: "2026-10-18", savedAt: Date.now(),
    u: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24, 29, 26, 20, 6, 0], cu: [9, 9, 9, 9, 9, 50], ...overrides };
}

export const flow = {
  name: "idle-more-content", touch: false,
  async run(h) {
    const { page } = h;
    const consoleProblems = [];
    page.on("console", (message) => {
      if (message.type() === "error" || /Ignored an invalid score/.test(message.text())) consoleProblems.push(message.text());
    });

    h.step("Business Empire: legacy 10-business save loads unchanged");
    await page.addInitScript((save) => {
      if (sessionStorage.getItem("more-content-seeded")) return;
      sessionStorage.setItem("more-content-seeded", "1");
      localStorage.setItem("pb_save_idle-empire", JSON.stringify(save));
    }, legacyEmpireSave());
    await h.goto("/pixelbreak.html?g=idle-empire");
    let game = await gameFrame(h, ".business");
    h.eq(await game.evaluate(() => document.querySelectorAll(".business").length), 18, "18 business cards");
    h.eq(await game.evaluate(() => BUSINESSES.map((business) => business.id)), [...OLD_BUSINESSES, ...NEW_BUSINESSES], "old ten first, eight new appended");
    h.eq(await game.evaluate(() => document.querySelector("#era-beyond").nextElementSibling.dataset.id), "airline", "'Beyond Oil' divider sits before Airline");
    const loaded = await game.evaluate(() => snapshot());
    h.eq(loaded.owned.oil, 250, "owned counts preserved (Oil)");
    h.eq(loaded.investors, 12345, "investors preserved");
    h.expect(OLD_BUSINESSES.every((id) => loaded.managers[id] === true), "old managers preserved");
    h.expect(NEW_BUSINESSES.every((id) => loaded.owned[id] === 0 && loaded.managers[id] === false), "new businesses start at 0 and unmanaged");
    h.expect(loaded.lifetime >= 4.2e17 && loaded.tb === loaded.lifetime, "lifetime kept and tb mirrors it (server keep-progress key)");
    const multiplier = (1 + 0.1 * 12345) * (1 + 0.1 * 3);
    const oilPayout = await game.evaluate(() => getCyclePayout(getBusiness("oil")));
    h.expect(relClose(oilPayout, 18e9 * 250 * 16 * multiplier), `Oil payout unchanged for 250 owned (${oilPayout.toExponential(3)})`);

    h.step("Business Empire: milestones beyond 200 double profit, not speed");
    const mile = await game.evaluate(() => ({
      p200: getProfitMultiplier(200), p299: getProfitMultiplier(299), p300: getProfitMultiplier(300), p1000: getProfitMultiplier(1000), p5000: getProfitMultiplier(5000),
      s200: getMilestoneMultiplier(200), s5000: getMilestoneMultiplier(5000), cycle5000: getCycleDurationMs(getBusiness("lemonade"), 5000),
      copy250: getMilestoneCopy(250), copy5000: getMilestoneCopy(5000), copy10: getMilestoneCopy(10),
      lemon300: getCyclePayout(getBusiness("lemonade"), { owned: { lemonade: 300 }, investors: 0, st: 0 }),
    }));
    h.eq([mile.p200, mile.p299, mile.p300, mile.p1000, mile.p5000], [16, 16, 32, 2 ** 11, 2 ** 18], "profit x16 at 200, x32 at 300, x2048 at 1000, x262144 at 5000");
    h.eq([mile.s200, mile.s5000, mile.cycle5000], [16, 16, 62.5], "speed stays x16 (lemonade cycle 62.5 ms)");
    h.eq(mile.lemon300, 300 * 32, "300 lemonade stands pay 9600 per cycle");
    h.expect(mile.copy250.includes("300 owned") && mile.copy250.includes("50 to go") && mile.copy250.includes("doubles profit"), `milestone copy past 200 (${mile.copy250})`);
    h.expect(mile.copy5000.startsWith("All milestones"), `milestone copy at the end (${mile.copy5000})`);
    h.expect(mile.copy10.includes("doubles profit and speed"), "early milestone copy unchanged");

    h.step("Business Empire: buy and automate the top tier");
    const before = await game.evaluate(() => ({ cash: state.cash, income: getAutomaticIncome() }));
    await tap(game, '.business[data-id="galaxy"] [data-action="buy"]');
    await tap(game, '.business[data-id="galaxy"] [data-action="manager"]');
    const bought = await game.evaluate(() => ({ cash: state.cash, owned: state.owned.galaxy, manager: state.managers.galaxy, income: getAutomaticIncome(), buyText: document.querySelector('.business[data-id="galaxy"] [data-action="manager"]').textContent }));
    h.eq([bought.owned, bought.manager], [1, true], "Galactic Exchange bought and automated");
    h.expect(relClose(before.cash - bought.cash, 4.3e24 + 170e24, 1e-2), `cash fell by cost + manager (production keeps adding a little) (${(before.cash - bought.cash).toExponential(3)})`);
    h.expect(relClose(bought.income - before.income, (23e18 * multiplier) / 3600, 1e-6), `income gained payout/3600 s (+${(bought.income - before.income).toExponential(3)}/s)`);
    h.expect(/Nova Nickel is managing/.test(bought.buyText), "manager label");
    const formatted = await game.evaluate(() => [format(4.3e24), format(170e24), format(9e307), format(Number.MAX_VALUE)]);
    h.expect(formatted.every((text) => /^\d/.test(text) && !/NaN|undefined|∞/.test(text)), `big numbers format (${formatted.join(", ")})`);

    h.step("Business Empire: score clamps to the leaderboard cap");
    const clamped = await game.evaluate(() => { state = { ...state, lifetime: 1e30 }; updateScore(); return window.score; });
    h.eq(clamped, MAX_SAFE, "score reported at Number.MAX_SAFE_INTEGER, not dropped");
    await game.evaluate(() => { state = { ...state, lifetime: 4.2e17 }; updateScore(); });

    h.step("Business Empire: round trip and rebirth reset the new businesses");
    const roundTrip = await game.evaluate(() => { const saved = snapshot(); const ok = applySave(saved); return { ok, same: JSON.stringify(snapshot().owned) === JSON.stringify(saved.owned) }; });
    h.expect(roundTrip.same, "snapshot -> applySave keeps owned counts");
    await tap(game, ".idle-rebirth");
    await tap(game, ".idle-confirm");
    const afterRebirth = await game.evaluate(() => snapshot());
    h.expect(Object.values(afterRebirth.owned).every((count) => count === 0) && Object.values(afterRebirth.managers).every((m) => m === false), "rebirth resets all 18 businesses and managers");
    h.expect(afterRebirth.st > 3 && afterRebirth.rbc === 3, `rebirth adds stars (${afterRebirth.st}) and counts (${afterRebirth.rbc})`);
    h.eq(afterRebirth.investors, 12345, "investors survive rebirth");
    await page.setViewportSize({ width: 390, height: 844 });
    h.expect(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Business Empire fits 390 px");
    await h.shot("empire-beyond");
    await page.setViewportSize({ width: 820, height: 1180 });

    h.step("Cookie Clicker: legacy 16-slot save gets the new tiers appended");
    await page.evaluate((save) => { sessionStorage.removeItem("more-content-seeded"); localStorage.setItem("pb_save_cookie-clicker", JSON.stringify(save)); }, legacyCookieSave({ c: 5e26 }));
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    game = await gameFrame(h, ".upgrade[data-type='cps']");
    const cc = await game.evaluate(() => ({ tiers: upgrades.length, clicks: clickUpgrades.length, save: snapshot(),
      shop: [...document.querySelectorAll('.upgrade[data-type="cps"]')].map((row) => upgrades[+row.dataset.i].name) }));
    h.eq([cc.tiers, cc.clicks], [25, 9], "25 production slots and 9 click upgrades");
    h.eq(cc.save.u.slice(0, 16), legacyCookieSave().u, "old 16 counts preserved");
    h.expect(cc.save.u.slice(16).every((count) => count === 0) && cc.save.u.length === 25, "slot 16 (Haunted Oven) and new slots 17-24 start at 0");
    h.eq(cc.save.cu, [9, 9, 9, 9, 9, 50, 0, 0, 0], "click upgrade counts padded");
    h.eq([cc.shop[0], cc.shop[16], cc.shop[17], cc.shop[24]], ["Haunted Oven", "Cookie God", "Big Bang Bakery", "Cookie Infinity"], "Halloween shop order: Haunted Oven first, then the tiers in order");
    h.expect(cc.save.tb >= 3e14, "lifetime baked kept");

    await h.goto("/pixelbreak.html?g=cookie-clicker");
    game = await gameFrame(h, ".upgrade[data-type='cps']");
    const offSeason = await game.evaluate(() => [...document.querySelectorAll('.upgrade[data-type="cps"]')].map((row) => upgrades[+row.dataset.i].name));
    h.eq([offSeason[0], offSeason[15], offSeason[23], offSeason[24]], ["Auto Clicker", "Cookie God", "Cookie Infinity", "Haunted Oven"], "off-season shop order: tiers in order, Haunted Oven parked last");
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    game = await gameFrame(h, ".upgrade[data-type='cps']");

    h.step("Cookie Clicker: buy the top tier and the biggest click upgrade");
    const stats = await game.evaluate(() => ({ cps, clickPower, cookies }));
    await tap(game, '.upgrade[data-type="cps"][data-i="24"]');
    await tap(game, '.upgrade[data-type="click"][data-i="8"]');
    const bought2 = await game.evaluate(() => ({ cps, clickPower, cookies, save: snapshot() }));
    h.eq([bought2.save.u[24], bought2.save.cu[8]], [1, 1], "Cookie Infinity and Big Bang Click bought");
    h.expect(relClose(bought2.cps - stats.cps, 1e18 * (1 + 0.1 * 14), 1e-9), `+1e18 base cps times stars (+${(bought2.cps - stats.cps).toExponential(3)}/s)`);
    h.eq(bought2.clickPower - stats.clickPower, 5e8, "+500M click power");
    h.expect(relClose(stats.cookies - bought2.cookies, 28e24 + 2e13, 1e-6), "cookies fell by both costs");
    const label = await game.locator('.upgrade[data-type="cps"][data-i="24"] .cost').innerText();
    h.expect(/^\d+\.\d(Sp|Oc|No|Dc) 🍪$/.test(label), `cost label uses the new suffixes (${label})`);
    const haunted = await game.evaluate(() => { document.querySelector('.upgrade[data-type="cps"][data-i="16"]').click(); return snapshot().u[16]; });
    h.eq(haunted, 1, "Haunted Oven still buys into slot 16");

    h.step("Cookie Clicker: rebirth resets the new tiers, keeps Haunted Oven; score clamps");
    await tap(game, ".idle-rebirth");
    const rebirth = await game.evaluate(() => { document.querySelector(".idle-confirm").click(); return snapshot(); });
    h.expect(rebirth.u.slice(0, 16).every((count) => count === 0) && rebirth.u.slice(17).every((count) => count === 0), "ordinary and new tiers reset");
    h.eq(rebirth.u[16], 1, "Haunted Oven survives");
    h.expect(rebirth.cu.every((count) => count === 0), "click upgrades reset (including the new three)");
    const ccScore = await game.evaluate(() => { totalBaked = 1e30; reportScore(); return window.score; });
    h.eq(ccScore, MAX_SAFE, "Cookie Clicker score clamps at the cap");
    await page.setViewportSize({ width: 390, height: 844 });
    h.expect(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Cookie Clicker fits 390 px");
    await h.shot("cookie-beyond");

    h.eq(consoleProblems, [], "no console errors or ignored-score warnings");
  },
};

runIfMain(import.meta.url, flow);
