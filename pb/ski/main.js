/* Ski Alpen: boots one resort and runs the game.
 *   round 6: loading -> resort picker -> FREE RIDE (the main game) from a village lift's bottom station: ski anywhere, ride the real
 *   lifts (chairs, cabins, drag lifts, trains), ski into a challenge's start gate -> 3-2-1 -> timed run with a ghost -> finish card ->
 *   free riding on from the bottom. The piste map is the pause overlay: where you are, fast travel to any lift, the challenge list (as
 *   before: piste -> Start), the snow park, the ski types.
 * URL: ?resort=killy ?piste=<id> ?auto=1 (straight onto the piste, no screens) ?bot=1 (scripted skier) ?q=low|medium|high
 *      ?weather=sun|cloudy|snow|fog|random ?time=morning|midday|evening|random ?debug=1 (window.__ski)
 * The page is also loaded as a srcdoc iframe by the arcade: every URL is absolute or built from import.meta.url. */
import { QUALITY, FRAME_BUDGET_MS, SKI, MODES, CAMERA, LATTICE, DATA, COURSE } from './config.js';
import { loadResortCore, createTileStreamer, loadExtras, RESORTS } from './resort-data.js';
import { released as gpuReleased, uploadNow, textureGpuOnly } from './gpu-mem.js';
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
import { createRuins, loadRuins } from './ruins.js';
import { createLiftPath } from './lift-path.js';       // R7-B: the tree aisles along the lifts
import { liftTreeGuard } from './lift-site.js';
import { seatRows, createVillage } from './village.js';
import { createRoads, decodeRoads, housesOnStreets } from './roads.js';
import { createLandmarks } from './landmarks.js';
import { createPisteSet } from './pistes.js';
import { createSkierState, stepSkier, launchState, rollOn } from './skier.js';
import { frameSeconds, planSteps } from './clock.js';          // launch fix: real time down to 10 fps (was 20)
import { createSkierModel, readOutfit, writeOutfit, OUTFITS } from './skier-model.js';
import { createChaseCamera } from './camera.js';
import { createInput } from './input.js';
import { createSnowfall } from './effects.js';
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
import { areaTitle } from './picker.js';
import { attachModePanel, starRow, createRideHud, createChallengePrompt, showSkiCard } from './modes/panel.js';
// round 6: lift rides, challenge gates on the mountain, ski types
import { createRide, createDescent, rideCamera, RIDE } from './modes/liftride.js';
import { createCarrier } from './modes/carriers.js';
import { createMarkers, markerList, MARKER, promptable } from './modes/markers.js';
import { SKI_BY_ID, DEFAULT_SKI, skiParams, addSkiStats, skiOpen } from './modes/skis.js';
import { spawnLift, startHourFor, BOARDING } from './modes/freeride.js';
import { createLook, applyLook, createCameraGuard, buildingBoxes, createBoxIndex } from './look.js';      // R7-A: free look + camera collision
import { pisteStars, specialText } from './modes/challenges.js';
// R7-C: map teleport to discovered places + the first-lift spawn, first person, snow spray, avalanches, the challenge course
import { createExplore } from './modes/explore.js';
import { courseGate, courseFinish } from './modes/clear.js';
import { createCourse, createCourseView, createCourseHud, courseLayout, showCourseAbort } from './modes/course.js';
import { createFirstPerson, readCamMode, writeCamMode } from './firstperson.js';
import { createSnowSpray } from './spray.js';
import { createAvalanches } from './avalanche.js';
// the other skiers (Ian: "you're not alone in the whole ski area"): npc.js simulates, npc-view.js draws (2 instanced meshes)
import { createCrowd, dayShare, corridorOf, strHash } from './npc.js';
import { createNpcView } from './npc-view.js';
import { createQueueView } from './queue-view.js';
// replay + photo mode (28 Nov 2026): a rolling recorder of the skier state, playback with five cameras, a free orbit camera + saved PNG
import { createRecorder, createReplay, FREE_CLIP_S, RECORD } from './replay.js';
import { createPhoto } from './photo.js';

