/* Landmarks of a resort (resort.json "landmarks", set per resort in scripts/ski/common.py): the few objects that make a place recognisable
 * beyond its terrain, painted in our own low-poly look (plain Lambert colours, scene lights + fog, no textures except painted sign boards).
 * Kinds
 *   bell            Concordia 2000 (Kronplatz): round stone drum with a concrete rim, a steel spire of four slanted legs with a cross, the bell
 *                   hanging in a frame inside
 *   mmm             Messner Mountain Museum Corones (Zaha Hadid): angular concrete canopies rising out of the summit slope, dark glass
 *                   fronts, the long viewing window cantilevered towards `face` (degrees from north)
 *   plateau         a summit plateau: only a label on the piste map (the terrain itself is the landmark)
 *   summit-station  a summit cable car station: `antenna` = the white lattice mast of the Valluga, `big` = a large glass-fronted top
 *                   station (Galzig), a name board either way
 *   pass            a pass: the road sign with the name and a row of flag poles (Arlberg pass at St. Christoph)
 *   chapel          a white chapel with a square tower and a tall dark spire
 *   worldcup        a race piste (`piste` = its id): red safety nets along both edges, a start house and finish banners
 * Built once the height tiles are in (like the lifts); hidden beyond `radius`. */
const THREE = window.THREE;

const COL = {
  stone: 0x8c8174, concrete: 0xc9c6bf, steel: 0x9aa1a9, bronze: 0x7a5f3a, glass: 0x2c3946, wood: 0x6b4a32, roofDark: 0x3d4148,
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
  const R = 7.2, H = 4.2;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.4, H + 2, 28), mat(COL.stone));
  drum.position.y = H / 2 - 1;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.25, 0.9, 28), mat(COL.concrete));
  rim.position.y = H + 0.45;
  const door = box(3.2, 3.0, 1.2, 0x34302c, 0, -0.2, R - 0.3);
  g.add(drum, rim, door);
  // four slanted steel legs from the rim to the tip, a ring frame half way, a cross on top
  const top = new THREE.Vector3(0, H + 24, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const foot = new THREE.Vector3(Math.cos(a) * (R + 1.2), H - 1.5, Math.sin(a) * (R + 1.2));
    g.add(beam(foot, top, 0.7, COL.steel));
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 6, 20), mat(COL.steel));
  ring.rotation.x = Math.PI / 2; ring.position.y = H + 13.5;
  g.add(ring);
  g.add(beam(new THREE.Vector3(0, top.y, 0), new THREE.Vector3(0, top.y + 2.6, 0), 0.25, COL.steel));
  g.add(beam(new THREE.Vector3(-0.9, top.y + 1.8, 0), new THREE.Vector3(0.9, top.y + 1.8, 0), 0.22, COL.steel));
  // bell frame (two posts + yoke) and the bell
  g.add(beam(new THREE.Vector3(-2.3, H + 0.5, 0), new THREE.Vector3(-2.3, H + 12.5, 0), 0.45, COL.steel));
  g.add(beam(new THREE.Vector3(2.3, H + 0.5, 0), new THREE.Vector3(2.3, H + 12.5, 0), 0.45, COL.steel));
  g.add(box(5.4, 0.9, 1.0, COL.steel, 0, H + 11.6, 0));
  g.add(box(1.6, 1.2, 0.5, COL.steel, 0, H + 10.4, 0));
  const prof = [[0, 0], [1.55, 0], [1.6, 0.25], [1.35, 0.6], [1.05, 1.4], [0.95, 2.2], [0.8, 2.6], [0.45, 2.85], [0, 2.9]].map(([x, y]) => new THREE.Vector2(x, y));
  const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 22), mat(COL.bronze));
  bellMesh.position.y = H + 7.5;
  g.add(bellMesh);
  return { group: g, footprint: R + 1.5 };
}

