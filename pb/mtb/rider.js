/* The rider and the bike: a stylised mountain biker on a generic trail bike (no brand, no logos), modelled from merged vertex-colour parts and posed every frame by
 * transforms only (no geometry is rebuilt).
 *   bike   frame tubes, a fork with stanchions and lowers (it compresses), disc brakes, chunky tyres, 28-spoke wheels that spin, a crank with level pedals, a chain,
 *          bars with grips and levers, a saddle on a dropper post (up when seated, down when standing)
 *   rider  helmet with visor and goggle strap, jersey, shorts with a hydration pack, knee pads, gloves on the bars, shoes on the pedals; legs pedal through a two-bone IK,
 *          the rider stands on descents, shifts back when braking, leans into the turns
 * Model space: +x forward, +y up, +z to the rider's right, origin on the ground under the bottom bracket. */
import { Builder, V3, M, tube, bezier } from './geo-builder.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const WHEEL_R = 0.37;
const WHEELBASE = 1.12;
const BB = V3(0, 0.31, 0);
const REAR_AXLE = V3(-WHEELBASE / 2, WHEEL_R, 0);
const FRONT_AXLE = V3(WHEELBASE / 2, WHEEL_R, 0);
const HEAD_LOW = V3(0.47, 0.7, 0), HEAD_TOP = V3(0.43, 0.88, 0);
const SEAT_CLUSTER = V3(-0.17, 0.8, 0);
const SEAT_DIR = V3(-0.26, 0.966, 0).normalize();
const FORK_AXIS = FRONT_AXLE.clone().sub(HEAD_LOW).setLength(1);          // pointing down the fork, towards the axle
const DROPPER_BASE = 0.14, DROPPER_TRAVEL = 0.13;
const THIGH = 0.43, SHIN = 0.43, UPPER_ARM = 0.3, FOREARM = 0.29, TORSO = 0.52;
const CRANK_R = 0.17;
const BAR_HALF = 0.37;
const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const VERTEX = `
  attribute vec3 color;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist; uniform float uAlpha; uniform vec3 uTint;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 c = paintLightW(vC, N, mix(1.0, 0.8, uCloud * 0.6), 1.0, vWorld);
    c += uAmbSky * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * 0.12 * vC;              // a faint rim keeps the dark parts readable against the forest
    c *= 1.0 - 0.2 * uWet;
    gl_FragColor = vec4(applyFogW(pow(c, vec3(0.97)), vDist, vWorld.y) * uTint, uAlpha);
  }
`;

/** Tapered capsule from y = 0 to y = len (rounded ends), radii r0 at the start and r1 at the end; scaled afterwards by (sx, 1, sz). */
function capsule(b, len, r0, r1, color, sx = 1, sz = 1, segs = 8, shade = null) {
  const pts = [V3(0, -r0 * 0.7, 0), V3(0, -r0 * 0.35, 0), V3(0, 0, 0), V3(0, len * 0.35, 0), V3(0, len * 0.7, 0), V3(0, len, 0), V3(0, len + r1 * 0.35, 0), V3(0, len + r1 * 0.7, 0)];
  const radii = [r0 * 0.12, r0 * 0.7, r0, r0 + (r1 - r0) * 0.35, r0 + (r1 - r0) * 0.7, r1, r1 * 0.7, r1 * 0.12];
  const t = tube(pts, radii, segs, false);
  for (let i = 0; i < t.pos.length; i += 3) { t.pos[i] *= sx; t.pos[i + 2] *= sz; }
  for (let i = 0; i < t.nor.length; i += 3) { t.nor[i] /= sx; t.nor[i + 2] /= sz; const l = Math.hypot(t.nor[i], t.nor[i + 1], t.nor[i + 2]) || 1; t.nor[i] /= l; t.nor[i + 1] /= l; t.nor[i + 2] /= l; }
  b.addArrays(t.pos, t.nor, t.idx, (v, n) => (shade ? shade(v, n, color) : color));
}

function rod(b, a, c, r0, r1, color, segs = 6) {
  const dir = c.clone().sub(a);
  const len = dir.length();
  const t = tube([a.clone(), a.clone().add(dir.clone().multiplyScalar(0.5)), c.clone()], [r0, (r0 + r1) / 2, r1], segs, true);
  b.addArrays(t.pos, t.nor, t.idx, () => color);
  return len;
}

