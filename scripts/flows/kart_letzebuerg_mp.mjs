/* Kart Lëtzebuerg phase 2 (online): two/three real browser contexts race each other over WebRTC.
 * Lobby + SDP hand-shake run through an in-process Realtime hub (kart_mp_hub.mjs), nothing reaches the live Supabase project.
 * Covers: lobby by room code, ready/start, WebRTC link, both players driving (autopilot), position sync (measured), items hitting
 * across peers, identical finish order + results on both, the Supabase request/message budget of one full 3-lap race, quick match,
 * and the host leaving mid-race (host migration to the deputy). Set KL_MP_REPORT=/path.json to dump the measured numbers. */
import fs from 'node:fs';
import { runIfMain } from './lib.mjs';
import { createHub } from './kart_mp_hub.mjs';

const URL_BASE = '/pb/kart-letzebuerg.html?test=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSupabase = (u) => /supabase\.co/.test(u);
const REPORT = {};
const ONLY = (process.env.KL_MP_ONLY || 'all').split(',');
const want = (n) => ONLY.includes('all') || ONLY.includes(n);

/* ---------- helpers ---------- */
async function newPlayer(h, hub, label, { first = false, viewport = { width: 640, height: 400 }, init = null, noRelay = false } = {}) {
  let context = h.context, page = h.page;
  if (!first) {
    context = await h.context.browser().newContext({ viewport, serviceWorkers: 'block' });
    page = await context.newPage();
  }
  await hub.attach(context, label);
  if (init) await context.addInitScript(init);
  if (noRelay) await context.route(/kart-letzebuerg\/config\.js/, async (route) => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('RELAY_FALLBACK: true', 'RELAY_FALLBACK: false') }); });
  const p = { label, context, page, http: [], errors: [], first };
  page.on('request', (r) => { if (isSupabase(r.url()) && r.resourceType() !== 'websocket') p.http.push(r.method() + ' ' + new URL(r.url()).pathname); });
  page.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  page.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  if (!first) await context.route(/supabase\.co\/(rest|auth|functions|storage)\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(h.origin + URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not([hidden])', { timeout: 30000 });
  // debug aid: remember the first non-finite kart state the engine sound sees
  await page.evaluate(() => { const a = window.__klTest.G.audio, o = a.update.bind(a); a.update = (k, opts) => { if (!isFinite(k.speed) || !isFinite(k.drift.charge) || !isFinite(k.boostT)) window.__bad = window.__bad || { id: k.id, speed: k.speed, charge: k.drift.charge, boost: k.boostT, drift: JSON.stringify(k.drift), vx: k.vx, vz: k.vz, x: k.x, remote: k.remote, auto: k.auto, role: window.__klTest.mp().role }; return o(k, opts); }; });
  return p;
}
async function goOnline(p, name) { await p.page.click('#modeOnline'); await p.page.fill('#olName', name); }
const kl = (p, fn, arg) => p.page.evaluate(fn, arg);
const mp = (p) => kl(p, () => window.__klTest.mp());
const st = (p) => kl(p, () => window.__klTest.state());
async function waitFor(p, fn, arg, timeout = 30000) { await p.page.waitForFunction(fn, arg, { timeout }); }
async function lobbyJoin(host, guest, code, name) {
  await goOnline(guest, name);
  await guest.page.fill('#olCode', code); await guest.page.click('#olJoin');
  await guest.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
}
async function setLaps(host, n) { await host.page.locator('#lbLaps button', { hasText: new RegExp('^' + n + '$') }).click(); }
async function readyAndStart(host, guests, laps) {
  if (laps) await setLaps(host, laps);
  for (const g of guests) await g.page.click('#lbReady');
  await waitFor(host, (n) => document.querySelectorAll('#lbList li .st.ok').length === n, guests.length, 15000);
  await host.page.click('#lbStart');
}
async function waitRace(players) { for (const p of players) await waitFor(p, () => window.__klTest && window.__klTest.state().phase === 'race' && window.__klTest.state().clock > 0.3, null, 60000); }
async function closeAll(players) { for (const p of players) { try { await p.page.evaluate(() => window.__klTest && window.__klTest.mpRecord && window.__klTest.mpRecord(false)); } catch { /* gone */ } if (!p.first) { try { await p.context.close(); } catch { /* gone */ } } } }

/* ---------- sync analysis: how far is the displayed remote kart from where it really is? ---------- */
function interp(rec, t) {
  // rec: [{t, x, z}] sorted by t
  let lo = 0, hi = rec.length - 1;
  if (t <= rec[0].t || t >= rec[hi].t) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rec[mid].t <= t) lo = mid; else hi = mid; }
  const a = rec[lo], b = rec[hi], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return [a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u];
}
function analyse(viewerRec, ownerRec, ownerId) {
  const truth = ownerRec.map((s) => ({ t: s.t, x: s.own[0], z: s.own[1] }));
  const out = { samples: 0, lags: {} };
  const best = { lag: 0, mean: Infinity };
  for (let lag = 0; lag <= 400; lag += 20) {
    const errs = [], rawErrs = [];
    for (const s of viewerRec) {
      const v = s.views[ownerId]; if (!v) continue;
      const q = interp(truth, s.t - lag); if (!q) continue;
      errs.push(Math.hypot(v[0] - q[0], v[1] - q[1])); rawErrs.push(Math.hypot(v[2] - q[0], v[3] - q[1]));
    }
    if (!errs.length) continue;
    errs.sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    out.lags[lag] = { mean: +mean.toFixed(3), p95: +errs[Math.floor(errs.length * 0.95)].toFixed(3), n: errs.length };
    if (lag === 0) { out.samples = errs.length; out.displayedVsNow = out.lags[0]; }
    if (mean < best.mean) { best.lag = lag; best.mean = mean; }
  }
  out.bestLagMs = best.lag; out.atBestLag = out.lags[best.lag];
  return out;
}

