/* Draws the water: ribbon chunks (water.js) with an animated flowing shader (two scrolling noise normal layers, sky reflection by Fresnel, sun glint, foam on the
 * steep stretches, at the banks and around the stones), plus foam rings around the stones in the stream (instanced). Transparent, drawn after the ground. */
import { buildWaterChunks, findFalls } from './water.js';
import { buildCascadeWater, cascadeFalls } from './cascade.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const FOAM_CAPACITY = 700;
const WATER_REACH = Object.freeze({ low: 130, medium: 190, high: 260 });      // m

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
    float foam = clamp(slope * 1.5 * (0.4 + 0.9 * thread) + smoothstep(0.78, 1.0, abs(lat)) * thread * 0.55 + flowMask * 0.7 + churn * smoothstep(0.42, 0.85, boil + churn * 0.22), 0.0, 1.0);
    col = mix(col, vec3(0.88, 0.94, 0.94) * (0.6 + 0.4 * uSunColor.g + 0.2 * uAmbSky.g), foam);
    col = paintLightW(col, vec3(0.0, 1.0, 0.0), 1.0, 1.0, vWorld) * 0.35 + col * 0.65;
    // around the falls and on steep stretches the sheet shrinks to the white core: its flat edges never cut across the boulders and the banks
    float core = 1.0 - smoothstep(0.25, 0.7, abs(lat)) * clamp(churn * 2.5 + slope * 2.0, 0.0, 1.0);
    float alpha = clamp((0.62 + 0.3 * centre + foam * 0.35 + churn * 0.3) * fade * (1.0 - smoothstep(0.55, 1.0, abs(lat)) * 0.92) * core, 0.0, 0.97);
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
    float a = ring * smoothstep(0.4, 0.8, n) * 0.5 * (1.0 - smoothstep(40.0, 80.0, vDist));
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
    float spread = 1.0 + 0.22 * (1.0 - v) * (1.0 - v);                 // the curtain fans out as it falls
    vec3 world = vec3(iPos.x, iPos.y + v * iDir.z, iPos.z) + across * position.x * iPos.w * spread;
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
    // ragged sides: the curtain is thick in the middle, torn and threadlike at the edges (thinner towards the foot where it spreads)
    float w = 0.5 - abs(vUv.x - 0.5);
    float rag = (f3 - 0.5) * 0.28 + (f2 - 0.5) * 0.16;
    float edge = smoothstep(0.01, 0.17, w + rag * (0.5 + 0.7 * (1.0 - vUv.y)));
    float veil = 0.55 + 0.45 * smoothstep(0.0, 0.3, w + rag * 0.3);
    float a = clamp((0.62 + body * 0.4 + foot * 0.4 + lip * 0.2) * veil, 0.0, 0.97) * edge;
    vec3 white = vec3(0.96, 0.99, 1.0) * (0.66 + 0.3 * uSunColor.g + 0.4 * uAmbSky.g);
    vec3 shade = vec3(0.58, 0.72, 0.72) * (0.5 + 0.5 * uAmbSky.g);
    vec3 col = mix(shade, white, smoothstep(0.05, 0.5, body * 0.8 + foot * 0.5 + lip * 0.3 + 0.25));
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

const CASCADE_OWN_RADIUS = 14;       // m: a fall this close to the Schiessentümpel ledge is replaced by the ledge's own parallel falls (cascade.js)
const CHURN_MIN_RADIUS = 1.7;        // m: the white pool around the foot of a fall is never smaller than this

