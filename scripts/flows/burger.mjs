/* Flow: Burger-Restaurant (pb/burger.html in the arcade hub) on a touch iPad, Chromium and WebKit
 * (FLOW_BROWSER=webkit node scripts/flows/run_all.mjs =burger).
 *
 * A player bot taps the real buttons with touch (no shortcuts into the game state) and plays two full days at 4x speed
 * (?burgerTest=1 exposes a read-only state + a speed knob >= 1). Checks along the way:
 *  - an old save of the real shape (v:1, no tb) loads unchanged and is not pushed back at boot,
 *  - money = score: coins and lifetimeCoins grow by what the day earned, the arcade best (pb_best_burger) follows lifetimeCoins,
 *  - the day ends with the right summary and the save (local + mocked game_saves) has the new day and tb = lifetimeCoins,
 *  - cloud save delivered twice (older cloud copy, then the session's newest push, in both orders): the game keeps the better
 *    one, a better save arriving mid-day does not stop the day, a purchase is not undone by an equal-lifetime copy,
 *  - the arcade restart button mid-day keeps every coin; a frame reload after a purchase keeps the purchase (signed in or not),
 *  - a hidden page pauses the day; the arcade mute reaches the game; rotate to portrait keeps the layout inside the frame. */
import { runIfMain } from "./lib.mjs";

const SPEED = 4;
const OLD_SAVE = { v: 1, day: 1, coins: 40, lifetimeCoins: 40, stars: 0, kit: {}, int: {}, prem: {} };
let cloud = null;
const writes = [];

/* the bot: what a sensible player taps next (selectors of real buttons) */
function nextTap(state) {
  const session = state.session;
  if (!session) return null;
  const left = (customer) => Math.max(0, customer.arrivedAt + customer.patienceMs - session.t) / customer.patienceMs;
  const wanted = session.customers.slice().sort((a, b) => left(a) - left(b)).flatMap((customer) => customer.left);
  const count = (list, id) => list.filter((entry) => entry === id).length;
  const onTray = session.tray.map((item) => item.id);
  const recipes = { burger: [1, []], cheeseburger: [1, ["cheese"]], greenBurger: [1, ["lettuce"]], tomatoBurger: [1, ["tomato"]], deluxeBurger: [1, ["cheese", "lettuce", "tomato"]], doubleBurger: [2, ["cheese"]] };
  const trayIndex = session.tray.findIndex((item) => wanted.includes(item.id));
  if (trayIndex >= 0) return `#tray .tray-slot:nth-child(${trayIndex + 1})`;
  let index = session.grill.findIndex((slot) => slot.state === "burnt");
  if (index >= 0) return `#grill .slot:nth-child(${index + 1})`;
  index = session.fryer.findIndex((slot) => slot.state === "ready" || slot.state === "burnt");
  if (index >= 0) return `#fryer .slot:nth-child(${index + 1})`;
  index = session.drinks.findIndex((slot) => slot.state === "ready");
  if (index >= 0) return `#drinks .slot:nth-child(${index + 1})`;
  const burgers = wanted.filter((id) => recipes[id]);
  const missing = burgers.filter((id, k) => count(burgers.slice(0, k + 1), id) > count(onTray, id));
  const target = recipes[missing[0]];
  const board = session.board;
  if (target) {
    if (board.patties > target[0] || board.toppings.some((topping) => !target[1].includes(topping))) return "#trashButton";
    if (board.patties === target[0]) {
      const topping = target[1].find((entry) => !board.toppings.includes(entry));
      return topping ? `.topping[data-item=${topping}]` : "#plateButton";
    }
    index = session.grill.findIndex((slot) => slot.state === "ready");
    if (index >= 0) return `#grill .slot:nth-child(${index + 1})`;
  }
  const patties = missing.reduce((sum, id) => sum + recipes[id][0], 0) - board.patties;
  const busy = session.grill.filter((slot) => slot.state === "cooking" || slot.state === "ready").length;
  index = session.grill.findIndex((slot) => slot.state === "empty");
  if (index >= 0 && busy < Math.max(patties, 1)) return `#grill .slot:nth-child(${index + 1})`;
  const fries = count(wanted, "fries") - count(onTray, "fries") - session.fryer.filter((slot) => slot.state !== "empty").length;
  index = session.fryer.findIndex((slot) => slot.state === "empty");
  if (index >= 0 && fries > 0) return `#fryer .slot:nth-child(${index + 1})`;
  for (const drink of ["cola", "lemonade", "shake"]) {
    const need = count(wanted, drink) - count(onTray, drink) - session.drinks.filter((slot) => slot.item === drink).length;
    if (need > 0 && session.drinks.some((slot) => slot.state === "empty")) return `.drink-button[data-item=${drink}]`;
  }
  return null;
}

