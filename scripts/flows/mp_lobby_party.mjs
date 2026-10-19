/* Shared multiplayer lobby — the party games with their own channel setup (Draw & Guess, Meme Caption Party, Guess the Song).
 * One parameterised flow, THREE players per game in one browser (own Realtime hub per game):
 *   tester (host) · Emma (friend, invited by toast, busy in another game) · Gast (signed out, joins by link)
 * Per game: bare URL → lobby (entry has no vs-computer link: these games have none) · create · invite · join from the toast · guest by link ·
 * ready/start · the game starts BY ITSELF (draw, meme: host auto-start) or, for Guess the Song, shows the host's lobby settings and waits for his
 * Start tap (audio needs a gesture) · a round crosses between the three · «‹ Lobby» · rematch · old ?room= link · 0 console errors.
 * MP_GAMES=draw limits the run; MP_LOBBY_REPORT=/path.json writes the numbers. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, countHttp, sleep, shotter } from "./mp_lobby_lib.mjs";
import { MP_GAMES } from "../../mp-games.js";

const NAME = "mp-lobby-party";
const REPORT = {};
const T = { timeout: 30000 };
const inRoom = (page, n) => page.waitForFunction((k) => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === k, n, { timeout: 20000 });
const pressed = (page) => page.$$eval("#mplSettings .mpl-chip", (els) => els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.textContent.trim()));
const tiny = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=", "base64");   // empty wav

const DRIVERS = {
  draw: {
    async started(h, all) {
      for (const p of all) await p.page.waitForFunction(() => document.querySelectorAll(".scores .pchip").length === 3 && /Turn 1\//.test(document.body.textContent), null, T);
      h.expect(true, "round 1 opened by itself on all three devices (host auto-start)");
    },
    async round(h, all, hub) {
      /* the drawer is the one who gets word choices */
      const drawer = await Promise.any(all.map(async (p) => { await p.page.waitForSelector("#choices button", T); return p; }));
      const others = all.filter((p) => p !== drawer);
      await drawer.page.click("#choices button >> nth=0");
      for (const p of others) await p.page.waitForFunction(() => /^_( _)*$/.test(document.getElementById("wordEl")?.textContent || ""), null, T);
      h.expect(true, `${drawer.label} picked a word; the others see the masked word`);
      const box = await drawer.page.locator("#cv").boundingBox();
      const before = hub.stats.byEvent["in:broadcast:seg"] || 0;
      await drawer.page.mouse.move(box.x + 60, box.y + 60); await drawer.page.mouse.down();
      await drawer.page.mouse.move(box.x + 200, box.y + 160, { steps: 6 }); await drawer.page.mouse.up();
      await sleep(400);
      h.expect((hub.stats.byEvent["in:broadcast:seg"] || 0) > before, "the stroke left the drawer as a batched broadcast");
      const guesser = others.find((p) => p.label !== "host") || others[0];
      const watcher = others.find((p) => p !== guesser);
      await guesser.page.fill("#guessIn", "qqqq"); await guesser.page.click("#guessBtn");
      await watcher.page.waitForFunction(() => /qqqq/.test(document.getElementById("log")?.textContent || ""), null, T);
      h.expect(true, `${guesser.label}'s guess shows up in ${watcher.label}'s chat`);
    },
    fresh: (page) => page.waitForFunction(() => document.querySelectorAll(".scores .pchip").length === 3 && /Turn 1\//.test(document.body.textContent), null, T),
  },
  meme: {
    async started(h, all) {
      for (const p of all) await p.page.waitForSelector("#capT", T);
      h.expect(true, "round 1 opened by itself on all three devices (host auto-start)");
    },
    async round(h, all) {
      for (const p of all) { await p.page.fill("#capT", "HELLO"); await p.page.click("#capBtn"); }
      for (const p of all) await p.page.waitForFunction(() => document.querySelectorAll(".ventry").length === 3, null, T);
      h.expect(true, "all three captions reached everybody: the vote screen shows 3 memes");
    },
    fresh: (page) => page.waitForSelector("#capT", T),
  },
  intro: {
    settingsClicks: [["#mplSettings .mpl-setting >> nth=0", "🎸 Rock"], ["#mplSettings .mpl-setting >> nth=1", "8"], ["#mplSettings .mpl-setting >> nth=2", "🎧 All Handy"]],
    expectPressed: ["🎸 Rock", "8", "🎧 All Handy"],
    async started(h, all) {
      const host = all[0];
      await host.page.waitForSelector("#startBtn", { state: "visible", ...T });
      h.eq(await host.page.$$eval("#cats .pick.on, #counts .pick.on, #modes .pick.on", (els) => els.map((e) => e.dataset.cat ?? e.dataset.count ?? e.dataset.mode)), ["4", "8", "each"], "the game's own lobby opens with the lobby settings: Rock, 8 songs, own phone");
      for (const p of all.slice(1)) await p.page.waitForFunction(() => /Waart/.test(document.getElementById("lobbyNote")?.textContent || "") && document.querySelectorAll("#lobbyPlayers .sc").length === 3, null, T);
      h.expect(true, "the others wait for the host; everybody sees 3 players");
    },
    async round(h, all) {
      const host = all[0];
      await host.page.context().route(/itunes\.apple\.com\/lookup/, (route) => {
        const ids = (new URL(route.request().url()).searchParams.get("id") || "").split(",").filter(Boolean);
        route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ results: ids.map((id) => ({ trackId: +id, previewUrl: "https://audio.test/p.wav", artworkUrl100: "https://audio.test/a100x100.png" })) }) });
      });
      for (const p of all) {
        await p.page.context().route(/audio\.test/, (route) => route.fulfill({ status: 200, contentType: /png/.test(route.request().url()) ? "image/png" : "audio/wav", headers: { "access-control-allow-origin": "*" }, body: tiny }));
      }
      await host.page.click("#startBtn");
      for (const p of all) await p.page.waitForSelector("#s-play.on", T);
      h.expect(true, "Start (host) → the first song round opens on all three devices");
    },
    fresh: (page) => page.waitForSelector("#startBtn", { state: "attached", ...T }),
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
    const guest = await newPlayer(h, world, { label: "guest" }); mine.push(guest); players.push(guest);
    const all = [host, emma, guest];
    await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });
    await emma.page.waitForSelector("#board .cell");
    await sleep(500);

    h.step(`${id}: bare URL → lobby entry → create${d.settingsClicks ? " → settings" : ""}`);
    hub.reset();
    await host.page.goto(h.origin + `/${g.page}`, { waitUntil: "commit" });
    await host.page.waitForSelector("#mplCreate");
    h.expect(new RegExp(`lobby\\.html\\?g=${id}`).test(host.page.url()), `redirected to the lobby (${host.page.url().replace(h.origin, "")})`);
    h.expect((await text(host.page, "#mplEntryTitle")).includes(g.name), `entry names the game (${g.name})`);
    h.expect((await host.page.$(`a.mpl-link[href="${g.page}?ai=1"]`)) === null, "no vs-computer link (the game has no computer mode)");
    await host.page.click("#mplCreate");
    await host.page.waitForSelector("#mplRoster");
    const code = await lobbyCode(host.page);
    h.expect(new RegExp(`1/8`).test(await text(host.page, ".mpl-count")), "1/8 players");
    if (d.settingsClicks) {
      for (const [sel, label] of d.settingsClicks) await host.page.click(`${sel} >> .mpl-chip:text-is("${label}")`);
      h.eq(await pressed(host.page), d.expectPressed, "host's settings chosen");
    } else h.expect(await host.page.isHidden("#mplSettings"), "no settings panel for this game");

    h.step(`${id}: invite Emma (toast) + guest by link`);
    await host.page.click("#mplAdd");
    await host.page.click('.ppk-row[data-name="Emma"]');
    await host.page.click("#ppGo");
    await emma.page.waitForSelector(".ntf");
    h.expect((await text(emma.page, ".ntf")).includes(g.name), "toast names the game");
    await emma.page.click(".ntf");
    await emma.page.waitForSelector("#mplRoster");
    await guest.page.goto(h.origin + `/lobby.html?g=${id}&c=${code}`, { waitUntil: "domcontentloaded" });
    await guest.page.waitForSelector("#mplRoster");
    await inRoom(host.page, 3);
    if (d.expectPressed) h.eq(await pressed(guest.page), d.expectPressed, "the guest sees the host's settings");
    for (const p of [emma, guest]) await p.page.click("#mplReady");
    await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);

    h.step(`${id}: start → the game opens on the old room link`);
    await host.page.click("#mplStart");
    for (const p of all) await p.page.waitForURL(new RegExp(`${g.page.replace(".", "\\.")}\\?room=`), { timeout: 20000 });
    h.expect(host.page.url().includes(`room=${code.toLowerCase()}&role=host&lb=${code}`), `host → ${host.page.url().replace(h.origin, "")}`);
    h.expect(emma.page.url().includes("role=guest") && guest.page.url().includes("role=guest"), "the others are guests");
    await d.started(h, all);
    await shot(host, "started");
    await d.round(h, all, hub);
    out.lobbyToGame = { frames: hub.stats.framesIn + hub.stats.framesOut };

    h.step(`${id}: «‹ Lobby» (2 taps mid-game) → same code, then a rematch`);
    for (const p of all) { await p.page.click("#mpgBack"); await p.page.click("#mpgBack"); await p.page.waitForSelector("#mplRoster"); }
    await inRoom(host.page, 3);
    h.eq(await lobbyCode(host.page), code, "same lobby code");
    if (d.expectPressed) h.eq(await pressed(host.page), d.expectPressed, "the host's settings are kept for the rematch");
    for (const p of [emma, guest]) await p.page.click("#mplReady");
    await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
    await host.page.click("#mplStart");
    for (const p of all) await p.page.waitForURL(new RegExp(`room=${code.toLowerCase()}`), { timeout: 20000 });
    for (const p of all) await d.fresh(p.page);
    h.expect(true, "the rematch starts a clean game");

    h.step(`${id}: old links still work (?room=…&role=host)`);
    const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.max }); mine.push(legacy); players.push(legacy);
    await legacy.page.goto(h.origin + `/${g.page}?room=abc123&role=host`, { waitUntil: "domcontentloaded" });
    await legacy.page.waitForFunction(() => document.querySelector("#app, #s-lobby")?.textContent.trim().length > 0);
    h.expect(legacy.page.url().includes("room=abc123") && !legacy.page.url().includes("lobby.html") && await legacy.page.$("#mpgBack") === null, "opens the game directly, no lobby, no lobby button");

    out.requests = { host: host.http.length, emma: emma.http.length };
    out.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut };
    h.expect(countHttp(host, /^[A-Z]+ game_invites/) === 0, "host never touches game_invites (no polling)");
    console.log(`    ${id}: host REST ${host.http.length} · realtime ${out.realtime.frames} frames / ${out.realtime.bytes} B`);
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
      /* registry vs page: the lobby's song categories must be the catalogue's, in order */
      const cat = fs.readFileSync(new URL("../../intro-catalog.js", import.meta.url), "utf8");
      const names = [...cat.matchAll(/\{ id: '[^']+', name: '([^']+)', emoji: '([^']+)'/g)].map((m) => `${m[2]} ${m[1]}`);
      h.eq(MP_GAMES.intro.settings[0].options.map((o) => o.label), names, "lobby category list = intro-catalog.js (same order)");
      let i = 0;
      for (const id of wanted) await oneGame(h, id, i++, players);
    } finally {
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".party.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
