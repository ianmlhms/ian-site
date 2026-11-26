/* The other skiers on screen (npc.js lists them, lifts.js hands over its carriers for the riders). Two instanced meshes, so the whole
 * crowd costs 2 draw calls (+ the shadow pass of the near ones on Mëttel / Héich) whatever its size:
 *   near   the nearest few: skier-model.js at 'mid' detail (~1.1k triangles)
 *   crowd  everybody else: the same figure at 'low' detail (~0.4k triangles)
 * The figure is NOT skinned: its poses (npc.js POSE: skiing, carving left / right, tuck, plough, standing, seated on a chair, standing in
 * a cabin, two walking steps, on a drag lift) are baked once from skier-model.js pose() into a float texture; the vertex shader blends
 * two of them per instance (aPose = pose A, pose B, blend, outfit) and paints the outfit's colours (OUTFITS) into the jacket / accent /
 * trousers / helmet / ski parts. No name tags. A skier who appears or goes close to the camera grows / shrinks in 0.25 s (no pop). */
import { createSkierModel, OUTFITS } from './skier-model.js';
import { POSE, POSE_COUNT, OUTFIT_COUNT } from './npc.js';
import { NPC } from './config.js';
import { riderAt } from './modes/liftride.js';

const THREE = window.THREE;
const TEX_W = 1024;
/* skier-model.js colour slots (Object.keys(M) order) -> the outfit colour each takes: 1 jacket, 2 accent, 3 trousers, 4 helmet, 5 skis */
const SLOT_TO_OUTFIT = [1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5];

/** The states the poses are baked from (flat snow, heading +x). */
function poseState(p) {
  const s = { x: 0, y: 0, z: 0, heading: 0, speed: 10, edge: 0, tuck: 0.12, brake: 0, stop: 0, grounded: true, air: 0, crash: 0, landed: 0, vx: 10, vy: 0, vz: 0, ride: '', walk: 0 };
  if (p === POSE.carveL) { s.edge = -0.9; s.speed = 14; s.tuck = 0.1; }
  else if (p === POSE.carveR) { s.edge = 0.9; s.speed = 14; s.tuck = 0.1; }
  else if (p === POSE.tuck) { s.tuck = 1; s.speed = 20; }
  else if (p === POSE.plough) { s.brake = 1; s.speed = 3; s.tuck = 0; }
  else if (p === POSE.stand) { s.speed = 0; s.tuck = 0; s.vx = 0; }
  else if (p === POSE.sit) s.ride = 'sit';
  else if (p === POSE.cabin) s.ride = 'stand';
  else if (p === POSE.walkA) { s.ride = 'carry'; s.walk = 0.6; }
  else if (p === POSE.walkB) { s.ride = 'carry'; s.walk = 1.8; }
  else if (p === POSE.drag) { s.ride = 'drag'; s.speed = 3; }
  return s;
}

