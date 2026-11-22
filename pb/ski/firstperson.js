/* Round 7-C: the first-person camera MODE (a separate mode next to the chase camera of camera.js / the look module; main.js switches).
 *   view    the skier's own eyes: only the ski tips and the poles are drawn (the body model is hidden), a subtle head bob with the speed
 *           and the bumps, a lean into the turn (camera roll from the edge angle), an FOV kick at speed, the skis' own direction (lagged)
 *   streak  a light radial motion streak over the picture on Mëttel and Héich (a CSS layer: no draw call, nothing on Niddreg)
 *   ride    on a lift the window view of liftride.js is the first-person view (main.js forces it while this mode is on)
 * The choice is saved (localStorage pb_ski_cam = 'fp' | 'chase'). Two draw calls: one merged ski mesh, one merged pole mesh. */
import { FIRST_PERSON as FP } from './config.js';
import { handParts } from './fp-hands.js';

const THREE = window.THREE;
const KEY = 'pb_ski_cam';
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function readCamMode() { try { return localStorage.getItem(KEY) === 'fp' ? 'fp' : 'chase'; } catch (error) { return 'chase'; } }
export function writeCamMode(m) { try { localStorage.setItem(KEY, m); } catch (error) { console.warn('[ski] camera choice not saved', error.message); } }

