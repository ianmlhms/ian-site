/* Round 7-C: the challenge course (a temporary race set-up while a timed run is on), from Ian's play of "Bout Blanc" in 3 Vallées.
 *   layout    barriers (net panels) along BOTH piste edges from the start gate to the finish, direction arrows at every junction with
 *             another piste (and every 250 m), the finish arch "ZIL" over a checkered line at the line's real end (pure: courseLayout)
 *   tracker   where the skier is on the course: the distance to the finish (HUD bar), the next waypoint (HUD arrow), off the course ->
 *             warn ("Zréck op d'Pist" + an arrow back) -> after COURSE.abortAfter s: abort (main.js: "Challenge ofgebrach" with
 *             Nach eng Kéier / Weider fräi fueren). NEVER a silent teleport (pure: createCourse)
 *   view      instanced barriers + arrows, the arch (4 draw calls; built on start, disposed at the end), the HUD bits (DOM) */
import { COURSE } from '../config.js';

const THREE = typeof window !== 'undefined' ? window.THREE : null;
const ARROW_EVERY = 250;
const JUNCTION_GAP = 60;

/** Spatial hash of every piste's 10 m samples (junction search), built once per piste set. */
const hashes = new WeakMap();
function pisteHash(pistes) {
  if (hashes.has(pistes)) return hashes.get(pistes);
  const h = new Map();
  for (const p of pistes.list) {
    for (let i = 0; i + 1 < p.n; i++) {
      const k = Math.floor(p.x[i] / 50) * 8192 + Math.floor(p.z[i] / 50);
      if (!h.has(k)) h.set(k, []);
      const dx = p.x[i + 1] - p.x[i], dz = p.z[i + 1] - p.z[i], L = Math.hypot(dx, dz) || 1;
      h.get(k).push([p, p.x[i], p.z[i], dx / L, dz / L]);
    }
  }
  hashes.set(pistes, h);
  return h;
}

/** The course of a piste from startS: { startS, finishS, finish {x, z, dx, dz}, barriers [{x, z, h, side}], arrows [{x, z, h, side, s}] }. */
export function courseLayout(piste, startS = 2, pistes = null) {
  const finishS = Math.max(startS + 30, piste.length - COURSE.finishBack);
  const a = {};
  const barriers = [], arrows = [];
  const hw = piste.halfWidth;
  for (let s = startS + 4; s < finishS; s += COURSE.barrierEvery) {
    piste.at(s + COURSE.barrierEvery / 2, a);
    const h = Math.atan2(a.dz, a.dx);
    for (const side of [-1, 1]) barriers.push({ x: a.x - a.dz * side * (hw + 0.5), z: a.z + a.dx * side * (hw + 0.5), h, side });
  }
  const arrowAt = (s) => { piste.at(s, a); const h = Math.atan2(a.dz, a.dx); for (const side of [-1, 1]) arrows.push({ x: a.x - a.dz * side * (hw - 1.5), z: a.z + a.dx * side * (hw - 1.5), h, side, s }); };
  const junctions = [];
  if (pistes) {
    const hash = pisteHash(pistes);
    for (let s = startS + 20; s < finishS - 20; s += 20) {
      piste.at(s, a);
      const k0 = Math.floor(a.x / 50), k1 = Math.floor(a.z / 50);
      let hit = false;
      for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
        for (const [q, x, z, dx, dz] of hash.get((k0 + i) * 8192 + (k1 + j)) || []) {
          if (q === piste) continue;
          if (Math.hypot(x - a.x, z - a.z) > hw * 1.3) continue;
          if (dx * a.dx + dz * a.dz < 0.87) { hit = true; break; }        // another piste meets or leaves at more than 30°
        }
      }
      if (hit && !junctions.some((t) => Math.abs(t - s) < JUNCTION_GAP)) junctions.push(s);
    }
  }
  for (const s of junctions) arrowAt(Math.max(startS + 8, s - 15));
  for (let s = startS + ARROW_EVERY; s < finishS - 60; s += ARROW_EVERY) if (!junctions.some((t) => Math.abs(t - s) < 80)) arrowAt(s);
  piste.at(finishS, a);
  return { startS, finishS, finish: { x: a.x, z: a.z, dx: a.dx, dz: a.dz }, barriers, arrows, junctions, halfWidth: hw };
}

