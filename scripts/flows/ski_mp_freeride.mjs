/* Flow: Ski Alpen ONLINE FREE RIDE (R7-D). Three players in three browser contexts of one browser; the lobby + hand-shake through the
 * in-process Realtime hub (mp_hub.mjs), the states over real WebRTC between the contexts, max over the relay only (no direct path).
 * Nothing reaches Supabase. Per resort (SKI_MPF_RESORTS = "killy" by default, "all" = the five):
 *   lobby: mode «Fräi fueren» hides piste + runs -> start -> everybody in the free ride side by side at the SAME start lift ->
 *   everybody sees everybody (interpolated, ~15 states / s over WebRTC) -> emma skis: the host sees her where she really is ->
 *   host + emma ride the lift together: each sees the other in his own carrier on the same lift at the same metre ->
 *   emma skips the ride (a jump): the others snap, never slide -> max fast-travels to another lift: the others see him appear there ->
 *   name tags: never two on top of each other (also with 6 extra skiers bunched) -> the avalanche event reaches the others ->
 *   the host leaves: emma becomes the host (weather / time / day clock) -> the host comes back: he appears where he was ->
 *   0 console errors.
 * FLOW_BROWSER=webkit runs it in WebKit. SKI_MPF_REPORT=/path.json dumps the numbers; FLOW_SHOTS_DIR gets the screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";
import { createHub, createWorld, newPlayer, closePlayers, USERS, realErrors, lobbyCode, sleep } from "./mp_lobby_lib.mjs";

const NAME = "ski-mp-freeride";
const ALL_RESORTS = ["killy", "3vallees", "zermatt", "arlberg", "kronplatz", "vialattea", "obertauern", "livigno", "davos", "laax", "soelden"];
const T = { timeout: 150000 };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const DEBUG_Q = "&debug=1&q=low&res=fixed";
const SMALL = { width: 640, height: 400 };

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
const me = (f) => f.evaluate(() => { const s = window.__ski.state; return { x: s.x, z: s.z, y: s.y, ride: s.ride || "", lift: s.rideLift, s: s.rideS || 0, speed: s.speed }; });
const seenBy = (f, name) => f.evaluate((n) => {
  const r = window.__skiMp.remotes.all().find((x) => x.name === n);
  if (!r || !r.state) return null;
  return { x: r.state.x, z: r.state.z, y: r.state.y, ride: r.state.ride || "", lift: r.state.rideLift, s: r.state.rideS || 0, jumps: r.jumps, carrier: !!(r.carrier && r.carrier.group ? r.carrier.group.visible : r.carrier), tag: r.tagMode || "hidden", visible: r.model.root.visible };
}, name);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/* the shown tag boxes (CSS px) of a frame: no two may overlap */
const tagRects = (f) => f.evaluate(() => [...document.querySelectorAll(".mp-tag")].filter((t) => !t.hidden).map((t) => { const r = t.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, dot: t.classList.contains("dot"), text: t.textContent }; }));
const overlapping = (rects) => { const out = []; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) out.push([a.text, b.text]); } return out; };

