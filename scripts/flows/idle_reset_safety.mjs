/* Destructive idle-game resets (investor claim, rebirth) after the 20 Oct 2026 Business Empire loss:
 * Cancel is focused, the confirm button is locked for the first second, small gains need a real 1.5 s press-and-hold,
 * and every reset offers a 30 s Undo that restores the exact state and reaches the cloud save in one batched request.
 * Games: Business Empire (investors + rebirth), Cookie Clicker (rebirth), Bus Tycoon (rebirth). Saves are invented. */
import { runIfMain } from "./lib.mjs";
import { holdConfirm } from "./reset_guard.mjs";

const BUSINESS_IDS = ["lemonade", "newspaper", "carwash", "pizzeria", "donut", "shrimp", "hockey", "studio", "bank", "oil",
  "airline", "port", "tech", "space", "moon", "asteroid", "dyson", "galaxy"];
const COUNT = (n) => Object.fromEntries(BUSINESS_IDS.map((id, i) => [id, i < 10 ? n - i : 0]));
const HIRED = Object.fromEntries(BUSINESS_IDS.map((id, i) => [id, i < 9]));
const DESKTOP = { width: 1280, height: 800 }, IPAD = { width: 820, height: 1180 };
const SAVE_DEBOUNCE_WAIT = 4500;   // the arcade debounces cloud saves by 3 s

/** The incident: a player at 1.2e9 lifetime, 0 investors, a full empire. */
const empire = (over = {}) => ({ v: 1, cash: 1.2e9, lifetime: 1.2e9, rb: 1.2e9, st: 0, rbc: 0, gd: "", sc: 0, rs: Date.now() - 3 * 3600 * 1000,
  owned: COUNT(60), managers: HIRED, investors: 0, tb: 1.2e9, ts: Date.now(), savedAt: Date.now(), ...over });
const cookie = (over = {}) => ({ v: 1, c: 123456789.5, tb: 5e12, tc: 777, rb: 4e12, st: 1, rbc: 1, gd: "", rs: Date.now() - 5 * 3600 * 1000, savedAt: Date.now(),
  u: [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 1], cu: [10, 8, 6, 4, 2, 1], ...over });
const bus = (over = {}) => ({ v: 1, p: 4e12, tb: 9e12, rb: 4e12, st: 2, rbc: 1, gd: "", rs: Date.now() - 4 * 3600 * 1000, savedAt: Date.now(),
  owned: { school: 30, city: 25, gare: 20, kirchberg: 12, belval: 5 }, upgrades: ["lanes", "free"], drivers: 3, ...over });

let cloudWrites = [];
const frameOf = (h) => h.page.frames().find((candidate) => candidate.parentFrame());
async function open(h, id, save, ready) {
  await h.goto("/about.html");
  await h.page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); }, ["pb_save_" + id, save]);
  await h.goto("/pixelbreak.html?g=" + id);
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), ready, { timeout: 15000 });
  await h.pause(800);
  return frameOf(h);
}
const saveBodies = (h, id) => h.backend.calls.filter((call) => call.kind === "table" && call.name === "game_saves" && call.method === "POST")
  .flatMap((call) => [].concat(call.body)).filter((row) => row && row.game_id === id);
const focusedIn = (game) => game.evaluate(() => (document.activeElement?.id || document.activeElement?.className || "").toString());
const toastText = (game) => game.evaluate(() => document.querySelector(".idle-undo")?.innerText || "");
async function shots(h, label) {
  for (const [name, size] of [["ipad", IPAD], ["desktop", DESKTOP]]) {
    await h.page.setViewportSize(size); await h.pause(400);
    await h.shot(`${label}-${name}`);
  }
  await h.page.setViewportSize(IPAD); await h.pause(300);
}
/** Quick presses that must NOT confirm: bare click, double click, 300 ms mouse press, Enter / Space tap. */
async function failedPresses(h, game, selector) {
  const box = await game.locator(selector).boundingBox();
  await game.locator(selector).click({ delay: 20 });
  await game.locator(selector).dblclick();
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.page.mouse.down(); await h.pause(300); await h.page.mouse.up();
  await game.locator(selector).focus();
  await h.page.keyboard.press("Enter"); await h.page.keyboard.press("Space");
}

