/* Schueberfouer Tycoon, W2: renderer, builder camera, input and the render loop.
 *
 * - WebGL renderer + scene + two roots: scene > worldRoot (Luxtram-local frame, owned by world/*) and scene > gameRoot (GAME frame: u toward NE,
 *   w toward Boulevard de la Foire, y up; W3+ put pitch dressing / attractions / crowds here).
 * - Builder camera: a narrow perspective (32 deg) 3/4 view around a ground target (tu, tw).  Pan (1 finger / mouse drag, grabs the ground under the
 *   finger), pinch to zoom + twist to rotate (2 fingers), wheel zoom toward the cursor, right-drag or Alt-drag to rotate + tilt, WASD / arrows /
 *   Q E / + - / R F keys.  Clamped to the site, eased, smooth fly-in over the Glacis on load, frame-the-field button.
 * - Loop that stops when the page is hidden, WebGL context-loss handling, quality probe (low / medium / high, pixel-ratio caps from DESIGN section 5).
 * - ?fouerDebug=1 exposes window.__fouer (renderer, performanceSnapshot(), setTime, setWeather, camera presets, showPitches ...).
 * Pure ES module, imports are absolute (the game runs inside the arcade's srcdoc iframe). */

const QUALITY = {
  low: { pixelRatio: 1.0, farBuildings: false, label: 'low' },
  medium: { pixelRatio: 1.5, farBuildings: true, label: 'medium' },
  high: { pixelRatio: 2.0, farBuildings: true, label: 'high' },
};
const QKEY = 'pb_fouer_quality';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const FOV = 32;

export function guessQuality() {
  try {
    const q = new URLSearchParams(location.search).get('fouerQ');
    if (QUALITY[q]) return q;
    const saved = localStorage.getItem(QKEY);
    if (QUALITY[saved]) return saved;
  } catch (e) { /* storage blocked */ }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory || (coarse ? 3 : 8);
  const cores = navigator.hardwareConcurrency || 4;
  if (mem <= 2 || cores <= 2) return 'low';
  return coarse ? 'medium' : 'high';
}

