/* Ski Alpen: boots one resort and runs the game.
 *   round 6: loading -> resort picker -> FREE RIDE (the main game) from a village lift's bottom station: ski anywhere, ride the real
 *   lifts (chairs, cabins, drag lifts, trains), ski into a challenge's start gate -> 3-2-1 -> timed run with a ghost -> finish card ->
 *   free riding on from the bottom. The piste map is the pause overlay: where you are, fast travel to any lift, the challenge list (as
 *   before: piste -> Start), the snow park, the ski types.
 * URL: ?resort=killy ?piste=<id> ?auto=1 (straight onto the piste, no screens) ?bot=1 (scripted skier) ?q=low|medium|high
 *      ?weather=sun|cloudy|snow|fog|random ?time=morning|midday|evening|random ?debug=1 (window.__ski)
 * The page is also loaded as a srcdoc iframe by the arcade: every URL is absolute or built from import.meta.url. */
import { QUALITY, FRAME_BUDGET_MS, SKI, MODES, CAMERA, LATTICE, DATA } from './config.js';
import { loadResortCore, createTileStreamer, loadExtras, RESORTS } from './resort-data.js';
import { createField, createPisteNet } from './field.js';
import { createSurface } from './surface.js';
import { setRoot } from './quadtree.js';
import { createTerrainView } from './terrain-view.js';
import { createSnowMaterial, parkUniforms } from './snow-shader.js';
import { createEnv, createNoiseTexture, createDetailTexture, createFarNormalTexture, WEATHER_LABEL, TIME_LABEL } from './env.js';
import { createScatter } from './scatter.js';
import { createScatterView } from './scatter-view.js';
import { createFarForest } from './forest-far.js';
import { createShadows } from './shadows.js';
import { createPost } from './post.js';
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
import { createSnowfall, createSpray, createTracks } from './effects.js';
import { createFirstPersonCamera, readCamMode, writeCamMode, FP } from './fpcam.js';
import { createRun } from './game.js';
import { createBot } from './bot.js';
import { encodeGhost, decodeGhost, ghostAt } from './ghost.js';
import { createStore, recordRun, withLast, pisteKey, createBoards, formatTime } from './progress.js';
import { createUi } from './ui.js';
import { createAudio } from './audio.js';
import { createPisteMap } from './map.js';
import { readMpContext, mpResort, createMp } from './net/index.js';
import { createMpFree } from './net/freeride.js';
import { createAvalanches } from './modes/avalanche.js';
import { createParkBodies } from './modes/views.js';
// round 4A: game modes (stars / snow park / free ride all day), see modes/host.js
import { parkLayoutOf, createModeHost } from './modes/host.js';
import { attachModePanel, starRow, createRideHud, createChallengePrompt, showSkiCard } from './modes/panel.js';
// round 6: lift rides, challenge gates on the mountain, ski types
import { createRide, rideCamera, RIDE } from './modes/liftride.js';
import { createCarrier } from './modes/carriers.js';
import { createTunnel } from './modes/tunnel.js';
import { createMarkers, markerList, MARKER } from './modes/markers.js';
import { SKI_BY_ID, DEFAULT_SKI, skiParams, addSkiStats, skiOpen } from './modes/skis.js';
import { spawnLift } from './modes/freeride.js';
import { firstLift, liftSpot, exitSpot, buildingBoxes, createBoxIndex } from './modes/spawn.js';
import { createLook, applyLook, createCameraGuard } from './look.js';             // round 7 (A): free look + camera collision
import { pisteStars, specialText } from './modes/challenges.js';

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
/** Set by switchResort for the arcade frame (its URL can't carry ?go=1): the next boot goes straight into the free ride ('free') or onto
 *  the piste map ('1') once. */
