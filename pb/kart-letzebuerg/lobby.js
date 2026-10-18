/* Kart Lëtzebuerg — online lobby: room codes, quick match, roster, ready/settings, friends invites and the start hand-shake.
 * Supabase Realtime is used ONLY here (lobby presence + SDP hand-shake) and is closed again when the race goes live
 * (kept open only for a peer that needs the relay fallback). No REST calls, no polling. Race traffic: see mp.js. */
(function () {
  'use strict';
  const KL = window.KL, N = KL.NET, C = KL.CFG;
  const $ = (id) => document.getElementById(id);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js';
  const SUPABASE_SRI = 'sha384-K1nraABOP/zFehpLIUksXebbs7jMpB8gYMlb+uhVKZcWT/9Vkq1+qhv6ndC+1Yuz';
  const NAME_KEY = 'kl_name', LINK_WAIT = 8000;
  const rid = () => Math.random().toString(36).slice(2, 8);
  const log = (...a) => { if (KL.NET_DEBUG) console.info('[kart-lobby]', ...a); };
  const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const cleanCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const isCode = (s) => /^[A-Z0-9]{4,10}$/.test(s);
  const driverOk = (id) => KL.DRIVERS.some((d) => d.id === id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const L = (KL.Lobby = {
    active: false, role: null, code: '', myId: '', name: '', drv: 'renert', phase: 'idle', busy: false,
    cfg: { track: 'villehaute', weather: 'random', laps: 3, diff: 'normal', pub: false },
    peers: new Map(),          // host only: id -> { id, name, drv, rdy, via, link, t }
    roster: [], links: new Map(), hostId: null, deputy: null, epoch: 0, sb: null, ch: null, dirCh: null,
    originalHost: false, relayInUse: false, signalling: false,
  });

  /* ---------- identity / auth ---------- */
  function authObj() { try { return window.__pbAuth || (parent !== window && parent.__pbAuth) || null; } catch (e) { return null; } }
  function signedInName() { const a = authObj(); const u = a && a.session && a.session.user; return u ? cleanName((u.user_metadata && u.user_metadata.username) || (u.email || '').split('@')[0]) : ''; }
  function savedName() { try { return cleanName(localStorage.getItem(NAME_KEY) || ''); } catch (e) { return ''; } }
  function defaultName() { return savedName() || signedInName() || ('Gast' + (100 + Math.floor(Math.random() * 900))); }
  KL.defaultName = defaultName;

  /* ---------- supabase (lazy) ---------- */
  function loadScript(src, o) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      if (o && o.integrity) { s.integrity = o.integrity; s.crossOrigin = 'anonymous'; }
      s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }
  async function getSb() {
    if (L.sb) return L.sb;
    if (!window.PB_CONFIG) await loadScript('/pixelbreak-config.js');
    if (!window.supabase) await loadScript(SUPABASE_JS, { integrity: SUPABASE_SRI });
    const cfg = window.PB_CONFIG;
    // realtime-only client: never persist/refresh auth (same rule as game-common.js), so no REST/auth traffic at all
    L.sb = window.supabase.createClient(cfg.url.replace(/\/$/, ''), cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return L.sb;
  }
  function closeSignalling() {
    L.signalling = false;
    const sb = L.sb; L.sb = null; L.ch = null; L.dirCh = null;
    if (!sb) return;
    try { sb.removeAllChannels(); } catch (e) { /* closing */ }
    try { sb.realtime.disconnect(); } catch (e) { /* closing */ }
    log('signalling closed');
  }
  function subscribe(ch) {
    return new Promise((res, rej) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; rej(new Error('subscribe timeout')); } }, 8000);
      ch.subscribe((status) => {
        if (done) return;
        if (status === 'SUBSCRIBED') { done = true; clearTimeout(t); res(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { done = true; clearTimeout(t); rej(new Error('channel ' + status)); }
      });
    });
  }
  const metasOf = (ch) => { const st = ch.presenceState(); const out = []; for (const k in st) for (const m of st[k]) out.push(m); return out; };

  /* ---------- UI helpers ---------- */
  const T = (k, v) => KL.t(k, v);
  function showScreen(name) {
    for (const id of ['menu', 'onlineScreen', 'lobbyScreen', 'netBusy', 'pauseScreen', 'endScreen', 'loading']) if ($(id)) $(id).hidden = id !== name;
  }
  function busy(textKey, vars) { L.busy = true; $('netBusyText').textContent = T(textKey, vars); showScreen('netBusy'); }
  function olMsg(text) { $('olMsg').textContent = text || ''; $('olMsg').hidden = !text; }
  function lbMsg(text) { $('lbMsg').textContent = text || ''; $('lbMsg').hidden = !text; }
  function fail(key, vars) {
    teardown();
    showScreen('onlineScreen'); renderOnline(); olMsg(T(key, vars));
  }
  KL.lobbyFail = fail;

  /* ---------- online entry screen ---------- */
  function renderOnline() {
    const nm = $('olName'); if (!nm.value) nm.value = defaultName();
    const dr = $('olDrivers'); dr.textContent = '';
    for (const d of KL.DRIVERS) {
      const b = document.createElement('button'); b.textContent = d.name; if (L.drv === d.id) b.classList.add('on');
      const i = document.createElement('i'); i.style.background = d.body; b.prepend(i);
      b.addEventListener('click', () => { L.drv = d.id; KL.G.settings.driver = d.id; KL.G.saveSettings && KL.G.saveSettings(); renderOnline(); });
      dr.appendChild(b);
    }
  }
  function openOnline() {
    if (!window.RTCPeerConnection) { showScreen('menu'); alert(T('eNoRtc')); return; }
    L.drv = KL.G.settings.driver; showScreen('onlineScreen'); renderOnline(); olMsg('');
  }
  KL.openOnline = openOnline;
  function takeName() {
    const n = cleanName($('olName').value) || defaultName();
    $('olName').value = n; try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* storage may be blocked */ }
    L.name = n; L.drv = KL.G.settings.driver;
  }

  /* ---------- entry points ---------- */
  function reset() {
    Object.assign(L, { active: true, role: null, code: '', phase: 'idle', rdy: false, peers: new Map(), roster: [], links: new Map(), hostId: null, deputy: null, epoch: 0, originalHost: false, relayInUse: false, joined: false });
    L.myId = rid(); L.cfg = { track: KL.G.settings.track, weather: KL.G.settings.weather === 'random' ? 'random' : KL.G.settings.weather, laps: 3, diff: KL.G.settings.diff, pub: false };
  }
  function genCode() { let s = ''; for (let i = 0; i < N.CODE_LEN; i++) s += N.CODE_ALPHABET[Math.floor(Math.random() * N.CODE_ALPHABET.length)]; return s; }

  async function createLobby(opts) {
    opts = opts || {};
    takeName(); reset(); L.role = 'host'; L.originalHost = true; L.hostId = L.myId; L.cfg.pub = !!opts.pub;
    busy('nvCreating');
    try {
      const sb = await getSb();
      let code = opts.code ? cleanCode(opts.code) : '';
      for (let tries = 0; tries < 6; tries++) {
        if (!code || !isCode(code)) code = genCode();
        const ch = sb.channel('kl:' + code, { config: { broadcast: { self: false }, presence: { key: L.myId } } });
        wireRoomChannel(ch);
        await subscribe(ch);
        await sleep(450);                                  // let the presence sync arrive before claiming the code
        if (metasOf(ch).some((m) => m && m.host && m.id !== L.myId)) {
          if (opts.code) { try { sb.removeChannel(ch); } catch (e) { /* ignore */ } return joinLobby(code, { fromCreate: true }); }
          try { sb.removeChannel(ch); } catch (e) { /* ignore */ } code = ''; continue;
        }
        L.ch = ch; L.code = code; break;
      }
      if (!L.ch) throw new Error('no free code');
      L.signalling = true; L.phase = 'lobby';
      await trackHost();
      await dirUpdate();
      enterLobby();
    } catch (e) { console.warn('[kart-lobby] create failed', e); fail('eNoServer'); }
  }

  async function joinLobby(code, o) {
    code = cleanCode(code);
    if (!isCode(code)) { olMsg(T('eNotFound')); return; }
    if (!(o && o.fromCreate)) { takeName(); reset(); } else { L.role = null; }
    L.role = 'client'; L.originalHost = false; L.code = code; busy('nvJoining');
    try {
      const sb = await getSb();
      const ch = sb.channel('kl:' + code, { config: { broadcast: { self: false }, presence: { key: L.myId } } });
      wireRoomChannel(ch);
      await subscribe(ch);
      L.ch = ch; L.signalling = true;
      await ch.track({ id: L.myId, name: L.name, drv: L.drv, v: 1 });
      // wait for the host's presence entry
      let host = null; const t0 = performance.now();
      while (!host && performance.now() - t0 < 3500) { host = metasOf(ch).find((m) => m && m.host && m.id !== L.myId); if (!host) await sleep(150); }
      if (!host) return fail('eNotFound');
      if (host.open === false) return fail('eLocked');
      if ((host.n || 1) >= N.MAX_PLAYERS) return fail('eFull');
      L.hostId = host.id;
      L.joinTimer = setTimeout(() => { if (L.active && L.role === 'client' && !L.links.has(L.hostId) && !L.joined) fail('eConn'); }, N.CONNECT_TIMEOUT + 4000);
    } catch (e) { console.warn('[kart-lobby] join failed', e); fail('eNoServer'); }
  }

  async function quickMatch() {
    takeName(); reset(); busy('nvFindLobby');
    let found = null;
    try {
      const sb = await getSb();
      const dir = sb.channel(N.DIR_CHANNEL, { config: { broadcast: { self: false }, presence: { key: L.myId } } });
      await subscribe(dir);
      const t0 = performance.now();
      await sleep(700);
      const pick = () => {
        const open = metasOf(dir).filter((m) => m && m.code && isCode(m.code) && (m.n || 1) < N.MAX_PLAYERS);
        return open.length ? open[Math.floor(Math.random() * open.length)] : null;
      };
      found = pick();
      while (!found && performance.now() - t0 < 1800) { await sleep(200); found = pick(); }
      try { sb.removeChannel(dir); } catch (e) { /* ignore */ }
    } catch (e) { console.warn('[kart-lobby] quick match search failed', e); closeSignalling(); return fail('eNoServer'); }
    if (found) return joinLobby(found.code, {});
    return createLobby({ pub: true });
  }

  /* ---------- room channel ---------- */
  function wireRoomChannel(ch) {
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => onSig(payload))
      .on('broadcast', { event: 'rl' }, ({ payload }) => onRelayIn(payload))
      .on('broadcast', { event: 'sys' }, ({ payload }) => onSys(payload))
      .on('presence', { event: 'sync' }, () => onPresence());
  }
  const sendCh = (event, payload) => { if (L.ch) try { L.ch.send({ type: 'broadcast', event, payload }); } catch (e) { /* closing */ } };
  const sendSig = (to, t, d) => sendCh('sig', { to, from: L.myId, t, d });
  async function trackHost() {
    if (!L.ch || L.role !== 'host') return;
    try { await L.ch.track({ id: L.myId, name: L.name, drv: L.drv, host: true, open: L.phase === 'lobby', n: L.peers.size + 1, v: 1 }); } catch (e) { log('track failed', e); }
  }
  async function dirUpdate() {
    // the public-lobby directory is only joined while a public lobby is open
    const want = L.role === 'host' && L.cfg.pub && L.phase === 'lobby' && L.peers.size + 1 < N.MAX_PLAYERS && L.signalling;
    try {
      if (want) {
        if (!L.dirCh) { const sb = await getSb(); const dir = sb.channel(N.DIR_CHANNEL, { config: { broadcast: { self: false }, presence: { key: L.myId } } }); L.dirCh = dir; await subscribe(dir); }
        await L.dirCh.track({ code: L.code, n: L.peers.size + 1, track: L.cfg.track });
      } else if (L.dirCh) { const sb = L.sb, d = L.dirCh; L.dirCh = null; try { await d.untrack(); } catch (e) { /* closing */ } try { sb && sb.removeChannel(d); } catch (e) { /* closing */ } }
    } catch (e) { console.warn('[kart-lobby] directory update failed', e); L.dirCh = null; }
  }

  /* ---------- presence: the host connects to everybody who shows up ---------- */
  function onPresence() {
    if (!L.active || !L.ch) return;
    if (L.role === 'host') {
      const metas = metasOf(L.ch).filter((m) => m && m.id && m.id !== L.myId && !m.host);
      const here = new Set(metas.map((m) => m.id));
      for (const m of metas) if (!L.peers.has(m.id)) addPeer(m);
      for (const id of [...L.peers.keys()]) if (!here.has(id)) { const p = L.peers.get(id); if (p && p.link && p.link.kind === 'rtc' && p.link.open) continue; removePeer(id, 'presence'); }
    } else if (L.role === 'client' && L.phase === 'lobby' && L.hostId && !L.joined) {
      // host vanished before we connected
      const hostHere = metasOf(L.ch).some((m) => m && m.host && m.id === L.hostId);
      if (!hostHere && !L.links.has(L.hostId)) fail('eHostGone');
    }
  }

  function addPeer(m) {
    if (L.phase !== 'lobby') { sendSys(m.id, 'locked'); return; }
    if (L.peers.size + 1 >= N.MAX_PLAYERS) { sendSys(m.id, 'full'); return; }
    const p = { id: String(m.id).slice(0, 12), name: cleanName(m.name) || 'Gast', drv: driverOk(m.drv) ? m.drv : 'renert', rdy: false, via: 'rtc', link: null, t: performance.now(), state: 'connecting' };
    p.drv = freeDriver(p.drv, p.id);
    L.peers.set(p.id, p);
    p.link = makeLink(p.id, true);
    p.link.makeOffer();
    broadcastRoster(); dirUpdate(); trackHost();
  }
  function removePeer(id, why) {
    const p = L.peers.get(id); if (!p) return;
    L.peers.delete(id); L.links.delete(id);
    if (p.link && !p.link.closed) { p.link.onclose = null; p.link.close(why); }
    if (L.phase === 'lobby') { broadcastRoster(); dirUpdate(); trackHost(); }
    else if (KL.MP && KL.MP.active) KL.MP.onPeerGone(id, why);
  }
  function freeDriver(want, selfId) {
    const taken = new Set([...L.peers.values()].filter((p) => p.id !== selfId).map((p) => p.drv)); taken.add(L.drv);
    if (!taken.has(want)) return want;
    const d = KL.DRIVERS.find((x) => !taken.has(x.id)); return d ? d.id : want;
  }

  /* ---------- links ---------- */
  function makeLink(peerId, initiator) {
    let link;
    link = new KL.Link({
      peerId, initiator,
      signal: (t, d) => sendSig(peerId, t, d),
      onmessage: (m, reliable) => onMsg(peerId, m, reliable),
      onopen: () => onLinkOpen(peerId, link),
      onclose: (reason, wasOpen) => onLinkClose(peerId, link, reason, wasOpen),
    });
    L.links.set(peerId, link);
    return link;
  }
  function onSig(p) {
    if (!p || p.to !== L.myId || typeof p.from !== 'string' || !L.active) return;
    const from = p.from.slice(0, 12);
    if (p.t === 'offer') {
      const fromHost = from === L.hostId, fromDeputy = from === L.deputy;
      if (L.role === 'client' && !fromHost && !fromDeputy && L.phase === 'lobby' && (p.retry || 0) < 6) { setTimeout(() => onSig(Object.assign({}, p, { retry: (p.retry || 0) + 1 })), 350); return; }
      if (!(L.role === 'client' && (fromHost || fromDeputy))) return;        // clients only talk to the host and to the deputy
      const old = L.links.get(from); if (old) { old.onclose = null; old.close('replaced'); }
      const link = makeLink(from, false);
      link.acceptOffer(String(p.d));
    } else if (p.t === 'answer') {
      const link = L.links.get(from); if (link && link.initiator && !link.open) link.acceptAnswer(String(p.d));
    }
  }
  function onLinkOpen(peerId, link) {
    if (L.role === 'host' && L.peers.has(peerId)) {
      const p = L.peers.get(peerId); p.state = 'open'; broadcastRoster();
    } else if (L.role === 'client' && peerId === L.hostId) {
      link.send({ k: 'hi', name: L.name, drv: L.drv, v: 1 }, true);
      startPing(link);
    }
    if (KL.MP && KL.MP.active) KL.MP.onLinkOpen(peerId, link);
  }
  function onLinkClose(peerId, link, reason, wasOpen) {
    if (L.links.get(peerId) === link) L.links.delete(peerId);
    log('link closed', peerId, reason, wasOpen);
    if (L.role === 'host' && L.peers.has(peerId)) {
      const p = L.peers.get(peerId);
      if (p.link !== link) return;
      if (!wasOpen && L.phase === 'lobby' && N.RELAY_FALLBACK && L.signalling && (reason === 'timeout' || reason === 'failed')) { switchToRelay(p); return; }
      if (!wasOpen && L.phase === 'lobby') { sendSys(peerId, 'conn'); }
      removePeer(peerId, reason);
    } else if (L.role === 'client') {
      if (peerId === L.hostId) {
        if (L.phase === 'lobby' && !L.joined) { if (N.RELAY_FALLBACK && !wasOpen && L.signalling && (reason === 'timeout' || reason === 'failed')) return; /* the host decides about the relay */ fail(wasOpen ? 'eHostGone' : 'eConn'); }
        else if (L.phase === 'lobby') { fail('eHostGone'); }
        else if (KL.MP && KL.MP.active) KL.MP.onHostLinkClosed(reason);
      } else if (KL.MP && KL.MP.active) KL.MP.onLateralClosed(peerId);
    }
  }
  /* relay fallback for ONE peer (never for the others) */
  function switchToRelay(p) {
    if (!N.RELAY_FALLBACK) return;
    console.warn('[kart-lobby] no WebRTC path to', p.id, '- using the capped Realtime relay');
    sendSys(p.id, 'relay');
    p.link = makeRelay(p.id); p.via = 'relay'; p.state = 'open'; L.links.set(p.id, p.link); L.relayInUse = true;
    broadcastRoster();
  }
  function makeRelay(peerId) {
    return new KL.RelayLink({ peerId, myId: L.myId, broadcast: (payload) => sendCh('rl', payload), onmessage: (m, r) => onMsg(peerId, m, r), onclose: (why) => { if (L.role === 'host') removePeer(peerId, why); else if (peerId === L.hostId) fail('eConn'); } });
  }
  function onRelayIn(p) {
    if (!p || p.to !== L.myId || !L.active) return;
    const link = L.links.get(String(p.from).slice(0, 12));
    if (link && link.kind === 'relay') link.receive(p.m);
  }
  function sendSys(to, what, extra) { sendCh('sys', Object.assign({ to, from: L.myId, w: what }, extra || {})); }
  function onSys(p) {
    if (!p || !L.active) return;
    if (p.to !== L.myId || p.from !== L.hostId) return;
    if (p.w === 'full') fail('eFull');
    else if (p.w === 'locked') fail('eLocked');
    else if (p.w === 'conn') fail('eConn');
    else if (p.w === 'kick') fail('eKicked');
    else if (p.w === 'relay') {
      if (L.links.has(L.hostId) && L.links.get(L.hostId).open) return;
      const old = L.links.get(L.hostId); if (old) { old.onclose = null; old.close('relay'); }
      const link = makeRelay(L.hostId); L.links.set(L.hostId, link); L.relayInUse = true;
      link.send({ k: 'hi', name: L.name, drv: L.drv, v: 1 }, true);
    }
  }

  /* ping / rtt (client -> host, reliable channel) */
  function startPing(link) {
    const tick = () => {
      if (!L.active || link.closed) return;
      link.send({ k: 'ping', t: performance.now() }, true);
      setTimeout(tick, N.PING_EVERY);
    };
    tick();
  }

  /* ---------- messages ---------- */
  function onMsg(from, m, reliable) {
    if (!m || typeof m.k !== 'string') return;
    const link = L.links.get(from);
    switch (m.k) {
      case 'ping': link && link.send({ k: 'pong', t: m.t }, true); return;
      case 'pong': if (link && typeof m.t === 'number') { link.rtt = performance.now() - m.t; if (KL.MP) KL.MP.onRtt(from, link.rtt); } return;
      // ---- host side ----
      case 'hi': if (L.role === 'host') {
        const p = L.peers.get(from); if (!p) return;
        p.name = cleanName(m.name) || p.name; if (driverOk(m.drv)) p.drv = freeDriver(m.drv, p.id); broadcastRoster();
      } return;
      case 'ready': if (L.role === 'host' && L.phase === 'lobby') { const p = L.peers.get(from); if (p) { p.rdy = !!m.v; broadcastRoster(); } } return;
      case 'pick': if (L.role === 'host' && L.phase === 'lobby') { const p = L.peers.get(from); if (p && driverOk(m.drv)) { p.drv = freeDriver(m.drv, p.id); broadcastRoster(); } } return;
      case 'leave': if (L.role === 'host') removePeer(from, 'left'); return;
      case 'linked': if (L.role === 'host') onLinked(from, m); return;
      case 'loaded': if (L.role === 'host') onLoaded(from); return;
      // ---- client side ----
      case 'roster': if (L.role === 'client' && from === L.hostId) onRoster(m); return;
      case 'prep': if (L.role === 'client' && from === L.hostId) onPrep(m); return;
      case 'start': if (L.role === 'client' && from === L.hostId) onStart(m); return;
      case 'go': if (L.role === 'client' && from === L.hostId) onGo(m); return;
      case 'lobby': if (L.role === 'client' && from === L.hostId) backToLobby(m); return;
      case 'closed': if (L.role === 'client' && from === L.hostId && L.phase === 'lobby') fail('eHostGone'); return;
      default: if (KL.MP) KL.MP.onMsg(from, m, reliable, link);
    }
  }

  /* ---------- roster ---------- */
  function rosterNow() {
    const out = [{ id: L.myId, name: L.name, drv: L.drv, rdy: true, via: 'rtc', host: true, st: 'open' }];
    for (const p of L.peers.values()) out.push({ id: p.id, name: p.name, drv: p.drv, rdy: p.rdy, via: p.via, host: false, st: p.link && p.link.open ? 'open' : 'connecting' });
    return out;
  }
  function broadcastRoster() {
    if (L.role !== 'host') return;
    L.roster = rosterNow();
    const msg = { k: 'roster', host: L.myId, deputy: L.deputy, epoch: L.epoch, cfg: L.cfg, players: L.roster };
    for (const p of L.peers.values()) if (p.link && p.link.open) p.link.send(msg, true);
    renderLobby();
  }
  function onRoster(m) {
    if (!Array.isArray(m.players)) return;
    L.roster = m.players.slice(0, N.MAX_PLAYERS).map((p) => ({ id: String(p.id).slice(0, 12), name: cleanName(p.name), drv: driverOk(p.drv) ? p.drv : 'renert', rdy: !!p.rdy, via: p.via === 'relay' ? 'relay' : 'rtc', host: !!p.host, st: p.st === 'open' ? 'open' : 'connecting' }));
    const c = m.cfg || {};
    L.cfg = { track: KL.tracks[c.track] ? c.track : L.cfg.track, weather: String(c.weather || 'random'), laps: Math.max(1, Math.min(10, +c.laps || 3)), diff: KL.DIFFICULTY[c.diff] ? c.diff : 'normal', pub: !!c.pub };
    L.deputy = m.deputy || null;
    const me = L.roster.find((p) => p.id === L.myId);
    if (me) { L.drv = me.drv; L.rdy = me.rdy; }
    if (!L.joined) { L.joined = true; clearTimeout(L.joinTimer); L.phase = 'lobby'; enterLobby(); } else renderLobby();
  }

  /* ---------- lobby screen ---------- */
  function weathersFor(trackId) { const d = KL.tracks[trackId]; return (d && d.theme && d.theme.weathers) || ['day', 'sunset', 'night', 'rain']; }
  const WEATHER_ICON = { day: '☀️', sunset: '🌇', night: '🌙', rain: '🌧️', fog: '🌫️', random: '🎲' };
  function enterLobby() {
    L.busy = false; showScreen('lobbyScreen'); lbMsg('');
    if (L.role === 'host') { L.roster = rosterNow(); }
    renderLobby();
  }
  function btn(parent, label, on, fn) { const b = document.createElement('button'); b.textContent = label; if (on) b.classList.add('on'); b.addEventListener('click', fn); parent.appendChild(b); return b; }
  function renderLobby() {
    if (!L.active || $('lobbyScreen').hidden) return;
    const isHost = L.role === 'host';
    $('lbCode').textContent = L.code || ''; $('lbCodeRow').hidden = !L.signalling;
    $('lbInvite').hidden = !(L.signalling && isHost); $('lbCopy').hidden = !(L.signalling && L.code);
    const ul = $('lbList'); ul.textContent = '';
    for (const p of L.roster) {
      const li = document.createElement('li'); if (p.id === L.myId) li.className = 'me';
      const dot = document.createElement('i'); const d = KL.DRIVERS.find((x) => x.id === p.drv) || KL.DRIVERS[0]; dot.style.background = d.body; li.appendChild(dot);
      const nm = document.createElement('b'); nm.textContent = p.name + (p.id === L.myId ? ' (' + T('you') + ')' : ''); li.appendChild(nm);
      const dn = document.createElement('small'); dn.textContent = d.name; li.appendChild(dn);
      const st = document.createElement('span'); st.className = 'st';
      if (p.host) { st.textContent = '👑 ' + T('lbHost'); st.classList.add('host'); }
      else if (p.st !== 'open') { st.textContent = T('pConn'); st.classList.add('wait'); }
      else if (p.rdy) { st.textContent = '✓ ' + T('pReady'); st.classList.add('ok'); }
      else { st.textContent = T('pWait'); st.classList.add('wait'); }
      li.appendChild(st);
      if (p.via === 'relay') { const b = document.createElement('em'); b.className = 'slow'; b.textContent = '🐢 ' + T('pSlow'); li.appendChild(b); }
      ul.appendChild(li);
    }
    $('lbBots').textContent = L.roster.length >= 8 ? '' : (L.roster.length <= 1 && isHost ? T('lbSolo') : T('lbBots'));
    // settings: the host edits, everybody else sees a summary
    const sets = $('lbSettings'), sum = $('lbSummary');
    sets.hidden = !isHost; sum.hidden = isHost;
    const trName = T('t_' + L.cfg.track), wName = WEATHER_ICON[L.cfg.weather] + ' ' + T('w_' + L.cfg.weather);
    if (!isHost) sum.textContent = trName + ' · ' + wName + ' · ' + L.cfg.laps + ' ' + T('laps') + ' · ' + T('d_' + L.cfg.diff);
    if (isHost) {
      const tr = $('lbTrack'); tr.textContent = '';
      for (const id of Object.keys(KL.tracks)) btn(tr, T('t_' + id), L.cfg.track === id, () => setCfg({ track: id, weather: (L.cfg.weather !== 'random' && !weathersFor(id).includes(L.cfg.weather)) ? 'random' : L.cfg.weather }));
      const w = $('lbWeather'); w.textContent = '';
      for (const k of ['random', ...weathersFor(L.cfg.track)]) btn(w, WEATHER_ICON[k] + ' ' + T('w_' + k), L.cfg.weather === k, () => setCfg({ weather: k }));
      const lp = $('lbLaps'); lp.textContent = '';
      for (const n of [1, 2, 3, 5]) btn(lp, String(n), L.cfg.laps === n, () => setCfg({ laps: n }));
      const df = $('lbDiff'); df.textContent = '';
      for (const k of ['easy', 'normal', 'hard']) btn(df, T('d_' + k), L.cfg.diff === k, () => setCfg({ diff: k }));
      $('lbPublic').checked = !!L.cfg.pub; $('lbPublicRow').hidden = !L.signalling;
    }
    const dr = $('lbDrivers'); dr.textContent = '';
    const taken = new Set(L.roster.filter((p) => p.id !== L.myId).map((p) => p.drv));
    for (const d of KL.DRIVERS) { const b = btn(dr, d.name, L.drv === d.id, () => pickDriver(d.id)); const i = document.createElement('i'); i.style.background = d.body; b.prepend(i); if (taken.has(d.id)) b.disabled = true; }
    // buttons
    const rd = $('lbReady'), st = $('lbStart');
    rd.hidden = isHost; st.hidden = !isHost;
    rd.textContent = L.rdy ? T('lbNotReady') : T('lbReady'); rd.classList.toggle('on', !!L.rdy);
    if (isHost) {
      const others = L.roster.filter((p) => !p.host), ready = others.every((p) => p.rdy && p.st === 'open');
      st.disabled = !ready || L.phase !== 'lobby';
      $('lbHint').textContent = ready ? '' : T('lbWaitReady');
    } else $('lbHint').textContent = L.rdy ? T('lbWaitHost') : '';
  }
  function setCfg(part) {
    if (L.role !== 'host' || L.phase !== 'lobby') return;
    Object.assign(L.cfg, part); broadcastRoster(); dirUpdate();
  }
  function pickDriver(id) {
    KL.G.settings.driver = id; KL.G.saveSettings && KL.G.saveSettings();
    if (L.role === 'host') { L.drv = freeDriver(id, L.myId); broadcastRoster(); trackHost(); }
    else { const l = L.links.get(L.hostId); if (l) l.send({ k: 'pick', drv: id }, true); }
  }
  function toggleReady() { const l = L.links.get(L.hostId); if (!l) return; L.rdy = !L.rdy; l.send({ k: 'ready', v: L.rdy }, true); renderLobby(); }

  /* ---------- leaving ---------- */
  function teardown() {
    clearTimeout(L.joinTimer);
    if (KL.MP && KL.MP.active) KL.MP.stop();
    const old = [...L.links.values()];
    for (const l of old) l.onclose = null;
    setTimeout(() => { for (const l of old) try { l.close('teardown'); } catch (e) { /* closing */ } }, 300);   // let the last 'leave' message out
    L.links.clear(); L.peers.clear();
    closeSignalling();
    L.active = false; L.phase = 'idle'; L.busy = false; L.roster = []; L.joined = false;
  }
  function leave(toMenu) {
    if (L.active) {
      try {
        if (L.role === 'host') for (const p of L.peers.values()) { if (p.link && p.link.open) p.link.send({ k: 'closed' }, true); }
        else { const l = L.links.get(L.hostId); if (l && l.open) l.send({ k: 'leave' }, true); }
      } catch (e) { /* closing */ }
    }
    const wasRace = KL.MP && KL.MP.active;
    teardown();
    if (toMenu !== false) KL.G.openMenu();
    return wasRace;
  }
  KL.leaveOnline = leave;

  /* ---------- start hand-shake: prep (deputy links) -> start -> loaded -> go ---------- */
  function deputyCandidate() {
    for (const p of [...L.peers.values()].sort((a, b) => a.t - b.t)) if (p.link && p.link.kind === 'rtc' && p.link.open) return p.id;
    return null;
  }
  async function hostStart() {
    if (L.role !== 'host' || L.phase !== 'lobby') return;
    if ([...L.peers.values()].some((p) => !p.link || !p.link.open || !p.rdy)) return;
    L.phase = 'linking'; busyHost('nvLinking');
    await trackHost(); await dirUpdate();
    const clients = [...L.peers.values()];
    L.deputy = deputyCandidate();
    L.lateralOk = [];
    if (L.deputy && clients.length > 1 && !L.lateralReady) {
      const others = clients.filter((p) => p.id !== L.deputy && p.link.kind === 'rtc').map((p) => p.id);
      broadcastRoster();
      L.linkWait = { done: false };
      const dl = L.peers.get(L.deputy).link;
      dl.send({ k: 'prep', deputy: L.deputy, ids: others }, true);
      const t0 = performance.now();
      while (!L.linkWait.done && performance.now() - t0 < LINK_WAIT + 2500) await sleep(100);
      L.lateralOk = L.linkWait.ok || [];
    } else if (L.deputy && clients.length > 1) L.lateralOk = clients.filter((p) => p.id !== L.deputy && p.link.kind === 'rtc').map((p) => p.id);
    if (L.deputy) L.lateralReady = true;
    if (!L.active || L.phase !== 'linking') return;
    // build the grid: humans and bots on 8 shuffled slots
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0, rnd = KL.rng(seed);
    const humans = rosterNow().map((p) => ({ id: p.id, name: p.name, drv: p.drv, human: true }));
    const usedDrv = new Set(humans.map((h) => h.drv));
    const botDrv = KL.DRIVERS.filter((d) => !usedDrv.has(d.id));
    const total = N.MAX_PLAYERS;
    const entries = humans.slice();
    for (let i = 0; entries.length < total && i < botDrv.length; i++) entries.push({ id: 'bot' + i, name: botDrv[i].name, drv: botDrv[i].id, human: false, skill: 0.97 + rnd() * 0.06, lane: (rnd() - 0.5) * 1.2 });
    for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
    entries.forEach((e, i) => (e.slot = i));
    const cfg = L.cfg;
    const weather = pickWeather(cfg.track, cfg.weather);
    const start = { k: 'start', seed, track: cfg.track, weather, laps: cfg.laps, diff: cfg.diff, grid: entries, hostId: L.myId, deputy: L.deputy, ok: L.lateralOk, epoch: 0 };
    L.start = start; L.loaded = new Set(); L.phase = 'loading';
    for (const p of L.peers.values()) p.link.send(start, true);
    busyHost('nvLoading', { n: 0, m: L.peers.size + 1 });
    KL.G.mpBegin(start, L).then(() => {
      L.loaded.add(L.myId); loadedProgress();
    }).catch((e) => { console.error(e); fail('eNoServer'); });
    L.loadTimer = setTimeout(() => { if (L.phase === 'loading') hostGo(true); }, N.LOAD_TIMEOUT);
  }
  function pickWeather(trackId, wanted) {
    const list = weathersFor(trackId);
    if (wanted && wanted !== 'random' && list.includes(wanted)) return wanted;
    return list[Math.floor(Math.random() * list.length)];
  }
  function busyHost(key, vars) { showScreen('netBusy'); $('netBusyText').textContent = T(key, vars); }
  function onLinked(from, m) { if (L.linkWait && from === L.deputy) { L.linkWait.ok = Array.isArray(m.ok) ? m.ok.map((x) => String(x).slice(0, 12)) : []; L.linkWait.done = true; } }
  function onLoaded(from) { if (L.phase !== 'loading') return; L.loaded.add(from); loadedProgress(); }
  function loadedProgress() {
    if (L.phase !== 'loading') return;
    busyHost('nvLoading', { n: L.loaded.size, m: L.peers.size + 1 });
    if ([...L.peers.keys()].every((id) => L.loaded.has(id)) && L.loaded.has(L.myId)) hostGo(false);
  }
  function hostGo(timedOut) {
    if (L.phase !== 'loading') return;
    clearTimeout(L.loadTimer); L.phase = 'race';
    if (timedOut) for (const id of [...L.peers.keys()]) if (!L.loaded.has(id)) { sendSys(id, 'kick'); if (KL.MP) KL.MP.dropBeforeStart(id); removePeer(id, 'load'); }
    for (const p of L.peers.values()) p.link.send({ k: 'go' }, true);
    KL.MP.go();
    releaseSignalling();
  }
  /* client side of the hand-shake */
  function onPrep(m) {
    // I am the deputy: link to every other client now (the signalling channel is still open)
    L.deputy = L.myId;
    const ids = (Array.isArray(m.ids) ? m.ids : []).map((x) => String(x).slice(0, 12)).filter((x) => x !== L.myId);
    const hostLink = L.links.get(L.hostId);
    if (!ids.length) { hostLink && hostLink.send({ k: 'linked', ok: [] }, true); return; }
    const results = new Set();
    let sent = false;
    const finish = () => { if (sent) return; sent = true; hostLink && hostLink.send({ k: 'linked', ok: [...results] }, true); };
    for (const id of ids) {
      const link = makeLink(id, true);
      const prevOpen = link.onopen;
      link.onopen = () => { results.add(id); if (results.size === ids.length) finish(); };
      link.makeOffer();
    }
    setTimeout(finish, LINK_WAIT);
  }
  function onStart(m) {
    if (!Array.isArray(m.grid) || m.grid.length < 1 || m.grid.length > N.MAX_PLAYERS) return;
    L.phase = 'loading'; L.deputy = m.deputy || null; L.start = m;
    busy('nvLoading', { n: 0, m: m.grid.filter((g) => g.human).length });
    KL.G.mpBegin(m, L).then(() => { const l = L.links.get(L.hostId); l && l.send({ k: 'loaded' }, true); })
      .catch((e) => { console.error(e); fail('eNoServer'); });
  }
  function onGo() {
    if (L.phase !== 'loading') return;
    L.phase = 'race';
    const hl = L.links.get(L.hostId);
    KL.MP.go(hl && hl.rtt);
    releaseSignalling();
  }
  /* drop the Realtime channel once nobody needs it any more (only a relayed peer keeps it) */
  function releaseSignalling() {
    const needRelay = [...L.links.values()].some((l) => l.kind === 'relay');
    if (needRelay) { log('signalling stays open for the relay fallback'); return; }
    if (L.ch) { try { L.ch.untrack(); } catch (e) { /* closing */ } }
    closeSignalling();
  }
  function backToLobby(m) {
    // host asks everybody to return to the lobby after a race (the links are still open)
    if (KL.MP) KL.MP.stop();
    L.phase = 'lobby'; L.rdy = false; L.joined = true; showScreen('lobbyScreen'); renderLobby();
  }
  function hostBackToLobby() {
    if (L.role !== 'host') return;
    if (KL.MP) KL.MP.stop();
    for (const p of L.peers.values()) { p.rdy = false; if (p.link && p.link.open) p.link.send({ k: 'lobby' }, true); }
    L.phase = 'lobby'; showScreen('lobbyScreen'); broadcastRoster();
  }
  KL.backToLobby = () => (L.role === 'host' ? hostBackToLobby() : null);

  /* ---------- friends: invite from the ian.lu friends list ---------- */
  async function openFriends() {
    const dlg = $('frDlg'), list = $('frList'); dlg.hidden = false; list.textContent = '';
    const a = authObj();
    const msg = document.createElement('p'); msg.className = 'hint';
    if (!(a && a.session && a.sb)) { msg.textContent = T('friendsSignIn'); list.appendChild(msg); return; }
    msg.textContent = '…'; list.appendChild(msg);
    try {
      const { data, error } = await a.sb.rpc('my_friends');             // one on-demand call, only when the dialog is opened
      if (error) throw error;
      list.textContent = '';
      if (!data || !data.length) { msg.textContent = T('friendsNone'); list.appendChild(msg); return; }
      for (const f of data) {
        const row = document.createElement('div'); row.className = 'frow';
        const n = document.createElement('b'); n.textContent = String(f.username || '?').slice(0, 24); row.appendChild(n);
        const b = document.createElement('button'); b.textContent = T('inviteBtn');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const r = await a.sb.rpc('invite_game_room', { p_to: f.user_id, p_game: 'kart-letzebuerg', p_room: L.code.toLowerCase() });
            if (r.error) throw r.error;
            b.textContent = '✓ ' + T('invited');
          } catch (e) { console.warn('[kart-lobby] invite failed', e); b.disabled = false; b.textContent = T('inviteBtn'); lbMsg(T('inviteFail')); }
        });
        row.appendChild(b); list.appendChild(row);
      }
    } catch (e) { console.warn('[kart-lobby] friends failed', e); list.textContent = ''; msg.textContent = T('inviteFail'); list.appendChild(msg); }
  }
  function inviteUrl() { return location.origin + '/pb/kart-letzebuerg.html?room=' + encodeURIComponent(L.code.toLowerCase()) + '&role=guest'; }
  async function copyLink() {
    const url = inviteUrl();
    try { await navigator.clipboard.writeText(url); lbMsg(T('lbCopied')); }
    catch (e) { try { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); lbMsg(T('lbCopied')); } catch (e2) { lbMsg(url); } }
    setTimeout(() => lbMsg(''), 2500);
  }

  /* ---------- wiring ---------- */
  KL.initLobbyUi = function () {
    $('olBack').addEventListener('click', () => { showScreen('menu'); });
    $('olCreate').addEventListener('click', () => createLobby({}));
    $('olQuick').addEventListener('click', () => quickMatch());
    $('olJoin').addEventListener('click', () => joinLobby($('olCode').value));
    $('olCode').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
    $('olCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinLobby($('olCode').value); });
    $('lbCopy').addEventListener('click', copyLink);
    $('lbInvite').addEventListener('click', openFriends);
    $('frClose').addEventListener('click', () => { $('frDlg').hidden = true; });
    $('lbLeave').addEventListener('click', () => leave(true));
    $('lbReady').addEventListener('click', toggleReady);
    $('lbStart').addEventListener('click', hostStart);
    $('lbPublic').addEventListener('change', (e) => setCfg({ pub: !!e.target.checked }));
    window.addEventListener('pagehide', () => { if (L.active) { if (KL.MP && KL.MP.active) KL.MP.leave(); leave(false); } });
    // deep link from an invite / shared link:  ?room=CODE&role=guest|host
    const q = new URLSearchParams(location.search), room = cleanCode(q.get('room') || '');
    if (isCode(room) && !KL.TESTMODE_NOAUTOJOIN) {
      KL.pendingRoom = { room, role: q.get('role') === 'host' ? 'host' : 'guest' };
    }
  };
  KL.runPendingRoom = function () {
    const p = KL.pendingRoom; if (!p) return; KL.pendingRoom = null;
    if (!window.RTCPeerConnection) return;
    $('olName').value = defaultName();
    if (p.role === 'host') createLobby({ code: p.room }); else joinLobby(p.room);
  };
  KL.lobbyRefresh = function () { if (L.active) renderLobby(); };
  KL.lobbyRelease = releaseSignalling;
})();
