/* The carriers (round 6, round 7-B: one model for all): chairs, gondola cabins, cable cars, drag-lift bars and train carriages. The
 * same part lists build the instanced carriers of lifts.js (every chair / cabin on the cable, near and far detail) and the player's own
 * carrier here (createCarrier, also friends riding the same lift), so the one you ride reads as the ones you see.
 * Local frame: +x = the direction of travel, +z = the up lane's side (the outer side), y up, the origin at the rope grip (train: the
 * rail top under the carriage's middle). Every chair / cabin hangs from the rope by a grip and a hanger arm.
 *   carrierParts(kind, { seats, sub, lod: 'near' | 'far', barUp })  -> { parts: [[geometry, colour, matrix]], glass: [...] }
 *   carrierGeometry(kind, opts)                                     -> { frame, glass } merged (vertex colours)
 *   createCarrier({ scene, kind, seats, sub })                      the player's carrier: place(w) with liftride.js riderAt() */
import { mergeParts } from './views.js';
import { chairWidth } from '../lift-path.js';

const THREE = window.THREE;
const COL = Object.freeze({ frame: 0x3a3f48, steel: 0x8e96a3, grip: 0x5d6570, cushion: 0x2a66d0, cushion2: 0x1f4fa8, bar: 0xf2b21c, cabin: 0xc8372e, cabinDark: 0x8f2620, roof: 0xe8eaee, floor: 0x2b2f36, train: 0xb8322b, trainDark: 0x6f1d18, rubber: 0x1b1d22, spring: 0x2f343c, platter: 0xd8402e });

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const atRot = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z);

function grip(P, z = 0, long = 0.5) {
  P.push([box(long, 0.2, 0.2), COL.grip, at(0, -0.02, z)]);                    // the grip on the rope
  P.push([box(0.14, 0.14, 0.26), COL.steel, at(0, 0.1, z)]);                   // its spring housing
}

function chairParts(seats, lod, barUp) {
  const W = chairWidth(seats);
  const P = [];
  grip(P, 0, 0.42);
  P.push([box(0.08, 1.45, 0.08), COL.frame, at(-0.3, -0.78, 0)]);               // hanger arm, bent back over the seat
  P.push([box(0.32, 0.08, 0.08), COL.frame, at(-0.15, -0.08, 0)]);
  P.push([box(0.08, 0.08, W + 0.1), COL.frame, at(-0.3, -1.45, 0)]);            // the yoke over the back
  for (const z of [-W / 2, W / 2]) P.push([box(0.07, 0.62, 0.07), COL.frame, at(-0.33, -1.75, z)]);
  P.push([box(0.62, 0.1, W), COL.frame, at(-0.02, -2.1, 0)]);                   // seat pan
  P.push([box(0.08, 0.7, W), COL.frame, at(-0.36, -1.62, 0)]);                  // backrest
  if (lod === 'far') { P.push([box(0.5, 0.08, W - 0.1), COL.cushion, at(0, -2.02, 0)]); return { parts: P, glass: [] }; }
  const n = Math.max(2, Math.min(8, seats));
  for (let i = 0; i < n; i++) {
    const z = -W / 2 + (i + 0.5) * (W / n), c = i % 2 ? COL.cushion : COL.cushion2;
    P.push([box(0.5, 0.07, W / n - 0.06), c, at(0.0, -2.02, z)]);
    P.push([box(0.06, 0.5, W / n - 0.06), c, at(-0.31, -1.66, z)]);
  }
  if (barUp) {                     // the safety bar raised over the riders' heads, the footrest with it
    P.push([box(0.06, 0.06, W), COL.bar, at(-0.02, -0.66, 0)]);
    for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) P.push([box(0.06, 0.82, 0.06), COL.bar, atRot(-0.17, -1.05, z, 0, 0, -0.35)]);
    P.push([box(0.05, 0.24, W * 0.9), COL.bar, at(0.1, -0.86, 0)]);
  } else {
    P.push([box(0.06, 0.06, W), COL.bar, at(0.42, -1.58, 0)]);
    for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) P.push([box(0.78, 0.06, 0.06), COL.bar, at(0.04, -1.5, z)]);
    // R8e (3V QA "Bouc Blanc": skis and poles through the footrest): the footrest bar right under the seated riders' boots (their skis
    // rest on it: skier-model.js poseSit, ski bases 2.46 m under the rope), its two struts at the bar's ends, outside every seat
    P.push([box(0.3, 0.05, W * 0.92), COL.bar, at(0.6, -2.495, 0)]);
    for (const z of [-W * 0.47, W * 0.47]) P.push([box(0.05, 0.93, 0.05), COL.bar, at(0.5, -2.02, z)]);
  }
  return { parts: P, glass: [] };
}

