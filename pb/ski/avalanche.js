/* Round 7-C: avalanches in the free ride.
 *   release   crossing a steep (>= AVALANCHE.slope = 35°) off-piste slope of fresh snow (no piste within AVALANCHE.pisteGap m, no forest,
 *             no rock band) has a small chance per 40 m cell to release a slab just above the skier; NEVER on a groomed piste
 *   flow      a slab of blocks slides down the terrain (the 40 m far grid: the same on every device), gathers speed on the steep, spreads
 *             a little, stops in the runout; drawn as tumbling snow blocks + a powder cloud (two instanced draw calls)
 *   caught    a moving block within AVALANCHE.caught m: a crash ("Vun der Lawin erwëscht!") with a white-out, then a respawn on the nearest
 *             piste (main.js); outrun it or ski out to the side: "Entkomm!"
 *   warnings  "⚠ Lawinegefor" in the HUD when the skier stands on a steep off-piste slope; yellow-black checkered warning flags at the
 *             piste edges next to steep off-piste faces and at the "Lawin" challenge faces
 *   Lawin     AVALANCHE.faces marked steep faces per resort (found from the terrain, deterministic): a flag gate at the top, "Start" ->
 *             3-2-1 -> the slab releases behind the skier -> reach the bottom of the face or ski out to the side = won (progress.lawin)
 *   sync      DETERMINISTIC from (id, seed, t): triggerAvalanche(id, seed, t) gives the same slab and the same flow on every device
 *             (fixed 1/30 s steps on the far grid; t = start time on avalanche.clock(), replaceable with setClock(fn) by the online free
 *             ride); onTrigger(cb) reports every local release { id, seed, t } so it can be broadcast. See HANDOFF "R7-C".
 * The pure part (faces, release rule, the slab, the stepper) is exported for the Node checks (scripts/ski/round7c-check.mjs). */
import { AVALANCHE as AV } from './config.js';

const THREE = typeof window !== 'undefined' ? window.THREE : null;
const G = 9.81, MU = 0.4, DRAG = 0.005, RUN = 380;      // friction (tan 22°), drag; beyond RUN m the slab loses its energy fast
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** mulberry32: a small seeded generator (the same numbers on every device). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Gradient of a height function over +-span m. */
function grad(h, x, z, span = 20) { return [(h(x + span, z) - h(x - span, z)) / (2 * span), (h(x, z + span) - h(x, z - span)) / (2 * span)]; }
export const slopeDeg = (h, x, z, span = 20) => { const [gx, gz] = grad(h, x, z, span); return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; };

/** Can a slab release here? Off-piste fresh snow, steep, open (no forest / rock band), far enough from every piste line. */
export function releasable(field, x, z, heightAt, attrs = {}) {
  field.attrs(x, z, attrs);
  if (attrs.piste > 0.05 || attrs.dist < AV.pisteGap || attrs.park > 0) return false;
  if (attrs.forest > 0.3 || attrs.rock > 0.5 || attrs.built > 0.05 || attrs.water > 0.1) return false;
  return slopeDeg(heightAt, x, z, 6) >= AV.slope;
}
export const cellId = (x, z) => `a${Math.floor(x / AV.cell)}_${Math.floor(z / AV.cell)}`;
export function cellCentre(id) {
  const m = /^a(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return null;
  return { x: (Number(m[1]) + 0.5) * AV.cell, z: (Number(m[2]) + 0.5) * AV.cell };
}

/** The slab of a release: blocks along a crown line across the fall line, a little above the cell centre. far(x, z) = field.farHeight. */
export function createSlab(id, seed, far, quality = 1) {
  const c = cellCentre(id);
  if (!c) return null;
  const r = rng((seed ^ hashStr(id)) >>> 0);
  const [gx, gz] = grad(far, c.x, c.z, 30);
  const gl = Math.hypot(gx, gz) || 1;
  const dx = -gx / gl, dz = -gz / gl;                           // downhill
  const width = AV.width[0] + (AV.width[1] - AV.width[0]) * r();
  const crownBack = 18 + r() * 14;                              // m above the cell centre (the skier gets a head start)
  const cx = c.x - dx * crownBack, cz = c.z - dz * crownBack;
  const cols = Math.max(8, Math.round((quality >= 1 ? 16 : 10) * width / 80)), rows = 3;
  const blocks = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols - 0.5;
      const lat = u * width + (r() - 0.5) * 4, back = j * 8 + r() * 4;
      blocks.push({ x: cx + -dz * lat - dx * back, z: cz + dx * lat - dz * back, vx: 0, vz: 0, delay: j * 0.35 + Math.abs(u) * 0.8 + r() * 0.3, size: 1.2 + r() * 1.6, spin: r() * 6.28, moving: true });
    }
  }
  return { id, seed, crown: { x: cx, z: cz }, dir: { x: dx, z: dz }, width, blocks };
}

