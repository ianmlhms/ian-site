/* Flow: inviting a FRIEND from the Ski Alpen page, end to end (Ian, school iPad: "ski alpen multiplayer is really buggy, when inviting by
 * friends but over the ski alpen page"). Three Realtime-hub players (mp_hub.mjs, the repo's mocked Supabase), nothing reaches the live
 * project. Each player is its own browser context of ONE browser; the iPad guest has a touch context with an iPad user agent.
 *   (a) the host opens Ski Alpen in the arcade frame, taps «Online-Rennen» (lobby), invites a friend from the picker; the guest is playing Ski Alpen
 *       standalone (pb/ski.html) on an iPad: the live-game banner appears, tap -> sheet -> Join -> the LOBBY (never friends.html); roster, ready, start
 *   (b) free ride together: same resort, they see each other, a lift ride, name tags; the guest reloads and is back in the session at his spot
 *   (c) the host leaves: the guest is host now; the host comes back through the lobby link
 *   (d) answers: decline, sent twice, expired, the room gone, a second invite while the friend is in another game, a closed lobby
 *   (e) an OLD cached client (mp-games.js without `ski`, no import map): Join must still reach the lobby, or say why not in Luxembourgish
 *   (f) the same invite taken from the friends page and from the notification link
 *   (g) race mode: friend joins through the invite, 2 players race one run
 * FLOW_BROWSER=webkit runs it in WebKit. SKI_MPI_REPORT=/path.json dumps the numbers; FLOW_SHOTS_DIR gets screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-mp-invite";
const T = { timeout: 150000 };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const DEBUG_Q = "debug=1&q=low&res=fixed";
const SMALL = { width: 800, height: 520 };
const IPAD = { viewport: { width: 1024, height: 768 }, contextOptions: { hasTouch: true, isMobile: false, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" } };

const frameOf = (p) => p.page.frames().find((f) => f.url() === "about:srcdoc");
async function arcadeFrame(p) {
  await p.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument; return !!(d && d.documentElement && d.documentElement.dataset.skiReady === "1"); }, null, T);
  return frameOf(p);
}
async function standaloneReady(p) {
  await p.page.waitForFunction(() => document.documentElement.dataset.skiReady === "1", null, T);
  return p.page;
}
async function mockTurn(p) {
  await p.context.route(/\/functions\/v1\/turn/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ iceServers: [{ urls: ["stun:127.0.0.1:3478"] }], turn: false, provider: "mock", ttl: 7200 }) });
  });
}
const rosterCount = (page) => page.evaluate(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length);
const statusOf = (world, id) => world.invites.find((i) => i.id === id)?.status;
const until = async (fn, ms = 15000, step = 150) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return false; await sleep(step); } };
const seenBy = (f, name) => f.evaluate((n) => {
  const r = window.__skiMp.remotes.all().find((x) => x.name === n);
  return r && r.state ? { x: r.state.x, z: r.state.z, ride: r.state.ride || "", lift: r.state.rideLift } : null;
}, name);

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

      /* ---------------- (a) invite from the picker, banner on the iPad, Join, lobby ---------------- */
      h.step("(a) host: Ski Alpen picker -> «Online-Rennen» -> lobby, free ride, Killy; Emma plays Ski Alpen standalone on an iPad");
      await emma.page.goto(h.origin + `/pb/ski.html?${DEBUG_Q}&noresume=1`, { waitUntil: "domcontentloaded" });
      await standaloneReady(emma);
      await host.page.goto(h.origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
      const hf0 = await arcadeFrame(host);
      await hf0.waitForSelector("#resortScreen #skiOnline", T);
      await hf0.click("#skiOnline");
      await host.page.waitForURL(/lobby\.html\?g=ski&c=new/, T);
      await host.page.waitForSelector("#mplRoster");
      const code = await lobbyCode(host.page);
      const group = (label) => host.page.locator("#mplSettings .mpl-setting").filter({ has: host.page.locator("h4", { hasText: label }) });
      await group("Modus").locator('[data-v="free"]').click();
      await group("Skigebitt").locator('[data-v="killy"]').click();
      await group("Wieder").locator('[data-v="sun"]').click();
      await group("Zäit").locator('[data-v="midday"]').click();
      await host.page.click("#mplAdd");
      await host.page.click('.ppk-row[data-name="Emma"]');
      await host.page.click("#ppGo");
      h.eq(world.mpInviteCalls.map((c) => [c.p_game, c.p_room]), [["ski", code.toLowerCase()]], "mp_invite carries game ski + the lobby code");

      h.step("(a) Emma (iPad, playing) gets the slim banner, taps it, taps Join -> the lobby, not the friends page");
      await emma.page.waitForSelector(".ip-top .ip-bar", { timeout: 40000 }).catch(async (e) => {
        console.log("    DEBUG emma", JSON.stringify({ errors: emma.errors.slice(-6), warnings: emma.warnings.slice(-6), auth: await emma.page.evaluate(() => ({ g: !!window.__pbAuth, sess: !!(window.__pbAuth && window.__pbAuth.session), sb: !!window.supabase, cfg: !!window.PB_CONFIG, top: window.top === window, res: performance.getEntriesByType('resource').filter((e) => /auth\.js|config|supabase/.test(e.name)).map((e) => e.name.slice(-36) + '@' + Math.round(e.startTime)), url: window.PB_CONFIG && window.PB_CONFIG.url })) }));
        throw e;
      });
      h.expect(await emma.page.locator(".ip-ov").count() === 0, "playing Ski Alpen: a banner, no popup over the game");
      await shot(emma, "a-banner");
      await emma.page.locator(".ip-bar").tap();
      await emma.page.locator(".ip-sheet .ip-primary").tap();
      await emma.page.waitForURL(/lobby\.html|friends\.html/, T);
      h.expect(/lobby\.html\?g=ski&c=/i.test(emma.page.url()), `Join landed in the lobby (${emma.page.url().replace(h.origin, "")})`);
      await emma.page.waitForSelector("#mplRoster", T);
      h.eq(statusOf(world, world.invites[0].id), "accepted", "the invite is marked accepted");
      h.eq(await lobbyCode(emma.page), code, "same lobby code as the host");
      await until(async () => (await rosterCount(host.page)) === 2);
      h.eq(await rosterCount(host.page), 2, "host sees two players");
      // the guest sees the host's settings
      const guestSettings = await emma.page.$$eval("#mplSettings .mpl-setting", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
      h.expect(guestSettings.length >= 4, `guest sees the settings (${guestSettings.length} groups)`);
      await shot(emma, "a-lobby-ipad");
      await emma.page.locator("#mplReady").tap();
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      await host.page.click("#mplStart");
      for (const p of [host, emma]) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      h.expect(host.page.url().includes("role=host") && emma.page.url().includes("role=guest"), "host / guest roles in the game links");

      h.step("(b) both in the free ride, same resort, the guest on the iPad sees the host and vice versa");
      const F = {};
      for (const p of [host, emma]) { await p.page.goto(p.page.url() + "&" + DEBUG_Q, { waitUntil: "domcontentloaded" }); F[p.label] = await arcadeFrame(p); }
      for (const p of [host, emma]) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
      const resorts = await Promise.all([host, emma].map((p) => F[p.label].evaluate(() => window.__skiMp.ctx.cfg.resort + "/" + (window.__ski.spawn && window.__ski.spawn.name))));
      h.expect(resorts[0] && resorts[0] === resorts[1] && /^killy\//.test(resorts[0]), `same resort on both (${resorts.join(" / ")})`);
      await F.host.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 1, null, { timeout: 90000 });
      await F.emma.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 1, null, { timeout: 90000 });
      h.expect(!!(await seenBy(F.host, "Emma")) && !!(await seenBy(F.emma, "tester")), "they see each other");
      await shot(emma, "b-freeride");
      h.step("(b) host + Emma ride the same lift together; Emma (iPad) boards with a tap");
      const me = (f) => f.evaluate(() => { const st = window.__ski.state; return { x: st.x, z: st.z, ride: st.ride || "", lift: st.rideLift, s: st.rideS || 0 }; });
      await F.host.evaluate(() => window.__ski.goFree());
      await F.emma.evaluate(() => window.__ski.goFree());
      for (const p of [host, emma]) await F[p.label].waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.modes.liftAt, null, { timeout: 30000 });
      await F.host.evaluate(() => window.__ski.boardLift());
      await sleep(800);
      await F.emma.evaluate(() => window.__ski.boardLift());
      for (const p of [host, emma]) await F[p.label].waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 40000 });
      await sleep(2500);
      const [hr, er] = await Promise.all([me(F.host), me(F.emma)]);
      h.expect(hr.ride && er.ride && hr.lift === er.lift, `both ride lift ${hr.lift} (${hr.ride} / ${er.ride})`);
      const emmaAtHost = await seenBy(F.host, "Emma"), hostAtEmma = await seenBy(F.emma, "tester");
      h.expect(!!emmaAtHost && !!emmaAtHost.ride && emmaAtHost.lift === er.lift, "the host sees Emma on her lift");
      h.expect(!!hostAtEmma && !!hostAtEmma.ride && hostAtEmma.lift === hr.lift, "Emma sees the host on his lift");
      await shot(emma, "b-lift");
      await F.emma.evaluate(() => window.__ski.skipRide());
      await F.emma.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 20000 });
      await F.host.evaluate(() => window.__ski.skipRide());
      await F.host.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 20000 });

      h.step("(b) Emma reloads the page (iPad Safari does that): back in the same session, same resort, at her spot");
      await sleep(2500);                                    // the own spot is saved every 2 s
      const beforeReload = await me(F.emma);
      await emma.page.reload({ waitUntil: "domcontentloaded" });
      F.emma = await arcadeFrame(emma);
      await F.emma.waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
      const afterReload = await me(F.emma);
      h.expect(Math.hypot(afterReload.x - beforeReload.x, afterReload.z - beforeReload.z) < 40, `Emma is back at her spot (${Math.round(Math.hypot(afterReload.x - beforeReload.x, afterReload.z - beforeReload.z))} m away)`);
      await F.emma.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 1, null, { timeout: 90000 });
      await F.host.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state && r.name === "Emma").length === 1, null, { timeout: 90000 });
      h.expect(true, "the reloaded guest sees the host again and the host sees her");

      h.step("(c) the host leaves with «‹ Lobby»: Emma is the host now; the host comes back and appears where he was");
      const gameLink = host.page.url();
      const hostSpot = await me(F.host);
      await sleep(2200);
      await F.host.click("#mpLobbyBtn");
      await F.host.click("#mpLobbyBtn");
      await host.page.waitForURL(/lobby\.html\?g=ski&c=/, T);
      await F.emma.waitForFunction((id) => window.__skiMp.hostId() === id, await F.emma.evaluate(() => window.__skiMp.ctx.me), { timeout: 60000 });
      h.expect(true, "Emma took over the day (host handover)");
      await host.page.goto(gameLink, { waitUntil: "domcontentloaded" });
      F.host = await arcadeFrame(host);
      await F.host.waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
      await F.emma.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state && r.name === "tester").length === 1, null, { timeout: 90000 });
      const hostBack = await me(F.host);
      h.expect(Math.hypot(hostBack.x - hostSpot.x, hostBack.z - hostSpot.z) < 40, "the host is back near where he left");
      for (const p of [host, emma]) h.eq(realErrors(p), [], `no console errors so far (${p.label})`);

      /* ---------------- (d) answers: Later, invite again, sent twice, expired, declined, room gone, while in another game ---------------- */
      h.step("(d) new lobby, Max sits in another arcade game (Pong): banner; Later; the host can invite him AGAIN; sent twice is said; then Join");
      await max.page.goto(h.origin + "/pixelbreak.html?g=pong", { waitUntil: "domcontentloaded" });
      await max.page.waitForSelector("#gf", T);
      await host.page.goto(h.origin + "/lobby.html?g=ski&c=new", { waitUntil: "domcontentloaded" });
      await host.page.waitForSelector("#mplRoster");
      const code2 = await lobbyCode(host.page);
      const invite = async (name) => { await host.page.click("#mplAdd"); await host.page.click(`.ppk-row[data-name="${name}"]`); await host.page.click("#ppGo"); };
      await invite("Max");
      await max.page.waitForSelector(".ip-top .ip-bar", { timeout: 40000 });
      h.expect(await max.page.locator(".ip-ov").count() === 0, "in another game: a banner, not a popup");
      await max.page.locator(".ip-bar").click();
      await max.page.getByRole("button", { name: "Méi spéit" }).click();
      h.eq(statusOf(world, world.invites.at(-1).id), "pending", "Later keeps the invite pending");
      // sent twice, right away: the server says already invited
      await host.page.click("#mplAdd");
      h.expect(!!(await until(async () => (await host.page.locator('.ppk-row[data-name="Max"]').count()) === 1, 8000)), "the invited-but-silent friend is offered again in the picker");
      await host.page.click('.ppk-row[data-name="Max"]');
      await host.page.click("#ppGo");
      await host.page.waitForFunction(() => /scho/.test(document.querySelector(".mpl-toast")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
      h.expect(/scho invitéiert/.test(await host.page.textContent(".mpl-toast")), `a second tap within seconds: ${await host.page.textContent(".mpl-toast")}`);
      const count0 = world.invites.length;
      // 60 s later (the invite row is old): invite again -> a NEW invite
      for (const i of world.invites) i.created_at = new Date(Date.now() - 60000).toISOString();
      await invite("Max");
      h.eq(world.invites.length, count0 + 1, "an old unanswered invite can be sent again (new row)");
      await max.page.waitForSelector(".ip-top .ip-bar", { timeout: 40000 });
      await max.page.locator(".ip-bar").click();
      await max.page.getByRole("button", { name: "Bäitrieden" }).click();
      await max.page.waitForURL(/lobby\.html\?g=ski&c=/, T);
      h.expect(!/friends\.html/.test(max.page.url()), "Join from the Pong arcade lands in the Ski Alpen lobby");
      await max.page.waitForSelector("#mplRoster");
      await until(async () => (await rosterCount(host.page)) === 2);
      h.eq(await rosterCount(host.page), 2, "host sees Max");

      h.step("(d) Emma, now on the home page: a declined invite, an expired one (nothing shown), a room that is gone (clear message)");
      await emma.page.goto(h.origin + "/index.html", { waitUntil: "domcontentloaded" });
      await until(() => emma.page.evaluate(() => !!window.__pbAuth && !!window.__pbAuth.session), 20000);
      await sleep(1500);
      const mk = (room, ageMs = 0, to = USERS.emma) => { const row = { id: world.seq++, from_user: USERS.ian.id, from_name: "tester", to_user: to.id, game: "ski", room, status: "pending", created_at: new Date(Date.now() - ageMs).toISOString() }; world.invites.push(row); hub.pushInsert("game_invites", row, to.id); return row; };
      const expired = mk("zzzz", 13 * 3600 * 1000);
      await sleep(2500);
      h.expect(await emma.page.locator(".ip-card").count() === 0, "an invite older than 12 h shows nothing");
      const declined = mk("ABCD");
      await emma.page.locator(".ip-card").waitFor({ timeout: 20000 });
      h.expect(/Ski Alpen/.test(await emma.page.locator(".ip-title").innerText()), "the pop-up names Ski Alpen");
      await emma.page.getByRole("button", { name: "Ofleenen" }).tap();
      await until(() => statusOf(world, declined.id) === "declined", 5000);
      h.eq(statusOf(world, declined.id), "declined", "declined is saved");
      h.eq(statusOf(world, expired.id), "pending", "the expired one was never touched");
      mk("WXYZ");
      await emma.page.locator(".ip-card").waitFor({ timeout: 20000 });
      await emma.page.getByRole("button", { name: "Bäitrieden" }).tap();
      await emma.page.waitForURL(/lobby\.html\?g=ski&c=WXYZ/, T);
      await emma.page.waitForSelector("#mplMsg:not([hidden])", T);
      const gone = await emma.page.textContent("#mplMsg");
      h.expect(/net|nët/.test(gone) && /Lobby/.test(gone), `a lobby that is gone says so in Luxembourgish: ${gone.trim()}`);
      await shot(emma, "d-room-gone");

      /* ---------------- (e) an OLD cached client: its mp-games.js does not know `ski` ---------------- */
      h.step("(e) old cached mp-games.js (no ski): Join still reaches the lobby (fresh list, or the generic lobby link), never friends.html");
      const real = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../mp-games.js"), "utf8");
      const stale = real.replace(/\n  ski: G\(\{[^\n]*\n/, "\n");
      h.expect(stale !== real && !/ski: G\(/.test(stale), "(the stale copy has no ski)");
      const staleRoute = (blockFresh) => async (route) => {
        const u = route.request().url();
        if (/[?&]fresh=/.test(u)) return blockFresh ? route.abort() : route.continue();
        return route.fulfill({ status: 200, contentType: "text/javascript", body: stale });
      };
      for (const blockFresh of [false, true]) {
        const lena = await newPlayer(h, world, { label: blockFresh ? "stale-nofresh" : "stale", user: USERS.lena, ...IPAD }); players.push(lena);
        await lena.context.route(/\/mp-games\.js/, staleRoute(blockFresh));
        await lena.page.goto(h.origin + "/index.html", { waitUntil: "domcontentloaded" });
        await until(() => lena.page.evaluate(() => !!window.__pbAuth && !!window.__pbAuth.session), 20000);
        await sleep(1500);
        const row = mk(code2, 0, USERS.lena);
        await lena.page.locator(".ip-card").waitFor({ timeout: 20000 });
        await lena.context.unroute(/\/mp-games\.js/);           // the lobby page itself is loaded by the real files
        await lena.page.getByRole("button", { name: "Bäitrieden" }).tap();
        await lena.page.waitForURL(/lobby\.html|friends\.html/, T);
        h.expect(new RegExp(`lobby\\.html\\?g=ski&c=${code2}`).test(lena.page.url()), `${blockFresh ? "no fresh list either" : "fresh list"}: Join -> ${lena.page.url().replace(h.origin, "")}`);
        h.eq(statusOf(world, row.id), "accepted", "accepted");
        await lena.page.waitForSelector("#mplRoster", T);
        await lena.page.click("#mpl .mpl-foot .mpl-btn:not(#mplReady):not(#mplStart)").catch(() => {});   // leave again (free the seat)
      }

      /* ---------------- (f) the friends page ---------------- */
      h.step("(f) friends page: the pending invite's Join goes to the lobby");
      const row3 = mk(code2, 0);
      await emma.page.goto(h.origin + "/friends.html", { waitUntil: "domcontentloaded" });
      await emma.page.waitForSelector("#invites [data-join]", { state: "attached", ...T });
      if (await emma.page.locator(".ip-card").count()) await emma.page.keyboard.press("Escape");     // the pop-up (Later) is over the list on this page too
      await emma.page.locator("#invites [data-join]").first().click();
      await emma.page.waitForURL(/lobby\.html\?g=ski&c=/, T);
      h.expect(true, "friends page Join -> lobby");
      void row3;

      /* ---------------- (g) race together ---------------- */
      h.step("(g) race: host + Max (arcade, from the invite) race one run on the Face");
      await emma.page.goto(h.origin + "/about.html", { waitUntil: "domcontentloaded" });
      await host.page.bringToFront();
      const g2 = (label) => host.page.locator("#mplSettings .mpl-setting").filter({ has: host.page.locator("h4", { hasText: label }) });
      await g2("Modus").locator('[data-v="race"]').click();
      await g2("Skigebitt").locator('[data-v="killy"]').click();
      await g2("Pist").locator('[data-v="killy/face"]').click();
      await g2("Leef").locator('[data-v="1"]').click();
      await max.page.locator("#mplReady").click();
      await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
      await host.page.click("#mplStart");
      for (const p of [host, max]) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
      const R = {};
      for (const p of [host, max]) { await p.page.goto(p.page.url() + "&" + DEBUG_Q + "&bot=1&timescale=4", { waitUntil: "domcontentloaded" }); R[p.label] = await arcadeFrame(p); await R[p.label].evaluate(() => { window.__skiAllowBotScore = true; }); }
      for (const p of [host, max]) await R[p.label].waitForFunction(() => document.documentElement.dataset.skiMpResults === "0", null, { timeout: 240000 });
      const tables = await Promise.all([host, max].map((p) => R[p.label].evaluate(() => window.__skiMp.race.runTable(0).map((r) => [r.name, r.place, r.res && r.res.ms]))));
      h.eq(tables[1], tables[0], "the same results table on both");
      h.expect(tables[0].length === 2 && tables[0].every((r) => r[1] >= 1 && r[2] > 20000), `two valid times (${JSON.stringify(tables[0])})`);
      await shot(max, "g-results");
      for (const p of players.filter((x) => x.errors)) h.eq(realErrors(p), [], `no console errors (${p.label})`);
      report.engine = engine;
    } finally {
      if (process.env.SKI_MPI_REPORT) fs.writeFileSync(process.env.SKI_MPI_REPORT, JSON.stringify(report, null, 2));
      await closePlayers(players);
    }
  },
};
runIfMain(import.meta.url, flow);
