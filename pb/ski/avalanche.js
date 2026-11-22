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
    const mu = MU + Math.max(0, (b.d || 0) - RUN) / 250;
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

/** How far (m, mean height drop of its blocks) the slab of (id, seed) runs down before it stops (0 if it never stops). */
export function slabDrop(id, seed, far) {
  const sl = createSlab(id, seed, far);
  if (!sl) return 0;
  let t = 0, moving = 1;
  while (moving && t < AV.maxTime) { moving = stepSlab(sl, t, far); t += AV.step; }
  if (moving) return 0;                                              // still sliding at the end: no clean runout, not a challenge face
  const y0 = far(sl.crown.x, sl.crown.z);
  return sl.blocks.reduce((m, q) => m + (y0 - far(q.x, q.z)), 0) / sl.blocks.length;
}

/** The "Lawin" challenge faces of a resort: the steepest long open off-piste faces inside the shipped tiles, at least 1.2 km apart.
 *  Each { id, index, top: {x, z}, path: [x, z, ...] down the fall line, len, slope }. Deterministic (far grid + classes).
 *  R7-C2: every face starts at least AV.slope (35°) steep: first long open faces, then (wooded Kronplatz) shorter open faces between the
 *  trees, only then a gentler fallback (`gentle: true`, none of the five resorts needs it now). minY: no face below the lowest piste
 *  end (a valley gorge is no avalanche slope). */
export function findFaces(field, resort, count = AV.faces, { minY = -Infinity } = {}) {
  const far = (x, z) => field.farHeight(x, z);
  const attrs = {};
  const faces = [];
  const passes = [
    { slope: AV.slope, forest: 0.15, steepDeg: 30, steep: 180, gap: 90, len: 200, pathForest: 0.5 },
    { slope: AV.slope, forest: 0.3, steepDeg: 30, steep: 100, gap: 60, len: 150, pathForest: 0.65 },
    { slope: AV.slope - 8, forest: 0.3, steepDeg: 27, steep: 120, gap: 60, len: 200, pathForest: 0.5, gentle: true },
  ];
  for (const P of passes) {
    if (faces.length >= count) break;
    const cand = [];
    const step = 80, edge = 400;
    for (let z = edge; z < resort.depth - edge; z += step) {
      for (let x = edge; x < resort.width - edge; x += step) {
        if (field.isShipped && !field.isShipped(Math.floor(x / 1280), Math.floor(z / 1280))) continue;
        if (slopeDeg(far, x, z, 40) < P.slope || far(x, z) < minY) continue;
        field.attrs(x, z, attrs);
        if (attrs.piste > 0.02 || attrs.dist < P.gap || attrs.forest > P.forest || attrs.rock > 0.25 || attrs.built > 0 || attrs.glacier > 0.5) continue;      // open snow, no rock / scree
        // follow the fall line down: the face length while it stays steep and open
        const path = [x, z];
        let px = x, pz = z, len = 0, steep = 0, ok = true;
        for (let k = 0; k < 60; k++) {
          const [gx, gz] = grad(far, px, pz, 20);
          const gl = Math.hypot(gx, gz);
          if (gl < 0.18) break;                                     // flatter than ~10°: the runout
          px -= gx / gl * 15; pz -= gz / gl * 15; len += 15;
          path.push(px, pz);
          if (Math.atan(gl) * 180 / Math.PI > P.steepDeg) steep += 15;
          field.attrs(px, pz, attrs);
          if (attrs.forest > P.pathForest || attrs.built > 0.1 || attrs.water > 0.2 || (len < 200 && attrs.rock > 0.3)) { ok = false; break; }
        }
        if (!ok || steep < P.steep || len < P.len) continue;
        cand.push({ x, z, path, len, steep, slope: slopeDeg(far, x, z, 40), gentle: !!P.gentle });
      }
    }
    cand.sort((a, b) => b.steep * b.slope - a.steep * a.slope);
    for (const c of cand) {
      if (faces.length >= count) break;
      if (faces.some((f) => Math.hypot(f.top.x - c.x, f.top.z - c.z) < 1200)) continue;
      if (slabDrop(cellId(c.x, c.z), 7001 + faces.length, far) < 80) continue;      // R7-C2: the challenge's own slab must really run
      faces.push({ id: `lawin${faces.length}`, index: faces.length, top: { x: c.x, z: c.z }, path: c.path, len: c.len, slope: c.slope, gentle: c.gentle });
    }
  }
  return faces;
}

