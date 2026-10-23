/* Schueberfouer Tycoon W5: boots the first playable game.
 *   loading bar -> renderer + Glacis world + fair layer + env -> game.start() (local / cloud / backup / migration) -> camera fly-in -> play.
 * W2's stage.js (?stage=1) and W3's preview.js (?models=1) stay available as separate entry points of pb/fouer.html.
 * W6 adds the walk (walk.js), the crowd (crowd.js), the soundscape (audio.js) and the rides (ride.js); window.__fouerHooks.startWalk / endWalk drive them,
 * window.__fouerGame (only with ?fouerDebug=1) exposes them for the flows. */
import { createRenderer } from '/pb/fouer/renderer.js';
import { createWorld } from '/pb/fouer/world/index.js';
import { createEnv } from '/pb/fouer/world/sky.js';
import { createTram } from '/pb/fouer/world/tram.js';
import { createPitches } from '/pb/fouer/world/pitches.js';
import { createFairLayer } from '/pb/fouer/models/fair.js';
import { loadBigModels } from '/pb/fouer/models/index.js';
import { createGame, pitchIndex } from '/pb/fouer/game.js';
import { createSceneBridge } from '/pb/fouer/scene.js';
import { createUi } from '/pb/fouer/ui.js';
import { createSfx } from '/pb/fouer/sfx.js';
import { createAudio } from '/pb/fouer/audio.js';
import { createMask, createWalk } from '/pb/fouer/walk.js';
import { createCrowd } from '/pb/fouer/crowd.js';
import { createRide } from '/pb/fouer/ride.js';
import { createEvents } from '/pb/fouer/events.js';
import { CORRIDORS } from '/pb/fouer/models/npc.js';
import { ENTRANCES } from '/pb/fouer/models/props.js';
import { LANGS, t as translate, formatMoney } from '/pb/fouer/i18n.js';
import { PITCHES, ITEM_BY_ID } from '/pb/fouer/data.js';

const T = window.THREE;
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const LANG_KEY = 'pb_fouer_lang';

/** A URL parameter of this page or, inside the arcade's srcdoc frame, of the arcade page (same origin). */
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
    if (site === 'fr') return 'en';
  } catch (error) { /* storage blocked */ }
  return 'lb';
}