/** One fixed step (AV.step) of the flow on the far grid: gravity along the slope, friction, drag, a soft side spread. */
export function stepSlab(slab, t, far) {
  const dt = AV.step;
  let moving = 0;
  for (const b of slab.blocks) {
    if (!b.moving || t < b.delay) { if (b.moving) moving++; continue; }
    const [gx, gz] = grad(far, b.x, b.z, 20);
    const g2 = gx * gx + gz * gz, cos2 = 1 / (1 + g2), cos = Math.sqrt(cos2);
    let ax = -G * gx * cos2, az = -G * gz * cos2;            // along the slope
    const v = Math.hypot(b.vx, b.vz);
    const mu = MU + Math.max(0, (b.d || 0) - RUN) / 600;
    if (v > 0.05) { const f = mu * G * cos + DRAG * v * v; ax -= f * b.vx / v; az -= f * b.vz / v; }
    else if (Math.hypot(ax, az) < mu * G * cos) { ax = 0; az = 0; }
    b.vx += ax * dt; b.vz += az * dt;
    const v2 = Math.hypot(b.vx, b.vz);
    if (v > 0.05 && v2 > 0 && (b.vx * (b.vx - ax * dt) + b.vz * (b.vz - az * dt)) < 0) { b.vx = 0; b.vz = 0; }   // friction never reverses
    b.x += b.vx * dt; b.z += b.vz * dt; b.d = (b.d || 0) + v2 * dt;
    b.spin += v2 * dt * 0.6;
    if (t > b.delay + 2 && v2 < 0.4) b.moving = false; else moving++;
  }
  return moving;
}

/** The "Lawin" challenge faces of a resort: the steepest long open off-piste faces inside the shipped tiles, at least 1.5 km apart.
 *  Each { id, index, top: {x, z}, path: [x, z, ...] down the fall line, len, slope }. Deterministic (far grid + classes). */
export function findFaces(field, resort, count = AV.faces) {
  const far = (x, z) => field.farHeight(x, z);
  const attrs = {};
  const cand = [];
  const step = 80, edge = 400;
  for (let z = edge; z < resort.depth - edge; z += step) {
    for (let x = edge; x < resort.width - edge; x += step) {
      if (field.isShipped && !field.isShipped(Math.floor(x / 1280), Math.floor(z / 1280))) continue;
      if (slopeDeg(far, x, z, 40) < AV.slope - 3) continue;
      field.attrs(x, z, attrs);
      if (attrs.piste > 0.02 || attrs.dist < 90 || attrs.forest > 0.15 || attrs.rock > 0.35 || attrs.built > 0 || attrs.glacier > 0.5) continue;
      // follow the fall line down: the face length while it stays steep and open
      const path = [x, z];
      let px = x, pz = z, len = 0, steep = 0, ok = true;
      for (let k = 0; k < 60; k++) {
        const [gx, gz] = grad(far, px, pz, 20);
        const gl = Math.hypot(gx, gz);
        if (gl < 0.18) break;                                     // flatter than ~10°: the runout
        px -= gx / gl * 15; pz -= gz / gl * 15; len += 15;
        path.push(px, pz);
        if (Math.atan(gl) * 180 / Math.PI > 30) steep += 15;
        field.attrs(px, pz, attrs);
        if (attrs.forest > 0.5 || attrs.built > 0.1 || attrs.water > 0.2) { ok = false; break; }
      }
      if (!ok || steep < 180 || len < 250) continue;
      cand.push({ x, z, path, len, steep, slope: slopeDeg(far, x, z, 40) });
    }
  }
  cand.sort((a, b) => b.steep * b.slope - a.steep * a.slope);
  const faces = [];
  for (const c of cand) {
    if (faces.length >= count) break;
    if (faces.some((f) => Math.hypot(f.top.x - c.x, f.top.z - c.z) < 1500)) continue;
    faces.push({ id: `lawin${faces.length}`, index: faces.length, top: { x: c.x, z: c.z }, path: c.path, len: c.len, slope: c.slope });
  }
  return faces;
}

