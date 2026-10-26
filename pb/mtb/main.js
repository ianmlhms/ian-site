/* MTB Mëllerdall W3: boots the world and runs the game: the start card, 3-2-1-Go, the timed run with checkpoints and a ghost, the finish screen with medals and unlocks, free ride, the
 * daily challenge, the menu, the saves and the scores, the sound. The world itself (terrain, forest, rocks, water, sky) is the W2 world.
 *   loading bar -> data -> height field + physics surface + decks -> painted textures -> env -> terrain tiles + forest -> props -> start card of the first trail
 * ?q=low|medium|high  ?time=dawn|morning|noon|evening|dusk|night  ?weather=clear|cloudy|fog|rain  ?season=summer|autumn  ?trail=<id>  ?mode=free|run|card  ?autostart=1 (no card, no countdown)
 * ?at=<centre index>  ?debug=1 (window.__mtb)  ?holes=1 (hole detector mode)
 * The page is also loaded as a srcdoc iframe by the arcade, so every URL here is built from import.meta.url or is absolute. */
import { WORLD, QUALITY, BIKES, PLAY } from './config.js';
import { loadWorldData } from './world-data.js';
import { createBikeState, advanceBike, speedKmh } from './bike.js';
import { createChaseCamera } from './camera.js';
import { createPaintTextures } from './paint-textures.js';
import { createEnv, TIME_PRESETS, WEATHER_IDS, SEASON_IDS } from './env.js';
import { createGroundMaterial } from './ground-shader.js';
import { buildPlayWorld, stateAt } from './play-world.js';
import { createRockView } from './rock-view.js';
import { createWaterView } from './water-view.js';
import { createRain, createLeaves, createShafts, createBirds, createInsects } from './effects.js';
import { createHikers } from './hikers.js';
import { createDust, createSpeedLines } from './speed-fx.js';
import { SCHIESSENTUEMPEL } from './landmarks.js';
import { buildBridge } from './bridge-model.js';
import { buildCascadeModel } from './cascade-model.js';
import { createTownView } from './town-view.js';
import { finishFov } from './cascade.js';
import { RUIN, CHURCH } from './town-data.js';
import { createSolidMaterial } from './solid-material.js';
import { createTerrainView } from './terrain-view.js';
import { createForestView } from './forest-view.js';
import { createRider, COLOUR_HEX, HELMET_HEX } from './rider.js';
import { createInput } from './input.js';
import { createProps } from './props.js';
import { findAllJunctions } from './junctions.js';
import { createGame, poseOnTrail, minRunMs, MEDAL_NAME } from './game.js';
import { createUi } from './ui.js';
import { createMapBackdrop } from './map-paint.js';
import { createAudio } from './audio.js';
import { encodeGhost, decodeGhost, ghostAt } from './ghost.js';
import {
  TRAIL_IDS, BIKE_IDS, BIKE_MEDAL_POINTS, medalPoints, medalOf, bestMs, bestSplits, ghostFor, isTrailUnlocked, isBikeUnlocked, newUnlocks, recordRun, recordViewpoint, recordDaily, addStats,
  withLoadout, withSettings, settingsOf, viewpointCount, dayNumber, dailyChallenge, createProgress, hasViewpoint, unlockedTrails, MAX_VIEWPOINTS,
} from './progress.js';
import { loadInitialProgress, createPersistence, createScoreReporter, dailyRpc } from './save.js';
import { LANGS, t as translate, trailName, formatTime } from './i18n.js';

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const LANG_KEY = 'pb_mtb_lang';
const QUALITY_KEY = 'pb_mtb_quality';
const LAST_KEY = 'pb_mtb_last';
const FRAME_BUDGET_MS = { low: 40, medium: 30, high: 24 };
const ADAPT_WINDOW_S = 3;
const MAX_FRAME_S = 0.05;
const HINT_RIDES = 3;               // the animated hint shows for the first rides
const HINT_SECONDS = 16;
const WET_OF = { clear: 0, cloudy: 0.1, fog: 0.25, rain: 1 };
const AUDIO_SURFACE = { dirt: 'dirt', track: 'dirt', road: 'road', rock: 'rock', roots: 'roots', mud: 'mud', leaves: 'leaves', forest: 'leaves', wood: 'wood', grass: 'grass', water: 'water' };
const HUD_EVERY = 0.1;
const WRONGWAY_DIST = 15;      // m off the trail centre line (in a timed run) before the "Falsche Wee!" hint shows
const VIEWPOINT_KINDS = ['viewpoint', 'attraction', 'cave_entrance', 'wayside_cross', 'archaeological_site', 'spring'];
const VIEWPOINT_MIN_GAP = 70;
const DAILY_TRAILS = TRAIL_IDS.filter((id) => id !== 'maratoun');
const FIRST_TRAIL = TRAIL_IDS[0];
const REPLAY_SECONDS_MAX = 60;
const CARD_SHIFT = 0.2;           // share of the screen height the picture is lifted by while the start card is up

function param(name) {
  try { const own = new URLSearchParams(location.search).get(name); if (own !== null) return own; } catch (error) { /* ignore */ }
  try { if (window.parent !== window) return new URLSearchParams(window.parent.location.search).get(name); } catch (error) { /* cross-origin parent */ }
  return null;
}
const readKey = (key) => { try { return localStorage.getItem(key); } catch (error) { console.warn('[mtb] storage blocked', error); return null; } };
const writeKey = (key, value) => { try { localStorage.setItem(key, value); } catch (error) { console.warn('[mtb] storage blocked', error); } };

function pickLang(progress) {
  const own = readKey(LANG_KEY);
  if (LANGS.includes(own)) return own;
  const saved = progress && settingsOf(progress).lang;
  const site = readKey('site_lang');
  if (LANGS.includes(site)) return site;
  return LANGS.includes(saved) && readKey('pb_mtb_save') ? saved : 'lb';
}

function autoQuality() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const ipadDesktopUa = navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || navigator.userAgent || '');       // an iPad that says "Macintosh" (desktop mode of Safari)
  if (coarse || ipadDesktopUa) return 'low';                              // every touch device (iPads of the school first): the low setting, the player can raise it in the menu
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  return weak ? 'medium' : 'high';
}
function pickQuality() {
  const q = param('q');
  if (q && QUALITY[q]) return q;
  const stored = readKey(QUALITY_KEY);
  if (QUALITY[stored]) return stored;
  return autoQuality();
}

