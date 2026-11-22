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
  // round 4A: unlocked by the total of stars over all resorts (modes/challenges.js outfitOpen)
  { id: 'neon', name: 'Neon', jacket: 0xc6f01e, accent: 0xff2e88, trousers: 0x1b1d22, helmet: 0xff2e88, ski: 0xc6f01e, stars: 10 },
  { id: 'retro', name: 'Retro', jacket: 0x6a3fb5, accent: 0x31c4c9, trousers: 0xf0e6d2, helmet: 0xf0e6d2, ski: 0xf2a21c, stars: 30 },
  { id: 'gold', name: 'Gold', jacket: 0xd9a520, accent: 0x1b1d22, trousers: 0x1b1d22, helmet: 0xe8c25a, ski: 0x1b1d22, stars: 60 },
  { id: 'weltcup', name: 'Weltcup', jacket: 0xffffff, accent: 0xd0352c, trousers: 0xd0352c, helmet: 0xd0352c, ski: 0xffffff, stars: 120 },
]);
const OUTFIT_KEY = 'pb_ski_outfit';
export function readOutfit() {
  try { const v = localStorage.getItem(OUTFIT_KEY); if (OUTFITS.some((o) => o.id === v)) return v; } catch (error) { console.warn('[ski] storage blocked', error); }
  return OUTFITS[0].id;
}
export function writeOutfit(id) {
  try { localStorage.setItem(OUTFIT_KEY, id); } catch (error) { console.warn('[ski] could not store the outfit', error); }
}