/** Warning flag spots: piste edges where the terrain just beside the piste is a steep open face (cap per resort). */
export function warningSpots(field, pistes, faces, max = 48) {
  const far = (x, z) => field.farHeight(x, z);
  const attrs = {};
  const out = [];
  const p = {};
  for (const f of faces) { out.push({ x: f.top.x, z: f.top.z - 0, face: f.id }); }
  for (const piste of pistes.list) {
    for (let s = 60; s < piste.length - 60 && out.length < max; s += 160) {
      piste.at(s, p);
      for (const side of [-1, 1]) {
        const ox = p.x - p.dz * side * (piste.halfWidth + 40), oz = p.z + p.dx * side * (piste.halfWidth + 40);
        if (slopeDeg(far, ox, oz, 30) < AV.slope) continue;
        field.attrs(ox, oz, attrs);
        if (attrs.piste > 0.05 || attrs.forest > 0.3 || attrs.rock > 0.5) continue;
        if (out.some((o) => Math.hypot(o.x - ox, o.z - oz) < 400)) continue;
        out.push({ x: p.x - p.dz * side * (piste.halfWidth + 2), z: p.z + p.dx * side * (piste.halfWidth + 2) });
        break;
      }
    }
  }
  return out.slice(0, max);
}

/* ---------------- the view + the game glue ---------------- */
function flagTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { g.fillStyle = (i + j) % 2 ? '#16171a' : '#f2c200'; g.fillRect(i * 16, j * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

export function createAvalanches({ scene, field, surface, pistes, hud, uiRoot, level = "medium", onCaught, onLawinStart = null, onLawinWon = null, lawinMask = () => 0 }) {
  const far = (x, z) => field.farHeight(x, z);
  const height = (x, z) => surface.height(x, z);
  const quality = level === 'low' ? 0.6 : 1;
  const faces = findFaces(field, { width: field.width, depth: field.depth });
  const flags = warningSpots(field, pistes, faces);
  // warning flags: one instanced mesh (post + checkered flag)
  const flagGeo = new THREE.PlaneGeometry(0.9, 0.9); flagGeo.translate(0.45, 2.2, 0);
  const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.7, 5); postGeo.translate(0, 1.35, 0);
  const flagMat = new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const flagMesh = new THREE.InstancedMesh(flagGeo, flagMat, Math.max(1, flags.length));
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, Math.max(1, flags.length));
  flagMesh.name = 'ski-avalanche-flags'; postMesh.name = 'ski-avalanche-posts';
  const dummy = THREE ? new THREE.Object3D() : null;
  function seatFlags() {
    flags.forEach((f, i) => { dummy.position.set(f.x, height(f.x, f.z) - 0.1, f.z); dummy.rotation.set(0, (i * 1.7) % 6.28, 0); dummy.updateMatrix(); flagMesh.setMatrixAt(i, dummy.matrix); postMesh.setMatrixAt(i, dummy.matrix); });
    flagMesh.count = postMesh.count = flags.length;
    flagMesh.instanceMatrix.needsUpdate = true; postMesh.instanceMatrix.needsUpdate = true;
  }
  seatFlags();
  scene.add(flagMesh, postMesh);
  // the slab: tumbling blocks + the powder cloud (camera-facing quads)
  const MAXB = 120;
  const blockGeo = new THREE.IcosahedronGeometry(1, 0);
  const blockMat = new THREE.MeshLambertMaterial({ color: 0xf1f4f8 });
  const blockMesh = new THREE.InstancedMesh(blockGeo, blockMat, MAXB * 2);
  blockMesh.name = 'ski-avalanche-blocks'; blockMesh.frustumCulled = false; blockMesh.count = 0;
  const cloudN = MAXB * 3;
  const cloudGeo = new THREE.InstancedBufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  cloudGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const cPos = new Float32Array(cloudN * 4);
  cloudGeo.setAttribute('aP', new THREE.InstancedBufferAttribute(cPos, 4).setUsage(THREE.DynamicDrawUsage));
  cloudGeo.instanceCount = 0;
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aP; varying vec2 vUv; varying float vA;
      void main(){ vUv = position.xy; vA = fract(aP.w); float size = floor(aP.w) * 0.1;
        vec4 mv = viewMatrix * vec4(aP.xyz, 1.0); mv.xy += position.xy * size; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying float vA; void main(){ float r = dot(vUv, vUv); if (r > 1.0) discard; gl_FragColor = vec4(0.95, 0.965, 0.985, exp(-r * 2.2) * vA); }`,
  });
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudMesh.name = 'ski-avalanche-cloud'; cloudMesh.frustumCulled = false; cloudMesh.renderOrder = 8;
  scene.add(blockMesh, cloudMesh);

  // HUD bits
  const warn = Object.assign(document.createElement('div'), { id: 'avWarn', textContent: '⚠ Lawinegefor', hidden: true });
  const flash = Object.assign(document.createElement('div'), { id: 'avFlash' });
  uiRoot.appendChild(flash);
  hud.el.appendChild(warn);
  const prompt = document.createElement('div');
  prompt.className = 'avprompt'; prompt.hidden = true;
  hud.el.appendChild(prompt);

  let clock = () => performance.now() / 1000;
  let active = null, listeners = [], sessionSeed = (Math.random() * 2 ** 31) >>> 0, lastCell = '', caughtNow = false, nearest = Infinity, lawin = null, promptFace = null, dismissed = null;
  const attrs = {};
  const stats = { triggered: 0, caught: 0, escaped: 0 };

  /** Start an avalanche (local or from the network): the same id + seed + t gives the same slab and flow everywhere. */
  function triggerAvalanche(id, seed, t = clock()) {
    const slab = createSlab(id, seed >>> 0, far, quality);
    if (!slab) return null;
    active = { slab, t0: t, steps: 0, done: false, caught: false, near: Infinity, lawin: lawin && lawin.pending ? lawin.face : null };
    if (lawin) lawin.pending = false;
    caughtNow = false;
    stats.triggered++;
    document.documentElement.dataset.skiAvalanche = 'flowing';
    hud.toast('Lawin! Fuer ewech!', 2200);
    return slab;
  }
  function local(id, seed) {
    const t = clock();
    triggerAvalanche(id, seed, t);
    for (const cb of listeners) { try { cb({ id, seed, t }); } catch (error) { console.warn('[ski] avalanche listener failed', error); } }
  }
  /** Each frame: release check (free ride, grounded skier), the flow (fixed steps up to now), caught / escaped, the view. */
  function update(st, dt, { freeride = false, running = false } = {}) {
    if (st && freeride && running && !active && st.grounded && st.crash === 0 && st.speed > 2) {
      const id = cellId(st.x, st.z);
      if (id !== lastCell) {
        lastCell = id;
        if (releasable(field, st.x, st.z, height, attrs)) {
          const roll = rng((sessionSeed ^ hashStr(id)) >>> 0)();
          if (roll < AV.chance) local(id, (sessionSeed ^ hashStr(id + 's')) >>> 0);
        }
      }
    }
    if (active && !active.done) {
      const target = Math.min(AV.maxTime, clock() - active.t0);
      let moving = 1, n = 0;
      while ((active.steps + 1) * AV.step <= target && n < 240) { moving = stepSlab(active.slab, active.steps * AV.step, far); active.steps++; n++; }
      if (st && !active.caught && st.crash === 0 && !st.ride) {
        let dmin = Infinity;
        for (const b of active.slab.blocks) {
          if (!b.moving || active.steps * AV.step < b.delay) continue;
          const d = Math.hypot(b.x - st.x, b.z - st.z);
          if (d < dmin) dmin = d;
        }
        active.near = Math.min(active.near, dmin);
        nearest = dmin;
        if (dmin < AV.caught) { active.caught = true; stats.caught++; caught(st); }
      }
      if (moving === 0 || target >= AV.maxTime) {
        active.done = true; active.doneAt = clock();
        document.documentElement.dataset.skiAvalanche = active.caught ? 'caught' : 'stopped';
        if (!active.caught && active.near < 160) { stats.escaped++; hud.toast('Entkomm!', 2000); if (active.lawin) lawinWon(active.lawin); }
      }
    }
    if (active && active.done && clock() - active.doneAt > 25) { active = null; document.documentElement.dataset.skiAvalanche = ''; }
    draw();
  }
  function caught(st) {
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 900);
    hud.toast('Vun der Lawin erwëscht!', 2400);
    document.documentElement.dataset.skiAvalanche = 'caught';
    const face = active.lawin;
    onCaught(st);
    if (face) setTimeout(() => showLawinPrompt(face, true), 1800);
  }
  const m4 = THREE ? new THREE.Matrix4() : null, qq = THREE ? new THREE.Quaternion() : null, ee = THREE ? new THREE.Euler() : null, vv = THREE ? new THREE.Vector3() : null, ss = THREE ? new THREE.Vector3() : null;
  function draw() {
    if (!active) { blockMesh.count = 0; cloudGeo.instanceCount = 0; return; }
    const b = active.slab.blocks, t = active.steps * AV.step;
    const fade = active.done ? clamp(1 - (clock() - active.doneAt) / 25, 0, 1) : 1;
    let k = 0, c = 0;
    for (const bl of b) {
      if (k >= blockMesh.instanceMatrix.count) break;
      const y = height(bl.x, bl.z);
      const v = Math.hypot(bl.vx, bl.vz);
      const started = t >= bl.delay;
      for (let j = 0; j < 2 && k < MAXB * 2; j++) {
        const s = bl.size * (j ? 0.6 : 1) * (started ? 1 : 0.7);
        ee.set(bl.spin + j, bl.spin * 0.7 + j * 2, 0);
        qq.setFromEuler(ee);
        vv.set(bl.x + (j ? 1.4 : 0), y + s * 0.4 + (started && v > 2 ? Math.abs(Math.sin(bl.spin * 2)) * 0.8 : 0), bl.z + (j ? -1 : 0));
        ss.set(s, s * 0.7, s);
        m4.compose(vv, qq, ss);
        blockMesh.setMatrixAt(k++, m4);
      }
      if (started && c < cloudN) {
        const cloud = clamp(v / 14, 0, 1) * fade;
        for (let j = 0; j < 3 && c < cloudN; j++) {
          const back = j * 5 + 2;
          const size = (4 + v * 0.55 + j * 3) * (0.8 + 0.3 * Math.sin(bl.spin + j));
          const vn = v > 0.1 ? 1 / v : 0;
          cPos[c * 4] = bl.x - bl.vx * vn * back; cPos[c * 4 + 2] = bl.z - bl.vz * vn * back;
          cPos[c * 4 + 1] = height(cPos[c * 4], cPos[c * 4 + 2]) + size * 0.55;
          cPos[c * 4 + 3] = Math.floor(size * 10) + clamp(cloud * (0.55 - j * 0.12), 0, 0.99);
          c++;
        }
      }
    }
    blockMesh.count = k; blockMesh.instanceMatrix.needsUpdate = true;
    cloudGeo.instanceCount = c; cloudGeo.attributes.aP.needsUpdate = true;
  }
  /** HUD rate: the warning badge on a steep off-piste slope; the Lawin face prompt at a face's top. */
  function hudTick(st, { freeride = false, running = false } = {}) {
    if (!st || !freeride || !running) { warn.hidden = true; return; }
    field.attrs(st.x, st.z, attrs);
    const steep = attrs.piste < 0.1 && slopeDeg(height, st.x, st.z, 6) >= AV.slope - 5;
    warn.hidden = !steep;
    document.documentElement.dataset.skiAvWarn = steep ? '1' : '';
    // the Lawin challenge gates (the face tops)
    let face = null;
    for (const f of faces) if (Math.hypot(f.top.x - st.x, f.top.z - st.z) < 14) face = f;
    if (dismissed && (!face || face.id !== dismissed)) { const d = faces.find((f) => f.id === dismissed); if (!d || Math.hypot(d.top.x - st.x, d.top.z - st.z) > 40) dismissed = null; }
    if (face && face.id !== dismissed && !lawin && promptFace !== face) showLawinPrompt(face, false);
    if (!face && promptFace && !promptFace.retry) hidePrompt();
  }
  function hidePrompt() { prompt.hidden = true; promptFace = null; }
  function showLawinPrompt(face, retry) {
    promptFace = { ...face, retry };
    const won = (lawinMask() >> face.index) & 1;
    prompt.innerHTML = `<b>${retry ? 'Erwëscht!' : `Lawin-Challenge ${face.index + 1}${won ? ' ✓' : ''}`}</b>
      <span>${retry ? 'Nach eng Kéier de Steilhang erof?' : `Steilhang ${Math.round(face.slope)}°, ${Math.round(face.len)} m. D'Lawin geet hannert dir lass: entkomm hir!`}</span>
      <div class="acts"><button type="button" class="btn primary" data-a="go">Start</button><button type="button" class="btn" data-a="no">Nee</button></div>`;
    prompt.hidden = false;
    prompt.querySelector('[data-a="go"]').addEventListener('click', () => { hidePrompt(); if (onLawinStart) onLawinStart(face); });
    prompt.querySelector('[data-a="no"]').addEventListener('click', () => { dismissed = face.id; hidePrompt(); lawin = null; });
    document.documentElement.dataset.skiLawinPrompt = face.id;
  }
  /** The Lawin challenge started (main.js placed the skier at the top and ran the 3-2-1): the slab goes 25 m behind him. */
  function startLawin(face, seed = 7001 + face.index) {
    lawin = { face, pending: true };
    const c = cellId(face.top.x, face.top.z);
    local(c, seed);
    document.documentElement.dataset.skiLawin = face.id;
  }
  function lawinWon(face) {
    hud.toast(`Lawin-Challenge ${face.index + 1}: entkomm! ✓`, 2600);
    document.documentElement.dataset.skiLawin = `${face.id}:won`;
    lawin = null;
    if (onLawinWon) onLawinWon(face);
  }
  return {
    faces, flags, stats, triggerAvalanche, update, hudTick, startLawin, reseat: seatFlags,
    get active() { return active; }, get nearest() { return nearest; },
    onTrigger(cb) { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    setClock(fn) { clock = fn; },
    clock: () => clock(),
    /** Tests: a fixed session seed (the release rolls), clear the current one. */
    setSessionSeed(s) { sessionSeed = s >>> 0; lastCell = ''; },
    clear() { active = null; lawin = null; blockMesh.count = 0; cloudGeo.instanceCount = 0; document.documentElement.dataset.skiAvalanche = ''; },
    blocks: () => (active ? active.slab.blocks.map((b) => ({ x: b.x, z: b.z, v: Math.hypot(b.vx, b.vz), moving: b.moving })) : []),
  };
}