function coloured(geo, hex) {
  const g = geo.toNonIndexed();
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** One ski along +x (tip at +x), centred on the boot; a turned-up tip. */
function skiGeometry(look) {
  const L = 1.72 * (look.length || 1), W = 0.085 * (look.width || 1);
  const parts = [];
  const body = new THREE.BoxGeometry(L * 0.86, 0.022, W); body.translate(-L * 0.07, 0.011, 0); parts.push(coloured(body, look.base));
  const stripe = new THREE.BoxGeometry(L * 0.5, 0.024, W * 0.32); stripe.translate(0.05, 0.012, 0); parts.push(coloured(stripe, look.art));
  const tip = new THREE.BoxGeometry(L * 0.14, 0.02, W * 0.94); tip.rotateZ(0.42); tip.translate(L * 0.43, 0.04, 0); parts.push(coloured(tip, look.tip));
  const binding = new THREE.BoxGeometry(0.3, 0.05, W * 0.9); binding.translate(0, 0.045, 0); parts.push(coloured(binding, 0x2b2f36));
  const boot = new THREE.BoxGeometry(0.32, 0.16, 0.11); boot.translate(0.02, 0.13, 0); parts.push(coloured(boot, 0x16171a));
  return parts;
}

export function createFirstPerson({ scene, overlay, look }) {
  const skiMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  let skis = null;
  function buildSkis(lk) {
    if (skis) { skis.geometry.dispose(); }
    const parts = [];
    for (const side of [-1, 1]) for (const g of skiGeometry(lk)) { g.translate(0, 0, side * 0.12); parts.push(g); }
    const geo = merge(parts);
    if (skis) skis.geometry = geo; else { skis = new THREE.Mesh(geo, skiMat); skis.name = 'ski-fp-skis'; skis.frustumCulled = false; skis.visible = false; scene.add(skis); }
  }
  buildSkis(look);
  // poles in camera space (built along -y from the grip at the origin, moved each frame onto the hands)
  const poleParts = [];
  for (const side of [-1, 1]) {
    const shaft = new THREE.CylinderGeometry(0.009, 0.009, 1.2, 6); shaft.translate(0, -0.6, 0);
    const grip = new THREE.CylinderGeometry(0.019, 0.017, 0.13, 8); grip.translate(0, 0.02, 0);
    const basket = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10); basket.translate(0, -1.08, 0);
    for (const [g, hex] of [[shaft, 0x9aa3ad], [grip, 0x16171a], [basket, 0x16171a]]) {
      g.rotateX(0.62); g.rotateZ(side * 0.2);                 // tilted forward-out, as held while skiing
      g.translate(side * 0.37, -0.4, -0.6);                   // R8b: lower and further out: the hands frame the picture, never fill it
      poleParts.push(coloured(g, hex));
    }
    for (const [g, hex] of handParts(side, [side * 0.365, -0.385, -0.59])) poleParts.push(coloured(g, hex));      // R8c: gloves + sleeves (fp-hands.js); R8d: on R8b's lower / wider grips
  }
  const poles = new THREE.Mesh(merge(poleParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  poles.name = 'ski-fp-poles'; poles.frustumCulled = false; poles.visible = false; poles.renderOrder = 9;
  scene.add(poles);
  const streak = document.createElement('div');
  streak.id = 'fpStreak';
  overlay.appendChild(streak);

  let yaw = null, bobT = 0, fovNow = FP.fov, roll = 0, dip = 0, on = false;
  const n = { x: 0, y: 1, z: 0 };
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3();
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: FP.fov, roll: 0 };

  /** The first-person camera pose for a skier state (and the skis placed under him). normal(x, z, out), height(x, z). */
  function update(s, dt, time, normal, height) {
    const ground = height(s.x, s.z);
    const feetY = Math.max(s.y, ground);
    if (yaw === null) yaw = s.heading;
    let d = s.heading - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * 9);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const speed = s.speed || 0;
    // skis: on the snow under the boots, along the heading, tilted with the slope and rolled onto the edge
    normal(s.x, s.z, n);
    nv.set(n.x, n.y, n.z);
    qy.setFromAxisAngle(up, -s.heading);
    q.setFromUnitVectors(up, nv).multiply(qy);
    skis.position.set(s.x, feetY + (s.grounded ? 0.01 : 0), s.z);
    skis.quaternion.copy(q);
    skis.rotateX(-(s.edge || 0) * FP.skiRoll);
    // the head: tuck lowers it, the bumps and the speed bob it, a landing dips it, the turn leans it
    const tuck = s.tuck || 0;
    const eye = FP.eye + (FP.eyeTuck - FP.eye) * tuck;
    bobT += dt * (2.2 + speed * 0.32);
    const bob = Math.sin(bobT * 2) * FP.bob * smoothstep(1, 12, speed) * (s.grounded ? 1 : 0.2);
    dip += (Math.min(0.25, (s.landed || 0) * 0.3) - dip) * Math.min(1, dt * 10);
    const wantRoll = -(s.edge || 0) * FP.lean * smoothstep(3, 14, speed) + (s.crash > 0 ? Math.sin(time * 6) * 0.5 : 0);
    roll += (wantRoll - roll) * Math.min(1, dt * 6);
    out.x = s.x - cy * FP.back; out.z = s.z - sy * FP.back;
    out.y = Math.max(feetY + eye + bob - dip, height(out.x, out.z) + 0.5);
    // look along the skis, down the slope ahead (the ground 12 m ahead), a little down so the tips are in view
    const ax = s.x + cy * 12, az = s.z + sy * 12;
    const aheadY = Math.min(feetY, height(ax, az) + 0.4);
    out.tx = ax; out.tz = az;
    // about 20° down: the horizon in the upper third, the ski tips at the bottom of the picture
    out.ty = aheadY * 0.5 + feetY * 0.5 + eye - 4.6 - tuck * 0.4;
    const wantFov = FP.fov + FP.fovKick * smoothstep(FP.kickFrom, FP.kickTo, speed);
    fovNow += (wantFov - fovNow) * Math.min(1, dt * (wantFov > fovNow ? 2.2 : 1.4));
    out.fov = fovNow;
    out.roll = roll;
    return out;
  }
  /** After the camera has its pose: the poles go with it (hands in front of the chest); the streak follows the speed. */
  function afterCamera(camera, s, streakOn) {
    poles.position.copy(camera.position);
    poles.quaternion.copy(camera.quaternion);
    if (s && s.tuck > 0.5) poles.rotateX(-0.9 * s.tuck);           // tucked: the poles go under the arms
    const k = streakOn && s ? smoothstep(FP.streakFrom, 30, s.speed) * 0.32 : 0;
    streak.style.opacity = k > 0.005 ? k.toFixed(3) : '0';
    if (k > 0.005) streak.style.transform = `rotate(${((Math.random() - 0.5) * 2.4).toFixed(2)}deg) scale(${(1.02 + Math.random() * 0.02).toFixed(3)})`;
  }
  function setOn(v, ridingWindow = false) {
    on = !!v;
    skis.visible = on && !ridingWindow;
    poles.visible = on && !ridingWindow;
    if (!on) streak.style.opacity = '0';
  }
  return {
    update, afterCamera, setOn, snap() { yaw = null; },
    get on() { return on; },
    setLook(lk) { buildSkis(lk); skis.visible = on; },
    meshes: { skis: () => skis, poles },
  };
}
