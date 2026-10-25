/* Draws the forest and its undergrowth: instanced meshes (one draw call per kind and level of detail), wind sway and leaf flutter in the vertex shader, leaf cards
 * alpha-tested from the painted atlas, translucent backlit foliage, autumn colours as a season option, painted lighting shared with the ground.
 * Trees come from forest.js, ferns / shrubs / hedges / logs / roots from undergrowth.js, both per 32 m block; the instance buffers are refilled when the camera has moved. */
import { BLOCK, SPECIES, STRIDE } from './forest.js';
import { U_STRIDE } from './undergrowth.js';
import { buildBroadleaf, buildSapling, buildShrub, buildFern, buildHedge, buildLog, buildStump, buildRoot, buildBlobTree, buildSpruce, buildTuft } from './tree-models.js';
import { TILE_ID } from './leaf-textures.js';
import { hash2 } from './noise.js';
import { sampleWorldMap } from './world-map.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const REFILL_DISTANCE = 5;
const ALWAYS_DRAWN = 45;                // trees closer than this are drawn at every quality (the bike collides with them)

const VERTEX = `
  attribute vec3 iPos; attribute vec4 iParams; attribute vec2 iShape; attribute vec3 color; attribute float aLeaf;
  uniform vec2 uWind; uniform float uBend, uFlutter, uTime;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight; varying vec2 vUv; varying float vLeaf; varying float vSeed;
  void main(){
    float s = iParams.x, ang = iParams.y;
    float c = cos(ang), sn = sin(ang);
    vec3 p = position; p.x *= iShape.x; p *= s;
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
  uniform sampler2D uNoise, uAtlas;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight; varying vec2 vUv; varying float vLeaf; varying float vSeed;
  ${PAINT_LIGHT_GLSL}
  void main(){
    float tile = floor(vLeaf + 0.001);
    float rnd = fract(vLeaf) * 2.0;
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing && tile >= 0.0) N = -N;
    vec3 albedo = vColor;
    float isLeaf = 0.0;
    if (tile >= 0.0) {
      vec4 tex = texture2D(uAtlas, vUv);
      if (tex.a < 0.5) discard;
      albedo = vColor * tex.rgb * vec3(1.04, 1.0, 0.96);
      isLeaf = 1.0;
      // autumn: every tree turns at its own time, every cluster has its own colour (holly and spruce stay green)
      float evergreen = step(2.5, tile) * step(tile, 3.5) + step(5.5, tile) * step(tile, 6.5);
      float turn = smoothstep(vSeed - 0.25, vSeed + 0.1, uSeason * 1.25) * (1.0 - evergreen);
      vec3 aut = mix(vec3(0.95, 0.66, 0.14), vec3(0.82, 0.34, 0.08), fract(rnd * 7.0));
      aut = mix(aut, vec3(0.55, 0.34, 0.14), step(0.82, rnd));
      float lum = dot(tex.rgb, vec3(0.3, 0.55, 0.15));
      albedo = mix(albedo, aut * (0.55 + 1.5 * lum) * (vColor.g * 1.1), turn * 0.88);
    } else {
      vec3 wp = vWorld * 0.9;
      float k = texture2D(uNoise, wp.xz * 0.4 + wp.yy * 0.15).g;
      albedo *= 0.88 + 0.24 * k;
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
      col = paintLightW(albedo * 1.3, N, sunMul, 1.1, vWorld);                // bark: lifted out of the shade, light grey beech stems read as stems, not as poles
    }
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
    uniforms: { ...env.uniforms, uAtlas: { value: textures.leafAtlas }, uBend: { value: bend }, uFlutter: { value: flutter } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
  });
  const treeMat = make(0.035, 0.05), lowMat = make(0.012, 0.03), deadMat = make(0.0, 0.0), grassMat = make(0.16, 0.02);

  // name, geometry, material, capacity, stride of its source list
  const defs = {
    nearBeechA: [buildBroadleaf('beech', 0, 0), treeMat, 420], nearBeechB: [buildBroadleaf('beech', 1, 0), treeMat, 420], nearOak: [buildBroadleaf('oak', 0, 0), treeMat, 320], nearSpruce: [buildSpruce(2), treeMat, 300],
    midBeech: [buildBroadleaf('beech', 2, 1), treeMat, 1400], midOak: [buildBroadleaf('oak', 1, 1), treeMat, 900], midSpruce: [buildSpruce(1), treeMat, 700],
    farBeech: [buildBlobTree('beech', 0), treeMat, 3600], farOak: [buildBlobTree('oak', 0), treeMat, 1800], farSpruce: [buildSpruce(0), treeMat, 1600],
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
    const shp = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2); shp.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', pos); g.setAttribute('iParams', par); g.setAttribute('iShape', shp);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false; mesh.name = `veg ${name}`;
    group.add(mesh);
    sets[name] = { g, pos, par, shp, cap, n: 0 };
  }
  function put(set, x, y, z, scale, yaw, seed, stretch = 1, pitch = 0) {
    const s = sets[set];
    if (s.n >= s.cap) return false;
    const o = s.n++;
    s.pos.array[o * 3] = x; s.pos.array[o * 3 + 1] = y; s.pos.array[o * 3 + 2] = z;
    s.par.array[o * 4] = scale; s.par.array[o * 4 + 1] = yaw; s.par.array[o * 4 + 2] = seed; s.par.array[o * 4 + 3] = (seed * 7.31) % 1;
    s.shp.array[o * 2] = stretch; s.shp.array[o * 2 + 1] = pitch;
    return true;
  }

  let last = { x: 1e9, z: 1e9 };
  const stats = { near: 0, mid: 0, far: 0, undergrowth: 0, blocks: 0 };

  const meadowScratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
  /** Grass tufts and herbs on a fixed world grid around the camera (so they never swim); the meadows only. */
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
        put(k < 0.18 ? 'herbs' : 'tuft', x, meadow.surface.height(x, z) - 0.02, z, (0.3 + hash2(i, j, 55) * 0.3) * fade, hash2(i, j, 56) * 6.283, k);
      }
    }
  }

  function refill(cx, cz) {
    for (const s of Object.values(sets)) s.n = 0;
    const R = Q.treeRadius, nearR = Q.nearTree, midR = Q.midTree, groundR = Q.groundCover;
    const r = Math.max(R, groundR);
    const b0x = Math.floor((cx - r) / BLOCK), b1x = Math.floor((cx + r) / BLOCK), b0z = Math.floor((cz - r) / BLOCK), b1z = Math.floor((cz + r) / BLOCK);
    let near = 0, mid = 0, far = 0, under = 0;
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const t = trees.block(bx, bz);
        for (let i = 0; i < t.length; i += STRIDE) {
          const x = t[i], z = t[i + 2];
          const d = Math.hypot(x - cx, z - cz);
          const species = t[i + 4], seed = t[i + 5], h = t[i + 3], y = t[i + 1] - 0.15;
          if (species === SPECIES.sapling) { if (d < midR * 0.7 && put('sapling', x, y, z, h, seed * 6.283, seed)) mid++; continue; }
          if (d > R) continue;
          if (d > ALWAYS_DRAWN && ((seed * 7.31) % 1) > Q.treeDensity) continue;      // thinning for the quality level (never near the rider)
          const yaw = seed * 6.283;
          if (d < nearR) {
            const name = species === SPECIES.spruce ? 'nearSpruce' : species === SPECIES.oak ? 'nearOak' : (seed * 3.7) % 1 < 0.5 ? 'nearBeechA' : 'nearBeechB';
            if (put(name, x, y, z, h, yaw, seed)) { near++; continue; }
          }
          if (d < midR) {
            if (put(species === SPECIES.spruce ? 'midSpruce' : species === SPECIES.oak ? 'midOak' : 'midBeech', x, y, z, h, yaw, seed)) { mid++; continue; }
          }
          if (put(species === SPECIES.spruce ? 'farSpruce' : species === SPECIES.oak ? 'farOak' : 'farBeech', x, y, z, h, yaw, seed)) far++;
        }
        if (Math.hypot(bx * BLOCK + BLOCK / 2 - cx, bz * BLOCK + BLOCK / 2 - cz) > groundR + BLOCK) continue;
        const u = undergrowth.block(bx, bz);
        const lists = [['fern', u.ferns, Q.fernRadius], ['holly', u.holly, Q.shrubRadius], ['bramble', u.brambles, Q.shrubRadius], ['hedge', u.hedges, Q.shrubRadius * 1.3], ['log', u.logs, groundR], ['stump', u.stumps, groundR], ['root', u.roots, Q.shrubRadius]];
        for (const [name, list, radius] of lists) {
          for (let i = 0; i < list.length; i += U_STRIDE) {
            if (Math.hypot(list[i] - cx, list[i + 2] - cz) > radius) continue;
            if (put(name, list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5], list[i + 6], list[i + 7])) under++;
          }
        }
      }
    }
    if (Q.tuftRadius > 0 && meadow) fillTufts(cx, cz);
    for (const s of Object.values(sets)) { s.g.instanceCount = s.n; s.pos.needsUpdate = true; s.par.needsUpdate = true; s.shp.needsUpdate = true; }
    stats.near = near; stats.mid = mid; stats.far = far; stats.undergrowth = under; stats.blocks = trees.blocks.size;
  }

  return {
    group, stats, sets,
    update(cx, cz, force = false) {
      if (force || Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) { refill(cx, cz); last = { x: cx, z: cz }; }
    },
    dispose() { for (const s of Object.values(sets)) s.g.dispose(); treeMat.dispose(); lowMat.dispose(); deadMat.dispose(); grassMat.dispose(); },
  };
}
