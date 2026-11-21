/* Round 7: avalanches in the free ride (Ian's idea from a reel).
 * On a steep off-piste slope (>= AVA.slope degrees under the skis) with fresh snow (no rock, no forest, no piste within AVA.pisteGap m;
 * more likely while it snows), crossing it has a small chance of releasing a slab a little above the skier. It flows down the real
 * terrain as a cloud of snow and tumbling slab blocks; outrun it (straight down) or get out of its way (to the side), or be caught: a fall,
 * a white-out and the respawn. Never on a groomed piste. A risk badge "⚠ Lawinegefor" shows on such slopes.
 * The "Lawin" challenge: a few marked steep faces per resort (warning signs at the top, found from the terrain, never by hand): ski into
 * the sign, the slab releases right behind you, reach the safe spot at the bottom of the face.
 * Online free ride: the release event { id, x, z, seed } goes to everybody (net/freeride.js), and the flow is DETERMINISTIC: it runs on
 * the far grid (40 m, the same on every device whatever tiles are loaded) with a fixed step and the event's seed, so everybody sees the
 * same avalanche; a late receiver runs it forward by its age. Drawing: one Points cloud + one instanced slab mesh + the crown line, only
 * while an avalanche lives (<= 3 draw calls; Niddreg takes fewer puffs).
 * The pure part (risk, flow, catch test, the spots) is exported for the Node checks. */
const THREE = typeof window !== 'undefined' ? window.THREE : null;

