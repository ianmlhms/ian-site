/* Shared multiplayer lobby — Blackjack (2–7 players against the dealer; host settings: rounds + chips). Three players in one browser, one Realtime hub:
 *   tester (host) · Emma (invited through the picker) · a signed-out guest by link (375 px phone).
 * Covers: bare blackjack.html → lobby, the game's settings (rounds 5, chips 500) arrive in the game, a rigged 5-round match
 * (window.__casinoTest.deck) that asserts exact totals and chips on every device: hit, bust, dealer bust, stand, 3:2 blackjack
 * (rounded down), split + double, dealer blackjack (peek, push), a hit to 21, dealer standing on soft 17, a turn that times out;
 * only the player whose turn it is gets the buttons; the dealer's hole card never reaches the guests while hidden;
 * the final screen, «Nach eng Partie», «‹ Lobby» back with the same code + settings, ?ai=1 solo (blackjack 3:2),
 * the old ?room= link, no console errors, no horizontal scroll at 375 px. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, text, sleep, shotter } from "./mp_lobby_lib.mjs";

const NAME = "mp-lobby-blackjack";
const BET_MS = 7000, TURN_MS = 7000, RESULT_MS = 3500, STEP_MS = 150;
const PHONE = { width: 375, height: 780 };

/* Deal order per round: every bettor's 1st card (seat order), dealer up, every bettor's 2nd card, dealer hole, then hits/draws in play order. */
const DECK = [
  // R1 — tester 5+6 hits 4S, KH (bust 25) · Emma 19 stands · guest A+K blackjack · dealer 6+10 draws 8 (bust 24)
  "5H", "10S", "AS", "6C", "6D", "9H", "KD", "10D", "4S", "KH", "8D",
  // R2 — tester 8,8 splits (3D → 11, 10D → 18), doubles the 11 (10S → 21), stands 18 · Emma 11 doubles (9C → 20) · guest 16 stands · dealer 10+7 = 17
  "8H", "7C", "10H", "10C", "8S", "4D", "6S", "7D", "3D", "10D", "10S", "9C",
  // R3 — tester A+K and dealer A+K (blackjack vs blackjack: push) · Emma 9+8 loses · guest sits out
  "KH", "9S", "AH", "AS", "8C", "KC",
  // R4 — tester 15 hits 6C (21, stands by itself) · Emma 18 stands · guest 15 hits 2H (17) and stands · dealer A+6 = soft 17 stands
  "10D", "9D", "7H", "AC", "5S", "9C", "8D", "6H", "6C", "2H",
  // R5 — tester 20 stands · Emma 16 never acts (auto-stand) · guest 17 stands · dealer 10+9 = 19
  "10S", "10H", "9S", "10C", "10D", "6D", "8H", "9H",
];
const SOLO_DECK = ["AS", "9C", "KH", "8D"];   // solo: blackjack against a 9 → bet 100 pays 150

const pressed = (page) => page.$$eval("#mplSettings .mpl-chip", (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent.trim()));
const inRoom = (page, n) => page.waitForFunction((k) => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === k, n, { timeout: 20000 });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const S = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));   // key order must not depend on whose screen it is
// timers + rigged cards for the game
const hook = (context, test) => context.addInitScript((t) => {
  window.__casinoTest = t;
}, test);

const inPhase = (page, phase, timeout = 30000) => page.waitForFunction((p) => document.querySelector(`[data-phase="${p}"]`) !== null, phase, { timeout });
const roundIs = (page, n) => page.waitForFunction((r) => document.querySelector(".table")?.dataset.round === String(r), n, { timeout: 30000 });

/** What one device shows: phase, round, everybody's chips and hand outcomes (by player name), the dealer's total. */
const readTable = (page) => page.evaluate(() => {
  const table = document.querySelector(".table");
  const chips = {}, outcomes = {};
  const me = document.getElementById("me");
  if (me) {
    const nm = me.querySelector("h2 .n").textContent;
    chips[nm] = Number(document.getElementById("myChips").textContent);
    outcomes[nm] = [...me.querySelectorAll(".hbox")].map((b) => b.dataset.outcome);
  }
  document.querySelectorAll(".orow").forEach((r) => {
    const nm = r.querySelector(".nm").childNodes[0].textContent.trim();
    chips[nm] = Number(r.querySelector(".nm small").textContent);
    outcomes[nm] = [...r.querySelectorAll(".hh")].map((b) => b.dataset.outcome);
  });
  return {
    phase: table ? table.dataset.phase : null, round: table ? Number(table.dataset.round) : 0,
    chips: Object.fromEntries(Object.entries(chips).sort(([a], [b]) => (a < b ? -1 : 1))), outcomes: Object.fromEntries(Object.entries(outcomes).sort(([a], [b]) => (a < b ? -1 : 1))),
    dealer: document.getElementById("dealerTotal")?.textContent ?? null,
    dealerCards: document.querySelectorAll(".dealer .card").length,
    dealerNote: document.querySelector(".dealer h2 .n")?.textContent ?? "",
  };
});

