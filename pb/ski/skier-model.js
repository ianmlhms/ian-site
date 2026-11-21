/* The skier: a small low-poly figure of our own (no brand, no likeness): helmet, goggles, jacket, trousers, gloves, poles and skis.
 * pose() sets it from the physics state each frame: skis follow the slope, the body leans into the turn (edge), crouches in the tuck,
 * pushes the ski tails out in the snowplough, spreads the arms in the air and tumbles in a crash. The ghost is the same figure, translucent. */
const THREE = window.THREE;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createSkierModel({ jacket = 0xd8392f, trousers = 0x22303f, helmet = 0xf2f2f2, ghost = false } = {}) {
  const mat = (color) => (ghost
    ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color }));
  const M = { jacket: mat(jacket), trousers: mat(trousers), helmet: mat(helmet), dark: mat(0x1b1d22), ski: mat(ghost ? 0x9ad1ff : 0x2a5bd7), goggle: mat(0xf2a33a), skin: mat(0xe8b796), pole: mat(0x9aa3ad) };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cap = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), m);
  const root = new THREE.Group();            // feet position, heading
  const tilt = new THREE.Group();            // slope pitch
  const lean = new THREE.Group();            // roll into the turn
  root.add(tilt); tilt.add(lean);
  // skis (along +x = forward)
  const skis = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const s = box(1.7, 0.035, 0.1, M.ski); s.position.set(0.05, 0.02, 0);
    const tip = box(0.18, 0.035, 0.1, M.ski); tip.position.set(0.93, 0.06, 0); tip.rotation.z = 0.45;
    g.add(s, tip);
    g.position.z = side * 0.14;
    lean.add(g); skis.push(g);
  }
  // legs: boot, shin, thigh per side, hinged at the knee
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.92, side * 0.13);
    const thigh = cap(0.085, 0.34, M.trousers); thigh.position.y = -0.23;
    const knee = new THREE.Group(); knee.position.y = -0.46;
    const shin = cap(0.075, 0.32, M.trousers); shin.position.y = -0.2;
    const boot = box(0.3, 0.2, 0.15, M.dark); boot.position.set(0.04, -0.4, 0);
    knee.add(shin, boot); hip.add(thigh, knee);
    lean.add(hip); legs.push({ hip, knee });
  }
  const torso = new THREE.Group(); torso.position.y = 0.92;
  const body = cap(0.17, 0.32, M.jacket); body.position.y = 0.3; body.scale.set(0.85, 1, 1.15);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), M.trousers); belt.position.y = 0.06; belt.scale.set(0.85, 1, 1.15);
  const neck = new THREE.Group(); neck.position.y = 0.62;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), M.helmet); head.position.y = 0.14;
  const face = box(0.06, 0.08, 0.22, M.goggle); face.position.set(0.12, 0.13, 0);
  const chin = box(0.04, 0.06, 0.12, M.skin); chin.position.set(0.12, 0.03, 0);
  neck.add(head, face, chin);
  torso.add(body, belt, neck);
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0, 0.52, side * 0.25);
    const upper = cap(0.06, 0.24, M.jacket); upper.position.y = -0.17;
    const elbow = new THREE.Group(); elbow.position.y = -0.34;
    const fore = cap(0.055, 0.2, M.jacket); fore.position.y = -0.15;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), M.dark); glove.position.y = -0.31;
    const pole = box(0.022, 1.2, 0.022, M.pole); pole.position.set(-0.16, -0.82, 0); pole.rotation.z = 0.32;
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8), M.dark); basket.position.set(-0.32, -1.3, 0);
    elbow.add(fore, glove, pole, basket); sh.add(upper, elbow);
    torso.add(sh); arms.push({ sh, elbow });
  }
  lean.add(torso);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  if (ghost) root.renderOrder = 5;

  const tmp = { x: 0, y: 1, z: 0 };
  let tumble = 0;
  /** state = physics state; normal(x, z, out) = slope normal; t = time (s). */
  function pose(state, normal, t) {
    root.position.set(state.x, state.y, state.z);
    root.rotation.y = -state.heading;
    normal(state.x, state.z, tmp);
    const fx = Math.cos(state.heading), fz = Math.sin(state.heading);
    const along = tmp.x * fx + tmp.z * fz;                          // > 0 when the slope falls away ahead
    tilt.rotation.z = -Math.atan2(along, tmp.y) * (state.grounded ? 1 : 0.4);   // nose down the slope
    const edge = clamp(state.edge, -1.1, 1.1);
    lean.rotation.x = edge * 0.6;                                    // local +z is the skier's right: a right turn leans right
    const crouch = clamp(state.tuck * 0.9 + (state.landed > 0 ? state.landed * 1.4 : 0), 0, 1);
    const plough = state.brake;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const L = legs[i];
      L.hip.position.y = 0.92 - crouch * 0.32;
      L.hip.rotation.z = 0.25 + crouch * 0.85;
      L.knee.rotation.z = -0.4 - crouch * 1.35;
      L.hip.position.z = side * (0.13 + plough * 0.12);
      skis[i].rotation.y = side * plough * 0.28;
      skis[i].position.z = side * (0.14 + plough * 0.12);
    }
    torso.position.y = 0.92 - crouch * 0.32;
    torso.rotation.z = -(0.18 + crouch * 0.75);
    const airArms = state.grounded ? 0 : Math.min(1, state.air * 3);
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      arms[i].sh.rotation.z = 0.5 + crouch * 0.9 - airArms * 0.3;
      arms[i].sh.rotation.x = -side * (0.12 + airArms * 0.6 + plough * 0.15);
      arms[i].elbow.rotation.z = 0.7 + crouch * 0.5 + Math.sin(t * 3 + i) * 0.03;
    }
    if (state.crash > 0) {
      tumble += 0.12;
      lean.rotation.x = Math.sin(tumble) * 1.2;
      tilt.rotation.z = -1.2;
    } else tumble = 0;
  }
  return { root, pose, setVisible(v) { root.visible = v; } };
}
