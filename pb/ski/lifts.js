/* Lifts (scenery): the real OSM lift lines with their pylons, the ropes, the stations of lift-site.js, and the chairs / cabins / bars /
 * trains moving round the loop. Lifts farther than quality.liftRadius do not move their carriers (instanced, near and far detail of
 * one model: modes/carriers.js). The line of every lift comes from lift-path.js (also what modes/liftride.js rides).
 * Round 6: setRide(index, u) holds one carrier of that lift at the loop parameter u (the player's own, drawn by the ride, so the pool
 * skips it; the lift's other carriers keep their spacing around it and carry on smoothly when the ride ends).
 * Round 7-B: every lift has its two stations by type (lift-site.js: chair platform with gates, gondola hall, cable-car terminal, drag
 * hut + wheel mast, belt ends, rail platforms, tunnel portals, a train's stops); every chair / cabin hangs from the rope by its grip,
 * follows the sag, swings a little and goes round the bull-wheels; drag lifts: pylons beside the track with an arm over it, the bars
 * on a real loop (the empty ones come back down on the return rope), a worn track in the snow; magic carpets: a moving belt;
 * underground funiculars run in a lit tunnel tube. */
const THREE = window.THREE;

import { createLiftPath } from './lift-path.js';
import { createLiftWorld, frames } from './lift-site.js';
import { carrierGeometry } from './modes/carriers.js';
import { mergeParts } from './modes/views.js';

const NEAR_R = 230;                    // m: carriers closer than this get the full model, the rest the far one
const DWELL = 8;                       // s a jig-back cabin / train waits at a station

