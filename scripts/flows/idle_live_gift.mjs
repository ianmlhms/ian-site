/* Live admin gifts for the idle games (game_gifts, scripts/game-gifts-v1.sql) — Business Empire, Cookie Clicker, Bus Tycoon.
 * The arcade page claims the gifts of the OPEN game and posts them into the frame; the game adds them to its main balance only
 * (never lifetime), remembers the id in its save (giftIds), saves, toasts and answers; the page acknowledges.
 *
 * Per game:
 *   - ORDER: the cloud save is slow to load; a gift that is already pending must be claimed only AFTER the cloud save reached the
 *     game, and the finished balance is cloud + gift (the cloud save never wipes it)
 *   - the gift: balance +amount, lifetime untouched, giftIds saved, toast in the site language (lb / de / en), ack sent
 *   - a `gift` command for the open game is run at once by the presence ping, without waiting for commandsSafe() (a draft in a
 *     focused field must not delay it); a command for another game claims nothing
 *   - the same gift delivered a second time (lost ack) changes nothing and is acknowledged again
 *   - the next save carries the gift to the cloud (game_saves upsert)
 * Supabase is entirely mocked; all saves are invented. */
import { createClientCommandsMock, runIfMain, sleep } from "./lib.mjs";

const CLOUD_DELAY_MS = 2500;
const GIFT_AMOUNT = 2500;
const SECOND_AMOUNT = 400;
const BUSINESS_IDS = ["lemonade", "newspaper", "carwash", "pizzeria", "donut", "shrimp", "hockey", "studio", "bank", "oil",
  "airline", "port", "tech", "space", "moon", "asteroid", "dyson", "galaxy"];
const stamp = () => Date.now();

/* Each game: the cloud save (no production, so balances only move by gifts), the save fields, the language to test. */
const GAMES = [
  { id: "idle-empire", lang: "lb", toast: /^🎁 Kaddo: \+2\.5K Cash$/, main: "cash", life: "lifetime", cloudMain: 1000, cloudLife: 5000, wait: ".business",
    cloud: () => ({ v: 1, cash: 1000, lifetime: 5000, tb: 5000, rb: 5000, investors: 0, st: 0, rbc: 0, gd: "", sc: 0, rs: 1, ts: stamp(), savedAt: stamp(),
      owned: Object.fromEntries(BUSINESS_IDS.map((id) => [id, 0])), managers: Object.fromEntries(BUSINESS_IDS.map((id) => [id, false])) }) },
  { id: "cookie-clicker", lang: "de", toast: /^🎁 Geschenk: \+2\.5K Cookies$/, main: "c", life: "tb", cloudMain: 1000, cloudLife: 5000, wait: "#cc",
    cloud: () => ({ v: 1, c: 1000, tb: 5000, tc: 0, rb: 5000, st: 0, rbc: 0, gd: "", rs: 1, savedAt: stamp(), u: [], cu: [] }) },
  { id: "bus-tycoon", lang: "en", toast: /^🎁 Gift: \+2\.5K passengers$/, main: "p", life: "tb", cloudMain: 1000, cloudLife: 5000, wait: "#wave",
    cloud: () => ({ v: 1, p: 1000, tb: 5000, rb: 5000, st: 0, rbc: 0, rs: 1, gd: "", savedAt: stamp(), drivers: 0, owned: {}, upgrades: [] }) },
];

const world = {};
function resetWorld(game) {
  Object.assign(world, { game, pending: [], redeliver: [], log: [], claims: [], acks: [], upserts: [], cloud: game.cloud() });
}

const commands = createClientCommandsMock({ repeat: true });

async function frameOf(h, selector) {
  await h.page.waitForFunction((sel) => document.getElementById("gf")?.contentWindow?.document.querySelector(sel), selector, { timeout: 15000 });
  return h.page.frames().find((candidate) => candidate.parentFrame());
}
const localSave = (h, id) => h.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), `pb_save_${id}`);
async function saveWhere(h, id, test, message) {
  await h.page.waitForFunction(([key, source]) => {
    try { return new Function("save", `return (${source})(save)`)(JSON.parse(localStorage.getItem(key) || "null")); } catch { return false; }
  }, [`pb_save_${id}`, test.toString()], { timeout: 10000 }).catch(() => {});
  const save = await localSave(h, id);
  h.expect(!!save && test(save), message);
  return save;
}
async function tick(h) {
  const response = h.page.waitForResponse((r) => r.url().includes("/rpc/client_commands_since"));
  await h.page.evaluate(() => window.__presenceTicks[0]());
  await response;
  await h.pause(300);
}

