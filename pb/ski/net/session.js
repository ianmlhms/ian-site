/* The transport of a match: a full mesh of links between the players of the lobby roster.
 *   - One Supabase Realtime channel per lobby code ("ski:CODE"): presence (who is here, a nonce per page life so a reload is noticed)
 *     and the SDP hand-shake. Nothing else goes through it (Realtime messages are the scarce resource; egress is tight).
 *   - Per pair one RtcLink; the player with the smaller id makes the offer (no glare). Two failed attempts -> the pair's own relay
 *     channel ("ski:CODE:r:A:B"); a pair that never gets an offer opens the relay by itself after a while.
 *   - Pings on every link: round-trip time and the clock offset (lowest-RTT sample wins), for the start time and the interpolation.
 *   - Per peer a status the race understands: 'wait' (not met yet), 'here', 'away' (link up, silent), 'gone' (left / lost for GONE ms).
 * A message reaches onMessage(fromId, msg, reliable) only from the link of that peer: nobody can speak for somebody else over WebRTC.
 * (The hand-shake and the relay go through Realtime broadcast, which does not authenticate senders: see HANDOFF "still wrong".) */
import { NET } from './config.js';
import { RtcLink, RelayLink, netStats } from './link.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js';
const SUPABASE_SRI = 'sha384-K1nraABOP/zFehpLIUksXebbs7jMpB8gYMlb+uhVKZcWT/9Vkq1+qhv6ndC+1Yuz';
const ICE_KEY = 'ski_ice_v1';
const ICE_URL = /^(stun|turn|turns):[^\s]{3,200}$/;
const TICK_MS = 250;
const DYN_ID = /^[a-z0-9]{4,16}$/;
/* security (pre-launch review M1 / LOW 1): the hand-shake and the relay go through unauthenticated Realtime broadcast, so a lobby
 * member (or anybody who guesses the code) can forge them. These limits keep a forgery from cutting or taking over a working link. */