/** Where the skier is on the course (pure). update(state, dt) -> { s, remaining, share, dist, warn, abort, back {x, z}, next {x, z} }. */
export function createCourse({ piste, startS = 2 }) {
  const finishS = Math.max(startS + 30, piste.length - COURSE.finishBack);
  const proj = {}, nxt = {}, back = {};
  let hint = startS, offFor = 0, aborted = false;
  const out = { s: startS, remaining: finishS - startS, share: 0, dist: 0, warn: false, abort: false, back: { x: 0, z: 0 }, next: { x: 0, z: 0 }, offFor: 0 };
  function update(st, dt) {
    piste.project(st.x, st.z, hint, 160, proj);
    if (proj.dist > 400) piste.project(st.x, st.z, null, 0, proj);         // lost the line (a big jump): search the whole piste
    hint = proj.s;
    out.s = proj.s; out.dist = proj.dist;
    out.remaining = Math.max(0, finishS - proj.s);
    out.share = Math.min(1, Math.max(0, (proj.s - startS) / (finishS - startS)));
    piste.at(Math.min(finishS, proj.s + 45), nxt); out.next.x = nxt.x; out.next.z = nxt.z;
    piste.at(proj.s, back); out.back.x = back.x; out.back.z = back.z;
    const off = proj.dist > piste.halfWidth + COURSE.warnAfter && st.crash === 0;
    offFor = off ? offFor + dt : Math.max(0, offFor - dt * 2);
    out.warn = off;
    out.offFor = offFor;
    if (!aborted && offFor > COURSE.abortAfter) { aborted = true; out.abort = true; } else out.abort = false;
    return out;
  }
  return { update, finishS, startS, get aborted() { return aborted; }, reset() { aborted = false; offFor = 0; } };
}

/* ---------------- the view ---------------- */
function textTexture(text, w = 512, h = 128, bg = '#d0352c', fg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.72)}px Geist, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h * 0.54);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function checkerTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  for (let j = 0; j < 16; j++) for (let i = 0; i < 2; i++) { g.fillStyle = (i + j) % 2 ? '#16171a' : '#ffffff'; g.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapT = THREE.RepeatWrapping; return t;
}

