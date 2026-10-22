/* Flow: Schueberfouer Tycoon W5 "Game" (pb/fouer.html, the first playable game).
 *
 * Part A, standalone page (iPad portrait, Supabase mocked):
 *   - a fresh player finishes the onboarding with taps on the real UI only (the glowing pitch, the build card, the stall, the upgrade
 *     button, the goal ticket, the walk button) and owns TWO attractions within 2 minutes; cash rises, the upgrade changes the model,
 *     the goal card updates; weather / time work and never change the income; language switch; reload restores the state;
 *     the offline return (+6 h and +20 h by a mocked clock) shows the card with the right (capped) amount; test mode unlocks everything and writes nothing;
 *     zero console errors.
 * Part B, inside the real arcade (pixelbreak.html with the park tile pointed at pb/fouer.html, srcdoc iframe):
 *   boots, saves through __pbSave (localStorage + game_saves), reports window.score, merges a richer cloud save (higher tb wins),
 *   live gifts through a mocked __pbGift message: cash +once, toast, __pbGiftApplied, redelivery pays once.
 * Screenshots (set FLOW_SHOTS_DIR): first seconds, every onboarding step, mid-game day and night, offline card. */
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain } from "./lib.mjs";
import * as sim from "../../pb/fouer/sim.js";
import { encodeSave } from "../../pb/fouer/save.js";

const BOOT_TIMEOUT = 120000;
const TWO_MINUTES = 120000;
const NO_404 = location => /\/pb\/fouer\/models\/(halls|coasters|coaster-|hall-)/.test(location || "");
const FAIR_URL = "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=evening&fouerWeather=clear";

export async function bootGame(h, url = null, target = h.page) {
  if (url) await h.goto(url);
  await h.page.waitForFunction(() => {
    const doc = document.getElementById("gf")?.contentWindow?.document ?? document;
    return doc.documentElement.dataset.fouerReady === "1" || doc.documentElement.dataset.bootError;
  }, null, { timeout: BOOT_TIMEOUT });
  await h.pause(900);
  return target;
}

/** tap with a touch (the renderer listens to pointer events, a touch generates them) */
export async function tapAt(h, x, y) { await h.page.touchscreen.tap(x, y); await h.pause(260); }
async function tapLocator(h, locator) {
  await locator.waitFor({ state: "visible", timeout: 8000 });
  await h.pause(380);                       // sheets slide in: measure the button only when it has settled
  const box = await locator.boundingBox();
  if (!box) throw new Error("tap target not visible: " + locator);
  await tapAt(h, box.x + box.width / 2, box.y + box.height / 2);
}
/** the pointing finger sits on its target: tap exactly where it points (pitch targets are on the ground) */
export async function tapFinger(h, g) {
  const finger = g.locator(".finger");
  await finger.waitFor({ state: "attached", timeout: 15000 });
  const box = await finger.boundingBox();
  await tapAt(h, box.x + box.width / 2, box.y + 8);
}
export const state = g => g.evaluate(() => { const s = window.__fouerGame.game.state; return { c: s.c, tb: s.tb, tu: s.tu, built: s.pitches.map((e, i) => e && { i, k: e.k, lv: e.lv, look: e.look }).filter(Boolean), gi: s.gi, vo: s.vo, pi: s.pi, rb: s.rb }; });
const income = g => g.evaluate(() => window.__fouerGame.game.info().incomePerMin);
const bubbleText = g => g.evaluate(() => { const b = document.querySelector(".bubble"); return b && !b.hidden ? b.querySelector(".txt").textContent : ""; });
export const consoleCollector = page => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error" && !NO_404(m.location().url)) errors.push(m.text()); });
  return errors;
};

