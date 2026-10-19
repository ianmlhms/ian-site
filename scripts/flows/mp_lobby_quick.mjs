/* Shared multiplayer lobby — quick match, error paths and the consistency checks.
 *   - two signed-out strangers: the first «Quick match» opens a public lobby, the second finds it through the directory channel
 *   - the "open lobbies" panel lists a public lobby live (directory joined only while the panel is open)
 *   - bad code / unknown lobby / unknown game / kicked-lobby messages
 *   - a lobby that is full leaves the public directory
 *   - static: registry ↔ SQL seed (mp_games), no polling timers in the lobby code */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, rosterNames, lobbyCode, text, sleep, shotter } from "./mp_lobby_lib.mjs";
import { MP_GAMES } from "../../mp-games.js";

const NAME = "mp-lobby-quick-match";

export const flow = {
  name: NAME,
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: {} });
    const shot = shotter(NAME);
    const players = [];
    try {
      /* ---- static checks ---- */
      const sql = fs.readFileSync(new URL("../mp-lobby-v1.sql", import.meta.url), "utf8");
      const seed = [...sql.matchAll(/\('([a-z0-9-]+)',\s*'[^']*',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(true|false)\)/g)].map((m) => ({ id: m[1], page: m[2], min: +m[3], max: +m[4], lobby: m[5] === "true" }));
      /* the enable files flip the lobby flag afterwards (v2: batch 2, later files: further batches) */
      for (const f of fs.readdirSync(new URL("../", import.meta.url)).filter((n) => /^mp-lobby-v\d+-enable\.sql$/.test(n)).sort()) {
        const upd = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
        for (const m of upd.matchAll(/\('([a-z0-9-]+)',\s*'[^']*',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(true|false)\)/g)) seed.push({ id: m[1], page: m[2], min: +m[3], max: +m[4], lobby: m[5] === "true" });   // games added by a later file
        for (const m of upd.matchAll(/update public\.mp_games set lobby = true\s+where id in \(([^)]*)\)/g)) {
          const ids = new Set([...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]));
          for (const row of seed) if (ids.has(row.id)) row.lobby = true;
        }
      }
      const reg = Object.values(MP_GAMES).map((g) => ({ id: g.id, page: g.page, min: g.min, max: g.max, lobby: g.lobby }));
      h.eq(seed.sort((a, b) => a.id.localeCompare(b.id)), reg.sort((a, b) => a.id.localeCompare(b.id)), "mp_games seed in the SQL = the JS registry (ids, pages, min/max, lobby flag)");
      for (const f of ["mp-lobby.js", "mp-gate.js", "people-picker.js", "mp-games.js"]) {
        const src = fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
        h.expect(!/setInterval\s*\(/.test(src), `${f}: no setInterval (no polling)`);
      }

      const a = await newPlayer(h, world, { label: "a", first: true }); players.push(a);
      const b = await newPlayer(h, world, { label: "b" }); players.push(b);
      const c = await newPlayer(h, world, { label: "c" }); players.push(c);

      h.step("error paths on the entry screen");
      await a.page.goto(h.origin + "/lobby.html?g=nope", { waitUntil: "domcontentloaded" });
      await a.page.waitForSelector(".mpl-msg");
      h.expect(/kennen/.test(await text(a.page, ".mpl-msg")), "unknown game id → a message, no crash");
      await a.page.goto(h.origin + "/lobby.html?g=connect4", { waitUntil: "domcontentloaded" });
      await a.page.waitForSelector("#mplCode");
      await a.page.fill("#mplCode", "ab");
      await a.page.click("#mplJoin");
      h.expect(/4 Buschtawen/.test(await text(a.page, "#mplMsg")), `a bad code is explained (${await text(a.page, "#mplMsg")})`);
      await a.page.fill("#mplCode", "ZZZZ");
      await a.page.click("#mplJoin");
      await a.page.waitForSelector("#mplMsg:not([hidden])", { timeout: 15000 });
      await a.page.waitForFunction(() => /gëtt et net/.test(document.getElementById("mplMsg")?.textContent || ""), null, { timeout: 15000 });
      h.expect(true, "an unknown lobby is reported («Dës Lobby gëtt et net (méi)»)");
      h.expect(await a.page.isVisible("#mplCreate"), "…and the entry screen is back");
      h.eq(await a.page.evaluate(() => document.getElementById("mplCode").value), "", "…with an empty code field");

      h.step("A: quick match with nothing open → A hosts a public lobby");
      hub.reset();
      await a.page.click("#mplQuick");
      await a.page.waitForSelector("#mplRoster", { timeout: 20000 });
      const code = await lobbyCode(a.page);
      h.expect(await a.page.isChecked("#mplPublic"), "the lobby is public (open for quick match)");
      await sleep(500);
      const dirTopic = [...hub.topics.keys()].find((t) => t.includes("mpl-dir:connect4"));
      h.expect(!!dirTopic && hub.presenceCount(dirTopic) === 1, "A published itself in the directory channel");

      h.step("C opens the «open lobbies» panel: A's lobby shows live, the panel joins the directory only while open");
      await c.page.goto(h.origin + "/lobby.html?g=connect4", { waitUntil: "domcontentloaded" });
      await c.page.waitForSelector("#mplOpenList");
      h.expect(hub.presenceCount(dirTopic) === 1, "before opening the panel C is not in the directory");
      await c.page.click("#mplOpenList");
      await c.page.waitForSelector("#mplDir .mpl-inv", { timeout: 10000 });
      h.expect(new RegExp(code).test(await text(c.page, "#mplDir")) && /1 vu 2/.test(await text(c.page, "#mplDir")), `panel lists «${code} · 1 vu 2 Spiller»`);
      await shot(c, "open-lobbies");
      await c.page.click("#mplOpenList");
      await c.page.waitForFunction((t) => true, dirTopic);
      await sleep(400);

      h.step("B: quick match → finds A's lobby and joins");
      await b.page.goto(h.origin + "/lobby.html?g=connect4", { waitUntil: "domcontentloaded" });
      await b.page.waitForSelector("#mplQuick");
      await b.page.click("#mplQuick");
      await b.page.waitForSelector("#mplRoster", { timeout: 20000 });
      h.eq(await lobbyCode(b.page), code, "B is in A's lobby");
      await a.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
      h.expect(/2\/2/.test(await text(a.page, ".mpl-count")), "A sees 2/2");
      await sleep(600);
      h.expect(hub.presenceCount(dirTopic) === 0, "the full lobby left the public directory");
      await shot(a, "quick-match-roster");

      h.step("C tries the code of the full lobby → «voll»");
      await c.page.fill("#mplCode", code);
      await c.page.click("#mplJoin");
      await c.page.waitForFunction(() => /voll/.test(document.getElementById("mplMsg")?.textContent || ""), null, { timeout: 15000 });
      h.expect(true, "full lobby refuses a third player");

      h.step("arcade: the room dialog of a lobby game opens the lobby; an old 6-character code still joins the old way");
      await c.page.goto(h.origin + "/pixelbreak.html", { waitUntil: "domcontentloaded" });
      await c.page.waitForFunction(() => typeof openOnline === "function" && typeof GAMES !== "undefined" && window.MPG);
      await c.page.evaluate(() => openOnline(GAMES.findIndex((g) => g.id === "o-connect4")));
      await c.page.click("#om .go >> nth=0");
      await c.page.waitForURL(/lobby\.html\?g=connect4&c=new/);
      await c.page.waitForSelector("#mplRoster");
      h.expect(true, "«Start» in the arcade dialog → new lobby (lobby.html?g=connect4&c=new)");
      await c.page.goto(h.origin + "/pixelbreak.html", { waitUntil: "domcontentloaded" });
      await c.page.waitForFunction(() => window.MPG);
      await c.page.evaluate(() => openOnline(GAMES.findIndex((g) => g.id === "o-connect4")));
      await c.page.fill("#omCode", "abc123");
      await c.page.click("#om .jr button");
      await c.page.waitForURL(/connect4\.html\?room=abc123&role=guest/);
      h.expect(true, "a 6-character code → the old room link (no lobby)");

      h.step("friends page: «Play» → Connect 4 opens a lobby and invites that friend; a pending invite's Join goes to the lobby");
      const fr = await newPlayer(h, world, { label: "friends-page", user: USERS.ian }); players.push(fr);
      world.friends[USERS.ian.id] = [USERS.emma.id];
      world.invites.push({ id: 900, from_user: USERS.emma.id, from_name: "Emma", to_user: USERS.ian.id, game: "slf", room: "zzzz", status: "pending", created_at: new Date().toISOString() });
      await fr.page.goto(h.origin + "/friends.html", { waitUntil: "domcontentloaded" });
      await fr.page.waitForSelector("[data-join]", { state: "attached" });
      await fr.page.evaluate(() => document.querySelector("[data-join]").click());
      await fr.page.waitForURL(/lobby\.html\?g=slf&c=ZZZZ/);
      h.expect(true, "pending Stadt-Land-Fluss invite → lobby.html?g=slf&c=ZZZZ (not the old room link)");
      h.expect(world.invites.find((i) => i.id === 900).status === "accepted", "the invite was marked accepted (one PATCH)");
      await fr.page.waitForFunction(() => /gëtt et net/.test(document.getElementById("mplMsg")?.textContent || ""), null, { timeout: 15000 });
      h.expect(true, "an invite to a lobby that is gone ends on the entry screen with a clear message");
      await fr.page.goto(h.origin + "/friends.html", { waitUntil: "domcontentloaded" });
      await fr.page.waitForSelector("[data-play]");
      await fr.page.click("[data-play]");
      await fr.page.click('[data-g="connect4"]');
      await fr.page.waitForURL(/lobby\.html\?g=connect4&c=new&invite=/);
      await fr.page.waitForSelector("#mplRoster");
      await fr.page.waitForFunction(() => document.querySelector(".mpl-row.mpl-invited"));
      const last = world.mpInviteCalls[world.mpInviteCalls.length - 1];
      h.eq([last.p_game, last.p_to], ["connect4", [USERS.emma.id]], "the chooser opened a lobby and mp_invite went to Emma");
      h.expect(/Emma/.test(await text(fr.page, ".mpl-row.mpl-invited")), "…and the roster shows «Emma — invitéiert…»");

      for (const p of players) h.eq(realErrors(p), [], `no console errors (${p.label})`);
      console.log("    requests a/b/c:", a.http.length, b.http.length, c.http.length);
    } finally {
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
