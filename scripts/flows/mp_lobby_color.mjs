/* Shared multiplayer lobby — Colour Guess (2–8 players, host settings: rounds + colour mode). FOUR players in one browser, one Realtime hub:
 *   tester (host) · Emma + Max (friends, invited together in ONE mp_invite, both busy in another game) · Gast (signed out, joins by link).
 * Covers: bare color.html → lobby, the game's declared settings (rounds, flash mode), invite toasts → join, ready/start, the game
 * opens round 1 by itself with the host's rounds + mode on every device, a full round (everybody locks a colour in → results on all four),
 * the «‹ Lobby» button (two taps mid-round, one after the final round), settings kept after the rematch, ?ai=1 and the old ?room= link,
 * and the request/frame budget of a 4-player session. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, countHttp, sleep, shotter } from "./mp_lobby_lib.mjs";

const NAME = "mp-lobby-color";
const REPORT = {};
const pressed = (page) => page.$$eval("#mplSettings .mpl-chip", (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent.trim()));
const inRoom = (page, n) => page.waitForFunction((k) => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === k, n, { timeout: 20000 });

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id, USERS.max.id], [USERS.emma.id]: [USERS.ian.id], [USERS.max.id]: [USERS.ian.id] } });
    const shot = shotter(NAME);
    const players = [];
    try {
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); players.push(emma);
      const max = await newPlayer(h, world, { label: "max", user: USERS.max }); players.push(max);
      const guest = await newPlayer(h, world, { label: "guest" }); players.push(guest);

      h.step("Emma plays Colour Guess against the computer (?ai=1); Max plays Connect 4 — no lobby for either");
      await emma.page.goto(h.origin + "/color.html?ai=1", { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#startBtn");
      h.expect(!emma.page.url().includes("lobby.html") && await emma.page.$("#mpgBack") === null, "?ai=1 opens the old vs-computer game");
      h.expect(/Pixel/.test(await text(emma.page, "#app")), "…with the computer players (Pixel, Byte)");
      await max.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });
      await max.page.waitForSelector("#board .cell");
      await sleep(600);

      h.step("host opens color.html → lobby → create; the game's settings (rounds, mode) are there");
      hub.reset();
      await host.page.goto(h.origin + "/color.html", { waitUntil: "commit" });
      await host.page.waitForSelector("#mplCreate");
      h.expect(/g=color/.test(host.page.url()), "bare color.html is sent to the lobby");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplSettings .mpl-chip");
      const code = await lobbyCode(host.page);
      h.eq(await pressed(host.page), ["5", "👁 Stays visible"], "defaults: 5 rounds, colour stays visible");
      await host.page.click('#mplSettings .mpl-chip:text-is("3")');
      await host.page.click('#mplSettings .mpl-chip:text-is("⚡ Flash (memory)")');
      h.eq(await pressed(host.page), ["3", "⚡ Flash (memory)"], "host picks 3 rounds + flash mode");

      h.step("invite Emma and Max with ONE request → both toasts → both join");
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click('.ppk-row[data-name="Max"]');
      await host.page.click("#ppGo");
      await host.page.waitForSelector(".mpl-row.mpl-invited");
      h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_to.length]), [["color", 2]], "ONE mp_invite with two people");
      for (const p of [emma, max]) {
        await p.page.waitForSelector(".ntf");
        h.expect(/Colour Guess/.test(await text(p.page, ".ntf")), `${p.label}: toast names the game`);
        await p.page.click(".ntf");
        await p.page.waitForSelector("#mplRoster");
      }
      await guest.page.goto(h.origin + `/lobby.html?g=color&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplRoster");
      await inRoom(host.page, 4);
      h.expect(/4\/8/.test(await text(host.page, ".mpl-count")), "4/8 players");
      h.eq(await pressed(emma.page), ["3", "⚡ Flash (memory)"], "Emma sees the host's settings");
      h.expect(await emma.page.$$eval("#mplSettings .mpl-chip", (els) => els.every((e) => e.disabled)), "…read-only for her");
      await shot(host, "lobby-four");

      h.step("everyone ready → Start");
      for (const p of [emma, max]) await p.page.click("#mplReady");
      await sleep(300);
      h.expect(await host.page.isDisabled("#mplStart"), "one player (the guest) not ready → Start stays disabled");
      await guest.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
      const lobbyFrames = { framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut };
      const gameStats0 = { framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut };
      await host.page.click("#mplStart");
      const all = [host, emma, max, guest];
      for (const p of all) await p.page.waitForURL(/color\.html\?room=/, { timeout: 20000 });
      h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), "host → old room link + lb");

      h.step("round 1 opens by itself with 3 rounds, flash mode, four players");
      for (const p of all) await p.page.waitForSelector("#lockBtn", { timeout: 30000 });
      for (const p of all) h.expect(/Round 1 \/ 3/.test(await text(p.page, "#app")), `${p.label}: «Round 1 / 3»`);
      h.eq(await host.page.$$eval(".players .pchip", (els) => els.length), 4, "four players in the round");
      await host.page.waitForFunction(() => document.querySelector(".swatch.covered"), null, { timeout: 15000 });
      h.expect(true, "flash mode: the colour is covered after the peek (from memory)");
      h.expect(/^‹ Lobby/.test(await text(host.page, "#mpgBack")), "mid-round: plain «‹ Lobby»");
      await shot(host, "round");

      h.step("everybody locks a colour in → the results reach all four");
      for (const p of all) await p.page.click("#lockBtn");
      for (const p of all) await p.page.waitForFunction(() => document.querySelector("table")?.rows.length === 5, null, { timeout: 20000 });
      h.eq(await guest.page.evaluate(() => document.querySelector("table").rows.length), 5, "the guest's result table: header + four players");
      h.expect(await host.page.isVisible("#nextBtn") && await guest.page.$("#nextBtn") === null, "only the host gets «Next round»");
      h.expect((await host.page.evaluate(() => document.getElementById("mpgBack").dataset.over)) === "0", "between rounds the lobby button still asks for a second tap");

      h.step("play the remaining rounds; after the final round «‹ Lobby» is one tap");
      for (let r = 2; r <= 3; r++) {
        await host.page.click("#nextBtn");
        for (const p of all) await p.page.waitForSelector("#lockBtn", { timeout: 20000 });
        for (const p of all) await p.page.click("#lockBtn");
        for (const p of all) await p.page.waitForFunction(() => document.querySelector("table")?.rows.length === 5, null, { timeout: 20000 });
      }
      await host.page.waitForSelector("#againBtn");
      for (const p of all) await p.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "1");
      h.expect(/Zréck an d'Lobby/.test(await text(guest.page, "#mpgBack")), "final results: the button turns into «Zréck an d'Lobby»");
      await shot(host, "final");

      h.step("back to the lobby: same code, the host's settings are still there");
      for (const p of all) { await p.page.click("#mpgBack"); await p.page.waitForSelector("#mplRoster"); }
      await inRoom(host.page, 4);
      h.eq(await lobbyCode(host.page), code, "same code");
      h.eq(await pressed(host.page), ["3", "⚡ Flash (memory)"], "rounds + mode survived the rematch");
      REPORT.lobbyBeforeStart = lobbyFrames;

      h.step("old links: ?room= opens the game directly (the old in-game lobby with its Start button), no lobby chip");
      const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.lena }); players.push(legacy);
      await legacy.page.goto(h.origin + "/color.html?room=abc123&role=host", { waitUntil: "domcontentloaded" });
      await legacy.page.waitForSelector("#startBtn");
      h.expect(legacy.page.url().includes("room=abc123") && !legacy.page.url().includes("lobby.html") && await legacy.page.$("#mpgBack") === null, "old host link works");
      await sleep(1500);
      h.expect(await legacy.page.isDisabled("#startBtn"), "…and waits for a second player like before (nobody auto-starts an old link)");

      REPORT.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut, topics: hub.stats.topicsSeen };
      REPORT.requests = Object.fromEntries(players.map((p) => [p.label, p.http.length]));
      REPORT.hostRequests = host.http;
      REPORT.gameStats0 = gameStats0;
      h.expect(countHttp(host, /^[A-Z]+ game_invites/) === 0, "host never touches the game_invites table (no polling)");
      h.expect(countHttp(host, /rpc\/mp_invite/) === 1, "host: one mp_invite for both friends");
      console.log("    requests (all page loads included):", JSON.stringify(REPORT.requests));
      console.log("    realtime (whole 4-player session incl. 3 rounds):", JSON.stringify(REPORT.realtime), "· lobby until Start:", JSON.stringify(lobbyFrames));
      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".color.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
