/* The trees in the scene: instanced meshes (one draw call per kind and level of detail) with the wind in the vertex
 * shader.  The trees come from trees.js: the woods (placed per block from the LiDAR canopy) and the trees of OSM (the
 * street trees of the boulevards, the trees of the parks).
 *
 * The instance buffers are refilled when the car has moved far enough; the scan is time sliced, so the frame never
 * stops for a forest, and a new tree grows into its place instead of popping.
 */
import { buildBroadleaf, buildBush } from './tree-models.js';
import { BLOCK, STRIDE } from './trees.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;

const REFILL_DISTANCE = 5;         // m: the forest is rebuilt when the car has moved this far
const SCAN_BUDGET_MS = 1.5;        // the wall-clock time per frame spent scanning the blocks (the iPad)
const NEAR_RADIUS = 42;            // m: the trees nearer than this get the full model
const MID_RADIUS = 110;            // m: the trees up to here get the middle model
const FADE_SECONDS = 0.45;         // s: a new tree grows into its place
const LOD_JITTER = 0.12;           // the near/mid swap is staggered, so a whole ring never pops at once
const now_ = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const VERTEX = `
  attribute vec3 iPos; attribute vec4 iParams; attribute vec3 color;
  uniform vec2 uWind; uniform float uBend, uTime;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight;
  void main(){
    float s = iParams.x, ang = iParams.y;
    float c = cos(ang), sn = sin(ang);
    vec3 p = position;
    p.xz *= iParams.w;                       // the girth: an old tree is a broad one
    p *= s;
    vec3 n0 = normal;
    vec3 r = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
    float h = max(position.y, 0.0);
    float bend = pow(h, 1.7) * s * uBend;
    float gust = sin(uTime * 1.25 + iParams.z * 6.283 + iPos.x * 0.05) * 0.6
               + sin(uTime * 2.7 + iParams.z * 11.0 + iPos.z * 0.07) * 0.25;
    r.x += gust * bend * (0.5 + uWind.x); r.z += gust * bend * 0.6 * (0.5 + uWind.y);
    vec3 world = r + iPos;
    vNormal = normalize(vec3(c * n0.x + sn * n0.z, n0.y, -sn * n0.x + c * n0.z));
    vColor = color * (0.86 + 0.28 * fract(iParams.z * 13.7));
    vWorld = world; vHeight = position.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vNormal);
    vec3 col = paintLightW(vColor * (1.0 - 0.18 * uWet), N, mix(1.0, 0.78, uCloud * 0.6), 0.92, vWorld);
    gl_FragColor = vec4(applyFogW(pow(col, vec3(0.97)), vDist, vWorld.y), 1.0);
  }
`;

