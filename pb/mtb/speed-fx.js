/* Speed sensation you can see (speed pass, 26 Oct 2026): a dust trail behind the rear wheel (earth, gravel, leaves, mud flecks, water spray, by what the tyre is on)
 * and speed lines at the edge of the screen. Both are cheap: the dust is one instanced draw call of at most 96 soft billboards updated on the CPU, the lines are a small
 * 2D canvas over the picture that is only drawn above 36 km/h. The numbers (what is kicked up, from which speed) are in speed-feel.js and checked in Node. */
import { createRng } from './noise.js';
import { DUST, SPEED_FEEL, dustRate, speedLineStrength } from './speed-feel.js';

const THREE = window.THREE;
const DRAG = 2.6;                // 1/s: how fast a puff loses its speed
const RISE = 0.5;                // m/s2 of buoyancy of the dust
const GROW = 2.4;                // a puff ends up this many times as big as it starts
const REAR_WHEEL = 0.56;         // m behind the bike's centre (half the wheelbase)

/* ------------------------------------------------------------------ dust trail */
export function createDust({ scene, env, quality }) {
  const capacity = quality.id === 'low' ? 28 : quality.id === 'medium' ? 56 : 96;
  const rng = createRng(4242);
  const pos = new Float32Array(capacity * 3), vel = new Float32Array(capacity * 3);
  const age = new Float32Array(capacity).fill(1), life = new Float32Array(capacity).fill(1), size0 = new Float32Array(capacity);
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index; geo.attributes = { ...quad.attributes };
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);          // xyz + age 0..1
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);          // rgb + size (m)
  aPos.setUsage(THREE.DynamicDrawUsage); aCol.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iCol', aCol);
  geo.instanceCount = capacity;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 iPos; attribute vec4 iCol; varying float vA; varying vec3 vC; varying vec2 vUv; varying float vDist;
      void main(){
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float a = iPos.w;
        float fade = smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.35, 1.0, a));
        vA = fade * step(a, 0.999);
        vC = iCol.rgb; vUv = position.xy;
        vec3 p = iPos.xyz + (right * position.x + up * position.y) * iCol.w;
        vec4 mv = viewMatrix * vec4(p, 1.0); vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float; uniform vec3 uFogColor, uAmbSky; varying float vA; varying vec3 vC; varying vec2 vUv; varying float vDist;
      void main(){
        float r = dot(vUv, vUv) * 4.0;
        float soft = (1.0 - r); if (soft <= 0.0 || vA < 0.01) discard;
        float f = 1.0 - exp(-pow(vDist * 0.0006, 2.0));
        vec3 col = vC * (0.55 + 0.6 * uAmbSky.g);
        gl_FragColor = vec4(mix(col, uFogColor, f), vA * soft * soft * 0.55);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 18; mesh.name = 'dust'; mesh.visible = false;
  scene.add(mesh);

  let next = 0, carry = 0, live = 0;
  function spawn(x, y, z, vx, vy, vz, kind, scale = 1) {
    const p = DUST[kind] || DUST.dirt;
    const i = next; next = (next + 1) % capacity;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    age[i] = 0; life[i] = p.life * (0.7 + 0.6 * rng());
    size0[i] = p.size * scale * (0.7 + 0.6 * rng());
    const tint = 0.9 + 0.2 * rng();
    aCol.array[i * 4] = Math.min(1, p.color[0] * tint); aCol.array[i * 4 + 1] = Math.min(1, p.color[1] * tint); aCol.array[i * 4 + 2] = Math.min(1, p.color[2] * tint);
  }

  /** bike = the physics state; surface kind + wet from the game. Emits behind the rear wheel in proportion to the speed and what the tyre is on. */
  function emit(bike, dt, kind, wet) {
    const speed = Math.hypot(bike.vx, bike.vz);
    carry += dustRate(kind, speed, wet, bike.skid, bike.grounded) * dt * (quality.id === 'low' ? 0.6 : 1);
    const fx = Math.cos(bike.heading), fz = Math.sin(bike.heading);
    const p = DUST[kind] || DUST.dirt;
    while (carry >= 1) {
      carry -= 1;
      const side = (rng() - 0.5) * 0.35;
      const back = REAR_WHEEL + rng() * 0.2;
      spawn(bike.x - fx * back - fz * side, bike.y + 0.08, bike.z - fz * back + fx * side,
        bike.vx * 0.12 + (rng() - 0.5) * 0.9, p.lift * (0.5 + rng()), bike.vz * 0.12 + (rng() - 0.5) * 0.9, kind);
    }
  }

  /** A landing or a hard touch-down throws a ring of dust. */
  function burst(bike, impact, kind) {
    if (impact < SPEED_FEEL.burstImpact || (DUST[kind] || DUST.dirt).rate === 0) return;
    const n = Math.min(Math.round(6 + impact * 1.4), capacity >> 1);
    const fx = Math.cos(bike.heading), fz = Math.sin(bike.heading);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng();
      const v = 0.8 + rng() * (0.5 + impact * 0.18);
      spawn(bike.x - fx * 0.3, bike.y + 0.06, bike.z - fz * 0.3, Math.cos(a) * v + bike.vx * 0.15, 0.3 + rng() * 0.7, Math.sin(a) * v + bike.vz * 0.15, kind, 1.3);
    }
  }

  function update(dt) {
    live = 0;
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < capacity; i++) {
      if (age[i] >= 1) { aPos.array[i * 4 + 3] = 1; continue; }
      age[i] = Math.min(1, age[i] + dt / life[i]);
      vel[i * 3] *= drag; vel[i * 3 + 2] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag + RISE * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      aPos.array[i * 4] = pos[i * 3]; aPos.array[i * 4 + 1] = pos[i * 3 + 1]; aPos.array[i * 4 + 2] = pos[i * 3 + 2]; aPos.array[i * 4 + 3] = age[i];
      aCol.array[i * 4 + 3] = size0[i] * (1 + (GROW - 1) * Math.sqrt(age[i]));
      live++;
    }
    aPos.needsUpdate = true; aCol.needsUpdate = true;
    mesh.visible = live > 0;
  }
  return { mesh, emit, burst, update, get live() { return live; }, capacity };
}

