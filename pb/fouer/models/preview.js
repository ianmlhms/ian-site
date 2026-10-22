/* Schueberfouer Tycoon, W3: the ?models=1 preview page (pb/fouer.html?models=1).
 *   ?models=1                      turntable grid of every model (no world; sky / light / fog of the real env)
 *   ?models=1&view=single&item=kachel
 *   ?models=1&view=fair            the full fair: all 34 pitches with a mixed max-level set + NPC background fair + props on the real Glacis
 * Extra params: look=0|1|2  level=1..4  time=day|evening|night  q=low|medium|high  far=1  fouerDebug=1  seed=n
 * Always exposes window.__fouerModels (tests and the photo comparisons use it). */
import { createRenderer } from '/pb/fouer/renderer.js';
import { createEnv } from '/pb/fouer/world/sky.js';
import { buildModel, modelIds, loadBigModels, REGISTRY } from '/pb/fouer/models/index.js';
import { getMaterials } from '/pb/fouer/models/materials.js';
import { ITEM_BY_ID } from '/pb/fouer/data.js';

const T = window.THREE;
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const view = qs.get('view') || 'grid';
const state = { look: +(qs.get('look') || 0), level: +(qs.get('level') || 1), time: qs.get('time') || 'day', item: qs.get('item') || 'kachel', far: qs.get('far') === '1', spin: qs.get('spin') !== '0', seed: +(qs.get('seed') || 1) };
const HOURS = { day: 13, evening: 19.5, night: 22.5 };
const SIZE_OF = (id) => (ITEM_BY_ID[id] ? ITEM_BY_ID[id].size : 'M');
const FOOT = { S: [8, 8], M: [16, 16], L: [30, 18], XL: [56, 30], W: [40, 24] };
const setLoad = (p, msg) => { const bar = $('bar'); if (bar) bar.firstElementChild.style.width = Math.round(p * 100) + '%'; if (msg && $('loadMsg')) $('loadMsg').textContent = msg; };