/** Is the straight line from a to b clear of the terrain (margin m below the ray, the last `skip` share near b not tested)? */
export function lineClear(height, ax, ay, az, bx, by, bz, margin = 1.5, skip = 0.08, n = 48) {
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t > 1 - skip) break;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
    if (height(x, z) > y - margin) return false;
  }
  return true;
}

/** R7-C2: a camera spot that watches a Lawin face's flow: in front of the face, down the slope and a little to the side (the slab
 *  comes towards the lens), >= 0.6 m above the snow (in practice 15-50 m), a clear line to the crown, the middle and the lower part of
 *  the flow (no camera against / inside a rock face, no ridge in between), the snow round the lens lower than it. Pure.
 *  Returns { x, y, z, tx, ty, tz, clear, above } (clear false = the least bad spot). */
export function faceView(face, height, { dists = [200, 280, 360, 450, 560], ups = [25, 45, 70, 100] } = {}) {
  const p = face.path, n = p.length / 2;
  const at = (share) => { const k = Math.min(n - 1, Math.max(0, Math.round((n - 1) * share))); return { x: p[2 * k], z: p[2 * k + 1] }; };
  const mid = at(0.4), crown = at(0), low = at(0.8);
  const tx = mid.x, tz = mid.z, ty = height(tx, tz) + 6;
  const fx = p[p.length - 2] - p[0], fz = p[p.length - 1] - p[1], fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl, uz = fz / fl;                                    // the flow direction (down the face)
  let best = null;
  for (let a = 0; a < 24; a++) {
    const ang = a / 24 * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang);
    const along = cx * ux + cz * uz;                                    // 1 = straight down the fall line from the target, -1 = above it
    for (const d of dists) {
      for (const up of ups) {
        const x = tx + cx * d, z = tz + cz * d, g = height(x, z), y = g + up;
        // the snow round the lens (25 m) clearly below it: no slope filling the foreground
        let ring = true, openRing = true;
        for (let r = 0; r < 12 && ring; r++) { const q = r / 12 * Math.PI * 2, gq = height(x + Math.cos(q) * 25, z + Math.sin(q) * 25); if (gq > y - 0.6) ring = false; if (gq > y - 6) openRing = false; }
        // a widening margin under the line of sight: open air in front of the lens, not a grazing view along the slope
        const sees = (q, qy, wide) => { for (let i = 1; i < 40; i++) { const t = i / 40; if (t > 0.92) break; const hx = x + (q.x - x) * t, hz = z + (q.z - z) * t; if (height(hx, hz) > y + (qy - y) * t - (wide ? Math.min(12, 2 + d * t * 0.05) : 2)) return false; } return true; };
        const all = (wide) => sees({ x: tx, z: tz }, ty, wide) && sees(crown, height(crown.x, crown.z) + 4, wide) && sees(low, height(low.x, low.z) + 4, wide);
        const clear = ring && all(false), open = clear && openRing && all(true);
        const score = (clear ? 0 : 1000) + (open ? 0 : 150) + Math.abs(along - 0.45) * 50 + Math.abs(up - 35) * 0.2 + Math.abs(d - 260) * 0.04;
        if (!best || score < best.score) best = { x, y, z, tx, ty, tz, clear, open, score, above: y - g, along };
      }
    }
  }
  return best;
}