/* ------------------------------------------------------------------ speed lines (a small 2D canvas over the picture) */
const LINE_COUNT = 34;
const LINE_HOLE = 0.34;           // the middle of the screen (the rider and the trail ahead) stays clear: lines start outside this share of the half-diagonal
export function createSpeedLines(container, { low = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'speedlines';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;opacity:0;transition:opacity .25s';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const rng = createRng(777);
  const count = low ? 20 : LINE_COUNT;
  const lines = Array.from({ length: count }, () => ({ a: rng() * Math.PI * 2, t: rng(), v: 0.8 + rng() * 0.9, w: 0.8 + rng() * 1.6, len: 0.5 + rng() * 0.9 }));
  let w = 0, h = 0, shown = false;
  const SCALE = 0.5;
  function resize() {
    const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
    w = Math.max(2, Math.round(cw * SCALE)); h = Math.max(2, Math.round(ch * SCALE));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  /** strength = speedLineStrength(speed); call every frame with the frame time. */
  function update(speedMs, dt, active = true) {
    const strength = active ? speedLineStrength(speedMs) : 0;
    const want = strength > 0.02;
    if (!want) {
      if (shown) { canvas.style.opacity = '0'; shown = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    if (!shown) { canvas.style.opacity = '1'; shown = true; }
    resize();
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
    const n = Math.max(4, Math.round(count * (0.35 + 0.65 * strength)));
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const L = lines[i];
      L.t += dt * L.v * (0.9 + 1.6 * strength);
      if (L.t >= 1) { L.t -= 1; L.a = rng() * Math.PI * 2; L.len = 0.5 + rng() * 0.9; }
      const r0 = R * (LINE_HOLE + (1 - LINE_HOLE) * L.t * L.t * 0.9 + 0.02);
      const r1 = r0 + R * 0.11 * L.len * (0.5 + strength) * (0.4 + L.t);
      const alpha = Math.sin(Math.PI * L.t) * 0.5 * strength;
      const ca = Math.cos(L.a), sa = Math.sin(L.a);
      ctx.strokeStyle = `rgba(255,252,240,${alpha.toFixed(3)})`;
      ctx.lineWidth = L.w * (0.7 + L.t);
      ctx.beginPath(); ctx.moveTo(cx + ca * r0 * 1.15, cy + sa * r0 * 0.85); ctx.lineTo(cx + ca * r1 * 1.15, cy + sa * r1 * 0.85); ctx.stroke();
    }
  }
  return { canvas, update, dispose() { canvas.remove(); } };
}