/** A wedge-shaped canopy: a slab rising out of the ground from back (y = 0) to a front edge (height h), w wide, d deep; glass under the front. */
function canopy(w, d, h, skew) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2 + skew, 0); shape.lineTo(w / 2 - skew * 0.4, d); shape.lineTo(-w / 2 + skew * 0.6, d * 0.92); shape.closePath();
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false }), mat(COL.concrete));
  // the shape lies in x / y; turn it so y -> -z (towards the front) and tilt the front up
  slab.rotation.x = -Math.PI / 2 + Math.atan2(h, d);
  g.add(slab);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, h * 0.92), mat(COL.glass, { side: THREE.DoubleSide }));
  front.position.set(skew * 0.1, h * 0.46 - 0.3, -d * Math.cos(Math.atan2(h, d)) + 0.6);
  g.add(front);
  // side walls (concrete) under the slab
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BufferGeometry(), mat(COL.concrete, { side: THREE.DoubleSide }));
    const x = sx * w * 0.45, zf = -d * Math.cos(Math.atan2(h, d)) + 0.6;
    wall.geometry.setAttribute('position', new THREE.Float32BufferAttribute([x, -1, 0, x, -1, zf, x, h - 0.2, zf], 3));
    wall.geometry.computeVertexNormals();
    g.add(wall);
  }
  return g;
}

function mmm(lm) {
  const g = new THREE.Group();
  const parts = [[0, 0, 0, 16, 20, 7.5, 2.5], [-15, 6, 0.35, 11, 15, 5.5, -1.5], [13, 9, -0.3, 10, 13, 4.8, 1.2]];
  for (const [x, z, rot, w, d, h, skew] of parts) {
    const c = canopy(w, d, h, skew);
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    g.add(c);
  }
  // the long viewing window cantilevered out of the main canopy
  const tube = box(3.2, 2.4, 13, COL.concrete, 2, 2.2, -14);
  tube.rotation.x = -0.12;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), mat(COL.glass, { side: THREE.DoubleSide }));
  win.position.set(2, 3.6, -20.6);
  g.add(tube, win);
  g.rotation.y = Math.PI - THREE.MathUtils.degToRad(lm.face || 180);    // canopy fronts look towards `face`
  return { group: g, footprint: 22 };
}

function lattice(height, width, color) {
  const g = new THREE.Group();
  const w = width / 2;
  const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
  for (const [x, z] of corners) g.add(beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x * 0.7, height, z * 0.7), 0.3, color));
  for (let y = 3; y < height; y += 3.5) {
    const k = 1 - 0.3 * y / height;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      g.add(beam(new THREE.Vector3(ax * k, y, az * k), new THREE.Vector3(bx * k, y, bz * k), 0.18, color));
    }
  }
  return g;
}

function summitStation(lm) {
  const g = new THREE.Group();
  if (lm.big) {
    g.add(box(30, 9, 16, 0x5d5a57, 0, -2, 0));
    const glass = box(26, 5.5, 0.4, COL.glass, 0, 1.5, 8.1);
    g.add(glass, box(32, 0.9, 18, COL.roofDark, 0, 7, 0));
  } else {
    g.add(box(9, 6, 7, 0x6a645c, 0, -2, 0), box(10, 0.7, 8, COL.roofDark, 0, 4, 0));
  }
  if (lm.antenna) {
    const mast = lattice(20, 5, COL.antenna);
    mast.position.set(lm.big ? 12 : 3, 4.5, 0);
    g.add(mast);
    for (const [y, r] of [[16, 1.3], [12.5, 1.0]]) {
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 16), mat(COL.antenna));
      dish.rotation.z = Math.PI / 2; dish.position.set((lm.big ? 12 : 3) + 2.2, 4.5 + y, 0.8);
      g.add(dish);
    }
    g.add(beam(new THREE.Vector3(-4, 4.5, -2), new THREE.Vector3(-4, 10, -2), 0.25, 0x3b2f25));   // summit cross
    g.add(beam(new THREE.Vector3(-5.4, 8.6, -2), new THREE.Vector3(-2.6, 8.6, -2), 0.22, 0x3b2f25));
  }
  const name = board(lm.name.split(/\s(?=\d)/), lm.big ? 10 : 6, lm.big ? 3.75 : 2.25);
  name.position.set(0, lm.big ? 9.5 : 6.3, lm.big ? 8.3 : 3.7);
  g.add(name);
  return { group: g, footprint: lm.big ? 18 : 8 };
}

