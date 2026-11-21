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
    g.add(beam(foot, top, 0.7, COL.steel));
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

/** A concrete cowl rising out of the slope: side profile (z back -> front, y up) extruded across w, a pointed visor over a dark glass front,
 * sheared sideways by `skew` (the angular Hadid look). The returned group's front faces -z. */
function cowl(w, d, h, skew) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(d, -1.5); shape.lineTo(d, 0); shape.quadraticCurveTo(d * 0.45, h * 0.95, 0, h); shape.lineTo(-2.6, h + 0.7);
  shape.lineTo(-1.6, h - 0.9); shape.lineTo(0, h - 1.4); shape.lineTo(0, -1.5); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 6 });
  // profile x -> world -z (front), profile y -> up, extrusion -> x; shear: the front edge leans sideways
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -w / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  geo.applyMatrix4(new THREE.Matrix4().set(1, skew / Math.max(1, h), 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mat(COL.concrete)));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.78, h - 2.2), mat(COL.glass, { side: THREE.DoubleSide }));
  glass.position.set(skew * 0.5, (h - 2.2) / 2 + 0.1, 0.15);
  g.add(glass);
  const turned = new THREE.Group();              // the extrusion's front faces +z: turn it to face -z like every landmark
  g.rotation.y = Math.PI;
  turned.add(g);
  return turned;
}

function mmm(lm) {
  const g = new THREE.Group();
  // [x, z, rotation, width, depth, height, skew]: the main hall and two smaller cowls stepping down the summit's south side
  const parts = [[0, 0, 0, 15, 22, 8, 3], [-16, 7, 0.4, 10, 16, 6, -2.5], [14, 10, -0.35, 9, 14, 5.2, 2]];
  for (const [x, z, rot, w, d, h, skew] of parts) {
    const c = cowl(w, d, h, skew);
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    g.add(c);
  }
  // the long viewing window cantilevered out of the main cowl
  const tube = box(3.4, 2.6, 12, COL.concrete, 3, 2.4, -6);
  tube.rotation.x = -0.1;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.8), mat(COL.glass, { side: THREE.DoubleSide }));
  win.position.set(3, 4.3, -12.1);
  g.add(tube, win);
  g.rotation.y = -THREE.MathUtils.degToRad(lm.face ?? 180);    // the glass fronts (local -z) look towards `face` (azimuth: x east, z south)
  return { group: g, footprint: 5 };          // dug into the summit: sits at its centre height, the slope may cover the back
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
    // a large top station (replaces the OSM box, option "clear"): dark timber-grey hall, a glass band towards the valley, flat roof
    g.add(box(30, 10, 16, 0x5a5550, 0, -2, 0), box(26, 5.2, 0.4, COL.glass, 0, 1.8, 8.1), box(32, 0.9, 18, COL.roofDark, 0, 8, 0));
  }
  if (lm.antenna) {
    // the white lattice mast with its dishes on the summit, the summit cross beside it (the station itself is the OSM building)
    const mast = lattice(20, 4.5, COL.antenna);
    mast.position.set(6, 0, -3);
    g.add(mast);
    for (const [y, r] of [[15.5, 1.3], [12, 1.0]]) {
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 16), mat(COL.antenna));
      dish.rotation.x = Math.PI / 2; dish.position.set(6, y, -0.6);
      g.add(dish);
    }
    g.add(beam(new THREE.Vector3(-6, -0.5, -2), new THREE.Vector3(-6, 6.5, -2), 0.3, 0x3b2f25));
    g.add(beam(new THREE.Vector3(-7.6, 4.8, -2), new THREE.Vector3(-4.4, 4.8, -2), 0.26, 0x3b2f25));
  }
  const [title, sub] = lm.name.split(/\s(?=\d)/);
  const name = board([title, sub || ''].filter(Boolean), lm.big ? 10 : 5, lm.big ? 3.75 : 2.1);
  name.position.set(0, lm.big ? 10.5 : 2.6, lm.big ? 8.3 : 2);
  g.add(name);
  if (!lm.big) g.add(box(0.16, 3.2, 0.16, COL.steel, -2, -0.5, 1.95), box(0.16, 3.2, 0.16, COL.steel, 2, -0.5, 1.95));
  g.rotation.y = -THREE.MathUtils.degToRad(lm.face ?? 180) + Math.PI;      // the board (+z) looks towards `face`
  return { group: g, footprint: lm.big ? 18 : 4 };
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
  // start house: a small timber hut with a banner, across the top of the run (house: false = only the nets)
  if (lm.house === false) return { group: g, footprint: 0, absolute: true, centre: [lm.x, lm.z], radius: piste.length };
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