async function boot() {
  const canvas = $('fouerCanvas');
  const r = createRenderer({ THREE: T, canvas });
  const M = getMaterials();
  if (qs.get('big') !== '0') await loadBigModels();
  setLoad(0.2, 'models');
  document.title = 'Fouer models';
  for (const id of ['title', 'envBtn', 'frameBtn', 'menuBtn', 'envPop', 'menu']) { const el = $(id); if (el) el.hidden = true; }

  let world = null; let fairLayer = null; let env;
  const gridGroup = new T.Group(); gridGroup.name = 'fouer-model-grid';
  const stubWorld = { glacis: { chunks: [], ground: { matSurface: { color: new T.Color(0x444444) } }, root: { getObjectByName: () => null } }, setNight: (k) => onNight(k), nightK: 0 };

  function onNight(k) {
    M.setNight(k);
    models.forEach((m) => m.group.userData.setNight && m.group.userData.setNight(k));
    if (fairLayer) fairLayer.setNight(k);
    state.nightK = k;
  }
  const models = [];
  let simT = 0;

  if (view === 'fair') {
    const [{ createWorld }, { createTram }, { createPitches }, fairMod] = await Promise.all([
      import('/pb/fouer/world/index.js'), import('/pb/fouer/world/tram.js'), import('/pb/fouer/world/pitches.js'), import('/pb/fouer/models/fair.js'),
    ]);
    world = await createWorld({
      T, TS: window.TS, r, quality: r.state.quality, onProgress: setLoad,
      parts: {
        tram: (w) => createTram({ T, world: w, bundle: w.bundle }),
        pitches: async (w) => { const p = await createPitches({ T, world: w }); r.gameRoot.add(p.group); return p; },
      },
    });
    world.root.add(world.parts.tram.group);
    world.parts.pitches.setMode('off');
    fairLayer = await fairMod.createFairLayer({ T, root: r.gameRoot, pitches: world.parts.pitches.items, groundY: (u, w) => world.groundY(u, w), quality: r.state.quality, fieldPoly: world.fieldPoly, renderer: r, world });
    world.parts.fair = fairLayer;
    env = createEnv({ T, scene: r.scene, renderer: r.renderer, world, quality: r.state.quality });
    world.env = env;
    r.on('frame', (dt) => { simT += dt; env.update(dt, r.camera); world.update(dt); fairLayer.update(dt, r.camera); });
    r.poses.overview = Object.assign({}, r.framePose());
    fairMod.fillShowcase(fairLayer, { level: state.level || 4, look: qs.get('look') === null ? 'mixed' : state.look, seed: state.seed });
  } else {
    r.scene.add(gridGroup);
    const ground = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshLambertMaterial({ color: 0x45484e }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(150, -0.02, 60); gridGroup.add(ground);
    r.gameRoot.add(new T.Group());
    env = createEnv({ T, scene: r.scene, renderer: r.renderer, world: stubWorld, quality: r.state.quality });
    r.on('frame', (dt) => {
      simT += dt; env.update(dt, r.camera); M.tick(simT);
      models.forEach((m, i) => { if (state.spin && view === 'grid') m.group.rotation.y = simT * 0.35 + i; const a = m.group.userData.animate; if (a) a(simT, dt, state.nightK); });
    });
  }
  env.setWeatherNow('clear');
  const setTime = (name) => { state.time = name; env.setHour(HOURS[name] === undefined ? +name : HOURS[name]); syncUi(); };

  /* ---- grid / single content */
  const labels = $('mlabels') || (() => { const d = document.createElement('div'); d.id = 'mlabels'; d.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font:600 11px ui-rounded,sans-serif;color:#fff'; $('shell').appendChild(d); return d; })();
  function clearModels() { models.forEach((m) => { gridGroup.remove(m.group); m.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); if (m.foot) { gridGroup.remove(m.foot); m.foot.geometry.dispose(); m.foot.material.dispose(); } if (m.label) m.label.remove(); }); models.length = 0; }
  function footprint(w, d) {
    const g = new T.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.16, depthWrite: false })); return m;
  }
  function rebuild() {
    if (view === 'fair') { fairMod_refill(); return; }
    clearModels();
    const BIG = ['wheel', 'jules', 'hangover', 'booster', 'alpina', 'looping', 'maus', 'geister', 'splash', 'scooter', 'tent'];
    const ids = view === 'single' ? [state.item] : modelIds().filter((id) => qs.get('big') === '1' || !BIG.includes(id));
    const cols = view === 'single' ? 1 : 6; const gap = view === 'single' ? 0 : 24;
    ids.forEach((id, i) => {
      const t0 = performance.now();
      let g; try { g = buildModel(id, { look: state.look, level: state.level, quality: r.state.quality, seed: state.seed, far: state.far }); } catch (e) { console.error('[fouer] build failed', id, e); return; }
      const ms = performance.now() - t0;
      const col = i % cols; const row = Math.floor(i / cols);
      const x = view === 'single' ? 150 : 150 + (col - (cols - 1) / 2) * gap; const z = view === 'single' ? 60 : 60 + row * gap;
      g.position.set(x, 0, z); gridGroup.add(g);
      const sz = FOOT[SIZE_OF(id)] || FOOT.M; const foot = footprint(sz[0], sz[1]); foot.position.set(x, 0.03, z); gridGroup.add(foot);
      const label = document.createElement('span'); label.style.cssText = 'position:absolute;transform:translate(-50%,0);text-shadow:0 1px 3px #000;white-space:nowrap'; label.textContent = id; labels.appendChild(label);
      models.push({ id, group: g, foot, label, ms, x, z });
      g.userData.setNight(state.nightK || 0);
    });
    if (view === 'single') r.setPose({ tu: 150, tw: 60, yaw: 0.5, dist: 40, tilt: 0 }, true);
    else { const rows = Math.ceil(ids.length / cols); r.setPose({ tu: 150, tw: 60 + (rows - 1) * gap / 2, yaw: 0, dist: 190, tilt: 0 }, true); }
  }
  let fairMod_refill = () => {};
  if (view === 'fair') { const fm = await import('/pb/fouer/models/fair.js'); fairMod_refill = () => fm.fillShowcase(fairLayer, { level: state.level, look: qs.get('look') === null ? 'mixed' : state.look, seed: state.seed }); }
  r.on('frame', () => {
    if (view === 'fair' || !labels) return;
    const w = canvas.clientWidth; const h = canvas.clientHeight; const v = new T.Vector3();
    models.forEach((m) => { v.set(m.x, 0, m.z + (SIZE_OF(m.id) === 'S' ? 5 : 9)).project(r.camera); m.label.style.display = v.z < 1 ? '' : 'none'; m.label.style.left = ((v.x + 1) / 2 * w) + 'px'; m.label.style.top = ((1 - v.y) / 2 * h) + 'px'; });
  });

  /* ---- ui */
  const bar = document.createElement('div');
  bar.id = 'mbar'; bar.style.cssText = 'position:absolute;left:8px;bottom:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:#0f2430e8;border:1px solid #ffffff26;border-radius:12px;padding:6px 8px;font:600 12px ui-rounded,sans-serif;z-index:4';
  const chip = (label, on, fn, group) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.group = group; b.dataset.value = label; b.className = 'chip'; b.style.cssText = 'min-height:30px;min-width:30px;padding:2px 9px;font-size:12px'; b.addEventListener('click', fn); b.setAttribute('aria-pressed', 'false'); return b; };
  const groups = {};
  const addGroup = (name, items, current, onPick) => {
    const wrap = document.createElement('span'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center'; const lab = document.createElement('small'); lab.textContent = name; lab.style.opacity = 0.7; wrap.appendChild(lab);
    groups[name] = items.map(([label, value]) => { const c = chip(label, false, () => { onPick(value); syncUi(); }, name); c.dataset.value = String(value); wrap.appendChild(c); return c; });
    groups[name].current = current; bar.appendChild(wrap);
  };
  const go = (patch) => { const u = new URLSearchParams(location.search); Object.entries(patch).forEach(([k, v]) => u.set(k, v)); location.search = u.toString(); };
  addGroup('view', [['grid', 'grid'], ['single', 'single'], ['fair', 'fair']], () => view, (v) => go({ view: v }));
  addGroup('look', [['Trad', 0], ['Neon', 1], ['Retro', 2]], () => state.look, (v) => { state.look = v; rebuild(); });
  addGroup('level', [['L1', 1], ['L2', 2], ['L3', 3], ['L4', 4]], () => state.level, (v) => { state.level = v; rebuild(); });
  addGroup('time', [['day', 'day'], ['evening', 'evening'], ['night', 'night']], () => state.time, (v) => setTime(v));
  addGroup('far', [['near', false], ['far', true]], () => state.far, (v) => { state.far = v; rebuild(); });
  if (view === 'single') {
    const sel = document.createElement('select'); sel.style.cssText = 'font:600 12px sans-serif;min-height:30px';
    modelIds().forEach((id) => { const o = document.createElement('option'); o.value = id; o.textContent = id; sel.appendChild(o); }); sel.value = state.item;
    sel.addEventListener('change', () => { state.item = sel.value; rebuild(); }); bar.appendChild(sel);
  }
  const stats = document.createElement('span'); stats.id = 'mstats'; stats.style.cssText = 'margin-left:auto;opacity:.85;font-weight:500'; bar.appendChild(stats);
  $('shell').appendChild(bar);
  function syncUi() { Object.values(groups).forEach((g) => g.forEach((c) => c.setAttribute('aria-pressed', String(String(g.current()) === c.dataset.value)))); }
  setInterval(() => {
    const s = r.performanceSnapshot(); const tris = models.reduce((a, m) => a + (m.group.userData.tris || 0), 0);
    stats.textContent = `${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(1)}k tris · ${s.fps} fps` + (models.length ? ` · ${models.length} models (${(tris / 1000).toFixed(1)}k)` : '');
  }, 500);

  window.__fouerModels = {
    r, T, env, M, state, models, view, world, fair: fairLayer, buildModel, modelIds, REGISTRY,
    rebuild, setTime, setLook: (v) => { state.look = v; rebuild(); syncUi(); }, setLevel: (v) => { state.level = v; rebuild(); syncUi(); }, setFar: (v) => { state.far = !!v; rebuild(); },
    setItem: (id) => { state.item = id; rebuild(); }, setSpin: (v) => { state.spin = !!v; },
    performanceSnapshot: () => r.performanceSnapshot(), atlas: () => M.atlasStats(),
    setFreeCamera: (o) => r.setFreeCamera(o), setPose: (p, i = true) => r.setPose(p, i),
    onNight,
  };
  if (qs.get('fouerDebug') === '1') window.__fouer = { renderer: r.renderer, r, world, env, THREE: T, performanceSnapshot: () => r.performanceSnapshot(), setFreeCamera: (o) => r.setFreeCamera(o), setTime: (h) => (typeof h === 'string' ? setTime(h) : env.setHour(h)), setWeather: (w) => env.setWeatherNow(w) };
  rebuild(); setTime(state.time); syncUi();
  if (view === 'fair') { r.setPose(r.framePose(), true); }
  r.start();
  setLoad(1, 'ready');
  $('loading').classList.add('done');
  document.documentElement.dataset.fouerReady = '1';
}
boot().catch((e) => { console.error('[fouer] models preview failed', e); document.documentElement.dataset.bootError = 'models'; const m = $('loadMsg'); if (m) m.textContent = 'Failed: ' + e.message; });
