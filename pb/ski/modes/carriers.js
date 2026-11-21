/* The carrier the player rides (round 6): a more detailed chair / cabin / T-bar / carriage than the instanced ones of lifts.js (which
 * skips the player's own one while he rides). Two draw calls at most: one merged vertex-coloured frame and, for cabins, the glass
 * (see-through, so the third-person view shows the rider inside). Also used for friends riding the same lift (multiplayer).
 * Local frame: +x = the direction of travel, y up, the origin at the rope grip (train: the rail top under the carriage's middle). */
import { mergeParts } from './views.js';

const THREE = window.THREE;
const COL = Object.freeze({ frame: 0x3a3f48, steel: 0x8e96a3, cushion: 0x2a66d0, cushion2: 0x1f4fa8, bar: 0xf2b21c, cabin: 0xc8372e, cabinDark: 0x8f2620, roof: 0xe8eaee, floor: 0x2b2f36, train: 0xb8322b, trainDark: 0x6f1d18, rubber: 0x1b1d22 });

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

function chairParts(seats) {
  const W = Math.max(1.6, Math.min(4.2, seats * 0.52));
  const P = [];
  P.push([box(0.24, 0.16, 0.2), COL.steel, at(-0.3, -0.05, 0)]);                   // the rope grip
  P.push([box(0.07, 1.45, 0.07), COL.frame, at(-0.3, -0.75, 0)]);                   // hanger
  P.push([box(0.07, 0.07, W + 0.1), COL.frame, at(-0.3, -1.45, 0)]);                // the yoke over the back
  for (const z of [-W / 2, W / 2]) P.push([box(0.07, 0.62, 0.07), COL.frame, at(-0.33, -1.75, z)]);
  P.push([box(0.62, 0.1, W), COL.frame, at(-0.02, -2.1, 0)]);                       // seat pan
  P.push([box(0.08, 0.7, W), COL.frame, at(-0.36, -1.62, 0)]);                      // backrest
  const n = Math.max(2, Math.min(8, seats));
  for (let i = 0; i < n; i++) {
    const z = -W / 2 + (i + 0.5) * (W / n), c = i % 2 ? COL.cushion : COL.cushion2;
    P.push([box(0.5, 0.07, W / n - 0.06), c, at(0.0, -2.02, z)]);
    P.push([box(0.06, 0.5, W / n - 0.06), c, at(-0.31, -1.66, z)]);
  }
  // the safety bar (down while riding) with the footrest
  P.push([box(0.06, 0.06, W), COL.bar, at(0.42, -1.58, 0)]);
  for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) P.push([box(0.78, 0.06, 0.06), COL.bar, at(0.04, -1.5, z)]);
  P.push([box(0.24, 0.05, W * 0.9), COL.bar, at(0.56, -2.62, 0)]);
  for (const z of [-W * 0.3, W * 0.3]) P.push([box(0.05, 1.04, 0.05), COL.bar, at(0.48, -2.1, z)]);
  return { parts: P, glass: [] };
}

function cabinParts(L, Wd, H, floor, colour, dark, arms) {
  const P = [], G = [];
  const roof = floor + H, mid = (floor + roof) / 2;
  for (const z of arms) {
    P.push([box(0.3, 0.2, 0.22), COL.steel, at(0, -0.05, z)]);
    P.push([box(0.1, -roof, 0.1), COL.frame, at(0, roof / 2, z)]);
  }
  P.push([box(L + 0.1, 0.16, Wd + 0.1), COL.roof, at(0, roof + 0.08, 0)]);
  P.push([box(L, 0.12, Wd), COL.floor, at(0, floor - 0.06, 0)]);
  // the lower panels all round (the cabin colour), the posts at the corners and the door seam
  const low = H * 0.36;
  P.push([box(L, low, 0.06), colour, at(0, floor + low / 2, Wd / 2)]);
  P.push([box(L, low, 0.06), colour, at(0, floor + low / 2, -Wd / 2)]);
  P.push([box(0.06, low, Wd), colour, at(L / 2, floor + low / 2, 0)]);
  P.push([box(0.06, low, Wd), colour, at(-L / 2, floor + low / 2, 0)]);
  P.push([box(L + 0.04, 0.1, Wd + 0.04), dark, at(0, floor + low, 0)]);
  P.push([box(L + 0.06, 0.12, Wd + 0.06), dark, at(0, roof - 0.06, 0)]);
  for (const x of [-L / 2, L / 2]) for (const z of [-Wd / 2, Wd / 2]) P.push([box(0.08, H, 0.08), dark, at(x, mid, z)]);
  P.push([box(0.05, H - low, 0.04), dark, at(0, floor + low + (H - low) / 2, Wd / 2 + 0.02)]);
  // glass above the panels
  const gh = H - low - 0.12, gy = floor + low + gh / 2 + 0.05;
  G.push([box(L - 0.1, gh, 0.02), 0xffffff, at(0, gy, Wd / 2)], [box(L - 0.1, gh, 0.02), 0xffffff, at(0, gy, -Wd / 2)]);
  G.push([box(0.02, gh, Wd - 0.1), 0xffffff, at(L / 2, gy, 0)], [box(0.02, gh, Wd - 0.1), 0xffffff, at(-L / 2, gy, 0)]);
  return { parts: P, glass: G };
}