const OPEN_MAP_KEY = 'pb_ski_open_map';
function takeOpenMapFlag() {
  try {
    const v = sessionStorage.getItem(OPEN_MAP_KEY);
    sessionStorage.removeItem(OPEN_MAP_KEY);
    return v === '1' || v === 'free' ? v : null;
  } catch (error) { return null; }
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
  // round 5: the scene goes through post.js (internal resolution, MSAA, FXAA + sharpen onto the canvas), so the canvas itself needs no antialias
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // round 7 (A): a shader that fails to compile (Safari / WebKit differ from Chromium) must never silently ruin the whole look: it is
  // recorded, and the picture check below steps down to safer paths (cheap snow, no MSAA, no post pass)
  const shaderErrors = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || '');
    shaderErrors.push(log.slice(0, 400));
    console.error('[ski] shader failed to compile', log.slice(0, 600));
    document.documentElement.dataset.skiShaderError = String(shaderErrors.length);
  };
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  let post = null;
  const pixelRatio = () => (post ? post.ratio() : 1);                  // the internal pixel ratio (point sprites)
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, quality.far * 1.3);
  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    if (post) post.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[ski] WebGL context lost: reloading'); setTimeout(() => location.reload(), 600); });

  const noise = createNoiseTexture();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  noise.anisotropy = Math.min(4, maxAniso);
  const detail = createDetailTexture(Math.min(8, maxAniso));           // round 5: fine ground detail (grain, crags, sparkle)
  const env = createEnv({ scene, noise, detail, params });
  Object.assign(env.u, parkUniforms(), { uFarEnd: { value: quality.far } });      // round 7 (A): + the horizon fade (FOG_GLSL)                                   // round 7: the park bodies cut the terrain (before any snow material)
  post = createPost({ renderer, spec: quality.res, first: env.sky });
  if (param('res') === 'fixed') post.setDynamic(false);                 // ?res=fixed: tests that compare pictures keep the starting resolution
  resize();
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
  // online race (lobby context from mp-gate.js): the match decides the resort, the same on every player's device
  const mpCtx = readMpContext();
  const mpFreeMode = !!(mpCtx && mpCtx.cfg && mpCtx.cfg.mode === 'free');         // round 7: an online free ride (else a race)
  let mp = null, mpf = null;
  const rid = mpCtx ? mpResort(mpCtx, RESORTS.filter((r) => r.ready).map((r) => r.id))
    : isReady(params.resort) ? params.resort : isReady(savedResort) ? savedResort : 'killy';
  const core = await loadResortCore(rid, (p) => LOAD.set(0.25 + p * 0.45, 'Bierger ginn opgebaut …'));
  mark('core');
  const { resort } = core;
  {
    const st = resort.far.step, m = resort.far.margin;
    const farRect = [-m - st / 2, -m - st / 2, resort.far.nx * st, resort.far.nz * st];      // the far grid's rectangle (pixel edges)
    env.u.uShadowRect.value.set(...farRect);
    if (resort.shadows) env.setShadows((time) => core.root + resort.shadows.file.replace('{time}', time), farRect);
    env.setFarNormals(createFarNormalTexture(core.far, st));               // round 5: the far mountains are lit per pixel from the 40 m grid
    mark('far normals');
  }
  const net = createPisteNet(resort.network);
  const parkLayout = parkLayoutOf(resort);                                   // round 4A: the snow park is part of the height function
  const field = createField({ resort, far: core.far, classes: core.classes, net, park: parkLayout });
  const surface = createSurface(field);
  setRoot(resort.width, resort.depth);
  const streamer = createTileStreamer({ resort, field, root: core.root });
  streamer.hold(DATA.startRadius + 200);                    // first play: only the tiles around the start, the rest after Start is live
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
  let snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex, lodScale: quality.lodScale });
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
  // ---- round 7 (A): free 360 look (drag / right mouse / C + mouse) and the camera guard (never through ground, pylons, trees, houses) ----
  const look = createLook({ el: document.getElementById('shell'), accept: (e) => game.screen === 'ski' && !e.target.closest('button, a, input, .pad, #touchControls, .card, .minimap, .chprompt, .mp-bar, .mp-card, [role="dialog"]') });
  let pylonGrid = null;                                     // 20 m buckets of [x, z, topY, r] (pylons, the station halls), built with the lifts
  function pylonsOf(l) {
    const out = [], q = {};
    for (let i = 0; i < resort.lifts.length; i++) {
      const p = l.pathOf(i);
      if (!p) continue;
      for (const s of p.supports) if (s.tower) { p.at(s.s, q); out.push([q.x, q.z, s.y + 1, 0.9]); }
      for (const e of [0, p.len]) { p.at(e, q); out.push([q.x, q.z, field.height(q.x, q.z) + p.spec.station[1] + 2, p.spec.station[0] * 0.3]); }
    }
    const g = new Map();
    for (const o of out) { const k = Math.floor(o[0] / 20) * 100003 + Math.floor(o[1] / 20); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(o); }
    return g;
  }
  function camBlocked(x, y, z) {
    if (boxIndex) { const b = boxIndex.hit(x, z, 0.35); if (b && y < b[6]) return true; }
    if (pylonGrid) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const a = pylonGrid.get((Math.floor(x / 20) + dx) * 100003 + Math.floor(z / 20) + dz);
        if (a) for (const o of a) if (y < o[2] && Math.hypot(x - o[0], z - o[1]) < o[3] + 0.4) return true;
      }
    }
    return !!scatter.hit(x, z, 1.1, y, quality.treeDensity);
  }
  const camGuard = createCameraGuard({ ground: (x, z) => surface.height(x, z), blocked: camBlocked });
  let snowfall = createSnowfall({ scene, env, count: quality.snowflakes });
  const spray = createSpray({ scene, count: quality.spray, env });
  const tracks = createTracks({ scene, segments: level === 'low' ? 360 : 700 });         // round 7: grooves in fresh snow
  const fpCam = createFirstPersonCamera(surface);                                       // round 7: the skier's own eyes
  let camMode = readCamMode(localStorage);
  let signs = null, parkBodies = null, parkBodyMat = null;
  const bodyMat = () => (parkBodyMat = parkBodyMat || createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex, lodScale: quality.lodScale, body: true }));
  let lifts = null, village = null, landmarks = null, roads = null, roadRows = null, extrasBuilt = false, liftsEarly = false, markers = null;
  /** Round 6: the lift view (lifts.js). Built once every tile is in; a ride before that builds it early on the heights there are, and it
   *  is built again (between rides) once all tiles are in. */
  function buildLifts() {
    if (lifts && !liftsEarly) return lifts;
    if (lifts && ride) { liftsEarly = true; return lifts; }                 // riding: rebuilt when the ride ends
    if (lifts) lifts.dispose();
    lifts = createLifts({ scene, resort, height: (x, z) => field.height(x, z) });
    liftsEarly = !streamer.done();
    try { pylonGrid = pylonsOf(lifts); } catch (error) { console.warn('[ski] pylon grid failed', error); }      // round 7 (A): camera guard
    return lifts;
  }
  // the village streets are draped on the 5 m ground: built once the extras and every height tile are in
  const tryRoads = () => {
    if (roads || !roadRows || !streamer.done()) return;
    try { roads = createRoads({ scene, roads: roadRows, env, height: (x, z) => surface.height(x, z) }); mark('roads'); } catch (error) { console.warn('[ski] streets failed', error); roads = { update() {} }; }
  };

  // streamed height tiles change the heights under them: drop every cache that read them
  streamer.onTile((rect) => {
    surface.invalidate(...rect);
    // round 7: a finer tile under a skier who stands (or would be under the snow): back onto the real ground
    { const st = game.state; if (st && !st.ride && st.crash === 0 && st.x >= rect[0] - 5 && st.x <= rect[2] + 5 && st.z >= rect[1] - 5 && st.z <= rect[3] + 5) { const h = surface.height(st.x, st.z); if (st.y < h - 0.02 || (st.grounded && st.speed < 1.5 && Math.abs(st.y - h) > 0.02)) game.state = { ...st, y: h, vy: 0, grounded: true }; } }
    terrain.invalidate(...rect);
    scatter.invalidate(...rect);
    scatterView.invalidate();
    farForest.invalidate(...rect);
    poles.reset();
    if (runProps && game.piste) { runProps.dispose(); runProps = createRunProps({ scene, piste: game.piste, height: (x, z) => surface.height(x, z), gates: game.run ? game.run.gates : [] }); }
    if (modes) modes.onTiles(rect);
    if (avalanches) avalanches.reseat();
    if (streamer.done()) document.documentElement.dataset.skiTilesDone = '1';
    if (markers) markers.reseat();
    if (streamer.done() && !extrasBuilt) {
      extrasBuilt = true;
      buildLifts();
      signs = createSigns({ scene, resort, height: (x, z) => field.height(x, z) });
      landmarks = createLandmarks({ scene, resort, height: (x, z) => surface.height(x, z), pistes });
      if (modes) modes.ensureParkView();
      if (parkLayout && !parkBodies) { try { parkBodies = createParkBodies({ scene, layout: parkLayout, material: bodyMat(), env }); } catch (error) { console.warn('[ski] park bodies failed', error); } }
      mark('lifts');
      tryRoads();
    }
  });
  let boxIndex = null, respotLift = null;                                                       // round 7: building footprints (spawn spots never face a wall)
  // round 7 (A): the buildings / streets download starts once the skier is on the snow (or after 6 s on a menu): they are not part of
  // the first play's bytes (the spawn spot is chosen from the class raster first and refined when the footprints are in)
  let extrasStarted = false, extrasGo = null;
  const extrasGate = new Promise((res) => { extrasGo = res; });
  const startExtras = () => { if (!extrasStarted) { extrasStarted = true; extrasGo(); } };
  setTimeout(startExtras, 6000);
  const extrasReady = extrasGate.then(() => loadExtras(core.root)).then(({ buildings, roads: streets }) => {
    try { boxIndex = createBoxIndex(buildingBoxes(buildings)); } catch (error) { console.warn('[ski] building index failed', error); }
    for (const l of modes.lifts.list) { const b = boardSpot(l); l.board = { x: b.x, z: b.z }; }        // round 7: the boarding zones
    // the first spot was chosen before the footprints: if he still stands there and the better spot is elsewhere, put him there
    if (respotLift && game.state && game.screen === 'ski' && game.phase === 'running' && !ride && game.state.hold && game.state.speed === 0) {
      const b = boardSpot(respotLift);
      if (Math.hypot(b.x - game.state.x, b.z - game.state.z) > 1) { const fade = fader(); fade.classList.add('on'); setTimeout(() => { placeAt(b.x, b.z, b.heading); if (modes.freeRun) modes.freeRun.moved(b); fade.classList.remove('on'); }, 260); }
    }
    respotLift = null;
    village = createVillage({ scene, rows: buildings, env, height: (x, z) => field.baseHeight(x, z), level }); mark('village');
    roadRows = decodeRoads(streets); tryRoads();
  }).catch((error) => console.warn('[ski] buildings failed', error.message));

  let spawn = null;                                                          // round 6: the free ride's village lift
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
    root: core.root, outfits: OUTFITS, onRideUp: () => boardLift(), onProgressChanged: () => refreshMapMarks(), onSkis: () => openSkiCard(),
  });
  // ---- round 6: ski types (physics per type; timed / scored runs use the reference set: modes/skis.js FAIRNESS) ----
  let skiType = DEFAULT_SKI;
  const fairNow = () => !!mp || game.mode === MODES.run || game.mode === MODES.park;
  function applySkiPhysics() { world.ski = skiParams(skiType, fairNow()); document.documentElement.dataset.skiPhysics = fairNow() ? 'fair' : skiType; }
  function setSki(id, save = true) {
    const t = SKI_BY_ID.get(id);
    if (!t || !skiOpen(id, modes.skiStats())) return false;
    skiType = id;
    skier.setSki(t.look);
    applySkiPhysics();
    document.documentElement.dataset.skiType = id;
    if (save && store.get().ski !== id) { store.set({ ...store.get(), ski: id }); modes.cloud.push(store.get()); }
    return true;
  }
  if (!setSki(store.get().ski || DEFAULT_SKI, false)) setSki(DEFAULT_SKI, false);
  let skiCard = null;
  function openSkiCard() {
    if (skiCard) return;
    game.paused = true; input.setEnabled(false);
    skiCard = showSkiCard(document.getElementById('ui'), { stats: modes.skiStats(), selected: skiType, onPick: (id) => { if (setSki(id)) hud.toast(`Ski: ${SKI_BY_ID.get(id).name}`); }, onClose: () => { skiCard = null; game.paused = false; input.setEnabled(game.phase === 'running'); } });
  }
  // ---- round 6: the challenge start gates on the mountain ----
  markers = createMarkers({ scene, list: markerList(pistes, parkLayout), height: (x, z) => surface.height(x, z), overlay: document.getElementById('ui'), starsOf: (m) => (m.piste ? pisteStars(store.get(), rid, m.piste.id) : 0) });
  // ---- round 7: avalanches in the free ride + the Lawin challenge faces ----
  const avalanches = createAvalanches({ scene, field, surface, lifts: modes.lifts.list, places: resort.places, env, quality });
  let lawin = null, avaCatchT = 0, freshHere = 0, riskHere = 0;
  /** An avalanche starts (mine = released here: shared with the online group). */
  function startAvalanche(ev, mine, ageMs = 0, by = '') {
    const f = avalanches.spawn(ev, ageMs);
    if (!f) return null;
    if (mine && mpf) mpf.shareAvalanche(ev);
    audio.event('avalanche');
    hud.toast(mine ? '⚠ Lawin! Fuer!' : `⚠ Lawin${by ? ` (${by})` : ''}!`, 2200);
    document.documentElement.dataset.skiAvalanche = String(avalanches.active);
    return f;
  }
  /** Caught: a fall in the snow masses, a white-out, back up beside the crown (out of its path). */
  function caughtByAvalanche() {
    const st = game.state;
    game.state = { ...st, crash: SKI.crashSeconds, crashKind: 'avalanche', vx: st.vx * 0.4, vz: st.vz * 0.4 };
    hud.toast('Vun der Lawin erwëscht!', 2200);
    audio.event('crash');
    const fade = fader();
    fade.classList.add('snow', 'on');
    setTimeout(() => { fade.classList.remove('on'); setTimeout(() => fade.classList.remove('snow'), 300); }, 900);
    const f = avalanches.flows[avalanches.flows.length - 1];
    if (f && modes.freeRun) {
      const side = (f.across[0] * (st.x - f.ev.x) + f.across[1] * (st.z - f.ev.z)) >= 0 ? 1 : -1;
      const x = f.ev.x + f.across[0] * side * 60, z = f.ev.z + f.across[1] * side * 60;
      modes.freeRun.moved({ x, z, heading: Math.atan2(f.dir[1], f.dir[0]) });
    }
    if (lawin) { hud.toast('Erwëscht! Probéier nach eng Kéier', 2600); lawin = null; document.documentElement.dataset.skiLawin = 'caught'; }
    document.documentElement.dataset.skiCaught = String(Number(document.documentElement.dataset.skiCaught || 0) + 1);
  }
  /** The Lawin challenge at a marked face: the slab releases right behind the skier; reach the safe spot below. */
  function startLawin(spot) {
    const st = game.state;
    const ev = avalanches.forced({ ...st, x: spot.x, z: spot.z });
    if (Math.hypot(st.x - spot.x, st.z - spot.z) > 30) placeAt(spot.x, spot.z, spot.heading);
    lawin = { spot, id: ev.id, t0: performance.now() };
    startAvalanche(ev, true);
    hud.toast(`${spot.name}: fuer erof bis bei d'Fändelen!`, 2600);
    document.documentElement.dataset.skiLawin = 'running';
  }
  function lawinTick(st) {
    if (!lawin) return;
    const s = lawin.spot.safe;
    if (Math.hypot(st.x - s.x, st.z - s.z) < 40 && st.crash === 0) {
      const key = `${rid}/${lawin.spot.id}`;
      const p = store.get();
      store.set({ ...p, lawin: { ...(p.lawin || {}), [key]: ((p.lawin || {})[key] || 0) + 1 } });
      hud.toast(`Entkomm! ${lawin.spot.name} 🏅`, 2800);
      audio.event('finish');
      lawin = null;
      document.documentElement.dataset.skiLawin = 'escaped';
    } else if (performance.now() - lawin.t0 > 70000) { lawin = null; document.documentElement.dataset.skiLawin = ''; }
  }
  let dismissed = null;
  const chPrompt = createChallengePrompt(hud.el, { onStart: (m) => acceptChallenge(m), onNo: (m) => { dismissed = m.id; chPrompt.show(null); } });
  function promptInfo(m) {
    if (m.lawin) return { goal: 'Eng Lawin geet hannert dir lass: fuer erof, ouni erwëscht ze ginn' };
    if (m.park) return { goal: 'Punkten fir Tricks · Bestenlëscht vum Park' };
    const c = modes.challengeOf(m.piste);
    return { mask: pisteStars(store.get(), rid, m.piste.id), goal: c ? `Ënner ${formatTime(c.targetMs).replace(/(\.\d)\d+$/, '$1')} · ${specialText(c)}` : '' };
  }
  function acceptChallenge(m) {
    chPrompt.show(null);
    dismissed = m.id;
    if (m.lawin) startLawin(m); else if (m.park) startPark(); else startRun(m.piste, MODES.run);
  }
  // ---- round 6: lift rides ----
  let boarding = null, actionLock = 0;
  let ride = null, carrier = null, rideView = camMode === 'first' ? 'window' : 'chase', rideCam = null, skipping = false, tunnel = null, inTunnel = false;
  const rideHud = createRideHud(hud.el, { onSkip: () => skipRide(), onView: () => toggleRideView() });
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
    if (markers) markers.paint();
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
      const me = game.resume ? game.resume.state : null;
      if (me && !game.mapPicked) game.freeLift = modes.lifts.nearestBottom(me.x, me.z, 1e9);
      if (!game.freeLift) game.freeLift = spawn;
      pickLift(game.freeLift);
    } else if (m === 'skis') {
      modePanel.showSkis({ stats: modes.skiStats(), selected: skiType, onPick: (id) => { if (setSki(id)) setMapMode('skis'); } });
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
    picker = ui.showResorts({ current: rid, onOnline: window.MPGate && window.MPGate.openLobby ? () => window.MPGate.openLobby('new') : null, onPick: (id) => { if (id && id !== rid) { switchResort(id); return; } picker.close(); picker = null; goFree(spawn); } });
    document.documentElement.dataset.skiScreen = 'picker';
  }
  /** Another resort: one resort per page life (its tiles, textures and caches go with it), so remember the pick and load the page again,
   * straight onto that resort's piste map. Standalone: ?resort=<id>&map=1 (shareable). In the arcade's srcdoc frame the URL can't change:
   * the saved pick chooses the resort and a session flag opens the map. */
  function switchResort(id) {
    store.set(withLast(store.get(), id, null));
    LOAD.set(0.1, 'Skigebitt gëtt gewiesselt …');
    try { sessionStorage.setItem(OPEN_MAP_KEY, 'free'); } catch (error) { /* private mode: the picker shows again */ }
    try {
      const u = new URL(location.href);
      if (/^https?:$/.test(u.protocol)) {
        u.searchParams.set('resort', id); u.searchParams.set('go', '1'); u.searchParams.delete('map'); u.searchParams.delete('piste');
        location.replace(u.href); return;
      }
    } catch (error) { /* about:srcdoc inside the arcade: a plain reload */ }
    location.reload();
  }
  function showMap() {
    if (ride) { hud.toast('Am Lift: d\'Kaart gëtt et uewen'); return; }
    // round 6: over a free ride the map is a pause overlay ("Weiderfueren" goes on where the skier stood)
    const resumable = game.screen === 'ski' && game.mode === MODES.freeride && game.phase === 'running' && !!modes.freeRun;
    game.resume = resumable ? { state: { ...game.state }, piste: game.piste } : null;
    game.screen = 'map';
    game.phase = resumable ? 'paused-map' : 'idle';
    hud.show(false); input.showTouch(false); input.setEnabled(false);
    if (finishCard) { finishCard.close(); finishCard = null; }
    chPrompt.show(null);
    if (!resumable) modes.end();
    if (resumable) game.mapMode = 'freeride';
    game.mapPicked = false;
    mapScreen = ui.showMap({
      resort, pistes, best: pisteBest, env, gfx: GFX(), outfits: OUTFITS, outfit: () => outfit, onOutfit: setOutfit,
      outfitOpen, starsOf: starsText, lockedOf: (p) => !modes.isOpen(p),
      onSelect: (p, center) => selectPiste(p, center),
      onStart: () => startRun(game.piste, MODES.run),
      onBack: () => { if (mpf) { if (game.resume) resumeFree(); else goFree(spawn); return; } mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; game.resume = null; modes.end(); showPicker(); },
      onResume: resumable ? () => resumeFree() : null,
    });
    pisteMap = createPisteMap({ canvas: mapScreen.canvas, resort, imageUrl: core.root + resort.map.file, pistes, onPick: (p) => selectPiste(p, false), onPickLift: (l) => { game.mapPicked = true; pickLift(l); } });
    mapScreen.zoomButtons.forEach((b) => b.addEventListener('click', () => pisteMap.zoomBy(b.dataset.z === 'in' ? 1.5 : 1 / 1.5)));
    modePanel = attachModePanel(mapScreen.el, { onMode: (m) => setMapMode(m), onParkStart: () => startPark(), onFreeStart: () => goFree(game.freeLift), onPickLift: (l) => { game.mapPicked = true; pickLift(l); } });
    pisteMap.setPark(resort.park ? { line: resort.park.line, name: resort.park.name } : null);
    pisteMap.setMarks(modes.marks());
    if (game.resume) pisteMap.setPlayer(game.resume.state.x, game.resume.state.z);
    const last = store.get().last;
    const first = openPisteNear((last && last.resort === rid && pistes.byId.get(last.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
    selectPiste(first, true);
    if (game.mapMode && game.mapMode !== 'piste') setMapMode(game.mapMode);
    if (game.resume) { game.state = { ...game.resume.state }; chase.snap(game.state); }        // the piste pick moved the skier: back
    document.documentElement.dataset.skiScreen = 'map';
    document.documentElement.dataset.skiMapResume = resumable ? '1' : '0';
  }
  /** Round 6: close the map over a free ride: on from where the skier stood. */
  function resumeFree() {
    if (!game.resume) return;
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    game.state = { ...game.resume.state }; game.piste = game.resume.piste; game.resume = null;
    chase.snap(game.state);
    game.screen = 'ski'; game.phase = 'running';
    document.documentElement.dataset.skiScreen = 'ski';
    hud.show(true); input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches); input.setEnabled(true);
    applySkiPhysics();
    canvas.focus({ preventScroll: true });
  }
  function selectPiste(p, center) {
    if (!p) return;
    game.piste = p;
    streamer.focus(p.top.x, p.top.z);
    const a = p.at(2, {});
    if (!game.resume) placeAt(a.x, a.z, Math.atan2(a.dz, a.dx));      // over a paused free ride the skier stays where he is
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
    if (ready && open && game.mapMode !== 'park' && game.mapMode !== 'freeride') streamer.release();
    // round 4A: the park and the free ride start spot (the held first-play stream also loads the tiles around them: streamer.want)
    if (modePanel && game.mapMode === 'park' && parkLayout) {
      streamer.want(parkLayout.top.x, parkLayout.top.z, 900);
      readyPark = readyPark || (streamer.pendingNear(parkLayout.top.x, parkLayout.top.z, 900) === 0 && terrain.stats.pending === 0);
      modePanel.parkReady(readyPark);
      document.documentElement.dataset.skiParkReady = readyPark ? '1' : '0';
      if (readyPark) streamer.release();
    }
    if (modePanel && game.mapMode === 'freeride' && game.freeLift) {
      const l = game.freeLift;
      streamer.want(l.top.x, l.top.z, 1200);
      const ok = readyLift === l.id || (streamer.pendingNear(l.top.x, l.top.z, 1200) === 0 && terrain.stats.pending === 0);
      readyLift = ok ? l.id : null;
      modePanel.freeReady(ok);
      document.documentElement.dataset.skiFreeReady = ok ? '1' : '0';
      if (ok) streamer.release();
    }
  }

  function startRun(p, mode, lateral = 0) {     // lateral: m right of the line at the start gate (online race: side by side)
    if (!p) return;
    if (mode === MODES.run && !mp && !modes.isOpen(p) && !params.debug) { hud.toast('Gespaart'); return; }      // an online race may be on any piste
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    if (finishCard) { finishCard.close(); finishCard = null; }
    game.screen = 'ski';
    document.documentElement.dataset.skiScreen = 'ski';
    game.piste = p;
    game.mode = mode;
    game.run = createRun({ piste: p, mode });
    const a = p.at(2, {});
    placeAt(a.x - a.dz * lateral, a.z + a.dx * lateral, Math.atan2(a.dz, a.dx));
    if (runProps) runProps.dispose();
    runProps = createRunProps({ scene, piste: p, height: (x, z) => surface.height(x, z), gates: game.run.gates });
    const g = mode === MODES.run ? decodeGhost(store.get().ghosts[pisteKey(rid, p.id)]) : null;
    game.ghost = g;
    ghostModel.setVisible(false);
    game.bot = params.bot && mode !== MODES.park ? createBot(p) : null;
    game.assisted = false;
    if (mode !== MODES.park) { store.set(withLast(store.get(), rid, p.id)); boards.select(rid, p, resort.short); }
    modes.begin(game);                                                       // round 4A: stars / park / free ride parts
    game.resume = null; chPrompt.show(null);
    applySkiPhysics();                                                       // round 6: a timed / scored run = the reference ski
    hud.show(true); hud.setPiste(p, mode); hud.setClock(mode === MODES.run ? 0 : null, 0); hud.setSplit(''); hud.setGates(game.run.gates.length ? `Slalom: 0 / ${game.run.gates.length}` : '');
    input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    input.setEnabled(true);
    streamer.focus(a.x, a.z);
    streamer.release();
    if (mode === MODES.run || mode === MODES.park) { game.phase = 'countdown'; game.countdown = params.auto ? 0.01 : 3; }
    else { game.phase = 'running'; hud.count(''); }
    if (mp) { game.phase = 'hold'; game.ghost = null; hud.count(''); }          // online race: net/index.js starts the 3-2-1 for everybody
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    post.hold(6000);                         // the countdown + the first seconds: tiles, trees and shaders still settle
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
    if (mp) { mp.onFinish(result); return; }                                 // online race: its own results screen
    if (game.mode === MODES.park) {                                          // round 4A: the park card (points, record, tricks)
      finishCard = modes.finishPark({ assisted, onAgain: () => startPark(), onMap: () => showMap(), onFree: () => freeFromHere() });
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
      onFree: () => freeFromHere(),
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
  /** Round 6: where a skier waits for a lift: in front of its bottom station inside the boarding zone, facing up the line, on open snow
   *  (no houses under him or under the chase camera behind him: the class raster's built share, which knows the villages from the start). */
  const attrs0 = {};
  const builtAt = (x, z) => { let b = 0; for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) b += field.attrs(x + dx, z + dz, attrs0).built || 0; return b / 5; };
  /** Round 7 (modes/spawn.js): in front of the station, facing it, the view from the camera to 25 m ahead free of buildings. */
  const slopeAt = (x, z) => Math.hypot(field.farHeight(x + 6, z) - field.farHeight(x - 6, z), field.farHeight(x, z + 6) - field.farHeight(x, z - 6)) / 12;
  function boardSpot(lift) {
    const s = liftSpot(lift, { builtAt, index: boxIndex, slope: slopeAt });
    return s ? { x: s.x, z: s.z, heading: s.heading, blocked: s.blocked } : modes.lifts.boardAt(lift, 14);
  }
  /** Round 6: free ride from a lift's bottom station (fast travel: a short fade while the tiles there arrive) or from a spot. */
  async function goFree(lift, spotIn = null) {
    if (!lift && !spotIn) return;
    const fade = fader();
    fade.classList.add('on');
    // the spot from the building footprints once they are in; before that (the first play: no waiting for buildings.json) from the
    // class raster, and re-placed with the footprints when they arrive if he is still standing there (round 7 A)
    const spot = spotIn || boardSpot(lift);
    respotLift = !spotIn && !boxIndex ? lift : null;
    streamer.focus(spot.x, spot.z);
    // round 7: the ground under the spot is the real 5 m terrain before he stands on it (never under the snow); a late tile re-snaps
    await Promise.race([streamer.ready(spot.x, spot.z, 420), new Promise((res) => setTimeout(res, 8000))]);
    await new Promise((res) => setTimeout(res, 120));
    startFree(lift, spot);
    fade.classList.remove('on');
  }
  /** After a challenge / the park: free riding on from where the skier stands (the bottom). */
  function freeFromHere() {
    const s = game.state;
    startFree(null, { x: s.x, z: s.z, heading: Math.hypot(s.vx, s.vz) > 1 ? Math.atan2(s.vz, s.vx) : s.heading });
  }
  function fader() {
    const fade = document.getElementById('skiFade') || Object.assign(document.createElement('div'), { id: 'skiFade' });
    if (!fade.parentNode) document.getElementById('ui').appendChild(fade);
    return fade;
  }
  function startFree(lift, spotIn = null) {
    if (!lift && !spotIn) return;
    streamer.release();                                      // skiing: the rest of the resort streams in, nearest the skier first
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    if (finishCard) { finishCard.close(); finishCard = null; }
    game.screen = 'ski';
    document.documentElement.dataset.skiScreen = 'ski';
    game.mode = MODES.freeride;
    game.resume = null;
    if (lift) game.freeLift = lift;
    const spot = spotIn || boardSpot(lift);
    const near = pistes.nearest(spot.x, spot.z, 400);
    game.piste = near ? near.piste : game.piste;
    if (runProps) { runProps.dispose(); runProps = null; }
    game.ghost = null; ghostModel.setVisible(false);
    game.bot = null; game.assisted = false;
    modes.begin(game);
    applySkiPhysics();
    game.run = modes.createRun(game, spot);
    placeAt(spot.x, spot.z, spot.heading);
    hud.show(true); hud.setPiste(null, MODES.freeride); hud.setClock(null, 0); hud.setSplit(''); hud.setGates('');
    input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    input.setEnabled(true);
    streamer.focus(spot.x, spot.z);
    game.phase = 'running'; hud.count('');
    document.documentElement.dataset.skiRunning = '1';
    hud.toast(lift ? `${lift.name}: Astegen mat L / Enter` : 'Fräi fueren');
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('free');
    setTimeout(startExtras, 400);                                       // round 7 (A): the houses and streets after the first frames
    if (!pictureChecks) setTimeout(pictureCheck, 3500);                 // round 7 (A): the picture check
  }
  /** Round 6: board the lift at hand (the skier is in its boarding zone): a real ride up its line, then off at the top. */
  function boardLift() {
    if (game.mode !== MODES.freeride || game.phase !== 'running' || ride || game.paused) return;
    const lift = modes.liftAt;
    if (!lift) return;
    const path = buildLifts().pathOf(lift.index);
    if (!path) { hud.toast('Dëse Lift fiert net'); return; }
    if (performance.now() < actionLock) return;
    ride = createRide({ lift, path, height: (x, z) => surface.height(x, z) });
    // round 7: no teleport onto the line: he skates the last metres into the station to the carrier waiting there, then it leaves
    boarding = { t: 0, from: { ...game.state } };
    actionLock = performance.now() + 1400;                          // one press = one boarding (a double tap must not skip the ride)
    carrier = createCarrier({ scene, kind: path.kind, seats: path.seats });
    tunnel = path.tunnels && path.tunnels.length ? createTunnel({ scene, path }) : null;     // round 7: the tube of an underground funicular
    inTunnel = false;
    modes.rideStart(lift);
    chPrompt.show(null);
    game.phase = 'lift';
    rideCam = null; skipping = false;
    input.setEnabled(false); input.showTouch(false);
    rideHud.show(lift);
    stepRide(0);
    audio.event('count');
    document.documentElement.dataset.skiRide = path.kind;
    document.documentElement.dataset.skiRideView = rideView;
    mark('ride');
  }
  function stepRide(dt) {
    if (boarding) {
      boarding.t += dt;
      const k = Math.min(1, boarding.t / RIDE.boardTime), e = k * k * (3 - 2 * k);
      const to = ride.state(boarding.from), f = boarding.from;
      const dh = Math.atan2(Math.sin(to.heading - f.heading), Math.cos(to.heading - f.heading));
      game.state = k >= 1 ? to : { ...f, x: f.x + (to.x - f.x) * e, z: f.z + (to.z - f.z) * e, y: k < 0.6 ? surface.height(f.x + (to.x - f.x) * e, f.z + (to.z - f.z) * e) : f.y + (to.y - f.y) * e, heading: f.heading + dh * e, speed: 2, vx: 0, vz: 0, vy: 0, ride: k > 0.6 ? to.ride : '', grounded: true };
      if (k >= 1) boarding = null;
      const w0 = ride.where();
      if (lifts) lifts.setRide(ride.lift.index, ride.s);
      carrier.place(w0);
      return;
    }
    ride.step(dt);
    game.state = ride.state(game.state);
    const w = ride.where();
    if (lifts) lifts.setRide(ride.lift.index, ride.s);
    carrier.place(w);
    streamer.focus(w.x + Math.cos(w.heading) * 120, w.z + Math.sin(w.heading) * 120);
    // round 7: through a tunnel portal (in or out) the picture dips to dark for a moment: the cut between daylight and the lit tube
    const under = !!(tunnel && ride.path.underground(ride.s - (rideView === 'window' ? 0 : 12), 2));
    if (under !== inTunnel) {
      inTunnel = under;
      document.documentElement.dataset.skiTunnel = under ? '1' : '0';
      const fade = fader();
      fade.classList.add('dark', 'on');
      setTimeout(() => { fade.classList.remove('on'); setTimeout(() => fade.classList.remove('dark'), 320); }, 220);
    }
    if (ride.done && !skipping) arrive();
  }
  function rideCamera1(dt) {
    const w = ride.where();
    const want = rideCamera(ride.path, w, rideView, (x, z) => surface.height(x, z));
    // chase: the camera rides with the carrier (no lag at x4); only its offset round the rider eases (a bend of the line turns it softly)
    const off = { x: want.x - w.x, y: want.y - w.y, z: want.z - w.z, tx: want.tx - w.x, ty: want.ty - w.y, tz: want.tz - w.z, fov: want.fov };
    if (rideView === 'window' || !rideCam) rideCam = { off };
    else { const k = 1 - Math.exp(-dt * 3); for (const key of Object.keys(off)) rideCam.off[key] += (off[key] - rideCam.off[key]) * k; }
    const o = rideCam.off;
    const out = { x: w.x + o.x, y: w.y + o.y, z: w.z + o.z, tx: w.x + o.tx, ty: w.y + o.ty, tz: w.z + o.tz, fov: o.fov };
    if (rideView !== 'window' && !want.inTunnel) out.y = Math.max(out.y, surface.height(out.x, out.z) + 0.8);
    return out;
  }
  /** Round 7: ONE camera toggle (V / 🎥): third person <-> first person; in a lift ride first person is the window view. Saved. */
  function setCamMode(mode, toast = true) {
    camMode = mode === 'first' ? 'first' : 'third';
    writeCamMode(localStorage, camMode);
    rideView = camMode === 'first' ? 'window' : 'chase';
    rideCam = null;
    if (game.state) fpCam.snap(game.state);
    document.documentElement.dataset.skiRideView = rideView;
    document.documentElement.dataset.skiCam = camMode;
    const b = document.getElementById('hView');
    if (b) { b.textContent = camMode === 'first' ? '👀' : '🎥'; b.setAttribute('aria-pressed', camMode === 'first' ? 'true' : 'false'); }
    if (toast) hud.toast(ride ? (rideView === 'window' ? 'Vue: duerch d\'Fënster' : 'Vue: vu baussen') : camMode === 'first' ? 'Kamera: mat den eegenen Aen' : 'Kamera: vu baussen', 900);
  }
  function toggleRideView() { setCamMode(camMode === 'first' ? 'third' : 'first'); }
  async function skipRide() {
    if (!ride || skipping || boarding || performance.now() < actionLock) return;
    skipping = true;
    const fade = fader();
    fade.classList.add('on');
    await new Promise((res) => setTimeout(res, 320));
    if (!ride) { fade.classList.remove('on'); return; }
    ride.skip();
    const top = ride.where();
    streamer.focus(top.x, top.z);
    await Promise.race([streamer.ready(top.x, top.z, 500), new Promise((res) => setTimeout(res, 3000))]);
    arrive();
    fade.classList.remove('on');
  }
  /** At the top station: off, a few metres past it facing down the slope, ready to ski. */
  function arrive() {
    if (!ride) return;
    const r = ride;
    ride = null; skipping = false;
    if (lifts) lifts.setRide(r.lift.index, null);
    if (carrier) { carrier.dispose(); carrier = null; }
    if (tunnel) { tunnel.dispose(); tunnel = null; }
    inTunnel = false; document.documentElement.dataset.skiTunnel = '0';
    rideHud.show(null);
    // round 7: off on the exit side, outside every building (the station's own included), facing down onto open snow
    const prefer = modes.lifts.startAt(r.lift, (x, z) => surface.height(x, z));
    const ex = exitSpot(r.lift, { index: boxIndex, builtAt, farHeight: (x, z) => field.farHeight(x, z), prefer });
    const spot = ex ? { x: ex.x, z: ex.z, heading: ex.heading } : prefer;
    if (modes.freeRun) modes.freeRun.moved(spot);
    placeAt(spot.x, spot.z, spot.heading);
    game.phase = 'running';
    input.setEnabled(true); input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    hud.toast(`${r.lift.name}: uewen op ${Math.round(r.lift.top.y)} m`);
    document.documentElement.dataset.skiRide = '';
    document.documentElement.dataset.skiLifts = String(modes.freeRun ? modes.freeRun.stats.lifts : 0);
    if (liftsEarly && streamer.done()) buildLifts();
    canvas.focus({ preventScroll: true });
  }
  const rideUp = () => boardLift();
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
      againLabel: game.mode === MODES.freeride ? '' : game.mode === MODES.park ? 'Park nach eng Kéier' : 'Nach eng Kéier',
      onResume: () => { menuCard = null; game.paused = false; input.setEnabled(game.phase === 'running' || game.phase === 'countdown'); },
      onAgain: () => { menuCard = null; game.paused = false; again(); },
      onMap: () => { menuCard = null; game.paused = false; showMap(); },
    });
  }

  function onAction(action) {
    if (mp && mp.onAction(action)) return;
    if (mpf && mpf.onAction(action)) return;
    if (action === 'weather') { const m = env.cycleWeather(); hud.toast(`Wieder: ${WEATHER_LABEL[m]}${m === 'random' ? ` (${WEATHER_LABEL[env.state.weatherId]})` : ''}`); }
    else if (action === 'time') { const m = env.cycleTime(); hud.toast(`Zäit: ${TIME_LABEL[m]}${m === 'random' ? ` (${TIME_LABEL[env.state.timeId]})` : ''}`); }
    else if (action === 'reset') { if (game.screen === 'ski' && game.phase === 'running') respawn('Zréck op d\'Pist'); }
    else if (action === 'menu') { if (skiCard) skiCard.close(); else if (menuCard) { menuCard.close(); menuCard = null; game.paused = false; input.setEnabled(game.phase === 'running' || game.phase === 'countdown'); } else if (game.screen === 'map' && game.resume) resumeFree(); else openMenu(); }
    else if (action === 'map') { if (game.screen === 'ski') showMap(); else if (game.screen === 'map' && game.resume) resumeFree(); }
    else if (action === 'view') toggleRideView();
    else if (action === 'mute') { const next = !audio.isMuted(); audio.setMuted(next); hud.toast(next ? 'Toun aus' : 'Toun un'); }
    else if (action === 'lift') { if (ride) skipRide(); else boardLift(); }
    else if (action === 'confirm') {
      if (game.screen === 'ski' && ride) skipRide();
      else if (game.screen === 'ski' && game.mode === MODES.freeride && chPrompt.current) acceptChallenge(chPrompt.current);
      else if (game.screen === 'ski' && game.mode === MODES.freeride) boardLift();
      else if (game.screen === 'map' && game.mapMode === 'park') { if (readyPark) startPark(); }
      else if (game.screen === 'map' && game.mapMode === 'freeride') { if (readyLift) goFree(game.freeLift); }
      else if (game.screen === 'map' && readyFor && modes.isOpen(game.piste)) startRun(game.piste, MODES.run);
    }
  }
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => { if (!mp) again(); });

  // quality: the shared Grafik level; a watchdog only ever steps down
  function applyQuality(next) {
    level = next; quality = QUALITY[level];
    post.setSpec(quality.res); resize();
    camera.far = quality.far * 1.3; camera.updateProjectionMatrix();
    env.u.uFarEnd.value = quality.far;
    snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex, lodScale: quality.lodScale });
    terrain.setMaterial(snowMat);
    if (parkBodyMat) { parkBodyMat.dispose(); parkBodyMat = null; if (parkBodies) parkBodies.setMaterial(bodyMat()); }
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

  // ---- round 7 (A): the picture check (WebKit / Safari safety net): a few seconds into the first ride, read the canvas back; a
  // one-colour picture or a shader error steps down: cheap snow (Niddreg shaders), then no MSAA, then no post pass ----
  function pictureColours() {
    try {
      const k = document.createElement('canvas'); k.width = 48; k.height = 36;
      const g = k.getContext('2d');
      post.render(scene, camera);
      g.drawImage(canvas, 0, 0, 48, 36);
      const d = g.getImageData(0, 0, 48, 36).data, set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
      return set.size;
    } catch (error) { return -1; }                                       // a tainted / unreadable canvas: no verdict
  }
  let pictureChecks = 0;
  function pictureCheck() {
    if (game.screen !== 'ski' || pictureChecks > 3) return;
    const n = pictureColours();
    document.documentElement.dataset.skiPicture = String(n);
    if (n < 0 || (n >= 12 && !shaderErrors.length)) return;
    pictureChecks++;
    const step = pictureChecks;
    console.warn(`[ski] the picture looks broken (${n} colours, ${shaderErrors.length} shader errors): safety step ${step}`);
    if (step === 1 && level !== 'low') { applyQuality('low'); }
    else post.fallback(Math.min(2, step - (level === 'low' ? 0 : 1)));
    document.documentElement.dataset.skiSafe = String(post.safe);
    setTimeout(pictureCheck, 1500);
  }
  // ---------------- loop ----------------
  const attrsHud = {};
  const streaks = Object.assign(document.createElement('div'), { id: 'skiStreaks' });
  document.getElementById('ui').prepend(streaks);
  let last = performance.now(), acc = 0, hudT = 0, time = 0, audioT = 0, liftDist = Infinity, nearVillage = 0;
  const ghostPos = {};
  const frameTimes = [];
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    const rawDt = (now - last) / 1000;
    const frameStart = performance.now();
    frameTimes.push(rawDt * 1000); if (frameTimes.length > 240) frameTimes.shift();
    last = now;
    const dt = Math.min(MAX_FRAME_S, rawDt);
    time += dt;
    const s = game.state;
    if (mp) mp.frame(now);
    if (mpf) mpf.frame(now);
    if (game.screen === 'ski' && !game.paused && s) {
      if (game.phase === 'countdown') {
        game.countdown -= dt;
        hud.count(game.countdown > 0 ? String(Math.ceil(game.countdown)) : 'Lass!');
        const tick = Math.ceil(game.countdown);
        if (tick !== game.lastTick) { game.lastTick = tick; if (tick > 0) audio.event('count'); }
        if (game.countdown <= 0) { audio.event('go'); game.phase = 'running'; document.documentElement.dataset.skiRunning = '1'; setTimeout(() => hud.count(''), 700); mark('go'); }
      }
      if (game.phase === 'lift' && ride) stepRide(dt * timescale);               // round 6: riding a lift
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
      skier.setVisible(!(ride && rideView === 'window' && ride.pose === 'stand' && !game.camPose));     // round 6: in a cabin, the window view is his own eyes
      if (game.orbit) {                                                // debug: a camera that circles the skier (model checks)
        const o = game.orbit, a = st.heading + o.angle * Math.PI / 180;
        game.camPose = { x: st.x + Math.cos(a) * o.dist, z: st.z + Math.sin(a) * o.dist, y: st.y + o.h, tx: st.x, ty: st.y + 0.8, tz: st.z, fov: o.fov || 40 };
      }
      const mpView = mp && mp.viewState();
      const view = mpView || st;                                         // online race: watching another skier after my finish
      const riding = !!(ride && game.phase === 'lift');
      const chaseCam = riding ? null : chase.update(view, dt, time);    // kept warm in first person (a crash cuts back to it)
      // round 7: first person (the skier's own eyes) unless crashing, spectating or a fixed flow view
      const fp = camMode === 'first' && !riding && !mpView && !game.camPose && game.screen === 'ski' && st.crash === 0;
      const cam = game.camPose || (riding ? rideCamera1(dt) : fp ? fpCam.update(st, dt, time) : chaseCam);      // camPose: a fixed view (flows)
      if (!fp) fpCam.snap(st);
      // round 7 (A): the free look (orbit round the skier / turn the head) and the camera guard
      if (!game.camPose && game.screen === 'ski') {
        look.step(dt, st.speed || 0);
        const head = fp || (riding && rideView === 'window');
        const pv = view, pivot = { x: pv.x, y: pv.y + (st.ride === 'sit' ? 0.6 : 1.2), z: pv.z };
        applyLook(cam, pivot, look, head ? 'head' : 'orbit');
        if (!head && !(riding && inTunnel)) camGuard.guard(cam, pivot, dt);
        document.documentElement.dataset.skiLook = `${look.yaw.toFixed(2)},${look.pitch.toFixed(2)}`;
      }
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      if (fp && cam.roll) camera.rotateZ(cam.roll);
      const near = fp || (riding && rideView === 'window') ? FP.near : CAMERA.near;
      if (Math.abs(camera.fov - cam.fov) > 0.05 || camera.near !== near) { camera.fov = cam.fov; camera.near = near; camera.updateProjectionMatrix(); }
      const fpBody = (fp || (riding && rideView === 'window')) && !game.camPose;
      if (fpBody !== skier.firstPerson) skier.setFirstPerson(fpBody);
      streaks.classList.toggle('on', fp && level !== 'low' && cam.streak > 0.05);
      streaks.style.opacity = fp && level !== 'low' ? (cam.streak * 0.55).toFixed(2) : '0';
      if (mp) mp.render(now, time);
      if (mpf) mpf.render(now, time);
      if (markers && game.screen === 'ski') { camera.updateMatrixWorld(); markers.update(camera, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, game.mode === MODES.freeride && game.phase === 'running' && !game.camPose); }
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
      const amount = game.screen === 'ski' && st.grounded && st.speed > 3 && !st.ride ? Math.min(1, st.slip * 2.5 + st.brake * 0.8 + Math.abs(st.edge) * 0.55) * Math.min(1, st.speed / 12) : 0;
      const powder = game.screen === 'ski' && !st.ride ? freshHere : 0;
      spray.update(dt, st, amount, pixelRatio(), powder, Math.min(1, env.sunStrength() * 1.4));
      tracks.update(dt, st, powder, (x, z) => surface.height(x, z));
      // round 7: avalanches (free ride: the release check on steep fresh slopes; every live flow; caught?)
      const freeRunning = game.screen === 'ski' && game.mode === MODES.freeride && game.phase === 'running' && !game.paused && !ride;
      if (freeRunning && !game.bot && !game.override) { const ev = avalanches.check(st, dt, env.state.weatherId); if (ev) startAvalanche(ev, true); }
      if (avalanches.active || avalanches.flows.length) {
        avaCatchT -= dt;
        const r = avalanches.update(dt, camera, pixelRatio(), freeRunning && st.crash === 0 ? st : null);
        if (r.caught && avaCatchT <= 0) { avaCatchT = 3; caughtByAvalanche(); }
        document.documentElement.dataset.skiAvalanche = String(avalanches.active);
      }
      if (freeRunning) lawinTick(game.state);
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
      if (parkBodies) parkBodies.update(camera.position.x, camera.position.z, Math.min(900, quality.buildingRadius));      // the bodies are small: near only
    }
    env.update(dt, time, camera);
    snowfall.update(time, camera, pixelRatio());
    if (game.screen === 'ski') {
      const t0 = performance.now();
      shadows.update(camera, env.u.uSunDir.value, env.sunStrength());
      post.render(scene, camera);
      // dynamic resolution first; the Grafik level only steps down once the resolution is at its floor
      if ((game.phase === 'running' || game.phase === 'lift') && !game.paused) post.tick(rawDt * 1000, performance.now() - frameStart);
      if (!params.q && game.phase === 'running' && level !== 'low' && post.atFloor()) {
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
      if (st) env.setSunScale(inTunnel ? 0.04 : sunVisibility(st.x, st.y + 1, st.z));        // round 7: no sun in a tunnel
      if (st && game.screen === 'ski') {
        // round 7: how fresh / deep the snow under the skis is (powder spray, tracks) and the avalanche risk badge
        const a = field.attrs(st.x, st.z, attrsHud);
        freshHere = st.grounded && !st.ride ? Math.max(0, 1 - a.piste * 1.6) * (1 - a.rock) * (1 - a.forest * 0.6) * (1 - a.built) * (1 - a.water) : 0;
        riskHere = game.mode === MODES.freeride && game.phase === 'running' ? avalanches.risk(st) : 0;
        const badge = document.getElementById('hRisk');
        if (badge) badge.hidden = riskHere < 0.3;
        document.documentElement.dataset.skiRisk = riskHere.toFixed(2);
      }
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
        freeTick(st);
        if (ride) rideHud.set({ left: ride.left, share: ride.share, view: rideView });
      }
    }
  }

  /** Round 6 (HUD rate): the challenge gate the skier is in, the ski stats (off-piste metres, top speed) and the ski unlocks they bring. */
  let statT = 0, statTop = 0, statOff0 = 0;
  function freeTick(st) {
    if (game.mode === MODES.freeride && game.phase === 'running' && !game.paused) {
      const m = markers.at(st.x, st.z) || (lawin ? null : avalanches.spotAt(st.x, st.z));
      if (dismissed && (!m || m.id !== dismissed)) { const d = markers.byId(dismissed) || avalanches.spots.find((q) => q.id === dismissed); if (!d || Math.hypot(d.x - st.x, d.z - st.z) > MARKER.rearm) dismissed = null; }
      const show = m && m.id !== dismissed ? m : null;
      if (show !== chPrompt.current) chPrompt.show(show, show ? promptInfo(show) : undefined);
      document.documentElement.dataset.skiPrompt = show ? show.id : '';
    } else if (chPrompt.current) { chPrompt.show(null); document.documentElement.dataset.skiPrompt = ''; }
    const scripted = !!(game.bot || game.override);
    if (!scripted && st.grounded && st.crash === 0 && !st.ride && (game.phase === 'running')) statTop = Math.max(statTop, st.speed);
    statT += HUD_EVERY;
    if (statT < 4) return;
    statT = 0;
    const off = modes.sessionStats.off - statOff0;
    statOff0 = modes.sessionStats.off;
    const before = store.get();
    const after = addSkiStats(before, { off: scripted ? 0 : off, top: statTop });
    if (after === before) return;
    store.set(after);
    for (const t of modes.newSkis(before, after)) hud.toast(`Neie Ski: ${t.name}!`, 2600);
    modes.cloud.push(after);
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
    resolution: () => post.stats(), post, get shaderErrors() { return shaderErrors; }, pictureColours, pictureCheck,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: terrain.stats.leaves, trees: scatterView.stats.trees, cards: farForest.stats.cards, tilesLoaded: streamer.stats.loaded, tilesTotal: streamer.stats.total, level }),
    teleport(s) { if (game.run) { const p = game.piste.at(s, {}); placeAt(p.x, p.z, Math.atan2(p.dz, p.dx)); } },
    progress: () => store.get(),
    // round 4A
    modes, parkLayout, startPark, startFree: (id) => startFree(id ? modes.lifts.byId.get(id) : game.freeLift || modes.lifts.list[0]), rideUp, setMapMode,
    // round 6
    goFree: (id) => goFree(id ? modes.lifts.byId.get(id) : spawn), boardLift, skipRide, toggleRideView, get ride() { return ride; }, get rideView() { return rideView; }, get spawn() { return spawn; },
    get lifts() { return lifts; }, get signs() { return signs; }, get tunnel() { return tunnel; }, get inTunnel() { return inTunnel; }, markers, setSki, get skiType() { return skiType; }, get world() { return world; }, openSkiCard, resumeFree, acceptChallenge, showMap,
    place(x, z, heading) { placeAt(x, z, heading); },
    // round 7
    avalanches, startAvalanche: (ev) => startAvalanche(ev || avalanches.forced(game.state), true), startLawin: (i = 0) => startLawin(avalanches.spots[i]), get lawin() { return lawin; },
    get skierClear() { return skier.skiClearance; }, skier, get roadRows() { return roadRows; }, get boxIndex() { return boxIndex; }, look, camGuard, camBlocked, setCamMode, get camMode() { return camMode; }, fpCam, spray, tracks, get mpf() { return mpf; }, get freshHere() { return freshHere; }, get riskHere() { return riskHere; },
  };

  // first build around the default piste behind the loading screen, then the picker (or straight onto the piste with ?auto=1)
  LOAD.set(0.75, 'Pisten ginn opgebaut …');
  const lastRun = store.get().last || {};
  const startPiste = pistes.byId.get(params.piste) || openPisteNear((lastRun.resort === rid && pistes.byId.get(lastRun.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
  game.piste = startPiste;
  // round 6: the free ride starts at the bottom station of a lift in a village; the first build happens there unless the page was opened
  // onto a piste (?piste= / ?auto=1 / ?map=1) or into an online race
  for (const l of modes.lifts.list) if (!l.board) { const b = boardSpot(l); l.board = { x: b.x, z: b.z }; }      // round 7 (the raster only until the footprints arrive)
  spawn = firstLift(modes.lifts, rid) || spawnLift(modes.lifts, resort.places, startPiste.bottom);      // round 7: the resort's first lift
  const openFlag = takeOpenMapFlag();
  const intoFree = (!mpCtx || mpFreeMode) && !params.auto && !params.piste && param('map') !== '1' && openFlag !== '1' && !!spawn;
  const a0 = intoFree ? (() => { const b = boardSpot(spawn); return { x: b.x, z: b.z, dx: Math.cos(b.heading), dz: Math.sin(b.heading) }; })() : startPiste.at(2, {});
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
  setCamMode(camMode, false);
  if (mpCtx && mpFreeMode) {
    // round 7: the online free ride: everybody at the same village lift (side by side), then the whole mountain together
    mpf = createMpFree({ ctx: mpCtx, host: {
      game, rid, scene, camera, canvas, surface, env, hud, input, audio, uiRoot: document.getElementById('ui'),
      outfit: () => outfit, level: () => level, liftPath: (i) => (lifts ? lifts.pathOf(i) : buildLifts().pathOf(i)),
      startFree: (slot) => { const b = boardSpot(spawn); const lat = ((slot % 2) ? 1 : -1) * Math.ceil(slot / 2) * 2.4; goFree(spawn, { x: b.x - Math.sin(b.heading) * lat, z: b.z + Math.cos(b.heading) * lat, heading: b.heading }); },
      jumpTo: (x, z, heading) => goFree(null, { x, z, heading }),
      liftBottom: (index) => { const l = modes.lifts.list.find((q) => q.index === index); return l ? boardSpot(l) : null; },
      avalanche: (ev, ageMs) => startAvalanche(ev, false, ageMs, ev.by),
    } });
    mpf.begin();
  } else if (mpCtx) {
    mp = createMp({ ctx: mpCtx, host: {
      game, rid, pistes, streamer, terrain, surface, scene, camera, canvas, env, hud, input, audio, chase, uiRoot: document.getElementById('ui'),
      outfit: () => outfit, level: () => level, startRun: (p, lateral) => startRun(p, MODES.run, lateral), liftPath: (i) => (lifts ? lifts.pathOf(i) : null),
    } });
    mp.begin();
  } else if (params.auto) {
    await streamer.ready(a0.x, a0.z, 1500);
    placeAt(a0.x, a0.z, Math.atan2(a0.dz, a0.dx));
    startRun(startPiste, MODES.run);
  } else if (param('map') === '1' || openFlag === '1') showMap();
  else if (openFlag === 'free' || param('go') === '1') goFree(spawn);       // came from the picker of another resort (switchResort)
  else showPicker();
  mark('ready');
}

boot().catch((error) => {
  console.error('[ski] boot failed', error);
  document.documentElement.dataset.bootError = error.message || 'boot';
  LOAD.fail(`Feeler: ${error.message}`);
});