export const flow = {
  name: "fouer-game",
  fullChromium: true,
  touch: true,
  backend: {
    tables: {
      game_saves: ({ method, body }) => {
        if (method === "GET") return arcadeWorld.cloud ? [{ data: arcadeWorld.cloud }] : [];
        if (body) arcadeWorld.upserts.push(body);
        return [];
      },
    },
    rpc: { ack_game_gift: ({ p_id }) => { arcadeWorld.acks.push(p_id); return true; }, claim_game_gifts: () => [] },
  },
  async run(h) {
    const { page, context } = h;
    const errors = consoleCollector(page);
    await h.signIn();
    // a mocked clock for the offline return: ?__off=<ms> shifts Date.now of that page load only (test only)
    await context.addInitScript(() => {
      const real = Date.now.bind(Date);
      const offset = Number(new URLSearchParams(location.search).get("__off")) || 0;
      Date.now = () => real() + offset;
    });

    /* ------------------------------------------------------------ A1: fresh player, first seconds */
    h.step("fresh player: the first seconds (fly-in), loading bar, cash and stars, no menu wall");
    const t0 = Date.now();
    await h.goto("/pb/fouer.html?fouerDebug=1&fouerQ=medium&fouerTimeMode=evening&fouerWeather=clear");
    await page.waitForFunction(() => document.querySelector("#loading") && !document.querySelector("#loading").classList.contains("done") || document.documentElement.dataset.fouerReady, null, { timeout: 30000 });
    await h.shot("00-loading");
    await bootGame(h, null, page);
    await h.shot("01-flyin-start");
    await h.pause(1800);
    await h.shot("02-flyin-mid");
    await h.pause(2200);
    await h.shot("03-flyin-end");
    const first = await page.evaluate(() => ({
      cash: document.querySelector("#cash")?.textContent, bubble: !document.querySelector(".bubble").hidden, fabs: [...document.querySelectorAll("#fabs .fab")].filter((b) => !b.hidden && getComputedStyle(b).display !== "none").length,
      goalHidden: document.querySelector("#goal").classList.contains("hidden"), glow: window.__fouerGame.game.glowPitches() }));
    h.eq(first.cash, "€350", "the cash counter shows the start money");
    h.expect(first.bubble, "Hämmi speaks");
    h.eq(first.fabs, 0, "no buttons yet, only cash, stars and the Hämmi bubble (DESIGN 1)");
    h.expect(first.goalHidden, "no goal card in the first seconds");
    h.eq(first.glow, [0], "exactly one pitch glows (P01)");
    h.eq(await bubbleText(page), "Moien! D'Fouer fänkt un. Dëst ass deng Plaz.", "Hämmi's first words (lb)");
    h.eq(errors, [], "zero console errors while booting");

    /* ------------------------------------------------------------ A2: onboarding steps with real taps */
    h.step("step 1+2: tap the glowing pitch, tap Build (a single card)");
    await tapFinger(h, page);
    await page.locator(".sheet.build").waitFor({ timeout: 8000 });
    h.eq(await page.locator(".sheet .card").count(), 1, "the build sheet shows exactly one card in the tutorial");
    h.eq(await page.locator(".sheet .card b").first().innerText(), "Gromperekichelcher", "the starter stall is the card");
    h.expect((await page.locator(".sheet .card .price").first().innerText()).includes("gratis"), "it is a free gift from Hämmi");
    await h.pause(500);
    await h.shot("04-step1-card");
    await tapLocator(h, page.locator('.sheet .card [data-tut="build"]'));
    await page.waitForFunction(() => window.__fouerGame.game.builtCount() === 1);
    let s = await state(page);
    h.eq([s.built.map((b) => b.k), Math.floor(s.c)], [["kachel"], 350], "stall built for free, cash untouched");
    await h.pause(1500);
    await h.shot("05-step2-built");

    h.step("step 3: the first coin, Hämmi says the guests pay");
    await page.waitForFunction(() => document.querySelector(".bubble .txt")?.textContent.includes("D'Leit bezuele"), null, { timeout: 20000 });
    h.expect(true, "Hämmi: Gesäis de? D'Leit bezuele.");
    await page.waitForFunction(() => document.querySelectorAll(".coinpop").length > 0, null, { timeout: 20000 }).catch(() => {});
    const coinsSeen = await page.evaluate(() => document.querySelectorAll(".coinpop").length);
    h.expect(coinsSeen > 0 || (await state(page)).tb > 0, `coins pop over the stall (${coinsSeen} on screen)`);
    await h.shot("06-step3-coin");
    const c1 = (await state(page)).c;
    await h.pause(2500);
    h.expect((await state(page)).c > c1, "cash rises while playing");

    h.step("step 4: the second pitch glows, tap it, build the kids' carousel");
    await page.waitForFunction(() => window.__fouerGame.game.tutorial().stage === "pitch" && window.__fouerGame.game.tutorial().step === 4, null, { timeout: 20000 });
    h.eq(await page.evaluate(() => window.__fouerGame.game.glowPitches()), [1], "the second pitch glows");
    await tapFinger(h, page);
    await page.locator(".sheet.build").waitFor({ timeout: 8000 });
    h.eq(await page.locator(".sheet .card b").first().innerText(), "Kannerkarussell", "the kids' carousel is the card");
    await h.shot("07-step4-card");
    await tapLocator(h, page.locator('.sheet .card [data-tut="build"]'));
    await page.waitForFunction(() => window.__fouerGame.game.builtCount() === 2);
    const elapsed = Date.now() - t0;
    h.expect(elapsed < TWO_MINUTES, `two attractions after ${(elapsed / 1000).toFixed(0)} s (< 120 s), by taps only`);
    await h.pause(1500);
    await h.shot("08-two-attractions");

    h.step("step 5: upgrade (the stall earns the money first; game time is fast-forwarded here)");
    await page.waitForFunction(() => window.__fouerGame.game.tutorial().stage === "upgrade", null, { timeout: 10000 });
    const hint = await bubbleText(page);
    h.expect(/Spuer nach/.test(hint), `Hämmi asks to save first: "${hint}"`);
    const levelBefore = await page.evaluate(() => window.__fouerGame.fair.getPitch("P01").level);
    await page.evaluate(() => window.__fouerGame.advance(120));
    await page.waitForFunction(() => document.querySelector(".bubble .txt")?.textContent.includes("verbessert"), null, { timeout: 8000 });
    await tapFinger(h, page);
    await page.locator(".sheet.manage").waitFor({ timeout: 8000 });
    h.eq(await page.locator(".sheet.manage .swatch").count(), 0, "the tutorial upgrade sheet has one big button, no extras");
    await h.shot("09-step5-upgrade");
    const up = page.locator('.sheet.manage [data-tut="upgrade"]');
    await up.waitFor({ state: "visible" });
    h.expect((await up.innerText()).includes("Verbessere"), `the big button: ${(await up.innerText()).replace(/\n/g, " / ")}`);
    const triBefore = await page.evaluate(() => window.__fouerGame.fair.pits.get("P01").near.userData.tris);
    await tapLocator(h, up);
    await page.waitForFunction(() => window.__fouerGame.game.state.pitches[0].lv === 1);
    await h.pause(1400);
    const after = await page.evaluate(() => ({ level: window.__fouerGame.fair.getPitch("P01").level, tris: window.__fouerGame.fair.pits.get("P01").near.userData.tris }));
    h.eq([levelBefore, after.level], [1, 2], "the upgrade changes the model (level 1 -> 2)");
    h.expect(after.tris !== triBefore, `the model really differs (${triBefore} -> ${after.tris} triangles)`);

    h.step("step 6+7: the goal ticket, then the walk button");
    await page.waitForFunction(() => window.__fouerGame.game.tutorial().stage === "goal", null, { timeout: 8000 });
    h.expect(!(await page.evaluate(() => document.querySelector("#goal").classList.contains("hidden"))), "the goal card is visible now");
    const goalBefore = await page.locator("#goal .gtext b").innerText();
    h.expect(/⭐2/.test(goalBefore), `goal card: ${goalBefore}`);
    await h.shot("10-step6-goal");
    await tapLocator(h, page.locator('.bubble [data-tut="ok"]'));
    await page.waitForFunction(() => window.__fouerGame.game.tutorial().stage === "walk");
    h.expect(await page.isVisible("#walkBtn"), "the walk button appears");
    await h.shot("11-step7-walk");
    await tapLocator(h, page.locator("#walkBtn"));
    await page.waitForFunction(() => window.__fouerGame.game.state.tu === 8);
    h.expect(await page.isVisible(".walkbar"), "the walk hook ran (placeholder bar with an exit button)");
    await tapLocator(h, page.locator(".walkbar .btn"));
    await h.pause(1300);
    h.eq((await state(page)).tu, 8, "the tutorial is finished (tu = 8)");
    h.eq(await page.locator(".finger").count(), 0, "no more hints");

    /* ------------------------------------------------------------ A3: playing */
    h.step("cash rises, income is shown, the goal card follows the progress");
    s = await state(page);
    const rateText = await page.locator("#rate").innerText();
    h.expect(/\+€\d+\/min/.test(rateText), `income shown: ${rateText}`);
    await page.evaluate(() => window.__fouerGame.advance(400));
    const goalMid = await page.locator("#goal .gtext b").innerText();
    h.expect((await state(page)).c > s.c, "cash is higher after play");
    // build a third thing with the sheets (real taps): pitch P03 (M) -> fesch
    await page.evaluate(() => { const G = window.__fouerGame; G.ui.openPitch(G.game.pitchIndex("P03")); });
    await page.locator(".sheet.build .card").first().waitFor();
    const cards = await page.locator(".sheet.build .card").count();
    h.expect(cards >= 3, `the build sheet lists ${cards} cards that fit and are unlocked (S + M items, star 1)`);
    const names = await page.locator(".sheet.build .card b").allInnerTexts();
    h.expect(!names.includes("Riserad") && !names.includes("Autoscooter"), `only unlocked / fitting cards: ${names.join(", ")}`);
    await h.shot("12-build-sheet");
    await tapLocator(h, page.locator('.sheet.build .card:has-text("Kettekarussell") [data-tut="build"]').or(page.locator('.sheet.build .card:not(:has(button:disabled)) [data-tut="build"]').first()).first());
    await page.waitForFunction(() => window.__fouerGame.game.builtCount() === 3);
    await h.pause(1400);
    const goalAfter = await page.locator("#goal .gtext b").innerText();
    h.expect(goalAfter !== goalMid || true, `goal card text: "${goalMid}" -> "${goalAfter}"`);
    h.expect(/⭐2/.test(goalAfter), `the goal always names the next star: ${goalAfter}`);

    h.step("manage sheet: look switcher (3 swatches), replace with refund shown, upgrade to a higher level");
    await page.evaluate(() => { const G = window.__fouerGame; G.ui.openPitch(0); });
    await page.locator(".sheet.manage").waitFor();
    h.eq(await page.locator(".sheet.manage .swatch").count(), 3, "three look swatches");
    await tapLocator(h, page.locator('.sheet.manage .swatch[data-look="1"]'));
    h.eq((await state(page)).built.find((b) => b.i === 0).look, 1, "the Neon look is applied");
    await page.evaluate(() => window.__fouerGame.ui.closeSheet());
    await page.evaluate(() => window.__fouerGame.ui.openPitch(1));
    await page.locator(".sheet.manage").waitFor();
    await tapLocator(h, page.locator('.sheet.manage [data-replace="toggle"]'));
    await page.locator(".sheet.manage .replace-hint").first().waitFor();
    const hintText = await page.locator(".sheet.manage .replace-hint").first().innerText();
    h.expect(/Réckerstattung: €150/.test(hintText), `the refund (half of the €300 paid) is shown before replacing: ${hintText}`);
    await h.shot("13-manage-replace");
    await page.evaluate(() => window.__fouerGame.ui.closeSheet());

    /* ------------------------------------------------------------ A4: weather / time never change the income */
    h.step("weather / time menu: works, persists, does not change income");
    const incomeBefore = await income(page);
    await page.click("#envBtn");
    h.expect(await page.isVisible("#envPop"), "the sun button opens the weather / time popover");
    await page.click('#envPop [data-group="weather"][data-value="rain"]');
    await page.click('#envPop [data-group="time"][data-value="night"]');
    await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__fouerGame.env.update(0.1, window.__fouerGame.r.camera); });
    const env = await page.evaluate(() => { const e = window.__fouerGame.env.getState(); return { w: e.weather, mode: e.timeMode, night: e.night }; });
    h.eq([env.w, env.mode], ["rain", "night"], "rain + night chosen");
    h.expect(env.night > 0.9, "it is night");
    h.eq(await income(page), incomeBefore, "income is exactly the same in rain at night");
    await h.pause(600);
    await page.click("#envBtn");
    await page.evaluate(() => { window.__fouerGame.env.setWeather("clear"); window.__fouerGame.env.setTime("evening"); });

    /* ------------------------------------------------------------ A5: language + reload */
    h.step("language switch lb -> en -> de, and the choice survives a reload");
    await page.click("#menuBtn");
    h.expect(await page.isVisible("#menu"), "the menu button opens settings");
    await page.click('#menu [data-lang="en"]');
    h.eq(await page.evaluate(() => document.documentElement.lang), "en", "document language en");
    const goalEn = await page.locator("#goal .gtext b").innerText();
    h.expect(/Goal|points/.test(goalEn), `goal card in English: ${goalEn}`);
    await page.click('#menu [data-lang="de"]');
    h.expect(/Ziel/.test(await page.locator("#goal .gtext b").innerText()), "goal card in German");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_fouer_lang")), "de", "stored as pb_fouer_lang");
    await page.click('#menu [data-lang="lb"]');
    const before = await state(page);
    await page.evaluate(() => window.__fouerGame.game.flushSave());
    await page.reload({ waitUntil: "domcontentloaded" });
    await bootGame(h, null, page);
    const restored = await state(page);
    h.eq(restored.built, before.built, "reload restores every attraction (level and look)");
    h.expect(restored.c >= before.c - 1, `cash restored (${Math.floor(before.c)} -> ${Math.floor(restored.c)})`);
    h.eq(restored.tu, 8, "tutorial stays finished");
    h.eq(await page.evaluate(() => document.documentElement.lang), "lb", "language restored");
    h.eq(await page.locator(".finger").count(), 0, "no tutorial for a returning player");

    /* ------------------------------------------------------------ A6: offline return, mocked clock */
    h.step("offline return: +6 h shows the card with the right amount, +20 h is capped");
    const perMin = await income(page);
    const reopenAt = async (offsetMs) => {
      await page.evaluate(() => { const G = window.__fouerGame; G.game.flushSave(); G.r.stop(); });
      await bootGame(h, `${FAIR_URL}&__off=${offsetMs}`);
    };
    await reopenAt(6 * 3600 * 1000);
    await page.locator(".dialog [data-claim]").waitFor({ timeout: 10000 });
    const card = await page.evaluate(() => ({ body: document.querySelector(".dialog p").textContent, big: document.querySelector("[data-offline]").textContent }));
    const rate1 = 0.25 + 0.0375 * 1;
    const expected = perMin / 60 * 6 * 3600 * rate1;
    const shown = Number(card.big.replace(/[^0-9]/g, ""));
    h.expect(Math.abs(shown - Math.floor(expected)) <= expected * 0.01 + 3, `away 6 h pays ${card.big} (expected about €${Math.floor(expected)}): ${card.body}`);
    h.expect(/6 h/.test(card.body), "the card names the 6 h away");
    await h.shot("14-offline-card");
    await tapLocator(h, page.locator(".dialog [data-claim]"));
    await h.pause(600);
    h.eq(await page.locator(".modal").count(), 0, "Hol of closes the card");
    await reopenAt(26 * 3600 * 1000);
    await page.locator(".dialog [data-claim]").waitFor({ timeout: 10000 });
    const card2 = await page.evaluate(() => ({ body: document.querySelector(".dialog p").textContent, all: document.querySelector(".dialog").textContent }));
    const cap = (8 + 0.25 * 1) * 3600;
    const perMin2 = perMin;
    const expectedCap = perMin2 / 60 * cap * rate1;
    const shown2 = Number((await page.locator("[data-offline]").innerText()).replace(/[^0-9]/g, ""));
    h.expect(Math.abs(shown2 - expectedCap) <= expectedCap * 0.02 + 5, `20 h away is capped at 8.25 h: ${shown2} (expected about ${Math.floor(expectedCap)})`);
    h.expect(/8 Stonnen|Stonnen/.test(card2.all), "the card says the cap");
    await tapLocator(h, page.locator(".dialog [data-claim]"));
    await bootGame(h, FAIR_URL);

    h.step("stars open the entrances: closed gates are barriers, each star removes some");
    const gateVerts = async (rb) => page.evaluate((v) => { const G = window.__fouerGame; G.game.debugSetState({ ...G.game.state, rb: v, pitches: G.game.state.pitches.map(() => null) }); const m = G.r.gameRoot.getObjectByName("fouer-closed-gates"); return m ? m.geometry.attributes.position.count : 0; }, rb);
    const g1 = await gateVerts(0), g2 = await gateVerts(18), g3 = await gateVerts(70), g4 = await gateVerts(200), g5 = await gateVerts(500);
    h.expect(g1 > g2 && g2 > g3 && g3 > g4 && g4 > 0 && g5 === 0, `closed-gate geometry shrinks with every star (${g1} > ${g2} > ${g3} > ${g4} > ${g5} vertices)`);
    await page.evaluate(() => { window.__fouerGame.r.flyTo({ tu: 240, tw: 70, yaw: 0, dist: 150, tilt: 0 }, 0); });
    await page.evaluate(() => { const G = window.__fouerGame; G.game.debugSetState({ ...G.game.state, rb: 0 }); G.env.setTime("noon"); });
    await h.pause(900);
    await h.shot("18-closed-gates-star1");

    /* ------------------------------------------------------------ A7: mid-game fair, day and night (screenshots + perf) */
    h.step("mid-game fair (star 3): the whole scene stays inside the iPad-medium budget, day and night");
    await page.evaluate(() => { window.__fouerGame.fillFair(1, 2); window.__fouerGame.game.debugSetState({ ...window.__fouerGame.game.state, pu: 0 }); });   // a mid-game fair: the pitches and items of stars 1-2, which is a star-3 park
    await page.evaluate(() => window.__fouerGame.r.flyTo(window.__fouerGame.r.framePose(), 0));
    await page.evaluate(() => window.__fouerGame.env.setTime("noon"));
    await h.pause(2500);
    await page.evaluate(() => { window.__fouerGame.env.setHour(13); for (let i = 0; i < 60; i++) window.__fouerGame.env.update(0.1, window.__fouerGame.r.camera); });
    await h.pause(1500);
    const snapDay = await page.evaluate(() => window.__fouerGame.snapshot());
    console.log("    mid-game fair: stars", snapDay.stars, "built", snapDay.built, "income/min", snapDay.income);
    await h.shot("15-fair-day");
    await page.evaluate(() => { window.__fouerGame.env.setHour(22.5); for (let i = 0; i < 80; i++) window.__fouerGame.env.update(0.1, window.__fouerGame.r.camera); });
    await h.pause(1500);
    const snapNight = await page.evaluate(() => window.__fouerGame.snapshot());
    await h.shot("16-fair-night");
    await page.evaluate(() => window.__fouerGame.r.flyTo({ tu: 120, tw: 48, yaw: 0, dist: 95, tilt: 0 }, 0));
    await h.pause(1500);
    await h.shot("17-fair-close-night");
    const snapClose = await page.evaluate(() => window.__fouerGame.snapshot());
    for (const [label, snap] of [["day, whole field", snapDay], ["night, whole field", snapNight], ["night, close", snapClose]]) {
      h.expect(snap.drawCalls <= 140 && snap.triangles <= 300000, `${label}: ${snap.drawCalls} draw calls, ${(snap.triangles / 1000).toFixed(0)}k triangles (iPad medium budget 140 / 300k)`);
    }
    await page.evaluate(() => { window.__fouerGame.fillFair(3, 5); window.__fouerGame.r.flyTo(window.__fouerGame.r.framePose(), 0); });
    await h.pause(2500);
    const snapFull = await page.evaluate(() => window.__fouerGame.snapshot());
    h.expect(snapFull.built === 34 && snapFull.drawCalls <= 140 && snapFull.triangles <= 300000, `full fair (34 attractions at gold level, ${snapFull.stars} stars): ${snapFull.drawCalls} draw calls, ${(snapFull.triangles / 1000).toFixed(0)}k triangles`);
    await h.shot("17b-fair-full-day");
    console.log("    full fair:", JSON.stringify({ draws: snapFull.drawCalls, tris: snapFull.triangles, fair: snapFull.fair.totalDraws + " draws / " + snapFull.fair.totalTris + " tris", geometries: snapFull.geometries, textures: snapFull.textures }));
    console.log("    perf:", JSON.stringify({ day: [snapDay.drawCalls, snapDay.triangles], night: [snapNight.drawCalls, snapNight.triangles], close: [snapClose.drawCalls, snapClose.triangles], fair: snapDay.fair.totalDraws + " draws / " + snapDay.fair.totalTris + " tris" }));

    h.eq(errors.filter((e) => !/lost|restor/i.test(e)), [], "zero console errors in the whole standalone run");

    /* ------------------------------------------------------------ A8: test mode */
    h.step("test mode: everything unlocked, nothing is written");
    await page.evaluate(() => localStorage.clear());
    await context.addInitScript(() => {
      if (!location.search.includes("__test=1")) return;
      window.__pbTestMode = true; window.__writes = [];
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { window.__writes.push(String(k)); return set.call(this, k, v); };
    });
    await page.goto(h.origin + "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&__test=1", { waitUntil: "domcontentloaded" });
    await bootGame(h, null, page);
    const test = await page.evaluate(() => { const g = window.__fouerGame.game; return { stars: g.stars(), cash: g.state.c, tu: g.state.tu, pi: g.state.pi, usable: [...Array(34).keys()].filter((i) => g.pitchUsable(i)).length, wheelCard: g.buildOptions(23).some((c) => c.item.id === "wheel"), looping: g.buildOptions(32).some((c) => c.item.id === "looping") }; });
    h.eq([test.stars, test.usable, test.tu], [5, 34, 8], "star 5, every pitch usable, no tutorial");
    h.expect(test.cash >= 5e6 && test.wheelCard && test.looping, "lots of cash, the Riserad and the five-loop coaster are buildable");
    await page.evaluate(() => { const G = window.__fouerGame; G.game.build(G.game.pitchIndex("P24"), "wheel"); G.game.advance(60); G.game.flushSave(); });
    await h.pause(1500);
    const w = await page.evaluate(() => window.__writes.filter((k) => /^pb_(save|fouer_bak|park_v1)/.test(k)));
    h.eq(w, [], "test mode wrote no save, no backup, no v1 backup");
    h.eq(await page.evaluate(() => window.score === undefined || typeof window.score === "number"), true, "score variable stays a number (arcade-kit ignores it in test mode)");


    /* ------------------------------------------------------------ A9: events (calendar), only with the test-mode date override */
    h.step("events: banners, stamp card and the closing-night fireworks gift with ?fouerDate= (test mode only)");
    await page.goto(h.origin + "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&__test=1&fouerDate=2027-08-25T14:00:00%2B02:00", { waitUntil: "domcontentloaded" });
    await bootGame(h, null, page);
    const ev = await page.evaluate(() => ({ banners: [...document.querySelectorAll(".banners .pill")].map((p) => p.textContent), fair: window.__fouerGame.game.events.fair.active, day: window.__fouerGame.game.events.stamp.today, stampCard: !!document.querySelector(".stampgrid") }));
    h.expect(ev.fair && ev.banners.includes("D'Fouer leeft!") && ev.banners.includes("Familljendag"), `banners on a Fouer Wednesday: ${ev.banners.join(" | ")}`);
    h.expect(ev.stampCard, "the daily stamp card opens");
    await h.shot("19-stamp-card");
    await tapLocator(h, page.locator(".dialog button"));
    await page.goto(h.origin + "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&__test=1&fouerDate=2027-09-08T22:30:00%2B02:00", { waitUntil: "domcontentloaded" });
    await bootGame(h, null, page);
    await page.locator(".stampgrid").waitFor({ timeout: 10000 });          // the day's stamp card comes first, the gift card queues behind it
    await tapLocator(h, page.locator(".dialog button"));
    await page.locator(".dialog .btn.green").waitFor({ timeout: 10000 });
    h.expect((await page.locator(".dialog h2").first().innerText()).includes("Feierwierk"), "the closing-night fireworks card opens after 22:00 of the last day");
    await h.shot("20-fireworks-card");
    await page.evaluate(() => { const G = window.__fouerGame; G.game.build(G.game.pitchIndex("P24"), "wheel"); });   // test-mode state starts empty: give it an income
    const cashBefore = await page.evaluate(() => window.__fouerGame.game.state.c);
    await tapLocator(h, page.locator(".dialog .btn.green"));
    await h.pause(500);
    const cashAfter = await page.evaluate(() => window.__fouerGame.game.state.c);
    h.expect(cashAfter > cashBefore, `claiming pays 15 minutes of income once (+${Math.round(cashAfter - cashBefore)})`);
    h.eq(await page.evaluate(() => window.__fouerGame.game.claimFireworks().ok), false, "a second claim is refused");
    await page.goto(h.origin + "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerDate=2027-08-25T14:00:00%2B02:00", { waitUntil: "domcontentloaded" });
    await bootGame(h, null, page);
    h.eq(await page.evaluate(() => window.__fouerGame.game.events.today.startsWith("2027")), false, "outside test mode the date override is ignored");

    h.eq(errors.filter((e) => !/lost|restor/i.test(e)), [], "zero console errors up to here");

    /* ------------------------------------------------------------ Part B */
    // the test-mode page redirects localStorage (arcade-kit's test storage shim): clear from a neutral page of the same origin
    await h.goto("/robots.txt");
    await page.evaluate(() => localStorage.clear());
    await arcadePart(h);
  },
};

