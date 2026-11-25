/* Online board games played to the end by two players (and against the computer), over the old ?room=&role= links:
 *   Véier gewënnt   a vertical win shows the four winning discs · a reload mid-game gets the board back · the rematch gives the
 *                   first move to the other colour · the opponent leaving puts the game on hold
 *   Schëffer        both fleets shuffled, shots fly until one fleet is gone · a sunk ship is reported to the shooter ·
 *                   the opponent leaving mid-battle says so and blocks shots
 *   Dammspill       40 king moves in a row without a capture end in a draw
 *   Faarf roden     a player who reloads during a round gets the running round back (host answers "need")
 * The lobby path into these games is tested by mp-lobby-*.mjs; nothing here touches the live Supabase project. */
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, text } from "./mp_lobby_lib.mjs";

const NAME = "online-games";
const WAIT = { timeout: 20000 };
const statusOf = (page) => text(page, "#status");
const waitStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test((document.getElementById("status")?.textContent || "").replace(/\s+/g, " ")), re.source, WAIT);

async function pair(h, world, first) {
  const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first });
  const guest = await newPlayer(h, world, { label: "guest", user: USERS.emma });
  return { host, guest };
}

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub });
    const players = [];
    try {
      /* ---------------------------------------------------------------- Véier gewënnt */
      h.step("connect4: host + guest meet over a room link");
      const c4 = await pair(h, world, true); players.push(c4.host, c4.guest);
      await c4.host.page.goto(h.origin + "/connect4.html?room=c4play&role=host", { waitUntil: "domcontentloaded" });
      await c4.guest.page.goto(h.origin + "/connect4.html?room=c4play&role=guest", { waitUntil: "domcontentloaded" });
      await waitStatus(c4.host.page, /Du bass drun/); await waitStatus(c4.guest.page, /De Géigner ass drun/);
      h.expect((await c4.host.page.$$eval("#colbtns button", (bs) => bs.map((b) => b.getBoundingClientRect().height))).every((v) => v >= 44), "column buttons are at least 44 px tall");

      const drop = async (p, col) => { await p.page.click(`#colbtns button >> nth=${col}`); };
      await drop(c4.host, 0);
      await waitStatus(c4.guest.page, /Du bass drun/);
      await drop(c4.guest, 1);
      await waitStatus(c4.host.page, /Du bass drun/);

      h.step("connect4: the guest reloads mid-game and gets the board back");
      await c4.guest.page.reload({ waitUntil: "domcontentloaded" });
      await c4.guest.page.waitForFunction(() => document.querySelectorAll("#board .cell.r, #board .cell.y").length === 2, null, WAIT);
      h.expect(true, "2 discs are back on the reloaded guest's board");
      await waitStatus(c4.host.page, /Du bass drun/);

      h.step("connect4: tapping the board itself drops a disc; the host wins in column 0");
      await c4.host.page.click("#board .cell[data-c='0'] >> nth=0");
      await waitStatus(c4.guest.page, /Du bass drun/);
      await drop(c4.guest, 1);
      await waitStatus(c4.host.page, /Du bass drun/);
      await drop(c4.host, 0);
      await waitStatus(c4.guest.page, /Du bass drun/);
      await drop(c4.guest, 1);
      await waitStatus(c4.host.page, /Du bass drun/);
      await drop(c4.host, 0);
      await waitStatus(c4.host.page, /Du hues gewonn/); await waitStatus(c4.guest.page, /Du hues verluer/);
      h.eq(await c4.host.page.$$eval("#board .cell.win", (c) => c.length), 4, "the four winning discs are marked (host)");
      h.eq(await c4.guest.page.$$eval("#board .cell.win", (c) => c.length), 4, "…and for the loser");
      h.expect(await c4.host.page.isVisible("#rematch") && await c4.guest.page.isVisible("#rematch"), "both see the rematch button");

      h.step("connect4: rematch — the other colour moves first");
      await c4.host.page.click("#rematch");
      await c4.guest.page.waitForFunction(() => document.querySelectorAll("#board .cell.r, #board .cell.y").length === 0, null, WAIT);
      await waitStatus(c4.guest.page, /Du bass drun/); await waitStatus(c4.host.page, /De Géigner ass drun/);
      h.expect(true, "after the rematch the guest (yellow) is on turn, the host waits");

      h.step("connect4: the guest leaves → the host is told to wait");
      await c4.guest.context.close();
      await waitStatus(c4.host.page, /Waart op de Géigner/);
      h.expect(true, "the host sees «Waart op de Géigner»");

      /* ---------------------------------------------------------------- Schëffer versenken */
      h.step("battleship: both fleets ready");
      const bs = await pair(h, world, false); players.push(bs.host, bs.guest);
      await bs.host.page.goto(h.origin + "/battleship.html?room=bsplay&role=host", { waitUntil: "domcontentloaded" });
      await bs.guest.page.goto(h.origin + "/battleship.html?room=bsplay&role=guest", { waitUntil: "domcontentloaded" });
      for (const p of [bs.host, bs.guest]) { await p.page.waitForSelector("#shuffle"); await p.page.click("#shuffle"); await p.page.click("#ready"); }
      await bs.host.page.waitForSelector("#play", { state: "visible", timeout: 20000 });
      await bs.guest.page.waitForSelector("#play", { state: "visible", timeout: 20000 });

      h.step("battleship: shots fly until one fleet is gone; a sunk ship is reported");
      const shipCells = await bs.guest.page.evaluate(() => { const out = []; own.forEach((row, r) => row.forEach((v, c) => { if (v === 1) out.push([r, c]); })); return out; });
      h.eq(shipCells.length, 12, "the guest's fleet has 12 cells (4+3+3+2)");
      const hostTargets = shipCells.map(([r, c]) => r * 8 + c);
      const guestShots = Array.from({ length: 11 }, (_, i) => i);   // the guest fires 11 shots at most: it cannot sink the host's 12 cells
      let sawSunk = false, g = 0;
      for (let k = 0; k < hostTargets.length; k++) {
        await waitStatus(bs.host.page, /Du bass drun/);
        await bs.host.page.click(`#enemy button.cell >> nth=${hostTargets[k]}`);
        await bs.host.page.waitForFunction((n) => enemy.flat().filter((v) => v === 2).length >= n, k + 1, WAIT);   // the answer has arrived
        if (/Schëff versenkt/.test(await text(bs.host.page, "#sub"))) sawSunk = true;
        if (k === hostTargets.length - 1) break;
        await waitStatus(bs.guest.page, /Du bass drun/);
        await bs.guest.page.click(`#enemy button.cell >> nth=${guestShots[g++]}`);
        await waitStatus(bs.host.page, /Du bass drun/);
      }
      await waitStatus(bs.host.page, /Du hues gewonn/); await waitStatus(bs.guest.page, /Du hues verluer/);
      h.expect(sawSunk, "the shooter was told «Schëff versenkt!» when a ship went down");
      h.expect((await bs.host.page.$$("#enemy .cell.sunk")).length === 12, "all 12 cells of the sunk fleet are marked as sunk");

      h.step("battleship: rematch, then the opponent leaves mid-battle");
      await bs.host.page.click("#rematch");
      await bs.guest.page.waitForSelector("#setup", { state: "visible", timeout: 20000 });
      for (const p of [bs.host, bs.guest]) { await p.page.click("#shuffle"); await p.page.click("#ready"); }
      await bs.host.page.waitForSelector("#play", { state: "visible", timeout: 20000 });
      await waitStatus(bs.host.page, /Du bass drun/);
      await bs.guest.context.close();
      await waitStatus(bs.host.page, /De Géigner ass fort/);
      await bs.host.page.click("#enemy button.cell >> nth=0");
      h.expect(await bs.host.page.$$eval("#enemy .cell.hit, #enemy .cell.miss", (c) => c.length) === 0, "no shot goes out while the opponent is away");

      /* ---------------------------------------------------------------- Dammspill: draw rule */
      h.step("checkers: 40 king moves without a capture = draw");
      const ck = await newPlayer(h, world, { label: "checkers", user: USERS.max }); players.push(ck);
      await ck.page.goto(h.origin + "/checkers.html?ai=1", { waitUntil: "domcontentloaded" });
      await ck.page.waitForFunction(() => typeof legalMoves === "function" && document.querySelectorAll("#board .pc").length === 24);
      const end = await ck.page.evaluate(() => {
        board = Array.from({ length: 8 }, () => Array(8).fill(0)); board[7][0] = 3; board[0][7] = 4; turn = 1; over = false; quiet = 0; lock = null;
        const keep = { 1: (m) => m.tr >= 6 && m.tc <= 1, 2: (m) => m.tr <= 1 && m.tc >= 6 };
        let n = 0;
        while (!over && n++ < 80) { const ms = legalMoves(board, turn, null).filter(keep[turn]); if (!ms.length) break; play(ms[0], false); }
        return { over, n, quiet };
      });
      h.eq([end.over, end.n], ["draw", 40], "the 40th quiet king move ends the game as a draw");
      h.expect(/Onentschidden/.test(await statusOf(ck.page)), `the status says «Onentschidden» (${await statusOf(ck.page)})`);

      /* ---------------------------------------------------------------- Faarf roden: reload mid-round */
      h.step("color: host starts a round, the guest reloads and rejoins it");
      const col = await pair(h, world, false); players.push(col.host, col.guest);
      await col.host.page.goto(h.origin + "/color.html?room=colplay&role=host", { waitUntil: "domcontentloaded" });
      await col.guest.page.goto(h.origin + "/color.html?room=colplay&role=guest", { waitUntil: "domcontentloaded" });
      await col.host.page.waitForFunction(() => { const b = document.getElementById("startBtn"); return b && !b.disabled; }, null, WAIT);
      await col.host.page.click("#startBtn");
      await col.guest.page.waitForSelector("#lockBtn", WAIT);
      await col.guest.page.reload({ waitUntil: "domcontentloaded" });
      await col.guest.page.waitForSelector("#lockBtn", WAIT);
      h.expect(true, "the reloaded guest is back in the running round (sliders + lock button)");
      await col.guest.page.click("#lockBtn"); await col.host.page.click("#lockBtn");
      await col.host.page.waitForSelector("table", WAIT); await col.guest.page.waitForSelector("table", WAIT);
      h.expect(true, "both guesses were counted: the round reveals on both screens");
      await col.guest.page.reload({ waitUntil: "domcontentloaded" });
      await col.guest.page.waitForSelector("table", WAIT);
      h.expect(true, "a guest reloading on the results screen gets the results back");

      /* ---------------------------------------------------------------- against the computer */
      h.step("dots: a whole game against the computer (easy), then the rematch button");
      const solo = await newPlayer(h, world, { label: "solo", user: USERS.max }); players.push(solo);
      await solo.page.goto(h.origin + "/dots.html?ai=1&diff=easy", { waitUntil: "domcontentloaded" });
      await solo.page.waitForFunction(() => document.querySelectorAll("#board .dot").length === 25);
      for (let i = 0; i < 80; i++) {
        if (await solo.page.isVisible("#rematch")) break;
        if (/Du bass drun/.test(await statusOf(solo.page)) && await solo.page.$(".edge.open")) await solo.page.click(".edge.open >> nth=0").catch(() => {});
        else await solo.page.waitForTimeout(300);
      }
      h.expect(await solo.page.isVisible("#rematch"), `the game against the computer reaches its end (${await statusOf(solo.page)})`);
      h.expect(/Du hues gewonn|Du hues verluer|Onentschidden/.test(await statusOf(solo.page)), "…and says who won");
      await solo.page.click("#rematch");
      h.eq(await solo.page.$$eval(".edge.set", (e) => e.length), 0, "the rematch starts from an empty board");

      h.step("dice-duel: one turn against the computer, it answers with its own score");
      await solo.page.goto(h.origin + "/dice-duel.html?ai=1", { waitUntil: "domcontentloaded" });
      await solo.page.waitForSelector("#roll:not([disabled])", WAIT);
      await solo.page.click("#roll");
      await solo.page.waitForSelector("#card td.pick button", WAIT);
      const rowTargets = await solo.page.$$eval("#card td.pick button", (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
      h.expect(rowTargets.every((v) => v >= 40), `score buttons are tall enough to tap (${Math.min(...rowTargets)} px)`);
      await solo.page.click("#card td.pick button >> nth=0");
      await solo.page.waitForFunction(() => /Du bass drun/.test(document.getElementById("status").textContent) && document.querySelectorAll("#card td.open").length > 0 && [...document.querySelectorAll("#card tr")].some((tr) => tr.cells[2] && /^\d+$/.test(tr.cells[2].textContent.trim())), null, { timeout: 40000 });
      h.expect(true, "the computer scored a category and it is the player's turn again");

      /* ---------------------------------------------------------------- Stadt-Land-Fluss: reload mid-round */
      h.step("slf: host starts a round, the guest reloads and gets the same letter");
      const slf = await pair(h, world, false); players.push(slf.host, slf.guest);
      await slf.host.page.goto(h.origin + "/slf.html?room=slfplay&role=host", { waitUntil: "domcontentloaded" });
      await slf.guest.page.goto(h.origin + "/slf.html?room=slfplay&role=guest", { waitUntil: "domcontentloaded" });
      await slf.host.page.waitForFunction(() => { const b = document.getElementById("startBtn"); return b && !b.disabled; }, null, WAIT);
      await slf.host.page.click("#startBtn");
      await slf.guest.page.waitForSelector("#c0", WAIT);
      const letterBefore = await text(slf.host.page, ".letter");
      await slf.guest.page.reload({ waitUntil: "domcontentloaded" });
      await slf.guest.page.waitForSelector("#c0", WAIT);
      h.eq(await text(slf.guest.page, ".letter"), letterBefore, "the reloaded guest is back in the running round with the same letter");

      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
