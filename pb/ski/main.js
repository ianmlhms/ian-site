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
import { createSnowMaterial } from './snow-shader.js';
import { createEnv, createNoiseTexture, createDetailTexture, createFarNormalTexture, WEATHER_LABEL, TIME_LABEL } from './env.js';
import { createScatter } from './scatter.js';
import { createScatterView } from './scatter-view.js';
import { createFarForest } from './forest-far.js';
import { createShadows } from './shadows.js';
import { createPost } from './post.js';
import { createPoles, createRunProps, createSigns } from './props.js';
import { createLifts } from './lifts.js';
import { createLiftPath } from './lift-path.js';       // R7-B: the tree aisles along the lifts
import { liftTreeGuard } from './lift-site.js';
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
import { readMpContext, mpResort, createMp } from './net/index.js';
// round 4A: game modes (stars / snow park / free ride all day), see modes/host.js
import { parkLayoutOf, createModeHost } from './modes/host.js';
import { attachModePanel, starRow, createRideHud, createChallengePrompt, showSkiCard } from './modes/panel.js';
// round 6: lift rides, challenge gates on the mountain, ski types
import { createRide, rideCamera, RIDE } from './modes/liftride.js';
import { createCarrier } from './modes/carriers.js';
import { createMarkers, markerList, MARKER } from './modes/markers.js';
import { SKI_BY_ID, DEFAULT_SKI, skiParams, addSkiStats, skiOpen } from './modes/skis.js';
import { spawnLift, startHourFor } from './modes/freeride.js';
import { createLook, applyLook, createCameraGuard, buildingBoxes, createBoxIndex } from './look.js';      // R7-A: free look + camera collision
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
  Object.assign(env.u, { uFarEnd: { value: quality.far } });          // round 7 (A): the horizon fade (FOG_GLSL)
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
  let mp = null;
  // R7-D: the lobby mode: 'race' (net/index.js) or the shared free ride (net/freeride.js: no clock, the whole area, lifts together)
  const mpFree = !!mpCtx && mpCtx.cfg.mode === 'free';
  const isRace = () => !!mp && mp.kind !== 'free';
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
  const scatter = createScatter(field, { guard: liftTreeGuard(resort, createLiftPath, field.farHeight) });       // R7-B: no trees in the lift aisles
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
  let pylonGrid = null, boxIndex = null;                    // 20 m buckets of [x, z, topY, r] (pylons, the station halls); building boxes
  function pylonsOf(l) {
    const out = [], q = {};
    for (let i = 0; i < resort.lifts.length; i++) {
      const p = l.pathOf(i);
      if (!p) continue;
      for (const sp of p.supports) if (sp.tower) { p.at(sp.s, q); out.push([q.x, q.z, sp.y + 1, 0.9]); }      // (the stations: their own parts below)
    }
    const g = new Map();
    for (const o of out) { const k = Math.floor(o[0] / 20) * 100003 + Math.floor(o[1] / 20); let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(o); }
    return g;
  }
  function camBlocked(x, y, z) {
    if (boxIndex) { const b = boxIndex.hit(x, z, 0.7); if (b && y < b[6] + 0.4) return true; }      // R8: a wider margin (the near plane)
    if (pylonGrid) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const a = pylonGrid.get((Math.floor(x / 20) + dx) * 100003 + Math.floor(z / 20) + dz);
        if (a) for (const o of a) if (y < o[2] && Math.hypot(x - o[0], z - o[1]) < o[3] + 0.4) return true;
      }
    }
    // R8: the stations by their real solid parts (lift-site.js: walls, posts, roofs, huts), the camera as a 0.5 m box round its point
    // (only near a station end: the lift world's lookup allocates, and this runs ~20 times a frame)
    if (nearStation(x, z) && modes.lifts.world.hit(x, z, 0.3, y - 0.25, (gx, gz) => surface.height(gx, gz), 0.5)) return true;
    return !!scatter.hit(x, z, 1.1, y, quality.treeDensity);
  }
  let stationGrid = null;                                   // R8: 50 m cells holding a station end (the camera guard's cheap pre-test)
  const nearStation = (x, z) => !!stationGrid && stationGrid.has(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  function stationCells(l) {
    const g = new Set(), q = {};
    for (let i = 0; i < resort.lifts.length; i++) {
      const p = l.pathOf(i);
      if (!p) continue;
      for (const e of [0, p.len]) { p.at(e, q); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) g.add((Math.floor(q.x / 50) + dx) * 100003 + Math.floor(q.z / 50) + dz); }
    }
    return g;
  }
  const camGuard = createCameraGuard({ ground: (x, z) => surface.height(x, z), blocked: camBlocked });
  let lookDt = 1 / 60;
  /** R8: the look offset + the camera guard for a camera round a pivot (head = turn round the eye: cabin window / tunnel). */
  function lookCam(cam, pivot, head) {
    applyLook(cam, pivot, look, head ? 'head' : 'orbit');
    if (!head) {
      const full = Math.hypot(cam.x - pivot.x, cam.y - pivot.y, cam.z - pivot.z);
      camGuard.guard(cam, pivot, lookDt);
      // R8 (early QA: the camera jammed 1 m behind him in the trees): pulled in, it also rises and looks down over the obstacle
      const near = Math.hypot(cam.x - pivot.x, cam.y - pivot.y, cam.z - pivot.z);
      if (near < full * 0.75) cam.y += Math.min(2.5, (full - near) * 0.6);
      // R8 (early QA: the free look put the camera under the street): never under the snow, whatever the guard's minimum distance did
      const gy = surface.height(cam.x, cam.z) + 0.45;
      if (cam.y < gy) cam.y = gy;
    }
    return cam;
  }
  // R7-B's seam in rideCamera1: the lift camera turns with the same look
  window.__skiLook = {
    apply(cam, o = {}) {
      const w = ride ? ride.where() : game.state;
      if (!w) return cam;
      return lookCam(cam, { x: w.x, y: w.y + (game.state && game.state.ride === 'sit' ? 0.6 : 1.2), z: w.z }, !!o.inside);
    },
  };
  let snowfall = createSnowfall({ scene, env, count: quality.snowflakes });
  const spray = createSpray({ scene, count: quality.spray });
  let signs = null;                                                          // R7-D
  let lifts = null, village = null, landmarks = null, roads = null, roadRows = null, extrasBuilt = false, liftsEarly = false, markers = null;
  /** Round 6: the lift view (lifts.js). Built once every tile is in; a ride before that builds it early on the heights there are, and it
   *  is built again (between rides) once all tiles are in. */
  function buildLifts() {
    if (lifts && !liftsEarly) return lifts;
    if (lifts && ride) { liftsEarly = true; return lifts; }                 // riding: rebuilt when the ride ends
    if (lifts) lifts.dispose();
    lifts = createLifts({ scene, resort, height: (x, z) => field.height(x, z) });
    liftsEarly = !streamer.done();
    try { stationGrid = stationCells(lifts); } catch (error) { console.warn('[ski] station grid failed', error); }
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
    // round 7 (A): a finer tile under a skier who stands (or would be under the snow): back onto the real ground
    { const st = game.state; if (st && !st.ride && st.crash === 0 && st.x >= rect[0] - 5 && st.x <= rect[2] + 5 && st.z >= rect[1] - 5 && st.z <= rect[3] + 5) { const h = surface.height(st.x, st.z); if (st.y < h - 0.02 || (st.grounded && st.speed < 1.5 && Math.abs(st.y - h) > 0.02)) game.state = { ...st, y: h, vy: 0, grounded: true }; } }
    terrain.invalidate(...rect);
    scatter.invalidate(...rect);
    scatterView.invalidate();
    farForest.invalidate(...rect);
    poles.reset();
    if (runProps && game.piste) { runProps.dispose(); runProps = createRunProps({ scene, piste: game.piste, height: (x, z) => surface.height(x, z), gates: game.run ? game.run.gates : [] }); }
    if (modes) modes.onTiles(rect);
    if (streamer.done()) document.documentElement.dataset.skiTilesDone = '1';
    if (markers) markers.reseat();
    if (streamer.done() && !extrasBuilt) {
      extrasBuilt = true;
      buildLifts();
      signs = createSigns({ scene, resort, height: (x, z) => field.height(x, z) });          // R7-D: atlas slots on demand (update below)
      signs.update(camera.position.x, camera.position.z, true);
      landmarks = createLandmarks({ scene, resort, height: (x, z) => surface.height(x, z), pistes });
      if (modes) modes.ensureParkView();
      mark('lifts');
      tryRoads();
    }
  });
  // round 7 (A): the buildings / streets download starts once the skier is on the snow (or after 6 s on a menu): they are not part of
  // the first play's bytes (the boarding spot is the lift station's own zone, R7-B, so nothing has to be re-placed when they arrive)
  let extrasStarted = false, extrasGo = null;
  const extrasGate = new Promise((res) => { extrasGo = res; });
  const startExtras = () => { if (!extrasStarted) { extrasStarted = true; extrasGo(); } };
  setTimeout(startExtras, 6000);
  extrasGate.then(() => loadExtras(core.root)).then(({ buildings, roads: streets }) => {
    // R7-B: the lift stations replace the OSM station buildings (and nothing stands in a lift lane); the exits keep clear of the rest
    const liftWorld = modes.lifts.setBuildings(buildings);
    // the houses that are drawn (R7-B leaves out the ones in stations / lift paths): camera guard + skier collision (R8)
    try { boxIndex = createBoxIndex(buildingBoxes(buildings.filter((_, i) => liftWorld.keepBuilding(i)))); } catch (error) { console.warn('[ski] building index failed', error); }
    village = createVillage({ scene, rows: buildings.filter((_, i) => liftWorld.keepBuilding(i)), env, height: (x, z) => field.baseHeight(x, z), level, resort: rid }); mark('village');      // R8c: resort = Alpine villages
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
    hit: (x, z, r, y) => scatter.hit(x, z, r, y, quality.treeDensity) || modes.lifts.world.hit(x, z, r, y, (gx, gz) => surface.height(gx, gz)) || buildingHit(x, z, r, y),     // R7-B: pylons + stations; R8: houses
  };
  /** R8 (early QA: he skied through chalets): the houses collide like the station walls: out by the nearest face of the footprint box. */
  const houseHit = { nx: 0, nz: 0, pen: 0, kind: 'house' };
  function buildingHit(x, z, r, y) {
    if (!boxIndex) return null;
    const b = boxIndex.hit(x, z, r);
    if (!b || (y !== undefined && y > b[6])) return null;
    const dx = x - b[0], dz = z - b[1], u = dx * b[2] + dz * b[3], v = -dx * b[3] + dz * b[2];
    const pu = b[4] + r - Math.abs(u), pv = b[5] + r - Math.abs(v);
    if (pu < pv) { const su = Math.sign(u) || 1; houseHit.nx = b[2] * su; houseHit.nz = b[3] * su; houseHit.pen = pu; }
    else { const sv = Math.sign(v) || 1; houseHit.nx = -b[3] * sv; houseHit.nz = b[2] * sv; houseHit.pen = pv; }
    return houseHit;
  }
  const input = createInput({ root: document.getElementById('ui'), onAction });
  input.showTouch(false);
  const hud = ui.createHud({ onButton: onAction });
  hud.show(false);
  // ---- round 4A: the game modes (stars, snow park, free ride all day) ----
  const modes = createModeHost({
    scene, resort, rid, pistes, field, surface, store, hud, uiRoot: document.getElementById('ui'), input, env, audio, world, layout: parkLayout,
    root: core.root, outfits: OUTFITS, onRideUp: () => boardLift(), onProgressChanged: () => refreshMapMarks(), onSkis: () => openSkiCard(),
    snowMaterial: () => snowMat,                                             // R7-D: the park's snow meshes share the terrain's material
  });
  // ---- round 6: ski types (physics per type; timed / scored runs use the reference set: modes/skis.js FAIRNESS) ----
  let skiType = DEFAULT_SKI;
  const fairNow = () => isRace() || game.mode === MODES.run || game.mode === MODES.park;
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
  let dismissed = null;
  const chPrompt = createChallengePrompt(hud.el, { onStart: (m) => acceptChallenge(m), onNo: (m) => { dismissed = m.id; chPrompt.show(null); } });
  function promptInfo(m) {
    if (m.park) return { goal: 'Punkten fir Tricks · Bestenlëscht vum Park' };
    const c = modes.challengeOf(m.piste);
    return { mask: pisteStars(store.get(), rid, m.piste.id), goal: c ? `Ënner ${formatTime(c.targetMs).replace(/(\.\d)\d+$/, '$1')} · ${specialText(c)}` : '' };
  }
  function acceptChallenge(m) {
    chPrompt.show(null);
    dismissed = m.id;
    if (m.park) startPark(); else startRun(m.piste, MODES.run);
  }
  // ---- round 6: lift rides ----
  let ride = null, carrier = null, rideView = 'chase', rideCam = null, skipping = false;
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
      onBack: () => { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; game.resume = null; modes.end(); showPicker(); },
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
    if (mode === MODES.run && !isRace() && !modes.isOpen(p) && !params.debug) { hud.toast('Gespaart'); return; }      // an online race may be on any piste
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
    game.hold = false;                                                       // R7-B
    if (mode === MODES.run || mode === MODES.park) { game.phase = 'countdown'; game.countdown = params.auto ? 0.01 : 3; }
    else { game.phase = 'running'; hud.count(''); }
    if (isRace()) { game.phase = 'hold'; game.ghost = null; hud.count(''); }          // online race: net/index.js starts the 3-2-1 for everybody
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
    if (isRace()) { mp.onFinish(result); return; }                                 // online race: its own results screen
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
  /** Where a skier waits for a lift (R7-B): in its bottom station's boarding zone, facing up the line (lift-site.js). */
  const boardSpot = (lift) => modes.lifts.boardAt(lift);
  /** Round 7 (A): behind a fade, the full-detail terrain round a new spot is meshed before the fade lifts (right after a jump the tiles
   *  there were still the coarse ones and the skirts of the half-built ones showed as tall smeared walls for ~1.5 s). The terrain gets a
   *  bigger time slice meanwhile; at most 2.5 s. */
  let meshRush = false, rushAt = null;
  async function meshedAround(p) {
    meshRush = true; rushAt = { x: p.x, z: p.z };
    const t0 = performance.now();
    terrain.update(p.x, p.z, 20);
    while (performance.now() - t0 < 2500 && terrain.stats.pending > 0) await new Promise((res) => setTimeout(res, 50));
    meshRush = false;
  }
  /** Round 6: free ride from a lift's bottom station (fast travel: a short fade while the tiles there arrive) or from a spot. */
  async function goFree(lift, spotIn = null) {
    const spot = spotIn || (lift ? boardSpot(lift) : null);
    if (!spot) return;
    const fade = fader();
    fade.classList.add('on');
    streamer.focus(spot.x, spot.z);
    await Promise.race([streamer.ready(spot.x, spot.z, 600), new Promise((res) => setTimeout(res, 6000))]);
    await meshedAround(spot);                                                // round 7 (A): no coarse-tile skirts after the fade
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
    game.hold = !!lift;                                     // R7-B: in the boarding zone he stands still until he moves
    document.documentElement.dataset.skiRunning = '1';
    hud.toast(lift ? `${lift.name}: Astegen mat L / Enter` : 'Fräi fueren');
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('free');
    setTimeout(startExtras, 400);                                       // round 7 (A): the houses and streets after the first frames
    if (!pictureChecks) setTimeout(pictureCheck, 3500);                 // round 7 (A): the picture check
  }
  /** Round 6 / R7-B: board the lift at hand (the skier stands in its boarding zone): one press = one boarding. The ride walks / skates
   *  him to the loading line, the next carrier of the lift's own loop picks him up there, up the real line, off at the top station, out
   *  to the exit spot (lift-site.js), and he stands still there until the player moves (game.hold). */
  function boardLift() {
    if (game.mode !== MODES.freeride || game.phase !== 'running' || ride || game.paused) return;
    const lift = modes.liftAt;
    if (!lift) return;
    const view = buildLifts();
    const path = view.pathOf(lift.index), site = view.siteOf(lift.index);
    if (!path || !site) { hud.toast('Dëse Lift fiert net'); return; }
    const st = game.state;
    if (!site.inZone(st.x, st.z)) return;                                   // only from inside the zone (no jump onto the line)
    const height = (x, z) => surface.height(x, z);
    // the next carrier of the lift's own loop that reaches the loading line at least 1.6 s from now picks him up
    const loadU = path.shuttle ? null : path.upU(Math.min(RIDE.enter[site.key], path.len * 0.2));
    const next = loadU === null ? null : view.nextCarrier(lift.index, loadU, path.spec.speed * 1.6);
    ride = createRide({ lift, path, site, height, from: { x: st.x, z: st.z, heading: st.heading }, startU: next ? next.u : null,
      exitAt: () => modes.lifts.world.exitOf(lift.index, height, (x, z) => !!scatter.hit(x, z, 0.4, -1e9, quality.treeDensity), pistes.list) });
    carrier = createCarrier({ scene, kind: path.kind, seats: path.seats, sub: path.sub });
    modes.rideStart(lift);
    chPrompt.show(null);
    game.phase = 'lift'; game.hold = false;
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
    ride.step(dt);
    game.state = ride.state(game.state);
    const w = ride.where();
    const u = ride.carrierU;
    if (lifts) lifts.setRide(ride.lift.index, u);
    if (carrier && u === null) { carrier.dispose(); carrier = null; }        // off: the lift's own loop takes the carrier on
    if (carrier) carrier.place(w);
    document.documentElement.dataset.skiRidePhase = ride.phase;
    streamer.focus(w.x + Math.cos(w.heading) * 120, w.z + Math.sin(w.heading) * 120);
    if (ride.done && !skipping) arrive();
  }
  function rideCamera1(dt) {
    const w = ride.where();
    const want = rideCamera(ride.path, w, rideView, (x, z) => surface.height(x, z));
    // chase: the camera rides with the carrier (no lag at x4); only its offset round the rider eases (a bend of the line turns it softly)
    const off = { x: want.x - w.x, y: want.y - w.y, z: want.z - w.z, tx: want.tx - w.x, ty: want.ty - w.y, tz: want.tz - w.z, fov: want.fov };
    if (rideView === 'window' || !rideCam || rideCam.onCarrier !== w.onCarrier) rideCam = { off, onCarrier: w.onCarrier };
    else { const k = 1 - Math.exp(-dt * 3); for (const key of Object.keys(off)) rideCam.off[key] += (off[key] - rideCam.off[key]) * k; }
    const o = rideCam.off;
    const out = { x: w.x + o.x, y: w.y + o.y, z: w.z + o.z, tx: w.x + o.tx, ty: w.y + o.ty, tz: w.z + o.tz, fov: o.fov };
    if (rideView !== 'window' && !want.inside) out.y = Math.max(out.y, surface.height(out.x, out.z) + 0.8);
    // R7-B hook for the 360-degree look-around (agent A's pb/ski/look.js): window.__skiLook.apply(cam, { inside, kind }) may turn it
    if (window.__skiLook && typeof window.__skiLook.apply === 'function') return window.__skiLook.apply(out, { inside: !!want.inside || (rideView === 'window'), kind: ride.kind, lift: true }) || out;
    return out;
  }
  function toggleRideView() {
    rideView = rideView === 'chase' ? 'window' : 'chase';
    rideCam = null;
    document.documentElement.dataset.skiRideView = rideView;
    if (ride) hud.toast(rideView === 'window' ? 'Vue: duerch d\'Fënster' : 'Vue: vu baussen', 900);
  }
  /** Iwwersprangen: only on the carrier (not while boarding: one press = one boarding); a short fade to the top station. */
  async function skipRide() {
    if (!ride || skipping || !ride.canSkip) return;
    skipping = true;
    const fade = fader();
    fade.classList.add('on');
    await new Promise((res) => setTimeout(res, 320));
    if (!ride) { fade.classList.remove('on'); skipping = false; return; }
    const top = ride.lift.top;
    streamer.focus(top.x, top.z);
    await Promise.race([streamer.ready(top.x, top.z, 500), new Promise((res) => setTimeout(res, 3000))]);
    await meshedAround(top);
    if (ride) { ride.skip(); stepRide(0); }
    skipping = false;
    fade.classList.remove('on');
    if (ride && ride.done) arrive();
  }
  /** Off at the top: the ride has brought him out of the station to the exit spot; he stands still there until the player moves. */
  function arrive() {
    if (!ride) return;
    const r = ride;
    ride = null; skipping = false;
    if (lifts) lifts.setRide(r.lift.index, null);
    if (carrier) { carrier.dispose(); carrier = null; }
    rideHud.show(null);
    const ex = r.exit || modes.lifts.startAt(r.lift, (x, z) => surface.height(x, z));
    const spot = { x: ex.x, z: ex.z, heading: ex.heading };
    if (modes.freeRun) modes.freeRun.moved(spot);
    placeAt(spot.x, spot.z, spot.heading);
    game.hold = true;                                                          // R7-B: 0 km/h until the player steers or pushes
    game.phase = 'running';
    input.setEnabled(true); input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    hud.toast(`${r.lift.name}: uewen op ${Math.round(r.lift.top.y)} m`);
    document.documentElement.dataset.skiRide = '';
    document.documentElement.dataset.skiRidePhase = '';
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
    if (action === 'weather') { const m = env.cycleWeather(); hud.toast(`Wieder: ${WEATHER_LABEL[m]}${m === 'random' ? ` (${WEATHER_LABEL[env.state.weatherId]})` : ''}`); }
    else if (action === 'time') { const m = env.cycleTime(); if (modes.clock && m !== 'random') modes.clock.set(startHourFor(m)); hud.toast(`Zäit: ${TIME_LABEL[m]}${m === 'random' ? ` (${TIME_LABEL[env.state.timeId]})` : ''}`); }
    else if (action === 'reset') { if (game.screen === 'ski' && game.phase === 'running') respawn('Zréck op d\'Pist'); }
    else if (action === 'menu') { if (skiCard) skiCard.close(); else if (menuCard) { menuCard.close(); menuCard = null; game.paused = false; input.setEnabled(game.phase === 'running' || game.phase === 'countdown'); } else if (game.screen === 'map' && game.resume) resumeFree(); else openMenu(); }
    else if (action === 'map') { if (game.screen === 'ski') showMap(); else if (game.screen === 'map' && game.resume) resumeFree(); }
    else if (action === 'view') { if (ride) toggleRideView(); }
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
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => { if (!isRace()) again(); });

  // quality: the shared Grafik level; a watchdog only ever steps down
  function applyQuality(next) {
    level = next; quality = QUALITY[level];
    post.setSpec(quality.res); resize();
    camera.far = quality.far * 1.3; camera.updateProjectionMatrix();
    env.u.uFarEnd.value = quality.far;
    snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex, lodScale: quality.lodScale });
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
          // R7-B: off a lift he stands still (an edge set, 0 km/h, even on a slope) until the player steers, pushes, tucks or jumps
          let held = false;
          if (game.hold && game.phase === 'running') {
            if (inp.steer || inp.push || inp.tuck || inp.jump || inp.brake) game.hold = false;
            else { game.state = { ...game.state, vx: 0, vy: 0, vz: 0, speed: 0, y: surface.height(game.state.x, game.state.z), grounded: true, crash: 0 }; held = true; }
          }
          const wasCrash = game.state.crash > 0, wasAir = !game.state.grounded, vyAir = game.state.vy;
          const prevState = game.state;
          game.state = held ? prevState : modes.step(prevState, inp, game.mode);                // round 4A: rails / park tricks, else stepSkier
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
      skier.setVisible(!(ride && rideView === 'window' && ride.carry && ride.where().onCarrier && !game.camPose));     // in a cabin, the window view is his own eyes
      if (game.orbit) {                                                // debug: a camera that circles the skier (model checks)
        const o = game.orbit, a = st.heading + o.angle * Math.PI / 180;
        const ox = st.x + Math.cos(a) * o.dist, oz = st.z + Math.sin(a) * o.dist;
        // round 7 (A): never under the snow (an uphill bank beside the skier put this debug camera inside the slope: a 'wall' of skirts)
        game.camPose = { x: ox, z: oz, y: Math.max(st.y + o.h, surface.height(ox, oz) + 0.6), tx: st.x, ty: st.y + 0.8, tz: st.z, fov: o.fov || 40 };
      }
      const view = (mp && mp.viewState()) || st;                     // online race: watching another skier after my finish
      const riding = !!(ride && game.phase === 'lift');
      lookDt = dt;
      if (!game.camPose && game.screen === 'ski') look.step(dt, st.speed || 0);
      // round 7 (A): the free look + camera guard (the lift camera gets it through R7-B's window.__skiLook seam in rideCamera1)
      let cam = game.camPose || (riding ? rideCamera1(dt) : chase.update(view, dt, time));      // camPose: a fixed view (flows)
      if (!game.camPose && !riding && game.screen === 'ski') cam = lookCam({ ...cam }, { x: view.x, y: view.y + 1.2, z: view.z }, false);
      document.documentElement.dataset.skiLook = `${look.yaw.toFixed(2)},${look.pitch.toFixed(2)}`;
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      if (mp) mp.render(now, time);
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
      const amount = game.screen === 'ski' && st.grounded && st.speed > 3 ? Math.min(1, st.slip * 2.5 + st.brake * 0.8 + Math.abs(st.edge) * 0.35) * Math.min(1, st.speed / 12) : 0;
      spray.update(dt, st, amount, pixelRatio());
    }
    // world upkeep (time-sliced)
    const fx = st ? st.x : resort.width / 2, fz = st ? st.z : resort.depth / 2;
    if (game.screen === 'ski' || game.screen === 'map') {
      streamer.focus(fx, fz);
      if (meshRush && rushAt) terrain.update(rushAt.x, rushAt.z, 12);            // round 7 (A): meshing the jump target behind the fade
      else terrain.update(camera.position.x, camera.position.z, game.screen === 'map' ? 12 : 2.5);
      scatterView.update(camera.position.x, camera.position.z, false, game.screen === 'map' ? 12 : 2.5, dt);
      farForest.update(camera.position.x, camera.position.z, game.screen === 'map' ? 8 : 1.5);
      poles.update(camera.position.x, camera.position.z, quality.markerRadius);
      if (lifts) lifts.update(time, camera.position.x, camera.position.z, quality.liftRadius);
      if (signs) signs.update(camera.position.x, camera.position.z);              // R7-D: the sign atlas follows the camera
      if (village) village.update(camera.position.x, camera.position.z, quality.buildingRadius);
      if (landmarks) landmarks.update(camera.position.x, camera.position.z, quality.buildingRadius);
      if (roads) roads.update(camera.position.x, camera.position.z, Math.min(quality.buildingRadius, level === 'low' ? 1300 : 2400));      // round 7 (A): streets near only
      modes.update(camera.position.x, camera.position.z, quality.buildingRadius);
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
      if (st) env.setSunScale(sunVisibility(st.x, st.y + 1, st.z));
      if (game.screen === 'map') updateStartStatus();
      if (game.screen === 'ski' && st) {
        // R8 (early QA: 43 km/h on the speedo while dragged up a T-bar at x4): on a lift the speedo shows the lift's real line speed
        hud.setSpeed(ride ? (ride.phase === 'ride' ? ride.path.spec.speed * 3.6 : 0) : st.speed * 3.6);
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
      const m = markers.at(st.x, st.z);
      if (dismissed && (!m || m.id !== dismissed)) { const d = markers.byId(dismissed); if (!d || Math.hypot(d.x - st.x, d.z - st.z) > MARKER.rearm) dismissed = null; }
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
    get lifts() { return lifts; }, get signs() { return signs; }, markers, setSki, get skiType() { return skiType; }, get world() { return world; }, openSkiCard, resumeFree, acceptChallenge, showMap,
    place(x, z, heading) { placeAt(x, z, heading); },
    // R7-B (flows): stand still at (x, z) like after a lift (0 km/h until an input), the scatter for the tree checks
    placeHold(x, z, heading) { placeAt(x, z, heading); game.hold = true; if (modes.freeRun) modes.freeRun.moved({ x, z, heading }); },
    get hold() { return !!game.hold; }, scatter, quality,
    // round 7 (A)
    get skierClear() { return skier.skiClearance; }, skier, get roadRows() { return roadRows; }, get boxIndex() { return boxIndex; }, look, camGuard, camBlocked,
  };

  // first build around the default piste behind the loading screen, then the picker (or straight onto the piste with ?auto=1)
  LOAD.set(0.75, 'Pisten ginn opgebaut …');
  const lastRun = store.get().last || {};
  const startPiste = pistes.byId.get(params.piste) || openPisteNear((lastRun.resort === rid && pistes.byId.get(lastRun.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
  game.piste = startPiste;
  // round 6: the free ride starts at the bottom station of a lift in a village; the first build happens there unless the page was opened
  // onto a piste (?piste= / ?auto=1 / ?map=1) or into an online race
  // (R7-D: the online free ride starts everybody at the same lift: the resort's start piste decides, never a player's saved piste)
  spawn = spawnLift(modes.lifts, resort.places, mpFree ? (pistes.byId.get(resort.start) || pistes.list[0]).bottom : startPiste.bottom);
  const openFlag = takeOpenMapFlag();
  const intoFree = (!mpCtx || mpFree) && !params.auto && !params.piste && param('map') !== '1' && openFlag !== '1' && !!spawn;
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
  if (mpCtx) {
    // R7-D: avalanches of round 7 C (window.__ski.avalanches: onTrigger / triggerAvalanche(id, seed, t s)) are shared in the free ride
    const avalancheApi = () => (window.__ski && window.__ski.avalanches) || null;
    mp = createMp({ ctx: mpCtx, host: {
      game, rid, pistes, streamer, terrain, surface, scene, camera, canvas, env, hud, input, audio, chase, uiRoot: document.getElementById('ui'),
      outfit: () => outfit, level: () => level, startRun: (p, lateral) => startRun(p, MODES.run, lateral),
      // R7-D: a friend on a lift is drawn in his carrier even before this device rode one (the lift view is built early, once)
      liftPath: (i) => { if (!lifts) buildLifts(); return lifts ? lifts.pathOf(i) : null; },
      // R7-D free ride
      liftName: (i) => { const l = modes.lifts.byIndex.get(i); return l ? l.name : ''; },
      startSpot: (lateral) => { const b = boardSpot(spawn); return { x: b.x - Math.sin(b.heading) * lateral, z: b.z + Math.cos(b.heading) * lateral, heading: b.heading }; },
      startFree: (spot) => goFree(spawn && Math.hypot(spot.x - spawn.bottom.x, spot.z - spawn.bottom.z) < 60 ? spawn : null, spot),
      dayClock: () => modes.clock,
      liftTop: (i) => { const l = modes.lifts.byIndex.get(i); return l ? modes.lifts.startAt(l, (x, z) => surface.height(x, z)) : null; },
      avalanche: { trigger: (id, seed, tMs) => { const a = avalancheApi(); if (a && a.triggerAvalanche) a.triggerAvalanche(id, seed, tMs / 1000); } },
    } });
    mp.begin();
    { const a = avalancheApi(); if (mpFree && a && a.onTrigger) a.onTrigger((e) => mp.shareAvalanche(e.id, e.seed, e.t * 1000)); }
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
