/* Lux Drive: the entry point. Loads the baked world, builds the scene and runs the loop.
 *
 * The order of the work: the data (the terrain, the roads, the decks, the buildings), then the pure world (the height
 * function, the physics surface, the play area), then the painted textures and the sky, then the views (the terrain tiles,
 * the bridge decks, the car), and finally the loop.
 *
 * The loading screen shows the real progress (the loader API of the page) and the tiles around the car are built while the
 * first frames run, so the game starts quickly. */
import { QUALITY, WORLD, TRAM, CAR_COLOURS, CAR } from './config.js';
import { loadWorldData } from './world-data.js';
import { createHeightField } from './heightfield.js';
import { createSurface } from './surface.js';
import { createDeckNetwork, createGround } from './decks.js';
import { createBuildingIndex } from './buildings.js';
import { createTreeIndex, keepWaysClear } from './trees.js';
import { createTreeView } from './tree-view.js';
import { createPortals, portalRoadAt, portalBlocked } from './portals.js';
import { createTubes, tubeRoadInfo, tubeShells, lampsOutsideShells } from './tunnel-tubes.js';                // tunnels16: the tunnels the car drives through
import { createPlayArea } from './play-area.js';
import { buildWorldMap } from './world-map.js';
import { createPaintTextures } from './paint-textures.js';
import { createGroundMaterial } from './ground-shader.js';
import { createTerrainView } from './terrain-view.js';
import { buildMarkingPlan } from './markings.js';                 // the lane markings, planned per carriageway (paint7)
import { createDeckMarkingView } from './deck-marking-view.js';
import { createBuildingView } from './building-view.js';
import { createDeckView } from './deck-view.js';
import { createWallCollider } from './wall-collider.js';
import { createWallView } from './wall-view.js';
import { createWallMaterial } from './wall-material.js';               // look11: masonry drawn in the shader
import { WALL_DRAW_FACTOR, createWallBlockTest } from './retaining-walls.js';              // TERRAIN2: the retaining walls
import { createLandmarks, fixLandmarkDecks } from './landmarks.js';
import { createLandmarkView } from './landmark-view.js';
import { createPortalView } from './portal-view.js';
import { createTunnelView, createTubeInsideMaterial } from './tunnel-view.js';     // tunnels16: the tubes and their open portals
import { createTubeMask } from './tunnel-mask.js';
import { createTramNetwork } from './tram-network.js';          // the Luxtram (city finish)
import { createTramSim } from './tram-sim.js';
import { createTramView } from './tram-view.js';
import { placeStreetLights } from './street-lights.js';        // the street lights (city finish)
import { createStreetLightView } from './street-light-view.js';
import { createPropCollider } from './props.js';              // lamps, poles and benches stop the car
import { createCarCollider, LAMP_POST_RADIUS, LAMP_POST_HEIGHT, BENCH_RADIUS, BENCH_HEIGHT } from './car-collide.js';   // drive12: everything that stops the car, at its height
import { placeParkBenches } from './park-benches.js';          // the benches of the parks (city finish)
import { createBenchView } from './bench-view.js';
import { createSolidMaterial } from './solid-material.js';
import { createEnv, TIME_PRESETS, WEATHER_IDS } from './env.js';
import { createChaseCamera } from './camera.js';
import { createCar } from './car.js';
import { createCarModel } from './car-model.js';
import { createSound } from './sound.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createMinimap } from './minimap.js';
import { createFullMap } from './fullmap.js';
import { createRoadIndex } from './road-index.js';
import { createBasemap } from './basemap.js';
import { placeClear } from './placement.js';
import { createQualityStepper } from './quality-step.js';
import { roadDirectionAt } from './roads.js';
import { t, LANGS } from './i18n.js';

const BUILT_DRAW_FACTOR = 1.5;        // bridge decks and tunnel portals are drawn out to this many times the far building radius
const DECK_MARK_RADIUS = 700;         // m: the lane lines on the bridge decks are drawn out to this distance (a 15 cm line is far below a pixel beyond)
const MAX_FRAME_S = 0.1;              // s: a long frame (a tab in the background) never jumps the car
const LANG_KEY = 'pb_luxdrive_lang';
const QUALITY_KEY = 'pb_luxdrive_quality';
const COLOUR_KEY = 'pb_luxdrive_colour';
const SOUND_KEY = 'pb_luxdrive_sound';       // 'off' = muted
const CAMERA_IDS = ['chase', 'far', 'bonnet'];
const START_REACH_M = 80;             // m: the start place is moved onto the nearest car road within this distance
const TELEPORT_REACH_M = 60;          // m: "I am stuck" looks for a road this close
const STUCK_SECONDS = 3.5;            // s of pushing the pedal without moving before the car is put back on the road
const STUCK_SPEED = 0.6;              // m/s
const PLACE_MARGIN_M = 0.12;          // m: a teleport keeps this much air round the car circles (a Grund street is 6 m wide)
const TIME_IDS = Object.keys(TIME_PRESETS);

