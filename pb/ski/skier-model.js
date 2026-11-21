/* The skier: a stylised figure of our own (no brand, no likeness): helmet with goggles, a two-tone jacket with a stripe and collar, ski
 * trousers, chunky boots with buckles, gloves, poles with grips and baskets, shaped skis with turned-up tips and bindings. The outfit
 * colours are the player's choice (OUTFITS, saved in pb_ski_outfit).
 * pose() drives it from the physics state every frame with a small two-bone leg solve (the feet stay on the skis):
 *   carve   the body leans into the turn by the edge angle, the hips more than the shoulders (angulation), the inside leg bends more,
 *           the skis tip onto their edges; a pole plant when the turn changes side
 *   tuck    deep crouch, back flat, hands forward in front of the face, poles under the arms
 *   plough  tips together, tails out, knees in, a little back
 *   jump    knees pulled up at the top, arms out for balance; landing: a deep absorb
 *   crash   a tumble: rolls over and slides, skis and poles flailing, then lies still until the respawn
 * Niddreg: a soft blob shadow under the skis (setBlob); Mëttel / Héich: the skier casts a real shadow (shadows.js). The ghost is the same
 * figure, translucent. */
const THREE = window.THREE;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const THIGH = 0.46, SHIN = 0.46, ANKLE = 0.11;
const CRASH_S = 1.6;

/* jacket, accent (stripe, collar, gloves), trousers, helmet, skis */
export const OUTFITS = Object.freeze([
  { id: 'rout', name: 'Rout', jacket: 0xd23a2e, accent: 0xf4f1ea, trousers: 0x1f2a3a, helmet: 0xf3f3f1, ski: 0x2a5bd7 },
  { id: 'blo', name: 'Blo', jacket: 0x2c6fd6, accent: 0xf2c230, trousers: 0x1b1f26, helmet: 0x1d2530, ski: 0xe8e8e4 },
  { id: 'giel', name: 'Giel', jacket: 0xf2b21c, accent: 0x1b1d22, trousers: 0x2b2f36, helmet: 0x1b1d22, ski: 0xd23a2e },
  { id: 'greng', name: 'Gréng', jacket: 0x2f8f5b, accent: 0xf28a1c, trousers: 0x23262b, helmet: 0xf3f3f1, ski: 0xf28a1c },
  { id: 'rosa', name: 'Rosa', jacket: 0xe85d9c, accent: 0xffffff, trousers: 0x3b3f6e, helmet: 0xf6f2f4, ski: 0x6e4fd0 },
  { id: 'schwaarz', name: 'Schwaarz', jacket: 0x22252b, accent: 0xff6a1a, trousers: 0x22252b, helmet: 0xff6a1a, ski: 0x9aa3ad },
]);
const OUTFIT_KEY = 'pb_ski_outfit';
export function readOutfit() {
  try { const v = localStorage.getItem(OUTFIT_KEY); if (OUTFITS.some((o) => o.id === v)) return v; } catch (error) { console.warn('[ski] storage blocked', error); }
  return OUTFITS[0].id;
}
export function writeOutfit(id) {
  try { localStorage.setItem(OUTFIT_KEY, id); } catch (error) { console.warn('[ski] could not store the outfit', error); }
}