export const flow = {
  name: "idle-reset-safety", touch: false,
  backend: {
    tables: { game_saves: ({ method }) => method === "GET" ? [] : [] },
    rpc: { touch_streak: () => ({ streak: 5, best: 5, is_new_day: false }) },
  },
  async run(h) {
    const { page } = h;
    const problems = [];
    page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
    await h.signIn();

    /* ---------------- Business Empire: investor claim (the incident) ---------------- */
    h.step("Business Empire: the incident save, investors 0 -> 1");
    let game = await open(h, "idle-empire", empire(), ".business");
    const before = await game.evaluate(() => JSON.parse(JSON.stringify(state)));
    await game.evaluate(() => document.getElementById("prestige-button").click());
    h.expect(/prestige-cancel/.test(await focusedIn(game)), "Cancel has the focus, not the reset button");
    h.expect(await game.locator("#prestige-confirm").isDisabled(), "reset is locked right after the dialog opens");
    await h.pause(1200);
    h.expect(await game.locator("#prestige-confirm").isEnabled(), "reset unlocks after about a second");
    h.expect(/Hold to reset for 1/.test(await game.locator("#prestige-confirm").innerText()), "a +10% claim asks for a press-and-hold");
    const adviceText = await game.locator("#prestige-advice").innerText();
    h.expect(/Not worth it yet/.test(adviceText) && /took about 3 h/.test(adviceText) && /pays for itself after about/.test(adviceText), `advice names the round time and the payback: ${adviceText.replace(/\n/g, " | ")}`);
    h.expect(/resets ALL businesses, managers and your cash/.test(await game.locator("#prestige-modal .warning").innerText()), "dialog spells out the reset");
    await shots(h, "empire-investors-dialog");
    await failedPresses(h, game, "#prestige-confirm");
    h.eq(await game.evaluate(() => [state.investors, state.cash > 1e9, state.owned.lemonade]), [0, true, 60], "bare click, double click, short press, Enter and Space do not reset");
    await game.locator("#prestige-cancel").focus();
    await page.keyboard.press("Enter");
    h.expect(!(await game.evaluate(() => document.getElementById("prestige-modal").classList.contains("show"))), "Enter on the focused Cancel closes the dialog");
    await game.evaluate(() => document.getElementById("prestige-button").click());
    await holdConfirm(h, game, "#prestige-confirm");
    const after = await game.evaluate(() => JSON.parse(JSON.stringify(state)));
    h.expect(after.investors === 1 && after.cash === 10 && Object.values(after.owned).every((n) => n === 0), "holding for 1.5 s resets (investors 1, cash $10, nothing owned)");
    h.expect(/Claimed 1 investor/.test(await toastText(game)) && /Undo/.test(await toastText(game)), `Undo toast: ${(await toastText(game)).replace(/\n/g, " ")}`);
    await h.shot("empire-undo-toast");
    const requestsBeforeUndo = saveBodies(h, "idle-empire").length;
    await game.locator(".idle-undo button:not(.idle-undo-x)").click();
    const restored = await game.evaluate(() => JSON.parse(JSON.stringify(state)));
    h.eq([restored.cash, restored.investors, restored.owned, restored.managers, restored.st, restored.rbc, restored.rb], [before.cash, 0, before.owned, before.managers, 0, 0, before.rb], "Undo restores cash, businesses, managers and investors exactly");
    h.expect(restored.lifetime >= before.lifetime, "lifetime never goes down");
    h.expect(!(await game.locator(".idle-undo").count()), "toast gone after Undo");
    await h.pause(SAVE_DEBOUNCE_WAIT);
    const writes = saveBodies(h, "idle-empire");
    const lastWrite = writes.at(-1);
    h.expect(lastWrite && lastWrite.data.investors === 0 && lastWrite.data.cash === before.cash && lastWrite.data.owned.lemonade === 60, "the cloud save holds the restored state");
    h.expect(writes.length - requestsBeforeUndo <= 1, `Undo cost at most one save request (${writes.length - requestsBeforeUndo})`);
    h.eq(await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_idle-empire")).investors), 0, "local save holds the restored state too");

    h.step("Business Empire: a big gain needs no hold; Undo survives a reload; the toast expires");
    await game.evaluate(() => { state = { ...state, lifetime: 1e12, rb: 1e12 }; refreshAll(); });
    await game.evaluate(() => document.getElementById("prestige-button").click());
    h.expect(await game.locator("#prestige-confirm").isDisabled(), "locked on open also for a big gain");
    await h.pause(1200);
    h.expect(!/Hold/.test(await game.locator("#prestige-confirm").innerText()), "a x100 gain is a plain confirm button");
    const bigBefore = await game.evaluate(() => JSON.parse(JSON.stringify(state)));
    await game.locator("#prestige-confirm").click();
    h.expect((await game.evaluate(() => state.investors)) === 1000, "plain click claims 1000 investors");
    await h.pause(3500);   // let the arcade store the reset save, then reload
    await h.goto("/pixelbreak.html?g=idle-empire");
    await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document.querySelector(".business"));
    await h.pause(800); game = frameOf(h);
    h.expect(/Undo/.test(await toastText(game)), "after a reload the Undo toast is still there");
    await game.locator(".idle-undo button:not(.idle-undo-x)").click();
    h.eq(await game.evaluate(() => [state.investors, state.owned.lemonade, state.cash]), [0, 60, bigBefore.cash], "Undo after a reload restores the exact pre-reset state");
    await game.evaluate(() => rewards.offerUndo("Test reset.", cloneState(), Date.now() + 1500));
    h.expect(/Undo/.test(await toastText(game)), "toast shows");
    await h.pause(2600);
    h.expect(!(await game.locator(".idle-undo").count()), "toast disappears when the time is up");
    h.expect(await page.evaluate(() => localStorage.getItem("idle_undo_idle-empire") === null), "expired undo entry removed from storage");

    /* ---------------- Business Empire: rebirth ---------------- */
    h.step("Business Empire: rebirth");
    game = await open(h, "idle-empire", empire({ lifetime: 4e11, rb: 4e11, tb: 4e11, rbc: 2, st: 3, investors: 50 }), ".business");
    const rbBefore = await game.evaluate(() => JSON.parse(JSON.stringify(state)));
    await game.locator(".idle-rebirth").click();
    h.expect(/idle-cancel/.test(await focusedIn(game)), "rebirth dialog focuses Cancel");
    h.expect(await game.locator(".idle-confirm").isDisabled(), "rebirth confirm locked on open");
    await h.pause(1200);
    h.expect(/Hold to rebirth/.test(await game.locator(".idle-confirm").innerText()), "small rebirth asks for a hold");
    h.expect(/This round took about 3 h/.test(await game.locator(".idle-advice").innerText()), "rebirth dialog shows the round time");
    await shots(h, "empire-rebirth-dialog");
    await failedPresses(h, game, ".idle-confirm");
    h.eq(await game.evaluate(() => [state.rbc, state.owned.lemonade]), [2, 60], "short presses do not rebirth");
    await holdConfirm(h, game, ".idle-confirm");
    h.eq(await game.evaluate(() => [state.rbc, state.st, state.owned.lemonade]), [3, 3 + Math.floor(Math.sqrt(4e11 / 100e9)), 0], "hold -> rebirth");
    h.expect(/Rebirth done/.test(await toastText(game)), "rebirth Undo toast");
    await game.locator(".idle-undo button:not(.idle-undo-x)").click();
    h.eq(await game.evaluate(() => [state.rbc, state.st, state.rb, state.cash, state.owned, state.managers, state.investors]), [2, 3, rbBefore.rb, rbBefore.cash, rbBefore.owned, rbBefore.managers, 50], "rebirth Undo restores everything");
    await h.pause(SAVE_DEBOUNCE_WAIT);
    const rbWrite = saveBodies(h, "idle-empire").at(-1);
    h.expect(rbWrite && rbWrite.data.rbc === 2 && rbWrite.data.st === 3 && typeof rbWrite.data.ud === "number", "cloud save: restored rebirth count, carries the ud marker the server guard needs");

    /* ---------------- Cookie Clicker rebirth ---------------- */
    h.step("Cookie Clicker: rebirth");
    game = await open(h, "cookie-clicker", cookie(), ".idle-rebirth");
    const ccBefore = await game.evaluate(() => ({ cookies, totalBaked, stars, rebirthCount, roundBaked, u: upgrades.map((x) => x.count), cu: clickUpgrades.map((x) => x.count) }));
    await game.locator(".idle-rebirth").click();
    h.expect(/idle-cancel/.test(await focusedIn(game)), "Cookie Clicker rebirth dialog focuses Cancel");
    h.expect(await game.locator(".idle-confirm").isDisabled(), "Cookie Clicker confirm locked on open");
    await h.pause(1200);
    h.expect(/Hold to rebirth/.test(await game.locator(".idle-confirm").innerText()), "Cookie Clicker rebirth needs the hold");
    await shots(h, "cookie-rebirth-dialog");
    await failedPresses(h, game, ".idle-confirm");
    h.eq(await game.evaluate(() => rebirthCount), 1, "Cookie Clicker: short presses do not rebirth");
    await holdConfirm(h, game, ".idle-confirm");
    h.eq(await game.evaluate(() => [rebirthCount, cookies < 1e9, upgrades[0].count]), [2, true, 0], "Cookie Clicker: hold -> rebirth");
    await game.locator(".idle-undo button:not(.idle-undo-x)").click();
    const ccAfter = await game.evaluate(() => ({ cookies, totalBaked, stars, rebirthCount, roundBaked, u: upgrades.map((x) => x.count), cu: clickUpgrades.map((x) => x.count) }));
    h.expect(ccAfter.cookies >= ccBefore.cookies * 0.999 && ccAfter.stars === ccBefore.stars && ccAfter.rebirthCount === ccBefore.rebirthCount && JSON.stringify(ccAfter.u) === JSON.stringify(ccBefore.u) && JSON.stringify(ccAfter.cu) === JSON.stringify(ccBefore.cu),
      "Cookie Clicker Undo restores cookies, stars, rebirth count, buildings and click upgrades");
    h.expect(ccAfter.totalBaked >= ccBefore.totalBaked, "Cookie Clicker lifetime never goes down");
    await h.pause(SAVE_DEBOUNCE_WAIT);
    const ccWrite = saveBodies(h, "cookie-clicker").at(-1);
    h.expect(ccWrite && ccWrite.data.rbc === 1 && ccWrite.data.u[0] === 20 && typeof ccWrite.data.ud === "number", "Cookie Clicker cloud save holds the restored state");

    /* ---------------- Bus Tycoon rebirth ---------------- */
    h.step("Bus Tycoon: rebirth");
    game = await open(h, "bus-tycoon", bus(), ".idle-rebirth");
    const busBefore = await game.evaluate(() => JSON.parse(localStorage.getItem("pb_save_bus-tycoon") || "null"));
    await game.locator(".idle-rebirth").click();
    h.expect(/idle-cancel/.test(await focusedIn(game)), "Bus Tycoon rebirth dialog focuses Cancel");
    await h.pause(1200);
    h.expect(/Hold to rebirth/.test(await game.locator(".idle-confirm").innerText()), "Bus Tycoon rebirth needs the hold");
    await shots(h, "bus-rebirth-dialog");
    await holdConfirm(h, game, ".idle-confirm");
    const busReset = await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_bus-tycoon")));
    h.expect(busReset.rbc === 2 && busReset.drivers === 0 && busReset.upgrades.length === 0, "Bus Tycoon: hold -> rebirth");
    await game.locator(".idle-undo button:not(.idle-undo-x)").click();
    const busBack = await page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_bus-tycoon")));
    h.expect(busBack.rbc === 1 && busBack.st === 2 && busBack.drivers === 3 && busBack.upgrades.join() === "lanes,free" && JSON.stringify(busBack.owned) === JSON.stringify(busBefore.owned) && busBack.p >= busBefore.p * 0.999 && busBack.tb >= busBefore.tb,
      "Bus Tycoon Undo restores lines, drivers, upgrades, stars and passengers");
    await h.pause(SAVE_DEBOUNCE_WAIT);
    const busWrite = saveBodies(h, "bus-tycoon").at(-1);
    h.expect(busWrite && busWrite.data.rbc === 1 && busWrite.data.drivers === 3 && typeof busWrite.data.ud === "number", "Bus Tycoon cloud save holds the restored state");

    h.eq(problems.filter((text) => !/Failed to load resource/.test(text)), [], "no console errors");
  },
};
runIfMain(import.meta.url, flow);