const PUFF_VERTEX = `
  attribute vec4 iBase;                    // x, y, z, seed
  attribute vec2 iFlow;
  uniform float uTime, uStrength;
  varying float vAlpha; varying float vDist; varying float vSeed;
  void main(){
    float age = fract(uTime * 0.23 + iBase.w * 5.7);
    float k = fract(iBase.w * 17.3);
    vec3 world = iBase.xyz + vec3(iFlow.x, 0.0, iFlow.y) * age * (0.8 + 2.4 * k) + vec3(sin(iBase.w * 55.0), 0.0, cos(iBase.w * 43.0)) * age * 0.9;
    world.y += 0.1 + 0.25 * sin(age * 3.14159);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz); vSeed = iBase.w;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(150.0, (0.5 + 0.9 * age) * (0.7 + 0.8 * k) * 600.0 / max(vDist, 1.0)) * uStrength;
    vAlpha = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.4, 1.0, age)) * (1.0 - smoothstep(30.0, 80.0, vDist)) * 0.2;
  }
`;
const PUFF_FRAGMENT = `
  precision highp float;
  uniform vec3 uAmbSky, uSunColor; uniform vec3 uFogColor; uniform sampler2D uNoise;
  varying float vAlpha; varying float vDist; varying float vSeed;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float n = texture2D(uNoise, c * 1.6 + vSeed * 9.0).g;
    float a = (1.0 - smoothstep(0.35 + 0.25 * n, 1.0, r)) * vAlpha * (0.55 + 0.7 * n);
    if (a < 0.01) discard;
    vec3 col = vec3(0.95, 0.98, 0.99) * (0.62 + 0.3 * uSunColor.g + 0.4 * uAmbSky.g);
    gl_FragColor = vec4(mix(col, uFogColor, 0.15), a);
  }
`;

