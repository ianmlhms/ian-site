/* Lux Drive: the entry point. Loads the baked world, builds the scene and runs the loop.
 *
 * The order of the work: the data (the terrain, the roads, the decks, the buildings), then the pure world (the height
 * function, the physics surface, the play area), then the painted textures and the sky, then the views (the terrain tiles,
 * the bridge decks, the car), and finally the loop.
 *
 * The loading screen shows the real progress (the loader API of the page) and the tiles around the car are built while the
 * first frames run, so the game starts quickly. */
import { QUALITY, WORLD } from './config.js';
import { loadWorldData } from './world-data.js';
import { createHeightField } from './heightfield.js';
import { createSurface } from './surface.js';
import { createDeckNetwork, createGround } from './decks.js';
import { createBuildingIndex } from './buildings.js';
import { createTreeIndex } from './trees.js';
import { createTreeView } from './tree-view.js';
import { createPortals } from './portals.js';
import { createPlayArea } from './play-area.js';
import { buildWorldMap } from './world-map.js';
import { createPaintTextures } from './paint-textures.js';
import { createGroundMaterial } from './ground-shader.js';
import { createTerrainView } from './terrain-view.js';
import { createBuildingView } from './building-view.js';
import { createDeckView } from './deck-view.js';
import { createPortalView } from './portal-view.js';
import { createSolidMaterial } from './solid-material.js';
import { createEnv, TIME_PRESETS, WEATHER_IDS } from './env.js';
import { createChaseCamera } from './camera.js';
import { createCar } from './car.js';
import { createCarModel } from './car-model.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createMinimap } from './minimap.js';
import { t, LANGS } from './i18n.js';

