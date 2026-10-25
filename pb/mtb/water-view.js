/* Draws the water: ribbon chunks (water.js) with an animated flowing shader (two scrolling noise normal layers, sky reflection by Fresnel, sun glint, foam on the
 * steep stretches, at the banks and around the stones), plus foam rings around the stones in the stream (instanced). Transparent, drawn after the ground. */
import { buildWaterChunks, findFalls } from './water.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const FOAM_CAPACITY = 700;

const VERTEX = `
  attribute vec4 aux;
  uniform float uLift;
  varying vec4 vAux; varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mvp = viewMatrix * wp;
    vDist = length(mvp.xyz);
    wp.y += smoothstep(70.0, 220.0, vDist) * 0.5;               // far away the carved channel is not drawn by the coarse tiles: the water floats up to the ground
    vAux = aux; vWorld = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform sampler2D uNoise, uFoam;
  uniform vec3 uSkyTop, uSkyHorizon; uniform float uOvercast;
  uniform vec4 uFalls[6];                                         // x, z, radius, strength of the plunge pools near the camera
  varying vec4 vAux; varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  void main(){
    float lat = vAux.x, along = vAux.y, slope = vAux.z, fade = vAux.w;
    float t = uTime;
    float speed = 0.55 + slope * 2.2;
    vec2 f1 = vec2(lat * 0.55, along * 0.32 - t * speed * 0.55);
    vec2 f2 = vec2(lat * 1.3 + 0.37, along * 0.8 - t * speed * 1.1);
    vec2 f3 = vec2(lat * 3.1, along * 2.2 - t * speed * 2.4);
    vec3 n1 = texture2D(uNoise, f1).rgb, n2 = texture2D(uNoise, f2 + 0.31).rgb, n3 = texture2D(uNoise, f3 + 0.7).rgb;
    vec2 d = (n1.gb - 0.5) * 0.5 + (n2.gb - 0.5) * 0.4 + (n3.gb - 0.5) * 0.3 * (1.0 - smoothstep(18.0, 60.0, vDist));
    vec3 N = normalize(vNormal + vec3(d.x, 0.0, d.y) * (0.5 + slope * 1.2));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    // colour: deep peaty brown-green water over a pale sandy bed at the edges; it mirrors the dark canopy at grazing angles and the sky only where it looks up
    float centre = 1.0 - abs(lat);
    float day = clamp(dot(uAmbSky, vec3(0.34)) * 1.2 + uSunColor.g * 0.35, 0.12, 1.2);
    vec3 deep = vec3(0.045, 0.1, 0.075) * (0.55 + 0.6 * day), shallow = vec3(0.2, 0.22, 0.12) * (0.5 + 0.6 * day);
    vec3 body = mix(shallow, deep, smoothstep(0.0, 0.75, centre) * (1.0 - slope * 0.8));
    vec3 R = reflect(-V, N);
    float dapple = texture2D(uNoise, vWorld.xz * 0.33 + vec2(t * 0.012, 0.0)).g;
    vec3 canopy = mix(vec3(0.07, 0.14, 0.06), vec3(0.3, 0.42, 0.15), smoothstep(0.5, 0.85, dapple)) * (0.45 + 0.7 * day);
    vec3 skyC = mix(uSkyHorizon, uSkyTop, 0.5) * (0.75 + 0.45 * uSunColor.g);
    vec3 refl = mix(canopy, skyC, smoothstep(0.35, 0.95, R.y) * (1.0 - uOvercast * 0.3));
    vec3 col = mix(body, refl, clamp(0.06 + fres * 0.85, 0.0, 0.9));
    // sun glint on the ripples
    float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 90.0) * (1.0 - uCloud * 0.7);
    col += uSunColor * glint * 1.4;
    // the current: painted foam streaks sliding along the flow, brighter where it is fast; foam on the steep stretches, broken threads at the banks
    float streaks = texture2D(uFoam, vec2(lat * 0.55 + n1.r * 0.2, along * 0.28 - t * speed * 0.35)).r;
    float flowMask = smoothstep(0.62, 0.9, streaks) * (0.2 + 0.8 * smoothstep(0.0, 0.5, centre)) * (0.25 + slope * 0.9);
    // plunge pools: white churned water around the foot of every fall
    float churn = 0.0;
    for (int k = 0; k < 6; k++) { vec4 fp = uFalls[k]; float dd = length(vWorld.xz - fp.xy) / max(fp.z, 0.01); churn = max(churn, (1.0 - smoothstep(0.35, 1.0, dd)) * fp.w); }
    float boil = texture2D(uFoam, vWorld.xz * 0.5 + vec2(t * 0.09, -t * 0.13)).r * 0.6 + texture2D(uFoam, vWorld.xz * 1.1 + vec2(-t * 0.17, t * 0.07)).r * 0.5;
    float thread = smoothstep(0.62, 0.9, n2.b * 0.55 + n3.g * 0.55);
    float foam = clamp(slope * 1.5 * (0.4 + 0.9 * thread) + smoothstep(0.78, 1.0, abs(lat)) * thread * 0.55 + flowMask * 0.7 + churn * smoothstep(0.25, 0.7, boil + churn * 0.35), 0.0, 1.0);
    col = mix(col, vec3(0.88, 0.94, 0.94) * (0.6 + 0.4 * uSunColor.g + 0.2 * uAmbSky.g), foam);
    col = paintLightW(col, vec3(0.0, 1.0, 0.0), 1.0, 1.0, vWorld) * 0.35 + col * 0.65;
    float alpha = clamp((0.62 + 0.3 * centre + foam * 0.35 + churn * 0.3) * fade * (1.0 - smoothstep(0.55, 1.0, abs(lat)) * 0.92), 0.0, 0.97);
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), alpha);
  }
`;