export function createWaterView({ scene, network, env, quality, stones = [], foamTexture, cascade = null }) {
  const group = new THREE.Group();
  group.name = 'mtb-water';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uLift: { value: 0 }, uFoam: { value: foamTexture }, uFalls: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 1, 0)) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const chunks = new Map();
  for (const c of buildWaterChunks(network, cascade ? { lo: cascade.sampleLo, hi: cascade.sampleHi } : null)) {
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
  if (cascade) {                                                       // the sheet over the ledge and the plunge pool: the same water shader as the ribbons
    for (const [k, c] of buildCascadeWater(cascade).entries()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
      g.setAttribute('aux', new THREE.BufferAttribute(c.aux, 4));
      g.setIndex(new THREE.BufferAttribute(c.indices, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.name = k === 0 ? 'water ledge sheet' : 'water plunge pool';
      mesh.renderOrder = 5;
      group.add(mesh);
    }
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
  const mapped = findFalls(network);
  const falls = cascade ? mapped.filter((f) => Math.hypot(f.x - cascade.x, f.z - cascade.z) >= CASCADE_OWN_RADIUS).concat(cascadeFalls(cascade)) : mapped;      // what is drawn: the ledge's falls stand side by side
  const heard = cascade ? mapped.filter((f) => Math.hypot(f.x - cascade.x, f.z - cascade.z) < CASCADE_OWN_RADIUS ? false : true).concat(mapped.filter((f) => Math.hypot(f.x - cascade.x, f.z - cascade.z) < CASCADE_OWN_RADIUS).slice(0, 1)) : mapped;      // what is heard: one roar per cascade
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
  // foam puffs: white churned foam on the water around the foot of every fall (soft sprites that swell and drift outwards)
  const PUFFS_PER_FALL = Math.round(6 + 8 * quality.lifeDetail);
  const puffCount = falls.length * PUFFS_PER_FALL;
  const pBase = new Float32Array(Math.max(1, puffCount) * 4), pFlow = new Float32Array(Math.max(1, puffCount) * 2);
  falls.forEach((f, k) => { for (let j = 0; j < PUFFS_PER_FALL; j++) { const o = k * PUFFS_PER_FALL + j, u = Math.abs((Math.sin((k * 71 + j) * 12.9898) * 43758.5453) % 1), lat = ((j * 0.6180339) % 1 - 0.5) * (f.width * 1.1 + 0.6); pBase.set([f.x + f.nx * lat + f.fx * (0.4 + 0.8 * ((j * 0.37) % 1)), f.bottom + 0.05, f.z + f.nz * lat + f.fz * (0.4 + 0.8 * ((j * 0.37) % 1)), u], o * 4); pFlow.set([f.fx, f.fz], o * 2); } });
  const puffMat = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms, uStrength: { value: 1 } }, vertexShader: PUFF_VERTEX, fragmentShader: PUFF_FRAGMENT, transparent: true, depthWrite: false });
  const puffs = new THREE.Points(new THREE.BufferGeometry(), puffMat);
  puffs.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, puffCount) * 3), 3));
  puffs.geometry.setAttribute('iBase', new THREE.BufferAttribute(pBase, 4)); puffs.geometry.setAttribute('iFlow', new THREE.BufferAttribute(pFlow, 2));
  puffs.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  puffs.frustumCulled = false; puffs.renderOrder = 8; puffs.name = 'waterfall foam puffs';
  puffs.geometry.setDrawRange(0, puffCount);
  group.add(puffs);
  const landings = falls.map((f) => ({ x: f.x - f.nz * 0.0, z: f.z, y: f.bottom, size: f.width * 0.62, seed: (f.x * 0.01) % 1 }));

  /** Foam rings for the stones near the camera: stones = list of { x, z, y (water level), size }. */
  function updateFoam(cx, cz, list) {
    for (const m of chunks.values()) {                                // water far away is hidden by the fog anyway: chunks beyond the reach are not drawn at all
      const sp = m.geometry.boundingSphere;
      m.visible = Math.hypot(sp.center.x - cx, sp.center.z - cz) - sp.radius < WATER_REACH[quality.id || 'high'];
    }
    let n = 0;
    const R = quality.rockNear * 1.2;
    for (const s of list.concat(landings)) {
      if (n >= FOAM_CAPACITY) break;
      if (Math.abs(s.x - cx) > R || Math.abs(s.z - cz) > R) continue;
      pos.array[n * 3] = s.x; pos.array[n * 3 + 1] = s.y + 0.02; pos.array[n * 3 + 2] = s.z;
      siz.array[n * 2] = Math.min(s.size, 0.7); siz.array[n * 2 + 1] = s.seed;          // (a ring never grows into a wide flat sheet that cuts across the neighbouring boulders)
      n++;
    }
    fg.instanceCount = n; pos.needsUpdate = true; siz.needsUpdate = true;
    // the plunge pools nearest to the camera churn white
    const near = falls.map((f) => ({ f, d: Math.hypot(f.x - cx, f.z - cz) })).filter((e) => e.d < 90).sort((a, b) => a.d - b.d).slice(0, 6);
    for (let k = 0; k < 6; k++) {
      const e = near[k];
      if (e) material.uniforms.uFalls.value[k].set(e.f.x + e.f.fx * 1.4, e.f.z + e.f.fz * 1.4, Math.max(CHURN_MIN_RADIUS, e.f.width * 1.1), Math.min(0.85, 0.35 + (e.f.top - e.f.bottom) * 0.3));
      else material.uniforms.uFalls.value[k].set(0, 0, 1, 0);
    }
  }
  /** Water sound sources near (cx, cz) for the audio of the gameplay wave: [{ kind: 'fall' | 'stream', x, y, z, gain 0..1 (by distance), size }] sorted by distance. A fall roars, a stream murmurs. */
  function soundSources(cx, cz, reach = 60) {
    const out = [];
    for (const f of heard) {
      const d = Math.hypot(f.x - cx, f.z - cz);
      if (d < reach) out.push({ kind: 'fall', x: f.x, y: f.bottom, z: f.z, gain: Math.pow(1 - d / reach, 1.6) * Math.min(1, 0.4 + (f.top - f.bottom) * 0.6), size: f.top - f.bottom });
    }
    return out.sort((a, b) => b.gain - a.gain);
  }
  return { group, chunks, falls, updateFoam, soundSources, mist, dispose() { for (const m of chunks.values()) m.geometry.dispose(); material.dispose(); fg.dispose(); foamMat.dispose(); } };
}
