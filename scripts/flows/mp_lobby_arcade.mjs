/* Shared multiplayer lobby — the four arcade-frame games (Pong, Tank Battles, Platform Fighters, Air Hockey).
 * They run inside the arcade shell's sandboxed frame and talk through the shell's relay (pbn_<game>_<code>), so the lobby hands the shell
 * pixelbreak.html?g=<game>&room=<lobby code>&role=…&lb=… and the game opens the relay with that code by itself.
 * Per game (2 players, own Realtime hub): arcade → game menu (vs computer still works) · «Host online game» now opens the lobby ·
 * invite Emma through the picker (toast → lobby) · ready/start · both frames connect over the relay (mode host/guest, running) · the guest's
 * key press reaches the host · the HUD/over button is «‹ Lobby» (2 taps mid-match) · back in the lobby with the same code · a typed old
 * 5-character relay code still joins the old way · 0 console errors.  MP_GAMES=pong limits the run. */
import fs from "node:fs";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, text, countHttp, sleep, shotter } from "./mp_lobby_lib.mjs";
import { MP_GAMES } from "../../mp-games.js";

const NAME = "mp-lobby-arcade";
const REPORT = {};
const T = { timeout: 30000 };
const IDS = ["pong", "tank-wars", "fighters", "air-hockey"];
const waitFrame = async (page) => { await page.waitForFunction(() => document.getElementById("gf")?.contentDocument?.getElementById("mHost")); return page.frames().find((f) => f.url() === "about:srcdoc"); };