export function createCourseView({ scene, layout, height }) {
  const objs = [];
  const dummy = new THREE.Object3D();
  // barriers: a fence panel (orange net + two posts), one instanced mesh
  const panel = new THREE.BoxGeometry(COURSE.barrierEvery - 0.2, 1.05, 0.06); panel.translate(0, 0.62, 0);
  const net = new THREE.InstancedMesh(panel, new THREE.MeshLambertMaterial({ color: 0xff6a13 }), Math.max(1, layout.barriers.length));
  layout.barriers.forEach((b, i) => { dummy.position.set(b.x, height(b.x, b.z) - 0.05, b.z); dummy.rotation.set(0, -b.h, 0); dummy.updateMatrix(); net.setMatrixAt(i, dummy.matrix); });
  net.count = layout.barriers.length; net.name = 'ski-course-barriers'; net.frustumCulled = false;
  objs.push(net);
  // arrows: a yellow board with a black chevron on a post, facing the skier coming down
  const ac = document.createElement('canvas'); ac.width = 64; ac.height = 64;
  const ag = ac.getContext('2d'); ag.fillStyle = '#f2c200'; ag.fillRect(0, 0, 64, 64); ag.fillStyle = '#16171a';
  ag.beginPath(); ag.moveTo(20, 10); ag.lineTo(46, 32); ag.lineTo(20, 54); ag.lineTo(12, 46); ag.lineTo(30, 32); ag.lineTo(12, 18); ag.closePath(); ag.fill();
  const board = new THREE.PlaneGeometry(1.1, 1.1); board.translate(0, 1.7, 0);
  const arrowMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(ac), side: THREE.DoubleSide });
  const arrows = new THREE.InstancedMesh(board, arrowMat, Math.max(1, layout.arrows.length));
  layout.arrows.forEach((a, i) => {
    // the board faces up the piste; the chevron points along the course (the board turned so its +x runs down the piste, seen from above)
    dummy.position.set(a.x, height(a.x, a.z), a.z);
    dummy.rotation.set(0, -a.h - Math.PI / 2, 0);
    dummy.updateMatrix(); arrows.setMatrixAt(i, dummy.matrix);
  });
  arrows.count = layout.arrows.length; arrows.name = 'ski-course-arrows'; arrows.frustumCulled = false;
  objs.push(arrows);
  // finish: two red pillars, a cross beam with "ZIL" both ways, a checkered line on the snow
  const f = layout.finish, hw = layout.halfWidth + 1.5, fh = Math.atan2(f.dz, f.dx);
  const g0 = height(f.x, f.z);
  const arch = new THREE.Group();
  arch.position.set(f.x, g0, f.z); arch.rotation.set(0, -fh, 0);
  const red = new THREE.MeshLambertMaterial({ color: 0xd0352c });
  for (const side of [-1, 1]) {
    const px = f.x - f.dz * side * hw, pz = f.z + f.dx * side * hw;
    const gh = height(px, pz);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7 + (g0 - gh), 0.9), red);
    pillar.position.set(0, (7 + (g0 - gh)) / 2 - (g0 - gh), side * hw);
    arch.add(pillar);
  }
  const zil = textTexture('ZIL');
  const zilMat = new THREE.MeshLambertMaterial({ map: zil });
  // the beam across the piste (local z); its two faces towards and away from the skier (+x, -x) carry "ZIL"
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, hw * 2 + 0.9), [zilMat, zilMat, red, red, red, red]);
  banner.position.set(0, 7.2, 0);
  arch.add(banner);
  const ck = checkerTexture(); ck.repeat.set(1, Math.max(2, Math.round(hw / 3)));
  const lineGeo = new THREE.PlaneGeometry(1.6, hw * 2); lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ map: ck, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  line.position.set(0, 0.08, 0);
  arch.add(line);
  arch.name = 'ski-course-finish';
  objs.push(arch);
  for (const o of objs) scene.add(o);
  return {
    objs,
    dispose() {
      for (const o of objs) {
        scene.remove(o);
        o.traverse((m) => { if (m.geometry) m.geometry.dispose(); const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; for (const x of ms) { if (x.map) x.map.dispose(); x.dispose(); } });
      }
    },
  };
}

/** The course HUD: the distance bar to the finish, an arrow to the next waypoint, the off-course warning. */
export function createCourseHud(hudEl) {
  const box = document.createElement('div');
  box.id = 'courseHud'; box.hidden = true;
  box.innerHTML = '<span class="arrow" id="cArrow">↑</span><div class="bar"><i id="cBar"></i></div><span id="cLeft"></span>';
  const warn = document.createElement('div');
  warn.id = 'courseWarn'; warn.hidden = true;
  warn.innerHTML = '<span class="arrow" id="cBack">↑</span><span>Zréck op d\'Pist</span>';
  hudEl.appendChild(box); hudEl.appendChild(warn);
  const arrowEl = box.querySelector('#cArrow'), bar = box.querySelector('#cBar'), left = box.querySelector('#cLeft'), backEl = warn.querySelector('#cBack');
  const rel = (st, camYaw, p) => {
    const a = Math.atan2(p.z - st.z, p.x - st.x) - camYaw;       // world angle relative to the view direction (screen up = ahead)
    return a * 180 / Math.PI;
  };
  return {
    show(v) { box.hidden = !v; if (!v) warn.hidden = true; },
    set(c, st, camYaw) {
      bar.style.width = `${(c.share * 100).toFixed(1)}%`;
      left.textContent = c.remaining >= 1000 ? `${(c.remaining / 1000).toFixed(1)} km bis ZIL` : `${Math.round(c.remaining)} m bis ZIL`;
      arrowEl.style.transform = `rotate(${rel(st, camYaw, c.next).toFixed(0)}deg)`;
      warn.hidden = !c.warn;
      if (c.warn) backEl.style.transform = `rotate(${rel(st, camYaw, c.back).toFixed(0)}deg)`;
      document.documentElement.dataset.skiCourseWarn = c.warn ? '1' : '';
    },
  };
}