const THREE = window.THREE;
const LOAD = window.__skiLoad || { set() {}, done() {}, fail() {} };
const mark = (name) => { try { performance.mark(`ski:${name}`); } catch (error) { /* no marks */ } };
const DEFAULT_PISTE = 'diebold';
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
/** "Aner Skifuerer" (the other skiers): on unless switched off in the menu (?npcs=0 / 1 for tests). */
const NPC_KEY = 'pb_ski_npcs';
function readNpcPref(param) {
  if (param === '0' || param === '1') return param === '1';
  try { return localStorage.getItem(NPC_KEY) !== '0'; } catch (error) { return true; }
}
function writeNpcPref(on) { try { localStorage.setItem(NPC_KEY, on ? '1' : '0'); } catch (error) { console.warn('[ski] could not store the other-skiers setting', error); } }
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
    let log = '';
    try { log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || ''); } catch (error) { log = `no log (${error.message})`; }
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
  // R8b (3V QA: WebKit lost the context once, then a TypeError in three's getShaderInfoLog(...).trim() every frame): while lost nothing
  // is drawn or compiled; restored within 2.5 s -> carry on (three re-uploads), else a card "Neu lueden" (a reload keeps the save)
  let glLost = false, glCard = null, leaving = false;           // leaving: R8f pagehide below
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glLost = true;
    document.documentElement.dataset.skiGlLost = '1';
    console.warn('[ski] WebGL context lost');
    setTimeout(() => {
      if (!glLost || glCard) return;
      glCard = Object.assign(document.createElement('div'), { className: 'card', id: 'glLostCard', role: 'dialog' });
      glCard.innerHTML = '<h2>D\'Grafik ass ewech</h2><p class="m">De Browser huet d\'3D-Grafik zougemaach (vill aner Tabs oder wéineg Späicher).</p><div class="acts"><button type="button" class="btn primary" id="glReload">Neu lueden</button></div>';
      document.getElementById('ui').appendChild(glCard);
      glCard.querySelector('#glReload').addEventListener('click', () => { try { if (typeof modes !== 'undefined' && modes.cloud) modes.cloud.flush(); } catch (error) { console.warn('[ski] save before reload failed', error); } location.reload(); });
    }, 2500);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // R8f: drawn-only geometry (gpu-mem.js) has no JS copy left to upload again: load the page again (the save is kept)
    if (gpuReleased() && !leaving) { try { if (typeof modes !== 'undefined' && modes.cloud) modes.cloud.flush(); } catch (error) { console.warn('[ski] save before reload failed', error); } location.reload(); return; }
    glLost = false;
    document.documentElement.dataset.skiGlLost = '';
    if (glCard) { glCard.remove(); glCard = null; }
    console.warn('[ski] WebGL context restored');
  });
  // R8f (memory: a resort switch = a new page life): when the page goes away (switchResort's location.replace, a reload, the arcade
  // closing the frame) its GPU memory is given back at once (three's programs / buffers / targets, then the context itself) instead of
  // whenever the old document is collected; a page restored from the back-forward cache has no context left: it loads again.
  window.addEventListener('pagehide', () => {
    if (leaving) return;
    leaving = true;
    try { if (typeof streamer !== 'undefined' && streamer) streamer.stop(); } catch (error) { /* not created yet */ }
    try { scene.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); }); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (error) { console.warn('[ski] GPU release on leave failed', error); }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && leaving) location.reload(); });

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
    env.setFarNormals(textureGpuOnly(createFarNormalTexture(core.far, st)));             // round 5: the far mountains are lit per pixel from the 40 m grid
    mark('far normals');
  }
  const net = createPisteNet(resort.network);
  const parkLayout = parkLayoutOf(resort);                                   // round 4A: the snow park is part of the height function
  const field = createField({ resort, far: core.far, classes: core.classes, net, park: parkLayout });
  const surface = createSurface(field);
  const surfaceAt = (gx, gz) => surface.height(gx, gz);                       // (one closure, not one per collision test: cleanup round)
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
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; textureGpuOnly(t);   // R8f
    return { texture: t, width: nx * resort.classes.step, depth: nz * resort.classes.step };
  })();
  let snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex, lodScale: quality.lodScale });
  const terrain = createTerrainView({ scene, surface, field, material: snowMat, quality });
  const scatterView = createScatterView({ scene, scatter, env, quality, normalAt: (x, z, o) => surface.normal(x, z, o, 2.5) });
  const farForest = createFarForest({ scene, env, classes: core.classes, resort, field, quality });
  const poles = createPoles({ scene, resort, height: (x, z) => field.height(x, z) });
  let outfit = readOutfit();
  const skier = createSkierModel({ outfit, skinned: true });                  // R8b: one skinned mesh (Niddreg draw calls)
  skier.setBlob(level === 'low');
  const ghostModel = createSkierModel({ ghost: true, outfit, skinned: true });
  const setOutfit = (id) => { outfit = id; writeOutfit(id); skier.setOutfit(id); ghostModel.setOutfit(id); };
  scene.add(skier.root, ghostModel.root);
  ghostModel.setVisible(false);
  const chase = createChaseCamera(surface);
  // ---- round 7 (A): free 360 look (drag / right mouse / C + mouse) and the camera guard (never through ground, pylons, trees, houses) ----
  const look = createLook({ el: document.getElementById('shell'), accept: (e) => game.screen === 'ski' && !e.target.closest('button, a, input, .pad, #touchControls, .card, .minimap, .chprompt, .mp-bar, .mp-card, [role="dialog"]') });
  let pylonGrid = null, boxIndex = null, streetBoxes = null;                    // 20 m buckets of [x, z, topY, r] (pylons, the station halls); building boxes
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
    if (nearStation(x, z) && modes.lifts.world.hit(x, z, 0.3, y - 0.25, surfaceAt, 0.5)) return true;
    if (ruins && ruins.hit(x, z, 0.4, y - 0.25)) return true;
    return !!scatter.hit(x, z, 1.1, y, quality.treeDensity) || !!scatter.inCrown(x, y, z, quality.treeDensity, 0.35);      // R8e: the crowns too
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
      // R8e (3V QA: after a crash next to a trunk the guard's 1.1 m minimum still sat in the branches): out of a crown upwards (the
      // crown narrows with height), at most to its top
      for (let i = 0, c = scatter.inCrown(cam.x, cam.y, cam.z, quality.treeDensity, 0.35); c && i < 24; i++, c = scatter.inCrown(cam.x, cam.y, cam.z, quality.treeDensity, 0.35)) cam.y = Math.min(cam.y + 0.5, c.top + 0.6);
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
  let spray = createSnowSpray({ scene, env, level, height: (x, z) => surface.height(x, z) });          // R7-C: spray.js
  let signs = null;                                                          // R7-D
  let ruins = null, ruinRows = null;                                          // lift ruins (ruins.js): closed lifts, solid scenery only
  let lifts = null, village = null, landmarks = null, roads = null, roadRows = null, extrasBuilt = false, liftsEarly = false, markers = null;
  let crowd = null, npcView = null, npcOn = readNpcPref(param('npcs')), npcCorridor = null, npcCorridorOf = null, queueView = null;
  /** Round 6: the lift view (lifts.js). Built once every tile is in; a ride before that builds it early on the heights there are, and it
   *  is built again (between rides) once all tiles are in. */
  function buildLifts() {
    if (lifts && !liftsEarly) return lifts;
    if (lifts && ride) { liftsEarly = true; return lifts; }                 // riding: rebuilt when the ride ends
    if (lifts) lifts.dispose();
    lifts = createLifts({ scene, resort, height: (x, z) => field.height(x, z), env });      // station look: env = the evening glow
    if (npcView) lifts.setRiderSink(npcView.addCarrier);                 // the other skiers ride the carriers
    uploadNow(renderer, lifts.group, camera);                            // R8f: the merged stations / pylons on the GPU, JS copies gone
    if (game.freeLift && modes.liftAt === game.freeLift && !modes.liftDown && game.phase !== 'lift') lifts.dockShuttle(game.freeLift.index);      // R8e: the spawn
    liftsEarly = !streamer.done();
    try { stationGrid = stationCells(lifts); } catch (error) { console.warn('[ski] station grid failed', error); }
    // R8b: the decks exist now: a skier standing in a station (the spawn) stands on its deck, not in it
    if (game.state && game.phase !== 'lift' && game.state.grounded && game.state.speed < 1.5) game.state = { ...game.state, y: standHeight(game.state.x, game.state.z) };
    try { pylonGrid = pylonsOf(lifts); } catch (error) { console.warn('[ski] pylon grid failed', error); }      // round 7 (A): camera guard
    return lifts;
  }
  // the village streets are draped on the 5 m ground: built once the extras and every height tile are in
  const tryRuins = () => {
    if (ruins || !ruinRows || !streamer.done()) return;
    try { ruins = createRuins({ scene, rows: ruinRows, env, height: (x, z) => field.height(x, z) }); mark('ruins'); } catch (error) { console.warn('[ski] ruins failed', error); ruinRows = null; }
  };
  const tryRoads = () => {
    if (roads || !roadRows || !streamer.done()) return;
    try { roads = createRoads({ scene, roads: roadRows, env, level, boxes: streetBoxes, boxIndex, height: (x, z) => surface.height(x, z), ground: (x, z) => field.baseHeight(x, z), upload: (o) => uploadNow(renderer, o, camera) }); mark('roads'); } catch (error) { console.warn('[ski] streets failed', error); roads = { update() {} }; }
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
    if (runProps && game.piste) { runProps.dispose(); runProps = createRunProps({ scene, piste: game.piste, height: (x, z) => surface.height(x, z), gates: game.run ? game.run.gates : [], ...runPropsOpts }); }
    if (courseView) courseView.reseat();                                     // R7-C2: barriers, arrows and the ZIL arch onto the final snow
    if (modes) modes.onTiles(rect);
    if (streamer.done()) document.documentElement.dataset.skiTilesDone = '1';
    if (markers) markers.reseat();
    // R7-C: a skier standing still where a tile just arrived stands on the final ground (never under the snow)
    if (game.state && game.screen === 'ski' && game.phase !== 'lift' && game.state.grounded && game.state.speed < 1.5) {
      const s = game.state;
      if (s.x >= rect[0] && s.x <= rect[2] && s.z >= rect[1] && s.z <= rect[3]) game.state = { ...s, y: standHeight(s.x, s.z) };
    }
    if (avalanches) avalanches.reseat();
    if (streamer.done() && !extrasBuilt) {
      extrasBuilt = true;
      buildLifts();
      signs = createSigns({ scene, resort, height: (x, z) => field.height(x, z) });          // R7-D: atlas slots on demand (update below)
      signs.update(camera.position.x, camera.position.z, true);
      landmarks = createLandmarks({ scene, resort, height: (x, z) => surface.height(x, z), pistes });
      if (modes) modes.ensureParkView();
      mark('lifts');
      tryRoads();
      tryRuins();
    }
  });
  // round 7 (A): the buildings / streets download starts once the skier is on the snow (or after 6 s on a menu): they are not part of
  // the first play's bytes (the boarding spot is the lift station's own zone, R7-B, so nothing has to be re-placed when they arrive)
  let extrasStarted = false, extrasGo = null;
  const extrasGate = new Promise((res) => { extrasGo = res; });
  const startExtras = () => { if (!extrasStarted) { extrasStarted = true; extrasGo(); } };
  setTimeout(startExtras, 6000);
  extrasGate.then(() => loadRuins(core.root)).then((rows) => { ruinRows = rows; tryRuins(); }).catch(() => {});
  extrasGate.then(() => loadExtras(core.root)).then(({ buildings, roads: streets }) => {
    // R7-B: the lift stations replace the OSM station buildings (and nothing stands in a lift lane); the exits keep clear of the rest
    const liftWorld = modes.lifts.setBuildings(buildings);
    roadRows = decodeRoads(streets);
    // R8d: an OSM house a street runs through is left out (Brides: a roof lying across the street)
    let onStreet = new Set();
    try { onStreet = housesOnStreets(buildings, roadRows); } catch (error) { console.warn('[ski] street / house check failed', error); }
    let drawn = buildings.filter((_, i) => liftWorld.keepBuilding(i) && !onStreet.has(i));
    try { drawn = seatRows(drawn, (x, z) => field.baseHeight(x, z)); } catch (error) { console.warn('[ski] seating the big houses failed', error); }   // R8d: big blocks not half buried
    // the houses that are drawn (R7-B leaves out the ones in stations / lift paths): camera guard + skier collision (R8)
    try { streetBoxes = buildingBoxes(drawn); boxIndex = createBoxIndex(streetBoxes); } catch (error) { console.warn('[ski] building index failed', error); }
    if (crowd) { crowd.setBlocked(npcBlocked); crowd.setRoads(roadRows); }        // the other skiers keep out of the houses, walk the streets
    village = createVillage({ scene, rows: drawn, env, height: (x, z) => field.baseHeight(x, z), level, resort: rid, upload: (o) => uploadNow(renderer, o, camera) }); mark('village');      // R8c: Alpine villages; R8f: built per cell near the camera, straight to the GPU
    // R7-C: gates / teleport spots clear of the drawn houses (B's stations replace the dropped OSM station buildings)
    if (explore) { explore.setBuildings(drawn); gateS.clear(); finishS.clear(); if (markers) markers.regate(gateAt); }
    tryRoads();
  }).catch((error) => console.warn('[ski] buildings failed', error.message));

  let spawn = null;                                                          // round 6: the free ride's village lift
  let explore = null, avalanches = null, course = null, courseView = null, courseAbort = null;      // R7-C
  const gateS = new Map();
  /** R7-C: a challenge's start s on open snow (clear.js courseGate: clear of buildings, stations, lift lines and trees). */
  // R7-C2: the gate may also stand beside the line (lat m right of it) where a station or a lift line takes the middle
  const gateAt = (p) => { if (!explore) return { s: 2, lat: 0 }; if (!gateS.has(p.id)) gateS.set(p.id, courseGate(p, explore.obs)); return gateS.get(p.id); };
  const gateOf = (p) => gateAt(p).s;
  // R8b: the ZIL on open snow (clear.js courseFinish: not in a station / house, a clear run-in), cached with the gates
  const finishS = new Map();
  const finishAt = (p, s0) => { if (!explore) return null; const k = `${p.id}@${s0}`; if (!finishS.has(k)) finishS.set(k, courseFinish(p, explore.obs, s0).s); return finishS.get(k); };
  // ---------------- game state ----------------
  const game = {
    screen: 'picker', piste: null, mode: MODES.run, run: null, state: null, phase: 'idle', countdown: 0, paused: false, ghost: null,
    override: null, bot: null, freeRide: false, lastNearest: 0,
  };
  let runProps = null, runPropsOpts = {};
  // R8b (3V QA: skis sank into every boarding platform): the skier stands on a station deck where one is drawn above the snow
  const snowAt = (x, z) => field.height(x, z);                                // lifts.js draws the decks on field.height at the frame
  const deckAt = (x, z) => (nearStation(x, z) ? modes.lifts.world.deckTop(x, z, snowAt) : -Infinity);
  const standHeight = (x, z) => { const g = surface.height(x, z), d = deckAt(x, z); return d > g ? d : g; };
  const standNormal = (x, z, out) => { if (deckAt(x, z) > surface.height(x, z)) { out.x = 0; out.y = 1; out.z = 0; return out; } return surface.normal(x, z, out); };
  const world = {
    height: standHeight,
    normal: standNormal,
    snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25),
    hit: (x, z, r, y) => scatter.hit(x, z, r, y, quality.treeDensity) || modes.lifts.world.hit(x, z, r, y, surfaceAt) || (ruins && ruins.hit(x, z, r, y)) || buildingHit(x, z, r, y),     // R7-B: pylons + stations; R8: houses
  };
  /* R8e (3V QA: at the spawn the station roof filled the top quarter of the screen): standing in a station (the spawn, a fast travel, a
   * lift exit) the chase camera is framed so the lift and the slope show: candidate spots round him (back / side / height) are judged
   * by rays through the top fifth of their view (roofShare: the share that hits a station part or a house within 40 m) and by a clear
   * line to him; the best one is eased in, the chase camera takes over again as soon as he moves. */
  const rayV = { x: 0, y: 0, z: 0 };
  const underRoof = (x, y, z) => { if (!boxIndex) return false; const b = boxIndex.hit(x, z, 0); return !!b && y < b[6]; };
  function roofShare(cx, cy, cz, tx, ty, tz, fov, aspect = (canvas.clientWidth || 4) / (canvas.clientHeight || 3)) {
    let fx = tx - cx, fy = ty - cy, fz = tz - cz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;                       // right (horizontal)
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;                                            // up = right x forward
    const th = Math.tan(fov * Math.PI / 360), tw = th * aspect;
    let hit = 0, n = 0;
    for (const v of [0.62, 0.72, 0.82, 0.92]) {
      for (const u of [-0.85, -0.55, -0.25, 0.05, 0.35, 0.65, 0.9]) {
        n++;
        rayV.x = fx + rx * u * tw + ux * v * th; rayV.y = fy + uy * v * th; rayV.z = fz + rz * u * tw + uz * v * th;
        const l = Math.hypot(rayV.x, rayV.y, rayV.z);
        for (let d = 0.6; d <= 40; d += d < 10 ? 0.5 : 1) {
          const x = cx + rayV.x / l * d, y = cy + rayV.y / l * d, z = cz + rayV.z / l * d;
          if (y < surface.height(x, z)) break;                                                            // the slope: fine
          if ((nearStation(x, z) && modes.lifts.world.hit(x, z, 0.15, y - 0.1, surfaceAt, 0.2)) || underRoof(x, y, z)) { hit++; break; }
        }
      }
    }
    return hit / n;
  }
  let frameAt = null, frameK = 0, frameMiss = null;
  const FRAME_REFRESH = 1;
  function stationFrame(cam, view, dt) {
    const still = view.speed < 0.4 && view.grounded && !view.ride && view.crash === 0 && game.phase === 'running' && !!modes.lifts.world.inStation(view.x, view.z, 0.5);
    // cleanup round (memory): the search (16 spots x 28 rays x ~50 steps) ran EVERY frame while he stood in a station: it compared the
    // CAMERA spot (frameAt.x) with him instead of where it was searched from (sx), and a search that found nothing was not remembered
    // (~270 MB/s of garbage at the spawn, the heap climbed to 300+ MB between collections). Now once per spot (0.5 m), found or not,
    // and again each FRAME_REFRESH s (the houses / stations / tiles still coming in at the spawn can change the best spot).
    const searched = (f) => f && time - f.at < FRAME_REFRESH && Math.hypot(f.sx - view.x, f.sz - view.z) <= 0.5;
    if (!still) frameMiss = null;
    if (still && !searched(frameAt) && !searched(frameMiss)) {
      const fx = Math.cos(view.heading), fz = Math.sin(view.heading), rx = -fz, rz = fx, y0 = view.y;
      const tx = view.x + fx * 14, tz = view.z + fz * 14, ty = Math.max(y0 + 2.4, surface.height(tx, tz) + 1.8);       // him + the line up
      let best = null;
      for (const [back, lat, up] of [[5.2, 0, 2.3], [4.2, 0, 1.5], [5.2, 3, 2.0], [5.2, -3, 2.0], [4.5, 5.5, 1.8], [4.5, -5.5, 1.8], [3.5, 7.5, 2.4], [3.5, -7.5, 2.4], [6.5, 9, 3.2], [6.5, -9, 3.2], [2.5, 10, 1.8], [2.5, -10, 1.8], [0, 9, 2.6], [0, -9, 2.6], [1.5, 12.5, 3.2], [1.5, -12.5, 3.2]]) {
        const cx = view.x - fx * back + rx * lat, cz = view.z - fz * back + rz * lat, cy = Math.max(y0 + up, surface.height(cx, cz) + 0.6);
        if (camBlocked(cx, cy, cz)) continue;
        let seen = true;                                                                                  // a clear line to his chest
        for (let k = 0.1; k < 0.95 && seen; k += 0.1) if (camBlocked(cx + (view.x - cx) * k, cy + (y0 + 1.2 - cy) * k, cz + (view.z - cz) * k)) seen = false;
        if (!seen) continue;
        const share = roofShare(cx, cy, cz, tx, ty, tz, CAMERA.fov);
        // he must stay well inside the picture (not cut at its edge): the angle between the view axis and him, horizontally
        const aAxis = Math.atan2(tz - cz, tx - cx), aHim = Math.atan2(view.z - cz, view.x - cx);
        const off = Math.abs(Math.atan2(Math.sin(aHim - aAxis), Math.cos(aHim - aAxis))), halfH = Math.atan(Math.tan(CAMERA.fov * Math.PI / 360) * (canvas.clientWidth || 4) / (canvas.clientHeight || 3));
        const score = share + Math.hypot(back - 5.2, lat, up - 2.3) * 0.01 + (off > halfH * 0.78 ? 1 : 0);
        if (!best || score < best.score) best = { x: cx, y: cy, z: cz, tx, ty, tz, share, score };
        if (share === 0 && back === 5.2 && lat === 0) break;
      }
      frameAt = best ? { ...best, sx: view.x, sz: view.z, at: time } : null;
      frameMiss = best ? null : { sx: view.x, sz: view.z, at: time };
      if (frameAt) { frameAt.x0 = view.x; frameAt.z0 = view.z; }
      document.documentElement.dataset.skiStationFrame = best ? best.share.toFixed(2) : '';
    }
    if (still && frameAt && Math.hypot(frameAt.sx - view.x, frameAt.sz - view.z) > 0.5) frameAt = null;
    frameK += ((still && frameAt ? 1 : 0) - frameK) * Math.min(1, dt * (still ? 2.5 : 4));
    if (!still && frameK < 0.01) frameAt = null;
    if (!frameAt || frameK < 0.001) return cam;
    const k = frameK, m = (a, b) => a + (b - a) * k;
    return { ...cam, x: m(cam.x, frameAt.x), y: m(cam.y, frameAt.y), z: m(cam.z, frameAt.z), tx: m(cam.tx, frameAt.tx), ty: m(cam.ty, frameAt.ty), tz: m(cam.tz, frameAt.tz) };
  }
  /** R8e: a station part / pylon / house at (x, z) (the scripted bot skis round it; window.__ski.blocked for the flows). */
  const botBlocked = (x, z) => { const y = standHeight(x, z); return !!(modes.lifts.world.hit(x, z, 2.5, y, surfaceAt) || (ruins && ruins.hit(x, z, 2.5, y)) || buildingHit(x, z, 2.5, y)); };      // 2.5 m: he carves wide
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
    onMap: () => onAction('map'),                                            // launch: a tap on the minimap opens the map (like M)
    snowMaterial: () => snowMat,                                             // R7-D: the park's snow meshes share the terrain's material
  });
  // ---- round 6: ski types (physics per type; timed / scored runs use the reference set: modes/skis.js FAIRNESS) ----
  let skiType = DEFAULT_SKI;
  const fairNow = () => isRace() || game.mode === MODES.run || game.mode === MODES.park;
  const isBoard = () => !!(SKI_BY_ID.get(skiType) || {}).board;
  function applySkiPhysics() { world.ski = skiParams(skiType, fairNow()); document.documentElement.dataset.skiPhysics = fairNow() ? 'fair' : skiType; }
  function setSki(id, save = true) {
    const t = SKI_BY_ID.get(id);
    if (!t || !skiOpen(id, modes.skiStats())) return false;
    skiType = id;
    skier.setSki(t.look);
    skier.setBoard(!!t.board); ghostModel.setBoard(!!t.board);              // 28 Nov 2026: the snowboard
    if (typeof fp !== 'undefined' && fp) fp.setLook(t.look);                 // R7-C: the first-person skis
    applySkiPhysics();
    document.documentElement.dataset.skiType = id;
    if (save && store.get().ski !== id) { store.set({ ...store.get(), ski: id }); modes.cloud.push(store.get()); }
    return true;
  }
  // ---- R7-C: discovery + teleport + first lift, first person, avalanches, the course HUD ----
  explore = createExplore({ rid, resort, store, cloud: modes.cloud, field, scatter, density: quality.treeDensity, lifts: modes.lifts, pistes, height: (x, z) => surface.height(x, z) });
  let camMode = readCamMode();
  const fp = createFirstPerson({ scene, overlay: document.getElementById('ui'), look: SKI_BY_ID.get(DEFAULT_SKI).look });
  document.documentElement.dataset.skiCam = camMode;
  const courseHud = createCourseHud(hud.el);
  {
    const hb = hud.el.querySelector('.hbtns');
    if (hb) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'hbtn', id: 'hCam', title: 'Kamera (C)', textContent: '👁' });
      b.dataset.b = 'camera'; b.setAttribute('aria-label', 'Kamera: éischt Persoun oder hannendrun (C)');
      b.addEventListener('click', (e) => { e.currentTarget.blur(); onAction('camera'); });
      hb.appendChild(b);
    }
  }
  // ---- replay + photo mode (28 Nov 2026) ----
  const recorder = createRecorder();
  const replay = createReplay({ root: document.getElementById('ui'), surface, onClose: () => endOverlayPause() });
  const photo = createPhoto({ root: document.getElementById('ui'), canvas, height: (x, z) => surface.height(x, z), blocked: (x, y, z) => camBlocked(x, y, z), renderNow: () => post.render(scene, camera), onClose: () => { game.camPose = photoPrevPose; photoPrevPose = null; endOverlayPause(); }, onToast: (t) => hud.toast(t, 1800) });
  let overlayPaused = false, overlayInput = false, photoPrevPose = null;
  function beginOverlayPause() { overlayPaused = game.paused; overlayInput = game.phase === 'running' || game.phase === 'countdown'; game.paused = true; input.setEnabled(false); }
  function endOverlayPause() { game.paused = overlayPaused; input.setEnabled(overlayInput && game.phase === 'running'); canvas.focus({ preventScroll: true }); }
  const overlayOk = () => game.screen === 'ski' && (game.phase === 'running' || game.phase === 'finished') && !ride && !skiCard && !replay.active && !photo.active;
  /** Replay of the last `seconds` (free ride: FREE_CLIP_S; after a timed run the whole buffer). */
  function openReplay(seconds = FREE_CLIP_S) {
    if (!overlayOk() || isRace()) return false;
    const clip = recorder.snapshot(seconds, game.state);
    if (!clip) { hud.toast('Nach näischt opgeholl', 1400); return false; }
    beginOverlayPause();
    replay.open(clip, { camera: 'follow' });
    return true;
  }
  function openPhoto() {
    if (photo.active) { photo.close(); return; }
    if (replay.active || skiCard || menuCard || !(game.screen === 'ski' && ['running', 'finished', 'lift', 'approach'].includes(game.phase))) return;
    const st = game.state;
    if (!st) return;
    beginOverlayPause();
    photoPrevPose = game.camPose;
    const c0 = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    photo.open({ x: st.x, y: Math.max(st.y, surface.height(st.x, st.z)), z: st.z }, c0);
  }
  {
    const hb = hud.el.querySelector('.hbtns');
    if (hb) {
      const col = document.createElement('div');
      col.className = 'hbtns hbtns2';
      const mk = (id, text, title, label, fn) => { const b = Object.assign(document.createElement('button'), { type: 'button', className: 'hbtn', id, title, textContent: text }); b.setAttribute('aria-label', label); b.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); }); col.appendChild(b); };
      mk('hReplay', '⏪', 'Lescht 30 s nach eemol kucken', 'Lescht 30 s nach eemol kucken', () => openReplay());
      mk('hPhoto', '📷', 'Foto (P)', 'Foto (P)', () => openPhoto());
      hb.after(col);
    }
  }
  if (!setSki(store.get().ski || DEFAULT_SKI, false)) setSki(DEFAULT_SKI, false);
  let skiCard = null;
  function openSkiCard() {
    if (skiCard) return;
    game.paused = true; input.setEnabled(false);
    skiCard = showSkiCard(document.getElementById('ui'), { stats: modes.skiStats(), selected: skiType, onPick: (id) => { if (setSki(id)) hud.toast(SKI_BY_ID.get(id).board ? SKI_BY_ID.get(id).name : `Ski: ${SKI_BY_ID.get(id).name}`); }, onClose: () => { skiCard = null; game.paused = false; input.setEnabled(game.phase === 'running'); } });
  }
  // ---- round 6: the challenge start gates on the mountain ----
  markers = createMarkers({ scene, list: markerList(pistes, parkLayout, gateAt), height: (x, z) => surface.height(x, z), overlay: document.getElementById('ui'), starsOf: (m) => (m.piste ? pisteStars(store.get(), rid, m.piste.id) : 0) });
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
  let approach = null;                                                       // easier boarding: being walked in (startApproach)
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
    const y = standHeight(x, z);
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
    } else if (m === 'goals') {                    // 28 Nov: goals + badges of this area, the daily challenge
      modePanel.showGoals({ progress: store.get(), rid, areaName: areaTitle, extra: { discCount: explore.disc.count } });
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
    if (mapScreen) mapScreen.el.querySelectorAll('.lrow').forEach((b) => b.classList.toggle('fogged', !explore.liftOpen(modes.lifts.byId.get(b.dataset.lift))));      // R7-C
    updateStartStatus();
  }

  // ---------------- screens ----------------
  let picker = null, mapScreen = null, pisteMap = null, finishCard = null, menuCard = null;
  function showPicker() {
    game.screen = 'picker';
    hud.show(false); input.showTouch(false);
    picker = ui.showResorts({ current: rid, music: { on: () => audio.isMusicOn(), set: (v) => audio.setMusic(v) }, onOnline: window.MPGate && window.MPGate.openLobby ? () => window.MPGate.openLobby('') : null, onPick: (id) => { if (id && id !== rid) { switchResort(id); return; } picker.close(); picker = null; goFree(spawn); } });
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
    if (approach) return;                                                     // (being walked in: a moment)
    if (ride) { hud.toast(ride.down ? 'Am Lift: d\'Kaart gëtt et ënnen' : 'Am Lift: d\'Kaart gëtt et uewen'); return; }
    // round 6: over a free ride the map is a pause overlay ("Weiderfueren" goes on where the skier stood)
    const resumable = game.screen === 'ski' && game.mode === MODES.freeride && game.phase === 'running' && !!modes.freeRun;
    game.resume = resumable ? { state: { ...game.state }, piste: game.piste } : null;
    game.screen = 'map';
    game.phase = resumable ? 'paused-map' : 'idle';
    hud.show(false); input.showTouch(false); input.setEnabled(false);
    if (finishCard) { finishCard.close(); finishCard = null; }
    chPrompt.show(null);
    if (!resumable) { modes.end(); endCourse(); }
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
    pisteMap = createPisteMap({ canvas: mapScreen.canvas, resort, imageUrl: core.root + resort.map.file, root: core.root, height: field.farHeight, classes: core.classes, pistes, onPick: (p) => selectPiste(p, false), onPickLift: (l) => { game.mapPicked = true; pickLift(l); } });
    mapScreen.zoomButtons.forEach((b) => b.addEventListener('click', () => pisteMap.zoomBy(b.dataset.z === 'in' ? 1.5 : 1 / 1.5)));
    modePanel = attachModePanel(mapScreen.el, { onMode: (m) => setMapMode(m), onParkStart: () => startPark(), onFreeStart: () => goFree(game.freeLift), onFreeDown: () => { if (game.freeLift) goFree(null, { kind: 'liftdown', lift: game.freeLift.id }); }, onPickLift: (l) => { game.mapPicked = true; pickLift(l); } });
    pisteMap.setPark(resort.park ? { line: resort.park.line, name: resort.park.name } : null);
    pisteMap.setMarks(modes.marks());
    explore.attachMap({ mapEl: mapScreen.el, pisteMap, onTeleport: (spot) => goFree(null, spot), onFirstLift: () => goFree(spawn) });      // R7-C
    if (game.resume) { const st = game.resume.state; pisteMap.setPlayer(st.x, st.z, Math.hypot(st.vx, st.vz) > 1 ? Math.atan2(st.vz, st.vx) : st.heading); }      // map clarity: + view direction
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
      const open = explore.liftOpen(l);                                      // R7-C: fast travel only to discovered lifts
      const ok = open && (readyLift === l.id || (streamer.pendingNear(l.top.x, l.top.z, 1200) === 0 && terrain.stats.pending === 0));
      readyLift = ok ? l.id : null;
      modePanel.freeReady(ok);
      if (!open) { const st = mapScreen.el.querySelector('#freeStatus'); if (st) st.textContent = 'Nach net entdeckt: fuer do hin oder huel e Lift dohin.'; }
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
    endCourse();
    dropRide();                                                              // R8b
    const gate = mode === MODES.run ? gateAt(p) : { s: 2, lat: 0 };          // R7-C: the start gate on open snow
    const s0 = gate.s;
    // R7-C2: beside a station / under a lift line; R8f (ski-mp: the middle racer, lateral 0, stood at the gate's 4.2 m side offset while
    // the others stood +-1.9 m off the line, 6.1 m apart): in an online race every lane is the gate's offset + its own
    const lat = isRace() ? (gate.lat || 0) + lateral : lateral || gate.lat || 0;
    const f0 = mode === MODES.run ? finishAt(p, s0) : null;                 // R8b: the ZIL on open snow
    game.run = createRun({ piste: p, mode, startS: s0, finishS: f0 });
    recorder.reset();                                                        // replay: a timed run's clip starts with this run
    const a = p.at(s0, {});
    if (mode === MODES.run) {
      let lay = null;
      try { lay = courseLayout(p, s0, pistes, explore ? explore.obs : null, f0); courseView = createCourseView({ scene, layout: lay, height: (x, z) => surface.height(x, z) }); } catch (error) { console.warn('[ski] course view failed', error); }
      course = createCourse({ piste: p, startS: s0, finishS: f0, open: lay ? lay.openAt : null });      // R8e: no net = no collision
      courseHud.show(true);
      document.documentElement.dataset.skiCourse = 'on';
    }
    placeAt(a.x - a.dz * lat, a.z + a.dx * lat, Math.atan2(a.dz, a.dx));
    if (runProps) runProps.dispose();
    const startAt = { x: a.x - a.dz * lat, z: a.z + a.dx * lat, dx: a.dx, dz: a.dz };
    runPropsOpts = { start: startAt, finish: mode !== MODES.run };            // R7-C2: START at the gate, one ZIL arch (the course's)
    runProps = createRunProps({ scene, piste: p, height: (x, z) => surface.height(x, z), gates: game.run.gates, ...runPropsOpts });
    const g = mode === MODES.run ? decodeGhost(store.get().ghosts[pisteKey(rid, p.id)]) : null;
    game.ghost = g;
    ghostModel.setVisible(false);
    game.bot = params.bot && mode !== MODES.park ? createBot(p, { blocked: botBlocked }) : null;
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
    endCourse();                                                             // R7-C
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
      onReplay: result && !isRace() ? () => openReplay(RECORD.seconds) : null,
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

  /** R8e (3V QA "Aua, e Bam!": after a tree crash the camera sat in the tree, the skier against the trunk): a respawn spot clear of
   *  trunks (2.2 m), houses and lift parts, no trunk in the 12 m ahead, with the chase camera's spot (5 m behind, 2.6 m up) outside every crown. Else the nearest
   *  piste point within 80 m (no tree stands on a piste), else rings out to 40 m; the heading then follows the piste / the fall line. */
  function clearSpot(r) {
    const d = quality.treeDensity;
    const ok = (x, z, h) => {
      if (scatter.hit(x, z, 2.2, -1e9, d) || buildingHit(x, z, 1.5) || modes.lifts.world.hit(x, z, 1.5)) return false;
      for (let k = 2; k <= 12; k += 2) if (scatter.hit(x + Math.cos(h) * k, z + Math.sin(h) * k, 1.2, -1e9, d)) return false;      // not facing the same tree again
      const cx = x - Math.cos(h) * 5, cz = z - Math.sin(h) * 5;
      return !scatter.inCrown(cx, surface.height(cx, cz) + 2.6, cz, d, 0.6) && !scatter.inCrown(x, surface.height(x, z) + 1.6, z, d, 0.3);
    };
    if (ok(r.x, r.z, r.heading)) return r;
    const n = pistes.nearest(r.x, r.z, 80);
    if (n) {
      for (const ds of [0, -8, 8, -16, 16, -30]) {
        const a = n.piste.at(Math.max(2, Math.min(n.piste.length - 2, n.proj.s + ds)), {});
        const h = Math.atan2(a.dz, a.dx);
        if (ok(a.x, a.z, h)) return { x: a.x, z: a.z, heading: h, s: r.s };
      }
    }
    const nn = surface.normal(r.x, r.z, {});
    const fall = Math.hypot(nn.x, nn.z) > 0.05 ? Math.atan2(nn.z, nn.x) : r.heading;
    for (let dist = 3; dist <= 40; dist += 3) {
      for (let k = 0; k < 12; k++) {
        const a = r.heading + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 6;     // behind him first, then round
        const x = r.x + Math.cos(a) * dist, z = r.z + Math.sin(a) * dist;
        if (ok(x, z, fall)) return { x, z, heading: fall, s: r.s };
      }
    }
    return r;
  }
  const slopeDeg = (x, z) => { const n = surface.normal(x, z, {}); return Math.acos(Math.min(1, n.y)) * 180 / Math.PI; };
  function respawn(text) {
    if (!game.run) return;
    // cleanup round (cliff routes): after a landing crash where he landed (below the drop), not back on top of it
    const st = game.state, landed = !!(st && st.crashKind === 'landing' && !text && game.mode !== MODES.park);
    const r = clearSpot(game.run.respawnPoint({ landed, at: st, slopeAt: slopeDeg }));
    placeAt(r.x, r.z, r.heading);
    if (landed) game.state = rollOn(game.state);                            // he gets up and skis on (SKI.respawnRoll)
    if (course) course.rebase();                                             // R7-C2: the HUD distance from where he stands again
    if (text) hud.toast(text);
  }

  // ---- round 4A: snow park run, free ride all day, the lift ----
  function startPark() {
    if (!parkLayout) { hud.toast('Kee Snowpark hei'); return; }
    endCourse();
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
    // R8b: a map teleport to a lift (clear.js safeSpot kind 'lift') waits in B's boarding zone like any fast travel (B's rule wins)
    if (spotIn && spotIn.kind === 'lift' && modes.lifts.byId.get(spotIn.lift)) { lift = modes.lifts.byId.get(spotIn.lift); spotIn = null; }
    // ride down ("Erof" in the lift list / the map card): onto the lift's top descent mat, facing down the line
    let down = false;
    if (spotIn && spotIn.kind === 'liftdown') {
      const l = modes.lifts.byId.get(spotIn.lift), d = l && modes.lifts.downAt(l);
      if (!d) return;
      lift = l; spotIn = { ...d, kind: 'liftdown' }; down = true;
    }
    const spot = spotIn || (lift ? boardSpot(lift) : null);
    if (!spot) return;
    const fade = fader();
    fade.classList.add('on');
    streamer.focus(spot.x, spot.z);
    await Promise.race([streamer.ready(spot.x, spot.z, 600), new Promise((res) => setTimeout(res, 6000))]);
    await meshedAround(spot);                                                // round 7 (A): no coarse-tile skirts after the fade
    await new Promise((res) => setTimeout(res, 120));
    startFree(lift, spot, down);
    fade.classList.remove('on');
    document.documentElement.dataset.skiSpawnOk = spot.ok === false ? '0' : '1';
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
  function startFree(lift, spotIn = null, down = false) {
    if (!lift && !spotIn) return;
    endCourse();                                                             // R7-C
    dropRide();                                                              // R8b
    streamer.release();                                      // skiing: the rest of the resort streams in, nearest the skier first
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; modePanel = null; }
    if (finishCard) { finishCard.close(); finishCard = null; }
    game.screen = 'ski';
    document.documentElement.dataset.skiScreen = 'ski';
    game.mode = MODES.freeride;
    game.resume = null;
    if (lift) game.freeLift = lift;
    if (lift && lifts && !down) lifts.dockShuttle(lift.index);                // R8e: a cable car's cabin waits at the bottom (behind the fade)
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
    if (!lift) hud.toast('Fräi fueren');                                // (at a lift the Astegen / Erof button is the one prompt)
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('free');
    setTimeout(startExtras, 400);                                       // round 7 (A): the houses and streets after the first frames
    if (!pictureChecks) setTimeout(pictureCheck, 3500);                 // round 7 (A): the picture check
  }
  /** Round 6 / R7-B: board the lift at hand (the skier stands in its boarding zone): one press = one boarding. The ride walks / skates
   *  him to the loading line, the next carrier of the lift's own loop picks him up there, up the real line, off at the top station, out
   *  to the exit spot (lift-site.js), and he stands still there until the player moves (game.hold). */
  /** Easier boarding (Ian, 26 Nov: "not just that little yellow square"): a press anywhere in the catchment (freeride.js BOARDING)
   *  first walks / slides him to the boarding spot along a clear way (a few seconds; a second press skips it), then boards. */
  function startApproach(lift, down) {
    const st = game.state;
    // (round the trees if it can; a way only past a trunk beats no way: the station parts and houses are never crossed)
    const way = modes.lifts.guideWay(lift, down, { x: st.x, z: st.z }, standHeight, (x, z) => !!scatter.hit(x, z, 0.35, -1e9, quality.treeDensity), surfaceAt) || modes.lifts.guideWay(lift, down, { x: st.x, z: st.z }, standHeight, null, surfaceAt);
    if (!way) { hud.toast(`${lift.name}: op déi giel Plaz fueren`, 2200); return false; }
    const cum = [0];
    for (let n = 1; n < way.length; n++) cum.push(cum[n - 1] + Math.hypot(way[n].x - way[n - 1].x, way[n].z - way[n - 1].z));
    const L = cum[cum.length - 1];
    // lift lines: at a lift with a queue maze he is led through its free lane and waits at its head (2.2 m short of the zone) while the
    // group ahead of him is still in the zone; then in. Never longer than BOARDING.MAX_S + LINE_WAIT s in all.
    const line = !down && !!(crowd && crowd.lineOf(lift.index) && npcLive);
    const Lw = line ? Math.max(0, L - 2.2) : L;
    const d1 = Math.min(BOARDING.MAX_S, Math.max(0.5, Lw / BOARDING.WALK));
    approach = { lift, down, way, cum, L, Lw, line, t: 0, d1, waited: 0, t3: null, d3: line ? Math.max(0.7, (L - Lw) / (BOARDING.WALK * 0.75)) : 0, h0: st.heading, h1: Number.isFinite(way[way.length - 1].heading) ? way[way.length - 1].heading : st.heading };
    game.phase = 'approach'; game.hold = false;
    input.setEnabled(false);
    document.documentElement.dataset.skiApproach = '1';
    stepApproach(0);
    return true;
  }
  const LINE_WAIT = 6;                         // s at most he waits at the head of the free lane
  function stepApproach(dt, skip = false) {
    const a = approach;
    a.t += dt;
    if (skip && a.line && crowd) crowd.clearZone(a.lift.index);          // (a second press: in at once; the group still there goes)
    // m = metres along the way: to the wait point, (the wait), the last steps into the zone
    let m, k;
    if (skip) { m = a.L; k = 1; }
    else if (a.t < a.d1) { k = a.t / a.d1; m = (a.L > a.Lw ? k * k * (3 - 2 * k) * 0.82 + k * 0.18 : k * k * (3 - 2 * k)) * a.Lw; }
    else if (a.t3 === null) {
      const info = a.line && crowd ? crowd.lineInfo(a.lift.index) : null;
      a.waited += dt;
      if (!info || info.clearIn <= 0.05 || a.waited >= LINE_WAIT) { if (a.waited >= LINE_WAIT && crowd) crowd.clearZone(a.lift.index); a.t3 = a.t; }
      m = a.Lw; k = 0.85;
    }
    if (m === undefined) { const f = Math.min(1, (a.t - a.t3) / Math.max(0.01, a.d3)); m = a.Lw + (a.L - a.Lw) * f * f * (3 - 2 * f); k = a.L > a.Lw ? 0.85 + 0.15 * f : 1; }
    let n = 1;
    while (n < a.way.length - 1 && a.cum[n] < m) n++;
    const A = a.way[n - 1], B = a.way[n], f = (m - a.cum[n - 1]) / ((a.cum[n] - a.cum[n - 1]) || 1);
    const x = A.x + (B.x - A.x) * f, z = A.z + (B.z - A.z) * f;
    const hSeg = Math.atan2(B.z - A.z, B.x - A.x), d = (h0, h1, w) => h0 + Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) * Math.max(0, Math.min(1, w));
    const heading = k > 0.85 && m > a.L - 0.8 ? d(hSeg, a.h1, (m - (a.L - 0.8)) / 0.8) : d(a.h0, hSeg, a.t / 0.35);
    const done = skip || (a.t3 !== null ? a.t - a.t3 >= a.d3 : a.t >= a.d1 && a.L <= a.Lw);
    const moving = !done && (a.t < a.d1 || a.t3 !== null);
    const v = moving ? 1.6 : 0;
    game.state = { ...createSkierState(x, z, heading, standHeight(x, z)), vx: Math.cos(heading) * v, vz: Math.sin(heading) * v, speed: v, walk: m };
    if (done) {
      approach = null;
      document.documentElement.dataset.skiApproach = '';
      placeAt(x, z, a.h1);
      game.phase = 'running';
      input.setEnabled(true);
      if (modes.freeRun) modes.freeRun.moved({ x, z, heading: a.h1 });
      boardLift({ lift: a.lift, down: a.down });
    }
  }
  function boardLift(guided = null) {
    if (approach) { stepApproach(0, true); return; }                  // a second press: straight to the spot
    if (game.mode !== MODES.freeride || game.phase !== 'running' || ride || game.paused) return;
    const lift = guided ? guided.lift : modes.liftAt, down = guided ? guided.down : !!modes.liftDown;
    if (!lift) return;
    const view = buildLifts();
    const path = view.pathOf(lift.index), site = view.siteOf(lift.index);
    if (!path || !site) { hud.toast('Dëse Lift fiert net'); return; }
    const st = game.state;
    const inZone = down ? !!(site.down && site.down.inZone(st.x, st.z)) : site.inZone(st.x, st.z);
    if (!inZone) {                                                            // easier boarding: guided in from the catchment
      if (guided) return;
      if (st.speed > BOARDING.FAST) { hud.toast('Ze séier: brems fir anzesteigen', 1600); return; }
      startApproach(lift, down);
      return;
    }
    const height = standHeight;                                               // R8b: the walk to the loading line is on the deck
    const tree = (x, z) => !!scatter.hit(x, z, 0.4, -1e9, quality.treeDensity);
    if (down) {
      // ride down: the next carrier coming round the top wheel onto the down lane picks him up (a cabin / train waits docked)
      const loadU = path.shuttle ? null : path.downU(site.down.sTop);
      const next = loadU === null ? null : view.nextCarrier(lift.index, loadU, path.spec.speed * 1.6);
      ride = createDescent({ lift, path, site, height, from: { x: st.x, z: st.z, heading: st.heading }, startU: next ? next.u : null,
        exitAt: () => modes.lifts.world.exitOf(lift.index, height, tree, null, null, 'bottom') });
    } else {
      // the next carrier of the lift's own loop that reaches the loading line at least 1.6 s from now picks him up
      const loadU = path.shuttle ? null : path.upU(Math.min(RIDE.enter[site.key], path.len * 0.2));
      const after = crowd && npcLive ? crowd.lineInfo(lift.index).after : 0;          // lift lines: after the group ahead of him
      const next = loadU === null ? null : view.nextCarrier(lift.index, loadU, path.spec.speed * Math.max(1.6, after));
      ride = createRide({ lift, path, site, height, from: { x: st.x, z: st.z, heading: st.heading }, startU: next ? next.u : null, shuttle: path.shuttle ? view.shuttleBoard(lift.index) : null,
        exitAt: () => modes.lifts.world.exitOf(lift.index, height, tree, pistes.list) });
    }
    carrier = createCarrier({ scene, kind: path.kind, seats: path.seats, sub: path.sub, doorSide: path.sign, src: path.src });      // (the door on the boarding side)
    if (path.shuttle && !down) { const sw = view.shuttleBoard(lift.index); if (sw && sw.wait > 2) hud.toast(`D'Kabin kënnt (${Math.ceil(sw.wait)} s)`, 2200); }
    if (camMode === 'fp') { rideView = 'window'; rideCam = null; }          // R7-C: first person = the window view on a lift
    explore.rode(lift);
    modes.liftRidden(lift);                      // 28 Nov: goals + daily challenge
    modes.rideStart(lift);
    chPrompt.show(null);
    game.phase = 'lift'; game.hold = false;
    rideCam = null; skipping = false;
    input.setEnabled(false); input.showTouch(false);
    rideHud.show(lift);
    stepRide(0);
    audio.event('count');
    if (path.kind === 'gondola' || path.kind === 'cable') audio.event('door');            // the cabin door glides open / shut
    document.documentElement.dataset.skiRide = path.kind;
    document.documentElement.dataset.skiRideDir = down ? 'down' : 'up';
    document.documentElement.dataset.skiRideView = rideView;
    mark('ride');
  }
  function stepRide(dt) {
    ride.step(dt);
    game.state = ride.state(game.state);
    const w = ride.where();
    const u = ride.carrierU;
    if (lifts) { lifts.setRide(ride.lift.index, u, ride.down); lifts.setGate(ride.lift.index, ride.gate); }      // after launch: the chair gate swings
    if (carrier && u === null) { carrier.dispose(); carrier = null; }        // off: the lift's own loop takes the carrier on
    if (carrier) carrier.place(w);
    document.documentElement.dataset.skiRidePhase = ride.phase;
    streamer.focus(w.x + Math.cos(w.heading) * 120, w.z + Math.sin(w.heading) * 120);
    if (ride.done && !skipping) arrive();
  }
  function rideCamera1(dt) {
    const w = ride.where();
    const want = rideCamera(ride.path, w, rideView, (x, z) => surface.height(x, z));
    // lift lines round (a T-bar's boarding camera stood in its hut: a black screen): off the carrier, a camera in a station part or a house
    // goes to the other side of him, else halfway in
    if (!w.onCarrier && rideView !== 'window' && camBlocked(want.x, want.y, want.z)) {
      const hx = Math.cos(w.heading), hz = Math.sin(w.heading), dx = want.x - w.x, dz = want.z - w.z, lat = -hz * dx + hx * dz;
      const mx = want.x + hz * 2 * lat, mz = want.z - hx * 2 * lat;
      if (!camBlocked(mx, want.y, mz)) { want.x = mx; want.z = mz; } else { want.x = (want.x + w.x) / 2; want.z = (want.z + w.z) / 2; }
    }
    // chase: the camera rides with the carrier (no lag at x4); only its offset round the rider eases (a bend of the line turns it softly)
    const off = { x: want.x - w.x, y: want.y - w.y, z: want.z - w.z, tx: want.tx - w.x, ty: want.ty - w.y, tz: want.tz - w.z, fov: want.fov };
    // (after launch: a chair's boarding camera eases into the ride camera as he sits down, no cut)
    // (lift lines round: a cabin's door view eases into the ride camera too, no cut)
    if (rideView === 'window' || !rideCam || (rideCam.onCarrier !== w.onCarrier && ride.kind !== 'chair' && !w.doorCam && !rideCam.door)) rideCam = { off, onCarrier: w.onCarrier, door: !!w.doorCam };
    else rideCam.door = !!w.doorCam;
    if (w.doorCam && rideView !== 'window') rideCam.off = off;                // (the door view stands still on the platform)
    else if (rideCam.off !== off) { const k = 1 - Math.exp(-dt * 3); for (const key of Object.keys(off)) rideCam.off[key] += (off[key] - rideCam.off[key]) * k; }
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
    const top = ride.down ? ride.lift.bottom : ride.lift.top;                // (ride down: to the bottom station)
    streamer.focus(top.x, top.z);
    await Promise.race([streamer.ready(top.x, top.z, 500), new Promise((res) => setTimeout(res, 3000))]);
    await meshedAround(top);
    if (ride) { ride.skip(); stepRide(0); }
    skipping = false;
    fade.classList.remove('on');
    if (ride && ride.done) arrive();
  }
  /** R8b (3V QA: a stale "Funiculaire …" ride line stayed on the HUD): a ride cut short by a fast travel / teleport / challenge / park
   *  start ends cleanly (no carrier, no ride HUD, the lift's own loop takes its carrier back). */
  function dropRide() {
    if (approach) { approach = null; document.documentElement.dataset.skiApproach = ''; if (game.phase === 'approach') game.phase = 'running'; input.setEnabled(true); }
    if (!ride) return;
    const r = ride;
    ride = null; skipping = false;
    if (lifts) { lifts.setRide(r.lift.index, null); lifts.setGate(r.lift.index, 0); }
    if (carrier) { carrier.dispose(); carrier = null; }
    rideHud.show(null);
    if (game.phase === 'lift') game.phase = 'running';
    input.setEnabled(true);
  }
  /** Off at the top: the ride has brought him out of the station to the exit spot; he stands still there until the player moves. */
  function arrive() {
    if (!ride) return;
    const r = ride;
    ride = null; skipping = false;
    if (lifts) { lifts.setRide(r.lift.index, null); lifts.setGate(r.lift.index, 0); }
    if (carrier) { carrier.dispose(); carrier = null; }
    rideHud.show(null);
    if (r.path && (r.path.kind === 'gondola' || r.path.kind === 'cable')) audio.event('door', { shut: true });
    const ex = r.exit || (r.down ? modes.lifts.bottomExit(r.lift, (x, z) => surface.height(x, z)) || modes.lifts.boardAt(r.lift) : modes.lifts.startAt(r.lift, (x, z) => surface.height(x, z)));
    const spot = { x: ex.x, z: ex.z, heading: ex.heading };
    if (modes.freeRun) modes.freeRun.moved(spot);
    placeAt(spot.x, spot.z, spot.heading);
    game.hold = true;                                                          // R7-B: 0 km/h until the player steers or pushes
    game.phase = 'running';
    input.setEnabled(true); input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    hud.toast(r.down ? `${r.lift.name}: ënnen op ${Math.round(r.lift.bottom.y)} m` : `${r.lift.name}: uewen op ${Math.round(r.lift.top.y)} m`);
    document.documentElement.dataset.skiRide = '';
    document.documentElement.dataset.skiRideDir = '';
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
      env, gfx: GFX(), outfits: OUTFITS, outfit: () => outfit, onOutfit: setOutfit, outfitOpen, sound: { muted: () => audio.isMuted(), set: (m) => audio.setMuted(m), music: () => audio.isMusicOn(), setMusic: (m) => audio.setMusic(m) },
      npcs: { on: () => npcOn, set: (on) => setNpcs(on) },
      againLabel: game.mode === MODES.freeride ? '' : game.mode === MODES.park ? 'Park nach eng Kéier' : 'Nach eng Kéier',
      onResume: () => { menuCard = null; game.paused = false; input.setEnabled(game.phase === 'running' || game.phase === 'countdown'); },
      onAgain: () => { menuCard = null; game.paused = false; again(); },
      onMap: () => { menuCard = null; game.paused = false; showMap(); },
      onReplay: () => { menuCard = null; game.paused = false; openReplay(); },
    });
  }

  function onAction(action) {
    if (photo.active) { if (action === 'menu' || action === 'photo') photo.close(); return; }
    if (replay.active) { if (action === 'menu') replay.close(); return; }
    if (action === 'photo') { openPhoto(); return; }
    if (mp && mp.onAction(action)) return;
    if (action === 'weather') { const m = env.cycleWeather(); hud.toast(`Wieder: ${WEATHER_LABEL[m]}${m === 'random' ? ` (${WEATHER_LABEL[env.state.weatherId]})` : ''}`); }
    else if (action === 'time') { const m = env.cycleTime(); if (modes.clock && m !== 'random') modes.clock.set(startHourFor(m)); hud.toast(`Zäit: ${TIME_LABEL[m]}${m === 'random' ? ` (${TIME_LABEL[env.state.timeId]})` : ''}`); }
    else if (action === 'reset') { if (game.screen === 'ski' && game.phase === 'running') respawn('Zréck op d\'Pist'); }
    else if (action === 'menu') { if (skiCard) skiCard.close(); else if (menuCard) { menuCard.close(); menuCard = null; game.paused = false; input.setEnabled(game.phase === 'running' || game.phase === 'countdown'); } else if (game.screen === 'map' && game.resume) resumeFree(); else openMenu(); }
    else if (action === 'map') { if (game.screen === 'ski') showMap(); else if (game.screen === 'map' && game.resume) resumeFree(); }
    else if (action === 'view') { if (ride) toggleRideView(); }
    else if (action === 'camera') { setCamMode(camMode === 'fp' ? 'chase' : 'fp'); }
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
    if (roads && roads.setLevel) roads.setLevel(level);                 // R8d: the fine streets radius per level (was always medium)
    skier.setBlob(level === 'low');
    if (npcView) npcView.setLevel(level);
    if (crowd) crowd.setBlocked(npcBlocked);                             // (the trees of this level)
    poles.reset();
    spray.dispose(); spray = createSnowSpray({ scene, env, level, height: (x, z) => surface.height(x, z) });     // R7-C: the spray budget
    mark(`quality ${level}`);
  }
  GFX().onChange((l) => { if (!params.q) applyQuality(l); });

  // ---------------- R7-C: camera mode, push start, the course, avalanches, Lawin ----------------
  let camYaw = 0, lastCourse = null;
  function setCamMode(m) {
    camMode = m === 'fp' ? 'fp' : 'chase';
    writeCamMode(camMode);
    fp.snap(); if (game.state) chase.snap(game.state);
    if (ride) { rideView = camMode === 'fp' ? 'window' : 'chase'; rideCam = null; document.documentElement.dataset.skiRideView = rideView; }
    document.documentElement.dataset.skiCam = camMode;
    hud.toast(camMode === 'fp' ? 'Kamera: éischt Persoun' : 'Kamera: hannendrun', 1100);
  }
  /** At "0": a start-gate kick down the course (COURSE.push m/s), no start from standstill. */
  function pushStart() {
    if (!game.run || !game.piste || game.mode !== MODES.run) return;          // challenges only (the park has its own drop-in)
    const a = game.piste.at(game.run.startS || 2, {});
    const s = game.state;
    game.state = launchState(s, a);      // R8b: out of the standing hold (R7-A), else the kick is zeroed until an input; launch follow-up: to 45 km/h
    document.documentElement.dataset.skiPush = String(COURSE.push);
  }
  function courseTick(dt) {
    // R8b: 10 s without getting anywhere -> the same abort choice; R8g: that stuck timer is course.js's now (no progress = no abort
    // while he moves down the course), the card says which ran out
    lastCourse = course.update(game.state, game.paused ? 0 : dt);
    if (lastCourse.abort && !isRace() && !courseAbort) {
      game.paused = true; input.setEnabled(false);
      courseAbort = showCourseAbort(hud.el, {
        name: game.piste ? game.piste.name : '', why: lastCourse.why,
        onAgain: () => { courseAbort = null; game.paused = false; startRun(game.piste, MODES.run); },
        onFree: () => { courseAbort = null; game.paused = false; endCourse(); freeFromHere(); },
      });
    }
  }
  function endCourse() {
    if (courseView) { courseView.dispose(); courseView = null; }
    // R8g: a course's run props (the START arch at the gate, slalom gates) go with it: after a finish / an abort nothing of the
    // challenge stays on the mountain (startRun builds them again)
    if (course && runProps) { runProps.dispose(); runProps = null; }
    if (courseAbort) { courseAbort.close(); courseAbort = null; game.paused = false; }
    course = null; lastCourse = null;
    courseHud.show(false);
    document.documentElement.dataset.skiCourse = '';
  }
  /** Caught by an avalanche: a crash, then the respawn on the nearest piste (the free run's safe spot), never in the flow. */
  function avalancheCaught(st) {
    let n = null;
    for (const p of pistes.list) { const r = p.project(st.x, st.z, null, 0, {}); if (!n || r.dist < n.proj.dist) n = { piste: p, proj: r }; }      // the nearest piste, however far
    if (n && modes.freeRun) { const a = n.piste.at(Math.max(2, n.proj.s - 60), {}); modes.freeRun.moved({ x: a.x, z: a.z, heading: Math.atan2(a.dz, a.dx) }); }
    game.state = { ...game.state, crash: SKI.crashSeconds, crashKind: 'avalanche', vx: game.state.vx * 0.3, vz: game.state.vz * 0.3 };
    audio.event('crash');
  }
  /** The Lawin challenge of a face: at the top facing down the fall line, a kick, the slab releases behind. */
  function startLawin(face) {
    if (game.mode !== MODES.freeride || game.phase !== 'running') return;
    avalanches.clear();
    const p = face.path, h = Math.atan2(p[3] - p[1], p[2] - p[0]);
    placeAt(p[0], p[1], h);
    game.state = { ...game.state, vx: Math.cos(h) * 4, vz: Math.sin(h) * 4, speed: 4 };
    if (modes.freeRun) modes.freeRun.moved({ x: p[0], z: p[1], heading: h });
    hud.toast(`Lawin-Challenge ${face.index + 1}: fuer erof!`, 1600);
    setTimeout(() => { if (game.mode === MODES.freeride) avalanches.startLawin(face); }, 900);
  }
  avalanches = createAvalanches({
    scene, field, surface, pistes, hud, uiRoot: document.getElementById('ui'), level,
    onCaught: (st) => avalancheCaught(st),
    sound: (name, opts) => audio.event(name, opts),                          // R7-C2: the release crack
    onLawinStart: (face) => startLawin(face),
    onLawinWon: (face) => { const p = store.get(); const lw = { ...(p.lawin || {}) }; lw[rid] = (lw[rid] || 0) | (1 << face.index); store.set({ ...p, lawin: lw }); modes.cloud.push(store.get()); },
    lawinMask: () => (store.get().lawin || {})[rid] || 0,
  });
  let slowFor = 0;

  // ---- round 7 (A): the picture check (WebKit / Safari safety net): a few seconds into the first ride, read the canvas back; a
  // one-colour picture or a shader error steps down: cheap snow (Niddreg shaders), then no MSAA, then no post pass ----
  // cleanup round (memory): read back with readPixels, PICTURE_ROWS one-pixel rows right after the render (same task: no
  // preserveDrawingBuffer needed), 48 samples each. The drawImage(WebGL canvas) of before made the canvas keep a full-size 2D snapshot
  // for the page's life (13.7 MB in the renderer at 1180 x 820 @2).
  const PICTURE_ROWS = 12, PICTURE_COLS = 48;
  function pictureColours() {
    try {
      post.render(scene, camera);
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      if (!w || !h) return -1;
      const row = new Uint8Array(w * 4), set = new Set();
      for (let r = 0; r < PICTURE_ROWS; r++) {
        gl.readPixels(0, Math.floor((r + 0.5) / PICTURE_ROWS * h), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
        for (let c = 0; c < PICTURE_COLS; c++) {
          const i = Math.floor((c + 0.5) / PICTURE_COLS * w) * 4;
          set.add((row[i] >> 4) * 256 + (row[i + 1] >> 4) * 16 + (row[i + 2] >> 4));
        }
      }
      return set.size;
    } catch (error) { return -1; }                                       // an unreadable picture: no verdict
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
  let last = performance.now(), acc = 0, hudT = 0, time = 0, audioT = 0, sceneT = 0, liftDist = Infinity, stationDist = Infinity, nearVillage = 0;
  const ghostPos = {};
  const frameTimes = [];
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || glLost) { last = now; return; }                  // R8b: nothing drawn while the WebGL context is lost
    const rawDt = (now - last) / 1000;
    const frameStart = performance.now();
    frameTimes.push(rawDt * 1000); if (frameTimes.length > 240) frameTimes.shift();
    last = now;
    const dt = frameSeconds(rawDt);
    time += dt;
    const s = game.state;
    npcLive = npcActive();
    if (mp) mp.frame(now);
    if (game.screen === 'ski' && !game.paused && s) {
      if (game.phase === 'countdown') {
        game.countdown -= dt;
        hud.count(game.countdown > 0 ? String(Math.ceil(game.countdown)) : 'Lass!');
        const tick = Math.ceil(game.countdown);
        if (tick !== game.lastTick) { game.lastTick = tick; if (tick > 0) audio.event('count'); }
        if (game.countdown <= 0) { audio.event('go'); game.phase = 'running'; document.documentElement.dataset.skiRunning = '1'; setTimeout(() => hud.count(''), 700); mark('go'); pushStart(); }
      }
      if (game.phase === 'lift' && ride) stepRide(dt * timescale);               // round 6: riding a lift
      else if (game.phase === 'approach' && approach) stepApproach(dt * timescale);      // easier boarding: walked in
      if (game.phase === 'running' || game.phase === 'finished') {
        const plan = planSteps(acc, dt, timescale);
        acc = plan.acc;
        for (let step = 0; step < plan.steps; step++) {
          const inp = game.phase === 'finished' ? { steer: 0, tuck: 0, brake: 1, push: 0, jump: false }
            : game.override ? game.override : game.bot ? game.bot(game.state) : input.read();
          if (game.override || game.bot) game.assisted = true;
          if (game.override || game.bot) input.read(inp);
          // R7-B: off a lift he stands still (an edge set, 0 km/h, even on a slope) until the player steers, pushes, tucks or jumps
          let held = false;
          if (game.hold && game.phase === 'running') {
            if (inp.steer || inp.push || inp.tuck || inp.jump || inp.brake) game.hold = false;
            else { game.state = { ...game.state, vx: 0, vy: 0, vz: 0, speed: 0, y: standHeight(game.state.x, game.state.z), grounded: true, crash: 0 }; held = true; }
          }
          const wasCrash = game.state.crash > 0, wasAir = !game.state.grounded, vyAir = game.state.vy;
          const prevState = game.state;
          game.state = held ? prevState : modes.step(prevState, inp, game.mode);                // round 4A: rails / park tricks, else stepSkier
          if (course && game.phase === 'running') game.state = course.collide(prevState, game.state);     // R7-C2: the barriers hold him (soft)
          if (npcLive && game.phase === 'running') game.state = crowd.collide(prevState, game.state);      // the other skiers: a bump, never a fall
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
              if (ev.type === 'offpiste' && game.mode !== MODES.run) respawn('Zréck op d\'Pist');        // R7-C: a timed run warns (course.js), never resets
              if (ev.type === 'missed-gate') { audio.event('miss'); hud.toast('Paart verpasst: +5 s'); if (runProps) runProps.markGate(ev.index, false); }
              if (ev.type === 'gate') audio.event(ev.ok === false ? 'miss' : 'gate');
            }
            if (game.mode !== MODES.run && game.run.progress > game.piste.length - 15 && game.phase === 'running') finish(null);
          }
        }
        if (course && game.phase === 'running' && game.run && game.run.timed) courseTick(dt);          // R7-C
      } else acc = 0;
      if (!replay.active && (game.phase === 'running' || game.phase === 'finished')) recorder.push(game.state, dt * timescale);
    }
    if (replay.active) replay.update(dt);
    if (avalanches) avalanches.update(game.screen === 'ski' ? game.state : null, dt, { freeride: game.mode === MODES.freeride && !isRace(), running: game.screen === 'ski' && game.phase === 'running' && !game.paused });
    const st = replay.active ? replay.state : game.state;
    if (st) {
      skier.pose(st, standNormal, time, standHeight);
      // R7-C: first person = a camera mode of its own (firstperson.js): only the ski tips and poles, the body hidden
      const rpOn = replay.active;
      const fpNow = (rpOn ? replay.cam === 'fp' : camMode === 'fp') && game.screen === 'ski' && !game.camPose && !game.orbit && !(mp && mp.viewState && mp.viewState());
      skier.setVisible(!(ride && rideView === 'window' && ride.carry && ride.where().onCarrier && !game.camPose) && !(fpNow && !ride) && !(mp && mp.hideLocal));     // in a cabin, the window view is his own eyes
      if (game.orbit) {                                                // debug: a camera that circles the skier (model checks)
        const o = game.orbit, a = st.heading + o.angle * Math.PI / 180;
        const ox = st.x + Math.cos(a) * o.dist, oz = st.z + Math.sin(a) * o.dist;
        // round 7 (A): never under the snow (an uphill bank beside the skier put this debug camera inside the slope: a 'wall' of skirts)
        game.camPose = { x: ox, z: oz, y: Math.max(st.y + o.h, surface.height(ox, oz) + 0.6), tx: st.x, ty: st.y + 0.8, tz: st.z, fov: o.fov || 40 };
      }
      const view = (mp && mp.viewState()) || st;                     // online race: watching another skier after my finish
      const riding = !!(ride && game.phase === 'lift');
      lookDt = dt;
      if (photo.active) game.camPose = photo.camera();
      if (!game.camPose && game.screen === 'ski' && !rpOn) look.step(dt, st.speed || 0);
      // round 7 (A): the free look + camera guard (the lift camera gets it through R7-B's window.__skiLook seam in rideCamera1)
      let cam = game.camPose || (riding ? rideCamera1(dt) : rpOn && !fpNow ? replay.camera(dt, time) : fpNow ? fp.update(view, dt, time, (x, z, o) => surface.normal(x, z, o), (x, z) => surface.height(x, z)) : chase.update(view, dt, time));      // camPose: a fixed view (flows)
      if (!game.camPose && !riding && !fpNow && !rpOn && game.screen === 'ski') cam = stationFrame(cam, view, dt);      // R8e: standing under a roof
      if (!game.camPose && !riding && !fpNow && !rpOn && game.screen === 'ski') cam = lookCam({ ...cam }, { x: view.x, y: view.y + 1.2, z: view.z }, false);
      document.documentElement.dataset.skiLook = `${look.yaw.toFixed(2)},${look.pitch.toFixed(2)}`;
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      if (cam.roll) camera.rotateZ(cam.roll);                                   // R7-C: the first-person lean
      fp.setOn(fpNow, !!ride && game.phase === 'lift');
      if (fpNow) { camera.updateMatrixWorld(); fp.afterCamera(camera, st, level !== 'low'); }
      camYaw = Math.atan2(cam.tz - cam.z, cam.tx - cam.x);
      if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
      if (mp) mp.render(now, time);
      if (markers && game.screen === 'ski') { camera.updateMatrixWorld(); markers.update(camera, canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, game.mode === MODES.freeride && game.phase === 'running' && !game.camPose); }
      // ghost of the best run
      if (game.ghost && game.screen === 'ski' && game.run && game.run.timed && game.phase !== 'countdown' && !rpOn) {
        const gq = ghostAt(game.ghost, game.run.elapsed * 1000);
        const p = game.piste.at(gq.s, {});
        ghostPos.x = p.x - p.dz * gq.o; ghostPos.z = p.z + p.dx * gq.o;
        ghostModel.setVisible(Math.hypot(ghostPos.x - st.x, ghostPos.z - st.z) > 1.2);
        const gs = { x: ghostPos.x, z: ghostPos.z, y: surface.height(ghostPos.x, ghostPos.z), heading: Math.atan2(p.dz, p.dx), edge: 0, tuck: gq.speed > 14 ? 1 : 0.3, brake: 0, grounded: true, air: 0, crash: 0, landed: 0, vx: 0, vy: 0, vz: 0 };
        ghostModel.pose(gs, (x, z, o) => surface.normal(x, z, o), time);
      } else ghostModel.setVisible(false);
      // spray: carving hard, braking, or skidding
      // R7-C: spray.js works out the arc / powder / tracks from the skier state itself
      spray.update(rpOn ? replay.effectDt(dt) : dt, st, rpOn ? replay.sprayAmount : game.screen === 'ski' && !ride && !game.paused ? 1 : 0, pixelRatio(), camera, (canvas.clientHeight || window.innerHeight) * pixelRatio());
    }
    // world upkeep (time-sliced)
    const watched = mp && mp.focusPoint ? mp.focusPoint() : null;             // a spectator: the tiles follow the racer / the pack he watches
    const fx = watched ? watched.x : st ? st.x : resort.width / 2, fz = watched ? watched.z : st ? st.z : resort.depth / 2;
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
      if (ruins) ruins.update(camera.position.x, camera.position.z);
      if (roads) roads.update(camera.position.x, camera.position.z, Math.min(quality.buildingRadius, level === 'low' ? 1000 : 2400));      // round 7 (A): streets near only (R8d: Niddreg 1300 -> 1000)
      modes.update(camera.position.x, camera.position.z, quality.buildingRadius);
    }
    npcFrame(dt, st);
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
    if (sceneT >= 0.2) { sceneT = 0; audio.scene(game.screen !== 'ski' || game.paused); }          // the menu music: picker, map and menus only
    if (st && audioT >= 0.05) {
      audioT = 0;
      const riding = game.screen === 'ski' && (game.phase === 'running' || game.phase === 'finished');
      const info3 = surface.info(st.x, st.z, 3);
      audio.update({
        riding, paused: game.paused, speed: st.speed, edge: st.edge, slip: st.slip, brake: st.brake, grounded: st.grounded,
        piste: surface.info(st.x, st.z, 0), forest: surface.info(st.x, st.z, 1), village: Math.max(0, -info3) > 0.05 ? 1 : nearVillage,
        lift: lifts ? liftDist : Infinity, station: lifts ? stationDist : Infinity, altitude: st.y, weather: env.state.weatherId, time: env.state.timeId,
        avalanche: avalanches ? avalanches.loudness(camera.position.x, camera.position.z) : 0,          // R7-C2: the rumble
      });
    }
    audioT += dt;
    sceneT += dt;
    hudT += dt;
    if (hudT >= HUD_EVERY) {
      if (st && lifts) { liftDist = lifts.nearest(st.x, st.z); stationDist = lifts.nearestStation(st.x, st.z); }
      if (st) nearVillage = village ? Math.max(0, Math.min(1, -surface.info(st.x + 60, st.z, 3) - surface.info(st.x - 60, st.z, 3) - surface.info(st.x, st.z + 60, 3) - surface.info(st.x, st.z - 60, 3))) * 0.6 : 0;
      hudT = 0;
      if (st) env.setSunScale(sunVisibility(st.x, st.y + 1, st.z));
      if (game.screen === 'map') updateStartStatus();
      if (game.screen === 'ski' && st) {
        // R8 (early QA: 43 km/h on the speedo while dragged up a T-bar at x4): on a lift the speedo shows the lift's real line speed
        hud.setSpeed(approach ? 0 : ride ? (ride.phase === 'ride' ? ride.path.spec.speed * 3.6 : 0) : st.speed * 3.6);      // (walked in: 0, not the walk's pace)
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
        if (!replay.active) freeTick(st);
        // R7-C: discovery (every place skied through, every station reached), the avalanche warning, the course HUD
        if ((game.phase === 'running' || game.phase === 'lift') && !replay.active) { explore.tick(st, HUD_EVERY); modes.goalTick(st, HUD_EVERY, explore.disc.count); }
        if (avalanches) avalanches.hudTick(st, { freeride: game.mode === MODES.freeride && !isRace(), running: game.phase === 'running' && !game.paused });
        if (course && lastCourse) courseHud.set(lastCourse, st, camYaw);
        if (ride) rideHud.set({ left: ride.left, share: ride.share, view: rideView, down: !!ride.down });
      }
    }
  }

  /** Round 6 (HUD rate): the challenge gate the skier is in, the ski stats (off-piste metres, top speed) and the ski unlocks they bring. */
  let statT = 0, statTop = 0, statOff0 = 0;
  function freeTick(st) {
    if (lifts && modes.liftAt && !modes.liftDown && game.phase === 'running') lifts.holdShuttle(modes.liftAt.index);      // R8e: the docked cabin waits for him
    if (game.mode === MODES.freeride && game.phase === 'running' && !game.paused) {
      // R8e (3V QA "Lac des Creux": the prompt popped mid-run as he crossed a start at 61 km/h): only nearly stopped, or skiing into
      // the gate from its start side (above the banner, within its posts, along the piste)
      const m0 = markers.at(st.x, st.z), m = m0 && promptable(m0, st) ? m0 : null;
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

  /* ---------------- the other skiers ---------------- */
  let npcLive = false;
  /** Where the other skiers must not be: trees, station parts and pylons (any height), the drawn houses. */
  function npcBlocked(x, z, r) {
    return !!(scatter.hit(x, z, r, -1e9, quality.treeDensity) || modes.lifts.world.hit(x, z, r) || (ruins && ruins.hit(x, z, r)) || (boxIndex && boxIndex.hit(x, z, r)));
  }
  /** On in the free ride, the lift rides, a challenge outside its corridor, the online free ride; never in an online race or the park. */
  function npcActive() {
    return !!(npcOn && crowd && game.screen === 'ski' && game.state && !isRace() && game.mode !== MODES.park);
  }
  function npcShare() {
    if (env.state.timeMode && env.state.timeMode !== 'random') return env.state.timeId === 'evening' ? 0.4 : env.state.timeId === 'morning' ? 0.7 : 1;
    return modes.clock ? dayShare(modes.clock.hour) : 1;
  }
  function npcFrame(dt, st) {
    // lift lines: the mazes (posts, tape) are scenery: drawn whatever the other skiers' switch
    if (game.screen === 'ski') {
      if (!queueView) { try { queueView = createQueueView({ scene, ground: standHeight }); } catch (error) { console.warn('[ski] queue view failed', error); queueView = false; } }
      if (queueView) queueView.update(camera.position.x, camera.position.z, modes.lifts.world, dt);
    }
    if (!npcLive) {
      if (npcView && npcView.enabled) { npcView.setEnabled(false); if (crowd) crowd.reset(); }
      if (lifts && lineGateOpen.size) { for (const i of lineGateOpen) if (!(ride && ride.lift.index === i)) lifts.setGate(i, 0); lineGateOpen.clear(); }
      return;
    }
    if (!npcView) {
      try { npcView = createNpcView({ scene, height: (x, z) => surface.height(x, z), level }); } catch (error) { console.warn('[ski] other skiers: view failed', error); npcOn = false; return; }
      if (lifts) lifts.setRiderSink(npcView.addCarrier);
      return;                                                             // (the carriers are reported from the next lifts.update)
    }
    if (!npcView.enabled) npcView.setEnabled(true);
    // a running challenge: nobody in its corridor (and nobody skiing its piste)
    if (course && game.piste) { if (npcCorridorOf !== course) { npcCorridorOf = course; npcCorridor = corridorOf(game.piste, course.startS, course.finishS); } }
    else { npcCorridorOf = null; npcCorridor = null; }
    const riding = !!(ride && game.phase === 'lift');
    const share = npcShare();
    const list = crowd.update(time, dt, {
      x: camera.position.x, z: camera.position.z, fx: Math.cos(camYaw), fz: Math.sin(camYaw), level, share,
      player: st && !riding && !st.ride ? st : null,
      hidden: npcCorridor, skipPiste: npcCorridor ? game.piste : null,
      lifts, hold: lineHold(st),
    });
    lineGates();
    npcView.draw(list, camera, crowd, { level, share, dt, fadeIn: !game.camPose, hidden: npcCorridor });
  }
  /** Lift lines: the lift whose line waits for the player ('walk': led in / boarding; 'zone': he stands in its zone), or null. */
  function lineHold(st) {
    if (approach && !approach.down) return { index: approach.lift.index, kind: 'walk' };
    if (ride && !ride.down && ride.phase === 'board') return { index: ride.lift.index, kind: 'walk' };
    if (st && game.phase === 'running' && modes.liftAt && !modes.liftDown) {
      const site = modes.lifts.world.sites.get(modes.liftAt.index);
      if (site && site.queue && site.inZone(st.x, st.z)) return { index: modes.liftAt.index, kind: 'zone' };
    }
    return null;
  }
  /** Lift lines: the chair gates the line walks through (the player's own ride drives its lift's gate). */
  const lineGateOpen = new Set();
  function lineGates() {
    if (!lifts) return;
    for (const i of lineGateOpen) if (!crowd.gates.has(i) && !(ride && ride.lift.index === i)) { lifts.setGate(i, 0); lineGateOpen.delete(i); }
    for (const [i, open] of crowd.gates) {
      if (ride && ride.lift.index === i) continue;
      lifts.setGate(i, open);
      if (open > 0) lineGateOpen.add(i); else lineGateOpen.delete(i);
    }
  }
  function setNpcs(on) {
    npcOn = !!on;
    writeNpcPref(npcOn);
    document.documentElement.dataset.skiNpcs = npcOn ? '1' : '0';
  }
  crowd = createCrowd({ resort, pistes, liftNet: modes.lifts, height: (x, z) => surface.height(x, z), standY: standHeight, seed: strHash(rid) });
  crowd.setBlocked(npcBlocked);
  if (roadRows) crowd.setRoads(roadRows);
  document.documentElement.dataset.skiNpcs = npcOn ? '1' : '0';

  // debug / flows
  window.__ski = {
    audio,
    get game() { return game; }, get state() { return game.state; }, get level() { return level; }, renderer, scene, camera, env, pistes, get landmarks() { return landmarks; }, get ruins() { return ruins; }, streamer, terrain, scatterView, field, surface,
    setInput(o) { game.override = o; }, blocked: (x, z) => botBlocked(x, z),
    /** R8e: the share of the top fifth of the current view that hits a station part / house within 40 m (the spawn framing check). */
    roofShare: () => { const d = new THREE.Vector3(); camera.getWorldDirection(d); const p = camera.position; return roofShare(p.x, p.y, p.z, p.x + d.x * 10, p.y + d.y * 10, p.z + d.z * 10, camera.fov); },
    /** Debug camera circling the skier: angle (deg from the skier's heading), distance, height; null = off. */
    orbit(angle, dist = 4, h = 1.2, fov = 40) { if (angle === null) { game.orbit = null; game.camPose = null; return; } game.orbit = { angle, dist, h, fov }; },
    /** Fixed camera at (x, z) heightAbove m over the ground looking at (tx, tz) heightAbove2 m over its ground; null = chase camera again. */
    // R7-C2: the drawn snow (surface), never closer than 0.6 m to it
    setCamera(x, z, above, tx, tz, above2 = 0, fov = 55) { if (x === null) { game.camPose = null; return; } game.camPose = { x, z, y: surface.height(x, z) + Math.max(0.6, above), tx, tz, ty: surface.height(tx, tz) + above2, fov }; streamer.focus(x, z); },
    /** R7-C2: watch Lawin face i from a clear spot (avalanche.js faceView); returns the spot. */
    avalancheView(i = 0, fov = 50) { const v = avalanches && avalanches.view(i); if (v) { game.camPose = { x: v.x, y: v.y, z: v.z, tx: v.tx, ty: v.ty, tz: v.tz, fov }; streamer.focus(v.x, v.z); } return v; }, start(id) { startRun(pistes.byId.get(id) || game.piste, MODES.run); }, select(id) { selectPiste(pistes.byId.get(id), true); },
    frames: () => { const f = [...frameTimes].sort((a, b) => a - b); return { n: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1] }; },
    resolution: () => post.stats(), post, get shaderErrors() { return shaderErrors; }, pictureColours, pictureCheck,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: terrain.stats.leaves, trees: scatterView.stats.trees, cards: farForest.stats.cards, tilesLoaded: streamer.stats.loaded, tilesTotal: streamer.stats.total, level }),
    teleport(s) { if (game.run) { const p = game.piste.at(s, {}); placeAt(p.x, p.z, Math.atan2(p.dz, p.dx)); } },
    progress: () => store.get(),
    // round 4A
    modes, parkLayout, startPark, startFree: (id) => startFree(id ? modes.lifts.byId.get(id) : game.freeLift || modes.lifts.list[0]), rideUp, setMapMode,
    // round 6
    goFree: (id) => goFree(id ? modes.lifts.byId.get(id) : spawn), goDown: (id) => goFree(null, { kind: 'liftdown', lift: id }), boardLift, skipRide, toggleRideView, get ride() { return ride; }, get carrier() { return carrier; }, get rideView() { return rideView; }, get spawn() { return spawn; },
    get lifts() { return lifts; }, get signs() { return signs; }, markers, setSki, get skiType() { return skiType; }, get world() { return world; }, openSkiCard, resumeFree, acceptChallenge, showMap,
    place(x, z, heading) { placeAt(x, z, heading); },
    // R7-B (flows): stand still at (x, z) like after a lift (0 km/h until an input), the scatter for the tree checks
    placeHold(x, z, heading) { placeAt(x, z, heading); game.hold = true; if (modes.freeRun) modes.freeRun.moved({ x, z, heading }); },
    get hold() { return !!game.hold; }, scatter, quality,
    // round 7 (A)
    get village() { return village; },                                      // R8f: buildNear(x, z, r) for checks after a jump
    get skierClear() { return skier.skiClearance; }, skier, standHeight, deckAt, get roadRows() { return roadRows; }, get roads() { return roads; }, get boxIndex() { return boxIndex; }, look, camGuard, camBlocked,
    // R7-C
    npcs: { get crowd() { return crowd; }, get view() { return npcView; }, get on() { return npcOn; }, set: setNpcs, get live() { return npcLive; } },
    get explore() { return explore; }, get avalanches() { return avalanches; }, get course() { return course; }, get lastCourse() { return lastCourse; }, get spray() { return spray; },
    replay, photo, recorder, openReplay, openPhoto,
    get camMode() { return camMode; }, setCamMode, fp, gateOf, gateAt, startLawin, teleportTo: (spot) => goFree(null, spot), firstLift: () => goFree(spawn), get pisteMap() { return pisteMap; },
  };

  // first build around the default piste behind the loading screen, then the picker (or straight onto the piste with ?auto=1)
  LOAD.set(0.75, 'Pisten ginn opgebaut …');
  const lastRun = store.get().last || {};
  const startPiste = pistes.byId.get(params.piste) || openPisteNear((lastRun.resort === rid && pistes.byId.get(lastRun.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0]);
  game.piste = startPiste;
  // round 6: the free ride starts at the bottom station of a lift in a village; the first build happens there unless the page was opened
  // onto a piste (?piste= / ?auto=1 / ?map=1) or into an online race
  // R7-C: the resort's first lift (config FIRST_LIFT); R7-D: the online free ride starts everybody at the same lift (never a saved piste)
  spawn = (explore && explore.first) || spawnLift(modes.lifts, resort.places, mpFree ? (pistes.byId.get(resort.start) || pistes.list[0]).bottom : startPiste.bottom);
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
    // R7-D + R8b: the avalanches of round 7 C (avalanche.js onTrigger / triggerAvalanche(id, seed, t s, on performance.now() / 1000)) are
    // shared in the online free ride: a local release is broadcast, a friend's release starts the same slab here
    const avalancheApi = () => avalanches;
    mp = createMp({ ctx: mpCtx, host: {
      game, rid, pistes, streamer, terrain, surface, scene, camera, canvas, env, hud, input, audio, chase, uiRoot: document.getElementById('ui'),
      outfit: () => outfit, level: () => level, startRun: (p, lateral) => startRun(p, MODES.run, lateral),
      board: () => isBoard(),                                                 // 28 Nov 2026: the others see my snowboard (wire flag 8)
      setView: (pose) => { game.camPose = pose; },                           // a spectator's overview camera (net/spectate.js); null = the chase camera again
      // R7-D: a friend on a lift is drawn in his carrier even before this device rode one (the lift view is built early, once)
      liftPath: (i) => { if (!lifts) buildLifts(); return lifts ? lifts.pathOf(i) : null; },
      // R7-D free ride
      liftName: (i) => { const l = modes.lifts.byIndex.get(i); return l ? l.name : ''; },
      startSpot: (lateral) => { const b = boardSpot(spawn); return { x: b.x - Math.sin(b.heading) * lateral, z: b.z + Math.cos(b.heading) * lateral, heading: b.heading }; },
      startFree: (spot) => goFree(spawn && Math.hypot(spot.x - spawn.bottom.x, spot.z - spawn.bottom.z) < 60 ? spawn : null, spot),
      dayClock: () => modes.clock,
      liftTop: (i) => { const l = modes.lifts.byIndex.get(i); return l ? modes.lifts.startAt(l, (x, z) => surface.height(x, z)) : null; },
      liftBottom: (i) => { const l = modes.lifts.byIndex.get(i); return l ? modes.lifts.bottomExit(l, (x, z) => surface.height(x, z)) : null; },
      avalanche: {
        trigger: (id, seed, tMs) => { const a = avalancheApi(); if (a && a.triggerAvalanche) a.triggerAvalanche(id, seed, tMs / 1000); },
        known: (id) => { const a = avalancheApi(); return !!(a && a.known && a.known(id)); },          // R8b: security LOW 3, a real zone only
      },
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

/* A page that is being left (a reload, the lobby's link, a back tap) cancels its own downloads; Safari / WebKit reports those as "Load failed"
 * rejections of the boot. A page that is really gone never runs the timer below, so only a boot that failed on a page that stays is reported
 * (it used to log "boot failed" for every cancelled boot: the WebKit failures of the ski-mp flows). */
let leaving = false;
addEventListener('pagehide', () => { leaving = true; });
const BOOT_REPORT_DELAY_MS = 400;
boot().catch((error) => {
  setTimeout(() => {
    if (leaving) return;
    console.error('[ski] boot failed', error);
    document.documentElement.dataset.bootError = error.message || 'boot';
    LOAD.fail(`Feeler: ${error.message}`);
  }, BOOT_REPORT_DELAY_MS);
});
