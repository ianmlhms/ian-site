/* The street lights on screen: the lamps near the camera as ONE instanced mesh, and at dusk and at night a soft pool of warm
 * light on the ground under each (one more instanced draw call, additive, switched off in daylight).
 *
 * The positions come from street-lights.js (all the lamps of the city, a few thousand); only the ones within SHOW_RADIUS of
 * the camera are given a matrix, and the set is refreshed when the camera has moved.  The height of the foot of a lamp is
 * read from the ground once and remembered. */
import { PartBuilder } from './part-builder.js';
import { createPartMaterial } from './part-material.js';

const THREE = window.THREE;
const SHOW_RADIUS = 230;               // m
const CAPACITY = 520;                  // lamps drawn at most (the nearest ones)
const REFRESH = 25;                    // m the camera moves before the set is rebuilt
const CELL = 64;                       // m, the cell of the spatial hash
const POOL_RADIUS = 4.6;               // m, the pool of light on the ground
const SMALL_SCALE = 0.8;               // the lamps of the side streets are lower
const NIGHT_ON = 0.06;                 // the pools are drawn from this much night

const POLE = [0.24, 0.28, 0.27], HEAD = [0.95, 0.90, 0.68], HOUSING = [0.30, 0.31, 0.31];

function lampGeometry() {
  const b = new PartBuilder();
  b.box(-0.16, 0.16, -0.05, 0.25, -0.16, 0.16, [0.36, 0.38, 0.37]);          // the foot
  b.box(-0.055, 0.055, 0.2, 6.15, -0.055, 0.055, POLE);                          // the pole
  b.box(-0.04, 0.04, 6.05, 6.2, 0.0, 1.55, POLE);                                // the arm
  b.box(-0.16, 0.16, 5.9, 6.0, 1.05, 1.8, HEAD, 1);                              // the lit head (it keeps its colour at night)
  b.box(-0.18, 0.18, 6.0, 6.1, 1.0, 1.85, HOUSING);                              // its cap
  return b.build(THREE);
}

function poolGeometry() {
  const g = new THREE.CircleGeometry(1, 14);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function createStreetLightView({ scene, lights, ground, env }) {
  const material = createPartMaterial(env);
  const lamps = new THREE.InstancedMesh(lampGeometry(), material, CAPACITY);
  lamps.frustumCulled = false; lamps.count = 0;
  scene.add(lamps);
  const poolMaterial = new THREE.ShaderMaterial({
    uniforms: { uNight: env.uniforms.uNight },
    vertexShader: `varying float vR; void main(){ mat4 M = modelMatrix * instanceMatrix; vR = length(position.xz); gl_Position = projectionMatrix * viewMatrix * M * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform float uNight; varying float vR; void main(){ float a = pow(clamp(1.0 - vR, 0.0, 1.0), 2.0) * 0.42 * smoothstep(0.0, 0.5, uNight); gl_FragColor = vec4(vec3(1.0, 0.80, 0.46) * a, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const pools = new THREE.InstancedMesh(poolGeometry(), poolMaterial, CAPACITY);
  pools.frustumCulled = false; pools.count = 0; pools.visible = false;
  scene.add(pools);

  // the spatial hash of the lamps
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (let i = 0; i < lights.count; i++) {
    const k = key(Math.floor(lights.x[i] / CELL), Math.floor(lights.z[i] / CELL));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  const foot = new Float32Array(lights.count).fill(NaN);          // the height of the foot of every lamp (read on first use)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let lastX = 1e9, lastZ = 1e9;

  function refresh(cx, cz) {
    const picks = [];
    const r = Math.ceil(SHOW_RADIUS / CELL);
    const ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (const n of list) {
          const d = Math.hypot(lights.x[n] - cx, lights.z[n] - cz);
          if (d < SHOW_RADIUS) picks.push([d, n]);
        }
      }
    }
    picks.sort((a, b) => a[0] - b[0]);
    const n = Math.min(CAPACITY, picks.length);
    for (let k = 0; k < n; k++) {
      const i = picks[k][1];
      if (Number.isNaN(foot[i])) foot[i] = ground.height(lights.x[i], lights.z[i]);
      const s = lights.size[i] ? 1 : SMALL_SCALE;
      q.setFromAxisAngle(up, lights.yaw[i]);
      pos.set(lights.x[i], foot[i], lights.z[i]); sc.set(s, s, s);
      m4.compose(pos, q, sc);
      lamps.setMatrixAt(k, m4);
      sc.set(POOL_RADIUS * s, 1, POOL_RADIUS * s);
      // the pool lies under the lamp head, a little towards the street
      pos.set(lights.x[i] + Math.sin(lights.yaw[i]) * 1.4 * s, foot[i] + 0.12, lights.z[i] + Math.cos(lights.yaw[i]) * 1.4 * s);
      m4.compose(pos, new THREE.Quaternion(), sc);
      pools.setMatrixAt(k, m4);
    }
    lamps.count = n; pools.count = n;
    lamps.instanceMatrix.needsUpdate = true; pools.instanceMatrix.needsUpdate = true;
  }

  function update(camX, camZ) {
    if (Math.hypot(camX - lastX, camZ - lastZ) > REFRESH) { lastX = camX; lastZ = camZ; refresh(camX, camZ); }
    pools.visible = env.uniforms.uNight.value > NIGHT_ON;
  }
  return { update, lamps, pools, count: lights.count };
}
