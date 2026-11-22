/* Node test of the pre-launch security fixes (review of 22 Nov 2026, ~/Library/Caches/ski-work/security/REVIEW.md): the exploit payloads
 * are fed into the REAL modules (net/wire.js, remotes.js with real three.js, session.js + link.js on a fake Realtime / fake WebRTC,
 * freeride.js, race.js, modes/cloud.js, index.js readMpContext) and every step must be rejected or bounded, in bounded time.
 *   node scripts/ski/security-test.mjs
 * The test runs itself in a child process with a hard timeout: a frozen loop (the H1 heading of 1e300) is a FAIL, not a hung terminal.
 * three.js: the exact CDN file pb/ski.html loads, checked against the page's SRI hash (cached in ~/Library/Caches/ski-work/), or
 * SKI_THREE=/path/to/three.min.js. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const realFetch = globalThis.fetch;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CHILD_TIMEOUT_MS = 120000;

if (!process.argv.includes('--child')) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: 'inherit', timeout: CHILD_TIMEOUT_MS });
  if (r.error || r.signal) { console.log(`FAIL the test did not finish within ${CHILD_TIMEOUT_MS / 1000} s (${r.signal || r.error.message}): a hang`); process.exit(1); }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(r.status);
}

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const STEP_MS = 400;                 // every single exploit step must be done within this (the old code froze for good)
async function timed(msg, fn) {
  const t = Date.now();
  const out = await fn();
  const ms = Date.now() - t;
  ok(ms < STEP_MS, `${msg} (${ms} ms)`);
  return out;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- three.js: the exact file the pages load, verified by its SRI hash ---------- */
async function loadThree() {
  const page = fs.readFileSync(path.join(REPO, 'pb', 'ski.html'), 'utf8');
  const m = /<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"]+)" integrity="(sha384-[^"]+)" crossorigin="anonymous"><\/script>/.exec(page);
  ok(!!m, 'M3: pb/ski.html loads three.js with an SRI hash + crossorigin');
  for (const other of ['mtb.html', 'lux-drive.html', 'train-sim.html']) {
    const html = fs.readFileSync(path.join(REPO, 'pb', other), 'utf8');
    ok(m && html.includes(`<script src="${m[1]}" integrity="${m[2]}" crossorigin="anonymous"></script>`) && !html.includes(`<script src="${m[1]}"></script>`), `M3: pb/${other} loads the same URL with the same SRI hash`);
  }
  if (!m) throw new Error('no three.js tag');
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ski-work', 'three-' + /three@([^/]+)/.exec(m[1])[1] + '.min.js');
  let code = null;
  const file = process.env.SKI_THREE || (fs.existsSync(cache) ? cache : null);
  if (file) code = fs.readFileSync(file);
  else {
    const res = await realFetch(m[1]);
    if (!res.ok) throw new Error(`three.js HTTP ${res.status}`);
    code = Buffer.from(await res.arrayBuffer());
  }
  const sri = 'sha384-' + crypto.createHash('sha384').update(code).digest('base64');
  ok(sri === m[2], `M3: the SRI hash matches the bytes of ${m[1]}`);
  if (!file && sri === m[2]) { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, code); }
  const mod = { exports: {} };
  new Function('exports', 'module', code.toString('utf8'))(mod.exports, mod);
  return mod.exports;
}

/* ---------- a tiny DOM (only what the HUD / tags / skier model touch) ---------- */
class FakeEl {
  constructor(tag) { this.tagName = tag; this.children = []; this.parent = null; this.style = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; this.className = ''; this.attrs = {}; this.width = 0; this.height = 0; }
  get classList() { const el = this; return { toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); el.className = [...s].join(' '); }, add(c) { this.toggle(c, true); }, remove(c) { this.toggle(c, false); }, contains(c) { return el.className.split(' ').includes(c); } }; }
  appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  replaceChildren(...cs) { for (const c of this.children) c.parent = null; this.children = []; this.append(...cs); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
  querySelector(sel) { const cls = sel.replace(/^\./, ''); for (const c of this.children) { if (c.className.split(' ').includes(cls)) return c; const d = c.querySelector(sel); if (d) return d; } return null; }
  getContext() { return { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} }; }
}

/* ---------- a controllable clock (performance.now is what the session's timers read) ---------- */
const realNow = performance.now.bind(performance);
let skew = 0;
performance.now = () => realNow() + skew;

