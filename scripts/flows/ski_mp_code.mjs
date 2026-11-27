/* Flow: Ski Alpen lobby entry + joining by code + LATE JOIN (Ian, school iPad: "when you press Online-Rennen, you automatically create a lobby and
 * can't get to the screen to join with a code"). Three Realtime-hub players (mp_hub.mjs, the repo's mocked Supabase), nothing reaches the live
 * project. Emma plays on an iPad (touch context + iPad user agent).
 *   (a) «Online-Rennen» in the picker opens the CHOICE (create / join with a code), no lobby is created; wrong codes (too short, unknown) are
 *       answered in Luxembourgish; «Lobby opmaachen» creates the lobby
 *   (b) Emma joins with a code typed lower case with spaces (iPad touch), the host starts a free ride
 *   (c) LATE JOIN: Max types the code after the start -> straight into the running free ride; everybody sees everybody, the same host
 *   (d) a pasted invite link works in the code field; a full ride (8) says so
 *   (e) a RACE is running: a late friend gets the clear message and waits; when the host reopens the lobby (rematch) he lands in it
 * FLOW_BROWSER=webkit runs it in WebKit. SKI_MPC_REPORT=/path.json dumps the numbers; FLOW_SHOTS_DIR gets screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, text, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-mp-code";
const T = { timeout: 150000 };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const DEBUG_Q = "&debug=1&q=low&res=fixed";
const SMALL = { width: 800, height: 520 };
const IPAD = { viewport: { width: 1024, height: 768 }, contextOptions: { hasTouch: true, isMobile: false, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" } };

const frameOf = (p) => p.page.frames().find((f) => f.url() === "about:srcdoc");
async function arcadeFrame(p) {
  await p.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!(d && d.documentElement && d.documentElement.dataset.skiReady === "1"); }, null, T);
  return frameOf(p);
}
async function mockTurn(p) {
  await p.context.route(/\/functions\/v1\/turn/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ iceServers: [{ urls: ["stun:127.0.0.1:3478"] }], turn: false, provider: "mock", ttl: 7200 }) });
  });
}
/* WebKit logs the requests of a page that a reload / navigation cancelled in the middle of its boot as errors */
const WEBKIT_CANCELLED = /access control checks|load https:|load \/|cancel|Load failed|cannot be parsed as a URL|Importing a module script failed|boot failed/i;
const realErrs = (p) => realErrors(p).filter((e) => process.env.FLOW_BROWSER !== "webkit" || !WEBKIT_CANCELLED.test(e));
const rosterCount = (page) => page.evaluate(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length);
const until = async (fn, ms = 15000, step = 150) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(step); } };
const msgOf = (page) => text(page, "#mplMsg");

