/* Flow: Ski Alpen online race (round 4B). Three players in three browser contexts of ONE browser, the lobby and the hand-shake through
 * the in-process Realtime hub (mp_hub.mjs), the race itself over real WebRTC between the contexts. Nothing reaches Supabase.
 *   picker «Online-Rennen» -> lobby.html (ski): resort / piste / weather / time / runs settings (the piste list follows the resort) ->
 *   invite + ready + start -> all three land in the arcade frame with the same resort and piste -> side by side at the start, synced
 *   3-2-1 -> the others are seen live (interpolated, name tags) -> run 1: same results table on every device, each time posted to the
 *   per-piste board by its own player only -> run 2: the HOST leaves mid-run: the next player paces the match, the host is DNF ("fort")
 *   and blocks nobody -> run 3: final standings, «‹ Lobby» highlighted -> 8 skiers on screen: draw calls on Niddreg -> 0 console errors.
 * Scripted skiers (?bot=1, game time x4) on the 1.1 km Face (Tignes); the flow opts in to post their times (window.__skiAllowBotScore).
 * SKI_MP_REPORT=/path.json dumps the numbers; FLOW_SHOTS_DIR gets the screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-mp";
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
const mpState = (f) => f.evaluate(() => document.documentElement.dataset.skiMp || "");
const waitMp = (f, re, timeout = 150000) => f.waitForFunction((src) => new RegExp(src).test(document.documentElement.dataset.skiMp || ""), re.source, { timeout });
const info = (f) => f.evaluate(() => window.__skiMp.info());

async function mockTurn(p) {
  await p.context.route(/\/functions\/v1\/turn/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ iceServers: [{ urls: ["stun:127.0.0.1:3478"] }], turn: false, provider: "mock", ttl: 7200 }) });
  });
}
/* the scores the game frame reports to the arcade shell (arcade-kit.js posts {__pb, score, board} to the parent, which saves it) */
async function spyScores(p, f) {
  await f.evaluate(() => { window.__skiAllowBotScore = true; });
  await p.page.evaluate(() => {
    window.__scores = [];
    window.addEventListener("message", (e) => { const d = e.data; if (d && d.__pb === 1 && typeof d.score === "number") window.__scores.push({ v: d.score, board: d.board || null }); });
  });
}