/* ---------- fake WebRTC: a non-initiator link opens right after the offer; the peer's messages are injected on its channels ---------- */
class FakeChannel {
  constructor(label) { this.label = label; this.readyState = 'connecting'; this.bufferedAmount = 0; this.sent = []; }
  send(s) { this.sent.push(s); }
  close() { this.readyState = 'closed'; }
}
class FakePC {
  constructor() { FakePC.all.push(this); this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.localDescription = null; this.closed = false; this.chs = []; }
  createDataChannel(label) { const c = new FakeChannel(label); this.chs.push(c); return c; }
  async createOffer() { return { type: 'offer', sdp: 'v=0 fake offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0 fake answer' }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) { if (d.type === 'offer') setTimeout(() => this.connect(), 0); }
  connect() {
    if (this.closed) return;
    this.connectionState = 'connected';
    this.chs = [new FakeChannel('ev'), new FakeChannel('st')];
    for (const c of this.chs) this.ondatachannel({ channel: c });
    for (const c of this.chs) { c.readyState = 'open'; c.onopen(); }
  }
  addEventListener() {}
  removeEventListener() {}
  close() { this.closed = true; this.connectionState = 'closed'; }
  deliver(msg, reliable = true) { const c = this.chs.find((x) => x.label === (reliable ? 'ev' : 'st')); c.onmessage({ data: JSON.stringify(msg) }); }
  sentOn(label) { const c = this.chs.find((x) => x.label === label); return c ? c.sent.map((s) => JSON.parse(s)) : []; }
}
FakePC.all = [];

/* ---------- fake Supabase Realtime: channels whose broadcast / presence handlers the test fires ---------- */
const channels = [];
let presence = {};
function fakeClient() {
  return {
    channel(name) {
      const ch = { name, handlers: [], state: 'joined', sent: [], on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return this; }, track() { return Promise.resolve(); }, presenceState() { return presence; }, send(m) { this.sent.push(m); } };
      channels.push(ch);
      return ch;
    },
    removeChannel() {}, removeAllChannels() {}, realtime: { disconnect() {} },
  };
}
const fire = (chName, type, event, payload) => { for (const ch of channels.filter((c) => c.name === chName)) for (const h of ch.handlers) if (h.type === type && (!event || h.filter.event === event)) h.cb({ payload }); };

/* ---------- the browser globals the modules read ---------- */
const docEl = new FakeEl('html');
globalThis.window = globalThis;
globalThis.document = { createElement: (t) => new FakeEl(t), documentElement: docEl };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.fetch = () => Promise.reject(new Error('offline (test)'));
globalThis.RTCPeerConnection = FakePC;
window.PB_CONFIG = { url: 'https://example.invalid', anonKey: 'anon' };
window.supabase = { createClient: fakeClient };
const quiet = console.warn;
console.warn = (...a) => { if (!/\[ski-net\]|\[ski-mp\]|deprecated/.test(String(a[0]))) quiet(...a); };

window.THREE = await loadThree();
const THREE = window.THREE;
const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { unpackState, packState, wrapAngle } = await imp('pb/ski/net/wire.js');
const { createFreeMp } = await imp('pb/ski/net/freeride.js');
const { createRace } = await imp('pb/ski/net/race.js');
const { RACE } = await imp('pb/ski/net/config.js');
const { createCloudSave } = await imp('pb/ski/modes/cloud.js');
const { readMpContext } = await imp('pb/ski/net/index.js');
const { OUTFITS } = await imp('pb/ski/skier-model.js');