function discRing(b, centre, rIn, rOut, color, zOff = 0) {            // a flat ring in the xy plane (brake rotor)
  const seg = 28, pos = [], nor = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    pos.push(centre.x + ca * rIn, centre.y + sa * rIn, centre.z + zOff, centre.x + ca * rOut, centre.y + sa * rOut, centre.z + zOff);
    nor.push(0, 0, 1, 0, 0, 1);
    const n2 = ((i + 1) % seg) * 2;
    idx.push(i * 2, i * 2 + 1, n2, n2, i * 2 + 1, n2 + 1);
  }
  b.addArrays(pos, nor, idx, () => color);
}

function wheelGeometry(rimColor, tyreColor, tyreMinor = 0.034) {
  const b = new Builder();
  const tyre = new THREE.TorusGeometry(WHEEL_R - tyreMinor, tyreMinor, 10, 32);
  b.add(tyre, M(0, 0, 0), (v) => { const k = 0.82 + 0.18 * Math.sin(Math.atan2(v.y, v.x) * 36); const side = Math.abs(v.z) / tyreMinor; return mul(tyreColor, k * (1 - 0.25 * side * side) * (1 + 0.5 * Math.max(0, side - 0.8))); });
  const rim = new THREE.TorusGeometry(WHEEL_R - 0.07, 0.009, 6, 32);
  b.add(rim, M(0, 0, 0, 1, 1, 1.9), () => rimColor);
  for (let i = 0; i < 28; i++) {                                         // spokes: from the hub flange to the rim, crossing over
    const a = (i / 28) * Math.PI * 2, side = i % 2 ? 1 : -1;
    const from = V3(Math.cos(a + side * 0.28) * 0.025, Math.sin(a + side * 0.28) * 0.025, side * 0.028);
    const to = V3(Math.cos(a) * (WHEEL_R - 0.075), Math.sin(a) * (WHEEL_R - 0.075), 0);
    rod(b, from, to, 0.0022, 0.0022, mul(rimColor, 0.9), 3);
  }
  const hub = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8).rotateX(Math.PI / 2);
  b.add(hub, M(0, 0, 0), () => mul(rimColor, 0.8));
  discRing(b, V3(0, 0, 0), 0.05, 0.1, [0.62, 0.64, 0.66], -0.034);          // brake rotor
  return b.build();
}

/** Two-bone IK in 3D: the joint position for a chain root -> end of lengths l1, l2; `pole` is the direction the joint bends towards. */
function ik(root, end, l1, l2, pole, out) {
  const d = end.clone().sub(root);
  const dist = Math.min(l1 + l2 - 0.002, Math.max(Math.abs(l1 - l2) + 0.002, d.length()));
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (side.lengthSq() < 1e-8) side.set(0, 1, 0);
  side.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(side, h);
}

function place(mesh, from, to) {
  mesh.position.copy(from);
  const d = to.clone().sub(from);
  mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
}

/* The four bikes look different: tyre width, tube thickness, a rear shock (not on the hardtail), a second fork crown and a full-face helmet on the downhill bike. */
const BIKE_LOOK = Object.freeze({
  hardtail: { tyre: 0.027, tube: 0.9, shock: false, crown2: false, fullFace: false, travel: 0.04 },
  trail: { tyre: 0.033, tube: 1.0, shock: true, crown2: false, fullFace: false, travel: 0.07 },
  enduro: { tyre: 0.039, tube: 1.12, shock: true, crown2: false, fullFace: false, travel: 0.09 },
  downhill: { tyre: 0.045, tube: 1.25, shock: true, crown2: true, fullFace: true, travel: 0.11 },
});
export const COLOUR_HEX = Object.freeze({ red: '#d8452e', blue: '#2b6fd0', green: '#2f9e6b', yellow: '#e8c32a', orange: '#e8832a', purple: '#7b49c8', black: '#26282b', white: '#eeeeea' });
export const HELMET_HEX = Object.freeze({ plain: '#f2f0e6', stripe: '#f2f0e6', flame: '#e8832a', gold: '#e8c32a' });

