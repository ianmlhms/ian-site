/* Flow — Mordsfall: opens a case, plays with real taps (notes, wrong check, hint, undo), solves it through the test hook,
 * asserts the win screen names the right murderer, that progress is saved, and that owner test mode writes nothing.
 * Also re-runs the data check (scripts/mordsfall_check.mjs): every shipped case has exactly one solution. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO, runIfMain } from "./lib.mjs";

const SAVE_KEY = "pb_save_mordsfall";
const seen = () => localStorage.setItem("pb_save_mordsfall", JSON.stringify({ v: 1, seen: true }));

async function cellXY(page, cell) {
  const n = Number(await page.locator(".mf-board").getAttribute("data-n"));
  const box = await page.locator(".mf-board").boundingBox();
  const k = box.width / (n * 100 + 50);
  return [box.x + (40 + (cell % n) * 100 + 50) * k, box.y + (40 + Math.floor(cell / n) * 100 + 50) * k];
}
async function tapPerson(page, p) { await page.locator(`.mf-pchip[data-p="${p}"]`).click(); }
async function tapCell(page, cell) { const [x, y] = await cellXY(page, cell); await page.mouse.click(x, y); }
const state = (page) => page.evaluate(() => window.__mordsfall.state());

export const flow = {
  name: "mordsfall",
  async run(h) {
    const { page } = h;
    h.step("data check: every shipped case has exactly one solution");
    let out = "";
    try { out = execFileSync("node", [path.join(REPO, "scripts/mordsfall_check.mjs")], { encoding: "utf8" }); } catch (error) { out = String(error.stdout || error.message); }
    const passLine = out.split("\n").find((l) => l.startsWith("PASS")) || out.split("\n").slice(-3).join(" | ");
    h.expect(/^PASS: 30 cases/.test(passLine), "mordsfall_check: " + passLine);

    h.step("open the case list");
    await page.context().addInitScript(seen);
    await h.goto("/mordsfall.html");
    await page.waitForSelector(".mf-card");
    h.eq(await page.locator(".mf-card").count(), 30, "30 cases are listed");
    await page.locator('[data-filter="ex"]').click();
    h.eq(await page.locator(".mf-card").count(), 6, "the Expert filter shows 6 cases");
    await page.locator('[data-filter="ve"]').click();
    h.eq(await page.locator(".mf-card").count(), 6, "the Very easy filter shows 6 cases");
    await h.shot("list");

    h.step("open case ve1 and play with taps");
    await page.locator('[data-case="ve1"]').click();
    await page.waitForSelector(".mf-board");
    const s0 = await state(page);
    h.eq(s0.id, "ve1", "ve1 is open");
    h.eq(await page.locator(".mf-pchip").count(), 5, "five people (4 suspects + victim)");
    // tapping a blocked cell with a person selected is refused
    const blocked = await page.evaluate(() => { const s = window.__mordsfall; return s.blockedCell(); });
    await tapPerson(page, 1);
    await tapCell(page, blocked);
    h.eq((await state(page)).pos[1], -1, "nobody can be placed on a blocking object");
    // place person 1 correctly, then a wrong person 2, then notes mode crosses a cell
    await tapCell(page, s0.solution[1]);
    h.eq((await state(page)).pos[1], s0.solution[1], "tap places the selected person");
    await tapCell(page, s0.solution[1]);
    h.eq((await state(page)).pos[1], -1, "tapping the selected person again takes them off");
    await tapCell(page, s0.solution[1]);
    await page.locator('[data-act="notes"]').click();
    await tapPerson(page, 2);
    const free = await page.evaluate(() => window.__mordsfall.freeCell());
    await tapCell(page, free);
    h.expect(await page.locator(".mf-board path.mark").count() > 0, "notes mode draws a cross");
    await page.locator('[data-act="notes"]').click();
    await page.locator('[data-act="undo"]').click();
    h.expect(await page.locator(".mf-board path.mark").count() === 0, "undo removes the cross");

    h.step("check too early, then with two people swapped");
    await page.locator('[data-act="check"]').click();
    h.expect((await page.locator(".mf-msg").innerText()).length > 0, "checking before everyone is placed gives a message");
    await page.evaluate(() => window.__mordsfall.placeAll([0, 1, 2, 3, 4]));
    await page.evaluate(() => window.__mordsfall.swap(3, 4));
    await page.locator('[data-act="check"]').click();
    h.expect(/2/.test(await page.locator(".mf-msg").innerText()), "a wrong placement reports 2 people in the wrong place");
    h.eq((await state(page)).status, "playing", "the case is still open after a wrong check");
    await h.shot("wrong-check");

    h.step("hint explains a deduction");
    await page.evaluate(() => window.__mordsfall.reset());
    await page.locator('[data-act="hint"]').click();
    await page.waitForSelector(".mf-hintbox");
    h.expect((await page.locator(".mf-hintbox").innerText()).length > 20, "the hint box has an explanation");
    h.eq((await state(page)).hints, 1, "using the hint is counted");
    await h.shot("hint");

    h.step("solve through the test hook → win screen reveals the murderer");
    await page.evaluate(() => window.__mordsfall.reset());
    await page.evaluate(() => window.__mordsfall.solve());
    await page.waitForSelector(".mf-win");
    const s1 = await state(page);
    h.eq(s1.status, "won", "the case is won");
    const who = await page.locator(".mf-win .who").innerText();
    h.expect(who.includes(s1.names[s1.murderer]), `win screen names the murderer (${s1.names[s1.murderer]}): «${who}»`);
    h.expect(s1.murderer !== 0, "the murderer is not the victim");
    // the murderer is the one sharing the victim's room
    const sameRoom = await page.evaluate(() => window.__mordsfall.sharesVictimRoom());
    h.eq(sameRoom, s1.names[s1.murderer], "the murderer is the other person in the victim's room");
    await h.shot("win");
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), SAVE_KEY);
    h.expect(stored.done && stored.done.ve1 && stored.done.ve1.t >= 1, "the solved case and its time are saved");
    await page.locator('[data-win="list"]').click();
    h.expect(await page.locator('[data-case="ve1"].solved').count() === 1, "the card shows the solved tick");

    h.step("owner test mode: unlocks nothing to write — storage stays untouched");
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: "block" });
    await ctx2.addInitScript(() => { window.__pbTestMode = true; });
    const p2 = await ctx2.newPage();
    p2.on("pageerror", (e) => h.failures.push("test-mode page error: " + e.message));
    await p2.goto(h.origin + "/mordsfall.html", { waitUntil: "domcontentloaded" });
    await p2.waitForSelector(".mf-card");
    await p2.evaluate(() => window.__mordsfall.openCase("ea1"));
    await p2.evaluate(() => window.__mordsfall.solve());
    await p2.waitForSelector(".mf-win");
    h.eq(await p2.evaluate(() => window.__mordsfall.state().status), "won", "test mode can still be played to the end");
    const keys = await p2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pb_save_mordsfall") || k.startsWith("pb_best_mordsfall")));
    h.eq(keys, [], "test mode writes no pb_save_/pb_best_ key");
    await ctx2.close();
  },
};

runIfMain(import.meta.url, flow);