export const AVA = Object.freeze({
  slope: 35,               // degrees: steeper than this, off the piste, in fresh snow: a slab can release
  warn: 30,                // degrees: the risk badge shows from here
  chance: 0.012,           // per check (every AVA.every s) on such a slope, x the weather factor
  every: 0.25,
  minSpeed: 4,
  cooldown: 30,            // s between two releases on one device
  pisteGap: 30,            // m from the nearest piste line: never closer
  above: 22,               // m above the skier where the crown breaks (upslope along the fall line)
  width: 56,               // m across the slope: the slab
  parcels: 24,
  step: 1 / 30,            // s: the fixed flow step (deterministic)
  mu: 0.2,                 // snow-on-snow friction of the flow
  drag: 0.01,              // 1/m: air / turbulence drag (caps the speed near 22 m/s on 35 degrees)
  maxSpeed: 23,
  life: 45,                // s at most
  stopSpeed: 0.7,
  catchRadius: 0.62,       // share of a parcel's radius that catches a skier
  weather: Object.freeze({ snow: 1.8, fog: 1.2, cloudy: 1, sun: 0.7 }),
  spots: 4,                // Lawin challenge faces per resort
  spotSpacing: 1500,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Small seeded generator (mulberry32). */
export function rng(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
/** The far grid's gradient at (x, z): { gx, gz, slope (rise per m), deg }. */
export function gradient(farHeight, x, z, h = 20) {
  const gx = (farHeight(x + h, z) - farHeight(x - h, z)) / (2 * h), gz = (farHeight(x, z + h) - farHeight(x, z - h)) / (2 * h);
  const slope = Math.hypot(gx, gz);
  return { gx, gz, slope, deg: Math.atan(slope) * 180 / Math.PI };
}
/** 0..1: how fresh and loose the snow is at (x, z) (field.attrs): no piste near, no rock, no forest, no buildings. 0 = never. */
export function freshness(a) {
  if (a.piste > 0.02 || a.park > 0 || (a.dist >= 0 && a.dist < AVA.pisteGap) || a.dist < 0) return 0;
  return clamp(1 - a.rock * 1.6 - a.forest * 2.2 - a.built * 3 - a.water * 3, 0, 1);
}
/** The slope under the skis in degrees from the surface normal ({x, y, z}). */
export const slopeDeg = (n) => Math.acos(clamp(n.y, -1, 1)) * 180 / Math.PI;

/** One avalanche (pure): parcels released along the crown, flowing down the far grid. ev = { x, z (crown middle), seed }. */
export function createFlow(ev, farHeight) {
  const R = rng(ev.seed);
  const g0 = gradient(farHeight, ev.x, ev.z, 25);
  const dl = g0.slope > 1e-4 ? [-g0.gx / g0.slope, -g0.gz / g0.slope] : [1, 0];          // downhill
  const ac = [-dl[1], dl[0]];                                                               // across
  const parcels = [];
  for (let i = 0; i < AVA.parcels; i++) {
    const u = (i / (AVA.parcels - 1) - 0.5) * AVA.width + (R() - 0.5) * 4, back = R() * 10;
    parcels.push({ x: ev.x + ac[0] * u + dl[0] * back, z: ev.z + ac[1] * u + dl[1] * back, vx: dl[0] * 0.5, vz: dl[1] * 0.5, r: 6, moving: true, seed: R() });
  }
  const flow = { ev, parcels, age: 0, acc: 0, done: false, dir: dl, across: ac, crown: { x: ev.x, z: ev.z }, front: 0 };
  function stepOnce() {
    const dt = AVA.step;
    let moving = 0, cx = 0, cz = 0;
    for (const p of parcels) { cx += p.x; cz += p.z; }
    cx /= parcels.length; cz /= parcels.length;
    for (const p of parcels) {
      if (!p.moving) continue;
      const g = gradient(farHeight, p.x, p.z, 20);
      const sinT = g.slope / Math.sqrt(1 + g.slope * g.slope), cosT = 1 / Math.sqrt(1 + g.slope * g.slope);
      const ux = g.slope > 1e-4 ? -g.gx / g.slope : 0, uz = g.slope > 1e-4 ? -g.gz / g.slope : 0;
      const v = Math.hypot(p.vx, p.vz);
      const fric = AVA.mu * 9.81 * cosT;
      let ax = ux * 9.81 * sinT, az = uz * 9.81 * sinT;
      if (v > 0.05) { ax -= (p.vx / v) * (fric + AVA.drag * v * v); az -= (p.vz / v) * (fric + AVA.drag * v * v); }
      // a little spread from the middle of the mass (the cloud widens as it runs)
      const sx = p.x - cx, sz = p.z - cz, sd = Math.hypot(sx, sz) || 1;
      ax += (sx / sd) * 0.35; az += (sz / sd) * 0.35;
      p.vx += ax * dt; p.vz += az * dt;
      const nv = Math.hypot(p.vx, p.vz);
      if (nv > AVA.maxSpeed) { p.vx *= AVA.maxSpeed / nv; p.vz *= AVA.maxSpeed / nv; }
      // friction can not push it uphill: on a flat run-out it slows and stops
      if (nv < AVA.stopSpeed && g.deg < 20 && flow.age > 2) { p.moving = false; p.vx = 0; p.vz = 0; continue; }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.r = 6 + Math.min(10, nv * 0.45);
      moving++;
    }
    flow.age += dt;
    let front = 0;
    for (const p of parcels) front = Math.max(front, (p.x - ev.x) * dl[0] + (p.z - ev.z) * dl[1]);
    flow.front = front;
    if (!moving || flow.age > AVA.life) flow.done = true;
  }
  /** Runs the flow forward by dt s (fixed steps). */
  flow.advance = (dt) => { flow.acc += dt; while (flow.acc >= AVA.step && !flow.done) { flow.acc -= AVA.step; stepOnce(); } };
  /** Is a skier at (x, z) inside a moving part of the flow? */
  flow.catches = (x, z) => flow.parcels.some((p) => p.moving && Math.hypot(p.vx, p.vz) > 2 && Math.hypot(p.x - x, p.z - z) < p.r * AVA.catchRadius);
  flow.speed = () => flow.parcels.reduce((m, p) => Math.max(m, p.moving ? Math.hypot(p.vx, p.vz) : 0), 0);
  return flow;
}

/** The marked Lawin faces: steep open slopes near a lift top whose fall line stays steep for 250 m. Deterministic from the data. */
export function findSpots({ lifts, farHeight, attrs, places = [], count = AVA.spots }) {
  const a = {};
  const cands = [];
  for (const l of lifts) {
    for (const r of [160, 320, 480]) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const x = l.top.x + Math.cos(ang) * r, z = l.top.z + Math.sin(ang) * r;
        const g = gradient(farHeight, x, z);
        if (g.deg < 33) continue;
        if (freshness(attrs(x, z, a)) < 0.6) continue;
        // walk down the fall line: steep and open for 250 m
        let px = x, pz = z, steep = 0, open = 0, n = 0;
        for (let s = 0; s < 250; s += 10) {
          const q = gradient(farHeight, px, pz);
          if (q.slope < 1e-4) break;
          px -= (q.gx / q.slope) * 10; pz -= (q.gz / q.slope) * 10; n++;
          if (q.deg >= 27) steep++;
          if (freshness(attrs(px, pz, a)) > 0.3) open++;
        }
        if (n < 25 || steep < 18 || open < 20) continue;
        // the safe spot: farther down until the slope eases (or 380 m)
        let sx = px, sz = pz;
        for (let s = 0; s < 260; s += 10) { const q = gradient(farHeight, sx, sz); if (q.deg < 18 || q.slope < 1e-4) break; sx -= (q.gx / q.slope) * 10; sz -= (q.gz / q.slope) * 10; }
        cands.push({ x, z, sx, sz, score: g.deg + steep * 0.6 + open * 0.2, lift: l });
      }
    }
  }
  cands.sort((p, q) => q.score - p.score || p.x - q.x || p.z - q.z);
  const out = [];
  for (const c of cands) {
    if (out.length >= count) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < AVA.spotSpacing)) continue;
    const g = gradient(farHeight, c.x, c.z);
    let near = null, nd = 3000;
    for (const p of places) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (p.name && d < nd) { nd = d; near = p; } }
    const base = `Lawin ${near ? near.name : c.lift.name}`, twice = out.filter((o) => o.name.startsWith(base)).length;
    out.push({ id: `lawin-${out.length + 1}`, lawin: true, x: c.x, z: c.z, heading: Math.atan2(-g.gz, -g.gx), safe: { x: c.sx, z: c.sz }, name: twice ? `${base} ${twice + 1}` : base, lift: c.lift.name });
  }
  return out;
}

