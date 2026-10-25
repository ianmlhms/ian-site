/* Animated life and weather effects, all cheap and instanced (one draw call each, positions computed in the vertex shader from the time):
 *   rain streaks around the camera, falling leaves (more in autumn), light shafts through the canopy (fake god rays), birds high above, butterflies in the sunny meadows
 *   (fireflies there at night). Hikers on the footpaths are in hikers.js. Every system reads the shared environment (sun, season, weather) and the quality level. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';
import { createRng, hash2 } from './noise.js';
import { sampleWorldMap } from './world-map.js';

const THREE = window.THREE;
const quad = () => new THREE.PlaneGeometry(1, 1);
const scratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };

function instanced(geo, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index; g.attributes = { ...geo.attributes };
  for (const [name, size] of attrs) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * size), size));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}
function randomFill(attr, rng, scale = 1) { for (let i = 0; i < attr.array.length; i++) attr.array[i] = rng() * scale; attr.needsUpdate = true; }

/* ------------------------------------------------------------------ rain */
export function createRain({ scene, env, quality }) {
  const count = quality.id === 'low' ? 380 : quality.id === 'medium' ? 800 : 1500;
  const g = instanced(quad(), [['iSeed', 4]], count);
  randomFill(g.attributes.iSeed, createRng(77));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uBox: { value: new THREE.Vector3(34, 22, 34) } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 iSeed; uniform vec3 uBox; uniform float uTime; varying float vA; varying vec2 vUv;
      void main(){
        vec3 base = iSeed.xyz * uBox;
        float speed = 9.0 + iSeed.w * 4.0;
        base.y -= uTime * speed;
        base.x += uTime * 1.4;
        vec3 rel = mod(base - cameraPosition, uBox) - uBox * 0.5;
        vec3 centre = cameraPosition + rel;
        vec3 axis = normalize(vec3(-0.16, -1.0, -0.05));                     // wind-slanted fall
        float len = 0.55 + iSeed.w * 0.35;
        vec3 toCam = normalize(cameraPosition - centre);
        vec3 side = normalize(cross(axis, toCam));
        vec3 p = centre + axis * position.y * len + side * position.x * 0.009;
        vUv = position.xy;
        float d = length(rel);
        vA = (1.0 - smoothstep(10.0, 17.0, d)) * smoothstep(0.35, 1.0, iSeed.w + 0.2) ;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      precision highp float; uniform vec3 uFogColor, uAmbSky; uniform float uRain; varying float vA; varying vec2 vUv;
      void main(){ float a = vA * uRain * (1.0 - abs(vUv.y) * 0.9) * 0.5; if (a < 0.01) discard; gl_FragColor = vec4(mix(vec3(0.75, 0.8, 0.85), uFogColor, 0.35) * (0.6 + 0.6 * uAmbSky.g), a); }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 20; mesh.name = 'rain'; scene.add(mesh);
  return { mesh, update() { mesh.visible = env.state.rain > 0.03; mat.uniforms.uRain.value = env.state.rain; } };
}

/* ------------------------------------------------------------------ falling leaves */
export function createLeaves({ scene, env, quality }) {
  const count = quality.id === 'low' ? 60 : quality.id === 'medium' ? 140 : 260;
  const g = instanced(quad(), [['iSeed', 4]], count);
  randomFill(g.attributes.iSeed, createRng(91));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uBox: { value: new THREE.Vector3(46, 16, 46) }, uShare: { value: 0.3 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 iSeed; uniform vec3 uBox; uniform float uShare, uTime; varying vec2 vUv; varying vec4 vSeed; varying float vDist;
      void main(){
        float on = step(iSeed.w, uShare);
        vec3 base = iSeed.xyz * uBox;
        float fall = 0.55 + iSeed.x * 0.7;
        base.y -= uTime * fall;
        base.x += sin(uTime * 0.7 + iSeed.y * 20.0) * 1.4 + uTime * 0.35;
        base.z += cos(uTime * 0.6 + iSeed.z * 17.0) * 1.2;
        vec3 rel = mod(base - cameraPosition, uBox) - uBox * 0.5;
        vec3 centre = cameraPosition + rel + vec3(0.0, 3.0, 0.0);
        float spin = uTime * (1.0 + iSeed.z * 2.0) + iSeed.y * 6.0;
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(cameraPosition - centre)));
        vec3 up = vec3(0.0, 1.0, 0.0);
        float c = cos(spin), s = sin(spin);
        vec3 p = centre + (right * (position.x * c - position.y * s) + up * (position.x * s + position.y * c)) * 0.09 * on;
        vUv = position.xy; vSeed = iSeed;
        vec4 mv = viewMatrix * vec4(p, 1.0); vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float; uniform vec3 uFogColor; uniform float uSeason; varying vec2 vUv; varying vec4 vSeed; varying float vDist;
      void main(){
        vec2 q = vUv * vec2(1.0, 1.6);
        float shape = 1.0 - dot(q, q) * 4.0;
        if (shape < 0.0) discard;
        float k = fract(vSeed.z * 9.1);
        vec3 summer = mix(vec3(0.36, 0.5, 0.16), vec3(0.62, 0.55, 0.2), k);
        vec3 autumn = mix(vec3(0.9, 0.58, 0.12), vec3(0.62, 0.26, 0.08), k);
        vec3 col = mix(summer, autumn, uSeason) * (0.75 + 0.5 * abs(vUv.x * 2.0));
        float f = 1.0 - exp(-pow(vDist * 0.0006, 2.0));
        gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'falling leaves'; scene.add(mesh);
  return { mesh, update() { const share = 0.22 + 0.7 * env.uniforms.uSeason.value; mat.uniforms.uShare.value = share * (env.state.rain > 0.5 ? 0.5 : 1); mesh.visible = quality.lifeDetail > 0; } };
}

/* ------------------------------------------------------------------ light shafts (fake god rays) */
export function createShafts({ scene, env, quality, surface, map }) {
  const count = quality.id === 'low' ? 5 : quality.id === 'medium' ? 10 : 18;
  const g = instanced(quad(), [['iBase', 4]], count);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uIntensity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 iBase; uniform vec3 uSunDir; uniform float uIntensity; varying vec2 vUv; varying float vA;
      void main(){
        vec3 D = normalize(uSunDir);
        float len = 26.0 + iBase.w * 12.0;
        vec3 foot = iBase.xyz;
        vec3 toCam = normalize(cameraPosition - foot);
        vec3 side = normalize(cross(D, toCam));
        float width = 1.1 + iBase.w * 1.7;
        vec3 p = foot + D * (position.y + 0.5) * len + side * position.x * width;
        vUv = position.xy + 0.5;
        float d = length(cameraPosition - foot);
        vA = uIntensity * smoothstep(3.0, 14.0, d) * (1.0 - smoothstep(34.0, 52.0, d));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      precision highp float; uniform vec3 uSunColor; uniform sampler2D uNoise; varying vec2 vUv; varying float vA;
      void main(){
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        across = smoothstep(0.0, 0.7, across);
        float along = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float shimmer = 0.7 + 0.3 * texture2D(uNoise, vec2(vUv.x * 1.3, vUv.y * 2.0 - uTime * 0.03)).g;
        float a = vA * across * along * shimmer * 0.2;
        if (a < 0.004) discard;
        gl_FragColor = vec4(normalize(uSunColor + 0.001) * vec3(1.0, 0.95, 0.75) * a, a);
      }`.replace('varying float vA;', 'varying float vA; uniform float uTime;'),
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 15; mesh.name = 'light shafts'; scene.add(mesh);
  const CELL = 11;
  let last = { x: 1e9, z: 1e9 };
  function place(cx, cz) {
    const attr = g.attributes.iBase;
    const ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
    let n = 0;
    for (let dj = -4; dj <= 4 && n < count; dj++) {
      for (let di = -4; di <= 4 && n < count; di++) {
        const i = ci + di, j = cj + dj;
        if (hash2(i, j, 31) > 0.34) continue;                                     // about a third of the cells have a shaft
        const x = (i + hash2(i, j, 5)) * CELL, z = (j + hash2(i, j, 6)) * CELL;
        const m = sampleWorldMap(map, x, z, scratch);
        if (m.cover < 0.45 || m.grass > 0.4 || m.built > 0.2) continue;           // forest only: the sun comes through its canopy
        attr.array[n * 4] = x; attr.array[n * 4 + 1] = surface.height(x, z) - 0.5; attr.array[n * 4 + 2] = z; attr.array[n * 4 + 3] = hash2(i, j, 7);
        n++;
      }
    }
    for (let k = n; k < count; k++) { attr.array[k * 4 + 1] = -1e4; }
    g.instanceCount = count; attr.needsUpdate = true;
  }
  return {
    mesh,
    update(cx, cz) {
      const st = env.state, sunLum = env.uniforms.uSunColor.value.y;
      const sunUp = Math.max(0, env.uniforms.uSunDir.value.y);
      const clear = (1 - env.uniforms.uCloud.value * 0.75) * (1 - env.uniforms.uRain.value);
      const mist = Math.min(1, env.uniforms.uFogHD.value * 70);
      mat.uniforms.uIntensity.value = Math.min(1.4, sunLum * (clear + mist * 0.9)) * (1 - st.night) * Math.min(1, sunUp * 4);
      mesh.visible = mat.uniforms.uIntensity.value > 0.02 && quality.lifeDetail > 0;
      if (Math.hypot(cx - last.x, cz - last.z) > CELL * 0.6) { place(cx, cz); last = { x: cx, z: cz }; }
    },
  };
}

/* ------------------------------------------------------------------ birds */
export function createBirds({ scene, env, quality }) {
  const count = quality.id === 'low' ? 4 : quality.id === 'medium' ? 8 : 14;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 0, 0, -0.3, -1, 0, -0.1, 0, 0, 0.35, 0, 0, -0.3, 1, 0, -0.1], 3));
  geo.setAttribute('wing', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 1));
  const g = instanced(geo, [['iSeed', 4]], count);
  randomFill(g.attributes.iSeed, createRng(123));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uAlpha: { value: 1 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 iSeed; attribute float wing; uniform float uAlpha, uTime; varying float vA; varying float vDist;
      void main(){
        float R = 28.0 + iSeed.x * 40.0, w = 0.12 + iSeed.y * 0.1, ph = iSeed.z * 6.283;
        float a = uTime * w * (iSeed.w > 0.5 ? 1.0 : -1.0) + ph;
        vec3 c = vec3(cameraPosition.x + sin(iSeed.z * 40.0) * 60.0, cameraPosition.y + 14.0 + iSeed.y * 36.0 + sin(uTime * 0.2 + ph) * 2.0, cameraPosition.z + cos(iSeed.x * 40.0) * 60.0);
        vec3 pos = c + vec3(cos(a) * R, 0.0, sin(a) * R);
        vec3 tangent = normalize(vec3(-sin(a), 0.0, cos(a)) * (iSeed.w > 0.5 ? 1.0 : -1.0));
        vec3 sideV = vec3(-tangent.z, 0.0, tangent.x);
        float flap = sin(uTime * (6.0 + iSeed.x * 3.0) + ph) * 0.45 * wing;
        float sz = 0.5 + iSeed.y * 0.4;
        vec3 p = position;
        vec3 world = pos + (tangent * p.z + sideV * p.x + vec3(0.0, abs(p.x) * flap * 1.2 + 0.0, 0.0)) * sz * 1.5;
        vec4 mv = viewMatrix * vec4(world, 1.0); vDist = length(mv.xyz);
        vA = uAlpha;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float; uniform vec3 uFogColor; varying float vA; varying float vDist; void main(){ float f = 1.0 - exp(-pow(vDist * 0.0012, 2.0)); gl_FragColor = vec4(mix(vec3(0.1, 0.1, 0.12), uFogColor, f), vA); }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'birds'; scene.add(mesh);
  return { mesh, update() { const day = (1 - env.state.night) * (1 - env.state.rain * 0.8); mat.uniforms.uAlpha.value = day; mesh.visible = day > 0.05 && quality.lifeDetail > 0; } };
}

/* ------------------------------------------------------------------ butterflies (fireflies at night) in the meadows and clearings */
export function createInsects({ scene, env, quality, surface, map, clearance }) {
  const count = quality.id === 'low' ? 0 : quality.id === 'medium' ? 16 : 30;
  if (count === 0) return { mesh: null, update() {} };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1, 0.6, 0, -1, -0.5, 0, 0, 0, 0, 1, 0.6, 0, 1, -0.5, 0], 3));
  geo.setAttribute('side', new THREE.Float32BufferAttribute([0, -1, -1, 0, 1, 1], 1));
  const g = instanced(geo, [['iBase', 4]], count);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uAlpha: { value: 1 } }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 iBase; attribute float side; uniform float uTime, uNight; varying vec3 vC; varying float vDist; varying float vOn;
      void main(){
        float ph = iBase.w * 6.283;
        vec3 centre = iBase.xyz + vec3(sin(uTime * 0.5 + ph) * 1.3, 0.9 + sin(uTime * 0.9 + ph * 2.0) * 0.4, cos(uTime * 0.43 + ph * 1.7) * 1.3);
        vec3 travel = normalize(vec3(cos(uTime * 0.5 + ph) * 0.5, 0.0, -sin(uTime * 0.43 + ph * 1.7) * 0.43) + vec3(0.001));
        vec3 right = vec3(-travel.z, 0.0, travel.x);
        float flap = sin(uTime * 14.0 + ph * 3.0);
        float wing = mix(abs(flap), 0.25, uNight);
        vec3 p = centre + right * position.x * 0.06 * wing + travel * position.y * 0.05 + vec3(0.0, position.x * 0.0 + abs(position.x) * 0.02 * flap, 0.0);
        float hue = fract(ph * 3.0);
        vC = hue < 0.4 ? vec3(0.95, 0.85, 0.25) : hue < 0.7 ? vec3(0.95, 0.95, 0.9) : vec3(0.95, 0.5, 0.15);
        vC = mix(vC, vec3(0.85, 1.0, 0.35) * (0.6 + 0.4 * sin(uTime * 2.0 + ph * 5.0)), uNight);
        vec4 mv = viewMatrix * vec4(p, 1.0); vDist = length(mv.xyz);
        vOn = step(-500.0, iBase.y);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `precision highp float; uniform float uAlpha; varying vec3 vC; varying float vDist; varying float vOn; void main(){ if (vOn < 0.5 || uAlpha < 0.02) discard; gl_FragColor = vec4(vC, uAlpha * (1.0 - smoothstep(18.0, 30.0, vDist))); }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'insects'; scene.add(mesh);
  const CELL = 9;
  let last = { x: 1e9, z: 1e9 };
  function place(cx, cz) {
    const attr = g.attributes.iBase;
    const ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
    let n = 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = ci + di, j = cj + dj;
      if (n >= count || hash2(i, j, 41) > 0.5) continue;
      const x = (i + hash2(i, j, 8)) * CELL, z = (j + hash2(i, j, 9)) * CELL;
      const m = sampleWorldMap(map, x, z, scratch);
      if ((m.grass < 0.5 && m.cover > 0.35) || m.built > 0.2 || m.water > 0.2 || clearance(x, z) > 0.3) continue;
      attr.array[n * 4] = x; attr.array[n * 4 + 1] = surface.height(x, z); attr.array[n * 4 + 2] = z; attr.array[n * 4 + 3] = hash2(i, j, 10); n++;
    }
    for (let k = n; k < count; k++) attr.array[k * 4 + 1] = -1e4;
    attr.needsUpdate = true;
  }
  return {
    mesh,
    update(cx, cz) {
      const night = env.state.night, day = (1 - night) * (1 - env.state.rain) * (env.uniforms.uCloud.value > 0.9 ? 0.3 : 1);
      mat.uniforms.uAlpha.value = Math.max(day, night * 0.9 * (1 - env.state.rain));
      mesh.visible = mat.uniforms.uAlpha.value > 0.05;
      if (Math.hypot(cx - last.x, cz - last.z) > CELL * 0.5) { place(cx, cz); last = { x: cx, z: cz }; }
    },
  };
}
