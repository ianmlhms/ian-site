/* Landmarks of a resort (resort.json "landmarks", set per resort in scripts/ski/common.py): the few objects that make a place recognisable
 * beyond its terrain, painted in our own low-poly look (plain Lambert colours, scene lights + fog, no textures except painted sign boards).
 * Kinds
 *   bell            Concordia 2000 (Kronplatz): round stone drum with a concrete rim, a steel spire of four slanted legs with a cross, the bell
 *                   hanging in a frame inside
 *   mmm             Messner Mountain Museum Corones (Zaha Hadid): angular concrete canopies rising out of the summit slope, dark glass
 *                   fronts, the long viewing window cantilevered towards `face` (degrees from north)
 *   summit-station  a summit cable car station: `antenna` = the white lattice mast of the Valluga, `big` = a large glass-fronted top
 *                   station (Galzig), a name board either way
 *   pass            a pass: the road sign with the name and a row of flag poles (Arlberg pass at St. Christoph)
 *   chapel          a white chapel with a square tower and a tall dark spire
 *   worldcup        a race piste (`piste` = its id): red safety nets along both edges where it is steep, a start house with a banner
 *                   at the top (`house: false`: nets only, for the second part of a course)
 * Built once the height tiles are in (like the lifts); hidden beyond `radius`. */
import { createLineIndex } from './pistes.js';
import { createNetMaterial } from './netmesh.js';

const THREE = window.THREE;

const COL = {
  stone: 0x6c5f53, concrete: 0xbab7b0, steel: 0x7b838c, bronze: 0x7a5f3a, glass: 0x2c3946, wood: 0x6b4a32, roofDark: 0x3d4148,
  white: 0xf2f2ee, red: 0xd2322b, antenna: 0xe9edf0, sign: 0xf4f1e8, netRed: 0xe0362a,
};