export function createSkierModel({ outfit = OUTFITS[0].id, ghost = false, skinned = false } = {}) {
  let skiLookOf = null;                      // round 6: set once setSki exists (the outfit no longer picks the ski colour then)
  const mat = (color) => (ghost
    ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color }));
  const M = {
    jacket: mat(0xffffff), accent: mat(0xffffff), trousers: mat(0xffffff), helmet: mat(0xffffff), ski: mat(0xffffff),
    dark: mat(0x1b1d22), boot: mat(0x2b2e35), buckle: mat(0xb8bec7), lens: mat(0xf08a2a), skin: mat(0xe6b394), pole: mat(0xaab2bc), grip: mat(0x15171b),
    // round 6: the ski type's look (modes/skis.js): the tip colour and one top-sheet pattern (the others take the base colour)
    skiTip: mat(0xffffff), artStripe: mat(0xffffff), artChevron: mat(0xffffff), artRace: mat(0xffffff), artDots: mat(0xffffff), artZigzag: mat(0xffffff),
  };
  const ART = { stripe: 'artStripe', chevron: 'artChevron', race: 'artRace', dots: 'artDots', zigzag: 'artZigzag' };
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
    tip1.material = M.skiTip; tip2.material = M.skiTip;
    edge.add(body, tip1, tip2, tail, bind);
    // top-sheet patterns (round 6), a hair above the ski: only the ski type's own pattern is coloured, the rest blend into the base
    const art = (w, d, m, x, z = 0, yaw = 0) => { const a = box(w, 0.004, d, m); a.position.set(x, 0.032, z); a.rotation.y = yaw; edge.add(a); };
    art(1.05, 0.022, M.artStripe, -0.05);
    for (const x of [0.5, 0.3, -0.45, -0.65]) { art(0.11, 0.02, M.artChevron, x, 0.018, 0.7); art(0.11, 0.02, M.artChevron, x, -0.018, -0.7); }
    art(1.3, 0.012, M.artRace, 0.02, 0.03); art(1.3, 0.012, M.artRace, 0.02, -0.03); art(0.16, 0.06, M.artRace, 0.55);
    for (const x of [0.62, 0.42, 0.22, -0.3, -0.5, -0.7]) art(0.045, 0.045, M.artDots, x, (x * 10) % 2 > 1 ? 0.018 : -0.018);
    for (let i = 0; i < 6; i++) art(0.13, 0.018, M.artZigzag, 0.62 - i * 0.24 + (i > 2 ? -0.2 : 0), 0, i % 2 ? 0.55 : -0.55);
    // the twin tip: a second turned-up tail (park ski), its own group so it can be switched off
    const twin = new THREE.Group();
    const tw1 = box(0.16, 0.03, 0.09, M.skiTip); tw1.position.set(-0.88, 0.04, 0); tw1.rotation.z = -0.35;
    const tw2 = box(0.1, 0.03, 0.08, M.skiTip); tw2.position.set(-0.97, 0.09, 0); tw2.rotation.z = -0.75;
    twin.add(tw1, tw2); twin.visible = false;
    edge.add(twin);
    g.add(edge);
    g.position.z = side * 0.13;
    lean.add(g); skis.push({ g, edge, twin, tail });
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
  const arms = [], poles = [];
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
    poles.push(pole);
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
  // R8b (Niddreg draw calls, D's note): skinned = the per-bone meshes become ONE skinned mesh (bones = their groups, bind identity, like
  // net/remotes.js createRemoteFigure): 1 draw call (+1 shadow) instead of ~16. A hidden group (poles in a cabin, the twin tips, first
  // person: all but the gear) gets a zero bone matrix, so its vertices collapse (no fragments). The per-bone meshes stay for remotes.js.
  let skin = null;
  if (skinned && merged.length) {
    const bones = merged.map((m) => m.parent);
    const pos = [], nrm = [], si = [], sw = [], idx = [], slots = [];
    let base = 0;
    merged.forEach((m, bi) => {
      const g = m.geometry, P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0); slots.push(g.userData.slots[i]); }
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
      base += P.count;
      m.visible = false;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(slots.length * 3), 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    geo.userData.slots = Uint8Array.from(slots);
    const I = new THREE.Matrix4();
    const mesh = new THREE.SkinnedMesh(geo, shared);
    mesh.name = ghost ? 'ski-ghost-figure' : 'ski-skier-figure';
    const skeleton = new THREE.Skeleton(bones, bones.map(() => I.clone()));
    mesh.bind(skeleton, I);
    mesh.frustumCulled = false; mesh.castShadow = !ghost; mesh.receiveShadow = !ghost;
    if (!ghost) mesh.renderOrder = 2;                                     // after the snow decals (drag tracks)
    // a bone counts as hidden when it or any group above it (up to the root) is invisible, or (first person) it is not gear
    const up = bones.map((b) => { const chain = []; for (let o = b; o && o !== root; o = o.parent) chain.push(o); return chain; });
    const update = skeleton.update.bind(skeleton);
    skeleton.update = () => {
      update();
      const M = skeleton.boneMatrices;
      for (let i = 0; i < bones.length; i++) {
        const hidden = (skin && skin.fp && !gearGroups.has(bones[i])) || up[i].some((o) => !o.visible);
        if (hidden) M.fill(0, i * 16, i * 16 + 16);
      }
    };
    root.add(mesh);
    skin = { mesh, fp: false };
    merged.push(mesh);                   // recolour() paints it too (the hidden per-bone meshes keep their colours as well)
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
    outfit = o.id;
    M.jacket.color.setHex(o.jacket); M.accent.color.setHex(o.accent); M.trousers.color.setHex(o.trousers); M.helmet.color.setHex(o.helmet);
    M.ski.color.setHex(ghost ? 0x9ad1ff : skiLookOf ? skiLookOf().base : o.ski);
    if (ghost) for (const k of ['jacket', 'accent', 'trousers', 'helmet']) M[k].color.lerp(new THREE.Color(0x9ad1ff), 0.5);
    if (merged.length) recolour();
  }
  setOutfit(outfit);
  /** Round 6: the ski type's look { base, art, tip, length, width, twin, pattern } (modes/skis.js SKI_TYPES). */
  let skiLook = null;
  function setSki(look) {
    skiLook = look || null;
    const base = ghost ? 0x9ad1ff : look ? look.base : (OUTFITS.find((x) => x.id === outfit) || OUTFITS[0]).ski;
    M.ski.color.setHex(base);
    M.skiTip.color.setHex(look && !ghost ? look.tip : base);
    for (const [pat, key] of Object.entries(ART)) M[key].color.setHex(look && !ghost && look.pattern === pat ? look.art : base);
    for (const sk of skis) {
      sk.edge.scale.set(look ? look.length : 1, 1, look ? look.width : 1);
      sk.twin.visible = !!(look && look.twin);
    }
    if (merged.length) recolour();
  }
  setSki(null);
  skiLookOf = () => skiLook || { base: (OUTFITS.find((x) => x.id === outfit) || OUTFITS[0]).ski };
  recolour();

  let gearHidden = false;
  /** Seated (chair lift): the root is the seat under the pelvis; thighs forward, shins hanging, skis dangling, hands on the bar. */
  function poseSit(t) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0); lean.rotation.set(0, 0, 0);
    const swing = Math.sin(t * 1.3) * 0.05;
    for (let i = 0; i < 2; i++) {
      const L = legs[i], sk = skis[i];
      const shin = 0.22 + swing * (i ? 1 : -1);
      L.hip.position.set(0, 0.1, L.side * 0.12);
      L.hip.rotation.set(0, 0, Math.PI / 2);
      L.knee.rotation.set(0, 0, -(Math.PI / 2 - shin));
      L.ankle.rotation.set(0, 0, -shin);
      const ax = THIGH + SHIN * Math.sin(shin), ay = 0.1 - SHIN * Math.cos(shin);
      sk.g.position.set(ax, ay - ANKLE, L.side * 0.13);
      sk.g.rotation.set(0, 0, 0);
      sk.edge.rotation.set(0, 0, -0.28 + swing);
    }
    torso.position.set(-0.04, 0.1, 0);
    torso.rotation.set(0, 0, 0.08);
    neck.rotation.set(0, Math.sin(t * 0.4) * 0.25, -0.05);
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      A.sh.rotation.set(-A.side * 0.12, 0, 1.0);
      A.elbow.rotation.set(0, 0, 0.55);
      A.pole.rotation.set(A.side * 0.1, 0, -1.45);
    }
  }
  /** Standing in a cabin or a carriage: upright, looking out; round 7: the skis are carried, upright beside him in the right hand
   *  (tips up, bases together), the poles stay hidden (they would poke through the floor). */
  function poseStand(t) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0); lean.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, -0.04);
    neck.rotation.set(0, Math.sin(t * 0.35) * 0.35, 0.05);
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      if (A.side > 0) { A.sh.rotation.set(-0.32, 0, 0.42); A.elbow.rotation.set(0, 0, 0.95); }      // the right hand round the skis
      else { A.sh.rotation.set(0.1, 0, 0.12); A.elbow.rotation.set(0, 0, 0.35); }
    }
    for (let i = 0; i < 2; i++) {
      const sk = skis[i];
      sk.g.position.set(0.3, 0.9, 0.4 + i * 0.05);
      sk.g.rotation.set(0, 0, Math.PI / 2 - 0.05);
      sk.edge.rotation.set(Math.PI / 2, 0, 0);
    }
  }
  /** R7-B: walking with the skis on the right shoulder (boarding a cabin, in it, out of the top station); walk = metres walked (gait). */
  function poseCarry(t, walk) {
    poseStand(t);
    const ph = walk * 2.6;
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const sw = walk > 0 ? Math.sin(ph + (i ? Math.PI : 0)) * 0.38 : 0;
      L.hip.rotation.z += sw;
      L.knee.rotation.z -= walk > 0 ? Math.max(0, -Math.sin(ph + (i ? Math.PI : 0))) * 0.5 : 0;
      L.ankle.rotation.z -= sw * 0.6;
      // the skis on the shoulder, base to base, tips forward and up
      const sk = skis[i];
      sk.g.position.set(0.02, 1.52 + i * 0.03, 0.2 + i * 0.035);
      sk.g.rotation.set(0, 0, 0.5);
      sk.edge.rotation.set(1.5, 0, 0);
    }
    root.position.y += walk > 0 ? Math.abs(Math.sin(ph)) * 0.035 : 0;
    const A = arms.find((a) => a.side > 0) || arms[1];
    A.sh.rotation.set(-0.25, 0, 2.35);                 // the right hand up on the skis
    A.elbow.rotation.set(0, 0, 1.75);
    const B = arms.find((a) => a !== A);
    B.pole.rotation.set(0.05, 0, -0.1);                 // the poles in the other hand, pointing down
  }
  /** Pulled up a drag lift (round 7): STANDING upright in the track, leaning back a little against the bar, both skis flat on the
   *  snow along the slope (the body does not tilt with the slope: that looked like sitting), knees soft, a small sideways wobble; one hand
   *  on the bar's pole, the poles in the other hand. slopePitch = the track's pitch (rad, + = climbing). */
  function poseDrag(t, slopePitch) {
    tilt.rotation.set(0, 0, 0); tilt.position.set(0, 0, 0);
    lean.rotation.set(Math.sin(t * 1.7) * 0.03, 0, 0);
    for (let i = 0; i < 2; i++) {
      const L = legs[i], sk = skis[i];
      const [a1, kb] = solveLeg(0.84 - ANKLE);
      const hipX = -(THIGH * Math.sin(a1) + SHIN * Math.sin(a1 - kb));
      L.hip.position.set(hipX - 0.04, 0.84, L.side * 0.12);
      L.hip.rotation.set(0, 0, a1); L.knee.rotation.set(0, 0, -kb); L.ankle.rotation.set(0, 0, -(a1 - kb) + slopePitch);
      sk.g.position.set(0, 0.84 - ANKLE - (THIGH * Math.cos(a1) + SHIN * Math.cos(a1 - kb)), L.side * 0.13);
      sk.g.rotation.set(0, 0, slopePitch);
      sk.edge.rotation.set(0, 0, 0);
    }
    torso.position.set(-0.08, 0.84, 0);
    torso.rotation.set(0, 0, 0.12);                          // leaning back against the bar
    neck.rotation.set(0, 0, -0.05);
    const A = arms[1];
    // R8 (early QA: the hand was raised over the head): the hand holds the bar's stem at chest height, the ski pole hangs down from it
    A.sh.rotation.set(-0.3, 0, 0.85);
    A.elbow.rotation.set(0, 0, 1.0);
    A.pole.rotation.set(0.1, 0, -1.6);
    const B = arms[0];
    B.sh.rotation.set(0.15, 0, 0.35); B.elbow.rotation.set(0, 0, 0.5); B.pole.rotation.set(-0.1, 0, -0.6);
  }

  /** Two-bone leg: hip at height h above the ankle; returns [hip angle (forward), knee bend, hip x offset]. */
  function solveLeg(h) {
    const d = clamp(h, 0.35, THIGH + SHIN - 0.02);
    const a1 = Math.acos(clamp((d * d + THIGH * THIGH - SHIN * SHIN) / (2 * d * THIGH), -1, 1));
    const kb = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
    return [a1, kb];
  }

  /* round 7: one leg from its hip height (lean frame) with its foot lifted by legLift[i] (the terrain IK below): the hip stays, the knee
   * bends more, the ski rises; the skis never cut into the snow when the body leans into a carve */
  const legH = [0.88, 0.88], legLift = [0, 0], legZ = [-0.11, 0.11];
  function setLeg(i, plough = 0) {
    const L = legs[i], sk = skis[i];
    const reach = legH[i] - ANKLE - legLift[i];
    const [a1, kb] = solveLeg(reach);
    const hipX = -(THIGH * Math.sin(a1) + SHIN * Math.sin(a1 - kb));
    L.hip.position.set(hipX, legH[i], legZ[i]);
    L.hip.rotation.set(L.side * plough * 0.17, 0, a1);                   // round 7: knees in (the shins angle out to the wide tails)
    L.knee.rotation.set(-L.side * plough * 0.34, 0, -kb);
    L.ankle.rotation.set(0, 0, -(a1 - kb));
    sk.g.position.set(0, (legH[i] - ANKLE) - (THIGH * Math.cos(a1) + SHIN * Math.cos(a1 - kb)), L.side * (0.13 + plough * 0.16));
  }
  const SKI_PTS = [[0.8, 0, 0.04], [0.8, 0, -0.04], [0, 0, 0.04], [0, 0, -0.04], [-0.78, 0, 0.04], [-0.78, 0, -0.04]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const wv = new THREE.Vector3();
  let lastClear = 0;
  /** Lowest point of ski i against the ground (m, < 0 = in the snow). */
  function skiClear(i, ground) {
    let m = Infinity;
    for (const p of SKI_PTS) { wv.copy(p).applyMatrix4(skis[i].edge.matrixWorld); m = Math.min(m, wv.y - ground(wv.x, wv.z)); }
    return m;
  }
  /** Plants both skis on the terrain: a ski under the snow (lean, edge, a cross slope, a bump under the tip) is lifted by bending its
   *  knee more; two passes (a lift changes the ski's tilt only a little). */
  function plantSkis(ground, plough) {
    const k = Math.max(0.5, Math.cos(lean.rotation.x) * Math.cos(tilt.rotation.z));
    for (let pass = 0; pass < 4; pass++) {
      root.updateMatrixWorld(true);
      let moved = false;
      for (let i = 0; i < 2; i++) {
        const c = skiClear(i, ground);
        if (c < -0.004) { legLift[i] = Math.min(0.55, legLift[i] - c / k + 0.006); setLeg(i, plough); moved = true; }
      }
      if (!moved) break;
    }
    root.updateMatrixWorld(true);
    lastClear = Math.min(skiClear(0, ground), skiClear(1, ground));
    // a knee can only bend so far (a hard edge set on a steep side slope): what is left lifts the whole figure a little
    if (lastClear < -0.004) { root.position.y -= lastClear - 0.002; root.updateMatrixWorld(true); lastClear = Math.min(skiClear(0, ground), skiClear(1, ground)); }
  }
  const tmp = { x: 0, y: 1, z: 0 };
  const qN = new THREE.Quaternion(), qH = new THREE.Quaternion(), nv = new THREE.Vector3(), Y_AXIS = new THREE.Vector3(0, 1, 0);
  let lastEdge = 0, plant = 0, plantSide = 1, prevT = 0, smEdge = 0, smCrouch = 0, smPlough = 0, smAir = 0, lastGrab = 0, smGrab = 0;
  const HIP_PIVOT = 0.85;                    // flips turn the body round the hips, not the feet
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
    // round 4A tricks: a flip pitches the whole figure round the hips; a grab (the trick button held in the air) pulls the knees up
    // and one hand down to the ski
    const flip = !state.grounded && state.flip ? -state.flip : 0;
    if (flip) { tilt.rotation.z += flip; tilt.position.set(HIP_PIVOT * Math.sin(flip), HIP_PIVOT * (1 - Math.cos(flip)), 0); } else tilt.position.set(0, 0, 0);
    const grabbing = !state.grounded && (state.grab || 0) > lastGrab;
    lastGrab = state.grounded ? 0 : state.grab || 0;
    smGrab += ((grabbing ? 1 : 0) - smGrab) * Math.min(1, dt * 14);
    // smoothed drivers
    smEdge += (clamp(state.edge, -1.1, 1.1) - smEdge) * k;
    const landing = state.landed > 0 ? Math.sin(Math.min(1, state.landed / 0.35) * Math.PI) : 0;
    smCrouch += (clamp(state.tuck * 0.95 + landing * 0.8 + smGrab + (state.stop || 0) * 0.25, 0, 1) - smCrouch) * k;
    smPlough += (clamp(state.brake, 0, 1) * (1 - clamp(state.stop || 0, 0, 1)) * (state.hold && state.speed < 0.3 ? 0 : 1) - smPlough) * k;      // R8: standing still (held) the skis are parallel, never a crossed V      // round 7: the hockey stop is no plough
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
    const baseH = 0.88 - crouch * 0.36 - plough * 0.19;       // athletic stance: knees and ankles flexed (round 7: lower in the plough)
    const tuckAir = air * (1 - crouch) * 0.22;              // knees pulled up in the air
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const inside = Math.sign(edge) === L.side ? 1 : 0;     // the leg on the inside of the turn (edge > 0: turning right, the right leg)
      legH[i] = baseH - inside * Math.abs(edge) * 0.2 - tuckAir;
      legLift[i] = 0;
      legZ[i] = L.side * (0.11 + plough * 0.07 + (state.speed < 5 && state.grounded && !plough ? 0.03 : 0));
      setLeg(i, plough);
      const sk = skis[i];
      sk.g.rotation.set(0, L.side * plough * 0.34, 0);                  // tips in, tails out (Ry(+) turns the +x tip towards -z)
      sk.edge.rotation.set(skiEdge - L.side * plough * 0.2, 0, air * 0.12);       // on the inside edges
    }
    // torso: forward bend with the crouch, counter-roll against the lean (angulation), a little back in the plough
    const hipY = baseH - Math.abs(edge) * 0.1 - tuckAir;
    const [ta1, tkb] = solveLeg(hipY - ANKLE);
    const pelvisX = -(THIGH * Math.sin(ta1) + SHIN * Math.sin(ta1 - tkb));
    torso.position.set(pelvisX, hipY, 0);
    torso.rotation.set(-edge * 0.32, 0, -(0.22 + crouch * 0.95 + plough * 0.24 + air * 0.1));      // round 7: forward in the plough, not back
    neck.rotation.set(edge * 0.15, 0, 0.25 + crouch * 0.75);          // keep the eyes on the slope ahead
    // arms: forward and out; tuck: hands in front of the face, poles back under the arms; air: wide; plant: the inside pole reaches forward
    for (let i = 0; i < 2; i++) {
      const A = arms[i];
      const p = plant * (A.side === plantSide ? 1 : 0);
      A.sh.rotation.set(-A.side * (0.18 + air * 0.7 + plough * 0.1 - crouch * 0.12), 0, 0.55 + crouch * 1.05 + p * 0.45 + air * 0.25);
      A.elbow.rotation.set(0, 0, 0.55 + crouch * 0.85 - air * 0.3 + Math.sin(t * 2.6 + i) * 0.02);
      if (smGrab > 0.05 && A.side > 0) {                         // the grab hand reaches down the outside of the right ski
        A.sh.rotation.set(-0.35 * smGrab, 0, A.sh.rotation.z + (1.9 - A.sh.rotation.z) * smGrab);
        A.elbow.rotation.z += (0.15 - A.elbow.rotation.z) * smGrab;
      }
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
    // round 6: riding a lift: seated on a chair, standing in a cabin (skis and poles in the rack), pulled up a drag lift
    const ride = state.ride || '';
    const hideGear = ride === 'stand';
    if (hideGear !== gearHidden) { gearHidden = hideGear; for (const p of poles) p.visible = !hideGear; }      // round 7: skis carried, poles away
    if (ride === 'sit') poseSit(t);
    else if (ride === 'stand') poseStand(t);
    else if (ride === 'drag') poseDrag(t, Math.atan2(along, tmp.y));
    else if (ride === 'carry') poseCarry(t, state.walk || 0);         // R7-B ('skisdown' / 'clickin' / 'belt': the skis on the snow, standing)
    // round 7: both skis on the snow (carving, plough, tuck, landing, a traverse): the leg IK against the real terrain
    if (ground && state.grounded && state.crash <= 0 && !ride) plantSkis(ground, plough);
    else lastClear = 0;
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
  /** Round 7: first person: only what the skier sees of himself, the skis (their merged meshes under the ski groups) and the poles. */
  const gearGroups = new Set();
  for (const sk of skis) { sk.g.traverse((o) => gearGroups.add(o)); }
  for (const p of poles) p.traverse((o) => gearGroups.add(o));
  let firstPerson = false;
  function setFirstPerson(on) {
    firstPerson = !!on;
    if (skin) skin.fp = firstPerson;
    else for (const mesh of merged) mesh.visible = !firstPerson || gearGroups.has(mesh.parent);
    if (firstPerson) blob.visible = false;
  }
  /** Round 7 (A), tests: the world tips and tails of both skis [{ tip: {x, y, z}, tail: {x, y, z} }] after the last pose. */
  function skiEnds() {
    root.updateMatrixWorld(true);
    return skis.map((sk) => {
      const tip = new THREE.Vector3(0.95, 0, 0).applyMatrix4(sk.edge.matrixWorld), tail = new THREE.Vector3(-0.8, 0, 0).applyMatrix4(sk.edge.matrixWorld);
      return { tip: { x: tip.x, y: tip.y, z: tip.z }, tail: { x: tail.x, y: tail.y, z: tail.z } };
    });
  }
  return { root: group, pose, setOutfit, setSki, setFirstPerson, skiEnds, get skiClearance() { return lastClear; }, get firstPerson() { return firstPerson; }, setBlob(on) { blob.visible = !!on && !ghost && !firstPerson; }, setVisible(v) { group.visible = v; } };
}
