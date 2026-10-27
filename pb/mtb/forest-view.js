/* Draws the forest and its undergrowth: instanced meshes (one draw call per kind and level of detail), wind sway and leaf flutter in the vertex shader, leaf cards
 * alpha-tested from the painted atlas, translucent backlit foliage, autumn colours as a season option, painted lighting shared with the ground.
 * Trees come from forest.js, ferns / shrubs / hedges / logs / roots from undergrowth.js, both per 32 m block; the instance buffers are refilled when the camera has moved. */
import { BLOCK, SPECIES, STRIDE, girthOf } from './forest.js';
import { U_STRIDE } from './undergrowth.js';
import { buildBroadleaf, buildSapling, buildShrub, buildFern, buildHedge, buildLog, buildStump, buildRoot, buildBlobTree, buildSpruce, buildTuft } from './tree-models.js';
import { TILE_ID } from './leaf-textures.js';
import { hash2 } from './noise.js';
import { sampleWorldMap } from './world-map.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const REFILL_DISTANCE = 5;
const ALWAYS_DRAWN = 45;                // trees closer than this are drawn at every quality (the bike collides with them)
const FADE_SECONDS = 0.5;               // a newly built instance grows from 0 to full scale over this long (hides the rebuild, never an instant pop)
const SCAN_BUDGET_MS = 1.2;             // time-sliced block scan: a rebuild pays at most this many ms of CPU per frame, never one big hitch
const LOOKAHEAD_SECONDS = 2.0;          // the cheap far tier leans this many seconds of travel into the heading (built and visible before the rider gets there)
const LOOKAHEAD_MAX = 70;               // m
const LOD_JITTER = 0.12;                // the near/mid LOD swap distance is staggered +/- this share per tree, so a whole ring never pops at once
const now_ = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const VERTEX = `
  attribute vec3 iPos; attribute vec4 iParams; attribute vec3 iShape; attribute vec3 color; attribute float aLeaf;
  uniform vec2 uWind; uniform float uBend, uFlutter, uTime;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight; varying vec2 vUv; varying float vLeaf; varying float vSeed;
  void main(){
    float s = iParams.x, ang = iParams.y;
    vec3 shape = iShape;
    float c = cos(ang), sn = sin(ang);
    vec3 p = position; p.x *= iShape.x; p.xz *= iShape.z; p *= s;
    vec3 n0 = normal;
    float cp = cos(iShape.y), sp = sin(iShape.y);
    p = vec3(cp * p.x - sp * p.y, sp * p.x + cp * p.y, p.z); n0 = vec3(cp * n0.x - sp * n0.y, sp * n0.x + cp * n0.y, n0.z);
    vec3 r = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
    float h = max(position.y, 0.0);
    float bend = pow(h, 1.7) * s * uBend;
    float gust = sin(uTime * 1.25 + iParams.w * 6.283 + iPos.x * 0.05) * 0.6 + sin(uTime * 2.7 + iParams.w * 11.0 + iPos.z * 0.07) * 0.25;
    r.x += gust * bend * (0.5 + uWind.x); r.z += gust * bend * 0.6 * (0.5 + uWind.y);
    if (aLeaf >= 0.0) {                                           // leaves flutter on top of the sway
      float ph = dot(position, vec3(7.3, 5.1, 6.7)) + iParams.z * 40.0;
      r += vec3(sin(uTime * 3.1 + ph), sin(uTime * 2.3 + ph * 1.3) * 0.5, cos(uTime * 2.7 + ph * 0.8)) * uFlutter * (0.35 + gust * 0.25) * (0.5 + uWind.x);
    }
    vec3 world = r + iPos;
    vec3 nrm = vec3(c * n0.x + sn * n0.z, n0.y, -sn * n0.x + c * n0.z);
    vNormal = nrm;
    float t = fract(iParams.z * 13.7);
    vColor = color * (0.88 + 0.26 * t);
    vSeed = iParams.z; vLeaf = aLeaf; vUv = uv;
    vWorld = world; vHeight = position.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform sampler2D uNoise, uAtlas, uBarkBeech, uBarkOak;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight; varying vec2 vUv; varying float vLeaf; varying float vSeed;
  ${PAINT_LIGHT_GLSL}
  void main(){
    float tile = floor(vLeaf + 0.001);
    float rnd = fract(vLeaf) * 2.0;
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing && tile >= 0.0) N = -N;
    vec3 albedo = vColor;
    float isLeaf = 0.0;
    float farCrown = 0.0;
    float bump = 0.0;
    if (tile >= 0.0) {
      vec4 tex = texture2D(uAtlas, vUv);
      if (tex.a < 0.5) discard;
      float oak = step(0.5, tile) * step(tile, 1.5) + step(10.5, tile) * step(tile, 13.5);
      albedo = vColor * tex.rgb * mix(vec3(0.8, 0.97, 0.74) * mix(vec3(1.0), vec3(0.82, 0.96, 0.78), oak), vec3(1.04, 1.0, 0.96), uSeason);                // summer: fresh green (the painted sprigs are lime), autumn keeps the paint
      albedo.r = mix(albedo.r, min(albedo.r, albedo.g * 0.7), 1.0 - uSeason);               // summer leaves stay green: no lime-yellow crowns (autumn is the season option)
      isLeaf = 1.0;
      // autumn: every tree turns at its own time, every cluster has its own colour (holly and spruce stay green)
      float evergreen = step(2.5, tile) * step(tile, 3.5) + step(5.5, tile) * step(tile, 6.5);
      float turn = smoothstep(vSeed - 0.25, vSeed + 0.1, uSeason * 1.25) * (1.0 - evergreen);
      vec3 aut = mix(vec3(0.95, 0.66, 0.14), vec3(0.82, 0.34, 0.08), fract(rnd * 7.0));
      aut = mix(aut, vec3(0.55, 0.34, 0.14), step(0.82, rnd));
      float lum = dot(tex.rgb, vec3(0.3, 0.55, 0.15));
      albedo = mix(albedo, aut * (0.55 + 1.5 * lum) * (vColor.g * 1.1), turn * 0.88);
    } else if (tile < -1.5) {
      // painted bark, projected from the two horizontal axes (trunks are upright): beech smooth grey-green, oak and everything else dark and furrowed
      vec3 aw = pow(abs(N), vec3(4.0)); float wx = aw.x / (aw.x + aw.z + 0.0001);
      vec2 uvx = vec2(vWorld.z * 0.62, -vWorld.y * 0.52), uvz = vec2(vWorld.x * 0.62 + 0.4, -vWorld.y * 0.52);
      vec3 tb = tile > -2.5 ? texture2D(uBarkOak, uvx).rgb * wx + texture2D(uBarkOak, uvz).rgb * (1.0 - wx) : texture2D(uBarkBeech, uvx).rgb * wx + texture2D(uBarkBeech, uvz).rgb * (1.0 - wx);
      float ao = clamp(dot(vColor, vec3(0.333)) / (tile > -2.5 ? 0.4 : 0.55), 0.35, 1.25);       // the model's own darkening (foot, moss, limbs) rides on the painting
      albedo = tb * ao * (tile > -2.5 ? 1.15 : 1.0);
      float k = texture2D(uNoise, vWorld.xz * 0.35 + vWorld.yy * 0.12).g;
      albedo *= 0.88 + 0.24 * k;
      bump = dot(tb, vec3(0.3, 0.59, 0.11));
    } else {
      // far tier (flat blobs and cones, no leaf cards): paint the canopy instead of a plain teal wash. Leaf-sized noise breaks the facets up, the green is warmed towards the
      // painted leaves of the mid tier, the lower crown is darker (it sits in the shade of the stand), and the normal leans to the sky so the 20 faces of a blob do not read as flat
      // cut-out planes in front of the trunks. (The haze that pushes the distance back is added after the lighting, below.)
      float k = texture2D(uNoise, vWorld.xz * 0.4 + vWorld.yy * 0.15).g;
      float lf = texture2D(uNoise, vWorld.xz * 1.9 + vWorld.yy * 1.3).g, lf2 = texture2D(uNoise, vWorld.zx * 4.3 - vWorld.yy * 2.1).g;
      farCrown = step(albedo.r, albedo.g * 0.85);                                          // a green crown (bark is grey or brown: red is not below 85 % of green)
      albedo *= mix(vec3(1.0), vec3(1.32, 1.0, 0.66), farCrown * 0.85);
      albedo *= mix(1.0, 0.42 + 0.46 * smoothstep(0.2, 0.95, vHeight), farCrown);
      albedo *= (0.62 + 0.76 * lf) * (0.86 + 0.28 * lf2);
      albedo = mix(albedo, albedo * vec3(1.35, 1.2, 0.5), farCrown * smoothstep(0.62, 0.8, lf) * 0.55 * smoothstep(0.35, 0.8, vHeight));      // sunlit yellow-green clumps near the tops
      albedo *= 0.88 + 0.24 * k;
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), farCrown * 0.5));
    }
    // light: leaves are thin, the sun shines through them (backlit canopy glows), bark is plain
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float sunMul = mix(1.0, 0.75, uCloud * 0.6);
    float shade = 0.74 + 0.3 * clamp(vHeight, 0.0, 1.0);
    vec3 col;
    if (isLeaf > 0.5) {
      float wrap = dot(N, L) * 0.5 + 0.5;
      vec3 Nl = normalize(mix(N, L, 0.25));
      col = paintLightW(albedo, Nl, sunMul, shade, vWorld);
      float trans = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * (1.0 - wrap * 0.4);
      col += albedo * vec3(0.9, 1.0, 0.35) * uSunColor * trans * 0.55 * sunMul;
    } else {
      if (tile < -1.5) { float dist = length(cameraPosition - vWorld); N = bumpNormal(N, vWorld, bump, 0.05 * (1.0 - smoothstep(10.0, 40.0, dist))); }
      col = paintLightW(albedo * (tile < -1.5 ? 1.12 : 1.3), N, sunMul, 1.1, vWorld);                // bark: lifted out of the shade, stems read as stems, not as poles
    }
    col = mix(col, uFogColor * vec3(0.8, 0.88, 0.8), farCrown * 0.38 * smoothstep(50.0, 220.0, vDist));          // air between you and the far stand: the distance recedes instead of standing as a flat green strip
    col = col * (1.0 - 0.22 * uWet);
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), 1.0);
  }
`;

