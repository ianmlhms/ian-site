/* Shared multiplayer lobby — pilot 2: Stadt-Land-Fluss (3+ players, host settings, host hand-over).
 *   tester (host, signed in) · Emma (friend, invited by toast) · Gast (signed out, joins by link) — one browser, one Realtime hub.
 * Covers: the game's declared settings (categories: host edits, the others see them read-only), invite toast → join, a guest joining
 * by link, host removes a player (who lands back on the entry screen), ready/start with three players, the game receiving roster +
 * settings (round 1 opens by itself with the chosen categories), back to lobby, the host leaving in the lobby → Emma takes over
 * with the settings carried over, and the budget of the whole session. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, sleep, shotter } from "./mp_lobby_lib.mjs";
import { MP_GAMES } from "../../mp-games.js";

const NAME = "mp-lobby-slf";
const REPORT = {};
const pressed = (page) => page.$$eval("#mplSettings .mpl-chip", (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent.trim()));

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
    const shot = shotter(NAME);
    const players = [];
    try {
      /* the registry's category list must match the page's CATALOG (index = value) */
      const slfHtml = fs.readFileSync(new URL("../../slf.html", import.meta.url), "utf8");
      const catalog = [...slfHtml.slice(slfHtml.indexOf("const CATALOG = ["), slfHtml.indexOf("const DEFAULT_CATS")).matchAll(/name:"([^"]+)"/g)].map((m) => m[1]);
      h.eq(MP_GAMES.slf.settings[0].options.map((o) => o.label), catalog, "lobby category list = slf.html CATALOG (same order)");

      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); players.push(emma);
      const guest = await newPlayer(h, world, { label: "guest" }); players.push(guest);
      await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#board .cell");
      await sleep(600);

      h.step("host opens slf.html → lobby → create; the game's category settings are there");
      hub.reset();
      await host.page.goto(h.origin + "/slf.html", { waitUntil: "commit" });
      await host.page.waitForSelector("#mplCreate");
      h.expect(/g=slf/.test(host.page.url()), "bare slf.html is sent to the lobby");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplSettings .mpl-chip");
      const code = await lobbyCode(host.page);
      h.eq(await pressed(host.page), ["Stadt", "Land", "Fluss", "Name", "Tier", "Beruf"], "default: the classic six categories");
      h.expect(await host.page.$$eval("#mplSettings .mpl-chip", (els) => els.every((e) => !e.disabled)), "host can edit the settings");
      await host.page.click('#mplSettings .mpl-chip:text-is("Tier")');
      await host.page.click('#mplSettings .mpl-chip:text-is("Farbe")');
      h.eq(await pressed(host.page), ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "host swaps Tier for Farbe");
      // at least two categories must stay
      for (const c of ["Land", "Fluss", "Name", "Beruf", "Farbe"]) await host.page.click(`#mplSettings .mpl-chip:text-is("${c}")`);
      h.eq(await pressed(host.page), ["Stadt", "Farbe"], "the last two categories cannot be removed");
      for (const c of ["Land", "Fluss", "Name", "Beruf"]) await host.page.click(`#mplSettings .mpl-chip:text-is("${c}")`);
      h.eq(await pressed(host.page), ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "…and six are back");

      h.step("invite Emma through the picker → toast → she joins");
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click("#ppGo");
      await emma.page.waitForSelector(".ntf");
      h.expect(/Stadt-Land-Fluss/.test(await text(emma.page, ".ntf")), `toast names the game (${await text(emma.page, ".ntf")})`);
      await emma.page.click(".ntf");
      await emma.page.waitForSelector("#mplRoster");
      h.eq(await pressed(emma.page), ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "Emma sees the host's categories");
      h.expect(await emma.page.$$eval("#mplSettings .mpl-chip", (els) => els.every((e) => e.disabled)), "…read-only for her");

      h.step("a signed-out guest joins with the link");
      await guest.page.goto(h.origin + `/lobby.html?g=slf&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplRoster");
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 3);
      const names = await rosterNames(host.page);
      h.expect(names.length === 3 && names[1] === "Emma" && /^Gast\d{3}$/.test(names[2]), `roster: ${names.join(" | ")}`);
      await shot(host, "lobby-three");

      h.step("host removes the guest → the guest is back at the entry screen with a message, then rejoins");
      await host.page.click('#mplRoster .mpl-row:nth-child(3) .mpl-x');
      await guest.page.waitForSelector("#mplMsg:not([hidden])");
      h.expect(/Lobby geholl/.test(await text(guest.page, "#mplMsg")), `guest is told (${await text(guest.page, "#mplMsg")})`);
      await guest.page.fill("#mplCode", code);
      await guest.page.click("#mplJoin");
      await guest.page.waitForSelector("#mplRoster");
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 3);
      h.expect(true, "…and is in again");

      h.step("everybody ready → Start (all three need to be ready)");
      await emma.page.click("#mplReady");
      await sleep(300);
      h.expect(await host.page.isDisabled("#mplStart"), "one player not ready → Start stays disabled");
      await guest.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
      const budgetLobby = { framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut };
      await host.page.click("#mplStart");
      for (const p of [host, emma, guest]) await p.page.waitForURL(/slf\.html\?room=/, { timeout: 20000 });
      h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), "host → old room link + lb");
      h.expect(emma.page.url().includes("role=guest") && guest.page.url().includes("role=guest"), "the others are guests");

      h.step("the game opens round 1 by itself with the lobby's categories");
      for (const p of [host, emma, guest]) await p.page.waitForSelector("#c0", { timeout: 30000 });
      const labels = await host.page.$$eval(".cat label", (els) => els.map((e) => e.textContent.trim()));
      h.eq(labels, ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "round 1 uses the host's six categories on the host…");
      h.eq(await guest.page.$$eval(".cat label", (els) => els.map((e) => e.textContent.trim())), labels, "…and on the guest");
      h.eq(await host.page.$$eval(".players .pchip", (els) => els.length), 3, "three players in the round");
      await shot(host, "game");

      h.step("back to the lobby (‹ Lobby, two taps mid-round); host reopens the same code");
      await host.page.click("#mpgBack"); await host.page.click("#mpgBack");
      await host.page.waitForSelector("#mplRoster");
      h.eq(await lobbyCode(host.page), code, "same code");
      for (const p of [emma, guest]) { await p.page.click("#mpgBack"); await p.page.click("#mpgBack"); await p.page.waitForSelector("#mplRoster"); }
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 3);
      h.eq(await pressed(host.page), ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "the settings are still the host's choice");

      h.step("the host leaves → the longest-present player (Emma) takes over, settings carried over");
      await host.page.click("#mplLeave");
      await emma.page.waitForFunction(() => /Host/.test(document.querySelector("#mplRoster .mpl-row")?.textContent || "") && /Emma/.test(document.querySelector("#mplRoster .mpl-row")?.textContent || ""), null, { timeout: 15000 });
      h.expect(await emma.page.isVisible("#mplStart") && await emma.page.isHidden("#mplReady"), "Emma now has Start instead of Ready");
      h.expect(await emma.page.$$eval("#mplSettings .mpl-chip", (els) => els.every((e) => !e.disabled)), "Emma can edit the settings now");
      h.eq(await pressed(emma.page), ["Stadt", "Land", "Fluss", "Name", "Beruf", "Farbe"], "…and they are the same as before the host left");
      await guest.page.waitForFunction(() => /Emma/.test(document.querySelector(".mpl-toast")?.textContent || ""));
      h.expect(/Host/.test(await text(guest.page, ".mpl-toast")), `the guest is told (${await text(guest.page, ".mpl-toast")})`);
      h.eq(await rosterNames(guest.page).then((n) => n.map((x) => x.replace(/ \(du\)/, ""))), ["Emma 👑 Host", (await rosterNames(guest.page))[1].replace(/ \(du\)/, "")], "guest's roster: Emma (host) + herself");
      await shot(emma, "after-handover");
      h.expect(await emma.page.isDisabled("#mplStart"), "Emma cannot start alone (needs 2 players)");

      REPORT.lobbyBeforeStart = budgetLobby;
      REPORT.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut, topics: hub.stats.topicsSeen };
      REPORT.requests = Object.fromEntries(players.map((p) => [p.label, p.http]));
      console.log("    requests host:", JSON.stringify(host.http));
      console.log("    requests guest:", JSON.stringify(guest.http));
      console.log("    realtime (all, incl. the game rounds):", JSON.stringify(REPORT.realtime), "· lobby before Start:", JSON.stringify(budgetLobby));
      h.expect(!guest.http.some((x) => /rpc|rest/.test(x) && !/profiles/.test(x)), "signed-out guest: no REST except the shared page extras");
      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".slf.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
