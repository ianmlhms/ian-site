/* Draws the sandstone: one instanced mesh per model and level of detail, painted in the fragment shader (strata from the world height, honeycomb weathering,
 * dark water streaks, moss on the ledges and the damp foot), lit like the rest of the world. Rocks come from rocks.js per 32 m block. */
import { BLOCK, R_STRIDE, KIND } from './rocks.js';
import { buildRockModels } from './rock-models.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const REFILL_DISTANCE = 6;
const CAPACITY = { slabA: 260, slabB: 260, overhang: 120, boulderA: 260, boulderB: 260, stone: 500 };
const NAMES = ['slabA', 'slabB', 'overhang', 'boulderA', 'boulderB', 'stone'];

const VERTEX = `
  attribute vec3 iPos; attribute vec4 iRot; attribute vec3 iScale; attribute vec3 color; attribute float aSkirt;
  varying vec3 vWorld; varying vec3 vNormal; varying vec3 vColor; varying float vDist; varying float vLocalY; varying float vSeed; varying float vTop;
  void main(){
    float yaw = iRot.x, alpha = iRot.y, sink = iRot.z;
    vec3 p = position * iScale;
    // tilt about x (the face leans back with the slope), then turn about y
    float ca = cos(alpha), sa = sin(alpha);
    p = vec3(p.x, ca * p.y + sa * p.z, -sa * p.y + ca * p.z);
    vec3 n = vec3(normal.x, ca * normal.y + sa * normal.z, -sa * normal.y + ca * normal.z);
    float cy = cos(yaw), sy = sin(yaw);
    p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
    n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
    vec3 world = p + iPos;
    world.y -= sink * aSkirt;
    vWorld = world; vNormal = n; vColor = color; vLocalY = position.y * iScale.y; vSeed = iRot.w; vTop = position.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform sampler2D uRock, uNoise, uMoss;
  uniform float uDetail;
  varying vec3 vWorld; varying vec3 vNormal; varying vec3 vColor; varying float vDist; varying float vLocalY; varying float vSeed; varying float vTop;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 P = vWorld;
    // triplanar weights: faces are painted from the side they face
    vec3 w = pow(abs(N), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec2 uvX = vec2(P.z * 0.23, P.y * 0.34), uvZ = vec2(P.x * 0.23, P.y * 0.34), uvY = P.xz * 0.23;
    vec3 rockC = texture2D(uRock, uvX).rgb * w.x + texture2D(uRock, uvZ).rgb * w.z + texture2D(uRock, uvY).rgb * w.y;
    float nA = texture2D(uNoise, P.xz * 0.05 + P.y * 0.03).r;
    // strata: horizontal bands in the world height, each with its own tone
    float band = P.y * 5.2 + nA * 6.0;
    float strata = sin(band) * 0.5 + 0.5;
    rockC *= mix(0.78, 1.12, strata) * (0.95 + 0.1 * sin(P.y * 23.0 + nA * 8.0));
    rockC = mix(rockC, rockC * vec3(1.06, 0.94, 0.8) + vec3(0.05, 0.0, -0.03), smoothstep(0.3, 0.7, texture2D(uNoise, vec2(floor(band / 6.2832) * 0.37, vSeed)).g));    // ochre / pale layers
    // honeycomb weathering (tafoni): pits of a few decimetres, lit rim, dark hollow
    float pits = 0.0;
    if (uDetail > 0.5) {
      vec2 hu = (w.x > w.z ? vec2(P.z, P.y) : vec2(P.x, P.y)) * 2.3 + vec2(nA * 1.4, 0.0);
      vec4 hn = texture2D(uNoise, hu * 0.7);
      float cell = smoothstep(0.52, 0.66, hn.b * 0.7 + hn.g * 0.55);
      pits = cell * (1.0 - smoothstep(25.0, 70.0, vDist)) * (1.0 - w.y);
    }
    rockC *= 1.0 - 0.38 * pits;
    // dark water streaks running down the face
    float streak = texture2D(uNoise, vec2((P.x + P.z) * 0.8, P.y * 0.03)).g;
    rockC *= 1.0 - 0.36 * smoothstep(0.58, 0.88, streak) * (1.0 - w.y);
    // moss: on the ledges (up-facing), on the damp foot, in the hollows
    vec3 mossC = texture2D(uMoss, P.xz * 0.37 + P.y * 0.11).rgb * 0.95;
    float mossN = texture2D(uNoise, P.xz * 0.19 + P.y * 0.12).b;
    float moss = smoothstep(0.3, 0.9, N.y) * 0.85 + (1.0 - smoothstep(0.1, 1.4, vLocalY)) * 0.55 + pits * 0.35;
    moss = clamp(moss * smoothstep(0.25, 0.7, mossN + 0.18 + uWet * 0.2), 0.0, 0.92);
    vec3 albedo = mix(rockC, mossC, moss) * vColor;
    albedo *= 1.0 - 0.22 * uWet;
    // small normal wobble so the faces are not glassy
    vec2 dn = texture2D(uNoise, P.xz * 0.9 + P.y * 0.6).gb - 0.5;
    N = normalize(N + vec3(dn.x, dn.y * 0.5, dn.y) * 0.3 * (1.0 - smoothstep(30.0, 90.0, vDist)));
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo, N, sunMul, 0.84, P);
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, P.y), 1.0);
  }
`;