function trainParts() {
  const P = [], G = [];
  const L = 12.5, Wd = 2.6, floor = 0.55, H = 2.45;
  P.push([box(L - 2, 0.45, Wd - 0.5), COL.rubber, at(0, 0.3, 0)]);                  // bogies / chassis
  const low = 0.95, roof = floor + H;
  P.push([box(L, low, Wd), COL.train, at(0, floor + low / 2, 0)]);
  P.push([box(L, 0.1, Wd + 0.02), 0xf4f1ea, at(0, floor + low, 0)]);
  P.push([box(L + 0.1, 0.25, Wd + 0.1), COL.train, at(0, roof + 0.1, 0)]);
  for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 6) for (const z of [-Wd / 2, Wd / 2]) P.push([box(0.12, H - low, 0.08), COL.trainDark, at(x, floor + low + (H - low) / 2, z)]);
  P.push([box(L, 0.08, Wd - 0.1), COL.floor, at(0, floor + 0.02, 0)]);
  const gh = H - low - 0.1, gy = floor + low + gh / 2 + 0.05;
  G.push([box(L - 0.2, gh, 0.02), 0xffffff, at(0, gy, Wd / 2)], [box(L - 0.2, gh, 0.02), 0xffffff, at(0, gy, -Wd / 2)]);
  G.push([box(0.02, gh, Wd - 0.2), 0xffffff, at(L / 2, gy, 0)], [box(0.02, gh, Wd - 0.2), 0xffffff, at(-L / 2, gy, 0)]);
  return { parts: P, glass: G };
}

/** kind = lift-path.js class; seats from the data. place(w) with w = liftride.js riderAt() (+ w.y = the rider's own height for drag). */
export function createCarrier({ scene, kind, seats = 4 }) {
  const group = new THREE.Group();
  group.name = `ski-ride-${kind}`;
  group.rotation.order = 'YZX';
  const spec = kind === 'chair' ? chairParts(seats)
    : kind === 'gondola' ? cabinParts(2.0, 1.9, 2.15, -4.1, COL.cabin, COL.cabinDark, [0])
      : kind === 'cable' ? cabinParts(7.0, 4.4, 3.2, -6.1, 0xd9dde3, 0x5a616c, [-1.2, 1.2])
        : kind === 'train' ? trainParts()
          : { parts: [[box(0.3, 0.3, 0.3), COL.steel, at(0, -0.15, 0)]], glass: [] };
  const disposables = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const frame = new THREE.Mesh(mergeParts(spec.parts), mat);
  frame.castShadow = true; frame.frustumCulled = false;
  group.add(frame);
  disposables.push(frame.geometry, mat);
  if (spec.glass.length) {
    const gmat = new THREE.MeshLambertMaterial({ color: 0xcfe2f0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(mergeParts(spec.glass), gmat);
    glass.renderOrder = 4; glass.frustumCulled = false;
    group.add(glass);
    disposables.push(glass.geometry, gmat);
  }
  // the T-bar: a pole from the rope down to the rider's hips (its length changes with the ground under the rope) and the bar
  let pole = null, bar = null;
  if (kind === 'drag') {
    const pmat = new THREE.MeshLambertMaterial({ color: COL.frame });
    pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, -0.5, 0), pmat);
    bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), new THREE.MeshLambertMaterial({ color: COL.bar }));
    group.add(pole, bar);
    disposables.push(pole.geometry, pmat, bar.geometry, bar.material);
  }
  scene.add(group);
  return {
    group, kind,
    place(w) {
      group.position.set(w.cx, w.cy, w.cz);
      group.rotation.set(0, -w.heading, kind === 'train' ? w.pitch : 0);
      if (pole) {
        const len = Math.max(0.8, w.cy - (w.y + 0.72));
        // the rider is on the line itself, the rope above him: the pole leans back to the bar behind his thighs
        pole.scale.set(1, len, 1); pole.position.set(0, 0, 0); pole.rotation.set(0, 0, -0.12);
        bar.position.set(-0.12 * len - 0.05, -len, 0);
      }
    },
    setVisible(v) { group.visible = v; },
    dispose() { scene.remove(group); for (const d of disposables) d.dispose(); },
  };
}