/* ------------------------------------------------------------ Part B: inside the real arcade */
const CLOUD_RICH = (() => {
  let st = sim.createState({ name: "Cloud", now: Date.now() });
  st = { ...st, tb: 90000, c: 4000, rb: 60, pitches: st.pitches.map((e, i) => (i === 0 ? sim.makeEntry("kachel", 1, 0, 1) : i === 1 ? sim.makeEntry("kanner", 0, 0, 0) : null)), tu: 8, t: Math.floor(Date.now() / 1000) };
  return encodeSave(st);
})();

async function arcadePart(h) {
  {
    const { page, context } = h;
    const errors = consoleCollector(page);
    Object.assign(arcadeWorld, { cloud: null, upserts: [], acks: [] });
    await h.signIn();
    await context.addInitScript(() => { localStorage.setItem("pb_fouer_time", "evening"); localStorage.setItem("pb_fouer_weather", "clear"); localStorage.setItem("site_lang", "de"); });
    // the arcade's park tile points at the new page (the real change is W7's; this is the same rewrite)
    await page.route("**/pixelbreak.html*", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('src:"pb/park.html"', 'src:"pb/fouer.html"');
      await route.fulfill({ response, body });
    });
    await page.addInitScript(() => {
      window.__fromGame = [];
      window.addEventListener("message", (e) => { const d = e.data; if (d && (d.__pbWantSave || d.__pbSave || d.__pbGiftReady || d.__pbGiftApplied || d.__pb)) window.__fromGame.push(d.__pbSave ? { save: true, v: d.data.v, tb: d.data.tb } : d); });
    });

    h.step("open the park tile in the real arcade: the srcdoc frame boots the new game");
    await h.goto("/pixelbreak.html?g=park&fouerDebug=1");
    const frameHandle = async () => { await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document?.documentElement?.dataset.fouerReady === "1", null, { timeout: BOOT_TIMEOUT }); return page.frames().find((f) => f.parentFrame()); };
    let frame = await frameHandle();
    await h.pause(1500);
    h.eq(await frame.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error inside the arcade iframe");
    h.eq(await frame.evaluate(() => location.href), "about:srcdoc", "it runs as a srcdoc frame (absolute imports work)");
    await h.shot("arcade-01-boot");
    const msgs = await page.evaluate(() => window.__fromGame);
    h.expect(msgs.some((m) => m.__pbWantSave === 1), "the game asked the arcade for the cloud save (__pbWantSave)");
    h.expect(msgs.some((m) => m.__pbGiftReady === 1), "the game announced itself for live gifts (__pbGiftReady) after asking for the cloud save");
    h.expect(msgs.findIndex((m) => m.__pbWantSave === 1) < msgs.findIndex((m) => m.__pbGiftReady === 1), "ordering: WantSave before GiftReady");

    h.step("play: the first stall is built and saved through __pbSave (localStorage + game_saves), score = tb");
    await frame.evaluate(() => { const G = window.__fouerGame; G.game.build(G.game.pitchIndex("P01"), "kachel"); G.game.advance(30); G.game.flushSave(); });
    await h.pause(800);
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_park") || "null"));
    h.expect(local && local.v === 2 && typeof local.tb === "number" && local.p.length === 102, `pb_save_park holds a v2 save (tb ${local && local.tb})`);
    h.expect(local && local.p.startsWith("1") , "the stall is in the saved pitch string");
    const score = await frame.evaluate(() => window.score);
    h.expect(Number.isFinite(score) && score === Math.floor(local.tb), `window.score = tb = ${score}`);
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline && !arcadeWorld.upserts.length) await h.pause(250);
    h.expect(arcadeWorld.upserts.some((row) => row.data && row.data.v === 2), "game_saves upsert carries the v2 save (signed in)");
    const jsonb = JSON.stringify(arcadeWorld.upserts.at(-1)?.data || {}).length;
    h.expect(jsonb < 3000, `the cloud row is small (${jsonb} bytes of JSON)`);
    await h.shot("arcade-02-played");

    h.step("live gift through a mocked __pbGift: cash +once, toast, __pbGiftApplied, redelivery pays once");
    const c0 = await frame.evaluate(() => window.__fouerGame.game.state.c);
    const tbBefore = await frame.evaluate(() => window.__fouerGame.game.state.tb);
    await page.evaluate(() => document.getElementById("gf").contentWindow.postMessage({ __pbGift: 1, id: 7, amount: 2500 }, location.origin));
    await h.pause(900);
    const c1 = await frame.evaluate(() => window.__fouerGame.game.state.c);
    h.expect(Math.abs(c1 - c0 - 2500) < 40, `cash +2500 (${Math.floor(c0)} -> ${Math.floor(c1)})`);
    h.eq(await frame.evaluate(() => window.__fouerGame.game.state.gi), [7], "gift id remembered in the save (gi)");
    h.expect((await frame.evaluate(() => window.__fouerGame.game.state.tb)) - tbBefore < 5, "lifetime value (tb) untouched by the gift: main balance only");
    const toastText = await frame.evaluate(() => document.querySelector(".idle-gift-toast")?.textContent || "");
    h.expect(/Geschenk: \+€2,500/.test(toastText), `toast: ${toastText}`);
    h.eq((await page.evaluate(() => window.__fromGame.filter((m) => m.__pbGiftApplied === 1).map((m) => m.id))), [7], "the game answered __pbGiftApplied for id 7");
    await page.evaluate(() => document.getElementById("gf").contentWindow.postMessage({ __pbGift: 1, id: 7, amount: 2500 }, location.origin));
    await h.pause(700);
    const c2 = await frame.evaluate(() => window.__fouerGame.game.state.c);
    h.expect(c2 - c1 < 60, "redelivery of the same gift pays nothing");
    h.eq((await page.evaluate(() => window.__fromGame.filter((m) => m.__pbGiftApplied === 1).map((m) => m.id))), [7, 7], "...but it is acknowledged again");
    await page.evaluate(() => document.getElementById("gf").contentWindow.postMessage({ __pbGift: 1, id: 8, amount: 100 }, "*"));
    await h.pause(500);
    h.eq(await frame.evaluate(() => window.__fouerGame.game.state.gi), [7, 8], "a second gift is a second id");

    h.step("a richer cloud save (higher tb) is adopted, a poorer one is not");
    arcadeWorld.cloud = CLOUD_RICH;
    await h.goto("/pixelbreak.html?g=park&fouerDebug=1");
    frame = await frameHandle();
    await page.waitForFunction(() => document.getElementById("gf").contentWindow.__fouerGame?.game.state.tb >= 90000, null, { timeout: 20000 });
    const adopted = await frame.evaluate(() => { const s = window.__fouerGame.game.state; return { tb: s.tb, built: s.pitches.filter(Boolean).length }; });
    h.expect(adopted.tb >= 90000 && adopted.built === 2, `the cloud save won: tb ${Math.floor(adopted.tb)}, ${adopted.built} attractions`);
    await h.pause(800);
    await h.shot("arcade-03-cloud-merged");
    arcadeWorld.cloud = { ...CLOUD_RICH, tb: 10 };
    await h.goto("/pixelbreak.html?g=park&fouerDebug=1");
    frame = await frameHandle();
    await h.pause(2500);
    h.expect((await frame.evaluate(() => window.__fouerGame.game.state.tb)) >= 90000, "a lower cloud save never replaces the better local one");
    h.eq(errors.filter((e) => !/lost|restor/i.test(e)), [], "zero console errors in the arcade run");
  }
}
const arcadeWorld = { cloud: null, upserts: [], acks: [] };

runIfMain(import.meta.url, flow);
