/* Game invites reach you on every page (invite-pop.js, loaded by auth.js):
 *   popup       anywhere that is not a live game, Join / Decline / Later (Esc + backdrop = Later)
 *   top banner  while a game runs (arcade game in pixelbreak.html's frame, a Kart race): slim, auto-hides, tap → Join / Later sheet
 * plus: one popup across two open tabs, the queue, expiry, the offline invite shown once on the next page load, texts in lb / de / en,
 * and the cost per page load (REST requests + Realtime joins; there is no polling).
 * Three Realtime-hub players, nothing reaches the live project. Set INVITE_POP_REPORT=/path.json to keep the numbers. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, sleep, shotter } from "./mp_lobby_lib.mjs";

const NAME = "invite-pop";
const REPORT = {};
const SIZES = { desktop: { width: 1280, height: 800 }, "ipad-landscape": { width: 1180, height: 820 }, "ipad-portrait": { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };

const until = async (fn, ms = 10000, step = 100) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(step); } };
const listening = (hub, uid) => [...hub.topics].some(([topic, mem]) => /invites-/.test(topic) && [...mem].some(([conn, m]) => conn.uid === uid && m.pg.some((p) => p.table === "game_invites")));
const invitesChannels = (hub, uid) => [...hub.topics].filter(([topic, mem]) => /invites-/.test(topic) && [...mem.keys()].some((c) => c.uid === uid)).length;

/** what mp_invite / invite_game_room do in the database + what Realtime does afterwards (push=false: the person has no page open) */
function sendInvite(world, { game = "connect4", room = "abcd", from = USERS.ian, to = USERS.emma, push = true, ageMs = 0 } = {}) {
  const row = { id: world.seq++, from_user: from.id, from_name: from.username, to_user: to.id, game, room, status: "pending", created_at: new Date(Date.now() - ageMs).toISOString() };
  world.invites.push(row);
  if (push) world.hub.pushInsert("game_invites", row, to.id);
  return row;
}
const popup = (page) => page.locator(".ip-card");
const statusOf = (world, id) => world.invites.find((i) => i.id === id)?.status;
const cost = (player, hub) => ({ rest: player.http.length, restCalls: [...player.http], realtimeJoins: hub.stats.joins, topics: [...hub.stats.topicsSeen] });

