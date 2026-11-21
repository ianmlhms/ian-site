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

/* Round 7: the snow the skis throw (Ian: "stronger snow spray"). One ring buffer of puffs, one draw call:
 *   carve    a spray ARC off the outside ski on every carve, more and farther with the speed and the edge angle (a fan thrown out and
 *            up, falling back in an arc), a sheet of it when braking hard
 *   powder   off the piste the snow is deep and light: big slow clouds that hang in the air behind the skier, even going straight
 *   landing / fall   a ring burst (a cloud in powder)
 *   sun      the dust lights up against a low sun (forward scattering: brighter and more opaque when the camera looks towards the sun
 *            through it), shaded grey-blue on the side away from it
 * Plus the TRACKS (createTracks): two thin grooves left in fresh snow off the piste, a ring buffer of quads draped on the ground (one
 * draw call, ~300 m of track). Budget: QUALITY.spray puffs (Niddreg 90 x 2), the tracks only where the snow is fresh. */

export function createSpray({ scene, count, env }) {
  const N = Math.max(32, count * 2);
  const pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3), size = new Float32Array(N), fade = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const u = { uPx: { value: 1 }, uSunDir: env ? env.u.uSunDir : { value: new THREE.Vector3(0, 1, 0) }, uSunColor: env ? env.u.uSunColor : { value: new THREE.Vector3(1, 1, 1) }, uShade: { value: new THREE.Vector3(0.62, 0.68, 0.8) }, uSun: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute float aLife; attribute float aSize; uniform float uPx; uniform vec3 uSunDir; varying float vL; varying float vBack;
      void main(){ vL = aLife; vec4 wp = modelMatrix * vec4(position, 1.0); vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
        vec3 toP = normalize(wp.xyz - cameraPosition);
        vBack = pow(max(dot(toP, uSunDir), 0.0), 6.0);                    // looking through the dust towards the sun
        gl_PointSize = min(uPx * aSize * (0.35 + 1.5 * (1.0 - aLife)) * 260.0 / max(-mv.z, 0.5), 220.0 * uPx); }`,
    fragmentShader: `uniform vec3 uSunColor, uShade; uniform float uSun; varying float vL; varying float vBack;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vL <= 0.0) discard;
        float lit = clamp(0.55 - c.y * 0.9, 0.0, 1.0);                                       // the top of a puff in the light
        vec3 col = mix(uShade, vec3(1.0), lit * 0.7 + 0.3) + uSunColor * vBack * 0.9 * uSun;
        float a = exp(-r * 2.6) * vL * vL * (0.55 + vBack * 0.35 * uSun);
        gl_FragColor = vec4(min(col, vec3(1.3)), a); }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);
  let next = 0, carry = 0, powderCarry = 0, wasLanded = 0, wasCrash = 0, wasStop = 0;
  function emit(x, y, z, vx, vy, vz, sz, slow = 1) {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; life[i] = 1; size[i] = sz; fade[i] = slow;
  }
  /** A ring of snow thrown up all round (a landing, a fall); in powder a cloud. */
  function burst(s, n, power, powder) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = power * (0.4 + Math.random() * 0.8);
      emit(s.x + Math.cos(a) * 0.4, s.y + 0.1, s.z + Math.sin(a) * 0.4, Math.cos(a) * v + s.vx * 0.3, 1 + Math.random() * power * 0.6, Math.sin(a) * v + s.vz * 0.3,
        (0.1 + Math.random() * 0.12) * (powder ? 2.6 : 1), powder ? 0.45 : 1);
    }
  }
  const stats = { emitted: 0 };
  return {
    stats, count: N,
    /** amount 0..1 = how hard the skis bite (carve / skid / brake), powder 0..1 = how fresh and deep the snow is here (0 on the piste). */
    update(dt, s, amount, pixelRatio, powder = 0, sunVisible = 1) {
      u.uPx.value = pixelRatio;
      u.uSun.value = sunVisible;
      if (s.landed > 0.3 && wasLanded <= 0.3 && s.speed > 3) burst(s, powder > 0.5 ? 34 : 26, 2.5, powder > 0.5);
      if (s.crash > 0 && wasCrash <= 0) burst(s, 44, 3.5, powder > 0.5);
      if ((s.stop || 0) > 0.35 && wasStop <= 0.35 && s.speed > 4) burst(s, 34, 3.8, powder > 0.5);      // round 7: the hockey stop's wall of snow
      wasLanded = s.landed; wasCrash = s.crash; wasStop = s.stop || 0;
      const speedK = Math.min(1, s.speed / 14);
      const edgeK = Math.min(1, Math.abs(s.edge || 0) / 0.8);
      carry += amount * dt * (110 + 260 * speedK * edgeK);                // the arc grows with the speed AND the edge angle
      const fx = Math.cos(s.heading), fz = Math.sin(s.heading);
      const side = { x: -fz, z: fx };
      const turn = Math.sign(s.edge || 0.0001);
      while (carry > 1) {
        carry -= 1; stats.emitted++;
        const k = Math.random(), j = Math.random();
        const out = -turn;                                   // the snow flies to the outside of the turn
        const back = -0.2 - 0.8 * j;                          // somewhere along the ski's rear half
        const x = s.x + fx * back + side.x * out * 0.22, z = s.z + fz * back + side.z * out * 0.22;
        const sp = (1.5 + 6.5 * k * speedK) * (0.6 + 0.6 * edgeK);
        const brakeFan = s.brake > 0.4 ? 1 : 0;
        const up = 1.0 + (2.0 + 3.0 * edgeK) * k * (0.5 + speedK * 0.5);      // the arc: thrown out and up, gravity brings it down
        emit(x, s.y + 0.05, z,
          side.x * out * sp * (1 - brakeFan * 0.5) + fx * sp * brakeFan * 0.6 + s.vx * 0.5,
          up,
          side.z * out * sp * (1 - brakeFan * 0.5) + fz * sp * brakeFan * 0.6 + s.vz * 0.5,
          (0.05 + 0.1 * Math.random()) * (1 + powder * 1.6) * (0.8 + speedK * 0.5), 1 - powder * 0.45);
      }
      // powder: a cloud kicked up behind the skis whenever he moves through deep snow, carving or not
      if (powder > 0.25 && s.grounded && s.speed > 4) {
        powderCarry += dt * powder * (18 + 40 * speedK);
        while (powderCarry > 1) {
          powderCarry -= 1; stats.emitted++;
          const a = (Math.random() - 0.5) * 1.6, v = 0.6 + Math.random() * 1.4;
          emit(s.x - fx * 0.6, s.y + 0.15, s.z - fz * 0.6, side.x * a * v + s.vx * 0.25, 0.8 + Math.random() * 1.6, side.z * a * v + s.vz * 0.25, 0.28 + Math.random() * 0.3, 0.35);
        }
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 1.7 * fade[i];
        vel[i * 3 + 1] -= (fade[i] < 0.6 ? 1.4 : 5) * dt;                  // powder dust hangs in the air
        const drag = Math.max(0, 1 - (fade[i] < 0.6 ? 3.4 : 2.6) * dt);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    },
  };
}