export const flow = {
  name: NAME,
  fullChromium: true,
  viewport: { width: 960, height: 600 },
  async run(h) {
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id, USERS.max.id], [USERS.emma.id]: [USERS.ian.id], [USERS.max.id]: [USERS.ian.id] } });
    const players = [];
    const report = { realtime: {}, draws: {}, frames: {} };
    const shotDir = process.env.FLOW_SHOTS_DIR || "";
    const shot = async (p, label) => { if (!shotDir) return; fs.mkdirSync(shotDir, { recursive: true }); await p.page.screenshot({ path: path.join(shotDir, `${NAME}.${label}.png`) }); };
    try {
      // emma is the flow's own context (the video); the host and max get their own
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, first: true }); players.push(emma);
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, viewport: SMALL }); players.push(host);
      const max = await newPlayer(h, world, { label: "max", user: USERS.max, viewport: SMALL }); players.push(max);
      for (const p of players) await mockTurn(p);
      // R8f: a gate on each player's resort data: closed from the start click until that player's turn (three 3D pages booting at the
      // same moment in ONE test browser pass the Mini's 2.5 GB guard; real players boot on their own devices; the mesh waits for all)
      const gates = new Map();
      for (const p of players) {
        const g = { open: true, waiters: [] };
        gates.set(p.label, g);
        await p.context.route(/\/pb\/ski\/data\/[^/]+\/resort\.json/, async (route) => {
          if (!g.open) await new Promise((r) => g.waiters.push(r));
          try { await route.continue(); } catch { /* the page went away meanwhile (the reload at the start) */ }
        });
      }
      const closeGates = () => { for (const g of gates.values()) g.open = false; };
      const openGate = (p) => { const g = gates.get(p.label); g.open = true; for (const w of g.waiters.splice(0)) w(); };
      // max is on a school network: no direct path to anybody (WebRTC never connects) -> his two pairs go through the relay
      await max.context.addInitScript(() => { if (window.RTCPeerConnection) RTCPeerConnection.prototype.setRemoteDescription = () => new Promise(() => {}); });

      h.step("solo stays solo: the arcade card boots the resort picker, which now offers «Online-Rennen» (-> the lobby)");
      await host.page.goto(h.origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
      let hf = await gameFrame(host);
      await hf.waitForSelector("#resortScreen #skiOnline", T);
      h.expect(await hf.evaluate(() => !window.__skiMp && !document.documentElement.dataset.skiMp), "no online race without a lobby");
      await hf.click("#skiOnline");
      await host.page.waitForURL(/lobby\.html\?g=ski&c=new/, T);
      await host.page.waitForSelector("#mplRoster");
      const code = await lobbyCode(host.page);
      h.expect(/^[A-HJ-NP-Z]{4}$/.test(code), `lobby code ${code}`);

      h.step("lobby settings: resort, piste (follows the resort), weather, time, runs");
      const group = (i) => host.page.locator("#mplSettings .mpl-setting").nth(i + 1);          // R7-D: 0 = Modus (race by default)
      h.eq(await host.page.$$eval("#mplSettings .mpl-setting h4", (e) => e.map((x) => x.textContent)), ["Modus", "Skigebitt", "Pist", "Wieder", "Zäit", "Leef"], "six ski settings (mode first)");
      h.eq(await host.page.locator('#mplSettings .mpl-setting').nth(0).locator('[aria-pressed="true"]').getAttribute("data-v"), "race", "mode: race by default");
      h.eq(await group(1).locator("button").count(), 5, "resort random: the piste offers random + four colours");
      await group(0).locator('[data-v="zermatt"]').click();
      h.expect(await group(1).locator('[data-v="zermatt/riffelalp"]').count() === 1 && await group(1).locator('[data-v="killy/face"]').count() === 0, "Zermatt: Zermatt's pistes are offered, none of Killy's");
      await group(1).locator('[data-v="zermatt/riffelalp"]').click();
      await group(0).locator('[data-v="killy"]').click();
      h.eq(await group(1).locator('[aria-pressed="true"]').getAttribute("data-v"), "random", "another resort resets a piste of the old one to random");
      await group(1).locator(`[data-v="killy/${PISTE}"]`).click();
      await group(2).locator('[data-v="random"]').click();
      await group(4).locator('[data-v="3"]').click();
      h.eq(await group(2).locator('[aria-pressed="true"]').getAttribute("data-v"), "random", "weather random by default (Ian's rule)");

      h.step("invite emma + max, both ready, start");
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click('.ppk-row[data-name="Max"]');
      await host.page.click("#ppGo");
      h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_room]), [["ski", code.toLowerCase()]], "mp_invite carries the game id ski and the lobby code");
      for (const g of [emma, max]) {
        await g.page.goto(h.origin + `/lobby.html?g=ski&c=${code}`, { waitUntil: "domcontentloaded" });
        await g.page.waitForSelector("#mplRoster");
      }
      await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 3, null, T);
      for (const g of [emma, max]) await g.page.click("#mplReady");
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      closeGates();
      await host.page.click("#mplStart");
      for (const p of players) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      h.expect(host.page.url().includes(`g=ski&room=${code.toLowerCase()}&role=host&lb=${code}`), `host -> ${host.page.url().replace(h.origin, "")}`);
      // test speed: the same links with the scripted skier and game time x4 (also a reload right at the start: the mesh must cope)
      // R8f: one page boots after the other (three 3D pages loading at the same moment in ONE test browser passed the Mini's 2.5 GB
      // guard; real players load on their own devices): the mesh waits for everybody before the countdown
      const F = {};
      for (const p of players) {
        p.errMark = p.errors.length;
        await p.page.goto(p.page.url() + DEBUG_Q, { waitUntil: "domcontentloaded" });
        openGate(p);
        F[p.label] = await gameFrame(p);
      }
      for (const p of players) await spyScores(p, F[p.label]);
      // R7-D (WebKit): the reload right at the start cancels the old page's script / REST loads, WebKit logs those: only they are dropped
      for (const p of players) p.errors = p.errors.filter((e, i) => i < p.errMark || !/access control checks|load https:|load \/|cancel/i.test(e));

      h.step("everybody: same resort + piste, linked (mesh), side by side at the start, synced countdown");
      for (const p of players) await waitMp(F[p.label], /^(go|prep):0$/);
      const plans = await Promise.all(players.map((p) => F[p.label].evaluate(() => ({ piste: window.__ski.game.piste.id, runs: window.__skiMp.runs.map((r) => `${r.piste}/${r.weather}/${r.time}`) }))));
      h.eq(plans.map((x) => x.piste), players.map(() => PISTE), "everybody stands on the Face (Tignes)");
      h.eq(plans[1].runs, plans[0].runs, "host and emma drew the same weather / time per run");
      h.eq(plans[2].runs, plans[0].runs, "... and max too");
      for (const p of players) await waitMp(F[p.label], /^go:0$/, 90000);
      const nets = await Promise.all(players.map((p) => info(F[p.label])));
      const maxId = nets[2].net.me;
      const via = nets.map((n) => n.net.peers.map((q) => [q.id === maxId || n.net.me === maxId ? "relay" : "rtc", q.via, q.status]));
      h.expect(via.every((l) => l.every(([want, got, st]) => want === got && st === "here")), `host-emma over WebRTC, both pairs with max (no direct path) over the relay (${JSON.stringify(nets.map((n) => n.net.peers.map((q) => `${q.id.slice(0, 4)}:${q.via}:${q.status}`)))})`);
      h.eq(nets.map((n) => n.coordinator), nets.map(() => nets[0].coordinator), "everybody sees the same coordinator (the host)");
      const starts = await Promise.all(players.map((p) => F[p.label].evaluate(() => { const s = window.__ski.state; return { x: s.x, z: s.z }; })));
      const gaps = [Math.hypot(starts[0].x - starts[1].x, starts[0].z - starts[1].z), Math.hypot(starts[1].x - starts[2].x, starts[1].z - starts[2].z)];
      h.expect(gaps.every((g) => g > 1 && g < 6), `side by side at the start (${gaps.map((g) => g.toFixed(1)).join(", ")} m apart)`);
      await sleep(1200);
      await shot(emma, "start");
      await F.emma.waitForFunction(() => document.documentElement.dataset.skiRunning === "1", null, T);
      await sleep(2500);
      const seen = await F.emma.evaluate(() => window.__skiMp.remotes.all().map((r) => ({ id: r.id, has: !!r.state, tag: !r.tag.hidden, d: r.state ? Math.hypot(r.state.x - window.__ski.state.x, r.state.z - window.__ski.state.z) : -1 })));
      h.expect(seen.length === 2 && seen.every((r) => r.has), `emma sees both others live (${JSON.stringify(seen.map((r) => ({ tag: r.tag, d: Math.round(r.d) })))})`);
      await shot(emma, "race");

      h.step("sync: the shown remote skier vs where he really is (interpolation)");
      const sync = [];
      for (let i = 0; i < 8; i++) {
        const [shown, real] = await Promise.all([F.emma.evaluate(() => { const r = window.__skiMp.remotes.all().find((x) => x.name === "tester"); return r && r.state ? { x: r.state.x, z: r.state.z, t: performance.now() } : null; }), F.host.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z, v: window.__ski.state.speed }))]);
        if (shown && real) sync.push({ d: Math.hypot(shown.x - real.x, shown.z - real.z), v: real.v });
        await sleep(250);
      }
      const lag = sync.map((s) => s.d / Math.max(1, s.v) * 1000 / 4);                // game time runs x4: metres of path -> wall ms
      report.sync = { metres: sync.map((s) => +s.d.toFixed(1)), lagMs: lag.map(Math.round) };
      h.expect(sync.length >= 6 && Math.max(...lag) < 1500, `the host as emma sees him trails the real one by ${Math.round(Math.min(...lag))}-${Math.round(Math.max(...lag))} ms (interpolation delay + test-machine stalls)`);

      h.step("run 1: everybody finishes, the same table everywhere, each time on its own board");
      for (const p of players) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMpResults === "0", null, { timeout: 180000 });
      const tables = await Promise.all(players.map((p) => F[p.label].evaluate(() => window.__skiMp.race.runTable(0).map((r) => [r.name, r.place, r.res && r.res.ms]))));
      h.eq(tables[1], tables[0], "host and emma see the same run 1 table");
      h.eq(tables[2], tables[0], "max sees the same table");
      h.expect(tables[0].every((r) => r[1] >= 1 && r[2] > 20000), `three valid times (${JSON.stringify(tables[0])})`);
      await shot(emma, "results-1");
      for (const p of players) await p.page.waitForFunction(() => window.__scores.length > 0, null, { timeout: 8000 }).catch(() => {});    // the kit sends a score a moment later
      const scores = await Promise.all(players.map((p) => p.page.evaluate(() => window.__scores)));
      h.expect(scores.every((s, i) => s.length === 1 && s[0].board === `ski-killy-${PISTE}` && tables[0].some((r) => r[2] === s[0].v)), `each player posted only his own time to ski-killy-${PISTE} (${JSON.stringify(scores)})`);
      const mine = await Promise.all(players.map((p) => F[p.label].evaluate(() => { const r = window.__skiMp.race; return r.result(0, window.__skiMp.ctx.me).ms; })));
      h.eq(scores.map((s) => s[0] && s[0].v), mine, "the posted time is the player's own");

      h.step("run 2: the host leaves mid-run -> emma paces the match, the host is DNF (fort), nobody waits for him");
      for (const p of players) await waitMp(F[p.label], /^go:1$/, 120000);
      await F.emma.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" && window.__ski.game.phase === "running", null, T);
      await sleep(3000);
      await host.page.goto(h.origin + "/pixelbreak.html", { waitUntil: "domcontentloaded" });          // back to the arcade
      await F.emma.waitForFunction(() => window.__skiMp.race.status(window.__skiMp.ctx.roster[0].id) === "gone", null, { timeout: 30000 });
      h.eq(await F.emma.evaluate(() => window.__skiMp.race.coordinator() === window.__skiMp.ctx.me), true, "emma coordinates now");
      for (const p of [emma, max]) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMpResults === "1", null, { timeout: 180000 });
      const t2 = await F.max.evaluate(() => window.__skiMp.race.runTable(1).map((r) => [r.name, r.res && (r.res.dnf ? "dnf" : r.res.ms)]));
      h.expect(t2.find((r) => r[0] === "tester")[1] === "dnf" && t2.filter((r) => typeof r[1] === "number").length === 2, `run 2: emma + max timed, the host DNF (${JSON.stringify(t2)})`);
      h.expect(/fort/.test(await F.emma.textContent(".mp-card")), "emma's results card shows the host as gone (fort; max over the relay only sees him silent until GONE)");

      h.step("run 3: final standings; 8 skiers on screen stay cheap (Niddreg draw calls)");
      for (const p of [emma, max]) await waitMp(F[p.label], /^go:2$/, 120000);
      await F.emma.waitForFunction(() => window.__ski.game.phase === "running", null, T);
      await sleep(1500);
      const calls = async () => { const out = []; for (let i = 0; i < 6; i++) { out.push(await F.emma.evaluate(() => window.__ski.info().calls)); await sleep(120); } return Math.max(...out); };
      await F.emma.evaluate(() => { window.__ski.game.paused = true; });          // a still picture: the terrain tiles stop changing
      await sleep(500);
      const before = await calls();
      await F.emma.evaluate(() => {           // six more skiers (8 in all: emma, max + 6) riding along beside / ahead of emma
        const M = window.__skiMp, S = window.__ski, colours = ["rout", "blo", "giel", "greng", "rosa", "schwaarz"];
        for (let i = 0; i < 6; i++) M.remotes.add(`fake${i}`, `Test ${i + 1}`, colours[i]);
        window.__fakeTimer = setInterval(() => {
          const s = S.state, fx = Math.cos(s.heading), fz = Math.sin(s.heading);
          for (let i = 0; i < 6; i++) {
            const side = (i % 2 ? 1 : -1) * (2 + Math.floor(i / 2) * 2), ahead = 5 + i * 2.5;
            M.remotes.push(`fake${i}`, M.race.run, performance.now(), [s.x + fx * ahead - fz * side, s.y, s.z + fz * ahead + fx * side, s.heading, s.speed, s.edge, s.tuck, 0, 1, 0, 0, 0, 100, s.vx, s.vz, 0]);
          }
        }, 80);
      });
      await sleep(400);
      const withEight = await calls();
      const vis = await F.emma.evaluate(() => window.__skiMp.remotes.all().map((r) => ({ id: r.id, v: r.model.root.visible, st: !!r.state, buf: r.buf.length, run: r.run })));
      const drawn = vis.filter((r) => r.v).length;
      report.draws = { before, withEight, drawn, vis, level: await F.emma.evaluate(() => window.__ski.level) };
      // one draw call per remote skier, the name tags are DOM (absolute numbers: scripts/ski/perf-probe.mjs --remotes 7)
      h.expect(drawn >= 7 && withEight - before <= 6 + 1, `Niddreg: 6 more skiers cost ${withEight - before} draw calls (${before} -> ${withEight} on the Face; ${drawn} remote skiers drawn) ${drawn >= 7 ? "" : JSON.stringify(vis)}`);
      await shot(emma, "eight");
      await F.emma.evaluate(() => { clearInterval(window.__fakeTimer); for (let i = 0; i < 6; i++) window.__skiMp.remotes.remove(`fake${i}`); window.__ski.game.paused = false; });
      report.frames.emma = await F.emma.evaluate(() => window.__ski.frames());
      for (const p of [emma, max]) await waitMp(F[p.label], /^over:2$/, 180000);
      const finals = await Promise.all([emma, max].map((p) => F[p.label].evaluate(() => window.__skiMp.race.standings().map((r) => [r.name, r.points]))));
      h.eq(finals[1], finals[0], "the same final standings on both devices");
      h.expect(finals[0].length === 3 && finals[0][0][1] >= finals[0][1][1], `final standings by points (${JSON.stringify(finals[0])})`);
      h.expect(/Schlussklassement/.test(await F.emma.textContent(".mp-card")), "the final card");
      h.eq(await F.emma.evaluate(() => document.getElementById("mpLobbyBtn").dataset.over), "1", "«‹ Lobby» is highlighted (one tap: the match is over)");
      await shot(emma, "final");

      report.realtime = { frames: hub.stats.framesIn + hub.stats.framesOut, byEvent: hub.stats.byEvent, perContext: hub.stats.perContext };
      report.net = await Promise.all([emma, max].map((p) => F[p.label].evaluate(() => window.__skiMp.session.info().stats)));
      console.log(`    realtime frames over the whole session: ${report.realtime.frames}; webrtc msgs sent emma ${report.net[0].rtcSent}; relay msgs sent max ${report.net[1].relaySent} (dropped states ${report.net[1].relayDropped})`);
      h.expect(report.net[1].relaySent > 50 && report.net[1].relaySent < 2 * 4000, `the relay carried max's race within its budget (${report.net[1].relaySent} messages over two pairs)`);
      for (const p of players) h.eq(realErrors(p).filter((e) => !/WebGL|GPU stall|swiftshader/i.test(e)), [], `no console errors (${p.label})`);
    } finally {
      if (process.env.SKI_MP_REPORT) fs.writeFileSync(process.env.SKI_MP_REPORT, JSON.stringify(report, null, 2));
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
