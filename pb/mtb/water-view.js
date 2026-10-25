/* Draws the water: ribbon chunks (water.js) with an animated flowing shader (two scrolling noise normal layers, sky reflection by Fresnel, sun glint, foam on the
 * steep stretches, at the banks and around the stones), plus foam rings around the stones in the stream (instanced). Transparent, drawn after the ground. */
import { buildWaterChunks } from './water.js';
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
  uniform sampler2D uNoise;
  uniform vec3 uSkyTop, uSkyHorizon;
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
    // colour: dark peaty water over a brown bed, the sky in the grazing angles
    vec3 deep = vec3(0.08, 0.17, 0.17), shallow = vec3(0.22, 0.3, 0.22);
    float centre = 1.0 - abs(lat);
    vec3 body = mix(shallow, deep, smoothstep(0.0, 0.8, centre) * (1.0 - slope));
    vec3 sky = mix(uSkyHorizon, uSkyTop, 0.35) * (0.7 + 0.5 * uSunColor.g);
    vec3 col = mix(body, sky, clamp(0.12 + fres * 0.9, 0.0, 0.95));
    // sun glint
    vec3 R = reflect(-V, N);
    float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 90.0) * (1.0 - uCloud * 0.7);
    col += uSunColor * glint * 1.6;
    // foam: steep water, the banks, white threads in the current
    float thread = smoothstep(0.62, 0.9, n2.b * 0.55 + n3.g * 0.55);
    float foam = clamp(slope * 1.6 * (0.45 + 0.9 * thread) + smoothstep(0.62, 1.0, abs(lat)) * (0.35 + 0.65 * thread) * 0.8 + thread * 0.12, 0.0, 1.0);
    col = mix(col, vec3(0.9, 0.94, 0.95) * (0.65 + 0.35 * uSunColor.g + 0.2 * uAmbSky.g), foam);
    col = paintLightW(col, vec3(0.0, 1.0, 0.0), 1.0, 1.0, vWorld) * 0.5 + col * 0.5;
    float alpha = clamp((0.55 + 0.4 * (1.0 - centre) + foam * 0.45) * fade * (1.0 - smoothstep(0.9, 1.0, abs(lat)) * 0.85), 0.0, 0.96);
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

export function createWaterView({ scene, network, env, quality, stones = [] }) {
  const group = new THREE.Group();
  group.name = 'mtb-water';
  scene.add(group);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uLift: { value: 0 } }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
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

  /** Foam rings for the stones near the camera: stones = list of { x, z, y (water level), size }. */
  function updateFoam(cx, cz, list) {
    let n = 0;
    const R = quality.rockNear * 1.2;
    for (const s of list) {
      if (n >= FOAM_CAPACITY) break;
      if (Math.abs(s.x - cx) > R || Math.abs(s.z - cz) > R) continue;
      pos.array[n * 3] = s.x; pos.array[n * 3 + 1] = s.y + 0.02; pos.array[n * 3 + 2] = s.z;
      siz.array[n * 2] = s.size; siz.array[n * 2 + 1] = s.seed;
      n++;
    }
    fg.instanceCount = n; pos.needsUpdate = true; siz.needsUpdate = true;
  }
  return { group, chunks, updateFoam, dispose() { for (const m of chunks.values()) m.geometry.dispose(); material.dispose(); fg.dispose(); foamMat.dispose(); } };
}
