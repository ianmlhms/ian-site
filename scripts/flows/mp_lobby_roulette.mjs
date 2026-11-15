/* Shared multiplayer lobby — Roulette (2–8 players, host settings: rounds + chips). THREE players in one browser, one Realtime hub:
 *   tester (host) · Emma (invited through the picker) · Gast (signed out, joins by link), plus a solo player (?ai=1) and an old ?room= link.
 * Covers: bare roulette.html → lobby, the game's settings (rounds 5, chips 500), invite popup → join, ready/start, every player lands in
 * round 1 with the host's settings, five rigged rounds (the host picks the winning numbers through window.__casinoTest) with real bets from
 * all three players — exact chip totals asserted and identical on every device, other players' bets visible on the table, bet cap,
 * «Ewech», a hostile over-bet intent the host rejects, early end when everybody tapped «Fäerdeg», timer end when somebody didn't —
 * final ranking, «‹ Lobby» (one tap after the final round) with the same code + settings, ?ai=1 solo, the old ?room= link, 375 px width. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, text, sleep, shotter } from "./mp_lobby_lib.mjs";

const NAME = "mp-lobby-roulette";
const ROUNDS = 5, CHIPS = 500;
const RIG = [17, 0, 8, 22, 11];
const TEST_TIMERS = { betMs: 6000, spinMs: 1200, resultMs: 2500, rig: RIG };
const SOLO_TIMERS = { betMs: 6000, spinMs: 800, resultMs: 1500, rig: [7] };
const pressed = (page) => page.$$eval("#mplSettings .mpl-chip", (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent.trim()));
const inRoom = (page, n) => page.waitForFunction((k) => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === k, n, { timeout: 20000 });
// timers + rigged numbers for the game
const withTimers = (player, t) => player.context.addInitScript((cfg) => {
  window.__casinoTest = cfg;
}, t);
const sameChips = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const round = (page, r) => page.waitForFunction(([k, total]) => document.getElementById("stRound")?.textContent === `Ronn ${k} / ${total}` && !document.getElementById("bDone").disabled, [r, ROUNDS], { timeout: 30000 });
const tap = async (p, chip, key) => { await p.page.click(`#chipPick [data-v="${chip}"]`); await p.page.click(`#tbl .cell[data-k="${key}"]`); };
const done = (page) => page.click("#bDone");
const chipsOf = (page) => page.$$eval("#plist li", (lis) => Object.fromEntries(lis.map((li) => [li.querySelector(".nm").textContent.replace(" (du)", ""), +li.querySelector(".ch").textContent]).sort()));
async function result(page, n) {
  await page.waitForFunction((x) => document.getElementById("rTile").textContent === String(x), n, { timeout: 30000 });
  return { chips: await chipsOf(page), plist: (await text(page, "#plist")).replace(/ \(du\)/g, ""), me: await text(page, "#rMe") };
}
async function allResult(players, n, expectChips, h) {
  const rs = await Promise.all(players.map((p) => result(p.page, n)));
  rs.forEach((r, i) => h.expect(sameChips(r.chips, expectChips), `round result ${n}: chips right on ${players[i].label} (${JSON.stringify(r.chips)})`));
  h.eq(new Set(rs.map((r) => r.plist)).size, 1, `round result ${n}: the player list is identical on every device`);
  return rs;
}
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
    const shot = shotter(NAME);
    const players = [];
    try {
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); players.push(emma);
      const guest = await newPlayer(h, world, { label: "guest" }); players.push(guest);
      const solo = await newPlayer(h, world, { label: "solo", user: USERS.lena }); players.push(solo);
      for (const p of [host, emma, guest]) await withTimers(p, TEST_TIMERS);
      await withTimers(solo, SOLO_TIMERS);

      h.step("solo (?ai=1): pick 5 rounds / 500 chips, bet 100 on 7 (rigged to win), no lobby");
      await solo.page.goto(h.origin + "/roulette.html?ai=1", { waitUntil: "domcontentloaded" });
      await solo.page.waitForSelector("#startBtn");
      h.expect(!solo.page.url().includes("lobby.html") && await solo.page.$("#mpgBack") === null, "?ai=1 opens the game, no lobby");
      await solo.page.click('#wait .seg .rbtn:text-is("5")');
      await solo.page.click('#wait .seg .rbtn:text-is("500")');
      await solo.page.click("#startBtn");
      await solo.page.waitForFunction(() => !document.getElementById("bDone")?.disabled, null, { timeout: 15000 });
      h.eq(await text(solo.page, "#bFree"), "500", "solo starts with the picked 500 chips");
      await tap(solo, 100, "n7");
      h.eq(await text(solo.page, "#bStake"), "100", "solo stake 100");
      await done(solo.page);
      await solo.page.waitForFunction(() => document.getElementById("rTile").textContent === "7", null, { timeout: 15000 });
      h.eq(await text(solo.page, "#bFree"), "4000", "solo: 100 on 7 pays 35:1 → 500 − 100 + 3600 = 4000");
      h.expect(/\+3500/.test(await text(solo.page, "#rMe")), "solo: «Du: +3500»");
      await solo.context.close(); players.splice(players.indexOf(solo), 1);

      await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });   // Emma is busy in another game when the invite arrives
      await emma.page.waitForSelector("#board .cell");
      await sleep(600);

      h.step("host opens roulette.html → lobby → create; settings: 5 rounds, 500 chips");
      hub.reset();
      await host.page.goto(h.origin + "/roulette.html", { waitUntil: "commit" });
      await host.page.waitForSelector("#mplCreate");
      h.expect(/g=roulette/.test(host.page.url()), "bare roulette.html is sent to the lobby");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplSettings .mpl-chip");
      const code = await lobbyCode(host.page);
      h.eq(await pressed(host.page), ["10", "1000"], "defaults: 10 rounds, 1000 chips");
      await host.page.click('#mplSettings .mpl-chip:text-is("5")');
      await host.page.click('#mplSettings .mpl-chip:text-is("500")');
      h.eq(await pressed(host.page), [String(ROUNDS), String(CHIPS)], "host picks 5 rounds + 500 chips");

      h.step("invite Emma → popup → join; the guest joins by link");
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click("#ppGo");
      await host.page.waitForSelector(".mpl-row.mpl-invited");
      h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_to.length]), [["roulette", 1]], "one mp_invite for roulette");
      await emma.page.waitForSelector(".ip-card");
      h.expect(/Roulette/.test(await text(emma.page, ".ip-title")), "popup names the game");
      await emma.page.click(".ip-card .ip-primary");
      await emma.page.waitForSelector("#mplRoster");
      await guest.page.goto(h.origin + `/lobby.html?g=roulette&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplRoster");
      await inRoom(host.page, 3);
      h.eq(await pressed(emma.page), [String(ROUNDS), String(CHIPS)], "Emma sees the host's settings");

      h.step("everyone ready → Start → all three land in round 1 with 500 chips");
      await emma.page.click("#mplReady"); await guest.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
      await host.page.click("#mplStart");
      const all = [host, emma, guest];
      for (const p of all) await p.page.waitForURL(/roulette\.html\?room=/, { timeout: 20000 });
      for (const p of all) await round(p.page, 1);
      const gname = await guest.page.evaluate(() => localStorage.getItem("playerName"));
      for (const p of all) { h.eq(await text(p.page, "#bFree"), "500", `${p.label}: 500 chips`); h.eq(await p.page.$$eval("#plist li", (l) => l.length), 3, `${p.label}: three players listed`); }
      h.expect(/^‹ Lobby/.test(await text(host.page, "#mpgBack")), "mid-match: plain «‹ Lobby»");
      await host.page.setViewportSize({ width: 375, height: 812 });
      await sleep(300);
      h.expect(await noScroll(host.page), "375 px: no horizontal scroll (betting)");
      await emma.page.setViewportSize({ width: 820, height: 1180 });

      h.step("round 1 → 17 (black, odd, low, 2nd dozen): host 50 on 17, Emma 100 red (loses), guest 50 odd + 100 black (both win)");
      await tap(host, 50, "n17"); await done(host.page);
      await tap(emma, 100, "red");
      // everybody sees the others' bets on the table (marker with the total + tag)
      await guest.page.waitForFunction(() => /100/.test(document.querySelector('#tbl .cell[data-k="red"] .mk')?.textContent || "") && /E/.test(document.querySelector('#tbl .cell[data-k="red"] .mk')?.textContent || ""), null, { timeout: 8000 });
      await host.page.waitForFunction(() => /100/.test(document.querySelector('#tbl .cell[data-k="red"] .mk')?.textContent || ""), null, { timeout: 8000 });
      h.expect(true, "Emma's 100 on red shows on the guest's and the host's table");
      await shot(host, "bet-phone"); await shot(emma, "bet-ipad");
      await done(emma.page);
      await tap(guest, 50, "odd"); await tap(guest, 100, "black");
      h.expect(await guest.page.$eval('#tbl .cell[data-k="black"]', (c) => c.classList.contains("mine")), "own bets are highlighted");
      await done(guest.page);
      let rs = await allResult(all, 17, { tester: 2250, Emma: 400, [gname]: 650 }, h);
      h.expect(/\+1750/.test(rs[0].me), "host: «Du: +1750»");
      h.expect(/\+150/.test(rs[2].me), "guest: «Du: +150»");
      await shot(host, "result-phone"); await shot(emma, "result-ipad");

      h.step("round 2 → 0 (zero beats every outside bet): host 100 red (loses), Emma 10 on 0, guest sits out");
      for (const p of all) await round(p.page, 2);
      await tap(host, 100, "red"); await done(host.page);
      await tap(emma, 10, "n0"); await done(emma.page);
      await done(guest.page);
      await allResult(all, 0, { tester: 2150, Emma: 750, [gname]: 650 }, h);

      h.step("round 3 → 8 (black, even, low, 1st dozen): Emma 100 black, guest 50 on the 1st dozen, host passes");
      for (const p of all) await round(p.page, 3);
      await done(host.page);
      await tap(emma, 100, "black"); await done(emma.page);
      await tap(guest, 50, "d1"); await done(guest.page);
      await allResult(all, 8, { tester: 2150, Emma: 850, [gname]: 750 }, h);

      h.step("round 4 → 22: bet cap + «Ewech», nobody ends early → the timer ends betting");
      for (const p of all) await round(p.page, 4);
      await done(host.page); await done(emma.page);
      await tap(guest, 10, "red");
      await guest.page.click("#bClear");
      h.eq(await text(guest.page, "#bStake"), "0", "«Ewech» clears the bets of the round");
      await tap(guest, 500, "red");
      h.expect(await guest.page.isDisabled('#chipPick [data-v="500"]') && !(await guest.page.isDisabled('#chipPick [data-v="100"]')), "chips above the free 250 are disabled");
      await host.page.waitForFunction(() => /500/.test(document.querySelector('#tbl .cell[data-k="red"] .mk')?.textContent || ""), null, { timeout: 4000 });
      h.expect(true, "the host sees the guest's 500 on red");
      const t0 = Date.now();
      rs = await allResult(all, 22, { tester: 2150, Emma: 850, [gname]: 250 }, h);
      h.expect(Date.now() - t0 > 1500, "the guest never tapped «Fäerdeg», so the countdown ended the round");

      h.step("round 5 (final) → 11: a hostile over-bet is ignored by the host, then real bets");
      for (const p of all) await round(p.page, 5);
      await guest.page.evaluate(() => ch.send({ type: "broadcast", event: "act", payload: { cid, bets: { n1: 99999 }, done: true } }));
      await sleep(600);
      h.eq(await host.page.$eval('#tbl .cell[data-k="n1"] .mk', (m) => m.textContent), "", "host ignored the guest's 99999 bet");
      await tap(host, 10, "n11"); await done(host.page);
      await done(emma.page);
      await tap(guest, 50, "black"); await done(guest.page);
      await allResult(all, 11, { tester: 2500, Emma: 850, [gname]: 300 }, h);

      h.step("final screen: ranking, winner, «Nach eng Partie» only for the host, «‹ Lobby» is one tap");
      for (const p of all) await p.page.waitForSelector("#over:not([hidden])", { timeout: 15000 });
      h.expect(/tester gewënnt/.test(await text(guest.page, "#over .banner")), "banner: tester gewënnt");
      h.eq(await guest.page.$$eval("#over .rank td.num", (t) => t.map((x) => +x.textContent)), [2500, 850, 300], "ranking by chips on the guest's screen");
      h.expect(await host.page.isVisible("#againBtn") && await guest.page.$("#againBtn") === null, "only the host gets «Nach eng Partie»");
      h.expect(await noScroll(host.page), "375 px: no horizontal scroll (final)");
      await shot(host, "final");
      for (const p of all) await p.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "1");

      h.step("back to the lobby: same code, settings kept");
      for (const p of all) { await p.page.click("#mpgBack"); await p.page.waitForSelector("#mplRoster"); }
      await inRoom(host.page, 3);
      h.eq(await lobbyCode(host.page), code, "same code");
      h.eq(await pressed(host.page), [String(ROUNDS), String(CHIPS)], "rounds + chips survived");

      h.step("old link ?room=…&role=host: waits for a second player, no lobby chip");
      const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.emmi }); players.push(legacy);
      await legacy.page.goto(h.origin + "/roulette.html?room=abc123&role=host", { waitUntil: "domcontentloaded" });
      await legacy.page.waitForSelector("#startBtn");
      await sleep(1500);
      h.expect(await legacy.page.isDisabled("#startBtn") && await legacy.page.$("#mpgBack") === null, "old host link waits (Start disabled) and has no lobby chip");

      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