function cabinParts(L, Wd, H, floor, colour, dark, arms, lod) {
  const P = [], G = [];
  const roof = floor + H, mid = (floor + roof) / 2;
  for (const z of arms) {
    grip(P, z, 0.6);
    P.push([box(0.1, -roof, 0.1), COL.frame, at(0, roof / 2, z)]);              // the hanger arm down to the roof
    P.push([box(0.6, 0.1, 0.1), COL.frame, at(0, roof + 0.25, z)]);
  }
  P.push([box(L + 0.1, 0.16, Wd + 0.1), COL.roof, at(0, roof + 0.08, 0)]);
  P.push([box(L, 0.12, Wd), COL.floor, at(0, floor - 0.06, 0)]);
  if (lod === 'far') {
    P.push([box(L, H * 0.4, Wd), colour, at(0, floor + H * 0.2, 0)]);
    P.push([box(L - 0.04, H * 0.6 - 0.1, Wd - 0.04), 0x5b6f80, at(0, floor + H * 0.7 - 0.05, 0)]);
    return { parts: P, glass: G };
  }
  const low = H * 0.36;
  P.push([box(L, low, 0.06), colour, at(0, floor + low / 2, Wd / 2)]);
  P.push([box(L, low, 0.06), colour, at(0, floor + low / 2, -Wd / 2)]);
  P.push([box(0.06, low, Wd), colour, at(L / 2, floor + low / 2, 0)]);
  P.push([box(0.06, low, Wd), colour, at(-L / 2, floor + low / 2, 0)]);
  P.push([box(L + 0.04, 0.1, Wd + 0.04), dark, at(0, floor + low, 0)]);
  P.push([box(L + 0.06, 0.12, Wd + 0.06), 0xd5d8dd, at(0, roof - 0.06, 0)]);
  for (const x of [-L / 2, L / 2]) for (const z of [-Wd / 2, Wd / 2]) P.push([box(0.08, H, 0.08), dark, at(x, mid, z)]);
  P.push([box(0.05, H - low, 0.04), dark, at(0, floor + low + (H - low) / 2, Wd / 2 + 0.02)]);
  const gh = H - low - 0.12, gy = floor + low + gh / 2 + 0.05;
  G.push([box(L - 0.1, gh, 0.02), 0xffffff, at(0, gy, Wd / 2)], [box(L - 0.1, gh, 0.02), 0xffffff, at(0, gy, -Wd / 2)]);
  G.push([box(0.02, gh, Wd - 0.1), 0xffffff, at(L / 2, gy, 0)], [box(0.02, gh, Wd - 0.1), 0xffffff, at(-L / 2, gy, 0)]);
  return { parts: P, glass: G };
}

