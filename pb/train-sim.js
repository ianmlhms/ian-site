/* Lokféierer: game shell. Plain script, THREE global, modules on window.TS. Every module call is guarded. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const SAVE_KEY = 'pb_save_train-sim';
  /* Arcade-wide test mode: the arcade injects window.__pbTestMode = true before the game scripts run. Everything is unlocked
     in memory (both careers), nothing is ever saved or posted, no scores are reported. Without the flag nothing changes. */
  const ARCADE_TEST = window.__pbTestMode === true;
  const HOST_ORIGIN = new URL(document.baseURI).origin;
  const SIM_STEP = 1 / 60, MAX_SIM_STEPS = 40, MAX_FRAME_S = 0.25;
  const LEVER_REPEAT_MS = 180, LEVER_MIN = -8, LEVER_MAX = 5, LEVER_EB = -8, LEVER_BRAKE_MAX = -7;
  const CAMERAS = ['cab', 'chase', 'platform', 'orbit', 'inside'];   // 'inside' (key 5): the passenger saloon, Luxtram only; pressing 5 again cycles front / middle / rear
  const QUALITIES = ['high', 'medium', 'low'];
  const MODULES = ['config', 'copy', 'track', 'routes', 'infra', 'landscape', 'trains', 'cab', 'passengers', 'audio', 'career', 'menu'];
  const PHONE_MIN_SIDE = 600, PHONE_MIN_VIEW = 560;
  const TILE_WAIT_MAX_MS = 25000, AHEAD_LOAD_SHOW_S = 0.8;
  const WHEEL_RADIUS = 0.46, HUD_INTERVAL_S = 0.1, TOD_INTERVAL_S = 3;
  const PLATFORM_SPAWN_M = 650, PLATFORM_CLEAR_M = 120, END_EXCHANGE_MIN_S = 5, END_EXCHANGE_MAX_S = 34;
  const BOARD_BASE = { 1: 9, 2: 20, 3: 36 }, ALIGHT_RANGE = [0.22, 0.55];
  const CHASE_UP = 3.9, CHASE_SIDE = 3.4;
  const DEMO_ORBIT_RATE = 0.12;
  const TOAST_MAX = 2, CAB_FOV = 66, CAB_FOV_PORTRAIT_MAX = 100, CAB_FOV_FIT_HALF_DEG = 44, CAB_EYE_BACK_PORTRAIT_M = 0.18, CAB_PITCH_PORTRAIT = -0.2, CAB_DRAG_PX_PER_NOTCH = 18, SPAD_TOAST_COOLDOWN_MS = 1200;
  const GUIDE_KIND_KEYS = { stop: 'guideStop', limit: 'guideLimit', signal: 'guideSignal' };

  /* ------------------------------------------------------------ helpers */
  const $ = (id) => document.getElementById(id);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const lerp = (a, b, k) => a + (b - a) * k;
  const warned = new Set();
  function warn(ctx, error) {
    if (warned.has(ctx)) return;
    warned.add(ctx);
    console.warn('[Lokféierer] ' + ctx, error || '');
  }
  function safe(ctx, fn, fallback) {
    try { return fn(); } catch (error) { warn(ctx, error); return fallback; }
  }
  const has = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), TS) !== undefined;
  const readStore = (key) => safe('storage read ' + key, () => localStorage.getItem(key), null);
  const writeStore = (key, value) => safe('storage write ' + key, () => localStorage.setItem(key, value));
  const removeStore = (key) => safe('storage remove ' + key, () => localStorage.removeItem(key));
  let randSource = Math.random;   // test hook only: __tsTest.setSeed swaps in a seeded generator
  const rand = () => randSource();
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
  const clockText = (sec) => { const s = ((Math.floor(sec) % 86400) + 86400) % 86400; return pad2(s / 3600) + ':' + pad2((s % 3600) / 60); };
  /* clock shown to the player: the timetable clock plus the shift from an in-game time-of-day change (the timetable itself is relative and stays untouched) */
  const shownClock = (sec) => clockText(sec + (world && world.clockShift ? world.clockShift : 0));
  const clockSecText = (sec) => { const s = ((Math.floor(sec + (world && world.clockShift ? world.clockShift : 0)) % 86400) + 86400) % 86400; return pad2(s / 3600) + ':' + pad2((s % 3600) / 60) + ':' + pad2(s % 60); };
  const minSec = (sec) => { const d = Math.max(0, Math.ceil(sec)); return Math.floor(d / 60) + ':' + pad2(d % 60); };
  const delayText = (sec) => { const d = Math.round(sec), a = Math.abs(d); return (d < 0 ? '−' : '+') + Math.floor(a / 60) + ':' + pad2(a % 60); };
  const fmtInt = (n) => Math.round(n).toLocaleString(lang === 'en' ? 'en' : lang === 'de' ? 'de' : 'fr-LU').replace(/ | /g, ' ');

  /* ------------------------------------------------------------ i18n */
  let lang = (['lb', 'de', 'en'].includes(readStore('site_lang')) ? readStore('site_lang') : 'lb');
  function t(key, vars) {
    return safe('TS.t', () => (TS.t ? TS.t(key, vars) : key), key);
  }
  const nameOf = (obj) => (obj && typeof obj === 'object' ? obj[lang] || obj.lb || obj.en || '' : String(obj || ''));
  function setLanguage(next) {
    if (!['lb', 'de', 'en'].includes(next)) return;
    lang = next;
    writeStore('site_lang', lang);
    safe('TS.setLang', () => TS.setLang && TS.setLang(lang));
    if (TS) TS.lang = lang;
    document.documentElement.lang = lang;
    translateStatic();
    if (phase === 'menu') renderMenu();
    if (world) { buildStrip(); updateHud(true); refreshCamLabel(); }
  }
  function translateStatic() {
    document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
    $('nextLbl').textContent = t('hudNextStop');
    $('sumMenu').textContent = t('backToMenu');
    $('sumAgain').textContent = t('sumAgain');
    $('btnMenu').textContent = t('menuBtn'); $('btnMenu').title = t('menuBtnTitle');
    $('kbText').textContent = t('deviceKeyboardOnly');
    $('kbClose').textContent = t('deviceDismiss');
    $('phoneTitle').textContent = t('devicePhoneTitle');
    $('phoneText').textContent = t('devicePhoneBlock');
    $('phoneHint').textContent = t('devicePhoneHint');
    $('pauseQuality').textContent = t('quality') + ': ' + t(qualityKey(quality));
    $('btnQuality').textContent = 'Q · ' + qualityName();
    $('btnFast').title = t('fastTitle'); $('btnRev').title = t('reverseTitle');
    buildHelp();
    buildWxPop();
  }
  const qualityKey = (q) => (q === 'high' ? 'qualityHigh' : q === 'medium' ? 'qualityMedium' : 'qualityLow');
  const qualityName = () => t(qualityKey(quality));

  /* ------------------------------------------------------------ state */
  const isTouch = (navigator.maxTouchPoints || 0) > 0 || matchMedia('(pointer:coarse)').matches;
  let quality = readStore('ts_quality');
  if (!QUALITIES.includes(quality)) quality = isTouch ? 'medium' : 'high';
  let phase = 'boot';            // boot | menu | loading | running | paused | summary | transition
  let mode = 'career';           // career | endless
  const EMPTY_CAREER = { lifetime: 0, wallet: 0, owned: [], routes: [], train: '', route: '', upgrades: {}, best: {}, services: 0, endlessBest: 0 };
  let save = safe('career defaults', () => (ARCADE_TEST ? TS.career.unlockedAll() : TS.career.defaults()), { hints: true, tb: 0, career: 'rail', rail: { ...EMPTY_CAREER, owned: ['railcar'], routes: ['west'], train: 'railcar', route: 'west' }, tram: { ...EMPTY_CAREER, owned: ['tram'], routes: ['luxtram-stad'], train: 'tram', route: 'luxtram-stad' } });
  let muted = readStore('pb_muted') === '1';
  /* weather + time-of-day choice (menu and in-game popover), remembered per player in localStorage; 'random' = pick per service */
  const WX_IDS = TS.envChoices ? TS.envChoices.weather.map((o) => o.id) : ['random', 'clear', 'rain', 'fog', 'snow'];
  const TOD_IDS = TS.envChoices ? TS.envChoices.tod.map((o) => o.id) : ['random', 'morning', 'noon', 'evening', 'night'];
  const TOD_HOURS = { morning: 8, noon: 13, evening: 19.5, night: 22.5 };
  const WX_CYCLE = ['clear', 'rain', 'fog', 'snow'];
  const readChoice = (key, ids) => { const v = readStore(key); return ids.includes(v) ? v : 'random'; };
  let wxPref = readChoice('ts_weather', WX_IDS), todPref = readChoice('ts_tod', TOD_IDS);
  let paused = false, wasRunningBeforeHide = false;
  let renderer = null, scene = null, camera = null, clock = null;
  let world = null;              // { track, routeDef, cfg, trainId, routeId, infra, landscape, model, cab, passengers, sim, ... }
  let audio = null, audioFailed = false;
  let camMode = 'cab', camSmooth = { pos: null, look: null };
  let insidePos = 0;   // saloon camera: 0 front end looking back, 1 middle looking forward, 2 rear end looking forward
  const orbit = { yaw: 0.7, pitch: 0.28, dist: 30 }, look = { yaw: 0, pitch: 0 };
  /* camera 3 (trackside / platform) is movable: drag = look round (yaw free, pitch -60..+30 deg), wheel / pinch = zoom (field of view), arrow keys / the pad = walk along the platform.
     The view is kept while the player stays at the same stop (reset when the spot changes, or by pressing 3 again). */
  const PLAT_PITCH_MIN = -1.05, PLAT_PITCH_MAX = 0.52, PLAT_FOV0 = 54, PLAT_FOV_MIN = 24, PLAT_FOV_MAX = 85, PLAT_EYE = 1.6, PLAT_WALK_MS = 3.2;
  const platView = { yaw: 0, pitch: 0, fov: PLAT_FOV0, s: null, lat: null, vx: 0, vy: 0, keys: { left: false, right: false, in: false, out: false } };
  function resetPlatView() { platView.yaw = 0; platView.pitch = 0; platView.fov = PLAT_FOV0; platView.s = null; platView.lat = null; platView.vx = platView.vy = 0; if (camera && camMode === 'platform') applyCabFov(); }
  let fastForward = false;       // 2x fast-forward (F): physics, timetable clock and passengers run twice as fast
  const input = { lever: 0, doorPress: false, parkingToggle: false, reverseToggle: false, hornHeld: false, lights: null, held: { up: false, down: false }, lastRepeat: 0 };
  const events = [];             // recent event log for tests
  const endless = { order: [], index: 0, loops: 0, total: { cash: 0, points: 0 }, active: false };
  let frameHandle = 0, lastFrame = 0, hudClock = 0, todClock = 0, accum = 0, elapsedReal = 0;
  let toastWait = 0, demoAngle = 0, demoTimer = 0, scorePosted = 0, serviceStartedAt = 0;
  let testMode = false, errorsSeen = 0, forcedPlan = null, lastSpadToast = 0, calmServices = false;
  const settle = { sig: '', stable: 0 };   // test hook only: how many frames the camera has not moved

  /* ------------------------------------------------------------ device */
  function isPhone() {
    if (!isTouch) return false;
    const screenSide = Math.min(screen.width || 9999, screen.height || 9999);
    return screenSide < PHONE_MIN_SIDE || Math.min(innerWidth, innerHeight) < PHONE_MIN_VIEW;
  }
  function checkDevice() {
    const phone = isPhone();
    $('phoneBlock').hidden = !phone;
    if (phone && phase === 'running') pauseGame(true);
    if (phone) return;
    if (isTouch && !noticeDismissed) $('kbNotice').hidden = false;
    if (phase === 'boot') boot();
  }
  let noticeDismissed = false;
  function dismissNotice() { noticeDismissed = true; $('kbNotice').hidden = true; }

  /* ------------------------------------------------------------ renderer */
  function initRenderer() {
    if (renderer) return true;
    try {
      const canvas = $('world');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    } catch (error) {
      warn('WebGL failed', error);
      showError(t('webglMissing'));
      return false;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ab8d4);
    camera = new THREE.PerspectiveCamera(62, 1.6, 0.1, 6000);
    scene.add(camera);
    clock = new THREE.Clock();
    applyQuality();
    resize();
    new ResizeObserver(resize).observe($('game'));
    return true;
  }
  /* Cab view: in portrait the vertical FOV grows so the whole desk (lever gate and both door buttons) stays in frame. */
  const isPortrait = () => !!camera && camera.aspect < 1.25;
  function applyCabFov() {
    if (!camera) return;
    if (camMode === 'cab') {
      const fit = (2 * Math.atan(Math.tan((CAB_FOV_FIT_HALF_DEG * Math.PI) / 180) / Math.max(0.3, camera.aspect)) * 180) / Math.PI;
      camera.fov = camera.aspect < 1.4 ? clamp(fit, CAB_FOV, CAB_FOV_PORTRAIT_MAX) : CAB_FOV;
    } else camera.fov = camMode === 'chase' ? 58 : camMode === 'inside' ? 70 : camMode === 'platform' ? platView.fov : 54;
    camera.updateProjectionMatrix();
  }
  function applyQuality() {
    if (!renderer) return;
    const cap = quality === 'high' ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    renderer.shadowMap.enabled = quality !== 'low';
    resize();
  }
  function resize() {
    if (!renderer) return;
    const box = $('game').getBoundingClientRect();
    const w = Math.max(2, Math.floor(box.width)), h = Math.max(2, Math.floor(box.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyCabFov();
    checkDevice();
  }
  function showError(text) { $('errorText').textContent = text; $('errorScreen').hidden = false; }

  /* ------------------------------------------------------------ module access (all guarded) */
  const trainDef = (id) => safe('train def', () => TS.config.trains.find((tr) => tr.id === id), null) || safe('train def', () => TS.config.trains[0], null);
  function routeList() { return safe('routes', () => TS.routes.list, []) || []; }
  function routeDefOf(id) { return safe('route get', () => TS.routes.get(id), null) || routeList().find((r) => r.id === id) || routeList()[0] || null; }
  /* The career state (wallet, services, ...) of the career a vehicle belongs to; default: the one selected in the menu. */
  function careerState(trainId) {
    const cid = trainId ? safe('career of train', () => TS.career.careerOfTrain(trainId), null) : null;
    return save[cid || save.career] || save[save.career] || EMPTY_CAREER;
  }
  function effectiveTrain(trainId) {
    const base = trainDef(trainId) || { id: 'railcar', kind: 'rail', maxKmh: 90, accel: 0.55, brake: 0.8, emergency: 1.2, massT: 45, cars: 1, capacity: 90, doorsPerSide: 2, carLength: 22, cab: 'railcar', model: 'railcar', sound: 'diesel', livery: { body: '#a82a26', accent: '#e9dcc0', stripe: '#e9dcc0' } };
    return safe('applyUpgrades', () => TS.career.applyUpgrades(base, save), null) || base;
  }

  /* ------------------------------------------------------------ persistence */
  function postToHost(message) {
    if (parent === window) return;
    safe('post to arcade', () => parent.postMessage(message, HOST_ORIGIN));
  }
  let lastPersisted = '';
  function persist() {
    if (ARCADE_TEST) return;   // test mode: the unlocked-everything state must never reach any store
    const tb = Math.max(Number(save.tb) || 0, (Number(save.rail && save.rail.lifetime) || 0) + (Number(save.tram && save.tram.lifetime) || 0));
    const signature = safe('save sig', () => JSON.stringify({ ...save, tb, savedAt: 0 }), '');
    if (signature && signature === lastPersisted) return;     // nothing changed: never spend cloud egress on it
    lastPersisted = signature;
    save = { ...save, tb, savedAt: Date.now() };
    const clean = safe('save clean', () => JSON.parse(JSON.stringify(save)), null);
    if (!clean) return;
    if (parent === window) writeStore(SAVE_KEY, JSON.stringify(clean));
    else postToHost({ __pbSave: 1, data: clean });
  }
  function mergeIncoming(data) {
    if (ARCADE_TEST) return;   // never mix a real save into the unlocked test state
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const merged = safe('career merge', () => TS.career.merge(save, data), null);
    if (!merged) return;
    save = merged;
    if (phase === 'menu') renderMenu();
  }

  /* ------------------------------------------------------------ resume (a service saved while it runs)
     While a service runs, a small snapshot goes to localStorage (every few seconds, at every stop event, and when the page is hidden, frozen or
     closed). After a reload the menu offers "Weiderfueren": the same route, train, weather, plan, timetable, clock, passengers, records and
     endless run come back, the train standing still at the saved position with doors closed and the parking brake on. The sim clock only
     moves while the sim runs, so the time the page was away is never delay. Nothing is credited or posted on resume; the snapshot also
     remembers how many services the career had finished, so a service that was paid after it was written can never be resumed (no double credit).
     The storage key is not on the arcade test mode's pass-through list: test mode writes (and reads) its own copy, never the real one. */
  const SNAPSHOT_INTERVAL_MS = 5000, SNAPSHOT_ARM_M = 30;
  let resumeOffer = null, resumeDismissed = false, resumeFocusDone = false;
  let snapshotArmed = false, snapshotDue = false, snapshotWrites = 0;
  const resumeKey = () => (TS.resume ? TS.resume.KEY : '');

  /* the stored snapshot if it is valid right now (version, age, route/train exist and are owned in that career, no later service paid, ...) */
  function readSnapshot() {
    if (!TS.resume) return null;
    const raw = readStore(resumeKey());
    if (!raw) return null;
    const res = safe('resume check', () => TS.resume.check(raw, { now: Date.now(), save, testMode: ARCADE_TEST }), { reject: 'check failed' });
    if (res.snap) return res.snap;
    console.warn('[Lokféierer] saved service ignored: ' + res.reject);
    if (!res.keep) removeStore(resumeKey());
    return null;
  }
  function discardSnapshot() {
    if (TS.resume) removeStore(resumeKey());
    resumeOffer = null; snapshotDue = false;
  }
  function nearestStationName(sPos) {
    const list = stationsOf();
    let best = null;
    for (const st of list) if (!best || Math.abs(st.s - sPos) < Math.abs(best.s - sPos)) best = st;
    return best ? (typeof best.name === 'string' ? best.name : nameOf(best.name)) : '';
  }

  function snapshotReady() {
    const w = world;
    return !!(TS.resume && w && !w.demo && !w.finished && w.state && phase === 'running' && !rebuilding && snapshotArmed);
  }
  function buildSnapshot() {
    const w = world;
    if (!w || w.demo || !w.state || !TS.resume) return null;
    const c = careerState(w.trainId), st = w.state, sim = w.sim.snapshot();
    /* a door cycle that is still open is saved as if it had run to its end: everybody who was to get off is off and everybody who was to board is on
       (the same people the driver would have waited for; the stop's totals were fixed when the doors opened). The train comes back with the doors closed. */
    const ex = w.exch && !w.exch.finalized ? w.exch : null;
    const fx = ex ? exchangeOutcome(w, ex, { alighted: ex.alighting, boarded: ex.boarding }) : null;
    if (fx && sim.visits[ex.index]) { sim.visits[ex.index][9] = fx.rec.boarded; sim.visits[ex.index][10] = fx.rec.alighted; }
    const pw = fx || w;
    const stops = {}, plans = {};
    Object.entries(pw.stops).forEach(([i, r]) => { stops[i] = [r.alighted, r.boarded, r.alightingTotal, r.boardingTotal]; });
    Object.entries(w.plans).forEach(([i, p]) => { plans[i] = p.boarding; });
    const heading = stationsOf()[st.headingIndex ?? st.nextStationIndex];
    const plan = w.sim.plan || {};
    const snap = {
      v: TS.resume.VERSION, at: Date.now(), mode, route: w.routeId, train: w.trainId, svc: c.services || 0, life: c.lifetime || 0, cam: camMode, wxp: wxPref, todp: todPref,
      env: { weather: w.env.weather, hour: w.env.hour }, shift: w.clockShift || 0, clock0: w.sim.timetable.clockStart,
      ni: st.headingIndex ?? st.nextStationIndex, nn: heading ? (typeof heading.name === 'string' ? heading.name : nameOf(heading.name)) : '', live: Math.max(0, Math.round(w.liveCash || 0)),
      plan: { p: plan.pattern || 'RB', pass: [...(plan.pass || [])], tsr: (plan.tsr || []).map((r) => ({ s0: r.s0, s1: r.s1, kmh: r.kmh })), inc: (plan.incidents || []).map((x) => ({ ...x })) },
      tt: w.sim.timetable.stops.map((x) => [x.arr, x.dep]), ttt: w.sim.timetable.total,
      sim,
      w: { onboard: pw.onboard, delivered: pw.delivered, boarded: pw.boardedTotal, pkm: Math.round(pw.passengerKm * 1000) / 1000, riders: (pw.riders || []).map((r) => [r.n, Math.round(r.s * 100) / 100]), stops, log: pw.stopLog.map((l) => [l.index, l.boarded, l.alighted]), plans },
    };
    if (mode === 'endless') snap.en = { order: endless.order, i: endless.index, loops: endless.loops, cash: Math.round(endless.total.cash), pts: Math.round(endless.total.points) };
    return snap;
  }
  function writeSnapshot() {
    const snap = safe('resume snapshot', () => buildSnapshot(), null);
    if (!snap) return false;
    const out = JSON.stringify(snap);
    if (out.length > TS.resume.MAX_BYTES) { warn('resume snapshot too big', out.length); return false; }
    writeStore(resumeKey(), out);
    snapshotWrites += 1;
    return true;
  }
  /* endless: a finished route moves the saved run on to the next route (no sim state yet; the next route starts fresh) */
  function writeFreshSnapshot(routeId, trainId) {
    if (!TS.resume) return;
    const c = careerState(trainId);
    const snap = { v: TS.resume.VERSION, at: Date.now(), mode: 'endless', fresh: 1, route: routeId, train: trainId, svc: c.services || 0, life: c.lifetime || 0, cam: camMode, wxp: wxPref, todp: todPref, ni: 0, nn: '', live: 0,
      en: { order: endless.order, i: endless.index, loops: endless.loops, cash: Math.round(endless.total.cash), pts: Math.round(endless.total.points) } };
    writeStore(resumeKey(), JSON.stringify(snap));
  }
  /* the first seconds in the start station are not worth saving: armed once the train has moved or a stop is on record */
  function armSnapshot(st) {
    const w = world;
    if (snapshotArmed || !w || !st) return;
    const first = stationsOf()[0];
    if (st.distance > SNAPSHOT_ARM_M || (first && Math.abs(st.s - first.s) > SNAPSHOT_ARM_M) || w.stopLog.length > 0) snapshotArmed = true;
  }
  const saveSnapshotNow = () => { if (world) armSnapshot(world.state); if (snapshotReady()) writeSnapshot(); };

  /* the card at the top of the start menu */
  function resumeCardData(snap) {
    const def = routeDefOf(snap.route), train = trainDef(snap.train), a = TS.resume.ago(Date.now() - snap.at);
    const focus = !resumeFocusDone;
    resumeFocusDone = true;
    const cash = (snap.en ? snap.en.total.cash : 0) + snap.live;
    return {
      route: def ? nameOf(def.name) : snap.route,
      train: (train ? nameOf(train.name) : snap.train) + (snap.mode === 'endless' ? ' · ' + t('modeEndless') : ''),
      next: snap.nextName ? t('resumeNext', { name: snap.nextName }) : '', ago: t(a.key, { n: a.n }), cash: '€ ' + fmtInt(cash),
      loop: snap.en ? t('endlessLine', { n: snap.en.index + 1, total: snap.en.order.length }) + (snap.en.loops > 0 ? ' · ' + t('resumeLoop', { n: snap.en.loops + 1 }) : '') : '',
      focus, onResume: resumeFromMenu, onDiscard: discardFromMenu,
    };
  }
  function discardFromMenu() {
    discardSnapshot();
    if (phase === 'menu') renderMenu();
  }
  function dismissResume() {   // Escape: not now. The saved service stays until it is resumed, discarded or a day old.
    resumeDismissed = true; resumeOffer = null;
    if (phase === 'menu') renderMenu();
  }
  function resumeFromMenu() {
    if (phase !== 'menu') return;
    const snap = readSnapshot();   // checked again: the storage and the save may have changed since the card was drawn
    if (!snap) { resumeOffer = null; renderMenu(); return; }
    startResume(snap);
  }
  function startResume(snap) {
    save = safe('setCareer', () => TS.career.setCareer(save, snap.career), null) || save;   // in memory only: the card belongs to that career's menu
    if (snap.en) Object.assign(endless, { order: snap.en.order.slice(), index: snap.en.index, loops: snap.en.loops, total: { ...snap.en.total }, active: true });
    if (WX_IDS.includes(snap.wxp)) { wxPref = snap.wxp; writeStore('ts_weather', wxPref); }
    if (TOD_IDS.includes(snap.todp)) { todPref = snap.todp; writeStore('ts_tod', todPref); }
    resumeOffer = null;
    return startService(snap.route, snap.train, snap.mode, { resume: snap.fresh ? null : snap, camera: snap.cam, resumed: true });
  }

  /* ------------------------------------------------------------ audio */
  function ensureAudio() {
    if (audio || audioFailed) return audio;
    if (!has('audio.create')) { audioFailed = true; return null; }
    audio = safe('audio create', () => TS.audio.create(), null);
    if (!audio) { audioFailed = true; return null; }
    safe('audio mute', () => audio.setMuted(muted));
    return audio;
  }
  function wakeAudio() {
    ensureAudio();
    safe('audio resume', () => audio && audio.resume && audio.resume());
  }
  const sfx = (name, ...args) => { if (audio && typeof audio[name] === 'function') safe('audio.' + name, () => audio[name](...args)); };
  function applyMute(next) {
    muted = !!next;
    safe('audio mute', () => audio && audio.setMuted(muted));
  }

  /* ------------------------------------------------------------ world */
  const moduleStatus = {};
  function build(name, method, args) {
    const real = TS[name] && !(TS.fallback && TS.fallback.installed && TS.fallback.installed.includes(name));
    if (TS[name] && typeof TS[name][method] === 'function') {
      try { const out = TS[name][method](...args); if (out) { moduleStatus[name] = real ? 'real' : 'fallback'; return out; } }
      catch (error) { warn(name + '.' + method + ' failed', error); moduleStatus[name] = 'failed'; }
    }
    if (TS.fallback && TS.fallback[name] && TS.fallback[name] !== TS[name] && typeof TS.fallback[name][method] === 'function') {
      try { const out = TS.fallback[name][method](...args); moduleStatus[name] = (moduleStatus[name] || '') + '>fallback'; return out; }
      catch (error) { warn(name + ' fallback failed', error); }
    }
    return null;
  }
  const frameDelay = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  /* the random draw (weather and start hour) when the player chose "Zoufall" */
  function rollEnvironment() {
    const month = new Date().getMonth();
    const r = rand();
    const weather = r < 0.68 ? 'clear' : r < 0.82 ? 'rain' : r < 0.93 ? 'fog' : (month >= 10 || month <= 2 ? 'snow' : 'clear');
    const hour = rand() < 0.1 ? pick([21.2, 22.1, 5.4]) : 7 + rand() * 11;
    return { weather, hour };
  }
  function pickEnvironment() {
    const params = new URLSearchParams(location.search);
    let { weather, hour } = rollEnvironment();
    if (wxPref !== 'random') weather = wxPref;                       // the player's choice (menu / popover)
    if (todPref !== 'random') hour = TOD_HOURS[todPref];
    if (params.has('weather')) weather = params.get('weather');      // test URL parameters win
    if (params.has('hour')) hour = parseFloat(params.get('hour')) || hour;
    return { weather, hour: Math.round(hour * 4) / 4 };
  }
  function disposeWorld() {
    if (!world) return;
    const w = world;
    world = null;
    disposePieces(w);
  }
  function disposePieces(w) {
    safe('passengers dispose', () => w.passengers && w.passengers.dispose && w.passengers.dispose());
    safe('cabin dispose', () => w.cabin && w.cabin.dispose && w.cabin.dispose());
    safe('tram dwell detach', () => TS.tramDwell && TS.tramDwell.detach && w.track && w.track.kind === 'tram' && TS.tramDwell.detach());
    safe('cab dispose', () => { if (w.cab) { if (w.cab.group && w.cab.group.parent) w.cab.group.parent.remove(w.cab.group); w.cab.dispose && w.cab.dispose(); } });
    safe('train dispose', () => { if (w.model) { scene.remove(w.model.group); w.model.dispose && w.model.dispose(); } });
    safe('infra dispose', () => w.infra && w.infra.dispose && w.infra.dispose());
    safe('landscape dispose', () => w.landscape && w.landscape.dispose && w.landscape.dispose());
    safe('renderer cleanup', () => renderer && renderer.renderLists && renderer.renderLists.dispose());
  }

  const resumeInvalid = (why) => Object.assign(new Error('Saved service does not fit: ' + why), { resumeInvalid: true });
  /* a saved service must fit the line it was saved on (station count, position on the track); anything else is thrown away silently */
  function resumeFits(resume, track) {
    const n = (track.stations || []).length;
    if (n < 2 || n !== resume.tt.length) throw resumeInvalid('station count');
    if (!(resume.sim.s >= 0 && resume.sim.s <= track.length + 1)) throw resumeInvalid('position');
    if (resume.plan.pass.some((i) => i <= 0 || i >= n - 1) || resume.plan.incidents.some((x) => x.station !== undefined && x.station >= n)) throw resumeInvalid('plan');
  }

  async function buildWorld({ routeId, trainId, sim = null, env = null, demo = false, keepState = null, resume = null, abortIf = null }) {
    const routeDef = routeDefOf(routeId);
    if (!routeDef) throw new Error('Unknown route ' + routeId);
    const cfg = effectiveTrain(trainId);
    const environment = env || (resume ? { ...resume.env } : pickEnvironment());
    const isLux = /^luxtram/.test(routeId);
    const waitTiles = isLux && !demo && !keepState;   // the menu demo and quality rebuilds do not hold the screen for tiles
    // the menu backdrop (demo) loads silently: the loading banner is only for a real service
    if (!demo) loaderStart(isLux ? 'tram' : 'line', nameOf(routeDef.name));
    await frameDelay();
    if (isLux && TS.luxtram && TS.luxtram.preload) await safe('luxtram preload', () => TS.luxtram.preload((f) => loaderSet(f * 0.14)), Promise.resolve());   // track, world and landmark data: real byte progress
    loaderSet(isLux ? 0.16 : 0.15);
    const track = build('track', 'build', [routeDef]);
    if (!track) throw new Error('Track build failed');
    let resumeSim = null, resumeWorld = null;
    if (resume) {   // a saved run: checked and rebuilt before anything heavy is built, so a bad snapshot costs nothing
      resumeFits(resume, track);
      const stationCount = track.stations.length;
      const savedTimetable = TS.sim.timetableFrom(track, resume.clock0, resume.tt, resume.ttTotal, resume.plan.pass);
      if (!savedTimetable) throw resumeInvalid('timetable');
      resumeSim = TS.sim.create({ train: cfg, track, timetable: savedTimetable, options: { clockStart: resume.clock0, seed: Math.floor(rand() * 1e9), plan: resume.plan, holdChance: 0 } });
      // every record of the sim comes back exactly; the passenger totals are re-checked against this vehicle and line
      if (!resumeSim.restore(resume.sim, { maxCash: 100 * stationCount + 200, maxT: Math.max(4 * 3600, savedTimetable.total * 3) })) throw resumeInvalid('sim state');
      resumeWorld = TS.resume.clampWorld(resume.world, cfg.capacity || 90, stationCount, track.length);
    }
    loaderSet(isLux ? 0.22 : 0.3);
    const landscape = build('landscape', 'create', [scene, track.base || track, { quality, reverse: !!track.reverse, renderer }]);   // the return direction shares the forward track's scenery
    loaderSet(isLux ? 0.32 : 0.55);
    await frameDelay();
    const rootsBefore = new Set(scene.children);
    const infra = build('infra', 'create', [scene, track, { quality }]);
    const obstacleRoots = scene.children.filter((c) => !rootsBefore.has(c));
    loaderSet(isLux ? 0.42 : 0.75);
    await frameDelay();
    const model = build('trains', 'create', [cfg, { quality, livery: cfg.livery, upgrades: cfg.upgradeLevels || {}, headlight: true }]);
    safe('destination', () => { const last = track.stations && track.stations[track.stations.length - 1]; if (model && model.setDestination && last) model.setDestination(typeof last.name === 'string' ? last.name : nameOf(last.name)); });   // terminus on the front display
    if (model) { model.group.userData.noRainOcc = true; scene.add(model.group); }   // the train does not shelter the rain
    const cab = demo ? null : build('cab', 'create', [cfg, { quality }]);
    if (cab && model && model.cars[0]) model.cars[0].group.add(cab.group);
    const passengers = build('passengers', 'create', [scene, { quality }]);
    safe('passengers rain', () => passengers && passengers.setRain && passengers.setRain(environment.weather === 'rain'));
    // the people inside the tram (saloon camera, key 5): only the records until that camera is active (nothing is drawn or animated before)
    const cabin = !demo && track.kind === 'tram' && TS.passengers && TS.passengers.create ? safe('cabin passengers', () => TS.passengers.create(scene, { quality, cabin: true }), null) : null;
    // oncoming (AI) trams that stand at a stop get people off and on while the player is near (luxtram-traffic.js calls TS.tramDwell.arrive / depart)
    if (!demo && track.kind === 'tram' && TS.tramDwell) safe('tram dwell', () => TS.tramDwell.attach({ scene, track, quality, playerS: () => (world && world.state ? world.state.s : 0), platformHeight: (i) => platformHeight(i), obstaclesOf: (st, pi) => obstaclesOf(st, pi) }));
    if (cabin && model) { cabin.setActive(false, model); safe('cabin hooks', () => passengers && passengers.setCabinHooks && passengers.setCabinHooks({ onBoard: (d) => cabin.onBoard(d, liveOnboard()), onAlight: (d) => cabin.onAlight(d, liveOnboard()) })); }
    loaderSet(isLux ? 0.5 : 0.88);
    await frameDelay();
    safe('weather', () => landscape && landscape.setWeather && landscape.setWeather(environment.weather, true));
    safe('time of day', () => landscape && landscape.setTimeOfDay && landscape.setTimeOfDay(environment.hour));
    const startS = keepState && keepState.warmS !== undefined ? keepState.warmS : resume ? resume.sim.s : (track.stations && track.stations[0] ? track.stations[0].s : 0);
    const warmS = track.baseS ? track.baseS(startS) : startS;
    safe('landscape warm', () => landscape && landscape.warm && landscape.warm(warmS));
    if (waitTiles) await waitForStartTiles(landscape, warmS, 0.52, 0.96);
    const clockStart = resume ? resume.clock0 : Math.floor(environment.hour * 4) * 900;
    const plan = sim ? sim.plan : demo ? null : resume ? resume.plan : (forcedPlan || safe('planService', () => TS.sim.planService(track, cfg, { services: careerState(trainId).services || 0, rng: rand, varied: !calmServices }), null));
    forcedPlan = null;
    const simulation = sim || resumeSim || TS.sim.create({ train: cfg, track, options: { clockStart, seed: Math.floor(rand() * 1e9), plan: plan || undefined, ...(calmServices ? { holdChance: 0 } : {}) } });
    safe('temp boards', () => { if (infra && infra.addTempBoard && simulation.plan) simulation.plan.tsr.forEach((r) => infra.addTempBoard(r.s0, r.kmh, r.s1)); });
    const nightish = environment.hour < 6.3 || environment.hour > 19.3;
    if (abortIf && abortIf()) {   // the menu backdrop is no longer wanted (a service started meanwhile): drop it without touching the global world
      disposePieces({ passengers, cabin, cab, model, infra, landscape });
      return null;
    }
    world = {
      routeId, trainId, routeDef, cfg, track, landscape, infra, obstacleRoots, model, cab, passengers, cabin, sim: simulation, env: environment,
      state: null, demo, exch: null, plans: {}, spawned: new Set(), onboard: 0, delivered: 0, boardedTotal: 0, passengerKm: 0,
      aspects: new Map(), crossingClosed: new Map(), wheelAngle: 0, lights: nightish || environment.weather !== 'clear', 
      lightMode: null, lightLevel: 0, darkK: 0, tunnelK: 0, wipe: { cycles: 0, wet: 0 }, endTimer: -1, finished: false, departedAt: new Map(), announcedFor: -1, lastDoorSent: -1, lastDoorSide: '', lastBeacon: 0,
      stopLog: [], stops: {}, carFrames: [], platformCam: null, tracksideCam: null, welcomed: false, liveCash: 0, lastTod: environment.hour, spawnedFor: -1,
    };
    if (keepState) Object.assign(world, keepState);
    if (resumeWorld) {
      Object.assign(world, { plans: resumeWorld.plans, onboard: resumeWorld.onboard, delivered: resumeWorld.delivered, boardedTotal: resumeWorld.boardedTotal, passengerKm: resumeWorld.passengerKm, riders: resumeWorld.riders, stopLog: resumeWorld.stopLog, stops: resumeWorld.stops, welcomed: true, clockShift: resume.shift || 0 });
      safe('time of day (resume)', () => landscape && landscape.setTimeOfDay && landscape.setTimeOfDay(environment.hour + simulation.now.t / 3600));
    }
    safe('lights', () => model && model.setLights && model.setLights({ head: world.lights ? 2 : 0, tail: true, cabin: true }));
    buildStrip();
    return world;
  }

  const passIndices = () => (world && world.sim && world.sim.plan ? world.sim.plan.pass : []);
  const stopCount = () => stationsOf().length - passIndices().length;
  function patternText() {
    const w = world, pattern = w && w.sim.plan ? w.sim.plan.pattern : 'RB';
    return t('pattern' + pattern) + ' · ' + t('stationsN', { n: stopCount() });
  }

  /* Loading bar. Real progress where it can be measured (Luxtram: the data files and the start section's tiles, with the MB fetched); the build
     steps move it elsewhere, and between steps an eased fake creep keeps it alive. It never shows 100 % before the world is really ready. */
  const loader = { active: false, kind: 'line', route: '', target: 0, shown: 0, bytes0: 0, t0: 0, last: 0, timer: 0, fake: true, mb: false };
  const mbText = (bytes) => (bytes / 1048576).toFixed(1).replace('.', lang === 'en' ? '.' : ',');
  function renderLoader() {
    const pct = Math.min(99, Math.floor(loader.shown * 100));
    $('loadingTitle').textContent = t(loader.kind === 'tram' ? 'loadingTram' : 'loadingLine') + ' ' + t('loadingPct', { n: pct });
    const bytes = loader.mb && TS.net ? Math.max(0, TS.net.bytes - loader.bytes0) : 0;
    $('loadingSub').textContent = loader.route + (bytes > 50000 ? ' · ' + t('loadingMb', { n: mbText(bytes) }) : '');
    $('loadFill').style.width = (loader.shown * 100).toFixed(1) + '%';
    $('loadBar').setAttribute('aria-valuenow', String(pct));
  }
  function loaderTick() {
    const now = performance.now(), dt = Math.min(0.25, (now - loader.last) / 1000);
    loader.last = now;
    const fakeGoal = loader.fake ? 0.9 * (1 - Math.exp(-(now - loader.t0) / 3500)) : 0;   // eased creep, asymptotic to 90 %
    const goal = Math.min(0.99, Math.max(loader.target, fakeGoal));
    if (goal > loader.shown) loader.shown = Math.min(goal, loader.shown + Math.max(0.002, (goal - loader.shown) * (1 - Math.exp(-dt * 7))));
    renderLoader();
  }
  function loaderStart(kind, route) {
    clearInterval(loader.timer);
    Object.assign(loader, { active: true, kind, route: route || '', target: 0, shown: 0, bytes0: TS.net ? TS.net.bytes : 0, t0: performance.now(), last: performance.now(), fake: kind !== 'tram', mb: kind === 'tram' });
    $('loading').hidden = false;
    renderLoader();
    loader.timer = setInterval(loaderTick, 60);
  }
  const loaderSet = (target) => { if (loader.active) loader.target = Math.max(loader.target, clamp(target, 0, 0.99)); };
  function hideLoading(finished) {
    clearInterval(loader.timer);
    const wasActive = loader.active;
    loader.active = false;
    if (!(finished && wasActive)) { $('loading').hidden = true; return; }
    loader.shown = 1;   // really done: show 100 % for a moment
    $('loadingTitle').textContent = t(loader.kind === 'tram' ? 'loadingTram' : 'loadingLine') + ' ' + t('loadingPct', { n: 100 });
    $('loadFill').style.width = '100%'; $('loadBar').setAttribute('aria-valuenow', '100');
    setTimeout(() => { if (!loader.active) $('loading').hidden = true; }, 180);
  }
  /* Keeps the loading screen up until the start section's tiles have arrived (real count), then builds them, so the player does not start in an
     empty world. Gives up after TILE_WAIT_MAX_MS. */
  async function waitForStartTiles(landscape, startS, from, to) {
    if (!landscape || typeof landscape.progress !== 'function') return;
    const t0 = performance.now();
    for (;;) {
      const p = safe('landscape progress', () => landscape.progress(), null);
      if (!p) return;
      loaderSet(from + (to - from) * (p.total ? p.ready / p.total : 1));
      if (p.done || performance.now() - t0 > TILE_WAIT_MAX_MS) break;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    safe('landscape warm (tiles in)', () => landscape.warm && landscape.warm(startS));
  }
  /* "Loading ahead" pill while the tiles in front of a driving tram have not arrived yet (slow network). */
  let aheadClock = 0, aheadPending = 0, aheadShown = false;
  function updateAheadLoad(dt) {
    aheadClock += dt;
    if (aheadClock < 0.25) return;
    const step = aheadClock; aheadClock = 0;
    const w = world;
    const n = w && w.landscape && typeof w.landscape.pendingAhead === 'function' ? safe('pendingAhead', () => w.landscape.pendingAhead(), 0) : 0;
    aheadPending = n > 0 ? aheadPending + step : 0;
    const show = aheadPending >= AHEAD_LOAD_SHOW_S;
    if (show === aheadShown) return;
    aheadShown = show;
    $('aheadLoad').textContent = show ? t('loadingAhead') : '';
    $('aheadLoad').hidden = !show;
  }

  /* ------------------------------------------------------------ train placement */
  const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), mid: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion() };
  function frameSafe(track, s) {
    const L = track.length;
    const f = track.frameAt(clamp(s, 0, L));
    if (s >= 0 && s <= L) return f;
    const extra = s < 0 ? s : s - L;
    return { ...f, pos: f.pos.clone().addScaledVector(f.tangent, extra) };
  }
  function placeCar(car, track, centreS, out) {
    const bo = car.bogieOffset !== undefined ? car.bogieOffset : car.length * 0.36;
    const fa = frameSafe(track, centreS + bo), fb = frameSafe(track, centreS - bo);
    tmp.a.copy(fa.pos); tmp.b.copy(fb.pos);
    tmp.mid.addVectors(tmp.a, tmp.b).multiplyScalar(0.5);
    tmp.fwd.subVectors(tmp.a, tmp.b);
    if (tmp.fwd.lengthSq() < 1e-6) tmp.fwd.copy(fa.tangent);
    tmp.fwd.normalize();
    tmp.up.set(0, 1, 0).add(fa.up || tmp.up).normalize();
    tmp.right.crossVectors(tmp.fwd, tmp.up).normalize();
    tmp.up.crossVectors(tmp.right, tmp.fwd).normalize();
    tmp.m.makeBasis(tmp.right, tmp.up, tmp.fwd.clone().negate());
    car.group.position.copy(tmp.mid);
    car.group.quaternion.setFromRotationMatrix(tmp.m);
    car.group.updateMatrixWorld(true);
    if (out) { out.pos = tmp.mid.clone(); out.fwd = tmp.fwd.clone(); out.up = tmp.up.clone(); out.right = tmp.right.clone(); }
    if (car.bogies && car.bogies.length === 2) {
      safe('bogie yaw', () => {
        const yawFront = Math.atan2(fa.tangent.x * tmp.fwd.z - fa.tangent.z * tmp.fwd.x, fa.tangent.x * tmp.fwd.x + fa.tangent.z * tmp.fwd.z);
        const yawBack = Math.atan2(fb.tangent.x * tmp.fwd.z - fb.tangent.z * tmp.fwd.x, fb.tangent.x * tmp.fwd.x + fb.tangent.z * tmp.fwd.z);
        car.bogies[0].rotation.y = yawFront; car.bogies[1].rotation.y = yawBack;
      });
    }
  }
  function placeTrain(frontS) {
    const w = world;
    if (!w || !w.model) return;
    let offset = 0;
    w.model.cars.forEach((car, i) => {
      const centre = frontS - offset - car.length / 2;
      offset += car.length;
      placeCar(car, w.track, centre, (w.carFrames[i] = w.carFrames[i] || {}));
    });
  }
  const trainLength = () => (world && world.model && world.model.totalLength) || (world && world.sim.length) || 20;

  /* ------------------------------------------------------------ cameras */
  const camTmp = { eye: new THREE.Vector3(), t: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3() };
  let sideSpot = null, chaseSign = 1, chaseStationFor = -9;
  function setCamera(next) {
    if (!CAMERAS.includes(next)) return;
    if (next === 'inside' && !isTramWorld()) { if (camMode !== 'inside') return; next = 'cab'; }
    camMode = next;
    document.body.dataset.cam = next;
    camSmooth = { pos: null, look: null };
    sideSpot = null;
    look.yaw = look.pitch = 0;
    setCabHover(null);
    if (camera) { camera.near = next === 'cab' ? 0.06 : next === 'inside' ? 0.08 : 0.25; applyCabFov(); }
    safe('cab visibility', () => { if (world && world.cab) world.cab.group.visible = true; });
    safe('interior view', () => world && world.model && world.model.setCabView && world.model.setCabView(next === 'cab'));
    safe('saloon view', () => world && world.model && world.model.setInteriorView && world.model.setInteriorView(next === 'inside'));
    safe('saloon light', () => setInteriorLight(next === 'inside'));
    safe('cabin passengers', () => { if (world && world.cabin) { world.cabin.setActive(next === 'inside', world.model); if (next === 'inside') { world.cabin.reconcile(liveOnboard(), true); updatePaxDisplay(); } } });
    refreshCamLabel();
  }
  function refreshCamLabel() {
    const names = { cab: 'cam1', chase: 'cam2', platform: 'cam3', orbit: 'cam4', inside: 'cam5' };
    $('camName').textContent = (CAMERAS.indexOf(camMode) + 1) + ' · ' + t(names[camMode]);
    const ch = $('camHint');
    if (ch) { ch.hidden = camMode !== 'platform'; ch.textContent = t('camHint3'); }
    const wp = $('walkPad');
    if (wp) wp.hidden = camMode !== 'platform';
    const bi = $('btnInside');
    if (bi) { bi.hidden = !isTramWorld(); bi.classList.toggle('on', camMode === 'inside'); bi.textContent = camMode === 'inside' ? '5 · ' + t(['camPosFront', 'camPosMid', 'camPosRear'][insidePos]) + ' ↻' : '5 · ' + t('cam5'); }
  }
  /* the saloon's own light: one point light at the ceiling above the camera (only while the saloon camera is on), so seats and people are not black in the car's shadow and the cab
     lamps really light the inside at night */
  let interiorLight = null;
  function setInteriorLight(on) {
    if (!camera) return;
    if (on && !interiorLight) { interiorLight = new THREE.PointLight(0xfff1dc, 0, 11, 1.2); interiorLight.position.set(0, 0.55, -0.4); interiorLight.castShadow = false; camera.add(interiorLight); }
    if (interiorLight) { interiorLight.visible = !!on; interiorLight.intensity = on ? interiorLightLevel() : 0; }
  }
  const interiorLightLevel = () => 2.4 + 2.6 * (world && Number.isFinite(world.darkK) ? clamp(world.darkK, 0, 1) : 0);
  const isTramWorld = () => !!(world && world.track && world.track.kind === 'tram' && quality !== 'low');   // (low quality builds no saloon)
  /* key 5 / the HUD button: into the saloon, and inside again = the next of the three viewpoints */
  function pressInside() {
    if (!isTramWorld()) return;
    if (camMode === 'inside') { insidePos = (insidePos + 1) % 3; camSmooth.pos = null; refreshCamLabel(); } else setCamera('inside');
  }
  const cycleCamera = () => {
    let i = CAMERAS.indexOf(camMode);
    do { i = (i + 1) % CAMERAS.length; } while (CAMERAS[i] === 'inside' && !isTramWorld());
    setCamera(CAMERAS[i]);
  };

  function platformInfoOf(i) { return safe('platformInfo', () => (world && world.track.platformInfo ? world.track.platformInfo(i) : null), null); }
  function platformHeight(i) {
    const info = i !== undefined ? platformInfoOf(i) : null;
    if (info && Number.isFinite(info.height)) return info.height;
    return (world && world.infra && Number.isFinite(world.infra.platformHeight)) ? world.infra.platformHeight : 0.9;
  }
  function lateralSign(side) { return side === 'left' ? -1 : 1; }
  function stationSpot(st, L) {
    const w = world, s0 = st.s - L * 0.42;
    const f = frameSafe(w.track, s0), sign = lateralSign(st.side);
    const idx = stationsOf().indexOf(st), info = platformInfoOf(idx);
    const lateral = info ? info.edge + Math.max(2.4, info.width * 0.88) : 5.6;
    const pos = f.pos.clone().addScaledVector(f.right, sign * lateral);
    pos.y = f.pos.y + platformHeight(idx) + 2.1;
    return { pos, sign, s: s0, station: true };
  }
  function tracksideSpot(frontS, L) {
    const w = world, s0 = clamp(frontS + 90 + rand() * 70, 20, w.track.length - 20);
    const f = frameSafe(w.track, s0), sign = rand() < 0.5 ? -1 : 1;
    const pos = f.pos.clone().addScaledVector(f.right, sign * (6.5 + rand() * 3.5));
    pos.y = f.pos.y + 1.6 + rand() * 0.8;
    return { pos, sign, s: s0, station: false };
  }
  function updateCamera(dt, state) {
    const w = world;
    if (!w || !camera) return;
    const L = trainLength(), frontS = state ? state.s : 0;
    const k = 1 - Math.exp(-7 * dt);
    if (camMode === 'cab') {
      const car0 = w.model && w.model.cars[0];
      if (!car0) return;
      car0.group.updateMatrixWorld(true);
      const eyeLocal = w.cab && w.cab.group.userData && w.cab.group.userData.eye;
      if (eyeLocal) { w.cab.group.updateMatrixWorld(true); camTmp.eye.copy(eyeLocal); if (isPortrait()) camTmp.eye.z += CAB_EYE_BACK_PORTRAIT_M; w.cab.group.localToWorld(camTmp.eye); }
      else { camTmp.eye.set(0.45, 2.55, -car0.length / 2 + 1.5); car0.group.localToWorld(camTmp.eye); }
      const speed = state ? clamp(state.v / 28, 0, 1) : 0, tt = elapsedReal;
      camTmp.eye.y += Math.sin(tt * 13.1) * 0.0015 * speed;
      const swayYaw = Math.sin(tt * 0.31) * 0.006 * speed + Math.sin(tt * 2.1) * 0.0012 * speed;
      const swayPitch = Math.sin(tt * 0.47) * 0.003 * speed;
      look.yaw *= dragging ? 1 : 1 - Math.min(1, dt * 1.6);
      look.pitch *= dragging ? 1 : 1 - Math.min(1, dt * 1.6);
      camera.position.copy(camTmp.eye);
      camTmp.e.set(look.pitch + swayPitch + (isPortrait() ? CAB_PITCH_PORTRAIT : 0), look.yaw + swayYaw, 0, 'YXZ');
      camTmp.q.setFromEuler(camTmp.e);
      camera.quaternion.copy(car0.group.quaternion).multiply(camTmp.q);
      return;
    }
    if (camMode === 'inside') { updateInsideCamera(dt, state); return; }
    const f0 = w.carFrames[0];
    if (!f0 || !f0.pos) return;
    if (camMode === 'chase') {
      const carLen = w.model && w.model.cars[0] ? w.model.cars[0].length : 20;
      const heading = state && (state.headingStation || state.nextStation);
      if (heading && state.headingIndex !== chaseStationFor) { chaseStationFor = state.headingIndex; chaseSign = heading.side === 'right' ? -1 : 1; chaseChoice = 0; }
      // three-quarter view from the side away from the next platform: the nose, the side and the track ahead stay in frame
      camTmp.look.copy(f0.pos).addScaledVector(f0.fwd, carLen * 0.3).addScaledVector(f0.up, 1.7);
      chaseTimer -= dt;
      if (chaseTimer <= 0) { chaseTimer = 0.25; chaseChoice = pickChaseCandidate(f0, carLen, camTmp.look, chaseChoice); }
      chasePosition(f0, carLen, chaseChoice, camTmp.p);
      keepChaseInWorld(f0, carLen, camTmp.p);
      smoothTo(camTmp.p, camTmp.look, k);
    } else if (camMode === 'platform') {
      const st = state && state.nextStation;
      const nearStation = st && state.distanceToStop < 950 && state.distanceToStop > -(L + 60);
      if (nearStation) {
        if (!sideSpot || !sideSpot.station || sideSpot.stationIndex !== state.nextStationIndex) { sideSpot = stationSpot(st, L); sideSpot.stationIndex = state.nextStationIndex; camSmooth.look = null; resetPlatView(); }
      } else if (!sideSpot || sideSpot.station || frontS > sideSpot.s + 30) { sideSpot = tracksideSpot(frontS, L); camSmooth.look = null; resetPlatView(); }
      camera.position.copy(sideSpot.pos);
      platformWalk(dt, state);
      const rearS = frontS - L;
      const targetS = clamp(sideSpot.s, rearS + 3, frontS - 2);
      const lookFrame = frameSafe(w.track, sideSpot.station ? targetS + 4 : (frontS < sideSpot.s ? frontS : targetS));
      camTmp.look.copy(lookFrame.pos); camTmp.look.y += sideSpot.station ? platformHeight(state.nextStationIndex) + 0.9 : 1.6;
      if (!camSmooth.look) camSmooth.look = camTmp.look.clone(); else camSmooth.look.lerp(camTmp.look, 1 - Math.exp(-5 * dt));
      camera.lookAt(camSmooth.look);
      if (platView.yaw || platView.pitch) { camTmp.e.set(platView.pitch, platView.yaw, 0, 'YXZ'); camTmp.q.setFromEuler(camTmp.e); camera.quaternion.multiply(camTmp.q); }
      if (Math.abs(camera.fov - platView.fov) > 0.01) { camera.fov = platView.fov; camera.updateProjectionMatrix(); }
    } else {
      const mid = frameSafe(w.track, frontS - L / 2);
      camTmp.look.copy(mid.pos); camTmp.look.y += 1.8;
      const cp = Math.cos(orbit.pitch);
      camTmp.p.set(Math.sin(orbit.yaw) * cp, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cp).multiplyScalar(orbit.dist).add(camTmp.look);
      camera.position.copy(camTmp.p);
      camera.lookAt(camTmp.look);
    }
  }

  /* walking on the platform (camera 3): arrow keys / the pad move the viewpoint along the stop, at eye height above the platform, clamped to the platform (never over the track, never beyond its ends) */
  function platformWalk(dt, state) {
    const w = world;
    if (!sideSpot || !sideSpot.station || !w) return;
    const k = platView.keys, ax = (k.right ? 1 : 0) - (k.left ? 1 : 0) + platView.vx, ay = (k.in ? 1 : 0) - (k.out ? 1 : 0) + platView.vy;
    const idx = sideSpot.stationIndex, info = platformInfoOf(idx);
    if (!info) return;
    if (platView.s === null) {
      if (!ax && !ay) return;
      platView.s = sideSpot.s; platView.lat = info.edge + Math.max(2.4, info.width * 0.88);
    }
    const sMin = info.s0 + 0.6, sMax = info.s1 - 0.6, latMin = info.edge + 0.5, latMax = info.edge + info.width - 0.35;
    // "right" walks towards the front of the train, "in" away from the track
    platView.s = clamp(platView.s + clamp(ax, -1, 1) * PLAT_WALK_MS * dt, sMin, sMax);
    platView.lat = clamp(platView.lat + clamp(ay, -1, 1) * PLAT_WALK_MS * dt, latMin, Math.max(latMin, latMax));
    const f = frameSafe(w.track, platView.s), sign = lateralSign(w.track.stations[idx].side);
    camera.position.copy(f.pos).addScaledVector(f.right, sign * platView.lat);
    camera.position.y = f.pos.y + platformHeight(idx) + PLAT_EYE;
  }

  /* saloon camera: a standing passenger's eye height in the aisle, at the front end (looking back down the whole tram), the middle (looking forward) or the rear end (looking forward) */
  function updateInsideCamera(dt, state) {
    const w = world, cars = w.model && w.model.cars;
    if (!cars || !cars.length) return;
    const n = cars.length, last = cars[n - 1], first = cars[0];
    const vp = w.cabin && w.cabin.viewpoint ? w.cabin.viewpoint(insidePos) : null;
    const car = vp ? cars[vp.car] : cars[[0, Math.floor(n / 2), n - 1][insidePos]], inf = car.interior;
    car.group.updateMatrixWorld(true); first.group.updateMatrixWorld(true); last.group.updateMatrixWorld(true);
    const floorY = inf ? inf.floorY : 0.4, eyeY = floorY + 1.7;
    camTmp.eye.set(vp ? vp.x : 0.1, vp ? vp.y : eyeY, vp ? vp.z : 0); car.group.localToWorld(camTmp.eye);
    // aim down the length of the train: at the far end (front viewpoint) or at the front of the train (the others)
    const tgtCar = vp ? cars[vp.look.car] : (insidePos === 0 ? last : first);
    camTmp.t.set(0, (vp ? vp.y : eyeY) - 0.05, vp ? vp.look.z : 0);
    tgtCar.group.updateMatrixWorld(true); tgtCar.group.localToWorld(camTmp.t);
    if (interiorLight) interiorLight.intensity = interiorLightLevel();
    const speed = state ? clamp(state.v / 28, 0, 1) : 0, tt = elapsedReal;
    camTmp.eye.y += Math.sin(tt * 9.7) * 0.0025 * speed;
    camera.position.copy(camTmp.eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTmp.t);
    look.yaw *= dragging ? 1 : 1 - Math.min(1, dt * 1.2);
    look.pitch *= dragging ? 1 : 1 - Math.min(1, dt * 1.2);
    camTmp.e.set(look.pitch + Math.sin(tt * 0.5) * 0.002 * speed, look.yaw + Math.sin(tt * 0.33) * 0.004 * speed, 0, 'YXZ');
    camTmp.q.setFromEuler(camTmp.e);
    camera.quaternion.multiply(camTmp.q);
  }

  /* chase camera: candidates are tried in order and the first with a clear line of sight (no pole, canopy or portal in the way) wins */
  const CHASE_CANDIDATES = [[1, 0, 0.9], [-1, 0, 0.9], [1, 3.5, 1.5], [-1, 3.5, 1.5], [1, 7, 2.2]];   // side (relative to the preferred one), extra height, back factor
  let chaseChoice = 0, chaseTimer = 0;
  const chaseRay = new THREE.Raycaster();
  const CHASE_GROUND_CLEARANCE = 2.0, CHASE_CUTTING_DEPTH = 1.8, CHASE_TUNNEL_AHEAD = 14;
  /* never inside a hill: in tunnels sit low behind the train inside the bore, elsewhere stay above the terrain */
  function keepChaseInWorld(f0, carLen, p) {
    const w = world;
    const sNow = w && w.state ? w.state.s : 0;
    const inTunnel = safe('chase tunnel', () => !!(w.track && w.track.inTunnel && w.track.inTunnel(sNow)), false);
    if (inTunnel) { p.copy(f0.pos).addScaledVector(f0.fwd, CHASE_TUNNEL_AHEAD).addScaledVector(f0.up, 2.4); return; }   // ahead of the nose, looking back along the bore
    const gy = safe('chase ground', () => {
      if (w.landscape && typeof w.landscape.groundAt === 'function') return w.landscape.groundAt(p.x, p.z);
      if (w.track && typeof w.track.terrainHeightAt === 'function') return w.track.terrainHeightAt(p.x, p.z);
      return NaN;
    }, NaN);
    const sideGround = safe('chase cutting', () => Math.max(...[-8, 8].map((lat) => w.landscape.groundAt(f0.pos.x + f0.right.x * lat, f0.pos.z + f0.right.z * lat))), NaN);
    if (Number.isFinite(sideGround) && sideGround - f0.pos.y > CHASE_CUTTING_DEPTH) {   // deep cutting: side spots sit in the slope and behind may be a tunnel, so look down from above
      p.copy(f0.pos).addScaledVector(f0.fwd, -carLen * 0.4).addScaledVector(f0.up, sideGround - f0.pos.y + 9);
      return;
    }
    if (Number.isFinite(gy) && p.y < gy + CHASE_GROUND_CLEARANCE) p.y = gy + CHASE_GROUND_CLEARANCE;
  }
  function chasePosition(f0, carLen, choice, out) {
    const [side, extraUp, back] = CHASE_CANDIDATES[choice] || CHASE_CANDIDATES[0];
    return out.copy(f0.pos).addScaledVector(f0.fwd, -carLen * back).addScaledVector(f0.up, CHASE_UP + extraUp).addScaledVector(f0.right, chaseSign * side * (CHASE_SIDE + 4.4 + carLen * 0.1));
  }
  function blockedBetween(from, to) {
    const w = world;
    if (!w || !w.obstacleRoots || !w.obstacleRoots.length) return false;
    camTmp.dir = camTmp.dir || new THREE.Vector3();
    camTmp.dir.subVectors(to, from);
    const dist = camTmp.dir.length();
    if (dist < 0.5) return false;
    camTmp.dir.divideScalar(dist);
    chaseRay.set(from, camTmp.dir);
    chaseRay.near = 0.3; chaseRay.far = dist;
    let blocked = false;
    const check = (obj) => {
      if (blocked || !obj.visible) return;
      if (obj.isMesh && (obj.userData.camObstacle || !(obj.isInstancedMesh && obj.count > 150)) && !obj.isSkinnedMesh && obj.geometry && !(obj.material && !Array.isArray(obj.material) && obj.material.transparent && obj.material.opacity < 0.5)) {
        try { if (chaseRay.intersectObject(obj, false).length) blocked = true; } catch (e) { /* mesh type the raycaster cannot test: ignore */ }
      }
      for (const child of obj.children) check(child);
    };
    // sleepers/ballast/rails are big instanced meshes and must not count; poles, canopies and portals are what we avoid
    for (const root of w.obstacleRoots) check(root);
    return blocked;
  }
  function pickChaseCandidate(f0, carLen, lookAt, current) {
    const test = new THREE.Vector3();
    const order = [current, ...CHASE_CANDIDATES.map((_, i) => i).filter((i) => i !== current)];
    for (const i of order) {
      chasePosition(f0, carLen, i, test);
      if (!safe('chase ray', () => blockedBetween(lookAt, test), false)) return i;
    }
    return current;
  }
  function smoothTo(pos, lookAt, k) {
    if (!camSmooth.pos) { camSmooth.pos = pos.clone(); camSmooth.look = lookAt.clone(); }
    else { camSmooth.pos.lerp(pos, k); camSmooth.look.lerp(lookAt, k); }
    camera.position.copy(camSmooth.pos);
    camera.lookAt(camSmooth.look);
  }
  function demoCamera(dt) {
    const w = world;
    if (!w || !w.carFrames[0]) return;
    demoAngle += dt * DEMO_ORBIT_RATE;
    const f = w.carFrames[0], L = trainLength();
    const mid = f.pos.clone().addScaledVector(f.fwd, -L * 0.25);
    const r = clamp(L * 0.55 + 14, 18, 60);
    camera.position.set(mid.x + Math.sin(demoAngle) * r, mid.y + 3.4 + Math.sin(demoAngle * 0.7) * 1.2, mid.z + Math.cos(demoAngle) * r);
    camera.lookAt(mid.x, mid.y + 1.7, mid.z);
  }

  /* pointer: clickable cab controls (cab view), cab head look, free orbit drag + wheel */
  let dragging = false, dragX = 0, dragY = 0;
  const pinch = new Map(); let pinchRef = 0;
  const pinchDist = () => { const p = [...pinch.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
  let cabPress = null, cabHover = null;           // { id, y0, n0 } while a control is held / the id under the cursor
  const cabRay = new THREE.Raycaster(), cabNdc = new THREE.Vector2();
  function cabHit(e) {
    const w = world;
    if (!w || !w.cab || typeof w.cab.hitTest !== 'function' || camMode !== 'cab' || phase !== 'running' || paused || !camera) return null;
    const rect = $('world').getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    cabNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(true);
    cabRay.setFromCamera(cabNdc, camera);
    return safe('cab.hitTest', () => w.cab.hitTest(cabRay), null) || null;
  }
  /* nearest notch along the lever gate for dragging (keeps working outside the hit mesh) */
  function cabPickNotch(e) {
    const w = world;
    if (!w || !w.cab) return null;
    const hit = cabHit(e);                                  // also sets the ray
    if (typeof w.cab.pickNotch === 'function') { const n = safe('cab.pickNotch', () => w.cab.pickNotch(cabRay), null); if (Number.isFinite(n)) return n; }
    return hit && hit.id === 'lever' && Number.isFinite(hit.notch) ? hit.notch : null;
  }
  function setCabHover(id) {
    if (id === cabHover) return;
    cabHover = id;
    safe('cab.setHover', () => world && world.cab && world.cab.setHover && world.cab.setHover(id));
    $('world').style.cursor = id ? 'pointer' : '';
  }
  function cabDown(hit) {
    cabPress = { id: hit.id, y0: 0, n0: input.lever };
    switch (hit.id) {
      case 'lever': if (Number.isFinite(hit.notch)) setLeverNotch(hit.notch); break;
      case 'doorLeft': case 'doorRight': case 'doors': input.doorPress = true; break;
      case 'horn': if (!input.hornHeld) { input.hornHeld = true; sfx('horn', true); } break;
      case 'lights': toggleLights(); break;
      case 'eb': input.lever = LEVER_EB; break;
      case 'parking': input.parkingToggle = true; break;
      case 'announce': announceNext(false); break;
      default: break;
    }
  }
  function cabRelease() {
    if (cabPress && cabPress.id === 'horn' && input.hornHeld) { input.hornHeld = false; sfx('horn', false); }
    cabPress = null;
  }
  function bindPointer() {
    const el = $('world');
    el.addEventListener('pointerdown', (e) => {
      if (phase !== 'running') return;
      const hit = cabHit(e);
      if (hit && hit.id) {
        cabDown(hit);
        cabPress.y0 = e.clientY; cabPress.n0 = input.lever;
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        e.preventDefault();
        return;
      }
      dragging = true; dragX = e.clientX; dragY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    const end = () => { dragging = false; cabRelease(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    el.addEventListener('pointerleave', () => setCabHover(null));
    el.addEventListener('pointermove', (e) => {
      if (cabPress) {
        if (cabPress.id === 'lever') {
          const picked = cabPickNotch(e);
          if (Number.isFinite(picked)) setLeverNotch(picked);
          else setLeverNotch(cabPress.n0 + Math.round((cabPress.y0 - e.clientY) / CAB_DRAG_PX_PER_NOTCH));
        }
        return;
      }
      if (!dragging) {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') { const hit = cabHit(e); setCabHover(hit && hit.id ? hit.id : null); }
        return;
      }
      const dx = e.clientX - dragX, dy = e.clientY - dragY; dragX = e.clientX; dragY = e.clientY;
      if (camMode === 'orbit') { orbit.yaw -= dx * 0.006; orbit.pitch = clamp(orbit.pitch + dy * 0.005, 0.03, 1.35); }
      else if (camMode === 'cab') { look.yaw = clamp(look.yaw - dx * 0.004, -1.2, 1.2); look.pitch = clamp(look.pitch - dy * 0.003, -0.6, 0.5); }
      else if (camMode === 'inside') { look.yaw = clamp(look.yaw - dx * 0.004, -1.3, 1.3); look.pitch = clamp(look.pitch - dy * 0.003, -0.5, 0.45); }
      else if (camMode === 'platform' && pinch.size < 2) { platView.yaw -= dx * 0.005 * (platView.fov / PLAT_FOV0); platView.pitch = clamp(platView.pitch - dy * 0.004 * (platView.fov / PLAT_FOV0), PLAT_PITCH_MIN, PLAT_PITCH_MAX); }
    });
    el.addEventListener('wheel', (e) => {
      if (camMode === 'orbit') { e.preventDefault(); orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 8, 140); }
      else if (camMode === 'platform') { e.preventDefault(); platView.fov = clamp(platView.fov * Math.exp(e.deltaY * 0.0012), PLAT_FOV_MIN, PLAT_FOV_MAX); }
    }, { passive: false });
    // two-finger pinch zooms camera 3
    el.addEventListener('pointerdown', (e) => { pinch.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pinch.size === 2) pinchRef = pinchDist(); });
    el.addEventListener('pointermove', (e) => {
      if (!pinch.has(e.pointerId)) return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2 && camMode === 'platform' && pinchRef > 0) { const d = pinchDist(); platView.fov = clamp(platView.fov * (pinchRef / Math.max(10, d)), PLAT_FOV_MIN, PLAT_FOV_MAX); pinchRef = d; }
    });
    const pinchEnd = (e) => { pinch.delete(e.pointerId); pinchRef = 0; };
    el.addEventListener('pointerup', pinchEnd); el.addEventListener('pointercancel', pinchEnd);
  }

  /* ------------------------------------------------------------ toasts */
  /* At most TOAST_MAX at once; a new toast replaces an older one of the same group (or with the same text). */
  function toast(text, kind = 'info', ms = 3000, group = '') {
    const box = $('toasts');
    [...box.children].forEach((old) => { if (old.textContent === text || (group && old.dataset.group === group)) old.remove(); });
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    if (group) el.dataset.group = group;
    box.appendChild(el);
    while (box.children.length > TOAST_MAX) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
  }
  function banner(text, sub, ms = 2600) {
    const b = $('banner');
    b.replaceChildren(document.createTextNode(text));
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
    b.hidden = false;
    clearTimeout(banner.timer);
    banner.timer = setTimeout(() => { b.hidden = true; }, ms);
  }

  /* ------------------------------------------------------------ station flow */
  const stationsOf = () => (world ? world.track.stations || [] : []);
  function planFor(i) {
    const w = world, st = stationsOf()[i];
    if (!st) return { boarding: 0 };
    if (w.plans[i]) return w.plans[i];
    const last = i === stationsOf().length - 1;
    const scale = clamp(Math.sqrt((w.cfg.capacity || 90) / 90), 1, 2.4);
    const size = BOARD_BASE[st.size] ? st.size : 2;
    const crowd = ((w.sim.plan && w.sim.plan.incidents) || []).find((x) => x.kind === 'crowd' && x.station === i);
    w.plans[i] = { boarding: last ? 0 : Math.max(2, Math.round(BOARD_BASE[size] * scale * (0.7 + rand() * 0.7) * (crowd ? crowd.factor || 1.8 : 1))) };
    return w.plans[i];
  }
  function spawnWaiting(i) {
    const w = world, st = stationsOf()[i];
    if (!st || !w.passengers) return;
    const plan = planFor(i), last = i === stationsOf().length - 1;
    safe('passengers clear', () => w.passengers.clear && w.passengers.clear());
    const info = platformInfoOf(i);
    safe('spawnPlatform', () => w.passengers.spawnPlatform && w.passengers.spawnPlatform(st, w.track, { count: plan.boarding + (last ? 6 : 3), side: st.side, platformHeight: platformHeight(i), edgeOffset: info ? info.edge : undefined, width: info ? info.width : undefined, trainLength: trainLength(), tram: !!(w.track && w.track.kind === 'tram'), obstacles: obstaclesOf(st, info) }));
    w.spawnedFor = i;
  }
  /* footprints of the furniture on a Luxtram platform (stations-luxtram.js), so people never stand inside a bench or a ticket machine */
  function obstaclesOf(st, info) {
    if (!info || !world || !world.track || world.track.kind !== 'tram' || !TS.luxtramObstacles) return [];
    return safe('platform obstacles', () => TS.luxtramObstacles(st.name, { edge: info.edge, width: info.width, island: info.kind === 'island', platformStart: st.platformStart, platformEnd: st.platformEnd }), []) || [];
  }
  function clearPlatform() {
    safe('passengers clear', () => world.passengers && world.passengers.clear && world.passengers.clear());
    world.spawnedFor = -2;
  }
  function doorsWorld(side) {
    const w = world, out = [];
    if (!w.model) return out;
    const sign = side === 'left' ? -1 : 1, ph = platformHeight(world.exch ? world.exch.index : undefined);
    w.model.cars.forEach((car, carIdx) => {
      car.group.updateMatrixWorld(true);
      const half = car.halfWidth || 1.45;
      for (const door of car.doors || []) {
        if (door.side !== side) continue;
        const pos = car.group.localToWorld(new THREE.Vector3(sign * half, 0, door.zLocal));
        const dir = new THREE.Vector3(sign, 0, 0).applyQuaternion(car.group.quaternion).setY(0).normalize();
        pos.y = pos.y + ph;
        out.push({ pos, side, dir, car: carIdx, zLocal: door.zLocal });
      }
    });
    return out;
  }
  const exchangeStats = () => safe('passengers.stats', () => (world.passengers && world.passengers.stats ? world.passengers.stats() : null), null) || { waiting: 0, boarded: 0, alighted: 0, boardingTotal: 0, alightingTotal: 0, done: true };

  /* One exchange per station stop. Reopening the doors at the same station only lets the people who had not finished boarding continue:
     nobody gets off again and the totals never change (w.stops[i] keeps the cumulative record). */
  function beginExchange(e) {
    const w = world, i = e.stationIndex, st = stationsOf()[i];
    if (!st) return;
    const last = i === stationsOf().length - 1, plan = planFor(i), size = BOARD_BASE[st.size] ? st.size : 2;
    const rec = w.stops[i];
    let alighting = 0, boarding = 0, base = { alighted: 0, boarded: 0 }, alightingTotal, boardingTotal;
    if (rec) {                                                  // reopen
      base = { alighted: rec.alighted, boarded: rec.boarded };
      alightingTotal = rec.alightingTotal; boardingTotal = rec.boardingTotal;
      const room = Math.max(0, (w.cfg.capacity || 90) - w.onboard);
      boarding = Math.min(Math.max(0, rec.boardingTotal - rec.boarded), room);
    } else {
      alighting = i === 0 ? 0 : last ? w.onboard : Math.round(w.onboard * lerp(ALIGHT_RANGE[0], ALIGHT_RANGE[1], rand()) * (size === 3 ? 1.2 : size === 1 ? 0.8 : 1));
      alighting = clamp(alighting, 0, w.onboard);
      const room = Math.max(0, (w.cfg.capacity || 90) - (w.onboard - alighting));
      boarding = Math.min(plan.boarding, room);
      alightingTotal = alighting; boardingTotal = boarding;
    }
    if (w.spawnedFor !== i) spawnWaiting(i);
    w.exch = { index: i, side: e.side, startedAt: w.sim.now.t, finalized: false, boardedFinal: 0, alightedFinal: 0, alighting, boarding, base, alightingTotal, boardingTotal, reopen: !!rec };
    const doors = doorsWorld(e.side);
    if (!alighting && !boarding) w.exch.fixed = true;
    else if (w.passengers && w.passengers.startExchange) safe('startExchange', () => w.passengers.startExchange({ doorsWorld: doors, boarding, alighting }));
    else w.exch.simulated = { t: 0 };
    if (e.terminus) { if (w.endTimer < 0) w.endTimer = 0; toast(t('evTerminus'), 'info', 3600); sfx('gong'); playAnnouncement('end', st, t('annTerminus', { name: st.name }), null); }
  }
  /* counts of the current door phase only */
  function phaseCounts() {
    const w = world, ex = w.exch;
    if (!ex) return null;
    if (ex.finalized) return { alighted: ex.alightedFinal, boarded: ex.boardedFinal, done: true };
    if (ex.fixed) return { alighted: 0, boarded: 0, done: true };
    if (ex.simulated) {
      const dt = w.sim.now.t - ex.startedAt;
      const alighted = Math.min(ex.alighting, Math.floor(dt / 0.6)), boarded = dt > 3 ? Math.min(ex.boarding, Math.floor((dt - 3) / 0.7)) : 0;
      return { alighted, boarded, done: alighted >= ex.alighting && boarded >= ex.boarding };
    }
    const s = exchangeStats();
    return { alighted: Math.min(s.alighted, ex.alighting), boarded: Math.min(s.boarded, ex.boarding), done: !!s.done };
  }
  /* cumulative counts for this station stop (what the HUD shows) */
  function currentExchangeCounts() {
    const w = world, ex = w.exch, c = ex && phaseCounts();
    if (!c) return null;
    return { alighted: ex.base.alighted + c.alighted, boarded: ex.base.boarded + c.boarded, alightingTotal: ex.alightingTotal, boardingTotal: ex.boardingTotal, done: c.done };
  }
  /* What closing the doors does to the passenger totals, as a pure result (the resume snapshot uses it too: it saves a door cycle that is still open as if it had just finished). */
  function exchangeOutcome(w, ex, counts) {
    const alightedFinal = Math.min(counts.alighted, w.onboard), boardedFinal = counts.boarded;
    const sNow = w.sim.now.s;
    let remaining = alightedFinal, passengerKm = w.passengerKm;
    let riders = (w.riders || []).map((r) => ({ ...r }));
    for (const r of riders) {
      const take = Math.min(r.n, remaining);
      passengerKm += (take * Math.max(0, sNow - r.s)) / 1000;
      r.n -= take; remaining -= take;
    }
    riders = riders.filter((r) => r.n > 0);
    if (boardedFinal > 0) riders.push({ n: boardedFinal, s: sNow });
    const rec = { alighted: ex.base.alighted + alightedFinal, boarded: ex.base.boarded + boardedFinal, alightingTotal: ex.alightingTotal, boardingTotal: ex.boardingTotal };
    const entry = { index: ex.index, boarded: rec.boarded, alighted: rec.alighted };
    return {
      alightedFinal, boardedFinal, riders, passengerKm, rec,
      onboard: w.onboard - alightedFinal + boardedFinal, delivered: w.delivered + alightedFinal, boardedTotal: w.boardedTotal + boardedFinal,
      stops: { ...w.stops, [ex.index]: rec },
      stopLog: w.stopLog.some((l) => l.index === ex.index) ? w.stopLog.map((l) => (l.index === ex.index ? entry : l)) : [...w.stopLog, entry],
    };
  }
  function finalizeExchange() {
    const w = world, ex = w && w.exch;
    if (!ex || ex.finalized) return;
    const counts = phaseCounts();
    safe('stopExchange', () => w.passengers && w.passengers.stopExchange && w.passengers.stopExchange());
    ex.finalized = true;
    const o = exchangeOutcome(w, ex, counts);
    ex.alightedFinal = o.alightedFinal;
    ex.boardedFinal = o.boardedFinal;
    w.riders = o.riders; w.passengerKm = o.passengerKm;
    w.onboard = o.onboard; w.delivered = o.delivered; w.boardedTotal = o.boardedTotal;
    w.stops = o.stops;
    w.sim.recordExchange(ex.index, o.rec.boarded, o.rec.alighted);
    w.stopLog = o.stopLog;
    refreshLiveCash();
  }
  function liveOnboard() {
    const w = world, c = w.exch && !w.exch.finalized ? phaseCounts() : null;
    return c ? w.onboard - c.alighted + c.boarded : w.onboard;
  }
  function buildResult() {
    const w = world, sum = w.sim.summary();
    const visited = sum.stops.filter((s) => s.visited), missed = sum.stops.filter((s) => s.rating === 'missed');
    return {
      ...sum, routeId: w.routeId, trainId: w.trainId, mode,
      passengersDelivered: w.delivered, passengersBoarded: w.boardedTotal, passengerKm: w.passengerKm,
      delaySecAtStations: [...visited.map((s) => s.arrDelaySec), ...missed.map(() => 600)],
      stopErrors: [...visited.map((s) => Math.abs(s.errorM)), ...missed.map(() => 30)],
      overspeedSeconds: sum.overspeedSec, harshEvents: sum.harshEvents, fareMult: w.cfg.fareMult || 1,
    };
  }
  function refreshLiveCash() {
    const w = world;
    if (!w || w.demo) return;
    const r = safe('reward preview', () => TS.career.reward(buildResult(), mode, save), null);
    w.liveCash = r ? r.cash : Math.max(0, Math.round(w.sim.now ? w.state && w.state.cash : 0));
  }

  const SNAPSHOT_EVENTS = new Set(['arrived', 'departed', 'doorsOpened', 'doorsClosed', 'stopRated', 'missedStop']);
  const REASON_TEXT = { moving: 'evDoorInterlockMoving', noPlatform: 'evDoorNoPlatform', expressPass: 'evDoorExpress', held: 'evDoorsHeldWait' };
  function handleEvent(e) {
    const w = world;
    events.push(e.type);
    if (events.length > 80) events.shift();
    if (SNAPSHOT_EVENTS.has(e.type)) snapshotDue = true;
    switch (e.type) {
      case 'doorsRefused': toast(t(REASON_TEXT[e.reason] || 'evDoorNoPlatform'), 'bad', 2200, 'doors'); break;
      case 'doorsOpening': sfx('doorOpen'); break;
      case 'doorsOpened': beginExchange(e); toast(t('evDoorsOpened'), 'info', 1400); break;
      case 'doorWarning': sfx('doorChime'); toast(t('evDoorsClosing'), 'info', 2200); break;
      case 'doorsClosing': finalizeExchange(); sfx('doorClose'); break;
      case 'doorsClosed': toast(t('evDoorsClosed'), 'info', 1800); break;
      case 'stopRated': stopToast(e); refreshLiveCash(); break;
      case 'departed': w.pendingAnn = { at: w.sim.now.t + 3.5, index: e.stationIndex + 1 }; refreshLiveCash(); break;
      case 'earlyDeparture': toast(t('evEarlyDeparture'), 'bad', 2600); break;
      case 'missedStop': toast(t('evOverrun'), 'bad', 2600); clearPlatform(); break;
      case 'overspeed': toast(t('evOverspeed') + ' ' + Math.round(e.limitKmh) + ' km/h', 'bad', 1800); break;
      case 'spad': input.lever = 0; toast(t('evSpad'), 'bad', 4000); setTimeout(() => toast(t('evSpadEmergency'), 'bad', 3200), 700); sfx('brakeSqueal', 1); break;
      case 'harsh': toast(t('evHarsh'), 'bad', 2400); break;
      case 'emergency': toast(t('evEmergencyBrake'), 'bad', 1600); sfx('brakeSqueal', 1); break;
      case 'buffer': toast(t('evOverrun'), 'bad', 2400); break;
      case 'terminus': break;
      case 'parkingApplied': toast(t(e.auto ? 'evParkingAuto' : 'evParkingOn'), 'info', e.auto ? 1600 : 1400, 'parking'); break;
      case 'parkingReleased': toast(t('evParkingOff'), 'info', 1200, 'parking'); break;
      case 'parkingRefused': toast(t('evParkingMoving'), 'bad', 1800, 'parking'); break;
      case 'reverser': toast(t(e.reverse ? 'evReverseOn' : 'evReverseOff'), 'info', 1800, 'reverser'); break;
      case 'reverserRefused': toast(t(e.reason === 'moving' ? 'evReverseMoving' : e.reason === 'doors' ? 'evReverseDoors' : 'evReverseLever'), 'bad', 2200, 'reverser'); break;
      case 'reverseBlocked': toast(t(e.reason === 'signal' ? 'evReverseSignal' : 'evReverseStart'), 'bad', 2600, 'reverser'); break;
      case 'reverseFine': toast(t('evReverseFine', { n: e.fine }), 'bad', 2600); break;
      case 'parkingBlocked': toast(t('evParkingBlocked'), 'bad', 2600, 'parking'); break;
      case 'doorsHeld': toast(t('evDoorsHeld'), 'info', 3200); break;
      case 'tsrAhead': toast(t('evTsrAhead', { n: e.kmh }), 'info', 3600); break;
      case 'crowdAhead': { const inc = (w.sim.plan.incidents || []).find((x) => x.kind === 'crowd' && x.station === e.stationIndex); const st = stationsOf()[e.stationIndex]; if (st) toast(t('evCrowd' + (inc ? inc.reason : 0), { name: st.name }), 'info', 4200); break; }
      case 'signalHeld': toast(t(e.reason === 'connection' ? 'evConnection' : 'evTraffic'), 'info', 3600); break;
      default: break;
    }
  }
  function stopToast(e) {
    const err = e.errorM, n = Math.abs(err).toFixed(1).replace(/\.0$/, '');
    if (e.rating === 'perfect') toast('★ ' + t('evPerfectStop') + ' (' + n + ' m)', 'good', 2600);
    else if (e.rating === 'ok') toast(t('evGoodStop') + ' (' + n + ' m)', 'good', 2400);
    else if (e.rating === 'overrun') { toast(t('evOverrun') + ' (+' + n + ' m)', 'bad', 3000); setTimeout(() => toast(t('evOverrunInfo'), 'info', 2400), 600); }
    else toast(t('evStopError', { n, dir: err > 0 ? t('evPast') : t('evShort') }), 'info', 2600);
  }

  /* announcements: on the Luxtram the pre-rendered voice clips (data/luxtram/voice, see scripts/gen_luxtram_voice.py) after the gong; every other case,
     a missing clip or a clip that will not decode falls back to the browser's speech synthesis. The mute switch silences both. */
  const VOICE_BASE = '/data/luxtram/voice/';
  let voiceMap = null, voiceLoading = null;
  function loadVoiceMap() {
    if (!voiceLoading) {
      voiceLoading = (typeof fetch === 'function' ? fetch(VOICE_BASE + 'index.json') : Promise.reject(new Error('no fetch')))
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { voiceMap = new Map(); if (j && j.clips) Object.keys(j.clips).forEach((id) => { const c = j.clips[id]; voiceMap.set(c.kind + '|' + (c.stop || '') + '|' + c.lang, id); }); return voiceMap; })
        .catch(() => { voiceMap = new Map(); return voiceMap; });
    }
    return voiceLoading;
  }
  async function playAnnouncement(kind, st, text, side) {
    if (!audio) return;
    const onTram = !!(world && world.track && world.track.kind === 'tram');
    let urls = null;
    if (onTram && st && audio.announceClips) {
      const map = await loadVoiceMap();
      const ids = [map.get(kind + '|' + st.name + '|' + lang)];
      if (side) ids.push(map.get('exit-' + side + '||' + lang));
      if (ids[0]) urls = ids.filter(Boolean).map((id) => VOICE_BASE + id + '.mp3');
    }
    if (urls) { safe('announce clips', () => audio.announceClips(urls, text, lang, 1.2)); return; }
    safe('announce', () => audio.announce && audio.announce(text, lang));
  }
  function announceNext(auto) {
    const w = world;
    if (!w || !w.state) return;
    const idx = w.state.headingIndex ?? w.state.nextStationIndex, st = stationsOf()[idx];
    if (!st) return;
    const text = t('annNextStop', { name: st.name }) + '. ' + t(st.side === 'left' ? 'annExitLeft' : 'annExitRight');
    sfx('gong');
    playAnnouncement('next', st, text, st.side === 'left' ? 'left' : 'right');
    toast('🔔 ' + t('annNextStop', { name: st.name }), 'info', 3400);
    return auto;
  }

  /* ------------------------------------------------------------ per-frame world update */
  function spadHoldToast() {
    const now = performance.now();
    if (now - lastSpadToast < SPAD_TOAST_COOLDOWN_MS) return;
    lastSpadToast = now;
    const st = world && world.state;
    toast(st && st.v < 0.05 ? t('evSpadHold', { n: Math.ceil(st.spadHoldSec) }) : t('evSpadHoldMoving'), 'bad', 1400, 'spad');
  }
  /* The forced emergency stop after a red signal stays until the train has stood still for a few seconds; a driver-applied one can always be released. */
  function releaseEmergency() {
    if (world && world.state && world.state.spadActive) { spadHoldToast(); return false; }
    input.lever = LEVER_BRAKE_MAX;
    toast(t('evEbReleased'), 'info', 1400, 'lever');
    return true;
  }
  function applyLever(delta) {
    if (!world || !world.state) return;
    const cur = input.lever;
    if (world.state.spadActive) { spadHoldToast(); return; }
    if (delta > 0) {
      if (cur === LEVER_EB) { releaseEmergency(); return; }
      input.lever = Math.min(LEVER_MAX, cur + 1);
      if (world.state.doorsLocked && input.lever > 0) toast(t('evDoorInterlockPower'), 'bad', 1600, 'lever');
    } else {
      input.lever = Math.max(LEVER_BRAKE_MAX, cur === LEVER_EB ? LEVER_EB : cur - 1);
    }
  }
  /* absolute lever position (cab clicks): same rules as the keys */
  function setLeverNotch(n) {
    if (!world || !world.state || !Number.isFinite(n)) return;
    const target = clamp(Math.round(n), LEVER_EB, LEVER_MAX);
    if (world.state.spadActive) { spadHoldToast(); return; }
    if (target === input.lever) return;
    if (input.lever === LEVER_EB && target > LEVER_EB) { if (!releaseEmergency()) return; if (target > LEVER_BRAKE_MAX) input.lever = target; }
    else input.lever = target;
    if (target > 0 && world.state.doorsLocked) toast(t('evDoorInterlockPower'), 'bad', 1600, 'lever');
  }
  function leverRepeat(now) {
    if (now - input.lastRepeat < LEVER_REPEAT_MS) return;
    if (input.held.up) { applyLever(1); input.lastRepeat = now; }
    else if (input.held.down) { applyLever(-1); input.lastRepeat = now; }
  }
  function toggleFast(force) {
    fastForward = force !== undefined ? !!force : !fastForward;
    const b = $('btnFast');
    b.classList.toggle('on', fastForward);
    b.setAttribute('aria-pressed', String(fastForward));
    toast(t(fastForward ? 'evFastOn' : 'evFastOff'), 'info', 1400, 'fast');
  }
  function simulate(dt) {
    const w = world;
    accum += dt;
    let n = 0;
    while (accum >= SIM_STEP && n < MAX_SIM_STEPS) {
      const st = w.sim.step(SIM_STEP, { lever: input.lever, doorPress: input.doorPress, parkingToggle: input.parkingToggle, reverseToggle: input.reverseToggle, passengers: w.onboard });
      input.doorPress = false; input.parkingToggle = false; input.reverseToggle = false;
      w.state = st;
      for (const e of st.events) handleEvent(e);
      accum -= SIM_STEP; n++;
    }
    if (n === MAX_SIM_STEPS) accum = 0;
  }
  /* Headlight level 0 off / 1 dipped / 2 full. Auto: full at night, dipped at dusk, in fog, rain, snow and in tunnels; the L key (or the cab knob) picks a level by hand until the weather or the hour changes. */
  function nearTunnel(s, margin) {   // no closure: runs every frame
    const list = world.track.tunnels, len = trainLength();
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (s > list[i].s0 - margin && s - len < list[i].s1) return true;
    return false;
  }
  function lookOf() { const w = world; return w && w.landscape && w.landscape.getLook ? w.landscape.getLook() : null; }
  function autoLights(state, look) {
    const w = world;
    if (w.lightMode !== null) return w.lightMode;
    const hours = w.env.hour + w.sim.now.t / 3600;
    const dark = look ? look.dark : (hours > 19.3 || hours < 6.3 ? 1 : w.env.weather !== 'clear' ? 0.5 : 0);
    const tunnel = nearTunnel(state.s, 20);
    return dark > 0.6 ? 2 : dark > 0.18 || tunnel ? 1 : 0;
  }
  /* wipers + wet glass + the light environment of the model, every frame (dt is 0 while paused) */
  function updateLightFx(dt, state, look) {
    const w = world, m = w.model;
    const tun = nearTunnel(state.s, 6);
    w.tunnelK += ((tun ? 1 : 0) - w.tunnelK) * (1 - Math.exp(-dt * 2.5));
    const dark = Math.max(look ? look.dark : 0, w.tunnelK), haze = look ? look.haze : 0;
    w.darkK = dark;
    safe('light env', () => m.setLightEnv && m.setLightEnv(dark, haze));
    const wx = w.env.weather, raining = wx === 'rain' || wx === 'snow', wp = w.wipe;
    const covered = look ? look.covered > 0.5 : false;
    const wetTarget = raining && !covered ? 1 : 0;
    wp.wet += (wetTarget - wp.wet) * (1 - Math.exp(-dt / (wetTarget ? 1.2 : 6)));
    const running = raining || wp.wet > 0.04 || wp.cycles % 1 > 0.0001;
    if (running && dt > 0) {
      const next = wp.cycles + dt / (wx === 'snow' ? 1.5 : 1.25);
      wp.cycles = raining || wp.wet > 0.04 || Math.floor(next) === Math.floor(wp.cycles) ? next : Math.floor(next);   // after the rain: finish the stroke, then park
    }
    safe('wipers', () => m.setWipers && m.setWipers(wp.cycles, wp.wet, wx === 'snow'));
  }
  function updateVisuals(dt, state, running) {
    const w = world;
    placeTrain(state.s);
    stepTodFade();
    if (w.model) {
      w.wheelAngle += (state.v * dt) / WHEEL_RADIUS;
      w.wheelDist = (w.wheelDist || 0) + state.v * dt;
      const doorSide = state.doorSide || w.lastDoorSide || 'right';
      if (state.doorsOpen01 !== w.lastDoorSent || doorSide !== w.lastDoorSide) {
        safe('setDoors', () => w.model.setDoors && w.model.setDoors(state.doorsOpen01, doorSide));
        w.lastDoorSent = state.doorsOpen01; w.lastDoorSide = doorSide;
      }
      safe('wheels', () => (w.model.setWheelDistance ? w.model.setWheelDistance(w.wheelDist) : w.model.setWheelSpin && w.model.setWheelSpin(w.wheelAngle)));
      const look = lookOf();
      const level = autoLights(state, look);
      if (level !== w.lightLevel || (level > 0) !== w.lights) { w.lightLevel = level; w.lights = level > 0; safe('setLights', () => w.model.setLights && w.model.setLights({ head: level, tail: true, cabin: true })); }
      updateLightFx(dt, state, look);
    }
    safe('infra.update', () => w.infra && w.infra.update && w.infra.update(state.s, camera));
    safe('landscape.update', () => w.landscape && w.landscape.update && w.landscape.update(w.track.baseS ? w.track.baseS(state.s) : state.s, camera, dt));
    if (running) {
      updateSignals(state);
      updateCrossings(state);
      safe('passengers.update', () => w.passengers && w.passengers.update && w.passengers.update(dt, camera));
      if (TS.tramDwell && w.track.kind === 'tram') safe('tram dwell update', () => TS.tramDwell.update(dt, camera));
      if (w.cabin) {
        const a = dt > 0 && w.lastV !== undefined ? (state.v - w.lastV) / dt : 0; w.lastV = state.v;
        safe('cabin.update', () => w.cabin.update(dt, camera, { accel: clamp(a, -2.5, 2.5) }));
        cabinTick(dt);
      }
      safe('cab.update', () => w.cab && w.cab.update && w.cab.update(cabInfo(state)));
      updateAudio(state);
    }
  }
  /* the saloon people follow the real passenger count (whole seconds, no popping while the camera looks), the screens show the next stops */
  let cabinClock = 0, paxClock = 0;
  function cabinTick(dt) {
    const w = world;
    if (!w || !w.cabin) return;
    cabinClock += dt; paxClock += dt;
    if (cabinClock > 1.2 && !(w.exch && !w.exch.finalized)) { cabinClock = 0; safe('cabin reconcile', () => w.cabin.reconcile(liveOnboard(), false)); }
    if (camMode === 'inside' && paxClock > 1) { paxClock = 0; safe('pax display', () => updatePaxDisplay()); }
  }
  function updatePaxDisplay() {
    const w = world, st = w && w.state;
    if (!w || !st || !w.model || !w.model.setPaxDisplay) return;
    const stops = stationsOf(), tt = w.sim.timetable, h = st.headingIndex ?? st.nextStationIndex, here = st.platformIndex >= 0 && st.v < 0.3 && st.nextStationIndex === st.platformIndex;
    const next = [];
    for (let i = Math.max(0, h); i < stops.length && next.length < 4; i++) if (!tt.stops[i].pass) next.push({ name: stops[i].name, min: Math.max(0, Math.round((tt.stops[i].arr - st.t) / 60)) });
    const last = stops[stops.length - 1];
    w.model.setPaxDisplay({ dest: last ? last.name : '', clock: shownClock(st.clockSec), next, atStop: here ? t('hudHere') + ' · ' + stops[st.platformIndex].name : '' });
  }
  function cabInfo(state) {
    const w = world, st = state.headingStation || state.nextStation;
    return {
      lever: state.lever, speedKmh: state.v * 3.6, limitKmh: state.limitKmh, targetKmh: state.nextLimit && state.nextLimit.distance < 400 ? Math.min(state.limitKmh, state.nextLimit.kmh) : state.limitKmh,
      signalAspect: state.signalAspect, doorsOpen01: state.doorsOpen01, doorsReleased: state.doorsReleased, doorSide: state.doorSide || (st && st.side) || 'right',
      headlights: w.lightLevel, night: w.darkK, horn: input.hornHeld, parkingBrake: !!state.parkingBrake, nextStationName: st ? st.name : '', distanceToStopM: state.distanceToHeading ?? state.distanceToStop, delaySec: state.delaySec,
      clock: shownClock(state.clockSec), powerKw: state.powerKw, brakePct: Math.round(state.brakePct * 100), wiper: w.env.weather === 'rain' || w.env.weather === 'snow',
    };
  }
  function updateAudio(state) {
    const w = world;
    if (!audio) return;
    const front = state.s;
    const inTunnel = (w.track.tunnels || []).some((tn) => front > tn.s0 && front < tn.s1);
    const onBridge = (w.track.bridges || []).some((b) => front > b.s0 && front < b.s1);
    safe('audio.update', () => audio.update({ curvature: Math.abs(safe('curvature', () => w.track.frameAt(clamp(state.s, 0, w.track.length)).curvature, 0) || 0), speedMs: state.v, lever: state.lever, accelMs2: state.a, sound: w.cfg.sound || 'electric', inTunnel, onBridge, rain: w.env.weather === 'rain', camera: camMode === 'cab' ? 'cab' : 'outside' }));
  }
  function updateSignals(state) {
    const w = world;
    if (!w.infra || !w.infra.setSignalAspect) return;
    for (const sg of w.sim.signalAspects()) {
      if (w.aspects.get(sg.index) !== sg.aspect) { w.aspects.set(sg.index, sg.aspect); safe('setSignalAspect', () => w.infra.setSignalAspect(sg.index, sg.aspect)); }
    }
  }
  function updateCrossings(state) {
    const w = world;
    if (!w.infra || !w.infra.setCrossing) return;
    (w.track.crossings || []).forEach((c, i) => {
      const closed = state.s > c.s - 380 && state.s - trainLength() < c.s + 12;
      if (w.crossingClosed.get(i) !== closed) {
        w.crossingClosed.set(i, closed);
        safe('setCrossing', () => w.infra.setCrossing(i, closed));
      }
      if (closed && Math.abs(c.s - state.s) < 400) sfx('signalBell', 1, clamp(1 - Math.abs(c.s - state.s) / 400, 0.05, 1));
    });
  }
  function managePlatformPeople(state) {
    const w = world;
    if (!w.passengers) return;
    const ni = state.nextStationIndex, behind = w.spawnedFor >= 0 && w.spawnedFor < ni;
    if (behind) {
      const st = stationsOf()[w.spawnedFor];
      if (state.s - st.s > trainLength() + PLATFORM_CLEAR_M) clearPlatform();
    }
    if (w.spawnedFor !== ni && !behind && state.distanceToStop < PLATFORM_SPAWN_M && !(w.exch && !w.exch.finalized)) {
      if (w.spawnedFor < 0 || w.spawnedFor === -2 || w.spawnedFor < ni) spawnWaiting(ni);
    }
    if (w.pendingAnn && w.sim.now.t >= w.pendingAnn.at) { const p = w.pendingAnn; w.pendingAnn = null; if (p.index < stationsOf().length) announceNext(true); }
  }
  function tickService(dt) {
    const w = world;
    leverRepeat(performance.now());
    simulate(dt);
    const st = w.state;
    if (!st) return;
    elapsedReal += dt;
    armSnapshot(st);
    if (snapshotDue) { snapshotDue = false; saveSnapshotNow(); }
    managePlatformPeople(st);
    if (w.endTimer >= 0 && !w.finished) {
      w.endTimer += dt;
      const c = currentExchangeCounts();
      if (w.endTimer > END_EXCHANGE_MIN_S && ((c && c.done) || w.endTimer > END_EXCHANGE_MAX_S)) finishService();
    }
    if (!w.welcomed && st.t > 1.2) { w.welcomed = true; announceWelcome(); }
    updateVisuals(dt, st, true);
    todClock += dt;
    if (todClock > TOD_INTERVAL_S) { todClock = 0; if (!w.todFade) safe('time of day', () => w.landscape && w.landscape.setTimeOfDay && w.landscape.setTimeOfDay(w.env.hour + w.sim.now.t / 3600)); }
  }
  function announceWelcome() {
    const w = world, last = stationsOf()[stationsOf().length - 1];
    if (!last) return;
    sfx('gong');
    safe('announce', () => audio && audio.announce && audio.announce(t('annWelcome', { name: last.name }), lang));
    toast(t('annWelcome', { name: last.name }), 'info', 4200);
    hudClock = 99;
  }

  /* ------------------------------------------------------------ HUD */
  function buildLeverBar() {
    const bar = $('leverBar');
    bar.replaceChildren();
    for (let n = LEVER_MIN; n <= LEVER_MAX; n++) {
      const i = document.createElement('i');
      i.dataset.n = String(n);
      i.className = n === 0 ? 'zero' : n > 0 ? 'p' : n === LEVER_EB ? 'e' : 'b';
      bar.appendChild(i);
    }
  }
  function buildStrip() {
    const stations = stationsOf(), dots = $('stripDots');
    dots.replaceChildren();
    lastStripNext = -2;
    if (!stations.length) return;
    const s0 = stations[0].s, span = Math.max(1, stations[stations.length - 1].s - s0);
    stations.forEach((st, i) => {
      const x = ((st.s - s0) / span) * 100;
      const dot = document.createElement('i');
      dot.style.left = x + '%'; dot.dataset.i = String(i); dot.title = st.name + (passIndices().includes(i) ? ' · ' + t('ttPass') : '');
      dots.appendChild(dot);
      if (i === 0 || i === stations.length - 1) {
        const label = document.createElement('span');
        label.style.left = x + '%'; label.textContent = st.name;
        label.className = i === 0 ? 'first' : 'last';   // the end names stay inside the strip
        dots.appendChild(label);
      }
    });
    buildStripTsr();
  }
  function buildStripTsr() {
    const w = world, dots = $('stripDots'), stations = stationsOf();
    if (!w || !w.sim.plan || !stations.length) return;
    const s0 = stations[0].s, span = Math.max(1, stations[stations.length - 1].s - s0);
    w.sim.plan.tsr.forEach((r) => {
      const bar = document.createElement('b');
      bar.className = 'tsr';
      bar.style.left = clamp(((r.s0 - s0) / span) * 100, 0, 100) + '%';
      bar.style.width = Math.max(0.8, ((r.s1 - r.s0) / span) * 100) + '%';
      bar.title = r.kmh + ' km/h';
      dots.appendChild(bar);
    });
  }
  let lastStripNext = -2;
  function updateStrip(state) {
    const stations = stationsOf();
    if (!stations.length) return;
    const s0 = stations[0].s, span = Math.max(1, stations[stations.length - 1].s - s0);
    // same frame as the dots: #stripDots is inset 18 px on both sides of .strip, the marker is positioned in .strip itself
    $('stripTrain').style.left = 'calc(18px + (100% - 36px) * ' + clamp((state.s - s0) / span, 0, 1).toFixed(4) + ')';
    const heading = state.headingIndex ?? state.nextStationIndex;
    if (lastStripNext !== heading) {
      lastStripNext = heading;
      $('stripDots').querySelectorAll('i').forEach((dot) => {
        const i = Number(dot.dataset.i);
        dot.className = (i < heading ? 'done' : i === heading ? 'next' : '') + (passIndices().includes(i) ? ' pass' : '');
      });
      // the stop the box names gets its name under its dot (the ends already carry theirs)
      let lbl = $('stripNextLbl');
      if (!lbl) { lbl = document.createElement('span'); lbl.id = 'stripNextLbl'; $('stripDots').appendChild(lbl); }
      const hs = stations[heading];
      lbl.hidden = !hs || heading <= 0 || heading >= stations.length - 1;
      if (hs) { lbl.textContent = hs.name; lbl.style.left = clamp(((hs.s - s0) / span) * 100, 12, 88) + '%'; }
    }
  }
  const fmtDist = (m) => (m >= 1000 ? t('distanceKm', { n: (m / 1000).toFixed(1) }) : t('distanceM', { n: Math.max(0, Math.round(m / 10) * 10) }));
  function kbd(key) { return '<kbd>' + key + '</kbd>'; }
  /* short contextual coach (save.hints): the same steps as the plain hints, but with the why */
  function hintFor(state) {
    const w = world, st = state.nextStation, coach = !!save.hints;
    if (!st) return '';
    const atPlatform = state.platformIndex >= 0 && state.v < 0.3;
    const vis = state.doorPhase;
    if (vis === 'open' || vis === 'opening') {
      const c = currentExchangeCounts();
      if (w.endTimer >= 0) return t('hintTerminus');
      if (coach && c && !c.done) return t('coachBoarding');
      return kbd('D') + ' ' + t('hintClose') + (c && !c.done ? ' · ' + t('hintWait') : '');
    }
    if (vis === 'warning' || vis === 'closing') return t('evDoorsClosing');
    if (atPlatform && state.nextStationIndex === state.platformIndex) {
      const visited = (w.stopLog || []).some((l) => l.index === state.platformIndex) || (w.exch && w.exch.index === state.platformIndex && w.exch.finalized);
      if (!visited) return coach ? t('coachOpen') : kbd('D') + ' ' + t('hintOpen');
      if (state.departureWaitSec > 0) return (coach ? t('coachWait') + ' ' : '') + t('hudWaitDepart', { time: shownClock(state.clockSec + state.departureWaitSec) });
      if (state.signalAspect === 'red' && state.nextSignalDistance < 300) return t('hintSignalRed');
      return coach ? t('coachDepart') : kbd('W') + ' ' + t('hintDepart');
    }
    if (state.signalAspect === 'red' && state.nextSignalDistance < 700) return t('hintSignalRed');
    if (state.distanceToStop < 500 && state.distanceToStop > -20) return (coach ? t(state.distanceToStop < 120 ? 'coachStopHere' : 'coachStopSoon') : t('hintStop')) + ' · ' + fmtDist(state.distanceToStop);
    if (state.distanceToStop < -3 && state.distanceToStop > -160 && state.v < 1 && !state.reverse) return t('hintReverse');
    if (state.t < 25 && state.v < 1) return t('welcomeHint');
    if (coach && state.v > 1) return t('coachCruise');
    return '';
  }
  function guideView(s) {
    if (s.spadActive) {
      return { cls: 'eb', text: s.v < 0.05 ? t('evSpadHold', { n: Math.ceil(s.spadHoldSec) }) : t('evSpadHoldMoving') };
    }
    const g = s.guide;
    if (!g || g.state === 'none') return null;
    if (g.state === 'ok' && !save.hints) return null;
    const label = t(GUIDE_KIND_KEYS[g.kind] || 'guideStop', { n: g.targetKmh });
    const head = g.state === 'brake' ? t('guideBrake') : g.state === 'late' ? t('guideLate') : t('guideOk');
    return { cls: g.state + (save.hints ? '' : ' subtle'), text: head + ' · ' + label + ' ' + fmtDist(g.distance) };
  }
  /* ---- timetable rules shown on the HUD ----
   *  1. every stop has a scheduled arrival (Ukunft) and departure (Ofaart); the departure is never before the arrival, the origin has only a departure and the terminus only an arrival;
   *  2. both are clock times with seconds, the same clock as the one in the corner, so a countdown always ends exactly on the printed time;
   *  3. between stops the delay is the position against the timetable (departure of the last stop -> arrival of the next one); standing in a stop it is measured against the DEPARTURE
   *     only: arriving late is absorbed by the dwell (0:00 until the departure time has passed), after that it counts up;
   *  4. delay colour: green when early or at most DELAY_LATE_S late, red when later; the word underneath says Fréi / Pünktlech / Verspéidung;
   *  5. while standing in a stop (doors open, closed, boarding) a badge counts down to the departure time, turns green when the way is free and red when the departure time is long gone;
   *  6. the box always lists the stop it names: while approaching, Ukunft is lit; standing in it, Ofaart is lit and Ukunft greyed. */
  const DELAY_LATE_S = 30, DELAY_EARLY_S = 5, DEP_LATE_RED_S = 30;
  function scheduleView(s, hIdx) {
    const w = world, tt = w.sim.timetable, stops = tt.stops, last = stops.length - 1;
    const stop = stops[hIdx], here = s.platformIndex >= 0 && s.v < 0.3 && s.nextStationIndex === s.platformIndex;
    const cur = here ? stops[s.platformIndex] : null;
    const out = { here: here && hIdx === s.platformIndex, hIdx, last: hIdx === last, first: hIdx === 0, pass: !!(stop && stop.pass), arr: stop ? tt.clockStart + stop.arr : 0, dep: stop ? tt.clockStart + stop.dep : 0, delay: s.delaySec, badge: null };
    if (here && cur) {
      const idx = s.platformIndex, depAt = cur.dep, late = s.t - depAt;
      // rule 3: standing in a stop the delay is measured against the departure
      out.delay = idx === last ? 0 : Math.max(0, Math.round(late));
      if (idx !== last) {
        const when = (stationsOf()[idx] ? stationsOf()[idx].name + ' · ' : '') + clockSecText(tt.clockStart + depAt);
        if (late < 0) out.badge = { cls: '', left: t('hudDepIn', { t: minSec(-late) }), right: when };
        else if (s.readyToDepart && s.doorPhase === 'closed') out.badge = { cls: 'go', left: t('hudDepGo'), right: when };
        else out.badge = { cls: late > DEP_LATE_RED_S ? 'late' : '', left: t('hudDepLate', { t: '+' + minSec(late) }), right: when };
      }
    }
    return out;
  }
  const clockPill = (sec) => { const t0 = clockSecText(sec); return t0.slice(0, 5) + '<i>' + t0.slice(5) + '</i>'; };
  function renderSchedule(sv) {
    const box = $('sched'), badge = $('depBadge');
    box.hidden = false;
    const arr = $('schedArr'), dep = $('schedDep');
    $('schedArrLbl').textContent = sv.pass ? t('ttPass') : t('ttArrival');
    $('schedDepLbl').textContent = t('ttDeparture');
    $('schedArrT').innerHTML = clockPill(sv.arr);
    $('schedDepT').innerHTML = sv.last || sv.pass ? '–' : clockPill(sv.dep);
    arr.className = 'pill' + (sv.pass ? ' pass' : sv.here ? ' past' : ' now');
    dep.className = 'pill' + (sv.last || sv.pass ? ' pass' : sv.here ? ' now' : '');
    dep.hidden = sv.pass;
    if (sv.first) { $('schedArrT').textContent = '–'; arr.className = 'pill pass'; }   // the origin has no arrival
    if (sv.badge) {
      badge.hidden = false; badge.className = 'depbadge ' + sv.badge.cls;
      badge.replaceChildren(Object.assign(document.createElement('small'), { textContent: sv.badge.right }), Object.assign(document.createElement('b'), { textContent: sv.badge.left }));
    } else badge.hidden = true;
  }
  function updateHud(force) {
    const w = world;
    if (!w || !w.state || $('hud').hidden && !force) return;
    const s = w.state, st = s.headingStation || s.nextStation, hIdx = s.headingIndex ?? s.nextStationIndex;
    $('speedNum').textContent = String(Math.round(s.v * 3.6));
    const sign = $('limitSign');
    sign.textContent = String(Math.round(s.limitKmh));
    sign.classList.toggle('over', s.overspeed);
    const nl = s.nextLimit;
    $('nextLimit').textContent = nl && nl.distance < 3000 ? (nl.tsr ? '⚠ ' : '→ ') + Math.round(nl.kmh) + ' · ' + fmtDist(nl.distance) : '';
    const sv = scheduleView(s, hIdx);
    $('nextLbl').textContent = sv.here ? t('hudHere') : t('hudNextStop');
    $('nextName').textContent = st ? st.name : '–';
    $('nextDist').textContent = st ? fmtDist(Math.abs(s.distanceToHeading ?? s.distanceToStop)) : '–';
    const sideEl = $('nextSide');
    sideEl.textContent = st ? t('platformShort') + ' ' + t(st.side === 'left' ? 'sideLeft' : 'sideRight') : '';
    sideEl.className = 'chip ' + (st ? (st.side === 'left' ? 'left' : 'right') : '');
    renderSchedule(sv);
    $('clock').textContent = shownClock(s.clockSec);
    $('clockSec').textContent = ':' + pad2((((s.clockSec + (w.clockShift || 0)) % 60) + 60) % 60);
    const d = $('delay'), dv = sv.delay, isLate = dv > DELAY_LATE_S;
    d.textContent = delayText(dv);
    d.className = 'delay' + (isLate ? ' late' : '');
    const dw = $('delayWord');
    dw.textContent = dv < -DELAY_EARLY_S ? t('hudEarly') : isLate ? t('hudDelay') : t('hudOnTime');
    dw.className = 'delayword' + (isLate ? ' late' : '');
    $('onboard').textContent = String(liveOnboard());
    $('cashHud').textContent = fmtInt(w.liveCash || 0);
    $('svcLabel').textContent = (mode === 'endless' ? t('endlessLine', { n: endless.index + 1, total: endless.order.length }) : nameOf(w.routeDef.name)) + ' · ' + patternText();
    const lab = $('leverLabel');
    lab.textContent = TS.sim.leverLabel(s.lever);
    lab.className = s.lever === 0 ? 'neutral' : s.lever > 0 ? '' : s.lever <= LEVER_EB ? 'eb' : 'brake';
    $('leverBar').querySelectorAll('i').forEach((i) => i.classList.toggle('on', Number(i.dataset.n) === s.lever));
    const ds = $('doorState');
    ds.textContent = s.doorsOpen01 > 0.02 || s.doorsReleased ? (s.doorsOpen01 > 0.98 ? t('hudDoorsOpen') : t('hudDoorsReleased')) : t('hudDoorsClosed');
    ds.classList.toggle('open', s.doorsOpen01 > 0.02 || s.doorsReleased);
    $('sigLight').className = 'sig ' + (s.signalAspect === 'red' ? 'r' : s.signalAspect === 'yellow' ? 'y' : 'g');
    const aspectText = t(s.signalAspect === 'red' ? 'hudSignalRed' : s.signalAspect === 'yellow' ? 'hudSignalYellow' : 'hudSignalGreen');
    $('sigText').replaceChildren();
    const b = document.createElement('b'); b.textContent = aspectText;
    $('sigText').append(b, document.createTextNode(Number.isFinite(s.nextSignalDistance) && s.nextSignalDistance < 3000 ? fmtDist(s.nextSignalDistance) : '–'));
    const xc = $('xchg'), counts = w.exch && s.doorsOpen01 > 0.05 ? currentExchangeCounts() : null;
    xc.hidden = !counts;
    if (counts) {
      $('xchgOut').textContent = '↓ ' + t('exchangeOut') + ' ' + counts.alighted + '/' + counts.alightingTotal;
      $('xchgIn').textContent = '↑ ' + t('exchangeIn') + ' ' + counts.boarded + '/' + counts.boardingTotal;
      $('xchgOn').textContent = t('hudOnBoard', { n: liveOnboard() });
    }
    $('revLamp').hidden = !s.reverse;
    $('btnRev').classList.toggle('on', !!s.reverse);
    const pk = $('parkLamp');
    pk.hidden = !s.parkingBrake;
    if (s.parkingBrake) pk.textContent = 'P · ' + t('hudParking');
    const hintHtml = hintFor(s), gv = guideView(s), gEl = $('guide');
    $('hint').innerHTML = hintHtml;
    $('hint').classList.toggle('coach', !!save.hints && !!hintHtml);
    gEl.hidden = !gv;
    if (gv) { gEl.className = 'guide ' + gv.cls; gEl.textContent = gv.text; }
    $('centerBox').classList.toggle('empty', !hintHtml && xc.hidden && !gv && !s.reverse);
    updateStrip(s);
  }

  /* ------------------------------------------------------------ overlays */
  const HELP_ROWS = [['W / ↑', 'keyPower'], ['S / ↓', 'keyBrake'], ['X / ⌫', 'keyEB'], ['D', 'keyDoors'], ['B', 'keyParking'], ['R', 'keyReverse'], ['F', 'keyFast'], ['H / Space', 'keyHorn'], ['L', 'keyLights'], ['V', 'keyWeather'], ['A', 'keyAnnounce'], ['C', 'keyCamera'], ['1–5', 'keyCamDirect'], ['T', 'keyTimetable'], ['M', 'keyMute'], ['P / Esc', 'keyPause'], ['F1 / ?', 'keyHelp'], ['', 'keyOrbit'], ['', 'keyClick']];
  function buildHelp() {
    const body = $('helpBody');
    body.replaceChildren();
    for (const [keys, label] of HELP_ROWS) {
      const k = document.createElement(keys ? 'kbd' : 'span');
      k.textContent = keys;
      const d = document.createElement('span');
      d.textContent = t(label);
      body.append(k, d);
    }
  }
  function toggleHelp(force) {
    const open = force !== undefined ? force : $('helpScreen').hidden;
    if (open) closeWxPop();
    $('helpScreen').hidden = !open;
    if (phase === 'running') { if (open && !paused) pauseGame(false, true); else if (!open && paused && pauseByHelp) resumeGame(); }
  }
  let pauseByHelp = false;
  function toggleTimetable() {
    const box = $('ttScreen');
    if (!box.hidden) { box.hidden = true; return; }
    if (!world) return;
    const w = world, tt = w.sim.timetable, sum = w.sim.summary();
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const key of ['ttStation', 'ttArrival', 'ttDeparture', 'ttActual']) { const th = document.createElement('th'); th.textContent = t(key); head.appendChild(th); }
    table.appendChild(head);
    tt.stops.forEach((stop, i) => {
      const tr = document.createElement('tr');
      if (w.state && i === w.state.nextStationIndex) tr.className = 'cur';
      const rec = sum.stops[i];
      if (stop.pass) tr.className = 'pass';
      const cells = stop.pass ? [stop.name, t('ttPass') + ' ' + shownClock(tt.clockStart + stop.arr), '–', '·'] : [stop.name, shownClock(tt.clockStart + stop.arr), i === tt.stops.length - 1 ? '–' : shownClock(tt.clockStart + stop.dep), rec && rec.visited ? t('ttArrAbbr') + ' ' + delayText(rec.arrDelaySec) + (Number.isFinite(rec.depDelaySec) && i < tt.stops.length - 1 ? ' · ' + t('ttDepAbbr') + ' ' + delayText(rec.depDelaySec) : '') : '·'];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      table.appendChild(tr);
    });
    $('ttBody').replaceChildren(table);
    box.hidden = false;
  }
  function pauseGame(silent, byHelp) {
    if (phase !== 'running' || paused) return;
    paused = true; pauseByHelp = !!byHelp;
    closeWxPop();
    safe('audio pause', () => audio && audio.setMuted(true));
    if (!byHelp && !silent) { $('pauseQuality').textContent = t('quality') + ': ' + qualityName(); $('pauseScreen').hidden = false; }
    else if (silent) { $('pauseScreen').hidden = false; }
  }
  function resumeGame() {
    if (phase !== 'running' || !paused) return;
    paused = false; pauseByHelp = false; lastFrame = 0;
    $('pauseScreen').hidden = true; $('helpScreen').hidden = true;
    safe('audio resume', () => audio && audio.setMuted(muted));
  }
  function showSummary(res, reward, rankUp, careerPlayed) {
    const rows = $('sumRows');
    rows.replaceChildren();
    const addRow = (label, value, cls) => {
      const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
      a.textContent = label; b.textContent = value; b.className = cls || '';
      tr.append(a, b); rows.appendChild(tr);
    };
    $('sumTitle').textContent = t('sumTitle');
    $('sumRoute').textContent = nameOf(world.routeDef.name) + ' · ' + nameOf(world.cfg.name || world.trainId);
    const g = reward.metrics && reward.metrics.grade;
    $('sumGrade').replaceChildren(document.createTextNode(g || ''));
    if (g) { const sm = document.createElement('small'); sm.textContent = t('grade' + g); $('sumGrade').appendChild(sm); }
    addRow(t('sumPassengers'), res.passengersDelivered + ' · ' + Math.round(res.passengerKm * 10) / 10 + ' km');
    for (const line of reward.breakdown || []) {
      const key = line.key === 'floor' ? 'rwdFloor' : line.key === 'endless' ? 'rwdEndless' : 'rwd' + line.key.charAt(0).toUpperCase() + line.key.slice(1);
      addRow(t(key), (line.value > 0 && line.key !== 'fares' ? '+' : '') + fmtInt(line.value) + ' €', line.value < 0 ? 'neg' : line.key === 'fares' ? '' : 'pos');
    }
    $('sumCash').textContent = t('sumEarned') + ' ' + fmtInt(reward.cash) + ' €';
    $('sumPoints').textContent = fmtInt(reward.points) + ' ' + t('sumPoints');
    const notes = [];
    if (rankUp >= 0) notes.push(t('sumRankUp', { name: t('rank_' + (TS.config && TS.config.careers && TS.config.careers[careerPlayed || 'rail'] ? TS.config.careers[careerPlayed || 'rail'].rankIds[rankUp] : '')) }));
    $('sumNote').textContent = notes.join(' · ');
    $('summary').hidden = false;
    $('hud').hidden = true;
  }

  /* ------------------------------------------------------------ service lifecycle */
  function fallbackReward(res) {
    const cash = Math.max(0, Math.round(res.simCash + res.passengersDelivered * 12));
    return { cash, points: Math.round(cash * 0.1), breakdown: [{ key: 'fares', value: cash }], metrics: { grade: 'C' } };
  }
  function finishService() {
    const w = world;
    if (!w || w.finished) return;
    w.finished = true;
    finalizeExchange();
    const res = buildResult();
    let reward = null, rankUp = -1, careerPlayed = save.career;
    const done = safe('completeService', () => TS.career.completeService(save, res, mode), null);
    if (done) { save = done.save; reward = done.reward; rankUp = done.rankUp; careerPlayed = done.career || careerPlayed; }
    else {
      reward = fallbackReward(res);
      const cid = safe('career of train', () => TS.career.careerOfTrain(w.trainId), null) || save.career;
      const c = save[cid] || EMPTY_CAREER, lifetime = (c.lifetime || 0) + reward.cash;
      const next = { ...save, [cid]: { ...c, lifetime, wallet: (c.wallet || 0) + reward.cash, services: (c.services || 0) + 1 } };
      save = { ...next, tb: (next.rail.lifetime || 0) + (next.tram.lifetime || 0) };
    }
    persist();
    if (mode !== 'endless') discardSnapshot();   // paid and done: the saved service must never come back (endless moves it on to the next route instead)
    w.lastReward = reward; w.lastResult = res;
    if (!ARCADE_TEST) safe('Arcade score', () => { window.Arcade.score(reward.points); window.Arcade.gameOver(reward.points); });
    scorePosted += 1;
    events.push('serviceEnd');
    if (mode === 'endless') { advanceEndless(reward); return; }
    phase = 'summary';
    showSummary(res, reward, rankUp, careerPlayed);
  }
  async function startService(routeId, trainId, startMode, opts = {}) {
    if (!initRenderer()) return false;
    demoToken += 1;   // a menu backdrop that is still being built must not replace this service's world
    const route = routeDefOf(routeId);
    if (!route) { toast(t('unknownRoute'), 'bad'); return false; }
    mode = startMode;
    phase = 'loading';
    paused = false;
    snapshotArmed = false; snapshotDue = false;
    if (!opts.resumed) resumeDismissed = false;
    $('menu').hidden = true; $('summary').hidden = true; $('pauseScreen').hidden = true; $('helpScreen').hidden = true;
    wakeAudio();
    closeWxPop();
    disposeWorld();
    try {
      await buildWorld({ routeId, trainId, resume: opts.resume || null });
    } catch (error) {
      if (opts.resume && error && error.resumeInvalid) {   // a broken or tampered snapshot: gone, quietly
        console.warn('[Lokféierer] saved service discarded: ' + error.message);
        disposeWorld(); discardSnapshot(); hideLoading(); endless.active = false;
        returnToMenu();
        return false;
      }
      warn('service build failed', error);
      hideLoading();
      if (opts.keepOnFail) return false;   // endless: the caller retries / skips to the next route instead of dropping to the menu
      toast(t('startFailed'), 'bad');
      returnToMenu();
      return false;
    }
    input.lever = 0; input.doorPress = false; input.parkingToggle = false; input.hornHeld = false; input.held.up = input.held.down = false; input.lights = null;
    accum = 0; elapsedReal = 0; todClock = 0; lastStripNext = -2;
    world.state = world.sim.step(0, { lever: 0, passengers: world.onboard });
    placeTrain(world.state.s);
    safe('pantograph', () => world.model && world.model.setPantograph && world.model.setPantograph(world.cfg.sound === 'diesel' ? 0 : 1));
    safe('cab snap', () => { if (world.cab) { world.cab.update(cabInfo(world.state)); if (world.cab.snap) world.cab.snap(); } });
    setCamera(opts.camera || 'cab');
    refreshLiveCash();
    hideLoading(true);
    $('fade').classList.remove('on');
    $('hud').hidden = false;
    safe('Arcade.startRun', () => window.Arcade.startRun());
    serviceStartedAt = performance.now();
    phase = 'running';
    updateHud(true);
    if (opts.resume) {
      snapshotArmed = true;
      writeSnapshot();   // the age on the card starts again from now
      banner(t('resumeBanner', { name: nearestStationName(world.state.s) }), t('resumeBannerHint'), 4800);
      return true;
    }
    banner(nameOf(route.name), patternText() + ' · ' + (mode === 'endless' ? t('endlessLine', { n: endless.index + 1, total: endless.order.length }) : nameOf(world.cfg.name || trainId)), 3600);
    return true;
  }
  async function advanceEndless(reward) {
    const w = world;
    endless.total.cash += reward.cash; endless.total.points += reward.points;
    phase = 'transition';
    endless.index += 1;
    if (endless.index >= endless.order.length) { endless.index = 0; endless.loops += 1; }
    const nextId = endless.order[endless.index];
    writeFreshSnapshot(nextId, w.trainId);
    const nextRoute = routeDefOf(nextId);
    banner(t('endlessNextLine', { name: nextRoute ? nameOf(nextRoute.name) : nextId }), '+' + fmtInt(reward.cash) + ' € · ' + fmtInt(reward.points) + ' ' + t('sumPoints'), 3200);
    $('fade').classList.add('on');
    await new Promise((r) => setTimeout(r, 900));
    if (!endless.active) return;   // (the player left to the menu during the transition)
    /* Endless never stops by itself: if the next route cannot be built (e.g. a lost WebGL context or a failed data load) it is retried,
       then the following route is tried, and only when nothing at all works the player lands in the menu with a message. */
    let ok = false;
    for (let attempt = 0; attempt < 2 + endless.order.length && !ok && endless.active; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
      let id = nextId;
      if (attempt >= 2) { endless.index = (endless.index + 1) % endless.order.length; id = endless.order[endless.index]; }
      ok = await startService(id, w.trainId, 'endless', { keepOnFail: true });
    }
    if (!ok && endless.active) { toast(t('startFailed'), 'bad'); returnToMenu(); }
  }
  function startEndless(trainId) {
    const order = safe('endlessOrder', () => TS.career.endlessOrder(trainId), []) || [];
    if (!order.length) { toast(t('noRoute'), 'bad'); return; }
    Object.assign(endless, { order, index: 0, loops: 0, total: { cash: 0, points: 0 }, active: true });
    startService(order[0], trainId, 'endless');
  }
  function returnToMenu() {
    closeWxPop();
    resumeDismissed = false;   // "not now" (Escape) only lasts for one visit of the menu
    phase = 'menu';
    endless.active = false;
    paused = false;
    $('hud').hidden = true; $('summary').hidden = true; $('pauseScreen').hidden = true; $('helpScreen').hidden = true; $('ttScreen').hidden = true;
    $('fade').classList.remove('on'); hideLoading();
    safe('audio idle', () => audio && audio.setMuted(muted));
    $('menu').hidden = false;
    renderMenu();
    buildDemo();
  }
  function quitService() {
    if (phase !== 'running') return;
    if (mode === 'endless' && endless.total.cash > 0) toast(t('endlessTotal') + ': ' + fmtInt(endless.total.cash) + ' €', 'good', 3600);
    persist();
    discardSnapshot();   // leaving on purpose ends the saved service too
    returnToMenu();
  }
  let demoToken = 0;
  async function buildDemo() {
    if (!renderer) return;
    const token = ++demoToken;
    disposeWorld();
    if (phase !== 'menu') return;
    try {
      const current = save[save.career] || EMPTY_CAREER;
      const trainId = current.train, routeId = current.route || 'west';
      demoKey = demoKeyOf();
      const built = await buildWorld({ routeId, trainId, demo: true, env: demoEnvironment(), abortIf: () => token !== demoToken || phase !== 'menu' });
      if (!built) return;
      world.state = world.sim.step(0, { lever: 0 });
      placeTrain(world.state.s);
      hideLoading();
    } catch (error) { warn('demo world failed', error); if (token === demoToken && phase === 'menu') hideLoading(); }
  }
  let demoDebounce = 0;
  // the menu backdrop only rebuilds when what it shows changes (career, vehicle, line): buying an upgrade or paying for something
  // else no longer reloads it (Ian: 'D'Streck gëtt gelueden' popped up after every upgrade purchase)
  let demoKey = '';
  const demoKeyOf = () => { const c = save[save.career] || EMPTY_CAREER; return [save.career, c.train, c.route || 'west'].join('|'); };
  function refreshDemoSoon() {
    clearTimeout(demoDebounce);
    demoDebounce = setTimeout(() => { if (phase === 'menu' && (!world || demoKeyOf() !== demoKey)) buildDemo(); }, 450);
  }

  /* ------------------------------------------------------------ menu glue */
  function startFromMenu(modeIn, routeId, trainId) {
    if (phase !== 'menu') return;
    const m = /endl/i.test(String(modeIn)) ? 'endless' : 'career';
    const current = save[save.career] || EMPTY_CAREER;
    const tid = trainId || current.train, rid = routeId || current.route;
    if (m === 'endless') { startEndless(tid); return; }
    const ok = safe('routeAvailable', () => TS.career.routeAvailable(save, rid, tid), { ok: true });
    if (!ok.ok) { toast(t(ok.reason || 'noRoute'), 'bad'); return; }
    save = safe('select', () => TS.career.select(save, tid), null) || save;
    save = safe('selectRoute', () => TS.career.selectRoute(save, rid), null) || save;
    persist();   // remembers the chosen vehicle/route per career
    startService(rid, tid, 'career');
  }
  function handleBuy(kind, id, extra) {
    const C = TS.career;
    let next = null;
    safe('buy', () => {
      const k = String(kind);
      if (/train/.test(k)) next = C.buyTrain(save, id);
      else if (/route/.test(k)) next = C.buyRoute(save, id);
      else if (/upgrade/.test(k)) {
        const kinds = (TS.config && TS.config.upgradeKinds) || [];
        const extraId = extra && typeof extra === 'object' ? extra.trainId || extra.train : extra;
        if (kinds.includes(id)) next = C.buyUpgrade(save, extraId || careerState().train, id);
        else if (kinds.includes(extra)) next = C.buyUpgrade(save, id, extra);
        else next = C.buyUpgrade(save, id, extraId);
      }
    });
    if (!next) { toast(t('needsMoney'), 'bad'); return undefined; }
    save = next;
    persist();
    refreshDemoSoon();
    return save;                       // the menu repaints itself from the returned save
  }
  function handleSelect(trainId) {
    const next = safe('select', () => TS.career.select(save, trainId), null);
    if (!next) return undefined;
    save = next;
    refreshDemoSoon();
    return save;
  }
  /* Career switch in the menu (Zuch | Tram): remembered in the save. */
  function handleCareer(cid) {
    const next = safe('setCareer', () => TS.career.setCareer(save, cid), null);
    if (!next) return undefined;
    save = next;
    persist();
    refreshDemoSoon();
    return save;
  }
  function handleHints(on) {
    const next = safe('setHints', () => TS.career.setHints(save, on), null);
    if (!next) return undefined;
    save = next;
    persist();
    return save;
  }
  function renderMenu() {
    const host = $('menuHost');
    resumeOffer = resumeDismissed ? null : readSnapshot();
    const opts = { resume: resumeOffer ? resumeCardData(resumeOffer) : null, save, lang, onStart: startFromMenu, onBuy: handleBuy, onSelect: handleSelect, onCareer: handleCareer, onLang: setLanguage, onHints: handleHints, onEnv: handleEnvChoice, env: { weather: wxPref, tod: todPref } };
    try {
      if (!TS.menu || typeof TS.menu.render !== 'function') throw new Error('TS.menu missing');
      TS.menu.render(host, opts);
    } catch (error) {
      warn('menu render failed', error);
      try { TS.fallback.menu.render(host, opts); } catch (e2) { warn('fallback menu failed', e2); }
    }
  }

  /* ------------------------------------------------------------ keyboard */
  function muteToggle() {
    muted = !muted;
    writeStore('pb_muted', muted ? '1' : '0');
    postToHost({ __pbSndMute: muted });
    applyMute(muted);
    toast(t(muted ? 'evMuted' : 'evUnmuted'), 'info', 1200);
  }
  function cycleQuality() {
    quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length];
    writeStore('ts_quality', quality);
    applyQuality();
    translateStatic();
    if (world && (phase === 'running' || phase === 'menu')) rebuildWorld();
  }
  let rebuilding = false;
  async function rebuildWorld() {
    if (rebuilding || !world) return;
    rebuilding = true;
    const w = world, wasPaused = paused, wasRunning = phase === 'running';
    const keep = { warmS: w.state ? w.state.s : 0, plans: w.plans, onboard: w.onboard, delivered: w.delivered, boardedTotal: w.boardedTotal, passengerKm: w.passengerKm, riders: w.riders, stopLog: w.stopLog, stops: w.stops, welcomed: true, liveCash: w.liveCash, pendingAnn: w.pendingAnn, clockShift: w.clockShift || 0 };
    const demo = w.demo;
    if (wasRunning) paused = true;
    disposeWorld();
    try {
      await buildWorld({ routeId: w.routeId, trainId: w.trainId, sim: demo ? null : w.sim, env: w.env, demo, keepState: keep });
      world.state = w.state; world.lights = null;
      safe('pantograph', () => world.model && world.model.setPantograph && world.model.setPantograph(world.cfg.sound === 'diesel' ? 0 : 1));
      if (world.state) placeTrain(world.state.s);
      setCamera(camMode);
    } catch (error) { warn('rebuild failed', error); }
    hideLoading();
    if (wasRunning) paused = wasPaused;
    rebuilding = false;
  }
  function toggleLights() {
    if (!world) return;
    const w = world, next = ((w.lightLevel || 0) + 1) % 3;   // off -> dipped -> full -> off
    w.lightMode = next;
    toast(({ lb: ['Luuchten aus', 'Ofgeblend Luucht', 'Fernluucht'], de: ['Licht aus', 'Abblendlicht', 'Fernlicht'], en: ['Lights off', 'Dipped headlights', 'Full beam'] }[lang] || ['', '', ''])[next] || '', 'info', 1400, 'lights');
  }

  /* ------------------------------------------------------------ weather + time of day (menu choice, in-game popover, V) */
  const normHour = (h) => ((h % 24) + 24) % 24;
  const TOD_FADE_MS = 1600;
  const choiceLabel = (kind, id) => { const o = TS.envChoices && TS.envChoices[kind].find((x) => x.id === id); return o ? t(o.key) : id; };
  const weatherIcon = (id) => { const o = TS.envChoices && TS.envChoices.weather.find((x) => x.id === id); return o ? o.icon : '☀️'; };
  const demoEnvironment = () => ({ weather: wxPref === 'random' ? 'clear' : wxPref, hour: todPref === 'random' ? 16.5 : TOD_HOURS[todPref] });
  function setWxPref(id) { if (WX_IDS.includes(id)) { wxPref = id; writeStore('ts_weather', id); } }
  function setTodPref(id) { if (TOD_IDS.includes(id)) { todPref = id; writeStore('ts_tod', id); } }
  /* Changes the weather and/or the hour of the running world. Lights, wipers, passenger rain and the rain sound follow w.env on the next frame;
     the landscape eases the weather (setWeather(w, false)) and the light fades over TOD_FADE_MS. The timetable is relative, so only the shown clock shifts. */
  function applyEnvironment(next) {
    const w = world;
    if (!w) return;
    const env = { ...w.env };
    const nowT = w.sim && w.sim.now ? w.sim.now.t : 0;
    if (next.weather && next.weather !== env.weather) {
      env.weather = next.weather;
      safe('weather', () => w.landscape && w.landscape.setWeather && w.landscape.setWeather(env.weather, false));
      safe('passengers rain', () => w.passengers && w.passengers.setRain && w.passengers.setRain(env.weather === 'rain'));
    }
    if (next.hour !== undefined) {
      const from = normHour(env.hour + nowT / 3600), target = normHour(next.hour);
      env.hour = normHour(target - nowT / 3600);
      if (!w.demo && w.sim && w.sim.timetable) w.clockShift = Math.round(target * 3600 - w.sim.timetable.clockStart - nowT);
      let delta = target - from;
      if (delta > 12) delta -= 24; else if (delta < -12) delta += 24;
      w.todFade = { from, delta, start: performance.now() };
    }
    w.env = env;
    if (!w.demo) { w.lights = null; w.lightMode = null; syncWxPop(); }
  }
  /* the landscape light follows the fade each frame (also while paused) */
  function stepTodFade() {
    const w = world, f = w && w.todFade;
    if (!f) return;
    const k = clamp((performance.now() - f.start) / TOD_FADE_MS, 0, 1), e = k * k * (3 - 2 * k);
    safe('time of day fade', () => w.landscape && w.landscape.setTimeOfDay && w.landscape.setTimeOfDay(normHour(f.from + f.delta * e)));
    if (k >= 1) w.todFade = null;
  }
  function previewMenuEnvironment() {
    if (phase !== 'menu' || !world || !world.demo) return;
    const d = demoEnvironment();
    applyEnvironment({ weather: d.weather, hour: d.hour });
  }
  function handleEnvChoice(kind, id) {   // from the start menu
    if (kind === 'weather') setWxPref(id); else if (kind === 'tod') setTodPref(id);
    previewMenuEnvironment();
  }
  function chooseWeather(id) {   // in-game
    if (!world || world.demo || phase !== 'running' || !WX_IDS.includes(id)) return;
    setWxPref(id);
    const real = id === 'random' ? rollEnvironment().weather : id;
    applyEnvironment({ weather: real });
    toast(t('evWeather', { name: choiceLabel('weather', real) }), 'info', 1600, 'wx');
  }
  function chooseTimeOfDay(id) {   // in-game
    if (!world || world.demo || phase !== 'running' || !TOD_IDS.includes(id)) return;
    setTodPref(id);
    const hour = id === 'random' ? Math.round(rollEnvironment().hour * 4) / 4 : TOD_HOURS[id];
    applyEnvironment({ hour });
    toast(t('evTimeOfDay', { name: id === 'random' ? clockText(hour * 3600) : choiceLabel('tod', id) }), 'info', 1600, 'wx');
  }
  function cycleWeather() {
    if (!world || world.demo) return;
    const i = WX_CYCLE.indexOf(world.env.weather);
    chooseWeather(WX_CYCLE[(i + 1) % WX_CYCLE.length]);
  }
  /* compact popover next to the HUD buttons */
  function buildWxPop() {
    const pop = $('wxPop');
    if (!pop || !TS.envChoices) return;
    const group = (kind, label) => {
      const g = document.createElement('div'); g.className = 'wxpop__grp';
      const l = document.createElement('span'); l.className = 'wxpop__lbl'; l.id = 'wxLbl-' + kind; l.textContent = label;
      const row = document.createElement('div'); row.className = 'wxpop__opts'; row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-labelledby', l.id);
      for (const o of TS.envChoices[kind]) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wxopt'; b.setAttribute('role', 'radio'); b.dataset.kind = kind; b.dataset.id = o.id; b.dataset.test = 'wxpop-' + (kind === 'tod' ? 'tod-' : 'wx-') + o.id;
        const i = document.createElement('span'); i.setAttribute('aria-hidden', 'true'); i.textContent = o.icon;
        const tx = document.createElement('span'); tx.textContent = t(o.key);
        b.append(i, tx);
        b.addEventListener('click', (e) => {
          if (kind === 'weather') chooseWeather(o.id); else chooseTimeOfDay(o.id);
          if (e.detail !== 0) b.blur();   // a pointer click must not keep the focus (Space = horn)
        });
        row.append(b);
      }
      g.append(l, row);
      return g;
    };
    pop.replaceChildren(group('weather', t('weather')), group('tod', t('timeOfDay')));
    syncWxPop();
  }
  function syncWxPop() {
    const pop = $('wxPop');
    if (!pop) return;
    pop.querySelectorAll('.wxopt').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.kind === 'weather' ? wxPref : todPref) === b.dataset.id)));
    const btn = $('btnWx');
    btn.textContent = weatherIcon(world ? world.env.weather : 'clear');
    btn.title = t('envTitle'); btn.setAttribute('aria-label', t('envTitle'));
  }
  function openWxPop(viaKeyboard) {
    const pop = $('wxPop');
    syncWxPop();
    pop.hidden = false;
    $('btnWx').setAttribute('aria-expanded', 'true'); $('btnWx').classList.add('on'); document.body.classList.add('wx-open');
    if (viaKeyboard) (pop.querySelector('.wxopt[aria-checked="true"]') || pop.querySelector('.wxopt')).focus();
  }
  function closeWxPop() {
    const pop = $('wxPop');
    if (!pop || pop.hidden) return false;
    pop.hidden = true;
    $('btnWx').setAttribute('aria-expanded', 'false'); $('btnWx').classList.remove('on'); document.body.classList.remove('wx-open');
    const a = document.activeElement;
    if (a && (pop.contains(a) || a === $('btnWx')) && a.blur) a.blur();
    return true;
  }
  function toggleWxPop(viaKeyboard) { if ($('wxPop').hidden) openWxPop(viaKeyboard); else closeWxPop(); }
  /* keys while the focus sits in the popover (or on its button): arrows move, Enter/Space activate, Esc closes; everything else drives the train as usual */
  function wxPopKey(e) {
    if (e.key === 'Escape') { closeWxPop(); return true; }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') return 'native';
    if (e.key.startsWith('Arrow') && e.target.classList && e.target.classList.contains('wxopt')) {
      const all = [...$('wxPop').querySelectorAll('.wxopt')], i = all.indexOf(e.target);
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      all[(i + step + all.length) % all.length].focus();
      return true;
    }
    return false;
  }
  function handleKey(key, repeat) {
    if (key === 'Escape' || key === 'p' || key === 'P') {
      if (key === 'Escape' && closeWxPop()) return true;
      if (!$('helpScreen').hidden) { toggleHelp(false); return true; }
      if (!$('ttScreen').hidden) { $('ttScreen').hidden = true; return true; }
      if (phase === 'summary' && key === 'Escape') { returnToMenu(); return true; }
      if (phase === 'running') { if (paused) resumeGame(); else pauseGame(); return true; }
      return false;
    }
    if (key === 'Backspace' && !repeat) {   // back one level (while driving, Backspace stays the emergency brake)
      if (!$('helpScreen').hidden) { toggleHelp(false); return true; }
      if (phase === 'summary') { returnToMenu(); return true; }
      if (phase === 'running' && paused) { resumeGame(); return true; }
    }
    if (key === 'F1' || key === '?') { if (phase === 'running' || phase === 'menu') { toggleHelp(); return true; } return false; }
    if (phase !== 'running' || paused) return false;
    switch (key) {
      case 'w': case 'ArrowUp': if (!repeat) { applyLever(1); input.held.up = true; input.lastRepeat = performance.now(); } return true;
      case 's': case 'ArrowDown': if (!repeat) { applyLever(-1); input.held.down = true; input.lastRepeat = performance.now(); } return true;
      case 'x': case 'Backspace': input.lever = LEVER_EB; return true;
      case 'b': if (!repeat) input.parkingToggle = true; return true;
      case 'r': if (!repeat) input.reverseToggle = true; return true;
      case 'f': if (!repeat) toggleFast(); return true;
      case 'd': if (!repeat) input.doorPress = true; return true;
      case 'h': case ' ': if (!repeat) { input.hornHeld = true; sfx('horn', true); } return true;
      case 'l': if (!repeat) toggleLights(); return true;
      case 'v': if (!repeat) cycleWeather(); return true;
      case 'a': if (!repeat) announceNext(false); return true;
      case 'c': if (!repeat) cycleCamera(); return true;
      case '3': if (camMode === 'platform') resetPlatView(); else setCamera('platform'); return true;
      case '1': case '2': case '4': setCamera(CAMERAS[Number(key) - 1]); return true;
      case '5': pressInside(); return true;
      case 't': if (!repeat) toggleTimetable(); return true;
      case 'm': if (!repeat) muteToggle(); return true;
      case 'q': if (!repeat) cycleQuality(); return true;
      default: return false;
    }
  }
  function handleKeyUp(key) {
    if (key === 'w' || key === 'ArrowUp') input.held.up = false;
    if (key === 's' || key === 'ArrowDown') input.held.down = false;
    if ((key === 'h' || key === ' ') && input.hornHeld) { input.hornHeld = false; sfx('horn', false); }
  }
  const normKey = (e) => (e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key);
  function onKeyDown(e) {
    if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    dismissNotice();
    wakeAudio();
    if (phase === 'menu' && resumeOffer && !$('menu').hidden) {   // the Weiderfueren card: Enter carries on (unless a button has the focus and handles it), Escape = not now
      if (e.key === 'Escape') { e.preventDefault(); dismissResume(); return; }
      if (e.key === 'Enter' && !(e.target && e.target.closest && e.target.closest('button,a,input,select,textarea,[role="radio"]'))) { e.preventDefault(); resumeFromMenu(); return; }
    }
    if (e.target && e.target.closest && e.target.closest('#wxPop,#btnWx')) {
      const r = wxPopKey(e);
      if (r === 'native') return;
      if (r) { e.preventDefault(); return; }
    }
    if (phase === 'menu' && (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ')) return;
    if (phase === 'running' && camMode === 'platform' && platKey(e, true)) { e.preventDefault(); return; }
    if (handleKey(normKey(e), e.repeat)) e.preventDefault();
  }
  /* camera 3: arrow left / right walk along the platform, Shift + arrow up / down towards / away from the track (plain up / down stay the lever) */
  function platKey(e, down) {
    const k = platView.keys;
    if (e.key === 'ArrowLeft') { k.left = down; return true; }
    if (e.key === 'ArrowRight') { k.right = down; return true; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.shiftKey || (!down && (k.in || k.out)))) { if (e.key === 'ArrowUp') k.out = down; else k.in = down; return true; }
    return false;
  }
  function releaseAll() { input.held.up = input.held.down = false; platView.keys.left = platView.keys.right = platView.keys.in = platView.keys.out = false; cabPress = null; if (input.hornHeld) { input.hornHeld = false; sfx('horn', false); } }

  /* ------------------------------------------------------------ main loop */
  function frame(now) {
    frameHandle = requestAnimationFrame(frame);
    if (!renderer) return;
    const dt = lastFrame ? Math.min(MAX_FRAME_S, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    try {
      if (world && !rebuilding) {
        if (phase === 'running' && !paused) { tickService(fastForward ? dt * 2 : dt); updateCamera(dt, world.state); updateAheadLoad(dt); hudClock += dt; if (hudClock > HUD_INTERVAL_S) { hudClock = 0; updateHud(); } }
        else if (phase === 'running' || phase === 'summary' || phase === 'transition') { if (world.state) { updateVisuals(0, world.state, false); updateCamera(dt, world.state); } }
        else if (world.state) { updateVisuals(dt, world.state, false); demoCamera(dt); }
      }
      if (testMode) trackSettle();
      renderer.render(scene, camera);
    } catch (error) {
      errorsSeen += 1;
      warn('frame error', error);
    }
  }

  /* ------------------------------------------------------------ test hook */
  function trackSettle() {
    if (!camera) return;
    camera.updateMatrixWorld(true);
    const sig = camera.matrixWorld.elements.map((x) => x.toFixed(5)).join(',');
    settle.stable = sig === settle.sig ? settle.stable + 1 : 0;
    settle.sig = sig;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  function installTestHook() {
    const stationIndexSafe = (i) => clamp(Math.floor(i), 0, Math.max(0, stationsOf().length - 1));
    window.__tsTest = Object.freeze({
      state() {
        const w = world, s = w && w.state;
        const ex = w ? currentExchangeCounts() : null;
        return {
          phase, mode, paused, fast: fastForward, reverse: !!(s && s.reverse), backedM: s ? s.backedM : 0, quality, lang, camMode, muted, moduleStatus: { ...moduleStatus },
          routeId: w ? w.routeId : null, trainId: w ? w.trainId : null, demo: !!(w && w.demo), weather: w ? w.env.weather : null, hour: w ? w.env.hour : null, wxPref, todPref, shownClock: w && w.state ? shownClock(w.state.clockSec) : null,
          stations: w ? stationsOf().map((x) => ({ name: x.name, s: x.s, side: x.side })) : [],
          s: s ? s.s : 0, kmh: s ? s.v * 3.6 : 0, v: s ? s.v : 0, lever: s ? s.lever : 0, leverTarget: input.lever, doorPhase: s ? s.doorPhase : '', doorsOpen01: s ? s.doorsOpen01 : 0, doorSide: s ? s.doorSide : null, doorsReleased: !!(s && s.doorsReleased),
          atStationIndex: s ? s.atStationIndex : -1, platformIndex: s ? s.platformIndex : -1, nextStationIndex: s ? s.nextStationIndex : -1, stoppedAtMarkerError: s ? s.stoppedAtMarkerError : 0,
          readyToDepart: !!(s && s.readyToDepart), headingIndex: s ? s.headingIndex : -1, distanceToHeading: s ? s.distanceToHeading : 0, departureWaitSec: s ? s.departureWaitSec : 0, nextLimit: s ? s.nextLimit : null, nextSignalIndex: s ? s.nextSignalIndex : -1,
          distanceToStop: s ? s.distanceToStop : 0, signalAspect: s ? s.signalAspect : '', nextSignalDistance: s ? s.nextSignalDistance : 0, limitKmh: s ? s.limitKmh : 0, delaySec: s ? s.delaySec : 0,
          clock: s ? clockText(s.clockSec) : '', simT: s ? s.t : 0, onboard: w ? liveOnboard() : 0, exchange: ex, exchStation: w && w.exch ? w.exch.index : -1,
          cash: s ? s.cash : 0, liveCash: w ? w.liveCash : 0, totals: s ? s.totals : null, spadActive: s ? s.spadActive : false, finished: w ? w.finished : false, endTimer: w ? w.endTimer : -1,
          delivered: w ? w.delivered : 0, passengerKm: w ? w.passengerKm : 0,
          events: [...events], career: save.career, careers: JSON.parse(JSON.stringify({ rail: save.rail, tram: save.tram })), arcadeTest: ARCADE_TEST,
          wallet: careerState().wallet, tb: save.tb, lifetime: careerState().lifetime, owned: careerState().owned, routes: careerState().routes, saveTrain: careerState().train, services: careerState().services,
          endless: { ...endless, total: { ...endless.total } }, scorePosted, lastReward: w && w.lastReward ? { cash: w.lastReward.cash, points: w.lastReward.points } : null, lastResult: w && w.lastResult ? { delivered: w.lastResult.passengersDelivered, boarded: w.lastResult.passengersBoarded, pkm: w.lastResult.passengerKm, delays: w.lastResult.delaySecAtStations, errors: w.lastResult.stopErrors, over: w.lastResult.overspeedSeconds, harsh: w.lastResult.harshEvents, spads: w.lastResult.spads, breakdown: w.lastReward && w.lastReward.breakdown } : null,
          cabin: w && w.cabin ? w.cabin.stats() : null, insidePos, draws: renderer ? renderer.info.render.calls : 0, triangles: renderer ? renderer.info.render.triangles : 0, errors: errorsSeen, audio: !!audio,
          hudSpeed: $('speedNum').textContent, hudSide: $('nextSide').textContent, hudNext: $('nextName').textContent, hudXchg: $('xchg').hidden ? '' : $('xchg').textContent, kbNoticeVisible: !$('kbNotice').hidden, phoneBlocked: !$('phoneBlock').hidden,
          parkingBrake: !!(s && s.parkingBrake), guide: s ? s.guide : null, guideText: $('guide').hidden ? '' : $('guide').textContent, hintText: $('hint').textContent, parkLampVisible: !$('parkLamp').hidden,
          pattern: w && w.sim.plan ? w.sim.plan.pattern : '', passIndices: w && w.sim.plan ? [...w.sim.plan.pass] : [], tsr: w && w.sim.plan ? w.sim.plan.tsr.map((x) => ({ ...x })) : [], incidents: w && w.sim.plan ? w.sim.plan.incidents.map((x) => ({ ...x })) : [],
          spadHoldSec: s ? s.spadHoldSec : 0, hints: !!save.hints, svcLabel: $('svcLabel').textContent, cabHitTest: !!(w && w.cab && typeof w.cab.hitTest === 'function'), stopsRecord: w ? { ...w.stops } : {},
          visited: w ? w.sim.summary().stops.filter((x) => x.visited).map((x) => x.index) : [], resumeOffer: !!resumeOffer, snapshotWrites, snapshotArmed, resumeFocus: document.activeElement ? document.activeElement.getAttribute('data-test') : null,
          signalsHeld: w ? w.sim.signals.filter((x) => x.hold).length : 0, timetable: w ? w.sim.timetable.stops.map((x) => ({ ...x })) : [],
        };
      },
      /* deterministic test runs: a seeded generator for everything random in the shell, the plan and the simulation (null = back to Math.random) */
      loadState() { return { active: loader.active, shown: loader.shown, target: loader.target, kind: loader.kind, title: $('loadingTitle').textContent, sub: $('loadingSub').textContent, visible: !$('loading').hidden, fill: $('loadFill').style.width, ahead: aheadShown }; },
      setSeed(seed) { randSource = Number.isFinite(seed) ? mulberry32(seed) : Math.random; return true; },
      /* services started from now on are calm: no random red-signal holds, no temporary speed restrictions, no incidents (forcePlan and spadTest still work) */
      setCalm(on) { calmServices = !!on; return calmServices; },
      /* true once the cab view is up, the train stands still, no emergency stop is active and the camera has not moved for a few frames */
      cabSettled(minFrames = 8) {
        const w = world, s = w && w.state;
        return !!(w && s && phase === 'running' && !paused && camMode === 'cab' && $('loading').hidden && !s.spadActive && s.v < 0.01 && settle.stable >= minFrames);
      },
      /* resume: saveSnapshot() writes now, peekSnapshot() the stored JSON text, tamperSnapshot(fn) rewrites it, resumeNow() = the card's primary button */
      saveSnapshot() { if (world) armSnapshot(world.state); return snapshotReady() ? writeSnapshot() : false; },
      peekSnapshot() { return readStore(resumeKey()); },
      pokeSnapshot(textOut) { if (textOut === null) removeStore(resumeKey()); else writeStore(resumeKey(), textOut); return true; },
      resumeNow() { resumeFromMenu(); return phase; },
      start: (m, routeId, trainId) => startFromMenu(m, routeId, trainId),
      startService: (routeId, trainId, m) => startService(routeId, trainId, m || 'career'),
      teleport(i) {
        const w = world; if (!w || phase !== 'running') return false;
        const idx = stationIndexSafe(i);
        w.sim.placeBeforeStation(idx, 70, 3);
        w.plans[idx] = w.plans[idx] || planFor(idx);
        for (let k = 0; k < idx; k++) { w.sim.recordExchange(k, 0, 0); }
        if (w.onboard === 0 && idx > 0) { w.onboard = Math.round((w.cfg.capacity || 90) * 0.3); w.riders = [{ n: w.onboard, s: Math.max(0, stationsOf()[idx].s - 1500) }]; }
        spawnWaiting(idx);
        input.lever = 0; w.state = w.sim.step(0, { lever: 0, passengers: w.onboard });
        return true;
      },
      stopAtMarker(errorM = -0.8) {
        const w = world; if (!w || phase !== 'running') return false;
        const idx = w.state.nextStationIndex, st = stationsOf()[idx];
        w.sim.place(st.s + errorM, 0); input.lever = -3;
        w.state = w.sim.step(0.02, { lever: -3, passengers: w.onboard });
        return true;
      },
      setSpeed(kmh) { if (world) world.sim.setSpeed(kmh / 3.6); },
      stationReport() { return world && world.infra && world.infra.stationReport ? world.infra.stationReport() : null; },
      trackInfo() { return world ? world.track : null; },
      internals() { return { scene, camera, renderer, world, THREE }; },   // test-only: automated scenery checks (scripts/flows, tour)
      setGrade(g) { if (world) world.sim.setGradeOverride(g); },
      placeAt(s, kmh = 0) { const w = world; if (!w || phase !== 'running') return false; w.sim.place(s, kmh / 3.6); w.state = w.sim.step(0, { lever: input.lever, passengers: w.onboard }); return true; },
      forcePlan(plan) { forcedPlan = plan ? { pattern: 'RB', pass: [], tsr: [], incidents: [], ...plan } : null; },
      setHints(on) { handleHints(!!on); },
      /* scans the screen for a cab control (uses the same hit test the pointer uses): { id, notch, x, y } in client coordinates */
      findCab(id, notchWanted) {
        const w = world; if (!w || !w.cab || !w.cab.hitTest || !camera) return null;
        const rect = $('world').getBoundingClientRect(); let fallback = null;
        const wp = w.cab.getControlWorldPoint ? w.cab.getControlWorldPoint(id, notchWanted) : null;
        if (wp) {
          camera.updateMatrixWorld(true);
          const v = wp.clone().project(camera);
          const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
          const hit = cabHit({ clientX: x, clientY: y });
          if (hit && hit.id === id) return { id, notch: hit.notch, x, y };
        }
        for (let j = 1; j < 48; j++) for (let i = 1; i < 80; i++) {
          const x = rect.left + (rect.width * i) / 80, y = rect.top + (rect.height * j) / 48;
          const hit = cabHit({ clientX: x, clientY: y });
          if (hit && hit.id === id) {
            const out = { id, notch: hit.notch, x, y };
            if (notchWanted === undefined || hit.notch === notchWanted) return out;
            fallback = fallback || out;
          }
        }
        return fallback;
      },
      pointerAction(kind, x, y) { const hit = cabHit({ clientX: x, clientY: y }); return hit ? { ...hit } : null; },
      press(key) { return handleKey(key.length === 1 ? key.toLowerCase() : key, false); },
      release(key) { handleKeyUp(key.length === 1 ? key.toLowerCase() : key); },
      finishRoute() {
        const w = world; if (!w || phase !== 'running') return false;
        const last = stationsOf().length - 1;
        w.sim.placeBeforeStation(last, 40, 2);
        for (let k = 0; k < last; k++) w.sim.recordExchange(k, 0, 0);
        w.onboard = w.onboard || Math.round((w.cfg.capacity || 90) * 0.4);
        w.riders = w.riders && w.riders.length ? w.riders : [{ n: w.onboard, s: 0 }];
        w.delivered += 0;
        input.lever = 0;
        w.sim.setSpeed(0);
        spawnWaiting(last);
        w.state = w.sim.step(0.02, { lever: 0, passengers: w.onboard });
        return true;
      },
      spadTest() { const w = world; if (!w || phase !== 'running') return false; input.lever = 0; return w.sim.forceRedAhead(220, 15); },
      completeNow() { const w = world; if (!w || phase !== 'running') return false; finishService(); return true; },
      setRoute(id) { save = TS.career.selectRoute(save, id) || save; if (phase === 'menu') refreshDemoSoon(); return startService(id, TS.career.of(save, TS.career.careerOfRoute(id)).train, 'career'); },
      grant(cash, cid) { const c = save[cid || save.career]; save = TS.career.normalize({ ...save, [cid || save.career]: { ...c, lifetime: c.lifetime + cash, wallet: c.wallet + cash } }); if (phase === 'menu') renderMenu(); persist(); },
      setCareer: (cid) => handleCareer(cid),
      mergeSave: (d) => mergeIncoming(d),
      toMenu: () => returnToMenu(),
      setCamera, setQuality(q) { if (QUALITIES.includes(q) && q !== quality) { quality = q; applyQuality(); rebuildWorld(); } },
      forceSimStep: (seconds, lever) => { const w = world; if (!w) return null; if (lever !== undefined) input.lever = lever; for (let i = 0; i < Math.ceil(seconds * 60); i++) { const st = w.sim.step(SIM_STEP, { lever: input.lever, doorPress: i === 0 && input.doorPress, parkingToggle: i === 0 && input.parkingToggle, passengers: w.onboard }); input.doorPress = false; input.parkingToggle = false; w.state = st; for (const e of st.events) handleEvent(e); } return w.state.s; },
      career: () => TS.career, buy: (kind, id, extra) => handleBuy(kind, id, extra),
    });
  }

  /* ------------------------------------------------------------ boot */
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    if (!initRenderer()) return;
    bindPointer();
    phase = 'menu';
    $('menu').hidden = false;
    $('bootStatus').textContent = t('loading');
    renderMenu();
    try { await buildDemo(); } catch (error) { warn('demo failed', error); }
    $('bootStatus').textContent = '';
    if (!frameHandle) frameHandle = requestAnimationFrame(frame);
  }

  function init() {
    document.documentElement.lang = lang;
    safe('TS.setLang', () => TS.setLang && TS.setLang(lang));
    TS.lang = lang;
    buildLeverBar();
    translateStatic();
    // Merge BOTH the save the arcade injected at open time and the newer local copy: after an in-frame reload the injected one is stale.
    try { mergeIncoming(window.__pbSave); } catch (error) { warn('restore injected save', error); }
    try { mergeIncoming(JSON.parse(readStore(SAVE_KEY) || 'null')); } catch (error) { warn('restore local save', error); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (e) => { if (camMode === 'platform' && platKey(e, false)) return; handleKeyUp(normKey(e)); });
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', () => { saveSnapshotNow(); if (phase !== 'boot') persist(); });
    document.addEventListener('freeze', saveSnapshotNow);
    setInterval(saveSnapshotNow, SNAPSHOT_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { saveSnapshotNow(); releaseAll(); if (phase === 'running' && !paused) pauseGame(); safe('audio hide', () => audio && audio.setMuted(true)); persist(); }
      else { lastFrame = 0; safe('audio show', () => audio && audio.setMuted(muted)); }
    });
    window.addEventListener('message', (event) => {
      if (event.source !== parent || event.origin !== HOST_ORIGIN) return;
      if (event.data && event.data.__pbLoadSave === 1) mergeIncoming(event.data.data);
      if (event.data && event.data.__pbSndMute !== undefined) applyMute(!!event.data.__pbSndMute);
    });
    window.addEventListener('resize', checkDevice);
    window.addEventListener('beforeunload', () => { saveSnapshotNow(); if (phase !== 'boot') persist(); });
    $('kbClose').addEventListener('click', dismissNotice);
    if (parent !== window) safe('parent keydown', () => parent.addEventListener('keydown', dismissNotice, { capture: true }));   // keys typed while the arcade page still has focus
    // inside the arcade iframe some webviews report no touch points: a real touch on the page also raises the notice
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !noticeDismissed && !isPhone()) $('kbNotice').hidden = false; }, { capture: true });
    $('resume').addEventListener('click', resumeGame);
    $('quit').addEventListener('click', quitService);
    $('btnPause').addEventListener('click', () => (paused ? resumeGame() : pauseGame()));
    $('btnFast').addEventListener('click', () => toggleFast());
    $('btnRev').addEventListener('click', () => { if (phase === 'running' && !paused) input.reverseToggle = true; });
    $('btnHelp').addEventListener('click', () => toggleHelp());
    $('btnWx').addEventListener('click', (e) => { toggleWxPop(e.detail === 0); if (e.detail !== 0 && $('wxPop').hidden) $('btnWx').blur(); });
    document.addEventListener('pointerdown', (e) => { if (!$('wxPop').hidden && !e.target.closest('#wxPop,#btnWx')) closeWxPop(); }, true);
    $('helpClose').addEventListener('click', () => toggleHelp(false));
    $('btnQuality').addEventListener('click', cycleQuality);
    $('pauseQuality').addEventListener('click', cycleQuality);
    $('camName').addEventListener('click', cycleCamera);
    $('camName').style.pointerEvents = 'auto';
    { const pad = $('walkPad'), knob = $('walkKnob');   // touch walk pad (camera 3)
      const move = (e) => { const r = pad.getBoundingClientRect(), R = r.width / 2; let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } platView.vx = Math.abs(dx) > 0.2 ? dx : 0; platView.vy = Math.abs(dy) > 0.2 ? dy : 0; knob.style.transform = 'translate(' + dx * R * 0.6 + 'px,' + dy * R * 0.6 + 'px)'; };
      const stop = () => { platView.vx = platView.vy = 0; knob.style.transform = ''; };
      pad.addEventListener('pointerdown', (e) => { try { pad.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } move(e); e.preventDefault(); e.stopPropagation(); });
      pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure) move(e); });
      pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop); pad.addEventListener('lostpointercapture', stop); }
    $('btnInside').addEventListener('click', (e) => { pressInside(); if (e.detail !== 0) $('btnInside').blur(); });
    $('sumMenu').addEventListener('click', returnToMenu);
    $('sumAgain').addEventListener('click', () => { if (phase === 'summary' && world && !world.demo) startService(world.routeId, world.trainId, mode); });
    $('ttClose').addEventListener('click', () => { $('ttScreen').hidden = true; });
    $('btnMenu').addEventListener('click', (e) => { if (phase === 'running' && !paused) pauseGame(); if (e.detail !== 0) $('btnMenu').blur(); });
    try { window.Arcade.onMute((value) => applyMute(value)); window.Arcade.onRestart(() => { if (world && !world.demo && (phase === 'running' || phase === 'summary')) startService(world.routeId, world.trainId, mode); else if (phase === 'menu') { renderMenu(); refreshDemoSoon(); } }); }
    catch (error) { warn('Arcade kit hooks', error); }
    if (!ARCADE_TEST) postToHost({ __pbWantSave: 1 });
    try {
      const search = new URL(location.href).searchParams;
      testMode = search.get('test') === '1' || (parent !== window && new URL(parent.location.href).searchParams.get('test') === '1');
    } catch (error) { warn('test flag', error); }
    if (testMode) installTestHook();
    checkDevice();
  }
  init();
})();
