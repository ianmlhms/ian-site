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
  varying vec3 vWorld; varying vec3 vNormal; varying vec3 vColor; varying float vDist; varying float vLocalY; varying float vSeed; varying float vTop; varying vec3 vMP;
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
    vWorld = world; vNormal = n; vColor = color; vLocalY = position.y * iScale.y; vSeed = iRot.w; vTop = position.y; vMP = position * iScale;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform sampler2D uRock, uRockMoss, uRockWet, uNoise, uMoss;
  uniform float uDetail;
  varying vec3 vWorld; varying vec3 vNormal; varying vec3 vColor; varying float vDist; varying float vLocalY; varying float vSeed; varying float vTop; varying vec3 vMP;
  ${PAINT_LIGHT_GLSL}
  const float SCALE = 0.21;                                           // 1 / metres per texture repeat
  float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
  // the painted material, projected from the three world axes (faces are painted from the side they face)
  vec3 tri(sampler2D t, vec3 P, vec3 w, float s){
    vec3 c = vec3(0.0);
    if (w.x > 0.02) c += texture2D(t, vec2(P.z, -P.y) * s).rgb * w.x;
    if (w.z > 0.02) c += texture2D(t, vec2(P.x, -P.y) * s + 0.37).rgb * w.z;
    if (w.y > 0.02) c += texture2D(t, P.xz * s + 0.71).rgb * w.y;
    return c;
  }
  void main(){
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 P = vWorld;
    vec3 w = pow(abs(N), vec3(5.0)); w /= (w.x + w.y + w.z);
    float nA = texture2D(uNoise, P.xz * 0.05 + P.y * 0.03).r;
    float nB = texture2D(uNoise, P.xz * 0.13 + P.y * 0.11).g;
    float nC = texture2D(uNoise, P.xz * 0.45 + P.y * 0.4).b;
    // sandstone: the painted wall, a little greyer and cooler than the paint (the real rock is grey-ochre, not orange), large-scale tone changes per layer
    vec3 sand = tri(uRock, P, w, SCALE);
    float tone = texture2D(uNoise, vec2(floor(P.y * 1.3 + nA * 3.0) * 0.37 + 0.11, vSeed * 0.5)).g;
    sand = mix(vec3(lum(sand)), sand, 0.62) * mix(vec3(1.0, 0.97, 0.88), vec3(0.9, 0.9, 0.84), tone);
    sand *= 0.84 + 0.3 * nB;
    float sandL = lum(sand);
    // moss cover: thick on the up-facing parts and the damp foot, patchy on the faces (north faces and shade carry more), thicker when wet
    float damp = 1.0 - smoothstep(0.1, 2.2, vLocalY);
    float mossAmt = smoothstep(0.4, 0.95, N.y) * 0.85 + damp * 0.55 + (1.0 - w.y) * 0.2;
    mossAmt = mossAmt * smoothstep(0.2, 0.75, nA * 0.5 + nB * 0.5 + 0.12 + uWet * 0.2 + (1.0 - clamp(dot(N, normalize(uSunDir)), 0.0, 1.0)) * 0.18);
    mossAmt = clamp(mossAmt, 0.0, 0.92);
    vec3 mossT = uDetail > 0.5 ? tri(uRockMoss, P, w, SCALE * 0.9) : vec3(0.36, 0.5, 0.2);
    mossT = mix(mossT, mossT * vec3(0.78, 0.98, 0.64), 0.35);
    vec3 albedo = mix(sand, mossT, mossAmt) * mix(vec3(1.0), vColor, 0.55) * 1.04;
    // pits and cracks darken (the painting has them; this adds fine grain from the noise)
    albedo *= 0.9 + 0.2 * nC;
    // dark water streaks running down the faces
    float streak = texture2D(uNoise, vec2((P.x + P.z) * 0.8, P.y * 0.03)).g;
    albedo *= 1.0 - 0.38 * smoothstep(0.55, 0.88, streak) * (1.0 - w.y) * (1.0 - mossAmt * 0.6);
    float bumpL = mix(sandL, lum(mossT), mossAmt);
    if (abs(vSeed - 2.0) < 0.01) {                       // old rough masonry (the footbridge): irregular courses of dark wet stone, moss and ivy
      float across = abs(N.z) > 0.5 ? vMP.x : vMP.z;
      float row = floor(vMP.y / 0.32 + 0.35 * sin(across * 0.9));
      float col = across / 0.7 + fract(sin(row * 7.1) * 43758.5) * 3.0;
      vec2 f = vec2(fract(col), fract(vMP.y / 0.32 + 0.35 * sin(across * 0.9)));
      float joint = 1.0 - smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.1);
      float h = fract(sin((floor(col) + row * 17.0) * 12.9898) * 43758.5453);
      vec3 stone = tri(uRockWet, P, w, 0.5) * mix(vec3(0.9, 1.0, 1.0), vec3(1.5, 1.35, 1.1), h) + vec3(0.03, 0.03, 0.02);
      float ivy = smoothstep(0.35, 0.65, texture2D(uNoise, vMP.xy * 0.35 + 0.2).b + 0.25 * (1.0 - smoothstep(0.0, 2.2, vMP.y + 2.2)));
      albedo = mix(stone, mossT * vec3(0.8, 1.0, 0.7), clamp(0.28 + ivy * 0.5 + mossAmt * 0.4, 0.0, 0.85));
      albedo *= 1.0 - 0.55 * joint;
      bumpL = lum(albedo) + (1.0 - joint) * 0.2;
    }
    if (vSeed > 2.5) {                                    // stones in and by the water: dark, wet, mossy, with a lit rim
      vec3 wet = tri(uRockWet, P, w, 0.45);
      albedo = mix(wet, mossT * vec3(0.62, 0.8, 0.5), 0.35 + 0.3 * nB) * 1.25;
      bumpL = lum(wet);
    }
    if (uDetail > 0.5) N = bumpNormal(N, P, bumpL, 0.035 * (1.0 - smoothstep(20.0, 70.0, vDist)));
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo, N, sunMul, 1.35, P);
    col *= 1.0 - 0.25 * uWet;
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, P.y), 1.0);
  }
`;

export function createRockView({ scene, rocks, env, quality, textures }) {
  const group = new THREE.Group();
  group.name = 'mtb-rocks';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uRock: { value: textures.sandstone }, uRockMoss: { value: textures.rockMoss }, uRockWet: { value: textures.rockWet }, uMoss: { value: textures.moss }, uDetail: { value: quality.id === 'low' ? 0 : 1 } },
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

  /** One extra static instance of a model with the rock material (the footbridge): geometry needs the aSkirt attribute. */
  function addLandmark(geometry, x, y, z, yaw, sink, seed) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = geometry.index; g.attributes = geometry.attributes;
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array([x, y, z]), 3));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array([yaw, 0, sink, seed]), 4));
    g.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
    g.instanceCount = 1;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false; mesh.name = 'landmark stone';
    group.add(mesh);
    return mesh;
  }
  return {
    addLandmark, material,
    group, stats, sets, stones,
    update(cx, cz, force = false) { if (force || Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) { refill(cx, cz); last = { x: cx, z: cz }; } },
    dispose() { for (const s of Object.values(sets)) s.g.dispose(); material.dispose(); },
  };
}