/* ================= H1: the wire ================= */
{
  const base = packState({ x: 100, y: 2000, z: 200, heading: 1, speed: 10, edge: 0, tuck: 0, brake: 0, grounded: true }, 50, false);
  const withHeading = (h) => { const a = [...base]; a[3] = h; return a; };
  for (const h of [1e300, -1e300, 1e12, 3e16, 7 * Math.PI, -123456.789]) {
    const st = await timed(`H1: heading ${h} unpacks in constant time`, () => unpackState(withHeading(h)));
    ok(st && st.heading >= -Math.PI && st.heading < Math.PI, `H1: heading ${h} -> ${st && st.heading} (wrapped into [-pi, pi))`);
  }
  ok(Math.abs(wrapAngle(Math.PI * 3) - -Math.PI) < 1e-9 && Math.abs(wrapAngle(0.5) - 0.5) < 1e-12 && Math.abs(wrapAngle(-0.5 - 4 * Math.PI) - -0.5) < 1e-9, 'H1: wrapAngle keeps the angle (mod 2 pi)');
  for (const bad of [NaN, Infinity, '1', null]) ok(unpackState(withHeading(bad)) === null, `H1: heading ${String(bad)} (${typeof bad}) rejected`);
  const huge = await timed('H1: an array of 1,000,000 numbers', () => unpackState(new Array(1e6).fill(1)));
  ok(huge !== null && Object.keys(huge).length <= 25, 'H1: ... reads only the first 19 fields');
  const strs = base.map(String);
  ok(unpackState(strs) === null, 'H1: string numbers ("100") rejected');
  const st = unpackState([0, 1e9, 0, 0, 1e9, 9, 9, 9, 1, 1e9, 99, 9, 1e12, 1e9, -1e9, 1e9]);
  ok(st.y === 9000 && st.air === 30 && st.progress === 1e5 && st.speed === 60 && st.vx === 60 && st.vz === -60 && st.crash === 3, 'H1: y / air / progress / speed / velocities clamped');
  ok(unpackState([0, -1e9, 0, 0, 0, 0, 0, 0, 0, -5, 0, 0, -9, 0, 0, 0]).y === -500, 'H1: y clamped below');
  ok(unpackState({ length: 16 }) === null && unpackState('x'.repeat(40)) === null, 'H1: a non-array rejected');
  const remotesSrc = fs.readFileSync(path.join(REPO, 'pb/ski/net/remotes.js'), 'utf8');
  ok(!/while\s*\(a\s*[<>]/.test(remotesSrc) && /wrapAngle\s*}\s*from '\.\/wire\.js'/.test(remotesSrc.replace(/packState, unpackState, /, '')), 'H1: remotes.js uses the closed-form wrapAngle of wire.js (no while loop)');
}

/* ================= the online free ride: session + remotes + freeride on fake transport ================= */
const ROSTER = [{ id: 'aaaa', name: 'Anna mat engem ganz ganz laangen Numm' }, { id: 'bbbb', name: 'Ben' }];
const triggered = [];
const uiRoot = new FakeEl('div');
const host = {
  game: { state: { x: 0, y: 0, z: 0, heading: 0, speed: 0, grounded: true }, phase: 'running', paused: false, screen: 'game' },
  env: { setWeather() {}, setTime() {}, snap() {}, state: { weatherId: 'sun', timeMode: 'fixed', timeId: 'midday' } },
  hud: { toast() {} }, input: { setEnabled() {} }, audio: {},
  scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1.6, 0.1, 20000), canvas: { clientWidth: 1280, clientHeight: 800 },
  surface: { height: () => 0, normal: (x, z, out) => (out && out.set ? out.set(0, 1, 0) : { x: 0, y: 1, z: 0 }) },
  uiRoot, outfit: () => OUTFITS[0].id, level: () => 'low', liftPath: () => null, liftName: () => '', liftTop: () => null,
  startSpot: () => ({ x: 0, z: 0, heading: 0 }), startFree() {}, dayClock: () => null,
  avalanche: { trigger: (id, seed, t) => triggered.push({ id, seed, t }) },
};
host.camera.position.set(0, 5, 30); host.camera.lookAt(0, 0, 0); host.camera.updateProjectionMatrix();
const ctx = { code: 'TEST', me: 'bbbb', role: 'guest', roster: ROSTER, cfg: { mode: 'free', weather: 'sun', time: 'midday' }, seed: 1 };
const mp = createFreeMp({ ctx, host });
await mp.begin();
const MAIN = 'ski:TEST';
presence = { aaaa: [{ i: 'aaaa', s: 'nonceA1' }], bbbb: [{ i: 'bbbb', s: 'me' }] };
fire(MAIN, 'presence', null, {});
fire(MAIN, 'broadcast', 'sig', { to: 'bbbb', from: 'aaaa', t: 'offer', d: 'v=0 real offer', n: 'nonceA1' });
await wait(20);
const pc = FakePC.all[0];
const info = () => window.__skiMp.info();
ok(pc && info().net.peers[0].via === 'rtc', 'setup: the link to aaaa is open (fake WebRTC)');
pc.deliver({ k: 'q', t: performance.now() - 20, u: performance.now() + 5000 });         // a pong: the clock offset of aaaa is known (+5 s)
ok(window.__skiMp.session.toLocal('aaaa', 10000) !== null, 'setup: the clock offset to aaaa is known');
const render = () => mp.render(performance.now(), performance.now() / 1000);