const FOAM_VERTEX = `
  attribute vec3 iPos; attribute vec2 iSize;
  varying vec2 vUv; varying vec3 vWorld; varying float vDist; varying float vSeed;
  void main(){
    vUv = position.xz * 2.0; vSeed = iSize.y;
    vec3 world = vec3(position.x * iSize.x * 2.4, 0.0, position.z * iSize.x * 2.4) + iPos;
    vWorld = world;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FOAM_FRAGMENT = `
  precision highp float;
  uniform sampler2D uNoise;
  varying vec2 vUv; varying vec3 vWorld; varying float vDist; varying float vSeed;
  ${PAINT_LIGHT_GLSL}
  void main(){
    float r = length(vUv);
    vec2 uv = vUv * 0.5 + vSeed * 7.0;
    float n = texture2D(uNoise, uv * 1.7 + vec2(0.0, uTime * 0.25)).g * 0.6 + texture2D(uNoise, uv * 3.9 - vec2(0.0, uTime * 0.4)).b * 0.5;
    float ring = smoothstep(0.38, 0.55, r) * (1.0 - smoothstep(0.7, 1.0, r));
    float a = ring * smoothstep(0.35, 0.75, n) * 0.85 * (1.0 - smoothstep(60.0, 110.0, vDist));
    if (a < 0.02) discard;
    vec3 col = vec3(0.9, 0.94, 0.95) * (0.7 + 0.3 * uSunColor.g + 0.2 * uAmbSky.g);
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), a);
  }