const mats = new Map();
function mat(color, opts = {}) {
  const key = `${color}:${opts.transparent ? 1 : 0}:${opts.side || 0}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return mats.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

/** A beam between two points (a thin box). */
function beam(a, b, t, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, d.length(), t), mat(color));
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function signTexture(lines, { bg = '#f4f1e8', fg = '#1d2a3a', border = '#1d2a3a', w = 512, h = 192 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const size = lines.length > 1 ? 58 : 72;
  lines.forEach((text, i) => {
    g.font = `800 ${i ? size * 0.8 : size}px system-ui, -apple-system, sans-serif`;
    g.fillText(text, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05);
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
}

function board(lines, width, height, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshLambertMaterial({ map: signTexture(lines, opts), side: THREE.DoubleSide }));
  return m;
}

/* ---------------- kinds ---------------- */
function bell() {
  const g = new THREE.Group();
  const R = 6.4, H = 3.6;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.4, H + 2, 28), mat(COL.stone));
  drum.position.y = H / 2 - 1;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.25, 0.9, 28), mat(COL.concrete));
  rim.position.y = H + 0.45;
  const door = box(3.2, 3.0, 1.2, 0x34302c, 0, -0.2, R - 0.3);
  g.add(drum, rim, door);
  // four slanted steel legs from the rim to the tip, a ring frame half way, a cross on top
  const top = new THREE.Vector3(0, H + 15.2, 0);           // 21.8 m in all (OSM height)
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const foot = new THREE.Vector3(Math.cos(a) * (R + 2.2), -0.5, Math.sin(a) * (R + 2.2));     // the legs stand outside the drum
    g.add(beam(foot, top, 1.0, 0x5f666e));                    // dark steel: the spire reads against the sky from across the plateau
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.2, 6, 20), mat(COL.steel));
  ring.rotation.x = Math.PI / 2; ring.position.y = H + 9.6;
  g.add(ring);
  g.add(beam(new THREE.Vector3(0, top.y, 0), new THREE.Vector3(0, top.y + 2.6, 0), 0.25, COL.steel));
  g.add(beam(new THREE.Vector3(-0.9, top.y + 1.8, 0), new THREE.Vector3(0.9, top.y + 1.8, 0), 0.22, COL.steel));
  // bell frame (two posts + yoke) and the bell
  g.add(beam(new THREE.Vector3(-2.1, H + 0.5, 0), new THREE.Vector3(-2.1, H + 9.2, 0), 0.4, COL.steel));
  g.add(beam(new THREE.Vector3(2.1, H + 0.5, 0), new THREE.Vector3(2.1, H + 9.2, 0), 0.4, COL.steel));
  g.add(box(5.0, 0.8, 0.9, COL.steel, 0, H + 8.4, 0));
  g.add(box(1.5, 1.1, 0.5, COL.steel, 0, H + 7.3, 0));
  const prof = [[0, 0], [1.55, 0], [1.6, 0.25], [1.35, 0.6], [1.05, 1.4], [0.95, 2.2], [0.8, 2.6], [0.45, 2.85], [0, 2.9]].map(([x, y]) => new THREE.Vector2(x, y));
  const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 22), mat(COL.bronze));
  bellMesh.position.y = H + 4.4;
  g.add(bellMesh);
  return { group: g, footprint: R + 1.5 };
}

/** One concrete shard of the MMM Corones, cut out of the slope: a faceted wedge whose back is buried in the ridge (y < 0 behind) and
 * whose front leans out as a sharp visor over a dark glass face. w = width, d = depth into the ridge, h = visor height, lean = how far
 * the visor overhangs, skew = sideways shift of the top (the Hadid shear). Front faces -z. Flat-shaded triangles. */
function shard(w, d, h, lean, skew) {
  const A = [-w / 2, 0, 0], B = [w / 2, 0, 0];                                  // front foot (on the snow)
  const C = [w * 0.36 + skew, h, -lean], D = [-w * 0.3 + skew, h * 0.78, -lean * 0.6];   // visor tips
  const E = [-w / 2 - 1, -4, d], F = [w / 2 + 1, -4, d];                       // back corners, buried in the ridge
  const tris = [[D, C, F], [D, F, E], [A, D, E], [B, F, C]];                    // roof (two facets), sides
  const pos = [];
  for (const t of tris) for (const p of t) pos.push(...p);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat(COL.concrete, { side: THREE.DoubleSide })));
  // the glass face, set back under the visor (a quad A B C D pulled 1.2 m in)
  const inset = (p, k) => [p[0] * 0.94, p[1] * k, p[2] + 1.2];
  const gl = [inset(A, 1), inset(B, 1), inset(C, 0.93), inset(A, 1), inset(C, 0.93), inset(D, 0.93)];
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gl.flat(), 3));
  gg.computeVertexNormals();
  g.add(new THREE.Mesh(gg, mat(COL.glass, { side: THREE.DoubleSide })));
  return g;
}

function mmm(lm) {
  // Zaha Hadid's museum lies inside the summit ridge; what shows are angular concrete shards breaking out of the snow, each with a glass
  // face (the entrance hall, two viewing windows) and the long viewing platform cantilevered towards the Dolomites (`face`).
  const g = new THREE.Group();
  // [x, z, rotation, width, depth, visor height, lean, skew]
  const parts = [[0, 0, 0, 16, 20, 7.5, 4.5, 1.5], [-15, 6, 0.55, 9, 14, 5.5, 3.5, -1.2], [13, 8, -0.5, 8, 12, 4.8, 3, 1]];
  for (const [x, z, rot, w, d, h, lean, skew] of parts) {
    const c = shard(w, d, h, lean, skew);
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    g.add(c);
  }
  // the viewing platform: a long angular concrete tube cantilevered out of the main shard, its end all glass
  const tube = box(3.6, 3.0, 15, COL.concrete, 4, 1.6, -9);
  tube.rotation.x = -0.08; tube.rotation.y = 0.12;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.2), mat(COL.glass, { side: THREE.DoubleSide }));
  win.position.set(5, 3.2, -16.6); win.rotation.y = 0.12;
  g.add(tube, win);
  g.rotation.y = -THREE.MathUtils.degToRad(lm.face ?? 180);    // the glass fronts (local -z) look towards `face` (azimuth: x east, z south)
  return { group: g, footprint: 5 };          // cut into the summit: sits at its centre height, the slope covers the backs
}

function lattice(height, width, color) {
  const g = new THREE.Group();
  const w = width / 2;
  const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
  for (const [x, z] of corners) g.add(beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x * 0.7, height, z * 0.7), 0.55, color));
  for (let y = 3; y < height; y += 3.5) {
    const k = 1 - 0.3 * y / height;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      g.add(beam(new THREE.Vector3(ax * k, y, az * k), new THREE.Vector3(bx * k, y, bz * k), 0.32, color));
    }
  }
  return g;
}

/** A railing ring of steel posts and a top rail around (cx, cz) at y (a viewing deck's edge). */
function railing(g, cx, cz, r, y) {
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
    const p0 = new THREE.Vector3(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r), p1 = new THREE.Vector3(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r);
    g.add(beam(p0, p0.clone().setY(y + 1.1), 0.1, COL.steel));
    g.add(beam(p0.clone().setY(y + 1.1), p1.clone().setY(y + 1.1), 0.08, COL.steel));
  }
}

function summitStation(lm) {
  const g = new THREE.Group();
  const SINK = 30;                                            // foundations run this far down: on a ridge the station never hangs
  if (lm.big) {
    // a large top station (replaces the OSM boxes, option "clear"): dark timber-grey hall, a glass band towards the valley, flat roof
    g.add(box(30, 10 + SINK, 16, 0x5a5550, 0, -2 - SINK, 0), box(26, 5.2, 0.4, COL.glass, 0, 1.8, 8.1), box(32, 0.9, 18, COL.roofDark, 0, 8, 0));
  }
  if (lm.antenna) {
    // the Valluga top station: a squat stone-clad hall sitting on the summit rock, a glass band, the roof a viewing deck with a railing,
    // the white lattice mast with its dishes on top, the summit cross beside it
    g.add(box(13, 7 + SINK, 9, 0x6d665e, 0, -SINK, 0));
    g.add(box(11, 2.0, 0.3, COL.glass, 0, 3.6, 4.55), box(0.3, 2.0, 7, COL.glass, 6.55, 3.6, 0));
    g.add(box(14, 0.6, 10, COL.concrete, 0, 7, 0), box(13.6, 0.3, 9.6, COL.white, 0, 7.6, 0));
    railing(g, 0, 0, 6.4, 7.6);
    const mast = lattice(20, 5, COL.antenna);
    mast.position.set(3, 7.6, -1.5);
    g.add(mast);
    for (const [y, r] of [[24, 1.8], [20, 1.4], [16, 1.1]]) {
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 16), mat(COL.antenna));
      dish.rotation.x = Math.PI / 2; dish.position.set(3, y, 1.0);
      g.add(dish);
    }
    g.add(beam(new THREE.Vector3(-8.5, -0.5, -3), new THREE.Vector3(-8.5, 7.5, -3), 0.32, 0x3b2f25));
    g.add(beam(new THREE.Vector3(-10.4, 5.5, -3), new THREE.Vector3(-6.6, 5.5, -3), 0.28, 0x3b2f25));
  }
  if (lm.glacier) {
    // Matterhorn glacier paradise (Klein Matterhorn): the long top station cut into the rock below the summit, stone plinth, a two-storey
    // glass front towards the Matterhorn, a flat roof terrace, the cable's steel portal frame on the valley side
    g.add(box(44, 11 + SINK, 18, 0x5d5a56, 0, -SINK, 0));
    g.add(box(40, 6.5, 0.4, COL.glass, 0, 3.6, 9.05), box(0.4, 6.5, 14, COL.glass, 22.05, 3.6, 0));
    g.add(box(46, 0.8, 20, COL.concrete, 0, 11, 0), box(45.6, 0.35, 19.6, COL.white, 0, 11.8, 0));
    for (const x of [-21, 21]) for (const z of [-7, 7]) g.add(beam(new THREE.Vector3(x * 0.5 - 18, 11.5, z), new THREE.Vector3(x * 0.35 - 18, 24, z * 0.6), 0.7, COL.steel));
    g.add(box(18, 1.2, 9, COL.steel, -18, 23.5, 0));
  }
  if (lm.cross) {
    // a summit: steel viewing deck with a railing and the big summit cross
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 2 + SINK * 0.3, 16), mat(0x5d5a56)).translateY(1 - SINK * 0.15));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.4, 16), mat(COL.steel)).translateY(2.2));
    railing(g, 0, 0, 7.2, 2.4);
    g.add(beam(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(0, 12, 0), 0.45, COL.steel));
    g.add(beam(new THREE.Vector3(-2.4, 9.4, 0), new THREE.Vector3(2.4, 9.4, 0), 0.4, COL.steel));
    return { group: g, footprint: 3 };
  }
  const [title, sub] = lm.name.split(/\s(?=\d)/);
  const big = lm.big || lm.glacier;
  const name = board([title, sub || ''].filter(Boolean), big ? 10 : 5, big ? 3.75 : 2.1);
  name.position.set(0, lm.glacier ? 13.6 : lm.big ? 10.5 : lm.antenna ? 9.6 : 2.6, lm.glacier ? 9.3 : lm.big ? 8.3 : lm.antenna ? 4.8 : 2);
  g.add(name);
  if (!big && !lm.antenna) g.add(box(0.16, 3.2, 0.16, COL.steel, -2, -0.5, 1.95), box(0.16, 3.2, 0.16, COL.steel, 2, -0.5, 1.95));
  g.rotation.y = -THREE.MathUtils.degToRad(lm.face ?? 180) + Math.PI;      // the board (+z) looks towards `face`
  return { group: g, footprint: lm.glacier ? 6 : lm.big ? 18 : lm.antenna ? 3 : 4 };
}

function pass(lm) {
  const g = new THREE.Group();
  const [title, sub] = lm.name.split(/\s(?=\d)/);
  const sign = board([title, sub || ''].filter(Boolean), 5.2, 2.2, { bg: '#f7f6f1', fg: '#20304a', border: '#20304a' });
  sign.position.set(0, 3.6, 0);
  g.add(sign, box(0.16, 4.7, 0.16, COL.steel, -2.2, -0.5, -0.05), box(0.16, 4.7, 0.16, COL.steel, 2.2, -0.5, -0.05));
  // a row of flag poles beside it (painted red-white-red and white-red cloths, one blue; no emblems)
  const flags = [[0xd2322b, 0xffffff, 0xd2322b], [0xffffff, 0xd2322b, 0xffffff], [0xd2322b, 0xffffff, 0xd2322b], [0x2b4fa8, 0x2b4fa8, 0x2b4fa8], [0xd2322b, 0xffffff, 0xd2322b], [0xffffff, 0xd2322b, 0xffffff]];
  flags.forEach((bands, i) => {
    const x = -6 - i * 3.4;
    g.add(box(0.14, 9, 0.14, COL.white, x, -0.5, -1.5));
    bands.forEach((c, k) => g.add(box(1.6, 0.9, 0.06, c, x + 0.85, 8.5 - 0.4 - k * 0.9 - 0.45, -1.5)));
  });
  g.rotation.y = -THREE.MathUtils.degToRad(lm.face ?? 180) + Math.PI;      // the sign (+z) looks towards `face`
  return { group: g, footprint: 4 };
}

function chapel() {
  // the tower rises above the neighbouring hotel roofs (the Hospiz), a tall dark four-sided spire with a gilt cross
  const T = 19, S = 15;
  const g = new THREE.Group();
  g.add(box(6, T + 2, 6, COL.white, 0, -2, 0));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.0, S, 4), mat(COL.roofDark));
  spire.position.y = T + S / 2; spire.rotation.y = Math.PI / 4;
  g.add(spire);
  g.add(beam(new THREE.Vector3(0, T + S - 0.5, 0), new THREE.Vector3(0, T + S + 2.4, 0), 0.18, 0xc9a24a));
  g.add(beam(new THREE.Vector3(-0.7, T + S + 1.6, 0), new THREE.Vector3(0.7, T + S + 1.6, 0), 0.16, 0xc9a24a));
  for (const [x, z, ry] of [[0, 3.02, 0], [0, -3.02, Math.PI], [3.02, 0, Math.PI / 2], [-3.02, 0, -Math.PI / 2]]) {
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.2, 18), mat(0xf6f3ea));
    clock.position.set(x, T - 2.5, z); clock.rotation.y = ry;
    g.add(clock);
  }
  return { group: g, footprint: 5 };
}

/** R8g: where the race piste's A-nets stand (pure: the view and scripts/ski/barrier-check.mjs share it). Runs of [x, y, z, ...] (the
 *  snow under each vertex, every STEP m) and the post spots. The nets stood ACROSS every piste that crosses or joins the race piste
 *  (Ian, Arlberg: Stallmähder-Fang, Fasch, Nasserein ... crossed the Kandahar's nets, a 3.6 m red wall across their courses). Now a
 *  net is left open wherever it would come within CLEAR m of ANOTHER piste's corridor (its line + half width) and on the inside of the
 *  race piste's own tight bends (folded back over its own snow): a skier on any piste never meets one. */
export const WORLDCUP_NET_H = 3.6;
const WC_STEP = 4, WC_CLEAR = 2.5;
export function worldcupNets(piste, height, pistes = null) {
  const runs = [], posts = [];
  const hw = piste.halfWidth + 3;
  const q = {}, q2 = {};
  const others = pistes ? createLineIndex(pistes.list.filter((p) => p !== piste)) : null;
  const own = createLineIndex([piste]);
  const clear = (x, z) => own.distance(x, z, hw) >= hw - 1 && (!others || others.clearance(x, z, 120) >= WC_CLEAR);
  for (const side of [-1, 1]) {
    let run = [];
    const cut = () => { if (run.length >= 6) runs.push(run); run = []; };
    for (let s = 40; s < piste.length - 40; s += WC_STEP) {
      piste.at(s, q); piste.at(s + 30, q2);
      const steep = (height(q.x, q.z) - height(q2.x, q2.z)) / 30 > 0.22;
      const x = q.x - q.dz * hw * side, z = q.z + q.dx * hw * side;
      if (!steep || !clear(x, z)) { cut(); continue; }
      // the stretch from the last vertex (the outside of a bend jumps by metres) must be clear too
      const k = run.length;
      if (k && [0.25, 0.5, 0.75].some((t) => !clear(run[k - 3] + (x - run[k - 3]) * t, run[k - 1] + (z - run[k - 1]) * t))) cut();
      const y = height(x, z);
      run.push(x, y, z);
      if (Math.round(s / WC_STEP) % 2 === 0) posts.push([x, y, z]);
    }
    cut();
  }
  // a post only where a net hangs
  const onNet = new Set();
  for (const r of runs) for (let i = 0; i < r.length; i += 3) onNet.add(`${r[i]},${r[i + 2]}`);
  return { runs, posts: posts.filter(([x, , z]) => onNet.has(`${x},${z}`)) };
}

/** R8g: the start hut + banner stand at the race piste's top; only where no OTHER piste runs through that spot (Arlberg: the Fasch
 *  passes 0.7 m from the Kandahar's top, the Kapall ski route ends there: the hut stood in their courses). Pure. */
export function worldcupHouseClear(piste, pistes) {
  if (!pistes) return true;
  const others = createLineIndex(pistes.list.filter((p) => p !== piste));
  const q = piste.at(0, {});
  const spots = [[0, 0], [4, 0], [4, 2.8], [4, -2.8], [-0.5, 6], [-0.5, -6]];        // along the run, across it: hut corners, banner posts
  return spots.every(([a, c]) => others.clearance(q.x + q.dx * a - q.dz * c, q.z + q.dz * a + q.dx * c, 120) >= 1.5);
}

/** Red A-nets along both edges of a race piste (where it is steep), a start house at the top, finish banners at the bottom. */
function worldcup(lm, piste, height, pistes) {
  const g = new THREE.Group();
  if (!piste) return { group: g, footprint: 0, absolute: true };
  const pos = [], uv = [], idx = [];
  const NET_H = WORLDCUP_NET_H;
  const { runs, posts } = worldcupNets(piste, height, pistes);
  // one ribbon per run: bottom 0.2 m over the snow, u / v = metres along / up (one mesh tile per square metre)
  for (const r of runs) {
    let d = 0;
    for (let i = 0; i < r.length; i += 3) {
      if (i) d += Math.hypot(r[i] - r[i - 3], r[i + 2] - r[i - 1]);
      const v = pos.length / 3;
      pos.push(r[i], r[i + 1] + 0.2, r[i + 2], r[i], r[i + 1] + NET_H, r[i + 2]);
      uv.push(d, 0, d, NET_H - 0.2);
      if (i) idx.push(v - 2, v, v - 1, v - 1, v, v + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // R8g: a see-through red mesh (25 cm diamonds), not a 72 % opaque red wall
  const netMesh = new THREE.Mesh(geo, createNetMaterial({ color: '#e0362a', cells: 4, rows: 4 }));
  netMesh.name = 'ski-race-nets';
  g.add(netMesh);
  if (posts.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, NET_H + 0.4, 5).translate(0, (NET_H + 0.4) / 2, 0), mat(0x30343a), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); pole.setMatrixAt(i, m4); });
    g.add(pole);
  }
  // start house: a small timber hut with a banner, across the top of the run (house: false = only the nets)
  if (lm.house === false || !worldcupHouseClear(piste, pistes)) return { group: g, footprint: 0, absolute: true, centre: [lm.x, lm.z], radius: piste.length };
  const q = piste.at(0, {});
  const hut = new THREE.Group();
  hut.add(box(5, 3.2, 4, COL.wood, 0, -0.4, -4), box(5.6, 0.5, 4.6, COL.roofDark, 0, 2.8, -4));
  const banner = board([lm.name.toUpperCase()], 12, 1.8, { bg: '#d2322b', fg: '#ffffff', border: '#ffffff' });
  banner.position.set(0, 4.2, 0.5);
  hut.add(banner, box(0.25, 4.5, 0.25, COL.steel, -6, -0.3, 0.5), box(0.25, 4.5, 0.25, COL.steel, 6, -0.3, 0.5));
  hut.position.set(q.x, height(q.x, q.z), q.z);
  hut.rotation.y = Math.atan2(q.dx, q.dz) + Math.PI;
  g.add(hut);
  return { group: g, footprint: 0, absolute: true, centre: [lm.x, lm.z], radius: piste.length };
}

/** The painted face of the dam: concrete in pour blocks with rust and damp streaks, and the giant of Jean-Marie Pierret (1989) in our own
 * brush: a huge pale-blue figure leaning on the wall, arms spread to hold it up, drawn in soft outline. u = along the crest, v = down. */
function damTexture(lengthM, heightM) {
  const W = 2048, H = Math.round(Math.min(1024, W * heightM / lengthM / 4) * 4) || 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#c9c6bf'); grad.addColorStop(1, '#a9a59d');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // pour blocks (vertical joints every ~15 m), horizontal lifts, streaks running down
  const px = W / lengthM;
  g.strokeStyle = 'rgba(70,66,60,0.35)'; g.lineWidth = 2;
  for (let x = 15 * px; x < W; x += 15 * px) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = H / 12; y < H; y += H / 12) { g.globalAlpha = 0.25; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.globalAlpha = 1; }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 140; k++) {
    const x = rnd() * W, len = H * (0.15 + 0.6 * rnd());
    g.fillStyle = rnd() < 0.3 ? 'rgba(120,80,50,0.10)' : 'rgba(60,60,58,0.10)';
    g.fillRect(x, 0, 2 + rnd() * 7, len);
  }
  // the giant: centred, two thirds of the height, painted in pale blues with a darker outline
  const cx = W * 0.5, top = H * 0.08, s = H * 0.82;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const body = (fill, stroke, width) => {
    g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = width;
    g.beginPath();                                            // head
    g.ellipse(cx, top + s * 0.1, s * 0.07, s * 0.09, 0, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.beginPath();                                            // torso, arms spread up and out to the wall, legs apart
    g.moveTo(cx - s * 0.13, top + s * 0.22);
    g.quadraticCurveTo(cx - s * 0.32, top + s * 0.12, cx - s * 0.55, top + s * 0.02);        // left arm up
    g.lineTo(cx - s * 0.58, top + s * 0.1);
    g.quadraticCurveTo(cx - s * 0.33, top + s * 0.24, cx - s * 0.15, top + s * 0.36);
    g.quadraticCurveTo(cx - s * 0.17, top + s * 0.52, cx - s * 0.12, top + s * 0.6);         // waist
    g.lineTo(cx - s * 0.22, top + s * 0.98);                                                  // left leg
    g.lineTo(cx - s * 0.11, top + s * 0.98);
    g.lineTo(cx, top + s * 0.68);
    g.lineTo(cx + s * 0.11, top + s * 0.98);                                                  // right leg
    g.lineTo(cx + s * 0.22, top + s * 0.98);
    g.lineTo(cx + s * 0.12, top + s * 0.6);
    g.quadraticCurveTo(cx + s * 0.17, top + s * 0.52, cx + s * 0.15, top + s * 0.36);
    g.quadraticCurveTo(cx + s * 0.33, top + s * 0.24, cx + s * 0.58, top + s * 0.1);         // right arm up
    g.lineTo(cx + s * 0.55, top + s * 0.02);
    g.quadraticCurveTo(cx + s * 0.32, top + s * 0.12, cx + s * 0.13, top + s * 0.22);
    g.closePath();
    g.fill(); g.stroke();
  };
  body('rgba(150,182,206,0.92)', 'rgba(38,52,70,0.85)', Math.max(4, H * 0.012));
  // muscle shading: soft darker strokes
  g.strokeStyle = 'rgba(70,96,122,0.55)'; g.lineWidth = Math.max(3, H * 0.008);
  for (const [a, b, c2, d] of [[-0.08, 0.3, 0, 0.36], [0.08, 0.3, 0, 0.36], [-0.06, 0.45, 0.06, 0.45], [0, 0.36, 0, 0.58], [-0.3, 0.13, -0.18, 0.22], [0.3, 0.13, 0.18, 0.22]]) {
    g.beginPath(); g.moveTo(cx + a * s, top + b * s); g.lineTo(cx + c2 * s, top + d * s); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** The arch dam of a reservoir (`line` = the crest in world x, z pairs, convex towards `toward` = the lake): crest at `crest` m, the
 * downstream face battered down into the gorge (to the lowest ground below it) carries the painted giant; the upstream face shows above
 * the drawn-down ice. Two meshes. */
function dam(lm, height) {
  const g = new THREE.Group();
  const src = [];
  for (let i = 0; i + 1 < lm.line.length; i += 2) src.push([lm.line[i], lm.line[i + 1]]);
  // resample every ~6 m
  const pts = [];
  for (let i = 0; i + 1 < src.length; i++) {
    const [ax, az] = src[i], [bx, bz] = src[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 6));
    for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  pts.push(src[src.length - 1]);
  const [lx, lz] = lm.toward || [lm.x, lm.z + 100];
  let crest = lm.crest || 0;
  if (!crest) for (const [x, z] of pts) crest = Math.max(crest, height(x, z));
  const HALF = 4;                                             // crest 8 m wide
  const rows = pts.map(([x, z], i) => {
    const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(qz - pz), nz = qx - px;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (nx * (lx - x) + nz * (lz - z) > 0) { nx = -nx; nz = -nz; }   // n points downstream (away from the lake)
    let bottom = crest;
    for (let d = 0; d <= 90; d += 6) bottom = Math.min(bottom, height(x + nx * d, z + nz * d));
    const drop = Math.max(0, crest - bottom);
    const batter = drop * 0.16;
    return { x, z, nx, nz, bottom: bottom - 3, batter, up: height(x - nx * 12, z - nz * 12) - 3 };
  });
  let len = 0;
  const us = rows.map((r, i) => (i ? (len += Math.hypot(r.x - rows[i - 1].x, r.z - rows[i - 1].z)) : 0));
  const maxDrop = Math.max(...rows.map((r) => crest - r.bottom), 20);
  // downstream face (textured)
  const fp = [], fu = [], fi = [];
  rows.forEach((r, i) => {
    fp.push(r.x + r.nx * HALF, crest, r.z + r.nz * HALF, r.x + r.nx * (HALF + r.batter), r.bottom, r.z + r.nz * (HALF + r.batter));
    fu.push(us[i] / len, 1, us[i] / len, 1 - (crest - r.bottom) / maxDrop);
    if (i) { const a = (i - 1) * 2; fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
  fg.setIndex(fi);
  fg.computeVertexNormals();
  g.add(new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: damTexture(len, maxDrop), side: THREE.DoubleSide })));
  // crest (snow on top), parapets and the upstream face down to the ice
  const cp = [], ci = [];
  const quadStrip = (a, b) => {                              // a(i), b(i): two rails of points -> triangles
    const base = cp.length / 3;
    rows.forEach((r, i) => { cp.push(...a(r), ...b(r)); if (i) { const k = base + (i - 1) * 2; ci.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } });
  };
  quadStrip((r) => [r.x - r.nx * HALF, crest, r.z - r.nz * HALF], (r) => [r.x + r.nx * HALF, crest, r.z + r.nz * HALF]);
  quadStrip((r) => [r.x - r.nx * HALF, r.up, r.z - r.nz * HALF], (r) => [r.x - r.nx * HALF, crest + 1.1, r.z - r.nz * HALF]);
  quadStrip((r) => [r.x + r.nx * HALF, crest, r.z + r.nz * HALF], (r) => [r.x + r.nx * HALF, crest + 1.1, r.z + r.nz * HALF]);
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cg.setIndex(ci);
  cg.computeVertexNormals();
  g.add(new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: 0xc2beb6, side: THREE.DoubleSide })));
  const sg = new THREE.BufferGeometry();
  const sp = [], si = [];
  rows.forEach((r, i) => {
    sp.push(r.x - r.nx * (HALF - 0.4), crest + 0.25, r.z - r.nz * (HALF - 0.4), r.x + r.nx * (HALF - 0.4), crest + 0.25, r.z + r.nz * (HALF - 0.4));
    if (i) { const k = (i - 1) * 2; si.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setIndex(si);
  sg.computeVertexNormals();
  g.add(new THREE.Mesh(sg, mat(0xf4f6fa, { side: THREE.DoubleSide })));
  return { group: g, footprint: 0, absolute: true, centre: [lm.x, lm.z], radius: len };
}

const BUILD = { bell, mmm, 'summit-station': summitStation, pass, chapel };

/** Merges a landmark's plain meshes (one Lambert colour each, no texture, not transparent, not instanced) into one mesh per material,
 * with the group's own rotation baked in: a landmark costs a few draw calls instead of dozens. Textured boards, nets and instanced poles stay. */
function flatten(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();                            // g has no parent yet: matrixWorld = its own transform, baked in
  const byMat = new Map();
  const keep = [];
  g.traverse((o) => {
    if (!o.isMesh || o === g) return;
    if (o.isInstancedMesh || o.material.map || o.material.transparent) { keep.push(o); return; }
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  });
  const out = new THREE.Group();
  for (const [m, geos] of byMat) {
    let n = 0;
    for (const q of geos) n += q.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    let o = 0;
    for (const q of geos) { pos.set(q.attributes.position.array, o * 3); nrm.set(q.attributes.normal.array, o * 3); o += q.attributes.position.count; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    out.add(new THREE.Mesh(geo, m));
  }
  for (const o of keep) {
    const c = new THREE.Mesh(o.geometry, o.material);
    if (o.isInstancedMesh) { out.add(o); continue; }
    new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}

export function createLandmarks({ scene, resort, height, pistes }) {
  const group = new THREE.Group();
  group.name = 'ski-landmarks';
  scene.add(group);
  const items = [];
  for (const lm of resort.landmarks || []) {
    try {
      let built;
      if (lm.kind === 'worldcup') built = worldcup(lm, pistes && pistes.byId.get(lm.piste), height, pistes);
      else if (lm.kind === 'dam') built = dam(lm, height);
      else if (BUILD[lm.kind]) built = BUILD[lm.kind](lm);
      else continue;
      const { footprint, absolute } = built;
      const g = flatten(built.group);
      if (!absolute) {
        // sit on the lowest ground under the footprint (the base sinks in a little on a slope, never floats)
        let y = height(lm.x, lm.z);
        for (let k = 0; k < 8 && footprint; k++) { const a = k * Math.PI / 4; y = Math.min(y, height(lm.x + Math.cos(a) * footprint, lm.z + Math.sin(a) * footprint)); }
        g.position.set(lm.x, y, lm.z);
      }
      group.add(g);
      items.push({ g, x: built.centre ? built.centre[0] : lm.x, z: built.centre ? built.centre[1] : lm.z, r: built.radius || 0 });
    } catch (error) {
      console.warn('[ski] landmark failed', lm.name, error);
    }
  }
  return {
    count: items.length,
    update(px, pz, radius) {
      for (const it of items) it.g.visible = Math.hypot(it.x - px, it.z - pz) < radius + it.r;
    },
    dispose() { scene.remove(group); },
  };
}