const reader = (base) => async (name) => {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

async function boot() {
  let progress = loadInitialProgress() || createProgress();
  let lang = pickLang(progress);
  document.documentElement.lang = lang;
  const tr = (key, params) => translate(lang, key, params);
  const loader = window.__mtbLoad || { set() {}, done() {}, fail() {} };
  const setLoad = (p, key) => loader.set(p, key ? tr(key) : '');
  const canvas = $('mtbCanvas');
  const shell = $('shell');
  const qualityId = pickQuality();
  const quality = { ...QUALITY[qualityId], id: qualityId };
  const holeMode = param('holes') === '1';
  const debug = param('debug') === '1' || holeMode;
  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  document.body.classList.toggle('touch', isTouch);

  setLoad(0.04, 'load.terrain');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityId === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: debug });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;          // the whole game shades in display space (painted look)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setClearColor(holeMode ? 0xff00ff : 0x9ab6c8, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, quality.far);
  scene.add(camera);

  // ---- data and the pure world
  const data = await loadWorldData(reader(new URL('./data/', import.meta.url)), (p, what) => setLoad(0.08 + 0.52 * p, `load.${what}`));
  setLoad(0.62, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const world = buildPlayWorld(data);
  const { field, surface, ground, groundAt, maps, trees, undergrowth, rocks, decks } = world;
  const trails = world.trails;
  const trailById = world.trailById;

  // ---- painted textures, world maps, env
  setLoad(0.7, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const textures = createPaintTextures(renderer, qualityId);
  await textures.ready;                                             // the painted set (data/tex) replaces the canvas fallbacks before the first frame
  const mapTexture = (arr, filter = THREE.LinearFilter) => { const tex = new THREE.DataTexture(arr, maps.nx, maps.nz, THREE.RGBAFormat); tex.magFilter = filter; tex.minFilter = filter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true; return tex; };
  const worldMaps = { cover: mapTexture(maps.cover), canopy: mapTexture(maps.canopy), field: mapTexture(maps.field, THREE.NearestFilter) };
  const saved0 = settingsOf(progress);
  const envParams = { time: param('time') || (readKey('pb_mtb_time') ? null : saved0.time !== 'random' ? saved0.time : null), weather: param('weather') || (readKey('pb_mtb_weather') ? null : saved0.weather !== 'random' ? saved0.weather : null), season: param('season') };
  const env = createEnv({ noiseTexture: textures.noise, params: envParams });
  env.uniforms.uSkyPaint.value = textures.sky;                      // the painted cloud tile
  if (holeMode) env.sky.visible = false;
  scene.add(env.sky);
  const groundFull = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, false);
  const groundCheap = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, true);
  const groundFor = (q) => (q.cheapGround ? groundCheap : groundFull);
  for (const m of [groundFull, groundCheap]) m.uniforms.uTreeRadius.value = quality.treeRadius;

  // ---- world views
  const terrain = createTerrainView({ scene, surface, field, material: groundFor(quality), quality });
  const forest = createForestView({ scene, trees, undergrowth, env, quality, textures, meadow: { map: maps, surface, clearance: world.clearance } });
  const rockView = createRockView({ scene, rocks, env, quality, textures });
  const bridge = world.bridge;
  if (bridge) {
    const parts = buildBridge({ span: bridge.span, width: bridge.width, abutment: bridge.abutment, rise: bridge.rise, deck: bridge.deck - bridge.water, endL: bridge.endL - bridge.water, endR: bridge.endR - bridge.water });
    rockView.addLandmark(parts.stone, bridge.x, bridge.water, bridge.z, bridge.yaw, 1.0, 2.0, 24);
    const wood = new THREE.Mesh(parts.wood, createSolidMaterial(env));
    wood.position.set(bridge.x, bridge.water, bridge.z); wood.rotation.y = bridge.yaw; wood.frustumCulled = false; wood.name = 'footbridge railing';
    scene.add(wood);
  }
  if (world.cascade) {                                                  // the Schiessentuempel ledge: sandstone solid with mossy boulders, stones in the pool (the falls and the water are water-view's)
    const c = world.cascade, parts = buildCascadeModel(c, surface, field.network);
    rockView.addLandmark(parts.ledge, c.x, c.lipY, c.z, c.yaw, 0.6, 3.4, 30);
    rockView.addLandmark(parts.stones, c.x, c.lipY, c.z, c.yaw, 0.5, 3.7, 40);
  }
  const water = createWaterView({ scene, network: field.network, env, quality, foamTexture: textures.foam, cascade: world.cascade });
  const town = createTownView({ scene, env, quality, houses: world.houses });
  const junctions = findAllJunctions(field.network);
  const props = createProps({ scene, env, surface, trails, decks, junctions });
  const riderLook = () => { const s = settingsOf(progress); void s; return { bike: progress.bk || 'hardtail', frame: COLOUR_HEX[progress.col] || COLOUR_HEX.red, helmet: HELMET_HEX[progress.hm] || HELMET_HEX.plain }; };
  let rider = createRider(env, riderLook());
  scene.add(rider.root);
  const ghostRider = createRider(env, { bike: 'trail', frame: '#9fd6ff', jersey: '#9fd6ff', helmet: '#ffffff', ghost: true });
  ghostRider.root.visible = false;
  scene.add(ghostRider.root);
  const rain = createRain({ scene, env, quality }), leaves = createLeaves({ scene, env, quality }), shafts = createShafts({ scene, env, quality, surface, map: maps });
  const dust = createDust({ scene, env, quality });
  const speedLines = createSpeedLines(shell, { low: quality.id === 'low' });
  const birds = createBirds({ scene, env, quality }), insects = createInsects({ scene, env, quality, surface, map: maps, clearance: world.clearance });
  const hikers = createHikers({ scene, env, surface, paths: world.ways.filter((w) => w.kind === 'path') });

  // ---- viewpoints (free ride collectibles): the real viewpoints and landmarks inside the playable box
  const lo = WORLD.playInset + 12;
  const viewpoints = [];
  const fall = { x: SCHIESSENTUEMPEL.x, z: SCHIESSENTUEMPEL.z };
  for (const l of data.landmarks) {
    if (!VIEWPOINT_KINDS.includes(l.kind) || l.x < lo || l.z < lo || l.x > WORLD.width - lo || l.z > WORLD.depth - lo) continue;
    if (viewpoints.some((v) => Math.hypot(v.x - l.x, v.z - l.z) < VIEWPOINT_MIN_GAP)) continue;
    viewpoints.push({ x: l.x, z: l.z, name: l.name || '', kind: l.kind });
    if (viewpoints.length >= 60) break;
  }
  for (const v of viewpoints) if (Math.hypot(v.x - fall.x, v.z - fall.z) < 60) v.name = tr('vp.falls');
  viewpoints.forEach((v) => { v.name = v.name || tr('vp.unnamed'); });
  if (!viewpoints.some((v) => Math.hypot(v.x - fall.x, v.z - fall.z) < 60) && viewpoints.length < 60) viewpoints.push({ x: fall.x - 14, z: fall.z + 10, name: tr('vp.falls'), kind: 'attraction' });
  // two more collectibles at the new landmarks: a spot with a view of the Beaufort castle ruin and one at the Berdorf church (an open, flat place near, away from every house)
  const viewSpot = (name, tx, tz, ring) => {
    for (let a = 0; a < 360; a += 20) {
      const x = tx + Math.cos(a * Math.PI / 180) * ring, z = tz + Math.sin(a * Math.PI / 180) * ring;
      surface.normal(x, z, vpNormal);
      if (!world.town.insideRect(x, z, 4) && vpNormal.y > 0.88 && viewpoints.length < MAX_VIEWPOINTS) { viewpoints.push({ x, z, name, kind: 'attraction' }); return; }
    }
  };
  const vpNormal = { x: 0, y: 1, z: 0 };
  if (world.town.houses.length) {
    const ruin = world.houses.find((h) => h.flags & RUIN), church = world.houses.find((h) => h.flags & CHURCH && h.cx > 3000);
    if (ruin) viewSpot(tr('vp.castle'), ruin.cx, ruin.cz, 30);
    if (church) viewSpot(tr('vp.village'), church.cx, church.cz, 24);
  }
  const villages = data.landmarks.filter((l) => l.kind === 'village' && l.name && l.x > 0 && l.z > 0 && l.x < WORLD.width && l.z < WORLD.depth).map((l) => ({ name: l.name, x: l.x, z: l.z }));
  const mapState = { backdrop: createMapBackdrop(data), villages, viewpoints, found: new Set(), rider: null };

  // ---- game, ui, sound, saves
  const game = createGame();
  const audio = createAudio({ win: window });
  const reporter = createScoreReporter({ arcade: window.Arcade, trailName: (id) => trailName(trailById.get(id), lang), minMsFor: (id) => (trailById.has(id) ? minRunMs(trailById.get(id)) : 0) });
  const rpc = dailyRpc();
  const hit = { nx: 0, nz: 0, pen: 0 };
  let bikeY = 0;
  const physicsEnv = { bike: BIKES[progress.bk] || BIKES.hardtail, wet: 0, shield: 0, collide: (x, z, r) => world.collide(x, z, r, bikeY, hit) };
  let bike = createBikeState(0, 0, 0, ground);
  const crownPush = { dx: 0, dy: 0, dz: 0 }, camRock = { nx: 0, nz: 0, pen: 0 }, camHit = { nx: 0, nz: 0, pen: 0 };
  const trunkOrRock = (x, z, r) => { const a = trees.collide(x, z, r, camHit); const b = rocks.collide(x, z, r, -1e9, camRock); if (b && (!a || b.pen > a.pen)) { camHit.nx = b.nx; camHit.nz = b.nz; camHit.pen = b.pen; return camHit; } return a; };
  const chase = createChaseCamera(surface, trunkOrRock, (x, y, z, r) => trees.pushOutOfCrowns(x, y, z, r, crownPush));
  let camMode = 0, focusBlend = 0;
  const persistence = createPersistence({ getState: () => progress, onState: (p) => { progress = p; applyLoadout(); refreshMenu(); }, onError: (message) => console.warn('[mtb] save', message), publishOverall: false });
  const save = (next) => { progress = next; persistence.scheduleSave(); };

  let current = { trail: null, kind: 'trail', dailyInfo: null };
  let ghostData = null, replay = null, hintLeft = 0, rides = 0;
  let lastSafe = { x: 0, z: 0, heading: 0, t: 0 };
  let scriptedInput = null, frozenCamera = null;

  const handlers = {
    onStart: () => startRun(),
    onMenu: (tab) => openMenu(tab),
    onCloseMenu: () => closeMenu(),
    onFree: () => startFree(),
    onDaily: () => startDaily(),
    onReset: () => { if (game.mode === 'run' || game.mode === 'free') { game.reset(); applyEvents(game.update(0, bike, {})); } },
    onCamera: () => { camMode = (camMode + 1) % 3; chase.snap(bike); },
    onTime: () => cycleTime(),
    onWeather: () => cycleWeather(),
    onSound: () => toggleSound(),
    onAgain: () => enterCard(current.trail.id, current.kind),
    onNext: () => { const i = TRAIL_IDS.indexOf(current.trail.id); const next = TRAIL_IDS[(i + 1) % TRAIL_IDS.length]; enterCard(isTrailUnlocked(progress, next) ? next : current.trail.id); },
    onReplay: () => startReplay(),
    onPickTrail: (id) => { closeMenu(); enterCard(id); },
    onPickBike: (id) => { save(withLoadout(progress, { bk: id })); applyLoadout(); refreshMenu(); },
    onSetting: (key, value) => applySetting(key, value),
    onBoard: (which) => openBoard(which),
  };
  const ui = createUi({ root: shell, lang, trails: trails.map((t) => ({ id: t.id })), handlers, touch: isTouch });
  const input = createInput({ root: shell, onAction: (a, e) => onAction(a, e), labels: { pedal: tr('touch.pedal'), brake: tr('touch.brake'), jump: tr('touch.jump') } });

  // ---- helpers
  function wetNow() { if (current.kind === 'daily' && current.dailyInfo) return WET_OF[current.dailyInfo.weather] || 0; return WET_OF[env.state.weatherId] || 0; }
  function applyLoadout() {
    physicsEnv.bike = BIKES[progress.bk] || BIKES.hardtail;
    const old = rider; scene.remove(old.root); old.dispose();
    rider = createRider(env, riderLook());
    scene.add(rider.root);
  }
  function unlockText(trailId) { const i = TRAIL_IDS.indexOf(trailId); return i <= 0 ? '' : tr('card.unlockBy', { trail: trailName(trailById.get(TRAIL_IDS[i - 1]), lang) }); }
  const trailPoints = () => medalPoints(progress);
  function dailyToday() {
    const c = dailyChallenge(dayNumber(), DAILY_TRAILS);
    const st = progress.dy && progress.dy[0] === dayNumber() ? progress.dy[1] : 0;
    return { ...c, day: dayNumber(), bestMs: st };
  }
  function menuData() {
    const d = dailyToday();
    return {
      trails: trails.map((t) => ({ trail: t, locked: !isTrailUnlocked(progress, t.id), unlockText: unlockText(t.id), medal: medalOf(progress, t.id), bestMs: bestMs(progress, t.id) })),
      bikes: BIKE_IDS.map((id) => ({ id, locked: !isBikeUnlocked(progress, id), points: BIKE_MEDAL_POINTS[id] })), points: trailPoints(),
      current: { trailId: current.trail ? current.trail.id : FIRST_TRAIL, bike: progress.bk || 'hardtail' },
      settings: { time: env.getChoice().timeMode, weather: env.getChoice().weatherMode, season: env.getChoice().seasonMode, quality: readKey(QUALITY_KEY) && QUALITY[readKey(QUALITY_KEY)] && !readKey('pb_mtb_qauto') ? readKey(QUALITY_KEY) : 'auto', lang, muted: audio.isMuted() },
      autoQuality: autoQuality(), cloud: !!window.__pbSave || (window.parent !== window),
      daily: { trailName: trailName(trailById.get(d.trailId), lang), time: d.time, weather: d.weather, bestMs: d.bestMs, canBoard: window.parent !== window },
      viewpoints: { found: viewpointCount(progress.vp), total: viewpoints.length },
      map: { ...mapState, found: foundSet(), rider: { x: bike.x, z: bike.z, heading: bike.heading } },
    };
  }
  function foundSet() { const s = new Set(); viewpoints.forEach((v, i) => { if (hasViewpoint(progress.vp, i)) s.add(i); }); return s; }
  function refreshMenu() { if (ui.isMenuOpen()) ui.refreshMenu(menuData()); }
  function openMenu(tab) { ui.openMenu(tab || 'trails', menuData()); document.body.classList.add('menuopen'); }
  function closeMenu() { ui.closeMenu(); document.body.classList.remove('menuopen'); }
  function cycleTime() { const ids = Object.keys(TIME_PRESETS); env.setTime(ids[(ids.indexOf(env.state.timeId) + 1) % ids.length]); save(withSettings(progress, { time: env.getChoice().timeMode })); ui.toast(`${tr('hud.timeOfDay')}: ${tr(`time.${env.state.timeId}`)}`); audio.event('ui', { kind: 'click' }); }
  function cycleWeather() { env.setWeather(WEATHER_IDS[(WEATHER_IDS.indexOf(env.state.weatherId) + 1) % WEATHER_IDS.length]); save(withSettings(progress, { weather: env.getChoice().weatherMode })); ui.toast(`${tr('hud.weather')}: ${tr(`weather.${env.state.weatherId}`)}`); audio.event('ui', { kind: 'click' }); }
  function toggleSound() { const next = !audio.isMuted(); audio.setMuted(next); writeKey('pb_muted', next ? '1' : '0'); ui.toast(next ? tr('sound.off') : tr('sound.on')); }
  function applyQuality(id) {
    const next = QUALITY[id] ? id : autoQuality();
    Object.assign(quality, QUALITY[next], { id: next });
    terrain.setMaterial(groundFor(quality));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio)); resize();
  }
  function applySetting(key, value) {
    if (key === 'time') { env.setTime(value); save(withSettings(progress, { time: value })); }
    else if (key === 'weather') { env.setWeather(value); save(withSettings(progress, { weather: value })); }
    else if (key === 'season') { env.setSeason(value); save(withSettings(progress, { season: value })); }
    else if (key === 'quality') { if (value === 'auto') { try { localStorage.removeItem(QUALITY_KEY); } catch (error) { /* ignore */ } applyQuality(autoQuality()); } else { writeKey(QUALITY_KEY, value); applyQuality(value); } save(withSettings(progress, { q: value })); }
    else if (key === 'lang') { lang = value; writeKey(LANG_KEY, value); ui.setLang(value); input.setLabels({ pedal: tr('touch.pedal'), brake: tr('touch.brake'), jump: tr('touch.jump') }); save(withSettings(progress, { lang: value })); if (current.trail && game.mode === 'card') showCard(); setHudMode(); }
    else if (key === 'sound') { audio.setMuted(value === 'off'); writeKey('pb_muted', value === 'off' ? '1' : '0'); save(withSettings(progress, { snd: value === 'off' ? 0 : 1 })); }
    refreshMenu();
    hudButtons();
  }
  function openBoard(which) {
    if (which === 'trail' && current.trail) reporter.selectBoard(current.trail.id, trailName(current.trail, lang));
    setTimeout(() => { let pb = window.PB; try { if (!pb && window.parent !== window) pb = window.parent.PB; } catch (error) { /* cross-origin */ } if (pb && pb.openBoard) pb.openBoard(); }, 80);
  }
  function hudButtons() {
    const c = env.getChoice();
    ui.setHudButtons({ muted: audio.isMuted(), weather: env.state.weatherId, night: env.state.timeId === 'night' || env.state.timeId === 'dusk', timeLabel: tr(`time.${env.state.timeId}`), weatherLabel: tr(`weather.${env.state.weatherId}`) });
    void c;
  }
  function setHudMode() { ui.setHudMode(game.mode, current.trail && game.mode !== 'free' ? current.trail : null); hudButtons(); }

  // ---- screens and modes
  function showCard() {
    const t = current.trail;
    const d = current.kind === 'daily' ? current.dailyInfo : null;
    const bm = bestMs(progress, t.id);
    ui.showCard({ trail: t, bestMs: bm, bestMedal: medalOf(progress, t.id), medals: t.medals, locked: !isTrailUnlocked(progress, t.id) && current.kind !== 'daily', unlockText: unlockText(t.id), daily: !!d, canGhost: !!ghostData, bike: progress.bk || 'hardtail' });
    document.body.classList.add('cardopen');
  }
  function enterCard(trailId, kind = 'trail') {
    const t = trailById.get(trailId) || trailById.get(FIRST_TRAIL);
    closeMenu(); ui.hideFinish(); ui.hideCount(); ui.hideHint(false); replay = null; ghostRider.root.visible = false;
    current = { trail: t, kind, dailyInfo: kind === 'daily' ? dailyToday() : null };
    const gt = ghostFor(progress, t.id);
    ghostData = gt ? decodeGhost(gt) : null;
    game.showCard(t, { kind, bestMs: bestMs(progress, t.id), bestSplits: bestSplits(progress, t.id), ghostMs: ghostData ? ghostData.duration : 0 });
    bike = stateAt(t, 0, ground);
    chase.snap(bike);
    props.setActiveTrail(t); props.setFlags(t, 0); props.setViewpoints([], null);
    writeKey(LAST_KEY, t.id);
    reporter.selectBoard(t.id, trailName(t, lang));                    // the arcade header and leaderboard follow the trail on the card: "Best" is this trail's best time
    showCard(); setHudMode(); input.showTouchUi(true);
  }
  function startRun() {
    if (game.mode !== 'card') return;
    const t = current.trail;
    if (!isTrailUnlocked(progress, t.id) && current.kind !== 'daily') return;
    audio.resume();
    ui.hideCard(); document.body.classList.remove('cardopen');
    game.begin();
    hintLeft = rides < HINT_RIDES ? HINT_SECONDS : 0;
    setHudMode();
  }
  function startFree() {
    closeMenu(); ui.hideCard(); ui.hideFinish(); document.body.classList.remove('cardopen'); replay = null; ghostRider.root.visible = false;
    const t = current.trail || trailById.get(FIRST_TRAIL);
    current = { trail: t, kind: 'free', dailyInfo: null };
    game.startFree(t, viewpoints, foundSet());
    bike = stateAt(t, 0, ground);
    chase.snap(bike);
    props.setActiveTrail(null); props.setFlags(null, 0); props.setViewpoints(viewpoints, foundSet());
    ui.toast(tr('vp.hint'));
    setHudMode(); ui.setHud({ speedKmh: 0, found: { n: viewpointCount(progress.vp), total: viewpoints.length } });
    audio.resume();
  }
  function startDaily() {
    const d = dailyToday();
    closeMenu();
    if (d.time) env.setTime(d.time);
    if (d.weather) env.setWeather(d.weather);
    enterCard(d.trailId, 'daily');
  }
  function startReplay() {
    if (!game.result) return;
    const samples = game.result.ghost;
    const text = encodeGhost(samples);
    const g = decodeGhost(text);
    if (!g) return;
    ui.hideFinish();
    replay = { ghost: g, t: 0, trail: current.trail };
    ghostRider.root.visible = true;
  }

  function applyEvents(events) {
    for (const e of events) {
      if (e.type === 'countdown') { ui.showCount(e.n); audio.event('countdown', { n: e.n }); }
      else if (e.type === 'go') { ui.showCount(0); audio.event('go'); setHudMode(); }
      else if (e.type === 'checkpoint') {
        ui.split(e.delta, e.n); props.setFlags(current.trail, game.cpNext);
        audio.event('checkpoint', { better: e.delta === null ? null : e.delta <= 0 });
      } else if (e.type === 'crash') { ui.banner(tr('hud.crash'), 'bad', 1500); audio.event('crash', { severity: Math.min(1, bike.lastImpact / 12) }); }
      else if (e.type === 'respawn') respawnAt(e.index, e.reason);
      else if (e.type === 'rescue') { respawnAt(e.index, 'rescue'); ui.toast(tr('hud.rescue')); }
      else if (e.type === 'missed') ui.toast(tr('hud.missed', { n: e.n }));
      else if (e.type === 'viewpoint') onViewpoint(e);
      else if (e.type === 'finish') onFinish(e);
    }
  }
  function respawnAt(index, reason) {
    const t = current.trail;
    if (game.mode === 'free') { bike = Object.freeze({ ...createBikeState(lastSafe.x, lastSafe.z, lastSafe.heading, ground), shield: PLAY.respawnShield }); }
    else bike = stateAt(t, index, ground, reason === 'reset' ? 0 : 2);
    physicsEnv.shield = PLAY.respawnShield;
    chase.snap(bike);
    audio.event('respawn');
    if (reason === 'crash') ui.toast(tr('toast.respawn'));
  }
  function onViewpoint(e) {
    const before = progress;
    const r = recordViewpoint(progress, e.index);
    save(r.progress);
    props.setViewpoints(viewpoints, foundSet());
    ui.banner(tr('free.found', { name: e.name }), '', 2600);
    audio.event('collect');
    if (e.count === e.total) ui.toast(tr('free.all'));
    ui.setHud({ speedKmh: speedKmh(bike), found: { n: e.count, total: e.total } });
    const nu = newUnlocks(before, r.progress);
    void nu;
  }
  function onFinish(e) {
    const t = current.trail;
    rides++;
    if (e.valid === false) {                                           // an impossible time (teleport, cheat): shown, never saved, medalled, ghosted or posted
      console.warn('[mtb] a run faster than the trail allows is not counted', t.id, e.ms);
      ui.showFinish({ trail: t, ms: e.ms, medal: 0, isBest: false, bestMs: bestMs(progress, t.id), crashes: e.crashes, splits: e.splits, bestSplits: bestSplits(progress, t.id), nextMedal: null, unlocks: [], beatGhost: false, ghostLost: false, hasNext: true, daily: false, valid: false });
      setHudMode();
      return;
    }
    const before = progress;
    const ghostText = encodeGhost(e.ghost);
    const run = recordRun(progress, { trailId: t.id, ms: e.ms, checkpointsMs: e.splits.map((v) => Math.round(v)), ghostText, medal: e.medal });
    let next = addStats(run.progress, { rides: 1, crashes: e.crashes, km: t.length / 1000 });
    const unlocks = [];
    const nu = newUnlocks(before, next);
    for (const id of nu.trails || []) unlocks.push(trailName(trailById.get(id), lang));
    for (const id of nu.bikes || []) unlocks.push(tr(`bike.${id}`));
    if ((nu.colours || []).length) unlocks.push(tr('unlock.colour'));
    if ((nu.helmets || []).length) unlocks.push(tr('unlock.helmet'));
    if (e.kind === 'daily') next = recordDaily(next, { day: dayNumber(), ms: e.ms }).progress;
    save(next);
    if (run.isBest && e.kind !== 'daily') reporter.submitRun(t.id, e.ms, trailName(t, lang));
    if (e.kind === 'daily') rpc.submit(e.ms).then(() => ui.setFinishNote(tr('daily.sent'))).catch((error) => ui.setFinishNote(error && error.message === 'signed-out' ? tr('daily.signin') : ''));
    const prevBest = e.bestMs;
    ui.showFinish({ trail: t, ms: e.ms, medal: e.medal, isBest: run.isBest, bestMs: prevBest, crashes: e.crashes, splits: e.splits, bestSplits: bestSplits(before, t.id), nextMedal: game.nextMedal(e.ms), unlocks, topKmh: runTopKmh, beatGhost: e.beatGhost, ghostLost: ghostData && !e.beatGhost, hasNext: true, daily: e.kind === 'daily' });
    audio.event('finish'); setTimeout(() => audio.event('medal', { tier: e.medal }), 500);
    if (unlocks.length) setTimeout(() => audio.event('unlock'), 1100);
    setHudMode();
  }

  function onAction(a, ev) {
    if (a === 'sound') toggleSound();
    else if (a === 'menu') { if (ui.isMenuOpen()) closeMenu(); else openMenu('trails'); }
    else if (a === 'confirm' || (a === 'jump' && false)) { if (game.mode === 'card' && !ui.isMenuOpen()) startRun(); }
    else if (a === 'camera') { camMode = (camMode + 1) % 3; chase.snap(bike); }
    else if (a === 'reset') handlers.onReset();
    else if (a === 'time') cycleTime();
    else if (a === 'weather') cycleWeather();
    else if (a === 'season') { env.setSeason(SEASON_IDS[(SEASON_IDS.indexOf(env.state.seasonId) + 1) % SEASON_IDS.length]); save(withSettings(progress, { season: env.getChoice().seasonMode })); }
    else if (a === 'help') openMenu('help');
    void ev;
  }

  // ---- resize
  /** The picture is shifted (a lens shift of the camera) into the part of the screen that no card covers: up while the start card is open, into the free area beside / above the finish card
   *  (ui.finishFree), and back to the centre otherwise. The shift eases in and out. */
  const viewShift = { x: 0, y: 0, applied: false };
  const VIEW_EASE = 6;              // 1/s
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; viewShift.applied = false; ui.layoutChanged(); applyViewOffset(0, true); camera.updateProjectionMatrix();
  };
  function wantedShift(w, h) {
    if (game.mode === 'card') return { x: 0, y: -h * CARD_SHIFT };
    const free = game.mode === 'finished' && !replay ? ui.finishFree() : null;
    return free ? { x: free.cx - w / 2, y: free.cy - h / 2 } : { x: 0, y: 0 };
  }
  function applyViewOffset(dt, snap = false) {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const want = wantedShift(w, h), k = snap ? 1 : 1 - Math.exp(-VIEW_EASE * dt);
    const nx = viewShift.x + (want.x - viewShift.x) * k, ny = viewShift.y + (want.y - viewShift.y) * k;
    if (viewShift.applied && Math.abs(nx - viewShift.x) < 0.2 && Math.abs(ny - viewShift.y) < 0.2) return;
    viewShift.x = nx; viewShift.y = ny; viewShift.applied = true;
    if (Math.abs(nx) < 0.5 && Math.abs(ny) < 0.5) camera.clearViewOffset(); else camera.setViewOffset(w, h, -Math.round(nx), -Math.round(ny), w, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- first screen
  const startTrail = param('trail') && trailById.has(param('trail')) ? param('trail') : (trailById.has(readKey(LAST_KEY)) && isTrailUnlocked(progress, readKey(LAST_KEY)) ? readKey(LAST_KEY) : FIRST_TRAIL);
  setLoad(0.86, 'load.build');
  current = { trail: trailById.get(startTrail), kind: 'trail', dailyInfo: null };
  enterCard(startTrail);
  const at = Number(param('at') || 0);
  if (at > 0) { bike = stateAt(current.trail, at, ground); chase.snap(bike); }
  const mode = param('mode');
  if (param('autostart') === '1' || mode === 'run') { ui.hideCard(); document.body.classList.remove('cardopen'); game.begin(); game.countdown = 0.001; }
  else if (mode === 'free') startFree();
  else if (param('daily') === '1') startDaily();
  terrain.buildAll(bike.x, bike.z);
  forest.update(bike.x, bike.z, 0, 0, 0, true);
  env.update(0, camera, 0);
  hudButtons();
  if (readKey('pb_muted') === '1') audio.setMuted(true);

  // ---- loop
  let last = performance.now();
  let elapsed = 0;
  let running = true;
  let contextLost = false;
  let hudT = 0;
  let slowT = 0;
  const perf = { frames: 0, fps: 0, ms: 0, drawCalls: 0, triangles: 0, adapt: 0 };
  let perfT = 0, perfFrames = 0;
  const wheelbase = rider.wheelbase;
  const extra = { dt: 0.016, pitch: 0, standing: false, spin: 0, brake: 0 };
  const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
  let foamTimer = 0, safeT = 0, runTopKmh = 0;
  const frozen = () => game.mode === 'card' || game.mode === 'countdown';
  const poseGhost = (g, ms, tr0) => {
    const p = ghostAt(g, ms);
    const pose = poseOnTrail(tr0, p.s, p.o);
    const y = ground.height(pose.x, pose.z);
    const fx = Math.cos(pose.heading), fz = Math.sin(pose.heading);
    const pitch = Math.atan2(ground.height(pose.x + fx * 0.56, pose.z + fz * 0.56) - ground.height(pose.x - fx * 0.56, pose.z - fz * 0.56), 1.12);
    const sp = p.speed || 0;
    const st = { x: pose.x, y, z: pose.z, vx: fx * sp, vy: 0, vz: fz * sp, heading: pose.heading, steer: 0, lean: 0, grounded: true, compression: 0, crank: (ms / 1000) * sp * 1.35 % (Math.PI * 2), cadence: sp * 9 };
    ghostRider.apply(st, { dt: 0.016, pitch, standing: false, brake: 0 });
  };

  /** One logical step of the game: physics, game state machine, events. No rendering (the flows call it directly to ride a whole trail in a few seconds). */
  function logic(dt, inp) {
    const mode = game.mode;
    if (mode === 'run') runTopKmh = Math.max(runTopKmh, speedKmh(bike)); else if (mode !== 'finished') runTopKmh = 0;
    if (!frozen() && !ui.isMenuOpen() && !replay) {
      physicsEnv.wet = wetNow();
      physicsEnv.shield = game.shield;
      bikeY = bike.y;
      const drive = mode === 'finished' ? { throttle: 0, brake: 0.35, brakeF: 0.2, brakeR: 0.3, steer: inp.steer * 0.5, jump: false } : inp;
      bike = advanceBike(bike, drive, dt, ground, groundAt, physicsEnv);
      const lo2 = WORLD.playInset, hiX = WORLD.width - WORLD.playInset, hiZ = WORLD.depth - WORLD.playInset;
      if (bike.x < lo2 || bike.x > hiX || bike.z < lo2 || bike.z > hiZ) bike = Object.freeze({ ...bike, x: Math.min(hiX, Math.max(lo2, bike.x)), z: Math.min(hiZ, Math.max(lo2, bike.z)), vx: bike.vx * 0.3, vz: bike.vz * 0.3 });
      applyEvents(game.update(dt, bike, inp));
      if (mode === 'free') { safeT += dt; if (safeT > 0.8 && bike.grounded && !bike.crashed && Math.hypot(bike.vx, bike.vz) > 1) { safeT = 0; lastSafe = { x: bike.x, z: bike.z, heading: bike.heading }; } }
    } else if (frozen()) {
      applyEvents(game.update(dt, bike, inp));
    }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (contextLost || document.hidden) { last = now; return; }
    const dt = Math.min(MAX_FRAME_S, Math.max(0.0005, (now - last) / 1000));
    last = now; elapsed += dt;
    const inp = input.read(scriptedInput);
    if (replay) { replay.t += dt * 1000; if (replay.t > replay.ghost.duration + 1500 || replay.t > REPLAY_SECONDS_MAX * 1000 * 60) { replay = null; ghostRider.root.visible = false; ui.showFinish(lastFinish()); } }
    applyViewOffset(dt);
    logic(dt, inp);
    // events from the physics (landings) for sound and feedback
    if (bike.landSeq !== lastLand) {
      lastLand = bike.landSeq;
      audio.event('land', { impact: bike.landImpact, quality: bike.landQuality });
      if (!replay) dust.burst(bike, bike.landImpact, bike.groundKind);
      if (bike.landImpact > 3 && !bike.crashed && game.mode === 'run') ui.banner(bike.landQuality > 0.85 ? tr('hud.perfect') : bike.landQuality > 0.45 ? tr('hud.good') : tr('hud.rough'), bike.landQuality > 0.45 ? '' : 'bad', 900);
    }
    if (bike.popped && !lastPopped) audio.event('jump');
    lastPopped = bike.popped;

    // pose
    const fx = Math.cos(bike.heading), fz = Math.sin(bike.heading), half = wheelbase / 2;
    const hF = ground.height(bike.x + fx * half, bike.z + fz * half), hR = ground.height(bike.x - fx * half, bike.z - fz * half);
    extra.dt = dt; extra.pitch = bike.grounded ? Math.atan2(hF - hR, wheelbase) : Math.atan2(bike.vy, Math.hypot(bike.vx, bike.vz) + 0.1) * 0.5;
    extra.standing = (bike.cadence < 5 && Math.hypot(bike.vx, bike.vz) > 5) || bike.preload > 0.1;
    extra.brake = Math.max(bike.brakeF, bike.brakeR);
    bikeY = bike.y;
    rider.apply(bike, extra);
    rider.lamp(lampPos, lampDir);
    env.setLamp(lampPos, lampDir);
    if (replay) poseGhost(replay.ghost, replay.t, replay.trail);
    else if (game.mode === 'run' && ghostData && current.trail) { ghostRider.root.visible = true; poseGhost(ghostData, game.timeMs, current.trail); }
    else if (!replay) ghostRider.root.visible = false;

    const c = frozenCamera || chase.update(replay ? replayBike() : bike, dt, camMode, elapsed);
    // a trail that ends at a sight (the Schiessentuempel falls): once finished, the camera glides to a spot in front of the cascade and looks at it, the falls centred in the part of the screen the finish card leaves free
    const focus = current.trail && current.trail.focus && world.finishView;
    focusBlend = !frozenCamera && focus && game.mode === 'finished' ? Math.min(1, focusBlend + dt * 0.6) : Math.max(0, focusBlend - dt * 2);
    if (focusBlend > 0 && focus) {
      const k = focusBlend * focusBlend * (3 - 2 * focusBlend);
      const free = ui.finishFree();
      const W = canvas.clientWidth || window.innerWidth, H = canvas.clientHeight || window.innerHeight;
      const fov = finishFov(focus, free || { w: W, h: H }, W, H);
      c.x += (focus.x - c.x) * k; c.y += (focus.y - c.y) * k; c.z += (focus.z - c.z) * k;
      c.tx += (focus.tx - c.tx) * k; c.ty += (focus.ty - c.ty) * k; c.tz += (focus.tz - c.tz) * k;
      c.fov += (fov - c.fov) * k;
    }
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(camera.fov - c.fov) > 0.05) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    camera.far = quality.far;
    for (const m of [groundFull, groundCheap]) m.uniforms.uTreeRadius.value = quality.treeRadius;

    env.update(dt, camera, elapsed);
    env.setFogBase(surface.height(c.x, c.z));
    terrain.update(frozenCamera ? c.x : bike.x, frozenCamera ? c.z : bike.z);
    forest.update(c.x, c.z, bike.vx, bike.vz, elapsed);
    rockView.update(c.x, c.z);
    town.update(c.x, c.z);
    foamTimer -= dt;
    if (foamTimer <= 0) { foamTimer = 0.4; water.updateFoam(c.x, c.z, rockView.stones); }
    rain.update(); leaves.update(); shafts.update(c.x, c.z); birds.update(); insects.update(c.x, c.z);
    const riding = !frozen() && !ui.isMenuOpen() && !replay && game.mode !== 'finished' && !frozenCamera;
    if (riding) dust.emit(bike, dt, bike.groundKind, wetNow());
    dust.update(dt);
    speedLines.update(Math.hypot(bike.vx, bike.vz), dt, riding && !bike.crashed);
    hikers.update(dt, bike.x, bike.z);
    renderer.render(scene, camera);

    // sound
    const speed = Math.hypot(bike.vx, bike.vz);
    audio.update({ dt, speed, grounded: bike.grounded, surface: AUDIO_SURFACE[bike.groundKind] || 'dirt', pedal: bike.pedal, cadence: bike.cadence, brakeFront: bike.brakeF, brakeRear: bike.brakeR, skid: bike.skid, wet: wetNow(), rain: env.state.rain, night: env.state.night,
      wind: 0, fallDistance: Math.hypot(bike.x - fall.x, bike.z - fall.z), waterSize: 1, compression: bike.compression, paused: ui.isMenuOpen(), riding: !frozen() });

    // HUD
    hudT += dt;
    if (hudT >= HUD_EVERY) {
      hudT = 0;
      const t = current.trail;
      if (t) {
        const prog = game.mode === 'free' ? 0 : Math.min(1, game.progress / (t.count - 1));
        ui.setHud({ speedKmh: speedKmh(bike), timeMs: game.timeMs, progress: prog, cp: game.mode === 'run' || game.mode === 'finished' ? { n: Math.min(game.cpNext + 1, t.cps.length + 1), total: t.cps.length + 1 } : undefined, found: game.mode === 'free' ? { n: viewpointCount(progress.vp), total: viewpoints.length } : undefined });
      }
      if (hintLeft > 0 && game.mode === 'run') {
        hintLeft -= HUD_EVERY;
        if (hintLeft > 0 && !hintShown) { ui.showHint(isTouch); hintShown = true; }
        if (inp.throttle > 0 && hintLeft < HINT_SECONDS - 6 || hintLeft <= 0) { ui.hideHint(); hintLeft = 0; hintShown = false; }
      }
      if (game.mode === 'run' && (game.lastDist || 0) > WRONGWAY_DIST) ui.banner(tr('hud.wrongway'), 'bad', 900);
    }
    // performance + automatic quality step-down
    perfT += dt; perfFrames++; perf.frames++;
    if (perfT >= 1) {
      perf.fps = Math.round(perfFrames / perfT); perf.ms = Math.round(1000 * perfT / perfFrames);
      perf.drawCalls = renderer.info.render.calls; perf.triangles = renderer.info.render.triangles;
      const manual = readKey(QUALITY_KEY) && !readKey('pb_mtb_qauto');
      slowT = perf.ms > FRAME_BUDGET_MS[quality.id] ? slowT + perfT : 0;
      perfT = 0; perfFrames = 0;
      if (slowT >= ADAPT_WINDOW_S && quality.id !== 'low' && !debug && !manual) {
        const next = quality.id === 'high' ? 'medium' : 'low';
        applyQuality(next);
        perf.adapt++; slowT = 0;
      }
    }
  }
  let lastLand = bike.landSeq, lastPopped = false, hintShown = false;
  const replayBike = () => { const p = ghostAt(replay.ghost, replay.t); const pose = poseOnTrail(replay.trail, p.s, p.o); return { ...bike, x: pose.x, z: pose.z, y: ground.height(pose.x, pose.z), heading: pose.heading, vx: Math.cos(pose.heading) * (p.speed || 5), vz: Math.sin(pose.heading) * (p.speed || 5), vy: 0, slip: 0, compression: 0, grounded: true, lean: 0 }; };
  const lastFinish = () => ({ trail: current.trail, ms: game.result ? game.result.ms : 0, medal: game.result ? game.result.medal : 0, isBest: false, bestMs: bestMs(progress, current.trail.id), crashes: game.crashes, splits: game.result ? game.result.splits : [], bestSplits: bestSplits(progress, current.trail.id), nextMedal: game.result ? game.nextMedal(game.result.ms) : null, unlocks: [], topKmh: runTopKmh, beatGhost: false, hasNext: true, daily: current.kind === 'daily' });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; console.warn('[mtb] WebGL context lost'); });
  canvas.addEventListener('webglcontextrestored', () => { console.warn('[mtb] WebGL context restored: reloading'); location.reload(); });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  window.addEventListener('pagehide', () => persistence.pushSave());
  window.addEventListener('message', (e) => { if (e.data && e.data.__pbSndMute !== undefined) audio.setMuted(Boolean(e.data.__pbSndMute)); });

  last = performance.now();
  requestAnimationFrame(frame);
  await new Promise((r) => setTimeout(r, 60));
  loader.done();
  document.documentElement.dataset.mtbReady = '1';

  window.__mtb = {
    version: 'w3-play', renderer, scene, camera, field, surface, ground, groundAt, env, cascade: world.cascade, terrain, forest, trees, undergrowth, rocks, rockView, town, water, rider, rain, leaves, shafts, birds, insects, hikers, world, maps, bridge, quality, perf, data, junctions, props,
    game, ui, input, audio, props, trails, viewpoints, persistence, dailyToday, menuData,
    get trail() { return current.trail; }, get kind() { return current.kind; }, get centre() { return current.trail.centre; },
    get bike() { return bike; }, get progress() { return progress; }, get focusBlend() { return focusBlend; }, get viewShift() { return { x: viewShift.x, y: viewShift.y }; },
    setProgress(p) { progress = p; applyLoadout(); refreshMenu(); },
    setBike(b) { bike = Object.freeze({ ...bike, ...b }); },
    reset(index) { bike = stateAt(current.trail, index ?? game.progress, ground); chase.snap(bike); },
    teleport(x, z, heading = bike.heading) { bike = createBikeState(x, z, heading, ground); chase.snap(bike); },
    setInput(i) { scriptedInput = i; },
    setCamera(pose) { frozenCamera = pose ? { fov: 62, ...pose } : null; },
    snapCamera: () => chase.snap(bike),
    step(seconds, inputOverride) { bike = advanceBike(bike, inputOverride || { throttle: 0, brake: 0, steer: 0 }, seconds, ground, groundAt, physicsEnv); },
    tick(dt, inp) { logic(dt, inp || scriptedInput || input.read(null)); }, enterCard, startRun, startFree, startDaily, openMenu, closeMenu, showFinishForTest: (d) => ui.showFinish(d),
    stop() { running = false; },
    elapsed: () => elapsed,
  };
}

boot().catch((error) => {
  console.error('[mtb] boot failed', error);
  document.documentElement.dataset.bootError = String(error && error.message || error);
  if (window.__mtbLoad) window.__mtbLoad.fail(translate('lb', 'load.error'));
});