async function oneGame(h, id, index, players) {
  const g = MP_GAMES[id];
  const hub = createHub();
  const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
  const shot = shotter(`${NAME}.${id}`);
  const mine = [];
  const out = { game: id };
  try {
    const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: index === 0 }); mine.push(host); players.push(host);
    const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma }); mine.push(emma); players.push(emma);
    await emma.page.goto(h.origin + "/connect4.html?ai=1", { waitUntil: "domcontentloaded" });
    await emma.page.waitForSelector("#board .cell");
    await sleep(500);

    h.step(`${id}: the arcade card opens the game menu; «vs computer» is untouched, no lobby button there`);
    hub.reset();
    await host.page.goto(h.origin + `/pixelbreak.html?g=${id}`, { waitUntil: "domcontentloaded" });
    let fr = await waitFrame(host.page);
    h.expect(host.page.url().includes(`g=${id}`) && !host.page.url().includes("lobby.html"), "the bare arcade link stays on the game menu");
    await fr.click("#mAI");
    await fr.waitForFunction(() => typeof running !== "undefined" && running === true && mode === "ai");
    h.expect(await fr.evaluate(() => document.querySelector("[data-mpg]") === null), "vs-computer game running, no lobby button");
    await host.page.reload({ waitUntil: "domcontentloaded" });
    fr = await waitFrame(host.page);

    h.step(`${id}: «Host online game» → the lobby (create)`);
    await fr.click("#mHost");
    await host.page.waitForURL(new RegExp(`lobby\\.html\\?g=${id}&c=new`));
    await host.page.waitForSelector("#mplRoster");
    const code = await lobbyCode(host.page);
    h.expect(/^[A-HJ-NP-Z]{4}$/.test(code), `lobby code ${code}`);
    h.expect(/1\/2/.test(await text(host.page, ".mpl-count")), "1/2 players");

    h.step(`${id}: invite Emma (picker) → popup → she joins → ready → start`);
    await host.page.click("#mplAdd");
    await host.page.click('.ppk-row[data-name="Emma"]');
    await host.page.click("#ppGo");
    h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_room]), [[id, code.toLowerCase()]], "mp_invite carries the arcade game id and the lobby code");
    await emma.page.waitForSelector(".ip-card");
    h.expect((await text(emma.page, ".ip-title")).includes(g.name), `popup names the game (${await text(emma.page, ".ip-title")})`);
    await emma.page.click(".ip-card .ip-primary");
    await emma.page.waitForSelector("#mplRoster");
    await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);
    await emma.page.click("#mplReady");
    await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled);
    await host.page.click("#mplStart");
    for (const p of [host, emma]) await p.page.waitForURL(new RegExp(`pixelbreak\\.html\\?g=${id}&room=`), { timeout: 20000 });
    h.expect(host.page.url().includes(`g=${id}&room=${code.toLowerCase()}&role=host&lb=${code}`), `host → ${host.page.url().replace(h.origin, "")}`);
    h.expect(emma.page.url().includes(`room=${code.toLowerCase()}&role=guest&lb=${code}`), `guest → ${emma.page.url().replace(h.origin, "")}`);

    h.step(`${id}: both frames connect over the relay with the lobby code and start by themselves`);
    const frames = {};
    for (const p of [host, emma]) {
      await p.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return d && d.getElementById("mHost"); }, null, T);
      frames[p.label] = p.page.frames().find((f) => f.url() === "about:srcdoc");
      await frames[p.label].waitForFunction(() => typeof running !== "undefined" && running === true, null, T);
    }
    h.eq([await frames.host.evaluate(() => mode), await frames.emma.evaluate(() => mode)], ["host", "guest"], "host/guest modes come from the lobby, running on both");
    h.expect(hub.stats.topicsSeen.includes(`realtime:pbn_${id}_${code.toLowerCase()}`), "the shell's relay channel is pbn_<game>_<lobby code>");
    const ctx = await frames.host.evaluate(() => window.MPGate && { code: MPGate.ctx.code, role: MPGate.ctx.role, roster: MPGate.ctx.roster.map((r) => r.name) });
    h.eq(ctx, { code, role: "host", roster: ["tester", "Emma"] }, "the game frame receives roster + role (MPGate.ctx)");
    await shot(host, "running");

    h.step(`${id}: the guest's key press reaches the host`);
    await frames.emma.evaluate(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    await frames.host.waitForFunction(() => Object.values(remoteKeys).some((v) => v === true || v === 1), null, T);
    h.expect(true, "host's remoteKeys changed after the guest pressed ↑ (state crosses the relay both ways: the game runs on both screens)");

    h.step(`${id}: the Menu button is «‹ Lobby» (2 taps mid-match) → same lobby`);
    const btn = "#hudMenu";
    h.expect(/^‹ Lobby/.test((await frames.host.textContent(btn)) || ""), `HUD button reads «‹ Lobby» (${await frames.host.textContent(btn)})`);
    await frames.host.click(btn);
    h.expect(/Sécher/.test((await frames.host.textContent(btn)) || ""), "first tap asks «Sécher?»");
    await frames.host.click(btn);
    await host.page.waitForURL(/lobby\.html\?g=/);
    await host.page.waitForSelector("#mplRoster");
    h.eq(await lobbyCode(host.page), code, "same lobby code after leaving the game");
    /* Emma's game saw the opponent leave and fell back to its start menu: there «Host online game» is the lobby button (one tap) */
    await frames.emma.waitForSelector("#menu.show", T);
    h.expect(/^‹ Lobby/.test((await frames.emma.textContent("#mHost")) || ""), "Emma's start menu offers «‹ Lobby» instead of «Host online game»");
    await frames.emma.click("#mHost");
    await emma.page.waitForSelector("#mplRoster");
    await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2);

    h.step(`${id}: an old 5-character relay code still joins the old way (no lobby)`);
    const legacy = await newPlayer(h, world, { label: "legacy", user: USERS.max }); mine.push(legacy); players.push(legacy);
    await legacy.page.goto(h.origin + `/pixelbreak.html?g=${id}`, { waitUntil: "domcontentloaded" });
    const lf = await waitFrame(legacy.page);
    await lf.fill("#mCode", "ab12c");
    await lf.click("#mJoin");
    await lf.waitForFunction(() => mode === "guest");
    h.expect(!legacy.page.url().includes("lobby.html"), "…stays in the arcade, joins relay ab12c as guest");
    for (let i = 0; i < 40 && !hub.stats.topicsSeen.includes(`realtime:pbn_${id}_ab12c`); i++) await sleep(250);
    h.expect(hub.stats.topicsSeen.includes(`realtime:pbn_${id}_ab12c`), "the relay channel pbn_<game>_ab12c was joined");
    await lf.fill("#mCode", "");
    await lf.evaluate(() => { document.getElementById("mCode").value = "KXRM"; });
    await lf.evaluate(() => { document.getElementById("mJoin").click(); });
    await legacy.page.waitForURL(/lobby\.html\?g=.*&c=KXRM/);
    h.expect(true, "a typed 4-letter lobby code opens that lobby");

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
    const wanted = (process.env.MP_GAMES || IDS.join(",")).split(",").filter(Boolean);
    const players = [];
    try {
      let i = 0;
      for (const id of wanted) await oneGame(h, id, i++, players);
    } finally {
      if (process.env.MP_LOBBY_REPORT) fs.writeFileSync(process.env.MP_LOBBY_REPORT.replace(/\.json$/, "") + ".arcade.json", JSON.stringify(REPORT, null, 2));
    }
  },
};

runIfMain(import.meta.url, flow);
