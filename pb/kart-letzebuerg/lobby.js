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
    cfg: { track: 'villehaute', weather: 'random', laps: 3, diff: 'normal', pub: false, mode: 'race', cup: 'letzebuerg' },
    peers: new Map(),          // host only: id -> { id, name, drv, rdy, via, link, t }
    roster: [], links: new Map(), hostId: null, deputy: null, epoch: 0, sb: null, ch: null, dirCh: null,
    originalHost: false, relayInUse: false, signalling: false,
  });

  /* ---------- identity / auth ---------- */
  function authObj() { try { return window.__pbAuth || (parent !== window && parent.__pbAuth) || null; } catch (e) { return null; } }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* the signed-in user's id (shared with the host so the finished online race can be logged with it); '' for a guest */
  function myUid() { const a = authObj(); const u = a && a.session && a.session.user; return u && typeof u.id === 'string' && UUID_RE.test(u.id) ? u.id.toLowerCase() : ''; }
  KL.authObj = authObj; KL.myUid = myUid; KL.UUID_RE = UUID_RE;
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
  /* ---------- ICE servers: STUN always, TURN from the `turn` edge function (Cloudflare) when it answers ---------- */
  const ICE_KEY = 'kl_ice_v1', ICE_EARLY = 600000, ICE_RETRY = 60000, ICE_URL = /^(stun|turn|turns):[^\s]{3,200}$/;
  let icePending = null, iceFailedAt = 0;
  function cleanIce(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const s of list.slice(0, 8)) {
      if (!s || typeof s !== 'object') continue;
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && ICE_URL.test(u)).slice(0, 8);
      if (!urls.length) continue;
      const e = { urls };
      if (typeof s.username === 'string' && typeof s.credential === 'string' && s.username.length < 400 && s.credential.length < 400) { e.username = s.username; e.credential = s.credential; }
      else if (urls.some((u) => /^turns?:/.test(u))) continue;                       // a TURN entry without credentials is useless
      out.push(e);
    }
    return out;
  }
  const withBaseline = (extra) => [...N.ICE_SERVERS, ...extra.filter((e) => !e.urls.every((u) => N.ICE_SERVERS.some((b) => b.urls === u)))];
  function loadIce() {
    if (icePending) return icePending;
    const now = Date.now();
    try {
      const c = JSON.parse(sessionStorage.getItem(ICE_KEY) || 'null');
      if (c && typeof c.exp === 'number' && c.exp - ICE_EARLY > now) { const l = cleanIce(c.servers); if (l.length) { KL.ice = { servers: withBaseline(l), source: 'cache' }; return Promise.resolve(KL.ice); } }
    } catch (e) { /* storage may be blocked */ }
    if (now - iceFailedAt < ICE_RETRY) return Promise.resolve(KL.ice);
    icePending = (async () => {
      try {
        if (!window.PB_CONFIG) await loadScript('/pixelbreak-config.js');
        const cfg = window.PB_CONFIG, a = authObj(), token = (a && a.session && a.session.access_token) || cfg.anonKey;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null, to = ctl && setTimeout(() => ctl.abort(), 5000);
        const res = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/turn?for=kart', { headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + token }, signal: ctl ? ctl.signal : undefined });
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json(), list = cleanIce(d && d.iceServers);
        if (!list.length) throw new Error('no ice servers');
        const hasTurn = list.some((e) => e.urls.some((u) => /^turns?:/.test(u))), ttl = Math.max(0, Math.min(14400, +d.ttl || 0));
        KL.ice = { servers: withBaseline(list), source: hasTurn ? 'turn' : 'stun+' };
        try { sessionStorage.setItem(ICE_KEY, JSON.stringify({ exp: now + (hasTurn && ttl ? ttl * 1000 : 1200000), servers: list })); } catch (e) { /* storage may be blocked */ }
      } catch (e) { iceFailedAt = Date.now(); console.warn('[kart-lobby] no TURN servers (' + (e && e.message) + ') - STUN and the relay only'); }
      finally { icePending = null; }
      return KL.ice;
    })();
    return icePending;
  }
  KL.loadIce = loadIce;
  const iceReady = () => Promise.race([loadIce(), sleep(3500)]);

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
    loadIce();                                              // warm up while the player types a name / code
  }
  KL.openOnline = openOnline;
  function takeName() {
    const n = cleanName($('olName').value) || defaultName();
    $('olName').value = n; try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* storage may be blocked */ }
    L.name = n; L.drv = KL.G.settings.driver;
  }

  /* ---------- entry points ---------- */
  function reset() {
    Object.assign(L, { active: true, role: null, code: '', phase: 'idle', rdy: false, peers: new Map(), roster: [], links: new Map(), hostId: null, deputy: null, epoch: 0, originalHost: false, relayInUse: false, joined: false, depOk: new Set(), depBusy: false, depAgain: false, handoff: null, linkWait: null });
    L.myId = rid(); L.cfg = { track: KL.G.settings.track, weather: KL.G.settings.weather === 'random' ? 'random' : KL.G.settings.weather, laps: 3, diff: KL.G.settings.diff, pub: false, mode: KL.G.settings.mode === 'gp' ? 'gp' : 'race', cup: KL.G.settings.cup }; L.gp = null;
  }
  function genCode() { let s = ''; for (let i = 0; i < N.CODE_LEN; i++) s += N.CODE_ALPHABET[Math.floor(Math.random() * N.CODE_ALPHABET.length)]; return s; }

  async function createLobby(opts) {
    opts = opts || {};
    takeName(); reset(); L.role = 'host'; L.originalHost = true; L.hostId = L.myId; L.cfg.pub = !!opts.pub;
    busy('nvCreating');
    try {
      await iceReady();
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
      await iceReady();
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
      if (host.open === false && !host.spec) return fail('eLocked');
      if ((host.n || 1) >= N.MAX_PLAYERS) return fail('eFull');
      L.hostId = host.id;
      L.joinTimer = setTimeout(() => { if (L.active && L.role === 'client' && !L.links.has(L.hostId) && !L.joined) fail('eConn'); }, N.CONNECT_TIMEOUT + (N.RELAY_FALLBACK ? 14000 : 4000));       // (WebRTC gets its chance first, then the relay hand-shake)
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
      .on('broadcast', { event: 'sys' }, ({ payload }) => onSys(payload))
      .on('presence', { event: 'sync' }, () => onPresence());
  }
  const sendCh = (event, payload) => { if (L.ch) try { L.ch.send({ type: 'broadcast', event, payload }); } catch (e) { /* closing */ } };
  /* hand-shake messages: through the room channel while it is the only path (host <-> newcomer); between two clients (deputy <-> client)
   * through the host's own data channel, which also works after the room channel was closed */
  function sendSig(to, t, d) {
    if (L.role === 'client' && to !== L.hostId) {
      const hl = L.links.get(L.hostId);
      if (hl && hl.open) { hl.send({ k: 'sig', to, t, d }, true); return; }
    }
    sendCh('sig', { to, from: L.myId, t, d });
  }
  /* the race on this host is over (results are showing): a newcomer is welcome in the lobby and races in the next one */
  const raceOver = () => !!(KL.MP && KL.MP.active && (KL.MP.resultsDone || KL.MP.ended));
  async function trackHost() {
    if (!L.ch || L.role !== 'host') return;
    // open = takes players into the lobby; spec = a race is running and a newcomer may watch it (and is on the roster for the next one)
    const spec = L.phase === 'race' && !!(KL.MP && KL.MP.active && !KL.MP.ended && !KL.MP.resultsDone);
    try { await L.ch.track({ id: L.myId, name: L.name, drv: L.drv, host: true, open: L.phase === 'lobby' || (L.phase === 'race' && raceOver()), spec, n: L.peers.size + 1, v: 1 }); } catch (e) { log('track failed', e); }
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
    const watching = L.phase === 'race' && !!(KL.MP && KL.MP.canSpectate && KL.MP.canSpectate());     // a newcomer during a running race watches it
    const waiting = L.phase === 'race' && raceOver();                                                      // ... after it: he waits in the lobby for the next one
    if (L.phase !== 'lobby' && !watching && !waiting) { sendSys(m.id, 'locked'); return; }
    if (L.peers.size + 1 >= N.MAX_PLAYERS) { sendSys(m.id, 'full'); return; }
    const p = { id: String(m.id).slice(0, 12), name: cleanName(m.name) || 'Gast', drv: driverOk(m.drv) ? m.drv : 'renert', rdy: false, via: 'rtc', link: null, t: performance.now(), state: 'connecting', spec: watching };
    p.drv = freeDriver(p.drv, p.id);
    L.peers.set(p.id, p);
    // a watcher while everybody else is already on the relay (school network) goes straight to the relay: no 10 s WebRTC attempt first
    if (watching && N.RELAY_FALLBACK && L.relayInUse && L.signalling && ![...L.peers.values()].some((q) => q !== p && q.link && q.link.kind === 'rtc' && q.link.open)) { switchToRelay(p); trackHost(); return; }
    p.link = makeLink(p.id, true);
    p.link.makeOffer();
    broadcastRoster(); dirUpdate(); trackHost();
  }
  function removePeer(id, why) {
    const p = L.peers.get(id);
    if (!p) { if (L.role === 'host' && KL.MP && KL.MP.active) KL.MP.onPeerGone(id, why); return; }
    L.peers.delete(id); L.links.delete(id); L.depOk.delete(id);
    if (p.link && !p.link.closed) { p.link.onclose = null; p.link.close(why); }
    if (L.phase === 'lobby') { broadcastRoster(); dirUpdate(); trackHost(); }
    else if (KL.MP && KL.MP.active) KL.MP.onPeerGone(id, why);
    if (id === L.deputy) { L.deputy = null; if (KL.MP && KL.MP.active) ensureDeputy('gone'); }      // the deputy left: elect and link the next one at once
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
      const viaHost = !!p.viaHost;                                           // forwarded by the host (it vouches for `from`)
      let fromHost = from === L.hostId;
      const fromDeputy = from === L.deputy;
      // an offer from the player who is next in line while we still think the old host is there: the host is gone, this is the new one
      if (L.role === 'client' && !viaHost && !fromHost && L.phase === 'lobby' && L.joined && !L.handoff && successorId() === from) { startHandoff('offer'); fromHost = from === L.hostId; }
      if (L.role === 'client' && !viaHost && !fromHost && !fromDeputy && L.phase === 'lobby' && (p.retry || 0) < 6) { setTimeout(() => onSig(Object.assign({}, p, { retry: (p.retry || 0) + 1 })), 350); return; }
      if (!(L.role === 'client' && (viaHost || fromHost || fromDeputy))) return;        // clients only talk to the host, the deputy and (through the host) the players it links
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
      if (p.spec && KL.MP) KL.MP.sendSpecInit(peerId);
    } else if (L.role === 'client' && peerId === L.hostId) {
      link.send({ k: 'hi', name: L.name, drv: L.drv, uid: myUid(), v: 1 }, true);
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
      if (!wasOpen && (L.phase === 'lobby' || p.spec) && N.RELAY_FALLBACK && L.signalling && (reason === 'timeout' || reason === 'failed')) { switchToRelay(p); return; }
      if (!wasOpen && (L.phase === 'lobby' || p.spec)) { sendSys(peerId, 'conn'); }
      removePeer(peerId, reason);
    } else if (L.role === 'host' && !L.peers.has(peerId)) {
      // (a host that took over mid-race tracks its players as peers too, see adoptAsHost; anything else is a stray link)
    } else if (L.role === 'client') {
      if (peerId === L.hostId) {
        if (L.phase === 'lobby' && !L.joined) { if (N.RELAY_FALLBACK && !wasOpen && L.signalling && (reason === 'timeout' || reason === 'failed')) return; /* the host decides about the relay */ fail(wasOpen ? 'eHostGone' : 'eConn'); }
        else if (L.phase === 'lobby') { if (!(L.handoff && L.handoff.old === peerId)) hostLostInLobby('link'); }
        else if (KL.MP && KL.MP.active) KL.MP.onHostLinkClosed(reason);
        else fail('eHostGone');                                                // lost while the race was being prepared
      } else if (KL.MP && KL.MP.active) KL.MP.onLateralClosed(peerId);
    }
  }
  /* relay fallback for ONE peer (never for the others): the host and that peer meet on a channel of their own (kl:CODE:r:PEERID), so
   * the relayed traffic is delivered to exactly one receiver and costs no other player anything */
  async function openPair(clientId) {
    const sb = await getSb();
    const ch = sb.channel('kl:' + L.code + ':r:' + clientId, { config: { broadcast: { self: false } } });
    const pair = { ch, link: null, send: (payload) => { if (ch.state === 'joined') { try { ch.send({ type: 'broadcast', event: 'rl', payload }); } catch (e) { /* closing */ } } }, close: () => { try { sb.removeChannel(ch); } catch (e) { /* closing */ } } };
    ch.on('broadcast', { event: 'rl' }, ({ payload }) => { if (pair.link) pair.link.receive(payload); });
    try { await subscribe(ch); } catch (e) { pair.close(); throw e; }
    return pair;
  }
  async function switchToRelay(p) {
    if (!N.RELAY_FALLBACK) return;
    console.warn('[kart-lobby] no WebRTC path to', p.id, '- using the Realtime relay');
    p.via = 'relay'; p.state = 'connecting'; broadcastRoster();
    let pair;
    try { pair = await openPair(p.id); }
    catch (e) { console.warn('[kart-lobby] relay channel failed', e); if (L.peers.get(p.id) === p) { sendSys(p.id, 'conn'); removePeer(p.id, 'relay'); } return; }
    if (!L.active || L.peers.get(p.id) !== p) { pair.close(); return; }
    p.link = makeRelay(p.id, pair, false); L.links.set(p.id, p.link); L.relayInUse = true;
    sendSys(p.id, 'relay');
    setTimeout(() => { if (L.peers.get(p.id) === p && !p.hi && L.phase === 'lobby') removePeer(p.id, 'no answer'); }, 12000);     // a stale presence entry (a player who is already gone) never says hello: drop it
  }
  function makeRelay(peerId, pair, open) {
    const link = new KL.RelayLink({
      peerId, myId: L.myId, open, send: pair.send, dispose: pair.close,
      onmessage: (m, r) => onMsg(peerId, m, r),
      onopen: () => onLinkOpen(peerId, link),
      onclose: (why) => {
        if (L.links.get(peerId) === link) L.links.delete(peerId);
        if (L.role === 'host') removePeer(peerId, why);
        else if (peerId === L.hostId) { if (/budget/.test(why)) fail('eRelayCap'); else if (KL.MP && KL.MP.active) KL.MP.onHostLinkClosed(why); else fail('eConn'); }
      },
    });
    pair.link = link;
    return link;
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
      const hostId = L.hostId;
      openPair(L.myId).then((pair) => {
        if (!L.active || L.hostId !== hostId) { pair.close(); return; }
        const old = L.links.get(hostId); if (old) { old.onclose = null; old.close('relay'); }
        const link = makeRelay(hostId, pair, true); L.links.set(hostId, link); L.relayInUse = true;
        link.send({ k: 'hi', name: L.name, drv: L.drv, uid: myUid(), v: 1 }, true);
      }).catch((e) => { console.warn('[kart-lobby] relay channel failed', e); if (L.active) fail('eConn'); });
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
        p.hi = true; p.name = cleanName(m.name) || p.name; p.uid = typeof m.uid === 'string' && UUID_RE.test(m.uid) ? m.uid.toLowerCase() : ''; if (driverOk(m.drv)) p.drv = freeDriver(m.drv, p.id); broadcastRoster();
      } return;
      case 'ready': if (L.role === 'host' && L.phase === 'lobby') { const p = L.peers.get(from); if (p) { p.rdy = !!m.v; broadcastRoster(); } } return;
      case 'pick': if (L.role === 'host' && L.phase === 'lobby') { const p = L.peers.get(from); if (p && driverOk(m.drv)) { p.drv = freeDriver(m.drv, p.id); broadcastRoster(); } } return;
      case 'leave': if (L.role === 'host') removePeer(from, 'left'); return;
      case 'sig':
        if (L.role === 'host') { const t = L.peers.get(String(m.to || '').slice(0, 12)); if (t && t.link && t.link.open && typeof m.t === 'string') t.link.send({ k: 'sig', from, t: m.t, d: m.d }, true); }
        else if (from === L.hostId) onSig({ to: L.myId, from: m.from, t: m.t, d: m.d, viaHost: true });
        return;
      case 'linked': if (L.role === 'host') onLinked(from, m); return;
      case 'specready': if (L.role === 'host' && KL.MP) KL.MP.addSpectator(from); return;
      case 'loaded': if (L.role === 'host') onLoaded(from); return;
      // ---- client side ----
      case 'roster': if (L.role === 'client' && from === L.hostId) onRoster(m); return;
      case 'prep': if (L.role === 'client' && from === L.hostId) onPrep(m); return;
      case 'start': if (L.role === 'client' && from === L.hostId) onStart(m); return;
      case 'go': if (L.role === 'client' && from === L.hostId) onGo(m); return;
      case 'lobby': if (L.role === 'client' && from === L.hostId) backToLobby(m); return;
      case 'spec': if (L.role === 'client' && from === L.hostId) onSpec(m); return;
      case 'specno': if (L.role === 'client' && from === L.hostId && !L.joined) fail('eLocked'); return;
      case 'dep': if (L.role === 'client' && from === L.hostId) { L.deputy = m.id ? String(m.id).slice(0, 12) : null; if (KL.MP && KL.MP.active) KL.MP.deputy = L.deputy; } return;
      case 'closed': if (L.role === 'client' && from === L.hostId && L.phase === 'lobby') hostLostInLobby('closed'); return;
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
    const msg = { k: 'roster', host: L.myId, deputy: L.deputy, epoch: L.epoch, cfg: L.cfg, players: L.roster, ...(L.phase !== 'lobby' ? { wait: 1 } : {}) };
    for (const p of L.peers.values()) if (p.link && p.link.open && !p.spec) p.link.send(msg, true);      // (a spectator gets the roster when the race is over)
    renderLobby();
  }
  function onRoster(m) {
    if (!Array.isArray(m.players)) return;
    L.roster = m.players.slice(0, N.MAX_PLAYERS).map((p) => ({ id: String(p.id).slice(0, 12), name: cleanName(p.name), drv: driverOk(p.drv) ? p.drv : 'renert', rdy: !!p.rdy, via: p.via === 'relay' ? 'relay' : 'rtc', host: !!p.host, st: p.st === 'open' ? 'open' : 'connecting' }));
    const c = m.cfg || {};
    L.cfg = { track: KL.tracks[c.track] ? c.track : L.cfg.track, weather: String(c.weather || 'random'), laps: Math.max(1, Math.min(10, +c.laps || 3)), diff: KL.DIFFICULTY[c.diff] ? c.diff : 'normal', pub: !!c.pub, mode: c.mode === 'gp' ? 'gp' : 'race', cup: KL.CUPS.some((x) => x.id === c.cup) ? c.cup : KL.CUPS[0].id };
    L.deputy = m.deputy || null;
    if (L.handoff) { clearTimeout(L.handoff.timer); L.handoff = null; }          // the new host has taken the lobby over
    const me = L.roster.find((p) => p.id === L.myId);
    if (me) { L.drv = me.drv; L.rdy = me.rdy; }
    if (!L.joined) { L.joined = true; clearTimeout(L.joinTimer); L.phase = 'lobby'; enterLobby(); if (m.wait) { lbMsg(T('lbLate')); } } else renderLobby();
  }

  /* ---------- lobby screen ---------- */
  function weathersFor(trackId) { const d = KL.tracks[trackId]; return (d && d.theme && d.theme.weathers) || ['day', 'sunset', 'night', 'rain']; }
  const WEATHER_ICON = { day: '☀️', sunset: '🌇', night: '🌙', rain: '🌧️', fog: '🌫️', snow: '❄️', random: '🎲' };
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
    const gpMode = L.cfg.mode === 'gp';
    if (!isHost) sum.textContent = (gpMode ? T('gp') + ': ' + T((KL.CUPS.find((c) => c.id === L.cfg.cup) || KL.CUPS[0]).name) : trName + ' · ' + L.cfg.laps + ' ' + T('laps')) + ' · ' + wName + ' · ' + T('d_' + L.cfg.diff);
    if (isHost) {
      const md = $('lbModeChips'); md.textContent = '';
      for (const m of ['race', 'gp']) btn(md, T(m === 'gp' ? 'lbModeGp' : 'lbModeRace'), L.cfg.mode === m, () => setCfg({ mode: m }));
      $('lbTrackBox').hidden = gpMode; $('lbLapsBox').hidden = gpMode; $('lbCupBox').hidden = !gpMode;
      const cp = $('lbCup'); cp.textContent = '';
      for (const cup of KL.CUPS) if (KL.gpRaces(cup, KL.tracks).length) btn(cp, T(cup.name), L.cfg.cup === cup.id, () => setCfg({ cup: cup.id }));
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
  /* ---------- the deputy: always one human client that is linked to every other client and takes over if the host disappears ---------- */
  const depEligible = (p) => !!(p.link && p.link.kind === 'rtc' && p.link.open && !p.spec && !(KL.MP && KL.MP.active && KL.MP.isAway(p.id)));
  const depTargets = (dep) => [...L.peers.values()].filter((p) => p.id !== dep && p.link && p.link.kind === 'rtc' && p.link.open).map((p) => p.id);
  /* ask the deputy to link to `ids` (the offers/answers travel through the host's own data channels); resolves with the ids that opened */
  async function requestLinks(dep, ids) {
    const p = L.peers.get(dep); if (!p || !p.link || !p.link.open) return [];
    const w = (L.linkWait = { done: false, ok: [], dep });
    p.link.send({ k: 'prep', deputy: dep, ids }, true);
    const t0 = performance.now();
    while (!w.done && performance.now() - t0 < LINK_WAIT + 2500 && L.active && L.peers.has(dep)) await sleep(100);
    L.linkWait = null;
    return w.ok.filter((id) => ids.includes(id));
  }
  function announceDeputy() {
    const key = (L.deputy || '-') + '|' + [...L.depOk].sort().join(',');
    if (L.depSent === key) return; L.depSent = key;
    if (KL.MP && KL.MP.active) KL.MP.deputy = L.deputy;
    const msg = { k: 'dep', id: L.deputy, ok: [...L.depOk] };
    for (const p of L.peers.values()) if (p.link && p.link.open && p.link.kind === 'rtc') p.link.send(msg, true);
    log('deputy', L.deputy, [...L.depOk]);
  }
  /* host: (re-)elect the deputy if needed and link it to every client that it is not linked to yet; announce it when it is ready */
  async function ensureDeputy(why) {
    if (L.role !== 'host') return;
    if (L.depBusy) { L.depAgain = true; return; }
    L.depBusy = true;
    try {
      for (let round = 0; round < 6; round++) {
        L.depAgain = false;
        const cands = [...L.peers.values()].filter(depEligible).sort((a, b) => a.t - b.t);
        const dep = L.deputy && cands.some((p) => p.id === L.deputy) ? L.deputy : (cands[0] ? cands[0].id : null);
        if (dep !== L.deputy) { L.deputy = dep; L.depOk = new Set(); L.depSent = null; }
        if (dep) {
          const need = depTargets(dep).filter((id) => !L.depOk.has(id));
          if (need.length) for (const id of await requestLinks(dep, need)) L.depOk.add(id);
        }
        if (!L.active || L.role !== 'host') return;
        if (L.deputy && !L.peers.has(L.deputy)) { L.deputy = null; L.depOk = new Set(); L.depAgain = true; }       // it left while we waited
        if (!L.depAgain) {
          announceDeputy();
          // a lateral link that did not come up in time (slow device / network) is retried while the race runs, a few times
          const missing = L.deputy ? depTargets(L.deputy).filter((id) => !L.depOk.has(id)) : [];
          if (missing.length && (L.depRetry || 0) < 4) { L.depRetry = (L.depRetry || 0) + 1; setTimeout(() => { if (L.active && L.role === 'host') ensureDeputy('retry'); }, 4000); }
          break;
        }
      }
    } finally { L.depBusy = false; }
  }
  KL.Lobby.ensureDeputy = ensureDeputy;
  KL.Lobby.refreshPresence = () => { if (L.role === 'host') { trackHost(); dirUpdate(); } };
  KL.Lobby.dropPeer = (id, why) => { if (L.role === 'host' && L.peers.has(id)) removePeer(id, why); };

  async function hostStart() {
    if (L.role !== 'host' || L.phase !== 'lobby') return;
    if ([...L.peers.values()].some((p) => !p.link || !p.link.open || !p.rdy)) return;
    L.phase = 'linking'; busyHost('nvLinking');
    await trackHost(); await dirUpdate();
    L.depRetry = 0; await ensureDeputy('start');
    L.lateralOk = [...L.depOk];
    if (!L.active || L.phase !== 'linking') return;
    // build the grid: humans and bots on 8 shuffled slots
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0, rnd = KL.rng(seed);
    const humans = rosterNow().map((p) => { const uid = p.id === L.myId ? myUid() : ((L.peers.get(p.id) || {}).uid || ''); return { id: p.id, name: p.name, drv: p.drv, human: true, ...(uid ? { uid } : {}) }; });
    const usedDrv = new Set(humans.map((h) => h.drv));
    const botDrv = KL.DRIVERS.filter((d) => !usedDrv.has(d.id));
    const total = N.MAX_PLAYERS;
    const entries = humans.slice();
    for (let i = 0; entries.length < total && i < botDrv.length; i++) entries.push({ id: 'bot' + i, name: botDrv[i].name, drv: botDrv[i].id, human: false, skill: 0.97 + rnd() * 0.06, lane: (rnd() - 0.5) * 1.2 });
    for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
    entries.forEach((e, i) => (e.slot = i));
    const cfg = L.cfg;
    let track = cfg.track, laps = cfg.laps, gp = null;
    if (cfg.mode === 'gp') {                  // Grand Prix: the cup's tracks one after the other, same roster and drivers
      if (!L.gp || L.gp.cup !== cfg.cup) L.gp = { cup: cfg.cup, idx: 0, races: KL.gpRaces(KL.CUPS.find((c) => c.id === cfg.cup) || KL.CUPS[0], KL.tracks).map((r) => r.track) };
      track = L.gp.races[L.gp.idx]; laps = KL.G.test && cfg.laps ? cfg.laps : KL.CFG.LAPS; gp = { cup: L.gp.cup, idx: L.gp.idx, n: L.gp.races.length };   // (the lap override is for the test flows only)
    } else L.gp = null;
    const weather = pickWeather(track, cfg.weather);
    const start = { k: 'start', seed, track, weather, laps, diff: cfg.diff, grid: entries, hostId: L.myId, deputy: L.deputy, ok: L.lateralOk, epoch: 0, ...(gp ? { gp } : {}) };
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
  function onLinked(from, m) { if (L.linkWait && from === L.linkWait.dep) { L.linkWait.ok = Array.isArray(m.ok) ? m.ok.map((x) => String(x).slice(0, 12)) : []; L.linkWait.done = true; } }
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
    // I am the deputy: link to the clients named by the host now (offers and answers travel through the host's data channel)
    L.deputy = L.myId;
    const ids = (Array.isArray(m.ids) ? m.ids : []).map((x) => String(x).slice(0, 12)).filter((x) => x !== L.myId && x !== L.hostId);
    const hostLink = L.links.get(L.hostId);
    const results = new Set(), pending = [];
    for (const id of ids) { const ex = L.links.get(id); if (ex && ex.open && ex.kind === 'rtc') results.add(id); else pending.push(id); }
    let sent = false;
    const finish = () => { if (sent) return; sent = true; hostLink && hostLink.send({ k: 'linked', ok: [...results] }, true); };
    if (!pending.length) { finish(); return; }
    for (const id of pending) {
      const old = L.links.get(id); if (old) { old.onclose = null; old.close('replaced'); }
      const link = makeLink(id, true);
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
    if (L.role === 'host' && L.ch) {            // the host stays on its (idle) room channel: somebody who opens the code during the race can find it and watch
      dirUpdate(); trackHost(); log('host keeps the idle room channel for spectators'); return;
    }
    if (L.ch) { try { L.ch.untrack(); } catch (e) { /* closing */ } }
    closeSignalling();
  }
  function backToLobby(m) {
    // host asks everybody to return to the lobby after a race (the links are still open); m.gp = the next Grand Prix race starts right away
    if (KL.MP) KL.MP.stop();
    L.phase = 'lobby'; L.rdy = false; L.joined = true;
    if (m && m.gp) busy('nvStarting'); else { showScreen('lobbyScreen'); renderLobby(); }
  }
  function hostBackToLobby(gpNext) {
    if (L.role !== 'host') return;
    if (KL.MP) KL.MP.stop();
    for (const p of L.peers.values()) { p.rdy = !!gpNext; p.spec = false; if (p.link && p.link.open) p.link.send({ k: 'lobby', ...(gpNext ? { gp: true } : {}) }, true); }   // watchers are on the roster now
    L.phase = 'lobby';
    if (!gpNext) { L.gp = null; showScreen('lobbyScreen'); }
    broadcastRoster(); trackHost(); dirUpdate();
  }
  KL.backToLobby = () => (L.role === 'host' ? hostBackToLobby() : null);
  /* Grand Prix: the host moves on to the next race (nobody has to press ready again) */
  KL.gpNext = () => {
    if (L.role !== 'host' || !L.gp || L.gp.idx + 1 >= L.gp.races.length) return;
    L.gp.idx++; busyHost('nvStarting'); hostBackToLobby(true); hostStart();
  };
  KL.gpActive = () => !!(L.gp && L.role === 'host' && L.originalHost);

  /* ---------- the host leaves the LOBBY: the next player takes it over (same code, same settings) ----------
   * Everybody holds the last roster, so everybody computes the same successor (first connected player after the host). The successor
   * re-opens the room channel as host (kept for the whole lobby session by the host, so a client re-joins it only now), the others join the
   * channel too and take the successor's offer; a successor that does not show up within HANDOFF_WAIT is skipped. */
  const HANDOFF_WAIT = 9000;
  const successorList = (old) => L.roster.filter((p) => p.id !== old && !p.host && p.via === 'rtc' && (p.st === 'open' || p.id === L.myId)).map((p) => p.id);
  const successorId = () => successorList(L.hostId)[0] || null;
  function ensureChannel() {
    if (L.ch && L.signalling) return Promise.resolve();
    if (L.chPromise) return L.chPromise;
    L.chPromise = (async () => {
      const sb = await getSb();
      const ch = sb.channel('kl:' + L.code, { config: { broadcast: { self: false }, presence: { key: L.myId } } });
      wireRoomChannel(ch); await subscribe(ch);
      L.ch = ch; L.signalling = true;
      if (L.role === 'client') await ch.track({ id: L.myId, name: L.name, drv: L.drv, v: 1 });
    })().finally(() => { L.chPromise = null; });
    return L.chPromise;
  }
  function hostLostInLobby(why) {
    if (!L.active || L.role !== 'client' || L.phase !== 'lobby' || !L.joined || L.handoff) return;
    startHandoff(why);
  }
  function startHandoff(why) {
    const old = L.hostId;
    L.handoff = { old, cands: successorList(old), i: 0, timer: 0 };
    log('lobby host gone (' + why + '), next in line:', L.handoff.cands);
    const gone = L.links.get(old); if (gone) { gone.onclose = null; gone.close('host gone'); L.links.delete(old); }
    handoffStep();
  }
  function handoffStep() {
    const h = L.handoff; if (!h || !L.active) return;
    const next = h.cands[h.i];
    if (!next) { L.handoff = null; fail('eHostGone'); return; }
    L.hostId = next; L.deputy = null;
    clearTimeout(h.timer);
    if (next === L.myId) { becomeLobbyHost(h); return; }
    ensureChannel().catch((e) => { console.warn('[kart-lobby] hand-over: room channel failed', e); if (L.handoff === h) { L.handoff = null; fail('eHostGone'); } });
    h.timer = setTimeout(() => { const l = L.links.get(next); if (L.handoff === h && !(l && l.open)) { h.i++; handoffStep(); } }, HANDOFF_WAIT);
  }
  async function becomeLobbyHost(h) {
    clearTimeout(h.timer); L.handoff = null;
    for (const [id, l] of [...L.links]) { l.onclose = null; try { l.close('hand-over'); } catch (e) { /* closing */ } L.links.delete(id); }
    Object.assign(L, { role: 'host', originalHost: true, hostId: L.myId, deputy: null, rdy: false, peers: new Map(), depOk: new Set(), depSent: null, gp: null, joined: true, phase: 'lobby' });
    try { await ensureChannel(); await trackHost(); await dirUpdate(); } catch (e) { console.warn('[kart-lobby] hand-over failed', e); fail('eNoServer'); return; }
    L.roster = rosterNow(); enterLobby(); lbMsg(T('lbYouHost')); setTimeout(() => lbMsg(''), 4000);
    onPresence();
  }

  /* ---------- watching a race that is already running ---------- */
  function onSpec(m) {
    if (!m || !m.start || !Array.isArray(m.start.grid) || m.start.grid.length > N.MAX_PLAYERS) return;
    clearTimeout(L.joinTimer);
    L.joined = true; L.phase = 'loading'; L.deputy = m.start.deputy || null; L.start = m.start; L.rdy = false;
    busy('nvLoading', { n: 0, m: m.start.grid.filter((g) => g.human).length });
    KL.G.mpBegin(m.start, L, { spec: true, clock: m.c, phase: m.ph })
      .then(() => { const hl = L.links.get(L.hostId); if (hl) hl.send({ k: 'specready' }, true); })
      .catch((e) => { console.error(e); fail('eNoServer'); });
  }
  /* a client that has just become the host in a running race: track the remaining humans and watchers as peers, so leave detection, the
   * deputy election and the way back to the lobby work like for a host that created the lobby */
  function adoptAsHost() {
    L.peers = new Map(); L.depOk = new Set(); L.deputy = null; L.depSent = null; L.handoff = null;
    let t = 0;
    for (const [id, link] of L.links) {
      if (id === L.myId || !link || link.closed) continue;
      const k = KL.MP.R.byId[id];
      L.peers.set(id, { id, name: k ? k.name : 'Gast', drv: k ? k.driver.id : 'renert', rdy: false, via: link.kind === 'relay' ? 'relay' : 'rtc', link, t: ++t, state: 'open', spec: !k });
    }
    L.roster = rosterNow();
    ensureDeputy('promoted');
  }
  KL.Lobby.adoptAsHost = adoptAsHost;

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
  /* inside the arcade frame (srcdoc) location.origin is the string "null": window.origin is the site's */
  function siteOrigin() { const o = window.origin; return o && o !== 'null' ? o : 'https://ian.lu'; }
  function inviteUrl() { return siteOrigin() + '/pb/kart-letzebuerg.html?room=' + encodeURIComponent(L.code.toLowerCase()) + '&role=guest'; }
  KL.inviteUrl = inviteUrl;
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
