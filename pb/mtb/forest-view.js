/* Draws the forest: four instanced meshes (beech / spruce x near / far detail), wind sway in the vertex shader, painted lighting shared with the ground.
 * Trees come from forest.js per 32 m block; the instance buffers are refilled when the camera has moved a few metres. */
import { treesOfBlock, BLOCK, SPECIES } from './forest.js';
import { buildBeech, buildSpruce } from './tree-models.js';
import { PAINT_LIGHT_GLSL } from './ground-shader.js';

const THREE = window.THREE;
const REFILL_DISTANCE = 6;
const NEAR_RADIUS = 62;                 // trees closer than this use the detailed model
const CAPACITY = { nearBeech: 900, nearSpruce: 500, farBeech: 7000, farSpruce: 4000 };
const BLOCK_CACHE_LIMIT = 900;

const VERTEX = `
  attribute vec3 iPos; attribute vec4 iParams; attribute vec3 color;
  uniform float uTime; uniform vec2 uWind;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight;
  void main(){
    float s = iParams.x, ang = iParams.y;
    float c = cos(ang), sn = sin(ang);
    vec3 p = position * s;
    vec3 r = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
    float bend = pow(max(position.y, 0.0), 1.7) * s * 0.035;
    float gust = sin(uTime * 1.25 + iParams.w * 6.283 + iPos.x * 0.05) * 0.6 + sin(uTime * 2.7 + iParams.w * 11.0 + iPos.z * 0.07) * 0.25;
    r.x += gust * bend * (0.5 + uWind.x) ; r.z += gust * bend * 0.6 * (0.5 + uWind.y);
    vec3 world = r + iPos;
    vec3 nrm = vec3(c * normal.x + sn * normal.z, normal.y, -sn * normal.x + c * normal.z);
    vNormal = nrm;
    float t = fract(iParams.z * 13.7);
    vColor = color * (0.86 + 0.3 * t) * mix(vec3(1.0), vec3(1.0, 0.94, 0.78), step(0.82, t));
    vWorld = world; vHeight = position.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uWet, uCloud;
  varying vec3 vColor; varying vec3 vNormal; varying float vDist; varying vec3 vWorld; varying float vHeight;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vNormal);
    float sunMul = mix(1.0, 0.75, uCloud * 0.6);
    float shade = 0.78 + 0.3 * vHeight;
    vec3 col = paintLight(vColor * (1.0 - 0.22 * uWet), N, sunMul, shade);
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFog(col, vDist), 1.0);
  }
`;

export function createForestView({ scene, surface, map, clearance, env, quality }) {
  const group = new THREE.Group();
  group.name = 'mtb-forest';
  scene.add(group);
  const material = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide });
  const defs = [
    ['nearBeech', buildBeech(1)], ['nearSpruce', buildSpruce(1)], ['farBeech', buildBeech(0)], ['farSpruce', buildSpruce(0)],
  ];
  const sets = {};
  for (const [name, geo] of defs) {
    const cap = CAPACITY[name];
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index; g.attributes = geo.attributes;
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    const par = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); par.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', pos); g.setAttribute('iParams', par);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false; mesh.name = `trees ${name}`;
    group.add(mesh);
    sets[name] = { g, pos, par, cap, n: 0 };
  }
  const blocks = new Map();
  let last = { x: 1e9, z: 1e9 };
  const stats = { near: 0, far: 0, blocks: 0 };

  function block(bx, bz) {
    const key = bx * 100003 + bz;
    let b = blocks.get(key);
    if (!b) {
      b = treesOfBlock(bx, bz, { map, surface, clearance, density: quality.treeDensity });
      blocks.set(key, b);
      if (blocks.size > BLOCK_CACHE_LIMIT) blocks.delete(blocks.keys().next().value);
    }
    return b;
  }

  function refill(cx, cz) {
    for (const s of Object.values(sets)) s.n = 0;
    const r = quality.treeRadius, b0x = Math.floor((cx - r) / BLOCK), b1x = Math.floor((cx + r) / BLOCK), b0z = Math.floor((cz - r) / BLOCK), b1z = Math.floor((cz + r) / BLOCK);
    let near = 0, far = 0;
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const t = block(bx, bz);
        for (let i = 0; i < t.length; i += 6) {
          const x = t[i], z = t[i + 2];
          const d = Math.hypot(x - cx, z - cz);
          if (d > r) continue;
          const isNear = d < NEAR_RADIUS;
          const name = (isNear ? 'near' : 'far') + (t[i + 4] === SPECIES.spruce ? 'Spruce' : 'Beech');
          const s = sets[name];
          if (s.n >= s.cap) continue;
          const o = s.n++;
          s.pos.array[o * 3] = x; s.pos.array[o * 3 + 1] = t[i + 1] - 0.15; s.pos.array[o * 3 + 2] = z;
          const seed = t[i + 5];
          s.par.array[o * 4] = t[i + 3]; s.par.array[o * 4 + 1] = seed * 6.2831; s.par.array[o * 4 + 2] = seed; s.par.array[o * 4 + 3] = (seed * 7.31) % 1;
          if (isNear) near++; else far++;
        }
      }
    }
    for (const s of Object.values(sets)) { s.g.instanceCount = s.n; s.pos.needsUpdate = true; s.par.needsUpdate = true; }
    stats.near = near; stats.far = far; stats.blocks = blocks.size;
  }

  return {
    group, stats,
    update(cx, cz, force = false) {
      if (force || Math.hypot(cx - last.x, cz - last.z) > REFILL_DISTANCE) { refill(cx, cz); last = { x: cx, z: cz }; }
    },
    dispose() { for (const s of Object.values(sets)) s.g.dispose(); material.dispose(); },
  };
}
