/* Real iframe interactions with local saves and mocked event RPCs. */
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const EVENT = "halloween-2026";
const status = (count) => ({ event: EVENT, starts_at: "2026-10-24T00:00:00+02:00", ends_at: "2026-11-03T00:00:00+01:00", active: true, goal: 50, count, badge: count >= 50 });
let caught = 49;
let eventCalls = [];
const tags = [{ user_id: ME, username: ME_NAME, badges: [EVENT], streak: 5 }];

async function frame(h) {
  await h.page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.document.querySelector(".idle-rebirth"));
  return h.page.frames().find((candidate) => candidate.parentFrame());
}
async function noOverflow(h, game, label) {
  h.expect(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: parent fits 390px`);
  h.expect(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: game fits 390px`);
}

export const flow = {
  name: "idle-rebirth-halloween", touch: true,
  backend: { rpc: {
    touch_streak: () => ({ streak: 5, best: 9, is_new_day: false }),
    event_status: () => status(caught),
    add_event_progress: ({ p_count }) => { eventCalls.push({ time: Date.now(), count: p_count }); caught += p_count; return status(caught); },
    leaderboard_tags: () => tags,
  } },
  async run(h) {
    caught = 49;
    eventCalls = [];
    const { page } = h;
    await h.signIn();
    await h.context.addInitScript(() => {
      if (sessionStorage.getItem("idle-flow-seeded")) return;
      sessionStorage.setItem("idle-flow-seeded", "1");
      localStorage.setItem("pb_save_cookie-clicker", JSON.stringify({ v: 1, c: 500e9, tb: 4e12, tc: 20,
        u: Array.from({ length: 16 }, (_, i) => i === 11 ? 2 : 0), cu: [2, 0, 0, 0, 0, 0] }));
    });
    h.step("old 16-slot save and rebirth confirmation");
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    let game = await frame(h);
    h.eq(await game.evaluate(() => snapshot().u), Array.from({ length: 17 }, (_, i) => i === 11 ? 2 : 0), "old buildings preserved and new slot padded");
    h.eq(await game.evaluate(() => snapshot().cu), [2, 0, 0, 0, 0, 0], "old click upgrades preserved");
    await game.locator('.upgrade[data-type="cps"][data-i="16"]').click();
    await game.locator(".idle-rebirth").click();
    const before = await game.evaluate(() => ({ tb: totalBaked, buildings: snapshot().u }));
    await game.locator(".idle-cancel").click();
    h.eq(await game.evaluate(() => snapshot().u), before.buildings, "cancel resets nothing");
    await game.locator(".idle-rebirth").click();
    h.expect((await game.locator(".idle-reset").innerText()).includes("Time Machines"), "dialog explains gifted building reset");
    h.expect((await game.locator(".idle-keep").innerText()).includes("leaderboard"), "dialog explains lifetime preservation");
    // Confirm with no production tick between the captured lifetime and the action.
    const reset = await game.evaluate(() => {
      const before = totalBaked;
      document.querySelector(".idle-confirm").click();
      return { before, after: totalBaked, save: snapshot() };
    });
    h.eq(reset.after, reset.before, "rebirth keeps exact lifetime tb");
    h.eq(reset.save.st, 2, "4T round adds two stars");
    h.eq(reset.save.rbc, 1, "rebirth count saved");
    h.expect(reset.save.u.slice(0, 16).every((n) => n === 0) && reset.save.cu.every((n) => n === 0), "ordinary and gifted buildings and click upgrades reset");
    h.eq(reset.save.u[16], 1, "Haunted Oven survives rebirth");
    h.eq(await game.evaluate(() => cps), 48e6, "two stars give +20% production");

    h.step("offline cap and daily gift");
    await page.evaluate(() => {
      localStorage.setItem("pb_save_cookie-clicker", JSON.stringify({ v: 1, c: 100, tb: 100, rb: 100, st: 0, rbc: 0,
        u: [0, 1], cu: [], savedAt: Date.now() - 24 * 3600 * 1000 }));
    });
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    game = await frame(h);
    const offline = await game.evaluate(() => snapshot());
    h.expect(offline.tb >= 14500 && offline.tb < 14510 && offline.rb >= 14500, "offline grants eight hours at 50% into lifetime and round");
    h.expect((await game.locator(".idle-away").innerText()).includes("8 h max"), "offline notice shows cap");
    await game.locator(".idle-gift:not([hidden])").waitFor();
    h.expect((await game.locator(".idle-gift").innerText()).includes("1.4× · 🔥 5"), "gift displays streak multiplier");
    const gift = await game.evaluate(() => { const before = totalBaked; document.querySelector(".idle-gift").click(); return { amount: totalBaked - before, day: snapshot().gd }; });
    h.eq(gift.amount, 840, "daily gift gives ten minutes times 1.4");
    h.expect(!(await game.locator(".idle-gift").isVisible()), "gift hidden after claiming");
    await h.pause(100);
    await h.goto("/pixelbreak.html?g=cookie-clicker&halloween=1");
    game = await frame(h);
    h.eq(await game.evaluate(() => snapshot().gd), gift.day, "gift day persisted across reopen");
    await h.pause(300);
    h.expect(!(await game.locator(".idle-gift").isVisible()), "gift remains hidden on same day");
    h.eq(await game.evaluate(() => IdleExtras.offline(0, Date.now() + 10000, 1).credited), 0, "backwards clock credits zero");
    h.eq(await game.evaluate(() => IdleExtras.offline(20, 0, 1, 86400000)), { seconds: 43200, capHours: 12, credited: 43200 }, "stars cap offline at twelve hours and 100%");

    h.step("pumpkin tap and parent event progress");
    await game.locator(".idle-pumpkin").waitFor({ timeout: 95000 });
    await game.locator(".idle-pumpkin").tap({ force: true });
    await page.waitForFunction(() => document.getElementById("pbEventChip")?.textContent === "🎃 50 / 50");
    h.eq(h.backend.callsTo("add_event_progress")[0].body, { p_event: EVENT, p_count: 1 }, "parent submits pumpkin through restricted event RPC");
    h.expect((await page.locator("#pbStreakToast").innerText()).includes("Halloween"), "badge award toast appears");
    await game.evaluate(() => {
      parent.postMessage({ __pbEvent: { event: 'halloween-2026', count: 5 } }, '*');
      parent.postMessage({ __pbEvent: { event: 'halloween-2026', count: 2 } }, '*');
    });
    await h.pause(100);
    await page.evaluate(() => closeGame());
    // The mock call log belongs to the runner, rather than the browser window.
    for (let retry = 0; retry < 30 && eventCalls.length < 3; retry++) await h.pause(500);
    h.eq(eventCalls.map((call) => call.count), [1, 5, 2], "queue retains remainder and flushes after game close");
    h.expect(eventCalls.slice(1).every((call, i) => call.time - eventCalls[i].time >= 5900), "event calls are spaced six seconds apart");
    await page.evaluate(() => openGame(gameIdxById('cookie-clicker')));
    game = await frame(h);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(h, game, "Halloween Cookie Clicker");
    await h.shot("cookie-phone");

    h.step("Business Empire stars, offline and gift");
    await page.evaluate(() => localStorage.setItem("pb_save_idle-empire", JSON.stringify({ v: 1, cash: 100, lifetime: 100e9, rb: 100e9,
      owned: { lemonade: 1 }, managers: { lemonade: true }, investors: 2, ts: Date.now() - 86400000 })));
    await h.goto("/pixelbreak.html?g=idle-empire&halloween=1");
    game = await frame(h);
    h.expect((await game.locator(".idle-away").innerText()).includes("8 h max"), "legacy Empire timestamp gets new offline cap");
    await game.locator(".idle-gift:not([hidden])").waitFor();
    await game.locator(".idle-gift").click();
    h.expect(!(await game.locator(".idle-gift").isVisible()), "Empire daily gift claimed once");
    await game.locator(".idle-rebirth").click();
    const empire = await game.evaluate(() => {
      const before = state.lifetime; document.querySelector(".idle-confirm").click();
      return { before, after: state.lifetime, save: snapshot() };
    });
    h.eq(empire.after, empire.before, "Empire rebirth preserves lifetime");
    h.eq(empire.save.st, 1, "$100B round earns one star");
    h.eq(empire.save.investors, 2, "existing investors stay");
    h.expect(Object.values(empire.save.owned).every((n) => n === 0), "Empire businesses reset");
    await noOverflow(h, game, "Halloween Empire");
    await h.shot("empire-phone");
    for (const mode of ['light', 'dark']) {
      await page.evaluate((theme) => localStorage.setItem('site_theme', JSON.stringify({ mode: theme })), mode);
      await page.setViewportSize({ width: 820, height: 1180 });
      await h.goto('/pixelbreak.html?g=idle-empire');
      game = await frame(h);
      h.expect(await game.locator('.idle-stars').isVisible(), `${mode}: stars visible at 820px`);
      await h.shot(`empire-${mode}-ipad`);
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(h, game, `${mode} Empire`);
    }

    h.step("permanent badge identity and profile");
    await h.goto("/profile.html");
    await page.waitForSelector('#eventBadges [title="Halloween 2026"]');
    h.eq(await page.locator("#eventBadges").innerText(), "🎃 Halloween 2026", "profile lists permanent badge");
    const tag = await page.evaluate(async () => {
      const { tagsHtml } = await import('./leaderboard-tags.js');
      return tagsHtml({ badges: ['halloween-2026'] });
    });
    h.expect(tag.includes('title="Halloween 2026"') && tag.includes('🎃'), "leaderboard tag renders mapped badge");
  },
};
runIfMain(import.meta.url, flow);