/** The lowest piste end (far grid): Lawin faces stay above it. */
export function lowestPiste(pistes, far) {
  let y = Infinity;
  for (const p of pistes.list) y = Math.min(y, far(p.bottom.x, p.bottom.z));
  return Number.isFinite(y) ? y : -Infinity;
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

export function createAvalanches({ scene, field, surface, pistes, hud, uiRoot, level = "medium", onCaught, onLawinStart = null, onLawinWon = null, lawinMask = () => 0, sound = null }) {
  const far = (x, z) => field.farHeight(x, z);
  const height = (x, z) => surface.height(x, z);
  const quality = level === 'low' ? 0.6 : 1;
  const faces = findFaces(field, { width: field.width, depth: field.depth }, AV.faces, { minY: lowestPiste(pistes, far) });
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
    // soft puffs: no hard rim, the lower part fades into the snow it rolls over (no cut line where it meets the ground)
    fragmentShader: `varying vec2 vUv; varying float vA; void main(){ float r = dot(vUv, vUv); if (r > 1.0) discard; float a = (1.0 - r) * (1.0 - r) * smoothstep(-0.95, 0.1, vUv.y) * vA; gl_FragColor = vec4(0.95, 0.965, 0.985, a); }`,
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
    if (sound) { const st = lastState; const d = st ? Math.hypot(slab.crown.x - st.x, slab.crown.z - st.z) : 300; sound('avalanche', { near: clamp(1 - d / 700, 0.25, 1) }); }
    hud.toast('Lawin! Fuer ewech!', 2200);
    return slab;
  }
  function local(id, seed) {
    const t = clock();
    triggerAvalanche(id, seed, t);
    for (const cb of listeners) { try { cb({ id, seed, t }); } catch (error) { console.warn('[ski] avalanche listener failed', error); } }
  }
  /** Each frame: release check (free ride, grounded skier), the flow (fixed steps up to now), caught / escaped, the view. */
  let flagT = 0, lastState = null;
  function update(st, dt, { freeride = false, running = false } = {}) {
    flagT += dt;
    lastState = st;
    if (st && flagT > 1) {                       // the warning flags only cost draw calls where one is within 1.5 km
      flagT = 0;
      let near = false;
      for (const f of flags) if (Math.abs(f.x - st.x) < 1500 && Math.abs(f.z - st.z) < 1500) { near = true; break; }
      flagMesh.visible = postMesh.visible = near && freeride;      // a warning for the free ride (not over a challenge or the park)
    }
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
        if (!active.caught && active.near < 300) { stats.escaped++; hud.toast('Entkomm!', 2000); if (active.lawin) lawinWon(active.lawin); }
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
    if (!active) { blockMesh.count = 0; cloudGeo.instanceCount = 0; blockMesh.visible = cloudMesh.visible = false; return; }      // no draw calls without a slab
    blockMesh.visible = cloudMesh.visible = true;
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
        const cloud = (bl.moving ? clamp(0.35 + v / 12, 0, 1) : clamp(v / 14, 0, 1)) * fade;      // R7-C2: a slow slab still smokes
        for (let j = 0; j < 3 && c < cloudN; j++) {
          const back = j * 5 + 2;
          const size = (4 + v * 0.55 + j * 3) * (0.8 + 0.3 * Math.sin(bl.spin + j));
          const vn = v > 0.1 ? 1 / v : 0;
          cPos[c * 4] = bl.x - bl.vx * vn * back; cPos[c * 4 + 2] = bl.z - bl.vz * vn * back;
          cPos[c * 4 + 1] = height(cPos[c * 4], cPos[c * 4 + 2]) + size * 0.75;
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
    faces, flags, stats, triggerAvalanche, view: (i) => (faces[i] ? faceView(faces[i], height) : null), update, hudTick, startLawin, reseat: seatFlags,
    get active() { return active; }, get nearest() { return nearest; },
    onTrigger(cb) { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    setClock(fn) { clock = fn; },
    /** R7-C2: how loud the rumble is (0..1): the share of the slab still moving, by the distance to the skier (or the camera). */
    loudness(x, z) {
      if (!active) return 0;
      const bl = active.slab.blocks, t = active.steps * AV.step;
      let moving = 0, d = Infinity;
      for (const b of bl) { if (!b.moving || t < b.delay) continue; moving++; const q = Math.hypot(b.x - x, b.z - z); if (q < d) d = q; }
      const fade = active.done ? clamp(1 - (clock() - active.doneAt) / 4, 0, 1) : 1;
      return clamp(moving / bl.length * 1.6, 0, 1) * clamp(1.15 - d / 900, 0.12, 1) * fade;
    },
    clock: () => clock(),
    /** Tests: a fixed session seed (the release rolls), clear the current one. */
    setSessionSeed(s) { sessionSeed = s >>> 0; lastCell = ''; },
    clear() { active = null; lawin = null; blockMesh.count = 0; cloudGeo.instanceCount = 0; document.documentElement.dataset.skiAvalanche = ''; },
    blocks: () => (active ? active.slab.blocks.map((b) => ({ x: b.x, z: b.z, v: Math.hypot(b.vx, b.vz), moving: b.moving })) : []),
  };
}
