/* Round 7-C: the snow the skis throw (replaces the small puffs of effects.js createSpray; same update call from main.js).
 *   carve   a visible spray ARC off the outside ski on every carve: a fan of grains thrown out and up, more and further the faster and the
 *           higher the edge angle; skids and the snowplough throw a lower sheet ahead
 *   powder  off the piste (fresh snow) a cloud: big soft puffs round the boots that hang in the air and drift, more with speed
 *   light   backlit snow dust: grains between the camera and a low sun light up warm (forward scattering), only when the sun is out
 *   tracks  two ski tracks pressed into the fresh snow off the piste (a ring buffer of ground quads, fading out after a minute)
 * Budget: Niddreg 160 grains + 90 track segments, Mëttel 320 + 260, Héich 520 + 420; two draw calls (points, tracks). */
const THREE = window.THREE;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const SPRAY_BUDGET = Object.freeze({ low: { grains: 160, tracks: 90 }, medium: { grains: 320, tracks: 260 }, high: { grains: 520, tracks: 420 } });
const TRACK_STEP = 0.7;            // m between track segments
const TRACK_LIFE = 60;             // s

export function createSnowSpray({ scene, env, level = 'medium', height }) {
  const budget = SPRAY_BUDGET[level] || SPRAY_BUDGET.medium;
  const N = budget.grains;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), size = new Float32Array(N), kind = new Float32Array(N), decay = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
  const u = { uScale: { value: 600 }, uSunDir: env.u.uSunDir, uSun: { value: 1 }, uCam: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `attribute float aLife, aSize, aKind; uniform float uScale, uSun; uniform vec3 uSunDir, uCam; varying float vA, vK, vGlow;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float grow = aKind > 0.5 ? (1.0 + 1.6 * (1.0 - aLife)) : (0.6 + 0.9 * (1.0 - aLife));
        gl_PointSize = clamp(aSize * grow * uScale / max(-mv.z, 0.4), 0.0, 200.0);
        vec3 toP = normalize(position - uCam);
        vGlow = uSun * pow(max(dot(toP, uSunDir), 0.0), 5.0);          // looking towards the sun through the dust
        vA = aLife * smoothstep(0.7, 2.6, -mv.z); vK = aKind;          // grains right in front of the eyes (first person) fade out
      }`,
    fragmentShader: `varying float vA, vK, vGlow;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vA <= 0.0) discard;
        float a = vK > 0.5 ? exp(-r * 2.0) * vA * 0.32 : exp(-r * 2.8) * vA * vA * 0.75;
        vec3 col = mix(vec3(0.95, 0.97, 1.0), vec3(1.0, 0.95, 0.84) * 1.25, vGlow);
        gl_FragColor = vec4(col, a * (1.0 + vGlow * 0.8));
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.name = 'ski-spray';
  points.frustumCulled = false;
  points.renderOrder = 7;
  scene.add(points);

  // tracks: M quads (two triangles each) on the ground, alpha from their age
  const M = budget.tracks * 2;
  const tPos = new Float32Array(M * 6 * 3), tBorn = new Float32Array(M * 6).fill(-1e6);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tg.setAttribute('aBorn', new THREE.BufferAttribute(tBorn, 1).setUsage(THREE.DynamicDrawUsage));
  const tu = { uTime: { value: 0 } };
  const tmat = new THREE.ShaderMaterial({
    uniforms: tu, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `attribute float aBorn; uniform float uTime; varying float vA;
      void main(){ vA = 1.0 - clamp((uTime - aBorn) / ${TRACK_LIFE.toFixed(1)}, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main(){ if (vA <= 0.0) discard; gl_FragColor = vec4(0.55, 0.63, 0.78, 0.34 * vA); }`,
  });
  const tracks = new THREE.Mesh(tg, tmat);
  tracks.name = 'ski-tracks';
  tracks.frustumCulled = false;
  tracks.renderOrder = 2;
  scene.add(tracks);

  let next = 0, carry = 0, puffCarry = 0, wasLanded = 0, wasCrash = 0, tNext = 0, time = 0, lastTrackT = -1e9;
  let last = null;                                    // last track point { x, z, hx, hz }
  const stats = { emitted: 0, powder: 0, tracks: 0 };
  function emit(x, y, z, vx, vy, vz, sz, k = 0, dec = 1.7) {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; life[i] = 1; size[i] = sz; kind[i] = k; decay[i] = dec;
    stats.emitted++;
  }
  function burst(s, n, power, powder) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = power * (0.4 + Math.random() * 0.8);
      emit(s.x + Math.cos(a) * 0.4, s.y + 0.1, s.z + Math.sin(a) * 0.4, Math.cos(a) * v + s.vx * 0.3, 1 + Math.random() * power * 0.6, Math.sin(a) * v + s.vz * 0.3,
        powder ? 0.6 + Math.random() * 0.6 : 0.12 + Math.random() * 0.14, powder ? 1 : 0, powder ? 0.7 : 1.5);
    }
  }
  function trackQuad(ax, az, bx, bz, w) {
    const i = (tNext % M) * 18;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, rx = -dz / L * w, rz = dx / L * w;
    const ya = height(ax, az) + 0.03, yb = height(bx, bz) + 0.03;
    const v = [ax - rx, ya, az - rz, bx - rx, yb, bz - rz, bx + rx, yb, bz + rz, ax - rx, ya, az - rz, bx + rx, yb, bz + rz, ax + rx, ya, az + rz];
    tPos.set(v, i);
    tBorn.fill(time, (tNext % M) * 6, (tNext % M) * 6 + 6);
    tNext++; stats.tracks++; lastTrackT = time;
  }
  return {
    stats, points, tracks,
    /** amount: 1 = skiing (0 = nothing new is thrown: map / pause); viewH = drawing buffer height (px), fov in degrees. */
    update(dt, s, amount, pixelRatio, camera = null, viewH = 900) {
      time += dt; tu.uTime.value = time;
      if (camera) { u.uCam.value.copy(camera.position); u.uScale.value = viewH / (2 * Math.tan((camera.fov * Math.PI / 180) / 2)); }
      u.uSun.value = clamp((env.sunStrength ? env.sunStrength() : 1) - 0.25, 0, 1) * 1.1;
      const speed = s.speed || 0;
      const fresh = s.snow !== undefined ? clamp(1 - s.snow * 1.6, 0, 1) : 0;     // world.snow = the piste share: off the piste = fresh snow
      if (amount > 0) {
        if (s.landed > 0.3 && wasLanded <= 0.3 && speed > 3) burst(s, fresh > 0.5 ? 18 : 26, 2.5, fresh > 0.5);
        if (s.crash > 0 && wasCrash <= 0) burst(s, 40, 3.5, fresh > 0.5);
      }
      wasLanded = s.landed; wasCrash = s.crash;
      const fx = Math.cos(s.heading), fz = Math.sin(s.heading), sx = -fz, sz = fx;
      const edge = Math.abs(s.edge || 0), turn = Math.sign(s.edge || 0.0001), out = -turn;
      const grounded = s.grounded && s.crash === 0 && amount > 0;
      // the carve arc: a fan of grains off the outside ski's tail, out and up; scaled by the speed and the edge angle
      const carve = grounded && speed > 3 ? clamp(edge * 1.1 + s.slip * 2.4 + s.brake * 0.8, 0, 1.4) * smoothstep(3, 16, speed) : 0;
      carry += carve * dt * 230;
      while (carry > 1) {
        carry -= 1;
        const k = Math.random(), j = Math.random();
        const back = -0.25 - 0.75 * j;
        const x = s.x + fx * back + sx * out * 0.25, z = s.z + fz * back + sz * out * 0.25;
        const arc = (Math.random() - 0.3) * 1.2;                           // angle in the fan: mostly out, some back and up
        const power = (2 + 6 * k) * clamp(speed / 16, 0.3, 1.4) * (0.6 + edge * 0.6);
        const brakeFan = s.brake > 0.4 ? 1 : 0;
        const ox = sx * out * Math.cos(arc) - fx * Math.sin(arc) * 0.6, oz = sz * out * Math.cos(arc) - fz * Math.sin(arc) * 0.6;
        emit(x, s.y + 0.06, z,
          ox * power * (1 - brakeFan * 0.5) + fx * power * brakeFan * 0.6 + s.vx * 0.5,
          1.2 + 3.2 * k * (0.5 + edge),
          oz * power * (1 - brakeFan * 0.5) + fz * power * brakeFan * 0.6 + s.vz * 0.5,
          fresh > 0.5 ? 0.18 + 0.24 * Math.random() : 0.1 + 0.16 * Math.random(), 0, 1.4 + Math.random() * 0.4);
      }
      // powder: a cloud round the boots off the piste
      // R7-C2: a slow turn in deep snow still kicks up a visible cloud (it was ~8 puffs / s at walking speed, none showed)
      puffCarry += grounded && fresh > 0.4 && speed > 0.8 ? fresh * (0.7 + 0.5 * smoothstep(2, 16, speed)) * dt * 40 : 0;
      while (puffCarry > 1) {
        puffCarry -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
        emit(s.x + Math.cos(a) * r - fx * 0.4, s.y + 0.2 + Math.random() * 0.4, s.z + Math.sin(a) * r - fz * 0.4,
          s.vx * 0.25 + Math.cos(a) * 0.8, 0.6 + Math.random() * 1.4, s.vz * 0.25 + Math.sin(a) * 0.8, 0.7 + Math.random() * 1.0, 1, 0.5 + Math.random() * 0.2);
        stats.powder++;
      }
      // tracks in fresh snow (two lines, one per ski)
      if (grounded && fresh > 0.5) {
        if (!last) last = { x: s.x, z: s.z };
        const d = Math.hypot(s.x - last.x, s.z - last.z);
        if (d > TRACK_STEP && d < 6) {
          for (const side of [-0.12, 0.12]) trackQuad(last.x + sx * side, last.z + sz * side, s.x + sx * side, s.z + sz * side, 0.055);
          last = { x: s.x, z: s.z };
        } else if (d >= 6) last = { x: s.x, z: s.z };
      } else last = null;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * decay[i];
        const powder = kind[i] > 0.5;
        vel[i * 3 + 1] -= (powder ? 0.6 : 5.5) * dt;
        const drag = Math.max(0, 1 - (powder ? 1.6 : 2.4) * dt);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag; if (powder) vel[i * 3 + 1] *= drag;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aKind.needsUpdate = true;
      if (stats.tracks) { tg.attributes.position.needsUpdate = true; tg.attributes.aBorn.needsUpdate = true; }
      tracks.visible = stats.tracks > 0 && time - lastTrackT < 70;      // no draw call when there are no tracks
      void pixelRatio;
    },
    /** Live grains (tests). */
    live() { let n = 0, p = 0; for (let i = 0; i < N; i++) if (life[i] > 0) { n++; if (kind[i] > 0.5) p++; } return { grains: n, powder: p, tracks: Math.min(stats.tracks, M) }; },
    dispose() { scene.remove(points, tracks); g.dispose(); mat.dispose(); tg.dispose(); tmat.dispose(); },
  };
}