/** Ski tracks in fresh snow: a ring buffer of SEG quads (two grooves), draped on the ground, fading with age. */
export function createTracks({ scene, segments = 600 }) {
  const SEG = segments, V = SEG * 2 * 4;               // 2 grooves x 4 corners per segment
  const pos = new Float32Array(V * 3), alpha = new Float32Array(V);
  const idx = new Uint32Array(SEG * 2 * 6);
  for (let q = 0; q < SEG * 2; q++) { const b = q * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vA; void main(){ if (vA <= 0.01) discard; gl_FragColor = vec4(0.42, 0.5, 0.66, vA * 0.42); }',
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'ski-tracks';
  scene.add(mesh);
  let next = 0, last = null, used = 0;
  const born = new Float32Array(SEG);
  let clock = 0;
  return {
    get used() { return used; },
    /** fresh = 0..1 (deep untouched snow), height(x, z) the snow */
    update(dt, s, fresh, height) {
      clock += dt;
      const on = fresh > 0.4 && s.grounded && s.crash === 0 && s.speed > 2 && !s.ride;
      if (!on) { last = null; }
      else if (!last || Math.hypot(s.x - last.x, s.z - last.z) > 0.7) {
        if (last && Math.hypot(s.x - last.x, s.z - last.z) < 4) {
          const i = next; next = (next + 1) % SEG; used = Math.min(SEG, used + 1);
          born[i] = clock;
          const hx = Math.cos(s.heading), hz = Math.sin(s.heading), rx = -hz, rz = hx;
          for (let gr = 0; gr < 2; gr++) {
            const off = gr ? 0.13 : -0.13, w = 0.05;
            const corners = [[last.x, last.z, last.rx, last.rz], [s.x, s.z, rx, rz]];
            const b = (i * 2 + gr) * 4;
            const put = (k, x, z) => { pos[(b + k) * 3] = x; pos[(b + k) * 3 + 1] = height(x, z) + 0.025; pos[(b + k) * 3 + 2] = z; };
            const [a0, c0] = corners;
            put(0, a0[0] + a0[2] * (off - w), a0[1] + a0[3] * (off - w));
            put(1, c0[0] + c0[2] * (off - w), c0[1] + c0[3] * (off - w));
            put(2, c0[0] + c0[2] * (off + w), c0[1] + c0[3] * (off + w));
            put(3, a0[0] + a0[2] * (off + w), a0[1] + a0[3] * (off + w));
          }
          last = { x: s.x, z: s.z, rx, rz };
        } else {
          const hx = Math.cos(s.heading), hz = Math.sin(s.heading);
          last = { x: s.x, z: s.z, rx: -hz, rz: hx };
        }
      }
      // fade with age (old track ends disappear before the ring wraps round)
      for (let i = 0; i < SEG; i++) {
        const a = born[i] ? Math.max(0, 1 - (clock - born[i]) / 90) : 0;
        for (let k = 0; k < 8; k++) alpha[i * 8 + k] = a;
      }
      g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
      mesh.visible = used > 0;
    },
    clear() { born.fill(0); used = 0; last = null; },
  };
}
