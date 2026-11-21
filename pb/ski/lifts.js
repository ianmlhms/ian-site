/* Lifts (scenery only): the real OSM lift lines with their pylons, two cables, the bottom and top stations, and the chairs / cabins
 * moving up one side and down the other. Lifts farther than quality.liftRadius are hidden; the carriers of the visible ones are moved
 * every frame (instanced). Magic carpets are skipped (flat on the ground, hidden by the snow anyway). */
const THREE = window.THREE;

const SPEC = {
  chair: { tower: 10.5, gap: 22, speed: 5, hang: 2.3, side: 2.4, station: [10, 5, 6] },
  gondola: { tower: 15, gap: 55, speed: 6, hang: 3.0, side: 3.0, station: [18, 8, 10] },
  cable: { tower: 34, gap: 0, speed: 10, hang: 4.5, side: 5, station: [22, 12, 14] },
  drag: { tower: 6.5, gap: 14, speed: 3, hang: 2.5, side: 0, station: [5, 3.5, 4] },
};

export function createLifts({ scene, resort, height }) {
  const lifts = [];
  for (const src of resort.lifts) {
    const spec = SPEC[src.kind];
    if (!spec) continue;
    const p = src.pts;
    const n = p.length / 2;
    const sx = new Float32Array(n), sz = new Float32Array(n), ss = new Float32Array(n);
    for (let i = 0; i < n; i++) { sx[i] = p[2 * i]; sz[i] = p[2 * i + 1]; if (i) ss[i] = ss[i - 1] + Math.hypot(sx[i] - sx[i - 1], sz[i] - sz[i - 1]); }
    const len = ss[n - 1];
    const at = (s) => {
      let i = 0;
      while (i < n - 2 && ss[i + 1] < s) i++;
      const k = Math.min(1, Math.max(0, (s - ss[i]) / ((ss[i + 1] - ss[i]) || 1)));
      return { x: sx[i] + (sx[i + 1] - sx[i]) * k, z: sz[i] + (sz[i + 1] - sz[i]) * k, dx: (sx[i + 1] - sx[i]) / ((ss[i + 1] - ss[i]) || 1), dz: (sz[i + 1] - sz[i]) / ((ss[i + 1] - ss[i]) || 1) };
    };
    // support points of the cable: station tops at both ends, pylon tops between
    const supports = [{ s: 0, y: height(sx[0], sz[0]) + spec.station[1] * 0.8 }];
    const towers = src.kind === 'cable' && !src.pylons.length ? [len / 2] : src.pylons;
    for (const s of towers) { const q = at(s); supports.push({ s, y: height(q.x, q.z) + spec.tower, tower: true }); }
    supports.push({ s: len, y: height(sx[n - 1], sz[n - 1]) + spec.station[1] * 0.8 });
    supports.sort((a, b) => a.s - b.s);
    // a cable must clear the ground between supports: lift a support where the straight line would cut the slope
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k + 1 < supports.length; k++) {
        const a = supports[k], b = supports[k + 1];
        for (let s = a.s + 10; s < b.s; s += 10) {
          const q = at(s);
          const y = a.y + (b.y - a.y) * (s - a.s) / (b.s - a.s);
          const need = height(q.x, q.z) + spec.hang + 2;
          if (y < need) { const lift = need - y; if (b.tower) b.y += lift; if (a.tower) a.y += lift; }
        }
      }
    }
    const cableY = (s) => {
      let k = 0;
      while (k < supports.length - 2 && supports[k + 1].s < s) k++;
      const a = supports[k], b = supports[k + 1];
      return a.y + (b.y - a.y) * Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
    };
    const cx = (sx[0] + sx[n - 1]) / 2, cz = (sz[0] + sz[n - 1]) / 2;
    lifts.push({ src, spec, len, at, supports, cableY, cx, cz, radius: len / 2 });
  }

  const group = new THREE.Group();
  group.name = 'ski-lifts';
  scene.add(group);
  const metal = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x343a44 });
  const station = new THREE.MeshLambertMaterial({ color: 0x9aa1aa });
  const roof = new THREE.MeshLambertMaterial({ color: 0xeef2f8 });
  const cableMat = new THREE.LineBasicMaterial({ color: 0x23262c });
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // static parts per lift: pylons + crossbars (instanced over all lifts), stations, cables
  const towerGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 6).translate(0, 0.5, 0);
  const barGeo = new THREE.BoxGeometry(1, 0.35, 0.5);
  let towerCount = 0;
  for (const l of lifts) towerCount += l.supports.filter((s) => s.tower).length;
  const towers = new THREE.InstancedMesh(towerGeo, metal, Math.max(1, towerCount));
  const bars = new THREE.InstancedMesh(barGeo, dark, Math.max(1, towerCount));
  let ti = 0;
  const cablePts = [];
  const stationBodies = [], stationRoofs = [];
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
    // two cables (up on the right, down on the left), one for drag lifts
    const sides = spec.side ? [-spec.side, spec.side] : [0];
    for (const off of sides) {
      for (let k = 0; k + 1 < l.supports.length; k++) {
        const a = l.supports[k], b = l.supports[k + 1];
        const qa = l.at(a.s), qb = l.at(b.s);
        cablePts.push(qa.x - qa.dz * off, a.y, qa.z + qa.dx * off, qb.x - qb.dz * off, b.y, qb.z + qb.dx * off);
      }
    }
    // stations (merged into two meshes below: one draw call for all bodies, one for all roofs)
    for (const end of [0, l.len]) {
      const q = l.at(end);
      const [w, h, d] = spec.station;
      const g = height(q.x, q.z);
      q4.setFromAxisAngle(up, -Math.atan2(q.dz, q.dx));
      m4.compose(v3.set(q.x, g + h / 2 - 0.4, q.z), q4, s3.set(1, 1, 1));
      stationBodies.push(new THREE.BoxGeometry(d, h, w).applyMatrix4(m4));
      m4.compose(v3.set(q.x, g + h - 0.1, q.z), q4, s3.set(1, 1, 1));
      stationRoofs.push(new THREE.BoxGeometry(d + 1.2, 0.9, w + 1.2).applyMatrix4(m4));
    }
  }
  towers.instanceMatrix.needsUpdate = true; bars.instanceMatrix.needsUpdate = true;
  group.add(towers, bars);
  if (stationBodies.length) group.add(new THREE.Mesh(mergeBoxes(stationBodies), station), new THREE.Mesh(mergeBoxes(stationRoofs), roof));
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cg, cableMat);
  cables.frustumCulled = false;
  group.add(cables);

  // carriers
  const chairGeo = (() => {
    const g = new THREE.BoxGeometry(1.9, 0.12, 0.6).translate(0, -2.1, 0.1);
    const back = new THREE.BoxGeometry(1.9, 0.75, 0.1).translate(0, -1.7, 0.4);
    const hang = new THREE.BoxGeometry(0.08, 2.1, 0.08).translate(0, -1.05, 0.2);
    return mergeBoxes([g, back, hang]);
  })();
  const cabinGeo = new THREE.BoxGeometry(2.0, 2.2, 2.0).translate(0, -3.0, 0);
  const bigCabinGeo = new THREE.BoxGeometry(4.5, 3.2, 7).translate(0, -4.5, 0);
  const tbarGeo = mergeBoxes([new THREE.BoxGeometry(0.05, 2.4, 0.05).translate(0, -1.2, 0), new THREE.BoxGeometry(1.0, 0.08, 0.08).translate(0, -2.4, 0)]);
  const MAX = 1400;
  const pools = {
    chair: new THREE.InstancedMesh(chairGeo, dark, MAX),
    gondola: new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0xc8372e }), 500),
    cable: new THREE.InstancedMesh(bigCabinGeo, new THREE.MeshLambertMaterial({ color: 0xd9dde3 }), 20),
    drag: new THREE.InstancedMesh(tbarGeo, dark, 600),
  };
  for (const p of Object.values(pools)) { p.count = 0; p.frustumCulled = false; group.add(p); }

  function update(t, camX, camZ, radius) {
    const counts = { chair: 0, gondola: 0, cable: 0, drag: 0 };
    for (const l of lifts) {
      const d = Math.hypot(l.cx - camX, l.cz - camZ) - l.radius;
      if (d > radius) continue;
      const { spec } = l;
      const pool = pools[l.src.kind];
      const kind = l.src.kind;
      const both = kind !== 'drag';
      const gap = kind === 'cable' ? l.len : spec.gap;
      const loop = both ? 2 * l.len : l.len;
      const phase = (t * spec.speed) % gap;
      for (let u = phase; u < loop; u += gap) {
        if (counts[kind] >= pool.instanceMatrix.count) break;
        const upSide = u < l.len;
        const s = upSide ? u : 2 * l.len - u;
        const q = l.at(s);
        const off = spec.side ? (upSide ? spec.side : -spec.side) : 0;
        const x = q.x - q.dz * off, z = q.z + q.dx * off;
        q4.setFromAxisAngle(up, -Math.atan2(q.dz, q.dx) + (upSide ? Math.PI / 2 : -Math.PI / 2));
        m4.compose(v3.set(x, l.cableY(s), z), q4, s3.set(1, 1, 1));
        pool.setMatrixAt(counts[kind]++, m4);
      }
    }
    for (const [k, p] of Object.entries(pools)) { p.count = counts[k]; p.instanceMatrix.needsUpdate = true; }
  }
  return { group, update, count: lifts.length };
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