/* H1 end to end: the states go through session -> freeride -> remotes.push, then remotes.update samples / interpolates them */
{
  const now = Math.round(performance.now()) + 5000;           // his clock (the pong above: +5 s)
  const a = (h, x = 0) => [x, 1, 0, h, 5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0];
  pc.deliver({ k: 'hi', o: OUTFITS[1].id });
  let i = 0;
  for (const h of [0.5, 1e300, 1e12, -1e300, 2.9, NaN]) pc.deliver({ k: 's', e: 0, t: now + 50 * i++, a: a(h, i) }, false);
  // render at every 10 ms across the buffer (shown INTERP_DELAY in the past): interpolation between each pair, then extrapolation
  await timed('H1: render after states with heading 1e300 / 1e12 / -1e300 (interpolation + extrapolation)', () => { for (let k = 0; k < 60; k++) { render(); skew += 10; } });
  const r = window.__skiMp.remotes.get('aaaa');
  ok(r && r.state && Number.isFinite(r.state.heading) && Math.abs(r.state.heading) <= Math.PI + 1e-9, `H1: the remote skier is drawn with a sane heading (${r && r.state && r.state.heading})`);
  ok(r.buf.length <= 5, `H1: the NaN state never entered the buffer (${r.buf.length} states)`);
  ok(r.buf.length >= 2 && r.buf.some((b) => b.s.heading !== 0.5), 'H1: the huge-heading states did reach the interpolation buffer (the test exercises it)');
  pc.deliver({ k: 's', e: 0, t: now + 999, a: new Array(500000).fill(0) }, false);
  pc.deliver({ k: 's', e: 0, t: now + 1000, a: base16Strings() }, false);
  await timed('H1: render after a 500k array and a string array', () => render());
}
function base16Strings() { return Array.from({ length: 16 }, () => '1'); }

/* LOW 3: avalanches */
{
  skew += 20000;                                   // past the per-player gap of any earlier event
  const now = performance.now();
  const peerNow = Math.round(now + 5000);          // his clock
  pc.deliver({ k: 'av', id: '<img src=x>', s: 1, t: peerNow });
  pc.deliver({ k: 'av', id: 'zone-1', s: 1, t: peerNow + 60000 });
  pc.deliver({ k: 'av', id: 'zone-1', s: 1, t: 'soon' });
  pc.deliver({ k: 'av', id: 'zone-1', s: '7', t: peerNow });
  ok(triggered.length === 0, 'LOW 3: avalanche with a bad id / a start 60 s in the future / a string t / a string seed: not triggered');
  pc.deliver({ k: 'av', id: 'zone-1', s: 7, t: peerNow });
  ok(triggered.length === 1 && triggered[0].id === 'zone-1' && Math.abs(triggered[0].t - now) < 50, 'LOW 3: a real avalanche event still triggers (at the right moment in my clock)');
  pc.deliver({ k: 'av', id: 'zone-2', s: 8, t: peerNow });
  ok(triggered.length === 1, 'LOW 3: one avalanche per player per gap');
  host.avalanche.known = (id) => id === 'zone-1';
  skew += 20000;
  pc.deliver({ k: 'av', id: 'zone-9', s: 8, t: Math.round(performance.now() + 5000) });
  ok(triggered.length === 1, 'LOW 3: with the game\'s known(id) hook an unknown zone is ignored');
  delete host.avalanche.known;
}

/* LOW 1: outfit rebuild loop + per-peer token bucket */
{
  const before = window.__skiMp.remotes.get('aaaa');
  let rebuilds = 0, last = before;
  skew += 5000;
  await timed('LOW 1: 1000 "hi" with alternating outfits', () => {
    for (let i = 0; i < 1000; i++) { pc.deliver({ k: 'hi', o: OUTFITS[i % 2 ? 2 : 3].id }); const r = window.__skiMp.remotes.get('aaaa'); if (r !== last) { rebuilds++; last = r; } }
  });
  ok(rebuilds <= 1, `LOW 1: ... rebuild the figure at most once (${rebuilds})`);
  skew += 5000;
  pc.deliver({ k: 'hi', o: 'nope-not-an-outfit' });
  ok(window.__skiMp.remotes.get('aaaa').wanted === '', 'LOW 1: an unknown outfit id is read as "any free one"');
  skew += 5000;
  const pongsBefore = pc.sentOn('ev').filter((m) => m.k === 'q').length;
  await timed('LOW 1: a flood of 1000 reliable pings + 1000 states in one go', () => {
    for (let i = 0; i < 1000; i++) pc.deliver({ k: 'p', t: performance.now() });
    for (let i = 0; i < 1000; i++) pc.deliver({ k: 's', e: 0, t: Math.round(performance.now()) + i, a: [0, 1, 0, 0, 5, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] }, false);
  });
  const pongs = pc.sentOn('ev').filter((m) => m.k === 'q').length - pongsBefore;
  ok(pongs <= 131, `LOW 1: ... only the bucket's burst is answered (${pongs} pongs for 1000 pings)`);
  ok((window.__skiMp.session.info().stats.flooded || 0) >= 1800, `LOW 1: ... the rest is dropped and counted (${window.__skiMp.session.info().stats.flooded})`);
  skew += 1000;
  pc.deliver({ k: 'p', t: performance.now() });
  ok(pc.sentOn('ev').filter((m) => m.k === 'q').length - pongsBefore === pongs + 1, 'LOW 1: one second later the peer is heard again');
}