export function createSkierModel({ outfit = OUTFITS[0].id, ghost = false } = {}) {
  const mat = (color) => (ghost
    ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color }));
  const M = {
    jacket: mat(0xffffff), accent: mat(0xffffff), trousers: mat(0xffffff), helmet: mat(0xffffff), ski: mat(0xffffff),
    dark: mat(0x1b1d22), boot: mat(0x2b2e35), buckle: mat(0xb8bec7), lens: mat(0xf08a2a), skin: mat(0xe6b394), pole: mat(0xaab2bc), grip: mat(0x15171b),
  };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cap = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m);
  const cyl = (r0, r1, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  const root = new THREE.Group();            // feet position, heading (+x forward, +z right, +y up)
  const tilt = new THREE.Group();            // slope pitch
  const lean = new THREE.Group();            // roll into the turn (whole body)
  root.add(tilt); tilt.add(lean);

  // ---- skis: a shaped plank, a turned-up tip in two pieces, a small tail kick, the binding
  const skis = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const edge = new THREE.Group();          // the ski's own edge angle
    const body = box(1.62, 0.03, 0.085, M.ski); body.position.set(0.02, 0.015, 0);
    const tip1 = box(0.16, 0.03, 0.09, M.ski); tip1.position.set(0.88, 0.04, 0); tip1.rotation.z = 0.35;
    const tip2 = box(0.1, 0.03, 0.08, M.ski); tip2.position.set(0.97, 0.09, 0); tip2.rotation.z = 0.75;
    const tail = box(0.1, 0.03, 0.08, M.ski); tail.position.set(-0.82, 0.03, 0); tail.rotation.z = -0.25;
    const bind = box(0.36, 0.05, 0.075, M.dark); bind.position.set(0.0, 0.045, 0);
    edge.add(body, tip1, tip2, tail, bind);
    g.add(edge);
    g.position.z = side * 0.13;
    lean.add(g); skis.push({ g, edge });
  }
  // ---- legs: hip -> thigh -> knee -> shin -> boot (the boot stays level on the ski)
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    const thigh = cap(0.088, THIGH - 0.1, M.trousers); thigh.position.y = -THIGH / 2;
    const knee = new THREE.Group(); knee.position.y = -THIGH;
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), M.trousers);
    const shin = cap(0.078, SHIN - 0.14, M.trousers); shin.position.y = -SHIN / 2;
    const ankle = new THREE.Group(); ankle.position.y = -SHIN;
    const boot = box(0.29, 0.12, 0.115, M.boot); boot.position.set(0.04, -0.05, 0);
    const cuff = box(0.15, 0.18, 0.12, M.boot); cuff.position.set(-0.01, 0.06, 0);
    const b1 = box(0.018, 0.025, 0.124, M.buckle); b1.position.set(0.06, 0.0, 0);
    const b2 = box(0.018, 0.025, 0.124, M.buckle); b2.position.set(0.0, 0.1, 0);
    ankle.add(boot, cuff, b1, b2);
    knee.add(kneePad, shin, ankle); hip.add(thigh, knee);
    lean.add(hip); legs.push({ hip, knee, ankle, side });
  }
  // ---- torso: pelvis, jacket (wider at the shoulders), stripe, zip, collar, helmet + goggles
  const torso = new THREE.Group();
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.trousers); pelvis.position.y = 0.04; pelvis.scale.set(0.15, 0.12, 0.18);
  const chest = cap(0.18, 0.3, M.jacket); chest.position.y = 0.32; chest.scale.set(0.82, 1, 1.18);
  const shoulders = box(0.22, 0.14, 0.5, M.jacket); shoulders.position.y = 0.5;
  const stripe = box(0.31, 0.05, 0.43, M.trousers); stripe.position.y = 0.36;
  const yoke = box(0.3, 0.12, 0.47, M.accent); yoke.position.y = 0.52; yoke.scale.set(1, 1, 1);
  const hem = box(0.3, 0.06, 0.4, M.jacket); hem.position.y = 0.1;
  const collar = cyl(0.11, 0.13, 0.1, M.accent); collar.position.y = 0.6;
  const neck = new THREE.Group(); neck.position.y = 0.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), M.helmet); helmet.position.y = 0.13;
  const shell = cyl(0.152, 0.15, 0.08, M.helmet, 14); shell.position.y = 0.1;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), M.skin); face.position.set(0.03, 0.06, 0);
  const strap = box(0.16, 0.045, 0.31, M.dark); strap.position.set(0.0, 0.13, 0);
  const lens = box(0.05, 0.075, 0.24, M.lens); lens.position.set(0.13, 0.13, 0);
  neck.add(face, shell, helmet, strap, lens);
  torso.add(pelvis, chest, shoulders, yoke, stripe, hem, collar, neck);
  // ---- arms: shoulder -> upper arm -> elbow -> forearm, glove, pole (grip, shaft, basket)
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0, 0.52, side * 0.26);
    const upper = cap(0.062, 0.2, M.jacket); upper.position.y = -0.15;
    const elbow = new THREE.Group(); elbow.position.y = -0.3;
    const fore = cap(0.056, 0.17, M.jacket); fore.position.y = -0.13;
    const cuffA = cyl(0.064, 0.064, 0.05, M.accent); cuffA.position.y = -0.24;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M.accent); glove.position.y = -0.3; glove.scale.set(1, 1.15, 0.9);
    const pole = new THREE.Group(); pole.position.y = -0.3;
    const grip = cyl(0.026, 0.026, 0.14, M.grip, 6);
    const shaft = cyl(0.011, 0.009, 1.12, M.pole, 5); shaft.position.y = -0.62;
    const basket = cyl(0.05, 0.05, 0.012, M.dark, 8); basket.position.y = -1.1;
    pole.add(grip, shaft, basket);
    elbow.add(fore, cuffA, glove, pole); sh.add(upper, elbow);
    torso.add(sh); arms.push({ sh, elbow, pole, side });
  }
  lean.add(torso);
  // blob shadow (Niddreg)
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x33405e, alphaMap: blobTex, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  blob.scale.set(1.25, 1, 0.55);
  blob.visible = false;
  blob.renderOrder = 3;
  // one draw call per bone: the parts of each group are merged into a single vertex-coloured mesh (slot per vertex, so the outfit can
  // be recoloured); ~16 draw calls for the whole figure instead of ~50
  const SLOTS = Object.keys(M);
  const slotOf = new Map(SLOTS.map((k, i) => [M[k], i]));
  const shared = ghost ? new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  const merged = [];
  const groups = [];
  root.traverse((o) => { if (o.isGroup || o === root) groups.push(o); });
  for (const g of groups) {
    const kids = g.children.filter((c) => c.isMesh);
    if (!kids.length) continue;
    const pos = [], nrm = [], idx = [], slots = [];
    let base = 0;
    for (const m of kids) {
      m.updateMatrix();
      const geo = m.geometry.clone().applyMatrix4(m.matrix);
      const P = geo.attributes.position, N = geo.attributes.normal, sl = slotOf.get(m.material) || 0;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); slots.push(sl); }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(geo.index.getX(i) + base);
      else for (let i = 0; i < P.count; i++) idx.push(base + i);
      base += P.count;
      g.remove(m); m.geometry.dispose(); geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
    geo.setIndex(idx);
    geo.userData.slots = Uint8Array.from(slots);
    const mesh = new THREE.Mesh(geo, shared);
    mesh.castShadow = !ghost; mesh.receiveShadow = !ghost; mesh.frustumCulled = false;
    g.add(mesh);
    merged.push(mesh);
  }
  function recolour() {
    for (const mesh of merged) {
      const col = mesh.geometry.attributes.color, sl = mesh.geometry.userData.slots;
      for (let i = 0; i < sl.length; i++) { const c = M[SLOTS[sl[i]]].color; col.setXYZ(i, c.r, c.g, c.b); }
      col.needsUpdate = true;
    }
  }
  blob.castShadow = false; blob.receiveShadow = false;
  if (ghost) root.renderOrder = 5;
  const group = new THREE.Group();
  group.add(root, blob);

  function setOutfit(id) {
    const o = OUTFITS.find((x) => x.id === id) || OUTFITS[0];
    M.jacket.color.setHex(o.jacket); M.accent.color.setHex(o.accent); M.trousers.color.setHex(o.trousers); M.helmet.color.setHex(o.helmet);
    M.ski.color.setHex(ghost ? 0x9ad1ff : o.ski);
    if (ghost) for (const k of ['jacket', 'accent', 'trousers', 'helmet']) M[k].color.lerp(new THREE.Color(0x9ad1ff), 0.5);
    if (merged.length) recolour();
  }
  setOutfit(outfit);
  recolour();

  /** Two-bone leg: hip at height h above the ankle; returns [hip angle (forward), knee bend, hip x offset]. */
  function solveLeg(h) {
    const d = clamp(h, 0.35, THIGH + SHIN - 0.02);
    const a1 = Math.acos(clamp((d * d + THIGH * THIGH - SHIN * SHIN) / (2 * d * THIGH), -1, 1));
    const kb = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
    return [a1, kb];
  }

  const tmp = { x: 0, y: 1, z: 0 };
  const qN = new THREE.Quaternion(), qH = new THREE.Quaternion(), nv = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);
  let lastEdge = 0, plant = 0, plantSide = 1, prevT = 0, smEdge = 0, smCrouch = 0, smPlough = 0, smAir = 0;
  /** state = physics state; normal(x, z, out) = slope normal; t = time (s); ground(x, z) = snow height (for the blob in the air). */
  function pose(state, normal, t, ground) {
    const dt = clamp(t - prevT, 0, 0.1); prevT = t;
    const k = 1 - Math.exp(-dt * 12);
    root.position.set(state.x, state.y, state.z);
    root.rotation.set(0, -state.heading, 0);
    normal(state.x, state.z, tmp);
    const fx = Math.cos(state.heading), fz = Math.sin(state.heading);
    const along = tmp.x * fx + tmp.z * fz;                          // > 0 when the slope falls away ahead
    const across = -tmp.x * fz + tmp.z * fx;
    tilt.rotation.set(0, 0, -Math.atan2(along, tmp.y) * (state.grounded ? 1 : 0.4));
    // smoothed drivers
    smEdge += (clamp(state.edge, -1.1, 1.1) - smEdge) * k;
    const landing = state.landed > 0 ? Math.sin(Math.min(1, state.landed / 0.35) * Math.PI) : 0;
    smCrouch += (clamp(state.tuck * 0.95 + landing * 0.8, 0, 1) - smCrouch) * k;
    smPlough += (clamp(state.brake, 0, 1) - smPlough) * k;
    smAir += ((state.grounded ? 0 : Math.min(1, state.air * 2.5)) - smAir) * k;
    const edge = smEdge, crouch = smCrouch, plough = smPlough, air = smAir;
    // pole plant when the turn changes side at speed
    if (Math.sign(edge) !== Math.sign(lastEdge) && Math.abs(edge) > 0.15 && state.speed > 4 && state.grounded) { plant = 1; plantSide = edge > 0 ? 1 : -1; }
    lastEdge = Math.abs(edge) > 0.15 ? edge : lastEdge;
    plant = Math.max(0, plant - dt * 2.6);
    // whole-body lean into the turn (and the slope's own side tilt), skis on edge
    lean.rotation.set(edge * 0.62 + Math.atan2(across, tmp.y) * 0.2 * (state.grounded ? 1 : 0), 0, 0);
    const skiEdge = edge * 0.45;
    // legs
    const baseH = 0.88 - crouch * 0.36 - plough * 0.05;       // athletic stance: knees and ankles flexed
    const tuckAir = air * (1 - crouch) * 0.22;              // knees pulled up in the air
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const inside = Math.sign(edge) === L.side ? 1 : 0;     // the leg on the inside of the turn (edge > 0: turning right, the right leg)
      const h = baseH - inside * Math.abs(edge) * 0.2 - tuckAir;
      const [a1, kb] = solveLeg(h - ANKLE);
      const hipX = -(THIGH * Math.sin(a1) + SHIN * Math.sin(a1 - kb));
      L.hip.position.set(hipX, h, L.side * (0.11 + plough * 0.15 + (state.speed < 5 && state.grounded && !plough ? 0.03 : 0)));
      L.hip.rotation.set(L.side * plough * 0.12, 0, a1);
      L.knee.rotation.set(-L.side * plough * 0.18, 0, -kb);
      L.ankle.rotation.set(0, 0, -(a1 - kb));
      const sk = skis[i];
      sk.g.position.set(0, (h - ANKLE) - (THIGH * Math.cos(a1) + SHIN * Math.cos(a1 - kb)) + 0.0, L.side * (0.13 + plough * 0.2));
      sk.g.rotation.set(0, L.side * plough * 0.32, 0);
      sk.edge.rotation.set(skiEdge + L.side * plough * 0.18, 0, air * 0.12);
    }
    // torso: forward bend with the crouch, counter-roll against the lean (angulation), a little back in the plough
    const hipY = baseH - Math.abs(edge) * 0.1 - tuckAir;
    const [ta1, tkb] = solveLeg(hipY - ANKLE);
    const pelvisX = -(THIGH * Math.sin(ta1) + SHIN * Math.sin(ta1 - tkb));
    torso.position.set(pelvisX, hipY, 0);
    torso.rotation.set(-edge * 0.32, 0, -(0.22 + crouch * 0.95 - plough * 0.08 + air * 0.1));
    neck.rotation.set(edge * 0.15, 0, 0.25 + crouch * 0.75);          // keep the eyes on the slope ahead
    // arms: forward and out; tuck: hands in front of the face, poles back under the arms; air: wide; plant: the inside pole reaches forward
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      const p = plant * (A.side === plantSide ? 1 : 0);
      A.sh.rotation.set(-A.side * (0.18 + air * 0.7 + plough * 0.1 - crouch * 0.12), 0, 0.55 + crouch * 1.05 + p * 0.45 + air * 0.25);
      A.elbow.rotation.set(0, 0, 0.55 + crouch * 0.85 - air * 0.3 + Math.sin(t * 2.6 + i) * 0.02);
      A.pole.rotation.set(A.side * 0.12, 0, -(0.95 + crouch * 1.25) + p * 0.75);       // poles trail back, tips near the snow
    }
    // crash: roll over and slide, then lie still
    if (state.crash > 0) {
      const ct = CRASH_S - state.crash;                         // 0 .. 1.6 s since the fall
      const tumbling = ct < 0.85;
      // first a cartwheel over the shoulder (lifted clear of the snow), then lying face down the slope, sliding to a stop
      lean.rotation.set(tumbling ? ct * 8.4 : 0.35, 0, 0);
      tilt.rotation.set(0, Math.sin(ct * 5) * 0.4 * Math.exp(-ct), tumbling ? -0.6 : -1.38);
      for (const A of arms) { A.sh.rotation.set(-A.side * (1.3 + Math.sin(ct * 11 + A.side) * 0.5), 0, 1.6); A.pole.rotation.z = -0.4 + Math.sin(ct * 9) * 0.8; }
      for (let i = 0; i < 2; i++) skis[i].g.rotation.set(Math.sin(ct * 13 + i) * 0.5, (i ? 0.5 : -0.4) * Math.min(1, ct * 3), 0);
      root.position.y += tumbling ? 0.75 * Math.sin(Math.min(1, ct / 0.85) * Math.PI) + 0.25 : 0.3;
    }
    // blob under the skis
    if (blob.visible) {
      const gy = ground ? ground(state.x, state.z) : state.y;
      blob.position.set(state.x, gy + 0.06, state.z);
      qN.setFromUnitVectors(Y_AXIS, nv.set(tmp.x, tmp.y, tmp.z));          // lie on the slope
      qH.setFromAxisAngle(Y_AXIS, -state.heading);
      blob.quaternion.copy(qN).multiply(qH);
      const up = clamp(state.y - gy, 0, 6);
      blob.material.opacity = 0.38 * (1 - up / 7);
      blob.scale.set(1.25 * (1 + up * 0.08), 1, 0.55 * (1 + up * 0.08));
    }
  }
  return { root: group, pose, setOutfit, setBlob(on) { blob.visible = !!on && !ghost; }, setVisible(v) { group.visible = v; } };
}
