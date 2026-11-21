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
  const N = Math.max(8, count);
  const pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const u = { uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute float aLife; uniform float uPx; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (8.0 + 40.0 * (1.0 - aLife)) / max(-mv.z * 0.25, 1.0); }`,
    fragmentShader: `varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25 || vL <= 0.0) discard; gl_FragColor = vec4(0.97, 0.98, 1.0, vL * 0.75 * (1.0 - r * 3.5)); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);
  let next = 0, carry = 0;
  function emit(x, y, z, vx, vy, vz) {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; life[i] = 1;
  }
  return {
    /** amount 0..1: how much snow the skis throw this frame. */
    update(dt, s, amount, pixelRatio) {
      u.uPx.value = pixelRatio;
      carry += amount * dt * 90;
      const side = { x: -Math.sin(s.heading), z: Math.cos(s.heading) };
      const turn = Math.sign(s.edge || 0.0001);
      while (carry > 1) {
        carry -= 1;
        const k = Math.random();
        emit(s.x - Math.cos(s.heading) * 0.5 + side.x * turn * 0.3, s.y + 0.1, s.z - Math.sin(s.heading) * 0.5 + side.z * turn * 0.3,
          side.x * turn * (2 + 4 * k) + s.vx * 0.4, 1.5 + 2.5 * k, side.z * turn * (2 + 4 * k) + s.vz * 0.4);
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 1.4;
        vel[i * 3 + 1] -= 6 * dt;
        const drag = Math.max(0, 1 - 2.2 * dt);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true;
    },
  };
}