export const flow = {
  name: NAME,
  fullChromium: true,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub });
    const rawShot = shotter(NAME);
    const shot = async (player, label) => { await sleep(450); await rawShot(player, label); };   // let the fade-in finish
    const players = [];
    const errorsOf = [];
    try {
      /* ---------------- (a) home page: popup, Join → lobby ---------------- */
      h.step("(a) Emma on the home page: an invite pops up in the middle; Join goes to the lobby");
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, first: true }); players.push(emma);
      hub.reset();
      await emma.page.goto(h.origin + "/index.html", { waitUntil: "domcontentloaded" });
      h.expect(await until(() => listening(hub, USERS.emma.id)), "the invite listener is up on the home page");
      await until(() => emma.http.some((c) => /my_game_invites/.test(c)), 6000);
      await sleep(800);
      REPORT.homeIdleCost = cost(emma, hub);
      h.eq(REPORT.homeIdleCost.restCalls.filter((c) => /my_game_invites/.test(c)).length, 1, "first load: ONE my_game_invites catch-up call");
      h.eq(invitesChannels(hub, USERS.emma.id), 1, "exactly one invites channel for the tab");
      const first = sendInvite(world, { game: "connect4", room: "abcd" });
      await popup(emma.page).waitFor({ timeout: 20000 });
      h.expect(await emma.page.locator(".ip-ov").count() === 1 && await emma.page.locator(".ip-top").count() === 0, "popup only, no banner");
      const title = await emma.page.locator(".ip-title").innerText();
      h.expect(/tester/.test(title) && /Connect 4/.test(title), `names the sender and the game (${title})`);
      h.expect(/invitéiert/.test(title), "Luxembourgish by default");
      h.expect(await emma.page.evaluate(() => document.activeElement?.textContent === "Bäitrieden"), "Join has the focus");
      h.expect(await emma.page.locator('.ip-card[role="dialog"][aria-modal="true"]').count() === 1, "it is a modal dialog for screen readers");
      await shot(emma, "popup-lb");
      await emma.page.locator(".ip-primary").click();
      await emma.page.waitForURL(/lobby\.html\?g=connect4&c=ABCD/, { timeout: 20000 });
      h.expect(true, "Join → lobby.html?g=connect4&c=ABCD");
      h.eq(statusOf(world, first.id), "accepted", "the invite is marked accepted");
      await emma.page.waitForSelector("#mplRoster, #mplCreate", { timeout: 10000 });

      /* ---------------- (e) answers: Esc / Later / Decline, queue, expiry ---------------- */
      h.step("(e) Esc = Later (stays pending, never shown again), Decline, Later, a queue of two, expired ignored");
      await emma.page.goto(h.origin + "/about.html", { waitUntil: "domcontentloaded" });
      await until(() => listening(hub, USERS.emma.id));
      const a1 = sendInvite(world, { game: "tictactoe", room: "tt01" });
      await popup(emma.page).waitFor({ timeout: 20000 });
      await emma.page.keyboard.press("Escape");
      await popup(emma.page).waitFor({ state: "detached", timeout: 3000 });
      h.eq(statusOf(world, a1.id), "pending", "Esc leaves the invite pending (friends page still lists it)");
      const a2 = sendInvite(world, { game: "reversi", room: "rv02" });
      await popup(emma.page).waitFor({ timeout: 20000 });
      await emma.page.locator(".ip-ov").click({ position: { x: 4, y: 4 } });
      await popup(emma.page).waitFor({ state: "detached", timeout: 3000 });
      h.eq(statusOf(world, a2.id), "pending", "a click on the backdrop = Later");
      const a3 = sendInvite(world, { game: "checkers", room: "ck03" });
      await popup(emma.page).waitFor({ timeout: 20000 });
      await emma.page.getByRole("button", { name: "Ofleenen" }).click();
      await popup(emma.page).waitFor({ state: "detached", timeout: 3000 });
      await until(() => statusOf(world, a3.id) === "declined", 3000);
      h.eq(statusOf(world, a3.id), "declined", "Decline → status declined");
      const a4 = sendInvite(world, { game: "dots", room: "dt04" });
      await popup(emma.page).waitFor({ timeout: 20000 });
      await emma.page.getByRole("button", { name: "Méi spéit" }).click();
      await popup(emma.page).waitFor({ state: "detached", timeout: 3000 });
      h.eq(statusOf(world, a4.id), "pending", "Later keeps it pending");
      sendInvite(world, { game: "maumau", room: "mm05", ageMs: 13 * 3600e3 });
      await sleep(600);
      h.eq(await popup(emma.page).count(), 0, "an invite older than 12 h is ignored");
      const q1 = sendInvite(world, { game: "battleship", room: "bs06", from: USERS.max });
      const q2 = sendInvite(world, { game: "color", room: "co07", from: USERS.lena });
      await popup(emma.page).waitFor({ timeout: 20000 });
      await sleep(400);
      h.eq(await emma.page.locator(".ip-card").count(), 1, "two invites at once → one popup at a time");
      h.expect(await emma.page.locator(".ip-more").isVisible(), `the popup says one more is waiting («${await emma.page.locator(".ip-more").innerText()}»)`);
      const firstShown = await emma.page.locator(".ip-title").innerText();
      await emma.page.keyboard.press("Escape");
      await sleep(600);
      await popup(emma.page).waitFor({ timeout: 4000 });
      const secondShown = await emma.page.locator(".ip-title").innerText();
      h.expect(firstShown !== secondShown && [firstShown, secondShown].some((t) => /Max/.test(t)) && [firstShown, secondShown].some((t) => /Lena/.test(t)), `the second invite follows (${firstShown} → ${secondShown})`);
      await emma.page.keyboard.press("Escape");
      await sleep(300);

      h.step("(e) German + English texts, Luxembourgish default; Tab stays inside the dialog");
      for (const [lang, re] of [["de", /hat dich zu .* eingeladen/], ["en", /invited you to/]]) {
        await emma.page.evaluate((l) => (window.I18N ? window.I18N.set(l) : localStorage.setItem("site_lang", l)), lang);
        sendInvite(world, { game: "slf", room: "sl" + lang, from: USERS.max });
        await popup(emma.page).waitFor({ timeout: 20000 });
        const t = await emma.page.locator(".ip-title").innerText();
        h.expect(re.test(t), `${lang}: «${t}»`);
        if (lang === "en") {
          const seen = new Set();
          for (let i = 0; i < 6; i++) { seen.add(await emma.page.evaluate(() => document.activeElement?.textContent)); await emma.page.keyboard.press("Tab"); }
          h.expect(seen.size === 3 && !seen.has(undefined), `Tab cycles through the three buttons only (${[...seen].join(", ")})`);
          await shot(emma, "popup-en");
        }
        await emma.page.keyboard.press("Escape");
        await sleep(300);
      }
      await emma.page.evaluate(() => (window.I18N ? window.I18N.set("lb") : localStorage.removeItem("site_lang")));

      /* ---------------- (f) offline invite, shown once on the next page load ---------------- */
      h.step("(f) Emmi was invited while no page of hers was open → shown once on her next page load, no second request after a reload");
      const emmi = await newPlayer(h, world, { label: "emmi", user: USERS.emmi }); players.push(emmi);
      const off = sendInvite(world, { game: "dice-duel", room: "dd08", from: USERS.max, to: USERS.emmi, push: false });
      sendInvite(world, { game: "dots", room: "old1", from: USERS.max, to: USERS.emmi, push: false, ageMs: 14 * 3600e3 });
      hub.reset();
      await emmi.page.goto(h.origin + "/leaderboard.html", { waitUntil: "domcontentloaded" });
      await popup(emmi.page).waitFor({ timeout: 10000 });
      h.eq(await emmi.page.locator(".ip-card").count(), 1, "one popup (the 14 h old invite stays away)");
      h.expect(/Kniffel/.test(await emmi.page.locator(".ip-title").innerText()), "the offline invite pops up after the load");
      REPORT.offlineLoadCost = cost(emmi, hub);
      h.eq(emmi.http.filter((c) => /my_game_invites/.test(c)).length, 1, "…from ONE my_game_invites call");
      await emmi.page.keyboard.press("Escape");
      emmi.http.length = 0;
      await emmi.page.reload({ waitUntil: "domcontentloaded" });
      await until(() => listening(hub, USERS.emmi.id));
      await sleep(1500);
      REPORT.reloadCost = cost(emmi, hub);
      h.eq(await popup(emmi.page).count(), 0, "after a reload the same invite does not pop up again");
      h.eq(emmi.http.filter((c) => /my_game_invites/.test(c)).length, 0, "…and a reload right after makes no catch-up call at all");
      h.eq(statusOf(world, off.id), "pending", "…it is still pending for the friends page");

      /* ---------------- (d) two tabs, one popup ---------------- */
      h.step("(d) two tabs of the same person open → exactly one popup");
      const twin = await newPlayer(h, world, { label: "lena-tabs", user: USERS.lena }); players.push(twin);
      await twin.page.goto(h.origin + "/index.html", { waitUntil: "domcontentloaded" });
      await until(() => listening(hub, USERS.lena.id));
      const tab2 = await twin.context.newPage();
      await tab2.goto(h.origin + "/friends.html", { waitUntil: "domcontentloaded" });
      const lenaTabs = () => [...hub.topics].filter(([t]) => /invites-/.test(t)).reduce((n, [, m]) => n + [...m.keys()].filter((c) => c.uid === USERS.lena.id).length, 0);
      await until(() => lenaTabs() >= 2, 15000);
      h.eq(lenaTabs(), 2, "both tabs hold their own invites channel (one per tab)");
      const d1 = sendInvite(world, { game: "dots", room: "dt09", from: USERS.max, to: USERS.lena });
      await until(async () => (await popup(twin.page).count()) + (await popup(tab2).count()) >= 1, 20000);
      await sleep(900);
      const shown = (await popup(twin.page).count()) + (await popup(tab2).count());
      h.eq(shown, 1, "one popup across both tabs");
      h.eq(statusOf(world, d1.id), "pending", "nothing answered by itself");
      const holder = (await popup(twin.page).count()) ? twin.page : tab2;
      await holder.keyboard.press("Escape");
      await sleep(400);
      h.eq((await popup(twin.page).count()) + (await popup(tab2).count()), 0, "answering it in one tab leaves nothing behind in the other");
      await tab2.close();
      d1.status = "declined";                                    // (Lena answered it elsewhere: the next scenario starts clean)

      /* ---------------- (b) arcade game running in the frame: banner only ---------------- */
      h.step("(b) Max plays Snake in the arcade: only the slim banner, the game keeps running; tap → sheet → Later");
      const max = await newPlayer(h, world, { label: "max", user: USERS.max }); players.push(max);
      await max.page.goto(h.origin + "/pixelbreak.html?g=snake", { waitUntil: "domcontentloaded" });
      await max.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!d && d.readyState === "complete" && d.body && d.body.children.length > 0; }, null, { timeout: 30000 });
      h.eq(await max.page.evaluate(() => document.documentElement.dataset.liveGame), "1", "the arcade shell flags a live game while a game is open");
      await until(() => listening(hub, USERS.max.id));
      REPORT.arcadeCost = cost(max, hub);
      const frameFocusBefore = await max.page.evaluate(() => document.activeElement?.id);
      const b1 = sendInvite(world, { game: "connect4", room: "bb01", from: USERS.emma, to: USERS.max });
      await max.page.locator(".ip-bar").waitFor({ timeout: 20000 });
      h.eq(await max.page.locator(".ip-ov").count(), 0, "no popup in front of the game");
      h.expect(/Emma/.test(await max.page.locator(".ip-bar").innerText()), `banner text: «${await max.page.locator(".ip-bar").innerText()}»`);
      h.eq(await max.page.evaluate(() => document.activeElement?.id), frameFocusBefore, "the banner did not take the focus");
      const ticks = await max.page.evaluate(() => new Promise((resolve) => { const w = document.getElementById("gf").contentWindow; let n = 0; const t0 = performance.now(); (function f() { n += 1; if (performance.now() - t0 < 500) w.requestAnimationFrame(f); else resolve(n); })(); }));
      h.expect(ticks > 10, `the game frame keeps animating under the banner (${ticks} frames in 0.5 s)`);
      await shot(max, "banner");
      const box = await max.page.locator(".ip-bar").boundingBox();
      h.expect(box.y < 20 && box.height < 60, `slim bar at the very top (y ${Math.round(box.y)}, h ${Math.round(box.height)})`);
      await max.page.locator(".ip-bar").click();
      await max.page.locator(".ip-sheet").waitFor({ timeout: 2000 });
      h.eq(await max.page.locator(".ip-sheet button").allInnerTexts(), ["Bäitrieden", "Méi spéit"], "tap → compact sheet with Join / Later");
      await shot(max, "sheet");
      await max.page.getByRole("button", { name: "Méi spéit" }).click();
      await max.page.locator(".ip-top").waitFor({ state: "detached", timeout: 2000 });
      h.eq(statusOf(world, b1.id), "pending", "Later in the sheet: still pending");
      h.expect(await max.page.evaluate(() => document.activeElement?.id === "gf"), "the focus went back to the game frame");

      h.step("(b) a banner nobody answers hides after ~8 s and comes back as a popup once the game is closed");
      const b2 = sendInvite(world, { game: "tictactoe", room: "bb02", from: USERS.emma, to: USERS.max });
      await max.page.locator(".ip-bar").waitFor({ timeout: 20000 });
      const t0 = Date.now();
      await max.page.locator(".ip-bar").waitFor({ state: "detached", timeout: 12000 });
      const shownMs = Date.now() - t0;
      h.expect(shownMs > 6500 && shownMs < 10500, `auto-hide after about 8 s (${shownMs} ms)`);
      h.eq(await popup(max.page).count(), 0, "still no popup while the game runs");
      await max.page.evaluate(() => window.closeGame());
      await popup(max.page).waitFor({ timeout: 5000 });
      h.expect(/Tic-Tac-Toe/.test(await max.page.locator(".ip-title").innerText()), "closing the game → the missed invite is offered as a popup");
      await max.page.keyboard.press("Escape");

      h.step("(b) Join from the banner sheet while the game runs → the lobby");
      await max.page.goto(h.origin + "/pixelbreak.html?g=snake", { waitUntil: "domcontentloaded" });
      await max.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!d && d.readyState === "complete" && d.body && d.body.children.length > 0; }, null, { timeout: 30000 });
      await until(() => listening(hub, USERS.max.id));
      const b3 = sendInvite(world, { game: "connect4", room: "bb03", from: USERS.emma, to: USERS.max });
      await max.page.locator(".ip-bar").waitFor({ timeout: 20000 });
      await max.page.locator(".ip-bar").click();
      await max.page.getByRole("button", { name: "Bäitrieden" }).click();
      await max.page.waitForURL(/lobby\.html\?g=connect4&c=BB03/, { timeout: 20000 });
      h.eq(statusOf(world, b3.id), "accepted", "Join from the sheet → lobby, invite accepted");

      /* ---------------- (c) Kart race running: banner only ---------------- */
      h.step("(c) Lena in a Kart Lëtzebuerg race (in the arcade frame): banner only; the menu gets the popup");
      const lena = await newPlayer(h, world, { label: "lena", user: USERS.lena }); players.push(lena);
      await lena.page.goto(h.origin + "/pixelbreak.html?g=kart-letzebuerg&test=1", { waitUntil: "domcontentloaded" });
      await lena.page.waitForFunction(() => document.getElementById("gf")?.contentWindow?.__klTest, null, { timeout: 60000 });
      const kart = lena.page.frames().find((f) => f.parentFrame());
      await kart.waitForSelector("#menu:not([hidden])", { timeout: 60000 });
      h.expect(await until(() => listening(hub, USERS.lena.id) && invitesChannels(hub, USERS.lena.id) >= 1, 60000), "the listener is up in the arcade shell");
      await until(async () => (await lena.page.evaluate(() => document.documentElement.dataset.liveGame)) === "0", 5000);
      h.eq(await lena.page.evaluate(() => document.documentElement.dataset.liveGame), "0", "Kart menu: the game tells the shell it is not live");
      sendInvite(world, { game: "kart-letzebuerg", room: "kk01", from: USERS.emma, to: USERS.lena });
      await popup(lena.page).waitFor({ timeout: 20000 });
      h.expect(/Kart/.test(await lena.page.locator(".ip-title").innerText()), "in the Kart menu the invite is a popup");
      await lena.page.keyboard.press("Escape");
      await kart.locator("#btnStart").click();
      await kart.waitForFunction(() => window.__klTest && window.__klTest.state().phase === "countdown", null, { timeout: 60000 });
      await until(async () => (await lena.page.evaluate(() => document.documentElement.dataset.liveGame)) === "1", 5000);
      h.eq(await lena.page.evaluate(() => document.documentElement.dataset.liveGame), "1", "countdown / race: live");
      const k2 = sendInvite(world, { game: "kart-letzebuerg", room: "kk02", from: USERS.emma, to: USERS.lena });
      await lena.page.locator(".ip-bar").waitFor({ timeout: 20000 });
      h.eq(await lena.page.locator(".ip-ov").count(), 0, "race running → no popup");
      h.expect(/Kart/.test(await lena.page.locator(".ip-bar").innerText()), `banner: «${await lena.page.locator(".ip-bar").innerText()}»`);
      h.eq(await kart.evaluate(() => window.__klTest.state().paused), false, "the race is not paused by the banner");
      await shot(lena, "banner-kart");
      await lena.page.locator(".ip-bar").click();
      await lena.page.getByRole("button", { name: "Bäitrieden" }).click();
      await lena.page.waitForURL(/pb\/kart-letzebuerg\.html\?room=kk02&role=guest/, { timeout: 15000 });
      h.eq(statusOf(world, k2.id), "accepted", "Kart: Join → its own lobby link with the room");

      /* ---------------- screenshots at four sizes ---------------- */
      if (process.env.FLOW_SHOTS_DIR) {
        h.step("screenshots: popup + banner + sheet at desktop / iPad landscape / iPad portrait / phone");
        const zed = await newPlayer(h, world, { label: "tester-shots", user: USERS.ian }); players.push(zed);
        let n = 0;
        for (const [label, size] of Object.entries(SIZES)) {
          n += 1;
          await zed.page.setViewportSize(size);
          await zed.page.goto(h.origin + "/pixelbreak.html", { waitUntil: "domcontentloaded" });
          await until(() => listening(hub, USERS.ian.id));
          await sleep(2500);
          sendInvite(world, { game: "tank-wars", room: "zp0" + n, from: USERS.emma, to: USERS.ian });
          await popup(zed.page).waitFor({ timeout: 20000 });
          await shot(zed, `popup-${label}`);
          await zed.page.keyboard.press("Escape");
          await zed.page.goto(h.origin + "/pixelbreak.html?g=snake", { waitUntil: "domcontentloaded" });
          await until(() => listening(hub, USERS.ian.id));
          await sleep(2500);
          sendInvite(world, { game: "kart-letzebuerg", room: "zb0" + n, from: USERS.lena, to: USERS.ian });
          await zed.page.locator(".ip-bar").waitFor({ timeout: 20000 });
          await shot(zed, `banner-${label}`);
          await zed.page.locator(".ip-bar").click();
          await shot(zed, `sheet-${label}`);
          await zed.page.keyboard.press("Escape");
        }
      }

      for (const p of players) errorsOf.push(...realErrors(p).map((e) => `${p.label}: ${e}`));
      h.eq(errorsOf, [], "no console errors on any page");
    } finally {
      await closePlayers(players);
    }
    if (process.env.INVITE_POP_REPORT) fs.writeFileSync(process.env.INVITE_POP_REPORT, JSON.stringify(REPORT, null, 2));
    console.log("    cost per page load:", JSON.stringify(REPORT));
  },
};

runIfMain(import.meta.url, flow);
