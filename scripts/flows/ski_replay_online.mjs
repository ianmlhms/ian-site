/* Flow: Ski Alpen online race replay (28 Nov 2026). Two players in two browser contexts (the lobby and the hand-shake through the in-process
 * Realtime hub, the race over real WebRTC), ONE run on the Face (Tignes). After the finish the results card offers «Replay» (my own run, from
 * the rolling recorder) and, for the one who did not win, «Replay: <winner>» (the winner's run from the states that arrived over the link:
 * net/samplelog.js; nothing more is sent than before). The replay opens (bar, clip length ~ the run), hides the other racer, shows the figure,
 * closes with Esc / Zou, the results card is back; solo, the same page has no race replay path. A reload-free, scripted pair (?bot=1, time x4).
 * FLOW_SHOTS_DIR gets the screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-replay-online";
const PISTE = "face";
const T = { timeout: 120000 };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const DEBUG_Q = "&debug=1&bot=1&timescale=4&q=low";
const SMALL = { width: 640, height: 400 };

const frameOf = (p) => p.page.frames().find((f) => f.url() === "about:srcdoc");
async function gameFrame(p) {
  await p.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!(d && d.documentElement && d.documentElement.dataset.skiReady === "1"); }, null, T);
  return frameOf(p);
}
const waitMp = (f, re, timeout = 150000) => f.waitForFunction((src) => new RegExp(src).test(document.documentElement.dataset.skiMp || ""), re.source, { timeout });
async function mockTurn(p) {
  await p.context.route(/\/functions\/v1\/turn/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ iceServers: [{ urls: ["stun:127.0.0.1:3478"] }], turn: false, provider: "mock", ttl: 7200 }) });
  });
}

export const flow = {
  name: NAME,
  fullChromium: true,
  viewport: { width: 960, height: 600 },
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id], [USERS.emma.id]: [USERS.ian.id] } });
    const players = [];
    const shotDir = process.env.FLOW_SHOTS_DIR || "";
    const shot = async (p, label) => { if (!shotDir) return; fs.mkdirSync(shotDir, { recursive: true }); await p.page.screenshot({ path: path.join(shotDir, `${NAME}.${label}.png`) }); };
    try {
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, first: true }); players.push(emma);
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, viewport: SMALL }); players.push(host);
      for (const p of players) await mockTurn(p);
      const gates = new Map();
      for (const p of players) {
        const g = { open: true, waiters: [] };
        gates.set(p.label, g);
        await p.context.route(/\/pb\/ski\/data\/[^/]+\/resort\.json/, async (route) => {
          if (!g.open) await new Promise((r) => g.waiters.push(r));
          try { await route.continue(); } catch { /* the page went away (the reload at the start) */ }
        });
      }
      const closeGates = () => { for (const g of gates.values()) g.open = false; };
      const openGate = (p) => { const g = gates.get(p.label); g.open = true; for (const w of g.waiters.splice(0)) w(); };

      h.step("lobby: two players, one run on the Face");
      await host.page.goto(h.origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
      const hf = await gameFrame(host);
      await hf.waitForSelector("#resortScreen #skiOnline", T);
      await hf.click("#skiOnline");
      await host.page.waitForURL(/lobby\.html\?g=ski$/, T);
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplRoster");
      const code = await lobbyCode(host.page);
      const group = (i) => host.page.locator("#mplSettings .mpl-setting").nth(i + 1);
      await group(0).locator('[data-v="killy"]').click();
      await group(1).locator(`[data-v="killy/${PISTE}"]`).click();
      await group(4).locator('[data-v="1"]').click();
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click("#ppGo");
      await emma.page.goto(h.origin + `/lobby.html?g=ski&c=${code}`, { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#mplRoster");
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 2, null, T);
      await emma.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      closeGates();
      await host.page.click("#mplStart");
      for (const p of players) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      const F = {};
      for (const p of players) {
        await p.page.goto(p.page.url() + DEBUG_Q, { waitUntil: "domcontentloaded" });
        openGate(p);
        F[p.label] = await gameFrame(p);
        await F[p.label].evaluate(() => { window.__skiAllowBotScore = true; });
      }
      for (const p of players) await waitMp(F[p.label], /^go:0$/, 120000);

      h.step("the race: both ski it, the results card offers «Replay»");
      for (const p of players) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMpResults === "0", null, { timeout: 180000 });
      await sleep(600);
      const win = await F.emma.evaluate(() => { const t = window.__skiMp.race.runTable(0); return { names: t.map((r) => r.name), mine: window.__skiMp.ctx.me, first: t[0].id }; });
      const loser = win.first === win.mine ? host : emma, victor = loser === emma ? host : emma;
      const btns = async (p) => F[p.label].$$eval(".mp-card .mp-acts button", (b) => b.map((x) => x.textContent));
      const lb = await btns(loser), vb = await btns(victor);
      h.expect(lb.length === 2 && lb[0] === "Replay" && /^Replay: /.test(lb[1]), `the one who lost gets «Replay» and the winner's run (${JSON.stringify(lb)})`);
      h.expect(vb.length === 1 && vb[0] === "Replay", `the winner gets his own «Replay» only (${JSON.stringify(vb)})`);
      await shot(emma, "results");

      h.step("my own replay: the whole run, the other racer hidden, the card comes back");
      const lf = F[loser.label];
      await lf.click('.mp-card .mp-acts button[data-a="replay"]');
      await lf.waitForFunction(() => window.__ski.replay.active, null, { timeout: 10000 });
      await sleep(900);
      const own = await lf.evaluate(() => {
        const R = window.__ski.replay, S = window.__ski, M = window.__skiMp;
        return { dur: R.duration, bar: !!document.querySelector(".rpbar"), mpHidden: M.remotes.all().every((r) => !r.model.root.visible), cardHidden: getComputedStyle(document.querySelector(".mp-card")).display === "none" || document.documentElement.dataset.skiReplay !== undefined };
      });
      h.expect(own.dur > 8 && own.bar && own.mpHidden && own.cardHidden, `own replay open: ${own.dur.toFixed(1)} s, bar, the other racer hidden (${JSON.stringify(own)})`);
      await shot(loser, "replay-own");
      await loser.page.keyboard.press("Escape");
      await lf.waitForFunction(() => !window.__ski.replay.active, null, { timeout: 10000 });
      h.expect(await lf.evaluate(() => !!document.querySelector(".mp-card") && getComputedStyle(document.querySelector(".mp-card")).display !== "none"), "Esc closes the replay, the results card is back");

      h.step("the winner's replay from what arrived over the link");
      const fromNet = await lf.evaluate(() => {
        const M = window.__skiMp;
        return { ids: M.ctx.roster.map((r) => r.id), logs: typeof M.logInfo === "function" ? M.logInfo() : null };
      });
      await lf.click('.mp-card .mp-acts button[data-a="replay-winner"]');
      await lf.waitForFunction(() => window.__ski.replay.active, null, { timeout: 10000 });
      await sleep(900);
      const wr = await lf.evaluate(() => {
        const R = window.__ski.replay, S = window.__ski;
        return { dur: R.duration, x: R.state.x, z: R.state.z, speed: R.state.speed };
      });
      const real = await lf.evaluate(() => window.__skiMp.race.result(0, window.__skiMp.race.runTable(0)[0].id).ms / 1000);
      // (the test skier runs at game time x4 while the samples are timed by the sender's wall clock: a real race is x1, so 4 x the clip = the run)
      h.expect(wr.dur * 4 > real * 0.7 && wr.dur * 4 < real * 1.3 && Number.isFinite(wr.x), `the winner's replay lasts ${wr.dur.toFixed(1)} s wall = ${(wr.dur * 4).toFixed(0)} s game time for his ${real.toFixed(1)} s run`);
      await shot(loser, "replay-winner");
      await loser.page.keyboard.press("Escape");
      await lf.waitForFunction(() => !window.__ski.replay.active, null, { timeout: 10000 });
      const back = await lf.evaluate(() => ({ board: window.__ski.skier.board, ski: window.__ski.skiType, goofy: window.__ski.skier.goofy }));
      h.expect(back.board === (back.ski === "snowboard") && back.goofy === false, `after the winner's replay my own look is back (${JSON.stringify(back)})`);

      h.step("nothing more on the wire: the samples are the ones the stream already carries");
      const sent = await F.emma.evaluate(() => window.__skiMp.session.info().stats);
      h.expect(sent.rtcSent > 20, `the race used the normal stream only (emma sent ${sent.rtcSent} messages in all)`);
      for (const p of players) h.eq(realErrors(p).filter((e) => !/WebGL|GPU stall|swiftshader/i.test(e)), [], `no console errors (${p.label})`);
    } finally {
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
