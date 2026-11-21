/* Lifts (scenery): the real OSM lift lines with their pylons, two ropes, the bottom and top stations, and the chairs / cabins / T-bars /
 * trains moving up one side and down the other. Lifts farther than quality.liftRadius are hidden; the carriers of the visible ones are
 * moved every frame (instanced). Magic carpets are skipped (flat on the ground, hidden by the snow anyway). The line of every lift comes
 * from lift-path.js (also what modes/liftride.js rides).
 * Round 6: setRide(index, s) holds one carrier of that lift at s (the player's own, drawn by the ride in more detail, so the pool skips
 * it; the lift's other carriers keep their spacing around it, and they carry on from there smoothly when the ride ends). */
const THREE = window.THREE;

import { createLiftPath } from './lift-path.js';

export function createLifts({ scene, resort, height }) {
  const lifts = [];
  const byIndex = new Map();
  resort.lifts.forEach((src, index) => {
    const path = createLiftPath(src, height);
    if (!path) return;
    const l = { ...path, index, offset: 0, ride: null };
    lifts.push(l); byIndex.set(index, l);
  });

  const group = new THREE.Group();
  group.name = 'ski-lifts';
  scene.add(group);
  const metal = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x343a44 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x23262c });
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const disposables = [];

  // static parts per lift: pylons + crossbars (instanced over all lifts), stations, ropes (rails for trains)
  const towerGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 6).translate(0, 0.5, 0);
  const barGeo = new THREE.BoxGeometry(1, 0.35, 0.5);
  let towerCount = 0;
  for (const l of lifts) towerCount += l.supports.filter((s) => s.tower).length;
  const towers = new THREE.InstancedMesh(towerGeo, metal, Math.max(1, towerCount));
  const bars = new THREE.InstancedMesh(barGeo, dark, Math.max(1, towerCount));
  let ti = 0;
  const cablePts = [];
  const stationParts = [];             // [geometry, colour]: merged into one vertex-coloured mesh
  for (const l of lifts) {
    const { spec } = l;
    for (const s of l.supports) {
      if (!s.tower) continue;
      const q = l.at(s.s);
      const g = height(q.x, q.z) - 0.5;
      m4.compose(v3.set(q.x, g, q.z), q4.identity(), s3.set(1, s.y - g + 0.3, 1));
      towers.setMatrixAt(ti, m4);
      q4.setFromAxisAngle(up, -Math.atan2(q.dz, q.dx) + Math.PI / 2);
      m4.compose(v3.set(q.x, s.y + 0.2, q.z), q4, s3.set(Math.max(1.2, spec.side * 2 + 1), 1, 1));
      bars.setMatrixAt(ti, m4);
      ti++;
    }
    // two ropes (up on the right, down on the left), one for drag lifts; a train: two tracks of two rails each
    const sides = l.kind === 'train' ? [-spec.side - 0.5, -spec.side + 0.5, spec.side - 0.5, spec.side + 0.5] : spec.side ? [-spec.side, spec.side] : [0];
    for (const off of sides) {
      for (let k = 0; k + 1 < l.supports.length; k++) {
        const a = l.supports[k], b = l.supports[k + 1];
        const qa = l.at(a.s), qb = l.at(b.s);
        cablePts.push(qa.x - qa.dz * off, a.y, qa.z + qa.dx * off, qb.x - qb.dz * off, b.y, qb.z + qb.dx * off);
      }
    }
    // stations: a concrete / timber hall with a glass band, and over it, at cable height, the bull-wheel under its snow-covered canopy
    for (const end of [0, l.len]) stationParts.push(...stationGeometry(l, end, height));
  }
  towers.instanceMatrix.needsUpdate = true; bars.instanceMatrix.needsUpdate = true;
  group.add(towers, bars);
  disposables.push(towerGeo, barGeo, metal, dark, cableMat);
  if (stationParts.length) {
    const geo = mergeColoured(stationParts), mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const st = new THREE.Mesh(geo, mat);
    st.castShadow = true; st.receiveShadow = true;
    group.add(st);
    disposables.push(geo, mat);
  }
  towers.castShadow = true; bars.castShadow = true; towers.receiveShadow = true;
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cg, cableMat);
  cables.frustumCulled = false;
  group.add(cables);
  disposables.push(cg);

  // carriers (local frame: +z = the direction of travel, y = 0 at the rope; a chair's rider faces +z, the backrest is behind him)
  const chairGeo = (() => {
    const seat = new THREE.BoxGeometry(1.9, 0.12, 0.6).translate(0, -2.1, -0.05);
    const back = new THREE.BoxGeometry(1.9, 0.75, 0.1).translate(0, -1.7, -0.35);
    const hang = new THREE.BoxGeometry(0.08, 2.1, 0.08).translate(0, -1.05, -0.3);
    const bar = new THREE.BoxGeometry(1.9, 0.06, 0.06).translate(0, -1.6, 0.42);
    const foot = new THREE.BoxGeometry(1.7, 0.05, 0.2).translate(0, -2.62, 0.5);
    return mergeBoxes([seat, back, hang, bar, foot]);
  })();
  const cabinGeo = new THREE.BoxGeometry(2.0, 2.2, 2.0).translate(0, -3.0, 0);
  const bigCabinGeo = new THREE.BoxGeometry(4.5, 3.2, 7).translate(0, -4.5, 0);
  const tbarGeo = mergeBoxes([new THREE.BoxGeometry(0.05, 2.4, 0.05).translate(0, -1.2, 0), new THREE.BoxGeometry(1.0, 0.08, 0.08).translate(0, -2.4, 0)]);
  const trainGeo = mergeBoxes([new THREE.BoxGeometry(2.6, 2.7, 13).translate(0, 1.75, 0), new THREE.BoxGeometry(2.2, 0.5, 11).translate(0, 0.25, 0)]);
  const MAX = 1400;
  const pools = {
    chair: new THREE.InstancedMesh(chairGeo, dark, MAX),
    gondola: new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0xc8372e }), 500),
    cable: new THREE.InstancedMesh(bigCabinGeo, new THREE.MeshLambertMaterial({ color: 0xd9dde3 }), 20),
    drag: new THREE.InstancedMesh(tbarGeo, dark, 600),
    train: new THREE.InstancedMesh(trainGeo, new THREE.MeshLambertMaterial({ color: 0xb8322b }), 12),
  };
  for (const p of Object.values(pools)) { p.count = 0; p.frustumCulled = false; p.castShadow = true; group.add(p); disposables.push(p.geometry, p.material); }
  let lastT = 0;

  function update(t, camX, camZ, radius) {
    lastT = t;
    const counts = { chair: 0, gondola: 0, cable: 0, drag: 0, train: 0 };
    for (const l of lifts) {
      const d = Math.hypot(l.cx - camX, l.cz - camZ) - l.radius;
      if (d > radius) continue;
      const { spec, kind } = l;
      const pool = pools[kind];
      const both = kind !== 'drag';
      const gap = spec.gap || l.len;
      const loop = both ? 2 * l.len : l.len;
      const phase = l.ride !== null ? l.ride % gap : (((t * spec.speed + l.offset) % gap) + gap) % gap;
      for (let u = phase; u < loop; u += gap) {
        if (counts[kind] >= pool.instanceMatrix.count) break;
        if (l.ride !== null && Math.abs(u - l.ride) < 1e-3) continue;          // the player's own carrier: the ride draws it
        const upSide = u < l.len;
        const s = upSide ? u : 2 * l.len - u;
        const q = l.at(s);
        const off = spec.side ? (upSide ? spec.side : -spec.side) : 0;
        const x = q.x - q.dz * off, z = q.z + q.dx * off;
        const yaw = -Math.atan2(q.dz, q.dx) + (upSide ? Math.PI / 2 : -Math.PI / 2);
        if (kind === 'train') { eul.set(-Math.atan(l.slope(s)) * (upSide ? 1 : -1), yaw, 0); q4.setFromEuler(eul); }
        else q4.setFromAxisAngle(up, yaw);
        m4.compose(v3.set(x, l.cableY(s), z), q4, s3.set(1, 1, 1));
        pool.setMatrixAt(counts[kind]++, m4);
      }
    }
    for (const [k, p] of Object.entries(pools)) { p.count = counts[k]; p.instanceMatrix.needsUpdate = true; }
  }
  /** Round 6: hold one carrier of lift `index` at s (m along the line, up side), or let it go again (null). */
  function setRide(index, s) {
    const l = byIndex.get(index);
    if (!l) return;
    if (s === null || s === undefined) {
      if (l.ride !== null) { const gap = l.spec.gap || l.len; l.offset = (((l.ride - lastT * l.spec.speed) % gap) + gap) % gap; }
      l.ride = null;
    } else l.ride = Math.max(0, Math.min(l.len, s));
  }
  /** Metres from (x, z) to the nearest lift line (stations included): the lift hum fades with it. */
  function nearest(x, z) {
    let best = Infinity;
    for (const l of lifts) {
      if (Math.hypot(l.cx - x, l.cz - z) - l.radius > best) continue;
      const p = l.src.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z) + (t <= 0 || t >= 1 ? 0 : 25);      // the stations hum more than the line
        if (d < best) best = d;
      }
    }
    return best;
  }
  function dispose() {
    scene.remove(group);
    for (const d of disposables) { try { d.dispose(); } catch (error) { /* already gone */ } }
  }
  return { group, update, nearest, setRide, dispose, pathOf: (index) => byIndex.get(index) || null, count: lifts.length };
}