function pass(lm) {
  const g = new THREE.Group();
  const [title, sub] = lm.name.split(/\s(?=\d)/);
  const sign = board([title, sub || ''].filter(Boolean), 5.2, 2.2, { bg: '#f7f6f1', fg: '#20304a', border: '#20304a' });
  sign.position.set(0, 3.6, 0);
  g.add(sign, box(0.16, 4.7, 0.16, COL.steel, -2.2, -0.5, -0.05), box(0.16, 4.7, 0.16, COL.steel, 2.2, -0.5, -0.05));
  // a row of flag poles: Austria, Tirol, Vorarlberg, the EU (painted cloths, no logos)
  const flags = [[0xd2322b, 0xffffff, 0xd2322b], [0xffffff, 0xd2322b, 0xffffff], [0xd2322b, 0xffffff, 0xd2322b], [0x2b4fa8, 0x2b4fa8, 0x2b4fa8], [0xd2322b, 0xffffff, 0xd2322b], [0xffffff, 0xd2322b, 0xffffff]];
  flags.forEach((bands, i) => {
    const x = 6 + i * 3.4;
    g.add(box(0.14, 9, 0.14, COL.white, x, -0.5, 1.5));
    bands.forEach((c, k) => { const b = box(0.06, 0.9, 1.6, c, x, 8.5 - 3 - k * 0.9 - 0.4, 1.5 + 0.9); g.add(b); });
  });
  return { group: g, footprint: 26 };
}

function chapel() {
  const g = new THREE.Group();
  g.add(box(6, 14, 6, COL.white, 0, -2, 0));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.0, 12, 4), mat(COL.roofDark));
  spire.position.y = 12 + 6; spire.rotation.y = Math.PI / 4;
  g.add(spire);
  g.add(beam(new THREE.Vector3(0, 24, 0), new THREE.Vector3(0, 26.4, 0), 0.18, 0xc9a24a));
  g.add(beam(new THREE.Vector3(-0.7, 25.6, 0), new THREE.Vector3(0.7, 25.6, 0), 0.16, 0xc9a24a));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.2, 18), mat(0xf6f3ea));
  clock.position.set(0, 9.5, 3.02);
  g.add(clock);
  return { group: g, footprint: 5 };
}

/** Red A-nets along both edges of a race piste (where it is steep), a start house at the top, finish banners at the bottom. */
function worldcup(lm, piste, height) {
  const g = new THREE.Group();
  if (!piste) return { group: g, footprint: 0, absolute: true };
  const pos = [], idx = [];
  const posts = [];
  const NET_H = 3.6, STEP = 8, hw = piste.halfWidth + 3;
  const q = {}, q2 = {};
  for (const side of [-1, 1]) {
    let prev = null;
    for (let s = 40; s < piste.length - 40; s += STEP) {
      piste.at(s, q); piste.at(s + 30, q2);
      const steep = (height(q.x, q.z) - height(q2.x, q2.z)) / 30 > 0.22;
      const x = q.x - q.dz * hw * side, z = q.z + q.dx * hw * side;
      const y = height(x, z);
      if (!steep) { prev = null; continue; }
      if (prev) {
        const base = pos.length / 3;
        pos.push(prev.x, prev.y + 0.2, prev.z, x, y + 0.2, z, x, y + NET_H, z, prev.x, prev.y + NET_H, prev.z);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      if (Math.round(s / STEP) % 2 === 0) posts.push([x, y, z]);
      prev = { x, y, z };
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COL.netRed, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })));
  if (posts.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, NET_H + 0.4, 5).translate(0, (NET_H + 0.4) / 2, 0), mat(0x30343a), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); pole.setMatrixAt(i, m4); });
    g.add(pole);
  }
  // start house: a small timber hut with a banner, across the top of the run
  piste.at(0, q);
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

const BUILD = { bell, mmm, 'summit-station': summitStation, pass, chapel };

export function createLandmarks({ scene, resort, height, pistes }) {
  const group = new THREE.Group();
  group.name = 'ski-landmarks';
  scene.add(group);
  const items = [];
  for (const lm of resort.landmarks || []) {
    try {
      let built;
      if (lm.kind === 'worldcup') built = worldcup(lm, pistes && pistes.byId.get(lm.piste), height);
      else if (BUILD[lm.kind]) built = BUILD[lm.kind](lm);
      else continue;
      const { group: g, footprint, absolute } = built;
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