const MAX_FRAME_S = 0.1;              // s: a long frame (a tab in the background) never jumps the car
const LANG_KEY = 'pb_luxdrive_lang';
const QUALITY_KEY = 'pb_luxdrive_quality';
const TIME_IDS = Object.keys(TIME_PRESETS);
const WEATHER_CYCLE = ['random', ...WEATHER_IDS];
const TIME_CYCLE = ['random', ...TIME_IDS];

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
  const lang = pickLang();
  document.documentElement.lang = lang;
  const tr = (key, params) => t(lang, key, params);
  const setLoad = (p, key) => loader.set(p, key ? tr(key) : '');

  // ---- the quality
  let qualityId = param('q') && QUALITY[param('q')] ? param('q') : (QUALITY[readKey(QUALITY_KEY)] ? readKey(QUALITY_KEY) : autoQuality());
  let quality = { ...QUALITY[qualityId], id: qualityId };

  // ---- the renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityId === 'high', powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;         // the whole game shades in display space (the painted look)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setClearColor(0x9ab6c8, 1);
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
  const field = createHeightField({ near: data.near, far: data.far, roads: data.roads });
  const surface = createSurface(field);
  const deckNetwork = createDeckNetwork(data.decks);
  const ground = createGround(surface, deckNetwork);
  const buildings = createBuildingIndex(data.buildings);
  const portals = createPortals(data.roads);
  const playArea = createPlayArea(area);
  const maps = buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy });
  // the trees: the woods (placed from the canopy) and the trees of OSM (the street trees, the trees of the parks)
  const forest = createTreeIndex({ map: maps, field, network: field.network, buildings, trees: data.trees });

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
  const worldMaps = { class: mapTexture(maps.cover, maps.nx, maps.nz), canopy: mapTexture(maps.canopy, maps.canopyNx, maps.canopyNz) };
  const env = createEnv({
    noiseTexture: textures.noise,
    params: { time: param('time') || undefined, weather: param('weather') || undefined },
  });
  env.uniforms.uSkyPaint.value = textures.sky;                      // the painted cloud tile (the noise texture made coloured specks)
  scene.add(env.sky);
  const groundFull = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, false, quality.treeRadius);
  const groundCheap = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, true, quality.treeRadius);

  // ---- the views
  setLoad(0.82, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const solid = createSolidMaterial(env);
  const terrain = createTerrainView({ scene, surface, field, material: quality.cheapGround ? groundCheap : groundFull, quality });
  const city = createBuildingView({ scene, buildings, field, env, noiseTexture: textures.noise, quality });
  const trees = createTreeView({ scene, forest, baked: data.trees, field, env, quality });
  const decks = createDeckView({ scene, decks: data.decks, material: solid, ground: ground.surface });
  const portalView = createPortalView({ scene, portals, ground, material: solid });
  const model = createCarModel({ colourId: 'red', material: solid });
  scene.add(model.group);

  // ---- the car, the camera, the interface
  const start = data.places.start || { x: WORLD.width / 2, z: WORLD.depth / 2, yaw: 0 };
  const roadInfo = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0 };
  const collide = (x, z, radius) => buildings.collide(x, z, radius) || portals.collide(x, z, radius) || forest.collide(x, z, radius) || playArea.collide(x, z, radius);
  const car = createCar({ ground, roadInfoAt: (x, z, out) => surface.roadInfoAt(x, z, out), collide, start });
  const chase = createChaseCamera(ground, (x, z, radius) => buildings.collide(x, z, radius));

  const ui = createUI({ root: document.body, lang, onAction: handleAction });
  const minimap = createMinimap({ canvas: ui.minimap, roads: data.roads, area });
  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
  const input = createInput({ root: document.body, onAction: handleAction, labels: { throttle: tr('touch.throttle'), brake: tr('touch.brake'), handbrake: tr('touch.handbrake') } });
  input.showTouchUi(isTouch);

  // ---- the state of the game
  let camMode = 0;
  let running = true;
  let last = performance.now();
  let elapsed = 0;
  let frames = 0;
  let slowTime = 0;
  let showRoad = '';
  let scripted = null;
  let loadingDone = false;

  function handleAction(action, value) {
    switch (action) {
      case 'menu': ui.showMenu(!ui.isMenuOpen()); break;
      case 'drive': ui.showMenu(false); break;
      case 'close': ui.showMenu(false); break;
      case 'closeHelp': ui.showHelp(false); break;
      case 'help': ui.showHelp(true); break;
      case 'camera': camMode = (camMode + 1) % 3; break;
      case 'reset': resetCar(); break;
      case 'weather': cycleWeather(); break;
      case 'time': cycleTime(); break;
      case 'language':
        if (value && LANGS.includes(value)) { writeKey(LANG_KEY, value); location.reload(); }
        break;
      case 'quality':
        if (value === 'auto') { writeKey(QUALITY_KEY, ''); applyQuality(autoQuality()); }
        else if (QUALITY[value]) { writeKey(QUALITY_KEY, value); applyQuality(value); }
        break;
      default: break;
    }
  }
  function cycleWeather() {
    const current = env.getChoice().weatherMode;
    const next = WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(current) + 1) % WEATHER_CYCLE.length];
    env.setWeather(next);
    ui.setWeatherValue(next);
    ui.setToast(`${tr('hud.weather')}: ${next === 'random' ? tr('set.random') : tr(`weather.${next}`)}`);
  }
  function cycleTime() {
    const current = env.getChoice().timeMode;
    const next = TIME_CYCLE[(TIME_CYCLE.indexOf(current) + 1) % TIME_CYCLE.length];
    env.setTime(next);
    ui.setTimeValue(next);
    ui.setToast(`${tr('hud.timeOfDay')}: ${next === 'random' ? tr('set.random') : tr(`time.${next}`)}`);
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
  function resetCar() {
    car.reset(start.x, start.z, start.yaw || 0);
    chase.snap(car.state);
    ui.setToast(tr('toast.reset'));
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
  ui.setWeatherValue(choice.weatherMode);
  ui.setTimeValue(choice.timeMode);
  ui.setQualityValue(readKey(QUALITY_KEY) || 'auto');

  // ---- the loop
  const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
  let frozenCamera = null;              // the harness can hold the camera at a pose of its own
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(MAX_FRAME_S, Math.max(0.0005, (now - last) / 1000));
    last = now;
    elapsed += dt;
    frames += 1;

    const inp = input.read(scripted);
    ground.hint(car.state.y);
    car.update(dt, { ...inp, gripScale: env.gripScale() });

    // the camera
    const c = frozenCamera || chase.update(car.state, dt, camMode, elapsed);
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(camera.fov - c.fov) > 0.05) { camera.fov = c.fov; camera.updateProjectionMatrix(); }

    // the car and its headlight
    model.apply(car.state, dt);
    model.headlight(car.state, lampPos, lampDir);
    env.setLamp(lampPos, lampDir);

    // the world
    env.update(dt, camera, elapsed);
    env.setFogBase(ground.height(c.x, c.z));
    terrain.update(car.state.x, car.state.z);
    city.update(car.state.x, car.state.z);
    trees.update(camera.position.x, camera.position.z, elapsed);

    // the interface
    ui.setSpeed(Math.abs(car.state.speed) * 3.6, car.state.gear);
    surface.roadInfoAt(car.state.x, car.state.z, roadInfo);
    const road = roadInfo.road >= 0 ? data.roads[roadInfo.road] : null;
    const roadName = road && road.name ? road.name : '';
    if (roadName !== showRoad) { showRoad = roadName; ui.setRoad(roadName); }
    if (frames % 6 === 0) minimap.draw(car.state.x, car.state.z, car.state.heading);

    // the quality auto-step: a slow game steps the quality down (never up: that would oscillate)
    if (dt > 0.034) slowTime += dt; else slowTime = Math.max(0, slowTime - dt * 0.5);
    if (slowTime > 4 && qualityId !== 'low') {
      slowTime = 0;
      applyQuality(qualityId === 'high' ? 'medium' : 'low');
      ui.setToast(`${tr('hud.quality')}: ${tr(`quality.${qualityId}`)}`);
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
  chase.snap(car.state);
  trees.update(car.state.x, car.state.z, 0, true);       // the first forest is built at once, behind the loading screen
  ui.showMenu(true);
  requestAnimationFrame(frame);

  // the API for the harness (the checks read the state of the game from here)
  window.__lux = {
    scene, camera, renderer, car, env, terrain, city, trees, surface, ground, field, portals, playArea, buildings, quality: () => quality,
    state: () => car.state,
    setInput: (o) => { scripted = o; },
    /** The harness can hold the camera at a pose of its own (null gives it back to the chase camera). */
    setCamera: (pose) => {
      frozenCamera = pose ? { x: pose.x, y: pose.y, z: pose.z, tx: pose.tx, ty: pose.ty, tz: pose.tz, fov: pose.fov || 70 } : null;
      if (!frozenCamera) chase.snap(car.state);
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