`;

const FALL_VERTEX = `
  attribute vec4 iPos; attribute vec4 iDir; attribute vec2 iFlow;     // x, bottom y, z, width ;  across.x, across.z, height, seed ; flow.x, flow.z
  varying vec2 vUv; varying vec3 vWorld; varying float vDist; varying float vSeed; varying float vH;
  void main(){
    vec3 across = vec3(iDir.x, 0.0, iDir.y);
    float v = position.y + 0.5;
    vec3 world = vec3(iPos.x, iPos.y + v * iDir.z, iPos.z) + across * position.x * iPos.w;
    // the water leaves the lip with some speed and arcs out over the pool: the sheet leans out as it falls
    world += vec3(iFlow.x, 0.0, iFlow.y) * (0.15 + 0.35 * sqrt(max(0.0, 1.0 - v))) * min(iDir.z, 2.0) * 0.8;
    vUv = vec2(position.x + 0.5, v); vWorld = world; vSeed = iDir.w; vH = iDir.z;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FALL_FRAGMENT = `
  precision highp float;
  uniform sampler2D uNoise, uFoam;
  varying vec2 vUv; varying vec3 vWorld; varying float vDist; varying float vSeed; varying float vH;
  ${PAINT_LIGHT_GLSL}
  void main(){
    float t = uTime;
    float h = max(vH, 0.5);
    // thick white water: painted foam streaks sliding down, three layers of different speed, bright at the lip and the foot, ragged at the sides
    float f1 = texture2D(uFoam, vec2(vUv.x * 2.2 + vSeed * 9.0, vUv.y * 0.9 / h * 1.6 - t * 1.1)).r;
    float f2 = texture2D(uFoam, vec2(vUv.x * 4.9 + 0.3, vUv.y * 1.5 / h * 1.6 - t * 1.9)).r;
    float f3 = texture2D(uNoise, vec2(vUv.x * 13.0 + vSeed * 3.0, vUv.y * 2.4 / h * 1.6 - t * 3.2)).g;
    float body = clamp(f1 * 0.55 + f2 * 0.45 + (f3 - 0.5) * 0.4, 0.0, 1.0);
    float foot = 1.0 - smoothstep(0.0, 0.3, vUv.y);
    float lip = smoothstep(0.7, 1.0, vUv.y);
    float edge = smoothstep(0.0, 0.1 + 0.08 * f3, vUv.x) * smoothstep(0.0, 0.1 + 0.08 * f3, 1.0 - vUv.x);
    float a = clamp(0.5 + body * 0.55 + foot * 0.4 + lip * 0.15, 0.0, 0.97) * edge;
    vec3 white = vec3(0.93, 0.97, 0.98) * (0.62 + 0.3 * uSunColor.g + 0.4 * uAmbSky.g);
    vec3 col = mix(vec3(0.5, 0.64, 0.64) * (0.5 + 0.5 * uAmbSky.g), white, smoothstep(0.25, 0.75, body + foot * 0.5 + lip * 0.3));
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), a);
  }
`;

const MIST_VERTEX = `
  attribute vec4 iBase;                    // x, y, z, seed
  attribute vec2 iFlow;
  uniform float uTime, uStrength;
  varying float vAlpha; varying float vDist;
  void main(){
    float age = fract(uTime * 0.17 + iBase.w * 7.3);
    float k = fract(iBase.w * 13.7);
    vec3 world = iBase.xyz + vec3(iFlow.x, 0.0, iFlow.y) * age * (1.2 + 1.5 * k) + vec3(sin(iBase.w * 40.0) * 0.8, age * (1.4 + 1.6 * k), cos(iBase.w * 31.0) * 0.8) * (0.4 + age);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(150.0, (0.7 + 1.5 * age) * 640.0 / max(vDist, 1.0)) * uStrength;
    vAlpha = sin(age * 3.14159) * (1.0 - smoothstep(25.0, 70.0, vDist)) * 0.2;
  }
`;
const MIST_FRAGMENT = `
  precision highp float;
  uniform vec3 uAmbSky, uSunColor; uniform vec3 uFogColor;
  varying float vAlpha; varying float vDist;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, r)) * vAlpha;
    if (a < 0.01) discard;
    vec3 col = vec3(0.9, 0.95, 0.97) * (0.55 + 0.3 * uSunColor.g + 0.4 * uAmbSky.g);
    gl_FragColor = vec4(mix(col, uFogColor, 0.2), a);
  }
`;

export function createWaterView({ scene, network, env, quality, stones = [], foamTexture }) {
  const group = new THREE.Group();
  group.name = 'mtb-water';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uLift: { value: 0 }, uFoam: { value: foamTexture }, uFalls: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 1, 0)) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const chunks = new Map();
  for (const c of buildWaterChunks(network)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
    g.setAttribute('aux', new THREE.BufferAttribute(c.aux, 4));
    g.setIndex(new THREE.BufferAttribute(c.indices, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `water ${c.bx},${c.bz}`;
    mesh.renderOrder = 5;
    group.add(mesh);
    chunks.set(`${c.bx},${c.bz}`, mesh);
  }
  // foam rings around the stones in the water
  const ring = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
  const fg = new THREE.InstancedBufferGeometry();
  fg.index = ring.index; fg.attributes = ring.attributes;
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(FOAM_CAPACITY * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
  const siz = new THREE.InstancedBufferAttribute(new Float32Array(FOAM_CAPACITY * 2), 2); siz.setUsage(THREE.DynamicDrawUsage);
  fg.setAttribute('iPos', pos); fg.setAttribute('iSize', siz); fg.instanceCount = 0;
  fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const foamMat = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: FOAM_VERTEX, fragmentShader: FOAM_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const foam = new THREE.Mesh(fg, foamMat);
  foam.frustumCulled = false; foam.renderOrder = 6; foam.name = 'water foam rings';
  group.add(foam);

  // waterfalls: vertical white curtains where the stream drops (and a big foam ring where it lands)
  const falls = findFalls(network);
  const fq = new THREE.PlaneGeometry(1, 1, 1, 8);
  const fgeo = new THREE.InstancedBufferGeometry();
  fgeo.index = fq.index; fgeo.attributes = { ...fq.attributes };
  const fPos = new Float32Array(Math.max(1, falls.length) * 4), fDir = new Float32Array(Math.max(1, falls.length) * 4), fFlow = new Float32Array(Math.max(1, falls.length) * 2);
  falls.forEach((f, k) => { fPos.set([f.x, f.bottom, f.z, f.width * 1.15], k * 4); fDir.set([f.nx, f.nz, f.top - f.bottom, (k * 0.137) % 1], k * 4); fFlow.set([f.fx, f.fz], k * 2); });
  fgeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(fPos, 4)); fgeo.setAttribute('iDir', new THREE.InstancedBufferAttribute(fDir, 4)); fgeo.setAttribute('iFlow', new THREE.InstancedBufferAttribute(fFlow, 2));
  fgeo.instanceCount = falls.length;
  fgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const fallMat = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms, uFoam: { value: foamTexture } }, vertexShader: FALL_VERTEX, fragmentShader: FALL_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const fallMesh = new THREE.Mesh(fgeo, fallMat);
  fallMesh.frustumCulled = false; fallMesh.renderOrder = 7; fallMesh.name = 'waterfalls';
  group.add(fallMesh);
  // spray: soft white puffs rising from the foot of every fall (animated entirely in the vertex shader), their count scaled by the quality level
  const MIST_PER_FALL = Math.round(10 + 34 * quality.lifeDetail);
  const mistCount = falls.length * MIST_PER_FALL;
  const base = new Float32Array(Math.max(1, mistCount) * 4), mflow = new Float32Array(Math.max(1, mistCount) * 2);
  falls.forEach((f, k) => { for (let j = 0; j < MIST_PER_FALL; j++) { const o = k * MIST_PER_FALL + j, u = (Math.sin((k * 131 + j) * 12.9898) * 43758.5453) % 1, lat = ((j * 0.6180339) % 1 - 0.5) * f.width * 0.9; base.set([f.x + f.nx * lat + f.fx * 0.7, f.bottom + 0.15, f.z + f.nz * lat + f.fz * 0.7, Math.abs(u)], o * 4); mflow.set([f.fx, f.fz], o * 2); } });
  const mistMat = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms, uStrength: { value: 1 } }, vertexShader: MIST_VERTEX, fragmentShader: MIST_FRAGMENT, transparent: true, depthWrite: false });
  const mist = new THREE.Points(new THREE.BufferGeometry(), mistMat);
  mist.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, mistCount) * 3), 3));
  mist.geometry.setAttribute('iBase', new THREE.BufferAttribute(base, 4)); mist.geometry.setAttribute('iFlow', new THREE.BufferAttribute(mflow, 2));
  mist.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  mist.frustumCulled = false; mist.renderOrder = 8; mist.name = 'waterfall spray';
  mist.geometry.setDrawRange(0, mistCount);
  group.add(mist);
  const landings = falls.map((f) => ({ x: f.x - f.nz * 0.0, z: f.z, y: f.bottom, size: f.width * 0.62, seed: (f.x * 0.01) % 1 }));

  /** Foam rings for the stones near the camera: stones = list of { x, z, y (water level), size }. */
  function updateFoam(cx, cz, list) {
    let n = 0;
    const R = quality.rockNear * 1.2;
    for (const s of list.concat(landings)) {
      if (n >= FOAM_CAPACITY) break;
      if (Math.abs(s.x - cx) > R || Math.abs(s.z - cz) > R) continue;
      pos.array[n * 3] = s.x; pos.array[n * 3 + 1] = s.y + 0.02; pos.array[n * 3 + 2] = s.z;
      siz.array[n * 2] = s.size; siz.array[n * 2 + 1] = s.seed;
      n++;
    }
    fg.instanceCount = n; pos.needsUpdate = true; siz.needsUpdate = true;
    // the plunge pools nearest to the camera churn white
    const near = falls.map((f) => ({ f, d: Math.hypot(f.x - cx, f.z - cz) })).filter((e) => e.d < 90).sort((a, b) => a.d - b.d).slice(0, 6);
    for (let k = 0; k < 6; k++) {
      const e = near[k];
      if (e) material.uniforms.uFalls.value[k].set(e.f.x + e.f.fx * 1.4, e.f.z + e.f.fz * 1.4, e.f.width * 1.1, Math.min(1, 0.45 + (e.f.top - e.f.bottom) * 0.5));
      else material.uniforms.uFalls.value[k].set(0, 0, 1, 0);
    }
  }
  /** Water sound sources near (cx, cz) for the audio of the gameplay wave: [{ kind: 'fall' | 'stream', x, y, z, gain 0..1 (by distance), size }] sorted by distance. A fall roars, a stream murmurs. */
  function soundSources(cx, cz, reach = 60) {
    const out = [];
    for (const f of falls) {
      const d = Math.hypot(f.x - cx, f.z - cz);
      if (d < reach) out.push({ kind: 'fall', x: f.x, y: f.bottom, z: f.z, gain: Math.pow(1 - d / reach, 1.6) * Math.min(1, 0.4 + (f.top - f.bottom) * 0.6), size: f.top - f.bottom });
    }
    return out.sort((a, b) => b.gain - a.gain);
  }
  return { group, chunks, falls, updateFoam, soundSources, mist, dispose() { for (const m of chunks.values()) m.geometry.dispose(); material.dispose(); fg.dispose(); foamMat.dispose(); } };
}