async function boot() {
  const canvas = $('fouerCanvas');
  const lang = pickLang();
  document.documentElement.lang = lang;
  const setLoad = (p, msg) => { $('bar').firstElementChild.style.width = Math.round(p * 100) + '%'; if (msg) $('loadMsg').textContent = msg; };
  setLoad(0.02, translate(lang, 'load.start'));
  const testMode = window.__pbTestMode === true;
  const debug = param('fouerDebug') === '1';
  let clockOffset = 0;
  if (testMode && param('fouerDate')) {          // test override for the Fouer calendar, ONLY in test mode
    const parsed = Date.parse(param('fouerDate'));
    if (Number.isFinite(parsed)) clockOffset = parsed - Date.now();
  }
  const now = () => Date.now() + clockOffset;

  const r = createRenderer({ THREE: T, canvas });
  const modelsReady = loadBigModels();      // wheel, towers, coasters, halls (index.js BIG_FILES; a missing file is skipped)
  const game = createGame({ win: window, storage: (() => { try { return localStorage; } catch (error) { return null; } })(), now, testMode, name: (() => { try { return localStorage.getItem('playerName') || ''; } catch (error) { return ''; } })() });
  const started = game.start();
  started.catch(() => {});      // awaited below; this only keeps an early failure from being reported twice

  let world;
  try {
    world = await createWorld({
      T, TS: window.TS, r, quality: r.state.quality, onProgress: (p, msg) => setLoad(0.05 + p * 0.7, msg),
      parts: {
        tram: w => createTram({ T, world: w, bundle: w.bundle }),
        pitches: async w => { const p = await createPitches({ T, world: w }); r.gameRoot.add(p.group); return p; },
      },
    });
  } catch (error) {
    console.error('[fouer] world failed', error);
    $('loadMsg').textContent = translate(lang, 'load.fail');
    document.documentElement.dataset.bootError = 'world';
    throw error;
  }
  if (world.parts.tram) world.root.add(world.parts.tram.group);
  setLoad(0.8, translate(lang, 'load.start'));
  await modelsReady;
  const markers = world.parts.pitches;
  markers.setMode('outline');
  const fair = await createFairLayer({ T, root: r.gameRoot, pitches: markers.items, groundY: (u, w) => world.groundY(u, w), quality: r.state.quality, fieldPoly: world.fieldPoly, renderer: r, world });
  let scene = null; let crowd = null; let events = null;
  world.parts.fair = { setNight: k => { fair.setNight(k); if (scene) scene.setNight(k); if (crowd) crowd.setNight(k); if (events) events.setNight(k); }, dispose: () => fair.dispose() };
  r.on('quality', q => { fair.setQuality(q); if (crowd) crowd.setQuality(q); });
  setLoad(0.9, translate(lang, 'load.start'));

  // a first-time player starts at golden hour with clear weather (still "Random": the day drifts on from there)
  const env = createEnv({ T, scene: r.scene, renderer: r.renderer, world, quality: r.state.quality });
  world.env = env;
  const storedLook = (() => { try { return localStorage.getItem('pb_fouer_time') || localStorage.getItem('pb_fouer_weather'); } catch (error) { return 'x'; } })();
  if (!storedLook && !param('fouerTime') && !param('fouerTimeMode') && !param('fouerWeather')) {
    env.setHour(17.4); env.setTime('random', false);
    // Random weather that happens to start clear: re-roll from a neutral state until it does (the sky module has no "random, starting clear" call)
    for (let i = 0; i < 12; i++) { env.setWeatherNow('cloudy'); env.setWeather('random', false); if (env.getState().weather === 'clear') break; }
    if (env.getState().weather !== 'clear') { env.setWeatherNow('clear'); env.setWeather('random', false); env.setWeatherNow('clear'); }
  }
  r.poses.overview = Object.assign({}, r.framePose());

  await started;
  let sfx = null; let ui = null; let walk = null; let ride = null;
  scene = createSceneBridge({ T, r, world, fair, markers, game, quality: r.state.quality, onGates: () => { ui.toast(translate(ui.lang, 'toast.entrance')); sfx.star(); } });
  // ---- W6: walkable mask, crowd, soundscape, rides, walk
  const rects = scene.rects;
  const faces = PITCHES.map(p => p.face);
  // the street the tram runs in (Allée Scheffer + the Theater stop and the plaza beside the NE portal): samples of the track in game metres, every 5 m
  const streetSamples = (() => {
    const tr = world.parts.tram && world.parts.tram.track; if (!tr) return [];
    const out = [];
    for (let s = 8405; s <= 8910; s += 5) {
      const a = tr.at(s), b = tr.at(s + 1); const A = world.toGame(a.x, a.z), B = world.toGame(b.x, b.z); const l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      out.push({ u: A[0], w: A[1], tu: (B[0] - A[0]) / l, tw: (B[1] - A[1]) / l });
    }
    return out;
  })();
  const npcInfo = fair.baseInfo && fair.baseInfo.npc;
  const mask = createMask({
    fieldPoly: world.fieldPoly, corridors: CORRIDORS, rects, faces, entrances: ENTRANCES, lane: streetSamples,
    grid: npcInfo && npcInfo.grid ? { g: npcInfo.grid, nu: npcInfo.gridDims[0], nw: npcInfo.gridDims[1], cell: npcInfo.gridDims[2], u0: npcInfo.gridDims[3], w0: npcInfo.gridDims[4] } : null,
  });
  const getFocus = () => (walk && walk.active && !(ride.active && ride.high) ? { x: walk.view.x, z: walk.view.z, yaw: walk.view.yaw, walk: true } : { x: r.rig.cu, z: r.rig.cw, yaw: r.rig.cyaw, walk: false });
  const laneLine = streetSamples.map(q => ({ x: q.u, z: q.w }));
  crowd = createCrowd({ T, r, world, game, mask, corridors: CORRIDORS, polylines: laneLine.length > 5 ? [{ name: 'allee', pts: laneLine, lane: 2.3, chunk: 4 }] : [], rects, faces, quality: r.state.quality, env, getFocus, onBleat: () => ui.sheepTapped() });
  const items = { faceOf: i => faces[i], cycleOf: i => { const pit = fair.pits.get(PITCHES[i].id); return pit && pit.near && pit.near.userData.cycle ? pit.near.userData.cycle : 45; } };
  const getListener = () => {
    if (walk && walk.active) { const d = r.camera.getWorldDirection(new T.Vector3()); return { x: r.camera.position.x, y: r.camera.position.y, z: r.camera.position.z, fx: d.x, fy: d.y, fz: d.z, dist: 0 }; }
    return { x: r.rig.cu, y: r.rig.cy + 2, z: r.rig.cw, fx: Math.cos(r.rig.cyaw), fy: 0, fz: Math.sin(r.rig.cyaw), dist: r.rig.cdist };
  };
  const audio = createAudio({ game, r, world, env, tram: world.parts.tram, rects, items, crowd, getListener });
  sfx = createSfx(audio);
  const hooks = {
    walking: false,
    onWalkChange() {},
    startWalk() { if (walk) walk.start(); },
    endWalk() { if (walk) walk.end(); },
    /** a tap on Hämmi (builder view and walk): bleat */
    tapSheep(x, y) { if (!crowd.tapSheep(x, y)) return false; crowd.bleat(); audio.unlock(); audio.bleat(); return true; },
    /** W7: the pill "Hämmi has a present" flies the builder camera to the sheep */
    findSheep() { const p = crowd.sheepPosition(); if (!p || (walk && walk.active)) return false; r.flyTo({ tu: p.x, tw: p.z, yaw: r.rig.yaw, dist: 70, tilt: 0 }, 1.1); return true; },
    /** W7: a visited fair (gallery) hides the guests and Hämmi: they belong to the player's own fair */
    setCrowdVisible(on) { crowd.group.visible = on; crowd.sheep.visible = on; },
    /** W7: the event controller, reachable before it exists (the UI is built first) */
    events: { watch: id => (events ? events.watch(id) : false), replay: () => { if (events) events.replay(); }, leaveCinema: () => { if (events) events.leaveCinema(); }, get cinema() { return events ? events.cinema : false; } },
  };
  window.__fouerHooks = hooks;
  ui = createUi({
    root: $('ui'), game, scene, r, env, hooks, sfx, lang, debug,
    setLang: code => { try { localStorage.setItem(LANG_KEY, code); } catch (error) { /* storage blocked */ } if (walk) walk.refreshLabels(); if (events) events.setLang(code); },
  });
  let fairTime = 0;       // the fair layer's own clock (fair.update(dt) adds dt every frame): the coaster ride needs the model time
  ride = createRide({ T, r, world, fair, game, scene, ui, audio, crowd, rects, faces, getWalk: () => walk, getFairTime: () => fairTime, translate });
  walk = createWalk({ T, r, world, fair, game, scene, ui, sfx, audio, crowd, ride, mask, env, hooks, rects, items, tram: world.parts.tram, translate });
  events = createEvents({ T, r, world, game, env, audio, ui, translate });
  events.setNight(world.nightK || 0);
  scene.sync();
  fair.flush(r.camera);

  r.on('frame', dt => {
    env.update(dt, r.camera);
    world.update(dt);
    fair.update(dt, r.camera);
    fairTime += dt;
    game.update();
    scene.update(dt);
    ride.update(dt);          // after the fair (the wheel has moved) and before the walk camera is placed
    walk.update(dt);
    crowd.update(dt);
    audio.update(dt);
    events.update(dt);
    ui.update(dt);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.flushSave(); });

  // live admin gifts from the arcade: only after the local save is loaded and the cloud save was requested (game.start did both)
  if (window.IdleExtras && !testMode) {
    const gifts = window.IdleExtras.liveGifts({ game: 'park', format: formatMoney, read: () => game.state.gi,
      apply: (amount, ids) => game.applyGift(amount, ids), save: () => game.flushSave(), refresh: () => ui.refreshAll() });
    gifts.ready();
  }

  // camera: a fresh player flies in towards the glowing pitch, everybody else sees their fair
  const noFly = param('fouerNoFly') === '1';
  const tut = game.tutorial();
  let goal;
  if (tut.active && tut.mode === 'fresh') goal = { tu: 70, tw: 44, yaw: 0, dist: 118, tilt: 0 };
  else {
    const built = game.state.pitches.map((e, i) => e && PITCHES[i]).filter(Boolean);
    goal = built.length ? { tu: built.reduce((a, p) => a + p.u, 0) / built.length, tw: built.reduce((a, p) => a + p.w, 0) / built.length, yaw: 0, dist: 190, tilt: 0 } : r.framePose();
  }
  if (noFly) r.setPose(goal, true);
  else {
    r.setPose({ tu: -40, tw: 66, yaw: -0.18, dist: 150, tilt: -12 * DEG }, true);
    r.flyTo(goal, 3.6);
    document.body.classList.add('intro');
    setTimeout(() => document.body.classList.remove('intro'), 3200);
  }
  r.start();
  setLoad(1, '');
  $('loading').classList.add('done');
  document.documentElement.dataset.fouerReady = '1';
  document.documentElement.dataset.fouerGame = '1';

  if (debug) {
    const presets = {
      overview: () => r.flyTo(r.framePose(), 0),
      close: () => r.flyTo(r.poses.close, 0), top: () => r.flyTo(r.poses.top, 0), reverse: () => r.flyTo(r.poses.reverse, 0), north: () => r.flyTo(r.poses.north, 0),
    };
    window.__fouer = {
      renderer: r.renderer, r, world, env, THREE: T, tram: world.parts.tram, pitches: markers,
      performanceSnapshot: () => r.performanceSnapshot(),
      setTime: h => (typeof h === 'string' ? env.setTime(h, false) : env.setHour(h)),
      setWeather: w => env.setWeatherNow(w),
      cameraPreset: name => { if (presets[name]) presets[name](); else throw new Error('unknown preset ' + name); },
      presets: Object.keys(presets),
      showPitches: m => markers.setMode(m === true ? 'glow' : m === false ? 'off' : m),
      setFreeCamera: o => r.setFreeCamera(o),
    };
    let accessOverlay = null;
    window.__fouerGame = {
      game, ui, scene, fair, sfx, hooks, r, world, env, markers, walk, crowd, audio, ride, mask, events,
      /** access wave: the walkway network painted on the ground (alleys blue, lanes red, service lane orange, forecourts green, entrance points white) */
      async accessOverlay(on = true) {
        if (!accessOverlay) { const m = await import('/pb/fouer/models/access-debug.js'); accessOverlay = m.createAccessOverlay({ T, root: r.gameRoot, groundY: (u, w) => world.groundY(u, w), pitches: PITCHES }); }
        accessOverlay.show(on); return on;
      },
      advance: (sec) => game.advance(sec),
      setClockOffset: ms => { clockOffset = ms; },
      snapshot() {
        const perf = r.performanceSnapshot(); const stats = fair.stats();
        return { drawCalls: perf.drawCalls, triangles: perf.triangles, fps: perf.fps, quality: perf.quality, fair: stats, built: game.builtCount(), stars: game.stars(),
          cash: Math.floor(game.state.c), tb: Math.floor(game.state.tb), tu: game.state.tu, income: Math.round(game.info().incomePerMin), geometries: perf.geometries, textures: perf.textures };
      },
      /** fills every pitch with a mid-game set (for the perf probe and the screenshots) */
      fillFair(level = 2, maxStar = 5) {
        const bySize = { S: ['kachel', 'fritten', 'lous', 'kanner', 'wurscht', 'zocker', 'lukas', 'mandel', 'waffel', 'crepes', 'schiess'], M: ['fesch', 'kette', 'bayern', 'happy', 'break', 'musik', 'takeoff', 'jules', 'hangover', 'infinity'], L: ['scooter', 'tent', 'maus', 'geister', 'splash', 'booster'], XL: ['alpina', 'looping'], W: ['wheel'] };
        const used = { S: 0, M: 0, L: 0, XL: 0, W: 0 }; const copies = {};
        const pitches = PITCHES.map((p, i) => {
          if (p.star > maxStar) return null;
          const list = bySize[p.size].filter(id => ITEM_BY_ID[id].star <= maxStar);
          if (!list.length) return null;
          let item = list[used[p.size]++ % list.length];
          copies[item] = (copies[item] || 0) + 1; if (copies[item] > 3) item = list[0];
          return { k: item, lv: Math.min(3, level), look: i % 3, fl: 0 };
        });
        game.debugSetState({ ...game.state, pitches, pu: 2 ** 34 - 1, c: Math.max(game.state.c, 1e6), tu: 8, rb: maxStar >= 5 ? 1000 : 0 });
      },
    };
  }
}

boot().catch(error => {
  console.error('[fouer] boot failed', error);
  document.documentElement.dataset.bootError = document.documentElement.dataset.bootError || 'boot';
  const msg = $('loadMsg'); if (msg) msg.textContent = (msg.textContent || '') + ' ' + error.message;
});