/* ---------------- the view + the controller (browser) ---------------- */
/**
 * createAvalanches({ scene, field, surface, lifts (createLiftNet list), places, env, quality }) ->
 *   risk(state)            0..1 for the badge (0 off the danger slopes)
 *   check(state, dt, weather) -> release event | null (call while free riding; the caller shares it online and spawn()s it)
 *   spawn(ev, ageMs)       starts the flow (and runs it forward by its age)
 *   update(dt, camera, px, player) -> { caught } (player state, null while riding / paused)
 *   spots, spotAt(x, z)    the Lawin faces
 */
export function createAvalanches({ scene, field, surface, lifts, places, env, quality }) {
  const farHeight = (x, z) => field.farHeight(x, z);
  const a0 = {};
  const spots = findSpots({ lifts, farHeight, attrs: (x, z, o) => field.attrs(x, z, o), places });
  const flows = [];
  let cool = 0, checkT = 0, ids = 0;
  const PUFFS = quality && quality.spray < 80 ? 7 : 11;            // per parcel (Niddreg fewer)
  const NP = AVA.parcels * PUFFS * 2;                               // live puffs + the trailing dust
  // the cloud
  const pos = new Float32Array(NP * 3), size = new Float32Array(NP), alpha = new Float32Array(NP);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const pu = { uPx: { value: 1 }, uSunDir: env.u.uSunDir, uSunColor: env.u.uSunColor };
  const pmat = new THREE.ShaderMaterial({
    uniforms: pu, transparent: true, depthWrite: false,
    vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uPx; uniform vec3 uSunDir; varying float vA; varying float vBack;
      void main(){ vA = aAlpha; vec4 wp = modelMatrix * vec4(position, 1.0); vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
        vBack = pow(max(dot(normalize(wp.xyz - cameraPosition), uSunDir), 0.0), 5.0);
        gl_PointSize = min(uPx * aSize * 900.0 / max(-mv.z, 1.0), 512.0); }`,
    fragmentShader: `uniform vec3 uSunColor; varying float vA; varying float vBack;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0 || vA <= 0.0) discard;
        float lit = clamp(0.6 - c.y * 0.9, 0.0, 1.0);
        vec3 col = mix(vec3(0.7, 0.75, 0.85), vec3(1.0), lit) + uSunColor * vBack * 0.6;
        gl_FragColor = vec4(min(col, vec3(1.25)), exp(-r * 2.2) * vA); }`,
  });
  const cloud = new THREE.Points(pg, pmat);
  cloud.frustumCulled = false; cloud.renderOrder = 7; cloud.visible = false; cloud.name = 'ski-avalanche-cloud';
  // the tumbling slab blocks
  const BLOCKS = AVA.parcels * 2;
  const bgeo = new THREE.BoxGeometry(1.6, 0.45, 1.2);
  const bmat = new THREE.MeshLambertMaterial({ color: 0xf2f5fa });
  const blocks = new THREE.InstancedMesh(bgeo, bmat, BLOCKS);
  blocks.count = 0; blocks.frustumCulled = false; blocks.visible = false; blocks.name = 'ski-avalanche-slab';
  // the crown: a dark fracture line across the slope (one ribbon per avalanche, merged)
  const crownGeo = new THREE.BufferGeometry();
  const crownMat = new THREE.MeshBasicMaterial({ color: 0x5f6f8c, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.frustumCulled = false; crown.visible = false; crown.name = 'ski-avalanche-crown';
  scene.add(cloud, blocks, crown);
  // the warning signs at the Lawin faces: a pole with a yellow diamond (one instanced, vertex-coloured mesh)
  const signs = (() => {
    const parts = [
      [new THREE.CylinderGeometry(0.05, 0.06, 2.6, 5).translate(0, 1.3, 0), [0.15, 0.15, 0.17]],
      [new THREE.BoxGeometry(0.06, 0.95, 0.95).rotateX(Math.PI / 4).translate(0.04, 2.4, 0), [0.1, 0.1, 0.1]],
      [new THREE.BoxGeometry(0.07, 0.8, 0.8).rotateX(Math.PI / 4).translate(0.06, 2.4, 0), [0.98, 0.78, 0.1]],
      [new THREE.BoxGeometry(0.08, 0.32, 0.08).translate(0.1, 2.48, 0), [0.1, 0.1, 0.1]],
      [new THREE.BoxGeometry(0.08, 0.08, 0.08).translate(0.1, 2.22, 0), [0.1, 0.1, 0.1]],
      [new THREE.BoxGeometry(0.05, 0.05, 1.8).translate(0, 0.9, 0), [0.95, 0.4, 0.1]],
    ];
    const P = [], N = [], C = [];
    for (const [g, c] of parts) { const q = g.toNonIndexed(); const pa = q.attributes.position, na = q.attributes.normal; for (let i = 0; i < pa.count; i++) { P.push(pa.getX(i), pa.getY(i), pa.getZ(i)); N.push(na.getX(i), na.getY(i), na.getZ(i)); C.push(...c); } q.dispose(); g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, spots.length * 3));
    m.name = 'ski-lawin-signs'; m.castShadow = true;
    return m;
  })();
  function seatSigns() {
    const d = new THREE.Object3D();
    let k = 0;
    for (const s of spots) {
      // three signs across the top of the face, facing up the slope (whoever comes from above reads them)
      const ux = Math.cos(s.heading), uz = Math.sin(s.heading);
      for (const off of [-14, 0, 14]) {
        const x = s.x - uz * off - ux * 6, z = s.z + ux * off - uz * 6;
        d.position.set(x, surface.height(x, z) - 0.1, z); d.rotation.set(0, -s.heading + Math.PI, 0); d.updateMatrix();
        signs.setMatrixAt(k++, d.matrix);
      }
    }
    signs.count = k; signs.instanceMatrix.needsUpdate = true;
  }
  seatSigns();
  scene.add(signs);

  function risk(st) {
    if (!st || !st.grounded || st.ride) return 0;
    const n = {}; surface.normal(st.x, st.z, n);
    const deg = slopeDeg(n);
    if (deg < AVA.warn) return 0;
    const f = freshness(field.attrs(st.x, st.z, a0));
    return f * clamp((deg - AVA.warn) / (AVA.slope - AVA.warn), 0, 1);
  }
  /** A release on the crown above (x, z) along the fall line. */
  function releaseAt(x, z, seedSalt = 0) {
    const g = gradient(farHeight, x, z, 25);
    const ux = g.slope > 1e-4 ? -g.gx / g.slope : 1, uz = g.slope > 1e-4 ? -g.gz / g.slope : 0;
    ids++;
    const seed = (Math.imul(Math.round(x * 7) ^ Math.round(z * 13), 2654435761) ^ (Date.now() & 0xffff) ^ seedSalt) >>> 0;
    return { id: `a${Date.now().toString(36)}${ids}`, x: x - ux * AVA.above, z: z - uz * AVA.above, seed };
  }
  function check(st, dt, weather) {
    cool = Math.max(0, cool - dt);
    checkT += dt;
    if (checkT < AVA.every) return null;
    checkT = 0;
    if (cool > 0 || flows.length >= 2 || !st || !st.grounded || st.crash > 0 || st.ride || st.speed < AVA.minSpeed) return null;
    const n = {}; surface.normal(st.x, st.z, n);
    if (slopeDeg(n) < AVA.slope) return null;
    const f = freshness(field.attrs(st.x, st.z, a0));
    if (f < 0.5) return null;
    if (Math.random() > AVA.chance * f * (AVA.weather[weather] || 1)) return null;
    cool = AVA.cooldown;
    return releaseAt(st.x, st.z);
  }
  /** The Lawin challenge: the slab right behind the skier at the top of the face. */
  function forced(st) { cool = AVA.cooldown; return releaseAt(st.x, st.z, 0x5a5a); }

  const crownPts = [];
  function spawn(ev, ageMs = 0) {
    if (flows.some((f) => f.ev.id === ev.id)) return null;
    const f = createFlow(ev, farHeight);
    f.advance(Math.min(8, ageMs / 1000));
    f.trail = [];
    flows.push(f);
    // the crown: a jagged ribbon across the slope at the release
    const c = [];
    for (let i = 0; i <= 14; i++) {
      const u = (i / 14 - 0.5) * (AVA.width + 8), j = Math.sin(i * 2.3 + ev.seed) * 1.6;
      c.push([ev.x + f.across[0] * u + f.dir[0] * j, ev.z + f.across[1] * u + f.dir[1] * j]);
    }
    crownPts.push({ c, born: performance.now() });
    buildCrown();
    return f;
  }
  function buildCrown() {
    const P = [];
    for (const { c } of crownPts) {
      for (let i = 0; i + 1 < c.length; i++) {
        const [x0, z0] = c[i], [x1, z1] = c[i + 1];
        const y0 = surface.height(x0, z0) + 0.05, y1 = surface.height(x1, z1) + 0.05;
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1, nx = -dz / L * 0.6, nz = dx / L * 0.6;
        P.push(x0 - nx, y0, z0 - nz, x1 - nx, y1, z1 - nz, x1 + nx, y1, z1 + nz, x0 - nx, y0, z0 - nz, x1 + nx, y1, z1 + nz, x0 + nx, y0, z0 + nz);
      }
    }
    crownGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    crownGeo.computeBoundingSphere();
    crown.visible = P.length > 0;
  }
  const d3 = new THREE.Object3D();
  function update(dt, camera, px, player) {
    pu.uPx.value = px;
    let caught = false;
    for (let i = flows.length - 1; i >= 0; i--) {
      const f = flows[i];
      f.advance(dt);
      if (player && !caught && f.catches(player.x, player.z) && Math.abs(player.y - surface.height(player.x, player.z)) < 8) caught = true;
      f.tail = (f.tail || 0) + (f.done ? dt : 0);
      if (f.done && f.tail > 8) flows.splice(i, 1);
    }
    // crowns fade after 60 s
    const now = performance.now();
    if (crownPts.length && now - crownPts[0].born > 60000) { crownPts.shift(); buildCrown(); }
    // draw: puffs round each parcel (+ the dust behind it), blocks tumbling in the front
    let n = 0, b = 0;
    for (const f of flows) {
      const fade = f.done ? Math.max(0, 1 - f.tail / 8) : Math.min(1, f.age * 1.5);
      const R = rng(f.ev.seed ^ 0x9e37), Rb = rng(f.ev.seed ^ 0x51ed);
      for (const p of f.parcels) {
        const gy = surface.height(p.x, p.z);
        const v = Math.hypot(p.vx, p.vz), ux = v > 0.1 ? p.vx / v : f.dir[0], uz = v > 0.1 ? p.vz / v : f.dir[1];
        for (let k = 0; k < PUFFS && n < NP; k++) {
          const a = R() * Math.PI * 2, rr = R() * p.r * 0.8, back = R() * (2 + v * 0.6);
          const t = f.age * (0.6 + R()) + k;
          pos[n * 3] = p.x + Math.cos(a) * rr - ux * back; pos[n * 3 + 1] = gy + 0.5 + R() * p.r * (0.25 + Math.min(0.45, v / 40)) + Math.sin(t) * 0.3; pos[n * 3 + 2] = p.z + Math.sin(a) * rr - uz * back;
          size[n] = (2.5 + R() * 3.5) * (0.5 + Math.min(1, v / 12)) + (p.moving ? 0 : 1.5);
          alpha[n] = (p.moving ? 0.5 : 0.28) * fade;
          n++;
        }
        if (p.moving && b < BLOCKS && v > 3) {
          for (let k = 0; k < 2 && b < BLOCKS; k++) {
            const off = (Rb() - 0.5) * p.r, ph = f.age * (2 + Rb() * 3) + Rb() * 6;
            d3.position.set(p.x - uz * off + ux * Rb() * 3, gy + 0.3 + Math.abs(Math.sin(ph)) * 0.8, p.z + ux * off + uz * Rb() * 3);
            d3.rotation.set(ph, Rb() * 6, ph * 0.7); d3.scale.setScalar(0.6 + Rb() * 0.9); d3.updateMatrix();
            blocks.setMatrixAt(b++, d3.matrix);
          }
        }
      }
    }
    for (let i = n; i < NP; i++) alpha[i] = 0;
    pg.attributes.position.needsUpdate = true; pg.attributes.aSize.needsUpdate = true; pg.attributes.aAlpha.needsUpdate = true;
    pg.setDrawRange(0, n);
    cloud.visible = n > 0;
    blocks.count = b; blocks.visible = b > 0; blocks.instanceMatrix.needsUpdate = true;
    return { caught };
  }
  return {
    spots, risk, check, forced, spawn, update,
    spotAt: (x, z, r = 14) => spots.find((s) => Math.hypot(s.x - x, s.z - z) < r) || null,
    get active() { return flows.length; },
    flows,
    reseat() { seatSigns(); if (crownPts.length) buildCrown(); },
    dispose() { scene.remove(cloud, blocks, crown, signs); pg.dispose(); pmat.dispose(); bgeo.dispose(); bmat.dispose(); crownGeo.dispose(); crownMat.dispose(); },
  };
}