export function createRider(env, palette = {}) {
  const look = BIKE_LOOK[palette.bike] || BIKE_LOOK.trail;
  const frameC = col(palette.frame || '#d8452e'), jerseyC = col(palette.jersey || '#2b6fd0'), helmetC = col(palette.helmet || '#f2f0e6');
  const shortsC = col('#2a3340'), skinC = col('#d9a67f'), darkC = col('#25282b'), glovesC = col('#30343a'), shoeC = col('#3a3f46'), padC = col('#1d2023');
  const tyreC = col('#1d1e20'), rimC = col('#aeb4b8'), forkC = col('#c9a23a');
  const ghost = palette.ghost === true;
  const material = new THREE.ShaderMaterial({ uniforms: { ...env.uniforms, uAlpha: { value: ghost ? 0.42 : 1 }, uTint: { value: ghost ? new THREE.Vector3(0.7, 0.9, 1.25) : new THREE.Vector3(1, 1, 1) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, transparent: ghost, depthWrite: !ghost });
  const meshOf = (b) => { const m = new THREE.Mesh(b.build ? b.build() : b, material); m.frustumCulled = false; return m; };

  const root = new THREE.Group(); root.name = 'mtb-rider';
  const tilt = new THREE.Group(); root.add(tilt);                 // pitch (z) and lean (x)
  const bikeG = new THREE.Group(); tilt.add(bikeG);

  // ---- frame (static)
  const fb = new Builder();
  rod(fb, BB, SEAT_CLUSTER, 0.017, 0.016, frameC, 7);                                       // seat tube
  rod(fb, V3(0.02, 0.325, 0), HEAD_LOW.clone().add(V3(-0.01, 0.01, 0)), 0.03, 0.028, frameC, 8);          // down tube
  rod(fb, SEAT_CLUSTER.clone().add(V3(0.0, -0.02, 0)), HEAD_TOP.clone().add(V3(-0.005, -0.03, 0)), 0.022, 0.024, frameC, 7);     // top tube
  rod(fb, HEAD_LOW, HEAD_TOP, 0.032, 0.032, frameC, 8);                                      // head tube
  for (const s of [-1, 1]) {
    rod(fb, BB.clone().add(V3(0, 0, s * 0.02)), REAR_AXLE.clone().add(V3(0, 0, s * 0.062)), 0.014, 0.011, frameC, 5);                // chain stays
    rod(fb, REAR_AXLE.clone().add(V3(0, 0, s * 0.062)), SEAT_CLUSTER.clone().add(V3(0.01, -0.06, s * 0.012)), 0.01, 0.01, frameC, 5);   // seat stays
  }
  if (look.shock) {
    rod(fb, V3(-0.3, 0.62, 0.0), V3(-0.38, 0.345, 0), 0.012, 0.012, darkC, 5);                // rear shock link (a small linkage rod)
    rod(fb, V3(-0.12, 0.5, 0.03), V3(-0.3, 0.36, 0.03), 0.026, 0.02, forkC, 6);                // the rear shock body
  }
  fb.add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20).rotateX(Math.PI / 2), M(0, 0.31, 0.055), () => darkC);     // chainring
  rod(fb, V3(0.0, 0.31, 0.058), V3(-0.56, 0.355, 0.056), 0.004, 0.004, [0.2, 0.2, 0.22], 3);       // chain (upper run)
  rod(fb, V3(0.0, 0.21, 0.058), V3(-0.56, 0.31, 0.056), 0.004, 0.004, [0.2, 0.2, 0.22], 3);        // chain (lower run)
  fb.add(new THREE.BoxGeometry(0.06, 0.1, 0.03), M(-0.58, 0.28, 0.06), () => darkC);         // derailleur
  fb.add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16).rotateX(Math.PI / 2), M(REAR_AXLE.x, REAR_AXLE.y, 0.045), () => [0.45, 0.46, 0.5]);   // cassette
  fb.add(new THREE.BoxGeometry(0.035, 0.07, 0.02), M(REAR_AXLE.x + 0.03, REAR_AXLE.y + 0.09, -0.06), () => darkC);    // rear caliper
  bikeG.add(meshOf(fb));

  // ---- wheels
  const wheelGeo = wheelGeometry(rimC, tyreC, look.tyre);
  const rearWheel = new THREE.Mesh(wheelGeo, material); rearWheel.position.copy(REAR_AXLE); rearWheel.frustumCulled = false; bikeG.add(rearWheel);

  // ---- steering assembly: bars, stem, upper fork (rotates about the head-tube axis)
  const steerG = new THREE.Group(); steerG.position.copy(HEAD_TOP); bikeG.add(steerG);
  const sb = new Builder();
  const rel = (p) => p.clone().sub(HEAD_TOP);
  const stemEnd = V3(0.045, 0.07, 0);
  rod(sb, V3(0, 0.0, 0), stemEnd, 0.016, 0.016, darkC, 6);                                  // stem
  rod(sb, stemEnd.clone().add(V3(0, 0, -BAR_HALF)), stemEnd.clone().add(V3(0, 0, BAR_HALF)), 0.0115, 0.0115, darkC, 6);       // bar
  for (const s of [-1, 1]) {
    rod(sb, stemEnd.clone().add(V3(0, 0, s * (BAR_HALF - 0.1))), stemEnd.clone().add(V3(0, 0, s * (BAR_HALF + 0.005))), 0.0165, 0.0165, [0.12, 0.12, 0.13], 6);   // grip
    rod(sb, stemEnd.clone().add(V3(0.0, 0, s * (BAR_HALF - 0.12))), stemEnd.clone().add(V3(0.1, -0.012, s * (BAR_HALF - 0.12))), 0.005, 0.004, [0.7, 0.72, 0.75], 3);        // brake lever
  }
  const fenderTop = rel(HEAD_LOW).add(V3(0, 0, 0));
  sb.add(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8), M(0, -0.02, 0), () => darkC);     // headset cup
  const crown = rel(HEAD_LOW);
  sb.add(new THREE.BoxGeometry(0.07, 0.04, 0.16), M(crown.x, crown.y - 0.02, 0), () => darkC);            // fork crown
  if (look.crown2) sb.add(new THREE.BoxGeometry(0.07, 0.04, 0.18), M(crown.x + 0.0, crown.y + 0.1, 0), () => darkC);            // the downhill bike's second crown
  for (const s of [-1, 1]) rod(sb, V3(crown.x, crown.y - 0.03, s * 0.075), V3(crown.x, crown.y - 0.03, s * 0.075).addScaledVector(FORK_AXIS, 0.17), 0.016, 0.016, forkC, 7);   // stanchions
  steerG.add(meshOf(sb));
  // ---- lower fork + front wheel (slides up the head axis when the fork compresses, steers with the bars)
  const lowerG = new THREE.Group(); steerG.add(lowerG);
  const lb = new Builder();
  const lowerTop = crown.clone().add(V3(0, -0.03, 0)).addScaledVector(FORK_AXIS, 0.17);
  const axleRel = rel(FRONT_AXLE);
  for (const s of [-1, 1]) {
    rod(lb, V3(lowerTop.x, lowerTop.y, s * 0.075), V3(axleRel.x, axleRel.y, s * 0.062), 0.021, 0.015, darkC, 7);          // lowers
  }
  lb.add(new THREE.BoxGeometry(0.035, 0.07, 0.02), M(axleRel.x - 0.045, axleRel.y + 0.02, -0.07), () => darkC);       // front caliper
  lowerG.add(meshOf(lb));
  const frontWheel = new THREE.Mesh(wheelGeo, material); frontWheel.position.copy(axleRel); frontWheel.frustumCulled = false; lowerG.add(frontWheel);

  // ---- crank, pedals, dropper post + saddle
  const crankG = new THREE.Group(); crankG.position.copy(BB); bikeG.add(crankG);
  const cb = new Builder();
  rod(cb, V3(0, 0, 0.07), V3(CRANK_R, 0, 0.09), 0.013, 0.011, [0.28, 0.29, 0.32], 5);
  rod(cb, V3(0, 0, -0.07), V3(-CRANK_R, 0, -0.09), 0.013, 0.011, [0.28, 0.29, 0.32], 5);
  rod(cb, V3(0, 0, -0.08), V3(0, 0, 0.08), 0.014, 0.014, [0.2, 0.2, 0.22], 5);
  crankG.add(meshOf(cb));
  const pedalGeo = (() => { const b = new Builder(); b.add(new THREE.BoxGeometry(0.1, 0.018, 0.1), M(0, 0, 0), () => [0.18, 0.19, 0.2]); return b.build(); })();
  const pedals = [new THREE.Mesh(pedalGeo, material), new THREE.Mesh(pedalGeo, material)];
  for (const p of pedals) { p.frustumCulled = false; bikeG.add(p); }

  const dropperG = new THREE.Group(); dropperG.position.copy(SEAT_CLUSTER); bikeG.add(dropperG);
  const db = new Builder();
  const postTop = SEAT_DIR.clone().multiplyScalar(0.3);
  rod(db, V3(0, -0.05, 0), postTop, 0.0155, 0.0155, [0.13, 0.13, 0.14], 7);                  // post
  db.add(new THREE.BoxGeometry(0.27, 0.045, 0.13), M(postTop.x + 0.02, postTop.y + 0.025, 0, 1, 1, 1, 0, 0, 0.03), (v) => (v.y > postTop.y + 0.035 ? [0.14, 0.14, 0.15] : [0.1, 0.1, 0.11]));   // saddle
  dropperG.add(meshOf(db));
  // collar of the dropper (static, at the seat tube top)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), material); collar.position.copy(SEAT_CLUSTER); collar.quaternion.setFromUnitVectors(V3(0, 1, 0), SEAT_DIR); collar.frustumCulled = false; bikeG.add(collar);

  // ---- rider parts
  const body = new THREE.Group(); tilt.add(body);
  const torsoB = new Builder();
  capsule(torsoB, TORSO, 0.105, 0.125, jerseyC, 0.78, 1.55, 10, (v, n, c) => { const back = v.x < -0.02 ? 1 : 0; return back && v.y > 0.1 && v.y < 0.42 ? mul(darkC, 1.1) : mul(c, 0.88 + 0.2 * Math.min(1, v.y / TORSO)); });   // jersey + hydration pack on the back
  torsoB.add(new THREE.BoxGeometry(0.1, 0.34, 0.2), M(-0.095, 0.26, 0), () => [0.15, 0.17, 0.2]);
  const torso = meshOf(torsoB); body.add(torso);
  const headB = new Builder();
  if (look.fullFace) headB.add(new THREE.BoxGeometry(0.1, 0.07, 0.14), M(0.12, 0.13, 0, 1, 1, 1, 0, 0, -0.35), () => mul(helmetC, 0.9));        // the full-face chin bar
  capsule(headB, 0.07, 0.044, 0.04, skinC, 1, 1, 8);                                          // neck
  headB.add(new THREE.SphereGeometry(0.092, 12, 10), M(0.015, 0.2, 0, 1, 1.08, 0.95), () => skinC);
  const shell = new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  headB.add(shell, M(-0.015, 0.215, 0, 1.12, 1.0, 1.0), (v, n) => { const slot = Math.max(0, Math.sin(v.z * 70) * Math.sin(v.x * 30)) * (v.y > 0.25 ? 1 : 0); return mul(helmetC, 1 - 0.38 * slot * 0.9); });
  headB.add(new THREE.BoxGeometry(0.1, 0.012, 0.15), M(0.108, 0.255, 0, 1, 1, 1, 0, 0, 0.18), () => mul(helmetC, 0.82));      // visor
  headB.add(new THREE.TorusGeometry(0.106, 0.012, 5, 18), M(0.0, 0.185, 0, 1.05, 1, 1, Math.PI / 2, 0, 0), () => darkC);      // goggle strap
  headB.add(new THREE.BoxGeometry(0.03, 0.05, 0.15), M(0.108, 0.19, 0, 1, 1, 1), () => [0.1, 0.12, 0.14]);                    // goggle lens
  const head = meshOf(headB); body.add(head);

  const limbMeshes = {};
  const mk = (name, len, r0, r1, color, sx = 1, sz = 1, shade = null) => { const b = new Builder(); capsule(b, len, r0, r1, color, sx, sz, 8, shade); const m = meshOf(b); body.add(m); limbMeshes[name] = m; return m; };
  const kneePad = (v, n, c) => (v.y > 0.02 && v.y < 0.2 && n.x > 0.2 ? padC : c);
  const thighs = [mk('thighL', THIGH, 0.073, 0.058, shortsC, 1, 1), mk('thighR', THIGH, 0.073, 0.058, shortsC, 1, 1)];
  const shins = [mk('shinL', SHIN, 0.056, 0.04, skinC, 1, 1, (v, n, c) => (v.y > 0.01 && v.y < 0.2 ? padC : v.y < 0.33 ? c : mul(c, 0.95))), mk('shinR', SHIN, 0.056, 0.04, skinC, 1, 1, (v, n, c) => (v.y > 0.01 && v.y < 0.2 ? padC : c))];
  const uppers = [mk('upperL', UPPER_ARM, 0.05, 0.043, jerseyC, 1, 1), mk('upperR', UPPER_ARM, 0.05, 0.043, jerseyC, 1, 1)];
  const lowers = [mk('foreL', FOREARM, 0.042, 0.036, skinC, 1, 1, (v, n, c) => (v.y > FOREARM - 0.02 ? glovesC : c)), mk('foreR', FOREARM, 0.042, 0.036, skinC, 1, 1, (v, n, c) => (v.y > FOREARM - 0.02 ? glovesC : c))];
  const shoeGeo = (() => { const b = new Builder(); capsule(b, 0.2, 0.04, 0.036, shoeC, 1.1, 0.95, 8); return b.build(); })();
  const shoes = [new THREE.Mesh(shoeGeo, material), new THREE.Mesh(shoeGeo, material)];
  for (const s of shoes) { s.frustumCulled = false; body.add(s); }
  const gloveGeo = (() => { const b = new Builder(); capsule(b, 0.06, 0.04, 0.036, glovesC, 1, 1, 8); return b.build(); })();
  const gloves = [new THREE.Mesh(gloveGeo, material), new THREE.Mesh(gloveGeo, material)];
  for (const g of gloves) { g.frustumCulled = false; body.add(g); }

  // ---- pose state (smoothed)
  const pose = { stand: 0, back: 0, drop: 1, lean: 0 };
  const tmpA = V3(0, 0, 0), tmpB = V3(0, 0, 0);
  const forkAxisUp = FORK_AXIS.clone().negate();
  const lampWorld = V3(0, 0, 0), lampDirWorld = V3(1, -0.12, 0);
  const steerQ = new THREE.Quaternion();
  let spin = 0;

  function poseBody(state, extra) {
    const stand = pose.stand, back = pose.back;
    const comp = Math.min(1, state.compression);
    // saddle height: dropper extension seated, dropped when standing
    const ext = DROPPER_BASE + DROPPER_TRAVEL * (1 - stand);
    dropperG.position.copy(SEAT_CLUSTER);
    dropperG.children[0].position.copy(SEAT_DIR).multiplyScalar(ext - 0.3 + 0.0);
    const saddleTop = SEAT_CLUSTER.clone().addScaledVector(SEAT_DIR, ext + 0.025).add(V3(0.0, 0.03, 0));
    // pelvis: on the saddle when seated, above and behind the pedals when standing (and further back when braking)
    const hip = V3(saddleTop.x + 0.03 - stand * 0.0 - back * 0.1, saddleTop.y + 0.08 + stand * (0.97 - saddleTop.y + 0.1) * 0.0, 0);
    const standHip = V3(-0.12 - back * 0.14, 1.07 - comp * 0.04 - back * 0.03, 0);
    hip.lerp(standHip, stand);
    hip.y -= comp * 0.03;
    // torso: leans forward (more when seated and pedalling hard, more upright braking)
    const bars = HEAD_TOP.clone().add(V3(0.045, 0.07, 0));
    const torsoAngle = (0.7 - 0.18 * stand + 0.18 * back) ;                    // rad above horizontal
    const dirT = V3(Math.cos(torsoAngle), Math.sin(torsoAngle), 0);
    const shoulder = hip.clone().addScaledVector(dirT, TORSO);
    torso.position.copy(hip); torso.quaternion.setFromUnitVectors(V3(0, 1, 0), dirT);
    // head looks ahead along the trail
    head.position.copy(shoulder).addScaledVector(dirT, 0.02).add(V3(0.0, 0.0, 0));
    head.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(Math.sin(0.35 - torsoAngle * 0.35), Math.cos(0.35 - torsoAngle * 0.35), 0).normalize());
    head.position.add(V3(0.03, 0.01, 0));
    // handlebar rotates with the steering: the hands follow it
    const handBase = V3(0, 0, 0);
    // legs
    const crankAngle = stand > 0.5 ? 0 : state.crank;
    const stepPos = (side) => { const a = crankAngle + (side > 0 ? 0 : Math.PI); return V3(Math.cos(a) * CRANK_R, BB.y + Math.sin(a) * CRANK_R, side * 0.095); };
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const pedal = stepPos(side);
      pedals[k].position.copy(pedal); pedals[k].position.z = side * 0.14;
      const ankle = pedal.clone().add(V3(-0.03, 0.075, 0));
      ankle.z = side * 0.115;
      const h = V3(hip.x, hip.y, side * 0.085);
      const knee = ik(h, ankle, THIGH, SHIN, V3(1, 0.15, side * 0.28), tmpA).clone();
      place(thighs[k], h, knee); place(shins[k], knee, ankle);
      // shoe: flat on the pedal, toe forward
      shoes[k].position.copy(ankle).add(V3(-0.075, -0.045, 0));
      shoes[k].quaternion.setFromUnitVectors(V3(0, 1, 0), V3(1, 0.05, 0));
    }
    // arms: shoulder -> hand on the grip (bars steer, so the grip moves with the steering angle)
    const steerAng = -state.steer * 0.35;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const shoulderS = shoulder.clone().add(V3(0.0, -0.03, side * 0.19));
      const gripLocal = V3(0.045 + Math.sin(steerAng * side * 0) * 0, 0.07, side * (BAR_HALF - 0.05));
      // rotate the grip about the head-tube axis by the steer angle
      gripLocal.applyAxisAngle(forkAxisUp.clone().normalize(), steerAng);
      const hand = HEAD_TOP.clone().add(gripLocal);
      const elbow = ik(shoulderS, hand, UPPER_ARM, FOREARM, V3(-0.3, -0.5 - 0.2 * stand, side * 1.0), tmpB).clone();
      place(uppers[k], shoulderS, elbow); place(lowers[k], elbow, hand);
      gloves[k].position.copy(hand).add(V3(0, -0.01, 0)); gloves[k].quaternion.setFromUnitVectors(V3(0, 1, 0), V3(0, 0, side)); gloves[k].position.z -= side * 0.03;
    }
    return comp;
  }

  return {
    root, material,
    wheelRadius: WHEEL_R, wheelbase: WHEELBASE,
    /** Pose the model from the bike state. extra = { pitch, standing, brake, dt, spin }. */
    apply(state, extra) {
      root.position.set(state.x, state.y, state.z);
      root.rotation.set(0, -state.heading, 0);
      // the bike leans fully into the turn, the rider a little less (hips out, head up)
      tilt.rotation.set(state.lean * 0.9, 0, extra.pitch);
      body.rotation.set(-state.lean * 0.16, 0, 0);
      if (state.crashed) {                                          // a stylised tumble: the bike pitches over, rolls onto its side and the rider lies beside it
        const k = Math.min(1, state.crashT / 0.75);
        const e = 1 - (1 - k) * (1 - k);
        tilt.rotation.set(state.lean * 0.9 + e * 1.45, 0, extra.pitch - 0.7 * Math.sin(Math.PI * k));
        root.position.y += 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.1)) * Math.min(1, 1.6 - k);
        body.rotation.set(-state.lean * 0.16 - e * 0.9, 0, e * 0.4);
        body.position.set(-0.2 * e, 0.0, 0.3 * e);
      } else body.position.set(0, 0, 0);
      const dt = extra.dt || 0.016;
      const sp = Math.hypot(state.vx, state.vy, state.vz);
      spin += sp * dt / WHEEL_R;
      rearWheel.rotation.z = -spin; frontWheel.rotation.z = -spin;
      pose.stand += ((extra.standing ? 1 : 0) - pose.stand) * Math.min(1, dt * 5);
      pose.back += (((extra.brake || 0) > 0.35 && sp > 3 ? 1 : 0) - pose.back) * Math.min(1, dt * 6);
      const comp = Math.min(1, state.compression);
      // steering about the (tilted) head-tube axis; the fork lowers slide up the axis when compressing
      steerQ.setFromAxisAngle(forkAxisUp.clone().normalize(), -state.steer * 0.35);
      steerG.quaternion.copy(steerQ);
      lowerG.position.copy(forkAxisUp).multiplyScalar(comp * look.travel);
      crankG.rotation.z = (pose.stand > 0.5 ? 0 : state.crank);
      for (const p of pedals) p.rotation.z = 0;
      poseBody(state, extra);
      root.updateMatrixWorld(true);
      // the lamp on the bars (world position and direction), for the shared lighting
      steerG.localToWorld(lampWorld.set(0.1, 0.1, 0));
      lampDirWorld.set(1, -0.14, 0).transformDirection(tilt.matrixWorld);
    },
    /** Lamp: writes the world position / direction (the bike lamp). */
    lamp(posOut, dirOut) { posOut.copy(lampWorld); dirOut.copy(lampDirWorld); },
    setVisible(v) { root.visible = v; },
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); material.dispose(); },
  };
}