const MAX_SDP = 20000;                 // chars: a real non-trickle SDP with all candidates is 1-6 KB
const LIVE_MS = 3000;                  // ms: a link that delivered a packet this recently is healthy (pings run every second)
const BUCKET = Object.freeze({ rel: { rate: 60, cap: 130 }, st: { rate: 40, cap: 40 } });    // messages / s and burst per peer
const nonceOf = () => Math.random().toString(36).slice(2, 10);

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.onload = () => resolve(); s.onerror = () => reject(new Error(`load ${src}`));
    document.head.appendChild(s);
  });
}
function authToken() {
  try { const a = window.__pbAuth || (window.parent !== window && window.parent.__pbAuth) || null; return (a && a.session && a.session.access_token) || ''; } catch (error) { return ''; }
}
function cleanIce(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const s of list.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && ICE_URL.test(u)).slice(0, 8);
    if (!urls.length) continue;
    const e = { urls };
    if (typeof s.username === 'string' && typeof s.credential === 'string' && s.username.length < 400 && s.credential.length < 400) { e.username = s.username; e.credential = s.credential; }
    else if (urls.some((u) => /^turns?:/.test(u))) continue;
    out.push(e);
  }
  return out;
}
/** STUN always; TURN from the `turn` edge function when it answers (cached per tab until shortly before it expires). */
async function loadIce(cfg) {
  const base = [...NET.ICE_SERVERS];
  try {
    const c = JSON.parse(sessionStorage.getItem(ICE_KEY) || 'null');
    if (c && c.exp - 600000 > Date.now()) { const l = cleanIce(c.servers); if (l.length) return [...base, ...l]; }
  } catch (error) { /* storage blocked */ }
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(cfg.url.replace(/\/$/, '') + NET.TURN_PATH, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${authToken() || cfg.anonKey}` }, signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const list = cleanIce(d && d.iceServers);
    if (!list.length) throw new Error('no ice servers');
    const ttl = Math.max(0, Math.min(14400, Number(d.ttl) || 0));
    try { sessionStorage.setItem(ICE_KEY, JSON.stringify({ exp: Date.now() + (ttl ? ttl * 1000 : 1200000), servers: list })); } catch (error) { /* storage blocked */ }
    return [...base, ...list];
  } catch (error) {
    console.warn(`[ski-net] no TURN servers (${error.message}): STUN and the relay only`);
    return base;
  }
}
function subscribe(ch, onJoined) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('subscribe timeout')); } }, 9000);
    ch.subscribe((st) => {
      if (st === 'SUBSCRIBED') { if (onJoined) onJoined(); if (!done) { done = true; clearTimeout(t); resolve(); } }
      else if (!done && (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED')) { done = true; clearTimeout(t); reject(new Error(`channel ${st}`)); }
    });
  });
}

/**
 * code (lobby code), me (my roster id), roster [{id, name}], name, racing() -> bool (the relay batches only while racing),
 * onMessage(from, msg, reliable), onPeer(id, status)
 */
export function createSession({ code, me, roster, name, racing = () => false, onMessage = () => {}, onPeer = () => {}, relay: relayOpts = null, order = 0, extra: extra0 = null, dynamic = null }) {
  let extra = extra0;
  const nonce = nonceOf();
  const ids = new Set(roster.map((r) => r.id));
  const peers = new Map();
  const newPeer = (id) => ({ id, born: performance.now(), present: false, nonce: '', pendingNonce: '', bucket: { rel: BUCKET.rel.cap, st: BUCKET.st.cap, at: performance.now() }, link: null, relay: null, dyn: false, tries: 0, connecting: false, everOpen: false, lostAt: 0, presentSince: 0, lastRecv: 0, samples: [], rtt: 0, offset: 0, status: 'wait', bye: false, retryTimer: 0 });
  for (const r of roster) if (r.id !== me) peers.set(r.id, newPeer(r.id));
  let sb = null, ch = null, ice = [...NET.ICE_SERVERS], closed = false, lastTick = performance.now(), tickTimer = 0, pingTimer = 0;
  const started = performance.now();
  const pairs = new Map();          // peer id -> relay channel

  const sendCh = (event, payload) => { if (ch) { try { ch.send({ type: 'broadcast', event, payload }); } catch (error) { /* closing */ } } };
  const openLink = (p) => (p.link && p.link.open ? p.link : p.relay && p.relay.open ? p.relay : null);
  /** a link (rtc or relay) that is open and delivered something lately: a hand-shake message may never replace it */
  const healthy = (p) => !!openLink(p) && performance.now() - p.lastRecv < Math.max(LIVE_MS, openLink(p).kind === 'relay' ? NET.SILENT_RELAY : 0);
  /** LOW 1: a token bucket per peer and channel kind; a flood is dropped, never queued */
  function allow(p, reliable) {
    const b = p.bucket, now = performance.now(), dt = Math.max(0, now - b.at) / 1000;
    b.at = now;
    b.rel = Math.min(BUCKET.rel.cap, b.rel + dt * BUCKET.rel.rate);
    b.st = Math.min(BUCKET.st.cap, b.st + dt * BUCKET.st.rate);
    const key = reliable ? 'rel' : 'st';
    if (b[key] < 1) { netStats.flooded = (netStats.flooded || 0) + 1; return false; }
    b[key] -= 1;
    return true;
  }

  /* ---------- links ---------- */
  function onLinkMessage(p, link, m, reliable) {
    if (!allow(p, reliable)) return;
    p.lastRecv = performance.now();
    if (m.k === 'p') { link.send({ k: 'q', t: m.t, u: performance.now() }, true); return; }
    if (m.k === 'q') { pong(p, m); return; }
    if (m.k === 'bye') { p.bye = true; drop(p, 'bye'); return; }
    onMessage(p.id, m, reliable);
  }
  function pong(p, m) {
    const now = performance.now(), t = Number(m.t), u = Number(m.u);
    if (!Number.isFinite(t) || !Number.isFinite(u) || t > now) return;
    p.samples.push({ rtt: now - t, off: u - (t + now) / 2 });
    if (p.samples.length > NET.OFFSET_KEEP) p.samples.shift();
    const best = p.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    p.rtt = best.rtt; p.offset = best.off;
  }
  function makeRtc(p, initiator) {
    if (p.link) { p.link.onclose = null; p.link.close('replaced'); }
    const link = new RtcLink({
      peerId: p.id, initiator, iceServers: ice,
      signal: (t, d) => sendCh('sig', { to: p.id, from: me, t, d, n: nonce }),
      onmessage: (m, r) => onLinkMessage(p, link, m, r),
      onopen: () => { p.everOpen = true; p.tries = 0; p.lastRecv = performance.now(); p.connecting = false; ping(p); evaluate(); },
      onclose: (reason, wasOpen) => {
        if (p.link !== link) return;
        p.link = null; p.connecting = false;
        if (closed || p.bye) return;
        if (wasOpen) p.lostAt = performance.now();
        if (initiator && p.present) {
          p.tries++;
          if (p.tries < NET.RTC_TRIES) { clearTimeout(p.retryTimer); p.retryTimer = setTimeout(() => connect(p), NET.RETRY_MS); }
          else if (!p.relay) { sendCh('sig', { to: p.id, from: me, t: 'relay', n: nonce }); startRelay(p); }
        }
        evaluate();
      },
    });
    p.link = link;
    return link;
  }
  function connect(p) {
    if (closed || !p.present || (p.link && !p.link.closed) || p.relay) return;
    p.connecting = true;
    makeRtc(p, true).makeOffer();
  }
  async function startRelay(p) {
    if (p.relay || closed || !sb) return;
    console.warn(`[ski-net] no WebRTC path to ${p.id}: Realtime relay`);
    const [a, b] = [me, p.id].sort();
    const pc = sb.channel(`ski:${code}:r:${a}:${b}`, { config: { broadcast: { self: false } } });
    pairs.set(p.id, pc);
    const relay = new RelayLink({
      peerId: p.id, racing, ...(relayOpts || {}),
      tx: (m) => { if (pc.state === 'joined') pc.send({ type: 'broadcast', event: 'rl', payload: { f: me, n: nonce, m } }); },
      dispose: () => { try { sb.removeChannel(pc); } catch (error) { /* closing */ } pairs.delete(p.id); },
      onmessage: (m, r) => onLinkMessage(p, relay, m, r),
      onopen: () => { p.everOpen = true; p.lastRecv = performance.now(); ping(p); evaluate(); },
      onclose: (reason, wasOpen) => { if (p.relay !== relay) return; p.relay = null; if (wasOpen) p.lostAt = performance.now(); if (/budget/.test(reason)) console.warn('[ski-net] relay budget used up'); evaluate(); },
    });
    p.relay = relay;
    // M1: the sender must be the pair's other player in his current page life (his presence nonce; an old client sends none)
    pc.on('broadcast', { event: 'rl' }, ({ payload }) => {
      if (!payload || payload.f !== p.id || p.relay !== relay) return;
      if (typeof payload.n === 'string' && p.nonce && payload.n !== p.nonce) return;
      relay.receive(payload.m);
    });
    try { await subscribe(pc); relay.out({ k: 'hello' }); } catch (error) { console.warn('[ski-net] relay channel failed', error.message); relay.close('channel'); }
  }
  function drop(p, why) {
    clearTimeout(p.retryTimer);
    if (p.link) { const l = p.link; p.link = null; l.onclose = null; l.close(why); }
    if (p.relay) { const r = p.relay; p.relay = null; r.onclose = null; r.close(why); }
    p.lostAt = performance.now();
    evaluate();
  }

  /* ---------- Realtime: presence + hand-shake ---------- */
  function onSig(m) {
    if (!m || m.to !== me || typeof m.from !== 'string' || !ids.has(m.from) || closed) return;
    const p = peers.get(m.from);
    if (!p) return;
    if (typeof m.d === 'string' && m.d.length > MAX_SDP) return;
    if (m.t === 'offer' && typeof m.d === 'string') {
      if (healthy(p)) return;                         // M1: a (forged) offer never replaces a working link; a real reload sends 'bye' first
      if (p.nonce && typeof m.n === 'string' && m.n && m.n !== p.nonce) { p.nonce = m.n.slice(0, 16); p.pendingNonce = ''; }
      p.bye = false;
      makeRtc(p, false).acceptOffer(m.d);
    } else if (m.t === 'answer' && typeof m.d === 'string') {
      if (p.link && p.link.initiator && !p.link.open) p.link.acceptAnswer(m.d);
    } else if (m.t === 'relay' && !healthy(p)) startRelay(p);
  }
  function onPresence() {
    if (!ch || closed) return;
    const state = ch.presenceState();
    const seen = new Map();
    const fresh = new Map();
    for (const key of Object.keys(state)) for (const meta of state[key] || []) {
      if (!meta || typeof meta.i !== 'string') continue;
      if (!ids.has(meta.i) && dynamic && meta.i !== me && meta.v === 1 && DYN_ID.test(meta.i)) fresh.set(meta.i, meta);
      if (ids.has(meta.i)) seen.set(meta.i, String(meta.s || ''));
    }
    // newcomers of a running game (a latecomer of the free ride / a spectator of a race): the same rule on every device (arrival order,
    // then id) so a full lobby takes the same ones everywhere; he is a peer from now on (the code is the key)
    if (fresh.size) {
      const list = [...fresh.values()].sort((a, b) => (Number.isFinite(a.o) ? a.o : 1e9) - (Number.isFinite(b.o) ? b.o : 1e9) || (a.i < b.i ? -1 : 1));
      for (const meta of list) {
        if (ids.size >= dynamic.max || !dynamic.accept(meta)) continue;
        ids.add(meta.i); const np = newPeer(meta.i); np.dyn = true; peers.set(meta.i, np);
        seen.set(meta.i, String(meta.s || ''));
        dynamic.onJoin({ id: meta.i, name: String(meta.n || '?').slice(0, 16), order: Number.isFinite(meta.o) ? meta.o : 1e9, meta });
      }
    }
    const now = performance.now();
    for (const p of peers.values()) {
      const n = seen.get(p.id);
      const was = p.present;
      p.present = n !== undefined;
      if (p.present && !was) p.presentSince = now;
      if (p.present && p.nonce && n !== p.nonce) {      // the same player in a new page life (reload): start over with him
        // M1: presence is forgeable: while his link is healthy the new nonce only waits (tick() applies it once the link is not)
        if (healthy(p)) p.pendingNonce = n;
        else restart(p, n);
      } else if (p.present) { p.nonce = n; p.pendingNonce = ''; }
      if (p.present) p.bye = false;
      if (p.present && me < p.id && !openLink(p) && !p.connecting && !p.relay) connect(p);
    }
    evaluate();
  }

  function restart(p, n) {
    p.nonce = n; p.pendingNonce = ''; p.bye = false; p.tries = 0; p.samples = []; p.rtt = 0; p.offset = 0; drop(p, 'reload');      // R7-D: his clock restarted
  }

  /* ---------- status ---------- */
  function statusOf(p, now) {
    if (p.bye) return 'gone';
    const l = openLink(p);
    if (l) return now - p.lastRecv > (l.kind === 'relay' ? NET.SILENT_RELAY : NET.SILENT) ? 'away' : 'here';
    // never met: present (still trying, then the relay) or not here at all; neither may hold the match up for ever
    if (!p.everOpen) return now - Math.max(started, p.born) > NET.GONE * (p.present ? 3 : 2) ? 'gone' : 'wait';
    return now - p.lostAt > NET.GONE ? 'gone' : 'away';
  }
  function evaluate() {
    const now = performance.now();
    for (const p of peers.values()) {
      const st = statusOf(p, now);
      if (st !== p.status) { p.status = st; onPeer(p.id, st); }
    }
  }
  function tick() {
    const now = performance.now(), gap = now - lastTick;
    lastTick = now;
    if (gap > NET.STALL_FRAME) for (const p of peers.values()) { if (p.lastRecv) p.lastRecv = Math.min(now, p.lastRecv + gap); if (p.lostAt) p.lostAt = Math.min(now, p.lostAt + gap); }
    for (const p of peers.values()) {
      if (p.pendingNonce && p.present && !healthy(p)) { restart(p, p.pendingNonce); if (me < p.id) connect(p); }
      // the side that waits for an offer: no link after both attempts' time -> the relay (the other side does the same)
      if (p.present && !openLink(p) && !p.relay && !p.bye && me > p.id && now - p.presentSince > NET.CONNECT_TIMEOUT * NET.RTC_TRIES + NET.RETRY_MS * 2 + 6000 && (!p.link || p.link.closed)) startRelay(p);
    }
    evaluate();
    if (dynamic && dynamic.prune) for (const p of [...peers.values()]) if (p.dyn && !p.present && p.status === 'gone') { peers.delete(p.id); ids.delete(p.id); if (dynamic.onLeave) dynamic.onLeave(p.id); }   // a spectator who left makes room
  }
  function ping(p) { const l = openLink(p); if (l) l.send({ k: 'p', t: performance.now() }, true); }

  const metaNow = () => ({ i: me, n: String(name || '').slice(0, 16), s: nonce, v: 1, o: order, ...(extra || {}) });
  /** more presence fields from now on (the nonce stays: the others do not see a new page life) */
  function setExtra(more) { extra = { ...(extra || {}), ...more }; if (ch && !closed) { try { ch.track(metaNow()).catch(() => {}); } catch (error) { /* closing */ } } }

  async function start() {
    if (!window.RTCPeerConnection) console.warn('[ski-net] no WebRTC: relay only');
    if (!window.PB_CONFIG) await loadScript('/pixelbreak-config.js');
    if (!window.supabase) await loadScript(SUPABASE_JS, SUPABASE_SRI);
    const cfg = window.PB_CONFIG;
    ice = await Promise.race([loadIce(cfg), new Promise((r) => setTimeout(() => r(ice), 3500))]);
    // realtime-only client: never persist / refresh auth (the rule of game-common.js), so no REST or auth traffic at all
    sb = window.supabase.createClient(cfg.url.replace(/\/$/, ''), cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    ch = sb.channel(`ski:${code}`, { config: { broadcast: { self: false }, presence: { key: me } } });
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => onSig(payload)).on('presence', { event: 'sync' }, () => onPresence());
    await subscribe(ch, () => { ch.track(metaNow()).catch(() => {}); });
    tickTimer = setInterval(tick, TICK_MS);
    pingTimer = setInterval(() => { for (const p of peers.values()) ping(p); }, NET.PING_EVERY);
    window.addEventListener('pagehide', close);
  }

  function send(id, msg, reliable = true) { const p = peers.get(id); const l = p && openLink(p); return !!l && l.send(msg, reliable); }
  function broadcast(msg, reliable = true) { for (const p of peers.values()) { const l = openLink(p); if (l) l.send(msg, reliable); } }
  function close() {
    if (closed) return;
    for (const p of peers.values()) { const l = openLink(p); if (l) { l.send({ k: 'bye' }, true); if (l.kind === 'relay') l.flush(); } }
    closed = true;
    clearInterval(tickTimer); clearInterval(pingTimer);
    for (const p of peers.values()) drop(p, 'closed');
    try { if (sb) { sb.removeAllChannels(); sb.realtime.disconnect(); } } catch (error) { /* closing */ }
  }

  return {
    start, send, broadcast, close, nonce, setExtra,
    status: (id) => (peers.get(id) || { status: 'gone' }).status,
    latency: (id) => { const p = peers.get(id); return p && p.rtt ? p.rtt / 2 : 0; },
    /** local time of a peer timestamp (its performance.now()) */
    toLocal: (id, t) => { const p = peers.get(id); return p && p.samples.length ? t - p.offset : null; },
    viaRelay: (id) => { const p = peers.get(id); const l = p && openLink(p); return !!l && l.kind === 'relay'; },
    info: () => ({ me, stats: { ...netStats }, peers: [...peers.values()].map((p) => ({ id: p.id, status: p.status, present: p.present, via: openLink(p) ? openLink(p).kind : null, rtt: Math.round(p.rtt), tries: p.tries })) }),
  };
}