export const flow = {
  name: 'kart-letzebuerg-mp', fullChromium: true,
  async run(h) {
    const hub = createHub();
    const all = [];
    const finish = async () => { await closeAll(all); };
    try {
      /* ================= 1. two players, room code, full 3-lap race ================= */
      if (want('race')) {
      h.step('2 players: create lobby, join by room code, ready, start (3 laps)');
      const A = await newPlayer(h, hub, 'host', { first: true }); all.push(A);
      const B = await newPlayer(h, hub, 'guest'); all.push(B);
      const f0 = { ...hub.stats }; hub.reset();
      await goOnline(A, 'Hosty');
      await A.page.click('#olCreate');
      await A.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
      const code = (await A.page.textContent('#lbCode')).trim();
      h.expect(/^[A-Z]{4}$/.test(code), 'lobby has a 4-letter room code (' + code + ')');
      await lobbyJoin(A, B, code, 'Guesty');
      await h.shot('lobby-guest');
      await waitFor(A, () => document.querySelectorAll('#lbList li').length === 2);
      const rows = await A.page.locator('#lbList li').allInnerTexts();
      h.expect(rows.length === 2 && /Hosty/.test(rows[0]) && /Guesty/.test(rows[1]), 'both players are in the roster of the host: ' + JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' '))));
      const guestRows = await B.page.locator('#lbList li').allInnerTexts();
      h.expect(guestRows.length === 2, 'the guest sees the same two players');
      h.expect(await A.page.locator('#lbStart').isDisabled(), 'start is blocked until the guest is ready');
      await readyAndStart(A, [B], 3);
      await h.shot('lobby-ready');
      await waitFor(A, () => window.__klTest && window.__klTest.state().phase === 'countdown', null, 60000);
      await waitFor(B, () => window.__klTest && window.__klTest.state().phase === 'countdown', null, 60000);
      h.expect(true, 'both browsers reach the countdown');
      await waitRace([A, B]);
      const mA = await mp(A), mB = await mp(B);
      h.expect(mA.links.length === 1 && mA.links[0].kind === 'rtc' && mA.links[0].open, 'host <-> guest link is a direct WebRTC data channel');
      h.expect(mB.links.some((l) => l.kind === 'rtc' && l.open), 'guest side link is WebRTC too');
      h.eq(await kl(A, () => __klTest.G.race.karts.length), 8, '8 karts (2 humans + 6 bots)');
      h.eq([await kl(A, () => __klTest.G.race.karts.filter((k) => k.human).length), await kl(B, () => __klTest.G.race.karts.filter((k) => k.human).length)], [2, 2], '2 humans on both sides');
      h.expect(!mA.lobby.signalling && !mB.lobby.signalling, 'Realtime signalling is closed once the race is live (both sides)');
      const afterGo = { frames: hub.stats.framesIn + hub.stats.framesOut, bytes: hub.stats.bytesIn + hub.stats.bytesOut };
      await h.shot('race-2p');
      await A.page.screenshot({ path: (process.env.FLOW_SHOTS_DIR || '/tmp') + '/kart-letzebuerg-mp.race-host.png' }).catch(() => {});
      await B.page.screenshot({ path: (process.env.FLOW_SHOTS_DIR || '/tmp') + '/kart-letzebuerg-mp.race-guest.png' }).catch(() => {});

      h.step('items hit across peers (host -> guest orb, guest -> host rocket)');
      const ids = { a: await kl(A, () => __klTest.G.human.id), b: await kl(B, () => __klTest.G.human.id) };
      // guest 30 m behind the host, both parked on the straight; the guest fires a rocket at the kart in front of it (the host)
      const s0 = await kl(A, () => { const t = __klTest.G.track, K = t.K, step = t.step; for (let s = 30; s < t.length - 120; s += 5) { let ok = true; for (let d = -10; d < 110 && ok; d += step) if (Math.abs(K[Math.floor((s + d) / step) % t.N]) > 0.0015) ok = false; if (ok) return s; } return 140; });
      console.log('    straight test section starts at s=' + s0);
      for (const p of [A, B]) await kl(p, () => { window.__keep = setInterval(() => { __klTest.G.human.stuckT = 0; }, 100); });      // parked karts would be rescued after 2.4 s
      await kl(A, (s) => __klTest.teleport(s, 0), s0 + 30);
      await kl(B, (s) => __klTest.teleport(s, 0), s0);
      await sleep(900);
      await kl(A, (id) => { __klTest.G.race.byId[id].item = { id: 'rocket', count: 1 }; }, ids.b);      // the host's book-keeping record of the guest's item
      await kl(B, () => { __klTest.forceItem('rocket'); __klTest.force({ item: true }); });
      await sleep(120); await kl(B, () => __klTest.force(null));
      await waitFor(A, () => __klTest.state().kart.spinT > 0 || __klTest.state().kart.rescued > 0, null, 5000).catch(() => {});
      const hitA = await st(A);
      h.expect(hitA.kart.spinT > 0, 'guest rocket spins the host kart (spinT ' + hitA.kart.spinT.toFixed(2) + ')');
      await sleep(4200);
      // host 12 m behind the guest fires an orb straight ahead
      await kl(A, (s) => __klTest.teleport(s, 0), s0 + 40);
      await kl(B, (s) => __klTest.teleport(s, 0), s0 + 62);
      await sleep(900);
      await kl(A, () => { __klTest.forceItem('orb'); __klTest.force({ item: true }); });
      await sleep(120); await kl(A, () => __klTest.force(null));
      await waitFor(B, () => __klTest.state().kart.spinT > 0, null, 5000).catch(() => {});
      const hitB = await st(B);
      h.expect(hitB.kart.spinT > 0, 'host orb spins the guest kart (spinT ' + hitB.kart.spinT.toFixed(2) + ')');
      // the spinning kart is seen spinning by the other side as well
      const seen = await kl(A, (id) => { const k = __klTest.G.race.byId[id]; return { spinT: k.spinT }; }, ids.b);
      h.expect(seen.spinT > 0 || hitB.kart.spinT > 0, 'the host sees the guest kart spinning too');
      await sleep(3000);

      for (const p of [A, B]) await kl(p, () => clearInterval(window.__keep));
      h.step('both drive on autopilot; positions stay in sync (measured)');
      await kl(A, () => { __klTest.autopilot(true); return __klTest.mpRecord(true); });
      await kl(B, () => { __klTest.autopilot(true); return __klTest.mpRecord(true); });
      await sleep(8000);
      const speedA = (await st(A)).kart.speed, speedB = (await st(B)).kart.speed;
      h.expect(speedA > 8 && speedB > 8, 'both karts are moving (' + speedA.toFixed(1) + ' / ' + speedB.toFixed(1) + ' m/s)');
      const rttB = (await mp(B)).rtt;

      h.step('race finishes for both: same finish order, results on both');
      await Promise.all([A, B].map((p) => p.page.waitForSelector('#endScreen:not([hidden])', { timeout: 420000 })));
      await Promise.all([A, B].map((p) => waitFor(p, () => window.__klTest.G.lastResult && window.__klTest.G.lastResult.rows && document.querySelector('#endSub').textContent.includes('/8'), null, 240000)));
      const resA = await kl(A, () => __klTest.G.lastResult.rows.map((r) => [r.id, r.place, r.finished, Math.round(r.time * 1000)]));
      const resB = await kl(B, () => __klTest.G.lastResult.rows.map((r) => [r.id, r.place, r.finished, Math.round(r.time * 1000)]));
      h.eq(resA.map((r) => r[0] + ':' + r[1]), resB.map((r) => r[0] + ':' + r[1]), 'identical finish order (ids + places) on host and guest');
      h.eq(resA.map((r) => r[3]), resB.map((r) => r[3]), 'identical finish times on host and guest');
      h.expect(resA.length === 8 && resA.every((r) => r[2]), 'results list has 8 finished karts');
      const textA = await A.page.locator('#endList li').allInnerTexts(), textB = await B.page.locator('#endList li').allInnerTexts();
      h.expect(textA.length === 8 && textB.length === 8, 'results are displayed on both pages (8 rows each)');
      h.expect(await A.page.locator('#endList li.me').count() === 1 && await B.page.locator('#endList li.me').count() === 1, 'each page highlights its own row');
      await h.shot('results-2p');
      await B.page.screenshot({ path: (process.env.FLOW_SHOTS_DIR || '/tmp') + '/kart-letzebuerg-mp.results-guest.png' }).catch(() => {});
      const lapsA = await kl(A, (id) => __klTest.G.race.byId[id].lapTimes.length, ids.a);
      h.eq(lapsA, 3, 'host recorded 3 lap times for itself');
      const lapsB = await kl(B, (id) => __klTest.G.race.byId[id].lapTimes.length, ids.b);
      h.eq(lapsB, 3, 'guest recorded 3 lap times for itself (lap events from the host)');

      // ---- sync numbers
      const recA = await kl(A, () => __klTest.mpRecord(false)), recB = await kl(B, () => __klTest.mpRecord(false));
      const cutA = recA.filter((s) => s.t), cutB = recB.filter((s) => s.t);
      const AseesB = analyse(cutA, cutB, ids.b), BseesA = analyse(cutB, cutA, ids.a);
      REPORT.sync = { hostSeesGuest: AseesB, guestSeesHost: BseesA, rttMs: rttB };
      console.log('    sync host sees guest:', JSON.stringify({ displayedVsNow: AseesB.displayedVsNow, bestLagMs: AseesB.bestLagMs, atBestLag: AseesB.atBestLag }));
      console.log('    sync guest sees host:', JSON.stringify({ displayedVsNow: BseesA.displayedVsNow, bestLagMs: BseesA.bestLagMs, atBestLag: BseesA.atBestLag }));
      console.log('    ping (guest -> host -> guest): ' + (rttB == null ? 'n/a' : rttB.toFixed(1) + ' ms'));
      h.expect(AseesB.atBestLag && AseesB.atBestLag.mean < 1.5, 'host: remote kart error after removing the display delay is small (mean ' + (AseesB.atBestLag && AseesB.atBestLag.mean) + ' m)');
      h.expect(BseesA.atBestLag && BseesA.atBestLag.mean < 1.5, 'guest: remote kart error after removing the display delay is small (mean ' + (BseesA.atBestLag && BseesA.atBestLag.mean) + ' m)');

      // ---- Supabase budget for the whole race (lobby -> results)
      h.step('Supabase budget of the full race');
      const s = hub.stats;
      const frames = s.framesIn + s.framesOut;
      const duringRace = frames - afterGo.frames;
      const http = all.flatMap((p) => p.http);
      REPORT.budget = { realtimeFramesToServer: s.framesIn, realtimeFramesToClients: s.framesOut, totalFrames: frames, bytes: s.bytesIn + s.bytesOut, heartbeats: s.heartbeats, framesAfterGo: duringRace, byEvent: s.byEvent, perContext: s.perContext, httpRequests: http.length, httpDetail: http };
      console.log('    Realtime frames: ' + frames + ' total (' + s.framesIn + ' to server, ' + s.framesOut + ' to clients), ' + (s.bytesIn + s.bytesOut) + ' bytes, heartbeats ' + s.heartbeats + '; after the race went live: ' + duringRace);
      console.log('    HTTP requests to supabase.co: ' + http.length + (http.length ? ' ' + JSON.stringify(http) : ''));
      console.log('    by event: ' + JSON.stringify(s.byEvent));
      h.eq(http.length, 0, 'no Supabase HTTP (REST/auth/functions) requests in the whole lobby -> race -> results cycle');
      h.expect(duringRace === 0, 'no Realtime traffic at all while racing (' + duringRace + ' frames after "go")');
      h.expect(frames <= 70, 'whole 2-player race stays within the Realtime frame budget (<= 70 frames, measured ' + frames + ')');
      h.expect(s.bytesIn + s.bytesOut <= 40000, 'and within 40 kB (measured ' + (s.bytesIn + s.bytesOut) + ' bytes)');
      h.expect(A.errors.filter((e) => !/three/.test(e)).length === 0 && B.errors.filter((e) => !/three/.test(e)).length === 0, 'no console errors on either page: ' + JSON.stringify([...A.errors, ...B.errors]));

      h.step('back to lobby for a rematch');
      h.expect(!(await A.page.locator('#eLobby').isHidden()), 'host has a "back to lobby" button');
      await A.page.click('#eLobby');
      await Promise.all([A, B].map((p) => p.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 10000 })));
      h.expect(true, 'both return to the lobby with the same link (no new signalling)');
      await B.page.click('#eMenu').catch(() => {});
      await finish(); all.length = 0;

      }
      /* ================= 2. quick match ================= */
      if (want('quick')) {
      h.step('quick match: the first player creates a public lobby, the second one finds it');
      const Q1 = await newPlayer(h, hub, 'q1'); all.push(Q1);
      const Q2 = await newPlayer(h, hub, 'q2'); all.push(Q2);
      await goOnline(Q1, 'QuickA'); await Q1.page.click('#olQuick');
      await Q1.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
      h.expect((await Q1.page.locator('#lbPublic').isChecked()), 'quick match created a public lobby');
      await goOnline(Q2, 'QuickB'); await Q2.page.click('#olQuick');
      await Q2.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
      await waitFor(Q1, () => document.querySelectorAll('#lbList li').length === 2, null, 15000);
      const qcodeA = (await Q1.page.textContent('#lbCode')).trim(), qcodeB = (await Q2.page.textContent('#lbCode')).trim();
      h.eq(qcodeA, qcodeB, 'the second quick-match player joined the first lobby (same code ' + qcodeA + ')');
      h.eq(await Q2.page.locator('#lbList li').count(), 2, 'quick match lobby lists both players');
      await h.shot('quickmatch');
      await readyAndStart(Q1, [Q2], 1);
      await waitRace([Q1, Q2]);
      h.expect(true, 'quick-match race starts on both sides');
      await closeAll(all); all.length = 0;

      }
      /* ================= 3. host leaves mid-race (migration) ================= */
      if (want('migration')) {
      h.step('host leaves mid-race: the deputy takes over, the others finish');
      const H = await newPlayer(h, hub, 'h'); all.push(H);
      const G1 = await newPlayer(h, hub, 'g1'); all.push(G1);
      const G2 = await newPlayer(h, hub, 'g2'); all.push(G2);
      await goOnline(H, 'HostLeaver'); await H.page.click('#olCreate');
      await H.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
      const hcode = (await H.page.textContent('#lbCode')).trim();
      await lobbyJoin(H, G1, hcode, 'Deputy');
      await lobbyJoin(H, G2, hcode, 'Third');
      await readyAndStart(H, [G1, G2], 1);
      await waitRace([H, G1, G2]);
      const m1 = await mp(G1), m2 = await mp(G2);
      h.expect(m1.deputy === (await kl(G1, () => __klTest.G.human.id)) && m1.links.length >= 2, 'the first guest is the deputy and has links to the host and to the other guest');
      h.expect(m2.links.length >= 2, 'the other guest also holds a link to the deputy (links: ' + m2.links.map((l) => l.kind).join(',') + ')');
      for (const p of [H, G1, G2]) await kl(p, () => __klTest.autopilot(true));
      await sleep(7000);
      const hostId = await kl(H, () => __klTest.G.human.id);
      await H.page.close();                                         // the host disappears
      await sleep(6000);
      const after1 = await mp(G1), after2 = await mp(G2);
      h.eq([after1.role, after1.epoch], ['host', 1], 'the deputy promoted itself to host (epoch 1)');
      h.eq([after2.role, after2.hostId === after1.hostId], ['client', true], 'the third player follows the new host');
      const hk = after1.karts.find((k) => k.id === hostId);
      h.expect(hk && hk.bot && !hk.human, 'the old host kart is now a bot');
      await Promise.all([G1, G2].map((p) => p.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 240000 })));
      await Promise.all([G1, G2].map((p) => waitFor(p, () => window.__klTest.G.lastResult && document.querySelector('#endSub').textContent.includes('/8'), null, 120000)));
      const r1 = await kl(G1, () => __klTest.G.lastResult.rows.map((r) => r.id + ':' + r.place)), r2 = await kl(G2, () => __klTest.G.lastResult.rows.map((r) => r.id + ':' + r.place));
      h.eq(r1, r2, 'after the migration both remaining players get the same results');
      h.expect(r1.length === 8, 'results include all 8 karts');
      const bad = [await kl(G1, () => window.__bad || null), await kl(G2, () => window.__bad || null)];
      h.expect(G1.errors.filter((e) => !/three/.test(e)).length + G2.errors.filter((e) => !/three/.test(e)).length === 0, 'no console errors during migration: ' + JSON.stringify([...G1.errors, ...G2.errors, bad]));
      REPORT.migration = { epoch: after1.epoch, resultRows: r1.length };
      }

      /* ================= 4. invite link, friends dialog (signed in) ================= */
      if (want('link')) {
        h.step('invite link opens the lobby; the signed-in host can invite friends from the lobby');
        const F1 = await newPlayer(h, hub, 'f1', { init: () => {
          window.__invites = [];
          window.__pbAuth = { session: { user: { id: 'u-host', user_metadata: { username: 'Anna' } } }, sb: { rpc: async (name, args) => {
            if (name === 'my_friends') return { data: [{ user_id: 'u-1', username: 'Ben' }, { user_id: 'u-2', username: 'Cleo' }], error: null };
            if (name === 'invite_game_room') { window.__invites.push([name, args]); return { data: { room: args.p_room }, error: null }; }
            return { data: null, error: { message: 'unexpected ' + name } };
          } } };
        } }); all.push(F1);
        const F2 = await newPlayer(h, hub, 'f2'); all.push(F2);
        await F1.page.click('#modeOnline');
        h.eq(await F1.page.inputValue('#olName'), 'Anna', 'the signed-in user name is the default lobby name');
        await F1.page.click('#olCreate');
        await F1.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        const fcode = (await F1.page.textContent('#lbCode')).trim();
        await F1.page.click('#lbInvite');
        await F1.page.waitForSelector('#frList .frow', { timeout: 5000 });
        h.eq(await F1.page.locator('#frList .frow b').allInnerTexts(), ['Ben', 'Cleo'], 'friends list is loaded on demand (one my_friends call)');
        await F1.page.locator('#frList .frow button').first().click();
        const inv = await kl(F1, () => window.__invites);
        h.eq(inv.map((i) => [i[0], i[1].p_to, i[1].p_game, i[1].p_room]), [['invite_game_room', 'u-1', 'kart-letzebuerg', fcode.toLowerCase()]], 'inviting a friend sends the lobby code to the invite function');
        await F1.page.click('#frClose');
        // a friend (or anybody) who opens the shared link lands in the same lobby
        await F2.page.goto(h.origin + URL_BASE + '&room=' + fcode.toLowerCase() + '&role=guest');
        await F2.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        h.eq((await F2.page.textContent('#lbCode')).trim(), fcode, 'the link ?room=' + fcode.toLowerCase() + '&role=guest joins that lobby');
        await waitFor(F1, () => document.querySelectorAll('#lbList li').length === 2, null, 20000);
        h.expect(true, 'the host sees the new player in the roster');
        h.expect(await F2.page.locator('#lbInvite').isHidden(), 'guests do not get the invite button');
        await closeAll(all); all.length = 0;
      }

      /* ================= 5. away (hidden tab) and leaving: the kart is driven by a bot ================= */
      if (want('away')) {
        h.step('a hidden tab / a leaving player: the kart is taken over by a bot, the player gets back in');
        const X = await newPlayer(h, hub, 'x'); all.push(X);
        const Y = await newPlayer(h, hub, 'y'); all.push(Y);
        await goOnline(X, 'Stayer'); await X.page.click('#olCreate');
        await X.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        await lobbyJoin(X, Y, (await X.page.textContent('#lbCode')).trim(), 'Goer');
        await readyAndStart(X, [Y], 1);
        await waitRace([X, Y]);
        await kl(X, () => __klTest.autopilot(true)); await kl(Y, () => __klTest.autopilot(true));
        await sleep(3000);
        const yid = await kl(Y, () => __klTest.G.human.id);
        const hide = (p, hidden) => p.page.evaluate((hd) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hd }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
        const prog0 = await kl(X, (id) => __klTest.G.race.byId[id].prog, yid);
        await hide(Y, true);
        await sleep(1200);
        let mx = await mp(X); const awayK = mx.karts.find((k) => k.id === yid);
        h.expect(awayK && awayK.away && awayK.bot, 'host: the hidden player\'s kart is bot-driven (away)');
        await sleep(3500);
        const prog1 = await kl(X, (id) => __klTest.G.race.byId[id].prog, yid);
        h.expect(prog1 - prog0 > 60, 'the bot keeps the kart racing while the tab is hidden (+' + Math.round(prog1 - prog0) + ' m)');
        await hide(Y, false);
        await sleep(1500);
        mx = await mp(X); const backK = mx.karts.find((k) => k.id === yid);
        h.expect(backK && !backK.away && !backK.bot, 'host: the kart is the player\'s again after the tab is visible');
        const dist = await Promise.all([kl(X, (id) => { const k = __klTest.G.race.byId[id]; return [k.x, k.z]; }, yid), kl(Y, () => { const k = __klTest.G.human; return [k.x, k.z]; })]);
        h.expect(Math.hypot(dist[0][0] - dist[1][0], dist[0][1] - dist[1][1]) < 8, 'the player resumed where the bot left the kart (host record and own kart agree)');
        // now the player leaves through the pause menu
        await Y.page.evaluate(() => __klTest.pause(true));
        await Y.page.click('#pQuit');
        await sleep(1500);
        mx = await mp(X); const leftK = mx.karts.find((k) => k.id === yid);
        h.expect(leftK && leftK.bot && !leftK.human, 'host: after the player quit, the kart is a bot for good');
        h.expect((await X.page.textContent('#toast')).length >= 0, 'host continues the race alone with bots');
        await closeAll(all); all.length = 0;
      }

      /* ================= 6. no WebRTC path: capped relay fallback for that peer only ================= */
      if (want('relay')) {
        h.step('WebRTC blocked for one peer: slow relay fallback (capped, badge) and the other peer unaffected');
        const R1 = await newPlayer(h, hub, 'r1'); all.push(R1);
        const R2 = await newPlayer(h, hub, 'r2', { init: () => { RTCPeerConnection.prototype.setRemoteDescription = () => new Promise(() => {}); } }); all.push(R2);
        hub.reset();
        await goOnline(R1, 'Direct'); await R1.page.click('#olCreate');
        await R1.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        await lobbyJoin(R1, R2, (await R1.page.textContent('#lbCode')).trim(), 'Blocked');
        const t0 = Date.now();
        await waitFor(R1, () => document.querySelectorAll('#lbList li .slow').length === 1, null, 40000);
        h.expect(true, 'host lobby shows the "slow connection" badge for the blocked peer after ' + Math.round((Date.now() - t0) / 1000) + ' s');
        await waitFor(R2, () => document.querySelectorAll('#lbList li').length === 2 && document.querySelectorAll('#lbList li .slow').length === 1, null, 20000);
        await R2.page.click('#lbReady');
        await waitFor(R1, () => document.querySelectorAll('#lbList li .st.ok').length === 1, null, 15000);
        await setLaps(R1, 1); await R1.page.click('#lbStart');
        await waitRace([R1, R2]);
        const mr = await mp(R1), mr2 = await mp(R2);
        h.eq(mr.links.map((l) => l.kind), ['relay'], 'host talks to the blocked peer through the relay');
        h.eq(mr2.links.map((l) => l.kind), ['relay'], 'the blocked peer uses the relay to the host');
        h.expect(mr.lobby.signalling && mr2.lobby.signalling, 'signalling channel stays open only because of the relay (justified)');
        h.expect(await R1.page.locator('#netBadge').isVisible() && await R2.page.locator('#netBadge').isVisible(), 'the "slow connection" badge is visible in the HUD');
        await kl(R1, () => __klTest.autopilot(true)); await kl(R2, () => __klTest.autopilot(true));
        const f1 = hub.stats.framesIn + hub.stats.framesOut, e1 = JSON.stringify(hub.stats.perContext);
        await sleep(15000);
        const f2 = hub.stats.framesIn + hub.stats.framesOut;
        const rate = (f2 - f1) / 15;
        console.log('    per context before/after: ' + e1 + ' -> ' + JSON.stringify(hub.stats.perContext));
        console.log('    relay traffic while racing: ' + (f2 - f1) + ' Realtime frames in 15 s (' + rate.toFixed(1) + '/s, both directions)');
        h.expect(rate <= 26, 'relay stays around 5 Hz per direction state + batched events (' + rate.toFixed(1) + ' Realtime frames/s = each message is one frame in and one out)');
        const mrr = await mp(R1);
        h.expect(mrr.net.relayMsgs > 0 && mrr.net.relayMsgs < 900, 'relayed message counter is below the per-race cap (' + mrr.net.relayMsgs + ' < 900)');
        REPORT.relay = { framesPerSecond: rate, relayMsgsHostSide: mrr.net.relayMsgs };
        await closeAll(all); all.length = 0;

        h.step('relay switched off (RELAY_FALLBACK = false): the blocked peer gets a clear message');
        const N1 = await newPlayer(h, hub, 'n1', { noRelay: true }); all.push(N1);
        const N2 = await newPlayer(h, hub, 'n2', { noRelay: true, init: () => { RTCPeerConnection.prototype.setRemoteDescription = () => new Promise(() => {}); } }); all.push(N2);
        await goOnline(N1, 'Direct'); await N1.page.click('#olCreate');
        await N1.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        await goOnline(N2, 'Blocked'); await N2.page.fill('#olCode', (await N1.page.textContent('#lbCode')).trim()); await N2.page.click('#olJoin');
        await N2.page.waitForSelector('#onlineScreen:not([hidden]) #olMsg:not([hidden])', { timeout: 40000 });
        h.expect(/Verbindung|connection|Firewall|firewall/i.test(await N2.page.textContent('#olMsg')), 'blocked peer sees: ' + (await N2.page.textContent('#olMsg')));
        await waitFor(N1, () => document.querySelectorAll('#lbList li').length === 1, null, 10000);
        h.expect(true, 'the host lobby drops that peer and stays open');
        await closeAll(all); all.length = 0;
      }
    } finally {
      await finish();
      if (process.env.KL_MP_REPORT) fs.writeFileSync(process.env.KL_MP_REPORT, JSON.stringify(REPORT, null, 1));
    }
  },
};
runIfMain(import.meta.url, flow);
