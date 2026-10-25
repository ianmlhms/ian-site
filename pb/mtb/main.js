/* MTB Mëllerdall W2: boots the world and the first rideable bike (W2: painted broadleaf forest, sandstone, water, animated life).
 *   loading bar -> data -> height field + physics surface -> painted textures -> env (sky, sun, fog) -> terrain tiles + forest -> bike on trail 1 -> ride.
 * ?q=low|medium|high  ?time=dawn|morning|noon|evening|dusk|night  ?weather=clear|cloudy|fog|rain  ?season=summer|autumn  ?trail=<id>  ?debug=1 (window.__mtb)  ?holes=1 (hole detector mode)
 * The page is also loaded as a srcdoc iframe by the arcade, so every URL here is built from import.meta.url or is absolute. */
import { WORLD, QUALITY, QUADTREE } from './config.js';
import { loadWorldData } from './world-data.js';
import { createBikeState, advanceBike, speedKmh } from './bike.js';
import { createChaseCamera } from './camera.js';
import { createPaintTextures } from './paint-textures.js';

import { createEnv, TIME_PRESETS, WEATHER_IDS, SEASON_IDS } from './env.js';
import { createGroundMaterial } from './ground-shader.js';
import { buildPureWorld } from './world-build.js';
import { createRockView } from './rock-view.js';
import { createWaterView } from './water-view.js';
import { createRain, createLeaves, createShafts, createBirds, createInsects } from './effects.js';
import { createHikers } from './hikers.js';
import { createTerrainView } from './terrain-view.js';
import { createForestView } from './forest-view.js';
import { createRider } from './rider.js';
import { createInput } from './input.js';
import { LANGS, t as translate, trailName } from './i18n.js';

const THREE = window.THREE;
const $ = (id) => document.getElementById(id);
const LANG_KEY = 'pb_mtb_lang';
const QUALITY_KEY = 'pb_mtb_quality';
const FRAME_BUDGET_MS = { low: 40, medium: 30, high: 24 };
const ADAPT_WINDOW_S = 3;
const MAX_FRAME_S = 0.05;
const HINT_SECONDS = 14;
const RESPAWN_LIFT = 0.05;

function param(name) {
  try { const own = new URLSearchParams(location.search).get(name); if (own !== null) return own; } catch (error) { /* ignore */ }
  try { if (window.parent !== window) return new URLSearchParams(window.parent.location.search).get(name); } catch (error) { /* cross-origin parent */ }
  return null;
}

function pickLang() {
  try {
    const own = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(own)) return own;
    const site = localStorage.getItem('site_lang');
    if (LANGS.includes(site)) return site;
  } catch (error) { console.warn('[mtb] storage blocked', error); }
  return 'lb';
}

function pickQuality() {
  const q = param('q');
  if (q && QUALITY[q]) return q;
  try { const stored = localStorage.getItem(QUALITY_KEY); if (QUALITY[stored]) return stored; } catch (error) { console.warn('[mtb] storage blocked', error); }
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency || 4) <= 4;
  if (coarse) return weak ? 'low' : 'medium';
  return weak ? 'medium' : 'high';
}

