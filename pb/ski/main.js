/* Ski Alpen: boots one resort and runs the game.
 *   loading -> resort picker -> piste map (weather, time of day, Grafik) -> Start: 3-2-1 -> timed run with a ghost (and slalom gates on
 *   some pistes) -> finish card: again / next piste / continue onto a connected piste (free ride) / map
 * URL: ?resort=killy ?piste=<id> ?auto=1 (straight onto the piste, no screens) ?bot=1 (scripted skier) ?q=low|medium|high
 *      ?weather=sun|cloudy|snow|fog|random ?time=morning|midday|evening|random ?debug=1 (window.__ski)
 * The page is also loaded as a srcdoc iframe by the arcade: every URL is absolute or built from import.meta.url. */
import { QUALITY, FRAME_BUDGET_MS, SKI, MODES, CAMERA, LATTICE } from './config.js';
import { loadResortCore, createTileStreamer, loadExtras, RESORTS } from './resort-data.js';
import { createField, createPisteNet } from './field.js';
import { createSurface } from './surface.js';
import { setRoot } from './quadtree.js';
import { createTerrainView } from './terrain-view.js';
import { createSnowMaterial } from './snow-shader.js';
import { createEnv, createNoiseTexture, WEATHER_LABEL, TIME_LABEL } from './env.js';
import { createScatter } from './scatter.js';
import { createScatterView } from './scatter-view.js';
import { createFarForest } from './forest-far.js';
import { createShadows } from './shadows.js';
import { createPoles, createRunProps, createSigns } from './props.js';
import { createLifts } from './lifts.js';
import { createVillage } from './village.js';
import { createRoads, decodeRoads } from './roads.js';
import { createLandmarks } from './landmarks.js';
import { createPisteSet } from './pistes.js';
import { createSkierState, stepSkier } from './skier.js';
import { createSkierModel, readOutfit, writeOutfit, OUTFITS } from './skier-model.js';
import { createChaseCamera } from './camera.js';
import { createInput } from './input.js';
import { createSnowfall, createSpray } from './effects.js';
import { createRun } from './game.js';
import { createBot } from './bot.js';
import { encodeGhost, decodeGhost, ghostAt } from './ghost.js';
import { createStore, recordRun, withLast, pisteKey, createBoards, formatTime } from './progress.js';
import { createUi } from './ui.js';
import { createAudio } from './audio.js';
import { createPisteMap } from './map.js';
// round 4A: game modes (stars / snow park / free ride all day), see modes/host.js
import { parkLayoutOf, createModeHost } from './modes/host.js';
import { attachModePanel, starRow } from './modes/panel.js';

const THREE = window.THREE;
const LOAD = window.__skiLoad || { set() {}, done() {}, fail() {} };
const mark = (name) => { try { performance.mark(`ski:${name}`); } catch (error) { /* no marks */ } };
const DEFAULT_PISTE = 'diebold';
const MAX_FRAME_S = 0.05;
const HUD_EVERY = 0.1;

function param(name) {
  try { const own = new URLSearchParams(location.search).get(name); if (own !== null) return own; } catch (error) { /* ignore */ }
  try { if (window.parent !== window) return new URLSearchParams(window.parent.location.search).get(name); } catch (error) { /* cross-origin parent */ }
  return null;
}
/** Set by switchResort for the arcade frame (its URL can't carry ?map=1): the next boot opens the piste map once. */
const OPEN_MAP_KEY = 'pb_ski_open_map';
function takeOpenMapFlag() {
  try {
    const isSet = sessionStorage.getItem(OPEN_MAP_KEY) === '1';
    sessionStorage.removeItem(OPEN_MAP_KEY);
    return isSet;
  } catch (error) { return false; }
}
const GFX = () => window.ArcadeGfx || { level: () => 'medium', choice: () => 'auto', set() {}, onChange() {}, LEVELS: ['low', 'medium', 'high'], LABELS: { auto: 'Automatesch', low: 'Niddreg', medium: 'Mëttel', high: 'Héich', title: 'Grafik' }, pixelRatio: () => 1 };