export const flow = {
  name: "idle-live-gift",
  backend: {
    tables: {
      game_saves: async ({ method, body }) => {
        if (method === "GET") {
          await sleep(CLOUD_DELAY_MS);
          world.log.push("cloud-save-sent");
          return [{ data: world.cloud }];
        }
        if (body) world.upserts.push(body);
        return [];
      },
    },
    rpc: {
      ...commands.rpc,
      claim_game_gifts: ({ p_game }) => {
        world.log.push("claim");
        const redelivered = world.redeliver.splice(0);
        const fresh = world.pending.filter((gift) => gift.game === p_game);
        world.pending = world.pending.filter((gift) => gift.game !== p_game);
        const out = [...redelivered, ...fresh].map(({ id, amount }) => ({ id, amount }));
        world.claims.push(out);
        return out;
      },
      ack_game_gift: ({ p_id }) => { world.acks.push(p_id); return true; },
    },
  },
  async run(h) {
    const { page, context } = h;
    await h.signIn();
    await context.addInitScript(() => {
      window.__presenceTicks = [];
      const interval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 60_000 && /\bping\(/.test(String(callback))) window.__presenceTicks.push(() => callback(...args));
        return interval(callback, delay, ...args);
      };
    });

    for (const game of GAMES) {
      resetWorld(game);
      await context.addInitScript((lang) => localStorage.setItem("site_lang", lang), game.lang);
      const waitReady = () => page.waitForFunction(() => window.__ianCommands && window.__presenceTicks?.length);

      h.step(`${game.id}: a gift that is already pending waits for the slow cloud save, then lands on top of it`);
      world.pending.push({ id: 7, game: game.id, amount: GIFT_AMOUNT });
      await h.goto(`/pixelbreak.html?g=${game.id}`);
      const frame = await frameOf(h, game.wait);
      h.eq(world.log, [], "nothing claimed while the cloud save is still loading");
      await waitReady();
      await page.waitForFunction(() => document.querySelector("#gf")?.contentWindow?.document.querySelector(".idle-gift-toast"), null, { timeout: 15000 });
      h.eq(world.log, ["cloud-save-sent", "claim"], "the claim came after the cloud save was sent");
      const first = await saveWhere(h, game.id, (save) => Array.isArray(save.giftIds) && save.giftIds.includes(7), "gift id 7 is in the save");
      h.eq(first?.[game.main], game.cloudMain + GIFT_AMOUNT, "balance = cloud save + gift (the cloud save did not wipe it)");
      h.eq(first?.[game.life], game.cloudLife, "lifetime total untouched");
      h.eq(first?.giftIds, [7], "giftIds holds the id");
      h.expect(game.toast.test(await frame.locator(".idle-gift-toast").first().innerText()), `toast in ${game.lang}: ${await frame.locator(".idle-gift-toast").first().innerText()}`);
      h.eq(world.acks, [7], "the page acknowledged the gift");

      h.step(`${game.id}: the next save reaches the cloud with the gift`);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !world.upserts.some((row) => row.data?.giftIds?.includes(7))) await h.pause(250);
      const upsert = world.upserts.find((row) => row.data?.giftIds?.includes(7));
      h.expect(!!upsert, "game_saves upsert carries giftIds");
      h.eq(upsert?.data?.[game.main], game.cloudMain + GIFT_AMOUNT, "cloud copy has the gifted balance");

      h.step(`${game.id}: a gift command for the open game runs at once, even with a draft in a focused field`);
      await page.evaluate(() => {
        const field = document.createElement("textarea");
        field.id = "giftDraft";
        field.value = "unfinished message";
        document.body.appendChild(field);
        field.focus();
      });
      world.pending.push({ id: 8, game: game.id, amount: SECOND_AMOUNT });
      commands.add("gift", game.id);
      await tick(h);
      const second = await saveWhere(h, game.id, (save) => save.giftIds?.includes(8), "gift id 8 landed");
      h.eq(second?.[game.main], game.cloudMain + GIFT_AMOUNT + SECOND_AMOUNT, "balance went up by the second gift");
      h.eq(second?.[game.life], game.cloudLife, "lifetime still untouched");
      h.eq(second?.giftIds, [7, 8], "both ids kept");
      h.eq(world.acks, [7, 8], "second gift acknowledged");

      h.step(`${game.id}: a command for another game claims nothing`);
      const claimsBefore = world.claims.length;
      world.pending.push({ id: 9, game: game.id, amount: 1 });
      commands.add("gift", game.id === "idle-empire" ? "bus-tycoon" : "idle-empire");
      await tick(h);
      h.eq(world.claims.length, claimsBefore, "no claim for a foreign game command");
      world.pending = world.pending.filter((gift) => gift.id !== 9);
      await page.evaluate(() => document.getElementById("giftDraft")?.remove());

      h.step(`${game.id}: delivering the same gift again (lost ack) pays nothing and is acknowledged again`);
      world.redeliver.push({ id: 8, amount: SECOND_AMOUNT });
      await page.evaluate(() => window.__pbDeliverGifts());
      const waitAck = Date.now() + 5000;
      while (Date.now() < waitAck && world.acks.length < 3) await h.pause(100);
      h.eq(world.acks, [7, 8, 8], "acknowledged again");
      const third = await localSave(h, game.id);
      h.eq(third?.[game.main], game.cloudMain + GIFT_AMOUNT + SECOND_AMOUNT, "balance unchanged by the repeat");
      h.eq(third?.giftIds, [7, 8], "ids unchanged by the repeat");

      h.step(`${game.id}: closing and reopening keeps the ids (a lost-ack redelivery after a reload is still ignored)`);
      world.cloud = third;
      world.redeliver.push({ id: 7, amount: GIFT_AMOUNT });
      world.log.length = 0;
      await h.goto(`/pixelbreak.html?g=${game.id}`);
      await frameOf(h, game.wait);
      await waitReady();
      const waitRepeat = Date.now() + 15000;
      while (Date.now() < waitRepeat && world.acks.length < 4) await h.pause(150);
      h.eq(world.acks, [7, 8, 8, 7], "reopened game acknowledged the old id without paying");
      const fourth = await localSave(h, game.id);
      h.eq(fourth?.[game.main], game.cloudMain + GIFT_AMOUNT + SECOND_AMOUNT, "balance unchanged after the reopen");
      h.eq(await page.locator("#gf").evaluate((el) => el.contentWindow.document.querySelectorAll(".idle-gift-toast").length), 0, "no toast for a repeat");
    }
  },
};

runIfMain(import.meta.url, flow);