const COL = { concrete: [0.68, 0.67, 0.64], stone: [0.47, 0.44, 0.41], timber: [0.5, 0.34, 0.21], glass: [0.2, 0.26, 0.33], steel: [0.42, 0.46, 0.52], wheel: [0.25, 0.27, 0.3], snow: [0.95, 0.96, 0.99], accent: [0.78, 0.2, 0.16] };
/** One end of a lift: the hall (sized by the lift kind), the bull-wheel at cable height, the canopy over it with snow on top. */
function stationGeometry(l, end, height) {
  const { spec } = l;
  const q = l.at(end);
  const g = height(q.x, q.z);
  const out = [];
  const ang = -Math.atan2(q.dz, q.dx);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(q.x, g, q.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(1, 1, 1));
  const add = (geo, colour, x = 0, y = 0, z = 0) => out.push([geo.translate(x, y, z).applyMatrix4(m), colour]);
  const [w, h, d] = spec.station;
  const cable = (l.supports[end === 0 ? 0 : l.supports.length - 1].y) - g;
  const timber = (Math.round(q.x + q.z) % 2) === 0;
  if (l.kind === 'train') {
    // a platform hall over both tracks with a canopy (the rack railway / funicular stations)
    add(new THREE.BoxGeometry(d * 1.6, 0.6, w * 0.9), COL.concrete, 0, 0.3, 0);
    add(new THREE.BoxGeometry(d * 1.6, h - 1, 1.2), COL.stone, 0, (h - 1) / 2, w * 0.45);
    add(new THREE.BoxGeometry(d * 1.7, 0.45, w), COL.timber, 0, h, 0);
    add(new THREE.BoxGeometry(d * 1.7 - 0.2, 0.35, w - 0.2), COL.snow, 0, h + 0.38, 0);
    return out;
  }
  if (l.kind === 'drag') {
    add(new THREE.BoxGeometry(3.2, 2.6, 2.6), COL.timber, 0, 1.1, -3);
    add(new THREE.BoxGeometry(3.8, 0.35, 3.2), COL.snow, 0, 2.55, -3);
    add(new THREE.CylinderGeometry(0.35, 0.45, cable + 0.5, 6), COL.steel, 0, (cable + 0.5) / 2 - 0.5, 0);
    add(new THREE.CylinderGeometry(1.0, 1.0, 0.25, 12), COL.wheel, 0, cable, 0);
    return out;
  }
  const hallH = Math.max(3.5, Math.min(h, cable - 1.2));
  // seated on the terrain: on a ridge or a steep slope the ground falls away under the hall, so a stone foundation runs down to the
  // lowest ground under the footprint (a summit station never hangs in the air)
  const c = Math.cos(ang), s = Math.sin(ang);
  let low = g;
  for (const [u, v] of [[-d * 0.65, -w / 2], [d * 0.35, -w / 2], [d * 0.35, w / 2], [-d * 0.65, w / 2], [-d * 0.15, 0], [-d * 0.65, 0], [d * 0.35, 0], [-d * 0.15, -w / 2], [-d * 0.15, w / 2]]) {
    low = Math.min(low, height(q.x + u * c + v * s, q.z - u * s + v * c));
  }
  const drop = g - low;
  if (drop > 0.4) add(new THREE.BoxGeometry(d + 0.6, drop + 1.6, w + 0.6), COL.stone, -d * 0.15, 0.4 - (drop + 1.6) / 2, 0);
  // hall: base plinth, wall body, glass band, flat roof with a snow slab
  add(new THREE.BoxGeometry(d, 1.0, w), COL.concrete, -d * 0.15, 0.1, 0);
  add(new THREE.BoxGeometry(d, hallH - 1.2, w), timber ? COL.timber : COL.concrete, -d * 0.15, 0.6 + (hallH - 1.2) / 2, 0);
  add(new THREE.BoxGeometry(d * 0.92, 1.1, w + 0.06), COL.glass, -d * 0.15, hallH - 1.3, 0);
  add(new THREE.BoxGeometry(d + 0.8, 0.45, w + 0.8), COL.concrete, -d * 0.15, hallH, 0);
  add(new THREE.BoxGeometry(d + 0.6, 0.35, w + 0.6), COL.snow, -d * 0.15, hallH + 0.38, 0);
  // the bull-wheel housing at cable height (the carriers turn round it), on two steel legs
  const R = spec.side + 0.7;
  add(new THREE.CylinderGeometry(R, R, 0.9, 20), COL.wheel, d * 0.2, cable, 0);
  add(new THREE.CylinderGeometry(R * 0.35, R * 0.35, 1.3, 10), COL.accent, d * 0.2, cable + 0.6, 0);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.6, cable - hallH + 0.5, 0.6), COL.steel, d * 0.2, hallH + (cable - hallH + 0.5) / 2 - 0.2, side * R * 0.5);
  // canopy: a shallow roof over the wheel, snow on top
  add(new THREE.BoxGeometry(2 * R + 3, 0.4, 2 * R + 2), COL.steel, d * 0.2, cable + 1.6, 0);
  add(new THREE.BoxGeometry(2 * R + 2.8, 0.4, 2 * R + 1.8), COL.snow, d * 0.2, cable + 1.95, 0);
  return out;
}

function mergeColoured(parts) {
  const pos = [], nrm = [], col = [], idx = [];
  let base = 0;
  for (const [g0, c] of parts) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c[0], c[1], c[2]); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function mergeBoxes(list) {
  const pos = [], nrm = [], idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}
