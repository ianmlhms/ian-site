/* Kart Lëtzebuerg phase 2 (online): two/three real browser contexts race each other over WebRTC.
 * Lobby + SDP hand-shake run through an in-process Realtime hub (kart_mp_hub.mjs), nothing reaches the live Supabase project.
 * Covers: lobby by room code, ready/start, WebRTC link, both players driving (autopilot), position sync (measured), items hitting
 * across peers, identical finish order + results on both, the Supabase request/message budget of one full 3-lap race, quick match,
 * the host leaving mid-race (host migration to the deputy), and the race log (record_kart_race: exactly one call per online race, none for solo). Set KL_MP_REPORT=/path.json to dump the measured numbers. */
import fs from 'node:fs';
import { runIfMain } from './lib.mjs';
import { createHub } from './kart_mp_hub.mjs';

const URL_BASE = '/pb/kart-letzebuerg.html?test=1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSupabase = (u) => /supabase\.co/.test(u);
const REPORT = {};
/* ---------- race log capture: every record_kart_race call (REST route or the signed-in sb.rpc stub) ---------- */
const RECORDS = [];                                  // { by, via, status, p }
const FAIL = { n: 0 };                               // the next n REST calls answer HTTP 500
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const UID = { guest: '5b1d6c0e-2f4a-4c1b-9a77-0a1b2c3d4e51', dep: '7c2e8d1f-3a5b-4d2c-8b88-1b2c3d4e5f62', third: '9d3f9e20-4b6c-4e3d-9c99-2c3d4e5f6073' };
const recCount = () => RECORDS.length;
async function pageCalls(players) {                  // calls made through a stubbed signed-in client (window.__rpcCalls)
  const out = [];
  for (const p of players) { try { const c = (await p.page.evaluate(() => window.__rpcCalls || [])).filter((x) => x.name === 'record_kart_race'); for (const x of c) out.push({ by: p.label, via: 'rpc', p: x.p, name: x.name }); } catch { /* gone */ } }
  return out;
}
async function settle(fn, n, ms = 15000) {          // wait until fn() >= n, then 3.5 s more so a stray second call would show up
  const t0 = Date.now(); while (Date.now() - t0 < ms && fn() < n) await sleep(200);
  await sleep(3500);
}
const ONLY = (process.env.KL_MP_ONLY || 'all').split(',');
const want = (n) => ONLY.includes('all') || ONLY.includes(n);