function trainParts(lod) {
  const P = [], G = [];
  const L = 12.5, Wd = 2.6, floor = 0.55, H = 2.45;
  P.push([box(L - 2, 0.45, Wd - 0.5), COL.rubber, at(0, 0.3, 0)]);
  const low = 0.95, roof = floor + H;
  P.push([box(L, low, Wd), COL.train, at(0, floor + low / 2, 0)]);
  P.push([box(L, 0.1, Wd + 0.02), 0xf4f1ea, at(0, floor + low, 0)]);
  P.push([box(L + 0.1, 0.25, Wd + 0.1), COL.train, at(0, roof + 0.1, 0)]);
  if (lod === 'far') { P.push([box(L - 0.1, H - low, Wd - 0.04), 0x5b6f80, at(0, floor + low + (H - low) / 2, 0)]); return { parts: P, glass: G }; }
  for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 6) for (const z of [-Wd / 2, Wd / 2]) P.push([box(0.12, H - low, 0.08), COL.trainDark, at(x, floor + low + (H - low) / 2, z)]);
  P.push([box(L, 0.08, Wd - 0.1), COL.floor, at(0, floor + 0.02, 0)]);
  for (const x of [L / 2 - 0.3, -L / 2 + 0.3]) P.push([box(0.12, 0.35, 1.2), 0xfff2c6, at(x + Math.sign(x) * 0.02, floor + 0.55, 0)]);   // head lamps
  const gh = H - low - 0.1, gy = floor + low + gh / 2 + 0.05;
  G.push([box(L - 0.2, gh, 0.02), 0xffffff, at(0, gy, Wd / 2)], [box(L - 0.2, gh, 0.02), 0xffffff, at(0, gy, -Wd / 2)]);
  G.push([box(0.02, gh, Wd - 0.2), 0xffffff, at(L / 2, gy, 0)], [box(0.02, gh, Wd - 0.2), 0xffffff, at(-L / 2, gy, 0)]);
  return { parts: P, glass: G };
}

/** A drag lift's bar: the grip, the spring box and (here, retracted: an empty bar) the pole with the T / platter / J. */
function dragParts(sub, pole = 0.75) {
  const P = [];
  grip(P, 0, 0.3);
  P.push([box(0.32, 0.5, 0.22), COL.spring, at(0, -0.4, 0)]);                  // the spring box (the line reels in and out of it)
  if (pole > 0) {
    P.push([box(0.05, pole, 0.05), COL.frame, at(0, -0.65 - pole / 2, 0)]);
    P.push(...dragEnd(sub, -0.65 - pole));
  }
  return { parts: P, glass: [] };
}
function dragEnd(sub, y) {
  if (sub === 'tbar') return [[box(0.08, 0.08, 1.1), COL.bar, at(0, y, 0)], [box(0.06, 0.18, 0.06), COL.bar, at(0, y + 0.07, 0)]];
  if (sub === 'jbar') return [[box(0.08, 0.08, 0.55), COL.bar, at(0, y, 0.27)]];
  return [[cyl(0.19, 0.19, 0.06, 12), COL.platter, at(0, y - 0.03, 0)]];          // platter (Poma disc)
}

/** The parts of one carrier. */
export function carrierParts(kind, { seats = 4, sub = '', lod = 'near', barUp = true } = {}) {
  if (kind === 'chair') return chairParts(seats, lod, barUp);
  // R8e: a funitel cabin: big and wide (across the travel), hung from the two haul ropes 3.2 m apart by two grips (lift-path.js carrierBox)
  if (kind === 'gondola' && sub === 'funitel') return cabinParts(2.6, 3.4, 2.3, -4.8, COL.cabin, COL.cabinDark, [-1.6, 1.6], lod);
  if (kind === 'gondola') return cabinParts(2.0, 1.9, 2.15, -4.1, COL.cabin, COL.cabinDark, [0], lod);
  if (kind === 'cable') return cabinParts(7.0, 4.4, 3.2, -6.1, 0xd9dde3, 0x5a616c, [-1.2, 1.2], lod);
  if (kind === 'train') return trainParts(lod);
  if (kind === 'drag') return dragParts(sub);
  return { parts: [[box(0.3, 0.3, 0.3), COL.steel, at(0, -0.15, 0)]], glass: [] };
}
/** The merged geometries (frame: vertex colours; glass: see-through, or null). */
export function carrierGeometry(kind, opts) {
  const p = carrierParts(kind, opts);
  return { frame: mergeParts(p.parts), glass: p.glass.length ? mergeParts(p.glass) : null };
}