/** Bakes one detail of the figure: { geometry (pose 0 + colours + aSlot), tex (every pose's positions and normals), V, triangles }. */
export function bakeFigure(detail) {
  const model = createSkierModel({ outfit: OUTFITS[0].id, detail });
  model.setBlob(false);
  const group = model.root;
  const meshes = [];
  group.traverse((o) => { if (o.isMesh && o.geometry.userData.slots) meshes.push(o); });
  const V = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const rows = Math.ceil((POSE_COUNT * 2 * V) / TEX_W);
  const data = new Float32Array(TEX_W * rows * 4);
  const flat = (x, z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; };
  const ground = () => 0;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  const visibleUp = (o) => { for (let q = o; q && q !== group; q = q.parent) if (!q.visible) return false; return true; };
  for (let p = 0; p < POSE_COUNT; p++) {
    const st = poseState(p);
    for (let i = 0; i < 50; i++) model.pose(st, flat, i * 0.1 + p * 10, ground);     // settles every smoothed driver of pose()
    group.updateMatrixWorld(true);
    let base = 0;
    for (const m of meshes) {
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, shown = visibleUp(m);
      nm.getNormalMatrix(m.matrixWorld);
      for (let i = 0; i < P.count; i++) {
        const iv = ((p * 2) * V + base + i) * 4, inr = ((p * 2 + 1) * V + base + i) * 4;
        if (shown) v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); else v.set(0, 0.9, 0);      // a hidden part folds into the body
        data[iv] = v.x; data[iv + 1] = v.y; data[iv + 2] = v.z; data[iv + 3] = 1;
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        data[inr] = v.x; data[inr + 1] = v.y; data[inr + 2] = v.z; data[inr + 3] = 0;
      }
      base += P.count;
    }
  }
  // the static geometry: pose 0 positions (bounds), the fixed colours (boots, skin, goggles ...), the outfit slot per vertex
  const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), col = new Float32Array(V * 3), slot = new Float32Array(V), idx = [];
  let base = 0;
  for (const m of meshes) {
    const g = m.geometry, C = g.attributes.color, sl = g.userData.slots;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const k = base + i, t = k * 4;
      pos[k * 3] = data[t]; pos[k * 3 + 1] = data[t + 1]; pos[k * 3 + 2] = data[t + 2];
      const tn = (V + k) * 4; nrm[k * 3] = data[tn]; nrm[k * 3 + 1] = data[tn + 1]; nrm[k * 3 + 2] = data[tn + 2];
      col[k * 3] = C.getX(i); col[k * 3 + 1] = C.getY(i); col[k * 3 + 2] = C.getZ(i);
      slot[k] = SLOT_TO_OUTFIT[sl[i]] || 0;
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    base += g.attributes.position.count;
  }
  for (const m of meshes) m.geometry.dispose();
  group.traverse((o) => { if (o.material && o.material.dispose) { if (o.material.alphaMap) o.material.alphaMap.dispose(); o.material.dispose(); } });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  const tex = new THREE.DataTexture(data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { geometry, tex, V, triangles: idx.length / 3 };
}

/** The outfit colours as one uniform array: [outfit * 5 + slot - 1] = jacket, accent, trousers, helmet, skis. */
function palette() {
  const out = [];
  for (let i = 0; i < OUTFIT_COUNT; i++) {
    const o = OUTFITS[i % OUTFITS.length];
    for (const k of ['jacket', 'accent', 'trousers', 'helmet', 'ski']) out.push(new THREE.Color(o[k]));
  }
  return out;
}
const FETCH = `
  uniform highp sampler2D uPoseTex; uniform int uPoseV;
  attribute vec4 aPose;
  vec3 npcFetch(int p, int a) { int i = (p * 2 + a) * uPoseV + gl_VertexID; return texelFetch(uPoseTex, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0).xyz; }
  vec3 npcPos() { return mix(npcFetch(int(aPose.x + 0.5), 0), npcFetch(int(aPose.y + 0.5), 0), aPose.z); }`;