/** The geometry of a model, ready to be instanced. */
function instanceGeometry(mesh) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = new THREE.BufferAttribute(new Uint32Array(mesh.idx), 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(mesh.col, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function createTreeView({ scene, forest, baked = [], field, env, quality }) {
  const group = new THREE.Group();
  group.name = 'luxdrive-trees';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uBend: { value: 0.035 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
  });

  // the models: the near tree has three crown blobs, the far one a single blob (the ground shader paints the canopy
  // beyond the reach of the view)
  const models = {
    near: { mesh: buildBroadleaf(0, 3), cap: 260 },
    mid: { mesh: buildBroadleaf(1, 3), cap: 760 },
    far: { mesh: buildBroadleaf(2, 3), cap: 1900 },
    bush: { mesh: buildBush(1), cap: 320 },
  };
  const sets = {};
  for (const [name, def] of Object.entries(models)) {
    const g = instanceGeometry(def.mesh);
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(def.cap * 3), 3);
    const par = new THREE.InstancedBufferAttribute(new Float32Array(def.cap * 4), 4);
    pos.setUsage(THREE.DynamicDrawUsage); par.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', pos);
    g.setAttribute('iParams', par);
    g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.name = `trees ${name}`;
    group.add(mesh);
    sets[name] = { g, pos, par, n: 0, cap: def.cap, base: new Float32Array(def.cap), spawn: new Float32Array(def.cap) };
  }

  let spawnMap = new Map();               // the world key -> the game-clock time the tree was first built
  const stats = { trees: 0, blocks: 0 };

  /** The key of a tree in the world (the spawn map). */
  const keyOf = (x, z) => (x * 4 | 0) + ',' + (z * 4 | 0);

  /** Writes one tree into the live set. */
  function put(name, x, y, z, scale, yaw, seed, girth, now, spawnNext) {
    const s = sets[name];
    if (s.n >= s.cap) return false;
    const o = s.n++;
    s.pos.array[o * 3] = x; s.pos.array[o * 3 + 1] = y; s.pos.array[o * 3 + 2] = z;
    s.par.array[o * 4] = scale; s.par.array[o * 4 + 1] = yaw; s.par.array[o * 4 + 2] = seed; s.par.array[o * 4 + 3] = girth;
    s.base[o] = scale;
    const key = keyOf(x, z);
    let sp = spawnMap.get(key);
    if (sp === undefined) sp = now;        // never built here before: it grows in now
    spawnNext.set(key, sp);
    s.spawn[o] = sp;
    return true;
  }

  /** The name of the set a tree at this distance belongs to. */
  function tierFor(d, jitter) {
    if (d < NEAR_RADIUS * jitter) return 'near';
    if (d < MID_RADIUS * jitter) return 'mid';
    return 'far';
  }

  let scanning = null;
  let last = { x: 1e9, z: 1e9 };

  /** Begins a scan: the blocks of the woods around the car, then the trees of OSM. */
  function startScan(cx, cz, now) {
    const R = quality.treeRadius;
    const b0x = Math.floor((cx - R) / BLOCK), b1x = Math.floor((cx + R) / BLOCK);
    const b0z = Math.floor((cz - R) / BLOCK), b1z = Math.floor((cz + R) / BLOCK);
    const queue = [];
    for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) queue.push(bx, bz);
    for (const s of Object.values(sets)) s.n = 0;
    scanning = { queue, qi: 0, cx, cz, R, now, spawnNext: new Map(), count: 0 };
  }

  /** Scans the blocks for the time of the budget. */
  function stepScan(budgetMs) {
    const s = scanning, t0 = now_();
    while (s.qi < s.queue.length) {
      const bx = s.queue[s.qi], bz = s.queue[s.qi + 1];
      s.qi += 2;
      const t = forest.block(bx, bz);
      for (let i = 0; i < t.length; i += STRIDE) {
        const x = t[i], z = t[i + 2], h = t[i + 3], seed = t[i + 5];
        const d = Math.hypot(x - s.cx, z - s.cz);
        if (d > s.R) continue;
        const jitter = 1 + LOD_JITTER * (((seed * 13.7) % 1) * 2 - 1);
        if (d > 30 && ((seed * 7.31) % 1) > quality.treeDensity) continue;      // the thinning of the quality level
        const yaw = seed * 6.283;
        const girth = 0.8 + 0.45 * ((seed * 3.1) % 1);
        if (put(tierFor(d, jitter), x, t[i + 1] - 0.15, z, h, yaw, seed, girth, s.now, s.spawnNext)) s.count++;
      }
      if (now_() - t0 > budgetMs) return false;
    }
    // the trees of OSM: the street trees of the boulevards and the trees of the parks
    for (const i of forest.near(s.cx, s.cz, s.R)) {
      const t = baked[i];
      if (!t) continue;
      const d = Math.hypot(t.x - s.cx, t.z - s.cz);
      if (d > s.R) continue;
      const seed = (t.x * 0.37 + t.z * 0.71) % 1;
      const yaw = seed * 6.283;
      const name = t.kind === 2 ? 'bush' : tierFor(d, 1);
      const girth = t.girth / 100;
      const scale = t.kind === 2 ? t.height : t.height;
      if (put(name, t.x, field.height(t.x, t.z) - 0.15, t.z, scale, yaw, seed, girth, s.now, s.spawnNext)) s.count++;
    }
    return true;
  }

  /**
   * Puts the finished scan on the screen.
   * instant: the trees are already there (the first forest, behind the loading screen): they do not grow in.
   */
  function commitScan(instant = false) {
    for (const s of Object.values(sets)) {
      if (instant) for (let o = 0; o < s.n; o++) s.spawn[o] = scanning.now - FADE_SECONDS;
      s.g.instanceCount = s.n;
      s.pos.clearUpdateRanges(); s.pos.addUpdateRange(0, s.n * 3); s.pos.needsUpdate = true;
      s.par.clearUpdateRanges(); s.par.addUpdateRange(0, s.n * 4); s.par.needsUpdate = true;
    }
    spawnMap = scanning.spawnNext;
    if (instant) for (const [k, v] of spawnMap) spawnMap.set(k, v - FADE_SECONDS);
    stats.trees = scanning.count;
    stats.blocks = forest.blocks.size;
    last = { x: scanning.cx, z: scanning.cz };
  }

  /** Grows the trees that are new into their place. */
  function applyFade(now) {
    for (const s of Object.values(sets)) {
      let fading = false;
      for (let o = 0; o < s.n; o++) {
        const t = Math.min(1, (now - s.spawn[o]) / FADE_SECONDS);
        if (t < 1) fading = true;
        const e = t * t * (3 - 2 * t);
        s.par.array[o * 4] = s.base[o] * e;
      }
      if (fading) {
        s.par.clearUpdateRanges(); s.par.addUpdateRange(0, s.n * 4); s.par.needsUpdate = true;
      }
    }
  }

  return {
    group, stats, sets,
    /** cx, cz = the camera, now = the game clock (s). */
    update(cx, cz, now = 0, force = false) {
      if (force) {
        startScan(cx, cz, now);
        while (!stepScan(Infinity)) { /* the one-off build behind the loading screen */ }
        commitScan(true);
        scanning = null;
        applyFade(now);
        return;
      }
      if (!scanning && Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) startScan(cx, cz, now);
      if (scanning && stepScan(SCAN_BUDGET_MS)) { commitScan(); scanning = null; }
      applyFade(now);
    },
    dispose() {
      for (const s of Object.values(sets)) s.g.dispose();
      material.dispose();
    },
  };
}