export function createRenderer({ THREE: T, canvas, quality = guessQuality(), sites }) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.info.autoReset = false;
  const scene = new T.Scene();
  scene.background = new T.Color(0x8fb3d4);
  const gameRoot = new T.Group(); gameRoot.name = 'fouer-game-root';
  scene.add(gameRoot);
  const camera = new T.PerspectiveCamera(FOV, 1, 1.5, 12000);
  const listeners = { tap: [], frame: [], resize: [], quality: [], lost: [], restored: [] };
  const emit = (k, a) => listeners[k].forEach((f) => { try { f(a); } catch (e) { console.error('[fouer] ' + k + ' listener', e); } });

  const state = {
    quality, running: false, lost: false, hidden: false, size: { w: 1, h: 1, dpr: 1 },
    frameMs: 16, fps: 60, frames: 0, lastInfo: { calls: 0, triangles: 0, points: 0, lines: 0 }, probe: { t: 0, n: 0, sum: 0, done: false },
    groundY: () => 0, world: null, free: null,
  };

  /* ------------------------------------------------------------ builder camera rig */
  const SITE = sites || { u: [-110, 330], w: [-40, 190] };
  const rig = {
    tu: 150, tw: 62, ty: 0, yaw: 0, tilt: 0, dist: 330,          // goal
    cu: 150, cw: 62, cy: 0, cyaw: 0, ctilt: 0, cdist: 330,       // current (eased)
    minDist: 38, maxDist: 520, flight: null, lock: false,
  };
  /** elevation from the distance: far = steeper (a map), near = lower (a street view); `tilt` is the player's bias (radians) */
  const elevation = (dist, tilt) => clamp(lerp(26, 56, clamp((dist - 60) / 340, 0, 1)) * DEG + tilt, 14 * DEG, 78 * DEG);
  function clampRig(r) {
    r.tu = clamp(r.tu, SITE.u[0], SITE.u[1]); r.tw = clamp(r.tw, SITE.w[0], SITE.w[1]);
    r.dist = clamp(r.dist, rig.minDist, rig.maxDist); r.tilt = clamp(r.tilt, -14 * DEG, 14 * DEG);
  }
  const tmpV = new T.Vector3(); const tmpV2 = new T.Vector3(); const ray = new T.Raycaster(); const ndc = new T.Vector2();
  function applyRig(c) {
    const ph = elevation(c.cdist, c.ctilt);
    const cu = Math.cos(c.cyaw); const sw = Math.sin(c.cyaw);
    const hor = Math.cos(ph) * c.cdist;
    camera.position.set(c.cu - cu * hor, c.cy + Math.sin(ph) * c.cdist, c.cw - sw * hor);
    camera.lookAt(c.cu, c.cy, c.cw);
    camera.updateMatrixWorld(true);
  }
  /** ground point (game frame) under a screen position, intersecting the plane y = planeY, refined against the terrain function */
  function screenToGround(clientX, clientY, planeY = rig.cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let y = planeY; let p = null;
    for (let k = 0; k < 4; k++) {
      const d = ray.ray.direction;
      if (d.y > -1e-4) return null;
      const t = (y - ray.ray.origin.y) / d.y;
      p = tmpV2.copy(ray.ray.origin).addScaledVector(d, t);
      y = state.groundY(p.x, p.z);
    }
    return p ? { u: p.x, w: p.z, y } : null;
  }
  function groundDelta(ax, ay, bx, by) {
    const a = screenToGround(ax, ay); const b = screenToGround(bx, by);
    return a && b ? [a.u - b.u, a.w - b.w] : null;
  }

  const api = {
    renderer, scene, camera, gameRoot, rig, state, THREE: T,
    on(ev, f) { listeners[ev].push(f); return () => { const i = listeners[ev].indexOf(f); if (i >= 0) listeners[ev].splice(i, 1); }; },
    screenToGround,
    setSite(s) { Object.assign(SITE, s); },
    /** the camera presets (named poses of the builder rig; free eye / look poses for the photo comparisons live in cameraPreset) */
    poses: {
      overview: { tu: 150, tw: 62, yaw: 0, dist: 330, tilt: 0 },          // field overview from the SW end looking NE (the from-the-wheel view)
      close: { tu: 110, tw: 40, yaw: 0.1, dist: 90, tilt: 0 },
      top: { tu: 150, tw: 62, yaw: 0, dist: 470, tilt: 14 * DEG },
      reverse: { tu: 150, tw: 62, yaw: Math.PI, dist: 330, tilt: 0 },
      north: { tu: 150, tw: 62, yaw: Math.PI / 2, dist: 330, tilt: 0 },     // looking SE across the field toward Boulevard de la Foire
    },
    setPose(p, instant = true) {
      state.free = null;
      Object.assign(rig, p); clampRig(rig);
      if (instant) { rig.cu = rig.tu; rig.cw = rig.tw; rig.cyaw = rig.yaw; rig.ctilt = rig.tilt; rig.cdist = rig.dist; rig.cy = state.groundY(rig.tu, rig.tw); applyRig({ cu: rig.cu, cw: rig.cw, cy: rig.cy, cyaw: rig.cyaw, ctilt: rig.ctilt, cdist: rig.cdist }); }
    },
    /** fit the field into the view for the current yaw and aspect (the "frame the field" button) */
    framePose(fieldPoly, margin = 0.9) {
      const poly = fieldPoly || api.fieldPoly || [[13, 1], [292, 1], [292, 138], [13, 138]];
      const cu = poly.reduce((a, p) => a + p[0], 0) / poly.length; const cw = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      // the field is ~280 x 135 m: along the view axis in portrait, across it in landscape
      const yaw = aspect >= 1.15 ? (Math.abs(Math.sin(rig.yaw)) > 0.5 ? rig.yaw : Math.PI / 2 * Math.sign(Math.sin(rig.yaw) || 1)) : (Math.abs(Math.cos(rig.yaw)) > 0.5 ? rig.yaw : 0);
      const test = { cu, cw, cy: state.groundY(cu, cw), cyaw: yaw, ctilt: 0, cdist: 100 };
      let lo = 60; let hi = 900;
      const cam = camera.clone(); cam.aspect = aspect; cam.updateProjectionMatrix();
      const fits = (d) => {
        test.cdist = d;
        const ph = elevation(d, 0); const c = Math.cos(yaw); const s = Math.sin(yaw); const hor = Math.cos(ph) * d;
        cam.position.set(cu - c * hor, test.cy + Math.sin(ph) * d, cw - s * hor); cam.lookAt(cu, test.cy, cw); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
        return poly.every((p) => { tmpV.set(p[0], state.groundY(p[0], p[1]), p[1]).project(cam); return Math.abs(tmpV.x) <= margin && Math.abs(tmpV.y) <= margin; });
      };
      for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
      return { tu: cu, tw: cw, yaw, dist: clamp(hi, rig.minDist, rig.maxDist), tilt: 0 };
    },
    frameField(animate = true) { api.flyTo(api.framePose(), animate ? 1.1 : 0); },
    /** eased camera flight to a rig pose (seconds; 0 = jump) */
    flyTo(p, seconds = 1.2) {
      state.free = null;
      const g = Object.assign({}, rig, p); clampRig(g);
      if (!seconds) { api.setPose(g, true); return; }
      rig.flight = { t: 0, d: seconds, from: { u: rig.cu, w: rig.cw, yaw: rig.cyaw, tilt: rig.ctilt, dist: rig.cdist }, to: g };
    },
    /** the opening shot: start low over the SW end (the bus park) and float in over the field */
    flyIn(seconds = 3.6) {
      const goal = api.framePose();
      api.setPose({ tu: -40, tw: 66, yaw: -0.18, dist: 150, tilt: -12 * DEG }, true);
      rig.flight = { t: 0, d: seconds, ease: 'out', from: { u: -40, w: 66, yaw: -0.18, tilt: -12 * DEG, dist: 150 }, to: Object.assign({}, rig, goal) };
    },
    /** free eye / look-at pose in game-frame metres (photo comparisons, debug presets); call setPose / flyTo to go back to the builder rig */
    setFreeCamera({ eye, look, fov = FOV }) {
      state.free = { eye, look, fov };
      camera.fov = fov; camera.updateProjectionMatrix();
      camera.position.set(eye[0], eye[1], eye[2]); camera.lookAt(look[0], look[1], look[2]); camera.updateMatrixWorld(true);
    },
    pause() { api.stop(); },
    resume() { api.start(); },
    start() { if (state.running) return; state.running = true; state.last = performance.now(); state.raf = requestAnimationFrame(loop); },
    stop() { state.running = false; if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; },
    setQuality(q, persist = true) {
      if (!QUALITY[q]) return;
      state.quality = q; api.resize(true);
      if (persist) { try { localStorage.setItem(QKEY, q); } catch (e) { /* ignore */ } }
      emit('quality', q);
    },
    resize(force) {
      const w = Math.max(1, canvas.clientWidth); const h = Math.max(1, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[state.quality].pixelRatio);
      if (!force && w === state.size.w && h === state.size.h && dpr === state.size.dpr) return;
      state.size = { w, h, dpr };
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      emit('resize', state.size);
    },
    performanceSnapshot() {
      const i = renderer.info;
      return {
        drawCalls: state.lastInfo.calls, triangles: state.lastInfo.triangles, points: state.lastInfo.points, lines: state.lastInfo.lines,
        geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0,
        fps: Math.round(state.fps), frameMs: Math.round(state.frameMs * 10) / 10, quality: state.quality, pixelRatio: state.size.dpr,
        width: state.size.w, height: state.size.h, frames: state.frames, running: state.running, hidden: state.hidden, contextLost: state.lost,
        camera: { tu: +rig.cu.toFixed(1), tw: +rig.cw.toFixed(1), yaw: +rig.cyaw.toFixed(3), dist: +rig.cdist.toFixed(1), tilt: +rig.ctilt.toFixed(3) },
      };
    },
    renderOnce() { frame(0.016, true); },
  };
  api.fieldPoly = null;

  /* ------------------------------------------------------------ input */
  const pointers = new Map();
  let gesture = null; let tapCandidate = null; const keys = new Set();
  const isRotate = (e) => e.button === 2 || e.button === 1 || e.altKey || e.ctrlKey || e.metaKey;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), rot: isRotate(e) });
    rig.flight = null;
    if (pointers.size === 1) tapCandidate = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else tapCandidate = null;
    startGesture();
  });
  function startGesture() {
    const ps = [...pointers.values()];
    if (ps.length >= 2) {
      const [a, b] = ps;
      gesture = { kind: 'two', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    } else if (ps.length === 1) gesture = { kind: ps[0].rot ? 'rotate' : 'pan', x: ps[0].x, y: ps[0].y };
    else gesture = null;
  }
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p || !gesture || state.free) { if (p) { p.x = e.clientX; p.y = e.clientY; } return; }
    if (tapCandidate && tapCandidate.id === e.pointerId && Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 9) tapCandidate.moved = true;
    if (gesture.kind === 'pan') {
      const d = groundDelta(gesture.x, gesture.y, e.clientX, e.clientY);
      if (d) { rig.tu += d[0]; rig.tw += d[1]; clampRig(rig); }
      p.x = e.clientX; p.y = e.clientY; gesture.x = e.clientX; gesture.y = e.clientY;
      // the grab point moved with the (eased) camera: use the goal pose for a stable drag
      syncCurrentToGoalForDrag();
    } else if (gesture.kind === 'rotate') {
      rig.yaw += (e.clientX - gesture.x) * 0.006; rig.tilt = clamp(rig.tilt + (e.clientY - gesture.y) * 0.003, -14 * DEG, 14 * DEG);
      gesture.x = e.clientX; gesture.y = e.clientY; p.x = e.clientX; p.y = e.clientY;
    } else if (gesture.kind === 'two') {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      if (gesture.d > 8 && d > 8) rig.dist = clamp(rig.dist * gesture.d / d, rig.minDist, rig.maxDist);
      let da = ang - gesture.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      rig.yaw -= da;
      const dd = groundDelta(gesture.mx, gesture.my, mx, my);
      if (dd) { rig.tu += dd[0]; rig.tw += dd[1]; }
      clampRig(rig);
      gesture.d = d; gesture.ang = ang; gesture.mx = mx; gesture.my = my;
      syncCurrentToGoalForDrag();
    }
  });
  // while a finger is down the camera follows the goal 1:1 (no easing lag, the ground sticks to the finger)
  function syncCurrentToGoalForDrag() {
    rig.cu = rig.tu; rig.cw = rig.tw; rig.cyaw = rig.yaw; rig.cdist = rig.dist; rig.ctilt = rig.tilt; rig.cy = state.groundY(rig.cu, rig.cw);
    applyRig({ cu: rig.cu, cw: rig.cw, cy: rig.cy, cyaw: rig.cyaw, ctilt: rig.ctilt, cdist: rig.cdist });
  }
  const endPointer = (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    pointers.delete(e.pointerId);
    if (tapCandidate && tapCandidate.id === e.pointerId && !tapCandidate.moved && performance.now() - tapCandidate.t < 420 && e.type === 'pointerup') {
      const g = screenToGround(e.clientX, e.clientY);
      emit('tap', { clientX: e.clientX, clientY: e.clientY, ground: g, button: e.button });
    }
    tapCandidate = null;
    startGesture();
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); if (state.free) return; rig.flight = null;
    const before = screenToGround(e.clientX, e.clientY);
    const k = Math.exp(clamp(e.deltaY, -240, 240) * (e.ctrlKey ? 0.01 : 0.0013));
    rig.dist = clamp(rig.dist * k, rig.minDist, rig.maxDist);
    syncCurrentToGoalForDrag();
    const after = screenToGround(e.clientX, e.clientY);
    if (before && after) { rig.tu += before.u - after.u; rig.tw += before.w - after.w; clampRig(rig); syncCurrentToGoalForDrag(); }
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_', 'r', 'f', 'home', 'pageup', 'pagedown'].includes(k)) {
      if (k === 'f' || k === 'home') api.frameField(true); else { keys.add(k); rig.flight = null; }
      if (k.startsWith('arrow') || k.startsWith('page')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  function keyStep(dt) {
    if (!keys.size || state.free) return;
    const sp = rig.dist * 0.9 * dt;
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const s = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const c = Math.cos(rig.yaw); const sn = Math.sin(rig.yaw);
    rig.tu += (c * f - sn * s) * sp; rig.tw += (sn * f + c * s) * sp;      // forward = looking direction; right = +90 deg (w when looking along u)
    if (keys.has('q')) rig.yaw -= 1.4 * dt; if (keys.has('e')) rig.yaw += 1.4 * dt;
    if (keys.has('+') || keys.has('=') || keys.has('pageup')) rig.dist *= Math.exp(-1.2 * dt);
    if (keys.has('-') || keys.has('_') || keys.has('pagedown')) rig.dist *= Math.exp(1.2 * dt);
    if (keys.has('r')) rig.tilt += 0.7 * dt; if (keys.has('f') && false) rig.tilt -= 0.7 * dt;
    clampRig(rig);
  }

  /* ------------------------------------------------------------ the loop */
  function easeCamera(dt) {
    if (state.free) return;
    if (rig.flight) {
      const f = rig.flight; f.t += dt; const k = clamp(f.t / f.d, 0, 1);
      const e = f.ease === 'out' ? 1 - Math.pow(1 - k, 3) : k * k * (3 - 2 * k);
      rig.cu = lerp(f.from.u, f.to.tu, e); rig.cw = lerp(f.from.w, f.to.tw, e); rig.cdist = Math.exp(lerp(Math.log(f.from.dist), Math.log(f.to.dist), e));
      let dy = f.to.yaw - f.from.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      rig.cyaw = f.from.yaw + dy * e; rig.ctilt = lerp(f.from.tilt, f.to.tilt, e);
      rig.tu = rig.cu; rig.tw = rig.cw; rig.yaw = rig.cyaw; rig.dist = rig.cdist; rig.tilt = rig.ctilt;
      if (k >= 1) { rig.flight = null; Object.assign(rig, { tu: f.to.tu, tw: f.to.tw, yaw: f.to.yaw, dist: f.to.dist, tilt: f.to.tilt }); }
    } else if (!pointers.size) {
      const a = 1 - Math.exp(-dt * 9);
      rig.cu += (rig.tu - rig.cu) * a; rig.cw += (rig.tw - rig.cw) * a; rig.cyaw += (rig.yaw - rig.cyaw) * a;
      rig.cdist += (rig.dist - rig.cdist) * a; rig.ctilt += (rig.tilt - rig.ctilt) * a;
    }
    const gy = state.groundY(rig.cu, rig.cw);
    rig.cy += (gy - rig.cy) * (1 - Math.exp(-dt * 6));
    applyRig({ cu: rig.cu, cw: rig.cw, cy: rig.cy, cyaw: rig.cyaw, ctilt: rig.ctilt, cdist: rig.cdist });
  }
  function frame(dt, force) {
    keyStep(dt);
    easeCamera(dt);
    emit('frame', dt);
    renderer.info.reset();
    renderer.render(scene, camera);
    const i = renderer.info.render;
    state.lastInfo = { calls: i.calls, triangles: i.triangles, points: i.points, lines: i.lines };
    state.frames++;
    if (!force) {
      state.frameMs = lerp(state.frameMs, dt * 1000, 0.08); state.fps = 1000 / state.frameMs;
      // quality probe: the first 3 s after the fly-in has started (frames slower than 38 ms on average step one tier down, remembered per device)
      const pr = state.probe;
      if (!pr.done && state.frames > 12) {
        pr.t += dt; pr.n++; pr.sum += dt;
        if (pr.t >= 3) {
          pr.done = true; const avg = pr.sum / pr.n * 1000;
          pr.avgMs = avg;
          if (!new URLSearchParams(location.search).get('fouerQ')) {
            if (avg > 38 && state.quality !== 'low') api.setQuality(state.quality === 'high' ? 'medium' : 'low');
            else if (avg > 70 && state.quality === 'low') { /* nothing lower exists */ }
          }
        }
      }
    }
  }
  function loop(now) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(loop);
    const dt = clamp((now - state.last) / 1000, 0, 0.1); state.last = now;
    api.resize();
    frame(dt, false);
  }
  document.addEventListener('visibilitychange', () => {
    state.hidden = document.hidden;
    if (document.hidden) { state.wasRunning = state.running; api.stop(); } else if (state.wasRunning) { state.wasRunning = false; api.start(); }
  });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); state.lost = true; state.wasRunning = state.wasRunning || state.running; api.stop(); emit('lost'); });
  canvas.addEventListener('webglcontextrestored', () => {
    state.lost = false; api.resize(true);
    if (state.wasRunning && !document.hidden) { state.wasRunning = false; api.start(); }
    emit('restored');
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => api.resize()).observe(canvas);
  window.addEventListener('resize', () => api.resize());
  api.resize(true);
  return api;
}
