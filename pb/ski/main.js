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
import { createPoles, createRunProps } from './props.js';
import { createLifts } from './lifts.js';
import { createVillage } from './village.js';
import { createLandmarks } from './landmarks.js';
import { createPisteSet } from './pistes.js';
import { createSkierState, stepSkier } from './skier.js';
import { createSkierModel } from './skier-model.js';
import { createChaseCamera } from './camera.js';
import { createInput } from './input.js';
import { createSnowfall, createSpray } from './effects.js';
import { createRun } from './game.js';
import { createBot } from './bot.js';
import { encodeGhost, decodeGhost, ghostAt } from './ghost.js';
import { createStore, recordRun, withLast, pisteKey, createBoards, formatTime } from './progress.js';
import { createUi } from './ui.js';
import { createPisteMap } from './map.js';

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
  const ui = createUi(document.getElementById('ui'));
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
  const field = createField({ resort, far: core.far, classes: core.classes, net });
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
  const scatterView = createScatterView({ scene, scatter, env, quality });
  const poles = createPoles({ scene, resort, height: (x, z) => field.height(x, z) });
  const skier = createSkierModel({});
  const ghostModel = createSkierModel({ ghost: true });
  scene.add(skier.root, ghostModel.root);
  ghostModel.setVisible(false);
  const chase = createChaseCamera(surface);
  let snowfall = createSnowfall({ scene, env, count: quality.snowflakes });
  const spray = createSpray({ scene, count: quality.spray });
  let lifts = null, village = null, landmarks = null;

  // streamed height tiles change the heights under them: drop every cache that read them
  streamer.onTile((rect) => {
    surface.invalidate(...rect);
    terrain.invalidate(...rect);
    scatter.invalidate(...rect);
    scatterView.invalidate();
    poles.reset();
    if (runProps && game.piste) { runProps.dispose(); runProps = createRunProps({ scene, piste: game.piste, height: (x, z) => surface.height(x, z), gates: game.run ? game.run.gates : [] }); }
    if (streamer.done()) document.documentElement.dataset.skiTilesDone = '1';
    if (streamer.done() && !lifts) {
      lifts = createLifts({ scene, resort, height: (x, z) => field.height(x, z) });
      landmarks = createLandmarks({ scene, resort, height: (x, z) => surface.height(x, z), pistes });
      mark('lifts');
    }
  });
  loadExtras(core.root).then(({ buildings }) => { village = createVillage({ scene, rows: buildings, env }); mark('village'); }).catch((error) => console.warn('[ski] buildings failed', error.message));

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

  function placeAt(x, z, heading) {
    const y = surface.height(x, z);
    game.state = createSkierState(x, z, heading, y);
    chase.snap(game.state);
  }

  function pisteBest(p) { return store.get().best[pisteKey(rid, p.id)] || 0; }

  // ---------------- screens ----------------
  let picker = null, mapScreen = null, pisteMap = null, finishCard = null, menuCard = null;
  function showPicker() {
    game.screen = 'picker';
    hud.show(false); input.showTouch(false);
    picker = ui.showResorts({ current: rid, onPick: (id) => { if (id && id !== rid) { switchResort(id); return; } picker.close(); picker = null; showMap(); } });
    document.documentElement.dataset.skiScreen = 'picker';
  }
  /** Another resort: remember it and load the page again (one resort per page life: its tiles, textures and caches go with it). */
  function switchResort(id) {
    store.set(withLast(store.get(), id, null));
    LOAD.set(0.1, 'Skigebitt gëtt gewiesselt …');
    try {
      const u = new URL(location.href);
      if (/^https?:$/.test(u.protocol) && u.searchParams.has('resort')) { u.searchParams.set('resort', id); u.searchParams.delete('piste'); location.replace(u.href); return; }
    } catch (error) { /* about:srcdoc inside the arcade: a plain reload */ }
    location.reload();
  }
  function showMap() {
    game.screen = 'map';
    game.phase = 'idle';
    hud.show(false); input.showTouch(false); input.setEnabled(false);
    if (finishCard) { finishCard.close(); finishCard = null; }
    mapScreen = ui.showMap({
      resort, pistes, best: pisteBest, env, gfx: GFX(),
      onSelect: (p, center) => selectPiste(p, center),
      onStart: () => startRun(game.piste, MODES.run),
      onBack: () => { mapScreen.close(); mapScreen = null; pisteMap = null; showPicker(); },
    });
    pisteMap = createPisteMap({ canvas: mapScreen.canvas, resort, imageUrl: core.root + resort.map.file, pistes, onPick: (p) => selectPiste(p, false) });
    mapScreen.zoomButtons.forEach((b) => b.addEventListener('click', () => pisteMap.zoomBy(b.dataset.z === 'in' ? 1.5 : 1 / 1.5)));
    const last = store.get().last;
    const first = (last && last.resort === rid && pistes.byId.get(last.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0];
    selectPiste(first, true);
    document.documentElement.dataset.skiScreen = 'map';
  }
  function selectPiste(p, center) {
    if (!p) return;
    game.piste = p;
    streamer.focus(p.top.x, p.top.z);
    const a = p.at(2, {});
    placeAt(a.x, a.z, Math.atan2(a.dz, a.dx));
    boards.select(rid, p, resort.short);
    if (mapScreen) { mapScreen.show(p, pisteBest(p)); pisteMap.select(p, center); }
    updateStartStatus();
  }
  let readyFor = null;
  function updateStartStatus() {
    if (!mapScreen || !game.piste) return;
    const p = game.piste;
    const pending = streamer.pendingNear(p.top.x, p.top.z, 1500);
    const ready = pending === 0 && terrain.stats.pending === 0;
    mapScreen.status(ready ? 'Prett.' : `Pist gëtt gelueden … (${pending} Stécker)`, ready);
    document.documentElement.dataset.skiStartReady = ready ? '1' : '0';
    readyFor = ready ? p.id : null;
  }

  function startRun(p, mode) {
    if (!p) return;
    if (mapScreen) { mapScreen.close(); mapScreen = null; pisteMap = null; }
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
    game.bot = params.bot ? createBot(p) : null;
    game.assisted = false;
    store.set(withLast(store.get(), rid, p.id));
    boards.select(rid, p, resort.short);
    hud.show(true); hud.setPiste(p, mode); hud.setClock(mode === MODES.run ? 0 : null, 0); hud.setSplit(''); hud.setGates(game.run.gates.length ? `Slalom: 0 / ${game.run.gates.length}` : '');
    input.showTouch(input.isTouch() || matchMedia('(pointer: coarse)').matches);
    input.setEnabled(true);
    streamer.focus(a.x, a.z);
    if (mode === MODES.run) { game.phase = 'countdown'; game.countdown = params.auto ? 0.01 : 3; }
    else { game.phase = 'running'; hud.count(''); }
    if (window.Arcade && window.Arcade.startRun) window.Arcade.startRun();
    canvas.focus({ preventScroll: true });
    mark('start');
  }

  function finish(ev) {
    game.phase = 'finished';
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
    const conts = pistes.continuations(p);
    const order = pistes.list;
    const next = conts[0] || order[(order.indexOf(p) + 1) % order.length];
    const cont = conts[0] || null;
    hud.count('');
    finishCard = ui.showFinish({
      piste: p, result, bestMs: store.get().best[key] || 0, improved, next, cont: cont && cont !== next ? cont : (cont ? cont : null),
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

  function openMenu() {
    if (game.screen !== 'ski' || menuCard || finishCard) return;
    game.paused = true;
    input.setEnabled(false);
    menuCard = ui.showMenu({
      env, gfx: GFX(),
      onResume: () => { menuCard = null; game.paused = false; input.setEnabled(game.phase !== 'finished'); },
      onAgain: () => { menuCard = null; game.paused = false; startRun(game.piste, MODES.run); },
      onMap: () => { menuCard = null; game.paused = false; showMap(); },
    });
  }

  function onAction(action) {
    if (action === 'weather') { const m = env.cycleWeather(); hud.toast(`Wieder: ${WEATHER_LABEL[m]}${m === 'random' ? ` (${WEATHER_LABEL[env.state.weatherId]})` : ''}`); }
    else if (action === 'time') { const m = env.cycleTime(); hud.toast(`Zäit: ${TIME_LABEL[m]}${m === 'random' ? ` (${TIME_LABEL[env.state.timeId]})` : ''}`); }
    else if (action === 'reset') { if (game.screen === 'ski' && game.phase === 'running') respawn('Zréck op d\'Pist'); }
    else if (action === 'menu') { if (menuCard) { menuCard.close(); menuCard = null; game.paused = false; input.setEnabled(true); } else openMenu(); }
    else if (action === 'map') { if (game.screen === 'ski') showMap(); }
    else if (action === 'confirm') { if (game.screen === 'map' && readyFor) startRun(game.piste, MODES.run); }
  }
  if (window.Arcade && window.Arcade.onRestart) window.Arcade.onRestart(() => { if (game.piste) startRun(game.piste, MODES.run); });

  // quality: the shared Grafik level; a watchdog only ever steps down
  function applyQuality(next) {
    level = next; quality = QUALITY[level];
    renderer.setPixelRatio(pixelRatio()); resize();
    camera.far = quality.far * 1.3; camera.updateProjectionMatrix();
    snowMat = createSnowMaterial(env, { cheap: quality.cheapSnow, treeRadius: quality.treeRadius, forest: forestTex });
    terrain.setMaterial(snowMat);
    scatterView.setQuality(quality);
    poles.reset();
    mark(`quality ${level}`);
  }
  GFX().onChange((l) => { if (!params.q) applyQuality(l); });
  let slowFor = 0;

  // ---------------- loop ----------------
  let last = performance.now(), acc = 0, hudT = 0, time = 0;
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
        if (game.countdown <= 0) { game.phase = 'running'; document.documentElement.dataset.skiRunning = '1'; setTimeout(() => hud.count(''), 700); mark('go'); }
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
          const wasCrash = game.state.crash > 0;
          game.state = stepSkier(game.state, inp, world);
          if (!wasCrash && game.state.crash > 0) hud.toast(game.state.crashKind === 'tree' ? 'Aua, e Bam!' : game.state.crashKind === 'rock' ? 'Aua, e Steen!' : 'Gefall!');
          if (wasCrash && game.state.crash === 0) respawn('');
          if (game.phase === 'running') {
            const events = game.run.update(game.state, SKI.dt);
            for (const ev of events) {
              if (ev.type === 'finish' || ev.type === 'invalid') { finish(ev); break; }
              if (ev.type === 'offpiste') respawn('Zréck op d\'Pist');
              if (ev.type === 'missed-gate') { hud.toast('Paart verpasst: +5 s'); if (runProps) runProps.markGate(ev.index, false); }
            }
            if (game.mode !== MODES.run && game.run.progress > game.piste.length - 15 && game.phase === 'running') finish(null);
          }
        }
        if (acc > SKI.dt * 6 * timescale) acc = 0;
      } else acc = 0;
    }
    const st = game.state;
    if (st) {
      skier.pose(st, (x, z, o) => surface.normal(x, z, o), time);
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
      poles.update(camera.position.x, camera.position.z, quality.markerRadius);
      if (lifts) lifts.update(time, camera.position.x, camera.position.z, quality.liftRadius);
      if (village) village.update(camera.position.x, camera.position.z, quality.buildingRadius);
      if (landmarks) landmarks.update(camera.position.x, camera.position.z, quality.buildingRadius);
    }
    env.update(dt, time, camera);
    snowfall.update(time, camera, pixelRatio());
    if (game.screen === 'ski') {
      const t0 = performance.now();
      renderer.render(scene, camera);
      if (!params.q && game.phase === 'running' && level !== 'low') {
        slowFor = rawDt * 1000 > FRAME_BUDGET_MS[level] ? slowFor + rawDt : Math.max(0, slowFor - rawDt * 0.5);
        if (slowFor > 3) { slowFor = 0; const down = level === 'high' ? 'medium' : 'low'; applyQuality(down); hud.toast(`Grafik: ${GFX().LABELS[down]}`); }
      }
      void t0;
    }
    hudT += dt;
    if (hudT >= HUD_EVERY) {
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
    /** Fixed camera at (x, z) heightAbove m over the ground looking at (tx, tz) heightAbove2 m over its ground; null = chase camera again. */
    setCamera(x, z, above, tx, tz, above2 = 0, fov = 55) { if (x === null) { game.camPose = null; return; } game.camPose = { x, z, y: field.height(x, z) + above, tx, tz, ty: field.height(tx, tz) + above2, fov }; streamer.focus(x, z); }, start(id) { startRun(pistes.byId.get(id) || game.piste, MODES.run); }, select(id) { selectPiste(pistes.byId.get(id), true); },
    frames: () => { const f = [...frameTimes].sort((a, b) => a - b); return { n: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], max: f[f.length - 1] }; },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: terrain.stats.leaves, trees: scatterView.stats.trees, tilesLoaded: streamer.stats.loaded, tilesTotal: streamer.stats.total, level }),
    teleport(s) { if (game.run) { const p = game.piste.at(s, {}); placeAt(p.x, p.z, Math.atan2(p.dz, p.dx)); } },
    progress: () => store.get(),
  };

  // first build around the default piste behind the loading screen, then the picker (or straight onto the piste with ?auto=1)
  LOAD.set(0.75, 'Pisten ginn opgebaut …');
  const lastRun = store.get().last || {};
  const startPiste = pistes.byId.get(params.piste) || (lastRun.resort === rid && pistes.byId.get(lastRun.piste)) || pistes.byId.get(resort.start) || pistes.byId.get(DEFAULT_PISTE) || pistes.list[0];
  game.piste = startPiste;
  const a0 = startPiste.at(2, {});
  streamer.focus(a0.x, a0.z);
  placeAt(a0.x, a0.z, Math.atan2(a0.dz, a0.dx));
  const camOut = chase.update(game.state, 0.016, 0);
  camera.position.set(camOut.x, camOut.y, camOut.z);
  terrain.buildAll(camOut.x, camOut.z);
  renderer.compile(scene, camera);
  mark('first build');
  requestAnimationFrame(frame);
  LOAD.set(0.95, '');
  LOAD.done();
  document.documentElement.dataset.skiReady = '1';
  if (params.auto) {
    await streamer.ready(a0.x, a0.z, 1500);
    placeAt(a0.x, a0.z, Math.atan2(a0.dz, a0.dx));
    startRun(startPiste, MODES.run);
  } else showPicker();
  mark('ready');
}

boot().catch((error) => {
  console.error('[ski] boot failed', error);
  document.documentElement.dataset.bootError = error.message || 'boot';
  LOAD.fail(`Feeler: ${error.message}`);
});
