/* Shared multiplayer lobby — batch 2: the 2-player GameCommon games (Tic-Tac-Toe, Reversi, Dots & Boxes, Checkers, Mau-Mau, Kniffel,
 * Battleship) through ONE parameterised flow. For each game (own Realtime hub, own pair of browser contexts):
 *   bare game URL → lobby · create · invite Emma through the picker (mocked mp_invite) · Emma, busy playing the computer, gets the toast
 *   and joins from it · ready/start · both land in the game, a move crosses over · the «‹ Lobby» button (2 taps mid-match, 1 when the
 *   game shows its rematch button) · back in the lobby, start again → a clean board (rematch) · old ?room= link and ?ai=1 still work ·
 *   0 console errors · REST + Realtime frame counts of the session.
 * MP_GAMES=tictactoe,reversi limits the run; MP_LOBBY_REPORT=/path.json writes the numbers. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, countHttp, shotter } from "./mp_lobby_lib.mjs";
import { MP_GAMES } from "../../mp-games.js";

const NAME = "mp-lobby-games";
const REPORT = {};
const TURN_WAIT = { timeout: 20000 };
const statusOf = (page) => text(page, "#status");
const waitStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test((document.getElementById("status")?.textContent || "").replace(/\s+/g, " ")), re.source, TURN_WAIT);
const count = (page, sel) => page.$$(sel).then((a) => a.length);
const waitCount = (page, sel, n) => page.waitForFunction(([s, k]) => document.querySelectorAll(s).length === k, [sel, n], TURN_WAIT);
const bothSeeEachOther = async (host, emma) => { for (const p of [host, emma]) await waitStatus(p.page, /Your turn|Opponent's turn/); };

/* one driver per game: how to see that both players are in, how one player moves and the other sees it, what a fresh match looks like */
const DRIVERS = {
  tictactoe: {
    meet: bothSeeEachOther,
    async move(h, host, emma) {
      await host.page.click("#board button.cell:not([aria-disabled]) >> nth=4");
      await waitCount(emma.page, '#board .cell[data-p="1"]', 1);
      await waitStatus(emma.page, /Your turn/);
      h.expect(true, "X in the middle shows up on Emma's board and it is her turn");
    },
    async fresh(page) { return (await count(page, "#board .cell[data-p]")) === 0; },
    /* a real win, so the lobby button reacts to the game's own rematch button */
    async finish(h, host, emma) {
      const play = async (p, i) => { await waitStatus(p.page, /Your turn/); await p.page.click(`#board .cell >> nth=${i}`); };
      await play(emma, 0); await play(host, 1); await play(emma, 3); await play(host, 7);   // host: 4,1,7 = the middle column
      await host.page.waitForSelector("#rematch", { state: "visible", timeout: 20000 });
      await emma.page.waitForSelector("#rematch", { state: "visible", timeout: 20000 });
    },
  },
  reversi: {
    meet: bothSeeEachOther,
    async move(h, host, emma) {
      await host.page.click(".cell.legal >> nth=0");
      await waitCount(emma.page, "#board .pc", 5);
      await waitStatus(emma.page, /Your turn/);
      h.expect(true, "black's first disc shows up on Emma's board (5 discs)");
    },
    async fresh(page) { return (await count(page, "#board .pc")) === 4; },
  },
  dots: {
    meet: bothSeeEachOther,
    async move(h, host, emma) {
      await host.page.click(".edge.open >> nth=3");
      await waitCount(emma.page, ".edge.set", 1);
      await waitStatus(emma.page, /Your turn/);
      h.expect(true, "the line the host drew appears on Emma's board");
    },
    async fresh(page) { return (await count(page, ".edge.set")) === 0; },
  },
  checkers: {
    meet: bothSeeEachOther,
    async move(h, host, emma) {
      const before = await emma.page.$eval("#board", (b) => b.innerHTML);
      await host.page.click(".pc.mine >> nth=0");
      await host.page.click(".sq.tgt >> nth=0");
      await waitStatus(emma.page, /Your turn/);
      h.expect((await emma.page.$eval("#board", (b) => b.innerHTML)) !== before, "the host's piece moved on Emma's board and it is her turn");
    },
    async fresh(page) { return (await count(page, "#board .pc")) === 24; },
  },
  maumau: {
    meet: async (host, emma) => { for (const p of [host, emma]) await p.page.waitForFunction(() => /Your turn|Opponent's turn/.test(document.getElementById("status")?.textContent || ""), null, TURN_WAIT); },
    async move(h, host, emma) {
      /* whoever's turn it is plays a playable card (or draws); the other must see the pile / the stock change */
      const sig = (p) => p.page.evaluate(() => document.getElementById("top").innerHTML + "|" + document.getElementById("stockN").textContent + "|" + document.getElementById("opp").textContent);
      const handle = await host.page.waitForFunction(() => /Your turn/.test(document.getElementById("status").textContent) || null, null, { timeout: 3000 }).then(() => true, () => false);
      const actor = handle ? host : emma, other = handle ? emma : host;
      const before = await sig(other);
      if (await actor.page.$("#hand .card.ok")) {
        await actor.page.click("#hand .card.ok >> nth=0");
        if (await actor.page.isVisible("#wishbox")) await actor.page.click("#wishbox button >> nth=0");
      } else await actor.page.click("#stock");
      await other.page.waitForFunction((b) => (document.getElementById("top").innerHTML + "|" + document.getElementById("stockN").textContent + "|" + document.getElementById("opp").textContent) !== b, before, TURN_WAIT);
      h.expect(true, `${actor.label}'s card/draw crossed over to ${other.label}`);
    },
    async fresh(page) { return (await count(page, "#hand .card")) === 5; },
  },
  "dice-duel": {
    meet: bothSeeEachOther,
    async move(h, host, emma) {
      await host.page.click("#roll");
      await emma.page.waitForFunction(() => ![...document.querySelectorAll("#dice .die")].some((d) => /not rolled yet/.test(d.getAttribute("aria-label"))), null, TURN_WAIT);
      h.expect(true, "the host's dice show up on Emma's screen");
    },
    async fresh(page) { return (await page.$$eval("#dice .die", (els) => els.every((d) => /not rolled yet/.test(d.getAttribute("aria-label"))))); },
  },
  battleship: {
    meet: async (host, emma) => { for (const p of [host, emma]) await p.page.waitForSelector("#setup", { state: "visible" }); },
    async move(h, host, emma) {
      for (const p of [host, emma]) { await p.page.click("#shuffle"); await p.page.click("#ready"); }
      await host.page.waitForSelector("#play", { state: "visible", timeout: 20000 });
      await emma.page.waitForSelector("#play", { state: "visible", timeout: 20000 });
      await waitStatus(host.page, /Your turn/);
      await host.page.click("#enemy button.cell >> nth=0");
      await emma.page.waitForFunction(() => document.querySelectorAll("#ownSmall .cell.hit, #ownSmall .cell.miss").length === 1, null, TURN_WAIT);
      await waitStatus(emma.page, /Your turn/);
      h.expect(true, "both fleets are ready, the host's shot lands on Emma's grid and it is her turn");
    },
    async fresh(page) { return (await page.isVisible("#setup")) && (await count(page, "#own .cell.ship")) === 0 && /Place your ships/.test(await statusOf(page)); },
  },
};

async function oneGame(h, id, index, players) {
  const g = MP_GAMES[id], d = DRIVERS[id];
  const hub = createHub();
  const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
  const shot = shotter(`${NAME}.${id}`);
  const mine = [];
  const out = { game: id };
  try {
    const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: index === 0 }); mine.push(host); players.push(host);
    const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); mine.push(emma); players.push(emma);

    h.step(`${id}: Emma plays the computer (?ai=1) — no lobby, her page is the old vs-computer game`);
    await emma.page.goto(h.origin + `/${g.page}?ai=1`, { waitUntil: "domcontentloaded" });
    await emma.page.waitForFunction(() => (document.getElementById("status")?.textContent || "").trim().length > 0);
    h.expect(!emma.page.url().includes("lobby.html"), "?ai=1 stays on the game page");
    h.expect(await emma.page.$("#mpgBack") === null, "…without a lobby button");
    h.expect(!/Waiting for opponent/.test(await statusOf(emma.page)), `…and it is a real vs-computer game (${await statusOf(emma.page)})`);
    await new Promise((r) => setTimeout(r, 500));   // her ambient channels subscribe

    h.step(`${id}: bare URL → lobby entry → create`);
    hub.reset();
    await host.page.goto(h.origin + `/${g.page}`, { waitUntil: "commit" });
    await host.page.waitForSelector("#mplCreate");
    h.expect(new RegExp(`lobby\\.html\\?g=${id}`).test(host.page.url()), `redirected to the lobby (${host.page.url().replace(h.origin, "")})`);
    h.expect((await text(host.page, "#mplEntryTitle")).includes(g.name), `entry screen names the game (${g.name})`);
    h.expect((await host.page.$$("a.mpl-link")).some((a) => true) && (await host.page.$(`a.mpl-link[href="${g.page}?ai=1"]`)) !== null, "entry links to the vs-computer game");
    await host.page.click("#mplCreate");
    await host.page.waitForSelector("#mplRoster");
    const code = await lobbyCode(host.page);
    h.expect(/^[A-HJ-NP-Z]{4}$/.test(code), `lobby code ${code}`);
    h.expect(await host.page.isDisabled("#mplStart"), "Start is disabled with one player");
    h.expect(new RegExp(`1/${g.max}`).test(await text(host.page, ".mpl-count")), `1/${g.max} players`);

    h.step(`${id}: invite Emma via the picker → popup → she joins from it`);
    await host.page.click("#mplAdd");
    await host.page.click('.ppk-row[data-name="Emma"]');
    await host.page.click("#ppGo");
    await host.page.waitForSelector(".mpl-row.mpl-invited");
    h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_room, c.p_to]), [[id, code.toLowerCase(), [USERS.emma.id]]], "ONE mp_invite: game id, lowercase code, Emma");
    await emma.page.waitForSelector(".ip-card");
    h.expect((await text(emma.page, ".ip-title")).includes(g.name), `popup names the game (${await text(emma.page, ".ip-title")})`);
    await emma.page.click(".ip-card .ip-primary");
    await emma.page.waitForSelector("#mplRoster");
    await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
    h.eq(await rosterNames(host.page), ["tester (du) 👑 Host", "Emma"], "host sees both players");
    await emma.page.click("#mplReady");
    await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
    await shot(host, "lobby-ready");

    h.step(`${id}: start → both land on the old room link; a move crosses over`);
    await host.page.click("#mplStart");
    await host.page.waitForURL(new RegExp(`${g.page.replace(".", "\\.")}\\?room=`));
    await emma.page.waitForURL(new RegExp(`${g.page.replace(".", "\\.")}\\?room=`));
    h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), `host → ${host.page.url().replace(h.origin, "")}`);
    h.expect(emma.page.url().includes(`room=${code.toLowerCase()}&role=guest&lb=${code}`), `guest → ${emma.page.url().replace(h.origin, "")}`);
    await d.meet(host, emma);
    const ctx = await host.page.evaluate(() => window.MPGate && window.MPGate.ctx && { code: window.MPGate.ctx.code, role: window.MPGate.ctx.role, roster: window.MPGate.ctx.roster.map((r) => r.name) });
    h.eq(ctx, { code, role: "host", roster: ["tester", "Emma"] }, "the game receives roster + role (MPGate.ctx)");
    await d.move(h, host, emma);
    await shot(host, "game");
    out.lobbyToGame = { frames: hub.stats.framesIn + hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut };

    h.step(`${id}: the «‹ Lobby» button follows the game's rematch button`);
    if (d.finish) {
      h.expect(/^‹ Lobby/.test(await text(host.page, "#mpgBack")), "mid-match: plain «‹ Lobby»");
      await d.finish(h, host, emma);
      await host.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "1", null, TURN_WAIT);
      h.expect(/Zréck an d'Lobby/.test(await text(host.page, "#mpgBack")), "match finished (real win): the button changes to «Zréck an d'Lobby» without any extra call from the game");
      await host.page.click("#mpgBack");
      await emma.page.click("#mpgBack");                                       // one tap each
    } else {
      await host.page.evaluate(() => { document.getElementById("rematch").style.display = ""; });
      await host.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "1");
      h.expect(true, "the game shows its rematch button → the lobby button turns into «Zréck an d'Lobby»");
      await host.page.evaluate(() => { document.getElementById("rematch").style.display = "none"; });
      await host.page.waitForFunction(() => document.getElementById("mpgBack")?.dataset.over === "0");
      await host.page.click("#mpgBack");
      h.expect(/Sécher/.test(await text(host.page, "#mpgBack")), "mid-match the button asks for a second tap");
      await host.page.click("#mpgBack");
      await emma.page.click("#mpgBack"); await emma.page.click("#mpgBack");
    }
    await host.page.waitForSelector("#mplRoster");
    await emma.page.waitForSelector("#mplRoster");
    h.eq(await lobbyCode(host.page), code, "same lobby code after leaving the game");
    await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
    h.expect(await host.page.isDisabled("#mplStart"), "ready state was reset");

    h.step(`${id}: rematch from the lobby → a clean game on the same room`);
    await emma.page.click("#mplReady");
    await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
    await host.page.click("#mplStart");
    await host.page.waitForURL(new RegExp(`room=${code.toLowerCase()}&role=host`));
    await emma.page.waitForURL(new RegExp(`room=${code.toLowerCase()}&role=guest`));
    await d.meet(host, emma);
    h.expect(await d.fresh(host.page) && await d.fresh(emma.page), "both players start from a fresh board (the previous match is not restored)");

    h.step(`${id}: old links — ?room= opens the game directly, no lobby`);
    const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.max }); mine.push(legacy); players.push(legacy);
    await legacy.page.goto(h.origin + `/${g.page}?room=abc123&role=guest`, { waitUntil: "domcontentloaded" });
    await legacy.page.waitForFunction(() => (document.getElementById("status")?.textContent || "").trim().length > 0);
    h.expect(legacy.page.url().includes("room=abc123") && !legacy.page.url().includes("lobby.html"), "?room=abc123&role=guest opens the game");
    h.expect(await legacy.page.$("#mpgBack") === null, "…without a lobby button");

    out.requests = { host: host.http.length, emma: emma.http.length, hostList: host.http };
    out.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, framesIn: hub.stats.framesIn, framesOut: hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut };
    h.expect(countHttp(host, /^[A-Z]+ game_invites/) === 0, "host never touches the game_invites table (no polling)");
    h.expect(countHttp(host, /rpc\/mp_invite/) === 1 && countHttp(host, /rpc\/my_friends/) === 1, "host: exactly 1 mp_invite + 1 my_friends");
    console.log(`    ${id}: host REST ${host.http.length} · emma REST ${emma.http.length} · realtime ${out.realtime.frames} frames / ${out.realtime.bytes} B`);
    for (const p of mine) h.eq(realErrors(p), [], `${id}: no console errors (${p.label})`);
  } finally {
    await closePlayers(mine);
    REPORT[id] = out;
  }
}

export const flow = {
  name: NAME,
  async run(h) {
    const wanted = (process.env.MP_GAMES || Object.keys(DRIVERS).join(",")).split(",").filter(Boolean);
    const players = [];
    try {
      let i = 0;
      for (const id of wanted) { await oneGame(h, id, i++, players); }
    } finally {
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".games.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