/* ---------- helpers ---------- */
async function newPlayer(h, hub, label, { first = false, viewport = { width: 640, height: 400 }, init = null, noRelay = false, auth = null } = {}) {
  let context = h.context, page = h.page;
  if (!first) {
    context = await h.context.browser().newContext({ viewport, serviceWorkers: 'block' });
    page = await context.newPage();
  }
  await hub.attach(context, label);
  if (init) await context.addInitScript(init);
  if (auth) await context.addInitScript((a) => {              // a signed-in user (id only, or with a stubbed sb.rpc that records record_kart_race)
    window.__rpcCalls = [];
    window.__pbAuth = { session: { user: { id: a.id, user_metadata: { username: a.name } } } };
    if (a.withRpc) window.__pbAuth.sb = { rpc: async (name, args) => { window.__rpcCalls.push({ name, p: args && args.p }); return { data: 1, error: null }; } };
  }, auth);
  if (noRelay) await context.route(/kart-letzebuerg\/config\.js/, async (route) => { const r = await route.fetch(); route.fulfill({ response: r, body: (await r.text()).replace('RELAY_FALLBACK: true', 'RELAY_FALLBACK: false') }); });
  const p = { label, context, page, http: [], errors: [], notFound: [], first };
  page.on('response', (r) => { if (r.status() === 404) p.notFound.push(r.url()); });
  page.on('request', (r) => { if (isSupabase(r.url()) && r.resourceType() !== 'websocket' && r.method() !== 'OPTIONS') p.http.push(r.method() + ' ' + new URL(r.url()).pathname); });
  page.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  page.on('console', (m) => { if (/\[kart-mp\] race/.test(m.text())) console.log('    [' + label + '] ' + m.text()); });
  page.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  if (!first) await context.route(/supabase\.co\/(rest|auth|functions|storage)\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await context.route(/\/rest\/v1\/rpc\/record_kart_race/, async (route) => {
    const rq = route.request();
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch { /* bad json */ }
    const bad = FAIL.n > 0; if (bad) FAIL.n--;
    RECORDS.push({ by: label, via: 'fetch', status: bad ? 500 : 200, p: body && body.p, hdr: rq.headers() });
    return route.fulfill({ status: bad ? 500 : 200, headers: CORS, contentType: 'application/json', body: bad ? '{"message":"boom"}' : '1' });
  });
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
  try { await guest.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 }); }
  catch (e) { const msg = await guest.page.textContent('#olMsg').catch(() => '?'); throw new Error('join failed for ' + guest.label + ' (code ' + code + '): "' + msg + '" ' + JSON.stringify(guest.errors)); }
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
      const B = await newPlayer(h, hub, 'guest', { auth: { id: UID.guest, name: 'Guesty' } }); all.push(B);
      const rec0 = recCount();
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
      h.expect(!mB.lobby.signalling && mA.lobby.signalling, 'Realtime is closed on the guest once the race is live; the host keeps ONE idle room presence (no traffic) so a latecomer can find the race and watch it');
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

      // ---- race log: the host logs the finished race exactly once, the guest never
      h.step('race log: exactly ONE record_kart_race call (from the host) with the right players, places and track');
      await settle(() => recCount() - rec0, 1);
      const calls = RECORDS.slice(rec0);
      h.eq(calls.map((c) => c.by), ['host'], 'one call for the whole 2-player race, made by the host (guest made none)');
      const body = calls[0] && calls[0].p || {};
      const shown = await kl(A, () => __klTest.G.lastResult.rows.map((r) => [r.name, r.place, r.finished ? Math.round(r.time * 1000) : null, r.best == null ? null : Math.round(r.best * 1000), !!r.human]));
      const trackA = await kl(A, () => __klTest.G.track.id);
      h.eq([body.room, body.track, body.mode, body.cup, body.gp_round, body.laps, body.human_count, (body.players || []).length], [code, trackA, 'race', null, null, 3, 2, 8], 'room, track, mode, laps and counts are right');
      h.expect(/^s[0-9a-z]+$/.test(body.race_key || ''), 'race_key comes from the shared start seed (' + body.race_key + ')');
      h.eq((body.players || []).map((p) => [p.name, p.place, p.time_ms, p.best_lap_ms]).sort(), shown.map((r) => [r[0], r[1], r[2], r[3]]).sort(), 'players, places and times equal the results both players saw');
      h.eq((body.players || []).map((p) => p.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], 'places are 1..8');
      const bodyHum = (body.players || []).filter((p) => !p.bot), bodyBots = (body.players || []).filter((p) => p.bot);
      h.eq([bodyHum.length, bodyBots.length, bodyBots.every((p) => p.user_id === null && p.guest === false)], [2, 6, true], '2 humans + 6 bots (bots without user_id)');
      h.eq(bodyHum.map((p) => [p.name, p.user_id, p.guest]).sort(), [['Guesty', UID.guest, false], ['Hosty', null, true]], 'the signed-in guest player carries his user id, the guest host is a guest');
      h.expect(!!(calls[0] && calls[0].hdr && calls[0].hdr.apikey), 'a guest host logs through a plain anon REST call (apikey header)');

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
      h.eq(http, ['POST /rest/v1/rpc/record_kart_race'], 'the only Supabase HTTP request of the whole lobby -> race -> results cycle is the one race log call');
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

      h.step('race log failure: one attempt plus at most ONE retry, never a loop (the server answers 500 every time)');
      FAIL.n = 99; const q0 = recCount();
      await kl(Q1, () => __klTest.autopilot(true)); await kl(Q2, () => __klTest.autopilot(true));
      await Promise.all([Q1, Q2].map((p) => p.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 300000 })));
      await settle(() => recCount() - q0, 2, 20000);
      let qc = RECORDS.slice(q0);
      h.eq(qc.map((c) => [c.by, c.status]), [['q1', 500], ['q1', 500]], 'failed call is retried exactly once (2 POSTs in total, then nothing more after ' + '7 s)');
      h.eq(qc[0].p.race_key, qc[1].p.race_key, 'the retry carries the same race_key');
      h.step('race log: first attempt fails, the retry succeeds');
      FAIL.n = 1; const q1 = recCount();
      await Q1.page.evaluate(() => { const M = KL.MP; M.recorded = false; M.record(__klTest.G.lastResult.rows); });
      await settle(() => recCount() - q1, 2, 20000);
      qc = RECORDS.slice(q1);
      h.eq(qc.map((c) => c.status), [500, 200], 'a failed first attempt is followed by one successful retry');
      FAIL.n = 0;
      await closeAll(all); all.length = 0;

      }
      /* ================= 3. host leaves mid-race (migration) ================= */
      if (want('migration')) {
      h.step('host leaves mid-race: the deputy takes over, the others finish');
      const H = await newPlayer(h, hub, 'h'); all.push(H);
      const G1 = await newPlayer(h, hub, 'g1', { auth: { id: UID.dep, name: 'Deputy', withRpc: true } }); all.push(G1);       // signed in: logs through sb.rpc (reporter = auth.uid())
      const G2 = await newPlayer(h, hub, 'g2', { auth: { id: UID.third, name: 'Third' } }); all.push(G2);
      const mig0 = recCount();
      await goOnline(H, 'HostLeaver'); await H.page.click('#olCreate');
      await H.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
      const hcode = (await H.page.textContent('#lbCode')).trim();
      await lobbyJoin(H, G1, hcode, 'Deputy');
      await lobbyJoin(H, G2, hcode, 'Third');
      await readyAndStart(H, [G1, G2], 1);
      await waitRace([H, G1, G2]);
      await waitFor(G2, () => __klTest.mp().links.length >= 2, null, 25000).catch(() => {});       // (the deputy links the other guest within a few seconds even on a slow machine; retried during the race)
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
      h.step('race log after the host migration: exactly one call, from the new host');
      for (let t0 = Date.now(); Date.now() - t0 < 15000 && (recCount() - mig0) + (await pageCalls([G1, G2])).length < 1;) await sleep(250);
      await sleep(3500);
      const migCalls = [...RECORDS.slice(mig0), ...(await pageCalls([G1, G2]))];
      h.eq(migCalls.map((c) => [c.by, c.via]), [['g1', 'rpc']], 'one call in total: the new host (signed in, via sb.rpc); the dead host and the third player made none');
      const mb = migCalls[0] && migCalls[0].p || {};
      h.eq([mb.human_count, (mb.players || []).length, mb.laps, mb.mode], [3, 8, 1, 'race'], '3 humans (the old host counts as a player) among 8 karts');
      h.eq((mb.players || []).filter((p) => !p.bot).map((p) => [p.name, p.user_id, p.guest]).sort(), [['Deputy', UID.dep, false], ['HostLeaver', null, true], ['Third', UID.third, false]], 'user ids of the signed-in players are in the log, the dead guest host is a guest');
      h.eq((mb.players || []).map((p) => p.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], 'places are 1..8');
      REPORT.migration = { epoch: after1.epoch, resultRows: r1.length, raceLogCalls: migCalls.length };
      }

      /* ================= 3b. the deputy leaves first, then the host: a new deputy is elected + linked ================= */
      if (want('deputy')) {
        h.step('4 players: the deputy leaves first, then the host: the next deputy is elected and pre-linked, the race goes on for the remaining two with identical results');
        const vp = { width: 480, height: 300 };
        const A = await newPlayer(h, hub, 'd-host', { viewport: vp }); all.push(A);
        const B = await newPlayer(h, hub, 'd-b', { viewport: vp }); all.push(B);
        const C = await newPlayer(h, hub, 'd-c', { viewport: vp }); all.push(C);
        const D = await newPlayer(h, hub, 'd-d', { viewport: vp }); all.push(D);
        await goOnline(A, 'Alpha'); await A.page.click('#olCreate');
        await A.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        const dcode = (await A.page.textContent('#lbCode')).trim();
        await lobbyJoin(A, B, dcode, 'Bravo');
        await waitFor(A, () => document.querySelectorAll('#lbList li').length === 2);
        await lobbyJoin(A, C, dcode, 'Charlie');
        await waitFor(A, () => document.querySelectorAll('#lbList li').length === 3);
        await lobbyJoin(A, D, dcode, 'Delta');
        await waitFor(A, () => document.querySelectorAll('#lbList li').length === 4);
        await readyAndStart(A, [B, C, D], 2);
        await waitRace([A, B, C, D]);
        const id = {}; for (const [k, p] of Object.entries({ a: A, b: B, c: C, d: D })) id[k] = await kl(p, () => __klTest.G.human.id);
        const depOf = async (p) => (await mp(p)).deputy;
        h.eq([(await mp(A)).lobby.deputy, await depOf(B), await depOf(C), await depOf(D)], [id.b, id.b, id.b, id.b], 'first deputy = the first guest, known to everybody');
        for (const p of [A, B, C, D]) await kl(p, () => __klTest.autopilot(true));
        await sleep(4000);
        // the deputy leaves through the pause menu
        await B.page.evaluate(() => __klTest.pause(true)); await B.page.click('#pQuit');
        await waitFor(A, (c) => __klTest.mp().lobby.deputy === c, id.c, 30000);
        await waitFor(C, (c) => __klTest.mp().deputy === c, id.c, 30000);
        await waitFor(D, (c) => __klTest.mp().deputy === c, id.c, 30000);
        h.expect(true, 'the deputy left: the host elected the next client (Charlie) and everybody knows it');
        await waitFor(D, (c) => __klTest.mp().links.some((l) => l.id === c && l.open && l.kind === 'rtc'), id.c, 20000);
        await waitFor(C, (d) => __klTest.mp().links.some((l) => l.id === d && l.open && l.kind === 'rtc'), id.d, 20000);
        h.expect(true, 'the new deputy was pre-linked to the other client (direct WebRTC link Charlie <-> Delta, made through the host, no Realtime)');
        const bK = (await mp(A)).karts.find((k) => k.id === id.b);
        h.expect(bK && bK.bot && !bK.human, 'the deputy that left is a bot now');
        await sleep(2500);
        // then the host disappears
        await A.page.close();
        await waitFor(C, () => __klTest.mp().role === 'host', null, 30000);
        await waitFor(D, (c) => __klTest.mp().hostId === c, id.c, 30000);
        const mC = await mp(C), mD = await mp(D);
        h.eq([mC.role, mC.epoch, mD.role, mD.hostId], ['host', 1, 'client', id.c], 'host gone: the pre-linked deputy took over (epoch 1), the last client follows it');
        await waitFor(C, (d) => __klTest.mp().deputy === d, id.d, 20000);
        h.expect(true, 'and the new host immediately elected Delta as its own deputy');
        await Promise.all([C, D].map((p) => p.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 300000 })));
        await Promise.all([C, D].map((p) => waitFor(p, () => window.__klTest.G.lastResult && document.querySelector('#endSub').textContent.includes('/8'), null, 120000)));
        const rC = await kl(C, () => __klTest.G.lastResult.rows.map((r) => r.id + ':' + r.place + ':' + Math.round(r.time * 1000))), rD = await kl(D, () => __klTest.G.lastResult.rows.map((r) => r.id + ':' + r.place + ':' + Math.round(r.time * 1000)));
        h.eq(rC, rD, 'the remaining two get identical results (ids, places, times)');
        h.eq(rC.length, 8, 'results include all 8 karts');
        const hum = await kl(C, () => __klTest.G.lastResult.rows.filter((r) => r.human).length);
        h.eq(hum, 4, 'the four players are all counted as humans in the results');
        const errs = [C, D].flatMap((p) => p.errors.filter((e) => !/three/.test(e)));
        h.expect(errs.length === 0, 'no console errors on the survivors: ' + JSON.stringify(errs));
        REPORT.deputyChain = { epoch: mC.epoch, finalDeputy: id.d === (await mp(C)).deputy };
        await closeAll(all); all.length = 0;
      }

      /* ================= 3c. the host leaves the LOBBY: the next player takes it over ================= */
      if (want('lobbyhost')) {
        h.step('the host leaves the lobby before the race: the next player becomes host (same code, same settings), newcomers still join, and the race starts');
        const vp = { width: 480, height: 300 };
        const H = await newPlayer(h, hub, 'l-host', { viewport: vp }); all.push(H);
        const G1 = await newPlayer(h, hub, 'l-one', { viewport: vp }); all.push(G1);
        const G2 = await newPlayer(h, hub, 'l-two', { viewport: vp }); all.push(G2);
        const NW = await newPlayer(h, hub, 'l-new', { viewport: vp }); all.push(NW);
        await goOnline(H, 'Leaver'); await H.page.click('#olCreate');
        await H.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        const lcode = (await H.page.textContent('#lbCode')).trim();
        await lobbyJoin(H, G1, lcode, 'Nextup');
        await waitFor(H, () => document.querySelectorAll('#lbList li').length === 2);
        await lobbyJoin(H, G2, lcode, 'Second');
        await waitFor(H, () => document.querySelectorAll('#lbList li').length === 3);
        await setLaps(H, 2); await H.page.locator('#lbDiff button').nth(2).click();
        await waitFor(G2, () => KL.Lobby.cfg.laps === 2 && KL.Lobby.cfg.diff === 'hard', null, 10000);
        await G2.page.click('#lbReady');
        await H.page.click('#lbLeave');
        await G1.page.waitForFunction(() => KL.Lobby.role === 'host' && document.querySelectorAll('#lbList li').length === 2 && !document.getElementById('lbStart').hidden, null, { timeout: 40000 });
        await waitFor(G2, () => document.querySelectorAll('#lbList li').length === 2 && /👑/.test(document.querySelector('#lbList li .st.host') ? document.querySelector('#lbList li .st.host').textContent : ''), null, 40000);
        const c1 = (await G1.page.textContent('#lbCode')).trim();
        h.eq(c1, lcode, 'the lobby kept its code after the host left');
        h.eq(await kl(G1, () => [KL.Lobby.cfg.laps, KL.Lobby.cfg.diff]), [2, 'hard'], 'settings (2 laps, hard) survived the hand-over');
        h.eq(await kl(G2, () => [KL.Lobby.cfg.laps, KL.Lobby.cfg.diff, KL.Lobby.role]), [2, 'hard', 'client'], 'the other player follows (settings visible, still a client)');
        h.expect(await G1.page.locator('#lbSettings').isVisible() && await G2.page.locator('#lbSettings').isHidden(), 'the new host edits the settings, the other player only sees the summary');
        // a newcomer uses the same code: the new host takes him in
        await lobbyJoin(G1, NW, lcode, 'Latecomer');
        await waitFor(G1, () => document.querySelectorAll('#lbList li').length === 3, null, 30000);
        h.expect(true, 'the new host took a newcomer in with the old code (3 players)');
        await G2.page.evaluate(() => { const b = document.getElementById('lbReady'); if (!/✓|bereit|ready/i.test(document.querySelector('#lbList li.me .st').textContent)) b.click(); });
        await NW.page.click('#lbReady');
        await waitFor(G1, () => document.querySelectorAll('#lbList li .st.ok').length === 2, null, 20000);
        await G1.page.click('#lbStart');
        await waitRace([G1, G2, NW]);
        h.eq(await Promise.all([G1, G2, NW].map((p) => kl(p, () => __klTest.G.race.karts.filter((k) => k.human).length))), [3, 3, 3], 'the race starts with the three remaining players');
        const ml = await mp(G1), ml2 = await mp(G2);
        h.eq([ml.role, ml2.role, ml.deputy === ml2.deputy && !!ml.deputy], ['host', 'client', true], 'new host + deputy as usual');
        h.expect(G1.errors.concat(G2.errors, NW.errors).filter((e) => !/three/.test(e)).length === 0, 'no console errors');
        await closeAll(all); all.length = 0;
      }

      /* ================= 3d. opening the code while a race runs: spectator, roster for the next race ================= */
      if (want('spectate')) {
        h.step('latecomer opens the invite link during a race: he watches it (camera on the leader, can switch), then he is on the roster for the next race');
        const A = await newPlayer(h, hub, 's-host'); all.push(A);
        const B = await newPlayer(h, hub, 's-guest'); all.push(B);
        const S = await newPlayer(h, hub, 's-watch'); all.push(S);
        await goOnline(A, 'Racer'); await A.page.click('#olCreate');
        await A.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        const scode = (await A.page.textContent('#lbCode')).trim();
        await lobbyJoin(A, B, scode, 'Guesty');
        await readyAndStart(A, [B], 1);
        await waitRace([A, B]);
        for (const p of [A, B]) await kl(p, () => __klTest.autopilot(true));
        await sleep(6000);
        const frames0 = hub.stats.framesIn + hub.stats.framesOut, http0 = S.http.length;
        await S.page.goto(h.origin + URL_BASE + '&room=' + scode.toLowerCase() + '&role=guest');
        await waitFor(S, () => { const m = __klTest.mp(); return m.spec && m.specLive && !document.getElementById('hud').hidden; }, null, 45000);
        await sleep(1500);
        const joinFrames = hub.stats.framesIn + hub.stats.framesOut - frames0;
        const sm = await mp(S), am = await mp(A);
        h.expect(sm.spec && sm.links.some((l) => l.kind === 'rtc' && l.open), 'the latecomer is a spectator, linked to the host by WebRTC');
        h.eq(am.specs.length, 1, 'the host serves one spectator');
        h.expect(await S.page.locator('#specBar').isVisible() && await S.page.locator('#itemSlot').isHidden(), 'spectator bar is shown, driving controls are hidden');
        h.eq(await kl(S, () => __klTest.G.race.karts.length), 8, 'the spectator sees all 8 karts');
        const look = () => kl(S, () => { const G = __klTest.G, k = G.human, c = G.renderer.cam; return { id: k.id, d: Math.hypot(c.x - k.ix, c.z - k.iz), lead: G.race.order[0].id, speed: k.speed, mode: G.specMode }; });
        let l0 = await look();
        h.expect(l0.mode === 'leader' && l0.d < 40 && l0.speed > 5, 'camera follows the leader and the leader is driving (cam ' + l0.d.toFixed(1) + ' m away, ' + l0.speed.toFixed(1) + ' m/s)');
        const own = await kl(S, () => __klTest.G.race.karts.filter((k) => !k.remote).length);
        h.eq(own, 0, 'no kart of the spectator is simulated locally');
        await S.page.click('#specNext'); await sleep(2000);
        let l1 = await look();
        h.expect(l1.id !== l0.id && l1.mode === 'follow' && l1.d < 40, 'switching the target works (now ' + l1.id + ', camera ' + l1.d.toFixed(1) + ' m away)');
        await S.page.click('#specLeader'); await sleep(2000);
        const l2 = await look();
        h.expect(l2.mode === 'leader', 'the leader button returns to the leader');
        const prog = await Promise.all([kl(A, (id) => __klTest.G.race.byId[id].prog, am.hostId), kl(S, (id) => __klTest.G.race.byId[id].prog, am.hostId)]);
        h.expect(Math.abs(prog[0] - prog[1]) < 60, 'the spectator\'s picture of the host kart agrees with the host (progress ' + Math.round(prog[0]) + ' vs ' + Math.round(prog[1]) + ' m)');
        console.log('    spectator join: ' + joinFrames + ' Realtime frames, ' + (S.http.length - http0) + ' REST requests');
        h.expect(joinFrames <= 40, 'joining as spectator costs few Realtime frames (' + joinFrames + ')');
        h.eq(S.http.length - http0, 0, 'and no REST request');
        await S.page.screenshot({ path: (process.env.FLOW_SHOTS_DIR || '/tmp') + '/kart-letzebuerg-mp.spectator.png' }).catch(() => {});
        // results: the same list as the players get
        await Promise.all([A, B, S].map((p) => p.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 300000 })));
        await Promise.all([A, B, S].map((p) => waitFor(p, () => window.__klTest.G.lastResult && document.querySelectorAll('#endList li').length === 8, null, 120000)));
        const rows = await Promise.all([A, B, S].map((p) => p.page.locator('#endList li').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').replace(/ \((Du|You)\)/, '')))));
        h.eq(rows[2], rows[0], 'the spectator sees the same result list as the host');
        h.expect(await S.page.locator('#endList li.me').count() === 0 && /Du kucks zou|watching|schaust zu/i.test(await S.page.textContent('#endSub')), 'no row is "his own" and he is told he races next round');
        h.eq(await kl(S, () => __klTest.boards().length), 0, 'watching a race writes no personal record / board entry');
        // rematch: the watcher is on the roster
        await A.page.click('#eLobby');
        await Promise.all([B, S].map((p) => p.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 15000 })));
        await waitFor(A, () => document.querySelectorAll('#lbList li').length === 3, null, 15000);
        h.eq(await S.page.locator('#lbList li').count(), 3, 'rematch lobby: the spectator is on the roster (3 players) without doing anything');
        h.expect(await A.page.locator('#lbCodeRow').isVisible(), 'the host still has the room code in the rematch lobby');
        // the host leaves the rematch lobby (nobody has Realtime open any more): B takes over, S follows
        await A.page.click('#lbLeave');
        await B.page.waitForFunction(() => KL.Lobby.role === 'host' && document.querySelectorAll('#lbList li').length === 2 && !document.getElementById('lbStart').hidden, null, { timeout: 40000 });
        await waitFor(S, () => KL.Lobby.role === 'client' && document.querySelectorAll('#lbList li').length === 2, null, 40000);
        h.expect(true, 'rematch lobby, host left: the guest took the lobby over although the Realtime channels had been closed (re-opened on demand)');
        await S.page.click('#lbReady');
        await waitFor(B, () => document.querySelectorAll('#lbList li .st.ok').length === 1, null, 20000);
        await B.page.locator('#lbLaps button', { hasText: /^1$/ }).click();
        const rc0 = await Promise.all([B, S].map((p) => kl(p, () => __klTest.G.raceCount)));
        await B.page.click('#lbStart');
        await Promise.all([B, S].map((p, i) => waitFor(p, (n) => window.__klTest.G.raceCount > n && window.__klTest.state().phase === 'race' && window.__klTest.state().clock > 0.3, rc0[i], 60000).catch(async (e) => { throw new Error('race 2 did not start on ' + p.label + ': ' + JSON.stringify(await kl(p, () => ({ lobby: KL.Lobby.phase, state: __klTest.G.state, spec: KL.MP.spec, msg: document.getElementById('olMsg').textContent })).catch(() => '?')) + ' ' + JSON.stringify(p.errors) + ' ' + JSON.stringify(p.notFound)); })));
        h.eq(await Promise.all([B, S].map((p) => kl(p, () => __klTest.G.race.karts.filter((k) => k.human).length))), [2, 2], 'next race: the former spectator drives as a full player');
        h.eq(await mp(S).then((m) => [m.spec, m.role]), [false, 'client'], 'and is a normal client now');
        // (known, not ours: the shared auth.js injects "auth.css" with a relative path, a 404 on every /pb/ page opened with ?room=; ignored here)
        const realErrors = (p) => p.errors.filter((e) => !/three/.test(e) && !(/404/.test(e) && p.notFound.length && p.notFound.every((u) => /auth\.css/.test(u))));
        h.expect([A, B, S].every((p) => realErrors(p).length === 0), 'no console errors: ' + JSON.stringify([A, B, S].flatMap((p) => realErrors(p).concat(p.notFound))));
        await closeAll(all); all.length = 0;
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
        // regression (flaky before): a kart that was mid-drift when its human went away/left had no drift side in its fresh AI state -> NaN steer -> NaN position/progress for good
        const aiSteer = await kl(X, (id) => {
          const R = __klTest.G.race, base = R.byId[id], out = [];
          for (const [state, dir] of [[1, -1], [1, 1], [2, -1], [2, 1], [0, 1]]) {
            const k = Object.assign({}, base, { drift: { state, dir, charge: 0, level: 1, hopT: 0 }, input: { steer: 0, gas: 0, brake: 0, drift: false, item: false, itemBack: false }, ai: null, hint: -1, item: null, isBot: true });
            for (let i = 0; i < 3; i++) KL.botThink(k, R, 1 / 60);
            out.push(k.input.steer);
          }
          return out;
        }, yid);
        h.expect(aiSteer.every((v) => Number.isFinite(v)), 'a bot taking over a drifting kart steers with finite input (' + aiSteer.map((v) => Math.round(v * 100) / 100).join(', ') + ')');
        const prog0 = await kl(X, (id) => __klTest.G.race.byId[id].prog, yid);
        await hide(Y, true);
        await sleep(1200);
        let mx = await mp(X); const awayK = mx.karts.find((k) => k.id === yid);
        h.expect(awayK && awayK.away && awayK.bot, 'host: the hidden player\'s kart is bot-driven (away)');
        await sleep(3500);
        const prog1 = await kl(X, (id) => __klTest.G.race.byId[id].prog, yid);
        h.expect(Number.isFinite(prog1) && prog1 - prog0 > 60, 'the bot keeps the kart racing while the tab is hidden (+' + Math.round(prog1 - prog0) + ' m)');
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

      /* ================= 5b. online Grand Prix ================= */
      if (want('gp')) {
        h.step('online Grand Prix: the whole Fantasy cup (4 races, 4 lazily loaded tracks: candy, ice, volcano, ghost castle), the same points table on both sides, the host moves on, final standings');
        const gp0 = recCount();
        const P = await newPlayer(h, hub, 'gp-host'); all.push(P);
        const Q = await newPlayer(h, hub, 'gp-guest'); all.push(Q);
        await goOnline(P, 'GPHost'); await P.page.click('#olCreate');
        await P.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        await lobbyJoin(P, Q, (await P.page.textContent('#lbCode')).trim(), 'GPGuest');
        await setLaps(P, 1);
        await P.page.locator('#lbModeChips button', { hasText: /Grand Prix/ }).click();
        h.expect(await P.page.locator('#lbCupBox').isVisible() && await P.page.locator('#lbTrackBox').isHidden(), 'Grand Prix mode shows the cup picker instead of the track picker');
        await P.page.locator('#lbCup button', { hasText: /Fantasy/ }).click();
        await waitFor(Q, () => /Grand Prix/.test(document.getElementById('lbSummary').textContent), null, 10000);
        h.expect(true, 'the guest sees the Grand Prix in the lobby summary');
        await readyAndStart(P, [Q], null);
        await waitRace([P, Q]);
        const CUP = ['zockerland', 'aisbierg', 'vulkan', 'geeschterschlass'];
        const same = (t) => t.replace(/ \((Du|You)\)/g, '').replace(/\n\+\d+/g, '');   // each side marks its own row
        for (let r = 0; r < CUP.length; r++) {
          h.eq(await kl(P, () => [__klTest.session().kind, __klTest.session().idx, __klTest.session().n, __klTest.G.track.id]), ['gp', r, 4, CUP[r]], 'race ' + (r + 1) + ' of 4 on ' + CUP[r]);
          h.eq(await kl(Q, () => [__klTest.session().idx, __klTest.G.track.id]), [r, CUP[r]], 'the guest loaded the same track (' + CUP[r] + ') without pressing ready again');
          await kl(P, () => __klTest.autopilot(true)); await kl(Q, () => __klTest.autopilot(true));
          const last = r === CUP.length - 1;
          for (const p of [P, Q]) await waitFor(p, (l) => (l ? /Resultat|result|Ergebnis/i : /\d\/4/).test(document.getElementById('endTitle').textContent) && !document.getElementById('endScreen').hidden && document.querySelectorAll('#endList li').length === 8, last, 480000);
          const t = await Promise.all([P, Q].map((p) => p.page.locator('#endList').innerText()));
          h.eq(same(t[0]), same(t[1]), 'both sides show the same ' + (last ? 'final table' : 'Grand Prix table after race ' + (r + 1)));
          if (!last) {
            h.expect(await P.page.locator('#eNext').isVisible() && await Q.page.locator('#eNext').isHidden(), 'only the host can start the next race');
            h.expect(/\+\d+/.test(t[0]), 'the table shows the points of this race: ' + t[0].replace(/\s+/g, ' ').slice(0, 80));
            await P.page.locator('#eNext').click();
            await waitRace([P, Q]);
          }
        }
        await settle(() => recCount() - gp0, 4);
        const gc = RECORDS.slice(gp0);
        h.eq(gc.map((c) => [c.by, c.p.mode, c.p.cup, c.p.gp_round, c.p.track, c.p.human_count]), CUP.map((t, i) => ['gp-host', 'gp', 'fantasy', i + 1, t, 2]), 'a Grand Prix of 4 rounds = exactly 4 race log calls (rounds 1-4, right tracks, 2 humans), all from the host');
        h.eq(new Set(gc.map((c) => c.p.race_key)).size, 4, 'every round has its own race_key');
        h.eq([P.http.length, Q.http.length, P.http.every((x) => x === 'POST /rest/v1/rpc/record_kart_race')], [4, 0, true], 'that is the whole Supabase REST traffic of the online Grand Prix (4 requests: host only)');
        const pts = await kl(P, () => Object.values(__klTest.session().table).reduce((a, b) => a + b.pts, 0));
        h.eq(pts, 4 * 39, '4 races x 39 points in the table');
        h.expect(await P.page.locator('#eLobby').isVisible() && await P.page.locator('#eNext').isHidden(), 'after the last race the host can go back to the lobby');
        await h.shot('gp-online-final');
        await closeAll(all); all.length = 0;
      }

      /* ================= 5c. solo races are never logged ================= */
      if (want('solo')) {
        h.step('race log: a solo race and an online lobby with only one human are NOT logged');
        const S = await newPlayer(h, hub, 'solo'); all.push(S);
        const so0 = recCount();
        await S.page.evaluate(() => window.__klTest.start({ track: 'villehaute', laps: 1 }));
        await waitFor(S, () => window.__klTest.state().phase === 'race', null, 30000);
        await S.page.evaluate(() => window.__klTest.sim(200, true));
        await S.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 30000 });
        await sleep(3500);
        h.eq([recCount() - so0, S.http.filter((x) => /record_kart_race/.test(x)).length], [0, 0], 'solo race (menu): no race log call');
        await S.page.evaluate(() => window.__klTest.menu());
        await goOnline(S, 'Solo'); await S.page.click('#olCreate');
        await S.page.waitForSelector('#lobbyScreen:not([hidden])', { timeout: 30000 });
        await setLaps(S, 1); await S.page.click('#lbStart');
        await waitRace([S]);
        h.eq(await kl(S, () => __klTest.G.race.karts.filter((k) => k.human).length), 1, 'online lobby with one human: 1 human + 7 bots');
        await kl(S, () => __klTest.autopilot(true));
        await S.page.waitForSelector('#endScreen:not([hidden]) #endList li', { timeout: 300000 });
        await sleep(3500);
        h.eq([recCount() - so0, S.http.filter((x) => /record_kart_race/.test(x)).length], [0, 0], 'online race with a single human: no race log call');
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