/** kind = lift-path.js class; seats / sub from the data. place(w) with w = liftride.js riderAt(): { cx, cy, cz, heading, pitch, roll,
 *  barDown, hip (drag: the rider's hip height, the pole reaches down to it) }. */
const DOWN = new THREE.Vector3(0, -1, 0), rodV = new THREE.Vector3(), rodD = new THREE.Vector3();
export function createCarrier({ scene, kind, seats = 4, sub = '' }) {
  const group = new THREE.Group();
  group.name = `ski-ride-${kind}`;
  group.rotation.order = 'YZX';
  const disposables = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(mat);
  const mesh = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.frustumCulled = false; group.add(m); disposables.push(geo); return m; };
  let barUp = null, barDown = null, pole = null, end = null;
  if (kind === 'chair') {
    // two meshes: the chair with the bar up (boarding, getting off) and down (riding)
    barUp = mesh(carrierGeometry('chair', { seats, barUp: true }).frame);
    barDown = mesh(carrierGeometry('chair', { seats, barUp: false }).frame);
    barDown.visible = false;
  } else if (kind === 'drag') {
    if (sub !== 'rope') {
      mesh(mergeParts(dragParts(sub, 0).parts));
      const pmat = new THREE.MeshLambertMaterial({ color: COL.frame });
      pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, -0.5, 0), pmat);
      end = new THREE.Mesh(mergeParts(dragEnd(sub, 0)), mat);
      group.add(pole, end);
      disposables.push(pole.geometry, pmat, end.geometry);
    }
  } else {
    const g = carrierGeometry(kind, { seats, sub });                     // R8e: a funitel cabin
    mesh(g.frame);
    if (g.glass) {
      const gmat = new THREE.MeshLambertMaterial({ color: 0xcfe2f0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
      const glass = new THREE.Mesh(g.glass, gmat);
      glass.renderOrder = 4; glass.frustumCulled = false;
      group.add(glass);
      disposables.push(g.glass, gmat);
    }
  }
  scene.add(group);
  return {
    group, kind,
    place(w) {
      group.position.set(w.cx, w.cy, w.cz);
      group.rotation.set(w.roll || 0, -w.heading, kind === 'train' ? w.pitch || 0 : 0);
      if (barUp) { const down = !!w.barDown; barUp.visible = !down; barDown.visible = down; }
      if (pole) {
        // the spring line reels out to the rider's hips (the bar behind his thighs); an empty bar hangs retracted
        const hip = w.hip !== undefined ? w.hip : w.cy - 1.4;
        if (w.x !== undefined && w.hip !== undefined) {
          // R8e: the rod from the spring box down and back to the disc / T between his legs (he rides 1 m behind the box, liftride.js)
          group.updateMatrixWorld(true);
          rodV.set(w.x + Math.cos(w.heading) * 0.04, hip, w.z + Math.sin(w.heading) * 0.04);
          group.worldToLocal(rodV);
          rodD.set(rodV.x, rodV.y + 0.65, rodV.z);
          const len = Math.max(0.5, rodD.length());
          pole.position.set(0, -0.65, 0); pole.scale.set(1, len, 1); pole.quaternion.setFromUnitVectors(DOWN, rodD.normalize());
          end.position.copy(rodV); end.rotation.set(0, 0, 0);
        } else {
          const len = Math.max(0.5, w.cy - 0.65 - hip);
          pole.scale.set(1, len, 1); pole.position.set(0, -0.65, 0); pole.rotation.set(0, 0, -0.1);
          end.position.set(-0.1 * len, -0.65 - len, 0);
        }
      }
    },
    setVisible(v) { group.visible = v; },
    dispose() { scene.remove(group); for (const d of disposables) d.dispose(); },
  };
}