async function boot() {
  mark('boot');
  const params = { resort: param('resort'), piste: param('piste'), auto: param('auto') === '1', bot: param('bot') === '1', q: param('q'), weather: param('weather'), time: param('time'), debug: param('debug') === '1' };
  // tests only: game time runs this many times faster (the physics step stays 1/120 s, so a run is the same run, only sooner)
  const timescale = params.debug ? Math.min(8, Math.max(1, Number(param('timescale')) || 1)) : 1;
  let level = ['low', 'medium', 'high'].includes(params.q) ? params.q : GFX().level();
  let quality = QUALITY[level];
  const canvas = document.getElementById('skiCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: level !== 'low', powerPreference: 'high-performance' });
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  renderer.setPixelRatio(pixelRatio());
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, quality.far * 1.3);
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[ski] WebGL context lost: reloading'); setTimeout(() => location.reload(), 600); });

  const noise = createNoiseTexture();
  const env = createEnv({ scene, noise, params });
  const shadows = createShadows({ renderer, sun: env.sun, u: env.u });
  shadows.setLevel(level);
  const ui = createUi(document.getElementById('ui'));
  const audio = createAudio({ win: window });
  const store = createStore();
  const boards = createBoards(window.Arcade);

  LOAD.set(0.25, 'Skigebitt gëtt gelueden …');
  // the resort: ?resort=, else the one picked last (the picker saves it and reloads), else Espace Killy
  const isReady = (id) => RESORTS.some((r) => r.id === id && r.ready);
  const savedResort = (store.get().last || {}).resort;
  const rid = isReady(params.resort) ? params.resort : isReady(savedResort) ? savedResort : 'killy';
  const core = await loadResortCore(rid, (p) => LOAD.set(0.25 + p * 0.45, 'Bierger ginn opgebaut …'));
  mark('core');
  const { resort } = core;
  if (resort.shadows) {
    const st = resort.far.step, m = resort.far.margin;
    env.setShadows((time) => core.root + resort.shadows.file.replace('{time}', time), [-m - st / 2, -m - st / 2, resort.far.nx * st, resort.far.nz * st]);
  }
  const net = createPisteNet(resort.network);
  const parkLayout = parkLayoutOf(resort);                                   // round 4A: the snow park is part of the height function
  const field = createField({ resort, far: core.far, classes: core.classes, net, park: parkLayout });
  const surface = createSurface(field);
  setRoot(resort.width, resort.depth);
  const streamer = createTileStreamer({ resort, field, root: core.root });
  const pistes = createPisteSet(resort);
  const scatter = createScatter(field);
  // the forest share of every 10 m class cell as a texture (the painted canopy far away; scatter.js places the near trees)
  const forestTex = (() => {
    const { nx, nz, data } = core.classes, b = resort.classes.bits;
    const px = new Uint8Array(nx * nz);
    for (let i = 0; i < px.length; i++) px[i] = data[i] & b.forest ? 255 : data[i] & b.scrub ? 150 : 0;
    const t = new THREE.DataTexture(px, nx, nz, THREE.RedFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return { texture: t, width: nx * resort.classes.step, depth: nz * resort.classes.step };
  })();
  let snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex });
  const terrain = createTerrainView({ scene, surface, field, material: snowMat, quality });
  const scatterView = createScatterView({ scene, scatter, env, quality, normalAt: (x, z, o) => surface.normal(x, z, o, 2.5) });
  const farForest = createFarForest({ scene, env, classes: core.classes, resort, field, quality });
  const poles = createPoles({ scene, resort, height: (x, z) => field.height(x, z) });
  let outfit = readOutfit();
  const skier = createSkierModel({ outfit });
  skier.setBlob(level === 'low');
  const ghostModel = createSkierModel({ ghost: true, outfit });
  const setOutfit = (id) => { outfit = id; writeOutfit(id); skier.setOutfit(id); ghostModel.setOutfit(id); };
  scene.add(skier.root, ghostModel.root);
  ghostModel.setVisible(false);
  const chase = createChaseCamera(surface);
  let snowfall = createSnowfall({ scene, env, count: quality.snowflakes });
  const spray = createSpray({ scene, count: quality.spray });
  let lifts = null, village = null, landmarks = null, roads = null, roadRows = null;
  // the village streets are draped on the 5 m ground: built once the extras and every height tile are in
  const tryRoads = () => {
    if (roads || !roadRows || !streamer.done()) return;
    try { roads = createRoads({ scene, roads: roadRows, env, height: (x, z) => field.height(x, z) }); mark('roads'); } catch (error) { console.warn('[ski] streets failed', error); roads = { update() {} }; }
  };

  // streamed height tiles change the heights under them: drop every cache that read them
  streamer.onTile((rect) => {
    surface.invalidate(...rect);
    terrain.invalidate(...rect);
    scatter.invalidate(...rect);
    scatterView.invalidate();
    farForest.invalidate(...rect);
    poles.reset();
    if (runProps && game.piste) { runProps.dispose(); runProps = createRunProps({ scene, piste: game.piste, height: (x, z) => surface.height(x, z), gates: game.run ? game.run.gates : [] }); }
    if (modes) modes.onTiles(rect);
    if (streamer.done()) document.documentElement.dataset.skiTilesDone = '1';
    if (streamer.done() && !lifts) {
      lifts = createLifts({ scene, resort, height: (x, z) => field.height(x, z) });
      createSigns({ scene, resort, height: (x, z) => field.height(x, z) });
      landmarks = createLandmarks({ scene, resort, height: (x, z) => surface.height(x, z), pistes });
      if (modes) modes.ensureParkView();
      mark('lifts');
      tryRoads();
    }
  });
  loadExtras(core.root).then(({ buildings, roads: streets }) => {
    village = createVillage({ scene, rows: buildings, env, height: (x, z) => field.baseHeight(x, z), level }); mark('village');
    roadRows = decodeRoads(streets); tryRoads();
  }).catch((error) => console.warn('[ski] buildings failed', error.message));

  // ---------------- game state ----------------
  const game = {
    screen: 'picker', piste: null, mode: MODES.run, run: null, state: null, phase: 'idle', countdown: 0, paused: false, ghost: null,
    override: null, bot: null, freeRide: false, lastNearest: 0,
  };
  let runProps = null;
  const world = {
    height: (x, z) => surface.height(x, z),
    normal: (x, z, out) => surface.normal(x, z, out),
    snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25),
    hit: (x, z, r, y) => scatter.hit(x, z, r, y, quality.treeDensity),
  };
  const input = createInput({ root: document.getElementById('ui'), onAction });
  input.showTouch(false);
  const hud = ui.createHud({ onButton: onAction });
  hud.show(false);
  // ---- round 4A: the game modes (stars, snow park, free ride all day) ----
  const modes = createModeHost({
    scene, resort, rid, pistes, field, surface, store, hud, uiRoot: document.getElementById('ui'), input, env, audio, world, layout: parkLayout,
    root: core.root, outfits: OUTFITS, onRideUp: () => rideUp(), onProgressChanged: () => refreshMapMarks(),
  });
  const outfitOpen = (o) => modes.outfitOpen(o);
  const starsText = (p) => { const m = modes.pisteInfo(p).mask; return [1, 2, 4].map((b) => (m & b ? '★' : '☆')).join(''); };
  /** The piste the map opens on: the saved one / the resort's start piste if open, else the open piste whose top is nearest to it. */
  function openPisteNear(p) {
    if (!p || modes.isOpen(p)) return p;
    let best = null, bd = Infinity;
    for (const q of pistes.list) { if (!modes.isOpen(q)) continue; const d = Math.hypot(q.top.x - p.top.x, q.top.z - p.top.z) - (q.diff === 'blue' ? 150 : 0); if (d < bd) { bd = d; best = q; } }
    return best || p;
  }

  function placeAt(x, z, heading) {
    const y = surface.height(x, z);
    game.state = createSkierState(x, z, heading, y);
    chase.snap(game.state);
  }

  function pisteBest(p) { return store.get().best[pisteKey(rid, p.id)] || 0; }
  let modePanel = null;
  function refreshMapMarks() {
    if (!mapScreen || !pisteMap) return;
    pisteMap.setMarks(modes.marks());
    mapScreen.refreshList();
    if (game.piste && modePanel) modePanel.showPiste(modes.pisteInfo(game.piste));
    updateStartStatus();
  }
  /** Round 4A: the piste map's mode tab (piste / park / freeride). */
  function setMapMode(m) {
    game.mapMode = m;
    if (!mapScreen) return;
    modePanel.setMode(m);
    pisteMap.setMode(m, modes.lifts.list);
    document.documentElement.dataset.skiMapMode = m;
    if (m === 'park') {
      modePanel.showPark({ layout: parkLayout, best: modes.parkBest(), ready: false });
      if (parkLayout) { const a = parkLayout.top, b = parkLayout.bottom; pisteMap.focusBox(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), 1200); streamer.focus(a.x, a.z); }
    } else if (m === 'freeride') {
      if (!game.freeLift) game.freeLift = modes.lifts.nearestTop(game.piste ? game.piste.top.x : resort.width / 2, game.piste ? game.piste.top.z : resort.depth / 2, 1e9);
      pickLift(game.freeLift);
    } else if (game.piste) selectPiste(game.piste, true);
    updateStartStatus();
  }
  function pickLift(l) {
    if (!l) return;
    game.freeLift = l;
    readyLift = null;
    streamer.focus(l.top.x, l.top.z);
    if (modePanel) modePanel.showFree({ lifts: modes.lifts, selected: l, ready: false });
    if (pisteMap) pisteMap.selectLift(l, true);
    updateStartStatus();
  }

  // ---------------- screens ----------------
  let picker = null, mapScreen = null, pisteMap = null, finishCard = null, menuCard = null;
  function showPicker() {
    game.screen = 'picker';
    hud.show(false); input.showTouch(false);
    picker = ui.showResorts({ current: rid, onPick: (id) => { if (id && id !== rid) { switchResort(id); return; } picker.close(); picker = null; showMap(); } });
    document.documentElement.dataset.skiScreen = 'picker';
  }
  /** Another resort: one resort per page life (its tiles, textures and caches go with it), so remember the pick and load the page again,
   * straight onto that resort's piste map. Standalone: ?resort=<id>&map=1 (shareable). In the arcade's srcdoc frame the URL can't change:
   * the saved pick chooses the resort and a session flag opens the map. */
  function switchResort(id) {
    store.set(withLast(store.get(), id, null));
    LOAD.set(0.1, 'Skigebitt gëtt gewiesselt …');
    try { sessionStorage.setItem(OPEN_MAP_KEY, '1'); } catch (error) { /* private mode: the picker shows again */ }
    try {
      const u = new URL(location.href);
      if (/^https?:$/.test(u.protocol)) {
        u.searchParams.set('resort', id); u.searchParams.set('map', '1'); u.searchParams.delete('piste');
        location.replace(u.href); return;
      }
    } catch (error) { /* about:srcdoc inside the arcade: a plain reload */ }
    location.reload();
  }
  function showMap() {
    game.screen = 'map';
    game.phase = 'idle';
    hud.show(false); input.showTouch(false); input.setEnabled(false);
    if (finishCard) { finishCard.close(); finishCard = null; }
    modes.end();
    mapScreen = ui.showMap({
      resort, pistes, best: pisteBest, env, gfx: GFX(), outfits: OUTFITS, outfit: () => outfit, onOutfit: setOutfit,
      outfitOpen, starsOf: starsText, lockedOf: (p) => !modes.isOpen(p),
      onSelect: (p, center) => selectPiste(p, center),
      onStart: () => startRun(game.piste, MODES.run),
      onBack: () => { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; showPicker(); },
    });
    pisteMap = createPisteMap({ canvas: mapScreen.canvas, resort, imageUrl: core.root + resort.map.file, pistes, onPick: (p) => selectPiste(p, false), onPickLift: (l) => pickLift(l) });
    mapScreen.zoomButtons.forEach((b) => b.addEventListener('click', () => pisteMap.zoomBy(b.dataset.z === 'in' ? 1.5 : 1 / 1.5)));
    modePanel = attachModePanel(mapScreen.el, { onMode: (m) => setMapMode(m), onParkStart: () => startPark(), onFreeStart: () => startFree(game.freeLift), onPickLift: (l) => pickLift(l) });
    pisteMap.setPark(resort.park ? { line: resort.park.line, name: resort.park.name } : null);
    pisteMap.setMarks(modes.marks());
    const last = store.get().last;
    const first = openPisteNear((last && last.resort === rid && pistes.byId.get(last.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
    selectPiste(first, true);
    if (game.mapMode && game.mapMode !== 'piste') setMapMode(game.mapMode);
    document.documentElement.dataset.skiScreen = 'map';
  }
  function selectPiste(p, center) {
    if (!p) return;
    game.piste = p;
    streamer.focus(p.top.x, p.top.z);
    const a = p.at(2, {});
    placeAt(a.x, a.z, Math.atan2(a.dz, a.dx));
    boards.select(rid, p, resort.short);
    if (mapScreen) { mapScreen.show(p, pisteBest(p)); pisteMap.select(p, center); if (modePanel) modePanel.showPiste(modes.pisteInfo(p)); }
    updateStartStatus();
  }
  let readyFor = null, readyPark = false, readyLift = null;
  function updateStartStatus() {
    if (!mapScreen || !game.piste) return;
    const p = game.piste;
    const pending = streamer.pendingNear(p.top.x, p.top.z, 1500);
    // once a piste was ready it stays ready (tiles streaming in elsewhere re-queue terrain work: Start must not flicker off under a tap)
    const ready = readyFor === p.id || (pending === 0 && terrain.stats.pending === 0);
    const open = modes.isOpen(p);
    mapScreen.status(!open ? 'Gespaart: méi Stäre sammelen.' : ready ? 'Prett.' : `Pist gëtt gelueden … (${pending} Stécker)`, ready && open);
    document.documentElement.dataset.skiStartReady = ready && open ? '1' : '0';
    document.documentElement.dataset.skiLocked = open ? '0' : '1';
    readyFor = ready ? p.id : null;
    // round 4A: the park and the free ride start spot
    if (modePanel && game.mapMode === 'park' && parkLayout) {
      readyPark = readyPark || (streamer.pendingNear(parkLayout.top.x, parkLayout.top.z, 900) === 0 && terrain.stats.pending === 0);
      modePanel.parkReady(readyPark);
      document.documentElement.dataset.skiParkReady = readyPark ? '1' : '0';
    }
    if (modePanel && game.mapMode === 'freeride' && game.freeLift) {
      const l = game.freeLift;
      const ok = readyLift === l.id || (streamer.pendingNear(l.top.x, l.top.z, 1200) === 0 && terrain.stats.pending === 0);
      readyLift = ok ? l.id : null;
      modePanel.freeReady(ok);
      document.documentElement.dataset.skiFreeReady = ok ? '1' : '0';
    }
  }

  function startRun(p, mode) {
    if (!p) return;
    if (mode === MODES.run && !modes.isOpen(p) && !params.debug) { hud.toast('Gespaart'); return; }
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    if (finishCard) { finishCard.close(); finishCard = null; }
    game.screen = 'ski';
    document.documentElement.dataset.skiScreen = 'ski';
    game.piste = p;
    game.mode = mode;
    game.run = createRun({ piste: p, mode });
    const a = p.at(2, {});
    placeAt(a.x, a.z, Math.atan2(a.dz, a.dx));
    if (runProps) runProps.dispose();
    runProps = createRunProps({ scene, piste: p, height: (x, z) => surface.height(x, z), gates: game.run.gates });
    const g = mode === MODES.run ? decodeGhost(store.get().ghosts[pisteKey(rid, p.id)]) : null;
    game.ghost = g;
    ghostModel.setVisible(false);
    game.bot = params.bot && mode !== MODES.park ? createBot(p) : null;
    game.assisted = false;
    if (mode !== MODES.park) { store.set(withLast(store.get(), rid, p.id)); boards.select(rid, p, resort.short); }
    modes.begin(game);                                                       // round 4A: stars / park / free ride parts
    hud.show(true); hud.setPiste(p, mode); hud.setClock(mode === MODES.run ? 0 : null, 0); hud.setSplit(''); hud.setGates(game.run.gates.length ? `Slalom: 0 / ${game.run.gates.length}` : '');
    input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    input.setEnabled(true);
    streamer.focus(a.x, a.z);
    if (mode === MODES.run || mode === MODES.park) { game.phase = 'countdown'; game.countdown = params.auto ? 0.01 : 3; }
    else { game.phase = 'running'; hud.count(''); }
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('start');
  }

  function finish(ev) {
    game.phase = 'finished';
    audio.event('finish');
    input.setEnabled(false);
    const p = game.piste;
    const key = pisteKey(rid, p.id);
    let improved = false;
    let result = null;
    const assisted = (game.bot || game.override || game.assisted) && !window.__skiAllowBotScore;     // a scripted run never counts (flows may opt in)
    if (ev && game.mode === MODES.run) {
      result = assisted ? { ...ev, valid: false, assisted: true } : ev;
      if (ev.valid && !assisted) {
        const ghost = encodeGhost(game.run.samples());
        const r = recordRun(store.get(), key, ev.ms, ghost);
        store.set(r.progress);
        improved = r.improved;
        boards.submit(rid, p, resort.short, ev.ms);
      }
    }
    hud.count('');
    if (game.mode === MODES.park) {                                          // round 4A: the park card (points, record, tricks)
      finishCard = modes.finishPark({ assisted, onAgain: () => startPark(), onMap: () => showMap() });
      document.documentElement.dataset.skiScreen = 'finish';
      document.documentElement.dataset.skiLast = 'park';
      return;
    }
    const extra = game.mode === MODES.run ? modes.finishRun(ev, p, assisted) : '';
    if (game.mode === MODES.run && ev && ev.valid && !assisted) refreshMapMarks();
    const conts = pistes.continuations(p).filter((q) => modes.isOpen(q));
    const order = pistes.list.filter((q) => q === p || modes.isOpen(q));
    const next = conts[0] || order[(order.indexOf(p) + 1) % order.length];
    const cont = conts[0] || null;
    finishCard = ui.showFinish({
      piste: p, result, bestMs: store.get().best[key] || 0, improved, next, cont: cont && cont !== next ? cont : (cont ? cont : null), extra,
      onAgain: () => startRun(p, MODES.run),
      onNext: () => startRun(next, MODES.run),
      onContinue: () => continueFree(cont),
      onMap: () => showMap(),
    });
    document.documentElement.dataset.skiScreen = 'finish';
    document.documentElement.dataset.skiLast = result ? String(result.ms) : 'free';
  }

  /** Free ride from where the skier stands onto a connected piste: no clock, the piste is only the guide line. */
  function continueFree(p) {
    if (!p) { showMap(); return; }
    const keep = game.state;
    startRun(p, MODES.free);
    if (keep && Math.hypot(keep.x - p.top.x, keep.z - p.top.z) < 150) { game.state = { ...keep, crash: 0 }; chase.snap(game.state); }
    hud.toast(`Weider op: ${p.name}`);
  }

  function respawn(text) {
    if (!game.run) return;
    const r = game.run.respawnPoint();
    placeAt(r.x, r.z, r.heading);
    if (text) hud.toast(text);
  }

  // ---- round 4A: snow park run, free ride all day, the lift ----
  function startPark() {
    if (!parkLayout) { hud.toast('Kee Snowpark hei'); return; }
    startRun(parkLayout.run, MODES.park);
  }
  function startFree(lift) {
    if (!lift) return;
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    if (finishCard) { finishCard.close(); finishCard = null; }
    game.screen = 'ski';
    document.documentElement.dataset.skiScreen = 'ski';
    game.mode = MODES.freeride;
    game.freeLift = lift;
    const spot = modes.lifts.startAt(lift, (x, z) => surface.height(x, z));
    const near = pistes.nearest(spot.x, spot.z, 400);
    game.piste = near ? near.piste : game.piste;
    if (runProps) { runProps.dispose(); runProps = null; }
    game.ghost = null; ghostModel.setVisible(false);
    game.bot = null; game.assisted = false;
    modes.begin(game);
    game.run = modes.createRun(game, spot);
    placeAt(spot.x, spot.z, spot.heading);
    hud.show(true); hud.setPiste(null, MODES.freeride); hud.setClock(null, 0); hud.setSplit(''); hud.setGates('');
    input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    input.setEnabled(true);
    streamer.focus(spot.x, spot.z);
    game.phase = 'running'; hud.count('');
    document.documentElement.dataset.skiRunning = '1';
    hud.toast(`Fräi fueren: ${lift.name}`);
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('free');
  }
  let riding = false;
  /** At a lift's bottom: fade out, wait for the tiles at the top (at most 4 s), up, fade in. */
  async function rideUp() {
    if (game.mode !== MODES.freeride || game.phase !== 'running' || riding || !modes.liftAt) return;
    const r = modes.rideUp();
    if (!r) { hud.toast('D\'Lifte sinn zou'); return; }
    riding = true;
    input.setEnabled(false);
    const fade = document.getElementById('skiFade') || Object.assign(document.createElement('div'), { id: 'skiFade' });
    if (!fade.parentNode) document.getElementById('ui').appendChild(fade);
    fade.classList.add('on');
    audio.event('count');
    streamer.focus(r.spot.x, r.spot.z);
    await Promise.race([streamer.ready(r.spot.x, r.spot.z, 500), new Promise((res) => setTimeout(res, 4000))]);
    await new Promise((res) => setTimeout(res, 350));
    placeAt(r.spot.x, r.spot.z, r.spot.heading);
    fade.classList.remove('on');
    input.setEnabled(true);
    riding = false;
    hud.toast(`${r.lift.name}: uewen op ${Math.round(r.lift.top.y)} m`);
    document.documentElement.dataset.skiLifts = String(modes.freeRun ? modes.freeRun.stats.lifts : 0);
  }
  /** Again in the current mode (menu, Arcade restart). */
  function again() {
    if (game.mode === MODES.park) startPark();
    else if (game.mode === MODES.freeride) showMap();
    else if (game.piste) startRun(game.piste, MODES.run);
  }

  function openMenu() {
    if (game.screen !== 'ski' || menuCard || finishCard) return;
    game.paused = true;
    input.setEnabled(false);
    menuCard = ui.showMenu({
      env, gfx: GFX(), outfits: OUTFITS, outfit: () => outfit, onOutfit: setOutfit, outfitOpen, sound: { muted: () => audio.isMuted(), set: (m) => audio.setMuted(m) },
      againLabel: game.mode === MODES.freeride ? 'Neie Startpunkt' : game.mode === MODES.park ? 'Park nach eng Kéier' : 'Nach eng Kéier',
      onResume: () => { menuCard = null; game.paused = false; input.setEnabled(game.phase !== 'finished'); },
      onAgain: () => { menuCard = null; game.paused = false; again(); },
      onMap: () => { menuCard = null; game.paused = false; showMap(); },
    });
  }

  function onAction(action) {
    if (action === 'weather') { const m = env.cycleWeather(); hud.toast(`Wieder: ${WEATHER_LABEL[m]}${m === 'random' ? ` (${WEATHER_LABEL[env.state.weatherId]})` : ''}`); }
    else if (action === 'time') { const m = env.cycleTime(); hud.toast(`Zäit: ${TIME_LABEL[m]}${m === 'random' ? ` (${TIME_LABEL[env.state.timeId]})` : ''}`); }
    else if (action === 'reset') { if (game.screen === 'ski' && game.phase === 'running') respawn('Zréck op d\'Pist'); }
    else if (action === 'menu') { if (menuCard) { menuCard.close(); menuCard = null; game.paused = false; input.setEnabled(true); } else openMenu(); }
    else if (action === 'map') { if (game.screen === 'ski') showMap(); }
    else if (action === 'mute') { const next = !audio.isMuted(); audio.setMuted(next); hud.toast(next ? 'Toun aus' : 'Toun un'); }
    else if (action === 'lift') rideUp();
    else if (action === 'confirm') {
      if (game.screen === 'ski' && game.mode === MODES.freeride) rideUp();
      else if (game.screen === 'map' && game.mapMode === 'park') { if (readyPark) startPark(); }
      else if (game.screen === 'map' && game.mapMode === 'freeride') { if (readyLift) startFree(game.freeLift); }
      else if (game.screen === 'map' && readyFor && modes.isOpen(game.piste)) startRun(game.piste, MODES.run);
    }
  }
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => again());

  // quality: the shared Grafik level; a watchdog only ever steps down
  function applyQuality(next) {
    level = next; quality = QUALITY[level];
    renderer.setPixelRatio(pixelRatio()); resize();
    camera.far = quality.far * 1.3; camera.updateProjectionMatrix();
    snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex });
    terrain.setMaterial(snowMat);
    scatterView.setQuality(quality);
    farForest.setQuality(quality);
    shadows.setLevel(level);
    if (village) village.setLevel(level);
    skier.setBlob(level === 'low');
    poles.reset();
    mark(`quality ${level}`);
  }
  GFX().onChange((l) => { if (!params.q) applyQuality(l); });
  let slowFor = 0;

  // ---------------- loop ----------------
  let last = performance.now(), acc = 0, hudT = 0, time = 0, audioT = 0, liftDist = Infinity, nearVillage = 0;
  const ghostPos = {};
  const frameTimes = [];
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    const rawDt = (now - last) / 1000;
    frameTimes.push(rawDt * 1000); if (frameTimes.length > 240) frameTimes.shift();
    last = now;
    const dt = Math.min(MAX_FRAME_S, rawDt);
    time += dt;
    const s = game.state;
    if (game.screen === 'ski' && !game.paused && s) {
      if (game.phase === 'countdown') {
        game.countdown -= dt;
        hud.count(game.countdown > 0 ? String(Math.ceil(game.countdown)) : 'Lass!');
        const tick = Math.ceil(game.countdown);
        if (tick !== game.lastTick) { game.lastTick = tick; if (tick > 0) audio.event('count'); }
        if (game.countdown <= 0) { audio.event('go'); game.phase = 'running'; document.documentElement.dataset.skiRunning = '1'; setTimeout(() => hud.count(''), 700); mark('go'); }
      }
      if (game.phase === 'running' || game.phase === 'finished') {
        acc += dt * timescale;
        let steps = 0;
        while (acc >= SKI.dt && steps < 6 * timescale) {
          acc -= SKI.dt; steps++;
          const inp = game.phase === 'finished' ? { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }
            : game.override ? game.override : game.bot ? game.bot(game.state) : input.read();
          if (game.override || game.bot) game.assisted = true;
          if (game.override || game.bot) input.read(inp);
          const wasCrash = game.state.crash > 0, wasAir = !game.state.grounded, vyAir = game.state.vy;
          const prevState = game.state;
          game.state = modes.step(prevState, inp, game.mode);                // round 4A: rails / park tricks, else stepSkier
          if (wasAir && game.state.grounded && game.state.crash === 0) audio.event('land', { impact: Math.min(1, Math.abs(vyAir) / 8) });
          if (!wasCrash && game.state.crash > 0) audio.event('crash');
          if (!wasCrash && game.state.crash > 0) hud.toast(game.state.crashKind === 'tree' ? 'Aua, e Bam!' : game.state.crashKind === 'rock' ? 'Aua, e Steen!' : 'Gefall!');
          if (wasCrash && game.state.crash === 0) respawn('');
          modes.after(prevState, game.state, SKI.dt, game);
          if (game.phase === 'running') {
            const events = game.run.update(game.state, SKI.dt);
            for (const ev of events) {
              if (ev.type === 'lift') { modes.freeEvent(ev); continue; }
              if (ev.type === 'finish' || ev.type === 'invalid') { finish(ev); break; }
              if (ev.type === 'offpiste') respawn('Zréck op d\'Pist');
              if (ev.type === 'missed-gate') { audio.event('miss'); hud.toast('Paart verpasst: +5 s'); if (runProps) runProps.markGate(ev.index, false); }
              if (ev.type === 'gate') audio.event(ev.ok === false ? 'miss' : 'gate');
            }
            if (game.mode !== MODES.run && game.run.progress > game.piste.length - 15 && game.phase === 'running') finish(null);
          }
        }
        if (acc > SKI.dt * 6 * timescale) acc = 0;
      } else acc = 0;
    }
    const st = game.state;
    if (st) {
      skier.pose(st, (x, z, o) => surface.normal(x, z, o), time, (x, z) => surface.height(x, z));
      if (game.orbit) {                                                // debug: a camera that circles the skier (model checks)
        const o = game.orbit, a = st.heading + o.angle * Math.PI / 180;
        game.camPose = { x: st.x + Math.cos(a) * o.dist, z: st.z + Math.sin(a) * o.dist, y: st.y + o.h, tx: st.x, ty: st.y + 0.8, tz: st.z, fov: o.fov || 40 };
      }
      const cam = game.camPose || chase.update(st, dt, time);        // camPose: a fixed view (reference-photo comparisons, flows)
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      // ghost of the best run
      if (game.ghost && game.screen === 'ski' && game.run && game.run.timed && game.phase !== 'countdown') {
        const gq = ghostAt(game.ghost, game.run.elapsed * 1000);
        const p = game.piste.at(gq.s, {});
        ghostPos.x = p.x - p.dz * gq.o; ghostPos.z = p.z + p.dx * gq.o;
        ghostModel.setVisible(Math.hypot(ghostPos.x - st.x, ghostPos.z - st.z) > 1.2);
        const gs = { x: ghostPos.x, z: ghostPos.z, y: surface.height(ghostPos.x, ghostPos.z), heading: Math.atan2(p.dz, p.dx), edge: 0, tuck: gq.speed > 14 ? 1 : 0.3, brake: 0, grounded: true, air: 0, crash: 0, landed: 0, vx: 0, vy: 0, vz: 0 };
        ghostModel.pose(gs, (x, z, o) => surface.normal(x, z, o), time);
      } else ghostModel.setVisible(false);
      // spray: carving hard, braking, or skidding
      const amount = game.screen === 'ski' && st.grounded && st.speed > 3 ? Math.min(1, st.slip * 2.5 + st.brake * 0.8 + Math.abs(st.edge) * 0.35) * Math.min(1, st.speed / 12) : 0;
      spray.update(dt, st, amount, pixelRatio());
    }
    // world upkeep (time-sliced)
    const fx = st ? st.x : resort.width / 2, fz = st ? st.z : resort.depth / 2;
    if (game.screen === 'ski' || game.screen === 'map') {
      streamer.focus(fx, fz);
      terrain.update(camera.position.x, camera.position.z, game.screen === 'map' ? 12 : 2.5);
      scatterView.update(camera.position.x, camera.position.z, false, game.screen === 'map' ? 12 : 2.5, dt);
      farForest.update(camera.position.x, camera.position.z, game.screen === 'map' ? 8 : 1.5);
      poles.update(camera.position.x, camera.position.z, quality.markerRadius);
      if (lifts) lifts.update(time, camera.position.x, camera.position.z, quality.liftRadius);
      if (village) village.update(camera.position.x, camera.position.z, quality.buildingRadius);
      if (landmarks) landmarks.update(camera.position.x, camera.position.z, quality.buildingRadius);
      if (roads) roads.update(camera.position.x, camera.position.z, quality.buildingRadius);
      modes.update(camera.position.x, camera.position.z, quality.buildingRadius);
    }
    env.update(dt, time, camera);
    snowfall.update(time, camera, pixelRatio());
    if (game.screen === 'ski') {
      const t0 = performance.now();
      shadows.update(camera, env.u.uSunDir.value, env.sunStrength());
      renderer.render(scene, camera);
      if (!params.q && game.phase === 'running' && level !== 'low') {
        slowFor = rawDt * 1000 > FRAME_BUDGET_MS[level] ? slowFor + rawDt : Math.max(0, slowFor - rawDt * 0.5);
        if (slowFor > 3) { slowFor = 0; const down = level === 'high' ? 'medium' : 'low'; applyQuality(down); hud.toast(`Grafik: ${GFX().LABELS[down]}`); }
      }
      void t0;
    }
    if (st && audioT >= 0.05) {
      audioT = 0;
      const riding = game.screen === 'ski' && (game.phase === 'running' || game.phase === 'finished');
      const info3 = surface.info(st.x, st.z, 3);
      audio.update({
        riding, paused: game.paused, speed: st.speed, edge: st.edge, slip: st.slip, brake: st.brake, grounded: st.grounded,
        piste: surface.info(st.x, st.z, 0), forest: surface.info(st.x, st.z, 1), village: Math.max(0, -info3) > 0.05 ? 1 : nearVillage,
        lift: lifts ? liftDist : Infinity, altitude: st.y, weather: env.state.weatherId,
      });
    }
    audioT += dt;
    hudT += dt;
    if (hudT >= HUD_EVERY) {
      if (st && lifts) liftDist = lifts.nearest(st.x, st.z);
      if (st) nearVillage = village ? Math.max(0, Math.min(1, -surface.info(st.x + 60, st.z, 3) - surface.info(st.x - 60, st.z, 3) - surface.info(st.x, st.z + 60, 3) - surface.info(st.x, st.z - 60, 3))) * 0.6 : 0;
      hudT = 0;
      if (st) env.setSunScale(sunVisibility(st.x, st.y + 1, st.z));
      if (game.screen === 'map') updateStartStatus();
      if (game.screen === 'ski' && st) {
        hud.setSpeed(st.speed * 3.6);
        hud.setEnv(env.state.weatherId, env.state.timeId);
        if (game.run && game.run.timed && game.phase !== 'countdown') {
          hud.setClock(game.run.ms, game.run.penalty);
          if (game.run.gates.length) hud.setGates(`Slalom: ${game.run.gates.filter((g) => g.result === true).length} / ${game.run.gates.length}`);
          if (game.ghost) { const gq = ghostAt(game.ghost, game.run.elapsed * 1000); const d = game.run.progress - gq.s; hud.setSplit(`Geescht ${d >= 0 ? '+' : ''}${Math.round(d)} m`); }
        }
        if (game.mode === MODES.free && time - game.lastNearest > 1) {
          game.lastNearest = time;
          const n = pistes.nearest(st.x, st.z, 120);
          hud.setPiste(n ? n.piste : game.piste, MODES.free);
        }
        if (game.mode === MODES.freeride && time - game.lastNearest > 1) { game.lastNearest = time; hud.setPiste(game.run && game.run.piste, MODES.freeride); }
        modes.hudTick(game);
      }
    }
  }

  /** Is the sun hidden by a ridge at this point? A ray towards the sun over the far grid (the same rule as the baked shadow rasters). */
  function sunVisibility(x, y, z) {
    const sd = env.sunDir();
    const a = sd.az * Math.PI / 180, e = sd.el * Math.PI / 180;
    const dx = Math.sin(a), dz = -Math.cos(a), t = Math.tan(e);
    let shade = 0;
    for (let d = 40; d < 9000; d *= 1.18) shade = Math.max(shade, Math.min(1, (field.farHeight(x + dx * d, z + dz * d) - (y + d * t)) / (12 + d * 0.04)));
    return 0.25 + 0.75 * (1 - shade);
  }

  // debug / flows
  window.__ski = {
    get game() { return game; }, get state() { return game.state; }, get level() { return level; }, renderer, scene, camera, env, pistes, get landmarks() { return landmarks; }, streamer, terrain, scatterView, field, surface,
    setInput(o) { game.override = o; },
    /** Debug camera circling the skier: angle (deg from the skier's heading), distance, height; null = off. */
    orbit(angle, dist = 4, h = 1.2, fov = 40) { if (angle === null) { game.orbit = null; game.camPose = null; return; } game.orbit = { angle, dist, h, fov }; },
    /** Fixed camera at (x, z) heightAbove m over the ground looking at (tx, tz) heightAbove2 m over its ground; null = chase camera again. */
    setCamera(x, z, above, tx, tz, above2 = 0, fov = 55) { if (x === null) { game.camPose = null; return; } game.camPose = { x, z, y: field.height(x, z) + above, tx, tz, ty: field.height(tx, tz) + above2, fov }; streamer.focus(x, z); }, start(id) { startRun(pistes.byId.get(id) || game.piste, MODES.run); }, select(id) { selectPiste(pistes.byId.get(id), true); },
    frames: () => { const f = [...frameTimes].sort((a, b) => a - b); return { n: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1] }; },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: terrain.stats.leaves, trees: scatterView.stats.trees, cards: farForest.stats.cards, tilesLoaded: streamer.stats.loaded, tilesTotal: streamer.stats.total, level }),
    teleport(s) { if (game.run) { const p = game.piste.at(s, {}); placeAt(p.x, p.z, Math.atan2(p.dz, p.dx)); } },
    progress: () => store.get(),
    // round 4A
    modes, parkLayout, startPark, startFree: (id) => startFree(id ? modes.lifts.byId.get(id) : game.freeLift || modes.lifts.list[0]), rideUp, setMapMode,
    place(x, z, heading) { placeAt(x, z, heading); },
  };

  // first build around the default piste behind the loading screen, then the picker (or straight onto the piste with ?auto=1)
  LOAD.set(0.75, 'Pisten ginn opgebaut …');
  const lastRun = store.get().last || {};
  const startPiste = pistes.byId.get(params.piste) || openPisteNear((lastRun.resort === rid && pistes.byId.get(lastRun.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
  game.piste = startPiste;
  const a0 = startPiste.at(2, {});
  streamer.focus(a0.x, a0.z);
  placeAt(a0.x, a0.z, Math.atan2(a0.dz, a0.dx));
  const camOut = chase.update(game.state, 0.016, 0);
  camera.position.set(camOut.x, camOut.y, camOut.z);
  terrain.buildAll(camOut.x, camOut.z);
  farForest.update(camOut.x, camOut.z, Infinity);
  renderer.compile(scene, camera);
  mark('first build');
  requestAnimationFrame(frame);
  LOAD.set(0.95, '');
  LOAD.done();
  document.documentElement.dataset.skiReady = '1';
  modes.start();                                                             // round 4A: the cloud save (arcade game_saves)
  if (params.auto) {
    await streamer.ready(a0.x, a0.z, 1500);
    placeAt(a0.x, a0.z, Math.atan2(a0.dz, a0.dx));
    startRun(startPiste, MODES.run);
  } else if (param('map') === '1' || takeOpenMapFlag()) showMap();          // came from the picker of another resort (switchResort)
  else showPicker();
  mark('ready');
}

boot().catch((error) => {
  console.error('[ski] boot failed', error);
  document.documentElement.dataset.bootError = error.message || 'boot';
  LOAD.fail(`Feeler: ${error.message}`);
});