const reader = (base) => async (name) => {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

async function boot() {
  const lang = pickLang();
  document.documentElement.lang = lang;
  const tr = (key) => translate(lang, key);
  const loader = window.__mtbLoad || { set() {}, done() {}, fail() {} };
  const setLoad = (p, key) => loader.set(p, key ? tr(key) : '');
  const canvas = $('mtbCanvas');
  const qualityId = pickQuality();
  const quality = { ...QUALITY[qualityId], id: qualityId };
  const holeMode = param('holes') === '1';
  const debug = param('debug') === '1' || holeMode;
  document.body.classList.toggle('touch', window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  setLoad(0.04, 'load.terrain');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityId === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: debug });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;          // the whole game shades in display space (painted look)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setClearColor(holeMode ? 0xff00ff : 0x9ab6c8, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, quality.far);
  scene.add(camera);

  // ---- data
  const data = await loadWorldData(reader(new URL('./data/', import.meta.url)), (p, what) => setLoad(0.08 + 0.52 * p, `load.${what}`));
  setLoad(0.62, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const world = buildPureWorld(data);
  const { field, surface, groundAt, clearance, maps, trees, undergrowth, rocks } = world;

  // ---- painted textures, world maps, env
  setLoad(0.7, 'load.build');
  await new Promise((r) => setTimeout(r, 0));
  const textures = createPaintTextures(renderer, qualityId);
  const mapTexture = (arr, filter = THREE.LinearFilter) => { const tex = new THREE.DataTexture(arr, maps.nx, maps.nz, THREE.RGBAFormat); tex.magFilter = filter; tex.minFilter = filter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true; return tex; };
  const worldMaps = { cover: mapTexture(maps.cover), canopy: mapTexture(maps.canopy), field: mapTexture(maps.field, THREE.NearestFilter) };
  const env = createEnv({ noiseTexture: textures.noise, params: { time: param('time'), weather: param('weather'), season: param('season') } });
  if (holeMode) env.sky.visible = false;
  scene.add(env.sky);
  const groundFull = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, false);
  const groundCheap = createGroundMaterial(THREE, env, textures, worldMaps, WORLD, true);
  const groundFor = (q) => (q.cheapGround ? groundCheap : groundFull);
  const groundMaterial = groundFor(quality);
  for (const m of [groundFull, groundCheap]) m.uniforms.uTreeRadius.value = quality.treeRadius;

  // ---- world
  const terrain = createTerrainView({ scene, surface, field, material: groundMaterial, quality });
  const forest = createForestView({ scene, trees, undergrowth, env, quality, textures, meadow: { map: maps, surface, clearance } });
  const rockView = createRockView({ scene, rocks, env, quality, textures });
  const water = createWaterView({ scene, network: field.network, env, quality });
  const rider = createRider(env);
  scene.add(rider.root);
  const rain = createRain({ scene, env, quality }), leaves = createLeaves({ scene, env, quality }), shafts = createShafts({ scene, env, quality, surface, map: maps });
  const birds = createBirds({ scene, env, quality }), insects = createInsects({ scene, env, quality, surface, map: maps, clearance });
  const hikers = createHikers({ scene, env, surface, paths: world.ways.filter((w) => w.kind === 'path') });

  // ---- the first trail
  const trails = data.trails.trails;
  const trailId = param('trail') || trails[0].id;
  const trail = trails.find((x) => x.id === trailId) || trails[0];
  const info = field.network.ways.find((w) => w.id === `trail-${trail.id}`);
  const centre = [];
  for (let i = info.first; i < info.first + info.count; i++) centre.push([field.network.samples.px[i], field.network.samples.pz[i]]);
  const startIndex = Math.min(centre.length - 4, Math.max(0, Number(param('at') || 0)));
  const headingAt = (i) => { const a = centre[Math.max(0, i - 1)], b = centre[Math.min(centre.length - 1, i + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const camHit = { nx: 0, nz: 0, pen: 0 }, bikeHit = { nx: 0, nz: 0, pen: 0 };
  const rockHit = { nx: 0, nz: 0, pen: 0 };
  /** Trunks and rocks: the deeper penetration wins (the bike slides along either). */
  let bikeY = 0;
  const collideAll = (x, z, r, out) => {
    const a = trees.collide(x, z, r, out);
    const b = rocks.collide(x, z, r, bikeY, rockHit);
    if (b && (!a || b.pen > a.pen)) { out.nx = b.nx; out.nz = b.nz; out.pen = b.pen; return out; }
    return a;
  };
  const physicsEnv = { gripScale: 1, collide: (x, z, r) => collideAll(x, z, r, bikeHit) };
  let bike = createBikeState(centre[startIndex][0], centre[startIndex][1], headingAt(startIndex), surface);
  const crownPush = { dx: 0, dy: 0, dz: 0 }, camRock = { nx: 0, nz: 0, pen: 0 };
  const trunkOrRock = (x, z, r) => {                              // the camera never sits inside a trunk or beside-through a rock wall
    const a = trees.collide(x, z, r, camHit);
    const b = rocks.collide(x, z, r, -1e9, camRock);
    if (b && (!a || b.pen > a.pen)) { camHit.nx = b.nx; camHit.nz = b.nz; camHit.pen = b.pen; return camHit; }
    return a;
  };
  const crownsAndRocks = (x, y, z, r) => trees.pushOutOfCrowns(x, y, z, r, crownPush);
  const chase = createChaseCamera(surface, trunkOrRock, crownsAndRocks);
  chase.snap(bike);

  setLoad(0.86, 'load.build');
  terrain.buildAll(bike.x, bike.z);
  forest.update(bike.x, bike.z, true);
  env.update(0, camera, 0);

  // ---- HUD + input
  const hint = $('hint');
  const touchDevice = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  hint.textContent = tr(touchDevice ? 'hint.touch' : 'hint.keys');            // touch devices get the touch hint, never the keyboard one
  $('hudSpeedUnit').textContent = tr('hud.speed');
  $('trailName').textContent = trailName(trail, lang);
  $('trailGrade').className = `grade ${trail.grade}`;
  const reset = (index) => {
    const i = Math.max(0, Math.min(centre.length - 4, index));
    bike = createBikeState(centre[i][0], centre[i][1], headingAt(i), surface);
    chase.snap(bike);
  };
  let nearest = startIndex;
  const nearestIndex = () => {
    let best = nearest, bd = 1e18;
    for (let i = Math.max(0, nearest - 60); i < Math.min(centre.length, nearest + 120); i++) {
      const d = (centre[i][0] - bike.x) ** 2 + (centre[i][1] - bike.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 40 * 40) {          // lost: search the whole trail
      for (let i = 0; i < centre.length; i++) { const d = (centre[i][0] - bike.x) ** 2 + (centre[i][1] - bike.z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
  const input = createInput({ root: $('shell'), onAction: (a) => {
    if (a === 'reset') reset(nearest);
    if (a === 'time') { const ids = Object.keys(TIME_PRESETS); env.setTime(ids[(ids.indexOf(env.state.timeId) + 1) % ids.length]); }
    if (a === 'weather') env.setWeather(WEATHER_IDS[(WEATHER_IDS.indexOf(env.state.weatherId) + 1) % WEATHER_IDS.length]);
    if (a === 'season') env.setSeason(SEASON_IDS[(SEASON_IDS.indexOf(env.state.seasonId) + 1) % SEASON_IDS.length]);
  } });
  let hintLeft = HINT_SECONDS;

  // ---- resize
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // ---- loop
  let last = performance.now();
  let elapsed = 0;
  let scriptedInput = null;
  let frozenCamera = null;
  let running = true;
  let contextLost = false;
  const perf = { frames: 0, fps: 0, ms: 0, drawCalls: 0, triangles: 0, adapt: 0 };
  let perfT = 0, perfFrames = 0, slowT = 0;
  const wheelbase = rider.wheelbase;
  const extra = { dt: 0.016, pitch: 0, standing: false, spin: 0, brake: 0 };
  const lampPos = new THREE.Vector3(), lampDir = new THREE.Vector3();
  let foamTimer = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (contextLost || document.hidden) { last = now; return; }
    const dt = Math.min(MAX_FRAME_S, Math.max(0.0005, (now - last) / 1000));
    last = now; elapsed += dt;
    const inp = input.read(scriptedInput);
    physicsEnv.gripScale = env.gripScale();
    bike = advanceBike(bike, inp, dt, surface, groundAt, physicsEnv);
    // the invisible wall of the playable box
    const lo = WORLD.playInset, hiX = WORLD.width - WORLD.playInset, hiZ = WORLD.depth - WORLD.playInset;
    if (bike.x < lo || bike.x > hiX || bike.z < lo || bike.z > hiZ) {
      bike = Object.freeze({ ...bike, x: Math.min(hiX, Math.max(lo, bike.x)), z: Math.min(hiZ, Math.max(lo, bike.z)), vx: bike.vx * 0.3, vz: bike.vz * 0.3 });
    }
    nearest = nearestIndex();

    // pitch from the two wheel contact points
    const fx = Math.cos(bike.heading), fz = Math.sin(bike.heading), half = wheelbase / 2;
    const hF = surface.height(bike.x + fx * half, bike.z + fz * half), hR = surface.height(bike.x - fx * half, bike.z - fz * half);
    extra.dt = dt; extra.pitch = bike.grounded ? Math.atan2(hF - hR, wheelbase) : Math.atan2(bike.vy, Math.hypot(bike.vx, bike.vz) + 0.1) * 0.5;
    extra.standing = bike.cadence < 5 && Math.hypot(bike.vx, bike.vz) > 5;
    extra.brake = inp.brake || 0;
    bikeY = bike.y;
    rider.apply(bike, extra);
    rider.lamp(lampPos, lampDir);
    env.setLamp(lampPos, lampDir);

    const c = frozenCamera || chase.update(bike, dt);
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(camera.fov - c.fov) > 0.05) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
    camera.far = quality.far;
    for (const m of [groundFull, groundCheap]) m.uniforms.uTreeRadius.value = quality.treeRadius;

    env.update(dt, camera, elapsed);
    env.setFogBase(surface.height(c.x, c.z));
    terrain.update(frozenCamera ? c.x : bike.x, frozenCamera ? c.z : bike.z);
    forest.update(c.x, c.z);
    rockView.update(c.x, c.z);
    foamTimer -= dt;
    if (foamTimer <= 0) { foamTimer = 0.4; water.updateFoam(c.x, c.z, rockView.stones); }
    rain.update(); leaves.update(); shafts.update(c.x, c.z); birds.update(); insects.update(c.x, c.z);
    hikers.update(dt, bike.x, bike.z);
    renderer.render(scene, camera);

    // HUD
    $('hudSpeed').textContent = Math.round(speedKmh(bike));
    $('trailBar').style.width = `${Math.round(100 * nearest / (centre.length - 1))}%`;
    if (hintLeft > 0) { hintLeft -= dt; if (hintLeft <= 0 || (input.state.throttle > 0 && hintLeft < HINT_SECONDS - 4)) { hint.classList.add('gone'); hintLeft = 0; } }
    // performance + automatic quality step-down
    perfT += dt; perfFrames++; perf.frames++;
    if (perfT >= 1) {
      perf.fps = Math.round(perfFrames / perfT); perf.ms = Math.round(1000 * perfT / perfFrames);
      perf.drawCalls = renderer.info.render.calls; perf.triangles = renderer.info.render.triangles;
      slowT = perf.ms > FRAME_BUDGET_MS[quality.id] ? slowT + perfT : 0;
      perfT = 0; perfFrames = 0;
      if (slowT >= ADAPT_WINDOW_S && quality.id !== 'low' && !debug) {
        const next = quality.id === 'high' ? 'medium' : 'low';
        Object.assign(quality, QUALITY[next], { id: next });
        terrain.setMaterial(groundFor(quality));
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio)); resize();
        try { localStorage.setItem(QUALITY_KEY, next); } catch (error) { console.warn('[mtb] storage blocked', error); }
        perf.adapt++; slowT = 0;
      }
    }
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; console.warn('[mtb] WebGL context lost'); });
  canvas.addEventListener('webglcontextrestored', () => { console.warn('[mtb] WebGL context restored: reloading'); location.reload(); });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  // one frame so the first image is ready before the loading screen leaves
  last = performance.now();
  requestAnimationFrame(frame);
  await new Promise((r) => setTimeout(r, 60));
  loader.done();
  document.documentElement.dataset.mtbReady = '1';

  window.__mtb = {
    version: 'w2', renderer, scene, camera, field, surface, env, terrain, forest, trees, undergrowth, rocks, rockView, water, rider, rain, leaves, shafts, birds, insects, hikers, streams, maps, quality, trail, centre, perf, data,
    get bike() { return bike; },
    setBike(b) { bike = Object.freeze({ ...bike, ...b }); },
    reset, teleport(x, z, heading = bike.heading) { bike = createBikeState(x, z, heading, surface); chase.snap(bike); },
    setInput(i) { scriptedInput = i; },
    setCamera(pose) { frozenCamera = pose ? { fov: 62, ...pose } : null; },
    snapCamera: () => chase.snap(bike),
    step(seconds, inputOverride) { bike = advanceBike(bike, inputOverride || { throttle: 0, brake: 0, steer: 0 }, seconds, surface, groundAt, {}); },
    stop() { running = false; },
    elapsed: () => elapsed,
  };
}

boot().catch((error) => {
  console.error('[mtb] boot failed', error);
  document.documentElement.dataset.bootError = String(error && error.message || error);
  if (window.__mtbLoad) window.__mtbLoad.fail(translate(pickLang(), 'load.error'));
});
