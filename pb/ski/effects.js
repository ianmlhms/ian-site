/* Snowfall (a box of flakes that travels with the camera, moved in the vertex shader: no per-frame CPU work) and the snow spray of the
 * skis (a small ring buffer of puffs, thrown when carving hard, braking or landing). */
const THREE = window.THREE;

export function createSnowfall({ scene, env, count }) {
  const N = Math.max(1, count);
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const u = { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uAmount: env.u.uSnowfall, uFogColor: env.u.uFogColor, uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `
      attribute float aSeed; uniform vec3 uCam; uniform float uT, uAmount, uPx; varying float vA;
      void main(){
        float box = 46.0;
        vec3 p = position * box;
        p.y -= uT * (1.6 + aSeed * 1.2);
        p.x += sin(uT * 0.7 + aSeed * 30.0) * 1.2 + uT * 0.8;
        p.z += cos(uT * 0.5 + aSeed * 20.0) * 1.0;
        vec3 w = uCam + mod(p - uCam, box) - box * 0.5;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        float d = -mv.z;
        vA = step(aSeed, uAmount) * smoothstep(0.5, 2.5, d) * (1.0 - smoothstep(18.0, 23.0, d));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (2.0 + 26.0 * (0.5 + aSeed) / max(d, 1.0));
      }`,
    fragmentShader: `
      varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25 || vA < 0.01) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, vA * (1.0 - r * 3.2) * 0.9); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  scene.add(points);
  return {
    update(t, camera, pixelRatio) { u.uT.value = t; u.uCam.value.copy(camera.position); u.uPx.value = pixelRatio; points.visible = env.u.uSnowfall.value > 0.02; },
  };
}

export function createSpray({ scene, count }) {
  const N = Math.max(16, count * 2);
  const pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3), size = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const u = { uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute float aLife; attribute float aSize; uniform float uPx; varying float vL;
      void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * aSize * (0.35 + 1.4 * (1.0 - aLife)) * 260.0 / max(-mv.z, 0.5); }`,
    fragmentShader: `varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vL <= 0.0) discard;
      float a = exp(-r * 2.6) * vL * vL * 0.55; gl_FragColor = vec4(0.96, 0.975, 1.0, a); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);
  let next = 0, carry = 0, wasLanded = 0, wasCrash = 0;
  function emit(x, y, z, vx, vy, vz, sz) {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; life[i] = 1; size[i] = sz;
  }
  /** A ring of snow thrown up all round (a landing, a fall). */
  function burst(s, n, power) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = power * (0.4 + Math.random() * 0.8);
      emit(s.x + Math.cos(a) * 0.4, s.y + 0.1, s.z + Math.sin(a) * 0.4, Math.cos(a) * v + s.vx * 0.3, 1 + Math.random() * power * 0.6, Math.sin(a) * v + s.vz * 0.3, 0.1 + Math.random() * 0.12);
    }
  }
  return {
    /** amount 0..1: how much snow the skis throw this frame (carving: off the outside ski's edge in a fan; braking: ahead of both). */
    update(dt, s, amount, pixelRatio) {
      u.uPx.value = pixelRatio;
      if (s.landed > 0.3 && wasLanded <= 0.3 && s.speed > 3) burst(s, 26, 2.5);
      if (s.crash > 0 && wasCrash <= 0) burst(s, 40, 3.5);
      wasLanded = s.landed; wasCrash = s.crash;
      carry += amount * dt * 160;
      const fx = Math.cos(s.heading), fz = Math.sin(s.heading);
      const side = { x: -fz, z: fx };
      const turn = Math.sign(s.edge || 0.0001);
      while (carry > 1) {
        carry -= 1;
        const k = Math.random(), j = Math.random();
        const out = -turn;                                   // the snow flies to the outside of the turn
        const back = -0.2 - 0.8 * j;                          // somewhere along the ski's rear half
        const x = s.x + fx * back + side.x * out * 0.22, z = s.z + fz * back + side.z * out * 0.22;
        const sp = 1.5 + 4.5 * k * Math.min(1, s.speed / 14);
        const brakeFan = s.brake > 0.4 ? 1 : 0;
        emit(x, s.y + 0.05, z,
          side.x * out * sp * (1 - brakeFan * 0.5) + fx * sp * brakeFan * 0.6 + s.vx * 0.55,
          0.8 + 2.2 * k,
          side.z * out * sp * (1 - brakeFan * 0.5) + fz * sp * brakeFan * 0.6 + s.vz * 0.55,
          0.05 + 0.1 * Math.random());
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 1.7;
        vel[i * 3 + 1] -= 5 * dt;
        const drag = Math.max(0, 1 - 2.6 * dt);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    },
  };
}