/* M1: forged hand-shake while the link is healthy */
{
  pc.deliver({ k: 'p', t: performance.now() });                 // the link just delivered: healthy
  const n = FakePC.all.length;
  fire(MAIN, 'broadcast', 'sig', { to: 'bbbb', from: 'aaaa', t: 'offer', d: 'v=0 forged offer', n: 'evil' });
  await wait(10);
  ok(FakePC.all.length === n && !pc.closed && info().net.peers[0].via === 'rtc', 'M1: a forged offer while the link is healthy is ignored (link kept, no new peer connection)');
  presence = { aaaa: [{ i: 'aaaa', s: 'forgedNonce' }], bbbb: [{ i: 'bbbb', s: 'me' }] };
  fire(MAIN, 'presence', null, {});
  await wait(10);
  ok(!pc.closed && info().net.peers[0].via === 'rtc', 'M1: a forged presence nonce while the link is healthy does not drop it');
  const relayChannels = () => channels.filter((c) => c.name.startsWith('ski:TEST:r:')).length;
  fire(MAIN, 'broadcast', 'sig', { to: 'bbbb', from: 'aaaa', t: 'relay', n: 'evil' });
  await wait(10);
  ok(relayChannels() === 0, 'M1: a forged "relay" while the link is healthy opens no relay channel');
  // the link goes silent (the real player reloaded and his "bye" was lost): the waiting nonce is applied, the link is let go
  // (in small steps: a jump of the clock by more than NET.STALL_FRAME between two ticks counts as a local stall and is forgiven)
  for (let i = 0; i < 8; i++) { skew += 400; await wait(260); }
  ok(pc.closed, 'M1: once the link is no longer healthy the new presence nonce restarts the pair (a real reload still recovers)');
  const big = 'v=0 ' + 'a'.repeat(30000);
  const n2 = FakePC.all.length;
  fire(MAIN, 'broadcast', 'sig', { to: 'bbbb', from: 'aaaa', t: 'offer', d: big, n: 'forgedNonce' });
  await wait(10);
  ok(FakePC.all.length === n2, 'M1: an offer of 30 KB is ignored (signal size limit)');
  fire(MAIN, 'broadcast', 'sig', { to: 'bbbb', from: 'aaaa', t: 'offer', d: 'v=0 offer after reload', n: 'forgedNonce' });
  await wait(20);
  ok(FakePC.all.length === n2 + 1 && info().net.peers[0].via === 'rtc', 'M1: a normal offer on a dead link is accepted (the reconnect works)');
}

/* M1: the relay checks the sender and his page life */
{
  const src = fs.readFileSync(path.join(REPO, 'pb/ski/net/session.js'), 'utf8');
  ok(/payload\.f !== p\.id/.test(src) && /payload\.n !== p\.nonce/.test(src) && /payload: \{ f: me, n: nonce, m \}/.test(src), 'M1: relay messages carry and check the sender id + his presence nonce');
}