export function createRockView({ scene, rocks, env, quality, textures }) {
  const group = new THREE.Group();
  group.name = 'mtb-rocks';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uRock: { value: textures.sandstone }, uMoss: { value: textures.moss }, uDetail: { value: quality.id === 'low' ? 0 : 1 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
  });
  const models = buildRockModels();
  const sets = {};
  for (const name of NAMES) {
    for (const lod of ['near', 'far']) {
      const cap = CAPACITY[name];
      const geo = models[name][lod];
      const g = new THREE.InstancedBufferGeometry();
      g.index = geo.index; g.attributes = geo.attributes;
      const pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
      const rot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); rot.setUsage(THREE.DynamicDrawUsage);
      const scl = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); scl.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iPos', pos); g.setAttribute('iRot', rot); g.setAttribute('iScale', scl);
      g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false; mesh.name = `rock ${name} ${lod}`;
      group.add(mesh);
      sets[`${name}:${lod}`] = { g, pos, rot, scl, cap, n: 0 };
    }
  }
  let last = { x: 1e9, z: 1e9 };
  const stats = { near: 0, far: 0 };
  const stones = [];                                              // stones in the streams near the camera: the foam rings read them

  function refill(cx, cz) {
    for (const s of Object.values(sets)) s.n = 0;
    stones.length = 0;
    const R = quality.rockRadius, near = quality.rockNear;
    const b0x = Math.floor((cx - R) / BLOCK), b1x = Math.floor((cx + R) / BLOCK), b0z = Math.floor((cz - R) / BLOCK), b1z = Math.floor((cz + R) / BLOCK);
    let nNear = 0, nFar = 0;
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const t = rocks.block(bx, bz);
        for (let i = 0; i < t.length; i += R_STRIDE) {
          const x = t[i], z = t[i + 2];
          const d = Math.hypot(x - cx, z - cz);
          const kind = t[i + 9];
          const reach = kind === KIND.stone ? Math.min(R, near * 1.2) : R;
          if (d > reach) continue;
          if (kind === KIND.stone) stones.push({ x, z, y: t[i + 1] + t[i + 5] * 0.32, size: t[i + 5] * 0.9, seed: t[i + 10] });
          const lod = d < near ? 'near' : 'far';
          const s = sets[`${NAMES[kind]}:${lod}`];
          if (s.n >= s.cap) continue;
          const o = s.n++;
          s.pos.array[o * 3] = x; s.pos.array[o * 3 + 1] = t[i + 1]; s.pos.array[o * 3 + 2] = z;
          s.rot.array[o * 4] = t[i + 3]; s.rot.array[o * 4 + 1] = t[i + 4]; s.rot.array[o * 4 + 2] = t[i + 8]; s.rot.array[o * 4 + 3] = t[i + 10];
          s.scl.array[o * 3] = t[i + 5]; s.scl.array[o * 3 + 1] = t[i + 6]; s.scl.array[o * 3 + 2] = t[i + 7];
          if (lod === 'near') nNear++; else nFar++;
        }
      }
    }
    for (const s of Object.values(sets)) { s.g.instanceCount = s.n; s.pos.needsUpdate = true; s.rot.needsUpdate = true; s.scl.needsUpdate = true; }
    stats.near = nNear; stats.far = nFar;
  }

  return {
    group, stats, sets, stones,
    update(cx, cz, force = false) { if (force || Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) { refill(cx, cz); last = { x: cx, z: cz }; } },
    dispose() { for (const s of Object.values(sets)) s.g.dispose(); material.dispose(); },
  };
}
