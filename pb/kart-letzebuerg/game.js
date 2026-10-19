/* Kart Lëtzebuerg — game controller: menu, race flow, fixed-step loop, HUD, results, settings, test hooks. */
(function () {
  'use strict';
  const KL = window.KL, C = KL.CFG;
  const { clamp, fmtTime } = KL;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let parentParams = null;
  try { if (parent !== window) parentParams = new URL(parent.location.href).searchParams; } catch (e) { /* cross-origin parent */ }
  const TEST = params.get('test') === '1' || (parentParams && parentParams.get('test') === '1');
  const SETTINGS_KEY = 'kl_settings';
  /* the arcade tells its games when the Halloween event is on (window.__pbHalloween); ?halloween=1 previews it */
  const halloween = () => window.__pbHalloween === true || params.get('halloween') === '1';
  const trackName = (id) => KL.t('t_' + id) + (halloween() && id === 'geeschterschlass' ? ' 🎃' : '');

  const G = {
    state: 'boot', renderer: null, audio: new KL.Audio(), race: null, track: null, tracks: {}, previews: {}, human: null, rear: false,
    settings: { track: 'villehaute', weather: 'random', diff: 'normal', driver: 'renert', quality: 'auto', autoGas: true, mode: 'race', cup: 'letzebuerg' },
    acc: 0, last: 0, forced: null, paused: false, frame: 0, fpsAvg: 16, lowStreak: 0, raceCount: 0, resultsShown: false, finishAt: 0,
    toastT: 0, lastCount: 99, hud: {}, ghost: null, ghostPose: null, rec: null, session: null, steps: 0,
  };
  KL.G = G; G.test = TEST;
  const warn = (m, e) => console.warn('[Kart] ' + m, e || '');

  function loadSettings() {
    G.saveSettings = saveSettings;
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (s && typeof s === 'object') Object.assign(G.settings, s); } catch (e) { warn('settings not readable', e); }
    if (!KL.tracks[G.settings.track]) G.settings.track = 'villehaute';
    if (!KL.DRIVERS.some((d) => d.id === G.settings.driver)) G.settings.driver = 'renert';
    if (!KL.DIFFICULTY[G.settings.diff]) G.settings.diff = 'normal';
    if (!['race', 'gp', 'tt'].includes(G.settings.mode)) G.settings.mode = 'race';
    if (!KL.CUPS.some((c) => c.id === G.settings.cup)) G.settings.cup = KL.CUPS[0].id;
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) { warn('settings not saved', e); } }

  /* ---------- i18n ---------- */
  function translate() {
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = KL.t(el.dataset.t); });
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === KL.lang())));
    buildMenuChips(); updateKeyHint();
    $('btnPause').setAttribute('aria-label', KL.t('pause')); $('btnWeather').setAttribute('aria-label', KL.t('weather')); $('btnReset').setAttribute('aria-label', KL.t('reset'));
    $('bItem').setAttribute('aria-label', KL.t('btn_item')); $('bDrift').setAttribute('aria-label', KL.t('btn_drift')); $('bBrake').setAttribute('aria-label', KL.t('btn_brake')); $('bGas').setAttribute('aria-label', KL.t('btn_gas'));
    buildPauseSelects();
  }
  function updateKeyHint() { $('keyHint').textContent = KL.t('controls'); $('menuHint').textContent = KL.t('controls'); }

  /* ---------- menu ---------- */
  const WEATHER_ICON = { day: '☀️', sunset: '🌇', night: '🌙', rain: '🌧️', fog: '🌫️', snow: '❄️', random: '🎲' };
  function weathersFor(trackId) { const d = KL.tracks[trackId]; return (d && d.theme && d.theme.weathers) || ['day', 'sunset', 'night', 'rain']; }
  function chip(parent, label, on, fn, extra) { const b = document.createElement('button'); b.textContent = label; if (on) b.classList.add('on'); b.addEventListener('click', () => { fn(); KL.G.audio.sfx('click'); }); if (extra) extra(b); parent.appendChild(b); return b; }
  function drawTrackPreview(canvas, track, overlay) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < track.N; i++) { x0 = Math.min(x0, track.X[i]); x1 = Math.max(x1, track.X[i]); z0 = Math.min(z0, track.Z[i]); z1 = Math.max(z1, track.Z[i]); }
    const sc = Math.min((W - 12) / (x1 - x0), (H - 12) / (z1 - z0)), ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oz = (H - (z1 - z0) * sc) / 2 - z0 * sc;
    g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = '#ffffffcc'; g.lineWidth = 3.2; if (overlay) { g.shadowColor = '#000c'; g.shadowBlur = 5; g.strokeStyle = '#fffffff0'; } g.beginPath();
    for (let i = 0; i <= track.N; i++) { const j = i % track.N; const x = track.X[j] * sc + ox, z = track.Z[j] * sc + oz; if (i) g.lineTo(x, z); else g.moveTo(x, z); }
    g.stroke();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(track.X[0] * sc + ox, track.Z[0] * sc + oz, 3.6, 0, 7); g.fill();
  }
  function cupWeathers(cupId) {
    const cup = KL.CUPS.find((c) => c.id === cupId) || KL.CUPS[0], set = new Set();
    for (const r of KL.gpRaces(cup, KL.tracks)) for (const w of weathersFor(r.track)) set.add(w);
    return ['day', 'sunset', 'night', 'rain', 'snow', 'fog'].filter((w) => set.has(w));
  }
  function menuWeathers() { return G.settings.mode === 'gp' ? cupWeathers(G.settings.cup) : weathersFor(G.settings.track); }
  function recLine(trackId) {
    const lap = KL.Save.best(trackId, 'lap'), race = KL.Save.best(trackId, 'race'), out = [];
    if (lap) out.push(KL.t('bestLapShort') + ' ' + fmtTime(lap / 1000));
    if (race) out.push(KL.t('bestRaceShort') + ' ' + fmtTime(race / 1000));
    return out.join(' · ');
  }
  function buildMenuChips() {
    const S = G.settings;
    for (const [m, id] of [['race', 'modeRace'], ['gp', 'modeGp'], ['tt', 'modeTt']]) { $(id).classList.toggle('on', S.mode === m); $(id).setAttribute('aria-pressed', String(S.mode === m)); }
    $('trackHead').textContent = KL.t(S.mode === 'gp' ? 'cup' : 'track');
    $('diffBox').hidden = S.mode === 'tt';
    const tc = $('trackCards'); tc.textContent = '';
    if (S.mode === 'gp') {
      for (const cup of KL.CUPS) {
        const races = KL.gpRaces(cup, KL.tracks); if (!races.length) continue;
        const ids = [...new Set(races.map((r) => r.track))];
        const b = document.createElement('button'); b.className = 'tcard cup' + (S.cup === cup.id ? ' on' : '');
        const prev = document.createElement('span'); prev.className = 'cprev';
        for (const id of ids) { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 54; prev.appendChild(cv); drawTrackPreview(cv, previewTrack(id)); }
        b.appendChild(prev);
        const d = document.createElement('div'); d.innerHTML = '<b></b><small></small>'; d.firstChild.textContent = KL.t(cup.name); d.lastChild.textContent = ids.map(trackName).join(' · ') + ' · ' + KL.t('cupDesc', { n: races.length });
        b.appendChild(d);
        b.addEventListener('click', () => { S.cup = cup.id; if (S.weather !== 'random' && !cupWeathers(cup.id).includes(S.weather)) S.weather = 'random'; saveSettings(); buildMenuChips(); G.audio.sfx('click'); });
        tc.appendChild(b);
      }
    } else {
      for (const id of Object.keys(KL.tracks)) {
        const def = KL.tracks[id];
        const b = document.createElement('button'); b.className = 'tcard' + (S.track === id ? ' on' : '');
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 108;
        const pv = document.createElement('span'); pv.className = 'tpv'; const im = new Image(); im.alt = ''; im.decoding = 'async'; im.draggable = false; im.src = '/pb/kart-letzebuerg/thumbs/' + id + '.webp?v=1'; im.addEventListener('error', () => im.remove()); pv.appendChild(im); pv.appendChild(cv); b.appendChild(pv);
        const d = document.createElement('div'); d.innerHTML = '<b></b><small></small><small class="rec"></small>'; d.firstChild.textContent = trackName(id); d.children[1].textContent = KL.t('t_' + id + '_d'); d.lastChild.textContent = recLine(id); b.appendChild(d);
        b.addEventListener('click', () => { S.track = id; if (S.weather !== 'random' && !weathersFor(id).includes(S.weather)) S.weather = 'random'; saveSettings(); KL.Boards.select('lap', id); buildMenuChips(); G.audio.sfx('click'); });
        tc.appendChild(b); drawTrackPreview(cv, previewTrack(id), true);
      }
    }
    const wc = $('weatherChips'); wc.textContent = '';
    for (const w of ['random', ...menuWeathers()]) chip(wc, WEATHER_ICON[w] + ' ' + KL.t('w_' + w), S.weather === w, () => { S.weather = w; saveSettings(); buildMenuChips(); });
    const dc = $('diffChips'); dc.textContent = '';
    for (const d of ['easy', 'normal', 'hard']) chip(dc, KL.t('d_' + d), S.diff === d, () => { S.diff = d; saveSettings(); buildMenuChips(); });
    const vc = $('driverChips'); vc.textContent = '';
    for (const d of KL.DRIVERS) { const b = chip(vc, d.name, S.driver === d.id, () => { S.driver = d.id; saveSettings(); buildMenuChips(); }); const i = document.createElement('i'); i.style.background = d.body; b.prepend(i); }
  }
  G.refreshMenu = () => buildMenuChips();

  /* leaderboards dialog: the arcade shows one board at a time, this picks which one */
  const BD = { kind: 'lap', track: null };
  function buildBoardsDlg() {
    BD.track = BD.track && KL.tracks[BD.track] ? BD.track : G.settings.track;
    const k = $('bdKinds'); k.textContent = '';
    for (const kind of KL.Boards.kinds) chip(k, KL.t('bd_' + kind), BD.kind === kind, () => { BD.kind = kind; buildBoardsDlg(); });
    const t = $('bdTracks'); t.textContent = ''; t.hidden = BD.kind === 'gp';
    for (const id of Object.keys(KL.tracks)) chip(t, KL.t('t_' + id), BD.track === id, () => { BD.track = id; buildBoardsDlg(); });
  }
  function openBoardsDlg() { buildBoardsDlg(); $('bdScreen').hidden = false; }

  function buildPauseSelects() {
    const pw = $('pWeather'); pw.textContent = '';
    for (const w of weathersFor(G.settings.track)) { const o = document.createElement('option'); o.value = w; o.textContent = WEATHER_ICON[w] + ' ' + KL.t('w_' + w); pw.appendChild(o); }
    pw.value = G.renderer ? G.renderer.weatherName : 'day';
    const pq = $('pQuality'); pq.textContent = '';
    for (const q of ['auto', 'low', 'medium', 'high']) { const o = document.createElement('option'); o.value = q; o.textContent = KL.t('q_' + q); pq.appendChild(o); }
    pq.value = G.settings.quality; $('pGas').value = G.settings.autoGas ? '1' : '0';
  }

  /* ---------- tracks ---------- */
  /* the menu only has the waypoints of every track (tracks-index.js); the full definition is loaded when a race starts (KL.ensureTrack) */
  function getTrack(id) { const d = KL.tracks[id]; if (!d || !d.loaded) throw new Error('track not loaded: ' + id); return G.tracks[id] || (G.tracks[id] = KL.buildTrack(d)); }
  function previewTrack(id) { return KL.tracks[id].loaded ? getTrack(id) : (G.previews[id] || (G.previews[id] = KL.buildTrack(KL.tracks[id]))); }

  /* ---------- quality ---------- */
  function detectQuality() {
    const ua = navigator.userAgent || '', touchMac = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
    const mobile = /iPad|iPhone|Android/.test(ua) || touchMac;
    const cores = navigator.hardwareConcurrency || 4;
    if (mobile) return cores <= 4 ? 'low' : 'medium';
    return 'high';
  }
  const effQuality = () => (G.settings.quality === 'auto' ? G.autoQ : G.settings.quality);

  /* ---------- race flow ---------- */
  function showOnly(name) {
    for (const id of ['menu', 'onlineScreen', 'lobbyScreen', 'netBusy', 'pauseScreen', 'endScreen', 'loading', 'fatal', 'bdScreen']) $(id).hidden = id !== name;
    $('hud').hidden = !(name === null);
  }
  function openMenu() {
    if (KL.Lobby && KL.Lobby.active) KL.leaveOnline(false);
    G.mp = false;
    G.state = 'menu'; G.paused = false; G.race = null; G.session = null; showOnly('menu'); KL.Boards.select('lap', G.settings.track); G.audio.silence(); document.documentElement.classList.remove('kl-race');
    if (G.renderer) { G.renderer.rain.visible = false; G.renderer.snow.visible = false; }
    KL.input.setEnabled(false);
  }

  function pickWeather(trackId, wanted) {
    const list = weathersFor(trackId);
    if (wanted && wanted !== 'random' && list.includes(wanted)) return wanted;
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ---------- sessions: single race, Grand Prix (4 races, points) and time trial (ghost) ---------- */
  function newGp(cupId) {
    const cup = KL.CUPS.find((c) => c.id === cupId) || KL.CUPS[0], races = KL.gpRaces(cup, KL.tracks), S = G.settings;
    const off = Math.floor(Math.random() * 4);
    races.forEach((r, i) => { const list = weathersFor(r.track); r.weather = S.weather !== 'random' && list.includes(S.weather) ? S.weather : list[(off + i) % list.length]; });
    return { kind: 'gp', cup: cup.id, races, idx: 0, table: {}, names: {}, done: false };
  }
  /* what the running session adds to a race's options */
  function sessionOpts() {
    const ss = G.session, S = G.settings;
    if (ss && ss.kind === 'gp') { const r = ss.races[ss.idx]; return { track: r.track, weather: r.weather, bots: 7 }; }
    if (ss && ss.kind === 'tt') return { track: S.track, bots: 0, mode: 'tt' };
    return {};
  }
  function startSelected() {
    const S = G.settings;
    G.session = S.mode === 'gp' ? newGp(S.cup) : { kind: S.mode === 'tt' ? 'tt' : 'race' };
    startRace();
  }

  function startRace(opts) {
    opts = Object.assign({}, sessionOpts(), opts || {});
    const S = G.settings, trackId = opts.track || S.track;
    $('loading').hidden = false; $('menu').hidden = true;
    KL.ensureTrack(trackId).then(() => new Promise((r) => setTimeout(r, 30))).then(() => beginRace(trackId, opts))
      .catch((e) => { console.error(e); fatal(KL.t('engineError') + ' (' + (e && e.message) + ')'); });
  }

  function beginRace(trackId, opts) {
    const S = G.settings, track = getTrack(trackId);
    G.track = track;
    const weather = pickWeather(trackId, opts.weather || S.weather);
    const diffName = opts.diff || S.diff;
    const me = KL.DRIVERS.find((d) => d.id === (opts.driver || S.driver)) || KL.DRIVERS[0];
    const botDrivers = KL.DRIVERS.filter((d) => d.id !== me.id);
    const seed = opts.seed || (Date.now() & 0xffffff);
    const rnd = KL.rng(seed);
    // grid order: bots shuffled; the player starts in the back half so there is something to overtake
    const order = botDrivers.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const nBots = opts.bots != null ? opts.bots : 7;
    const defs = [];
    const mySlot = opts.mySlot != null ? opts.mySlot : Math.min(5, nBots);
    let bi = 0;
    for (let slot = 0; slot < nBots + 1; slot++) {
      if (slot === mySlot) defs.push({ id: 'me', name: opts.name || S.name || KL.t('you'), driver: me, human: true, gridSlot: slot });
      else { const d = order[bi++ % order.length]; defs.push({ id: 'bot' + slot, name: d.name, driver: d, isBot: true, gridSlot: slot, botSkill: 0.97 + rnd() * 0.06, lanePref: (rnd() - 0.5) * 1.2 }); }
    }
    const R = KL.createRace({ track, karts: defs, laps: opts.laps || C.LAPS, difficulty: diffName, weather, seed, mode: opts.mode || 'race' });
    if (R.mode === 'tt') for (const b of R.boxes) { b.active = false; b.respawn = 1e9; }          // time trial: no item boxes
    setupScene(R, track, weather, 'me', false);
    setupGhost(R, track, me);
    $('loading').hidden = true; showOnly(null);
    G.state = 'race'; G.paused = false; KL.input.setEnabled(true);
    revealHud(weather);
    const ss = G.session;
    if (ss && ss.kind === 'gp') showToast(KL.t('gpRace', { n: ss.idx + 1, m: ss.races.length }) + ' · ' + KL.t('t_' + trackId), 3000);
    else if (R.mode === 'tt') showToast(G.ghost ? '👻 ' + fmtTime(G.ghost.sec) : KL.t('ttNoGhost'), 3200);
    else showToast(KL.t('hintDrift'), 3200);
  }

  /* time-trial ghost: your best lap so far on this track, replayed from every line crossing */
  function setupGhost(R, track, driver) {
    G.ghost = null; G.ghostPose = null; G.rec = null; G.ttDelta = null;
    G.renderer.setGhost(null);
    if (R.mode !== 'tt') return;
    G.rec = KL.Ghost.recorder();
    const sv = KL.Save.ghostOf(track.id), samples = sv && KL.Ghost.decode(sv.g);
    if (samples) {
      const drv = KL.DRIVERS.find((d) => d.id === sv.drv) || driver;
      G.ghost = { samples, sec: sv.ms / 1000, drv }; G.renderer.setGhost(drv);
    }
  }
  /* after every simulation step (solo): ghost recording */
  function afterStep(R) {
    const k = G.human;
    if (!G.rec || !k) return;
    const done = G.rec.tick(k, R);
    if (!done) return;
    G.ttDelta = G.ghost ? done.sec - G.ghost.sec : null;
    if (KL.Save.ghost(G.track.id, done.sec, done.samples, k.driver.id)) {
      G.ghost = { samples: done.samples, sec: done.sec, drv: k.driver }; G.renderer.setGhost(k.driver);
    }
  }
  function updateGhostPose(R, alpha) {
    const k = G.human;
    if (!G.ghost || !G.renderer.ghost || !k) return;
    if (k.finished) { G.renderer.updateGhost(null); return; }
    const t = k.lapIdx < 0 ? 0 : R.clock - (1 - alpha) * C.STEP - k.lapStart;
    G.renderer.updateGhost(KL.Ghost.poseAt(G.ghost.samples, Math.max(0, t), G.ghostPose || (G.ghostPose = {})));
  }

  /* shared by solo and online races: renderer, camera, minimap */
  function setupScene(R, track, weather, humanId, mp) {
    G.ghost = null; G.ghostPose = null; G.rec = null; G.ttDelta = null;
    G.race = R; G.human = R.byId[humanId]; G.mp = !!mp; G.resultsShown = false; G.waitingShown = false; G.finishAt = 0; G.acc = 0; G.lastCount = 99; G.raceCount++;
    G.autoWeather = weather;
    if (!G.renderer) initRenderer();
    G.renderer.weatherName = weather;
    G.renderer.loadTrack(track, R);
    G.renderer.setWeather(weather, true);
    G.renderer.cam.snap = true; G.renderer.snapKarts();
    // first frame placement of the camera
    G.renderer.updateCamera(viewOf(G.human, 1), 0.016);
    $('hudBest').textContent = '--:--.---'; G.hud = {};
    G.drawMini = makeMinimap(track);
    buildPauseSelects();
    $('btnWeather').textContent = WEATHER_ICON[weather];
    $('btnWeather').hidden = !!mp; $('pRestart').hidden = !!mp;
  }
  function revealHud() {
    document.documentElement.classList.add('kl-race');
    if (G.gesture) G.audio.start();
    G.last = performance.now();
  }

  /* ---------- online races (phase 2): the lobby hand-shake calls these ---------- */
  function mpBegin(start, L) {
    return new Promise((resolve, reject) => {
      KL.ensureTrack(start.track).then(() => new Promise((r) => setTimeout(r, 30))).then(() => { beginMpRace(start, L); resolve(); }).catch((e) => { console.error(e); reject(e); });
    });
  }
  function beginMpRace(start, L) {
    const track = getTrack(start.track); G.track = track;
    const grid = start.grid.slice().sort((a, b) => a.slot - b.slot);
    const defs = grid.map((g, i) => {
      const drv = KL.DRIVERS.find((d) => d.id === g.drv) || KL.DRIVERS[0];
      const base = { id: String(g.id).slice(0, 12), name: String(g.name).slice(0, 14), driver: drv, gridSlot: i };
      if (g.human) return { ...base, human: true, remote: g.id !== L.myId };
      return { ...base, isBot: true, remote: L.role !== 'host', botSkill: +g.skill || 1, lanePref: +g.lane || 0 };
    });
    if (start.gp && KL.CUPS.some((c) => c.id === start.gp.cup)) {      // online Grand Prix: every client keeps the same table (from the shared results)
      const prev = G.session && G.session.kind === 'gp' && G.session.online && start.gp.idx > 0 ? G.session : null;
      G.session = { kind: 'gp', online: true, cup: start.gp.cup, idx: Math.max(0, start.gp.idx | 0), n: Math.max(1, Math.min(8, start.gp.n | 0)), table: prev ? prev.table : {}, names: prev ? prev.names : {}, done: false };
    } else G.session = { kind: 'race' };
    const R = KL.createRace({ track, karts: defs, laps: start.laps, difficulty: start.diff, weather: start.weather, seed: start.seed, mode: 'online' });
    setupScene(R, track, start.weather, L.myId, true);
    KL.MP.attach(R, start, L);
    G.state = 'mpload';
  }
  function mpReveal() {
    $('loading').hidden = true; showOnly(null);
    G.state = 'race'; G.paused = false; KL.input.setEnabled(true);
    revealHud();
    showToast(KL.t('hintDrift'), 3000);
  }
  function mpClosed() { G.mp = false; G.state = 'lobby'; G.waitingShown = false; KL.input.setEnabled(false); G.audio.silence(); document.documentElement.classList.remove('kl-race'); }
  function fillResultList(rows) {
    const ol = $('endList'); ol.textContent = '';
    rows.forEach((r) => {
      const li = document.createElement('li'); const mine = G.human && r.id === G.human.id; if (mine) li.className = 'me';
      const a = document.createElement('b'); a.textContent = r.place + '.';
      const n = document.createElement('span'); n.textContent = dispName(r.name, mine);
      const t = document.createElement('span'); t.textContent = r.finished ? fmtTime(r.time) : KL.t('dnf');
      const bl = document.createElement('small'); bl.textContent = r.best ? '⏱ ' + fmtTime(r.best) : '';
      li.append(a, n, t, bl); ol.appendChild(li);
    });
  }
  function mpButtons(final) {
    $('eAgain').hidden = true; $('eNext').hidden = true; $('eMenu').textContent = KL.t('menu'); $('endNote').textContent = '';
    $('eLobby').hidden = !(final && KL.Lobby.role === 'host' && KL.Lobby.originalHost && KL.Lobby.links.size > 0);
  }
  /* online Grand Prix: points from the shared results, table, next race (host) or the final standings */
  function mpGpResults(rows, me, note) {
    const ss = G.session, ol = $('endList'); ol.textContent = '';
    ss.table = KL.gpAward(ss.table, rows.map((r) => ({ driver: r.drv, place: r.place })));
    rows.forEach((r) => { ss.names[r.drv] = r.name; });
    const last = ss.idx >= ss.n - 1, rank = KL.gpRanking(ss.table), myDrv = G.human.driver.id;
    const host = KL.Lobby.role === 'host' && KL.Lobby.originalHost && KL.Lobby.links.size > 0;
    rank.forEach((r) => ol.appendChild(resultLi(r.rank + '.', dispName(ss.names[r.driver] || r.driver, r.driver === myDrv), r.pts + ' ' + KL.t('gpPts'), r.driver === myDrv ? '+' + (KL.GP_POINTS[me.place - 1] || 0) : '', r.driver === myDrv)));
    $('endTitle').textContent = last ? KL.t('gpFinal') : KL.t('gpTable') + ' · ' + KL.t('gpRace', { n: ss.idx + 1, m: ss.n });
    $('endSub').textContent = KL.t('gpPlace', { n: me.place, p: KL.GP_POINTS[me.place - 1] || 0 }) + ' · ' + KL.t('raceTime') + ' ' + fmtTime(me.time);
    let extra = '';
    if (last) {
      ss.done = true;
      const won = rank[0].driver === myDrv;
      extra = won ? KL.t('gpWon') + ' ' + KL.t('gpWins', { n: KL.Progress.onGpWon() }) : KL.t('gpRank', { n: rank.findIndex((r) => r.driver === myDrv) + 1 });
      KL.Boards.select('lap', G.track.id);
    } else if (host) { $('eNext').hidden = false; $('eNext').textContent = KL.t('gpNext'); }
    else extra = KL.t('lbWaitHost');
    $('endNote').textContent = [extra, note].filter(Boolean).join('  ');
    return last;
  }
  function showMpWaiting(R) {
    if (G.resultsShown || G.waitingShown) return;
    G.waitingShown = true; showOnlyOverlay('endScreen'); mpButtons(false);
    $('endTitle').textContent = KL.t('resultsOnline'); updateMpWaiting(R);
  }
  function updateMpWaiting(R) {
    if (G.resultsShown) return;
    const fin = R.karts.filter((k) => k.human && k.finished).length, tot = R.karts.filter((k) => k.human).length;
    $('endSub').textContent = KL.t('waitOthers', { n: fin, m: tot });
    const rows = KL.standings(R).map((r) => ({ id: r.id, name: r.name, finished: r.finished, time: r.time, best: r.bestLap, place: r.place }));
    fillResultList(rows);
  }
  function mpShowResults(rows) {
    if (G.resultsShown) return;
    G.resultsShown = true; G.waitingShown = true;
    showOnlyOverlay('endScreen'); mpButtons(true);
    $('endTitle').textContent = KL.t('resultsOnline');
    fillResultList(rows);
    const me = rows.find((r) => G.human && r.id === G.human.id) || rows[0];
    $('endSub').textContent = KL.t('raceTime') + ' ' + fmtTime(me.time) + ' · ' + KL.t('bestLap') + ' ' + fmtTime(me.best) + ' · ' + KL.t('place') + ' ' + me.place + '/' + rows.length;
    const note = G.human && G.human.finished ? recordRace() : '';
    $('endNote').textContent = note;
    if (G.session && G.session.kind === 'gp' && G.session.online && G.human) { const last = mpGpResults(rows, me, note); if (!last) $('eLobby').hidden = true; }
    G.lastResult = { rows, me };
  }
  KL.G.mpBegin = mpBegin; KL.G.mpReveal = mpReveal; KL.G.mpClosed = mpClosed; KL.G.mpShowResults = mpShowResults; KL.G.mpEnded = (key, vars) => KL.lobbyFail(key, vars);
  KL.G.toast = showToast; KL.G.openMenu = () => openMenu();
  function doRescue() { if (!G.race || !G.human) return; G.race.rescue(G.human); G.human.tpc = (G.human.tpc | 0) + 1; }

  function viewOf(k, alpha) {
    const v = G.view || (G.view = {});
    v.x = k.ix != null ? k.ix : k.x; v.y = k.iy != null ? k.iy : k.y; v.z = k.iz != null ? k.iz : k.z; v.yaw = k.iyaw != null ? k.iyaw : k.yaw;
    v.vx = k.vx; v.vz = k.vz; v.speed = k.speed; v.boostT = k.boostT; v.drift = k.drift; v.grounded = k.grounded;
    return v;
  }

  function fatal(text) { $('fatalText').textContent = text; showOnly('fatal'); }

  function initRenderer() {
    G.autoQ = detectQuality();
    G.renderer = new KL.Renderer($('world'), { quality: effQuality() });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($('game'));
  }
  function onResize() {
    layoutTouch();
    if (G.renderer) G.renderer.resize();
  }
  function layoutTouch() {
    const touch = document.documentElement.classList.contains('kl-touch');
    const h = window.innerHeight, portrait = window.innerHeight > window.innerWidth;
    $('hud').style.setProperty('--touch-h', touch ? clamp(Math.round(h * (portrait ? 0.3 : 0.42)), 150, 300) + 'px' : '0px');
  }

  /* ---------- toasts / countdown ---------- */
  function showToast(text, ms) {
    const t = $('toast'); t.textContent = text; t.classList.add('on'); G.toastT = performance.now() + (ms || 1600);
  }
  function popCountdown(text) {
    const c = $('countdown'); c.textContent = text; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  }

  /* ---------- events ---------- */
  function handleEvents(R) {
    const me = G.human, rd = G.renderer, a = G.audio;
    for (const e of R.events) {
      const mine = !!me && e.id === me.id;
      const camD = e.x != null ? Math.hypot(e.x - rd.cam.x, e.z - rd.cam.z) : 0;
      switch (e.t) {
        case 'go': a.sfx('go'); popCountdown(KL.t('go')); break;
        case 'rocketstart': if (mine) { showToast(KL.t('rocketStart'), 1400); } a.sfx('rocketstart', { near: mine }); break;
        case 'box': if (mine) a.sfx('box'); break;
        case 'itemget': if (mine) a.sfx('itemget'); break;
        case 'shoot': case 'drop': a.sfx(e.t, { near: mine }); break;
        case 'boost': case 'pad': a.sfx(e.t, { near: mine }); break;
        case 'miniturbo': if (mine) a.sfx('miniturbo', { level: e.level }); break;
        case 'driftlevel': if (mine) a.sfx('driftlevel', { level: e.level }); break;
        case 'shield': a.sfx('shield', { near: mine }); break;
        case 'shieldpop': a.sfx('shieldpop', { near: mine }); break;
        case 'hit': { a.sfx('hit', { near: mine }); if (mine) { rd.shake = Math.max(rd.shake, 0.5); } break; }
        case 'boom': if (camD < 120) { rd.burst(e.x, e.y, e.z, e.kind); a.sfx('boom', { near: camD < 25 }); } break;
        case 'splat': break;
        case 'bump': if (camD < 40) a.sfx('bump', { near: e.id === me.id || e.id2 === me.id }); break;
        case 'wall': if (mine) { a.sfx('wall'); rd.shake = Math.max(rd.shake, Math.min(0.35, e.power * 0.02)); } break;
        case 'land': if (mine) a.sfx('land'); break;
        case 'comet': a.sfx('comet', { near: true }); break;
        case 'lap': if (mine) {
          a.sfx('lap');
          if (e.lap < R.laps) showToast((e.lap + 1 === R.laps ? KL.t('lastlap') : KL.t('lap') + ' ' + (e.lap + 1) + '/' + R.laps) + (e.best && e.lap > 1 ? ' · ' + KL.t('newbest') : '') + (G.ttDelta != null ? ' · ' + (G.ttDelta <= 0 ? '−' : '+') + Math.abs(G.ttDelta).toFixed(2) + ' s ' + KL.t(G.ttDelta <= 0 ? 'ttAhead' : 'ttBehind') : ''), 2200);
          $('hudBest').textContent = fmtTime(me.bestLap);
        } break;
        case 'finish': if (mine) { a.sfx('finish'); showToast(KL.t('fin') + ' ' + KL.t('place') + ' ' + e.place, 2400); rd.confetti(me.x, me.y, me.z); G.finishAt = performance.now(); } break;
        case 'rescue': if (mine) { a.sfx('rescue'); rd.snapKarts(); rd.cam.snap = true; } break;
      }
    }
    R.events.length = 0;
  }

  /* ---------- HUD ---------- */
  const ITEM_ICONS = ['🛢️', '🔵', '🚀', '🛡️', '⚡', '☄️'];
  function setText(id, v) { if (G.hud[id] !== v) { G.hud[id] = v; $(id).textContent = v; } }
  function updateHud(R, now) {
    const k = G.human; if (!k) return;
    setText('hudPos', String(k.place)); setText('hudPosOf', '/' + R.karts.length);
    const lapN = clamp(k.lapIdx + 1, 1, R.laps);
    setText('hudLap', lapN + '/' + R.laps);
    const t = R.clock < 0 ? 0 : (k.finished ? k.finishTime : R.clock - (k.lapIdx >= 0 ? 0 : 0));
    setText('hudTime', fmtTime(Math.max(0, k.finished ? k.finishTime : R.clock)));
    setText('hudSpeed', String(Math.round(k.speed * 3.6)));
    const slot = $('itemSlot');
    if (k.roll) { slot.classList.add('roll', 'has'); const ic = ITEM_ICONS[Math.floor(now / 90) % ITEM_ICONS.length]; setText('itemIcon', ic); setText('itemCount', ''); setText('itemName', ''); }
    else if (k.item) { slot.classList.remove('roll'); slot.classList.add('has'); setText('itemIcon', KL.ITEMS[k.item.id].icon); setText('itemCount', k.item.count > 1 ? '×' + k.item.count : ''); setText('itemName', KL.t('item_' + k.item.id)); }
    else { slot.classList.remove('roll', 'has'); setText('itemIcon', ''); setText('itemCount', ''); setText('itemName', ''); }
    $('wrongWay').hidden = !(k.wrongT > 1.2 && !k.finished);
    const comet = R.items.find((i) => i.type === 'comet' && i.target === k.id);
    $('cometWarn').hidden = !comet;
    if (G.toastT && now > G.toastT) { $('toast').classList.remove('on'); G.toastT = 0; }
    // countdown digits
    if (R.phase === 'countdown') {
      const n = Math.ceil(-R.clock);
      if (R.clock < -0.05 && n <= 3 && n !== G.lastCount) { G.lastCount = n; popCountdown(String(n)); G.audio.sfx('beep', { high: false }); }
    }
    if (G.drawMini) G.drawMini(R);
  }

  function makeMinimap(track) {
    const cv = $('minimap'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const off = document.createElement('canvas'); off.width = W; off.height = H; const og = off.getContext('2d');
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < track.N; i++) { x0 = Math.min(x0, track.X[i]); x1 = Math.max(x1, track.X[i]); z0 = Math.min(z0, track.Z[i]); z1 = Math.max(z1, track.Z[i]); }
    const pad = 18, sc = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oz = (H - (z1 - z0) * sc) / 2 - z0 * sc;
    og.lineJoin = 'round'; og.lineCap = 'round';
    const path = () => { og.beginPath(); for (let i = 0; i <= track.N; i++) { const j = i % track.N; const x = track.X[j] * sc + ox, z = track.Z[j] * sc + oz; if (i) og.lineTo(x, z); else og.moveTo(x, z); } };
    path(); og.strokeStyle = '#000a'; og.lineWidth = 13; og.stroke(); path(); og.strokeStyle = '#e9edf7'; og.lineWidth = 8; og.stroke();
    const sx = track.X[0] * sc + ox, sz = track.Z[0] * sc + oz; og.fillStyle = '#ffd23f'; og.fillRect(sx - 6, sz - 3, 12, 6);
    return (R) => {
      g.clearRect(0, 0, W, H); g.drawImage(off, 0, 0);
      for (const k of R.karts) { if (k === G.human) continue; g.fillStyle = k.driver.body; g.beginPath(); g.arc(k.x * sc + ox, k.z * sc + oz, 5, 0, 7); g.fill(); g.strokeStyle = '#000a'; g.lineWidth = 1.5; g.stroke(); }
      const h = G.human; g.fillStyle = '#ffd23f'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(h.x * sc + ox, h.z * sc + oz, 8, 0, 7); g.fill(); g.stroke();
      const a = h.yaw; g.beginPath(); g.moveTo(h.x * sc + ox + Math.sin(a) * 15, h.z * sc + oz + Math.cos(a) * 15); g.lineTo(h.x * sc + ox + Math.sin(a + 2.6) * 9, h.z * sc + oz + Math.cos(a + 2.6) * 9); g.lineTo(h.x * sc + ox + Math.sin(a - 2.6) * 9, h.z * sc + oz + Math.cos(a - 2.6) * 9); g.closePath(); g.fillStyle = '#fff'; g.fill();
    };
  }

  /* ---------- results ---------- */
  const dispName = (name, mine) => (mine && name !== KL.t('you') ? name + ' (' + KL.t('you') + ')' : name);
  function resultLi(rank, name, mid, small, mine) {
    const li = document.createElement('li'); if (mine) li.className = 'me';
    const a = document.createElement('b'); a.textContent = rank;
    const n = document.createElement('span'); n.textContent = name;
    const t = document.createElement('span'); t.textContent = mid;
    const bl = document.createElement('small'); bl.textContent = small || '';
    li.append(a, n, t, bl); return li;
  }
  /* personal records + leaderboards for the human's finished race (solo and online): returns the note shown under the result */
  function recordRace() {
    const R = G.race, k = G.human; if (!R || !k) return '';
    const res = KL.Progress.onRaceDone({ track: G.track.id, laps: R.laps, lapTimes: k.lapTimes.filter(isFinite), finished: k.finished, time: k.finishTime });
    return [res.lap ? '⏱ ' + KL.t('newBestLap') : '', res.race ? '🏁 ' + KL.t('newBestRace') : ''].filter(Boolean).join('  ');
  }
  function endButtons(o) {
    $('eAgain').hidden = !!o.noAgain; $('eLobby').hidden = true;
    $('eNext').hidden = !o.next; if (o.next) $('eNext').textContent = o.next;
    $('eMenu').textContent = KL.t(o.menuKey || 'menu');
  }
  function showResults() {
    const R = G.race; if (G.resultsShown) return; G.resultsShown = true;
    const ss = G.session || { kind: 'race' };
    $('endSub').textContent = KL.t('calc'); $('endNote').textContent = ''; $('endList').textContent = ''; showOnlyOverlay('endScreen');
    endButtons({}); $('endTitle').textContent = KL.t('results');
    setTimeout(() => {
      R.fastForward(150);
      const rows = KL.standings(R), me = rows.find((r) => r.human), ol = $('endList'); ol.textContent = '';
      const note = recordRace();
      if (ss.kind === 'tt') {
        const best = Math.min(...G.human.lapTimes);
        G.human.lapTimes.forEach((t, i) => ol.appendChild(resultLi(i + 1 + '.', KL.t('lap') + ' ' + (i + 1), fmtTime(t), t === best ? '⭐' : '', t === best)));
        $('endTitle').textContent = KL.t('tt');
        $('endSub').textContent = KL.t('raceTime') + ' ' + fmtTime(me.time) + ' · ' + KL.t('bestLap') + ' ' + fmtTime(me.bestLap) + (G.ghost ? ' · 👻 ' + fmtTime(G.ghost.sec) : '');
      } else if (ss.kind === 'gp') {
        ss.table = KL.gpAward(ss.table, rows.map((r) => ({ driver: r.driver.id, place: r.place })));
        rows.forEach((r) => { ss.names[r.driver.id] = dispName(r.name, r.human); });
        const last = ss.idx === ss.races.length - 1, rank = KL.gpRanking(ss.table), myDrv = G.human.driver.id;
        rank.forEach((r) => ol.appendChild(resultLi(r.rank + '.', ss.names[r.driver] || r.driver, r.pts + ' ' + KL.t('gpPts'), r.driver === myDrv ? '+' + (KL.GP_POINTS[me.place - 1] || 0) : '', r.driver === myDrv)));
        $('endTitle').textContent = last ? KL.t('gpFinal') : KL.t('gpTable') + ' · ' + KL.t('gpRace', { n: ss.idx + 1, m: ss.races.length });
        $('endSub').textContent = KL.t('gpPlace', { n: me.place, p: KL.GP_POINTS[me.place - 1] || 0 }) + ' · ' + KL.t('raceTime') + ' ' + fmtTime(me.time);
        if (last) {
          ss.done = true;
          const won = rank[0].driver === myDrv;
          const gpNote = won ? KL.t('gpWon') + ' ' + KL.t('gpWins', { n: KL.Progress.onGpWon() }) : KL.t('gpRank', { n: rank.findIndex((r) => r.driver === myDrv) + 1 });
          KL.Boards.select('lap', G.track.id);
          $('endNote').textContent = [gpNote, note].filter(Boolean).join('  ');
          endButtons({ menuKey: 'menu' });
          G.lastResult = { rows, me, gp: rank };
          return;
        }
        endButtons({ noAgain: true, next: KL.t('gpNext'), menuKey: 'gpLeave' });
      } else {
        rows.forEach((r) => ol.appendChild(resultLi(r.place + '.', dispName(r.name, r.human), r.finished ? fmtTime(r.time) : KL.t('dnf'), r.bestLap ? '⏱ ' + fmtTime(r.bestLap) : '', r.human)));
        $('endSub').textContent = KL.t('raceTime') + ' ' + fmtTime(me.time) + ' · ' + KL.t('bestLap') + ' ' + fmtTime(me.bestLap) + ' · ' + KL.t('place') + ' ' + me.place + '/' + rows.length;
      }
      $('endNote').textContent = note;
      G.lastResult = { rows, me };
    }, 60);
  }
  function showOnlyOverlay(name) { for (const id of ['pauseScreen', 'endScreen']) $(id).hidden = id !== name; }

  /* ---------- pause ---------- */
  function setPaused(p) {
    if (G.state !== 'race') return;
    if (G.mp) { $('pauseScreen').hidden = !p; G.audio.silence(); KL.input.setEnabled(!p); if (p) buildPauseSelects(); return; }   // online: the race goes on
    G.paused = p; $('pauseScreen').hidden = !p; G.audio.silence(); KL.input.setEnabled(!p);
    if (p) buildPauseSelects();
    G.last = performance.now();
  }

  /* ---------- weather cycle ---------- */
  function cycleWeather() {
    if (!G.renderer || !G.race || G.mp) return;
    const list = weathersFor(G.settings.track), cur = list.indexOf(G.renderer.weatherName);
    setWeather(list[(cur + 1) % list.length]);
  }
  function setWeather(w) { G.renderer.setWeather(w); G.race.weather.name = w; G.race.weather.wet = KL.WEATHER[w].wet; $('btnWeather').textContent = WEATHER_ICON[w]; showToast(WEATHER_ICON[w] + ' ' + KL.t('w_' + w), 1100); }

  /* ---------- main loop ---------- */
  const inputScratch = {}; let itemLatch = false;
  KL.input.on('itemkey', () => { itemLatch = true; });

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0.0001, (ts - (G.last || ts)) / 1000)); G.last = ts;
    G.frame++;
    if (!G.renderer || G.state !== 'race' || !G.race) return;
    const R = G.race, mp = G.mp;
    if (mp) KL.MP.tick(ts);
    if (!G.paused) {
      G.acc += dt;
      let n = 0;
      const k = G.human;
      if (R.hold) G.acc = 0;
      while (G.acc >= C.STEP && n < 6) {
        applyPlayerInput(k);
        R.step(C.STEP); G.acc -= C.STEP; n++; G.steps++;
        if (mp) KL.MP.afterStep(R); else afterStep(R);
        itemLatch = false;
      }
      if (n === 6) G.acc = 0;
      if (mp) KL.MP.flush();
      handleEvents(R);
    }
    const alpha = G.paused ? 1 : G.acc / C.STEP;
    G.renderer.syncRace(R, alpha, G.paused ? 0 : dt);
    if (G.ghost) updateGhostPose(R, alpha);
    if (G.camOverride) { const o = G.camOverride, cm = G.renderer.camera; cm.position.set(o.x, o.y, o.z); cm.lookAt(o.lx, o.ly, o.lz); if (o.fov && cm.fov !== o.fov) { cm.fov = o.fov; cm.updateProjectionMatrix(); } G.renderer.cam.x = o.x; G.renderer.cam.z = o.z; G.renderer.cam.y = o.y; }
    else G.renderer.updateCamera(viewOf(G.human, alpha), G.paused ? 0 : dt, { rear: G.rear });
    updateHud(R, ts);
    if (G.mp) { const slow = [...KL.Lobby.links.values()].some((l) => l.kind === 'relay'); if (G.hud.slow !== slow) { G.hud.slow = slow; $('netBadge').hidden = !slow; $('netBadge').textContent = '🐢 ' + KL.t('pSlow'); } }
    if (!G.paused) G.audio.update(G.human, { racing: R.phase !== 'countdown', rain: G.renderer.W && G.renderer.W.rain, paused: false });
    if (G.human.roll && G.audio.throttle('rollsfx', 90)) G.audio.sfx('roll');
    G.renderer.render(G.paused ? 0 : dt);
    adaptQuality(dt);
    if (G.human.finished && !G.resultsShown && performance.now() - G.finishAt > 2600) { if (G.mp) showMpWaiting(R); else showResults(); }
    if (G.mp && G.waitingShown && ts - (G.waitT || 0) > 500) { G.waitT = ts; updateMpWaiting(R); }
  }

  function applyPlayerInput(k) {
    if (!k || k.auto) return;
    const inp = KL.input.read(inputScratch);
    const f = G.forced;
    k.input.steer = f && f.steer != null ? f.steer : inp.steer; k.input.gas = f && f.gas != null ? f.gas : inp.gas; k.input.brake = f && f.brake != null ? f.brake : inp.brake;
    k.input.drift = f && f.drift != null ? f.drift : inp.drift; k.input.item = (f && f.item != null ? f.item : inp.item) || itemLatch;
    if (G.race.phase === 'countdown' && f && f.gas != null) k.input.gas = f.gas;
  }

  /* adaptive resolution (auto quality only) */
  function adaptQuality(dt) {
    if (G.settings.quality !== 'auto' || G.paused) return;
    G.fpsAvg = G.fpsAvg * 0.95 + dt * 1000 * 0.05;
    G.qT = (G.qT || 0) + dt;
    if (G.qT < 2.5) return;
    G.qT = 0;
    const r = G.renderer;
    if (G.fpsAvg > 21 && (r.dprScale || 1) > 0.6) { r.dprScale = Math.max(0.6, (r.dprScale || 1) - 0.15); r.resize(); }
    else if (G.fpsAvg > 24 && G.autoQ !== 'low') { G.lowStreak++; if (G.lowStreak > 1) { G.autoQ = G.autoQ === 'high' ? 'medium' : 'low'; r.setQuality(G.autoQ); G.lowStreak = 0; } }
    else if (G.fpsAvg < 12.5 && (r.dprScale || 1) < 1) { r.dprScale = Math.min(1, (r.dprScale || 1) + 0.1); r.resize(); }
  }

  /* ---------- boot ---------- */
  function boot() {
    loadSettings();
    KL.Save.load();
    try { if (window.parent !== window) window.parent.postMessage({ __pbWantSave: 1 }, '*'); } catch (e) { /* standalone */ }
    KL.setLang(KL.lang());
    if (matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0) document.documentElement.classList.add('kl-touch');
    window.addEventListener('pointerdown', (e) => { G.gesture = true; if (e.pointerType === 'touch' && !document.documentElement.classList.contains('kl-touch')) { document.documentElement.classList.add('kl-touch'); layoutTouch(); } G.audio.start(); }, { capture: true });
    window.addEventListener('keydown', () => { G.gesture = true; G.audio.start(); }, { capture: true });
    KL.input.bindTouch($('touch'));
    layoutTouch();
    G.autoQ = detectQuality();
    document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { KL.setLang(b.dataset.lang); translate(); }));
    translate();
    $('btnStart').addEventListener('click', () => { G.audio.start(); startSelected(); });
    for (const [m, id] of [['race', 'modeRace'], ['gp', 'modeGp'], ['tt', 'modeTt']]) $(id).addEventListener('click', () => { G.settings.mode = m; saveSettings(); buildMenuChips(); G.audio.sfx('click'); });
    $('btnBoards').addEventListener('click', openBoardsDlg);
    $('bdClose').addEventListener('click', () => { $('bdScreen').hidden = true; });
    $('bdShow').addEventListener('click', () => KL.Boards.open(BD.kind, BD.track));
    $('btnPause').addEventListener('click', () => setPaused(true));
    $('btnWeather').addEventListener('click', cycleWeather);
    $('btnReset').addEventListener('click', doRescue);
    $('pResume').addEventListener('click', () => setPaused(false));
    $('pRestart').addEventListener('click', () => { $('pauseScreen').hidden = true; startRace({ seed: null }); });
    $('pQuit').addEventListener('click', () => { $('pauseScreen').hidden = true; if (G.mp) { KL.MP.leave(); } openMenu(); });
    $('pWeather').addEventListener('change', (e) => setWeather(e.target.value));
    $('pQuality').addEventListener('change', (e) => { G.settings.quality = e.target.value; saveSettings(); if (G.renderer) { G.renderer.dprScale = 1; G.renderer.setQuality(effQuality()); } });
    $('pGas').addEventListener('change', (e) => { G.settings.autoGas = e.target.value === '1'; KL.input.setAutoGas(G.settings.autoGas); saveSettings(); });
    $('eAgain').addEventListener('click', () => {
      $('endScreen').hidden = true;
      if (G.session && G.session.kind === 'gp') G.session = newGp(G.settings.cup);       // a finished Grand Prix: play the cup again
      startRace({ seed: null });
    });
    $('eNext').addEventListener('click', () => {
      $('endScreen').hidden = true;
      if (G.session && G.session.online) { KL.gpNext(); return; }
      if (G.session && G.session.kind === 'gp') G.session.idx++;
      startRace({ seed: null });
    });
    $('eMenu').addEventListener('click', () => { $('endScreen').hidden = true; if (G.mp) KL.MP.leave(); openMenu(); });
    $('eLobby').addEventListener('click', () => { $('endScreen').hidden = true; if (KL.backToLobby) KL.backToLobby(); });
    $('modeOnline').addEventListener('click', () => KL.openOnline());
    KL.initLobbyUi();
    KL.input.setAutoGas(G.settings.autoGas);
    KL.input.on('pause', () => { if (G.state === 'race') setPaused(!G.paused); });
    KL.input.on('weather', cycleWeather);
    KL.input.on('reset', () => G.race && !G.paused && G.race.phase !== 'countdown' && !G.race.hold && doRescue());
    KL.input.on('rear', (v) => { G.rear = !!v; });
    KL.input.on('mute', () => { document.querySelector('.arcade-bar__button[aria-label*="ute" i], .arcade-bar__button')?.click?.(); });
    if (window.Arcade && Arcade.onMute) Arcade.onMute((m) => G.audio.setMuted(m));
    try { initRenderer(); } catch (e) { console.error(e); fatal(KL.t('engineError')); return; }
    $('loading').hidden = true;
    const auto = TEST && params.get('autostart') === '1';
    if (auto) {
      const o = { track: params.get('track') || undefined, weather: params.get('weather') || undefined, diff: params.get('diff') || undefined, laps: params.get('laps') ? +params.get('laps') : undefined, bots: params.get('bots') != null ? +params.get('bots') : undefined, seed: params.get('seed') ? +params.get('seed') : 7 };
      const m = params.get('mode');
      if (m === 'tt') G.session = { kind: 'tt' }; else if (m === 'gp') { G.settings.cup = params.get('cup') || G.settings.cup; G.session = newGp(G.settings.cup); }
      startRace(o);
    } else openMenu();
    requestAnimationFrame(frame);
    installTestHooks();
    if (!auto) KL.runPendingRoom();
  }

  function installTestHooks() {
    if (!TEST) return;
    window.__klTest = {
      G, KL,
      state: () => { const R = G.race, k = G.human; return { state: G.state, paused: G.paused, phase: R && R.phase, clock: R && R.clock, steps: G.steps, kart: k && { x: k.x, y: k.y, z: k.z, yaw: k.yaw, speed: k.speed, place: k.place, lap: k.lapIdx + 1, prog: k.prog, s: k.s, d: k.d, finished: k.finished, finishTime: k.finishTime, bestLap: k.bestLap, lapTimes: k.lapTimes, item: k.item && k.item.id, roll: !!k.roll, drift: k.drift.state, driftLevel: k.drift.level, boostT: k.boostT, spinT: k.spinT, surf: k.surf, grounded: k.grounded, wrongT: k.wrongT, rescued: k.rescued || 0, shieldT: k.shieldT }, weather: G.renderer && G.renderer.weatherName, quality: G.settings.quality, calls: G.renderer && G.renderer.renderer.info.render.calls, tris: G.renderer && G.renderer.renderer.info.render.triangles, results: !!G.resultsShown }; },
      start: (o) => { o = o || {}; G.session = o.kind === 'gp' ? newGp(o.cup || G.settings.cup) : { kind: o.kind || 'race' }; startRace(o); },
      save: () => KL.Save.data, session: () => G.session, boards: () => KL.Boards.sent.slice(), nextRace: () => $('eNext').click(), force: (f) => { G.forced = f; }, forceItem: (id, count) => { if (G.human) { G.human.item = { id, count: count || (KL.ITEMS[id].count || 1) }; G.human.roll = null; } },
      teleport: (s, d) => { const k = G.human; k.tpc = (k.tpc | 0) + 1; KL.placeKart(k, G.track, s, d || 0); k.prog = Math.floor(k.prog / G.track.length) * G.track.length + k.s; G.renderer.snapKarts(); G.renderer.cam.snap = true; },
      /* run the simulation without rendering (autopilot = the player gets the bot driver) */
      sim: (seconds, autopilot) => { const R = G.race; if (autopilot && G.human) G.human.auto = true; const n = Math.round(seconds / C.STEP); for (let i = 0; i < n; i++) { applyPlayerInput(G.human); R.step(C.STEP); G.steps++; afterStep(R); } handleEvents(R); return true; },
      mp: () => { const M = KL.MP; return { active: M.active, role: M.role, hostId: M.hostId, deputy: M.deputy, epoch: M.epoch, stats: M.stats, ended: M.ended, results: !!M.resultsDone, net: KL.netStats, rtt: M.rtt, links: [...KL.Lobby.links].map(([id, l]) => ({ id, kind: l.kind, open: l.open, rtt: l.rtt })), lobby: { phase: KL.Lobby.phase, role: KL.Lobby.role, code: KL.Lobby.code, signalling: KL.Lobby.signalling }, karts: G.race ? G.race.karts.map((k) => ({ id: k.id, name: k.name, human: k.human, bot: k.isBot, remote: k.remote, away: !!k.away, place: k.place, prog: k.prog, finished: k.finished, finishOrder: k.finishOrder, finishTime: k.finishTime, spinT: k.spinT })) : [] }; },
      /* sample own truth and the displayed remote karts every 20 ms (wall clock), for the sync-error analysis */
      mpRecord: (on) => { if (!on) { clearInterval(G._rec); const out = G._recOut || []; G._recOut = null; return out; } G._recOut = []; clearInterval(G._rec); G._rec = setInterval(() => { const R = G.race; if (!R) return; const me = G.human, t = performance.timeOrigin + performance.now(), views = {}; for (const k of R.karts) if (k !== me) { const v = k.view || k; views[k.id] = [v.x, v.z, k.x, k.z]; } G._recOut.push({ t, own: [me.x, me.z, me.speed], views }); }, 20); return true; },
      standings: () => KL.standings(G.race), races: () => G.race, weather: (w) => setWeather(w),
      camera: (o) => { G.camOverride = o; }, menu: () => openMenu(), pause: (p) => setPaused(p), results: () => showResults(), autopilot: (v) => { if (G.human) G.human.auto = !!v; },
    };
  }

  window.addEventListener('error', (e) => console.error('[Kart] uncaught', e.message));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