const readKey = (key) => { try { return localStorage.getItem(key); } catch (error) { console.warn('[luxdrive] storage blocked', error); return null; } };
const writeKey = (key, value) => { try { localStorage.setItem(key, value); } catch (error) { console.warn('[luxdrive] storage blocked', error); } };
const param = (name) => new URLSearchParams(window.location.search).get(name);

/** The quality of a touch device (the school iPads first): the low setting, the player can raise it in the menu. */
function autoQuality() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const ipadDesktop = navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || navigator.userAgent || '');
  if (coarse || ipadDesktop) return 'medium';
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return weak ? 'medium' : 'high';
}

function pickLang() {
  const own = readKey(LANG_KEY);
  if (LANGS.includes(own)) return own;
  const site = readKey('site_lang');
  if (LANGS.includes(site)) return site;
  return 'lb';
}

const reader = (base) => async (name) => {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

async function boot() {
  const loader = window.__luxLoad || { set() {}, done() {}, fail() {} };
  const canvas = document.getElementById('luxCanvas');
  let lang = pickLang();
  document.documentElement.lang = lang;
  const tr = (key, params) => t(lang, key, params);
  const setLoad = (p, key) => loader.set(p, key ? tr(key) : '');

  // ---- the quality
  let qualityId = param('q') && QUALITY[param('q')] ? param('q') : (QUALITY[readKey(QUALITY_KEY)] ? readKey(QUALITY_KEY) : autoQuality());
  let quality = { ...QUALITY[qualityId], id: qualityId };
  const qualityPinned = !!(param('q') && QUALITY[param('q')]);        // a q= in the URL is a test or a developer: no automatic step

  // ---- the hole detector: the sky is switched off and the clear colour is magenta, so every pixel that
  // shows the clear colour is a place where the ground is missing (the flow scripts/flows/luxdrive_holes.mjs)
  const holeMode = param('holes') === '1';

  // ---- the renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityId === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: holeMode });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;         // the whole game shades in display space (the painted look)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setClearColor(holeMode ? 0xff00ff : 0x9ab6c8, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, quality.far);
  scene.add(camera);

  // ---- the data
  setLoad(0.05, 'load.terrain');
  const data = await loadWorldData(reader(new URL('./data/', import.meta.url)), (p, what) => setLoad(0.08 + 0.5 * p, `load.${what}`));
  const areaRes = await fetch(new URL('./data/area.json', import.meta.url));
  if (!areaRes.ok) throw new Error(`area.json: HTTP ${areaRes.status}`);
  const area = await areaRes.json();

  // ---- the pure world
  setLoad(0.62, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const field = createHeightField({ near: data.near, far: data.far, roads: data.roads, decks: data.decks });
  const surface = createSurface(field);
  const deckNetwork = createDeckNetwork(fixLandmarkDecks(data.decks, (x, z) => surface.height(x, z)), surface);
  const tubes = createTubes(data.roads, surface, field.network, data.buildings);
  const ground = createGround(surface, deckNetwork, tubes.network);
  // the landmarks (the famous places) replace some blocks and some bridge decks of the bake and have collision of their own
  const landmarks = createLandmarks({ buildings: data.buildings, decks: ground.decks, ground: (x, z) => surface.height(x, z), roads: data.roads });
  const buildings = createBuildingIndex(data.buildings, { hidden: landmarks.hiddenBuildings, groundAt: (x, z) => field.height(x, z), landAt: (x, z) => field.baseHeight(x, z) });   // (the houses know their height: drive12)
  const playArea = createPlayArea(area);
  const portals = createPortals(data.roads, (x, z) => surface.height(x, z), (r) => field.network.isDrawn(r.id), (x, z) => playArea.inside(x, z), portalRoadAt(field.network), portalBlocked(buildings, deckNetwork), tubes.ids);
  const maps = buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy, buildings: data.buildings });
  // the trees: the woods (placed from the canopy) and the trees of OSM (the street trees, the trees of the parks)
  // no tree grows on a bridge or hangs its crown over a lane (the bridges as decks, with the full width of the landmark models)
  const treeDecks = createDeckNetwork([...ground.decks, ...landmarks.footprints]);
  const shells = tubeShells(tubes.tubes, (x, z) => surface.height(x, z));       // (nothing grows in the hood of a tunnel portal: tunnels16)
  const bakedTrees = keepWaysClear(data.trees, { network: field.network, field, treeDecks, treeFree: landmarks.treeFree }).filter((t) => !shells.inShell(t.x, t.z, 1.5));
  const forest = createTreeIndex({ map: maps, field, network: field.network, buildings, trees: bakedTrees, clearings: [...landmarks.clearings, ...shells.clearings], treeDecks });

  // ---- the painted textures, the world maps, the sky
  setLoad(0.72, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const textures = createPaintTextures(renderer, qualityId);
  await textures.ready;
  const mapTexture = (arr, nx, nz) => {
    const tex = new THREE.DataTexture(arr, nx, nz, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
    return tex;
  };
  const worldMaps = { class: mapTexture(maps.coverGpu, maps.nx, maps.nz), canopy: mapTexture(maps.canopy, maps.canopyNx, maps.canopyNz) };
  const env = createEnv({
    noiseTexture: textures.noise,
    params: { time: param('time') || undefined, weather: param('weather') || undefined },
  });
  env.uniforms.uSkyPaint.value = textures.sky;                      // the painted cloud tile (the noise texture made coloured specks)
  if (holeMode) env.sky.visible = false;                             // the hole detector: the sky would hide the gaps
  scene.add(env.sky);
  const groundFull = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, false, quality.treeRadius);
  const groundCheap = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, true, quality.treeRadius);

  // ---- the views
  setLoad(0.82, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const solid = createSolidMaterial(env);
  const shownDecks = ground.decks.filter((d) => !landmarks.hiddenDecks.has(d.id));
  const markPlan = buildMarkingPlan(data.roads, field.network, shownDecks);
  // (the tiles over the shell of a tunnel draw no terrain inside it: tunnel-mask.js)
  const tubeMask = createTubeMask(THREE, tubes.tubes, (x, z) => surface.height(x, z));
  const terrain = createTerrainView({ scene, surface, field, material: quality.cheapGround ? groundCheap : groundFull, quality, marks: markPlan,
    variant: (leaf, m) => (tubeMask.needsMask(leaf) ? tubeMask.twin(m) : m) });
  const city = createBuildingView({ scene, buildings, field, env, noiseTexture: textures.noise, quality, hidden: landmarks.hiddenBuildings });
  const trees = createTreeView({ scene, forest, baked: bakedTrees, field, env, quality });
  const decks = createDeckView({ scene, decks: shownDecks, material: solid, ground: ground.surface, laneLinesOn: false });
  const deckMarks = createDeckMarkingView({ scene, plan: markPlan, material: solid });
  const walls = createWallView({ scene, walls: data.walls, material: createWallMaterial(env), groundAt: (x, z) => surface.height(x, z) });
  const landmarkView = createLandmarkView({ scene, landmarks, material: solid });
  const portalView = createPortalView({ scene, portals, ground, material: solid });
  const tunnelView = createTunnelView({ scene, tubes: tubes.tubes, heightAt: (x, z) => surface.height(x, z), insideMaterial: createTubeInsideMaterial(env), outsideMaterial: solid });
  // the Luxtram: the rails and the vehicles of the line (tram-network.js builds the two tracks from lines.bin, tram-sim.js runs the vehicles on them)
  const tramNetwork = createTramNetwork(data.lines, data.stops, TRAM);
  const tramSim = createTramSim(tramNetwork, TRAM);
  const props = createPropCollider();                       // lamps, catenary poles and benches: small solid circles the car stops at
  const trams = createTramView({ scene, network: tramNetwork, sim: tramSim, surface, deckNetwork, env, camera, maps, props, quality });
  const lamps = lampsOutsideShells(placeStreetLights({ roads: data.roads, network: field.network, buildings, map: maps, walls: data.walls }), shells.inShell);
  for (let i = 0; i < lamps.count; i++) props.add(lamps.x[i], lamps.z[i], LAMP_POST_RADIUS, surface.height(lamps.x[i], lamps.z[i]), LAMP_POST_HEIGHT);   // (no lamp stands on a deck: harness H)
  const streetLights = createStreetLightView({ scene, lights: lamps, ground, env });
  const parkBenches = placeParkBenches({ roads: data.roads, network: field.network, buildings, map: maps });
  for (let i = 0; i < parkBenches.count; i++) props.add(parkBenches.x[i], parkBenches.z[i], BENCH_RADIUS, surface.height(parkBenches.x[i], parkBenches.z[i]), BENCH_HEIGHT);
  const benchView = createBenchView({ scene, benches: parkBenches, ground, env });
  const colourId = CAR_COLOURS[readKey(COLOUR_KEY)] ? readKey(COLOUR_KEY) : 'red';
  const model = createCarModel({ colourId, material: solid, groundAt: (x, z) => ground.height(x, z) });     // look11: the drawn wheels on their springs
  scene.add(model.group);

  // ---- the car, the camera, the interface
  const start = data.places.start || { x: WORLD.width / 2, z: WORLD.depth / 2, yaw: 0 };
  const roadInfo = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0 };
  const wallCollider = createWallCollider(data.walls, (x, z) => ground.height(x, z), (x, z) => surface.height(x, z));        // the retaining walls are solid from both sides (wall-collider.js)
  // Everything that stops the car answers for the car's own level (`y`: the level of its wheels, car-collide.js): a house, a tree, a lamp stops a car only
  // where the car's body overlaps it in height.  (Before drive12 the trees and lamps were switched off on any deck and the houses were solid to the sky: the
  // houses of Pfaffenthal stopped the car on the Pont Rouge 60 m above them, QA3 N3-B01.)  The bank under the end of a bridge stops a car under the deck.
  const { collide } = createCarCollider({ buildings, landmarks, walls: wallCollider, portals, ground, forest, props, trams: tramSim, playArea, surface, deckNetwork, tubes: tubes.network });
  // (in a tube the road under the car is the tube's: the land over it would be grass)
  const roadInfoAt = (x, z, out) => (ground.inTube(x, z) ? tubeRoadInfo(out) : surface.roadInfoAt(x, z, out));
  const car = createCar({ ground, roadInfoAt, collide, start });
  const wallLens = createWallBlockTest(data.walls);          // look11 (QA2 N-C02): the lens never inside the block of a retaining wall
  // (the wall first: a house that only touches the lens - pen 0 - answered before the wall, and the lens stayed in the block of a wall that ends at the house: Bd Konrad Adenauer 7706,6728)
  // (the lens is a ball: a house or a tree is in its way where the ball overlaps it in height - the lens over the Pont Rouge is not pushed by the houses under it)
  // (in a tube the lens meets the tube alone: its walls keep it inside, the houses over it are not at its level - tunnels16)
  const lensHit = (x, z, radius, y) => tubes.network.collide(x, z, radius, y - radius);
  const chase = createChaseCamera(ground, (x, z, radius, y) => (tubes.network.inside(x, z, y - radius) ? lensHit(x, z, radius, y)
    : wallLens(x, z, radius, y) || buildings.collide(x, z, radius, y - radius) || forest.collide(x, z, radius, y - radius) || portals.collide(x, z, radius, y) || lensHit(x, z, radius, y)));

  // the Kaart: one road index and one painted base for the minimap, the full map and the teleport
  const roadIndex = createRoadIndex(data.roads);
  const basemap = createBasemap({ nx: maps.nx, nz: maps.nz, classData: maps.classData });

  const sound = createSound({ muted: readKey(SOUND_KEY) === 'off' });         // starts on the first tap or key (iOS)
  const ui = createUI({ root: document.body, lang, onAction: handleAction });
  const minimap = createMinimap({ canvas: ui.minimap, index: roadIndex, basemap, area });
  const towns = (data.places.landmarks || []).filter((p) => p.kind === 'town');
  const fullMap = createFullMap({
    container: ui.mapContainer, index: roadIndex, basemap, world: WORLD, places: towns,
    onPick: (hit) => (hit ? teleportTo(hit) : ui.setToast(tr('map.noRoad'))),
    labels: () => ({ here: tr('map.here') }),
  });
  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
  const touchLabels = () => ({ throttle: tr('touch.throttle'), brake: tr('touch.brake'), handbrake: tr('touch.handbrake'), steer: tr('touch.steer') });
  const input = createInput({ root: document.body, onAction: handleAction, labels: touchLabels() });
  input.showTouchUi(isTouch);
  const stepper = createQualityStepper({ initial: qualityId, enabled: !qualityPinned && !holeMode });
  const fullscreenAvailable = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  ui.setFullscreenAvailable(fullscreenAvailable);

  // ---- the state of the game
  let camMode = 0;
  let running = true;
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let showRoad = '';
  let scripted = null;
  let loadingDone = false;
  let started = false;                 // false while the start menu is up
  let stuckFor = 0;
  let wasCrashed = false;

  const WEATHER_ICON = { clear: '☀️', cloudy: '☁️', fog: '🌫️', rain: '🌧️' };
  const label = (group, id) => (id === 'random' ? tr('set.random') : tr(`${group}.${id}`));
  const syncPlayState = () => input.setBlocked(ui.isBlocking());

  function handleAction(action, value) {
    const id = typeof value === 'string' ? value : null;         // a keyboard action passes the event, a control passes an id
    switch (action) {
      case 'menu': toggleMenu(); break;
      case 'confirm': if (ui.isOpen('start')) handleAction('drive'); break;
      case 'drive': startDriving(); break;
      case 'resume': ui.showPause(false); syncPlayState(); break;
      case 'settings': ui.showPause(false); ui.showSettings(true); syncPlayState(); break;
      case 'back': ui.showSettings(false); ui.showPause(true); syncPlayState(); break;
      case 'restart': ui.closeOverlays(); resetCar(); syncPlayState(); break;
      case 'help': ui.showHelp(true); syncPlayState(); break;
      case 'closeHelp': ui.showHelp(false); syncPlayState(); break;
      case 'map': toggleMap(); break;
      case 'closeMap': closeMap(); break;
      case 'chooser':
        if (ui.isBlocking() && !ui.isOpen('start')) { ui.closeOverlays(); closeMap(); }
        if (started) ui.showChooser(!ui.isChooserOpen());
        syncPlayState();
        break;
      case 'camera': setCamera(id ? CAMERA_IDS.indexOf(id) : (camMode + 1) % CAMERA_IDS.length, !id); break;
      case 'reset': resetCar(); break;
      case 'weather': chooseWeather(id); break;
      case 'time': chooseTime(id); break;
      case 'sound': { const off = id === 'off'; writeKey(SOUND_KEY, off ? 'off' : 'on'); sound.setMuted(off); ui.setValue('sound', off ? 'off' : 'on'); break; }
      case 'colour': if (CAR_COLOURS[id]) { writeKey(COLOUR_KEY, id); model.setColour(id); } break;
      case 'language': changeLanguage(id); break;
      case 'quality': chooseQuality(id); break;
      case 'fullscreen': toggleFullscreen(); break;
      default: break;
    }
  }

  function startDriving() {
    if (started) { ui.closeOverlays(); syncPlayState(); return; }
    started = true;
    ui.closeOverlays();
    syncPlayState();
    if (env.getChoice().weatherId === 'rain') ui.setToast(tr('toast.wet'), 3.2);
  }
  /** Esc / the menu button: map -> closes the map; settings and help -> back; the game -> the pause menu. */
  function toggleMenu() {
    if (fullMap.isOpen()) closeMap();
    else if (ui.isOpen('help')) ui.showHelp(false);
    else if (ui.isOpen('settings')) { ui.showSettings(false); ui.showPause(true); } else if (ui.isOpen('start')) { /* the start menu has no Esc */ } else if (ui.isOpen('pause')) ui.showPause(false);
    else { ui.showChooser(false); ui.showPause(true); }
    syncPlayState();
  }
  function toggleMap() {
    if (!started) return;
    if (fullMap.isOpen()) { closeMap(); return; }
    ui.closeOverlays();
    ui.showChooser(false);
    fullMap.open(car.state);
    ui.showMap(true);
    syncPlayState();
  }
  function closeMap() { if (!fullMap.isOpen()) return; fullMap.close(); ui.showMap(false); syncPlayState(); }

  function setCamera(mode, announce) {
    camMode = Math.max(0, mode);
    ui.setValue('camera', CAMERA_IDS[camMode]);
    if (announce) ui.setToast(`${tr('hud.camera')}: ${tr(`cam.${CAMERA_IDS[camMode]}`)}`);
  }
  function chooseWeather(id) {
    const cycle = ['random', ...WEATHER_IDS];
    const next = id && cycle.includes(id) ? id : cycle[(cycle.indexOf(env.getChoice().weatherMode) + 1) % cycle.length];
    env.setWeather(next);
    ui.setValue('weather', next);
    const now = env.getChoice().weatherId;
    ui.setChooserIcon(WEATHER_ICON[now] || '⛅');
    ui.setToast(`${tr('hud.weather')}: ${label('weather', next)}${next === 'random' ? ` (${tr(`weather.${now}`)})` : ''}`);
    if (now === 'rain' && started) ui.setToast(tr('toast.wet'), 3);
  }
  function chooseTime(id) {
    const cycle = ['random', ...TIME_IDS];
    const next = id && cycle.includes(id) ? id : cycle[(cycle.indexOf(env.getChoice().timeMode) + 1) % cycle.length];
    env.setTime(next);
    ui.setValue('time', next);
    const now = env.getChoice().timeId;
    ui.setToast(`${tr('hud.timeOfDay')}: ${label('time', next)}${next === 'random' ? ` (${tr(`time.${now}`)})` : ''}`);
  }
  function changeLanguage(next) {
    if (!next || !LANGS.includes(next)) return;
    lang = next;
    writeKey(LANG_KEY, next);
    ui.setLanguage(next);
    input.setLabels(touchLabels());
    showRoad = '\u0000';                      // the road name is written again in the frame
  }
  /** The player's choice becomes the ceiling of the auto-step. 'auto' = the quality picked for this device. */
  function chooseQuality(id) {
    if (id === 'auto') { writeKey(QUALITY_KEY, ''); const next = autoQuality(); stepper.choose(next); applyQuality(next); return; }
    if (!QUALITY[id]) return;
    writeKey(QUALITY_KEY, id);
    stepper.choose(id);
    applyQuality(id);
  }
  function applyQuality(id) {
    qualityId = id;
    // the same object, changed in place: the views keep a reference to it
    Object.assign(quality, QUALITY[id]);
    quality.id = id;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    terrain.setMaterial(quality.cheapGround ? groundCheap : groundFull);
    // the ground paints the wood as its canopy beyond the reach of the trees: the radius follows the quality
    groundFull.uniforms.uTreeRadius.value = quality.treeRadius;
    groundCheap.uniforms.uTreeRadius.value = quality.treeRadius;
    camera.far = quality.far;
    camera.updateProjectionMatrix();
    resize();
  }
  function toggleFullscreen() {
    const doc = document, el = document.documentElement;
    const active = doc.fullscreenElement || doc.webkitFullscreenElement;
    const enter = el.requestFullscreen || el.webkitRequestFullscreen, leave = doc.exitFullscreen || doc.webkitExitFullscreen;
    const call = active ? leave : enter;
    if (!call) return;
    Promise.resolve(call.call(active ? doc : el)).catch((error) => console.warn('[luxdrive] fullscreen refused', error));
  }

  /** Puts the car back on the ground and warms the tiles under it, so that a jump never lands on a hole. */
  function landCar(x, z, yaw, hint) {
    ground.hint(hint);
    car.reset(x, z, yaw);
    ground.hint(car.state.y);
    chase.snap(car.state);
    terrain.buildAll(x, z);                    // every tile at once: the landing never sees a hole (one short hitch, on purpose)
    city.update(x, z);
    trees.update(x, z, elapsed, true);
    stuckFor = 0;
  }
  function resetCar() {
    landCar(startPose.x, startPose.z, startPose.yaw, startPose.hint);
    ui.setToast(tr('toast.reset'));
  }
  /** True when the car at this pose would touch a house, a tunnel portal, a tree or the edge of the area (at the level it is put down on with `hint`; without one at
   *  every height). */
  function blockedAt(x, z, yaw, hint = NaN) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const level = Number.isFinite(hint) ? ground.levelAt(x, z, hint) : NaN;
    return CAR.bodyCircles.concat(0).some((o) => !!collide(x + cy * o, z + sy * o, CAR.bodyRadius + PLACE_MARGIN_M, level));
  }
  const placeAt = (hit) => placeClear(roadIndex, hit, car.state.heading, (x, z) => surface.height(x, z), blockedAt);
  // the start and the reset follow the same rule as a tap on the Kaart: a CAR road (never the plaza beside it), clear of everything
  const startHit = roadIndex.nearest(start.x, start.z, START_REACH_M);
  const startPose = startHit
    ? (() => { const p = placeClear(roadIndex, startHit, start.yaw || 0, (x, z) => surface.height(x, z), blockedAt); return { x: p.x, z: p.z, yaw: p.yaw, hint: p.hint }; })()
    : { x: start.x, z: start.z, yaw: start.yaw || 0, hint: 1e9 };
  /** A tap on the Kaart: the car stands on that road, in the right-hand lane, facing along the road - and clear of everything. */
  function teleportTo(hit) {
    const p = placeAt(hit);
    landCar(p.x, p.z, p.yaw, p.hint);
    fullMap.setCar(car.state);
    ui.setToast(tr('map.teleport', { name: p.road.name || tr('map.unnamed') }));
    closeMap();
  }
  /** The car pushes against something and does not move: back onto the nearest road. */
  function unstick() {
    const hit = roadIndex.nearest(car.state.x, car.state.z, TELEPORT_REACH_M);
    if (!hit) { stuckFor = 0; return; }
    const p = placeAt(hit);
    landCar(p.x, p.z, p.yaw, p.hint);
    ui.setToast(tr('toast.unstuck'));
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // the settings of the menu follow the stored choices
  const choice = env.getChoice();
  ui.setValue('weather', choice.weatherMode);
  ui.setValue('time', choice.timeMode);
  ui.setValue('quality', readKey(QUALITY_KEY) || 'auto');
  ui.setValue('colour', colourId);
  ui.setValue('sound', sound.muted ? 'off' : 'on');
  ui.setValue('camera', CAMERA_IDS[0]);
  ui.setChooserIcon(WEATHER_ICON[choice.weatherId] || '⛅');

  // ---- the loop
  const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
  const lights = { head: 0, night: 0 };
  let frozenCamera = null;              // the harness can hold the camera at a pose of its own
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(MAX_FRAME_S, Math.max(0.0005, (now - last) / 1000));
    last = now;
    elapsed += dt;
    frames += 1;

    // the start menu, the pause menu, the settings and the map stop the car (the world keeps drawing behind them)
    const paused = ui.isBlocking();
    const inp = input.read(scripted);
    ground.hint(car.state.y);
    if (!paused) car.update(dt, { ...inp, gripScale: env.gripScale() });

    // a hard hit on a building or a tree: a short "Hoppla!"
    if (car.state.crashed && !wasCrashed) ui.setToast(tr('hud.crash'), 1.2);
    wasCrashed = car.state.crashed;

    // stuck against something: the pedal is down, the car does not move
    if (!paused && (inp.throttle > 0.5 || inp.brake > 0.5) && Math.abs(car.state.speed) < STUCK_SPEED) stuckFor += dt; else stuckFor = 0;
    if (stuckFor > STUCK_SECONDS) unstick();

    sound.update(dt, car.state, inp, env.state.rain, !paused);

    // the camera
    const c = frozenCamera || chase.update(car.state, dt, camMode, elapsed);
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(camera.fov - c.fov) > 0.05) { camera.fov = c.fov; camera.updateProjectionMatrix(); }

    // the car and its lights
    lights.head = env.state.lamp; lights.night = env.state.night;
    model.apply(car.state, dt, lights);
    model.headlight(car.state, lampPos, lampDir);
    env.setLamp(lampPos, lampDir);

    // the world
    env.update(dt, camera, elapsed);
    env.setFogBase(ground.height(c.x, c.z));
    // the world follows the camera when the harness holds it (the hole detector walks the camera over the map)
    // The tiles AND the houses follow the same point: the car, or the camera when the harness holds it elsewhere.  The city
    // used to follow the car alone, so a camera held in another quarter saw houses with the cheap far material (their cell was
    // far from the CAR) or no houses at all (beyond the reach of the quality level, measured from the car).
    const focusX = frozenCamera ? camera.position.x : car.state.x, focusZ = frozenCamera ? camera.position.z : car.state.z;
    terrain.update(focusX, focusZ);
    city.update(focusX, focusZ);
    decks.update(camera.position.x, camera.position.z, quality.buildingFarRadius * BUILT_DRAW_FACTOR);
    deckMarks.update(camera.position.x, camera.position.z, DECK_MARK_RADIUS);
    walls.update(camera.position.x, camera.position.z, quality.buildingFarRadius * WALL_DRAW_FACTOR);
    portalView.update(camera.position.x, camera.position.z, quality.buildingFarRadius * BUILT_DRAW_FACTOR);
    tunnelView.update(camera.position.x, camera.position.z, quality.buildingFarRadius * BUILT_DRAW_FACTOR);
    tubeMask.update(camera.position.x, camera.position.z);
    trees.update(camera.position.x, camera.position.z, elapsed);
    tramSim.setObstacle(car.state.x, car.state.z);
    trams.update(dt, camera.position.x, camera.position.z);
    streetLights.update(camera.position.x, camera.position.z);
    benchView.update(camera.position.x, camera.position.z);

    // the interface
    surface.roadInfoAt(car.state.x, car.state.z, roadInfo);
    const road = roadInfo.coverage > 0.35 && roadInfo.road >= 0 ? data.roads[roadInfo.road] : null;
    ui.setSpeed(Math.abs(car.state.speed) * 3.6);
    if (frames % 10 === 0) ui.setRain(env.state.rain);
    const tubeName = tubes.network.nameAt(car.state.x, car.state.z, car.state.y - CAR.rideHeight);      // (in a tunnel: its name, not the street over it)
    const roadName = tubeName !== null ? tubeName : road && road.name ? road.name : '';
    if (roadName !== showRoad) { showRoad = roadName; ui.setRoad(roadName); }
    if (frames % 6 === 0) minimap.draw(car.state.x, car.state.z, car.state.heading);
    if (fullMap.isOpen()) fullMap.setCar(car.state);

    // the quality auto-step: a slow game steps down (never above the choice of the player), a long fast stretch may step back up
    const stepped = stepper.frame(dt);
    if (stepped) {
      applyQuality(stepped);
      ui.setToast(tr('toast.quality', { q: tr(`quality.${stepped}`) }));
    }

    renderer.render(scene, camera);
    // the loading screen goes away once the first tiles around the car are there
    if (!loadingDone && (terrain.tiles.size > 0 || elapsed > 6)) {
      loadingDone = true;
      loader.done();
      ui.showHud();
      document.documentElement.dataset.luxReady = '1';
    }
  }

  // the game is ready: the first frames build the tiles around the car
  landCar(startPose.x, startPose.z, startPose.yaw, startPose.hint);       // the first pose: on a car road beside the start place
  trees.update(car.state.x, car.state.z, 0, true);       // the first forest is built at once, behind the loading screen
  ui.showStart(true);
  syncPlayState();
  requestAnimationFrame(frame);

  // the API for the harness (the checks read the state of the game from here)
  window.__lux = {
    tubes, tunnelView, tubeMask, landmarks, landmarkView, trams, tramSim, tramNetwork, streetLights, benchView, scene, camera, renderer, car, env, terrain, city, trees, surface, ground, field, portals, playArea, buildings, markPlan, quality: () => quality,
    ui, fullMap, roadIndex, sound, stepper, model, input, forest, collide, placeAt, blockedAt,
    /** The Kaart and the teleport for the flows: open the map, put the car on the road nearest to (x, z). */
    toggleMap: () => toggleMap(), startDriving: () => startDriving(), isStarted: () => started,
    teleportNear: (x, z, reach = 200) => { const hit = roadIndex.nearest(x, z, reach); if (hit) teleportTo(hit); return !!hit; },
    state: () => car.state,
    /** The game clock in seconds (the frames are capped at 0.1 s): the flows count their loops in game time, not in frames. */
    clock: () => elapsed,
    setInput: (o) => { scripted = o; },
    /** The harness can hold the camera at a pose of its own (null gives it back to the chase camera). */
    setCamera: (pose) => {
      frozenCamera = pose ? { x: pose.x, y: pose.y, z: pose.z, tx: pose.tx, ty: pose.ty, tz: pose.tz, fov: pose.fov || 70 } : null;
      if (!frozenCamera) chase.snap(car.state);
    },
    /** The road under a point: its name, its class, its material, how far the point is to the right of its centre
     *  line and the direction of the way there (the flow asks where the car stands). */
    roadAt: (x, z) => {
      surface.roadInfoAt(x, z, roadInfo);
      const r = roadInfo.road >= 0 ? data.roads[roadInfo.road] : null;
      if (!r) return null;
      const dir = roadDirectionAt(r, x, z);
      return {
        name: r.name, kind: r.kind, surface: r.surface, width: r.width, oneway: r.oneway,
        lat: roadInfo.lat, dir: dir ? { x: dir.x, z: dir.z } : null,
      };
    },
    step: (dt, o) => car.update(dt, { ...(o || {}), gripScale: env.gripScale() }),
    stats: () => ({
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      tiles: terrain.tiles.size, pending: terrain.stats.pending,
      cells: city.stats.visible, cityPending: city.stats.pending,
      trees: trees.stats.trees,
    }),
  };
}

boot().catch((error) => {
  console.error('[luxdrive]', error);
  document.documentElement.dataset.bootError = error.message || 'boot failed';
  const loader = window.__luxLoad;
  if (loader) loader.fail(error.message || String(error));
});
