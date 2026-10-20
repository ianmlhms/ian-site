/* Shared multiplayer lobby — pilot 1: Connect 4 (2 players, turn based).
 * Three browser contexts, one in-process Realtime hub, nothing reaches the live project:
 *   tester (host, signed in)  ·  Emma (friend, signed in, busy in a Connect 4 vs-computer game)  ·  Gast (signed out)
 * Covers: bare game URL → lobby, create (4-letter code), add people via the shared picker, the invite popup on Emma's page, join
 * from the toast, ready/start, the game itself (a move crosses over), back to the lobby for a rematch, a full lobby, a guest joining
 * by link, old ?room= links, and the request / realtime-frame budget of the whole session (printed + MP_LOBBY_REPORT=/path.json). */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, countHttp, sleep, shotter } from "./mp_lobby_lib.mjs";

const NAME = "mp-lobby-connect4";
const REPORT = {};

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id, USERS.max.id], [USERS.emma.id]: [USERS.ian.id] } });
    const shot = shotter(NAME);
    const players = [];
    try {
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); players.push(emma);
      const guest = await newPlayer(h, world, { label: "guest" }); players.push(guest);

      /* Emma is busy playing the computer: only the ambient listener of the page can reach her */
      await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#board .cell");
      h.expect(!emma.page.url().includes("lobby.html"), "?ai=1 is not sent to the lobby (old link works)");
      await sleep(600);                                            // her ambient channels subscribe

      h.step("host opens the bare game URL → the lobby entry screen");
      hub.reset();
      await host.page.goto(h.origin + "/connect4.html", { waitUntil: "commit" });
      await host.page.waitForSelector("#mplCreate");
      h.expect(/lobby\.html\?g=connect4/.test(host.page.url()), `redirected to the lobby (${host.page.url().replace(h.origin, "")})`);
      h.expect(/Connect 4/.test(await text(host.page, "#mplEntryTitle")), "entry screen names the game");
      h.expect(await host.page.isVisible("#mplQuick") && await host.page.isVisible("#mplJoin"), "entry offers create / quick match / join by code");
      h.expect((await host.page.$$("a.mpl-link")).length >= 2, "entry links to vs-computer and the arcade");
      await shot(host, "entry");

      h.step("create a lobby → 4-letter code, roster with the host");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplRoster");
      const code = await lobbyCode(host.page);
      h.expect(/^[A-HJ-NP-Z]{4}$/.test(code), `lobby code is 4 letters (${code})`);
      h.eq(await rosterNames(host.page), ["tester (du) 👑 Host"], "roster shows the host only");
      h.expect(await host.page.isDisabled("#mplStart"), "Start is disabled until a second player is ready");
      h.expect(/1\/2/.test(await text(host.page, ".mpl-count")), "1/2 players");
      await shot(host, "lobby-host-alone");

      h.step("add people: the shared picker (friends list + name search + chips)");
      await host.page.click("#mplAdd");
      await host.page.waitForSelector(".ppk-box #ppSearch");
      const friendRows = await host.page.$$eval(".ppk-row", (els) => els.map((e) => e.dataset.name));
      h.eq(friendRows, ["Emma", "Max"], "friends are listed in the picker");
      await host.page.keyboard.type("emm", { delay: 60 });
      await host.page.waitForSelector(".ps-drop.open .ps-item");
      const found = await host.page.$$eval(".ps-drop.open .ps-item", (els) => els.map((e) => e.textContent.trim()));
      h.expect(found.length >= 1 && found.some((n) => /Emmi/.test(n)), `name search finds people (${found.join(" | ")})`);
      await host.page.click(".ps-drop.open .ps-item >> text=Emmi");
      await host.page.click('.ppk-row[data-name="Emma"]');
      h.eq(await host.page.$$eval(".pp-chip", (els) => els.map((e) => e.firstChild.textContent.trim())), ["Emmi", "Emma"], "two chips: Emmi + Emma");
      h.expect((await text(host.page, "#ppGo")) === "2 invitéieren", `confirm button counts them (${await text(host.page, "#ppGo")})`);
      await shot(host, "picker");
      await host.page.click('.pp-chip button[aria-label*="Emmi"]');
      h.eq(await host.page.$$eval(".pp-chip", (els) => els.map((e) => e.firstChild.textContent.trim())), ["Emma"], "a chip can be removed again");
      await host.page.click("#ppGo");
      await host.page.waitForSelector(".ppk-box", { state: "detached" });
      await host.page.waitForSelector(".mpl-row.mpl-invited");
      h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_room, c.p_to]), [["connect4", code.toLowerCase(), [USERS.emma.id]]], "ONE mp_invite request: game, lowercase code, Emma");
      h.expect(/invitéiert/.test(await text(host.page, ".mpl-row.mpl-invited")), "roster shows «Emma — invitéiert…»");

      h.step("Emma gets the invite popup while she plays, taps it, lands in the lobby");
      await emma.page.waitForSelector(".ip-card");
      const toast = await text(emma.page, ".ip-title");
      h.expect(/tester/.test(popup) && /Connect 4/.test(popup), `popup names the host and the game (${toast})`);
      await shot(emma, "invite-toast");
      await emma.page.click(".ip-card .ip-primary");
      await emma.page.waitForSelector("#mplRoster");
      h.expect(emma.page.url().includes("c=" + code), "Emma joined the lobby with the code from the invite");
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
      h.eq(await rosterNames(host.page), ["tester (du) 👑 Host", "Emma"], "host sees both players");
      h.eq(await host.page.$$(".mpl-row.mpl-invited").then((r) => r.length), 0, "the «invited» placeholder is replaced by Emma");
      h.expect(await emma.page.isHidden("#mplStart") && await emma.page.isVisible("#mplReady"), "Emma has Ready, only the host has Start");
      h.expect(await emma.page.isDisabled("#mplAdd") === false, "every member may add people");
      h.expect(await host.page.isDisabled("#mplStart"), "host cannot start before Emma is ready");

      h.step("Emma is ready → host can start");
      await emma.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
      h.expect(/prett/.test(await text(host.page, '.mpl-row[data-ready="1"]:not(:first-child) .mpl-state')), "host sees Emma as ready");
      await shot(host, "lobby-ready");
      const budgetOpen = { frames: { ...hub.stats }, hostHttp: [...host.http], emmaHttp: [...emma.http] };

      h.step("a third person cannot get into a full lobby; a signed-out guest sees the error");
      await guest.page.goto(h.origin + `/lobby.html?g=connect4&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplMsg:not([hidden])");
      h.expect(/voll/.test(await text(guest.page, "#mplMsg")), `guest is told the lobby is full (${await text(guest.page, "#mplMsg")})`);

      h.step("start → both land in the game with the old room link; a move crosses over");
      await host.page.click("#mplStart");
      await host.page.waitForURL(/connect4\.html\?room=/);
      await emma.page.waitForURL(/connect4\.html\?room=/);
      h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), `host → ${host.page.url().replace(h.origin, "")}`);
      h.expect(emma.page.url().includes(`room=${code.toLowerCase()}&role=guest&lb=${code}`), `guest → ${emma.page.url().replace(h.origin, "")}`);
      await host.page.waitForFunction(() => /Your turn/.test(document.getElementById("status")?.textContent || ""), null, { timeout: 15000 });
      h.expect(true, "the game found the opponent (status: Your turn)");
      const ctx = await host.page.evaluate(() => window.MPGate && window.MPGate.ctx && { code: window.MPGate.ctx.code, role: window.MPGate.ctx.role, roster: window.MPGate.ctx.roster.map((r) => r.name) });
      h.eq(ctx, { code, role: "host", roster: ["tester", "Emma"] }, "the game receives the roster + role from the lobby (MPGate.ctx)");
      await host.page.click("#colbtns button >> nth=3");
      await emma.page.waitForFunction(() => document.querySelectorAll("#board .cell.r").length === 1);
      h.expect(true, "the host's move shows up on Emma's board");
      await shot(host, "game");
      REPORT.lobbyToGame = { hubFrames: { ...hub.stats, perContext: undefined, byEvent: undefined }, perContext: hub.stats.perContext };

      h.step("back to the lobby (rematch): the host reopens the SAME code, Emma follows");
      await host.page.click("#mpgBack");                                  // mid-game: asks to confirm
      h.expect(/Sécher/.test(await text(host.page, "#mpgBack")), "mid-game the button asks for a second tap");
      await host.page.click("#mpgBack");
      await host.page.waitForSelector("#mplRoster");
      h.eq(await lobbyCode(host.page), code, "same code after the rematch");
      await emma.page.click("#mpgBack");
      await emma.page.click("#mpgBack");
      await emma.page.waitForSelector("#mplRoster");
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
      h.eq(await rosterNames(host.page), ["tester (du) 👑 Host", "Emma"], "both are back in the lobby");
      h.expect(await host.page.isDisabled("#mplStart"), "ready state was reset");

      h.step("a signed-out guest joins a fresh lobby by link (no sign-in needed), cannot invite");
      await host.page.click("#mplLeave");
      await host.page.waitForSelector("#mplCreate");
      await emma.page.waitForFunction(() => document.querySelector(".mpl-row .mpl-tag")?.closest(".mpl-row")?.textContent.includes("Emma"));
      h.expect(true, "Emma became host when the host left (hand-over)");
      await guest.page.goto(h.origin + `/lobby.html?g=connect4&c=${code}`, { waitUntil: "domcontentloaded" });
      await guest.page.waitForSelector("#mplRoster");
      h.expect((await rosterNames(guest.page))[0] === "Emma 👑 Host", "guest sees Emma as the host");
      h.expect(/Gast\d{3}/.test((await rosterNames(guest.page))[1] || ""), `guest got a Gast### name (${(await rosterNames(guest.page))[1]})`);
      await guest.page.click("#mplAdd");
      h.expect(/Mell dech un/.test(await text(guest.page, ".mpl-toast")), "a guest is asked to sign in before inviting");
      await shot(guest, "guest-lobby");

      /* ---------------- old links ---------------- */
      h.step("old room links still go straight to the game");
      const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.max }); players.push(legacy);
      await legacy.page.goto(h.origin + "/connect4.html?room=abc123&role=guest", { waitUntil: "domcontentloaded" });
      await legacy.page.waitForSelector("#board .cell");
      h.expect(legacy.page.url().includes("room=abc123") && !legacy.page.url().includes("lobby.html"), "?room=abc123&role=guest opens the game, no lobby");
      h.expect(await legacy.page.$("#mpgBack") === null, "no lobby button for an old link");
      h.expect(/Waiting for opponent/.test(await text(legacy.page, "#status")), "…and waits for an opponent like before");

      /* ---------------- budget ---------------- */
      const sum = (arr, re) => arr.filter((x) => re.test(x)).length;
      REPORT.requests = {
        host: { total: host.http.length, list: host.http },
        emma: { total: emma.http.length, list: emma.http },
        guest: { total: guest.http.length, list: guest.http },
      };
      REPORT.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut, topics: hub.stats.topicsSeen };
      REPORT.openToReady = { framesIn: budgetOpen.frames.framesIn, framesOut: budgetOpen.frames.framesOut, bytes: budgetOpen.frames.bytesIn + budgetOpen.frames.bytesOut };
      h.expect(sum(host.http, /rpc\/mp_invite/) === 1 && countHttp(host, /rpc\/my_friends/) === 1, "host: exactly 1 mp_invite + 1 my_friends");
      h.expect(countHttp(host, /^[A-Z]+ game_invites/) === 0, "host: never reads or writes the game_invites table (no polling)");
      h.expect(countHttp(host, /rpc\/my_game_invites/) <= 2, "host: my_game_invites only when an entry screen opened (2x)");
      console.log("    requests host:", JSON.stringify(host.http));
      console.log("    requests emma:", JSON.stringify(emma.http));
      console.log("    realtime:", JSON.stringify(REPORT.realtime), "· open→ready:", JSON.stringify(REPORT.openToReady));

      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".connect4.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
