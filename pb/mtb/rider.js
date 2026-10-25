/* The bike and the rider, modelled from primitives and painted with the shared gouache lighting. Generic bike: no brand, no logos.
 * Model space: +x forward, +y up, +z to the rider's right, origin on the ground under the bottom bracket. */
import { PAINT_LIGHT_GLSL } from './ground-shader.js';

const THREE = window.THREE;
const WHEEL_R = 0.37;
const WHEELBASE = 1.12;
const BB_HEIGHT = 0.3;

function paint(env, color, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uColor: { value: new THREE.Color(color) }, uEmit: { value: opts.emit || 0 } },
    vertexShader: `varying vec3 vN; varying float vDist; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vec4 mv = viewMatrix * wp; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `precision highp float; uniform vec3 uColor, uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uEmit, uCloud; varying vec3 vN; varying float vDist;
      ${PAINT_LIGHT_GLSL}
      void main(){ vec3 col = paintLight(uColor, normalize(vN), mix(1.0, 0.8, uCloud * 0.6), 1.0) + uColor * uEmit; gl_FragColor = vec4(applyFog(pow(col, vec3(0.97)), vDist), 1.0); }`,
    side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function limb(from, to, radius, mat, parent) {
  const len = from.distanceTo(to);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, len - 2 * radius), 3, 8), mat);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  parent.add(mesh);
  return mesh;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function tube(a, b, r, mat, parent) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a.clone().add(b).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  parent.add(m);
  return m;
}

/** Two-bone IK in the sagittal (x, y) plane: hip -> knee -> foot. Returns the knee position (knee points forward). */
function knee(hip, foot, l1, l2) {
  const d = Math.min(l1 + l2 - 0.001, Math.max(Math.abs(l1 - l2) + 0.001, hip.distanceTo(foot)));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const dx = (foot.x - hip.x) / hip.distanceTo(foot), dy = (foot.y - hip.y) / hip.distanceTo(foot);
  return V(hip.x + dx * a - dy * h * -1, hip.y + dy * a + dx * h * -1, hip.z);
}

export function createRider(env, palette = {}) {
  const root = new THREE.Group(); root.name = 'mtb-rider';
  const tilt = new THREE.Group(); root.add(tilt);                 // pitch (z) and lean (x)
  const frameMat = paint(env, palette.frame || '#2f7d4f'), darkMat = paint(env, '#26292b'), tireMat = paint(env, '#1b1c1e'), rimMat = paint(env, '#9aa2a6');
  const skin = paint(env, '#e0b08a'), jersey = paint(env, palette.jersey || '#e8892c'), shorts = paint(env, '#2a3340'), helmetMat = paint(env, palette.helmet || '#f2f0e6'), shoeMat = paint(env, '#30343a');

  // --- bike
  const bike = new THREE.Group(); tilt.add(bike);
  const bbY = BB_HEIGHT;
  const rear = V(-WHEELBASE / 2, WHEEL_R, 0), front = V(WHEELBASE / 2, WHEEL_R, 0);
  const bb = V(0, bbY, 0), seatTop = V(-0.2, bbY + 0.62, 0), headLow = V(0.46, bbY + 0.3, 0), headTop = V(0.4, bbY + 0.62, 0);
  tube(bb, seatTop, 0.022, frameMat, bike); tube(bb, headLow, 0.03, frameMat, bike); tube(seatTop.clone().add(V(0.02, 0.0, 0)), headTop, 0.022, frameMat, bike);
  tube(rear, bb, 0.014, frameMat, bike); tube(rear, seatTop.clone().add(V(0, -0.05, 0)), 0.013, frameMat, bike);
  const forkGroup = new THREE.Group(); bike.add(forkGroup);
  forkGroup.position.copy(headTop);
  const forkLen = front.clone().sub(headTop);
  tube(V(0, 0, 0), forkLen, 0.02, darkMat, forkGroup);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.74, 6), darkMat); bar.rotation.x = Math.PI / 2; bar.position.set(0.03, 0.1, 0); forkGroup.add(bar);
  tube(V(0, 0, 0), V(0.03, 0.1, 0), 0.016, darkMat, forkGroup);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.14), darkMat); saddle.position.set(-0.2, bbY + 0.66, 0); bike.add(saddle);
  const wheel = (pos) => {
    const g = new THREE.Group(); g.position.copy(pos);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.03, 0.036, 8, 28), tireMat); g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.065, 0.006, 4, 24), rimMat); g.add(rim);
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 2 * (WHEEL_R - 0.065), 3), rimMat); sp.rotation.x = Math.PI / 2; sp.rotation.z = i * Math.PI / 4; g.add(sp); }
    bike.add(g); return g;
  };
  const rearWheel = wheel(rear), frontWheel = wheel(front);
  frontWheel.parent.remove(frontWheel); forkGroup.add(frontWheel); frontWheel.position.copy(forkLen);
  const crank = new THREE.Group(); crank.position.copy(bb); bike.add(crank);
  const pedalL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.07), darkMat), pedalR = pedalL.clone();
  pedalL.position.set(0, 0, -0.1); pedalR.position.set(0, 0, 0.1);
  const crankArm = new THREE.Group(); crankArm.add(pedalL, pedalR); crank.add(crankArm);
  tube(V(0, 0, -0.1), V(0, 0, 0.1), 0.012, darkMat, crank);

  // --- rider (all limbs rebuilt each frame from the pose: cheap capsules)
  const body = new THREE.Group(); tilt.add(body);
  const limbs = new THREE.Group(); body.add(limbs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), skin); body.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), helmetMat); body.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.16), helmetMat); body.add(visor);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.3, 4, 10), jersey); body.add(torso);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.2), darkMat); body.add(pack);

  let pose = { crank: 0, stand: 0, compress: 0, steer: 0 };
  const pedalPos = (angle, side) => V(Math.cos(angle) * 0.17, bbY + Math.sin(angle) * 0.17, side);

  function rebuildLimbs() {
    while (limbs.children.length) { const c = limbs.children.pop(); c.geometry.dispose(); }
    const stand = pose.stand;
    const hip = V(-0.2 - 0.12 * stand, bbY + 0.74 + 0.1 * stand - pose.compress * 0.05, 0);
    const shoulder = V(hip.x + 0.34 + 0.06 * stand, hip.y + 0.4 - 0.13 * stand, 0);
    const handle = V(0.43 + 0.03, bbY + 0.74 - pose.compress * 0.03, 0);
    // torso orientation
    torso.position.copy(hip.clone().add(shoulder).multiplyScalar(0.5));
    torso.quaternion.setFromUnitVectors(V(0, 1, 0), shoulder.clone().sub(hip).normalize());
    pack.position.copy(torso.position).add(V(-0.1, 0.02, 0)); pack.quaternion.copy(torso.quaternion);
    const neck = shoulder.clone().add(V(0.05, 0.09, 0));
    head.position.copy(neck.clone().add(V(0.04, 0.1, 0))); helmet.position.copy(head.position).add(V(-0.005, 0.02, 0)); visor.position.copy(head.position).add(V(0.1, 0.05, 0));
    for (const side of [-1, 1]) {
      const z = side * 0.09;
      const h = hip.clone(); h.z = z;
      const angle = pose.crank + (side > 0 ? 0 : Math.PI);
      const foot = pedalPos(stand > 0.5 ? Math.PI * 0.5 : angle, side * 0.1); foot.y += 0.06;
      const k = knee(h, foot, 0.42, 0.42); k.z = z;
      limb(h, k, 0.062, shorts, limbs); limb(k, foot, 0.05, skin, limbs);
      const toe = foot.clone().add(V(0.1, -0.02, 0)); limb(foot.clone().add(V(-0.03, 0, 0)), toe, 0.036, shoeMat, limbs);
      const sh = shoulder.clone(); sh.z = side * 0.17;
      const hand = handle.clone(); hand.z = side * 0.3;
      const el = sh.clone().lerp(hand, 0.5).add(V(-0.04 - 0.1 * stand, -0.1 - 0.05 * stand, side * 0.1));
      limb(sh, el, 0.042, jersey, limbs); limb(el, hand, 0.034, skin, limbs);
    }
  }

  const q = new THREE.Quaternion();
  return {
    root,
    wheelRadius: WHEEL_R, wheelbase: WHEELBASE,
    /** Pose the model from the bike state. `ground`: { pitch, rearY, frontY } relative to the rider's origin height. */
    apply(state, extra) {
      root.position.set(state.x, state.y, state.z);
      root.rotation.set(0, -state.heading, 0);
      tilt.rotation.set(state.lean * 0.85, 0, extra.pitch);
      // wheels roll with the speed
      const sp = Math.hypot(state.vx, state.vy, state.vz);
      const spin = (extra.spin = (extra.spin || 0) + sp * extra.dt / WHEEL_R);
      rearWheel.rotation.z = -spin; frontWheel.rotation.z = -spin;
      forkGroup.rotation.y = -state.steer * 0.35;
      const comp = Math.min(1, state.compression);
      forkGroup.position.y = headTop.y - comp * 0.04;
      pose.crank = state.crank; pose.compress = comp;
      const want = extra.standing ? 1 : 0;
      pose.stand += (want - pose.stand) * Math.min(1, extra.dt * 5);
      crankArm.rotation.z = pose.crank;
      rebuildLimbs();
    },
    setVisible(v) { root.visible = v; },
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}
