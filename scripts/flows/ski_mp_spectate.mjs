/* Flow: Ski Alpen online race SPECTATORS (28 Nov 2026): a friend who joins a race that is already running watches it live instead of waiting.
 * Two racers (scripted skiers, ?bot=1) + a late spectator (Max), the lobby / hand-shake through the in-process Realtime hub (mp_hub.mjs),
 * the race itself over real WebRTC. Nothing reaches Supabase.
 *   (a) the late friend's lobby offers «Live kucken» / «Op d'nei Lobby waarden» / «Ofbriechen» (the race is running)
 *   (b) he is in the running race: same resort + piste, a follow camera on one racer (arrow / button / tap switches), the free overview camera,
 *       the live table with split gaps; the racers see «👀 1» and NO figure for him; he is not in their roster, standings or tables
 *   (c) he cannot influence the race: a forged 'fin' / 'go' / state from his page changes nothing for the racers
 *   (d) run 2 follows (new piste is not needed: same piste, run counter), the final standings + his button; the rematch lobby takes him in
 * FLOW_BROWSER=webkit runs it in WebKit. SKI_SPEC_REPORT=/path.json dumps the numbers; FLOW_SHOTS_DIR gets screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, text, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-mp-spectate";
const T = { timeout: 150000 };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const RACER_Q = "&debug=1&bot=1&timescale=2&q=low&res=fixed";
const SPEC_Q = "&debug=1&q=low&res=fixed";
const SMALL = { width: 800, height: 520 };

const frameOf = (p) => p.page.frames().find((f) => f.url() === "about:srcdoc");
async function gameFrame(p) {
  await p.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!(d && d.documentElement && d.documentElement.dataset.skiReady === "1"); }, null, T);
  return frameOf(p);
}
async function mockTurn(p) {
  await p.context.route(/\/functions\/v1\/turn/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ iceServers: [{ urls: ["stun:127.0.0.1:3478"] }], turn: false, provider: "mock", ttl: 7200 }) });
  });
}
const WEBKIT_CANCELLED = /access control checks|load https:|load \/|cancel|Load failed|cannot be parsed as a URL|Importing a module script failed|boot failed/i;
const realErrs = (p) => realErrors(p).filter((e) => process.env.FLOW_BROWSER !== "webkit" || !WEBKIT_CANCELLED.test(e));
const until = async (fn, ms = 20000, step = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(step); } };
const mpAttr = (f) => f.evaluate(() => document.documentElement.dataset.skiMp || "");
const waitMp = (f, re, timeout = 150000) => f.waitForFunction((src) => new RegExp(src).test(document.documentElement.dataset.skiMp || ""), re.source, { timeout });

export const flow = {
  name: NAME,
  fullChromium: true,
  viewport: { width: 960, height: 600 },
  async run(h) {
    const engine = process.env.FLOW_BROWSER || "chromium";
    const shotDir = process.env.FLOW_SHOTS_DIR || "";
    const report = { engine, steps: {} };
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id, USERS.max.id], [USERS.emma.id]: [USERS.ian.id], [USERS.max.id]: [USERS.ian.id] } });
    const players = [];
    const shot = async (p, label) => { if (!shotDir) return; fs.mkdirSync(shotDir, { recursive: true }); await p.page.screenshot({ path: path.join(shotDir, `${NAME}.${engine}.${label}.png`) }); };
    try {
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, first: true }); players.push(host);
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, viewport: SMALL }); players.push(emma);
      const max = await newPlayer(h, world, { label: "max", user: USERS.max, viewport: SMALL }); players.push(max);
      for (const p of players) await mockTurn(p);
      for (const p of [host, emma]) await p.context.addInitScript((q) => {
        if (/\/pixelbreak\.html$/.test(location.pathname) && /[?&]room=/.test(location.search) && !/[?&]debug=/.test(location.search)) history.replaceState(null, "", location.pathname + location.search + q);
      }, RACER_Q);
      await max.context.addInitScript((q) => {
        if (/\/pixelbreak\.html$/.test(location.pathname) && /[?&]room=/.test(location.search) && !/[?&]debug=/.test(location.search)) history.replaceState(null, "", location.pathname + location.search + q);
      }, SPEC_Q);

      h.step("the host opens a race lobby (Killy, Face, 2 runs), Emma joins and is ready, the host starts");
      await host.page.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplRoster", T);
      const code = await lobbyCode(host.page);
      const group = (page, label) => page.locator("#mplSettings .mpl-setting").filter({ has: page.locator("h4", { hasText: label }) });
      await group(host.page, "Modus").locator('[data-v="race"]').click();
      await group(host.page, "Skigebitt").locator('[data-v="killy"]').click();
      await group(host.page, "Pist").locator('[data-v="killy/face"]').click();
      await group(host.page, "Wieder").locator('[data-v="sun"]').click();
      await group(host.page, "Zäit").locator('[data-v="midday"]').click();
      await group(host.page, "Leef").locator('[data-v="3"]').click();
      await emma.page.goto(h.origin + `/lobby.html?g=ski&c=${code}`, { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#mplRoster", T);
      await emma.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      await host.page.click("#mplStart");
      for (const p of [host, emma]) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      const F = {};
      for (const p of [host, emma]) F[p.label] = await gameFrame(p);
      for (const p of [host, emma]) await waitMp(F[p.label], /^(go|prep):0$/);
      for (const p of [host, emma]) await waitMp(F[p.label], /^go:0$/, 90000);
      const ids = await Promise.all([host, emma].map((p) => F[p.label].evaluate(() => ({ me: window.__skiMp.ctx.me, roster: window.__skiMp.ctx.roster.map((r) => r.id) }))));
      h.expect(ids[0].roster.length === 2, `the race of two (${ids[0].roster.join(",")})`);
      await sleep(4000);                                          // the run is on

      h.step("(a) Max enters the code while the race runs: «Live kucken» / «Op d'nei Lobby waarden» / «Ofbriechen»");
      await max.page.goto(h.origin + `/lobby.html?g=ski&c=${code}`, { waitUntil: "domcontentloaded" });
      await max.page.waitForSelector("#mplSpectate", { timeout: 60000 });
      const msg = await text(max.page, ".mpl-busy");
      h.expect(/Rennen leeft schonn/.test(msg) && /live kucken/.test(msg) && /Lobby/.test(msg), `the choice text: «${msg}»`);
      h.expect(await max.page.locator("#mplWaitRematch").isVisible() && await max.page.locator("#mplCancelWait").isVisible(), "both other buttons are there");
      h.eq((await text(max.page, "#mplSpectate")).replace(/^\S+\s/, ""), "Live kucken", "the button says «Live kucken»");
      await shot(max, "a-choice");
      await max.page.click("#mplSpectate");
      await max.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      F.max = await gameFrame(max);
      await waitMp(F.max, /^spectate:/, 90000);
      h.expect(true, "Max is in the game as a spectator");

      h.step("(b) he watches the running race: same piste, both racers seen live, a table with gaps; the racers see only «👀 1»");
      await F.max.waitForFunction(() => window.__skiMp && window.__skiMp.kind === "spectate" && window.__skiMp.remotes.all().filter((r) => r.state).length === 2, null, { timeout: 90000 });
      const spec = await F.max.evaluate(() => ({ piste: window.__ski.game.piste.id, kind: window.__skiMp.kind, me: window.__skiMp.ctx.me, spec: window.__skiMp.ctx.spec, roster: window.__skiMp.ctx.roster.map((r) => r.id), hidden: document.documentElement.dataset.skiSpec, mode: window.__skiMp.mode, target: window.__skiMp.target }));
      h.eq(spec.piste, "face", "he is on the Face");
      h.expect(spec.spec === true && !spec.roster.includes(spec.me), "his id is not in the roster");
      h.eq(spec.roster, ids[0].roster, "the roster he knows is the racers' roster (the same plan)");
      h.eq(await mpAttr(F.max), await mpAttr(F.max), "attr readable");
      await until(async () => /^spectate:go:/.test(await mpAttr(F.max)), 60000);
      h.expect(/^spectate:(go|results):/.test(await mpAttr(F.max)), `his race state follows the racers (${await mpAttr(F.max)})`);
      // the racers: «👀 1», no figure of him, roster unchanged
      for (const p of [host, emma]) {
        await F[p.label].waitForFunction(() => { const w = document.querySelector(".mp-watch"); return !!w && !w.hidden && /👀 1/.test(w.textContent); }, null, { timeout: 60000 });
        const r = await F[p.label].evaluate(() => ({ remotes: window.__skiMp.remotes.all().map((x) => x.id), roster: window.__skiMp.ctx.roster.length, standings: window.__skiMp.race.standings().length, table: window.__skiMp.race.runTable(0).length, peers: window.__skiMp.session.info().peers.length, watch: document.querySelector(".mp-watch").textContent }));
        h.eq(r.watch, "👀 1", `${p.label}: «👀 1»`);
        h.eq(r.remotes.length, 1, `${p.label}: one other skier on the course (no figure for the spectator)`);
        h.expect(r.roster === 2 && r.standings === 2 && r.table === 2, `${p.label}: roster / standings / table still two players`);
        h.eq(r.peers, 2, `${p.label}: his link is a peer of the session`);
      }
      // the camera: a follow camera on one racer; arrows switch; overview on V
      const t0 = await F.max.evaluate(() => window.__skiMp.target);
      h.expect(!!t0, `following a racer (${t0})`);
      await F.max.waitForFunction(() => document.querySelectorAll(".mp-board .mp-row").length === 2, null, T);
      await max.page.keyboard.press("ArrowRight");
      const t1 = await F.max.evaluate(() => window.__skiMp.target);
      h.expect(t1 && t1 !== t0, `ArrowRight switches the racer (${t0} -> ${t1})`);
      await max.page.keyboard.press("ArrowLeft");
      h.eq(await F.max.evaluate(() => window.__skiMp.target), t0, "ArrowLeft goes back");
      const board = await F.max.evaluate(() => [...document.querySelectorAll(".mp-board .mp-row")].map((r) => r.textContent));
      h.expect(board.length === 2 && board.some((t) => t.includes("👁")), `the table lists the two racers, the watched one marked (${board.join(" | ")})`);
      await until(async () => (await F.max.evaluate(() => [...document.querySelectorAll(".mp-board .mp-row .t")].map((e) => e.textContent).join("|"))).match(/\+\d|S\d/), 30000);
      const splitRows = await F.max.evaluate(() => [...document.querySelectorAll(".mp-board .mp-row .t")].map((e) => e.textContent));
      h.expect(splitRows.some((t) => /^\+\d|^S\d/.test(t)), `split gaps in the live table (${splitRows.join(" | ")})`);
      await shot(max, "b-follow");
      await max.page.keyboard.press("KeyV");
      await F.max.waitForFunction(() => window.__skiMp.mode === "over", null, T);
      await sleep(1500);
      h.expect(await F.max.evaluate(() => !!window.__ski.game.camPose), "the overview camera is a free pose over the pack");
      await shot(max, "b-overview");
      await max.page.keyboard.press("KeyV");
      await F.max.waitForFunction(() => window.__skiMp.mode === "follow" && !window.__ski.game.camPose, null, T);
      // buttons + tap
      await F.max.locator(".mp-bar button", { hasText: "›" }).first().click();
      h.expect((await F.max.evaluate(() => window.__skiMp.target)) !== t0, "the bar's › button switches too");
      report.steps.camera = { t0, t1, splitRows };

      h.step("(c) he cannot influence the race: forged messages from his page change nothing for the racers");
      const before = await F.host.evaluate(() => ({ run: window.__skiMp.race.run, phase: window.__skiMp.race.phase, goAt: window.__skiMp.race.goAt }));
      await F.max.evaluate(() => {
        const s = window.__skiMp.session, r = window.__skiMp.race;
        s.broadcast({ k: "fin", r: 0, ms: 21000, v: true }, true);
        s.broadcast({ k: "dnf", r: 0 }, true);
        s.broadcast({ k: "go", r: 0, at: 1, now: 1 }, true);
        s.broadcast({ k: "end", r: 0 }, true);
        s.broadcast({ k: "next", r: 1 }, true);
        s.broadcast({ k: "hi", o: "x" }, true);
        s.broadcast({ k: "s", r: 0, t: Math.round(performance.now()), a: Array.from({ length: 16 }, () => 0) }, false);
      });
      await sleep(1500);
      for (const p of [host, emma]) {
        const a = await F[p.label].evaluate((myMax) => ({ run: window.__skiMp.race.run, phase: window.__skiMp.race.phase, res: window.__skiMp.race.runTable(0).map((r) => [r.id, r.res && r.res.ms]), remotes: window.__skiMp.remotes.all().length, hasMax: window.__skiMp.race.runTable(0).some((r) => r.id === myMax) }), spec.me);
        h.expect(a.run === before.run && a.phase === "go", `${p.label}: run / phase unchanged (${a.run}:${a.phase})`);
        h.expect(!a.res.some((r) => r[1] === 21000) && !a.hasMax && a.remotes === 1, `${p.label}: no forged time, no extra skier`);
      }
      const maxSent = await F.max.evaluate(() => window.__skiMp.info().standings.length);
      h.eq(maxSent, 2, "his own table never gained a player");

      h.step("(d) the races end: results, run 2 / 3 follow, the final standings; the rematch lobby takes him in");
      await F.max.waitForFunction(() => window.__skiMp.race.run >= 1, null, { timeout: 240000 });
      h.expect(true, "he follows the next run");
      await shot(max, "d-run2");
      await waitMp(F.max, /^spectate:over:/, 400000);
      await F.max.waitForSelector(".mp-card", T);
      const fin = await F.max.evaluate(() => ({ title: document.querySelector(".mp-card h2")?.textContent, rows: document.querySelectorAll(".mp-card .mp-table .c.n").length, foot: document.querySelector(".mp-foot")?.textContent, stand: window.__skiMp.race.standings().map((r) => r.id) }));
      h.expect(fin.rows >= 2 && /Lobby/.test(fin.foot || ""), `final card with the standings and the lobby note («${fin.foot}»)`);
      h.eq(fin.stand.length, 2, "the final standings hold the two racers only");
      await shot(max, "d-final");
      for (const p of [host, emma]) { const s = await F[p.label].evaluate(() => window.__skiMp.race.standings().length); h.eq(s, 2, `${p.label}: final standings: two players`); }
      await F.max.locator(".mp-bar button", { hasText: "Op d'Lobby waarden" }).click();
      await max.page.waitForSelector("#mplCancelWait", { timeout: 90000 });
      h.expect(/Rennen leeft schonn/.test(await text(max.page, ".mpl-busy")), "the race is over: the lobby waits for the rematch (no new spectator seat)");
      await host.page.goto(h.origin + `/lobby.html?g=ski&c=${code}&back=1&host=1`, { waitUntil: "domcontentloaded" });
      await host.page.waitForSelector("#mplRoster", T);
      await max.page.waitForSelector("#mplRoster", { timeout: 90000 });
      h.eq(await lobbyCode(max.page), code, "Max is in the rematch lobby as a normal player");
      report.engine = engine;
      for (const p of players) h.eq(realErrs(p), [], `no console errors (${p.label})`);
    } finally {
      if (process.env.SKI_SPEC_REPORT) fs.writeFileSync(process.env.SKI_SPEC_REPORT, JSON.stringify(report, null, 2));
      await closePlayers(players);
    }
  },
};
runIfMain(import.meta.url, flow);