export const flow = {
  name: "burger",
  touch: true,
  viewport: { width: 1080, height: 810 },
  backend: {
    tables: {
      game_saves: ({ method, body }) => {
        if (method === "GET") return cloud ? [{ data: cloud }] : [];
        const row = Array.isArray(body) ? body[0] : body;
        if (row?.data) { writes.push(row.data); cloud = row.data; }
        return [];
      },
    },
  },
  async run(h) {
    const { page } = h;
    const frame = async () => (await page.$("#gf")).contentFrame();
    const state = async () => (await frame()).evaluate(() => window.__burgerTest.state());
    const local = () => page.evaluate(() => JSON.parse(localStorage.getItem("pb_save_burger") || "null"));
    const tap = async (selector) => {
      const f = await frame();
      const box = await f.$eval(selector, (node) => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      const offset = await (await page.$("#gf")).boundingBox();
      await page.touchscreen.tap(offset.x + box.x, offset.y + box.y);
    };
    const deliver = (save) => page.evaluate((data) => document.getElementById("gf").contentWindow.postMessage({ __pbLoadSave: 1, data }, "*"), save);
    const open = async () => {
      await h.goto("/pixelbreak.html?g=burger&burgerTest=1");
      await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.__burgerTest);
      await h.pause(1500);   // the hub fetches the cloud copy and hands it over
    };
    async function playDay(label) {
      await tap("#startButton");
      await (await frame()).evaluate((speed) => window.__burgerTest.speed(speed), SPEED);
      const started = Date.now();
      let taps = 0, idle = 0;
      for (;;) {
        const current = await state();
        if (current.screen !== "playing" || Date.now() - started > 60_000) break;
        const selector = nextTap(current);
        if (selector) { await tap(selector); taps += 1; } else { idle += 1; await h.pause(60); }
      }
      await h.pause(500);
      const after = await state();
      h.expect(after.screen === "summary", `${label}: the day ended with the summary (${after.screen}), ${taps} touch taps`);
      return after;
    }

    h.step("an old save (v:1, no tb) loads unchanged, and nothing is pushed at boot");
    await h.signIn();
    await h.goto("/pixelbreak.html");
    await page.evaluate((save) => localStorage.setItem("pb_save_burger", JSON.stringify(save)), OLD_SAVE);
    cloud = null;
    await open();
    let s = await state();
    h.eq([s.progress.day, s.progress.coins, s.progress.lifetimeCoins], [1, 40, 40], "old local save loaded");
    h.eq(writes.length, 0, "no cloud write at boot");
    h.expect((await (await frame()).$eval("#hudCoins", (n) => n.textContent)) === "40", "HUD shows the coins");

    h.step("day 1, played with touch");
    s = await playDay("day 1");
    const earned1 = s.session.result.earned;
    h.expect(s.session.result.hasPassed && earned1 >= 70, `day 1 passed: ${earned1} coins (goal 70)`);
    h.eq([s.progress.day, s.progress.coins, s.progress.lifetimeCoins], [2, 40 + earned1, 40 + earned1], "money: coins and lifetimeCoins grew by the day's earnings");
    await h.pause(400);
    let saved = await local();
    h.eq([saved?.day, saved?.lifetimeCoins, saved?.tb], [2, 40 + earned1, 40 + earned1], "local save written at the day end with tb");
    h.eq(Number(await page.evaluate(() => localStorage.getItem("pb_best_burger"))), 40 + earned1, "arcade best = lifetimeCoins");
    const summary = await (await frame()).$eval("#panelTitle", (n) => n.textContent);
    h.expect(/gepackt/.test(summary), `summary says «${summary}»`);
    await h.pause(3500);   // the hub's 3 s cloud debounce
    h.eq(cloud?.lifetimeCoins, 40 + earned1, "cloud row has the new progress");

    h.step("double cloud delivery: an older copy and the newest push, both orders");
    const best = s.progress;
    await deliver({ ...OLD_SAVE });
    await deliver({ ...best, kit: {}, coins: best.coins, tb: best.lifetimeCoins });
    await h.pause(200);
    s = await state();
    h.eq(s.progress.lifetimeCoins, best.lifetimeCoins, "older copies change nothing");
    await deliver({ v: 1, ...best, lifetimeCoins: best.lifetimeCoins + 500, coins: best.coins + 500 });
    await deliver({ ...OLD_SAVE });
    await h.pause(200);
    s = await state();
    h.eq(s.progress.lifetimeCoins, best.lifetimeCoins + 500, "the better copy wins, whatever comes after it");

    h.step("buy an upgrade; an equal-lifetime copy without it does not undo it; a frame reload keeps it");
    await tap("#shopButton");
    await h.pause(300);
    await tap('[data-item="kit:grillSlots"]');
    await h.pause(300);
    s = await state();
    h.eq(s.progress.kit.grillSlots, 1, "grill slot bought");
    const afterBuy = s.progress;
    await deliver({ v: 1, ...afterBuy, kit: {}, coins: afterBuy.coins + 120 });
    await h.pause(200);
    h.eq((await state()).progress.kit.grillSlots, 1, "equal lifetime without the purchase: purchase kept");
    await page.evaluate(() => document.getElementById("gf").contentWindow.location.reload());
    await page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.__burgerTest);
    await h.pause(800);
    s = await state();
    h.eq([s.progress.kit.grillSlots, s.progress.lifetimeCoins], [1, afterBuy.lifetimeCoins], "after the frame reload (stale injected save): purchase and coins kept");

    h.step("day 2: a better save mid-day keeps the day running; hidden pauses; restart keeps the coins");
    await tap("#startButton");
    await h.pause(1200);
    s = await state();
    h.eq(s.screen, "playing", "day 2 running");
    const midBetter = { ...s.progress, lifetimeCoins: s.progress.lifetimeCoins + 1000, coins: s.progress.coins + 1000 };
    await deliver(midBetter);
    await h.pause(200);
    s = await state();
    h.expect(s.screen === "playing" && s.progress.lifetimeCoins >= midBetter.lifetimeCoins, "better save adopted, day still running");
    await (await frame()).evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await h.pause(200);
    const paused = await state();
    h.eq(paused.screen, "paused", "hidden page pauses the day");
    await h.pause(1200);
    h.eq((await state()).session.t, paused.session.t, "the clock stands still while paused");
    await (await frame()).evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    h.eq((await (await frame()).$eval("#panelTitle", (n) => n.textContent)), "Paus", "pause panel shown on return");
    await tap("#startButton");
    h.eq((await state()).screen, "playing", "Weider resumes");
    const beforeRestart = (await state()).progress;
    await page.click(".arcade-bar__restart");
    await h.pause(300);
    s = await state();
    h.expect(s.screen === "intro" && s.progress.lifetimeCoins === beforeRestart.lifetimeCoins && s.progress.day === 2, "arcade restart: back to the day start, coins kept");

    h.step("mute, rotate");
    await page.click(".arcade-bar__mute");
    await h.pause(200);
    h.eq(await (await frame()).evaluate(() => window.__burgerTest.muted()), true, "arcade mute reaches the game");
    await page.click(".arcade-bar__mute");
    await page.setViewportSize({ width: 810, height: 1080 });
    await h.pause(500);
    const layout = await (await frame()).evaluate(() => {
      const root = document.documentElement, kitchen = document.querySelector(".kitchen").getBoundingClientRect();
      return { overflow: root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight, kitchenBottom: kitchen.bottom, height: innerHeight };
    });
    h.expect(!layout.overflow && layout.kitchenBottom <= layout.height + 1, `portrait: no overflow, kitchen inside (${Math.round(layout.kitchenBottom)} <= ${layout.height})`);
    await page.setViewportSize({ width: 1080, height: 810 });
    await h.pause(300);

    h.step("day 2, played to the end");
    const startDay2 = (await state()).progress.lifetimeCoins;
    s = await playDay("day 2");
    const earned2 = s.session.result.earned;
    h.expect(s.session.result.hasPassed, `day 2 passed: ${earned2} coins (goal ${s.session.result.goal})`);
    h.eq(s.progress.lifetimeCoins, startDay2 + earned2, "lifetimeCoins grew by day 2's earnings");
    saved = await local();
    h.eq([saved?.day, saved?.lifetimeCoins], [3, s.progress.lifetimeCoins], "local save after day 2");

    h.step("page reload: everything back from the save");
    await h.pause(3500);
    await open();
    s = await state();
    h.eq([s.progress.day, s.progress.lifetimeCoins, s.progress.kit.grillSlots], [3, saved.lifetimeCoins, 1], "after a reload: day 3, coins, upgrade");
    h.expect(writes.every((data) => typeof data.tb === "number" && data.tb === data.lifetimeCoins), `every cloud write carries tb (${writes.length} writes)`);
    h.expect(writes.length <= 8, `few cloud writes for two days (${writes.length})`);
  },
};
runIfMain(import.meta.url, flow);