/* ================= LOW 2: go / sync times ================= */
{
  let clock = 1000;
  const sent = [];
  const roster = [{ id: 'aaaa', name: 'A' }, { id: 'bbbb', name: 'B' }];
  const race = createRace({ me: 'bbbb', roster, runs: 2, now: () => clock, send: (to, m) => sent.push(m), latency: () => 0, minMs: () => 30000 });
  race.setStatus('aaaa', 'here');
  for (const bad of [{ at: 'abc', now: 1 }, { at: NaN, now: 1 }, { at: '5000', now: '1000' }, { at: null, now: null }, { at: 5000 }]) {
    race.receive('aaaa', { k: 'go', r: 0, ...bad });
    race.receive('aaaa', { k: 'sync', r: 0, ph: 'go', ...bad });
  }
  ok(race.phase === 'prep' && race.goAt === null, 'LOW 2: go / sync with string / NaN / null / missing times are ignored (no NaN start)');
  race.receive('aaaa', { k: 'go', r: 0, at: 1e12, now: 0 });
  ok(race.phase === 'go' && race.goAt <= clock + RACE.GO_LEAD + 6000, `LOW 2: a start 1e12 ms ahead is capped (goAt ${race.goAt}, now ${clock})`);
  const race2 = createRace({ me: 'bbbb', roster, runs: 2, now: () => clock, send: () => {}, latency: () => 0 });
  race2.setStatus('aaaa', 'here');
  race2.receive('aaaa', { k: 'sync', r: 0, ph: 'go', at: -1e15, now: 0 });
  ok(race2.goAt >= clock - RACE.HARD_CAP, 'LOW 2: a start far in the past is capped to the hard cap of a run');
  const race3 = createRace({ me: 'bbbb', roster, runs: 2, now: () => clock, send: () => {}, latency: () => 0 });
  race3.setStatus('aaaa', 'here');
  race3.receive('aaaa', { k: 'go', r: 0, at: 1000 + RACE.GO_LEAD, now: 1000 });
  ok(race3.goAt === clock + RACE.GO_LEAD, 'LOW 2: a real go keeps its exact start time');
  let events = 0;
  const race4 = createRace({ me: 'bbbb', roster, runs: 2, now: () => clock, send: () => {}, onEvent: (e) => { if (e.type === 'standings') events++; } });
  race4.setStatus('aaaa', 'here');
  await timed('LOW 1: 1000 identical fin messages', () => { for (let i = 0; i < 1000; i++) race4.receive('aaaa', { k: 'fin', r: 0, ms: 61234, v: true, pen: 0 }); });
  ok(events === 1, `LOW 1: ... change the table once (${events} standings events)`);
}

/* ================= LOW 4: cloud save origin ================= */
{
  const posted = [], listeners = [];
  const parent = { postMessage: (m, target) => posted.push({ m, target }) };
  const win = { parent, location: { origin: 'https://ian.lu' }, addEventListener: (t, fn) => listeners.push(fn), removeEventListener() {}, __pbSave: null };
  const got = [];
  const cloud = createCloudSave({ win, onIncoming: (d) => got.push(d) });
  cloud.start();
  ok(posted.length === 1 && posted[0].target === 'https://ian.lu', `LOW 4: the save request goes to our own origin, not '*' (${posted[0] && posted[0].target})`);
  const rec = { v: 1, tb: 1, s: {}, p: { killy: 50 }, b: {}, x: {} };
  for (const fn of listeners) fn({ source: parent, origin: 'https://evil.example', data: { __pbLoadSave: 1, data: rec } });
  ok(got.length === 0, 'LOW 4: a load-save message from another origin is ignored');
  for (const fn of listeners) fn({ source: parent, origin: 'https://ian.lu', data: { __pbLoadSave: 1, data: rec } });
  ok(got.length === 1 && got[0].park.killy === 50, 'LOW 4: our own origin is still heard');
  cloud.destroy();
  const cloudSrc = fs.readFileSync(path.join(REPO, 'pb/ski/modes/cloud.js'), 'utf8');
  ok(!/\bd\s*:/.test(cloudSrc.split('export function decodeCloud')[1].split('export function mergeCloud')[0]), 'cloud.js: no discovery grid `d` on this branch (nothing to validate yet)');
}

/* ================= LOW 5: roster names ================= */
{
  window.MPGate = { ctx: { game: 'ski', code: 'TEST', role: 'host', cfg: {}, roster: [{ id: 'aaaa', name: 'x'.repeat(500) }, { id: undefined, name: 'ghost' }, { id: 'bbbb', name: { evil: 1 } }] } };
  const c = readMpContext();
  ok(c && c.roster.length === 2 && c.roster.every((r) => typeof r.name === 'string' && r.name.length <= 16), `LOW 5: roster names are strings of at most 16 characters, a roster entry without an id is dropped (${c && c.roster.map((r) => r.name.length).join('/')})`);
}

console.warn = quiet;
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