const quality = (q, low, medium, high) => (q.id === 'low' ? low : q.id === 'medium' ? medium : high);

export function createForestView({ scene, trees, undergrowth, env, quality: Q, textures, meadow }) {
  const group = new THREE.Group();
  group.name = 'mtb-forest';
  scene.add(group);
  const make = (bend, flutter) => new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uAtlas: { value: textures.leafAtlas }, uBarkBeech: { value: textures.barkBeech }, uBarkOak: { value: textures.barkOak }, uBend: { value: bend }, uFlutter: { value: flutter } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
  });
  const treeMat = make(0.035, 0.05), lowMat = make(0.012, 0.03), deadMat = make(0.0, 0.0), grassMat = make(0.16, 0.02);

  // name, geometry, material, capacity, stride of its source list
  const defs = {
    nearBeechA: [buildBroadleaf('beech', 0, 0), treeMat, 420], nearBeechB: [buildBroadleaf('beech', 1, 0), treeMat, 420], nearOak: [buildBroadleaf('oak', 0, 0), treeMat, 320], nearSpruce: [buildSpruce(2), treeMat, 300],
    midBeech: [buildBroadleaf('beech', 2, 1), treeMat, 1400], midOak: [buildBroadleaf('oak', 1, 1), treeMat, 900], midSpruce: [buildSpruce(1), treeMat, 700],
    farBeech: [buildBlobTree('beech', 0), treeMat, 4800], farOak: [buildBlobTree('oak', 0), treeMat, 2400], farSpruce: [buildSpruce(0), treeMat, 2200],
    sapling: [buildSapling(0), lowMat, 900],
    fern: [buildFern(), lowMat, 2600], holly: [buildShrub('holly'), lowMat, 420], bramble: [buildShrub('bramble'), lowMat, 420], hedge: [buildHedge(), lowMat, 700],
    tuft: [buildTuft(TILE_ID.grass), grassMat, 3600], herbs: [buildTuft(TILE_ID.herbs), grassMat, 900],
    log: [buildLog(), deadMat, 120], stump: [buildStump(), deadMat, 80], root: [buildRoot(), deadMat, 160],
  };
  const sets = {};
  for (const [name, [geo, material, cap]] of Object.entries(defs)) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index; g.attributes = geo.attributes;
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    const par = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); par.setUsage(THREE.DynamicDrawUsage);
    const shp = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); shp.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', pos); g.setAttribute('iParams', par); g.setAttribute('iShape', shp);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false; mesh.name = `veg ${name}`;
    group.add(mesh);
    // base = the true (un-faded) scale of each live instance, spawn = the game-clock time it was first built: applyFade() grows iParams.x from 0 to base over FADE_SECONDS
    sets[name] = { g, pos, par, shp, cap, n: 0, base: new Float32Array(cap), spawn: new Float32Array(cap) };
  }
  /** Writes an instance straight into the live, drawn set (used for the one-off synchronous build and for grass tufts): no time-slicing, no fade. */
  function putLive(name, x, y, z, scale, yaw, seed, stretch = 1, pitch = 0, girth = 1) {
    const s = sets[name];
    if (s.n >= s.cap) return false;
    const o = s.n++;
    s.pos.array[o * 3] = x; s.pos.array[o * 3 + 1] = y; s.pos.array[o * 3 + 2] = z;
    s.par.array[o * 4] = scale; s.par.array[o * 4 + 1] = yaw; s.par.array[o * 4 + 2] = seed; s.par.array[o * 4 + 3] = (seed * 7.31) % 1;
    s.shp.array[o * 3] = stretch; s.shp.array[o * 3 + 1] = pitch; s.shp.array[o * 3 + 2] = girth;
    s.base[o] = scale; s.spawn[o] = -1e9;                     // spawn far in the past: already fully faded in, no animation
    return true;
  }

  /** Marks the first n instances of an instance attribute for upload (only that range goes to the GPU, not the whole preallocated capacity). */
  function touch(attr, n) {
    if (n <= 0) return;
    attr.clearUpdateRanges(); attr.addUpdateRange(0, n * attr.itemSize); attr.needsUpdate = true;
  }

  /** The staging build (scanned over several frames): one plain-array mirror of `sets`, swapped in whole once a scan completes. */
  function makeStage() {
    const st = {};
    for (const [name, s] of Object.entries(sets)) st[name] = { n: 0, cap: s.cap, pos: new Float32Array(s.cap * 3), scale: new Float32Array(s.cap), yaw: new Float32Array(s.cap), seed: new Float32Array(s.cap), stretch: new Float32Array(s.cap), pitch: new Float32Array(s.cap), girth: new Float32Array(s.cap), spawn: new Float32Array(s.cap) };
    return st;
  }
  let stage = makeStage();
  let spawnMap = new Map();                                   // world key -> the game-clock time this exact tree/fern/log was first built (persists across rebuilds)
  function putStage(name, x, y, z, scale, yaw, seed, stretch, pitch, girth, spawnNext, now) {
    const st = stage[name];
    if (st.n >= st.cap) return false;
    const o = st.n++;
    st.pos[o * 3] = x; st.pos[o * 3 + 1] = y; st.pos[o * 3 + 2] = z;
    st.scale[o] = scale; st.yaw[o] = yaw; st.seed[o] = seed; st.stretch[o] = stretch; st.pitch[o] = pitch; st.girth[o] = girth;
    const key = (x * 4 | 0) + ',' + (z * 4 | 0);
    let sp = spawnMap.get(key);
    if (sp === undefined) sp = now;                           // never built before here: starts its fade-in now
    spawnNext.set(key, sp);
    st.spawn[o] = sp;
    return true;
  }

  const stats = { near: 0, mid: 0, far: 0, undergrowth: 0, blocks: 0 };

  const meadowScratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
  /** Grass tufts and herbs on a fixed world grid around the camera (so they never swim); the meadows only. Cheap and small-radius: filled live, not time-sliced. */
  function fillTufts(cx, cz) {
    const R = Q.tuftRadius, cs = 0.85;
    const i0 = Math.floor((cx - R) / cs), i1 = Math.floor((cx + R) / cs), j0 = Math.floor((cz - R) / cs), j1 = Math.floor((cz + R) / cs);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + hash2(i, j, 51)) * cs, z = (j + hash2(i, j, 52)) * cs;
        const d = Math.hypot(x - cx, z - cz);
        if (d > R) continue;
        const m = sampleWorldMap(meadow.map, x, z, meadowScratch);
        const density = m.grass * (1 - m.built) * (1 - m.water) * (1 - m.rock);
        if (density < 0.3 || hash2(i, j, 53) > density * 0.85) continue;
        if (meadow.clearance(x, z) > 0.03) continue;
        const k = hash2(i, j, 54), fade = 1 - Math.min(1, Math.max(0, (d - R * 0.65) / (R * 0.35)));
        if (fade <= 0.05) continue;
        putLive(k < 0.18 ? 'herbs' : 'tuft', x, meadow.surface.height(x, z) - 0.02, z, (0.3 + hash2(i, j, 55) * 0.3) * fade, hash2(i, j, 56) * 6.283, k);
      }
    }
  }

  /** One block's trees and undergrowth into the staging build. `s` = the scan state (see startScan). The far tier reaches past R, into the travel-ahead point `s.ax, s.az`
   *  (cheap blob trees only: near/mid stay strictly within R of the true camera, so their triangle cost never grows). */
  function processBlock(bx, bz, s) {
    const t = trees.block(bx, bz);
    for (let i = 0; i < t.length; i += STRIDE) {
      const x = t[i], z = t[i + 2];
      const dTrue = Math.hypot(x - s.cx, z - s.cz);
      const species = t[i + 4], seed = t[i + 5], h = t[i + 3], y = t[i + 1] - 0.15;
      if (species === SPECIES.sapling) {
        if (dTrue < s.midR * 0.7 && putStage('sapling', x, y, z, h, seed * 6.283, seed, 1, 0, 1, s.spawnNext, s.now)) s.mid++;
        continue;
      }
      const girth = girthOf(seed, species);
      const jitter = 1 + LOD_JITTER * (((seed * 13.7) % 1) * 2 - 1);
      let d = dTrue, farOnly = false;
      if (dTrue > s.R) {                                        // beyond the normal radius: only the cheap far tier reaches ahead of travel
        const dAhead = Math.hypot(x - s.ax, z - s.az);
        if (dAhead > s.R) continue;
        farOnly = true;
      }
      if (dTrue > ALWAYS_DRAWN && ((seed * 7.31) % 1) > Q.treeDensity) continue;      // thinning for the quality level (never near the rider)
      const yaw = seed * 6.283;
      if (!farOnly && d < s.nearR * jitter) {
        const name = species === SPECIES.spruce ? 'nearSpruce' : species === SPECIES.oak ? 'nearOak' : (seed * 3.7) % 1 < 0.5 ? 'nearBeechA' : 'nearBeechB';
        if (putStage(name, x, y, z, h, yaw, seed, 1, 0, girth, s.spawnNext, s.now)) { s.near++; continue; }
      }
      if (!farOnly && d < s.midR * jitter) {
        if (putStage(species === SPECIES.spruce ? 'midSpruce' : species === SPECIES.oak ? 'midOak' : 'midBeech', x, y, z, h, yaw, seed, 1, 0, girth, s.spawnNext, s.now)) { s.mid++; continue; }
      }
      if (putStage(species === SPECIES.spruce ? 'farSpruce' : species === SPECIES.oak ? 'farOak' : 'farBeech', x, y, z, h, yaw, seed, 1, 0, girth, s.spawnNext, s.now)) s.far++;
    }
    if (Math.hypot(bx * BLOCK + BLOCK / 2 - s.cx, bz * BLOCK + BLOCK / 2 - s.cz) > s.groundR + BLOCK) return;
    const u = undergrowth.block(bx, bz);
    const lists = [['fern', u.ferns, Q.fernRadius], ['holly', u.holly, Q.shrubRadius], ['bramble', u.brambles, Q.shrubRadius], ['hedge', u.hedges, Q.shrubRadius * 1.3], ['log', u.logs, s.groundR], ['stump', u.stumps, s.groundR], ['root', u.roots, Q.shrubRadius]];
    for (const [name, list, radius] of lists) {
      for (let i = 0; i < list.length; i += U_STRIDE) {
        if (Math.hypot(list[i] - s.cx, list[i + 2] - s.cz) > radius) continue;
        if (putStage(name, list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5], list[i + 6], list[i + 7], 1, s.spawnNext, s.now)) s.under++;
      }
    }
  }

  let scanning = null, last = { x: 1e9, z: 1e9 };
  /** Begins a time-sliced rebuild: queues every block in the (possibly travel-elongated) radius, resets the staging arrays. */
  function startScan(cx, cz, ax, az, now) {
    const R = Q.treeRadius, groundR = Q.groundCover, r = Math.max(R, groundR);
    const b0x = Math.floor((Math.min(cx, ax) - r) / BLOCK), b1x = Math.floor((Math.max(cx, ax) + r) / BLOCK);
    const b0z = Math.floor((Math.min(cz, az) - r) / BLOCK), b1z = Math.floor((Math.max(cz, az) + r) / BLOCK);
    const queue = [];
    for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) queue.push(bx, bz);
    for (const st of Object.values(stage)) st.n = 0;            // the staging arrays are reused (a scan every ~5 m of riding used to allocate about 1 MB of typed arrays each time)
    scanning = { queue, qi: 0, cx, cz, ax, az, R, nearR: Q.nearTree, midR: Q.midTree, groundR, near: 0, mid: 0, far: 0, under: 0, spawnNext: new Map(), now };
  }
  /** Processes queued blocks for up to `budgetMs` of wall-clock time (or the whole queue when budgetMs is unbounded). Returns true once the scan is complete. */
  function stepScan(budgetMs) {
    const s = scanning, t0 = now_();
    while (s.qi < s.queue.length) {
      processBlock(s.queue[s.qi], s.queue[s.qi + 1], s);
      s.qi += 2;
      if (now_() - t0 > budgetMs) return false;
    }
    return true;
  }
  /** Swaps the finished staging build into the live, drawn sets; `instant` skips the fade (the very first build, behind the loading screen). */
  function commitScan(instant) {
    const s = scanning;
    for (const [name, st] of Object.entries(stage)) {
      const live = sets[name];
      live.n = st.n;
      live.pos.array.set(st.pos.subarray(0, st.n * 3));
      live.base.set(st.scale.subarray(0, st.n));
      live.spawn.set(instant ? new Float32Array(st.n).fill(-1e9) : st.spawn.subarray(0, st.n));
      for (let o = 0; o < st.n; o++) {
        live.par.array[o * 4 + 1] = st.yaw[o]; live.par.array[o * 4 + 2] = st.seed[o]; live.par.array[o * 4 + 3] = (st.seed[o] * 7.31) % 1;
        live.shp.array[o * 3] = st.stretch[o]; live.shp.array[o * 3 + 1] = st.pitch[o]; live.shp.array[o * 3 + 2] = st.girth[o];
      }
      touch(live.pos, st.n); touch(live.shp, st.n); touch(live.par, st.n);
    }
    spawnMap = s.spawnNext;
    if (Q.tuftRadius > 0 && meadow) { sets.tuft.n = 0; sets.herbs.n = 0; fillTufts(s.cx, s.cz); }
    stats.near = s.near; stats.mid = s.mid; stats.far = s.far; stats.undergrowth = s.under; stats.blocks = trees.blocks.size;
    last = { x: s.cx, z: s.cz };
    applyFade(s.now);                                         // write the correct (possibly zero) starting scale before the next render
    for (const kg of Object.values(sets)) kg.g.instanceCount = kg.n;
  }
  /** Grows every instance younger than FADE_SECONDS toward its true scale; called every frame, cheap (plain array math, no block scanning). */
  function applyFade(now) {
    for (const s of Object.values(sets)) {
      let fading = false;
      for (let o = 0; o < s.n; o++) {
        const t = Math.min(1, (now - s.spawn[o]) / FADE_SECONDS);
        if (t < 1) fading = true;
        const e = t * t * (3 - 2 * t);
        s.par.array[o * 4] = s.base[o] * e;
      }
      if (fading) touch(s.par, s.n);
    }
  }

  return {
    group, stats, sets,
    /** cx, cz = camera position; vx, vz = the bike's velocity (m/s: used only to lean the cheap far tier ahead of travel); now = the game clock (s). */
    update(cx, cz, vx = 0, vz = 0, now = 0, force = false) {
      const speed = Math.hypot(vx, vz), ahead = Math.min(LOOKAHEAD_MAX, speed * LOOKAHEAD_SECONDS);
      const ax = cx + (speed > 0.5 ? vx / speed : 0) * ahead, az = cz + (speed > 0.5 ? vz / speed : 0) * ahead;
      if (force) {
        startScan(cx, cz, ax, az, now);
        while (!stepScan(Infinity)) { /* no budget on the one-off synchronous build behind the loading screen */ }
        commitScan(true);
        scanning = null;
        return;
      }
      if (!scanning && Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) startScan(cx, cz, ax, az, now);
      if (scanning && stepScan(SCAN_BUDGET_MS)) { commitScan(false); scanning = null; }
      applyFade(now);
    },
    dispose() { for (const s of Object.values(sets)) s.g.dispose(); treeMat.dispose(); lowMat.dispose(); deadMat.dispose(); grassMat.dispose(); },
  };
}
