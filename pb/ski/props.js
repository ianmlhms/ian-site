/* Piste furniture: edge poles in the piste colour along every piste of the network (both sides, every 26 m, rebuilt around the camera),
 * and the run objects: start gate, finish arch, slalom gates (flag pairs, red and blue alternating). Plain Lambert materials (scene lights + fog). */
import { DIFF } from './config.js';

const THREE = window.THREE;
const POLE_GAP = 26;
const REBUILD = 45;
const DIFF_OF_LETTER = { g: 'green', b: 'blue', r: 'red', k: 'black' };

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg; g.font = '800 64px system-ui, -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 512, 6); g.fillRect(0, 90, 512, 6);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
}

export function createPoles({ scene, resort, height }) {
  const geo = new THREE.CylinderGeometry(0.045, 0.05, 1.9, 5).translate(0, 0.95, 0);
  const capGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 5).translate(0, 1.75, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xf08a1c });
  const CAP = 1800;
  const poles = new THREE.InstancedMesh(geo, mat, CAP);
  const caps = new THREE.InstancedMesh(capGeo, capMat, CAP);
  poles.count = 0; caps.count = 0;
  poles.frustumCulled = false; caps.frustumCulled = false;
  scene.add(poles, caps);
  // every pole position once (both edges of every line)
  const all = [];
  for (const line of resort.network) {
    if (line.a) continue;
    const p = line.p, hw = line.w + 1.2, diff = DIFF_OF_LETTER[line.d] || 'blue';
    let carry = POLE_GAP * 0.5;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const ux = dx / L, uz = dz / L;
      for (let t = carry; t < L; t += POLE_GAP) {
        const x = ax + ux * t, z = az + uz * t;
        all.push(x - uz * hw, z + ux * hw, diff, x + uz * hw, z - ux * hw, diff);
      }
      carry = (carry - L) % POLE_GAP; if (carry < 0) carry += POLE_GAP;
    }
  }
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const colours = Object.fromEntries(Object.entries(DIFF).map(([k, v]) => [k, new THREE.Color(v.hex)]));
  let last = { x: 1e9, z: 1e9 };
  function update(px, pz, radius) {
    if (Math.hypot(px - last.x, pz - last.z) < REBUILD) return;
    last = { x: px, z: pz };
    const r2 = radius * radius;
    let n = 0;
    for (let i = 0; i < all.length && n < CAP; i += 3) {
      const x = all[i], z = all[i + 1];
      const dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz > r2) continue;
      m.makeTranslation(x, height(x, z) - 0.15, z);
      poles.setMatrixAt(n, m); caps.setMatrixAt(n, m);
      col.copy(colours[all[i + 2]]); poles.setColorAt(n, col);
      n++;
    }
    poles.count = n; caps.count = n;
    poles.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
    if (poles.instanceColor) poles.instanceColor.needsUpdate = true;
  }
  return { update, total: all.length / 3, mesh: poles, reset() { last = { x: 1e9, z: 1e9 }; } };
}

/** The objects of one run: start gate at the top, finish arch at the bottom, slalom gates. dispose() removes them. */
export function createRunProps({ scene, piste, height, gates }) {
  const group = new THREE.Group();
  group.name = 'ski-run';
  const post = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const top = piste.at(0, {}), end = piste.at(piste.length, {});
  const arch = (p, text, bg, fg, width) => {
    const g = new THREE.Group();
    const y = height(p.x, p.z);
    const h = 4.2;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, h, 0.35), post);
      m.position.set(side * width / 2, h / 2 - 0.3, 0);
      g.add(m);
    }
    const tex = bannerTexture(text, bg, fg);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(width, 1.0, 0.12), [post, post, post, post, new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })]);
    banner.position.set(0, h - 0.6, 0);
    g.add(banner);
    g.position.set(p.x, y, p.z);
    g.rotation.y = -Math.atan2(p.dz, p.dx) + Math.PI / 2;           // the banner faces along the piste
    group.add(g);
    return g;
  };
  arch(top, 'START', '#1f7a4d', '#ffffff', 9);
  const finishPoint = piste.at(Math.max(0, piste.length - 2), {});
  arch(finishPoint, 'ZIL', '#d0352c', '#ffffff', Math.min(30, piste.halfWidth * 2 + 4));
  // slalom gates: an inner pole with a flag and an outer pole 4 m further out
  const flagGeo = new THREE.PlaneGeometry(0.75, 0.55).translate(0.4, 1.35, 0);
  const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 5).translate(0, 0.9, 0);
  const red = new THREE.MeshLambertMaterial({ color: 0xd8392f, side: THREE.DoubleSide }), blue = new THREE.MeshLambertMaterial({ color: 0x2f6fd8, side: THREE.DoubleSide });
  const gateMeshes = [];
  gates.forEach((g, i) => {
    const mat = i % 2 ? blue : red;
    const one = new THREE.Group();
    for (const extra of [0, 4]) {
      const off = g.off + Math.sign(g.off) * extra;
      const x = g.x - g.dz * (off - g.off), z = g.z + g.dx * (off - g.off);
      const pole = new THREE.Mesh(poleGeo, mat);
      pole.position.set(x, height(x, z) - 0.1, z);
      const flag = new THREE.Mesh(flagGeo, mat);
      flag.position.copy(pole.position);
      flag.rotation.y = -Math.atan2(g.dz, g.dx);
      one.add(pole, flag);
    }
    group.add(one);
    gateMeshes.push(one);
  });
  scene.add(group);
  return {
    group,
    markGate(i, ok) { const one = gateMeshes[i]; if (!one) return; one.children.forEach((c) => { c.material = ok ? c.material : new THREE.MeshLambertMaterial({ color: 0x777777, side: THREE.DoubleSide }); }); },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}