/** The Lambert material of the figure with the pose blend + outfit colours (and its depth twin for the shadow pass). */
function crowdMaterials(fig, pal) {
  const uniforms = { uPoseTex: { value: fig.tex }, uPoseV: { value: fig.V }, uPal: { value: pal } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${FETCH}\n  attribute float aSlot; uniform vec3 uPal[${OUTFIT_COUNT * 5}];`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(npcFetch(int(aPose.x + 0.5), 1), npcFetch(int(aPose.y + 0.5), 1), aPose.z));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = npcPos();')
      .replace('#include <color_vertex>', '#include <color_vertex>\n  if (aSlot > 0.5) vColor.xyz = uPal[int(aPose.w + 0.5) * 5 + int(aSlot + 0.5) - 1];');
  };
  mat.customProgramCacheKey = () => `ski-npc-${fig.V}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${FETCH}`).replace('#include <begin_vertex>', 'vec3 transformed = npcPos();');
  };
  depth.customProgramCacheKey = () => `ski-npc-depth-${fig.V}`;
  return { mat, depth };
}

/**
 * scene, height(x, z) = the snow (riders of drag lifts, the slope pitch), level = 'low' | 'medium' | 'high'.
 * addCarrier() is lifts.js's rider sink (setRiderSink); draw(list, camera, crowd, opts) once a frame after lifts.update().
 */
export function createNpcView({ scene, height, level = 'medium' }) {
  const group = new THREE.Group();
  group.name = 'ski-npcs';
  scene.add(group);
  const pal = palette();
  const figs = { near: bakeFigure('mid'), crowd: bakeFigure('low') };
  const CAP = { near: 16, crowd: 170 };
  const meshes = {};
  for (const k of ['near', 'crowd']) {
    const f = figs[k], { mat, depth } = crowdMaterials(f, pal);
    const geo = f.geometry;
    const aPose = new THREE.InstancedBufferAttribute(new Float32Array(CAP[k] * 4), 4);
    aPose.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPose', aPose);
    const m = new THREE.InstancedMesh(geo, mat, CAP[k]);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.customDepthMaterial = depth;
    m.frustumCulled = false;                   // culled per skier below
    m.count = 0; m.visible = false; m.renderOrder = 2;
    m.name = `ski-npc-${k}`;
    group.add(m);
    meshes[k] = { mesh: m, aPose, mat, depth, n: 0 };
  }
  // ---- the carriers lifts.js reports this frame (riders are placed in draw())
  const CAR_MAX = 260;
  const cars = [];
  for (let i = 0; i < CAR_MAX; i++) cars.push({ m: new Float32Array(16), l: null, id: 0, d: 0, s: 0, kind: '', share: 1 });
  let nCars = 0, riderR = NPC.levels[level].riderRadius;
  function addCarrier(l, m4, id, d, w, share = 1) {
    if (d > riderR || nCars >= CAR_MAX || l.kind === 'carpet') return;
    if (l.kind !== 'cable' && l.kind !== 'train' && l.site && (w.s < l.site.boardS || w.s > l.len - l.site.unloadS)) return;      // in the stations: empty
    const c = cars[nCars++];
    c.m.set(m4.elements); c.l = l; c.id = id; c.d = d; c.s = w.s; c.kind = l.kind; c.share = share;
  }
  // ---- per frame
  const m4 = new THREE.Matrix4(), mc = new THREE.Matrix4(), ml = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX');
  const v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  const fades = new Map();                      // id -> { f, last: draw record } (grow in / shrink out near the camera)
  const recs = [];                              // this frame's draw records
  const recPool = [];
  const rec = () => { const r = recPool.pop() || { m: new Float32Array(16) }; recs.push(r); return r; };
  const stats = { near: 0, crowd: 0, riders: 0, cars: 0, ms: 0, triangles: 0 };
  const rideOut = {};
  let shadowsOn = false, enabled = true;

  /** Places one figure record: world matrix + pose + outfit + its distance (for the near / crowd split). */
  function place(r, mat, a, b, k, outfit, d, id) {
    r.m.set(mat.elements); r.a = a; r.b = b; r.k = k; r.o = outfit; r.d = d; r.id = id;
  }
  function draw(list, camera, crowd, opts = {}) {
    const t0 = performance.now();
    for (const r of recs) recPool.push(r);
    recs.length = 0;
    const cfg = NPC.levels[opts.level || level] || NPC.levels.medium;
    riderR = cfg.riderRadius;
    if (!enabled) { for (const k in meshes) { meshes[k].mesh.visible = false; meshes[k].mesh.count = 0; meshes[k].n = 0; } nCars = 0; stats.ms = performance.now() - t0; return; }
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const cx = camera.position.x, cz = camera.position.z;
    const seen = new Set();
    const inView = (x, y, z, r = 1.3) => { sphere.center.set(x, y + 0.9, z); sphere.radius = r; return frustum.intersectsSphere(sphere); };
    // skiers, the queues, the walkers
    for (const o of list) {
      seen.add(o.id);
      const d = Math.hypot(o.x - cx, o.z - cz);
      let last = lastOf.get(o.id), fd = fades.get(o.id);
      if (!last) {
        lastOf.set(o.id, (last = {}));
        if (d < NPC.fadeNear && opts.fadeIn !== false) fades.set(o.id, (fd = { f: 0, out: false }));
      }
      if (fd) { if (fd.out) fd.out = false; fd.f = Math.min(1, fd.f + (opts.dt || 0.016) * 4); if (fd.f >= 1) { fades.delete(o.id); fd = null; } }
      const f = fd ? fd.f : 1;
      let pitch = 0;
      if (o.kind !== 'walk' && d < 160) {                                // (farther: a few pixels, flat is fine)
        const fx = Math.cos(o.heading), fz = Math.sin(o.heading);
        const hb = height(o.x - fx, o.z - fz), hf = height(o.x + fx, o.z + fz);
        pitch = -Math.atan((hb - hf) / 2);
      }
      last.cut = !!o.cut; last.x = o.x; last.y = o.y; last.z = o.z; last.heading = o.heading; last.pitch = pitch; last.a = o.poseA; last.b = o.poseB; last.k = o.blend; last.o = o.outfit; last.s = o.scale || 1;
      if (!inView(o.x, o.y, o.z)) continue;
      e.set(0, -o.heading, pitch); q.setFromEuler(e);
      const sc = last.s * Math.max(0.02, smoothstep(f));
      m4.compose(v3.set(o.x, o.y, o.z), q, s3.set(sc, sc, sc));
      place(rec(), m4, o.poseA, o.poseB, o.blend, o.outfit, d, o.id);
    }
    // gone near the camera: shrink out where they were
    for (const [id, last] of lastOf) {
      if (seen.has(id)) continue;
      if (opts.hidden && opts.hidden(last.x, last.z)) { fades.delete(id); lastOf.delete(id); continue; }      // a challenge's corridor: at once
      if (last.cut) { fades.delete(id); lastOf.delete(id); continue; }      // lift lines: on the chair now (it shows them seated), at once
      const d = Math.hypot(last.x - cx, last.z - cz);
      let fd = fades.get(id);
      if (!fd || !fd.out) { if (d > NPC.fadeNear || opts.fadeIn === false) { lastOf.delete(id); fades.delete(id); continue; } fd = { f: fd ? fd.f : 1, out: true }; fades.set(id, fd); }
      fd.f -= (opts.dt || 0.016) * 4;
      if (fd.f <= 0) { fades.delete(id); lastOf.delete(id); continue; }
      e.set(0, -last.heading, last.pitch); q.setFromEuler(e);
      const sc = last.s * smoothstep(fd.f);
      m4.compose(v3.set(last.x, last.y, last.z), q, s3.set(sc, sc, sc));
      place(rec(), m4, last.a, last.b, last.k, last.o, d, id);
    }
    // riders: the nearest carriers first, until the cap
    stats.cars = nCars;
    const order = [];
    for (let i = 0; i < nCars; i++) order.push(i);
    order.sort((a, b) => cars[a].d - cars[b].d);
    let riders = 0;
    const share = opts.share ?? 1;
    for (const ci of order) {
      if (riders >= cfg.riders) break;
      const c = cars[ci], l = c.l;
      const n = crowd.riders(l.index, c.id, l.kind, l.seats, l.sub, share * (c.share ?? 1));
      if (!n) continue;
      mc.fromArray(c.m);
      v3.setFromMatrixPosition(mc);
      if (l.kind !== 'drag' && !inView(v3.x, v3.y - 3, v3.z, l.kind === 'cable' ? 6 : l.kind === 'train' ? 7 : 3)) continue;
      for (let k = 0; k < n && riders < cfg.riders; k++) {
        const s = crowd.riderBuf ? crowd.riderBuf[k] : null;
        if (!s) break;
        if (l.kind === 'drag') {
          riderAt(l.path, c.s, height, rideOut);
          const fx = Math.cos(rideOut.heading), fz = Math.sin(rideOut.heading);
          const pitch = -Math.atan((height(rideOut.x - fx, rideOut.z - fz) - height(rideOut.x + fx, rideOut.z + fz)) / 2) * 0.6;
          e.set(0, -rideOut.heading, pitch); q.setFromEuler(e);
          m4.compose(v3.set(rideOut.x, rideOut.y, rideOut.z), q, s3.set(s.scale, s.scale, s.scale));
        } else {
          e.set(0, -s.yaw, 0); q.setFromEuler(e);
          ml.compose(v3.set(s.a, s.y, s.b), q, s3.set(s.scale, s.scale, s.scale));
          m4.multiplyMatrices(mc, ml);
        }
        v3.setFromMatrixPosition(m4);
        place(rec(), m4, s.pose, s.pose, 0, s.outfit, Math.hypot(v3.x - cx, v3.z - cz), -1);
        riders++;
      }
    }
    nCars = 0;
    stats.riders = riders;
    // the nearest few get the finer figure
    let nearLeft = cfg.near;
    const byD = recs.slice().sort((a, b) => a.d - b.d);
    const M = meshes;
    M.near.n = 0; M.crowd.n = 0;
    for (const r of byD) {
      const k = nearLeft > 0 && r.d < NPC.nearRadius && M.near.n < CAP.near ? 'near' : 'crowd';
      const T = M[k];
      if (T.n >= CAP[k]) continue;
      if (k === 'near') nearLeft--;
      T.mesh.instanceMatrix.array.set(r.m, T.n * 16);
      const a = T.aPose.array, i = T.n * 4;
      a[i] = r.a; a[i + 1] = r.b; a[i + 2] = r.k; a[i + 3] = r.o;
      T.n++;
    }
    stats.triangles = 0;
    for (const k of ['near', 'crowd']) {
      const T = M[k];
      T.mesh.count = T.n; T.mesh.visible = T.n > 0;
      T.mesh.instanceMatrix.needsUpdate = true; T.aPose.needsUpdate = true;
      stats.triangles += T.n * figs[k].triangles;
    }
    stats.near = M.near.n; stats.crowd = M.crowd.n;
    stats.ms = performance.now() - t0;
  }
  const lastOf = new Map();
  function setLevel(l) {
    level = l;
    shadowsOn = l !== 'low';
    meshes.near.mesh.castShadow = shadowsOn;
    meshes.crowd.mesh.castShadow = l === 'high';
  }
  setLevel(level);
  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) { for (const k in meshes) { meshes[k].mesh.visible = false; meshes[k].mesh.count = 0; meshes[k].n = 0; } fades.clear(); lastOf.clear(); }
  }
  function dispose() {
    scene.remove(group);
    for (const k in meshes) { meshes[k].mesh.geometry.dispose(); meshes[k].mat.dispose(); meshes[k].depth.dispose(); meshes[k].mesh.dispose(); figs[k].tex.dispose(); }
  }
  return {
    group, draw, addCarrier, setLevel, setEnabled, dispose, stats, figs,
    get enabled() { return enabled; },
    /** tests: the drawn instances [{ x, y, z, pose, outfit, near }] */
    instances() {
      const out = [];
      for (const k of ['near', 'crowd']) { const T = meshes[k]; for (let i = 0; i < T.n; i++) { const a = T.mesh.instanceMatrix.array; out.push({ x: a[i * 16 + 12], y: a[i * 16 + 13], z: a[i * 16 + 14], pose: T.aPose.array[i * 4], outfit: T.aPose.array[i * 4 + 3], near: k === 'near' }); } }
      return out;
    },
  };
}
function smoothstep(k) { return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k); }