export function createLifts({ scene, resort, height }) {
  const lifts = [];
  const byIndex = new Map();
  const paths = new Map();
  resort.lifts.forEach((src, index) => { const path = createLiftPath(src, height); if (path) paths.set(index, path); });
  const world = createLiftWorld(paths);              // the stations (with the parts that stand in a neighbour's lane left out)
  for (const [index, path] of paths) {
    const l = { ...path, path, site: world.sites.get(index), index, offset: (index * 7.31) % 50, rideU: null };
    lifts.push(l); byIndex.set(index, l);
  }

  const group = new THREE.Group();
  group.name = 'ski-lifts';
  scene.add(group);
  const disposables = [];
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(vmat);

  // ---------------- static parts: pylons, ropes, stations, tracks, belts, tunnels ----------------
  const parts = [];                                     // [geometry, colour, matrix] merged into one mesh
  const rot = (fx, fz) => new THREE.Matrix4().makeRotationY(-Math.atan2(fz, fx));
  const boxAt = (w, h, d, x, y, z, fx, fz, colour) => parts.push([new THREE.BoxGeometry(w, h, d), colour, rot(fx, fz).setPosition(x, y, z)]);
  const cylAt = (r0, r1, h, x, y, z, colour, n = 8) => parts.push([new THREE.CylinderGeometry(r0, r1, h, n), colour, new THREE.Matrix4().makeTranslation(x, y, z)]);
  const tmpW = {};
  /** One station frame's parts in the world, seated on the ground (a part that touches the ground reaches down to its lowest point). */
  function addFrame(f) {
    const g0 = height(f.x, f.z);
    for (const p of f.parts) {
      if (p.cut) continue;
      const ca = (p.a0 + p.a1) / 2, cb = (p.b0 + p.b1) / 2;
      f.toWorld(ca, cb, tmpW);
      let y0 = g0 + p.y0;
      if (p.y0 <= 0.05) {
        let low = Infinity;
        for (const [a, b] of [[p.a0, p.b0], [p.a1, p.b0], [p.a0, p.b1], [p.a1, p.b1], [ca, cb]]) { const w = f.toWorld(a, b, {}); low = Math.min(low, height(w.x, w.z)); }
        if (low - 0.3 < y0) {
          if (p.deck && g0 + p.y0 - low > 0.2) boxAt(p.a1 - p.a0, g0 + p.y0 - low + 0.3, p.b1 - p.b0, tmpW.x, (g0 + p.y0 + low - 0.3) / 2, tmpW.z, f.fx, f.fz, 0x78706a);
          else if (!p.deck) y0 = low - 0.3;
        }
      }
      const h = g0 + p.y1 - y0;
      if (h <= 0.005) continue;
      if (p.post && Math.abs(p.a1 - p.a0 - (p.b1 - p.b0)) < 1e-3) cylAt((p.a1 - p.a0) / 2, (p.a1 - p.a0) / 2, h, tmpW.x, y0 + h / 2, tmpW.z, p.col);
      else boxAt(p.a1 - p.a0, h, p.b1 - p.b0, tmpW.x, y0 + h / 2, tmpW.z, f.fx, f.fz, p.col);
    }
  }
  const cablePts = [];
  const trackParts = [];                // drag-lift tracks (one ribbon mesh)
  const beltParts = [];                 // magic carpets (the moving belt)
  const tunnelParts = [];               // tunnel tubes (self-lit)
  const tunnelLamps = [];               // and their lamps
  const q = {}, q2 = {};
  for (const l of lifts) {
    const { spec, kind } = l;
    // pylons: a column on the line, the crossbar over both lanes (drag lifts: the arm over the track and the return rope), the
    // sheave trains above the ropes (the grips pass under them)
    for (const s of l.supports) {
      if (!s.tower) continue;
      l.at(s.s, q);
      const g = height(q.x, q.z) - 0.5;
      const top = s.y + 0.55 - g;
      const thin = l.sub === 'rope';
      cylAt(thin ? 0.08 : 0.28, thin ? 0.1 : 0.42, top, q.x, g + top / 2, q.z, 0x8a9099, 8);
      const span = l.side + l.back + (thin ? 0.4 : 1.4), mid = l.sign * (l.side - l.back) / 2;
      boxAt(0.5, thin ? 0.12 : 0.35, span, q.x - q.dz * mid, s.y + (thin ? 0.3 : 0.72), q.z + q.dx * mid, q.dx, q.dz, 0x343a44);
      if (!thin) for (const lat of [l.side * l.sign, -l.back * l.sign]) boxAt(kind === 'drag' ? 1.0 : 1.8, 0.22, 0.26, q.x - q.dz * lat, s.y + 0.38, q.z + q.dx * lat, q.dx, q.dz, 0x2b2f36);
    }
    // ropes (with the sag) round the loop; trains: two tracks of two rails each
    if (kind === 'train') {
      for (const off of [-l.side - 0.5, -l.side + 0.5, l.side - 0.5, l.side + 0.5]) {
        for (let k = 0; k + 1 < l.supports.length; k++) {
          const a = l.supports[k], b = l.supports[k + 1];
          const qa = l.at(a.s, {}), qb = l.at(b.s, {});
          cablePts.push(qa.x - qa.dz * off, a.y, qa.z + qa.dx * off, qb.x - qb.dz * off, b.y, qb.z + qb.dx * off);
        }
      }
    } else if (kind !== 'carpet') {
      const steps = Math.max(8, Math.ceil(l.loopLen / 8));
      let prev = null;
      for (let k = 0; k <= steps; k++) {
        const w = l.loopAt((k / steps) * l.loopLen, {});
        if (prev && !(l.shuttle && Math.abs(w.s - prev.s) > l.len * 0.5)) cablePts.push(prev.x, prev.y, prev.z, w.x, w.y, w.z);
        prev = w;
      }
    }
    // the stations (and portals, stops)
    for (const f of frames(l.site)) addFrame(f);
    // the bull-wheels of the loop lifts: a ring at rope height round the turn
    if (!l.shuttle) {
      for (const which of [0, 1]) {
        const f = l.site.ends[which];
        const c = f.toWorld(0, l.wheelC, {});
        const y = l.cableY(which ? l.len : 0);
        cylAt(l.wheelR + 0.12, l.wheelR + 0.12, 0.22, c.x, y + 0.08, c.z, 0x3e4249, 20);
        cylAt(0.35, 0.35, 0.5, c.x, y + 0.35, c.z, 0xc8332a, 10);
      }
    }
    // a drag lift's worn track: a packed, darker strip under the up rope
    if (kind === 'drag') {
      const w = l.sub === 'rope' ? 0.9 : 1.25, lat = l.sign * (l.sub === 'rope' ? l.side - 0.45 : l.side);
      ribbon(trackParts, l, lat, w, 0.035, 0, l.len, 3);
    }
    if (kind === 'carpet') ribbon(beltParts, l, 0, 0.9, 0.18, 0, l.len, 1.5);
    if (l.tunnel) tunnelTube(tunnelParts, l);
  }
  function ribbon(out, l, lat, w, lift, s0, s1, step) {
    const n = Math.max(2, Math.ceil((s1 - s0) / step));
    const pos = [], uv = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      l.at(s, q2);
      const rx = -q2.dz, rz = q2.dx;
      for (const side of [-1, 1]) {
        const x = q2.x + rx * (lat + side * w / 2), z = q2.z + rz * (lat + side * w / 2);
        pos.push(x, height(x, z) + lift, z); uv.push(side < 0 ? 0 : 1, s / 2);
      }
    }
    const idx = [];
    for (let k = 0; k < n; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    out.push({ pos, uv, idx });
  }
  function tunnelTube(out, l) {
    // rings every 5 m between where the rail is 1 m under the ground at both ends; the vault lit by lamps every 25 m (vertex colours)
    let s0 = null, s1 = null;
    for (let s = 0; s <= l.len; s += 2) { if (l.ground(s) - l.cableY(s) > 1) { if (s0 === null) s0 = s; s1 = s; } }
    if (s0 === null) return;
    const bL = -l.back - 1.32 - 1.0, bR = l.side + 1.32 + 1.0;
    const prof = [[bL, -0.5], [bL, 3.4], [bL * 0.7, 5.0], [0, 5.7], [bR * 0.7, 5.0], [bR, 3.4], [bR, -0.5], [bL, -0.5]];
    const n = Math.ceil((s1 - s0) / 5);
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      l.at(s, q2);
      const y = l.cableY(s), rx = -q2.dz, rz = q2.dx;
      const lamp = Math.exp(-Math.pow(((s % 25) + 25) % 25 > 12.5 ? 25 - (((s % 25) + 25) % 25) : ((s % 25) + 25) % 25, 2) / 40);
      for (let i = 0; i < prof.length; i++) {
        const [b, h] = prof[i];
        pos.push(q2.x + rx * b, y + h, q2.z + rz * b);
        const shade = (i === 0 || i === prof.length - 1 || i === prof.length - 2 ? 0.28 : 0.5) * (0.35 + 0.65 * lamp);
        col.push(0.52 * shade + 0.04, 0.5 * shade + 0.04, 0.47 * shade + 0.04);
      }
    }
    const m = prof.length;
    for (let k = 0; k < n; k++) for (let i = 0; i + 1 < m; i++) { const a = k * m + i; idx.push(a, a + m, a + 1, a + 1, a + m, a + m + 1); }
    out.push({ pos, col, idx });
    // the lamps: small bright boxes under the vault
    for (let s = s0 + 12.5; s < s1; s += 25) {
      l.at(s, q2);
      const y = l.cableY(s);
      tunnelLamps.push([new THREE.BoxGeometry(1.4, 0.12, 0.5), 0xfff2c6, rot(q2.dx, q2.dz).setPosition(q2.x, y + 5.55, q2.z)]);
    }
  }
  const meshFromRibbons = (list, mat) => {
    if (!list.length) return null;
    const pos = [], uv = [], col = [], idx = [];
    let base = 0;
    for (const r of list) {
      pos.push(...r.pos); if (r.uv) uv.push(...r.uv); if (r.col) col.push(...r.col);
      for (const i of r.idx) idx.push(i + base);
      base += r.pos.length / 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    disposables.push(g);
    group.add(m);
    return m;
  };
  if (parts.length) {
    const geo = mergeParts(parts);
    const st = new THREE.Mesh(geo, vmat);
    st.castShadow = true; st.receiveShadow = true; st.name = 'ski-lift-stations';
    group.add(st);
    disposables.push(geo);
  }
  const trackMat = new THREE.MeshLambertMaterial({ color: 0xd3d9e2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(trackMat);
  const trackMesh = meshFromRibbons(trackParts, trackMat);
  if (trackMesh) trackMesh.name = 'ski-lift-tracks';
  // the belt: a dark rubber strip with cleats; its texture runs up the belt
  const beltTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#2a2d33'; x.fillRect(0, 0, 8, 32); x.fillStyle = '#4a4f58'; for (let i = 0; i < 32; i += 8) x.fillRect(0, i, 8, 2);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter;
    return t;
  })();
  const beltMat = new THREE.MeshLambertMaterial({ map: beltTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(beltTex, beltMat);
  const beltMesh = meshFromRibbons(beltParts, beltMat);
  if (beltMesh) beltMesh.name = 'ski-lift-belts';
  const tunnelMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  disposables.push(tunnelMat);
  const tunnelMesh = meshFromRibbons(tunnelParts, tunnelMat);
  if (tunnelMesh) { tunnelMesh.name = 'ski-lift-tunnels'; tunnelMesh.receiveShadow = false; }
  if (tunnelLamps.length) {
    const lg = mergeParts(tunnelLamps), lm = new THREE.MeshBasicMaterial({ vertexColors: true });
    const lamps = new THREE.Mesh(lg, lm); lamps.name = 'ski-lift-tunnel-lamps';
    group.add(lamps); disposables.push(lg, lm);
  }
  const cableMat = new THREE.LineBasicMaterial({ color: 0x23262c });
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cg, cableMat);
  cables.frustumCulled = false;
  group.add(cables);
  disposables.push(cg, cableMat);

  // ---------------- carriers: instanced pools per model (near + far detail) ----------------
  const pools = new Map();               // key -> { near, far, glass, count }
  const glassMat = new THREE.MeshLambertMaterial({ color: 0xcfe2f0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(glassMat);
  const variantOf = (l) => (l.kind === 'chair' ? `chair:${l.seats}` : l.kind === 'drag' ? `drag:${l.sub}` : l.kind);
  const need = new Map();
  for (const l of lifts) {
    if (l.kind === 'carpet' || (l.kind === 'drag' && l.sub === 'rope')) continue;
    const n = l.shuttle ? 2 : Math.ceil(l.loopLen / l.spec.gap) + 1;
    need.set(variantOf(l), (need.get(variantOf(l)) || 0) + n);
  }
  for (const [key, n] of need) {
    const [kind, v] = key.split(':');
    const opts = { seats: kind === 'chair' ? Number(v) : 4, sub: kind === 'drag' ? v : '', barUp: true };
    const cap = Math.min(n, 2400);
    const mk = (geo, mat, shadow) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.visible = false; group.add(m); disposables.push(geo); return m; };
    const near = carrierGeometry(kind, { ...opts, lod: 'near' });
    const pool = { near: mk(near.frame, vmat, true), glass: near.glass ? mk(near.glass, glassMat, false) : null, far: null, n: 0, nf: 0, cap };
    if (pool.glass) pool.glass.renderOrder = 4;
    if (kind !== 'drag') pool.far = mk(carrierGeometry(kind, { ...opts, lod: 'far' }).frame, vmat, true);
    pools.set(key, pool);
  }
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
  const eul = new THREE.Euler(0, 0, 0, 'YZX');
  const w0 = {};
  let lastT = 0;
  const SWING = { chair: 0.03, gondola: 0.022, cable: 0.006, drag: 0.05, train: 0 };
  function put(pool, l, w, k, t, camX, camZ) {
    const far = pool.far && Math.hypot(w.x - camX, w.z - camZ) > NEAR_R;
    const roll = w.turn ? 0 : SWING[l.kind] * Math.sin(t * 1.3 + k * 0.77 + l.index);
    const pitch = l.kind === 'train' ? Math.atan(l.slope(w.s)) * (w.up ? 1 : -1) : 0;
    eul.set(roll, -w.heading, pitch); q4.setFromEuler(eul);
    m4.compose(v3.set(w.x, w.y, w.z), q4, s3);
    if (far) { if (pool.nf < pool.cap) pool.far.setMatrixAt(pool.nf++, m4); }
    else if (pool.n < pool.cap) { pool.near.setMatrixAt(pool.n, m4); if (pool.glass) pool.glass.setMatrixAt(pool.n, m4); pool.n++; }
  }
  /** Where a jig-back pair is at time t (s along the line of the cabin on the up track; the other is at len - s). */
  function shuttleS(l, t) {
    const [d0, d1] = l.docks;
    const T = (d1 - d0) / l.spec.speed, cycle = 2 * (T + DWELL);
    const u = (((t + l.offset) % cycle) + cycle) % cycle;
    if (u < DWELL) return { s: d0, up: true };
    if (u < DWELL + T) return { s: d0 + (u - DWELL) * l.spec.speed, up: true };
    if (u < 2 * DWELL + T) return { s: d1, up: false };
    return { s: d1 - (u - 2 * DWELL - T) * l.spec.speed, up: false };
  }

  function update(t, camX, camZ, radius) {
    lastT = t;
    for (const p of pools.values()) { p.n = 0; p.nf = 0; }
    beltTex.offset.y = -(t * 1.4) / 2;
    for (const l of lifts) {
      if (l.kind === 'carpet' || (l.kind === 'drag' && l.sub === 'rope')) continue;
      const d = Math.hypot(l.cx - camX, l.cz - camZ) - l.radius;
      if (d > radius) continue;
      const pool = pools.get(variantOf(l));
      if (!pool) continue;
      if (l.shuttle) {
        const [d0, d1] = l.docks;
        if (l.rideU !== null) put(pool, l, l.shuttleAt(d1 - Math.min(d1 - d0, l.rideU), -1, false, w0), 1, t, camX, camZ);
        else {
          const a = shuttleS(l, t);
          put(pool, l, l.shuttleAt(a.s, 1, a.up, w0), 0, t, camX, camZ);
          put(pool, l, l.shuttleAt(d0 + d1 - a.s, -1, !a.up, w0), 1, t, camX, camZ);
        }
        continue;
      }
      const gap = l.spec.gap;
      const phase = l.rideU !== null ? ((l.rideU % gap) + gap) % gap : (((t * l.spec.speed + l.offset) % gap) + gap) % gap;
      let k = 0;
      for (let u = phase; u < l.loopLen - 1e-6; u += gap, k++) {
        if (l.rideU !== null && Math.abs(u - (((l.rideU % l.loopLen) + l.loopLen) % l.loopLen)) < 1e-3) continue;        // the player's own
        put(pool, l, l.loopAt(u, w0), k, t, camX, camZ);
      }
    }
    for (const p of pools.values()) {
      p.near.count = p.n; p.near.visible = p.n > 0; p.near.instanceMatrix.needsUpdate = true;
      if (p.glass) { p.glass.count = p.n; p.glass.visible = p.n > 0; p.glass.instanceMatrix.needsUpdate = true; }
      if (p.far) { p.far.count = p.nf; p.far.visible = p.nf > 0; p.far.instanceMatrix.needsUpdate = true; }
    }
  }
  /** Hold one carrier of lift `index` at the loop parameter u (the player's own), or let it go again (null). */
  function setRide(index, u) {
    const l = byIndex.get(index);
    if (!l) return;
    if (u === null || u === undefined) {
      if (l.rideU !== null) {
        if (l.shuttle) {             // the pair goes on from where it stands (at a station: the dwell there)
          const T = (l.docks[1] - l.docks[0]) / l.spec.speed;
          const top = l.rideU > (l.docks[1] - l.docks[0]) / 2;
          l.offset = (top ? DWELL + T + 0.5 : 0.5) - lastT;
        } else { const gap = l.spec.gap; l.offset = (((l.rideU - lastT * l.spec.speed) % gap) + gap) % gap; }
      }
      l.rideU = null;
    } else l.rideU = u;
  }
  /** The loop parameter of the next carrier that will reach uTarget (the loading point) at least `minAhead` m away. */
  function nextCarrier(index, uTarget, minAhead = 0) {
    const l = byIndex.get(index);
    if (!l || l.shuttle) return { u: uTarget - minAhead, d: minAhead };
    const gap = l.spec.gap;
    const phase = l.rideU !== null ? l.rideU : lastT * l.spec.speed + l.offset;
    let d = (((uTarget - phase) % gap) + gap) % gap;
    while (d < minAhead) d += gap;
    return { u: uTarget - d, d };
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
  return {
    group, update, nearest, setRide, nextCarrier, dispose, count: lifts.length,
    pathOf: (index) => (byIndex.get(index) ? byIndex.get(index).path : null),
    siteOf: (index) => (byIndex.get(index) ? byIndex.get(index).site : null),
    /** The loop parameter of the carrier held for the player on lift `index` (null: none). */
    heldOf: (index) => (byIndex.get(index) ? byIndex.get(index).rideU : null),
    world,
    /** Round 7-B (tests): the instanced carriers drawn now, per pool key. */
    poolCounts: () => Object.fromEntries([...pools].map(([k, p]) => [k, p.n + p.nf])),
  };
}