async function placeBet(page, amount, { quick = true } = {}) {
  await page.waitForSelector("#betGo", { timeout: 30000 });
  if (quick) await page.click(`.quick [data-amt="${amount}"]`);
  const label = (await text(page, "#betGo"));
  if (label !== `Setz ${amount}`) throw new Error(`bet button says «${label}», wanted «Setz ${amount}»`);
  await page.click("#betGo");
}
const hasButtons = (page) => page.$("#actions").then((e) => e !== null);

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
    const shot = shotter(NAME);
    const players = [];
    const timers = { betMs: BET_MS, turnMs: TURN_MS, resultMs: RESULT_MS, stepMs: STEP_MS, deck: DECK };
    try {
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); players.push(emma);
      const guest = await newPlayer(h, world, { label: "guest", viewport: PHONE }); players.push(guest);
      for (const p of [host, emma, guest]) await hook(p.context, timers);
      const all = [host, emma, guest];

      h.step("?ai=1 solo: pickers on the start screen, you against the dealer, blackjack pays 3:2");
      const solo = await newPlayer(h, world, { label: "solo", user: USERS.lena, viewport: PHONE }); players.push(solo);
      await hook(solo.context, { ...timers, deck: SOLO_DECK });
      await solo.page.goto(h.origin + "/blackjack.html?ai=1", { waitUntil: "domcontentloaded" });
      await solo.page.waitForSelector("#startBtn");
      h.expect(!solo.page.url().includes("lobby.html") && await solo.page.$("#mpgBack") === null, "?ai=1 opens the solo game, no lobby");
      h.expect(await noHScroll(solo.page), "solo start screen: no horizontal scroll at 375 px");
      await solo.page.click('#pickRounds [data-v="5"]');
      await solo.page.click('#pickChips [data-v="500"]');
      await solo.page.click("#startBtn");
      await placeBet(solo.page, 100);
      await inPhase(solo.page, "result");
      let t = await readTable(solo.page);
      h.eq(t.chips, { Lena: 650 }, "solo: 500 − 100 + 100 + 50 (3:2) = 650 chips");
      h.eq(t.outcomes.Lena, ["blackjack"], "solo: «Blackjack!»");
      h.eq(t.dealer, "17", "solo: the dealer ends on 17");
      h.expect(await noHScroll(solo.page), "solo result: no horizontal scroll at 375 px");
      await shot(solo, "solo-result");

      h.step("host opens blackjack.html → lobby → create; the game's settings (rounds, chips) are there");
      await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });   // Emma is busy elsewhere: the invite arrives as a toast
      await emma.page.waitForSelector("#board .cell");
      await sleep(600);
      hub.reset();
      await host.page.goto(h.origin + "/blackjack.html", { waitUntil: "commit" });
      await host.page.waitForSelector("#mplCreate");
      h.expect(/g=blackjack/.test(host.page.url()), "bare blackjack.html is sent to the lobby");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplSettings .mpl-chip");
      const code = await lobbyCode(host.page);
      h.eq(await pressed(host.page), ["10", "1000"], "defaults: 10 rounds, 1000 chips");
      await host.page.click('#mplSettings .mpl-chip:text-is("5")');
      await host.page.click('#mplSettings .mpl-chip:text-is("500")');
      h.eq(await pressed(host.page), ["5", "500"], "host picks 5 rounds + 500 chips");

      h.step("invite Emma → toast → join; the signed-out guest joins by link");
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click("#ppGo");
      await emma.page.waitForSelector(".ip-card");
      h.expect(/Blackjack/.test(await text(emma.page, ".ip-title")), "Emma's popup names the game");
      await emma.page.click(".ip-card .ip-primary");
      await emma.page.waitForSelector("#mplRoster");
      await guest.page.goto(h.origin + `/lobby.html?g=blackjack&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplRoster");
      await inRoom(host.page, 3);
      h.expect(/3\/7/.test(await text(host.page, ".mpl-count")), "3/7 players");
      h.eq(await pressed(emma.page), ["5", "500"], "Emma sees the host's settings");

      h.step("everyone ready → Start → all three land in the game with the host's settings");
      for (const p of [emma, guest]) await p.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
      await host.page.click("#mplStart");
      for (const p of all) await p.page.waitForURL(/blackjack\.html\?room=/, { timeout: 20000 });
      h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), "host → room link + lb");
      for (const p of all) await inPhase(p.page, "bet");
      const GN = await guest.page.evaluate(() => document.querySelector("#me h2 .n").textContent);   // the guest's lobby name
      for (const p of all) h.expect(/1 \/ 5/.test(await text(p.page, ".statline")), `${p.label}: «Ronn 1 / 5»`);
      for (const p of all) h.eq((await readTable(p.page)).chips, S({ tester: 500, Emma: 500, [GN]: 500 }), `${p.label}: everybody starts with 500 chips`);
      h.expect(await noHScroll(guest.page), "phone: no horizontal scroll at the betting screen");
      await shot(guest, "bet-phone");
      await shot(host, "bet");

      /* ---------------- round 1 ---------------- */
      h.step("round 1: bets 50 / 100 / 25 → deal; ONLY the player whose turn it is gets the buttons");
      await placeBet(host.page, 50);
      h.expect(/Asaz 50 gesat/.test(await text(host.page, "#dock")), "host: «Asaz 50 gesat» after betting");
      await placeBet(emma.page, 100);
      await placeBet(guest.page, 25);       // early end: everybody has bet
      for (const p of all) await inPhase(p.page, "play");
      await host.page.waitForSelector("#hitBtn");
      h.expect(await hasButtons(host.page) && !(await hasButtons(emma.page)) && !(await hasButtons(guest.page)), "only the host (turn 1) has the action buttons");
      h.expect(/tester ass drun/.test(await text(emma.page, "#waitMsg")) && /tester ass drun/.test(await text(guest.page, "#waitMsg")), "the others see «tester ass drun …» + countdown");
      h.expect(await host.page.$("#doubleBtn") !== null && await host.page.$("#splitBtn") === null, "5+6: double yes, split no");
      h.eq(await host.page.$$eval("#me [data-mytotal]", (e) => e.map((x) => x.textContent)), ["11"], "host total 11");
      const guestView = await guest.page.evaluate(() => ({ hole: view.dealer[1], backs: document.querySelectorAll(".dealer .card.back").length }));
      h.expect(guestView.hole === "XX" && guestView.backs === 1, "guest: the dealer's hole card is hidden (snapshot says XX)");
      h.expect(await noHScroll(guest.page), "phone: no horizontal scroll while playing");
      await host.page.click("#hitBtn");
      await host.page.waitForFunction(() => document.querySelector("#me [data-mytotal]")?.textContent === "15");
      h.expect(await host.page.$("#doubleBtn") === null, "after a hit: no double any more (three cards)");
      await host.page.click("#hitBtn");        // KH → 25, bust
      await emma.page.waitForSelector("#standBtn");
      h.expect(!(await hasButtons(host.page)) && !(await hasButtons(guest.page)) && await hasButtons(emma.page), "turn 2: only Emma has the buttons");
      h.eq((await readTable(host.page)).outcomes.tester, [""], "host's bust is not settled before the round ends");
      h.expect(/Iwwerkaaft/.test(await text(host.page, "#me")), "host sees «Iwwerkaaft»");
      await emma.page.click("#standBtn");
      for (const p of all) await inPhase(p.page, "result");
      for (const p of all) {
        t = await readTable(p.page);
        h.eq(t.chips, S({ tester: 450, Emma: 600, [GN]: 537 }), `${p.label}: R1 chips (bust −50, 19 vs dealer bust +100, blackjack 25 → +37 rounded down)`);
        h.eq(t.outcomes, S({ tester: ["bust"], Emma: ["win"], [GN]: ["blackjack"] }), `${p.label}: R1 outcomes`);
        h.eq([t.dealer, t.dealerCards], ["24", 3], `${p.label}: dealer drew to 24 and busted`);
      }
      h.expect(/Iwwerkaaft −50/.test(await text(host.page, "#me")) && /Gewonnen \+100/.test(await text(emma.page, "#me")) && /Blackjack! \+37/.test(await text(guest.page, "#me")), "labels with the chip change on each device");
      await shot(host, "r1-result");

      /* ---------------- round 2 ---------------- */
      h.step("round 2: split + double, dealer 17 beats the guest");
      await roundIs(host.page, 2);
      await placeBet(host.page, 100);
      await placeBet(emma.page, 50);
      await placeBet(guest.page, 25, { quick: false });   // the last bet (25) is the default
      for (const p of all) await inPhase(p.page, "play");
      await host.page.waitForSelector("#splitBtn");
      h.expect(await host.page.$("#doubleBtn") !== null, "8+8: split and double offered");
      await host.page.click("#splitBtn");
      await host.page.waitForFunction(() => document.querySelectorAll("#me .hbox").length === 2);
      h.eq(await host.page.$$eval("#me [data-mytotal]", (e) => e.map((x) => x.textContent)), ["11", "18"], "two hands: 11 and 18");
      h.expect(await host.page.$("#splitBtn") === null && await host.page.$("#doubleBtn") !== null, "hand 1 (11): double yes, no second split");
      h.expect((await host.page.$$eval("#me .hbox", (b) => b.map((x) => x.classList.contains("cur")))).join() === "true,false", "hand 1 is the current one");
      h.expect(await host.page.evaluate(() => Number(document.getElementById("myChips").textContent)) === 250, "split took another 100 → 250 chips");
      await shot(host, "r2-split");
      h.expect(await noHScroll(guest.page), "phone: no horizontal scroll with a split hand on the table");
      await host.page.click("#doubleBtn");
      await host.page.waitForFunction(() => document.querySelector("#me .hbox.cur")?.dataset.hand === "1");
      h.expect(await host.page.evaluate(() => Number(document.getElementById("myChips").textContent)) === 150, "double took 100 more → 150 chips");
      await host.page.click("#standBtn");
      await emma.page.waitForSelector("#doubleBtn");
      await emma.page.click("#doubleBtn");    // 11 + 9C = 20, one card only
      await guest.page.waitForSelector("#standBtn");
      h.expect(!(await hasButtons(host.page)) && !(await hasButtons(emma.page)), "turn 3: only the guest has the buttons");
      await guest.page.click("#standBtn");
      for (const p of all) await inPhase(p.page, "result");
      for (const p of all) {
        t = await readTable(p.page);
        h.eq(t.chips, S({ tester: 750, Emma: 700, [GN]: 512 }), `${p.label}: R2 chips`);
        h.eq(t.outcomes, S({ tester: ["win", "win"], Emma: ["win"], [GN]: ["lose"] }), `${p.label}: R2 outcomes (21 and 18 and 20 beat 17, 16 loses)`);
        h.eq([t.dealer, t.dealerCards], ["17", 2], `${p.label}: dealer stands on 17`);
      }
      h.expect(/Gewonnen \+200/.test(await text(host.page, "#me")) && /Gewonnen \+100/.test(await text(host.page, "#me")), "host: the doubled hand paid +200, the other +100");

      /* ---------------- round 3 ---------------- */
      h.step("round 3: dealer blackjack on an ace is revealed at once; the guest sits out");
      await roundIs(host.page, 3);
      await placeBet(host.page, 50);
      await placeBet(emma.page, 50);
      h.expect(/Setz/.test(await text(guest.page, "#betGo")), "the guest has not bet yet (the round waits for the countdown)");
      for (const p of all) await inPhase(p.page, "result");   // no turns: the peek ended the round
      for (const p of all) {
        t = await readTable(p.page);
        h.eq(t.chips, S({ tester: 750, Emma: 650, [GN]: 512 }), `${p.label}: R3 chips (blackjack pushes, 17 loses, sitting out costs nothing)`);
        h.eq(t.outcomes, S({ tester: ["push"], Emma: ["lose"], [GN]: [] }), `${p.label}: R3 outcomes`);
        h.expect(t.dealer === "21" && /Blackjack/.test(t.dealerNote), `${p.label}: the dealer shows «Blackjack!»`);
      }
      h.expect(/Setzt dës Ronn aus/.test(await text(guest.page, "#me")), "the guest sees «Setzt dës Ronn aus»");

      /* ---------------- round 4 ---------------- */
      h.step("round 4: a hit to 21 ends the turn by itself, dealer stands on soft 17, push");
      await roundIs(host.page, 4);
      await placeBet(host.page, 100);
      await placeBet(emma.page, 100);
      await placeBet(guest.page, 10);
      for (const p of all) await inPhase(p.page, "play");
      await host.page.waitForSelector("#hitBtn");
      await host.page.click("#hitBtn");       // 15 + 6C = 21 → auto-stand
      await emma.page.waitForSelector("#standBtn");   // no stand click needed for the host
      await emma.page.click("#standBtn");
      await guest.page.waitForSelector("#hitBtn");
      await guest.page.click("#hitBtn");      // 15 + 2H = 17
      await guest.page.waitForFunction(() => document.querySelector("#me [data-mytotal]")?.textContent === "17");
      await guest.page.click("#standBtn");
      for (const p of all) await inPhase(p.page, "result");
      for (const p of all) {
        t = await readTable(p.page);
        h.eq(t.chips, S({ tester: 850, Emma: 750, [GN]: 512 }), `${p.label}: R4 chips`);
        h.eq(t.outcomes, S({ tester: ["win"], Emma: ["win"], [GN]: ["push"] }), `${p.label}: R4 outcomes (21 and 18 beat 17, 17 pushes)`);
        h.eq([t.dealer, t.dealerCards], ["7/17", 2], `${p.label}: dealer shows the soft 17 «7/17» and did not draw`);
      }

      /* ---------------- round 5 ---------------- */
      h.step("round 5 (last): Emma's turn runs out → she stands by herself");
      await roundIs(host.page, 5);
      for (const p of all) await placeBet(p.page, 10);
      for (const p of all) await inPhase(p.page, "play");
      await host.page.waitForSelector("#standBtn");
      await host.page.click("#standBtn");
      await emma.page.waitForSelector("#standBtn");
      h.expect(/Emma ass drun/.test(await text(host.page, "#waitMsg")), "everybody else sees «Emma ass drun …»");
      await guest.page.waitForSelector("#standBtn", { timeout: 20000 });   // after Emma's 7 s
      h.expect(await emma.page.$("#actions") === null, "Emma's buttons are gone after the timeout");
      await guest.page.click("#standBtn");
      for (const p of all) await inPhase(p.page, "result");
      for (const p of all) {
        t = await readTable(p.page);
        h.eq(t.chips, S({ tester: 860, Emma: 740, [GN]: 502 }), `${p.label}: R5 chips (20 wins vs 19, auto-stand 16 and 17 lose)`);
      }

      h.step("final screen: ranking by chips, winner banner, only the host gets «Nach eng Partie»");
      for (const p of all) await inPhase(p.page, "over");
      for (const p of all) {
        h.expect(/tester.*gewënnt/.test(await text(p.page, "#banner")), `${p.label}: winner banner «🏆 tester … gewënnt!»`);
        h.eq(await p.page.$$eval("table.rank tbody tr", (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim().replace(" (du)", "")).slice(1))),
          [["tester", "860"], ["Emma", "740"], [GN, "502"]], `${p.label}: ranking`);
      }
      h.expect(await host.page.$("#againBtn") !== null && await emma.page.$("#againBtn") === null && await guest.page.$("#againBtn") === null, "only the host gets «Nach eng Partie»");
      for (const p of all) await p.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "1");
      await shot(host, "final");
      await shot(guest, "final-phone");

      h.step("«Nach eng Partie»: everybody back to 500 chips, round 1");
      await host.page.click("#againBtn");
      for (const p of all) await inPhase(p.page, "bet");
      for (const p of all) {
        t = await readTable(p.page);
        h.expect(t.round === 1 && JSON.stringify(t.chips) === JSON.stringify(S({ tester: 500, Emma: 500, [GN]: 500 })), `${p.label}: round 1, 500 chips each`);
      }

      h.step("back to the lobby (two taps mid-match): same code, settings kept");
      for (const p of all) { await p.page.click("#mpgBack"); await p.page.click("#mpgBack"); await p.page.waitForSelector("#mplRoster"); }
      await inRoom(host.page, 3);
      h.eq(await lobbyCode(host.page), code, "same code");
      h.eq(await pressed(host.page), ["5", "500"], "rounds + chips survived");

      h.step("old link: ?room= opens the game directly and waits for a 2nd player (Start disabled)");
      const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.lena }); players.push(legacy);
      await legacy.page.goto(h.origin + "/blackjack.html?room=abc123&role=host", { waitUntil: "domcontentloaded" });
      await legacy.page.waitForSelector("#startBtn");
      h.expect(!legacy.page.url().includes("lobby.html") && await legacy.page.$("#mpgBack") === null, "old host link works, no lobby chip");
      await sleep(1500);
      h.expect(await legacy.page.isDisabled("#startBtn"), "…and waits for a second player (nobody auto-starts an old link)");

      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".blackjack.json", JSON.stringify({ frames: hub.stats.framesIn + hub.stats.framesOut }, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