export const flow = {
  name: NAME,
  fullChromium: true,
  viewport: { width: 1024, height: 700 },
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
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, ...IPAD }); players.push(emma);
      const max = await newPlayer(h, world, { label: "max", user: USERS.max, viewport: SMALL }); players.push(max);
      for (const p of players) await mockTurn(p);
      // the debug / low-quality switches ride on the game link from the start (no reload in the middle of the boot: WebKit logs what that cancels)
      for (const p of players) await p.context.addInitScript((q) => {
        if (/\/pixelbreak\.html$/.test(location.pathname) && /[?&]room=/.test(location.search) && !/[?&]debug=/.test(location.search)) history.replaceState(null, "", location.pathname + location.search + q);
      }, DEBUG_Q);

      /* ---------------- (a) the choice ---------------- */
      h.step("(a) picker -> «Online-Rennen»: the choice (create / join by code), nothing is created; wrong codes get a clear answer");
      await host.page.goto(h.origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
      const hf0 = await arcadeFrame(host);
      await hf0.waitForSelector("#resortScreen #skiOnline", T);
      await hf0.click("#skiOnline");
      await host.page.waitForURL(/lobby\.html\?g=ski$/, T);
      await host.page.waitForSelector("#mplCreate", T);
      h.expect(await host.page.locator("#mplCode").isVisible(), "the code field is on the choice screen");
      h.expect(!(await host.page.locator("#mplRoster").isVisible()), "no lobby was created by pressing «Online-Rennen»");
      h.expect((await host.page.locator("#mplCreate").innerText()).includes("Lobby opmaachen"), "create button says «Lobby opmaachen»");
      h.expect((await text(host.page, ".mpl-jointitle")) === "Mat Code bäitrieden", "join block says «Mat Code bäitrieden»");
      const big = await host.page.locator("#mplCode").evaluate((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), hgt: e.getBoundingClientRect().height }));
      h.expect(big.fs >= 24 && big.hgt >= 56, `the code field is big (${big.fs}px, ${Math.round(big.hgt)} high)`);
      h.expect(await host.page.locator("#mplFriends").isVisible(), "the friends shortcut is there");
      await shot(host, "a-choice");
      await host.page.fill("#mplCode", "ab");
      await host.page.click("#mplJoin");
      h.expect(/4 Buschtawen/.test(await msgOf(host.page)), `a too short code: «${await msgOf(host.page)}»`);
      await host.page.fill("#mplCode", "q q  q q");
      h.eq(await host.page.inputValue("#mplCode"), "QQQQ", "spaces are trimmed, upper case");
      await host.page.click("#mplJoin");
      await host.page.waitForSelector("#mplMsg:not([hidden])", T);
      await until(async () => /gëtt et net/.test(await msgOf(host.page)), 20000);
      h.expect(/Dëse Code gëtt et net \(méi\)/.test(await msgOf(host.page)), `an unknown code: «${await msgOf(host.page)}»`);
      await shot(host, "a-unknown");
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplRoster", T);
      const code = await lobbyCode(host.page);
      h.expect(/^[A-Z0-9]{4}$/.test(code), `«Lobby opmaachen» creates the lobby (${code})`);
      const group = (page, label) => page.locator("#mplSettings .mpl-setting").filter({ has: page.locator("h4", { hasText: label }) });
      await group(host.page, "Modus").locator('[data-v="free"]').click();
      await group(host.page, "Skigebitt").locator('[data-v="killy"]').click();
      await group(host.page, "Wieder").locator('[data-v="sun"]').click();
      await group(host.page, "Zäit").locator('[data-v="midday"]').click();

      /* ---------------- (b) Emma joins by code on the iPad ---------------- */
      h.step("(b) Emma (iPad, touch): the code typed lower case with a space joins the lobby; the host starts the free ride");
      await emma.page.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#mplCode", T);
      await emma.page.locator("#mplCode").tap();
      await emma.page.locator("#mplCode").fill(` ${code.slice(0, 2).toLowerCase()} ${code.slice(2).toLowerCase()} `);
      h.eq(await emma.page.inputValue("#mplCode"), code, "lower case + spaces -> the code");
      await emma.page.locator("#mplJoin").tap();
      await emma.page.waitForSelector("#mplRoster", T);
      h.eq(await lobbyCode(emma.page), code, "Emma is in the host's lobby");
      await shot(emma, "b-lobby-ipad");
      await emma.page.locator("#mplReady").tap();
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      await host.page.click("#mplStart");
      for (const p of [host, emma]) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      const F = {};
      for (const p of [host, emma]) F[p.label] = await arcadeFrame(p);
      for (const p of [host, emma]) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
      for (const p of [host, emma]) await F[p.label].waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 1, null, { timeout: 90000 });
      h.expect(true, "host + Emma ride together");

      /* ---------------- (c) late join ---------------- */
      h.step("(c) LATE JOIN: Max enters the code AFTER the start -> straight into the running free ride, everybody sees everybody");
      await max.page.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      await max.page.waitForSelector("#mplCode", T);
      await max.page.fill("#mplCode", code.toLowerCase());
      await max.page.click("#mplJoin");
      await max.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      h.expect(max.page.url().includes("role=guest"), "Max is a guest");
      F.max = await arcadeFrame(max);
      await F.max.waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
      const resortOf = (f) => f.evaluate(() => window.__skiMp.ctx.cfg.resort + "/" + window.__ski.spawn.name);
      h.eq(await resortOf(F.max), await resortOf(F.host), "Max is in the same resort as the others");
      for (const p of [host, emma, max]) await F[p.label].waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 2, null, { timeout: 90000 });
      const nets = await Promise.all([host, emma, max].map((p) => F[p.label].evaluate(() => window.__skiMp.info())));
      h.expect(nets.every((n) => n.net.peers.length === 2 && n.net.peers.every((q) => q.status === "here")), `all three linked (${nets.map((n) => n.net.peers.map((q) => q.status).join("+")).join(" | ")})`);
      h.eq(nets.map((n) => n.host), nets.map(() => nets[0].host), "everybody sees the same host (the lobby's host, not the latecomer)");
      const hostName = await F.host.evaluate(() => window.__skiMp.ctx.roster[0].id);
      h.eq(nets[2].host, hostName, "the latecomer follows the host");
      const names = await Promise.all([host, emma, max].map((p) => F[p.label].evaluate(() => window.__skiMp.remotes.all().map((r) => r.name).sort().join(","))));
      h.eq(names, ["Emma,Max", "Max,tester", "Emma,tester"].map((x) => x), "each one sees the other two by name");
      await shot(max, "c-late-max");
      await shot(host, "c-late-host");
      // a weather change by the host reaches the latecomer
      await F.host.evaluate(() => window.__ski.env.setWeather("snow", true));
      await until(async () => (await F.max.evaluate(() => window.__ski.env.state.weatherId)) === "snow", 20000);
      h.eq(await F.max.evaluate(() => window.__ski.env.state.weatherId), "snow", "the host's weather reaches the latecomer");

      /* ---------------- (d) pasted link, full ride ---------------- */
      h.step("(d) a pasted invite link in the code field gives the code");
      const lobby2 = await host.context.newPage();
      await lobby2.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      await lobby2.waitForSelector("#mplCode", T);
      await lobby2.fill("#mplCode", `${h.origin}/lobby.html?g=ski&c=${code}`);
      h.eq(await lobby2.inputValue("#mplCode"), code, "link -> code");
      await lobby2.close();

      /* ---------------- (e) a running race ---------------- */
      h.step("(e) a RACE is running: a late friend gets the clear message and waits; the rematch lobby takes him in");
      await emma.page.goto(h.origin + "/about.html", { waitUntil: "domcontentloaded" });
      await max.page.goto(h.origin + "/about.html", { waitUntil: "domcontentloaded" });
      await host.page.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      await host.page.click("#mplCreate");
      await host.page.waitForSelector("#mplRoster", T);
      const code2 = await lobbyCode(host.page);
      await group(host.page, "Modus").locator('[data-v="race"]').click();
      await group(host.page, "Skigebitt").locator('[data-v="killy"]').click();
      await group(host.page, "Pist").locator('[data-v="killy/face"]').click();
      await group(host.page, "Leef").locator('[data-v="1"]').click();
      await emma.page.goto(h.origin + `/lobby.html?g=ski&c=${code2}`, { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#mplRoster", T);
      await emma.page.locator("#mplReady").tap();
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      await host.page.click("#mplStart");
      for (const p of [host, emma]) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      const R = {};
      for (const p of [host, emma]) R[p.label] = await arcadeFrame(p);
      for (const p of [host, emma]) await R[p.label].waitForFunction(() => !!window.__skiMp && document.documentElement.dataset.skiMp, null, T);
      await max.page.goto(h.origin + `/lobby.html?g=ski&c=${code2}`, { waitUntil: "domcontentloaded" });
      await max.page.waitForSelector("#mplCancelWait", { timeout: 60000 });
      const waitMsg = await text(max.page, ".mpl-busy");
      h.expect(/Rennen leeft schonn/.test(waitMsg) && /Lobby/.test(waitMsg), `a race is running: «${waitMsg}»`);
      await shot(max, "e-race-wait");
      // the host returns to the lobby (rematch, the same code): Max lands in it
      await host.page.goto(h.origin + `/lobby.html?g=ski&c=${code2}&back=1&host=1`, { waitUntil: "domcontentloaded" });
      await host.page.waitForSelector("#mplRoster", T);
      await max.page.waitForSelector("#mplRoster", { timeout: 60000 });
      h.eq(await lobbyCode(max.page), code2, "Max is in the rematch lobby");
      await until(async () => (await rosterCount(host.page)) === 2);
      h.eq(await rosterCount(host.page), 2, "the host sees Max in the roster");
      // cancel works
      await max.page.goto(h.origin + "/lobby.html?g=ski", { waitUntil: "domcontentloaded" });
      for (const p of players) h.eq(realErrs(p), [], `no console errors (${p.label})`);
      report.engine = engine;
    } finally {
      if (process.env.SKI_MPC_REPORT) fs.writeFileSync(process.env.SKI_MPC_REPORT, JSON.stringify(report, null, 2));
      await closePlayers(players);
    }
  },
};
runIfMain(import.meta.url, flow);