export const flow = {
  name: NAME,
  fullChromium: true,
  viewport: { width: 960, height: 600 },
  async run(h) {
    const want = (process.env.SKI_MPF_RESORTS || "killy").trim();
    const resorts = want === "all" ? ALL_RESORTS : want.split(",").filter((r) => ALL_RESORTS.includes(r));
    const shotDir = process.env.FLOW_SHOTS_DIR || "";
    const report = { engine: process.env.FLOW_BROWSER || "chromium", resorts: {} };
    const hub = createHub();
    const world = createWorld({ hub, friends: { [USERS.ian.id]: [USERS.emma.id, USERS.max.id], [USERS.emma.id]: [USERS.ian.id], [USERS.max.id]: [USERS.ian.id] } });
    const players = [];
    const shot = async (p, label) => { if (!shotDir) return; fs.mkdirSync(shotDir, { recursive: true }); await p.page.screenshot({ path: path.join(shotDir, `${NAME}.${report.engine}.${label}.png`) }); };
    try {
      const emma = await newPlayer(h, world, { label: "emma", user: USERS.emma, first: true }); players.push(emma);
      const host = await newPlayer(h, world, { label: "host", user: USERS.ian, viewport: SMALL }); players.push(host);
      const max = await newPlayer(h, world, { label: "max", user: USERS.max, viewport: SMALL }); players.push(max);
      for (const p of players) await mockTurn(p);
      await max.context.addInitScript(() => { if (window.RTCPeerConnection) RTCPeerConnection.prototype.setRemoteDescription = () => new Promise(() => {}); });

      for (const rid of resorts) {
        const R = report.resorts[rid] = {};
        h.step(`${rid}: lobby, mode «Fräi fueren» (piste + runs hidden), invite, start`);
        await host.page.goto(h.origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
        let hf = await gameFrame(host);
        await hf.waitForSelector("#resortScreen #skiOnline", T);
        await hf.click("#skiOnline");
        await host.page.waitForURL(/lobby\.html\?g=ski$/, T);
        h.expect(await host.page.locator("#mplCreate").isVisible() && await host.page.locator("#mplCode").isVisible(), "«Online-Rennen» opens the CHOICE (create / join by code), no lobby created yet");
        h.expect((await host.page.locator("#mplRoster").count()) === 0 || !(await host.page.locator("#mplRoster").isVisible()), "no lobby was created by pressing «Online-Rennen»");
        await host.page.click("#mplCreate");
        await host.page.waitForSelector("#mplRoster");
        const code = await lobbyCode(host.page);
        const heads = () => host.page.$$eval("#mplSettings .mpl-setting h4", (e) => e.map((x) => x.textContent));
        const group = (label) => host.page.locator("#mplSettings .mpl-setting").filter({ has: host.page.locator("h4", { hasText: label }) });
        await group("Modus").locator('[data-v="free"]').click();
        h.eq(await heads(), ["Modus", "Skigebitt", "Wieder", "Zäit"], `${rid}: free ride: no piste, no runs`);
        await group("Skigebitt").locator(`[data-v="${rid}"]`).click();
        await group("Wieder").locator('[data-v="sun"]').click();
        await group("Zäit").locator('[data-v="random"]').click();
        await host.page.click("#mplAdd");
        await host.page.click('.ppk-row[data-name="Emma"]');
        await host.page.click('.ppk-row[data-name="Max"]');
        await host.page.click("#ppGo");
        for (const g of [emma, max]) {
          await g.page.goto(h.origin + `/lobby.html?g=ski&c=${code}`, { waitUntil: "domcontentloaded" });
          await g.page.waitForSelector("#mplRoster");
        }
        await host.page.waitForFunction(() => document.querySelectorAll("#mplRoster .mpl-row:not(.mpl-empty):not(.mpl-invited)").length === 3, null, T);
        for (const g of [emma, max]) await g.page.click("#mplReady");
        await host.page.waitForFunction(() => !document.getElementById("mplStart").disabled, null, T);
        await host.page.click("#mplStart");
        for (const p of players) await p.page.waitForURL(/pixelbreak\.html\?g=ski&room=/, T);
        for (const p of players) await gameFrame(p);              // (WebKit: a reload in the middle of the boot logs a cancelled module import)
        for (const p of players) { p.errMark = p.errors.length; await p.page.goto(p.page.url() + DEBUG_Q, { waitUntil: "domcontentloaded" }); }
        const F = {};
        for (const p of players) F[p.label] = await gameFrame(p);
        // WebKit logs the old page's requests that the reload cancelled (a script / REST call in flight) as errors: only those are dropped
        for (const p of players) p.errors = p.errors.filter((e, i) => i < p.errMark || !/access control checks|load https:|load \/|cancel/i.test(e));
        const t0 = Date.now();
        for (const p of players) await F[p.label].waitForFunction(() => document.documentElement.dataset.skiMp === "free" && document.documentElement.dataset.skiRunning === "1" && window.__ski.game.phase === "running", null, T);
        R.startS = +((Date.now() - t0) / 1000).toFixed(1);

        h.step(`${rid}: everybody in the free ride at the same lift, side by side, linked`);
        const rids = await Promise.all(players.map((p) => F[p.label].evaluate(() => [window.__ski.game.mode, document.documentElement.dataset.skiPhysics, window.__ski.spawn && window.__ski.spawn.name])));
        h.expect(rids.every((r) => r[0] === "freeride" && r[1] !== "fair" && r[2] === rids[0][2]), `${rid}: all three free ride at ${rids[0][2]} (${JSON.stringify(rids)})`);
        const spots = await Promise.all(players.map((p) => me(F[p.label])));
        const gaps = [dist(spots[0], spots[1]), dist(spots[1], spots[2]), dist(spots[0], spots[2])];
        h.expect(gaps.every((g) => g > 1 && g < 8), `${rid}: side by side (${gaps.map((g) => g.toFixed(1)).join(", ")} m apart)`);
        await F.emma.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 2, null, { timeout: 90000 });
        await F.host.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 2, null, { timeout: 90000 });
        await F.max.waitForFunction(() => window.__skiMp.remotes.all().filter((r) => r.state).length === 2, null, { timeout: 90000 });
        const nets = await Promise.all(players.map((p) => F[p.label].evaluate(() => window.__skiMp.info())));
        R.links = nets.map((n) => n.net.peers.map((q) => `${q.via}:${q.status}`).join(" "));
        h.expect(nets.every((n) => n.net.peers.every((q) => q.status === "here" && q.via)), `${rid}: everybody linked (${R.links.join(" | ")})`);
        h.eq(nets.map((n) => n.host), nets.map(() => nets[0].host), `${rid}: everybody sees the same host`);
        await sleep(1500);
        await shot(emma, `${rid}.start`);

        h.step(`${rid}: emma skis: the host sees her where she is (interpolation, send rate)`);
        // (cleanup round: the spawn faces UP the lift line, so she used to push uphill and stop after ~0.6 s; now she turns to the fall
        // line where she stands first, no move: no teleport)
        await F.emma.evaluate(() => {
          const S = window.__ski, s = S.state, n = S.surface.normal(s.x, s.z, {});
          if (Math.hypot(n.x, n.z) > 0.02) S.placeHold(s.x, s.z, Math.atan2(n.z, n.x));
          S.setInput({ steer: 0.05, tuck: 0.6, brake: 0, push: 1, jump: false });
        });
        await sleep(1500);
        // (cleanup round) emma's own sends while she moves, counted where they leave, per second of her moving time (standing she sends
        // 4 / s by design; she may come to a halt in the window)
        const send0 = await F.emma.evaluate(() => { const i = window.__skiMp.info(); return { n: i.movingSends, t: i.movingMs }; });
        const sync = [];
        for (let i = 0; i < 8; i++) {
          const [shown, real] = await Promise.all([seenBy(F.host, "Emma"), me(F.emma)]);
          if (shown && real) sync.push({ d: dist(shown, real), v: real.speed });
          await sleep(200);
        }
        const send1 = await F.emma.evaluate(() => { const i = window.__skiMp.info(); return { n: i.movingSends, t: i.movingMs }; });
        const movedMs = send1.t - send0.t, sendHz = movedMs > 400 ? (send1.n - send0.n) / (movedMs / 1000) : NaN;
        // the host's rate: the states in its buffer while she was moving (> 0.4 m/s: a stop sends 4 / s by design, which the old
        // whole-buffer average counted in: 7-9 / s when she came to a halt against the station fence)
        const hz = await F.host.evaluate(() => {
          const r = window.__skiMp.remotes.all().find((x) => x.name === "Emma"), b = r.buf;
          let i = b.length - 1;
          while (i > 0 && !(b[i].s.speed > 0.4)) i--;
          const end = i;
          while (i > 0 && b[i - 1].s.speed > 0.4) i--;
          return end - i >= 4 ? (end - i) / ((b[end].t - b[i].t) / 1000) : 0;
        });
        // (cleanup round: the sender's frame times, so a low rate says whether the page ran slow or the schedule lost sends)
        const frames = await F.emma.evaluate(() => window.__ski.frames());
        await F.emma.evaluate(() => window.__ski.setInput(null));
        R.sync = { metres: sync.map((s) => +s.d.toFixed(1)), lagMs: sync.map((s) => Math.round(s.d / Math.max(1, s.v) * 1000)), hz: +hz.toFixed(1), sendHz: Number.isNaN(sendHz) ? null : +sendHz.toFixed(1), movedMs: Math.round(movedMs), speeds: sync.map((s) => +s.v.toFixed(1)), frameP50: Math.round(frames.p50), frameP95: Math.round(frames.p95) };
        h.expect(sync.length >= 6 && Math.max(...R.sync.lagMs) < 900, `${rid}: the host sees emma ${Math.min(...R.sync.lagMs)}-${Math.max(...R.sync.lagMs)} ms behind (${R.sync.metres.join(", ")} m)`);
        h.expect(!(sendHz < 12), `${rid}: emma sends ${Number.isNaN(sendHz) ? "(moved < 0.4 s of the window)" : sendHz.toFixed(1)} states / s while moving, ${Math.round(movedMs)} ms of it (15 on the wall clock; her frames p50 ${R.sync.frameP50} / p95 ${R.sync.frameP95} ms)`);
        h.expect(hz >= 11, `${rid}: emma's states reach the host at ${hz.toFixed(1)} / s while she moves (speeds ${R.sync.speeds.join(", ")} m/s)`);

        h.step(`${rid}: host + emma ride the lift together (lift id + metres, each in his own carrier)`);
        for (const p of [host, emma]) await F[p.label].evaluate(() => window.__ski.goFree());          // both back to the start lift (a teleport)
        for (const p of [host, emma]) await F[p.label].waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.modes.liftAt, null, { timeout: 30000 });
        await F.host.evaluate(() => window.__ski.boardLift());
        await sleep(800);
        await F.emma.evaluate(() => window.__ski.boardLift());
        await F.emma.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 15000 });
        // R8: R7-B's boarding walks / skates them to the loading line first and the next carrier of the loop picks them up there
        for (const p of [host, emma]) await F[p.label].waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 30000 });
        await sleep(2500);
        const [hr, er] = await Promise.all([me(F.host), me(F.emma)]);
        h.expect(hr.ride && er.ride && hr.lift === er.lift, `${rid}: both ride lift ${hr.lift} (${hr.ride} / ${er.ride})`);
        const [emmaAtHost, hostAtEmma, emmaAtMax] = await Promise.all([seenBy(F.host, "Emma"), seenBy(F.emma, "tester"), seenBy(F.max, "Emma")]);
        const [er2, hr2] = await Promise.all([me(F.emma), me(F.host)]);
        R.lift = { lift: hr.lift, emmaAtHost: emmaAtHost && { ride: emmaAtHost.ride, ds: +(er2.s - emmaAtHost.s).toFixed(1), carrier: emmaAtHost.carrier }, hostAtEmma: hostAtEmma && { ride: hostAtEmma.ride, ds: +(hr2.s - hostAtEmma.s).toFixed(1), carrier: hostAtEmma.carrier }, emmaAtMax: emmaAtMax && emmaAtMax.ride };
        h.expect(!!emmaAtHost && emmaAtHost.ride && emmaAtHost.lift === er.lift && emmaAtHost.carrier, `${rid}: the host sees emma riding lift ${er.lift} in her own carrier (${JSON.stringify(R.lift.emmaAtHost)})`);
        h.expect(!!hostAtEmma && hostAtEmma.ride && hostAtEmma.lift === hr.lift && hostAtEmma.carrier, `${rid}: emma sees the host on the same lift (${JSON.stringify(R.lift.hostAtEmma)})`);
        h.expect(Math.abs(R.lift.emmaAtHost.ds) < 25 && Math.abs(R.lift.hostAtEmma.ds) < 25, `${rid}: shown on the line within 25 m of where they really are (${R.lift.emmaAtHost.ds} / ${R.lift.hostAtEmma.ds} m)`);
        h.expect(hr2.s > er2.s, `${rid}: the host boarded first: he is ahead on the line (${hr2.s.toFixed(0)} > ${er2.s.toFixed(0)} m)`);
        h.expect(emmaAtMax === null || !!emmaAtMax.ride, `${rid}: max (relay) sees emma riding too (${JSON.stringify(R.lift.emmaAtMax)})`);
        await shot(emma, `${rid}.lift`);

        // 28 Nov 2026: the piste map on a lift (online free ride too): the ride goes on underneath, the others still see him in his carrier
        h.step(`${rid}: the host opens the piste map on the lift: the ride goes on, the others still see him in his carrier`);
        {
          const m0 = await me(F.host);
          if (m0.ride) {
            await F.host.evaluate(() => window.__ski.showRideMap());
            h.eq(await F.host.evaluate(() => document.documentElement.dataset.skiRideMap), "1", `${rid}: the host's map is open on the lift`);
            await sleep(1500);
            const [m1, atEmma] = await Promise.all([me(F.host), seenBy(F.emma, "tester")]);
            h.expect(!m1.ride || m1.s > m0.s + 3, `${rid}: the host's lift ride went on under the map (${m0.s.toFixed(0)} -> ${m1.s.toFixed(0)} m)`);
            h.expect(!m1.ride || (!!atEmma && !!atEmma.ride && atEmma.lift === m0.lift), `${rid}: emma still sees the host riding lift ${m0.lift} (${JSON.stringify(atEmma && { ride: atEmma.ride, lift: atEmma.lift })})`);
            await shot(host, `${rid}.lift-map`);
            await F.host.evaluate(() => window.__ski.closeRideMap());
            h.eq(await F.host.evaluate(() => document.documentElement.dataset.skiRideMap || ""), "", `${rid}: closed again`);
          }
        }

        h.step(`${rid}: emma skips the ride: the others snap her to the top (no slide)`);
        const jumps0 = (await seenBy(F.host, "Emma")).jumps;
        const epoch0 = await F.emma.evaluate(() => window.__skiMp.epoch);
        await F.emma.evaluate(() => window.__ski.skipRide());
        await F.emma.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 20000 });
        const top = await me(F.emma);
        const path1 = [];
        for (let i = 0; i < 16; i++) { const s = await seenBy(F.host, "Emma"); if (s) path1.push(s); if (s && dist(s, top) < 4) break; await sleep(150); }
        const lastSeen = path1[path1.length - 1];
        h.expect(!!lastSeen && dist(lastSeen, top) < 6, `${rid}: the host sees emma at the top (${lastSeen ? dist(lastSeen, top).toFixed(1) : "?"} m)`);
        const mid = path1.filter((s) => !s.ride && dist(s, top) > 30);
        h.expect(mid.length === 0, `${rid}: never between the line and the top (${mid.length} in-between samples)`);
        R.skip = { epoch: (await F.emma.evaluate(() => window.__skiMp.epoch)) - epoch0, jumps: (await seenBy(F.host, "Emma")).jumps - jumps0 };

        // ride down (Via Lattea Cesana round): emma rides the same lift DOWN: the host sees her in her carrier on the down lane
        const liftId = await F.emma.evaluate((i) => { const l = window.__ski.modes.lifts.byIndex.get(i); return l && l.down ? l.id : null; }, hr.lift);
        if (liftId) {
          h.step(`${rid}: emma rides the lift down: the host sees her going down in her own carrier`);
          await F.emma.evaluate((id) => window.__ski.goDown(id), liftId);
          await F.emma.waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.modes.liftDown, null, { timeout: 30000 });
          await F.emma.evaluate(() => window.__ski.boardLift());
          await F.emma.waitForFunction(() => window.__ski.ride && window.__ski.ride.down && window.__ski.ride.phase === "ride", null, { timeout: 20000 });
          await sleep(1500);
          const ed = await F.emma.evaluate(() => { const s = window.__ski.state; return { x: s.x, z: s.z, kind: s.rideKind, s: s.rideS }; });
          const seenD = await seenBy(F.host, "Emma");
          const kindSeen = await F.host.evaluate(() => { const r = window.__skiMp.remotes.all().find((x) => x.name === "Emma"); return r && r.state ? r.state.rideKind : null; });
          R.down = { kind: ed.kind, seenKind: kindSeen, off: seenD ? +dist(seenD, ed).toFixed(1) : null, carrier: seenD && seenD.carrier };
          h.expect(ed.kind > 10 && kindSeen === ed.kind && !!seenD && seenD.carrier && dist(seenD, ed) < 25, `${rid}: the host sees emma riding DOWN in her carrier (${JSON.stringify(R.down)})`);
          await F.emma.evaluate(() => window.__ski.skipRide());
          await F.emma.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 20000 });
        }

        h.step(`${rid}: max fast-travels to another lift: the others see him appear there`);
        const other = await F.max.evaluate(() => { const L = window.__ski.modes.lifts.list, s = window.__ski.state; const far = L.filter((l) => !l.tunnel && l.kind !== "drag" && Math.hypot(l.bottom.x - s.x, l.bottom.z - s.z) > 800); return (far[0] || L[L.length - 1]).id; });
        await F.max.evaluate((id) => window.__ski.goFree(id), other);
        await F.max.waitForFunction((id) => window.__ski.game.phase === "running" && Math.hypot(window.__ski.state.x - window.__ski.modes.lifts.byId.get(id).bottom.x, window.__ski.state.z - window.__ski.modes.lifts.byId.get(id).bottom.z) < 80, other, { timeout: 30000 });
        const there = await me(F.max);
        let maxSeen = null;
        for (let i = 0; i < 30; i++) { maxSeen = await seenBy(F.emma, "Max"); if (maxSeen && dist(maxSeen, there) < 6) break; await sleep(250); }
        R.teleport = { lift: other, shownOff: maxSeen ? +dist(maxSeen, there).toFixed(1) : null, jumps: maxSeen ? maxSeen.jumps : null };
        h.expect(!!maxSeen && dist(maxSeen, there) < 6, `${rid}: emma sees max at the new lift (${R.teleport.shownOff} m off; relay pair)`);

        h.step(`${rid}: «Bei e Frënd» brings emma next to a friend`);
        await F.emma.waitForSelector(".mp-friend:not([hidden])", { timeout: 15000 });
        await F.emma.click(".mp-friend");
        await F.emma.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 20000 });
        await sleep(2500);
        const [eNow, hNow, mNow] = await Promise.all([me(F.emma), me(F.host), me(F.max)]);
        // the host still rides his lift: «Bei e Frënd» to him = that lift's top (where he gets off); max skis: next to him
        const hostTop = hNow.ride ? await F.emma.evaluate((i) => { const S = window.__ski, l = S.modes.lifts.byIndex.get(i); return S.modes.lifts.startAt(l, (x, z) => S.field.height(x, z)); }, hNow.lift) : null;
        R.toFriend = +Math.min(dist(eNow, mNow), hostTop ? dist(eNow, hostTop) : dist(eNow, hNow)).toFixed(1);
        h.expect(R.toFriend < 15, `${rid}: emma is ${R.toFriend} m from a friend (or from the top of the lift the host rides)`);

        h.step(`${rid}: name tags never overlap (the three, then 6 more skiers bunched)`);
        if (await F.host.evaluate(() => !!window.__ski.ride)) { await F.host.evaluate(() => window.__ski.skipRide()); await F.host.waitForFunction(() => !window.__ski.ride && window.__ski.game.phase === "running", null, { timeout: 20000 }); }
        for (const p of [emma, host]) await F[p.label].evaluate(() => window.__ski.goFree());
        await sleep(2500);
        await F.emma.evaluate(() => {
          const M = window.__skiMp, S = window.__ski, colours = ["rout", "blo", "giel", "greng", "rosa", "schwaarz"];
          for (let i = 0; i < 6; i++) M.remotes.add(`fake${i}`, `Frënd ${i + 1}`, colours[i]);
          window.__fakeTimer = setInterval(() => {
            const s = S.state, fx = Math.cos(s.heading), fz = Math.sin(s.heading);
            for (let i = 0; i < 6; i++) {
              const side = (i % 2 ? 1 : -1) * (0.5 + Math.floor(i / 2) * 0.5), ahead = 10 + i * 0.6;
              M.remotes.push(`fake${i}`, 0, performance.now(), [s.x + fx * ahead - fz * side, s.y, s.z + fz * ahead + fx * side, s.heading, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
            }
          }, 70);
        });
        await sleep(1200);
        const rects = await tagRects(F.emma);
        const modesSeen = await F.emma.evaluate(() => window.__skiMp.remotes.all().map((r) => r.tagMode || "hidden"));
        R.tags = { shown: rects.length, dots: rects.filter((r) => r.dot).length, modes: modesSeen, overlaps: overlapping(rects) };
        h.expect(R.tags.overlaps.length === 0 && rects.length >= 3, `${rid}: ${rects.length} tags shown (${R.tags.dots} dots), none on top of another (${JSON.stringify(R.tags.overlaps)})`);
        h.expect(modesSeen.filter((m) => m === "full").length >= 3, `${rid}: the nearest three always with their name (${modesSeen.join(",")})`);
        await shot(emma, `${rid}.tags`);
        await F.emma.evaluate(() => { clearInterval(window.__fakeTimer); for (let i = 0; i < 6; i++) window.__skiMp.remotes.remove(`fake${i}`); });

        h.step(`${rid}: the avalanche event reaches the others`);
        // R8b (security LOW 3): only a real avalanche zone travels: a forged id is dropped, a Lawin face's top cell arrives
        await F.emma.evaluate(() => window.__skiMp.shareAvalanche("c12_34", 776));
        const avId = await F.emma.evaluate(async () => { const m = await import('/pb/ski/avalanche.js'); const f = window.__ski.avalanches.faces[0]; return m.cellId(f.top.x, f.top.z); });
        await h.pause(1200);
        await F.emma.evaluate((id) => window.__skiMp.shareAvalanche(id, 777), avId);
        await F.max.waitForFunction((id) => document.documentElement.dataset.skiMpAvalanche === `${id}:777`, avId, { timeout: 15000 });
        await F.host.waitForFunction((id) => document.documentElement.dataset.skiMpAvalanche === `${id}:777`, avId, { timeout: 15000 });
        h.expect(true, `${rid}: avalanche ${avId} seed 777 (a Lawin face) arrived at the host and max; the forged c12_34 was not shown first`);

        h.step(`${rid}: the host leaves: emma takes over the day (weather / time); the host comes back where he was`);
        const hostSpot = await me(F.host);
        await sleep(2200);                                                // his spot is saved every 2 s
        const gameUrl = host.page.url();
        await host.page.goto(h.origin + "/pixelbreak.html", { waitUntil: "domcontentloaded" });
        await F.emma.waitForFunction(() => window.__skiMp.hostId() === window.__skiMp.ctx.me, null, { timeout: 40000 });
        await F.max.waitForFunction(() => window.__skiMp.hostId() !== window.__skiMp.ctx.roster[0].id, null, { timeout: 40000 });
        await F.emma.evaluate(() => window.__ski.env.setWeather("fog", false));
        await F.max.waitForFunction(() => window.__ski.env.state.weatherId === "fog", null, { timeout: 15000 });
        h.expect(true, `${rid}: emma is the host now, her weather (fog) reached max`);
        await host.page.goto(gameUrl, { waitUntil: "domcontentloaded" });
        F.host = await gameFrame(host);
        await F.host.waitForFunction(() => document.documentElement.dataset.skiMp === "free" && window.__ski.game.phase === "running", null, T);
        const back = await me(F.host);
        h.expect(dist(back, hostSpot) < 25, `${rid}: the host is back where he left (${dist(back, hostSpot).toFixed(1)} m)`);
        await F.emma.waitForFunction(() => { const r = window.__skiMp.remotes.all().find((x) => x.name === "tester"); return !!(r && r.state); }, null, { timeout: 90000 });
        const [hostAgain, real] = await Promise.all([seenBy(F.emma, "tester"), me(F.host)]);
        h.expect(!!hostAgain && dist(hostAgain, real) < 8, `${rid}: emma sees him again (${hostAgain ? dist(hostAgain, real).toFixed(1) : "?"} m)`);
        await F.host.waitForFunction(() => window.__skiMp.hostId() === window.__skiMp.ctx.roster[0].id, null, { timeout: 20000 });
        R.frames = await F.emma.evaluate(() => window.__ski.frames());
        R.net = await Promise.all(players.map((p) => F[p.label].evaluate(() => window.__skiMp.session.info().stats)));
        for (const p of players) h.eq(realErrors(p).filter((e) => !/WebGL|GPU stall|swiftshader|webkit-masked-url|cancel|due to access control checks/i.test(e)), [], `${rid}: no console errors (${p.label})`);
        for (const p of players) p.errors.length = 0;
        console.log(`    ${rid}: ${JSON.stringify({ start: R.startS, sync: R.sync, lift: R.lift, skip: R.skip, down: R.down, teleport: R.teleport, tags: { shown: R.tags.shown, dots: R.tags.dots } })}`);
      }
    } finally {
      if (process.env.SKI_MPF_REPORT) fs.writeFileSync(process.env.SKI_MPF_REPORT, JSON.stringify(report, null, 2));
      await closePlayers(players);
    }
  },
};

runIfMain(import.meta.url, flow);
